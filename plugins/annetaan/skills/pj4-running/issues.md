# The issues

> This file is read by the main session that loaded the pj4-running skill. The paths it uses are the ones **Paths: `$RUNNING`** in SKILL.md gives.

## Phase 1: the order

1. Read the project.

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh <P>
   $RUNNING/../pj1-plan/scripts/project.sh <P> --order
   ```

   Read `project.sh`'s output whole, as `pj1-plan/between-skills.md` says under **Commands**.

   **When `--order` fails on a cycle**, within the project or between projects, show the user the cycle it names
   and stop.
2. **Build the run order.** First put every open issue whose `pr.state` is `MERGED` at the front, whatever its labels
   and blockers. Its pull request has merged and only the close is left. Then walk `parent.order` from the top and
   skip the closed issues. Take each open issue while it is workable (`pj1-plan/state.md`, **When an issue is workable**), with
   the issues already taken counting as closed. **Stop the walk at the first
   open issue that is not.** Nothing after it is taken, even when it is workable, because the order is the user's
   (`pj1-plan/format.md`, **The run order**). The roadmap task is not workable while `parent.roadmap.missing` is not empty
   (`pj1-plan/state.md`, **When an issue is workable**), whatever the walk has already taken.
   - **`parent.order` is empty, or `parent.orderCheck.ok` is false**: the run order is the merged-pull-request issues
     alone, and the walk does not start. Show what `orderCheck` names, and give the next step, `/annetaan:pj3-doctor`.
     With no such issue the run order is empty and phase 1 ends here (step 4).
3. List the issue the walk stopped at, with why it is not workable (for the roadmap task: it is not blocked by every
   open sub-issue, naming the numbers in `parent.roadmap.missing`, and `/annetaan:pj3-doctor` adds the edges), and the open issues after it as **waiting**. List
   the issues in `orderCheck.missing` too, as not in the order.
4. **An empty run order** ends the skill here. Report the issue the walk stopped at and why, and the next step,
   `/annetaan:pj3-doctor`. An issue with a merged pull request makes the run order non-empty.
5. Run `git branch -a` once. Pick a branch pattern in the repository's own naming that holds the issue number, such
   as `feat/<n>-<slug>`. Phase 2 shows it.

## Phase 2: approval

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
- how each issue runs: a branch, workflow's **From an issue**, where a design session details the issue against the code
  on the base branch and may redraw its body and the order of the issues left, then one or more reviewed commits (with
  the review files in its work report) and an integration review when there is more than one, a draft pull request into
  the base branch, then a merge by pj4-running, which then closes the issue. GitHub does not close it on a merge into a
  branch other than the default branch.
- that once every sub-issue is closed, the run merges `<from>` into the base branch and pushes the merge there, with
  workflow's **From a sync** resolving any conflict under review, then opens the project's pull request from the base
  branch into `<from>`, that merging it is the user's job, and that the parent `#<P>` closes as completed once a run
  sees that merge
- that the run stops on a blocker, a decision only the user can make (the run adds it to the issue), a detail pass
  that cannot draw a body that passes the checks, the round cap, a merge or a push that does not go through, or the
  user saying stop

```
AskUserQuestion: Start the run?
  - Start the run
  - Do not start
```

An unattended run skips this question, prints the same summary, and starts.

The approval covers this run only (`pj1-plan/between-skills.md`, **Principle**).

## Phase 3: before the first issue

Take **Before workflow runs** in SKILL.md with From an issue. Its entry, `workflow/from-issue.md`, is followed for every issue.

## Phase 4: one issue at a time

Nothing runs in parallel. There is one worktree, `<WT>`. For each issue `<k>` in the run order:

1. **Re-read the project** with `project.sh <P>`.
   - The issue is closed: skip it.
   - The issue is no longer workable (`pj1-plan/state.md`, **When an issue is workable**), and its `pr` is not merged, as when a
     human took `ready` off or a stub was filed during this run: the run stops here, as the walk in phase 1 would have.
     Tell the user the reason, put no label on the issue, give `/annetaan:pj3-doctor` as the next step, and go to
     phase 5.
   - The issue is `parent.roadmap.task` and `parent.roadmap.missing` is not empty: the issue is no longer workable
     either, so the same stop applies.
2. **Take the path `pr` gives.**
   - **`pr.state` is `MERGED`** as `#<m>`: close the issue. Write `$TMP/<k>-closed.md`. It starts with
     `**[pj4-running]**`, says PR #<m> merged into `<base>`, and says pj4-running closed the issue because GitHub does
     not close an issue on a merge into a branch other than the default branch. Then close the issue.

     ```bash
     $RUNNING/scripts/run.sh close <P> <k> --comment "$TMP/<k>-closed.md"
     ```

     Print `#<k> done (<i>/<N>): PR #<m> merged earlier, issue closed` and take the next issue. No workflow run and
     no handover rewrite.
   - **`pr.state` is `OPEN`** as `#<m>`: its commits passed review, and only the merge is left. Go to **When
     workflow returns**, as `finished` with `<m>` and no handover lines. No workflow run and no handover rewrite.
   - **`pr` is null**: make a fresh branch in `<WT>` from the tip of `origin/<base>`, then run From an issue.

     ```bash
     $RUNNING/scripts/run.sh branch <P> <branch>
     ```

     - **`ok`**: go to step 3. A leftover `<branch>` with no commits of its own was deleted and made again.
     - **`stop`** with `unpushed`: stop the run. Name `<branch>` and the number in `commits`, and say that
       `git -C <WT> log origin/<base>..<branch>` shows them. A `finish` stop in an earlier run leaves exactly this.
       The `log.md` of the work report has its `Implements #<k>` head only once `record` has run, which a finish
       that stopped early did not do, so run `status` first:

       ```bash
       $RUNNING/../workflow/scripts/panel.sh status <WT>
       ```

       When it prints `ok` with an `issue` equal to `<k>`, run `record`, which leaves a head already there as it is:

       ```bash
       $RUNNING/../workflow/scripts/panel.sh record <WT>
       ```

       - **`record` prints `ok`**: the user picks the way out. Pushing `<branch>` with
         `git -C <WT> push -u origin <branch>` and opening a draft pull request from it into `<base>` with
         `<workdir>/log.md` as its body (`workdir` from `status`) makes the next run merge it. Deleting `<branch>`
         makes the next run redo the issue.
       - **Anything else**: `status` printed `stop` or exited non-zero, its `issue` is not `<k>`, or `record`
         printed `stop` or exited non-zero. Quote the `message` (stderr on a non-zero exit). Deleting `<branch>` is
         the only way out, and it makes the next run redo the issue.
     - **`stop`** with `checked-out`: stop the run, and name the worktree in `worktree` that holds `<branch>`.
3. **Read the check** on the `null` path, after `run.sh branch`, and keep the JSON. Nothing stops on it. The design
   session reads it in the detail pass.

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh <P> --check <k>
   ```

4. **Run From an issue.** These are what it expects you to have settled, so say them in your context before you
   start it: `n` (= `<k>`), `P`, the issue title, the projects `<P>` waits on (the `parent.waitsOn` numbers, or
   none), the base branch, the branch you just made, the handover notes, the `project.sh <P>` JSON, the
   `project.sh <P> --check <k>` JSON, and the paths `<WT>` and `<MAIN>`.

### A redrawn issue

workflow hands over to this section by name, with the design session's `Body:`, `Order:` and `Notes:`, and with
`Stop: ask` when its `Body:` carries a new decision. `<a>` and `<b>` below are issue numbers of open sub-issues of
`#<P>`.

1. **Check the body.** Read `updatedAt` first and keep it, then read the body and write it to `$TMP/<k>-before.md`, and
   write the redrawn body to `$TMP/<k>-redrawn.md`. A human edit between the two reads moves `updatedAt` past the kept
   value, so step 2 still catches it. Every pass through this section reads them again, because the passes before it
   wrote the issue.

   ```bash
   gh issue view <k> --json updatedAt --jq .updatedAt
   ```

   ```bash
   gh issue view <k> --json body --jq .body > "$TMP/<k>-before.md"
   ```

   Lint it, with `decisions-open` as the only reason allowed under `Stop: ask` and no reason allowed otherwise, then
   compare it with the body on GitHub.

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh --lint - < "$TMP/<k>-redrawn.md"
   ```

   ```bash
   git diff --no-index -- "$TMP/<k>-before.md" "$TMP/<k>-redrawn.md"
   ```

   The command exits 1 when the two differ, which is the usual case, and that is no failure.

   `## Goal` and every existing decision, boxes as ticked, are untouched in the diff. Under `Stop: ask` the one change
   to `## Decisions` is the decision appended after the highest `D<n>`, with no box checked. A user ticking boxes and
   `pr-humans` both rely on that.
2. **Write the body.** Read `updatedAt` again with `gh issue view <k> --json updatedAt`. When it is not the one kept in
   step 1, a human edited the issue during the pass: write nothing and take the stop `user` in
   **When workflow returns**, saying so. Otherwise:

   ```bash
   gh issue edit <k> --body-file "$TMP/<k>-redrawn.md"
   ```

   Under `Stop: ask`, steps 1 and 2 are all that run here. Take the stop `decision` in **When workflow returns**.
3. **Write the edges and the order.** For each `Order:` line:

   ```bash
   gh issue edit <a> --add-blocked-by <b>
   ```

   ```bash
   gh issue edit <a> --remove-blocked-by <b>
   ```

   Then `project.sh <P> --order`. When it fails, undo the edges you wrote, each with the opposite flag, and count it as
   a failure of this step. Otherwise rewrite `## Order` from the parent's body as GitHub has it now:

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh <P> --order-body > "$TMP/<P>-order.md"
   ```

   ```bash
   gh issue edit <P> --body-file "$TMP/<P>-order.md"
   ```

   With no `Order:` line, skip this step.
4. **Post the notes.** Write one comment per `Notes:` line to a file under `$TMP` and post it on `#<m>`. Write one on
   `#<k>` with the change lines of `Body:` and the `Order:` lines. Every comment starts with `**[pj4-running]**`.

   ```bash
   gh issue comment <m> --body-file "$TMP/<k>-note-<m>.md"
   ```

5. **Check the issue again.** Run `project.sh <P> --check <k>` and require `lint.ok`, an empty `premises.failures`, an
   empty `breakage.unclosed` and an empty `roadmap.several-tasks`. `breakage.unclosed` is project-wide, so a redraw that
   drops a closer's criterion is caught here.
6. **A failure.** A failure that is format-only you fix yourself first, as `pj1-plan/between-skills.md` says under
   **Format-only fixes**: a lint reason in step 1, or `symbol never in the file` or a lint reason in step 5. `<before>`
   is `$TMP/<k>-redrawn.md` and `<after>` is `$TMP/<k>-form.md`.

   ```bash
   $RUNNING/../pj1-plan/scripts/project.sh --same-words "$TMP/<k>-redrawn.md" "$TMP/<k>-form.md"
   ```

   Go on when `ok` is true and `lint` is what step 1 accepts: `decisions-open` only under `Stop: ask`, no reason
   otherwise. Write the fixed body with Write to `$TMP/<k>-redrawn.md`. A fix in step 1 goes on from step 1's
   lint of that file. A fix in step 5 runs steps 1, 2 and 5 again, because steps 3 and 4 are already written. The rerun
   reads `updatedAt` and the body afresh and lints and compares `$TMP/<k>-redrawn.md` as it now stands, and does not
   write `Body:` to it again. Tell the design session the lines
   that changed, old and new, with `SendMessage`, and do not wait for an answer. **The fix counts against neither
   return below**, and there is one fix per failure.

   Any other failure in step 1, 3 or 5, and a failure that outlasts the fix, goes back to the design session once, with
   `SendMessage`, carrying the lint reasons, the diff or the failing JSON. It returns a new `Body:` and `Order:`, and the
   steps run again. A second failure takes the stop `detail`. A failure in step 3, the edges and `--order`, is never
   format-only.

Print `#<k> redrawn`. When `#<k>` has an open blocker after step 3 (read `project.sh <P>` again), answer `reordered`.
Otherwise answer go on.

### When workflow returns

workflow hands over to this section by name, with `finished`, `stopped`, `nothing-left` or `reordered`.

**`finished`** carries the pull request `<m>`, the SHA of the last commit, the handover lines, the paths of any
screenshots that could not be attached, and `stop requested` (yes or no).

**With `stop requested: yes`, do not merge.** The user said stop. Fold the handover lines as step 3 says, then go to
phase 5. The pull request stays a draft, and the next run merges it.

1. Write `$TMP/<k>-closed.md` worded as in the `merged` case of phase 4 step 2, naming `#<m>`. The merge into the base
   branch closes nothing, so `run.sh merge` closes the issue with it.
2. Merge the pull request, close `#<k>`, move `<WT>` onto the merged base and delete the head branch. The merge waits
   for every check on the pull request to pass, required or not. Run this as a
   background command and wait for it to exit, because waiting on the checks can outlast a foreground command. The
   output goes to files, because the background task's own output file lies outside the run's working directories and
   an unattended run cannot read it. Then read `$TMP/<k>-merge.json` with Read and act on that JSON. On a non-zero exit, read `$TMP/<k>-merge.err` with
   Read, quote it and stop the run, as the `run.sh` rule says.

   ```bash
   $RUNNING/scripts/run.sh merge <P> <k> <m> --comment "$TMP/<k>-closed.md" > "$TMP/<k>-merge.json" 2> "$TMP/<k>-merge.err"
   ```

   - **`stop`** with `review`, `conflict`, `merge-failed` or `not-the-pr`: say so, quote `message`, and go to phase 5.
   - **`stop`** with `no-checks`, `checks-unreadable` or `checks-failed`: quote `message`. The pull request stays a
     draft, and the next run merges it. After `checks-failed` the next run stops again until the checks pass, from a
     push to the branch or a rerun of the failed jobs (`gh run rerun <id> --failed`). Go to phase 5.
   - **`merged`** with a non-empty `errors`: the merge went through, and a later step failed. Report each `step` with
     its `message`, fold the handover lines as step 3 says, then go to phase 5. When `close` failed, the issue stays
     open with its pull request merged, and the next run closes it.
   - **`merged`**: go on.
3. **Fold the handover lines into the notes**, as **Folding the handover lines** in SKILL.md says. With no
   handover lines, as on the `OPEN` path of phase 4 step 2, skip this step.
4. Print one progress line: `#<k> done (<i>/<N>): PR #<m> merged`. After a context summary, rebuild the run order and
   the progress from these lines and `project.sh <P>`.

Then take the next issue. When the run order is done, go to phase 5 in SKILL.md.

**`stopped`** carries the reason, `<WORKDIR>` (the absolute path, or none), `<START>`, and the text: the `Unplanned:`
report, the decision `#<k> D<d>`, the failing lint or `--check` JSON, or for `finish` the failed step. A stopped run has
opened no pull request.

When `<WORKDIR>` is set and the reason is not `finish`, save the work first, before any comment, so that `<WT>` is clean
and detached on `<START>` when the run goes on. The save holds everything since `<START>`, commits included.

```bash
$RUNNING/scripts/run.sh save <P> --to <WORKDIR>/stopped.diff --since <START>
```

`finish` calls nothing: its commits and its branch are what the next run finds as `unpushed` in phase 4 step 2.

Act by what it prints.

- **`clean`**: no work was left. Name no file.
- **`saved`**: keep `file`, `head`, `branch`, `commits`, `merge`, `left` and `errors`. The diff in `file` holds the
  `commits` commits and the uncommitted work, and applies onto `head`, which is `<START>`. `<WT>` is detached on `head`,
  the branch `branch` is deleted, and `<WT>` is clean apart from what `left` lists. A path in `left` stays in `<WT>` and may not
  be in `file`, as with a nested git repository. A step in `errors` is a reset, a clean, the detach or the branch
  delete that failed.
- A non-zero exit: an exception to the `run.sh` rule in **Paths: `$RUNNING`** in SKILL.md, because the stop is already under way.
  Quote the message, say the work stays in `<WT>`, and carry on with the reason's steps, so the stub or the notices are
  still filed.

Then act by the reason, and go to phase 5. Every comment below is written to a file under `$TMP` and starts with
`**[pj4-running]**`. When `save` printed `saved`, each comment of `blocking`, `detail` and `round cap` says that
the work so far, commits included, is saved on the machine that ran this, at `file`, that the next run redoes the
issue, and which paths of `left` stay in `<WT>` when there are any. After a `save` that failed or stopped, it says that
the work stays in `<WT>`.

- **`blocking`**: make sure `blocker` exists. File the stub in the shape of `pj1-plan/format.md` **Stubs**, from the
  `Unplanned:` text, blocking `#<k>`.

  ```bash
  gh issue create --parent <P> --blocking <k> --label blocker --title "<title>" --body-file "$TMP/stub-<j>.md"
  ```

  Post a comment on `#<k>`: the run stopped, `#<k>` is blocked by the stub `#<b>`, and why.
- **`decision`**: the design session found something only the user can settle, and **A redrawn issue** wrote the body
  with the new decision `D<d>` to GitHub. Take `ready` off, and put no `blocker` on, because the user comes first.

  ```bash
  gh issue edit <k> --remove-label ready
  ```

  Bring the title to `wantedTitle` from `project.sh <P>` (`pj1-plan/between-skills.md`, **Titles**) with
  `gh issue edit <k> --title "<wantedTitle>"`. Post a comment on `#<k>` that names `#<k> D<d>`, says what the design
  session found and that the issue is held until it is settled, and says to tick it and run `/annetaan:pj3-doctor`.
  `--next` reads `user` / `decisions`, and after the tick `doctor` / `not-ready`.
- **`detail`**: the redrawn body or its edges did not get past the checks twice. Make sure `blocker` exists, then
  `gh issue edit <k> --remove-label ready --add-label blocker`. Post a comment on `#<k>` with the failing lint or
  `--check` JSON, and say to settle it with `/annetaan:pj3-doctor`. `--next` reads `doctor` / `blocker`.
- **`round cap`**: keep the labels. The body still holds, and the review did not settle. Post a comment on `#<k>`
  listing the points left open.
- **`user`**: nothing goes to GitHub.
- **`work-reports`**: report it. It should not happen after the check in **Paths this clone must ignore** in SKILL.md.
- **`finish`**: report the failed step of workflow's finish, its message, and the path of `log.md` when there is one.
  The next run stops on the commits as `unpushed` in phase 4 step 2, which names the way out.

**`nothing-left`** carries `<WORKDIR>`, `<START>` and the evidence: the design session found that the code on the base
branch already makes the goal true. Run the same `save` call, so that `<WT>` is clean and the branch is gone. Post a comment on
`#<k>` with the evidence, `ran:` and `saw:` per acceptance criterion, and close it as completed, so it still counts as a
closer in `parent.breakage`.

```bash
gh issue close <k> --reason completed
```

Print `#<k> done (<i>/<N>): nothing left, closed` and take the next issue. No handover rewrite.

**`reordered`** carries `<WORKDIR>` and `<START>`: a redraw gave `#<k>` an open blocker, so the issue is set aside.
Run the same `save` call, print `#<k> set aside`, rebuild the run order as phase 1 step 2 says, and take the next issue.
