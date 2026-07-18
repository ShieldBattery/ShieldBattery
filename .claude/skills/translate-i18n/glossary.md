# Translation glossary

Read this before translating any language. It's the single source of consistency across our ~1000
strings — the thing generic machine translation can't do.

## Term data (Blizzard-matched)

Authoritative term translations live in [terms/](./terms/), one file per language. **Most entries are
exported directly from the game's own translations**, so they match the strings StarCraft: Remastered
shows in-game. **Always consult the relevant `terms/<lang>.csv` before translating, and prefer its
`target` for any term it covers.** When the same English word appears more than once, use the `context`
column (e.g. `Race`, `Game type`, `Map tileset`) to pick the right sense. See
[terms/README.md](./terms/README.md) for the column layout and how to refresh the export from Weblate.

Look terms up with the helper instead of grepping the CSV by hand (it parses quoted fields correctly
and shows the disambiguating `context` column):

```bash
pnpm run i18n terms ko Observer    # → 옵저버 (unit) vs 관전자 (spectator), etc.
```

If `terms/<lang>.csv` is absent or the lookup returns nothing, the term isn't game-derived — fall back
to the rules below, web research, and your best judgment, and add the decision to the glossary so it
stays consistent.

## Brand & proper nouns (all languages)

- **ShieldBattery** — never translated, never transliterated. Always "ShieldBattery".
- **StarCraft**, **Brood War**, **Remastered** — use Blizzard's official localized form for the
  language if one exists (see `terms/`); otherwise keep the English name.
- Map names, unit names, race names (Terran/Protoss/Zerg) — follow Blizzard's official localization
  via `terms/`. These are exactly the terms the Weblate glossary export covers.
- Product/feature names that are ShieldBattery-specific (e.g. menu sections) — translate normally
  unless `terms/` says otherwise.

## Formality / register per language

Audience: a competitive StarCraft: Brood War community, roughly 20–50 years old. Voice is friendly and
direct, never corporate. Lean toward the more **casual, natural** side for each language — how a player
would actually talk — while staying clear and readable. Keep the register consistent within a language:

| Language | Register | Notes |
| --- | --- | --- |
| `es` (Spanish) | Informal **tú** | Gaming-community standard; avoid "usted". |
| `ru` (Russian) | Formal **Вы** | The existing file is consistently formal Вы (~58×); match it — Russian UIs commonly use Вы and it doesn't read as stiff. |
| `ko` (Korean) | Friendly polite **해요체** | Prefer the warmer 해요 over stiff 합니다/honorific-heavy phrasing; don't go full banmal in UI. |
| `zh-Hans` (Chinese, Simplified) | Conversational/standard | Natural Mainland phrasing; avoid overly formal wording. |

(These are sensible defaults — adjust if the user has a preference, and record it here.)

## General rules

- Translate **meaning, not words**. Idiomatic beats literal.
- Keep buttons/labels short — translations tend to run longer than English and overflow UI. When a
  string is a button or fixed-width label (check usage context), favor the shortest natural wording.
- Preserve `{{interpolations}}` and `<0>…</0>` Trans tags **exactly** (enforced by the apply step).
- Keep widely-understood gaming acronyms as-is unless `terms/` localizes them: **MMR**, **APM**,
  **FPS**, **UMS**. Spell out / localize others where natural.
- Match capitalization conventions of the target language, not English title case.

## Per-language term decisions

Beyond the Blizzard `terms/` data, record ad-hoc decisions here as you make them, so future runs stay
consistent. (Seed — extend over time.)

### es
- Register: informal **tú** (matches the existing file: Introduce, Selecciona, tu instalación).
- **news post → noticia** (Noticia creada, Crear noticia); required-field validation follows the
  in-file "Introduce …" imperative style. Statuses agree with feminine "noticia"
  (Publicada/Programada/Creada/Editada).
- **link → enlace** in new strings (dominant in-file: 5× enlace vs 2× link; matches
  "Copiar enlace a la liga").
- Team sizes use the **`1x1` / `2x2` / `3x3`** format (the `x` convention, per the term export).
- Map names kept in recognized English forms: **Fastest, Hunters, Big Game Hunters, BGH** (the export
  keeps "Fastest" English).
- In-file term renderings to match: matchmaking→Emparejamiento, map pool→Grupo de mapas, queue→cola,
  ladder→escalera, veto→vetar/vetado, ban→banear, kick→expulsar, unrated→Sin clasificar.
- **Replay library terms:** replay→replay (loanword, in-file), **playlist→playlist** (loanword,
  feminine: la playlist; Spotify-style), **star/Starred→destacar/Destacados** (Gmail convention),
  **library→biblioteca**, game (a played match)→partida.

### ru
- Register: formal **Вы** (the existing file is consistently Вы; do not use ты here).
- **Plurals need all four CLDR forms — one/few/many/other.** The file historically had only
  one/few/many; the `other` form is the fraction case = the genitive-singular form (e.g. userCount
  `other` = `{{count}} участника`, same ending as `few`; maxLength `other` = `{{count}} символа`, same
  as `one`). Preserve existing one/few/many and add `other`.
- Type labels kept English (the export keeps `1v1 Fastest` fully Latin): **2v2 Fastest / BGH /
  Hunters**. Solo→Соло, Team→Команда in the descriptions.
- **news post → новость**; required-field validation follows the in-file "Введите …" imperative
  style. Quotes use **«»** (in-file precedent), ё is written out (ещё). "by <user>" attribution
  prefix → **"автор: "** (works for both created and edited history entries).
- In-file term renderings to match: matchmaking→матчмейкинг, map pool→Пул карт, queue→очередь,
  veto→Вето, ban→забанить, kick→кикнуть, unrated→Без рейтинга.
- **Replay library terms:** replay→реплей (in-file), **playlist→плейлист**,
  **star/Starred→избранное** family (В избранное/Убрать из избранного; matches maps'
  избранные), **library→библиотека**.

### ko
- **Register: use formal-polite 합니다/습니다체 for sentences.** The existing `ko/global.json` is
  overwhelmingly 합니다체 (~191 vs 3), which is the conventional, non-stiff register for Korean
  software UIs — consistency with the file wins over the "casual 해요체" default above. Keep the
  *casual/native feel* through community vocabulary, not through informal verb endings. (Note: parts
  of the existing `leagues` section and a few stray keys like `cancel: "취소해줘"` are in casual 반말
  from old MT and read as inconsistent — worth a cleanup pass.)
- Team sizes use the colon format: `1v1`→`1:1`, `2v2`→`2:2`, `3v3`→`3:3` (matches the in-game
  `1v1 Fastest`→`1:1 빨무`).
- **Fastest / Fastest Map → 빨무 / 빨무 맵** (community slang for money/fast maps; in `terms` as 빨무).
- **Hunters → 헌터** (the community drops the trailing 스 — 헌터스 is technically correct but reads as
  non-native; Koreans habitually drop the last syllable). **Big Game Hunters → 빅헌터** when spelled
  out; **BGH** kept as-is (the acronym) for short labels.
- **veto → 거부** (래더 "맵 거부"), **matchup → 종족전**, **ladder → 래더**, **queue → 대기열**,
  **map pool → 맵 풀**, **MMR → MMR** (kept).
- Rank → 순위; tier/grade → 등급 (both already used in-file).
- **news → 소식** (matches home's 최신 소식), **publish → 게시** (게시됨/지금 게시/게시 취소),
  **cover image → 대표 이미지** (Korean CMS convention), **draft → 초안**, **schedule(d) →
  예약(됨)**. Required-field validation follows the in-file "…을 입력하세요" style.
- **Replay library terms:** replay→리플레이 (in-file), **playlist→재생목록** (YouTube convention),
  **star→별표** (별표 표시/별표 해제, Gmail convention; distinct from maps' 즐겨찾기),
  **library→라이브러리** (Steam convention).

### zh-Hans
- Register: use 您 for second person (the existing file is ~3:1 您 vs 你; it's the normal polite UI
  register, not stiff).
- **"Play" (the game action) → 开始游戏, never 播放.** 播放 means media playback (video/audio/replay)
  — wrong for the main PLAY button / playing a game. (Same trap for any "play": pick the game sense.)
- Map names kept in recognized English forms: Fastest, Hunters, Big Game Hunters, BGH (matches the
  in-game term export and Chinese community usage). Team sizes use the `1v1`/`2v2`/`3v3` format.
- In-file term renderings to match: queue→队列, matchmaking→匹配, map pool→地图池, veto→否决,
  ladder→天梯, ranked→排位.
- **news (posts) → 新闻** (home's legacy 最新消息 header kept as-is), **publish → 发布**,
  **scheduled publish → 定时发布** (status chip 已定时, "Scheduled for X" → 将于 X 发布),
  **draft → 草稿**, **cover image → 封面图片**. Use full-width punctuation（），：；and “”quotes;
  required-field validation follows the in-file 请输入… style.
- **Replay library terms:** replay→录像 (in-file), **playlist→播放列表**, **star→星标**
  (添加星标/取消星标, Gmail convention; distinct from maps' 收藏), **replay library→录像库**
  (also the "In library" state: 已在录像库). Specific played games use 游戏 on game pages
  (matches 复制游戏链接).
