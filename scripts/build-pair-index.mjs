#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   site/data/pair-index.json — a small file for other tools (the gym manager): "<trainer>|<pokemon>" in lower case
   (the key pair-tags.json uses) → id of the pair's file in site/data/pairs/. Built from data.js, so it always
   matches the build it sits next to. Two pairs sharing a name keep the id that sorts first.
   ═══════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(import.meta.dirname, '..', 'site', 'data');
const js = fs.readFileSync(path.join(DATA, 'data.js'), 'utf8');
const data = JSON.parse(js.slice(js.indexOf('=') + 1, js.lastIndexOf(';')));
const pairs = {};
let shared = 0;
for (const p of [...data.pairs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const key = `${p.trainer}|${p.pokemon}`.toLowerCase();
  if (pairs[key] && pairs[key] !== p.id) { shared++; continue; }
  pairs[key] = p.id;
}
if (Object.keys(pairs).length < 300) { console.error('Too few pairs in data.js: pair-index.json not written.'); process.exit(1); }
fs.writeFileSync(path.join(DATA, 'pair-index.json'), JSON.stringify({ dexBuilt: data.builtAt || null, versions: data.versions || [], pairs }));
console.log(`pair index: ${Object.keys(pairs).length} pairs (${shared} shared names)`);
