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
├── gvg.js                 tab GvG — theo dõi guild trong Pasio Gym Battle (xem mục GvG), nạp sau app.js
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
test/                      test trình duyệt cho GvG: gvg.test.html (logic) + gvg.e2e.html (thao tác UI)
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
    role, exRole, type, weakness, rarity, expedition, method, category, itemExchange, collectInfo, exColor,
    teamSkills[], dates: { 'Sync Pair', 'EX Effect', 'EX Role', 'Superawakened' },
    moves[{ slot, name, type, category, user, description, power, accuracy, gauge, target, effectTag, maxUses }],
    syncMove, teraMoves[], megaMoves[],
    passives[{ slot, master, name, description }], superPassive, teraPassives[],
    stats: { '1': {HP, Attack, ...}, '140', '150', '200' }, megaStats,
    grid: [{ n, q, r, s, energy, orbs, req[], move, color, title, description, version }],
    gridOnly?, gridVersion?, pokeSprite, trainerSprite,
    altForms[{ kind, pokemon, form, label?, shiny, scale, stats, moves?, syncMove?, passives?, maxMoves?, teraType?, teraMoves? }],
    altSprites[{ kind, label, sprite, stats, moves?, syncMove?, passives?, maxMoves?, teraType?, teraMoves?, extraMoves? }],
    mechanics[],  // tập con của 'mega' | 'tera' | 'dynamax' | 'gigantamax' | 'form'
    teraType, actorId, pomaId,
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
| Sync Pairs | `PF_GROUPS` (định nghĩa bộ lọc), `pairFilter` state, `filteredPairs(skip)`, `pfGroup`, `drawPairFilters`, `drawPairGrid`, `pairCard` — xem mục **Bộ lọc Sync Pairs** |
| Pair detail | `loadPairDetail`, `renderPair`, `pairInfo`, `statsPanel`, `moveCard` (+ `markClamped`), `passiveCard`, `gridView` + `drawGrid` (canvas pixel), `gridPanel` |
| Scouts | `scoutFilter`, `drawScouts`, `monthBlock`, `gantt`, `scoutCard`, `pityInfo`, `scoutCat`, `scoutStatus` |
| Gym | `renderGym`, `ruleClass`, `stageShort`, `hpChart`, `stageDetail`, `gymStage` state |

Sự kiện dùng **event delegation** trên `document` với `data-*` attribute (`data-pf`, `data-pf-clear`, `data-pf-reset`, `data-pf-toggle`, `data-sf`, `data-lv`, `data-gc`, `data-cell`, `data-stage`, `data-jump`, `data-set-filter`, `data-theme-id`). Khi thêm nút mới, thêm attribute + nhánh xử lý tương ứng thay vì gắn listener trực tiếp.

Sync Grid vẽ bằng **canvas pixel-art** (`drawGrid`), không phải SVG:
- Mỗi ô là hex pointy-top 14×16 px định nghĩa bằng `HEX_SPAN` (3 hàng nhọn + 10 hàng thân + 3 hàng nhọn); `HEX_MASK` phân loại pixel thành viền / vòng bevel / ruột.
- Vị trí: `x = 16·q + 8·r`, `y = 13·r` (khe 2 px giữa các ô). Icon 5×5 trong `GLYPHS`, bảng màu sáng/gốc/tối trong `GRID_PAL`, ô Sync Move vẽ sọc `RAINBOW`.
- Canvas được phóng to theo **bội số nguyên** (`image-rendering: pixelated`) nên nét luôn vuông.
- Màu theme được đọc từ CSS variables lúc vẽ → **phải gọi lại `drawGrid()`** khi đổi theme, resize, lọc màu, chọn ô (đã nối sẵn).
- Hover/click: bảng `owner` (Int16Array) ánh xạ từng pixel → chỉ số ô; `gridCellAt()` đổi toạ độ chuột sang pixel canvas.

Nút BASE / MEGA / TERA / DMAX / G-MAX (E-MAX cho Eternatus) / FORM (gồm cả Primal, Zygarde Complete, Ultra Necrozma) dưới ảnh Pokémon (`MECHANICS` trong `app.js`) đổi sprite, chỉ số, **moves và passives** (`detail.form` → `statsPanel`, `movesPanel`, `passivesPanel`, đều đọc qua `formView(p)`):
- `altSprites[i].moves` / `.passives` lưu **theo slot**: `null` = giống dạng thường, còn lại là move/passive thay vào slot đó (mang chip của dạng đó — MEGA, TERA, D-MAX, G-MAX, E-MAX, FORM — và khung viền riêng `.mech-<kind>` trong `styles.css`). Ví dụ Deoxys: mỗi forme có bộ move + passive riêng.
- Dynamax / Gigantamax: `maxMoves[]` mỗi move có `from` (tên move gốc) và `fromSlot` → Max Move thế chỗ đúng slot của move gốc; Sync Move ẩn (dữ liệu dạng Dynamax không có). Gigantamax dùng sprite `<tên>-gmax` (Urshifu Rapid Strike: `urshifu-rapidstrikegmax`, Eternatus: `eternatus-eternamax`); Dynamax thường giữ sprite gốc, trang thêm viền đỏ (`.fx-dynamax`).
- Tera: `teraMoves` hiện ở hàng đặc biệt, passive Tera thay theo slot; sprite Terastal riêng khi Showdown có (Ogerpon `-<mask>tera`, Terapagos `-stellar`).
- `extraMoves`: Mega Moves của datamine (pair chỉ có trong datamine).

Một dạng được giữ nếu sprite, chỉ số, move hoặc passive khác dạng gốc, hoặc là Tera / Dynamax. `mechanics[]` (có trong `data.js`) sinh cờ trên thẻ pair và bộ lọc **Mechanic** ở trang Sync Pairs. `data.js` chỉ giữ `altSprites` rút gọn (kind, label, sprite, stats); move/passive theo dạng nằm trong `data/pairs/<id>.js`.

B-move: move có `Activation Condition` trong mô tả → class `.bmove`: viền cầu vồng pastel tĩnh chia dải pixel quanh `.mv-top` + góc tam giác bậc thang bên phải (theo mẫu infographic LostMode) + badge `B-MOVE`.

## Bộ lọc Sync Pairs

Trang `#/pairs` gồm sidebar bộ lọc (`.pf-side`, sticky) + thanh công cụ (tìm kiếm, sắp xếp) + hàng chip đang lọc + lưới thẻ. Dưới 900px sidebar ẩn sau nút **☰ Bộ lọc (n)**.

Mỗi nhóm lọc là một phần tử trong `PF_GROUPS`:

```js
{ id, label, mode: 'or' | 'and', swatch?, custom?,
  options: pool => [{ v, label, c?, icon? }],   // lựa chọn hiển thị
  test: (pair, v) => boolean }                  // pair có khớp lựa chọn v không
```

| Nhóm | id | Kiểu | Ghi chú |
|---|---|---|---|
| Role | `role` | or | checkbox "Tính cả EX Role" (`pairFilter.exAsRole`) |
| EX Role | `exrole` | or | có lựa chọn "Không có" |
| Type / Weakness | `type` / `weak` | or | chip có ô màu type |
| Rarity | `rarity` | or | |
| Mechanic | `mech` | or | Dynamax gồm cả Gigantamax |
| Đặc điểm | `feat` | and | Superawakened, Có EX Role, EX Color, Shiny, Sắp ra |
| Loại pair | `cat` | or | `PAIR_CATS` theo `p.category` (Master Fair, EX Master Fair, Arc Suit, Poké Fair, EX Poké Fair, Seasonal, Special Costume, Variety, Mix, Academy, Gym, General, Chưa rõ) |
| Năm ra mắt | `year` | or | lấy từ ngày Sync Pair |
| Nguồn / Version | `src` | or | version datamine + "Pair cũ (DB)"; checkbox hiện Grid expansion |
| Team Skill | `theme` | and | `custom`: ô gõ + datalist, chủ đề = team skill bỏ chữ role cuối ("Gym Leader Support" → "Gym Leader") |

- Trong một nhóm `or`: khớp **bất kỳ** lựa chọn; nhóm `and`: khớp **tất cả**. Giữa các nhóm luôn là AND.
- **Số đếm cạnh mỗi lựa chọn là faceted count**: nhóm `or` đếm trên kết quả của mọi bộ lọc *khác* (`filteredPairs(g)`), nhóm `and` đếm trên kết quả hiện tại. Lựa chọn ra 0 kết quả bị làm mờ và khoá.
- Tìm kiếm: mọi từ phải xuất hiện trong trainer, pokémon, form, type, weakness, role, EX role, cách nhận, Tera type, team skill, mechanic (chuỗi ghép được cache ở `p._hay`). Gõ phím được debounce 120 ms; ô tìm kiếm không bị vẽ lại nên không mất focus.
- Sắp xếp (`PF_SORTS`): mới nhất, cũ nhất, số No., tên, type, tổng chỉ số Lv.200, grid lớn nhất.
- Xoá: ✕ trên từng chip đang lọc, ✕ ở tiêu đề nhóm (`data-pf-clear`), "Xoá tất cả" (`data-pf-reset`, giữ nguyên kiểu sắp xếp). Nhóm nào đang gập được nhớ trong `pairFilter.collapsed`.
- Widget trang Home đặt sẵn bộ lọc bằng `data-set-filter="<groupId>:<value>"`.

## Cách mở rộng thường gặp

**Loại scout mới** — thêm phần tử vào `SCOUT_CATS` (trước `other`), `test` là regex trên `scoutType`. Thứ tự quan trọng: mục đầu tiên khớp sẽ thắng (vì vậy `EX Master` đứng trước `EX Fair`).

**Luật gym mới** — sửa `ruleClass()` trả thêm `cls`/`short`, thêm class `.mcell.r-xxx` trong `styles.css`, thêm dòng vào `.matrix-legend` trong `renderGym`.

**Role mới** — thêm vào `ROLES` (màu + icon); filter và biểu đồ tự cập nhật.

**Bộ lọc mới** — thêm một phần tử vào `PF_GROUPS` (xem mục dưới); sidebar, số đếm, chip đang lọc và nút xoá tự có.

**Loại pair mới** — thêm mã vào `CATEGORIES` (`scripts/pomatools-import.mjs`), regex vào `METHOD_CATEGORY` (`scripts/build.mjs`) nếu datamine có cách ghi riêng, và một dòng `PAIR_CATS` (nhãn + màu) trong `app.js`. Trang pair hiện loại pair ở tag màu trên hero và ô "Loại pair"; ô "Cách nhận (datamine)" là nguyên văn dòng `Method:`.

**Theme mới** — thêm khối `[data-theme="id"] { --bg ... }` trong `styles.css` (copy đủ biến của theme `night`) và thêm `{ id, name, a, b }` vào `THEMES`.

**Hiển thị file datamine mới** (vd Pasio Tower, Stadium):
1. Viết `parseXxx(text)` trong `scripts/build.mjs`, gọi trong vòng lặp `for (const v of versions)`, đưa kết quả vào object `data`.
2. Thêm route trong `routes`, link trong `<nav>` của `index.html` (kèm `data-route`), hàm `renderXxx`.
3. Chạy lại build, kiểm tra như `update-workflow.md`.

## GvG — theo dõi guild (`gvg.js`)

Dựng lại tính năng của [gvg-app](https://github.com/Sh1n-Gh/gvg-app) (Express + SQLite + đăng nhập) thành một tab của web tĩnh, theo spec `PRD-FINAL.md` + `PAIR-TEAM-LOG-SPEC.md` của repo đó (không chép code — repo không có license).

**Cấu hình mùa lấy từ datamine** (`D.gyms`), không cần Master Admin:

| gvg-app | Ở đây |
|---|---|
| 8 map + type | 8 Gym Leader của stage đầu (`stages[0].leaders`), kèm weakness của unit |
| Round + `max_score` | `circuits[n-1].pts` (Circuit 1–3, Extra Battle 1…) |
| `repeat_max_score` | circuit cuối tên "… and onward" → lặp điểm cuối; nhãn `Extra Battle <N+k>`; luật xoay `leader.rules[(n - số stage) % 3]` |
| `battle_start_at` | phase `Battle` (giờ datamine là **UTC**, 06:00 = reset) |
| vé ngày 1 / mỗi ngày / số ngày | theo thông báo chính thức ([Update_8010_1W_2](https://pokemonmasters-game.com/en-US/announcements/Update_8010_1W_2)): **9 vé lúc mở Battle, +3 mỗi ngày đến hết Battle, tối đa 30 vé/người, cả Gym dùng tối đa 600 vé** — mặc định trong `TICKET_DEFAULT`, sửa được theo mùa (`days` để trống = tính từ độ dài phase Battle) |
| `tickets_used` 1–3 | Circuit thường (`kind` "Regular Battle") **luôn 3 vé/lượt**; từ Extra Battle chọn ×1/×2/×3 (thời gian + Sync buff từ `gym.tickets`) — `round(n).fixed` |

**Chỉ lưu dữ kiện gốc, mọi thứ khác tính lại mỗi lần vẽ** (`gvgCtx`): điểm từng (round, map), chuỗi round (round đầu tiên chưa đủ 8 map = active), vé đã phát `day1 + daily × min(ngày đã qua, days)`, Combined Score (bỏ điểm người bị khoá; tiến độ map vẫn tính họ). Vì không lưu `current_points`/`round_status` nên không có transaction/recompute và không thể lệch khi sửa/xoá lượt — round đã xong tự mở lại nếu điểm tụt.

**Kiểm tra khi ghi** (`gvgValidate`, giống Edge Case Matrix của PRD): vé 1–3 (đúng 3 ở Circuit thường), còn vé của người đó và của cả Gym (600), điểm nguyên dương, lượt mới chỉ cho round đang mở, người bị khoá không ghi mới, đủ vé, không vượt trần (báo còn thiếu bao nhiêu), team 1–3 pair không trùng, Move Level ≤ 5/5 nếu pair không có Superawakened (6/5–10/5 = SA1–5), EXR chỉ khi pair có EX Role, Lv 1–200. Sửa lượt: loại trừ chính lượt đó khi tính vé/trần.

**Dữ liệu** (`localStorage['pmex-gvg']`):

```js
{ v: 1, active, seasons: [{ id, guild, gym, tickets: { day1, daily, days }, u,
  members: [{ id, name, banned, u }],
  entries: [{ id, at, u, m, r, map, t, p, team: [{ id, name, ml, lv, ex }] }],  // team = snapshot lúc ghi
  profiles: { memberId: { pairId: { ml, lv, ex } } },                           // invest gần nhất để tự điền
  notes: { leaderName: text },                                                   // ghi chú chiến thuật từng map (≈ `note` của map bên gvg-app)
  gone: [id…] }] }                                                              // tombstone cho gộp file
```

- **Chia sẻ**: Export/Import JSON; Import *gộp* hợp nhất theo `id` (bản có `u` mới hơn thắng, `gone` lan truyền việc xoá) để nhiều admin nhập song song. Link chỉ-xem `#/gvg/v~<deflate-raw + base64url của mùa>` (không dùng `/` để hợp router); mở ra chỉ có Dashboard + Lịch sử, nút "Lưu vào máy của tôi" gộp vào dữ liệu local.
- **Mùa mới** chép roster cũ trừ người bị khoá; mùa cũ giữ để xem lại.
- Dashboard: điểm yếu (weakness của các unit) đóng khung riêng trên từng map; nút "＋ Ghi lượt" mở form với map chọn sẵn; mục "Còn vé" liệt kê người còn vé (bấm để ghi cho người đó); 📝 ghi chú theo map.
- Team: ô tìm pair xếp hạng theo spec (trainer bắt đầu bằng → pokémon bắt đầu bằng → chứa → pair thành viên vừa dùng), 10 kết quả; "Dùng lại team gần nhất".
- `app.js` boot chạy ở `DOMContentLoaded` để `gvg.js` (nạp sau) kịp đăng ký `routes.gvg`.

Test: chạy `python -m http.server 8765` ở **thư mục gốc repo**, mở `/test/gvg.test.html` (34 kiểm tra logic: round chain, lặp/xoay luật, vé 9+3/ngày, trần 30/người & 600/Gym, 3 vé cố định ở Circuit thường, ban, reopen, share, gộp) và `/test/gvg.e2e.html` (13 bước thao tác thật trong iframe — ghi đè dữ liệu GvG của origin localhost). Mọi dòng phải là PASS.

## Quy ước style

- Font: `--font-ui` (Pixelify Sans) cho giao diện và **mọi chữ tiếng Việt**; `--font-px` (Press Start 2P) chỉ cho logo, số lớn, nhãn tiếng Anh ngắn — font này **không có dấu tiếng Việt**. `--font-prose` (Nunito) cho mô tả dài.
- Màu luôn dùng biến theme (`--panel`, `--ink`, `--line`, `--accent`, …) để 5 theme đều đúng. Màu cố định chỉ dùng cho type, role, ô grid, tier ball (màu mang nghĩa).
- Khung pixel: `border: var(--bw) solid var(--line)` + `box-shadow: var(--sh) var(--sh) 0 var(--shadow)` (class `.box`).
- Sprite: class `px-img` (`image-rendering: pixelated`).
- Grid item chứa vùng cuộn ngang phải có `min-width: 0` (đã đặt cho `.grid-2 > *` …) nếu không trang bị tràn trên mobile.
