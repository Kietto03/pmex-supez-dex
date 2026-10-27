#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Crawl pomatools.site (PoMastersTool by HsinChang) static JSON
   into .cache/pomatools/ — raw files, untouched (gitignored).

   Usage:  npm run crawl                (skip files already cached)
           npm run crawl -- --refresh   (re-download the index files)

   Polite by design: 2 requests in flight, small delay, identifies itself,
   caches everything so re-runs only fetch new pairs.
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.pomatools.site';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'pomatools'); // repo/.cache/pomatools
const REFRESH = process.argv.includes('--refresh');
const CONCURRENCY = 2;
const DELAY_MS = 250;
const HEADERS = { 'User-Agent': 'pmex-datamine-dex/1.0 (fan viewer; github.com/absolutelypm/pokemas-datamine)' };

const INDEX_FILES = [
  'data/sync_meta_list.json',
  'data/core/move_database.json',
  'data/core/passive_database.json',
];
// PoMaTools used to publish one locales/en.json. It now serves the English text in modules; the build still reads
// the single file, so the modules are merged back into it here (an old copy is kept if a module cannot be read).
const LOCALE_MODULES = ['common', 'base', 'moves', 'passives', 'tiles', 'events'];
const LOCALE_ONLY = process.argv.includes('--locale-only');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(rel, { force = false } = {}) {
  const dest = path.join(OUT, rel);
  if (!force && fs.existsSync(dest)) return 'cached';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${BASE}/${rel}`, { headers: HEADERS });
      const type = r.headers.get('content-type') || '';
      // Unknown paths fall back to the SPA's index.html with a 200 — treat as missing
      if (!r.ok || !type.includes('json')) return `missing (${r.status})`;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return 'ok';
    } catch (e) {
      if (attempt === 3) return `error: ${e.message}`;
      await sleep(1000 * attempt);
    }
  }
}

async function fetchLocale() {
  const dest = path.join(OUT, 'locales/en.json');
  if (!REFRESH && fs.existsSync(dest)) return 'cached';
  const merged = {};
  for (const m of LOCALE_MODULES) {
    const r = await fetch(`${BASE}/locales/modules/en/${m}.json`, { headers: HEADERS }).catch(() => null);
    if (!r?.ok || !(r.headers.get('content-type') || '').includes('json')) return `module ${m} missing${fs.existsSync(dest) ? ' (kept the old file)' : ''}`;
    Object.assign(merged, await r.json());   // flat keys: a later module never needs to merge into an earlier one
  }
  if (Object.keys(merged).length < 30000) return `only ${Object.keys(merged).length} texts${fs.existsSync(dest) ? ' (kept the old file)' : ''}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(merged));
  return `ok (${Object.keys(merged).length} texts)`;
}
for (const f of INDEX_FILES) console.log(f, await get(f, { force: REFRESH }));
const localeResult = await fetchLocale();
console.log('locales/en.json', localeResult);
if (!fs.existsSync(path.join(OUT, 'locales/en.json'))) { console.error('No English texts: the build cannot run.'); process.exit(1); }
if (LOCALE_ONLY) process.exit(0);

const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'data/sync_meta_list.json'), 'utf8'));
const ids = Object.keys(meta);
let done = 0, fetched = 0;
const failed = [];

async function worker(queue) {
  while (queue.length) {
    const id = queue.shift();
    const res = await get(`data/pairs/${id}.json`);
    done++;
    if (res === 'ok') { fetched++; await sleep(DELAY_MS); }
    else if (res !== 'cached') failed.push(`${id}: ${res}`);
    if (done % 50 === 0 || done === ids.length) process.stdout.write(`\rpairs ${done}/${ids.length} (new ${fetched})`);
  }
}
const queue = [...ids];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`\nfailed: ${failed.length}${failed.length ? '\n' + failed.join('\n') : ''}`);
