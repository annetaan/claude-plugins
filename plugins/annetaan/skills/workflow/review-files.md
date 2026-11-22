# Review files

The review rounds run through Markdown files under `<WORKDIR>/review/`. The review seats, the main session and the
implementation session each write their own files, and nobody edits a file once it is written. The directory is the
whole conversation of the review, in order, and it stays next to the work report. The seats' probes sit beside it, under
`<WORKDIR>/seats/` (see **A probe**).

## Names

`<scope>` is `task-<k>`, `integration` or `merge`.

| File | Written by |
| --- | --- |
| `task-<k>-round-<r>-<seat>.md` | a seat, what it found in round `r` of task `k` |
| `integration-round-<r>-<seat>.md` | a seat, what it found in round `r` of the integration review |
| `merge-round-<r>-<seat>.md` | a seat, what it found in round `r` of a merge that resolves conflicts |
| `task-<k>-round-<r>.md` | the main session, round `r` of task `k`, from the seat files |
| `task-<k>-round-<r>-reply.md` | the implementation session, its answer to that round |
| `integration-round-<r>.md` | the main session, round `r` of the integration review |
| `integration-round-<r>-reply.md` | the implementation session, its answer to that round |
| `merge-round-<r>.md` | the main session, round `r` of a merge that resolves conflicts |
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

- `bash tests/project-check.sh` exits 0
  - ran: `bash tests/project-check.sh`
  - saw: `ok: 14 checks`
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

- `## Reproduced first` is for a bug fix only. `saw:` holds three lines at most.
- The newest evidence file of a task is the one for the latest round. The seats read it first, and `log.md` reads only that one. `log.md` also reads the newest `integration-round-<r>-evidence.md` and the newest merge evidence file (`merge-evidence.md` or `merge-round-<r>-evidence.md`), which belong to no task.

## A probe

A probe is how a seat runs code. It is a directory `<WORKDIR>/seats/<seat>/<name>/` that holds:

- `run.sh`, which runs from the root of the seat's worktree: the run's working tree at a snapshot, with the probe's `tree/` copied over it
- `tree/`, when the probe needs files: a failing test, a fixture, each at its repository path

`panel.sh run <WT> <seat> <probe dir>` snapshots `<WT>`, puts the seat's worktree at the snapshot, copies `tree/` over it, runs `run.sh` there and prints `{"status":"ran","seat","snapshot","exit","lines","output"}`, `output` being the last 40 lines. A probe has to be under `<WT>/work-reports/`. It stops with `outside`, `no-script`, `busy` (another run holds this seat) or `unknown`. Every run starts from a clean snapshot of `<WT>` as it is at that moment, and keeps the ignored files of the seat's worktree, such as installed dependencies, so a probe that installs them once serves every later run of that seat.

## A seat file

A seat writes this file under `<WORKDIR>/review/`, once per round. It holds what the seat proved by a run, and no verdict.

```markdown
# Task 2, round 1, seat a

## Findings

### 1. `retryJob` calls the job once when `maxAttempts` is 0

Command: `/abs/skills/workflow/scripts/panel.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`
Printed: exit 1, `expected 0 calls, got 1`
Required: the retry stops at zero attempts (acceptance criterion 2)

## Not run

- `npm run e2e -- signin`: needs a browser that is not here
```

- A finding has a title and three lines. `Command:` is always one `panel.sh run` line with real paths, the one the seat ran. The main session runs it again word for word from `<WT>`, and so does the implementation session after a fix. `Printed:` is the exit and the decisive lines, three lines at most. `Required:` is what the design, its criteria, the plan or the task detail requires.
- A search that is a finding is a probe too: its `run.sh` holds the search.
- `## Findings` reads `None.` when the seat proved nothing.
- `## Not run` holds each `not run:` entry of the evidence file that the seat could not run either, with the reason. It reads `None.` when there is none.
- Integration round 1 adds `## Walk`: every acceptance criterion and flow of the whole design, each run as a probe, with `ran:` and `saw:`, or `not run:`.

## A review round

The main session writes this file after it has run each seat's commands again. It holds every finding it verified, and the verdict.

```markdown
# Task 2, round 2

Seats: a on opus, b on fable

## Earlier findings

- R1.1 resolved
- R1.2 stands: ran: `/abs/skills/workflow/scripts/panel.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`; saw: `expected 0 calls, got 1`. `retryJob` has to check it before the first call.

## New findings

### R2.1 `cache.ts` `clearCache` empties the sign-in value

Found by: a, b
Command: `/abs/skills/workflow/scripts/panel.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/signin`
Printed: exit 1, `1 failed: the form finds an empty cache`
Required: sign-in reads the cache after sign-out (design, Shared state)
Breaks: the second sign-in on one page load never fetches the value

## Dropped

- a: 1, the command exited 0, so the failure did not show
- b: none

## Not run

- `npm run e2e -- signout`: no browser here, in any seat

## Verdict

changes-requested
```

- `Seats:` names the model each seat ran on. A round with one seat reads, for example, `Seats: a on opus`. A fallback (seat `b` on opus) and a dropout (a seat that returned no report) are said here.
- A finding's id is `R<round>.<n>`, and it never changes. A finding points with a path and a symbol, never a line number.
- `Found by:` names every seat that raised it. Findings with one root cause are one entry. `Command:` is the line the main session ran again, with the probe of the seat that found it, and `Breaks:` is what the failure breaks in the intent.
- `## Dropped` gives per seat the count of findings left out and why: the failure did not show, it does not break the intent, or the command could not be run again.
- `## Not run` holds what no seat could run. It reads `None.` when there is none.
- From round 2 on, `## Earlier findings` lists every finding still open after the last reply, each `resolved`, `stands` or `stands again` with the reason. The main session runs the finding's command again, which snapshots the tree as it now is: the failure gone is `resolved`, the failure still shown is `stands`. The second and every later `stands` on one finding is written `stands again`, with the output of that run, for example `- R1.2 stands again: ran: <command>; saw: <output>; <the reason>`. A `disagree` whose reason shows the failure does not break the intent is `resolved`, with the reason quoted.
- `## New findings` reads `None.` when there are none.
- The verdict is `approve` or `changes-requested`. **`approve` needs no verified finding open, and the evidence file of the latest code change. In integration round 1, where no evidence file exists, a `## Walk` in at least one seat file takes its place.**

## A reply

```markdown
# Task 2, round 2, reply

- R1.2 fixed: `retryJob` returns before the first call when `maxAttempts` is 0. Added `stops at zero attempts`. ran: `/abs/skills/workflow/scripts/panel.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/retry-zero`; saw: exit 0
- R2.1 disagree: <the reason>
```

One line per finding the round left open: `fixed` with what changed, or `disagree` with the reason. A `fixed` line always carries `ran:` and `saw:` of the finding's command, run after the fix. A reply that changed code has a new evidence file beside it. A finding with `disagree` stays open, and the main session decides in the next round against the design. The line for a `stands again` finding is `fixed` or `disagree`, then `assumed:`, `ran:` and `saw:`, then what changed or the reason, for example `- R1.2 fixed: assumed: both fixes took the stale value to come from the cache; ran: <command>; saw: <output>; <what changed>`.
