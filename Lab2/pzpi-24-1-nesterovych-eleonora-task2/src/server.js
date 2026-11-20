'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { createSequelize } = require('./db');
const { initModels } = require('./models');
const { createApp } = require('./app');
const { seed } = require('./seed');

async function main() {
  // Для файлової БД потрібно, щоб папка існувала
  if (config.dbStorage !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbStorage), { recursive: true });
  }

  const sequelize = createSequelize(config.dbStorage);
  const models = initModels(sequelize);

  await sequelize.sync();
  await seed(models);

  const app = createApp(models, config);
  app.listen(config.port, () => {
    console.log(`HabiCore API: http://localhost:${config.port}/api`);
    console.log(`Документація: http://localhost:${config.port}/api-docs`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
