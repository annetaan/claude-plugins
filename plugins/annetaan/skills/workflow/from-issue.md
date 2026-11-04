# From an issue

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

pj4-running loads this skill to run one sub-issue of a project as one task. The issue was written to be implemented
as it stands, so this entry has no design session, no approval and no questions. It has no integration review either,
because the plan has one task. The shape of the issue is in `$FLOW/../pj1-plan/format.md`, and the shape of its
pull request in `$FLOW/../pj1-plan/between-skills.md` under **Pull requests**.

## What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the issue number `n`, the parent `P`, and the issue title
- the projects `P` waits on, `Q1, Q2, …` (`parent.waitsOn` in `project.sh`), or none
- the base branch (the parent's `Base:` line), and the branch pj4-running just made from the tip of the base branch
- the handover notes, seeded from the parent's handover comment
- the run's worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, and the branch is
  checked out there

pj4-running has already run its checks (`gh`) on `<WT>` and confirmed that `work-reports/` is ignored there.
Every command below runs in `<WT>`, so `<ROOT>` and `<WORKDIR>` come from there. Never touch
`<MAIN>`. The user works in it during the run.

## What it skips

- **The start check**'s `worktree.sh start`, in `worktree.md`. pj4-running's `run.sh start` has run its checks, and its `attach` says
  whether `--attach` works.
- **Does this repository accept breaking changes?** in `standalone.md`. Ask nothing and write nothing to memory.
- **The worktree** in `worktree.md`. pj4-running made `<WT>` and checked what it must ignore.
- All of phase 1: the design session, the design review, the open questions and the approval dialog.
- Phase 2 (a) and (b). pj4-running owns the branch. Keep the two commands of (b) as a guard, because (d) needs
  `<ROOT>` from the first one.

  ```bash
  git rev-parse --show-toplevel
  git -C <ROOT> check-ignore -q work-reports/
  ```

  On exit 1, take the stop procedure with the reason `work-reports`. Never ask about `.gitignore` here.
- **Report to the user** in `standalone.md`. What goes back to pj4-running replaces the report.

## The design, the plan and the detail

Read the issue, its parent, and the parent of every project `P` waits on.

```bash
gh issue view <n> --json body
gh issue view <P> --json body
gh issue view <Q> --json body   # each Q
```

- **The approved design**, for every prompt in phases 3 and 4: the issue's `## Goal`, `## Design`,
  `## Acceptance criteria` and `## Out of scope`, its `## Decisions` cut down to the checked option, the lines under
  its box and the `Decided:` line of each, the parent's `## Design`, and the `## Design` of each `Q`, which holds the
  boundaries those projects define (`format.md`, **The parent issue body**).
- **The plan**: one task, "1. <issue title>", so phase 5 does not run.
- **The detail design for task 1**: the issue's `## Design`.
- **The commit**: in phase 4 (d), ask for a subject that follows the repository's style and names the issue title.

## Start point and work directory

Phase 2 (c) takes `<START>` from `git rev-parse HEAD`, right after pj4-running made the branch. Phase 2 (d) runs as
written.

## Phases 3 and 4

They run as written: a new implementation session and a new review session, five rounds, one commit. The prompts gain
a line each.

- The phase 3 prompt: "This run comes from issue #<n>. Follow **Work outside the task** in your role instruction."
- The review prompt: "The design is issue #<n>. Its checked decisions bind."
- Every prompt, implementation and review alike, carries **the worktree line** (**The worktree line** in SKILL.md).
- Every review request, the round 1 prompt and each "review it again" `SendMessage`, also carries the adaptations
  the implementation session has listed so far, under "Adaptations", or "none".

Keep the handover lines from phase 4 (d) for pj4-running.

## Reports from the implementation session

- **`Unplanned:` with `later`**: hand it to pj4-running's **Unplanned work** as soon as it arrives. The task goes on.
- **`Unplanned:` with `blocking`**, and **`Diverged:`**: take the stop procedure, then hand the report to
  pj4-running's **When workflow returns**.
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
   > List the adaptations the implementation session made to the issue's design under what changed.

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

It runs on the round cap, an `Unplanned:` with `blocking`, a `Diverged:`, the `work-reports/` guard, or the user
saying stop.

The task commit decides the case, whatever the phase. Look for it in `git log --oneline <START>..HEAD`.

- **No task commit yet.** Leave the working tree as it is. Push nothing. Send nothing more to the sessions in flight.
  Return `stopped`. pj4-running saves the work to `<WORKDIR>/stopped.diff` with `run.sh save` and cleans `<WT>`
  when it gets the hand-back. The next run never uses the saved work, and the work gets redone.
- **The task commit exists.** The stop came during phase 6, and the working tree is clean. Run steps 1 to 3 of
  **Phase 6 from an issue** to the end: the report, the push and the draft pull request. Then return `finished`, with
  `stop requested: yes` when the user said stop.
- **A step of phase 6 fails before the pull request exists.** Return `stopped` with the reason `finish`, the step
  that failed, its error message, and the path of `log.md` when step 1 wrote it.

## What it hands back to pj4-running

- **`finished`**: the pull request number `m`, the SHA of the task commit, the handover lines, the paths of any
  screenshots that could not be attached, and `stop requested` (yes or no).
- **`stopped`**: the reason (`round cap`, `blocking`, `diverged`, `user`, `work-reports` or `finish`), `<WORKDIR>`
  (the absolute path, when phase 2 (d) made it, otherwise none), and the text of the `Unplanned:` or `Diverged:` report, or for
  `finish` the step that failed, its message and the path of `log.md` when there is one. A run that returns `stopped` has opened no pull request.
