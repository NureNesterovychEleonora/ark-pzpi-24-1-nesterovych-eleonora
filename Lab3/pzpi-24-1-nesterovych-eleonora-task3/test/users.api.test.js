'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, T } = require('../testkit/harness');

describe('керування користувачами (адміністратор)', () => {
  let app; let admin; let resident;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(() => app.close());

  const newBody = (extra = {}) => ({
    email: `${app.unique('new')}@test.local`, displayName: 'Новий', role: 'resident', password: 'secret1', ...extra,
  });
  const create = (body, token = admin.token) => app.api('POST', '/api/users', { body, token });

  describe('права доступу', () => {
    it('список для мешканця → 403', async () => assert.equal((await app.api('GET', '/api/users', { token: resident.token })).status, 403));
  });

  describe('читання', () => {
    it('фільтр isBlocked=true повертає лише заблокованих', async () => {
      const blocked = await app.createUser({ isBlocked: true });
      const r = await app.api('GET', '/api/users?isBlocked=true', { token: admin.token });
      assert.ok(r.data.items.some((u) => u.id === blocked.user.id));
      assert.ok(r.data.items.every((u) => u.isBlocked === true));
    });
  });

  describe('створення', () => {
    it('створює користувача з роллю (201)', async () => {
      const r = await create(newBody({ role: 'admin' }));
      assert.equal(r.status, 201);
      assert.equal(r.data.role, 'admin');
      assert.equal(r.data.passwordHash, undefined);
      assert.equal(r.data.password, undefined);
    });
  });

  describe('зміна', () => {
    const put = (id, body) => app.api('PUT', `/api/users/${id}`, { token: admin.token, body });

    it('блокування забороняє вхід і чинний токен', async () => {
      const u = await app.createUser();
      const r = await put(u.user.id, { isBlocked: true });
      assert.equal(r.data.isBlocked, true);
      assert.equal((await app.api('GET', '/api/auth/me', { token: u.token })).status, 403);
      const login = await app.api('POST', '/api/auth/login', { body: { email: u.user.email, password: u.password } });
      assert.equal(login.status, 403);
    });
    it('зміна пароля: старий не діє, новий діє', async () => {
      const u = await app.createUser();
      assert.equal((await put(u.user.id, { password: 'NewPass99' })).status, 200);
      const oldLogin = await app.api('POST', '/api/auth/login', { body: { email: u.user.email, password: u.password } });
      const newLogin = await app.api('POST', '/api/auth/login', { body: { email: u.user.email, password: 'NewPass99' } });
      assert.equal(oldLogin.status, 401);
      assert.equal(newLogin.status, 200);
    });
  });

  describe('видалення', () => {
    it('не видаляє користувача, що має бронювання (409)', async () => {
      const u = await app.createUser();
      const room = await app.createRoom();
      await app.createBooking({ room, user: u, start: T(6, 1, 10), end: T(6, 1, 12) });
      assert.equal((await app.api('DELETE', `/api/users/${u.user.id}`, { token: admin.token })).status, 409);
    });
  });
});
