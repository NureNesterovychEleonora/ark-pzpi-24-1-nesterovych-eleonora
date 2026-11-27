'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const ex = require('../src/services/explanations');

const room = { id: 1, name: 'Кімната 1', tempMin: 18, tempMax: 26 };
const booking = { id: 7, waterUsed: 21, lightUsed: 0.3 };
const violation = (extra = {}) => ({
  id: 3, roomId: 1, bookingId: 7, resource: 'water', limitValue: 20, actualValue: 21,
  detectedAt: new Date('2030-01-01T10:00:00Z'), ...extra,
});

// Замінники моделей: пояснення зберігається у звичайний об'єкт
function fakeModels(record) {
  record.update = async (values) => Object.assign(record, values);
  return {
    LimitViolation: { findByPk: async () => record },
    Room: { findByPk: async () => room },
    Booking: { findByPk: async () => booking },
    Measurement: { findOne: async () => ({ lightMode: 'high' }) },
  };
}

const geminiAnswer = (text) => async () => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

const baseConfig = {
  timeZone: 'Europe/Kyiv', llmApiKey: 'test-key', llmModel: 'test-model', llmTimeoutMs: 1000, llmDailyLimit: 2,
};

describe('опис події для LLM', () => {
  it('не містить персональних даних, лише ідентифікатор бронювання', () => {
    const event = ex.buildEventDescription(violation(), room, booking);
    assert.equal(event.bookingId, 7);
    assert.equal(event.room, 'Кімната 1');
    assert.equal(JSON.stringify(event).includes('@'), false);
  });
  it('містить режим світла в момент виявлення', () => {
    assert.equal(ex.buildEventDescription(violation(), room, booking, 'high').lightMode, 'high');
    assert.equal(ex.buildEventDescription(violation(), room, booking).lightMode, null);
  });
});

describe('шаблонне пояснення', () => {
  for (const resource of ['water', 'light', 'temperature']) {
    it(`для ресурсу ${resource} - коректний текст до 600 символів`, () => {
      const v = violation(resource === 'temperature' ? { resource, limitValue: 26, actualValue: 28 } : { resource });
      const text = ex.templateExplanation(ex.buildEventDescription(v, { ...room, name: 'К'.repeat(100) }, booking));
      assert.ok(ex.isValidExplanation(text));
      assert.match(text, /Порада/);
    });
  }
});

describe('isValidExplanation', () => {
  it('відхиляє порожній і задовгий текст', () => {
    assert.equal(ex.isValidExplanation('   '), false);
    assert.equal(ex.isValidExplanation('а'.repeat(601)), false);
    assert.equal(ex.isValidExplanation(null), false);
  });
});

describe('createExplainer', () => {
  let originalWarn;
  beforeEach(() => { originalWarn = console.warn; console.warn = () => {}; });
  afterEach(() => { console.warn = originalWarn; });

  it('зберігає відповідь LLM з позначкою llm', async () => {
    const record = violation();
    const explainer = ex.createExplainer({
      models: fakeModels(record), config: baseConfig, fetchImpl: geminiAnswer('Ймовірно, вода витрачалась довго.'),
    });
    await explainer.explain(3);
    assert.equal(record.explanationSource, 'llm');
    assert.equal(record.explanation, 'Ймовірно, вода витрачалась довго.');
  });

  it('надсилає LLM режим світла з вимірювання, що спричинило подію', async () => {
    let prompt = '';
    const explainer = ex.createExplainer({
      models: fakeModels(violation()),
      config: baseConfig,
      fetchImpl: async (url, options) => { prompt = options.body; return geminiAnswer('Текст.')(); },
    });
    await explainer.explain(3);
    assert.match(prompt, /lightMode/);
    assert.match(prompt, /high/);
  });

  it('без ключа API використовує шаблон', async () => {
    const record = violation();
    let called = false;
    const explainer = ex.createExplainer({
      models: fakeModels(record),
      config: { ...baseConfig, llmApiKey: '' },
      fetchImpl: async () => { called = true; },
    });
    await explainer.explain(3);
    assert.equal(called, false);
    assert.equal(record.explanationSource, 'template');
  });

  it('помилка LLM або задовга відповідь - використовується шаблон', async () => {
    const failing = ex.createExplainer({
      models: fakeModels(violation()), config: baseConfig, fetchImpl: async () => { throw new Error('timeout'); },
    });
    const tooLong = ex.createExplainer({
      models: fakeModels(violation()), config: baseConfig, fetchImpl: geminiAnswer('x'.repeat(700)),
    });
    assert.equal((await failing.explain(3)).explanationSource, 'template');
    assert.equal((await tooLong.explain(3)).explanationSource, 'template');
  });

  it('після денного ліміту звернень LLM більше не викликається', async () => {
    let calls = 0;
    const explainer = ex.createExplainer({
      models: fakeModels(violation()),
      config: baseConfig,
      fetchImpl: async (...args) => { calls += 1; return geminiAnswer('Пояснення.')(...args); },
    });
    const now = new Date('2030-01-01T10:00:00Z');
    await explainer.explain(3, now);
    await explainer.explain(3, now);
    const third = await explainer.explain(3, now);
    assert.equal(calls, 2);
    assert.equal(third.explanationSource, 'template');
  });
});
