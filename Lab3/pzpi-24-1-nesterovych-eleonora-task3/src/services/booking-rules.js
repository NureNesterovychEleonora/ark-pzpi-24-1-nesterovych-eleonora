'use strict';

const { createHmac } = require('node:crypto');
const { HttpError } = require('../middleware/errors');

// Правила бронювання. Функції не звертаються до БД: отримують дані
// та поточний час і або нічого не повертають, або кидають HttpError.

const MS_IN_MINUTE = 60 * 1000;
const MS_IN_HOUR = 60 * MS_IN_MINUTE;
const LIGHT_TOKEN_LENGTH = 16;

// Перевірка часу бронювання: кінець після початку, тривалість у межах
// від minBookingHours до maxBookingHours, початок не в минулому
// (для нового бронювання або при зміні часу початку)
function checkBookingTimes({ start, end, now, config, isStartChanged }) {
  if (end <= start) {
    throw new HttpError(400, 'endTime must be later than startTime');
  }
  const minHours = config.minBookingHours || 0;
  if (end - start < minHours * MS_IN_HOUR) {
    throw new HttpError(400, `Booking duration must be at least ${minHours} hour(s)`);
  }
  if (end - start > config.maxBookingHours * MS_IN_HOUR) {
    throw new HttpError(400, `Booking duration must not exceed ${config.maxBookingHours} hours`);
  }
  if (isStartChanged && start <= now) {
    throw new HttpError(400, 'startTime must be in the future');
  }
}

// Мешканець може мати не більше maxActiveBookingsPerUser поточних і майбутніх бронювань
function checkActiveBookingsLimit(activeCount, config) {
  if (activeCount >= config.maxActiveBookingsPerUser) {
    throw new HttpError(
      409,
      `A user can have no more than ${config.maxActiveBookingsPerUser} active and future bookings`,
    );
  }
}

// Вікно поселення: від checkInBeforeMinutes до початку
// до checkInAfterMinutes після початку (але не пізніше кінця бронювання)
function checkInWindow(booking, config) {
  const start = new Date(booking.startTime).getTime();
  const end = new Date(booking.endTime).getTime();

  return {
    opensAt: new Date(start - config.checkInBeforeMinutes * MS_IN_MINUTE),
    closesAt: new Date(Math.min(start + config.checkInAfterMinutes * MS_IN_MINUTE, end)),
  };
}

function checkCanCheckIn({ booking, room, qrToken, now, config }) {
  if (booking.status !== 'created') {
    throw new HttpError(409, 'Only bookings with status "created" can be checked in');
  }
  if (!qrToken || qrToken !== room.qrToken) {
    throw new HttpError(400, 'QR code does not belong to the booked room');
  }

  const { opensAt, closesAt } = checkInWindow(booking, config);
  if (now < opensAt || now > closesAt) {
    throw new HttpError(
      409,
      `Check-in is allowed from ${opensAt.toISOString()} to ${closesAt.toISOString()}`,
    );
  }
}

function checkCanCheckOut(booking) {
  if (booking.status !== 'active') {
    throw new HttpError(409, 'Only active bookings can be checked out');
  }
}

// Бронювання, на яке не поселилися вчасно, скасовується автоматично
function isNoShow(booking, now, config) {
  const { closesAt } = checkInWindow(booking, config);
  return booking.status === 'created' && now > closesAt;
}

// Активне бронювання автоматично завершується в момент закінчення
function isExpired(booking, now) {
  return booking.status === 'active' && now >= new Date(booking.endTime);
}

// Токен світлової сесії для BLE. Видається мешканцю під час поселення.
// Пристрій знає свій ключ і номер активного бронювання (з відповіді сервера),
// тому сам обчислює такий самий токен і перевіряє BLE-команду без звернення до сервера.
// Токен дійсний, лише поки це бронювання активне в кімнаті.
function lightSessionToken(deviceKey, bookingId) {
  return createHmac('sha256', String(deviceKey))
    .update(`light-session:${bookingId}`)
    .digest('hex')
    .slice(0, LIGHT_TOKEN_LENGTH);
}

module.exports = {
  checkBookingTimes,
  lightSessionToken,
  checkActiveBookingsLimit,
  checkInWindow,
  checkCanCheckIn,
  checkCanCheckOut,
  isNoShow,
  isExpired,
};
