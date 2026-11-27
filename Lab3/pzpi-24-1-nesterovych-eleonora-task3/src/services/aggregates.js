'use strict';

const { Op } = require('sequelize');
const { HttpError } = require('../middleware/errors');
const { dayRange, localDateTime, previousDate, shiftDate } = require('../utils');
const { computeDailyAggregate } = require('./resources');

// Пакетна обробка: розрахунок добових агрегатів для кожної кімнати
// та зберігання архіву сирих вимірювань протягом measurementRetentionDays діб
function createAggregateService({ models, config }) {
  const { Room, Measurement, DailyAggregate } = models;

  const today = (now = new Date()) => localDateTime(now, config.timeZone).date;

  // Найраніша дата, за яку ще зберігаються сирі вимірювання
  const retentionStartDate = (todayDate) => shiftDate(todayDate, -config.measurementRetentionDays);

  // Розраховує (або перераховує) агрегати за дату YYYY-MM-DD за київським часом
  async function calculateForDate(date) {
    const { from, to } = dayRange(date, config.timeZone);
    const rooms = await Room.findAll({ order: [['id', 'ASC']] });
    const results = [];

    for (const room of rooms) {
      const measurements = await Measurement.findAll({
        where: { roomId: room.id, measuredAt: { [Op.gte]: from, [Op.lt]: to } },
        order: [['measuredAt', 'ASC']],
      });

      const values = computeDailyAggregate(measurements, config);
      if (!values) {
        continue;
      }

      const [aggregate, isCreated] = await DailyAggregate.findOrCreate({
        where: { roomId: room.id, date },
        defaults: values,
      });
      if (!isCreated) {
        await aggregate.update(values);
      }
      results.push(aggregate);
    }

    return results;
  }

  // Повторний розрахунок можливий лише за дати, сирі вимірювання яких ще зберігаються
  function checkDateInRetention(date, now = new Date()) {
    const startDate = retentionStartDate(today(now));
    if (date < startDate) {
      throw new HttpError(
        400,
        `Raw measurements are kept for ${config.measurementRetentionDays} days; the date must not be earlier than ${startDate}`,
      );
    }
  }

  // Видаляє сирі вимірювання, старші за період зберігання (агрегати зберігаються без обмеження)
  async function purgeOldMeasurements(now = new Date()) {
    const { from } = dayRange(retentionStartDate(today(now)), config.timeZone);
    return Measurement.destroy({ where: { measuredAt: { [Op.lt]: from } } });
  }

  // Нічне завдання: агрегати за попередню добу, дорахунок дат, пропущених,
  // поки сервер був вимкнений (якщо вимірювання ще зберігаються), і очищення архіву
  async function runNightly(now = new Date()) {
    const yesterday = previousDate(today(now));
    const calculated = [];

    for (let date = retentionStartDate(today(now)); date <= yesterday; date = shiftDate(date, 1)) {
      const isMissing = await DailyAggregate.count({ where: { date } }) === 0;
      if (date === yesterday || isMissing) {
        const items = await calculateForDate(date);
        if (date === yesterday || items.length > 0) {
          calculated.push({ date, rooms: items.length });
        }
      }
    }

    const purged = await purgeOldMeasurements(now);
    return { calculated, purged };
  }

  return { calculateForDate, checkDateInRetention, purgeOldMeasurements, runNightly };
}

module.exports = { createAggregateService };
