# The project's pull request

> This file is read by the main session that loaded the pj4-running skill. The paths it uses are the ones **Paths: `$RUNNING`** in SKILL.md gives.

The project's pull request takes the whole project from `<base>` into `<from>`. pj4-running opens it, and never
merges it. Merging it is the user's job.

Before it opens it, pj4-running merges `origin/<from>` into `<base>`, so that the pull request shows the project as it
lands on `<from>` today, and a conflict with what `<from>` gained since `<base>` was cut is settled here, under review,
instead of in the user's merge. Three steps run in the sync worktree or from `<MAIN>`: bringing `<from>` in, **The
declared checks**, and opening the pull request.

## Bringing `<from>` in

From `<MAIN>`:

```bash
$RUNNING/scripts/run.sh sync <P>
```

`sync` fetches `<base>` and `<from>`, makes the sync worktree `pj-<P>-sync-<stamp>` under `<MAIN>/.claude/worktrees/`
on the tip of `origin/<base>`, and merges `origin/<from>` there. `current`, `merged` and `conflict` carry `worktree`,
its path, and `name`. Print `sync worktree <worktree>` once, so that a context summary finds it again, and keep
`name`. Act on `copied`, `notIgnored` and `unlisted` as the `ready` case of phase 4 step 2 in `issues.md` says. Then
act by `status`.

- **`current`**: `<base>` contains `<from>` already. Go to **The declared checks** with `sha`.
- **`merged`**: the merge went through with no conflict, and `sync` pushed the merge commit `sha` to `<base>`. Print
  `<from> merged into <base> as <short sha>` and go to **The declared checks** with `sha`.
- **`conflict`**: the merge stopped on conflicts in `files`, and stays in progress in the sync worktree, on top of
  `start`. Print `<from> conflicts with <base> in <n> file(s)`, and enter the sync worktree.

  ```
  EnterWorktree(path: "<worktree>")
  ```

  Where that tool is not available, `cd "<worktree>"`. Take **Before workflow runs** in SKILL.md with From a sync,
  then run workflow's **From a sync** (`workflow/from-sync.md`) there. These are what it expects you to have settled,
  so say them in your context before you start it: `P`, `<base>`, `<from>`, `files`, `start` as `<START>`, the
  handover notes, and the paths: the sync worktree as `<WT>`, and `<MAIN>`. workflow hands **Unplanned work** in
  SKILL.md a `later` report as it does for a task, worded "found while merging `<from>` into `<base>`". It comes back
  here. Leave the sync worktree first, whatever it returns.

  ```
  ExitWorktree(action: "keep")
  ```

  Where that tool is not available, `cd "<MAIN>"`.
  - **`finished`** with the SHA of the merge commit, even with `stop requested: yes`, because the merge is reviewed
    and the next run would redo it otherwise: fold the handover lines as **Folding the handover lines** in SKILL.md says, then
    push it from `<MAIN>`.

    ```bash
    $RUNNING/scripts/run.sh sync <P> --push <name>
    ```

    `merged`: print `<from> merged into <base> as <short sha>`. Go to **The declared checks** with `sha`, unless the
    user said stop: then end the sync worktree as below with `--since <sha>`, since the merge is on origin now, and
    go to phase 5 step 2. A `stop` is handled as below.
  - **`stopped`**: report the reason and the text of the `Unplanned:` or `Diverged:` report. There is no issue to
    comment on, so nothing goes to GitHub. End the sync worktree as below with `--since <start>`, which keeps it when
    it holds the merge in progress, and say so. The next run redoes the merge in a new sync worktree. Go to phase 5
    step 2.
- **`stop`** with `push-rejected`, `unfinished` or `not-the-merge`: quote `message`. After `push-rejected`, a rule on
  `<base>` refuses a direct push, or `<base>` moved since the fetch. After the other two, the sync worktree is not as
  `sync` expects. End the sync worktree with `--since <start>`, `start` being the one `push-rejected` carries or the
  one `conflict` gave, which keeps it when it holds the merge, and go to phase 5 step 2. The next run redoes the
  merge.
- **`stop`** with `base-gone`, `merged`, `not-due` or `fetch-failed`: as for the pull request below. No sync worktree
  was made.

**Ending the sync worktree**, from `<MAIN>`, with the `<sha>` the step at hand names:

```bash
$RUNNING/scripts/run.sh end <P> <name> --since <sha>
```

`removed` means it held nothing since `<sha>` and is gone. `kept` means it holds `commits` commits or the uncommitted
`changes`, on a detached HEAD, until `/annetaan:cleanup <P>`: report it. A non-zero exit is quoted, and the step goes
on.

## The declared checks

Enter the sync worktree, with `EnterWorktree(path: "<worktree>")` or `cd "<worktree>"`. Read the handover comment with
the command in `pj1-plan/between-skills.md` under "The handover comment", and run each preparation step its notes name,
such as installing the dependencies or `git submodule update --init`, one command per Bash call. The sync worktree
holds only the files `.worktreeinclude` names, so a check may need them.

Read `project.sh <P>`. For each distinct `check` in `parent.breakage`, run it in the sync worktree, one command per Bash
call, and keep `ran:` and `saw:` (`pj1-plan/format.md`, **Declared breakage**). A preparation step that failed makes
every check `not run: <step> failed: <message>`.

Then leave the sync worktree with `ExitWorktree(action: "keep")` (`cd "<MAIN>"` where that tool is missing), and end
it as **Ending the sync worktree** says, with the `sha` of `current` or `merged`.

- **Every check passes**: go on to the pull request.
- **A check fails**: file a stub as **Unplanned work** in SKILL.md says, worded "found while verifying project #<P>:
  `<check>` fails", after the `end`. Open no pull request and go to phase 5 step 2. The next step is
  `/annetaan:pj3-doctor`.
- **A check cannot be run here** (a missing service, a command the run may not start): keep it as
  `not run: <why>` and go on.

## Opening it

Write `$TMP/<P>-pr.md`. Its first line is `Part of #<P>`. Below it, in the repository's language, it says that the
pull request brings project `#<P>` into `<from>`, lists each sub-issue closed as completed as `#<k> <title>` with its
pull request `#<m>` from `project.sh <P>`, or "no pull request, it already held" for one closed after `nothing-left`, names the stubs and the issues closed as not planned, lists each declared check with the issue that left it, its `closedBy` and its `ran:` and `saw:`, and lists the `not run:` ones under a heading of their own, and says that the
parent closes as completed when a pj4-running run sees the merge, or when the user closes it after merging.

```bash
$RUNNING/scripts/run.sh pr <P> --body "$TMP/<P>-pr.md"
```

`run.sh pr` opens it with the parent's title, from `<base>`, which is on origin already, so nothing is pushed. Act by
`status`.

- **`opened`**: keep `url` for the report.
- **`exists`**: an open pull request from `<base>` into `<from>` is there already, from an earlier run or from the
  user. Nothing was written. Keep `url`.
- **`stop`** with `base-gone`: the base branch is gone from origin, so nothing can be opened. Say so.
- **`stop`** with `create-failed`: quote `message`. A base branch with no commits beyond `<from>`, for example when
  every sub-issue was closed as not planned, has nothing to bring in.
- **`stop`** with `merged` or `not-due`: the project changed under the run. Quote `message`.
- **`stop`** with `behind` or `fetch-failed`: `<from>` moved after **Bringing `<from>` in**, or origin could not be
  read. Quote `message`. The next run brings `<from>` in again.
