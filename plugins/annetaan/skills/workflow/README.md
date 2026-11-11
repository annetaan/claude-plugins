# workflow

This skill runs one implementation as **design, a design review in every repository (it moves existing code only where breaking changes are welcome),
approval, then per task (implement, review rounds, one commit), then an integration review when the plan has more than
one task, then a finish step**, with each role in a session of its own. The review rounds run through Markdown files
in the run's work report directory, one per round and one reply to each, so the whole review stays readable after the
run. A standalone run works in a worktree of its own under `.claude/worktrees/`, so your own working tree stays free
and may be dirty. It always ends in a pull request.

workflow is the plugin's core skill for one implementation. You run it yourself for a change that fits one pull
request. For larger work, pj4-running runs it once per task of a project (see [Driven from an issue](#driven-from-an-issue) and
[How the skills fit together](../../README.md#how-the-skills-fit-together)).

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

## Use it

Name the skill, or invoke `/annetaan:workflow`. It never starts on its own. You name it, pj4-running runs it for one task of a project, or you ask it to resolve the conflicts of a pull request (see [Conflicts](#conflicts)), because it spawns
several sessions and adds commits.

```
/annetaan:workflow add filter conditions to the search form
```

**The design gets one review before you see it.** After the design comes back and before the approval, a separate
session reads it with one question: would we design it this way from a blank slate? It points out boundaries (the
contracts, the types, the names) that fall short of their ideal shape, places where moving existing code would make
the design cleaner, abstractions that are too many or too few, and behaviour the design keeps from existing code
after the change altered what that behaviour relies on. Each finding says how far existing code moves.
There is one round. The design session takes in what it agrees with, and what it does not agree with comes to you as
open questions before the approval.

**The review runs in every repository.** What differs is how far it may move existing code. The skill settles that
before design starts, in `breaking-changes.md`: what `CLAUDE.md` or `AGENTS.md` says, then the memory Claude Code keeps
for this repository, then a question whose answer it saves to memory. Where breaking changes are accepted, such as a
pre-release product or a library you control, the review reports everything it finds. Where they are not, it reports
only the findings that move no existing code. The skill never edits `CLAUDE.md` or `AGENTS.md`. When one of those
files or memory decides, you get one line saying so before design starts, and that is where you stop a memory that has
gone stale. A request for a minimal change, such as an urgent fix, skips the review and the question, and writes
nothing to memory. When Fable cannot start, because of the weekly limit for example, the review is skipped and the
approval message says so.

There is one approval point. You get the design summary and the **plan**, an ordered list of small tasks, and one
question: proceed with this design and plan? The open questions come first, on every run: the design's own, and the
design review's points the design session did not take in, marked `(from the design review)`.

The approval message names the new branch and `base: <branch>`. Correct either one there. A base corrected at approval
recreates the worktree on the new base and runs the design again. The design review does not run a second time.

The base is the branch your request names, otherwise the repository's default branch. A base that is missing on origin
stops the run. If you want to be asked every time, put a line like this in `CLAUDE.md`:

```
Confirm the base branch with me before every workflow run.
```

With that line, the run asks you to confirm the base every time. It offers the branch named in the request, the
default branch and the branch checked out in your clone.

After the approval it runs by itself. Each task goes through implementation and review rounds, and a task that
passes review becomes one commit. When the plan has two or more tasks, one integration review over the whole diff
comes after the last task. A plan of one task skips it, because its task review already read the whole diff. Then it
pushes the branch and opens a pull request into the base.

**The approval settles the boundaries. The tasks get detailed one at a time.** What you approve up front is what
crosses from one task into the next: the contracts, the types, the names, and the order things have to land in. The
interior of task 1 comes with it, because task 1 starts from the repository the design session just read. Every task
after that is detailed by the same design session right before it starts, against the code the earlier tasks actually
produced. A plan that turns out to be wrong surfaces there, before anybody writes code against it.

**Five review rounds per task, fixed.** A task that does not settle in five comes back to you with the open points
laid out, and its changes stay uncommitted in the run's worktree. Saying "stop" partway through the rounds works too.

The implementation and review sessions **start fresh for every task**, implementation on sonnet and review on opus,
both at medium effort, whatever the task. A task boundary is a cheap place to
start over. The code is in git, the plan is with the orchestrator, and every review finding is resolved. What is left
is how this repository wants to be worked in, and that rides along as **handover notes**: five lines from each
session, folded together, capped at fifteen.

## Driven from an issue

pj4-running works through a project's tasks one at a time, one sub-issue each, and runs each one through this skill. That run has no
design session, no approval and no questions. The issue's text is the approved design, and an issue only gets that
far once it can be implemented as it stands. The issue becomes one task with its review rounds, so no integration
review runs.

The pull request body is `log.md` under a head of `Implements` and `Part of`. The run pushes and opens the pull
request as a draft against the project's base branch. pj4-running merges it.

All of it happens in the worktree pj4-running made for the project, so your own working tree is left alone.

A stop before the task is committed pushes nothing. pj4-running saves the work to `stopped.diff` in the run's work
report and cleans the worktree. The next run redoes it. A stop once the task commit exists can only come during the
finish step, so the run finishes it: the report, the push and the draft pull request. A pull request exists only for
a task commit that passed review. The shape of the issues is in [format.md](../pj1-plan/format.md), and the shape
of the pull requests in [between-skills.md](../pj1-plan/between-skills.md).

Once every sub-issue of a project is closed, pj4-running merges the branch the project came from into the project's
branch before it opens the project's pull request. When that merge stops on conflicts, pj4-running runs this skill
once more, as one task that resolves them with its review rounds. Its commit is the merge commit, and pj4-running
pushes it. A stop before that commit leaves the merge in progress in the worktree, and the next run redoes it.

## Conflicts

**When the pull request would conflict from the start**, the finish step settles it before the push. The base may have
moved while the tasks ran. When the branch merges into it cleanly, nothing happens and GitHub merges it later. When it
conflicts, the run merges the base into the branch and resolves the conflicts as one more task, with a new
implementation session and a new review session and the same five-round cap, and its commit is the merge commit. The
review rounds are `merge-round-<r>.md` in the work report.

**When an open pull request conflicts later**, ask for it in plain words, such as "resolve the conflicts on #12" or
"コンフリクト解消して". That request starts this skill, and it asks no approval. A new worktree takes the pull request's
branch, the same merge task resolves the conflicts under review, the merge commit is pushed to the branch as a
fast-forward, and the worktree is removed, with its review files moved into your clone's `work-reports/`. With no
number named, it takes the one conflicting pull request of yours that GitHub reports, or asks which. A project's pull
request from `pj/<n>` goes to `pj4-running`, which brings the source branch into the project's branch again.

## The worktree and cleaning up

The run creates `.claude/worktrees/wf-<stamp>` on the tip of the base before the design starts, and never touches your
clone. The worktree has none of your clone's ignored files, such as dependencies and `.env`. The first worker prepares
them. A run that ends before approval removes its worktree. Every other run leaves it, whether it opened a pull request
or stopped midway.

After you merge or close the pull request, `/annetaan:workflow-cleanup` moves the work report into `work-reports/` in
your clone, removes the worktree and the branch, fast-forwards your local base after a merge, and deletes the reports there that are 14 days old or more. Details are in
[workflow-cleanup](../workflow-cleanup/SKILL.md).

```
/annetaan:workflow-cleanup 57
```

## What it leaves behind

Every run writes a work report. It lives under the worktree's `work-reports/` until the cleanup.

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

**These live inside the repository so that you see them.** A cleanup deletes the ones that have sat in your clone's
`work-reports/` for 14 days. In a temp directory somewhere else they eat
disk where nobody looks. In exchange, the skill checks that `.claude/worktrees/` and `work-reports/` are
ignored by git before it writes anything, and asks before adding them to `.git/info/exclude`. That file stays in your
clone, so nothing is committed and `.gitignore` is never edited.

`log.md` has no fixed headings. If the repository has `.github/PULL_REQUEST_TEMPLATE.md`, the report follows it.
Otherwise it follows how recent merged pull requests are written. With nothing to go on, the implementation session
picks a structure. Whatever it picks, the report has to answer what changed, how it was verified with the commands
that were actually run, what the review changed, and which commit answers which task in the plan.

`log.md` becomes the pull request body. `review/` holds how each finding was
raised and answered.

## Screenshots

When the change shows on screen, the run takes screenshots.

- **A new piece of UI**: one shot of the finished state.
- **A change on an existing screen**: **before and after, both.**
- **A change that never reaches a screen**: none.

A before shot cannot be taken after the fact, so the implementation session is told to **shoot the current state
before it touches anything**.

## What you need

- to be inside a `git` repository with an `origin` remote on GitHub
- `gh`, logged in, because every run ends in a pull request
- your working tree may be dirty

`gh pr create --attach` uploads the screenshots into the pull request body. That flag landed in **gh 2.99.0**, on
2026-09-01. An older `gh` still opens the pull request, and the run then hands you the file paths and the pull
request URL and asks you to drag the images in. It also suggests `brew upgrade gh`, once, and only when there were
screenshots it could not attach.

## What is in here

| File | What it is |
| --- | --- |
| `SKILL.md` | the procedure for the orchestrator, which is the main session: which file each entry reads, the worktree line, the agents, phases 2 to 4 and the rules every entry shares |
| `standalone.md` | the standalone run: design, the design review and approval, the integration review and the finish |
| `breaking-changes.md` | the check that settles whether the repository accepts breaking changes, for the standalone run and pj1-plan |
| `from-pr.md` | resolving the conflicts of a pull request that is already open |
| `from-issue.md` | one sub-issue as one task, for pj4-running |
| `from-sync.md` | a merge of the source branch into a project's base branch that stopped on conflicts, for pj4-running |
| `merge-task.md` | the merge task, which resolves conflicts under review, for the standalone finish, from-pr and from-sync |
| `worktree.md` | the start check and the run's worktree, for the standalone run and from-pr |
| `finish.md` | the work report and the pull request, for the standalone run and from-issue |
| `roles/design.md` | the role for the design session, which returns the design and the plan |
| `roles/design-review.md` | the role for the design review session, which pushes the design toward its ideal shape once, before approval |
| `roles/work.md` | the role for the implementation session |
| `roles/review.md` | the role for the review session |
| `scripts/worktree.sh` | creates the run's worktree and checks its ignore rules. `workflow-cleanup` uses it to clean up |
| `review-files.md` | the shape of the review files, read by the review and implementation sessions |

The design, implementation and review sessions run on agents that ship with the plugin (`../../agents/`). Design is
`annetaan:workflow-design` (opus / medium). The design review is `annetaan:workflow-design-review` (fable / medium),
once before approval. Implementation is `annetaan:workflow-worker` (sonnet / medium) and review is
`annetaan:workflow-reviewer` (opus / medium). The full list is in [the plugin README](../../README.md).
