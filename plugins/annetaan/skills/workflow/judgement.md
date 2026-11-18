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
| Remove before adding | what leaves, and in which task | a check or an option for an input nobody sends | - | nothing for an input nobody is shown to send, dead code out | the same, in the diff |
| As if it was always required | the shape, and what moves with it | its one question | - | everything in the task that states the old shape | what still states the old shape |
| Reader load | each new layer, each home of state | every layer the change adds | - | the code it writes | the two questions, on the diff |
| Comments | a design that needs one is redrawn; the comments in a task's files leave with it | - | - | writes none outside the four kinds, removes those in the files it changes, runs the check | a failing check is `changes-requested` |
| Documents | no explaining document the request did not ask for | - | - | - | - |
| Where to split | the plan, the split into tasks, the cut into projects | - | an issue that is two tasks | - | - |
| No transitional code | a split that stays green only with it is one task; breakage a project declares | - | a shim in a body, a breakage nobody closes | no shim to stay green | a shim beside the new path, a check failing undeclared |
| Existing workarounds | never a pattern to ride on; one in the task's files leaves | a workaround the design rides on | - | copies none, reports one outside the task | a copied one is `changes-requested` |
| Root cause | the fix sits at the cause | a fix that guards | a fix drawn as a guard | no guard in place of the cause, no silenced check | a guard or a silenced check is `changes-requested` |
| After two failed fixes | a symptom fixed twice before, a lint failing after two fixes | - | - | a test failing after two fixes, `stands again` | before writing `stands again` |
| A lesson becomes a check | a repeated fix, a rule in the request, the strongest check that holds it | - | - | a second finding of one kind, a repeated note | a second finding of one kind |
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

## Remove before adding

**Before a change adds anything, name what it makes unnecessary, and take that out first.** A branch, an option, a layer or a file the request leaves without a user goes in the same change, and in the plan the removal comes before the build that rests on what is left. Existing code leaves through **Why existing behaviour is there**, never on a guess.

**Build for the callers and the inputs that can be shown**: a call site, a test, the request, a recorded input. A validation, a parser, a fallback or an option for an input nobody is shown to send is not written, unless an acceptance criterion or the repository's conventions ask for it.

What the change leaves dead (a function whose last caller left, an import, a flag nobody sets) leaves in the same task. A task removes only inside the files it already changes. Anything wider is the design's to plan.

A layer the change itself adds is measured under **Reader load**, not here.

## As if it was always required

**A new requirement is drawn as the code would look had it been required from the first day**, not attached to the shape that was there. Ask what in the existing shape is there only because the requirement was absent: a type that cannot say the new case, a name that now says too little, a special case beside the general path. The design changes those.

**How far existing code moves has a limit, and the role file names it.** A role told whether the repository accepts breaking changes follows that answer: where it does not, a contract that code outside the change relies on stays, and the shape it would have had is recorded under **Model decisions**. A role working under an approved design (a parent's `## Design`, an issue body, a detail design) moves what that design moves and no more.

**The change then reaches everything that states the old shape**: the callers, the types, the tests, the documents, the examples, and the records that give the reason. Find them by search and read each one. One that still describes the old shape after the change is unfinished work, not a follow-up. A comment that states the old shape is removed, not rewritten (**Comments**).

The design holds the whole shape, and the plan delivers it in tasks that each pass. The design review asks the same question of the finished design.

## Reader load

Reading costs two things: **the layers between a question and its answer**, and **the hidden or changing state held in mind on the way**.

- **A layer that only forwards is folded into its caller**: a wrapper with one caller, an interface or an adapter with one implementation, a method that passes its arguments on. A layer stays when its second caller or second implementation can be named, in the code or in the plan.
- **State lives in the narrowest place that works**: a return value over a mutation, a local over a field, a module over a global, a value derived when read over a copy kept in sync.
- **An invariant is checked and named once, where the data crosses in.** Code inside that boundary relies on it and does not check again.

**The test: a reader new to the code answers "where does X come from?" and "what can change X?" in thirty seconds each**, for each value X the change introduces or moves. A finding or a decision under this section names X and lists the hops or the writers, found by search. Without that list it is taste.

The section applies to what the change writes. Existing code is measured only where the design moves it.

## Comments

**Code carries no comment.** Names, types and structure say what it does. The issue, the pull request and the work report say why. Four kinds stay:

- a licence header
- a comment in a configuration file that says how to use it
- an instruction to a tool: a shebang, `// @ts-expect-error`, `# frozen_string_literal: true`
- a doc comment on the public API of a library published for others

An instruction that silences a check is not one of them: it is a guard (**Root cause**). A doc comment anywhere else is not one either.

**A comment that explains our own code marks code that is unclear.** Rename, give it a type or restructure until the comment says nothing new, then leave it out. A design that needs one to be understood is redrawn.

**A comment that excuses a stopgap is evidence of a guard**: "temporary", "workaround", "for now", "should never happen". The code under it is read by **Root cause**.

**A "do not remove" or "keep in sync" comment is a rule written down**, and it goes through **A lesson becomes a check**: a test, a type or an assertion holds it, and the comment leaves.

Getting it wrong: `// keep in sync with PLAN_LIMITS` above a second table of the same limits. One table is derived from the other, or a test compares them, and the comment goes.

**The comments already in a file the change touches leave in the same task**, outside the four kinds. A task removes only inside the files it already changes.

**`scripts/comments.py` of the workflow skill holds this section.** It fails on a comment outside the four kinds in a file the change touches, and on a silenced check the change adds. It cannot tell a public API, so with `--library` it lists the doc comments for a reader. The role file says when it runs.

A repository whose conventions ask for comments keeps them, and a hit its conventions ask for is no finding.

## Documents

**A document here is a file whose only job is to explain the code or the change to a person or a model**: a decision record, notes, a summary, a plan, a guide. A file that something loads, ships or publishes is not one: a skill's or a role's prompt, a page of a site, a template.

**The explaining documents people maintain are `README`, `CLAUDE.md` and `AGENTS.md`, `CONTRIBUTING`, and the design documents the repository names. A change adds no other one unless the request asks for it.**

**What was decided and why goes where the work is tracked**: the issue, the pull request, the work report (**Model decisions**). Nothing in the repository records it.

Getting it wrong: a task adds `docs/decisions/0007-cache-keys.md` to record why the cache key changed. The reason goes into the pull request, and the file is not added.

## Where to split

Work is split only where the split is expected to make the review more accurate: a reviewer can judge each part on its own, without reading the others. **Size is never a reason.** No count of tasks or files is a limit or a target.

- **Work coupled in code is one task with one owner, however large**: a schema and its readers, a type and its callers, an API and every caller that moves to it.
- **Parts that a reviewer can judge alone stay apart**, each with its own check that it holds.
- **A split is shown by one line per part**: what a reviewer can judge in it without the others. A part with no such line is not a part.

Getting it wrong: a rename that reaches 80 files, cut into four tasks "to keep the diffs small". Each diff passes on its own, and no reviewer sees that the callers in task 3 no longer match the name task 1 chose. It is one task, because the callers cannot be judged without the name.

## No transitional code

**A task never carries code whose only job is to keep the tests green until a later task.** That is an old path kept beside the new one, an adapter, a shim, a re-export, or a flag that picks between the two. The callers move and the old API leaves in the same task.

- **A split that stays green only with such code is one task.**
- **A contract that code outside the change relies on is not transitional.** It stays or goes by **As if it was always required** and its limit.
- **In a project of the pj skills, the base branch holds planned breakage.** A task merged into it may leave a check failing when its issue declares the check under `### Left broken` and a later task of the same project closes it. Nothing undeclared may fail, and every declared check is run again before the project's pull request opens. A standalone workflow run has no such container: every task passes.

Getting it wrong: task 1 adds `fetchUserV2` and keeps `fetchUser` forwarding to it, so that task 2 can move the callers. The forwarder serves the plan and no user.

## Existing workarounds

**A workaround in existing code is never a precedent.** A workaround gets past a problem without solving it: a wait on a timer, `any` or a cast that quiets the type checker, a silenced lint rule, a skipped test, a swallowed error. A design that names the patterns it rides on leaves these out, and new code copies none because a neighbour has one.

One inside the files the change touches leaves through **Why existing behaviour is there**. One outside them is reported, and the role file says how.

Getting it wrong: the design says "wait for the dialog the way `openMenu` does", and `openMenu` sleeps 300 ms. The new code awaits the event the dialog fires.

## Root cause

**A bug fix names three things**: the symptom, the cause (the write or the assumption that produces the bad state), and what showed it. The fix goes at the cause.

A guard is a check where the failure surfaces: a null check, a retry, a refetch on a miss, a caught error, a default. The cause stays. A guard beside the cause fix is fine. A guard instead of it is never done. A cause out of reach is reported, not guarded.

**A silenced check is a guard on the check.** `eslint-disable`, `@ts-ignore`, `# noqa`, `#[allow(...)]`, a `.skip` on a test: the code the check objects to is the cause, and it stays. A change that adds one is never done.

## After two failed fixes

A gate is what an answer has to pass: a test, a lint, a check, a review finding. An answer is a fix, or in a review a reply that disagrees. **When two answers to one failure have failed at the same gate, the next one is not written yet.**

1. Write one sentence saying what both answers took for granted.
2. Make one observation whose result differs when that sentence is false. Run it, and record `ran:` and `saw:`.
3. When the sentence is false, the answer goes where it was wrong. When what was wrong is the design or the plan, report it and do not work around it. When the sentence holds, say so and go on.

Every further failure at that gate repeats the three steps with a new sentence.

For example: a finding says a value is stale after sign-out. Two fixes clear the cache in two more places, and the finding stands. Both took for granted that the stale value comes from the cache. Logging the read shows it comes from a module variable set at load.

In a review, the gate is a finding marked `stands again`: every `stands` after the first on one finding. The finding itself may be the false premise, so the reviewer applies the same steps to it before writing that mark.

## A lesson becomes a check

**A rule about to be written down a second time becomes something that runs.** The second time is a fix of a kind the history already shows, a finding of a kind the task already had, or a note the handover notes already carry.

- **Pick the strongest check that can hold the rule**, in this order: a type; a lint rule, a forbidden dependency direction among them; a test, a property-based one among them; a runtime assertion; prose last. A script that runs with the lint or the tests counts as the one it runs with.
- **When a check can hold the rule, the check is the whole fix.** Prose that says the same thing is not added, in `CLAUDE.md`, `AGENTS.md` or anywhere else, and prose the check replaces is removed.
- **When the rule takes judgement, it stays prose**: placed where its reader starts, made to stand out, with one example of getting it wrong.

A check outside the task's files is not built on the side. The role file says how it is reported.

## Done means shown

**For each acceptance criterion, state the command that was run and what it printed**, on the tree that is about to be reviewed. Passing tests are necessary and not enough.

Walk each user flow the change touches: the changed step and the operations around it (sign out then sign in again, switch tenant, reload). Walk the flow of each reader in `### Shared state` too.

`not run: <what is missing here>` is allowed only for the environment, never for effort. The task goes on. The reviewer tries each `not run:` itself, and only what neither side could run is listed in `log.md` under its own heading.

A bug fix with a cheap test path (an existing test file or harness for that module that runs in seconds) gets the failing test first.

## Confirmed and unconfirmed

**A reviewer backs a correctness finding by running the breaking input.** `Confirmed:` carries the command and its output.

A serious suspicion the reviewer could not run is `Unconfirmed:`, and it is a request for a run. The worker answers with `ran:` and `saw:`: it reproduces, so the answer is `fixed`; or it does not, and the answer carries the output. When the worker cannot run it for an environment reason, it answers `not run:`. The reviewer resolves the finding on that output, never on argument.

A finding unrun on both sides is resolved as unrun. It does not block `approve`, and it is listed in `log.md` under the not-run heading.
