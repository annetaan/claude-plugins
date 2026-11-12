# Music: the script contract

A reference for whoever writes `music.js`, the track of a story that has no music file. The renderer runs the script
and writes `build/music.wav`; the script never writes a file. The sample's `sample/music.js` is a complete example.

## The contract

`music.js` sits beside `story.md` and assigns one function to `window.compose`:

```js
window.compose = async (ctx, timeline, helpers) => {
  // build the sound on ctx
};
```

- `ctx` is a Web Audio `OfflineAudioContext`: two channels, 48 kHz, as long as the video. Connect everything to
  `ctx.destination`. The renderer calls `ctx.startRendering()` after `compose` returns, so do not call it.
- `timeline` is the resolved story (`build/timeline.json`). The fields a script reads:

  | Field | Meaning |
  | --- | --- |
  | `duration` | length of the video, seconds |
  | `bpm`, `beatsPerBar`, `beat`, `bar` | tempo; `beat` and `bar` are seconds |
  | `peak` | seconds of the peak, or `null` |
  | `scenes[]` | `role`, `start`, `end` (seconds), `startBar` (the bar the scene starts on), `bars` (its length in bars) |

- `helpers.bar(n)` and `helpers.beat(n)` give `n` bars or beats in seconds (`bar(0)` and `beat(0)` are 0).
  `helpers.random()` returns a number in [0, 1) from a seeded generator.

Read every time from `timeline` and `helpers`. **Never write a bar count or a number of seconds into the script**:
the story's cuts will change, and the music has to follow them.

## Rules

- No network: a request for anything but a local file or a `data:` URL fails the script.
- No audio files: build every sound from oscillators and noise. The renderer does not check this; keep it.
- No clock: no `Date`, no `performance.now`, no timers. The same script and timeline always give the same sound. A call to any of them fails the script.
- Randomness only through `helpers.random()` or `Math.random()`. Both are seeded, so a take can be reproduced.

A script that throws, never assigns `window.compose`, makes a blocked request or uses the clock fails the command with
`music-script`. That is a story error: fix the script.

## Shaping the track

Follow the roles of the scenes and put the musical peak on `timeline.peak`:

- `pain`: sparse and low. A pad and a slow bass note.
- `encounter`: a pulse joins and grows.
- the scene with the peak: a build-up (hats that speed up, a rising noise sweep) that lands exactly on `timeline.peak`,
  then the full arrangement from there.
- `everyday`: a steady groove, lighter than the full arrangement.
- `headline`: a chord that resolves and rings into the fade-out.

Place sounds on the grid: a note on beat `b` of bar `g` starts at `helpers.bar(g) + helpers.beat(b)`. Use
`scene.startBar + k` for the `k`-th bar of a scene.

## Building blocks

- **Kick**: a sine whose frequency falls from about 150 Hz to 45 Hz in 0.12 s, with a gain that decays over 0.3 s.
- **Hat**: a short burst of noise (a looped `AudioBuffer` of random samples) through a high-pass filter near 7 kHz.
- **Clap**: the same noise through a band-pass filter near 1.9 kHz, 0.14 s long.
- **Pad**: two or three sawtooth oscillators per note, detuned a few cents apart, through a low-pass filter near 1 kHz,
  with a slow attack and release.
- **Bass**: a triangle wave an octave or two below the chord, through a low-pass filter.
- **Master**: route everything through one gain and a `DynamicsCompressor` before `ctx.destination`, and keep the gain
  low enough that the loudest section stays below clipping.

## Checking without listening

Run the `music` command, called the way `check` is, and read the answer instead of listening. It prints `levels` (the loudness of every bar, RMS from 0 to 1), `loudestBar`, and `peakBar` (the bar that holds
`timeline.peak`). The good shape: the levels rise through the build-up, `loudestBar` is at or after `peakBar`, and the
quietest bars are at the start, apart from the closing chord that fades out. A second run with an unchanged script and timing says `cached: true`.

Three warnings say what to fix:

- `music-clipping`: some samples went past full scale. Lower the master gain or add a compressor.
- `music-silent`: even the loudest bar is almost silent. Something is not connected to `ctx.destination`, or a gain is 0.
- `music-peak-weak`: the mean level of the two bars from the peak is below 1.5 times (about 3.5 dB) the mean level of
  all the bars before it. Strengthen the arrangement from the peak, or make the intro and the build-up quieter.

## Using a track you were given

Set `music.file` in the frontmatter to a file inside the story's directory and the script is not run:

```yaml
music: { bpm: 96, file: assets/track.mp3, offset: 12.5, volume: 0.8 }
```

`bpm` has to be the track's own tempo, or the cuts will not sit on its beat; `offset` is where in the file the video
starts, in seconds. `volume` and `fade_out` apply to a file as they do to a script.
