# The issues of a project

This file holds how a project is laid out as issues: the parent body, the sub-issue body, the decisions and the run
order, and the format of the roadmap file. The planners and the issue writer read this file and `workflow/judgement.md`, whose path their prompt gives. The project reviewer, `pj1-plan`, `pj2-issues` and
`pj3-doctor` read this file first too, and `pj4-running` and the `workflow` skill look up sections of it. How `project.sh` judges a project is
in `state.md`, and what the skills agree on between them is in `between-skills.md`, both next to this file.

## The parts

| Part | On GitHub |
| --- | --- |
| The project | one **parent issue** labelled **`project`**. Its body holds the design of this project. |
| A project split into tasks | the **`doing`** label on the parent |
| A task | one **sub-issue** of the parent. One task becomes one pull request. |
| Where the work lands | the **base branch** `pj/<P>`, named by the parent's `Base:` line (see **The parent issue body**) |
| An order between tasks | a native **blocked by** relationship between two sub-issues of one project. Never written into a body. |
| The run order | the numbered list under the parent's **`## Order`** (see **The run order**). |
| An order between projects | a native **blocked by** relationship between the two parents (see **Projects**). |
| The initiative's roadmap entry | the **`Roadmap:`** line of one parent, and that project's **roadmap task** (see **The parent issue body** and **The roadmap task**) |
| A task whose body is drawn and whose decisions are settled | the **`ready`** label |
| Something `pj4-running` stopped on | the **`blocker`** label |

### Projects

One request to `pj1-plan`, usually one initiative, can become several projects, `PJ1, PJ2, …` while `pj1-plan` plans them, each a parent issue of its own.
`pj2-issues` numbers the tasks of one project `T1…Tn`. Every project from one request is made from the same branch.

**A request becomes several projects for three reasons only.** The split raises review accuracy (a reviewer can judge
each project on its own, **Where to split** in `workflow/judgement.md`), the projects can run in parallel, or a part is worth
landing in `<from>` first, because it is of value on its own or because another project waits on it. **Size alone is
never a reason**, and no count of tasks is a limit. Work that can only go one way, each part waiting on the one before
it, stays one project unless one of those reasons holds: a cut there runs nothing in parallel, and it costs a pull
request into `<from>` and a merge to wait for before the next project can even be split into tasks.

**A request that is a roadmap entry leaves the roadmap through one project, the last of its stages.** `pj1-plan`
picks it among the projects of the last stage: the one with the lowest PJ id. With several
projects in the last stage, the entry may leave `<from>` before a sibling merges. That is accepted.

**Project P waits on project Q when parent P is blocked by parent Q.** That relationship is the only record of it.
`project.sh` reads it as `parent.waitsOn`. `pj1-plan` draws an edge in two cases only: P uses something Q makes, or
both touch the same area. The reason stays in the conversation, and no parent body names another project. **No
cycles between projects.**

**Stages.** A project that waits on nothing is in stage 1. Every other project is one stage after the latest stage it
waits on. Projects in the same stage can run in parallel.

**`pj2-issues` splits a project only once every project it waits on is merged**, so the split reads their code.

**A parent edge changes only while the waiting project has no base branch**, by `pj2-issues` or `pj3-doctor`, after
the user approves it. The base branch is cut from `<from>` once, and has no way to take in another project's work
later. Once it exists, work the project needs from elsewhere becomes a stub in the project itself.

### Relationships

Dependencies live in GitHub's own relationships, so the issue page shows them and a command can read them. **Never
also list them in a body.** Two copies drift apart. The skills write the edges with `issue.sh relate`, `issue.sh sub
--blocked-by` and `issue.sh parent --blocked-by` (`between-skills.md`, **Writing to GitHub**).

A sub-issue edge runs between two sub-issues of the same parent. A parent edge runs between two parents. An edge never
runs between a parent and a sub-issue, between sub-issues of different projects, or from a parent to an issue that is
no project. `project.sh` fails on the last one.

**No cycles**, within a project or between projects. `project.sh <P> --order` fails and names the cycle when there is
one, of either kind. `issue.sh relate` and `issue.sh sub` run it after an edge they add, on the project whose edges
changed, and take the edge back off when it made a cycle. `pj1-plan` checks the edges `issue.sh parent` wrote with
`project.sh <P> --order` after filing.

## The roadmap file

A repository that plans its work in a roadmap keeps it in one file. **Exactly one of `roadmap.md` and `ROADMAP.md`
exists, at the root, under `doc/` or under `docs/`** (six paths). The names are compared exactly, by listing the
directory, so a file system that ignores case does not show one file twice.

**One initiative is one entry.** An entry starts at a line `## <heading>` outside a code fence and runs to the line
before the next such line, or to the end of the file. Deeper headings (`###` and below) belong to the entry. The body
is free. Headings are unique, compared as written after trimming. The preamble is everything before the first entry.
It is free and may hold one `# ` title. A file with no entry is in the format: it is what the last initiative leaves
behind.

**What `project.sh --roadmap` checks.** It is the only reader of this file (see `state.md`). A leading front matter block (a first line `---`, up to the next
`---` or `...` line) is outside the format: it is neither preamble text nor an entry, and no check looks inside it. It
reports these codes:

| Code | Meaning |
| --- | --- |
| `no-file` | none of the six paths exists |
| `several-files` | more than one of them exists |
| `duplicate-heading` | two entries have the same heading |
| `empty-heading` | a `##` line has no text |
| `several-titles` | the preamble holds more than one `# ` heading |
| `title-after-entry` | a `# ` heading comes after the first entry |
| `setext-heading` | a heading is underlined with `===` or `---` |

## The parent issue body

```markdown
Base: `pj/<P>` from `<branch>`
Roadmap: `<path>` <entry heading>

## Order

1. #<n>
2. #<m>

## Goal

<what is true once every sub-issue is closed, in a few sentences>

## Design

<the boundaries this project defines and its tasks have to match: contracts, types, schemas, names, and why a new
abstraction is needed if one is added, and, when the project changes an assumption existing behaviour relies on, who
each branch kept from existing code still serves>

### Shared state

<optional: see **Shared state and model decisions**>

### Model decisions

<optional: see **Shared state and model decisions**>

## Decisions

<the answers the user gave to pj1-plan and pj2-issues, each one settled, in the shape of a sub-issue decision. None. when there were none>

## Out of scope

<what the request might be read to include and this project leaves alone>
```

The task list is the sub-issue list GitHub draws under the body. `## Order` is the one list of sub-issues a body
holds, and it says the order, not what the tasks are. `## Order` appears once `pj2-issues` files the sub-issues.
Before that, the lines above are followed by `## Goal`.

`## Design` holds only the boundaries this project defines. A boundary another project defines stays in that
project's parent. Whoever reads the parent's `## Design`, the issue writer and the `workflow` skill alike, also reads
the `## Design` of every parent in `waitsOn`.

### Behaviour kept under a changed assumption

For each kept branch whose assumption the project changes, `## Design`
names the assumption and says who the branch still serves. For a change to shared state it holds the `### Shared state`
list. The rules are **Assumptions** and **Why existing behaviour is there** in `workflow/judgement.md`. A branch nobody can be
named for goes through the history lookup first, and becomes a decision only when history is silent. A line that a
human fork replaced reads `decided in #<n> D<k>`, which keeps the boundary in the parent.

### The run order

`## Order` holds one numbered line per sub-issue, `1. #<n>`, and nothing else. GitHub draws each reference with the
issue's title and whether it is open or closed, so the list shows the progress with nobody ticking anything.

- **`pj4-running` works down it from the top**, and stops at the first open issue that is not workable
  (`state.md`, **When an issue is workable**). Nothing is skipped.
- **A human may reorder it by hand.** It must not put an issue before an open blocker of the same project.
- **`pj2-issues` writes it when it files the sub-issues, and `pj3-doctor` rewrites it** from
  `project.sh <P> --order`, whose `list` keeps the human's order wherever the blockers allow it. The closed issues
  come first, then the open ones. An issue closed as not planned leaves the list.
- **`pj4-running` rewrites it only after a detail pass changed the edges.** A closed issue shows as closed where it
  stands.
- All three write it with `issue.sh order`, which writes the body `project.sh <P> --order-body` prints.

`project.sh <P>` reads the list as `parent.order` and checks it as `parent.orderCheck`
(`state.md`, **Reading a project**). An issue missing from the list, such as a stub filed during a run, waits for
`pj3-doctor` to place it.

`Base:` names the project's base branch and, after `from`, the branch it is made from. That second branch is the one
the user merges the base branch into at the end. `issue.sh parent` files the parent and writes the line above the
body in one call, once the parent's number, which the branch name carries, is known. The line is written before the branch
exists, and `pj4-running` creates the branch later (`between-skills.md`, **The base branch**). Nobody changes the
line after that. A skill that rewrites the parent body keeps the line as it is.

The `Roadmap:` line is on one parent only, the one that carries the initiative's roadmap entry, and every other parent
has `Base:` alone. `<path>` and `<entry heading>` are `path` and the `heading` of one entry from `project.sh --roadmap`. `issue.sh
parent` writes the `Roadmap:` line on the carrier in the same call as `Base:`, and nobody changes it afterwards. A skill that rewrites the
parent body keeps it too. The lines above `## Goal` belong to the main session, and every planner body starts at
`## Goal`.

## The sub-issue body

```markdown
## Goal

<what this task makes true, in one or two sentences>

## Design

- `<path>` (changed): <what changes; on a code file, the existing symbols it rides on, such as `retryJob`; on a document, what it says afterwards>
- `<path>` (added): <what it holds, naming the file or symbol it follows>

<optional prose: how the pieces fit. Written as if every decision below were already made the way it is checked>

### Shared state

<optional: see **Shared state and model decisions**>

### Model decisions

<optional: see **Shared state and model decisions**>

### Left broken

<optional: see **Declared breakage**>

## Acceptance criteria

- <what has to hold for this task to be done, with a backticked anchor: a test name, a command, or a file or symbol
  whose state is checked. One criterion per user flow the task touches and per reader in `### Shared state`. A bug fix
  with a cheap test path names the test that fails first. A task that closes a declared breakage carries its check>

## Decisions

### D1. <the question, as a question>

<why it matters here: what each choice changes in the code, and what else it reaches>

Only you know: <the thing only a human can answer>

- [ ] <option A>
  <what it changes: the behaviour, the names, the files>
- [ ] <option B> (recommended)
  <what it changes>

### D2. ...

## Out of scope

<what a worker might be tempted to do here and must leave alone>
```

A body has to meet the bar for `ready` (`state.md`, **When an issue is ready**).

`pj4-running`'s detail pass may redraw the body before the issue runs, against the code as it then stands. `## Goal` and
every existing decision stay as they are, and it may append one decision when only the user can settle what it found.

### The file list

`## Design` opens with one bullet per file the task touches, tests included.

```markdown
- `src/retry.ts` (changed): replaces `RETRY_MAX` in `retryJob` with the count from the settings
- `src/retry.test.ts` (changed): adds `retries as many times as settings say` beside the `retryJob` cases
- `docs/retry.md` (changed): says the count comes from the settings
- `src/settings/schema.ts` (added): follows `src/settings/flags.ts`, exports `RetrySettings`
```

- The path is a repository path in backticks. A file at the root is written as it is, such as `Makefile`.
- The kind is `added`, `changed` or `deleted`.
- The description follows the colon. **Its backticked identifiers are the entry's symbols.** `foo()` counts as `foo`
  and `A.b` as `b`. A backticked span with spaces, such as a test name, is no symbol. **A backticked span that names
  a file is a path and never a symbol**, whether the file is in this issue's file list, in the repository, or in a
  blocker's file list. That includes a file at the root: `package.json` in a `package.json` entry names no symbol.
- **A `changed` entry on a code file names at least one symbol when the file holds a name, and every symbol it names
  exists in that file at the tip of the base branch once every issue in its `blockedBy` has merged.** `--check` looks
  each one up. A file a blocker lists
  as `added` counts as existing, so it is `changed` here, never `added`. A file a blocker lists as `deleted` is never
  `changed` or `deleted` here. A symbol a blocker adds counts as existing only when that blocker lists the file and
  names the symbol somewhere in its body. `--check` reads the open blockers' bodies for this while they are open. The projects this one waits on are
  merged into `<from>` before `pj2-issues` splits it, so their code is already there. A new name, or a name from
  another file, goes without backticks or into its own file's entry.
- **A code file holds a name** unless, once the quoted path after each `from` is left out, every word in it is
  `export`. A file of `export * from './a';` lines holds none, and its entry says what changes with no symbol.
- **A document has no symbols.** A document is a path that ends in `.md`, `.mdx`, `.markdown`, `.rst` or `.adoc`,
  compared without case. Every other path is a code file. A `changed` entry on a document needs no symbol, and
  `--check` looks up none of the names in it: it reads only whether the path exists. No check stops on how a
  document's entry is worded.
- Each entry is one bullet. A long description may wrap onto indented lines, and blank lines between entries are
  allowed. The list ends at the first line that is neither a bullet nor indented.
- Prose after the list is optional.

**The list is not bounded by size.** A task holds what is coupled in code (**Where to split** in `workflow/judgement.md`), so a
rename that reaches many files stays one task.

### Shared state and model decisions

Both are optional subsections at the end of `## Design`, after the file list and the prose.

- **`### Shared state`** appears when the change fires the outward rule of **Assumptions** in `workflow/judgement.md`. An entry
  is the state and the write. One indented line per reader follows it: the `symbol` in `path`, the lifetime it assumes,
  and whether that still holds.
- **`### Model decisions`** holds each fork a model settled and a reader would notice: what was chosen over what, why,
  and the evidence.
- **A human overturns an entry** with a comment on the issue. `pj3-doctor` has the writer work the comment in and
  remove the entry. On an issue that carries `ready`, the user also takes `ready` off, so that the next step is
  `pj3-doctor` and not `pj4-running`, which reads the body and never the comments.
- Backticked names in these subsections are not looked up by `--check`.
- `### Left broken` is the third optional subsection (see **Declared breakage**).

### Declared breakage

A task that a reviewer can judge alone may still leave a check of the repository failing on the project's base
branch until a later task of the same project closes it (**No transitional code** in `workflow/judgement.md`). The task
declares it as the last subsection of `## Design`:

```markdown
### Left broken

- `<check>`: <what fails once this task is merged into the base branch, and why>
```

- **The check** is the first backticked span of the bullet. It is one command, run from the repository root, that
  exits 0 when the check passes. It is compared as written.
- **The closer** is a sub-issue of the same project whose transitive `blockedBy` holds the breaker, that is open or
  closed as completed, and whose `## Acceptance criteria` has a bullet carrying the same backticked span.
- **`project.sh`** reports each entry in `parent.breakage` with its closers and its state, and `--check` fails with
  `breakage.unclosed` for an entry no closer carries (`state.md`, **Reading a project**).
- **A check that runs on the sub-issue's pull request cannot be declared**, required or not, such as a test that CI
  runs on every pull request. `run.sh merge` stops on any failing check and never uses `--admin`, so the
  tasks are one task.
- **`pj4-running` runs every declared check** in the sync worktree before it opens the project's pull request, after
  `<from>` is brought in and the preparation steps of the handover notes ran (`pj4-running/project-pr.md`, **The
  declared checks**).

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
  with `issue.sh titles` (`between-skills.md`, **Titles**).
- Ticking a box on GitHub leaves the title as it was until the next `pj3-doctor` run. `pj4-running` also writes the
  count, when it appends a decision to an issue and stops.
- A parent's title carries no count.

### Decisions

**The checkboxes in `## Decisions` are the only checkboxes in the body.** GitHub counts the boxes in an issue list
("1 of 3 tasks"), so that count reads as how many decisions are settled. Acceptance criteria are a plain list for that
reason.

- **A decision exists only when it passes **What a human is asked** in `workflow/judgement.md`**, and it carries
  `Only you know: <that thing>` on a line of its own before the options.
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
- A decision `pj4-running` appends is numbered after the highest `D<n>`, with no box checked.
- `D<n>` is never renumbered, even when a decision is dropped. Elsewhere a decision is referred to as `#<issue> D<n>`.

```markdown
### D1. Where does the retry count live?

The worker reads it on every job, and the admin screen writes it.

Only you know: whether the people who run the admin screen can wait for a deploy.

- [ ] An environment variable
  `RetrySettings` reads `RETRY_MAX`. Changing it needs a deploy.
- [x] A column on `settings` (recommended)
  `RetrySettings` reads the `settings` row. Also adds a migration, `db/migrate/add_retry_max.sql`.

Decided: the admin screen has to change it without a deploy.
```

**The body holds whichever box is ticked.** `## Design` and the file list are written for the recommended option,
and say nothing that another option would make untrue. What an option changes beyond that is under its box. When the
user ticks another option, the worker reads the design together with the lines under the ticked box.
`pj3-doctor` has the writer redraw the body when those lines change the file list or reach past this task.

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

### The roadmap task

A parent with a `Roadmap:` line has one **roadmap task**: the one sub-issue whose file list names the roadmap file.
No other task lists that file. `project.sh` identifies it as `parent.roadmap.task` (`state.md`, **Reading a
project**). It reads more than one such issue as no task, and `--check` fails each of them with
`roadmap.several-tasks`.

- **It is blocked by every other sub-issue**, so it is last in `## Order` and its change reaches `<from>` in the
  project's pull request. `pj2-issues` files it with those edges, and `pj3-doctor` adds an edge for each number in
  `parent.roadmap.missing`, none when there is no task.
- **What it does.** It deletes the entry the line names, from its `## ` line to the line before the next `## ` line.
  In the other entries it fixes each name of something this initiative renamed or removed, such as
  `retryJob` becoming `runWithRetry`. Nothing else in the roadmap changes, and no code.
- **Its premise.** `--check` reads the roadmap file at the ref and fails with `roadmap entry not found` when no entry
  carries the line's heading.
- **Its acceptance criteria are commands**: `grep -Fxc '## <heading>' <path>` prints `0`, and
  `git grep -w -F <old name> -- <path>` finds nothing for each fixed name.
- **`pj2-issues` leaves it out** when the roadmap at `origin/<from>` has no file, or has no entry with the heading.
  When the entry leaves by another hand after the line was filed, `--check` fails on it, and a human closes the task
  as not planned.

### What the lint checks

`project.sh --lint` reports these codes in `reasons`, for the part of the bar a script can see
(`state.md`, **When an issue is ready**). `--check` alone reports `no-symbols`, because only it reads the file at the
ref, and a path missing at the ref holds no name.

| Code | Fails when |
| --- | --- |
| `stub` | the body is a stub |
| `sections` | the five headings are not all there, in order |
| `no-files` | the file list is empty |
| `file-entry` | an entry has no kind or no description |
| `no-symbols` | a `changed` entry on a code file that holds a name names no symbol |
| `criteria` | there is no acceptance criterion, or a criterion has no backticked anchor |
| `breakage-entry` | `### Left broken` has no bullet, or a bullet has no backticked check |
| `line-number` | the body, outside code fences, points at a file by line number as `<path>:<n>` or `#L<n>` |
| `option-shape` | an option has no indented line under it: the next non-blank line is not indented, or is an option |
| `decision-shape` | a decision does not have 2 to 4 options, or does not have exactly one `(recommended)` |
| `only-you-know` | a decision has no line that starts with `Only you know:` followed by text |
| `decisions-open` | a decision is open |
| `decisions-contradictory` | a decision is contradictory |

The lint does not look at `### Shared state` or at `### Model decisions`. The main sessions and the project reviewer do.

`project.sh --parent-lint` reports these codes in `reasons` for a parent body (**The parent issue body**), and
`project.sh <P>` prints them as `parent.lint`.

| Code | Fails when |
| --- | --- |
| `base` | no line above the first heading reads `Base: `, a backticked `pj/<n>`, ` from ` and a backticked branch |
| `roadmap` | a `Roadmap:` line above the first heading names none of the six roadmap paths, or has no heading after the path |
| `order` | a line under `## Order` is neither blank nor `<i>. #<n>` |
| `sections` | the headings other than `## Order` are not `## Goal`, `## Design`, `## Decisions`, `## Out of scope` in that order, or `## Order` comes after `## Goal` |
| `decision-shape` | as in the sub-issue lint, with `None.` passing |
| `only-you-know` | as in the sub-issue lint |
| `decisions-open` | as in the sub-issue lint |
| `decisions-contradictory` | as in the sub-issue lint |

## Fixed tokens

These stay in English whatever language the repository uses, because the skills and `project.sh` match on them:

- the section headings of both bodies, and `### D<n>.`
- `(recommended)`, `Decided:`, `Only you know:`, `None.` and `To be drawn.`
- `### Model decisions`, `### Shared state` and `### Left broken`
- the kinds in the file list: `added`, `changed` and `deleted`
- the decision count ` (<settled>/<total>)` at the end of a sub-issue title (see **The title**)
- the markers (`between-skills.md`, **Comments**)
- `Base:` and `from` in the parent body's first line, `Roadmap:` in its second line, and the parent's `## Order`
- in a pull request body, `Implements` and `Part of` (`between-skills.md`, **Pull requests** and **The project's pull
  request**)

Everything else is prose in the repository's language.

## Writing bodies

- **Write in the language the repository uses.** Look at the README and recent issues. Where the repository gives
  nothing to go on, write in the language the user is using. Talk to the user in the user's language.
- **Never point at a file by line number.** Point with a path and a symbol name. The lint fails `<path>:<n>` and
  `#L<n>` (`line-number`). Every other form, such as `line 42`, is read by eye.
