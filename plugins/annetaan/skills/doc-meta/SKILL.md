---
name: doc-meta
description: Splits one document into blocks and writes them to a sidecar file next to it, so a human can flag individual sentences with an opinion instead of asking a model to guess what matters. Also the resync step, run again after a human has flagged blocks or after doc-revise has changed the document. Use it only when named or invoked as /annetaan:doc-meta, with the path to one document as the argument.
---

# doc-meta

Splits one document into blocks, roughly one per sentence, by the splitting rules in `format.md`, and writes them
into a sidecar file next to the document. A human then writes a `flag:` opinion onto the blocks that matter to
them. `doc-review` answers the flags, and `doc-revise` applies the answers and reruns this skill to bring the
sidecar back in sync.

`doc-meta` never decides what to cut. It only produces the material a human flags, and keeps that material in sync
with the document as it changes.

## Paths: `$DOCMETA`

The top of this instruction carries an absolute path as `Base directory for this skill:`. **`$DOCMETA` below means
that path.**

`$DOCMETA` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for the overview sub-agent.

## Steps

1. Read the path given as the argument. It names one document. Read `$DOCMETA/format.md`, which is the only
   description of the sidecar's shape, and `$DOCMETA/styles.md`, which the `style` field refers to. If the path is itself a sidecar (its name ends in `.doc-meta.md`), say so
   and stop.
2. Check whether the sidecar would be tracked by git. Inside a git repository (`ROOT` below is
   `git rev-parse --show-toplevel`):

   ```bash
   git check-ignore -q '<dir>/<name>.doc-meta.md'
   ```

   When this fails (the sidecar is **not** ignored), ask with `AskUserQuestion` whether `*.doc-meta.md` may be
   added to `.gitignore` (the same convention the `workflow` skill uses for `work-reports/`).

   - **Yes**: append the line and commit only that path, before touching the sidecar, so the `.gitignore` change
     never rides in with anything else, and nothing else already staged in the user's tree rides in with it either:

     ```bash
     printf '*.doc-meta.md\n' >> "$ROOT/.gitignore"
     git -C "$ROOT" add .gitignore
     git -C "$ROOT" commit -m "chore: ignore *.doc-meta.md" -- .gitignore
     ```

     `add` first, because `commit -- .gitignore` fails outright when `.gitignore` has never been tracked (common
     in a repository that has none yet), and the path scope on `commit` keeps out anything else already staged.

   - **No**: continue anyway. The sidecar still gets written. It is the user's repository to track as they choose,
     and doc-meta itself never commits it.

   Outside a git repository, do nothing here and continue.
3. Split the document into blocks by the rules in `format.md`, and match them against the existing sidecar by
   `## Sync` below.
4. Write the sidecar, with `## Whole document` set to `(pending)`.
5. Hand the document and the sidecar to the overview sub-agent:

   ```
   Agent(subagent_type: "annetaan:doc-meta-overview", description: "doc-meta overview",
         prompt: "Read $DOCMETA/roles/overview.md first and follow the role it describes.\n\ndocument: <abs path>\nsidecar: <abs path>\nformat.md: $DOCMETA/format.md\nstyles.md: $DOCMETA/styles.md\nWrite the bullets in <the language the user is using in conversation>.")
   ```

   The sub-agent's own role file names `format.md` and `styles.md` but has no path of its own to either, so this
   prompt is the only place those paths reach it.

   The sub-agent starts fresh and has not seen this conversation, so name the language explicitly. It has no other
   way to know it.
6. Verify what comes back before writing it in. For every bullet that names a block id: the id must exist in the
   sidecar, and the quote given must appear in that block's `>` source text, comparing whitespace as `format.md`'s
   invariant says, and with the `> ` markers stripped as the "Verifying a block against the document" procedure
   strips them. Send a bullet that fails this back once, with `SendMessage`, asking for a correction. If it is
   still wrong on the second try, drop it.
7. Replace `(pending)` under `## Whole document` with the verified bullets. **Write `(none)` only when the overview
   pass ran and returned no bullets at all.** When the overview pass returned bullets and step 6 dropped every one
   of them, leave `(pending)`, with that as the reason on the line after it. `(none)` means a full read found
   nothing. Writing it for a read that found something, or for no read at all, says the opposite of what happened,
   and would let an unconverged document count as converged.
8. Report: the sidecar path, the block count and the weight counts, the sync breakdown (how many blocks were
   unchanged, changed, new and deleted, and the id of every block whose flag was dropped), the number of
   `## Whole document` bullets written, any bullet that was dropped in step 6, and whether `max id` had to be
   rebuilt because it was missing (see `format.md`).

## Sync

| Case | Outcome |
| --- | --- |
| Text matches | Keep id, weight, role, flag and review. Keep the reading aid unless it is in another language |
| Text changed | Keep id. Re-derive weight, role and reading aid. Drop flag and review |
| A new block with no counterpart | New block. Next unused id |
| An old block with no counterpart | Deletion. Drop it |

The first run and every later run are the same operation.

Split the document into blocks by the rules in `format.md`. Call these the **new blocks**. The blocks in the
existing sidecar are the **old blocks**. Both lists are in document order. When no sidecar exists yet, the old
blocks list is empty and `max id` starts at `b000`, so the first block assigned is `b001`.

### Anchors

An old block and a new block are an **anchor pair** when their `>` source text is identical, comparing whitespace
the way `format.md`'s invariant says (a run of whitespace as one space for a prose block, exactly for a
`verbatim` block), and the pairs are in the same order on both sides. Walk both lists from the top. Take the first
new block. Find the first old block, at or after the last anchor, with identical text. Pair them. Move on. Never
pair an old block with a new block that sits before an earlier anchor on either side. A block the walk skips stays
unpaired for now.

The source text compared is the `>` quote of the block. For a fence with more than 10 content lines that quote is
the three line record described in `format.md`, so compare the record.

### Gaps

Consecutive anchors cut both lists into **gaps**. A gap is the run of unpaired old blocks and the run of unpaired
new blocks between two anchors. There is one gap before the first anchor and one after the last. A gap can be empty
on one side, or on both.

### Inside a gap

Pair the old blocks with the new blocks by position. The first unpaired old block goes with the first unpaired new
block, the second with the second, and so on, until one side runs out. Each of these pairs is a **changed block**.

- A changed block keeps its id. Derive weight, role and the reading aid again from the new text. Drop `flag:` and
  `review:`. The flag was set on text nobody has read in its new form.
- A new block left over after the pairing is a **new block**. It gets the next unused id: read `max id` from
  `## Document`, add one, and write that new value back to `max id`. Ids are never reused, because `max id` never
  goes back down when a block is deleted.
- An old block left over after the pairing is a **deletion**. Drop it, with its flag and its review.

### Unchanged blocks

An anchor pair is an **unchanged block**. Keep the id, the weight, the role, the reading aid, the `flag:` line and
the `review:` line as they are. The one exception is a reading aid in a language other than this run's reading
language (see `format.md`): write it again in the reading language, or drop it when the block is already written in
that language.

### After the match

Compute `echoes` and `needs` again for every block, changed or not. Leave weight and role alone on unchanged
blocks.

Report the counts of unchanged, changed, new and deleted blocks, and the id of every block whose flag was dropped.
