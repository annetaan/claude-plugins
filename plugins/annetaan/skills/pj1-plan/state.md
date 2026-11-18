# The state of a project

This file holds how `project.sh` reads a project, and how it judges when a project is merged, when an issue is ready
and when it is workable, and whether a body still holds against the code. `pj2-issues`, `pj3-doctor`, its project
reviewer and `pj4-running` read it first. The issues and their bodies are in `format.md`, and what the four skills
agree on between them is in `between-skills.md`, both next to this file.

## Reading a project

`project.sh` sits next to this file, in `scripts/project.sh`. It reads the parent and every sub-issue in one GraphQL
query, the pull requests into the base branch in one `gh pr list`, and where the branches of this project and the
projects it waits on stand in one more GraphQL query. `--order` also reads one query per
project it follows through `waitsOn`. It writes nothing to GitHub. **It is the only parser of a sub-issue body, of
a parent's `Base:` and `Roadmap:` lines, of a pull request's head and of the roadmap file.** Every skill and the issue writer go through it. Pass `-R <owner/repo>` to read a repository other than the current one.

Every mode that reads a parent fails with `project: #<P> has no Base: line` when the parent body has none, or has
one that does not name both branches. It also fails with `project: #<P> is blocked by #<X>, which is no project` when
an issue the parent is blocked by has no `Base:` line, for this parent and for every project a walk of `--order` or
`--check` follows. `--lint`, `--same-words` and `--roadmap` read no parent.

```bash
project.sh <P>               # the whole project, as JSON
project.sh <P> --order       # the run order, and the ## Order list to write
project.sh <P> --order-body  # the parent body with its ## Order list replaced, as text
project.sh <P> --next        # what to run next on the project, and a fingerprint (see What comes next)
project.sh <P> --check <n> [<n>...]   # whether each sub-issue's body still holds against the code and the project (see Is the body still current?)
project.sh --lint <file>     # the lint of one body, from a file, or from standard input with -
project.sh --same-words <before> <after>   # whether the two bodies differ in backticks and whitespace only
project.sh --roadmap [<ref>] # the roadmap file, in the work tree or at <ref>, checked against the format (see format.md)
```

`project.sh <P>` prints:

```
{"parent": {"number", "title", "state", "stateReason", "updatedAt", "labels": [names], "base", "from",
            "baseExists", "merged", "projectPr", "waitedOnBy": [numbers], "startable",
            "waitsOn": [{"number", "title", "state", "stateReason", "base", "merged"}],
            "order": [numbers],
            "orderCheck": {"ok", "unknown": [numbers], "duplicate": [numbers],
                           "early": [{"number", "blocker"}], "missing": [numbers]},
            "roadmap": {"path", "entry", "tasks": [numbers], "task": number or null, "missing": [numbers]} or null,
            "breakage": [{"issue", "check", "closedBy": [numbers], "state"}]},
 "issues": [{"number", "title", "wantedTitle", "state", "stateReason", "updatedAt", "labels": [names],
             "blockedBy": [{"number", "state", "parent"}], "blocking": [numbers],
             "pr": {"number", "state", "isDraft", "url"} or null, "stub",
             "designPaths": [paths], "leftBroken": [checks],
             "decisions": {"total", "settled", "open", "contradictory"},
             "lint": {"ok", "reasons": [codes]}}]}
```

- `labels` on the parent is the names of its labels, the same as `labels` on an issue.
- `base` is the base branch the parent's `Base:` line names, and `from` is the branch it is made from
  (`format.md`, **The parent issue body**).
- `baseExists` is true once the base branch is on origin, and `merged` is whether the project is merged (see
  **When a project is merged**).
- `projectPr` is the url of the open pull request with the base branch as head and `<from>` as base, or null. It is
  read for this project only, not for the projects in `waitsOn`.
- `waitsOn` is the projects this one waits on: the issues this parent is blocked by, by number. Each is a project,
  a parent with a `Base:` line, and carries its own `base` and `merged`.
- `waitedOnBy` is the numbers of the parents this one blocks whose body has a `Base:` line.
- `startable` is true when the parent is `OPEN`, has no sub-issue, and every project in `waitsOn` is `merged`.
- `order` is the numbers under `## Order`, as written. `orderCheck.ok` is false when the list names a number that is
  no sub-issue (`unknown`), names one twice (`duplicate`), or puts an open issue before an open blocker of the same
  project (`early`). `missing` is the open sub-issues the list leaves out, and does not make it false.
- `roadmap` is read from the parent's `Roadmap:` line (`format.md`, **The parent issue body**), and is null when the
  parent has none or the line is unreadable: no backticked path, or a path outside the six of the roadmap file.
  `path` and `entry` are the line's. `tasks` is the numbers of the sub-issues whose `designPaths` hold `path` and that
  are open or closed as completed. `task` is that number when exactly one sub-issue is in `tasks`, else null: the
  roadmap task (`format.md`, **The roadmap task**). `missing` is, while `task` is open, the other open sub-issues it
  is not blocked by, and empty otherwise.
- `breakage` is the declared breakage of the project (`format.md`, **Declared breakage**), one entry per check of each
  issue that is open or closed as completed. `closedBy` is the other such issues that hold the breaker in their
  transitive `blockedBy` and carry the check in their acceptance criteria. `state` is `unclosed` with no closer, else
  `planned` while the breaker is open, else `closed` when a closer is closed, else `open`. `leftBroken` on an issue is
  the checks its `### Left broken` names.
- `wantedTitle` is the title with the decision count from `format.md` **The title**. Every sub-issue carries it, closed
  ones included. A skill edits an open issue's title when the two differ, and never retitles a closed one
  (`between-skills.md`, **Titles**).
- `parent` in `blockedBy` is the number of the blocker's parent issue, or null.
- `pr` is the issue's pull request, open or merged (see **The pull request of an issue** below), or null. Its `state`
  is `OPEN` or `MERGED`.
- `stub` is true when `## Design` reads `To be drawn.`.
- `designPaths` is the paths of the file list that opens `## Design` (`format.md`, **The file list**).
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

`--roadmap` needs no parent and touches no GitHub. Without a ref it reads the working tree from the top of the work
tree. With `<ref>` it reads that ref through `git ls-tree` and `git show`. It dies outside a work tree and on a ref git
cannot read, and otherwise exits 0 whatever the result:

```
{"ok", "files": [paths], "path": <path or null>,
 "entries": [{"heading", "start", "end"}],
 "reasons": [{"code", "line", "heading"}]}
```

`path` is set when exactly one roadmap file exists. `start` and `end` are the first and last line of an entry, 1-based.
`line` and `heading` appear on a reason when one applies. The codes are in `format.md`, **The roadmap file**.

`--check <n> [<n>...]` runs inside a work tree of a clone of the repository, from any directory in it. It takes one or more
numbers after the parent, reads the project and fetches once per call, and prints one object per number, one per line, in
the order given. It fetches `<from>` from origin every time, and the base branch
only once it exists, which moves local refs and nothing else. Each object has the shape:

```
{"number", "base", "from", "baseExists", "ok", "lint": {"ok", "reasons"},
 "premises": {"mode": "full" | "early" | "none", "excusers": [numbers],
              "failures": [{"path", "symbol" (when one is missing), "why"}]},
 "breakage": {"unclosed": [{"issue", "check"}]}}
```

When a name is missing from its file at the ref, `"why"` is `symbol not found` when the file's history held the name,
which means the code moved, and `symbol never in the file` when it never did: a name the task is going to write, or a
name of another file. A shallow clone has no history to ask, so it always says `symbol not found`.

The `lint` here is not always the one in `issues[].lint`. It also counts as paths the files at the root of the ref it
reads and the paths in the file lists of the issue's blockers, so a backticked file name there is no symbol, and it
can be stricter than `issues[].lint`.

`breakage.unclosed` holds the `unclosed` entries of the whole project, not only this issue's, and is filled under
every `premises.mode`. `ok` is true when the lint is clear, no premise failed and no breakage of
the project is unclosed. `premises.mode` is `none` while the base branch does not
exist and a project in `waitsOn` is not `merged`, while an open blocker is outside the project, or while an open
issue in the transitive `blockedBy` is a stub. `excusers` names the open blockers the check read (see **Is the body
still current?**).

`--order` prints `{"order": [issue objects], "list": [numbers]}`. `order` is the open sub-issues, each a blocker
before what it blocks. Only open sub-issues of the same parent count as blockers here. Among the issues free to go
next, the one written earlier under `## Order` goes first, then the one more open issues wait on, directly or not,
then the lower number. `list` is what to write under `## Order`: the sub-issues closed as completed, where the list
has them and then by number, followed by `order`. `--order` also follows `waitsOn` from project to project, and
fails when the projects wait on each other: `project: the projects have a cycle: #12 waits on #15 waits on #12`.

`--order-body` prints the parent's body as GitHub has it now, with the CR removed and the lines under `## Order`
replaced by `list`: one `1. #<n>` per line, framed by blank lines. A body with no `## Order` heading gets the heading
and the list before its first `## ` heading outside a code fence, or at the end. The lines above the first heading,
`Base:` and `Roadmap:`, stay as they are. It fails like `--order` on a cycle.
Its own read of the body is the re-read that **Writing to GitHub** (`between-skills.md`) asks for.

`--same-words <before> <after>` reads two files, touches neither GitHub nor git, and exits 0 on two readable files. It
prints `{"ok", "lint"}`. `ok` is true when the two files hold the same words once every backtick is gone and every
run of whitespace is one space. `lint` is the lint of `<after>`. `between-skills.md` says what it is for, under
**Format-only fixes**.

## When a project is merged

**A project is `merged`** when either of these holds:

- the parent is `CLOSED` with the state reason `COMPLETED`, or
- the parent is `OPEN`, it has at least one sub-issue and every one of them is closed, and the base branch has
  reached `<from>` (`format.md`, **The parent issue body**): a pull request with the base branch as head and `<from>`
  as base was merged, or `<from>` on origin contains the base branch.

The sub-issues have to be there and closed because a fresh base branch is identical to `<from>`. A parent closed as
not planned is a project given up on, and is not merged.

## When an issue is ready

`ready` goes on when all of these hold:

- every decision under `## Decisions` has exactly one box checked, or it reads `None.`
- `## Design` reads as the decisions say, with no "depending on D1" left in it
- nothing in the body contradicts the parent's `## Design`, or another open issue
- the project review found nothing left on it (see `pj3-doctor`)
- **the body is complete for its day**: the goal, the boundary it has to match and every decision a human has to make,
  with the lint clear (`format.md`, **What the lint checks**). `pj4-running` details it against the code before it
  runs, so the body need not hold the interior of every file.

## When an issue is workable

An issue is **workable** when it carries `ready`, is no stub, has no open or contradictory decision, every issue in its
`blockedBy` is `CLOSED`, and its project has `baseExists`, or every project in `waitsOn` is `merged`. `--check` is no
part of it. The roadmap task is workable only when `parent.roadmap.missing` is empty.

## What comes next

`project.sh <P> --next` prints one line, read from the same view as `project.sh <P>`, and writes nothing to GitHub:

```
{"next": "doctor" | "running" | "user" | "done", "why": "<code>", "issue": <n> or null, "url": <string> or null,
 "fingerprint": "<sha256 hex>"}
```

The rules run top to bottom, and the first that matches decides. `issue` is filled where the table names it, and `url`
only for `merge-project-pr`.

| # | When | next / why | issue |
|---|------|------------|-------|
| 1 | the parent is `CLOSED` | `done` / `closed` | null |
| 2 | the parent is `merged` and open | `running` / `merged-parent` | null |
| 3 | the project has no sub-issue | `user` / `split` | null |
| 4 | `baseExists` is false and a project in `waitsOn` is not `merged` | `user` / `waits` | null |
| 5 | an open issue has a merged pull request | `running` / `close-merged` | the smallest such number |
| 6 | every sub-issue is closed: `projectPr` is set / it is not | `user` / `merge-project-pr` (with `url`) / `running` / `project-pr` | null |
| 7 | `orderCheck.ok` is false, or `order` names no open issue | `doctor` / `order` | null |
| 8 | k is the first open issue in `order`, and k has the `blocker` label | `doctor` / `blocker` | k |
| | k is a stub | `doctor` / `stub` | k |
| | k has a contradictory decision | `user` / `contradictory` | k |
| | k has an open decision | `user` / `decisions` | k |
| | k does not carry `ready` | `doctor` / `not-ready` | k |
| | k has an open issue in `blockedBy` | `doctor` / `blocked` | k |
| | k is `parent.roadmap.task` and `missing` is not empty | `doctor` / `roadmap-edges` | k |
| | otherwise | `running` / `workable` | k |

The rows under 8 run in the order shown. `--next` does not run `--check`. A `detail` stop of `pj4-running` leaves the
`blocker` label, and a `decision` stop leaves an open decision and no `ready`, so the rows above send the project to
the doctor or to the user.

`fingerprint` is the sha256 of the parent's `updatedAt`, `state` and `labels`, each issue's `number`, `state`, `updatedAt` and
`labels`, each issue's pull request `number` and `state`, and `projectPr`. A step that changes the project changes it.
Only `pj-auto` reads it, to tell that a step made no progress.

## Is the body still current?

A body is drawn against the code of its day. `--check` asks whether it still holds at the tip of the base branch, or
at the tip of `origin/<from>` while the base branch does not exist yet, since that is where it will be cut from.
`pj3-doctor`'s review asks it to keep the bodies true to the code, and `pj4-running`'s detail pass asks it before an
issue runs.

- **Premises.** Every `changed` and `deleted` path exists, and no `added` path does. Every symbol of a `changed` entry on a code file
  is still found in its file, and a name that is not found is told by why: `symbol not found` when the file's history
  held the name, `symbol never in the file` when it never did. A document (`format.md`, **The file list**) is read for its path only. Three modes. `full`: every blocker in the transitive `blockedBy` is closed, and the
  files are read at the ref as they are. `early`: some of those blockers are open (the `excusers`), and the check
  reads their file lists and bodies too. A path an excuser lists as `added` counts as existing, and one it lists as
  `deleted` counts as gone. A symbol missing at the ref counts as present when it is named in the body of an
  excuser that lists the file as `added` or `changed`. Two failures come from a contradiction with an excuser's file list: `added, but an open
  blocker adds it too`, and `changed, but an open blocker deletes it` (or `deleted`). `none`: nothing is checked,
  while the project has no `baseExists` and a project in `waitsOn` is not `merged`, while an open blocker is outside
  the project, or while an open issue in the transitive `blockedBy` is a stub, because there is no body to read.
  A `changed` entry on the parent's roadmap path also needs the entry of the `Roadmap:` line to stand in that file at
  the ref, and fails with `roadmap entry not found` otherwise. Under mode `none` nothing is checked.
- **Breakage.** An issue that declares a check under `### Left broken` needs a closer in the project, or every
  `--check` of the project fails. The rule is in `format.md`, **Declared breakage**.
