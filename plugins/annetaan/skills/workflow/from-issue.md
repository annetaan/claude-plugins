# From an issue

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

pj4-running loads this skill to run one sub-issue of a project. The issue is the design in its goal, its
boundary and its checked decisions. A design session details it against the code on the base branch first, may
redraw its body, and stays for the whole run. This entry has no approval and no questions. The shape
of the issue is in `$FLOW/../pj1-plan/format.md`, and the shape of its pull request in
`$FLOW/../pj1-plan/between-skills.md` under **Pull requests**.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the issue number `n`, the parent `P`, and the issue title
- the projects `P` waits on, `Q1, Q2, …` (`parent.waitsOn` in `project.sh`), or none
- the base branch (the parent's `Base:` line), and the branch pj4-running just made from the tip of the base branch
- the handover notes, from the parent's handover comment (`pj1-plan/between-skills.md`, **The handover comment**)
- the issue's worktree `<WT>`, `pj-<P>-<n>-<stamp>`, which `run.sh worktree` made for this run, and `<MAIN>`, the
  main working tree. The session is in `<WT>`, and the branch is checked out there
- the `level.sh show` JSON, from **The level** in pj4-running. `begin` takes `level` and `source` from it, and each
  session's `model` and `effort` come from `flow.sh prompt` (**The prompts** in SKILL.md)

pj4-running has already run its checks (`gh`) on `<WT>`, and its `run.sh start` has added `work-reports/` to the clone's
`.git/info/exclude`.
Every command below runs in `<WT>`. Never touch `<MAIN>`. The user works in it during the run.

## What it runs of the shared steps

This entry asks nothing. Its ending is **What it hands back to pj4-running** below, which replaces any report to the user.

- **Design** in `standalone.md` does not run. **The detail pass** below takes its place.
- It makes no branch. pj4-running owns the branch.
- **Begin** in `SKILL.md` runs right after pj4-running made the branch and before **The detail pass**, with `<level>` and
  `<source>` from the `level.sh show` JSON pj4-running settled:

  ```bash
  $FLOW/scripts/flow.sh begin <WT> --level <level> --source <source> --issue <n> --parent <P>
  ```

  A `stop` with `not-ignored` takes the stop procedure with the reason `work-reports`. Never ask about `.gitignore`
  here.

  Right after `begin`, write the design, with the `..` collapsed into `<skills>/pj1-plan/...` as **Paths: `$RUNNING`**
  in `pj4-running/SKILL.md` says:

  ```bash
  $FLOW/../pj1-plan/scripts/project.sh <P> --design <n> > <WORKDIR>/design.md
  ```

  A non-zero exit is quoted and takes **The stop procedure** with the reason `user`. Then write the handover notes
  pj4-running settled to `<WORKDIR>/notes.md` with Write, and nothing when they are empty.

  After a context summary, a `no-run` from `flow.sh status <WT>` means **Begin** has not run, and the level is the
  JSON pj4-running settled (**The level** in `SKILL.md`). `<WT>` was made for this run, so a work directory in it is
  this run's.
- **The detail pass** and the task loop run as **The detail pass** and **The task loop** below say.
- **The integration review** in `integration.md` runs after the last task when the plan has two or more tasks, with
  its round cap ending in **The stop procedure** below, then **The finish from an issue**. With one task it does not
  run, and the task's implementation session stays alive after **Commit** in `loop.md`, because it writes the work
  report in **The finish from an issue**. Its seat sessions end as usual.
- **The round cap**, the user saying stop, and a change to the design itself under **When the plan breaks** in
  `loop.md` end in **The stop procedure**, with no question to the user.

## The detail pass

Create `<WORKDIR>/scratch/design` with `mkdir -p`. Then write the prompt:

```bash
$FLOW/scripts/flow.sh prompt <WT> design
```

and start the design session with its line, `annetaan:workflow-design` with the `model` and `effort` the JSON prints
(**The prompts** in SKILL.md). The prompt names the issue, the parent, where the parents it waits on are listed, the
format of an issue, `project.sh`, the run's files and the scratch directory.
**When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
spawn it again with the same prompt file, `model: "opus"` and the same `effort`.

By what comes back:

- **`Unplanned:` lines**: `later` goes to pj4-running's **Unplanned work** as soon as it arrives. `blocking` is the stop
  `blocking`.
- **`Stop: nothing left`**: nothing was committed. Return `nothing-left` with the evidence.
- **`Stop: ask`**: hand `Body:` to pj4-running's **A redrawn issue**, then take the stop `decision`.
- **A `Body:`, an `Order:` or a `Notes:` that is not `unchanged` or `none`**: hand it to **A redrawn issue**. It comes
  back as go on, as `reordered` (return it), as the stop `detail`, or as the stop `user` (a human edited the issue
  during the pass).
- **Otherwise** go on.

## The design, the plan and the detail

- **The design**, for every prompt of the task loop and the integration review, is `<WORKDIR>/design.md`. Write it again with the same
  `project.sh <P> --design <n>` command as right after `begin` after every pass of pj4-running's **A redrawn issue** that
  answers go on, so that it holds the issue as it now reads on GitHub.
- **The plan and the detail**: the design session's `<WORKDIR>/plan.md` and `<WORKDIR>/detail/task-<k>.md`.
- **The commit**: the `commit` prompt of **Commit** in `loop.md` asks for a subject that follows the repository's style and names
  the task, and for a plan of one task the issue title, the first line of `<WORKDIR>/design.md`.

## The task loop

The sections of `loop.md` run as written, **Detail and implement** in `loop.md` and **Commit** in `loop.md` included: from task 2 onward the design session details each task
while the task before it is committed. Each
task gets a new implementation session and new review seats, five rounds, one commit. **When the plan breaks** in `loop.md` and a
`Diverged:` report go to the design session with `SendMessage`. A new `Body:` from it goes through **A redrawn issue**
again, and `Stop: ask` is the stop `decision`. Existing decisions stay byte for byte in every redraw. `flow.sh prompt`
reads the issue from `run.json`, so the prompts carry the issue's lines on their own: the implementation session
follows **Work outside the task**, each seat is told that the issue's checked decisions bind, and every review request
names `<WORKDIR>/adaptations.md`.

Keep the handover lines from **Commit** for pj4-running.

## Reports from the implementation session

- **`Unplanned:` with `later`**: hand it to pj4-running's **Unplanned work** as soon as it arrives. The task goes on.
- **`Unplanned:` with `blocking`**: take the stop procedure, then hand the report to pj4-running's **When workflow
  returns** in `pj4-running/issues.md`.
- **`Diverged:`**: send it to the design session with `SendMessage`, and tell the implementation session to wait. The
  answer is a redraw of the plan, a new `Body:` for **A redrawn issue**, or `Stop: ask`. After a redraw, the
  implementation session goes on or a new one starts, as **When the plan breaks** in `loop.md` says.
- **Adaptations** the implementation session lists: append each to `<WORKDIR>/adaptations.md`, a Read of it when it
  exists, then Write with the earlier lines kept. The review requests and `log.md` read them there.

## The finish from an issue

1. **The work report.** Read `finish.md` and run **The work report** there. Its `report` prompt also asks for the
   adaptations in `<WORKDIR>/adaptations.md` and what the detail pass redrew in the issue.
2. **`changes.diff`, then `flow.sh record`**, as written in `finish.md`. It writes the head of
   `pj1-plan/between-skills.md` **Pull requests** from the `--issue` and `--parent` that `begin` got.
3. **Push, then open the pull request.**

   ```bash
   git push -u origin <branch>
   cd <WORKDIR>
   ```

   ```bash
   gh pr create --draft --base <base branch> --title "<issue title>" --body-file log.md
   ```

   The `--attach` rules apply as in **The pull request** in `finish.md`. With screenshots, the `gh pr create` line
   above takes the `--attach` flags and keeps `--draft --base <base branch>`. A screenshot still missing after the
   reattach goes into what you hand back, with its path. Nothing waits on the user.
4. **The decisions.** Run **The decisions** in `finish.md` with `<m>`.
5. Return `finished`.

## The stop procedure

It runs on the round cap, an `Unplanned:` with `blocking`, a `Stop: ask` or a redraw that did not pass
(**The detail pass**, **The task loop**), a change to the design itself that **When the plan breaks** in `loop.md`
hands to the entry (the stop `decision`), a human edit that **A redrawn issue** found or a non-zero exit of `project.sh --design` (the stop `user`), `begin`
stopping with `not-ignored`, or the user saying stop. The reasons it hands back are
`round cap`, `blocking`, `decision`, `detail`, `work-reports`, `user` and `finish`.

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

## What it hands back to pj4-running

- **`finished`**: the pull request number `m`, the SHA of the last commit, the handover lines, the paths of any
  screenshots that could not be attached, `decisions` (the URLs in `filed` of **The decisions** in `finish.md`, or
  its stop message), and `stop requested` (yes or no).
- **`stopped`**: the reason (`round cap`, `blocking`, `decision`, `detail`, `user`, `work-reports` or `finish`),
  `<WORKDIR>` (the absolute path, when **Begin** made it, otherwise none), `<START>`, and the text of the `Unplanned:`
  report, the decision `#<n> D<k>` the design session asked, or the failing lint or `--check` JSON, or for `finish` the
  step that failed, its message and the path of `log.md` when there is one. A run that returns `stopped` has opened no
  pull request. pj4-running leaves the worktree. On `finish` it detaches the worktree and keeps the branch, with its
  reviewed commits, for the next run's `left`. On the other reasons it ends the worktree with `run.sh end`, which
  removes it when nothing changed since `<START>` and otherwise keeps it, its commits on a detached HEAD, for
  `/annetaan:cleanup`, and the next run redoes the issue in a new worktree.
- **`nothing-left`**: `<WORKDIR>`, `<START>` and the evidence, a `ran:` and a `saw:` for each acceptance criterion.
- **`reordered`**: `<WORKDIR>` and `<START>`. A redraw gave `#<n>` an open blocker.
