'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { dayRange, DEFAULT_TIME_ZONE } = require('../utils');

const ROOM_FIELDS = ['name', 'description', 'waterLimit', 'lightLimit', 'tempMin', 'tempMax'];

module.exports = ({ models, config, auth, log }) => {
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

  // Розклад бронювань кімнати за один день
  router.get('/:id/bookings', auth.authenticate, asyncHandler(async (req, res) => {
    const room = await models.Room.findByPk(req.params.id);
    if (!room) {
      throw new HttpError(404, 'Room not found');
    }

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
