/* ═══════════════════════════════════════════════════════════════
   Bridge to the Dex build (../data/data.js → window.PMEX_DATA):
   pair catalog, sprites, and Gym Battle definitions from the datamine.
   ═══════════════════════════════════════════════════════════════ */

export const D = window.PMEX_DATA;
export const PAIRS = D.pairs.filter(p => !p.gridOnly);
const byId = new Map(PAIRS.map(p => [p.id, p]));
export const pairById = id => byId.get(id);
export const pairName = p => p ? `${p.trainer} & ${p.pokemon}` : '?';

// Dex asset paths are relative to site/; this page lives in site/gym/
export const PLACEHOLDER = '../assets/items/poke-ball.png';
export const asset = src => (src ? `../${src}` : PLACEHOLDER);

export const TYPE_COLORS = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad',
};
export const ROLE_COLORS = { Strike: '#e5484d', Tech: '#9b5de5', Support: '#3b82f6', Field: '#16a36a', Sprint: '#f08c00', Multi: '#0f8b8d' };
export const roleBase = r => (r || '').split(' (')[0];

// Rows for public.pair_catalog, straight from the Dex build
export const catalogRows = () => PAIRS.map(p => ({
  id: p.id, trainer: p.trainer, pokemon: p.pokemon, type: p.type || '', role: p.role || '',
  ex_role: p.exRole || '', rarity: p.rarity || 5, max_bonus: p.maxBonus === 10 ? 10 : 5,
}));

// ─── Gym Battles from the datamine ───
export const GYMS = D.gyms || [];
export const gymByKey = key => GYMS.find(g => g.name === key);

// Datamine times are UTC ("06:00" = daily reset)
const utc = s => (s ? new Date(s + (s.endsWith('Z') ? '' : 'Z')).toISOString() : null);

// A season row prefilled from a Dex gym: leaders (+ weakness of their units) and circuits
export function seasonFromGym(g) {
  const battle = g.phases.find(p => p.name === 'Battle') || {};
  return {
    name: g.name,
    gym_key: g.name,
    battle_start: utc(battle.start),
    battle_end: utc(battle.end),
    leaders: (g.stages[0]?.leaders || []).map(l => ({
      name: l.name, type: l.type, weakness: [...new Set((l.units || []).map(u => u.weakness).filter(Boolean))],
    })),
    circuits: g.circuits.map(c => ({ name: c.name, pts: c.pts, kind: c.kind, ball: c.ball })),
  };
}

// The rule a Gym Leader plays under in round n ("… and onward" rotates Rules 1/2/3)
export function leaderRule(gym, leader, n) {
  if (!gym) return '';
  const st = gym.stages[Math.min(n, gym.stages.length) - 1] || gym.stages[0];
  const l = st?.leaders.find(x => x.name === leader);
  if (!l) return '';
  if (l.rules?.length) return l.rules[(Math.max(n, gym.stages.length) - gym.stages.length) % l.rules.length];
  return l.theme || 'No rules';
}
// Focus + passives of the Center unit in round n (what the boss does)
export function leaderUnit(gym, leader, n) {
  const st = gym?.stages[Math.min(n, gym.stages.length) - 1];
  return st?.leaders.find(x => x.name === leader)?.units?.[0] || null;
}
export const leaderSprite = (gym, name) => asset(gym?.leaderSprites?.[name]);
