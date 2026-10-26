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

  it('does NOT link to an unverified account (protects against email squatting)', async () => {
    await createUser({ email: 'noa.google@gmail.com', verified: false, password: 'Squatter1' });
    const res = await signIn(googleToken());
    expect(res.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'noa.google@gmail.com' } });
    expect(user.googleId).toBeNull();
    expect(user.passwordHash).not.toBeNull(); // לא נמחקה שום סיסמה
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
