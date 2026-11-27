'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestApp } = require('../testkit/harness');

describe('застосування системних параметрів без перезапуску', () => {
  let app; let admin; let resident; let dir; let file;
  before(async () => {
    // Тест працює з тимчасовою копією settings.json, справжній файл не змінюється
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habicore-settings-'));
    file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ maxBookingHours: 24 }));
    app = await startTestApp({ settingsFile: file });
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const reload = (token = admin.token) => app.api('POST', '/api/admin/settings/reload', { token });

  it('змінений параметр діє одразу й записується в журнал', async () => {
    fs.writeFileSync(file, JSON.stringify({ maxBookingHours: 2 }));
    const r = await reload();
    assert.equal(r.status, 200);
    assert.equal(r.data.changes, 'maxBookingHours: 24 -> 2');
    assert.equal(r.data.settings.maxBookingHours, 2);

    // Бронювання на 3 години тепер перевищує максимальну тривалість
    const room = await app.createRoom();
    const start = new Date(Date.now() + 2 * 3600 * 1000);
    const end = new Date(start.getTime() + 3 * 3600 * 1000);
    const booking = await app.api('POST', '/api/bookings', {
      token: resident.token,
      body: { roomId: room.id, startTime: start.toISOString(), endTime: end.toISOString() },
    });
    assert.equal(booking.status, 400);

    const entry = await app.models.ActionLog.findOne({ where: { action: 'reload_settings' } });
    assert.equal(entry.details, 'maxBookingHours: 24 -> 2');
    assert.equal(entry.userId, admin.user.id);
  });

  it('некоректний файл відхиляється (400), параметри не змінюються', async () => {
    fs.writeFileSync(file, JSON.stringify({ maxBookingHours: 'багато' }));
    assert.equal((await reload()).status, 400);
    fs.writeFileSync(file, '{ not json');
    assert.equal((await reload()).status, 400);

    const r = await app.api('GET', '/api/admin/settings', { token: admin.token });
    assert.equal(r.data.settings.maxBookingHours, 2);
  });

  it('мешканцю недоступно (403)', async () => {
    assert.equal((await reload(resident.token)).status, 403);
  });
});
