import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/jwt';
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

describe('Profile – address', () => {
  const ADDRESS = 'רחוב הרצל 10, דירה 4, תל אביב';
  const patchMe = (auth: string, body: unknown) => api.patch('/api/auth/me').set('Authorization', auth).send(body as object);
  const savedAddress = async (id: number) => (await prisma.user.findUniqueOrThrow({ where: { id } })).address;

  it('an existing user has no address (null) by default', async () => {
    const { auth } = await createUser({ email: 'noa@test.com' });
    const res = await api.get('/api/auth/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.user.address).toBeNull();
  });

  it('adds an address (Hebrew, commas and digits) – returned, saved and shown in GET /me', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    const res = await patchMe(auth, { address: ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.user.address).toBe(ADDRESS);
    expect(await savedAddress(user.id)).toBe(ADDRESS);
    const me = await api.get('/api/auth/me').set('Authorization', auth);
    expect(me.body.user.address).toBe(ADDRESS);
  });

  it('updates an existing address', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    await patchMe(auth, { address: ADDRESS }).expect(200);
    await patchMe(auth, { address: 'שדרות רוטשילד 1, תל אביב' }).expect(200);
    expect(await savedAddress(user.id)).toBe('שדרות רוטשילד 1, תל אביב');
  });

  it('trims spaces around the address', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    const res = await patchMe(auth, { address: `   ${ADDRESS}   ` });
    expect(res.body.user.address).toBe(ADDRESS);
    expect(await savedAddress(user.id)).toBe(ADDRESS);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['spaces only', '    '],
  ])('deletes the address when sending %s', async (_name, value) => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    await patchMe(auth, { address: ADDRESS }).expect(200);
    const res = await patchMe(auth, { address: value });
    expect(res.status).toBe(200);
    expect(res.body.user.address).toBeNull();
    expect(await savedAddress(user.id)).toBeNull();
  });

  it('accepts exactly 200 characters and rejects 201 (400 on the address field)', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    await patchMe(auth, { address: 'א'.repeat(200) }).expect(200);

    const res = await patchMe(auth, { address: 'א'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'address', message: 'Address must be at most 200 characters' }]);
    expect(await savedAddress(user.id)).toBe('א'.repeat(200)); // הערך הקודם לא השתנה
  });

  it.each([
    ['a number', 12345],
    ['an object', { street: 'Herzl' }],
    ['an array', ['Herzl 10']],
    ['a boolean', true],
  ])('rejects %s as address (400) and changes nothing', async (_name, value) => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const res = await patchMe(auth, { address: value });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('address');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
  });

  it('changing the address does not change any other field', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com', fullName: 'Noa Levi' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await patchMe(auth, { address: ADDRESS }).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toEqual({ ...before, address: ADDRESS });
  });

  it('changing other fields keeps the address', async () => {
    const { user, auth } = await createUser({ email: 'noa@test.com' });
    await patchMe(auth, { address: ADDRESS }).expect(200);
    await patchMe(auth, { fullName: 'Noa Cohen', phone: '052-7654321' }).expect(200);
    expect(await savedAddress(user.id)).toBe(ADDRESS);
  });

  it('a user can set the address only on her own profile', async () => {
    const victim = await createUser({ email: 'victim@test.com' });
    const attacker = await createUser({ email: 'attacker@test.com' });

    // אין דרך לבחור משתמש אחר: id ו-email בגוף הבקשה נדחים, והמזהה מגיע רק מה-Token
    await patchMe(attacker.auth, { id: victim.user.id, address: 'Hacked' }).expect(400);
    await patchMe(attacker.auth, { email: 'victim@test.com', address: 'Hacked' }).expect(400);
    const res = await patchMe(attacker.auth, { address: 'Attacker address' });
    expect(res.body.user.id).toBe(attacker.user.id);

    expect(await savedAddress(victim.user.id)).toBeNull();
    expect(await savedAddress(attacker.user.id)).toBe('Attacker address');
  });

  it('requires authentication (401) and rejects an invalid token', async () => {
    await api.patch('/api/auth/me').send({ address: ADDRESS }).expect(401);
    await api.patch('/api/auth/me').set('Authorization', 'Bearer not-a-token').send({ address: ADDRESS }).expect(401);
  });

  it('a Google-only user (no password) can add an address', async () => {
    const google = await prisma.user.create({
      data: { fullName: 'Google User', email: 'g@gmail.com', googleId: 'sub-g', role: 'Client', emailVerified: true },
    });
    const auth = `Bearer ${signAccessToken(google)}`;
    const res = await patchMe(auth, { address: ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ address: ADDRESS, googleLinked: true });
  });

  it('an admin can set her own address and stays Admin', async () => {
    const admin = await createUser({ email: 'admin@test.com', role: 'Admin' });
    const res = await patchMe(admin.auth, { address: 'משרד הסטודיו, חולון' });
    expect(res.body.user).toMatchObject({ role: 'Admin', address: 'משרד הסטודיו, חולון' });
  });

  it('the address is returned on login as well', async () => {
    const { auth } = await createUser({ email: 'noa@test.com', password: 'Password1' });
    await patchMe(auth, { address: ADDRESS }).expect(200);
    const login = await api.post('/api/auth/login').send({ email: 'noa@test.com', password: 'Password1' });
    expect(login.status).toBe(200);
    expect(login.body.user.address).toBe(ADDRESS);
  });

  it('registration does not accept an address', async () => {
    const res = await api
      .post('/api/auth/register')
      .send({ fullName: 'Noa Levi', email: 'new@test.com', phone: '050-1234567', password: 'Secret123', address: ADDRESS });
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'new@test.com' } })).toBe(0);
  });

  it('the database rejects a blank address even outside the API (CHECK constraint)', async () => {
    const { user } = await createUser({ email: 'noa@test.com' });
    await expect(prisma.user.update({ where: { id: user.id }, data: { address: '   ' } })).rejects.toThrow();
    expect(await savedAddress(user.id)).toBeNull();
  });
});
