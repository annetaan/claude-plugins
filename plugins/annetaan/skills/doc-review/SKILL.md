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

**`$DOCREVIEW` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$DOCREVIEW` is not a shell variable. Replace it with the real absolute path when you run bash. Collapse the `..` in
a path to a sibling skill, so that the command text names `<skills>/doc-meta/scripts/sidecar.sh` and not
`<skills>/doc-review/../doc-meta/scripts/sidecar.sh`.

The sidecar format is not described here. Read `$DOCREVIEW/../doc-meta/format.md`, the only file that describes it.
The styles are described in `$DOCREVIEW/../doc-meta/styles.md`.

This skill uses these files:

- the script `$DOCREVIEW/../doc-meta/scripts/sidecar.sh`, written `sidecar.sh` below. Every subcommand prints one
  JSON object with a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message and stop

## Steps

1. Read the path given as the argument. It names one document. Before reading anything, run:

   ```bash
   $DOCREVIEW/../doc-meta/scripts/sidecar.sh verify "<document>"
   ```

   **On a `stop` with `no-sidecar`, say so and stop.** Tell the user to run `/annetaan:doc-meta` on this document
   first. There is nothing to answer without it. On `no-document` or `is-sidecar`, say so and stop.

   Otherwise derive the sidecar path by the naming rule in `doc-meta/format.md`, and read the document, the
   sidecar, `doc-meta/format.md` and `doc-meta/styles.md`. Every answer below is judged by the rules of the style
   the sidecar's `## Document` names.
2. A sidecar can go stale between the last `doc-meta` run and now. **Skip every flagged block whose id carries
   `not-in-document` in the `reasons` of step 1's `verify`**, and say so in the report. Do not guess at what the
   block used to say. No other reason skips a block. When `reasons` holds any other code, name those codes in the
   report on one line, and say that `/annetaan:doc-meta` brings the sidecar back in order.
3. For every flagged block that step 2 did not skip, write its `review:` line:
   - `[delete]`: what would be lost. Walk the block's `needs` dependents (any block elsewhere that names this one
     in its own `needs:`) and say what breaks for them. Also note any word or phrase that appears in this block
     and nowhere else in the document, since a reader who searches for it would come up empty.
   - `[keep]`: the other half of the duplication, in either direction. `echoes:` is one directional. A later block
     names the earlier one it repeats, so a `[keep]` on the earlier block has no `echoes:` of its own.
     Check both: this block's own `echoes:`, and any other block whose `echoes:` names this one. Point at whichever
     you find and say whether keeping both earns its place, including when the style allows that repetition. When
     no block echoes this one either way, the `review:` line says there is no duplication to weigh.
   - `[edit]`: a proposed sentence that satisfies the free text the human wrote after the flag. The proposed
     sentence is written in the document's own language, since it is meant to go into the document, and follows
     the rules of the style. The rest of the line follows the language rule below.
   - `[question]`: an answer to the free text question, from what the document and the sidecar show.

   **A `review:` line that names another block's id carries a quote from that block**, the same rule `## Whole
   document` bullets follow in `doc-meta/format.md`. Writing the quote is what forces opening the block instead of
   answering from memory.

   Write `review:` in the language the user is using in conversation, per `doc-meta/format.md`. A quote of another block's
   source text keeps that source's own language, unchanged.
4. **Touch only `review:` lines.** A block that step 2 skipped gets nothing written on it at all.
5. Report: how many blocks were answered, broken down by flag kind (`[keep]` / `[delete]` / `[edit]` / `[question]`
   counts), the `[question]` items, since those wait on a human and nothing else in this flow resolves them, and
   the blocks skipped in step 2, with why.
