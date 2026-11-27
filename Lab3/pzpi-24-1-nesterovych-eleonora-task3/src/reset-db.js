'use strict';

// Видаляє файл БД, щоб під час наступного запуску схема створилася заново.
// Потрібно після зміни структури таблиць. Запуск: npm run db:reset
const fs = require('node:fs');
const config = require('./config');

if (config.dbStorage === ':memory:') {
  console.log('БД зберігається в пам\'яті, видаляти нічого не потрібно');
} else {
  fs.rmSync(config.dbStorage, { force: true });
  console.log(`Файл БД видалено: ${config.dbStorage}`);
}
