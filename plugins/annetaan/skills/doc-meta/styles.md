# Writing styles

This is the only file that describes the writing styles and the rules each one follows. `doc-write` writes by it.
`doc-meta` records a document's style in the sidecar, and `roles/overview.md`, `doc-review/SKILL.md` and
`doc-revise/SKILL.md` judge the document by the rules of that style.

## The four styles

A document has one style. Choose it by how the reader reads the document, not by what kind of file it is.

| Style | Written for | How the reader reads |
| --- | --- | --- |
| `conclusion-first` | a README, a design document, a pull request description, a report, a proposal | reads the top, then goes down only as far as they need |
| `story` | a technical article, a blog post, a talk and its slides | reads from start to end, following the thread |
| `procedure` | a tutorial, setup instructions, an operations runbook | does each step while reading it |
| `reference` | an API description, a list of settings, a format definition | looks up one entry and leaves |

A document that compares options and recommends one is `conclusion-first`: the recommendation comes first, the
reasons after it.

## Rules for every style

### Every sentence earns its place

Judge each sentence against the document's purpose and its reader. A sentence the document could lose without
losing anything the reader needs does not go in. That includes a sentence that only restates something already said
in the same line of reading. Each style below says when a sentence that connects or frames is allowed.

### Plain words

**Do not coin terms and do not use abbreviations.** Say what a thing is, in words the reader already knows. A label
the writer made up for their own idea ("the second pass", "the R2 flow", "gap blocks") means nothing to a reader who
was not there when it was made up. An abbreviation saves the writer a few letters and costs the reader a lookup.

- Replace a coined term with a plain description of the thing. When the description is long and the thing comes up
  again and again, choose a common word for it and explain it where it first appears.
- Spell out an abbreviation. Keep one only when the reader knows it better than the full form, such as `URL` or
  `API` for a developer.
- A name the reader has to type or search for stays as it is: a command, a file name, a product name, an identifier
  in code. Explain it where it first appears.
- A term from the reader's own field stays when the reader knows it. It is only jargon to someone else.

### Where a term is explained

Explain a new term before the sentence that first uses it, or in that sentence, or in the one right after it. A
term used first and explained right away reads naturally. A term used and explained paragraphs later does not.

### Warnings

Put a limit, an exception or a warning where the reader meets the claim or the instruction it limits, never after
the reader has already acted on it.

### Promises

When the document says it will cover something, it covers it. When it gives a count ("three reasons", "two
exceptions"), what follows matches the count.

### References

- "This", "that", "it" and "the latter" point at something the reader just read.
- A reference by position ("above", "below", "the previous section") points at something that is there.
- A reference by heading name uses a heading that exists, spelled as it is.

### Repetition

Never say the same thing twice in one line of reading. Each style below says when a repetition is allowed because
it serves a different way into the document, such as a summary and the detail under it.

## `conclusion-first`

- **Order**: the conclusion, then the reasons, then the details. The same order holds inside each section and each
  paragraph. The first sentence of a section tells the reader whether to read on.
- **Repetition**: a summary at the top and the detail below it may say the same thing. A section may repeat a
  premise it needs, so that it can be read on its own.
- **Connecting and framing sentences**: none. Headings do that job.
- **The writer**: stays out of it. No first person and no account of how the writer got there, unless that account
  is the point of the document.

## `story`

- **Order**: the situation, the problem, what was tried, what was learned, the conclusion. Tell the reader near the
  start what question the story answers, even though the answer comes at the end.
- **Repetition**: a short recap of the conclusion at the end is allowed.
- **Connecting and framing sentences**: allowed where they carry the thread from one part to the next.
- **The writer**: first person, concrete episodes, numbers, and how it felt are the substance of this style.

## `procedure`

- **Order**: the order in which the reader does things. What a step needs comes before the step. A warning comes
  before the step it applies to.
- **Steps**: one action per step. Say what the reader should see when the step worked.
- **Repetition**: repeat a command or a value where the reader needs it, instead of sending them back to find it.
- **Connecting and framing sentences**: none.
- **The writer**: stays out of it.

## `reference`

- **Order**: entries in a fixed order the reader can predict, such as alphabetical or grouped by area. Every entry
  has the same structure.
- **Repetition**: each entry is complete on its own, even when that repeats what another entry says.
- **Connecting and framing sentences**: none.
- **The writer**: stays out of it.
