# Scenes: the five parts, telops, transitions, and how to write a fragment

A reference for whoever writes a story. The field list and the time expressions are in `story-format.md`; this file says
what each part is for, what it does when a field is left out, and how to write the HTML of a `screen` or `custom` cut.

## The five parts

| Part | Pick it for | Fields (defaults) |
| --- | --- | --- |
| `card` | words and numbers: a question, a headline, a counted figure | `lines`, `stagger` (0.3 s), `align` (center), `background` (theme) |
| `image` | a still picture: a place, an object, a face | `src`, `prompt`, `fit` (cover), `zoom` (none), `focus` (center) |
| `video` | a moving clip you already have | `src`, `prompt`, `start` (0), `fit` (cover) |
| `screen` | a product on a phone or a laptop | `device` (phone), and one of `html` or `src` |
| `custom` | anything drawn in HTML: a chart, a burst, a diagram, a moving logo | one of `html` or `src` |

- **card** is the safe default. A counted line (`count`) is the cheapest way to make a number move.
- **image** zooms slowly when `zoom` is `in` (scale 1 to 1.08 over the cut) or `out` (the reverse). `fit: cover` fills
  the frame and crops; `fit: contain` shows the whole picture with the theme background around it. `focus` is a CSS
  `object-position` such as `left top` or `30% 40%`, and says which part survives the crop.
- **video** plays the file from `start` (seconds or any time expression that needs no mark, such as `2s` or `1bar`).
  There is no sound from the clip. A clip shorter than the cut holds its last frame. A video cut is drawn from
  extracted frames, so a seek is exact and nothing depends on playback.
- **screen** draws a device frame in the middle of the stage and puts the fragment inside it. A phone screen is 390 by
  844 CSS pixels and a laptop screen is 1280 by 800; the frame is scaled to fit (a phone to 80 % of the stage's height,
  a laptop to 78 % of its width), so the fragment lays out in pixels against that logical size and looks the same at
  every output size and aspect.
- **custom** gives the fragment the whole stage. Lay it out in viewport units (`vmin`, `vw`, `vh`, `%`), so that it
  reflows when the story is 9:16 or 1:1.

A cut with no `src` file on disk draws the placeholder (below), so a story renders before any picture exists.

### The placeholder

An `image` or `video` cut whose `src` is missing (or has no `src`) draws a dashed card with the word IMAGE or VIDEO, the
`prompt`, and the `src` path when one is given. Name the `src` you want in the story, drop the file there, and render
again: only that cut renders again. A `screen` or `custom` cut with a missing file is an error instead, because there is
nothing sensible to draw.

## Telops

A telop is a line of text above every part, fragments included. Fields, timing and the reading-time rule are in
`story-format.md` ("Telops"). Keep one idea to a telop. On a `screen` cut the device fills most of the height, so
prefer no telop there, or a short one at the bottom.

## Transitions

`in` and `out` on a cut: `fade` from or to black, `crossfade` into the cut from the one before. Nothing moves on the
timeline. Details are in `story-format.md` ("Transitions").

## Writing a fragment

A fragment is a piece of HTML, optionally with `<style>` and `<script>`. Write it inline as `html:` or in a file under
`assets/custom/` and name it with `src:`. The renderer puts it into the page of its cut and draws the page one frame
at a time.

### What it gets

- `window.cut`: `{ duration, marks, beat, bar, width, height, language, stage }`. `duration`, `beat`, `bar` and `marks`
  are in seconds, and `marks` holds the marks defined inside this cut, relative to the cut's start. `width` and `height`
  are the size the fragment lays out against: the stage for a `custom` cut, the device's logical screen for a `screen`
  cut. `stage` is `{ width, height }`, the output size, in both.
- The theme as CSS variables: `--bg`, `--fg`, `--accent`, `--font`.
- One variable per mark of the cut, as seconds: a mark `peak` is `--mark-peak`, for example `2.5s`. It works in
  `animation-delay` and `animation-duration`.
- `--t` (the time inside the cut, in seconds) and `--p` (the same as a fraction of the cut, 0 to 1), updated on every
  frame.

### How it animates

The renderer pauses every animation and sets its time for each frame, so:

- **CSS animations and transitions** work as they are. Give them `animation-fill-mode: both` (or use `both` in the
  shorthand) so that a delayed animation shows its first keyframe before it starts and its last one after it ends.
  The first keyframe is how the cut looks before the animation starts, so make it the neutral state.
  `animation-delay: var(--mark-peak)` puts a motion on a mark.
- **Anything else** (a canvas, an SVG you build in script) defines `window.renderAt = function (t) { ... }`. The
  renderer calls it for every frame with the time inside the cut in seconds, and the function draws that exact moment.
  It must give the same picture for the same `t`.

### The rules

The page has no real clock and no network. Breaking a rule fails the cut, names it, and renders nothing for it.

| You did | Error |
| --- | --- |
| called `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date.now`, `performance.now` or `new Date()` with no argument | `fragment-clock`, listing what was called |
| requested anything that is not a local file, a `data:` URL or a `blob:` URL (a font from a CDN, an API, an image on the web) | `fragment-network`, with the first URL |
| let a script throw, or let `window.renderAt` throw | `fragment-error`, with the message |

Put pictures next to the story and name them by a path relative to `story.md` (`assets/photo.png`, also in `url(...)`),
or inline them as `data:` URLs. `new Date(0)` and other dates built from a value are fine.

A file a fragment loads is not tracked by the cut cache: only the fragment's text and the file named by `src` are. After
replacing such a picture, render with `--force`, or inline the picture as a `data:` URL, which is part of the fragment's
text and so of the cache key.

### Layout

- Styles are global to the page. Scope every selector under `#fragment` (`#fragment .bar { ... }`), the element that
  holds your fragment, so that your rules never touch the telops.
- A `screen` fragment fills a box of the logical size, so use pixels there. A `custom` fragment fills the stage, so use
  viewport units.
- The fragment is positioned inside a box that is already `position: relative` (`screen`) or `absolute` (`custom`), so
  `position: absolute; inset: 0` on your root element fills the cut.

### A short fragment

A bar that fills up to the `peak` mark and flashes there. The cut needs `marks: { peak: 2bars }`.

```html
<style>
  #fragment .meter { position: absolute; left: 10vmin; right: 10vmin; top: 48%; height: 3vmin; background: rgba(255, 255, 255, 0.18); border-radius: 2vmin; overflow: hidden; }
  #fragment .meter i { display: block; height: 100%; background: var(--accent); transform-origin: left; animation: fill var(--mark-peak) ease-out both, flash 0.4s ease-out var(--mark-peak) both; }
  @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes flash { 0% { filter: brightness(1); } 15% { filter: brightness(2); } 100% { filter: brightness(1); } }
</style>
<div class="meter"><i></i></div>
```
