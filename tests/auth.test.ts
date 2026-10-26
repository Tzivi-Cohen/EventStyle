import jwt from 'jsonwebtoken';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createUser, prisma, resetDatabase } from './helpers';

const validRegistration = {
  fullName: 'Noa Levi',
  email: '  Noa@Test.COM ',
  phone: '050-1234567',
  password: 'Secret123',
};

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('POST /api/auth/register', () => {
  it('registers a Client with normalized email and returns token without password data', async () => {
    const res = await api.post('/api/auth/register').send(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'noa@test.com', role: 'Client', emailVerified: false });
    expect(res.body.verificationEmailSent).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|verificationCode/);

    const saved = await prisma.user.findUniqueOrThrow({ where: { email: 'noa@test.com' } });
    expect(saved.passwordHash).not.toBe('Secret123');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('cannot register as Admin (unknown field "role" is rejected)', async () => {
    const res = await api.post('/api/auth/register').send({ ...validRegistration, role: 'Admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.count()).toBe(0);
  });

  it('returns 409 when the email belongs to a verified account', async () => {
    await createUser({ email: 'noa@test.com', verified: true });
    const res = await api.post('/api/auth/register').send(validRegistration);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('validates input and reports field errors', async () => {
    const res = await api
      .post('/api/auth/register')
      .send({ fullName: 'N', email: 'not-an-email', phone: 'abc', password: 'short' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'email', 'phone', 'password']));
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await api.post('/api/auth/register').set('Content-Type', 'application/json').send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await createUser({ email: 'client@test.com', password: 'Password1' });
  });

  it('logs in with correct credentials (email is case-insensitive)', async () => {
    const res = await api.post('/api/auth/login').send({ email: ' CLIENT@test.com', password: 'Password1' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'client@test.com', role: 'Client' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with 401', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'client@test.com', password: 'Wrong1234' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same 401 message', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'nobody@test.com', password: 'Password1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('validates login input', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me and token handling', () => {
  it('returns the current user for a valid token', async () => {
    const { auth } = await createUser({ email: 'me@test.com' });
    const res = await api.get('/api/auth/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@test.com');
  });

  it('returns 401 when the token is missing', async () => {
    const res = await api.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await api.get('/api/auth/me').set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with another secret', async () => {
    const { user } = await createUser({ email: 'me@test.com' });
    const forged = jwt.sign({ role: 'Admin' }, 'some-other-secret-that-is-long-enough-123', { subject: String(user.id) });
    const res = await api.get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const { user } = await createUser({ email: 'me@test.com' });
    const expired = jwt.sign({ role: 'Client' }, process.env.JWT_SECRET!, { subject: String(user.id), expiresIn: -10 });
    const res = await api.get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the user of the token was deleted', async () => {
    const { user, auth } = await createUser({ email: 'gone@test.com' });
    await prisma.user.delete({ where: { id: user.id } });
    const res = await api.get('/api/auth/me').set('Authorization', auth);
    expect(res.status).toBe(401);
  });
});
