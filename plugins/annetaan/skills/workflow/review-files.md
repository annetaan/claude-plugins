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

Keep these names. Claude Code refuses a Write from a sub-agent when the name of the `.md` file starts with `report`,
`summary`, `findings` or `analysis`.

## A review round

```markdown
# Task 2, round 2

## Earlier findings

- R1.1 resolved
- R1.2 stands: the retry still runs when `maxAttempts` is 0. `retryJob` has to check it before the first call.

## New findings

### R2.1 `src/retry.ts` `retryJob`

<what is wrong, the input and the wrong thing that comes out, and how to fix it>

## Verdict

changes-requested
```

- A finding's id is `R<round>.<n>`, and it never changes. A finding points with a path and a symbol, never a line
  number.
- From round 2 on, `## Earlier findings` lists every finding still open after the last reply, each `resolved` or
  `stands` with the reason.
- `## New findings` reads `None.` when there are none.
- The verdict is `approve` or `changes-requested`. **`approve` needs every finding resolved and no new one.**

## A reply

```markdown
# Task 2, round 2, reply

- R1.2 fixed: `retryJob` returns before the first call when `maxAttempts` is 0. Added `stops at zero attempts`.
- R2.1 disagree: <the reason>
```

One line per finding the round left open: `fixed` with what changed, or `disagree` with the reason. A finding with
`disagree` stays open, and the review session decides in the next round.
