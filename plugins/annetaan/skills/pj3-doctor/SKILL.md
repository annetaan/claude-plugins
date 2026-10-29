---
name: pj3-doctor
description: Takes the project from a number given, a sub-issue's number naming its parent, or the only project with sub-issues, and otherwise asks which project to work on, then reviews the whole project against the boxes the user ticked on GitHub, against the code and against each issue in it. Has one issue writer per issue redraw what no longer holds, draws the stubs, resolves the blockers, rewrites the run order in the parent's Order list, and labels the issues ready. Asks the user no task decision, because the user ticks those on GitHub. Asks only about a split, two boxes ticked in one decision, and its changes before they are written. Run it again after ticking. The third of four skills, after pj1-plan and pj2-issues and before pj4-running. Use it only when the user names this skill or invokes /annetaan:pj3-doctor, because it edits, files and closes issues and changes labels on GitHub.
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
`pj-auto` shows name the collapsed path. This holds in the prompts for sub-agents too.

**Read `$DOCTOR/../pj1-plan/format.md`, `$DOCTOR/../pj1-plan/state.md` and `$DOCTOR/../pj1-plan/between-skills.md`
before anything else.** `format.md` is the only description of the parent issue, the run order, the sub-issue body,
the decisions and the relationships. `state.md` is how `project.sh` reads a project and when an issue is ready.
`between-skills.md` holds the labels, the blockers, the comments and picking the project. Everything below refers to
them.

This skill uses these files:

- the script `$DOCTOR/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the reviewer's role file `$DOCTOR/roles/review.md`
- the issue writer's role file `$DOCTOR/../pj2-issues/roles/issue.md`

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `format.md`
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

**The project.** Pick it as `between-skills.md` says under **Picking the project**. The project picked is `<P>`. In an unattended run, only rule 1 of **Picking the project** applies (`between-skills.md`, **Unattended runs**). Print
`project #<P>` once, with ` unattended` after it in an unattended run, so that a context summary can find both again.

Run `mktemp -d` once for the whole run. `$TMP` below is the directory it printed. A shell variable does not outlive
one command, so write the path in full each time.

## Phase 1: the diagnosis

1. Read the project.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P>
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --order
   ```

   When `project.sh` fails, for instance with `has no Base: line` or `is blocked by #<X>, which is no project`, quote
   its message and stop. On `is blocked by #<X>, which is no project`, a human has to remove that relationship on
   GitHub. **When `--order`
   fails on a cycle**, within the project or between projects, show the user the cycle it names and stop. Nothing
   can be ordered until a human removes an edge.
2. **Check every open sub-issue** whose `pr` is not merged. An open issue whose pull request merged is waiting for
   `pj4-running` to close it. Leave it alone.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --check <k>
   ```

3. **Start the reviewer.**

   ```
   Agent(subagent_type: "annetaan:pj-reviewer", description: "review #<P>",
         prompt: "Read $DOCTOR/roles/review.md first and follow the role it describes. The project format is in $DOCTOR/../pj1-plan/format.md. The state of a project is in $DOCTOR/../pj1-plan/state.md. The agreements between the skills are in $DOCTOR/../pj1-plan/between-skills.md.\n\nParent: #<P>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check, per issue:\n<each JSON>")
   ```

   `annetaan:pj-reviewer` ships with this plugin and is pinned to opus at high effort with code changes disabled.
   **Keep it alive until phase 4 ends.** Phase 3 sends it the rewritten bodies.
4. **Show the user the diagnosis**, one line per open sub-issue, in `--order` order:
   - number and title, and `ready`, `blocker` or `stub` when it is one
   - the open decisions, by count, and the contradictory ones
   - the reviewer's findings, in a few words each
   - `clear` when the reviewer found nothing and the check passed

   Then one line for each parent with a finding, and the edges the reviewer would change.

**When nothing has a finding and no open decision is left**, go to phase 4 with no writers. Only the titles, the labels
and the run order may still change.

## Phase 2: the questions

An unattended run asks none of these. When any is due, it writes nothing and ends as needs-user, naming the questions.

Ask the user only what is not a task decision. **Never ask a task decision in the conversation.** An open decision
is ticked on GitHub, and a question the reviewer raised becomes a new decision in the issue (kind 10 in
`roles/review.md`).

Ask with `AskUserQuestion`, at most four questions per call, one issue per question, header `#<n>`:

- **A proposed split** (kind 11): split as proposed, or keep one issue and rework it. Each option says what it files
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
      prompt: "Read $DOCTOR/../pj2-issues/roles/issue.md first and follow the role it describes. The project format is in $DOCTOR/../pj1-plan/format.md. project.sh is $DOCTOR/../pj1-plan/scripts/project.sh.\n\nMode: revise\n\nParent: #<P>\nIssue: #<n>\n\nproject.sh <P>:\n<the JSON>\n\nproject.sh <P> --check <n>:\n<the JSON, or none for a parent>\n\nThe review's findings on #<n>:\n<the findings>\n\nThe user's answers:\n<the phase 2 answers on #<n>, or none>")
```

`annetaan:pj-issue-writer` ships with this plugin and is pinned to opus at medium effort with code changes disabled.
**Keep each writer alive until phase 4 ends.**

**Each writer writes its own issue only.** A finding a writer says belongs to another issue goes to that issue's
writer with `SendMessage`. Start one when that issue has none yet.

**Lint each body that comes back.** Write it to `$TMP/<n>.md`.

```bash
$DOCTOR/../pj1-plan/scripts/project.sh --lint "$TMP/<n>.md"
```

Accept a clear lint, or `decisions-open` when a decision is still open. Read each parent's body against the parent
shape in `format.md` instead: its headings, no line numbers, its `Base:` line and its `## Order` unchanged. Send a
body that fails back to its writer with `SendMessage` and say what to fix.

**When a writer could not fix something** that needs the user, ask it as phase 2 says, and send the answer back to
the writer. An unattended run ends as needs-user instead and writes nothing.

**When every writer has returned**, send the reviewer the rewritten bodies with `SendMessage`. Its second return is
the last word for this run. **There is no third round.** Every finding in it starts with `exact` or `design`
(`roles/review.md`). **A `design` finding stays open**: its issue goes into the report without `ready`, and the next
run takes it up. **An `exact` finding is closed in this run**, as **Exact findings** below says.

Print one line `#<k> rewritten` as each body is accepted, `review 2 done` when the reviewer returns, and
`#<k> exact fixed` as each issue passes the check under **Exact findings**, so a context summary can find where the
run stood.

### Exact findings

An `exact` finding is one string for another on one line. The writer applies it, and you only compare the body it
returns with the reviewer's strings. **No reviewer reads it again, and there is no retry.**

1. **Send the findings.** Send each issue's `exact` findings to its writer with `SendMessage`, one message per issue,
   the `old:` and `new:` lines exactly as the reviewer wrote them. Do this on an issue that also has a `design`
   finding too. When the issue has no writer yet, start one as above, `Mode: revise`, with these findings as "The
   review's findings".
2. **Keep the body the reviewer read**, CR stripped. For an issue rewritten in this run:

   ```bash
   tr -d '\r' < "$TMP/<n>.md" > "$TMP/<n>.before.md"
   ```

   For any other issue:

   ```bash
   gh issue view <n> --json body --jq .body | tr -d '\r' > "$TMP/<n>.before.md"
   ```

3. **Check the returned body.** Write it to `$TMP/<n>.exact.md`. List the findings in the heredoc, the `old` string
   on one line and its `new` string on the next, exactly as the reviewer wrote them.

   ```bash
   bash <<'CHECK'
   B="$TMP/<n>.before.md" A="$TMP/<n>.exact.md" fail=0 want=
   while IFS= read -r old && IFS= read -r new; do
     [ "$(grep -oF -- "$old" "$B" | wc -l)" -eq 1 ] || { echo "not once in before: $old"; fail=1; }
     [ "$(grep -oF -- "$old" "$A" | wc -l)" -eq 0 ] || { echo "still in after: $old"; fail=1; }
     L=$(grep -F -- "$old" "$B")
     E=${L/"$old"/"$new"}
     grep -qxF -- "$E" "$A" || { echo "expected line missing: $E"; fail=1; }
     want+="< $L"$'\n'"> $E"$'\n'
   done <<'FINDINGS'
   <old of finding 1>
   <new of finding 1>
   FINDINGS
   got=$(diff <(printf '%s\n' "$(cat "$B")") <(printf '%s\n' "$(cat "$A")") | grep '^[<>] ' | sort)
   [ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "the diff holds other changes"; fail=1; }
   echo "fail=$fail"
   CHECK
   $DOCTOR/../pj1-plan/scripts/project.sh --lint "$TMP/<n>.exact.md"
   ```

   Per finding, `old` occurs once in the body the reviewer read and nowhere in the returned one, and the expected
   line, the line that held `old` with `old` replaced by `new`, is a whole line of the returned body. With `old` and
   `new` both quoted, `${L/"$old"/"$new"}` replaces them literally. Keep the assignment to `E` unquoted, because the
   bash 3.2 of macOS keeps the inner quotes when the whole expansion is quoted. Then `diff` has exactly one `<` line
   and one `>` line per finding: the lines that held `old`, and the expected lines. A difference in the final
   newline alone does not count. **The check passes** when it prints `fail=0` and the lint is clear or reports only
   `decisions-open`. Read a parent against the parent shape instead of the lint, as above.
4. **On a pass**, make the returned body the one phase 4 writes, and print `#<n> exact fixed`.

   ```bash
   cp "$TMP/<n>.exact.md" "$TMP/<n>.md"
   ```

5. **On a failure**, or when the writer applied none of them, every `exact` finding on that issue counts as `design`.
   `$TMP/<n>.md` stays as it was, or absent. Send nothing back to the writer.

## Phase 4: approval and writing

**Check each parent edge to add before you show anything**, so that the approval offers only edges that step 4
writes. When `parent.baseExists` of `<P>` is true, drop every parent edge to add, and say so. Otherwise run
`project.sh <Q>` for each `add #<P> blocked by #<Q>`. When it fails, for instance with `has no Base: line`, `#<Q>` is
no project. Drop the edge, and say so. When its `parent.state` is `CLOSED` and it is not `merged`, `#<Q>` was closed
without a merge and never merges. Drop that edge too, and say so. Keep `parent.merged` of each `#<Q>` that is left.

```bash
$DOCTOR/../pj1-plan/scripts/project.sh <Q>
```

**Show the user what will be written**, then ask once.

- each body to rewrite, as `#<n>`, with what changed in one line, an `exact` fix included
- the new issues: the parts of a split and the stubs
- the sub-issue edges to add and remove
- the parent edges to add and remove, each as `#<P> blocked by #<Q>`. For an added one whose `#<Q>` is not `merged`,
  one more line: `pj4-running` does not start this project until `#<Q>` is merged
- the blockers to close
- the titles to change, as `#<n> <title> -> <wantedTitle>`. An issue rewritten or filed in this run has no
  `wantedTitle` yet, so take its count from the decisions in its new body (`format.md`, **The title**)
- `ready` to add, and `ready` to take off, each with why
- the new `## Order`, one line per issue as it will read

```
AskUserQuestion: Write these changes to GitHub?
  - Write them
  - Stop without writing
```

An unattended run skips this question, prints the same summary, and writes as on Write them.

The approval covers this run only (`between-skills.md`, **Principle**).

**`ready` goes on an issue** when it is open, `--check` passes with the lint clear and the premises clear or not
evaluated yet, and no review finding is left on it: the reviewer's last return lists it as clear, or every finding it
has there is `exact` and the issue printed `#<k> exact fixed`. `ready` stays on an issue that still meets this.
**`ready` comes off** an issue that had it and no longer meets this.

Write in this order. **When a command fails halfway**, stop and tell the user what was written and what was not, with
the numbers.

1. **Re-read `updatedAt`** of every issue about to be written, the parents included, and compare it with the one its
   writer read.

   ```bash
   gh issue view <k> --json updatedAt,body
   ```

   When it moved, someone changed the issue in the meantime. Send the current body to its writer to merge, lint the
   new body, and go on (`between-skills.md`, **Writing to GitHub**).
2. **File what is new.** For a split, file parts 2 to N and keep a map from each part to its number. A stub is filed
   blocking the issue it was found in. Both go under `<P>`.

   ```bash
   gh issue create --parent <P> --title "<title>" --body-file "$TMP/part<k>.md"
   gh issue create --parent <P> --blocking <n> --title "<title>" --body-file "$TMP/stub.md"
   ```

   Each is filed with the title its writer returned. Step 6 gives it its count.

3. **Write the bodies**, with `--title` when the writer's title differs from the one on GitHub with its count
   stripped. Step 6 then adds the count.

   ```bash
   gh issue edit <k> --body-file "$TMP/<k>.md"
   gh issue edit <k> --title "<title>" --body-file "$TMP/<k>.md"
   ```

4. **Change the edges**, one at a time, with the part numbers from step 2.

   **Sub-issue edges** run only between sub-issues of `<P>`. An edge whose other end is not a sub-issue of `<P>` is
   never added. One that already exists is removed, as kind 9 in `roles/review.md` says.

   **Parent edges**, `#<P> blocked by #<Q>`, change only while `parent.baseExists` is false (`format.md`,
   **Projects**). Write only the ones the approval showed. The check before the approval dropped the rest, and the
   report names them with why.

   ```bash
   gh issue edit <a> --add-blocked-by <b>
   gh issue edit <a> --remove-blocked-by <b>
   gh issue edit <P> --add-blocked-by <Q>
   gh issue edit <P> --remove-blocked-by <Q>
   ```

   **After the edges change, run `--order` on `<P>` once.** When it fails, on a cycle or anything else, remove the
   last edge added and say so in the report.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --order
   ```
5. **Close a blocker that needs no code.** Post a marked comment on the stub that points at the rewritten issue,
   then close it.

   ```bash
   gh issue comment <b> --body-file "$TMP/<b>-comment.md"
   gh issue close <b> --reason completed
   ```

6. **The titles.** Run the sync in `between-skills.md` under **Titles** for `<P>`, now that the bodies, the new
   issues and the closed blockers are written. Every issue that gets `ready` in the next step then has a title with
   no count.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P>
   gh issue edit <k> --title "<wantedTitle>"
   ```

7. **The labels.** Make sure `ready` exists with the command in `between-skills.md` under "Labels". Check each issue
   again right before it gets `ready`, because the bodies and the edges just changed.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --check <k>
   gh issue edit <k> --add-label ready
   gh issue edit <k> --add-label ready --remove-label blocker
   ```

   **An issue that carries `blocker` loses it in the same command.** A check that fails now leaves `ready` off, and
   the report names the failures.

   **Whoever takes `ready` off leaves a comment** (`between-skills.md`, **Labels**). It starts with
   `**[pj3-doctor]**` and says what changed and why.

   ```bash
   gh issue edit <k> --remove-label ready
   gh issue comment <k> --body-file "$TMP/<k>-comment.md"
   ```

8. **The run order.** Read it again, now that the edges and the issues have changed, and write `list` under the
   parent's `## Order`, one line per number as `1. #<n>`. Keep the rest of the parent body as it is. Re-read the
   parent's `updatedAt` right before the edit, and work in a change a human made since.

   ```bash
   $DOCTOR/../pj1-plan/scripts/project.sh <P> --order
   gh issue view <P> --json updatedAt,body
   gh issue edit <P> --body-file "$TMP/<P>-order.md"
   ```

   Skip the edit when the list reads the same. Then run `project.sh <P>` and confirm that `parent.orderCheck.ok` is
   true and `missing` is empty.

## Report to the user

- every open sub-issue, one line each, in the new run order: `ready` or not, and when not, why. An issue left
  without `ready` by the second review gives its `design` findings as the reason
- **the decisions left for the user**, one line each, as `<issue URL> D<k> <question>`. This is the
  user's next step: tick them on GitHub, then run `/annetaan:pj3-doctor` again
- the issues filed, the sub-issue and parent edges changed, the blockers closed, the parents rewritten and the
  titles changed
- the parent edges dropped before the approval, each with why
- the `exact` fixes made after the second review, by issue
- the `design` findings left, by issue
- the next step: `/annetaan:pj3-doctor` again only when a decision or a `design` finding is left, never just to put
  `ready` on. `/annetaan:pj4-running` when the first open issue of the run order is `ready`. It works down the
  order and stops at the first issue that is not workable. When `parent.baseExists` is false and a project in
  `parent.waitsOn` is not `merged`, add one sentence: `pj4-running` starts this project after each such `#<Q>` is
  merged into `<from>`.

## Ending an unattended run

An unattended run prints its last line as `between-skills.md` says under **Unattended runs**. Only one ending is
`unattended: done`: the run reached the Report to the user above, including when there was nothing to write.

Every other ending is `unattended: needs-user <one line>`. That covers a **Before you start** failure, a `project.sh`
failure, an `--order` cycle, the phase 2 and phase 3 endings, and a write that fails halfway. An ending not named here
is needs-user too.

## Rules

- **You decide nothing.** The user decides, the reviewer finds, and the writer writes.
- **Never ask a task decision in the conversation.** It goes into the issue as a box to tick.
- **You never write a body yourself**, except the `## Order` list of the parent. Titles you write come from
  `wantedTitle` or from a writer. The writer applies an `exact` fix, and you only compare it.
- **Each writer writes its own issue only. Only you write to GitHub**, and only after the phase 4 approval. Every
  comment you post starts with `**[pj3-doctor]**`.
- **Sub-issue edges stay inside the project.** A parent edge runs only between two parents, only while
  `parent.baseExists` is false, and only after the phase 4 approval. Never an edge between a parent and a sub-issue.
- **Always pass a body with `--body-file`.** Never create a label with `--force`.
- **Re-read `updatedAt` before every edit. Never edit a closed issue.**
- **A sub-issue body goes out only after its lint passes**, and a parent's only after you read it against its shape.
- An unattended run never calls `AskUserQuestion` and ends with one `unattended:` line.
- After a context summary, take `<P>` and whether the run is unattended again from the `project #<P>` line, and rebuild where the run stood from the
  progress lines and `project.sh <P>`. A writer or a reviewer whose handle is gone is started again.
