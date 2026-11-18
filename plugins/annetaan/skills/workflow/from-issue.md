# From an issue

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

pj4-running loads this skill to run one sub-issue of a project. The issue is the approved design in its goal, its
boundary and its checked decisions. A design session details it against the code on the base branch first, may
redraw its body, and stays for the whole run. This entry has no design review, no approval and no questions. The shape
of the issue is in `$FLOW/../pj1-plan/format.md`, and the shape of its pull request in
`$FLOW/../pj1-plan/between-skills.md` under **Pull requests**.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the issue number `n`, the parent `P`, and the issue title
- the projects `P` waits on, `Q1, Q2, …` (`parent.waitsOn` in `project.sh`), or none
- the base branch (the parent's `Base:` line), and the branch pj4-running just made from the tip of the base branch
- the handover notes, from the parent's handover comment (`between-skills.md`, **The handover comment**)
- the run's worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, and the branch is
  checked out there
- `attach` from pj4-running's `run.sh start`, which has run its checks: whether `--attach` works
- the `project.sh <P>` JSON from pj4-running's re-read, and the `project.sh <P> --check <n>` JSON it read after making
  the branch

pj4-running has already run its checks (`gh`) on `<WT>` and confirmed that `work-reports/` is ignored there.
Every command below runs in `<WT>`, so `<ROOT>` and `<WORKDIR>` come from there. Never touch
`<MAIN>`. The user works in it during the run.

## What it runs of phases 2 to 5

This entry asks nothing and writes nothing to memory. Its ending is **What it hands back to pj4-running** below, which replaces any report to the user.

- **Phase 1** does not run. **The detail pass** below takes its place.
- **Phase 2 (a)** does not run. pj4-running owns the branch.
- **Phase 2 (b)** runs as a guard only, because (d) needs `<ROOT>` from the first command.

  ```bash
  git rev-parse --show-toplevel
  git -C <ROOT> check-ignore -q work-reports/
  ```

  On exit 1, take the stop procedure with the reason `work-reports`. Never ask about `.gitignore` here.
- **Phase 2 (c) and (d)**, **The detail pass**, and **phases 3 and 4** run as **Start point and work directory**,
  **The detail pass** and **Phases 3 and 4** below say.
- **Phase 5** runs after the last task when the plan has two or more tasks, as **Phase 5: integration review** in
  `standalone.md` says, with its round cap ending in **The stop procedure** below. With one task it does not run, and
  the task's implementation session stays alive as the standalone flow keeps it, because it writes the work report in
  **Phase 6 from an issue**. Its review session ends as usual.
- **The round cap**, and the user saying stop, end in **The stop procedure**, with no question to the user.

## Start point and work directory

Phase 2 (c) takes `<START>` from `git rev-parse HEAD`, right after pj4-running made the branch. Phase 2 (d) runs as
written.

## The detail pass

Read `$FLOW/roles/design.md` only to name it in the prompt. The design session reads it itself. Create
`<WORKDIR>/scratch/design` with `mkdir -p`. Then start the design session.

```
Agent(subagent_type: "annetaan:workflow-design", description: "detail issue #<n>",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes, and within it **Detailing an issue**.\n\nThe issue: #<n>, \"<issue title>\"\nThe parent: #<P>\nWaits on: <#Q1, #Q2, or none>\nThe format of an issue: $FLOW/../pj1-plan/format.md\nThe script that reads a project: $FLOW/../pj1-plan/scripts/project.sh\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check <n>:\n<the JSON>\n\nLeft broken on the base branch:\n<the same lines the implementation prompts carry, or none>\n\nHandover notes from the earlier sessions:\n<the notes, or none>\n\nScratch: <WORKDIR>/scratch/design\n\n<the worktree line>")
```

`annetaan:workflow-design` has its model and effort pinned in `agents/*.md`. **When it cannot start** (a weekly limit, a rate limit,
the model is unavailable), spawn it again with the same prompt and `model: "opus"`. Collapse
the `..` in the two paths into `<skills>/pj1-plan/...`, as SKILL.md says for `$RUNNING`.

By what comes back:

- **`Unplanned:` lines**: `later` goes to pj4-running's **Unplanned work** as soon as it arrives. `blocking` is the stop
  `blocking`.
- **`Stop: nothing left`**: nothing was committed. Return `nothing-left` with the evidence.
- **`Stop: ask`**: hand `Body:` to pj4-running's **A redrawn issue**, then take the stop `decision`.
- **A `Body:`, an `Order:` or a `Notes:` that is not `unchanged` or `none`**: hand it to **A redrawn issue**. It comes
  back as go on, as `reordered` (return it), as the stop `detail`, or as the stop `user` (a human edited the issue
  during the pass).
- **Otherwise** go on.

## The design, the plan and the detail

Read the issue again from GitHub after every redraw. Read its parent, and the parent of every project `P` waits on.

```bash
gh issue view <n> --json body
gh issue view <P> --json body
gh issue view <Q> --json body   # each Q
```

- **The approved design**, for every prompt in phases 3 to 5: the issue as it now reads on GitHub, with `## Decisions`
  cut down to the checked option, the lines under its box and the `Decided:` line of each, plus the parent's
  `## Design` and the `## Design` of each `Q`, which holds the boundaries those projects define (`format.md`, **The
  parent issue body**).
- **The plan and the detail of task 1**: the design session's.
- **The commit**: in phase 4 (d), ask for a subject that follows the repository's style and names the task. A plan of
  one task names the issue title.

## Phases 3 and 4

They run as written in SKILL.md, phase 4 (a) included: from task 2 onward the design session details each task. Each
task gets a new implementation session and a new review session, five rounds, one commit. **When the plan breaks** and a
`Diverged:` report go to the design session with `SendMessage`. A new `Body:` from it goes through **A redrawn issue**
again, and `Stop: ask` is the stop `decision`. Existing decisions stay byte for byte in every redraw. The prompts gain
a line each.

- The phase 3 prompt: "This run comes from issue #<n>. Follow **Work outside the task** in your role instruction."
- The review prompt: "The design is issue #<n>. Its checked decisions bind."
- Every prompt, implementation and review alike, carries **the worktree line** (**The worktree line** in SKILL.md).
- Every prompt, implementation and review alike, carries "Left broken on the base branch:" with one line per entry of `parent.breakage` whose `state` is `open` and whose `closedBy` does not hold `#<n>`, as `` `<check>` (left by #<j>) ``, or "none". An entry this issue closes is left out, because its check has to pass here. The declared reason is in `#<j>`'s `### Left broken`, read with `gh issue view <j> --json body` (a body, not a comment). pj4-running has the `project.sh <P>` JSON from its re-read.
- Every review request, the round 1 prompt and each "review it again" `SendMessage`, also carries the adaptations
  the implementation session has listed so far, under "Adaptations", or "none".

Keep the handover lines from phase 4 (d) for pj4-running.

## Reports from the implementation session

- **`Unplanned:` with `later`**: hand it to pj4-running's **Unplanned work** as soon as it arrives. The task goes on.
- **`Unplanned:` with `blocking`**: take the stop procedure, then hand the report to pj4-running's **When workflow
  returns** in `issues.md`.
- **`Diverged:`**: send it to the design session with `SendMessage`, and tell the implementation session to wait. The
  answer is a redraw of the plan, a new `Body:` for **A redrawn issue**, or `Stop: ask`. After a redraw, the
  implementation session goes on or a new one starts, as the plan breaking in SKILL.md says.
- **Adaptations** the implementation session lists: keep them for the review requests and for `log.md`.

## Phase 6 from an issue

1. **The work report.** Read `finish.md`. The request in **The work report** in `finish.md` gains this, with the values filled in:

   > Begin `log.md` with this head, exactly, then the report:
   >
   > ```markdown
   > Implements #<n>
   > Part of #<P>
   > ```
   >
   > List the adaptations the implementation session made to the issue's design under what changed, and what the detail
   > pass redrew in the issue.

   The head is the one in `between-skills.md` **Pull requests**.
2. **`changes.diff`** as written.
3. **Push, then open the pull request.**

   ```bash
   git push -u origin <branch>
   cd <WORKDIR>
   ```

   ```bash
   gh pr create --draft --base <base branch> --title "<issue title>" --body-file log.md
   ```

   The `--attach` rules apply as in **The pull request** in `finish.md`. When `attach` is false and there are screenshots, open the pull
   request with the `gh pr create` line above, without `--attach`, so it keeps `--draft --base <base branch>`. The
   file paths go into what you hand back. Nothing waits on the user.
4. Return `finished`.

## The stop procedure

It runs on the round cap, an `Unplanned:` with `blocking`, a `Stop: ask` or a redraw that did not pass
(**The detail pass**, **Phases 3 and 4**), a human edit that **A redrawn issue** found (the stop `user`), the
`work-reports/` guard, or the user saying stop. The reasons it hands back are
`round cap`, `blocking`, `decision`, `detail`, `work-reports`, `user` and `finish`.

The case is decided by whether every task of the plan is committed and the integration review, when it runs, has
approved. Look for the commits in `git log --oneline <START>..HEAD`.

- **Every task is committed, and the integration review approved or did not run.** The stop came during phase 6, and the
  working tree is clean. Run steps 1 to 3 of **Phase 6 from an issue** to the end: the report, the push and the draft
  pull request. Then return `finished`, with `stop requested: yes` when the user said stop.
- **Anything less.** Leave the working tree as it is. Push nothing. Send nothing more to the sessions in flight. Return
  `stopped`. pj4-running saves everything since `<START>`, commits included, to `<WORKDIR>/stopped.diff` with
  `run.sh save` when it gets the hand-back, and puts `<WT>` back on `<START>`. The next run redoes the issue.
- **A step of phase 6 fails before the pull request exists.** Return `stopped` with the reason `finish`, the step
  that failed, its error message, and the path of `log.md` when step 1 wrote it.

## What it hands back to pj4-running

- **`finished`**: the pull request number `m`, the SHA of the last commit, the handover lines, the paths of any
  screenshots that could not be attached, and `stop requested` (yes or no).
- **`stopped`**: the reason (`round cap`, `blocking`, `decision`, `detail`, `user`, `work-reports` or `finish`),
  `<WORKDIR>` (the absolute path, when phase 2 (d) made it, otherwise none), `<START>`, and the text of the `Unplanned:`
  report, the decision `#<n> D<k>` the design session asked, or the failing lint or `--check` JSON, or for `finish` the
  step that failed, its message and the path of `log.md` when there is one. A run that returns `stopped` has opened no
  pull request, and pj4-running saves everything since `<START>`, commits included. The next run redoes the issue.
- **`nothing-left`**: `<WORKDIR>`, `<START>` and the evidence, a `ran:` and a `saw:` for each acceptance criterion.
- **`reordered`**: `<WORKDIR>` and `<START>`. A redraw gave `#<n>` an open blocker.
