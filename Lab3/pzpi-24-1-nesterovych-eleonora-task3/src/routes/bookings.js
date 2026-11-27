'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { parseDate, requireInteger, Mutex } = require('../utils');
const rules = require('../services/booking-rules');

const BUSY_STATUSES = ['created', 'active'];

module.exports = ({ models, config, auth, log }) => {
  const { Booking, Room, Inspection } = models;
  const { sequelize } = Booking;

  // Мьютекс не дає двом запитам одночасно забронювати одну кімнату
  const lock = new Mutex();

  const isAdmin = (req) => req.user.role === 'admin';

  // Перевіряє відсутність перетину з іншими бронюваннями кімнати
  const checkOverlap = async (roomId, start, end, status, selfId) => {
    // Скасовані та завершені бронювання кімнату не займають
    if (!BUSY_STATUSES.includes(status)) {
      return;
    }

    const where = {
      roomId,
      status: { [Op.in]: BUSY_STATUSES },
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

  // Скільки поточних і майбутніх бронювань уже має користувач
  const countActiveBookings = (userId, now) => Booking.count({
    where: { userId, status: { [Op.in]: BUSY_STATUSES }, endTime: { [Op.gt]: now } },
  });

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
    const now = new Date();

    if (item && !isAdmin(req)) {
      checkResidentCanChange(item, data);
    }

    if (!item) {
      // Адміністратор може створити бронювання від імені іншого користувача
      const forOtherUser = isAdmin(req) && req.body.userId !== undefined;
      data.userId = forOtherUser ? requireInteger(req.body.userId, 'userId') : req.user.id;
      data.status = 'created';

      if (!isAdmin(req)) {
        rules.checkActiveBookingsLimit(await countActiveBookings(req.user.id, now), config);
      }
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

    rules.checkBookingTimes({
      start, end, now, config, isStartChanged: !item || data.startTime !== undefined,
    });
    await checkOverlap(roomId, start, end, status, item && item.id);

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

  const router = buildCrud({
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
    scope: async (req) => (isAdmin(req) ? {} : { userId: req.user.id }),
    prepare,
  });

  // ---------- Поселення та виселення ----------

  const findOwnBooking = async (req) => {
    const where = { id: req.params.id, ...(isAdmin(req) ? {} : { userId: req.user.id }) };
    const booking = await Booking.findOne({ where });
    if (!booking) {
      throw new HttpError(404, 'Booking not found');
    }
    return booking;
  };

  // Статус бронювання та запис огляду змінюються в одній транзакції
  const changeStatusWithInspection = (booking, status, inspection) => sequelize.transaction(
    async (transaction) => {
      await booking.update({ status }, { transaction });
      const record = await Inspection.create({
        bookingId: booking.id,
        type: inspection.type,
        state: inspection.state,
        note: inspection.note,
      }, { transaction });
      return { booking, inspection: record };
    },
  );

  // Поселення: Android-застосунок надсилає QR-токен кімнати та огляд кімнати
  router.post('/:id/check-in', auth.authenticate, asyncHandler(async (req, res) => {
    const { qrToken, state, note } = req.body || {};

    const result = await lock.run(async () => {
      const booking = await findOwnBooking(req);
      const room = await Room.findByPk(booking.roomId);
      rules.checkCanCheckIn({ booking, room, qrToken, now: new Date(), config });

      const otherActive = await Booking.findOne({
        where: { roomId: room.id, status: 'active', id: { [Op.ne]: booking.id } },
      });
      if (otherActive) {
        throw new HttpError(409, 'Another booking is active in this room');
      }

      const changed = await changeStatusWithInspection(booking, 'active', { type: 'checkin', state, note });
      // Токен світлової сесії: Android-застосунок передає його пристрою разом із BLE-командою
      return { ...changed, lightToken: rules.lightSessionToken(room.deviceKey, booking.id) };
    });

    await log(req, 'check_in', 'Booking', result.booking.id);
    res.json(result);
  }));

  // Виселення: бронювання завершується, витрата ресурсів фіксується
  router.post('/:id/check-out', auth.authenticate, asyncHandler(async (req, res) => {
    const { state, note } = req.body || {};

    const result = await lock.run(async () => {
      const booking = await findOwnBooking(req);
      rules.checkCanCheckOut(booking);
      return changeStatusWithInspection(booking, 'completed', { type: 'checkout', state, note });
    });

    const details = `waterUsed: ${result.booking.waterUsed}; lightUsed: ${result.booking.lightUsed}`;
    await log(req, 'check_out', 'Booking', result.booking.id, details);
    res.json(result);
  }));

  return router;
};
