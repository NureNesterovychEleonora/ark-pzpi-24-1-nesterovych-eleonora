'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('огляди кімнат та сервісні заявки', () => {
  let app; let admin; let resident; let other;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    other = await app.createUser();
  });
  after(() => app.close());

  describe('огляди', () => {
    const insp = (token, body) => app.api('POST', '/api/inspections', { token, body });
    const bookingFor = async (user, day = 1) => {
      const room = await app.createRoom();
      return app.createBooking({ room, user, start: T(6, day, 10), end: T(6, day, 12), status: 'active' });
    };

    it('власник створює огляд під час поселення (201)', async () => {
      const b = await bookingFor(resident);
      const r = await insp(resident.token, { bookingId: b.id, type: 'checkin', state: 'ok' });
      assert.equal(r.status, 201);
      assert.equal(r.data.type, 'checkin');
      assert.equal(r.data.state, 'ok');
      assert.equal(r.data.note, null);
    });
    it('повторний огляд того самого типу → 409', async () => {
      const b = await bookingFor(resident);
      await insp(resident.token, { bookingId: b.id, type: 'checkin', state: 'ok' });
      assert.equal((await insp(resident.token, { bookingId: b.id, type: 'checkin', state: 'issues' })).status, 409);
    });
    it('огляд чужого бронювання → 403', async () => {
      const b = await bookingFor(other);
      assert.equal((await insp(resident.token, { bookingId: b.id, type: 'checkin', state: 'ok' })).status, 403);
    });
  });

  describe('сервісні заявки', () => {
    const create = (token, body) => app.api('POST', '/api/service-requests', { token, body });

    it('створює заявку зі статусом new (201)', async () => {
      const room = await app.createRoom();
      const r = await create(resident.token, { roomId: room.id, description: 'Не працює лампа' });
      assert.equal(r.status, 201);
      assert.equal(r.data.status, 'new');
      assert.equal(r.data.userId, resident.user.id);
      assert.equal(r.data.photoUrl, null);
    });
    it('адміністратор проводить заявку через статуси new → in_progress → resolved', async () => {
      const room = await app.createRoom();
      const s = (await create(resident.token, { roomId: room.id, description: 'Лампа' })).data;
      const a = await app.api('PUT', `/api/service-requests/${s.id}`, { token: admin.token, body: { status: 'in_progress', adminComment: 'Беремо в роботу' } });
      assert.equal(a.data.status, 'in_progress');
      assert.equal(a.data.adminComment, 'Беремо в роботу');
      const b = await app.api('PUT', `/api/service-requests/${s.id}`, { token: admin.token, body: { status: 'resolved' } });
      assert.equal(b.data.status, 'resolved');
      assert.equal(b.data.adminComment, 'Беремо в роботу');
    });
  });
});
