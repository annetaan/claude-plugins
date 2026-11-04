# From a pull request

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

The user asks to resolve the conflicts of a pull request that is already open, often one this skill or pj4-running
opened, long after the run that opened it. The request covers the whole of it: **ask no approval**. A new worktree
takes the branch, the merge task resolves the conflicts under review, the merge is pushed to the branch, and the
worktree is cleaned up.

## What it skips

- **Does this repository accept breaking changes?** in SKILL.md, and phases 1, 2 (a) and 5. Ask nothing and write nothing to
  memory.
- Phase 6 apart from the push below, and **Report to the user** in SKILL.md, which the report below replaces.

## Which pull request

Run `worktree.sh start` as **Before you start** in SKILL.md says. Then take the number the request names, as `#12` or a URL.
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
    pj4-running pushes to. Say so in one line, then load `Skill(skill: "annetaan:pj4-running", args: "<pr.project>")`
    and follow it. Every sub-issue of the project is closed, so it brings `<base>` in under review and finds the pull
    request there. The user's request covers its run.
- **`stop`** with `not-open`, `fork` or `unknown`: quote `message` and stop. Nothing was changed.

## The worktree

Run steps 3 to 6 of **The worktree** in SKILL.md with `<head>` in place of the base: `worktree.sh create <head>` puts the new
worktree on the tip of `origin/<head>`, detached, so a worktree that already has `<head>` checked out, such as the
one the run that opened the pull request left, is not in the way. A stop there ends this entry, as it would a
standalone run. Then make the work directory as phase 2 (d) says, from `git rev-parse HEAD`.

## The merge

```bash
$FLOW/scripts/worktree.sh sync <name> <base>
```

- **`current`** or **`clean`**: `<head>` does not conflict with `origin/<base>`, so nothing is resolved. Say so, and
  that GitHub may take a moment to see it. Clean up as below.
- **`conflict`**: print `<base> conflicts with <head> in <k> file(s)`. Read the pull request,
  `gh pr view <n> --json title,body`. When its body begins `Implements #<i>`, read that issue's `## Design` too. Read `merge-task.md` and run
  **The merge task** with `<incoming>` as `origin/<base>`, `<into>` as `<head>`, `<M>` as `start`, and as `<intent>`:
  "the change pull request #<n> makes, as its title and body describe it", followed by the title, the body and the
  issue's design when there is one.
- **`stop`**: quote `message`, and leave the worktree as **Ending before approval** in SKILL.md says.

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
`<MAIN>/work-reports/`, and the worktree is removed. On `stopped` from the merge task, leave `<WT>` as it is instead,
and say that `/annetaan:workflow-cleanup`, picking `<name>`, removes it.

Tell the user: the pull request URL, the files resolved and how each was settled, in a line each, the merge commit,
what the review rounds changed, the `later` reports, and where the review files now are. For a pull request
pj4-running opened for a sub-issue, add that the next `/annetaan:pj4-running` merges it.
