---
name: workflow
description: Runs one implementation as design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that merges the base in and resolves the conflicts under review when the branch conflicts with it, pushes and opens a pull request, then files each design decision in technology, infrastructure, database or delivery that review seat a finds as an issue labelled `decision`. Also resolves the conflicts of a pull request that is already open, with the same review rounds, and pushes the merge to its branch. A conflict in a project's pull request from `pj/<n>` goes to pj4-running. The standalone run works in a git worktree of its own, `.claude/worktrees/run-<stamp>`, and leaves the main working tree alone, except for adding the user's answers to its `.worktreeinclude`. The review rounds run through Markdown files in the run's work report directory. Use it only when the user names this skill or invokes /annetaan:workflow, when the user asks to resolve the conflicts of a pull request ("resolve the conflicts on #12", "コンフリクト解消して"), or when pj4-running loads it to run one sub-issue of a project or to resolve a merge of the project's source branch, because it spawns several sub-sessions, adds commits, opens a pull request and files issues without asking for approval. Do not use it for a one-off implementation request or for an ordinary code review request.
---

# workflow

One implementation, run as **design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that pushes and opens a pull request, then files each design decision in technology, infrastructure, database or delivery that review seat a finds as an issue labelled `decision`**, with each role in its own session.
The review rounds run through Markdown files under the run's work report directory, described in
`$FLOW/review-files.md`.

The design session writes a **plan** into the run's work directory: an ordered list of tasks. Implementation and review rounds run inside a task. A task the review approves becomes **one commit**. After the last task of a plan with more than one task, an **integration review** looks at the whole diff once. Then the flow finishes.

You are the main session, and you are the **orchestrator. You do not write code.** Sub-agents design, implement and review. You pass work between them and you are the only window onto the human.

**Each entry has a file of its own next to this one. Read it before anything else, follow it, and read it again after a context summary.**

| Entry | When | Read |
| --- | --- | --- |
| Standalone | the user names this skill or invokes `/annetaan:workflow` for an implementation | `$FLOW/standalone.md` |
| From a pull request | the user asks to resolve the conflicts of a pull request | `$FLOW/from-pr.md` |
| From an issue | pj4-running loads this skill for an issue | `$FLOW/from-issue.md` |
| From a sync | pj4-running loads it for a merge of `<from>` into a project's base branch that stopped on conflicts | `$FLOW/from-sync.md` |

Phases 1 and 6 belong to the standalone flow and are in `standalone.md`. Phase 5, the integration review, is in `standalone.md` too, and From an issue runs it as well. Phases 2 to 4 are below, and each entry's file says how it runs them and what comes after them. Everything it does not mention runs as written. A request to resolve a conflict is a request to do it: never answer it with a refusal or a suggestion to run something else, unless **From a pull request** in `from-pr.md` says to stop.

## Paths: `$FLOW`

**`$FLOW` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$FLOW` is not a shell variable. Write it out as the real absolute path in the commands you run. `flow.sh prompt` writes every path of a sub-agent prompt (**The prompts**), and the one prompt written by hand, phase 1 in `standalone.md`, writes `$FLOW` out too. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

Parts of this skill live in files next to this one, named by their bare name from here on: `$FLOW/merge-task.md`, `$FLOW/from-issue.md`, `$FLOW/from-sync.md`, `$FLOW/from-pr.md`, `$FLOW/worktree.md`, `$FLOW/finish.md`, `$FLOW/standalone.md`.

The standalone flow also uses the script `$FLOW/scripts/worktree.sh`, written `worktree.sh` in this skill's files. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop. The standalone flow and From a pull request call it. From an issue and From a sync never do.
**Ending with nothing changed** in `worktree.md` and the end of From a pull request remove the run's worktree with
`$FLOW/../cleanup/scripts/cleanup.sh run`, of the skill `cleanup`.
`$FLOW/scripts/include.sh`, written `include.sh`, has one subcommand, `remember`, which records the answers of **Files `.worktreeinclude` does not name** in `worktree.md` and prints one JSON object with a `status`. The standalone flow, From a pull request, pj4-running, level and pj-roadmap call it, the last two through step 3 of **The worktree** in `worktree.md`.

Every entry also uses `$FLOW/scripts/flow.sh`, written `flow.sh`, which owns the run's work directory and the
review seats, one git worktree each beside `<WT>`. `flow.sh begin` makes the work directory (phase 2 (b)), and
`flow.sh status <WT>` reads it back. With a scope, `flow.sh status <WT> <scope>` also reports where that scope's
review stands: the next round, whether the cap is reached, the last verdict, the open findings and whether `approve`
is allowed (phase 4 (b)). A seat reaches its worktree only through `flow.sh run <WT> <seat> <probe dir>`,
which runs a probe the seat wrote (see `$FLOW/review-files.md`, **A probe**), and `flow.sh close <WT>` removes the
seats at the cleanup. `flow.sh verify <WT> <scope>` runs again every command of a review round and writes the draft
of its round file (phase 4 (b)). `flow.sh lint <file>` checks one review file against `$FLOW/review-files.md`, and each
writer runs it on its own file before it reports. The finish runs `flow.sh record <WT>`, which writes the pull request
head and the `Level:` line into `log.md` (`finish.md`, **The work report**). The finish runs `flow.sh decisions <WT> <m>`, which files the issues of `<WORKDIR>/decisions.md` (`finish.md`, **The decisions**). `flow.sh prompt <WT> <kind> [<scope>] [<seat>]`
writes the prompt of one sub-agent call (**The prompts**). `<WT>` is the absolute path, and `lint` takes
the absolute path of the file. All nine print one JSON object with a `status`, as `worktree.sh` does. A non-zero exit is quoted and stops the run, the
same way, except for `decisions`: the pull request already exists then, so its exit is quoted in the ending and the run
goes on (`finish.md`, **The decisions**).

## The level

The repository's level picks the model and the effort of the design session, the implementation session and the
review seats. The script `$FLOW/scripts/level.sh` is written `level.sh` in this skill's files. It reads the level from
`.claude/annetaan-level.md` on origin's default branch, and from nowhere else.

```bash
$FLOW/scripts/level.sh show <WT> [<level>]
```

- **Standalone and From a pull request** run it right after entering `<WT>` (**The worktree** step 4 in
  `worktree.md`). `<level>` comes from `level=<level>` in the args, and is left out when the args carry none. The token sets
  the level of this run only, and it is not part of the request.
- **From an issue and From a sync** do not run it. They take the JSON pj4-running settled.
- **Every entry** hands `level` and `source` of that JSON to `flow.sh begin` (phase 2 (b)), which writes them to the
  run's `run.json`. `show` stays the one read of the level in a run.

It prints `status: ok` with `level`, `source` (`file`, `override` or `default`), `ref`, `evaluated`, `reviewBy`,
`warning`, `agents` and `seats`. `agents.<name>` holds the `model` and the `effort` of `workflow-design`,
`workflow-worker`, `workflow-reviewer-a`, `workflow-reviewer-b`, `pj-planner`, `pj-reviewer` and `pj-issue-writer`,
for each of them the level runs. `seats` lists the review seats this level runs, `a` alone at `standard` and `a` and
`b` at `high`, and `agents` names a `workflow-reviewer-<seat>` for exactly those. Keep the JSON. Print `level <level> (<source>)`
once, and `warning` on a line of its own when it is set. A warning never stops the run. The finish's `flow.sh record`
writes the `level` and `source` that `begin` stored into `log.md` (`finish.md`, **The work report**), and
`/annetaan:level` reads them back from the merged pull requests.

After a context summary, run `$FLOW/scripts/flow.sh status <WT>`, then `$FLOW/scripts/level.sh show <WT> <level>`
with the `level` `status` printed, and read only its `seats`, and `agents.workflow-design` while phase 1 is still
ahead. Every other call takes its model and effort from `flow.sh prompt` (**The prompts**). The run's `level` and
`source` stay the ones `status` printed.

Phase 2 (b) has not run yet when `status` stops with `no-run`, and also, in From an issue, when the `issue` it prints
is not this run's `n`, and, in From a sync, when `issue` is not null. pj4-running reuses one `<WT>` for every issue,
and the work directories of its earlier runs stay under `<WT>/work-reports/` until pj-cleanup, so before this run's
`begin`, `status` answers `ok` with an earlier run. Then its `start` and `workdir` are not taken, phase 2 (b) is still
ahead, and the level comes as at the start: standalone and From a pull request run `show` as the bullets above say,
and From an issue and From a sync take the JSON pj4-running settled, which pj4-running brings back from its last
`level` line, as between entries.

A non-zero exit is a usage error, such as `level=<level>` other than `standard` or `high`, or an unexpected failure: quote its message and
stop, as for `worktree.sh`.

## Before you start

This skill spawns sub-sessions and adds commits. **Start it only when the user names it or invokes
`/annetaan:workflow`, asks to resolve the conflicts of a pull request, or pj4-running loads it for an issue or a
sync.** `level=<level>` in the args, `standard` or `high`, sets the repository's level for this run (see **The level**).

## Agents

**The implementation session and the review seats start fresh for every task.**

**A task boundary throws away almost nothing.** The code is in git, the design, the plan and each task's detail are files
of the run in `<WORKDIR>` (**The run's files**), and every finding is resolved because the task was approved. What is left is how this repository wants to be
worked in, and that travels as the handover notes (phase 4 (d)).

**Every task, and the integration review when the plan has more than one task, run on the same agents**:
`annetaan:workflow-worker` for implementation, and one `annetaan:workflow-reviewer-<seat>` for each seat of `seats`,
the review panel. There is no per-task choice to make. Seat a runs once more at the finish, to judge the decisions
(`finish.md`, **The decisions**).
They ship with this plugin. The design session runs on `annetaan:workflow-design`, which ships with this plugin too.
**Every `Agent` call passes the `model` and `effort` that `flow.sh prompt` prints for it** (**The prompts**), the
pair of its agent at the `level` of `run.json`. The one call whose prompt is written by hand, phase 1 in
`standalone.md`, takes them from `agents.workflow-design` of the level JSON (**The level**).

**Seat `b` that cannot start**, at the level that runs it (a weekly limit, a rate limit, the model is unavailable), is
spawned again as `annetaan:workflow-reviewer-b` with the same prompt file, `model: "opus"` and the same `effort`. **A seat that returns no
report is a dropout**: the round goes on with the seats that reported, and the `Seats:` line of the round file says so.
When no seat reported, phase 4 (b) step 1 starts them again.

## The prompts

**You write no prompt of phases 3 to 6, of the merge task or of the detail pass from an issue.** One command writes
each one, and the call that sends it is one line naming that file.

```bash
$FLOW/scripts/flow.sh prompt <WT> <kind> [<scope>] [<seat>]
```

It fills the template `$FLOW/prompts/<kind>.md` with the run's paths, the start point, the branch, the progress
(`git log --oneline <START>..HEAD`, or `none`), the scope's round from `flow.sh status`, the issue lines of a run from
an issue, and the worktree line last, which keeps every session in `<WT>` and away from `<MAIN>`. It writes the result
to `<WORKDIR>/prompts/<kind>[-<scope>][-<seat>].md`, overwriting an earlier one, and prints
`{"status": "ok", "path": ..., "agent": ..., "model": ..., "effort": ...}`. `agent`, `model` and `effort` are null
where the table says so.

| Kind | Scope | Agent | Sent by |
| --- | --- | --- | --- |
| `work` | any | `workflow-worker` | `Agent` |
| `seat` | any, with seat `a` or `b` | `workflow-reviewer-<seat>` | `Agent` |
| `again` | any | null | `SendMessage` |
| `respond` | any | null | `SendMessage` |
| `commit` | any | null | `SendMessage` |
| `detail` | `task-<k>`, `k` of 2 or more | null | `SendMessage` |
| `report` | none | `workflow-worker` | `SendMessage`, or `Agent` when no session is left |
| `design` | none | `workflow-design` | `Agent` |
| `decisions` | none | `workflow-reviewer-a` | `Agent` |

The scope is `task-<k>`, `integration` or `merge`. Send each file with one line:

```
Agent(subagent_type: "annetaan:<agent>", description: "...", model: "<model>", effort: "<effort>",
      prompt: "Read <path> first and follow it.")
```

and `SendMessage` with the same `Read <path> first and follow it.` to the session that is alive.

- Run `flow.sh prompt` once per call, one Bash call each, right before the call, because it reads the round and the
  progress as they stand then.
- The seats of one round each get a `seat` prompt, and their calls go in one message. `again` is one file, sent to
  every seat.
- The `fable` fallbacks, of the design session and of seat `b`, start the same file again with `model: "opus"` and
  the same `effort`.
- A non-zero exit names a call the procedure never makes, such as `again` before round 1 or seat `b` at `standard`:
  quote it and stop, as for any `flow.sh` exit. A `stop` with `no-run` is read as **The level** says.

**The messages that stay.** A short follow-up that asks a live session for one thing and carries none of the run's
inputs is no kind. You write it as one line naming the file it asks about: the evidence file the `work` prompt named,
when it is missing (phase 4 (a), and `approve-no-evidence` in (b) step 4); `<WORKDIR>/detail/task-<k>.md`, when it is
missing (phase 4 (a)); the reply of the last round, when it is not in after a context summary (phase 4 (b)); the redraw
of `<WORKDIR>/plan.md` (**When the plan breaks**); the `Diverged:` forward and the wait (`from-issue.md`); the
screenshots, when they are missing, and the `malformed` forward of `flow.sh decisions` to seat a, naming
`<WORKDIR>/decisions.md` (`finish.md`).

## Phase 2: branch and work directory

Run the steps of this phase that the entry's file names. Each entry's file names when (a) and (b) run, both before the implementation session wakes.

### (a) Create the branch

```bash
git -C <WT> checkout -b <branch name>
```

The name is the one you put in the start message. When git refuses because the name exists, pick another and say so in one line.

### (b) Begin the run

Screenshots, the review files and the work report go to the run's work directory under **`work-reports/` inside the
worktree**. `begin` checks that git ignores `work-reports/` in `<WT>`, takes `HEAD` of `<WT>` as the start point,
makes the work directory with `review/` and `seats/` in it, and writes the start point and the level to `run.json`
there.

```bash
$FLOW/scripts/flow.sh begin <WT> --level <level> --source <source> [--issue <n> --parent <P>]
```

- `<level>` and `<source>` are `level` and `source` of the `level.sh show` JSON the entry holds (**The level**), so
  `run.json` and the agents' model and effort come from one read. Only From an issue passes `--issue` and `--parent`.
- **`ok`**: keep `start` as `<START>` and `workdir` as `<WORKDIR>`, written out in full in every command, the way
  `$FLOW` is. **`<START>` runs through the whole flow.** The integration review when the plan has more than one task,
  the report and the final message all start from `<START>`.
- **`stop`** with `not-ignored`: nothing was written under `work-reports/`. Stop as the entry's file says. Never add
  the path to `.gitignore`.
- Any other **`stop`**, or a non-zero exit: quote it and stop.
- **After a context summary**, `$FLOW/scripts/flow.sh status <WT>` prints `start`, `workdir`, `level`, `source`,
  `issue` and `parent` again. **The level** says how the agents come back, and when the run `status` names is an
  earlier one, so that phase 2 (b) is still ahead.

### The run's files

The design, the plan, the detail of each task, the handover notes, the adaptations, the `check wanted:` lines and the
merge's design are files of `<WORKDIR>`, each with one writer.

| File | Writer | Written |
| --- | --- | --- |
| `<WORKDIR>/design.md` | standalone: the design session; from an issue: the main session | standalone: phase 1, and again when the answers come back; from an issue: right after `begin`, with `project.sh --design`, and after each redraw that goes on |
| `<WORKDIR>/plan.md` | the design session | with the plan, and again on every redraw of it |
| `<WORKDIR>/detail/task-<k>.md` | the design session | task 1 with the plan, task k of 2 or more when phase 4 (d) asks |
| `<WORKDIR>/notes.md` | the main session | from an issue and a sync right after `begin`; folded after each commit |
| `<WORKDIR>/adaptations.md` | the main session, from an issue | on each adaptation the implementation session reports |
| `<WORKDIR>/checks.md` | the main session | on each `check wanted:` line of a commit report |
| `<WORKDIR>/merge.md` | the main session | when **The merge task** starts |

**A prompt names a file and never carries its content**, with `<WORKDIR>` written out as an absolute path. A file that
does not exist means none: no notes yet, no adaptation, no `check wanted:` line. A file the main session adds to is
read with Read first and written whole with Write, the earlier lines kept, because Write overwrites.

## Phase 3: the implementation prompt

**Every task starts a new implementation session, task 1 included.** Phase 4 (a) is where you start it, after the
commit of the task before is checked, so that the progress holds that commit:

```bash
$FLOW/scripts/flow.sh prompt <WT> work task-<k>
```

Then make the `Agent` call with its line (**The prompts**). The prompt names the run's files, the start point, the
branch, the progress, the review files and a `Scratch:` directory, asks for `task-<k>-evidence.md`, and asks for
screenshots when the change shows on screen, the before shot first, saved in `<WORKDIR>` for **The work report** in
`finish.md`.

### How long the session lives

**One implementation session covers one task.** Every review round for that task continues through `SendMessage` to
the same agent, because answering a finding on your own code needs the context that wrote it. The commit in phase 4
(d) ends it. You never message it again, unless the entry's file keeps the last task's session alive, and the next task starts a new one.

## Phase 4: the task loop

Work the plan one task at a time. Nothing runs in parallel, because there is one working tree.
A task is **(a) detail it and implement, (b) review, (c) respond, back to (b), then (d) commit on approve**.

**(a) Detail the task, then implement**

**Task 1 needs no detailing.** The design session read the repository in the state task 1 starts from, so the detail
it wrote for task 1 cannot have gone stale.

**From task 2 onward, the design session details the task first.** You asked for that detail in (d) of task k-1, in
the same message as the commit, so it runs while the commit does. Wait until both have reported.

**This is where a broken plan gets caught before anyone writes code against it.** An answer that says the boundary no
longer holds goes to **When the plan breaks**.

Before the implementation session starts, check that `<WORKDIR>/detail/task-<k>.md` exists, with one command:

```bash
ls <WORKDIR>/detail
```

When it is missing, ask the design session for it in one line by `SendMessage`, and wait for its report. A merge has no
detail file: `<WORKDIR>/merge.md` takes the place of all three (`merge-task.md`).

Then write the `work` prompt and start a new implementation session with it, as phase 3 says.

Check that the tests pass before you send anything to review, and that the evidence file the `work` prompt named exists under `<WORKDIR>/review/` (`task-<k>-evidence.md`, or `merge-evidence.md` in a merge). When it is missing, `SendMessage` the implementation session for it. `git status --porcelain` shows the change sitting in the working tree, and `git log -1` shows HEAD has not moved.

**(b) Review**

The same steps run for a task, for the integration review and for the merge task. `<scope>` is `task-<k>`, `integration` or `merge`. Every session, yours and the seats', stays in `<WT>`. Only `flow.sh` enters a seat's worktree.

The scope's values come from the script, not from counting files:

```bash
$FLOW/scripts/flow.sh status <WT> <scope>
```

It prints what `status <WT>` prints, with `scope`, `round`, `cap`, `verdict`, `open` and `approve` added. `round` is the next round, and it is the `<r>` of every file name in (b). `flow.sh prompt` reads it the same way for the prompts of (b) and (c). `verdict` is the verdict of the last round file, null before round 1. `open` lists the findings the last round left open, each with its `id`, `stood` (how many round files marked it `stands` or `stands again`) and `reply` (`fixed` or `disagree` from the last round's reply, null when that reply or its line is missing). `approve` holds `allowed` and `why`, the reasons `approve-open` and `approve-no-evidence` of the lint (see `$FLOW/review-files.md`, **The lint**). `cap` is read after step 4.

1. **Start every seat of `seats` in one message.** Each seat writes `<scope>-round-<r>-<seat>.md`, the seat file of round `round`. In round 1, run for each seat

   ```bash
   $FLOW/scripts/flow.sh prompt <WT> seat <scope> <seat>
   ```

   and send every seat's `Agent` call in one message (**The prompts**), so the seats run in parallel. The prompt says what the review reads: a task `git diff HEAD` plus the untracked files, the integration review `git diff <START>` plus the untracked files, and a merge each conflicted file against both sides.

**Every round after that goes to each seat with `SendMessage`**, all in one message: run `$FLOW/scripts/flow.sh prompt <WT> again <scope>` once and send its line to every seat. It names the reply, the evidence and the round file of the last round, and each seat's file of round `round`. The seats live for one task, so each remembers what it tried, its probes are still there, and it diffs the tree it reviewed last against the tree now.

**When no seat reports**, in round `<r>`, start the seats of round `round` again, once, each with a new `seat` prompt and its `Agent` call, as in round 1: the seat writes `<scope>-round-<r>-<seat>.md`. A seat whose seat file of round `<r>` is already under `<WORKDIR>/review/` is not started again. From round 2 on, the prompt `flow.sh prompt` writes is a restart's: it names the reply and the round file of the last round, names the evidence as **The lint** in `review-files.md` defines it, and asks for the whole change, since the seat has no earlier snapshot. The seats started again remember only from round `<r>` on, and every later round goes to them by `SendMessage`. When none reports again, stop as the entry's file says for the round cap.

2. **When every seat has reported**, run `$FLOW/scripts/flow.sh verify <WT> <scope>` with the Bash tool's `timeout` set to 600000, because it runs every probe in turn. It runs again the command of each finding in `open` and of each finding in the seat files of round `round`, sorts them by the probe's exit, and writes the draft `<WORKDIR>/drafts/<scope>-round-<r>.md` (see `$FLOW/review-files.md`, **A draft**). Its JSON carries the last 40 lines of each run as `output`, and `dropouts` the seats of the run with no seat file. A call the timeout cut off is run again with `run_in_background`, and you wait for its exit.
3. **Keep, drop, merge, from the draft.** The draft already sorts by the exit: an earlier finding is `resolved`, `stands` or `stands again`, a new finding that exited non-zero is under `## New findings`, and the rest is under `## Dropped`. What is left is judgement. Keep a new finding when its `output` shows a failure that breaks the intent: the design, its criteria, the plan and the task detail, read from `<WORKDIR>/design.md`, `<WORKDIR>/plan.md` and `<WORKDIR>/detail/task-<k>.md`, or from `<WORKDIR>/merge.md` in a merge. **Drop the rest with the reason.** Findings with one root cause become one entry that names every seat. Write `Breaks:` for each finding kept, and the `Seats:` line, a dropout said there. An earlier finding marked `reply: disagree` is judged against the intent: a `disagree` whose reason shows the failure does not break the intent is `resolved`, with the reason quoted. **There is no judge.** The round file holds every finding of every seat that you kept. Anything under `## Not run` that no seat could run goes to the round file's `## Not run`.
4. **Write the round file** `<scope>-round-<r>.md` from the draft with Write, in the shape `$FLOW/review-files.md` gives: `Seats:` (the model each seat ran on, a fallback and a dropout said here), `## Earlier findings`, `## New findings`, `## Dropped`, `## Not run` and `## Verdict`. The verdict is yours, and when `approve` is allowed is in `$FLOW/review-files.md`, **A review round**. Before the Write, run `$FLOW/scripts/flow.sh status <WT> <scope>` and read `approve`. `approve-no-evidence` in `why` rules `approve` out until the implementation session writes the evidence file the rule names: `SendMessage` it for that file, as (a) does for a missing evidence file, and run status again once it is there. `approve-open` in `why` means `approve` needs every finding in `open` marked `resolved` in this round's `## Earlier findings`, and `## New findings` reading `None.`. Otherwise the verdict is `changes-requested`. After the Write, run `$FLOW/scripts/flow.sh lint <absolute path of the round file>` and rewrite the round file until `ok` is true, before the verdict goes to (c) or (d). An `approve` over a finding the file itself leaves open shows there as `approve-open`, and the verdict is then `changes-requested`. `draft` means a line was not copied as the draft holds it: copy it again from the draft, and never edit the draft.

`approve` goes to (d). After a round file that is not `approve`, run `$FLOW/scripts/flow.sh status <WT> <scope>` again and read `cap`: true stops as **The round cap** says, false goes to (c).

**After a context summary in the middle of (b)**, `$FLOW/scripts/flow.sh status <WT> <scope>` gives the scope's state back. Seat files of round `round` already under `<WORKDIR>/review/` mean the seats have reported, so (b) goes on at step 2: run `flow.sh verify` again, which overwrites the draft, and go on from the draft. A `verdict` of `approve` means (d). `changes-requested` is read by `cap` as after step 4, and with `cap` false, a finding in `open` whose `reply` is null means the reply of the last round is not in yet, so ask the implementation session for it. `stop` with `no-run` is read as **The level** says.

**(c) Respond**

Run `$FLOW/scripts/flow.sh prompt <WT> respond <scope>` and `SendMessage` its line to the implementation session. It
names the round file just written, the reply and the evidence that go next to it, and **After two failed fixes** in
`judgement.md` for a finding marked `stands again`.

Go back to (b).

**(d) Commit on approve**

Run `$FLOW/scripts/flow.sh prompt <WT> commit task-<k>`. Its line goes to the implementation session by
`SendMessage`: one commit, the empty `git status --porcelain` checked, and the notes for the next session.

**When tasks are left, ask the design session for the next detail in the same message**: run
`$FLOW/scripts/flow.sh prompt <WT> detail task-<k+1>` as well, and send its line to the design session by a second
`SendMessage` beside the first, so the detail runs while the commit does. The approved change is what the commit
takes, so the working tree already holds the code task k+1 starts from.

Check it yourself with `git log -1 --oneline`, `git status --porcelain`, and `git branch --show-current` to confirm the branch has not moved. Anything left in the working tree needs an explanation from the implementation session. Screenshots inside `<WORKDIR>` are ignored by git and can stay.

**Fold the commit report's notes into `<WORKDIR>/notes.md` with Write**, after a Read of it when it exists. Fold
the duplicates together. Once the whole thing runs past fifteen lines, drop the oldest. The next task's implementation
prompt names this file, and it is the only thing that outlives a session.

**When the commit report has a `check wanted:` line** (a task's, or the fix commit of the integration review in `standalone.md`), keep it out of the handover notes. Append each one word for word to `<WORKDIR>/checks.md`: Read it when it exists, then Write it with the earlier lines kept. The work report gathers them from there (`finish.md`).

**Give the user a one-line progress report**: `task k/N done: <short SHA> <commit subject> (commit k since START <short SHA>)`. A long context can be summarised away. After a context summary, the plan comes back from `<WORKDIR>/plan.md`, only the progress from the progress lines, and `START` and `WORKDIR` from `flow.sh status <WT>`.

**This task's implementation session and the seat sessions are finished here.** Do not send them anything after this. The next
task starts new ones, and the seats' worktrees stay beside `<WT>`, re-pointed by the next `flow.sh run`. After the last task's commit, the entry's file says what comes next, and whether that task's implementation session stays alive. The seat sessions end here either way.

### When the plan breaks

When the detail pass in (a) says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan**: a one-line `SendMessage` that names `<WORKDIR>/plan.md` and what broke. The design session rewrites that file and reports the new task names. Tell the user what the new plan is in one message and go on without waiting. A redraw changes the task count that phase 5 goes by. A change to the design itself goes back to the user the same way a "no" or "conditional" in phase 1 does, and in From an issue it ends the run as `from-issue.md` says (the stop `decision`).

### The round cap

**Five round files of one scope without `approve`, counted by `cap`, for every scope**: `task-<k>`, `integration`
and `merge`. **Fixed.** Nobody negotiates it.

When `cap` of `$FLOW/scripts/flow.sh status <WT> <scope>` is true after a round file that is not `approve`, stop as the entry's file says. Do not keep the rounds going forever.

**If the user says stop at any point, stop** as the entry's file says. The cap is a brake, and it is not a promise.

## Rules for the whole flow

- **You do not write code.** The implementation session implements and the seats review. Code you write yourself never passes through a review.
- **A seat never changes the tree of `<WT>`.** It writes only its probes under `<WORKDIR>/seats/<seat>/` and its seat file, and executes only through `flow.sh run`. You write the round file and no other file of the review, and the implementation session fixes what is found. The seats' worktrees stay beside `<WT>` until the cleanup removes them.
- **A review file is final once its writer has linted it and reported.** Each round and each reply is a new file under `<WORKDIR>/review/`, in the shape `$FLOW/review-files.md` gives, and so is each evidence file. Its writer fixes it until `flow.sh lint` passes, and nobody edits it after the report.
- **The design session lives for the whole flow, in the standalone flow and in From an issue. An implementation session and the seat sessions live for one task.** Inside a task they continue through `SendMessage`, because throwing the context away between rounds repeats arguments that were already settled. At the commit they are finished, and the next task starts new ones. The implementation session of a one-task plan also writes the work report.
- **Keep the reports from the sub-agents short.** The role instructions cap them. A report that pastes a diff or a log fills the one context that runs the whole flow, which is yours. When a long one arrives, say so, and ask for the gist next time.
- **One task is one commit, and a commit happens only after the review approves.** A commit mid-round drops the diff out of the working-tree view the review reads.
- **No branches, no history rewriting from the sub-sessions.** The main session owns `git checkout -b`, run in `<WT>`. `git rebase`, `git reset --hard` and `--amend` break the `START` comparison. The role instructions say the same.
- **Each Bash call runs one command with its values written out.** No shell variables, no `$(...)`, no chaining. A command's own redirect into a file, `> <path>`, is part of that one command, as **Commands** in `pj1-plan/between-skills.md` allows. Read the output whole. pj4-running drives this flow in runs that cannot answer a permission question, and auto mode's classifier may refuse a command no rule matches.
- **A URL in a message to the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything touching the URL becomes part of the link and opens the wrong page (`$FLOW/../pj1-plan/between-skills.md`, **Issues in a report**).
- **Never write into `work-reports/` without checking it is ignored.** Unchecked, the report and the screenshots ride into the next commit. `worktree.sh create` (standalone, From a pull request) and `run.sh start` of pj4-running (From an issue, From a sync) add it to `.git/info/exclude` before anything is written there, and `flow.sh begin` checks it again. Never edit `.gitignore`.
- **The standalone flow never touches `<MAIN>`, except for the lines `include.sh` adds to `<MAIN>/.worktreeinclude`.** Never switch, stash, commit or clean there. Everything runs in `<WT>`.
- **`worktree.sh` is for the standalone flow and From a pull request.** From an issue and From a sync never call it. **`flow.sh` is called by every entry**, with the absolute `<WT>`, and `lint` with the absolute path of a review file.
- **Do not move anything under `<WORKDIR>` into version control.** The report, the screenshots and the diff are worth more untracked. Move them only when the user asks.
- Report a failure when it happens: a failing test, a design that falls apart. **Approved commits are already on the branch and the task in flight is uncommitted in the working tree.** Say both.
- Standalone, the main session pushes and opens the pull request. From an issue, the main session also pushes and opens the draft pull request. Nothing is merged here. pj4-running
  merges. From a pull request, the main session pushes the merge commit to the pull request's branch, as a
  fast-forward. From a sync, nothing is pushed. pj4-running pushes the merge commit.
- **A merge of another branch into the run's branch happens only in The merge task**, and only after `worktree.sh
  sync` or pj4-running's `run.sh sync` found a conflict. A clean merge is left to GitHub.
