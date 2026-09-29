/* ═══════════════════════════════════════════════════════════════
   Demo backend — same interface as the Supabase one, kept in memory.
   Sample gym: 1 admin, 2 mods, 17 members with made-up nicknames, their
   pairs and towers, a finished season and a live one filled with runs
   that follow the real rules. Reloading the page resets everything.
   ═══════════════════════════════════════════════════════════════ */
import { GYMS, catalogRows, seasonFromGym } from './dex.js';
import { TYPES, circuitAt, seasonState, validateRun } from './rules.js';

// Deterministic randomness so every visit shows the same sample gym
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = a => a[Math.floor(rnd() * a.length)];
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NICKS = ['Lumina', 'Kaiser', 'Mochi', 'Rook', 'Astra', 'Pip', 'Nova', 'Bramble', 'Tofu', 'Zephyr', 'Juno',
  'Pixel', 'Marlow', 'Echo', 'Saffron', 'Quill', 'Onyx', 'Tansy', 'Vireo', 'Coda'];

function seedData() {
  const profiles = NICKS.map((nick, i) => ({
    id: uid(i + 1), username: nick.toLowerCase(), display_name: nick, facebook: '', note: '',
    role: i === 0 ? 'admin' : i < 3 ? 'mod' : 'member', joined_at: '2026-01-01',
    created_at: new Date(Date.now() - (40 - i) * 864e5).toISOString(),
  }));
  const catalog = catalogRows();
  const memberPairs = [], tower = [];
  for (const p of profiles) {
    const skill = 0.3 + rnd() * 0.7;
    for (const c of catalog) {
      if (rnd() > 0.10 + skill * 0.18) continue;
      const level = c.max_bonus === 10 && rnd() < skill * 0.5 ? 5 + Math.ceil(rnd() * 5) : 1 + Math.floor(rnd() * 5 * skill + rnd());
      memberPairs.push({ user_id: p.id, pair_id: c.id, level: Math.min(level, c.max_bonus), ex: rnd() < skill * 0.6,
        ex_role: !!c.ex_role && rnd() < skill * 0.4, note: '', updated_at: new Date().toISOString() });
    }
    for (const t of TYPES) {
      const f = Math.round(Math.min(40, Math.max(0, 40 * skill - 8 + rnd() * 16)));
      if (f) tower.push({ user_id: p.id, type: t, floor: f, updated_at: new Date().toISOString() });
    }
  }

  // Live season = newest datamine gym, Battle opened 3 days ago; the previous gym is a finished season
  const seasons = [];
  const live = GYMS[GYMS.length - 1], past = GYMS[GYMS.length - 2];
  if (past) seasons.push({ ...seasonFromGym(past), id: 1, name: `${past.name} (demo)`, is_active: false,
    battle_start: new Date(Date.now() - 40 * 864e5).toISOString(), battle_end: new Date(Date.now() - 33 * 864e5).toISOString() });
  if (live) seasons.push({ ...seasonFromGym(live), id: 2, name: `${live.name} (demo)`, is_active: true,
    battle_start: new Date(Date.now() - 3.2 * 864e5).toISOString(), battle_end: new Date(Date.now() + 3.8 * 864e5).toISOString() });
  for (const s of seasons) Object.assign(s, { tickets_day1: 9, tickets_daily: 3, ticket_cap: 30, gym_ticket_cap: 600,
    target_score: s.is_active ? 18000000 : 15000000, created_by: uid(1), created_at: s.battle_start });

  const seasonMembers = [{ season_id: 2, user_id: uid(20), banned: true, note: 'Nghỉ giữa mùa' }];
  const runs = [];
  let runId = 1;
  for (const s of seasons) simulate(s, profiles, memberPairs, seasonMembers.filter(m => m.season_id === s.id), runs, () => runId++);

  const assignments = [], notes = [];
  const live2 = seasons.find(s => s.is_active);
  if (live2) {
    live2.leaders.forEach((l, i) => {
      assignments.push({ season_id: live2.id, leader: l.name, user_id: profiles[3 + (i * 2) % 17].id, note: '' });
      assignments.push({ season_id: live2.id, leader: l.name, user_id: profiles[4 + (i * 2) % 16].id, note: '' });
    });
    notes.push({ season_id: live2.id, leader: live2.leaders[0].name, note: 'Mở đầu bằng Field để dựng zone trước, DPS vào sau.', updated_by: uid(2) });
  }
  const activity = runs.slice(0, 30).map((r, i) => ({ id: i + 1, at: r.created_at, actor: r.created_by, actor_name: r.member_name,
    action: 'runs.insert', detail: { leader: r.leader, round: r.round, score: r.score } }));
  return { profiles, catalog, memberPairs, tower, seasons, seasonMembers, runs, assignments, notes, activity };
}

// Fill a season with runs that pass validateRun, the way a gym plays it
function simulate(season, profiles, memberPairs, seasonMembers, runs, nextId) {
  // The admin, first mod and first member are the "try it" accounts: keep tickets for them to spend
  const tryIt = new Set(['admin', 'mod', 'member'].map(r => profiles.find(p => p.role === r)?.id));
  const players = profiles;
  const start = Date.parse(season.battle_start), end = Date.parse(season.battle_end);
  const stop = Math.min(Date.now(), end);
  for (let t = start + 36e5; t < stop; t += 36e5 * 3) {
    const mine = runs.filter(r => r.season_id === season.id);
    const st = seasonState(season, mine, seasonMembers, t);
    if (st.finished) break;
    for (const p of players) {
      if (rnd() > 0.35) continue;
      const now = seasonState(season, runs.filter(r => r.season_id === season.id), seasonMembers, t);
      if (now.finished) break;
      if (tryIt.has(p.id) && season.is_active && (now.perMember[p.id]?.tickets || 0) >= now.granted - 9) continue;
      const c = circuitAt(season, now.active);
      const open = now.leaders.filter(l => (now.pts[now.active]?.[l] || 0) < c.pts);
      const leader = pick(open);
      const left = c.pts - (now.pts[now.active]?.[leader] || 0);
      const tickets = c.fixed || 1 + Math.floor(rnd() * 3);
      const score = Math.max(1, Math.min(left, Math.round(c.pts * (0.4 + rnd() * 0.9) * tickets / 3)));
      const owned = memberPairs.filter(m => m.user_id === p.id);
      const team = Array.from({ length: 3 }, () => pick(owned)).filter(Boolean)
        .filter((x, i, a) => a.findIndex(y => y.pair_id === x.pair_id) === i)
        .map(x => ({ pair_id: x.pair_id, level: x.level, ex: x.ex, ex_role: x.ex_role }));
      const run = { user_id: p.id, leader, round: now.active, tickets, score, team };
      if (validateRun(season, now, run, { isStaff: false })) continue;
      runs.push({ id: nextId(), season_id: season.id, member_name: p.display_name, note: '', created_by: p.id,
        created_at: new Date(t + rnd() * 36e5).toISOString(), updated_at: new Date(t).toISOString(), ...run });
    }
  }
  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createDemoApi() {
  const db = seedData();
  let me = null;
  const role = () => db.profiles.find(p => p.id === me)?.role;
  const staff = () => ['admin', 'mod'].includes(role());
  const deny = msg => { throw new Error(msg || 'Không có quyền.'); };
  const selfOrStaff = id => (id === me || staff() || deny());
  const clone = x => JSON.parse(JSON.stringify(x));
  const seasonRuns = sid => db.runs.filter(r => r.season_id === sid);
  let nextRun = Math.max(0, ...db.runs.map(r => r.id)) + 1;

  function checkRun(row, editing) {
    const s = db.seasons.find(x => x.id === row.season_id);
    const st = seasonState(s, seasonRuns(s.id).filter(r => r !== editing), db.seasonMembers.filter(m => m.season_id === s.id));
    // seasonState above already excludes the edited run, so validate as a new one but keep staff/edit leniency
    const err = validateRun(s, st, row, { isStaff: staff() || !!editing });
    if (err) throw new Error(err);
  }

  return {
    mode: 'demo',
    demoUsers: () => ['admin', 'mod', 'member'].map(r => db.profiles.find(p => p.role === r)),
    async session() { return me; },
    async signIn(username) {
      const p = db.profiles.find(x => x.username === username.trim().toLowerCase());
      if (!p) throw new Error('Sai username hoặc mật khẩu.');
      me = p.id;
    },
    async signOut() { me = null; },
    async changePassword(pw) { if (String(pw).length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự.'); },

    async adminUsers(body) {
      if (role() !== 'admin') deny('Chỉ admin được quản lý tài khoản.');
      if (body.action === 'create') {
        if (!/^[a-z0-9_.-]{3,32}$/.test(body.username || '')) deny('Username 3–32 ký tự: chữ thường, số, _ . -');
        if (db.profiles.some(p => p.username === body.username)) deny('Username đã tồn tại.');
        if (String(body.password || '').length < 8) deny('Mật khẩu tối thiểu 8 ký tự.');
        const id = uid(1000 + db.profiles.length);
        db.profiles.push({ id, username: body.username, display_name: body.display_name || '', facebook: '', note: '',
          role: body.role || 'member', joined_at: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() });
        return { id };
      }
      if (body.action === 'delete') {
        if (body.user_id === me) deny('Không tự xoá tài khoản admin của mình.');
        db.profiles = db.profiles.filter(p => p.id !== body.user_id);
        db.memberPairs = db.memberPairs.filter(x => x.user_id !== body.user_id);
        db.tower = db.tower.filter(x => x.user_id !== body.user_id);
        db.assignments = db.assignments.filter(x => x.user_id !== body.user_id);
        db.seasonMembers = db.seasonMembers.filter(x => x.user_id !== body.user_id);
        for (const r of db.runs) if (r.user_id === body.user_id) r.user_id = null;   // runs keep member_name
        return { ok: true };
      }
      if (body.action === 'reset_password') return { ok: true };
      if (body.action === 'set_role') {
        db.profiles.find(p => p.id === body.user_id).role = body.role;
        return { ok: true };
      }
      deny('action không hợp lệ.');
    },

    profiles: async () => clone(db.profiles),
    async updateProfile(id, patch) {
      selfOrStaff(id);
      if (('role' in patch || 'username' in patch) && role() !== 'admin') deny('Chỉ admin được đổi vai trò.');
      Object.assign(db.profiles.find(p => p.id === id), patch);
    },

    catalogCount: async () => db.catalog.length,
    async syncCatalog(rows) { staff() || deny(); db.catalog = clone(rows); },

    memberPairs: async () => clone(db.memberPairs),
    async upsertMemberPair(row) {
      selfOrStaff(row.user_id);
      const c = db.catalog.find(x => x.id === row.pair_id);
      if (row.level > c.max_bonus) deny(`${c.trainer} & ${c.pokemon} chỉ tới ${c.max_bonus}/5.`);
      if (row.ex_role && !c.ex_role) deny(`${c.trainer} & ${c.pokemon} không có EX Role.`);
      const i = db.memberPairs.findIndex(x => x.user_id === row.user_id && x.pair_id === row.pair_id);
      const full = { level: 1, ex: false, ex_role: false, note: '', ...(i >= 0 ? db.memberPairs[i] : {}), ...row, updated_at: new Date().toISOString() };
      if (i >= 0) db.memberPairs[i] = full; else db.memberPairs.push(full);
      return clone(full);
    },
    async deleteMemberPair(user_id, pair_id) {
      selfOrStaff(user_id);
      db.memberPairs = db.memberPairs.filter(x => !(x.user_id === user_id && x.pair_id === pair_id));
    },

    tower: async () => clone(db.tower),
    async upsertTower(row) {
      selfOrStaff(row.user_id);
      if (!(row.floor >= 0 && row.floor <= 40)) deny('Tầng tháp từ 0 đến 40.');
      const i = db.tower.findIndex(x => x.user_id === row.user_id && x.type === row.type);
      if (i >= 0) db.tower[i] = { ...db.tower[i], ...row }; else db.tower.push({ ...row });
    },

    seasons: async () => clone(db.seasons).sort((a, b) => b.battle_start.localeCompare(a.battle_start)),
    async createSeason(row) {
      staff() || deny();
      const s = { id: Math.max(0, ...db.seasons.map(x => x.id)) + 1, is_active: false, created_at: new Date().toISOString(), ...row };
      db.seasons.push(s);
      return clone(s);
    },
    async updateSeason(id, patch) { staff() || deny(); Object.assign(db.seasons.find(s => s.id === id), patch); },
    async setActiveSeason(id) { staff() || deny(); for (const s of db.seasons) s.is_active = s.id === id; },
    async deleteSeason(id) {
      staff() || deny();
      db.seasons = db.seasons.filter(s => s.id !== id);
      db.runs = db.runs.filter(r => r.season_id !== id);
    },

    seasonMembers: async sid => clone(db.seasonMembers.filter(m => m.season_id === sid)),
    async setBanned(season_id, user_id, banned) {
      staff() || deny();
      const m = db.seasonMembers.find(x => x.season_id === season_id && x.user_id === user_id);
      if (m) m.banned = banned; else db.seasonMembers.push({ season_id, user_id, banned, note: '' });
    },

    runs: async sid => clone(seasonRuns(sid)),
    async createRun(row) {
      if (row.user_id !== me && !staff()) deny();
      checkRun(row, null);
      const p = db.profiles.find(x => x.id === row.user_id);
      const r = { id: nextRun++, member_name: p?.display_name || p?.username || '', note: '', created_by: me,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      db.runs.unshift(r);
      db.activity.unshift({ id: Date.now(), at: r.created_at, actor: me, actor_name: db.profiles.find(x => x.id === me)?.display_name,
        action: 'runs.insert', detail: { leader: r.leader, round: r.round, score: r.score, member_name: r.member_name } });
      return clone(r);
    },
    async updateRun(id, patch) {
      const r = db.runs.find(x => x.id === id);
      if (r.user_id !== me && !staff()) deny();
      checkRun({ ...r, ...patch }, r);
      Object.assign(r, patch, { updated_at: new Date().toISOString() });
    },
    async deleteRun(id) {
      const r = db.runs.find(x => x.id === id);
      if (r.user_id !== me && !staff()) deny();
      db.runs = db.runs.filter(x => x.id !== id);
    },

    assignments: async sid => clone(db.assignments.filter(a => a.season_id === sid)),
    async addAssignment(row) {
      staff() || deny();
      if (!db.assignments.some(a => a.season_id === row.season_id && a.leader === row.leader && a.user_id === row.user_id)) db.assignments.push({ note: '', ...row });
    },
    async removeAssignment(season_id, leader, user_id) {
      staff() || deny();
      db.assignments = db.assignments.filter(a => !(a.season_id === season_id && a.leader === leader && a.user_id === user_id));
    },

    notes: async sid => clone(db.notes.filter(n => n.season_id === sid)),
    async saveNote(row) {
      staff() || deny();
      const n = db.notes.find(x => x.season_id === row.season_id && x.leader === row.leader);
      if (n) Object.assign(n, row); else db.notes.push({ ...row });
    },

    activity: async () => (staff() ? clone(db.activity.slice(0, 200)) : []),
  };
}
