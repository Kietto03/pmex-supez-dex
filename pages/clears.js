/* ═══════════════════════════════════════════════════════════════
   CLEARS — the community's D.C. (3v3 / 3v1) and GvG clear teams: which weakness type scores highest, with which team,
   which pairs turn up most in the best teams, and every clear with its video.
   Data: data/ext/clears.json (community sheets, refreshed by scripts/sync-sources.mjs; units matched to Dex pairs there).
   #/clears/gvg opens the GvG library.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  const { $, $$, esc, img, tip, fmtN, fmtShort, L, TYPES, TYPE_COLORS, typeBadge, loadExt, extReady, rerender, pairById, stagger, PLACEHOLDER } = window.DEX;
  const F = {
    dc: { type: '', mode: '3v3', q: '', sort: 'score' },
    gvg: { type: '', season: '', q: '', sort: 'season' },
  };
  let kind = 'dc', shown = 48, data;
  const seasonNo = s => +(/SS(\d+)/i.exec(s)?.[1] || 0);
  const videoHost = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const unitPair = u => (u.id ? pairById(u.id) : null);
  const unitName = u => { const p = unitPair(u); return p ? `${p.trainer} & ${p.pokemon}` : u.name; };
  const lvl = u => (u.level ? `${u.level}/5${u.ex ? ' EX' : ''}${u.exr ? ' R' : ''}` : '');

  // The clears of the current tab, before the type filter (the meta board shows every type)
  function pool() {
    const f = F[kind], all = data[kind] || [];
    return all.filter(x => (kind === 'dc' ? !f.mode || x.mode === f.mode : !f.season || x.season === f.season));
  }
  function filtered() {
    const f = F[kind], q = f.q.trim().toLowerCase();
    const rows = pool().filter(x => (!f.type || x.type === f.type)
      && (!q || x.units.some(u => `${u.name} ${unitName(u)}`.toLowerCase().includes(q)) || (x.rules || '').toLowerCase().includes(q)));
    const by = { score: (a, b) => b.score - a.score, season: (a, b) => seasonNo(b.season) - seasonNo(a.season) || b.score - a.score,
      type: (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.score - a.score };
    return rows.sort(by[f.sort] || by.score);
  }
  // One row per weakness type, the strongest first
  function metaByType(list) {
    const by = new Map();
    for (const x of list) (by.get(x.type) || by.set(x.type, []).get(x.type)).push(x);
    const rows = [...by.entries()].map(([type, l]) => { const s = [...l].sort((a, b) => b.score - a.score); return { type, count: l.length, best: s[0], top: s.slice(0, 5) }; })
      .sort((a, b) => b.best.score - a.best.score);
    return { rows, max: rows[0]?.best.score || 1 };
  }
  // Pairs found in the five best teams of each type, most often first
  function metaPairs(rows, limit = 14) {
    const m = new Map();
    for (const r of rows) for (const x of r.top) for (const id of new Set(x.units.map(u => u.id).filter(Boolean))) {
      const e = m.get(id) || m.set(id, { id, count: 0, types: new Set() }).get(id);
      e.count++; e.types.add(r.type);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.types.size - a.types.size).slice(0, limit);
  }

  function unitHtml(u) {
    const p = unitPair(u);
    const inner = `${img(p?.pokeSprite || PLACEHOLDER, 'sprite', u.name)}<span><b>${esc(u.name)}</b><small>${esc(lvl(u))}</small></span>`;
    const t = tip(unitName(u), u.approx ? L('Matched by name: best guess', 'Ghép theo tên: đoán gần đúng') : p ? `${p.role || ''} · ${p.type || ''}` : L('Not matched to a pair', 'Chưa ghép được với pair'));
    return p ? `<a class="cl-u ${u.approx ? 'approx' : ''}" href="#/pair/${esc(p.id)}" ${t}>${inner}</a>` : `<span class="cl-u none" ${t}>${inner}</span>`;
  }
  function card(x) {
    return `<article class="box cl-card" style="--tc:${TYPE_COLORS[x.type] || '#888'}">
      <header>${typeBadge(x.type, true)}<b class="cl-score">${fmtN(x.score)}</b>
        <span class="cl-meta">${kind === 'dc' ? esc(x.mode) : `${esc(x.season)} · ${esc(x.round)}${x.tickets ? ` · 🎫${x.tickets}` : ''}`}</span></header>
      ${x.rules ? `<div class="cl-rules">${x.rules.split(',').map(r => `<span class="tag sm">${esc(r.trim())}</span>`).join('')}</div>` : ''}
      <div class="cl-team">${x.units.map(unitHtml).join('')}</div>
      <footer>${x.video ? `<a class="cl-watch" href="${esc(x.video)}" target="_blank" rel="noopener noreferrer">▶ ${L('Watch', 'Xem video')} <small>${esc(videoHost(x.video))}</small></a>` : `<small class="muted">${L('No video', 'Không có video')}</small>`}</footer>
    </article>`;
  }

  function board() {
    const list = pool(), { rows, max } = metaByType(list), f = F[kind];
    if (!rows.length) return '';
    const pairs = metaPairs(rows), pmax = pairs[0]?.count || 1;
    const best = rows[0];
    const teams = new Set(list.map(x => x.units.map(u => u.id || u.name).sort().join('|'))).size;
    return `
    <div class="stat-row cl-kpis">
      <div class="box stat-tile"><span class="v">${list.length}</span><span class="l">${L('clears', 'clear')}</span></div>
      <div class="box stat-tile"><span class="v">${rows.length}</span><span class="l">${L('weakness types', 'hệ điểm yếu')}</span></div>
      <div class="box stat-tile"><span class="v">${fmtShort(best.best.score)}</span><span class="l">${L('top score', 'điểm cao nhất')} · ${esc(best.type)}</span></div>
      <div class="box stat-tile"><span class="v">${teams}</span><span class="l">${L('different teams', 'đội hình khác nhau')}</span></div>
    </div>
    <div class="grid-2 cl-meta-grid">
      <section class="box card">
        <h2 class="section-title">${L('Meta by weakness type', 'Meta theo hệ điểm yếu')} <span class="count">${L('best score · best team', 'điểm cao nhất · đội mạnh nhất')}</span></h2>
        <div class="cl-meta-rows">${rows.map(r => `<button class="cl-meta-row ${f.type === r.type ? 'on' : ''}" data-cl-type="${r.type}" style="--tc:${TYPE_COLORS[r.type]}"
            ${tip(`${r.type}: ${fmtN(r.best.score)}`, `${r.count} ${L('clears', 'clear')} · ${r.best.units.map(unitName).join(' / ')}`)}>
          <span class="cl-mt">${typeBadge(r.type, true)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, r.best.score / max * 100)}%;background:${TYPE_COLORS[r.type]}"></span></span>
          <b class="cl-ms">${fmtShort(r.best.score)}</b>
          <span class="cl-mteam">${r.best.units.map(u => img(unitPair(u)?.pokeSprite || PLACEHOLDER, 'sprite', u.name)).join('')}</span>
          <small class="cl-mn">×${r.count}</small></button>`).join('')}</div>
      </section>
      <section class="box card">
        <h2 class="section-title">${L('Pairs in the best teams', 'Pair trong các đội mạnh nhất')} <span class="count">${L('top 5 of each type', 'top 5 mỗi hệ')}</span></h2>
        <div class="bars">${pairs.map(e => { const p = pairById(e.id); return p ? `<a class="bar-row cl-prow" href="#/pair/${esc(p.id)}" ${tip(`${p.trainer} & ${p.pokemon}`, L(`In ${e.count} of the best teams, across ${e.types.size} types`, `Có trong ${e.count} đội mạnh nhất, ở ${e.types.size} hệ`))}>
          <span class="lbl">${img(p.pokeSprite, 'sprite', p.pokemon)}<span>${esc(p.trainer.replace(/\s*\(.*\)/, ''))}</span></span>
          <span class="bar-track"><span class="bar-fill" style="width:${e.count / pmax * 100}%;background:${TYPE_COLORS[p.type] || 'var(--accent)'}"></span></span>
          <span class="val">×${e.count}</span></a>` : ''; }).join('') || `<p class="muted">—</p>`}</div>
      </section>
    </div>`;
  }

  function results() {
    const rows = filtered(), total = pool().length;
    return `<p class="muted">${L(`${rows.length} of ${total} clears`, `${rows.length} / ${total} clear`)}${F[kind].type ? ` · ${typeBadge(F[kind].type, true)} <button class="chip cl-clear" data-cl-type="">✕ ${L('all types', 'mọi hệ')}</button>` : ''}</p>
    <div class="cl-grid">${rows.slice(0, shown).map(card).join('') || `<div class="empty">${img(PLACEHOLDER)}${L('No clear matches.', 'Không có clear nào khớp.')}</div>`}</div>
    ${rows.length > shown ? `<div style="text-align:center;margin-top:14px"><button class="chip" data-cl-more>${L(`Show more (${rows.length - shown} left)`, `Xem thêm (còn ${rows.length - shown})`)}</button></div>` : ''}`;
  }

  function controls() {
    const f = F[kind], all = data[kind] || [];
    const seasons = [...new Set(all.map(x => x.season).filter(Boolean))].sort((a, b) => seasonNo(b) - seasonNo(a));
    const sorts = kind === 'dc' ? [['score', L('Highest score', 'Điểm cao nhất')], ['type', L('By type', 'Theo hệ')]]
      : [['season', L('Newest season', 'Mùa mới nhất')], ['score', L('Highest score', 'Điểm cao nhất')], ['type', L('By type', 'Theo hệ')]];
    return `<div class="box filters">
      <div class="filter-line">
        <label class="search">🔍<input id="cl-q" type="search" placeholder="${L('Search a pair or a rule…', 'Tìm pair hoặc luật…')}" value="${esc(f.q)}"></label>
        ${kind === 'dc' ? ['3v3', '3v1'].map(m => `<button class="chip ${f.mode === m ? 'on' : ''}" data-cl-mode="${m}">${m}</button>`).join('')
          : `<select class="cl-select" data-cl-season><option value="">${L('All seasons', 'Mọi mùa')}</option>${seasons.map(s => `<option ${f.season === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`}
        <select class="cl-select" data-cl-sort>${sorts.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div></div>`;
  }

  const body = () => `${controls()}<div id="cl-board">${board()}</div>
    <h2 class="section-title" style="margin-top:26px">${L('Clear teams', 'Đội hình clear')}</h2><div id="cl-results">${results()}</div>`;
  function redraw(part) {
    if (part === 'results') { const r = $('#cl-results'); if (r) r.innerHTML = results(); }
    else if (part === 'list') { const r = $('#cl-results'), b = $('#cl-board'); if (b) b.innerHTML = board(); if (r) r.innerHTML = results(); }
    else { const el = $('#cl-body'); if (el) el.innerHTML = body(); }
    $$('[data-cl-kind]').forEach(b => b.classList.toggle('on', b.dataset.clKind === kind));
  }

  function render(arg) {
    if (data === undefined) data = extReady('clears');
    if (data === undefined) {
      loadExt('clears').then(j => { data = j; }, () => { data = null; }).then(rerender);
      return `<div class="loading"><img src="${PLACEHOLDER}" alt="" class="px-img spin"> ${L('Loading…', 'Đang tải…')}</div>`;
    }
    if (!data) return `<div class="empty">${img(PLACEHOLDER)}${L('The clear library is not available yet.', 'Chưa có thư viện clear.')}</div>`;
    kind = arg === 'gvg' ? 'gvg' : 'dc';
    shown = 48;
    return `
    <h1 class="section-title">${L('Clear library', 'Thư viện clear')} <span class="count">${data.dc.length} D.C. · ${data.gvg.length} GvG</span></h1>
    <p class="prose" style="max-width:860px">${L('Clear teams collected by the community, by the weakness type of the stage. Each unit is matched to a Dex pair by name; a dashed frame is a best guess.',
      'Đội hình clear do cộng đồng tổng hợp, theo hệ điểm yếu của màn. Mỗi unit được ghép với pair trong Dex theo tên; khung nét đứt là đoán gần đúng.')}
      ${L('Sources', 'Nguồn')}: <a href="${esc(data.sources.dc)}" target="_blank" rel="noopener noreferrer">D.C. sheet ↗</a> · <a href="${esc(data.sources.gvg)}" target="_blank" rel="noopener noreferrer">GvG sheet ↗</a> · ${L('copied', 'lấy ngày')} ${esc(data.fetched.slice(0, 10))}</p>
    <div class="cl-tabs" role="tablist">${[['dc', 'Damage Challenge'], ['gvg', 'Gym vs Gym']].map(([k, l]) => `<a class="chip ${kind === k ? 'on' : ''}" role="tab" aria-selected="${kind === k}" href="#/clears${k === 'gvg' ? '/gvg' : ''}" data-cl-kind="${k}">${l}<span class="n">${data[k].length}</span></a>`).join('')}</div>
    <div id="cl-body">${body()}</div>`;
  }

  document.addEventListener('input', e => { if (e.target.id === 'cl-q') { F[kind].q = e.target.value; shown = 48; redraw('results'); } });
  document.addEventListener('change', e => {
    if (e.target.matches('[data-cl-season]')) { F[kind].season = e.target.value; F[kind].type = ''; shown = 48; redraw('list'); }
    if (e.target.matches('[data-cl-sort]')) { F[kind].sort = e.target.value; redraw('results'); }
  });
  document.addEventListener('click', e => {
    if (!location.hash.startsWith('#/clears')) return;
    const t = e.target.closest('[data-cl-type]'), m = e.target.closest('[data-cl-mode]'), more = e.target.closest('[data-cl-more]');
    if (t) {
      F[kind].type = F[kind].type === t.dataset.clType ? '' : t.dataset.clType; shown = 48;
      $$('.cl-meta-row').forEach(b => b.classList.toggle('on', b.dataset.clType === F[kind].type));
      redraw('results');
      if (t.classList.contains('cl-meta-row')) $('#cl-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (m) { F[kind].mode = m.dataset.clMode; F[kind].type = ''; shown = 48; $$('[data-cl-mode]').forEach(b => b.classList.toggle('on', b === m)); redraw('list'); }
    else if (more) { shown += 48; redraw('results'); }
  });

  window.DEX.page('clears', render, () => stagger($('#cl-body')));
})();
