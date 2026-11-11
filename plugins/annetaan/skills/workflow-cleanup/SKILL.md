---
name: workflow-cleanup
description: Cleans up a workflow run once its pull request is merged or closed, or after a run that stopped. Moves the work reports out of the run's wf-* worktree into the main working tree, removes the worktree, deletes the run's branch locally and on origin, fast-forwards the local base branch when the pull request merged, and deletes the work reports that have been in the main working tree 14 days or more. Asks one approval question. Use it only when the user names this skill or invokes /annetaan:workflow-cleanup, because it deletes branches and removes a worktree.
---

# workflow-cleanup

`workflow-cleanup` is no step of the workflow. It runs after the user has merged or closed the pull request that
`workflow` opened, or after a run that stopped midway, and tidies up what the run left behind: the worktree
`.claude/worktrees/wf-<stamp>`, the run's branch, and a local base branch that is now behind origin.

The script `worktree.sh` does the git work. **You write nothing to GitHub yourself.**

## Paths: `$CLEANUP`

**`$CLEANUP` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$CLEANUP` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for
the user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/workflow/scripts/worktree.sh` and not `<skills>/workflow-cleanup/../workflow/scripts/worktree.sh`.

This skill uses one file: the script `$CLEANUP/../workflow/scripts/worktree.sh`, written `worktree.sh` below. Every
subcommand prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote
its message and stop.

**Language**: talk to the user in the user's language.

**A URL you give the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no
bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it
bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything
touching the URL becomes part of the link and opens the wrong page (`$CLEANUP/../pj1-plan/between-skills.md`, **Issues
in a report**).

## Before you start

This skill deletes branches on origin and in the clone, and removes a worktree. **Start it only when the user names it
or invokes `/annetaan:workflow-cleanup`.**

```bash
git rev-parse --show-toplevel
gh auth status
```

Either one failing stops the skill. Say which one and stop.

## The run

```bash
$CLEANUP/../workflow/scripts/worktree.sh list
```

Each entry of `worktrees` is a worktree `.claude/worktrees/wf-<stamp>` with its `name`, `path`, `branch` (`null` when
detached), `state` and `pr`. `state` is `open`, `merged`, `closed`, `no-pr` or `error`, and `error` entries carry the
message.

**When a pull request number was given**, take the entry whose `pr.number` is that number.

- None: say that no `wf-*` worktree holds pull request #<n>, and stop.
- `open`: the pull request is still open. Give its URL and stop.

**Otherwise** the candidates are the entries that are `merged`, `closed` or `no-pr`. An `open` entry is printed and
never offered.

- **One candidate**: take it and ask nothing. Say `<name> (the only candidate)`. When its `state` is `no-pr`, say
  in one line that it may be a run still going in another session, with the time its stamp gives.
- **Several**: print every entry in one line, with its name, branch, state and pull request number and title, then ask
  with the header `Run`, at most 4 options, ordered `merged`, then `closed`, then `no-pr`, the oldest first within
  each, and the first marked `(Recommended)`.
- **None**: print the entries, say that no run is ready to be cleaned up, and stop.

Print `run <name>` once.

## The check

```bash
$CLEANUP/../workflow/scripts/worktree.sh check <name>
```

`check` fetches the base branch of a merged run and changes nothing else. Act by `status`.

- **`stop`**: act by `reason`.
  - `open`: the pull request is still open. Give `pr.url` and stop.
  - `unknown`, `not-a-repo`, `gh`, `fetch-failed`: quote `message` and stop.
- **`ok`**: keep `main` as `<MAIN>`, `worktree.path` as `<WT>`, `base` as `<base>`, and the rest for the question.

## The question

Show what the cleanup does, one line per item, from the `check` output.

- the pull request: `#<n> <title>` with its URL and `state`, or that the run opened none. A `no-pr` run that is
  still going in another session looks the same as one that stopped, so name the time the stamp of `<name>` gives
  and say that `Do not clean up` is the answer for a run still in progress
  - `closed`: "PR #<n> was closed without a merge. Its work is lost with the branch; GitHub keeps only the commits on
    the closed pull request."
- the worktree, by `worktree.state`:
  - `clean`: the work reports in `reports` move to `<MAIN>/work-reports/`, then `<WT>` is removed
  - `dirty`: as `clean`, and the uncommitted work in `changes` is discarded. Show `changes`
  - `prunable`: its directory is gone, and only git's record of it is pruned
- the branch, from `branch` (`null` means the worktree was detached and there is no branch):
  - `local`: `delete` deletes it. `keep` with `unpushed` keeps it, because it holds commits the pull request's head
    does not have. `keep` with `checked-out` keeps it, because the worktree in `worktree` has it checked out
  - `remote`: `present` means it is deleted on origin, `absent` that origin has none
- when `state` is `no-pr` and `loses` holds `commits`: "the commits on `<branch>` are on no other branch on origin and
  are lost."
- `<base>`, by `update.action`:
  - `fast-forward`: it moves to `origin/<base>`. When `update.worktree` is set, that worktree has it checked out, and
    `git merge --ff-only` moves it there, which refuses if it would overwrite a local change. Otherwise only the
    branch moves
  - `current`: it is up to date
  - `diverged`: it holds commits origin does not have, and it is left alone
  - `absent`: there is no local `<base>`, and nothing is created
  - `none`: the pull request did not merge, so `<base>` is not touched
- when `oldReports.names` is not empty: the reports in it are deleted from `<MAIN>/work-reports/`, because they have
  been there 14 days or more. List the names

```
AskUserQuestion: Clean up <name>?
  - Clean up
  - Do not clean up
```

When `loses` is not empty, the options are `Discard the work and clean up` and `Do not clean up` only, because
`worktree.sh cleanup` refuses such a run without `--discard`. On `Do not clean up`, stop and name `<WT>`, and say that
`git -C <WT> status` shows the work. The approval covers this run only.

## The cleanup

```bash
$CLEANUP/../workflow/scripts/worktree.sh cleanup <name>
```

When the user picked `Discard the work and clean up`, run this instead.

```bash
$CLEANUP/../workflow/scripts/worktree.sh cleanup <name> --discard
```

It acts as `check` said, from a fresh read. Act by `status`.

- **`stop`** with `discard`: work appeared after the question, and `loses` names it. Nothing was removed. Say so, and
  stop.
- **`stop`** with `open`, `unknown`, `gh` or `fetch-failed`: quote `message` and stop.
- **`done`**: go to the report.

## Report to the user

- the pull request's URL, when there is one
- `worktree.action`: `removed`, with each path in `worktree.moved`, or `pruned`
- `branch.local`: `deleted`, or kept with why. For `unpushed`, `git log <branch>` shows the commits
- `branch.remote`: `deleted`, or `absent` when origin had no branch left
- `update.action`, for `<base>`:
  - `updated`: from and to, as short SHAs, and where it moved
  - `current`: up to date
  - `diverged`: the local `<base>` has commits origin does not have. `git log origin/<base>..<base>` shows them, and
    the user decides
  - `not-updated`: the fast-forward refused. Quote its message from `errors`
  - `absent`: there is no local `<base>`
  - `none`: untouched, because the pull request did not merge
- `oldReports.deleted`, when it is not empty: the work reports deleted from `<MAIN>/work-reports/`
- each entry of `errors` with its `step` and `message`

## Rules

- At most one approval question, `Clean up <name>?`. The `Run` question comes before it and is not part of it.
- **Never remove uncommitted work, or commits that nothing else holds, unless the user picked `Discard the work and
  clean up`.**
- **Never switch a branch, stash, commit, reset or clean in `<MAIN>`.** `<base>` only ever fast-forwards.
- In `<MAIN>/work-reports/`, only real directories whose names start with a timestamp and that have been there 14
  days or more are deleted.
- Write nothing to GitHub yourself. `worktree.sh cleanup` deletes the run's branch on origin, and that is the only
  write.
