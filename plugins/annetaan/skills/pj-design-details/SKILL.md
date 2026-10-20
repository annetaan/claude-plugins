---
name: pj-design-details
description: Takes the sub-issues of a GitHub project one at a time. Settles each issue's decisions with the user, makes the issue implementable as written by detailing or splitting it, resolves the blockers pj-running left, and labels the issue ready. The second of three skills, after pj-design-and-plan and before pj-running. Use it only when the user names this skill or invokes /annetaan:pj-design-details, because it edits, files and closes issues and changes labels on GitHub.
---

# pj-design-details

The second of the three pj skills: it takes a filed project one sub-issue at a time and makes each one `ready`.

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
  project `<P>`, and the first round skips phase 1 and takes `<n>`.
- **One number that is not a sub-issue**: it is the parent `<P>`.

## Phase 1: pick an issue

```bash
$DETAILS/../pj-design-and-plan/scripts/project.sh <P>
$DETAILS/../pj-design-and-plan/scripts/project.sh <P> --order
```

**When `--order` fails on a cycle**, show the user the cycle it names and stop. Nothing can be ordered until a human
removes an edge.

The candidates are the `--order` entries without `ready`. Move the ones labelled `blocker` to the front and keep the
rest in their order. Show one line per candidate:

- number and title, and `blocker` or `stub` when it is one
- the open and the contradictory decisions, by count
- the lint's reason codes
- the open issues in its `blockedBy`

Then one line counting the issues that already carry `ready`.

```
AskUserQuestion: Which issue next?
  - #<first candidate> <title> (Recommended)
  - #<second candidate> <title>
  - ...                             (up to four options in all)
  - Stop here                       (from the second round on, as the last option)
```

"Other" takes any issue number. When no candidate is left, say so and go to **Report to the user**.

## Phase 2: the revise pass

Check the chosen issue `<n>` against the code once. `--check` fetches the default branch first.

```bash
$DETAILS/../pj-design-and-plan/scripts/project.sh <P> --check <n>
```

Then start a new issue writer for it.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "revise #<n>",
      prompt: "Read $DETAILS/../pj-design-and-plan/roles/issue.md first and follow the role it describes. The project format is in $DETAILS/../pj-design-and-plan/format.md. project.sh is $DETAILS/../pj-design-and-plan/scripts/project.sh.\n\nMode: revise\n\nParent: #<P>\nIssue: #<n>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check <n>:\n<the JSON>")
```

`annetaan:pj-issue-writer` ships with this plugin and is pinned to opus at high effort with code changes disabled.

**Keep this writer alive until phase 4 ends for this issue.** Every later round for `<n>` goes to it with
`SendMessage`. The next issue gets a new writer.

## Phase 3: decide with the user

The writer's first return is a proposal. **First tell the user in a few lines what it found**: the state of the
body, the stale commits, the premise failures, which case a `blocker` is, and the split when it proposes one.

**A proposed split is a question of its own**, asked before the decisions. The user approves it.

```
AskUserQuestion: Split #<n>?
  - Split as proposed - #<n> keeps part 1, parts 2 to N become new sub-issues
  - Keep one issue and rework it
```

Then the decisions. Before the first call, say that "Other" takes a different answer, a question, or `later` to
leave the decision open.

- **At most four questions per call**, in as many calls as it takes. The header is `D<n>`.
- The recommended option comes first, with "(Recommended)" at the end of its label.
- Each option's description says what that option changes.

**An "Other" answer that is not `later`** goes to the writer with `SendMessage`. Ask that decision again with what
comes back, until the user picks an option or says `later`.

With no decisions and no split, go straight to phase 4.

## Phase 4: apply

1. **Send the answers to the writer** with `SendMessage`, the split answer included. Its return carries every body to
   write, the edges to change, a blocker to close, and whether issue `<n>` and each part are ready.
2. **Lint every sub-issue body before it goes out.** Write each body to a file, the parent's too, and lint each
   sub-issue body.

   ```bash
   mktemp -d                                    # once, for the whole run
   $DETAILS/../pj-design-and-plan/scripts/project.sh --lint "$TMP/<k>.md"
   ```

   `$TMP` is the directory `mktemp -d` printed. A shell variable does not outlive one command, so write the path in
   full each time.

   For issue `<n>`, each new part and each other issue, accept a clear lint, or `decisions-open` alone when the user
   left a decision open. Accept a stub the writer returns when its only reason is `stub`. Send a body that fails back
   to the writer with `SendMessage` and say what to fix. Write the fixed body over the same file.

   The lint checks the sub-issue shape, so it does not apply to the parent. Read the parent's new body against the
   parent shape in `format.md` instead: its four headings, no line numbers, and no hand-written task list. Send it
   back to the writer the same way when it fails.
3. **Re-read `updatedAt`** of every issue about to be written, the parent included, and compare it with the
   `updatedAt` the writer says it read.

   ```bash
   gh issue view <k> --json updatedAt,body
   ```

   When it moved, a human changed the issue in the meantime. Send the current body to the writer to merge, and go
   back to step 2 (`format.md`, "Writing bodies").
4. **File what is new.** For a split, file parts 2 to N and keep a map from each part to its number. A stub the
   writer returned for merged code that has to change is filed blocking `<n>`.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/part<k>.md"
   gh issue create --parent <P> --blocking <n> --title "<title>" --body-file "$TMP/stub.md"
   ```

5. **Write the bodies**, with `--title` when the title changed: issue `<n>`, each other issue, and the parent.

   ```bash
   gh issue edit <k> --body-file "$TMP/<k>.md"
   ```

6. **Tell the other issues.** Every other issue whose body changed gets a marked comment: `**[pj-design-details]**`,
   what changed, and the decision that caused it, as `#<issue> D<k>`. **When that issue had `ready`, take it off in
   the same step**, because its body changed under it (the ripple rule).

   ```bash
   gh issue edit <k> --remove-label ready
   gh issue comment <k> --body-file "$TMP/<k>-comment.md"
   ```

   The parent gets a marked comment when its `## Design` changed.
7. **Change the edges**, one at a time, as the writer listed them, with the part numbers from step 4.

   ```bash
   gh issue edit <a> --add-blocked-by <b>
   gh issue edit <a> --remove-blocked-by <b>
   $DETAILS/../pj-design-and-plan/scripts/project.sh <P> --order
   ```

   **Run `--order` after the edges change.** On a cycle, remove the last edge added, tell the user, and send the cycle
   to the writer.
8. **Close a blocker that needs no code.** When the writer resolved a stub blocker by rewriting `#m`, post a marked
   comment on the stub that points at `#m`, then close it.

   ```bash
   gh issue comment <b> --body-file "$TMP/<b>-comment.md"
   gh issue close <b> --reason completed
   ```

9. **Add `ready`** to issue `<n>` and each new part the writer says is ready. Check each one first.

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
   comes back as in step 2, write it as in step 5, and check again. When the second check fails too, leave `ready`
   off. The issue keeps `blocker` if it had it, and phase 5 reports the failures.

   An issue that lost `ready` in step 6 does not get it back in this pass. It comes up again in phase 1.

**When a command fails halfway**, stop and tell the user what was written and what was not, with the numbers.

## Phase 5: report the issue, then loop

Report in a few lines:

- issue `<n>`: `ready` or not, and when not, its open decisions, its lint codes or its premise failures
- the parts a split filed, with their numbers, each `ready` or not in the same way
- each other issue changed, and whether it lost `ready`
- the edges changed and the blockers closed

Then go back to phase 1, which now offers "Stop here".

## Report to the user

When the user stops or no candidate is left:

- every issue this session touched, one line each, with its state
- which issues are now workable, as `format.md` defines it
- the next step: `/annetaan:pj-running`

## Rules

- **You decide nothing.** The user decides, and the writer proposes and writes.
- **You never write a body yourself.** A body you write never passed through anyone who read the code.
- **Only you write to GitHub.** The writer only reads it. Every comment you post starts with `**[pj-design-details]**`.
- **Always pass a body with `--body-file`.** Never create a label with `--force`.
- **Re-read `updatedAt` before every edit.**
- **Never edit a closed issue.**
- **A sub-issue body goes out only after its lint passes**, and the parent's only after you read it against its
  shape.
