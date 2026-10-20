# The shape of a project on GitHub

This file is the only description of how a project is laid out on GitHub. All three skills below read it, so a
change here is a change to all three.

## The three skills

| Skill | What it does |
| --- | --- |
| `pj-design-and-plan` | designs the whole in broad strokes, splits it into tasks, and files a parent issue and one sub-issue per task with the decisions it needs |
| `pj-design-details` | settles each sub-issue's decisions with the user, draws the stubs, resolves the blockers, and labels an issue `ready` |
| `pj-running` | works through the workable issues one pull request at a time, running the `workflow` skill on each and merging it before the next starts |

## Principle

**GitHub holds all the state.** The issues, their labels, their relationships, their comments and the pull requests
are the whole project. A project can stop anywhere and pick up again from another session, another day or another
machine.

Two things live outside GitHub, and only these two:

- **the user's approval within a run.** An approval covers the run it was given in. The next run asks again.
- **the stash of the work in flight**, which `pj-running` leaves when it stops in the middle of an issue. It is
  local. A resume never applies it. The work is redone as the issue's one task, or as its integration review.

## Requirements

- `gh` 2.94.0 or later. That release added `--parent`, `--blocked-by`, `--blocking` and the `parent`, `subIssues`,
  `blockedBy` and `blocking` fields to `gh issue`.
- `gh` logged in.
- Issues turned on in the repository.

```bash
gh --version
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef
```

## The parts

| Part | On GitHub |
| --- | --- |
| The project | one **parent issue**. Its body holds the overall design. |
| A task | one **sub-issue** of the parent. One task becomes one pull request. |
| An order between tasks | a native **blocked by** relationship. Never written into a body. |
| A task that can be implemented straight from its body | the **`ready`** label |
| Something `pj-running` stopped on | the **`blocker`** label |

The parent never gets `ready` and is never worked on. It closes once every sub-issue is closed, after the user says so.

### Labels

| Label | Color | Description |
| --- | --- | --- |
| `ready` | `0E8A16` | Every decision is settled and the body can be implemented as it stands. pj-running may work on it. |
| `blocker` | `B60205` | pj-running stopped on this. Settle it before anything else. |

**Make sure a label exists right before a skill first adds it in a run.** Create it only when the repository does not
have it. **Never pass `--force`.** It would overwrite the color and the description of a label the repository already
uses. An existing label is reused as it is.

```bash
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx ready || gh label create ready --color 0E8A16 --description "Every decision is settled and the body can be implemented as it stands. pj-running may work on it."
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx blocker || gh label create blocker --color B60205 --description "pj-running stopped on this. Settle it before anything else."
```

### Relationships

Dependencies live in GitHub's own relationships, so the issue page shows them and a command can read them. **Never
also list them in a body.** Two copies drift apart.

```bash
gh issue create --parent <P> --blocked-by <n>,<m> --title "<title>" --body-file <file>
gh issue edit <n> --add-blocked-by <m>
gh issue edit <n> --remove-blocked-by <m>
```

**No cycles.** After any change to the relationships, run `project.sh <P> --order`. It fails and names the cycle when
there is one. Undo the edge that made it.

## Reading a project

`project.sh` sits next to this file, in `scripts/project.sh`. It reads the parent and every sub-issue in one GraphQL
query plus one `gh pr list`, and writes nothing to GitHub. **It is the only parser of a sub-issue body.** Every skill
and the issue writer go through it. Pass `-R <owner/repo>` to read a repository other than the current one.

```bash
project.sh <P>               # the whole project, as JSON
project.sh <P> --order       # the open sub-issues in dependency order, as a JSON array of the same issue objects
project.sh <P> --check <n>   # whether sub-issue <n> can be implemented from its body now (see When an issue is ready)
project.sh --lint <file>     # the lint of one body, from a file, or from standard input with -
```

`project.sh <P>` prints:

```
{"parent": {"number", "title", "state", "updatedAt", "body"},
 "issues": [{"number", "title", "state", "updatedAt", "readyAt", "labels": [names],
             "blockedBy": [{"number", "state"}], "blocking": [numbers],
             "pr": {"number", "isDraft", "url"} or null, "stub",
             "files": [{"path", "kind", "symbols": [names]}], "designPaths": [paths],
             "decisions": {"total", "settled", "open", "contradictory"},
             "lint": {"ok", "reasons": [codes]}}]}
```

- `readyAt` is the time of the last `ready` labelled event on the issue, or null.
- `pr` is the issue's pull request (see **Pull requests**), or null.
- `stub` is true when `## Design` reads `To be drawn.`.
- `files` is the file list that opens `## Design` (see **The file list**), and `designPaths` is its paths.
- `decisions` counts the `### D<n>.` entries by how many boxes each has checked (see **Decisions**).
- `lint` is what `--lint` prints for the body (see **When an issue is ready**).

`--lint` needs no parent and touches neither GitHub nor git. It prints `{"ok", "reasons"}` and exits 0 whatever the
result. The issue writer runs it on a body before returning it:

```bash
project.sh --lint - <<'EOF'
<the body>
EOF
```

`--check <n>` runs inside a clone of the repository. It fetches the default branch from origin, which moves local refs
and nothing else, and prints:

```
{"number", "ok", "lint": {"ok", "reasons"},
 "premises": {"evaluated", "failures": [{"path", "symbol" (when one is missing), "why"}]},
 "history": {"stale": [{"sha", "subject", "pr" or null}]}}
```

`ok` is true when the lint is clear, no premise failed and no commit is stale. `evaluated` is false while a blocker is
still open (see **Is the body still current?**).

`--order` puts a blocker before what it blocks. Only open sub-issues of the same parent count as blockers here. Among
the issues free to go next, the one more open issues wait on, directly or not, goes first, then the lower number.

**Finding the project when no number was given.** List the open issues that have open sub-issues, the most recently
updated first, and ask the user which one with `AskUserQuestion`.

```bash
gh issue list --state open --limit 100 --json number,title,updatedAt,subIssuesSummary --jq '[.[] | select(.subIssuesSummary.total > .subIssuesSummary.completed)] | sort_by(.updatedAt) | reverse'
```

## The parent issue body

```markdown
## Goal

<what is true once every sub-issue is closed, in a few sentences>

## Design

<the boundaries every task has to match: contracts, types, schemas, names, and why a new abstraction is needed
if one is added>

## Decisions

<the plan-level answers the user gave, each one settled, in the shape of a sub-issue decision. None. when there were none>

## Out of scope

<what the request might be read to include and this project leaves alone>
```

The task list is the sub-issue list GitHub draws under the body. Never write a second one by hand.

### The handover comment

The parent carries one comment that starts with `**[pj-running]** Handover notes`, fifteen lines at most below that
line. It holds what the workflow sessions learnt about working in this repository: the commands that run the tests,
the conventions kept, the traps hit.

`pj-running` reads it at the start of a run and rewrites it in place after every merge. Before a rewrite, read the
comment's `updated_at` again and work in any change a human made since.

```bash
gh api "repos/{owner}/{repo}/issues/<P>/comments" --paginate --jq '.[] | select(.body | startswith("**[pj-running]** Handover notes")) | {id, updated_at, body}'
gh api -X PATCH "repos/{owner}/{repo}/issues/comments/<id>" -F body=@<file>
gh issue comment <P> --body-file <file>    # the first time, when there is none
```

## The sub-issue body

```markdown
## Goal

<what this task makes true, in one or two sentences>

## Design

- `<path>` (changed): <what changes, naming the existing symbols it rides on, such as `retryJob`>
- `<path>` (added): <what it holds, naming the file or symbol it follows>

<optional prose: how the pieces fit. Written as if every decision below were already made the way it is checked>

## Acceptance criteria

- <what has to hold for this task to be done, with a backticked anchor: a test name, a command, or a file or symbol
  whose state is checked>

## Decisions

### D1. <the question, as a question>

<why it matters here: what each choice changes in the code, and what else it reaches>

- [ ] <option A>
- [ ] <option B> (recommended)

### D2. ...

## Out of scope

<what a worker might be tempted to do here and must leave alone>
```

The bar for a body is in **When an issue is ready**.

### The file list

`## Design` opens with one bullet per file the task touches, tests included.

```markdown
- `src/retry.ts` (changed): replaces `RETRY_MAX` in `retryJob` with the count from the settings
- `src/retry.test.ts` (changed): adds `retries as many times as settings say` beside the `retryJob` cases
- `src/settings/schema.ts` (added): follows `src/settings/flags.ts`, exports `RetrySettings`
```

- The path is a repository path in backticks. A file at the root is written as it is, such as `Makefile`.
- The kind is `added`, `changed` or `deleted`.
- The description follows the colon. **Its backticked identifiers are the entry's symbols.** `foo()` counts as `foo`
  and `A.b` as `b`. A backticked span with spaces, such as a test name, is no symbol.
- **A `changed` entry names at least one symbol, and every symbol it names already exists in that file.** `--check`
  looks each one up. A new name, or a name from another file, goes without backticks or into its own file's entry.
- Each entry is one bullet. A long description may wrap onto indented lines, and blank lines between entries are
  allowed. The list ends at the first line that is neither a bullet nor indented.
- Prose after the list is optional.

### Decisions

**The checkboxes in `## Decisions` are the only checkboxes in the body.** GitHub counts the boxes in an issue list
("1 of 3 tasks"), so that count reads as how many decisions are settled. Acceptance criteria are a plain list for that
reason.

- Each decision is `### D<n>. <question>`, then why it matters, then **2 to 4 options** as `- [ ]` lines.
- `(recommended)` marks the option the writer would pick. **Exactly one option per decision carries it.**
- **A decision is settled when exactly one of its boxes is checked.** No box checked means open. Two or more checked
  is a contradiction to raise with the user.
- **A box a human ticks on GitHub counts the same** as one a skill checks. The skills read the body and do not care
  who checked it.
- **An answer that is none of the options** becomes a new option line, checked.
- Once settled, a line goes under the options, starting with `Decided:`, with the reason in one or two sentences.
- `D<n>` is never renumbered, even when a decision is dropped. Elsewhere a decision is referred to as `#<issue> D<n>`.

```markdown
### D1. Where does the retry count live?

The worker reads it on every job, and the admin screen writes it.

- [ ] An environment variable
- [x] A column on `settings` (recommended)

Decided: the admin screen has to change it without a deploy.
```

**A sub-issue with no decisions** writes `None.` under `## Decisions`. It gets `ready` as soon as it is filed, when its
lint is clear.

### Stubs

A stub is a sub-issue filed for work found along the way, before anyone has drawn it. `## Goal` says what was found,
why it matters, and which issue it was found in. Every other section reads `To be drawn.`.

```markdown
## Goal

<what was found, why it matters, and that it was found while working on #<n>>

## Design

To be drawn.

## Acceptance criteria

To be drawn.

## Decisions

To be drawn.

## Out of scope

To be drawn.
```

**A stub never carries `ready`.** `pj-design-details` draws it into a full body first.

## Fixed tokens

These stay in English whatever language the repository uses, because the skills and `project.sh` match on them:

- the section headings of both bodies, and `### D<n>.`
- `(recommended)`, `Decided:`, `None.` and `To be drawn.`
- the kinds in the file list: `added`, `changed` and `deleted`
- the markers (see **Comments**)
- in a pull request body, `Closes`, `Part of`, `## Plan` and `Integration review`

Everything else is prose in the repository's language.

## When an issue is ready

`ready` goes on when all of these hold:

- every decision under `## Decisions` has exactly one box checked, or it reads `None.`
- `## Design` reads as the decisions say, with no "depending on D1" left in it
- nothing in the body contradicts the parent's `## Design`
- **it can be implemented straight from its body.** A worker who reads only this body, the parent's `## Design` and
  the code finds nothing left to design. `project.sh` checks the part of this a script can see, as a lint:

| Code | Fails when |
| --- | --- |
| `stub` | the body is a stub |
| `sections` | the five headings are not all there, in order |
| `no-files` | the file list is empty |
| `too-many-files` | the list names more than 8 paths, tests included |
| `file-entry` | an entry has no kind or no description |
| `no-symbols` | a `changed` entry names no symbol |
| `criteria` | there is no acceptance criterion, or a criterion has no backticked anchor |
| `decision-shape` | a decision does not have 2 to 4 options, or does not have exactly one `(recommended)` |
| `decisions-open` | a decision is open |
| `decisions-contradictory` | a decision is contradictory |

**The limit is 8 files.** An issue over it is split into another pull request, and 8 files still keep the review in one
sitting.

Only a skill or a human adds `ready`. Ticking boxes on GitHub settles decisions and leaves the label alone.

Who checks, and when:

| Skill | When | Accepts |
| --- | --- | --- |
| `pj-design-and-plan` | before filing | a lint whose only reason is `decisions-open` |
| `pj-design-details` | before adding `ready` | `--check` with the lint clear, and the premises clear or not evaluated yet |
| `pj-running` | before showing the order, for every issue in it, and again right before each issue starts | a clear `--check` |

An issue is **workable** when it carries `ready`, every issue in its `blockedBy` is `CLOSED`, and `--check` is clear.

### Is the body still current?

A body is drawn against the code of its day. `--check` asks whether it still holds at the tip of the default branch.

- **Premises.** Every `changed` and `deleted` path exists, and no `added` path does. Every symbol of a `changed` entry
  is still found in its file. The premises are evaluated **only once every `blockedBy` is closed**. Until then the
  blockers are still meant to change these files, and the result reads not evaluated.
- **History.** Every commit on the default branch's first-parent line since `readyAt` that touched a path in the file
  list is a candidate. A candidate is **anticipated** when a merged pull request it came from closes an issue in this
  issue's transitive `blockedBy`: its blockers, their blockers, and so on through the project, closed issues
  included, plus direct blockers outside the project. Every other candidate is **stale**. With no `readyAt` there is
  no history.

The design was written knowing its blockers would land first, so their commits were foreseen. A commit from anywhere
else that touched these files was not.

`ready` comes off when something changes what the body says, such as a decision elsewhere. **Whoever takes it off
leaves a comment** on the issue saying what changed and where. A skill marks that comment (see **Comments**).

## Blockers

`blocker` marks what `pj-running` stopped on. It goes in one of two places.

1. **On a stub that blocks the stopped issue.** The work found lies outside the issue in hand, and the issue cannot be
   finished without it. The stub is a sub-issue of the same parent, and the stopped issue is blocked by it.

   ```bash
   gh issue create --parent <P> --blocking <n> --label blocker --title "<title>" --body-file <file>
   ```

2. **On the stopped issue itself, with `ready` taken off.** Its own body no longer holds: `--check` failed, the
   implementation reported `Diverged:`, or the code contradicts one of its settled decisions.

   ```bash
   gh issue edit <n> --remove-label ready --add-label blocker
   gh issue comment <n> --body-file <file>
   ```

Either way a marked comment on the stopped issue says what diverged, and names the decision as `#<issue> D<n>` when
there is one.

`pj-design-details` resolves both. A blocker that needs no code of its own is resolved by rewriting the issue in
question. A stub blocker resolved that way is then closed with a marked comment that points at the rewrite.

```bash
gh issue comment <m> --body-file <file>
gh issue close <m> --reason completed
```

A blocker on the issue itself loses `blocker` when it gets `ready` back.

**Whenever `pj-running` takes `ready` off an issue, it adds `blocker`.** An issue it stopped on is then always the
first thing `pj-design-details` shows.

## Comments

Every comment a skill's main session posts starts with a bold marker, then the text.

| Marker | Posted by |
| --- | --- |
| `**[pj-design-details]**` | `pj-design-details` |
| `**[pj-running]**` | `pj-running`, and `workflow` when `pj-running` drives it |

**A comment with no marker is from a human.** A skill reads it as one.

`pj-design-and-plan` files issues and posts no comments. Pull request review happens in difit, so a pull request
carries no review-thread markers.

## Pull requests

**One pull request per sub-issue.**

- Title: the issue's title.
- Base: the default branch.
- Branch: follows the repository's naming and contains the issue number.
- **The pull request of an issue** is the open pull request whose `closingIssuesReferences` names it. `project.sh`
  reports it as `pr`.
- A pull request exists only once the issue's task is committed. It stays a draft until just before the merge.
- Merge with squash, else a merge commit, else rebase, the first one the repository allows. Always `--delete-branch`.
  Never `--admin`.

The body begins with this head:

```markdown
Closes #<n>
Part of #<P>

## Plan

- [x] <issue title> (<short sha>)
- [ ] Integration review
```

`## Plan` has exactly these two lines, because an issue is one task. The first is checked with its commit once the
task passed review. The second is checked once the integration review passed. Below the head goes `workflow`'s
`log.md`, or a paragraph saying why the work stopped and where.

## Writing bodies

- **Write in the language the repository uses.** Look at the README and recent issues. Where the repository gives
  nothing to go on, write in the language the user is using. Talk to the user in the user's language.
- **Never point at a file by line number.** Point with a path and a symbol name.
- **Always pass a body with `--body-file`.** A body passed with `--body` on the command line breaks on quotes and
  backticks.
- **Re-read `updatedAt` right before an edit.** When it moved since you read the body, someone changed the issue in
  the meantime. Read it again and keep their change in what you write. Never overwrite a body you have not read.
