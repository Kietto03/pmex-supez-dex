/* ═══════════════════════════════════════════════════════════════
   Gym Battle rules — the same checks as public.check_run() in the
   database, run in the browser first so mistakes show up instantly.
   Pure functions: no DOM, no network.
   ═══════════════════════════════════════════════════════════════ */

export const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
export const TOWER_TOP = 40;
const DAY = 864e5;

// ─── Circuits ───────────────────────────────────────────────
// Round n of a season. Past the last circuit, an "… and onward" circuit repeats
// (Extra Battle 12, 13, …); anything else ends the season.
export function circuitAt(season, n) {
  const C = season.circuits || [];
  const last = C[C.length - 1];
  const onward = last && /and onward/i.test(last.name);
  const from = onward ? +(last.name.match(/(\d+)/)?.[1] || 0) : 0;
  const regular = c => /^regular/i.test(c.kind || '');
  if (n >= 1 && n <= C.length) {
    const c = C[n - 1];
    return { ...c, n, fixed: regular(c) ? 3 : null, label: onward && n === C.length ? `Extra Battle ${from}` : c.name };
  }
  if (onward && n > C.length) return { ...last, n, fixed: regular(last) ? 3 : null, repeat: true, label: `Extra Battle ${from + n - C.length}` };
  return null;
}
export const roundShort = label => String(label).replace(/^Circuit (\d+)/, 'C$1').replace(/^Extra Battle (\d+).*/, 'EX$1');

// ─── Tickets ────────────────────────────────────────────────
// day1 when Battle opens, +daily every 24 h until Battle ends, capped per member
export function ticketsGranted(season, now = Date.now()) {
  const start = Date.parse(season.battle_start), end = Date.parse(season.battle_end);
  if (!(now >= start)) return 0;
  const days = Math.max(Math.ceil((end - start) / DAY) - 1, 0);
  const passed = Math.floor((Math.min(now, end) - start) / DAY);
  return Math.min(season.ticket_cap, season.tickets_day1 + season.tickets_daily * Math.min(passed, days));
}

// ─── Season state, recomputed from the raw run log ──────────
export function seasonState(season, runs, seasonMembers = [], now = Date.now()) {
  const leaders = (season.leaders || []).map(l => l.name);
  const banned = new Set(seasonMembers.filter(m => m.banned).map(m => m.user_id));
  const pts = {};            // pts[round][leader] = points in that round
  const perMember = {};      // user_id / member_name → totals
  let gymUsed = 0, combined = 0, maxRound = 0;
  for (const r of runs) {
    ((pts[r.round] ||= {})[r.leader] = (pts[r.round][r.leader] || 0) + r.score);
    const key = r.user_id || `name:${r.member_name}`;
    const m = (perMember[key] ||= { key, user_id: r.user_id, name: r.member_name, score: 0, tickets: 0, runs: 0 });
    m.score += r.score; m.tickets += r.tickets; m.runs++;
    gymUsed += r.tickets;
    if (!banned.has(r.user_id)) combined += r.score;
    maxRound = Math.max(maxRound, r.round);
  }
  // First round where not every Gym Leader is at the cap is the one open for new runs
  let active = null;
  for (let n = 1; n < 500; n++) {
    const c = circuitAt(season, n);
    if (!c) break;
    if (!leaders.every(l => (pts[n]?.[l] || 0) >= c.pts)) { active = n; break; }
  }
  const start = Date.parse(season.battle_start), end = Date.parse(season.battle_end);
  const phase = now < start ? 'upcoming' : now >= end ? 'ended' : 'battle';
  return { leaders, pts, perMember, banned, gymUsed, combined, active, finished: active == null, maxRound,
    granted: ticketsGranted(season, now), phase, start, end };
}

export const pointsIn = (st, round, leader) => st.pts[round]?.[leader] || 0;

// ─── Run validation (mirror of check_run) ───────────────────
// run: { user_id, leader, round, tickets, score, team }; editing: the stored run being changed
export function validateRun(season, st, run, { editing = null, isStaff = false } = {}) {
  if (!Number.isInteger(run.tickets) || run.tickets < 1 || run.tickets > 3) return 'Số vé phải là 1, 2 hoặc 3.';
  if (!Number.isInteger(run.score) || run.score <= 0) return 'Điểm phải là số nguyên dương.';
  if (!st.leaders.includes(run.leader)) return 'Chọn Gym Leader.';
  const c = circuitAt(season, run.round);
  if (!c) return 'Round không tồn tại trong mùa này.';
  if (c.fixed && run.tickets !== c.fixed) return `${c.label} luôn tốn ${c.fixed} vé mỗi lượt (chọn 1–3 vé chỉ có từ Extra Battle).`;
  if (!run.user_id) return 'Chọn thành viên.';
  if (st.banned.has(run.user_id) && (!editing || editing.user_id !== run.user_id)) return 'Thành viên này đang bị khoá trong mùa, không ghi lượt mới được.';
  if (!editing && !isStaff && run.round !== st.active) return `Chỉ ghi được cho round đang mở (${st.active ? circuitAt(season, st.active).label : '—'}).`;

  const used = (st.perMember[run.user_id]?.tickets || 0) - (editing?.user_id === run.user_id ? editing.tickets : 0);
  if (used + run.tickets > st.granted) return `Không đủ vé: đã dùng ${used}, được phát ${st.granted} vé tới thời điểm này.`;
  const gymLeft = season.gym_ticket_cap - st.gymUsed + (editing ? editing.tickets : 0);
  if (run.tickets > gymLeft) return `Cả Gym chỉ được dùng ${season.gym_ticket_cap} vé — còn ${Math.max(gymLeft, 0)} vé.`;
  const have = pointsIn(st, run.round, run.leader) - (editing && editing.round === run.round && editing.leader === run.leader ? editing.score : 0);
  if (have + run.score > c.pts) return `Vượt trần: ${run.leader} ở ${c.label} chỉ còn thiếu ${(c.pts - have).toLocaleString('en-US')} điểm.`;

  const ids = (run.team || []).map(t => t.pair_id);
  if (ids.length > 3) return 'Team tối đa 3 pair.';
  if (new Set(ids).size !== ids.length) return 'Team có pair bị trùng.';
  if (!editing && !isStaff && !ids.length) return 'Chọn ít nhất 1 sync pair cho team.';
  return null;
}

// ─── Member strength for a type ─────────────────────────────
// A pair's weight: level (1–10) + 2 if 6★ EX + 1 if EX Role. Readiness for a type =
// the best three owned pairs of that type + a quarter of the tower floors cleared.
export const pairWeight = mp => (mp.level || 1) + (mp.ex ? 2 : 0) + (mp.ex_role ? 1 : 0);

export function readiness(ownedPairs, towerFloor, type, pairById) {
  const mine = ownedPairs
    .map(mp => ({ ...mp, pair: pairById(mp.pair_id) }))
    .filter(x => x.pair?.type === type)
    .sort((a, b) => pairWeight(b) - pairWeight(a));
  const top = mine.slice(0, 3).reduce((a, x) => a + pairWeight(x), 0);
  return { pairs: mine, count: mine.length, top, floor: towerFloor || 0, score: top + (towerFloor || 0) / 4 };
}

export const levelLabel = lv => `${lv}/5`;
