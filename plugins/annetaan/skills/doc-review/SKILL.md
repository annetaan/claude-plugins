---
name: doc-review
description: Answers the flags a human wrote onto a doc-meta sidecar, writing one review note per flagged block. Never touches the document and never touches a flag. Use it only when named or invoked as /annetaan:doc-review, with the path to one document as the argument.
---

# doc-review

A human has read a `doc-meta` sidecar and written `[keep]`, `[delete]`, `[edit]` or `[question]` onto the blocks
they have an opinion about. `doc-review` answers each of those flags with a `review:` line: what a `[delete]`
would cost, the other half of a duplication for a `[keep]`, a proposed sentence for an `[edit]`, an answer for a
`[question]`.

`doc-review` never decides what to cut, and it never touches the document or a `flag:` line. It only writes
`review:`. `doc-revise` is the skill that acts on any of this.

## Paths: `$DOCREVIEW`

The top of this instruction carries an absolute path as `Base directory for this skill:`. **`$DOCREVIEW` below
means that path.**

`$DOCREVIEW` is not a shell variable. Replace it with the real absolute path when you run bash.

The sidecar format is not described here. Read `$DOCREVIEW/../doc-meta/format.md`, the only file that describes it.

## Steps

1. Read the path given as the argument. It names one document. Derive the sidecar path by the naming rule in
   `format.md`, and read the document, the sidecar, and `format.md` itself.

   **If the sidecar does not exist, say so and stop.** Tell the user to run `/annetaan:doc-meta` on this document
   first. There is nothing to answer without it.
2. For every block that carries a non-empty `flag:`, verify it against the document by the procedure in
   `format.md`'s "Verifying a block against the document". A sidecar can go stale between the last `doc-meta` run
   and now. **Skip a block that fails this check**, and say so in the report. Do not guess at what the block used
   to say.
3. For every flagged block that passes the check, write its `review:` line:
   - `[delete]`: what would be lost. Walk the block's `needs` dependents (any block elsewhere that names this one
     in its own `needs:`) and say what breaks for them. Also note any word or phrase that appears in this block
     and nowhere else in the document, since a reader who searches for it would come up empty.
   - `[keep]`: the other half of the duplication, in either direction. `echoes:` is one directional. A later block
     names the earlier one it repeats, so a `[keep]` on the earlier block has no `echoes:` of its own.
     Check both: this block's own `echoes:`, and any other block whose `echoes:` names this one. Point at whichever
     you find and say why keeping both earns its place. When no block echoes this one either way, the `review:`
     line says there is no duplication to weigh.
   - `[edit]`: a proposed sentence that satisfies the free text the human wrote after the flag. The proposed
     sentence is written in the document's own language, since it is meant to go into the document. The rest of
     the line follows the language rule below.
   - `[question]`: an answer to the free text question, from what the document and the sidecar show.

   **A `review:` line that names another block's id carries a quote from that block**, the same rule `## Whole
   document` bullets follow in `format.md`. Writing the quote is what forces opening the block instead of
   answering from memory.

   Write `review:` in the language the user is using in conversation, per `format.md`. A quote of another block's
   source text keeps that source's own language, unchanged.
4. **Touch only `review:` lines.** A block that step 2 skipped gets nothing written on it at all.
5. Report: how many blocks were answered, broken down by flag kind (`[keep]` / `[delete]` / `[edit]` / `[question]`
   counts), the `[question]` items, since those wait on a human and nothing else in this flow resolves them, and
   the blocks skipped in step 2, with why.
