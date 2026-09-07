---
name: issue
description: File a GitHub issue for ShieldBattery the way this repo wants them - read the code first, dedupe against the whole backlog, draft seven fixed sections pinned to a commit, show the draft, then create it with type, area label, parent and milestone set at creation. Use whenever asked to file, open, create or write up an issue or ticket; to turn a roadmap item, review finding, design decision or Discord thread into an issue; or to raise a side-issue discovered while working on something else (spin-off mode). Creates issues only - never comments, edits, relabels, assigns, closes or moves them.
---

# Filing an issue

GitHub Issues is the tracker (org Project board "ShieldBattery" #1 is fed automatically by area
labels). An issue is a self-contained brief: someone with the repo and the issue, and nothing else,
can do the work. The shape is fixed by `template.md` in this directory; #1460, #1461 and #1457 are
filed examples of it.

## Write rules (non-negotiable)

- You may **create** issues, with type, labels, parent and milestone set at creation. You may
  create a milestone when filing a multi-phase plan. Nothing else: no comments, body edits,
  relabeling, assigning, closing, reopening or board moves unless the user explicitly asks for that
  action in the current session. Comments are for humans.
- **Discord is private; the repo is public.** Anything from Discord is input only: restate the
  need in your own words with the person's name and the date. Never quote, paraphrase closely,
  paste, or link Discord messages. Public sources (PR reviews, existing issues) may be quoted.
- Show the draft before creating it. The user may cut anything. "Just file it" (or an explicit
  "file it without showing me") skips the pause; nothing else does.
- Don't invent behavior. Every code claim in the issue is verified against the pinned commit.
- No issue forms or templates get added to the repo. Outside filers write whatever they want;
  the seven sections are for issues filed from here.

## Steps

### 1. Pin the commit and read the code

```bash
git rev-parse --short=9 master && git log -1 --format=%cs master
```

Pin to the master tip unless the issue is explicitly about a branch. Every `path:line` in Current
behavior is looked up at that commit, not in the working tree:

```bash
git grep -n "<pattern>" <sha> -- <path>
git show <sha>:<path> | sed -n '120,160p'
```

Read enough to state what the code does today and why the desired change is not already there.
If the request's premise turns out to be false in the code, the issue says what the code actually
does and the chat reply says the premise was off.

### 2. Dedupe against the whole backlog

The 100+ open issues without an area label are an untriaged inbox and count. Search titles and
bodies, open and closed:

```bash
gh issue list --state all --limit 50 --search "<keyword> <keyword>"
gh issue list --state open --label <area> --limit 100
```

- Exact match open: report it in chat and stop; do not file a duplicate.
- Old stub on the same topic (a one-line placeholder): file the full issue and tell the user the
  stub exists; closing it as a duplicate is their call (or an explicit instruction to you).
- Closed match: read why it was closed before re-raising; say so in chat.

### 3. Classify

| Axis | Rule |
| --- | --- |
| Type | `Bug` (wrong behavior today), `Feature` (new user-facing behavior), `Task` (design, cleanup, infra). Org-level issue types; the legacy `bug`/`enhancement` labels are not used. |
| Area label | One of `chat`, `lobbies`, `matchmaking`, `replays`: a long-running area, never a feature. The label puts the issue on the board (labeling is the triage act). If none fits, file with no area label and say in chat that it lands in the inbox. |
| `needs-design` | Add when a product or visual decision gates implementation. |
| Parent | Native sub-issue of a parent when the issue is one phase of a multi-phase plan or one PR of a stacked chain. Design docs live in the parent's body (`docs/` only when they outgrow it). |
| Milestone | One per multi-phase plan (e.g. "Chat commands"), on the parent and every child. |

### 4. Draft

Write the draft to the session scratchpad as `issues/<slug>.md` following `template.md` exactly
(title line, metadata line, seven sections). For a batch, write a `BRIEF.md` in that directory
covering the shared facts (pinned commit, supersession order of decisions, attribution rules, the
table of working titles with type/labels/parent/milestone) and have one subagent per one or two
issues draft against the pinned commit; review every draft in the main loop for verified pointers,
correct attribution, no Discord content, and scope that matches one PR. Cross-reference sibling
drafts by `[Working title]`; numbers are substituted at filing.

Section reminders beyond the template: Decisions carries every locked choice AND every rejected
alternative with who/when, so nobody re-proposes them; Verification names the verify-pr tier and a
concrete recipe (which clients, which flow, what to check); Out of scope names the neighbours.

### 5. Show it

Single issue: the full draft in chat. Batch: a table of titles with type/labels/parent plus the
drafts' paths, and the full text of anything the user asked to see. Then wait. Apply cuts and
edits to the draft files, not in your head.

### 6. Create

Single issue (`gh` 2.94+ sets type and milestone directly):

```bash
gh issue create --title "<title>" --body-file <draft-without-title-and-metadata> \
  --label chat --type Feature --milestone "Chat commands"
```

Then, if it has a parent, link it as a native sub-issue:

```bash
gh api graphql -f query='mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ issue{number} subIssue{number} } }' \
  -f p=<parent node id> -f c=<child node id>     # ids from: gh issue view N --json id -q .id
```

Batch (parent + children, cross-references, milestone creation): `file_issues.py` in this
directory. Dry run first; it validates types, labels, parents and unresolved `[Working title]`
references and says which milestone it would create. `--create` files in order, links sub-issues,
then rewrites `[Working title]` to `#N` in the filed bodies, and is idempotent via `filed.json`
next to the drafts.

```bash
python .claude/skills/issue/file_issues.py <draft-dir>            # dry run
python .claude/skills/issue/file_issues.py --create <draft-dir>
```

Report the URLs. An issue with an area label lands on the board in Todo by itself; don't touch the
board.

## Spin-off mode

While working on issue #N and something unrelated turns up (a bug in adjacent code, a missing
endpoint, a design gap), don't widen the current work. Spawn a background `fork` subagent with the
finding and this skill's steps 1-4; it drafts to the scratchpad and returns. Its Why section opens
with "Raised while working on #N, <date>." Show the draft with your next report on the main task;
file it only on the go-ahead (or immediately if the user already said "just file it" for
spin-offs this session).

## Don'ts

- Don't relabel, comment on, edit, assign, close or reopen anything, including issues you created
  earlier in the session, unless asked.
- Don't add "raised by Claude" or any attribution lines; the account filing it is the author.
- Don't put Discord text, links or message ids anywhere in an issue.
- Don't describe branches, memory files, chat transcripts or "the plan doc"; the issue stands on
  its own.
- Don't use em-dashes.
