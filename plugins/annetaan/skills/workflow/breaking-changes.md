# Does this repository accept breaking changes?

> This file is read by the main session of a skill that runs the design review: the workflow skill and pj1-plan. The caller says when to run it.

The design review runs in every repository. What the answer decides is how far the review may move existing code. Where
breaking changes are accepted, the review reports every finding. Where they are not, it reports only the findings
that move no existing code. **The answer is a sentence you keep**, not a shell variable. The review prompt and the
approval message need it.

Go down this list and stop at the first one that answers.

1. **The repository states it.** `CLAUDE.md` or `AGENTS.md` says whether breaking changes are welcome. Follow it.
2. **The memory Claude Code keeps for this repository has it.** Follow the memory.
3. **Neither.** Ask, then save the answer to that memory, under a name that identifies the repository and the date, in the format the memory directory already uses.

```
AskUserQuestion: Do you want broader design improvements (accepting breaking changes)?
  - Yes - a pre-release product, or a library you control
  - No  - a released SaaS, or a widely used OSS
```

**This skill never edits `CLAUDE.md` or `AGENTS.md`.** The answer goes to memory and nowhere in the repository.

**When 1 or 2 decided it and nothing was asked, say so in one line before design starts**: breaking changes are
accepted, or not accepted, because `<file>` says … / memory from <date> says …. That line is where the user stops a
stale memory.

Both callers read this file, so the answer saved to memory serves both.
