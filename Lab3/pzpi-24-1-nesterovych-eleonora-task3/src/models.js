'use strict';

const { DataTypes } = require('sequelize');
const { LIGHT_MODES } = require('./services/resources');

// Допоміжні функції для правил валідації полів
const isIn = (values) => ({ isIn: [values] });
const maxLen = (n) => ({ len: [0, n] });

// Описує всі таблиці бази даних та зв'язки між ними
function initModels(sequelize) {
  // ---------- Користувачі ----------
  const User = sequelize.define('User', {
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true, ...maxLen(255) },
    },
    passwordHash: { type: DataTypes.STRING(100), allowNull: false },
    displayName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true, ...maxLen(100) },
    },
    role: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'resident',
      validate: isIn(['resident', 'admin']),
    },
    isBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { tableName: 'users' });

  // Хеш пароля ніколи не повертається клієнту
  User.prototype.toJSON = function toJSON() {
    const values = { ...this.get() };
    delete values.passwordHash;
    return values;
  };

  // ---------- Кімнати ----------
  const Room = sequelize.define('Room', {
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: { notEmpty: true, ...maxLen(100) },
    },
    description: { type: DataTypes.STRING(500), allowNull: true, validate: maxLen(500) },
    waterLimit: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 100, validate: { min: 0 } },
    lightLimit: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 100, validate: { min: 0 } },
    tempMin: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 18 },
    tempMax: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 26 },
    deviceKey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
    },
    qrToken: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
    },
  }, {
    tableName: 'rooms',
    validate: {
      tempRange() {
        if (this.tempMin >= this.tempMax) {
          throw new Error('tempMin must be less than tempMax');
        }
      },
    },
  });

  // ---------- Бронювання ----------
  const Booking = sequelize.define('Booking', {
    startTime: { type: DataTypes.DATE, allowNull: false },
    endTime: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'created',
      validate: isIn(['created', 'active', 'completed', 'cancelled']),
    },
    cancelReason: { type: DataTypes.STRING(200), allowNull: true, validate: maxLen(200) },
    // Ресурси, використані за час бронювання (накопичуються під час обробки вимірювань)
    waterUsed: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    lightUsed: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0, validate: { min: 0 } },
  }, {
    tableName: 'bookings',
    indexes: [{ fields: ['roomId', 'startTime'] }, { fields: ['userId'] }],
  });

  // ---------- Вимірювання датчиків ----------
  const Measurement = sequelize.define('Measurement', {
    measuredAt: { type: DataTypes.DATE, allowNull: false },
    waterLevel: { type: DataTypes.FLOAT, allowNull: false, validate: { min: 0, max: 100 } },
    illuminance: { type: DataTypes.FLOAT, allowNull: false, validate: { min: 0, max: 100000 } },
    temperature: { type: DataTypes.FLOAT, allowNull: false, validate: { min: -50, max: 100 } },
    // Режим світла, увімкнений на пристрої в момент вимірювання
    lightMode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'off',
      validate: isIn(LIGHT_MODES),
    },
  }, {
    tableName: 'measurements',
    updatedAt: false,
    indexes: [
      { unique: true, fields: ['roomId', 'measuredAt'] },
      { fields: ['bookingId'] },
    ],
  });

  // ---------- Добові агрегати ----------
  const DailyAggregate = sequelize.define('DailyAggregate', {
    date: { type: DataTypes.DATEONLY, allowNull: false },
    tempMin: { type: DataTypes.FLOAT, allowNull: false },
    tempMax: { type: DataTypes.FLOAT, allowNull: false },
    tempAvg: { type: DataTypes.FLOAT, allowNull: false },
    lightMin: { type: DataTypes.FLOAT, allowNull: false },
    lightMax: { type: DataTypes.FLOAT, allowNull: false },
    lightAvg: { type: DataTypes.FLOAT, allowNull: false },
    waterUsed: { type: DataTypes.FLOAT, allowNull: false, validate: { min: 0 } },
    lightUsage: { type: DataTypes.FLOAT, allowNull: false, validate: { min: 0 } },
  }, {
    tableName: 'daily_aggregates',
    indexes: [{ unique: true, fields: ['roomId', 'date'] }],
  });

  // ---------- Перевищення лімітів ----------
  const LimitViolation = sequelize.define('LimitViolation', {
    resource: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: isIn(['water', 'light', 'temperature']),
    },
    limitValue: { type: DataTypes.FLOAT, allowNull: false },
    actualValue: { type: DataTypes.FLOAT, allowNull: false },
    detectedAt: { type: DataTypes.DATE, allowNull: false },
    explanation: { type: DataTypes.STRING(600), allowNull: true, validate: maxLen(600) },
    explanationSource: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: isIn(['llm', 'template']),
    },
  }, {
    tableName: 'limit_violations',
    indexes: [{ fields: ['roomId', 'detectedAt'] }],
  });

  // ---------- Огляди кімнат (заселення / виселення) ----------
  const Inspection = sequelize.define('Inspection', {
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: isIn(['checkin', 'checkout']),
    },
    state: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: isIn(['ok', 'issues']),
    },
    note: { type: DataTypes.STRING(500), allowNull: true, validate: maxLen(500) },
  }, {
    tableName: 'inspections',
    indexes: [{ unique: true, fields: ['bookingId', 'type'] }],
  });

  // ---------- Сервісні заявки ----------
  const ServiceRequest = sequelize.define('ServiceRequest', {
    description: {
      type: DataTypes.STRING(1000),
      allowNull: false,
      validate: { notEmpty: true, ...maxLen(1000) },
    },
    photoUrl: { type: DataTypes.STRING(500), allowNull: true, validate: maxLen(500) },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'new',
      validate: isIn(['new', 'in_progress', 'resolved']),
    },
    adminComment: { type: DataTypes.STRING(500), allowNull: true, validate: maxLen(500) },
  }, { tableName: 'service_requests' });

  // ---------- Журнал дій ----------
  const ActionLog = sequelize.define('ActionLog', {
    action: { type: DataTypes.STRING(50), allowNull: false },
    entity: { type: DataTypes.STRING(50), allowNull: false },
    entityId: { type: DataTypes.INTEGER, allowNull: true },
    details: { type: DataTypes.STRING(500), allowNull: true },
  }, { tableName: 'action_logs', updatedAt: false });

  // ---------- Зв'язки між таблицями ----------
  // Parent має багато Child; foreignKey - поле в Child, onDelete - що робити при видаленні Parent
  const link = (Parent, Child, foreignKeyName, allowNull, onDelete) => {
    const foreignKey = { name: foreignKeyName, allowNull };
    Parent.hasMany(Child, { foreignKey, onDelete });
    Child.belongsTo(Parent, { foreignKey, onDelete });
  };

  link(User, Booking, 'userId', false, 'RESTRICT');
  link(Room, Booking, 'roomId', false, 'RESTRICT');
  link(Room, Measurement, 'roomId', false, 'CASCADE');
  link(Booking, Measurement, 'bookingId', true, 'SET NULL');
  link(Room, DailyAggregate, 'roomId', false, 'CASCADE');
  link(Room, LimitViolation, 'roomId', false, 'CASCADE');
  link(Booking, LimitViolation, 'bookingId', true, 'SET NULL');
  link(Booking, Inspection, 'bookingId', false, 'CASCADE');
  link(User, ServiceRequest, 'userId', false, 'RESTRICT');
  link(Room, ServiceRequest, 'roomId', false, 'RESTRICT');
  link(User, ActionLog, 'userId', true, 'SET NULL');

  return {
    User, Room, Booking, Measurement, DailyAggregate,
    LimitViolation, Inspection, ServiceRequest, ActionLog,
  };
}

module.exports = { initModels };
