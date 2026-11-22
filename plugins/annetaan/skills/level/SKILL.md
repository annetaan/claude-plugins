---
name: level
description: Proposes the repository's level, which sets the model and effort that workflow's design, implementation and review and the pj planner, project reviewer and issue writer get. Reads the `Level:` lines of the pull requests merged since the last evaluation and has an evaluator read the code, asks one question with the three levels, then writes `.claude/annetaan-level.md` in a git worktree of its own, commits it on a new branch, pushes it and opens a pull request into the default branch, and leaves its merge to the user. /annetaan:workflow-cleanup removes the worktree and the branch afterwards. Use it only when the user names this skill or invokes /annetaan:level, because it pushes a branch and opens a pull request on GitHub.
---

# level

`level` re-evaluates the repository's level, the one `.claude/annetaan-level.md` on origin's default branch holds.
**The level** in `<skills>/workflow/SKILL.md` says what the level picks. Every workflow run ends its pull request body
with a `Level:` line that records the level it ran at and how its review went. This skill reads those lines from the
pull requests merged since the last evaluation, has an evaluator read the code, and lets the user choose the level.
The choice lands as a pull request that the user merges.

## Paths: `$LEVEL`

**`$LEVEL` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$LEVEL` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for the
user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/workflow/scripts/level.sh` and not `<skills>/level/../workflow/scripts/level.sh`. `<skills>` is `$LEVEL/..`.

This skill uses these files:

- the script `<skills>/workflow/scripts/level.sh`, written `level.sh` below, for `show` and `history`
- the script `<skills>/workflow/scripts/worktree.sh`, written `worktree.sh` below, for `start`, `create`, `ignore` and,
  in **Ending with nothing changed**, `check`
- `<skills>/workflow/worktree.md`, which you read for **The start check**, steps 3 to 5 of **The worktree** and
  **Ending with nothing changed**. `$FLOW` in that file means `<skills>/workflow`
- `<skills>/pj1-plan/between-skills.md`: **Issues in a report**, for how a URL stands in a report
- `$LEVEL/roles/evaluate.md`, the role of the evaluator

**Language**: talk to the user in the user's language. Write the body of the level file, the commit message and the
pull request in the repository's language.

## Before you start

This skill pushes a branch and opens a pull request on GitHub. **Start it only when the user names it or invokes
`/annetaan:level`.**

Run `worktree.sh start` as **The start check** in `<skills>/workflow/worktree.md` says. A `stop` ends the skill. Keep
`main` as `<MAIN>`. Run `mktemp -d` once. Its directory is `$TMP`.

## 1. The current level

```bash
<skills>/workflow/scripts/level.sh show <MAIN>
```

- A null `ref` means origin's default branch could not be read: quote `warning` and stop.
- Otherwise `<base>` is `ref` without `origin/`. Print `level <level> (<source>)` once, and `warning` on a line of its
  own when it is set.

The level is read from origin's default branch and from nowhere else, so this skill takes no branch argument.

## 2. An open pull request

```bash
gh pr list --state open --base <base> --limit 100 --json number,url,headRefName
```

When one has a head that starts with `level-`, give its URL, say that merging or closing it is the user's job and that
either lets this skill run again, and stop.

## 3. The worktree

Run steps 3 to 5 of **The worktree** in `<skills>/workflow/worktree.md` with `<base>`: `worktree.sh create <base>`,
`worktree.sh ignore <name>` with its question, then enter `<WT>`. Print `worktree <WT> base <base>` once.

## 4. The history

```bash
<skills>/workflow/scripts/level.sh history <WT>
```

A `stop` with `gh`: quote `message` and take **Ending with nothing changed** in `<skills>/workflow/worktree.md`.

## 5. The evaluator

First read what each level gives, from the one place that holds it:

```bash
<skills>/workflow/scripts/level.sh show <WT> 1
<skills>/workflow/scripts/level.sh show <WT> 2
<skills>/workflow/scripts/level.sh show <WT> 3
```

```
Agent(subagent_type: "annetaan:level-evaluator", description: "evaluate the level",
      prompt: "Read $LEVEL/roles/evaluate.md first and follow the role it describes.\n\nlevel.sh show:\n<the JSON of step 1>\n\nThe agents at each level:\nLevel 1: <agents of show 1>\nLevel 2: <agents of show 2>\nLevel 3: <agents of show 3>\n\nThe level file now:\n<the output of git show <ref>:.claude/annetaan-level.md, or none>\n\nlevel.sh history:\n<the JSON of step 4>\n\nToday: <YYYY-MM-DD>\n\n<the worktree line>")
```

`<the worktree line>` is **The worktree line** in `<skills>/workflow/SKILL.md`, with the real paths for `<WT>` and
`<MAIN>`. The evaluator runs as its frontmatter says, so the call passes no `model` and no `effort`.

When it cannot start, say why and take **Ending with nothing changed**. There is no fallback, because the evaluation is the
whole skill. Keep the session alive until step 7.

## 6. The question

Show, before you ask:

- the current level, its source and `evaluated`
- `since`, and one line per group of `history`: the level, the source, the runs, the tasks, the send-backs per task
  and the findings per task
- the proposal and its three reasons
- the file `.claude/annetaan-level.md` as it will be written: the front matter with `level`, `evaluated: <today>` and
  `review-by: <today + 90 days>`, and the body
- the branch `level-<stamp>`, where `<stamp>` is `<name>` without `wf-`, and `base: <base>`
- when `git -C <WT> check-ignore -q .claude/annetaan-level.md` exits 0, that the path is ignored in this repository and
  the commit adds it with `git add -f`

```
AskUserQuestion: Which level should this repository run at?
  - Level 1
  - Level 2
  - Level 3
```

The proposed level carries `(Recommended)`. Other means stop: take **Ending with nothing changed**. This is the only
question.

## 7. Write

When the answer differs from the proposal, `SendMessage` the evaluator "the user chose level k" and take its new
`Body:`.

Write `<WT>/.claude/annetaan-level.md`:

```markdown
---
level: <k>
evaluated: <today>
review-by: <today + 90 days>
---
<the body>
```

Claude Code asks before it writes under `.claude/`. That is expected. Then show `git -C <WT> diff --stat`, or
`git -C <WT> status --short` when the file is new.

## 8. Commit and push

```bash
git checkout -b level-<stamp>
git add -- .claude/annetaan-level.md
git commit -m "<subject>"
git push -u origin level-<stamp>
```

Use `git add -f -- .claude/annetaan-level.md` when step 6 found the path ignored. Write the subject in the repository's
commit style, as `git log` shows it. Commit the level file only.

## 9. The pull request

Write the body to `$TMP/pr.md`, in the repository's language: the chosen level and the proposed one, the three
reasons, the groups of `history` as a table, and `since`. No line of it starts with `Level: `, because that prefix
marks a workflow run's record.

```bash
gh pr create --base <base> --title "<subject>" --body-file "$TMP/pr.md"
```

It is not a draft.

When the push or `gh pr create` fails, quote the error. When `gh pr create` exits non-zero, run
`gh pr view level-<stamp> --json url` first and carry on with the URL when one exists, as `workflow/finish.md` does.
Otherwise report that the commit is on the branch in `<WT>`, and that `/annetaan:workflow-cleanup` removes both.

## Report to the user

Leave the worktree first: `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available. Then report:

- the pull request URL, standing between spaces as **Issues in a report** says
- the chosen level, and the proposed one when they differ
- the next steps, in order: merge the pull request, after which the next run of `workflow`, `pj1-plan`,
  `pj2-issues`, `pj3-doctor`, `pj4-running` or `pj-auto` reads the new level from the default branch; then
  `/annetaan:workflow-cleanup <PR number>`, which removes the worktree and the branch

## Rules

- Write the level file only, and never in `<MAIN>`.
- Write nothing before the answer of step 6. A stop from step 3 up to that answer takes **Ending with nothing changed** in
  `<skills>/workflow/worktree.md`, because `<WT>` exists by then. Steps 1 and 2 stop before any worktree exists, and
  need nothing removed.
- Never merge, and never update an open pull request.
- After a context summary, take `<WT>` again from the `worktree` line.
