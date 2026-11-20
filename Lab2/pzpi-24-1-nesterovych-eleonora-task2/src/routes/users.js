'use strict';

const bcrypt = require('bcryptjs');
const { buildCrud } = require('../crud');
const { HttpError } = require('../middleware/errors');

const MIN_PASSWORD_LENGTH = 6;

// Усі операції з користувачами доступні лише адміністратору
module.exports = ({ models, auth, log }) => buildCrud({
  Model: models.User,
  entity: 'User',
  log,
  createFields: ['email', 'displayName', 'role', 'password'],
  updateFields: ['displayName', 'role', 'isBlocked', 'password'],
  filterFields: ['role'],
  booleanFilters: ['isBlocked'],
  guards: {
    list: auth.adminOnly,
    get: auth.adminOnly,
    create: auth.adminOnly,
    update: auth.adminOnly,
    remove: auth.adminOnly,
  },
  prepare: async (req, data, item) => {
    // Пароль обов'язковий при створенні, а при оновленні - лише якщо його передали
    const isPasswordNeeded = data.password !== undefined || !item;

    if (isPasswordNeeded) {
      if (typeof data.password !== 'string' || data.password.length < MIN_PASSWORD_LENGTH) {
        throw new HttpError(400, 'Password must be at least 6 characters long');
      }
      data.passwordHash = bcrypt.hashSync(data.password, 10);
    }

    delete data.password;
    return data;
  },
});
