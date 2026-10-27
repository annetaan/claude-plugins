---
name: pj2-issues
description: Asks which project to split into issues, offering the projects with no sub-issue whose waited-on projects are all merged or closed without a merge, with the lowest-numbered one, or a number given, as the recommended one. Refuses a project that waits on one not yet merged. Has a planner split the project into tasks against the code as it stands after those merges, and asks the split-level questions. Shows the split, a diff of any change to the parent, and any change to its blocked-by relationships for approval. Has one issue writer per task draw that task in parallel, then files the sub-issues with the blocked-by relationships inside the project, the run order in the parent's Order list, and the titles. The second of four skills, after pj1-plan and before pj3-doctor and pj4-running. Use it only when the user names this skill or invokes /annetaan:pj2-issues, because it creates and edits issues and relationships on GitHub.
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

**Read `$ISSUES/../pj1-plan/format.md`, `$ISSUES/../pj1-plan/state.md` and `$ISSUES/../pj1-plan/between-skills.md`
before anything else.** `format.md` is the only description of the parent issue, the run order, the sub-issue body,
the decisions and the relationships. `state.md` is how `project.sh` reads a project. `between-skills.md` holds the
labels, the titles and picking the project. Everything below refers to them.

This skill uses these files:

- the script `$ISSUES/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the planner's role file `$ISSUES/roles/split.md`
- the issue writer's role file `$ISSUES/roles/issue.md`

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `format.md`
says.

## Before you start

This skill creates and edits issues and relationships on GitHub. **Start it only when the user names it or invokes
`/annetaan:pj2-issues`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
git branch --show-current
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.94.0, `gh` not logged in, or
  issues turned off. Say which one and stop.
- Keep the current branch's name for phase 1. A detached HEAD prints no current branch.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it. It creates no branch
  either: `pj4-running` creates the project's base branch (`between-skills.md`, **The base branch**).

## The project

1. Pick it as `between-skills.md` says under **Picking the project**. The project picked is `<P>`. Print
   `project #<P>` once, so that a context summary can find it again. Run `mktemp -d` once for the whole run. `$TMP`
   below is the directory it printed. A shell variable does not outlive one command, so write the path in full each
   time.
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
     gh issue edit <P> --remove-blocked-by <Q>
     $ISSUES/../pj1-plan/scripts/project.sh <P>
     ```

     Otherwise stop, and say that those projects have to be merged into `<from>` first.

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

```
Agent(subagent_type: "annetaan:pj-planner", description: "split #<P>",
      prompt: "Read $ISSUES/roles/split.md first and follow the role it describes. The project format is in $ISSUES/../pj1-plan/format.md.\n\nParent: #<P>\n\nproject.sh <P>:\n<the JSON>\n\nRemoved waits: <#Q, #R | none>\n\nRead the code: <the working tree | at origin/<from>>")
```

`Removed waits:` names the projects whose edges **The project** step 2 removed in this run.

`annetaan:pj-planner` ships with this plugin and is pinned to opus at high effort with code changes disabled.

When the split comes back:

- **If feasibility is "no"**, hand that to the user and stop. **If it is "conditional"** with `#<P> blocked by #<Q>`,
  go to phase 2 and ask the question for that case.
- **Ask the open questions now**, with `AskUserQuestion`, **four to a call**, in as many calls as it takes. These are
  the split-level questions, the ones that change the split or the parent's `## Design`. Send the answers back with
  `SendMessage`. The revised report carries each answer as a settled decision in the parent's `## Decisions`.

**Keep the planner alive until phase 4 ends.** You come back to it when an issue writer says the split does not hold.

## Phase 2: approval

Present the split, then ask for approval. **Nothing has been written to GitHub yet**, and this is the last point where
changing the split costs nothing.

Write the parent change to files first. Save the body as it reads on GitHub to `$TMP/<P>.before.md`. Write
`$TMP/<P>.md` as the `Base:` line exactly as it reads on GitHub, a blank line, then the planner's body. When the
planner returned the body unchanged, copy the one from GitHub.

```bash
gh issue view <P> --json body --jq .body > "$TMP/<P>.before.md"
diff -u "$TMP/<P>.before.md" "$TMP/<P>.md"
```

Show:

- `#<P> <title>` and its goal, in a few lines
- the split-level decisions the user settled in phase 1, one line each
- each task as `T<k> <title>  (after T2, T5)`, followed by the number of decisions the planner already sees in it
- the change to the parent body as the `diff -u` above, or "unchanged"
- the changes to the parent's edges, each with the planner's reason, or "none"
- one line saying every task is cut to 8 files at most, tests included. When the split is past 10 tasks, say that it
  stays one project (`format.md`, **Projects**)
- one line saying no branch is created here, and `pj4-running` creates `pj/<P>` on its first start on the project

```
AskUserQuestion:
  File these sub-issues on #<P>?
    - File them - N sub-issues
    - Change something first
```

"Change something first" goes to the planner with `SendMessage`, and the revised split comes back here. Ask again
then.

**Before you show anything, read the project that each `add` line and a `conditional` line names.** Phase 4 adds
only the edges checked here.

```bash
$ISSUES/../pj1-plan/scripts/project.sh <Q>
```

When it fails, for instance with `has no Base: line`, `#<Q>` is no project and gets no edge (`format.md`,
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

On "Add", re-read the parent's `updatedAt`, add the edge, and check it.

```bash
gh issue view <P> --json updatedAt
gh issue edit <P> --add-blocked-by <Q>
$ISSUES/../pj1-plan/scripts/project.sh <P> --order
```

When `--order` fails, on a cycle or anything else, remove the edge again and say so. Report what was done and stop.
Nothing else is filed.

## Phase 3: the issue writers

**Start one issue writer per task, all in one message**, so they run at the same time. They read the code and write,
and none of them touches GitHub.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "issue T<k>",
      prompt: "Read $ISSUES/roles/issue.md first and follow the role it describes. The project format is in $ISSUES/../pj1-plan/format.md. Lint a body with $ISSUES/../pj1-plan/scripts/project.sh.\n\nMode: draft\n\nParent: #<P>\nWaits on: <#Q, #R | none>\n\nThe parent body:\n<the approved body>\n\nThe split:\n<the full report from the planner>\n\nRead the code: <the working tree | at origin/<from>>\n\nYour task: T<k>, \"<title>\".")
```

`Waits on:` names the parents in `parent.waitsOn`. `annetaan:pj-issue-writer` ships with this plugin and is pinned to
opus at high effort with code changes disabled.

Each writer sends back a title and a body in the shape `format.md` gives a sub-issue, or a statement that the split
does not hold.

**When a writer says the split does not hold**, send what it found to the planner with `SendMessage` and have it
redraw the split. Rerun the writers whose tasks changed. Show the user the new split and ask the phase 2 question
again, because nothing has been filed yet and a new split is a new plan.

**Check every body before it goes out.** Write each one to a file as it comes back, and lint it.

```bash
$ISSUES/../pj1-plan/scripts/project.sh --lint "$TMP/T<k>.md"
```

Accept a body only when the lint reports no reason, or `decisions-open` alone. Then read it for what the lint cannot
see: a file list of 8 entries at most (`format.md`, **The file list**), no line numbers, no checkbox outside
`## Decisions`, no dependencies written into the body, and lines under every option saying what it changes. Send a
body that fails back to its writer with `SendMessage` and say what to fix. Write the fixed body over the same file.

## Phase 4: filing

The sub-issue bodies sit in `$TMP` from phase 3, and the parent body in `$TMP/<P>.md` from phase 2.

1. **Read the parent again.** When its `updatedAt` or its body moved since phase 2, send the change to the planner
   and have it merge the change into its body. Write `$TMP/<P>.md` again.

   ```bash
   gh issue view <P> --json updatedAt,body
   ```

2. **The parent body**, only when it changed.

   ```bash
   gh issue edit <P> --body-file "$TMP/<P>.md"
   ```

3. **The parent's edges**, one at a time, then check the order. An edge to add names a project that phase 2 read
   as merged with `project.sh <Q>`. When `--order` fails, on a cycle or anything else, undo the last edge and stop.
   Run `project.sh <P>` after the edges, and stop when `parent.startable` is no longer true.

   ```bash
   gh issue edit <P> --add-blocked-by <Q>
   gh issue edit <P> --remove-blocked-by <Q>
   $ISSUES/../pj1-plan/scripts/project.sh <P> --order
   ```

4. **The sub-issues, in dependency order**, so that every `--blocked-by` names an issue that already exists. Leave
   out `--blocked-by` when the task waits on nothing. Keep the mapping from `T<k>` to the issue number as you go,
   because the next `--blocked-by` needs it.

   ```bash
   gh issue create --parent <P> --blocked-by <n>,<m> --title "<title>" --body-file "$TMP/T<k>.md"
   ```

5. **The run order.** Write `list` under `## Order`, one line `1. #<n>` per number, between the `Base:` line and
   `## Goal` (`format.md`, **The run order**). Re-read the parent's `updatedAt` right before the edit.

   ```bash
   $ISSUES/../pj1-plan/scripts/project.sh <P> --order
   gh issue view <P> --json updatedAt,body
   gh issue edit <P> --body-file "$TMP/<P>-order.md"
   ```

6. **The titles.** Run the sync in `between-skills.md` under **Titles** for `<P>`.

   ```bash
   $ISSUES/../pj1-plan/scripts/project.sh <P>
   gh issue edit <k> --title "<wantedTitle>"
   ```

No issue gets `ready` here. Only `pj3-doctor` adds it, after it has reviewed the whole project.

**When a command fails halfway**, stop and tell the user what was filed and what was not, with the numbers, and
whether the parent body, its edges, its `## Order` and the titles were written. Never retry the whole run, or the
issues double. A missing count or a missing `## Order` is fixed by the next `pj3-doctor` run.

Then check the result against the split the user approved:

```bash
$ISSUES/../pj1-plan/scripts/project.sh <P>
$ISSUES/../pj1-plan/scripts/project.sh <P> --order
```

The fields are in `state.md` under **Reading a project**. Every task of the split is there, and its `blockedBy`
matches the split, with `<P>` as the `parent` of every blocker. The decision counts and the lint match the bodies.
Every sub-issue's `title` equals its `wantedTitle`. `parent.orderCheck.ok` is true with `missing` empty, and
`parent.baseExists` is false. `--order` finds no cycle. Report anything that does not match.

## Report to the user

- the parent issue URL
- one line per sub-issue: number, title, the issues it waits on as `#<n>`, and the open decisions by count
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
  `Base:` line as it is and write `## Order`, and add nothing else. Titles come from the writers and from
  `wantedTitle` only.
- **Nothing reaches GitHub before the phase 2 approval.**
- **You create no branch.** `pj4-running` creates the base branch (`between-skills.md`, **The base branch**).
- **Only you write to GitHub.** The sub-agents only read it, so the order and the numbers stay in one place.
- **Sub-issue edges stay inside the project.** Never between a parent and a sub-issue, and never between sub-issues
  of different projects.
- **A parent edge changes only with the user's approval, and only while `parent.baseExists` is false** (`format.md`,
  **Projects**).
- **Always pass a body with `--body-file`.**
- **Re-read `updatedAt` before every edit.**
- After a context summary, take `<P>` again from the `project #<P>` line, and rebuild where the run stood from
  `project.sh <P>`. A planner or a writer whose handle is gone is started again.
