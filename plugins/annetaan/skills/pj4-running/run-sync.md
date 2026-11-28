# A sync

> This file is read by pj4-running's main session. The paths it uses are the ones **Paths: `$RUNNING`** in `SKILL.md` gives, where `$FLOW` means `<skills>/workflow`.

pj4-running runs this file once every sub-issue of project `P` is closed, before it opens the project's pull
request, when merging `origin/<from>` into the project's base branch stopped on conflicts. The merge is in progress in
`<WT>`, the sync worktree `pj-<P>-sync-<stamp>` that `run.sh sync` made for this merge. It runs **The merge task** in
`workflow/merge-task.md`, and pushes nothing. pj4-running pushes the merge.

Read **Agents** in `workflow/SKILL.md`, **The prompts** in `workflow/SKILL.md`, **Begin** in `workflow/SKILL.md`,
**The run's files** in `workflow/SKILL.md` and **Rules for the whole flow** in `workflow/SKILL.md` before **Begin**
runs, and again after a context summary.

pj4-running's `run.sh start` has already added `work-reports/` to the clone's `.git/info/exclude`. Every command below
runs in `<WT>`.
Never touch `<MAIN>`.

## The handover notes

Read the handover comment with the command in `pj1-plan/between-skills.md` under "The handover comment". Keep its
lines as the handover notes. With no comment, the notes are empty. Take it every time, never only when the notes are
empty. Every fold writes the notes back to the comment, so reading it again loses nothing and picks up a human's edit.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the parent `P`, the base branch `<base>`, and `<from>`
- the conflicted files
- `<START>`: the tip of the base branch the merge started from
- the handover notes, from the parent's handover comment (`pj1-plan/between-skills.md`, **The handover comment**)
- the sync worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, on a detached HEAD
- the `level.sh show` JSON, from **The level** in `SKILL.md`. The worker and the review seats take their `model` and
  `effort` from it

## What it runs of the shared steps

This run asks nothing. Its ending is the end of **The merge task** below, which replaces any report to the user and
any part of the finish.

- It makes no branch.
- **Begin** in `workflow/SKILL.md` runs with `<level>` and `<source>` from the JSON pj4-running settled, with no
  `--issue` and no `--parent`:

  ```bash
  $RUNNING/../workflow/scripts/flow.sh begin <WT> --level <level> --source <source>
  ```

  The `start` it prints is the `<START>` pj4-running settled: `run.sh sync` stopped the merge on the tip of the base
  branch and printed that tip as `start`, and a merge in progress leaves `HEAD` there. From here on `<START>` is that
  `start`. On a `stop` with `not-ignored`, leave the working tree as it is, push nothing, and return `stopped` with the
  reason `work-reports`. Never ask about `.gitignore` here.

  After a context summary, a `no-run` from `flow.sh status <WT>` means **Begin** has not run, so `level` and `source`
  come from the last `level` line, as between entries in the last bullet of **Rules** in `SKILL.md`.

  Then write the handover notes from **The handover notes** to `<WORKDIR>/notes.md` with Write, and nothing when they
  are empty.
- The task loop runs as **The merge task** in `workflow/merge-task.md` says, below.

## The merge task

Read `workflow/merge-task.md` and run **The merge task** with `<incoming>` as `origin/<from>`, `<into>` as `<base>`,
`<M>` as `<START>`, and as `<intent>`: "project #<P>'s changes, as its `## Design` describes them, read with
`gh issue view <P> --json body`". A `later` report goes to **Unplanned work** in `SKILL.md` as it arrives,
worded "found while merging `<from>` into `<base>`". The merge task says that a stop leaves the merge in progress in
`<WT>`. pj4-running ends `<WT>` with `run.sh end`, which keeps it, with the merge in progress, until
`/annetaan:cleanup` removes it. Say plainly that it is local, that the next run never uses it, and that the merge gets
redone in a new sync worktree.

What **The merge task** in `workflow/merge-task.md` hands back goes to **Bringing `<from>` in** in `project-pr.md`.
