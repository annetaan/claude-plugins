# The project's pull request

> This file is read by the main session that loaded the pj4-running skill. The paths it uses are the ones **Paths: `$RUNNING`** in SKILL.md gives.

The project's pull request takes the whole project from `<base>` into `<from>`. pj4-running opens it, and never
merges it. Merging it is the user's job.

Before it opens it, pj4-running merges `origin/<from>` into `<base>`, so that the pull request shows the project as it
lands on `<from>` today, and a conflict with what `<from>` gained since `<base>` was cut is settled here, under review,
instead of in the user's merge. Both steps run in `<WT>`.

## Bringing `<from>` in

```bash
$RUNNING/scripts/run.sh sync <P>
```

`sync` fetches `<base>` and `<from>`, and merges `origin/<from>` into the tip of `origin/<base>` in `<WT>`. Act by
`status`.

- **`current`**: `<base>` contains `<from>` already. Go on to the pull request.
- **`merged`**: the merge went through with no conflict, and `sync` pushed the merge commit `sha` to `<base>`. Print
  `<from> merged into <base> as <short sha>` and go on to the pull request.
- **`conflict`**: the merge stopped on conflicts in `files`, and stays in progress in `<WT>`, on top of `start`.
  Print `<from> conflicts with <base> in <n> file(s)`, take **Before workflow runs** in SKILL.md with From a sync, then run workflow's **From a sync** (`from-sync.md` in the workflow skill). These are what it expects
  you to have settled, so say them in your context before you start it: `P`, `<base>`, `<from>`, `files`, `start` as
  `<START>`, the handover notes, and the paths `<WT>` and `<MAIN>`. workflow hands **Unplanned work** in SKILL.md a `later`
  report as it does for an issue, worded "found while merging `<from>` into `<base>`". It comes back here.
  - **`finished`** with the SHA of the merge commit, even with `stop requested: yes`, because the merge is reviewed
    and the next run would redo it otherwise: fold the handover lines as **Folding the handover lines** in SKILL.md says, then
    push it.

    ```bash
    $RUNNING/scripts/run.sh sync <P> --push
    ```

    `merged`: print `<from> merged into <base> as <short sha>`. Go on to the pull request, unless the user said stop:
    then go to phase 6 step 2. A `stop` is handled as below.
  - **`stopped`**: report the reason and the text of the `Unplanned:` or `Diverged:` report, and say whether
    uncommitted work stays in `<WT>`. There is no issue to comment on, so nothing goes to GitHub. The next run saves
    the dirty `<WT>` to `stopped.diff`, discards it and redoes the merge. Go to phase 6 step 2.
- **`stop`** with `push-rejected`: quote `message`. A rule on `<base>` refuses a direct push, or `<base>` moved since
  the fetch. The merge commit stays at `<WT>`'s HEAD, and the next run redoes the merge. Go to phase 6 step 2.
- **`stop`** with `dirty`, `unfinished` or `not-the-merge`: `<WT>` is not as `sync` expects. Quote `message` and go
  to phase 6 step 2.
- **`stop`** with `base-gone`, `merged`, `not-due` or `fetch-failed`: as for the pull request below.

## Opening it

Write `$TMP/<P>-pr.md`. Its first line is `Part of #<P>`. Below it, in the repository's language, it says that the
pull request brings project `#<P>` into `<from>`, lists each sub-issue closed as completed as `#<k> <title>` with its
pull request `#<m>` from `project.sh <P>`, names the stubs and the issues closed as not planned, and says that the
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
