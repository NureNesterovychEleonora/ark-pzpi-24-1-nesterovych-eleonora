'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('добові агрегати та перевищення лімітів', () => {
  let app; let admin; let resident;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(() => app.close());

  describe('добові агрегати', () => {
    const agg = (roomId, extra = {}) => ({
      roomId, date: '2030-02-01', tempMin: 19, tempMax: 24, tempAvg: 21.5,
      lightMin: 0, lightMax: 400, lightAvg: 120, waterUsed: 12.5, lightUsage: 30, ...extra,
    });
    const create = (b, token = admin.token) => app.api('POST', '/api/daily-aggregates', { token, body: b });

    it('адміністратор створює агрегат (201)', async () => {
      const room = await app.createRoom();
      const r = await create(agg(room.id));
      assert.equal(r.status, 201);
      assert.equal(r.data.waterUsed, 12.5);
      assert.equal(r.data.roomId, room.id);
    });
    it('мешканець не може створити агрегат (403)', async () => {
      const room = await app.createRoom();
      assert.equal((await create(agg(room.id), resident.token)).status, 403);
    });
    it('дублікат (кімната, дата) → 409', async () => {
      const room = await app.createRoom();
      await create(agg(room.id));
      assert.equal((await create(agg(room.id))).status, 409);
    });
  });

  describe('перевищення лімітів', () => {
    const vio = (roomId, extra = {}) => ({
      roomId, resource: 'water', limitValue: 80, actualValue: 95, detectedAt: T(3, 1, 10), ...extra,
    });
    const create = (b, token = admin.token) => app.api('POST', '/api/limit-violations', { token, body: b });

    it('створює перевищення (201)', async () => {
      const room = await app.createRoom();
      const r = await create(vio(room.id));
      assert.equal(r.status, 201);
      assert.equal(r.data.resource, 'water');
      assert.equal(r.data.bookingId, null);
      assert.equal(r.data.explanation, null);
    });
    it('мешканець не може створити перевищення (403)', async () => {
      const room = await app.createRoom();
      assert.equal((await create(vio(room.id), resident.token)).status, 403);
    });
  });
});
