'use strict';

const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const appConfig = require('../src/config');
const { createSequelize } = require('../src/db');
const { initModels } = require('../src/models');
const { createApp } = require('../src/app');

// Тести не залежать від settings.json і .env у частині, що впливає на результат:
// LLM вимкнено (шаблонні пояснення), обмеження кількості бронювань практично зняте.
const TEST_CONFIG = {
  ...appConfig,
  jwtSecret: 'test-secret',
  jwtExpiresIn: '1h',
  maxBookingHours: 24,
  timeZone: 'Europe/Kyiv',
  maxActiveBookingsPerUser: 1000,
  checkInBeforeMinutes: 30,
  checkInAfterMinutes: 60,
  limitWarningRatio: 0.8,
  lightModePower: { off: 0, low: 1, medium: 2, high: 3 },
  maxMeasurementGapSeconds: 300,
  llmApiKey: '',
  uploadsDir: path.join(os.tmpdir(), 'habicore-test-uploads'),
};

/** Час UTC у 2030 році у форматі ISO: T(місяць, день, година, хвилина). */
const T = (month, day, hour = 0, minute = 0) => new Date(Date.UTC(2030, month - 1, day, hour, minute)).toISOString();

/**
 * Запускає застосунок із БД SQLite у пам'яті на вільному порту та повертає допоміжні засоби:
 * api() — HTTP-запит, createUser/createRoom/createBooking — створення даних напряму через ORM.
 */
async function startTestApp(overrides = {}) {
  const config = { ...TEST_CONFIG, ...overrides };
  const sequelize = createSequelize(':memory:');
  const models = initModels(sequelize);
  await sequelize.sync();
  const expressApp = createApp(models, config);
  const server = await new Promise((resolve) => {
    const s = expressApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let counter = 0;
  const unique = (prefix) => { counter += 1; return `${prefix}-${counter}`; };

  async function api(method, url, { body, token, headers, rawBody } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }

  async function createUser({ role = 'resident', password = 'secret1', displayName = 'Test User', email, isBlocked = false } = {}) {
    const user = await models.User.create({
      email: email || `${unique('user')}@test.local`,
      displayName, role, isBlocked, passwordHash: bcrypt.hashSync(password, 4),
    });
    let token = null;
    if (!isBlocked) {
      token = (await api('POST', '/api/auth/login', { body: { email: user.email, password } })).data.token;
    }
    return { user, password, token };
  }

  const createRoom = (fields = {}) => models.Room.create({ name: unique('Room'), ...fields });

  const createBooking = ({ room, user, start, end, status = 'created' }) => models.Booking.create({
    roomId: room.id, userId: (user.user || user).id, startTime: start, endTime: end, status,
  });

  // Чекає, поки умова стане істинною (для фонових дій, наприклад, пояснення LLM)
  async function waitFor(check, timeoutMs = 2000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = await check();
      if (value) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Condition was not met in time');
  }

  async function close() {
    // Даємо завершитися фоновим діям (поясненням перевищень) перед закриттям БД
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (server.closeAllConnections) {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  }

  return {
    config, sequelize, models, server, base, api, services: expressApp.locals.services,
    createUser, createRoom, createBooking, waitFor, unique, close,
  };
}

module.exports = { startTestApp, T, TEST_CONFIG };
