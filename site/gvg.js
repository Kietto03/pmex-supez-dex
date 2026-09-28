/* ═══════════════════════════════════════════════════════════════
   GvG — Gym vs Gym tracker for a guild during a Pasio Gym Battle.
   Rebuilt from the gvg-app spec (github.com/Sh1n-Gh/gvg-app, PRD-FINAL +
   PAIR-TEAM-LOG-SPEC) for a static site:

   · The season config comes from the datamine gym (D.gyms): 8 leaders = maps,
     circuits = rounds with a point cap, "… and onward" = repeating last cap,
     rules rotating per round, Battle phase start = ticket clock.
   · Only raw facts are stored (members, entries, team snapshots). Progress,
     round chain, tickets and scores are derived on every render, so they can
     never drift from the log.
   · Local-first: localStorage, JSON export/import (merge by id), and a
     compressed read-only share link (#/gvg/v~<data>).
   Uses app.js helpers ($, esc, img, tip, typeBadge, ruleClass, stageShort, D, PAIRS…).
   ═══════════════════════════════════════════════════════════════ */

const GVG_KEY = 'pmex-gvg';
const DAY_MS = 864e5;
const GVG_TABS = [['', 'Dashboard'], ['log', 'Ghi log'], ['history', 'Lịch sử'], ['members', 'Thành viên'], ['data', 'Mùa & dữ liệu']];
const TICKET_DEFAULT = { day1: 12, daily: 3, days: 6 };
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ─── Store ──────────────────────────────────────────────────
function gvgLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(GVG_KEY));
    if (s?.v === 1) return s;
  } catch (e) { /* private mode / bad JSON → start fresh */ }
  return { v: 1, seasons: [], active: null };
}
let gvg = gvgLoad();
let gvgShared = null; // read-only snapshot opened from a share link
const gvgStore = () => gvgShared || gvg;
const gvgSeason = () => { const st = gvgStore(); return st.seasons.find(s => s.id === st.active) || st.seasons.at(-1) || null; };
function gvgSave() {
  if (gvgShared) return;
  const s = gvgSeason();
  if (s) s.u = Date.now();
  try { localStorage.setItem(GVG_KEY, JSON.stringify(gvg)); } catch (e) { gvgToast('Không lưu được vào trình duyệt (bộ nhớ đầy / chế độ riêng tư). Hãy Export JSON.', true); }
}

// ─── Season context: everything derived from config + log ────
const utc = iso => iso ? Date.parse(iso + 'Z') : NaN; // datamine times are UTC (06:00 = daily reset)

function gvgCtx(s, now = Date.now()) {
  const g = D.gyms.find(x => x.name === s.gym);
  if (!g) return null;
  const leaders = g.stages[0]?.leaders || [];
  const maps = leaders.map(l => l.name);
  const C = g.circuits;
  const onward = C.length && /and onward/i.test(C.at(-1).name);
  const onwardFrom = onward ? +(C.at(-1).name.match(/(\d+)/)?.[1] || 0) : 0;

  const round = n => {
    if (n < 1) return null;
    if (n <= C.length) return { n, max: C[n - 1].pts, ball: C[n - 1].ball, label: onward && n === C.length ? `Extra Battle ${onwardFrom}` : C[n - 1].name };
    if (!onward) return null;
    return { n, max: C.at(-1).pts, ball: C.at(-1).ball, label: `Extra Battle ${onwardFrom + n - C.length}`, repeat: true };
  };
  // The leader as fought in round n: the "… and onward" stage rotates Rules 1/2/3
  const leaderAt = (n, name) => {
    const st = g.stages[Math.min(n, g.stages.length) - 1] || g.stages[0];
    const l = st.leaders.find(x => x.name === name) || leaders.find(x => x.name === name);
    const rule = l.rules?.length ? l.rules[(Math.max(n, g.stages.length) - g.stages.length) % l.rules.length] : l.theme || 'No rules';
    return { ...l, ruleText: rule, weak: l.units?.[0]?.weakness || '' };
  };

  const banned = new Set(s.members.filter(m => m.banned).map(m => m.id));
  const pts = {}; // pts[round][map]
  const perMember = {};
  for (const m of s.members) perMember[m.id] = { points: 0, tickets: 0, runs: 0 };
  for (const e of s.entries) {
    ((pts[e.r] ||= {})[e.map] = (pts[e.r][e.map] || 0) + e.p);
    const pm = perMember[e.m];
    if (pm) { pm.points += e.p; pm.tickets += e.t; pm.runs++; }
  }
  // Round chain: the first round whose 8 maps aren't all at the cap is active
  const status = {};
  let active = null;
  for (let n = 1; ; n++) {
    const c = round(n);
    if (!c) break;
    if (maps.every(m => (pts[n]?.[m] || 0) >= c.max)) { status[n] = 'completed'; continue; }
    status[n] = 'active'; active = n; break;
  }
  const battle = g.phases.find(p => p.name === 'Battle');
  const start = utc(battle?.start), end = utc(battle?.end);
  const t = { ...TICKET_DEFAULT, ...s.tickets };
  const granted = now < start ? 0 : t.day1 + t.daily * Math.min(Math.floor((now - start) / DAY_MS), t.days);
  const combined = s.entries.reduce((a, e) => a + (banned.has(e.m) ? 0 : e.p), 0);
  return { g, maps, round, leaderAt, pts, status, active, finished: active == null && Object.keys(status).length > 0,
    perMember, banned, granted, start, end, combined, ticketCost: g.tickets || [] };
}
const gvgTicketsLeft = (ctx, memberId) => ctx.granted - (ctx.perMember[memberId]?.tickets || 0);

// Validation shared by new and edited entries (edits may target any round; new ones only the active round)
function gvgValidate(s, ctx, d, editing = null) {
  if (!Number.isInteger(d.t) || d.t < 1 || d.t > 3) return 'Số vé phải là 1, 2 hoặc 3.';
  if (!Number.isInteger(d.p) || d.p <= 0) return 'Điểm phải là số nguyên dương.';
  const m = s.members.find(x => x.id === d.m);
  if (!m) return 'Chọn thành viên.';
  if (!ctx.maps.includes(d.map)) return 'Chọn map (Gym Leader).';
  if (!editing) {
    if (m.banned) return `${m.name} đang bị khoá, không ghi log mới được.`;
    if (ctx.active == null) return ctx.finished ? 'Đã hoàn thành toàn bộ nội dung của mùa này.' : 'Chưa có round nào đang mở.';
    if (d.r !== ctx.active) return `Log mới chỉ ghi cho round đang mở (${ctx.round(ctx.active).label}).`;
    if (!d.team.length) return 'Chọn ít nhất 1 sync pair cho team.';
  }
  const left = gvgTicketsLeft(ctx, d.m) + (editing?.m === d.m ? editing.t : 0);
  if (d.t > left) return `Không đủ vé: ${m.name} còn ${Math.max(left, 0)} vé.`;
  const cap = ctx.round(d.r)?.max;
  if (!cap) return 'Round không còn cấu hình hợp lệ.';
  const have = (ctx.pts[d.r]?.[d.map] || 0) - (editing && editing.r === d.r && editing.map === d.map ? editing.p : 0);
  if (have + d.p > cap) return `Vượt trần round: ${d.map} chỉ còn thiếu ${fmtN(cap - have)} điểm.`;
  const ids = d.team.map(x => x.id);
  if (new Set(ids).size !== ids.length) return 'Team có pair bị trùng.';
  for (const x of d.team) {
    const p = pairById(x.id);
    if (x.ml < 1 || x.ml > (p?.dates?.Superawakened ? 10 : 5)) return `Move Level của ${x.name} không hợp lệ.`;
    if (x.lv != null && (x.lv < 1 || x.lv > 200)) return `Level của ${x.name} phải từ 1 đến 200.`;
    if (x.ex === 'exr' && !p?.exRole) return `${x.name} không có EX Role.`;
  }
  return null;
}

// ─── Render ─────────────────────────────────────────────────
let gvgTab = '';
function renderGvg(arg = '') {
  if (arg.startsWith('v~')) {
    if (!gvgShared || gvgShared.code !== arg) {
      gvgUnpack(arg.slice(2))
        .then(st => { gvgShared = { ...st, code: arg }; if (location.hash.includes(arg)) route(); })
        .catch(() => { view.innerHTML = `<div class="empty">${img(PLACEHOLDER)}Link chia sẻ bị hỏng hoặc không đầy đủ. <a href="#/gvg">← GvG</a></div>`; });
      return `<div class="loading">${img(PLACEHOLDER, 'spin')} Đang mở bản chia sẻ…</div>`;
    }
    if (!['', 'history'].includes(gvgTab)) gvgTab = ''; // a share view only has Dashboard + History
  } else {
    gvgShared = null;
    gvgTab = GVG_TABS.some(([t]) => t === arg) ? arg : '';
  }
  if (!D.gyms.length) return `<div class="empty">${img(PLACEHOLDER)}Chưa có dữ liệu Gym Battle trong datamine.</div>`;
  const s = gvgSeason();
  if (!s) return gvgOnboarding();
  const ctx = gvgCtx(s);
  if (!ctx) return `<div class="empty">${img(PLACEHOLDER)}Mùa này dùng “${esc(s.gym)}” nhưng datamine hiện không còn gym đó. Mở tab <a href="#/gvg/data">Mùa & dữ liệu</a> để đổi.</div>`;
  const ro = !!gvgShared;
  const tabs = GVG_TABS.filter(([t]) => !ro || ['', 'history'].includes(t));
  const base = ro ? `#/gvg/${gvgShared.code}` : '#/gvg';
  return `
  <h1 class="section-title" style="font-size:16px">Gym vs Gym <span class="count">${esc(s.guild || 'Guild')} · ${esc(s.gym)}</span></h1>
  ${ro ? `<div class="gvg-ro box">👁 Đang xem bản chia sẻ (chỉ xem) — cập nhật lúc ${fmtDate(new Date(s.u || Date.now()).toISOString().slice(0, 16))}
      <button class="chip" data-g="adopt">⬇ Lưu vào máy của tôi</button><a class="chip" href="#/gvg">Thoát</a></div>` : ''}
  <nav class="gvg-tabs">${tabs.map(([t, l]) => ro
    ? `<button class="chip ${gvgTab === t ? 'on' : ''}" data-g="tab" data-v="${t}">${l}</button>`
    : `<a class="chip ${gvgTab === t ? 'on' : ''}" href="${base}${t ? '/' + t : ''}">${l}</a>`).join('')}</nav>
  <div id="gvg-body">${gvgBody(s, ctx)}</div>`;
}
routes.gvg = renderGvg;

function gvgBody(s, ctx) {
  return { '': gvgDashboard, log: gvgLogForm, history: gvgHistory, members: gvgMembers, data: gvgData }[gvgTab](s, ctx);
}
const gvgRedraw = () => { const s = gvgSeason(); const b = $('#gvg-body'); if (s && b) { b.innerHTML = gvgBody(s, gvgCtx(s)); markClamped?.(); } };

function gvgOnboarding() {
  const g = D.gyms.at(-1);
  return `
  <h1 class="section-title" style="font-size:16px">Gym vs Gym <span class="count">theo dõi guild trong Pasio Gym Battle</span></h1>
  <div class="box card gvg-onboard">
    <p class="prose">Ghi điểm từng lượt đánh của thành viên, tự tính round, vé còn lại, Combined Score và bảng xếp hạng. Cấu hình mùa (8 Gym Leader, trần điểm từng circuit, luật, giờ bắt đầu) lấy thẳng từ datamine. Dữ liệu lưu <b>trong trình duyệt này</b>; dùng Export/Import hoặc link chia sẻ để gửi cho guild.</p>
    ${gvgSeasonForm({ gym: g.name, members: [] })}
  </div>`;
}

function gvgSeasonForm(prev) {
  const t = { ...TICKET_DEFAULT, ...prev.tickets };
  return `
    <form class="gvg-form" data-g-form="season">
      <label>Tên guild<input name="guild" value="${esc(prev.guild || '')}" placeholder="VD: Pasio Stars" maxlength="40"></label>
      <label>Gym Battle<select name="gym">${D.gyms.slice().reverse().map(g => `<option ${g.name === prev.gym ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <div class="gvg-row3">
        <label ${tip('Vé ngày đầu', 'Số vé mỗi thành viên nhận khi Battle bắt đầu')}>Vé ngày 1<input name="day1" type="number" min="0" value="${t.day1}"></label>
        <label>Vé mỗi ngày sau<input name="daily" type="number" min="0" value="${t.daily}"></label>
        <label>Số ngày nhận thêm<input name="days" type="number" min="0" value="${t.days}"></label>
      </div>
      <label>Thành viên <small class="muted">(mỗi dòng một tên${prev.members.length ? '; đã bỏ người bị khoá của mùa trước' : ''})</small>
        <textarea name="roster" rows="6" placeholder="Yudar&#10;Mina&#10;…">${esc(prev.members.filter(m => !m.banned).map(m => m.name).join('\n'))}</textarea></label>
      <button class="chip on" type="submit">＋ Tạo mùa</button>
    </form>`;
}

// ─── Dashboard ──────────────────────────────────────────────
function gvgDashboard(s, ctx) {
  const now = Date.now();
  const cur = ctx.active ? ctx.round(ctx.active) : null;
  const live = s.members.filter(m => !m.banned);
  const ticketsLeft = live.reduce((a, m) => a + Math.max(gvgTicketsLeft(ctx, m.id), 0), 0);
  const phase = now < ctx.start ? `Battle bắt đầu ${fmtDate(new Date(ctx.start).toISOString().slice(0, 16))}`
    : now < ctx.end ? `Ngày ${Math.floor((now - ctx.start) / DAY_MS) + 1} · còn ${gvgDur(ctx.end - now)}` : 'Battle đã kết thúc';
  const done = Object.values(ctx.status).filter(x => x === 'completed').length;
  return `
  <section class="gvg-banner box">
    <div><small>Round hiện tại</small><b>${cur ? esc(cur.label) : ctx.finished ? 'Hoàn thành!' : '—'}</b>
      <span>${cur ? `trần ${fmtN(cur.max)} điểm / map${cur.repeat ? ' · lặp lại' : ''}` : ctx.finished ? 'Đã xong toàn bộ nội dung hiện có' : ''}</span></div>
    <div class="gvg-big"><small>Combined Score</small><b>${fmtN(ctx.combined)}</b><span>${done} round đã xong${ctx.banned.size ? ` · không tính ${ctx.banned.size} người bị khoá` : ''}</span></div>
    <div><small>Vé chưa dùng</small><b>${fmtN(ticketsLeft)}</b><span>${live.length} người · ${ctx.granted} vé/người đến hiện tại</span></div>
    <div><small>Battle</small><b class="gvg-phase">${phase}</b><span>${esc(s.gym)}</span></div>
  </section>

  ${cur ? `<div class="section">
    <h2 class="section-title">8 Gym Leader <span class="count">${esc(cur.label)}</span></h2>
    <div class="gvg-maps">${ctx.maps.map(name => gvgMapCard(ctx, cur, name)).join('')}</div>
  </div>` : ''}

  <div class="section">
    <h2 class="section-title">Bảng xếp hạng <span class="count">${s.entries.length} lượt</span></h2>
    ${gvgBoard(s, ctx)}
  </div>`;
}
const gvgDur = ms => { const h = Math.floor(ms / 36e5); return h >= 24 ? `${Math.floor(h / 24)} ngày ${h % 24} giờ` : `${h} giờ ${Math.floor(ms / 6e4) % 60} phút`; };

function gvgMapCard(ctx, cur, name) {
  const l = ctx.leaderAt(cur.n, name);
  const have = ctx.pts[cur.n]?.[name] || 0;
  const pct = Math.min(100, have / cur.max * 100);
  const rc = ruleClass(l.ruleText);
  return `
  <div class="gvg-map ${have >= cur.max ? 'full' : ''}" style="--tc:${TYPE_COLORS[l.type] || '#777'}">
    <div class="gvg-map-top">${img(ctx.g.leaderSprites?.[name], 'sprite', name)}<div><b>${esc(name)}</b>${typeBadge(l.type, true)}${l.weak ? ` <small>yếu ${esc(l.weak)}</small>` : ''}</div></div>
    <div class="gvg-rule mcell ${rc.cls}" ${tip('Luật ' + cur.label, l.ruleText)}>${esc(rc.short)}${rc.se ? ' ⊘SE' : ''} <span>${esc(l.ruleText)}</span></div>
    <div class="gvg-bar"><i style="width:${pct}%"></i></div>
    <div class="gvg-map-foot"><span>${fmtN(have)} / ${fmtShort(cur.max)}</span><span>${have >= cur.max ? '✔ Đủ điểm' : `còn ${fmtN(cur.max - have)}`}</span></div>
  </div>`;
}

function gvgBoard(s, ctx) {
  if (!s.members.length) return '<p class="muted">Chưa có thành viên.</p>';
  const rows = s.members.map(m => ({ m, ...ctx.perMember[m.id], left: gvgTicketsLeft(ctx, m.id) }))
    .sort((a, b) => a.m.banned - b.m.banned || b.points - a.points || a.m.name.localeCompare(b.m.name));
  let rank = 0;
  return `<div class="gvg-table-wrap"><table class="gvg-table">
    <thead><tr><th>#</th><th>Thành viên</th><th>Điểm</th><th>Lượt</th><th>Vé dùng</th><th>Vé còn</th><th ${tip('Điểm / vé', 'Hiệu suất trung bình mỗi vé')}>Đ/vé</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.m.banned ? 'banned' : ''}">
      <td>${r.m.banned ? '—' : ++rank}</td><td>${esc(r.m.name)}${r.m.banned ? ' <span class="tag sm gvg-ban">🚫 Đã khoá</span>' : ''}</td>
      <td class="num">${fmtN(r.points)}</td><td class="num">${r.runs}</td><td class="num">${r.tickets}</td>
      <td class="num ${r.left <= 0 ? 'muted' : ''}">${Math.max(r.left, 0)}</td><td class="num">${r.tickets ? fmtN(Math.round(r.points / r.tickets)) : '—'}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// ─── Log form (new + edit) ──────────────────────────────────
let gvgDraft = null; // { id?, m, map, t, p, r, team: [{ id, name, ml, lv, ex }] }
const gvgNewDraft = (s, ctx) => ({ m: gvgDraft?.m || '', map: '', t: 3, p: '', r: ctx.active, team: [] });

function gvgLogForm(s, ctx) {
  if (!gvgDraft || (!gvgDraft.id && gvgDraft.r !== ctx.active)) gvgDraft = gvgNewDraft(s, ctx);
  const d = gvgDraft;
  const editing = d.id ? s.entries.find(e => e.id === d.id) : null;
  const cur = ctx.round(d.r);
  if (!editing && !cur) return `<div class="empty">${img(PLACEHOLDER)}${ctx.finished ? 'Đã hoàn thành toàn bộ nội dung của mùa này.' : 'Chưa có round nào đang mở.'}</div>`;
  if (!s.members.length) return `<div class="empty">${img(PLACEHOLDER)}Thêm thành viên ở tab <a href="#/gvg/members">Thành viên</a> trước.</div>`;
  const left = m => gvgTicketsLeft(ctx, m.id) + (editing?.m === m.id ? editing.t : 0);
  return `
  <form class="gvg-log box card" data-g-form="entry">
    <h2 class="section-title">${editing ? `Sửa lượt · ${esc(cur?.label || 'Round ' + d.r)}` : `Ghi lượt mới · ${esc(cur.label)}`}</h2>
    <label class="gvg-field">Thành viên
      <select name="m" data-g-field="m"><option value="">— chọn —</option>${s.members.map(m => `
        <option value="${m.id}" ${m.id === d.m ? 'selected' : ''} ${m.banned && !editing ? 'disabled' : ''}>${esc(m.name)}${m.banned ? ' (đã khoá)' : ` · còn ${Math.max(left(m), 0)} vé`}</option>`).join('')}</select></label>

    <div class="gvg-field">Map
      <div class="gvg-pick">${ctx.maps.map(name => {
        const have = (ctx.pts[d.r]?.[name] || 0) - (editing && editing.map === name && editing.r === d.r ? editing.p : 0);
        const full = cur && have >= cur.max;
        return `<button type="button" class="chip ${d.map === name ? 'on' : ''}" data-g="map" data-v="${esc(name)}" ${full ? 'disabled' : ''}>
          ${img(ctx.g.leaderSprites?.[name], 'sprite')}${esc(name)}<span class="n">${full ? '✔' : fmtShort(cur.max - have)}</span></button>`;
      }).join('')}</div></div>

    <div class="gvg-field">Số vé
      <div class="gvg-pick">${[1, 2, 3].map(n => { const c = ctx.ticketCost.find(x => x.tickets === n);
        return `<button type="button" class="chip ${d.t === n ? 'on' : ''}" data-g="t" data-v="${n}">🎟️ ×${n}${c ? `<span class="n">${c.time} · Sync +${c.buff}</span>` : ''}</button>`; }).join('')}</div></div>

    <label class="gvg-field">Điểm
      <input name="p" data-g-field="p" type="number" min="1" inputmode="numeric" value="${d.p}" placeholder="${d.map && cur ? 'tối đa ' + fmtN(cur.max - ((ctx.pts[d.r]?.[d.map] || 0) - (editing && editing.map === d.map ? editing.p : 0))) : 'VD: 98000'}"></label>

    <div class="gvg-field">Team <small class="muted">(1–3 pair${editing ? '' : ', bắt buộc'})</small>
      <div class="gvg-team">${d.team.map((x, i) => gvgSlot(x, i)).join('')}</div>
      ${d.team.length < 3 ? `<div class="gvg-search">
        <input id="gvg-pair-q" type="search" placeholder="＋ Thêm pair: gõ trainer / pokémon…" autocomplete="off">
        <div class="gvg-results" id="gvg-results"></div></div>` : ''}
      ${d.m && !d.team.length ? `<button type="button" class="pf-reset-link" data-g="lastteam">↺ Dùng lại team gần nhất của thành viên này</button>` : ''}
    </div>

    <p class="gvg-err" id="gvg-err" role="alert"></p>
    <div class="gvg-actions">
      <button class="chip on" type="submit">${editing ? '💾 Lưu thay đổi' : '＋ Ghi lượt'}</button>
      ${editing ? '<button class="chip" type="button" data-g="cancel">Huỷ sửa</button>' : ''}
    </div>
  </form>
  ${!editing ? `<div class="section"><h2 class="section-title">Lượt vừa ghi</h2>${gvgEntryList(s, ctx, s.entries.slice(-5).reverse(), true)}</div>` : ''}`;
}

const MOVE_LV = n => `${n}/5`; // 6/5–10/5 = Superawakened 1–5, shown as N/5 per the spec
function gvgSlot(x, i) {
  const p = pairById(x.id);
  const maxMl = p?.dates?.Superawakened ? 10 : 5;
  return `
  <div class="gvg-slot">
    ${img(p?.trainerSprite, 'sprite')}${img(p?.pokeSprite, 'sprite')}
    <b>${esc(x.name)}</b>
    <select data-g-slot="${i}" data-k="ml" ${tip('Move Level', '6/5–10/5 = Superawakened')}>${Array.from({ length: maxMl }, (_, k) => `<option value="${k + 1}" ${x.ml === k + 1 ? 'selected' : ''}>${MOVE_LV(k + 1)}</option>`).join('')}</select>
    <input data-g-slot="${i}" data-k="lv" type="number" min="1" max="200" placeholder="Lv" value="${x.lv ?? ''}">
    <span class="gvg-seg">${['none', 'ex', 'exr'].map(v => `<button type="button" class="${x.ex === v ? 'on' : ''}" data-g="ex" data-i="${i}" data-v="${v}" ${v === 'exr' && !p?.exRole ? 'disabled' : ''}>${v === 'none' ? '—' : v.toUpperCase()}</button>`).join('')}</span>
    <button type="button" class="pf-clear-group" data-g="unslot" data-i="${i}" aria-label="Bỏ pair">✕</button>
  </div>`;
}

// Pair search ranked per spec: trainer prefix, pokémon prefix, contains, then pairs this member used recently
function gvgFindPairs(q, s, memberId) {
  const w = q.toLowerCase().trim();
  if (!w) return [];
  const recent = new Set(s.entries.filter(e => e.m === memberId).slice(-20).flatMap(e => e.team.map(x => x.id)));
  const taken = new Set(gvgDraft.team.map(x => x.id));
  return PAIRS.filter(p => !taken.has(p.id)).map(p => {
    const t = p.trainer.toLowerCase(), k = p.pokemon.toLowerCase(), f = (p.form || '').toLowerCase();
    const score = t.startsWith(w) ? 4 : k.startsWith(w) ? 3 : (t.includes(w) || k.includes(w) || f.includes(w)) ? 2 : 0;
    return score && { p, score: score + (recent.has(p.id) ? 0.5 : 0) };
  }).filter(Boolean).sort((a, b) => b.score - a.score || (b.p.release || '').localeCompare(a.p.release || '')).slice(0, 10).map(x => x.p);
}

function gvgTeamBadges(team) {
  if (!team?.length) return '<span class="muted">Chưa có dữ liệu team</span>';
  return team.map(x => { const p = pairById(x.id);
    return `<span class="gvg-mini" ${tip(x.name, `${MOVE_LV(x.ml)}${x.lv ? ` · Lv ${x.lv}` : ''}${x.ex !== 'none' ? ' · ' + x.ex.toUpperCase() : ''}`)}>${img(p?.pokeSprite, 'sprite')}<small>${MOVE_LV(x.ml)}${x.lv ? ` Lv${x.lv}` : ''}${x.ex !== 'none' ? ` <b>${x.ex.toUpperCase()}</b>` : ''}</small></span>`; }).join('');
}

// ─── History ────────────────────────────────────────────────
let gvgHist = { m: '', map: '', r: '' };
function gvgHistory(s, ctx) {
  const f = gvgHist;
  const rounds = [...new Set(s.entries.map(e => e.r))].sort((a, b) => b - a);
  const list = s.entries.filter(e => (!f.m || e.m === f.m) && (!f.map || e.map === f.map) && (!f.r || e.r === +f.r)).slice().reverse();
  return `
  <div class="gvg-filters box">
    <select data-g-hist="m"><option value="">Mọi thành viên</option>${s.members.map(m => `<option value="${m.id}" ${f.m === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <select data-g-hist="map"><option value="">Mọi map</option>${ctx.maps.map(n => `<option ${f.map === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select data-g-hist="r"><option value="">Mọi round</option>${rounds.map(r => `<option value="${r}" ${+f.r === r ? 'selected' : ''}>${esc(ctx.round(r)?.label || 'Round ' + r)}</option>`).join('')}</select>
    <span class="result-count"><b>${list.length}</b> lượt · ${fmtN(list.reduce((a, e) => a + e.p, 0))} điểm</span>
  </div>
  ${gvgEntryList(s, ctx, list, !!gvgShared)}`;
}

function gvgEntryList(s, ctx, list, readOnly) {
  if (!list.length) return '<p class="muted">Chưa có lượt nào.</p>';
  const name = id => s.members.find(m => m.id === id)?.name || '?';
  return `<div class="gvg-table-wrap"><table class="gvg-table gvg-entries">
    <thead><tr><th>Lúc</th><th>Thành viên</th><th>Round</th><th>Map</th><th>Vé</th><th>Điểm</th><th>Team</th>${readOnly ? '' : '<th></th>'}</tr></thead>
    <tbody>${list.map(e => `<tr class="${ctx.banned.has(e.m) ? 'banned' : ''}">
      <td class="muted">${gvgWhen(e.at)}</td><td>${esc(name(e.m))}</td><td>${esc(stageShort(ctx.round(e.r)?.label || 'R' + e.r))}</td>
      <td>${img(ctx.g.leaderSprites?.[e.map], 'sprite')}${esc(e.map)}</td><td class="num">${e.t}</td><td class="num">${fmtN(e.p)}</td>
      <td class="gvg-team-cell">${gvgTeamBadges(e.team)}</td>
      ${readOnly ? '' : `<td class="gvg-row-act"><button class="chip" data-g="edit" data-v="${e.id}" aria-label="Sửa">✎</button><button class="chip" data-g="del" data-v="${e.id}" aria-label="Xoá">🗑</button></td>`}</tr>`).join('')}</tbody>
  </table></div>`;
}
const gvgWhen = ms => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ─── Members ────────────────────────────────────────────────
function gvgMembers(s, ctx) {
  return `
  <div class="grid-2">
    <div class="box card">
      <h2 class="section-title">Thêm thành viên</h2>
      <form class="gvg-form" data-g-form="members">
        <textarea name="names" rows="6" placeholder="Mỗi dòng một tên"></textarea>
        <button class="chip on" type="submit">＋ Thêm</button>
      </form>
    </div>
    <div class="box card">
      <h2 class="section-title">Roster <span class="count">${s.members.length} người</span></h2>
      <div class="gvg-roster">${s.members.map(m => { const pm = ctx.perMember[m.id];
        return `<div class="gvg-member ${m.banned ? 'banned' : ''}">
          <input value="${esc(m.name)}" data-g-rename="${m.id}" aria-label="Tên" maxlength="40">
          <small class="muted">${pm.runs} lượt · ${fmtN(pm.points)}</small>
          <button class="chip ${m.banned ? 'on' : ''}" data-g="ban" data-v="${m.id}" ${tip(m.banned ? 'Mở khoá' : 'Khoá', 'Người bị khoá không ghi log mới được và bị trừ khỏi Combined Score; tiến độ map giữ nguyên')}>${m.banned ? '🔓 Mở khoá' : '🚫 Khoá'}</button>
          <button class="chip" data-g="delmember" data-v="${m.id}" ${pm.runs ? `disabled ${tip('Không xoá được', 'Thành viên đã có lượt — hãy khoá thay vì xoá')}` : ''}>🗑</button>
        </div>`; }).join('') || '<p class="muted">Chưa có ai.</p>'}</div>
    </div>
  </div>`;
}

// ─── Seasons & data ─────────────────────────────────────────
function gvgData(s) {
  const t = { ...TICKET_DEFAULT, ...s.tickets };
  return `
  <div class="grid-2">
    <div class="box card">
      <h2 class="section-title">Chia sẻ & sao lưu</h2>
      <p class="prose muted">Dữ liệu chỉ nằm trong trình duyệt này. Gửi file JSON cho admin khác để họ <b>Gộp</b> vào (lượt trùng id giữ bản mới hơn, lượt đã xoá được đồng bộ), hoặc gửi link chỉ-xem cho cả guild.</p>
      <div class="gvg-actions">
        <button class="chip on" data-g="share">🔗 Tạo link chỉ-xem</button>
        <button class="chip" data-g="export">⬇ Export JSON</button>
        <label class="chip">⬆ Import (gộp)<input type="file" accept="application/json,.json" data-g-import="merge" hidden></label>
        <label class="chip">⬆ Import (thay thế)<input type="file" accept="application/json,.json" data-g-import="replace" hidden></label>
      </div>
      <input class="gvg-share-out" id="gvg-share" readonly placeholder="Link sẽ hiện ở đây">
    </div>
    <div class="box card">
      <h2 class="section-title">Mùa hiện tại</h2>
      <form class="gvg-form" data-g-form="tickets">
        <label>Tên guild<input name="guild" value="${esc(s.guild || '')}" maxlength="40"></label>
        <div class="gvg-row3">
          <label>Vé ngày 1<input name="day1" type="number" min="0" value="${t.day1}"></label>
          <label>Vé mỗi ngày sau<input name="daily" type="number" min="0" value="${t.daily}"></label>
          <label>Số ngày nhận thêm<input name="days" type="number" min="0" value="${t.days}"></label>
        </div>
        <button class="chip on" type="submit">💾 Lưu</button>
      </form>
      <h3>Các mùa</h3>
      <div class="gvg-seasons">${gvg.seasons.slice().reverse().map(x => `
        <div class="gvg-member ${x.id === s.id ? 'on' : ''}"><b>${esc(x.guild || 'Guild')}</b><small class="muted">${esc(x.gym)} · ${x.members.length} người · ${x.entries.length} lượt</small>
          ${x.id === s.id ? '<span class="tag sm accent">đang dùng</span>' : `<button class="chip" data-g="useseason" data-v="${x.id}">Mở</button>`}
          <button class="chip" data-g="delseason" data-v="${x.id}" aria-label="Xoá mùa">🗑</button></div>`).join('')}</div>
    </div>
  </div>
  <div class="box card section">
    <h2 class="section-title">Mùa mới <span class="count">mùa cũ được giữ lại để xem</span></h2>
    ${gvgSeasonForm({ ...s, gym: D.gyms.at(-1).name })}
  </div>`;
}

// ─── Share link: deflate-raw + base64url in the hash ─────────
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function gvgPack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // no call-stack blowup on big logs
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function gvgUnpack(code) {
  const stream = new Blob([unb64u(code)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const season = JSON.parse(await new Response(stream).text());
  if (!season?.id || !Array.isArray(season.entries)) throw new Error('bad share');
  return { v: 1, seasons: [season], active: season.id };
}

// Merge another store into ours: seasons by id; members / entries by id (newest `u` wins); deletions travel as tombstones
function gvgMerge(into, from) {
  for (const src of from.seasons || []) {
    const dst = into.seasons.find(x => x.id === src.id);
    if (!dst) { into.seasons.push(src); continue; }
    const gone = new Set([...(dst.gone || []), ...(src.gone || [])]);
    const union = (a, b) => { const m = new Map(a.map(x => [x.id, x])); for (const x of b) if (!m.has(x.id) || (x.u || 0) > (m.get(x.id).u || 0)) m.set(x.id, x); return [...m.values()].filter(x => !gone.has(x.id)); };
    dst.members = union(dst.members, src.members || []);
    dst.entries = union(dst.entries, src.entries || []).sort((a, b) => a.at - b.at);
    dst.profiles = { ...src.profiles, ...dst.profiles };
    dst.gone = [...gone];
    if ((src.u || 0) > (dst.u || 0)) Object.assign(dst, { guild: src.guild, tickets: src.tickets, gym: src.gym, u: src.u });
  }
  if (!into.active) into.active = from.active;
}
const gvgValidStore = x => x?.v === 1 && Array.isArray(x.seasons) && x.seasons.every(s => s.id && Array.isArray(s.members) && Array.isArray(s.entries));

// ─── Toast ──────────────────────────────────────────────────
let gvgToastTimer;
function gvgToast(msg, bad = false) {
  let el = $('#gvg-toast');
  if (!el) { el = document.createElement('div'); el.id = 'gvg-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `gvg-toast show ${bad ? 'bad' : ''}`;
  clearTimeout(gvgToastTimer);
  gvgToastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ─── Events (delegated, like the rest of the site) ────────────
const gvgActive = () => location.hash.startsWith('#/gvg');
const gvgNum = v => v === '' || v == null ? null : Number(v);

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-g-form]');
  if (!form || !gvgActive()) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const kind = form.dataset.gForm;
  const tickets = f.day1 != null ? { day1: +f.day1 || 0, daily: +f.daily || 0, days: +f.days || 0 } : null;

  if (kind === 'season') {
    const names = [...new Set(String(f.roster || '').split('\n').map(x => x.trim()).filter(Boolean))];
    const s = { id: uid(), guild: f.guild.trim(), gym: f.gym, tickets, created: Date.now(), u: Date.now(),
      members: names.map(name => ({ id: uid(), name, banned: false, u: Date.now() })), entries: [], profiles: {}, gone: [] };
    gvg.seasons.push(s); gvg.active = s.id; gvgDraft = null;
    gvgSave(); gvgToast(`Đã tạo mùa ${s.gym} với ${names.length} thành viên.`);
    location.hash = '#/gvg'; route();
    return;
  }
  const s = gvgSeason();
  if (!s) return;
  if (kind === 'tickets') { s.tickets = tickets; s.guild = f.guild.trim(); gvgSave(); gvgToast('Đã lưu.'); return route(); }
  if (kind === 'members') {
    const have = new Set(s.members.map(m => m.name.toLowerCase()));
    const add = [...new Set(String(f.names || '').split('\n').map(x => x.trim()).filter(x => x && !have.has(x.toLowerCase())))];
    s.members.push(...add.map(name => ({ id: uid(), name, banned: false, u: Date.now() })));
    gvgSave(); gvgToast(add.length ? `Đã thêm ${add.length} người.` : 'Không có tên mới.'); return gvgRedraw();
  }
  if (kind === 'entry') {
    const ctx = gvgCtx(s);
    const d = gvgDraft;
    const editing = d.id ? s.entries.find(x => x.id === d.id) : null;
    const draft = { m: d.m, map: d.map, t: d.t, p: Number(d.p), r: d.r, team: d.team };
    const err = gvgValidate(s, ctx, draft, editing);
    if (err) { $('#gvg-err').textContent = err; return; }
    const team = draft.team.map(({ id, name, ml, lv, ex }) => ({ id, name, ml, lv: lv ?? null, ex }));
    if (editing) Object.assign(editing, { m: draft.m, map: draft.map, t: draft.t, p: draft.p, team, u: Date.now() });
    else s.entries.push({ id: uid(), at: Date.now(), u: Date.now(), m: draft.m, r: draft.r, map: draft.map, t: draft.t, p: draft.p, team });
    // Remember each pair's invest per member to prefill next time (the entry keeps its own snapshot)
    const prof = (s.profiles[draft.m] ||= {});
    for (const x of team) prof[x.id] = { ml: x.ml, lv: x.lv, ex: x.ex };
    const before = ctx.active;
    gvgSave();
    const after = gvgCtx(s).active;
    gvgToast(editing ? 'Đã lưu thay đổi.' : after !== before && after ? `Đã ghi. 🎉 Mở ${gvgCtx(s).round(after).label}!` : 'Đã ghi lượt.');
    gvgDraft = { ...gvgNewDraft(s, gvgCtx(s)), m: editing ? '' : draft.m, team: editing ? [] : draft.team };
    if (editing) { location.hash = '#/gvg/history'; return; }
    gvgRedraw();
  }
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-g]');
  if (!b || !gvgActive()) return;
  const act = b.dataset.g, v = b.dataset.v;
  if (act === 'tab') { gvgTab = v; return gvgRedraw2(); }
  if (act === 'adopt') {
    const snap = gvgShared; gvgShared = null;
    gvgMerge(gvg, snap); gvg.active = snap.active; gvgSave();
    gvgToast('Đã lưu bản chia sẻ vào máy (gộp theo id).'); location.hash = '#/gvg'; return;
  }
  const s = gvgSeason();
  if (!s) return;
  const d = gvgDraft;
  if (act === 'map') { d.map = v; return gvgRedraw(); }
  if (act === 't') { d.t = +v; return gvgRedraw(); }
  if (act === 'ex') { d.team[+b.dataset.i].ex = v; return gvgRedraw(); }
  if (act === 'unslot') { d.team.splice(+b.dataset.i, 1); return gvgRedraw(); }
  if (act === 'addpair') {
    const p = pairById(v);
    const last = s.profiles[d.m]?.[v];
    d.team.push({ id: v, name: `${p.trainer} & ${p.pokemon}`, ml: last?.ml || 1, lv: last?.lv ?? null, ex: last?.ex || 'none' });
    gvgRedraw(); $('#gvg-pair-q')?.focus(); return;
  }
  if (act === 'lastteam') {
    const last = s.entries.filter(x => x.m === d.m && x.team.length).at(-1);
    if (!last) return gvgToast('Thành viên này chưa có team nào.', true);
    d.team = last.team.map(x => ({ ...x, ...(s.profiles[d.m]?.[x.id] || {}) })); return gvgRedraw();
  }
  if (act === 'cancel') { gvgDraft = null; location.hash = '#/gvg/history'; return; }
  if (act === 'edit') {
    const x = s.entries.find(y => y.id === v);
    gvgDraft = { id: x.id, m: x.m, map: x.map, t: x.t, p: x.p, r: x.r, team: x.team.map(t => ({ ...t })) };
    location.hash = '#/gvg/log'; return;
  }
  if (act === 'del') {
    const x = s.entries.find(y => y.id === v);
    if (!confirm(`Xoá lượt ${fmtN(x.p)} điểm của ${s.members.find(m => m.id === x.m)?.name} tại ${x.map}? Round đã xong có thể mở lại.`)) return;
    s.entries = s.entries.filter(y => y.id !== v); (s.gone ||= []).push(v);
    gvgSave(); gvgToast('Đã xoá.'); return gvgRedraw();
  }
  if (act === 'ban') { const m = s.members.find(y => y.id === v); m.banned = !m.banned; m.u = Date.now(); gvgSave(); return gvgRedraw(); }
  if (act === 'delmember') { s.members = s.members.filter(y => y.id !== v); (s.gone ||= []).push(v); gvgSave(); return gvgRedraw(); }
  if (act === 'useseason') { gvg.active = v; gvgDraft = null; gvgSave(); return route(); }
  if (act === 'delseason') {
    const x = gvg.seasons.find(y => y.id === v);
    if (!confirm(`Xoá hẳn mùa “${x.guild || 'Guild'} · ${x.gym}” (${x.entries.length} lượt)? Nên Export JSON trước.`)) return;
    gvg.seasons = gvg.seasons.filter(y => y.id !== v);
    if (gvg.active === v) gvg.active = gvg.seasons.at(-1)?.id || null;
    gvgSave(); return route();
  }
  if (act === 'export') {
    const blob = new Blob([JSON.stringify(gvg, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `gvg-${(s.guild || 'guild').replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href); return;
  }
  if (act === 'share') {
    if (!('CompressionStream' in window)) return gvgToast('Trình duyệt này không nén được — dùng Export JSON.', true);
    const url = `${location.href.split('#')[0]}#/gvg/v~${await gvgPack(s)}`;
    const out = $('#gvg-share'); out.value = url; out.select();
    try { await navigator.clipboard.writeText(url); gvgToast(`Đã copy link (${fmtN(url.length)} ký tự).`); } catch (err) { gvgToast('Đã tạo link — copy trong ô bên dưới.'); }
  }
});
// Tabs inside a read-only share view can't change the hash (it holds the data)
function gvgRedraw2() { $$('.gvg-tabs .chip').forEach(c => c.classList.toggle('on', c.dataset.v === gvgTab)); gvgRedraw(); }

document.addEventListener('input', e => {
  if (!gvgActive()) return;
  const t = e.target;
  if (t.id === 'gvg-pair-q') {
    const s = gvgSeason();
    $('#gvg-results').innerHTML = gvgFindPairs(t.value, s, gvgDraft.m).map(p => `
      <button type="button" data-g="addpair" data-v="${p.id}">${img(p.trainerSprite, 'sprite')}${img(p.pokeSprite, 'sprite')}
        <span>${esc(p.trainer)} & ${esc(p.pokemon)}${p.form ? ` <small>${esc(formText(p.form))}</small>` : ''}</span>${typeBadge(p.type, true)}</button>`).join('')
      || (t.value.trim() ? '<p class="muted">Không tìm thấy pair.</p>' : '');
    return;
  }
  if (t.dataset.gField === 'p') gvgDraft.p = t.value;
});
document.addEventListener('change', async e => {
  if (!gvgActive()) return;
  const t = e.target;
  const s = gvgSeason();
  if (t.dataset.gField === 'm') { gvgDraft.m = t.value; return gvgRedraw(); }
  if (t.dataset.gSlot != null) {
    const x = gvgDraft.team[+t.dataset.gSlot];
    x[t.dataset.k] = t.dataset.k === 'lv' ? gvgNum(t.value) : +t.value;
    return;
  }
  if (t.dataset.gHist) { gvgHist[t.dataset.gHist] = t.value; return gvgRedraw(); }
  if (t.dataset.gRename) {
    const m = s.members.find(y => y.id === t.dataset.gRename), name = t.value.trim();
    if (!name || s.members.some(y => y !== m && y.name.toLowerCase() === name.toLowerCase())) { t.value = m.name; return gvgToast('Tên trống hoặc bị trùng.', true); }
    m.name = name; m.u = Date.now(); gvgSave(); return;
  }
  if (t.dataset.gImport) {
    const file = t.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!gvgValidStore(data)) throw new Error('shape');
      if (t.dataset.gImport === 'replace') {
        if (!confirm('Thay toàn bộ dữ liệu GvG trong máy bằng file này?')) return;
        gvg = data;
      } else gvgMerge(gvg, data);
      gvgDraft = null; gvgSave(); gvgToast('Đã import.'); route();
    } catch (err) { gvgToast('File không phải dữ liệu GvG hợp lệ.', true); }
  }
});
