/* ═══════════════════════════════════════════════════════════════
   Convert the pomatools crawl cache (.cache/pomatools) into the
   same pair shape build.mjs produces from the datamine .txt files.

   Numeric codes that pomatools stores without labels (move target,
   category, effect tag) are learned from pairs that exist
   in BOTH sources, so labels always match the datamine's wording.
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const TYPES = [null, 'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
// From the site's own RoleMap / ExRoleList (JS bundle)
const ROLES = { 0: 'Strike (Physical)', 1: 'Strike (Special)', 2: 'Support', 3: 'Tech', 4: 'Sprint', 5: 'Field', 6: 'Multi' };
const EX_ROLES = { 0: 'Strike', 1: 'Strike', 2: 'Support', 3: 'Tech', 4: 'Sprint', 5: 'Field' };
// Pair category ("Pair Category" / exclusivity in PoMaTools: enum Exclusivity + locale exclusivity_N).
// 995 isn't in their enum: it holds the 9 Gym Leaders released in the 2025 Gym events → Gym.
const CATEGORIES = { 1: 'general', 2: 'pokefair', 3: 'seasonal', 4: 'special', 5: 'variety', 6: 'mix', 7: 'pokefairex',
  8: 'gym', 995: 'gym', 996: 'masterex', 997: 'academy', 998: 'arc', 999: 'master' };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const GRID_COLOR = { '#779EFF': 'blue', '#47D147': 'green', '#FF0066': 'red', '#FFC266': 'yellow', '#BF80FF': 'rainbow' };
const STAT_KEYS = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };

// en.json drops the line break inside two-line names: "FirescourgeInferno" → "Firescourge Inferno"
const unjoin = s => String(s || '').replace(/\u00a0/g, ' ').replace(/([a-z!?.’'é])([A-Z])/g, '$1 $2');
// Descriptions lose the inline "rank(s)" tag — "by two stat ." / "by one  when" — and keep hard line breaks
const cleanDesc = s => String(s || '')
  .replace(/\u00a0/g, ' ') // the stripped tag leaves a no-break space behind
  .replace(/\s*\n\s*/g, ' ')
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)( stat)?(  | (?=[.,;)])|$)/g,
    (m, n, stat, gap) => `${n}${stat || ''} ${NUM[n] === 1 ? 'rank' : 'ranks'}${gap === '  ' ? ' ' : ''}`)
  .replace(/ {2,}/g, ' ').trim();
const cleanTile = s => unjoin(s).replace(/\s+\+\s*/g, ' ↑ ').replace(/^(HP|Attack|Defense|Sp\. Atk|Sp\. Def|Speed) ↑ /, '$1 +').replace(/ {2,}/g, ' ').trim();
// pomatools dates are Japan time (14:00); the datamine uses 06:00 for the same reset → shift −8 h
const isoDate = s => {
  const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], (+m[4] || 0) - 8, +m[5] || 0));
  return d.toISOString().slice(0, 16);
};
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Forms pomatools only encodes in the actor id (checked against the in-game icons)
const ALCREMIE_CREAM = { 11: 'Vanilla Cream', 12: 'Ruby Cream', 13: 'Matcha Cream', 14: 'Mint Cream', 15: 'Lemon Cream',
  16: 'Salted Cream', 17: 'Ruby Swirl', 18: 'Caramel Swirl', 19: 'Rainbow Swirl' };
const actorForm = actor => { const m = String(actor || '').match(/^pm0869_(\d\d)_/); return m ? ALCREMIE_CREAM[m[1]] || '' : ''; };

export function loadPomatools(cacheDir, dataminePairs) {
  const read = rel => JSON.parse(fs.readFileSync(path.join(cacheDir, rel), 'utf8'));
  if (!fs.existsSync(path.join(cacheDir, 'data/sync_meta_list.json'))) return null;
  const meta = read('data/sync_meta_list.json');
  const en = read('locales/en.json');
  const moveDb = read('data/core/move_database.json');
  const t = (prefix, id) => en[`${prefix}_${id}`];

  // ── Load raw pairs ────────────────────────────────────────
  const raw = [];
  for (const id of Object.keys(meta)) {
    const f = path.join(cacheDir, 'data/pairs', `${id}.json`);
    if (fs.existsSync(f)) raw.push({ id, meta: meta[id].meta, pair: JSON.parse(fs.readFileSync(f, 'utf8')) });
  }

  // ── Learn code → label tables from pairs present in both sources ──
  const learn = {};
  const vote = (table, code, label) => {
    if (code === undefined || code === null || !label) return;
    ((learn[table] ||= {})[code] ||= {})[label] = (learn[table][code][label] || 0) + 1;
  };
  const dmByName = new Map(dataminePairs.filter(p => !p.gridOnly).map(p => [norm(`${p.trainer}&${p.pokemon}`), p]));
  let overlap = 0;
  for (const { meta: m, pair } of raw) {
    const dm = dmByName.get(norm(`${t('trainer_name', m.trainerName)}&${t('pokemon_name', m.pokemonName)}`));
    if (!dm) continue;
    overlap++;
    const mon = pair.pokemon[0];
    for (const id of [...mon.moves, mon.syncMove]) {
      const mv = moveDb[id];
      const dmm = [...dm.moves, dm.syncMove].find(x => x && norm(x.name) === norm(unjoin(t('move_name', id))));
      if (!mv || !dmm) continue;
      vote('target', mv.target, dmm.target);
      vote('category', mv.category, dmm.category);
      vote('tag', mv.tag, dmm.effectTag);
    }
  }
  const lookup = Object.fromEntries(Object.entries(learn).map(([k, codes]) => [k,
    Object.fromEntries(Object.entries(codes).map(([c, labels]) => [c, Object.entries(labels).sort((a, b) => b[1] - a[1])[0][0]]))]));
  lookup.category = { 0: 'Status', 1: 'Physical', 2: 'Special', ...lookup.category };

  // ── Convert ───────────────────────────────────────────────
  const moveOf = (id, slot) => {
    const mv = moveDb[id] || {};
    const powerMax = mv.power ? Math.floor(mv.power * 1.2) : 0; // 5↑ move level = +20%, rounded down
    return {
      slot, name: unjoin(t('move_name', id)) || `Move ${id}`, isSync: slot === 'Sync',
      type: TYPES[mv.type] || '', category: lookup.category[mv.category] || '',
      user: mv.user || '', description: cleanDesc(t('move_desc', id)),
      // Max moves have one fixed power (only grid tiles raise it), no move-level range
      power: !mv.power ? '--' : slot === 'Max' ? String(mv.power) : `${mv.power} (1)/${powerMax} (5↑ MAX)`,
      accuracy: mv.accuracy ? String(mv.accuracy) : '--', gauge: mv.gauge ? String(mv.gauge) : '--',
      target: lookup.target?.[mv.target] || '--', effectTag: lookup.tag?.[mv.tag] || (mv.tag ? mv.tag : '--'),
      maxUses: mv.uses ? String(mv.uses) : '--',
    };
  };
  const passiveOf = (id, slot) => ({
    slot, master: String(id).startsWith('29'), name: unjoin(t('passive_name', id)) || `Passive ${id}`,
    description: cleanDesc(t('passive_desc', id)),
  });
  const statsOf = st => {
    const at = i => Object.fromEntries(Object.entries(STAT_KEYS).map(([k, label]) => [label, st[k]?.[i]]));
    const lv150 = Object.fromEntries(Object.entries(STAT_KEYS).map(([k, label]) =>
      [label, Math.round(st[k][5] + (st[k][6] - st[k][5]) / 6)])); // linear 140→200
    return { 1: at(0), 140: at(5), 150: lv150, 200: at(6) };
  };
  // Mega / form variants store the base stats plus a % multiplier per stat (HP, Atk, Def, SpA, SpD, Spe)
  const SCALE_ORDER = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  const applyScale = (stats, scale) => !scale ? stats : Object.fromEntries(Object.entries(stats).map(([lv, row]) =>
    [lv, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Math.floor(v * (scale[SCALE_ORDER.indexOf(k)] ?? 100) / 100)]))]));

  const out = [];
  for (const { meta: m, pair } of raw) {
    const trainer = t('trainer_name', m.trainerName) || m.trainerName;
    const mon = pair.pokemon[0];
    const pokemon = t('pokemon_name', mon.name) || mon.name;
    const statsMain = mon.stat?.hp ? statsOf(mon.stat) : {};
    const role = ROLES[m.role] || '';

    // Later variations (variationType): 1 Mega, 2 in-battle form change, 3 pre/post sync, 4 Dynamax,
    // 5 post-sync form, 6 Primal, 7 Tera. Each one becomes an alt form carrying its own stats and,
    // slot by slot, the moves / passives it swaps in (null = same as the base form).
    const variants = pair.pokemon.slice(1);
    const formName = f => (f && f !== '0' ? t('pokemon_form', f) : '') || '';
    const realIds = ids => (ids || []).filter(id => id && id !== '0');
    const slotDiff = (ids, baseIds, conv) => ids.length && (ids.length !== baseIds.length || ids.some((id, i) => id !== baseIds[i]))
      ? ids.map((id, i) => id === baseIds[i] ? null : conv(id, i + 1)) : null;
    // Dynamax turns each typed Pokémon move, in order, into a Max Move (typeless item moves like Potion are skipped)
    const maxSources = realIds(mon.moves).filter(id => moveDb[id]?.user === 'Pokemon' && moveDb[id].type);
    const seen = new Set();
    const altForms = [];
    for (const v of variants) {
      const name = t('pokemon_name', v.name) || '';
      // Tera / Dynamax variants reuse the base form code ("Tera Type: Dragon" on a Dynamax Charizard) — ignore it
      const label = [4, 7].includes(v.variationType) && v.name === mon.name && !/Stellar|Terastal/.test(formName(v.form)) ? '' : formName(v.form);
      const maxMoves = v.variationType === 4 ? realIds(v.moveDynamaxs).map((id, i) => {
        const src = maxSources[i];
        return { ...moveOf(id, 'Max'), from: src ? unjoin(t('move_name', src)) : '', fromSlot: src ? mon.moves.indexOf(src) + 1 : null };
      }) : null;
      const gmax = !!maxMoves?.some(m => /^G-Max/.test(m.name));
      // Only real Mega Evolutions are 'mega'; Primal Reversion, Zygarde Complete, Ultra Necrozma… are form changes
      const kind = { 1: 'mega', 4: gmax ? 'gigantamax' : 'dynamax', 7: 'tera' }[v.variationType] || 'form';
      const f = {
        kind, pokemon: name, form: label, shiny: !!v.isShiny, scale: v.scale || null,
        stats: v.stat?.hp ? applyScale(statsOf(v.stat), v.scale) : null,
        moves: slotDiff(realIds(v.moves), realIds(mon.moves), moveOf),
        syncMove: realIds([v.syncMove])[0] && v.syncMove !== mon.syncMove ? moveOf(v.syncMove, 'Sync') : null,
        passives: slotDiff(realIds(v.passives), realIds(mon.passives), passiveOf),
        maxMoves,
        teraType: v.variationType === 7 ? TYPES[v.type] || (v.type === 99 ? 'Stellar' : '') : '',
        teraMoves: v.variationType === 7 ? realIds([v.moveTera]).map(id => moveOf(id, 'Tera')) : null,
      };
      Object.keys(f).forEach(k => f[k] === null && delete f[k]);
      // Same Pokémon and form label as the base (Galarian Slowbro's Shell Side Arm switching category):
      // name the form after the move it swaps in
      if (kind === 'form' && v.name === mon.name && (!label || label === formName(mon.form)) && (f.moves || f.syncMove))
        f.label = [...(f.moves || []).filter(Boolean), f.syncMove].filter(Boolean).map(m => m.name).join(' / ');
      const key = JSON.stringify({ ...f, scale: null });
      const plain = kind === 'form' && v.name === mon.name && !f.moves && !f.syncMove && !f.passives
        && (!v.scale || v.scale.every(x => x === 100)) && (!label || label === formName(mon.form));
      if (seen.has(key) || plain) continue; // nothing to show beyond the base form
      seen.add(key);
      altForms.push(f);
    }
    const megaMon = variants.find(v => v.variationType === 1 && v.stat?.hp);
    const teraForm = altForms.find(f => f.kind === 'tera');
    const teraType = teraForm?.teraType || '';

    const grid = (pair.grid || []).map((c, i) => {
      const id = String(c.abilityId);
      // 13-digit tile ids start with the 8-digit passive they grant
      const pid = id.length === 13 ? id.slice(0, 8) : null;
      return {
        n: i + 1, q: c.x, r: c.y, s: -c.x - c.y, energy: c.energy, orbs: c.orb,
        req: c.level > 1 ? [`Move level must be ${c.level} or higher`] : [],
        move: '', color: GRID_COLOR[String(c.color).toUpperCase()] || 'blue',
        title: cleanTile(t('tile_name', id)) || id,
        description: pid ? cleanDesc(t('passive_desc', pid)) : '',
      };
    });

    const dates = {
      'Sync Pair': isoDate(pair.date?.startDate), 'EX Effect': isoDate(pair.date?.exStartDate),
      'EX Role': isoDate(pair.date?.exRoleDate), Superawakened: isoDate(pair.date?.awakingDate),
    };
    Object.keys(dates).forEach(k => dates[k] || delete dates[k]);

    out.push({
      key: `pomatools:${m.id}`, pomaId: m.id, actorId: pair.trainer?.actorId || m.actorId, number: Number(String(m.actor || '').replace(/\D/g, '')) || 0,
      trainer, pokemon, gender: ['', 'Male', 'Female', 'Genderless'][mon.gender] || '', shiny: !!mon.isShiny,
      form: /^(Tera Type|Sync Move|Pre-|Post-|Before|After)/.test(formName(mon.form)) ? '' : formName(mon.form) || actorForm(mon.actorId),
      altForms,
      version: null, versions: [], source: 'pomatools',
      dialog: '', description: '',
      role, exRole: EX_ROLES[m.exRole] || '', type: TYPES[mon.type] || TYPES[m.type] || '', weakness: TYPES[mon.weakness] || '',
      rarity: m.rarity || 0, maxBonus: pair.trainer?.maxBonusLevel || 5, // 10 ⇔ can Superawaken (bonus 6/5–10/5)
      expedition: '', method: '', category: CATEGORIES[m.exclusivity] || '', itemExchange: '', collectInfo: '',
      exColor: false, teamSkills: (pair.themes || []).map(th => t('theme_name', th.name)).filter(Boolean),
      dates,
      moves: mon.moves.map((id, i) => moveOf(id, i + 1)), syncMove: mon.syncMove && mon.syncMove !== '0' ? moveOf(mon.syncMove, 'Sync') : null,
      // Tera moves, Mega moves and form passives now live on their alt form (altForms[].teraMoves / moves / passives)
      teraType, teraMoves: [], megaMoves: [],
      passives: mon.passives.filter(id => id !== '0').map((id, i) => passiveOf(id, i + 1)),
      superPassive: pair.specialAwaking && pair.specialAwaking !== '0'
        ? { name: unjoin(t('passive_name', pair.specialAwaking)), description: cleanDesc(t('passive_desc', pair.specialAwaking)) } : null,
      teraPassives: [],
      stats: statsMain, megaStats: megaMon ? applyScale(statsOf(megaMon.stat), megaMon.scale) : {},
      megaPokemon: megaMon ? t('pokemon_name', megaMon.name) : '',
      grid, dexNumber: m.dexNumber,
    });
  }
  return { pairs: out, overlap, lookup };
}
