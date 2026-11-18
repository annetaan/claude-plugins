import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');

export class CaptureError extends Error {
  constructor(code, cutId, message, story = false) {
    super(message);
    this.code = code;
    this.cutId = cutId;
    this.story = story;
  }
}

const read = (f) => fs.readFileSync(path.join(PAGE_DIR, f), 'utf8');

function fragmentOf(cut, storyDir) {
  if (typeof cut.props.html === 'string') return cut.props.html;
  if (typeof cut.props.src === 'string') return fs.readFileSync(path.resolve(storyDir, cut.props.src), 'utf8');
  return '';
}

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
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const slots = {
    LANG: () => String(timeline.language).replace(/[^A-Za-z0-9-]/g, ''),
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

export const isBlockedUrl = (u) => !['file:', 'data:', 'blob:', 'about:'].includes(u.protocol);

export const frameCount = (cut, captureFps) => Math.ceil((cut.duration + cut.tail) * captureFps - 1e-9) + 1;

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

async function verify({ cut, page, problems, requests }, err) {
  let names = [];
  try {
    names = await page.evaluate(() => window.__evViolations ?? []);
  } catch {
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

async function seekTo(guard, t) {
  try {
    await guard.page.evaluate((x) => window.__ev.seek(x), t);
  } catch (e) {
    await verify(guard, e);
    throw e;
  }
}

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
  ff.stdin.on('error', () => {});
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

export async function shootCut({ browser, cut, timeline, scale, url, shots, measure, arg }) {
  const { context, page, guard } = await openPage(browser, cut, timeline, scale, url);
  const tmps = shots.map((s) => `${s.outFile}.part.png`);
  try {
    const measured = [];
    for (const [i, s] of shots.entries()) {
      fs.mkdirSync(path.dirname(s.outFile), { recursive: true });
      await seekTo(guard, s.t);
      await page.screenshot({ type: 'png', path: tmps[i] });
      measured.push(await page.evaluate(measure, arg));
    }
    await verify(guard);
    shots.forEach((s, i) => fs.renameSync(tmps[i], s.outFile));
    return measured;
  } catch (e) {
    for (const f of tmps) fs.rmSync(f, { force: true });
    throw e;
  } finally {
    await context.close();
  }
}

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
