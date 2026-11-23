---
name: pj-auto
description: Drives pj3-doctor and pj4-running on one project, each step a fresh `claude -p` run in unattended mode, deciding every step from `project.sh --next`, until the project needs the user. Asks one approval question per drive, only when a step would run. Use it only when the user names this skill or invokes /annetaan:pj-auto, because the runs it starts edit issues, push, and merge pull requests into the project's base branch.
---

# pj-auto

`pj-auto` is not one of the four pj skills. It drives `pj3-doctor` and `pj4-running` on one project: the main session starts the
script `auto.sh` and waits, and `auto.sh` starts one fresh `claude -p` run per step. **You write nothing to GitHub
yourself.** The runs do, and `project.sh --next` decides every step.

## Paths: `$AUTO`

**`$AUTO` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$AUTO` is not a shell variable. Replace it with the real absolute path whenever you run bash or write a path for the
user.

**Read these before anything else:**

- `$AUTO/../pj1-plan/between-skills.md`: **Principle**, **Picking the project**, **Unattended runs**, **Issues in a
  report**, **Commands**, **The handover comment**
- `$AUTO/../pj1-plan/state.md`: **What comes next**

This skill uses these files:

- the script `$AUTO/scripts/auto.sh`. `auto.sh --rules` prints the rules every drive needs and the user's settings.
- the script `$AUTO/../pj1-plan/scripts/project.sh`, written `project.sh` below
- the script `$AUTO/../workflow/scripts/level.sh`, written `level.sh` below

**Language**: talk to the user in the user's language.

## Before you start

This skill starts runs that edit issues, push, and merge pull requests into the project's base branch. **Start it only
when the user names it or invokes `/annetaan:pj-auto`.**

Run these as three calls, each one command (**Commands** in `pj1-plan/between-skills.md`):

```bash
git rev-parse --show-toplevel
```

```bash
gh auth status
```

```bash
command -v claude
```

Any of these failing stops the skill. Say which one and stop.

**The project.** Pick it as `pj1-plan/between-skills.md` says under **Picking the project**, with the candidates of `pj3-doctor`
and `pj4-running`. The project picked is `<P>`. Print `project #<P>` once, as that section says.

**The level.** `<root>` is what `git rev-parse --show-toplevel` printed, and `<n>` comes from `level=<n>` in the args,
left out when the args carry none.

```bash
$AUTO/../workflow/scripts/level.sh show <root> [<n>]
```

Print `level <level> (<source>)` once, and `warning` on a line of its own when it is set, as **The level** in
`workflow/SKILL.md` says. A non-zero exit, such as `level=<n>` outside 1 to 3, stops the skill: quote its
message.

## The next step

Run `project.sh <P> --next` once and read it (`pj1-plan/state.md`, **What comes next**).

When `next` is `user` or `done`, ask nothing and start nothing. Write what the user does next, as **Report to the
user** says for that reason, and end.

## The permissions

Runs only when a step would run. The runs cannot ask, so show the user what their settings lack before the question.

1. The rules every drive needs and what the settings hold: run `$AUTO/scripts/auto.sh --rules` and read the output
   whole. `main` is `<MAIN>`. `base` lists the eight rules, each with the files whose `allow` list holds that exact
   string, and `settings` lists the three settings files with their `allow`, `deny` and `ask` rules.
2. The repository's own commands: install, tests, type checks, lint, build. Find them with Read and Glob in `<MAIN>`:
   `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md`; the root manifest and lockfile that name the package manager
   (`package.json` scripts with `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` or `bun.lockb`; `Makefile`;
   `pyproject.toml`; `Cargo.toml`; `go.mod`); the CI workflows under `.github/workflows/`. Also the parent's handover
   comment, read with the command in `pj1-plan/between-skills.md`, **The handover comment**. Each command becomes
   `Bash(<program>:*)`, such as `Bash(pnpm:*)` for `pnpm install`. Write a narrower `Bash(<program> <subcommand>:*)`
   only when the user's rules are already written that way.
3. Judge each rule, the eight base rules and those of step 2, against the lists of every file:
   - **covered**: an `allow` rule matches. It is the same string; a `:*` rule whose prefix starts the command; the
     space form `Bash(gh *)`, which counts as `Bash(gh:*)`; the tool name alone (`Bash`, `Bash(*)`, `Read`); or, for a
     `Read` rule, a path glob that contains the needed path (expand `~/`, and read `//` as an absolute path). Note
     the file.
   - **blocked**: a `deny` or `ask` rule matches. It is the same string, or it is narrower than the needed rule, that
     is its prefix begins with the needed rule's prefix, such as `Bash(gh pr merge:*)` against `Bash(gh:*)`. Blocked
     wins over covered. Note the rule and the file, so that the user sees which command will stop.
   - **missing**: otherwise.

   A file with an `error` is named, and its rules count as absent.
4. Paths no rule opens: run `$AUTO/../pj1-plan/scripts/project.sh <P>` with the real path, collapsed as **Paths** in
   `pj3-doctor` and `pj4-running` say. Each open sub-issue with a `designPaths` entry that starts with `.claude/` is a
   step the drive cannot run: Claude Code asks before it writes under a repository's `.claude/` whatever the rules
   say, so that run ends as needs-user.

`Edit` and `Write` are not needed, because acceptEdits covers the runs' edits.

## The question

Otherwise a step would run. Show a summary first:

- the project, and the current `next`, `why` and `issue`
- that each step runs `pj3-doctor` or `pj4-running` whole, in a fresh `claude -p` run, and each one costs a session
- that the runs ask no approval
- that each run starts in Claude Code's acceptEdits mode, a grant made outside the user's settings: file edits and
  file-writing shell commands, `rm` included, go through without asking inside `<MAIN>`, the project's worktree
  `<MAIN>/.claude/worktrees/pj-<P>`, and a directory of the run's own in the drive's log directory
- when the drive stops: the project needs the user (`user`), the project is done (`done`), a run ends as needs-user,
  the state does not change after a run (`no-progress`), `pj3-doctor` has run twice on the same key (`doctor-cap`), a
  run fails (`child-failed`), `claude -p` stops a run's background tasks after the 60 minute wait and the run printed no
  last line (`bg-killed`), or the stop file appears
- that the drive keeps the Mac from idle sleep until it ends, and that closing the lid still sleeps it, and the drive
  then stalls
- that a run may wait up to 60 minutes after its last turn for its background work
- that merges into the project's base branch happen, and the project's own pull request is never merged
- the level the runs use, `level <level> (<source>)`, and that each run reads it again from origin's default branch,
  unless `level=<n>` was given, in which case every run gets `level=<n>`
- that no other session may run on the same project while the drive runs: a dirty worktree is taken for a dead run's
  and discarded
- the permissions: every rule from **The permissions**, one line each, as `covered (<file>)`, `missing`, or
  `blocked (<rule> in <file>)`. For each repository command, where it was found. Each issue under `.claude/` as
  `<issue URL> writes <path>`, with the note that the drive stops there and that `/annetaan:pj4-running <P>` run by
  hand does that issue.

Under the bullets, one sentence: missing or blocked rules do not stop the question. The user adds the rules to their
settings first and answers `Do not start`, or starts anyway and the drive stops at the first run that needs one.

Then call `AskUserQuestion`: `Start the drive on #<P>?` with the options `Start the drive` and `Do not start`. On
`Do not start`, stop. The approval covers the whole drive (`pj1-plan/between-skills.md`, **Principle**).

## The drive

```bash
mktemp -d
```

The directory it printed is `<LOG>`. Print `drive <LOG>` once, so that a context summary can find it again. Start the
script with Bash `run_in_background`:

```bash
$AUTO/scripts/auto.sh <P> --log <LOG> [--level <n>]
```

`--level <n>` goes in only when the args carried `level=<n>`. `auto.sh` then adds ` level=<n>` to the args of every run.

Print `tail -f <LOG>/drive.jsonl` with the real path, for the user to follow the steps. Each step writes a `begin` line
when it starts and a `step` line when it ends. The `begin` line names the run, why, the issue, `at`, its output files
and its directory `<LOG>/<i>-<run>/`. The last `begin` with no `step` after it is the step running now, and its `at`
says since when. Then wait for the script to finish. Do not poll.

When the user asks to stop, run `touch <LOG>/stop` and say the drive stops after the current step. **Never kill a run
or the script.**

## Report to the user

Read the `ended` line of `<LOG>/drive.jsonl`, then list the steps from the `step` lines, one per line as
`<i> <run> <why> <issue URL>`, and the reason. When `ended.i` is not null, the drive ended on that step: add it as one
more line from its `begin` line, with the reason. For `child-failed`, give the `out` and `err` paths from that `begin`
line, and for `bg-killed`, the `err` path. Name the next action from the reason:

- `user`, or a first `--next` of `user`: split by `why`.
  - `split`: `/annetaan:pj2-issues <P>`
  - `waits`: merge the projects it waits on
  - `decisions`: tick the decisions of `<issue URL>` on GitHub, then `/annetaan:pj-auto <P>`
  - `contradictory`: run `/annetaan:pj3-doctor <P>` by hand
  - `merge-project-pr`: merge the pull request at `url`, then `/annetaan:pj-cleanup <P>`
- `done`: the project is closed. `/annetaan:pj-cleanup <P>` removes its worktree and base branch and brings the local
  `<from>` up to date.
- `needs-user`: quote the last run's reason, and run the matching skill by hand, `/annetaan:pj3-doctor <P>` or
  `/annetaan:pj4-running <P>`. When the reason is a missing permission, name it as the rule to add, in the form **The permissions** uses.
- `no-progress` and `doctor-cap`: run `/annetaan:pj3-doctor <P>` by hand.
- `child-failed`: give the `out` and `err` paths from the `begin` line of step `ended.i`.
- `bg-killed`: quote the message, which names the tasks that were stopped, and give the `err` path from the `begin` line
  of step `ended.i`. Say that the wait is counted in wall-clock time, so a machine that slept (a closed lid) does this.
  Next action: `/annetaan:pj-auto <P>` again. When the same task is stopped a second time, run the matching skill by
  hand, `/annetaan:pj3-doctor <P>` or `/annetaan:pj4-running <P>`, by the run of that `begin` line.
- `stop-requested`: the drive stopped at the user's word.
- `project`, `not-a-repo`, `no-claude`: quote the message.

When `noLine` is not empty, add one line naming the steps that ended without a last line.

## Rules

- At most one approval question per drive, `Start the drive on #<P>?`. The `Project` question of **Picking the project**
  comes before it and is not part of the drive.
- You write nothing to GitHub yourself, and you never kill a run.
- You never write the user's settings. You show the rules, and the user adds them.
- The next action comes only from `project.sh --next` and the `ended` line.
- After a context summary, resume from the last `project #<P>` line, the last `level` line and the last `drive <LOG>` line.
