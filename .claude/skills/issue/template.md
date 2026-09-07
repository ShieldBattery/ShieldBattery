# Issue drafting rules (read fully before writing)

You are drafting GitHub issues for the public ShieldBattery repo. Each issue must be
self-contained: someone with the repo and the issue, and nothing else, can do the work.

## Output

One markdown file per issue. First line is the title as `# <title>`. Second line is a metadata
HTML comment with `;`-separated fields:

`<!-- type: Bug|Feature|Task ; labels: chat|lobbies|matchmaking|replays[,needs-design][,needs-decision] ; parent: [Working title] or #N ; milestone: <title> -->`

`type` and `labels` are required (`labels` may be empty when no area fits). `parent` and
`milestone` are optional. Then the seven sections below, as `## ` headings, in this order. Short is
fine. Empty is not.

## Title

A plain statement of the problem (bugs) or the outcome (features and tasks), sentence case, no
trailing period, no prefix tags. Good: "Whispers from blocked users still count as unread", "Sync
account-level settings to the server". Bad: "[Chat] Fix unread bug", "Settings sync (phase 1)".

## The seven sections

1. **Why** — the problem in one paragraph, who raised it and when. Attribution is a name and a
   date, e.g. "Raised by tec27 on Discord, 2026-09-03." NEVER quote or paraphrase-in-detail
   anything said on Discord; the Discord server is private and this repo is public. Restate the
   need in your own words. Public sources (PR review comments, existing GitHub issues) may be
   quoted.
2. **Current behavior** — what the code does today, with `path:line` pointers, written against the
   pinned commit. Open with the line `Written against <sha> (<date>).` Every pointer must be
   looked up with `git grep -n "<pattern>" <sha> -- <path>` or `git show <sha>:<path>` so the line
   numbers are real for that commit. Do not cite a line you did not read. If a claim in the brief
   turns out to be false in the code, say what the code actually does instead.
3. **Desired behavior** — acceptance criteria as testable statements, one per bullet.
4. **Decisions** — locked choices and rejected alternatives, with who locked them and when. Include
   every decision the brief gives you. If none, say "None yet." Anything still open goes under an
   **Open** sub-list, one bullet per question with your recommended answer, so a maintainer can
   settle it in a word; an issue with an Open list carries `needs-decision`, or `needs-design`
   when the answer needs options explored first.
5. **Verification** — the verify-pr tier (read `.claude/skills/verify-pr/SKILL.md`, section
   "Verification tiers" and the changed-path matrix) plus the concrete recipe: which clients, which
   flow, what to check in the DB or logs.
6. **Out of scope** — adjacent work deliberately excluded. Reference sibling issues by their
   working title in square brackets, e.g. `[Per-channel mute]`; the numbers are assigned at filing.
   Existing issues go by number.
7. **Links** — related PRs and issues by number, design pages by URL if given. No Discord links.

## Style

- Plain, direct sentences. No marketing, no hedging, no "we should consider".
- Code identifiers in backticks. Paths relative to repo root.
- Don't invent behavior. Where you are unsure, read more code; where the code is ambiguous, say so.
- Don't reference this template, the brief, memory files, or chat transcripts anywhere in the
  issue text.
- No em-dashes.
