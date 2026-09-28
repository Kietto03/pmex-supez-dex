---
name: update-datamine-web
description: Update the PMEX Datamine Dex web viewer (site/) after new datamine data lands — a new datamine/2.xx/ version folder (gitignored clone of the dataminer's repo), or new/changed Trainer, Grid, Sync Pair Scout or Pasio Gym Battle files. Rebuilds site/data/data.js, fixes parser drift, fetches missing sprites, and verifies the pages render. Use when the user says the data was updated, a new version was added, or asks to refresh/rebuild the web.
---

# Update the datamine web viewer

Read these first — they are the source of truth and hold the details this skill only points to:
- `docs/update-workflow.md` — the step-by-step checklist with verification commands
- `docs/data-formats.md` — every source file format and the parse rules in `scripts/build.mjs`
- `docs/web-architecture.md` — data model, `app.js` code map, how to extend

## Procedure

1. **Inventory.** Pull the dataminer's repo with `npm run update-data` (first time: `npm run setup-data`; `datamine/` is a gitignored clone), then list the new/changed version folder(s) (`git -C datamine log --stat -5`, `ls datamine/<version>/`). Never edit files inside `datamine/`. Confirm file names still match the patterns in `docs/update-workflow.md` §1. Diff a sample of each source file against the documented format in `docs/data-formats.md`; note any new headers, emoji, sections, scout types or gym rules.

2. **Build.** Optionally refresh older-pair data first with `npm run crawl -- --refresh` (see `docs/data-formats.md` → PoMaTools; third-party, unlicensed — keep attribution, ask before public deploys). Then `npm run build`. Compare the summary against expectations (pair count vs. the table of contents at the top of the new `👤 Trainer.txt`, new scouts, new gym).

3. **Verify the parse** with the node one-liners in `docs/update-workflow.md` §3, filtered to the new version. Treat as parser drift: empty role/type on non-grid-only pairs, zero moves/grid on a new pair, grid cell titles that are sentences, scouts without title/start, gyms missing phases/leaders. For each drift, fix `scripts/build.mjs`, rebuild, re-check. Don't hand-edit `site/data/data.js`.

4. **UI follow-ups** for new categories:
   - new scout type landing in "Other" → add to `SCOUT_CATS` in `site/app.js`;
   - new gym rule text → extend `ruleClass()` + `.mcell.r-*` CSS + legend;
   - new role → `ROLES`.

   Spot-check the pick-up cost on one 400-pt banner: it must read 36,600💎 (12 multi + 2 single).

5. **Sprites.** Follow `docs/update-workflow.md` §4:
   - Plain trainer names get the default outfit only.
   - Names with an outfit marker ((Alt.), (Fall 2026), Sygna Suit…) get that outfit only when a verified sprite exists; otherwise they get the default.
   - Before adding to `OUTFIT_SPRITES`, look at the candidate images (contact sheet + screenshot). Never guess from `-masters` numbering.
   - Clear matching entries in `site/assets/.missing.json` to retry a URL.

6. **Render check.** Serve `site/` (`npm run serve`, run in background) and screenshot `#/`, `#/pairs`, one new `#/pair/<id>`, `#/scouts`, `#/gym` with headless Chrome (commands in the workflow doc). Look at the screenshots. Stop the server afterwards.

7. **Docs.** If the data format or code changed, update the matching section of `docs/data-formats.md` / `docs/web-architecture.md` in the same change.

8. **Report.** Tell the user:
   - counts before → after;
   - parser fixes made;
   - sprites still missing or left on the default outfit;
   - anything not verified.

   Don't commit or redeploy unless asked. When the user commits, `site/data`, `site/assets` and `config/` belong in the commit; `datamine/` never does.

## Gotchas

- `No.` is the trainer number, not unique per pair — pairs are keyed by the full header line.
- The datamine's `Player` is Scottie; `TRAINER_RENAMES` in `scripts/build.mjs` renames him so he merges with the PoMaTools pairs. A new pair that duplicates an existing one under another trainer name needs an entry there.
- Pair category comes from PoMaTools (`exclusivity`). A new pair PoMaTools doesn't have yet gets it from its `Method:` line via `METHOD_CATEGORY` in `scripts/build.mjs`; new wording (or `Exchange`) leaves it "Chưa rõ" → extend the regex list, and re-run the crawl later so PoMaTools' category takes over. Never map `Method:` onto PoMaTools codes — `Method` is how the pair is obtained in that update, not its category.
- Grid header `Cell 49 - 54` means a grid expansion for an older pair (becomes `gridOnly`).
- Scout `Require` nesting depends on tab indentation.
- Press Start 2P has no Vietnamese glyphs — use `--font-ui` for Vietnamese text.
- Headless Chrome won't go below ~500px wide. Check mobile at 600px.
