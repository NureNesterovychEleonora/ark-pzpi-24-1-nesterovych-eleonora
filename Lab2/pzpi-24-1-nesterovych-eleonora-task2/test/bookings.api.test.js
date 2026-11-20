'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('бронювання кімнат', () => {
  let app; let admin; let resident; let other;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    other = await app.createUser();
  });
  after(() => app.close());

  const book = (room, start, end, token = resident.token, extra = {}) => app.api('POST', '/api/bookings', {
    token, body: { roomId: room.id, startTime: start, endTime: end, ...extra },
  });

  describe('створення', () => {
    it('створює бронювання зі статусом created (201)', async () => {
      const room = await app.createRoom();
      const r = await book(room, T(1, 10, 10), T(1, 10, 12));
      assert.equal(r.status, 201);
      assert.equal(r.data.status, 'created');
      assert.equal(r.data.roomId, room.id);
    });
    it('відсутній roomId → 400, а не 500', async () => {
      const r = await app.api('POST', '/api/bookings', { token: resident.token, body: { startTime: T(1, 10, 10), endTime: T(1, 10, 12) } });
      assert.equal(r.status, 400);
    });
    it('тривалість рівно 24 години допустима', async () => {
      const room = await app.createRoom();
      assert.equal((await book(room, T(1, 10, 10), T(1, 11, 10))).status, 201);
    });
    it('тривалість 24 години і 1 хвилина → 400', async () => {
      const room = await app.createRoom();
      assert.equal((await book(room, T(1, 10, 10), T(1, 11, 10, 1))).status, 400);
    });
  });

  describe('перевірка перетину бронювань', () => {
    let room;
    before(async () => {
      room = await app.createRoom();
      assert.equal((await book(room, T(2, 10, 10), T(2, 10, 12))).status, 201);
    });
    it('однаковий інтервал → 409', async () => assert.equal((await book(room, T(2, 10, 10), T(2, 10, 12), other.token)).status, 409));
    it('скасоване бронювання звільняє слот', async () => {
      const r2 = await app.createRoom();
      const first = await book(r2, T(2, 12, 10), T(2, 12, 12));
      await app.api('PUT', `/api/bookings/${first.data.id}`, { token: resident.token, body: { status: 'cancelled' } });
      assert.equal((await book(r2, T(2, 12, 10), T(2, 12, 12), other.token)).status, 201);
    });
    it('20 паралельних запитів на той самий слот: успішний рівно один', async () => {
      const r2 = await app.createRoom();
      const results = await Promise.all(Array.from({ length: 20 }, () => book(r2, T(2, 15, 10), T(2, 15, 12))));
      const codes = results.map((r) => r.status);
      assert.equal(codes.filter((c) => c === 201).length, 1);
      assert.equal(codes.filter((c) => c === 409).length, 19);
      assert.equal(await app.models.Booking.count({ where: { roomId: r2.id } }), 1);
    });
  });

  describe('перегляд і видимість', () => {
    it('мешканець бачить лише власні бронювання', async () => {
      const room = await app.createRoom();
      await app.createBooking({ room, user: resident, start: T(3, 1, 10), end: T(3, 1, 11) });
      await app.createBooking({ room, user: other, start: T(3, 1, 12), end: T(3, 1, 13) });
      const r = await app.api('GET', `/api/bookings?roomId=${room.id}`, { token: resident.token });
      assert.equal(r.data.total, 1);
      assert.equal(r.data.items[0].userId, resident.user.id);
    });
    it('мешканець не бачить чуже бронювання за id (404)', async () => {
      const room = await app.createRoom();
      const b = await app.createBooking({ room, user: other, start: T(3, 4, 10), end: T(3, 4, 11) });
      assert.equal((await app.api('GET', `/api/bookings/${b.id}`, { token: resident.token })).status, 404);
    });
  });

  describe('зміна та скасування', () => {
    const put = (id, body, token = resident.token) => app.api('PUT', `/api/bookings/${id}`, { token, body });

    it('мешканець скасовує власне бронювання до початку', async () => {
      const room = await app.createRoom();
      const b = (await book(room, T(4, 1, 10), T(4, 1, 12))).data;
      const r = await put(b.id, { status: 'cancelled', cancelReason: 'Змінились плани' });
      assert.equal(r.status, 200);
      assert.equal(r.data.status, 'cancelled');
      assert.equal(r.data.cancelReason, 'Змінились плани');
    });
    it('після початку мешканець скасувати не може (409)', async () => {
      const room = await app.createRoom();
      const start = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      const end = new Date(Date.now() - 3600 * 1000).toISOString();
      const b = await app.createBooking({ room, user: resident, start, end });
      assert.equal((await put(b.id, { status: 'cancelled' })).status, 409);
    });
  });

  describe('видалення', () => {
    it('видалення бронювання каскадно видаляє огляди', async () => {
      const room = await app.createRoom();
      const b = await app.createBooking({ room, user: resident, start: T(5, 3, 10), end: T(5, 3, 11) });
      await app.models.Inspection.create({ bookingId: b.id, type: 'checkin', state: 'ok' });
      await app.api('DELETE', `/api/bookings/${b.id}`, { token: admin.token });
      assert.equal(await app.models.Inspection.count({ where: { bookingId: b.id } }), 0);
    });
  });
});
