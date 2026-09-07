"""File GitHub issue drafts via the `gh` CLI.

Usage:
    python file_issues.py [--create] [--repo OWNER/NAME] <draft-dir | draft-file ...>

Default is a dry run: it parses every draft, resolves types/labels/milestones/parents
against the live repo, and prints a plan plus any problems it finds. Pass --create to
actually file the issues (idempotently -- see below).

--repo defaults to the repo `gh` infers from the current directory.

If a single directory is given, every `*.md` file in it is used as a draft, except ones
whose name starts with "_", "TEMPLATE", or "BRIEF" -- sorted by file name. Otherwise, each
path given is treated as a draft file, in the order given.

Draft format
------------
The first line of a draft is its title:

    # Add a widget to the sidebar

Somewhere in the next four lines (so within the first five lines of the file) there must
be a single-line HTML comment with ";"-separated "key: value" metadata fields:

    <!-- type: Feature ; labels: chat,needs-design ; parent: [Working title] ; milestone: Chat commands -->

- type (required): one of the issue types configured in the repo (e.g. Bug, Feature, Task).
- labels (required, may be empty): comma-separated label names, all of which must exist.
- parent (optional): either the "[Working title]" of another draft being filed in the same
  run, or "#123" for an issue that already exists. Creates a GitHub sub-issue link.
- milestone (optional): a milestone title. Created automatically if it doesn't exist yet.

Everything after the metadata line, stripped of leading/trailing blank lines, is the issue
body. Within the body, "[Working title]" (matching another draft's title exactly) may be
used to cross-reference a sibling draft; after all drafts in a run are filed, every such
reference is rewritten to "#<number>" in a post-pass.

Create mode and idempotency
----------------------------
--create writes `filed.json` next to the drafts, recording each filed issue's number, node
id, URL and title (plus "linked"/"refs_resolved" flags once those steps complete). Re-running
with --create skips anything already recorded, so an interrupted run can simply be re-run.

Requires the `gh` CLI to be authenticated with access to the target repo.
"""

from __future__ import annotations

import argparse
import dataclasses
import glob
import json
import os
import re
import subprocess
import sys
from typing import Optional

# ---------------------------------------------------------------------------
# gh CLI / GraphQL helpers
# ---------------------------------------------------------------------------


def run_gh(args: list[str], input_text: Optional[str] = None) -> str:
    """Run a `gh` command and return its stdout, or raise SystemExit with its stderr."""
    proc = subprocess.run(
        ["gh", *args],
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise SystemExit(f"gh {' '.join(args)} failed:\n{proc.stderr.strip()}")
    return proc.stdout


def graphql(query: str, variables: dict) -> dict:
    payload = json.dumps({"query": query, "variables": variables})
    out = run_gh(["api", "graphql", "--input", "-"], input_text=payload)
    data = json.loads(out)
    if data.get("errors"):
        raise SystemExit(f"GraphQL error:\n{json.dumps(data['errors'], indent=2)}")
    return data["data"]


def current_repo() -> str:
    return run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).strip()


# ---------------------------------------------------------------------------
# Repo metadata (labels, issue types, open milestones) -- resolved at runtime,
# never hardcoded.
# ---------------------------------------------------------------------------

REPO_META_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    labels(first: 100) { nodes { id name } }
    issueTypes(first: 50) { nodes { id name } }
    milestones(states: OPEN, first: 100) { nodes { id number title } }
  }
}
"""


@dataclasses.dataclass
class RepoMeta:
    repo: str
    owner: str
    name: str
    id: str
    label_ids: dict[str, str]
    type_ids: dict[str, str]
    milestones: dict[str, dict]  # title -> {"id": ..., "number": ...}


def fetch_repo_meta(repo: str) -> RepoMeta:
    owner, _, name = repo.partition("/")
    data = graphql(REPO_META_QUERY, {"owner": owner, "name": name})["repository"]
    return RepoMeta(
        repo=repo,
        owner=owner,
        name=name,
        id=data["id"],
        label_ids={n["name"]: n["id"] for n in data["labels"]["nodes"]},
        type_ids={n["name"]: n["id"] for n in data["issueTypes"]["nodes"]},
        milestones={n["title"]: {"id": n["id"], "number": n["number"]} for n in data["milestones"]["nodes"]},
    )


def ensure_milestone(meta: RepoMeta, title: str) -> dict:
    """Return {"id", "number"} for an open milestone, creating it via REST if needed."""
    existing = meta.milestones.get(title)
    if existing is not None:
        return existing
    payload = json.dumps({"title": title})
    out = run_gh(["api", f"repos/{meta.repo}/milestones", "--method", "POST", "--input", "-"], input_text=payload)
    data = json.loads(out)
    created = {"id": data["node_id"], "number": data["number"]}
    meta.milestones[title] = created
    return created


# ---------------------------------------------------------------------------
# Draft parsing
# ---------------------------------------------------------------------------

METADATA_COMMENT_RE = re.compile(r"<!--(.*?)-->")
METADATA_LINES_SEARCHED = 5


class DraftError(Exception):
    pass


@dataclasses.dataclass
class Draft:
    stem: str
    path: str
    title: str
    type: str
    labels: list[str]
    parent: Optional[str]  # raw metadata value: "[Working title]" or "#123"
    milestone: Optional[str]
    body: str


def parse_metadata_fields(line: str) -> Optional[dict[str, str]]:
    m = METADATA_COMMENT_RE.search(line)
    if m is None:
        return None
    fields = {}
    for part in m.group(1).split(";"):
        part = part.strip()
        if not part or ":" not in part:
            continue
        key, _, value = part.partition(":")
        fields[key.strip()] = value.strip()
    return fields


def parse_draft(path: str) -> Draft:
    stem = os.path.splitext(os.path.basename(path))[0]
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()

    if not lines or not lines[0].startswith("# "):
        raise DraftError(f"{stem}: first line must be '# <title>'")
    title = lines[0][2:].strip()
    if not title:
        raise DraftError(f"{stem}: title is empty")

    meta_idx, fields = None, None
    for i in range(1, min(METADATA_LINES_SEARCHED, len(lines))):
        parsed = parse_metadata_fields(lines[i])
        if parsed is not None:
            meta_idx, fields = i, parsed
            break
    if fields is None:
        raise DraftError(f"{stem}: metadata comment must be within the first {METADATA_LINES_SEARCHED} lines")
    if not fields.get("type"):
        raise DraftError(f"{stem}: metadata missing required 'type' field")
    if "labels" not in fields:
        raise DraftError(f"{stem}: metadata missing required 'labels' field (may be empty)")

    labels = [l.strip() for l in fields["labels"].split(",") if l.strip()]
    body = "\n".join(lines[meta_idx + 1 :]).strip() + "\n"

    return Draft(
        stem=stem,
        path=path,
        title=title,
        type=fields["type"],
        labels=labels,
        parent=fields.get("parent", "").strip() or None,
        milestone=fields.get("milestone", "").strip() or None,
        body=body,
    )


def collect_draft_paths(paths: list[str]) -> list[str]:
    if len(paths) == 1 and os.path.isdir(paths[0]):
        skip_prefixes = ("_", "TEMPLATE", "BRIEF")
        files = [
            p
            for p in glob.glob(os.path.join(paths[0], "*.md"))
            if not os.path.basename(p).startswith(skip_prefixes)
        ]
        return sorted(files, key=lambda p: os.path.basename(p))
    return paths


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

PARENT_ISSUE_REF_RE = re.compile(r"^#\d+$")
# A bracketed [reference] that markdown wouldn't treat as a link, and that looks like a
# working-title reference rather than incidental bracketed text.
TITLE_LIKE_BRACKET_RE = re.compile(r"\[([^\]\n]+)\](?!\()")
URL_LIKE_RE = re.compile(r"^\w+://|^www\.", re.IGNORECASE)


def parent_ref_kind(parent: str) -> tuple[str, str]:
    """Classify a draft's `parent` metadata value as ("issue", "123") or ("title", text)."""
    if PARENT_ISSUE_REF_RE.match(parent):
        return "issue", parent[1:]
    if parent.startswith("[") and parent.endswith("]"):
        return "title", parent[1:-1]
    return "title", parent


def find_title_like_refs(body: str) -> list[str]:
    refs = []
    for m in TITLE_LIKE_BRACKET_RE.finditer(body):
        text = m.group(1)
        if text[:1].isupper() and " " in text and not URL_LIKE_RE.match(text):
            refs.append(text)
    return refs


def validate(drafts: list[Draft], meta: RepoMeta) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Also prints the one-line plan for each draft."""
    titles = {d.title for d in drafts}
    errors: list[str] = []
    warnings: list[str] = []

    for d in drafts:
        bad_labels = [l for l in d.labels if l not in meta.label_ids]
        type_note = d.type + (" [UNKNOWN]" if d.type not in meta.type_ids else "")
        labels_note = ",".join(d.labels) or "(none)"
        if bad_labels:
            labels_note += f" [UNKNOWN: {','.join(bad_labels)}]"
        milestone_note = "-"
        if d.milestone:
            milestone_note = d.milestone
            if d.milestone not in meta.milestones:
                milestone_note += " (would create)"
        parent_note = d.parent or "-"
        print(
            f"- {d.stem}: {type_note} [{labels_note}] milestone={milestone_note} "
            f"parent={parent_note} {len(d.body)} chars | {d.title}"
        )

        if d.type not in meta.type_ids:
            errors.append(f"{d.stem}: unknown type {d.type!r}")
        for l in bad_labels:
            errors.append(f"{d.stem}: unknown label {l!r}")
        if d.parent is not None:
            kind, ref = parent_ref_kind(d.parent)
            if kind == "title" and ref not in titles:
                errors.append(f"{d.stem}: parent {d.parent!r} matches neither a draft title nor '#N'")
        for ref in find_title_like_refs(d.body):
            if ref not in titles:
                warnings.append(f"{d.stem}: possible unresolved working-title reference [{ref}]")

    return errors, warnings


# ---------------------------------------------------------------------------
# Create mode
# ---------------------------------------------------------------------------

CREATE_ISSUE_MUTATION = """
mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { issue { id number url } }
}
"""

ADD_SUB_ISSUE_MUTATION = """
mutation($parentId: ID!, $childId: ID!) {
  addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
    issue { number }
    subIssue { number }
  }
}
"""

UPDATE_ISSUE_BODY_MUTATION = """
mutation($id: ID!, $body: String!) {
  updateIssue(input: { id: $id, body: $body }) { issue { number } }
}
"""

ISSUE_ID_BY_NUMBER_QUERY = """
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id } }
}
"""


def load_state(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_state(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")


def resolve_parent_id(meta: RepoMeta, draft: Draft, state: dict, titles_to_stem: dict[str, str]) -> tuple[str, int]:
    kind, ref = parent_ref_kind(draft.parent)
    if kind == "issue":
        number = int(ref)
        issue_id = graphql(ISSUE_ID_BY_NUMBER_QUERY, {"owner": meta.owner, "name": meta.name, "number": number})[
            "repository"
        ]["issue"]["id"]
        return issue_id, number
    parent_stem = titles_to_stem[ref]
    parent_state = state[parent_stem]
    return parent_state["id"], parent_state["number"]


def create_issues(meta: RepoMeta, drafts: list[Draft], state_path: str, state: dict) -> None:
    titles_to_stem = {d.title: d.stem for d in drafts}

    milestone_titles = sorted({d.milestone for d in drafts if d.milestone})
    for title in milestone_titles:
        was_known = title in meta.milestones
        ms = ensure_milestone(meta, title)
        if not was_known:
            print(f"created milestone {title!r} (#{ms['number']})")

    for d in drafts:
        if d.stem in state:
            print(f"skip {d.stem}: already filed as #{state[d.stem]['number']}")
            continue
        input_obj = {
            "repositoryId": meta.id,
            "title": d.title,
            "body": d.body,
            "labelIds": [meta.label_ids[l] for l in d.labels],
            "issueTypeId": meta.type_ids[d.type],
        }
        if d.milestone:
            input_obj["milestoneId"] = meta.milestones[d.milestone]["id"]
        issue = graphql(CREATE_ISSUE_MUTATION, {"input": input_obj})["createIssue"]["issue"]
        state[d.stem] = {"number": issue["number"], "id": issue["id"], "url": issue["url"], "title": d.title}
        save_state(state_path, state)
        print(f"filed #{issue['number']} {d.title} {issue['url']}")

    for d in drafts:
        if d.parent is None or state[d.stem].get("linked"):
            continue
        parent_id, parent_number = resolve_parent_id(meta, d, state, titles_to_stem)
        graphql(ADD_SUB_ISSUE_MUTATION, {"parentId": parent_id, "childId": state[d.stem]["id"]})
        state[d.stem]["linked"] = True
        save_state(state_path, state)
        print(f"linked #{state[d.stem]['number']} under #{parent_number}")

    by_title_number = {v["title"]: v["number"] for v in state.values()}
    for d in drafts:
        if state[d.stem].get("refs_resolved"):
            continue
        new_body = d.body
        for title, number in by_title_number.items():
            new_body = new_body.replace(f"[{title}]", f"#{number}")
        if new_body != d.body:
            graphql(UPDATE_ISSUE_BODY_MUTATION, {"id": state[d.stem]["id"], "body": new_body})
            print(f"resolved refs in #{state[d.stem]['number']}")
        state[d.stem]["refs_resolved"] = True
        save_state(state_path, state)

    print()
    print("filed issues:")
    for d in drafts:
        print(f"  #{state[d.stem]['number']} {state[d.stem]['url']}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--create", action="store_true", help="File the issues for real (default is a dry run).")
    parser.add_argument("--repo", default=None, help="OWNER/NAME (default: current repo, via `gh repo view`).")
    parser.add_argument("paths", nargs="+", help="A directory of drafts, or one or more draft files.")
    args = parser.parse_args(argv)

    repo = args.repo or current_repo()
    draft_paths = collect_draft_paths(args.paths)
    if not draft_paths:
        raise SystemExit("no draft files found")

    drafts: list[Draft] = []
    errors: list[str] = []
    for path in draft_paths:
        try:
            drafts.append(parse_draft(path))
        except DraftError as e:
            errors.append(str(e))

    meta = fetch_repo_meta(repo)

    print(f"{len(drafts)} draft(s) against {repo}\n")
    validation_errors, warnings = validate(drafts, meta)
    errors += validation_errors
    print()

    if warnings:
        print("WARN:")
        for w in warnings:
            print(f"  {w}")
        print()

    if errors:
        print("ERROR:")
        for e in errors:
            print(f"  {e}")
        return 1

    if not args.create:
        print("dry run OK; pass --create to file")
        return 0

    draft_dir = os.path.dirname(os.path.abspath(draft_paths[0]))
    state_path = os.path.join(draft_dir, "filed.json")
    state = load_state(state_path)
    create_issues(meta, drafts, state_path, state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
