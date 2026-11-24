Read `<skills>/workflow/roles/work.md` first and follow the role it describes.

<if task>
Design: <WORKDIR>/design.md
Plan: <WORKDIR>/plan.md
Detail design for this task: <WORKDIR>/detail/task-<k>.md
<end>
<if integration>
Design: <WORKDIR>/design.md
Plan: <WORKDIR>/plan.md
<end>
<if merge>
Design, plan and detail: <WORKDIR>/merge.md
<end>
Handover notes: <WORKDIR>/notes.md

<if task>
Start point START: <START>
Branch: <branch>
<end>
<if integration>
Start point START: <START>
Branch: <branch>
<end>
<if merge>
Start point START: <head>
<end>
Review files: <WORKDIR>/review
Scratch: <WORKDIR>/scratch/work

Progress:
<progress>

<if task>
Implement task <k> of the plan in <WORKDIR>/plan.md. **Do not commit yet.** Write `task-<k>-evidence.md` under the review files. Report back once the tests pass.
<end>
<if integration>
Every task of the plan is committed, and the integration review asked for changes. The progress above holds the commit that closed each task.
<end>
<if merge>
This is a merge in progress. Resolve the conflicts, and `git add` each file you resolve. Write `merge-evidence.md` under the review files. The acceptance criteria in <WORKDIR>/merge.md are commands, so the evidence is those commands and their output, plus the flows the conflicted files take part in. Never run `git merge --abort`, `git reset` or `git commit`: the merge state is the task. Follow **Work outside the task** in `<skills>/workflow/roles/work.md`. Report back once the tests pass.
<end>

<if issue>
This run comes from issue #<n>. Follow **Work outside the task** in `<skills>/workflow/roles/work.md`.
<end>

If this change shows on screen, take screenshots. When an existing screen changes how it looks or behaves, **take the current state (before) first, before you touch anything**, then implement, then take the after shot. When you only add a new screen or component, the after shot alone is enough. Save them in <WORKDIR>. **Do not create files anywhere else** (`work-reports/` is ignored, and anything outside it ends up in a commit). Report the path of each file and what it shows.
