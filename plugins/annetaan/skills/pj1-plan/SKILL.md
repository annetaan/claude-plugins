---
name: pj1-plan
description: Starts a project on GitHub. Designs a large request in broad strokes, splits it into tasks, has one sub-session per task draw that task in detail and pick out what a human has to decide, groups the tasks into projects of up to 10, and per project files a parent issue labelled `project` and one sub-issue per task, with the decisions as checkboxes the user ticks on GitHub, each option saying what it changes, the dependencies as native blocked-by relationships that may cross projects, and the run order as a numbered list in the parent. Each parent's `Base:` line names its base branch, `pj/<parent number>`, and a branch the user picks, and pj4-running creates the base branch later. The first of three skills, followed by pj3-doctor and pj4-running. Use it only when the user names this skill or invokes /annetaan:pj1-plan, because it creates issues and labels on GitHub. Do not use it for a change small enough for one pull request.
---

# pj1-plan

The first of the three pj skills: it turns a large request into one or more projects, each a parent issue and its
sub-issues.

You are the main session. **You do not write code, and you do not design on your own.** A planner draws the whole,
one issue writer per task draws that task, and you carry their output to the user and onto GitHub.

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

This skill creates issues and labels on GitHub. **Start it only when the user names it or invokes
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
  the plan-level questions, the ones that change the split or a parent's `## Design`. The questions inside one task
  wait for its issue. Send the answers back with `SendMessage`. The revised report carries each answer as a settled
  decision in the `## Decisions` of the parent of the project it belongs to, as `roles/plan.md` assigns it.

**Keep the planner alive until phase 4 ends.** You come back to it when an issue writer says the split does not hold.

## Phase 2: approval

Present the projects and the split, then ask for approval. **Nothing has been written to GitHub yet**, and this is the
last point where changing the split costs nothing.

**Derive the order between projects first.** A task in `PJa` that waits on a task in `PJb` makes `PJa` wait on
`PJb` (`format.md`, **Projects**). Send the plan back to the planner with `SendMessage`, and show the user nothing
yet, when the projects wait on each other in a cycle, a project holds more than 10 tasks, or a task belongs to no
project. Otherwise show and file the projects in an order where each one comes after every project it waits on. Keep
the planner's order when it already is one.

Show:

- the goal of the whole request, in a few lines
- the plan-level decisions the user settled in phase 1, one line each
- each project in that order, as `PJ<j> <title>  (waits on PJ1, PJ2)` and its goal in one line, with its tasks below
  it, one line each, as `T<k> <title>  (after T2, T5)`, followed by the number of decisions the planner already sees
  in that task. A task in another project is named by its `T<k>` as well
- one line saying that each project's base branch `pj/<P>` is created by `pj4-running` on its first start on that
  project, from the tip of the branch picked below, and that a project that waits on others starts once they are all
  merged into that branch. Every sub-issue's pull request merges into its project's base branch. Once every sub-issue
  of a project is closed, `pj4-running` opens the pull request that takes its base branch back, and merging it is the
  user's job
- one line saying every task is cut to 8 files at most, tests included, and every project to 10 tasks at most, the
  size limits in `format.md`
- the label this run will create from `between-skills.md`, `project`, or that the repository already has it and it
  will be reused

Ask both questions in one call.

```
AskUserQuestion:
  1. Create these projects on GitHub?
     - Create it - N projects with M sub-issues
     - Change something first
  2. Which branch do the projects start from?
     - <default> (recommended) - the default branch
     - <current> - the branch checked out here, offered only when there is one and it is another branch
```

"Change something first" goes to the planner with `SendMessage`, and the revised split comes back here. Ask both
questions again then.

The answer to the second question is `<from>`. "Other" takes any branch name. Check that origin has it before
anything else runs, and ask again when it does not:

```bash
git ls-remote --exit-code --heads origin <from>
```

## Phase 3: the issue writers

The writers draw against `<from>` as it stands on origin, because every base branch is cut from it. Fetch it once:

```bash
git fetch --quiet origin "+refs/heads/<from>:refs/remotes/origin/<from>"
git status --porcelain
git rev-parse HEAD origin/<from>
```

When `<from>` is the branch checked out here, the tree is clean and both SHAs match, the writers read the working
tree. Otherwise the writer prompt says to read the code at `origin/<from>`.

**Start one issue writer per task, all in one message**, so they run at the same time. They read the code and write,
and none of them touches GitHub.

```
Agent(subagent_type: "annetaan:pj-issue-writer", description: "issue T<k>",
      prompt: "Read $PLAN/roles/issue.md first and follow the role it describes. The project format is in $PLAN/format.md. Lint a body with $PLAN/scripts/project.sh.\n\nMode: draft\n\nThe request:\n<the user's request, verbatim>\n\nThe overall design:\n<the full report from the planner>\n\nRead the code: <the working tree | at origin/<from>>\n\nYour task: T<k>, \"<title>\", in project PJ<j>.")
```

`annetaan:pj-issue-writer` ships with this plugin and is pinned to opus at high effort with code changes disabled.

Each writer sends back a title and a body in the shape `format.md` gives a sub-issue, or a statement that the split
does not hold.

**When a writer says the split does not hold**, send what it found to the planner with `SendMessage` and have it
redraw the split. Rerun the writers whose tasks changed. A task that only moved to another project counts as
unchanged. Show the user the new split and ask both phase 2 questions again, because nothing has been filed yet and a
new split is a new plan. When `<from>` changes, fetch it as above and rerun every writer.

**Check every body before it goes out.** Write each one to a file as it comes back, and lint it.

```bash
mktemp -d                                    # once, for the whole run
$PLAN/scripts/project.sh --lint "$TMP/T<k>.md"
```

`$TMP` below is the directory `mktemp -d` printed. A shell variable does not outlive one command, so write the path
in full each time.

Accept a body only when the lint reports no reason, or `decisions-open` alone. Then read it for what the lint cannot
see: a file list of 8 entries at most (`format.md`, **The file list**), no line numbers, no checkbox outside
`## Decisions`, no dependencies written into the body, and lines under every option saying what it changes. Send a body that fails back to its writer with `SendMessage`
and say what to fix. Write the fixed body over the same file.

## Phase 4: filing

The sub-issue bodies sit in `$TMP` from phase 3. Write the planner's parent body of each project there too, as
`$TMP/PJ<j>.md`. Then file the parents in the project order from phase 2, and the sub-issues **in dependency order**
across every project, so that every `--blocked-by` names an issue that already exists.

```bash
# 1. make sure the project label exists (between-skills.md, Labels)
# 2. each parent, in project order, with the planner's body for it
gh issue create --label project --title "<project title>" --body-file "$TMP/PJ<j>.md"
# 3. the Base: line on top of that parent's body
{ printf 'Base: `pj/%s` from `%s`\n\n' <P> <from>; cat "$TMP/PJ<j>.md"; } > "$TMP/PJ<j>-base.md"
gh issue edit <P> --body-file "$TMP/PJ<j>-base.md"
# 4. each sub-issue under its project's parent, after the ones it waits on in any project.
#    Leave out --blocked-by when it waits on nothing
gh issue create --parent <P> --blocked-by <n>,<m> --title "<title>" --body-file "$TMP/T<k>.md"
# 5. the run order under each parent, from --order's list, right after the Base: line (format.md, The run order)
$PLAN/scripts/project.sh <P> --order
gh issue edit <P> --body-file "$TMP/PJ<j>-order.md"
# 6. the titles, per parent (between-skills.md, Titles)
$PLAN/scripts/project.sh <P>
gh issue edit <k> --title "<wantedTitle>"
```

Steps 2 and 3 run as a pair for each parent, because the branch name carries the parent's number (`format.md`, **The
parent issue body**). **Every parent has its `Base:` line before step 4 starts**, because `project.sh` reads a
blocker's parent as a project only when its body has one. No branch is created here. Keep the mapping from `PJ<j>`
to the parent's number and from `T<k>` to the issue number as you go, because the next `--blocked-by` and `--parent`
need them.

Step 5 writes `## Order` with one line `1. #<n>` per number in `list`, between the `Base:` line and `## Goal`. No
issue gets `ready` here. Only `pj3-doctor` adds it, after it has reviewed the whole project.

Step 4 files each title as the writer returned it, and step 6 gives each open sub-issue its decision count
(`format.md`, **The title**).

**When a command fails halfway**, stop and tell the user what was filed and what was not, with the numbers, and which
parents have their `Base:` line and their `## Order`, and under which parents step 6 ran. Never retry the whole run,
or the issues double. A parent without the line cannot be read by `project.sh`. A title still missing its count is
fixed by the next `pj3-doctor` run.

Then check the result once per parent, against the split the user approved:

```bash
$PLAN/scripts/project.sh <P>
$PLAN/scripts/project.sh <P> --order
```

The fields are in `$PLAN/state.md` under **Reading a project**. `parent.base` is `pj/<P>`, `parent.from` is
`<from>`, `parent.baseExists` is false, and `parent.orderCheck.ok` is true with `missing` empty. The numbers in
`parent.waitsOn` are the parents of the projects this one waits on in the plan. Every task of the project is there,
its `blockedBy` matches the split, across projects included, with the `parent` of each blocker matching the project
of that task, the decision counts and the lint match the bodies, every sub-issue's `title` equals its
`wantedTitle`, and `--order` finds no cycle of either kind. Report anything that does not match.

## Report to the user

One block per project, in the project order:

- the parent issue URL
- the base branch `pj/<P>` and `<from>`, saying the branch is not created yet
- the parents of the projects it waits on, as `#<P>`
- one line per sub-issue: number, title, the issues it waits on, those in other projects included, as `#<n>`, and the
  open decisions by count

Then the next steps, in this order:

1. `/annetaan:pj3-doctor`, right away. It reviews the whole project against the code and against each issue, has the
   writers fix what does not hold, and labels `ready` what is clear.
2. The user ticks the open decisions on GitHub. Each option says what it changes, so the body is all they need.
3. `/annetaan:pj3-doctor` again, after ticking. It reviews the project with the ticked boxes and labels the issues
   `ready`.
4. `/annetaan:pj4-running`. It works down the parent's `## Order` and stops at the first issue that is not workable.

Both skills ask which project to work on, and a number given to them becomes the recommended first option
(`between-skills.md`, **Picking the project**). The user may reorder `## Order` by hand. `pj4-running` creates a
project's base branch on its first start on that project, and a project that waits on others starts once they are
merged into `<from>`. Once every sub-issue of a project is merged, `pj4-running` opens the pull request from `pj/<P>`
into `<from>`. The user merges it, and the next `pj4-running` closes the parent, or the user closes it.

## Rules

- **You do not design and you do not write issue bodies.** The planner and the issue writers do. A body you write
  yourself never passed through anyone who read the code. The `Base:` line in phase 4 step 3 is the one line you
  add, and you add nothing else. Titles come from the writers and from `wantedTitle` only.
- **Nothing reaches GitHub before the phase 2 approval.** Labels included.
- **You create no branch.** `pj4-running` creates every base branch (`between-skills.md`, **The base branch**).
- **Only you write to GitHub.** The sub-agents only read it, so the order and the numbers stay in one place.
- **Dependencies go into relationships only**, across projects too, and never onto a parent. See `format.md`.
- **Never create a label with `--force`.**
- **Always pass a body with `--body-file`.**
