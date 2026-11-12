// Command logic for render and snapshot. Each returns { code, body }: the exit code and the JSON for stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStory } from './story.js';
import { resolveTimeExpr, TimeError } from './time.js';
import { QUALITIES, cutKey, rendererVersion } from './hash.js';
import { paths, cutFile, prune } from './cache.js';
import { extractFrames, framesPath } from './video-frames.js';
import { buildPage, openBrowser, captureCut, snapshotCut, CaptureError } from './capture.js';
import { assemble } from './assemble.js';
import { musicSource, synthesize } from './music.js';
import { narrationClips, audioPlan } from './audio.js';

const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PAGES = 4;

const fail = (code, errors, warnings = []) => ({ code, body: { ok: false, errors, warnings } });
const envFinding = (code, cut, message) => ({ code, scene: null, cut, message });

// Loads and validates the story; the same error shape for every command that needs one.
export function load(storyFile, deps, say) {
  const r = loadStory(path.resolve(storyFile), deps, { say });
  if (r.errors.length > 0) return { failure: fail(1, r.errors, r.warnings) };
  return { timeline: r.timeline, warnings: r.warnings };
}

async function runPool(items, limit, worker) {
  const queue = [...items];
  let failure = null;
  const lane = async () => {
    while (queue.length > 0 && !failure) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (e) {
        failure ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure) throw failure;
}

// A video cut whose file exists draws from extracted frames: at the capture's frame rate and the output's width.
const videoArgs = (cut, { timeline, quality, storyDir, p }) => {
  const file = typeof cut.props.src === 'string' ? path.resolve(storyDir, cut.props.src) : null;
  if (cut.part !== 'video' || !file || !fs.existsSync(file)) return null;
  return {
    file,
    start: cut.props.start ?? 0,
    seconds: cut.duration + cut.tail,
    fps: timeline.fps / quality.fpsDivisor,
    maxWidth: timeline.width * quality.scale,
    framesDir: p.videoFramesDir,
    cutId: cut.id,
  };
};

const assetsOf = (cut, ctx) => {
  const args = videoArgs(cut, ctx);
  if (!args) return {};
  const { dir, count } = extractFrames(args);
  return { video: { dir, count, fps: args.fps } };
};

const toFinding = (e) => (e instanceof CaptureError ? envFinding(e.code, e.cutId, e.message) : envFinding('render', null, String(e.message ?? e)));
// A finding about the story's own files is a story error (1); anything else is the environment (2).
const failOn = (e, warnings) => fail(e instanceof CaptureError && e.story ? 1 : 2, [toFinding(e)], warnings);

export async function render({ storyFile, deps, preview = false, force = false, say = true }) {
  const loaded = load(storyFile, deps, say);
  if (loaded.failure) return loaded.failure;
  const { timeline } = loaded;
  const warnings = [...loaded.warnings];
  const storyDir = path.dirname(path.resolve(storyFile));
  const quality = preview ? QUALITIES.preview : QUALITIES.full;
  const p = paths(storyDir, quality.name);
  const version = rendererVersion(RENDERER_DIR);
  const cuts = timeline.scenes.flatMap((s) => s.cuts);
  const keyOf = new Map(cuts.map((c) => [c.id, cutKey(c, { timeline, quality, storyDir, version })]));

  const ctx = { timeline, quality, storyDir, p };
  const rendered = [];
  const cached = [];
  const todo = new Map(); // key -> first cut with that key
  const doneKeys = new Set();
  for (const c of cuts) {
    const key = keyOf.get(c.id);
    const exists = fs.existsSync(cutFile(p.cutsDir, key));
    if (exists && !force) cached.push(c.id);
    else if (!doneKeys.has(key)) {
      doneKeys.add(key);
      todo.set(key, c);
      rendered.push(c.id);
    } else cached.push(c.id); // the same key renders once; the file is shared
  }

  // Sound first, so a broken music script fails before any cut is captured.
  const source = musicSource(timeline, storyDir);
  let musicBody = { source: source ? source.kind : 'none', cached: source?.kind === 'file' };
  let clips = [];
  try {
    if (source?.kind === 'script') {
      const info = await synthesize({ deps, timeline, storyDir, buildDir: p.buildDir, version });
      warnings.push(...info.warnings);
      musicBody = { source: 'script', cached: info.cached };
    }
    const narration = narrationClips({ timeline, buildDir: p.buildDir, say });
    clips = narration.clips;
    warnings.push(...narration.warnings);
    if (!source) warnings.push({ code: 'no-music', scene: null, cut: null, message: 'the story has no music: add music.js beside story.md or music.file to the frontmatter' });
  } catch (e) {
    return failOn(e, warnings);
  }

  try {
    if (todo.size > 0) {
      const browser = await openBrowser(deps);
      try {
        await runPool([...todo], MAX_PAGES, async ([key, cut]) => {
          const url = buildPage(cut, timeline, p.pagesDir, key, storyDir, assetsOf(cut, ctx));
          await captureCut({ browser, cut, timeline, quality, url, outFile: cutFile(p.cutsDir, key) });
        });
      } finally {
        await browser.close();
      }
    }
    const outFile = preview ? p.preview : p.out;
    const audio = audioPlan({
      timeline,
      music: source ? { ...source, file: source.kind === 'script' ? p.musicWav : source.file } : null,
      clips,
      firstInput: cuts.length,
    });
    await assemble({ timeline, files: cuts.map((c) => cutFile(p.cutsDir, keyOf.get(c.id))), quality, outFile, audio });
    const frameDirs = cuts.map((c) => videoArgs(c, ctx)).filter(Boolean).map(framesPath);
    prune(p.cutsDir, cuts.map((c) => cutFile(p.cutsDir, keyOf.get(c.id))), p.pagesDir, p.videoFramesDir, frameDirs);
    return { code: 0, body: { ok: true, out: outFile, duration: timeline.duration, rendered, cached, music: musicBody, errors: [], warnings } };
  } catch (e) {
    return failOn(e, warnings);
  }
}

export async function snapshot({ storyFile, deps, at, out, preview = false, say = true }) {
  const loaded = load(storyFile, deps, say);
  if (loaded.failure) return loaded.failure;
  const { timeline, warnings } = loaded;
  const storyDir = path.dirname(path.resolve(storyFile));
  let t;
  try {
    t = resolveTimeExpr(at, { beat: timeline.beat, bar: timeline.bar, marks: timeline.marks, duration: timeline.duration });
  } catch (e) {
    if (!(e instanceof TimeError)) throw e;
    return fail(1, [{ code: e.code, scene: null, cut: null, message: e.message }], warnings);
  }
  if (!(t >= 0 && t <= timeline.duration)) {
    return fail(1, [{ code: 'at-outside', scene: null, cut: null, message: `--at ${at} is ${t}s, outside the video (0 to ${timeline.duration}s)` }], warnings);
  }
  const cuts = timeline.scenes.flatMap((s) => s.cuts);
  const cut = cuts.find((c) => c.start <= t && t < c.end) ?? cuts[cuts.length - 1];
  const quality = preview ? QUALITIES.preview : QUALITIES.full;
  const p = paths(storyDir, quality.name);
  const key = cutKey(cut, { timeline, quality, storyDir, version: rendererVersion(RENDERER_DIR) });
  const file = out ? path.resolve(out) : path.join(p.snapshotsDir, `${cut.id}-${Math.round(t * 1000)}.png`);
  try {
    const browser = await openBrowser(deps);
    try {
      const url = buildPage(cut, timeline, p.pagesDir, key, storyDir, assetsOf(cut, { timeline, quality, storyDir, p }));
      await snapshotCut({ browser, cut, timeline, scale: quality.scale, url, t: Math.min(Math.max(0, t - cut.start), cut.duration), outFile: file });
    } finally {
      await browser.close();
    }
  } catch (e) {
    return failOn(e, warnings);
  }
  return { code: 0, body: { ok: true, file, cut: cut.id, t: Math.round(t * 1e6) / 1e6 } };
}

// The music command: synthesizes the script and reports what a model cannot hear, the loudness of every bar.
export async function music({ storyFile, deps, say = true }) {
  const loaded = load(storyFile, deps, say);
  if (loaded.failure) return loaded.failure;
  const { timeline } = loaded;
  const storyDir = path.dirname(path.resolve(storyFile));
  const p = paths(storyDir, QUALITIES.full.name);
  const source = musicSource(timeline, storyDir);
  if (!source) {
    return fail(1, [{ code: 'no-music-script', scene: null, cut: null, message: 'there is no music.js beside story.md and no music.file in the frontmatter' }]);
  }
  if (source.kind === 'file') return { code: 0, body: { ok: true, source: 'file', file: source.file, cached: true, warnings: [] } };
  try {
    const info = await synthesize({ deps, timeline, storyDir, buildDir: p.buildDir, version: rendererVersion(RENDERER_DIR) });
    const peakBar = timeline.peak === null ? null : Math.min(Math.floor(timeline.peak / timeline.bar + 1e-6), info.levels.length - 1);
    return {
      code: 0,
      body: { ok: true, source: 'script', file: p.musicWav, cached: info.cached, levels: info.levels, loudestBar: info.loudestBar, peakBar, warnings: info.warnings },
    };
  } catch (e) {
    return failOn(e, []);
  }
}
