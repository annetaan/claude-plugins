# The run's worktree

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

## The start check

Run one command and keep every answer. Phase 1 needs them.

```bash
$FLOW/scripts/worktree.sh start
```

It prints `status: ok` with `main`, `mainBranch`, `defaultBranch`, `gh` and `attach`.

- `main` is `<MAIN>`, the main working tree. The flow never works in it.
- `mainBranch` is the branch `<MAIN>` has checked out, or null on a detached HEAD.
- `defaultBranch` is the branch origin's HEAD names, or null.
- `attach` says whether `gh` is new enough for `gh pr create --attach` (2.99.0 or later). Phase 6 reads it, and `gh` holds the version.
- **A `stop` ends the flow before design.** Its `reason` is `not-a-repo`, `no-origin`, `gh`, `gh-auth` or `repo`. Name the check and quote `message`. For `no-origin`, `gh` and `gh-auth`, add that this flow ends in a pull request and one cannot be opened here.
- **A null `defaultBranch` stops the flow too**, unless the request names the branch to start from. Say that the default branch cannot be read.
- **A dirty `<MAIN>` does not stop the flow**, because the flow never works in it.

## The worktree

The standalone flow works in a git worktree of its own, `.claude/worktrees/wf-<stamp>` inside `<MAIN>`, detached at the tip of the base branch on origin. `<MAIN>` stays as the user left it. Run these steps after **Does this repository accept breaking changes?** in `standalone.md` and before phase 1, so that design reads the code in `<WT>`. The memory lookup in that check ran in the session's own project, before the worktree.

1. **The base.** The branch the request names, otherwise `defaultBranch`.
2. **The base question.** Only when the project's instructions in context (`CLAUDE.md`) ask for the base branch to be confirmed on every run. They are free-form, so you judge whether they do. Ask one `AskUserQuestion` with these options in this order, leaving out any that repeat an earlier one: the branch the request names `(Recommended)`; `defaultBranch` (`(Recommended)` when it comes first); `mainBranch` when it is set and differs from the default branch. The tool adds Other on its own. The answer is the base. **When fewer than two options remain**, ask a two-option confirm question instead: `Use <base> (Recommended)` and `Another branch - type its name under Other`, where `<base>` is the one candidate. An answer under Other is the base.
3. **Create it.**

   ```bash
   $FLOW/scripts/worktree.sh create <base>
   ```

   - `ready`: keep `worktree` as `<WT>`, `name` as `<name>` and `base` as `<base>`.
   - `stop` with `base-missing`: say that origin has no branch `<base>`, and stop the flow.
   - `stop` with `fetch-failed`: quote `message` and stop the flow.

   Both stops come before a worktree exists, so there is nothing to remove.
4. **Ignore rules.** Two paths must stay out of git: `.claude/worktrees/` in `<MAIN>` and `work-reports/` in `<WT>`.

   ```bash
   $FLOW/scripts/worktree.sh ignore <name>
   ```

   `ok`: go on. `ask`: ask once, naming `notIgnored`.

   ```
   AskUserQuestion: These paths are not ignored in this repository: <paths>. workflow works in .claude/worktrees/ and writes its reports to work-reports/.
     - Ignore them in this clone (Recommended) - adds them to .git/info/exclude and commits nothing
     - Stop
   ```

   On the first answer, run `$FLOW/scripts/worktree.sh ignore <name> --add` and act on what it prints as here. On
   `stop` with `still-not-ignored`, a `.gitignore` rule overrides the exclude file: say so and take **Ending before
   approval**. On Stop, take **Ending before approval**. **Never edit `.gitignore`.**
5. **Enter it, once.**

   ```
   EnterWorktree(path: "<WT>")
   ```

   Where that tool is not available, `cd <WT>`. Print `worktree <WT> base <base>` once. **Every command from here to
   the end of the run runs in `<WT>`.** After a context summary, run `git rev-parse --show-toplevel`, and enter
   `<WT>` again when it prints anything else.
6. **The worktree line.** From here on, every sub-agent prompt ends with **The worktree line** in SKILL.md: the design, the design review, the implementation, the review, the integration review and the report session.
7. `<WT>` has none of `<MAIN>`'s ignored files, such as installed dependencies or a `.env`. The first worker prepares what the tests need and leaves the steps in the handover notes, so later tasks find them there.

### Ending before approval

When the run ends before approval, leave the worktree and remove it.

1. When you have entered `<WT>` (**The worktree** step 5), `ExitWorktree(action: "keep")`, or `cd <MAIN>` where that tool is not available. A stop at step 4 comes before that: skip this step.
2. `git -C <MAIN> worktree remove <WT>`

The reasons: the Stop answer at the ignore question, a feasibility of "no" or "conditional" the user does not pursue, any answer at approval that ends the flow, and the user saying stop. Design sessions never change code, so there is no `--force`. When git refuses, something wrote into `<WT>`: quote the refusal, name `<WT>`, and point to `/annetaan:workflow-cleanup`.
