---
name: pj1-plan
description: Starts a project on GitHub. Has a planner design a large request in broad strokes and cut it into projects aimed at 7 to 8 tasks each, 10 at most, asks the plan-level questions, and shows the projects in stages, where the projects of one stage can run in parallel. Per project files a parent issue labelled `project` that holds its Goal, Design, Decisions and Out of scope, with the dependencies between projects as native blocked-by relationships between the parents. Each parent's `Base:` line names its base branch, `pj/<parent number>`, and a branch the user picks, and pj4-running creates the base branch later. Files no sub-issue. pj2-issues splits a project into tasks once every project it waits on is merged. The first of four skills, followed by pj2-issues, pj3-doctor and pj4-running. Use it only when the user names this skill or invokes /annetaan:pj1-plan, because it creates issues, relationships and labels on GitHub. Do not use it for a change small enough for one pull request.
---

# pj1-plan

The first of the four pj skills: it turns a large request into one or more projects, each a parent issue, with the
dependencies between them. `pj2-issues` splits each project into sub-issues later.

You are the main session. **You do not write code, and you do not design on your own.** A planner draws the whole,
and you carry its output to the user and onto GitHub. No issue writer runs in this skill.

## Paths: `$PLAN`

**`$PLAN` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$PLAN` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a prompt
for a sub-agent. Sub-agents have not read this instruction, so a relative path or a literal `$PLAN` finds them
nothing.

**Read `$PLAN/format.md` and `$PLAN/between-skills.md` before anything else.** `format.md` is the only description
of the parent issue, the sub-issue body, the decisions and the relationships. `between-skills.md` holds the labels,
the base branch and picking the project. Everything below refers to them.

**Language**: talk to the user in the user's language. Write issue text in the repository's language, as `format.md`
says.

## Before you start

This skill creates issues, relationships and labels on GitHub. **Start it only when the user names it or invokes
`/annetaan:pj1-plan`.**

```bash
git rev-parse --show-toplevel
gh --version          # 2.94.0 or later
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
git branch --show-current
```

- **Any of these failing stops the skill**: not a git repository, `gh` older than 2.94.0, `gh` not logged in, or
  issues turned off. Say which one and stop.
- Keep the default branch's name and the current branch's name for phase 2. A detached HEAD prints no current
  branch.
- A dirty working tree does not matter. This skill reads the code and changes nothing in it. It creates no branch
  either: `pj4-running` creates each project's base branch (`between-skills.md`, **The base branch**).

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
  the plan-level questions, the ones that change the cut into projects, an edge between projects, or a parent's
  `## Design`. The questions that split a project into tasks wait for `pj2-issues`. Send the answers back with
  `SendMessage`. The revised report carries each answer as a settled decision in the `## Decisions` of the parent of
  the project it belongs to, as `roles/plan.md` assigns it.

**Keep the planner alive until phase 3 ends.**

## Phase 2: approval

Present the projects and the edges between them, then ask for approval. **Nothing has been written to GitHub yet**,
and this is the last point where changing the cut costs nothing.

**Work out the stages first.** A project that waits on nothing is in stage 1. Every other project is one stage after
the highest stage among the projects it waits on. Send the plan back to the planner with `SendMessage`, and show the
user nothing yet, when the projects wait on each other in a cycle, a project is estimated at more than 10 tasks, or an
edge names a project that is not in the plan. Otherwise show and file the projects by stage, and by `PJ` id within a
stage. That is the file order below.

Show:

- the goal of the whole request, in a few lines
- the plan-level decisions the user settled in phase 1, one line each
- each project as `PJ<j> <title>  (about N tasks)` and its goal in one line
- the stages, in this shape, each edge with the planner's reason:

  ```
  Stage 1 (parallel): PJ1 Retry settings / PJ3 Logging cleanup
  Stage 2: PJ2 Admin screen  (waits on PJ1 — needs RetrySettings)
  Stage 3: PJ4 ...           (waits on PJ2, PJ3 — conflict: src/worker/)
  ```

  and one line saying that the reasons stay in this conversation. Only the relationship between the parents is
  filed
- one line saying that each project's base branch `pj/<P>` is created by `pj4-running` on its first start on that
  project, from the tip of the branch picked below, and that `pj2-issues` splits a project into tasks only once every
  project it waits on is merged into that branch. Once every sub-issue of a project is closed, `pj4-running` opens
  the pull request that takes its base branch back, and merging it is the user's job
- one line saying every project is aimed at 7 to 8 tasks and holds 10 at most, and that `pj2-issues` cuts every task
  to 8 files at most, tests included, the size limits in `format.md`
- the label this run will create from `between-skills.md`, `project`, or that the repository already has it and it
  will be reused

Ask both questions in one call.

```
AskUserQuestion:
  1. Create these projects on GitHub?
     - Create them - N projects
     - Change something first
  2. Which branch do the projects start from?
     - <default> (recommended) - the default branch
     - <current> - the branch checked out here, offered only when there is one and it is another branch
```

"Change something first" goes to the planner with `SendMessage`, and the revised plan comes back here. Ask both
questions again then.

The answer to the second question is `<from>`. "Other" takes any branch name. Check that origin has it before
anything else runs, and ask again when it does not:

```bash
git ls-remote --exit-code --heads origin <from>
```

## Phase 3: filing

Run `mktemp -d` once. `$TMP` below is the directory it printed. A shell variable does not outlive one command, so
write the path in full each time. Write the planner's parent body of each project there as `$TMP/PJ<j>.md`. Then
file the parents in the file order from phase 2.

```bash
# 1. make sure the project label exists (between-skills.md, Labels)
# 2. each parent, in file order, with the planner's body for it.
#    --blocked-by names the parents of the projects it waits on. Leave it out when it waits on nothing
gh issue create --label project --blocked-by <Q>,<R> --title "<project title>" --body-file "$TMP/PJ<j>.md"
# 3. the Base: line on top of that parent's body
{ printf 'Base: `pj/%s` from `%s`\n\n' <P> <from>; cat "$TMP/PJ<j>.md"; } > "$TMP/PJ<j>-base.md"
gh issue edit <P> --body-file "$TMP/PJ<j>-base.md"
```

Steps 2 and 3 run as a pair for each parent, because the branch name carries the parent's number (`format.md`, **The
parent issue body**). **Every parent a project waits on is filed, with its `Base:` line, before that project.**
`project.sh` reads a blocker of a parent as a project only when its body has the line, and fails with
`is blocked by #<X>, which is no project` otherwise. No branch is created here. Keep the mapping from `PJ<j>` to the
parent's number as you go, because the next `--blocked-by` needs it.

No issue gets `ready` here, and no title carries a count. A parent's title never does.

**When a command fails halfway**, stop and tell the user what was filed and what was not, with the numbers, which
parents have their `Base:` line, and which relationships were added. Never retry the whole run, or the issues double.
A parent without the line cannot be read by `project.sh`.

Then check the result once per parent, against the plan the user approved:

```bash
$PLAN/scripts/project.sh <P>
$PLAN/scripts/project.sh <P> --order
```

The fields are in `$PLAN/state.md` under **Reading a project**. `parent.base` is `pj/<P>`, `parent.from` is
`<from>`, `parent.baseExists` is false, and `issues` is `[]`. The numbers in `parent.waitsOn` are the parents of the
projects this one waits on in the plan. `parent.startable` is true exactly for the projects of stage 1. `--order`
succeeds and prints empty lists. Report anything that does not match.

## Report to the user

One block per project, in the file order:

- the parent issue URL
- the base branch `pj/<P>` and `<from>`, saying the branch is not created yet
- the parents of the projects it waits on, as `#<Q>`

Then the stages again, with issue numbers in place of the `PJ` ids.

Then the next steps, in this order:

1. `/annetaan:pj2-issues`. It recommends the lowest-numbered project that can start. The projects of stage 1 can go
   in any order.
2. Per project, once `pj2-issues` has filed its sub-issues: `/annetaan:pj3-doctor`, then the user ticks the open
   decisions on GitHub, then `/annetaan:pj3-doctor` again, then `/annetaan:pj4-running`.
3. Once a project's pull request into `<from>` is merged, the next `pj4-running` on it closes the parent and names
   the projects that can start now, as `/annetaan:pj2-issues <P>`.

## Rules

- **You do not design and you do not write issue bodies.** The planner does. A body you write yourself never passed
  through anyone who read the code. The `Base:` line in phase 3 step 3 is the one line you add, and you add nothing
  else.
- **Nothing reaches GitHub before the phase 2 approval.** Labels included.
- **You create no branch.** `pj4-running` creates every base branch (`between-skills.md`, **The base branch**).
- **You file no sub-issue.** `pj2-issues` splits each project.
- **Only you write to GitHub.** The planner only reads it, so the order and the numbers stay in one place.
- **Dependencies between projects go into blocked-by between the parents only**, never into a body. See
  `format.md`.
- **Never create a label with `--force`.**
- **Always pass a body with `--body-file`.**
