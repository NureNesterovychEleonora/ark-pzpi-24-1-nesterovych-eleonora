'use strict';

const { HttpError } = require('./middleware/errors');

const DEFAULT_TIME_ZONE = 'Europe/Kyiv';

// ---------- Перевірка вхідних значень ----------

function parseDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  const isMissing = value === undefined || value === null;

  if (isMissing || Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Field "${name}" must be a valid date-time`);
  }
  return date;
}

function requireNumber(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new HttpError(400, `Field "${name}" must be a number`);
  }
  return value;
}

// Приймає ціле число або рядок із цілим числом (наприклад, "5")
function requireInteger(value, name) {
  const isIntegerString = typeof value === 'string' && /^-?\d+$/.test(value.trim());
  const number = isIntegerString ? Number(value) : value;

  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new HttpError(400, `Field "${name}" must be an integer`);
  }
  return number;
}

// Перевіряє дату у форматі YYYY-MM-DD (разом із існуванням такої дати в календарі)
function requireDateOnly(value, name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '');

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day));
    const isRealDate = date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;

    if (isRealDate) {
      return value;
    }
  }

  throw new HttpError(400, `Field "${name}" must be a valid date in format YYYY-MM-DD`);
}

// Залишає в об'єкті лише дозволені поля
function pick(body, fields) {
  const result = {};
  for (const field of fields) {
    if (body && body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

// Читає параметри пагінації limit та offset із query-рядка
function parsePaging(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const readInteger = (raw, name, min, fallback) => {
    if (raw === undefined) {
      return fallback;
    }

    const isValid = typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) >= min;
    if (!isValid) {
      throw new HttpError(400, `Query parameter "${name}" must be an integer >= ${min}`);
    }
    return Number(raw);
  };

  const limit = Math.min(readInteger(query.limit, 'limit', 1, defaultLimit), maxLimit);
  const offset = readInteger(query.offset, 'offset', 0, 0);
  return { limit, offset };
}

// ---------- Робота з часовими поясами ----------

// Різниця (у мс) між місцевим часом у поясі timeZone та UTC у момент utcMs
function tzOffsetMs(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  const localAsUtc = Date.UTC(
    values.year, values.month - 1, values.day,
    values.hour, values.minute, values.second,
  );
  return localAsUtc - Math.floor(utcMs / 1000) * 1000;
}

// Переводить північ за місцевим часом у момент UTC.
// Зсув рахуємо двічі, щоб правильно обробити перехід на літній/зимовий час.
function zonedMidnightToUtc(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  const firstTry = guess - tzOffsetMs(timeZone, guess);
  return new Date(guess - tzOffsetMs(timeZone, firstTry));
}

// Межі доби [from, to) для дати YYYY-MM-DD у заданому часовому поясі
function dayRange(dateStr, timeZone = DEFAULT_TIME_ZONE) {
  requireDateOnly(dateStr, 'date');

  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));

  return {
    from: zonedMidnightToUtc(year, month, day, timeZone),
    to: zonedMidnightToUtc(
      nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), timeZone,
    ),
  };
}

// ---------- Черга виконання ----------

// Мьютекс: завдання виконуються строго по черзі.
// Потрібен, щоб два однакові бронювання не пройшли перевірку одночасно.
class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(task) {
    const result = this.tail.then(() => task());
    // Помилка одного завдання не повинна зупиняти чергу
    this.tail = result.catch(() => {});
    return result;
  }
}

module.exports = {
  DEFAULT_TIME_ZONE,
  parseDate,
  requireNumber,
  requireInteger,
  requireDateOnly,
  pick,
  parsePaging,
  dayRange,
  Mutex,
};
