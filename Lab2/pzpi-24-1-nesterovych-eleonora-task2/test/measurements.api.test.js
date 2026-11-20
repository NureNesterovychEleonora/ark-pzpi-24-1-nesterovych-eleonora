'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('приймання та архів вимірювань', () => {
  let app; let admin; let resident; let room;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    room = await app.createRoom();
  });
  after(() => app.close());

  const send = (body, key = room.deviceKey, r = room) => app.api('POST', '/api/measurements', {
    headers: key ? { 'X-Device-Key': key } : {}, body,
  });
  const reading = (minute, extra = {}) => ({
    measuredAt: T(8, 1, 10, minute), waterLevel: 70, illuminance: 300, temperature: 22, ...extra,
  });
  let seq = 0;
  // унікальний час вимірювання: кожен виклик дає наступну секунду 2031 року
  const nextTime = () => new Date(Date.UTC(2031, 0, 1, 0, 0, 0) + (seq += 1) * 1000).toISOString();

  describe('автентифікація пристрою', () => {
    it('без ключа → 401', async () => assert.equal((await send(reading(0), null)).status, 401));
  });

  describe('приймання вимірювання', () => {
    it('приймає коректне вимірювання (201)', async () => {
      const r = await send({ ...reading(0), measuredAt: nextTime() });
      assert.equal(r.status, 201);
      assert.equal(r.data.waterLevel, 70);
      assert.equal(r.data.illuminance, 300);
      assert.equal(r.data.temperature, 22);
    });
    it('відхиляє дублікат (кімната, час) → 409', async () => {
      const t = nextTime();
      assert.equal((await send({ ...reading(0), measuredAt: t })).status, 201);
      assert.equal((await send({ ...reading(0), measuredAt: t })).status, 409);
    });
    it('рівень води більший за 100 → 400', async () => {
      assert.equal((await send({ ...reading(0), measuredAt: nextTime(), waterLevel: 100.1 })).status, 400);
    });
  });

  describe('прив’язка до активного бронювання', () => {
    let r2; let booking;
    before(async () => {
      r2 = await app.createRoom();
      booking = await app.createBooking({ room: r2, user: resident, start: T(10, 1, 10), end: T(10, 1, 12), status: 'active' });
    });
    const at = (t) => send({ measuredAt: t, waterLevel: 50, illuminance: 10, temperature: 20 }, r2.deviceKey);

    it('вимірювання всередині інтервалу прив’язується', async () => assert.equal((await at(T(10, 1, 11))).data.bookingId, booking.id));
    it('вимірювання після завершення не прив’язується', async () => assert.equal((await at(T(10, 1, 12, 1))).data.bookingId, null));
  });

  describe('перегляд архіву', () => {
    let r2; let first; let second; let third;
    before(async () => {
      r2 = await app.createRoom();
      const mk = (min) => send({ measuredAt: T(11, 1, 10, min), waterLevel: 10 + min, illuminance: 1, temperature: 20 }, r2.deviceKey);
      first = (await mk(0)).data; second = (await mk(10)).data; third = (await mk(20)).data;
    });
    const list = (query, token = resident.token) => app.api('GET', `/api/measurements?roomId=${r2.id}${query}`, { token });

    it('фільтр from включає межу', async () => {
      const r = await list(`&from=${T(11, 1, 10, 10)}`);
      assert.deepEqual(r.data.items.map((i) => i.id), [second.id, third.id]);
    });
  });

  describe('видалення та недоступні операції', () => {
    it('мешканець не може видалити вимірювання (403)', async () => {
      const m = (await send({ ...reading(0), measuredAt: nextTime() })).data;
      assert.equal((await app.api('DELETE', `/api/measurements/${m.id}`, { token: resident.token })).status, 403);
    });
  });
});
