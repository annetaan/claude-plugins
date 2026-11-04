# The issues

> This file is read by the main session that loaded the pj4-running skill. The paths it uses are the ones **Paths: `$RUNNING`** in SKILL.md gives.

## Phase 1: the order

1. Read the project.

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh <P>
   $RUNNING/../pj1-plan/scripts/project.sh <P> --order
   ```

   Read `project.sh`'s output whole, as `between-skills.md` says under **Commands**.

   **When `--order` fails on a cycle**, within the project or between projects, show the user the cycle it names
   and stop.
2. **Build the run order.** First put every open issue whose `pr.state` is `MERGED` at the front, whatever its labels
   and blockers. Its pull request has merged and only the close is left. Then walk `parent.order` from the top and
   skip the closed issues. Take each open issue while it is workable (`state.md`, **When an issue is workable**), with
   the issues already taken counting as closed. Phase 2 runs the `--check` part of that. **Stop the walk at the first
   open issue that is not.** Nothing after it is taken, even when it is workable, because the order is the user's
   (`format.md`, **The run order**).
   - **`parent.order` is empty, or `parent.orderCheck.ok` is false**: the run order is the merged-pull-request issues
     alone, and the walk does not start. Show what `orderCheck` names, and give the next step, `/annetaan:pj3-doctor`.
     With no such issue the run order is empty and phase 1 ends here (step 4).
3. List the issue the walk stopped at, with why it is not workable, and the open issues after it as **waiting**. List
   the issues in `orderCheck.missing` too, as not in the order.
4. **An empty run order** ends the skill here. Report the issue the walk stopped at and why, and the next step,
   `/annetaan:pj3-doctor`. An issue with a merged pull request makes the run order non-empty.
5. Run `git branch -a` once. Pick a branch pattern in the repository's own naming that holds the issue number, such
   as `feat/<n>-<slug>`. Phase 3 shows it.

## Phase 2: the pre-check

Check every issue in the run order against the code before anything starts, except the ones whose `pr` is merged.
Their own `added` files exist now, so `--check` would fail them.

```bash
$RUNNING/../pj1-plan/scripts/project.sh <P> --check <k>
```

**For each issue whose `ok` is false**, mark it.

1. Make sure `blocker` exists with the command in `between-skills.md` under "Labels".
2. Take `ready` off and put `blocker` on.

   ```bash
   gh issue edit <k> --remove-label ready --add-label blocker
   ```

3. Write `$TMP/<k>-check.md` and post it. It starts with `**[pj4-running]**`, then lists the lint codes, each premise
   failure (path, symbol, why) and each stale commit (SHA, subject, pull request), and ends with "Settle it with
   /annetaan:pj3-doctor."

   ```bash
   gh issue comment <k> --body-file "$TMP/<k>-check.md"
   ```

**If any issue failed, do not start.** No issue in the order may need design when the run begins. Report which
issues failed and why, and the next step, `/annetaan:pj3-doctor`.

## Phase 3: approval

Show the user:

- the project, `#<P> <title>`
- the run order, one line each as `#<k> <title>`, with "(PR #<m> open, merges now)" where `pr.state` is `OPEN` and
  "(merged as PR #<m>, closes now)" where it is `MERGED`
- the waiting list
- the base branch, with "created now from `<from>` at `<sha>`" when this run created it, the branch pattern and the
  merge method, `rules.mergeMethod`
- each parent closed at the start, as `#<Q>`
- the worktree `<WT>`, where the whole run happens, and that `<MAIN>` is not touched, so the user can keep working
  there
- that `#<P>` is assigned to `<login>` (now, when this run assigned it), and that the assignment stays for the life of
  the project
- that `<WT>` has none of `<MAIN>`'s ignored files, such as dependencies or a `.env`, so the first worker prepares
  them
- how each issue runs: a branch, workflow's **From an issue** (one task with review rounds, with the review files
  in its work report), a draft pull request into the base branch, then a merge by pj4-running, which then closes the
  issue. GitHub does not close it on a merge into a branch other than the default branch.
- that once every sub-issue is closed, the run merges `<from>` into the base branch and pushes the merge there, with
  workflow's **From a sync** resolving any conflict under review, then opens the project's pull request from the base
  branch into `<from>`, that merging it is the user's job, and that the parent `#<P>` closes as completed once a run
  sees that merge
- that the run stops on a blocker, a divergence, the round cap, a merge or a push that does not go through, or the
  user saying stop

```
AskUserQuestion: Start the run?
  - Start the run
  - Do not start
```

An unattended run skips this question, prints the same summary, and starts.

The approval covers this run only (`between-skills.md`, **Principle**).

## Phase 4: before the first issue

1. Load workflow.

   ```
   Skill(skill: "annetaan:workflow", args: "From an issue, driven by pj4-running")
   ```

   Follow its **From an issue** entry, `from-issue.md` in the workflow skill, for every issue. **Load it again, and read `from-issue.md` again, when a context summary has dropped it.**
2. Read the handover comment with the command in `between-skills.md` under "The handover comment". Keep its lines
   as the handover notes. With no comment, the notes are empty.

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
     `**[pj4-running]**`, says PR #<m> merged into `<base>`, and says pj4-running closed the issue because GitHub does
     not close an issue on a merge into a branch other than the default branch. Then close the issue.

     ```bash
     $RUNNING/scripts/run.sh close <P> <k> --comment "$TMP/<k>-closed.md"
     ```

     Print `#<k> done (<i>/<N>): PR #<m> merged earlier, issue closed` and take the next issue. No workflow run and
     no handover rewrite.
   - **`pr.state` is `OPEN`** as `#<m>`: its task commit passed review, and only the merge is left. Go to **When
     workflow returns**, as `finished` with `<m>` and no handover lines. No workflow run and no handover rewrite.
   - **`pr` is null**: make a fresh branch in `<WT>` from the tip of `origin/<base>`, then run From an issue.

     ```bash
     $RUNNING/scripts/run.sh branch <P> <branch>
     ```

     - **`ok`**: go to step 4. A leftover `<branch>` with no commits of its own was deleted and made again.
     - **`stop`** with `unpushed`: stop the run. Name `<branch>` and the number in `commits`, and say that
       `git -C <WT> log origin/<base>..<branch>` shows them. A `finish` stop in an earlier run leaves exactly this.
       The user picks the way out. A draft pull request from `<branch>` into `<base>` with the work report's `log.md`
       as its body makes the next run merge it. Deleting `<branch>` makes the next run redo the issue.
     - **`stop`** with `checked-out`: stop the run, and name the worktree in `worktree` that holds `<branch>`.
4. **Run From an issue.** These are what it expects you to have settled, so say them in your context before you
   start it: `n` (= `<k>`), `P`, the issue title, the projects `<P>` waits on (the `parent.waitsOn` numbers, or
   none), the base branch, the branch you just made, the handover notes, and the paths `<WT>` and `<MAIN>`.

### When workflow returns

workflow hands over to this section by name, with `finished` or `stopped`.

**`finished`** carries the pull request `<m>`, the SHA of the task commit, the handover lines, the paths of any
screenshots that could not be attached, and `stop requested` (yes or no).

**With `stop requested: yes`, do not merge.** The user said stop. Fold the handover lines as step 3 says, then go to
phase 6. The pull request stays a draft, and the next run merges it.

1. Write `$TMP/<k>-closed.md` worded as in the `merged` case of phase 5 step 3, naming `#<m>`. The merge into the base
   branch closes nothing, so `run.sh merge` closes the issue with it.
2. Merge the pull request, close `#<k>`, move `<WT>` onto the merged base and delete the head branch. Run this as a
   background command and wait for it to exit, because waiting on the checks can outlast a foreground command. The
   output goes to files, because the background task's own output file lies outside the run's working directories and
   an unattended run cannot read it. Then read `$TMP/<k>-merge.json` with Read and act on that JSON. On a non-zero exit, read `$TMP/<k>-merge.err` with
   Read, quote it and stop the run, as the `run.sh` rule says.

   ```bash
   $RUNNING/scripts/run.sh merge <P> <k> <m> --comment "$TMP/<k>-closed.md" > "$TMP/<k>-merge.json" 2> "$TMP/<k>-merge.err"
   ```

   - **`stop`** with `review`, `conflict`, `merge-failed` or `not-the-pr`: say so, quote `message`, and go to phase 6.
   - **`stop`** with `no-checks`, `checks-unreadable` or `checks-failed`: quote `message`. The pull request stays a
     draft, and the next run merges it. Go to phase 6.
   - **`merged`** with a non-empty `errors`: the merge went through, and a later step failed. Report each `step` with
     its `message`, fold the handover lines as step 3 says, then go to phase 6. When `close` failed, the issue stays
     open with its pull request merged, and the next run closes it.
   - **`merged`**: go on.
3. **Fold the handover lines into the notes**, as **Folding the handover lines** in SKILL.md says. With no
   handover lines, as on the `OPEN` path of phase 5 step 3, skip this step.
4. Print one progress line: `#<k> done (<i>/<N>): PR #<m> merged`. After a context summary, rebuild the run order and
   the progress from these lines and `project.sh <P>`.

Then take the next issue. When the run order is done, go to phase 6 in SKILL.md.

**`stopped`** carries the reason, `<WORKDIR>` (the absolute path, or none), and the text of the
`Unplanned:` or `Diverged:` report, or for `finish` the failed step. A stopped run has opened no pull request.

When `<WORKDIR>` is set, save the work first, before any comment, so that `<WT>` is clean when the run goes on.

```bash
$RUNNING/scripts/run.sh save <P> --to <WORKDIR>/stopped.diff
```

Act by what it prints.

- **`clean`**: no work was left. Name no file.
- **`saved`**: keep `file`, `head`, `merge`, `left` and `errors`. The diff in `file` applies to `head`, and `<WT>` is
  clean apart from what `left` lists. A `merge` that is not null is the SHA of a merge in progress that the save
  ended: the diff holds its conflicted files, and the merge itself is gone. A path in `left` stays in `<WT>` and may not be in `file`, as with a nested git
  repository. A step in `errors` is a reset or a clean that failed.
- A non-zero exit: an exception to the `run.sh` rule in **Paths: `$RUNNING`** in SKILL.md, because the stop is already under way.
  Quote the message, say the work stays uncommitted in `<WT>`, and carry on with the reason's steps, so the blocker
  stub is still filed.

Then act by the reason, and go to phase 6. Every comment below is written to a file under `$TMP` and starts with
`**[pj4-running]**`. When `save` printed `saved`, each comment of `blocking`, `diverged` and `round cap` says that
the work so far is saved on the machine that ran this, at `file`, that the next run redoes the issue, and which
paths of `left` stay in `<WT>` when there are any. After a `save` that failed or stopped, it says that the work
stays uncommitted in `<WT>`.

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
- **`work-reports`**: report it. It should not happen after the check in **Paths this clone must ignore** in SKILL.md.
- **`finish`**: report the failed step of workflow's phase 6, its message, and the path of `log.md` when there is one.
  The next run stops on the task commit as `unpushed` in phase 5 step 3, which names the way out.
