# The merge task

A merge that stopped on conflicts runs as one task with review rounds, and its commit is the merge commit. Three
places start it: **Bringing the base in** in phase 6, in `standalone.md`, **From a pull request** in `from-pr.md`, and **From a sync** in `from-sync.md`. There is no
design session, no approval, no question and no integration review.

## What the caller has settled

- `<WT>`, where the merge is in progress: HEAD is `<M>`, the commit the merge started from, `MERGE_HEAD` is the tip
  of `<incoming>`, and the conflicted files hold conflict markers
- `<incoming>`, the ref coming in, such as `origin/main`, and `<into>`, the branch it comes into
- the conflicted files
- `<intent>`: what the `<into>` side is for, in words the sessions can check a resolution against
- `<WORKDIR>`, and the handover notes, or none

## The design, the plan and the detail

```bash
git log --oneline <M>..MERGE_HEAD
git diff --name-only --diff-filter=U
```

- **The approved design**, for every prompt below: "Merge `<incoming>` into `<into>`. Resolve every conflict so that
  both sides hold: what `<incoming>` brings, as it is, and `<intent>` on top of it. Change nothing beyond the
  resolution and what the build and the tests need on the merged code." As acceptance criteria: no conflict marker is
  left, `git diff --name-only --diff-filter=U` prints nothing, and the tests and the type checks pass.
- **The plan**: one task, "1. Merge `<incoming>` into `<into>`".
- **The detail design for task 1**: the conflicted files, and the commits the `git log` above lists.

## The rounds

Phases 3 and 4 run as written for task 1, with a new implementation session and a new review session, five rounds,
and the worktree line in every prompt, except for these.

- The phase 3 prompt: "Start point START: `<M>`. Branch: `<into>`. This is a merge in progress. Resolve the
  conflicts, and `git add` each file you resolve. Never run `git merge --abort`, `git reset` or `git commit`: the
  merge state is the task. Follow **Work outside the task** in your role instruction."
- The review prompt: "This is a merge. `git diff HEAD` also shows everything `<incoming>` brings. Review the
  resolution: each conflicted file against both sides, with `git diff HEAD -- <file>` and
  `git diff MERGE_HEAD -- <file>`, and any change outside those files. Write round 1 as `merge-round-1.md`." Later
  rounds are `merge-round-<r>.md`, and the replies `merge-round-<r>-reply.md`.
- **The commit**, in phase 4 (d): "The merge passed review. Run `git add -A`, then `git commit --no-edit`, which
  records the merge with both parents and the message git prepared. Check that `git status --porcelain` prints
  nothing and that `git rev-parse --verify --quiet MERGE_HEAD` fails, and report back", with the notes for the next
  session as written.

Check it yourself with `git log -1 --oneline` and `git rev-parse --verify --quiet MERGE_HEAD`. Print
`merge done: <short SHA>`.

## Reports from the implementation session

- **`Unplanned:` with `later`**: keep it for the caller. The task goes on.
- **`Unplanned:` with `blocking`**, and **`Diverged:`**: stop as below.

## Stopping

The round cap, a `blocking` or `Diverged:` report, or the user saying stop.

- **No merge commit yet**, while `git rev-parse --verify --quiet MERGE_HEAD` still succeeds: leave the working tree
  as it is, push nothing, send nothing more to the sessions in flight, and return `stopped`.
- **The merge commit exists**: return `finished`, with `stop requested: yes` when the user said stop.

## What it hands back

- **`finished`**: the SHA of the merge commit, the handover lines, the `later` reports, and `stop requested`.
- **`stopped`**: the reason (`round cap`, `blocking`, `diverged` or `user`), the points still open or the text of the
  report, and that the merge stays in progress in `<WT>`.
