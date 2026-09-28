#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   BUILD — parse every datamine version folder (datamine/2.xx/) and the
   optional PoMaTools crawl into site/data/, and download pixel sprites
   into site/assets/.

   Usage:  npm run build                 (parse + download missing sprites)
           npm run build -- --no-fetch   (parse only, offline)
   The datamine folder defaults to ./datamine (gitignored clone, `npm run setup-data`);
   override with PMEX_DATAMINE=/path/to/pokemas-datamine.
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPomatools } from './pomatools-import.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.env.PMEX_DATAMINE || path.join(REPO, 'datamine')); // dataminer's repo
const SITE = path.join(REPO, 'site');
const OUT_DATA = path.join(SITE, 'data', 'data.js');
const OUT_PAIRS = path.join(SITE, 'data', 'pairs');
const ASSETS = path.join(SITE, 'assets');
const POMA_DIR = path.join(REPO, '.cache', 'pomatools');
const NO_FETCH = process.argv.includes('--no-fetch');

if (!fs.existsSync(ROOT)) {
  console.error(`Datamine folder not found: ${ROOT}\nRun "npm run setup-data" or set PMEX_DATAMINE.`);
  process.exit(1);
}

const versions = fs.readdirSync(ROOT)
  .filter(d => /^\d+\.\d+$/.test(d) && fs.statSync(path.join(ROOT, d)).isDirectory())
  .sort((a, b) => parseFloat(a) - parseFloat(b));

const read = (v, pattern) => {
  const dir = path.join(ROOT, v);
  const file = fs.readdirSync(dir).find(f => pattern.test(f));
  return file ? { file, text: fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r/g, '') } : null;
};

// ─── Helpers ────────────────────────────────────────────────
const num = s => parseInt(String(s).replace(/[.,]/g, ''), 10);

function parseDate(s) {
  // "2/10/2026 06:00:00" or "30/09/2026 06:00" → ISO-ish "2026-10-02T06:00"
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = '06', mi = '00'] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}`;
}

function splitPairName(full) {
  // "Sygna Suit Lysandre (Alt.) & Chi-Yu (Genderless) - Tera Type Fire"
  let s = full.trim();
  let form = '';
  const formM = s.match(/\s+-\s+(.+)$/);
  if (formM) { form = formM[1].trim(); s = s.slice(0, formM.index); }
  const amp = s.indexOf(' & ');
  const trainer = amp > -1 ? s.slice(0, amp).trim() : s;
  let poke = amp > -1 ? s.slice(amp + 3) : '';
  let gender = '';
  const g = poke.match(/\((Male♂️|Female♀️|Genderless)\)/);
  if (g) { gender = g[1].replace(/[♂♀]️?/g, '').trim(); poke = poke.replace(g[0], ''); }
  const shiny = poke.includes('✨');
  poke = poke.replace(/✨/g, '').trim();
  return { trainer, pokemon: poke, gender, shiny, form };
}

function parseStatLine(line) {
  const stats = {};
  for (const part of line.split('|')) {
    const m = part.trim().match(/^(.+?)\s*:\s*([\d,.]+)$/);
    if (m) stats[m[1].trim()] = num(m[2]);
  }
  return stats;
}

function parseMoveStats(line) {
  const r = {};
  for (const part of line.split('|')) {
    const m = part.trim().match(/^(.+?):\s*(.+)$/);
    if (m) r[m[1].trim()] = m[2].trim();
  }
  return r;
}

// ─── Trainer.txt ────────────────────────────────────────────
function parseTrainers(text, version) {
  const body = text.slice(text.indexOf('=========', text.indexOf('=========') + 9) + 9);
  const blocks = body.split(/-------------------------------END-------------------------------/);
  const out = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const head = lines.findIndex(l => /^No\.\s*\d+\s+/.test(l));
    if (head < 0) continue;

    const hm = lines[head].match(/^No\.\s*(\d+)\s+(.+)$/);
    const names = splitPairName(hm[2]);
    const t = {
      key: lines[head], number: +hm[1], ...names, version,
      form: names.form, dialog: '', description: '', role: '', exRole: '',
      type: '', weakness: '', rarity: 0, expedition: '', method: '', itemExchange: '',
      collectInfo: '', exColor: false, teamSkills: [], dates: {},
      moves: [], syncMove: null, passives: [], superPassive: null, stats: {},
      megaStats: {}, teraMoves: [], teraPassives: [], megaMoves: [],
    };

    let section = 'info';
    let move = null;
    const pushMove = () => {
      if (!move) return;
      if (section === 'tera') t.teraMoves.push(move);
      else if (section === 'mega_moves') t.megaMoves.push(move);
      else if (move.isSync) t.syncMove = move;
      else t.moves.push(move);
      move = null;
    };

    for (let i = head + 1; i < lines.length; i++) {
      const line = lines[i];
      const after = (p) => line.slice(line.indexOf(p) + p.length).trim();

      if (section === 'info') {
        if (line.startsWith('Form:')) { t.form = after('Form:'); continue; }
        if (line.startsWith('Dialog')) { t.dialog = line.replace(/^Dialog[^:]*:/, '').trim(); continue; }
        if (line.startsWith('Descriptions:')) { t.description = after('Descriptions:'); continue; }
        if (line.startsWith('Role:')) {
          const [r, ex] = after('Role:').split('|');
          t.role = r.trim();
          if (ex) t.exRole = ex.replace(/EX Role\s*🌈:\s*/, '').trim();
          continue;
        }
        if (line.startsWith('Type:')) {
          const [ty, wk] = line.split('|');
          t.type = ty.replace('Type:', '').trim();
          if (wk) t.weakness = wk.replace('Weakness:', '').trim();
          continue;
        }
        if (line.startsWith('Rarity:')) { t.rarity = (line.match(/⭐/g) || []).length; continue; }
        if (line.startsWith('Expedition')) { t.expedition = line.replace(/^Expedition[^:]*:\s*/, ''); continue; }
        if (line.startsWith('Method:')) { t.method = after('Method:'); continue; }
        if (line.startsWith('Item Exchange:')) { t.itemExchange = after('Item Exchange:'); continue; }
        if (line.startsWith('Collect items')) { t.collectInfo = line; continue; }
        if (line.includes('EX Color')) { t.exColor = line.includes('Yes'); continue; }
        if (line.includes('Team Skill')) {
          while (lines[i + 1] && /^\d+\.\s/.test(lines[i + 1])) t.teamSkills.push(lines[++i].replace(/^\d+\.\s*/, ''));
          continue;
        }
        const dm = line.match(/^(Sync Pair|EX Effect|EX Role|Superawakened) Available:\s*(.+)$/);
        if (dm) { t.dates[dm[1]] = parseDate(dm[2]); continue; }
      }

      if (line.includes('⚔️ Moves Details')) { section = 'moves'; continue; }
      if (line.includes('⚔️ Mega Moves Details')) { pushMove(); section = 'mega_moves'; continue; }
      if (line.includes('Tera Moves Details')) { pushMove(); section = 'tera'; continue; }
      if (line.includes('Passives Details') && section === 'tera') { pushMove(); section = 'tera_passives'; continue; }
      if (line.includes('🛡️ Passive Details')) { pushMove(); section = 'passives'; continue; }
      if (line.includes('📊 Base Stats')) { section = 'stats'; continue; }
      if (line.includes('Mega Stats')) { section = 'mega_stats'; continue; }
      if (line.includes('📌')) continue;

      if (['moves', 'mega_moves', 'tera'].includes(section)) {
        const mm = line.match(/^(?:💎\s*Tera Move|Move (\d+)|Sync Move):\s*(.+)$/);
        if (mm) {
          pushMove();
          move = {
            slot: line.startsWith('Sync') ? 'Sync' : line.startsWith('💎') ? 'Tera' : +mm[1],
            name: mm[2].trim(), isSync: line.startsWith('Sync'),
            type: '', category: '', user: '', description: '',
          };
          continue;
        }
        if (move) {
          if (line.startsWith('Type:')) move.type = after('Type:');
          else if (line.startsWith('Category:')) move.category = after('Category:');
          else if (line.startsWith('User:')) move.user = after('User:');
          else if (line.startsWith('Description:')) move.description = after('Description:');
          else if (line.startsWith('Power:')) {
            const s = parseMoveStats(line);
            Object.assign(move, {
              power: s['Power'] || '--', accuracy: s['Accuracy'] || '--', gauge: s['Gauge'] || '--',
              target: s['Target'] || '--', effectTag: s['Effect Tag'] || '--', maxUses: s['Max uses'] || '--',
            });
            pushMove();
          }
          continue;
        }
      }

      if (section === 'passives' || section === 'tera_passives') {
        const sp = line.match(/Superawakened Passive:\s*(.+)$/);
        const pm = line.match(/^Passive\s+(\d+)(\(🏅\))?:\s*(.+)$/);
        if (sp || pm) {
          const desc = lines[i + 1] && !/^(Passive\s+\d|📊|\(🌅)/.test(lines[i + 1]) && lines[i + 1] !== '-' ? lines[++i] : '';
          if (sp) t.superPassive = { name: sp[1].trim(), description: desc };
          else (section === 'tera_passives' ? t.teraPassives : t.passives)
            .push({ slot: +pm[1], master: !!pm[2], name: pm[3].trim(), description: desc });
        }
        continue;
      }

      if (section === 'stats' || section === 'mega_stats') {
        const lv = line.match(/^Lv\.\s*(\d+)/);
        if (lv && lines[i + 1]) (section === 'stats' ? t.stats : t.megaStats)[lv[1]] = parseStatLine(lines[++i]);
      }
    }
    pushMove();
    const tera = (t.form || '').match(/Tera Type:?\s*(\w+)/);
    if (tera) t.teraType = tera[1];
    out.push(t);
  }
  return out;
}

// ─── Grid.txt ───────────────────────────────────────────────
const GRID_COLORS = { Blue: 'blue', Green: 'green', Red: 'red', Yellow: 'yellow', Rainbow: 'rainbow' };

function parseGrids(text) {
  const body = text.slice(text.indexOf('=========', text.indexOf('=========') + 9) + 9);
  const grids = {};
  let key = null;
  let cell = null;
  const flush = () => {
    if (!cell || !key) return;
    const items = cell.items;
    const desc = items.filter(l => /[.)]$/.test(l) && l.length > 25);
    const titles = items.filter(l => !desc.includes(l));
    cell.title = titles[titles.length - 1] || items[0] || '';
    cell.description = desc.join(' ');
    delete cell.items;
    delete cell.unlock;
    grids[key].push(cell);
    cell = null;
  };

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (/^No\.\s*\d+\s+/.test(line) && !raw.startsWith('\t')) {
      flush(); key = line; grids[key] = grids[key] || []; continue;
    }
    if (!key || !line || line.startsWith('Form:')) continue;
    const cm = line.match(/^Cell\s+(\d+)\s*\|\s*🎯\s*Cord\s*\(([^)]+)\)\s*\|\s*Cost:\s*⚡\s*(\d+)\s*Energy\s*\|\s*🔮\s*(\d+)/);
    if (cm) {
      flush();
      const [q, r, s] = cm[2].split(',').map(Number);
      cell = { n: +cm[1], q, r, s, energy: +cm[3], orbs: +cm[4], req: [], move: '', color: '', items: [] };
      continue;
    }
    if (!cell) continue;
    if (line.startsWith('Requirements:')) cell.req.push(line.replace('Requirements:', '').trim());
    else if (line.includes('Other Require Unlock')) cell.unlock = true;
    else if (cell.unlock && /^\d+\.\s/.test(line)) cell.req.push('Unlock: ' + line.replace(/^\d+\.\s*/, ''));
    else if (line.startsWith('Color Grid:')) {
      const c = Object.keys(GRID_COLORS).find(k => line.includes(k));
      cell.color = GRID_COLORS[c] || 'blue';
    } else if (line.startsWith('Move:')) cell.move = line.replace('Move:', '').trim();
    else cell.items.push(line);
  }
  flush();
  return grids;
}

// ─── Sync Pair Scout.txt ────────────────────────────────────
function parseScouts(text, version) {
  const events = [];
  let month = '';
  let ev = null;
  let field = null;
  let opt = null;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (/^\d{2}\/\d{4}$/.test(line)) { month = line; continue; }
    if (/^-{5,}$/.test(line)) continue;
    const em = line.match(/^\[(event_[^\]]+)\]$/);
    if (em) {
      ev = { id: em[1], month, version, header: [], scoutType: '', points: null, rateUp: [],
        presents: [], options: [], start: null, end: null };
      events.push(ev);
      field = 'header';
      continue;
    }
    if (!ev || !line) continue;

    if (line.startsWith('Type Scout:')) { ev.scoutType = line.replace('Type Scout:', '').trim(); field = null; continue; }
    if (line.startsWith('Scout Points to Pick-up:')) { ev.points = num(line.replace(/\D+/g, '')); continue; }
    if (line.startsWith('Rate-up Trainer:')) {
      ev.rateUp.push(line.replace(/^Rate-up Trainer:\s*\d+\.\s*/, ''));
      field = 'rateup'; continue;
    }
    if (field === 'rateup' && /^\d+\.\s/.test(line)) { ev.rateUp.push(line.replace(/^\d+\.\s*/, '')); continue; }
    if (line.startsWith('Presents when')) { field = 'presents'; continue; }
    if (line === 'Require') { field = 'require'; continue; }
    if (line.startsWith('🗓️ Start:')) { ev.start = parseDate(line); field = null; continue; }
    if (line.startsWith('🗓️ End:')) { ev.end = parseDate(line); ev.endText = line.replace('🗓️ End:', '').trim(); continue; }

    if (field === 'header') { ev.header.push(line); continue; }
    if (field === 'presents') { ev.presents.push(line); continue; }
    if (field === 'require') {
      const depth = (raw.match(/^\t*/) || [''])[0].length;
      if (depth <= 1) {
        if (/^Tier \d+$/.test(line)) { ev.pendingTier = line; continue; }
        opt = { label: line, tier: ev.pendingTier || null, cost: '', limit: '', points: null, gift: [] };
        delete ev.pendingTier;
        // "Select Master Fair | 🎫 ... x1 | Limit Scout: 1" and "Ticket Scout: X | Limit Scout: 1"
        if (line.includes('|')) {
          const parts = line.split('|').map(s => s.trim());
          opt.label = parts[0];
          opt.cost = parts.slice(1).filter(p => !/Limit/.test(p)).join(' ') || parts[0].replace(/^Ticket Scout:\s*/, '');
          opt.limit = (parts.find(p => /Limit/.test(p)) || '').trim();
        }
        ev.options.push(opt);
      } else if (opt) {
        if (line.startsWith('Scout Points get:')) opt.points = num(line.replace(/\D+/g, ''));
        else if (line.startsWith('Present no.')) opt.gift.push(line.replace(/^Present no\.\d+\s*/, ''));
        else {
          const parts = line.split('|').map(s => s.trim());
          opt.cost = parts[0];
          opt.limit = parts[1] || '';
        }
      }
    }
  }

  for (const e of events) {
    delete e.pendingTier;
    // Header: optional long blurb sentence + title lines
    const blurb = e.header.find(h => h.length > 60 && /[.!]$/.test(h));
    e.blurb = blurb || '';
    const rest = e.header.filter(h => h !== blurb);
    e.title = rest[rest.length - 1] || e.scoutType;
    e.tags = rest.slice(0, -1);
    delete e.header;
    e.rateUp = e.rateUp.map(r => ({ raw: r, ...splitPairName(r) }));
  }
  return events;
}

// ─── Pasio Gym Battle.txt ───────────────────────────────────
function parseGym(text, fileName) {
  const gym = {
    name: fileName.replace(/^\S+\s+/, '').replace(/\.txt$/, ''),
    circuits: [], phases: [], tickets: [], stages: [], ranking: [], score: [], rotateNote: '',
  };
  const lines = text.split('\n');
  let mode = null;
  let phase = null;
  let stage = null;
  let leader = null;
  let side = null;
  let reward = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('🔄 Circuits:')) { mode = 'circuits'; continue; }
    const ph = line.match(/^(📢 Announce|⚔️ Battle|🏆 Ranking|🎁 Reward):$/);
    if (ph) { phase = { name: ph[1].replace(/^\S+\s/, ''), icon: ph[1].split(' ')[0] }; gym.phases.push(phase); mode = 'phase'; continue; }
    if (line.startsWith('🎫 Challenge Point Effect')) { mode = 'tickets'; continue; }
    if (line.startsWith('👹 Gym Circuit')) { mode = 'gym'; continue; }
    if (line.startsWith('🏅 Combined Ranking')) { mode = 'ranking'; continue; }
    if (line.startsWith('🎯 Combined Score')) { mode = 'score'; continue; }

    if (mode === 'circuits') {
      const m = line.match(/^(.+?)\s*\|\s*([\d.]+)\s*pts\s*\|\s*(.+?)\s*\|\s*(\S+)\s+(.+)$/);
      if (m) gym.circuits.push({ name: m[1], pts: num(m[2]), kind: m[3], ball: m[5].replace(' Tier', '') });
    } else if (mode === 'phase' && phase) {
      const m = line.match(/^(Start|End):\s*(.+)$/);
      if (m) phase[m[1].toLowerCase()] = parseDate(m[2]);
    } else if (mode === 'tickets') {
      const m = line.match(/Ticket x(\d+)\s*\|\s*⏱️\s*([\d:]+)\s*min\s*\|\s*🔄\s*Sync Buff \+(\d+)/);
      if (m) gym.tickets.push({ tickets: +m[1], time: m[2], buff: +m[3] });
    } else if (mode === 'gym') {
      const st = line.match(/^📋\s*(.+):$/);
      if (st) { stage = { name: st[1], leaders: [] }; gym.stages.push(stage); continue; }
      if (line.startsWith('🔄 Rules rotate')) { gym.rotateNote = line.replace(/^🔄\s*/, ''); continue; }
      const ld = line.match(/^🆔\s*(.+?)\s*\|\s*🏷️\s*(\w+)\s*\|\s*(.+)$/);
      if (ld) {
        leader = { name: ld[1], type: ld[2], title: ld[3], theme: '', rule: '', rules: [], units: [] };
        stage.leaders.push(leader); continue;
      }
      if (!leader) continue;
      if (line.startsWith('Theme:')) { leader.theme = line.replace('Theme:', '').trim(); continue; }
      if (line.startsWith('Rule:')) { leader.rule = line.replace('Rule:', '').trim(); continue; }
      const rr = line.match(/^Rules (\d+):\s*(.+)$/);
      if (rr) { leader.rules.push(rr[2]); continue; }
      const un = line.match(/^(?:📊\s*)?\[(Center|Left\/Right)\]\s*(.+)$/);
      if (un) {
        const stats = {};
        for (const part of un[2].split('|')) {
          const m = part.trim().match(/^(.+?):\s*(.+)$/);
          if (m) stats[m[1].trim()] = /\d/.test(m[2]) && !/[a-z]/i.test(m[2]) ? num(m[2]) : m[2].trim();
        }
        side = { pos: un[1], weakness: stats.Weakness, hp: stats.HP, atk: stats.Attack, def: stats.Defense,
          spa: stats['Sp.Attack'], spd: stats['Sp.Def'], spe: stats.Speed, focus: [], reduction: '', reductionMods: [], passives: [] };
        leader.units.push(side); continue;
      }
      if (!side) continue;
      if (line.startsWith('🔸 Focus:')) side.focus = line.replace('🔸 Focus:', '').split(',').map(s => s.trim());
      else if (line.startsWith('♦️ Passive Damage Reduction')) side.reduction = line.replace(/^.*?:\s*/, '');
      else if (line.startsWith('●')) side.reductionMods.push(line.replace('●', '').trim());
      else if (/^Passive \d+:/.test(line)) side.passives.push(line.replace(/^Passive \d+:\s*/, ''));
    } else if (mode === 'ranking') {
      if (/^Top /.test(line)) { reward = { label: line, items: [] }; gym.ranking.push(reward); }
      else if (reward) reward.items.push(line);
    } else if (mode === 'score') {
      const m = line.match(/^\d+\.\s*([\d.]+)\s*pts(?:\s*\((.+)\))?/);
      if (m) { reward = { pts: num(m[1]), tag: m[2] || '', items: [] }; gym.score.push(reward); }
      else if (reward) reward.items.push(line);
    }
  }
  return gym;
}

// ─── Assemble ───────────────────────────────────────────────
const pairs = new Map();
const scoutMap = new Map();
const gyms = [];

for (const v of versions) {
  const tr = read(v, /Trainer\.txt$/);
  if (tr) {
    for (const t of parseTrainers(tr.text, v)) {
      const prev = pairs.get(t.key);
      t.versions = [...(prev?.versions || []), v];
      t.grid = prev?.grid || [];
      pairs.set(t.key, t);
    }
  }
  const gr = read(v, /Grid\.txt$/);
  if (gr) {
    for (const [key, cells] of Object.entries(parseGrids(gr.text))) {
      let p = pairs.get(key);
      if (!p) {
        const m = key.match(/^No\.\s*(\d+)\s+(.+)$/);
        p = { key, number: +m[1], ...splitPairName(m[2]), version: v, versions: [v], gridOnly: true, grid: [] };
        pairs.set(key, p);
      }
      const byN = new Map(p.grid.map(c => [c.n, c]));
      for (const c of cells) byN.set(c.n, { ...c, version: v });
      p.grid = [...byN.values()].sort((a, b) => a.n - b.n);
      if (!p.versions.includes(v)) p.versions.push(v);
      p.gridVersion = v;
    }
  }
  const sc = read(v, /Sync Pair Scout\.txt$/);
  if (sc) for (const e of parseScouts(sc.text, v)) scoutMap.set(e.id, e);
  for (const f of fs.readdirSync(path.join(ROOT, v)).filter(f => /Pasio Gym Battle No\.\s*\d+/.test(f))) {
    const g = parseGym(fs.readFileSync(path.join(ROOT, v, f), 'utf8').replace(/\r/g, ''), f);
    g.version = v;
    gyms.push(g);
  }
}

// Grid-only entries can inherit info from another pair with the same trainer+pokemon
const pairList = [...pairs.values()];
for (const p of pairList.filter(p => p.gridOnly)) {
  const twin = pairList.find(o => !o.gridOnly && o.trainer === p.trainer && o.pokemon === p.pokemon);
  if (twin) { twin.grid = [...twin.grid, ...p.grid]; p.merged = true; }
}

const finalPairs = pairList.filter(p => !p.merged).sort((a, b) =>
  (b.dates?.['Sync Pair'] || '').localeCompare(a.dates?.['Sync Pair'] || '') || a.number - b.number);

// ─── Older pairs from the pomatools crawl (optional) ─────────
// Datamine stays the source of truth; pomatools only adds pairs the datamine doesn't have,
// and fills in full details for datamine grid-expansion stubs.
const nameKey = p => `${p.trainer}&${p.pokemon}`.toLowerCase().replace(/[^a-z0-9&]/g, '');
const poma = loadPomatools(POMA_DIR, finalPairs);
let pomaAdded = 0;
if (poma) {
  const byName = new Map(finalPairs.map(p => [nameKey(p), p]));
  for (const q of poma.pairs) {
    const dm = byName.get(nameKey(q));
    if (dm && !dm.gridOnly) {
      // Forms come from pomatools, but their stats are rebuilt on the datamine's own base stats
      const SCALE_ORDER = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
      const onDm = f => f.kind === 'mega' && Object.keys(dm.megaStats || {}).length ? dm.megaStats
        : f.scale ? Object.fromEntries(Object.entries(dm.stats).map(([lv, row]) => [lv, Object.fromEntries(Object.entries(row)
          .map(([k, v]) => [k, Math.floor(v * (f.scale[SCALE_ORDER.indexOf(k)] ?? 100) / 100)]))])) : f.stats;
      Object.assign(dm, { pomaId: q.pomaId, actorId: q.actorId, shiny: dm.shiny || q.shiny,
        altForms: q.altForms.map(f => ({ ...f, stats: onDm(f) })) });
      // Tera details the datamine block didn't carry
      if (!dm.teraType && q.teraType) dm.teraType = q.teraType;
      if (!dm.teraMoves?.length && q.teraMoves.length) dm.teraMoves = q.teraMoves;
      continue;
    }
    if (dm) {
      Object.assign(dm, { ...q, key: dm.key, version: dm.version, versions: dm.versions, gridVersion: dm.gridVersion,
        gridOnly: false, source: 'pomatools' });
      continue;
    }
    finalPairs.push(q);
    pomaAdded++;
  }
  finalPairs.sort((a, b) => (b.dates?.['Sync Pair'] || '').localeCompare(a.dates?.['Sync Pair'] || '') || a.number - b.number);
}

// Stable URL ids ("#/pair/<id>"), unique even when two pairs share a name
const idSlug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const usedIds = new Set();
for (const p of finalPairs) {
  let id = idSlug(`${p.number}-${p.trainer}-${p.pokemon}`);
  if (usedIds.has(id) && p.form) id = idSlug(`${id}-${p.form}`); // same pair in another form (Deerling seasons, Alcremie creams)
  while (usedIds.has(id)) id += '-b';
  usedIds.add(id);
  p.id = id;
}

const scouts = [...scoutMap.values()];

// ─── Sprites ────────────────────────────────────────────────
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// PMEX form label → Showdown sprite suffix ("Midnight Form" → lycanroc-midnight)
const FORM_SUFFIX = [
  [/Galarian Form \(Zen Mode\)/, 'galarzen'], [/Alola/, 'alola'], [/Galar/, 'galar'], [/Hisui/, 'hisui'], [/Paldea/, 'paldea'],
  [/Origin/, 'origin'], [/Therian/, 'therian'], [/Sky Forme/, 'sky'], [/Midnight/, 'midnight'], [/Dusk Form/, 'dusk'],
  [/Dusk Mane/, 'duskmane'], [/Dawn Wings/, 'dawnwings'], [/Ultra Necrozma/, 'ultra'], [/Black Kyurem/, 'black'],
  [/White Kyurem/, 'white'], [/Blade Forme/, 'blade'], [/Attack Forme/, 'attack'], [/Speed Forme/, 'speed'],
  [/Defense Forme/, 'defense'], [/Resolute/, 'resolute'], [/Pirouette/, 'pirouette'], [/Busted/, 'busted'],
  [/Noice/, 'noice'], [/Hangry/, 'hangry'], [/Sensu/, 'sensu'], [/Pom-Pom/, 'pompom'], [/Pa.u Style/, 'pau'],
  [/Summer Form/, 'summer'], [/Autumn Form/, 'autumn'], [/Winter Form/, 'winter'], [/East Sea/, 'east'],
  [/Unbound/, 'unbound'], [/Ice Rider/, 'ice'], [/Shadow Rider/, 'shadow'], [/Roaming/, 'roaming'],
  [/Terastal Form/, 'terastal'], [/Stellar Form/, 'stellar'], [/Jumbo|Super Size/, 'super'], [/Large Variety/, 'large'],
  [/Orange Flower/, 'orange'], [/Yellow Flower/, 'yellow'], [/Blue Flower/, 'blue'], [/White Flower/, 'white'],
  [/Antique/, 'antique'], [/Wellspring/, 'wellspring'], [/Hearthflame/, 'hearthflame'], [/Cornerstone/, 'cornerstone'],
  [/Crowned/, 'crowned'], [/Complete Forme/, 'complete'], [/10% Forme/, '10'],
  [/Ruby Cream/, 'rubycream'], [/Matcha Cream/, 'matchacream'], [/Mint Cream/, 'mintcream'], [/Lemon Cream/, 'lemoncream'],
  [/Salted Cream/, 'saltedcream'], [/Ruby Swirl/, 'rubyswirl'], [/Caramel Swirl/, 'caramelswirl'], [/Rainbow Swirl/, 'rainbowswirl'], [/Type Change: (\w+)/, m => m[1] === 'Normal' ? null : m[1].toLowerCase()],
];
const formSuffix = label => {
  for (const [re, suf] of FORM_SUFFIX) {
    const m = String(label || '').match(re);
    if (m) return typeof suf === 'function' ? suf(m) : suf;
  }
  return null;
};

function pokemonCandidates(name, form) {
  const n = String(name);
  // "Mega Charizard X" → charizard-megax, "Primal Groudon" → groudon-primal
  const mega = n.match(/^Mega (.+?)(?: ([XY]))?$/);
  if (mega) return [`${slug(mega[1])}-mega${(mega[2] || '').toLowerCase()}`];
  const primal = n.match(/^Primal (.+)$/);
  if (primal) return [`${slug(primal[1])}-primal`];
  // "Alolan Raichu" → raichu-alola, etc.
  const regional = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' };
  const rm = n.match(/^(Alolan|Galarian|Hisuian|Paldean)\s+(.+)$/i);
  if (rm) return [`${slug(rm[2])}-${regional[rm[1].toLowerCase()]}`, slug(rm[2])];
  const base = slug(n);
  const suf = formSuffix(form);
  return suf ? [`${base}-${suf}`, base] : [base];
}

// Special outfits whose Showdown sprite was checked by eye (see tools/match-outfits.mjs).
// Showdown names PMEX outfits "-masters", "-masters2", … without saying which outfit, so only
// verified picks are used. Keys are the exact trainer names shown on the site.
const OUTFIT_FILE = path.join(REPO, 'config', 'outfit-sprites.json');
const OUTFIT_SPRITES = fs.existsSync(OUTFIT_FILE) ? JSON.parse(fs.readFileSync(OUTFIT_FILE, 'utf8')) : {};

// Hand-made sprites for trainers Showdown doesn't have (config/trainer-sprites/<file>, 80 px,
// downscaled from the in-game render). Keys are exact trainer names; these beat every other source.
const CUSTOM_DIR = path.join(REPO, 'config', 'trainer-sprites');
const CUSTOM_FILE = path.join(REPO, 'config', 'custom-trainer-sprites.json');
const CUSTOM_TRAINERS = fs.existsSync(CUSTOM_FILE) ? JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8')) : {};
function customTrainerSprite(name) {
  const file = CUSTOM_TRAINERS[name];
  if (!file || !fs.existsSync(path.join(CUSTOM_DIR, file))) return null;
  fs.mkdirSync(path.join(ASSETS, 'trainers', 'custom'), { recursive: true });
  fs.copyFileSync(path.join(CUSTOM_DIR, file), path.join(ASSETS, 'trainers', 'custom', file));
  return `assets/trainers/custom/${file}`;
}

// Plain name ("Cynthia") → default outfit only.
// Name with an outfit marker ("(Alt.)", "(Fall 2026)", "Sygna Suit …") → that outfit's sprite
// when one exists, otherwise fall back to the default outfit.
// Names whose Showdown sprite has a different id
const TRAINER_ALIASES = { themaskedroyal: 'kukui', jessie: 'jessiejames-gen1', james: 'jessiejames-gen1', clive: 'clive-v' };
const GEN_SUFFIXES = ['', '-s', '-v', '-gen9', '-gen8', '-gen7', '-gen6', '-gen5', '-gen4', '-gen3'];

function trainerCandidates(name, description = '') {
  const base = name.replace(/\(.*?\)/g, '').replace(/Sygna Suit|Arc Suit|^Professor\s+/gi, '').trim();
  const s = TRAINER_ALIASES[slug(base)] || slug(base);
  const defaults = [...GEN_SUFFIXES.map(x => s + x),
    `${s}-masters`]; // last resort: trainers that only exist as PMEX sprites
  // A verified outfit always wins
  if (OUTFIT_SPRITES[name]) return [OUTFIT_SPRITES[name], ...defaults];
  // "Linnea (Furisode Girl)" — a named NPC of a trainer class: fall back to the class sprite.
  // Only real trainer classes; "(Academy)", "(Kimono)", "(Thunderbolt)" are outfits, not classes.
  const cls = name.match(/\((Furisode Girl|Poké Kid|Hex Maniac|Hiker|Sightseer)\)$/)?.[1];
  if (cls) {
    const c = slug(cls);
    return [...defaults.slice(0, 1), c, `${c}f`, `${c}-pink`, `${c}-white`, `${c}-blue`, `${c}-black`, ...GEN_SUFFIXES.slice(3).map(x => c + x)];
  }
  if (!/\(|Sygna Suit|Arc Suit/i.test(name)) return defaults;

  const outfit = [];
  const text = `${name} ${description}`;
  if (/Festival of Masks|jinbei/i.test(text)) outfit.push(`${s}-festival`);
  if (/Dojo Uniform/i.test(text)) outfit.push(`${s}-dojo`);
  if (/\(Champion\)/.test(name)) outfit.push(`${s}-champion`);
  return [...outfit, ...defaults];
}

// Remember 404s so rebuilds don't re-request sprites that don't exist
const MISS_FILE = path.join(ASSETS, '.missing.json');
const misses = new Set(fs.existsSync(MISS_FILE) ? JSON.parse(fs.readFileSync(MISS_FILE, 'utf8')) : []);

async function fetchTo(url, dest) {
  if (fs.existsSync(dest)) return true;
  if (NO_FETCH || misses.has(url)) return false;
  try {
    const r = await fetch(url);
    if (r.status === 404) misses.add(url);
    if (!r.ok) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

async function resolveSprite(kind, candidates) {
  for (const id of candidates) {
    if (!id) continue;
    const dest = path.join(ASSETS, kind, `${id}.png`);
    const url = {
      pokemon: `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`,
      'pokemon-shiny': `https://play.pokemonshowdown.com/sprites/gen5-shiny/${id}.png`,
      trainers: `https://play.pokemonshowdown.com/sprites/trainers/${id}.png`,
    }[kind];
    if (await fetchTo(url, dest)) return `assets/${kind}/${id}.png`;
  }
  return null;
}

const spriteCache = new Map();
async function sprite(kind, candidates) {
  const k = kind + ':' + candidates.join(',');
  if (!spriteCache.has(k)) spriteCache.set(k, await resolveSprite(kind, candidates));
  return spriteCache.get(k);
}

// Run async jobs a few at a time so ~700 pairs don't take ages (and don't hammer the CDN)
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

async function attachSprites() {
  const monSprite = async (name, form, shiny) => {
    const c = pokemonCandidates(name, form);
    return (shiny && await sprite('pokemon-shiny', c)) || sprite('pokemon', c);
  };
  await pool(finalPairs, 6, async p => {
    p.pokeSprite = await monSprite(p.pokemon, p.form, p.shiny);
    p.trainerSprite = customTrainerSprite(p.trainer) || await sprite('trainers', trainerCandidates(p.trainer, p.description));
    // Mega / Primal / in-battle form changes — only kept when the sprite actually differs
    // Datamine-only pairs know Mega stats but not the Mega's name
    const forms = p.altForms?.length ? p.altForms
      : Object.keys(p.megaStats || {}).length ? [{ kind: 'mega', pokemon: `Mega ${p.pokemon}`, form: '', stats: p.megaStats }] : [];
    p.altSprites = [];
    for (const f of forms) {
      const spr = await monSprite(f.pokemon, f.form, f.shiny || p.shiny) || p.pokeSprite;
      const statsDiffer = f.stats && JSON.stringify(f.stats) !== JSON.stringify(p.stats);
      // Keep a form when it looks different or fights with different stats (e.g. Zygarde 50% → Complete)
      if ((spr !== p.pokeSprite || statsDiffer) && !p.altSprites.some(a => a.sprite === spr && JSON.stringify(a.stats) === JSON.stringify(f.stats))) {
        p.altSprites.push({ kind: f.kind, label: f.kind === 'mega' ? f.pokemon : `${f.pokemon} · ${f.form}`, sprite: spr, stats: f.stats || null });
      }
    }
  });
  for (const e of scouts) {
    for (const r of e.rateUp) {
      r.pokeSprite = await sprite('pokemon', pokemonCandidates(r.pokemon, r.form));
      const known = finalPairs.find(p => p.trainer === r.trainer && p.pokemon === r.pokemon);
      r.trainerSprite = known?.trainerSprite || customTrainerSprite(r.trainer) || await sprite('trainers', trainerCandidates(r.trainer));
    }
  }
  for (const g of gyms) {
    const leaders = [...new Set(g.stages.flatMap(s => s.leaders.map(l => l.name)))];
    g.leaderSprites = {};
    for (const l of leaders) g.leaderSprites[l] = await sprite('trainers', trainerCandidates(l));
  }
  // Pixel item icons for UI decoration
  const items = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball', 'rare-candy', 'exp-share', 'star-piece', 'rainbow-wing'];
  for (const it of items) {
    await fetchTo(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${it}.png`,
      path.join(ASSETS, 'items', `${it}.png`));
  }
}

await attachSprites();
fs.mkdirSync(ASSETS, { recursive: true });
fs.writeFileSync(MISS_FILE, JSON.stringify([...misses].sort(), null, 1));

// ─── Output ─────────────────────────────────────────────────
// data.js keeps a light summary of every pair (list, filters, charts);
// full details (moves, passives, grid…) go to data/pairs/<id>.js, loaded when a pair is opened.
const SUMMARY_KEYS = ['id', 'key', 'number', 'trainer', 'pokemon', 'gender', 'shiny', 'form', 'version', 'versions', 'source',
  'gridOnly', 'gridVersion', 'role', 'exRole', 'type', 'weakness', 'rarity', 'teamSkills', 'dates', 'stats', 'megaStats',
  'exColor', 'method', 'pokeSprite', 'trainerSprite', 'altSprites', 'teraType'];
const summaries = finalPairs.map(p => ({
  ...Object.fromEntries(SUMMARY_KEYS.filter(k => p[k] !== undefined).map(k => [k, p[k]])),
  gridCount: p.grid?.length || 0,
}));

fs.rmSync(OUT_PAIRS, { recursive: true, force: true });
fs.mkdirSync(OUT_PAIRS, { recursive: true });
for (const p of finalPairs) {
  fs.writeFileSync(path.join(OUT_PAIRS, `${p.id}.js`), `window.PMEX_PAIR_LOADED(${JSON.stringify(p.id)}, ${JSON.stringify(p)});\n`);
}

const data = {
  builtAt: new Date().toISOString(),
  versions,
  sources: { pomatools: poma ? { pairs: pomaAdded, crawled: poma.pairs.length } : null },
  pairs: summaries,
  scouts,
  gyms,
};

fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
fs.writeFileSync(OUT_DATA, `/* generated by build.mjs — do not edit */\nwindow.PMEX_DATA = ${JSON.stringify(data)};\n`);

const missing = finalPairs.filter(p => !p.pokeSprite).map(p => p.pokemon);
console.log(`versions: ${versions.join(', ')}`);
console.log(`pairs: ${finalPairs.length} (grid-only: ${finalPairs.filter(p => p.gridOnly).length}, from pomatools: ${pomaAdded}${poma ? `, overlap ${poma.overlap}` : ' — no crawl cache, run npm run crawl'})`);
console.log(`scouts: ${scouts.length}, gyms: ${gyms.map(g => g.name).join(', ')}`);
console.log(`missing pokemon sprites (${missing.length}): ${missing.join(', ') || 'none'}`);
const noTrainer = [...new Set(finalPairs.filter(p => !p.trainerSprite).map(p => p.trainer))];
console.log(`missing trainer sprites (${noTrainer.length}): ${noTrainer.join(', ') || 'none'}`);
console.log(`→ ${path.relative(REPO, OUT_DATA)} (${(fs.statSync(OUT_DATA).size / 1024).toFixed(0)} KB)`);
