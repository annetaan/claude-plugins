# annetaan

Claude Code skills from Annetaan Inc., packaged as one plugin.

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

Install it once. As skills get added, run `claude plugin marketplace update annetaan` and
`claude plugin update annetaan@annetaan` in a shell to keep up, or turn on auto-update for the `annetaan`
marketplace in `/plugin`.

## Skills

A skill whose `description` matches a request normally starts without being named. The ones here do not. `workflow`
runs a long-lived local server, opens a browser and adds commits on its own. The pj skills create, edit and close
issues and labels on GitHub, and `pj-running` also creates each project's branch, pushes, opens and merges pull
requests. The doc skills make a file next to your document, rewrite the document itself, and can add one commit of
their own to `.gitignore` after asking. Any of these is enough reason to wait, so each skill here starts only when you
name it or invoke its slash form.

### workflow

`/annetaan:workflow` ([details](skills/workflow))

Runs one implementation through sessions with different jobs. A design session writes the plan, then details each
task as its turn comes. In a repository that accepts breaking changes, a design review session pushes the design
toward its ideal shape once, before approval. An implementation session writes the code for one task. A review
session reads it and posts findings. Those last two are new for every task. You approve once, near the start, and
answer two questions about where the commits go and how the run should end.

The review rounds happen in [difit](https://github.com/yoshiko-pg/difit), a local diff viewer. difit is the wire
between the implementation session and the review session, and it is also a web page. Open it and your comments
land in the same threads, on the same footing as the reviewer's.

```mermaid
flowchart TD
    req(["your request"]) --> design["design session<br/>boundaries, acceptance criteria,<br/>plan of small tasks"]
    design --> dreview["design review session<br/>once, where breaking<br/>changes are welcome"] --> ask["one approval<br/>1. proceed with this plan?<br/>2. new branch, or the branch you are on?<br/>3. pull request, push, or nothing?"]
    ask -->|rework| redo["design session<br/>revises, no second review"] --> ask
    ask -->|approved| setup["branch if asked<br/>work-reports/ ignored?<br/>record START"]
    setup --> detail

    subgraph task["per task"]
        direction TB
        detail["design session<br/>details this task against<br/>the code as it now stands"]
        impl["implementation session<br/>new for this task<br/>writes it, commits nothing"]
        difit["difit<br/>working tree vs HEAD"]
        review["review session<br/>new for this task<br/>posts findings as threads"]
        respond["implementation session<br/>replies, then fixes"]
        commit["one commit<br/>plus 5 lines of handover notes"]
        detail --> impl --> difit --> review
        review -->|"changes requested<br/>5 rounds per task, fixed"| respond
        respond --> difit
        review -->|approve| commit
        commit -->|tasks left| detail
    end

    commit -->|last task| integ["integration review<br/>difit: working tree vs START"]
    integ -->|changes requested| integfix["fix, then one more commit"]
    integfix --> integ
    integ -->|approve| report["work report<br/>work-reports/2026-09-19-1346-a1b2c3d/"]
    report --> pr["pull request<br/>log.md becomes the body"]
    report --> push["push only"]
    report --> local["nothing pushed"]

    you(["you, in the browser"]) -.->|comments| difit

    classDef human fill:#fff,stroke:#888,stroke-dasharray: 5 5
    class req,you human
```

The "per task" block repeats for every task in the plan, and nothing inside it runs in parallel, because there is one
working tree. Everything after the approval runs on its own. A task that passes review becomes one commit, so the
commit list reads back as the plan. A task that does not settle in five rounds comes back to you with the open
points laid out, and its changes stay uncommitted in the working tree.

`pj-running` drives the same flow for one issue at a time, with no design session, no approval and no questions,
because the issue is the approved design. See [Driven from an issue](skills/workflow/README.md#driven-from-an-issue).

Every run leaves a work report behind, inside the repository under `work-reports/` so that you notice them piling
up. The skill checks that git ignores that directory before it writes anything, and asks before touching
`.gitignore`.

### pj-design-and-plan, pj-design-details, pj-running

These three skills run a piece of work too large for one pull request as one or more projects on GitHub. A project
is a parent issue labelled `project`, which holds that project's design, plus one sub-issue per task, at most ten tasks
per project. The order comes from GitHub's own blocked-by relationships, and one may run from a task in one project to
a task in another. Each project's work lands on a branch of its own, `pj/` and the parent's number. `pj-running`
creates it on the project's first run, from a branch you pick when the projects are filed, the default branch unless
you name another. A project that waits on another gets its branch only after the other one is merged into that
branch. Every sub-issue's pull request merges into its project's branch. Merging that branch back into the branch it
came from is left to you. After that the parent is closed, by the next `pj-running` run or by you, and a closed
parent means its project is merged. A project of ten tasks gets back to the branch it came from sooner than one of
thirty. GitHub holds the whole state, so a project can stop and pick up again in another session or on another
machine. [format.md](skills/pj-design-and-plan/format.md) describes the shape.

`/annetaan:pj-design-and-plan` ([details](skills/pj-design-and-plan/SKILL.md)) starts with a planner session. It
draws the whole in broad strokes, splits it into tasks, and groups the tasks into projects of up to ten. You answer
the plan-level questions, approve the split and pick the branch the projects start from. Nothing reaches GitHub
before that. Then one issue writer per task, in parallel, draws its task against the code and picks out what you
have to decide. Each decision is written as checkboxes with one option recommended. The parents and their
sub-issues are filed. No branch is created yet.

`/annetaan:pj-design-details` ([details](skills/pj-design-details/SKILL.md)) asks which project to work on, every
time. A number you pass, of a parent or of one of its sub-issues, puts that project first. It then lines up the
project's issues without `ready` yet, `blocker` issues first, and works down that order itself. Up to three issue
writers draw ahead in the background, so the next issue's questions are usually waiting by the time you finish
answering one. Type `stop` in any answer to end there. The issue writer proposes, you decide, and the issue is
rewritten to match. When an answer changes another issue, that issue is updated, and if it was `ready` it loses
`ready` with a comment. An issue that turns out to be two tasks is split. An issue that grows past eight files and a
project that grows past ten tasks both stay as they are, because both limits are for `pj-design-and-plan` to cut by.
`ready` goes on only when the issue can be implemented straight from its body: symbols named for every changed file
that exist once its blockers have merged, and acceptance criteria anchored to tests or commands. Ticking a box on
GitHub settles a decision too.

`/annetaan:pj-running` ([details](skills/pj-running/SKILL.md)) asks which project to work on, the same way. On the
project's first run it creates the project's branch. When a project it waits on is not merged yet, it lists those
projects and stops instead. It closes the parent of any project it finds merged, its own or one it waits on. Then it
checks that you can merge your own pull request into the project's branch without an approving review, and checks
every issue in the order. Any issue that needs design
again sends the run back to `pj-design-details` before anything starts. After you approve the order, each issue goes
through the same steps in turn, in a git worktree of the project's own under `.claude/worktrees/`, so you can keep
working in your clone while the run goes on. It gets a branch.
[workflow](skills/workflow/README.md#driven-from-an-issue) runs it as one task, with review rounds in difit and an
integration review. A draft pull request follows, with the work report as its body. Then the merge into the project's
branch, by squash where the repository allows it. pj-running then closes the issue itself, because GitHub closes
nothing on a merge into a branch other than the default. Work nobody planned becomes a new issue. Work that has to
come first stops the run and gets the `blocker` label. The next run picks up where this one stopped.

```
/annetaan:pj-design-and-plan add CSV export to every report screen
/annetaan:pj-design-details
/annetaan:pj-running
```

The second and third always ask which project, and an issue number passed after either one puts its project first.

```mermaid
flowchart TD
    req(["your request"]) --> plan["pj-design-and-plan<br/>planner splits the work into<br/>projects of up to ten tasks,<br/>issue writers draw each task"]
    plan --> approve(["you approve the split"]) --> filed["a parent issue per project,<br/>labelled project, and its sub-issues<br/>decisions as checkboxes,<br/>order as blocked-by"]
    filed --> details["pj-design-details<br/>you decide, the writer rewrites,<br/>ready once implementable as written"]
    details --> run["pj-running, per project<br/>makes its branch on the first run,<br/>then per ready issue: branch, workflow,<br/>draft pull request, merge<br/>into the project's branch"]
    run -->|"stub or blocker"| details
    run -->|"all merged"| done(["you merge the project's branch<br/>into the branch it came from,<br/>then its parent closes"])
    done -.->|"a project that waits on it"| run

    you(["you, on GitHub"]) -.->|"tick a box"| filed

    classDef human fill:#fff,stroke:#888,stroke-dasharray: 5 5
    class req,approve,you,done human
```

What they need:

- `gh` 2.94.0 or later, logged in.
- Issues turned on in the repository.
- The commands run from a clone of the repository.
- For `pj-running`: write access, a project branch that accepts a merge with no approving review, and what
  workflow needs (difit). Your own working tree may be dirty, because the run works in a worktree of its own.

The `ready`, `blocker` and `project` labels are created when missing, and a label that already exists is reused as
it is.

### doc-write

`/annetaan:doc-write <path>` ([details](skills/doc-write/SKILL.md))

Writes a document, or rewrites the one at the path, in one of four styles:

| Style | For | How it is read |
| --- | --- | --- |
| `conclusion-first` | a README, a design document, a pull request, a report | the top first, then only as deep as needed |
| `story` | a technical article, a blog post, a talk | start to end, following the thread |
| `procedure` | a tutorial, setup instructions, a runbook | one step at a time, while doing it |
| `reference` | an API description, a list of settings, a format | one entry, looked up |

The rules change with the style. A `conclusion-first` document may repeat its summary in the detail below it, and a
`story` may use sentences that carry the thread from one part to the next. Some rules hold in every style: plain
words instead of coined terms and abbreviations, a term explained no later than the sentence after it first
appears, and a count the document gives matching what follows. [`styles.md`](skills/doc-meta/styles.md) holds all
of it.

`doc-meta` records the style in the sidecar, and `doc-review` and `doc-revise` judge the document by it. Run
`doc-meta` on the result when you want to flag individual sentences.

### doc-meta

`/annetaan:doc-meta <path>` ([details](skills/doc-meta/SKILL.md))

Splits a document into blocks and writes them into a sidecar file next to it, so you can write an opinion onto the
sentences that matter instead of asking a model to guess. A sub-agent reads the document and the sidecar whole, for
the repetition and the broken promises a single flagged sentence cannot catch. Run it again any time: it matches
old text against new, so a flag and a review survive as long as the words they sit on stay put.

The sidecar is written for you, in the language you are talking to Claude in. A document in another language gets a
translation under each sentence, so you can flag an English document while reading it in Japanese or German. The
document itself, and every edit `doc-revise` makes to it, stays in its own language.

`doc-review` and `doc-revise` complete the loop `doc-meta` starts.

```mermaid
flowchart LR
    meta["doc-meta<br/>splits into blocks,<br/>writes the sidecar"] --> you(["you<br/>write flag: on the<br/>blocks you have an opinion about"])
    you --> review["doc-review<br/>answers each flag<br/>with a review: line"]
    review --> revise["doc-revise<br/>applies the flags,<br/>repairs the document,<br/>reruns doc-meta"]
    revise --> meta

    classDef human fill:#fff,stroke:#888,stroke-dasharray: 5 5
    class you human
```

### doc-review

`/annetaan:doc-review <path>` ([details](skills/doc-review/SKILL.md))

Reads the flags you wrote onto a `doc-meta` sidecar and answers each one with a `review:` line: what a `[delete]`
would cost, the other half of a duplication for a `[keep]`, a proposed sentence for an `[edit]`, an answer to a
`[question]`. It never touches the document, and it never touches a flag.

### doc-revise

`/annetaan:doc-revise <path>` ([details](skills/doc-revise/SKILL.md))

Applies the flags you wrote, with `doc-review`'s answers as advice: deletes what you flagged, edits what you asked
to edit, and holds `[keep]` and `[question]` blocks to their exact words while it rewrites the paragraphs around
them. It then checks the whole document for what the edit could have broken elsewhere, and reruns `doc-meta` so the
sidecar matches again.

## Agents

These are the sub-agents the skills spawn. Anything under `agents/` becomes callable as `annetaan:<name>`.
The model and the effort are pinned here, and a skill selects one by name alone.

| Agent | Model | Effort | Role |
| --- | --- | --- | --- |
| `annetaan:workflow-design` | opus | high | design. returns the design and the plan |
| `annetaan:workflow-design-review` | fable | medium | design review. once, before approval, where the repository accepts breaking changes |
| `annetaan:workflow-worker` | opus | medium | implementation, for every task |
| `annetaan:workflow-reviewer` | opus | medium | review, for every task and the integration review |
| `annetaan:pj-planner` | opus | high | planning for `pj-design-and-plan`. the projects, their designs, and the split into tasks |
| `annetaan:pj-issue-writer` | opus | high | one sub-issue, drawn against the code. drafts it for `pj-design-and-plan`, revises it for `pj-design-details` |
| `annetaan:doc-meta-overview` | opus | high | overview for `doc-meta`. finds what a per-sentence flag misses |

`pj-running` has no agents of its own. It runs workflow's.

The agent definitions are thin. The substance of each role lives in the skill's `roles/*.md`, and an agent reads
that path out of the prompt the main session hands it.

## Adding a skill

Create `skills/<name>/SKILL.md`. Everything under `skills/` is picked up on its own. Raise `version` in
`plugin.json` and users get it on their next update. Without a new `version`, they keep the cached copy.

The slash form is `/annetaan:<directory name>`. The plugin name is prefixed for you, so a directory never needs an
`annetaan-` in front of it.

Agent names share one namespace across every skill in the plugin. Prefix an agent with the skill that owns it
(`workflow-design`, `workflow-worker`) and the second skill will not have to rename anything.

### Pointing at a bundled file

Never write an absolute path like `~/.claude/skills/...` when a skill reads a script or a document it ships with.
Installed as a plugin, the real location is under `~/.claude/plugins/cache/annetaan/annetaan/<version>/...`.

Write `${CLAUDE_SKILL_DIR}` instead. Claude Code replaces it in the body of a SKILL.md with the absolute path of
the skill's directory. Each skill here gives that path a short name near the top (`workflow` calls it `$FLOW`) and
uses the name from there on.

The replacement happens only in SKILL.md. A file the skill hands to a sub-agent, such as `workflow/roles/*.md`, is
read as plain text. It has to work the path out from where it was read, or take it from the prompt.

A skill that reads another skill's file goes through its own directory, as `pj-design-details` reads
`$DETAILS/../pj-design-and-plan/format.md`.
