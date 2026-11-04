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

**When the user asks to resolve the conflicts of a pull request, follow From a pull request. When pj4-running loads
this skill for an issue, read `from-issue.md` and follow From an issue. When it loads it for a merge of `<from>` into a project's base branch
that stopped on conflicts, follow From a sync.** Each says which parts below it skips and which it changes.
Everything it does not mention runs as written. A request to resolve a conflict is a request to do it: never answer
it with a refusal or a suggestion to run something else, unless **From a pull request** says to stop.

## Paths: `$FLOW`

**`$FLOW` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$FLOW` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

Parts of this skill live in files next to this one, named by their bare name from here on: `$FLOW/merge-task.md`, `$FLOW/from-issue.md`.

The standalone flow also uses the script `$FLOW/scripts/worktree.sh`, written `worktree.sh` below. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop. The standalone flow and From a pull request call it. From an issue and From a sync never do.

## Before you start

This skill spawns sub-sessions and adds commits. **Start it only when the user names it or invokes
`/annetaan:workflow`, asks to resolve the conflicts of a pull request, or pj4-running loads it for an issue or a
sync.**

Run one command and keep every answer. Phase 1 needs them.

```bash
$FLOW/scripts/worktree.sh start
```

It prints `status: ok` with `main`, `mainBranch`, `defaultBranch`, `gh` and `attach`.

- `main` is `<MAIN>`, the main working tree. The flow never works in it.
- `mainBranch` is the branch `<MAIN>` has checked out, or null on a detached HEAD.
- `defaultBranch` is the branch origin's HEAD names, or null.
- `attach` says whether `gh` is new enough for `gh pr create --attach` (2.99.0 or later). Phase 6 reads it, and `gh` holds the version.
- **A `stop` ends the flow before design.** Its `reason` is `not-a-repo`, `no-origin`, `gh`, `gh-auth` or `repo`. Name the check and quote `message`. For `no-origin`, `gh` and `gh-auth`, add that this flow ends in a pull request and one cannot be opened here.
- **A null `defaultBranch` stops the flow too**, unless the request names the branch to start from. Say that the default branch cannot be read.
- **A dirty `<MAIN>` does not stop the flow**, because the flow never works in it.

### Does this repository accept breaking changes?

Decide this after `worktree.sh start` and before **The worktree**. It decides whether the design review runs. The review pushes
the design toward the shape it would have from a blank slate, and that shape often moves existing code, so it runs
only where the repository accepts breaking changes. **The answer is a sentence you keep**, not a shell variable. The
approval message needs it.

**When the request asks for a minimal change** (an urgent fix, a hotfix, "just make it work"), skip this check and ask
nothing. You judge that from the request. Say one line before design starts: design review skipped for this run: the
request asks for a minimal change. **Write nothing to memory.** A minimal change is a property of this request, not
of the repository.

Otherwise, go down this list and stop at the first one that answers.

1. **The repository states it.** `CLAUDE.md` or `AGENTS.md` says whether breaking changes are welcome. Follow it.
2. **This project's memory has it.** Follow the memory.
3. **Neither.** Ask, then save the answer to this project's memory, under a name that identifies the repository and the date, in the format the memory directory already uses.

```
AskUserQuestion: Do you want broader design improvements (accepting breaking changes)?
  - Yes - a pre-release project, or a library you control
  - No  - a released SaaS, or a widely used OSS
```

**This skill never edits `CLAUDE.md` or `AGENTS.md`.** The answer goes to memory and nowhere in the repository.

**When 1 or 2 decided it and nothing was asked, say so in one line before design starts**: the design review will
run, or will not run, because `<file>` says … / memory from <date> says …. That line is where the user stops a
stale memory.

## The worktree

The standalone flow works in a git worktree of its own, `.claude/worktrees/wf-<stamp>` inside `<MAIN>`, detached at the tip of the base branch on origin. `<MAIN>` stays as the user left it. Run these steps after **Does this repository accept breaking changes?** and before phase 1, so that design reads the code in `<WT>`. The memory lookup above ran in the session's own project, before the worktree.

1. **The base.** The branch the request names, otherwise `defaultBranch`.
2. **The base question.** Only when the project's instructions in context (`CLAUDE.md`) ask for the base branch to be confirmed on every run. They are free-form, so you judge whether they do. Ask one `AskUserQuestion` with these options in this order, leaving out any that repeat an earlier one: the branch the request names `(Recommended)`; `defaultBranch` (`(Recommended)` when it comes first); `mainBranch` when it is set and differs from the default branch. The tool adds Other on its own. The answer is the base. **When fewer than two options remain**, ask a two-option confirm question instead: `Use <base> (Recommended)` and `Another branch - type its name under Other`, where `<base>` is the one candidate. An answer under Other is the base.
3. **Create it.**

   ```bash
   $FLOW/scripts/worktree.sh create <base>
   ```

   - `ready`: keep `worktree` as `<WT>`, `name` as `<name>` and `base` as `<base>`.
   - `stop` with `base-missing`: say that origin has no branch `<base>`, and stop the flow.
   - `stop` with `fetch-failed`: quote `message` and stop the flow.

   Both stops come before a worktree exists, so there is nothing to remove.
4. **Ignore rules.** Two paths must stay out of git: `.claude/worktrees/` in `<MAIN>` and `work-reports/` in `<WT>`.

   ```bash
   $FLOW/scripts/worktree.sh ignore <name>
   ```

   `ok`: go on. `ask`: ask once, naming `notIgnored`.

   ```
   AskUserQuestion: These paths are not ignored in this repository: <paths>. workflow works in .claude/worktrees/ and writes its reports to work-reports/.
     - Ignore them in this clone (Recommended) - adds them to .git/info/exclude and commits nothing
     - Stop
   ```

   On the first answer, run `$FLOW/scripts/worktree.sh ignore <name> --add` and act on what it prints as here. On
   `stop` with `still-not-ignored`, a `.gitignore` rule overrides the exclude file: say so and take **Ending before
   approval**. On Stop, take **Ending before approval**. **Never edit `.gitignore`.**
5. **Enter it, once.**

   ```
   EnterWorktree(path: "<WT>")
   ```

   Where that tool is not available, `cd <WT>`. Print `worktree <WT> base <base>` once. **Every command from here to
   the end of the run runs in `<WT>`.** After a context summary, run `git rev-parse --show-toplevel`, and enter
   `<WT>` again when it prints anything else.
6. **The worktree line.** A sub-session does not start in `<WT>` by itself. **Every sub-agent prompt from here on
   ends with this line**: the design, the design review, the implementation, the review, the integration review and
   the report session.

   > Your working directory must be the worktree `<WT>`. Run `git rev-parse --show-toplevel` first. When it prints anything else, call `EnterWorktree(path: "<WT>")` before anything else, or, when that tool is not available, start every command with `cd <WT>` and keep Edit and Write paths under `<WT>`. Never touch `<MAIN>`.

   Write the real path for `<WT>` and `<MAIN>` when you send it.
7. `<WT>` has none of `<MAIN>`'s ignored files, such as installed dependencies or a `.env`. The first worker prepares what the tests need and leaves the steps in the handover notes, so later tasks find them there.

### Ending before approval

When the run ends before approval, leave the worktree and remove it.

1. When you have entered `<WT>` (**The worktree** step 5), `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available. A stop at step 4 comes before that: skip this step.
2. `git -C <MAIN> worktree remove <WT>`

The reasons: the Stop answer at the ignore question, a feasibility of "no" or "conditional" the user does not pursue, any answer at approval that ends the flow, and the user saying stop. Design sessions never change code, so there is no `--force`. When git refuses, something wrote into `<WT>`: quote the refusal, name `<WT>`, and point to `/annetaan:workflow-cleanup`.

## Phase 1: design

Hand the user's request to the design session as it was written, with the worktree line (see **The worktree**).

```
Agent(subagent_type: "annetaan:workflow-design", description: "design",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\n<the worktree line>")
```

`annetaan:workflow-design` ships with this plugin and is pinned to opus at medium effort with code changes disabled.

When the design comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait. Do not walk past it.
- **Keep the plan.** It is an ordered list of tasks, each with the files it touches. If the plan is missing, use `SendMessage` to make the design session produce it.
- **The round cap is five per task and it is fixed.** Mention it once at approval. Do not negotiate the number (see **The round cap**).

**Keep the design session alive for the whole flow.** You go back to it twice. Before every task from task 2
onward, to have it detail that task against the code as it now stands (phase 4 (a)). And whenever the plan breaks,
to have it redraw the remaining tasks.

### The design review

**It runs once, after feasibility has passed and before the open questions**, and only when the repository accepts
breaking changes (see **Does this repository accept breaking changes?**). Hand the reviewer the request as it was
written and the design report in full.

```
Agent(subagent_type: "annetaan:workflow-design-review", description: "design review",
      prompt: "Read $FLOW/roles/design-review.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>\n\nThe design:\n<the full design report>\n\n<the worktree line>")
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

**Say what happened to the design review, in one line of the approval message.** When it ran: N findings taken in,
M decided by you in the open questions above. When it did not run, the reason: Fable could not start, the repository
does not accept breaking changes, or the request asks for a minimal change.

**When the user corrects the base at approval**, the design was written against the wrong code:

1. Leave and remove the worktree as **Ending before approval** says.
2. Run steps 3 to 6 of **The worktree** with the new base.
3. Start a new design session from the design call.
4. Run no second design review, as for any rework at approval.
5. Ask the open questions again, then ask for approval again.

A corrected branch name just replaces the name.

### Agents

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

Exit 0: go on. Exit 1: stop and report, because **The worktree** step 4 should have settled it. Never add the path to `.gitignore`.

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
task starts a new pair. One exception: when the last task is committed and phase 5 does not run (see **Phase 5**),
keep that task's implementation session alive, because it writes the work report in phase 6. Its review session ends
here as usual. After the last task, go to phase 5, or to phase 6 when the plan has one task (see **Phase 5**).

### When the plan breaks

When the detail pass in (a) says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan** with `SendMessage`. Tell the user what the new plan is. Do not take approval again. A redraw changes the task count that phase 5 goes by. A change to the design itself goes back to the user the same way a "no" or "conditional" in phase 1 does. No design review here.

### The round cap

**Five rounds per task. Fixed.** It does not move at approval.
Each (b) counts as one round, and the count resets when the task changes.

If round five does not come back `approve`, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in `<WT>`.** Say that, say that the worktree stays as it is, and say that `/annetaan:workflow-cleanup` removes it, discarding the work, once the user decides. Do not keep the rounds going forever.

**If the user says stop at any point, stop and report.** If the user says keep going after the cap, keep going. The cap is a brake, and it is not a promise.

From an issue, the cap ends in the stop procedure in `from-issue.md`, with no question to the user.

## Phase 5: integration review

**Phase 5 runs only when the plan has two or more tasks.** With one task, the task review already read the working
tree against HEAD, and HEAD was still `START`. That is the same diff phase 5 would read, and there is no task boundary
to look at. Count the tasks in the plan as it stands when its last task is committed. A redraw under **When the plan
breaks** changes the count. With one task, a redraw can happen only while task 1 is in flight. When it grows the plan
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

### The work report

**A session that worked on the code writes the work report, in every mode. Do not write it yourself.**

- When **Bringing the base in** ran the merge task, that implementation session is alive. `SendMessage` it. This
  comes before the cases below.
- When phase 5 was skipped, the last task's implementation session is still alive (phase 4 (d)). `SendMessage` it.
- When the integration review asked for fixes, that implementation session is still alive. `SendMessage` it.
- When the integration review approved with nothing to fix, no session is left. Start one with the phase 3 prompt, carrying the progress and the handover notes, and ask it for the report and nothing else.

The request:

> Write a work report at `<WORKDIR>/log.md`. If this repository has `.github/PULL_REQUEST_TEMPLATE.md`, use it as the skeleton. Otherwise read a few recent merged pull requests (`gh pr list --state merged --limit 5`) and follow how they are written. With nothing to go on, choose a structure yourself. Whatever structure you choose, a reader has to come away with: what changed, how it was verified (the commands that were run and what they printed), what the review changed, read from the files under `./review/`, the screenshots if the change shows on screen, and which commit answers which task in the plan. Screenshots sit in the same directory, so link them relatively, as `![before](./before.png)`. Write it in the language this repository uses. **Do not create files outside this directory.**

<the worktree line>

**Keep the file name `log.md`.** Claude Code refuses a Write from a sub-agent when the name of the `.md` file
starts with `report`, `summary`, `findings` or `analysis`, in any case ("Subagents should return findings as text,
not write report files."). Nothing in settings, the environment, CLAUDE.md or agent frontmatter turns that off.

**Hand it what only you still have.** One line per task on what the review changed, and the test and type check
results the earlier sessions reported, and, when the merge task ran, the files it resolved. Those sessions are gone, and that part of the history now lives in your
context and nowhere else.

Drop the diff next to it, so the report and the review files can be read against it. The three dots take the diff
from where the branch meets `origin/<base>`, which is what the pull request shows, with or without a merge of the
base.

```bash
git diff --output=<WORKDIR>/changes.diff origin/<base>...HEAD
```

Then open the pull request.

### The pull request

```bash
git push -u origin <branch>
```

**When the change shows on screen, the screenshots go into the pull request.** Which ones depends on the change.

- **A new piece of UI** (a screen or component that did not exist): one shot of the finished state. There is nothing to compare against, so no before shot.
- **A change visible on an existing screen**: **before and after, both of them.** One on its own leaves a reviewer unable to tell what moved.
- **A change that never reaches a screen** (internals, CI, documentation): none.

Use the shots the implementation sessions took while they worked the tasks. If they are missing, `SendMessage` the session that wrote the report and have it take them before the pull request goes up. **Do not start the app and take them yourself.**

```bash
cd <WORKDIR>
```

```bash
gh pr create --base <base> --title "..." --body-file log.md \
  --attach './before.png#Before: the list has no filter bar' \
  --attach './after.png#After: a filter bar sits above the list'
```

- **`--attach` needs gh 2.99.0 or later**, and it works on GitHub.com and GitHub Enterprise Cloud. See below for older versions.
- **Run it from `<WORKDIR>` and pass the same relative paths the report uses.** gh replaces a path the body already references with the uploaded URL, and appends the attachment when it finds no reference. `./before.png` in the body and an absolute path on the flag do not match, so the images land at the bottom in the wrong order.
- Alt text follows the path after `#`. Left out, the filename becomes the alt text. Write what the picture shows.
- Videos attach the same way and render as a player, without alt text. Use one to show a sequence of interactions.
- Fifty files per command. A failed upload still creates the pull request and only sets a non-zero exit code. **Check the exit code and read the body back.** Reattach what fell out with `gh pr edit <number> --attach`.

**When `attach` is false and there are screenshots**, create the pull request without `--attach`
(`gh pr create --base <base> --title "..." --body-file <WORKDIR>/log.md`, with no `cd` needed),
then tell the user in the final message, with `<version>` from `gh` in `worktree.sh start`'s output:

> `before.png` and `after.png` could not be attached automatically. `--attach` needs gh 2.99.0 and this machine has `<version>`. Drag both files onto the pull request body for now. `brew upgrade gh` and the next run attaches them by itself.

List the file paths and the pull request URL alongside. **Say nothing about the gh version when the change produced no screenshots.**

When the push fails, quote the error and go to **Report to the user**. The branch and its commits stay in `<WT>`. When `gh pr create` exits non-zero, run `gh pr view <branch> --json url` first. If a pull request exists (a failed upload still creates one), carry on with its URL and the reattach step above. If none exists, quote the error and go to **Report to the user**. Otherwise carry the pull request URL into the closing report below.

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

## From a pull request

The user asks to resolve the conflicts of a pull request that is already open, often one this skill or pj4-running
opened, long after the run that opened it. The request covers the whole of it: **ask no approval**. A new worktree
takes the branch, the merge task resolves the conflicts under review, the merge is pushed to the branch, and the
worktree is cleaned up.

### What it skips

- **Does this repository accept breaking changes?**, and phases 1, 2 (a) and 5. Ask nothing and write nothing to
  memory.
- Phase 6 apart from the push below, and **Report to the user**, which the report below replaces.

### Which pull request

Run `worktree.sh start` as **Before you start** says. Then take the number the request names, as `#12` or a URL.
When it names none and the conversation is about one pull request, take that one. Otherwise:

```bash
$FLOW/scripts/worktree.sh pr
```

`pick` lists in `candidates` the open pull requests of the user that GitHub reports as conflicting. One: take it.
Several: ask one `AskUserQuestion` with each as `#<number> <title>`, at most four, the newest first. None: ask for
the number, saying that GitHub reports none of the user's open pull requests as conflicting.

```bash
$FLOW/scripts/worktree.sh pr <number>
```

- **`ok`**: keep `pr.head` as `<head>`, `pr.base` as `<base>`, and the number as `<n>`.
  - **`pr.project` is set**: this is project #`pr.project`'s pull request, from its base branch, which only
    pj4-running pushes to. Say so in one line, then load `Skill(skill: "annetaan:pj4-running", args: "<pr.project>")`
    and follow it. Every sub-issue of the project is closed, so it brings `<base>` in under review and finds the pull
    request there. The user's request covers its run.
- **`stop`** with `not-open`, `fork` or `unknown`: quote `message` and stop. Nothing was changed.

### The worktree

Run steps 3 to 6 of **The worktree** with `<head>` in place of the base: `worktree.sh create <head>` puts the new
worktree on the tip of `origin/<head>`, detached, so a worktree that already has `<head>` checked out, such as the
one the run that opened the pull request left, is not in the way. A stop there ends this entry, as it would a
standalone run. Then make the work directory as phase 2 (d) says, from `git rev-parse HEAD`.

### The merge

```bash
$FLOW/scripts/worktree.sh sync <name> <base>
```

- **`current`** or **`clean`**: `<head>` does not conflict with `origin/<base>`, so nothing is resolved. Say so, and
  that GitHub may take a moment to see it. Clean up as below.
- **`conflict`**: print `<base> conflicts with <head> in <k> file(s)`. Read the pull request,
  `gh pr view <n> --json title,body`. When its body begins `Implements #<i>`, read that issue's `## Design` too. Read `merge-task.md` and run
  **The merge task** with `<incoming>` as `origin/<base>`, `<into>` as `<head>`, `<M>` as `start`, and as `<intent>`:
  "the change pull request #<n> makes, as its title and body describe it", followed by the title, the body and the
  issue's design when there is one.
- **`stop`**: quote `message`, and leave the worktree as **Ending before approval** says.

### The push

On `finished`:

```bash
git -C <WT> push origin HEAD:refs/heads/<head>
```

A plain push goes through only as a fast-forward, so it never rewrites the branch. When git refuses it because
`<head>` moved on origin, say so: someone pushed to it during the run. Leave `<WT>` with its merge commit, say that
`/annetaan:workflow-cleanup`, picking `<name>`, removes it, and stop. Ask the user whether to run the merge again on the new tip.

### Cleaning up and the report

After a push, or when nothing needed resolving, leave the worktree (`ExitWorktree(action: "keep")`, or `cd <MAIN>`)
and remove it.

```bash
$FLOW/scripts/worktree.sh cleanup <name>
```

The worktree holds a detached HEAD whose commit is on origin, so nothing is lost: the work reports move into
`<MAIN>/work-reports/`, and the worktree is removed. On `stopped` from the merge task, leave `<WT>` as it is instead,
and say that `/annetaan:workflow-cleanup`, picking `<name>`, removes it.

Tell the user: the pull request URL, the files resolved and how each was settled, in a line each, the merge commit,
what the review rounds changed, the `later` reports, and where the review files now are. For a pull request
pj4-running opened for a sub-issue, add that the next `/annetaan:pj4-running` merges it.

## From a sync

pj4-running loads this skill once every sub-issue of project `P` is closed, before it opens the project's pull
request, when merging `origin/<from>` into the project's base branch stopped on conflicts. The merge is in progress in
`<WT>`. It runs **The merge task** in `merge-task.md`, and pushes nothing. pj4-running pushes the merge.

### What pj4-running has settled

These values are already in your context. Nothing arrives as an argument.

- the parent `P`, the base branch `<base>`, and `<from>`
- the conflicted files
- `<START>`: the tip of the base branch the merge started from
- the handover notes, seeded from the parent's handover comment
- the run's worktree `<WT>`, and `<MAIN>`, the main working tree. The session is in `<WT>`, on a detached HEAD

pj4-running has already confirmed that `work-reports/` is ignored in `<WT>`. Every command below runs in `<WT>`.
Never touch `<MAIN>`.

### What it skips

Everything **From an issue** in `from-issue.md` skips, phase 2 (c) and phase 6. Phase 2 (d) runs as written, with `<START>`.

### The merge task

Read the parent, `gh issue view <P> --json body`. Read `merge-task.md` and run **The merge task** with `<incoming>` as `origin/<from>`,
`<into>` as `<base>`, `<M>` as `<START>`, and as `<intent>`: "project #<P>'s changes, as the parent's `## Design`
describes them", followed by that design. A `later` report goes to pj4-running's **Unplanned work** as it arrives,
worded "found while merging `<from>` into `<base>`". The merge task says that a stop leaves the merge in progress in
`<WT>`. Say plainly that it is local, that the next run never uses it, and that the merge gets redone.

### What it hands back to pj4-running

What **The merge task** in `merge-task.md` hands back, to pj4-running's **Bringing `<from>` in**.

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
