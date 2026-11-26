---
name: pj2-issues
description: Takes the project to split from a number given, the project this conversation is on when it can be split, or the only one it could split, and otherwise asks, offering the projects with no sub-issue whose waited-on projects are all merged or closed without a merge, with the lowest-numbered one as the recommended one. Refuses a project that waits on one not yet merged. Has a planner split the project into tasks against the code as it stands after those merges, and asks the split-level questions. Shows the split, a diff of any change to the parent, and any change to its blocked-by relationships for approval. Has one issue writer per task draw that task in parallel, then files the sub-issues with the blocked-by relationships inside the project, the run order in the parent's Order list, and the titles, and labels the parent doing. The second of four skills, after pj1-plan and before pj3-doctor and pj4-running. Use it only when the user names this skill or invokes /annetaan:pj2-issues, because it creates and edits issues, relationships and labels on GitHub.
---

# pj2-issues

The second of the four pj skills: it splits one project that `pj1-plan` filed into sub-issues, once every project it
waits on is merged.

You are the main session. **You do not design, and you do not write issue bodies.** A planner splits the project, one
issue writer per task draws that task, and you carry their output to the user and onto GitHub.

## Paths: `$ISSUES`

**`$ISSUES` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$ISSUES` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$ISSUES` finds
them nothing.
Collapse the `..` in a path to a sibling skill, so that the command text names `<skills>/pj1-plan/scripts/project.sh` and not
`<skills>/pj2-issues/../pj1-plan/scripts/project.sh`. A permission rule matches the text of the command, and the rules
`pj-auto` grants name the collapsed path. This holds in the prompts for sub-agents too.

**Read `$ISSUES/../pj1-plan/format.md`, `$ISSUES/../pj1-plan/state.md` and `$ISSUES/../pj1-plan/between-skills.md`
before anything else.** `pj1-plan/format.md` is the only description of the parent issue, the run order, the sub-issue body,
the decisions and the relationships. `pj1-plan/state.md` is how `project.sh` reads a project. `pj1-plan/between-skills.md` holds the
labels, the titles and picking the project. Everything below refers to them.

This skill uses these files:

- the script `$ISSUES/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the script `$ISSUES/../pj1-plan/scripts/issue.sh`, written `issue.sh` below, the one writer to GitHub
  (`pj1-plan/between-skills.md`, **Writing to GitHub**)
- the script `$ISSUES/../workflow/scripts/level.sh`, written `level.sh` below
- the planner's role file `$ISSUES/roles/split.md`
- the issue writer's role file `$ISSUES/roles/issue.md`
- the judgement rules `$ISSUES/../workflow/judgement.md`, which the planner and the writers read (written
  `<skills>/workflow/judgement.md` in their prompts, with `<skills>` the directory that holds `$ISSUES`, as the real
  absolute path)

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `pj1-plan/format.md`
says.

## Before you start

This skill creates and edits issues, relationships and labels on GitHub. **Start it only when the user names it or invokes
`/annetaan:pj2-issues`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.99.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
git branch --show-current
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.99.0, `gh` not logged in, or
  issues turned off. Say which one and stop.
- Keep the current branch's name for phase 1. A detached HEAD prints no current branch.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it. It creates no branch
  either: `pj4-running` creates the project's base branch (`pj1-plan/between-skills.md`, **The base branch**).

## The project

1. Pick it as `pj1-plan/between-skills.md` says under **Picking the project**. The project picked is `<P>`. Print
   `project #<P>` once, as **Picking the project** says. Run `mktemp -d` once for the whole run. `$TMP`
   below is the directory it printed. A shell variable does not outlive one command, so write the path in full each
   time. Run `git status --porcelain` once and keep its output. The checks in phases 1 and 3 compare against it.
2. Read the project.

   ```bash
   $ISSUES/../pj1-plan/scripts/project.sh <P>
   ```

   - When `project.sh` fails, quote its message and stop.
   - **When `issues` is not empty**, the project is already split. Say so, give `/annetaan:pj3-doctor` as the next
     step, and stop.
   - **When `parent.startable` is false**, list the entries of `parent.waitsOn` that are not `merged`. When every one
     of them is `CLOSED`, closed without a merge, ask whether to drop them.

     ```
     AskUserQuestion:
       Remove these relationships and go on?
         - Remove #<P> blocked by #<Q>, #<R>
         - Stop
     ```

     On "Remove", take each one off and read the project again. Go on once `parent.startable` is true. Keep the
     numbers removed here for the planner's prompt in phase 1.

     ```bash
     $ISSUES/../pj1-plan/scripts/issue.sh relate <P> remove <Q>
     $ISSUES/../pj1-plan/scripts/project.sh <P>
     ```

     Otherwise stop, and say that those projects have to be merged into `<from>` first.
3. Read the level. The repository's level picks the model and the effort of the planner and the issue writers. `<root>` is what
   `git rev-parse --show-toplevel` printed.

   ```bash
   $ISSUES/../workflow/scripts/level.sh show <root>
   ```

   Keep the JSON, and print `level <level> (<source>)` once and `warning` on a line of its own when it is set, as
   **The level** in `workflow/SKILL.md` says. A non-zero exit stops the skill: quote its message.

## Phase 1: the split

The planner and the writers draw against `<from>`, `parent.from` in the JSON, as it stands on origin, because the base
branch is cut from it. Fetch it once:

```bash
git fetch --quiet origin "+refs/heads/<from>:refs/remotes/origin/<from>"
git status --porcelain
git rev-parse HEAD origin/<from>
```

When `<from>` is the branch checked out here, the tree is clean and both SHAs match, the sub-agents read the working
tree. Otherwise their prompt says to read the code at `origin/<from>`.

**The roadmap task**, only when `parent.roadmap` in the `project.sh <P>` JSON is not null. The parent carries the
roadmap entry `parent.roadmap.entry` of `parent.roadmap.path`, and the split ends with the roadmap task (`pj1-plan/format.md`,
**The roadmap task**). Read the roadmap as it stands on `<from>`:

```bash
$ISSUES/../pj1-plan/scripts/project.sh --roadmap origin/<from>
```

- `ok` is true, its `path` equals `parent.roadmap.path`, and an entry has the heading `parent.roadmap.entry`: the
  split ends with the roadmap task.
- The only reason is `no-file`, or `ok` is true and no entry has that heading or the `path` differs from
  `parent.roadmap.path`: there is no roadmap task. Keep one line saying why, for the planner and for phase 2, such as
  that the roadmap moved to `<path>`.
- Anything else: stop, name the reason codes, and point the user to `/annetaan:pj-roadmap`.

```
Agent(subagent_type: "annetaan:pj-planner", description: "split #<P>",
      model: "<agents.pj-planner.model>", effort: "<agents.pj-planner.effort>",
      prompt: "Read $ISSUES/roles/split.md first and follow the role it describes. The project format is in $ISSUES/../pj1-plan/format.md. The judgement rules are in <skills>/workflow/judgement.md.\n\nParent: #<P>\n\nproject.sh <P>:\n<the JSON>\n\nRemoved waits: <#Q, #R | none>\n\nRoadmap task: <yes, the entry \"<heading>\" of <path> | none, <why> | none>\n\nRead the code: <the working tree | at origin/<from>>\n\nScratch: $TMP/scratch/split")
```

`Removed waits:` names the projects whose edges **The project** step 2 removed in this run. `Roadmap task:` carries
the first form, with `parent.roadmap.path` as `<path>`, when the split ends with the roadmap task, the second with the line kept above, and `none` for a parent
with no `Roadmap:` line.

`annetaan:pj-planner` ships with this plugin and takes its model and effort from the level, `agents.pj-planner` of the `level.sh` JSON. It is told never to change the repository and to write only under its `Scratch:` directory, by instruction.
**When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
spawn it again with the same prompt, `model: "opus"` and the same `effort`.

When the split comes back:

- **Run `git status --porcelain` again.** When it differs from the output kept in **The project**, stop and name the
  paths. A planner that changed the repository broke its role.
- **If feasibility is "no"**, hand that to the user and stop. **If it is "conditional"** with `#<P> blocked by #<Q>`,
  go to phase 2 and ask the question for that case.
- **An open question with no `Only you know:` line** goes back with `SendMessage`, to be decided and recorded under
  `### Model decisions` of the parent (`workflow/judgement.md`, **What a human is asked**).
- **Ask the open questions now**, with `AskUserQuestion`, **four to a call**, in as many calls as it takes. These are
  the split-level questions, the ones that change the split or the parent's `## Design`. Send the answers back with
  `SendMessage`. The revised report carries each answer as a settled decision in the parent's `## Decisions`.

**Keep the planner alive until phase 4 ends.** You come back to it when an issue writer says the split does not hold.

## Phase 2: approval

Present the split, then ask for approval. **Nothing has been written to GitHub yet**, and this is the last point where
changing the split costs nothing.

Read the parent's `updatedAt` first and keep it as `<since>`, whether or not the planner changed the body. A parent
change drawn later in this run, in phase 3, is written against this value too.

```bash
gh issue view <P> --json updatedAt --jq .updatedAt
```

Then write the parent change to files, unless the planner returned the body unchanged. Write the planner's sections,
from `## Goal` on, to `$TMP/<P>-sections.md`, save the body as it reads on GitHub to `$TMP/<P>.before.md`, and splice
the sections into it (`pj1-plan/state.md`, `--parent-body`).

```bash
gh issue view <P> --json body --jq .body > "$TMP/<P>.before.md"
$ISSUES/../pj1-plan/scripts/project.sh <P> --parent-body "$TMP/<P>-sections.md" > "$TMP/<P>.md"
diff -u "$TMP/<P>.before.md" "$TMP/<P>.md"
```

A planner that returned the body unchanged leaves no file, and the change reads "unchanged".

Show:

- `#<P> <title>` and its goal, in a few lines
- the split-level decisions the user settled in phase 1, one line each
- each task as `T<k> <title>  (after T2, T5)`, followed by the number of forks the planner already sees in it that are for a human, and the number the writer settles, counted apart (the filed title's `(0/<m>)` counts only the first)
- the change to the parent body as the `diff -u` above, or "unchanged"
- the parent's model decisions that the split added or changed, one line each
- the changes to the parent's edges, each with the planner's reason, or "none"
- each task's one line: what a reviewer can judge in it without the other tasks (**Where to split** in `workflow/judgement.md`)
- one line on the roadmap: the last task removes the roadmap entry `<heading>` from `<path>`, or the line kept in phase 1
  saying why there is no roadmap task
- one line saying the parent gets the `doing` label once the sub-issues are filed
- one line saying no branch is created here, and `pj4-running` creates `pj/<P>` on its first start on the project

```
AskUserQuestion:
  File these sub-issues on #<P>?
    - File them - N sub-issues
    - Change something first
```

"Change something first" goes to the planner with `SendMessage`, and the revised split comes back here. Ask again
then.

**Before you show anything, when the prompt said yes**, check that the last task names `parent.roadmap.path` as its only
path and waits on every other task, and that no other task names that path. Otherwise send the split back to the
planner with `SendMessage`.

**Before you show anything, read the project that each `add` line and a `conditional` line names.** Phase 4 adds
only the edges checked here.

```bash
$ISSUES/../pj1-plan/scripts/project.sh <Q>
```

When it fails, for instance with `has no Base: line`, `#<Q>` is no project and gets no edge (`pj1-plan/format.md`,
**Relationships**). `parent.merged` in its output says whether `#<Q>` is merged. A `#<Q>` whose `parent.state` is
`CLOSED` and that is not `merged` was closed without a merge. It never merges, so it gets no edge either. Send the
line back to the planner with `SendMessage` when `#<Q>` is no project, when it was closed without a merge, or when it
is an `add` line and `#<Q>` is not merged. The work becomes part of this split, or a request of its own.

**When the planner returned `conditional`** with `#<P> blocked by #<Q>`, `#<Q>` is a project, `parent.state` is
`OPEN` and `parent.merged` is false for it, show the planner's reason and ask this instead. It is allowed only while `parent.baseExists` of `<P>` is
false.

```
AskUserQuestion:
  #<P> needs #<Q> first. Add the relationship?
    - Add #<P> blocked by #<Q> and stop
    - Stop without writing
```

On "Add", add the edge. `issue.sh relate` checks the order itself.

```bash
$ISSUES/../pj1-plan/scripts/issue.sh relate <P> add <Q>
```

A `cycle` stop, or a failure, has taken the edge back off: say so. Report what was done and stop. Nothing else is
filed.

## Phase 3: the issue writers

**Start one issue writer per task, all in one message**, so they run at the same time. They read the code and write,
and none of them touches GitHub.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "issue T<k>",
      model: "<agents.pj-issue-writer.model>", effort: "<agents.pj-issue-writer.effort>",
      prompt: "Read $ISSUES/roles/issue.md first and follow the role it describes. The project format is in $ISSUES/../pj1-plan/format.md. Lint a body with $ISSUES/../pj1-plan/scripts/project.sh. The judgement rules are in <skills>/workflow/judgement.md.\n\nMode: draft\n\nParent: #<P>\nWaits on: <#Q, #R | none>\n\nThe parent body:\n<the approved body>\n\nThe split:\n<the full report from the planner>\n\nRead the code: <the working tree | at origin/<from>>\n\nYour task: T<k>, \"<title>\".\n\nScratch: $TMP/scratch/T<k>")
```

`Waits on:` names the parents in `parent.waitsOn`. `annetaan:pj-issue-writer` ships with this plugin and takes its model and
effort from the level, `agents.pj-issue-writer` of the `level.sh` JSON. It is told never to change the repository and to write only under its `Scratch:` directory, by
instruction.

Each writer sends back a title and a body in the shape `pj1-plan/format.md` gives a sub-issue, or a statement that the split
or the parent does not hold.

**When a writer says the split does not hold**, send what it found to the planner with `SendMessage` and have it
redraw the split. Rerun the writers whose tasks changed. Show the user the new split and ask the phase 2 question
again, because nothing has been filed yet and a new split is a new plan.

**When a writer says the parent does not hold**, a redraw of the parent changes what every task is drawn against.

1. Wait until every writer has returned, so that one redraw covers them all.
2. Send what each such writer found to the planner with `SendMessage`.
3. Ask the open questions the redraw carries, as phase 1 does, four to a call, and send the answers back.
4. Write the revised sections to `$TMP/<P>-sections.md`, save the body as it reads on GitHub to
   `$TMP/<P>.before.md`, and splice, with the commands of phase 2 but no new read of `updatedAt`. `<since>` stays the
   one phase 2 read, also when phase 2 found the parent unchanged, so that a human's edit since then still stops the
   write in phase 4.
5. Rerun the writers of the task ids the planner names.
6. Show the new split and the `diff -u` of the parent, and ask the phase 2 question again, because nothing has been
   filed yet and a revised parent is a new plan.

**Check every body before it goes out.** Write each one to a file as it comes back, and lint it.

```bash
$ISSUES/../pj1-plan/scripts/project.sh --lint "$TMP/T<k>.md"
```

Accept a body only when the lint reports no reason, or `decisions-open` alone. Then read it for what the lint cannot
see: no line number in a form the lint does not catch, such as `line 42`, no checkbox outside
`## Decisions`, no dependencies written into the body, lines under every option saying what it changes, and a
`### Shared state` list in a body whose task writes shared state
(**Assumptions** in `workflow/judgement.md`). Send a
body that fails back to its writer with `SendMessage` and say what to fix. Write the fixed body over the same file.
Phase 4 sends a `lint` stop of `issue.sh sub` back the same way.

Once every writer has returned, run `git status --porcelain` once more. When it differs from the output kept in **The
project**, stop and name the paths. Then read the bodies against each other. Two or more bodies that carry the same workaround
(the same caveat, toast, user-facing note or special case for one state) for one consequence of the parent's design
are the parent not holding, even though no writer said so. Treat it as above, naming the issues and the passages to
the planner. You only route this, and the planner decides the fix.

## Phase 4: filing

The sub-issue bodies sit in `$TMP` from phase 3, and the parent body in `$TMP/<P>.md` from phase 2. The stops of
`issue.sh` are in `pj1-plan/between-skills.md` under **Writing to GitHub**.

1. **The parent body**, only when it changed. `--since` is the `<since>` phase 2 read.

   ```bash
   $ISSUES/../pj1-plan/scripts/issue.sh edit <P> --since <since> --body "$TMP/<P>.md"
   ```

   - A `moved` stop: someone changed the parent since phase 2. Send `$TMP/<P>.md.github`, the stop's `github`, to the
     planner with `SendMessage` and have it merge the change into its sections. Write `$TMP/<P>-sections.md` again,
     splice again with `--parent-body`, and run the edit again with the `updatedAt` the stop printed.
   - A `lint` stop: send its `reasons` to the planner, which returns sections that pass. Splice again and run the edit
     again with the same `--since`.

2. **The parent's edges**, one call each. An edge to add names a project that phase 2 read as merged with
   `project.sh <Q>`. Each `relate` checks the order itself. Run `project.sh <P>` after the edges, and stop when
   `parent.startable` is no longer true.

   ```bash
   $ISSUES/../pj1-plan/scripts/issue.sh relate <P> add <Q>
   $ISSUES/../pj1-plan/scripts/issue.sh relate <P> remove <Q>
   $ISSUES/../pj1-plan/scripts/project.sh <P>
   ```

3. **The sub-issues, in dependency order**, so that every `--blocked-by` names an issue that already exists. Leave
   out `--blocked-by` when the task waits on nothing. Keep the mapping from `T<k>` to the `number` it prints as you go,
   because the next `--blocked-by` needs it. The roadmap task is filed last, with `--blocked-by` naming every other
   sub-issue.

   ```bash
   $ISSUES/../pj1-plan/scripts/issue.sh sub <P> --title "<title>" --blocked-by <n>,<m> --body "$TMP/T<k>.md"
   ```

   A `lint` stop filed nothing: send its `reasons` to the writer of that task, as phase 3 does with its own lint, and
   run the call again with the body that comes back.

   **A `cycle` stop**, from `sub` or from `relate` in step 2, means the split's order has a cycle that phase 2 did not
   see. The edge is off again, and an issue `sub` filed stays, with the `number` the stop carries. Report the edge as a
   split error, say what was written, and stop.

4. **The label.** `issue.sh` makes sure `doing` exists.

   ```bash
   $ISSUES/../pj1-plan/scripts/issue.sh label <P> --add doing
   ```

5. **The run order.** Read the project, then write `## Order` with the parent's `updatedAt` from that read.
   `issue.sh order` writes the body `--order-body` prints: `list` under `## Order`, one line `1. #<n>` per number, and
   when there is no `## Order` yet, the list between the `Base:` line and `## Goal` (`pj1-plan/format.md`, **The run
   order**).

   ```bash
   $ISSUES/../pj1-plan/scripts/project.sh <P>
   $ISSUES/../pj1-plan/scripts/issue.sh order <P> --since <parent.updatedAt>
   ```

   A `moved` stop: read `project.sh <P>` again and run `order` again once, with the new `parent.updatedAt`. A second
   one is reported. A `cycle` stop is reported as a split error and stops the run, as in step 3.

6. **The titles** (`pj1-plan/between-skills.md`, **Titles**).

   ```bash
   $ISSUES/../pj1-plan/scripts/issue.sh titles <P>
   ```

No issue gets `ready` here. Only `pj3-doctor` adds it, after it has reviewed the whole project.

**When a command fails halfway**, or `issue.sh` stops on a reason these steps do not name, stop and tell the user what was filed and what was not, with the numbers, and
whether the parent body, its edges, its `doing` label, its `## Order` and the titles were written. Never retry the whole run, or the
issues double. A missing count, a missing `doing` or a missing `## Order` is fixed by the next `pj3-doctor` run.

Then check the result against the split the user approved:

```bash
$ISSUES/../pj1-plan/scripts/project.sh <P>
$ISSUES/../pj1-plan/scripts/project.sh <P> --order
```

The fields are in `pj1-plan/state.md` under **Reading a project**. Every task of the split is there, and its `blockedBy`
matches the split, with `<P>` as the `parent` of every blocker. The decision counts and the lint match the bodies.
Every sub-issue's `title` equals its `wantedTitle`. `parent.orderCheck.ok` is true with `missing` empty, and
`parent.baseExists` is false. `parent.labels` holds `doing`. `--order` finds no cycle. When the split ended with the roadmap task,
`parent.roadmap.task` is its number and `parent.roadmap.missing` is empty. When it left the task out,
`parent.roadmap.tasks` is empty. Report anything that does not match.

## Report to the user

- the parent issue URL, and that it carries the `doing` label
- one line per sub-issue: its URL, title, the issues it waits on as `#<n>`, the open decisions by count and the model
  decisions by count
- one line saying that a comment on an issue overturns a model decision at the next `pj3-doctor` run, and that on an
  issue `pj3-doctor` has since labelled `ready` the user also takes `ready` off, because `pj4-running` never reads
  comments
- the changes to the parent body and to its edges, or that there were none

Then the next steps, in this order:

1. `/annetaan:pj3-doctor`, right away. It reviews the whole project against the code and against each issue, has the
   writers fix what does not hold, and labels `ready` what is clear.
2. The user ticks the open decisions on GitHub. Each option says what it changes, so the body is all they need.
3. `/annetaan:pj3-doctor` again, after ticking.
4. `/annetaan:pj4-running`. It creates the base branch on its first start, works down the parent's `## Order`, and
   stops at the first issue that is not workable.

## Rules

- **You do not design and you do not write issue bodies.** The planner and the issue writers do. You keep the
  lines above `## Goal` as they are and write `## Order`, and add nothing else. Titles come from the writers and from
  `wantedTitle` only.
- **Nothing reaches GitHub before the phase 2 approval.**
- **You create no branch.** `pj4-running` creates the base branch (`pj1-plan/between-skills.md`, **The base branch**).
- **Only you write to GitHub, and every write goes through `issue.sh`.** The sub-agents only read it, so the order and
  the numbers stay in one place.
- **Sub-issue edges stay inside the project.** Never between a parent and a sub-issue, and never between sub-issues
  of different projects.
- **A parent edge changes only with the user's approval, and only while `parent.baseExists` is false** (`pj1-plan/format.md`,
  **Projects**).
- **Every body edit carries `--since`**, the `updatedAt` of the read the body was drawn against.
- After a context summary, take `<P>` again from the last `project #<P>` line, run `level.sh show <root>` again, and
  rebuild where the run stood from `project.sh <P>`. A planner or a writer whose handle is gone is started again.
