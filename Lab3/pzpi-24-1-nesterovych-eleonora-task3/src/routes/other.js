'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { Op } = require('sequelize');
const { buildCrud } = require('../crud');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { parseDate, requireDateOnly } = require('../utils');
const { checkStatusChange } = require('../services/request-rules');

// Фото до сервісної заявки: JPEG або PNG до 5 МБ
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_PHOTO_SIZE = '5mb';

// Прості довідкові сутності: добові агрегати, перевищення лімітів,
// огляди, сервісні заявки та журнал дій.
module.exports = ({ models, config, auth, log, services }) => {
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
    // Звіт за обраний період: from і to у форматі YYYY-MM-DD (включно)
    extraWhere: (req) => {
      const range = {};
      if (req.query.from !== undefined) {
        range[Op.gte] = requireDateOnly(req.query.from, 'from');
      }
      if (req.query.to !== undefined) {
        range[Op.lte] = requireDateOnly(req.query.to, 'to');
      }
      return Reflect.ownKeys(range).length > 0 ? { date: range } : {};
    },
    order: [['date', 'ASC'], ['roomId', 'ASC']],
    prepare: async (req, data) => {
      if (data.date !== undefined) {
        data.date = requireDateOnly(data.date, 'date');
      }
      return data;
    },
  });

  // Ручний перерахунок агрегатів за дату (той самий розрахунок, що й у нічному завданні);
  // можливий лише в межах періоду зберігання сирих вимірювань
  aggregates.post('/calculate', auth.adminOnly, asyncHandler(async (req, res) => {
    const date = requireDateOnly((req.body || {}).date, 'date');
    services.aggregates.checkDateInRetention(date);
    const items = await services.aggregates.calculateForDate(date);

    await log(req, 'calculate_aggregates', 'DailyAggregate', null, `${date}: ${items.length} rooms`);
    res.json({ date, items });
  }));

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
      if (item) {
        checkStatusChange(item.status, data.status);
      } else {
        data.userId = req.user.id;
        data.status = 'new';
      }
      return data;
    },
  });

  // Завантаження фото проблеми (Android-застосунок надсилає файл у тілі запиту)
  requests.post(
    '/:id/photo',
    auth.authenticate,
    express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_PHOTO_SIZE }),
    asyncHandler(async (req, res) => {
      const where = { id: req.params.id, ...(isAdmin(req) ? {} : { userId: req.user.id }) };
      const request = await ServiceRequest.findOne({ where });
      if (!request) {
        throw new HttpError(404, 'ServiceRequest not found');
      }

      const type = req.is(Object.keys(PHOTO_TYPES));
      if (!type || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, 'Photo must be a JPEG or PNG image');
      }

      const fileName = `request-${request.id}-${randomUUID()}.${PHOTO_TYPES[type]}`;
      await fs.promises.mkdir(config.uploadsDir, { recursive: true });
      await fs.promises.writeFile(path.join(config.uploadsDir, fileName), req.body);
      await request.update({ photoUrl: `/uploads/${fileName}` });

      await log(req, 'upload_photo', 'ServiceRequest', request.id);
      res.json(request);
    }),
  );

  // ---------- Журнал дій (тільки читання, тільки адміністратор) ----------

  const logs = buildCrud({
    Model: ActionLog,
    entity: 'ActionLog',
    log,
    only: ['list', 'get'],
    filterFields: ['userId', 'action', 'entity'],
    guards: { list: auth.adminOnly, get: auth.adminOnly },
    // Фільтр за періодом і нові записи першими
    extraWhere: (req) => {
      const range = {};
      if (req.query.from) {
        range[Op.gte] = parseDate(req.query.from, 'from');
      }
      if (req.query.to) {
        range[Op.lte] = parseDate(req.query.to, 'to');
      }
      return Reflect.ownKeys(range).length > 0 ? { createdAt: range } : {};
    },
    order: [['id', 'DESC']],
  });

  return { aggregates, violations, inspections, requests, logs };
};
