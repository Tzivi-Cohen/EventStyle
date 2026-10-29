import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCorsOrigins } from '../src/config/env';
import { openApiDocument } from '../src/docs/openapi';
import { api, prisma, resetDatabase } from './helpers';

beforeAll(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('Health and packages', () => {
  it('GET /api/health reports server and database status', async () => {
    const res = await api.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('GET /api/packages returns the packages with numeric prices', async () => {
    const res = await api.get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Basic', 'Premium', 'Luxury']);
    expect(typeof res.body[0].price).toBe('number');
    expect(Array.isArray(res.body[0].features)).toBe(true);
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await api.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('CORS allows the configured origin only', async () => {
    const allowed = await api.get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const blocked = await api.get('/api/health').set('Origin', 'http://evil.example');
    expect(blocked.status).toBe(403);
  });

  it('CORS_ORIGIN entries are trimmed and lose a trailing slash (the browser Origin never has one)', () => {
    expect(parseCorsOrigins(' https://eventstyle.onrender.com/ , http://localhost:5173,')).toEqual([
      'https://eventstyle.onrender.com',
      'http://localhost:5173',
    ]);
  });
});

describe('Swagger / OpenAPI', () => {
  it('the OpenAPI document is valid OpenAPI 3', async () => {
    const copy = JSON.parse(JSON.stringify(openApiDocument));
    await expect(SwaggerParser.validate(copy)).resolves.toBeTruthy();
  });

  it('documents all 35 operations (17 required + Google sign-in + profile edit + 4 package management + 3 gallery management + 5 private photos + 4 event requests)', () => {
    const operations = Object.entries(openApiDocument.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/google',
        'GET /api/auth/me',
        'PATCH /api/auth/me',
        'GET /api/packages',
        'POST /api/packages',
        'PUT /api/packages/{id}',
        'DELETE /api/packages/{id}',
        'GET /api/admin/packages',
        'GET /api/gallery',
        'POST /api/gallery',
        'DELETE /api/gallery/{id}',
        'PATCH /api/gallery/{id}',
        'GET /api/gallery/summary',
        'GET /api/admin/gallery',
        'GET /api/events',
        'GET /api/events/my',
        'GET /api/events/{id}',
        'POST /api/events',
        'PUT /api/events/{id}',
        'PATCH /api/events/{id}/status',
        'DELETE /api/events/{id}',
        'GET /api/events/{id}/photos',
        'POST /api/events/{id}/photos',
        'GET /api/events/{id}/photos/{photoId}',
        'DELETE /api/events/{id}/photos/{photoId}',
        'PUT /api/events/{id}/photos/{photoId}/consent',
        'POST /api/events/{id}/photos/{photoId}/publish',
        'GET /api/admin/event-photos',
        'POST /api/events/requests',
        'PATCH /api/events/{id}/request',
        'POST /api/events/{id}/approve',
        'POST /api/events/{id}/reject',
        'GET /api/health',
      ].sort(),
    );
  });

  it('every documented operation is registered in the server, and every protected one rejects guests (401)', async () => {
    for (const [path, methods] of Object.entries(openApiDocument.paths)) {
      const url = path.replace(/\{[^}]+\}/g, '1');
      for (const [method, operation] of Object.entries(methods as Record<string, { security?: unknown[] }>)) {
        const res = await (api as unknown as Record<string, (u: string) => Promise<{ status: number; body: { error?: { message?: string } } }>>)[method](url);
        expect(res.body.error?.message ?? '', `${method.toUpperCase()} ${path}`).not.toMatch(/^Route .* not found$/);
        if (operation.security) expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      }
    }
  });

  it('serves Swagger UI at /api-docs and the JSON at /api-docs.json', async () => {
    const ui = await api.get('/api-docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const json = await api.get('/api-docs.json');
    expect(json.body.openapi).toMatch(/^3\./);
    expect(json.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('/docs redirects to Swagger UI', async () => {
    const res = await api.get('/docs');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/api-docs/');
  });

  it('docs/openapi.json is up to date with the code (run npm run openapi:generate)', () => {
    const file = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  });
});

describe('Prisma', () => {
  it('schema.prisma is valid', () => {
    const output = execSync('npx prisma validate', { encoding: 'utf8', stdio: 'pipe' });
    expect(output).toMatch(/is valid/);
  });

  it('all migrations are applied to the database', () => {
    const output = execSync('npx prisma migrate status', { encoding: 'utf8', stdio: 'pipe' });
    expect(output).toMatch(/Database schema is up to date/);
  });

  it('has the 5 required tables', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
    expect(tables.map((t) => t.table_name).sort()).toEqual(
      ['EventPhotos', 'Events', 'GalleryItems', 'Packages', 'Users'].sort(),
    );
  });
});
