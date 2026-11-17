# Review files

The review rounds run through Markdown files under `<WORKDIR>/review/`. The review session and the implementation
session each write their own files, and nobody edits a file once it is written. The directory is the whole
conversation of the review, in order, and it stays next to the work report.

## Names

| File | Written by |
| --- | --- |
| `task-<k>-round-<r>.md` | the review session, round `r` of task `k` |
| `task-<k>-round-<r>-reply.md` | the implementation session, its answer to that round |
| `integration-round-<r>.md` | the review session, round `r` of the integration review |
| `integration-round-<r>-reply.md` | the implementation session, its answer to that round |
| `merge-round-<r>.md` | the review session, round `r` of a merge that resolves conflicts |
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
- The newest evidence file of a task is the one for the latest round. The review reads it first, and `log.md` reads only that one.

## A review round

```markdown
# Task 2, round 2

## Earlier findings

- R1.1 resolved
- R1.2 stands: the retry still runs when `maxAttempts` is 0. `retryJob` has to check it before the first call.

## New findings

### R2.1 `src/retry.ts` `retryJob`

<what is wrong, the input and the wrong thing that comes out, and how to fix it>

Confirmed: `npm test -- retry` printed `expected 0 calls, got 1`

### R2.2 `src/cache.ts` `clearCache`

<what is wrong, and how to fix it>

Unconfirmed: sign-in reads the cache next and may find it empty. Tried `npm run e2e -- signin`, which needs a browser that is not here. Please run it and answer with `ran:` and `saw:`.

## Verdict

changes-requested
```

- A finding's id is `R<round>.<n>`, and it never changes. A finding points with a path and a symbol, never a line
  number.
- From round 2 on, `## Earlier findings` lists every finding still open after the last reply, each `resolved`,
  `resolved (unrun)` or `stands` with the reason. `resolved (unrun)` is for an `Unconfirmed:` finding that neither side could run.
- `## New findings` reads `None.` when there are none.
- The verdict is `approve` or `changes-requested`. **`approve` needs every finding resolved, no new one, and evidence newer than the last code change (for integration round 1, the reviewer's own walk recorded in the round file).**

## A reply

```markdown
# Task 2, round 2, reply

- R1.2 fixed: `retryJob` returns before the first call when `maxAttempts` is 0. Added `stops at zero attempts`.
- R2.1 disagree: <the reason>
- R2.2 disagree: ran: `npm run e2e -- signin`; saw: `3 passed`, the form fetches on a miss
```

One line per finding the round left open: `fixed` with what changed, or `disagree` with the reason. A reply that changed code has a new evidence file beside it. A finding with
`disagree` stays open, and the review session decides in the next round.
