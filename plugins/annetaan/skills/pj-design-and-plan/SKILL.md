---
name: pj-design-and-plan
description: Starts a project on GitHub. Designs a large request in broad strokes, splits it into tasks, has one sub-session per task draw that task in detail and pick out what a human has to decide, then files a parent issue and one sub-issue per task, with the decisions as checkboxes and the order as native blocked-by relationships, and creates the project's base branch, `pj/<parent number>`, that every sub-issue's pull request merges into. The first of three skills, followed by pj-design-details and pj-running. Use it only when the user names this skill or invokes /annetaan:pj-design-and-plan, because it creates issues and labels on GitHub. Do not use it for a change small enough for one pull request.
---

# pj-design-and-plan

The first of the three pj skills: it turns a large request into a parent issue and its sub-issues.

You are the main session. **You do not write code, and you do not design on your own.** A planner draws the whole,
one issue writer per task draws that task, and you carry their output to the user and onto GitHub.

## Paths: `$PLAN`

**`$PLAN` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$PLAN` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt
for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$PLAN` finds them
nothing.

**Read `$PLAN/format.md` before anything else.** It is the only description of the parent issue, the sub-issue body,
the decisions, the labels and the relationships. Everything below refers to it.

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `format.md`
says.

## Before you start

This skill creates issues and labels on GitHub. **Start it only when the user names it or invokes
`/annetaan:pj-design-and-plan`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.94.0, `gh` not logged in, or
  issues turned off. Say which one and stop.
- Keep the default branch's name for phase 4. Nothing is fetched.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it. The base branch is
  created through the API.

## Phase 1: the overall design

Hand the user's request to the planner as it was written.

```
Agent(subagent_type: "annetaan:pj-planner", description: "project plan",
      prompt: "Read $PLAN/roles/plan.md first and follow the role it describes. The project format is in $PLAN/format.md.\n\nThe request:\n<the user's request, verbatim>")
```

`annetaan:pj-planner` ships with this plugin and is pinned to opus at high effort with code changes disabled.

When the plan comes back:

- **If feasibility is "no" or "conditional"**, hand that to the user and wait.
- **Ask the open questions now**, with `AskUserQuestion`, **four to a call**, in as many calls as it takes. These are
  the plan-level questions, the ones that change the split or the parent's `## Design`. The questions inside one task
  wait for its issue. Send the answers back with `SendMessage`. The revised report carries them as settled decisions
  in the parent's `## Decisions`.

**Keep the planner alive until phase 4 ends.** You come back to it when an issue writer says the split does not hold.

## Phase 2: approval

Present the project and the split, then ask for approval. **Nothing has been written to GitHub yet**, and this is the
last point where changing the split costs nothing.

Show:

- the project title and its goal, in a few lines
- the plan-level decisions the user settled in phase 1, one line each
- the tasks in order, one line each, as `T1 <title>  (after T2, T3)`, followed by the number of decisions the
  planner already sees in that task
- one line saying the base branch `pj/<P>` is created from the tip of `<default>` on GitHub when the project is
  filed. Every sub-issue's pull request merges into it, and merging it into `<default>` is the user's job, outside
  the skills
- one line saying every task is cut to fit the size limit in `format.md`, 8 files at most, tests included
- the labels this run will create, from `format.md`, and the ones the repository already has and will reuse

```
AskUserQuestion: Create this project on GitHub?
  - Create it - a parent issue and N sub-issues
  - Change something first
```

"Change something first" goes to the planner with `SendMessage`, and the revised split comes back here.

## Phase 3: the issue writers

**Start one issue writer per task, all in one message**, so they run at the same time. They read the code and write,
and none of them touches GitHub.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "issue T<k>",
      prompt: "Read $PLAN/roles/issue.md first and follow the role it describes. The project format is in $PLAN/format.md. Lint a body with $PLAN/scripts/project.sh.\n\nMode: draft\n\nThe request:\n<the user's request, verbatim>\n\nThe overall design:\n<the full report from the planner>\n\nYour task: T<k>, \"<title>\".")
```

`annetaan:pj-issue-writer` ships with this plugin and is pinned to opus at high effort with code changes disabled.

Each writer sends back a title and a body in the shape `format.md` gives a sub-issue, or a statement that the split
does not hold.

**When a writer says the split does not hold**, send what it found to the planner with `SendMessage` and have it
redraw the split. Rerun the writers whose tasks changed. Show the user the new split and ask the phase 2 question
again, because nothing has been filed yet and a new split is a new plan.

**Check every body before it goes out.** Write each one to a file as it comes back, and lint it.

```bash
mktemp -d                                    # once, for the whole run
$PLAN/scripts/project.sh --lint "$TMP/T<k>.md"
```

`$TMP` below is the directory `mktemp -d` printed. A shell variable does not outlive one command, so write the path
in full each time.

Accept a body only when the lint reports no reason, or `decisions-open` alone. Then read it for what the lint cannot
see: no line numbers, no checkbox outside `## Decisions`, no dependencies written into the body. Send a body that
fails back to its writer with `SendMessage` and say what to fix. Write the fixed body over the same file.

## Phase 4: filing

The sub-issue bodies sit in `$TMP` from phase 3. Write the planner's parent body there too, then file them **in
dependency order**, so that every `--blocked-by` names an issue that already exists.

```bash
# 1. the parent, with the planner's body
gh issue create --title "<project title>" --body-file "$TMP/parent.md"
# 2. the base branch, at the default branch's tip on GitHub
gh api "repos/{owner}/{repo}/git/ref/heads/<default branch>" --jq .object.sha
gh api "repos/{owner}/{repo}/git/refs" -f ref="refs/heads/pj/<P>" -f sha="<sha>"
# 3. the Base: line on top of the parent body
{ printf 'Base: `pj/%s`\n\n' <P>; cat "$TMP/parent.md"; } > "$TMP/parent-base.md"
gh issue edit <P> --body-file "$TMP/parent-base.md"
# 4. each sub-issue, after the ones it waits on. Leave out --blocked-by when it waits on nothing
gh issue create --parent <P> --blocked-by <n>,<m> --title "<title>" --body-file "$TMP/T<k>.md"
# 5. make sure ready exists (format.md, Labels), then add it to every sub-issue whose lint is clear
gh issue edit <n> --add-label ready
```

The parent takes two steps, because the branch name carries the parent's number (`format.md`, **The parent issue
body**). Keep the mapping from `T<k>` to the issue number as you go, because the next `--blocked-by` needs it. Only a
body whose decisions read `None.` can have a clear lint at this point. Skip step 5 when there is none, so that no
label gets created for nothing.

**When a command fails halfway**, stop and tell the user what was filed and what was not, with the numbers. Never
retry the whole run, or the issues double. Until step 3 has run, the parent has no `Base:` line and `project.sh`
cannot read the project, so say which of steps 1 to 3 went through.

Then check the result once, against the split the user approved:

```bash
$PLAN/scripts/project.sh <P>
$PLAN/scripts/project.sh <P> --order
```

`parent.base` is `pj/<P>`, every task is there, its `blockedBy` matches the split, the decision counts and the lint
match the bodies, and `--order` finds no cycle. Report anything that does not match.

## Report to the user

- the parent issue URL
- the base branch `pj/<P>`
- one line per sub-issue: number, title, the issues it waits on, the open decisions by count, and `ready` or not.
  For a `None.` issue without `ready`, the lint's reason codes
- the next step: `/annetaan:pj-design-details` to settle the decisions, then `/annetaan:pj-running` once issues are
  `ready`. Both ask which project when no number is given. Say that a decision can also be settled by ticking a box
  on GitHub, and that a skill or a human still adds `ready` afterwards. Once every sub-issue is merged, the user
  merges `pj/<P>` into the default branch.

## Rules

- **You do not design and you do not write issue bodies.** The planner and the issue writers do. A body you write
  yourself never passed through anyone who read the code. The `Base:` line in phase 4 step 3 is the one line you
  add, and you add nothing else.
- **Nothing reaches GitHub before the phase 2 approval.** The base branch and labels included.
- **Only you write to GitHub.** The sub-agents only read it, so the order and the numbers stay in one place.
- **Dependencies go into relationships only.** See `format.md`.
- **Never create a label with `--force`.**
- **Always pass a body with `--body-file`.**
