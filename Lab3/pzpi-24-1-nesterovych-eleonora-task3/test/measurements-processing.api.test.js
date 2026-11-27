'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');

const MINUTE = 60 * 1000;

describe('потокова обробка вимірювань', () => {
  let app; let resident;
  before(async () => {
    app = await startTestApp();
    resident = await app.createUser();
  });
  after(() => app.close());

  const send = (room, at, extra = {}) => app.api('POST', '/api/measurements', {
    headers: { 'X-Device-Key': room.deviceKey },
    body: {
      measuredAt: new Date(at).toISOString(), waterLevel: 90, illuminance: 300, temperature: 22, lightMode: 'off', ...extra,
    },
  });

  describe('облік ресурсів активного бронювання та перевищення лімітів', () => {
    let room; let booking; let t0;
    before(async () => {
      room = await app.createRoom({ waterLimit: 10, lightLimit: 0.2, tempMin: 18, tempMax: 26 });
      const start = new Date(Date.now() - 10 * MINUTE);
      booking = await app.createBooking({
        room, user: resident, start, end: new Date(Date.now() + 60 * MINUTE), status: 'active',
      });
      t0 = start.getTime() + MINUTE;
    });

    it('перше вимірювання: витрата 0, стан normal, дозволені всі режими світла', async () => {
      const r = await send(room, t0, { waterLevel: 90, lightMode: 'high' });
      assert.equal(r.status, 201);
      assert.equal(r.data.bookingId, booking.id);
      assert.equal(r.data.state, 'normal');
      assert.deepEqual(r.data.allowedLightModes, ['off', 'low', 'medium', 'high']);
      assert.equal(r.data.usage.water.used, 0);
      assert.equal(r.data.limits.waterLimit, 10);
    });

    it('друге вимірювання: вода 5 із 10, світло 0.2 із 0.2 - попередження, світло лише off', async () => {
      const r = await send(room, t0 + 4 * MINUTE, { waterLevel: 85, lightMode: 'high' });
      assert.equal(r.data.usage.water.used, 5);
      assert.equal(r.data.usage.light.used, 0.2);
      assert.equal(r.data.state, 'warning');
      assert.deepEqual(r.data.allowedLightModes, ['off']);
      assert.deepEqual(r.data.violations, []);
    });

    it('третє вимірювання: перевищено воду й світло, створено дві події', async () => {
      const r = await send(room, t0 + 8 * MINUTE, { waterLevel: 78 });
      assert.equal(r.data.state, 'violation');
      assert.deepEqual(r.data.violations.map((v) => v.resource).sort(), ['light', 'water']);

      await booking.reload();
      assert.equal(booking.waterUsed, 12);
      assert.equal(booking.lightUsed, 0.4);
    });

    it('до події додається шаблонне пояснення (у фоні)', async () => {
      const violation = await app.waitFor(() => app.models.LimitViolation.findOne({
        where: { bookingId: booking.id, resource: 'water' },
      }).then((v) => (v && v.explanation ? v : null)));
      assert.equal(violation.explanationSource, 'template');
      assert.match(violation.explanation, /вода/);
    });

    it('подальше вимірювання не створює повторних подій', async () => {
      const r = await send(room, t0 + 9 * MINUTE, { waterLevel: 70 });
      assert.deepEqual(r.data.violations, []);
      assert.equal(await app.models.LimitViolation.count({ where: { bookingId: booking.id } }), 2);
    });

    it('ресурсна панель кімнати показує останнє вимірювання та використання лімітів', async () => {
      const r = await app.api('GET', `/api/rooms/${room.id}/resources`, { token: resident.token });
      assert.equal(r.status, 200);
      assert.equal(r.data.lastMeasurement.waterLevel, 70);
      assert.equal(r.data.activeBookingId, booking.id);
      assert.equal(r.data.usage.water.used, 20);
      assert.equal(r.data.usage.water.left, 0);
      assert.equal(r.data.state, 'violation');
    });
  });

  describe('температура без активного бронювання', () => {
    it('подія створюється лише при виході за межі діапазону', async () => {
      const room = await app.createRoom();
      const base = Date.UTC(2031, 5, 1, 10);
      const temps = [22, 30, 31, 22, 15];
      const created = [];
      for (let i = 0; i < temps.length; i += 1) {
        const r = await send(room, base + i * MINUTE, { temperature: temps[i] });
        created.push(r.data.violations.map((v) => v.resource));
        assert.equal(r.data.bookingId, null);
      }
      assert.deepEqual(created, [[], ['temperature'], [], [], ['temperature']]);
    });

    it('без бронювання дозволено лише вимкнене світло', async () => {
      const room = await app.createRoom();
      const r = await send(room, Date.UTC(2031, 5, 2, 10));
      assert.deepEqual(r.data.allowedLightModes, ['off']);
      assert.equal(r.data.usage, null);
    });
  });

  describe('перевірка вхідних даних', () => {
    it('невідомий режим світла → 400', async () => {
      const room = await app.createRoom();
      assert.equal((await send(room, Date.UTC(2031, 5, 3, 10), { lightMode: 'disco' })).status, 400);
    });
  });
});
