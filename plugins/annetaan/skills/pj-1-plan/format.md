# The shape of a project on GitHub

This file is the only description of how a project is laid out on GitHub: the issues and their bodies, and what the
three skills agree on between them. All three skills below read it, and so do the planner, the issue writer and the
project reviewer, so a change here is a change to all of them. How `project.sh` judges the state of a project is in
`state.md`, next to this file.

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
not exist yet, and every project in `dependsOn` is `merged` (`state.md`, **When a project is merged**), which always
holds for a project that waits on none. It cuts the base branch from the tip of `<from>`, the branch the parent's
`Base:` line names after `from`, through the GitHub API, in `run.sh start` (`pj-3-running/scripts/run.sh`).

`pj-1-plan` writes the `Base:` line into every parent when it files it, before any of these branches exists.
A base branch cut later starts from a newer `<from>`, and conflicts less when it is merged back at the end.

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

Only `pj-2-doctor` adds `ready`, after its project review. Ticking boxes on GitHub settles decisions and leaves the
label alone, so the user runs `pj-2-doctor` after ticking.

`ready` comes off when something changes what the body says, such as a decision elsewhere. **Whoever takes it off
leaves a comment** on the issue saying what changed and where. A skill marks that comment (see **Comments**).

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

## Picking the project

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

- **`pj-3-running` works down it from the top**, and stops at the first open issue that is not workable
  (`state.md`, **When an issue is workable**). Nothing is skipped.
- **A human may reorder it by hand.** It must not put an issue before an open blocker of the same project.
- **`pj-1-plan` writes it when it files the project, and `pj-2-doctor` rewrites it** from
  `project.sh <P> --order`, whose `list` keeps the human's order wherever the blockers allow it. The closed issues
  come first, then the open ones. An issue closed as not planned leaves the list.
- **`pj-3-running` never writes it.** A closed issue shows as closed where it stands.

`project.sh <P>` reads the list as `parent.order` and checks it as `parent.orderCheck`
(`state.md`, **Reading a project**). An issue missing from the list, such as a stub filed during a run, waits for
`pj-2-doctor` to place it.

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

A body has to meet the bar for `ready` (`state.md`, **When an issue is ready**).

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
- **A human settles a decision by ticking its box on GitHub.**
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

### What the lint checks

`project.sh --lint` reports these codes in `reasons`, for the part of the bar a script can see
(`state.md`, **When an issue is ready**).

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

## Fixed tokens

These stay in English whatever language the repository uses, because the skills and `project.sh` match on them:

- the section headings of both bodies, and `### D<n>.`
- `(recommended)`, `Decided:`, `None.` and `To be drawn.`
- the kinds in the file list: `added`, `changed` and `deleted`
- the markers (see **Comments**)
- `Base:` and `from` in the parent body's first line, and the parent's `## Order`
- in a pull request body, `Implements` and `Part of`

Everything else is prose in the repository's language.

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
- **The pull request of an issue** is the one `project.sh` reports as `pr` (`state.md`, **Reading a project**).
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
