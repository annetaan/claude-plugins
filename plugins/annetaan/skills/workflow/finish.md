# The work report and the pull request

> This file is read by the main session that loaded the workflow skill. The paths it uses are the ones **Paths: `$FLOW`** in SKILL.md gives.

## The work report

**A session that worked on the code writes the work report, in every mode. Do not write it yourself.**

First write the request:

```bash
$FLOW/scripts/flow.sh prompt <WT> report
```

It asks for `<WORKDIR>/log.md`: what changed, how it was verified per acceptance criterion and flow from the newest
evidence files, what neither the implementation nor the review could run, the `check wanted:` lines of
`<WORKDIR>/checks.md`, the model decisions, what the review changed, the files a merge resolved, the screenshots, and
which commit answers which task. Send its line to the session that worked on the code:

- When **Bringing the base in** in `standalone.md` ran the merge task, that implementation session is alive. `SendMessage` it. This
  comes before the cases below.
- When phase 5 was skipped, the last task's implementation session is still alive (the entry keeps it after phase 4 (d)). `SendMessage` it.
- When the integration review asked for fixes, that implementation session is still alive. `SendMessage` it.
- When the integration review approved with nothing to fix, no session is left. Start `annetaan:workflow-worker`
  with the line and the `model` and `effort` the JSON prints (**The prompts** in SKILL.md). The prompt names the role,
  the run's files and the progress, so it serves a session started for the report alone.

**Keep the file name `log.md`.** Claude Code refuses a Write from a sub-agent when the name of the `.md` file
starts with `report`, `summary`, `findings` or `analysis`, in any case ("Subagents should return findings as text,
not write report files."). Nothing in settings, the environment, CLAUDE.md or agent frontmatter turns that off.

Drop the diff next to it, so the report and the review files can be read against it. The three dots take the diff
from where the branch meets `origin/<base>`, which is what the pull request shows, with or without a merge of the
base.

```bash
git diff --output=<WORKDIR>/changes.diff origin/<base>...HEAD
```

Then write the head and the `Level:` line into `log.md`:

```bash
$FLOW/scripts/flow.sh record <WT>
```

It reads the `run.json` that `flow.sh begin` wrote. When the run comes from an issue, it writes the head, `Implements #<issue>` and `Part of #<parent>`, at the top of `log.md`, in place of any head already there. It appends one `Level:` line, with what `begin` stored and the review counts, to the end, so the pull request body carries both. A `stop` (`no-log`, `no-review`, `malformed`) is a failed step of the finish: quote `message` and go to the entry's ending, as for a failed push. `malformed` names each round file under `review/` that fails `flow.sh lint`, with its reasons.

Then open the pull request.

## The pull request

```bash
git push -u origin <branch>
```

**When the change shows on screen, the screenshots go into the pull request.** Which ones depends on the change.

- **A new piece of UI** (a screen or component that did not exist): one shot of the finished state. There is nothing to compare against, so no before shot.
- **A change visible on an existing screen**: **before and after, both of them.** One on its own leaves a reviewer unable to tell what moved.
- **A change that never reaches a screen** (internals, CI, documentation): none.

Use the shots the implementation sessions took while they worked the tasks. If they are missing, `SendMessage` the session that wrote the report and have it take them before the pull request goes up. **Do not start the app and take them yourself.**

```bash
cd <WORKDIR>
```

```bash
gh pr create --base <base> --title "..." --body-file log.md \
  --attach './before.png#Before: the list has no filter bar' \
  --attach './after.png#After: a filter bar sits above the list'
```

- **`--attach` needs gh 2.99.0 or later**, which **The start check** in `worktree.md` has confirmed, and it works on GitHub.com and GitHub Enterprise Cloud.
- **Run it from `<WORKDIR>` and pass the same relative paths the report uses.** gh replaces a path the body already references with the uploaded URL, and appends the attachment when it finds no reference. `./before.png` in the body and an absolute path on the flag do not match, so the images land at the bottom in the wrong order.
- Alt text follows the path after `#`. Left out, the filename becomes the alt text. Write what the picture shows.
- Videos attach the same way and render as a player, without alt text. Use one to show a sequence of interactions.
- Fifty files per command. A failed upload still creates the pull request and only sets a non-zero exit code. **Check the exit code and read the body back.** Reattach what fell out with `gh pr edit <number> --attach`.
- A screenshot still missing from the body after `gh pr edit <number> --attach` goes into the final message, with its path and the pull request URL.

When the push fails, quote the error and go to the entry's ending: **Report to the user** in `standalone.md`, or **The stop procedure** in `from-issue.md`. The branch and its commits stay in `<WT>`. When `gh pr create` exits non-zero, run `gh pr view <branch> --json url` first. If a pull request exists (a failed upload still creates one), carry on with its URL and the reattach step above. If none exists, quote the error and go to the entry's ending, as for a failed push. Otherwise go to **The decisions** with the pull request, then carry its URL into the entry's ending.

## The decisions

It runs once the pull request exists, with `<m>` as its number, the number at the end of its URL. Seat a reads the whole change and names the design decisions in technology, infrastructure, database or delivery that the run made on its own, and `flow.sh decisions` files each one as an issue labelled `decision`. **Nothing here holds the pull request back or counts as a failed step of the finish.** A non-zero exit of `flow.sh decisions` is quoted for the entry's ending like a stop, and does not stop the run, because the pull request already exists.

The seat sessions of the last review have ended. This is a new seat a session, at every level, and it ends after step 2.

1. **Start seat a.** Write its prompt:

   ```bash
   $FLOW/scripts/flow.sh prompt <WT> decisions
   ```

   It names `<WORKDIR>/design.md`, `<WORKDIR>/plan.md`, what the user settled, `<WORKDIR>/changes.diff`, `<WORKDIR>/log.md` and `Write: <WORKDIR>/decisions.md`. Start `annetaan:workflow-reviewer-a` with its line and the `model` and `effort` the JSON prints (**The prompts** in SKILL.md). When the seat returns and `<WORKDIR>/decisions.md` does not exist, start the seat once more with the same line.
2. **File the issues.**

   ```bash
   $FLOW/scripts/flow.sh decisions <WT> <m>
   ```

   - **`ok`**: keep `filed` for the entry's ending. An empty `filed` means no decision fell in the four areas.
   - **`malformed`**: `SendMessage` the seat one line that forwards `message` and names `<WORKDIR>/decisions.md`, and run step 2 once more when it reports.
   - **`malformed` a second time, `no-decisions`, `gh` or `no-run`**: keep `message` for the entry's ending, and go on.
