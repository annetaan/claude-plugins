---
level: 3
evaluated: 2026-11-21
review-by: 2027-02-19
---
## Why this level

This repository runs at the full strength. Its code layer is tidy, but most of what changes is prose that has to stay consistent across skills, and few checks catch a slip in it.

## Design tidiness

The scripts follow one pattern. Each `.sh` wraps a `.py`, and the `.py` prints one JSON object through `emit`, `stop` or `die`. The tests in `tests/` are bash integration tests that build a throwaway git origin. A smaller model could follow that pattern.

Most changes land in prose, though. Over the last 60 commits the files changed most often are `plugins/annetaan/README.md`, `plugins/annetaan/skills/workflow/README.md`, `plugins/annetaan/skills/workflow/SKILL.md`, `plugins/annetaan/skills/pj1-plan/between-skills.md` and `plugins/annetaan/skills/pj3-doctor/SKILL.md`. Contracts between skills live in Markdown, in `pj1-plan/format.md`, `between-skills.md` and each `SKILL.md`. Only part of them is checked by tests (`judgement-map.sh`, `project-lint.sh`, `comments.sh`). The repository has no CI.

## Problem difficulty

The skills pass state to one another through issue bodies, labels, blocked-by relationships, the Order list and the `Level:` record lines. They also drive git worktrees and submodules, delete branches, call the GitHub API and run unattended `claude -p` drives. Recent merges were large and cut across many files: #80 touched 63 files, #77 33, #82 35 and #85 36. A wording drift in one skill can quietly break how another one reads its input.

## The numbers

Covering up to 2026-11-21, with no earlier evaluation:

- Level 3 (default): 1 run, 3 tasks, 6 task rounds, 1 integration round, 5 findings, 1.0 send-backs per task, 1.67 findings per task.

One run is weak evidence. It gives no reason to go lower, because even at level 3 each task was sent back once on average.

## When to look again

Evaluate again once a few more runs have merged. Few send-backs at level 3 over several runs would make level 2 worth trying.
