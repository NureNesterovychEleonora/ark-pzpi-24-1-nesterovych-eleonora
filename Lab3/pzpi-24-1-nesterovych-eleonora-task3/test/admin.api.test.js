'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');

describe('функції адміністрування', () => {
  let app; let admin; let resident;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(() => app.close());

  const put = (url, body, token = admin.token) => app.api('PUT', url, { token, body });
  const lastLog = async (entity, entityId) => (await app.api(
    'GET', `/api/action-logs?entity=${entity}&action=update`, { token: admin.token },
  )).data.items.find((entry) => entry.entityId === entityId);

  describe('керування користувачами та ролями', () => {
    it('зміна ролі записується в журнал із подробицями', async () => {
      const u = await app.createUser();
      const r = await put(`/api/users/${u.user.id}`, { role: 'admin' });
      assert.equal(r.status, 200);
      assert.equal(r.data.role, 'admin');
      assert.equal((await lastLog('User', u.user.id)).details, 'role: resident -> admin');
    });

    it('блокування записується в журнал', async () => {
      const u = await app.createUser();
      await put(`/api/users/${u.user.id}`, { isBlocked: true });
      assert.equal((await lastLog('User', u.user.id)).details, 'isBlocked: false -> true');
    });

    it('адміністратор не може заблокувати себе або зняти з себе роль (409)', async () => {
      assert.equal((await put(`/api/users/${admin.user.id}`, { isBlocked: true })).status, 409);
      assert.equal((await put(`/api/users/${admin.user.id}`, { role: 'resident' })).status, 409);
    });

    it('адміністратор не може видалити власний обліковий запис (409)', async () => {
      const r = await app.api('DELETE', `/api/users/${admin.user.id}`, { token: admin.token });
      assert.equal(r.status, 409);
    });
  });

  describe('редагування ресурсних лімітів кімнати', () => {
    it('нові ліміти зберігаються й записуються в журнал', async () => {
      const room = await app.createRoom();
      const r = await put(`/api/rooms/${room.id}`, { waterLimit: 20, lightLimit: 0.5 });
      assert.equal(r.data.waterLimit, 20);
      assert.equal((await lastLog('Room', room.id)).details, 'waterLimit: 100 -> 20; lightLimit: 100 -> 0.5');
    });

    it('мешканець змінювати ліміти не може (403)', async () => {
      const room = await app.createRoom();
      assert.equal((await put(`/api/rooms/${room.id}`, { waterLimit: 1 }, resident.token)).status, 403);
    });

    it('нова кімната без лімітів отримує значення із системних параметрів', async () => {
      const r = await app.api('POST', '/api/rooms', { token: admin.token, body: { name: app.unique('Нова') } });
      assert.equal(r.data.waterLimit, app.config.defaultWaterLimit);
      assert.equal(r.data.tempMax, app.config.defaultTempMax);
    });
  });

  describe('журнал дій', () => {
    it('нові записи першими', async () => {
      const r = await app.api('GET', '/api/action-logs?limit=5', { token: admin.token });
      assert.ok(r.data.items.length >= 2);
      assert.ok(r.data.items[0].id > r.data.items[1].id);
    });

    it('фільтр за періодом', async () => {
      const future = new Date(Date.now() + 3600 * 1000).toISOString();
      const r = await app.api('GET', `/api/action-logs?from=${future}`, { token: admin.token });
      assert.equal(r.data.total, 0);
    });
  });

  describe('системні параметри', () => {
    it('адміністратор бачить параметри без секретів', async () => {
      const r = await app.api('GET', '/api/admin/settings', { token: admin.token });
      assert.equal(r.status, 200);
      assert.equal(r.data.settings.maxBookingHours, 24);
      assert.equal(r.data.settings.jwtSecret, undefined);
      assert.equal(r.data.settings.llmApiKey, undefined);
      assert.equal(r.data.llmConfigured, false);
    });

    it('мешканцю недоступні (403)', async () => {
      assert.equal((await app.api('GET', '/api/admin/settings', { token: resident.token })).status, 403);
    });
  });

  describe('моніторинг активності', () => {
    it('адміністратор бачить лічильники користувачів, бронювань і заявок', async () => {
      const room = await app.createRoom();
      const inHours = (h) => new Date(Date.now() + h * 3600 * 1000);
      await app.createBooking({ room, user: resident, start: inHours(1), end: inHours(2) });
      const r = await app.api('GET', '/api/admin/stats', { token: admin.token });
      assert.equal(r.status, 200);
      assert.equal(r.data.users.total, await app.models.User.count());
      assert.ok(r.data.users.admin >= 1);
      assert.ok(r.data.bookings.created >= 1);
      assert.equal(typeof r.data.serviceRequests.new, 'number');
      assert.ok(r.data.last24h.actions >= 1);
    });

    it('показує останні перевищення лімітів, нові першими', async () => {
      const room = await app.createRoom();
      const violation = (resource, detectedAt) => app.models.LimitViolation.create({
        roomId: room.id, resource, limitValue: 20, actualValue: 30, detectedAt,
      });
      const older = await violation('water', new Date(Date.now() - 60 * 1000));
      const newer = await violation('temperature', new Date());
      const r = await app.api('GET', '/api/admin/stats', { token: admin.token });
      assert.deepEqual(r.data.recentViolations.slice(0, 2).map((v) => v.id), [newer.id, older.id]);
      assert.ok(r.data.recentViolations.length <= 5);
    });

    it('мешканцю недоступний (403)', async () => {
      assert.equal((await app.api('GET', '/api/admin/stats', { token: resident.token })).status, 403);
    });
  });
});

describe('сервісні заявки: статуси та фото', () => {
  let app; let admin; let resident; let other; let room;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    other = await app.createUser();
    room = await app.createRoom();
  });
  after(() => app.close());

  const createRequest = async () => (await app.api('POST', '/api/service-requests', {
    token: resident.token, body: { roomId: room.id, description: 'Не працює лампа' },
  })).data;

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const upload = (id, token, type = 'image/png', body = PNG) => app.api('POST', `/api/service-requests/${id}/photo`, {
    token, headers: { 'Content-Type': type }, rawBody: body,
  });

  it('повернення статусу resolved → in_progress заборонене (409)', async () => {
    const request = await createRequest();
    const url = `/api/service-requests/${request.id}`;
    await app.api('PUT', url, { token: admin.token, body: { status: 'resolved' } });
    const r = await app.api('PUT', url, { token: admin.token, body: { status: 'in_progress' } });
    assert.equal(r.status, 409);
  });

  it('автор завантажує фото, воно доступне за photoUrl', async () => {
    const request = await createRequest();
    const r = await upload(request.id, resident.token);
    assert.equal(r.status, 200);
    assert.match(r.data.photoUrl, /^\/uploads\/request-\d+-.+\.png$/);

    const photo = await fetch(app.base + r.data.photoUrl);
    assert.equal(photo.status, 200);
    assert.equal(Buffer.from(await photo.arrayBuffer()).length, PNG.length);
  });

  it('не зображення → 400', async () => {
    const request = await createRequest();
    assert.equal((await upload(request.id, resident.token, 'text/plain', 'hello')).status, 400);
  });

  it('фото до чужої заявки → 404', async () => {
    const request = await createRequest();
    assert.equal((await upload(request.id, other.token)).status, 404);
  });
});
