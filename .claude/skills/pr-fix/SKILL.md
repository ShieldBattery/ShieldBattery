---
name: pr-fix
description: Bring a ShieldBattery PR to green and work through its review (`/pr-fix`, `/pr-fix N`) - read CI for the PR's head commit, tell a real regression from this repo's known flakes and rerun the flakes, verify every review claim against the code before changing anything, push fixes, then resolve the threads and minimize the comments that were addressed. Never posts replies or comments as the user. Use when asked to fix CI, address review, check on a PR, or after the implement skill has pushed one.
---

# Fixing up a PR

## Rules

- **Never write to the PR conversation as the user.** No replies, comments or reviews. Resolving a
  thread and minimizing a comment are the only writes. Disagreement with feedback goes in chat.
- **Verify before acting.** A reviewer, human or `claude[bot]`, can be wrong about the code. Check
  the claim in the tree before changing anything; a claim that doesn't hold is reported, not fixed.
- **Flakes get reruns, regressions get fixes.** Never both for the same failure.
- **Ordinary commits.** Fixes are new commits on the PR branch in the repo's message style. No
  amend or force-push except when rebasing a stacked child (step 4).

## Steps

### 1. Find the PR

```bash
gh pr view [N] --json number,headRefName,baseRefName,headRefOid,isDraft,url
git checkout <headRefName> && git pull --ff-only
```

Without a number, the PR is the current branch's. If there is none, ask which PR; don't guess from
`gh pr list`.

### 2. Read CI

```bash
gh pr checks N                                   # one line per job, with run links
gh run view <run-id> --json event,headSha,conclusion
gh run view <run-id> --log-failed | tail -80
```

What runs, and when:

| Workflow           | Jobs                                                                                                               | Runs on                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| JS CI              | `unit-tests`: vitest, typecheck, lint, circular-deps, translation catalogs, email templates, graphql codegen check | every `push` and `pull_request`                                          |
|                    | `integration-tests`: docker compose stack + Playwright                                                             |                                                                          |
| Game CI            | clippy (x86, x64), rustfmt, cargo test (x86, x64)                                                                  | `game/**`                                                                |
| server-rs CI       | clippy, rustfmt, cargo test + `gen-schema` check, typeshare check, `sqlx prepare` check                            | `server-rs/**`, `migrations/**`, `schema.graphql`, `common/typeshare.ts` |
| Claude Code Review | `claude-review`: posts a review from `claude[bot]`                                                                 | PR opened, synchronize, reopened, ready for review                       |

Reading the results:

- Every commit gets two runs of each workflow, one `push` and one `pull_request`. Both report the
  branch's head SHA, but `push` builds the branch tip and `pull_request` builds the branch merged
  into master. A split result on the same SHA is a flake only when the branch is up to date with
  master (`git fetch origin && git log --oneline HEAD..origin/master` prints nothing). Otherwise
  the two runs built different code: a `pull_request`-only failure means the branch breaks once
  merged, so rebase onto master, reproduce locally, and fix it as a regression; a `push`-only
  failure means master already carries the fix, and the rebase clears it.
- All workflows cancel in-progress runs on a new push, so a pending rerun on the previous SHA ends
  as `cancelled`. That is not a failure.
- `claude` (the mention-triggered workflow) shows as `skipping` on every PR. Normal.

Known flakes, both in `integration-tests`. Rerun with `gh run rerun <run-id> --failed`:

- Step "Running Docker containers": `service "migration" didn't complete successfully: exit 1`. The
  migration container connected before postgres was ready to serve queries.
- Signup spec: `apiRequestContext.get: socket hang up` on `http://localhost:5528/sent/...`. The fake
  mailgun sidecar dropped a connection.

Anything else is a regression until proven otherwise: read the failed log, reproduce with the local
equivalent, fix.

```bash
pnpm test && pnpm run typecheck && pnpm run lint && pnpm run check-circular
pnpm gen-translations:app --fail-on-update && pnpm gen-translations:email --fail-on-update
pnpm gen-emails && pnpm gen-graphql && git status --short     # generated files must be clean
(cd server-rs && cargo clippy --all-targets --workspace -- -D warnings && cargo fmt --all -- --check)
(cd game && cargo clippy --all-targets --workspace -- -D warnings && cargo fmt --all -- --check)
pnpm sqlx-prepare && git status --short server-rs/.sqlx
```

### 3. Read the review

Three sources; the top-level one is the one that gets missed:

```bash
# inline threads, with ids and resolved state
gh api graphql -f query='{ repository(owner:"ShieldBattery", name:"ShieldBattery") { pullRequest(number:N) { reviewThreads(first:100) { nodes { id isResolved isOutdated path line comments(first:10) { nodes { databaseId author { login } body } } } } } } }'
# top-level comments (node_id is what minimizeComment takes)
gh api repos/ShieldBattery/ShieldBattery/issues/N/comments --paginate --jq '.[] | {node_id, user: .user.login, created_at, body}'
# review bodies
gh pr view N --json reviews --jq '.reviews[] | {author: .author.login, state, body}'
```

Unaddressed feedback is every unresolved thread plus every top-level comment or review body that
isn't minimized. For each item, check the claim before touching code:

- "X doesn't exist", "X is unused", "the repo already does Y": grep for it.
- Formatting claims: `pnpm exec prettier --check <file>`. Character counts in a comment are not
  evidence.
- A thread from an earlier round may describe code that a later commit already changed: GitHub
  re-anchors unresolved comments to the new head. Compare against the commit the comment was written
  on before treating it as open.
- Suggestion blocks can be malformed. Apply the idea by hand, then prettier.

`claude[bot]` reviews again on every push, so the loop only continues while you keep pushing. Batch
fixes into one push. When a round contradicts an earlier round, settle on the better design once,
say why in chat, and resolve both threads rather than flipping the code back and forth.

### 4. Fix and push

Commit on the PR branch; run the local gates from step 2 for what you touched. On a stacked PR,
fix at the tip when the change is local to it. A fix that belongs to a parent branch goes on the
parent, then each child is rebased onto its parent's new tip
(`git rebase --onto <parent-tip> <old-parent-tip>`) and pushed with `--force-with-lease`; never
merge the parent into the child.

After pushing, wait for the new runs (`gh pr checks N --watch`) and repeat step 2 until green or
blocked on something only the user can decide.

### 5. Bookkeeping

```bash
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_..."}) { thread { isResolved } } }'
gh api graphql -f query='mutation { minimizeComment(input:{subjectId:"IC_...", classifier:RESOLVED}) { minimizedComment { isMinimized } } }'
```

Resolve a thread only once its fix is pushed. Leave open anything you disagreed with and anything
that asks the user a question. Minimize a top-level comment once every point in it is handled.

### 6. Report

In chat: CI per job, naming which failures were flakes rerun and which were regressions fixed; each
feedback item with how it was addressed or why it was skipped; what was resolved or minimized; and
what is still open, with the reason.
