# The standalone flow

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

Read `worktree.md` and run **The start check** first. Then decide **Does this repository accept breaking changes?** below, run **The worktree** in `worktree.md`, phase 1 below, phases 2 to 4 in SKILL.md as **Phases 2 to 4 in the standalone flow** below settles them, and phases 5 and 6 below.

## Does this repository accept breaking changes?

Decide this before **The worktree** in `worktree.md`. It decides how far the design review may move existing code
(see **The design review**). **The answer is a sentence you keep**, not a shell variable. The review prompt and the
approval message need it.

**When the request asks for a minimal change** (an urgent fix, a hotfix, "just make it work"), skip this check and ask
nothing. You judge that from the request. Say one line before design starts: design review skipped for this run: the
request asks for a minimal change. **Write nothing to memory.** A minimal change is a property of this request, not
of the repository.

Otherwise read `breaking-changes.md` and follow it.

## Phase 1: design

Hand the user's request to the design session as it was written, with the worktree line (see **The worktree line** in SKILL.md).

```
Agent(subagent_type: "annetaan:workflow-design", description: "design",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\n<the worktree line>")
```

`annetaan:workflow-design` ships with this plugin and is pinned to opus at medium effort with code changes disabled.

When the design comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait. Do not walk past it.
- **Keep the plan.** It is an ordered list of tasks, each with the files it touches. If the plan is missing, use `SendMessage` to make the design session produce it.
- **The round cap is five per task and it is fixed.** Mention it once at approval. Do not negotiate the number (see **The round cap** in SKILL.md).

**Keep the design session alive for the whole flow.** You go back to it twice. Before every task from task 2
onward, to have it detail that task against the code as it now stands (phase 4 (a)). And whenever the plan breaks,
to have it redraw the remaining tasks.

### The design review

**It runs once, after feasibility has passed and before the open questions**, in every repository except for a
minimal-change run (see **Does this repository accept breaking changes?**). Hand the reviewer the request as it was
written, whether breaking changes are accepted, and the design report in full.

```
Agent(subagent_type: "annetaan:workflow-design-review", description: "design review",
      prompt: "Read $FLOW/roles/design-review.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\nBreaking changes: <accepted | not accepted>\n\nThe design:\n<the full design report>\n\n<the worktree line>")
```

`annetaan:workflow-design-review` ships with this plugin and is pinned to Fable at medium effort with code changes
disabled.

**When it cannot start** (a weekly limit, a rate limit, the model is unavailable), skip the review and go on. **Do not
substitute another agent.** Keep the reason for the approval message.

When the report comes back, `SendMessage` it to the design session.

> <the design review report, in full>
>
> Follow **Answering the design review** in your role instruction. Return the whole revised report.

The revised report replaces the design and the plan you kept. **The revised design does not go back to the
reviewer**, and neither does a rework the user asks for at approval, a corrected base included. The design review session ends with its one
report. Never `SendMessage` it. The points the design session did not take in reach the user as open questions (see
**The approval dialog**).

### The approval dialog

**Before the approval question, ask the open questions**, on every run. The design's own questions and, when the
design review ran, the points the design session did not take from it, marked `(from the design review)`, go to the
user with `AskUserQuestion`. **One call holds four questions at most**, so ask in as many calls as it takes: the
design's own first, then the review's, in the order the reviewer ranked them. Send the answers back with
`SendMessage` so the design session can settle them.
The approval is one question, so this is where the review's leftovers get decided.

This is the only approval point in the flow. Present the design summary and the plan, then ask **one `AskUserQuestion`**.

**Proceed with this design and plan?** (approve / change something first)

The approval message states:

- the name of the new branch, and `base: <base>`
- the worktree `<WT>`, and that `<MAIN>` is not touched
- that `<WT>` lacks `<MAIN>`'s ignored files (dependencies, `.env`), so the first worker prepares what the tests need and records the steps in the handover notes
- that everything after this runs on its own: per-task implementation and review rounds, the integration review when the plan has more than one task, the push and the pull request

**You pick the branch name yourself.** Match the naming the repository already uses (`git branch -a`), choose one that `git branch -a` does not list yet, and write it into the approval message, so the user can correct it there. Do not spend a question on it.

**Say what happened to the design review, in one line of the approval message.** When it ran: whether breaking
changes are accepted, N findings taken in, M decided by you in the open questions above. When it did not run, the
reason: Fable could not start, or the request asks for a minimal change.

**When the user corrects the base at approval**, the design was written against the wrong code:

1. Leave and remove the worktree as **Ending before approval** in `worktree.md` says.
2. Run steps 3 to 6 of **The worktree** in `worktree.md` with the new base.
3. Start a new design session from the design call.
4. Run no second design review, as for any rework at approval.
5. Ask the open questions again, then ask for approval again.

A corrected branch name just replaces the name.

## Phases 2 to 4 in the standalone flow

Phases 2 to 4 in SKILL.md run as written, with these settled here.

- **Phase 2** starts after approval and runs all four steps, (a) to (d). Exit 1 in (b): stop and report, because **The worktree** step 4 in `worktree.md` should have settled it.
- **After the last task's commit in phase 4 (d)**: when phase 5 does not run (see **Phase 5**), keep that task's implementation session alive, because it writes the work report in phase 6. Its review session ends as usual. After the last task, go to phase 5, or to phase 6 when the plan has one task (see **Phase 5**).
- **The round cap**: if round five does not come back `approve`, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in `<WT>`.** Say that, say that the worktree stays as it is, and say that `/annetaan:workflow-cleanup` removes it, discarding the work, once the user decides. If the user says keep going after the cap, keep going.
- **When the user says stop** at any point, stop and report.

## Phase 5: integration review

**Phase 5 runs only when the plan has two or more tasks.** With one task, the task review already read the working
tree against HEAD, and HEAD was still `START`. That is the same diff phase 5 would read, and there is no task boundary
to look at. Count the tasks in the plan as it stands when its last task is committed. A redraw under **When the plan breaks** in SKILL.md
changes the count. With one task, a redraw can happen only while task 1 is in flight. When it grows the plan
to several tasks, task 1's (d) ends its sessions as usual and phase 5 runs after the new last task. When it leaves
one task, phase 5 is skipped. Once two tasks are committed, phase 5 runs. When a redraw leaves no task to run after
task 1 is committed, phase 5 runs too, because task 1's (d) has already ended its sessions.

Once every task is committed, **review the whole diff once.** A review inside a task cannot see the task boundaries: interfaces that do not line up, a rename done on one side only, work duplicated between tasks.

The target is the working tree against `START` (`git diff <START>` plus untracked files), which is every commit put
together. The working tree should be empty at this point. Fixes from the integration review land uncommitted in the
working tree, so later rounds see them in the same diff.

**The integration review starts a new review session.**

```
Agent(subagent_type: "annetaan:workflow-reviewer", description: "integration review",
      prompt: "Read $FLOW/roles/review.md first and follow the role it describes.\n\nApproved design and acceptance criteria:\n<the full design>\n\nPlan, with the commit that closed each task:\n<the plan plus the matching `git log --oneline` lines>\n\nReview files: <absolute path of WORKDIR>/review\n\n<the request below>\n\n<the worktree line>")
```

> Every task is committed. This is the integration review. The target is `git diff <START>` plus untracked files. Write round 1 as `integration-round-1.md`. The tasks were reviewed one at a time, so look at **the boundaries**: types and contracts between functions that call each other across tasks, names that do not match, duplicated implementations, and acceptance criteria for the whole design that are still unmet.

**`changes-requested` starts a new implementation session as well**, with the phase 3 prompt. The progress is every task, the handover notes are everything you have collected, and the request is to
answer the integration review. From there the (b), (c) loop is the same as phase 4, with the `integration-round-<r>`
files, and the cap is the same
**five rounds**. Neither session gets rebuilt during those rounds. Fixes become **one commit** after approval, with a
subject that says what it is, such as "integration review fixes". No fixes means no commit.

Review says `approve`, every finding is resolved, tests pass. Phase 6 starts when all three hold.

## Phase 6: finish

### Bringing the base in

The base may have moved while the tasks ran. A pull request that would conflict from the start is settled here,
under review, before anything is pushed.

```bash
$FLOW/scripts/worktree.sh sync <name> <base>
```

- **`current`**: the branch contains `origin/<base>`. Go on.
- **`clean`**: `origin/<base>` gained `behind` commits, and they merge without a conflict. Nothing was changed. The
  branch gets no merge commit it does not need. Go on.
- **`conflict`**: the merge of `origin/<base>` stopped on conflicts in `files`, and stays in progress in `<WT>`.
  Print `<base> conflicts with <branch> in <n> file(s)`, then read `merge-task.md` and run **The merge task** with `<incoming>` as
  `origin/<base>`, `<into>` as `<branch>`, `<M>` as `start`, and as `<intent>`: "the approved design, as the commits
  since `<START>` implement it", followed by the approved design.
  - **`finished`**: go on. That implementation session is alive, and it writes the work report. Keep the `later`
    reports for **Report to the user**.
  - **`stopped`**: push nothing. Go to **Report to the user**, and say that the task commits are on the branch and
    that the merge stays in progress in `<WT>`.
- **`stop`** with `fetch-failed`, `dirty` or `unfinished`: quote `message` and go to **Report to the user**. The
  task commits are on the branch, and nothing was pushed.

### The work report and the pull request

Read `finish.md` and run **The work report**, then **The pull request**.

### Report to the user

**First leave the worktree**: `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available.

Every standalone run that got past approval ends here, finished or stopped (round cap, user stop, a failed finish). Close with: `START`, the commits stacked on it matched against the tasks in the plan, the design summary, and what the review changed. Then:

- **how the base came in**: already in, merging cleanly, or merged after the merge task resolved the files it names, or why it did not

- **the pull request URL**, when one was opened
- **the worktree `<WT>`**, and that the work report lives under it until cleanup
- **the path of the work report** (`<WORKDIR>/log.md`), which opens in an editor with the screenshots inline
- the review files, under `<WORKDIR>/review/`
- the screenshot paths, when the change shows on screen
- when phase 5 was skipped, one line saying the integration review did not run because the plan had one task
- **the cleanup**: once the pull request is merged or closed, `/annetaan:workflow-cleanup <PR number>` moves the work report into `<MAIN>/work-reports/`, removes `<WT>` and the branch, and fast-forwards the local `<base>` after a merge. A run that stopped with no pull request is cleaned up with `/annetaan:workflow-cleanup` and no number
- for a stopped run, what is still uncommitted in `<WT>`
