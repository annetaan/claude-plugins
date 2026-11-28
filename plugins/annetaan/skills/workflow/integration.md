# The integration review

> `$FLOW` in this file is the directory it is in, `<skills>/workflow`, written out as **Paths: `$FLOW`** in `SKILL.md` says.

## The integration review

**It runs only when the plan has two or more tasks.** With one task, the task review already read the working
tree against HEAD, and HEAD was still `START`. That is the same diff this review would read, and there is no task boundary
to look at. Count the tasks in the plan as it stands when its last task is committed. A redraw under **When the plan breaks** in `loop.md`
changes the count. With one task, a redraw can happen only while task 1 is in flight. When it grows the plan
to several tasks, task 1's **Commit** in `loop.md` ends its sessions as usual and the integration review runs after the new last task. When it leaves
one task, it does not run. Once two tasks are committed, it runs. When a redraw leaves no task to run after
task 1 is committed, it runs too, because task 1's **Commit** has already ended its sessions.

Once every task is committed, **review the whole diff once.** A review inside a task cannot see the task boundaries: interfaces that do not line up, a rename done on one side only, work duplicated between tasks.

The target is the working tree against `START` (`git diff <START>` plus untracked files), which is every commit put
together. The working tree should be empty at this point. Fixes from the integration review land uncommitted in the
working tree, so later rounds see them in the same diff.

**The integration review starts new seats**, model and effort included, with the steps of **Review** in `loop.md`: every seat in one message, `flow.sh verify`, the judgement, `flow.sh round`. `<scope>` is `integration`, so the files are `integration-round-<r>-<seat>.md` and `integration-round-<r>.md`. Each seat's prompt is `$FLOW/scripts/flow.sh prompt <WT> seat integration <seat>`. It names `<WORKDIR>/design.md`, `<WORKDIR>/plan.md` and `<WORKDIR>/notes.md` and no detail file, carries the commit that closed each task as the progress, and asks for **the boundaries** between the tasks and, in round 1, for the walk of every acceptance criterion and every flow under `## Walk`, since no evidence file exists before round 1. A restart from round 2 on (**When no seat reports** under **Review** in `loop.md`) leaves the walk out, because the lint allows `## Walk` only in round 1.

**`changes-requested` starts a new implementation session as well**, with `$FLOW/scripts/flow.sh prompt <WT> work integration` and its `Agent` call. That prompt names the same files, carries every task as the progress, and asks for the answer to the round file just written, and each reply that changes code comes with `integration-round-<r>-evidence.md`. From there **Review** and **Respond** in `loop.md` loop as for a task, with `again integration` and `respond integration`, the `integration-round-<r>`
files, and the `integration` scope has the same cap, counted the same way, by `cap` of
`$FLOW/scripts/flow.sh status <WT> integration`. A stop at that cap goes as **The round cap** in `loop.md` says. No session gets rebuilt during those rounds. Fixes become **one commit** after the review approves, by `$FLOW/scripts/flow.sh prompt <WT> commit integration`, with a
subject that says what it is, such as "integration review fixes". No fixes means no commit.

Review says `approve`, every finding is resolved, tests pass. Once all three hold, the entry's file says what comes next.
