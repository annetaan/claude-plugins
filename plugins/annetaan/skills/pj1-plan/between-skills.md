# How the pj skills work together

This file holds what `pj1-plan`, `pj2-issues`, `pj3-doctor` and `pj4-running` agree on between them: who creates
the base branch, the labels, the comments, the pull requests, how they name an issue to the user, the commands
and how they write to GitHub. The four skills,
`pj-auto`, `cleanup` and `pj-roadmap` read it first.
The project reviewer looks up **Blockers**, and the `workflow` skill's **From an issue** (`workflow/from-issue.md`) looks up **Pull requests**.
The issues and their bodies are in `format.md`, and how `project.sh` judges a project is in `state.md`, both next to
this file.

## The four skills

| Skill | What it does |
| --- | --- |
| `pj1-plan` | designs one initiative or other large request in broad strokes, cuts it into projects, and files one parent issue per project, with blocked-by relationships between the parents, and, for a request that is a roadmap entry, the `Roadmap:` line on one parent of the last stage |
| `pj2-issues` | splits one project into tasks once every project it waits on is merged, and files its sub-issues with the decisions they need, the blocked-by relationships inside the project, the run order and the titles, and, under a parent with a `Roadmap:` line, the roadmap task as the last task |
| `pj3-doctor` | reviews a whole project against the boxes the user ticked and the code, has the issue writers redraw what no longer holds, draws the stubs, resolves the blockers, rewrites the run order and the titles, keeps the roadmap task blocked by every other open sub-issue, and labels an issue `ready` |
| `pj4-running` | creates a project's base branch when it first starts on the project, then works down the run order one pull request at a time, detailing each sub-issue against the code on the base branch before it runs (and redrawing its body and the order of the issues left when the code asks for it), running the `workflow` skill on each and merging it into the base branch before the next starts, and once every sub-issue is closed, merges the branch it was made from into the base branch and opens the pull request from the base branch into that branch |

The roadmap file, its line and its task are in `format.md` under **The roadmap file**, **The parent issue body** and
**The roadmap task**.

**The user decides by ticking boxes on GitHub.** Every question a task raises that only the user can answer is a
decision in its sub-issue (`format.md`, **Decisions**). What a model can settle, it settles and records under
`### Model decisions` in `## Design`, and the user overturns one with a comment on the issue (on an issue that carries `ready`, also taking `ready` off,
because `pj4-running` never reads comments). No skill asks a task's decision in the conversation. `pj4-running` may add
a decision to an issue and stop, when its detail pass finds one only the user can settle. `pj1-plan` and `pj2-issues` ask
only the questions that change the cut into projects, the split into tasks, or a parent's `## Design`. `pj3-doctor`
talks with the user about everything else: a split, two boxes ticked in one decision, and its changes before they are
written.

`pj-auto` is not one of the four. It drives `pj3-doctor` and `pj4-running` on one project as unattended runs, one
fresh `claude -p` process per step, and lets `project.sh --next` (`state.md`, **What comes next**) pick every step.

`cleanup` is not one of the four either. It runs once the user has merged a project's pull request: it closes the parent,
removes every worktree of the project after moving its work reports into the main working tree, deletes the base branch on
origin and locally, fast-forwards the local `<from>`, and deletes the work reports in the main working tree beyond the 100 newest, by the time stamp in their name.

`pj-roadmap` is not one of the four either. It brings the repository's roadmap file into the format (`format.md`,
**The roadmap file**) on a branch of its own and opens a pull request that the user merges. `cleanup` tidies up
after it.

## Principle

**GitHub holds all the state.** The issues, their labels, their relationships, their comments and the pull requests
are the whole project. A project can stop anywhere and pick up again from another session, another day or another
machine.

Two things live outside GitHub, and only these two:

- **the user's approval within a run.** An approval covers the run it was given in. The next run asks again. A run started
  with `unattended` asks for none, because starting it that way is the approval (see **Unattended runs**). A `pj-auto`
  drive is approved once, at its start, and that approval covers every unattended run it starts.
- **the work a stopped run leaves in its own worktree** `<MAIN>/.claude/worktrees/pj-<P>-<k>-<stamp>` (or
  `pj-<P>-sync-<stamp>`), where `<MAIN>` is the main working tree. That is a run that stopped before every commit passed
  review, a process killed mid-run, or a stopped merge of `<from>`. It is local. It stays there, with its commits on a
  detached HEAD, until `/annetaan:cleanup <P>` asks before removing it. No later run uses it, and the work is redone.

The conversation supplies which project a run goes on with when no number is given, and never anything about that
project (**Picking the project**).

The worktree itself is a place to work, not state. Each run makes its own. A drive's log directory is the
same: the next drive never reads it.

## Requirements

- `gh` 2.99.0 or later, the version the whole plugin needs for `gh pr create --attach`. It carries `--parent`,
  `--blocked-by`, `--blocking` and the `parent`, `subIssues`, `blockedBy` and `blocking` fields of `gh issue` that
  these skills use.
- `gh` logged in.
- Issues turned on in the repository.

```bash
gh --version
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

## The base branch

Only `pj4-running` creates `pj/<P>`. It does so when it starts on the project, the base branch does not exist yet,
and every project in `waitsOn` is `merged` (`state.md`, **When a project is merged**), which always holds for a
project that waits on none. It cuts the base branch from the tip of `<from>`, the branch the parent's `Base:` line
names after `from` (`format.md`, **The parent issue body**), through the GitHub API, in `run.sh start`
(`pj4-running/scripts/run.sh`).

A base branch cut later starts from a newer `<from>`, and conflicts less when it is merged back at the end.

Once every sub-issue is closed, `pj4-running` merges `<from>` into the base branch, then opens the pull request from
the base branch into `<from>` (see **Pull requests**). The merge commit is pushed to the base branch directly, as a
fast-forward, the one commit that reaches it outside a pull request. A conflict is resolved by the `workflow` skill,
under review, before that push. Merging the pull request is a human's job. No skill merges it.

**Closing a parent** as completed means its project is merged. When `pj4-running` reads an open parent that is
`merged`, it closes it with a marked comment and `--reason completed`, both when it starts on that project and when
it starts on a project that waits on it. `cleanup` closes it the same way, with `**[cleanup]**`. Both close it through `run.sh close`,
which refuses a parent `project.sh` does not read as `merged`. A human may also close it after merging. The merge
itself is the human's job.

## Labels

| Label | What it means |
| --- | --- |
| `ready` | Every decision is settled and the body is complete for its day. pj4-running can work on it. |
| `blocker` | pj4-running stopped on this. Settle it before anything else. |
| `project` | The parent issue of a pj project. Its sub-issues are the project's tasks. |
| `doing` | A pj project whose sub-issues are filed. It marks the parent issue. |

**`issue.sh label`, `sub --label` and `parent` make sure a label exists before they first add it**, with the color
and the description `issue.ts` holds. A label the repository already has is reused as it is and never overwritten.

Only `pj3-doctor` adds `ready`, after its project review, to an issue that meets the bar
for it (`state.md`, **When an issue is ready**). Ticking boxes on GitHub settles decisions and leaves the label
alone, so the user runs `pj3-doctor` after ticking.

The parent never gets `ready` and is never worked on.

`pj2-issues` adds `doing` to the parent once its sub-issues are filed. `pj3-doctor` adds it to a parent that has
sub-issues and lacks it, as read from `parent.labels` (`state.md`, **Reading a project**). Nothing takes it off, and it
stays on a closed parent. Nothing reads it to decide anything: a project counts as split when it has a sub-issue
(**Picking the project**), and `doing` is there for a human to filter by. No comment goes with it.

**A stub never carries `ready`.** `pj3-doctor` has the writer draw it into a full body first.

`ready` comes off when something changes what the body says, such as a decision elsewhere. **Whoever takes it off
leaves a comment** on the issue saying what changed and where. A skill marks that comment (see **Comments**).

An issue loses `blocker` when it gets `ready`. `pj3-doctor` adds the one and removes the other in one `issue.sh
label` call.

**Whenever `pj4-running` takes `ready` off an issue, it adds `blocker`**, except on a `decision` stop. There the issue
holds a decision only the user can settle, so the user comes first, and `pj3-doctor` after the tick. Any other issue it
stopped on is then always the first thing `pj3-doctor` takes up.

## Picking the project

`pj2-issues`, `pj3-doctor` and `pj4-running` first gather the candidates, then decide the project in this order.
Read the number they were given, if any.

```bash
gh issue list --label project --state open --limit 100 --json number,title,url,subIssuesSummary --jq 'sort_by(.number)'
gh issue view <n> --json number,state,labels,parent
```

The candidates differ by skill.

- **`pj2-issues`**: the open parents whose `subIssuesSummary.total` is 0. Read `project.sh <P>` for each one. Give
  each candidate one line, naming the entries of `parent.waitsOn` that are not `merged`:
  - `#<P> <title> (startable)` when `parent.startable` is true
  - `#<P> <title> (waits on #<Q>, closed without a merge)` when every such entry is `CLOSED`. That project is
    pickable too. The check of `pj2-issues` asks to remove those relationships
  - `#<P> <title> (waits on #<Q>, #<R>)` otherwise
  - `#<P> <title> (<the message>)` when `project.sh <P>` fails, quoting its message, for instance `has no Base: line`

  Only the startable and the pickable candidates become options. The recommended project is the lowest-numbered
  startable one, or else the lowest-numbered pickable one. The free-text answer accepts any `#<P>` from the list. A
  candidate that is neither goes to the check of `pj2-issues` itself, which refuses it. A candidate whose `project.sh` failed is never an option or the recommendation, and the others
  go on as above. A number given that points at a candidate whose `project.sh` failed, or at no candidate, gets one
  line saying so, and the question has no recommendation. When no candidate is startable or pickable, print the list
  and stop without asking.
- **`pj3-doctor` and `pj4-running`**: the open parents whose `subIssuesSummary.total` is 1 or more. The recommended
  project is the lowest-numbered candidate. A number given that points at no candidate (no sub-issue, closed, not a
  project) gets one line saying so, and the question has no recommendation. The line of a
  candidate is `#<P> <title> (<completed> of <total> sub-issues closed)`. The free-text answer accepts any `#<P>` from the
  list.
- **`pj-auto`** takes the candidates of `pj3-doctor` and `pj4-running`. **`cleanup`** names its candidates and
  options in its own SKILL.md, takes any number given, stops as its SKILL.md says when no entry is merged, and decides by the rules below
  when none was.

Then decide, the first rule that fits:

1. **A number was given and it points at an option.** Take that project and ask nothing. For `pj3-doctor` and
   `pj4-running`, a sub-issue's number points at its parent and a number labelled `project` at itself. For
   `pj2-issues`, a number points at a startable or pickable candidate. A number that points at a candidate that is
   neither is taken too, and the check of `pj2-issues` refuses it.
2. **No number was given and the project of this conversation is an option.** Take it and ask nothing. The project of
   this conversation is the `<P>` of the most recent `project #<P>` line that a pj skill printed earlier in this
   conversation, before this run, and whose project is an option now. A line counts with or without ` unattended`
   after it. Whether a project is an option is read from the candidates gathered now, never from the conversation. For
   `pj2-issues`, an option is a startable or pickable candidate, so a candidate that waits is not taken here.
3. **No number was given and there is exactly one option.** Take it and ask nothing.
4. **Otherwise** print every candidate in its line form, then ask, as below.

When a rule decides without asking, say why on the line of the project picked: `#<P> <title> (the number given)`,
`#<P> <title> (the project of this conversation)` or `#<P> <title> (the only candidate)`. Print no candidate list. The
conversation supplies the project of rule 2 and nothing else. A candidate list, an option or a recommendation
remembered from an earlier run is never used.

Once the project is decided, the skill prints `project #<P>` on a line of its own, once per run, with ` unattended`
after it in an unattended run. The line has two readers: rule 2 of a later run in this conversation, and the run's own
rule for after a context summary.

The question has the header `Project` and at most 4 options: the recommended project first, marked `(Recommended)`,
then the rest by number. With one option only, the second option is `Stop`. When the list of candidates is empty, stop.

## Unattended runs

A `pj3-doctor` or `pj4-running` run is unattended when its args carry the word `unattended`, for instance
`/annetaan:pj4-running 12 unattended tmp=<dir>`. The word alone decides the mode, and the run needs a project number as well.
`pj-auto` starts its runs in this form.

- **Its directory.** `tmp=<dir>` in the args names an existing directory, and the run keeps its files there as `$TMP`.
  `pj-auto` passes one per run, at `<LOG>/<i>-<run>`. Without `tmp=`, `$TMP` comes from `mktemp -d`, as in a manual run.
- **The level.** `level=<level>` in the args, `standard` or `high`, overrides the repository's level for the run (**The level** in
  `workflow/SKILL.md`). `pj-auto` passes it to every run when it was given one. Without it, each run reads
  the level from origin's default branch.
- **The mode.** `pj-auto` starts every run with `--permission-mode auto`, grants it the rules every drive needs with
  `--allowedTools`, and adds the run's directory with `--add-dir`. File edits then run without asking inside the main
  working tree, the run's worktrees under `<MAIN>/.claude/worktrees/` and that directory, and auto mode's classifier runs or refuses each other call
  no rule decides. A refused call is not a question: the run takes another way its skill allows, or ends as
  needs-user, naming the call. A run writes its files to `$TMP` or the worktree, never under `.git/` or a system temp
  directory, because outside them the classifier judges the write and may refuse it.
- **The project.** Only rule 1 of **Picking the project** applies. No number, or a number that points at no option,
  ends the run as needs-user without asking. Rules 2 to 4 do not apply.
- **Questions.** An unattended run never calls `AskUserQuestion`. The approval question (`pj3-doctor` phase 4,
  `pj4-running` phase 2, in `pj4-running/issues.md`) is skipped, and the summary it would have shown is printed as usual. Any other question that
  comes due ends the run without asking, the way choosing stop on that question would, as needs-user.
- **The last line.** On ending, the run prints exactly one last line, one of:
  - `unattended: done`, when it ended in one of the ways its skill lists under **Ending an unattended run**
  - `unattended: needs-user <one line>`, for every other ending
- **The direction of the list.** Each skill lists the endings that are done. Any ending not on the list is needs-user,
  so a missed ending falls toward stopping, never toward silently moving on.
- **Manual runs.** A run whose args do not carry `unattended` is untouched by this section.

## Titles

The count in a sub-issue title (`format.md`, **The title**) is written only by `pj2-issues` and `pj3-doctor`, each
with one title sync after its bodies are on GitHub. The sync is this command, run once per parent. It brings the title
of each open sub-issue to its `wantedTitle` and prints the numbers it retitled as `changed`.

```bash
issue.sh titles <P>
```

- A closed issue is never retitled.
- A sync that fails partway leaves a stale count, and the next `pj3-doctor` run fixes it. Nothing reads the count to
  decide anything.
- `pj4-running` writes a title only on a `decision` stop, to bring it to `wantedTitle` after it appended a decision.

## The handover comment

The parent carries one comment that starts with `**[pj4-running]** Handover notes`, fifteen lines at most below that
line. It holds what the workflow sessions learnt about working in this repository: the commands that run the tests,
the conventions kept, the traps hit.

`pj4-running` reads it at the start of a run and rewrites it in place after every merge. The read is this command.

```bash
gh api "repos/{owner}/{repo}/issues/<P>/comments" --paginate --jq '.[] | select(.body | startswith("**[pj4-running]** Handover notes")) | {id, updated_at, body}'
```

The rewrite passes the `updated_at` of that read as `--since`. When the read found no comment, the first one is
posted without it.

```bash
issue.sh handover <P> --since <updated_at> --body <file>
issue.sh handover <P> --body <file>
```

A `moved` stop means a human changed the comment, removed it or posted one since the read. Read it again and work
their change in.

## Blockers

`blocker` marks what `pj4-running` stopped on. It goes in one of two places. A `decision` stop leaves no `blocker`: the
issue holds an open decision, and the user ticks it first.

1. **On a stub that blocks the stopped issue.** The work found lies outside the task in hand, and the task cannot be
   finished without it. The stub (`format.md`, **Stubs**) is a sub-issue of the same parent, and the stopped issue is
   blocked by it.

   ```bash
   run.sh stop <P> <n> blocking --comment <file> --stub <file> --title "<title>"
   ```

   `run.sh` (`pj4-running/scripts/run.sh`) files the stub labelled `blocker`, blocking `<n>`, then posts the marked
   comment on `<n>`.
2. **On the stopped issue itself, with `ready` taken off.** Its own body no longer holds: the detail
   pass could not draw a body that passes the checks.

   ```bash
   run.sh stop <P> <n> detail --comment <file>
   ```

   It puts `blocker` on, takes `ready` off, then posts the marked comment.

Either way a marked comment on the stopped issue says what diverged.

`pj3-doctor` resolves both. A blocker that needs no code of its own is resolved by rewriting the issue in
question. A stub blocker resolved that way is then closed with a marked comment that points at the rewrite, in one
call.

```bash
issue.sh close <m> --reason completed --comment <file>
```

## Comments

Every comment a skill's main session posts starts with a bold marker, then the text.

| Marker | Posted by |
| --- | --- |
| `**[pj3-doctor]**` | `pj3-doctor` |
| `**[pj4-running]**` | `pj4-running` |
| `**[cleanup]**` | `cleanup` |

**A comment with no marker is from a human.** A skill reads it as one.

`issue.sh comment`, `close` and `handover` refuse a file that does not start with one of these markers, with the stop
`no-marker`. `handover` takes only a file that starts with `**[pj4-running]** Handover notes`.

`pj1-plan` and `pj2-issues` file issues and post no comments. The review of a pull request lives in the review files
of its work report (the `workflow` skill), so a pull request carries no review-thread markers.

## Pull requests

**One pull request per sub-issue.**

- Title: the issue's title. It carries no count, because `ready` needs every decision settled and `pj3-doctor`
  syncs the title before it adds `ready` (see **Titles**).
- Base: the base branch.
- Branch: follows the repository's naming and contains the issue number.
- **The pull request of an issue** is the one `project.sh` reports as `pr` (`state.md`, **Reading a project**).
- A pull request exists only once every commit of the issue's plan has passed review, so an open one has only the merge left. The next
  run of `pj4-running` merges it. It stays a draft until just before the merge.
- Merge with squash, else a merge commit, else rebase, the first one the repository allows. After the merge, delete
  the head branch on origin and locally. Never `--admin`.

The body begins with this head:

```markdown
Implements #<n>
Part of #<P>
```

`workflow`'s `flow.sh record` writes the head at the top of `log.md`, and the work report follows it.

The head is the first line with any text on it. GitHub ignores closing keywords such as `Closes` in a pull request
into a branch other than the default branch, so the merge closes nothing. `pj4-running` closes the issue itself after
the merge. An open issue whose `pr` is merged is a merge whose close never happened, and the next run of `pj4-running`
closes it.

### The project's pull request

**One pull request per project**, from the base branch into `<from>`. `pj4-running` opens it once every sub-issue is
closed and the base branch contains `<from>`, and never merges it.

- Title: the parent's title.
- Base: `<from>`. Head: the base branch.
- The body's first line is `Part of #<P>`. Below it go the sub-issues closed as completed, each with its pull request.

When it merges, the project is `merged` (`state.md`, **When a project is merged**).

## Issues in a report

Every report to the user names an issue or a pull request by its full URL, such as
`https://github.com/<owner>/<repo>/issues/<n>`, never by a bare `#<n>`. The terminal turns a URL into a link that ends
at the first space, so the user reaches a decision to tick in one click. A report format in a skill that writes `#<n>`
means that URL. A decision is `<issue URL> D<n> <question>`.

**A URL stands between spaces.** Nothing but a plain ASCII space or a line break touches either end of a URL in a
report: no bracket, comma, full stop, colon or quote, and, in a language written without spaces between words, no
particle or full-width punctuation either. Write the URL bare, never inside backticks, quotes or a Markdown link. The
backticks around a report format in a skill are notation and never reach the output. Whatever touches the URL becomes
part of that link, and the click opens the wrong page. Write `https://github.com/<owner>/<repo>/pull/466 (pj/212 into
main)`, never `https://github.com/<owner>/<repo>/pull/466(pj/212 into main)` or
`https://github.com/<owner>/<repo>/pull/466.`
The rule also holds where a report format in a skill puts punctuation right after `#<n>` or a URL: the output puts a
space between them, as in `(waits on https://github.com/<owner>/<repo>/issues/7 , closed without a merge)`.

Every URL comes from `project.sh` or from the command that names the issue, never from one put together by hand:

- `url` on the parent, on each issue and on each entry of `parent.waitsOn` in `project.sh <P>` (`state.md`,
  **Reading a project**)
- `pr.url` on an issue's pull request, and `projectPr` on the parent
- the `url` that `issue.sh parent` and `issue.sh sub` print
- for a candidate whose `project.sh <P>` failed, the `url` of the `gh issue list` in **Picking the project**

The progress lines a run prints, such as `project #<P>` or `#<k> rewritten`, the headers of
`AskUserQuestion` and everything written to GitHub keep `#<n>`. GitHub draws a link from `#<n>` on its own pages.

## Commands

Claude Code asks before it runs a command no rule matches. A manual run then waits on the user, and an unattended run
hands the command to auto mode's classifier, which may refuse it. The skills therefore keep to single commands.

- **One command per Bash call.** Each Bash call runs one command as the skill shows it, with every path and value
  written out in full.
- **What a call never holds.** Shell variables, `$(...)` or `<(...)`; loops or heredoc scripts; chaining with `;`,
  `&&`, `||` or `|`. The exception is an allowlisted script reading a quoted heredoc, such as
  `project.sh --lint - <<'EOF'`. A `|` inside the quoted `--jq` expression of a `gh` command is part of that one
  command.
- **Reading output.** Read a command's output whole. Never filter it with `jq`, `awk`, `sed`, `grep` or `python`.
  When the output is too long and saved to a file, read that file with Read.
- **Writing files.** With Write, or with one command's own redirect (`> "$TMP/<name>"`).
- **Reading plugin files.** With Read, not `cat`.

## Format-only fixes

A sub-issue body can fail `--check` on its form alone. **The main session fixes that on the spot and runs the check
again.** The fix never goes back to a writer or to the design session, and it counts against no cap. It applies in
`pj3-doctor` right before `ready` goes on, and in `pj4-running`'s detail pass.

Two failures are format-only, and nothing else is:

- **A premise failure `symbol never in the file`.** The entry backticks a name the file has never held. Take the
  backticks off that name in that file's entry.
- **A lint reason that backticks, spaces and line breaks alone clear**, such as a criterion whose anchor lost its
  backticks, or an entry broken across lines without an indent.

A premise failure `symbol not found` is never format-only: the file once held the name, so the code moved.

1. Keep the failing body in a file, `<before>`, and write the fixed body to another, `<after>`. Change only backticks,
   spaces and line breaks.
2. Run `project.sh --same-words <before> <after>`. Go on only when `ok` is true and `lint` is what the step that
   called for the fix accepts.
3. Write `<after>` where the step writes the body, and run the check again.
4. **One fix per failing check.** When `ok` is false, or the check still fails after the fix, what is left is not
   format-only and goes the way the step gives for a failure.

Print `#<k> format fixed`, and name the fix in the report.

## Writing to GitHub

**Every write to an issue, a relationship, a label or a comment goes through `issue.sh`**, next to `project.sh` in
`scripts/issue.sh`. Reads stay with `gh` and `project.sh`. Each subcommand reads a body or a comment from a file
written with Write, so a call is one command.

| Subcommand | What it does |
| --- | --- |
| `label <n> [--add <name>,...] [--remove <name>,...]` | adds and removes labels on `#<n>` in one call, at least one of the two, and makes sure each label it adds exists (**Labels**) |
| `parent --title <t> --from <branch> [--blocked-by <Q>,<R>] [--roadmap <path> <heading>] --body <file>` | lints the body with its `Base:` line and, given `--roadmap`, its `Roadmap:` line, files the parent labelled `project`, blocked by the parents named, then writes those lines above the body with the parent's number |
| `sub <P> --title <t> [--blocked-by <n>,<m>] [--blocking <k>] [--label <name>] --body <file>` | files a sub-issue of `#<P>` with its edges and label, refuses a body whose lint fails on anything but `decisions-open` and `stub`, and runs the cycle check of `project.sh <P> --order` after its edges |
| `relate <n> add\|remove <m>` | adds or removes "`#<n>` blocked by `#<m>`", between two sub-issues or two parents, runs the cycle check on the project after an add, and takes the edge back off when it made a cycle |
| `order <P> --since <updatedAt>` | writes the parent body that `project.sh <P> --order-body` prints (`state.md`, **Reading a project**) |
| `titles <P>` | brings each open sub-issue's title to `wantedTitle` and skips the closed ones (**Titles**) |
| `edit <n> --since <updatedAt> --body <file> [--title <t>]` | writes a body, and the title when one is given; refuses a parent body that fails `project.sh --parent-lint`, and lints no sub-issue body |
| `comment <n> --body <file>` | posts a marked comment (**Comments**) |
| `handover <P> [--since <updated_at>] --body <file>` | rewrites the parent's handover comment; without `--since`, posts it only when the parent has none (**The handover comment**) |
| `close <n> --reason completed\|not-planned --comment <file>` | posts the marked comment and closes `#<n>` in one write; on an issue already closed, writes nothing |

**`--since` goes on the writes that replace text**: `edit`, `order` and `handover`. It is the `updatedAt` of the
issue, or the `updated_at` of the handover comment, from the read the text was drawn against. Labels, titles,
relationships and new comments replace no text a human wrote, and take none.

**The output** is one JSON object, and the exit is 0 on a write and on a refusal.

- A write prints `status` `ok`. `parent` and `sub` add `number` and `url`, and `titles` adds `changed`, the numbers
  it retitled.
- A refusal prints `status` `stop`, with a `reason` and a `message`.
- Exit 1 is a usage error or an unexpected failure, with `issue: <message>` on stderr. It is handled as a command that
  failed.

**The five stops.** Each changes nothing on GitHub, except `cycle`, which undoes its own edge.

- `moved`: the issue's `updatedAt`, or the handover comment's `updated_at`, changed since the `--since` given. The
  stop adds the new value under that name and, when the call names a file, `github`, the path of `<file>.github`,
  which holds GitHub's text. The model merges the human's change and writes again with the new value, except where a
  skill takes the stop `user`. A first `handover` stops `moved` when a handover comment already exists, and one with
  `--since` stops `moved` when the comment is gone.
- `closed`: the issue written to is closed. For `sub`, `order` and `handover` that is `#<P>`. `close` and `titles`
  never stop on it.
- `no-marker`: the comment file does not start with a marker (**Comments**). The model fixes the file and runs the
  call again.
- `lint`: `parent`, `sub`, or `edit` on a parent refused the body, and the stop adds `reasons`, the codes `project.sh`
  printed. The body goes back to the writer that drew it, or to the planner, and the call runs again with the body that
  comes back.
- `cycle`: an edge made a cycle and was taken back off. After `sub` the issue stays filed without its edges, and the
  stop adds its `number` and `url`. The run reports the edge as a split error, says what was written, and stops.

**The checks run in this order**, all before the first write: usage, `no-marker`, `lint`, `closed`, `moved`. `order`
checks `cycle` between `closed` and `moved`, and the `cycle` of `sub` and `relate` comes after the write it takes back.

**A `moved` stop from `order`** names no file. Read `project.sh <P>` again and run `order` again with its
`parent.updatedAt`, once: `--order-body` builds the body from GitHub's current text, so the human's change is kept. A
second `moved` is reported, and the next `pj3-doctor` run rewrites the order.

**A stop that a skill's step does not name is a failure of that step**, reported with what was written, as for a
command that fails halfway.
