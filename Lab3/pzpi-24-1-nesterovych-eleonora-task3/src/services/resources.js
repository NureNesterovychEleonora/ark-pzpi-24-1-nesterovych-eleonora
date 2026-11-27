'use strict';

// Правила обліку ресурсів. Модуль не звертається до БД,
// тому його функції легко перевіряти модульними тестами.

const LIGHT_MODES = ['off', 'low', 'medium', 'high'];
const MS_IN_HOUR = 3600 * 1000;

const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const average = (values) => round(values.reduce((sum, v) => sum + v, 0) / values.length, 2);

// Витрата води та світла між двома сусідніми вимірюваннями.
// Вода - це зменшення рівня в ємності, світло - потужність режиму, помножена на час.
function usageBetween(prev, curr, config) {
  if (!prev) {
    return { water: 0, light: 0 };
  }

  const water = Math.max(0, prev.waterLevel - curr.waterLevel);

  // Якщо зв'язок пропадав надовго, рахуємо не більше maxMeasurementGapSeconds
  const gapMs = new Date(curr.measuredAt) - new Date(prev.measuredAt);
  const countedMs = Math.min(Math.max(gapMs, 0), config.maxMeasurementGapSeconds * 1000);
  const power = config.lightModePower[prev.lightMode] || 0;
  const light = (power * countedMs) / MS_IN_HOUR;

  return { water: round(water), light: round(light) };
}

function isTemperatureOutOfRange(temperature, room) {
  return temperature < room.tempMin || temperature > room.tempMax;
}

// Частка використаного ліміту (1 = використано весь ліміт)
function usageRatio(used, limit) {
  if (limit <= 0) {
    return used > 0 ? Infinity : 0;
  }
  return used / limit;
}

// Знаходить нові перевищення після обробки вимірювання.
// usageBefore/usageAfter - накопичена витрата бронювання до та після вимірювання
// (null, якщо активного бронювання немає).
function detectViolations({ room, prev, curr, usageBefore, usageAfter }) {
  const violations = [];

  if (usageAfter) {
    const resources = [
      { resource: 'water', key: 'water', limit: room.waterLimit },
      { resource: 'light', key: 'light', limit: room.lightLimit },
    ];

    // Подія створюється один раз - у момент, коли витрата вперше перевищує ліміт
    for (const { resource, key, limit } of resources) {
      if (usageBefore[key] <= limit && usageAfter[key] > limit) {
        violations.push({ resource, limitValue: limit, actualValue: usageAfter[key] });
      }
    }
  }

  // Температура: подія створюється при виході за межі діапазону
  const isOutNow = isTemperatureOutOfRange(curr.temperature, room);
  const wasOut = prev ? isTemperatureOutOfRange(prev.temperature, room) : false;
  if (isOutNow && !wasOut) {
    const limitValue = curr.temperature > room.tempMax ? room.tempMax : room.tempMin;
    violations.push({ resource: 'temperature', limitValue, actualValue: curr.temperature });
  }

  return violations;
}

// Стан кімнати для індикації: normal, warning (використано більше порогу) або violation
function evaluateState({ room, usage, temperature, warningRatio }) {
  const isTempOut = temperature !== null && temperature !== undefined
    && isTemperatureOutOfRange(temperature, room);

  const ratios = usage
    ? [usageRatio(usage.water, room.waterLimit), usageRatio(usage.light, room.lightLimit)]
    : [];

  if (isTempOut || ratios.some((ratio) => ratio > 1)) {
    return 'violation';
  }
  if (ratios.some((ratio) => ratio >= warningRatio)) {
    return 'warning';
  }
  return 'normal';
}

// Дозволені режими світла залежать від залишку ліміту світла.
// Без активного бронювання світло вмикати не можна.
function allowedLightModes({ room, usage, warningRatio }) {
  if (!usage) {
    return ['off'];
  }

  const ratio = usageRatio(usage.light, room.lightLimit);
  if (ratio >= 1) {
    return ['off'];
  }
  if (ratio >= warningRatio) {
    return ['off', 'low'];
  }
  return [...LIGHT_MODES];
}

// Використання лімітів бронювання (для ресурсної панелі та Android-застосунку)
function limitUsage(room, booking) {
  const describe = (used, limit) => ({
    used: round(used, 2),
    limit,
    left: round(Math.max(0, limit - used), 2),
    percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
  });

  return {
    water: describe(booking.waterUsed, room.waterLimit),
    light: describe(booking.lightUsed, room.lightLimit),
  };
}

// Добовий агрегат за вимірюваннями однієї кімнати (відсортованими за часом)
function computeDailyAggregate(measurements, config) {
  if (measurements.length === 0) {
    return null;
  }

  const temps = measurements.map((m) => m.temperature);
  const lights = measurements.map((m) => m.illuminance);

  let waterUsed = 0;
  let lightUsage = 0;
  for (let i = 1; i < measurements.length; i += 1) {
    const usage = usageBetween(measurements[i - 1], measurements[i], config);
    waterUsed += usage.water;
    lightUsage += usage.light;
  }

  return {
    tempMin: Math.min(...temps),
    tempMax: Math.max(...temps),
    tempAvg: average(temps),
    lightMin: Math.min(...lights),
    lightMax: Math.max(...lights),
    lightAvg: average(lights),
    waterUsed: round(waterUsed, 2),
    lightUsage: round(lightUsage, 2),
  };
}

// Зведення вимірювань (відсортованих за часом) у проміжки по bucketMinutes хвилин
// від моменту fromMs - точки графіка ресурсної панелі. Для кожного проміжку:
// середні температура й освітленість, останні рівень води та режим світла.
function bucketMeasurements(measurements, fromMs, bucketMinutes) {
  const sizeMs = bucketMinutes * 60 * 1000;
  const buckets = new Map();

  for (const m of measurements) {
    const index = Math.floor((new Date(m.measuredAt).getTime() - fromMs) / sizeMs);
    if (index < 0) {
      continue;
    }
    if (!buckets.has(index)) {
      buckets.set(index, []);
    }
    buckets.get(index).push(m);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, items]) => {
      const last = items[items.length - 1];
      return {
        from: new Date(fromMs + index * sizeMs),
        temperature: average(items.map((m) => m.temperature)),
        illuminance: average(items.map((m) => m.illuminance)),
        waterLevel: last.waterLevel,
        lightMode: last.lightMode,
        count: items.length,
      };
    });
}

module.exports = {
  LIGHT_MODES,
  usageBetween,
  isTemperatureOutOfRange,
  detectViolations,
  evaluateState,
  allowedLightModes,
  limitUsage,
  computeDailyAggregate,
  bucketMeasurements,
  round,
};
