# CLAUDE.md

## The plugin version

Users get a change to `plugins/annetaan/` only through a new `version` in `plugins/annetaan/.claude-plugin/plugin.json`. `bash tests/plugin-version.sh` fails until that version is above origin's default branch, and `bash tests/plugin-version.sh --bump`, run from the repository root, writes it. Nobody edits the version by hand.

The `version` line that `--bump` writes belongs to every change under `plugins/annetaan/`, whatever file list the change works from. A workflow task, a run from an issue and a merge each run `--bump` when the check fails, and commit that line with their own change. It is not `Unplanned:` work, and a review does not count it as work outside the task. Any other change to `plugin.json` still has to be in the file list.
