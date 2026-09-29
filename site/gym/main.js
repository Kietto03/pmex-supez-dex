/* ═══════════════════════════════════════════════════════════════
   PMEX Gym Manager — UI (vanilla JS, hash router)
   Pages: login · dashboard · log · plan · members · member/<id> · account · admin
   ═══════════════════════════════════════════════════════════════ */
import { createApi, isDemo } from './api.js';
import { TYPES, TOWER_TOP, circuitAt, roundShort, seasonState, pointsIn, validateRun, readiness, pairWeight, levelLabel } from './rules.js';
import { PAIRS, pairById, pairName, asset, PLACEHOLDER, TYPE_COLORS, ROLE_COLORS, roleBase, catalogRows,
  GYMS, gymByKey, seasonFromGym, leaderRule, leaderUnit, leaderSprite } from './dex.js';

// ─── Helpers ────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => (n ?? 0).toLocaleString('en-US');
const fmtK = n => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const fmtDT = iso => iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtD = iso => iso ? new Date(iso).toLocaleDateString('vi-VN') : '—';
const img = (src, cls = '', alt = '') => `<img src="${esc(src || PLACEHOLDER)}" class="px-img ${cls}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">`;
const typeBadge = (t, sm = true) => t ? `<span class="type-badge ${sm ? 'sm' : ''}" style="background:${TYPE_COLORS[t] || '#777'}">${esc(t)}</span>` : '';
const roleTag = r => `<span class="tag sm role-${r}">${{ admin: '👑 Admin', mod: '🛡️ Mod', member: 'Member' }[r] || r}</span>`;
const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${bad ? 'bad' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 2500);
}
// Run an API call; show its error message instead of throwing
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; } catch (e) { toast(e.message, true); return false; }
}

// ─── State ──────────────────────────────────────────────────
let api;
const S = { me: null, profiles: [], mp: [], tower: [], seasons: [], sid: null, runs: [], sm: [], asg: [], notes: [] };
const meP = () => S.profiles.find(p => p.id === S.me);
const isStaff = () => ['admin', 'mod'].includes(meP()?.role);
const isAdmin = () => meP()?.role === 'admin';
const profile = id => S.profiles.find(p => p.id === id);
const nameOf = p => p ? (p.display_name || p.username) : '';
const season = () => S.seasons.find(s => s.id === S.sid);
const gymOf = s => s?.gym_key ? gymByKey(s.gym_key) : null;
const owned = uid => S.mp.filter(x => x.user_id === uid);
const towerFloor = (uid, type) => S.tower.find(x => x.user_id === uid && x.type === type)?.floor || 0;
const canEdit = uid => uid === S.me || isStaff();

async function loadAll() {
  [S.profiles, S.mp, S.tower, S.seasons] = await Promise.all([api.profiles(), api.memberPairs(), api.tower(), api.seasons()]);
  let saved = null;
  try { saved = +localStorage.getItem('gym-season'); } catch { /* private mode */ }
  S.sid = (S.seasons.find(s => s.id === saved) || S.seasons.find(s => s.is_active) || S.seasons[0])?.id ?? null;
  await loadSeason();
}
async function loadSeason() {
  if (!S.sid) { S.runs = S.sm = S.asg = S.notes = []; return; }
  [S.runs, S.sm, S.asg, S.notes] = await Promise.all([api.runs(S.sid), api.seasonMembers(S.sid), api.assignments(S.sid), api.notes(S.sid)]);
}
const state = () => season() ? seasonState(season(), S.runs, S.sm) : null;

// ─── Router ─────────────────────────────────────────────────
const view = $('#view');
const routes = { '': renderDashboard, log: renderLog, plan: renderPlan, members: renderMembers, member: renderMember, account: renderAccount, admin: renderAdmin };
const after = {};

async function route() {
  if (!S.me) { renderLogin(); return; }
  const [, name = '', ...args] = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
  const fn = routes[name] || renderDashboard;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === (name === 'member' && args[0] !== S.me ? 'members' : name === 'member' ? 'account' : name || 'home')));
  $('#nav-admin').classList.toggle('hidden', !isStaff());
  $('#userbox').innerHTML = `<a href="#/member/${S.me}" class="user-chip">${esc(nameOf(meP()))} ${roleTag(meP().role)}</a>`;
  view.innerHTML = fn(...args);
  after[name]?.(...args);
}
addEventListener('hashchange', route);

// ═══════════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════════
function renderLogin() {
  $('#nav').classList.add('hidden');
  $('#userbox').innerHTML = '';
  view.innerHTML = `
  <div class="login box">
    <img src="../assets/items/master-ball.png" class="px-img login-ball" alt="">
    <h1>GYM MANAGER</h1>
    <p class="muted">Đăng nhập bằng tài khoản admin cấp cho bạn.</p>
    <form id="login-form" class="form">
      <label>Username<input name="username" autocomplete="username" required autofocus></label>
      <label>Mật khẩu<input name="password" type="password" autocomplete="current-password" ${isDemo ? '' : 'required'}></label>
      <button class="chip on big">Đăng nhập</button>
      <p class="form-err" id="login-err"></p>
    </form>
    ${isDemo ? `<div class="demo-box">
      <b>Chế độ demo</b> — dữ liệu mẫu trong trình duyệt, không lưu gì. Vào thử với vai:
      <div class="row">${api.demoUsers().map(p => `<button class="chip" data-demo="${p.username}">${roleTag(p.role)} ${esc(p.display_name)}</button>`).join('')}</div>
    </div>` : ''}
  </div>`;
}
async function signIn(username, password) {
  try {
    await api.signIn(username, password);
    S.me = await api.session();
    await loadAll();
    $('#nav').classList.remove('hidden');
    if (!location.hash || location.hash === '#/login') location.hash = '#/';
    route();
  } catch (e) { $('#login-err').textContent = e.message; }
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'login-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  signIn(f.get('username'), f.get('password'));
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-demo]');
  if (b) signIn(b.dataset.demo, 'demo-password');
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════
function seasonBar() {
  if (!S.seasons.length) return '';
  return `<div class="season-bar">${S.seasons.map(s => `
    <button class="chip ${s.id === S.sid ? 'on' : ''}" data-season="${s.id}">${s.is_active ? '★ ' : ''}${esc(s.name)}</button>`).join('')}</div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-season]');
  if (!b) return;
  S.sid = +b.dataset.season;
  try { localStorage.setItem('gym-season', S.sid); } catch { /* private mode */ }
  await loadSeason();
  route();
});

function noSeason() {
  return `<div class="empty box">${img(PLACEHOLDER)}Chưa có mùa Gym Battle nào.
    ${isStaff() ? '<br><a class="chip on" href="#/admin">Tạo mùa trong Quản trị →</a>' : '<br>Chờ admin tạo mùa mới.'}</div>`;
}

function renderDashboard() {
  const s = season();
  if (!s) return seasonBar() + noSeason();
  const st = state(), gym = gymOf(s);
  const act = st.active ? circuitAt(s, st.active) : null;
  const rows = Math.max(st.active || 0, st.maxRound, 1);
  // Long seasons: fold the cleared rounds except the last two
  const firstShown = showAllRounds ? 1 : Math.max(1, (st.active || rows) - 2);
  const board = Object.values(st.perMember).sort((a, b) => b.score - a.score);
  // Members who haven't logged anything yet still belong on the board
  for (const p of S.profiles) if (!st.perMember[p.id]) board.push({ key: p.id, user_id: p.id, name: nameOf(p), score: 0, tickets: 0, runs: 0 });
  const left = S.profiles.filter(p => !st.banned.has(p.id)).map(p => ({ p, left: st.granted - (st.perMember[p.id]?.tickets || 0) }))
    .filter(x => x.left > 0).sort((a, b) => b.left - a.left);
  const phase = { upcoming: ['Sắp mở', 'soon'], battle: ['Đang diễn ra', 'live'], ended: ['Đã kết thúc', 'ended'] }[st.phase];
  const pct = s.target_score ? Math.min(100, st.combined / s.target_score * 100) : null;

  return `${seasonBar()}
  <section class="gym-head box">
    <div>
      <div class="gh-title">${esc(s.name)} <span class="phase-tag ${phase[1]}">${phase[0]}</span></div>
      <div class="muted">${esc(s.gym_key || 'Mùa tự tạo')} · Battle ${fmtDT(s.battle_start)} → ${fmtDT(s.battle_end)}</div>
    </div>
    <div class="gh-leaders">${s.leaders.map(l => `<span title="${esc(l.name)}">${img(leaderSprite(gym, l.name), 'sprite')}</span>`).join('')}</div>
  </section>

  <div class="kpis">
    <div class="box kpi wide"><small>Tổng điểm (Combined)</small><b>${fmtN(st.combined)}</b>
      ${pct != null ? `<div class="meter"><i style="width:${pct}%"></i></div><span>${pct.toFixed(1)}% mục tiêu ${fmtK(s.target_score)}</span>` : '<span>Chưa đặt mục tiêu</span>'}</div>
    <div class="box kpi"><small>Round đang mở</small><b>${act ? esc(roundShort(act.label)) : st.finished ? 'Xong hết' : '—'}</b><span>${act ? `${fmtK(act.pts)} điểm / leader` : ''}</span></div>
    <div class="box kpi"><small>Vé được phát / người</small><b>${st.granted}<em>/${s.ticket_cap}</em></b><span>${s.tickets_day1} ngày đầu · +${s.tickets_daily}/ngày</span></div>
    <div class="box kpi"><small>Vé cả Gym</small><b>${st.gymUsed}<em>/${s.gym_ticket_cap}</em></b><span>${S.runs.length} lượt đánh</span></div>
  </div>

  <div class="section">
    <h2 class="section-title">Tiến độ từng Gym Leader <span class="count">bấm ô để ghi lượt</span></h2>
    <div class="box table-wrap">
      <table class="progress">
        <thead><tr><th>Round</th>${s.leaders.map(l => `<th class="lh">${img(leaderSprite(gym, l.name), 'sprite')}<b>${esc(l.name)}</b>
          <span>${(l.weakness || []).map(w => typeBadge(w)).join('')}</span></th>`).join('')}</tr></thead>
        <tbody>${firstShown > 1 ? `<tr class="folded"><th colspan="${s.leaders.length + 1}"><button class="chip sm" data-all-rounds>▼ ${esc(roundShort(circuitAt(s, 1).label))}–${esc(roundShort(circuitAt(s, firstShown - 1).label))} đã xong — hiện tất cả</button></th></tr>` : ''}
        ${Array.from({ length: rows - firstShown + 1 }, (_, i) => i + firstShown).map(n => {
          const c = circuitAt(s, n);
          if (!c) return '';
          return `<tr class="${n === st.active ? 'active' : ''}"><th>${img(`../assets/items/${{ 'Poke Ball': 'poke-ball', 'Great Ball': 'great-ball', 'Ultra Ball': 'ultra-ball', 'Master Ball': 'master-ball' }[c.ball] || 'poke-ball'}.png`, 'ball')}${esc(roundShort(c.label))}<small>${fmtK(c.pts)}</small></th>
            ${s.leaders.map(l => {
              const v = pointsIn(st, n, l.name), full = v >= c.pts;
              return `<td><a class="pcell ${full ? 'full' : v ? 'part' : ''}" href="#/log/${encodeURIComponent(l.name)}/${n}" title="${esc(l.name)} · ${esc(c.label)}: ${fmtN(v)} / ${fmtN(c.pts)}">
                <i style="width:${Math.min(100, v / c.pts * 100)}%"></i><span>${full ? '✔' : v ? fmtK(v) : '·'}</span></a></td>`;
            }).join('')}</tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>

  <div class="grid-2 section">
    <div>
      <h2 class="section-title">Bảng điểm thành viên</h2>
      <div class="box table-wrap">
        <table class="tbl">
          <thead><tr><th>#</th><th>Thành viên</th><th class="num">Điểm</th><th class="num">Vé</th><th class="num">Còn</th><th class="num">TB/vé</th><th class="num">Lượt</th></tr></thead>
          <tbody>${board.map((m, i) => {
            const banned = st.banned.has(m.user_id);
            const gone = !m.user_id || !profile(m.user_id);
            return `<tr class="${banned ? 'banned' : ''}">
              <td>${i + 1}</td>
              <td>${gone ? `<span class="muted">${esc(m.name)} (đã rời)</span>` : `<a href="#/member/${m.user_id}">${esc(m.name)}</a>`}${banned ? ' <span class="tag sm bad">khoá</span>' : ''}</td>
              <td class="num"><b>${fmtN(m.score)}</b></td><td class="num">${m.tickets}</td>
              <td class="num">${gone || banned ? '—' : Math.max(0, st.granted - m.tickets)}</td>
              <td class="num">${m.tickets ? fmtN(Math.round(m.score / m.tickets)) : '—'}</td><td class="num">${m.runs}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
    <div>
      <h2 class="section-title">Còn vé <span class="count">${left.reduce((a, x) => a + x.left, 0)} vé chưa dùng</span></h2>
      <div class="box left-list">${left.length ? left.map(x => `
        <a class="chip" href="#/log//${st.active || ''}/${x.p.id}">${esc(nameOf(x.p))} <b>${x.left}</b></a>`).join('') : '<p class="muted">Mọi người đã dùng hết vé được phát.</p>'}</div>
      <h2 class="section-title" style="margin-top:20px">Lượt gần đây</h2>
      <div class="box recent">${S.runs.slice(0, 8).map(runLine).join('') || '<p class="muted">Chưa có lượt nào.</p>'}</div>
    </div>
  </div>`;
}

let showAllRounds = false;
document.addEventListener('click', e => { if (e.target.closest('[data-all-rounds]')) { showAllRounds = true; route(); } });

function teamIcons(team) {
  return (team || []).map(t => {
    const p = pairById(t.pair_id);
    return `<span class="mini" title="${esc(pairName(p))} ${levelLabel(t.level || 1)}${t.ex ? ' EX' : ''}">${img(asset(p?.pokeSprite), 'sprite')}</span>`;
  }).join('');
}
function runLine(r) {
  const c = circuitAt(season(), r.round);
  return `<div class="run-line"><b>${esc(r.member_name)}</b> <span class="muted">${esc(r.leader)} · ${esc(roundShort(c?.label || r.round))}</span>
    <span class="team">${teamIcons(r.team)}</span><b class="num">${fmtN(r.score)}</b><small class="muted">${fmtDT(r.created_at)}</small></div>`;
}

// ═══════════════════════════════════════════════════════════════
//  LOG A RUN + HISTORY
// ═══════════════════════════════════════════════════════════════
let form = null;          // draft run being edited in the form
let logFilter = { member: '', leader: '', round: '' };

function blankForm(leader = '', round = null, member = null) {
  const st = state();
  const c = circuitAt(season(), round || st.active || 1);
  const last = S.runs.find(r => r.user_id === (member || S.me));   // reuse the member's latest team
  return { id: null, user_id: member || S.me, leader, round: round || st.active || 1, tickets: c?.fixed || 3, score: '',
    team: last ? last.team.map(t => ({ ...t })) : [], note: '' };
}

function renderLog(leader = '', round = '', member = '') {
  const s = season();
  if (!s) return seasonBar() + noSeason();
  if (!form || leader || round || member) form = blankForm(leader, +round || null, member || null);
  return `${seasonBar()}
  <div class="grid-log">
    <section class="box card" id="run-form">${runForm()}</section>
    <section>
      <h2 class="section-title">Lịch sử lượt đánh <span class="count">${S.runs.length} lượt</span></h2>
      <div class="box filters" id="log-filters">${logFilters()}</div>
      <div class="box table-wrap" id="log-table">${logTable()}</div>
    </section>
  </div>`;
}

function runForm() {
  const s = season(), st = state(), gym = gymOf(s);
  const c = circuitAt(s, form.round);
  const have = pointsIn(st, form.round, form.leader) - (form.id && form.orig?.round === form.round && form.orig?.leader === form.leader ? form.orig.score : 0);
  const used = (st.perMember[form.user_id]?.tickets || 0) - (form.id && form.orig?.user_id === form.user_id ? form.orig.tickets : 0);
  const rounds = Array.from({ length: Math.max(st.active || 0, st.maxRound) + (isStaff() ? 1 : 0) }, (_, i) => i + 1).filter(n => circuitAt(s, n));
  const mine = owned(form.user_id);
  return `
  <h2 class="section-title">${form.id ? 'Sửa lượt' : 'Ghi lượt đánh'}</h2>
  <form id="run-editor" class="form">
    <label>Thành viên
      <select name="user_id" ${isStaff() ? '' : 'disabled'}>${S.profiles.map(p => `<option value="${p.id}" ${p.id === form.user_id ? 'selected' : ''}>${esc(nameOf(p))}${st.banned.has(p.id) ? ' (khoá)' : ''}</option>`).join('')}</select>
      <small class="muted">Đã dùng ${used}/${st.granted} vé được phát</small>
    </label>
    <div class="field"><span>Gym Leader</span>
      <div class="leader-pick">${s.leaders.map(l => {
        const v = pointsIn(st, form.round, l.name), full = v >= (c?.pts || 0);
        return `<button type="button" class="lp ${l.name === form.leader ? 'on' : ''} ${full ? 'full' : ''}" data-f-leader="${esc(l.name)}">
          ${img(leaderSprite(gym, l.name), 'sprite')}<b>${esc(l.name)}</b><small>${full ? '✔ đủ' : `còn ${fmtK((c?.pts || 0) - v)}`}</small></button>`;
      }).join('')}</div></div>
    <div class="row3">
      <label>Round
        <select name="round" ${isStaff() || form.id ? '' : 'disabled'}>${rounds.map(n => `<option value="${n}" ${n === form.round ? 'selected' : ''}>${n === st.active ? '▶ ' : ''}${esc(circuitAt(s, n).label)}</option>`).join('')}</select>
      </label>
      <div class="field"><span>Vé</span><div class="seg">${[1, 2, 3].map(t => `<button type="button" data-f-tickets="${t}" class="${form.tickets === t ? 'on' : ''}" ${c?.fixed && t !== c.fixed ? 'disabled' : ''}>×${t}</button>`).join('')}</div></div>
      <label>Điểm<input name="score" type="number" min="1" step="1" inputmode="numeric" value="${esc(form.score)}" placeholder="vd 35000">
        <small class="muted">${form.leader ? `Trần ${fmtN(c?.pts)} · còn thiếu ${fmtN(Math.max(0, (c?.pts || 0) - have))}` : 'Chọn Gym Leader'}</small></label>
    </div>
    <div class="field"><span>Team (1–3 pair)</span>
      <div class="team-slots">${[0, 1, 2].map(i => {
        const t = form.team[i], p = t && pairById(t.pair_id);
        return t ? `<div class="slot">${img(asset(p?.pokeSprite), 'sprite')}<b>${esc(pairName(p))}</b>
          <span class="tag sm">${levelLabel(t.level || 1)}${t.ex ? ' · EX' : ''}${t.ex_role ? ' · EXR' : ''}</span>
          <button type="button" class="x" data-f-drop="${i}" aria-label="Bỏ">✕</button></div>` : '';
      }).join('')}
      ${form.team.length < 3 ? `<div class="pair-search"><input id="team-search" placeholder="Tìm pair (${mine.length} pair của thành viên này hiện trước)…" autocomplete="off"><div class="results" id="team-results"></div></div>` : ''}
      </div></div>
    <label>Ghi chú<input name="note" value="${esc(form.note)}" placeholder="vd: dùng 2 lần Sync, lỗi buff…"></label>
    <div class="row">
      <button class="chip on big">${form.id ? 'Lưu thay đổi' : 'Ghi lượt'}</button>
      ${form.id ? '<button type="button" class="chip" data-f-cancel>Huỷ</button>' : ''}
      <p class="form-err" id="run-err"></p>
    </div>
  </form>`;
}
const redrawForm = () => { $('#run-form').innerHTML = runForm(); };

function searchPairs(q, uid) {
  const mine = new Map(owned(uid).map(x => [x.pair_id, x]));
  const t = q.trim().toLowerCase();
  const hit = p => !t || `${p.trainer} ${p.pokemon}`.toLowerCase().includes(t);
  const taken = new Set(form.team.map(x => x.pair_id));
  const list = PAIRS.filter(p => hit(p) && !taken.has(p.id))
    .sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || (t && (a.trainer.toLowerCase().startsWith(t) ? -1 : b.trainer.toLowerCase().startsWith(t) ? 1 : 0)));
  return list.slice(0, 12).map(p => ({ p, mp: mine.get(p.id) }));
}

document.addEventListener('input', e => {
  if (e.target.id === 'team-search') {
    const res = searchPairs(e.target.value, form.user_id);
    $('#team-results').innerHTML = res.map(({ p, mp }) => `<button type="button" data-f-add="${p.id}">
      ${img(asset(p.pokeSprite), 'sprite')}<span>${esc(pairName(p))}</span>${typeBadge(p.type)}
      <small>${mp ? `${levelLabel(mp.level)}${mp.ex ? ' EX' : ''}` : 'chưa có'}</small></button>`).join('') || '<p class="muted">Không thấy pair.</p>';
  }
  if (e.target.form?.id === 'run-editor' && ['score', 'note'].includes(e.target.name)) form[e.target.name] = e.target.value;
});
document.addEventListener('focusin', e => { if (e.target.id === 'team-search') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
document.addEventListener('change', e => {
  if (e.target.form?.id !== 'run-editor') return;
  if (e.target.name === 'user_id') { form.user_id = e.target.value; redrawForm(); }
  if (e.target.name === 'round') {
    form.round = +e.target.value;
    const c = circuitAt(season(), form.round);
    if (c?.fixed) form.tickets = c.fixed;
    redrawForm();
  }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-f-leader],[data-f-tickets],[data-f-add],[data-f-drop],[data-f-cancel],[data-run-edit],[data-run-del]');
  if (!t) return;
  if (t.dataset.fLeader) { form.leader = t.dataset.fLeader; redrawForm(); }
  if (t.dataset.fTickets) { form.tickets = +t.dataset.fTickets; redrawForm(); }
  if (t.dataset.fAdd) {
    const mp = owned(form.user_id).find(x => x.pair_id === t.dataset.fAdd);
    form.team.push({ pair_id: t.dataset.fAdd, level: mp?.level || 1, ex: !!mp?.ex, ex_role: !!mp?.ex_role });
    redrawForm();
    $('#team-search')?.focus();
  }
  if (t.dataset.fDrop) { form.team.splice(+t.dataset.fDrop, 1); redrawForm(); }
  if ('fCancel' in t.dataset) { form = blankForm(); redrawForm(); }
  if (t.dataset.runEdit) {
    const r = S.runs.find(x => x.id === +t.dataset.runEdit);
    form = { ...r, team: r.team.map(x => ({ ...x })), score: String(r.score), orig: r };
    redrawForm();
    $('#run-form').scrollIntoView({ behavior: 'smooth' });
  }
  if (t.dataset.runDel) {
    const r = S.runs.find(x => x.id === +t.dataset.runDel);
    if (!confirm(`Xoá lượt ${r.member_name} · ${r.leader} · ${fmtN(r.score)} điểm?`)) return;
    if (await act(() => api.deleteRun(r.id), 'Đã xoá lượt.')) { await loadSeason(); route(); }
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'run-editor') return;
  e.preventDefault();
  const s = season();
  const run = { season_id: s.id, user_id: form.user_id, leader: form.leader, round: form.round, tickets: form.tickets,
    score: Number(form.score), team: form.team, note: form.note || '' };
  // Validate against the state without this run (when editing), the way the database does
  const st = seasonState(s, S.runs.filter(r => r.id !== form.id), S.sm);
  const err = validateRun(s, st, run, { isStaff: isStaff() || !!form.id });
  if (err) { $('#run-err').textContent = err; return; }
  const done = form.id
    ? await act(() => api.updateRun(form.id, run), 'Đã lưu thay đổi.')
    : await act(() => api.createRun(run), `Đã ghi ${fmtN(run.score)} điểm cho ${run.leader}.`);
  if (!done) return;
  await loadSeason();
  form = blankForm(form.id ? '' : run.leader, null, form.user_id);
  route();
});

function logFilters() {
  const s = season(), st = state();
  const names = [...new Set(S.runs.map(r => r.member_name))].sort();
  return `<select data-lf="member"><option value="">Mọi thành viên</option>${names.map(n => `<option ${logFilter.member === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select data-lf="leader"><option value="">Mọi Gym Leader</option>${s.leaders.map(l => `<option ${logFilter.leader === l.name ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <select data-lf="round"><option value="">Mọi round</option>${Array.from({ length: st.maxRound }, (_, i) => i + 1).map(n => `<option value="${n}" ${+logFilter.round === n ? 'selected' : ''}>${esc(circuitAt(s, n)?.label || n)}</option>`).join('')}</select>`;
}
function logTable() {
  const f = logFilter;
  const list = S.runs.filter(r => (!f.member || r.member_name === f.member) && (!f.leader || r.leader === f.leader) && (!f.round || r.round === +f.round));
  if (!list.length) return '<p class="muted pad">Chưa có lượt nào.</p>';
  return `<table class="tbl">
    <thead><tr><th>Lúc</th><th>Thành viên</th><th>Gym Leader</th><th>Round</th><th class="num">Vé</th><th class="num">Điểm</th><th>Team</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr>
      <td class="muted">${fmtDT(r.created_at)}</td><td>${esc(r.member_name)}</td><td>${esc(r.leader)}</td>
      <td>${esc(roundShort(circuitAt(season(), r.round)?.label || r.round))}</td><td class="num">${r.tickets}</td>
      <td class="num"><b>${fmtN(r.score)}</b></td><td class="team">${teamIcons(r.team)}${r.note ? ` <span class="muted" title="${esc(r.note)}">📝</span>` : ''}</td>
      <td class="acts">${canEdit(r.user_id) ? `<button class="chip sm" data-run-edit="${r.id}">Sửa</button><button class="chip sm" data-run-del="${r.id}">✕</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}
document.addEventListener('change', e => {
  const k = e.target.dataset.lf;
  if (!k) return;
  logFilter[k] = e.target.value;
  $('#log-table').innerHTML = logTable();
});

// ═══════════════════════════════════════════════════════════════
//  PLAN: rules per circuit, notes, assignments, who fits which leader
// ═══════════════════════════════════════════════════════════════
function ruleShort(t) {
  if (/Zero physical/i.test(t)) return ['SPEC', 'r-phys0', 'Địch miễn sát thương vật lý → đánh Special'];
  if (/Zero special/i.test(t)) return ['PHYS', 'r-spec0', 'Địch miễn sát thương đặc biệt → đánh Physical'];
  if (/P-move/i.test(t)) return ['P+5', 'r-pmove', 'P-move power ↑5'];
  return ['—', 'r-none', t || 'Không luật'];
}

function fitFor(uid, types) {
  return types.map(ty => readiness(owned(uid), towerFloor(uid, ty), ty, pairById)).sort((a, b) => b.score - a.score)[0]
    || { score: 0, pairs: [], floor: 0, count: 0 };
}

function renderPlan() {
  const s = season();
  if (!s) return seasonBar() + noSeason();
  const gym = gymOf(s), st = state();
  const types = [...new Set(s.leaders.flatMap(l => l.weakness || []))];
  const members = S.profiles.filter(p => !st.banned.has(p.id));
  const stages = Math.max(3, Math.min(gym?.stages.length || 3, 6));
  const scoreMax = Math.max(1, ...members.flatMap(p => types.map(t => readiness(owned(p.id), towerFloor(p.id, t), t, pairById).score)));

  return `${seasonBar()}
  <p class="section-sub">Mỗi Gym Leader: điểm yếu, luật theo circuit (từ datamine), ghi chú chiến thuật, người được phân công và gợi ý người hợp nhất.
    Độ hợp = 3 pair mạnh nhất cùng type (level + EX + EX Role) + ¼ số tầng tháp type đó.</p>
  <div class="plan-grid">${s.leaders.map(l => {
    const w = l.weakness || [];
    const asg = S.asg.filter(a => a.leader === l.name);
    const note = S.notes.find(n => n.leader === l.name)?.note || '';
    const sugg = members.map(p => ({ p, fit: fitFor(p.id, w) })).sort((a, b) => b.fit.score - a.fit.score).slice(0, 5);
    const unit = leaderUnit(gym, l.name, stages);
    return `<article class="box plan-card" style="--tc:${TYPE_COLORS[l.type] || '#888'}">
      <header>${img(leaderSprite(gym, l.name), 'sprite')}<div><b>${esc(l.name)}</b> ${typeBadge(l.type)}
        <div class="weak">Yếu: ${w.map(x => typeBadge(x, false)).join(' ') || '—'}</div></div></header>
      ${gym ? `<div class="rule-strip">${Array.from({ length: stages + 3 }, (_, i) => i + 1).map(n => {
        const [txt, cls, tipText] = ruleShort(leaderRule(gym, l.name, n));
        return `<span class="mcell ${cls}" title="${esc(circuitAt(s, n)?.label || '')}: ${esc(tipText)}">${esc(roundShort(circuitAt(s, n)?.label || n))}<br>${txt}</span>`;
      }).join('')}</div>` : ''}
      ${unit?.focus?.length ? `<div class="focus">${unit.focus.map(f => `<span class="tag sm">🔸 ${esc(f)}</span>`).join('')}</div>` : ''}
      <label class="note">📝 Ghi chú
        ${isStaff() ? `<textarea data-note="${esc(l.name)}" rows="2" placeholder="Chiến thuật, team gợi ý…">${esc(note)}</textarea>` : `<p>${esc(note) || '<span class="muted">—</span>'}</p>`}</label>
      <div class="asg"><span>Phân công:</span>${asg.map(a => `<span class="chip sm">${esc(nameOf(profile(a.user_id)))}${isStaff() ? ` <button class="x" data-asg-del="${esc(l.name)}|${a.user_id}">✕</button>` : ''}</span>`).join('') || '<span class="muted">chưa có</span>'}
        ${isStaff() ? `<select data-asg-add="${esc(l.name)}"><option value="">+ thêm…</option>${members.filter(p => !asg.some(a => a.user_id === p.id)).map(p => `<option value="${p.id}">${esc(nameOf(p))}</option>`).join('')}</select>` : ''}</div>
      <div class="sugg"><span>Gợi ý:</span>${sugg.map(({ p, fit }) => `
        <a class="sg" href="#/member/${p.id}" title="${fit.count} pair · tháp ${fit.floor}/40">
          <b>${esc(nameOf(p))}</b>${fit.pairs.slice(0, 3).map(x => img(asset(x.pair?.pokeSprite), 'sprite')).join('')}<small>${fit.floor}F · ${fit.score.toFixed(0)}</small></a>`).join('')}</div>
    </article>`;
  }).join('')}</div>

  <div class="section">
    <h2 class="section-title">Độ phủ type điểm yếu <span class="count">số pair · tầng tháp</span></h2>
    <div class="box table-wrap"><table class="tbl cover">
      <thead><tr><th>Thành viên</th>${types.map(t => `<th>${typeBadge(t)}</th>`).join('')}</tr></thead>
      <tbody>${members.map(p => `<tr><td><a href="#/member/${p.id}">${esc(nameOf(p))}</a></td>${types.map(t => {
        const r = readiness(owned(p.id), towerFloor(p.id, t), t, pairById);
        return `<td class="heat" style="--h:${(r.score / scoreMax).toFixed(2)};--tc:${TYPE_COLORS[t]}" title="${esc(r.pairs.slice(0, 3).map(x => pairName(x.pair) + ' ' + levelLabel(x.level)).join('\n'))}">
          <b>${r.count || '·'}</b><small>${r.floor}F</small></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
  </div>`;
}
const saveNote = debounce(async (leader, note) => {
  await act(() => api.saveNote({ season_id: S.sid, leader, note, updated_by: S.me }), 'Đã lưu ghi chú.');
  S.notes = await api.notes(S.sid);
}, 800);
document.addEventListener('input', e => { if (e.target.dataset.note) saveNote(e.target.dataset.note, e.target.value); });
document.addEventListener('change', async e => {
  const leader = e.target.dataset.asgAdd;
  if (!leader || !e.target.value) return;
  if (await act(() => api.addAssignment({ season_id: S.sid, leader, user_id: e.target.value }))) { S.asg = await api.assignments(S.sid); route(); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-asg-del]');
  if (!b) return;
  const [leader, uid] = b.dataset.asgDel.split('|');
  if (await act(() => api.removeAssignment(S.sid, leader, uid))) { S.asg = await api.assignments(S.sid); route(); }
});

// ═══════════════════════════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════════════════════════
let memberView = 'table';
function renderMembers() {
  const st = state();
  const rows = S.profiles.map(p => {
    const mine = owned(p.id);
    const floors = TYPES.map(t => towerFloor(p.id, t));
    return { p, pairs: mine.length, ex: mine.filter(x => x.ex).length, sa: mine.filter(x => x.level >= 10).length,
      tower: floors.reduce((a, b) => a + b, 0), top: floors.filter(f => f >= TOWER_TOP).length, season: st?.perMember[p.id] };
  }).sort((a, b) => (b.season?.score || 0) - (a.season?.score || 0) || nameOf(a.p).localeCompare(nameOf(b.p)));

  return `<div class="filter-line" style="margin-bottom:14px">
    <h1 class="section-title" style="margin:0 12px 0 0">Thành viên <span class="count">${S.profiles.length} người</span></h1>
    <button class="chip ${memberView === 'table' ? 'on' : ''}" data-mview="table">Danh sách</button>
    <button class="chip ${memberView === 'types' ? 'on' : ''}" data-mview="types">Độ phủ 18 type</button>
    <button class="chip ${memberView === 'tower' ? 'on' : ''}" data-mview="tower">Tháp theo type</button>
  </div>
  <div class="box table-wrap">${memberView === 'table' ? `<table class="tbl">
    <thead><tr><th>Thành viên</th><th>Vai trò</th><th class="num">Pair</th><th class="num">EX</th><th class="num">10/5</th><th class="num">Tháp</th><th class="num">Tháp 40F</th><th class="num">Điểm mùa</th><th class="num">Vé</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><a href="#/member/${r.p.id}"><b>${esc(nameOf(r.p))}</b></a> <small class="muted">@${esc(r.p.username)}</small></td><td>${roleTag(r.p.role)}</td>
      <td class="num">${r.pairs}</td><td class="num">${r.ex}</td><td class="num">${r.sa}</td>
      <td class="num">${r.tower}<small class="muted">/${TYPES.length * TOWER_TOP}</small></td><td class="num">${r.top}</td>
      <td class="num">${fmtN(r.season?.score || 0)}</td><td class="num">${r.season?.tickets || 0}</td></tr>`).join('')}</tbody></table>`
  : `<table class="tbl cover">
    <thead><tr><th>Thành viên</th>${TYPES.map(t => `<th>${typeBadge(t)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr><td><a href="#/member/${r.p.id}">${esc(nameOf(r.p))}</a></td>${TYPES.map(t => {
      if (memberView === 'tower') { const f = towerFloor(r.p.id, t); return `<td class="heat" style="--h:${(f / TOWER_TOP).toFixed(2)};--tc:${TYPE_COLORS[t]}"><b>${f || '·'}</b></td>`; }
      const n = owned(r.p.id).filter(x => pairById(x.pair_id)?.type === t).length;
      return `<td class="heat" style="--h:${Math.min(1, n / 8).toFixed(2)};--tc:${TYPE_COLORS[t]}"><b>${n || '·'}</b></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`}
  </div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mview]');
  if (b) { memberView = b.dataset.mview; route(); }
});

// ═══════════════════════════════════════════════════════════════
//  MEMBER PROFILE: info, pairs, tower, runs
// ═══════════════════════════════════════════════════════════════
let memberTab = 'pairs', pairFilter = { q: '', type: '' }, editingInfo = false;

function renderMember(id = S.me) {
  const p = profile(id);
  if (!p) return `<div class="empty">${img(PLACEHOLDER)}Không tìm thấy thành viên (có thể đã bị xoá).</div>`;
  const edit = canEdit(id);
  const mine = owned(id);
  const floors = TYPES.map(t => towerFloor(id, t)).reduce((a, b) => a + b, 0);
  return `
  <section class="box member-head">
    <div>
      <h1>${esc(nameOf(p))} ${roleTag(p.role)}</h1>
      <div class="muted">@${esc(p.username)}${p.facebook ? ` · FB: ${esc(p.facebook)}` : ''} · vào gym ${fmtD(p.joined_at)}</div>
      ${p.note ? `<p class="prose">${esc(p.note)}</p>` : ''}
    </div>
    <div class="mh-stats"><div><b>${mine.length}</b>pair</div><div><b>${mine.filter(x => x.ex).length}</b>EX</div>
      <div><b>${mine.filter(x => x.level >= 10).length}</b>10/5</div><div><b>${floors}</b>tầng tháp</div></div>
    ${edit ? `<button class="chip" data-edit-info>${editingInfo ? 'Đóng' : '✎ Sửa thông tin'}</button>` : ''}
  </section>
  ${editingInfo && edit ? `<form class="box card form info-form" id="info-form">
    <div class="row3"><label>Nickname trong game<input name="display_name" value="${esc(p.display_name)}"></label>
    <label>Facebook<input name="facebook" value="${esc(p.facebook)}"></label>
    <label>Ngày vào gym<input name="joined_at" type="date" value="${esc(p.joined_at)}"></label></div>
    <label>Ghi chú<textarea name="note" rows="2">${esc(p.note)}</textarea></label>
    <button class="chip on">Lưu</button></form>` : ''}
  <div class="filter-line tabs">
    <button class="chip ${memberTab === 'pairs' ? 'on' : ''}" data-mtab="pairs">Pair (${mine.length})</button>
    <button class="chip ${memberTab === 'tower' ? 'on' : ''}" data-mtab="tower">Pasio Tower</button>
    <button class="chip ${memberTab === 'runs' ? 'on' : ''}" data-mtab="runs">Lượt đánh mùa này</button>
    ${!edit ? '<span class="muted">Chỉ xem — chỉ chủ tài khoản, mod và admin sửa được.</span>' : ''}
  </div>
  <div id="member-tab">${memberTab === 'pairs' ? pairsTab(id, edit) : memberTab === 'tower' ? towerTab(id, edit) : runsTab(id)}</div>`;
}

function pairsTab(id, edit) {
  const f = pairFilter;
  const mine = owned(id).map(x => ({ ...x, pair: pairById(x.pair_id) })).filter(x => x.pair);
  const types = TYPES.filter(t => mine.some(x => x.pair.type === t));
  const shown = mine.filter(x => (!f.type || x.pair.type === f.type) && (!f.q || pairName(x.pair).toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => TYPES.indexOf(a.pair.type) - TYPES.indexOf(b.pair.type) || pairWeight(b) - pairWeight(a));
  return `
  ${edit ? `<div class="box add-pair"><b>＋ Thêm pair đã sở hữu</b>
    <div class="pair-search"><input id="own-search" placeholder="Gõ tên trainer hoặc pokémon…" autocomplete="off"><div class="results" id="own-results"></div></div></div>` : ''}
  <div class="filter-line">
    <input class="mini-search" data-pf="q" placeholder="Lọc trong ${mine.length} pair…" value="${esc(f.q)}">
    <button class="chip ${!f.type ? 'on' : ''}" data-ptype="">Tất cả</button>
    ${types.map(t => `<button class="chip ${f.type === t ? 'on' : ''}" data-ptype="${t}">${typeBadge(t)} ${mine.filter(x => x.pair.type === t).length}</button>`).join('')}
  </div>
  <div class="owned-grid">${shown.map(x => {
    const p = x.pair, max = p.maxBonus === 10 ? 10 : 5;
    return `<div class="owned ${x.level >= 10 ? 'sa' : ''}" style="--tc:${TYPE_COLORS[p.type] || '#888'}">
      ${img(asset(p.pokeSprite), 'sprite')}
      <div class="o-body"><b>${esc(p.trainer)}</b><small>${esc(p.pokemon)}</small>
        <div class="o-tags">${typeBadge(p.type)}<span class="tag sm" style="background:${ROLE_COLORS[roleBase(p.role)] || '#666'};color:#fff">${esc(roleBase(p.role))}</span></div></div>
      <div class="o-ctl">
        <select data-own="${p.id}" data-k="level" ${edit ? '' : 'disabled'} title="Move level${max === 10 ? ' · 6/5–10/5 = Superawaken' : ''}">
          ${Array.from({ length: max }, (_, i) => i + 1).map(l => `<option value="${l}" ${l === x.level ? 'selected' : ''}>${levelLabel(l)}</option>`).join('')}</select>
        <button class="tog ${x.ex ? 'on' : ''}" data-own="${p.id}" data-k="ex" ${edit ? '' : 'disabled'}>EX</button>
        ${p.exRole ? `<button class="tog ${x.ex_role ? 'on' : ''}" data-own="${p.id}" data-k="ex_role" ${edit ? '' : 'disabled'} title="EX Role: ${esc(p.exRole)}">EXR</button>` : ''}
        ${edit ? `<button class="x" data-own-del="${p.id}" aria-label="Bỏ">✕</button>` : ''}
      </div></div>`;
  }).join('') || '<p class="muted pad">Chưa có pair nào.</p>'}</div>`;
}

function towerTab(id, edit) {
  const total = TYPES.reduce((a, t) => a + towerFloor(id, t), 0);
  return `<p class="section-sub">Mỗi type có một tháp 40 tầng; đội chỉ dùng pair cùng type. Tầng càng cao = càng có kinh nghiệm với type đó.
    Tổng <b>${total}</b>/${TYPES.length * TOWER_TOP} tầng.</p>
  <div class="tower-grid">${TYPES.map(t => {
    const f = towerFloor(id, t);
    return `<div class="tw ${f >= TOWER_TOP ? 'top' : ''}" style="--tc:${TYPE_COLORS[t]}">
      ${typeBadge(t, false)}<b>${f}<small>/${TOWER_TOP}</small></b>
      <div class="meter"><i style="width:${f / TOWER_TOP * 100}%"></i></div>
      ${edit ? `<input type="range" min="0" max="${TOWER_TOP}" value="${f}" data-tower="${t}" aria-label="Tầng tháp ${t}">` : ''}
    </div>`;
  }).join('')}</div>`;
}

function runsTab(id) {
  const list = S.runs.filter(r => r.user_id === id);
  const st = state();
  return list.length ? `<div class="box">${list.map(runLine).join('')}</div>
    <p class="muted">Tổng ${fmtN(list.reduce((a, r) => a + r.score, 0))} điểm · ${list.reduce((a, r) => a + r.tickets, 0)}/${st?.granted ?? 0} vé.</p>`
    : '<p class="muted pad">Chưa có lượt nào trong mùa đang chọn.</p>';
}

const memberId = () => location.hash.split('/')[2] || S.me;
const redrawTab = () => { $('#member-tab').innerHTML = memberTab === 'pairs' ? pairsTab(memberId(), canEdit(memberId())) : memberTab === 'tower' ? towerTab(memberId(), canEdit(memberId())) : runsTab(memberId()); };

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-mtab],[data-ptype],[data-edit-info],[data-own-add],[data-own-del],.tog[data-own]');
  if (!t) return;
  const uid = memberId();
  if (t.dataset.mtab) { memberTab = t.dataset.mtab; route(); }
  if ('ptype' in t.dataset) { pairFilter.type = t.dataset.ptype; redrawTab(); }
  if ('editInfo' in t.dataset) { editingInfo = !editingInfo; route(); }
  if (t.dataset.ownAdd) {
    if (await act(() => api.upsertMemberPair({ user_id: uid, pair_id: t.dataset.ownAdd, level: 1 }), `Đã thêm ${pairName(pairById(t.dataset.ownAdd))}.`)) {
      S.mp = await api.memberPairs(); route(); $('#own-search')?.focus();
    }
  }
  if (t.dataset.ownDel) {
    if (!confirm(`Bỏ ${pairName(pairById(t.dataset.ownDel))} khỏi danh sách sở hữu?`)) return;
    if (await act(() => api.deleteMemberPair(uid, t.dataset.ownDel))) { S.mp = await api.memberPairs(); redrawTab(); }
  }
  if (t.classList.contains('tog')) {
    const cur = owned(uid).find(x => x.pair_id === t.dataset.own);
    if (await act(() => api.upsertMemberPair({ user_id: uid, pair_id: t.dataset.own, [t.dataset.k]: !cur[t.dataset.k] }))) { S.mp = await api.memberPairs(); redrawTab(); }
  }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.own && el.dataset.k === 'level') {
    if (await act(() => api.upsertMemberPair({ user_id: memberId(), pair_id: el.dataset.own, level: +el.value }))) { S.mp = await api.memberPairs(); redrawTab(); }
  }
  if (el.dataset.tower) {
    if (await act(() => api.upsertTower({ user_id: memberId(), type: el.dataset.tower, floor: +el.value }), `Tháp ${el.dataset.tower}: tầng ${el.value}`)) {
      S.tower = await api.tower(); redrawTab();
    }
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.tower) {   // live number while dragging; saved on change
    const tile = el.closest('.tw');
    tile.querySelector('b').innerHTML = `${el.value}<small>/${TOWER_TOP}</small>`;
    tile.querySelector('.meter i').style.width = `${el.value / TOWER_TOP * 100}%`;
  }
  if (el.dataset.pf === 'q') { pairFilter.q = el.value; const pos = el.selectionStart; redrawTab(); const n = $('[data-pf="q"]'); n.focus(); n.setSelectionRange(pos, pos); }
  if (el.id === 'own-search') {
    const have = new Set(owned(memberId()).map(x => x.pair_id));
    const q = el.value.trim().toLowerCase();
    const res = q.length < 2 ? [] : PAIRS.filter(p => !have.has(p.id) && `${p.trainer} ${p.pokemon}`.toLowerCase().includes(q)).slice(0, 12);
    $('#own-results').innerHTML = res.map(p => `<button type="button" data-own-add="${p.id}">${img(asset(p.pokeSprite), 'sprite')}<span>${esc(pairName(p))}</span>${typeBadge(p.type)}<small>${p.maxBonus === 10 ? 'tới 10/5' : 'tới 5/5'}</small></button>`).join('')
      || (q.length >= 2 ? '<p class="muted">Không thấy (hoặc đã có).</p>' : '');
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'info-form') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (await act(() => api.updateProfile(memberId(), f), 'Đã lưu thông tin.')) { S.profiles = await api.profiles(); editingInfo = false; route(); }
});

// ═══════════════════════════════════════════════════════════════
//  ACCOUNT
// ═══════════════════════════════════════════════════════════════
function renderAccount() {
  return `<div class="grid-2">
    <form class="box card form" id="pw-form"><h2 class="section-title">Đổi mật khẩu</h2>
      <label>Mật khẩu mới<input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>Nhập lại<input name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="chip on">Đổi mật khẩu</button><p class="form-err" id="pw-err"></p></form>
    <div class="box card"><h2 class="section-title">Phiên đăng nhập</h2>
      <p>Đang đăng nhập: <b>${esc(nameOf(meP()))}</b> (@${esc(meP().username)}) ${roleTag(meP().role)}</p>
      <div class="row"><a class="chip" href="#/member/${S.me}">Hồ sơ, pair & tháp của tôi</a><button class="chip" data-signout>Đăng xuất</button></div></div>
  </div>`;
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'pw-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('pw') !== f.get('pw2')) { $('#pw-err').textContent = 'Hai mật khẩu không khớp.'; return; }
  if (await act(() => api.changePassword(f.get('pw')), 'Đã đổi mật khẩu.')) e.target.reset();
});
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-signout]')) return;
  await api.signOut();
  S.me = null;
  location.hash = '#/login';
  renderLogin();
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN: seasons, accounts, pair catalog, activity
// ═══════════════════════════════════════════════════════════════
let adminTab = 'seasons', newAccount = null;
const genPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

function renderAdmin() {
  if (!isStaff()) return '<div class="empty">Chỉ admin và mod vào được trang này.</div>';
  return `<div class="filter-line tabs">
    <button class="chip ${adminTab === 'seasons' ? 'on' : ''}" data-atab="seasons">Mùa Gym Battle</button>
    ${isAdmin() ? `<button class="chip ${adminTab === 'accounts' ? 'on' : ''}" data-atab="accounts">Tài khoản</button>` : ''}
    <button class="chip ${adminTab === 'catalog' ? 'on' : ''}" data-atab="catalog">Danh mục pair</button>
    <button class="chip ${adminTab === 'activity' ? 'on' : ''}" data-atab="activity">Nhật ký hoạt động</button>
  </div><div id="admin-body"><div class="loading">Đang tải…</div></div>`;
}
after.admin = async () => {
  if (!isStaff()) return;
  const body = $('#admin-body');
  if (adminTab === 'seasons') { body.innerHTML = adminSeasons(); after.adminSeasonsPrefill(); }
  if (adminTab === 'accounts' && isAdmin()) body.innerHTML = adminAccounts();
  if (adminTab === 'catalog') body.innerHTML = `<div class="box card"><h2 class="section-title">Danh mục pair</h2>
    <p>Database có <b>${await api.catalogCount()}</b> pair · bản Dex đang tải có <b>${PAIRS.length}</b> pair.</p>
    <p class="muted">Đồng bộ sau mỗi lần build Dex có pair mới, để thành viên thêm được pair đó vào danh sách sở hữu.</p>
    <button class="chip on" data-sync-catalog>Đồng bộ ${PAIRS.length} pair từ Dex</button></div>`;
  if (adminTab === 'activity') {
    const list = await api.activity();
    body.innerHTML = `<div class="box table-wrap"><table class="tbl"><thead><tr><th>Lúc</th><th>Ai</th><th>Việc</th><th>Chi tiết</th></tr></thead>
      <tbody>${list.map(a => `<tr><td class="muted">${fmtDT(a.at)}</td><td>${esc(a.actor_name)}</td><td><span class="tag sm">${esc(a.action)}</span></td>
        <td class="muted small">${esc(activityText(a))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có.</td></tr>'}</tbody></table></div>`;
  }
};
function activityText(a) {
  const d = a.detail || {};
  if (a.action.startsWith('runs.')) return `${d.member_name || ''} · ${d.leader || ''} · round ${d.round ?? ''} · ${fmtN(d.score)} điểm`;
  if (a.action.startsWith('account.')) return `${d.username || d.display_name || d.user_id || ''}${d.role ? ' → ' + d.role : ''}`;
  if (a.action.startsWith('seasons.')) return d.name || '';
  if (a.action.startsWith('profiles.')) return d.display_name || d.username || '';
  return JSON.stringify(d).slice(0, 120);
}

function adminSeasons() {
  const s = season();
  return `<div class="grid-2">
  <form class="box card form" id="season-form"><h2 class="section-title">Tạo mùa mới</h2>
    <label>Lấy Gym Leader & circuit từ datamine
      <select name="gym"><option value="">— tự nhập —</option>${GYMS.map((g, i) => `<option value="${i}" ${i === GYMS.length - 1 ? 'selected' : ''}>${esc(g.name)} · ${esc((g.stages[0]?.leaders || []).map(l => l.name).join(', '))}</option>`).join('')}</select></label>
    <label>Tên mùa<input name="name" required placeholder="vd SS4 Sinnoh" value="${esc(GYMS.at(-1)?.name || '')}"></label>
    <div class="row3"><label>Battle bắt đầu (giờ máy bạn)<input name="battle_start" type="datetime-local" required></label>
      <label>Battle kết thúc<input name="battle_end" type="datetime-local" required></label>
      <label>Mục tiêu điểm (vd Top 100)<input name="target_score" type="number" min="0"></label></div>
    <div class="row3"><label>Vé ngày đầu<input name="tickets_day1" type="number" value="9" min="0"></label>
      <label>Vé +mỗi ngày<input name="tickets_daily" type="number" value="3" min="0"></label>
      <label>Trần vé / người<input name="ticket_cap" type="number" value="30" min="1"></label>
      <label>Trần vé cả Gym<input name="gym_ticket_cap" type="number" value="600" min="1"></label></div>
    <label class="check"><input type="checkbox" name="is_active" checked> Đặt làm mùa đang chạy</label>
    <label>Gym Leader (khi tự nhập: mỗi dòng "Tên, Type, Yếu1 Yếu2")<textarea name="leaders" rows="3" placeholder="Roark, Rock, Grass&#10;Gardenia, Grass, Flying"></textarea></label>
    <button class="chip on">Tạo mùa</button><p class="form-err" id="season-err"></p>
  </form>
  <div class="box card"><h2 class="section-title">Các mùa</h2>
    <table class="tbl"><thead><tr><th>Mùa</th><th>Battle</th><th></th></tr></thead><tbody>${S.seasons.map(x => `<tr>
      <td>${x.is_active ? '★ ' : ''}<b>${esc(x.name)}</b><br><small class="muted">${esc(x.gym_key || 'tự nhập')} · ${x.leaders.length} leader</small></td>
      <td class="muted small">${fmtDT(x.battle_start)}<br>${fmtDT(x.battle_end)}</td>
      <td class="acts">${x.is_active ? '' : `<button class="chip sm" data-season-activate="${x.id}">Đặt đang chạy</button>`}
        ${isAdmin() ? `<button class="chip sm" data-season-del="${x.id}">Xoá</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Chưa có mùa.</td></tr>'}</tbody></table>
    ${s ? `<h3>Khoá thành viên trong ${esc(s.name)}</h3><p class="muted small">Người bị khoá không ghi được lượt mới và không tính vào tổng điểm.</p>
      <div class="ban-list">${S.profiles.map(p => {
        const banned = S.sm.some(m => m.user_id === p.id && m.banned);
        return `<button class="chip ${banned ? 'bad' : ''}" data-ban="${p.id}">${banned ? '🔒' : '🔓'} ${esc(nameOf(p))}</button>`;
      }).join('')}</div>` : ''}
  </div></div>`;
}
after.adminSeasonsPrefill = () => {
  const f = $('#season-form');
  if (!f) return;
  const g = GYMS[+f.gym.value];
  if (!g) return;
  const pre = seasonFromGym(g);
  const local = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  f.name.value = g.name;
  f.battle_start.value = local(pre.battle_start);
  f.battle_end.value = local(pre.battle_end);
};

function adminAccounts() {
  return `<div class="grid-2">
  <form class="box card form" id="account-form"><h2 class="section-title">Cấp tài khoản mới</h2>
    <p class="muted small">Người mới đăng nhập bằng username + mật khẩu tạm này, rồi tự nhập pair/tháp và đổi mật khẩu.</p>
    <div class="row3"><label>Username<input name="username" required pattern="[a-z0-9_.\\-]{3,32}" placeholder="chữ thường, số, _ . -"></label>
      <label>Nickname trong game<input name="display_name"></label>
      <label>Vai trò<select name="role"><option value="member">Member</option><option value="mod">Mod</option><option value="admin">Admin</option></select></label></div>
    <label>Mật khẩu tạm<div class="row"><input name="password" required minlength="8" value="${genPassword()}"><button type="button" class="chip sm" data-genpw>Tạo lại</button></div></label>
    <button class="chip on">Tạo tài khoản</button>
    ${newAccount ? `<div class="handoff">✅ Gửi cho <b>${esc(newAccount.display_name || newAccount.username)}</b>:<br>
      <code>Link: ${esc(location.href.split('#')[0])}\nUsername: ${esc(newAccount.username)}\nMật khẩu: ${esc(newAccount.password)}</code></div>` : ''}
    <p class="form-err" id="account-err"></p>
  </form>
  <div class="box card"><h2 class="section-title">Tài khoản (${S.profiles.length})</h2>
    <table class="tbl"><thead><tr><th>Thành viên</th><th>Vai trò</th><th></th></tr></thead><tbody>${S.profiles.map(p => `<tr>
      <td><b>${esc(nameOf(p))}</b><br><small class="muted">@${esc(p.username)}</small></td>
      <td>${p.id === S.me ? roleTag(p.role) : `<select data-role="${p.id}">${['member', 'mod', 'admin'].map(r => `<option value="${r}" ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`}</td>
      <td class="acts">${p.id === S.me ? '' : `<button class="chip sm" data-resetpw="${p.id}">Đặt lại mật khẩu</button><button class="chip sm bad" data-deluser="${p.id}">Xoá</button>`}</td></tr>`).join('')}</tbody></table>
    <p class="muted small">Xoá tài khoản khi thành viên rời gym: pair và tháp của họ bị xoá, còn log lượt đánh vẫn giữ tên họ.</p>
  </div></div>`;
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-atab],[data-sync-catalog],[data-season-activate],[data-season-del],[data-ban],[data-genpw],[data-resetpw],[data-deluser]');
  if (!t) return;
  if (t.dataset.atab) { adminTab = t.dataset.atab; route(); }
  if ('syncCatalog' in t.dataset) { t.disabled = true; if (await act(() => api.syncCatalog(catalogRows()), 'Đã đồng bộ danh mục pair.')) after.admin(); }
  if (t.dataset.seasonActivate) { if (await act(() => api.setActiveSeason(+t.dataset.seasonActivate), 'Đã đổi mùa đang chạy.')) { S.seasons = await api.seasons(); route(); } }
  if (t.dataset.seasonDel) {
    const s = S.seasons.find(x => x.id === +t.dataset.seasonDel);
    if (prompt(`Xoá mùa "${s.name}" và TOÀN BỘ log của nó? Gõ tên mùa để xác nhận:`) !== s.name) return;
    if (await act(() => api.deleteSeason(s.id), 'Đã xoá mùa.')) { await loadAll(); route(); }
  }
  if (t.dataset.ban) {
    const banned = S.sm.some(m => m.user_id === t.dataset.ban && m.banned);
    if (await act(() => api.setBanned(S.sid, t.dataset.ban, !banned))) { S.sm = await api.seasonMembers(S.sid); after.admin(); }
  }
  if ('genpw' in t.dataset) t.closest('form').password.value = genPassword();
  if (t.dataset.resetpw) {
    const p = profile(t.dataset.resetpw), pw = genPassword();
    if (!confirm(`Đặt lại mật khẩu cho ${nameOf(p)}? Mật khẩu mới sẽ là: ${pw}`)) return;
    if (await act(() => api.adminUsers({ action: 'reset_password', user_id: p.id, password: pw }))) prompt('Mật khẩu mới — gửi cho thành viên:', pw);
  }
  if (t.dataset.deluser) {
    const p = profile(t.dataset.deluser);
    if (prompt(`Xoá tài khoản ${nameOf(p)}? Pair & tháp của họ sẽ mất, log lượt đánh vẫn giữ tên.\nGõ username "${p.username}" để xác nhận:`) !== p.username) return;
    if (await act(() => api.adminUsers({ action: 'delete', user_id: p.id }), `Đã xoá ${nameOf(p)}.`)) { await loadAll(); route(); }
  }
});
document.addEventListener('change', async e => {
  if (e.target.name === 'gym' && e.target.form?.id === 'season-form') after.adminSeasonsPrefill();
  if (e.target.dataset.role) {
    if (await act(() => api.adminUsers({ action: 'set_role', user_id: e.target.dataset.role, role: e.target.value }), 'Đã đổi vai trò.')) { S.profiles = await api.profiles(); route(); }
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'account-form') {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.username = f.username.trim().toLowerCase();
    if (await act(() => api.adminUsers({ action: 'create', ...f }), `Đã tạo tài khoản ${f.username}.`)) {
      newAccount = f;
      S.profiles = await api.profiles();
      route();
    }
  }
  if (e.target.id === 'season-form') {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const g = GYMS[+f.gym];
    let leaders, circuits, gym_key = null;
    if (f.gym !== '' && g) ({ leaders, circuits, gym_key } = seasonFromGym(g));
    else {
      leaders = f.leaders.split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x[0])
        .map(([name, type, weak = '']) => ({ name, type, weakness: weak.split(/\s+/).filter(Boolean) }));
      circuits = (GYMS.at(-1) ? seasonFromGym(GYMS.at(-1)).circuits : [{ name: 'Circuit 1', pts: 10000, kind: 'Regular Battle' }]);
      if (!leaders.length) { $('#season-err').textContent = 'Nhập ít nhất một Gym Leader (hoặc chọn gym từ datamine).'; return; }
    }
    const row = { name: f.name, gym_key, leaders, circuits,
      battle_start: new Date(f.battle_start).toISOString(), battle_end: new Date(f.battle_end).toISOString(),
      tickets_day1: +f.tickets_day1, tickets_daily: +f.tickets_daily, ticket_cap: +f.ticket_cap, gym_ticket_cap: +f.gym_ticket_cap,
      target_score: f.target_score ? +f.target_score : null, created_by: S.me };
    const created = await act(() => api.createSeason(row), `Đã tạo mùa ${f.name}.`);
    if (!created) return;
    if (f.is_active) await act(() => api.setActiveSeason(created.id));
    await loadAll();
    S.sid = created.id;
    await loadSeason();
    route();
  }
});

// ─── Theme picker (shared with the Dex) ─────────────────────
const THEMES = [
  { id: 'night', a: '#0f1226', b: '#ffcb05' }, { id: 'pokedex', a: '#f6efe0', b: '#e3350d' }, { id: 'gameboy', a: '#9bbc0f', b: '#0f380f' },
  { id: 'masterball', a: '#26163a', b: '#ff4fa3' }, { id: 'sakura', a: '#fff0f5', b: '#b784e8' },
];
function renderThemes() {
  const cur = document.documentElement.dataset.theme;
  $('#theme-picker').innerHTML = THEMES.map(t => `<button class="theme-swatch" aria-checked="${t.id === cur}" aria-label="${t.id}" data-theme-id="${t.id}"
    style="background:linear-gradient(135deg, ${t.a} 50%, ${t.b} 50%)"></button>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-theme-id]');
  if (!b) return;
  document.documentElement.dataset.theme = b.dataset.themeId;
  try { localStorage.setItem('pmex-theme', b.dataset.themeId); } catch { /* private mode */ }
  renderThemes();
});

// ─── Boot ───────────────────────────────────────────────────
(async () => {
  renderThemes();
  $('#mode-tag').textContent = isDemo ? 'DEMO' : '';
  try {
    api = await createApi();
    S.me = await api.session();
    if (S.me) { await loadAll(); $('#nav').classList.remove('hidden'); }
  } catch (e) {
    view.innerHTML = `<div class="empty box">Không kết nối được database: ${esc(e.message)}</div>`;
    return;
  }
  route();
})();
