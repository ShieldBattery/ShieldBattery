---
name: implement
description: Implement a GitHub issue end to end (`/implement #N`) - read the issue and its parent, verify its premise against the pinned commit and current master BEFORE writing code, report drift in chat, build on a short branch within the issue's stated scope, verify at the tier the issue names, and open a PR with `Fixes #N`. Never edits the issue. Use when asked to implement, work on, pick up, build, or fix an issue by number.
---

# Implementing an issue

Issues filed from this repo carry seven sections (Why, Current behavior pinned to a commit, Desired
behavior, Decisions, Verification, Out of scope, Links). The issue is the spec; the Decisions
section is settled; the Desired behavior bullets are the acceptance criteria. Hand-filed issues may
have none of that: then step 2 is where you build the missing spec, in chat, before coding.

## Rules

- **Never edit the issue.** No body edits, comments, labels, assignees or board moves. Drift,
  questions and progress go in chat and in the PR body.
- **Premise before code.** Nothing is written until the drift report (step 2) is in chat.
- **Scope is the issue.** Desired behavior in, Out of scope out. Anything else you find becomes a
  spin-off issue via the `issue` skill, not part of this PR.
- **Decisions are locked; rejected alternatives are off the table.** If the code makes a locked
  decision impossible, stop and say so; don't quietly pick the rejected option.

## Steps

### 1. Fetch the issue and its context

```bash
gh issue view N --json number,title,body,labels,milestone,state,url
gh api graphql -f query='{ repository(owner:"ShieldBattery", name:"ShieldBattery"){ issue(number:N){ parent{ number title } subIssues(first:20){ nodes{ number title state } } } } }'
gh pr list --state all --search "N in:body" --json number,title,state,headRefName
```

Stop and report if the issue is closed, or already has an open PR that references it. If it has a
parent, read the parent's Decisions and rejected alternatives too; they apply. If it has
sub-issues, it is a parent: implement a child, not the parent.

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
- Verification performed, tier and outcome.

Draft PR if verification is incomplete. After pushing, the `pr-fix` skill
(`.claude/skills/pr-fix/SKILL.md`) handles CI and review comments.

### 7. Report

In chat: the PR URL, which acceptance criteria are met and which are not, drift that mattered,
spin-off drafts awaiting a go-ahead, and what the next child in the chain is if this was one.
