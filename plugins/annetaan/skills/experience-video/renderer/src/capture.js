// Draws one cut in a headless browser, frame by frame, and pipes the frames into ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');

// story: true marks a finding about the story's own files (a fragment, a picture, a clip): exit 1, not 2.
export class CaptureError extends Error {
  constructor(code, cutId, message, story = false) {
    super(message);
    this.code = code;
    this.cutId = cutId;
    this.story = story;
  }
}

const read = (f) => fs.readFileSync(path.join(PAGE_DIR, f), 'utf8');

// The fragment of a custom or screen cut: its html, or the content of its src.
function fragmentOf(cut, storyDir) {
  if (typeof cut.props.html === 'string') return cut.props.html;
  if (typeof cut.props.src === 'string') return fs.readFileSync(path.resolve(storyDir, cut.props.src), 'utf8');
  return '';
}

// What the page needs from outside: the image's file URL, or the extracted frames of a video.
// assets: { video: { dir, count, fps } | null }
function assetOf(cut, storyDir, assets) {
  if (cut.part === 'image' && typeof cut.props.src === 'string') {
    const file = path.resolve(storyDir, cut.props.src);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? { url: pathToFileURL(file).href } : null;
  }
  if (cut.part === 'video' && assets?.video) {
    return { dir: pathToFileURL(assets.video.dir).href, count: assets.video.count, fps: assets.video.fps };
  }
  return null;
}

function stageOf(cut, storyDir) {
  if (cut.part === 'custom') return `<div class="part custom" id="fragment">${fragmentOf(cut, storyDir)}</div>`;
  if (cut.part === 'screen') {
    const device = cut.props.device === 'laptop' ? 'laptop' : 'phone';
    return `<div class="part screen"><div class="device device-${device}"><div class="screen-content" id="fragment">${fragmentOf(cut, storyDir)}</div></div></div>`;
  }
  return '';
}

// Fills stage.html for one cut, writes build/pages/<hash12>.html and returns its file URL.
export function buildPage(cut, timeline, pagesDir, key, storyDir, assets = {}) {
  const payload = {
    cut: { part: cut.part, duration: cut.duration, tail: cut.tail, marks: cut.marks, telops: cut.telops, props: cut.props },
    width: timeline.width,
    height: timeline.height,
    theme: timeline.theme ?? {},
    language: timeline.language,
    beat: timeline.beat,
    bar: timeline.bar,
    asset: assetOf(cut, storyDir, assets),
  };
  // "<" is escaped so no text can close the script element.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  // One pass over the template, so text inserted for one slot (a fragment) is never read as another slot.
  const slots = {
    LANG: () => String(timeline.language).replace(/[^A-Za-z0-9-]/g, ''),
    // Relative paths in a fragment resolve against the story's directory, not build/pages/.
    BASE: () => pathToFileURL(path.resolve(storyDir) + path.sep).href.replace(/"/g, '%22'),
    CSS: () => read('stage.css'),
    CUT_JSON: () => json,
    PRELUDE: () => read('prelude.js'),
    STAGE: () => stageOf(cut, storyDir),
    RUNTIME: () => read('runtime.js'),
  };
  const html = read('stage.html').replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => (slots[name] ? slots[name]() : m));
  fs.mkdirSync(pagesDir, { recursive: true });
  const file = path.join(pagesDir, `${key.slice(0, 12)}.html`);
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

export function openBrowser(deps) {
  return deps.playwright.chromium.launch();
}

// A page may load only local files, data, blob and about URLs. Takes a URL object.
export const isBlockedUrl = (u) => !['file:', 'data:', 'blob:', 'about:'].includes(u.protocol);

export const frameCount = (cut, captureFps) => Math.ceil((cut.duration + cut.tail) * captureFps - 1e-9) + 1;

// Runs in the page before any page script. Replaces every clock a fragment could animate with: each call is
// recorded in window.__evViolations and does nothing.
export function clockGuard() {
  const violations = (window.__evViolations = []);
  const note = (name) => violations.push(name);
  window.setTimeout = () => (note('setTimeout'), 0);
  window.setInterval = () => (note('setInterval'), 0);
  window.requestAnimationFrame = () => (note('requestAnimationFrame'), 0);
  Date.now = () => (note('Date.now'), 0);
  Object.defineProperty(performance, 'now', { value: () => (note('performance.now'), 0), configurable: true });
  const RealDate = Date;
  window.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) {
        note('new Date()');
        return new target(0);
      }
      return Reflect.construct(target, args, newTarget);
    },
  });
}

const isFragmentCut = (cut) => cut.part === 'custom' || cut.part === 'screen';

// Throws the finding that explains what went wrong, if any: a fragment that broke a rule, a picture that would not
// decode, a page error. `err` is an error already caught (a rejected ready or seek); with none, only the rules and
// the page errors are looked at.
async function verify({ cut, page, problems, requests }, err) {
  let names = [];
  try {
    names = await page.evaluate(() => window.__evViolations ?? []);
  } catch {
    // the page is gone; go on with what is known
  }
  if (names.length > 0) {
    throw new CaptureError('fragment-clock', cut.id, `cut ${cut.id}: the fragment used the clock (${[...new Set(names)].join(', ')}); animate with CSS animations or window.renderAt(t)`, true);
  }
  if (requests.length > 0) {
    throw new CaptureError('fragment-network', cut.id, `cut ${cut.id}: a request for ${requests[0]} was blocked; only local files and data: URLs are allowed`, true);
  }
  const message = err ? String(err.message ?? err) : problems[0];
  if (message === undefined) return;
  if (message.includes('ev-bad-image')) {
    const what = message.split('ev-bad-image: ')[1]?.split('\n')[0] ?? message;
    throw new CaptureError('bad-image', cut.id, `cut ${cut.id}: the image cannot be decoded: ${what}`, true);
  }
  if (isFragmentCut(cut)) throw new CaptureError('fragment-error', cut.id, `cut ${cut.id}: ${message.split('\n')[0]}`, true);
  if (problems.length > 0) throw new CaptureError('page-error', cut.id, `cut ${cut.id}: ${problems[0]}`);
  if (err) throw err;
}

async function openPage(browser, cut, timeline, scale, url) {
  const context = await browser.newContext({ viewport: { width: timeline.width, height: timeline.height }, deviceScaleFactor: scale });
  try {
    await context.addInitScript(clockGuard);
    const requests = [];
    // Everything that is not a file, data, blob or about request is recorded and refused. File requests are not routed.
    await context.route(
      isBlockedUrl,
      (route) => {
        requests.push(route.request().url());
        return route.abort();
      },
    );
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e.message ?? e)));
    const guard = { cut, page, problems, requests };
    try {
      await page.goto(url);
      await page.evaluate(() => window.__ev.ready);
    } catch (e) {
      await verify(guard, e);
      throw e;
    }
    await verify(guard);
    return { context, page, guard };
  } catch (e) {
    await context.close();
    throw e;
  }
}

// One seek; whatever it throws is explained by verify.
async function seekTo(guard, t) {
  try {
    await guard.page.evaluate((x) => window.__ev.seek(x), t);
  } catch (e) {
    await verify(guard, e);
    throw e;
  }
}

// captureCut -> writes outFile (an mp4 of duration + tail at captureFps).
export async function captureCut({ browser, cut, timeline, quality, url, outFile }) {
  const captureFps = timeline.fps / quality.fpsDivisor;
  const frames = frameCount(cut, captureFps);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part.mp4`;
  const { context, page, guard } = await openPage(browser, cut, timeline, quality.scale, url);
  const ff = spawn(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(captureFps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(quality.crf), '-pix_fmt', 'yuv420p', '-r', String(captureFps), '-an', tmp],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => ff.on('close', resolve));
  ff.stdin.on('error', () => {}); // a dead ffmpeg is reported through its exit code
  try {
    for (let k = 0; k < frames; k++) {
      await seekTo(guard, k / captureFps);
      const png = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(png)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
      if (ff.exitCode !== null) break;
    }
    await verify(guard);
    ff.stdin.end();
    const code = await exited;
    if (code !== 0) throw new CaptureError('ffmpeg', cut.id, `cut ${cut.id}: ffmpeg failed: ${stderr.trim().split('\n').pop()}`);
    fs.renameSync(tmp, outFile);
  } catch (e) {
    ff.kill('SIGKILL');
    fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    await context.close();
  }
}

// snapshotCut -> writes one PNG of the cut at cut-relative time t.
export async function snapshotCut({ browser, cut, timeline, scale, url, t, outFile }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { context, page, guard } = await openPage(browser, cut, timeline, scale, url);
  const tmp = `${outFile}.part.png`;
  try {
    await seekTo(guard, t);
    await page.screenshot({ type: 'png', path: tmp });
    await verify(guard);
    fs.renameSync(tmp, outFile);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    await context.close();
  }
}
