'use strict';

const { localDateTime } = require('../utils');

// Пояснення перевищення ліміту: спочатку зовнішня LLM (Google Gemini),
// а якщо вона недоступна або відповідь некоректна - шаблонний текст.

const MAX_EXPLANATION_LENGTH = 600;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const RESOURCE_NAMES = {
  water: 'вода',
  light: 'світло',
  temperature: 'температура',
};

// Технічний опис події без персональних даних (лише ідентифікатор бронювання):
// кімната, ресурс, ліміт, фактичне значення, час, витрата бронювання, режим світла
function buildEventDescription(violation, room, booking, lightMode = null) {
  return {
    room: room.name,
    resource: violation.resource,
    limit: violation.limitValue,
    actual: violation.actualValue,
    detectedAt: new Date(violation.detectedAt).toISOString(),
    bookingId: violation.bookingId || null,
    bookingUsage: booking ? { water: booking.waterUsed, light: booking.lightUsed } : null,
    lightMode,
    temperatureRange: [room.tempMin, room.tempMax],
  };
}

function templateExplanation(event) {
  const where = `у кімнаті «${event.room}»`;

  if (event.resource === 'temperature') {
    const isHot = event.actual > event.limit;
    const reason = isHot
      ? 'Імовірна причина - перегрів приміщення або тривала робота яскравого світла.'
      : 'Імовірна причина - охолодження приміщення або відкритий доступ холодного повітря.';
    return `Температура ${where} становить ${event.actual} °C і вийшла за допустимий діапазон `
      + `${event.temperatureRange[0]}-${event.temperatureRange[1]} °C. ${reason} `
      + 'Порада: перевірити умови в кімнаті та повідомити адміністратора, якщо стан не зміниться.';
  }

  const name = RESOURCE_NAMES[event.resource];
  const advice = event.resource === 'water'
    ? 'Порада: зменшити витрату води та перевірити, чи немає протікання.'
    : 'Порада: перейти на режим «low» або вимкнути світло, коли воно не потрібне.';
  return `Перевищено ліміт ресурсу «${name}» ${where}: використано ${event.actual} `
    + `при ліміті ${event.limit}. Імовірна причина - інтенсивне використання ресурсу `
    + `протягом бронювання. ${advice}`;
}

function buildPrompt(event) {
  return 'Ти помічник адміністратора навчального житлового модуля. '
    + 'Поясни українською мовою, коротко (до 500 символів, без розмітки), '
    + 'чому могло статися перевищення ресурсного ліміту, і дай одну практичну пораду. '
    + 'Використовуй лише наведені дані, нічого не вигадуй.\n'
    + `Дані події (JSON): ${JSON.stringify(event)}`;
}

// Відповідь LLM приймається, лише якщо це непорожній текст не довший за 600 символів
function isValidExplanation(text) {
  return typeof text === 'string'
    && text.trim().length > 0
    && text.trim().length <= MAX_EXPLANATION_LENGTH;
}

async function askGemini(prompt, config, fetchImpl) {
  const url = `${GEMINI_URL}/${config.llmModel}:generateContent`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.llmApiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`LLM answered with HTTP ${response.status}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('').trim();
}

// Створює сервіс, який додає пояснення до вже збереженої події перевищення
function createExplainer({ models, config, fetchImpl = fetch }) {
  // Лічильник звернень до LLM за поточну добу (обмеження безкоштовної квоти)
  const usage = { date: null, count: 0 };

  const canUseLlm = (now) => {
    const today = localDateTime(now, config.timeZone).date;
    if (usage.date !== today) {
      usage.date = today;
      usage.count = 0;
    }
    return Boolean(config.llmApiKey) && usage.count < config.llmDailyLimit;
  };

  async function explain(violationId, now = new Date()) {
    const violation = await models.LimitViolation.findByPk(violationId);
    const room = await models.Room.findByPk(violation.roomId);
    const booking = violation.bookingId ? await models.Booking.findByPk(violation.bookingId) : null;
    // Режим світла в момент виявлення - з вимірювання, яке спричинило подію
    const measurement = await models.Measurement.findOne({
      where: { roomId: violation.roomId, measuredAt: violation.detectedAt },
    });
    const lightMode = measurement ? measurement.lightMode : null;
    const event = buildEventDescription(violation, room, booking, lightMode);

    let text = null;
    let source = 'template';

    if (canUseLlm(now)) {
      usage.count += 1;
      try {
        const answer = await askGemini(buildPrompt(event), config, fetchImpl);
        if (isValidExplanation(answer)) {
          text = answer.trim();
          source = 'llm';
        }
      } catch (err) {
        console.warn(`LLM is not available, template is used: ${err.message}`);
      }
    }

    if (!text) {
      text = templateExplanation(event);
    }

    await violation.update({ explanation: text.slice(0, MAX_EXPLANATION_LENGTH), explanationSource: source });
    return violation;
  }

  return { explain };
}

module.exports = {
  buildEventDescription,
  templateExplanation,
  buildPrompt,
  isValidExplanation,
  createExplainer,
};
