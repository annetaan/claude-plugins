# From a sync

pj4-running loads this skill once every sub-issue of project `P` is closed, before it opens the project's pull
request, when merging `origin/<from>` into the project's base branch stopped on conflicts. The merge is in progress in
`<WT>`. It runs **The merge task** in `merge-task.md`, and pushes nothing. pj4-running pushes the merge.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the parent `P`, the base branch `<base>`, and `<from>`
- the conflicted files
- `<START>`: the tip of the base branch the merge started from
- the handover notes, seeded from the parent's handover comment
- the run's worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, on a detached HEAD

pj4-running has already confirmed that `work-reports/` is ignored in `<WT>`. Every command below runs in `<WT>`.
Never touch `<MAIN>`.

## What it runs of phases 2 to 4

This entry asks nothing and writes nothing to memory. Its ending is **What it hands back to pj4-running** below, which replaces any report to the user and any part of the finish.

- **Phase 2 (a) and (c)** do not run. pj4-running settled `<WT>` and `<START>`.
- **Phase 2 (b)** runs as a guard only, because (d) needs `<ROOT>` from the first command.

  ```bash
  git rev-parse --show-toplevel
  git -C <ROOT> check-ignore -q work-reports/
  ```

  On exit 1, leave the working tree as it is, push nothing, and return `stopped` with the reason `work-reports`. Never ask about `.gitignore` here.
- **Phase 2 (d)** runs as written, with `<START>`.
- **Phases 3 and 4** run as **The merge task** in `merge-task.md` says, below.

## The merge task

Read the parent, `gh issue view <P> --json body`. Read `merge-task.md` and run **The merge task** with `<incoming>` as `origin/<from>`,
`<into>` as `<base>`, `<M>` as `<START>`, and as `<intent>`: "project #<P>'s changes, as the parent's `## Design`
describes them", followed by that design. A `later` report goes to pj4-running's **Unplanned work** as it arrives,
worded "found while merging `<from>` into `<base>`". The merge task says that a stop leaves the merge in progress in
`<WT>`. Say plainly that it is local, that the next run never uses it, and that the merge gets redone.

## What it hands back to pj4-running

What **The merge task** in `merge-task.md` hands back, to pj4-running's **Bringing `<from>` in**.
