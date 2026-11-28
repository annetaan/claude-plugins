# The run's worktree

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

## The start check

Run one command and keep every answer. The steps after it need them.

```bash
$FLOW/scripts/worktree.sh start
```

It prints `status: ok` with `main`, `mainBranch`, `defaultBranch` and `gh`, the version of `gh`.

- `main` is `<MAIN>`, the main working tree. The flow never works in it.
- `mainBranch` is the branch `<MAIN>` has checked out, or null on a detached HEAD.
- `defaultBranch` is the branch origin's HEAD names, or null.
- **A `stop` ends the flow before design.** Its `reason` is `not-a-repo`, `no-origin`, `gh` (not installed, or older than 2.99.0, which `gh pr create --attach` needs), `gh-auth` or `repo`. Name the check and quote `message`. For `no-origin`, `gh` and `gh-auth`, add that this flow ends in a pull request and one cannot be opened here.
- **A null `defaultBranch` stops the flow too**, unless the request names the branch to start from. Say that the default branch cannot be read.
- **A dirty `<MAIN>` does not stop the flow**, because the flow never works in it.

## The worktree

The standalone flow works in a git worktree of its own, `.claude/worktrees/run-<stamp>` inside `<MAIN>`, detached at the tip of the base branch on origin. `<MAIN>` stays as the user left it, except for the lines the answers of **Files `.worktreeinclude` does not name** add to `<MAIN>/.worktreeinclude`. Run these steps before **Design** in `standalone.md`, so that design reads the code in `<WT>`.

1. **The base.** The branch the request names, otherwise `defaultBranch`.
2. **The base question.** Only when the repository's instructions in context (`CLAUDE.md`) ask for the base branch to be confirmed on every run. They are free-form, so you judge whether they do. Ask one `AskUserQuestion` with these options in this order, leaving out any that repeat an earlier one: the branch the request names `(Recommended)`; `defaultBranch` (`(Recommended)` when it comes first); `mainBranch` when it is set and differs from the default branch. The tool adds Other on its own. The answer is the base. **When fewer than two options remain**, ask a two-option confirm question instead: `Use <base> (Recommended)` and `Another branch - type its name under Other`, where `<base>` is the one candidate. An answer under Other is the base.
3. **Create it.**

   ```bash
   $FLOW/scripts/worktree.sh create <base> --kind run
   ```

   `level` and `pj-roadmap` pass `--kind propose` in place of `--kind run`, which names the worktree `propose-<stamp>`.

   - `ready`: keep `worktree` as `<WT>`, `name` as `<name>` and `base` as `<base>`. Then act on the four lists it carries.
     - `ignored` not empty: `create` added these paths to `.git/info/exclude`, because that file had no line for them. Print `ignored <paths>` once, adding that `.git/info/exclude` stays in the clone and commits nothing.
     - `copied` not empty: print `copied <paths>` once.
     - `notIgnored` not empty: say once that `<MAIN>/.worktreeinclude` lists these files but `<WT>` does not ignore them, so they were not copied. A `.gitignore` rule that only `<MAIN>`'s working tree has is the usual cause. **Never edit `.gitignore`.**
     - `unlisted` not empty: take **Files `.worktreeinclude` does not name**.
   - `stop` with `base-missing`: say that origin has no branch `<base>`, and stop the flow.
   - `stop` with `fetch-failed`: quote `message` and stop the flow.
   - `stop` with `still-not-ignored`: a `.gitignore` rule, such as `!work-reports/`, keeps the paths in `notIgnored` visible, and `.git/info/exclude` cannot override it. Say so, name them, and stop the flow. **Never edit `.gitignore`.**

   No stop leaves a worktree behind: the first two come before one exists, and on `still-not-ignored` `create` has removed it again. So there is nothing to remove.
4. **Enter it, once.**

   ```
   EnterWorktree(path: "<WT>")
   ```

   Where that tool is not available, `cd <WT>`. Print `worktree <WT> base <base>` once. **Every command from here to
   the end of the run runs in `<WT>`.** After a context summary, run `git rev-parse --show-toplevel`, and enter
   `<WT>` again when it prints anything else.
5. **Every sub-agent stays in `<WT>`.** A sub-session does not start there by itself. From here on, `flow.sh prompt` ends every prompt it writes with `$FLOW/prompts/worktree-line.md`, which sends the session into `<WT>` and keeps it out of `<MAIN>`, and the one prompt written by hand, **Design** in `standalone.md`, ends with that text too.
6. `<WT>` has the ignored files `<MAIN>/.worktreeinclude` names, copied at step 3 and by the Copy answers of **Files `.worktreeinclude` does not name**, and none of the others, such as installed dependencies. The first worker prepares what the tests still need and leaves the steps in the handover notes, so later tasks find them there. The submodules of `<WT>` are not initialized either. When the build or the tests need one, the first worker runs `git submodule update --init` in `<WT>` and leaves that in the handover notes too.

### Files `.worktreeinclude` does not name

`<MAIN>/.worktreeinclude` lists, in `.gitignore` syntax, the ignored files copied into every new worktree. Claude Code reads the same file for its own worktrees. A line `!/<path>` marks a file that is never copied. Ask one question per path in `unlisted`, four questions per call, and more calls when there are more paths.

```
AskUserQuestion: <path> is in <MAIN> and git ignores it, so <WT> does not have it. Copy it into new worktrees?
  - Copy it - adds /<path> to <MAIN>/.worktreeinclude and copies it now
  - Never copy it - adds !/<path> to <MAIN>/.worktreeinclude, so no run asks about it again
```

Mark Copy `(Recommended)` for a file the build, the tests or a tool of the repository reads, such as an env file or `mise.local.toml`, and Never for a file nothing reads, such as an editor's file. `unlisted` never holds a `.DS_Store`, at any depth, so no question comes up for one, and an existing `!/.DS_Store` line does no harm. An answer under Other that copies nothing leaves the path out of both lists, and the next run asks again.

Then record every answer with one command, `--copy <path>` or `--never <path>` per path. When every answer was under Other, there is nothing to record: skip the command and go on.

```bash
$FLOW/scripts/include.sh remember <WT> [--copy <path>]... [--never <path>]...
```

- `ok`: print `copied <paths>` when `copied` is not empty.
- `stop`: quote `message` and go on. Nothing was written.

A non-zero exit is quoted and stops the run, as for `worktree.sh`. The file sits in `<MAIN>`'s working tree. Commit it to share the list, or keep it out of git. Either works.

### Ending with nothing changed

When the run ends before it creates its branch (**The branch** in `standalone.md`), leave the worktree and remove it.

1. When you have entered `<WT>` (**The worktree** step 4), `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available.
2. Remove it:

   ```bash
   $FLOW/../cleanup/scripts/cleanup.sh run <name>
   ```

   - `done`: go on.
   - `stop`, `discard` among them: quote `message`, name `<WT>`, and point to `/annetaan:cleanup`.

The reasons: a feasibility of "no" or "conditional" the user does not pursue, an open question whose answer ends the flow, and the user saying stop. Design sessions never change code, so the session never passes `--discard` here. The session never decides on `--force` from git's message text or from `git status`: `run` decides, from the submodules of `<WT>`.
