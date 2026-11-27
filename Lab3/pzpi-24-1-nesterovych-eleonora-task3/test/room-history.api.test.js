'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');

describe('графік ресурсної панелі: історія вимірювань кімнати', () => {
  let app; let resident; let room;
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000);

  before(async () => {
    app = await startTestApp();
    resident = await app.createUser();
    room = await app.createRoom();

    // Три вимірювання за останню годину й одне - понад добу тому
    const rows = [[30 * 60, 15], [50, 20], [45, 22], [5, 24]];
    for (const [minutes, temperature] of rows) {
      await app.models.Measurement.create({
        roomId: room.id, measuredAt: minutesAgo(minutes), waterLevel: 80, illuminance: 300, temperature,
      });
    }
  });
  after(() => app.close());

  const history = (query = '', id = room.id) => app.api('GET', `/api/rooms/${id}/history${query}`, {
    token: resident.token,
  });

  it('за замовчуванням повертає 24 години, зведені по 10 хвилин', async () => {
    const r = await history();
    assert.equal(r.status, 200);
    assert.equal(r.data.bucketMinutes, 10);
    assert.equal(r.data.items.reduce((sum, point) => sum + point.count, 0), 3);
    assert.ok(r.data.items.every((point) => point.temperature >= 20));
  });

  it('параметри hours і bucketMinutes задають період і крок графіка', async () => {
    const r = await history('?hours=1&bucketMinutes=60');
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 1);
    assert.equal(r.data.items[0].count, 3);
    assert.equal(r.data.items[0].temperature, 22);
  });

  it('некоректні параметри - 400, неіснуюча кімната - 404', async () => {
    assert.equal((await history('?hours=0')).status, 400);
    assert.equal((await history('?bucketMinutes=abc')).status, 400);
    assert.equal((await history('', 99999)).status, 404);
  });
});
