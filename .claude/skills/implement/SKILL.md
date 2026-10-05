---
name: implement
description: Implement a GitHub issue end to end (`/implement #N`) - read the issue and its parent, verify its premise against the pinned commit and current master BEFORE writing code, report drift in chat, build on a short branch within the issue's stated scope, verify at the tier the issue names (screenshotting visible UI changes for the developer), and open a PR with `Fixes #N`. Never comments on the issue or edits a body a person wrote; keeps the assignee accurate. Use when asked to implement, work on, pick up, build, or fix an issue by number.
---

# Implementing an issue

Issues filed from this repo carry seven sections (Why, Current behavior pinned to a commit, Desired
behavior, Decisions, Verification, Out of scope, Links). The issue is the spec; the Decisions
section is settled; the Desired behavior bullets are the acceptance criteria. Hand-filed issues may
have none of that: then step 2 is where you build the missing spec, in chat, before coding.

## Rules

- **Never speak as the user on the issue.** No comments. No body edits either, unless the issue
  is one you filed yourself through the `issue` skill: that body is your own text and you may keep
  it current. Drift, questions and progress go in chat and in the PR body regardless. Assignee
  and labels are metadata, not speech; keep them accurate (step 3 assigns the issue; the PR's
  `Fixes #N` line closes it on merge).
- **Premise before code.** Nothing is written until the drift report (step 2) is in chat.
- **Scope is the issue.** Desired behavior in, Out of scope out. Anything else you find becomes a
  spin-off issue via the `issue` skill, not part of this PR.
- **Decisions are locked; rejected alternatives are off the table.** If the code makes a locked
  decision impossible, stop and say so; don't quietly pick the rejected option.
- **Open decisions are a soft gate, not a wall.** A `needs-design` or `needs-decision` label, or a
  dependency that is not on master yet, means the maintainers still owe the issue something. Say
  so once, with your recommendation for each open item, and wait. If the user still says go, they
  are asking for your judgment, not for another question: build on your recommendations and record
  every call in the PR body.

## Steps

### 1. Fetch the issue and its context

```bash
gh issue view N --json number,title,body,labels,milestone,state,url,assignees
gh api graphql -f query='{ repository(owner:"ShieldBattery", name:"ShieldBattery"){ issue(number:N){ parent{ number title } subIssues(first:20){ nodes{ number title state } } } } }'
gh pr list --state all --search "N in:body" --json number,title,state,headRefName
```

Stop and report if the issue is closed, or already has an open PR that references it. If it has a
parent, read the parent's Decisions and rejected alternatives too; they apply. If it has
sub-issues, it is a parent: implement a child, not the parent.

Then check readiness: an issue is ready when no `needs-*` label remains, every dependency in Links
is on master and the issue is not a parent. If it carries `needs-design` or `needs-decision`, or a
dependency is still open, post in chat before anything else:

- each open item in Decisions, each design question, and each dependency in Links that is not on
  master yet;
- your recommended answer for each, one line; for `needs-design`, the two or three options in a
  line each and which one you would build.

Then ask once whether to proceed. A go-ahead, in chat or in the invocation itself ("implement #N,
go with your calls"), means: build on your recommendations, leave the issue's body and `needs-*`
labels as they are, and list every call in the PR body under **Calls made** so the author can
override at review. A go-ahead does not skip step 2 and does not widen the scope.

### 2. Verify the premise and report drift

Take the `Written against <sha>` line. For every `path:line` pointer and every claim in Current
behavior, check it at that commit and at current master:

```bash
git show <sha>:<path> | sed -n 'L,L+10p'      # should match the claim
git log --oneline <sha>..master -- <path>     # what changed since
git grep -n "<symbol>" master -- <path>       # where it lives now
```

Also check whether any Desired behavior bullet is already true on master (someone may have shipped
part of it). Then post a short drift report in chat before writing code:

- **Holds**: claims still true on master (one line, no need to list them all).
- **Moved**: pointers whose code moved or was renamed, with the new location.
- **Changed**: claims no longer true, with what the code does now.
- **Already done**: acceptance criteria master already satisfies.

If drift is cosmetic, proceed. If a Current behavior claim the design rests on is false, or a locked
decision conflicts with what master now does, stop with a specific question. If the issue lacks a
pinned commit or pointers (hand-filed), write the Current behavior yourself in chat, at master, and
proceed on that.

### 3. Branch

Short, descriptive, no issue number: `friend-presence`, `emote-flag`, not `issue-1462-esc-jumps`.
From master. A child of a stacked chain branches from the previous child's branch. Stacked branches
stay linear: each carries only its own commits on top of its parent, so when the parent moves,
`git rebase --onto <parent-tip> <old-parent-tip>` the child and push with `--force-with-lease`;
never merge the parent in. When a stack merges bottom-up, retarget the child PR's base to master
before the parent's branch is deleted, or GitHub auto-closes the child.

Once the branch exists, mark the issue as being worked on by assigning the user, so the issue list
shows what is in flight while the PR is open:

```bash
gh issue edit N --add-assignee "$(gh api user --jq .login)"
```

Closing or reopening an issue is a bigger act than assigning and still waits for the user to ask.

### 4. Build

Follow `AGENTS.md`. Keep `TODO(context)`/`NOTE(context)` comments; write comments that stand alone
(no "per issue #N" in code; the commit message carries provenance). Run codegen after schema
changes (`pnpm run gen-graphql`, `pnpm run gen-typeshare`), `pnpm run gen-translations` after any
client string change, `cargo fmt` + clippy for Rust. Delete code the change makes unused.

While building, anything outside the issue's scope that needs fixing is a spin-off (`issue`
skill, spin-off mode), mentioned in your report, not fixed here.

### 5. Verify at the issue's tier

The issue's Verification section names a verify-pr tier and a recipe. Run that tier (see
`.claude/skills/verify-pr/SKILL.md`; T2+ means the real Electron app via the `verify-app` skill,
T3 means two clients, T4 a real game). Run the recipe as written, plus lint, typecheck and the
nearby unit tests. Record what you ran and what you saw; failures are reported verbatim, not
smoothed over.

#### Screenshots of UI changes

When the change is something a reviewer would want to _see_, capture it while you verify: a new
or reworked component, dialog, page or layout; a new state (empty, error, loading, overflow); a
visual restyle. Skip it for copy tweaks, a one-off spacing or color nudge, logic-only or
server-only changes, and anything whose visible result is just "the bug no longer happens".
One to three shots is the norm; each should earn its place.

- Shoot the real app through `verify-app` (`playwright-cli screenshot --filename=<path>`), not a
  `/dev` page, unless the issue's recipe is the devonly page. Crop to the element
  (`playwright-cli screenshot <ref>`) when the change is local; take the full window only when
  the layout is the point.
- Save under `.claude-scratch/screenshots/<branch>/` with names that say what they show
  (`empty-state.png`, `before-dialog.png`). Under `MSYS_NO_PATHCONV=1`, pass `C:/...` paths to
  `--filename` or nothing is written. Screenshots stay local: they are for the developer (step 7),
  never committed, uploaded or linked from the PR.
- **Look at every shot with Read before using it**: confirm it shows the change, the right state
  and no unrelated debris (devtools, half-finished animations, another client's window). The
  Read tool caches images by path, so a retake needs a new filename.
- Before/after pairs only when the change alters existing UI and the comparison is the point.
  Take the "before" shots before your first edit, while the dev stack still runs master (step 3's
  branch has no changes yet); don't switch branches back later just to get them.
- **The folder holds only the shots you'll show, nothing else.** Captures taken purely as
  evidence while verifying go in the session scratchpad, not here. Before reporting, prune it:
  one version per shot (keep the crop, delete the uncropped original), and no shot whose point is
  something _not_ being there (an empty strip proving a message is hidden, a list without the
  removed row). Say that in the report text instead. An image only helps when it shows something.

### 6. Open the PR

Commit with the repo's message style (one imperative subject sentence ending in a period, body only
if warranted, no attribution lines). Then:

```bash
gh pr create --title "<subject>" --body-file <body.md>
```

PR body:

- One paragraph: what changed and why (the issue's Why, condensed).
- `Fixes #N` on its own line (`Part of #N` if the PR is one of several for the issue; the last one
  says `Fixes`).
- Acceptance criteria as a checklist copied from the issue's Desired behavior, each checked with
  how it was verified, unchecked with why it is deferred.
- Drift notes from step 2 if there were any.
- **Calls made**, when step 1 flagged open decisions: each one, the option you built and the ones
  you passed on.
- Verification performed, tier and outcome.

Draft PR if verification is incomplete. After pushing, the `pr-fix` skill
(`.claude/skills/pr-fix/SKILL.md`) handles CI and review comments.

### 7. Report

In chat: the PR URL, which acceptance criteria are met and which are not, drift that mattered, the
calls you made on a go-ahead, spin-off drafts awaiting a go-ahead, and what the next child in the
chain is if this was one.

If step 5 took screenshots, show them to the developer: link the folder once as a markdown
`file:///` link (`[.claude-scratch/screenshots/<branch>/](file:///C:/.../screenshots/<branch>/)`,
forward slashes, absolute path) so it opens straight from the terminal, then a one-line caption
per file by name. Don't link each file. Send them with `SendUserFile` when that tool is available.
