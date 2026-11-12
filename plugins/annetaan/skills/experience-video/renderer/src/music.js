// Music: runs the story's music script in a headless page and writes build/music.wav.
//   - The script assigns window.compose = async (ctx, timeline, helpers) => {} and builds its sound on an
//     OfflineAudioContext; this file renders it, counts clipped samples, measures the loudness of every bar and
//     writes the WAV.
//   - The result is cached by a key over the script and the timeline's timing, so editing a telop does not synthesize again.
import fs from 'node:fs';
import path from 'node:path';
import { sha, stable } from './hash.js';
import { openBrowser, isBlockedUrl, clockGuard, CaptureError } from './capture.js';

export const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const CHUNK_SECONDS = 5;
const SEED = 20240611;
export const SILENT_RMS = 0.001;
export const PEAK_MARGIN = 1.5; // the bars from the peak have to be this many times louder than the bars before it

// Where the story's music comes from: a file named in the frontmatter, the script beside story.md, or nowhere.
export function musicSource(timeline, storyDir) {
  if (timeline.music.file) {
    return { kind: 'file', file: path.resolve(storyDir, timeline.music.file), offset: timeline.music.offset ?? 0 };
  }
  const script = path.join(storyDir, 'music.js');
  if (fs.existsSync(script)) return { kind: 'script', script };
  return null;
}

// Only what the music can depend on: the timing. Telops, props and the theme are left out on purpose.
export function musicKey(scriptText, timeline, version) {
  return sha(
    stable({
      script: scriptText,
      version,
      sampleRate: SAMPLE_RATE,
      timing: {
        duration: timeline.duration,
        bpm: timeline.bpm,
        beatsPerBar: timeline.beatsPerBar,
        beat: timeline.beat,
        bar: timeline.bar,
        peak: timeline.peak,
        marks: timeline.marks,
        scenes: timeline.scenes.map((s) => ({ index: s.index, role: s.role, start: s.start, end: s.end, startBar: s.startBar, bars: s.bars })),
      },
    }),
  );
}

// writeWav(file, pcm16, { sampleRate, channels }): pcm16 is interleaved 16-bit samples (an Int16Array or a Buffer of them).
export function writeWav(file, pcm16, { sampleRate = SAMPLE_RATE, channels = CHANNELS } = {}) {
  const data = Buffer.isBuffer(pcm16) ? pcm16 : Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

const barIndex = (t, bar) => Math.floor(t / bar + 1e-6);

// The three music warnings, worked out from the measured levels.
export function musicWarnings(info, timeline) {
  const warnings = [];
  const w = (code, message) => warnings.push({ code, scene: null, cut: null, message });
  if (info.clipped > 0) {
    w('music-clipping', `${info.clipped} samples were clipped; lower the master gain or add a compressor`);
  }
  const loudest = Math.max(0, ...info.levels);
  if (loudest < SILENT_RMS) w('music-silent', 'the music is silent: its loudest bar is below the audible level');
  if (timeline.peak !== null && info.levels.length > 0) {
    const pb = Math.min(barIndex(timeline.peak, timeline.bar), info.levels.length - 1);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (pb > 0) {
      const after = mean(info.levels.slice(pb, pb + 2));
      const before = mean(info.levels.slice(0, pb));
      if (after < before * PEAK_MARGIN) {
        w('music-peak-weak', `the two bars from the peak (bar ${pb}) are not ${PEAK_MARGIN} times as loud as the bars before it (${(after / Math.max(before, 1e-9)).toFixed(2)} times)`);
      }
    }
  }
  return warnings;
}

// Runs in the page. Replaces Math.random with a seeded generator and hands it to the script as helpers.random.
function seedPage(seed) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;
  window.__evRandom = random;
}

// Runs in the page. Renders the script and returns the samples as base64 chunks of 16-bit interleaved PCM.
async function renderInPage({ timeline, rate, channels, chunkSeconds }) {
  if (typeof window.compose !== 'function') return { missing: true };
  const frames = Math.ceil(timeline.duration * rate);
  const ctx = new OfflineAudioContext(channels, frames, rate);
  const helpers = { bar: (n) => n * timeline.bar, beat: (n) => n * timeline.beat, random: window.__evRandom };
  await window.compose(ctx, timeline, helpers);
  const buffer = await ctx.startRendering();
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  const barFrames = timeline.bar * rate;
  const barCount = Math.max(1, Math.ceil(timeline.duration / timeline.bar - 1e-9));
  const sums = new Array(barCount).fill(0);
  const counts = new Array(barCount).fill(0);
  let clipped = 0;
  const chunkFrames = Math.floor(chunkSeconds * rate);
  const chunks = [];
  for (let from = 0; from < frames; from += chunkFrames) {
    const to = Math.min(frames, from + chunkFrames);
    const pcm = new Int16Array((to - from) * channels);
    for (let i = from; i < to; i++) {
      const b = Math.min(barCount - 1, Math.floor(i / barFrames));
      for (let c = 0; c < channels; c++) {
        let v = data[c][i];
        if (!(v === v)) v = 0; // NaN
        if (v > 1 || v < -1) {
          clipped++;
          v = v > 1 ? 1 : -1;
        }
        sums[b] += v * v;
        counts[b]++;
        pcm[(i - from) * channels + c] = Math.round(v * (v < 0 ? 32768 : 32767));
      }
    }
    const bytes = new Uint8Array(pcm.buffer);
    let s = '';
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    chunks.push(btoa(s));
  }
  return { chunks, clipped, levels: sums.map((x, b) => (counts[b] > 0 ? Math.sqrt(x / counts[b]) : 0)) };
}

const scriptError = (message) => new CaptureError('music-script', null, `music.js: ${message}`, true);

// synthesize({ deps, timeline, storyDir, buildDir, version }) -> { key, duration, levels, loudestBar, clipped, cached, warnings }
export async function synthesize({ deps, timeline, storyDir, buildDir, version }) {
  const scriptFile = path.join(storyDir, 'music.js');
  const scriptText = fs.readFileSync(scriptFile, 'utf8');
  const key = musicKey(scriptText, timeline, version);
  const wav = path.join(buildDir, 'music.wav');
  const json = path.join(buildDir, 'music.json');
  if (fs.existsSync(wav) && fs.existsSync(json)) {
    try {
      const info = JSON.parse(fs.readFileSync(json, 'utf8'));
      if (info.key === key) return { ...info, cached: true, warnings: musicWarnings(info, timeline) };
    } catch {
      // a broken cache file is synthesized again
    }
  }

  const browser = await openBrowser(deps);
  try {
    const context = await browser.newContext();
    await context.addInitScript(clockGuard);
    const requests = [];
    await context.route(isBlockedUrl, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e.message ?? e)));
    await page.evaluate(seedPage, SEED);
    try {
      await page.addScriptTag({ content: scriptText });
    } catch (e) {
      throw scriptError(String(e.message ?? e).split('\n')[0]);
    }
    if (problems.length > 0) throw scriptError(problems[0].split('\n')[0]);
    let result;
    try {
      result = await page.evaluate(renderInPage, { timeline, rate: SAMPLE_RATE, channels: CHANNELS, chunkSeconds: CHUNK_SECONDS });
    } catch (e) {
      if (requests.length > 0) throw scriptError(`a request for ${requests[0]} was blocked; a music script may not use the network`);
      throw scriptError(String(e.message ?? e).split('\n')[0]);
    }
    const clock = await page.evaluate(() => window.__evViolations ?? []).catch(() => []);
    if (clock.length > 0) throw scriptError(`the script used the clock (${[...new Set(clock)].join(', ')}); a music script has to be the same every run`);
    if (result.missing) throw scriptError('it does not assign a function to window.compose');
    if (requests.length > 0) throw scriptError(`a request for ${requests[0]} was blocked; a music script may not use the network`);

    fs.mkdirSync(buildDir, { recursive: true });
    const tmp = `${wav}.part`;
    writeWav(tmp, Buffer.concat(result.chunks.map((c) => Buffer.from(c, 'base64'))));
    fs.renameSync(tmp, wav);
    const round = (x) => Math.round(x * 1e6) / 1e6;
    const levels = result.levels.map(round);
    const info = { key, duration: timeline.duration, levels, loudestBar: levels.indexOf(Math.max(...levels)), clipped: result.clipped };
    fs.writeFileSync(json, `${JSON.stringify(info, null, 2)}\n`);
    return { ...info, cached: false, warnings: musicWarnings(info, timeline) };
  } finally {
    await browser.close();
  }
}
