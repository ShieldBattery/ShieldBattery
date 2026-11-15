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
- **Warp Field** (the lobby option that turns on ShieldBattery's gameplay fixes) — a brand name, kept
  in English in every language. Inflect around it, not in it (ko `Warp Field를`, ru "включает Warp Field").
  It nods to the Arbiter's voice line "Warp field stabilized"; that exists only in the dubbed audio, so
  `terms/` has no official rendering. Kept English so players across languages share one name.
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
- **Race initials** (single-character race tags like T / P / Z / ?) use the `Race initial` rows in
  `terms/`, which match the tags SC:R's own alliance dialog shows. Random is `?` everywhere, never a
  translated "R"; ko uses 테 / 프 / 저, the other languages keep Latin T / P / Z.

## Per-language term decisions

Beyond the Blizzard `terms/` data, ad-hoc decisions are recorded in one file per language, so future
runs stay consistent. Read the file for the language you are translating (and add new decisions
there). Each file also holds that language's `game.json` (in-game HUD/dialog) conventions.

- [glossary/es.md](./glossary/es.md)
- [glossary/ru.md](./glossary/ru.md)
- [glossary/ko.md](./glossary/ko.md)
- [glossary/zh-Hans.md](./glossary/zh-Hans.md)
