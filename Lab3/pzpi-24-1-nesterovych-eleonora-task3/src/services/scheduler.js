'use strict';

const { localDateTime } = require('../utils');

const TICK_MS = 60 * 1000;

// Планувальник фонових завдань:
// - щохвилини оновлює статуси бронювань (no-show та завершення);
// - щоночі після nightlyJobTime (00:05 за Києвом) рахує агрегати за попередню добу,
//   дораховує пропущені дати та видаляє застарілі сирі вимірювання.
//   Якщо сервер запущено після nightlyJobTime, завдання виконується одразу під час запуску.
function startScheduler({ services, config, log }) {
  let lastNightlyRun = null;

  async function runNightly(now) {
    const { calculated, purged } = await services.aggregates.runNightly(now);

    for (const { date, rooms } of calculated) {
      await log({}, 'calculate_aggregates', 'DailyAggregate', null, `${date}: ${rooms} rooms`);
    }
    if (purged > 0) {
      await log({}, 'purge_measurements', 'Measurement', null, `${purged} records older than retention period`);
    }
  }

  async function tick() {
    const now = new Date();
    await services.bookingJobs.updateBookingStatuses(now);

    const local = localDateTime(now, config.timeZone);
    if (lastNightlyRun !== local.date && local.time >= config.nightlyJobTime) {
      lastNightlyRun = local.date;
      await runNightly(now);
    }
  }

  const run = () => tick().catch((err) => console.error('Scheduler error:', err));
  run();
  return setInterval(run, TICK_MS);
}

module.exports = { startScheduler };
