'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { errorHandler } = require('./middleware/errors');
const { createAuth } = require('./middleware/auth');
const { createActionLogger } = require('./logger');
const buildSpec = require('./openapi');

function createApp(models, config) {
  const app = express();
  app.use(express.json());

  // Спільні залежності, які отримують усі роутери
  const ctx = {
    models,
    config,
    auth: createAuth(models, config),
    log: createActionLogger(models),
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
  app.use('/api', api);

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
