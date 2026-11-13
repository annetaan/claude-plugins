---
name: pj4-running
description: Takes the project from a number given, a sub-issue's number naming its parent, or the only project with sub-issues, and otherwise asks which project to work on. Creates the project's base branch on its first start, once every project it waits on is merged, and closes the parent of a merged project and names the projects that can be split now, as /annetaan:pj2-issues <P>. Works down the run order in the parent's Order list one sub-issue at a time, and stops at the first issue that is not workable. Each one runs through the workflow skill as one task with review rounds, then pj4-running merges its pull request into the project's base branch and closes the issue itself before the next starts. Once every sub-issue is closed, merges the branch the base branch was made from into it, with the workflow skill resolving any conflict, then opens the pull request from the base branch into that branch, and leaves its merge to the user. Works in a git worktree of its own, so the main working tree stays free for the user. Files unplanned work as stub issues and stops on a blocker. The fourth of four skills, after pj1-plan, pj2-issues and pj3-doctor. Run it again on a project whose pull request is open to resolve that pull request's conflicts: it brings the source branch in again under review. Use it only when the user names this skill or invokes /annetaan:pj4-running, when the user asks to resolve the conflicts of a project's pull request (from `pj/<n>`), or when the workflow skill hands such a request over, because it creates branches, pushes, opens and merges pull requests, and edits issues and labels.
---

# pj4-running

The fourth of the four pj skills: it works down a project's run order, the parent's `## Order`, and merges one pull
request per sub-issue. Once every sub-issue is closed, it merges `<from>` into the base branch and opens the project's
pull request, from the base branch into `<from>`, and the user merges it.

You are the main session. **You do not write code.** workflow's sessions implement and review. You own the branch,
the merge, the issues, the labels and the notices.

**The run works in a worktree of its own.** Two paths matter.

- **`<MAIN>`** is the main working tree, the user's. It is the path on the first `worktree` line of
  `git worktree list --porcelain`. `git rev-parse --show-toplevel` would print the worktree you are in, which is
  wrong when the skill starts from another worktree.
- **`<WT>`** is `<MAIN>/.claude/worktrees/pj-<P>`, the run's worktree. There is one per project, and it stays
  across runs.

The user keeps working in `<MAIN>` while the run goes on. The run never switches, stashes, commits or cleans there.

## Paths: `$RUNNING`

**`$RUNNING` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$RUNNING` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$RUNNING` finds
them nothing.
Collapse the `..` in a path to a sibling skill, so that the command text names `<skills>/pj1-plan/scripts/project.sh` and not
`<skills>/pj4-running/../pj1-plan/scripts/project.sh`. A permission rule matches the text of the command, and the rules
`pj-auto` shows name the collapsed path. This holds in the prompts for sub-agents too.

**Read `$RUNNING/../pj1-plan/between-skills.md` and `$RUNNING/../pj1-plan/state.md` before anything else.**
`between-skills.md` holds the labels, the base branch, the handover comment, the blockers, the comments and the pull
requests. Its table of the four skills says where this one sits. `state.md` is how `project.sh` reads a project and
when an issue is ready and workable. Everything below refers to them. `$RUNNING/../pj1-plan/format.md` describes the
issues and their bodies, and is read only at the sections this file names: **The run order**, **Stubs**, **Fixed
tokens** and **Writing bodies**.

This skill uses three more things:

- the script `$RUNNING/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the script `$RUNNING/scripts/run.sh`, written `run.sh` below. Every subcommand prints one JSON object with a
  `status`. A `stop` whose `reason` the section at hand does not name, such as `project` when `project.sh` fails,
  stops the run: quote `message`. A non-zero exit is a usage error or an unexpected failure: quote its message and
  stop the run
- the `workflow` skill, loaded with the Skill tool as `annetaan:workflow` (see **Before workflow runs**)

Parts of this skill live in files next to this one, named by their bare name from here on: `$RUNNING/issues.md` (phases 1 to 5) and `$RUNNING/project-pr.md` (**The project's pull request**). Phase 6 is in this file.

**Language**: talk to the user in the user's language. Write issue, comment and pull request text in the repository's
language (`format.md`, **Writing bodies**). The tokens in (`format.md`, **Fixed tokens**) stay in English.

## Before you start

This skill creates branches, pushes, opens and merges pull requests, and edits issues and labels. **Start it only when the user names it or invokes `/annetaan:pj4-running`, asks to resolve the conflicts of a project's pull request, or workflow's From a pull request hands one over.**

**A conflict in the project's pull request** that appears after it was opened, because `<from>` moved, is resolved by
a run like any other: every sub-issue is closed, so `start` returns `done`, and phase 6 brings `<from>` in again under
review, pushes the merge to `<base>`, and finds the pull request `exists`. The request to resolve it is the
invocation, and the run asks nothing.

**The project.** Pick it as `between-skills.md` says under **Picking the project**. The project picked is `<P>`. In an unattended run, only rule 1 of **Picking the project** applies (`between-skills.md`, **Unattended runs**). Print
`project #<P>` once, with ` unattended` after it in an unattended run, so that a context summary can find both again. A number given picks the project, a sub-issue's number its parent, and the run still covers
the whole order of the project picked.

When the args carry `tmp=<dir>`, `$TMP` below is that directory. Otherwise run `mktemp -d` once and use the
directory it printed. Print `tmp <dir>` once, so that a context summary can find it again. The start may already
write comment files there. A shell variable does not outlive one command, so write the path in full each time.

Then check everything the run needs.

```bash
$RUNNING/scripts/run.sh start <P>
```

`start` checks the clone, `gh` and the repository, and reads the project with `project.sh`. It creates the base
branch from the tip of `<from>` when the base branch is missing and every project `<P>` waits on is merged, as
`between-skills.md` says under **The base branch**. Then it fetches the base branch and reads the rules on it.

**First close each parent in `close`**, as **Closing a merged project** says, whatever the status. Then act by
`status`.

- **`stop`**: act by `reason`.
  - `not-a-repo`, `no-origin`, `gh` (not installed, or older than 2.94.0), `gh-auth`, `issues-off`, `permission`
    (`viewerPermission` other than `WRITE`, `MAINTAIN` or `ADMIN`), `project` (`project.sh` failed, for example with
    `has no Base: line`), `create-failed`, `fetch-failed` and `no-merge-method`: say which check failed, quote
    `message`, and stop.
  - `base-gone`: the base branch is gone from origin, and a sub-issue's pull request into it has merged. It may
    already have been merged into `<from>` and deleted. Stop.
  - `waits`: the base branch is missing, and a project `<P>` waits on is not merged. Stop and list each entry of
    `waits` as `#<Q> <title>`. One whose `state` is `CLOSED` was closed as not planned, without a merge: remove the
    relationship `#<P> blocked by #<Q>` with `/annetaan:pj3-doctor`. One whose `state` is `OPEN` has to be merged
    first: `/annetaan:pj2-issues <Q>` when it has no sub-issue yet, then `/annetaan:pj3-doctor` and
    `/annetaan:pj4-running` on it, and its base branch, `base`, merged into `<from>` through its pull request.
  - `self-merge`: pj4-running merges its own pull requests, so a rule on the base branch that wants another
    person's review stops it. Name each code in `blockedBy` in words, and stop.
    - `rule-approvals`: a ruleset wants approving reviews.
    - `rule-code-owners`: a ruleset wants a code owner's review, and a CODEOWNERS file exists.
    - `merge-queue`: a ruleset sends merges through a merge queue.
    - `classic-approvals`: classic branch protection wants approving reviews.
    - `classic-code-owners`: classic branch protection wants a code owner's review, and a CODEOWNERS file exists.
- **`empty`**: the project has no sub-issue yet. It has not been split. Give the next step,
  `/annetaan:pj2-issues <P>`, and end.
- **`done`**: every sub-issue is closed. When `project.merged` is true, `close` held `<P>`. Report its close, and
  end. Otherwise keep the values as for `run`, take **The worktree** and **Paths this clone must ignore**, and go
  straight to phase 6, which brings `<from>` in and opens the project's pull request.
- **`run`**: keep `main` as `<MAIN>`, `worktree` as `<WT>`, `project.base` as `<base>`, `project.from` as `<from>`,
  and keep `created` and `rules`. When `created` is not null, this run created the base branch. Print
  `<base> created from <from> at <short sha>`, and keep the SHA for phase 3. Go through the rest of this section, then take **The worktree** and **Paths this clone must ignore**, then read `issues.md` and follow it from phase 1.

When `rules.selfMerge` is `unknown`, the rules on the base branch could not be read. The rules call failed, or the
branch is protected and reading its classic protection needs admin rights. Ask once.

```
AskUserQuestion: Can a pull request be merged here with no approving review?
  - Go on
  - Stop
```

On Stop, stop the run. An unattended run does not ask: it treats this as Stop and ends as needs-user.

`rules.requiredChecks` says whether the base branch requires status checks: `yes`, `no` or `unknown`. The merge in
**When workflow returns** in `issues.md` waits by it. With `unknown` the merge waits for a required check as with `yes`, and merges
when none registers, because GitHub still refuses a merge that a required check blocks. `rules.mergeMethod` is the
merge method, the first of squash, merge and rebase that the repository and the rules on the base branch allow.

A dirty `<MAIN>` does not stop the run. The run never works in it.

A `gh` older than 2.99.0 does not stop the run. `attach` is false then, and workflow falls back for the screenshots.

Every stop here comes before the worktree is entered.

`start` fetched the base branch into `origin/<base>`. The fetch moves the remote-tracking ref and nothing else. The run
builds on `origin/<base>` and never checks out a local `<base>`, so the user may have `<base>` checked out in `<MAIN>`.

### Closing a merged project

`start` lists in `close` the parents to close: `<P>` itself once it is merged, with `self` true, and each open
project `<P>` waits on that is merged. `<Q>` below is one of them. **A parent closes only through `run.sh close`,
which refuses one that `project.sh` does not read as `merged`, and closes it as completed.**

Write `$TMP/<Q>-closed.md`. It starts with `**[pj4-running]**` and says that the project's base branch, the entry's
`base`, is merged into the branch it was made from and that every sub-issue is closed. For a project `<P>` waits on,
the comment adds that `#<P>`, which waits on it, starts now. Then post it and close the parent.

```bash
$RUNNING/scripts/run.sh close <P> <Q> --comment "$TMP/<Q>-closed.md"
```

`already` true means the parent was closed by then and nothing was posted. Report a `not-due` after `start` and stop.

`startable` in the output lists the projects that wait on `<Q>`, have no sub-issue, and now wait on nothing unmerged,
each as `number` and `title`. Keep them for the report. `already` true still carries `startable`.

### The worktree

Put `<WT>` on the tip of the base branch.

```bash
$RUNNING/scripts/run.sh worktree <P>
```

It fetches the base branch again. It creates `<WT>`, moves a clean one onto `origin/<base>`, or prunes and recreates
one whose directory is gone. `action` says which. Before any of that it reads the parent's assignees, assigns the
user when nobody is assigned, and stops when someone else is. Act by `status`.

- **`ready`**: enter it. On every `worktree` output that carries `assignee` (the assignment is made before any
  later stop), print `#<P> assigned to <assignee.login>` when `assignee.added` is true. The second call after a
  `not-ignored` stop has `added` false, so it is printed once. `action` `discarded` means an earlier run left uncommitted work in `<WT>` (a run that ended
  without saving it, work a save left behind, or a stopped merge of `<from>`). `worktree` saved it to
  `<WT>/work-reports/<stamp>-discarded/stopped.diff`, reset and cleaned `<WT>`, and moved it onto the base. Nothing
  was asked, because of **One session per project** in the Rules. `saved` carries `file`, `head`, `changes` and
  `merge`. Print one line, `saved and discarded the work left in <WT>: <file>`, and keep `saved` for the report.
- **`stop`** with `foreign`: `<WT>` exists but is not a worktree of this repository, and nothing here may touch it.
  Stop. With `fetch-failed`, quote `message` and stop. With `assign-failed`, quote `message`, say which `step` failed
  (`login`, `read` or `add`), and stop.
- **`stop`** with `assigned`: `assignees` names the people assigned to `#<P>` besides the user. The project belongs to
  someone else, and pj4-running does not take a parent assigned to another person. Name the logins and stop. Once
  that person no longer works on it, removing them from `#<P>`'s Assignees lets the next run take it. When `self` is
  true, the user is assigned too, so two people started at once, and a human decides who stays. The user's own
  assignment stays either way, and removing it is a human's call.
- **`stop`** with `not-ignored`: `<WT>` holds uncommitted work, but `work-reports/` is not ignored in it, so the work
  cannot be saved without changing it. Nothing was changed. Take **Paths this clone must ignore** now, which asks the
  ignore question as usual, then run `worktree` again. When the user stops there, the run stops, and the report says
  that `git -C <WT> diff` shows the work.
- **`stop`** with `not-clean`: the work was saved (`saved`), but `<WT>` is not clean afterwards. `left` lists what
  stays, such as a nested git repository, and `errors` the reset or clean that failed. Quote `message`, name `<WT>`
  and `saved.file`, and stop the run. The user clears `left`, and the next run goes on.

**Then enter it, once.**

```
EnterWorktree(path: "<WT>")
```

Where that tool is not available, `cd "<WT>"`. A Bash `cd` moves this session only. workflow tells its sub-sessions
to enter `<WT>` themselves, because their directory resets on every bash call.

**Every command from here to the end of the run runs in `<WT>`.** After a context summary, run
`git rev-parse --show-toplevel`, and enter `<WT>` again when it prints anything else. Between tasks `<WT>` holds a
detached HEAD. A stop from here on, even one before the approval, leaves `<WT>` as phase 6 step 2 says.

`<WT>` has none of `<MAIN>`'s ignored files, such as installed dependencies or a `.env`. The first worker prepares
what the tests need and leaves the steps in the handover notes, so later tasks find them there. The submodules of `<WT>` are not initialized either. When the build or the tests need one, the first worker runs `git submodule update --init` in `<WT>` and leaves that in the handover notes too.

### Paths this clone must ignore

Two paths must stay out of git, and pj4-running checks both here, once, because a run from an issue never asks.

- `.claude/worktrees/` in `<MAIN>`, or the user sees `<WT>` as an untracked directory
- `work-reports/` in `<WT>`, where workflow writes its reports

```bash
$RUNNING/scripts/run.sh ignore <P>
```

Act by `status`.

- **`ok`**: go on.
- **`ask`**: ask once, naming the paths in `notIgnored`.

  ```
  AskUserQuestion: These paths are not ignored in this repository: <paths>. pj4-running works in .claude/worktrees/ and workflow writes its reports to work-reports/.
    - Ignore them in this clone (Recommended) - adds them to .git/info/exclude and commits nothing
    - Stop
  ```

  On the first answer, run `$RUNNING/scripts/run.sh ignore <P> --add`. It appends each path to the exclude file git
  resolves, which every worktree of the clone shares, and checks again. Act on what it prints as here. An unattended
  run does not ask: it treats this as Stop and ends as needs-user.
- **`stop`** with `still-not-ignored`: a `.gitignore` rule, such as `!work-reports/`, overrides the exclude file for
  the paths in `notIgnored`. Say so, and stop.

**Never edit `.gitignore` here.** That commit would land on the base branch with no pull request.

On a stop, leave `<WT>` as phase 6 step 2 says and end the run. `<WT>` stays in place, and the report says that
`git -C "<MAIN>" worktree remove <WT>` removes it. In a repository with submodules git refuses that command and it needs `--force`, which also deletes what a submodule in `<WT>` holds on its own; `git -C <WT>/<path> log --branches --not --remotes` shows such commits. When `worktree` stopped on `not-ignored`, `<WT>` holds
uncommitted work, so the report names that work with `git -C <WT> diff` in place of the `worktree remove` line.

## Unplanned work

workflow hands over to this section by name. An `Unplanned:` report marked `later` arrives while the task goes on.

1. Write `$TMP/stub-<j>.md` in the shape of `format.md` **Stubs**. Its `## Goal` holds what was found, why it matters,
   and "found while working on #<k>".
2. File it with no label and no edges. pj3-doctor sets the edges and places it in the run order when it has it
   drawn.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/stub-<j>.md"
   ```

3. Tell the user in one line, and keep the number for the report.

## Folding the handover lines

Fold the handover lines into the notes. Merge duplicates, keep fifteen lines at most, and drop the oldest
first. Rewrite the parent's handover comment as `between-skills.md` says under "The handover comment": read
its `updated_at` again first, and keep any change a human made since. Create it when there is none.

## Before workflow runs

Take this with an entry name, `<entry>`, which is `From an issue` or `From a sync`, before that entry runs. Take it every time, never only when the notes are empty.

1. Load workflow.

   ```
   Skill(skill: "annetaan:workflow", args: "<entry>, driven by pj4-running")
   ```

   Follow that entry's file in the workflow skill, `from-issue.md` or `from-sync.md`. **Load it again, and read the entry file again, when a context summary has dropped it.**
2. Read the handover comment with the command in `between-skills.md` under "The handover comment". Keep its lines
   as the handover notes. With no comment, the notes are empty. Every fold writes the notes back to the comment, so
   reading it again loses nothing and picks up a human's edit.

## Phase 6: end of the run

Every way the run ends comes here: the run order is done, the run stopped, or the user said stop.

1. `project.sh <P>`. **When every sub-issue is closed** and the project is not `merged`, bring `<from>` in and open
   the project's pull request: read `project-pr.md` and run **The project's pull request**, then come back to step 2. Ask nothing, because the approval in phase 3,
   or for `start`'s `done` the invocation itself, covered it. Skip this step when the run stopped before
   **The worktree** was entered.
2. Leave `<WT>`, only when this session entered it in **The worktree**. A stop before that point, such as a base
   branch gone from origin, a base branch that cannot be created, or `worktree` stopping on `not-ignored` or
   `not-clean`, skips this step. `<WT>` stays for the next
   run. The detach frees the branch for `<MAIN>`, and it works on a dirty tree too. Keep the `-C`, so the command
   cannot reach `<MAIN>` even after a context summary has lost the directory.

   ```bash
   git -C "<WT>" switch --detach
   ```

   Skip that command when a stopped **Bringing `<from>` in** in `project-pr.md` left a merge in progress: git refuses to switch then, and
   the HEAD is detached already.

   ```
   ExitWorktree(action: "keep")
   ```

   A worktree entered by path is never deleted by `ExitWorktree`. Where that tool is not available, `cd "<MAIN>"`.

## Report to the user

- the base branch `<base>`, and whether this run created it
- how `<from>` came into `<base>`: already in, merged as `<sha>`, or merged as `<sha>` after workflow resolved the
  conflicts in the files it names, or why it did not
- the project's pull request with its URL, when there is one, and that merging it is the user's job
- the parents closed in this run
- the projects that can be split now, collected from the `startable` of each close, one line each as
  `/annetaan:pj2-issues <R>` with its title
- the worktree `<WT>`. The next run reuses it. The work reports live only under its `work-reports/`.
  `/annetaan:pj-cleanup <P>` moves them into `<MAIN>` and removes `<WT>` once the project is merged
- that this run assigned `#<P>` to `<login>`, when `assignee.added` was true, and that the assignment stays
- each merged issue with the URL of its pull request
- the stubs filed, the `later` ones and the `blocker` ones
- where the run stopped and why, or that the run order is done
- **the saved work, when `save` printed `saved`.** Give the path of `file`. `git -C <WT> apply <file>` brings it back
  on `<head>`. Say plainly that the next run never uses it because the work gets redone. Add `left` and `errors`
  when they are not empty
- **the work `worktree` saved at the start, when `saved` was not null.** Give the path of `saved.file`.
  `git -C <WT> apply <file>` on `saved.head` brings it back. When `saved.merge` is set, it was a merge of `<from>` in
  progress at that commit. Say plainly that the next run never uses it because the work gets redone
- **the uncommitted work still in `<WT>`, when there is some** (a non-empty `left`, a `save` that failed, a stopped
  merge of `<from>`). `git -C <WT> diff` shows it. Say plainly that the next run saves it to
  `<stamp>-discarded/stopped.diff` and discards it, and that the next run never uses it because the work gets redone
- the screenshots that could not be attached, with their paths and the URL of the pull request
- what is workable now and what is waiting
- the next step: `/annetaan:pj3-doctor` when a `blocker` or a stub exists, otherwise `/annetaan:pj4-running`.
  When every sub-issue is closed, the user merges the project's pull request, then runs `/annetaan:pj-cleanup <P>`,
  which closes the parent, removes `<WT>` and the base branch, and brings the local `<from>` up to date. When the list of projects that can be split now is not empty, `/annetaan:pj2-issues <R>` for
  each.

## Ending an unattended run

An unattended run prints its last line as `between-skills.md` says under **Unattended runs**. These endings are
`unattended: done`:

- `start` returned `empty`.
- `start` returned `stop` with `waits`. The projects waited on are readable on GitHub.
- `start` returned `done` with `project.merged` true, and `close` closed `<P>` or found it `already` closed.
- `start` returned `done` and **The project's pull request** in `project-pr.md` came to `opened` or `exists`.
- Phase 1's run order was empty, including when `orderCheck` is not ok and no issue has a merged pull request.
- Phase 2 marked the issue that failed `--check` and stopped.
- Phase 5 step 1 stopped because a human had removed `ready`.
- Phase 5 step 2 marked the issue that failed `--check` and stopped.
- **When workflow returns** in `issues.md` got `stopped` with the reason `blocking` or `diverged`, and either no `<WORKDIR>` was
  set, or `save` printed `clean`, or it printed `saved` with an empty `left` and an empty `errors`. With any other
  `save` output, the next step would stop on `not-clean`, so it is needs-user below.
- The run order was worked to the end, and phase 6's project pull request came to `opened` or `exists`, or not every
  sub-issue is closed yet.

Every other ending is `unattended: needs-user <one line>`. An ending not on this list is needs-user, so a stop this
section does not name never reads as done.

## Rules

- **You never write code.** workflow's sessions do.
- **One session per project.** A person never runs two sessions on the same project at once: two pj4-running runs, or
  a run beside a pj-auto drive. The parent's assignee keeps a different person off the project, not the same
  person's second session, because both use one GitHub account. So a dirty `<WT>` at the start was always left by a
  run that has ended, and `run.sh worktree` saves it to `work-reports/<stamp>-discarded/stopped.diff` and discards it
  without asking.
- **Take a project only when nobody else is assigned to its parent.** `run.sh worktree` assigns the user and leaves
  the assignment in place for the life of the project.
- **Only this session writes to GitHub.** workflow runs in this same session and pushes and opens the draft pull
  request there. Every comment starts with `**[pj4-running]**`.
- **One task at a time.**
- **Everything runs in `<WT>`.** Never switch, stash, commit or clean in `<MAIN>`. The user works there.
- **Never `--admin`. Never create a label with `--force`. Always pass a body with `--body-file`.**
- **Never merge the project's pull request.** It goes into `<from>`, and the user merges it.
- **Never merge a pull request that `project.sh` does not report as the issue's `pr`.**
- **Whenever you take `ready` off an issue, add `blocker`.**
- **The next run never uses the work a stopped run left in `<WT>` or saved to `stopped.diff`.** The work is redone.
- **Never push to `<from>` or to the default branch, push to the base branch only through `run.sh sync`, and never
  rewrite their history.** The one branch this skill creates outside a pull request is the project's base branch,
  through the API, in `run.sh start`. The one commit that reaches it outside a pull request is the merge of `<from>`,
  pushed as a fast-forward by `run.sh sync`. The project's pull request is opened from that branch as it stands on
  origin.
- **Close an issue or a parent only through `run.sh close` or `run.sh merge`, which refuse one that is not due, and
  close as completed.**
- An unattended run never calls `AskUserQuestion` and ends with one `unattended:` line.
- After a context summary, take whether the run is unattended from the `project #<P>` line, `$TMP` from the `tmp` line, and rebuild the run from the progress lines and `project.sh <P>`. Read `issues.md` again when the run is in phases 1 to 5, and `project-pr.md` when it is in **The project's pull request**. A run inside a workflow entry takes **Before workflow runs** again for that entry.
