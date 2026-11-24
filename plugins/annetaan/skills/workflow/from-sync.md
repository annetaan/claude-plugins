# From a sync

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

pj4-running loads this skill once every sub-issue of project `P` is closed, before it opens the project's pull
request, when merging `origin/<from>` into the project's base branch stopped on conflicts. The merge is in progress in
`<WT>`. It runs **The merge task** in `merge-task.md`, and pushes nothing. pj4-running pushes the merge.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the parent `P`, the base branch `<base>`, and `<from>`
- the conflicted files
- `<START>`: the tip of the base branch the merge started from
- the handover notes, from the parent's handover comment (`pj1-plan/between-skills.md`, **The handover comment**)
- the run's worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, on a detached HEAD
- the `level.sh show` JSON, from **The level** in pj4-running. The worker and the review seats take their `model` and
  `effort` from it

pj4-running has already confirmed that `work-reports/` is ignored in `<WT>`. Every command below runs in `<WT>`.
Never touch `<MAIN>`.

## What it runs of phases 2 to 4

This entry asks nothing. Its ending is **What it hands back to pj4-running** below, which replaces any report to the user and any part of the finish.

- **Phase 2 (a)** does not run.
- **Phase 2 (b)** runs with `<level>` and `<source>` from the JSON pj4-running settled, with no `--issue` and no
  `--parent`:

  ```bash
  $FLOW/scripts/flow.sh begin <WT> --level <level> --source <source>
  ```

  The `start` it prints is the `<START>` pj4-running settled: `run.sh sync` stopped the merge on the tip of the base
  branch and printed that tip as `start`, and a merge in progress leaves `HEAD` there. From here on `<START>` is that
  `start`. On a `stop` with `not-ignored`, leave the working tree as it is, push nothing, and return `stopped` with the
  reason `work-reports`. Never ask about `.gitignore` here.

  After a context summary, `flow.sh status <WT>` names this run only when its `issue` is null. A `no-run`, or a
  number in `issue`, is an issue's work directory in the reused `<WT>`: phase 2 (b) has not run, its `start` and
  `workdir` are not taken, and the level is the JSON pj4-running settled (**The level** in SKILL.md).

  Then write the handover notes pj4-running settled to `<WORKDIR>/notes.md` with Write, and nothing when they are
  empty.
- **Phases 3 and 4** run as **The merge task** in `merge-task.md` says, below.

## The merge task

Read `merge-task.md` and run **The merge task** with `<incoming>` as `origin/<from>`, `<into>` as `<base>`, `<M>` as
`<START>`, and as `<intent>`: "project #<P>'s changes, as its `## Design` describes them, read with
`gh issue view <P> --json body`". A `later` report goes to pj4-running's **Unplanned work** as it arrives,
worded "found while merging `<from>` into `<base>`". The merge task says that a stop leaves the merge in progress in
`<WT>`. Say plainly that it is local, that the next run never uses it, and that the merge gets redone.

## What it hands back to pj4-running

What **The merge task** in `merge-task.md` hands back, to pj4-running's **Bringing `<from>` in** in `pj4-running/project-pr.md`.
