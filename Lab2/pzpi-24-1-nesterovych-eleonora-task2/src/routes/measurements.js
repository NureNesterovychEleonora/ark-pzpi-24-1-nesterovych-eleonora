'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { parseDate, requireNumber } = require('../utils');

module.exports = ({ models, auth, log }) => {
  const { Room, Booking, Measurement } = models;

  // Читання і видалення - стандартний CRUD, створення зроблено окремо нижче
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

  // Пристрій (ESP32) надсилає вимірювання, автентифікація - за ключем пристрою
  router.post('/', asyncHandler(async (req, res) => {
    const deviceKey = req.get('X-Device-Key');
    const room = deviceKey ? await Room.findOne({ where: { deviceKey } }) : null;
    if (!room) {
      throw new HttpError(401, 'Invalid or missing device key');
    }

    const body = req.body || {};
    const measuredAt = body.measuredAt ? parseDate(body.measuredAt, 'measuredAt') : new Date();

    // Прив'язуємо вимірювання до активного бронювання кімнати (якщо воно є)
    const booking = await Booking.findOne({
      where: {
        roomId: room.id,
        status: 'active',
        startTime: { [Op.lte]: measuredAt },
        endTime: { [Op.gte]: measuredAt },
      },
    });

    const measurement = await Measurement.create({
      roomId: room.id,
      bookingId: booking ? booking.id : null,
      measuredAt,
      waterLevel: requireNumber(body.waterLevel, 'waterLevel'),
      illuminance: requireNumber(body.illuminance, 'illuminance'),
      temperature: requireNumber(body.temperature, 'temperature'),
    });

    res.status(201).json(measurement);
  }));

  return router;
};
