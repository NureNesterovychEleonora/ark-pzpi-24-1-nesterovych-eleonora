'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const resources = require('../src/services/resources');

const config = {
  lightModePower: { off: 0, low: 1, medium: 2, high: 3 },
  maxMeasurementGapSeconds: 300,
};
const room = { waterLimit: 20, lightLimit: 1, tempMin: 18, tempMax: 26 };
const at = (minute) => new Date(Date.UTC(2030, 0, 1, 10, minute)).toISOString();
const m = (minute, extra = {}) => ({
  measuredAt: at(minute), waterLevel: 80, illuminance: 300, temperature: 22, lightMode: 'off', ...extra,
});

describe('usageBetween: витрата між двома вимірюваннями', () => {
  it('без попереднього вимірювання витрата нульова', () => {
    assert.deepEqual(resources.usageBetween(null, m(0), config), { water: 0, light: 0 });
  });
  it('вода - це зменшення рівня', () => {
    const usage = resources.usageBetween(m(0, { waterLevel: 80 }), m(1, { waterLevel: 75.5 }), config);
    assert.equal(usage.water, 4.5);
  });
  it('поповнення ємності не рахується як витрата', () => {
    assert.equal(resources.usageBetween(m(0, { waterLevel: 50 }), m(1, { waterLevel: 90 }), config).water, 0);
  });
  it('світло рахується за режимом попереднього вимірювання і часом', () => {
    // режим high (3 од./год) протягом 4 хвилин = 0.2
    const usage = resources.usageBetween(m(0, { lightMode: 'high' }), m(4), config);
    assert.equal(usage.light, 0.2);
  });
  it('довгий проміжок без зв’язку обмежується maxMeasurementGapSeconds', () => {
    // 60 хвилин без даних, але враховується лише 5 хвилин: 3 * 5 / 60 = 0.25
    const usage = resources.usageBetween(m(0, { lightMode: 'high' }), m(60), config);
    assert.equal(usage.light, 0.25);
  });
});

describe('detectViolations: виявлення перевищень', () => {
  const detect = (args) => resources.detectViolations({ room, prev: m(0), curr: m(1), ...args });

  it('немає перевищень у межах лімітів', () => {
    assert.deepEqual(detect({ usageBefore: { water: 1, light: 0 }, usageAfter: { water: 2, light: 0 } }), []);
  });
  it('перевищення води фіксується в момент переходу через ліміт', () => {
    const found = detect({ usageBefore: { water: 19, light: 0 }, usageAfter: { water: 21, light: 0 } });
    assert.deepEqual(found, [{ resource: 'water', limitValue: 20, actualValue: 21 }]);
  });
  it('повторно після переходу подія не створюється', () => {
    assert.deepEqual(detect({ usageBefore: { water: 21, light: 0 }, usageAfter: { water: 23, light: 0 } }), []);
  });
  it('перевищення світла', () => {
    const found = detect({ usageBefore: { water: 0, light: 0.9 }, usageAfter: { water: 0, light: 1.1 } });
    assert.equal(found[0].resource, 'light');
  });
  it('без бронювання ліміти води і світла не перевіряються', () => {
    assert.deepEqual(detect({ usageBefore: null, usageAfter: null }), []);
  });
  it('вихід температури за верхню межу', () => {
    const found = detect({ curr: m(1, { temperature: 27.5 }) });
    assert.deepEqual(found, [{ resource: 'temperature', limitValue: 26, actualValue: 27.5 }]);
  });
  it('вихід температури за нижню межу', () => {
    assert.equal(detect({ curr: m(1, { temperature: 16 }) })[0].limitValue, 18);
  });
  it('якщо температура вже була поза межами, нова подія не створюється', () => {
    assert.deepEqual(detect({ prev: m(0, { temperature: 28 }), curr: m(1, { temperature: 29 }) }), []);
  });
});

describe('evaluateState та allowedLightModes', () => {
  const state = (usage, temperature = 22) => resources.evaluateState({
    room, usage, temperature, warningRatio: 0.8,
  });
  const modes = (usage) => resources.allowedLightModes({ room, usage, warningRatio: 0.8 });

  it('норма', () => assert.equal(state({ water: 5, light: 0.1 }), 'normal'));
  it('попередження після 80% ліміту', () => assert.equal(state({ water: 16, light: 0 }), 'warning'));
  it('перевищення ліміту', () => assert.equal(state({ water: 25, light: 0 }), 'violation'));
  it('температура поза діапазоном - стан violation навіть без бронювання', () => {
    assert.equal(state(null, 30), 'violation');
  });
  it('без бронювання дозволено лише вимкнене світло', () => assert.deepEqual(modes(null), ['off']));
  it('усі режими, поки ліміт світла далекий', () => {
    assert.deepEqual(modes({ water: 0, light: 0.1 }), ['off', 'low', 'medium', 'high']);
  });
  it('після 80% ліміту світла - лише off і low', () => {
    assert.deepEqual(modes({ water: 0, light: 0.85 }), ['off', 'low']);
  });
  it('ліміт світла вичерпано - лише off', () => assert.deepEqual(modes({ water: 0, light: 1 }), ['off']));
});

describe('limitUsage', () => {
  it('рахує залишок і відсоток використання', () => {
    const usage = resources.limitUsage(room, { waterUsed: 5, lightUsed: 1.5 });
    assert.deepEqual(usage.water, { used: 5, limit: 20, left: 15, percent: 25 });
    assert.deepEqual(usage.light, { used: 1.5, limit: 1, left: 0, percent: 150 });
  });
});

describe('computeDailyAggregate', () => {
  it('для порожнього списку повертає null', () => {
    assert.equal(resources.computeDailyAggregate([], config), null);
  });
  it('рахує мінімум, максимум, середнє та витрату', () => {
    const list = [
      m(0, { temperature: 20, illuminance: 100, waterLevel: 90, lightMode: 'medium' }),
      m(5, { temperature: 24, illuminance: 300, waterLevel: 85 }),
      m(10, { temperature: 22, illuminance: 200, waterLevel: 95 }),
    ];
    assert.deepEqual(resources.computeDailyAggregate(list, config), {
      tempMin: 20,
      tempMax: 24,
      tempAvg: 22,
      lightMin: 100,
      lightMax: 300,
      lightAvg: 200,
      waterUsed: 5,
      lightUsage: 0.17,
    });
  });
});

describe('bucketMeasurements: точки графіка ресурсної панелі', () => {
  const fromMs = new Date(at(0)).getTime();
  it('зводить вимірювання в проміжки: середні значення, останній рівень води й режим світла', () => {
    const list = [
      m(1, { temperature: 20, illuminance: 100, waterLevel: 90 }),
      m(4, { temperature: 22, illuminance: 300, waterLevel: 85, lightMode: 'low' }),
      m(12, { temperature: 25, illuminance: 50, waterLevel: 80 }),
    ];
    const points = resources.bucketMeasurements(list, fromMs, 10);
    assert.equal(points.length, 2);
    assert.deepEqual(points[0], {
      from: new Date(at(0)), temperature: 21, illuminance: 200, waterLevel: 85, lightMode: 'low', count: 2,
    });
    assert.equal(points[1].from.toISOString(), at(10));
    assert.equal(points[1].count, 1);
  });
  it('порожні проміжки пропускаються, вимірювання до початку періоду не враховуються', () => {
    const list = [m(0), m(35)];
    const points = resources.bucketMeasurements(list, fromMs + 60 * 1000, 10);
    assert.deepEqual(points.map((p) => p.from.toISOString()), [new Date(fromMs + 31 * 60 * 1000).toISOString()]);
  });
});
