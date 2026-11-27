'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { parseDate } = require('../utils');

module.exports = ({ models, auth, log, services }) => {
  const { Room, Measurement } = models;

  // Читання і видалення - стандартний CRUD, приймання вимірювань зроблено окремо нижче
  const router = buildCrud({
    Model: Measurement,
    entity: 'Measurement',
    log,
    filterFields: ['roomId', 'bookingId'],
    only: ['list', 'get', 'remove'],
    guards: {
      list: [auth.authenticate],
      get: [auth.authenticate],
      remove: auth.adminOnly,
    },
    extraWhere: (req) => {
      const range = {};
      if (req.query.from) {
        range[Op.gte] = parseDate(req.query.from, 'from');
      }
      if (req.query.to) {
        range[Op.lte] = parseDate(req.query.to, 'to');
      }

      const hasRange = Reflect.ownKeys(range).length > 0;
      return hasRange ? { measuredAt: range } : {};
    },
  });

  // Пристрій (ESP32) надсилає вимірювання, автентифікація - за ключем пристрою.
  // У відповідь пристрій отримує поточні ліміти, стан і дозволені режими світла.
  router.post('/', asyncHandler(async (req, res) => {
    const deviceKey = req.get('X-Device-Key');
    const room = deviceKey ? await Room.findOne({ where: { deviceKey } }) : null;
    if (!room) {
      throw new HttpError(401, 'Invalid or missing device key');
    }

    const result = await services.measurements.processMeasurement(room, req.body);
    res.status(201).json(result);
  }));

  return router;
};
