---
name: pj-design-details
description: Takes the sub-issues of a GitHub project in an order it picks itself, with up to three issue writers drawing ahead in the background, so the user answers one issue while the next ones are drawn. Settles each issue's decisions with the user, makes the issue implementable as written by detailing or splitting it, resolves the blockers pj-running left, and labels the issue ready. The second of three skills, after pj-design-and-plan and before pj-running. Use it only when the user names this skill or invokes /annetaan:pj-design-details, because it edits, files and closes issues and changes labels on GitHub.
---

# pj-design-details

The second of the three pj skills: it takes a filed project and makes each sub-issue `ready`. It picks the order,
keeps up to three issue writers drawing ahead, and asks the user only the questions.

You are the main session. **You decide nothing, and you never write an issue body.** The user decides, an issue
writer reads the code and proposes and writes, and you carry the questions to the user and the bodies onto GitHub.

## Paths: `$DETAILS`

**`$DETAILS` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$DETAILS` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$DETAILS` finds
them nothing.

**Read `$DETAILS/../pj-design-and-plan/format.md` before anything else.** It is the only description of the parent
issue, the sub-issue body, the decisions, the labels, the relationships, the blockers and the comments. Its table of
the three skills says where this one sits. Everything below refers to it.

This skill uses two more files from `pj-design-and-plan`:

- the script `$DETAILS/../pj-design-and-plan/scripts/project.sh`, written `project.sh` below
- the issue writer's role file `$DETAILS/../pj-design-and-plan/roles/issue.md`

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `format.md`
says.

## Before you start

This skill edits, files and closes issues and changes labels on GitHub. **Start it only when the user names it or
invokes `/annetaan:pj-design-details`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.94.0, `gh` not logged in, or
  issues turned off. Say which one and stop. The clone is needed because `project.sh --check` runs inside one.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it.

**The argument.**

- **No number**: find the project as `format.md` says under "Finding the project when no number was given".
- **One number that is a sub-issue**: take its parent from `gh issue view <n> --json parent`. The parent is the
  project `<P>`. Run `project.sh <P>` first. When `<n>` has a `pr` whose `state` is `MERGED`, tell the user it is
  waiting for `pj-running` to close it, and leave it out of the queue. Otherwise it goes to the front of the queue in
  phase 1.
- **One number that is not a sub-issue**: it is the parent `<P>`.

## Phase 1: the queue

```bash
$DETAILS/../pj-design-and-plan/scripts/project.sh <P>
$DETAILS/../pj-design-and-plan/scripts/project.sh <P> --order
```

**When `--order` fails on a cycle**, show the user the cycle it names and stop. Nothing can be ordered until a human
removes an edge.

The queue is the `--order` entries without `ready`, and without a `pr` whose `state` is `MERGED`. An issue whose pull
request has merged is waiting for `pj-running` to close it. Move the ones labelled `blocker` to the front and keep the
rest in their order. A sub-issue number given as the argument goes in front of them all.

**You pick the order. Ask nothing about it.** Show the queue once, one line per issue:

- number and title, and `blocker` or `stub` when it is one
- the open and the contradictory decisions, by count
- the lint's reason codes
- the open issues in its `blockedBy`

Then two lines. One counts the issues that already carry `ready`. The other says: Other in any answer also takes
`stop`, or `#<k> first`.

When the queue is empty, say so and go to **Report to the user**.

Make one directory for the bodies of the whole run. Applies interleave with the questions, so it is made here.

```bash
mktemp -d
```

`$TMP` below is the directory `mktemp -d` printed. A shell variable does not outlive one command, so write the path in
full each time.

Then go to phase 2.

## Phase 2: the loop

Every issue in the queue has a state. Each issue's state is its own.

| State | The issue is in it when |
| --- | --- |
| `queued` | it is in the queue and has no writer yet |
| `drafting` | its writer was started and its round 1 has not come back |
| `proposed` | its round 1 came back and its questions are not asked yet, or decisions came back to be asked again |
| `asking` | its questions are being asked, also while an Other answer is with the writer |
| `answered` | all its answers went to the writer, and its round 2 is not back yet, or is back and not applied yet |
| `applying` | its round 2 return is being written to GitHub |
| `done` | its apply and its report are finished |

A round 1 return that has nothing to decide and already contains round 2 takes its issue straight to `answered`, with
round 2 received. While an Other answer is with the writer, the issue stays `asking`. When the writer returns, it goes
back to `proposed`.

**The window.** At most three issues are `drafting`, `proposed` or `asking` at once. To refill it, start writers for
the first `queued` issues in queue order until three are in those states or none is `queued`, as **Starting a
writer** says. The writers started by one refill go out in a single message. Refill once when the loop starts, and
again whenever an issue leaves `drafting`, `proposed` or `asking` for `answered`.

**The next action.** Writer returns arrive one at a time, first returns and `SendMessage` replies alike. On each,
update the state, print one line, and go down the list from the top. Take the first item that applies, then start
again from the top.

1. **An issue has all its answers**, the split answer included. Send them to its writer with `SendMessage`. Its
   round 2 return carries every body to write, the edges to change, a blocker to close, and whether the issue and
   each part are ready. Mark the issue `answered`.
2. **An unapplied round 2 return writes the body of the issue you would ask next**, the one item 3 would pick. Apply
   it first, as item 4 says, so its sync reaches that issue before its questions do.
3. **An issue `asking` with questions still unasked, else the first `proposed` issue in queue order.** Ask that one
   issue's questions, as **Asking an issue's questions** says.
4. **An unapplied round 2 return.** Apply one, as **Applying an issue** says, which ends in **Reporting an issue**.
   Only one issue is `applying` at a time, so items 2 and 4 wait while one is.
5. **None of these.** List the running writers, each as `#<k> <state>`, and wait.

**One pass per issue per session.** The parts of a split left without `ready` and the issues that lost `ready` in a
ripple join the queue as `queued`.

### The sync

When an apply writes the body of an issue `<j>` that is `drafting`, `proposed` or `asking`, send `<j>`'s writer the
new body and its `updatedAt` with `SendMessage`, and say that another issue's apply rewrote it. **Do not stop asking
`<j>`.** The questions already asked stand.

When the writer returns changed decisions, only those go back to unasked, and `<j>` goes to `proposed`. Ask only
those again. When `<j>`'s round 2 is already out by then, send the new answers to its writer afterwards. When the
writer says the proposal stands, nothing changes.

No sync message goes to an `answered` issue. Its apply re-reads `updatedAt` in step 2 of **Applying an issue** and
sends the moved body to its writer to merge.

### Progress

Print one line `#<k> <state>` on every state change. For `done`, the line is `#<k> done: ready` or
`#<k> done: not ready (<reason>)`.

**After a context summary**, rebuild the states from those lines and from `project.sh <P>`. An issue whose writer
handle is gone goes back to `queued`. An issue cut off in `applying` is finished from where it stopped: compare GitHub
with its round 2 return and run the remaining steps. When you cannot tell how far it got, do as **When a command
fails halfway** says.

### `stop` and `#<k> first`

Other in any answer also takes `stop` and `#<k> first`.

- **`stop`**: finish the issues that are `answered` or `applying`. Wait for their round 2, apply it and report it.
  Send nothing to the other writers, and stop them with `TaskStop` when it is available. Then go to **Report to the
  user**.
- **`#<k> first`**: when `<k>` is `queued`, `drafting`, `proposed` or `asking`, move it to the front of the queue.
  Item 3 and the refill both go by queue order. When `<k>` is past `asking` or not in the queue, tell the user why
  nothing moved. Then ask the question that carried it again.

### Requeue

After every apply, run `project.sh <P>` and `project.sh <P> --order` again. New entries, the parts of a split left
without `ready` and the issues that lost `ready` in step 5 of **Applying an issue**, go in as `queued` where
`--order` puts them. An issue a human labelled `ready` and a closed issue leave the queue when they are `queued`. **A
`done` issue never comes back this session**, even when a later apply takes its `ready` off. The report lists it.

### Starting a writer

Check the issue `<n>` against the code once. `--check` fetches the base branch first.

```bash
$DETAILS/../pj-design-and-plan/scripts/project.sh <P> --check <n>
```

Then start a new issue writer for it in the background, and mark the issue `drafting`.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "revise #<n>", run_in_background: true,
      prompt: "Read $DETAILS/../pj-design-and-plan/roles/issue.md first and follow the role it describes. The project format is in $DETAILS/../pj-design-and-plan/format.md. project.sh is $DETAILS/../pj-design-and-plan/scripts/project.sh.\n\nMode: revise\n\nParent: #<P>\nIssue: #<n>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check <n>:\n<the JSON>")
```

`annetaan:pj-issue-writer` ships with this plugin and is pinned to opus at high effort with code changes disabled.

**Keep this writer alive until its issue is `done`.** Every later round for `<n>` goes to it with `SendMessage`. Each
issue gets a writer of its own.

### Asking an issue's questions

Mark the issue `asking`. **One `AskUserQuestion` holds one issue only.**

The writer's first return is a proposal. **First tell the user in a few lines what it found**, under `#<n> <title>`:
the state of the body, the stale commits, the premise failures, which case a `blocker` is, and the split when it
proposes one.

**A proposed split is a question of its own**, asked first, in a call of its own. The decisions wait for its answer.
The user approves it.

```
AskUserQuestion (header #<n> split): Split #<n>?
  - Split as proposed - #<n> keeps part 1, parts 2 to N become new sub-issues
  - Keep one issue and rework it
```

Then the decisions. Before the first call of the session, say that "Other" takes a different answer, a question,
`later` to leave the decision open, `stop`, or `#<k> first`.

- **At most four questions per call**, in as many calls as it takes. The header is `#<n> D<k>`.
- The recommended option comes first, with "(Recommended)" at the end of its label.
- Each option's description says what that option changes.

**An "Other" answer that is not `later`, `stop` or `#<k> first`** goes to the writer with `SendMessage`. Ask that
decision again with what comes back, until the user picks an option or says `later`.

With no decisions and no split, the issue is `answered`.

### Applying an issue

Mark the issue `applying`. Its round 2 return carries every body to write, the edges to change, a blocker to close,
and whether issue `<n>` and each part are ready.

When a lint or a check below sends a body back to the writer, the issue stays `applying` and the loop keeps running.
Resume at that step when the writer returns.

1. **Lint every sub-issue body before it goes out.** Write each body to a file in `$TMP`, the parent's too, and lint
   each sub-issue body.

   ```bash
   $DETAILS/../pj-design-and-plan/scripts/project.sh --lint "$TMP/<k>.md"
   ```

   For issue `<n>`, each new part and each other issue, accept a clear lint, or `decisions-open` alone when the user
   left a decision open. Accept a stub the writer returns when its only reason is `stub`. Send a body that fails back
   to the writer with `SendMessage` and say what to fix. Write the fixed body over the same file.

   The lint checks the sub-issue shape, so it does not apply to the parent. Read the parent's new body against the
   parent shape in `format.md` instead: its four headings, no line numbers, no hand-written task list, and its
   `Base:` line unchanged. Send it back to the writer the same way when it fails.
2. **Re-read `updatedAt`** of every issue about to be written, the parent included, and compare it with the
   `updatedAt` the writer says it read.

   ```bash
   gh issue view <k> --json updatedAt,body
   ```

   When it moved, a human or another issue's apply changed the issue in the meantime. Send the current body to the
   writer to merge, and go back to step 1 (`format.md`, "Writing bodies").
3. **File what is new.** For a split, file parts 2 to N and keep a map from each part to its number. A stub the
   writer returned for merged code that has to change is filed blocking `<n>`.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/part<k>.md"
   gh issue create --parent <P> --blocking <n> --title "<title>" --body-file "$TMP/stub.md"
   ```

4. **Write the bodies**, with `--title` when the title changed: issue `<n>`, each other issue, and the parent.

   ```bash
   gh issue edit <k> --body-file "$TMP/<k>.md"
   ```

5. **Tell the other issues.** Every other issue whose body changed gets a marked comment: `**[pj-design-details]**`,
   what changed, and the decision that caused it, as `#<issue> D<k>`. **When that issue had `ready`, take it off in
   the same step**, because its body changed under it (the ripple rule).

   ```bash
   gh issue edit <k> --remove-label ready
   gh issue comment <k> --body-file "$TMP/<k>-comment.md"
   ```

   The parent gets a marked comment when its `## Design` changed.
6. **Change the edges**, one at a time, as the writer listed them, with the part numbers from step 3.

   ```bash
   gh issue edit <a> --add-blocked-by <b>
   gh issue edit <a> --remove-blocked-by <b>
   $DETAILS/../pj-design-and-plan/scripts/project.sh <P> --order
   ```

   **Run `--order` after the edges change.** On a cycle, remove the last edge added, tell the user, and send the cycle
   to the writer.
7. **Close a blocker that needs no code.** When the writer resolved a stub blocker by rewriting `#m`, post a marked
   comment on the stub that points at `#m`, then close it.

   ```bash
   gh issue comment <b> --body-file "$TMP/<b>-comment.md"
   gh issue close <b> --reason completed
   ```

8. **Add `ready`** to issue `<n>` and each new part the writer says is ready. Check each one first.

   ```bash
   $DETAILS/../pj-design-and-plan/scripts/project.sh <P> --check <k>
   ```

   Accept it when `lint.ok` is true and `premises.failures` is empty. Premises not evaluated yet count as clear.
   **`history` does not count here.** The writer already answered the stale commits, and `readyAt` starts over when
   `ready` goes on. Make sure the label exists with the command in `format.md` under "Labels", then add it. **An
   issue that carries `blocker` loses it in the same command.**

   ```bash
   gh issue edit <k> --add-label ready
   gh issue edit <k> --add-label ready --remove-label blocker
   ```

   **When the check fails**, send its JSON to the writer with `SendMessage` and say what to fix. Lint the body that
   comes back as in step 1, write it as in step 4, and check again. When the second check fails too, leave `ready`
   off. The issue keeps `blocker` if it had it, and its report names the failures.

   An issue that lost `ready` in step 5 does not get it back in this pass. It joins the queue as `queued`.
9. **Sync the open issues.** For each issue in `drafting`, `proposed` or `asking` whose body this apply wrote, run
   the sync in phase 2.

Then report the issue, as **Reporting an issue** says.

**When a command fails halfway**, stop and tell the user what was written and what was not, with the numbers.

### Reporting an issue

Report in a few lines, under `#<n> <title>`:

- issue `<n>`: `ready` or not, and when not, its open decisions, its lint codes or its premise failures
- the parts a split filed, with their numbers, each `ready` or not in the same way
- each other issue changed, and whether it lost `ready`
- the edges changed and the blockers closed

Then mark the issue `done`, requeue, refill the window, and go back to the next action in phase 2.

## Report to the user

When the user stops, or no issue is `queued` and none is `drafting`, `proposed`, `asking`, `answered` or `applying`:

- every issue this session touched, one line each, with its state
- which issues are now workable, as `format.md` defines it
- the next step: `/annetaan:pj-running`

## Rules

- **You decide nothing.** The user decides, and the writer proposes and writes.
- **You pick the order. Never ask which issue comes next.**
- **At most three issues in `drafting`, `proposed` or `asking`. Writers read in parallel. Only one issue is
  `applying` at a time, and only you write to GitHub.**
- **You never write a body yourself.** A body you write never passed through anyone who read the code.
- **Only you write to GitHub.** The writer only reads it. Every comment you post starts with `**[pj-design-details]**`.
- **Always pass a body with `--body-file`.** Never create a label with `--force`.
- **Re-read `updatedAt` before every edit.**
- **Never edit a closed issue.**
- **A sub-issue body goes out only after its lint passes**, and the parent's only after you read it against its
  shape.
