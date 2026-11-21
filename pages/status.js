/* ═══════════════════════════════════════════════════════════════
   DATA UPDATES — when each source of the site was last refreshed:
   the datamine build (data/data.js) and the outside sources (data/ext/status.json, scripts/sync-sources.mjs).
   ═══════════════════════════════════════════════════════════════ */
(() => {
  const { D, $, esc, fmtN, fmtDate, L, loadExt, extReady, rerender, stagger } = window.DEX;
  let status;

  const ageDays = iso => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : Infinity);
  const ago = iso => {
    if (!iso) return '—';
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4));
    return m < 2 ? L('just now', 'vừa xong') : m < 120 ? L(`${m} min ago`, `${m} phút trước`)
      : m < 2880 ? L(`${Math.round(m / 60)} h ago`, `${Math.round(m / 60)} giờ trước`) : L(`${Math.round(m / 1440)} days ago`, `${Math.round(m / 1440)} ngày trước`);
  };
  // fresh | stale | failed | never
  const health = s => (!s?.lastOk ? (s?.ok === false ? 'failed' : 'never') : s.ok === false ? 'failed' : ageDays(s.lastOk) > s.staleAfterDays ? 'stale' : 'fresh');
  const STATE = {
    fresh: { c: 'var(--good)', l: L('Up to date', 'Mới') },
    stale: { c: '#e0a100', l: L('Getting old', 'Hơi cũ') },
    failed: { c: 'var(--danger)', l: L('Last update failed', 'Lần cập nhật cuối bị lỗi') },
    never: { c: 'var(--ink-3)', l: L('Not fetched yet', 'Chưa lấy') },
  };

  function row(s, extra = '') {
    const h = health(s), st = STATE[h];
    return `<article class="box src-row" style="--sc:${st.c}">
      <span class="src-dot" aria-hidden="true"></span>
      <div class="src-main">
        <h3>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>` : esc(s.label)}</h3>
        <p class="muted">${esc(s.error || s.note || '')}${extra}</p>
      </div>
      <div class="src-when"><b style="color:${st.c}">${st.l}</b><span>${L('Last good', 'Lần tốt gần nhất')}: ${s.lastOk ? `${fmtDate(s.lastOk.slice(0, 16))} · ${ago(s.lastOk)}` : '—'}</span>
        ${s.items != null ? `<span>${fmtN(s.items)} ${L('items', 'mục')}</span>` : ''}</div>
    </article>`;
  }

  function render() {
    if (status === undefined) status = extReady('status');
    if (status === undefined) {
      loadExt('status').then(j => { status = j; }, () => { status = null; }).then(rerender);
      return `<div class="loading"><img src="assets/items/poke-ball.png" alt="" class="px-img spin"> ${L('Loading…', 'Đang tải…')}</div>`;
    }
    const datamine = { label: L(`Datamine build (v${D.versions.join(', v')})`, `Bản build datamine (v${D.versions.join(', v')})`), url: 'https://github.com/absolutelypm/pokemas-datamine',
      ok: true, lastOk: `${D.builtAt}`, staleAfterDays: 14, items: D.pairs.length,
      note: L(`Sync pairs, grids, scouts and Gym Battles · ${D.scouts.length} scouts · rebuilt when the datamine changes`, `Sync pair, grid, scout và Gym Battle · ${D.scouts.length} scout · build lại khi datamine đổi`) };
    const sources = Object.values(status?.sources || {});
    return `
    <h1 class="section-title">${L('Data updates', 'Cập nhật dữ liệu')}</h1>
    <p class="prose" style="max-width:820px">${L('Where each page’s data comes from and when it was last refreshed. The datamine is rebuilt when the dataminer publishes a change; the outside sources are checked every 6 hours, and a source that fails keeps its last good copy.',
      'Nguồn dữ liệu của từng trang và lần cập nhật gần nhất. Datamine được build lại khi dataminer cập nhật; các nguồn ngoài được kiểm tra mỗi 6 giờ, nguồn nào lỗi thì giữ bản tốt gần nhất.')}</p>
    <div class="src-list">
      ${row(datamine)}
      ${sources.map(s => row(s)).join('') || `<p class="muted">${L('The outside sources have not been fetched yet.', 'Chưa lấy dữ liệu từ các nguồn ngoài.')}</p>`}
    </div>
    <p class="muted" style="font-size:13px">${L('Fan project. Community sheets belong to their authors; game data © DeNA / The Pokémon Company.', 'Dự án fan. Các sheet cộng đồng thuộc về người làm; dữ liệu game © DeNA / The Pokémon Company.')}</p>`;
  }

  window.DEX.page('status', render, () => stagger($('.src-list')));
})();
