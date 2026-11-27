'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { errorHandler } = require('./middleware/errors');
const { createAuth } = require('./middleware/auth');
const { createActionLogger } = require('./logger');
const { createExplainer } = require('./services/explanations');
const { createMeasurementService } = require('./services/measurements');
const { createAggregateService } = require('./services/aggregates');
const { createBookingJobs } = require('./services/booking-jobs');
const { createSettingsService } = require('./services/settings');
const buildSpec = require('./openapi');

// Сервіси бізнес-логіки, які використовують маршрути та планувальник
function createServices(models, config, log) {
  const explainer = createExplainer({ models, config });

  return {
    explainer,
    measurements: createMeasurementService({ models, config, explainer }),
    aggregates: createAggregateService({ models, config }),
    bookingJobs: createBookingJobs({ models, config, log }),
    settings: createSettingsService({ config }),
  };
}

function createApp(models, config) {
  const app = express();
  app.use(express.json());

  const log = createActionLogger(models);
  const services = createServices(models, config, log);
  app.locals.services = services;

  // Спільні залежності, які отримують усі роутери
  const ctx = {
    models,
    config,
    auth: createAuth(models, config),
    log,
    services,
  };

  const other = require('./routes/other')(ctx);

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ status: 'ok' }));
  api.use('/auth', require('./routes/auth')(ctx));
  api.use('/users', require('./routes/users')(ctx));
  api.use('/rooms', require('./routes/rooms')(ctx));
  api.use('/bookings', require('./routes/bookings')(ctx));
  api.use('/measurements', require('./routes/measurements')(ctx));
  api.use('/daily-aggregates', other.aggregates);
  api.use('/limit-violations', other.violations);
  api.use('/inspections', other.inspections);
  api.use('/service-requests', other.requests);
  api.use('/action-logs', other.logs);
  api.use('/admin', require('./routes/admin')(ctx));
  app.use('/api', api);

  // Фото сервісних заявок
  app.use('/uploads', express.static(config.uploadsDir));

  // Документація API
  const spec = buildSpec();
  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

  // Невідомий маршрут і обробник помилок завжди підключаються в кінці
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
