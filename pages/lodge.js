/* ═══════════════════════════════════════════════════════════════
   TRAINER LODGE — the topics each trainer likes to talk about (10 / 7 / 5 points), by trainer or by topic.
   Data: data/ext/lodge.json (Serebii, refreshed by scripts/sync-sources.mjs).
   #/lodge/<serebii id> opens a trainer.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  const { $, $$, esc, img, tip, L, loadExt, extReady, rerender, pairById, stagger, PLACEHOLDER } = window.DEX;
  const PTS = ['10', '7', '5'];
  const CAT_ORDER = ['Pokémon', 'Places', 'Hobbies', 'Friends', 'Fashion', 'Items', 'Other'];
  const CAT_COLOR = { 'Pokémon': '#e0584f', Places: '#2f9e6b', Hobbies: '#e08a2c', Friends: '#d2569a', Fashion: '#8a5bd6', Items: '#2f86d6', Other: '#7a8494' };
  const catOf = c => (CAT_ORDER.includes(c) ? c : 'Other');
  const ui = { mode: 'trainer', q: '', trainer: '', topic: '', cat: '' };
  let data;

  const sprite = t => img(t.sprite || PLACEHOLDER, 'sprite', t.name);
  const catChip = c => `<span class="lg-cat" style="--c:${CAT_COLOR[catOf(c)]}">${esc(c)}</span>`;
  // How a trainer's topics split by category: one stacked bar
  function catBar(list) {
    const n = list.length || 1, by = CAT_ORDER.map(c => [c, list.filter(x => catOf(x[1]) === c).length]).filter(([, k]) => k);
    return `<div class="lg-bar" role="img" aria-label="${esc(by.map(([c, k]) => `${c} ${k}`).join(', '))}">${by.map(([c, k]) =>
      `<i style="flex:${k};background:${CAT_COLOR[c]}" ${tip(c, `${k} ${L('topics', 'chủ đề')} · ${Math.round(k / n * 100)}%`)}></i>`).join('')}</div>`;
  }
  // topic → [{ trainer, pts }]
  function topicIndex() {
    const m = new Map();
    for (const t of data.trainers) for (const p of PTS) for (const [topic, cat] of t.topics[p] || []) {
      const e = m.get(topic) || m.set(topic, { topic, cat, fans: [] }).get(topic);
      e.fans.push({ t, pts: +p });
    }
    return [...m.values()];
  }

  function trainerView() {
    const q = ui.q.trim().toLowerCase(), list = data.trainers.filter(t => !q || t.name.toLowerCase().includes(q));
    const cur = data.trainers.find(t => t.id === ui.trainer) || (q && list.length === 1 ? list[0] : null);
    const picker = `<div class="lg-pick">${list.map(t => `<button class="lg-t ${cur?.id === t.id ? 'on' : ''}" data-lg-trainer="${esc(t.id)}" aria-pressed="${cur?.id === t.id}">${sprite(t)}<small>${esc(t.name)}</small></button>`).join('')
      || `<p class="muted">${L('No trainer matches.', 'Không có trainer nào khớp.')}</p>`}</div>`;
    if (!cur) return `${picker}<p class="muted lg-hint">${L('Pick a trainer to see the topics they like.', 'Chọn một trainer để xem chủ đề họ thích.')}</p>`;
    const all = PTS.flatMap(p => cur.topics[p] || []);
    const pairs = (cur.pairs || []).map(pairById).filter(Boolean);
    return `${picker}
    <section class="box lg-detail" id="lg-detail">
      <div class="lg-head">${sprite(cur)}<div><h2>${esc(cur.name)}</h2>
        <p class="muted">${all.length} ${L('topics', 'chủ đề')} · ${L('by category', 'theo nhóm')}:</p>${catBar(all)}</div>
        ${pairs.length ? `<div class="lg-pairs">${pairs.slice(0, 12).map(p => `<a href="#/pair/${esc(p.id)}" ${tip(`${p.trainer} & ${p.pokemon}`, p.role || '')}>${img(p.pokeSprite, 'sprite', p.pokemon)}</a>`).join('')}${pairs.length > 12 ? `<small class="muted">+${pairs.length - 12}</small>` : ''}</div>` : ''}</div>
      <div class="lg-cols">${PTS.map(p => {
        const items = (cur.topics[p] || []).filter(x => !ui.cat || catOf(x[1]) === ui.cat).sort((a, b) => CAT_ORDER.indexOf(catOf(a[1])) - CAT_ORDER.indexOf(catOf(b[1])) || a[0].localeCompare(b[0]));
        return `<div class="lg-col pts-${p}"><h3><b>${p}</b> ${L('points', 'điểm')} <small>${items.length}</small></h3>
          ${items.map(([topic, c]) => `<button class="lg-topic" style="--c:${CAT_COLOR[catOf(c)]}" data-lg-topic="${esc(topic)}" ${tip(topic, L('See who else likes it', 'Xem ai cũng thích'))}><span>${esc(topic)}</span>${catChip(c)}</button>`).join('') || '<p class="muted">—</p>'}</div>`;
      }).join('')}</div>
    </section>`;
  }

  function topicView() {
    const idx = topicIndex(), q = ui.q.trim().toLowerCase();
    const list = idx.filter(e => (!q || e.topic.toLowerCase().includes(q)) && (!ui.cat || catOf(e.cat) === ui.cat));
    const cur = idx.find(e => e.topic === ui.topic);
    // The topics most trainers give 10 points for: the safest picks
    const top = [...list].map(e => ({ ...e, ten: e.fans.filter(f => f.pts === 10).length })).filter(e => e.ten).sort((a, b) => b.ten - a.ten || b.fans.length - a.fans.length).slice(0, 12);
    const max = top[0]?.ten || 1;
    return `<div class="grid-2 lg-topics">
      <section class="box card">
        <h2 class="section-title">${L('Most loved topics', 'Chủ đề được thích nhất')} <span class="count">${L('trainers giving 10 points', 'số trainer cho 10 điểm')}</span></h2>
        <div class="bars">${top.map(e => `<button class="bar-row lg-bar-row" data-lg-topic="${esc(e.topic)}">
          <span class="lbl" title="${esc(e.topic)}">${esc(e.topic)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${e.ten / max * 100}%;background:${CAT_COLOR[catOf(e.cat)]}"></span></span>
          <span class="val">${e.ten}</span></button>`).join('') || `<p class="muted">—</p>`}</div>
      </section>
      <section class="box card" id="lg-detail">
        ${cur ? `<h2 class="section-title">${esc(cur.topic)} ${catChip(cur.cat)}</h2>
          ${PTS.map(p => { const fans = cur.fans.filter(f => f.pts === +p); return fans.length ? `<h3 class="lg-sub"><b>${p}</b> ${L('points', 'điểm')} <small class="muted">${fans.length}</small></h3>
            <div class="lg-fans">${fans.map(f => `<button class="lg-fan" data-lg-open="${esc(f.t.id)}">${sprite(f.t)}<small>${esc(f.t.name)}</small></button>`).join('')}</div>` : ''; }).join('')}`
          : `<h2 class="section-title">${L('Pick a topic', 'Chọn chủ đề')}</h2><p class="muted">${L('Search or pick a topic to see which trainers like it and how much.', 'Tìm hoặc chọn một chủ đề để xem trainer nào thích và thích bao nhiêu.')}</p>`}
      </section>
    </div>
    <div class="box lg-all"><h2 class="section-title">${L('All topics', 'Tất cả chủ đề')} <span class="count">${list.length}</span></h2>
      <div class="lg-cloud">${list.sort((a, b) => b.fans.length - a.fans.length || a.topic.localeCompare(b.topic)).slice(0, 400).map(e =>
        `<button class="lg-word ${ui.topic === e.topic ? 'on' : ''}" style="--c:${CAT_COLOR[catOf(e.cat)]}" data-lg-topic="${esc(e.topic)}">${esc(e.topic)} <small>${e.fans.length}</small></button>`).join('')}</div></div>`;
  }

  const body = () => (ui.mode === 'topic' ? topicView() : trainerView());
  function redraw(scroll) {
    const el = $('#lg-body'); if (!el) return;
    el.innerHTML = body();
    $$('[data-lg-mode]').forEach(b => b.classList.toggle('on', b.dataset.lgMode === ui.mode));
    $$('[data-lg-cat]').forEach(b => b.classList.toggle('on', b.dataset.lgCat === ui.cat));
    if (scroll) $('#lg-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function render(arg) {
    if (data === undefined) data = extReady('lodge');
    if (data === undefined) {
      loadExt('lodge').then(j => { data = j; }, () => { data = null; }).then(rerender);
      return `<div class="loading"><img src="${PLACEHOLDER}" alt="" class="px-img spin"> ${L('Loading…', 'Đang tải…')}</div>`;
    }
    if (!data) return `<div class="empty">${img(PLACEHOLDER)}${L('The Trainer Lodge data is not available yet.', 'Chưa có dữ liệu Trainer Lodge.')}</div>`;
    if (arg && data.trainers.some(t => t.id === arg)) { ui.mode = 'trainer'; ui.trainer = arg; ui.q = ''; }
    const topics = data.trainers.reduce((a, t) => a + PTS.reduce((b, p) => b + (t.topics[p] || []).length, 0), 0);
    return `
    <h1 class="section-title">Trainer Lodge <span class="count">${data.trainers.length} trainer · ${topics} ${L('topics', 'chủ đề')}</span></h1>
    <p class="prose" style="max-width:820px">${L('What each trainer likes to talk about in the Trainer Lodge: a 10-point topic raises friendship the most, 5 the least. The daily Hot Topic is not listed.',
      'Chủ đề mỗi trainer thích nói chuyện ở Trainer Lodge: chủ đề 10 điểm tăng thân thiết nhiều nhất, 5 điểm ít nhất. Không gồm Hot Topic hằng ngày.')}
      ${L('Source', 'Nguồn')}: <a href="${esc(data.source)}" target="_blank" rel="noopener noreferrer">Serebii ↗</a> · ${L('copied', 'lấy ngày')} ${esc(data.fetched.slice(0, 10))}</p>
    <div class="box filters">
      <div class="filter-line">
        ${[['trainer', L('By trainer', 'Theo trainer')], ['topic', L('By topic', 'Theo chủ đề')]].map(([k, l]) => `<button class="chip ${ui.mode === k ? 'on' : ''}" data-lg-mode="${k}">${l}</button>`).join('')}
        <label class="search">🔍<input id="lg-q" type="search" placeholder="${L('Search a trainer or a topic…', 'Tìm trainer hoặc chủ đề…')}" value="${esc(ui.q)}"></label>
      </div>
      <div class="filter-line"><span class="lab">${L('Category', 'Nhóm')}</span>
        <button class="chip ${!ui.cat ? 'on' : ''}" data-lg-cat="">${L('All', 'Tất cả')}</button>
        ${CAT_ORDER.map(c => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-lg-cat="${c}"><span class="dot" style="background:${CAT_COLOR[c]}"></span>${c}</button>`).join('')}
      </div>
    </div>
    <div id="lg-body">${body()}</div>`;
  }

  document.addEventListener('input', e => { if (e.target.id === 'lg-q') { ui.q = e.target.value; redraw(); } });
  document.addEventListener('click', e => {
    if (!location.hash.startsWith('#/lodge')) return;
    const m = e.target.closest('[data-lg-mode]'), c = e.target.closest('[data-lg-cat]'), t = e.target.closest('[data-lg-trainer]');
    const tp = e.target.closest('[data-lg-topic]'), op = e.target.closest('[data-lg-open]');
    if (m) { ui.mode = m.dataset.lgMode; ui.q = ''; const q = $('#lg-q'); if (q) q.value = ''; redraw(); }
    else if (c) { ui.cat = c.dataset.lgCat; redraw(); }
    else if (t) { ui.trainer = t.dataset.lgTrainer; history.replaceState(null, '', `#/lodge/${ui.trainer}`); redraw(true); }
    else if (tp) { ui.mode = 'topic'; ui.topic = tp.dataset.lgTopic; redraw(true); }
    else if (op) { ui.mode = 'trainer'; ui.trainer = op.dataset.lgOpen; ui.q = ''; history.replaceState(null, '', `#/lodge/${ui.trainer}`); redraw(true); }
  });

  window.DEX.page('lodge', render, () => stagger($('#lg-body')));
})();
