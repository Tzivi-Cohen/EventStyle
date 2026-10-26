import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createAdmin, eventBody, mailer, prisma, resetDatabase } from './helpers';

const EMAIL = 'noa@test.com';
const registration = { fullName: 'Noa Levi', email: EMAIL, phone: '050-1234567', password: 'Secret123' };

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

/** יוצר אירוע (כמנהלת) עבור כתובת האימייל של הלקוחה, לפני שנרשמה */
async function createEventForEmail(email = EMAIL) {
  const admin = await createAdmin();
  const res = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: email }));
  expect(res.status).toBe(201);
  return { admin, event: res.body };
}

describe('Email verification flow', () => {
  it('sends a 6-digit code and stores only its hash', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const code = mailer.lastCodeFor(EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.verificationCodeHash).toBeTruthy();
    expect(user.verificationCodeHash).not.toContain(code);
    const minutes = (user.verificationCodeExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('does NOT expose existing events before verification, and links them after', async () => {
    const { event } = await createEventForEmail();
    expect(event.userId).toBeNull();

    const reg = await api.post('/api/auth/register').send(registration).expect(201);
    const clientAuth = `Bearer ${reg.body.token}`;

    // לפני אימות – אין גישה
    const before = await api.get('/api/events/my').set('Authorization', clientAuth);
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(0);
    await api.get(`/api/events/${event.id}`).set('Authorization', clientAuth).expect(403);

    const verify = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(verify.status).toBe(200);
    expect(verify.body.linkedEventsCount).toBe(1);
    expect(verify.body.user.emailVerified).toBe(true);

    const after = await api.get('/api/events/my').set('Authorization', clientAuth);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].id).toBe(event.id);
    expect(after.body.data[0].notes).toBeUndefined();
  });

  it('code is single-use', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const code = mailer.lastCodeFor(EMAIL)!;
    await api.post('/api/auth/verify-email').send({ email: EMAIL, code }).expect(200);
    const again = await api.post('/api/auth/verify-email').send({ email: EMAIL, code });
    expect(again.status).toBe(409);
  });

  it('rejects a wrong code and reports attempts left', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const code = mailer.lastCodeFor(EMAIL)!;
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: wrong });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
    expect(res.body.error.details.attemptsLeft).toBe(4);
  });

  it('cancels the code after 5 wrong attempts', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const code = mailer.lastCodeFor(EMAIL)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await api.post('/api/auth/verify-email').send({ email: EMAIL, code: wrong }).expect(400);
    }
    const res = await api.post('/api/auth/verify-email').send({ email: EMAIL, code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.emailVerified).toBe(false);
  });

  it('rejects an expired code (older than 10 minutes)', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    await prisma.user.update({
      where: { email: EMAIL },
      data: { verificationCodeExpiresAt: new Date(Date.now() - 1000) },
    });
    const res = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('validates the code format', async () => {
    const res = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: '12ab' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('resend: enforces a 60-second cooldown', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const res = await api.post('/api/auth/resend-code').send({ email: EMAIL });
    expect(res.status).toBe(429);
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resend: sends a new code that replaces the old one', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const oldCode = mailer.lastCodeFor(EMAIL)!;
    await prisma.user.update({
      where: { email: EMAIL },
      data: { verificationLastSentAt: new Date(Date.now() - 61_000) },
    });

    await api.post('/api/auth/resend-code').send({ email: EMAIL }).expect(200);
    const newCode = mailer.lastCodeFor(EMAIL)!;
    expect(mailer.sent).toHaveLength(2);

    if (oldCode !== newCode) {
      await api.post('/api/auth/verify-email').send({ email: EMAIL, code: oldCode }).expect(400);
    }
    await api.post('/api/auth/verify-email').send({ email: EMAIL, code: newCode }).expect(200);
  });

  it('resend: limits to 5 codes per hour', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    await prisma.user.update({
      where: { email: EMAIL },
      data: { verificationSendCount: 5, verificationLastSentAt: new Date(Date.now() - 120_000) },
    });
    const res = await api.post('/api/auth/resend-code').send({ email: EMAIL });
    expect(res.status).toBe(429);
  });

  it('resend: returns the same generic answer for unknown emails', async () => {
    const res = await api.post('/api/auth/resend-code').send({ email: 'nobody@test.com' });
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it('an unverified account cannot be used to take over events: re-registering replaces it', async () => {
    await createEventForEmail();
    // "תוקף" נרשם עם האימייל של הלקוחה – אבל לא יכול לאמת אותו
    await api.post('/api/auth/register').send({ ...registration, password: 'Attacker1' }).expect(201);
    await prisma.user.update({ where: { email: EMAIL }, data: { verificationLastSentAt: new Date(Date.now() - 61_000) } });

    // הלקוחה האמיתית נרשמת שוב – הסיסמה מתעדכנת ונשלח קוד חדש
    await api.post('/api/auth/register').send(registration).expect(201);
    await api.post('/api/auth/login').send({ email: EMAIL, password: 'Attacker1' }).expect(401);

    const verify = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(verify.status).toBe(200);
    expect(verify.body.linkedEventsCount).toBe(1);
  });

  it('admin-created events link immediately only to VERIFIED clients', async () => {
    const admin = await createAdmin();
    const reg = await api.post('/api/auth/register').send(registration).expect(201);

    const beforeVerify = await api
      .post('/api/events')
      .set('Authorization', admin.auth)
      .send(eventBody({ clientEmail: EMAIL }));
    expect(beforeVerify.body.userId).toBeNull();

    const verify = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(verify.body.linkedEventsCount).toBe(1);

    const afterVerify = await api
      .post('/api/events')
      .set('Authorization', admin.auth)
      .send(eventBody({ clientEmail: EMAIL, eventName: 'Second event' }));
    expect(afterVerify.status).toBe(201);
    expect(afterVerify.body.userId).toBe(reg.body.user.id);
  });
});
