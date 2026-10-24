---
name: pj-3-running
description: Asks which project to work on, with a number given as the recommended one. Creates the project's base branch on its first start, once every project it waits on is merged, and closes the parent of a merged project. Works down the run order in the parent's Order list one sub-issue at a time, and stops at the first issue that is not workable. Each one runs through the workflow skill as one task with review rounds, then pj-3-running merges its pull request into the project's base branch and closes the issue itself before the next starts. Works in a git worktree of its own, so the main working tree stays free for the user. Files unplanned work as stub issues and stops on a blocker. The third of three skills, after pj-1-plan and pj-2-doctor. Use it only when the user names this skill or invokes /annetaan:pj-3-running, because it creates branches, pushes, opens and merges pull requests, and edits issues and labels.
---

# pj-3-running

The third of the three pj skills: it works down a project's run order, the parent's `## Order`, and merges one pull
request per issue.

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

**Read `$RUNNING/../pj-1-plan/format.md` before anything else.** It is the only description of the parent
issue, the sub-issue body, the labels, the relationships, the blockers, the comments and the pull requests. Its table
of the three skills says where this one sits. Everything below refers to it.

This skill uses two more things:

- the script `$RUNNING/../pj-1-plan/scripts/project.sh`, written `project.sh` below
- the `workflow` skill, loaded with the Skill tool as `annetaan:workflow`

**Language**: talk to the user in the user's language. Write issue, comment and pull request text in the repository's
language, as `format.md` says.

## Before you start

This skill creates branches, pushes, opens and merges pull requests, and edits issues and labels. **Start it only when the user names it or invokes `/annetaan:pj-3-running`.**

```bash
git worktree list --porcelain     # the first worktree line is <MAIN>
git remote get-url origin
gh --version                      # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef,viewerPermission,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
```

**Each of these stops the run.** Say which one failed and stop.

- not a git repository
- no `origin`
- `gh` older than 2.94.0, or not logged in
- issues turned off
- `viewerPermission` other than `WRITE`, `MAINTAIN` or `ADMIN`
- no merge method allowed

A dirty `<MAIN>` does not stop the run. The run never works in it.

A `gh` older than 2.99.0 does not stop the run. workflow falls back for the screenshots.

**The project.** Pick it as `format.md` says under **Picking the project**. The project picked is `<P>`. Print
`project #<P>` once, so that a context summary can find it again. A number given only decides which project is
recommended, and the run still covers the whole order of the project picked.

Then run `mktemp -d` once for the whole run. `$TMP` below is the directory it printed. The start may already write
comment files there. A shell variable does not outlive one command, so write the path in full each time.

**The base branch.** Read the project and take `parent.base` as `<base>` and `parent.from` as `<from>`, the branch
the base branch is made from. When `project.sh` fails, for example with `has no Base: line`, quote its message and
stop.

```bash
$RUNNING/../pj-1-plan/scripts/project.sh <P>
```

Then go through these in order.

1. **No sub-issue at all**: say the project has nothing to run, and end.
2. **Every sub-issue is closed**: when `parent.merged` is true, close the parent as **Closing a merged project**
   says, report it, and end. Otherwise say that every sub-issue is closed, that `<base>` holds the whole project, that
   merging `<base>` into `<from>` through a pull request is the user's job, and that the parent closes when a
   pj-3-running run sees that merge, or when the user closes it after merging. When `parent.baseExists` is false, also
   say that the base branch is gone from origin. End.
3. **Close the merged projects `<P>` waits on.** Each `<Q>` in `parent.dependsOn` whose `merged` is true and whose
   `state` is `OPEN` is closed as **Closing a merged project** says. Its comment says that `#<P>` starts now.
4. **`parent.baseExists` is true**: go on to the fetch below.
5. **`parent.baseExists` is false**:
   - When a sub-issue has a `pr` whose `state` is `MERGED`, stop. The base branch is gone from origin. It may
     already have been merged into `<from>` and deleted.
   - When a project in `parent.dependsOn` has `merged` false, stop and list each one as `#<Q> <title>`. One whose
     `state` is `CLOSED` was closed as not planned, without a merge: remove the edges to it with
     `/annetaan:pj-2-doctor`. One whose `state` is `OPEN` has to be finished with `/annetaan:pj-3-running`, and
     its base branch, `dependsOn[].base`, merged into `<from>` through a pull request.
   - Otherwise create the base branch from the tip of `<from>`, as `format.md` says under **Projects**. Write
     `{owner}` and `{repo}` literally, `gh` fills them in. A failure of either command stops the run. Quote it.

     ```bash
     gh api "repos/{owner}/{repo}/git/ref/heads/<from>" --jq .object.sha
     gh api "repos/{owner}/{repo}/git/refs" -f ref="refs/heads/pj/<P>" -f sha="<sha>"
     ```

     Print `pj/<P> created from <from> at <short sha>`, keep the SHA for phase 3, and run `project.sh <P>` again.

Every stop in this list comes before the worktree is entered.

Then fetch the base branch. The fetch moves the remote-tracking ref and nothing else. The run builds on
`origin/<base>` and never checks out a local `<base>`, so the user may have `<base>` checked out in `<MAIN>`.

```bash
git -C "<MAIN>" fetch --quiet origin "+refs/heads/<base>:refs/remotes/origin/<base>"
```

### Closing a merged project

**The base branch** closes a parent in two places. `<Q>` below is that parent: `<P>` itself, or a project in
`parent.dependsOn`. **Close only an open parent that `project.sh` reads as `merged`, and always as completed.**

Write `$TMP/<Q>-closed.md`. It starts with `**[pj-3-running]**` and says that the project's base branch is merged into
the branch it was made from and that every sub-issue is closed. The base branch is `dependsOn[].base` for a project
`<P>` waits on, and `<base>` for `<P>`. For a project `<P>` waits on, the comment adds that `#<P>`, which waits on
it, starts now. Then post it and close the parent.

```bash
gh issue comment <Q> --body-file "$TMP/<Q>-closed.md"
gh issue close <Q> --reason completed
```

### The worktree

Look for `<WT>` among the worktrees.

```bash
git -C "<MAIN>" worktree list --porcelain
```

- **`<WT>` is listed with `prunable`**: its directory is gone. Run `git -C "<MAIN>" worktree prune`, then create it
  as in the last case.
- **`<WT>` is listed and `git -C "<WT>" status --porcelain` prints nothing**: move it onto the fetched base.

  ```bash
  git -C "<WT>" switch --detach origin/<base>
  ```

- **`<WT>` is listed and `status --porcelain` prints something**: an earlier run stopped with work in flight. Ask
  once.

  ```
  AskUserQuestion: <WT> holds uncommitted work from an earlier run. The next run redoes it.
    - Discard it and go on (Recommended) - git -C <WT> reset --hard, then git -C <WT> clean -fd. Ignored files such as work-reports/ stay.
    - Stop and look at <WT>
  ```

  On the first answer, discard it and move onto the base.

  ```bash
  git -C "<WT>" reset --hard
  git -C "<WT>" clean -fd
  git -C "<WT>" switch --detach origin/<base>
  ```

  On the second, stop the run. Name `<WT>` and say that `git -C <WT> diff` shows the work.
- **`<WT>` is not listed but the path exists**: stop. It is not a worktree of this repository, and nothing here may
  touch it.
- **Otherwise** create it.

  ```bash
  git -C "<MAIN>" worktree add --detach "<WT>" origin/<base>
  ```

**Then enter it, once.**

```
EnterWorktree(path: "<WT>")
```

Where that tool is not available, `cd "<WT>"`. A Bash `cd` moves this session only. workflow tells its sub-sessions
to enter `<WT>` themselves, because their directory resets on every bash call.

**Every command from here to the end of the run runs in `<WT>`.** After a context summary, run
`git rev-parse --show-toplevel`, and enter `<WT>` again when it prints anything else. Between issues `<WT>` holds a
detached HEAD. A stop from here on, even one before the approval, leaves `<WT>` as phase 6 step 1 says.

`<WT>` has none of `<MAIN>`'s ignored files, such as installed dependencies or a `.env`. The first worker prepares
what the tests need and leaves the steps in the handover notes, so later issues find them there.

### Paths this clone must ignore

Two paths must stay out of git, and pj-3-running checks both here, once, because a run from an issue never asks.

- `.claude/worktrees/` in `<MAIN>`, or the user sees `<WT>` as an untracked directory
- `work-reports/` in `<WT>`, where workflow writes its reports

```bash
git -C "<MAIN>" check-ignore -q .claude/worktrees/ && echo IGNORED || echo NOT_IGNORED
git check-ignore -q work-reports/ && echo IGNORED || echo NOT_IGNORED
```

Keep the trailing slashes. A pattern that ends in `/` matches only a directory, and before the first run there is no
`work-reports/`, so `check-ignore work-reports` answers `NOT_IGNORED` even when the rule is there.

When either prints `NOT_IGNORED`, ask once, naming the paths that are not ignored.

```
AskUserQuestion: These paths are not ignored in this repository: <paths>. pj-3-running works in .claude/worktrees/ and workflow writes its reports to work-reports/.
  - Ignore them in this clone (Recommended) - adds them to .git/info/exclude and commits nothing
  - Stop
```

On the first answer, append each path that was not ignored to the exclude file git resolves, then run both checks
again. Every worktree of a clone shares that one file, so the line written from `<WT>` holds in `<MAIN>` too. In a
linked worktree `.git` is a file, so write no path under it by hand.

```bash
printf '.claude/worktrees/\n' >> "$(git rev-parse --path-format=absolute --git-path info/exclude)"
printf 'work-reports/\n' >> "$(git rev-parse --path-format=absolute --git-path info/exclude)"
```

**Never edit `.gitignore` here.** That commit would land on the base branch with no pull request.

On Stop, leave `<WT>` as phase 6 step 1 says and end the run. `<WT>` stays in place, and the report says that
`git -C "<MAIN>" worktree remove <WT>` removes it.

### Can a self-merge go through?

pj-3-running merges its own pull requests, so a rule on the base branch that wants another person's review stops it.
Write `{owner}` and `{repo}` literally, `gh` fills them in.

```bash
gh api "repos/{owner}/{repo}/rules/branches/<base>"
gh api "repos/{owner}/{repo}/branches/<base>" --jq .protected
gh api graphql -f query='{repository(owner:"<owner>",name:"<name>"){ref(qualifiedName:"refs/heads/<base>"){branchProtectionRule{requiredApprovingReviewCount requiresCodeOwnerReviews requiresStatusChecks}}}}'
git ls-tree --name-only origin/<base> -- CODEOWNERS .github/CODEOWNERS docs/CODEOWNERS
```

**Stop when any of these holds**, and name it:

- a `pull_request` rule with `parameters.required_approving_review_count` above 0
- a `pull_request` rule with `parameters.require_code_owner_review` true, and a CODEOWNERS file exists
- a `merge_queue` rule
- classic protection with `requiredApprovingReviewCount` above 0
- classic protection with `requiresCodeOwnerReviews` true, and a CODEOWNERS file exists

When the rules call fails, or `protected` is true while the GraphQL rule comes back null (reading it needs admin
rights), ask once.

```
AskUserQuestion: Can a pull request be merged here with no approving review?
  - Go on
  - Stop
```

**Note whether the base branch requires status checks**: a `required_status_checks` rule, or classic protection
with `requiresStatusChecks` true. When neither could be read, count it as unknown. The merge in phase 5 waits by it.

### Picking the merge method

Take the first the repository allows: squash, else merge, else rebase.

- Leave out merge when a `required_linear_history` rule exists.
- When a `pull_request` rule has `parameters.allowed_merge_methods`, keep only the methods it lists.

No method left stops the run.

## Phase 1: the order

1. Read the project.

   ```bash
   $RUNNING/../pj-1-plan/scripts/project.sh <P>
   $RUNNING/../pj-1-plan/scripts/project.sh <P> --order
   ```

   **When `--order` fails on a cycle**, within the project or between projects, show the user the cycle it names
   and stop.
2. **Build the run order.** First put every open issue whose `pr.state` is `MERGED` at the front, whatever its labels
   and blockers. Its pull request has merged and only the close is left. Then walk `parent.order` from the top and
   skip the closed issues. Take each open issue while it is workable (`format.md`, **When an issue is ready**), with
   the issues already taken counting as closed. Phase 2 runs the `--check` part of that. **Stop the walk at the first
   open issue that is not.** Nothing after it is taken, even when it is workable, because the order is the user's
   (`format.md`, **The run order**).
   - **`parent.order` is empty, or `parent.orderCheck.ok` is false**: stop, show what `orderCheck` names, and give the
     next step, `/annetaan:pj-2-doctor`.
3. List the issue the walk stopped at, with why it is not workable, and the open issues after it as **waiting**. List
   the issues in `orderCheck.missing` too, as not in the order.
4. **An empty run order** ends the skill here. Report the issue the walk stopped at and why, and the next step,
   `/annetaan:pj-2-doctor`. An issue with a merged pull request makes the run order non-empty.
5. Run `git branch -a` once. Pick a branch pattern in the repository's own naming that holds the issue number, such
   as `feat/<n>-<slug>`. Phase 3 shows it.

## Phase 2: the pre-check

Check every issue in the run order against the code before anything starts, except the ones whose `pr` is merged.
Their own `added` files exist now, so `--check` would fail them.

```bash
$RUNNING/../pj-1-plan/scripts/project.sh <P> --check <k>
```

**For each issue whose `ok` is false**, mark it.

1. Make sure `blocker` exists with the command in `format.md` under "Labels".
2. Take `ready` off and put `blocker` on.

   ```bash
   gh issue edit <k> --remove-label ready --add-label blocker
   ```

3. Write `$TMP/<k>-check.md` and post it. It starts with `**[pj-3-running]**`, then lists the lint codes, each premise
   failure (path, symbol, why) and each stale commit (SHA, subject, pull request), and ends with "Settle it with
   /annetaan:pj-2-doctor."

   ```bash
   gh issue comment <k> --body-file "$TMP/<k>-check.md"
   ```

**If any issue failed, do not start.** No issue in the order may need design when the run begins. Report which
issues failed and why, and the next step, `/annetaan:pj-2-doctor`.

## Phase 3: approval

Show the user:

- the project, `#<P> <title>`
- the run order, one line each as `#<k> <title>`, with "(PR #<m> open, merges now)" where `pr.state` is `OPEN` and
  "(merged as PR #<m>, closes now)" where it is `MERGED`
- the waiting list
- the base branch, with "created now from `<from>` at `<sha>`" when this run created it, the branch pattern and the
  merge method
- each parent closed at the start, as `#<Q>`
- the worktree `<WT>`, where the whole run happens, and that `<MAIN>` is not touched, so the user can keep working
  there
- that `<WT>` has none of `<MAIN>`'s ignored files, such as dependencies or a `.env`, so the first worker prepares
  them
- how each issue runs: a branch, workflow's **From an issue** (one task with review rounds, with the review files
  in its work report), a draft pull request into the base branch, then a merge by pj-3-running, which then closes the
  issue. GitHub does not close it on a merge into a branch other than the default branch.
- that merging the base branch into `<from>` is the user's job, outside this skill, and that the parent `#<P>` closes
  as completed once a run sees that merge
- that the run stops on a blocker, a divergence, the round cap, a merge that does not go through, or the user saying
  stop

```
AskUserQuestion: Start the run?
  - Start the run
  - Do not start
```

The approval covers this run only (`format.md`, **Principle**).

## Phase 4: before the first issue

1. Load workflow.

   ```
   Skill(skill: "annetaan:workflow", args: "From an issue, driven by pj-3-running")
   ```

   Follow its **From an issue** section for every issue. **Load it again when a context summary has dropped it.**
2. Read the handover comment with the command in `format.md` under "The handover comment". Keep its lines as the
   handover notes. With no comment, the notes are empty.

## Phase 5: one issue at a time

Nothing runs in parallel. There is one worktree, `<WT>`. For each issue `<k>` in the run order:

1. **Re-read the project** with `project.sh <P>`.
   - The issue is closed: skip it.
   - `ready` is gone, because a human took it off, and `pr` is not merged: the run stops here, as the walk in phase 1
     would have. Tell the user, and go to phase 6.
2. **Check again** with `project.sh <P> --check <k>`, unless `pr` is merged. A failure gets the marks from phase 2,
   and the run stops (phase 6).
3. **Take the path `pr` gives.**
   - **`pr.state` is `MERGED`** as `#<m>`: close the issue. Write `$TMP/<k>-closed.md`. It starts with
     `**[pj-3-running]**`, says PR #<m> merged into `<base>`, and says pj-3-running closed the issue because GitHub does
     not close an issue on a merge into a branch other than the default branch. Then close the issue.

     ```bash
     gh issue comment <k> --body-file "$TMP/<k>-closed.md"
     gh issue close <k> --reason completed
     ```

     Print `#<k> done (<i>/<N>): PR #<m> merged earlier, issue closed` and take the next issue. No workflow run and
     no handover rewrite.
   - **`pr.state` is `OPEN`** as `#<m>`: its task commit passed review, and only the merge is left. Go to **When
     workflow returns**, as `finished` with `<m>` and no handover lines. No workflow run and no handover rewrite.
   - **`pr` is null**: make a fresh branch, then run From an issue.

     ```bash
     git fetch --quiet origin "+refs/heads/<base>:refs/remotes/origin/<base>"
     git switch --no-track -c <branch> origin/<base>
     ```

     A local `<branch>` may be left over from a stop during the task. When
     `git rev-list --count origin/<base>..<branch>` prints 0, delete it with `git branch -D <branch>` and create it
     again. Otherwise it holds unpushed work. Stop and ask the user.
4. **Run From an issue.** These are what it expects you to have settled, so say them in your context before you
   start it: `n` (= `<k>`), `P`, the issue title, the projects `<P>` waits on (the `parent.dependsOn` numbers, or
   none), the base branch, the branch you just made, the handover notes, and the paths `<WT>` and `<MAIN>`.

### Unplanned work

workflow hands over to this section by name. An `Unplanned:` report marked `later` arrives while the task goes on.

1. Write `$TMP/stub-<j>.md` in the shape of `format.md` **Stubs**. Its `## Goal` holds what was found, why it matters,
   and "found while working on #<k>".
2. File it with no label and no edges. pj-2-doctor sets the edges and places it in the run order when it has it
   drawn.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/stub-<j>.md"
   ```

3. Tell the user in one line, and keep the number for the report.

### When workflow returns

workflow hands over to this section by name, with `finished` or `stopped`.

**`finished`** carries the pull request `<m>`, the SHA of the task commit, the handover lines, the paths of any
screenshots that could not be attached, and `stop requested` (yes or no).

**With `stop requested: yes`, do not merge.** The user said stop. Fold the handover lines as step 7 says, then go to
phase 6. The pull request stays a draft, and the next run merges it.

1. Check the pull request.

   ```bash
   gh pr view <m> --json reviewDecision,mergeStateStatus,isDraft,headRefName
   ```

   Take `<branch>` from `headRefName`. Stop when `reviewDecision` is `REVIEW_REQUIRED` or `CHANGES_REQUESTED`, or
   when `mergeStateStatus` is `DIRTY`.
2. Wait for the required checks. The pull request was pushed seconds ago, and its check runs may not exist yet.
   `--watch` does not wait for a check that has not registered. It exits at once with "no required checks
   reported".
   - **No status checks required** (noted in **Can a self-merge go through?**): go straight to the watch below.
   - **Required, or unknown**: first wait until a required check shows up, about five minutes at most.

     ```bash
     for i in $(seq 30)
     do
       n=$(gh pr checks <m> --required --json name --jq length 2>/dev/null)
       [ "${n:-0}" -gt 0 ] && break
       sleep 10
     done
     echo "required checks: ${n:-0}"
     ```

     Run it as a background command and wait for it to exit, because a foreground `sleep` may be refused. Still 0
     when the checks are required: stop the run. Still 0 when unknown: go on.

   ```bash
   gh pr checks <m> --required --watch --fail-fast
   ```

   "No required checks" after that counts as a pass. **A failing check stops the run.** The pull request stays a
   draft, and the next run merges it.
3. `gh pr ready <m>`
4. Merge with the method from **Picking the merge method**. A failure stops the run.

   ```bash
   gh pr merge <m> --squash      # or --merge, or --rebase
   ```

   Do not let gh delete the branch. To delete it, gh switches `<WT>` to `<base>`, and git refuses that while
   `<MAIN>` has `<base>` checked out. Step 6 deletes the branch.

5. Close the issue. The merge into the base branch closed nothing. Write `$TMP/<k>-closed.md` worded as in the
   `merged` case of phase 5 step 3, naming `#<m>`, then post it and close the issue.

   ```bash
   gh issue comment <k> --body-file "$TMP/<k>-closed.md"
   gh issue close <k> --reason completed
   ```

6. Move `<WT>` onto the merged base, then delete the head branch here and on origin.

   ```bash
   git fetch --quiet origin "+refs/heads/<base>:refs/remotes/origin/<base>"
   git switch --detach origin/<base>
   git rev-parse --verify --quiet refs/heads/<branch> && git branch -D <branch>
   git push origin --delete <branch>
   ```

   A pull request merged from the `OPEN` path of phase 5 step 3 has no local branch, so `git branch -D` runs only when
   `git rev-parse` finds one. When the push says the remote ref does not exist, the repository deleted the head branch
   on merge. Go on.

7. **Fold the handover lines into the notes.** Merge duplicates, keep fifteen lines at most, and drop the oldest
   first. Rewrite the parent's handover comment as `format.md` says under "The handover comment": read its
   `updated_at` again first, and keep any change a human made since. Create it when there is none. With no handover
   lines, as on the `OPEN` path of phase 5 step 3, skip this step.
8. Print one progress line: `#<k> done (<i>/<N>): PR #<m> merged`. After a context summary, rebuild the run order and
   the progress from these lines and `project.sh <P>`.

Then take the next issue.

**`stopped`** carries the reason, whether uncommitted work stays in `<WT>` (yes or no), and the text of the
`Unplanned:` or `Diverged:` report, or the failure message for `finish`. A stopped run has opened no pull request.
Act by the reason, then go to phase 6. Every comment below is written to a file under `$TMP` and starts with
`**[pj-3-running]**`.

- **`blocking`**: make sure `blocker` exists. File the stub in the shape of `format.md` **Stubs**, from the
  `Unplanned:` text, blocking `#<k>`.

  ```bash
  gh issue create --parent <P> --blocking <k> --label blocker --title "<title>" --body-file "$TMP/stub-<j>.md"
  ```

  Post a comment on `#<k>`: the run stopped, `#<k>` is blocked by the stub `#<b>`, and why.
- **`diverged`**: make sure `blocker` exists, then `gh issue edit <k> --remove-label ready --add-label blocker`.
  Post a comment on `#<k>` with the `Diverged:` text, naming the decision as `#<x> D<n>` when there is one.
- **`round cap`**: keep the labels. The body still holds, and the review did not settle. Post a comment on `#<k>`
  listing the points left open.
- **`user`**: nothing goes to GitHub.
- **`work-reports`**: report it. It should not happen after the check in **Paths this clone must ignore**.
- **`finish`**: report the step of workflow's phase 6 that failed, with its message. Nothing goes to GitHub. The task
  commit stays on the local branch, and the next run's branch step stops on it as unpushed work.

## Phase 6: end of the run

Every way the run ends comes here: the run order is done, the run stopped, or the user said stop.

1. Leave `<WT>`, only when this session entered it in **The worktree**. A stop before that point, such as a base
   branch gone from origin, a base branch that cannot be created, or a dirty `<WT>` the user wants to look at, skips
   this step. `<WT>` stays for the next
   run. The detach frees the branch for `<MAIN>`, and it works on a dirty tree too. Keep the `-C`, so the command
   cannot reach `<MAIN>` even after a context summary has lost the directory.

   ```bash
   git -C "<WT>" switch --detach
   ```

   ```
   ExitWorktree(action: "keep")
   ```

   A worktree entered by path is never deleted by `ExitWorktree`. Where that tool is not available, `cd "<MAIN>"`.
2. `project.sh <P>`. **When every sub-issue is closed**, tell the user what **The base branch** says when every
   sub-issue is closed and the project is not `merged`: `<base>` holds the whole project, merging it into `<from>`
   through a pull request is theirs to do, and the parent closes as completed when a pj-3-running run sees that merge,
   or when the user closes it after merging. Ask nothing.

## Report to the user

- the base branch `<base>`, and whether this run created it
- the parents closed in this run
- the worktree `<WT>`. The next run reuses it. The work reports live only under its `work-reports/`, and
  `git -C "<MAIN>" worktree remove <WT>` deletes it with those reports when the project is done
- each merged issue with the URL of its pull request
- the stubs filed, the `later` ones and the `blocker` ones
- where the run stopped and why, or that the run order is done
- **the uncommitted work left in `<WT>`, when there is some.** `git -C <WT> diff` shows it. Say plainly that the next
  run asks whether to discard it, and that the next run never uses it because the work gets redone
- the screenshots that could not be attached, with their paths and the URL of the pull request
- what is workable now and what is waiting
- the next step: `/annetaan:pj-2-doctor` when a `blocker` or a stub exists, otherwise `/annetaan:pj-3-running`.
  When every sub-issue is closed, the user merges `<base>` into `<from>` through a pull request. The next run then
  closes the parent, or the user closes it.

## Rules

- **You never write code.** workflow's sessions do.
- **Only this session writes to GitHub.** workflow runs in this same session and pushes and opens the draft pull
  request there. Every comment starts with `**[pj-3-running]**`.
- **One issue at a time.**
- **Everything runs in `<WT>`.** Never switch, stash, commit or clean in `<MAIN>`. The user works there.
- **Never `--admin`. Never create a label with `--force`. Always pass a body with `--body-file`.**
- **Never merge a pull request that `project.sh` does not report as the issue's `pr`.**
- **Whenever you take `ready` off an issue, add `blocker`.**
- **The next run never uses the work a stopped run left in `<WT>`.** The work is redone.
- **Never push to the base branch, to `<from>` or to the default branch, and never rewrite their history.** The one
  branch this skill creates outside a pull request is the project's base branch, through the API, as **The base
  branch** says.
- **Close a parent only when `project.sh` reads it `merged`, always with `--reason completed`.**
- After a context summary, rebuild the run from the progress lines and `project.sh <P>`.
