---
name: translate-i18n
description: Generate and update ShieldBattery's i18next translations (es, ko, ru, zh-Hans) from the English source strings, using full app + usage context. Use this whenever translations are out of date, a language is missing strings, or you're asked to translate/localize the UI. Produces context-aware, audience-appropriate, plural-correct translations.
---

# Translating ShieldBattery

Our UI strings live in i18next JSON files at `server/public/locales/<lang>/<namespace>.json`. `en` is
the source of truth (grown automatically by `pnpm gen-translations`, which only writes `en`). The
other languages (`es`, `ko`, `ru`, `zh-Hans`) must be filled in by translating from `en`.

The goal is translations that are clearly better than generic machine translation. We get there by
bringing in context an MT engine doesn't have: what ShieldBattery is, **where** each string appears in
the UI (a button vs. a tooltip vs. an error message), **who** is reading it, and a consistent glossary
of game/brand terms.

**Audience and tone:** ShieldBattery serves a competitive StarCraft: Brood War community, roughly
20–50 years old. Lean toward the more **casual, natural** register for each language (how a player
would actually talk) rather than formal or corporate phrasing. Per-language specifics are in
`glossary/<lang>.md`.

## The division of labor

All the mechanical, error-prone JSON work is done by a deterministic helper script, `pnpm run i18n`
([tools/i18n-translate.ts](../../../tools/i18n-translate.ts)). **You never hand-edit the JSON files.**
Add new keys with `apply`, change existing ones with `fix`, move keys with `rename`. The script:

- finds keys present in `en` but missing in a target language (plural-aware)
- finds orphan keys that no longer exist in `en` (to delete)
- resolves the correct **plural forms per language** from `Intl.PluralRules` (the same CLDR data
  i18next uses at runtime)
- validates that your translations preserve every `{{interpolation}}` and `<0>` Trans tag
- merges your translations back in and re-sorts/re-formats to exactly match the extractor's output

Your job is only to produce good translation **values**.

## Commands

Run everything from the repo root. `<lang>` is `es`, `ko`, `ru` or `zh-Hans`; most commands also
take `all`, and working on all four languages together is the normal way to use them. Use
`pnpm run -s i18n …` to drop pnpm's echo line (`check` and `stale` exit non-zero when work remains,
which without `-s` also prints an `ELIFECYCLE` line; that is not a crash).

```bash
pnpm run -s i18n status                          # both namespaces: to-translate / orphan counts per language
pnpm run -s i18n show <keyOrPrefix>... [--grep <regex>]   # en + every language side by side
pnpm run -s i18n plan <lang|all> <planFile>      # write the to-translate work list as JSON
pnpm run -s i18n apply <lang|all> <resultFile>   # validate + merge translations for MISSING keys
pnpm run -s i18n fix <lang|all> <resultFile>     # validate + overwrite EXISTING translations
pnpm run -s i18n prune <lang|all>                # delete orphan keys no longer present in `en`
pnpm run -s i18n check <lang|all>                # read-only audit: remaining work, orphans, token drift, format
pnpm run -s i18n stale [lang|all] [outFile]      # translations whose English source was reworded
pnpm run -s i18n rename <oldPrefix> <newPrefix>  # move a key or subtree in every target language
pnpm run -s i18n terms <lang> <query>            # look up Blizzard-matched game terms
```

**Namespaces.** `global.json` (the app) is the default. Pass `--ns game` (anywhere on the command
line) for `game.json`: the in-game UI's strings, which live in the Rust game DLL (`tr!` /
`tr_plural!` calls extracted by `tools/i18next-rust-plugin.mjs`) and are embedded into the DLL at
build time. Pass `--ns email` for `email/locales/<lang>/email.json`: the transactional account emails
(`email/templates/*.tsx`: email verification, password reset, username recovery, and notices of
password, email and login name changes). `status` covers every namespace; every other command works on
one at a time. Treat game strings as in-game HUD/dialog text: short, read at a glance mid-match, often
in caps labels (which are not uppercased for ko/zh-Hans). Write email strings plainly and politely, as
a service writing to its user; each `*.title` is also that email's subject line. Mailgun fills in the
`{{username}}`-style placeholders at send time, so they and the `<2>…</2>` index tags must come
through exactly as in English. After changing email translations, run `pnpm gen-emails` to re-render
the templates and subject lines the servers send.

## Workflow

Do all four languages together: one round of context gathering, then consistent choices across
languages.

### 1. See what needs doing

```bash
pnpm gen-translations            # only if English strings changed in code since `en` was last extracted
pnpm run -s i18n status          # missing + orphans, every namespace
pnpm run -s i18n stale           # reworded English whose translations stayed behind (add --ns game/email too)
pnpm run -s i18n plan all <scratchpad>/plan.json
```

`plan all` writes one work list. Each item lists the languages missing it, and for plurals the forms
each of those languages requires:

```jsonc
{
  "languages": ["zh-Hans", "ko", "ru", "es"],
  "items": [
    { "key": "chat.actions.block", "type": "single", "en": "Block", "missing": ["ru", "es"] },
    {
      "key": "chat.channelInfoCard.userCount",
      "type": "plural",
      "en": { "one": "{{count}} member", "other": "{{count}} members" },
      "missing": ["ko", "es"],
      "required": { "ko": ["other"], "es": ["one", "many", "other"] },
    },
  ],
}
```

Write plan and result files under your scratchpad directory with a normal Windows path, not `/tmp`.

### 2. Read the glossary for the languages you're touching

[glossary.md](./glossary.md) is short and applies to every language (brand names, register table,
general rules). Each language's term decisions and `game.json` conventions are in
[glossary/\<lang\>.md](./glossary/). Read the common file plus the file for each language you are
translating into. If you establish a new term decision while translating, add it to that language's
file.

For game terms (units, races, maps, tilesets, Blizzard's own UI words), look them up instead of
guessing:

```bash
pnpm run -s i18n terms ko Hunters      # → matching source/target/context rows from terms/ko.csv
```

It matches `source` or `target` (case-insensitive) and shows the `context` column, so it disambiguates
senses (e.g. `Observer` → 옵저버 the unit vs 관전자 the spectator). It covers game nouns well and
ShieldBattery UI vocabulary hardly at all; when it returns nothing, use step 3 and the web.

### 3. Read the grain of the existing files

**Before translating, look at the strings that will sit next to yours.** This is one of the biggest
quality levers and it's easy to skip. `show` prints English and all four languages side by side:

```bash
pnpm run -s i18n show lobbies.slots               # a whole subtree: the neighbors of the new keys
pnpm run -s i18n show --grep 'queue|대기열'        # every key whose value in any language matches
pnpm run -s i18n show settings.game --grep 'skin' # a regex narrows within the prefix
```

Check two things:

- **Register.** Match the dominant politeness level of the file; consistency within the file beats
  the glossary default. (Example: `ko`'s file is overwhelmingly 합니다체, so new Korean strings
  should be too, even though the glossary's casual default might suggest otherwise.)
- **In-file term consistency.** If the file already renders "queue" as 대기열 and "map pool" as
  맵 풀, match that; don't introduce 큐 or a second variant.

If you spot existing strings that are wrong or inconsistent (bad MT, mixed register, wrong sense),
fix them with `fix` in the same pass when the improvement is clear.

### 4. Gather context for ambiguous strings

**From the codebase.** The dotted key path is itself strong context (`chat.actions.block` is clearly
a chat action). For anything ambiguous (short single words like "Block", "Clear", "Stop"; strings
whose meaning depends on surrounding UI; tricky interpolations), find where it's used:

- Grep for the leaf key or the English string across `client/` and `common/` (or `game/` for the
  game namespace, `email/` for the email namespace).
- Strings are used via `t('some.key')`, `<Trans i18nKey='some.key'>`, or with a `keyPrefix`. Reading
  the surrounding component tells you whether it's a button (keep it short!), a tooltip, a heading,
  an error message, etc.

**From the web.** When you're unsure how the community actually refers to something, research it
rather than translating literally. This is where you beat generic MT: map names and game mechanics
(often kept in English or with a standard localized form; the Korean scene has its own conventions),
esports jargon and slang, and established renderings of StarCraft terms (cross-check `terms/`).

### 5. Translate and apply

Write one result file for all languages with the **Write tool** (shell heredocs break on the
apostrophes and quotes in translated text):

```jsonc
{
  "translations": {
    "chat.actions.block": { "es": "Bloquear", "ru": "Заблокировать" },
    "chat.channelInfoCard.userCount": {
      "es": {
        "one": "{{count}} miembro",
        "many": "{{count}} de miembros",
        "other": "{{count}} miembros",
      },
      "ko": { "other": "{{count}}명" },
    },
  },
}
```

A key lists only the languages that need it. Then:

```bash
pnpm run -s i18n apply all <scratchpad>/result.json   # new keys
pnpm run -s i18n fix all <scratchpad>/fixes.json      # same shape, for keys that already exist
pnpm run -s i18n prune all                            # drop orphans (lists each one)
```

`apply all` / `fix all` validate every language first and write nothing if any entry fails; the
errors name the language, key and form. On success they end with the `check` verdict per language,
which should read `✓ clean` for each. `fix` prints a before → after for every change. (The
single-language forms take `{ "translations": { "<key>": <value> } }` and behave the same way.)

Hard rules (the script enforces these):

- **Preserve every `{{interpolation}}` exactly**: same variable names, never translate them.
- **Preserve every `<0>…</0>` / `<1/>` Trans tag exactly**: same numbers, same nesting. These map to
  React components; changing them breaks rendering.
- **Provide every form in `required`** for plural items, and no extras. Each form keeps `{{count}}`.

Quality guidelines:

- Keep button/label strings short: translations often run longer than English, and long strings
  overflow UI.
- Match ShieldBattery's voice: friendly and direct, not corporate.
- Translate meaning, not words. Idiomatic > literal.
- Leave brand/proper terms per the glossary ("ShieldBattery" stays "ShieldBattery").

`check` also flags **token drift in pre-existing translations** (strings whose interpolations don't
match `en`, often leftover MT mistakes). Fix those while you're here.

### 6. Look at the strings in the real UI

Structural validation says nothing about fit or sense. Looking at the rendered screens is the only
check that catches overflow in tight spots, awkward CJK line breaks, hard-to-read fonts, and
**wrong-sense pre-existing translations** sitting next to your new strings (e.g. es rendered the
Input settings page as "Aporte", "input" in the _contribution_ sense: obvious on screen, invisible in
the JSON).

**When it's required:** new or changed short labels (buttons, tabs, chips, table and panel headers,
select options, HUD text), or a pass of more than about ten keys. For a few full sentences in roomy
places (error messages, descriptions) you may skip it, but say in your summary that the strings were
not seen on screen and why.

**When a string doesn't fit, shorten the translation.** Check how Blizzard words it (`terms`), then
the abbreviations the file already uses (`show --grep`), and `fix` the string. Don't widen or reflow
the layout to fit one language's label.

Prioritize the languages that run long (es, ru) and the tight layouts; ko/zh-Hans mostly run short.
Fix what you find with `fix`, including pre-existing neighbors.

**Web client screens** (anything reachable at `localhost:5555` without the app; `/dev` pages work for
components that have one). A logged-out browser takes its language from `navigator.languages`, so
open one browser session per language with that locale instead of clicking through settings:

```bash
echo '{"browser":{"contextOptions":{"locale":"ru-RU","viewport":{"width":1600,"height":1000}}}}' > <scratchpad>/pw-ru.json
playwright-cli -s=i18n open http://localhost:5555/<path> --config <scratchpad>/pw-ru.json
playwright-cli -s=i18n screenshot
playwright-cli -s=i18n close
```

Locale tags: `es-ES`, `ko-KR`, `ru-RU`, `zh-CN` (Simplified; `zh-TW` does not match `zh-Hans`).

**Electron-only screens** (create lobby, game settings, …): drive the real app (`dev-env` +
`verify-app` skills) and switch language in Settings → Language like a user. The choice is stored on
the account, so switch back to English when you're done (`pnpm run seed-dev` also resets the seeded
`claude-*` accounts to English); an account left in another language breaks later text-based
automation. Don't pipe `click` output to `/dev/null`: Playwright tells you when something "intercepts
pointer events", and a swallowed error looks exactly like a broken app.

**Game namespace** (`--ns game`): the in-game UI renders offline, no game launch needed. From `game/`:

```bash
cargo run -q -p overlay-ui --features preview --bin overlay-preview -- \
  --render <scratchpad>/render-ru --lang ru [--only <file-name-substring>]
```

- The binary is `overlay-preview` (hyphen) and needs `--features preview`.
- `--lang` renders only the screens listed in `PSEUDOLOCALE_PRESETS`
  (`game/overlay-ui/src/bin/overlay_preview/scenarios/`). A new screen that isn't in that list
  produces **no file and no error**; add its preset to the list first.
- Output names carry the language: `<scenario>-<preset>-<lang>-<width>x<height>.png`. List the output
  directory and confirm the files you expected exist before reading them; an empty render means the
  preset or `--only` filter didn't match, not that the screen is fine.
- The strings are embedded at build time, so a real game only shows them after `game\build.bat`.

## Keeping translations in sync when English changes

`plan`/`apply` handle **missing** keys and `prune` handles **orphans**, but neither catches a key
whose **English wording was reworded** while the translation stayed behind: the translation is still
present and structurally valid, just translated from the old English. That's what `stale` is for.

`stale` compares the English source at a base ref against now and reports keys where English changed
but the target didn't. The base is chosen per language: the merge-base with `origin/master`, or the
last commit that touched that language's file when that commit is older (which is what makes the
default useful on master itself). The output says which base each language used. Pass
`--since <ref>` to compare against a specific commit, tag or branch instead.

```bash
pnpm run -s i18n stale                               # summary: stale count + base per language
pnpm run -s i18n stale ko                            # detail: old vs new English + the stale translation
pnpm run -s i18n stale ko <scratchpad>/stale-ko.json # also write a work list to re-translate
```

The work list has `enOld`, `enNew`, `required` (for plurals) and the stale `current` value.
Re-translate each from `enNew`, write a `fix` result file, and run `fix`.

## Renaming keys

When code moves a key or a whole subtree (`transport.*` → `playbackControls.*`), carry the existing
translations along instead of re-translating or hand-editing JSON:

```bash
pnpm gen-translations                                          # `en` gets the new keys
pnpm run -s i18n rename transport playbackControls --ns game   # moves values + plural forms in all four languages
```

It refuses, writing nothing, if any destination key already exists.

## Notes

- Small passes are cheap (a handful of keys is a minute or two); don't batch them up for later.
  Untranslated keys accumulate on master otherwise.
- Commits: a few keys can go in with the change that added them. For a large catch-up pass, one
  commit per language keeps review manageable.
- If you're translating a large backlog and want speed, this workflow parallelizes across languages
  with the Workflow tool, but that's an explicit opt-in: only do it if the user asks for an
  orchestrated run.
