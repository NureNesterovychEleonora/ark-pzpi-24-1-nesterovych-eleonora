'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startTestApp } = require('../testkit/harness');

describe('автентифікація: реєстрація, вхід, профіль', () => {
  let app;
  before(async () => { app = await startTestApp(); });
  after(() => app.close());

  const reg = (body) => app.api('POST', '/api/auth/register', { body });
  const valid = () => ({ email: `${app.unique('reg')}@test.local`, password: 'secret1', displayName: 'Мешканець' });

  describe('реєстрація', () => {
    it('створює мешканця й повертає 201', async () => {
      const r = await reg(valid());
      assert.equal(r.status, 201);
      assert.equal(r.data.role, 'resident');
      assert.equal(r.data.isBlocked, false);
      assert.ok(r.data.id);
    });
    it('ігнорує спробу вказати роль admin', async () => {
      const r = await reg({ ...valid(), role: 'admin' });
      assert.equal(r.status, 201);
      assert.equal(r.data.role, 'resident');
    });
    it('відхиляє повторну електронну адресу (409)', async () => {
      const body = valid();
      assert.equal((await reg(body)).status, 201);
      assert.equal((await reg(body)).status, 409);
    });
  });

  describe('вхід', () => {
    it('повертає токен і користувача', async () => {
      const body = valid();
      await reg(body);
      const r = await app.api('POST', '/api/auth/login', { body: { email: body.email, password: body.password } });
      assert.equal(r.status, 200);
      assert.ok(r.data.token);
      assert.equal(r.data.user.email, body.email);
      assert.equal(r.data.user.passwordHash, undefined);
    });
    it('забороняє вхід заблокованому користувачеві (403)', async () => {
      const u = await app.createUser({ isBlocked: true });
      const r = await app.api('POST', '/api/auth/login', { body: { email: u.user.email, password: u.password } });
      assert.equal(r.status, 403);
    });
  });

  describe('профіль (GET /api/auth/me)', () => {
    it('токен, підписаний іншим секретом → 401', async () => {
      const u = await app.createUser();
      const forged = jwt.sign({ sub: u.user.id, role: 'admin' }, 'other-secret');
      assert.equal((await app.api('GET', '/api/auth/me', { token: forged })).status, 401);
    });
    it('прострочений токен → 401', async () => {
      const u = await app.createUser();
      const expired = jwt.sign({ sub: u.user.id, exp: Math.floor(Date.now() / 1000) - 60 }, app.config.jwtSecret);
      const r = await app.api('GET', '/api/auth/me', { token: expired });
      assert.equal(r.status, 401);
    });
  });
});
