import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../site/i18n.js', import.meta.url), 'utf8');
function load({ saved, search = '', blocked = false } = {}) {
  const store = new Map(saved === undefined ? [] : [['pmex-language', saved]]);
  let destination;
  const context = {
    window: {}, document: { documentElement: {} }, URL, URLSearchParams,
    navigator: { language: 'vi-VN' },
    location: { search, href: `https://example.com/dex/${search}#/settings`, replace: url => { destination = url; },
      reload: () => { destination = `https://example.com/dex/${search}#/settings`; } },
    localStorage: {
      getItem: key => { if (blocked) throw new Error('blocked'); return store.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw new Error('blocked'); store.set(key, value); },
    },
  };
  vm.runInNewContext(source, context);
  return { ...context.window.PMEX_I18N, context, store, destination: () => destination };
}

test('English is the default, independently of browser language', () => {
  const app = load();
  assert.equal(app.language, 'en');
  assert.equal(app.context.document.documentElement.lang, 'en');
  assert.equal(app.text('Cài đặt'), 'Settings');
  assert.equal(load({ saved: 'unsupported' }).language, 'en');
});

test('English covers interface labels and punctuation-sensitive phrases', () => {
  const { text } = load();
  for (const [vi, en] of [
    ['Pair cũ (PoMaTools)', 'Older pairs (PoMaTools)'],
    ['Không có dữ liệu.', 'No data available.'],
    ['Loại pair', 'Pair category'],
    ['BẢN ĐỒ GRID', 'GRID MAP'],
    ['Scout pts để pick-up', 'Scout points for a guaranteed pick'],
    ['Điều kiện theo Circuit', 'Rules by Circuit'],
  ]) assert.equal(text(vi), en);
});

test('Vietnamese localizes only interface literals and retains game terms', () => {
  const app = load({ saved: 'vi' });
  assert.equal(app.language, 'vi');
  assert.equal(app.text('Cài đặt'), 'Cài đặt');
  assert.equal(app.text('G-Max Chi Strike · Arc Suit Gladion · Sync Grid'), 'G-Max Chi Strike · Arc Suit Gladion · Sync Grid');
});

test('template translation never modifies interpolated game data', () => {
  const app = load();
  const gameData = 'Loại pair · G-Max Chi Strike · Bea (Alt.)';
  assert.equal(app.html(['Cùng Trainer: ', ''], gameData), `Same Trainer: ${gameData}`);
  assert.equal(app.html(['Có EX Role: ', ''], 'Support'), 'Has EX Role: Support');
});

test('language selection persists and preserves the current route', () => {
  const app = load({ search: '?v=release&lang=en' });
  app.setLanguage('vi');
  assert.equal(app.store.get('pmex-language'), 'vi');
  assert.equal(app.destination(), 'https://example.com/dex/?v=release#/settings');
  assert.equal(load({ saved: app.store.get('pmex-language') }).language, 'vi');
});

test('blocked storage supports language changes through the URL', () => {
  const app = load({ blocked: true });
  assert.equal(app.language, 'en');
  app.setLanguage('vi');
  const target = new URL(app.destination());
  assert.equal(target.searchParams.get('lang'), 'vi');
  assert.equal(load({ blocked: true, search: target.search }).language, 'vi');
});

test('changing language on the same URL reloads the translated interface', () => {
  const app = load();
  app.setLanguage('vi');
  assert.equal(app.destination(), app.context.location.href);
  assert.equal(app.store.get('pmex-language'), 'vi');
});

test('unsupported and unchanged language choices do not navigate', () => {
  const app = load();
  app.setLanguage('other'); app.setLanguage('en');
  assert.equal(app.destination(), undefined);
});

test('cached HTML without the language module refreshes without losing its pair route', () => {
  const appSource = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  let target;
  const context = { window: {}, URL,
    location: { href: 'https://example.com/dex/?v=old#/pair/bea', replace: url => { target = url; } } };
  vm.runInNewContext(appSource, context);
  assert.equal(target, 'https://example.com/dex/?v=old&ui=settings-1#/pair/bea');
  const message = {};
  context.location.href = target;
  context.document = { getElementById: () => message };
  vm.runInNewContext(appSource, context);
  assert.match(message.textContent, /reload the page/);
});
