---
name: workflow
description: Runs one implementation as design, approval, then per task (implement, review rounds, one commit), then an integration review, then a finish step that opens a pull request, pushes, or stops locally. The review rounds happen in difit, a local diff viewer, so a human can write into the same threads from a browser. Use it only when the user names this skill or invokes /annetaan:workflow, because it starts a long-running local server, opens a browser, spawns three sub-sessions, and adds commits. Do not use it for a one-off implementation request or for an ordinary code review request.
---

# workflow

One implementation, run as **design, approval, then per task (implement, review rounds, one commit), then an integration review, then a finish step**, with each role in its own session.
The review rounds happen in difit comment threads. Open the same server in a browser and a human writes into the same threads.

The design session returns a **plan**: an ordered list of small tasks. Implementation and review rounds run inside a task. A task the reviewer approves becomes **one commit**. After the last task an **integration review** looks at the whole diff once. Then the flow finishes.

You are the main session, and you are the **orchestrator. You do not write code.** Sub-agents design, implement and review. You pass work between them and you are the only window onto the human.

## Paths: `$FLOW`

The top of this instruction carries an absolute path as `Base directory for this skill:`. **`$FLOW` below means that path.**

`$FLOW` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

## Before you start

This skill starts a long-running local server, opens a browser, and adds commits. **Start it only when the user names it or invokes `/annetaan:workflow`.**

Run these checks and keep every answer. Phase 1 needs all of them.

```bash
git rev-parse --show-toplevel            # inside a git repository
git status --porcelain                   # must be empty
git branch --show-current                # where commits land if the user keeps this branch
git symbolic-ref --quiet refs/remotes/origin/HEAD | sed 's|refs/remotes/origin/||'   # the default branch
git remote get-url origin                # is there a remote at all
command -v difit || echo "falls back to npx difit"
gh auth status                           # informational, see below
gh --version                             # --attach needs 2.99.0 or later
```

- **A dirty working tree or a missing git repository stops the flow.** Tell the user and wait.
- **`gh` failing does not stop the flow.** It removes the pull request option in phase 1. Say nothing about it yet.
- **A `gh` older than 2.99.0 does not stop the flow either.** `gh pr create --attach` landed in 2.99.0. Phase 6 needs it only when the change is visible on screen. Say nothing about it yet.
- If `git symbolic-ref` prints nothing, fall back to `main` and treat the default branch as unknown.

## Phase 1: design

Hand the user's request to the design session as it was written.

```
Agent(subagent_type: "annetaan:workflow-design", description: "design",
      prompt: "Read $FLOW/roles/design.md first and follow the role it describes.\n\nThe request:\n<the user's request, verbatim>")
```

`annetaan:workflow-design` ships with this plugin and is pinned to opus at high effort with code changes disabled.

When the design comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait. Do not walk past it.
- **Keep the plan.** It is an ordered list of tasks, each with the files it touches. If the plan is missing, use `SendMessage` to make the design session produce it.
- **If the design raises open questions**, ask the user with `AskUserQuestion`, then send the answers back with `SendMessage` so the design session can settle them.
- **The round cap is five per task and it is fixed.** Mention it once at approval. Do not negotiate the number (see **The round cap**).

**Keep the design session alive for the whole flow.** You go back to it twice. Before every task from task 2
onward, to have it detail that task against the code as it now stands (phase 4 (a)). And whenever the plan breaks,
to have it redraw the remaining tasks.

### The approval dialog

This is the only approval point in the flow. Present the design summary and the plan, then ask **one `AskUserQuestion` with three questions**.

1. **Proceed with this design and plan?** (approve / change something first)
2. **Where do the commits go?** (a new branch `<name>` / the current branch `<name>`)
3. **How does the flow finish?** (open a pull request / push only / stop locally)

Say in the same message that everything after this runs on its own: per-task implementation and review rounds, the integration review, and the finish step.

**Derive the recommended answers and the available options from what you collected before you started.**

| What you found | Recommend for question 2 | Options for question 3 |
| --- | --- | --- |
| The current branch is the default branch | **a new branch** | pull request / push only / stop locally |
| The current branch is not the default branch | **the current branch** | pull request / push only / stop locally |
| `gh auth status` failed | unchanged | **drop the pull request option** |
| There is no `origin` remote | unchanged | **drop the pull request and push options** |
| Question 2 answered "the current branch" and that branch is the default branch | unchanged | **drop the pull request option and ask question 3 again** |

**You pick the branch name yourself.** Match the naming the repository already uses (`git branch -a`) and write your choice into the approval message, so the user can correct it there. Do not spend a question on it.

**When the commits land on the default branch, say so in the approval message.** One line: commits go straight onto `<branch>` during this flow.

**If the user already stated the mode when they invoked the skill** ("branch it and open a PR", "commit straight to main"), skip that question and write what you understood into the approval message instead, so a wrong reading is visible and correctable.

**Check for commits that came before this flow.**

```bash
git rev-list --count <default branch>..HEAD
```

Skip this when the default branch could not be resolved.

If this is not zero, the pull request will show those commits too, and they never went through this review. Say so in the approval message: this pull request will also carry N commits from before this flow, and the review covers only what happens from here. Carry the same sentence into the work report in phase 6.

### Agents

**The implementation and review sessions start fresh for every task.**

**A task boundary throws away almost nothing.** The code is in git, the design and the plan are in your hands, and
the unresolved threads are zero because the task was approved. What is left is how this repository wants to be
worked in, and that travels as the handover notes (phase 4 (e)).

**Every task and the integration review run on the same two agents**: `annetaan:workflow-worker` for
implementation and `annetaan:workflow-reviewer` for review, both opus / medium. There is no per-task choice to make.
Both ship with this plugin, and the model and effort are pinned in `agents/*.md`. Do not pass a `model` argument to
`Agent`, because the definition holds the right value.

## Phase 2: branch, ignore rule, start point

After approval, do these four things **in this order, before you wake the implementation session**. The order matters.

### (a) Create the branch

Only when the user chose a new branch.

```bash
git checkout -b <branch name>
```

The name is the one you put in the approval message. When the user chose the current branch, run nothing here.

### (b) Make sure `work-reports/` is ignored

Screenshots and the work report go to **`work-reports/` inside the repository**. Outside the repository they grow on disk where nobody sees them. Inside the repository, **check first that git is not tracking it.**

```bash
ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" check-ignore -q work-reports && echo IGNORED || echo NOT_IGNORED
```

- **`IGNORED`**: use it. Ask nothing.
- **`NOT_IGNORED`**: **ask the user before you touch `.gitignore`.** Never add it on your own.

```
AskUserQuestion: I want to use work-reports/ for the work report and the screenshots,
and .gitignore does not cover it. May I add it?
  - Add it (recommended) - appends work-reports/ to .gitignore as a commit of its own
  - Do not add it        - you decide where the files go
```

When the user says yes, make it **a commit of its own**. A `.gitignore` change mixed into the implementation diff blurs what the review is looking at.

```bash
printf 'work-reports/\n' >> "$ROOT/.gitignore"
git -C "$ROOT" add .gitignore && git -C "$ROOT" commit -m "chore: ignore work-reports/"
```

Match the repository's commit message style. When (a) created a branch, this commit sits on that branch and shows
up in the pull request. That is fine, because `START` comes after it and the review never sees it.

When the user says no, stop and ask what to do. Files under a directory git still tracks get swept into a commit.

### (c) Record the start point

**Do this after (b).** Taken before the `.gitignore` commit, `START` would drag that commit into the review.

```bash
START=$(git rev-parse HEAD)
```

**This value runs through the whole flow.** The difit target, the integration review, the report and the final message all start from `START`.

### (d) Create the work directory

```bash
WORKDIR="$ROOT/work-reports/$(date +%Y-%m-%d-%H%M)-${START:0:7}"
mkdir -p "$WORKDIR"
echo "$START" "$WORKDIR"
```

The timestamp is local time. Directories sort by time, so the newest report is the last one in the list.

**Tell the user `START` and `$WORKDIR` right away, in one short line.** Your context gets summarised on a long flow, and that message is the copy that survives.

## Phase 3: the implementation prompt

**Every task starts a new implementation session, task 1 included.** This is the shape of the call. Phase 4 (a) is
where you make it.

```
Agent(subagent_type: "annetaan:workflow-worker", description: "implementation, task k",
      prompt: "Read $FLOW/roles/work.md first and follow the role it describes.\n\nApproved design:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<what the design session returned for task k. For task 1, the part of the approved design that covers it>\n\nStart point START: <the SHA>\nBranch: <branch name>\n\nProgress:\n<the tasks already done and the commit that closed each, as the matching `git log --oneline` lines. \"none\" for task 1>\n\nHandover notes from the earlier sessions:\n<the notes you have been accumulating. \"none\" for task 1>\n\nImplement task k, \"<task name>\", of the plan. **Do not commit yet.** Report back once the tests pass.")
```

### Screenshots

**When the change shows on screen, add this paragraph to the implementation prompt.** Phase 6 uses the files. They go into the `$WORKDIR` you made in phase 2.

> If this change shows on screen, take screenshots. When an existing screen changes how it looks or behaves, **take the current state (before) first, before you touch anything**, then implement, then take the after shot. When you only add a new screen or component, the after shot alone is enough. Save them in `<absolute path of WORKDIR>`. **Do not create files anywhere else** (`work-reports/` is ignored, and anything outside it ends up in a commit). Report the path of each file and what it shows.

**The before shot cannot be taken afterwards.** Saying it once implementation has started is too late, so it goes in the prompt that opens the task. Leave it out for a change that never reaches a screen (internals, CI, documentation).

### How long the session lives

**One implementation session covers one task.** Every review round for that task continues through `SendMessage` to
the same agent, because answering a finding on your own code needs the context that wrote it. The commit in phase 4
(e) ends it. You never message it again, and the next task starts a new one.

## Phase 4: the task loop

Work the plan one task at a time. Nothing runs in parallel, because there is one working tree.
A task is **(a) detail it and implement, (b) show the diff in difit, (c) review, (d) respond, back to (c), then (e) commit on approve**.

**(a) Detail the task, then implement**

**Task 1 needs no detailing.** The design session read the repository in the state task 1 starts from, so the detail
it wrote for task 1 cannot have gone stale.

**From task 2 onward, go back to the design session first.** `SendMessage`:

> Task k-1 is committed as `<short SHA>`. Detail task k, "<task name>", against the code as it stands now. What the earlier tasks actually produced outranks what the design predicted. Follow **Detailing a task** in your role instruction. If the task boundary itself no longer holds, say that instead.

**This is where a broken plan gets caught before anyone writes code against it.** An answer that says the boundary no
longer holds goes to **When the plan breaks**.

Then start a new implementation session with the phase 3 prompt.

Check that the tests pass before you send anything to review. `git status --porcelain` shows the change sitting in the working tree, and `git log -1` shows HEAD has not moved.

**(b) Show the diff in difit**

difit shows **the working tree against HEAD**, which is every uncommitted change including untracked files. That is exactly the current task.

First time:
```bash
$FLOW/scripts/difit-session.sh start . HEAD
$FLOW/scripts/difit-session.sh open
```
Give the URL to the user. **From here the user can write comments straight from the browser.** Those comments reach the implementation session through the same path as the reviewer's findings.

Every time after that, including the next round of the same task and the first round of the next task:
```bash
$FLOW/scripts/difit-session.sh refresh
```

**Skip this and the review session reads a stale diff.** difit pins the diff at start-up, so later edits show up only after a restart. The restart reuses the port, so ask the user to reload the browser.

A restart drops the comments on the server, so `refresh` **carries unresolved threads over by itself**. Each conversation becomes one body under a new id, and every utterance keeps a `[review]`, `[work]` or `[User]` label, so a finding still reads differently from a rebuttal after the carry. Resolved threads are dropped. That is why the order in (d) matters. Handled threads get resolved and disappear, and only live disagreements survive into the next round. Line positions come from the previous round, and the carried body says so.

**Right after a task is approved and committed, there should be zero unresolved threads.** An old thread showing up in the next task's first `refresh` means the previous task was closed wrong.

**(c) Review**

**Round 1 of every task starts a new review session.**

```
Agent(subagent_type: "annetaan:workflow-reviewer", description: "review, task k",
      prompt: "Read $FLOW/roles/review.md first and follow the role it describes.\n\nApproved design and acceptance criteria:\n<the full design>\n\nPlan:\n<the full plan>\n\nDetail design for this task:\n<the same one the implementation session got>\n\nProgress:\n<the tasks already done and the commit that closed each. \"none\" for task 1>\n\nUnder review: task k, \"<task name>\". The diff sits between the working tree and HEAD (`git diff HEAD` plus untracked files). difit shows the same diff.")
```

Every round after that goes to the same session with `SendMessage`, as "the diff has been updated, review it again".
A reviewer has to remember what it asked for and what the implementation side answered back. The session ends with
the task, at (e).

An `approve` with zero unresolved threads goes to (e). Anything else goes to (d).

**(d) Respond**

`SendMessage` to the implementation session.

> Review comments are in difit. Read them with `$FLOW/scripts/difit-session.sh comments`, reply to each thread, then fix what needs fixing. Leave a thread open with your reasoning when you disagree. **Do not commit yet.** Report back once the tests pass.

Go back to the `refresh` in (b), then to (c). Count one round.

**(e) Commit on approve**

`SendMessage` to the implementation session.

> Task k, "<task name>", passed review. Turn its changes into **one commit**. Match the commit message style this repository already uses and make the task recognisable. Check that `git status --porcelain` is empty afterwards and report back. End the report with **notes for the next session, five lines at most**: the commands that run the tests and the type checks, the conventions you kept and the traps you hit, and anything that bears on the tasks still to come. No explanation of the code.

Check it yourself with `git log -1 --oneline`, `git status --porcelain`, and `git branch --show-current` to confirm the branch has not moved. Anything left in the working tree needs an explanation from the implementation session. Screenshots inside `$WORKDIR` are ignored by git and can stay.

**Add those notes to the handover notes you keep.** Fold the duplicates together. Once the whole thing runs past
fifteen lines, drop the oldest. The next task's implementation prompt carries this, and it is the only thing that
outlives a session.

**Give the user a one-line progress report**: `task k/N done: <short SHA> <commit subject> (commit k since START <short SHA>)`. A long context can be summarised away, and the plan, `START` and the progress all rebuild from that line.

**This task's implementation and review sessions are finished here.** Do not send them anything after this. The next
task starts a new pair. After the last task, go to phase 5.

### When the plan breaks

When the detail pass in (a) says the boundary no longer holds, or the implementation session reports that the design will not work, stop that task and have the design session **redraw the remaining plan** with `SendMessage`. Tell the user what the new plan is. Do not take approval again. A change to the design itself goes back to the user the same way a "no" or "conditional" in phase 1 does.

### The round cap

**Five rounds per task. Fixed.** It does not move at approval.
Each (c) counts as one round, and the count resets when the task changes.

If round five does not come back `approve`, stop and report to the user. Lay out what is still open and what each side said, and ask for a decision. **That task's changes are sitting uncommitted in the working tree.** Say that, and say that `git stash` or `git checkout -- .` can park or drop them. Do not keep the rounds going forever.

**If the user says stop at any point, stop and report.** If the user says keep going after the cap, keep going. The cap is a brake, and it is not a promise.

## Phase 5: integration review

Once every task is committed, **review the whole diff once.** A review inside a task cannot see the task boundaries: interfaces that do not line up, a rename done on one side only, work duplicated between tasks.

Switch the difit target to the whole change. The base changes, so this is `stop` then `start` rather than `refresh`.

```bash
$FLOW/scripts/difit-session.sh stop
$FLOW/scripts/difit-session.sh start . <START>
```

That shows the working tree, which should be empty at this point, against `START`, which is every commit put together. Fixes from the integration review land uncommitted in the working tree, so later rounds follow with `refresh` on the same target.

**The integration review starts a new review session.**

```
Agent(subagent_type: "annetaan:workflow-reviewer", description: "integration review",
      prompt: "Read $FLOW/roles/review.md first and follow the role it describes.\n\nApproved design and acceptance criteria:\n<the full design>\n\nPlan, with the commit that closed each task:\n<the plan plus the matching `git log --oneline` lines>\n\n<the request below>")
```

> Every task is committed. This is the integration review. The target is `git diff <START>..HEAD`, plus the working tree from the next round onward. The tasks were reviewed one at a time, so look at **the boundaries**: types and contracts between functions that call each other across tasks, names that do not match, duplicated implementations, and acceptance criteria for the whole design that are still unmet.

**`changes-requested` starts a new implementation session as well**, with the phase 3 prompt. The progress is every task, the handover notes are everything you have collected, and the request is to
answer the integration review. From there the (c), (d), (b) loop is the same as phase 4, and the cap is the same
**five rounds**. Neither session gets rebuilt during those rounds. Fixes become **one commit** after approval, with a
subject that says what it is, such as "integration review fixes". No fixes means no commit.

Review says `approve`, zero unresolved threads, tests pass. Phase 6 starts when all three hold.

## Phase 6: finish

### The work report

**A session that worked on the code writes the work report, in every mode. Do not write it yourself.**

- When the integration review asked for fixes, that implementation session is still alive. `SendMessage` it.
- When the integration review approved with nothing to fix, no session is left. Start one with the phase 3 prompt, carrying the progress and the handover notes, and ask it for the report and nothing else.

The request:

> Write a work report at `<WORKDIR>/log.md`. If this repository has `.github/PULL_REQUEST_TEMPLATE.md`, use it as the skeleton. Otherwise read a few recent merged pull requests (`gh pr list --state merged --limit 5`) and follow how they are written. With nothing to go on, choose a structure yourself. Whatever structure you choose, a reader has to come away with: what changed, how it was verified (the commands that were run and what they printed), what the review changed, the screenshots if the change shows on screen, and which commit answers which task in the plan. Screenshots sit in the same directory, so link them relatively, as `![before](./before.png)`. Write it in the language this repository uses. **Do not create files outside this directory.**

**Keep the file name `log.md`.** Claude Code refuses a Write from a sub-agent when the name of the `.md` file
starts with `report`, `summary`, `findings` or `analysis`, in any case ("Subagents should return findings as text,
not write report files."). Nothing in settings, the environment, CLAUDE.md or agent frontmatter turns that off.

**Hand it what only you still have.** One line per task on what the review changed, and the test and type check
results the earlier sessions reported. Those sessions are gone, and that part of the history now lives in your
context and nowhere else.

Drop the diff next to it, so the change stays readable once difit is gone.

```bash
git diff <START>..HEAD > "$WORKDIR/changes.diff"
```

When phase 1 found commits from before this flow, have the report say so: this report covers `<START>..HEAD`, and the pull request also carries N commits from before it.

Then take one of the three endings below, whichever the user picked at approval.

### 6a. Open a pull request

```bash
$FLOW/scripts/difit-session.sh stop
git push -u origin <branch>
```

**When the change shows on screen, the screenshots go into the pull request.** Which ones depends on the change.

- **A new piece of UI** (a screen or component that did not exist): one shot of the finished state. There is nothing to compare against, so no before shot.
- **A change visible on an existing screen**: **before and after, both of them.** One on its own leaves a reviewer unable to tell what moved.
- **A change that never reaches a screen** (internals, CI, documentation): none.

Use the shots the implementation sessions took while they worked the tasks. If they are missing, `SendMessage` the session that wrote the report and have it take them before the pull request goes up. **Do not start the app and take them yourself.**

```bash
cd "$WORKDIR"
gh pr create --base <default branch> --title "..." --body-file log.md \
  --attach './before.png#Before: the list has no filter bar' \
  --attach './after.png#After: a filter bar sits above the list'
```

- **`--attach` needs gh 2.99.0 or later**, and it works on GitHub.com and GitHub Enterprise Cloud. See below for older versions.
- **Run it from `$WORKDIR` and pass the same relative paths the report uses.** gh replaces a path the body already references with the uploaded URL, and appends the attachment when it finds no reference. `./before.png` in the body and an absolute path on the flag do not match, so the images land at the bottom in the wrong order.
- Alt text follows the path after `#`. Left out, the filename becomes the alt text. Write what the picture shows.
- Videos attach the same way and render as a player, without alt text. Use one to show a sequence of interactions.
- Fifty files per command. A failed upload still creates the pull request and only sets a non-zero exit code. **Check the exit code and read the body back.** Reattach what fell out with `gh pr edit <number> --attach`.

**When gh is older than 2.99.0 and there are screenshots**, create the pull request without `--attach`
(`gh pr create --base <default branch> --title "..." --body-file "$WORKDIR/log.md"`, with no `cd` needed),
then tell the user in the final message:

> `before.png` and `after.png` could not be attached automatically. `--attach` needs gh 2.99.0 and this machine has `<version>`. Drag both files onto the pull request body for now. `brew upgrade gh` and the next run attaches them by itself.

List the file paths and the pull request URL alongside. **Say nothing about the gh version when the change produced no screenshots.**

Carry the pull request URL into the closing report below.

### 6b. Push only

```bash
$FLOW/scripts/difit-session.sh stop
git push -u origin <branch>
```

Tell the user the branch is pushed and no pull request was opened, and give the path of `log.md`.

### 6c. Stop locally

```bash
$FLOW/scripts/difit-session.sh stop
```

Nothing is pushed. Tell the user so plainly, and add how to undo the commits (`git revert <START>..HEAD`) so the decision is theirs to make.

### Report to the user

Whichever ending ran, close with: `START`, the commits stacked on it matched against the tasks in the plan, the design summary, and what the review changed. Then:

- **the path of the work report** (`<WORKDIR>/log.md`), which opens in an editor with the screenshots inline
- how to bring difit back for another look: `$FLOW/scripts/difit-session.sh start . <START>`
- the screenshot paths, when the change shows on screen

## Rules for the whole flow

- **You do not write code.** The implementation session implements and the review session reviews. Code you write yourself never passes through a review.
- **The review session never changes code.** It writes findings. The implementation session fixes them.
- **One difit server per repository.** Start, restart and stop all go through `difit-session.sh`. Calling `difit` by hand multiplies ports and tabs.
- **The design session lives for the whole flow. An implementation session and a review session live for one task.** Inside a task they continue through `SendMessage`, because throwing the context away between rounds repeats arguments that were already settled. At the commit they are finished, and the next task starts a new pair.
- **Keep the reports from the sub-agents short.** The role instructions cap them. A report that pastes a diff or a log fills the one context that holds the whole plan, which is yours. When a long one arrives, say so, and ask for the gist next time.
- **One task is one commit, and a commit happens only after approval.** A commit mid-round drops the diff out of difit's working-tree view and out of the review.
- **No branches, no history rewriting from the sub-sessions.** The main session owns `git checkout -b`. `git rebase`, `git reset --hard` and `--amend` break the `START` comparison. The role instructions say the same.
- **Do not lose `START`.** The phase 2 message to the user and the per-task progress lines in phase 4 are the copies that survive a summarised context.
- **Never write into `work-reports/` without checking it is ignored.** Unchecked, the report and the screenshots ride into the next commit. Ask the user before adding it to `.gitignore`.
- **Do not move anything under `$WORKDIR` into version control.** The report, the screenshots and the diff are worth more untracked. Move them only when the user asks.
- Report a failure when it happens: a failing test, a design that falls apart, difit refusing to start. **Approved commits are already on the branch and the task in flight is uncommitted in the working tree.** Say both.
- Run `difit-session.sh stop` when the flow is interrupted, or the server keeps running.

## Checking state

```bash
$FLOW/scripts/difit-session.sh status     # port, URL, pid, target (a task shows target=. base=HEAD, the integration review shows base=START)
$FLOW/scripts/difit-session.sh comments   # unresolved threads, as JSON
```

## difit comment format (measured)

```jsonc
// a new finding
{"type":"thread","filePath":"src/x.ts","position":{"side":"new","line":42},"body":"..."}
// a range
{"type":"thread","filePath":"src/x.ts","position":{"side":"new","line":{"start":36,"end":39}},"body":"..."}
// a reply, where threadId alone is not enough. filePath and position are required too, with the values of the original thread
{"type":"reply","threadId":"<id>","filePath":"src/x.ts","position":{"side":"new","line":42},"body":"..."}
```

An array passes several at once. `side` is `"new"` on the added side of the diff and `"old"` on the removed side.

**The author comes from `add --as <review|work>`.** Writing `author` into the JSON gets forgotten, so the script injects it into every element of the payload. Comments from the browser UI get `author` set to `"User"` by difit itself, which is how a human's writing stays recognisable. `refresh` folds that `author` into a `[…]` label in the body, and repeated carries never double the label.

**The trap in replies**: when `threadId` and `position` disagree, difit **takes `position`**. A reply pointing at another line lands on that line's thread. Copy `filePath` and `position` wholesale out of the `comments` JSON when you build a reply.
