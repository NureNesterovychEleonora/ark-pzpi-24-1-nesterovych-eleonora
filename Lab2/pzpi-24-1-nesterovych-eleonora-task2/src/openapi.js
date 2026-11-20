'use strict';

// ---------- Допоміжні функції для опису OpenAPI ----------
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const secured = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const q = (name, type = 'string') => ({ name, in: 'query', schema: { type } });
const page = [
  { name: 'limit', in: 'query', description: 'Розмір сторінки (1-200, за замовчуванням 50)', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  { name: 'offset', in: 'query', description: 'Зміщення від початку списку', schema: { type: 'integer', minimum: 0, default: 0 } },
];

const listResp = (schema) => ({
  200: { description: 'Сторінка записів', content: json({
    type: 'object',
    properties: {
      total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' },
      items: { type: 'array', items: ref(schema) },
    },
  }) },
});
const one = (schema, code = 200) => ({ [code]: { description: 'Запис', content: json(ref(schema)) } });
const err = { 400: { description: 'Некоректні дані' }, 401: { description: 'Не автентифіковано' },
  403: { description: 'Недостатньо прав' }, 404: { description: 'Не знайдено' }, 409: { description: 'Конфлікт' } };

// Додає до специфікації стандартні маршрути CRUD для однієї сутності
function crudPaths(paths, base, tag, schema, filters, ops = {}) {
  const body = { required: true, content: json(ref(schema)) };
  paths[base] = {};
  paths[`${base}/{id}`] = {};
  if (ops.list !== false) {
    paths[base].get = { tags: [tag], summary: `Список: ${tag}`, security: secured,
      parameters: [...filters.map((f) => q(f)), ...page], responses: { ...listResp(schema), ...err } };
  }
  if (ops.create !== false) {
    paths[base].post = { tags: [tag], summary: `Створити: ${tag}`, security: secured,
      requestBody: body, responses: { ...one(schema, 201), ...err } };
  }
  paths[`${base}/{id}`].get = { tags: [tag], summary: `Отримати: ${tag}`, security: secured,
    parameters: [idParam], responses: { ...one(schema), ...err } };
  if (ops.update !== false) {
    paths[`${base}/{id}`].put = { tags: [tag], summary: `Оновити: ${tag}`, security: secured,
      parameters: [idParam], requestBody: body, responses: { ...one(schema), ...err } };
  }
  if (ops.remove !== false) {
    paths[`${base}/{id}`].delete = { tags: [tag], summary: `Видалити: ${tag}`, security: secured,
      parameters: [idParam], responses: { 204: { description: 'Видалено' }, ...err } };
  }
}

// Скорочення для опису схем
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const s = { type: 'string' };
const n = { type: 'number' };
const i = { type: 'integer' };
const dt = { type: 'string', format: 'date-time' };

// Збирає повну специфікацію OpenAPI 3.0
module.exports = function buildSpec() {
  const paths = {
    '/api/health': { get: { tags: ['Службове'], summary: 'Перевірка стану', responses: { 200: { description: 'OK' } } } },
    '/api/auth/register': { post: { tags: ['Автентифікація'], summary: 'Реєстрація мешканця',
      requestBody: { required: true, content: json(obj({ email: s, password: s, displayName: s }, ['email', 'password', 'displayName'])) },
      responses: { ...one('User', 201), 400: err[400], 409: err[409] } } },
    '/api/auth/login': { post: { tags: ['Автентифікація'], summary: 'Вхід, отримання JWT',
      requestBody: { required: true, content: json(obj({ email: s, password: s }, ['email', 'password'])) },
      responses: { 200: { description: 'Токен', content: json(obj({ token: s, user: ref('User') })) }, 401: err[401], 403: err[403] } } },
    '/api/auth/me': { get: { tags: ['Автентифікація'], summary: 'Поточний користувач', security: secured,
      responses: { ...one('User'), 401: err[401] } } },
    '/api/measurements': { get: { tags: ['Вимірювання'], summary: 'Список вимірювань', security: secured,
      parameters: [q('roomId', 'integer'), q('bookingId', 'integer'), q('from'), q('to'), ...page],
      responses: { ...listResp('Measurement'), ...err } },
    post: { tags: ['Вимірювання'], summary: 'Надіслати вимірювання (пристрій)',
      parameters: [{ name: 'X-Device-Key', in: 'header', required: true, schema: s }],
      requestBody: { required: true, content: json(obj({ measuredAt: dt, waterLevel: n, illuminance: n, temperature: n }, ['waterLevel', 'illuminance', 'temperature'])) },
      responses: { ...one('Measurement', 201), 400: err[400], 401: err[401], 409: err[409] } } },
    '/api/measurements/{id}': {
      get: { tags: ['Вимірювання'], summary: 'Отримати вимірювання', security: secured, parameters: [idParam], responses: { ...one('Measurement'), ...err } },
      delete: { tags: ['Вимірювання'], summary: 'Видалити вимірювання', security: secured, parameters: [idParam], responses: { 204: { description: 'Видалено' }, ...err } },
    },
  };

  // Стандартні CRUD-маршрути
  crudPaths(paths, '/api/users', 'Користувачі', 'User', ['role', 'isBlocked']);
  crudPaths(paths, '/api/rooms', 'Кімнати', 'Room', []);
  crudPaths(paths, '/api/bookings', 'Бронювання', 'Booking', ['roomId', 'userId', 'status', 'from', 'to']);
  crudPaths(paths, '/api/daily-aggregates', 'Добові агрегати', 'DailyAggregate', ['roomId', 'date']);
  crudPaths(paths, '/api/limit-violations', 'Перевищення лімітів', 'LimitViolation', ['roomId', 'bookingId', 'resource']);
  crudPaths(paths, '/api/inspections', 'Огляди', 'Inspection', ['bookingId', 'type']);
  crudPaths(paths, '/api/service-requests', 'Сервісні заявки', 'ServiceRequest', ['roomId', 'status', 'userId']);
  crudPaths(paths, '/api/action-logs', 'Журнал дій', 'ActionLog', ['userId', 'action', 'entity'],
    { create: false, update: false, remove: false });

  paths['/api/rooms/{id}/bookings'] = {
    get: {
      tags: ['Кімнати'], summary: 'Бронювання кімнати за обраний день', security: secured,
      parameters: [idParam, { name: 'date', in: 'query', required: true, description: 'Дата у форматі YYYY-MM-DD (доба за часовим поясом Europe/Kyiv)', schema: { type: 'string', format: 'date' } }],
      responses: {
        200: { description: 'Розклад кімнати за добу', content: json(obj({ roomId: i, date: { type: 'string', format: 'date' }, timeZone: s, from: dt, to: dt, items: { type: 'array', items: ref('RoomScheduleItem') } })) },
        400: err[400], 401: err[401], 404: err[404],
      },
    },
  };

  // Приклади тіл запитів для Swagger UI
  const example = (path, method, value) => {
    paths[path][method].requestBody.content['application/json'].example = value;
  };
  example('/api/auth/register', 'post', { email: 'resident2@habicore.local', password: 'Secret123', displayName: 'Мешканець 2' });
  example('/api/auth/login', 'post', { email: 'admin@habicore.local', password: 'Admin123!' });
  example('/api/rooms', 'post', { name: 'Кімната 3', description: 'Тестова кімната', waterLimit: 80, lightLimit: 60, tempMin: 18, tempMax: 26 });
  example('/api/bookings', 'post', { roomId: 1, startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T12:00:00Z' });
  example('/api/measurements', 'post', { measuredAt: '2030-01-01T10:00:10Z', waterLevel: 70, illuminance: 300, temperature: 22 });
  example('/api/inspections', 'post', { bookingId: 1, type: 'checkin', state: 'ok', note: 'Усе в порядку' });
  example('/api/service-requests', 'post', { roomId: 1, description: 'Не працює лампа', photoUrl: 'https://example.com/photo.jpg' });
  paths['/api/bookings'].post.responses[409] = {
    description: 'Конфлікт: кімната вже заброньована на цей час',
    content: { 'application/json': { schema: obj({ error: s }), example: { error: 'The room is already booked for this time' } } },
  };

  return {
    openapi: '3.0.3',
    info: { title: 'HabiCore API', version: '1.0.0', description: 'Серверна частина системи керування ресурсами навчального житлового модуля' },
    servers: [{ url: 'http://localhost:3000' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        User: obj({ id: i, email: s, displayName: s, password: { type: 'string', writeOnly: true, minLength: 6 }, role: { type: 'string', enum: ['resident', 'admin'] }, isBlocked: { type: 'boolean' } }),
        Room: obj({ id: i, name: s, description: s, waterLimit: n, lightLimit: n, tempMin: n, tempMax: n, deviceKey: s, qrToken: s }),
        Booking: obj({ id: i, userId: i, roomId: i, startTime: dt, endTime: dt, status: { type: 'string', enum: ['created', 'active', 'completed', 'cancelled'] }, cancelReason: s }),
        Measurement: obj({ id: i, roomId: i, bookingId: i, measuredAt: dt, waterLevel: n, illuminance: n, temperature: n }),
        DailyAggregate: obj({ id: i, roomId: i, date: { type: 'string', format: 'date' }, tempMin: n, tempMax: n, tempAvg: n, lightMin: n, lightMax: n, lightAvg: n, waterUsed: n, lightUsage: n }),
        LimitViolation: obj({ id: i, roomId: i, bookingId: i, resource: { type: 'string', enum: ['water', 'light', 'temperature'] }, limitValue: n, actualValue: n, detectedAt: dt, explanation: s, explanationSource: { type: 'string', enum: ['llm', 'template'] } }),
        Inspection: obj({ id: i, bookingId: i, type: { type: 'string', enum: ['checkin', 'checkout'] }, state: { type: 'string', enum: ['ok', 'issues'] }, note: s }),
        ServiceRequest: obj({ id: i, userId: i, roomId: i, description: s, photoUrl: s, status: { type: 'string', enum: ['new', 'in_progress', 'resolved'] }, adminComment: s }),
        RoomScheduleItem: obj({ id: i, startTime: dt, endTime: dt, status: { type: 'string', enum: ['created', 'active', 'completed'] }, userId: i }),
        ActionLog: obj({ id: i, userId: i, action: s, entity: s, entityId: i, details: s, createdAt: dt }),
      },
    },
  };
};
