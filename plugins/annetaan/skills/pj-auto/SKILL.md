---
name: pj-auto
description: Drives pj3-doctor and pj4-running on one project, each step a fresh `claude -p` run in unattended mode, deciding every step from `project.sh --next`, until the project needs the user. Asks one approval question per drive, only when a step would run. Use it only when the user names this skill or invokes /annetaan:pj-auto, because the runs it starts edit issues, push, and merge pull requests into the project's base branch.
---

# pj-auto

`pj-auto` is no stage of its own. It drives `pj3-doctor` and `pj4-running` on one project: the main session starts the
script `auto.sh` and waits, and `auto.sh` starts one fresh `claude -p` run per step. **You write nothing to GitHub
yourself.** The runs do, and `project.sh --next` decides every step.

## Paths: `$AUTO`

**`$AUTO` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$AUTO` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for the
user.

**Read these before anything else:**

- `$AUTO/../pj1-plan/between-skills.md`: **Principle**, **Picking the project**, **Unattended runs**, **Issues in a
  report**
- `$AUTO/../pj1-plan/state.md`: **What comes next**

This skill uses these files:

- the script `$AUTO/scripts/auto.sh`
- the script `$AUTO/../pj1-plan/scripts/project.sh`, written `project.sh` below

**Language**: talk to the user in the user's language.

## Before you start

This skill starts runs that edit issues, push, and merge pull requests into the project's base branch. **Start it only
when the user names it or invokes `/annetaan:pj-auto`.**

```bash
git rev-parse --show-toplevel
gh auth status
command -v claude
```

Any of these failing stops the skill. Say which one and stop.

**The project.** Pick it as `between-skills.md` says under **Picking the project**, with the candidates of `pj3-doctor`
and `pj4-running`. The project picked is `<P>`. Print `project #<P>` once.

## The next step

Run `project.sh <P> --next` once and read it (`state.md`, **What comes next**).

When `next` is `user` or `done`, ask nothing and start nothing. Write what the user does next, as **Report to the
user** says for that reason, and end.

## The question

Otherwise a step would run. Show a summary first:

- the project, and the current `next`, `why` and `issue`
- that each step runs `pj3-doctor` or `pj4-running` whole, in a fresh `claude -p` run, and each one costs a session
- that the runs ask no approval
- when the drive stops: the project needs the user (`user`), the project is done (`done`), a run ends as needs-user,
  the state does not change after a run (`no-progress`), `pj3-doctor` has run twice on the same key (`doctor-cap`), a
  run fails (`child-failed`), or the stop file appears
- that merges into the project's base branch happen, and the project's own pull request is never merged
- the permissions the runs need, from the user's settings: `Bash(gh:*)`, `Bash(git:*)`, `Edit`, `Write`, and with the
  real absolute paths `Bash(<real path of $AUTO/..>/pj1-plan/scripts/project.sh:*)` and
  `Bash(<real path of $AUTO/..>/pj4-running/scripts/run.sh:*)`

Then call `AskUserQuestion`: `Start the drive on #<P>?` with the options `Start the drive` and `Do not start`. On
`Do not start`, stop. The approval covers the whole drive (`between-skills.md`, **Principle**).

## The drive

```bash
mktemp -d
```

The directory it printed is `<LOG>`. Print `drive <LOG>` once, so that a context summary can find it again. Start the
script with Bash `run_in_background`:

```bash
$AUTO/scripts/auto.sh <P> --log <LOG>
```

Print `tail -f <LOG>/drive.jsonl` with the real path, for the user to follow the steps. Then wait for the script to
finish. Do not poll.

When the user asks to stop, run `touch <LOG>/stop` and say the drive stops after the current step. **Never kill a run
or the script.**

## Report to the user

Read the `ended` line of `<LOG>/drive.jsonl`, then list the steps, one per line as `<i> <run> <why> <issue URL>`, and
the reason. Name the next action from the reason:

- `user`, or a first `--next` of `user`: split by `why`.
  - `split`: `/annetaan:pj2-issues <P>`
  - `waits`: merge the projects it waits on
  - `decisions`: tick the decisions of `<issue URL>` on GitHub, then `/annetaan:pj-auto <P>`
  - `contradictory`: run `/annetaan:pj3-doctor <P>` by hand
  - `merge-project-pr`: merge the pull request at `url`
- `done`: the project is closed.
- `needs-user`: quote the last run's reason, and run the matching skill by hand, `/annetaan:pj3-doctor <P>` or
  `/annetaan:pj4-running <P>`. When the reason is a missing permission, name it.
- `no-progress` and `doctor-cap`: run `/annetaan:pj3-doctor <P>` by hand.
- `child-failed`: give the paths of `<i>-<run>.err` and `<i>-<run>.json` in `<LOG>`.
- `stop-requested`: the drive stopped at the user's word.
- `project`, `not-a-repo`, `no-claude`: quote the message.

When `noLine` is not empty, add one line naming the steps that ended without a last line.

## Rules

- At most one approval question per drive, `Start the drive on #<P>?`. The `Project` question of **Picking the project**
  comes before it and is not part of the drive.
- You write nothing to GitHub yourself, and you never kill a run.
- The next action comes only from `project.sh --next` and the `ended` line.
- After a context summary, resume from the `project #<P>` and `drive <LOG>` lines.
