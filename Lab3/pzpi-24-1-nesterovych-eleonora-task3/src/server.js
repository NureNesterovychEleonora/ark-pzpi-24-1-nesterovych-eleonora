'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { createSequelize } = require('./db');
const { initModels } = require('./models');
const { createApp } = require('./app');
const { createActionLogger } = require('./logger');
const { startScheduler } = require('./services/scheduler');
const { seed } = require('./seed');

// sync() не додає нові стовпці до вже створених таблиць.
// Якщо файл БД створено попередньою версією, його потрібно створити заново.
async function checkSchemaIsCurrent(sequelize) {
  const queryInterface = sequelize.getQueryInterface();
  const bookings = await queryInterface.describeTable('bookings');
  const measurements = await queryInterface.describeTable('measurements');

  if (!bookings.waterUsed || !measurements.lightMode) {
    throw new Error('Структура БД застаріла. Виконайте "npm run db:reset" і запустіть сервер знову.');
  }
}

// Зміни у settings.json застосовуються без перезапуску сервера.
// Некоректний файл не застосовується, сервер працює з попередніми значеннями.
function watchSettingsFile({ services, log }) {
  fs.watchFile(config.settingsFile, { interval: 2000 }, () => {
    try {
      const { changes } = services.settings.reload();
      if (changes) {
        console.log(`Системні параметри оновлено: ${changes}`);
        log({}, 'reload_settings', 'Settings', null, changes)
          .catch((err) => console.error('Action log error:', err.message));
      }
    } catch (err) {
      console.error(`settings.json не застосовано: ${err.message}`);
    }
  });
}

async function main() {
  // Для файлової БД потрібно, щоб папка існувала
  if (config.dbStorage !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbStorage), { recursive: true });
  }

  const sequelize = createSequelize(config.dbStorage);
  const models = initModels(sequelize);

  await sequelize.sync();
  await checkSchemaIsCurrent(sequelize);
  await seed(models);

  const app = createApp(models, config);
  app.listen(config.port, () => {
    console.log(`HabiCore API: http://localhost:${config.port}/api`);
    console.log(`Документація: http://localhost:${config.port}/api-docs`);
    console.log(`LLM-пояснення: ${config.llmApiKey ? config.llmModel : 'вимкнено, використовується шаблон'}`);
  });

  const log = createActionLogger(models);

  // Фонові завдання: статуси бронювань, нічний розрахунок агрегатів і очищення архіву
  startScheduler({ services: app.locals.services, config, log });
  watchSettingsFile({ services: app.locals.services, log });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
