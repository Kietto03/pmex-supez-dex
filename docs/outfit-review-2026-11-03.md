# Outfit sprite review — 2026-11-03

Source: https://play.pokemonshowdown.com/sprites/trainers/

Compared the current directory with the previous review: no new filenames. Downloaded 116 candidates for unmapped outfits; previously cached candidate images were unchanged. Visually compared remaining candidates with the in-game PoMaTools actor portraits in `.cache/outfits/icons/`. The following existing sprites match previously unmapped outfits (hair accessories, collars, outfit shape and colors), so their mappings were added.

| Outfit | Showdown sprite |
|---|---|
| Sygna Suit Misty | misty-masters |
| Marnie (Palentine's 2022) | marnie-masters2 |
| Silver (Champion) | silver-masters2 |
| Sygna Suit Cynthia (Aura) | cynthia-masters3 |
| Rosa (Champion) | rosa-masters3 |
| Elio (Champion) | elio-masters |
| Lillie (Anniversary 2024) | lillie-masters4 |
| Hilda (Summer 2022) | hilda-masters2 |
| Serena (Palentine's 2021) | serena-masters |
| Sygna Suit Blue | blue-masters |
| Morty (Academy) | morty-masters3 |
| Sygna Suit Iono | iono-masters |
| Iono (Fall 2024) | iono-masters2 |
| Adaman (Palentine's 2026) | adaman-masters2 |
| May (Champion) | may-masters4 |
| Lana (New Year’s 2026) | lana-masters2 |

Other unresolved outfits retain their existing fallback. Arc Suit Gladion/Hau, Bea (Alt.) and Victor (Academy) have no newly available dedicated sprite in the checked directory.

## Second pass: aliases and old game names

Checked the full 1,500-name Showdown directory, including non-Masters and generation-specific IDs, against fresh PoMaTools portraits. Verified mappings:

| Trainer | Sprite |
|---|---|
| The Masked Royal | theroyal |
| Volo | volo-ginkgo |
| Volo (Alt.) | volo |
| Elesa | elesa-gen5bw2 |
| Elesa (Classic) | elesa |
| Blue (Classic) | blue-gen3 |
| Giovanni (Classic) | giovanni-gen3 |
| Marnie (Alt.) | marnie-league |
| Gloria (Anniversary 2025) | gloria-masters2 |
| Sygna Suit Carmine | carmine-masters |

Elesa (Classic) and Volo (Alt.) already used these images; explicit mappings keep them distinct from the corrected default appearances. This changes 11 pair records across 8 trainer appearances. Red (1996), Misty (Swimsuit) and Flannery (Special Costume) remain unresolved: old-game candidates do not establish an exact match to their PMEX outfit.

The review script now includes aliases, old-generation candidates and sprites without a Masters suffix; `npm run match-outfits -- --refresh` refreshes the directory and image cache. Visual confirmation is still required before changing mappings.
