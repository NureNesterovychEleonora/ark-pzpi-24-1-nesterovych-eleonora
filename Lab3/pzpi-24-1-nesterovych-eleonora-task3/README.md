# HabiCore: серверна частина

Програмна система для керування ресурсами навчального житлового модуля.
Серверна частина: Web API (REST, JSON), база даних SQLite, бізнес-логіка та функції адміністрування.

## Вимоги

- Node.js 20.12 або новіший (рекомендовано 24 LTS) разом з npm.

## Встановлення та запуск

```
npm install
npm run db:reset      # лише якщо в data/ лишився файл БД попередньої версії
npm start
```

Після запуску:

- API: http://localhost:3000/api
- документація Swagger UI: http://localhost:3000/api-docs
- специфікація OpenAPI: http://localhost:3000/openapi.json

Під час першого запуску створюються облікові записи `admin@habicore.local` / `Admin123!`,
`resident@habicore.local` / `Resident123!` та дві кімнати
(ключі пристроїв `demo-device-key-room-1`, `demo-device-key-room-2`, QR-токени `demo-qr-room-1`, `demo-qr-room-2`).

Підготовлені тестові дані для кімнати 2 (вимірювання за два попередні дні): `npm run demo-data`.

Функції адміністратора: `/api/users` (користувачі та ролі), `PUT /api/rooms/{id}` (ліміти),
`/api/action-logs` (журнал дій), `/api/admin/settings` і `POST /api/admin/settings/reload` (системні параметри),
`/api/admin/stats` (моніторинг активності та останні перевищення).

Ресурсна панель: `GET /api/rooms/{id}/resources` (поточний стан), `GET /api/rooms/{id}/history` (графік за 24 години),
`GET /api/daily-aggregates?from=...&to=...` (добові агрегати за період).

## Налаштування

- `settings.json` - системні параметри (мінімальна й максимальна тривалість і кількість бронювань, вікно поселення,
  ліміти за замовчуванням, поріг попередження, потужність режимів світла, період зберігання вимірювань,
  параметри LLM, час нічного розрахунку агрегатів). Змінений файл застосовується без перезапуску сервера
  (автоматично або запитом `POST /api/admin/settings/reload`), зміни записуються в журнал дій;
  некоректний файл не застосовується. Лише `port` і `uploadsDir` діють після перезапуску.
- `.env` (зразок у `.env.example`) - секрети: `JWT_SECRET`, `GEMINI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
  Без `GEMINI_API_KEY` пояснення перевищень формуються за шаблоном.

## Тести

```
npm test              # усі тести (модульні та API з БД у пам'яті)
npm run test:unit     # лише модульні тести бізнес-правил
npm run test:coverage # тести зі звітом покриття
npx eslint .          # статичний аналіз
```

## Структура

```
src/
  app.js, server.js        створення застосунку і запуск сервера
  config.js                системні параметри (settings.json, .env)
  models.js, db.js         моделі ORM Sequelize і підключення до БД
  crud.js                  універсальний CRUD-роутер
  routes/                  маршрути API
  services/                бізнес-логіка
    booking-rules.js       правила бронювання, поселення та виселення
    resources.js           облік води і світла, перевищення, стан кімнати, агрегати
    measurements.js        потокова обробка вимірювань
    aggregates.js          пакетний розрахунок добових агрегатів, період зберігання вимірювань
    booking-jobs.js        автоматичні статуси бронювань (no-show, завершення)
    explanations.js        пояснення перевищень (LLM або шаблон)
    request-rules.js       переходи статусів сервісних заявок
    settings.js            перевірка та застосування системних параметрів без перезапуску
    scheduler.js           планувальник фонових завдань
test/                      тести (node:test)
testkit/harness.js         запуск застосунку для API-тестів
```
