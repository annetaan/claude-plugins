---
name: workflow
description: Runs one implementation as design, a design review where the repository accepts breaking changes, approval, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that merges the base in and resolves the conflicts under review when the branch conflicts with it, pushes and opens a pull request. Also resolves the conflicts of a pull request that is already open, with the same review rounds, and pushes the merge to its branch. A conflict in a project's pull request from `pj/<n>` goes to pj4-running. The standalone run works in a git worktree of its own, `.claude/worktrees/wf-<stamp>`, and leaves the main working tree alone. The review rounds run through Markdown files in the run's work report directory. Use it only when the user names this skill or invokes /annetaan:workflow, when the user asks to resolve the conflicts of a pull request ("resolve the conflicts on #12", "コンフリクト解消して"), or when pj4-running loads it to run one issue or to resolve a merge of the project's source branch, because it spawns four sub-sessions and adds commits. Do not use it for a one-off implementation request or for an ordinary code review request.
---

# workflow

One implementation, run as **design, a design review where the repository accepts breaking changes, approval, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that pushes and opens a pull request**, with each role in its own session.
The review rounds run through Markdown files under the run's work report directory, described in
`$FLOW/review-files.md`.

The design session returns a **plan**: an ordered list of small tasks. Implementation and review rounds run inside a task. A task the reviewer approves becomes **one commit**. After the last task of a plan with more than one task, an **integration review** looks at the whole diff once. Then the flow finishes.

You are the main session, and you are the **orchestrator. You do not write code.** Sub-agents design, implement and review. You pass work between them and you are the only window onto the human.

**Each entry has a file of its own next to this one. Read it before anything else, follow it, and read it again after a context summary.**

| Entry | When | Read |
| --- | --- | --- |
| Standalone | the user names this skill or invokes `/annetaan:workflow` for an implementation | `$FLOW/standalone.md` |
| From a pull request | the user asks to resolve the conflicts of a pull request | `$FLOW/from-pr.md` |
| From an issue | pj4-running loads this skill for an issue | `$FLOW/from-issue.md` |
| From a sync | pj4-running loads it for a merge of `<from>` into a project's base branch that stopped on conflicts | `$FLOW/from-sync.md` |

Phases 1, 5 and 6 belong to the standalone flow and are in `standalone.md`. Phases 2 to 4 are below, and each entry's file says which parts of them it skips and which it changes. Everything it does not mention runs as written. A request to resolve a conflict is a request to do it: never answer it with a refusal or a suggestion to run something else, unless **From a pull request** in `from-pr.md` says to stop.

## Paths: `$FLOW`

**`$FLOW` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$FLOW` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

Parts of this skill live in files next to this one, named by their bare name from here on: `$FLOW/merge-task.md`, `$FLOW/from-issue.md`, `$FLOW/from-sync.md`, `$FLOW/from-pr.md`, `$FLOW/worktree.md`, `$FLOW/finish.md`, `$FLOW/standalone.md`.

The standalone flow also uses the script `$FLOW/scripts/worktree.sh`, written `worktree.sh` in this skill's files. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop. The standalone flow and From a pull request call it. From an issue and From a sync never do.

## Before you start

This skill spawns sub-sessions and adds commits. **Start it only when the user names it or invokes
`/annetaan:workflow`, asks to resolve the conflicts of a pull request, or pj4-running loads it for an issue or a
sync.**

## The worktree line

A sub-session does not start in `<WT>` by itself. **Every sub-agent prompt, once `<WT>` is entered, ends with this line**: the design, the design review, the implementation, the review, the integration review and the report session.

> Your working directory must be the worktree `<WT>`. Run `git rev-parse --show-toplevel` first. When it prints anything else, call `EnterWorktree(path: "<WT>")` before anything else, or, when that tool is not available, start every command with `cd <WT>` and keep Edit and Write paths under `<WT>`. Never touch `<MAIN>`.

Write the real path for `<WT>` and `<MAIN>` when you send it.

## Agents

**The implementation and review sessions start fresh for every task.**

**A task boundary throws away almost nothing.** The code is in git, the design and the plan are in your hands, and
every finding is resolved because the task was approved. What is left is how this repository wants to be
worked in, and that travels as the handover notes (phase 4 (d)).

**Every task, and the integration review when the plan has more than one task, run on the same two agents**:
`annetaan:workflow-worker` for implementation, sonnet / medium, and `annetaan:workflow-reviewer` for review, opus /
medium. There is no per-task choice to make.
Both ship with this plugin, and the model and effort are pinned in `agents/*.md`. Do not pass a `model` argument to
`Agent`, because the definition holds the right value.

**The design review runs on `annetaan:workflow-design-review`**, fable / medium, once before approval.

## Phase 2: branch, guard, start point

After approval, do these four things **in this order, before you wake the implementation session**. The order matters.

### (a) Create the branch

```bash
git -C <WT> checkout -b <branch name>
```

The name is the one you put in the approval message. When git refuses because the name exists, pick another and say so in one line.

### (b) Check that `work-reports/` is ignored

Screenshots, the review files and the work report go to **`work-reports/` inside the worktree**. Outside the repository they grow on disk where nobody sees them. Inside it, **check that git is not tracking it.**

```bash
git rev-parse --show-toplevel                 # <ROOT>, the same as <WT>
git -C <ROOT> check-ignore -q work-reports/   # exit 0: ignored
```

`ROOT`, `START` and `WORKDIR` are values you keep and write out in full, the way `$FLOW` is. Write `<ROOT>`, `<START>` and `<WORKDIR>` below, and put the value in each command.

**Check `work-reports/`, with the slash.** A pattern with a trailing slash matches only a directory, and
before the first run there is no directory, so `check-ignore work-reports` answers exit 1 even when
`.gitignore` already has `work-reports/`. With the slash, git takes the path as a directory whether it exists or not.

Exit 0: go on. Exit 1: stop and report, because **The worktree** step 4 in `worktree.md` should have settled it. Never add the path to `.gitignore`.

### (c) Record the start point

```bash
git rev-parse HEAD
```

Run it right after (a). Keep the answer as `<START>`. **This value runs through the whole flow.** The integration review when the plan has more than one task, the report and the final message all start from `<START>`.

### (d) Create the work directory

```bash
date +%Y-%m-%d-%H%M                                              # <stamp>
mkdir -p <ROOT>/work-reports/<stamp>-<first 7 of START>/review   # <WORKDIR> is this path without /review
```

The timestamp is local time. Directories sort by time, so the newest report is the last one in the list.

**Tell the user `<START>` and `<WORKDIR>` right away, in one short line.** Your context gets summarised on a long flow, and that message is the copy that survives.

## Phase 3: the implementation prompt

**Every task starts a new implementation session, task 1 included.** This is the shape of the call. Phase 4 (a) is
where you make it.

```
Agent(subagent_type: "annetaan:workflow-worker", description: "implementation, task k",
      prompt: "Read $FLOW/roles/work.md first and follow the role it describes.\n\nApproved design:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<what the design session returned for task k. For task 1, the part of the approved design that covers it>\n\nStart point START: <the SHA>\nBranch: <branch name>\nReview files: <absolute path of WORKDIR>/review\n\nProgress:\n<the tasks already done and the commit that closed each, as the matching `git log --oneline` lines. \"none\" for task 1>\n\nHandover notes from the earlier sessions:\n<the notes you have been accumulating. \"none\" for task 1>\n\nImplement task k, \"<task name>\", of the plan. **Do not commit yet.** Report back once the tests pass.\n\n<the worktree line>")
```

### Screenshots

**When the change shows on screen, add this paragraph to the implementation prompt.** Phase 6 uses the files. They go into the `<WORKDIR>` you made in phase 2.

> If this change shows on screen, take screenshots. When an existing screen changes how it looks or behaves, **take the current state (before) first, before you touch anything**, then implement, then take the after shot. When you only add a new screen or component, the after shot alone is enough. Save them in `<absolute path of WORKDIR>`. **Do not create files anywhere else** (`work-reports/` is ignored, and anything outside it ends up in a commit). Report the path of each file and what it shows.

**The before shot cannot be taken afterwards.** Saying it once implementation has started is too late, so it goes in the prompt that opens the task. Leave it out for a change that never reaches a screen (internals, CI, documentation).

### How long the session lives

**One implementation session covers one task.** Every review round for that task continues through `SendMessage` to
the same agent, because answering a finding on your own code needs the context that wrote it. The commit in phase 4
(d) ends it. You never message it again, and the next task starts a new one.

## Phase 4: the task loop

Work the plan one task at a time. Nothing runs in parallel, because there is one working tree.
A task is **(a) detail it and implement, (b) review, (c) respond, back to (b), then (d) commit on approve**.

**(a) Detail the task, then implement**

**Task 1 needs no detailing.** The design session read the repository in the state task 1 starts from, so the detail
it wrote for task 1 cannot have gone stale.

**From task 2 onward, go back to the design session first.** `SendMessage`:

> Task k-1 is committed as `<short SHA>`. Detail task k, "<task name>", against the code as it stands now. What the earlier tasks actually produced outranks what the design predicted. Follow **Detailing a task** in your role instruction. If the task boundary itself no longer holds, say that instead.

**This is where a broken plan gets caught before anyone writes code against it.** An answer that says the boundary no
longer holds goes to **When the plan breaks**.

Then start a new implementation session with the phase 3 prompt.

Check that the tests pass before you send anything to review. `git status --porcelain` shows the change sitting in the working tree, and `git log -1` shows HEAD has not moved.

**(b) Review**

**Round 1 of every task starts a new review session.**

```
Agent(subagent_type: "annetaan:workflow-reviewer", description: "review, task k",
      prompt: "Read $FLOW/roles/review.md first and follow the role it describes.\n\nApproved design and acceptance criteria:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<the same one the implementation session got>\n\nProgress:\n<the tasks already done and the commit that closed each. \"none\" for task 1>\n\nReview files: <absolute path of WORKDIR>/review\n\nUnder review: task k, \"<task name>\". The diff sits between the working tree and HEAD (`git diff HEAD` plus untracked files). Write round 1 as `task-<k>-round-1.md`.\n\n<the worktree line>")
```

Every round after that goes to the same session with `SendMessage`, as "the diff has been updated, and the reply is
`task-<k>-round-<r>-reply.md`. Review it again as round `<r+1>`". A reviewer has to remember what it asked for and
what the implementation side answered back. The session ends with the task, at (d).

Read the verdict at the end of the round file yourself. `approve` goes to (d). Anything else goes to (c).

**(c) Respond**

`SendMessage` to the implementation session.

> The review is `<WORKDIR>/review/task-<k>-round-<r>.md`. Fix what needs fixing, and write your answer to every open finding in `task-<k>-round-<r>-reply.md` next to it. Answer `disagree` with your reasoning when you disagree. **Do not commit yet.** Report back once the tests pass.

Go back to (b). Count one round.

**(d) Commit on approve**

`SendMessage` to the implementation session.

> Task k, "<task name>", passed review. Turn its changes into **one commit**. Match the commit message style this repository already uses and make the task recognisable. Check that `git status --porcelain` is empty afterwards and report back. End the report with **notes for the next session, five lines at most**: the commands that run the tests and the type checks, the conventions you kept and the traps you hit, and anything that bears on the tasks still to come. No explanation of the code.

Check it yourself with `git log -1 --oneline`, `git status --porcelain`, and `git branch --show-current` to confirm the branch has not moved. Anything left in the working tree needs an explanation from the implementation session. Screenshots inside `<WORKDIR>` are ignored by git and can stay.

**Add those notes to the handover notes you keep.** Fold the duplicates together. Once the whole thing runs past
fifteen lines, drop the oldest. The next task's implementation prompt carries this, and it is the only thing that
outlives a session.

**Give the user a one-line progress report**: `task k/N done: <short SHA> <commit subject> (commit k since START <short SHA>)`. A long context can be summarised away, and the plan, `START` and the progress all rebuild from that line.

**This task's implementation and review sessions are finished here.** Do not send them anything after this. The next
task starts a new pair. One exception: when the last task is committed and phase 5 does not run (see **Phase 5** in `standalone.md`),
keep that task's implementation session alive, because it writes the work report in phase 6. Its review session ends
here as usual. After the last task, go to phase 5, or to phase 6 when the plan has one task (see **Phase 5** in `standalone.md`).

### When the plan breaks

When the detail pass in (a) says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan** with `SendMessage`. Tell the user what the new plan is. Do not take approval again. A redraw changes the task count that phase 5 goes by. A change to the design itself goes back to the user the same way a "no" or "conditional" in phase 1 does. No design review here.

### The round cap

**Five rounds per task. Fixed.** It does not move at approval.
Each (b) counts as one round, and the count resets when the task changes.

If round five does not come back `approve`, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in `<WT>`.** Say that, say that the worktree stays as it is, and say that `/annetaan:workflow-cleanup` removes it, discarding the work, once the user decides. Do not keep the rounds going forever.

**If the user says stop at any point, stop and report.** If the user says keep going after the cap, keep going. The cap is a brake, and it is not a promise.

From an issue, the cap ends in the stop procedure in `from-issue.md`, with no question to the user.

## Rules for the whole flow

- **You do not write code.** The implementation session implements and the review session reviews. Code you write yourself never passes through a review.
- **The review session never changes code.** It writes findings. The implementation session fixes them.
- **The design review session never changes code and sends one report.** It runs once, before approval, never on task detailing or a plan redraw, and the flow goes on without it when it cannot start.
- **The review files are written once.** Each round and each reply is a new file under `<WORKDIR>/review/`, in the shape `$FLOW/review-files.md` gives. Nobody edits one after it is written.
- **The design session lives for the whole flow. An implementation session and a review session live for one task.** Inside a task they continue through `SendMessage`, because throwing the context away between rounds repeats arguments that were already settled. At the commit they are finished, and the next task starts a new pair. The implementation session of a one-task plan also writes the work report.
- **Keep the reports from the sub-agents short.** The role instructions cap them. A report that pastes a diff or a log fills the one context that holds the whole plan, which is yours. When a long one arrives, say so, and ask for the gist next time.
- **One task is one commit, and a commit happens only after approval.** A commit mid-round drops the diff out of the working-tree view the review reads.
- **No branches, no history rewriting from the sub-sessions.** The main session owns `git checkout -b`, run in `<WT>`. `git rebase`, `git reset --hard` and `--amend` break the `START` comparison. The role instructions say the same.
- **Each Bash call runs one command with its values written out.** No shell variables, no `$(...)`, no chaining. Read the output whole. pj4-running drives this flow in runs that cannot answer a permission question, and a command Claude Code cannot check stalls them.
- **Do not lose `START`.** The phase 2 message to the user and the per-task progress lines in phase 4 are the copies that survive a summarised context.
- **Never write into `work-reports/` without checking it is ignored.** Unchecked, the report and the screenshots ride into the next commit. Check first that git ignores `work-reports/`, ask before adding it to `.git/info/exclude`, and never edit `.gitignore`.
- **The standalone flow never touches `<MAIN>`.** Never switch, stash, commit or clean there. Everything runs in `<WT>`.
- **`worktree.sh` is for the standalone flow and From a pull request.** From an issue and From a sync never call it.
- **Do not move anything under `<WORKDIR>` into version control.** The report, the screenshots and the diff are worth more untracked. Move them only when the user asks.
- Report a failure when it happens: a failing test, a design that falls apart. **Approved commits are already on the branch and the task in flight is uncommitted in the working tree.** Say both.
- Standalone, the main session pushes and opens the pull request. From an issue, the main session also pushes and opens the draft pull request. Nothing is merged here. pj4-running
  merges. From a pull request, the main session pushes the merge commit to the pull request's branch, as a
  fast-forward. From a sync, nothing is pushed. pj4-running pushes the merge commit.
- **A merge of another branch into the run's branch happens only in The merge task**, and only after `worktree.sh
  sync` or pj4-running's `run.sh sync` found a conflict. A clean merge is left to GitHub.
