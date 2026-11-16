---
name: pr-humans
description: Records how people took part in a pull request, open, merged or closed, as one comment on it - where the work came from, what a person decided (boxes ticked in a pj sub-issue's Decisions, designs approved, questions answered) and what a person edited or reviewed by hand. Reads GitHub, the Claude Code conversation logs on this machine and workflow's work reports, marks each line confirmed or inferred, and says plainly when it cannot tell. Takes one pull request, a list or range, a pj project, a GitHub search, or every pull request not yet recorded, and rewrites its own comment when run again. Use it only when the user names this skill or invokes /annetaan:pr-humans, because it posts comments on GitHub.
---

# pr-humans

Leaves one comment on each pull request saying how people took part in the work: **origin**, **decisions**, and
**hand edits and review**. Read across many pull requests, the comments show where people steered the work and where
the agents ran on their own.

You resolve the pull requests, gather what is known about each one with a script, have one writer per pull request
draft its comment, and post the drafts. **You do not draft a comment yourself.** The writers keep the logs out of your
context.

## Paths: `$PRH`

**`$PRH` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory. It is not a shell variable.
Replace it with the real absolute path in every command and in each writer's prompt.

The script is `$PRH/scripts/pr-humans.py`, written `pr-humans.py` below. Run it with `python3`. Every subcommand
prints one JSON object. Exit 2 is a usage error and exit 1 an unexpected failure: quote the message and stop.

**Language**: talk to the user in the user's language, and have the comments written in it too.

**A URL you give the user stands between spaces**: only a plain space or a line break touches either end, never a
bracket, quote or full-width punctuation, so that a terminal opens the right page.

## Before you start

This skill posts comments on GitHub. **Start it only when the user names it or invokes `/annetaan:pr-humans`.**

```bash
git rev-parse --show-toplevel
gh auth status
```

Either one failing stops the skill. Say which one and stop.

## 1. The pull requests

Turn the request into `targets` arguments:

| The user says | Arguments |
| --- | --- |
| one or more numbers, `#60 #62` | `60 62` |
| a range, `#60-#73` or "60 to 73" | `60-73` |
| a pj project, by its parent issue | `--project <P>` |
| a period, an author, a label: anything GitHub search takes | `--search "<query>"`, for example `--search "author:@me created:>=2026-10-01"` |
| every pull request | `--all` |
| only those nobody has recorded yet | add `--unrecorded`; alone it means all of them |

```bash
python3 $PRH/scripts/pr-humans.py targets <arguments>
```

**When the user names nothing**, take the pull request of this session: the one this session opened, or else the one
for the current branch (`gh pr view --json number,url`). When there is none, ask which pull request, and stop if
the answer names none.

`prs` lists each pull request with `state`, `recorded` (this account already has a pr-humans comment on it) and
`recordedBy`: `"me"` (this account's record), `"other"` (another account holds one) or `null` (no record by anyone).
`--unrecorded` keeps only those with no record by anyone. `notPullRequests` lists numbers that are issues or do not
exist: mention them in one line when the user named them, not when they fell inside a range.

**A pull request with `recordedBy: "other"` is left out of the list.** Say so in one line each,
`#<n>: another account holds its record, so it is left out`. Do not gather it and do not count it. Decide by what is
left:

- **None**: say so and stop.
- **One**, however the user named it (a number, a range, a search, or this session's pull request): go on and ask
  nothing.
- **Two or more**: show them, one line each, `#<n> <state> <title>`, with `(rewrites its record)` on those with
  `recordedBy: "me"`. Then ask once:

  ```
  AskUserQuestion: Record how people took part in these <k> pull requests, as a comment on each?
    - Record them
    - Do not record them
  ```

  On `Do not record them`, stop. The answer covers this list only.

## 2. Gather

Run `mktemp -d` once. `<TMP>` below is the directory it printed. A shell variable does not outlive one command, so
write the path in full each time. Each pull request goes into `<TMP>/<n>`:

```bash
python3 $PRH/scripts/pr-humans.py gather <n> --out <TMP>/<n>
```

Run them one after another; each takes a second or two. Keep the summary each prints (`issues`, `parents`,
`humanCommits`, `sessions`, `humanTurns`, `reports`, `previous`). Do not open the files it wrote. They hold whole
conversation logs. `previous.md` is for the writer.
**In the session that opened the pull request**, the log of this very session is on disk and `gather` finds it, so
the writer reads what you see. You do not need to write anything down for it.

## 3. Draft

Start one `annetaan:pr-humans-writer` per pull request, in parallel, at most five at a time. The prompt:

```
Role instructions: $PRH/roles/writer.md (read it first)
Gathered files: <TMP>/<n>
Language: <the user's language>
Today: <YYYY-MM-DD>
Write the comment to <TMP>/<n>/comment.md.
```

Each writer returns one line. Keep it for the report. A writer that fails or returns no line: run it once more, then
leave that pull request out and say so.

## 4. Post

```bash
python3 $PRH/scripts/pr-humans.py post <n> <TMP>/<n>
```

`post` reads `<TMP>/<n>/comment.md` and checks it against `sessions.json`, `reports.json`, the directory and `$HOME`.

`post` finds the comment it posted before by its marker and rewrites it, or creates one. Each pull request keeps a
single record.

- `action` `created` or `updated`, with `url`: done.
- exit 3, `status` `stop`, with `problems`: the draft holds what must never be public. `local-path` (a path on this
  machine), `session-id` (a log file or session id), `mention` (a bare `@login`, which notifies someone). Send the
  problems back to that writer with `SendMessage` to fix the draft, then post again. A working directory or log file
  named in `sessions.json` is also a `local-path` (a cwd is not a `session-id`; that is only a session's name), so
  tell the writer to drop such paths. If the second draft fails too, leave the pull request out and say so.
- exit 3 with `no-draft`: the writer left no `comment.md`, or an empty one, though it returned its line. Run that
  writer once more, then post again. If there is still none, leave the pull request out and say so.
- exit 3 with `recorded-by-other`: another account's record appeared after `targets`. Leave that pull request out,
  do not send it back to the writer, and say so in the report.

## Report to the user

One line per pull request: `#<n>` and the comment's URL, `created` or `updated`, and the writer's line. List those
gathered with `previous: true` as having "rewrote its record", too. Then the pull requests left out, with why. For
one pull request, show the comment's text as well, read from the draft.

## Rules

- At most one approval question, and only when two or more pull requests are left to record.
- Never rewrite another account's record.
- Never write to GitHub except through `pr-humans.py post`, and never edit a pull request's body, an issue or a label.
- One comment per pull request, found by its marker `<!-- annetaan:pr-humans -->`. Never post a second one.
- Never put a person's words in quotes, a local path, a session id or an `@mention` in a comment. The writer
  summarises, and `post` refuses what slips through.
- When nothing shows how a person took part, the comment says it does not know. It never fills the gap with a guess.
