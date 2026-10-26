import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createUser, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('Profile – GET /api/auth/me', () => {
  it('returns the current user without sensitive fields', async () => {
    const { auth } = await createUser({ email: 'noa@test.com' });
    const res = await api.get('/api/auth/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'noa@test.com', googleLinked: false });
    for (const field of ['passwordHash', 'googleId', 'verificationCodeHash', 'verificationAttempts']) {
      expect(res.body.user).not.toHaveProperty(field);
    }
  });
});

describe('Profile – PATCH /api/auth/me', () => {
  it('updates name and phone of the logged-in user', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    const res = await api.patch('/api/auth/me').set('Authorization', auth).send({ fullName: '  Noa Cohen  ', phone: '052-7654321' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, fullName: 'Noa Cohen', phone: '052-7654321', email: 'noa@test.com' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved).toMatchObject({ fullName: 'Noa Cohen', phone: '052-7654321' });
  });

  it('allows updating a single field', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com', fullName: 'Noa Levi' });
    await api.patch('/api/auth/me').set('Authorization', auth).send({ phone: '+972 50 123 4567' }).expect(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.fullName).toBe('Noa Levi');
    expect(saved.phone).toBe('+972 50 123 4567');
  });

  it('requires authentication', async () => {
    await api.patch('/api/auth/me').send({ fullName: 'Hacker' }).expect(401);
  });

  it.each([
    ['role', { role: 'Admin' }],
    ['email', { email: 'new@test.com' }],
    ['googleId', { googleId: 'some-sub' }],
    ['emailVerified', { emailVerified: true }],
    ['password', { password: 'NewPassword1' }],
    ['passwordHash', { passwordHash: 'x' }],
    ['id', { id: 999 }],
  ])('rejects changing the forbidden field "%s" (400) and changes nothing', async (_name, body) => {
    const { user, auth } = await createUser({ email: 'noa@test.com', fullName: 'Noa Levi' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const res = await api.patch('/api/auth/me').set('Authorization', auth).send({ fullName: 'Changed Name', ...body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
  });

  it('a user cannot edit another user profile', async () => {
    const victim = await createUser({ email: 'victim@test.com', fullName: 'Victim Name' });
    const attacker = await createUser({ email: 'attacker@test.com', fullName: 'Attacker' });

    // אין דרך לבחור משתמש אחר: המזהה מגיע רק מה-Token, ושדה id נדחה
    await api.patch('/api/auth/me').set('Authorization', attacker.auth).send({ id: victim.user.id, fullName: 'Hacked' }).expect(400);
    const res = await api.patch('/api/auth/me').set('Authorization', attacker.auth).send({ fullName: 'Hacked' });
    expect(res.body.user.id).toBe(attacker.user.id);

    const victimNow = await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } });
    expect(victimNow.fullName).toBe('Victim Name');
  });

  it('validates the values', async () => {
    const { auth } = await createUser({ email: 'noa@test.com' });
    const empty = await api.patch('/api/auth/me').set('Authorization', auth).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details[0].message).toMatch(/at least one field/);
    await api.patch('/api/auth/me').set('Authorization', auth).send({ fullName: 'A' }).expect(400);
    await api.patch('/api/auth/me').set('Authorization', auth).send({ phone: 'abc' }).expect(400);
    await api.patch('/api/auth/me').set('Authorization', auth).send({ phone: null }).expect(400);
  });

  it('an admin can edit only her own profile, and the role stays Admin', async () => {
    const admin = await createUser({ email: 'admin@test.com', role: 'Admin' });
    const res = await api.patch('/api/auth/me').set('Authorization', admin.auth).send({ fullName: 'Studio Manager' });
    expect(res.body.user).toMatchObject({ role: 'Admin', fullName: 'Studio Manager' });
  });
});
