# Blizzard-matched term glossaries

This directory holds our terminology glossaries, one CSV per target language, exported from Weblate.
**Most entries are exported directly from the game's own translations**, so they're the authoritative
way to match the strings StarCraft: Remastered shows in-game. Prefer them over any other rendering.

Files (one per target language):

```
terms/es.csv
terms/ko.csv
terms/ru.csv
terms/zh-Hans.csv
```

## File format

Standard Weblate glossary CSV export with a header row:

```
location,source,target,id,fuzzy,context,translator_comments,developer_comments
```

| column | meaning |
| --- | --- |
| `source` | English term |
| `target` | the approved translation in this language (use this) |
| `context` | disambiguation when present — e.g. `Race`, `Game type`, `Map tileset` |
| `fuzzy` | `True` means unreviewed/uncertain; treat with lower confidence (currently all `False`) |
| `translator_comments` / `developer_comments` | extra notes when present |
| `location` / `id` | Weblate bookkeeping; ignore |

Use `target` for the translation, and read `context` to pick the right sense when the same English
word maps to different terms. An unmodified Weblate export drops in as-is. (Note: this CSV format has
no flags column, so forbidden/read-only markers aren't included.)

## How to export from Weblate

Our glossaries are Weblate glossary components. Any of these work — pick one:

**Web UI:** open the glossary component → select the language → *Files* → *Download translation* →
choose **CSV** (or **TBX** if you prefer a standard termbase). Save it here as `<lang>.csv`.

**API** (needs an API token; replace the project/component slugs):

```bash
# CSV
curl -H "Authorization: Token $WEBLATE_TOKEN" \
  "https://<weblate-host>/api/translations/<project>/<glossary-component>/<lang>/file/?format=csv" \
  -o es.csv
```

**`wlc` CLI:**

```bash
wlc download <project>/<glossary-component>/<lang> --format csv > es.csv
```

TBX is also fine if that's easier to get — drop the `.tbx` here and note it; we can add a converter to
CSV if needed.

## Refreshing

Re-export whenever the Weblate glossary changes. These files are the source of truth for terminology
going forward (Weblate itself is being retired for translation, but its glossary data is worth
keeping). Consider committing updates separately from string translations.
