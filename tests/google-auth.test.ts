import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { api, createUser, eventBody, createAdmin, mailer, prisma, resetDatabase } from './helpers';

/**
 * הבדיקות מריצות את האימות האמיתי של google-auth-library (חתימה, issuer, audience, תוקף).
 * רק המפתחות הציבוריים של Google מוחלפים במפתח שנוצר כאן – כך אפשר לחתום טוקנים לבדיקה בלי רשת.
 */
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';
const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const googleKeys = keyPair();
const attackerKeys = keyPair();

function googleToken(claims: Record<string, unknown> = {}, options: { key?: string; kid?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-sub-1',
      email: 'noa.google@gmail.com',
      email_verified: true,
      name: 'Noa Google',
      iat: now,
      exp: now + 3600,
      ...claims,
    },
    options.key ?? googleKeys.privateKey,
    { algorithm: 'RS256', keyid: options.kid ?? KID },
  );
}

const signIn = (idToken: string) => api.post('/api/auth/google').send({ idToken });

beforeEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
  vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { [KID]: googleKeys.publicKey },
    format: 'PEM',
  } as never);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

describe('Google sign-in – new users', () => {
  it('creates a Client on first sign-in and returns the system JWT', async () => {
    const res = await signIn(googleToken());
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({
      email: 'noa.google@gmail.com',
      fullName: 'Noa Google',
      role: 'Client',
      emailVerified: true,
      googleLinked: true,
      phone: null,
    });
    expect(res.body.user).not.toHaveProperty('googleId');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // ה-JWT של המערכת עובד כרגיל
    const me = await api.get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('noa.google@gmail.com');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'noa.google@gmail.com' } });
    expect(user.googleId).toBe('google-sub-1');
    expect(user.passwordHash).toBeNull();
  });

  it('second sign-in finds the same user by Google sub (even if the Google email changed)', async () => {
    const first = await signIn(googleToken());
    const second = await signIn(googleToken({ email: 'renamed@gmail.com' }));
    expect(second.status).toBe(200);
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links existing events immediately when Google is the email provider', async () => {
    const admin = await createAdmin();
    await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'noa.google@gmail.com' })).expect(201);
    const res = await signIn(googleToken());
    const my = await api.get('/api/events/my').set('Authorization', `Bearer ${res.body.token}`);
    expect(my.body.data).toHaveLength(1);
  });

  it('a non-Google email domain is NOT trusted: account is unverified until the email code is confirmed', async () => {
    const admin = await createAdmin();
    await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'dana@company.co.il' })).expect(201);

    const res = await signIn(googleToken({ sub: 'sub-dana', email: 'dana@company.co.il', name: 'Dana' }));
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(false);
    const auth = `Bearer ${res.body.token}`;
    expect((await api.get('/api/events/my').set('Authorization', auth)).body.data).toHaveLength(0);

    // אימות רגיל בקוד במייל – גם למשתמש בלי סיסמה
    await api.post('/api/auth/resend-code').send({ email: 'dana@company.co.il' }).expect(200);
    const code = mailer.lastCodeFor('dana@company.co.il');
    const verify = await api.post('/api/auth/verify-email').send({ email: 'dana@company.co.il', code });
    expect(verify.status).toBe(200);
    expect(verify.body.linkedEventsCount).toBe(1);
  });

  it('a Google Workspace domain (hd claim) is trusted', async () => {
    const res = await signIn(googleToken({ sub: 'sub-ws', email: 'avi@studio.co.il', hd: 'studio.co.il' }));
    expect(res.body.user.emailVerified).toBe(true);
  });

  it('falls back to the email name when Google sends no name', async () => {
    const res = await signIn(googleToken({ name: undefined }));
    expect(res.body.user.fullName).toBe('noa.google');
  });
});

describe('Google sign-in – invalid tokens', () => {
  const expectRejected = async (idToken: string) => {
    const res = await signIn(idToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_AUTH_FAILED');
    // הטוקן לא מוחזר בהודעת השגיאה
    expect(JSON.stringify(res.body)).not.toContain(idToken);
    expect(await prisma.user.count()).toBe(0);
  };

  it('rejects a garbage token', () => expectRejected('not-a-jwt'));
  it('rejects a token signed by another key (bad signature)', () =>
    expectRejected(googleToken({}, { key: attackerKeys.privateKey })));
  it('rejects an unknown key id', () => expectRejected(googleToken({}, { kid: 'unknown-kid' })));
  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    return expectRejected(googleToken({ iat: past - 3600, exp: past }));
  });
  it('rejects a token for another app (wrong audience)', () =>
    expectRejected(googleToken({ aud: 'someone-else.apps.googleusercontent.com' })));
  it('rejects a token from another issuer', () => expectRejected(googleToken({ iss: 'https://evil.example' })));
  it('rejects a Google account whose email is not verified', async () => {
    const res = await signIn(googleToken({ email_verified: false }));
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/not verified/);
  });

  it('validates the request body', async () => {
    await api.post('/api/auth/google').send({}).expect(400);
    await api.post('/api/auth/google').send({ idToken: '' }).expect(400);
  });

  it('returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
    const original = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = undefined;
    try {
      const res = await signIn(googleToken());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('GOOGLE_AUTH_NOT_CONFIGURED');
    } finally {
      env.GOOGLE_CLIENT_ID = original;
    }
  });

  it('returns 502 when Google keys cannot be fetched', async () => {
    vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockRejectedValue(new Error('network down'));
    const res = await signIn(googleToken());
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GOOGLE_UNAVAILABLE');
  });
});

describe('Google sign-in – no privilege escalation', () => {
  it('rejects a role sent in the request body', async () => {
    const res = await api.post('/api/auth/google').send({ idToken: googleToken(), role: 'Admin' });
    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('ignores a role claim inside the token – new users are always Client', async () => {
    const res = await signIn(googleToken({ role: 'Admin' }));
    expect(res.body.user.role).toBe('Client');
  });

  it('never links to an Admin account, even with the same Gmail address', async () => {
    await createUser({ email: 'noa.google@gmail.com', role: 'Admin' });
    const res = await signIn(googleToken());
    expect(res.status).toBe(409);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'noa.google@gmail.com' } });
    expect(admin.googleId).toBeNull();
  });
});

describe('Google sign-in – existing accounts', () => {
  it('links a verified password account when Google owns the email; the password keeps working', async () => {
    const existing = await createUser({ email: 'noa.google@gmail.com', password: 'Password1' });
    const res = await signIn(googleToken());
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.user).toMatchObject({ id: existing.user.id, googleLinked: true, role: 'Client' });

    await api.post('/api/auth/login').send({ email: 'noa.google@gmail.com', password: 'Password1' }).expect(200);
  });

  it('does NOT link by email alone when Google is not the email provider', async () => {
    await createUser({ email: 'dana@company.co.il' });
    const res = await signIn(googleToken({ sub: 'sub-dana', email: 'dana@company.co.il' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'dana@company.co.il' } });
    expect(user.googleId).toBeNull();
  });

  it('rejects a second Google account for an email that is already linked', async () => {
    await signIn(googleToken());
    const res = await signIn(googleToken({ sub: 'another-google-sub' }));
    expect(res.status).toBe(409);
  });

  it('a Google-only user cannot log in with a password, and the email cannot be re-registered', async () => {
    await signIn(googleToken());
    const login = await api.post('/api/auth/login').send({ email: 'noa.google@gmail.com', password: 'Anything1' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');

    const register = await api
      .post('/api/auth/register')
      .send({ fullName: 'Someone', email: 'noa.google@gmail.com', phone: '050-1234567', password: 'Password1' });
    expect(register.status).toBe(409);
  });

  it('a Google user with an unverified (non-Google) email cannot be taken over by password registration', async () => {
    await signIn(googleToken({ sub: 'sub-dana', email: 'dana@company.co.il' }));
    const register = await api
      .post('/api/auth/register')
      .send({ fullName: 'Attacker', email: 'dana@company.co.il', phone: '050-1234567', password: 'Password1' });
    expect(register.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'dana@company.co.il' } });
    expect(user.passwordHash).toBeNull();
  });
});

describe('Google sign-in – reclaiming an unverified (squatted) email', () => {
  const EMAIL = 'noa.google@gmail.com';

  /** "תוקף" נרשם עם הכתובת של נועה ולא מאמת אותה – ומקבל JWT משלו */
  async function squat(email = EMAIL) {
    const reg = await api
      .post('/api/auth/register')
      .send({ fullName: 'Squatter', email, phone: '050-9999999', password: 'Squatter1' });
    expect(reg.status).toBe(201);
    return { id: reg.body.user.id as number, auth: `Bearer ${reg.body.token}` };
  }

  it('the real Gmail owner reclaims the address: new verified Google account with a new id', async () => {
    const squatter = await squat();
    const res = await signIn(googleToken());
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({
      email: EMAIL,
      fullName: 'Noa Google',
      role: 'Client',
      emailVerified: true,
      googleLinked: true,
      phone: null, // הטלפון של החשבון הישן לא עובר
    });
    expect(res.body.user.id).not.toBe(squatter.id);

    const users = await prisma.user.findMany({ where: { email: EMAIL } });
    expect(users).toHaveLength(1);
    expect(users[0]!.googleId).toBe('google-sub-1');
    expect(users[0]!.passwordHash).toBeNull();
    expect(users[0]!.verificationCodeHash).toBeNull();
  });

  it('the password of the squatter stops working', async () => {
    await squat();
    await signIn(googleToken()).expect(200);
    const login = await api.post('/api/auth/login').send({ email: EMAIL, password: 'Squatter1' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('the old JWT of the squatter is rejected (401) everywhere', async () => {
    const squatter = await squat();
    await api.get('/api/auth/me').set('Authorization', squatter.auth).expect(200);

    await signIn(googleToken()).expect(200);

    for (const path of ['/api/auth/me', '/api/events/my']) {
      const res = await api.get(path).set('Authorization', squatter.auth);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    await api.patch('/api/auth/me').set('Authorization', squatter.auth).send({ fullName: 'Hacked' }).expect(401);
  });

  it('pending events are linked to the real owner only, never to the squatter', async () => {
    const admin = await createAdmin();
    const created = await api
      .post('/api/events')
      .set('Authorization', admin.auth)
      .send(eventBody({ clientEmail: EMAIL }))
      .expect(201);
    expect(created.body.userId).toBeNull();

    const squatter = await squat();
    expect((await api.get('/api/events/my').set('Authorization', squatter.auth)).body.data).toHaveLength(0);

    const owner = await signIn(googleToken());
    const my = await api.get('/api/events/my').set('Authorization', `Bearer ${owner.body.token}`);
    expect(my.body.data.map((e: { id: number }) => e.id)).toEqual([created.body.id]);

    await api.get(`/api/events/${created.body.id}`).set('Authorization', squatter.auth).expect(401);
  });

  it('the verification code of the squatter can no longer be used', async () => {
    await squat();
    const code = mailer.lastCodeFor(EMAIL)!;
    await signIn(googleToken()).expect(200);

    const verify = await api.post('/api/auth/verify-email').send({ email: EMAIL, code });
    expect(verify.status).toBe(409); // החשבון כבר מאומת – אין קוד פעיל
    expect(verify.body).not.toHaveProperty('token');
  });

  it('after reclaiming, the same Google account signs in to the same user (no duplicates)', async () => {
    await squat();
    const first = await signIn(googleToken());
    const second = await signIn(googleToken());
    expect(second.status).toBe(200);
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('works for a Google Workspace domain (hd claim)', async () => {
    await squat('avi@studio.co.il');
    const res = await signIn(googleToken({ sub: 'sub-ws', email: 'avi@studio.co.il', hd: 'studio.co.il' }));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'avi@studio.co.il', emailVerified: true, googleLinked: true });
  });

  it('a VERIFIED password account is never replaced: linked in place, same id, password still works', async () => {
    const existing = await createUser({ email: EMAIL, password: 'Password1', verified: true });
    const res = await signIn(googleToken());
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.user.id).toBe(existing.user.id);
    await api.get('/api/auth/me').set('Authorization', existing.auth).expect(200); // ה-JWT הקיים ממשיך לעבוד
    await api.post('/api/auth/login').send({ email: EMAIL, password: 'Password1' }).expect(200);
  });

  it('an Admin account is never replaced, even if it is not verified', async () => {
    const admin = await createUser({ email: EMAIL, role: 'Admin', verified: false, password: 'AdminPass1' });
    const res = await signIn(googleToken());
    expect(res.status).toBe(409);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user).toMatchObject({ id: admin.user.id, role: 'Admin', googleId: null });
    await api.get('/api/auth/me').set('Authorization', admin.auth).expect(200);
    await api.post('/api/auth/login').send({ email: EMAIL, password: 'AdminPass1' }).expect(200);
  });

  it('an unverified account with a NON-Google email is not replaced (Google does not prove ownership)', async () => {
    const squatter = await squat('dana@company.co.il');
    const res = await signIn(googleToken({ sub: 'sub-dana', email: 'dana@company.co.il' }));
    expect(res.status).toBe(409);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'dana@company.co.il' } });
    expect(user.id).toBe(squatter.id);
    expect(user.googleId).toBeNull();
    expect(user.passwordHash).not.toBeNull();
  });

  it('an unverified account already linked to another Google account is not replaced', async () => {
    // משתמש Google מדומיין שאינו של Google נשאר לא מאומת
    const first = await signIn(googleToken({ sub: 'sub-a', email: 'dana@company.co.il' }));
    expect(first.body.user.emailVerified).toBe(false);

    const res = await signIn(googleToken({ sub: 'sub-b', email: 'dana@company.co.il', hd: 'company.co.il' }));
    expect(res.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'dana@company.co.il' } });
    expect(user).toMatchObject({ id: first.body.user.id, googleId: 'sub-a' });
  });

  it('concurrent Google sign-ins for a squatted email create exactly one account', async () => {
    await squat();
    const results = await Promise.all([signIn(googleToken()), signIn(googleToken()), signIn(googleToken())]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(200);
    for (const status of statuses) expect([200, 409]).toContain(status);

    const users = await prisma.user.findMany({ where: { email: EMAIL } });
    expect(users).toHaveLength(1);
    expect(users[0]!.googleId).toBe('google-sub-1');
    // כל מי שקיבל 200 קיבל את אותו משתמש
    const ids = new Set(results.filter((r) => r.status === 200).map((r) => r.body.user.id));
    expect([...ids]).toEqual([users[0]!.id]);
  });

  it('a concurrent password re-registration and Google sign-in never leave two accounts', async () => {
    await squat();
    await prisma.user.update({ where: { email: EMAIL }, data: { verificationLastSentAt: new Date(Date.now() - 61_000) } });
    const [google, register] = await Promise.all([
      signIn(googleToken()),
      api.post('/api/auth/register').send({ fullName: 'Other', email: EMAIL, phone: '050-1111111', password: 'Other1234' }),
    ]);
    for (const res of [google, register]) expect(res.status).toBeLessThan(500);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });
});
