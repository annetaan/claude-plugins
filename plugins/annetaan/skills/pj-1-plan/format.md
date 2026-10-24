# The shape of a project on GitHub

This file is the only description of how a project is laid out on GitHub. All three skills below read it, so a
change here is a change to all three.

## The three skills

| Skill | What it does |
| --- | --- |
| `pj-1-plan` | designs the whole in broad strokes, splits it into tasks, groups the tasks into projects of up to ten, and files one parent issue per project with its run order and one sub-issue per task with the decisions it needs |
| `pj-2-doctor` | reviews a whole project against the boxes the user ticked and the code, has the issue writers redraw what no longer holds, draws the stubs, resolves the blockers, rewrites the run order, and labels an issue `ready` |
| `pj-3-running` | creates a project's base branch when it first starts on the project, then works down the run order one pull request at a time, running the `workflow` skill on each and merging it into the base branch before the next starts |

**The user decides by ticking boxes on GitHub.** Every question a task raises is a decision in its sub-issue
(**Decisions**). No skill asks a task's decision in the conversation. `pj-2-doctor` talks with the user about
everything else: a split, two boxes ticked in one decision, and its changes before they are written.

## Principle

**GitHub holds all the state.** The issues, their labels, their relationships, their comments and the pull requests
are the whole project. A project can stop anywhere and pick up again from another session, another day or another
machine.

Two things live outside GitHub, and only these two:

- **the user's approval within a run.** An approval covers the run it was given in. The next run asks again.
- **the uncommitted work a stopped run leaves in its worktree** `<MAIN>/.claude/worktrees/pj-<P>`, where `<MAIN>`
  is the main working tree. It is local. The next run never uses it. The work is redone as the issue's one task.

The worktree itself is a place to work, not state. A run creates it when it is missing.

## Requirements

- `gh` 2.94.0 or later. That release added `--parent`, `--blocked-by`, `--blocking` and the `parent`, `subIssues`,
  `blockedBy` and `blocking` fields to `gh issue`.
- `gh` logged in.
- Issues turned on in the repository.

```bash
gh --version
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

## The parts

| Part | On GitHub |
| --- | --- |
| The project | one **parent issue** labelled **`project`**. Its body holds the design of this project. |
| A task | one **sub-issue** of the parent. One task becomes one pull request. |
| Where the work lands | the **base branch** `pj/<P>`. pj-3-running creates it on the project's first start, from the tip of the branch the user picked when the project was filed, the default branch unless they said otherwise. The parent's `Base:` line names both. Every sub-issue's pull request merges into the base branch. |
| An order between tasks | a native **blocked by** relationship. Never written into a body. |
| The run order | the numbered list under the parent's **`## Order`** (see **The run order**). |
| An order between projects | no record of its own. It follows from the order between tasks (see **Projects**). |
| A task that can be implemented straight from its body | the **`ready`** label |
| Something `pj-3-running` stopped on | the **`blocker`** label |

The parent never gets `ready` and is never worked on. It closes as completed once the project is merged (see
**Projects**).

Merging the base branch into the branch it was made from is a human's job, done through a pull request. No skill
does it.

### Projects

One request can become several projects, `PJ1, PJ2, …` while it is planned, each a parent issue of its own. The
tasks are numbered `T1…Tn` across the whole request. Every project from one request is made from the same branch.

**A project holds at most 10 tasks.** Like the 8-file limit, it is a rule of the split. `pj-1-plan` cuts
the request so that no project holds more than ten. When `pj-2-doctor` later splits an issue or files stubs and
a project goes past ten, it stays one project, and nobody asks whether to split it.

**Project P waits on project Q** when an open sub-issue of P is blocked by a sub-issue of Q, open or closed. That
edge is the only record of it. Parents get no relationships of their own, and no parent body names another project.
`project.sh` derives the projects P waits on as `parent.dependsOn`. **No cycles between projects.**

**The base branch.** Only `pj-3-running` creates `pj/<P>`. It does so when it starts on the project, the base branch does
not exist yet, and every project in `dependsOn` is `merged`, which always holds for a project that waits on none. It
cuts the base branch from the tip of `<from>`, the branch the parent's `Base:` line names after `from`, through the
GitHub API, in `run.sh start` (`pj-3-running/scripts/run.sh`).

`pj-1-plan` writes the `Base:` line into every parent when it files it, before any of these branches exists.
A base branch cut later starts from a newer `<from>`, and conflicts less when it is merged back at the end.

**A project is `merged`** when either of these holds:

- the parent is `CLOSED` with the state reason `COMPLETED`, or
- the parent is `OPEN`, it has at least one sub-issue and every one of them is closed, and the base branch has
  reached `<from>`: a pull request with the base branch as head and `<from>` as base was merged, or `<from>` on
  origin contains the base branch.

The sub-issues have to be there and closed because a fresh base branch is identical to `<from>`. A parent closed as
not planned is a project given up on, and is not merged. A merge made without a pull request, such as a local merge
commit, can leave commits that `--check` reads as stale for a project waiting on this one (see **Is the body still
current?**).

**Closing a parent** as completed means its project is merged. When `pj-3-running` reads an open parent that is
`merged`, it closes it with a marked comment and `--reason completed`, both when it starts on that project and when
it starts on a project that waits on it. It closes it through `run.sh close`, which refuses a parent `project.sh` does
not read as `merged`. A human may also close it after merging. The merge itself is the human's job.

**An edge across projects may be added only while the blocked project has no base branch.** The base branch is cut
from `<from>` once, and has no way to take in another project's work later. Once it exists, work the project needs
from elsewhere becomes a stub in the project itself.

### Labels

| Label | Color | Description |
| --- | --- | --- |
| `ready` | `0E8A16` | Every decision is settled and the body can be implemented as it stands. pj-3-running may work on it. |
| `blocker` | `B60205` | pj-3-running stopped on this. Settle it before anything else. |
| `project` | `5319E7` | The parent issue of a pj project. Its sub-issues are the project's tasks. |

**Make sure a label exists right before a skill first adds it in a run.** Create it only when the repository does not
have it. **Never pass `--force`.** It would overwrite the color and the description of a label the repository already
uses. An existing label is reused as it is.

```bash
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx ready || gh label create ready --color 0E8A16 --description "Every decision is settled and the body can be implemented as it stands. pj-3-running may work on it."
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx blocker || gh label create blocker --color B60205 --description "pj-3-running stopped on this. Settle it before anything else."
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx project || gh label create project --color 5319E7 --description "The parent issue of a pj project. Its sub-issues are the project's tasks."
```

### Relationships

Dependencies live in GitHub's own relationships, so the issue page shows them and a command can read them. **Never
also list them in a body.** Two copies drift apart.

```bash
gh issue create --parent <P> --blocked-by <n>,<m> --title "<title>" --body-file <file>
gh issue edit <n> --add-blocked-by <m>
gh issue edit <n> --remove-blocked-by <m>
```

An edge may run between sub-issues of different projects (see **Projects**). A parent never gets a blocked-by
relationship.

**No cycles**, within a project or between projects. After any change to the relationships, run
`project.sh <P> --order` in every project the change touched. It fails and names the cycle when there is one, of
either kind. Undo the edge that made it.

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
 "issues": [{"number", "title", "state", "stateReason", "updatedAt", "readyAt", "labels": [names],
             "blockedBy": [{"number", "state", "parent"}], "blocking": [numbers],
             "pr": {"number", "state", "isDraft", "url"} or null, "stub",
             "files": [{"path", "kind", "symbols": [names]}], "designPaths": [paths],
             "decisions": {"total", "settled", "open", "contradictory"},
             "lint": {"ok", "reasons": [codes]}}]}
```

- `base` is the base branch the parent's `Base:` line names, and `from` is the branch it is made from (see **The
  parent issue body**).
- `baseExists` is true once the base branch is on origin, and `merged` is whether the project is merged (see
  **Projects**).
- `dependsOn` is the projects this one waits on: the parents of the blockers of its open sub-issues, other than this
  parent, whose body has a `Base:` line, by number. A blocker with no parent is left out. Each carries its own `base`
  and `merged`.
- `order` is the numbers under `## Order`, as written. `orderCheck.ok` is false when the list names a number that is
  no sub-issue (`unknown`), names one twice (`duplicate`), or puts an open issue before an open blocker of the same
  project (`early`). `missing` is the open sub-issues the list leaves out, and does not make it false.
- `parent` in `blockedBy` is the number of the blocker's parent issue, or null.
- `readyAt` is the time of the last `ready` labelled event on the issue, or null.
- `pr` is the issue's pull request, open or merged (see **Pull requests**), or null. Its `state` is `OPEN` or
  `MERGED`.
- `stub` is true when `## Design` reads `To be drawn.`.
- `files` is the file list that opens `## Design` (see **The file list**), and `designPaths` is its paths.
- `decisions` counts the `### D<n>.` entries by how many boxes each has checked (see **Decisions**).
- `lint` is what `--lint` prints for the body (see **When an issue is ready**).

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

### Picking the project

`pj-2-doctor` and `pj-3-running` always ask which project to work on, with `AskUserQuestion`, even when they were
given a number. List the open parents, and read the number they were given, if any.

```bash
gh issue list --label project --state open --limit 100 --json number,title,subIssuesSummary --jq 'sort_by(.number)'
gh issue view <n> --json number,state,labels,parent
```

- The recommended project is the parent of the number given when that is a sub-issue, or the number itself when it
  carries `project`. When the recommended project is not in the list, say so in one line and ask without a
  recommendation.
- First print every project, one line each: `#<P> <title> (<completed> of <total> sub-issues closed)`.
- The question has the header `Project` and at most 4 options: the recommended project first, marked
  `(Recommended)`, then the rest by number. With one project only, the second option is `Stop`. The free-text answer
  accepts any `#<P>` from the list.
- When the list is empty, stop.

## The parent issue body

```markdown
Base: `pj/<P>` from `<branch>`

## Order

1. #<n>
2. #<m>

## Goal

<what is true once every sub-issue is closed, in a few sentences>

## Design

<the boundaries this project defines and its tasks have to match: contracts, types, schemas, names, and why a new
abstraction is needed if one is added>

## Decisions

<the plan-level answers the user gave, each one settled, in the shape of a sub-issue decision. None. when there were none>

## Out of scope

<what the request might be read to include and this project leaves alone>
```

The task list is the sub-issue list GitHub draws under the body. `## Order` is the one list of sub-issues a body
holds, and it says the order, not what the tasks are.

`## Design` holds only the boundaries this project defines. A boundary another project defines stays in that
project's parent. Whoever reads the parent's `## Design`, the issue writer and the `workflow` skill alike, also reads
the `## Design` of every parent in `dependsOn`.

### The run order

`## Order` holds one numbered line per sub-issue, `1. #<n>`, and nothing else. GitHub draws each reference with the
issue's title and whether it is open or closed, so the list shows the progress with nobody ticking anything.

- **`pj-3-running` works down it from the top**, and stops at the first open issue that is not workable (see **When
  an issue is ready**). Nothing is skipped.
- **A human may reorder it by hand.** It must not put an issue before an open blocker of the same project.
- **`pj-1-plan` writes it when it files the project, and `pj-2-doctor` rewrites it** from
  `project.sh <P> --order`, whose `list` keeps the human's order wherever the blockers allow it. The closed issues
  come first, then the open ones. An issue closed as not planned leaves the list.
- **`pj-3-running` never writes it.** A closed issue shows as closed where it stands.

`project.sh <P>` reads the list as `parent.order` and checks it as `parent.orderCheck` (see **Reading a project**).
An issue missing from the list, such as a stub filed during a run, waits for `pj-2-doctor` to place it.

`Base:` names the project's base branch and, after `from`, the branch it is made from. That second branch is the one
the user merges the base branch into at the end. `pj-1-plan` files the parent, then adds the line to the
body. It takes two steps because the branch name carries the parent's number. The line is written before the branch
exists, and `pj-3-running` creates the branch later (see **Projects**). Nobody changes the line after that. A skill
that rewrites the parent body keeps the line as it is.

### The handover comment

The parent carries one comment that starts with `**[pj-3-running]** Handover notes`, fifteen lines at most below that
line. It holds what the workflow sessions learnt about working in this repository: the commands that run the tests,
the conventions kept, the traps hit.

`pj-3-running` reads it at the start of a run and rewrites it in place after every merge. Before a rewrite, read the
comment's `updated_at` again and work in any change a human made since.

```bash
gh api "repos/{owner}/{repo}/issues/<P>/comments" --paginate --jq '.[] | select(.body | startswith("**[pj-3-running]** Handover notes")) | {id, updated_at, body}'
gh api -X PATCH "repos/{owner}/{repo}/issues/comments/<id>" -F body=@<file>
gh issue comment <P> --body-file <file>    # the first time, when there is none
```

## The sub-issue body

```markdown
## Goal

<what this task makes true, in one or two sentences>

## Design

- `<path>` (changed): <what changes, naming the existing symbols it rides on, such as `retryJob`>
- `<path>` (added): <what it holds, naming the file or symbol it follows>

<optional prose: how the pieces fit. Written as if every decision below were already made the way it is checked>

## Acceptance criteria

- <what has to hold for this task to be done, with a backticked anchor: a test name, a command, or a file or symbol
  whose state is checked>

## Decisions

### D1. <the question, as a question>

<why it matters here: what each choice changes in the code, and what else it reaches>

- [ ] <option A>
- [ ] <option B> (recommended)

### D2. ...

## Out of scope

<what a worker might be tempted to do here and must leave alone>
```

The bar for a body is in **When an issue is ready**.

### The file list

`## Design` opens with one bullet per file the task touches, tests included.

```markdown
- `src/retry.ts` (changed): replaces `RETRY_MAX` in `retryJob` with the count from the settings
- `src/retry.test.ts` (changed): adds `retries as many times as settings say` beside the `retryJob` cases
- `src/settings/schema.ts` (added): follows `src/settings/flags.ts`, exports `RetrySettings`
```

- The path is a repository path in backticks. A file at the root is written as it is, such as `Makefile`.
- The kind is `added`, `changed` or `deleted`.
- The description follows the colon. **Its backticked identifiers are the entry's symbols.** `foo()` counts as `foo`
  and `A.b` as `b`. A backticked span with spaces, such as a test name, is no symbol.
- **A `changed` entry names at least one symbol, and every symbol it names exists in that file at the tip of the
  base branch once every issue in its `blockedBy` has merged.** `--check` looks each one up. A file or a symbol a
  blocker adds counts as existing, so a file a blocker adds is `changed` here. A blocker in another project counts
  the same, because that project is merged into `<from>` before this project's base branch is cut. A new name, or a name from another
  file, goes without backticks or into its own file's entry.
- Each entry is one bullet. A long description may wrap onto indented lines, and blank lines between entries are
  allowed. The list ends at the first line that is neither a bullet nor indented.
- Prose after the list is optional.

**The size limit is 8 files, and it belongs to the split.** `pj-1-plan` cuts every task to 8 files at most,
tests included, so that its review fits in one sitting. It is a planning rule, not a condition on the issue. When
`pj-2-doctor` or the implementation later takes a file list past 8, the issue stays one issue and one pull
request, and nobody asks whether to split it.

### Decisions

**The checkboxes in `## Decisions` are the only checkboxes in the body.** GitHub counts the boxes in an issue list
("1 of 3 tasks"), so that count reads as how many decisions are settled. Acceptance criteria are a plain list for that
reason.

- Each decision is `### D<n>. <question>`, then why it matters, then **2 to 4 options** as `- [ ]` lines.
- **An option says what it changes** on indented lines under its box: the behaviour, the names, the files. The
  user decides from the body alone, with no one to ask.
- `(recommended)` marks the option the writer would pick. **Exactly one option per decision carries it.**
- **A decision is settled when exactly one of its boxes is checked.** No box checked means open. Two or more checked
  is a contradiction to raise with the user.
- **A human settles a decision by ticking its box on GitHub.** Ticking leaves the label alone.
- **An answer that is none of the options** is a new option line the human writes and ticks, or a comment on the
  issue. `pj-2-doctor` has the writer work either into the body.
- A line starting with `Decided:` may follow the options, with the reason in one or two sentences. A human may write
  it, and a writer that redraws the body keeps it.
- `D<n>` is never renumbered, even when a decision is dropped. Elsewhere a decision is referred to as `#<issue> D<n>`.

```markdown
### D1. Where does the retry count live?

The worker reads it on every job, and the admin screen writes it.

- [ ] An environment variable
  `RetrySettings` reads `RETRY_MAX`. Changing it needs a deploy.
- [x] A column on `settings` (recommended)
  `RetrySettings` reads the `settings` row. Also adds a migration, `db/migrate/add_retry_max.sql`.

Decided: the admin screen has to change it without a deploy.
```

**The body holds whichever box is ticked.** `## Design` and the file list are written for the recommended option,
and say nothing that another option would make untrue. What an option changes beyond that is under its box. When the
user ticks another option, the worker reads the design together with the lines under the ticked box.
`pj-2-doctor` has the writer redraw the body when those lines change the file list or reach past this issue.

**A sub-issue with no decisions** writes `None.` under `## Decisions`.

### Stubs

A stub is a sub-issue filed for work found along the way, before anyone has drawn it. `## Goal` says what was found,
why it matters, and which issue it was found in. Every other section reads `To be drawn.`.

```markdown
## Goal

<what was found, why it matters, and that it was found while working on #<n>>

## Design

To be drawn.

## Acceptance criteria

To be drawn.

## Decisions

To be drawn.

## Out of scope

To be drawn.
```

**A stub never carries `ready`.** `pj-2-doctor` has the writer draw it into a full body first.

## Fixed tokens

These stay in English whatever language the repository uses, because the skills and `project.sh` match on them:

- the section headings of both bodies, and `### D<n>.`
- `(recommended)`, `Decided:`, `None.` and `To be drawn.`
- the kinds in the file list: `added`, `changed` and `deleted`
- the markers (see **Comments**)
- `Base:` and `from` in the parent body's first line, and the parent's `## Order`
- in a pull request body, `Implements` and `Part of`

Everything else is prose in the repository's language.

## When an issue is ready

`ready` goes on when all of these hold:

- every decision under `## Decisions` has exactly one box checked, or it reads `None.`
- `## Design` reads as the decisions say, with no "depending on D1" left in it
- nothing in the body contradicts the parent's `## Design`, or another open issue
- the project review found nothing left on it (see `pj-2-doctor`)
- **it can be implemented straight from its body.** A worker who reads only this body, the parent's `## Design`, the
  `## Design` of every parent in `dependsOn` and the code finds nothing left to design. `project.sh` checks the part of this a script can see, as a lint:

| Code | Fails when |
| --- | --- |
| `stub` | the body is a stub |
| `sections` | the five headings are not all there, in order |
| `no-files` | the file list is empty |
| `file-entry` | an entry has no kind or no description |
| `no-symbols` | a `changed` entry names no symbol |
| `criteria` | there is no acceptance criterion, or a criterion has no backticked anchor |
| `decision-shape` | a decision does not have 2 to 4 options, or does not have exactly one `(recommended)` |
| `decisions-open` | a decision is open |
| `decisions-contradictory` | a decision is contradictory |

Only `pj-2-doctor` adds `ready`, after its project review. Ticking boxes on GitHub settles decisions and leaves the
label alone, so the user runs `pj-2-doctor` after ticking.

Who checks, and when:

| Skill | When | Accepts |
| --- | --- | --- |
| `pj-1-plan` | before filing | a lint whose only reason is `decisions-open` |
| `pj-2-doctor` | before adding `ready` | `--check` with the lint clear, the premises clear or not evaluated yet, and no review finding left |
| `pj-3-running` | before showing the order, for every issue in it, and again right before each issue starts | a clear `--check` |

An issue is **workable** when it carries `ready`, every issue in its `blockedBy` is `CLOSED`, `--check` is clear, and
its project has `baseExists`, or every project in `dependsOn` is `merged`. The last part is the same condition the
premises wait for.

### Is the body still current?

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

`ready` comes off when something changes what the body says, such as a decision elsewhere. **Whoever takes it off
leaves a comment** on the issue saying what changed and where. A skill marks that comment (see **Comments**).

## Blockers

`blocker` marks what `pj-3-running` stopped on. It goes in one of two places.

1. **On a stub that blocks the stopped issue.** The work found lies outside the issue in hand, and the issue cannot be
   finished without it. The stub is a sub-issue of the same parent, and the stopped issue is blocked by it.

   ```bash
   gh issue create --parent <P> --blocking <n> --label blocker --title "<title>" --body-file <file>
   ```

2. **On the stopped issue itself, with `ready` taken off.** Its own body no longer holds: `--check` failed, the
   implementation reported `Diverged:`, or the code contradicts one of its settled decisions.

   ```bash
   gh issue edit <n> --remove-label ready --add-label blocker
   gh issue comment <n> --body-file <file>
   ```

Either way a marked comment on the stopped issue says what diverged, and names the decision as `#<issue> D<n>` when
there is one.

`pj-2-doctor` resolves both. A blocker that needs no code of its own is resolved by rewriting the issue in
question. A stub blocker resolved that way is then closed with a marked comment that points at the rewrite.

```bash
gh issue comment <m> --body-file <file>
gh issue close <m> --reason completed
```

An issue loses `blocker` when it gets `ready`. `pj-2-doctor` adds the one and removes the other in one
command.

**Whenever `pj-3-running` takes `ready` off an issue, it adds `blocker`.** An issue it stopped on is then always the
first thing `pj-2-doctor` takes up.

## Comments

Every comment a skill's main session posts starts with a bold marker, then the text.

| Marker | Posted by |
| --- | --- |
| `**[pj-2-doctor]**` | `pj-2-doctor` |
| `**[pj-3-running]**` | `pj-3-running` |

**A comment with no marker is from a human.** A skill reads it as one.

`pj-1-plan` files issues and posts no comments. The review of a pull request lives in the review files of its work
report (the `workflow` skill), so a pull request carries no review-thread markers.

## Pull requests

**One pull request per sub-issue.**

- Title: the issue's title.
- Base: the base branch.
- Branch: follows the repository's naming and contains the issue number.
- **The pull request of an issue** is a pull request into the base branch whose head reads `Implements #<n>`. An open
  one wins over a merged one, and the lower number wins within the same state. One closed without a merge never
  counts. `project.sh` reports it as `pr`.
- A pull request exists only once the task commit has passed review, so an open one has only the merge left. The next
  run of `pj-3-running` merges it. It stays a draft until just before the merge.
- Merge with squash, else a merge commit, else rebase, the first one the repository allows. After the merge, delete
  the head branch on origin and locally. Never `--admin`.

The body begins with this head:

```markdown
Implements #<n>
Part of #<P>
```

Below the head goes `workflow`'s `log.md`.

The head is the first line with any text on it. GitHub ignores closing keywords such as `Closes` in a pull request
into a branch other than the default branch, so the merge closes nothing. `pj-3-running` closes the issue itself after
the merge. An open issue whose `pr` is merged is a merge whose close never happened, and the next run of `pj-3-running`
closes it.

## Writing bodies

- **Write in the language the repository uses.** Look at the README and recent issues. Where the repository gives
  nothing to go on, write in the language the user is using. Talk to the user in the user's language.
- **Never point at a file by line number.** Point with a path and a symbol name.
- **Always pass a body with `--body-file`.** A body passed with `--body` on the command line breaks on quotes and
  backticks.
- **Re-read `updatedAt` right before an edit.** When it moved since you read the body, someone changed the issue in
  the meantime. Read it again and keep their change in what you write. Never overwrite a body you have not read.
