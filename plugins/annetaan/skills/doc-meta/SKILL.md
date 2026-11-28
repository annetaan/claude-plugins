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

**`$DOCMETA` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

`$DOCMETA` is not a shell variable. Replace it with the real absolute path when you run bash and when you write a
prompt for the overview sub-agent.

This skill uses these files:

- the script `$DOCMETA/scripts/sidecar.sh`, written `sidecar.sh` below. Every subcommand prints one JSON object with
  a `status`. A non-zero exit is a usage error or an unexpected failure: quote its message and stop

Run `mktemp -d` once per run. `$TMP` below is the directory it printed. A shell variable does not outlive one
command, so write the path in full each time.

## Steps

1. Read the path given as the argument. It names one document. Read `$DOCMETA/format.md`, which is the only
   description of the sidecar's shape, and `$DOCMETA/styles.md`, which the `style` field refers to. If the path is itself a sidecar (its name ends in `.doc-meta.md`), say so
   and stop.
2. Make git ignore the sidecar, where `<dir>` is the document's directory and `<name>.doc-meta.md` the sidecar's
   file name as `format.md` **File name** builds it. Outside a git repository
   (`git -C '<dir>' rev-parse --show-toplevel` fails), do nothing here and continue.

   Inside one, run `git -C '<dir>' check-ignore -q '<name>.doc-meta.md'`. When it passes, continue. When it fails,
   add `*.doc-meta.md` to the exclude file git resolves, unless that file already holds the line, and check again:

   ```bash
   X=$(git -C '<dir>' rev-parse --path-format=absolute --git-path info/exclude)
   if ! grep -Fxq '*.doc-meta.md' "$X" 2>/dev/null; then
     mkdir -p "$(dirname "$X")"
     if [ -s "$X" ] && [ -n "$(tail -c1 "$X")" ]; then printf '\n' >> "$X"; fi
     printf '*.doc-meta.md\n' >> "$X"
     printf 'appended: %s\n' "$X"
   fi
   git -C '<dir>' check-ignore -q '<name>.doc-meta.md' || printf 'still not ignored\n'
   ```

   Continue in every case, without asking. The sidecar is written whether or not it is ignored, and doc-meta never
   commits it. `info/exclude` stays in the clone, reaches every worktree of it and commits nothing, so `.gitignore`
   is never edited.

   Keep for step 8 what the block printed: `appended: <path>` with the exclude file's path when it added the line,
   and `still not ignored` when the second `check-ignore` fails. It fails when a `.gitignore` rule negates the line
   (such as `!<name>.doc-meta.md`) or the sidecar is already tracked. That is the user's to settle.
3. Split the document into blocks by **Splitting the document into blocks** in `format.md`, and write them to
   `$TMP/blocks.md`: one `### <n>` line per block, `### <n> verbatim` for a block whose role will be `verbatim`, `n`
   from 1 in document order, each followed by the block's `>` lines exactly as **Block body** in `format.md` writes
   them (the three-line record for a fence of more than ten content lines included), a bare `---` line between two
   blocks at a paragraph break, and nothing else. Copy each block's text from the document, never retyped. Then
   run:

   ```bash
   $DOCMETA/scripts/sidecar.sh sync "<document>" "$TMP/blocks.md"
   ```

   `sync` matches the blocks against the existing sidecar as **Sync** below says, and writes the sidecar, with
   `## Whole document` set to `(pending)`. Keep its `ok` output for step 8. On a `stop`, it writes nothing:

   - `blocks` `{line}`: the blocks file breaks the shape at that line. Fix it and run `sync` again.
   - `not-in-document` `{block}`: block `n` is not the document's text after the block before it. Copy that block's
     text from the document again, check its place in the order, and run `sync` again. When the same block stops a
     second time, say so with the block's text and stop.
   - `sidecar` `{line}`: the existing sidecar's `## Blocks` has a heading with no id, or two blocks with one id.
     Quote the line, tell the user to fix it by hand, and stop. Guessing an id would move a human's flag onto
     another sentence.
   - `is-sidecar`, `no-document`: say so and stop.
4. Fill in the sidecar `sync` wrote:

   - Each `### <id> (pending)` heading becomes a heading in the shape of **Block heading** in `format.md`, with its
     weight and role, and the block gets its reading aid.
   - An unchanged block keeps its id, `>` lines, weight, role, `flag:` and `review:`. Its reading aid is written
     again when its tag is not this run's reading language, or dropped when the block is already in that language.
   - `echoes` and `needs` are computed again for every block.
   - The `weights` line is written from the headings. The `Weight sorts little…` line is added or removed by the
     rule under **`## Document`** in `format.md`.
   - An empty `purpose`, `reader`, `style` or `source language` line is filled. A filled one is kept.

   Never edit a `>` line, an id, `blocks` or `max id`: `sync` owns them. Then run this until it prints `"ok":true`:

   ```bash
   $DOCMETA/scripts/sidecar.sh verify "<document>"
   ```

   For each entry in `reasons`:

   - `pending`: fill that block.
   - `heading`: rewrite the heading in the shape of **Block heading** in `format.md`.
   - `weights`: write the line again from the headings.
   - `no-flag`: put back the empty `flag:` line.
   - `not-in-document`, `order`, `duplicate-id`, `max-id`, `count`: `sync` wrote these right, so an edit in this
     step changed a `>` line, an id, `max id` or `blocks`. Put back what `sync` wrote.
   - A reason that stands after two fixes: say which and stop.
5. Hand the document and the sidecar to the overview sub-agent:

   ```
   Agent(subagent_type: "annetaan:doc-meta-overview", description: "doc-meta overview",
         prompt: "Read $DOCMETA/roles/overview.md first and follow the role it describes.\n\ndocument: <abs path>\nsidecar: <abs path>\nformat.md: $DOCMETA/format.md\nstyles.md: $DOCMETA/styles.md\nWrite the bullets in <the language the user is using in conversation>.")
   ```

   The sub-agent's own role file names `format.md` and `styles.md` but has no path of its own to either, so this
   prompt is the only place those paths reach it.

   The sub-agent starts fresh and has not seen this conversation, so name the language explicitly. It has no other
   way to know it.
6. Check what comes back before writing it in. Write the bullets to `$TMP/bullets.md`, one `- ` line each as
   **`## Whole document`** in `format.md` writes them, a bullet that came back wrapped joined onto one line, and
   nothing else in the file. Then run:

   ```bash
   $DOCMETA/scripts/sidecar.sh quotes "<document>" "$TMP/bullets.md"
   ```

   `bullets` holds one entry per line of the file, `index` from 1. Send a bullet whose `ok` is false back once, with
   `SendMessage`, naming its `code`: `no-block` is an id the sidecar does not have, `no-quote` an id with no quote,
   or a quote that is not in that block's text. Put its correction in its place in the file and run `quotes` again.
   Drop a bullet that is still false.
7. Replace `(pending)` under `## Whole document` with the bullets `quotes` passed. **Write `(none)` only when the
   overview pass ran and returned no bullets at all.** When the overview pass returned bullets and step 6 dropped every one
   of them, leave `(pending)`, with that as the reason on the line after it. `(none)` means a full read found
   nothing. Writing it for a read that found something, or for no read at all, says the opposite of what happened,
   and would let an unconverged document count as converged.
8. Report, from the `ok` output of step 3's `sync`: `sidecar`, the block count, the weight counts from the `weights`
   line step 4 wrote, the counts of `unchanged`, `changed`, `new` and `deleted`, every id in `flagsDropped`, and,
   when `maxIdRebuilt` is true, that `max id` was rebuilt and may hand out a deleted id again. Then the number of
   `## Whole document` bullets written, any bullet that was dropped in step 6, the exclude file's path when step 2
   printed `appended:`, and, when step 2 printed `still not ignored`, that the sidecar is still not ignored, because
   a `.gitignore` rule negates the line or the sidecar is already tracked.

## Sync

| Case | `sync` | Step 4 |
| --- | --- | --- |
| Text matches | Keeps the block whole | Rewrites a reading aid in another language |
| Text changed | Keeps the id, writes `(pending)` and an empty `flag:`, drops flag and review | Writes weight, role and reading aid |
| A new block | `max id` plus one, written as `(pending)` | The same as a changed block |
| An old block with no counterpart | Drops it, with flag and review | - |

An **anchor** is an old block and a new block with identical `>` text, compared as **Invariant** in `format.md` says
(exactly when the new block is marked `verbatim`), taken in document order on both sides and never backwards: a
block that sits before an earlier anchor on either side never anchors. Anchors cut both lists into **gaps**, one
before the first anchor, one between each two and one after the last. Inside a gap the old and new blocks pair by
position as changed blocks, the first with the first, and what is left over is new blocks on one side or deletions
on the other. The first run is the same operation with no old blocks and `max id` at `b000`. `sidecar.sh sync` does
all of this. The paragraph is here to read which id a block kept.
