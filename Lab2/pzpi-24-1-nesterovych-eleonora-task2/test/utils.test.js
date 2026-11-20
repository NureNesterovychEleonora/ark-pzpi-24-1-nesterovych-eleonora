'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError } = require('../src/middleware/errors');
const {
  parseDate, requireNumber, requireInteger, requireDateOnly, pick, parsePaging, dayRange, Mutex,
} = require('../src/utils');

const status = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, 'очікується HttpError');
    return e.status;
  }
  return null;
};

describe('parseDate', () => {
  it('перетворює рядок ISO 8601 на Date', () => {
    const d = parseDate('2030-01-01T10:00:00Z', 'x');
    assert.ok(d instanceof Date);
    assert.equal(d.toISOString(), '2030-01-01T10:00:00.000Z');
  });
  it('відхиляє довільний рядок', () => assert.equal(status(() => parseDate('не дата', 'x')), 400));
});

describe('requireNumber', () => {
});

describe('requireInteger', () => {
  it('відхиляє дробове число', () => assert.equal(status(() => requireInteger(1.5, 'x')), 400));
});

describe('requireDateOnly', () => {
  it('відхиляє 29 лютого невисокосного року', () => assert.equal(status(() => requireDateOnly('2031-02-29', 'd')), 400));
});

describe('pick', () => {
});

describe('parsePaging', () => {
  it('обмежує limit значенням 200', () => {
    assert.equal(parsePaging({ limit: '5000' }).limit, 200);
  });
  it('відхиляє від’ємний limit', () => assert.equal(status(() => parsePaging({ limit: '-5' })), 400));
});

describe('dayRange', () => {
  const iso = (r) => [r.from.toISOString(), r.to.toISOString()];
  it('зимова доба за київським часом (UTC+2)', () => {
    assert.deepEqual(iso(dayRange('2030-01-15')), ['2030-01-14T22:00:00.000Z', '2030-01-15T22:00:00.000Z']);
  });
  it('доба переходу на літній час триває 23 години', () => {
    const r = dayRange('2030-03-31');
    assert.deepEqual(iso(r), ['2030-03-30T22:00:00.000Z', '2030-03-31T21:00:00.000Z']);
    assert.equal((r.to - r.from) / 3600000, 23);
  });
  it('відхиляє неіснуючу дату', () => assert.equal(status(() => dayRange('2030-02-30')), 400));
});

describe('Mutex', () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  it('виконує завдання строго по черзі', async () => {
    const m = new Mutex();
    const events = [];
    const task = (name, ms) => m.run(async () => {
      events.push(`start ${name}`);
      await sleep(ms);
      events.push(`end ${name}`);
    });
    await Promise.all([task('a', 20), task('b', 1), task('c', 1)]);
    assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});
