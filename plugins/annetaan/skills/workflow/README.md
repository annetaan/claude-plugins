# workflow

This skill runs one implementation as **design, approval, then per task (implement, review rounds, one commit),
then an integration review, then a finish step**, with each role in a session of its own. The review rounds happen
in [difit](https://github.com/yoshiko-pg/difit) comment threads. Open the same server in a browser and you write
into the same threads the agents do.

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

## Use it

Name the skill, or invoke `/annetaan:workflow`. It never starts on its own, because it runs a local server for as
long as the flow lasts, opens a browser, and adds commits.

```
/annetaan:workflow add filter conditions to the search form
```

There is one approval point. You get the design summary and the **plan**, an ordered list of small tasks, and one
dialog with three questions.

1. Proceed with this design and plan?
2. Where do the commits go? A new branch, or the branch you are on.
3. How does the flow finish? A pull request, a push, or nothing pushed at all.

The options adjust to what the repository can do. No `gh` login and the pull request option disappears. No `origin`
and pushing disappears too. If you already said what you wanted when you invoked the skill ("branch it and open a
PR"), that question is skipped and the answer shows up in the approval message so you can correct it.

After the approval it runs by itself. Each task goes through implementation and review rounds, and a task that
passes review becomes one commit. After the last task comes one integration review over the whole diff, then the
ending you picked.

**The approval settles the boundaries. The tasks get detailed one at a time.** What you approve up front is what
crosses from one task into the next: the contracts, the types, the names, and the order things have to land in. The
interior of task 1 comes with it, because task 1 starts from the repository the design session just read. Every task
after that is detailed by the same design session right before it starts, against the code the earlier tasks actually
produced. A plan that turns out to be wrong surfaces there, before anybody writes code against it.

**Five review rounds per task, fixed.** A task that does not settle in five comes back to you with the open points
laid out, and its changes stay uncommitted in the working tree. Saying "stop" partway through the rounds works too.

The implementation and review sessions **start fresh for every task**, on the agent for that task's complexity,
which is the number of files the task touches (1 to 5, 6 to 10, 11 or more). A task boundary is a cheap place to
start over. The code is in git, the plan is with the orchestrator, and every review thread is resolved. What is left
is how this repository wants to be worked in, and that rides along as **handover notes**: five lines from each
session, folded together, capped at fifteen. The integration review takes the highest complexity in the plan, because
it reads the whole change at once.

## What it leaves behind

Every run writes a work report.

```
work-reports/2026-09-19-1346-a1b2c3d/
  report.md      what changed, how it was verified, what the review changed, the screenshots
  changes.diff   the diff from the start commit to HEAD
  before.png     before and after, when the change shows on screen
  after.png
```

The directory name is the local time the run started, plus the short SHA of the commit it started from. The newest
run sorts last, so there is never a question about which report is the current one.

**These live inside the repository so that you notice them piling up.** In a temp directory somewhere else they eat
disk where nobody looks. In exchange, the skill checks that `work-reports/` is ignored by git before it writes
anything, and **asks you before it touches `.gitignore`**.

`report.md` has no fixed headings. If the repository has `.github/PULL_REQUEST_TEMPLATE.md`, the report follows it.
Otherwise it follows how recent merged pull requests are written. With nothing to go on, the implementation session
picks a structure. Whatever it picks, the report has to answer what changed, how it was verified with the commands
that were actually run, what the review changed, and which commit answers which task in the plan.

When the ending was a pull request, `report.md` becomes the pull request body. When it was not, `report.md` is what
you read instead. Open it in an editor and the screenshots come with it. To look at the diff interactively again,
`difit-session.sh start . <start commit>` brings difit back.

## Screenshots

When the change shows on screen, the run takes screenshots.

- **A new piece of UI**: one shot of the finished state.
- **A change on an existing screen**: **before and after, both.**
- **A change that never reaches a screen**: none.

A before shot cannot be taken after the fact, so the implementation session is told to **shoot the current state
before it touches anything**.

## What you need

- to be inside a `git` repository
- `difit`, which falls back to `npx difit` when it is missing
- a clean working tree
- `gh`, for the pull request ending only

`gh pr create --attach` uploads the screenshots into the pull request body. That flag landed in **gh 2.99.0**, on
2026-09-01. An older `gh` still opens the pull request, and the run then hands you the file paths and the pull
request URL and asks you to drag the images in. It also suggests `brew upgrade gh`, once, and only when there were
screenshots it could not attach.

## What is in here

| File | What it is |
| --- | --- |
| `SKILL.md` | the procedure for the orchestrator, which is the main session |
| `roles/design.md` | the role for the design session, which returns the plan and the complexity |
| `roles/work.md` | the role for the implementation session |
| `roles/review.md` | the role for the review session |
| `scripts/difit-session.sh` | keeps exactly one difit server per repository |

The design, implementation and review sessions run on agents that ship with the plugin (`../../agents/`). Design is
`annetaan:workflow-design` (fable / medium), with `annetaan:workflow-design-fallback` (opus / xhigh) for
environments where Fable is unavailable. The **complexity of 1, 2 or 3** that the design returns picks
`annetaan:workflow-worker-1` through `-3` for implementation and `annetaan:workflow-reviewer-1` through `-3` for
review. The full list is in [the plugin README](../../README.md).

`difit-session.sh` works on its own too.

```
difit-session.sh start <target-ref> <base-ref> [port]   # target "." compares the working tree against base
difit-session.sh refresh          # pin the diff to the current state, carrying unresolved threads over
difit-session.sh comments         # read unresolved threads as JSON
difit-session.sh add --as <review|work> '<json>'   # post a comment or a reply
difit-session.sh resolve <id...>
difit-session.sh open | url | port | status | stop
```

State goes in `$(git rev-parse --git-dir)/annetaan-workflow.json`, which leaves the working tree alone.
