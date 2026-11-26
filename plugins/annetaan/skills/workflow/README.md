# workflow

This skill runs one implementation as **design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than
one task, then a finish step**, with each role in a session of its own. The review rounds run through Markdown files
in the run's work report directory, one per round and one reply to each, so the whole review stays readable after the
run. A standalone run works in a worktree of its own under `.claude/worktrees/`, so your own working tree stays free
and may be dirty. It always ends in a pull request, and in an issue labelled `decision` for each design decision a
person should read.

workflow is the plugin's core skill for one implementation. You run it yourself for a change that fits one pull
request. For larger work, pj4-running runs it once per sub-issue of a project (see [Driven from an issue](#driven-from-an-issue) and
[How the skills fit together](../../README.md#how-the-skills-fit-together)).

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

## Use it

Name the skill, or invoke `/annetaan:workflow`. It never starts on its own. You name it, pj4-running runs it for one sub-issue of a project, or you ask it to resolve the conflicts of a pull request (see [Conflicts](#conflicts)), because it spawns
several sessions and adds commits.

```
/annetaan:workflow add filter conditions to the search form
```

The design is drawn as if the request had always been required and moves existing code, contracts included, where
that gives the better shape, and what moves is in the start message the run shows you.

**It asks for no approval.** It asks you only what it cannot go on without: the design's open questions, each
saying what only you know, a design that says the request cannot be done as asked, and a task that does not settle
in five review rounds. With no open question, it asks nothing and runs to the pull request. Before the first task it
shows a start message with the design summary, the **plan**, an ordered list of tasks, and the model decisions, and
goes on without waiting. Say "stop" to end the run, and ask again to overturn a decision.

Each task's implementation session shows every acceptance criterion by running it, on the tree under review, and writes
the runs to an evidence file. A bug fix with a cheap test path starts with a failing test. Review seats try to break the change and prove every finding by a run of a probe they wrote: a command, what it
printed, and what the design requires. A repository at `standard` has one seat, and `high` has two, on different
models. `flow.sh verify` reruns each command, the open findings of earlier rounds included, sorts the findings by the
probe's exit and writes the draft of the round. The main session keeps only a
failure that breaks the design, and writes the round and its verdict from the draft. From round 2 on, each seat attacks
only what changed since the tree it reviewed last. What no seat could run is listed in the pull
request under its own heading. Each session lints the review file it writes with `flow.sh lint` before it reports, so
a seat file, a round file, a reply or an evidence file that drifts from the format is fixed where it is written.

Five more rules apply across the roles. The design removes what the request makes unnecessary before it adds anything,
and draws a new requirement as if it had always been there, down to the types, documents and examples that state the
old shape. A new layer needs a named second user and state lives in the narrowest place, and the code a task writes
answers where a value comes from and what can change it. A finding whose command still shows the failure after a second
answer is marked `stands again`, and is answered with `assumed:`, what both answers took for granted, before the next fix. A lesson that turns up a second time becomes a check inside the
task. A check that belongs outside the task is reported as `check wanted:`, and those lines get a heading of their own
in `log.md`, so they reach the pull request body. Code carries no comment beyond a licence header, a note in a configuration file, an instruction to a tool and a doc comment on a published library's public API, and the comments in a file a task changes leave with it. `scripts/comments.sh` fails a task that adds one or silences a check, and both sessions run it. An existing workaround is never a pattern to copy, and a change adds no explaining document the request did not ask for.

The start message names the new branch and `base: <branch>`. To start from another base, name it in the request.

The base is the branch your request names, otherwise the repository's default branch. A base that is missing on origin
stops the run. If you want to be asked every time, put a line like this in `CLAUDE.md`:

```
Confirm the base branch with me before every workflow run.
```

With that line, the run asks you to confirm the base every time. It offers the branch named in the request, the
default branch and the branch checked out in your clone.

Each task goes through implementation and review rounds, and a task that
passes review becomes one commit. When the plan has two or more tasks, one integration review over the whole diff
comes after the last task. A plan of one task skips it, because its task review already read the whole diff. Then it
pushes the branch and opens a pull request into the base.

**The design settles the boundaries. The tasks get detailed one at a time.** What the design fixes up front is what
crosses from one task into the next: the contracts, the types, the names, and the order things have to land in. The
interior of task 1 comes with it, because task 1 starts from the repository the design session just read. Every task
after that is detailed by the same design session while the task before it is committed, against the code the earlier
tasks actually produced. A plan that turns out to be wrong surfaces there, before anybody writes code against it.

**Five review rounds per task, fixed.** A task that does not settle in five comes back to you with the open points
laid out, and its changes stay uncommitted in the run's worktree. Saying "stop" partway through the rounds works too.

The implementation session and the review seats **start fresh for every task**, each on its own agent,
whatever the task. A task boundary is a cheap place to
start over. The code is in git, the plan is a file of the run, and every review finding is resolved. What is left
is how this repository wants to be worked in, and that rides along as **handover notes**: five lines
from each session, folded together into `<WORKDIR>/notes.md`, where `<WORKDIR>` is the run's work report directory, capped at fifteen.

## Driven from an issue

pj4-running works through a project's sub-issues one at a time and runs each one through this skill. The issue's text
is the design in its goal, its boundary and its decisions you ticked. A design session first **details the
issue against the code on the project's base branch**, which earlier issues have changed since the issue was drawn,
and it may redraw the issue's body and the order of the issues left. It stays for the whole run. That run has no approval
and no questions. The detail becomes a plan of one or more tasks, each one reviewed commit, and an
integration review follows when the plan has more than one. When only you can settle what the detail found, the run
adds that decision to the issue, stops, and leaves the box for you to tick.

The pull request body is `log.md`, which begins with a head of `Implements` and `Part of`. The run pushes and opens
the pull request as a draft against the project's base branch. pj4-running merges it.

Each issue runs in a worktree pj4-running made for it, so your own working tree is left alone, except for adding your answers to `.worktreeinclude`.

A stop before every commit of the plan has passed review pushes nothing. pj4-running keeps that worktree, its commits
on a detached HEAD, until `/annetaan:cleanup`, and the next run redoes the issue in a new one. A stop once the last commit and its integration review are done can only come during the
finish step, so the run finishes it: the report, the push and the draft pull request. A pull request exists only for
commits that passed review. The shape of the issues is in [pj1-plan/format.md](../pj1-plan/format.md), and the shape
of the pull requests in [pj1-plan/between-skills.md](../pj1-plan/between-skills.md).

Once every sub-issue of a project is closed, pj4-running merges the branch the project came from into the project's
branch before it opens the project's pull request. When that merge stops on conflicts, pj4-running runs this skill
once more, as one task that resolves them with its review rounds. Its commit is the merge commit, and pj4-running
pushes it. A stop before that commit leaves the merge in progress in the worktree, and the next run redoes it.

## Conflicts

**When the pull request would conflict from the start**, the finish step settles it before the push. The base may have
moved while the tasks ran. When the branch merges into it cleanly, nothing happens and GitHub merges it later. When it
conflicts, the run merges the base into the branch and resolves the conflicts as one more task, with a new
implementation session and the review seats and the same five-round cap, and its commit is the merge commit. The
review rounds are `merge-round-<r>.md` in the work report.

**When an open pull request conflicts later**, ask for it in plain words, such as "resolve the conflicts on #12" or
"コンフリクト解消して". That request starts this skill, and it asks no approval. A new worktree takes the pull request's
branch, the same merge task resolves the conflicts under review, the merge commit is pushed to the branch as a
fast-forward, and the worktree is removed, with its review files moved into your clone's `work-reports/`. With no
number named, it takes the one conflicting pull request of yours that GitHub reports, or asks which. A project's pull
request from `pj/<n>` goes to `pj4-running`, which brings the source branch into the project's branch again.

## Decisions

A run makes decisions of its own along the way, and some of them deserve a person's eye. Once the pull request is
open, review seat a reads the whole change once more, the design and the diff, and names each design decision in
technology, infrastructure, database or delivery: a library, service or major version added or swapped, hosting,
queues, caches or secrets, a store, a table or a migration, a deploy or release pipeline. The implementation session
does not judge its own decisions. Decisions you settled yourself, an answered question, a ticked box in an issue or
what your request named, are not filed.

Each decision becomes one issue labelled `decision`, with four parts: what was decided, the other options and why this
one, where it landed (the pull request and the files), and how to overturn it. The label is created when the
repository lacks it. Close the issue once you have read it. To overturn the decision, run the request under "To
overturn it" as it stands: it is a full `/annetaan:workflow` request. Filing never holds the pull request back, and a
run that could not file says why in its final message.

## The worktree and cleaning up

The run creates `.claude/worktrees/run-<stamp>` on the tip of the base before the design starts, and never touches your
clone, except for adding your answers to its `.worktreeinclude`. The run copies the ignored files that `.worktreeinclude` in your clone names, such as `.env.local` or
`mise.local.toml`, into the worktree and into the review seats. It is the same file Claude Code's own `--worktree`
reads. For an ignored file the list does not name, the run asks once whether to copy it, and writes the answer to the
list as `/<path>` or `!/<path>`, so it is never asked again. The first worker prepares what remains, such as
dependencies. A run that ends before its first task removes its worktree. Every other run leaves it, whether it opened a pull request
or stopped midway.

The review seats are git worktrees of their own, `review-run-<stamp>-<seat>` beside the run's. No session works
inside one: a seat writes its probes under `seats/` in the work report, and `flow.sh run` snapshots the run's working
tree, puts the seat's worktree at it and runs the probe there. A seat gets the files `.worktreeinclude` lists when it
is created. A seat lives as long as the run's worktree, so the
dependencies a probe installed in it serve every later task and round. The cleanup removes it.

After you merge or close the pull request, `/annetaan:cleanup` moves the work report into `work-reports/` in
your clone, removes the worktree, the review seats and the branch, fast-forwards your local base after a merge, and deletes the reports there beyond the 100 newest, by the time stamp in their name. Details are in
[cleanup](../cleanup/SKILL.md).

```
/annetaan:cleanup 57
```

## What it leaves behind

Every run writes a work report. It lives under the worktree's `work-reports/` until the cleanup.

```
work-reports/2026-09-19-1346-a1b2c3d/
  log.md         on a run from an issue first the `Implements` and `Part of` head, then what changed, how it was
                 verified, the checks wanted, what the review changed, the screenshots, and last one `Level:` line
                 with the level, its source and the review counts, the head and that line written by flow.sh record
  changes.diff   the diff from the start commit to HEAD
  run.json       the start commit, the level and its source, the issue and the parent, written once by flow.sh begin
  design.md      the design: the design session's in a standalone run, project.sh --design on a run from an issue
  plan.md        the plan of tasks, the flows to walk and the forks settled, written by the design session
  detail/        task-1.md and up, the detail of each task, written by the design session
  notes.md       the handover notes, folded by the main session after each commit
  adaptations.md the adaptations of a run from an issue, written by the main session
  checks.md      the check wanted: lines of the commit reports, written by the main session
  merge.md       the design, plan and detail of a merge task, written by the main session
  prompts/       the prompt of each sub-agent call, written by flow.sh prompt
  decisions.md   the design decisions seat a judged at the finish, or `None.`
  decisions.json the decision issues flow.sh decisions filed, so that a second run files none twice
  review/        one file per review round, the reply to each, and the evidence files
    task-1-evidence.md
    task-1-round-1-a.md         what seat a proved in round 1, and `-b` for seat b at `high`
    task-1-round-1.md           the main session's round, from its draft
    task-1-round-1-reply.md
    task-1-round-1-evidence.md  after a round that changed code
    integration-round-1.md      plans of two or more tasks, with one file per seat
  seats/         the probes of the review seats, `a/<name>/run.sh` and its `tree/`
  drafts/        the draft of each round file, under the round file's name, written by flow.sh verify from the reruns
  scratch/       throwaway scripts: design/ of the design session, work/ of the implementation session
  before.png     before and after, when the change shows on screen
  after.png
```

The directory name is the local time the run started, plus the short SHA of the commit it started from. A second run
of the same minute and commit gets `-2`, `-3` after the name. `flow.sh status` names the current run, the one whose
`run.json` was written last.

**These live inside the repository so that you see them.** A cleanup deletes the ones in your clone's
`work-reports/` beyond the 100 newest, by the time stamp in their name. In a temp directory somewhere else they eat
disk where nobody looks. In exchange, the run adds `.claude/worktrees/` and `work-reports/` to `.git/info/exclude`
when that file has no line for them, without asking, and stops only when a `.gitignore` rule negates one of them. That file
stays in your clone, so nothing is committed and `.gitignore` is never edited.

`log.md` has no fixed headings. If the repository has `.github/PULL_REQUEST_TEMPLATE.md`, the report follows it.
Otherwise it follows how recent merged pull requests are written. With nothing to go on, the implementation session
picks a structure. Whatever it picks, the report has to answer what changed, how it was verified with the commands
that were actually run, what the review changed, and which commit answers which task in the plan.

`log.md` becomes the pull request body. On a run from an issue it starts with the head `Implements #<n>` and
`Part of #<P>`. It ends with one `Level:` line: the level the run used, its source, the tasks, the task rounds, the
integration rounds and the findings, as
`Level: standard (file) · tasks 2 · task rounds 3 · integration rounds 1 · findings 4`. `flow.sh record` writes both, the
head from the issue and the parent and the line from the level and source that `flow.sh begin` stored in `run.json`.
`/annetaan:level` reads these lines from the merged pull requests. `review/` holds how each finding was raised and answered.

## Screenshots

When the change shows on screen, the run takes screenshots.

- **A new piece of UI**: one shot of the finished state.
- **A change on an existing screen**: **before and after, both.**
- **A change that never reaches a screen**: none.

A before shot cannot be taken after the fact, so the implementation session is told to **shoot the current state
before it touches anything**.

## What you need

- to be inside a `git` repository with an `origin` remote on GitHub
- `gh` 2.99.0 or later, logged in, because every run ends in a pull request, and it also creates the `decision` issues and their label
- your working tree may be dirty

**gh 2.99.0** added `gh pr create --attach`, which uploads the screenshots into the pull request body.

## What is in here

| File | What it is |
| --- | --- |
| `SKILL.md` | the procedure for the orchestrator, which is the main session: which file each entry reads, the agents, the prompts, phases 2 to 4 and the rules every entry shares |
| `standalone.md` | the standalone run: design, the open questions and the start message, the integration review and the finish |
| `judgement.md` | the rules every role of workflow and the pj skills reads. It opens with a table that maps each section to the roles that apply it, and holds what a human is asked, model decisions, experiments, assumptions, root cause, evidence, removing before adding, designing as if always required, reader load, the language and runtime when none is settled, effects at the edges, arguments left as given, comments, documents, existing workarounds, what two failed fixes share, and turning a repeated lesson into the strongest check that holds it |
| `typescript.md` | what only a TypeScript change needs: the runtime, the type check, a new project's checks and the lint rules for effects and arguments, which `judgement.md` cites by section |
| `from-pr.md` | resolving the conflicts of a pull request that is already open |
| `from-issue.md` | one sub-issue, detailed against the code and run as a plan of one or more commits, for pj4-running |
| `from-sync.md` | a merge of the source branch into a project's base branch that stopped on conflicts, for pj4-running |
| `merge-task.md` | the merge task, which resolves conflicts under review, for the standalone finish, from-pr and from-sync |
| `worktree.md` | the start check and the run's worktree, for the standalone run and from-pr |
| `finish.md` | the work report, the pull request and the decision issues, for the standalone run and from-issue |
| `prompts/` | the templates `flow.sh prompt` fills into the prompt of each sub-agent call, one per kind, and `worktree-line.md`, the line every prompt ends with |
| `roles/design.md` | the role for the design session, which writes the design and the plan into the work directory |
| `roles/work.md` | the role for the implementation session |
| `roles/review.md` | the role for a review seat |
| `scripts/worktree.sh` | creates the run's worktree and adds its ignore rules, merges the base in on a conflict, reads pull requests, and finds an open `level` or `pj-roadmap` proposal or commits, pushes and opens a new one |
| `scripts/worktree.ts` | the code `worktree.sh` runs. Every fetch from origin goes through the plugin's `scripts/fetch.ts`, under a lock in the clone's common git directory that every worktree shares |
| `scripts/worktrees.ts` | the one module that makes a worktree, merges a ref into it and removes it, for `worktree.ts` and the `cleanup` skill's `cleanup.ts` |
| `scripts/include.sh` | appends the answers about ignored files to `<MAIN>/.worktreeinclude` and copies the ones to copy into the worktree |
| `scripts/include.ts` | the code `include.sh` runs, and the one place that copies the ignored files `.worktreeinclude` names into a new worktree. `worktree.ts`, `flow.ts` and pj4-running's `run.ts` import it |
| `scripts/level.sh` | reads the repository's level from origin's default branch and prints the model and effort it gives the design session, the implementation session, the review seats and pj's planner, project reviewer and issue writer |
| `scripts/level.ts` | the code `level.sh` runs |
| `scripts/comments.sh` | fails on a comment outside the four kinds, or a silenced check the change adds, in the files a change touches. The implementation and review sessions run it |
| `scripts/comments.ts` | the code `comments.sh` runs. Its scanners and verdicts live in `scripts/pure/comment-check.ts` |
| `scripts/flow.sh` | makes the run's work directory and reads it back, reports a scope's round, cap, open findings and whether `approve` is allowed, runs a review seat's probe in a git worktree beside the run's, at a snapshot of the working tree, runs every probe of a round again and writes the draft of the round, removes the seats at cleanup, lints a review file, writes the pull request head and the `Level:` line into `log.md`, writes the prompt of each sub-agent call, and files the decision issues of `decisions.md` |
| `scripts/flow.ts` | the code `flow.sh` runs. The agent table of the levels lives in `scripts/pure/agent-table.ts`, which `level.ts` imports. `worktrees.ts` and pj-cleanup's `cleanup.ts` import its `closeSeats` |
| `scripts/pure/` | the logic of these scripts, with no I/O |
| `review-files.md` | the shape of the review files and the evidence files, read by the seats, the main session and the implementation session |

The design, implementation and review sessions run on agents that ship with the plugin (`../../agents/`). Design is
`annetaan:workflow-design`. Implementation is `annetaan:workflow-worker`
and review is seat `annetaan:workflow-reviewer-a`, joined at `high` by `annetaan:workflow-reviewer-b` on another model. The models and efforts are in the agent table of [the plugin README](../../README.md), and those of the design session, the implementation session and the review seats at each level of the repository in its level table.
