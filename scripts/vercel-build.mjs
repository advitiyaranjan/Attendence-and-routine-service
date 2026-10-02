#!/usr/bin/env node
/**
 * Builds the whole app for Vercel using the Build Output API (v3):
 *
 *   .vercel/output/static/              the PWA (apps/web/dist)
 *   .vercel/output/functions/api.func/  the Express API bundled into one file,
 *                                        plus the Prisma client and query engine
 *   .vercel/output/config.json          /api/* → the function, everything else → the SPA
 *
 * We bundle with esbuild instead of letting Vercel compile api/*.ts because
 * @vercel/node can't compile with TypeScript 7 (used by this repo).
 *
 * Production builds then apply pending database migrations, as the last step,
 * so a build that fails earlier never changes the schema.
 *
 * Run locally with: npm run vercel-build
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api.func');
const schema = join(root, 'apps/server/prisma/schema.prisma');
const prismaBin = join(root, 'node_modules/.bin/prisma');

const run = (cmd, args, env = process.env) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env });
const step = (msg) => console.log(`\n▸ ${msg}`);

step('Generating the Prisma client');
run(prismaBin, ['generate', '--schema', schema]);

step('Building the web app');
run('npm', ['run', 'build', '-w', '@student-os/web']);

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

step('Copying the web app to static output');
await cp(join(root, 'apps/web/dist'), join(out, 'static'), { recursive: true });

step('Bundling the API function');
await build({
  entryPoints: [join(root, 'apps/server/src/vercel.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  // Prisma ships a native engine and is copied in below; the others are optional native add-ons.
  external: ['@prisma/client', '.prisma/client', 'bufferutil', 'utf-8-validate'],
  legalComments: 'none',
  logLevel: 'warning',
});

step('Adding the Prisma client and query engine');
const nm = join(fn, 'node_modules');
await cp(join(root, 'node_modules/.prisma/client'), join(nm, '.prisma/client'), {
  recursive: true,
  // Only the Node-API engine is used at runtime.
  filter: (src) => !/\.(d\.ts|wasm|mjs)$/.test(src) && !/(edge|wasm|index-browser)\.js$/.test(src),
});
const client = join(root, 'node_modules/@prisma/client');
for (const f of ['package.json', 'default.js', 'index.js']) await cp(join(client, f), join(nm, '@prisma/client', f));
await cp(join(client, 'runtime/library.js'), join(nm, '@prisma/client/runtime/library.js'));
const engines = (await readdir(join(nm, '.prisma/client'))).filter((f) => f.endsWith('.node'));
if (!engines.length) throw new Error('No Prisma query engine was generated.');
console.log(`  engines: ${engines.join(', ')}`);

await writeFile(
  join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      // Express reads the raw request itself (JSON and file uploads).
      shouldAddHelpers: false,
      // Leaves room for the AI time budget (AI_TIMEOUT_MS, 50 s by default).
      maxDuration: 60,
    },
    null,
    2,
  ),
);

// Push reminders for closed apps need a per-minute tick. Vercel's Hobby plan only
// allows daily cron jobs (and rejects deployments asking for more), so this is opt-in:
// set PUSH_CRON_SCHEDULE="* * * * *" on Pro, or call /api/cron/push from any scheduler.
const crons = process.env.PUSH_CRON_SCHEDULE ? [{ path: '/api/cron/push', schedule: process.env.PUSH_CRON_SCHEDULE }] : [];

await writeFile(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/sw\\.js$', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // The function sees the original path (e.g. /api/auth/me), so Express routes as usual.
        { src: '^/api(?:/(.*))?$', dest: '/api' },
        { handle: 'filesystem' },
        // Single-page app: every other path is rendered by index.html.
        { src: '/(.*)', dest: '/index.html' },
      ],
      ...(crons.length ? { crons } : {}),
    },
    null,
    2,
  ),
);

if (process.env.VERCEL_ENV === 'production') {
  // Prefer the direct (non-pooled) connection for schema changes, as Neon recommends.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  if (url) {
    step('Applying database migrations');
    run(prismaBin, ['migrate', 'deploy', '--schema', schema], { ...process.env, DATABASE_URL: url });
  } else {
    console.warn('\n⚠ No DATABASE_URL set: skipped migrations. Sign-in, sync and AI need a database (see README → Deploy to Vercel).');
  }
}

console.log(`\n✓ Vercel build output written to ${out}`);
if (!existsSync(join(out, 'static/index.html'))) throw new Error('Web build is missing index.html');
