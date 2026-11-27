'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Системні параметри зберігаються у файлі settings.json у корені проєкту.
// Секрети (ключі, паролі) задаються змінними оточення або у файлі .env.
const ROOT_DIR = path.join(__dirname, '..');
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(ROOT_DIR, 'settings.json');
const ENV_FILE = path.join(ROOT_DIR, '.env');

// Значення за замовчуванням, якщо в settings.json параметра немає
const DEFAULTS = {
  port: 3000,
  timeZone: 'Europe/Kyiv',
  jwtExpiresIn: '8h',
  minBookingHours: 1,
  maxBookingHours: 24,
  maxActiveBookingsPerUser: 2,
  checkInBeforeMinutes: 30,
  checkInAfterMinutes: 60,
  defaultWaterLimit: 100,
  defaultLightLimit: 100,
  defaultTempMin: 18,
  defaultTempMax: 26,
  limitWarningRatio: 0.8,
  lightModePower: { off: 0, low: 1, medium: 2, high: 3 },
  maxMeasurementGapSeconds: 300,
  measurementRetentionDays: 14,
  llmModel: 'gemini-3.5-flash-lite',
  llmTimeoutMs: 15000,
  llmDailyLimit: 50,
  nightlyJobTime: '00:05',
  uploadsDir: './data/uploads',
};

function readSettingsFile() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

// Файл .env необов'язковий (process.loadEnvFile є в Node.js 20.12+)
if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(ENV_FILE);
}

const settings = { ...DEFAULTS, ...readSettingsFile() };

module.exports = {
  ...settings,
  port: Number(process.env.PORT) || settings.port,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  dbStorage: process.env.DB_STORAGE || './data/habicore.sqlite',
  llmApiKey: process.env.GEMINI_API_KEY || '',
  uploadsDir: path.resolve(ROOT_DIR, settings.uploadsDir),
  settingsFile: SETTINGS_FILE,
};
