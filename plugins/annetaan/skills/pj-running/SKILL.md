---
name: pj-running
description: Works through the ready sub-issues of a GitHub project one at a time. Each one runs through the workflow skill as one task with review rounds in difit and an integration review, then pj-running merges its pull request into the project's base branch and closes the issue itself before the next starts. Files unplanned work as stub issues and stops on a blocker. The third of three skills, after pj-design-and-plan and pj-design-details. Use it only when the user names this skill or invokes /annetaan:pj-running, because it creates branches, pushes, opens and merges pull requests, edits issues and labels, and keeps a local difit server running for the whole run.
---

# pj-running

The third of the three pj skills: it takes the `ready` sub-issues of a project and merges one pull request per issue.

You are the main session. **You do not write code.** workflow's sessions implement and review. You own the branch,
the merge, the issues, the labels and the notices.

## Paths: `$RUNNING`

**`$RUNNING` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$RUNNING` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$RUNNING` finds
them nothing.

**Read `$RUNNING/../pj-design-and-plan/format.md` before anything else.** It is the only description of the parent
issue, the sub-issue body, the labels, the relationships, the blockers, the comments and the pull requests. Its table
of the three skills says where this one sits. Everything below refers to it.

This skill uses three more things:

- the script `$RUNNING/../pj-design-and-plan/scripts/project.sh`, written `project.sh` below
- the script `$RUNNING/../workflow/scripts/difit-session.sh`, only to stop the difit server when the run ends
- the `workflow` skill, loaded with the Skill tool as `annetaan:workflow`

**Language**: talk to the user in the user's language. Write issue, comment and pull request text in the repository's
language, as `format.md` says.

## Before you start

This skill creates branches, pushes, opens and merges pull requests, edits issues and labels, and keeps a local
server running. **Start it only when the user names it or invokes `/annetaan:pj-running`.**

```bash
git rev-parse --show-toplevel
git status --porcelain            # must be empty
git remote get-url origin
gh --version                      # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef,viewerPermission,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
command -v difit || echo "falls back to npx difit"
```

**Each of these stops the run.** Say which one failed and stop.

- not a git repository
- a dirty working tree
- no `origin`
- `gh` older than 2.94.0, or not logged in
- issues turned off
- `viewerPermission` other than `WRITE`, `MAINTAIN` or `ADMIN`
- no merge method allowed

A `gh` older than 2.99.0 does not stop the run. workflow falls back for the screenshots.

**The argument.**

- **No number**: find the project as `format.md` says under "Finding the project when no number was given".
- **One number that is a sub-issue**: take its parent from `gh issue view <n> --json parent`. The parent is the
  project `<P>`. The number only picks the project, and the run still covers the project's whole order.
- **One number that is not a sub-issue**: it is the parent `<P>`.

**The base branch.** Read the project and take `parent.base` as `<base>`. When `project.sh` fails, for example with
`has no Base: line`, stop and quote its message.

```bash
$RUNNING/../pj-design-and-plan/scripts/project.sh <P>
git ls-remote --exit-code --heads origin <base>
```

When `ls-remote` finds nothing, stop. The base branch is gone from origin. It may already have been merged into the
default branch and deleted.

Then make sure a local base branch exists, whatever the run holds. The fetch moves local refs and nothing else. The
second command creates the local branch from `origin/<base>` the first time.

```bash
git fetch --quiet origin "+refs/heads/<base>:refs/remotes/origin/<base>"
git rev-parse --verify --quiet refs/heads/<base> >/dev/null || git branch --track <base> origin/<base>
```

### Can a self-merge go through?

pj-running merges its own pull requests, so a rule on the base branch that wants another person's review stops it.
Write `{owner}` and `{repo}` literally, `gh` fills them in.

```bash
gh api "repos/{owner}/{repo}/rules/branches/<base>"
gh api "repos/{owner}/{repo}/branches/<base>" --jq .protected
gh api graphql -f query='{repository(owner:"<owner>",name:"<name>"){ref(qualifiedName:"refs/heads/<base>"){branchProtectionRule{requiredApprovingReviewCount requiresCodeOwnerReviews requiresStatusChecks}}}}'
ls CODEOWNERS .github/CODEOWNERS docs/CODEOWNERS 2>/dev/null
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

### Is `work-reports/` ignored?

workflow writes its reports there. Ask here, once, because a run from an issue never asks.

```bash
ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" check-ignore -q work-reports && echo IGNORED || echo NOT_IGNORED
```

On `NOT_IGNORED`:

```
AskUserQuestion: work-reports/ is not ignored in this repository. workflow writes its reports there.
  - Ignore it in this clone (Recommended) - adds work-reports/ to .git/info/exclude and commits nothing
  - Stop
```

On the first answer, append to the exclude file git resolves, then run the check again. In a linked worktree or a
submodule `.git` is a file, so write no path under it by hand.

```bash
printf 'work-reports/\n' >> "$(git -C "<ROOT>" rev-parse --path-format=absolute --git-path info/exclude)"
```

**Never edit `.gitignore` here.** That commit would land on the base branch with no pull request.

## Phase 1: the order

1. Read the project.

   ```bash
   $RUNNING/../pj-design-and-plan/scripts/project.sh <P>
   $RUNNING/../pj-design-and-plan/scripts/project.sh <P> --order
   ```

   **When `--order` fails on a cycle**, show the user the cycle it names and stop.
2. **Build the run order.** First put every open issue whose `pr.state` is `MERGED` at the front, whatever its labels
   and blockers. Its pull request has merged and only the close is left. Then walk `--order`. Take an issue when it
   is open, carries `ready`, and every open issue in its `blockedBy` is already in the run order. An issue put at the
   front counts as already in the run order.
3. Among the issues free to go next, one whose `pr.state` is `OPEN` goes first. Otherwise keep the `--order`
   sequence.
4. List the `ready` issues left out as **waiting**, each with the issue it waits on.
5. **An empty run order** ends the skill here. Report that nothing is workable, how many issues wait and how many are
   not `ready`, and the next step, `/annetaan:pj-design-details`. An issue with a merged pull request makes the run
   order non-empty.
6. Run `git branch -a` once. Pick a branch pattern in the repository's own naming that holds the issue number, such
   as `feat/<n>-<slug>`. Phase 3 shows it.

## Phase 2: the pre-check

First run `mktemp -d` once for the whole run, even when there is nothing to check. `$TMP` below is the directory it
printed. A shell variable does not outlive one command, so write the path in full each time.

Check every issue in the run order against the code before anything starts, except the ones whose `pr` is merged.
Their own `added` files exist now, so `--check` would fail them.

```bash
$RUNNING/../pj-design-and-plan/scripts/project.sh <P> --check <k>
```

**For each issue whose `ok` is false**, mark it.

1. Make sure `blocker` exists with the command in `format.md` under "Labels".
2. Take `ready` off and put `blocker` on.

   ```bash
   gh issue edit <k> --remove-label ready --add-label blocker
   ```

3. Write `$TMP/<k>-check.md` and post it. It starts with `**[pj-running]**`, then lists the lint codes, each premise
   failure (path, symbol, why) and each stale commit (SHA, subject, pull request), and ends with "Settle it with
   /annetaan:pj-design-details."

   ```bash
   gh issue comment <k> --body-file "$TMP/<k>-check.md"
   ```

**If any issue failed, do not start.** No issue in the order may need design when the run begins. Report which
issues failed and why, and the next step, `/annetaan:pj-design-details`.

## Phase 3: approval

Show the user:

- the project, `#<P> <title>`
- the run order, one line each as `#<k> <title>`, with "(resumes PR #<m>)" where `pr.state` is `OPEN` and "(merged
  as PR #<m>, closes now)" where it is `MERGED`
- the waiting list
- the base branch, the branch pattern and the merge method
- how each issue runs: a branch, workflow's **From an issue** (one task with review rounds in difit, then an
  integration review), a draft pull request into the base branch, then a merge by pj-running, which then closes the
  issue. GitHub does not close it on a merge into a branch other than the default branch.
- that merging the base branch into the default branch is the user's job, outside this skill
- that difit opens once, and the user can comment there at any time
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
   Skill(skill: "annetaan:workflow", args: "From an issue, driven by pj-running")
   ```

   Follow its **From an issue** section for every issue. **Load it again when a context summary has dropped it.**
2. Read the handover comment with the command in `format.md` under "The handover comment". Keep its lines as the
   handover notes. With no comment, the notes are empty.
3. The difit port starts as none.

## Phase 5: one issue at a time

Nothing runs in parallel. There is one working tree. For each issue `<k>` in the run order:

1. **Re-read the project** with `project.sh <P>`.
   - The issue is closed: skip it.
   - `ready` is gone, because a human took it off, and `pr` is not merged: skip it and every issue in the run waiting
     on it, and tell the user which.
2. **Check again** with `project.sh <P> --check <k>`, unless `pr` is merged. A failure gets the marks from phase 2,
   and the run stops (phase 6).
3. **Settle the entry state.**
   - **`pr.state` is `MERGED`** as `#<m>`: the state is `merged`. Write `$TMP/<k>-closed.md`. It starts with
     `**[pj-running]**`, says PR #<m> merged into `<base>`, and says pj-running closed the issue because GitHub does
     not close an issue on a merge into a branch other than the default branch. Then close the issue.

     ```bash
     gh issue comment <k> --body-file "$TMP/<k>-closed.md"
     gh issue close <k> --reason completed
     ```

     Print `#<k> done (<i>/<N>): PR #<m> merged earlier, issue closed` and take the next issue. No workflow run and
     no handover rewrite.
   - **`pr` is null**: the state is `fresh`.

     ```bash
     git switch <base>
     git pull --ff-only origin <base>
     git switch -c <branch>
     ```

     A local `<branch>` may be left over from a stop during the task. When `git rev-list --count <base>..<branch>`
     prints 0, delete it with `git branch -D <branch>` and create it again. Otherwise it holds unpushed work. Stop
     and ask the user.
   - **`pr.state` is `OPEN`** as `#<m>`:

     ```bash
     gh pr checkout <m>
     gh pr view <m> --json body
     ```

     The body holds the head from `format.md` **Pull requests**. `- [ ] Integration review` means
     `resume-integration`. Both lines checked means `resume-merge`. No head at all: stop and report.
4. **Run From an issue.** These are what it expects you to have settled, so say them in your context before you
   start it: `n` (= `<k>`), `P`, the issue title, the base branch, the checked-out branch, the entry state, `m`
   (none for `fresh`), the handover notes, and the difit port. After the first issue, keep the port workflow reports
   and pass it to every later one.

### Unplanned work

workflow hands over to this section by name. An `Unplanned:` report marked `later` arrives while the task goes on.

1. Write `$TMP/stub-<j>.md` in the shape of `format.md` **Stubs**. Its `## Goal` holds what was found, why it matters,
   and "found while working on #<k>".
2. File it with no label and no edges. pj-design-details sets the edges when it draws the stub.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/stub-<j>.md"
   ```

3. Tell the user in one line, and keep the number for the report.

### When workflow returns

workflow hands over to this section by name, with `finished` or `stopped`.

**`finished`** carries the pull request `<m>`, the SHA of the task commit, the handover lines, and the paths of any
screenshots that could not be attached.

1. Check the pull request.

   ```bash
   gh pr view <m> --json reviewDecision,mergeStateStatus,isDraft,body
   ```

   Stop when `reviewDecision` is `REVIEW_REQUIRED` or `CHANGES_REQUESTED`, when `mergeStateStatus` is `DIRTY`, or
   when the head in the body is not fully checked.
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
   draft with its head fully checked, so the next run picks it up as `resume-merge`.
3. `gh pr ready <m>`
4. Merge with the method from **Picking the merge method**. A failure stops the run.

   ```bash
   gh pr merge <m> --squash --delete-branch      # or --merge, or --rebase
   ```

5. Close the issue. The merge into the base branch closed nothing. Write `$TMP/<k>-closed.md` worded as in the
   `merged` case of phase 5 step 3, naming `#<m>`, then post it and close the issue.

   ```bash
   gh issue comment <k> --body-file "$TMP/<k>-closed.md"
   gh issue close <k> --reason completed
   ```

6. Bring the base branch up to date.

   ```bash
   git switch <base>
   git pull --ff-only origin <base>
   ```

7. **Fold the handover lines into the notes.** Merge duplicates, keep fifteen lines at most, and drop the oldest
   first. Rewrite the parent's handover comment as `format.md` says under "The handover comment": read its
   `updated_at` again first, and keep any change a human made since. Create it when there is none.
8. Print one progress line: `#<k> done (<i>/<N>): PR #<m> merged`. After a context summary, rebuild the run order and
   the progress from these lines and `project.sh <P>`.

Then take the next issue.

**`stopped`** carries the reason, the stash name or none, the pull request number or none, and the text of the
`Unplanned:` or `Diverged:` report. Act by the reason, then go to phase 6. Every comment below is written to a file
under `$TMP` and starts with `**[pj-running]**`.

- **`blocking`**: make sure `blocker` exists. File the stub in the shape of `format.md` **Stubs**, from the
  `Unplanned:` text, blocking `#<k>`.

  ```bash
  gh issue create --parent <P> --blocking <k> --label blocker --title "<title>" --body-file "$TMP/stub-<j>.md"
  ```

  Post a comment on `#<k>`: the run stopped, `#<k>` is blocked by the stub `#<b>`, and why. When there is a pull
  request, post one on it too (`gh pr comment <m> --body-file <file>`).
- **`diverged`**: make sure `blocker` exists, then `gh issue edit <k> --remove-label ready --add-label blocker`.
  Post a comment on `#<k>` with the `Diverged:` text, naming the decision as `#<x> D<n>` when there is one, and the
  same on the pull request when there is one.
- **`round cap`**: keep the labels. The body still holds, and the review did not settle. Post a comment on `#<k>`,
  and on the pull request when there is one, listing the points left open.
- **`user`**: nothing goes to GitHub.
- **`work-reports`**: report it. It should not happen after the check in **Before you start**.

## Phase 6: end of the run

Every way the run ends comes here: the run order is done, the run stopped, or the user said stop.

1. When a difit port was set, stop the server.

   ```bash
   $RUNNING/../workflow/scripts/difit-session.sh stop
   ```

2. `git switch <base>`.
3. `project.sh <P>`. **When every sub-issue is closed**, ask.

   ```
   AskUserQuestion: Close the parent #<P>?
     - Close
     - Leave open
   ```

   On Close, post a marked comment listing the merged pull requests, then close it.

   ```bash
   gh issue comment <P> --body-file "$TMP/<P>-closed.md"
   gh issue close <P> --reason completed
   ```

   Whatever the answer, tell the user that `<base>` holds the whole project and that merging it into the default
   branch is theirs to do.

## Report to the user

- the base branch `<base>`
- each merged issue with the URL of its pull request
- the stubs filed, the `later` ones and the `blocker` ones
- where the run stopped and why, or that the run order is done
- **the stash, when there is one, by name.** Say plainly that it is local, that a resume never applies it, and that
  the work in it gets redone
- the screenshots that could not be attached, with their paths and the URL of the pull request
- what is workable now and what is waiting
- the next step: `/annetaan:pj-design-details` when a `blocker` or a stub exists, otherwise `/annetaan:pj-running`.
  When every sub-issue is closed, the user merges `<base>` into the default branch.

## Rules

- **You never write code.** workflow's sessions do.
- **Only this session writes to GitHub.** workflow runs in this same session and pushes and opens the draft pull
  request there. Every comment starts with `**[pj-running]**`.
- **One issue at a time.**
- **Never `--admin`. Never create a label with `--force`. Always pass a body with `--body-file`.**
- **Never merge a pull request whose head is not fully checked.**
- **Whenever you take `ready` off an issue, add `blocker`.**
- **Never apply a stash.**
- **Never push to the base branch or the default branch, and never rewrite their history.**
- After a context summary, rebuild the run from the progress lines and `project.sh <P>`.
