---
name: doc-revise
description: Applies the flags and the review notes on a doc-meta sidecar to the document itself, repairs what the edit broke elsewhere in the document, then reruns doc-meta to bring the sidecar back in sync. Use it only when named or invoked as /annetaan:doc-revise, with the path to one document as the argument.
---

# doc-revise

`doc-review` has already answered the flags a human wrote. `doc-revise` is what acts on them: it deletes what was
flagged `[delete]`, applies `[edit]`, and holds `[keep]` and `[question]` blocks to their exact text while it
repairs whatever the surrounding changes broke. It finishes by rerunning `doc-meta`, so the sidecar matches the
document again.

`doc-revise` still never decides what to cut on its own initiative. Every change it makes traces back to a flag a
human wrote.

## Paths: `$DOCREVISE`

The top of this instruction carries an absolute path as `Base directory for this skill:`. **`$DOCREVISE` below
means that path.**

`$DOCREVISE` is not a shell variable. Replace it with the real absolute path when you run bash.

The sidecar format is not described here. Read `$DOCREVISE/../doc-meta/format.md`, the only file that describes
it.

## Steps

1. Read the path given as the argument. It names one document. Derive the sidecar path by the naming rule in
   `format.md`, and read the document, the sidecar, and `format.md` itself.

   **If the sidecar does not exist, say so and stop.** Tell the user to run `/annetaan:doc-meta` first.

   **If no block carries a flag at all, say so and stop.**
2. For every flagged block, verify it against the document by the procedure in `format.md`'s "Verifying a block
   against the document", the same one `doc-review` uses. **Skip a block that fails this check**, and report it.
   Acting on a flag whose text has moved under it would edit the wrong sentence.
3. Apply what survived step 2, and record the id of every block you delete or edit as you apply it:
   - `[delete]`: cut the block's text from the document.
   - `[edit]`: replace the block's text. An `[edit]` can also reorder list items without changing a character of
     any of them, when that is what the free text asks for. When the human's free text after the flag disagrees
     with the `review:` proposal, **the human's free text wins**.
   - `[keep]`: a constraint, not an edit. This block's text stays verbatim through steps 4 and 5, unless step 6
     forces an exception.
   - `[question]`: leave the block's text untouched, and keep it verbatim through steps 4 and 5 as well: nothing
     may touch its wording until a human answers it, unless step 6 forces an exception. The question is
     unanswered, so the text it was asked about has to survive to be asked again. It goes in the report as still
     waiting on a human, not as handled.
4. **Rewrite whole paragraphs, not just the holes in them.** A paragraph that lost a sentence to `[delete]` or
   `[edit]` is rewritten from what remains, so it reads as a paragraph again instead of a patched seam. For English
   prose, read the `english-voice` skill first when this repository has it, before rewriting. Note which
   paragraphs you rewrote.
5. **Repair the whole document.** A deletion or an edit can break something far from where it happened. Check, in
   the document as a whole, not paragraph by paragraph, and note what each item found and what you did about
   it:
   - A demonstrative or a pronoun ("this", "that", "the latter") that pointed at what is now gone.
   - A backward reference ("as described above", "as noted earlier") to a block that moved or disappeared.
   - A term whose defining block is gone, still used by text that assumed the reader had it.
   - A count the document promised ("three reasons") that no longer matches what remains.
   - An ordering word ("first", "next", "finally") whose neighbors changed.
   - A cross-reference by heading name, where that heading no longer exists.
   - A paragraph left empty, or two paragraphs now sitting next to each other across a closed join.
   - A heading with nothing left under it.
6. **When step 4 or step 5 forces a change to a `[keep]` or a `[question]` block, that is an exception to the
   constraint in step 3, not a normal edit.** Record the block's id, its exact text as it stood before changing
   it, and what forced the change, then make the change. This gets a dedicated line in the report (step 8),
   separate from the `[edit]` list, because it is a `[keep]` or `[question]` promise broken for the sake of the
   document staying readable, and the human who wrote it should see it named as such.
7. Run `doc-meta` again on the same document, with the `Skill` tool: `annetaan:doc-meta <path>`. If that name is
   not found, read `$DOCREVISE/../doc-meta/SKILL.md` and follow it directly, taking its `$DOCMETA` as
   `$DOCREVISE/../doc-meta`.

   The resync runs `doc-meta`'s own Sync, unchanged. Sync, and the terms **anchor** and **gap** it works in, are
   defined in `doc-meta/SKILL.md`'s `## Sync` section. Sync matches inside a gap by position, not by which id
   used to carry which flag. A rewritten paragraph loses every anchor a plain sentence gave it, so the whole
   paragraph becomes one gap, and inside that gap the old and new sentences pair off in order regardless of what
   changed where. **Which old id disappears from a rewritten paragraph is decided by that position pairing, so it
   is not necessarily the id that carried `[delete]`.** What is guaranteed is that the deleted sentence's text is
   gone from the sidecar, and that the surviving sentences are re-split and re-numbered against the new paragraph.
   A `[keep]` or `[question]` block whose text did not move is a different case: its text still matches verbatim,
   so it still anchors on its own, and it keeps its id, weight, role, `flag:` and `review:` exactly as they were.
   An `[edit]` block whose wording changed, or a `[keep]`/`[question]` block step 6 changed, falls inside whatever
   gap its own paragraph became, and gets whichever id that gap's position pairing hands it, with `flag:` and
   `review:` dropped either way, since its text changed.

   **Reordering does not preserve ids, even though nothing in the moved text changed.** Anchors never look
   backwards (`doc-meta/SKILL.md`'s Anchors section only pairs at or after the last anchor), so an item that moved
   past another anchor cannot itself anchor: it is dropped as a deletion where it used to be, and comes back as a
   new block, with a new id, where it now sits. What keeps its id through a reorder is a block whose text did not
   change **and** did not move past another anchor, which an `[edit]` can produce as a side effect: flag `[edit]`
   on block A asking to move B after C, apply it to A's neighbors, and A's own text and position are untouched, so
   A still anchors, still carries its own `flag:` and `review:`, and the resync sees an edit already applied with
   nothing telling it so.

   Drop the `flag:` and the `review:` of a block like that yourself after the resync, when its own text is
   untouched but the reorder it named is done. Step 3 already applied the edit, and a flag left standing on an
   applied edit asks the next run to apply it a second time. In the report, it belongs with the applied edits.
8. Report: the ids deleted and the ids edited, as recorded in step 3, the `[question]` items still waiting on a
   human, **the id of every `[keep]` or `[question]` block changed by repair, its text as it stood before, and
   what forced the change** (the dedicated line from step 6), which paragraphs step 4 rewrote, what each repair
   item in step 5 found and did, the blocks skipped in step 2, with why, and the flags still standing on the
   sidecar after the resync in step 7.
