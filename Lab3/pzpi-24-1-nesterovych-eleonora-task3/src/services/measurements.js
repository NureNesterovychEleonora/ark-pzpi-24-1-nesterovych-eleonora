'use strict';

const { Op } = require('sequelize');
const { HttpError } = require('../middleware/errors');
const { parseDate, requireNumber, Mutex } = require('../utils');
const resources = require('./resources');

// Потокова обробка вимірювань: перевірка, збереження в архів,
// облік витрати активного бронювання, виявлення перевищень.
function createMeasurementService({ models, config, explainer }) {
  const { Booking, Measurement, LimitViolation } = models;

  // Вимірювання обробляються по черзі, щоб витрата бронювання не губилася
  const lock = new Mutex();

  const findActiveBooking = (roomId, at) => Booking.findOne({
    where: {
      roomId,
      status: 'active',
      startTime: { [Op.lte]: at },
      endTime: { [Op.gte]: at },
    },
  });

  // Попереднє вимірювання кімнати (потрібне для розрахунку витрати та переходів температури)
  const findPrevious = (roomId, at) => Measurement.findOne({
    where: { roomId, measuredAt: { [Op.lt]: at } },
    order: [['measuredAt', 'DESC']],
  });

  const parseInput = (body) => {
    const lightMode = body.lightMode === undefined ? 'off' : body.lightMode;
    if (!resources.LIGHT_MODES.includes(lightMode)) {
      throw new HttpError(400, `Field "lightMode" must be one of: ${resources.LIGHT_MODES.join(', ')}`);
    }

    return {
      measuredAt: body.measuredAt ? parseDate(body.measuredAt, 'measuredAt') : new Date(),
      waterLevel: requireNumber(body.waterLevel, 'waterLevel'),
      illuminance: requireNumber(body.illuminance, 'illuminance'),
      temperature: requireNumber(body.temperature, 'temperature'),
      lightMode,
    };
  };

  // Відповідь для пристрою: ліміти, стан індикації та дозволені режими світла
  const describeRoomState = (room, booking, temperature) => {
    const usage = booking ? { water: booking.waterUsed, light: booking.lightUsed } : null;
    const warningRatio = config.limitWarningRatio;

    return {
      limits: {
        waterLimit: room.waterLimit,
        lightLimit: room.lightLimit,
        tempMin: room.tempMin,
        tempMax: room.tempMax,
      },
      activeBookingId: booking ? booking.id : null,
      usage: booking ? resources.limitUsage(room, booking) : null,
      state: resources.evaluateState({ room, usage, temperature, warningRatio }),
      allowedLightModes: resources.allowedLightModes({ room, usage, warningRatio }),
    };
  };

  async function processMeasurement(room, body) {
    const input = parseInput(body || {});

    const result = await lock.run(async () => {
      const booking = await findActiveBooking(room.id, input.measuredAt);
      const prev = await findPrevious(room.id, input.measuredAt);

      const measurement = await Measurement.create({
        roomId: room.id,
        bookingId: booking ? booking.id : null,
        ...input,
      });

      // Витрата рахується лише між вимірюваннями одного бронювання
      let usageBefore = null;
      let usageAfter = null;
      if (booking) {
        const prevInBooking = prev && prev.bookingId === booking.id ? prev : null;
        const delta = resources.usageBetween(prevInBooking, measurement, config);

        usageBefore = { water: booking.waterUsed, light: booking.lightUsed };
        usageAfter = {
          water: resources.round(usageBefore.water + delta.water),
          light: resources.round(usageBefore.light + delta.light),
        };
        await booking.update({ waterUsed: usageAfter.water, lightUsed: usageAfter.light });
      }

      const found = resources.detectViolations({
        room, prev, curr: measurement, usageBefore, usageAfter,
      });

      const violations = [];
      for (const violation of found) {
        violations.push(await LimitViolation.create({
          roomId: room.id,
          bookingId: booking ? booking.id : null,
          detectedAt: measurement.measuredAt,
          ...violation,
        }));
      }

      return { measurement, booking, violations };
    });

    // Подія вже збережена й видна в панелі, пояснення додається у фоні
    for (const violation of result.violations) {
      explainer.explain(violation.id).catch((err) => {
        console.error(`Explanation for violation ${violation.id} failed: ${err.message}`);
      });
    }

    // Поля вимірювання залишаються на верхньому рівні (як у попередній версії API)
    return {
      ...result.measurement.toJSON(),
      violations: result.violations.map((v) => ({
        id: v.id, resource: v.resource, limitValue: v.limitValue, actualValue: v.actualValue,
      })),
      ...describeRoomState(room, result.booking, input.temperature),
    };
  }

  // Поточний стан ресурсів кімнати для ресурсної панелі та Android-застосунку
  async function getRoomResources(room) {
    const lastMeasurement = await Measurement.findOne({
      where: { roomId: room.id },
      order: [['measuredAt', 'DESC']],
    });
    const booking = await Booking.findOne({ where: { roomId: room.id, status: 'active' } });
    const temperature = lastMeasurement ? lastMeasurement.temperature : null;

    return {
      roomId: room.id,
      lastMeasurement,
      ...describeRoomState(room, booking, temperature),
    };
  }

  // Історія вимірювань кімнати за останні hours годин, зведена в проміжки
  // по bucketMinutes хвилин (графік ресурсної панелі, за замовчуванням 24 години)
  async function getRoomHistory(room, { hours, bucketMinutes, now = new Date() }) {
    const to = now;
    const from = new Date(now.getTime() - hours * 3600 * 1000);

    const measurements = await Measurement.findAll({
      attributes: ['measuredAt', 'waterLevel', 'illuminance', 'temperature', 'lightMode'],
      where: { roomId: room.id, measuredAt: { [Op.gte]: from, [Op.lte]: to } },
      order: [['measuredAt', 'ASC']],
    });

    return {
      roomId: room.id,
      from,
      to,
      bucketMinutes,
      items: resources.bucketMeasurements(measurements, from.getTime(), bucketMinutes),
    };
  }

  return { processMeasurement, getRoomResources, getRoomHistory };
}

module.exports = { createMeasurementService };
