import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase, isLocalTestDatabase, isSameDatabase } from './databaseGuard';

describe('Test database guard', () => {
  const dev = 'postgresql://postgres:secret@localhost:5432/eventstyle';
  const localTest = 'postgresql://postgres:secret@localhost:5432/eventstyle_test';

  it('detects the same database written differently', () => {
    expect(isSameDatabase(dev, dev)).toBe(true);
    expect(isSameDatabase(dev, 'postgresql://other:pw@127.0.0.1/eventstyle?schema=public')).toBe(true);
    expect(isSameDatabase(dev, 'postgres://postgres:secret@[::1]:5432/EventStyle')).toBe(true);
    expect(isSameDatabase(dev, ' postgresql://postgres:secret@LOCALHOST:5432/eventstyle ')).toBe(true);
    expect(isSameDatabase(dev, 'postgresql://postgres@whatever/eventstyle?host=127.0.0.1')).toBe(true);
  });

  it('allows a separate test database', () => {
    expect(isSameDatabase(dev, localTest)).toBe(false);
    expect(isSameDatabase(dev, 'postgresql://postgres:secret@localhost:5433/eventstyle')).toBe(false);
    expect(isSameDatabase(dev, 'postgresql://postgres:secret@db.example.com:5432/eventstyle')).toBe(false);
  });

  it('accepts only a local database whose name marks it as a test database', () => {
    expect(isLocalTestDatabase(localTest)).toBe(true);
    expect(isLocalTestDatabase('postgres://u:p@127.0.0.1:5433/my_test_db')).toBe(true);
    expect(isLocalTestDatabase('postgresql://u:p@[::1]/EventStyle_TEST')).toBe(true);
    expect(isLocalTestDatabase('postgresql://u:p@127.0.0.2/eventstyle_test')).toBe(true);
    expect(isLocalTestDatabase('postgresql:///eventstyle_test')).toBe(true);
    expect(isLocalTestDatabase('postgresql:///eventstyle_test?host=/var/run/postgresql')).toBe(true);

    expect(isLocalTestDatabase(dev)).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@localhost:5432/')).toBe(false);
  });

  it('rejects every remote database: Neon, Render and any other host', () => {
    expect(isLocalTestDatabase('postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/eventstyle_test?sslmode=require')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com/eventstyle_test')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@dpg-abc123-a/eventstyle_test')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@192.168.1.20:5432/eventstyle_test')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@localhost.evil.com/eventstyle_test')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@db.example.com/eventstyle_test?host=localhost.example.com')).toBe(false);
    expect(isLocalTestDatabase('postgresql://u:p@host1,host2/eventstyle_test')).toBe(false);
  });

  it('rejects values it cannot read with certainty (fails closed)', () => {
    expect(isLocalTestDatabase('postgresql://u@/eventstyle_test?host=/var/run/postgresql')).toBe(false);
    expect(isLocalTestDatabase('')).toBe(false);
    expect(isLocalTestDatabase('not a url')).toBe(false);
    expect(isLocalTestDatabase('mysql://u:p@localhost/eventstyle_test')).toBe(false);
  });

  it('assertSafeTestDatabase stops with a message that never contains connection values', () => {
    const neon = 'postgresql://neon_user:VerySecretPassword@ep-x.eu-central-1.aws.neon.tech/neondb_test';
    expect(() => assertSafeTestDatabase(localTest, [dev, undefined])).not.toThrow();
    expect(() => assertSafeTestDatabase(neon, [dev])).toThrow(/local PostgreSQL test database/);
    expect(() => assertSafeTestDatabase(localTest, [localTest.replace('localhost', '127.0.0.1')])).toThrow(/same database/);
    try {
      assertSafeTestDatabase(neon, [dev]);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/VerySecretPassword|neon_user|ep-x/);
    }
  });
});
