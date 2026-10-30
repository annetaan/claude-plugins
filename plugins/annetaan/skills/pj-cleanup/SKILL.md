---
name: pj-cleanup
description: Cleans up after the user has merged a project's pull request, the one pj4-running opened from the project's base branch. Closes the parent when it is still open, moves the work reports out of the project's worktree into the main working tree, removes the worktree, deletes the base branch on origin and locally, and fast-forwards the branch the project merged into, normally main, to origin. Asks one approval question. Use it only when the user names this skill or invokes /annetaan:pj-cleanup, because it closes an issue, deletes branches and removes a worktree.
---

# pj-cleanup

`pj-cleanup` is no stage of its own. It runs once a project is `merged`, after the user has merged the pull request
that `pj4-running` opened from the base branch into `<from>`, and tidies up what the project left behind: the open
parent, the worktree, the base branch, and a local `<from>` that is now behind origin.

The script `cleanup.sh` does the git work. **You close the parent and write nothing else to GitHub yourself.**

## Paths: `$CLEANUP`

**`$CLEANUP` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$CLEANUP` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for
the user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/pj4-running/scripts/run.sh` and not `<skills>/pj-cleanup/../pj4-running/scripts/run.sh`.

**Read these before anything else:**

- `$CLEANUP/../pj1-plan/between-skills.md`: **Principle**, **The base branch**, **Comments**, **Issues in a report**
- `$CLEANUP/../pj1-plan/state.md`: **When a project is merged**

This skill uses these files:

- the script `$CLEANUP/scripts/cleanup.sh`, written `cleanup.sh` below. Every subcommand prints one JSON object with
  a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message and stop
- the script `$CLEANUP/../pj4-running/scripts/run.sh`, written `run.sh` below, for its `close` only

**Language**: talk to the user in the user's language. Write the comment on the parent in the repository's language.

## Before you start

This skill closes an issue, deletes branches on origin and in the clone, and removes a worktree. **Start it only when
the user names it or invokes `/annetaan:pj-cleanup`.**

```bash
git rev-parse --show-toplevel
gh auth status
```

Either one failing stops the skill. Say which one and stop.

## The project

When a number was given, it is `<P>`. Otherwise list the projects that have a worktree in this clone.

```bash
$CLEANUP/scripts/cleanup.sh list
```

Each entry of `projects` is a worktree `.claude/worktrees/pj-<n>` with its parent's `number`, `title`, `state` and
`merged`, or an `error` when `project.sh` could not read it. The options are the entries whose `merged` is true.

- **One option**: take it and ask nothing. Say `#<P> <title> (the only candidate)`.
- **Several**: print every entry in one line, `#<n> <title> (merged)` or `#<n> <title> (not merged)`, then ask with
  the header `Project`, at most 4 options, the lowest number first and marked `(Recommended)`.
- **None**: print the entries, say that no project with a worktree here is merged, and stop. A project with no
  worktree is cleaned up by giving its number.

Print `project #<P>` once.

## The check

```bash
$CLEANUP/scripts/cleanup.sh check <P>
```

`check` fetches `<from>` and changes nothing else. Act by `status`.

- **`stop`**: act by `reason`.
  - `not-merged`: the project is not merged yet. Say so. When `projectPr` is set, give its URL: the user merges it,
    then runs `/annetaan:pj-cleanup <P>` again. Otherwise the project's pull request is not open yet, and the next
    step is `/annetaan:pj4-running <P>`. Stop.
  - `not-a-repo`, `project`, `fetch-failed`: quote `message` and stop.
- **`ok`**: keep `main` as `<MAIN>`, `worktree.path` as `<WT>`, `project.base` as `<base>`, `project.from` as
  `<from>`, and the rest for the question.

## The question

Show what the cleanup does, one line per item, from the `check` output.

- the project, `#<P> <title>`
- the parent: when `project.state` is `OPEN`, that it closes as completed with a comment. Otherwise that it is closed
  already
- the worktree, by `worktree.state`:
  - `clean`: the work reports in `reports` move to `<MAIN>/work-reports/`, then `<WT>` is removed
  - `dirty`: as `clean`, and the uncommitted work in `changes` is discarded. Show `changes`
  - `prunable`: its directory is gone, and only git's record of it is pruned
  - `absent`: there is none
  - `foreign`: `<WT>` is not a worktree of this clone, and nothing touches it
- the base branch on origin, when `remoteBase` is `present`: it is deleted
- the local base branch, by `localBase`: `delete` deletes it. `keep` with `unpushed` keeps it, because it holds commits
  neither `origin/<base>` nor `origin/<from>` has. `keep` with `checked-out` keeps it, because the worktree in
  `worktree` has it checked out. `null` means there is none
- `<from>`, by `update.action`:
  - `fast-forward`: it moves to `origin/<from>`. When `update.worktree` is set, that worktree has it checked out, and
    `git merge --ff-only` moves it there, which refuses if it would overwrite a local change. Otherwise only the
    branch moves
  - `current`: it is up to date
  - `diverged`: it holds commits origin does not have, and it is left alone
  - `absent`: there is no local `<from>`, and nothing is created

When `worktree.state` is `foreign`, stop instead of asking: say that `<WT>` is not a worktree of this clone, and that
nothing was changed.

```
AskUserQuestion: Clean up project #<P>?
  - Clean up
  - Do not clean up
```

When `worktree.state` is `dirty`, the first option is `Discard the work and clean up`. On `Do not clean up`, stop
and name `<WT>`, and say that `git -C <WT> status` shows the work. The approval covers this run only.

## The cleanup

1. **Close the parent**, only when `project.state` is `OPEN`. Run `mktemp -d` once. Its directory is `<TMP>`.
   Write `<TMP>/<P>-closed.md`. It starts with `**[pj-cleanup]**` and says that the base branch `<base>` is merged
   into `<from>`, that every sub-issue is closed, and that the base branch and the worktree are cleaned up. Then close
   the parent.

   ```bash
   $CLEANUP/../pj4-running/scripts/run.sh close <P> <P> --comment "<TMP>/<P>-closed.md"
   ```

   Keep `startable` for the report. `already` true means it was closed by then. A `not-due` means the project changed
   under the run: quote `message` and stop.
2. **Clean up the clone.**

   ```bash
   $CLEANUP/scripts/cleanup.sh run <P>
   ```

   When the user picked `Discard the work and clean up`, run this instead.

   ```bash
   $CLEANUP/scripts/cleanup.sh run <P> --discard
   ```

   It acts as `check` said, from a fresh read. Act by `status`.

   - **`stop`** with `dirty`: `<WT>` gained uncommitted work after the question. Nothing was removed. Say so, and stop.
   - **`stop`** with `foreign`, `not-merged`, `project` or `fetch-failed`: quote `message` and stop.
   - **`done`**: go to the report.

## Report to the user

- the parent's URL, and whether it closed now or was closed already
- `worktree.action`: `removed`, with each path in `worktree.moved`, `pruned`, or `none`
- `remoteBase`: `deleted`, or `absent` when origin had no base branch left
- `localBase.action`: `deleted`, or kept with why. For `unpushed`, `git log origin/<from>..<base>` shows the commits
- `update.action`, for `<from>`:
  - `updated`: from and to, as short SHAs, and where it moved
  - `current`: up to date
  - `diverged`: the local `<from>` has commits origin does not have. `git log origin/<from>..<from>` shows them, and
    the user decides
  - `not-updated`: the fast-forward refused. Quote its message from `errors`
  - `absent`: there is no local `<from>`
- each other entry of `errors` with its `step` and `message`
- the projects that can be split now, from `startable`, one line each as `/annetaan:pj2-issues <R>` with its title

## Rules

- At most one approval question, `Clean up project #<P>?`. The `Project` question comes before it and is not part of
  it.
- **Never remove a worktree with uncommitted work unless the user picked `Discard the work and clean up`.**
- **Never switch a branch, stash, commit, reset or clean in `<MAIN>`.** `<from>` only ever fast-forwards.
- **Close the parent only through `run.sh close`**, which refuses one that is not merged. Write nothing else to GitHub
  yourself. `cleanup.sh run` deletes the base branch on origin.
- Every comment starts with `**[pj-cleanup]**`.
