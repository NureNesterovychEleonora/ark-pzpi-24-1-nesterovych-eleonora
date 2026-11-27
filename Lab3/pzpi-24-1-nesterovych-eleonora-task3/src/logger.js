'use strict';

// Повертає функцію, яка записує дію користувача в журнал (таблиця action_logs).
function createActionLogger(models) {
  return async function log(req, action, entity, entityId, details) {
    const userId = req.user ? req.user.id : null;

    await models.ActionLog.create({
      userId,
      action,
      entity,
      entityId: entityId === undefined ? null : entityId,
      details: details || null,
    });
  };
}

module.exports = { createActionLogger };
