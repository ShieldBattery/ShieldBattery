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
| `ru` (Russian) | Informal **ты** | Standard for gaming UIs; keep it natural, not stiff. |
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
- _(add decisions here)_

### ru
- _(add decisions here)_

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

### zh-Hans
- _(add decisions here)_
