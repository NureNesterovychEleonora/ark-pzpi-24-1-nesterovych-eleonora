'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError } = require('../middleware/errors');
const { parseDate, requireInteger, Mutex } = require('../utils');

const MS_IN_HOUR = 3600 * 1000;

module.exports = ({ models, config, auth, log }) => {
  const { Booking } = models;

  // Мьютекс не дає двом запитам одночасно забронювати одну кімнату
  const lock = new Mutex();

  // Перевіряє час бронювання та відсутність перетину з іншими бронюваннями
  const checkTimesAndOverlap = async (roomId, start, end, status, selfId) => {
    if (end <= start) {
      throw new HttpError(400, 'endTime must be later than startTime');
    }
    if (end - start > config.maxBookingHours * MS_IN_HOUR) {
      throw new HttpError(400, `Booking duration must not exceed ${config.maxBookingHours} hours`);
    }

    // Скасовані та завершені бронювання кімнату не займають
    if (status === 'cancelled' || status === 'completed') {
      return;
    }

    const where = {
      roomId,
      status: { [Op.in]: ['created', 'active'] },
      startTime: { [Op.lt]: end },
      endTime: { [Op.gt]: start },
    };
    if (selfId) {
      where.id = { [Op.ne]: selfId };
    }

    const overlapping = await Booking.findOne({ where });
    if (overlapping) {
      throw new HttpError(409, 'The room is already booked for this time');
    }
  };

  // Обмеження для звичайного мешканця при зміні свого бронювання
  const checkResidentCanChange = (item, data) => {
    if (item.status !== 'created') {
      throw new HttpError(409, 'Only bookings with status "created" can be changed');
    }

    const triesToChangeRoom = data.roomId !== undefined;
    const triesToSetOtherStatus = data.status && data.status !== 'cancelled';
    if (triesToChangeRoom || triesToSetOtherStatus) {
      throw new HttpError(403, 'Forbidden');
    }

    if (data.status === 'cancelled' && item.startTime <= new Date()) {
      throw new HttpError(409, 'A booking can be cancelled only before it starts');
    }
  };

  const prepare = async (req, data, item) => {
    const isAdmin = req.user.role === 'admin';

    if (item && !isAdmin) {
      checkResidentCanChange(item, data);
    }

    if (!item) {
      // Адміністратор може створити бронювання від імені іншого користувача
      const forOtherUser = isAdmin && req.body.userId !== undefined;
      data.userId = forOtherUser ? requireInteger(req.body.userId, 'userId') : req.user.id;
      data.status = 'created';
    }

    // Значення, яких немає в запиті, беремо зі збереженого бронювання
    const roomId = requireInteger(
      data.roomId !== undefined ? data.roomId : (item && item.roomId),
      'roomId',
    );
    const start = parseDate(
      data.startTime !== undefined ? data.startTime : (item && item.startTime),
      'startTime',
    );
    const end = parseDate(
      data.endTime !== undefined ? data.endTime : (item && item.endTime),
      'endTime',
    );
    const status = data.status || (item && item.status);

    await checkTimesAndOverlap(roomId, start, end, status, item && item.id);

    // Записуємо вже перевірені та приведені значення
    if (data.roomId !== undefined) {
      data.roomId = roomId;
    }
    if (data.startTime !== undefined) {
      data.startTime = start;
    }
    if (data.endTime !== undefined) {
      data.endTime = end;
    }
    return data;
  };

  // Дозволяє фільтрувати бронювання, що перетинаються з проміжком from..to
  const extraWhere = (req) => {
    const where = {};
    if (req.query.from) {
      where.endTime = { [Op.gt]: parseDate(req.query.from, 'from') };
    }
    if (req.query.to) {
      where.startTime = { [Op.lt]: parseDate(req.query.to, 'to') };
    }
    return where;
  };

  return buildCrud({
    Model: Booking,
    entity: 'Booking',
    log,
    lock,
    createFields: ['roomId', 'startTime', 'endTime'],
    updateFields: ['roomId', 'startTime', 'endTime', 'status', 'cancelReason'],
    filterFields: ['roomId', 'userId', 'status'],
    guards: {
      list: [auth.authenticate],
      get: [auth.authenticate],
      create: [auth.authenticate],
      update: [auth.authenticate],
      remove: auth.adminOnly,
    },
    extraWhere,
    // Мешканець бачить лише власні бронювання
    scope: async (req) => (req.user.role === 'admin' ? {} : { userId: req.user.id }),
    prepare,
  });
};
