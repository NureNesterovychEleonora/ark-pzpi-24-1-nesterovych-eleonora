'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createSequelize } = require('../src/db');
const { initModels } = require('../src/models');

const T = (day, hour = 0) => new Date(Date.UTC(2030, 0, day, hour));
const isValidation = (e) => e.name === 'SequelizeValidationError';
const isUnique = (e) => e.name === 'SequelizeUniqueConstraintError';
const isFk = (e) => e.name === 'SequelizeForeignKeyConstraintError';

describe('моделі даних (ORM) та обмеження БД', () => {
  let sequelize; let m; let seq = 0;
  const uid = () => { seq += 1; return seq; };
  before(async () => {
    sequelize = createSequelize(':memory:');
    m = initModels(sequelize);
    await sequelize.sync();
  });
  after(() => sequelize.close());

  const user = (extra = {}) => m.User.create({ email: `u${uid()}@test.local`, displayName: 'Ім’я', passwordHash: 'hash', ...extra });
  const room = (extra = {}) => m.Room.create({ name: `Кімната ${uid()}`, ...extra });
  const booking = async (extra = {}) => {
    const u = await user(); const r = await room();
    return m.Booking.create({ userId: u.id, roomId: r.id, startTime: T(1, 10), endTime: T(1, 12), ...extra });
  };

  describe('User', () => {
    it('роль за замовчуванням — resident', async () => assert.equal((await user()).role, 'resident'));
    it('toJSON не містить passwordHash', async () => assert.equal((await user()).toJSON().passwordHash, undefined));
  });

  describe('Room', () => {
    it('відхиляє tempMin >= tempMax', async () => assert.rejects(room({ tempMin: 26, tempMax: 18 }), isValidation));
  });

  describe('Booking', () => {
    it('відхиляє неіснуючу кімнату (зовнішній ключ)', async () => {
      const u = await user();
      await assert.rejects(m.Booking.create({ userId: u.id, roomId: 99999, startTime: T(1), endTime: T(2) }), isFk);
    });
  });

  describe('Measurement', () => {
    const meas = (roomId, extra = {}) => m.Measurement.create({
      roomId, measuredAt: T(1, 10), waterLevel: 50, illuminance: 100, temperature: 20, ...extra,
    });
    it('пара (кімната, час) унікальна', async () => {
      const r = await room();
      await meas(r.id);
      await assert.rejects(meas(r.id), isUnique);
    });
    it('після видалення бронювання bookingId стає null', async () => {
      const b = await booking();
      const x = await meas(b.roomId, { bookingId: b.id });
      await b.destroy();
      await x.reload();
      assert.equal(x.bookingId, null);
    });
  });
});
