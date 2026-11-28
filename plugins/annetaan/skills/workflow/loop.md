# The task loop

> `$FLOW` in this file is the directory it is in, `<skills>/workflow`, written out as **Paths: `$FLOW`** in `SKILL.md` says.

Work the plan one task at a time. Nothing runs in parallel, because there is one working tree.
A task is **Detail and implement**, **Review**, **Respond**, back to **Review**, then **Commit** on approve. The file
that runs the loop says how many tasks, with which scope, and how each ending lands for it.

## Detail and implement

**Every task starts a new implementation session, task 1 included.** This section is where you start it, after the
commit of the task before is checked, so that the progress holds that commit:

```bash
$FLOW/scripts/flow.sh prompt <WT> work task-<k>
```

Then make the `Agent` call with its line (**The prompts** in `SKILL.md`). The prompt names the run's files, the start point, the
branch, the progress, the review files and a `Scratch:` directory, asks for `task-<k>-evidence.md`, and asks for
screenshots when the change shows on screen, the before shot first, saved in `<WORKDIR>` for **The work report** in
`finish.md`.

**One implementation session covers one task.** Every review round for that task continues through `SendMessage` to
the same agent, because answering a finding on your own code needs the context that wrote it. **Commit** ends it. You
never message it again, unless the entry's file keeps the last task's session alive, and the next task starts a new one.

**Task 1 needs no detailing.** The design session read the repository in the state task 1 starts from, so the detail
it wrote for task 1 cannot have gone stale.

**From task 2 onward, the design session details the task first.** You asked for that detail in **Commit** of task k-1, in
the same message as the commit, so it runs while the commit does. Wait until both have reported.

**This is where a broken plan gets caught before anyone writes code against it.** An answer that says the boundary no
longer holds goes to **When the plan breaks**.

Before the implementation session starts, check that `<WORKDIR>/detail/task-<k>.md` exists, with one command:

```bash
ls <WORKDIR>/detail
```

When it is missing, ask the design session for it in one line by `SendMessage`, and wait for its report. A merge has no
detail file: `<WORKDIR>/merge.md` takes the place of all three (`merge-task.md`).

Then write the `work` prompt and start a new implementation session with it, as the start of this section says.

Check that the tests pass before you send anything to review, and that the evidence file the `work` prompt named exists under `<WORKDIR>/review/` (`task-<k>-evidence.md`, or `merge-evidence.md` in a merge). When it is missing, `SendMessage` the implementation session for it. `git status --porcelain` shows the change sitting in the working tree, and `git log -1` shows HEAD has not moved.

## Review

The same steps run for a task, for the integration review and for the merge task. `<scope>` is `task-<k>`, `integration` or `merge`. Every session, yours and the seats', stays in `<WT>`. Only `flow.sh` enters a seat's worktree.

The scope's values come from the script, not from counting files:

```bash
$FLOW/scripts/flow.sh status <WT> <scope>
```

It prints what `status <WT>` prints, with `scope`, `round`, `cap`, `verdict` and `open` added. `round` is the next round, and it is the `<r>` of every file name in this section. `flow.sh prompt` reads it the same way for the prompts of **Review** and **Respond**. `verdict` is the verdict of the last round file, null before round 1. `open` lists the findings the last round left open, each with its `id`, `stood` (how many round files marked it `stands` or `stands again`) and `reply` (`fixed` or `disagree` from the last round's reply, null when that reply or its line is missing). `cap` is read from what `flow.sh round` prints after step 4.

1. **Start every seat of `seats` in one message.** Each seat writes `<scope>-round-<r>-<seat>.md`, the seat file of round `round`. In round 1, run for each seat

   ```bash
   $FLOW/scripts/flow.sh prompt <WT> seat <scope> <seat>
   ```

   and send every seat's `Agent` call in one message (**The prompts** in `SKILL.md`), so the seats run in parallel. The prompt says what the review reads: a task `git diff HEAD` plus the untracked files, the integration review `git diff <START>` plus the untracked files, and a merge each conflicted file against both sides.

**Every round after that goes to each seat with `SendMessage`**, all in one message: run `$FLOW/scripts/flow.sh prompt <WT> again <scope>` once and send its line to every seat. It names the reply, the evidence and the round file of the last round, and each seat's file of round `round`. The seats live for one task, so each remembers what it tried, its probes are still there, and it diffs the tree it reviewed last against the tree now.

**When no seat reports**, in round `<r>`, start the seats of round `round` again, once, each with a new `seat` prompt and its `Agent` call, as in round 1: the seat writes `<scope>-round-<r>-<seat>.md`. A seat whose seat file of round `<r>` is already under `<WORKDIR>/review/` is not started again. From round 2 on, the prompt `flow.sh prompt` writes is a restart's: it names the reply and the round file of the last round, names the evidence as **A review round** in `review-files.md` defines it, and asks for the whole change, since the seat has no earlier snapshot. The seats started again remember only from round `<r>` on, and every later round goes to them by `SendMessage`. When none reports again, stop as the entry's file says for the round cap.

2. **When every seat has reported**, run `$FLOW/scripts/flow.sh verify <WT> <scope>` with the Bash tool's `timeout` set to 600000, because it runs every probe in turn. It runs again the command of each finding in `open` and of each finding in the seat files of round `round`, sorts them by the probe's exit, and writes the draft `<WORKDIR>/drafts/<scope>-round-<r>.md` (see `$FLOW/review-files.md`, **A draft**). Its JSON carries the last 40 lines of each run as `output`, and `dropouts` the seats of the run with no seat file. A call the timeout cut off is run again with `run_in_background`, and you wait for its exit.
3. **Keep, drop, merge, from the draft.** The draft already sorts by the exit: an earlier finding is `resolved`, `stands` or `stands again`, a new finding that exited non-zero is under `## New findings`, and the rest is under `## Dropped`. What is left is judgement. Keep a new finding when its `output` shows a failure that breaks the intent: the design, its criteria, the plan and the task detail, read from `<WORKDIR>/design.md`, `<WORKDIR>/plan.md` and `<WORKDIR>/detail/task-<k>.md`, or from `<WORKDIR>/merge.md` in a merge. **Drop the rest with the reason.** Findings with one root cause become one entry that names every seat. Write `Breaks:` for each finding kept, and the `Seats:` line, a dropout said there. An earlier finding marked `reply: disagree` is judged against the intent: a `disagree` whose reason shows the failure does not break the intent is `resolved`, with the reason quoted. **There is no judge.** Anything under `## Not run` that no seat could run goes to `## Not run`. You write this judgement into the judgement file of step 4, not into the round file: `flow.sh round` writes the round file from it, with every finding of every seat that you kept.
4. **Write the judgement file** `<WORKDIR>/drafts/<scope>-round-<r>-judgement.md` with Write, in the shape of `$FLOW/review-files.md` **A review round**: `Seats:` (the model each seat ran on, a fallback and a dropout said here), `## Keep`, `## Drop`, `## Earlier` and `## Not run`. Then run `$FLOW/scripts/flow.sh round <WT> <scope> <absolute path of the judgement file>`. It writes the round file and its verdict, and you act on `verdict` and `cap`. `no-draft` means there is no draft of round `round`: run step 2, then `round` again. `judgement` names a `line` of the judgement file and a `why`: fix that line and run `round` again. `no-evidence` means the judgement keeps nothing and leaves nothing standing, but the evidence of the latest code change is missing: `SendMessage` the session that writes the file named in `file`, the implementation session for an evidence file and seat a for `integration-round-1-a.md`, as **Detail and implement** does for a missing evidence file, and run `round` again once the file is there.

`approve` goes to **Commit**. Otherwise `cap`, as `flow.sh round` prints it, decides: true stops as **The round cap** says, false goes to **Respond**.

**After a context summary in the middle of a review**, `$FLOW/scripts/flow.sh status <WT> <scope>` gives the scope's state back. Seat files of round `round` already under `<WORKDIR>/review/` mean the seats have reported, so the review goes on at step 2: run `flow.sh verify` again, which overwrites the draft, then write the judgement and run `flow.sh round`. A `verdict` of `approve` means **Commit**. `changes-requested` is read by `cap` as after step 4, and with `cap` false, a finding in `open` whose `reply` is null means the reply of the last round is not in yet, so ask the implementation session for it. `stop` with `no-run` is read as **The level** in `SKILL.md` says.

## Respond

Run `$FLOW/scripts/flow.sh prompt <WT> respond <scope>` and `SendMessage` its line to the implementation session. It
names the round file just written, the reply and the evidence that go next to it, and **After two failed fixes** in
`judgement.md` for a finding marked `stands again`.

Go back to **Review**.

## Commit

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

**When the commit report has a `check wanted:` line** (a task's, or the fix commit of **The integration review** in `integration.md`), keep it out of the handover notes. Append each one word for word to `<WORKDIR>/checks.md`: Read it when it exists, then Write it with the earlier lines kept. The work report gathers them from there (`finish.md`).

**Give the user a one-line progress report**: `task k/N done: <short SHA> <commit subject> (commit k since START <short SHA>)`. A long context can be summarised away. After a context summary, the plan comes back from `<WORKDIR>/plan.md`, only the progress from the progress lines, and `START` and `WORKDIR` from `flow.sh status <WT>`.

**This task's implementation session and the seat sessions are finished here.** Do not send them anything after this. The next
task starts new ones, and the seats' worktrees stay beside `<WT>`, re-pointed by the next `flow.sh run`. After the last task's commit, the entry's file says what comes next, and whether that task's implementation session stays alive. The seat sessions end here either way.

## When the plan breaks

When the detail pass in **Detail and implement** says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan**: a one-line `SendMessage` that names `<WORKDIR>/plan.md` and what broke. The design session rewrites that file and reports the new task names. Tell the user what the new plan is in one message and go on without waiting. A redraw changes the task count that **The integration review** in `integration.md` goes by. A change to the design itself ends the loop as the entry's file says.

## The round cap

**Five round files of one scope without `approve`, counted by `cap`, for every scope**: `task-<k>`, `integration`
and `merge`. **Fixed.** Nobody negotiates it.

When `cap`, as `flow.sh round` prints it, is true after a round that is not `approve`, stop as the entry's file says. Do not keep the rounds going forever.

**If the user says stop at any point, stop** as the entry's file says. The cap is a brake, and it is not a promise.
