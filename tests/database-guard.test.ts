import { describe, expect, it } from 'vitest';
import { isSameDatabase } from './databaseGuard';

describe('Test database guard', () => {
  const dev = 'postgresql://postgres:secret@localhost:5432/eventstyle';

  it('detects the same database written differently', () => {
    expect(isSameDatabase(dev, dev)).toBe(true);
    expect(isSameDatabase(dev, 'postgresql://other:pw@127.0.0.1/eventstyle?schema=public')).toBe(true);
    expect(isSameDatabase(dev, 'postgres://postgres:secret@[::1]:5432/EventStyle')).toBe(true);
    expect(isSameDatabase(dev, ' postgresql://postgres:secret@LOCALHOST:5432/eventstyle ')).toBe(true);
    expect(isSameDatabase(dev, 'postgresql://postgres@whatever/eventstyle?host=127.0.0.1')).toBe(true);
  });

  it('allows a separate test database', () => {
    expect(isSameDatabase(dev, 'postgresql://postgres:secret@localhost:5432/eventstyle_test')).toBe(false);
    expect(isSameDatabase(dev, 'postgresql://postgres:secret@localhost:5433/eventstyle')).toBe(false);
    expect(isSameDatabase(dev, 'postgresql://postgres:secret@db.example.com:5432/eventstyle')).toBe(false);
  });
});
