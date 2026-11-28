# The merge task

> `$FLOW` in this file is the directory it is in, `<skills>/workflow`, written out as **Paths: `$FLOW`** in `SKILL.md` says.

A merge that stopped on conflicts runs as one task with review rounds, and its commit is the merge commit. An entry's
file starts it and gives the values under **What the caller has settled**. There is no
design session, no approval, no question and no integration review.

## What the caller has settled

- `<WT>`, where the merge is in progress: HEAD is `<M>`, the commit the merge started from, `MERGE_HEAD` is the tip
  of `<incoming>`, and the conflicted files hold conflict markers
- `<incoming>`, the ref coming in, such as `origin/main`, and `<into>`, the branch it comes into
- the conflicted files
- `<intent>`: what the `<into>` side is for, in words the sessions can check a resolution against, and where the
  sessions read it
- `<WORKDIR>`, whose `<WORKDIR>/notes.md` holds the handover notes when there are any

## The design, the plan and the detail

Run the two commands, then write `<WORKDIR>/merge.md` with Write, before the first prompt.

```bash
git log --oneline <M>..MERGE_HEAD
```

```bash
git diff --name-only --diff-filter=U
```

`<WORKDIR>/merge.md` holds three headings:

- **The design**: "Merge `<incoming>` into `<into>`. Resolve every conflict so that both sides hold: what
  `<incoming>` brings, as it is, and `<intent>` on top of it. Change nothing beyond the resolution and what the build
  and the tests need on the merged code." As acceptance criteria: no conflict marker is left,
  `git diff --name-only --diff-filter=U` prints nothing, and the tests and the type checks pass.
- **The plan**: one task, "1. Merge `<incoming>` into `<into>`".
- **The detail design for task 1**: the conflicted files, and the lines the `git log` above printed.

## The rounds

**Detail and implement** in `loop.md`, **Review** in `loop.md`, **Respond** in `loop.md` and **Commit** in
`loop.md` run as written for task 1, with a new implementation session and the review seats, five rounds, and
every prompt written by `flow.sh prompt` with the scope `merge`: `flow.sh prompt <WT> work merge`,
`seat merge <seat>`, `again merge`, `respond merge` and `commit merge`. They differ from a task's in these.

- Every prompt names `Design, plan and detail: <WORKDIR>/merge.md` in place of `<WORKDIR>/design.md`,
  `<WORKDIR>/plan.md` and `<WORKDIR>/detail/task-1.md`.
- The `work` prompt gives HEAD, `<M>`, as the start point and no branch, says that the merge is in progress, that each
  resolved file is added with `git add`, that `git merge --abort`, `git reset` and `git commit` are never run, and asks
  for `merge-evidence.md`: the commands of the acceptance criteria above and their output, plus the flows the
  conflicted files take part in.
- The `seat` prompt has each seat review the resolution, each conflicted file against both sides with
  `git diff HEAD -- <file>` and `git diff MERGE_HEAD -- <file>`, and any change outside those files.
- `<scope>` of **Review** in `loop.md` is `merge`. The round files are `merge-round-<r>.md`, each written by `flow.sh round` from the draft `drafts/merge-round-<r>.md` that `flow.sh verify` writes and the judgement, the replies `merge-round-<r>-reply.md`, and the evidence of a reply that changed code `merge-round-<r>-evidence.md`.
- **The commit**, in **Commit** in `loop.md`, is the `commit merge` prompt: `git add -A`, then `git commit --no-edit`, which
  records the merge with both parents and the message git prepared, then the checks that `git status --porcelain`
  prints nothing and that `MERGE_HEAD` is gone, with the notes for the next session.

Check it yourself with `git log -1 --oneline` and `git rev-parse --verify --quiet MERGE_HEAD`. Print
`merge done: <short SHA>`.

After the commit, the implementation session stays alive for the caller, and the seat sessions end. The round cap and the user saying stop end in **Stopping** below.

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
