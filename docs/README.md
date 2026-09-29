# Tài liệu — PMEX Datamine Dex

Tài liệu cho web viewer trong `site/` và quy trình cập nhật khi có datamine mới.

| File | Nội dung |
|---|---|
| [update-workflow.md](update-workflow.md) | **Checklist khi có version / file mới** — làm theo thứ tự này mỗi lần update |
| [data-formats.md](data-formats.md) | Format của từng file `.txt` nguồn và cách parser đọc chúng |
| [gym-manager.md](gym-manager.md) | **Gym Manager**: cài Supabase, vai trò, vận hành (người vào/rời gym), luật Gym Battle, test |
| [web-architecture.md](web-architecture.md) | Cấu trúc code (`scripts/build.mjs`, `app.js`, `styles.css`), data model, cách mở rộng |

Skill Claude Code tương ứng: `.claude/skills/update-datamine-web/SKILL.md` — gõ `/update-datamine-web` trong Claude Code để chạy lại quy trình.

## Tóm tắt 30 giây

```bash
npm run update-data    # git pull trong ./datamine (lần đầu: npm run setup-data)
npm run build          # parse datamine/2.xx/ → site/data/, tải sprite còn thiếu
npm run serve          # http://localhost:8765 (hoặc mở thẳng site/index.html)
```

- Dữ liệu **không** được fetch lúc chạy: `scripts/build.mjs` đọc các file `.txt`, sinh `site/data/data.js` (`window.PMEX_DATA = {...}`). Vì vậy mở thẳng `index.html` cũng chạy.
- Dữ liệu datamine nằm ở repo riêng của dataminer, clone vào `datamine/` (**gitignore**, không bao giờ commit); repo này chỉ chứa code, docs và output build. Thư mục version mới (`datamine/2.74/`, …) được tự nhận, miễn tên dạng `số.số`.
- Web đang dùng 4 nguồn: `👤 Trainer.txt`, `🔷 Grid.txt`, `🎰 Sync Pair Scout.txt`, `🥊 Pasio Gym Battle No. N.txt`. Các file khác trong datamine chưa được hiển thị.
