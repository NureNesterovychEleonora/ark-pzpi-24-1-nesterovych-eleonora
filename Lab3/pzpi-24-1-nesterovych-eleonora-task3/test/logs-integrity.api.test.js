'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('журнал дій, цілісність даних та службові маршрути', () => {
  let app; let admin; let resident;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(() => app.close());

  const logs = (query = '') => app.api('GET', `/api/action-logs?limit=200${query}`, { token: admin.token });

  describe('журнал дій', () => {
    it('недоступний мешканцю (403)', async () => {
      assert.equal((await app.api('GET', '/api/action-logs', { token: resident.token })).status, 403);
    });
    it('запис за id недоступний мешканцю (403)', async () => {
      assert.equal((await app.api('GET', '/api/action-logs/1', { token: resident.token })).status, 403);
    });
    it('створення кімнати фіксується в журналі', async () => {
      const r = await app.api('POST', '/api/rooms', { token: admin.token, body: { name: app.unique('Журнал') } });
      const entry = (await logs('&action=create&entity=Room')).data.items.find((l) => l.entityId === r.data.id);
      assert.ok(entry);
      assert.equal(entry.userId, admin.user.id);
    });
  });

  describe('обмеження цілісності БД', () => {
    it('кімнату з бронюванням видалити неможливо (RESTRICT)', async () => {
      const room = await app.createRoom();
      await app.createBooking({ room, user: resident, start: T(12, 1, 10), end: T(12, 1, 11) });
      await assert.rejects(room.destroy(), (e) => e.name === 'SequelizeForeignKeyConstraintError');
    });
  });

  describe('службові маршрути та обробка помилок', () => {
    it('GET /api/health → 200 {status: ok}', async () => {
      const r = await app.api('GET', '/api/health');
      assert.equal(r.status, 200);
      assert.deepEqual(r.data, { status: 'ok' });
    });
    it('некоректний JSON → 400', async () => {
      const r = await app.api('POST', '/api/auth/login', { rawBody: '{oops' });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'Invalid JSON body');
    });
  });
});
