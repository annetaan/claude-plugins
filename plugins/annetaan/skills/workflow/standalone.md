# The standalone flow

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

The run goes in this order:

1. Read `worktree.md` and run **The start check**, then **The worktree** there.
2. **The level** in `SKILL.md`. When `level.sh show` exits non-zero, the worktree already exists: quote the message and
   take **Ending with nothing changed** in `worktree.md`.
3. **Begin** in `SKILL.md`, with `<level>` and `<source>` from the `level.sh show` JSON:

   ```bash
   $FLOW/scripts/flow.sh begin <WT> --level <level> --source <source>
   ```

   On a `stop` with `not-ignored`, stop and report, because **The worktree** step 3 in `worktree.md` should have
   settled it, and take **Ending with nothing changed** in `worktree.md`, since no branch exists yet.
4. **Design** below.
5. **The branch** below, right after the start message.
6. For each task, **Detail and implement** in `loop.md`, **Review** in `loop.md`, **Respond** in `loop.md` and
   **Commit** in `loop.md`, as **The shared steps in the standalone flow** below settles them.
7. **The integration review** in `integration.md`, when the plan has two or more tasks.
8. **Bringing the base in** below.
9. **The work report** in `finish.md`, **The pull request** in `finish.md` and **The decisions** in `finish.md`.
10. **Report to the user** below.

## Design

Create the design session's scratch directory first:

```bash
mkdir -p <WORKDIR>/scratch/design
```

Hand the user's request to the design session as it was written, with the work directory and a `Scratch:` line. This is
the one sub-agent prompt you write by hand, because it carries the request verbatim. Write `$FLOW` out, and end it with
the text of `$FLOW/prompts/worktree-line.md`, the real paths written for `<WT>` and `<MAIN>`.

```
Agent(subagent_type: "annetaan:workflow-design", description: "design",
      model: "<agents.workflow-design.model>", effort: "<agents.workflow-design.effort>",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\nWork directory: <absolute path of WORKDIR>\n\nScratch: <absolute path of WORKDIR>/scratch/design\n\n<the text of $FLOW/prompts/worktree-line.md>")
```

`annetaan:workflow-design` ships with this plugin and takes its model and effort from the level, `agents.workflow-design` of the level JSON. It is told never to change the repository, and to write only the run's files under its `Work directory:` and experiments under its `Scratch:` directory, by instruction.
**When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
spawn it again with the same prompt, `model: "opus"` and the same `effort`.

When the design comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait. Do not walk past it.
- **An open question with no `Only you know:` line goes back.** `SendMessage` the design session to decide it and record it under Model decisions. It rewrites `<WORKDIR>/design.md`, and `<WORKDIR>/plan.md` when the plan changes.
- **The plan is `<WORKDIR>/plan.md`**, an ordered list of tasks, each with the files it touches. When `<WORKDIR>/design.md`, `<WORKDIR>/plan.md` or `<WORKDIR>/detail/task-1.md` is missing, use `SendMessage` to make the design session write it.
- **The round cap is five per scope, a task or the integration review, and it is fixed.** Mention it once in the start message. Do not negotiate the number (see **The round cap** in `loop.md`).

**Keep the design session alive for the whole flow.** You go back to it twice. Before every task from task 2
onward, to have it detail that task against the tree the task before left, while that task is committed
(**Commit** in `loop.md`). And whenever the plan breaks,
to have it redraw the remaining tasks.

### The open questions and the start message

**The flow asks for no approval.** It asks the user only what it cannot go on without: the open questions here, a
feasibility of "no" or "conditional" above, and the round cap and the failures below. Everything else runs to the
pull request on its own.

**Ask the open questions**, when the design has any. They go to the user with `AskUserQuestion`. **One call holds
four questions at most**, so ask in as many calls as it takes, in the order the design gives them. Send the answers
back with `SendMessage` so the design session can settle them: it keeps each question in `<WORKDIR>/design.md` with the user's answer on an `Answered:` line,
rewrites the design for that answer, and rewrites `<WORKDIR>/plan.md` when the plan changes. Each question carries its `Only you know:` line. With
no open question, ask nothing.

Then present the design summary, the three lines of it in the design session's report, and the plan in one **start
message**, and go on to **The branch** in the same turn, without waiting for an answer. The start message states:

- the Model decisions, one line each
- the name of the new branch, and `base: <base>`
- the worktree `<WT>`, and that `<MAIN>` is not touched, except for the lines the answers added to `.worktreeinclude`
- that `<WT>` holds the ignored files `.worktreeinclude` names, the ones `ready` copied and the ones the Copy answers copied, and that the first worker prepares the rest the tests need, such as dependencies, and records the steps in the handover notes
- `level <level> (<source>)`, the model and effort it gives the design session, the implementation session and the review seats, how many seats the level runs, and that `level=<level>` on a new run changes it
- that everything after this runs on its own: per-task implementation and review rounds, the integration review when the plan has more than one task, the push and the pull request, and that saying stop ends the run

**You pick the branch name yourself.** Match the naming the repository already uses (`git branch -a`), choose one that `git branch -a` does not list yet, and write it into the start message. Do not spend a question on it.

## The branch

```bash
git -C <WT> checkout -b <branch name>
```

The name is the one you put in the start message. When git refuses because the name exists, pick another and say so in one line.

## The shared steps in the standalone flow

The shared steps run as written, with these settled here.

- **The branch** runs right after the start message. **Begin** in `SKILL.md` already ran before **Design**.
- **After the last task's commit** (**Commit** in `loop.md`): when **The integration review** in `integration.md` does not run, keep that task's implementation session alive, because it writes the work report in **The work report** in `finish.md`. Its seat sessions end as usual. After the last task, go to **The integration review**, or to **Bringing the base in** when it does not run (the plan has one task).
- **The round cap** of any scope, `integration` included, and **When no seat reports** under **Review** in `loop.md` when none reports again: when `cap` of `$FLOW/scripts/flow.sh status <WT> <scope>` is true, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in `<WT>`.** Say that, say that the worktree stays as it is, and say that `/annetaan:cleanup` removes it, discarding the work, once the user decides. If the user says keep going after the cap, keep going: `cap` stays true from then on, and no longer stops the run.
- **A change to the design itself** under **When the plan breaks** in `loop.md` goes back to the user the same way a "no" or "conditional" in **Design** does.
- **When the user says stop** at any point, stop and report.

## Bringing the base in

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
  `origin/<base>`, `<into>` as `<branch>`, `<M>` as `start`, and as `<intent>`: "the design in
  `<WORKDIR>/design.md`, as the commits since `<START>` implement it".
  - **`finished`**: go on. That implementation session is alive, and it writes the work report. Keep the `later`
    reports for **Report to the user**.
  - **`stopped`**: push nothing. Go to **Report to the user**, and say that the task commits are on the branch and
    that the merge stays in progress in `<WT>`.
- **`stop`** with `fetch-failed`, `dirty` or `unfinished`: quote `message` and go to **Report to the user**. The
  task commits are on the branch, and nothing was pushed.

## Report to the user

**First leave the worktree**: `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available.

Every standalone run that got past the start message ends here, finished or stopped (round cap, user stop, a failed finish). Close with: `START`, the commits stacked on it matched against the tasks in the plan, the design summary, and what the review changed. Then:

- **how the base came in**: already in, merging cleanly, or merged after the merge task resolved the files it names, or why it did not

- **the pull request URL**, when one was opened
- **the decision issues**, when **The decisions** in `finish.md` ran: the URL of each issue in `filed`, each on a line of its own, or that no decision fell in the four areas, or the stop message it kept
- **the worktree `<WT>`**, and that the work report lives under it until cleanup, and the review seat worktrees beside it, `review-<name of WT>-<seat>`, which the same cleanup removes. The probes of the seats are under `<WORKDIR>/seats/`
- **the path of the work report** (`<WORKDIR>/log.md`), which opens in an editor with the screenshots inline
- the review files, under `<WORKDIR>/review/`
- the screenshot paths, when the change shows on screen
- when **The integration review** did not run, one line saying the integration review did not run because the plan had one task
- **the cleanup**: once the pull request is merged or closed, `/annetaan:cleanup <PR number>` moves the work report into `<MAIN>/work-reports/`, removes `<WT>` and the branch, fast-forwards the local `<base>` after a merge, and deletes the reports in `<MAIN>/work-reports/` beyond the 100 newest, by the time stamp in their name. A run that stopped with no pull request is cleaned up with `/annetaan:cleanup` and no number
- for a stopped run, what is still uncommitted in `<WT>`
