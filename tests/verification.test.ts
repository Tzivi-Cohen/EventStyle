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
    const attacker = await api.post('/api/auth/register').send({ ...registration, password: 'Attacker1' }).expect(201);
    const attackerAuth = `Bearer ${attacker.body.token}`;
    await prisma.user.update({ where: { email: EMAIL }, data: { verificationLastSentAt: new Date(Date.now() - 61_000) } });

    // הלקוחה האמיתית נרשמת שוב – החשבון מוחלף (id חדש) ונשלח קוד חדש
    const owner = await api.post('/api/auth/register').send(registration).expect(201);
    expect(owner.body.user.id).not.toBe(attacker.body.user.id);
    await api.post('/api/auth/login').send({ email: EMAIL, password: 'Attacker1' }).expect(401);

    const verify = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(verify.status).toBe(200);
    expect(verify.body.linkedEventsCount).toBe(1);

    // ה-JWT הישן של התוקף לא מאפשר לראות את האירועים של הלקוחה
    const stale = await api.get('/api/events/my').set('Authorization', attackerAuth);
    expect(stale.status).toBe(401);
    const mine = await api.get('/api/events/my').set('Authorization', `Bearer ${owner.body.token}`);
    expect(mine.body.data).toHaveLength(1);
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

describe('Re-registration over an unverified account', () => {
  /** הרשמה ראשונה, ואז "מזיזים אחורה" את זמן השליחה כדי לעבור את ה-Cooldown */
  async function registerAndWaitCooldown(body = registration) {
    const res = await api.post('/api/auth/register').send(body).expect(201);
    await prisma.user.update({ where: { email: EMAIL }, data: { verificationLastSentAt: new Date(Date.now() - 61_000) } });
    return res;
  }

  it('replaces the account with a new id and rejects every JWT of the old one', async () => {
    const first = await registerAndWaitCooldown({ ...registration, password: 'Attacker1' });
    const second = await api.post('/api/auth/register').send(registration).expect(201);

    expect(second.body.user.id).not.toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    const stale = await api.get('/api/auth/me').set('Authorization', `Bearer ${first.body.token}`);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('UNAUTHORIZED');
    await api.get('/api/auth/me').set('Authorization', `Bearer ${second.body.token}`).expect(200);
  });

  it('the re-registered account gets NO access to events before verification', async () => {
    const { event } = await createEventForEmail();
    await registerAndWaitCooldown({ ...registration, password: 'Attacker1' });
    const second = await api.post('/api/auth/register').send(registration).expect(201);
    const auth = `Bearer ${second.body.token}`;

    expect((await api.get('/api/events/my').set('Authorization', auth)).body.data).toHaveLength(0);
    await api.get(`/api/events/${event.id}`).set('Authorization', auth).expect(403);
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.userId).toBeNull();
  });

  it('the code sent to the old account no longer works', async () => {
    await registerAndWaitCooldown({ ...registration, password: 'Attacker1' });
    const oldCode = mailer.lastCodeFor(EMAIL)!;
    await api.post('/api/auth/register').send(registration).expect(201);
    const newCode = mailer.lastCodeFor(EMAIL)!;
    if (oldCode === newCode) return; // סיכוי של 1 למיליון שהקוד האקראי זהה

    const res = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: oldCode });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
    await api.post('/api/auth/verify-email').send({ email: EMAIL, code: newCode }).expect(200);
  });

  it('keeps the send limits: re-registering inside the 60-second cooldown is rejected and changes nothing', async () => {
    const first = await api.post('/api/auth/register').send({ ...registration, password: 'Attacker1' }).expect(201);
    const res = await api.post('/api/auth/register').send(registration);
    expect(res.status).toBe(429);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.id).toBe(first.body.user.id); // לא נמחק ולא הוחלף
    await api.get('/api/auth/me').set('Authorization', `Bearer ${first.body.token}`).expect(200);
  });

  it('keeps the hourly send counter across replacements', async () => {
    await registerAndWaitCooldown();
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    await api.post('/api/auth/register').send(registration).expect(201);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.id).not.toBe(before.id);
    expect(after.verificationSendCount).toBe(before.verificationSendCount + 1);
    expect(after.verificationWindowStart?.getTime()).toBe(before.verificationWindowStart?.getTime());
  });

  it('never replaces a VERIFIED account', async () => {
    await api.post('/api/auth/register').send(registration).expect(201);
    const verified = await api.post('/api/auth/verify-email').send({ email: EMAIL, code: mailer.lastCodeFor(EMAIL) });
    expect(verified.status).toBe(200);

    const res = await api.post('/api/auth/register').send({ ...registration, password: 'Attacker1' });
    expect(res.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.id).toBe(verified.body.user.id);
    await api.post('/api/auth/login').send({ email: EMAIL, password: registration.password }).expect(200);
    await api.get('/api/auth/me').set('Authorization', `Bearer ${verified.body.token}`).expect(200);
  });

  it('concurrent re-registrations leave exactly one account and never fail with 500', async () => {
    await registerAndWaitCooldown({ ...registration, password: 'Attacker1' });
    const results = await Promise.all(
      ['Secret123', 'Secret456', 'Secret789'].map((password) =>
        api.post('/api/auth/register').send({ ...registration, password }),
      ),
    );
    for (const res of results) expect(res.status).toBeLessThan(500);
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('verifying while the account is being replaced cannot verify the old account', async () => {
    await registerAndWaitCooldown({ ...registration, password: 'Attacker1' });
    const oldCode = mailer.lastCodeFor(EMAIL)!;
    const [verify, register] = await Promise.all([
      api.post('/api/auth/verify-email').send({ email: EMAIL, code: oldCode }),
      api.post('/api/auth/register').send(registration),
    ]);
    for (const res of [verify, register]) expect(res.status).toBeLessThan(500);

    const users = await prisma.user.findMany({ where: { email: EMAIL } });
    expect(users).toHaveLength(1);
    // או שהאימות הקדים (ואז ההחלפה נדחתה), או שההחלפה הקדימה (ואז האימות נכשל) – לעולם לא שניהם
    if (verify.status === 200) {
      expect(register.status).toBe(409);
      expect(users[0]!.id).toBe(verify.body.user.id);
    } else {
      expect(register.status).toBe(201);
      expect(users[0]!.emailVerified).toBe(false);
    }
  });
});
