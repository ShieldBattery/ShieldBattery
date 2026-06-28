---
name: translate-i18n
description: Generate and update ShieldBattery's i18next translations (es, ko, ru, zh-Hans) from the English source strings, using full app + usage context. Use this whenever translations are out of date, a language is missing strings, or you're asked to translate/localize the UI. Produces context-aware, audience-appropriate, plural-correct translations.
---

# Translating ShieldBattery

Our UI strings live in i18next JSON files at `server/public/locales/<lang>/global.json`. `en` is the
source of truth (grown automatically by `pnpm gen-translations`, which only writes `en`). The other
languages — `es`, `ko`, `ru`, `zh-Hans` — must be filled in by translating from `en`.

The goal is translations that are clearly better than generic machine translation. We get there by
bringing in context an MT engine doesn't have: what ShieldBattery is, **where** each string appears in
the UI (a button vs. a tooltip vs. an error message), **who** is reading it, and a consistent glossary
of game/brand terms.

**Audience and tone:** ShieldBattery serves a competitive StarCraft: Brood War community, roughly
20–50 years old. Lean toward the more **casual, natural** register for each language — how a player
would actually talk — rather than formal or corporate phrasing. Per-language specifics are in the
glossary.

## The division of labor

All the mechanical, error-prone JSON work is done by a deterministic helper script, `pnpm run i18n`
([tools/i18n-translate.ts](../../../tools/i18n-translate.ts)). **You never hand-edit the JSON files** —
add new keys with `apply`, and change existing ones with `fix` (both validate tokens and re-format).
The script:

- finds keys present in `en` but missing in a target language (plural-aware)
- finds orphan keys that no longer exist in `en` (to delete)
- resolves the correct **plural forms per language** from `Intl.PluralRules` (the same CLDR data
  i18next uses at runtime)
- validates that your translations preserve every `{{interpolation}}` and `<0>` Trans tag
- merges your translations back in and re-sorts/re-formats to exactly match the parser's output

Your job is only to produce good translation **values**.

## Commands

```bash
pnpm run i18n status                       # overview: how many strings need translating / pruning per language
pnpm run i18n plan <lang> <planFile>       # write the to-translate work list as JSON
pnpm run i18n apply <lang> <resultFile>    # validate + merge translations for MISSING keys (writes nothing on error)
pnpm run i18n fix <lang> <resultFile>      # validate + overwrite EXISTING translations (quality/register fixes)
pnpm run i18n terms <lang> <query>         # look up Blizzard-matched glossary terms (matches source or target)
pnpm run i18n stale [lang] [outFile]       # find translations whose English source changed (use --since <ref>)
pnpm run i18n prune <lang>                 # delete orphan keys no longer present in `en`
pnpm run i18n normalize <lang>             # reformat (indent/sort) only, no content change
pnpm run i18n check <lang>                 # read-only audit: remaining work, orphans, token drift, format
```

Languages: `es`, `ko`, `ru`, `zh-Hans`. `en` is the source and is never a target. (`en-XA`
pseudolocale was removed — it's not in `supportedLngs`.)

## Workflow (per language)

Do one language at a time, start to finish.

### 0. One-time: normalize formatting (recommended, separate commit)

The non-`en` files were last written by Weblate using a different indent (4-space) and sort order.
The first time you touch a language, its diff will be huge because the script re-formats it to match
the parser. To keep translation diffs reviewable, do the reformat as its own commit first:

```bash
pnpm run i18n normalize es   # (and ko, ru, zh-Hans)
git add server/public/locales && git commit -m "Normalize locale file formatting"
```

After this, translation/prune diffs are clean content-only changes.

### 1. Get the work list

```bash
pnpm run i18n plan es /tmp/plan-es.json
```

Each item is either:

```jsonc
{ "key": "chat.actions.block", "type": "single", "en": "Block" }
```

or, for plurals (note `required` lists exactly the forms this language needs):

```jsonc
{
  "key": "chat.channelInfoCard.userCount",
  "type": "plural",
  "en": { "one": "{{count}} member", "other": "{{count}} members" },
  "required": ["one", "few", "many", "other"]   // ru example
}
```

### 2. Read the glossary

Read [glossary.md](./glossary.md) before translating. It defines brand/game terms that must be
translated consistently (or kept in English), and the formality register for each language. If you
establish a new term decision while translating, add it to the glossary.

For specific terms, look them up in the Blizzard-matched glossary instead of guessing:

```bash
pnpm run i18n terms ko Hunters      # → matching source/target/context rows from terms/ko.csv
```

It matches `source` or `target` (case-insensitive) and shows the `context` column, so it disambiguates
senses (e.g. `Observer` → 옵저버 the unit vs 관전자 the spectator). If it returns nothing, the term
isn't game-derived — fall back to the web research in step 3.

### 2.5. Read the grain of the existing file

**Before translating, sample the target file you're about to add to.** This is one of the biggest
quality levers and it's easy to skip. Two things to check:

- **Register.** Skim the existing values (or grep for sentence endings) to see the dominant politeness
  level, and match it — consistency within the file beats the glossary default. (Example: `ko`'s file
  is overwhelmingly 합니다체, so new Korean strings should be too, even though the glossary's casual
  default might suggest otherwise.)
- **In-file term consistency.** Grep the existing translations for recurring domain terms before
  inventing your own. If the file already renders "queue" as 대기열 and "map pool" as 맵 풀, match
  that — don't introduce 큐 / a second variant.

If you spot existing strings that are wrong or inconsistent (bad MT, mixed register), note them — and
fix them with `fix` (step 5.5) if asked.

### 3. Gather context for ambiguous strings

**From the codebase** — the dotted key path is itself strong context (`chat.actions.block` is clearly
a chat action). For anything ambiguous — short single words ("Block", "Clear", "Stop"), strings whose
meaning depends on surrounding UI, or anything with tricky interpolations — find where it's used:

- Grep for the leaf key or a distinctive part of the path, e.g. search for `channelInfoCard` or the
  English string itself across `client/` and `common/`.
- Strings are used via `t('some.key')`, `<Trans i18nKey='some.key'>`, or with a `keyPrefix`. Reading
  the surrounding component tells you whether it's a button (keep it short!), a tooltip, a heading,
  an error message, etc.

**From the web** — when you're unsure how the community actually refers to something, research it
rather than guessing or translating literally. This is where you beat generic MT. Good cases to search:

- **Map names** and **game mechanics** — ladder maps, build orders, and units often have established,
  region-specific names the community uses (frequently kept in English, or with a standard localized
  form). The Korean scene in particular has its own conventions, since it's the largest BW community.
- **Esports / scene jargon and slang** — terms a casual player would recognize that a dictionary
  translation would mangle.
- **Established renderings** of StarCraft terms in the target language (cross-check against `terms/`).

Use web search/fetch to confirm the term locals actually use; prefer that over a literal translation.

**Optional — see it in the UI.** Code context is usually enough, but when **string length or layout**
is the concern (tight spaces like buttons, tabs, menu items, table headers, fixed-width labels), it's
worth looking at the rendered UI. This is opt-in — reach for it when a translation risks overflowing,
not for every string:

- Quick visual: open the component's `devonly/` page at `/dev` (or the running web client) to see how
  much room a string has — the English text is your baseline width to stay near. The `playwright-cli`
  skill can drive the browser.
- In context, in-language: after applying, launch the app (`dev-env` skill), switch language in
  settings, and eyeball the screens for overflow/truncation (`verify-app` skill drives the real
  client).

Use all of this context to pick the right tone, length, and word sense.

### 4. Translate

Write a result file mapping each key to its translation:

```jsonc
{
  "translations": {
    "chat.actions.block": "Bloquear",
    "chat.channelInfoCard.userCount": {
      "one": "{{count}} участник",
      "few": "{{count}} участника",
      "many": "{{count}} участников",
      "other": "{{count}} участника"
    }
  }
}
```

Hard rules (the script enforces these and will reject the apply otherwise):

- **Preserve every `{{interpolation}}` exactly** — same variable names, never translate them.
- **Preserve every `<0>…</0>` / `<1/>` Trans tag exactly** — same numbers, same nesting. These map to
  React components; changing them breaks rendering.
- **Provide every form in `required`** for plural items, and no extras. Each form must keep `{{count}}`.

Quality guidelines:

- Keep button/label strings short — translations often run longer than English; long strings overflow
  UI. Check context (step 3) when unsure.
- Match ShieldBattery's voice: a community platform for competitive StarCraft: Brood War players.
  Friendly and direct, not corporate. Use the per-language register from the glossary.
- Translate meaning, not words. Idiomatic > literal.
- Leave brand/proper terms per the glossary (e.g. "ShieldBattery" stays "ShieldBattery").

You can put all items for a language in one result file, or work in batches — `apply` accepts partial
result files and reports how many items remain.

### 5. Apply

```bash
pnpm run i18n apply es /tmp/result-es.json
```

If validation fails, it prints exactly which keys/forms are wrong and writes nothing. Correct the
result file and re-run. Re-running `plan` after a partial apply gives you only what's left.

### 5.5. Fix existing translations (optional)

`apply` only adds **missing** keys. To correct translations that already exist — bad MT, wrong
register, the inconsistencies you noted in step 2.5 — use `fix` instead of hand-editing the JSON. Same
result-file shape, same token validation, and it prints a before→after for every change:

```bash
pnpm run i18n fix es /tmp/fixes-es.json
```

Only do this when the change is clearly an improvement (or the user asked). Use the English source as
the token reference — `fix` rejects anything that drops or alters an `{{interpolation}}`/`<0>` tag.

### 6. Prune orphans

```bash
pnpm run i18n prune es
```

Deletes keys that exist in `es` but no longer in `en` (the script lists each one).

### 7. Verify clean

```bash
pnpm run i18n check es
```

Should report `✓ clean` (0 to-translate, 0 orphans, 0 token drift, format normalized). `check` also
flags **token drift in pre-existing translations** — strings already in the file whose interpolations
don't match `en` (often leftover MT mistakes). Worth fixing those too while you're here.

Then move to the next language and repeat from step 1.

## Keeping translations in sync when English changes

`plan`/`apply` handle **missing** keys and `prune` handles **orphans**, but neither catches a key
whose **English wording was reworded** while the translation stayed behind — the translation is still
present and structurally valid, just translated from the old English. `check`'s token drift won't see
it either (the `{{vars}}` didn't change). That's what `stale` is for.

`stale` compares the English source at a git ref against now (parsing the JSON, so reformatting
doesn't matter) and reports keys where English changed but the target didn't:

```bash
pnpm run i18n stale                       # summary: stale count per language (since merge-base w/ origin/master)
pnpm run i18n stale ko                    # detail for one language: old vs new English + the stale translation
pnpm run i18n stale ko /tmp/stale-ko.json # also write a work list to re-translate
pnpm run i18n stale ko --since v1.2.0     # compare against any ref (tag/commit/branch) for a full back-audit
```

Default base ref is the merge-base with `origin/master` (i.e. "what this branch changed"); pass
`--since <ref>` for a wider audit. It exits non-zero when anything is stale, so it gates in CI.

**Re-translation loop** (reuses `fix`): `stale <lang> <outFile>` writes items with `enOld`, `enNew`,
`required` (for plurals), and the current stale `current` value. Re-translate each from `enNew` (use
`enOld`→`current` to see what the old translation said), write a `fix` result file, and run
`pnpm run i18n fix <lang> <file>`. Then `stale` is clean again.

### CI sketch

Add a job that fails a PR when English strings change without the translations being updated — this is
what removes the "hope the author remembered" dependency:

```yaml
# .github/workflows/i18n-stale.yml (sketch)
- run: git fetch origin master
- run: pnpm run i18n stale --since origin/master
# non-zero exit fails the job; the log lists exactly which keys/languages are stale.
```

(For a softer touch, run it as a non-blocking step that posts the stale list as a PR comment instead
of failing.)

## Notes

- Run everything from the repo root.
- Commit suggestion: one commit per language (`"Translate es strings"`), or a normalize commit + a
  translations commit, so review stays manageable.
- Optional final check: launch the app and switch language in settings to eyeball a few screens (see
  the `verify-app` skill). Not required — translations don't affect types or tests.
- If you're translating a large backlog and want speed, this workflow parallelizes cleanly across
  languages with the Workflow tool (one agent per language, or per batch of keys), but that's an
  explicit opt-in — only do it if the user asks for an orchestrated run.
