# Gym Manager — quản lý gym (đăng nhập, pair, tháp, log Gym Battle)

App ở `site/gym/` (deploy cùng Dex: `https://<github-pages>/gym/`). Dữ liệu và đăng nhập nằm trên **Supabase** (Postgres + Auth, gói miễn phí). Web vẫn là trang tĩnh, không có server riêng.

Chưa cấu hình Supabase thì app tự chạy **chế độ demo**: dữ liệu mẫu trong trình duyệt, không lưu gì. Mở `site/gym/?demo` bất cứ lúc nào để thử.

## Vai trò

| | Member (~20) | Mod (2) | Admin (1) |
|---|---|---|---|
| Xem mọi thứ trong gym (pair, tháp, log, kế hoạch) | ✅ | ✅ | ✅ |
| Sửa hồ sơ, pair, tháp **của mình** | ✅ | ✅ | ✅ |
| Sửa hồ sơ, pair, tháp **của người khác** | — | ✅ | ✅ |
| Ghi lượt cho mình (chỉ round đang mở) | ✅ | ✅ | ✅ |
| Ghi / sửa lượt cho người khác, ghi bù round cũ | — | ✅ | ✅ |
| Tạo mùa, khoá thành viên, phân công, ghi chú leader | — | ✅ | ✅ |
| Xem nhật ký hoạt động | — | ✅ | ✅ |
| Tạo / xoá tài khoản, đặt lại mật khẩu, đổi vai trò | — | — | ✅ |

Quyền được kiểm tra **trong database** (Row Level Security + trigger), không chỉ ở giao diện. Test: `bash supabase/tests/run.sh`.

## Cài đặt Supabase (một lần)

1. **Tạo project** tại <https://supabase.com> (Free). Ghi lại *Project URL* và *anon public key* (Project Settings → API).
2. **Tắt đăng ký tự do** — bắt buộc, nếu không ai có anon key cũng tự tạo được tài khoản:
   Authentication → Sign In / Providers → **tắt "Allow new users to sign up"**. Giữ Email provider bật (dùng để đăng nhập bằng mật khẩu), tắt "Confirm email".
3. **Tạo bảng**: SQL Editor → dán toàn bộ `supabase/migrations/20260929000000_gym_manager.sql` → Run.
   (Hoặc dùng CLI: `npx supabase link --project-ref <ref>` rồi `npx supabase db push`.)
4. **Deploy Edge Function** quản lý tài khoản (cần [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase functions deploy admin-users
   # tuỳ chọn: chỉ cho web của bạn gọi function
   npx supabase secrets set ALLOWED_ORIGIN=https://<user>.github.io
   ```
5. **Tạo admin đầu tiên**: Authentication → Users → *Add user* → *Create new user*:
   email `admin@members.pmex-gym.local` (đổi `admin` thành username bạn muốn), mật khẩu, bật *Auto Confirm User*.
   Rồi SQL Editor:
   ```sql
   update public.profiles set role = 'admin', display_name = 'Tên trong game' where username = 'admin';
   ```
6. **Nối web vào Supabase**: sửa `site/gym/config.js` → `supabaseUrl`, `supabaseAnonKey` (anon key được phép công khai), commit + push.
7. Đăng nhập bằng admin → **Quản trị**:
   - *Danh mục pair* → **Đồng bộ** (nạp ~670 pair từ Dex vào database; làm lại mỗi khi Dex có pair mới).
   - *Mùa Gym Battle* → **Tạo mùa** (chọn gym trong datamine để tự điền Gym Leader, circuit, giờ Battle).
   - *Tài khoản* → cấp tài khoản cho từng thành viên.

## Vận hành

**Người mới vào gym**: Quản trị → Tài khoản → nhập username + nickname, bấm *Tạo tài khoản* → gửi đoạn "Link / Username / Mật khẩu" hiện ra cho họ. Họ đăng nhập, vào *Tài khoản* đổi mật khẩu, rồi tự nhập pair và tháp ở hồ sơ của mình (hoặc admin/mod nhập giúp).

**Người rời gym**: Quản trị → Tài khoản → *Xoá* (gõ lại username để xác nhận). Pair, tháp, phân công của họ bị xoá; **log lượt đánh vẫn giữ tên** (cột `member_name`), bảng điểm hiện "(đã rời)".

**Quên mật khẩu**: admin bấm *Đặt lại mật khẩu* → gửi mật khẩu mới.

**Mỗi mùa Gym Battle**: tạo mùa từ datamine → đặt *đang chạy*. Thành viên ghi lượt ở **Ghi lượt**; bảng *Tổng quan* tự tính điểm, vé, tiến độ. Ai bỏ giữa mùa thì *Khoá* (không ghi lượt mới, không tính vào tổng điểm).

## Luật Gym Battle được kiểm tra khi ghi lượt

(giống nhau ở `site/gym/rules.js` và trigger `check_run()` trong database)

- **Vé**: 9 vé lúc mở Battle, +3 mỗi 24 giờ, tối đa 30 vé/người, cả gym tối đa 600 vé (sửa được theo mùa).
- **Circuit thường luôn tốn 3 vé/lượt**; từ Extra Battle chọn ×1/×2/×3.
- **Trần điểm**: tổng điểm của một Gym Leader trong một round không vượt điểm của circuit đó.
- **Chuỗi round**: round đang mở = round đầu tiên chưa đủ điểm cho cả 8 Gym Leader. Member chỉ ghi được round đang mở; mod/admin ghi bù được round bất kỳ.
- Circuit cuối "… and onward" lặp mãi (Extra Battle 12, 13, …), luật xoay vòng Rules 1/2/3 (lấy từ datamine).
- Thành viên bị khoá không ghi lượt mới; điểm của họ không tính vào **Combined**.
- Team 1–3 pair, không trùng.

## Pair & tháp

- **Pair sở hữu**: level `1/5 … 5/5`; pair có Superawaken (EX Fair, Master Fair, Poké Fair… — `maxBonus = 10` trong Dex) lên tới `10/5`. Nút **EX** = đã 6★ EX, **EXR** = đã mở EX Role (chỉ hiện với pair có EX Role). Database từ chối level/EX Role sai với pair.
- **Pasio Tower**: 18 tháp theo type, mỗi tháp 40 tầng, đội chỉ dùng pair cùng type → tầng cao = có kinh nghiệm với type đó.
- **Độ hợp** (trang Kế hoạch) = tổng 3 pair mạnh nhất cùng type (level + 2 nếu EX + 1 nếu EXR) + ¼ số tầng tháp type đó. Chỉ để gợi ý, không phải luật game.

## Cấu trúc code

```
supabase/
  migrations/20260929000000_gym_manager.sql   bảng, RLS, trigger luật, nhật ký
  functions/admin-users/index.ts              tạo/xoá tài khoản, đặt lại mật khẩu, đổi vai trò (service role)
  tests/run.sh + rls_test.sql + auth_stub.sql 34 test quyền & luật trên Postgres tạm (Docker)
site/gym/
  index.html, gym.css      giao diện (dùng chung ../styles.css, ../data/data.js, ../assets của Dex)
  config.js                URL + anon key Supabase (để trống = demo)
  main.js                  router + các trang
  api.js                   lớp dữ liệu: Supabase hoặc demo, cùng một giao diện hàm
  rules.js                 luật Gym Battle (thuần, không DOM)
  dex.js                   cầu nối dữ liệu Dex: catalog pair, sprite, gym từ datamine
  demo.js                  backend demo trong bộ nhớ + dữ liệu mẫu
test/gym.e2e.html          22 bước thao tác thật ở chế độ demo (serve thư mục gốc repo)
```

**Bảng**: `profiles` (tài khoản, vai trò) · `pair_catalog` · `member_pairs` · `tower_progress` · `seasons` (leader/circuit chụp từ datamine lúc tạo) · `season_members` (khoá) · `runs` (log, giữ `member_name`) · `assignments` · `leader_notes` · `activity`.

**Test**
```bash
bash supabase/tests/run.sh                         # database: 34 PASS
python3 -m http.server 8765                        # ở thư mục gốc repo
open http://localhost:8765/test/gym.e2e.html        # giao diện: 22 PASS
```

**Username → email**: Supabase Auth cần email, nên tài khoản dùng `<username>@members.pmex-gym.local` (không bao giờ gửi mail). Đổi domain thì sửa cả `usernameDomain` trong `config.js` và secret `USERNAME_EMAIL_DOMAIN` của function.
