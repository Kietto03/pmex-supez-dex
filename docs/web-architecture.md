# Kiến trúc web

```
datamine/              clone riêng của absolutelypm/pokemas-datamine (2.xx/*.txt) — gitignore, chỉ đọc
scripts/
├── build.mjs              parse datamine/2.xx/*.txt (+ cache PoMaTools) → site/data/, tải sprite → site/assets/
├── crawl-pomatools.mjs    crawl pomatools.site → .cache/pomatools/
├── pomatools-import.mjs   chuyển cache PoMaTools sang format pair của build
└── match-outfits.mjs      chấm điểm sprite Showdown so với ảnh outfit trong game → .cache/outfits/
config/
├── outfit-sprites.json          bảng outfit → sprite ĐÃ XÁC MINH (build đọc file này)
├── custom-trainer-sprites.json  tên trainer → sprite tự thêm (ưu tiên cao nhất)
└── trainer-sprites/             sprite tự thêm 80px (+ source/ ảnh gốc)
site/                      web tĩnh — deploy nguyên thư mục này
├── index.html             khung trang: topbar, <main id="view">, tooltip, script
├── app.js                 toàn bộ UI (vanilla JS, không framework, không bundler)
├── styles.css             theme + component CSS
├── data/data.js           GENERATED — window.PMEX_DATA: bản tóm tắt mọi pair + scout + gym
├── data/pairs/<id>.js     GENERATED — chi tiết từng pair, tải khi mở trang pair
└── assets/                GENERATED
    ├── pokemon/*.png          sprite gen5 (Pokémon Showdown), gồm cả Mega/form
    ├── pokemon-shiny/*.png    sprite shiny (gen5-shiny)
    ├── trainers/*.png         sprite trainer (trang phục mặc định, trang phục riêng khi đã xác minh)
    ├── items/*.png            icon Poké Ball / item (PokéAPI)
    └── .missing.json          cache URL 404 (gitignored)
.cache/                    crawl thô + bảng đối chiếu outfit (gitignored)
docs/                      tài liệu này
.claude/skills/            skill /update-datamine-web
package.json               lệnh npm: setup-data, update-data, crawl, build, match-outfits, serve
```

Thư mục datamine mặc định là `./datamine`; đổi bằng biến môi trường `PMEX_DATAMINE=/đường/dẫn` khi chạy build.

Không có dependency npm. Chỉ cần Node ≥ 18 (dùng `fetch` có sẵn) để build.

## Data model (`window.PMEX_DATA`)

```js
{
  builtAt, versions: ['2.71', ...],
  pairs: [{
    key, number, trainer, pokemon, gender, shiny, form, version, versions[],
    role, exRole, type, weakness, rarity, expedition, method, itemExchange, collectInfo, exColor,
    teamSkills[], dates: { 'Sync Pair', 'EX Effect', 'EX Role', 'Superawakened' },
    moves[{ slot, name, type, category, user, description, power, accuracy, gauge, target, effectTag, maxUses }],
    syncMove, teraMoves[], megaMoves[],
    passives[{ slot, master, name, description }], superPassive, teraPassives[],
    stats: { '1': {HP, Attack, ...}, '140', '150', '200' }, megaStats,
    grid: [{ n, q, r, s, energy, orbs, req[], move, color, title, description, version }],
    gridOnly?, gridVersion?, pokeSprite, trainerSprite,
    altForms[{ kind: 'mega'|'form', pokemon, form, shiny, scale, stats }], altSprites[{ kind, label, sprite, stats }], teraType, actorId, pomaId,
  }],
  scouts: [{ id, month, version, title, tags[], blurb, scoutType, points,
             rateUp[{ raw, trainer, pokemon, ..., pokeSprite, trainerSprite }],
             presents[], options[{ label, tier, cost, limit, points, gift[] }], start, end, endText }],
  gyms: [{ name, version, circuits[{ name, pts, kind, ball }], phases[{ name, icon, start, end }],
           tickets[], stages[{ name, leaders[{ name, type, title, theme, rule, rules[],
           units[{ pos, weakness, hp, atk, def, spa, spd, spe, focus[], reduction, reductionMods[], passives[] }] }] }],
           rotateNote, ranking[{ label, items[] }], score[{ pts, tag, items[] }], leaderSprites{} }],
}
```

`pairs[]` trong `data.js` chỉ là **bản tóm tắt** (id, tên, role, type, rarity, ngày, stats, sprite, `gridCount`, `source`…). Bản đầy đủ nằm ở `data/pairs/<id>.js` dạng `window.PMEX_PAIR_LOADED(id, {...})`, được `loadPairDetail()` chèn bằng thẻ `<script>` (chạy được cả khi mở file trực tiếp, không cần server). `id` được tạo lúc build (duy nhất, dùng trong URL `#/pair/<id>`).

`app.js` thêm lúc chạy: `p.roleBase` (`Strike (Physical)` → `Strike`), `p.release`, `p.isPoma` (pair chỉ có từ PoMaTools → nhãn **DB**, không hiện số No.).

## `app.js` — bản đồ code

| Phần | Hàm / hằng chính |
|---|---|
| Hằng số | `TYPE_COLORS`, `ROLES` (màu + icon), `STAT_COLORS`, `GRID_COLORS`, `SCOUT_CATS`, `BALLS`, `THEMES` |
| Helper | `esc` (luôn escape text từ data!), `img` (có fallback Poké Ball), `typeBadge`, `roleBadge`, `tip` (tooltip), `fmtDate` |
| Router | `routes` + `route()`; hash `#/`, `#/pairs`, `#/pair/<id>`, `#/scouts[/<eventId>]`, `#/gym[/<index>]`. Mỗi route trả HTML string; `afterRender[name]` chạy sau khi gắn DOM |
| Home | `renderHome`, `statTile`, `scoutMiniList`, `gymTeaser` |
| Sync Pairs | `pairFilter` state (có `limit`, hiện 120 thẻ/lần), `filteredPairs`, `drawPairFilters`, `drawPairGrid`, `pairCard` |
| Pair detail | `loadPairDetail`, `renderPair`, `pairInfo`, `statsPanel`, `moveCard` (+ `markClamped`), `passiveCard`, `gridView` + `drawGrid` (canvas pixel), `gridPanel` |
| Scouts | `scoutFilter`, `drawScouts`, `monthBlock`, `gantt`, `scoutCard`, `pityInfo`, `scoutCat`, `scoutStatus` |
| Gym | `renderGym`, `ruleClass`, `stageShort`, `hpChart`, `stageDetail`, `gymStage` state |

Sự kiện dùng **event delegation** trên `document` với `data-*` attribute (`data-pf`, `data-sf`, `data-lv`, `data-gc`, `data-cell`, `data-stage`, `data-jump`, `data-set-filter`, `data-theme-id`). Khi thêm nút mới, thêm attribute + nhánh xử lý tương ứng thay vì gắn listener trực tiếp.

Sync Grid vẽ bằng **canvas pixel-art** (`drawGrid`), không phải SVG:
- Mỗi ô là hex pointy-top 14×16 px định nghĩa bằng `HEX_SPAN` (3 hàng nhọn + 10 hàng thân + 3 hàng nhọn); `HEX_MASK` phân loại pixel thành viền / vòng bevel / ruột.
- Vị trí: `x = 16·q + 8·r`, `y = 13·r` (khe 2 px giữa các ô). Icon 5×5 trong `GLYPHS`, bảng màu sáng/gốc/tối trong `GRID_PAL`, ô Sync Move vẽ sọc `RAINBOW`.
- Canvas được phóng to theo **bội số nguyên** (`image-rendering: pixelated`) nên nét luôn vuông.
- Màu theme được đọc từ CSS variables lúc vẽ → **phải gọi lại `drawGrid()`** khi đổi theme, resize, lọc màu, chọn ô (đã nối sẵn).
- Hover/click: bảng `owner` (Int16Array) ánh xạ từng pixel → chỉ số ô; `gridCellAt()` đổi toạ độ chuột sang pixel canvas.

Nút BASE / MEGA / FORM dưới ảnh Pokémon đổi cả sprite lẫn chỉ số (`detail.form` → `statsPanel` lấy `altSprites[i].stats`); không còn nút Mega riêng trong phần chỉ số. Một dạng được giữ nếu sprite **hoặc** chỉ số khác dạng gốc.

B-move: move có `Activation Condition` trong mô tả → class `.bmove`: viền cầu vồng pastel tĩnh chia dải pixel quanh `.mv-top` + góc tam giác bậc thang bên phải (theo mẫu infographic LostMode) + badge `B-MOVE`.

## Cách mở rộng thường gặp

**Loại scout mới** — thêm phần tử vào `SCOUT_CATS` (trước `other`), `test` là regex trên `scoutType`. Thứ tự quan trọng: mục đầu tiên khớp sẽ thắng (vì vậy `EX Master` đứng trước `EX Fair`).

**Luật gym mới** — sửa `ruleClass()` trả thêm `cls`/`short`, thêm class `.mcell.r-xxx` trong `styles.css`, thêm dòng vào `.matrix-legend` trong `renderGym`.

**Role mới** — thêm vào `ROLES` (màu + icon); filter và biểu đồ tự cập nhật.

**Theme mới** — thêm khối `[data-theme="id"] { --bg ... }` trong `styles.css` (copy đủ biến của theme `night`) và thêm `{ id, name, a, b }` vào `THEMES`.

**Hiển thị file datamine mới** (vd Pasio Tower, Stadium):
1. Viết `parseXxx(text)` trong `scripts/build.mjs`, gọi trong vòng lặp `for (const v of versions)`, đưa kết quả vào object `data`.
2. Thêm route trong `routes`, link trong `<nav>` của `index.html` (kèm `data-route`), hàm `renderXxx`.
3. Chạy lại build, kiểm tra như `update-workflow.md`.

## Quy ước style

- Font: `--font-ui` (Pixelify Sans) cho giao diện và **mọi chữ tiếng Việt**; `--font-px` (Press Start 2P) chỉ cho logo, số lớn, nhãn tiếng Anh ngắn — font này **không có dấu tiếng Việt**. `--font-prose` (Nunito) cho mô tả dài.
- Màu luôn dùng biến theme (`--panel`, `--ink`, `--line`, `--accent`, …) để 5 theme đều đúng. Màu cố định chỉ dùng cho type, role, ô grid, tier ball (màu mang nghĩa).
- Khung pixel: `border: var(--bw) solid var(--line)` + `box-shadow: var(--sh) var(--sh) 0 var(--shadow)` (class `.box`).
- Sprite: class `px-img` (`image-rendering: pixelated`).
- Grid item chứa vùng cuộn ngang phải có `min-width: 0` (đã đặt cho `.grid-2 > *` …) nếu không trang bị tràn trên mobile.
