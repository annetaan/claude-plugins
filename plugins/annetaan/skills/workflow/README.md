# workflow

This skill runs one implementation as **design, a design review where the repository accepts breaking changes,
approval, then per task (implement, review rounds, one commit), then an integration review when the plan has more than
one task, then a finish step**, with each role in a session of its own. The review rounds run through Markdown files
in the run's work report directory, one per round and one reply to each, so the whole review stays readable after the
run.

workflow is the plugin's core skill for one implementation. You run it yourself for a change that fits one pull
request. For larger work, pj-3-running runs it once per issue (see [Driven from an issue](#driven-from-an-issue) and
[How the skills fit together](../../README.md#how-the-skills-fit-together)).

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

## Use it

Name the skill, or invoke `/annetaan:workflow`. It never starts on its own. You name it, or pj-3-running runs it for
one issue, because it spawns several sessions and adds commits.

```
/annetaan:workflow add filter conditions to the search form
```

**The design gets one review before you see it.** After the design comes back and before the approval, a separate
session reads it with one question: would we design it this way from a blank slate? It points out boundaries (the
contracts, the types, the names) that fall short of their ideal shape, places where moving existing code would make
the design cleaner, and abstractions that are too many or too few. Each finding says how far existing code moves.
There is one round. The design session takes in what it agrees with, and what it does not agree with comes to you as
open questions before the approval.

**The review runs only where the repository accepts breaking changes**, such as a pre-release project or a library you
control. The skill settles that before design starts: what `CLAUDE.md` or `AGENTS.md` says, then this project's
memory, then a question whose answer it saves to memory. It never edits `CLAUDE.md` or `AGENTS.md`. When one of those
files or memory decides, you get one line saying so before design starts, and that is where you stop a memory that has
gone stale. A request for a minimal change, such as an urgent fix, skips the review and the question, and writes
nothing to memory. When Fable cannot start, because of the weekly limit for example, the review is skipped and the
approval message says so.

There is one approval point. You get the design summary and the **plan**, an ordered list of small tasks, and one
dialog with three questions. The open questions come first, on every run: the design's own, and the design review's
points the design session did not take in, marked `(from the design review)`.

1. Proceed with this design and plan?
2. Where do the commits go? A new branch, or the branch you are on.
3. How does the flow finish? A pull request, a push, or nothing pushed at all.

The options adjust to what the repository can do. No `gh` login and the pull request option disappears. No `origin`
and pushing disappears too. If you already said what you wanted when you invoked the skill ("branch it and open a
PR"), that question is skipped and the answer shows up in the approval message so you can correct it.

After the approval it runs by itself. Each task goes through implementation and review rounds, and a task that
passes review becomes one commit. When the plan has two or more tasks, one integration review over the whole diff
comes after the last task. A plan of one task skips it, because its task review already read the whole diff. Then
comes the ending you picked.

**The approval settles the boundaries. The tasks get detailed one at a time.** What you approve up front is what
crosses from one task into the next: the contracts, the types, the names, and the order things have to land in. The
interior of task 1 comes with it, because task 1 starts from the repository the design session just read. Every task
after that is detailed by the same design session right before it starts, against the code the earlier tasks actually
produced. A plan that turns out to be wrong surfaces there, before anybody writes code against it.

**Five review rounds per task, fixed.** A task that does not settle in five comes back to you with the open points
laid out, and its changes stay uncommitted in the working tree. Saying "stop" partway through the rounds works too.

The implementation and review sessions **start fresh for every task**, and both run on opus at medium effort,
whatever the task. A task boundary is a cheap place to
start over. The code is in git, the plan is with the orchestrator, and every review finding is resolved. What is left
is how this repository wants to be worked in, and that rides along as **handover notes**: five lines from each
session, folded together, capped at fifteen.

## Driven from an issue

pj-3-running works through a project's issues one at a time, and runs each one through this skill. That run has no
design session, no approval and no questions. The issue's text is the approved design, and an issue only gets that
far once it can be implemented as it stands. The issue becomes one task with its review rounds, so no integration
review runs.

The pull request body is `log.md` under a head of `Implements` and `Part of`. The run pushes and opens the pull
request as a draft against the project's base branch. pj-3-running merges it.

All of it happens in the worktree pj-3-running made for the project, so your own working tree is left alone.

A stop before the task is committed leaves the work uncommitted in that worktree and pushes nothing. That work is
the one thing outside GitHub, and the next run redoes it. A stop once the task commit exists can only come during the
finish step, so the run finishes it: the report, the push and the draft pull request. A pull request exists only for
a task commit that passed review. The shape of the issues is in [format.md](../pj-1-plan/format.md), and the shape
of the pull requests in [between-skills.md](../pj-1-plan/between-skills.md).

## What it leaves behind

Every run writes a work report.

```
work-reports/2026-09-19-1346-a1b2c3d/
  log.md         what changed, how it was verified, what the review changed, the screenshots
  changes.diff   the diff from the start commit to HEAD
  review/        one file per review round, and the reply to each
    task-1-round-1.md
    task-1-round-1-reply.md
    integration-round-1.md      plans of two or more tasks
  before.png     before and after, when the change shows on screen
  after.png
```

The directory name is the local time the run started, plus the short SHA of the commit it started from. The newest
run sorts last, so there is never a question about which report is the current one.

**These live inside the repository so that you notice them piling up.** In a temp directory somewhere else they eat
disk where nobody looks. In exchange, the skill checks that `work-reports/` is ignored by git before it writes
anything, and **asks you before it touches `.gitignore`**.

`log.md` has no fixed headings. If the repository has `.github/PULL_REQUEST_TEMPLATE.md`, the report follows it.
Otherwise it follows how recent merged pull requests are written. With nothing to go on, the implementation session
picks a structure. Whatever it picks, the report has to answer what changed, how it was verified with the commands
that were actually run, what the review changed, and which commit answers which task in the plan.

When the ending was a pull request, `log.md` becomes the pull request body. When it was not, `log.md` is what
you read instead. Open it in an editor and the screenshots come with it. `review/` holds how each finding was
raised and answered.

## Screenshots

When the change shows on screen, the run takes screenshots.

- **A new piece of UI**: one shot of the finished state.
- **A change on an existing screen**: **before and after, both.**
- **A change that never reaches a screen**: none.

A before shot cannot be taken after the fact, so the implementation session is told to **shoot the current state
before it touches anything**.

## What you need

- to be inside a `git` repository
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
| `roles/design.md` | the role for the design session, which returns the design and the plan |
| `roles/design-review.md` | the role for the design review session, which pushes the design toward its ideal shape once, before approval |
| `roles/work.md` | the role for the implementation session |
| `roles/review.md` | the role for the review session |
| `review-files.md` | the shape of the review files, read by the review and implementation sessions |

The design, implementation and review sessions run on agents that ship with the plugin (`../../agents/`). Design is
`annetaan:workflow-design` (opus / high). The design review is `annetaan:workflow-design-review` (fable / medium),
once before approval. Implementation is `annetaan:workflow-worker` and review is
`annetaan:workflow-reviewer`, both opus / medium. The full list is in [the plugin README](../../README.md).
