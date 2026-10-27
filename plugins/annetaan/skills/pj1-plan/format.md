# The issues of a project

This file holds how a project is laid out as issues: the parent body, the sub-issue body, the decisions and the run
order. The planner and the issue writer read only this file. The project reviewer, `pj1-plan` and `pj3-doctor` read
it first too, and `pj4-running` and the `workflow` skill look up sections of it. How `project.sh` judges a project is
in `state.md`, and what the skills agree on between them is in `between-skills.md`, both next to this file.

## The parts

| Part | On GitHub |
| --- | --- |
| The project | one **parent issue** labelled **`project`**. Its body holds the design of this project. |
| A task | one **sub-issue** of the parent. One task becomes one pull request. |
| Where the work lands | the **base branch** `pj/<P>`, named by the parent's `Base:` line (see **The parent issue body**) |
| An order between tasks | a native **blocked by** relationship. Never written into a body. |
| The run order | the numbered list under the parent's **`## Order`** (see **The run order**). |
| An order between projects | no record of its own. It follows from the order between tasks (see **Projects**). |
| A task that can be implemented straight from its body | the **`ready`** label |
| Something `pj4-running` stopped on | the **`blocker`** label |

### Projects

One request can become several projects, `PJ1, PJ2, …` while it is planned, each a parent issue of its own. The
tasks are numbered `T1…Tn` across the whole request. Every project from one request is made from the same branch.

**A project holds at most 10 tasks.** Like the 8-file limit, it is a rule of the split. `pj1-plan` cuts
the request so that no project holds more than ten. When `pj3-doctor` later splits an issue or files stubs and
a project goes past ten, it stays one project, and nobody asks whether to split it.

**Project P waits on project Q** when an open sub-issue of P is blocked by a sub-issue of Q, open or closed. That
edge is the only record of it. Parents get no relationships of their own, and no parent body names another project.
`project.sh` derives the projects P waits on as `parent.waitsOn`. **No cycles between projects.**

**An edge across projects may be added only while the blocked project has no base branch.** The base branch is cut
from `<from>` once, and has no way to take in another project's work later. Once it exists, work the project needs
from elsewhere becomes a stub in the project itself.

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
the `## Design` of every parent in `waitsOn`.

### The run order

`## Order` holds one numbered line per sub-issue, `1. #<n>`, and nothing else. GitHub draws each reference with the
issue's title and whether it is open or closed, so the list shows the progress with nobody ticking anything.

- **`pj4-running` works down it from the top**, and stops at the first open issue that is not workable
  (`state.md`, **When an issue is workable**). Nothing is skipped.
- **A human may reorder it by hand.** It must not put an issue before an open blocker of the same project.
- **`pj1-plan` writes it when it files the project, and `pj3-doctor` rewrites it** from
  `project.sh <P> --order`, whose `list` keeps the human's order wherever the blockers allow it. The closed issues
  come first, then the open ones. An issue closed as not planned leaves the list.
- **`pj4-running` never writes it.** A closed issue shows as closed where it stands.

`project.sh <P>` reads the list as `parent.order` and checks it as `parent.orderCheck`
(`state.md`, **Reading a project**). An issue missing from the list, such as a stub filed during a run, waits for
`pj3-doctor` to place it.

`Base:` names the project's base branch and, after `from`, the branch it is made from. That second branch is the one
the user merges the base branch into at the end. `pj1-plan` files the parent, then adds the line to the
body. It takes two steps because the branch name carries the parent's number. The line is written before the branch
exists, and `pj4-running` creates the branch later (`between-skills.md`, **The base branch**). Nobody changes the
line after that. A skill that rewrites the parent body keeps the line as it is.

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

**The size limit is 8 files, and it belongs to the split.** `pj1-plan` cuts every task to 8 files at most,
tests included, so that its review fits in one sitting. It is a planning rule, not a condition on the issue. When
`pj3-doctor` or the implementation later takes a file list past 8, the issue stays one issue and one pull
request, and nobody asks whether to split it.

### The title

A sub-issue title is one short line in the repository's language. While any of its decisions is not settled, it ends
with ` (<settled>/<total>)`. A decision is settled when exactly one of its boxes is checked, as **Decisions** below
defines it, so an open decision and a contradictory one both count as not settled. Two decisions with none settled
read `Add retry settings (0/2)`, then `Add retry settings (1/2)`, then `Add retry settings` once both are.

- **No parentheses** when the issue has no decisions (`None.`, or a stub's `To be drawn.`), or when every decision is
  settled.
- **A trailing ` (<n>/<m>)` belongs to this count.** A title never ends with one for any other reason, such as
  numbering the parts of a split.
- **Nobody writes the count by hand.** A writer returns a title without it. `project.sh` derives the title an issue
  should carry as `wantedTitle` (`state.md`, **Reading a project**), and the skills bring the titles in line with it
  (`between-skills.md`, **Titles**).
- Ticking a box on GitHub leaves the title as it was until the next `pj3-doctor` run.
- A parent's title carries no count.

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
  issue. `pj3-doctor` has the writer work either into the body.
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
`pj3-doctor` has the writer redraw the body when those lines change the file list or reach past this issue.

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

The labels a stub may carry are in (`between-skills.md`, **Labels**).

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
- the decision count ` (<settled>/<total>)` at the end of a sub-issue title (see **The title**)
- the markers (`between-skills.md`, **Comments**)
- `Base:` and `from` in the parent body's first line, and the parent's `## Order`
- in a pull request body, `Implements` and `Part of` (`between-skills.md`, **Pull requests** and **The project's pull
  request**)

Everything else is prose in the repository's language.

## Writing bodies

- **Write in the language the repository uses.** Look at the README and recent issues. Where the repository gives
  nothing to go on, write in the language the user is using. Talk to the user in the user's language.
- **Never point at a file by line number.** Point with a path and a symbol name.
