# Review files

The review rounds run through Markdown files under `<WORKDIR>/review/`. The review seats, `flow.sh round` and the
implementation session each write their own files. A round file is final once `flow.sh round` wrote it, every other
review file is final once its writer has linted it (see **The lint**) and reported, and nobody edits either after that.
The directory is the whole conversation of the review, in order, and it stays next to the work report. The seats'
probes sit beside it, under `<WORKDIR>/seats/` (see **A probe**), and so do the drafts `flow.sh verify` writes and the
judgement files the main session writes, `<scope>-round-<r>-judgement.md`, under `<WORKDIR>/drafts/` (see **A draft**
and **A review round**).

## Names

`<scope>` is `task-<k>`, `integration` or `merge`.

| File | Written by |
| --- | --- |
| `task-<k>-round-<r>-<seat>.md` | a seat, what it found in round `r` of task `k` |
| `integration-round-<r>-<seat>.md` | a seat, what it found in round `r` of the integration review |
| `merge-round-<r>-<seat>.md` | a seat, what it found in round `r` of a merge that resolves conflicts |
| `task-<k>-round-<r>.md` | `flow.sh round`, round `r` of task `k`, from the draft and the main session's judgement |
| `task-<k>-round-<r>-reply.md` | the implementation session, its answer to that round |
| `integration-round-<r>.md` | `flow.sh round`, round `r` of the integration review, from the draft and the main session's judgement |
| `integration-round-<r>-reply.md` | the implementation session, its answer to that round |
| `merge-round-<r>.md` | `flow.sh round`, round `r` of a merge that resolves conflicts, from the draft and the main session's judgement |
| `merge-round-<r>-reply.md` | the implementation session, its answer to that round |
| `task-<k>-evidence.md` | the implementation session, what it ran for task `k` before the first review |
| `task-<k>-round-<r>-evidence.md` | the implementation session, a full pass after fixes to round `r` |
| `integration-round-<r>-evidence.md` | the implementation session, a full pass after fixes to integration round `r` |
| `merge-evidence.md` | the implementation session, what it ran for a merge before the first review |
| `merge-round-<r>-evidence.md` | the implementation session, a full pass after fixes to merge round `r` |

Keep these names. Claude Code refuses a Write from a sub-agent when the name of the `.md` file starts with `report`,
`summary`, `findings` or `analysis`.

## An evidence file

```markdown
# Task 2, evidence

## Acceptance criteria

- `plugins/annetaan/scripts/ts.sh --test tests/project-check.test.ts` exits 0
  - ran: `plugins/annetaan/scripts/ts.sh --test tests/project-check.test.ts`
  - saw: `pass 17`, `fail 0`
- the retry stops at zero attempts
  - not run: no network in this environment

## Flows

- sign out, then sign in again
  - ran: `npm run e2e -- signin`
  - saw: `3 passed`

## Reproduced first

- ran: `npm test -- retry` before the fix
  - saw: `FAIL stops at zero attempts`
- ran: the same after the fix
  - saw: `PASS`
```

- These three sections are the only ones, in this order. `## Flows` and `## Reproduced first` are left out when there is nothing for them, and the flows of each reader in the design's `### Shared state` go under `## Flows`.
- `## Reproduced first` is for a bug fix only. `saw:` holds three lines at most.
- The newest evidence file of a task is the one for the latest round. The seats read it first, and `log.md` reads only that one. `log.md` also reads the newest `integration-round-<r>-evidence.md` and the newest merge evidence file (`merge-evidence.md` or `merge-round-<r>-evidence.md`), which belong to no task.

## A probe

A probe is how a seat runs code. It is a directory `<WORKDIR>/seats/<seat>/<name>/` that holds:

- `run.sh`, which runs from the root of the seat's worktree: the run's working tree at a snapshot, with the probe's `tree/` copied over it
- `tree/`, when the probe needs files: a failing test, a fixture, each at its repository path

`run.sh` exits non-zero exactly while the failure it proves shows, and 0 once the failure is gone. `flow.sh verify` sorts the findings by that exit alone, so a probe that only prints what it found exits 0 and its finding is dropped.

`flow.sh run <WT> <seat> <probe dir>` snapshots `<WT>`, puts the seat's worktree at the snapshot, copies `tree/` over it, runs `run.sh` there and prints `{"status":"ran","seat","snapshot","exit","lines","output"}`, `output` being the last 40 lines. A probe has to be under `<WT>/work-reports/`. It stops with `outside`, `no-script`, `busy` (another run holds this seat) or `unknown`. Every run starts from a clean snapshot of `<WT>` as it is at that moment, and keeps the ignored files of the seat's worktree, such as installed dependencies, so a probe that installs them once serves every later run of that seat.

## A seat file

A seat writes this file under `<WORKDIR>/review/`, once per round. It holds what the seat proved by a run, and no verdict.

```markdown
# Task 2, round 1, seat a

## Findings

### 1. `retryJob` calls the job once when `maxAttempts` is 0

Command: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`
Printed: exit 1, `expected 0 calls, got 1`
Required: the retry stops at zero attempts (acceptance criterion 2)

## Not run

- `npm run e2e -- signin`: needs a browser that is not here
```

- A finding has a title and three lines. `Command:` is always one `flow.sh run` line with real paths, the one the seat ran, in backticks. `flow.sh verify` runs it again word for word for the main session, and the implementation session runs it after a fix. `Printed:` is the exit and the decisive lines, three lines at most. `Required:` is what the design, its criteria, the plan or the task detail requires.
- A search that is a finding is a probe too: its `run.sh` holds the search, followed by `test $? -eq 1`, so that the probe exits 1 while the search finds something.
- `## Findings` reads `None.` when the seat proved nothing.
- `## Not run` holds each `not run:` entry of the evidence file that the seat could not run either, with the reason. It reads `None.` when there is none.
- Integration round 1 adds `## Walk` as the last section: every acceptance criterion and flow of the whole design, each run as a probe, each entry shaped like an entry of an evidence file, with `ran:` and `saw:`, or `not run:`.

## A draft

`flow.sh verify <WT> <scope>` works on the scope's next round `r`, the `round` that `flow.sh status <WT> <scope>` prints. It runs again the command of every finding the last round left open and of every finding in the seat files of round `r` of each seat the run's level runs, one after another, seat `a`'s first, and writes what the runs showed to `<WORKDIR>/drafts/<scope>-round-<r>.md`. It overwrites a draft that is already there. It prints `{"status":"ok","scope","round","draft","dropouts","earlier","new","dropped"}`: an entry of `earlier` carries `id`, `command`, `exit`, `output`, `state` and `reply`, an entry of `new` carries `id`, `seat`, `number` (the seat's own `### <n>.`), `title`, `command`, `exit` and `output`, and an entry of `dropped` carries `seat`, `number`, `title`, `command` and `why`. `output` is the last 40 lines, as `flow.sh run` prints them.

```markdown
# task-2, round 2, draft

## Earlier findings

- R1.1 resolved: ran: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/stale-cache`; saw: exit 0, `2 passed`
- R1.2 stands: ran: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`; saw: exit 1, `expected 0 calls, got 1`

## New findings

### R2.1 `cache.ts` `clearCache` empties the sign-in value

Found by: a
Command: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/signin`
Printed: exit 1, `1 failed: the form finds an empty cache`

### R2.2 the second sign-in finds no cached value

Found by: b
Command: `/abs/skills/workflow/scripts/flow.sh run /abs/wt b /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/b/signin-twice`
Printed: exit 1, `expected a cached value, got undefined`

## Dropped

- a: 1, the command exited 0, so the failure did not show (finding 2)
- b: none
```

- Every draft has these three sections. A section with nothing in it reads `None.`, so `## Earlier findings` reads `None.` in round 1.
- `## Earlier findings` holds one line per finding the last round left open, in the order `flow.sh status` lists them, each run again with the `Command:` of the round file that raised it. Exit 0 is `resolved`. Non-zero is `stands`, and `stands again` when the finding stood in an earlier round. A finding whose reply is `disagree` gets `; reply: disagree` after the `saw:` part.
- `## New findings` holds the findings of the seat file of each seat the level runs, seat `a`'s first, in their order. Each one whose run exits non-zero gets the next id `R<r>.<n>`, from 1, `Found by:` its seat, its title and its `Command:` as the seat wrote them, and `Printed:` from the run.
- `## Dropped` gives per seat and reason the count and the seat's own finding numbers: those that exited 0, and those whose command could not be run again, with the reason `flow.sh run` stopped on, or `command` when the `Command:` is not one backticked `flow.sh run <WT> <seat> <probe dir>` line. A seat with nothing dropped reads `- <seat>: none`. A seat the level runs with no file reads `- <seat>: no seat file` and is listed in `dropouts`. A seat the level does not run has no line.
- `Printed:` and `saw:` are `exit <n>`, then, when the output has a line that is not blank, `, ` and the last such line as a code span, fenced with one backtick more than the longest run of backticks in it.
- Each command is run word for word: `<WT>`, the seat and the probe directory come from the command itself, and the `flow.sh` path in it is not run.
- An earlier finding whose command cannot be run again is an unexpected failure: `verify` exits 1, names the finding and writes no draft.
- `flow.sh round` writes the round file from the draft and the main session's judgement (see **A review round**).

## A review round

`flow.sh round` writes this file from the draft `flow.sh verify` wrote for the round (see **A draft**) and the judgement file the main session writes. The main session writes nothing else of the round. The file holds every finding the main session kept, and the verdict.

The main session writes the judgement file with Write as `<WORKDIR>/drafts/<scope>-round-<r>-judgement.md`, beside the draft, `<r>` being the round `flow.sh status <WT> <scope>` prints. Its shape is exactly this, and blank lines between its lines are ignored:

```text
Seats: <the models the seats ran on>

## Keep

- R<r>.<n>[, R<r>.<m>...]
  Required: <text>
  Breaks: <text>

## Drop

- R<r>.<n>: <reason>

## Earlier

- R<i>.<j> stands: <reason>
- R<i>.<j> resolved: <reason>

## Not run

- <entry>
```

The judgement of the draft example in **A draft**:

```markdown
Seats: a on opus, b on fable

## Keep

- R2.1, R2.2
  Required: sign-in reads the cache after sign-out (design, Shared state)
  Breaks: the second sign-in on one page load never fetches the value

## Drop

None.

## Earlier

- R1.2 stands: `retryJob` has to check it before the first call.

## Not run

- `npm run e2e -- signout`: no browser here, in any seat
```

- `Seats:` comes first and is the only line before `## Keep`. It names the model each seat ran on. A round with one seat reads, for example, `Seats: a on opus`. A fallback (seat `b` on opus) and a dropout (a seat that returned no report) are said here.
- The four sections come in this order, and each reads `None.` alone when it is empty.
- `## Keep` and `## Drop` name the draft's new ids, and every one of them is named exactly once across the two.
- A `## Keep` entry is one finding of the round. Under its line come `Required:`, what the design, its criteria, the plan or the task detail requires, and `Breaks:`, what the failure breaks in the intent, indented, once each and nothing else. Findings with one root cause are one entry, as `R2.1, R2.2` above. Its first id gives the title, `Command:` and `Printed:`, and `Found by:` is the union of the seats of every id named, in the order `a`, `b`.
- A `## Drop` entry is a finding the main session leaves out because the failure does not break the intent, with the reason.
- `## Earlier` has one `stands` line for each draft line that says `stands` or `stands again`, with the reason. It has a `resolved` line only for a draft line marked `; reply: disagree`, when the disagree's reason shows that the failure does not break the intent.
- `## Not run` holds what no seat could run, as `- ` lines.

From the draft example and this judgement, `flow.sh round` writes:

```markdown
# task-2, round 2

Seats: a on opus, b on fable

## Earlier findings

- R1.1 resolved: ran: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/stale-cache`; saw: exit 0, `2 passed`
- R1.2 stands: ran: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`; saw: exit 1, `expected 0 calls, got 1`; `retryJob` has to check it before the first call.

## New findings

### R2.1 `cache.ts` `clearCache` empties the sign-in value

Found by: a, b
Command: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/signin`
Printed: exit 1, `1 failed: the form finds an empty cache`
Required: sign-in reads the cache after sign-out (design, Shared state)
Breaks: the second sign-in on one page load never fetches the value

## Dropped

- a: 1, the command exited 0, so the failure did not show (finding 2)
- b: none

## Not run

- `npm run e2e -- signout`: no browser here, in any seat

## Verdict

changes-requested
```

- The title is `# <scope>, round <r>`, and the judgement's `Seats:` line follows it. Every round file has the same five sections, and a section with nothing in it reads `None.`, so `## Earlier findings` reads `None.` in round 1.
- `## Earlier findings` holds each line of the draft's `## Earlier findings`, one per finding still open after the last reply, with `; reply: disagree` left off. The draft's rerun snapshots the tree as it now is: the failure gone is `resolved`, the failure still shown is `stands`, and the second and every later `stands` on one finding is `stands again`. A `stands` entry of the judgement adds `; ` and its reason and keeps the status word, for example `- R1.2 stands again: ran: <command>; saw: exit 1, <last line>; <the reason>`. A `resolved` entry puts `resolved` in place of the status word and adds `; ` and its reason. A draft line already `resolved` with no entry is copied as it is.
- `## New findings` holds one finding per `## Keep` entry, in its order, as `R2.1` above keeps seat `a`'s `Command:` and `Printed:` and leaves the draft's `R2.2` out. The ids count from 1 again over the findings kept. A finding's id is `R<round>.<n>`, and it never changes. A finding points with a path and a symbol, never a line number.
- `## Dropped` holds the draft's lines, which give per seat the findings whose failure did not show and those whose command could not be run again, then one line `- <seat>: <draft id>, <reason>` per `## Drop` entry, `<seat>` being that draft finding's `Found by:`.
- `## Not run` holds the judgement's lines as written.
- `## Verdict` is the line `approve` or `changes-requested` alone. **`approve` is written when nothing is kept, no earlier finding stands, and the evidence of the latest code change exists.** Otherwise it is `changes-requested`.

The latest code change before round `r` is the newest reply `<scope>-round-<j>-reply.md`, `j` below `r`, that holds a `fixed` line, because only a fix changes code. When there is one, `approve` needs `<scope>-round-<j>-evidence.md`, which the reply's own lint already asks for as `no-evidence`. When there is none, it needs the evidence written before round 1: `task-<k>-evidence.md` for a task, `merge-evidence.md` for a merge, and for the integration review an `integration-round-1-<seat>.md` that holds `## Walk`. For the walk, `round` names `review/integration-round-1-a.md`, since every level runs seat `a`.

`flow.sh round <WT> <scope> <judgement file>` takes the absolute path of the judgement file. It prints `{"status":"ok","round","verdict","open","cap"}`: the absolute path of the round file it wrote, the verdict, the ids the round leaves open, and whether the round cap is reached after this round. It writes nothing when it stops:

- `no-run`: there is no run.
- `no-draft`: there is no draft of round `r`, so `flow.sh verify` has not run. A second `round` after the round file was written meets this one too, because `r` has moved on.
- `judgement`, with `line`, the line of the judgement file, and `why`. The message names the file, the line, the `why` and the id. `why` is one of:
  - `shape`: a line is out of the shape above. A section missing at the end is `shape` at the last line of the file.
  - `unknown-id`: an id under `## Keep` or `## Drop` that is no new finding of the draft, or an id under `## Earlier` whose draft line is neither left standing nor marked `; reply: disagree`, a `stands` line for an id the draft marks `resolved` among them
  - `twice`: an id named a second time, across `## Keep` and `## Drop`, or within `## Earlier`
  - `not-disagree`: a `resolved` line for a standing draft line not marked `; reply: disagree`
  - `no-reason`: a draft line marked `stands` or `stands again` has no `## Earlier` line. `line` is the `## Earlier` heading.
  - `unjudged`: a new finding of the draft is in neither `## Keep` nor `## Drop`. `line` is the `## Keep` heading.

  The first fault in the judgement file's order is named, then those of the draft, earlier findings first.
- `no-evidence`, with `file`: the judgement keeps nothing and leaves nothing standing, but the evidence of the latest code change is missing. `file` is its absolute path under `<WORKDIR>`.

A judgement path that is relative or no file, a scope that is not `task-<k>`, `integration` or `merge`, or a wrong number of arguments exits 1.

## A reply

```markdown
# Task 2, round 2, reply

- R1.2 fixed: `retryJob` returns before the first call when `maxAttempts` is 0. Added `stops at zero attempts`. ran: `/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`; saw: exit 0
- R2.1 disagree: <the reason>
```

One line per finding the round left open: `fixed` with what changed, or `disagree` with the reason. A `fixed` line always carries `ran:` and `saw:` of the finding's command, run after the fix. A reply that changed code has a new evidence file beside it. A finding with `disagree` stays open, and the main session decides in the next round against the design. The line for a `stands again` finding is `fixed` or `disagree`, then `assumed:`, `ran:` and `saw:`, then what changed or the reason, for example `- R1.2 fixed: assumed: both fixes took the stale value to come from the cache; ran: <command>; saw: <output>; <what changed>`.

## The decisions file

At the finish, seat a writes `<WORKDIR>/decisions.md`, next to `log.md` and outside `review/`, and `flow.sh decisions` files one GitHub issue per entry. The headings are fixed and in English. The text is in the repository's language.

````markdown
# Decisions

## Keep sessions in Redis

Area: infrastructure

### What was decided

Sessions move from process memory to a Redis instance that every web process shares.

### Other options and why this one

Sticky sessions on the load balancer would keep the store in memory, but a deploy would still sign everyone out.

### Where it landed

- `src/session/store.ts`
- `infra/redis.tf`

### To overturn it

```text
/annetaan:workflow Keep sessions in process memory again: remove the Redis store from src/session/store.ts and infra/redis.tf, and pin each client to one web process at the load balancer.
```
````

- `Area:` is `technology`, `infrastructure`, `database` or `delivery`.
- Each entry has the four `### ` parts in this order. `### Where it landed` holds one `- ` bullet per backticked path. `### To overturn it` is one fenced block whose first line is a full `/annetaan:workflow` request, with no placeholder.
- A run with nothing to report writes `# Decisions` followed by `None.` alone.

`flow.sh decisions <WT> <m>` reads `decisions.md` of the newest work directory and files each entry as an issue labelled `decision`, `<m>` being the pull request's number. It creates the label first when it is missing, and leaves an existing one as it is. The issue's title is the entry's title, and its body holds the four parts as `## ` sections, with `Area: <area>` opening `## What was decided` and `Pull request: #<m>` opening `## Where it landed`. After each issue it writes `{"title","number","url"}` to `<WORKDIR>/decisions.json`, and a later run skips every entry whose title is there. It prints `{"status":"ok","filed":[...]}`, every issue filed for the file, earlier runs included. `None.` files nothing and makes no gh call. It stops with `no-run`, `no-decisions` when there is no `decisions.md`, `malformed` with the lint's reasons, before any gh call, and `gh` with gh's error and the issues filed before it.

## The lint

Each writer lints its own file as the last step before it reports, and fixes the file until `ok` is true: the seat its seat file, seat a its `decisions.md`, the implementation session its evidence file and its reply.

`flow.sh lint <file>` takes the absolute path of one review file and prints `{"status":"ok","ok":<bool>,"kind":<kind>,"reasons":[...]}`. `kind` is `seat`, `reply` or `evidence`, read from the file name by the table in **Names**, or `decisions` for a file named `decisions.md` (see **The decisions file**). The file passes when `reasons` is empty and `ok` is true. A file that does not exist stops with `no-file`. A name outside these kinds prints `kind` null and the reason `name`, and so does a round file, which `flow.sh round` writes and nobody lints. The lint reads the file and its siblings in the same directory, and nothing else: no draft, no `run.json`, no git, no probe. Lines inside a code fence are never read as a heading or an entry.

| Kind | Reason | Fails when |
| --- | --- | --- |
| every kind | `sections` | the `# ` title is not the first line, the `## ` sections are not the ones of the kind in their order, or a section that holds nothing does not read `None.` alone. Seat file: `## Findings`, `## Not run`, then `## Walk` in `integration-round-1-<seat>.md` only. Evidence file: `## Acceptance criteria`, then `## Flows` and `## Reproduced first` when present. A reply has its title and no `## ` section |
| seat | `id` | a finding is not `### <n>. <title>` with `n` counting from 1 |
| seat | `finding` | a finding does not hold exactly one `Command:`, `Printed:` and `Required:` line |
| seat | `command` | a `Command:` is not one backticked `<abs>/flow.sh run <abs WT> <a or b> <abs WT>/work-reports/...` line of five words, with no dollar sign, quote, semicolon, ampersand, pipe, angle bracket or parenthesis |
| seat, evidence | `entry` | an entry of `## Acceptance criteria`, `## Flows` or `## Walk` has neither a `ran:` and a `saw:` sub-bullet nor a `not run:` one, or an entry of `## Reproduced first` is not a `- ran:` with a `saw:` sub-bullet |
| reply | `no-round` | a reply has no round file of its round beside it |
| reply | `line` | a line after the title is not `- R<r>.<n> fixed: ...` or `- R<r>.<n> disagree: ...`, or an indented line under one |
| reply | `missing` | an id its round leaves open has no line |
| reply | `ran` | a `fixed` line carries no `ran:` and `saw:` |
| reply | `assumed` | the line for an id its round marks `stands again` carries no `assumed:` |
| reply | `no-evidence` | a reply that holds a `fixed` line has no `<scope>-round-<r>-evidence.md` of its round beside it |
| decisions | `sections` | the first line is not `# Decisions`, the rest is neither `None.` alone nor one or more `## <title>` entries with nothing before the first, or two entries have the same title |
| decisions | `area` | the first line of an entry is not `Area: ` and one of `technology`, `infrastructure`, `database` or `delivery` |
| decisions | `parts` | the `### ` headings of an entry are not `What was decided`, `Other options and why this one`, `Where it landed` and `To overturn it` in this order, text stands between `Area:` and the first of them, or one of the first two is empty |
| decisions | `landed` | `### Where it landed` is empty, or holds a line that is not a `- ` bullet opening with a backticked path |
| decisions | `overturn` | `### To overturn it` is not one fenced block alone whose first line inside is `/annetaan:workflow ` followed by text |

A round leaves open the ids of its `## New findings` and the earlier entries it marks `stands` or `stands again`. `missing` and `assumed` of a reply read that one list, and so does `open` of `flow.sh status`.

The lint holds what a later reader parses: ids, sections, the five-word command, and the lines a reply and an evidence entry need. What takes judgement stays with the writer and the reader: whether a finding breaks the intent, the wording of `Printed:` in a seat file and its three-line cap. The lint checks the shape of a command and not its paths, so whether a command runs is found by running it.
