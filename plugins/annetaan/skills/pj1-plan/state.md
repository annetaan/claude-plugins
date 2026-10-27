# The state of a project

This file holds how `project.sh` reads a project, and how it judges when a project is merged, when an issue is ready
and when it is workable, and whether a body still holds against the code. `pj2-doctor`, its project reviewer and
`pj3-running` read it first. The issues and their bodies are in `format.md`, and what the three skills agree on
between them is in `between-skills.md`, both next to this file.

## Reading a project

`project.sh` sits next to this file, in `scripts/project.sh`. It reads the parent and every sub-issue in one GraphQL
query, the pull requests into the base branch in one `gh pr list`, and where the branches of this project and the
projects it waits on stand in one more GraphQL query. `--order` and the history of `--check` also read one query per
project they follow through `dependsOn`. It writes nothing to GitHub. **It is the only parser of a sub-issue body, of
a parent's `Base:` line and of a pull request's head.** Every skill and the issue writer go through it. Pass `-R <owner/repo>` to read a repository other than the current one.

Every mode that reads a parent fails with `project: #<P> has no Base: line` when the parent body has none, or has
one that does not name both branches. `--lint` reads no parent.

```bash
project.sh <P>               # the whole project, as JSON
project.sh <P> --order       # the run order, and the ## Order list to write
project.sh <P> --check <n>   # whether sub-issue <n> can be implemented from its body now (see When an issue is ready)
project.sh --lint <file>     # the lint of one body, from a file, or from standard input with -
```

`project.sh <P>` prints:

```
{"parent": {"number", "title", "state", "stateReason", "updatedAt", "body", "base", "from",
            "baseExists", "merged",
            "dependsOn": [{"number", "title", "state", "stateReason", "base", "merged"}],
            "order": [numbers],
            "orderCheck": {"ok", "unknown": [numbers], "duplicate": [numbers],
                           "early": [{"number", "blocker"}], "missing": [numbers]}},
 "issues": [{"number", "title", "wantedTitle", "state", "stateReason", "updatedAt", "readyAt", "labels": [names],
             "blockedBy": [{"number", "state", "parent"}], "blocking": [numbers],
             "pr": {"number", "state", "isDraft", "url"} or null, "stub",
             "files": [{"path", "kind", "symbols": [names]}], "designPaths": [paths],
             "decisions": {"total", "settled", "open", "contradictory"},
             "lint": {"ok", "reasons": [codes]}}]}
```

- `base` is the base branch the parent's `Base:` line names, and `from` is the branch it is made from
  (`format.md`, **The parent issue body**).
- `baseExists` is true once the base branch is on origin, and `merged` is whether the project is merged (see
  **When a project is merged**).
- `dependsOn` is the projects this one waits on: the parents of the blockers of its open sub-issues, other than this
  parent, whose body has a `Base:` line, by number. A blocker with no parent is left out. Each carries its own `base`
  and `merged`.
- `order` is the numbers under `## Order`, as written. `orderCheck.ok` is false when the list names a number that is
  no sub-issue (`unknown`), names one twice (`duplicate`), or puts an open issue before an open blocker of the same
  project (`early`). `missing` is the open sub-issues the list leaves out, and does not make it false.
- `wantedTitle` is the title with the decision count from `format.md` **The title**. Every sub-issue carries it, closed
  ones included. A skill edits an open issue's title when the two differ, and never retitles a closed one
  (`between-skills.md`, **Titles**).
- `parent` in `blockedBy` is the number of the blocker's parent issue, or null.
- `readyAt` is the time of the last `ready` labelled event on the issue, or null.
- `pr` is the issue's pull request, open or merged (see **The pull request of an issue** below), or null. Its `state`
  is `OPEN` or `MERGED`.
- `stub` is true when `## Design` reads `To be drawn.`.
- `files` is the file list that opens `## Design` (`format.md`, **The file list**), and `designPaths` is its paths.
- `decisions` counts the `### D<n>.` entries by how many boxes each has checked (`format.md`, **Decisions**).
- `lint` is what `--lint` prints for the body (`format.md`, **What the lint checks**).

**The pull request of an issue** is a pull request into the base branch whose head reads `Implements #<n>`. An open
one wins over a merged one, and the lower number wins within the same state. One closed without a merge never counts.

`--lint` needs no parent and touches neither GitHub nor git. It prints `{"ok", "reasons"}` and exits 0 whatever the
result. The issue writer runs it on a body before returning it:

```bash
project.sh --lint - <<'EOF'
<the body>
EOF
```

`--check <n>` runs inside a clone of the repository. It fetches `<from>` from origin every time, and the base branch
only once it exists, which moves local refs and nothing else, and prints:

```
{"number", "base", "from", "baseExists", "ok", "lint": {"ok", "reasons"},
 "premises": {"evaluated", "failures": [{"path", "symbol" (when one is missing), "why"}]},
 "history": {"stale": [{"sha", "subject", "pr" or null}]}}
```

`ok` is true when the lint is clear, no premise failed and no commit is stale. `evaluated` is false while a blocker is
still open, or while the base branch does not exist and a project in `dependsOn` is not `merged` (see **Is the body
still current?**).

`--order` prints `{"order": [issue objects], "list": [numbers]}`. `order` is the open sub-issues, each a blocker
before what it blocks. Only open sub-issues of the same parent count as blockers here. Among the issues free to go
next, the one written earlier under `## Order` goes first, then the one more open issues wait on, directly or not,
then the lower number. `list` is what to write under `## Order`: the sub-issues closed as completed, where the list
has them and then by number, followed by `order`. `--order` also follows `dependsOn` from project to project, and
fails when the projects wait on each other: `project: the projects have a cycle: #12 waits on #15 waits on #12`.

## When a project is merged

**A project is `merged`** when either of these holds:

- the parent is `CLOSED` with the state reason `COMPLETED`, or
- the parent is `OPEN`, it has at least one sub-issue and every one of them is closed, and the base branch has
  reached `<from>` (`format.md`, **The parent issue body**): a pull request with the base branch as head and `<from>`
  as base was merged, or `<from>` on origin contains the base branch.

The sub-issues have to be there and closed because a fresh base branch is identical to `<from>`. A parent closed as
not planned is a project given up on, and is not merged. A merge made without a pull request, such as a local merge
commit, can leave commits that `--check` reads as stale for a project waiting on this one (see **Is the body still
current?**).

## When an issue is ready

`ready` goes on when all of these hold:

- every decision under `## Decisions` has exactly one box checked, or it reads `None.`
- `## Design` reads as the decisions say, with no "depending on D1" left in it
- nothing in the body contradicts the parent's `## Design`, or another open issue
- the project review found nothing left on it (see `pj2-doctor`)
- **it can be implemented straight from its body.** A worker who reads only this body, the parent's `## Design`, the
  `## Design` of every parent in `dependsOn` and the code finds nothing left to design. `project.sh` checks the part
  of this a script can see, as a lint (`format.md`, **What the lint checks**).

## When an issue is workable

An issue is **workable** when it carries `ready`, every issue in its `blockedBy` is `CLOSED`, `--check` is clear, and
its project has `baseExists`, or every project in `dependsOn` is `merged`. The last part is the same condition the
premises wait for.

## Is the body still current?

A body is drawn against the code of its day. `--check` asks whether it still holds at the tip of the base branch, or
at the tip of `origin/<from>` while the base branch does not exist yet, since that is where it will be cut from.

- **Premises.** Every `changed` and `deleted` path exists, and no `added` path does. Every symbol of a `changed` entry
  is still found in its file. The premises are evaluated **only once every `blockedBy` is closed, and the project has
  `baseExists` or every project in `dependsOn` is `merged`**. Until then the blockers are still meant to change these
  files, and the result reads not evaluated.
- **History.** Every commit on the base branch's first-parent line since `readyAt` that touched a path in the file
  list is a candidate. A candidate is **anticipated** when a merged pull request it came from has `Implements #<x>`
  as its head with x in this issue's transitive `blockedBy`, has `pj/<Q>` as head and `<from>` as base, or has
  `pj/<Q>` as base, with Q in the waited projects. The last case covers a `pj/<Q>` fast-forwarded into `<from>`,
  which brings the commits of Q's sub-issues along without a merge pull request. The waited projects are the ones
  this project waits on, the projects of the blockers in this issue's transitive `blockedBy`, and the projects those
  wait on, directly or not. The transitive `blockedBy` is its blockers, their blockers, and so on through the
  project, closed issues included. A blocker in another project enters by its number and is not followed further.
  Every other candidate is **stale**. With no `readyAt`, or no base branch, there is no history.

The design was written knowing its blockers would land first, and that the projects it waits on would be merged
into `<from>` before its base branch was cut, so their commits were foreseen. A commit from anywhere else that
touched these files was not.
