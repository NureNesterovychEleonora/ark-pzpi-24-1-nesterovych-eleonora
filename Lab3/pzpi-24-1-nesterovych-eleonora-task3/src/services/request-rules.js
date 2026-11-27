'use strict';

const { HttpError } = require('../middleware/errors');

// Дозволені переходи статусу сервісної заявки: new -> in_progress -> resolved
// (заявку можна одразу закрити зі статусу new). Повернення назад заборонене.
const NEXT_STATUSES = {
  new: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: [],
};

function checkStatusChange(currentStatus, newStatus) {
  // Невідомий статус відхилить валідація моделі (400)
  const isKnownStatus = Object.hasOwn(NEXT_STATUSES, newStatus);
  if (!isKnownStatus || newStatus === currentStatus) {
    return;
  }

  const allowed = NEXT_STATUSES[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new HttpError(409, `Status cannot be changed from "${currentStatus}" to "${newStatus}"`);
  }
}

module.exports = { checkStatusChange };
