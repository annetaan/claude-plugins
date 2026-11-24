Read `<skills>/workflow/roles/work.md` first and follow the role it describes.

Design: <WORKDIR>/design.md
Plan: <WORKDIR>/plan.md
Handover notes: <WORKDIR>/notes.md

Start point START: <START>
Branch: <branch>
Review files: <WORKDIR>/review

Progress:
<progress>

Write a work report at <WORKDIR>/log.md. If this repository has `.github/PULL_REQUEST_TEMPLATE.md`, use it as the skeleton. Otherwise read a few recent merged pull requests (`gh pr list --state merged --limit 5`) and follow how they are written. With nothing to go on, choose a structure yourself. Whatever structure you choose, a reader has to come away with: what changed, how it was verified, per acceptance criterion and flow, read from the newest evidence file of each task under <WORKDIR>/review/, and also from the newest integration evidence file (`integration-round-` with its round and `-evidence.md`) and the newest merge evidence file (`merge-evidence.md`, or `merge-round-` with its round and `-evidence.md`) when they exist, the newest one of each kind being what holds for the final tree, and also from `## Walk` of the round 1 seat files of the integration review when they exist, a heading of its own for what neither the implementation nor the review could run and what a person has to run by hand (left out when there is nothing), a heading of its own gathering the `check wanted:` lines of the commit reports, read from <WORKDIR>/checks.md (left out when that file does not exist), the model decisions with their reasons and evidence, read from <WORKDIR>/design.md and the forks settled in <WORKDIR>/plan.md, so that a reader can overturn one, what the review changed, the review's `## Not run` entries and the test and type check results, read from the files under <WORKDIR>/review/, the files a merge resolved, read from <WORKDIR>/merge.md when it exists, the screenshots if the change shows on screen, and which commit answers which task in the plan in <WORKDIR>/plan.md. Screenshots sit in the same directory, so link them relatively, as `![before](./before.png)`. Write it in the language this repository uses. **Do not create files outside <WORKDIR>.**

<if issue>
List the adaptations the implementation session made to the issue's design, in <WORKDIR>/adaptations.md, under what changed, and what the detail pass redrew in the issue.
<end>
