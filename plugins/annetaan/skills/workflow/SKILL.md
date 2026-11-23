---
name: workflow
description: Runs one implementation as design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that merges the base in and resolves the conflicts under review when the branch conflicts with it, pushes and opens a pull request. Also resolves the conflicts of a pull request that is already open, with the same review rounds, and pushes the merge to its branch. A conflict in a project's pull request from `pj/<n>` goes to pj4-running. The standalone run works in a git worktree of its own, `.claude/worktrees/wf-<stamp>`, and leaves the main working tree alone. The review rounds run through Markdown files in the run's work report directory. Use it only when the user names this skill or invokes /annetaan:workflow, when the user asks to resolve the conflicts of a pull request ("resolve the conflicts on #12", "コンフリクト解消して"), or when pj4-running loads it to run one sub-issue of a project or to resolve a merge of the project's source branch, because it spawns several sub-sessions, adds commits and opens a pull request without asking for approval. Do not use it for a one-off implementation request or for an ordinary code review request.
---

# workflow

One implementation, run as **design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that pushes and opens a pull request**, with each role in its own session.
The review rounds run through Markdown files under the run's work report directory, described in
`$FLOW/review-files.md`.

The design session returns a **plan**: an ordered list of tasks. Implementation and review rounds run inside a task. A task the review approves becomes **one commit**. After the last task of a plan with more than one task, an **integration review** looks at the whole diff once. Then the flow finishes.

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

`$FLOW` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

Parts of this skill live in files next to this one, named by their bare name from here on: `$FLOW/merge-task.md`, `$FLOW/from-issue.md`, `$FLOW/from-sync.md`, `$FLOW/from-pr.md`, `$FLOW/worktree.md`, `$FLOW/finish.md`, `$FLOW/standalone.md`.

The standalone flow also uses the script `$FLOW/scripts/worktree.sh`, written `worktree.sh` in this skill's files. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop. The standalone flow and From a pull request call it. From an issue and From a sync never do.

Every entry also uses `$FLOW/scripts/panel.sh`, written `panel.sh`, which owns the run's work directory and the
review seats, one git worktree each beside `<WT>`. `panel.sh begin` makes the work directory (phase 2 (b)), and
`panel.sh status <WT>` reads it back. With a scope, `panel.sh status <WT> <scope>` also reports where that scope's
review stands: the next round, whether the cap is reached, the last verdict, the open findings and whether `approve`
is allowed (phase 4 (b)). A seat reaches its worktree only through `panel.sh run <WT> <seat> <probe dir>`,
which runs a probe the seat wrote (see `$FLOW/review-files.md`, **A probe**), and `panel.sh close <WT>` removes the
seats at the cleanup. `panel.sh verify <WT> <scope>` runs again every command of a review round and writes the draft
of its round file (phase 4 (b)). `panel.sh lint <file>` checks one review file against `$FLOW/review-files.md`, and each
writer runs it on its own file before it reports. The finish runs `panel.sh record <WT>`, which writes the pull request
head and the `Level:` line into `log.md` (`finish.md`, **The work report**). `<WT>` is the absolute path, and `lint` takes
the absolute path of the file. All seven print one JSON object with a `status`, as `worktree.sh` does. A non-zero exit is quoted and stops the run, the
same way.

## The level

The repository's level picks the model and the effort of the design session, the implementation session and the
review seats. The script `$FLOW/scripts/level.sh` is written `level.sh` in this skill's files. It reads the level from
`.claude/annetaan-level.md` on origin's default branch, and from nowhere else.

```bash
$FLOW/scripts/level.sh show <WT> [<level>]
```

- **Standalone and From a pull request** run it right after entering `<WT>` (**The worktree** step 5 in
  `worktree.md`). `<level>` comes from `level=<level>` in the args, and is left out when the args carry none. The token sets
  the level of this run only, and it is not part of the request.
- **From an issue and From a sync** do not run it. They take the JSON pj4-running settled.
- **Every entry** hands `level` and `source` of that JSON to `panel.sh begin` (phase 2 (b)), which writes them to the
  run's `run.json`. `show` stays the one read of the level in a run.

It prints `status: ok` with `level`, `source` (`file`, `override` or `default`), `ref`, `evaluated`, `reviewBy`,
`warning`, `agents` and `seats`. `agents.<name>` holds the `model` and the `effort` of `workflow-design`,
`workflow-worker`, `workflow-reviewer-a`, `workflow-reviewer-b`, `pj-planner`, `pj-reviewer` and `pj-issue-writer`,
for each of them the level runs. `seats` lists the review seats this level runs, `a` alone at `standard` and `a` and
`b` at `high`, and `agents` names a `workflow-reviewer-<seat>` for exactly those. Keep the JSON. Print `level <level> (<source>)`
once, and `warning` on a line of its own when it is set. A warning never stops the run. The finish's `panel.sh record`
writes the `level` and `source` that `begin` stored into `log.md` (`finish.md`, **The work report**), and
`/annetaan:level` reads them back from the merged pull requests.

After a context summary, run `$FLOW/scripts/panel.sh status <WT>`, then `$FLOW/scripts/level.sh show <WT> <level>`
with the `level` `status` printed, and read only its `agents`. The run's `level` and `source` stay the ones `status`
printed.

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

## The worktree line

A sub-session does not start in `<WT>` by itself. **Every sub-agent prompt, once `<WT>` is entered, ends with this line**: the design, the implementation, the review seats of every review, the integration review included, and the report session.

> Your working directory must be the worktree `<WT>`. Run `git rev-parse --show-toplevel` first. When it prints anything else, call `EnterWorktree(path: "<WT>")` before anything else, or, when that tool is not available, start every command with `cd <WT>` and keep Edit and Write paths under `<WT>`. Never touch `<MAIN>`.

Write the real path for `<WT>` and `<MAIN>` when you send it.

## Agents

**The implementation session and the review seats start fresh for every task.**

**A task boundary throws away almost nothing.** The code is in git, the design and the plan are in your hands, and
every finding is resolved because the task was approved. What is left is how this repository wants to be
worked in, and that travels as the handover notes (phase 4 (d)).

**Every task, and the integration review when the plan has more than one task, run on the same agents**:
`annetaan:workflow-worker` for implementation, and one `annetaan:workflow-reviewer-<seat>` for each seat of `seats`,
the review panel. There is no per-task choice to make.
They ship with this plugin. **Every `Agent` call for `annetaan:workflow-worker` and for an
`annetaan:workflow-reviewer-<seat>` passes `model` and `effort` from `agents.<name>` of the level JSON** (see **The
level**), so the calls below carry them. The design session runs on `annetaan:workflow-design`, which ships with
this plugin too, and its call passes `model` and `effort` from `agents.workflow-design` the same way.

**Seat `b` that cannot start**, at the level that runs it (a weekly limit, a rate limit, the model is unavailable), is
spawned again as `annetaan:workflow-reviewer-b` with `model: "opus"` and the same `effort`. **A seat that returns no
report is a dropout**: the round goes on with the seats that reported, and the `Seats:` line of the round file says so.
When no seat reported, phase 4 (b) step 1 starts them again.

## Phase 2: branch and work directory

Run the steps of this phase that the entry's file names, **in this order, before you wake the implementation session**. The order matters.

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
$FLOW/scripts/panel.sh begin <WT> --level <level> --source <source> [--issue <n> --parent <P>]
```

- `<level>` and `<source>` are `level` and `source` of the `level.sh show` JSON the entry holds (**The level**), so
  `run.json` and the agents' model and effort come from one read. Only From an issue passes `--issue` and `--parent`.
- **`ok`**: keep `start` as `<START>` and `workdir` as `<WORKDIR>`, written out in full in every command, the way
  `$FLOW` is. **`<START>` runs through the whole flow.** The integration review when the plan has more than one task,
  the report and the final message all start from `<START>`.
- **`stop`** with `not-ignored`: nothing was written under `work-reports/`. Stop as the entry's file says. Never add
  the path to `.gitignore`.
- Any other **`stop`**, or a non-zero exit: quote it and stop.
- **After a context summary**, `$FLOW/scripts/panel.sh status <WT>` prints `start`, `workdir`, `level`, `source`,
  `issue` and `parent` again. **The level** says how the agents come back, and when the run `status` names is an
  earlier one, so that phase 2 (b) is still ahead.

## Phase 3: the implementation prompt

**Every task starts a new implementation session, task 1 included.** This is the shape of the call. Phase 4 (a) is
where you make it.

```
Agent(subagent_type: "annetaan:workflow-worker", description: "implementation, task k",
      model: "<agents.workflow-worker.model>", effort: "<agents.workflow-worker.effort>",
      prompt: "Read $FLOW/roles/work.md first and follow the role it describes.\n\nDesign:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<what the design session returned for task k. For task 1, the part of the design that covers it>\n\nStart point START: <the SHA>\nBranch: <branch name>\nReview files: <absolute path of WORKDIR>/review\nScratch: <absolute path of WORKDIR>/scratch/work\n\nProgress:\n<the tasks already done and the commit that closed each, as the matching `git log --oneline` lines. \"none\" for task 1>\n\nHandover notes from the earlier sessions:\n<the notes you have been accumulating. \"none\" for task 1>\n\nImplement task k, \"<task name>\", of the plan. **Do not commit yet.** Write `task-<k>-evidence.md` under the review files. Report back once the tests pass.\n\n<the worktree line>")
```

### Screenshots

**When the change shows on screen, add this paragraph to the implementation prompt.** **The work report** in `finish.md` uses the files. They go into the `<WORKDIR>` you made in phase 2.

> If this change shows on screen, take screenshots. When an existing screen changes how it looks or behaves, **take the current state (before) first, before you touch anything**, then implement, then take the after shot. When you only add a new screen or component, the after shot alone is enough. Save them in `<absolute path of WORKDIR>`. **Do not create files anywhere else** (`work-reports/` is ignored, and anything outside it ends up in a commit). Report the path of each file and what it shows.

**The before shot cannot be taken afterwards.** Saying it once implementation has started is too late, so it goes in the prompt that opens the task. Leave it out for a change that never reaches a screen (internals, CI, documentation).

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

Then start a new implementation session with the phase 3 prompt.

Check that the tests pass before you send anything to review, and that the evidence file the phase 3 prompt named exists under `<WORKDIR>/review/` (`task-<k>-evidence.md`, or `merge-evidence.md` in a merge). When it is missing, `SendMessage` the implementation session for it. `git status --porcelain` shows the change sitting in the working tree, and `git log -1` shows HEAD has not moved.

**(b) Review**

The same steps run for a task, for the integration review and for the merge task. `<scope>` is `task-<k>`, `integration` or `merge`. Every session, yours and the seats', stays in `<WT>`. Only `panel.sh` enters a seat's worktree.

The scope's values come from the script, not from counting files:

```bash
$FLOW/scripts/panel.sh status <WT> <scope>
```

It prints what `status <WT>` prints, with `scope`, `round`, `cap`, `verdict`, `open` and `approve` added. `round` is the next round, and it is the `<r>` of every file name in (b) and in the `SendMessage` of later rounds. `verdict` is the verdict of the last round file, null before round 1. `open` lists the findings the last round left open, each with its `id`, `stood` (how many round files marked it `stands` or `stands again`) and `reply` (`fixed` or `disagree` from the last round's reply, null when that reply or its line is missing). `approve` holds `allowed` and `why`, the reasons `approve-open` and `approve-no-evidence` of the lint (see `$FLOW/review-files.md`, **The lint**). `cap` is read after step 4.

1. **Start every seat of `seats` in one message.** Each seat writes `<scope>-round-<r>-<seat>.md`, the seat file of round `round`. Round 1 is `Agent`, with the diff to read depending on the review: a task reads `git diff HEAD` plus the untracked files, the integration review `git diff <START>` plus the untracked files, and a merge the files named by `merge-task.md`.

```
Agent(subagent_type: "annetaan:workflow-reviewer-a", description: "review, task k, seat a",
      model: "<agents.workflow-reviewer-a.model>", effort: "<agents.workflow-reviewer-a.effort>",
      prompt: "Read $FLOW/roles/review.md first and follow the role it describes.\n\nYou are seat a.\n\nDesign and acceptance criteria:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<the same one the implementation session got>\n\nProgress:\n<the tasks already done and the commit that closed each. \"none\" for task 1>\n\nHandover notes from the earlier sessions:\n<the notes, or none>\n\nReview files: <absolute path of WORKDIR>/review\nProbes: <absolute path of WORKDIR>/seats/a\nRun a probe with: $FLOW/scripts/panel.sh run <WT> a <probe dir>\n\nUnder review: task k, \"<task name>\". The diff sits between the working tree and HEAD (`git diff HEAD` plus untracked files). The evidence is `task-<k>-evidence.md`. Write your seat file as `<scope>-round-1-a.md` under the review files.\n\n<the worktree line>")
```

The call for another seat is the same with its agent `annetaan:workflow-reviewer-<seat>`, its `model` and `effort` from `agents.workflow-reviewer-<seat>`, its letter in `You are seat <seat>`, `Probes:` under `seats/<seat>`, `panel.sh run <WT> <seat> <probe dir>` and `<scope>-round-1-<seat>.md`. Write `$FLOW` and `<WT>` out as absolute paths. All calls go in one message, so the seats run in parallel. In a run from an issue each prompt also carries the lines `from-issue.md` adds, and in a merge the lines `merge-task.md` gives.

**Every round after that goes to each seat with `SendMessage`**, all in one message, `<r>` being `round`: "the tree has been updated, and the reply is `<scope>-round-<r-1>-reply.md`, with the evidence in `<scope>-round-<r-1>-evidence.md` when the reply changed code, and the round file of the last round is `<scope>-round-<r-1>.md`. Attack what changed since your last round, as **Later rounds** in your role instruction says, and write `<scope>-round-<r>-<seat>.md`." The seats live for one task, so each remembers what it tried, its probes are still there, and it diffs the tree it reviewed last against the tree now.

**When no seat reports**, in round `<r>`, start the seats of round `round` again, once, each with its round 1 `Agent` call and every file in it named for round `<r>`: the seat writes `<scope>-round-<r>-<seat>.md`. A seat whose seat file of round `<r>` is already under `<WORKDIR>/review/` is not started again. In round 1 the call is the call above. From round 2 on, three things change in the call's prompt:

- "The evidence is" names the newest evidence file of the scope, the one `$FLOW/review-files.md`, **The lint**, calls the latest code change before round `<r>`.
- "Under review" also names the reply `<scope>-round-<r-1>-reply.md` and the round file of the last round `<scope>-round-<r-1>.md`, as the `SendMessage` above lists them.
- The prompt adds: "You start in round `<r>`. Review the whole change as round 1 does, since you have no earlier snapshot, and do not raise again a finding the earlier round files list."

The seats started again remember only from round `<r>` on, and every later round goes to them by `SendMessage`. When none reports again, stop as the entry's file says for the round cap.

2. **When every seat has reported**, run `$FLOW/scripts/panel.sh verify <WT> <scope>` with the Bash tool's `timeout` set to 600000, because it runs every probe in turn. It runs again the command of each finding in `open` and of each finding in the seat files of round `round`, sorts them by the probe's exit, and writes the draft `<WORKDIR>/drafts/<scope>-round-<r>.md` (see `$FLOW/review-files.md`, **A draft**). Its JSON carries the last 40 lines of each run as `output`, and `dropouts` the seats of the run with no seat file. A call the timeout cut off is run again with `run_in_background`, and you wait for its exit.
3. **Keep, drop, merge, from the draft.** The draft already sorts by the exit: an earlier finding is `resolved`, `stands` or `stands again`, a new finding that exited non-zero is under `## New findings`, and the rest is under `## Dropped`. What is left is judgement. Keep a new finding when its `output` shows a failure that breaks the intent: the design, its criteria, the plan and the task detail. **Drop the rest with the reason.** Findings with one root cause become one entry that names every seat. Write `Breaks:` for each finding kept, and the `Seats:` line, a dropout said there. An earlier finding marked `reply: disagree` is judged against the intent: a `disagree` whose reason shows the failure does not break the intent is `resolved`, with the reason quoted. **There is no judge.** The round file holds every finding of every seat that you kept. Anything under `## Not run` that no seat could run goes to the round file's `## Not run`.
4. **Write the round file** `<scope>-round-<r>.md` from the draft with Write, in the shape `$FLOW/review-files.md` gives: `Seats:` (the model each seat ran on, a fallback and a dropout said here), `## Earlier findings`, `## New findings`, `## Dropped`, `## Not run` and `## Verdict`. The verdict is yours, and when `approve` is allowed is in `$FLOW/review-files.md`, **A review round**. Before the Write, run `$FLOW/scripts/panel.sh status <WT> <scope>` and read `approve`. `approve-no-evidence` in `why` rules `approve` out until the implementation session writes the evidence file the rule names: `SendMessage` it for that file, as (a) does for a missing evidence file, and run status again once it is there. `approve-open` in `why` means `approve` needs every finding in `open` marked `resolved` in this round's `## Earlier findings`, and `## New findings` reading `None.`. Otherwise the verdict is `changes-requested`. After the Write, run `$FLOW/scripts/panel.sh lint <absolute path of the round file>` and rewrite the round file until `ok` is true, before the verdict goes to (c) or (d). An `approve` over a finding the file itself leaves open shows there as `approve-open`, and the verdict is then `changes-requested`. `draft` means a line was not copied as the draft holds it: copy it again from the draft, and never edit the draft.

`approve` goes to (d). After a round file that is not `approve`, run `$FLOW/scripts/panel.sh status <WT> <scope>` again and read `cap`: true stops as **The round cap** says, false goes to (c).

**After a context summary in the middle of (b)**, `$FLOW/scripts/panel.sh status <WT> <scope>` gives the scope's state back. Seat files of round `round` already under `<WORKDIR>/review/` mean the seats have reported, so (b) goes on at step 2: run `panel.sh verify` again, which overwrites the draft, and go on from the draft. A `verdict` of `approve` means (d). `changes-requested` is read by `cap` as after step 4, and with `cap` false, a finding in `open` whose `reply` is null means the reply of the last round is not in yet, so ask the implementation session for it. `stop` with `no-run` is read as **The level** says.

**(c) Respond**

`SendMessage` to the implementation session.

> The review is `<WORKDIR>/review/task-<k>-round-<r>.md`. Fix what needs fixing, and write your answer to every open finding in `task-<k>-round-<r>-reply.md` next to it. Each finding's `Command:` is a `panel.sh run` line with the seat's probe, which you can read: run that line after your fix, and a `fixed` always carries its `ran:` and `saw:`. Answer `disagree` with your reasoning when you disagree. Answer a finding marked `stands again` as **After two failed fixes** in `$FLOW/judgement.md` says. A reply that changes code comes with `task-<k>-round-<r>-evidence.md`, a full pass. **Do not commit yet.** Report back once the tests pass.

Go back to (b).

**(d) Commit on approve**

`SendMessage` to the implementation session.

> Task k, "<task name>", passed review. Turn its changes into **one commit**. Match the commit message style this repository already uses and make the task recognisable. Check that `git status --porcelain` is empty afterwards and report back. End the report with **notes for the next session, five lines at most**: the commands that run the tests and the type checks, the conventions you kept and the traps you hit, and anything that bears on the tasks still to come. No explanation of the code.

**When tasks are left, ask the design session for the next detail in the same message**, a second `SendMessage`
beside the one above, so the detail runs while the commit does. The approved change is what the commit takes, so the
working tree already holds the code task k+1 starts from.

> Task k, "<task name>", passed review and is being committed now. Its approved change sits in the working tree of `<WT>`, uncommitted, and the commit takes it unchanged. Detail task k+1, "<task name>", against the code as it stands in the working tree, untracked files included. What the earlier tasks actually produced outranks what the design predicted. Follow **Detailing a task** in your role instruction. If the task boundary itself no longer holds, say that instead.

Check it yourself with `git log -1 --oneline`, `git status --porcelain`, and `git branch --show-current` to confirm the branch has not moved. Anything left in the working tree needs an explanation from the implementation session. Screenshots inside `<WORKDIR>` are ignored by git and can stay.

**Add those notes to the handover notes you keep.** Fold the duplicates together. Once the whole thing runs past
fifteen lines, drop the oldest. The next task's implementation prompt carries this, and it is the only thing that
outlives a session.

**When the commit report has a `check wanted:` line** (a task's, or the fix commit of the integration review in `standalone.md`), keep it out of the handover notes and hold it separately for the work report (`finish.md`).

**Give the user a one-line progress report**: `task k/N done: <short SHA> <commit subject> (commit k since START <short SHA>)`. A long context can be summarised away. The plan and the progress rebuild from the progress lines, and `START` and `WORKDIR` from `panel.sh status <WT>`. When the commit report had a `check wanted:` line (task or integration fix commit), pass it on to the user as a line of its own after the progress line, word for word, so that a summary still leaves a copy.

**This task's implementation session and the seat sessions are finished here.** Do not send them anything after this. The next
task starts new ones, and the seats' worktrees stay beside `<WT>`, re-pointed by the next `panel.sh run`. After the last task's commit, the entry's file says what comes next, and whether that task's implementation session stays alive. The seat sessions end here either way.

### When the plan breaks

When the detail pass in (a) says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan** with `SendMessage`. Tell the user what the new plan is in one message and go on without waiting. A redraw changes the task count that phase 5 goes by. A change to the design itself goes back to the user the same way a "no" or "conditional" in phase 1 does, and in From an issue it ends the run as `from-issue.md` says (the stop `decision`).

### The round cap

**Five round files of one scope without `approve`, counted by `cap`, for every scope**: `task-<k>`, `integration`
and `merge`. **Fixed.** Nobody negotiates it.

When `cap` of `$FLOW/scripts/panel.sh status <WT> <scope>` is true after a round file that is not `approve`, stop as the entry's file says. Do not keep the rounds going forever.

**If the user says stop at any point, stop** as the entry's file says. The cap is a brake, and it is not a promise.

## Rules for the whole flow

- **You do not write code.** The implementation session implements and the seats review. Code you write yourself never passes through a review.
- **A seat never changes the tree of `<WT>`.** It writes only its probes under `<WORKDIR>/seats/<seat>/` and its seat file, and executes only through `panel.sh run`. You write the round file and no other file of the review, and the implementation session fixes what is found. The seats' worktrees stay beside `<WT>` until the cleanup removes them.
- **A review file is final once its writer has linted it and reported.** Each round and each reply is a new file under `<WORKDIR>/review/`, in the shape `$FLOW/review-files.md` gives, and so is each evidence file. Its writer fixes it until `panel.sh lint` passes, and nobody edits it after the report.
- **The design session lives for the whole flow, in the standalone flow and in From an issue. An implementation session and the seat sessions live for one task.** Inside a task they continue through `SendMessage`, because throwing the context away between rounds repeats arguments that were already settled. At the commit they are finished, and the next task starts new ones. The implementation session of a one-task plan also writes the work report.
- **Keep the reports from the sub-agents short.** The role instructions cap them. A report that pastes a diff or a log fills the one context that holds the whole plan, which is yours. When a long one arrives, say so, and ask for the gist next time.
- **One task is one commit, and a commit happens only after the review approves.** A commit mid-round drops the diff out of the working-tree view the review reads.
- **No branches, no history rewriting from the sub-sessions.** The main session owns `git checkout -b`, run in `<WT>`. `git rebase`, `git reset --hard` and `--amend` break the `START` comparison. The role instructions say the same.
- **Each Bash call runs one command with its values written out.** No shell variables, no `$(...)`, no chaining. Read the output whole. pj4-running drives this flow in runs that cannot answer a permission question, and a command Claude Code cannot check stalls them.
- **A URL in a message to the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything touching the URL becomes part of the link and opens the wrong page (`$FLOW/../pj1-plan/between-skills.md`, **Issues in a report**).
- **Never write into `work-reports/` without checking it is ignored.** Unchecked, the report and the screenshots ride into the next commit. `worktree.sh ignore` (standalone, From a pull request) and pj4-running (From an issue, From a sync) check it before anything is written there, and `panel.sh begin` checks it again. Never edit `.gitignore`.
- **The standalone flow never touches `<MAIN>`.** Never switch, stash, commit or clean there. Everything runs in `<WT>`.
- **`worktree.sh` is for the standalone flow and From a pull request.** From an issue and From a sync never call it. **`panel.sh` is called by every entry**, with the absolute `<WT>`, and `lint` with the absolute path of a review file.
- **Do not move anything under `<WORKDIR>` into version control.** The report, the screenshots and the diff are worth more untracked. Move them only when the user asks.
- Report a failure when it happens: a failing test, a design that falls apart. **Approved commits are already on the branch and the task in flight is uncommitted in the working tree.** Say both.
- Standalone, the main session pushes and opens the pull request. From an issue, the main session also pushes and opens the draft pull request. Nothing is merged here. pj4-running
  merges. From a pull request, the main session pushes the merge commit to the pull request's branch, as a
  fast-forward. From a sync, nothing is pushed. pj4-running pushes the merge commit.
- **A merge of another branch into the run's branch happens only in The merge task**, and only after `worktree.sh
  sync` or pj4-running's `run.sh sync` found a conflict. A clean merge is left to GitHub.
