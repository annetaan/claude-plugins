# The work report and the pull request

## The work report

**A session that worked on the code writes the work report, in every mode. Do not write it yourself.**

- When **Bringing the base in** in `standalone.md` ran the merge task, that implementation session is alive. `SendMessage` it. This
  comes before the cases below.
- When phase 5 was skipped, the last task's implementation session is still alive (phase 4 (d)). `SendMessage` it.
- When the integration review asked for fixes, that implementation session is still alive. `SendMessage` it.
- When the integration review approved with nothing to fix, no session is left. Start one with the phase 3 prompt, carrying the progress and the handover notes, and ask it for the report and nothing else.

The request:

> Write a work report at `<WORKDIR>/log.md`. If this repository has `.github/PULL_REQUEST_TEMPLATE.md`, use it as the skeleton. Otherwise read a few recent merged pull requests (`gh pr list --state merged --limit 5`) and follow how they are written. With nothing to go on, choose a structure yourself. Whatever structure you choose, a reader has to come away with: what changed, how it was verified (the commands that were run and what they printed), what the review changed, read from the files under `./review/`, the screenshots if the change shows on screen, and which commit answers which task in the plan. Screenshots sit in the same directory, so link them relatively, as `![before](./before.png)`. Write it in the language this repository uses. **Do not create files outside this directory.**

<the worktree line>

**Keep the file name `log.md`.** Claude Code refuses a Write from a sub-agent when the name of the `.md` file
starts with `report`, `summary`, `findings` or `analysis`, in any case ("Subagents should return findings as text,
not write report files."). Nothing in settings, the environment, CLAUDE.md or agent frontmatter turns that off.

**Hand it what only you still have.** One line per task on what the review changed, and the test and type check
results the earlier sessions reported, and, when the merge task ran, the files it resolved. Those sessions are gone, and that part of the history now lives in your
context and nowhere else.

Drop the diff next to it, so the report and the review files can be read against it. The three dots take the diff
from where the branch meets `origin/<base>`, which is what the pull request shows, with or without a merge of the
base.

```bash
git diff --output=<WORKDIR>/changes.diff origin/<base>...HEAD
```

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

- **`--attach` needs gh 2.99.0 or later**, and it works on GitHub.com and GitHub Enterprise Cloud. See below for older versions.
- **Run it from `<WORKDIR>` and pass the same relative paths the report uses.** gh replaces a path the body already references with the uploaded URL, and appends the attachment when it finds no reference. `./before.png` in the body and an absolute path on the flag do not match, so the images land at the bottom in the wrong order.
- Alt text follows the path after `#`. Left out, the filename becomes the alt text. Write what the picture shows.
- Videos attach the same way and render as a player, without alt text. Use one to show a sequence of interactions.
- Fifty files per command. A failed upload still creates the pull request and only sets a non-zero exit code. **Check the exit code and read the body back.** Reattach what fell out with `gh pr edit <number> --attach`.

**When `attach` is false and there are screenshots**, create the pull request without `--attach`
(`gh pr create --base <base> --title "..." --body-file <WORKDIR>/log.md`, with no `cd` needed),
then tell the user in the final message, with `<version>` from `gh` in `worktree.sh start`'s output:

> `before.png` and `after.png` could not be attached automatically. `--attach` needs gh 2.99.0 and this machine has `<version>`. Drag both files onto the pull request body for now. `brew upgrade gh` and the next run attaches them by itself.

List the file paths and the pull request URL alongside. **Say nothing about the gh version when the change produced no screenshots.**

When the push fails, quote the error and go to **Report to the user** in `standalone.md`. The branch and its commits stay in `<WT>`. When `gh pr create` exits non-zero, run `gh pr view <branch> --json url` first. If a pull request exists (a failed upload still creates one), carry on with its URL and the reattach step above. If none exists, quote the error and go to **Report to the user** in `standalone.md`. Otherwise carry the pull request URL into **Report to the user** in `standalone.md`.
