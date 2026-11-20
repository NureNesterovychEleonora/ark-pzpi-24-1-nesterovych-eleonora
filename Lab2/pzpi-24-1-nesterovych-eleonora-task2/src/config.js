'use strict';

// Налаштування застосунку. Значення беруться зі змінних оточення,
// а якщо їх немає - використовуються значення за замовчуванням.
module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbStorage: process.env.DB_STORAGE || './data/habicore.sqlite',
  timeZone: process.env.TIME_ZONE || 'Europe/Kyiv',
  maxBookingHours: 24,
};
