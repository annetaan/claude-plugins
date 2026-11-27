Read `<skills>/workflow/roles/review.md` first and follow the role it describes.

You are seat <seat>.

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
<if issue>
Adaptations: <WORKDIR>/adaptations.md
<end>

Progress:
<progress>

Review files: <WORKDIR>/review
Probes: <WORKDIR>/seats/<seat>
Run a probe with: <skills>/workflow/scripts/flow.sh run <WT> <seat> <probe dir>

<if task>
Under review: task <k> of the plan in <WORKDIR>/plan.md. The diff sits between the working tree and HEAD (`git diff HEAD` plus untracked files).
<if first>
The evidence is `task-<k>-evidence.md`.
<end>
<end>
<if integration>
Under review: every task is committed. This is the integration review. The target is `git diff <START>` plus untracked files, read in `<WT>`. The tasks were reviewed one at a time, so look at **the boundaries**: types and contracts between functions that call each other across tasks, names that do not match, duplicated implementations, and acceptance criteria for the whole design that are still unmet.
<if first>
No evidence file exists before round 1, because the tree is clean. Record the walk of every acceptance criterion and every flow of the whole design under `## Walk`, each run as a probe, with `ran:` and `saw:`, or `not run:`.
<end>
<end>
<if merge>
Under review: this is a merge. `git diff HEAD` also shows everything `MERGE_HEAD` brings. Review the resolution: each conflicted file against both sides, with `git diff HEAD -- <file>` and `git diff MERGE_HEAD -- <file>`, and any change outside those files. <WORKDIR>/merge.md names the ref coming in, the branch it comes into and the conflicted files.
<if first>
The evidence is `merge-evidence.md`.
<end>
<end>
<if restart>
The reply of the last round is `<scope>-round-<last>-reply.md`, and the round file of the last round is `<scope>-round-<last>.md`. The evidence is the one of the latest code change before round <round>, as **A review round** in `<skills>/workflow/review-files.md` defines it. You start in round <round>. Review the whole change as round 1 does, since you have no earlier snapshot, and do not raise again a finding the earlier round files list.
<end>

Write your seat file as `<scope>-round-<round>-<seat>.md` under the review files.

<if issue>
The design is issue #<n>. Its checked decisions bind.
<end>
