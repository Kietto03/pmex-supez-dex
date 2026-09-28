#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Match special trainer outfits ("(Alt.)", "Sygna Suit …", "(Champion)" …)
   to Pokémon Showdown pixel sprites.

   Showdown names PMEX sprites "<name>-masters", "-masters2", … without saying
   which outfit they are. The in-game icon from pomatools
   (/assets/trainer/<actorId>_128.png) is the ground truth: every candidate
   sprite is scored against it by colour-histogram overlap in headless Chrome.

   Output: .cache/outfits/review.html  — side-by-side sheet to check by eye
           .cache/outfits/scores.json  — scores per pair
   Verified picks are then copied by hand into config/outfit-sprites.json,
   which build.mjs reads. Nothing unverified reaches the site.
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadPomatools } from './pomatools-import.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, '.cache', 'outfits');
// Headless Chrome: $CHROME, else the usual macOS / Windows / Linux install paths
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));
const HEADERS = { 'User-Agent': 'pmex-datamine-dex/1.0 (fan viewer)' };
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'cand'), { recursive: true });

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function download(url, dest) {
  if (fs.existsSync(dest)) return true;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return false;
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  await sleep(120);
  return true;
}

// Showdown's trainer sprite index (directory listing)
const listFile = path.join(OUT, 'showdown-trainers.txt');
if (!fs.existsSync(listFile)) {
  const html = await (await fetch('https://play.pokemonshowdown.com/sprites/trainers/', { headers: HEADERS })).text();
  fs.writeFileSync(listFile, [...html.matchAll(/href="([^"]+)\.png"/g)].map(m => m[1]).join('\n'));
}
const showdown = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);

const poma = loadPomatools(path.join(REPO, '.cache', 'pomatools'), []);
const special = poma.pairs.filter(p => /\(|Sygna Suit|Arc Suit/.test(p.trainer) && p.actorId);

const jobs = [];
for (const p of special) {
  const base = slug(p.trainer.replace(/\(.*?\)/g, '').replace(/Sygna Suit|Arc Suit|^Professor\s+/gi, '').trim());
  // Every Showdown sprite of this character, except old-generation looks that can't be PMEX outfits
  const cands = showdown.filter(n => (n === base || n.startsWith(base + '-')) && !/gen[1-3]|lgpe|anime|jp$/.test(n));
  if (!cands.some(n => n.includes('masters') || /festival|dojo|champion|s$|v$/.test(n.split('-')[1] || ''))) continue;
  const icon = `${p.actorId}.png`;
  if (!await download(`https://www.pomatools.site/assets/trainer/${p.actorId}_128.png`, path.join(OUT, 'icons', icon))) continue;
  for (const c of cands) await download(`https://play.pokemonshowdown.com/sprites/trainers/${c}.png`, path.join(OUT, 'cand', `${c}.png`));
  jobs.push({ trainer: p.trainer, pokemon: p.pokemon, actorId: p.actorId, icon, cands });
}
console.log(`pairs to score: ${jobs.length}`);

// Scoring page: 4-bit-per-channel colour histograms of opaque pixels, compared by intersection
fs.writeFileSync(path.join(OUT, 'score.html'), `<!doctype html><pre id="out">pending</pre><script>
const jobs = ${JSON.stringify(jobs)};
const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
function hist(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, h = new Float32Array(4096); let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 235 && mn > 235) continue;               // background white
    if (mx < 25) continue;                            // outline black
    h[(r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)]++; n++;
  }
  if (n) for (let i = 0; i < h.length; i++) h[i] /= n;
  // light blur across neighbouring bins so near-identical shades still overlap
  const s = new Float32Array(4096);
  for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
    const v = h[r * 256 + g * 16 + b]; if (!v) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const R = r + dr, G = g + dg, B = b + db;
      if (R < 0 || G < 0 || B < 0 || R > 15 || G > 15 || B > 15) continue;
      s[R * 256 + G * 16 + B] += v / 27;
    }
  }
  return s;
}
const overlap = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.min(a[i], b[i]); return t; };
(async () => {
  const res = [];
  for (const j of jobs) {
    const ic = await load('icons/' + j.icon); if (!ic) continue;
    const hi = hist(ic);
    const scored = [];
    for (const c of j.cands) { const im = await load('cand/' + c + '.png'); if (im) scored.push([c, +overlap(hi, hist(im)).toFixed(3)]); }
    scored.sort((a, b) => b[1] - a[1]);
    res.push({ ...j, scored });
  }
  document.getElementById('out').textContent = JSON.stringify(res);
})();
</script>`);

// Serve OUT over localhost so canvas can read pixels (file:// taints the canvas)
const server = http.createServer((req, res) => {
  const f = path.join(OUT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(OUT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'image/png' });
  fs.createReadStream(f).pipe(res);
}).listen(8799);

// Async on purpose: a sync exec would block this process's event loop, so the server above could never answer Chrome
const { stdout: dom } = await promisify(execFile)(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=120000', '--dump-dom',
  'http://localhost:8799/score.html'], { maxBuffer: 64 << 20 });
server.close();
const json = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const results = JSON.parse(json);
fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify(results, null, 1));

// Review sheet: in-game icon | top 3 candidates (score) | default look
fs.writeFileSync(path.join(OUT, 'review.html'), `<!doctype html><meta charset="utf-8"><style>
body{font:12px sans-serif;background:#ddd;margin:4px} .row{display:flex;gap:4px;align-items:center;background:#fff;margin:3px 0;padding:2px}
.row b{width:170px;font-size:11px} img{width:72px;height:72px;image-rendering:pixelated;object-fit:contain;background:#eef}
figure{margin:0;text-align:center;font-size:10px} .idx{width:26px;font-weight:bold}
</style>${results.map((r, i) => `<div class="row"><span class="idx">${i}</span><b>${r.trainer}<br>& ${r.pokemon}</b>
<figure><img src="icons/${r.icon}"><br>game</figure>${r.scored.slice(0, 4).map(([c, s]) => `<figure><img src="cand/${c}.png"><br>${c} ${s}</figure>`).join('')}</div>`).join('')}`);
console.log(`scored ${results.length} → ${path.relative(REPO, OUT)}/review.html`);
