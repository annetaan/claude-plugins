---
name: pj-roadmap
description: Brings the repository's roadmap file under the pj skills. Checks it against the roadmap format with project.sh --roadmap on the branch the user picks, and rewrites it so that each initiative is one `## ` section with a unique heading, changing the structure and keeping every sentence, when it does not match, or when it matches but holds no `## ` section per initiative and the user asks for a regroup. It does nothing when the file is in the format and the user confirms its sections are the initiatives. Works in a git worktree of its own, asks one approval question, then commits the rewrite on a new branch, pushes it and opens a pull request into that branch, and leaves its merge to the user. /annetaan:workflow-cleanup removes the worktree and the branch afterwards. Use it only when the user names this skill or invokes /annetaan:pj-roadmap, because it pushes a branch and opens a pull request on GitHub.
---

# pj-roadmap

`pj-roadmap` is not one of the four pj skills. It runs on a repository whose roadmap file is not in the format the pj
skills read (`format.md`, **The roadmap file**). It rewrites that one file so that each initiative is one `## ` section,
on a branch of its own, and opens a pull request that the user merges. After the merge, `/annetaan:pj1-plan` can take an
entry by its heading.

**You change the structure of the file and keep every sentence.** The script `project.sh --roadmap` is the only judge of
the format.

## Paths: `$ROADMAP`

**`$ROADMAP` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$ROADMAP` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for
the user. Collapse the `..` in a path to a sibling skill, so that the command text names
`<skills>/pj1-plan/scripts/project.sh` and not `<skills>/pj-roadmap/../pj1-plan/scripts/project.sh`. `<skills>` is
`$ROADMAP/..`.

This skill uses these files:

- the script `<skills>/pj1-plan/scripts/project.sh`, written `project.sh` below, for `--roadmap`, and with `<P>` to read an open parent's `Roadmap:` line
- the script `<skills>/workflow/scripts/worktree.sh`, written `worktree.sh` below, for `start`, `create`, `ignore` and, in **Ending before approval**, `check`
- `<skills>/workflow/worktree.md`, which you read for **The start check**, steps 3 to 5 of **The worktree** and
  **Ending before approval**. `$FLOW` in that file means `<skills>/workflow`
- `<skills>/pj1-plan/format.md`: **The roadmap file** and **Writing bodies**
- `<skills>/pj1-plan/between-skills.md`: **Issues in a report**, for how a URL stands in a report

**Language**: talk to the user in the user's language. The roadmap keeps its own language. Write the commit message and
the pull request in the repository's language.

## Before you start

This skill pushes a branch and opens a pull request on GitHub. **Start it only when the user names it or invokes
`/annetaan:pj-roadmap`.**

Run `worktree.sh start` as **The start check** in `<skills>/workflow/worktree.md` says. A `stop` ends the skill, and so
does a null `defaultBranch` when no branch was named. Keep `main` as `<MAIN>`. Run `mktemp -d` once. Its directory is
`$TMP`.

## 1. The base

The base is the branch the arguments name. Otherwise ask once.

```
AskUserQuestion: Which branch holds the roadmap?
  - <defaultBranch> (Recommended)
  - <mainBranch>   (only when it is another branch)
```

Other takes any branch name. Say that the pull request goes into `<base>` and that projects start from it.

## 2. The check

```bash
git fetch --quiet origin "+refs/heads/<base>:refs/remotes/origin/<base>"
<skills>/pj1-plan/scripts/project.sh --roadmap origin/<base>
```

A failed fetch means origin has no `<base>`: say so and stop. Otherwise act on the JSON.

- `ok` true: the script checks syntax only, so read the file with `git show origin/<base>:<path>` and look at two
  cases. (a) `entries` is empty and the preamble has body text beyond a title. (b) An entry holds `###` headings. When
  neither holds, say that the roadmap is in the format, list the headings in `entries`, and stop. When one does, say
  which, and ask once.

  ```
  AskUserQuestion: The roadmap passes the check, but it may not hold one initiative per `## ` section. What is it?
    - Already as intended: every `## ` section is one initiative
    - Regroup it so that each initiative is one `## ` section
  ```

  The first answer ends the skill as `ok` does. The second goes on to step 3 with `path` and no `reasons`.
- A reason `no-file`: say that there is no roadmap file, that it goes at one of the six paths of `format.md`, **The
  roadmap file**, and what the format asks. Stop.
- A reason `several-files`: name `files`, say that exactly one may stay, and stop. Which one to keep is the user's
  decision.
- Anything else: go on, keeping `path` and `reasons`.

## 3. An open pull request

```bash
gh pr list --state open --base <base> --limit 100 --json number,url,headRefName
```

When one has a head that starts with `pj-roadmap-`, give its URL, say that merging it is the user's job and that
closing it lets this skill run again, and stop.

## 4. The worktree

Run steps 3 to 5 of **The worktree** in `<skills>/workflow/worktree.md` with `<base>`: `worktree.sh create <base>`,
`worktree.sh ignore <name>` with its question, then enter `<WT>`. Print `worktree <WT> base <base>` once.

## 5. The rewrite

Draw it, do not write it yet. Read `<WT>/<path>` whole. Work out the entries and where every piece goes.

- First find the headings that open parents name. List the open parents with
  `gh issue list --state open --label project --limit 200 --json number`, run `project.sh <P>` on each, and collect
  every `parent.roadmap.entry` whose `path` is this file. Those headings are **named**. A named heading keeps its text
  and its place as one entry: it is never dissolved and never renamed, whatever the rules below say. Show each in the
  approval as kept because `#<P>` names it. A named `## ` heading that holds `###` headings stays one entry with them
  inside. When `project.sh <P>` fails on a parent, quote its error and stop, taking **Ending before approval**: that
  parent may name a heading, and skipping it could dissolve the heading.
- Change the structure only. Every sentence stays, in an entry or in the preamble.
- What a grouping said, such as a `## Later` over `###` items, becomes a line in each entry that was under it.
- A `## ` heading that stays one initiative keeps its text, unless it is a duplicate. A `## ` heading over `###`
  initiatives is a grouping, and the rule above dissolves it, unless it is named.
- A duplicate heading: ask what each of them should be called, with `AskUserQuestion`. A named one keeps its text, and
  only the other is asked about. When two duplicates are both named, say so and stop, taking **Ending before approval**: one of
  the parents has to change.
- A leading front matter block stays where it is.

## 6. The approval

Show the entries in order, each with where it came from. Show what goes to the preamble and anything you could not
place. Show the branch `pj-roadmap-<stamp>` and `base: <base>`, where `<stamp>` is `<name>` without `wf-`.

```
AskUserQuestion: Rewrite the roadmap and open the pull request?
  - Rewrite it and open the pull request
  - Change something first
  - Stop
```

`Change something first`: redraw and ask again. `Stop`: take **Ending before approval** in
`<skills>/workflow/worktree.md`.

## 7. Write and check

Write the file in `<WT>`. Run `project.sh --roadmap` there, with no ref, and fix the file until `ok` is true. Show
`git diff --stat -- <path>`.

## 8. Commit and push

```bash
git checkout -b pj-roadmap-<stamp>
git add -- <path>
git commit -m "<subject>"
git push -u origin pj-roadmap-<stamp>
```

Write the subject in the repository's commit style, as `git log` shows it. Commit the roadmap file only.

## 9. The pull request

Write the body to `$TMP/pr.md`, in the repository's language: what the format asks, the entries in order, what moved
where, and that no sentence was dropped.

```bash
gh pr create --base <base> --title "<subject>" --body-file "$TMP/pr.md"
```

It is not a draft.

When the push or `gh pr create` fails, quote the error. When `gh pr create` exits non-zero, run
`gh pr view pj-roadmap-<stamp> --json url` first and carry on with the URL when one exists, as `workflow/finish.md`
does. Otherwise report that the commit is on the branch in `<WT>`, and that `/annetaan:workflow-cleanup` removes both.

## Report to the user

Leave the worktree first: `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available. Then report:

- the pull request URL, standing between spaces as **Issues in a report** says
- `<WT>` and the rewritten entries, in order
- the next steps, in order: merge the pull request; `/annetaan:workflow-cleanup <PR number>`, which removes the
  worktree and the branch and fast-forwards the local `<base>`; then `/annetaan:pj1-plan` with an entry's heading

## Rules

- Change the roadmap file only, and never in `<MAIN>`.
- Write nothing before the approval of step 6.
- A stop from step 5 to the approval of step 6 takes **Ending before approval** in `<skills>/workflow/worktree.md`,
  because `<WT>` exists by then. Steps 1 to 3 stop before any worktree exists, and need nothing removed.
- Never merge, and never update an open pull request.
- Never drop a sentence.
- Start no sub-agent.
- After a context summary, take `<WT>` again from the `worktree` line.
