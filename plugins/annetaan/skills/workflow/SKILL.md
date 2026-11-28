---
name: workflow
description: Runs one implementation as design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that merges the base in and resolves the conflicts under review when the branch conflicts with it, pushes and opens a pull request, then files each design decision in technology, infrastructure, database or delivery that review seat a finds as an issue labelled `decision`. Also resolves the conflicts of a pull request that is already open, with the same review rounds, and pushes the merge to its branch. The standalone run works in a git worktree of its own, `.claude/worktrees/run-<stamp>`, and leaves the main working tree alone, except for adding the user's answers to its `.worktreeinclude`. The review rounds run through Markdown files in the run's work report directory. Use it only when the user names this skill or invokes /annetaan:workflow, or when the user asks to resolve the conflicts of a pull request ("resolve the conflicts on #12", "コンフリクト解消して"), because it spawns several sub-sessions, adds commits, opens a pull request and files issues without asking for approval. Do not use it for a one-off implementation request or for an ordinary code review request.
---

# workflow

One implementation, run as **design, then per task (implement, review rounds, one commit), then an integration review when the plan has more than one task, then a finish step that pushes and opens a pull request, then files each design decision in technology, infrastructure, database or delivery that review seat a finds as an issue labelled `decision`**, with each role in its own session.
The review rounds run through Markdown files under the run's work report directory, described in
`$FLOW/review-files.md`.

The design session writes a **plan** into the run's work directory: an ordered list of tasks. Implementation and review rounds run inside a task. A task the review approves becomes **one commit**. After the last task of a plan with more than one task, an **integration review** looks at the whole diff once. Then the flow finishes.

You are the main session, and you are the **orchestrator. You do not write code.** Sub-agents design, implement and review. You pass work between them and you are the only window onto the human.

**Each entry has a file of its own next to this one. Read it before anything else, follow it, and read it again after a context summary.**

| Entry | When | Read |
| --- | --- | --- |
| Standalone | the user names this skill or invokes `/annetaan:workflow` for an implementation | `$FLOW/standalone.md` |
| From a pull request | the user asks to resolve the conflicts of a pull request | `$FLOW/from-pr.md` |

The task loop is in `loop.md`: **Detail and implement** in `loop.md`, **Review** in `loop.md`, **Respond** in `loop.md`, **Commit** in `loop.md`, **When the plan breaks** in `loop.md` and **The round cap** in `loop.md`. **The integration review** is in `integration.md`, **The merge task** in `merge-task.md`, and the work report, the pull request and the decisions in `finish.md`: **The work report** in `finish.md`, **The pull request** in `finish.md` and **The decisions** in `finish.md`. **Begin** and **The run's files** are below. Each entry's file says which of them it runs, in which order, and how each ends for it. Everything it does not mention runs as written. A request to resolve a conflict is a request to do it: never answer it with a refusal or a suggestion to run something else, unless **From a pull request** in `from-pr.md` says to stop.

## Paths: `$FLOW`

**`$FLOW` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$FLOW` is not a shell variable. Write it out as the real absolute path in the commands you run. `flow.sh prompt` writes every path of a sub-agent prompt (**The prompts**), and the one prompt written by hand, **Design** in `standalone.md`, writes `$FLOW` out too. Sub-agents have not read this instruction, so a relative path or a literal `$FLOW` finds them nothing.

Parts of this skill live in files next to this one, named by their bare name from here on: `$FLOW/merge-task.md`, `$FLOW/from-pr.md`, `$FLOW/worktree.md`, `$FLOW/finish.md`, `$FLOW/standalone.md`, `$FLOW/loop.md`, `$FLOW/integration.md`.

The standalone flow also uses the script `$FLOW/scripts/worktree.sh`, written `worktree.sh` in this skill's files. Every subcommand
prints one JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message
and stop. The standalone flow and From a pull request call it.
**Ending with nothing changed** in `worktree.md` and the end of From a pull request remove the run's worktree with
`$FLOW/../cleanup/scripts/cleanup.sh run`, of the skill `cleanup`.
`$FLOW/scripts/include.sh`, written `include.sh`, has one subcommand, `remember`, which records the answers of **Files `.worktreeinclude` does not name** in `worktree.md` and prints one JSON object with a `status`. The standalone flow, From a pull request, pj4-running, level and pj-roadmap call it, the last two through step 3 of **The worktree** in `worktree.md`.

Every entry also uses `$FLOW/scripts/flow.sh`, written `flow.sh`, which owns the run's work directory and the
review seats, one git worktree each beside `<WT>`. `flow.sh begin` makes the work directory (**Begin**), and
`flow.sh status <WT>` reads it back. With a scope, `flow.sh status <WT> <scope>` also reports where that scope's
review stands: the next round, whether the cap is reached, the last verdict and the open findings (**Review** in `loop.md`). A seat reaches its worktree only through `flow.sh run <WT> <seat> <probe dir>`,
which runs a probe the seat wrote (see `$FLOW/review-files.md`, **A probe**), and `flow.sh close <WT>` removes the
seats at the cleanup. `flow.sh verify <WT> <scope>` runs again every command of a review round and writes the draft
of its round file, and `flow.sh round <WT> <scope> <judgement file>` writes the round file and its verdict from the draft
and your judgement (**Review** in `loop.md`). `flow.sh lint <file>` checks a seat file, a reply, an evidence file or `decisions.md`
against `$FLOW/review-files.md`, and each writer runs it on its own file before it reports. The finish runs `flow.sh record <WT>`, which writes the pull request
head and the `Level:` line into `log.md` (`finish.md`, **The work report**). The finish runs `flow.sh decisions <WT> <m>`, which files the issues of `<WORKDIR>/decisions.md` (`finish.md`, **The decisions**). `flow.sh prompt <WT> <kind> [<scope>] [<seat>]`
writes the prompt of one sub-agent call (**The prompts**). `<WT>` is the absolute path, `lint` takes
the absolute path of the file, and `round` the absolute path of the judgement file. All ten print one JSON object with a `status`, as `worktree.sh` does. A non-zero exit is quoted and stops the run, the
same way, except for `decisions`: the pull request already exists then, so its exit is quoted in the ending and the run
goes on (`finish.md`, **The decisions**).

## The level

The repository's level picks the model and the effort of the design session, the implementation session and the
review seats. The script `$FLOW/scripts/level.sh` is written `level.sh` in this skill's files. It reads the level from
`.claude/annetaan-level.md` on origin's default branch, and from nowhere else.

```bash
$FLOW/scripts/level.sh show <WT> [<level>]
```

- **Standalone and From a pull request** run it right after entering `<WT>` (**The worktree** step 4 in
  `worktree.md`). `<level>` comes from `level=<level>` in the args, and is left out when the args carry none. The token sets
  the level of this run only, and it is not part of the request.
- **Every entry** hands `level` and `source` of that JSON to `flow.sh begin` (**Begin**), which writes them to the
  run's `run.json`. `show` stays the one read of the level in a run.

It prints `status: ok` with `level`, `source` (`file`, `override` or `default`), `ref`, `evaluated`, `reviewBy`,
`warning`, `agents` and `seats`. `agents.<name>` holds the `model` and the `effort` of `workflow-design`,
`workflow-worker`, `workflow-reviewer-a`, `workflow-reviewer-b`, `pj-planner`, `pj-reviewer` and `pj-issue-writer`,
for each of them the level runs. `seats` lists the review seats this level runs, `a` alone at `standard` and `a` and
`b` at `high`, and `agents` names a `workflow-reviewer-<seat>` for exactly those. Keep the JSON. Print `level <level> (<source>)`
once, and `warning` on a line of its own when it is set. A warning never stops the run. The finish's `flow.sh record`
writes the `level` and `source` that `begin` stored into `log.md` (`finish.md`, **The work report**), and
`/annetaan:level` reads them back from the merged pull requests.

After a context summary, run `$FLOW/scripts/flow.sh status <WT>`, then `$FLOW/scripts/level.sh show <WT> <level>`
with the `level` `status` printed, and read only its `seats`, and `agents.workflow-design` while **Design** in `standalone.md` is still
ahead. Every other call takes its model and effort from `flow.sh prompt` (**The prompts**). The run's `level` and
`source` stay the ones `status` printed.

**Begin** has not run yet when `status` stops with `no-run`. Then **Begin** is still ahead, and the level comes as
at the start: standalone and From a pull request run `show` as the bullets above say.

A non-zero exit is a usage error, such as `level=<level>` other than `standard` or `high`, or an unexpected failure: quote its message and
stop, as for `worktree.sh`.

## Before you start

This skill spawns sub-sessions and adds commits. **Start it only when the user names it or invokes
`/annetaan:workflow`, or asks to resolve the conflicts of a pull request.** `level=<level>` in the args, `standard` or `high`, sets the repository's level for this run (see **The level**).

## Agents

**The implementation session and the review seats start fresh for every task.**

**A task boundary throws away almost nothing.** The code is in git, the design, the plan and each task's detail are files
of the run in `<WORKDIR>` (**The run's files**), and every finding is resolved because the task was approved. What is left is how this repository wants to be
worked in, and that travels as the handover notes (**Commit** in `loop.md`).

**Every task, and the integration review when the plan has more than one task, run on the same agents**:
`annetaan:workflow-worker` for implementation, and one `annetaan:workflow-reviewer-<seat>` for each seat of `seats`,
the review panel. There is no per-task choice to make. Seat a runs once more at the finish, to judge the decisions
(`finish.md`, **The decisions**).
They ship with this plugin. The design session runs on `annetaan:workflow-design`, which ships with this plugin too.
**Every `Agent` call passes the `model` and `effort` that `flow.sh prompt` prints for it** (**The prompts**), the
pair of its agent at the `level` of `run.json`. The one call whose prompt is written by hand, **Design** in
`standalone.md`, takes them from `agents.workflow-design` of the level JSON (**The level**).

**Seat `b` that cannot start**, at the level that runs it (a weekly limit, a rate limit, the model is unavailable), is
spawned again as `annetaan:workflow-reviewer-b` with the same prompt file, `model: "opus"` and the same `effort`. **A seat that returns no
report is a dropout**: the round goes on with the seats that reported, and the `Seats:` line of the round file says so.
When no seat reported, step 1 of **Review** in `loop.md` starts them again.

## The prompts

**You write no prompt of the task loop, the integration review, the finish, the merge task or the detail pass from an issue.** One command writes
each one, and the call that sends it is one line naming that file.

```bash
$FLOW/scripts/flow.sh prompt <WT> <kind> [<scope>] [<seat>]
```

It fills the template `$FLOW/prompts/<kind>.md` with the run's paths, the start point, the branch, the progress
(`git log --oneline <START>..HEAD`, or `none`), the scope's round from `flow.sh status`, the issue lines of a run from
an issue, and the worktree line last, which keeps every session in `<WT>` and away from `<MAIN>`. It writes the result
to `<WORKDIR>/prompts/<kind>[-<scope>][-<seat>].md`, overwriting an earlier one, and prints
`{"status": "ok", "path": ..., "agent": ..., "model": ..., "effort": ...}`. `agent`, `model` and `effort` are null
where the table says so.

| Kind | Scope | Agent | Sent by |
| --- | --- | --- | --- |
| `work` | any | `workflow-worker` | `Agent` |
| `seat` | any, with seat `a` or `b` | `workflow-reviewer-<seat>` | `Agent` |
| `again` | any | null | `SendMessage` |
| `respond` | any | null | `SendMessage` |
| `commit` | any | null | `SendMessage` |
| `detail` | `task-<k>`, `k` of 2 or more | null | `SendMessage` |
| `report` | none | `workflow-worker` | `SendMessage`, or `Agent` when no session is left |
| `design` | none | `workflow-design` | `Agent` |
| `decisions` | none | `workflow-reviewer-a` | `Agent` |

The scope is `task-<k>`, `integration` or `merge`. Send each file with one line:

```
Agent(subagent_type: "annetaan:<agent>", description: "...", model: "<model>", effort: "<effort>",
      prompt: "Read <path> first and follow it.")
```

and `SendMessage` with the same `Read <path> first and follow it.` to the session that is alive.

- Run `flow.sh prompt` once per call, one Bash call each, right before the call, because it reads the round and the
  progress as they stand then.
- The seats of one round each get a `seat` prompt, and their calls go in one message. `again` is one file, sent to
  every seat.
- The `fable` fallbacks, of the design session and of seat `b`, start the same file again with `model: "opus"` and
  the same `effort`.
- A non-zero exit names a call the procedure never makes, such as `again` before round 1 or seat `b` at `standard`:
  quote it and stop, as for any `flow.sh` exit. A `stop` with `no-run` is read as **The level** says.

**The messages that stay.** A short follow-up that asks a live session for one thing and carries none of the run's
inputs is no kind. You write it as one line naming the file it asks about: the evidence file the `work` prompt named,
when it is missing (**Detail and implement** in `loop.md`, and `no-evidence` of `flow.sh round` in step 4 of **Review** there); `<WORKDIR>/detail/task-<k>.md`, when it is
missing (**Detail and implement** in `loop.md`); the reply of the last round, when it is not in after a context summary (**Review** in `loop.md`); the redraw
of `<WORKDIR>/plan.md` (**When the plan breaks** in `loop.md`); the `Diverged:` forward and the wait (`pj4-running/run-issue.md`); the
screenshots, when they are missing, and the `malformed` forward of `flow.sh decisions` to seat a, naming
`<WORKDIR>/decisions.md` (`finish.md`).

## Begin

Screenshots, the review files and the work report go to the run's work directory under **`work-reports/` inside the
worktree**. `begin` checks that git ignores `work-reports/` in `<WT>`, takes `HEAD` of `<WT>` as the start point,
makes the work directory with `review/` and `seats/` in it, and writes the start point and the level to `run.json`
there.

```bash
$FLOW/scripts/flow.sh begin <WT> --level <level> --source <source> [--issue <n> --parent <P>]
```

- `<level>` and `<source>` are `level` and `source` of the `level.sh show` JSON the entry holds (**The level**), so
  `run.json` and the agents' model and effort come from one read. Only a run from an issue passes `--issue` and `--parent`.
- **`ok`**: keep `start` as `<START>` and `workdir` as `<WORKDIR>`, written out in full in every command, the way
  `$FLOW` is. **`<START>` runs through the whole flow.** The integration review when the plan has more than one task,
  the report and the final message all start from `<START>`.
- **`stop`** with `not-ignored`: nothing was written under `work-reports/`. Stop as the entry's file says. Never add
  the path to `.gitignore`.
- Any other **`stop`**, or a non-zero exit: quote it and stop.
- **After a context summary**, `$FLOW/scripts/flow.sh status <WT>` prints `start`, `workdir`, `level`, `source`,
  `issue` and `parent` again. **The level** says how the agents come back, and when the run `status` names is an
  earlier one, so that **Begin** is still ahead.

## The run's files

The design, the plan, the detail of each task, the handover notes, the adaptations, the `check wanted:` lines and the
merge's design are files of `<WORKDIR>`, each with one writer.

| File | Writer | Written |
| --- | --- | --- |
| `<WORKDIR>/design.md` | standalone: the design session; from an issue: the main session | standalone: **Design** in `standalone.md`, and again when the answers come back; from an issue: right after `begin`, with `project.sh --design`, and after each redraw that goes on |
| `<WORKDIR>/plan.md` | the design session | with the plan, and again on every redraw of it |
| `<WORKDIR>/detail/task-<k>.md` | the design session | task 1 with the plan, task k of 2 or more when **Commit** in `loop.md` asks |
| `<WORKDIR>/notes.md` | the main session | from an issue and a sync right after `begin`; folded after each commit |
| `<WORKDIR>/adaptations.md` | the main session, from an issue | on each adaptation the implementation session reports |
| `<WORKDIR>/checks.md` | the main session | on each `check wanted:` line of a commit report |
| `<WORKDIR>/merge.md` | the main session | when **The merge task** starts |

**A prompt names a file and never carries its content**, with `<WORKDIR>` written out as an absolute path. A file that
does not exist means none: no notes yet, no adaptation, no `check wanted:` line. A file the main session adds to is
read with Read first and written whole with Write, the earlier lines kept, because Write overwrites.

## Rules for the whole flow

- **You do not write code.** The implementation session implements and the seats review. Code you write yourself never passes through a review.
- **A seat never changes the tree of `<WT>`.** It writes only its probes under `<WORKDIR>/seats/<seat>/` and its seat file, and executes only through `flow.sh run`. You write the judgement file of each round and no other file of the review, `flow.sh round` writes the round file, and the implementation session fixes what is found. The seats' worktrees stay beside `<WT>` until the cleanup removes them.
- **A round file is final once `flow.sh round` wrote it, and every other review file once its writer has linted it and reported.** Each round and each reply is a new file under `<WORKDIR>/review/`, in the shape `$FLOW/review-files.md` gives, and so is each evidence file. The writer of a seat file, a reply or an evidence file fixes it until `flow.sh lint` passes, and nobody edits either kind afterwards.
- **The design session lives for the whole flow, in the standalone flow and in a run from an issue. An implementation session and the seat sessions live for one task.** Inside a task they continue through `SendMessage`, because throwing the context away between rounds repeats arguments that were already settled. At the commit they are finished, and the next task starts new ones. The implementation session of a one-task plan also writes the work report.
- **Keep the reports from the sub-agents short.** The role instructions cap them. A report that pastes a diff or a log fills the one context that runs the whole flow, which is yours. When a long one arrives, say so, and ask for the gist next time.
- **One task is one commit, and a commit happens only after the review approves.** A commit mid-round drops the diff out of the working-tree view the review reads.
- **No branches, no history rewriting from the sub-sessions.** The main session owns `git checkout -b`, run in `<WT>`. `git rebase`, `git reset --hard` and `--amend` break the `START` comparison. The role instructions say the same.
- **Each Bash call runs one command with its values written out.** No shell variables, no `$(...)`, no chaining. A command's own redirect into a file, `> <path>`, is part of that one command, as **Commands** in `pj1-plan/between-skills.md` allows. Read the output whole. pj4-running drives this flow in runs that cannot answer a permission question, and auto mode's classifier may refuse a command no rule matches.
- **A URL in a message to the user stands between spaces.** Only a plain ASCII space or a line break touches either end: no bracket, punctuation or quote, and no particle or full-width punctuation in a language written without spaces. Write it bare, outside backticks and Markdown links. A terminal such as Ghostty ends a link at the first space, so anything touching the URL becomes part of the link and opens the wrong page (`$FLOW/../pj1-plan/between-skills.md`, **Issues in a report**).
- **Never write into `work-reports/` without checking it is ignored.** Unchecked, the report and the screenshots ride into the next commit. `worktree.sh create` (standalone, From a pull request) and `run.sh start` of pj4-running (a run from an issue, a sync) add it to `.git/info/exclude` before anything is written there, and `flow.sh begin` checks it again. Never edit `.gitignore`.
- **The standalone flow never touches `<MAIN>`, except for the lines `include.sh` adds to `<MAIN>/.worktreeinclude`.** Never switch, stash, commit or clean there. Everything runs in `<WT>`.
- **`worktree.sh` is for the standalone flow and From a pull request.** pj4-running's runs never call it. **`flow.sh` is called by every entry**, with the absolute `<WT>`, and `lint` with the absolute path of a review file.
- **Do not move anything under `<WORKDIR>` into version control.** The report, the screenshots and the diff are worth more untracked. Move them only when the user asks.
- Report a failure when it happens: a failing test, a design that falls apart. **Approved commits are already on the branch and the task in flight is uncommitted in the working tree.** Say both.
- Standalone, the main session pushes and opens the pull request. A run from an issue, the main session also pushes and opens the draft pull request. Nothing is merged here. pj4-running
  merges. From a pull request, the main session pushes the merge commit to the pull request's branch, as a
  fast-forward. A sync pushes nothing. pj4-running pushes the merge commit.
- **A merge of another branch into the run's branch happens only in The merge task**, and only after `worktree.sh
  sync` or pj4-running's `run.sh sync` found a conflict. A clean merge is left to GitHub.
