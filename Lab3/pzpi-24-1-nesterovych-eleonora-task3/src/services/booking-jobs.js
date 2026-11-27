'use strict';

const { Op } = require('sequelize');
const { isNoShow, isExpired } = require('./booking-rules');

// Автоматична зміна статусів бронювань (запускається планувальником щохвилини)
function createBookingJobs({ models, config, log }) {
  const { Booking } = models;

  // Дії планувальника записуються в журнал без користувача (userId = null)
  const systemRequest = {};

  async function updateBookingStatuses(now = new Date()) {
    let cancelled = 0;
    let completed = 0;

    // Не поселилися вчасно - бронювання скасовується з причиною no-show
    const notStarted = await Booking.findAll({
      where: { status: 'created', startTime: { [Op.lt]: now } },
    });
    for (const booking of notStarted) {
      if (isNoShow(booking, now, config)) {
        await booking.update({ status: 'cancelled', cancelReason: 'no-show' });
        await log(systemRequest, 'auto_cancel', 'Booking', booking.id, 'no-show');
        cancelled += 1;
      }
    }

    // Час бронювання минув - активне бронювання завершується
    const active = await Booking.findAll({
      where: { status: 'active', endTime: { [Op.lte]: now } },
    });
    for (const booking of active) {
      if (isExpired(booking, now)) {
        await booking.update({ status: 'completed' });
        await log(systemRequest, 'auto_complete', 'Booking', booking.id, 'end time reached');
        completed += 1;
      }
    }

    return { cancelled, completed };
  }

  return { updateBookingStatuses };
}

module.exports = { createBookingJobs };
