'use strict';

const { Router } = require('express');
const { Op } = require('sequelize');
const { HttpError, asyncHandler } = require('./middleware/errors');
const { pick, parsePaging } = require('./utils');

const ALL_OPERATIONS = ['list', 'get', 'create', 'update', 'remove'];

// Будує стандартний CRUD-роутер для моделі.
// Особливості кожної сутності задаються через параметри (поля, guards, prepare тощо).
function buildCrud(options) {
  const {
    Model,
    entity,
    log,
    createFields = [],
    updateFields = [],
    filterFields = [],
    booleanFilters = [],
    extraWhere = () => ({}),
    scope = async () => ({}),
    prepare = async (req, data) => data,
    serialize = (req, item) => item,
    guards = {},
    lock = null,
    only = ALL_OPERATIONS,
  } = options;

  const router = Router();

  const guardsFor = (operation) => guards[operation] || [];
  const runExclusively = (task) => (lock ? lock.run(task) : task());

  // Шукає запис за id з урахуванням доступу користувача (scope)
  const findOr404 = async (req) => {
    const where = { id: req.params.id, ...(await scope(req)) };
    const item = await Model.findOne({ where });
    if (!item) {
      throw new HttpError(404, `${entity} not found`);
    }
    return item;
  };

  // Будує умови пошуку зі звичайних і булевих query-параметрів
  const buildFilters = (query) => {
    const where = {};

    for (const field of filterFields) {
      const value = query[field];
      if (value === undefined) {
        continue;
      }

      if (typeof value !== 'string') {
        throw new HttpError(400, `Query parameter "${field}" must be a single value`);
      }
      where[field] = value;
    }

    for (const field of booleanFilters) {
      const value = query[field];
      if (value === undefined) {
        continue;
      }

      if (value !== 'true' && value !== 'false') {
        throw new HttpError(400, `Query parameter "${field}" must be "true" or "false"`);
      }
      where[field] = value === 'true';
    }

    return where;
  };

  if (only.includes('list')) {
    router.get('/', ...guardsFor('list'), asyncHandler(async (req, res) => {
      // Умови поєднуються через AND, щоб обмеження доступу (scope)
      // не затирало фільтр за тим самим полем (наприклад, bookingId)
      const where = {
        [Op.and]: [buildFilters(req.query), extraWhere(req), await scope(req)],
      };

      const { limit, offset } = parsePaging(req.query);
      const { rows, count } = await Model.findAndCountAll({
        where,
        limit,
        offset,
        order: [['id', 'ASC']],
      });

      res.json({
        total: count,
        limit,
        offset,
        items: rows.map((item) => serialize(req, item)),
      });
    }));
  }

  if (only.includes('get')) {
    router.get('/:id', ...guardsFor('get'), asyncHandler(async (req, res) => {
      const item = await findOr404(req);
      res.json(serialize(req, item));
    }));
  }

  if (only.includes('create')) {
    router.post('/', ...guardsFor('create'), asyncHandler(async (req, res) => {
      const item = await runExclusively(async () => {
        const data = await prepare(req, pick(req.body, createFields), null);
        const created = await Model.create(data);
        return created.reload();
      });

      await log(req, 'create', entity, item.id);
      res.status(201).json(serialize(req, item));
    }));
  }

  if (only.includes('update')) {
    router.put('/:id', ...guardsFor('update'), asyncHandler(async (req, res) => {
      const item = await runExclusively(async () => {
        const found = await findOr404(req);
        const data = await prepare(req, pick(req.body, updateFields), found);
        await found.update(data);
        return found;
      });

      await log(req, 'update', entity, item.id);
      res.json(serialize(req, item));
    }));
  }

  if (only.includes('remove')) {
    router.delete('/:id', ...guardsFor('remove'), asyncHandler(async (req, res) => {
      const item = await findOr404(req);
      await item.destroy();

      await log(req, 'delete', entity, item.id);
      res.status(204).end();
    }));
  }

  return router;
}

module.exports = { buildCrud };
