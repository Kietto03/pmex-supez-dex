/* ═══════════════════════════════════════════════════════════════
   EVENTS — the game's calendar month by month (scouts from the datamine + events, High Score, Academy, story,
   Champion Stadium, missions… from brybry's copy of the game data) and the Free Gems of each day (community Gems sheet).
   #/events            calendar
   #/events/gems       Free Gems: the game month day by day and the year
   Times: scouts and events start at 06:00 UTC, the game's day change; "server days" below start then too.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  const { D, $, $$, esc, img, tip, fmtN, fmtShort, L, MONTHS, loadExt, extReady, rerender, pairById, stagger, scoutCat, PLACEHOLDER } = window.DEX;
  const BANNERS = 'https://pokemon.brybry.ch/masters/data/banner/';
  const KINDS = {
    scout: { c: '#e0602a', l: L('Scouts', 'Scout') },
    hse: { c: '#3c8de8', l: 'High Score' },
    battle: { c: '#d6384f', l: L('Battles', 'Trận đấu') },
    story: { c: '#b45bd6', l: L('Story & specials', 'Story & đặc biệt') },
    academy: { c: '#3ca06e', l: 'Academy' },
    legend: { c: '#c9a000', l: L('Legendary', 'Huyền thoại') },
    stadium: { c: '#0f8b8d', l: 'Champion Stadium' },
    mission: { c: '#7a8494', l: L('Missions', 'Nhiệm vụ') },
    other: { c: '#9a6b3f', l: L('Other events', 'Event khác') },
  };
  const PARTS = {
    daily: { c: '#ffcb05', l: L('Daily', 'Hằng ngày') }, regional: { c: '#ffcb05', l: 'Regional Rotation' },
    gym: { c: '#3c8de8', l: 'Gym Battle' }, stadium: { c: '#0f8b8d', l: 'Champion Stadium' }, other: { c: '#e0602a', l: L('Other', 'Khác') },
  };
  const ui = { tab: 'calendar', month: '', kinds: new Set(), period: '' };
  let events, gems;

  // ─── Time helpers (UTC) ─────────────────────────────────────
  const ms = iso => Date.parse(iso.length > 10 ? `${iso}Z` : `${iso}T00:00:00Z`);
  const isoDay = t => new Date(t).toISOString().slice(0, 10);
  const serverToday = () => isoDay(Date.now() - 6 * 36e5);   // the game day changes at 06:00 UTC
  const monthOf = d => d.slice(0, 7);
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
  const monthTitle = m => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
  const local = iso => new Date(ms(iso)).toLocaleString(L('en-GB', 'vi-VN'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dayLabel = d => new Date(`${d}T00:00:00Z`).toLocaleDateString(L('en-GB', 'vi-VN'), { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  const left = t => { const h = Math.round(t / 36e5); return h < 48 ? L(`${h} h`, `${h} giờ`) : L(`${Math.round(h / 24)} days`, `${Math.round(h / 24)} ngày`); };

  // Scouts (datamine) and the other events (brybry) as one list
  function allEvents() {
    const scouts = D.scouts.filter(s => s.start).map(s => ({ id: s.id, kind: 'scout', head: scoutCat(s).label, name: s.title, start: s.start, end: s.end || null,
      banner: '', rateUp: s.rateUp, href: `#/scouts/${s.id}` }));
    return [...scouts, ...(events?.events || [])].sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind));
  }
  const endMs = e => (e.end ? ms(e.end) : Infinity);
  function status(e, now = Date.now()) {
    if (now < ms(e.start)) return { id: 'soon', l: L(`Starts in ${left(ms(e.start) - now)}`, `Bắt đầu sau ${left(ms(e.start) - now)}`) };
    if (now > endMs(e)) return { id: 'ended', l: L('Ended', 'Đã kết thúc') };
    return { id: 'live', l: e.end ? L(`Running · ends in ${left(endMs(e) - now)}`, `Đang diễn ra · còn ${left(endMs(e) - now)}`) : L('Running', 'Đang diễn ra') };
  }

  // ─── Calendar ───────────────────────────────────────────────
  function monthEvents(m) {
    const a = ms(`${m}-01`), b = ms(`${addMonths(m, 1)}-01`);
    // Scouts with no end date (select tickets…) only show in the month they open, not in every month after
    return allEvents().filter(e => ms(e.start) < b && (e.end ? endMs(e) > a : ms(e.start) >= a));
  }
  function gantt(m, list) {
    const a = ms(`${m}-01`), b = ms(`${addMonths(m, 1)}-01`), span = b - a, n = daysIn(m), now = Date.now();
    const ticks = [1, 5, 10, 15, 20, 25, n];
    const todayPct = now >= a && now < b ? (now - a) / span * 100 : null;
    const groups = Object.keys(KINDS).map(k => [k, list.filter(e => e.kind === k)]).filter(([, l]) => l.length);
    return `<div class="box gantt ev-gantt"><div class="gantt-inner">
      <div class="gantt-axis" style="grid-template-columns:${ticks.map((t, i) => `${((ticks[i + 1] || n + 1) - t) / n}fr`).join(' ')}">${ticks.map(t => `<span>${t}/${+m.slice(5)}</span>`).join('')}</div>
      ${groups.map(([k, l]) => `<div class="ev-group" style="--kc:${KINDS[k].c}"><span class="ev-gname">${KINDS[k].l} <small>${l.length}</small></span></div>
        ${l.map((e, i) => {
          const s = Math.max(ms(e.start), a), en = Math.min(endMs(e), b), lp = (s - a) / span * 100, w = Math.max((en - s) / span * 100, 0.8);
          const label = e.name || e.head;
          const t = tip(label, `${e.head}${e.name ? '' : ''}\n${local(e.start)} → ${e.end ? local(e.end) : L('no end date', 'không hạn')}`);
          return `<div class="gantt-row ${k === groups[0][0] && i === 0 ? 'first' : ''}"><span class="gl" ${e.href ? `data-href="${e.href}"` : `data-ev="${esc(e.id)}"`}>${esc(label)}</span>
            <span class="gantt-track" style="--days:${n}">${todayPct !== null ? `<span class="gantt-today" style="left:${todayPct}%"></span>` : ''}
              <span class="gantt-bar ${ms(e.start) < a ? 'cont-l' : ''} ${endMs(e) > b ? 'cont-r' : ''}" ${e.href ? `data-href="${e.href}"` : `data-ev="${esc(e.id)}"`}
                style="left:${lp}%;width:${w}%;background:${KINDS[k].c}" ${t}></span></span></div>`;
        }).join('')}`).join('')}
    </div></div>`;
  }
  function monthGrid(m, list) {
    const n = daysIn(m), lead = (new Date(`${m}-01T00:00:00Z`).getUTCDay() + 6) % 7, today = serverToday();
    const byDate = new Map((gems?.days || []).map(d => [d.date, d]));
    const wd = [...Array(7)].map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(L('en-GB', 'vi-VN'), { weekday: 'short', timeZone: 'UTC' }));
    const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
    return `<div class="ev-cal">${wd.map(w => `<b class="ev-wd">${esc(w)}</b>`).join('')}${cells.map(d => {
      if (!d) return '<i class="ev-blank"></i>';
      const g = byDate.get(d), starts = list.filter(e => e.start.slice(0, 10) === d);
      return `<div class="ev-d ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}">
        <div class="ev-dtop"><span class="n">${+d.slice(8)}</span>${g ? `<span class="g ${d > today ? 'plan' : ''}" ${tip(L('Free Gems', 'Gem free'), `${dayLabel(d)}: ${fmtN(g.gems)}${d > today ? L(' (planned)', ' (dự kiến)') : ''}`)}>💎${fmtN(g.gems)}</span>` : ''}</div>
        <div class="ev-dots">${starts.slice(0, 8).map(e => `<i style="background:${KINDS[e.kind].c}" ${tip(e.name || e.head, KINDS[e.kind].l)}></i>`).join('')}${starts.length > 8 ? `<small>+${starts.length - 8}</small>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
  }
  function eventCard(e) {
    const st = status(e), pairs = (e.rateUp || []).map(r => D.pairs.find(p => p.trainer === r.trainer && p.pokemon === r.pokemon)).filter(Boolean);
    const banner = e.banner ? `<img class="ev-banner" src="${BANNERS}${e.banner}/${esc(e.id)}.png" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    const inner = `${banner}<div class="ev-body"><div class="ev-top"><span class="tag sm" style="background:${KINDS[e.kind].c};color:#fff;border-color:rgba(0,0,0,.4)">${KINDS[e.kind].l}</span><span class="ev-st ${st.id}">${st.l}</span></div>
      <h4>${esc(e.name || e.head)}</h4>${e.name && e.kind !== 'scout' ? `<p class="muted ev-head">${esc(e.head)}</p>` : ''}
      <p class="ev-when">${local(e.start)} → ${e.end ? local(e.end) : L('no end date', 'không hạn')}</p>
      ${pairs.length ? `<div class="ev-pairs">${pairs.slice(0, 6).map(p => img(p.pokeSprite, 'sprite', p.pokemon)).join('')}${pairs.length > 6 ? `<small class="muted">+${pairs.length - 6}</small>` : ''}</div>` : ''}</div>`;
    return e.href ? `<a class="box ev-card" id="ev-${esc(e.id)}" href="${e.href}" style="--kc:${KINDS[e.kind].c}">${inner}</a>`
      : `<article class="box ev-card" id="ev-${esc(e.id)}" style="--kc:${KINDS[e.kind].c}">${inner}</article>`;
  }
  function calendar() {
    const m = ui.month || monthOf(serverToday()), list = monthEvents(m), show = list.filter(e => !ui.kinds.size || ui.kinds.has(e.kind));
    const live = show.filter(e => status(e).id === 'live').length;
    const startsHere = show.filter(e => monthOf(e.start) === m).sort((a, b) => a.start.localeCompare(b.start));
    const monthGems = (gems?.days || []).filter(d => monthOf(d.date) === m).reduce((a, d) => a + d.gems, 0);
    return `
    <div class="ev-nav">
      <button class="chip" data-ev-month="${addMonths(m, -1)}" aria-label="${L('Previous month', 'Tháng trước')}">◀</button>
      <h2 class="ev-title">${monthTitle(m)}</h2>
      <button class="chip" data-ev-month="${addMonths(m, 1)}" aria-label="${L('Next month', 'Tháng sau')}">▶</button>
      <button class="chip" data-ev-month="${monthOf(serverToday())}">${L('This month', 'Tháng này')}</button>
    </div>
    <div class="stat-row">
      <div class="box stat-tile"><span class="v">${show.length}</span><span class="l">${L('events this month', 'event trong tháng')}</span></div>
      <div class="box stat-tile"><span class="v">${show.filter(e => e.kind === 'scout').length}</span><span class="l">${L('scouts', 'scout')}</span></div>
      <div class="box stat-tile"><span class="v">${live}</span><span class="l">${L('running now', 'đang diễn ra')}</span></div>
      <div class="box stat-tile"><span class="v">${monthGems ? fmtShort(monthGems) : '—'}</span><span class="l">${L('Free Gems in the month', 'gem free trong tháng')}</span></div>
    </div>
    <div class="filter-line ev-kinds">${Object.entries(KINDS).map(([k, v]) => { const n = list.filter(e => e.kind === k).length; return n ? `<button class="chip ${ui.kinds.has(k) ? 'on' : ''}" data-ev-kind="${k}"><span class="dot" style="background:${v.c}"></span>${v.l}<span class="n">${n}</span></button>` : ''; }).join('')}
      ${ui.kinds.size ? `<button class="chip" data-ev-kind="">✕ ${L('all', 'tất cả')}</button>` : ''}</div>
    ${show.length ? gantt(m, show) : `<div class="empty">${img(PLACEHOLDER)}${L('No events listed for this month.', 'Không có event nào trong tháng này.')}</div>`}
    <div class="section"><h2 class="section-title">${L('Month at a glance', 'Tổng quan tháng')} <span class="count">${L('💎 Free Gems of the day · dots = events starting', '💎 gem free của ngày · chấm = event bắt đầu')}</span></h2>${monthGrid(m, show)}</div>
    <div class="section"><h2 class="section-title">${L('Starting this month', 'Bắt đầu trong tháng')} <span class="count">${startsHere.length}</span></h2>
      <div class="ev-grid">${startsHere.map(eventCard).join('') || `<p class="muted">—</p>`}</div></div>
    <p class="muted" style="font-size:13px">${L('Scouts: datamine. Other events and banners: ', 'Scout: datamine. Event khác và banner: ')}<a href="https://pokemon.brybry.ch/masters/" target="_blank" rel="noopener noreferrer">brybry ↗</a>${gems ? ` · ${L('Free Gems: ', 'Gem free: ')}<a href="${esc(gems.source)}" target="_blank" rel="noopener noreferrer">${L('community Gems sheet', 'sheet Gems cộng đồng')} (${esc(gems.author)}) ↗</a>` : ''}. ${L('Times are shown in your time zone.', 'Giờ hiển thị theo múi giờ của bạn.')}</p>`;
  }

  // ─── Free Gems ──────────────────────────────────────────────
  const sumParts = (d, keys) => keys.reduce((a, k) => a + (d.parts?.[k] || 0), 0);
  // One game month, day by day: stacked bars by source and the running total as a line
  function dayChart(days, today) {
    const W = 22, H = 160, pad = 26, max = Math.max(1, ...days.map(d => d.gems)), total = days.reduce((a, d) => a + d.gems, 0) || 1;
    const x = i => pad + i * W, y = v => H - v / max * (H - 20);
    let run = 0;
    const line = days.map((d, i) => { run += d.gems; return `${x(i) + W / 2},${(H - run / total * (H - 20)).toFixed(1)}`; }).join(' ');
    const stacks = days.map((d, i) => {
      let acc = 0;
      const segs = Object.entries(d.parts || {}).filter(([, v]) => v > 0).map(([k, v]) => {
        const y0 = y(acc), y1 = y(acc + v); acc += v;
        return `<rect x="${x(i) + 2}" y="${y1.toFixed(1)}" width="${W - 4}" height="${(y0 - y1).toFixed(1)}" fill="${(PARTS[k] || PARTS.other).c}"/>`;
      }).join('');
      return `<g class="${d.date > today ? 'plan' : ''} ${d.date === today ? 'today' : ''}" ${tip(dayLabel(d.date), `💎 ${fmtN(d.gems)}${d.date > today ? L(' (planned)', ' (dự kiến)') : ''}\n${Object.entries(d.parts || {}).filter(([, v]) => v).map(([k, v]) => `${(PARTS[k] || PARTS.other).l}: ${fmtN(v)}`).join('\n')}`)}>
        <rect x="${x(i)}" y="0" width="${W}" height="${H}" fill="transparent"/>${segs}</g>`;
    }).join('');
    const ti = days.findIndex(d => d.date === today);
    return `<div class="gm-chart"><svg viewBox="0 0 ${pad * 2 + days.length * W} ${H + 22}" role="img" aria-label="${L('Free Gems per day', 'Gem free mỗi ngày')}">
      <line x1="${pad}" x2="${pad + days.length * W}" y1="${H}" y2="${H}" class="gm-axis"/>
      ${ti >= 0 ? `<rect x="${x(ti)}" y="0" width="${W}" height="${H}" class="gm-today"/>` : ''}
      ${stacks}
      <polyline points="${line}" class="gm-run"/>
      ${days.map((d, i) => (i % 5 === 0 || i === days.length - 1 ? `<text x="${x(i) + W / 2}" y="${H + 15}" class="gm-tick">${+d.date.slice(8)}/${+d.date.slice(5, 7)}</text>` : '')).join('')}
      <text x="${pad - 4}" y="12" class="gm-tick" text-anchor="end">${fmtShort(max)}</text>
    </svg></div>
    <div class="gm-legend">${[...new Set(days.flatMap(d => Object.keys(d.parts || {}).filter(k => d.parts[k] > 0)))].map(k => `<span><i style="background:${(PARTS[k] || PARTS.other).c}"></i>${(PARTS[k] || PARTS.other).l}</span>`).join('')}
      <span><i class="gm-run-key"></i>${L('running total', 'cộng dồn')}</span></div>`;
  }
  function yearChart(months, today) {
    const top = Math.max(1, ...months.map(m => m.total || 0)), done = months.filter(m => m.end < today && m.total > 0);
    const avg = done.length ? Math.round(done.reduce((a, m) => a + m.total, 0) / done.length) : 0;
    return `<div class="gm-year">${avg ? `<span class="gm-avg" style="bottom:calc(18px + ${(avg / top * 140).toFixed(1)}px)" title="${L('average', 'trung bình')}"><b>${L('avg', 'TB')} ${fmtShort(avg)}</b></span>` : ''}
      ${months.map(m => `<button class="gm-col ${m.start <= today && today <= m.end ? 'cur' : ''} ${ui.period === m.start ? 'on' : ''}" data-gm-period="${m.start}"
        ${tip(L(`Game month ${m.month}`, `Tháng game ${m.month}`), `${dayLabel(m.start)} → ${dayLabel(m.end)}\n💎 ${fmtN(m.total)}\n${L('Daily', 'Hằng ngày')} ${fmtN(m.daily)} · Gym ${fmtN(m.gym)} · ${L('Other', 'Khác')} ${fmtN(m.other)}`)}>
        <span class="gm-v">${fmtShort(m.total || 0)}</span>
        <span class="gm-bar">${[['daily', m.daily], ['gym', m.gym], ['other', m.other]].map(([k, v]) => `<i style="height:${(v || 0) / top * 100}%;background:${PARTS[k].c}"></i>`).join('')}</span>
        <b>${m.month}</b></button>`).join('')}</div>`;
  }
  function freeGems() {
    if (!gems) return `<div class="empty">${img(PLACEHOLDER)}${L('The Gems sheet is not available yet.', 'Chưa có dữ liệu sheet Gems.')}</div>`;
    const today = serverToday(), months = gems.months.filter(m => m.total != null);
    const cur = months.find(m => m.start <= today && today <= m.end) || months.at(-1);
    const per = months.find(m => m.start === ui.period) || cur;
    const days = gems.days.filter(d => d.date >= per.start && d.date <= per.end);
    const done = days.filter(d => d.date <= today), earned = done.reduce((a, d) => a + d.gems, 0), all = days.reduce((a, d) => a + d.gems, 0);
    const best = [...days].sort((a, b) => b.gems - a.gems)[0];
    const finished = months.filter(m => m.end < today && m.total > 0);
    const avgDay = finished.length ? Math.round(finished.reduce((a, m) => a + m.total, 0) / finished.reduce((a, m) => a + (ms(m.end) - ms(m.start)) / 864e5 + 1, 0)) : 0;
    const lastDay = gems.days.at(-1)?.date;
    return `
    <p class="prose" style="max-width:860px">${L('Free Gems only, from the community Gems sheet: what each day gives (daily rewards, Gym Battle, others) for a game month, and how the months compare. Days are server days (they change at 06:00 UTC). Not counted: Pasio Tower, ranking gems, lucky draws, compensation.',
      'Chỉ gem free, theo sheet Gems cộng đồng: mỗi ngày nhận bao nhiêu (thưởng hằng ngày, Gym Battle, khác) trong một tháng game, và so sánh giữa các tháng. Ngày tính theo server (đổi lúc 06:00 UTC). Không tính: Pasio Tower, gem xếp hạng, quay thưởng, bồi thường.')}
      ${L('Source', 'Nguồn')}: <a href="${esc(gems.source)}" target="_blank" rel="noopener noreferrer">${L('Gems sheet', 'sheet Gems')} (${esc(gems.author)}) ↗</a> · ${L('updated', 'cập nhật')} ${esc(gems.updated || '—')} · ${L('covers until', 'có đến')} ${lastDay ? dayLabel(lastDay) : '—'}</p>
    <div class="filter-line"><span class="lab">${L('Game month', 'Tháng game')}</span>
      ${months.slice(-6).map(m => `<button class="chip ${m === per ? 'on' : ''}" data-gm-period="${m.start}">${m.month} · ${+m.start.slice(8)}/${+m.start.slice(5, 7)}–${+m.end.slice(8)}/${+m.end.slice(5, 7)}</button>`).join('')}</div>
    <div class="stat-row">
      <div class="box stat-tile"><span class="v">${fmtN(per.total ?? all)}</span><span class="l">${L(`month ${per.month} total`, `tổng tháng ${per.month}`)}</span></div>
      <div class="box stat-tile"><span class="v">${fmtN(earned)}</span><span class="l">${L(`earned so far · ${done.length} days`, `đã nhận · ${done.length} ngày`)}</span></div>
      <div class="box stat-tile"><span class="v">${fmtN(Math.max(0, all - earned))}</span><span class="l">${L(`still to come · ${days.length - done.length} days`, `còn lại · ${days.length - done.length} ngày`)}</span></div>
      <div class="box stat-tile"><span class="v">${best ? fmtN(best.gems) : '—'}</span><span class="l">${L('best day', 'ngày nhiều nhất')}${best ? ` · ${dayLabel(best.date)}` : ''}</span></div>
    </div>
    <section class="box card section"><h2 class="section-title">${L('Day by day', 'Theo ngày')} <span class="count">${dayLabel(per.start)} → ${dayLabel(per.end)}</span></h2>
      ${days.length ? dayChart(days, today) : `<p class="muted">${L('No days in this month yet.', 'Tháng này chưa có ngày nào.')}</p>`}
      ${per.end > (lastDay || '') ? `<p class="muted">${L('The sheet does not cover the end of this month yet.', 'Sheet chưa có đến cuối tháng này.')}</p>` : ''}</section>
    <section class="box card section"><h2 class="section-title">${L('Month by month', 'Theo tháng')} <span class="count">${avgDay ? L(`about ${fmtN(avgDay)} a day on average`, `trung bình khoảng ${fmtN(avgDay)} mỗi ngày`) : ''}</span></h2>
      ${yearChart(months, today)}
      <div class="gm-legend">${['daily', 'gym', 'other'].map(k => `<span><i style="background:${PARTS[k].c}"></i>${PARTS[k].l}</span>`).join('')}<span><i class="gm-avg-key"></i>${L('average of the finished months', 'trung bình các tháng đã qua')}</span></div></section>`;
  }

  const body = () => (ui.tab === 'gems' ? freeGems() : calendar());
  function redraw() { const el = $('#ev-body'); if (el) { el.innerHTML = body(); stagger(el); } }

  function render(arg) {
    events ??= extReady('events'); gems ??= extReady('gems');
    if (events === undefined || gems === undefined) {
      Promise.all([loadExt('events').then(j => { events = j; }, () => { events = null; }), loadExt('gems').then(j => { gems = j; }, () => { gems = null; })]).then(rerender);
      return `<div class="loading"><img src="${PLACEHOLDER}" alt="" class="px-img spin"> ${L('Loading…', 'Đang tải…')}</div>`;
    }
    ui.tab = arg === 'gems' ? 'gems' : 'calendar';
    return `
    <h1 class="section-title">${L('Events', 'Sự kiện')} <span class="count">${L('calendar and Free Gems', 'lịch và gem free')}</span></h1>
    <div class="cl-tabs" role="tablist">${[['calendar', L('Calendar', 'Lịch'), ''], ['gems', L('Free Gems', 'Gem free'), '/gems']].map(([k, l, h]) =>
      `<a class="chip ${ui.tab === k ? 'on' : ''}" role="tab" aria-selected="${ui.tab === k}" href="#/events${h}">${l}</a>`).join('')}</div>
    ${events === null && ui.tab === 'calendar' ? `<p class="muted">${L('Only scouts are shown: the event list could not be loaded.', 'Chỉ hiện scout: không tải được danh sách event.')}</p>` : ''}
    <div id="ev-body">${body()}</div>`;
  }

  document.addEventListener('click', e => {
    if (!location.hash.startsWith('#/events')) return;
    const mo = e.target.closest('[data-ev-month]'), k = e.target.closest('[data-ev-kind]'), hr = e.target.closest('[data-href]');
    const ev = e.target.closest('[data-ev]'), per = e.target.closest('[data-gm-period]');
    if (mo) { ui.month = mo.dataset.evMonth; redraw(); }
    else if (k) { const v = k.dataset.evKind; if (!v) ui.kinds.clear(); else if (ui.kinds.has(v)) ui.kinds.delete(v); else ui.kinds.add(v); redraw(); }
    else if (hr) location.hash = hr.dataset.href;
    else if (ev) { const el = document.getElementById(`ev-${ev.dataset.ev}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
    else if (per) { ui.period = per.dataset.gmPeriod; redraw(); }
  });

  window.DEX.page('events', render, () => stagger($('#ev-body')));
})();
