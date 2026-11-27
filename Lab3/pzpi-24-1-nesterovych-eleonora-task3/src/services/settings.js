'use strict';

const fs = require('node:fs');
const { HttpError } = require('../middleware/errors');
const { LIGHT_MODES } = require('./resources');

// Параметри, які з settings.json не перечитуються без перезапуску сервера
// (порт і каталог фото задаються під час запуску) або взагалі не задаються у файлі (секрети, шлях до БД)
const FIXED_KEYS = ['port', 'uploadsDir', 'jwtSecret', 'llmApiKey', 'dbStorage', 'settingsFile'];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function readSettingsFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new HttpError(400, `Cannot read settings file: ${err.message}`);
  }
}

// Перевіряє нові значення параметрів. Не звертається до файлів і БД,
// тому перевіряється модульними тестами. За помилки кидає HttpError 400.
function validateSettings(next, current) {
  const errors = [];

  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(current, key)) {
      errors.push(`unknown parameter "${key}"`);
    } else if (typeof value !== typeof current[key] || value === null) {
      errors.push(`"${key}" must be of type ${typeof current[key]}`);
    } else if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      errors.push(`"${key}" must be a non-negative number`);
    }
  }

  if (errors.length === 0) {
    const s = { ...current, ...next };

    if (s.minBookingHours > s.maxBookingHours) {
      errors.push('minBookingHours must not exceed maxBookingHours');
    }
    if (s.maxActiveBookingsPerUser < 1 || s.measurementRetentionDays < 1) {
      errors.push('maxActiveBookingsPerUser and measurementRetentionDays must be at least 1');
    }
    if (s.defaultTempMin >= s.defaultTempMax) {
      errors.push('defaultTempMin must be less than defaultTempMax');
    }
    if (!(s.limitWarningRatio > 0 && s.limitWarningRatio <= 1)) {
      errors.push('limitWarningRatio must be in range (0, 1]');
    }
    if (!TIME_PATTERN.test(s.nightlyJobTime)) {
      errors.push('nightlyJobTime must be in format HH:MM');
    }
    const powers = s.lightModePower || {};
    if (!LIGHT_MODES.every((mode) => typeof powers[mode] === 'number' && powers[mode] >= 0)) {
      errors.push(`lightModePower must contain non-negative numbers for: ${LIGHT_MODES.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    throw new HttpError(400, `Invalid settings: ${errors.join('; ')}`);
  }
}

// Текстовий опис змінених параметрів для журналу дій: "maxBookingHours: 24 -> 12"
function listChanges(before, after, keys) {
  const changes = [];
  for (const key of keys) {
    const oldValue = JSON.stringify(before[key]);
    const newValue = JSON.stringify(after[key]);
    if (oldValue !== newValue) {
      changes.push(`${key}: ${oldValue} -> ${newValue}`);
    }
  }
  return changes.join('; ').slice(0, 500);
}

// Перечитує settings.json і застосовує нові значення без перезапуску сервера.
// Усі модулі читають параметри з того самого об'єкта config у момент виконання,
// тому зміни діють одразу.
function createSettingsService({ config }) {
  function reload() {
    const fromFile = readSettingsFile(config.settingsFile);
    if (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile)) {
      throw new HttpError(400, 'Settings file must contain a JSON object');
    }

    const applicable = {};
    for (const [key, value] of Object.entries(fromFile)) {
      if (!FIXED_KEYS.includes(key)) {
        applicable[key] = value;
      }
    }

    validateSettings(applicable, config);

    const before = { ...config };
    Object.assign(config, applicable);
    return { changes: listChanges(before, config, Object.keys(applicable)) };
  }

  return { reload };
}

module.exports = { FIXED_KEYS, validateSettings, listChanges, createSettingsService };
