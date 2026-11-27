'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');

describe('пакетний розрахунок добових агрегатів', () => {
  let app; let admin; let resident; let room;
  before(async () => {
    app = await startTestApp();
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
    room = await app.createRoom();

    // 10 березня 2030 за Києвом (UTC+2): три вимірювання вдень і одне наступної доби
    const rows = [
      ['2030-03-10T08:00:00Z', 90, 100, 20, 'high'],
      ['2030-03-10T08:05:00Z', 80, 300, 24, 'off'],
      ['2030-03-10T08:10:00Z', 85, 200, 22, 'off'],
      ['2030-03-10T22:30:00Z', 10, 0, 30, 'off'],
    ];
    for (const [measuredAt, waterLevel, illuminance, temperature, lightMode] of rows) {
      await app.models.Measurement.create({
        roomId: room.id, measuredAt, waterLevel, illuminance, temperature, lightMode,
      });
    }
  });
  after(() => app.close());

  const calculate = (date, token = admin.token) => app.api('POST', '/api/daily-aggregates/calculate', {
    token, body: { date },
  });

  it('рахує агрегат за добу за київським часом', async () => {
    const r = await calculate('2030-03-10');
    assert.equal(r.status, 200);
    const item = r.data.items.find((a) => a.roomId === room.id);
    assert.equal(item.date, '2030-03-10');
    assert.equal(item.tempMin, 20);
    assert.equal(item.tempMax, 24);
    assert.equal(item.lightAvg, 200);
    assert.equal(item.waterUsed, 10);
    assert.equal(item.lightUsage, 0.25);
  });

  it('повторний розрахунок оновлює запис, а не створює новий', async () => {
    await app.models.Measurement.create({
      roomId: room.id, measuredAt: '2030-03-10T09:00:00Z', waterLevel: 70, illuminance: 200, temperature: 25,
    });
    const r = await calculate('2030-03-10');
    const item = r.data.items.find((a) => a.roomId === room.id);
    assert.equal(item.tempMax, 25);
    assert.equal(await app.models.DailyAggregate.count({ where: { roomId: room.id, date: '2030-03-10' } }), 1);
  });

  it('агрегат доступний через GET /api/daily-aggregates', async () => {
    const r = await app.api('GET', `/api/daily-aggregates?roomId=${room.id}&date=2030-03-10`, { token: resident.token });
    assert.equal(r.data.total, 1);
  });

  it('розрахунок записується в журнал дій', async () => {
    const entry = await app.models.ActionLog.findOne({ where: { action: 'calculate_aggregates' } });
    assert.ok(entry);
  });

  it('мешканцю недоступно (403), некоректна дата → 400', async () => {
    assert.equal((await calculate('2030-03-10', resident.token)).status, 403);
    assert.equal((await calculate('10.03.2030')).status, 400);
  });
});
