---
level: standard
evaluated: 2026-11-23
review-by: 2027-02-21
---
## Why this level

This repository runs at standard. The evaluator proposed high, and the user chose standard over it. Standard puts the design session, the planner, the project reviewer, the worker and the issue writer on opus at medium effort, and reviews with one seat, opus at high effort. The code layer is tidy and now checked in CI. Most of what changes is still prose that has to stay consistent across skills, so the runs at this level are the ones to watch.

## Design tidiness

The scripts follow one pattern. Each `.sh` wraps a `.py`, and the `.py` prints one JSON object. The tests in `tests/` are bash integration tests that build a throwaway git origin. Since #107, `tests/run.sh` runs all of them, and `.github/workflows/test.yml` runs it on every pull request on Linux and macOS. `tests/references.sh` and `tests/catalogue.sh` now catch a broken file reference or a skill missing from a list.

Most changes still land in prose, though. Over the last 60 commits the files changed most often are `plugins/annetaan/README.md` (49), `plugins/annetaan/skills/workflow/README.md` (29), `plugins/annetaan/skills/pj1-plan/between-skills.md` (28) and `plugins/annetaan/skills/workflow/SKILL.md` (27). The contracts between skills live in long Markdown files: `pj1-plan/format.md` has 463 lines, `between-skills.md` 418 and `pj3-doctor/SKILL.md` 437. The tests check that these files name things that exist. They do not check that two skills mean the same thing by them.

## Problem difficulty

The skills pass state to one another through issue bodies, labels, blocked-by relationships, the Order list and the `Level:` record lines. They also drive git worktrees and submodules, delete branches, call the GitHub API and run unattended `claude -p` drives. Recent merges are still large and cut across many files: #119 touched 41 files, #107 41, #85 36 and #80 63. A wording drift in one skill can quietly break how another one reads its input.

## The numbers

Covering 2026-11-21 to 2026-11-23:

- high (file): 5 runs, 9 tasks, 14 task rounds, 3 integration rounds, 6 findings, 5 send-backs, 0.56 send-backs per task, 0.67 findings per task.

Send-backs went down from 1.0 per task at the last evaluation, but five runs from a single day are weak evidence. The send-backs came from the larger cross-cutting runs: #119 had 3 tasks over 6 task rounds and #118 had 2 tasks over 3. The runs with one task were sent back at most once. All five runs used the table before #119, which put the worker on opus at high effort and reviewed with two seats, as high does now. None of them ran at standard. Standard reviews with one seat, so its findings per task do not compare with these. Send-backs per task do.

## When to look again

Evaluate again once several runs have merged at standard. Send-backs per task above the 0.56 seen here, especially on runs that cut across many skills, or a slip found after a merge that review let through, would be the reason to go to high.
