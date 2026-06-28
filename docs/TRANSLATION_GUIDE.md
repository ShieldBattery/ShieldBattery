# Translation Guide

ShieldBattery's translations are managed with the **`translate-i18n` Claude Code skill** and its
`pnpm run i18n` helper, which live in
[`.claude/skills/translate-i18n/`](../.claude/skills/translate-i18n/). This replaces our old Weblate
workflow — the agent generates and maintains translations directly from the English source, using the
full context of the app, the place each string is used, and a Blizzard-matched terminology glossary.

If you'd like to help with translations or flag a bad one, the fastest path is still our
[Discord](https://discord.gg/g5mmNVfZzm) — native-speaker review is the one thing the tooling can't do
for itself (see [Reviewing & contributing](#reviewing--contributing) below).

## How it works

- **English is the source of truth.** It's generated from the code by `pnpm run gen-translations`
  (which only ever writes `en`). The other languages — `es`, `ko`, `ru`, `zh-Hans` — are translated
  from it.
- Translation files live at `server/public/locales/<lang>/global.json`.
- The **skill** drives the translation; the **`pnpm run i18n` helper**
  ([tools/i18n-translate.ts](../tools/i18n-translate.ts)) owns all the mechanical JSON work so a
  translation can never silently corrupt a file: it finds missing/stale/orphaned keys, enforces
  plural correctness and placeholder/tag preservation, looks up glossary terms, and re-formats output
  to match the parser exactly.

## Quick start

In Claude Code, from the repo root:

```
/translate-i18n ko
```

…or just ask: *"translate the missing Korean strings"* / *"check if any translations are stale"*. The
agent will find what's missing, gather context (including web research for community terminology when
needed), translate with the glossary and the right plural forms, validate, apply, prune dead keys, and
verify the file is clean. One language at a time.

You don't need Claude Code to run the read-only checks — `pnpm run i18n status`, `stale`, and `check`
are useful on their own (e.g. in CI).

## What makes it better than generic machine translation

- **Blizzard-matched terminology.** Per-language glossaries in
  [`terms/`](../.claude/skills/translate-i18n/terms/) are exported from the game's own translations,
  so the UI reads consistently with StarCraft: Remastered itself (e.g. `异虫` for Zerg in Chinese).
  Look terms up with `pnpm run i18n terms <lang> <query>`.
- **Audience-appropriate register.** A [glossary](../.claude/skills/translate-i18n/glossary.md) records
  the tone and per-language decisions (e.g. casual community phrasing, `빨무`/`헌터` for the Korean
  map names) so translations read like a player wrote them, and stay consistent across ~1000 strings.
- **Correct plurals.** Plural forms are resolved per language from `Intl.PluralRules` (the same CLDR
  data i18next uses), so `ru` gets one/few/many/other and `ko`/`zh-Hans` get the single form they need
  — automatically.
- **Placeholders & tags are protected.** Every `{{interpolation}}` and `<0>…</0>` Trans tag is
  validated on write; a translation that drops or mangles one is rejected.
- **Context-aware.** The agent reads where each string is used in the client, researches how the
  community actually refers to maps/mechanics, and matches the existing file's register and term
  choices.
- **Stale detection.** When an English string is reworded, the other languages don't silently fall
  behind — `pnpm run i18n stale` flags translations made against an older English source.

## Command reference

Run from the repo root.

| Command | Purpose |
| --- | --- |
| `pnpm run i18n status` | Per-language counts of strings still to translate / prune |
| `pnpm run i18n plan <lang> [outFile]` | Write the list of missing strings to translate |
| `pnpm run i18n apply <lang> <resultFile>` | Validate + merge translations for **missing** keys |
| `pnpm run i18n fix <lang> <resultFile>` | Validate + overwrite **existing** translations (quality/register fixes) |
| `pnpm run i18n terms <lang> <query>` | Look up Blizzard-matched glossary terms |
| `pnpm run i18n stale [lang] [outFile]` | Find translations whose English source changed (`--since <ref>`) |
| `pnpm run i18n prune <lang>` | Delete orphaned keys no longer present in `en` |
| `pnpm run i18n normalize <lang>` | Reformat a file (indent/sort) to match the parser, no content change |
| `pnpm run i18n check <lang>` | Read-only audit: remaining work, orphans, plurals, placeholder drift, format |

The deeper step-by-step workflow lives in the skill itself:
[SKILL.md](../.claude/skills/translate-i18n/SKILL.md).

## Keeping translations in sync when English changes

When someone changes the wording of an English string, the translations are still present and valid —
just translated from the old text. `stale` catches exactly this (it's invisible to the other checks
because the placeholders didn't change):

```bash
pnpm run i18n stale                       # per-language summary (since the merge-base with origin/master)
pnpm run i18n stale ko /tmp/stale-ko.json # detail + a re-translation work list to feed `fix`
pnpm run i18n stale ko --since v1.2.0     # audit against any tag/commit
```

It exits non-zero when anything is stale, so it can gate a PR in CI — turning "hope the author
remembered to update the translations" into an automatic check. See SKILL.md for a CI sketch.

## Localization philosophy

The best player experience comes from **localization, not literal translation**. If a regional
community calls it `1:1` instead of `1v1`, or `빨무` instead of "Fastest", that's what they're looking
for — and that's what we present. Lean toward the casual, natural register a player would actually use
(ShieldBattery's audience is the competitive Brood War community), and keep terminology consistent via
the glossary.

## Placeholders & special characters

Some strings contain special markup that must be preserved exactly (the tooling enforces this, but
it's good to understand):

- Text in `{{braces}}` (e.g. `{{count}}`, `{{name}}`) is a **code reference** — never translate it.
- Numeric tags like `<0>…</0>` / `<1/>` map to **React components**. Their text can be translated and
  even reordered to read naturally, but the tags and their numbering must be preserved.

## Reviewing & contributing

The tooling guarantees translations are *structurally* correct (placeholders, plurals, completeness)
and *consistent*, but it can't judge whether a phrase reads naturally to a native speaker — that's
where you come in.

- Spotted a translation that's wrong, stiff, or just not what your community says? Tell us on
  [Discord](https://discord.gg/g5mmNVfZzm) (the `#translations` channel). Concrete suggestions —
  "the Play button should say X, not Y" — are ideal, and we'll feed them straight into a `fix`.
- Native-speaker corrections also get recorded in the glossary so they stick for every future pass.
