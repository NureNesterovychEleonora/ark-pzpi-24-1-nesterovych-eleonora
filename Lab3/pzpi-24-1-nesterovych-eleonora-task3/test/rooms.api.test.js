'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('кімнати та розклад кімнати', () => {
  let app; let admin; let resident; let other;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    other = await app.createUser();
  });
  after(() => app.close());

  const body = (extra = {}) => ({ name: app.unique('Кімната'), waterLimit: 80, lightLimit: 60, tempMin: 18, tempMax: 26, ...extra });
  const create = (b, token = admin.token) => app.api('POST', '/api/rooms', { body: b, token });

  describe('права доступу', () => {
    it('створення мешканцем → 403', async () => assert.equal((await create(body(), resident.token)).status, 403));
  });

  describe('приховування службових полів', () => {
    it('мешканець не бачить ключ пристрою та QR-токен у списку', async () => {
      await app.createRoom();
      const r = await app.api('GET', '/api/rooms', { token: resident.token });
      for (const room of r.data.items) {
        assert.equal(room.deviceKey, undefined);
        assert.equal(room.qrToken, undefined);
      }
    });
  });

  describe('створення', () => {
    it('відхиляє дублікат назви (409)', async () => {
      const b = body();
      await create(b);
      assert.equal((await create(b)).status, 409);
    });
    it('відхиляє tempMin більший за tempMax (400)', async () => {
      assert.equal((await create(body({ tempMin: 30, tempMax: 20 }))).status, 400);
    });
  });

  describe('видалення', () => {
    it('не видаляє кімнату з бронюваннями (409)', async () => {
      const room = await app.createRoom();
      await app.createBooking({ room, user: resident, start: T(7, 1, 10), end: T(7, 1, 12) });
      assert.equal((await app.api('DELETE', `/api/rooms/${room.id}`, { token: admin.token })).status, 409);
    });
  });

  describe('бронювання кімнати за обраний день (GET /api/rooms/:id/bookings)', () => {
    let room; let a; let b;
    before(async () => {
      room = await app.createRoom();
      // Київ, травень: UTC+3. A: 11:00-13:00 10 травня; B: 23:00 10 травня - 05:00 11 травня; C скасоване.
      a = await app.createBooking({ room, user: resident, start: T(5, 10, 8), end: T(5, 10, 10) });
      b = await app.createBooking({ room, user: other, start: T(5, 10, 20), end: T(5, 11, 2) });
      await app.createBooking({ room, user: other, start: T(5, 10, 11), end: T(5, 10, 12), status: 'cancelled' });
    });
    const get = (query, token = resident.token, id = room.id) => app.api('GET', `/api/rooms/${id}/bookings${query}`, { token });

    it('повертає бронювання, що потрапляють у добу', async () => {
      const r = await get('?date=2030-05-10');
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.items.map((i) => i.id), [a.id, b.id]);
    });
    it('бронювання, що перетинає північ, потрапляє в обидві доби', async () => {
      const r = await get('?date=2030-05-11');
      assert.deepEqual(r.data.items.map((i) => i.id), [b.id]);
    });
    it('мешканцю не показується ідентифікатор користувача', async () => {
      const r = await get('?date=2030-05-10');
      for (const i of r.data.items) assert.equal(i.userId, undefined);
    });
    it('без параметра date → 400', async () => assert.equal((await get('')).status, 400));
  });
});
