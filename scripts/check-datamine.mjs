#!/usr/bin/env node
// Compare the latest source's passive names and scout IDs with generated output.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.env.PMEX_DATAMINE || path.join(root, 'datamine'));
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'site/data/data.js'), 'utf8'), context);
const data = context.window.PMEX_DATA;
const latest = data.versions.at(-1);
const dir = path.join(source, latest);
const read = pattern => {
  const file = fs.readdirSync(dir).find(f => pattern.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r/g, '') : '';
};
const details = [];
context.window.PMEX_PAIR_LOADED = (_, p) => details.push(p);
for (const p of data.pairs.filter(p => p.versions.includes(latest))) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site/data/pairs', `${p.id}.js`), 'utf8'), context);
}
let passiveCount = 0;
let maxCount = 0;
for (const block of read(/Trainer\.txt$/).split(/-------------------------------END-------------------------------/)) {
  const key = block.match(/^No\.\s*\d+\s+.+$/m)?.[0].trim();
  if (!key) continue;
  const form = block.match(/^Form:\s*(.+)$/m)?.[1].trim();
  const pair = details.find(p => (p.key === key || p.key === `${key} - ${form}`) && (!form || p.form === form));
  assert.ok(pair, `Missing pair: ${key} ${form || ''}`);
  const parsed = [...(pair.passives || []), ...(pair.teraPassives || []), ...(pair.superPassive ? [pair.superPassive] : [])];
  for (const match of block.matchAll(/^(?:Passive\s+\d+(?:\([^)]*\))?|[^\n]*Superawakened Passive):\s*(.+)$/gm)) {
    const name = match[1].trim();
    assert.ok(parsed.some(p => p.name === name && p.description), `Missing passive: ${key} / ${name}`);
    passiveCount++;
  }
  for (const match of block.matchAll(/^(?:🔥\s*)?Max Move\s+(\d+):\s*(.+)$/gm)) {
    const slot = Number(match[1]), name = match[2].trim();
    const kind = name.startsWith('G-Max') ? 'gigantamax' : 'dynamax';
    const form = pair.altSprites?.find(f => f.kind === kind);
    assert.ok(form?.maxMoves?.some(m => m.fromSlot === slot && m.name === name && m.description),
      `Missing Max Move: ${key} / slot ${slot} / ${name}`);
    maxCount++;
  }
}
const ids = [...read(/Sync Pair Scout\.txt$/).matchAll(/^\[(event_[^\]]+)\]\s*$/gm)].map(m => m[1]);
for (const id of ids) {
  const scout = data.scouts.find(s => s.id === id);
  assert.ok(scout?.title && scout.scoutType && scout.start, `Missing/incomplete scout: ${id}`);
}
console.log(`Source check v${latest}: ${passiveCount} passives, ${maxCount} Max Moves and ${ids.length} scouts preserved.`);
