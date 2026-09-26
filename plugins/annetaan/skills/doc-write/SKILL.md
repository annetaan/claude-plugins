---
name: doc-write
description: Writes one document, or rewrites an existing one, in one of four styles (conclusion-first, story, procedure, reference) and by that style's rules, so that it already meets what the doc-meta, doc-review and doc-revise loop would otherwise have to catch afterwards, in plain words instead of coined terms and abbreviations. Use it only when named or invoked as /annetaan:doc-write, with the path of the document as the argument and what the document is for in the request.
---

# doc-write

Writes one document at the path given as the argument. When the file exists, rewrites it. When it does not, writes
it from what the user asked for.

`doc-meta`, `doc-review` and `doc-revise` find and fix problems in a document after it is written. `doc-write` writes
so that they have less to find, by the same rules they judge by.

## Paths: `$DOCWRITE`

The top of this instruction carries an absolute path as `Base directory for this skill:`. **`$DOCWRITE` below means
that path.** It is not a shell variable. Replace it with the real absolute path when you read a file.

The styles and their rules are not described here. Read `$DOCWRITE/../doc-meta/styles.md`, the only file that
describes them.

## Steps

1. Read the path given as the argument. When the file exists, read it whole. It is the material to rewrite, and
   everything it says that still serves the purpose has to survive the rewrite. Read any file the request points
   to as well, and read `styles.md`.
2. Settle three things before writing a sentence, and put all three at the top of the report:
   - **Purpose**: what the document has to get done, in one line.
   - **Reader**: who reads it, and what they already know.
   - **Style**: one of the four in `styles.md`, chosen by how this reader will read the document.

   Take them from the request and from an existing document. Ask the user with `AskUserQuestion` when the reader or
   the style cannot be inferred, because every rule is judged against these two. A rewrite may change the style
   when the request asks for it or when the old one does not fit how the document is read.
3. Choose the language. An existing document keeps its own language. A new one is written in the language the user
   names, and otherwise in the language of the other documents in the same repository. When this session lists a
   skill about writing style or voice that covers that language, load it before writing.
4. Write the document by the rules for every style in `styles.md` and the rules of the chosen style.
5. Read the whole draft once more, top to bottom, against those rules. Fix what you find. Reading sentence by
   sentence is not enough here. Repetition, order and broken promises only show across the whole document.
6. Write the file.
7. Report: the purpose, the reader and the style from step 2, every term the document explains where it first
   appears (see "Plain words" in `styles.md`) with why no common word would do, and, for a rewrite, every fact,
   instruction or warning you dropped. Say that `/annetaan:doc-meta <path>` is the next step if the user wants to
   flag individual sentences.

## Rewriting an existing document

Rewrite whole paragraphs, not the holes in them, so that each paragraph reads as a paragraph again instead of a
patched seam. Keep every fact, instruction and warning that still serves the purpose, even when you change every
word around it. When you drop one because it no longer serves the purpose, list it in the report.
