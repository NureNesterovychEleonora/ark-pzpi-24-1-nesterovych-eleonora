'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError } = require('../src/middleware/errors');
const rules = require('../src/services/booking-rules');

const config = {
  maxBookingHours: 24, maxActiveBookingsPerUser: 2, checkInBeforeMinutes: 30, checkInAfterMinutes: 60,
};
const now = new Date('2030-01-01T10:00:00Z');
const minutes = (n) => new Date(now.getTime() + n * 60 * 1000);

const statusOf = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, 'очікується HttpError');
    return e.status;
  }
  return null;
};

describe('checkBookingTimes', () => {
  const check = (start, end, isStartChanged = true) => statusOf(() => rules.checkBookingTimes({
    start, end, now, config, isStartChanged,
  }));

  it('коректне бронювання', () => assert.equal(check(minutes(60), minutes(180)), null));
  it('кінець раніше за початок → 400', () => assert.equal(check(minutes(180), minutes(60)), 400));
  it('тривалість понад 24 години → 400', () => assert.equal(check(minutes(60), minutes(60 + 24 * 60 + 1)), 400));
  it('початок у минулому → 400', () => assert.equal(check(minutes(-10), minutes(60)), 400));
  it('початок у минулому допустимий, якщо його не змінюють', () => {
    assert.equal(check(minutes(-10), minutes(60), false), null);
  });
  it('тривалість менше мінімальної (1 година) → 400', () => {
    const withMin = { ...config, minBookingHours: 1 };
    const checkMin = (start, end) => statusOf(() => rules.checkBookingTimes({
      start, end, now, config: withMin, isStartChanged: true,
    }));
    assert.equal(checkMin(minutes(60), minutes(119)), 400);
    assert.equal(checkMin(minutes(60), minutes(120)), null);
  });
});

describe('checkActiveBookingsLimit', () => {
  it('менше ліміту - дозволено', () => assert.equal(statusOf(() => rules.checkActiveBookingsLimit(1, config)), null));
  it('ліміт досягнуто → 409', () => assert.equal(statusOf(() => rules.checkActiveBookingsLimit(2, config)), 409));
});

describe('поселення', () => {
  const room = { qrToken: 'qr-1' };
  const booking = (extra = {}) => ({
    status: 'created', startTime: minutes(20), endTime: minutes(140), ...extra,
  });
  const checkIn = (b, qrToken = 'qr-1', at = now) => statusOf(() => rules.checkCanCheckIn({
    booking: b, room, qrToken, now: at, config,
  }));

  it('за 20 хвилин до початку з правильним QR - дозволено', () => assert.equal(checkIn(booking()), null));
  it('чужий QR-код → 400', () => assert.equal(checkIn(booking(), 'qr-2'), 400));
  it('раніше ніж за 30 хвилин до початку → 409', () => {
    assert.equal(checkIn(booking({ startTime: minutes(45) })), 409);
  });
  it('пізніше ніж через 60 хвилин після початку → 409', () => {
    assert.equal(checkIn(booking({ startTime: minutes(-61), endTime: minutes(120) })), 409);
  });
  it('вже активне бронювання → 409', () => assert.equal(checkIn(booking({ status: 'active' })), 409));
  it('вікно поселення не виходить за кінець бронювання', () => {
    const { closesAt } = rules.checkInWindow(booking({ startTime: minutes(0), endTime: minutes(30) }), config);
    assert.equal(closesAt.getTime(), minutes(30).getTime());
  });
  it('виселення можливе лише з активного бронювання', () => {
    assert.equal(statusOf(() => rules.checkCanCheckOut({ status: 'created' })), 409);
    assert.equal(statusOf(() => rules.checkCanCheckOut({ status: 'active' })), null);
  });
});

describe('автоматичні статуси', () => {
  it('no-show після закриття вікна поселення', () => {
    const b = { status: 'created', startTime: minutes(-61), endTime: minutes(120) };
    assert.equal(rules.isNoShow(b, now, config), true);
    assert.equal(rules.isNoShow({ ...b, startTime: minutes(-30) }, now, config), false);
  });
  it('активне бронювання завершується після кінця', () => {
    assert.equal(rules.isExpired({ status: 'active', endTime: minutes(0) }, now), true);
    assert.equal(rules.isExpired({ status: 'active', endTime: minutes(1) }, now), false);
  });
});

describe('токен світлової сесії', () => {
  it('однаковий для того самого пристрою та бронювання', () => {
    const token = rules.lightSessionToken('device-key-1', 7);
    assert.match(token, /^[0-9a-f]{16}$/);
    assert.equal(rules.lightSessionToken('device-key-1', 7), token);
  });
  it('різний для іншого бронювання або іншого пристрою', () => {
    const token = rules.lightSessionToken('device-key-1', 7);
    assert.notEqual(rules.lightSessionToken('device-key-1', 8), token);
    assert.notEqual(rules.lightSessionToken('device-key-2', 7), token);
  });
});
