# How the pj skills work together

This file holds what `pj1-plan`, `pj2-issues`, `pj3-doctor` and `pj4-running` agree on between them: who creates
the base branch, the labels, the comments, the pull requests and how they write to GitHub. All four skills read it
first.
The project reviewer looks up **Blockers**, and the `workflow` skill's **From an issue** looks up **Pull requests**.
The issues and their bodies are in `format.md`, and how `project.sh` judges a project is in `state.md`, both next to
this file.

## The four skills

| Skill | What it does |
| --- | --- |
| `pj1-plan` | designs the whole in broad strokes, cuts it into projects of up to ten tasks, and files one parent issue per project, with blocked-by relationships between the parents |
| `pj2-issues` | splits one project into tasks once every project it waits on is merged, and files its sub-issues with the decisions they need, the blocked-by relationships inside the project, the run order and the titles |
| `pj3-doctor` | reviews a whole project against the boxes the user ticked and the code, has the issue writers redraw what no longer holds, draws the stubs, resolves the blockers, rewrites the run order and the titles, and labels an issue `ready` |
| `pj4-running` | creates a project's base branch when it first starts on the project, then works down the run order one pull request at a time, running the `workflow` skill on each and merging it into the base branch before the next starts, and once every sub-issue is closed, opens the pull request from the base branch into the branch it was made from |

**The user decides by ticking boxes on GitHub.** Every question a task raises is a decision in its sub-issue
(`format.md`, **Decisions**). No skill asks a task's decision in the conversation. `pj1-plan` and `pj2-issues` ask
only the questions that change the cut into projects, the split into tasks, or a parent's `## Design`. `pj3-doctor`
talks with the user about everything else: a split, two boxes ticked in one decision, and its changes before they are
written.

## Principle

**GitHub holds all the state.** The issues, their labels, their relationships, their comments and the pull requests
are the whole project. A project can stop anywhere and pick up again from another session, another day or another
machine.

Two things live outside GitHub, and only these two:

- **the user's approval within a run.** An approval covers the run it was given in. The next run asks again.
- **the uncommitted work a stopped run leaves in its worktree** `<MAIN>/.claude/worktrees/pj-<P>`, where `<MAIN>`
  is the main working tree. It is local. The next run never uses it. The work is redone as the issue's one task.

The worktree itself is a place to work, not state. A run creates it when it is missing.

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

## The base branch

Only `pj4-running` creates `pj/<P>`. It does so when it starts on the project, the base branch does not exist yet,
and every project in `waitsOn` is `merged` (`state.md`, **When a project is merged**), which always holds for a
project that waits on none. It cuts the base branch from the tip of `<from>`, the branch the parent's `Base:` line
names after `from` (`format.md`, **The parent issue body**), through the GitHub API, in `run.sh start`
(`pj4-running/scripts/run.sh`).

A base branch cut later starts from a newer `<from>`, and conflicts less when it is merged back at the end.

Once every sub-issue is closed, `pj4-running` opens the pull request from the base branch into the branch it was made
from (see **Pull requests**). Merging it is a human's job. No skill merges it.

**Closing a parent** as completed means its project is merged. When `pj4-running` reads an open parent that is
`merged`, it closes it with a marked comment and `--reason completed`, both when it starts on that project and when
it starts on a project that waits on it. It closes it through `run.sh close`, which refuses a parent `project.sh` does
not read as `merged`. A human may also close it after merging. The merge itself is the human's job.

## Labels

| Label | Color | Description |
| --- | --- | --- |
| `ready` | `0E8A16` | Every decision is settled and the body can be implemented as it stands. pj4-running may work on it. |
| `blocker` | `B60205` | pj4-running stopped on this. Settle it before anything else. |
| `project` | `5319E7` | The parent issue of a pj project. Its sub-issues are the project's tasks. |

**Make sure a label exists right before a skill first adds it in a run.** Create it only when the repository does not
have it. **Never pass `--force`.** It would overwrite the color and the description of a label the repository already
uses. An existing label is reused as it is.

```bash
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx ready || gh label create ready --color 0E8A16 --description "Every decision is settled and the body can be implemented as it stands. pj4-running may work on it."
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx blocker || gh label create blocker --color B60205 --description "pj4-running stopped on this. Settle it before anything else."
gh label list --limit 1000 --json name --jq '.[].name' | grep -qx project || gh label create project --color 5319E7 --description "The parent issue of a pj project. Its sub-issues are the project's tasks."
```

Only `pj3-doctor` adds `ready`, after its project review, to an issue that meets the bar
for it (`state.md`, **When an issue is ready**). Ticking boxes on GitHub settles decisions and leaves the label
alone, so the user runs `pj3-doctor` after ticking.

The parent never gets `ready` and is never worked on.

**A stub never carries `ready`.** `pj3-doctor` has the writer draw it into a full body first.

`ready` comes off when something changes what the body says, such as a decision elsewhere. **Whoever takes it off
leaves a comment** on the issue saying what changed and where. A skill marks that comment (see **Comments**).

An issue loses `blocker` when it gets `ready`. `pj3-doctor` adds the one and removes the other in one
command.

**Whenever `pj4-running` takes `ready` off an issue, it adds `blocker`.** An issue it stopped on is then always the
first thing `pj3-doctor` takes up.

## Picking the project

`pj2-issues`, `pj3-doctor` and `pj4-running` always ask which project to work on, with `AskUserQuestion`, even when
they were given a number. List the open parents, and read the number they were given, if any.

```bash
gh issue list --label project --state open --limit 100 --json number,title,subIssuesSummary --jq 'sort_by(.number)'
gh issue view <n> --json number,state,labels,parent
```

The candidates differ by skill.

- **`pj2-issues`**: the open parents whose `subIssuesSummary.total` is 0. Read `project.sh <P>` for each one. First
  print every candidate, one line each, naming the entries of `parent.waitsOn` that are not `merged`:
  - `#<P> <title> (startable)` when `parent.startable` is true
  - `#<P> <title> (waits on #<Q>, closed without a merge)` when every such entry is `CLOSED`. That project is
    pickable too. The check of `pj2-issues` asks to remove those relationships
  - `#<P> <title> (waits on #<Q>, #<R>)` otherwise

  Only the startable and the pickable candidates become options. The recommended project is the number given when it
  is one of those, or else the lowest-numbered startable one, or else the lowest-numbered pickable one. The free-text
  answer accepts any `#<P>` from the list. A candidate that is neither goes to the check of `pj2-issues` itself, which
  refuses it. When no candidate is startable or pickable, print the list and stop without asking.
- **`pj3-doctor` and `pj4-running`**: the open parents whose `subIssuesSummary.total` is 1 or more. The recommended
  project is the parent of the number given when that is a sub-issue, or the number itself when it carries
  `project`. When the recommended project is not in the list, say so in one line and ask without a recommendation.
  First print every candidate, one line each: `#<P> <title> (<completed> of <total> sub-issues closed)`. The
  free-text answer accepts any `#<P>` from the list.

For every skill, the question has the header `Project` and at most 4 options: the recommended project first, marked
`(Recommended)`, then the rest by number. With one option only, the second option is `Stop`. When the list of
candidates is empty, stop.

## Titles

The count in a sub-issue title (`format.md`, **The title**) is written only by `pj2-issues` and `pj3-doctor`, each
with one title sync after its bodies are on GitHub. The sync is this block, run once per parent.

```bash
project.sh <P>
gh issue edit <k> --title "<wantedTitle>"   # each OPEN sub-issue whose wantedTitle differs from its title
```

- A closed issue is never retitled.
- A sync that fails partway leaves a stale count, and the next `pj3-doctor` run fixes it. Nothing reads the count to
  decide anything.
- `pj4-running` never writes a title.

## The handover comment

The parent carries one comment that starts with `**[pj4-running]** Handover notes`, fifteen lines at most below that
line. It holds what the workflow sessions learnt about working in this repository: the commands that run the tests,
the conventions kept, the traps hit.

`pj4-running` reads it at the start of a run and rewrites it in place after every merge. Before a rewrite, read the
comment's `updated_at` again and work in any change a human made since.

```bash
gh api "repos/{owner}/{repo}/issues/<P>/comments" --paginate --jq '.[] | select(.body | startswith("**[pj4-running]** Handover notes")) | {id, updated_at, body}'
gh api -X PATCH "repos/{owner}/{repo}/issues/comments/<id>" -F body=@<file>
gh issue comment <P> --body-file <file>    # the first time, when there is none
```

## Blockers

`blocker` marks what `pj4-running` stopped on. It goes in one of two places.

1. **On a stub that blocks the stopped issue.** The work found lies outside the issue in hand, and the issue cannot be
   finished without it. The stub (`format.md`, **Stubs**) is a sub-issue of the same parent, and the stopped issue is
   blocked by it.

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

`pj3-doctor` resolves both. A blocker that needs no code of its own is resolved by rewriting the issue in
question. A stub blocker resolved that way is then closed with a marked comment that points at the rewrite.

```bash
gh issue comment <m> --body-file <file>
gh issue close <m> --reason completed
```

## Comments

Every comment a skill's main session posts starts with a bold marker, then the text.

| Marker | Posted by |
| --- | --- |
| `**[pj3-doctor]**` | `pj3-doctor` |
| `**[pj4-running]**` | `pj4-running` |

**A comment with no marker is from a human.** A skill reads it as one.

`pj1-plan` and `pj2-issues` file issues and post no comments. The review of a pull request lives in the review files
of its work report (the `workflow` skill), so a pull request carries no review-thread markers.

## Pull requests

**One pull request per sub-issue.**

- Title: the issue's title. It carries no count, because `ready` needs every decision settled and `pj3-doctor`
  syncs the title before it adds `ready` (see **Titles**).
- Base: the base branch.
- Branch: follows the repository's naming and contains the issue number.
- **The pull request of an issue** is the one `project.sh` reports as `pr` (`state.md`, **Reading a project**).
- A pull request exists only once the task commit has passed review, so an open one has only the merge left. The next
  run of `pj4-running` merges it. It stays a draft until just before the merge.
- Merge with squash, else a merge commit, else rebase, the first one the repository allows. After the merge, delete
  the head branch on origin and locally. Never `--admin`.

The body begins with this head:

```markdown
Implements #<n>
Part of #<P>
```

Below the head goes `workflow`'s `log.md`.

The head is the first line with any text on it. GitHub ignores closing keywords such as `Closes` in a pull request
into a branch other than the default branch, so the merge closes nothing. `pj4-running` closes the issue itself after
the merge. An open issue whose `pr` is merged is a merge whose close never happened, and the next run of `pj4-running`
closes it.

### The project's pull request

**One pull request per project**, from the base branch into `<from>`. `pj4-running` opens it once every sub-issue is
closed, and never merges it.

- Title: the parent's title.
- Base: `<from>`. Head: the base branch.
- The body's first line is `Part of #<P>`. Below it go the sub-issues closed as completed, each with its pull request.

When it merges, the project is `merged` (`state.md`, **When a project is merged**).

## Writing to GitHub

- **Always pass a body with `--body-file`.** A body passed with `--body` on the command line breaks on quotes and
  backticks.
- **Re-read `updatedAt` right before an edit.** When it moved since you read the body, someone changed the issue in
  the meantime. Read it again and keep their change in what you write. Never overwrite a body you have not read.
