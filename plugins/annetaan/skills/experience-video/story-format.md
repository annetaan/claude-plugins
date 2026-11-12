# The story.md format

`story.md` is the contract between you and the renderer. You write it; `ev.js check` reads it and tells you what is wrong. Everything below is enforced by `check`, so run it after every edit.

Paths in this file are relative to `story.md`. Times are in seconds unless a unit says otherwise.

## Shape

````
---
<frontmatter>
---

## Brief
<prose, ignored by the renderer>

## Scene 1 — <name>
<prose: what the scene is for>
```yaml
<one scene block>
```
````

- Each scene is a `## Scene N — <name>` section. `N` counts from 1 and has to equal the scene's position. The separator may be `—`, `-` or `:`.
- Each scene has exactly one fenced `yaml` block. Zero or two is an error. Other fenced blocks are ignored.
- Keep the prose. It records why the scene exists and is what a later edit starts from.
- The whole video has to stay under 60 seconds.

## Frontmatter

```yaml
title: Evening Basket
language: en              # BCP 47. Sets <html lang>, the font stack and the narration voice
type: concept             # concept | pitch | team. Informational
output: { aspect: "16:9", fps: 30 }    # 16:9 is 1920x1080, 9:16 is 1080x1920, 1:1 is 1080x1080
music: { bpm: 96, beats_per_bar: 4, file: assets/track.mp3, offset: 0, volume: 0.8, fade_out: 1.5 }
theme: { background: "#1d2a22", foreground: "#f6f1e7", accent: "#f2a33a", font: "Georgia, serif" }
narration: { voice: Samantha, rate: 180 }
```

Only `title` is required. Defaults: `language: en`, 16:9 at 30 fps, `bpm: 100`, 4 beats per bar.
`music.file` is optional. When it is set, the file has to exist and stay inside the story's directory; it plays from `music.offset` seconds. Without it the renderer runs `music.js` beside `story.md` (the contract is in `music.md`); with neither the video has a silent audio track and the check warns `no-music`.

## Scene block

```yaml
role: peak                # pain | encounter | peak | everyday | headline | points | one-more-thing
narration: { text: "...", at: 0.5, voice: Samantha }    # optional; a plain string also works
cuts:
  - id: unbox             # optional; default s<N>c<M>; unique across the file
    part: custom          # card | image | video | screen | custom
    bars: 4               # exactly one of bars | duration (seconds)
    marks: { peak: 2bars }
    in: crossfade         # none (default) | fade | crossfade, or { type, duration }; default 0.5 s
    out: none             # none | fade, or { type, duration }
    telops:
      - { text: "...", at: 0, until: peak, position: bottom, style: caption }
```

- Cuts run one after another across all scenes. There is no overlap: a cut starts where the previous one ends.
- `narration.at` is measured from the scene start.
- Unknown fields and unknown parts are errors.

### Telops

A telop is a text overlay on a cut, above every part.
`at` defaults to 0. Give `until` or `for`, not both; the default is the cut's end. `position` is `top`, `center` or `bottom` (default `bottom`). `style` is `caption`, `title` or `headline` (default `caption`).
A telop has to be on screen long enough to read: at least 1 second, and about 15 characters a second (4 for Japanese, Chinese and Korean). A shorter one is a warning.

### Parts

| Part | Fields |
| --- | --- |
| card | `lines` (strings or `{ text, style: big/small/accent, count: { from, to, duration, decimals } }` with `{n}` in the text), `stagger`, `align`, `background` |
| image | `src`, `prompt`, `fit` (cover/contain), `zoom` (in/out/none), `focus` |
| video | `src`, `prompt`, `start`, `fit` |
| screen | `device` (phone/laptop), and one of `html` or `src` |
| custom | one of `html` or `src` |

Card defaults: `stagger` is 0.3 s, the delay between one line's entrance and the next. A line with `count` shows `from` rising or falling to `to` over `count.duration`, which defaults to one bar and is capped at the cut's length, with `count.decimals` defaulting to 0. `align` is `center` (or `left`, `right`). `background` is any CSS background and defaults to the theme background.

Other defaults: image `fit` is `cover`, `zoom` is `none` and `focus` is `center` (a CSS `object-position`). Video `fit` is `cover` and `start` is 0; `start` is a position in the file, a time expression that uses no mark and no `end` (`2s`, `1bar`), and it is never negative. Screen `device` is `phone`. A screen or custom cut takes exactly one of `html` (the fragment inline) and `src` (a file). `scenes.md` says when to pick each part and how to write a fragment.

A missing `src` on an image or video is not an error: the renderer draws a placeholder card showing `prompt` and the path to drop the file at. A missing `src` on a screen or custom cut is an error. `src` has to stay inside the story's directory.

### Transitions

`in: crossfade` on a cut lets the cut before it run on for the crossfade's duration while this one fades in. No start time moves. `in: fade` fades in from black; `out: fade` fades out to black.

## Time expressions

Used by `at`, `until`, `for`, `marks`, `stagger`, transition durations and `snapshot --at`.

```
term (('+'|'-') term)*
```

A term is a number with an optional unit (`s`, `beat`, `beats`, `bar`, `bars`; a bare number is seconds), `start`, `end`, or a mark name. `2bars + 1beat - 0.25s` and `peak + 1beat` are expressions.

- One bar is `beats_per_bar` beats, and one beat is `60 / bpm` seconds. Cut lengths in `bars` therefore stay on the music's grid.
- Marks are global. Every explicit mark and every written cut id (its start) is a mark. A defaulted id (`s2c1`) is not. There are no scene marks.
- A mark can only reference marks defined earlier in the document.
- Inside a cut an expression is measured from the cut's start. A mark from another cut converts through absolute time and has to land inside this cut.

### The peak

`timeline.peak` is the mark named `peak` when there is one, else the start of the scene with `role: peak`, else none. The music and the frame check read only this. A mark `peak` has to sit inside the scene with `role: peak` when both exist, and only one scene may have that role.

## What `check` reports

`ev.js check story.md` prints one JSON object: `{ ok, errors, warnings, duration, peak, scenes }`. Each finding is `{ code, scene, cut, message }`. Exit 0 means no errors, 1 means story errors. It writes `build/timeline.json`, the resolved times of every scene and cut.

Errors: 60 seconds or more; a telop or mark outside its cut; duplicate ids or marks; unknown fields or parts; both or neither of `bars` and `duration`; a scene heading number that does not match its position; a `peak` mark outside the peak scene; more than one peak scene; a missing file for a screen or custom cut.
Warnings: a telop shorter than its reading time; a cut boundary or telop start off the beat grid; no peak; narration longer than its scene; narration on a machine without `say`.
