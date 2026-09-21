# The sidecar format

This is the only file that describes the shape of a doc-meta sidecar. `roles/overview.md`, `doc-review/SKILL.md`
and `doc-revise/SKILL.md` all point here instead of copying any of it. If you find the role set, the field list or
the splitting rules written out anywhere else, that is a copy and it will drift. Fix it by deleting the copy, not
by editing both.

## File name

`path/to/X.md` gets a sidecar at `path/to/X.doc-meta.md`, next to it.

## Header comment

The first line of the sidecar is always this comment, generated fresh each time, not copied from anywhere. `Format:`
carries this file's own absolute path (`$DOCMETA/format.md` at generation time), not the bare name, since a
sidecar can sit anywhere next to anything and a bare `format.md` would not resolve from there:

```
<!-- flag: [keep] [delete] [edit] [question], then free text. Format: /absolute/path/skills/doc-meta/format.md -->
```

## `## Document`

A section of its own, not folded into an example. Fields:

- `purpose`: what the document is trying to do, one line.
- `reader`: who it is written for.
- `source language`: the language the document is written in.
- `length`: lines and words, or for a Japanese document, lines and characters instead of words.
- `blocks`: the block count.
- `weights`: the count of blocks at each weight, `w1` through `w5`.
- `max id`: the largest id ever assigned in this sidecar's history, including ids of blocks since deleted. In a
  sidecar that does not exist yet it starts at `b000`, so the first block assigned is `b001`. The sidecar is
  hand-edited, and this line can go missing like any other. When it is missing from an existing sidecar, rebuild
  it as the largest id present in `## Blocks`, and say so in doc-meta's report, since that rebuild can hand out
  an id that was already used and deleted.

When `w4` and `w5` together are 80% or more of the block count, add one more line after `weights`:

```
Weight sorts little in this document. Read Whole document first.
```

A procedure or a reference is mostly essential by nature, and the line says so instead of pretending the weights
sorted it.

## `## Whole document`

Bullets: what a one sentence flag cannot reach on its own. Repetition across sections, ordering problems, sections
that could be merged, promises made and never kept. Written in the language the user is using in conversation, not
necessarily the document's own language, because the sidecar exists for a human to read fast and never enters the
repository. A quote taken from the source stays in the source's own language, unchanged.

- `(none)` on a line by itself when there is nothing to say. An empty list is a correct result, and it means a
  full read happened and found nothing. It is never written for a read that did not happen, or for one whose
  findings did not survive verification.
- `(pending)` while `doc-meta-overview`, the sub-agent doc-meta spawns, is still working on it, and also when no
  overview agent could be run at all, or when it ran and returned bullets but none of them survived verification.
  In these last two cases, doc-meta writes the reason on the line right after `(pending)`, so a human can tell a
  run still in flight from a run that did not converge, rather than reading all three as the same wait.

**Every bullet that names a block id carries a quote from that block**, so that writing the bullet forces opening
the block:

```
- b080 ("carries the line across") repeats b010 ("carries `flag:` and `review:` lines across").
```

## `## Blocks`

Blocks are grouped by paragraph. A paragraph break in the source is a `---` line between groups. A heading is a
group of one, on its own. A list item that recurses into further blocks, by the splitting rule below, keeps every
block that recursion produces (its own lead-in sentences, and each block of its nested list) in the one group the
list itself is in. The recursion splits a list item into blocks. It never opens a new paragraph group.

### Block heading

```
### b003 w2 restatement echoes:b002 needs:b001
```

`id`, `weight`, `role`, then any `echoes:` and `needs:`, each a comma-separated list when there is more than one
target (`echoes:b002,b004`). Omit `echoes:` or `needs:` entirely when a block has none.

### Block body

```
> In other words, you can use it straight from a script tag.
ja: 言い換えると、script タグから直接使えます。

flag: [delete] b002 says the same thing
review: Dropping this loses the phrase "script tag", which is what a reader searches for.
```

- `> ...`: the source text, quoted. Several `>` lines are allowed for a block that spans lines. A blank line
  inside a block is recorded as a bare `>`, with nothing after it. A block whose source is itself a blockquote is
  quoted twice: `> > ...`.
- `ja:`: a reading aid, present only when the source is not Japanese, and never on a `verbatim` block (a table or a
  code fence is not translated).
- `flag:`: always present, even empty.
- `review:`: present only after `doc-review` has answered the flag.

### Splitting the document into blocks

- One sentence is one block.
- **A list item is one block**, however many sentences it holds, **as long as it holds no further block-level
  structure of its own** (no nested list, no second paragraph inside it). A human keeps or cuts a plain list item
  as a unit. A list item that itself contains a nested list, or more than one paragraph, does not get this
  treatment: split its own lead-in text sentence by sentence like ordinary prose, and recurse into its nested list
  by this same rule. A numbered procedure step that only introduces a sub-list below it is this second case, not
  the first, since flagging the whole step as one unit would put a human's opinion on several unrelated
  instructions at once.
- **A blockquote is one block.** It is usually someone else's words, and rewriting it is a different kind of edit
  from rewriting the author's own sentence.
- A heading is one block, role `heading`.
- A table is one block, whole, role `verbatim`.
- A code fence is one block, role `verbatim`. Count content lines only, between the fences, not counting either
  fence line. **Ten of those or fewer: record the whole fence, opening line, every content line, and closing
  line.** Over ten, record exactly three lines instead: the opening fence line, the first content line, and
  `... <n> more lines`, where `<n>` is the number of content lines after the first. The closing fence is not
  recorded in this shorter form. This three line record is what gets compared for sync, since the full fence is
  not a stable string to re-derive the same way twice. Example, for a fence with 14 content lines:

  ```
  > ```python
  > def f():
  > ... 13 more lines
  ```
- YAML frontmatter is one block, role `verbatim`, weight `w5`.
- Anything that is none of the above (a thematic break, an HTML comment, a link reference definition, a bare image
  line) is not a block, and is skipped. A `---` that marks a thematic break inside the flowing text is one of these
  and is skipped. A `---` used as the paragraph-break marker between block groups (see above) is sidecar notation,
  not source text, and was never a candidate block in the first place.

### Invariant

**Except for a fence recorded as the three line form above, the source text of every block is a verbatim substring of
the document it was split from.** Sync, the matching procedure in `doc-meta/SKILL.md`'s `## Sync` section,
depends on this being exactly true. A paraphrased or normalized quote breaks the anchor match silently.

"Verbatim" is about words, not about where the document's own word-wrap happens to break a line, for a prose
block (any role but `verbatim`). A prose block's word-wrap width is not part of its identity, since a document can
be reflowed at a new width and still say the same thing. When comparing a prose block's `>` quote against the
document (here, in "Verifying a block against the document" below, and in Sync's anchor match, which compares one
sidecar's `>` quote against the other's), treat a run of whitespace, including a line break that is only the
source's own soft wrap, as equivalent to a single space on both sides of the comparison. A `>` quote wrapped
across several lines is compared the same as one written on a single line.

**A `verbatim` block is compared exactly, whitespace included.** A table, a code fence recorded in full (ten
content lines or fewer), and frontmatter all carry whitespace as content: an indent, a column of spaces, a blank
line inside a fence, all mean something and none of them soft-wraps. Normalizing these would let a real change (an
indent width, a re-aligned column) through as an anchor match, silently freezing the sidecar's quote to text the
document no longer has.

### Verifying a block against the document

`doc-review` and `doc-revise` both need this, to check a flagged block is still what it was when the human flagged
it, before answering or acting on it. Strip the leading `> ` from each quoted line, and the bare `>` from a line
that records a blank one (just the outer marker for a block quoted as `> > ...`, since that inner `> ` is source
text), then join what remains with a newline. The result must appear verbatim, as a contiguous substring, in the
document, comparing whitespace as the invariant above says.

A fence recorded in the three line form is exempt from this, per the invariant above: its record is not document
text and never will be. Verify it instead by checking that the record's opening fence line and first content line
both still appear, together and in that order, inside some code fence in the document. Do not check the third
line. `... <n> more lines` is a count, not source text, and a change in `<n>` is exactly what the next `doc-meta`
sync exists to catch, not this check.

### An id is identity, not position

A block id is assigned once and never reused. A gap in the numbering (`b003`, `b004`, `b007`) is normal after a
block has been deleted, not a bug to close up. Sync assigns a new id by reading `max id` from `## Document` and
adding one, then writing the new `max id` back. Deleting the block that held the highest id does not lower `max
id` again, which is what keeps a deleted id from being handed to a new block.

## Roles

A closed set. Pick exactly one per block.

| Role | One line |
| --- | --- |
| `heading` | A heading. |
| `claim` | An assertion the document is making. |
| `evidence` | Support offered for a claim: a number, a measurement, a citation. |
| `example` | A worked instance of a claim or an instruction. |
| `definition` | Fixes what a term means. |
| `restatement` | Says again, in different words, something already said. |
| `transition` | Moves the reader from one point to the next without adding a point. |
| `scaffold` | Frames what is coming or what came ("in this section", "as noted above") without adding a point. |
| `caveat` | A limit, an exception, a warning. |
| `instruction` | Tells the reader to do something. |
| `verbatim` | A table, a code fence, or frontmatter: recorded as a unit, not sentence-split. |

Redundancy tends to hide in `restatement`, `transition` and `scaffold`. Count them. A document where these three
are more than half the blocks is padded.

## Weight

`1` to `5`, written `w1` through `w5` in a block heading, judged against the document's own `purpose`.

- `5`: the document cannot lose it without losing its point.
- `4`: the document would be poorer for losing it.
- `3`: it carries something real, and the document still stands without it.
- `2`: it helps a reader who is already lost, and no one else.
- `1`: it could go and nothing downstream would notice.

Weight and role are independent: a `caveat` can be a `5`, and a `claim` can be a `2` if it only repeats the
purpose statement.

## `echoes` and `needs`

- `echoes:<id>`: this block says again what `<id>` already said. The evidence for cutting one of the two.
- `needs:<id>`: this block stops making sense if `<id>` is removed. The cost of cutting `<id>`. **`needs` crosses
  sections.** A sentence in the last section can depend on a definition in the first paragraph. Do not compute
  `needs` only within a block's own paragraph.

## The four flags, and `review:`

A skill never writes a flag.

- `[keep]`: leave this block's text exactly as it is, even if a later repair pass would otherwise touch it.
- `[delete]`: cut this block.
- `[edit]`: replace this block's text. The free text after the flag is the human's own instruction for how.
- `[question]`: the human wants an answer before deciding. The free text is the question.

`review:` is `doc-review`'s answer to the flag on that block. `doc-review/SKILL.md` owns what it answers for each
flag. It is never written by a human and it is dropped whenever the block's text changes underneath it, because
nobody has reviewed the new text yet. Written in the language the user is using in conversation, for the same
reason `## Whole document` is. A quote of another block's source text inside a `review:` line stays in that
source's own language.
