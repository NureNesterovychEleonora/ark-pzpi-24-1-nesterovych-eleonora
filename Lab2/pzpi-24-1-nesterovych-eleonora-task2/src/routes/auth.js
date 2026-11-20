'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { HttpError, asyncHandler } = require('../middleware/errors');

const MIN_PASSWORD_LENGTH = 6;

module.exports = ({ models, config, auth, log }) => {
  const router = Router();
  const { User } = models;

  // Реєстрація: новий користувач завжди отримує роль "resident"
  router.post('/register', asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body || {};

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, 'Password must be at least 6 characters long');
    }

    const user = await User.create({
      email,
      displayName,
      role: 'resident',
      passwordHash: bcrypt.hashSync(password, 10),
    });

    await log({ user }, 'register', 'User', user.id);
    res.status(201).json(user);
  }));

  // Вхід: перевіряємо пароль і повертаємо JWT-токен
  router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};

    const user = await User.findOne({ where: { email: String(email || '') } });
    const isPasswordValid = user && bcrypt.compareSync(String(password || ''), user.passwordHash);

    if (!isPasswordValid) {
      throw new HttpError(401, 'Invalid email or password');
    }
    if (user.isBlocked) {
      throw new HttpError(403, 'Account is blocked');
    }

    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });

    await log({ user }, 'login', 'User', user.id);
    res.json({ token, user });
  }));

  router.get('/me', auth.authenticate, (req, res) => res.json(req.user));

  return router;
};
