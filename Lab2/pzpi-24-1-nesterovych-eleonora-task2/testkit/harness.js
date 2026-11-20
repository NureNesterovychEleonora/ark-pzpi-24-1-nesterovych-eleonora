'use strict';

const bcrypt = require('bcryptjs');
const { createSequelize } = require('../src/db');
const { initModels } = require('../src/models');
const { createApp } = require('../src/app');

const TEST_CONFIG = {
  jwtSecret: 'test-secret', jwtExpiresIn: '1h', maxBookingHours: 24, timeZone: 'Europe/Kyiv',
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
  const server = await new Promise((resolve) => {
    const s = createApp(models, config).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let counter = 0;
  const unique = (prefix) => { counter += 1; return `${prefix}-${counter}`; };

  async function api(method, path, { body, token, headers, rawBody } = {}) {
    const res = await fetch(base + path, {
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
    } catch (e) {
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

  async function close() {
    if (server.closeAllConnections) {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  }

  return { config, sequelize, models, server, base, api, createUser, createRoom, createBooking, unique, close };
}

module.exports = { startTestApp, T, TEST_CONFIG };
