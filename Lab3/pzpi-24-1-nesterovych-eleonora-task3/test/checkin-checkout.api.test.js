'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../testkit/harness');
const { lightSessionToken } = require('../src/services/booking-rules');

const fromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

describe('поселення та виселення за QR-кодом', () => {
  let app; let resident; let other;
  before(async () => {
    app = await startTestApp();
    resident = await app.createUser();
    other = await app.createUser();
  });
  after(() => app.close());

  const checkIn = (id, body, token = resident.token) => app.api('POST', `/api/bookings/${id}/check-in`, { token, body });
  const checkOut = (id, body, token = resident.token) => app.api(
    'POST', `/api/bookings/${id}/check-out`, { token, body },
  );

  // Кімната з відомим QR-токеном і бронювання, яке починається через 10 хвилин
  const prepare = async (startIn = 10) => {
    const room = await app.createRoom({ qrToken: app.unique('qr') });
    const booking = await app.createBooking({
      room, user: resident, start: fromNow(startIn), end: fromNow(startIn + 60),
    });
    return { room, booking };
  };

  it('поселення: бронювання стає активним, створюється огляд', async () => {
    const { room, booking } = await prepare();
    const r = await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok', note: 'Чисто' });
    assert.equal(r.status, 200);
    assert.equal(r.data.booking.status, 'active');
    assert.equal(r.data.inspection.type, 'checkin');
    assert.equal(r.data.inspection.note, 'Чисто');
  });

  it('поселення видає токен світлової сесії для BLE', async () => {
    const { room, booking } = await prepare();
    const r = await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' });
    assert.equal(r.status, 200);
    assert.equal(r.data.lightToken, lightSessionToken(room.deviceKey, booking.id));
  });

  it('QR-код іншої кімнати → 400', async () => {
    const { booking } = await prepare();
    assert.equal((await checkIn(booking.id, { qrToken: 'wrong', state: 'ok' })).status, 400);
  });

  it('повторне поселення → 409', async () => {
    const { room, booking } = await prepare();
    await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' });
    assert.equal((await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' })).status, 409);
  });

  it('занадто рано (за 2 години до початку) → 409', async () => {
    const { room, booking } = await prepare(120);
    assert.equal((await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' })).status, 409);
  });

  it('чуже бронювання → 404', async () => {
    const { room, booking } = await prepare();
    assert.equal((await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' }, other.token)).status, 404);
  });

  it('у кімнаті вже є активне бронювання → 409', async () => {
    const { room, booking } = await prepare();
    await app.createBooking({ room, user: other, start: fromNow(-30), end: fromNow(5), status: 'active' });
    assert.equal((await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' })).status, 409);
  });

  it('без стану огляду → 400, статус бронювання не змінюється (транзакція)', async () => {
    const { room, booking } = await prepare();
    assert.equal((await checkIn(booking.id, { qrToken: room.qrToken })).status, 400);
    await booking.reload();
    assert.equal(booking.status, 'created');
  });

  it('виселення: бронювання завершується, огляд і запис у журналі', async () => {
    const { room, booking } = await prepare();
    await checkIn(booking.id, { qrToken: room.qrToken, state: 'ok' });
    const r = await checkOut(booking.id, { state: 'issues', note: 'Подряпина' });
    assert.equal(r.status, 200);
    assert.equal(r.data.booking.status, 'completed');
    assert.equal(r.data.inspection.type, 'checkout');
    const logEntry = await app.models.ActionLog.findOne({ where: { action: 'check_out', entityId: booking.id } });
    assert.ok(logEntry);
  });

  it('виселення без поселення → 409', async () => {
    const { booking } = await prepare();
    assert.equal((await checkOut(booking.id, { state: 'ok' })).status, 409);
  });
});

describe('правила створення бронювань', () => {
  let app; let admin; let resident;
  before(async () => {
    app = await startTestApp({ maxActiveBookingsPerUser: 2 });
    admin = await app.createUser({ role: 'admin' });
    resident = await app.createUser();
  });
  after(() => app.close());

  const book = (room, startIn, token = resident.token) => app.api('POST', '/api/bookings', {
    token,
    body: { roomId: room.id, startTime: fromNow(startIn).toISOString(), endTime: fromNow(startIn + 60).toISOString() },
  });

  it('початок у минулому → 400', async () => {
    const room = await app.createRoom();
    assert.equal((await book(room, -30)).status, 400);
  });

  it('тривалість менше 1 години → 400', async () => {
    const room = await app.createRoom();
    const r = await app.api('POST', '/api/bookings', {
      token: admin.token,
      body: { roomId: room.id, startTime: fromNow(60).toISOString(), endTime: fromNow(90).toISOString() },
    });
    assert.equal(r.status, 400);
  });

  it('не більше двох поточних і майбутніх бронювань мешканця (третє → 409)', async () => {
    const room = await app.createRoom();
    assert.equal((await book(room, 60)).status, 201);
    assert.equal((await book(room, 180)).status, 201);
    assert.equal((await book(room, 300)).status, 409);
  });

  it('обмеження не діє для адміністратора', async () => {
    const room = await app.createRoom();
    for (const startIn of [60, 180, 300]) {
      assert.equal((await book(room, startIn, admin.token)).status, 201);
    }
  });

  it('скасоване бронювання не враховується в обмеженні', async () => {
    const user = await app.createUser();
    const room = await app.createRoom();
    const first = (await book(room, 60, user.token)).data;
    await book(room, 180, user.token);
    await app.api('PUT', `/api/bookings/${first.id}`, { token: user.token, body: { status: 'cancelled' } });
    assert.equal((await book(room, 300, user.token)).status, 201);
  });
});

describe('автоматична зміна статусів (планувальник)', () => {
  let app; let resident;
  before(async () => {
    app = await startTestApp();
    resident = await app.createUser();
  });
  after(() => app.close());

  it('no-show скасовує, а час завершення завершує бронювання', async () => {
    const room = await app.createRoom();
    const late = await app.createBooking({ room, user: resident, start: fromNow(-120), end: fromNow(60) });
    // Почалося 20 хвилин тому - вікно поселення ще відкрите
    const fresh = await app.createBooking({ room, user: resident, start: fromNow(-20), end: fromNow(100) });
    const finished = await app.createBooking({ room, user: resident, start: fromNow(-300), end: fromNow(-1), status: 'active' });

    const result = await app.services.bookingJobs.updateBookingStatuses(new Date());
    assert.deepEqual(result, { cancelled: 1, completed: 1 });

    await Promise.all([late.reload(), fresh.reload(), finished.reload()]);
    assert.equal(late.status, 'cancelled');
    assert.equal(late.cancelReason, 'no-show');
    assert.equal(fresh.status, 'created');
    assert.equal(finished.status, 'completed');

    const logEntry = await app.models.ActionLog.findOne({ where: { action: 'auto_cancel', entityId: late.id } });
    assert.equal(logEntry.userId, null);
  });
});
