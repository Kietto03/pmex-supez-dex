# Quy trình cập nhật khi có datamine mới

Làm theo thứ tự. Mỗi bước có cách kiểm tra — đừng bỏ qua bước kiểm tra, parser dựa trên format text nên dễ âm thầm bỏ sót dữ liệu khi format đổi.

## 1. Kéo dữ liệu mới

```bash
npm run update-data            # = git -C datamine pull (lần đầu: npm run setup-data)
git -C datamine log --oneline -5   # xem dataminer vừa thêm gì
```

- Version mới là thư mục mới trong `datamine/`, tên đúng dạng `2.74` (regex `^\d+\.\d+$`). Thư mục khác tên sẽ bị bỏ qua.
- Tên file phải **kết thúc** bằng các đuôi sau (emoji đầu tên không quan trọng):

| Nguồn | Pattern tên file (trong `scripts/build.mjs`) |
|---|---|
| Trainer | `/Trainer\.txt$/` |
| Grid | `/Grid\.txt$/` |
| Scout | `/Sync Pair Scout\.txt$/` |
| Gym | `/Pasio Gym Battle No\.\s*\d+/` (có thể nhiều file, mỗi file 1 gym) |

  Nếu file được đặt tên khác (vd thiếu `.txt`), đổi tên file hoặc sửa pattern trong `read(...)` / vòng lặp gym ở cuối `scripts/build.mjs`.

## 1b. (Tuỳ chọn) Làm mới dữ liệu pair cũ từ PoMaTools

```bash
npm run crawl -- --refresh   # tải lại index + en.json, chỉ tải file pair mới
```

Chậm có chủ đích (2 request song song, nghỉ 250ms). Nếu không có cache `.cache/pomatools/`, build vẫn chạy nhưng chỉ có pair từ datamine. Chi tiết format: `data-formats.md` → PoMaTools.

## 2. Build

```bash
npm run build
```

Output mẫu:

```
versions: 2.71, 2.72, 2.73
pairs: 669 (grid-only: 0, from pomatools: 631, overlap 35)
scouts: 92, gyms: Pasio Gym Battle No. 3, Pasio Gym Battle No. 4
missing pokemon sprites (0): none
missing trainer sprites (0): none
→ site/data/data.js (1039 KB)
```

Kiểm tra:
- [ ] `versions` có version mới.
- [ ] `pairs` tăng đúng bằng số dòng trong danh sách đầu `👤 Trainer.txt` của version mới (khối `=====` đầu file).
- [ ] `grid-only` = các pair chỉ có mở rộng grid (header Grid.txt ghi `Cell 49 - 54`, không có trong Trainer.txt). Bình thường.
- [ ] `scouts` tăng; `gyms` có gym mới nếu có file gym.
- [ ] `overlap` (số pair có ở cả hai nguồn) không tụt mạnh — nó là dữ liệu để học nhãn target/category.
- [ ] `missing ... sprites` — xem mục 4. Trainer riêng của PMEX mà Showdown không có (Lear, Rachel, Sawyer, Looker…) dùng sprite tự thêm trong `config/custom-trainer-sprites.json`.
- [ ] Tên trainer datamine khác tên trong game/PoMaTools (vd `Player` = **Scottie**) → thêm vào `TRAINER_RENAMES` trong `scripts/build.mjs`, nếu không sẽ bị tách thành 2 pair trùng và thiếu sprite.

## 3. Soát dữ liệu đã parse

Chạy nhanh để thấy từng pair có đủ move / passive / grid (đọc file chi tiết `data/pairs/*.js`, vì `data.js` chỉ còn bản tóm tắt). Thay `2.74` bằng version mới:

```bash
cd site && node -e '
const fs=require("fs");global.window={};require("./data/data.js");
window.PMEX_PAIR_LOADED=(id,p)=>global.P=p;
for (const s of window.PMEX_DATA.pairs.filter(p=>(p.versions||[]).includes("2.74"))) {
  require("./data/pairs/"+s.id+".js");
  console.log(P.trainer, "&", P.pokemon, "| role:", P.role, P.exRole||"", "| type:", P.type,
    "| moves:", P.moves?.length, "sync:", !!P.syncMove, "passives:", P.passives?.length,
    "| grid:", P.grid.length, "| release:", P.dates?.["Sync Pair"]);
}'
```

Dấu hiệu parser bị lệch format:
- `role`/`type` rỗng ở pair **không** phải grid-only.
- `moves: 0` hoặc thiếu `sync` (trừ pair đặc biệt — xem `data-formats.md`, ví dụ Juliana chỉ có 1 move).
- `grid` = 0 với pair mới.
- Ô grid có `title` là một câu dài / là dòng requirement → xem quy tắc title/description trong `data-formats.md`.

Scout:

```bash
node -e 'global.window={};require("./data/data.js");for(const e of window.PMEX_DATA.scouts.filter(s=>s.version==="2.74"))console.log(e.month,e.id,"|",e.title,"|",e.scoutType,"|",e.rateUp.map(r=>r.trainer).join(", "),"|",e.options.length,"opts",e.start,e.end)'
```

- [ ] Mỗi banner có `title`, `scoutType`, `start`. `end` = null nghĩa là "No end date".
- [ ] Loại scout mới (không khớp `SCOUT_CATS` trong `app.js`) sẽ rơi vào nhóm **Other** → thêm regex (xem `web-architecture.md`).

Gym:

```bash
node -e 'global.window={};require("./data/data.js");const g=window.PMEX_DATA.gyms.at(-1);console.log(g.name,g.phases.length,"phases",g.stages.length,"stages");for(const s of g.stages)console.log(s.name,s.leaders.map(l=>l.name+":"+(l.theme||l.rules.join("/"))).join(" | "))'
```

- [ ] 4 phase (Announce/Battle/Ranking/Reward), đủ circuit, mỗi circuit đủ leader.
- [ ] Theme/Rules mới (khác "Zero physical/special damage", "P-move power ↑", "zero damage when not super effective") → cập nhật `ruleClass()` trong `app.js` + CSS + legend.

## 4. Sprite còn thiếu

`scripts/build.mjs` tải sprite từ Pokémon Showdown, thử lần lượt nhiều tên:
- Pokémon: `pokemonCandidates()` → `chiyu`, `dialga-origin`, … (tên viết thường, bỏ ký tự đặc biệt; form Origin/Alola/Galar/Hisui/Paldea thêm hậu tố).
- Trainer: `trainerCandidates()` theo quy tắc trang phục:
  - **Tên không kèm gì** (`Cynthia`) → chỉ trang phục mặc định: `<tên>`, `<tên>-s`, `-gen9` … `-gen3`, cuối cùng mới đến `-masters` (cho trainer chỉ có sprite PMEX).
  - **Tên kèm trang phục** (`(Alt.)`, `(Fall 2026)`, `(Champion)`, `Sygna Suit …`, `Arc Suit …`) → sprite trang phục riêng **đã xác minh** trong `config/outfit-sprites.json` (tên trainer → id Showdown), rồi các quy tắc theo mô tả (`Festival of Masks`/`jinbei` → `-festival`, `Dojo Uniform` → `-dojo`, `(Champion)` → `-champion`); không có thì dùng trang phục mặc định.
  - Bảng đã xác minh luôn được xét **trước** mọi quy tắc khác.
  - Trainer lớp chung (`Linnea (Furisode Girl)`) → sprite của lớp (`furisodegirl-*`); chỉ áp dụng cho danh sách lớp cố định (Furisode Girl, Poké Kid, Hex Maniac, Hiker, Sightseer), vì `(Academy)`, `(Kimono)`… là tên trang phục chứ không phải lớp. Bí danh trong `TRAINER_ALIASES` (The Masked Royal → Kukui…).
  - Rate-up trong scout dùng lại sprite của pair cùng tên.
- Pokémon shiny (✨ trong tên datamine / `isShiny` của PoMaTools) → thư mục `gen5-shiny` của Showdown, lưu ở `site/assets/pokemon-shiny/`.
- Form (`Midnight Form`, `Origin Forme`, `Type Change: Fire`…) → hậu tố Showdown qua bảng `FORM_SUFFIX` trong `scripts/build.mjs`. Mega/Primal (`Mega Charizard X` → `charizard-megax`, `Primal Groudon` → `groudon-primal`) và form đổi trong trận → `altSprites`, hiện thành các nút BASE / MEGA / FORM trên trang pair. Form chỉ đổi Tera type / trước-sau sync không đổi hình nên bị bỏ qua.

### Xác minh trang phục đặc biệt

```bash
npm run match-outfits    # tải ảnh game (PoMaTools) + sprite Showdown, chấm điểm màu
open .cache/outfits/review.html # mỗi dòng: ảnh trong game | 4 ứng viên tốt nhất (điểm)
```

Ảnh trong game chỉ là **chân dung** (đầu/vai), nên đối chiếu theo mũ, tóc, cổ áo, màu chủ đạo. Bảng hiện có **163** outfit đã xác minh (135 ở lần duyệt đầu + 28 ở lần soát lại ngày 2026-09-28).

Lần soát lại liệt kê mọi pair có outfit riêng mà vẫn đang dùng sprite mặc định, rồi so ảnh game với **mọi** sprite Showdown cùng tên chưa được dùng (72 pair), theo hai bước: bảng thu nhỏ để lọc, rồi bảng phóng to 2x để chốt. Kinh nghiệm rút ra:
- Sprite **Arc Suit** trên Showdown có hiệu ứng cánh sáng kiểu Arceus (`steven-masters5`, `cynthia-masters4`, `lance-masters2`) — dấu hiệu nhận biết nhanh.
- Chỉ chốt khi có đặc điểm riêng khớp rõ (mũ, vương miện, kiểu tóc buộc, bảng màu). Để lại mặc định khi còn phân vân giữa nhiều sprite gần giống: Marnie (Alt.) / (Palentine's 2022), Misty (Sygna Suit / Swimsuit / Arc Suit) ↔ `misty-masters`, Iono (Sygna Suit / Fall 2024), Silver (Champion / Arc Suit) ↔ `silver-masters2`, Sygna Suit Cynthia (Aura), Lana (New Year's 2026), Lillie (Anniversary 2024), Rosa (Champion), Serena (Palentine's 2021), Hilda (Summer 2022), Sygna Suit Blue, Elio (Champion), Morty (Academy), Adaman (Palentine's 2026).
- Các outfit 2025–2026 còn lại, phần lớn Champion và Arc Suit (Sabrina, Misty, Blue, Ethan, Leon…) chưa có sprite trên Showdown → dùng trang phục mặc định; chạy lại khi Showdown bổ sung sprite.

`npm run match-outfits` tự tìm Chrome trên macOS / Windows / Linux (hoặc đặt biến `CHROME=/đường/dẫn`).

Xem bảng bằng mắt; chỉ ghi vào `config/outfit-sprites.json` những cặp **nhìn thấy rõ là cùng trang phục** (điểm cao nhưng sai thì bỏ). Sau đó `npm run build`. Nếu đã có sprite cũ trong `site/assets/trainers/` thì build vẫn chọn đúng theo thứ tự ứng viên mới.

Sprite tự thêm (trainer Showdown không có, vd Lear, Rachel, Sawyer, Looker): đặt ảnh gốc vào `config/trainer-sprites/source/`, thu về 80px (`sips -Z 80 source/<file>.png --out <tên>.png`), rồi thêm dòng `"Tên trainer": "<tên>.png"` vào `config/custom-trainer-sprites.json`. Bảng này được ưu tiên trên mọi nguồn khác.

Khi thiếu:
1. Tìm tên đúng trên https://play.pokemonshowdown.com/sprites/trainers/ (hoặc `/sprites/gen5/` cho Pokémon), kiểm tra bằng `curl -sI <url>`.
2. Cách nhanh: tải file về và lưu đúng tên **ứng viên đầu tiên** vào `site/assets/trainers/` hoặc `site/assets/pokemon/`. Build sau sẽ thấy file có sẵn và dùng luôn.
3. Nếu có quy luật tên mới → thêm vào `pokemonCandidates` / `trainerCandidates`.
4. URL 404 được ghi vào `site/assets/.missing.json` để không request lại. **Xoá dòng tương ứng (hoặc cả file)** nếu muốn build thử lại URL đó.

Web tự hiện Poké Ball thay thế khi thiếu sprite, nên thiếu sprite không làm hỏng trang.

## 5. Xem và kiểm tra giao diện

```bash
npm run serve
```

Mở và xem các trang: `#/`, `#/pairs`, `#/pair/<id>` của 1–2 pair mới, `#/scouts`, `#/gym`.

Chụp màn hình tự động (macOS, Chrome):

```bash
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # Windows (Git Bash): C="/c/Program Files/Google/Chrome/Application/chrome.exe"
for h in "" pairs scouts gym; do
  "$C" --headless=new --disable-gpu --hide-scrollbars --window-size=1400,2400 \
    --virtual-time-budget=4000 --screenshot="/tmp/pmex-${h:-home}.png" "http://localhost:8765/#/$h"
done
```

Lưu ý: headless Chrome không thu nhỏ dưới ~500px, nên kiểm tra mobile ở 600px hoặc dùng DevTools thật.

Kiểm tra render không lỗi JS (đếm phần tử):

```bash
"$C" --headless=new --virtual-time-budget=3000 --dump-dom "http://localhost:8765/#/gym" | grep -c 'class="unit'
```

## 6. Commit / deploy

- Commit: `site/data/` (gồm `data.js` + `pairs/*.js`), `site/assets/`, và `config/` nếu có thêm outfit. **Không** commit `.cache/` (đã có trong `.gitignore`).
- Không sửa file trong `datamine/` — đó là repo của dataminer; lần `update-data` sau sẽ ghi đè.
- Dữ liệu PoMaTools không có license: xin phép tác giả trước khi deploy công khai.
- Nếu đang deploy (Artifact / GitHub Pages / Netlify): đăng lại sau mỗi lần build.
