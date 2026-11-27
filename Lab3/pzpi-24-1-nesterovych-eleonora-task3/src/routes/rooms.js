'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { dayRange, requireInteger, DEFAULT_TIME_ZONE } = require('../utils');

const MAX_HISTORY_HOURS = 24 * 14;

const ROOM_FIELDS = ['name', 'description', 'waterLimit', 'lightLimit', 'tempMin', 'tempMax'];

module.exports = ({ models, config, auth, log, services }) => {
  // Ліміти, не вказані під час створення кімнати, беруться із системних параметрів
  const applyDefaultLimits = (data) => ({
    waterLimit: config.defaultWaterLimit,
    lightLimit: config.defaultLightLimit,
    tempMin: config.defaultTempMin,
    tempMax: config.defaultTempMax,
    ...data,
  });

  const router = buildCrud({
    Model: models.Room,
    entity: 'Room',
    log,
    createFields: ROOM_FIELDS,
    updateFields: ROOM_FIELDS,
    guards: {
      list: [auth.authenticate],
      get: [auth.authenticate],
      create: auth.adminOnly,
      update: auth.adminOnly,
      remove: auth.adminOnly,
    },
    prepare: async (req, data, item) => (item ? data : applyDefaultLimits(data)),
    // Мешканці не бачать службових ключів кімнати
    serialize: (req, room) => {
      const data = room.toJSON();
      if (req.user.role !== 'admin') {
        delete data.deviceKey;
        delete data.qrToken;
      }
      return data;
    },
  });

  const findRoomOr404 = async (id) => {
    const room = await models.Room.findByPk(id);
    if (!room) {
      throw new HttpError(404, 'Room not found');
    }
    return room;
  };

  // Ресурсна панель: останнє вимірювання, використання лімітів активного бронювання, стан
  router.get('/:id/resources', auth.authenticate, asyncHandler(async (req, res) => {
    const room = await findRoomOr404(req.params.id);
    res.json(await services.measurements.getRoomResources(room));
  }));

  // Цілий query-параметр у межах [min, max] або значення за замовчуванням
  const readQueryInteger = (query, name, fallback, min, max) => {
    if (query[name] === undefined) {
      return fallback;
    }
    const value = requireInteger(query[name], name);
    if (value < min || value > max) {
      throw new HttpError(400, `Query parameter "${name}" must be in range ${min}..${max}`);
    }
    return value;
  };

  // Графік ресурсної панелі: вимірювання за останні hours годин, зведені по bucketMinutes хвилин
  router.get('/:id/history', auth.authenticate, asyncHandler(async (req, res) => {
    const room = await findRoomOr404(req.params.id);
    const hours = readQueryInteger(req.query, 'hours', 24, 1, MAX_HISTORY_HOURS);
    const bucketMinutes = readQueryInteger(req.query, 'bucketMinutes', 10, 1, 1440);

    res.json(await services.measurements.getRoomHistory(room, { hours, bucketMinutes }));
  }));

  // Розклад бронювань кімнати за один день
  router.get('/:id/bookings', auth.authenticate, asyncHandler(async (req, res) => {
    const room = await findRoomOr404(req.params.id);

    const timeZone = config.timeZone || DEFAULT_TIME_ZONE;
    const { from, to } = dayRange(req.query.date, timeZone);

    // Беремо бронювання, які перетинаються з обраною добою
    const bookings = await models.Booking.findAll({
      where: {
        roomId: room.id,
        status: { [Op.in]: ['created', 'active', 'completed'] },
        startTime: { [Op.lt]: to },
        endTime: { [Op.gt]: from },
      },
      order: [['startTime', 'ASC']],
    });

    // Власника бронювання бачить лише адміністратор
    const isAdmin = req.user.role === 'admin';
    const items = bookings.map((booking) => ({
      id: booking.id,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      ...(isAdmin ? { userId: booking.userId } : {}),
    }));

    res.json({
      roomId: room.id,
      date: req.query.date,
      timeZone,
      from,
      to,
      items,
    });
  }));

  return router;
};
