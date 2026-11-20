'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Обгортка для async-обробників: будь-яка помилка передається в next(),
// тому її обробить errorHandler.
const asyncHandler = (handler) => (req, res, next) =>
  new Promise((resolve) => resolve(handler(req, res, next))).catch(next);

function isClientErrorStatus(status) {
  return Number.isInteger(status) && status >= 400 && status < 500;
}

// Єдине місце, де помилки перетворюються на HTTP-відповіді.
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  // Некоректний JSON у тілі запиту
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (isClientErrorStatus(err.status)) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'Record with such unique value already exists' });
  }

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => e.message),
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    const isDelete = req.method === 'DELETE';
    const status = isDelete ? 409 : 400;
    const message = isDelete
      ? 'Record is referenced by other records'
      : 'Referenced record does not exist';
    return res.status(status).json({ error: message });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { HttpError, asyncHandler, errorHandler };
