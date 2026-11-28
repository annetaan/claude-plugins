---
name: pj4-running
description: Takes the project from a number given, a sub-issue's number naming its parent, the project this conversation is on, or the only project with sub-issues, and otherwise asks which project to work on. Creates the project's base branch on its first start, once every project it waits on is merged, and closes the parent of a merged project and names the projects that can be split now, as /annetaan:pj2-issues <P>. Works down the run order in the parent's Order list one sub-issue at a time, and stops at the first issue that is not workable. Each one is detailed against the code and run through workflow's task loop and review rounds as reviewed commits, with no skill loaded, then pj4-running merges its pull request into the base branch and closes the issue itself. Once every sub-issue is closed, merges the branch the base branch was made from into it, with workflow's merge task resolving any conflict, then opens the pull request from the base branch into that branch, and leaves its merge to the user. Works on each issue in a git worktree of its own, so the main working tree stays free for the user. Files unplanned work as stub issues and stops on a blocker. The fourth of four skills, after pj1-plan, pj2-issues and pj3-doctor. Run it again on a project whose pull request is open to resolve that pull request's conflicts: it brings the source branch in again under review. Use it only when the user names this skill or invokes /annetaan:pj4-running, when the user asks to resolve the conflicts of a project's pull request (from `pj/<n>`), or when the workflow skill hands such a request over, because it creates branches, pushes, opens and merges pull requests, and edits issues and labels.
---

# pj4-running

The fourth of the four pj skills: it works down a project's run order, the parent's `## Order`, and merges one pull
request per sub-issue. Once every sub-issue is closed, it merges `<from>` into the base branch and opens the project's
pull request, from the base branch into `<from>`, and the user merges it.

You are the main session. **You do not write code.** workflow's sessions implement and review. You own the branch,
the merge, the issues, the labels and the notices.

**Each entry of the run works in a worktree of its own.** Two paths matter.

- **`<MAIN>`** is the main working tree, the user's. It is the path on the first `worktree` line of
  `git worktree list --porcelain`. `git rev-parse --show-toplevel` would print the worktree you are in, which is
  wrong when the skill starts from another worktree.
- **`<WT>`** is the worktree of the entry at hand, under `<MAIN>/.claude/worktrees/`. Each issue `<k>` runs in
  `pj-<P>-<k>-<stamp>`, which `run.sh worktree` makes (**The issues** step 2 in `issues.md`). The merge of `<from>` and the
  declared checks run in `pj-<P>-sync-<stamp>`, which `run.sh sync` makes (`project-pr.md`). Each is made fresh from
  the tip of `origin/<base>`.

The main session stands in `<MAIN>` between entries, and runs only `project.sh`, `issue.sh`, `run.sh` and
`level.sh show` there, which only read it. It enters an entry's worktree for that entry and leaves it before `run.sh
merge` or `run.sh end`, which remove it. The user keeps working in `<MAIN>` while the run goes on. The run never
switches, stashes, commits or cleans there.

## Paths: `$RUNNING`

**`$RUNNING` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$RUNNING` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$RUNNING` finds
them nothing.
Collapse the `..` in a path to a sibling skill, so that the command text names `<skills>/pj1-plan/scripts/project.sh` and not
`<skills>/pj4-running/../pj1-plan/scripts/project.sh`. A permission rule matches the text of the command, and the rules
`pj-auto` grants name the collapsed path. This holds in the prompts for sub-agents too.

`$FLOW` in `run-issue.md`, `run-sync.md` and the workflow files they read means `<skills>/workflow`, the collapsed
`$RUNNING/../workflow`. pj4-running never loads workflow, so nothing replaces `${CLAUDE_SKILL_DIR}` there.

**Read `$RUNNING/../pj1-plan/between-skills.md` and `$RUNNING/../pj1-plan/state.md` before anything else.**
`pj1-plan/between-skills.md` holds the labels, the base branch, the handover comment, the blockers, the comments, the pull
requests and the format-only fixes. Its table of the four skills says where this one sits. `pj1-plan/state.md` is how `project.sh` reads a project and
when an issue is ready and workable. Everything below refers to them. `$RUNNING/../pj1-plan/format.md` describes the
issues and their bodies, and is read only at the sections this file names: **The run order**, **Stubs**, **Fixed
tokens** and **Writing bodies**.

This skill uses six more things:

- the script `$RUNNING/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the script `$RUNNING/../pj1-plan/scripts/issue.sh`, written `issue.sh` below, the writer of the issues, the
  relationships and the comments this file and `issues.md` write themselves. Its subcommands and stops are in
  `pj1-plan/between-skills.md` under **Writing to GitHub**
- the script `$RUNNING/../workflow/scripts/level.sh`, written `level.sh` below (see **The level**)
- the script `$RUNNING/../workflow/scripts/flow.sh`, written `flow.sh` below
- the script `$RUNNING/scripts/run.sh`, written `run.sh` below. Every subcommand prints one JSON object with a
  `status`. A `stop` whose `reason` the section at hand does not name, such as `project` when `project.sh` fails,
  stops the run: quote `message`. A non-zero exit is a usage error or an unexpected failure: quote its message and
  stop the run
- workflow's files, read by path and never loaded as a skill: `$RUNNING/../workflow/loop.md`,
  `$RUNNING/../workflow/integration.md`, `$RUNNING/../workflow/finish.md`, `$RUNNING/../workflow/merge-task.md`, and
  the sections **The level**, **Agents**, **The prompts**, **Begin**, **The run's files** and **Rules for the whole
  flow** of `$RUNNING/../workflow/SKILL.md`

Parts of this skill live in files next to this one, named by their bare name from here on: `$RUNNING/issues.md` (**The order**, **Approval**, **The issues**, **A redrawn issue**, **When a run returns**), `$RUNNING/project-pr.md` (**The project's pull request**), `$RUNNING/run-issue.md` (a sub-issue's run) and `$RUNNING/run-sync.md` (a conflicted sync). **The end of the run** is in this file.

**Language**: talk to the user in the user's language. Write issue, comment and pull request text in the repository's
language (`pj1-plan/format.md`, **Writing bodies**). The tokens in (`pj1-plan/format.md`, **Fixed tokens**) stay in English.

## Before you start

This skill creates branches, pushes, opens and merges pull requests, and edits issues and labels. **Start it only when the user names it or invokes `/annetaan:pj4-running`, asks to resolve the conflicts of a project's pull request, or workflow's From a pull request hands one over.**

**A conflict in the project's pull request** that appears after it was opened, because `<from>` moved, is resolved by
a run like any other: every sub-issue is closed, so `start` returns `done`, and **The end of the run** brings `<from>` in again under
review, pushes the merge to `<base>`, and finds the pull request `exists`. The request to resolve it is the
invocation, and the run asks nothing.

**The project.** Pick it as `pj1-plan/between-skills.md` says under **Picking the project**. The project picked is `<P>`. In an unattended run, only rule 1 of **Picking the project** applies (`pj1-plan/between-skills.md`, **Unattended runs**). Print
`project #<P>` once, with ` unattended` after it in an unattended run, as **Picking the project** says. A number given picks the project, a sub-issue's number its parent, and the run still covers
the whole order of the project picked.

When the args carry `tmp=<dir>`, `$TMP` below is that directory. Otherwise run `mktemp -d` once and use the
directory it printed. Print `tmp <dir>` once, so that a context summary can find it again. The start may already
write comment files there. A shell variable does not outlive one command, so write the path in full each time.
When the args carry `level=<level>`, `<level>` sets the repository's level for this run (see **The level**).

Then check everything the run needs.

```bash
$RUNNING/scripts/run.sh start <P>
```

`start` checks the clone, `gh` and the repository, and reads the project with `project.sh`. It creates the base
branch from the tip of `<from>` when the base branch is missing and every project `<P>` waits on is merged, as
`pj1-plan/between-skills.md` says under **The base branch**. Then it fetches the base branch and reads the rules on it.

**First close each parent in `close`**, as **Closing a merged project** says, whatever the status. Then act by
`status`.

- **`stop`**: act by `reason`.
  - `not-a-repo`, `no-origin`, `gh` (not installed, or older than 2.99.0), `gh-auth`, `issues-off`, `permission`
    (`viewerPermission` other than `WRITE`, `MAINTAIN` or `ADMIN`), `project` (`project.sh` failed, for example with
    `has no Base: line`), `create-failed`, `fetch-failed` and `no-merge-method`: say which check failed, quote
    `message`, and stop.
  - `still-not-ignored`: `start` adds `.claude/worktrees/` and `work-reports/` to the clone's `.git/info/exclude` when
    that file lacks them, and a `.gitignore` rule, such as `!work-reports/`, still keeps the paths in `notIgnored`
    visible. Say so, name them, and stop. **Never edit `.gitignore`**, because that commit would land on the base
    branch with no pull request.
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
  - `assign-failed`: quote `message`, say which `step` failed (`login`, `read` or `add`), and stop. With `step`
    `read` after the add, `assignee` says the user was assigned: print `#<P> assigned to <assignee.login>`.
  - `assigned`: `assignees` names the people assigned to `#<P>` besides the user, `login` being the user. The
    project belongs to someone else, and pj4-running does not take a parent assigned to another person. Name the
    logins and stop. Once that person no longer works on it, removing them from `#<P>`'s Assignees lets the next run
    take it. When `self` is true, the user is assigned too, so two people started at once, and a human decides who
    stays. The user's own assignment stays either way, and removing it is a human's call.
- **`empty`**: the project has no sub-issue yet. It has not been split. Give the next step,
  `/annetaan:pj2-issues <P>`, and end.
- **`done`**: every sub-issue is closed. When `project.merged` is true, `close` held `<P>`. Report its close, and
  end. Otherwise keep the values as for `run`, take **The level**, and go straight to **The end of the run**, which brings `<from>` in and opens the project's pull request.
- `done` and `run` carry `ignored`, the paths `start` added to `.git/info/exclude` because that file had no line for them.
  When it is not empty, print `ignored <paths>` once, adding that `.git/info/exclude` stays in the clone and commits
  nothing.
- **`run`**: keep `main` as `<MAIN>`, `project.base` as `<base>`, `project.from` as `<from>`, and keep `created`,
  `rules` and `assignee`. `start` read the parent's assignees on the way to `run`, and assigned the user when nobody
  was assigned. Print `#<P> assigned to <assignee.login>` when `assignee.added` is true. When `created` is not null,
  this run created the base branch. Print `<base> created from <from> at <short sha>`, and keep the SHA for **Approval** in `issues.md`.
  Go through the rest of this section, then take **The level**, then read `issues.md` and follow it from **The order**.

When `rules.selfMerge` is `unknown`, the rules on the base branch could not be read. The rules call failed, or the
branch is protected and reading its classic protection needs admin rights. Ask once.

```
AskUserQuestion: Can a pull request be merged here with no approving review?
  - Go on
  - Stop
```

On Stop, stop the run. An unattended run does not ask: it treats this as Stop and ends as needs-user.

`rules.mergeMethod` is the merge method, the first of squash, merge and rebase that the repository and the rules on
the base branch allow.

A dirty `<MAIN>` does not stop the run. The run never works in it.

Every stop here comes before any worktree is made.

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

### The level

The repository's level picks the model and the effort of workflow's design session, its implementation session and
its review seats.
Run `level.sh` once, in `<MAIN>`, as **The level** in `workflow/SKILL.md` says, with `<level>` from `level=<level>`
in the args, left out when the args carry none. Every worktree of the clone reads the same level, because `show`
reads the file from origin's default branch with `git show`.

```bash
$RUNNING/../workflow/scripts/level.sh show <MAIN> [<level>]
```

Print `level <level> (<source>)` once, and `warning` on a line of its own when it is set. Keep the JSON: `run-issue.md`
and `run-sync.md` take it as settled. A non-zero exit, such as `level=<level>` other than `standard` or `high`, stops the run: quote its
message. An unattended run ends as needs-user.

## Unplanned work

`run-issue.md` and `run-sync.md` come here. An `Unplanned:` report marked `later` arrives while the task goes on.

1. Write `$TMP/stub-<j>.md` in the shape of `pj1-plan/format.md` **Stubs**. Its `## Goal` holds what was found, why it matters,
   and "found while working on #<k>".
2. File it with no label and no edges. pj3-doctor sets the edges and places it in the run order when it has it
   drawn.

   ```bash
   $RUNNING/../pj1-plan/scripts/issue.sh sub <P> --title "<title>" --body "$TMP/stub-<j>.md"
   ```

   A `lint` stop means the body left the shape of **Stubs**: write it again in that shape, once, and report a second
   stop.

3. Tell the user in one line, and keep the `number` and `url` it printed for the report.

## Folding the handover lines

Fold the handover lines into the notes. Merge duplicates, keep fifteen lines at most, and drop the oldest
first. Read the handover comment again with the command in `pj1-plan/between-skills.md` under "The handover comment",
work any change a human made into the notes, and write them to `$TMP/handover.md`, starting with the line
`**[pj4-running]** Handover notes`. Rewrite the comment with the `updated_at` of that read, or post it when the read
found none.

```bash
$RUNNING/../pj1-plan/scripts/issue.sh handover <P> --since <updated_at> --body "$TMP/handover.md"
```

```bash
$RUNNING/../pj1-plan/scripts/issue.sh handover <P> --body "$TMP/handover.md"
```

A `moved` stop means a human changed the comment since the read: read it again and merge.

## The end of the run

Every way the run ends comes here: the run order is done, the run stopped, or the user said stop.

1. `project.sh <P>`. **When every sub-issue is closed** and the project is not `merged`, bring `<from>` in and open
   the project's pull request: read `project-pr.md` and run **The project's pull request**, then come back to step 2. Ask nothing, because **Approval** in `issues.md`,
   or for `start`'s `done` the invocation itself, covered it. Skip this step when the run stopped in `start`.
2. Leave the worktree this session stands in, when it stands in one. `run.sh merge` and `run.sh end` already dealt
   with its branch, so nothing else runs here.

   ```
   ExitWorktree(action: "keep")
   ```

   A worktree entered by path is never deleted by `ExitWorktree`. Where that tool is not available, `cd "<MAIN>"`.

## Report to the user

- the base branch `<base>`, and whether this run created it
- how `<from>` came into `<base>`: already in, merged as `<sha>`, or merged as `<sha>` after workflow resolved the
  conflicts in the files it names, or why it did not
- the project's pull request with its URL, when there is one, and that merging it is the user's job
- the declared checks and how each came out, and the stub when one was filed
- the parents closed in this run
- the projects that can be split now, collected from the `startable` of each close, one line each as
  `/annetaan:pj2-issues <R>` with its title
- that this run assigned `#<P>` to `<login>`, when `assignee.added` was true, and that the assignment stays
- each merged issue with the URL of its pull request, and the URLs of the decision issues its run filed, or the
  reason none were
- the issues the detail pass redrew, with what changed, the ones set aside because a redraw gave them an open blocker,
  and the ones closed with nothing left
- a decision the run added to an issue and stopped on, as `<issue URL> D<k>`, with what the design session found
- the stubs filed, the `later` ones and the `blocker` ones
- where the run stopped and why, or that the run order is done
- **each worktree `run.sh end` kept**, with its `name`, the number in `commits`, and whether `changes` is empty. Its
  commits stay on its detached HEAD and its uncommitted work in its tree. Say plainly that the next run redoes the
  issue in a new worktree and never uses it, and that `/annetaan:cleanup <P>` removes it once the project is merged.
  Add `errors` when it is not empty
- **each worktree that stays with its branch checked out**: a `merged` with `worktree` null, a `stop requested: yes`
  or a `merge` stop. Name it and say why it stays
- **the worktree of a `finish` stop**: `<branch>` holds the reviewed commits, and the worktree holds them on a
  detached HEAD. The next run stops on `left` with both ways out
- the work reports, which `run.sh merge` and `run.sh end` moved into `<MAIN>/work-reports/`
- the screenshots that could not be attached, with their paths and the URL of the pull request
- what is workable now and what is waiting
- the next step: `/annetaan:pj3-doctor` when a `blocker` or a stub exists, otherwise `/annetaan:pj4-running`.
  When every sub-issue is closed, the user merges the project's pull request, then runs `/annetaan:cleanup <P>`,
  which closes the parent, removes the project's worktrees and its base branch, and brings the local `<from>` up to
  date. When the list of projects that can be split now is not empty, `/annetaan:pj2-issues <R>` for
  each.

## Ending an unattended run

An unattended run prints its last line as `pj1-plan/between-skills.md` says under **Unattended runs**. These endings are
`unattended: done`:

- `start` returned `empty`.
- `start` returned `stop` with `waits`. The projects waited on are readable on GitHub.
- `start` returned `done` with `project.merged` true, and `close` closed `<P>` or found it `already` closed.
- `start` returned `done` and **The project's pull request** in `project-pr.md` came to `opened` or `exists`.
- The run order of **The order** in `issues.md` was empty, including when `orderCheck` is not ok and no issue has a merged pull request.
- **The declared checks** in `project-pr.md` filed a stub for a check that failed.
- **The issues** step 1 in `issues.md` stopped because the issue was no longer workable.
- **When a run returns** in `issues.md` got `stopped` with the reason `blocking` or `detail`, whatever `run.sh end`
  printed, `removed` or `kept`, or a non-zero exit, which the report quotes. A kept worktree does not stop the next
  run.
- The run order was worked to the end, and the project pull request of **The end of the run** came to `opened` or `exists`, or not every
  sub-issue is closed yet.

Every other ending is `unattended: needs-user <one line>`. An ending not on this list is needs-user, so a stop this
section does not name never reads as done.

## Rules

- **You never write code.** workflow's sessions do.
- **One session per project.** A person never runs two sessions on the same project at once: two pj4-running runs, or
  a run beside a pj-auto drive. The parent's assignee keeps a different person off the project, not the same
  person's second session, because both use one GitHub account.
- **Take a project only when nobody else is assigned to its parent.** `run.sh start` assigns the user and leaves
  the assignment in place for the life of the project.
- **Only this session writes to GitHub, and it writes issues, relationships, labels and comments only through
  `issue.sh` and `run.sh`.** `run-issue.md` pushes and opens the draft pull request in this same session. Every comment starts with `**[pj4-running]**`.
- **One task at a time.**
- **Every command of an entry runs in that entry's worktree.** Between entries the main session stands in `<MAIN>`
  and runs only `project.sh`, `issue.sh`, `run.sh` and `level.sh show` there. Never switch, stash, commit or clean
  in `<MAIN>`. The user works there.
- **Never `--admin`.**
- **Never merge the project's pull request.** It goes into `<from>`, and the user merges it.
- **Never merge a pull request that `project.sh` does not report as the issue's `pr`.**
- **The next run never uses the work a stopped run left in a worktree `run.sh end` kept, commits included.** The issue is redone in a new worktree.
- **Never push to `<from>` or to the default branch, push to the base branch only through `run.sh sync`, and never
  rewrite their history.** The one branch this skill creates outside a pull request is the project's base branch,
  through the API, in `run.sh start`. The one commit that reaches it outside a pull request is the merge of `<from>`,
  pushed as a fast-forward by `run.sh sync`. The project's pull request is opened from that branch as it stands on
  origin.
- **Close an issue or a parent only through `run.sh close` or `run.sh merge`, which refuse one that is not due or a
  comment file that starts with no marker, and close as completed**, or through `issue.sh close` as completed after
  `nothing-left` in `issues.md`.
- **Edit an existing sub-issue's body, the edges between existing sub-issues and the parent's `## Order` only in **A redrawn issue** in `issues.md`, and a
  sub-issue's title only through `run.sh stop` on a `decision` stop.** The one other write is a stub filed by **Unplanned work** or by `run.sh stop` on a `blocking` stop, with its `--blocking` edge.
- An unattended run never calls `AskUserQuestion` and ends with one `unattended:` line.
- After a context summary, take whether the run is unattended from the last `project #<P>` line, `$TMP` from the last `tmp` line, and rebuild the run from the progress lines and `project.sh <P>`. While an entry is running, enter again the worktree the last `#<k> worktree <path>` or `sync worktree <path>` line names, when `git rev-parse --show-toplevel` prints anything else. Inside a workflow entry the level comes back as **The level** in `workflow/SKILL.md` says, from `flow.sh status <WT>` and `level.sh show <WT> <level>`, and from the last `level` line only between entries, running `level.sh show <MAIN>` again with that level when the line says `override` and without one otherwise. Read `issues.md` again when the run is in **The order**, **Approval**, **The issues**, **A redrawn issue** or **When a run returns**, and `project-pr.md` when it is in **The project's pull request**. A run inside `run-issue.md` or `run-sync.md` reads that file again, with the workflow file it was in and the sections of `workflow/SKILL.md` it reads.
