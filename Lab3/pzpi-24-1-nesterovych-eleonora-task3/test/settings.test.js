'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateSettings, listChanges, createSettingsService } = require('../src/services/settings');

const current = {
  port: 3000,
  minBookingHours: 1,
  maxBookingHours: 24,
  maxActiveBookingsPerUser: 2,
  measurementRetentionDays: 14,
  defaultTempMin: 18,
  defaultTempMax: 26,
  limitWarningRatio: 0.8,
  nightlyJobTime: '00:05',
  lightModePower: { off: 0, low: 1, medium: 2, high: 3 },
  llmModel: 'model',
  jwtSecret: 'secret',
};

const statusOf = (next) => {
  try {
    validateSettings(next, current);
  } catch (e) {
    return e.status;
  }
  return 200;
};

describe('validateSettings: перевірка системних параметрів', () => {
  it('приймає коректні значення', () => {
    assert.equal(statusOf({ maxBookingHours: 12, limitWarningRatio: 0.9, nightlyJobTime: '01:30' }), 200);
  });
  it('відхиляє невідомий параметр і неправильний тип (400)', () => {
    assert.equal(statusOf({ unknownKey: 1 }), 400);
    assert.equal(statusOf({ maxBookingHours: '24' }), 400);
    assert.equal(statusOf({ maxBookingHours: -1 }), 400);
  });
  it('відхиляє несумісні значення (400)', () => {
    assert.equal(statusOf({ minBookingHours: 30 }), 400);
    assert.equal(statusOf({ defaultTempMin: 30 }), 400);
    assert.equal(statusOf({ limitWarningRatio: 1.5 }), 400);
    assert.equal(statusOf({ nightlyJobTime: '25:00' }), 400);
    assert.equal(statusOf({ lightModePower: { off: 0, low: 1 } }), 400);
  });
});

describe('listChanges', () => {
  it('описує лише змінені параметри, зокрема вкладені об\'єкти', () => {
    const after = { ...current, maxBookingHours: 12, lightModePower: { off: 0, low: 1, medium: 2, high: 4 } };
    assert.equal(
      listChanges(current, after, ['maxBookingHours', 'lightModePower', 'llmModel']),
      'maxBookingHours: 24 -> 12; lightModePower: {"off":0,"low":1,"medium":2,"high":3} -> {"off":0,"low":1,"medium":2,"high":4}',
    );
  });
});

describe('createSettingsService: перечитування settings.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habicore-settings-'));
  const file = path.join(dir, 'settings.json');
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('застосовує нові значення без перезапуску, секрети й порт з файлу не змінюються', () => {
    const config = { ...current, settingsFile: file };
    fs.writeFileSync(file, JSON.stringify({ maxBookingHours: 12, port: 4000, jwtSecret: 'from-file' }));
    const { changes } = createSettingsService({ config }).reload();
    assert.equal(changes, 'maxBookingHours: 24 -> 12');
    assert.equal(config.maxBookingHours, 12);
    assert.equal(config.port, 3000);
    assert.equal(config.jwtSecret, 'secret');
  });

  it('некоректний файл відхиляється, поточні значення не змінюються', () => {
    const config = { ...current, settingsFile: file };
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => createSettingsService({ config }).reload(), { status: 400 });
    fs.writeFileSync(file, JSON.stringify({ maxBookingHours: 12, minBookingHours: 20 }));
    assert.throws(() => createSettingsService({ config }).reload(), { status: 400 });
    assert.equal(config.maxBookingHours, 24);
  });
});
