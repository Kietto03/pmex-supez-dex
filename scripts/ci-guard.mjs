#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Safety check for the automatic update (.github/workflows/update-datamine.yml).
   The parser works on text written by hand by the dataminer, so a format change can silently drop data.
   Usage:  node scripts/ci-guard.mjs snapshot out.json     (before the build)
           node scripts/ci-guard.mjs compare before.json   (after the build; exit 1 = do not publish)
   Rules: nothing the site had may disappear — pairs, scouts, Gym Battles and game versions never go down,
   the Gym Battles keep their circuits and leaders, and the build must not lose pair files.
   ═══════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SITE = path.join(import.meta.dirname, '..', 'site');
export function snapshot() {
  const js = fs.readFileSync(path.join(SITE, 'data/data.js'), 'utf8');
  const data = JSON.parse(js.slice(js.indexOf('=') + 1, js.lastIndexOf(';')));
  const gyms = JSON.parse(fs.readFileSync(path.join(SITE, 'data/gyms.json'), 'utf8'));
  const tags = JSON.parse(fs.readFileSync(path.join(SITE, 'data/pair-tags.json'), 'utf8'));
  return {
    pairs: data.pairs.length, scouts: (data.scouts || []).length, versions: data.versions || [],
    pairFiles: fs.readdirSync(path.join(SITE, 'data/pairs')).length, tags: Object.keys(tags).length,
    gyms: Object.fromEntries(gyms.gyms.map(g => [g.name, { circuits: g.circuits.length, leaders: g.stages[0]?.leaders.length || 0, stages: g.stages.length }])),
    ids: data.pairs.map(p => p.id),
  };
}
export function compare(before, after) {
  const bad = [];
  const down = (k, label) => { if (after[k] < before[k]) bad.push(`${label} went down: ${before[k]} → ${after[k]}`); };
  down('pairs', 'sync pairs'); down('scouts', 'scouts'); down('pairFiles', 'pair files'); down('tags', 'pair tags');
  for (const v of before.versions) if (!after.versions.includes(v)) bad.push(`game version ${v} disappeared`);
  const gone = before.ids.filter(id => !after.ids.includes(id));
  if (gone.length) bad.push(`${gone.length} sync pairs disappeared (${gone.slice(0, 5).join(', ')}…)`);
  for (const [name, g] of Object.entries(before.gyms)) {
    const a = after.gyms[name];
    if (!a) bad.push(`Gym Battle "${name}" disappeared`);
    else if (a.circuits < g.circuits || a.leaders < g.leaders || a.stages < g.stages) bad.push(`Gym Battle "${name}" lost data: ${JSON.stringify(g)} → ${JSON.stringify(a)}`);
  }
  return bad;
}
// Did the build change anything but its own timestamp? (data.js and gyms.json carry "builtAt")
export function meaningfulChange() {
  const files = execFileSync('git', ['status', '--porcelain', '--', 'site', 'config'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(l => l.slice(3));
  const strip = x => x.replace(/"builtAt":"[^"]*"/g, '"builtAt":""');
  return files.filter(f => {
    if (!/site\/data\/(data\.js|gyms\.json)$/.test(f)) return true;
    try { return strip(execFileSync('git', ['show', `HEAD:${f}`], { encoding: 'utf8', maxBuffer: 1 << 28 })) !== strip(fs.readFileSync(f, 'utf8')); } catch { return true; }
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'snapshot') { fs.writeFileSync(file, JSON.stringify(snapshot())); console.log('snapshot saved'); }
  else if (cmd === 'changed') {
    const f = meaningfulChange();
    console.log(f.length ? `changed: ${f.length} files (${f.slice(0, 4).join(', ')}…)` : 'nothing but the timestamp');
    process.exit(f.length ? 0 : 3);
  } else if (cmd === 'compare') {
    const before = JSON.parse(fs.readFileSync(file, 'utf8')), after = snapshot();
    const bad = compare(before, after);
    const added = after.pairs - before.pairs, gyms = Object.keys(after.gyms).filter(n => !before.gyms[n]);
    console.log(`pairs ${before.pairs} → ${after.pairs} (${added >= 0 ? '+' : ''}${added}), scouts ${before.scouts} → ${after.scouts}, versions ${after.versions.join(', ')}${gyms.length ? `, new Gym Battle: ${gyms.join(', ')}` : ''}`);
    if (bad.length) { console.error('NOT PUBLISHED:\n- ' + bad.join('\n- ')); process.exit(1); }
  } else { console.error('snapshot <file> | compare <file>'); process.exit(2); }
}
