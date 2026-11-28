# A run from an issue

> This file is read by pj4-running's main session. The paths it uses are the ones **Paths: `$RUNNING`** in `SKILL.md` gives, where `$FLOW` means `<skills>/workflow`.

pj4-running runs one sub-issue of a project from this file. The issue is the design in its goal, its
boundary and its checked decisions. A design session details it against the code on the base branch first, may
redraw its body, and stays for the whole run. This run has no approval and no questions. The shape
of the issue is in `$RUNNING/../pj1-plan/format.md`, and the shape of its pull request in
`$RUNNING/../pj1-plan/between-skills.md` under **Pull requests**.

Read **Agents** in `workflow/SKILL.md`, **The prompts** in `workflow/SKILL.md`, **Begin** in `workflow/SKILL.md`,
**The run's files** in `workflow/SKILL.md` and **Rules for the whole flow** in `workflow/SKILL.md` before **Begin**
runs, and again after a context summary.

pj4-running has already run its checks (`gh`) on `<WT>`, and its `run.sh start` has added `work-reports/` to the clone's
`.git/info/exclude`.
Every command below runs in `<WT>`. Never touch `<MAIN>`. The user works in it during the run.

## The handover notes

Read the handover comment with the command in `pj1-plan/between-skills.md` under "The handover comment". Keep its
lines as the handover notes. With no comment, the notes are empty. Take it every time, never only when the notes are
empty. Every fold writes the notes back to the comment, so reading it again loses nothing and picks up a human's edit.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the issue number `n`, the parent `P`, and the issue title
- the projects `P` waits on, `Q1, Q2, …` (`parent.waitsOn` in `project.sh`), or none
- the base branch (the parent's `Base:` line), and the branch pj4-running just made from the tip of the base branch
- the handover notes, from the parent's handover comment (`pj1-plan/between-skills.md`, **The handover comment**)
- the issue's worktree `<WT>`, `pj-<P>-<n>-<stamp>`, which `run.sh worktree` made for this run, and `<MAIN>`, the
  main working tree. The session is in `<WT>`, and the branch is checked out there
- the `level.sh show` JSON, from **The level** in `SKILL.md`. `begin` takes `level` and `source` from it, and each
  session's `model` and `effort` come from `flow.sh prompt` (**The prompts** in `workflow/SKILL.md`)

## What it runs of the shared steps

This run asks nothing. Its ending is **The endings** below, which replaces any report to the user.

- **Design** in `workflow/standalone.md` does not run. **The detail pass** below takes its place.
- It makes no branch. pj4-running owns the branch.
- **Begin** in `workflow/SKILL.md` runs right after pj4-running made the branch and before **The detail pass**, with
  `<level>` and `<source>` from the `level.sh show` JSON pj4-running settled:

  ```bash
  $RUNNING/../workflow/scripts/flow.sh begin <WT> --level <level> --source <source> --issue <n> --parent <P>
  ```

  A `stop` with `not-ignored` takes the stop procedure with the reason `work-reports`. Never ask about `.gitignore`
  here.

  Right after `begin`, write the design, with the `..` collapsed into `<skills>/pj1-plan/...` as **Paths: `$RUNNING`**
  in `SKILL.md` says:

  ```bash
  $RUNNING/../pj1-plan/scripts/project.sh <P> --design <n> > <WORKDIR>/design.md
  ```

  A non-zero exit is quoted and takes **The stop procedure** with the reason `user`. Then write the handover notes
  from **The handover notes** to `<WORKDIR>/notes.md` with Write, and nothing when they are empty.

  After a context summary, a `no-run` from `flow.sh status <WT>` means **Begin** has not run, so `level` and `source`
  come from the last `level` line, as between entries in the last bullet of **Rules** in `SKILL.md`. `<WT>` was made
  for this run, so a work directory in it is this run's.
- **The detail pass** and the task loop run as **The detail pass** and **The task loop** below say.
- **The integration review** in `workflow/integration.md` runs after the last task when the plan has two or more
  tasks, with its round cap ending in **The stop procedure** below, then **The finish from an issue**. With one task it
  does not run, and the task's implementation session stays alive after **Commit** in `workflow/loop.md`, because it
  writes the work report in **The finish from an issue**. Its seat sessions end as usual.
- **The round cap** in `workflow/loop.md`, the user saying stop, and a change to the design itself under **When the
  plan breaks** in `workflow/loop.md` end in **The stop procedure**, with no question to the user.

## The detail pass

Create `<WORKDIR>/scratch/design` with `mkdir -p`. Then write the prompt:

```bash
$RUNNING/../workflow/scripts/flow.sh prompt <WT> design
```

and start the design session with its line, `annetaan:workflow-design` with the `model` and `effort` the JSON prints
(**The prompts** in `workflow/SKILL.md`). The prompt names the issue, the parent, where the parents it waits on are
listed, the format of an issue, `project.sh`, the run's files and the scratch directory.
**When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
spawn it again with the same prompt file, `model: "opus"` and the same `effort`.

By what comes back:

- **`Unplanned:` lines**: `later` goes to **Unplanned work** in `SKILL.md` as soon as it arrives. `blocking` is the
  stop `blocking`.
- **`Stop: nothing left`**: nothing was committed. Return `nothing-left` with the evidence.
- **`Stop: ask`**: hand `Body:` to **A redrawn issue** in `issues.md`, then take the stop `decision`.
- **A `Body:`, an `Order:` or a `Notes:` that is not `unchanged` or `none`**: hand it to **A redrawn issue** in
  `issues.md`. It comes back as go on, as `reordered` (return it), as the stop `detail`, or as the stop `user` (a
  human edited the issue during the pass).
- **Otherwise** go on.

## The design, the plan and the detail

- **The design**, for every prompt of the task loop and the integration review, is `<WORKDIR>/design.md`. Write it again with the same
  `project.sh <P> --design <n>` command as right after `begin` after every pass of **A redrawn issue** in `issues.md`
  that answers go on, so that it holds the issue as it now reads on GitHub.
- **The plan and the detail**: the design session's `<WORKDIR>/plan.md` and `<WORKDIR>/detail/task-<k>.md`.
- **The commit**: the `commit` prompt of **Commit** in `workflow/loop.md` asks for a subject that follows the
  repository's style and names the task, and for a plan of one task the issue title, the first line of
  `<WORKDIR>/design.md`.

## Reports from the implementation session

- **`Unplanned:` with `later`**: hand it to **Unplanned work** in `SKILL.md` as soon as it arrives. The task goes on.
- **`Unplanned:` with `blocking`**: take the stop procedure, then hand the report to **When a run returns** in
  `issues.md`.
- **`Diverged:`**: send it to the design session with `SendMessage`, and tell the implementation session to wait. The
  answer is a redraw of the plan, a new `Body:` for **A redrawn issue** in `issues.md`, or `Stop: ask`. After a
  redraw, the implementation session goes on or a new one starts, as **When the plan breaks** in `workflow/loop.md`
  says.
- **Adaptations** the implementation session lists: append each to `<WORKDIR>/adaptations.md`, a Read of it when it
  exists, then Write with the earlier lines kept. The review requests and `log.md` read them there.

## The task loop

The sections of `workflow/loop.md` run as written, **Detail and implement** in `workflow/loop.md` and **Commit** in
`workflow/loop.md` included: from task 2 onward the design session details each task while the task before it is
committed. Each task gets a new implementation session and new review seats, five rounds, one commit. **When the plan
breaks** in `workflow/loop.md` and a `Diverged:` report go to the design session with `SendMessage`. A new `Body:`
from it goes through **A redrawn issue** in `issues.md` again, and `Stop: ask` is the stop `decision`. Existing
decisions stay byte for byte in every redraw. `flow.sh prompt` reads the issue from `run.json`, so the prompts carry
the issue's lines on their own: the implementation session follows **Work outside the task**, each seat is told that
the issue's checked decisions bind, and every review request names `<WORKDIR>/adaptations.md`.

Keep the handover lines from **Commit** in `workflow/loop.md` for **When a run returns**.

## The finish from an issue

1. **The work report.** Read `workflow/finish.md` and run **The work report** there. Its `report` prompt also asks for
   the adaptations in `<WORKDIR>/adaptations.md` and what the detail pass redrew in the issue.
2. **`changes.diff`, then `flow.sh record`**, as written in `workflow/finish.md`. It writes the head of
   `pj1-plan/between-skills.md` **Pull requests** from the `--issue` and `--parent` that `begin` got.
3. **Push, then open the pull request.**

   ```bash
   git push -u origin <branch>
   cd <WORKDIR>
   ```

   ```bash
   gh pr create --draft --base <base branch> --title "<issue title>" --body-file log.md
   ```

   The `--attach` rules apply as in **The pull request** in `workflow/finish.md`. With screenshots, the `gh pr create`
   line above takes the `--attach` flags and keeps `--draft --base <base branch>`. A screenshot still missing after
   the reattach goes into what you hand back, with its path. Nothing waits on the user.
4. **The decisions.** Run **The decisions** in `workflow/finish.md` with `<m>`.
5. Return `finished`.

## The stop procedure

It runs on the round cap, an `Unplanned:` with `blocking`, a `Stop: ask` or a redraw that did not pass
(**The detail pass**, **The task loop**), a change to the design itself that **When the plan breaks** in
`workflow/loop.md` hands to this file (the stop `decision`), a human edit that **A redrawn issue** in `issues.md`
found or a non-zero exit of `project.sh --design` (the stop `user`), `begin` stopping with `not-ignored`, or the user
saying stop. The reasons it hands back are `round cap`, `blocking`, `decision`, `detail`, `work-reports`, `user` and
`finish`.

The case is decided by whether every task of the plan is committed and the integration review, when it runs, has
approved. Look for the commits in `git log --oneline <START>..HEAD`.

- **Every task is committed, and the integration review approved or did not run.** The stop came during **The finish from an issue**, and the
  working tree is clean. Run steps 1 to 4 of **The finish from an issue** to the end: the report, the push, the draft
  pull request and the decisions. Then return `finished`, with `stop requested: yes` when the user said stop.
- **Anything less.** Leave the working tree as it is. Push nothing. Send nothing more to the sessions in flight. Return
  `stopped`. pj4-running leaves the worktree and ends it with `run.sh end`, which removes it when nothing changed
  since `<START>` and otherwise keeps it, its commits on a detached HEAD, for `/annetaan:cleanup`. The next run
  redoes the issue in a new worktree. The seats' worktrees stay beside `<WT>` until it is removed.
- **A step of the finish fails before the pull request exists**, a step of **The finish from an issue**. Return `stopped` with the reason `finish`, the step
  that failed, its error message, and the path of `log.md` when step 1 wrote it. A `stop` from `flow.sh record` in
  step 2 is such a failure, with step 2 named and its `message` as the error.

## The endings

To return `finished`, `stopped`, `nothing-left` or `reordered` is to go to **When a run returns** in `issues.md` with
that case. What each case carries is listed there alone.
