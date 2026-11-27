'use strict';

const { Router } = require('express');
const { Op } = require('sequelize');
const { asyncHandler } = require('../middleware/errors');

const RECENT_VIOLATIONS = 5;

// Параметри, які не можна показувати навіть адміністратору
const SECRET_KEYS = ['jwtSecret', 'llmApiKey'];

const BOOKING_STATUSES = ['created', 'active', 'completed', 'cancelled'];
const REQUEST_STATUSES = ['new', 'in_progress', 'resolved'];
const MS_IN_DAY = 24 * 3600 * 1000;

module.exports = ({ models, config, auth, log, services }) => {
  const router = Router();
  const { User, Room, Booking, ServiceRequest, LimitViolation, Measurement, ActionLog } = models;

  // Кількість записів моделі для кожного значення поля (наприклад, бронювання за статусами)
  const countBy = async (Model, field, values) => {
    const result = {};
    for (const value of values) {
      result[value] = await Model.count({ where: { [field]: value } });
    }
    return result;
  };

  const publicSettings = () => {
    const settings = { ...config };
    for (const key of SECRET_KEYS) {
      delete settings[key];
    }
    return settings;
  };

  // Поточні системні параметри (задаються у файлі settings.json)
  router.get('/settings', auth.adminOnly, (req, res) => {
    res.json({ settings: publicSettings(), llmConfigured: Boolean(config.llmApiKey) });
  });

  // Застосування зміненого settings.json без перезапуску сервера.
  // Некоректний файл відхиляється (400), поточні значення залишаються без змін.
  router.post('/settings/reload', auth.adminOnly, asyncHandler(async (req, res) => {
    const { changes } = services.settings.reload();

    await log(req, 'reload_settings', 'Settings', null, changes || 'no changes');
    res.json({ changes, settings: publicSettings() });
  }));

  // Моніторинг активності: лічильники користувачів, бронювань, заявок,
  // останні перевищення лімітів і події за останню добу
  router.get('/stats', auth.adminOnly, asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - MS_IN_DAY);
    const last24h = { [Op.gte]: since };

    res.json({
      users: {
        total: await User.count(),
        ...(await countBy(User, 'role', ['resident', 'admin'])),
        blocked: await User.count({ where: { isBlocked: true } }),
      },
      rooms: await Room.count(),
      bookings: await countBy(Booking, 'status', BOOKING_STATUSES),
      serviceRequests: await countBy(ServiceRequest, 'status', REQUEST_STATUSES),
      recentViolations: await LimitViolation.findAll({
        attributes: ['id', 'roomId', 'bookingId', 'resource', 'limitValue', 'actualValue', 'detectedAt'],
        order: [['detectedAt', 'DESC'], ['id', 'DESC']],
        limit: RECENT_VIOLATIONS,
      }),
      last24h: {
        since,
        violations: await LimitViolation.count({ where: { detectedAt: last24h } }),
        measurements: await Measurement.count({ where: { measuredAt: last24h } }),
        actions: await ActionLog.count({ where: { createdAt: last24h } }),
      },
    });
  }));

  return router;
};
