'use strict';

const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError } = require('../middleware/errors');
const { parseDate, requireDateOnly } = require('../utils');

// Прості довідкові сутності: добові агрегати, перевищення лімітів,
// огляди, сервісні заявки та журнал дій.
module.exports = ({ models, auth, log }) => {
  const { DailyAggregate, LimitViolation, Inspection, ServiceRequest, ActionLog, Booking } = models;

  // Читати можуть усі авторизовані, змінювати - лише адміністратор
  const readGuards = { list: [auth.authenticate], get: [auth.authenticate] };
  const adminGuards = {
    create: auth.adminOnly,
    update: auth.adminOnly,
    remove: auth.adminOnly,
  };

  const isAdmin = (req) => req.user.role === 'admin';

  // ---------- Добові агрегати ----------

  const aggregateFields = [
    'roomId', 'date',
    'tempMin', 'tempMax', 'tempAvg',
    'lightMin', 'lightMax', 'lightAvg',
    'waterUsed', 'lightUsage',
  ];

  const aggregates = buildCrud({
    Model: DailyAggregate,
    entity: 'DailyAggregate',
    log,
    createFields: aggregateFields,
    updateFields: aggregateFields,
    filterFields: ['roomId', 'date'],
    guards: { ...readGuards, ...adminGuards },
    prepare: async (req, data) => {
      if (data.date !== undefined) {
        data.date = requireDateOnly(data.date, 'date');
      }
      return data;
    },
  });

  // ---------- Перевищення лімітів ----------

  const violationFields = [
    'roomId', 'bookingId', 'resource', 'limitValue', 'actualValue',
    'detectedAt', 'explanation', 'explanationSource',
  ];

  const violations = buildCrud({
    Model: LimitViolation,
    entity: 'LimitViolation',
    log,
    createFields: violationFields,
    updateFields: violationFields,
    filterFields: ['roomId', 'bookingId', 'resource'],
    guards: { ...readGuards, ...adminGuards },
    prepare: async (req, data) => {
      if (data.detectedAt !== undefined) {
        data.detectedAt = parseDate(data.detectedAt, 'detectedAt');
      }
      return data;
    },
  });

  // ---------- Огляди кімнат ----------

  const getOwnBookingIds = async (req) => {
    const bookings = await Booking.findAll({
      attributes: ['id'],
      where: { userId: req.user.id },
    });
    return bookings.map((booking) => booking.id);
  };

  const inspections = buildCrud({
    Model: Inspection,
    entity: 'Inspection',
    log,
    createFields: ['bookingId', 'type', 'state', 'note'],
    updateFields: ['state', 'note'],
    filterFields: ['bookingId', 'type'],
    guards: {
      ...readGuards,
      create: [auth.authenticate],
      update: auth.adminOnly,
      remove: auth.adminOnly,
    },
    // Мешканець бачить огляди лише своїх бронювань
    scope: async (req) => {
      if (isAdmin(req)) {
        return {};
      }
      return { bookingId: { [Op.in]: await getOwnBookingIds(req) } };
    },
    prepare: async (req, data, item) => {
      if (!item) {
        const booking = await Booking.findByPk(data.bookingId);
        if (!booking) {
          throw new HttpError(400, 'Booking does not exist');
        }
        if (!isAdmin(req) && booking.userId !== req.user.id) {
          throw new HttpError(403, 'Forbidden');
        }
      }
      return data;
    },
  });

  // ---------- Сервісні заявки ----------

  const requests = buildCrud({
    Model: ServiceRequest,
    entity: 'ServiceRequest',
    log,
    createFields: ['roomId', 'description', 'photoUrl'],
    updateFields: ['status', 'adminComment'],
    filterFields: ['roomId', 'status', 'userId'],
    guards: {
      ...readGuards,
      create: [auth.authenticate],
      update: auth.adminOnly,
      remove: auth.adminOnly,
    },
    scope: async (req) => (isAdmin(req) ? {} : { userId: req.user.id }),
    prepare: async (req, data, item) => {
      if (!item) {
        data.userId = req.user.id;
        data.status = 'new';
      }
      return data;
    },
  });

  // ---------- Журнал дій (тільки читання, тільки адміністратор) ----------

  const logs = buildCrud({
    Model: ActionLog,
    entity: 'ActionLog',
    log,
    only: ['list', 'get'],
    filterFields: ['userId', 'action', 'entity'],
    guards: { list: auth.adminOnly, get: auth.adminOnly },
  });

  return { aggregates, violations, inspections, requests, logs };
};
