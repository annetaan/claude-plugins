---
name: cleanup
description: Cleans up a workflow run, or a level or pj-roadmap proposal, once its pull request is merged or closed, or after a run that stopped. Takes an optional pull request number, /annetaan:cleanup [<n>]. Moves the work reports out of the run's run-* or the proposal's propose-* worktree into the main working tree, removes the worktree, deletes its branch locally and on origin, fast-forwards the local base branch when the pull request merged, and deletes the work reports in the main working tree beyond the 100 newest, by the time stamp in their name. Asks no question to confirm the cleanup: it asks which worktree only when several are ready or one has no pull request, and asks before it discards work that nothing else holds. Use it only when the user names this skill or invokes /annetaan:cleanup, because it deletes branches and removes a worktree.
---

# cleanup

`cleanup` is no step of the workflow. It runs after the user has merged or closed the pull request that `workflow`
opened, or after a run that stopped midway, and tidies up what the run left behind: the worktree
`.claude/worktrees/run-<stamp>`, the review seat worktrees beside it, the run's branch, and a local base branch that is now behind origin. It also runs after
the user has merged or closed the pull request that `pj-roadmap` or `level` opened, each of which works in a
`propose-<stamp>` worktree.

The script `cleanup.sh` does the git work. **You write nothing to GitHub yourself.**

## Paths: `$CLEANUP`

**`$CLEANUP` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$CLEANUP` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for
the user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/pj1-plan/between-skills.md` and not `<skills>/cleanup/../pj1-plan/between-skills.md`.

This skill uses one file: the script `$CLEANUP/scripts/cleanup.sh`, written `cleanup.sh` below. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop.

**Language**: talk to the user in the user's language.

**A URL you give the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no
bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it
bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything
touching the URL becomes part of the link and opens the wrong page (`$CLEANUP/../pj1-plan/between-skills.md`, **Issues
in a report**).

## Before you start

This skill deletes branches on origin and in the clone, and removes a worktree. **Start it only when the user names it
or invokes `/annetaan:cleanup`.**

```bash
git rev-parse --show-toplevel
gh auth status
```

Either one failing stops the skill. Say which one and stop.

## The run

```bash
$CLEANUP/scripts/cleanup.sh list
```

Each entry of `targets` is a worktree `.claude/worktrees/run-<stamp>` (`kind` `run`) or
`.claude/worktrees/propose-<stamp>` (`kind` `propose`) with its `name`, `branch` (`null` when detached), `state` and
`pr`. `state` is `open`, `merged`, `closed`, `no-pr` or `error`, and `error` entries carry the `message`.

**When a pull request number was given**, take the entry whose `pr.number` is that number.

- None: say that no `run-*` or `propose-*` worktree holds pull request #<n>, and stop.
- `open`: the pull request is still open. Give its URL and stop.

**Otherwise** the candidates are the entries that are `merged`, `closed` or `no-pr`. An `open` entry is printed and
never offered.

- **One candidate that is `merged` or `closed`**: take it and ask nothing. Say `<name> (the only candidate)`.
- **Several, or a `no-pr` one**: print every entry in one line, with its name, kind, branch, state and pull request
  number and title, then ask with the header `Run`, ordered `merged`, then `closed`, then `no-pr`, the oldest first
  within each. A `no-pr` worktree is cleaned up only when the user picks it here, and the question is asked even for
  one candidate, because a `no-pr` run may still be going in another session. Each `no-pr` option's description gives
  the time its stamp gives and says so.
  - With no `no-pr` entry, at most 4 options, and the first marked `(Recommended)`.
  - With a `no-pr` entry, `Do not clean up` is the last option and there are 4 options at most. The first `merged` or
    `closed` option is marked `(Recommended)`, and with none, `Do not clean up` is. On `Do not clean up`, stop.
- **None**: print the entries, say that no worktree is ready to be cleaned up, and stop.

Print `run <name>` once.

## The check

```bash
$CLEANUP/scripts/cleanup.sh check <name>
```

`check` fetches the base branch of a merged pull request and changes nothing else. Act by `status`.

- **`stop`**: act by `reason`.
  - `open`: the pull request is still open. Give `pr.url` and stop.
  - `unknown`, `not-a-repo`, `gh`, `fetch-failed`: quote `message` and stop.
- **`ok`**: keep `main` as `<MAIN>`, `worktrees[0].path` as `<WT>`, `update.branch` as `<base>`, and the rest for the
  list.

## What it does

Show what the cleanup does, one line per item, from the `check` output.

- the pull request: `#<n> <title>` with its URL and `state`, or that the run opened none
  - `closed`: "PR #<n> was closed without a merge. Its work is lost with the branch; GitHub keeps only the commits on
    the closed pull request."
- the worktree, by `worktrees[0].state`:
  - `clean`: the work reports in `reports` move to `<MAIN>/work-reports/`, then `<WT>` is removed. A proposal has no
    work report, so `reports` is empty and nothing moves
  - `dirty`: as `clean`, and the uncommitted work in `changes` is discarded. Show `changes`
  - `prunable`: its directory is gone, and only git's record of it is pruned
- when `loses` holds `submodules`: each entry of `worktrees[0].submodules` is a submodule removed with `<WT>` that
  holds work of its own. Show its `path`, its `changes`, and `commits` as the number of commits no remote of the
  submodule has
- the branch, from `branches[0]` (`branches` is empty when the worktree is detached and there is no branch):
  - `local`: `delete` deletes it. `keep` with `unpushed` keeps it, because it holds commits the pull request's head
    does not have. `keep` with `checked-out` keeps it, because another worktree has it checked out, and
    `git worktree list` shows which
  - `remote`: `present` means it is deleted on origin, `absent` that origin has none
- when `pr` is null, `branches` is not empty and `loses` holds `commits`: "the commits on `<branch>` are on no other
  branch on origin and are lost."
- when `branches` is empty and `loses` holds `commits`: the detached HEAD of `<WT>` holds commits that no branch on
  origin has, which is what a refused push leaves. `git -C <WT> log HEAD --not --remotes` shows them.
- `<base>`, by `update.action`:
  - `fast-forward`: it moves to `origin/<base>`. When `update.worktree` is set, that worktree has it checked out, and
    `git merge --ff-only` moves it there, which refuses if it would overwrite a local change. Otherwise only the
    branch moves
  - `current`: it is up to date
  - `diverged`: it holds commits origin does not have, and it is left alone
  - `absent`: there is no local `<base>`, and nothing is created
  - `none`: the pull request did not merge, so no base branch is touched
- when `oldReports.names` is not empty: the reports in it are deleted from `<MAIN>/work-reports/`, because they are
  beyond the 100 newest, by the time stamp in their name, counting the reports this cleanup moves in. List the names

Print the list and go on to the cleanup. When `loses` is not empty, ask first, because `cleanup.sh run` refuses
such a worktree without `--discard`.

```
AskUserQuestion: Discard the work in <name>?
  - Discard the work and clean up
  - Do not clean up
```

On `Do not clean up`, stop and name `<WT>`, and say that `git -C <WT> status` shows the uncommitted work, and that
`git -C <WT>/<path> log --branches --not --remotes` shows the commits of each submodule in
`worktrees[0].submodules`. The answer covers this run only.

## The cleanup

```bash
$CLEANUP/scripts/cleanup.sh run <name>
```

When the user picked `Discard the work and clean up`, run this instead.

```bash
$CLEANUP/scripts/cleanup.sh run <name> --discard
```

It acts as `check` said, from a fresh read. Act by `status`.

- **`stop`** with `discard`: work appeared after the list was printed, and `loses` names it. Nothing was removed. Say so, and
  stop.
- **`stop`** with `open`, `unknown`, `gh` or `fetch-failed`: quote `message` and stop.
- **`done`**: go to the report.

## Report to the user

- the pull request's URL, when there is one
- `worktrees[0].action`: `removed`, with each path in `worktrees[0].moved`, or `pruned`
- `branches[0].local`: `deleted`, or `kept` with why. For `unpushed`, `git log <branch>` shows the commits
- `branches[0].remote`: `deleted`, or `absent` when origin had no branch left
- `update.action`, for `<base>`:
  - `updated`: `from` and `to`, as short SHAs, and where it moved
  - `current`: up to date
  - `diverged`: the local `<base>` has commits origin does not have. `git log origin/<base>..<base>` shows them, and
    the user decides
  - `not-updated`: the fast-forward refused. Quote its message from `errors`
  - `absent`: there is no local `<base>`
  - `none`: untouched, because the pull request did not merge
- `oldReports.deleted`, when it is not empty: the work reports deleted from `<MAIN>/work-reports/`
- each entry of `errors` with its `step` and `message`

## Rules

- No question to confirm the cleanup. `Run` and `Discard the work in <name>?` are the only questions, the second only when `loses` is not empty.
- **Never remove uncommitted work, commits that nothing else holds, or what a submodule holds on its own, unless
  the user picked `Discard the work and clean up`.**
- **Never switch a branch, stash, commit, reset or clean in `<MAIN>`.** `<base>` only ever fast-forwards.
- In `<MAIN>/work-reports/`, only real directories whose names start with a time stamp, and only those beyond the 100
  newest by that stamp, are deleted.
- Write nothing to GitHub yourself. `cleanup.sh run` deletes the branch on origin, and that is the only write.
