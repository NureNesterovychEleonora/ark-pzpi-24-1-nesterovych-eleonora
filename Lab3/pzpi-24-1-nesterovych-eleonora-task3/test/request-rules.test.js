'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkStatusChange } = require('../src/services/request-rules');

const statusOf = (from, to) => {
  try {
    checkStatusChange(from, to);
  } catch (e) {
    return e.status;
  }
  return null;
};

describe('переходи статусу сервісної заявки', () => {
  it('new → in_progress → resolved дозволено', () => {
    assert.equal(statusOf('new', 'in_progress'), null);
    assert.equal(statusOf('in_progress', 'resolved'), null);
  });
  it('new → resolved дозволено', () => assert.equal(statusOf('new', 'resolved'), null));
  it('повернення назад заборонене (409)', () => {
    assert.equal(statusOf('resolved', 'in_progress'), 409);
    assert.equal(statusOf('in_progress', 'new'), 409);
  });
  it('без зміни статусу (лише коментар) - дозволено', () => {
    assert.equal(statusOf('resolved', undefined), null);
    assert.equal(statusOf('resolved', 'resolved'), null);
  });
});
