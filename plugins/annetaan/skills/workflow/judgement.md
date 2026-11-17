# How to judge a fork, a change and a fix

> This file is read by every role of the workflow skill and of the pj skills, after the repository's own instructions. The role file says where each record goes and how a human overturns it. **The repository's conventions outrank this file.** Roles of the workflow skill find it as `$FLOW/judgement.md`. The pj roles get its absolute path in their prompt.

## Where each section applies

| Section | Design | Design review | Project review | Implementation | Review |
| --- | --- | --- | --- | --- | --- |
| What a human is asked | every open question | which leftovers reach a human | a question it raises, an open decision a model can settle | - | - |
| Model decisions | every fork it settles | - | - | - | - |
| Experiments | a fork that turns on behaviour | - | - | - | - |
| Assumptions | kept branches, shared state | both, in the design | a parent's kept branch, an issue's missing reader | a write the design did not cover | readers the diff misses |
| Why existing behaviour is there | a branch nobody is named for | - | - | - | - |
| Root cause | the fix sits at the cause | a fix that guards | a fix drawn as a guard | no guard in place of the cause | a guard is `changes-requested` |
| Done means shown | the criteria and the flows | - | - | the evidence file | reads it, tries each `not run:` |
| Confirmed and unconfirmed | - | - | - | answers with a run | backs a finding with a run |

Design is the design session of workflow, the planners of pj1-plan and pj2-issues, and the issue writer. Design review is the design review session, for workflow and for pj1-plan. Project review is the project reviewer of pj3-doctor. Implementation and Review are the workflow sessions. `-` means the section asks nothing of that role.

## What a human is asked

**A fork becomes a question only when its answer turns on something only a human knows**: the business, the users, a priority, a preference. The question carries one line, `Only you know: <that thing>`. When that line cannot be written, the fork is not a question. The model settles it and records it (see **Model decisions**).

These are never questions on their own: a name other code will depend on, a trade-off between speed and simplicity, two ways the repository already does one thing.

An approval before something that cannot be taken back is not a fork under this section. It is never dropped.

## Model decisions

**A fork a reader would notice, which the model settles, is recorded**: what was chosen over what, why, and the evidence. Evidence is a `path` and `symbol`, a commit or pull request, or an experiment's command and what it printed. What the repository's conventions settle, or what nobody would notice, gets no entry.

The role file says where the list goes and how a human overturns an entry.

## Experiments

**A fork that turns on how something behaves is settled by running it.** Build the smallest throwaway in the directory the prompt names on a `Scratch:` line, run it, and cite the command and what it printed. Never build one in tracked files, and never commit one.

The experiment runs the code the role was told to read. When that is a ref and not the working tree, copy the files you need from the ref into your scratch directory (`git show <ref>:<path>`), or record `not run`.

When it cannot be run (a command refused in an unattended run, a service that is not here), the entry says `not run` and why, and the fork is decided by reading.

## Assumptions

An assumption is something existing behaviour relies on: who knows a value, who acts, which states a record can be in, what happens in which order, how long a value lives. A change can break one in two directions. Both are checked here.

**Inward: a kept branch.** A branch, case or step kept from existing code is a decision, not a default. When the change alters an assumption that the branch relied on, name the assumption and say who the branch still serves. A branch nobody can be named for goes through **Why existing behaviour is there**.

For example: before, the admin chose the temporary password, so resetting a disabled user and telling them the password later was harmless. After, nobody knows the temporary password, so "create, disable, re-send after enabling" leaves a user who can never log in.

**Outward: a reader elsewhere.** Shared state is anything written in one place and read in another: a cache, a store, `localStorage`, a cookie, a global or module variable. The rule fires on a write whose reach or meaning differs from what its readers were built on:

- a clear or invalidation wider than the one entry the change owns
- a key or shape change
- a lifetime change
- a value that now means something else

An ordinary write of the same-shaped value under the same key is outside the rule.

When it fires, list every reader, the lifetime each one assumes (a session, a tenant, the whole app, or the repository's own), and whether that still holds. A reader whose assumption breaks is handled by narrowing the write to the lifetime that ended, or by changing the reader.

For example: sign-out empties a cache that also holds something fetched once per page load. The sign-in form reads that value next, finds the cache empty, and never fetches it again. The write has to be narrowed to what the session owned, or the form has to fetch on a miss.

The section applies to a diff as well as to a design.

## Why existing behaviour is there

**Before keeping or dropping a branch nobody can be named for, find out why it is there.** Run `git log -S`, `git log -L :<symbol>:<path>` and `git blame`, then read the pull request and the issue behind the commit where `gh` works.

- A reason that still holds: keep the branch and cite the reason.
- A reason that is gone: drop the branch and cite the reason.

Both are model decisions. Only a silent history makes it a question, with `Only you know: whether anyone still relies on <branch>`.

## Root cause

**A bug fix names three things**: the symptom, the cause (the write or the assumption that produces the bad state), and what showed it. The fix goes at the cause.

A guard is a check where the failure surfaces: a null check, a retry, a refetch on a miss, a caught error, a default. The cause stays. A guard beside the cause fix is fine. A guard instead of it is never done. A cause out of reach is reported, not guarded.

## Done means shown

**For each acceptance criterion, state the command that was run and what it printed**, on the tree that is about to be reviewed. Passing tests are necessary and not enough.

Walk each user flow the change touches: the changed step and the operations around it (sign out then sign in again, switch tenant, reload). Walk the flow of each reader in `### Shared state` too.

`not run: <what is missing here>` is allowed only for the environment, never for effort. The task goes on. The reviewer tries each `not run:` itself, and only what neither side could run is listed in `log.md` under its own heading.

A bug fix with a cheap test path (an existing test file or harness for that module that runs in seconds) gets the failing test first.

## Confirmed and unconfirmed

**A reviewer backs a correctness finding by running the breaking input.** `Confirmed:` carries the command and its output.

A serious suspicion the reviewer could not run is `Unconfirmed:`, and it is a request for a run. The worker answers with `ran:` and `saw:`: it reproduces, so the answer is `fixed`; or it does not, and the answer carries the output. When the worker cannot run it for an environment reason, it answers `not run:`. The reviewer resolves the finding on that output, never on argument.

A finding unrun on both sides is resolved as unrun. It does not block `approve`, and it is listed in `log.md` under the not-run heading.
