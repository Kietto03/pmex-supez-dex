# Format file nguồn & quy tắc parse

Toàn bộ parser nằm trong `scripts/build.mjs`. File được đọc UTF-8, bỏ `\r`. Ngày dạng `d/m/yyyy hh:mm[:ss]` hoặc `dd/mm/yyyy hh:mm` được chuẩn hoá thành `yyyy-mm-ddThh:mm` bởi `parseDate()`.

## Tên pair — `splitPairName()`

```
No. 115 Sygna Suit Lysandre (Alt.) & Chi-Yu (Genderless) - Tera Type Fire
    │   └ trainer ───────────────┘   └ pokemon ┘└ gender ┘   └ form ────────┘
    └ number
```

- Tách trainer/pokemon ở ` & ` đầu tiên.
- Gender: `(Male♂️|Female♀️|Genderless)`.
- `✨` trong phần Pokémon → `shiny: true`.
- ` - <gì đó>` ở cuối → `form`.
- **Khoá định danh pair** = nguyên dòng header (`key`). Cùng key ở nhiều version → bản version mới hơn ghi đè thông tin, `versions[]` cộng dồn. Lưu ý: `No.` là số của *trainer*, không duy nhất theo pair (vd `No. 249 Urbain & Meganium` và `No. 249 Urbain & Avalugg`).

## `👤 Trainer.txt` — `parseTrainers()`

```
=========================================
1. No. 115 ... (danh sách mục lục — bị bỏ qua)
=========================================
No. 115 Sygna Suit Lysandre (Alt.) & Chi-Yu (Genderless)
Form: Tera Type: Fire
Dialog 5 Stars: ...
Descriptions: ...
Role: Field | EX Role 🌈: Sprint
Type: Fire | Weakness: Ground
Rarity: ⭐⭐⭐⭐⭐
Expedition 🤝: Soothing ↑1 Wistful ↑1
Method: 🎈🌟 EX Fair Scout
Item Exchange: ...            (tuỳ pair)
Collect items in ...          (tuỳ pair)
EX Color 👕🌈: Yes✅
👥 Team Skill
1. Fire Field
...
Sync Pair Available: 2/10/2026 06:00:00
EX Effect Available: ...      EX Role Available: ...      Superawakened Available: ...

⚔️ Moves Details ⚔️
Move 1: Fire Spin             ← "Move N:" | "Sync Move:" | "💎 Tera Move:"
Type: Fire                    (move Status/Trainer có thể không có Type)
Category: Special
User: Pokemon
Description: ...
Power: 38 (1)/45 (5↑ MAX) | Accuracy: 85 | Gauge: 2 | Target: ... | Effect Tag: -- | Max uses: --
                              ← dòng Power: KẾT THÚC một move

🛡️ Passive Details 🌟
(🌅🌟) Superawakened Passive: <tên>
<mô tả>
Passive 1(🏅): <tên>          ← (🏅) = master passive
<mô tả 1 dòng>

📊 Base Stats 📊
Lv. 1
HP : 95 | Attack : 14 | Defense : 8 | Sp. Atk : 20 | Sp. Def : 12 | Speed : 16
(Lv. 140 / 150 / 200)

📌 Tera Details 📌            (tuỳ chọn)
💎 Tera Moves Details ⚔️
💎 Tera Move: ...
🛡️ Passives Details 🌟        ← chữ "Passives" (số nhiều) = passive của Tera
Passive 2: ...

📌 Mega Details 📌            (tuỳ chọn)
⚔️ Mega Moves Details ⚔️      (hiếm)
📊🔄 Mega Stats 📊🔄
Lv. 1 ...
----
-------------------------------END-------------------------------
```

Quy tắc:
- Khối pair được tách bằng dòng `---...END...---`.
- Parser chạy theo `section`: `info → moves → passives → stats → tera / tera_passives → mega_moves / mega_stats`. Header section nhận diện bằng chuỗi con (`'⚔️ Moves Details'`, `'🛡️ Passive Details'`, `'Passives Details'` khi đang ở `tera`, `'📊 Base Stats'`, `'Mega Stats'`, `'Tera Moves Details'`). **Nếu datamine đổi chữ/emoji ở các header này, cập nhật chuỗi trong `parseTrainers()`.**
- Mô tả passive = đúng 1 dòng ngay sau tên.
- Pair có thể thiếu section: vd Juliana (event Academy) chỉ có Move 1 + Sync Move, không có passive → bình thường, UI tự ẩn mục trống.

## `🔷 Grid.txt` — `parseGrids()`

```
=========================================
1. No. 147 Bertha & Hippowdon (Female♀️) Cell 49 - 54   ← "Cell a - b" = chỉ là grid mở rộng
=========================================
No. 115 Sygna Suit Lysandre (Alt.) & Chi-Yu (Genderless)
Form: Tera Type: Fire
Cell 12 | 🎯 Cord (1,3,-4) | Cost: ⚡ 10 Energy | 🔮 120 Sync Orb(s)
	Requirements: 1 or more adjacent tiles must be activated
	🔮 Other Require Unlock                 (tuỳ chọn, grid event)
		1. Fiery Orb(s) (Juliana & Chimecho) x40
	Testing Potential!: 1st Move: Restore MP 1   ← tên kỹ thuật
	Move: Testing Potential!                     (tuỳ chọn)
	Restores one MP of the user’s move ...       ← mô tả
	Color Grid: 🟥 Red (Move Effect)
```

- Toạ độ `Cord (q,r,s)` là **cube coordinate** (q+r+s=0), ô trung tâm (0,0,0) là sync pair.
- Màu: `Blue` Stat · `Green` Move Boost · `Red` Move Effect · `Yellow` Passive · `Rainbow` Sync Move.
- **Title / description của ô** (hàm `flush` trong `parseGrids`): các dòng nội dung còn lại (không phải Requirements / Color / Move / unlock) được chia:
  - dòng dài > 25 ký tự và kết thúc bằng `.` hoặc `)` → **description**;
  - còn lại → ứng viên title, lấy **dòng cuối cùng** (vì dòng hiển thị như `Power ↑ 2` đứng sau tên kỹ thuật `Power 2`).
- Grid được ghép với pair theo **header y hệt** trong Trainer.txt. Header không có trong Trainer.txt → tạo pair `gridOnly: true` (grid expansion). Nếu có pair khác cùng trainer+pokemon (khác header) thì ô grid được gộp vào pair đó.
- Nhiều version cùng một pair: các ô được gộp theo số `Cell N`, bản mới ghi đè; mỗi ô giữ `version` của nó.

## `🎰 Sync Pair Scout.txt` — `parseScouts()`

```
10/2026                       ← header tháng MM/YYYY (nhóm hiển thị theo giá trị này)
--------------------

[event_8090_1W_ExPokeFes_01]  ← id duy nhất; trùng id ở version sau → ghi đè
Lysandre, an EX Fair–exclusive ... !   ← blurb (dòng > 60 ký tự, kết thúc . hoặc !)
48 Hours!                     ← tag (các dòng header trước title)
Sygna Suit Lysandre EX Fair   ← title = dòng header CUỐI trước "Type Scout:"
Type Scout: EX Fair Scout
Scout Points to Pick-up: x400
Rate-up Trainer: 1. Sina & Glaceon (Female♀️)
2. Sygna Suit Ghetsis & Chien-Pao (Genderless)
Presents when the Sync Pair is scouted:
	1-1 🍰🟡 Tech Roll Cake Coin x4
Require
	Sync Pair Scout ×11                         ← depth 1 (1 tab) = một lựa chọn
		x3000 💎 Gems (Non-Paid) | Limit Scout: 1   ← depth 2: giá | giới hạn
			Present no.1 🪙🍬 Strike Move Candy Coin x1   ← depth 3: quà
		Scout Points get: 33
	Tier 1                                      ← Tiered Scout: dòng "Tier N" gắn vào lựa chọn kế tiếp
	Select Master Fair | 🎫 ... x1 | Limit Scout: 1   ← dạng 1 dòng có "|"
	Ticket Scout: Fair-Exclusive Guaranteed Ticket x1 | Limit Scout: 1
🗓️ Start: 30/09/2026 06:00
🗓️ End: 18/10/2026 06:00    (hoặc "No end date" → end = null)
```

- Độ sâu trong khối `Require` tính bằng **số tab đầu dòng** — nếu datamine chuyển sang space, cần sửa `depth` trong `parseScouts()`.
- Chi phí pick-up (`pityInfo()` trong `app.js`) = **tổ hợp rẻ nhất** các lượt trả bằng Gems đạt đủ `Scout Points to Pick-up`:
  - 11-pull 3000💎 = 33 pt, single 300💎 = 3 pt → 400 pt = **12 multi + 2 single = 36.600💎** (không phải 13 multi = 39.000💎).
  - Bỏ qua `Daily Discount` (1 lần/ngày, gem trả phí).
  - Các lượt giống nhau (cùng nhãn/giá/điểm) được gộp; tôn trọng `Limit Scout: N`, `No Limit` = không giới hạn.
  - Tiered Scout phải quay theo thứ tự tier → cộng dồn Tier 1, 2, 3… đến khi đủ điểm.

## `🥊 Pasio Gym Battle No. N.txt` — `parseGym()`

Dựa trên **emoji đầu dòng** và **thụt lề**:

```
🔄 Circuits:
  Circuit 1 | 10.000 pts | Regular Battle | 🔴 Poke Ball Tier
  Extra Battle 12 and onward | 450.000 pts | Extra Battles | 🟣 Master Ball Tier
📢 Announce: / ⚔️ Battle: / 🏆 Ranking: / 🎁 Reward:
   Start: 1/10/2026 06:00:00
   End: ...
🎫 Challenge Point Effect:
  🎟️ Ticket x2 | ⏱️ 3:00 min | 🔄 Sync Buff +2
👹 Gym Circuit:
  📋 Circuit 1:                                   ← stage
  🔄 Rules rotate per circuit: ...                (chỉ ở stage cuối)
    🆔 Roark | 🏷️ Rock | Challenge Roark (Ultra Hard)   ← leader
       Theme: Zero physical damage                  ← hoặc "No rules"
          Rule: Opponents take zero damage ...      (tuỳ chọn)
       Rules 1: ... / Rules 2: ... / Rules 3: ...   (stage cuối, xoay vòng)
       📊 [Center] Weakness: Grass | HP: 500,500 | Attack: 960 | ... | Speed: 67
          🔸 Focus: Physical Moves, Defense Down
          ♦️ Passive Damage Reduction (Enemy): All Enemy - Level 4
              ● Lessen Poison (Remove)
             Passive 1: Recoil Removal 9
       [Left/Right] Weakness: ... (cùng cấu trúc)
🏅 Combined Ranking Rewards:
Top 1
  🎖️ ... / 🤝 Gym Battle Voucher x50
🎯 Combined Score Rewards:
1. 10.000 pts
5. 50.000 pts (Featured Reward)
25. 300.000 pts (Repeatable)
```

- Số dùng dấu `.` (điểm) hoặc `,` (HP) làm phân cách nghìn → `num()` bỏ cả hai.
- Tên circuit ở `🔄 Circuits` phải **khớp đúng** tên stage ở `📋 ...:` để UI nối điểm/tier với stage.
- Phân loại luật cho bảng matrix nằm ở `ruleClass()` trong `app.js`:
  - `Zero physical` → ô xanh **SPEC** (phải đánh special)
  - `Zero special` → ô đỏ **PHYS**
  - `P-move` → ô lục **P+5**
  - `not super effective` → thêm sọc
  - còn lại → `—`

## PoMaTools (pair cũ) — `scripts/pomatools-import.mjs`

Nguồn bổ sung cho các pair ra **trước** các bản datamine: crawl từ https://www.pomatools.site (PoMaTools, tác giả HsinChang) bằng `scripts/crawl-pomatools.mjs` vào `.cache/pomatools/` (không commit). **Không có license công khai** — ghi nguồn ở footer, và nên xin phép tác giả trước khi deploy công khai.

| File | Nội dung |
|---|---|
| `data/sync_meta_list.json` | index ~670 pair (id → meta: role, type, exRole, exclusivity, ngày…) |
| `data/pairs/<id>.json` | chi tiết: `trainer`, `pokemon[]` (biến thể: base / Mega / Tera), `grid[]`, `themes[]`, `date`, `specialAwaking` |
| `data/core/move_database.json` | move id → `type`, `category`, `power`, `accuracy`, `gauge`, `uses`, `target`, `tag` |
| `locales/en.json` | text: `trainer_name_`, `pokemon_name_`, `move_name_/desc_`, `passive_name_/desc_`, `tile_name_`, `theme_name_` + id |

Quy tắc chuyển đổi:
- **Role** (theo `RoleMap` trong JS của trang): 0 Strike (Physical), 1 Strike (Special), 2 Support, 3 Tech, 4 Sprint, 5 Field, 6 **Multi**. EX Role: 0/1 Strike, 2 Support, 3 Tech, 4 Sprint, 5 Field, −1 không có.
- **Type**: 1…18 theo thứ tự chuẩn (1 Normal, 2 Fire, 3 Water, … 16 Dark, 17 Steel, 18 Fairy).
- **Target / category / effect tag / cách nhận** không có nhãn → **học từ các pair có ở cả hai nguồn** (vote theo nhãn của datamine). Mã cách nhận `1`, `2`, `4`, `995`, `998` không đáng tin nên để trống.
- **Grid**: `x, y` = `q, r` (cube `s = −x−y`); màu `#779EFF` Stat, `#47D147` Move Boost, `#FF0066` Move Effect, `#FFC266` Passive, `#BF80FF` Sync Move; `level` → "Move level must be N or higher"; tile id 13 chữ số bắt đầu bằng id passive 8 chữ số → mô tả ô = `passive_desc_<8 số đầu>`.
- **Chỉ số**: mảng 7 mốc, `[0]` = Lv.1, `[5]` = Lv.140, `[6]` = Lv.200; Lv.150 nội suy tuyến tính (khớp datamine).
- **Power tối đa** = `floor(power × 1.2)` (move level 5).
- **Biến thể Pokémon** (`pokemon[1..]`, trường `variationType`): 1 Mega, 2 đổi form trong trận, 3 trước/sau sync, 5 form sau sync (vd Zygarde Complete, Ultra Necrozma), 6 Primal, 7 **Tera**. Chỉ số của biến thể = chỉ số gốc × `scale[]` (%, thứ tự HP/Atk/Def/SpA/SpD/Spe), làm tròn xuống — khớp số Mega của datamine (566 × 1.2 = 679). Với pair có trong datamine, hệ số được áp lên chỉ số gốc của datamine.
- **Tera**: biến thể `variationType 7` → `teraType` (= type của biến thể) và `moveTera` → `teraMoves`. Nhãn form "Tera Type: X" trên Charizard/Cinderace/Gengar thường là mã form dùng chung, **không** có nghĩa pair đó có Tera.
- **Alcremie**: vị kem chỉ nằm trong actor id `pm0869_<kem>_<topping>` (11 Vanilla, 12 Ruby Cream, 13 Matcha, 14 Mint, 15 Lemon, 16 Salted, 17 Ruby Swirl, 18 Caramel Swirl, 19 Rainbow Swirl — đã đối chiếu ảnh trong game).
- **Ngày**: giờ Nhật 14:00 → trừ 8 tiếng để khớp mốc 06:00 của datamine.
- **Sửa text**: `en.json` mất ký tự xuống dòng trong tên ("FirescourgeInferno" → tách chữ hoa), mất chữ "rank(s)" và để lại **no-break space U+00A0** ("by three␣␣when") → `cleanDesc` chuẩn hoá NBSP rồi chèn lại "rank"/"ranks".
- **Ưu tiên**: pair có trong datamine giữ nguyên dữ liệu datamine; pair chỉ là grid expansion trong datamine được thay bằng dữ liệu đầy đủ từ PoMaTools (giữ thông tin version). Pair PoMaTools không có số "No." (mã `actor` của họ khác số No. của datamine) và hiển thị nhãn **DB**.
