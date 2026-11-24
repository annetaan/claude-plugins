---
name: pj3-doctor
description: Takes the project from a number given, a sub-issue's number naming its parent, the project this conversation is on, or the only project with sub-issues, and otherwise asks which project to work on, then reviews the whole project against the boxes the user ticked on GitHub, against the code and against each issue in it. Has one issue writer per issue redraw what no longer holds, draws the stubs, resolves the blockers, rewrites the run order in the parent's Order list, and labels the issues ready. Asks the user no task decision, because the user ticks those on GitHub. Asks only about a split, two boxes ticked in one decision, and its changes before they are written. Run it again after ticking. The third of four skills, after pj1-plan and pj2-issues and before pj4-running. Use it only when the user names this skill or invokes /annetaan:pj3-doctor, because it edits, files and closes issues and changes labels on GitHub.
---

# pj3-doctor

The third of the four pj skills: it reviews a filed project after the user has ticked its boxes, fixes what no
longer holds, rewrites the run order, and labels the issues `ready`.

You are the main session. **You decide nothing, and you never write an issue body.** The user decides by ticking
boxes on GitHub, the reviewer reads the whole project, an issue writer reads the code and redraws one issue, and you
carry their output to the user and onto GitHub.

## Paths: `$DOCTOR`

**`$DOCTOR` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$DOCTOR` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$DOCTOR` finds
them nothing.
Collapse the `..` in a path to a sibling skill, so that the command text names `<skills>/pj1-plan/scripts/project.sh` and not
`<skills>/pj3-doctor/../pj1-plan/scripts/project.sh`. A permission rule matches the text of the command, and the rules
`pj-auto` grants name the collapsed path. This holds in the prompts for sub-agents too.

**Read `$DOCTOR/../pj1-plan/format.md`, `$DOCTOR/../pj1-plan/state.md` and `$DOCTOR/../pj1-plan/between-skills.md`
before anything else.** `pj1-plan/format.md` is the only description of the parent issue, the run order, the sub-issue body,
the decisions and the relationships. `pj1-plan/state.md` is how `project.sh` reads a project and when an issue is ready.
`pj1-plan/between-skills.md` holds the labels, the blockers, the comments, picking the project and the format-only fixes.
Everything below refers to them.

This skill uses these files:

- the script `$DOCTOR/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the script `$DOCTOR/../pj1-plan/scripts/issue.sh`, written `issue.sh` below, the one writer to GitHub
  (`pj1-plan/between-skills.md`, **Writing to GitHub**)
- the script `$DOCTOR/../workflow/scripts/level.sh`, written `level.sh` below
- the reviewer's role file `$DOCTOR/roles/review.md`
- the issue writer's role file `$DOCTOR/../pj2-issues/roles/issue.md`
- the judgement rules `$DOCTOR/../workflow/judgement.md`, which the reviewer and the writers read (written
  `<skills>/workflow/judgement.md` in their prompts, with `<skills>` the directory that holds `$DOCTOR`, as the real
  absolute path)

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `pj1-plan/format.md`
says.

## Before you start

This skill edits, files and closes issues and changes labels on GitHub. **Start it only when the user names it or
invokes `/annetaan:pj3-doctor`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.94.0, `gh` not logged in, or
  issues turned off. Say which one and stop. The clone is needed because `project.sh --check` runs inside one.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it.

**The project.** Pick it as `pj1-plan/between-skills.md` says under **Picking the project**. The project picked is `<P>`. In an unattended run, only rule 1 of **Picking the project** applies (`pj1-plan/between-skills.md`, **Unattended runs**). Print
`project #<P>` once, with ` unattended` after it in an unattended run, as **Picking the project** says.

When the args carry `tmp=<dir>`, `$TMP` below is that directory. Otherwise run `mktemp -d` once and use the
directory it printed. Print `tmp <dir>` once, so that a context summary can find it again. A shell variable does
not outlive one command, so write the path in full each time.

**The level.** The repository's level picks the model and the effort of the project reviewer and the issue writers. `<root>` is what `git
rev-parse --show-toplevel` printed, and `<level>` is the value of `level=<level>` in the args, left out when the args
carry none.

```bash
$DOCTOR/../workflow/scripts/level.sh show <root> [<level>]
```

Keep the JSON, and print `level <level> (<source>)` once and `warning` on a line of its own when it is set, as
**The level** in `workflow/SKILL.md` says. A non-zero exit, such as `level=<level>` other than `standard` or `high`, stops
the skill: quote its message.

## Phase 1: the diagnosis

1. Read the project.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P>
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --order
   ```

   Read `project.sh`'s output whole, as `pj1-plan/between-skills.md` says under **Commands**.

   When `project.sh` fails, for instance with `has no Base: line` or `is blocked by #<X>, which is no project`, quote
   its message and stop. On `is blocked by #<X>, which is no project`, a human has to remove that relationship on
   GitHub. **When `--order`
   fails on a cycle**, within the project or between projects, show the user the cycle it names and stop. Nothing
   can be ordered until a human removes an edge.
2. **Check every open sub-issue** whose `pr` is not merged, in one call with every such number. An open issue whose
   pull request merged is waiting for `pj4-running` to close it. Leave it alone. When no number is left, make no call.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --check <k1> <k2> ...
   ```

   It prints one JSON object per line, in that order.

3. **Start the reviewer.**

   ```
   Agent(subagent_type: "annetaan:pj-reviewer", description: "review #<P>",
         model: "<agents.pj-reviewer.model>", effort: "<agents.pj-reviewer.effort>",
         prompt: "Read $DOCTOR/roles/review.md first and follow the role it describes. The project format is in $DOCTOR/../pj1-plan/format.md. The state of a project is in $DOCTOR/../pj1-plan/state.md. The agreements between the skills are in $DOCTOR/../pj1-plan/between-skills.md. The judgement rules are in <skills>/workflow/judgement.md.\n\nParent: #<P>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check, per issue:\n<each JSON>")
   ```

   `annetaan:pj-reviewer` ships with this plugin, takes its model and effort from the level, `agents.pj-reviewer` of the `level.sh` JSON, and has code changes disabled.
   **When its model is `fable` and it cannot start** (a weekly limit, a rate limit, the model is unavailable),
   spawn it again with the same prompt, `model: "opus"` and the same `effort`.
   **Keep it alive until phase 4 ends.** Phase 3 sends it the rewritten bodies.
4. **Show the user the diagnosis**, one line per open sub-issue, in `--order` order:
   - number and title, and `ready`, `blocker` or `stub` when it is one
   - the open decisions, by count, and the contradictory ones
   - the reviewer's findings, in a few words each
   - `clear` when the reviewer found nothing and the check passed

   Then one line for each parent with a finding, and the edges the reviewer would change.

**When nothing has a finding and no open decision is left**, go to phase 4 with no writers. Only the titles, the labels,
the roadmap task's edges and the run order may still change.

## Phase 2: the questions

An unattended run asks none of these. When any is due, it writes nothing and ends as needs-user, naming the questions.

Ask the user only what is not a task decision. **Never ask a task decision in the conversation.** An open decision
is ticked on GitHub, and a question the reviewer raised that passes **What a human is asked** in `workflow/judgement.md`
becomes a new decision in the issue (kind 10 in `roles/review.md`). A question a model can settle is settled by the
writer (kind 14) and never asked.

Ask with `AskUserQuestion`, at most four questions per call, one issue per question, header `#<n>`:

- **A proposed split** (kind 11): split as proposed, or keep it one task and rework it. Each option says what it files
  and how the edges move.
- **Two boxes ticked in one decision** (kind 2): which option stands. List the ticked options, the recommended one
  first.
- **A ticked option the code rules out** (kind 3): what the reviewer found, and the options it leaves.

Other takes `stop`, which ends the run with nothing written. Say that once before the first call.

An answer here is the user's decision, so the writer of that issue works it into the body as a ticked box.

## Phase 3: the writers

**Start one issue writer per issue with a finding**, the parents included, all in one message.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "revise #<n>", run_in_background: true,
      model: "<agents.pj-issue-writer.model>", effort: "<agents.pj-issue-writer.effort>",
      prompt: "Read $DOCTOR/../pj2-issues/roles/issue.md first and follow the role it describes. The project format is in $DOCTOR/../pj1-plan/format.md. project.sh is $DOCTOR/../pj1-plan/scripts/project.sh. The judgement rules are in <skills>/workflow/judgement.md.\n\nMode: revise\n\nParent: #<P>\nIssue: #<n>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check <n>:\n<the JSON, or none for a parent>\n\nThe review's findings on #<n>:\n<the findings>\n\nThe user's answers:\n<the phase 2 answers on #<n>, or none>\n\nScratch: $TMP/scratch/<n>")
```

`annetaan:pj-issue-writer` ships with this plugin and takes its model and effort from the level, `agents.pj-issue-writer` of the `level.sh` JSON. It is told never to change the repository and to write only under its `Scratch:` directory, by instruction.
**Keep each writer alive until phase 4 ends.**

**Each writer writes its own issue only.** A finding a writer says belongs to another issue goes to that issue's
writer with `SendMessage`. Start one when that issue has none yet.

**Lint each body that comes back.** Write it to `$TMP/<n>.md`. A sub-issue body takes the lint, and a parent body the
parent lint.

```bash
$DOCTOR/../pj1-plan/scripts/project.sh --lint "$TMP/<n>.md"
$DOCTOR/../pj1-plan/scripts/project.sh --parent-lint "$TMP/<n>.md"
```

Accept a sub-issue body on a clear lint, or `decisions-open` when a decision is still open. Accept a parent body on a
clear parent lint, and read it for what that lint has no code for: no line numbers, and its `Base:` line, its
`Roadmap:` line and its `## Order` reading as they do on GitHub. Send a body that fails back to its writer with
`SendMessage` and say what to fix.

**When a writer could not fix something** that needs the user, ask it as phase 2 says, and send the answer back to
the writer. An unattended run ends as needs-user instead and writes nothing.

When every writer has returned, send the rewritten bodies to the reviewer with `SendMessage`. Its return is review 2.

**The reviewer reads at most five times in a run** (phase 1 is the first). When review k (2 <= k < 5) has findings for a
writer, send them to each issue's writer with `SendMessage` (start one with the `Agent` call above when there is none),
lint the bodies that come back as above, and send **only the bodies changed since the reviewer last got them**, making
review k+1.

It ends on a return with no finding for a writer, or on the fifth return. **The fifth return is the last word for this
run.** Findings left stay open; that issue goes into the Report without `ready`, and the next run picks it up.

**A finding that needs the user (kinds 2, 3 and 11) in a later return is never sent to a writer.** It stays open and the
next run's phase 2 asks it.

Print one line `#<k> rewritten` each time a body comes back (in the rounds after the first too), and `review <k> done`
each time the reviewer returns (k from 2 to 5), so a context summary can find where the run stood.

## Phase 4: approval and writing

**Check each parent edge to add before you show anything**, so that the approval offers only edges that step 3
writes. When `parent.baseExists` of `<P>` is true, drop every parent edge to add, and say so. Otherwise run
`project.sh <Q>` for each `add #<P> blocked by #<Q>`. When it fails, for instance with `has no Base: line`, `#<Q>` is
no project. Drop the edge, and say so. When its `parent.state` is `CLOSED` and it is not `merged`, `#<Q>` was closed
without a merge and never merges. Drop that edge too, and say so. Keep `parent.merged` of each `#<Q>` that is left.

```bash
$DOCTOR/../pj1-plan/scripts/project.sh <Q>
```

**Show the user what will be written**, then ask once.

- each body to rewrite, as `#<n>`, with what changed in one line
- the new issues: the parts of a split and the stubs
- the sub-issue edges to add and remove. When `parent.roadmap.task` is set and open, one line
  `#<task> blocked by #<k>` per `<k>` in `parent.roadmap.missing` of the phase 1 read, and one sentence that every
  issue filed in this run gets the same edge
- the parent edges to add and remove, each as `#<P> blocked by #<Q>`. For an added one whose `#<Q>` is not `merged`,
  one more line: `pj4-running` does not start this project until `#<Q>` is merged
- the blockers to close
- the titles to change, as `#<n> <title> -> <wantedTitle>`. An issue rewritten or filed in this run has no
  `wantedTitle` yet: its title takes ` (<settled>/<total>)` from `decisions` in the output of `project.sh --lint
  "$TMP/<n>.md"`, while `settled` is below `total` (`pj1-plan/format.md`, **The title**)
- `ready` to add and `ready` to take off, each with why
- `doing` to add to #<P>, when `parent.labels` lacks it (`pj1-plan/between-skills.md`, **Labels**)
- the new `## Order`, one line per issue as it will read

```
AskUserQuestion: Write these changes to GitHub?
  - Write them
  - Stop without writing
```

An unattended run skips this question, prints the same summary, and writes as on Write them.

The approval covers this run only (`pj1-plan/between-skills.md`, **Principle**).

**`ready` goes on an issue** when it is open and all of these hold:

- the step 6 `--check`, run again after a format-only fix when one was made, has a clear lint, no premise failure (`premises.mode` `none` has none) and no entry in `breakage.unclosed`, and an empty `roadmap.several-tasks`
- no review finding is left on it: the reviewer's last return lists it as clear

`ready` stays on an issue that still meets this. **`ready` comes off** an issue that had it and no longer meets this.

Write in this order. The bodies come first because every later write to an issue, a comment, an edge or a stub
filed blocking it, moves its `updatedAt`, and the guard of `issue.sh edit` would then stop on the run's own work. The
stops of `issue.sh` are in `pj1-plan/between-skills.md` under **Writing to GitHub**. **When a command fails halfway**,
or `issue.sh` stops on a reason these steps do not name, stop and tell the user what was written and what was not,
with the numbers.

1. **Write the bodies**, the parents included, each with the `updatedAt` its writer returned. Add `--title` when the
   writer's title differs from the one on GitHub with its count stripped. Step 5 then adds the count.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh edit <k> --since <updatedAt> --body "$TMP/<k>.md"
   $DOCTOR/../pj1-plan/scripts/issue.sh edit <k> --since <updatedAt> --body "$TMP/<k>.md" --title "<title>"
   ```

   - A `moved` stop: someone changed the issue since its writer read it. Send `$TMP/<k>.md.github`, the stop's
     `github`, to the writer to merge, lint the new body as phase 3 does, and write again with the `updatedAt` the
     stop printed.
   - A `lint` stop on a parent: send its `reasons` to the writer of that parent, as the lint of phase 3 does, and
     write again with the body that comes back.

2. **File what is new.** For a split, file parts 2 to N and keep a map from each part to the `number` it prints. A
   stub is filed blocking the issue it was found in. Both go under `<P>`, each with the title its writer returned.
   Step 5 gives it its count.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh sub <P> --title "<title>" --body "$TMP/part<k>.md"
   $DOCTOR/../pj1-plan/scripts/issue.sh sub <P> --title "<title>" --blocking <n> --body "$TMP/stub.md"
   ```

   A `lint` stop filed nothing: send its `reasons` to the writer of that part or stub, as the lint of phase 3 does,
   and run the call again with the body that comes back.

3. **Change the edges**, one call each, with the part numbers from step 2. Each `relate` runs the cycle check after
   an edge it adds, and takes the edge back off when it made a cycle.

   **Sub-issue edges** run only between sub-issues of `<P>`. An edge whose other end is not a sub-issue of `<P>` is
   never added. One that already exists is removed, as kind 9 in `roles/review.md` says.

   **Parent edges**, `#<P> blocked by #<Q>`, change only while `parent.baseExists` is false (`pj1-plan/format.md`,
   **Projects**). Write only the ones the approval showed. The check before the approval dropped the rest, and the
   report names them with why.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh relate <a> add <b>
   $DOCTOR/../pj1-plan/scripts/issue.sh relate <a> remove <b>
   $DOCTOR/../pj1-plan/scripts/issue.sh relate <P> add <Q>
   $DOCTOR/../pj1-plan/scripts/issue.sh relate <P> remove <Q>
   ```

   **The roadmap task's edges** (`pj1-plan/format.md`, **The roadmap task**). Read the project again, because step 2 filed
   new issues, and add one edge per number in `parent.roadmap.missing`. With `parent.roadmap` null or its `task`
   null, there are none.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P>
   $DOCTOR/../pj1-plan/scripts/issue.sh relate <task> add <k>
   ```

   **A `cycle` stop**, from `relate`, from `sub` in step 2 or from `order` in step 7, is a split error. The edge is off
   again, and an issue `sub` filed stays, with the `number` the stop carries. The report names the edge and what was
   written, and the run stops.

4. **Close a blocker that needs no code.** The marked comment points at the rewritten issue, and `issue.sh` posts it
   and closes the stub in one call.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh close <b> --reason completed --comment "$TMP/<b>-comment.md"
   ```

5. **The titles** (`pj1-plan/between-skills.md`, **Titles**), now that the bodies, the new issues and the closed
   blockers are written. Every issue that gets `ready` in the next step then has a title with no count.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh titles <P>
   ```

6. **The labels.** `issue.sh` makes sure each label it adds exists.

   **When the phase 1 `project.sh <P>` shows `parent.labels` without `doing`**, add it to the parent.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh label <P> --add doing
   ```

   Check again, in one call before any label goes on, the same issues as step 2 of phase 1 (every open sub-issue whose
   `pr` is not merged), plus the issues step 2 of this phase filed, because the bodies and the edges just changed. An issue whose
   pull request merged is left alone, and `ready` stays as it is on it. When no number is left, make no call.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --check <k1> <k2> ...
   ```

   Then, for each issue whose check is clear, the second form where it carries `blocker`:

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh label <k> --add ready
   $DOCTOR/../pj1-plan/scripts/issue.sh label <k> --add ready --remove blocker
   ```

   **When the check fails on `symbol never in the file`, or on a lint reason backticks and whitespace alone clear**,
   fix the body as `pj1-plan/between-skills.md` says under **Format-only fixes**, once, before `ready` goes on. Read
   `updatedAt` first and keep it, then read the body.

   ```bash
   gh issue view <k> --json updatedAt --jq .updatedAt
   gh issue view <k> --json body --jq .body > "$TMP/<k>.form-before.md"
   ```

   Read it with Read, and write the fixed body with Write to `$TMP/<k>.form.md`.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh --same-words "$TMP/<k>.form-before.md" "$TMP/<k>.form.md"
   ```

   Go on only when `ok` is true and `lint` has no reason. Then write the body with the `updatedAt` kept, and check
   again.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh edit <k> --since <updatedAt> --body "$TMP/<k>.form.md"
   ```

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --check <k>
   ```

   A `moved` stop means a human changed the body since the read, and it is theirs now: start the fix again from the
   read of `updatedAt`. A clear check prints `#<k> format fixed`, and `ready` goes on as above.

   **An issue that carries `blocker` loses it in the same call.** A check whose lint or premises still fail, or
   whose `breakage.unclosed` or `roadmap.several-tasks` is not empty, leaves `ready` off, and the report names the failures.

   **Whoever takes `ready` off leaves a comment** (`pj1-plan/between-skills.md`, **Labels**). It starts with
   `**[pj3-doctor]**` and says what changed and why.

   ```bash
   $DOCTOR/../pj1-plan/scripts/issue.sh label <k> --remove ready
   $DOCTOR/../pj1-plan/scripts/issue.sh comment <k> --body "$TMP/<k>-comment.md"
   ```

7. **The run order.** Read it again, now that the edges and the issues have changed. `issue.sh order` writes `list`
   under the parent's `## Order`, one line per number as `1. #<n>`, through `--order-body`, and `pj1-plan/state.md`
   says what it keeps.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P>
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --order
   $DOCTOR/../pj1-plan/scripts/issue.sh order <P> --since <parent.updatedAt>
   ```

   Skip the write when the list reads the same: compare `--order`'s `list` with `parent.order`, and run `order` only
   when they differ, with `parent.updatedAt` of the read just before. A `moved` stop: read `project.sh <P>` again and
   run `order` again once, with the new `parent.updatedAt`. A second one is reported. Then run `project.sh <P>` and
   confirm that `parent.orderCheck.ok` is true and `missing` is empty.

## Report to the user

- every open sub-issue, one line each, in the new run order: `ready`, or not
  ready with why. An issue left without `ready` gives the findings the last review left as the reason
- **the decisions left for the user**, one line each, as `<issue URL> D<k> <question>`. This is the
  user's next step: tick them on GitHub, then run `/annetaan:pj3-doctor` again
- **the model decisions added or changed in this run**, one line each, as `<issue URL>` and the decision. A comment on
  the issue overturns one, and the next run works the comment in. On an issue labelled `ready` in this run, the user
  also takes `ready` off, because `pj4-running` never reads comments
- the format-only fixes made, by issue
- the issues filed, the sub-issue and parent edges changed (the roadmap task's edges added among them), the blockers closed, the parents rewritten and the
  titles changed
- the parent edges dropped before the approval, each with why
- the findings left, by issue
- the next step: `/annetaan:pj3-doctor` again only when a decision or a finding is left, never just to put
  `ready` on. `/annetaan:pj4-running` when the first open issue of the run order is `ready`. It works down the
  order and stops at the first issue that is not workable. When `parent.baseExists` is false and a project in
  `parent.waitsOn` is not `merged`, add one sentence: `pj4-running` starts this project after each such `#<Q>` is
  merged into `<from>`.

## Ending an unattended run

An unattended run prints its last line as `pj1-plan/between-skills.md` says under **Unattended runs**. Only one ending is
`unattended: done`: the run reached the Report to the user above, including when there was nothing to write.

Every other ending is `unattended: needs-user <one line>`. That covers a **Before you start** failure, a `project.sh`
failure, an `--order` cycle, the phase 2 and phase 3 endings, and a write that fails halfway. An ending not named here
is needs-user too.

## Rules

- **You decide nothing.** The user decides, the reviewer finds, and the writer writes.
- **Never ask a task decision in the conversation.** It goes into the issue as a box to tick.
- **You never write a body yourself**, except the `## Order` list of the parent and a format-only fix. Titles you write come from
  `wantedTitle` or from a writer.
- **Each writer writes its own issue only. Only you write to GitHub**, and only after the phase 4 approval. Every
  comment you post starts with `**[pj3-doctor]**`.
- **The roadmap task's edges come from `parent.roadmap.missing` only.** You never judge them, nor does the reviewer.
- **Sub-issue edges stay inside the project.** A parent edge runs only between two parents, only while
  `parent.baseExists` is false, and only after the phase 4 approval. Never an edge between a parent and a sub-issue.
- **Every write goes through `issue.sh`, and every body edit carries `--since`.** `issue.sh` refuses to post a comment
  without a marker (`pj1-plan/between-skills.md`, **Comments**).
- **A sub-issue body goes out only after its lint passes**, and a parent's only after its parent lint passes and you
  read it for what that lint does not check.
- An unattended run never calls `AskUserQuestion` and ends with one `unattended:` line.
- After a context summary, take `<P>` and whether the run is unattended again from the last `project #<P>` line, `$TMP` from the last `tmp` line, and the level from the last `level` line, running `level.sh show` again with that level when the line says `override` and without one otherwise, and rebuild where the run stood from the
  progress lines (the review count is the largest k of `review <k> done`) and `project.sh <P>`. A writer or a reviewer whose handle is gone is started again.
