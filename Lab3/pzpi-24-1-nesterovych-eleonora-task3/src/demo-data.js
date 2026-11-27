'use strict';

// Підготовлені тестові дані для кімнати 2: вимірювання за два попередні дні
// з кроком 10 хвилин. Запуск: npm run demo-data (після першого запуску сервера).
const config = require('./config');
const { createSequelize } = require('./db');
const { initModels } = require('./models');
const { dayRange, localDateTime, previousDate } = require('./utils');

const STEP_MINUTES = 10;
const DAYS = 2;

// Значення одного вимірювання залежно від хвилини доби (без випадковості, щоб дані повторювалися)
function sampleFor(minuteOfDay) {
  const hour = minuteOfDay / 60;
  const isDay = hour >= 7 && hour < 23;
  const lightMode = hour >= 19 && hour < 23 ? 'medium' : (isDay ? 'low' : 'off');

  return {
    // Ємність поступово спорожнюється вдень і поповнюється о 06:00
    waterLevel: hour < 6 ? 95 : Math.max(20, 95 - (hour - 6) * 3.5),
    illuminance: isDay ? 250 + 150 * Math.sin(((hour - 7) / 16) * Math.PI) : 5,
    temperature: Math.round((21.5 + 2.5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)) * 10) / 10,
    lightMode,
  };
}

async function main() {
  const sequelize = createSequelize(config.dbStorage);
  const models = initModels(sequelize);
  await sequelize.sync();

  const room = await models.Room.findOne({ where: { name: 'Кімната 2' } });
  if (!room) {
    throw new Error('Кімната 2 не знайдена: спочатку запустіть сервер (npm start)');
  }

  let date = localDateTime(new Date(), config.timeZone).date;
  const rows = [];
  for (let day = 0; day < DAYS; day += 1) {
    date = previousDate(date);
    const { from } = dayRange(date, config.timeZone);

    for (let minute = 0; minute < 24 * 60; minute += STEP_MINUTES) {
      rows.push({
        roomId: room.id,
        measuredAt: new Date(from.getTime() + minute * 60 * 1000),
        ...sampleFor(minute),
      });
    }
  }

  await models.Measurement.bulkCreate(rows, { ignoreDuplicates: true });
  console.log(`Додано до ${rows.length} вимірювань для кімнати "${room.name}"`);
  console.log('Агрегати: POST /api/daily-aggregates/calculate з датою одного з двох попередніх днів');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
