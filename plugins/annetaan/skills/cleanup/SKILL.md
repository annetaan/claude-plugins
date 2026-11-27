---
name: cleanup
description: Cleans up a merged pj project, a workflow run, or a level or pj-roadmap proposal. Takes an optional number, /annetaan:cleanup [<n>], where <n> is a pull request number or a project's parent number. For a run or a proposal, once its pull request is merged or closed, or after a run that stopped, moves the work reports out of the run's run-* or the proposal's propose-* worktree into the main working tree, removes the worktree, deletes its branch locally and on origin, and fast-forwards the local base branch when the pull request merged. For a merged project, closes its parent when it is still open, removes every pj-<P>-* worktree of the project after moving its work reports, deletes the project's base branch locally and on origin, and fast-forwards the branch the project merged into. Both delete the work reports in the main working tree beyond the 100 newest, by the time stamp in their name. Asks no question to confirm the cleanup: it asks which target only when several are ready or one has no pull request, and asks before it discards work that nothing else holds. Use it only when the user names this skill or invokes /annetaan:cleanup, because it closes an issue, deletes branches and removes worktrees.
---

# cleanup

`cleanup` is no step of the workflow. It runs after the user has merged or closed the pull request that `workflow`
opened, or after a run that stopped midway, and tidies up what the run left behind: the worktree
`.claude/worktrees/run-<stamp>`, the review seat worktrees beside it, the run's branch, and a local base branch that is now behind origin. It also runs after
the user has merged or closed the pull request that `pj-roadmap` or `level` opened, each of which works in a
`propose-<stamp>` worktree.

It also runs once a pj project is `merged`, after the user has merged the pull request that `pj4-running` opened from
the project's base branch `<base>` into `<from>`. It tidies up what the project left behind: the open parent, every
worktree `.claude/worktrees/pj-<P>-<k>-<stamp>` and `pj-<P>-sync-<stamp>` of the project with the review seats beside
them, the base branch, and a local `<from>` that is now behind origin. It is not one of the four pj skills.

The script `cleanup.sh` does the git work. **You write nothing to GitHub yourself, except the close of a project's
parent through `run.sh close`.**

## Paths: `$CLEANUP`

**`$CLEANUP` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$CLEANUP` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for
the user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/pj1-plan/between-skills.md` and not `<skills>/cleanup/../pj1-plan/between-skills.md`.

This skill uses these files:

- the script `$CLEANUP/scripts/cleanup.sh`, written `cleanup.sh` below. Every subcommand prints one JSON object with
  a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message and stop
- for a project target only, the script `$CLEANUP/../pj4-running/scripts/run.sh`, written `run.sh` below, for its
  `close` only

**For a project target, read these before you go on from the run:**

- `$CLEANUP/../pj1-plan/between-skills.md`: **Principle**, **The base branch**, **Picking the project**, **Comments**,
  **Issues in a report**
- `$CLEANUP/../pj1-plan/state.md`: **When a project is merged**

**Language**: talk to the user in the user's language. Write the comment on a parent in the repository's language.

**A URL you give the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no
bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it
bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything
touching the URL becomes part of the link and opens the wrong page (`$CLEANUP/../pj1-plan/between-skills.md`, **Issues
in a report**).

## Before you start

This skill closes an issue, deletes branches on origin and in the clone, and removes worktrees. **Start it only when
the user names it or invokes `/annetaan:cleanup`.**

```bash
git rev-parse --show-toplevel
gh auth status
```

Either one failing stops the skill. Say which one and stop.

## The run

```bash
$CLEANUP/scripts/cleanup.sh list
```

Each entry of `targets` is one of these, with its `name`, `kind`, `worktrees`, `branch`, `state` and `pr`:

- a worktree `.claude/worktrees/run-<stamp>` (`kind` `run`) or `.claude/worktrees/propose-<stamp>` (`kind`
  `propose`). `branch` is `null` when it is detached. `state` is `open`, `merged`, `closed`, `no-pr` or `error`
- a project (`kind` `project`), named `#<P>`, with `project.number` and `project.title`. `worktrees` holds every
  `pj-<P>-*` worktree of the project, `branch` is its base branch, and `pr` is its open pull request or null. `state`
  is `merged`, `not-merged` or `error`

`error` entries carry the `message`.

**When a number was given**, take the entry whose `pr.number` is that number, or the project target whose
`project.number` is that number.

- None: run `cleanup.sh check "#<n>"`. `unknown` means that no `run-*` or `propose-*` worktree holds pull request #<n>
  and #<n> is no project, so say that and stop. Otherwise it is project #<n>, which is cleaned whether or not it has a
  worktree here: go on to **The check** with it.
- `open`: the pull request is still open. Give its URL and stop.
- A `not-merged` project: as `not-merged` under **The check**.

**Otherwise** the candidates are the entries that are `merged`, `closed` or `no-pr`. An `open` or `not-merged` entry is
printed and never offered.

- **The project of this conversation**: before the rules below, rule 2 of **Picking the project** in
  `pj1-plan/between-skills.md` takes the project of this conversation when it is a `merged` project target. Say `#<P> <title>
  (the project of this conversation)`.
- **One candidate that is `merged` or `closed`**: take it and ask nothing. Say `<name> (the only candidate)`.
- **Several, or a `no-pr` one**: print every entry in one line, with its name, kind, branch, state and pull request
  number and title (for a project, its title), then ask with the header `Run`, ordered `merged`, then `closed`, then
  `no-pr`, the oldest first within each, and a project by its number among the `merged`. A `no-pr` worktree is
  cleaned up only when the user picks it here, and the question is asked even for one candidate, because a `no-pr`
  run may still be going in another session. Each `no-pr` option's description gives the time its stamp gives and
  says so.
  - With no `no-pr` entry, at most 4 options, and the first marked `(Recommended)`.
  - With a `no-pr` entry, `Do not clean up` is the last option and there are 4 options at most. The first `merged` or
    `closed` option is marked `(Recommended)`, and with none, `Do not clean up` is. On `Do not clean up`, stop.
- **None**: print the entries, say that no worktree or project is ready to be cleaned up, and stop. A project with no
  worktree is cleaned up by giving its number.

Print `project #<P>` once when a project is picked, and `run <name>` once when a run or a proposal is picked. The
target `<target>` below is `#<P>` for a project, and `<name>` otherwise. Keep it in double quotes, because bash reads an unquoted `#` as the start of a comment.

## The check

```bash
$CLEANUP/scripts/cleanup.sh check "<target>"
```

`check` fetches the base branch of a merged pull request, or a project's `<from>`, and changes nothing else. Act by
`status`.

- **`stop`**: act by `reason`.
  - `open`: the pull request is still open. Give `pr.url` and stop.
  - `not-merged`: the project is not merged yet. Say so. When `projectPr` is set, give its URL: the user merges it,
    then runs `/annetaan:cleanup <P>` again. Otherwise the project's pull request is not open yet, and the next step is
    `/annetaan:pj4-running <P>`. Stop.
  - `unknown`, `not-a-repo`, `gh`, `fetch-failed`: quote `message` and stop.
- **`ok`**: keep `main` as `<MAIN>`, `update.branch` as `<base>` for a run, or as `<from>` for a project, and the rest
  for the list. For a run, keep `worktrees[0].path` as `<WT>`. For a project, keep `parent.state`, and `branches[0].name`
  as the project's base branch.

## What it does

Show what the cleanup does, one line per item, from the `check` output.

- for a run: the pull request, `#<n> <title>` with its URL and `state`, or that the run opened none
  - `closed`: "PR #<n> was closed without a merge. Its work is lost with the branch; GitHub keeps only the commits on
    the closed pull request."
- for a project: `#<P> <title>`, and the parent: when `parent.state` is `OPEN`, that it closes as completed with a
  comment. Otherwise that it is closed already
- each worktree in `worktrees`, by its `state`:
  - `clean`: the work reports in `reports` move to `<MAIN>/work-reports/`, then the worktree at `path` is removed. A
    proposal has no work report, so `reports` is empty and nothing moves
  - `dirty`: as `clean`, and the uncommitted work in `changes` is discarded. Show `changes`
  - `prunable`: its directory is gone, and only git's record of it is pruned
- when `loses` holds `submodules`: each entry of a worktree's `submodules` is a submodule removed with that worktree
  that holds work of its own. Show its `path`, its `changes`, and `commits` as the number of commits no remote of the
  submodule has
- each branch in `branches` (empty for a run whose worktree is detached and has no branch):
  - `local`: `delete` deletes it. `keep` with `checked-out` keeps it, because another worktree has it checked out, and
    `git worktree list` shows which. `keep` with `unpushed` keeps it, because it holds commits that are nowhere they
    should be: for a run, commits the pull request's head does not have; for a project's base branch, commits neither
    `origin/<base>` nor `origin/<from>` has; for the branch a project's worktree has checked out (a run that stopped
    in its finish), commits no ref on origin has, which `git log <branch> --not --remotes` shows. The worktree is
    removed, and the kept branch keeps its commits and its copy on origin
  - `remote`: `present` means it is deleted on origin, except for a branch kept as `unpushed`, whose copy on origin
    stays; `absent` that origin has none
- for a run, when `pr` is null, `branches` is not empty and `loses` holds `commits`: "the commits on `<branch>` are on
  no other branch on origin and are lost."
- when a worktree is detached and `loses` holds `commits`: its detached HEAD holds commits that no ref on origin has,
  which is what a refused push, or a pj run that stopped, leaves. `git -C <path> log HEAD --not --remotes` shows them.
- `<base>` for a run, or `<from>` for a project, by `update.action`:
  - `fast-forward`: it moves to `origin/<branch>`. When `update.worktree` is set, that worktree has it checked out, and
    `git merge --ff-only` moves it there, which refuses if it would overwrite a local change. Otherwise only the
    branch moves
  - `current`: it is up to date
  - `diverged`: it holds commits origin does not have, and it is left alone
  - `absent`: there is no local branch, and nothing is created
  - `none`: the pull request did not merge, so no base branch is touched
- when `oldReports.names` is not empty: the reports in it are deleted from `<MAIN>/work-reports/`, because they are
  beyond the 100 newest, by the time stamp in their name, counting the reports this cleanup moves in. List the names

Print the list and go on to the cleanup. When `loses` is not empty, ask first, because `cleanup.sh run` refuses
such a target without `--discard`. For a project the header is `Discard the work in project #<P>?`, and the question
names each worktree that holds work.

```
AskUserQuestion: Discard the work in <name>?
  - Discard the work and clean up
  - Do not clean up
```

On `Do not clean up`, stop and name each worktree that holds work, and say that `git -C <path> status` shows the
uncommitted work, that `git -C <path> log HEAD --not --remotes` shows the commits on a detached HEAD, and that
`git -C <path>/<sub> log --branches --not --remotes` shows the commits of each submodule in its `submodules`. A
project's parent keeps its state and nothing is removed. The answer covers this run only.

## The cleanup

For a project, first **close the parent**, only when `parent.state` is `OPEN`. Run `mktemp -d` once. Its directory
is `<TMP>`. Write `<TMP>/<P>-closed.md`. It starts with `**[cleanup]**` and says that the base branch is merged into
`<from>`, that every sub-issue is closed, and that the base branch and the worktrees are cleaned up. Then close the
parent.

```bash
$CLEANUP/../pj4-running/scripts/run.sh close <P> <P> --comment "<TMP>/<P>-closed.md"
```

Keep `startable` for the report. `already` true means it was closed by then. A `not-due` means the project changed
under the run: quote `message` and stop.

Then clean up the clone.

```bash
$CLEANUP/scripts/cleanup.sh run "<target>"
```

When the user picked `Discard the work and clean up`, run this instead.

```bash
$CLEANUP/scripts/cleanup.sh run "<target>" --discard
```

It acts as `check` said, from a fresh read. Act by `status`.

- **`stop`** with `discard`: work appeared after the list was printed, and `loses` names it. Nothing was removed. Say so, and
  stop.
- **`stop`** with `open`, `not-merged`, `unknown`, `gh` or `fetch-failed`: quote `message` and stop.
- **`done`**: go to the report.

## Report to the user

- for a run, the pull request's URL, when there is one
- for a project, the parent's URL, and whether it closed now or was closed already
- each entry of `worktrees`: `removed`, with each path in its `moved`, or `pruned`
- each entry of `branches`:
  - `local`: `deleted`, or `kept` with why. For `unpushed`, `git log <branch> --not --remotes` shows the commits no
    ref on origin has, and for a run, `git log origin/<base>..<branch>` shows the commits the merged base lacks,
    which holds them even when the copy on origin has them too
  - `remote`: `deleted`; `kept`, a branch kept as `unpushed` whose copy on origin stays, so the commits it pushed can
    still be seen there; `absent` when origin had no branch left; or `present` when the delete on origin failed, with
    its `errors` entry
- `update.action`, for `<base>` of a run or `<from>` of a project:
  - `updated`: `from` and `to`, as short SHAs, and where it moved
  - `current`: up to date
  - `diverged`: the local branch has commits origin does not have. `git log origin/<branch>..<branch>` shows them,
    and the user decides
  - `not-updated`: the fast-forward refused. Quote its message from `errors`
  - `absent`: there is no local branch
  - `none`: untouched, because the pull request did not merge
- `oldReports.deleted`, when it is not empty: the work reports deleted from `<MAIN>/work-reports/`
- each entry of `errors` with its `step` and `message`
- for a project, the projects that can be split now, from the `startable` of `run.sh close`, or of `cleanup.sh run`
  when the parent was closed already, one line each as `/annetaan:pj2-issues <R>` with its title

## Rules

- No question to confirm the cleanup. `Run`, the `Project` question of **Picking the project**, and `Discard the work
  in <name>?` (`Discard the work in project #<P>?`) are the only questions, the last only when `loses` is not empty.
- **Never remove uncommitted work, commits that nothing else holds, or what a submodule holds on its own, unless
  the user picked `Discard the work and clean up`.**
- **Never switch a branch, stash, commit, reset or clean in `<MAIN>`.** `<base>` and `<from>` only ever fast-forward.
- In `<MAIN>/work-reports/`, only real directories whose names start with a time stamp, and only those beyond the 100
  newest by that stamp, are deleted.
- **Close a project's parent only through `run.sh close`**, which refuses one that is not merged. Write nothing else
  to GitHub yourself. `cleanup.sh run` deletes the branches on origin, except the copy of a branch it keeps as
  `unpushed`.
- Every comment starts with `**[cleanup]**`.
