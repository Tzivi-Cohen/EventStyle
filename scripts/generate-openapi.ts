/**
 * יוצר את docs/openapi.json מתוך הגדרת ה-OpenAPI שבקוד (src/docs/openapi.ts).
 * הרצה: npm run openapi:generate
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApiDocument } from '../src/docs/openapi';

const target = resolve(__dirname, '..', 'docs', 'openapi.json');
writeFileSync(target, `${JSON.stringify(openApiDocument, null, 2)}\n`, 'utf8');
console.log(`OpenAPI document written to ${target}`);
