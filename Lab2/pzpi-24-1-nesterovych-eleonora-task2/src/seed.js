'use strict';

const bcrypt = require('bcryptjs');

// Додає початкові дані (адміністратор, мешканець і дві кімнати), якщо їх ще немає
async function seed(models) {
  const { User, Room } = models;

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@habicore.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  await User.findOrCreate({
    where: { email: adminEmail },
    defaults: {
      displayName: 'Адміністратор',
      role: 'admin',
      passwordHash: bcrypt.hashSync(adminPassword, 10),
    },
  });

  await User.findOrCreate({
    where: { email: 'resident@habicore.local' },
    defaults: {
      displayName: 'Мешканець',
      role: 'resident',
      passwordHash: bcrypt.hashSync('Resident123!', 10),
    },
  });

  await Room.findOrCreate({
    where: { name: 'Кімната 1' },
    defaults: {
      description: 'Кімната з ESP32',
      deviceKey: 'demo-device-key-room-1',
      qrToken: 'demo-qr-room-1',
    },
  });

  await Room.findOrCreate({
    where: { name: 'Кімната 2' },
    defaults: {
      description: 'Тестова кімната',
      deviceKey: 'demo-device-key-room-2',
      qrToken: 'demo-qr-room-2',
    },
  });
}

module.exports = { seed };

// Запуск напряму: npm run seed
if (require.main === module) {
  const config = require('./config');
  const fs = require('node:fs');
  const path = require('node:path');
  const { createSequelize } = require('./db');
  const { initModels } = require('./models');

  fs.mkdirSync(path.dirname(config.dbStorage), { recursive: true });

  const sequelize = createSequelize(config.dbStorage);
  const models = initModels(sequelize);

  sequelize.sync()
    .then(() => seed(models))
    .then(() => {
      console.log('Початкові дані додано');
      return sequelize.close();
    });
}
