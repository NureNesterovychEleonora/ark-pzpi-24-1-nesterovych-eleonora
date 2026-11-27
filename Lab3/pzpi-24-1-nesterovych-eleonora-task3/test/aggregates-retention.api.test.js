'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');

describe('нічне завдання: пропущені дати та період зберігання вимірювань', () => {
  let app; let admin; let room;
  // "Зараз" для нічного завдання: 20 березня 2030, 10:00 за Києвом (UTC+2).
  // Період зберігання 14 діб, тож найраніша збережена дата - 6 березня.
  const now = new Date('2030-03-20T08:00:00Z');

  before(async () => {
    app = await startTestApp({ measurementRetentionDays: 14 });
    admin = await app.createUser({ role: 'admin' });
    room = await app.createRoom();

    const times = [
      '2030-03-01T10:00:00Z', // старіше за період зберігання
      '2030-03-10T10:00:00Z', '2030-03-10T11:00:00Z', // доба, пропущена, поки сервер був вимкнений
      '2030-03-19T10:00:00Z', '2030-03-19T11:00:00Z', // попередня доба
    ];
    for (const measuredAt of times) {
      await app.models.Measurement.create({
        roomId: room.id, measuredAt, waterLevel: 80, illuminance: 300, temperature: 22,
      });
    }
  });
  after(() => app.close());

  it('рахує попередню добу, дораховує пропущену дату й видаляє застарілі вимірювання', async () => {
    const result = await app.services.aggregates.runNightly(now);
    assert.deepEqual(result.calculated, [
      { date: '2030-03-10', rooms: 1 },
      { date: '2030-03-19', rooms: 1 },
    ]);
    assert.equal(result.purged, 1);
    assert.equal(await app.models.Measurement.count({ where: { roomId: room.id } }), 4);
    assert.equal(await app.models.DailyAggregate.count({ where: { roomId: room.id } }), 2);
  });

  it('повторний запуск перераховує лише попередню добу без дублювання', async () => {
    const result = await app.services.aggregates.runNightly(now);
    assert.deepEqual(result.calculated, [{ date: '2030-03-19', rooms: 1 }]);
    assert.equal(result.purged, 0);
    assert.equal(await app.models.DailyAggregate.count({ where: { roomId: room.id } }), 2);
  });

  it('звіт агрегатів за обраний період from..to', async () => {
    const url = `/api/daily-aggregates?roomId=${room.id}&from=2030-03-01&to=2030-03-15`;
    const r = await app.api('GET', url, { token: admin.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((a) => a.date), ['2030-03-10']);

    const bad = await app.api('GET', '/api/daily-aggregates?from=10.03.2030', { token: admin.token });
    assert.equal(bad.status, 400);
  });

  it('ручний розрахунок за дату поза періодом зберігання відхиляється (400)', async () => {
    const r = await app.api('POST', '/api/daily-aggregates/calculate', {
      token: admin.token, body: { date: '2020-01-01' },
    });
    assert.equal(r.status, 400);
  });
});
