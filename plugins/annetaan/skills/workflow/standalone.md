# The standalone flow

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

Read `worktree.md` and run **The start check** first. Then run **The worktree** in `worktree.md`, then **The level** in SKILL.md, phase 1 below, phases 2 to 4 in SKILL.md as **Phases 2 to 4 in the standalone flow** below settles them, and phases 5 and 6 below. When `level.sh show` exits non-zero, the worktree already exists: quote
the message and take **Ending with nothing changed** in `worktree.md`.

## Phase 1: design

Hand the user's request to the design session as it was written, with the worktree line (see **The worktree line** in SKILL.md) and a `Scratch:` line. The scratch directory is `<WT>/work-reports/<stamp>-design`, with `<stamp>` the worktree's name without `wf-`. Create it first with `mkdir -p`.

```
Agent(subagent_type: "annetaan:workflow-design", description: "design",
      model: "<agents.workflow-design.model>", effort: "<agents.workflow-design.effort>",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\n<the worktree line>\n\nScratch: <WT>/work-reports/<stamp>-design")
```

`annetaan:workflow-design` ships with this plugin and takes its model and effort from the level, `agents.workflow-design` of the level JSON. It is told never to change the repository and to write only under its `Scratch:` directory, by instruction.
**When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
spawn it again with the same prompt, `model: "opus"` and the same `effort`.

When the design comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait. Do not walk past it.
- **An open question with no `Only you know:` line goes back.** `SendMessage` the design session to decide it and record it under Model decisions.
- **Keep the plan.** It is an ordered list of tasks, each with the files it touches. If the plan is missing, use `SendMessage` to make the design session produce it.
- **The round cap is five per scope, a task or the integration review, and it is fixed.** Mention it once in the start message. Do not negotiate the number (see **The round cap** in SKILL.md).

**Keep the design session alive for the whole flow.** You go back to it twice. Before every task from task 2
onward, to have it detail that task against the tree the task before left, while that task is committed (phase
4 (d)). And whenever the plan breaks,
to have it redraw the remaining tasks.

### The open questions and the start message

**The flow asks for no approval.** It asks the user only what it cannot go on without: the open questions here, a
feasibility of "no" or "conditional" above, and the round cap and the failures below. Everything else runs to the
pull request on its own.

**Ask the open questions**, when the design has any. They go to the user with `AskUserQuestion`. **One call holds
four questions at most**, so ask in as many calls as it takes, in the order the design gives them. Send the answers
back with `SendMessage` so the design session can settle them. Each question carries its `Only you know:` line. With
no open question, ask nothing.

Then present the design summary and the plan in one **start message**, and go on to phase 2 in the same turn,
without waiting for an answer. The start message states:

- the Model decisions, one line each
- the name of the new branch, and `base: <base>`
- the worktree `<WT>`, and that `<MAIN>` is not touched
- that `<WT>` lacks `<MAIN>`'s ignored files (dependencies, `.env`), so the first worker prepares what the tests need and records the steps in the handover notes
- `level <level> (<source>)`, the model and effort it gives the design session, the implementation session and the review seats, how many seats the level runs, and that `level=<level>` on a new run changes it
- that everything after this runs on its own: per-task implementation and review rounds, the integration review when the plan has more than one task, the push and the pull request, and that saying stop ends the run

**You pick the branch name yourself.** Match the naming the repository already uses (`git branch -a`), choose one that `git branch -a` does not list yet, and write it into the start message. Do not spend a question on it.

## Phases 2 to 4 in the standalone flow

Phases 2 to 4 in SKILL.md run as written, with these settled here.

- **Phase 2** starts right after the start message and runs (a), then (b) as `$FLOW/scripts/panel.sh begin <WT> --level <level> --source <source>`, both from the `level.sh show` JSON **The level** in SKILL.md read. On a `stop` with `not-ignored`, stop and report, because **The worktree** step 4 in `worktree.md` should have settled it.
- **After the last task's commit in phase 4 (d)**: when phase 5 does not run (see **Phase 5**), keep that task's implementation session alive, because it writes the work report in phase 6. Its seat sessions end as usual. After the last task, go to phase 5, or to phase 6 when the plan has one task (see **Phase 5**).
- **The round cap**: when `cap` of `$FLOW/scripts/panel.sh status <WT> <scope>` is true, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in `<WT>`.** Say that, say that the worktree stays as it is, and say that `/annetaan:workflow-cleanup` removes it, discarding the work, once the user decides. If the user says keep going after the cap, keep going: `cap` stays true from then on, and no longer stops the run.
- **When the user says stop** at any point, stop and report.

## Phase 5: integration review

**Phase 5 runs only when the plan has two or more tasks.** With one task, the task review already read the working
tree against HEAD, and HEAD was still `START`. That is the same diff phase 5 would read, and there is no task boundary
to look at. Count the tasks in the plan as it stands when its last task is committed. A redraw under **When the plan breaks** in SKILL.md
changes the count. With one task, a redraw can happen only while task 1 is in flight. When it grows the plan
to several tasks, task 1's (d) ends its sessions as usual and phase 5 runs after the new last task. When it leaves
one task, phase 5 is skipped. Once two tasks are committed, phase 5 runs. When a redraw leaves no task to run after
task 1 is committed, phase 5 runs too, because task 1's (d) has already ended its sessions.

From an issue runs this phase too, with the stop procedure of `from-issue.md` in place of the report to the user, and goes to **Phase 6 from an issue** after it.

Once every task is committed, **review the whole diff once.** A review inside a task cannot see the task boundaries: interfaces that do not line up, a rename done on one side only, work duplicated between tasks.

The target is the working tree against `START` (`git diff <START>` plus untracked files), which is every commit put
together. The working tree should be empty at this point. Fixes from the integration review land uncommitted in the
working tree, so later rounds see them in the same diff.

**The integration review starts new seats**, model and effort included, with the steps of phase 4 (b) in SKILL.md: every seat in one message, `panel.sh verify`, the round file. `<scope>` is `integration`, so the files are `integration-round-<r>-<seat>.md` and `integration-round-<r>.md`. The prompt is the phase 4 (b) prompt with the plan carrying the commit that closed each task (the matching `git log --oneline` lines) in place of the task detail, and this request in place of "Under review":

> Every task is committed. This is the integration review. The target is `git diff <START>` plus untracked files, read in `<WT>`. Write round 1 as `integration-round-1-<seat>.md`. The tasks were reviewed one at a time, so look at **the boundaries**: types and contracts between functions that call each other across tasks, names that do not match, duplicated implementations, and acceptance criteria for the whole design that are still unmet. No evidence file exists before round 1, because the tree is clean. Record the walk of every acceptance criterion and every flow of the whole design under `## Walk`, each run as a probe, with `ran:` and `saw:`, or `not run:`.

A restart in round `<r>` of 2 or more (phase 4 (b), **When no seat reports**) sends this request with three changes: "Write round `<r>` as `integration-round-<r>-<seat>.md`", the sentence on no evidence file and the `## Walk` sentence left out, because the lint allows `## Walk` only in `integration-round-1-<seat>.md`, and the evidence being the newest `integration-round-<j>-evidence.md`, or, when no reply has fixed code, the `## Walk` of the `integration-round-1-<seat>.md` files.

**`changes-requested` starts a new implementation session as well**, with the phase 3 call, model and effort included, and its `Scratch:` line, and each reply that changes code comes with `integration-round-<r>-evidence.md`. The progress is every task, the handover notes are everything you have collected, and the request is to
answer the integration review. From there the (b), (c) loop is the same as phase 4, with the `integration-round-<r>`
files, and the `integration` scope has the same cap, counted the same way, by `cap` of
`$FLOW/scripts/panel.sh status <WT> integration`. No session gets rebuilt during those rounds. Fixes become **one commit** after the review approves, with a
subject that says what it is, such as "integration review fixes". No fixes means no commit.

Review says `approve`, every finding is resolved, tests pass. Phase 6 starts when all three hold.

## Phase 6: finish

### Bringing the base in

The base may have moved while the tasks ran. A pull request that would conflict from the start is settled here,
under review, before anything is pushed.

```bash
$FLOW/scripts/worktree.sh sync <name> <base>
```

- **`current`**: the branch contains `origin/<base>`. Go on.
- **`clean`**: `origin/<base>` gained `behind` commits, and they merge without a conflict. Nothing was changed. The
  branch gets no merge commit it does not need. Go on.
- **`conflict`**: the merge of `origin/<base>` stopped on conflicts in `files`, and stays in progress in `<WT>`.
  Print `<base> conflicts with <branch> in <n> file(s)`, then read `merge-task.md` and run **The merge task** with `<incoming>` as
  `origin/<base>`, `<into>` as `<branch>`, `<M>` as `start`, and as `<intent>`: "the design, as the commits
  since `<START>` implement it", followed by the design.
  - **`finished`**: go on. That implementation session is alive, and it writes the work report. Keep the `later`
    reports for **Report to the user**.
  - **`stopped`**: push nothing. Go to **Report to the user**, and say that the task commits are on the branch and
    that the merge stays in progress in `<WT>`.
- **`stop`** with `fetch-failed`, `dirty` or `unfinished`: quote `message` and go to **Report to the user**. The
  task commits are on the branch, and nothing was pushed.

### The work report and the pull request

Read `finish.md` and run **The work report**, then **The pull request**.

### Report to the user

**First leave the worktree**: `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available.

Every standalone run that got past the start message ends here, finished or stopped (round cap, user stop, a failed finish). Close with: `START`, the commits stacked on it matched against the tasks in the plan, the design summary, and what the review changed. Then:

- **how the base came in**: already in, merging cleanly, or merged after the merge task resolved the files it names, or why it did not

- **the pull request URL**, when one was opened
- **the worktree `<WT>`**, and that the work report lives under it until cleanup, and the review seat worktrees beside it, `review-<name of WT>-<seat>`, which the same cleanup removes. The probes of the seats are under `<WORKDIR>/seats/`
- **the path of the work report** (`<WORKDIR>/log.md`), which opens in an editor with the screenshots inline
- the review files, under `<WORKDIR>/review/`
- the screenshot paths, when the change shows on screen
- when phase 5 was skipped, one line saying the integration review did not run because the plan had one task
- **the cleanup**: once the pull request is merged or closed, `/annetaan:workflow-cleanup <PR number>` moves the work report into `<MAIN>/work-reports/`, removes `<WT>` and the branch, fast-forwards the local `<base>` after a merge, and deletes the reports in `<MAIN>/work-reports/` beyond the 100 newest, by the time stamp in their name. A run that stopped with no pull request is cleaned up with `/annetaan:workflow-cleanup` and no number
- for a stopped run, what is still uncommitted in `<WT>`
