# From a pull request

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

The user asks to resolve the conflicts of a pull request that is already open, often one this skill or pj4-running
opened, long after the run that opened it. The request covers the whole of it: **ask no approval**. A new worktree
takes the branch, the merge task resolves the conflicts under review, the merge is pushed to the branch, and the
worktree is cleaned up.

## What it runs of phases 2 to 4

It asks nothing beyond the questions below.

- **Phase 2 (a)** does not run. The branch is `<head>`.
- **Phase 2 (b)** runs at the end of **The worktree** below. On a `stop` with `not-ignored`, stop and report, because **The worktree** step 4 in `worktree.md` should have settled it.
- **Phases 3 and 4** run as **The merge task** in `merge-task.md` says. **The push** and **Cleaning up and the report** below are its ending. No other part of the finish runs, and the report below replaces any other report to the user.

## Which pull request

Read `worktree.md`, and run `worktree.sh start` as **The start check** there says. Then take the number the request names, as `#12` or a URL.
When it names none and the conversation is about one pull request, take that one. Otherwise:

```bash
$FLOW/scripts/worktree.sh pr
```

`pick` lists in `candidates` the open pull requests of the user that GitHub reports as conflicting. One: take it.
Several: ask one `AskUserQuestion` with each as `#<number> <title>`, at most four, the newest first. None: ask for
the number, saying that GitHub reports none of the user's open pull requests as conflicting.

```bash
$FLOW/scripts/worktree.sh pr <number>
```

- **`ok`**: keep `pr.head` as `<head>`, `pr.base` as `<base>`, and the number as `<n>`.
  - **`pr.project` is set**: this is project #`pr.project`'s pull request, from its base branch, which only
    pj4-running pushes to. Say so in one line, then load `Skill(skill: "annetaan:pj4-running", args: "<pr.project>")`,
    with the `level=` token of this run's args added after the number when they carry one, and follow it. Every
    sub-issue of the project is closed, so it brings `<base>` in under review and finds the pull request there. The
    user's request covers its run.
- **`stop`** with `not-open`, `fork` or `unknown`: quote `message` and stop. Nothing was changed.

## The worktree

Run steps 3 to 6 of **The worktree** in `worktree.md` with `<head>` in place of the base: `worktree.sh create <head>` puts the new
worktree on the tip of `origin/<head>`, detached, so a worktree that already has `<head>` checked out, such as the
one the run that opened the pull request left, is not in the way. A stop there ends this entry, as it would a
standalone run. Then run **The level** in SKILL.md, and when `level.sh show` exits non-zero, quote the message and leave
the worktree as **Ending with nothing changed** in `worktree.md` says. Then run phase 2 (b), with `<level>` and `<source>`
from the JSON **The level** read, before **The merge**, so that `start` is the pull request's head:

```bash
$FLOW/scripts/flow.sh begin <WT> --level <level> --source <source>
```

## The merge

```bash
$FLOW/scripts/worktree.sh sync <name> <base>
```

- **`current`** or **`clean`**: `<head>` does not conflict with `origin/<base>`, so nothing is resolved. Say so, and
  that GitHub may take a moment to see it. Clean up as below.
- **`conflict`**: print `<base> conflicts with <head> in <k> file(s)`. Read `merge-task.md` and run
  **The merge task** with `<incoming>` as `origin/<base>`, `<into>` as `<head>`, `<M>` as `start`, and as `<intent>`:
  "the change pull request #<n> makes, as `gh pr view <n> --json title,body` prints it", and, when its body begins
  `Implements #<i>`, "and the `## Design` of issue #<i>, read with `gh issue view <i> --json body`". The sessions read
  them.
- **`stop`**: quote `message`, and leave the worktree as **Ending with nothing changed** in `worktree.md` says.

## The push

On `finished`:

```bash
git -C <WT> push origin HEAD:refs/heads/<head>
```

A plain push goes through only as a fast-forward, so it never rewrites the branch. When git refuses it because
`<head>` moved on origin, say so: someone pushed to it during the run. Leave `<WT>` with its merge commit, say that
`/annetaan:workflow-cleanup`, picking `<name>`, removes it, and stop. Ask the user whether to run the merge again on the new tip.

## Cleaning up and the report

After a push, or when nothing needed resolving, leave the worktree (`ExitWorktree(action: "keep")`, or `cd <MAIN>`)
and remove it.

```bash
$FLOW/scripts/worktree.sh cleanup <name>
```

The worktree holds a detached HEAD whose commit is on origin, so nothing is lost: the work reports move into
`<MAIN>/work-reports/`, the worktree is removed, and the reports in `<MAIN>/work-reports/` beyond the 100 newest, by
the time stamp in their name, are deleted. On `stopped` from the merge task, leave `<WT>` as it is instead,
and say that `/annetaan:workflow-cleanup`, picking `<name>`, removes it.

Tell the user: the pull request URL, the files resolved and how each was settled, in a line each, the merge commit,
what the review rounds changed, the `later` reports, the work reports the cleanup deleted from `<MAIN>/work-reports/` (`oldReports.deleted`) when there are any, and where the review files now are. For a pull request
pj4-running opened for a sub-issue, add that the next `/annetaan:pj4-running` merges it.
