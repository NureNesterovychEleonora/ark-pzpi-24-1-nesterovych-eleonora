'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, asyncHandler, errorHandler } = require('../src/middleware/errors');

const fakeRes = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

describe('HttpError', () => {
});

describe('asyncHandler', () => {
  it('передає синхронну помилку в next', async () => {
    const err = new Error('sync');
    let passed = null;
    await asyncHandler(() => { throw err; })({}, {}, (e) => { passed = e; });
    assert.equal(passed, err);
  });
});

describe('errorHandler', () => {
  let originalError;
  beforeEach(() => { originalError = console.error; console.error = () => {}; });
  afterEach(() => { console.error = originalError; });

  it('HttpError → код і повідомлення помилки', () => {
    const res = fakeRes();
    errorHandler(new HttpError(403, 'Forbidden'), { method: 'GET' }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  });
  it('порушення унікальності → 409', () => {
    const res = fakeRes();
    errorHandler({ name: 'SequelizeUniqueConstraintError' }, { method: 'POST' }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /unique/i);
  });
  it('помилка валідації → 400 з переліком повідомлень', () => {
    const res = fakeRes();
    const err = { name: 'SequelizeValidationError', errors: [{ message: 'a' }, { message: 'b' }] };
    errorHandler(err, { method: 'POST' }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Validation failed', details: ['a', 'b'] });
  });
  it('невідома помилка → 500 без розкриття подробиць', () => {
    const res = fakeRes();
    errorHandler(new Error('секрет'), { method: 'GET' }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal server error' });
  });
});
