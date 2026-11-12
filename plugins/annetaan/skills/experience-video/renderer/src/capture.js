// Draws one cut in a headless browser, frame by frame, and pipes the frames into ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');

export class CaptureError extends Error {
  constructor(code, cutId, message) {
    super(message);
    this.code = code;
    this.cutId = cutId;
  }
}

const read = (f) => fs.readFileSync(path.join(PAGE_DIR, f), 'utf8');

// Fills stage.html for one cut, writes build/pages/<hash12>.html and returns its file URL.
export function buildPage(cut, timeline, pagesDir, key) {
  const payload = {
    cut: { part: cut.part, duration: cut.duration, tail: cut.tail, marks: cut.marks, telops: cut.telops, props: cut.props },
    width: timeline.width,
    height: timeline.height,
    theme: timeline.theme ?? {},
    language: timeline.language,
    beat: timeline.beat,
    bar: timeline.bar,
  };
  // "<" is escaped so no text can close the script element.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const html = read('stage.html')
    .replace('{{LANG}}', () => String(timeline.language).replace(/[^A-Za-z0-9-]/g, ''))
    .replace('{{CSS}}', () => read('stage.css'))
    .replace('{{CUT_JSON}}', () => json)
    .replace('{{RUNTIME}}', () => read('runtime.js'));
  fs.mkdirSync(pagesDir, { recursive: true });
  const file = path.join(pagesDir, `${key.slice(0, 12)}.html`);
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

export function openBrowser(deps) {
  return deps.playwright.chromium.launch();
}

export const frameCount = (cut, captureFps) => Math.ceil((cut.duration + cut.tail) * captureFps - 1e-9) + 1;

async function openPage(browser, cut, timeline, scale, url) {
  const context = await browser.newContext({ viewport: { width: timeline.width, height: timeline.height }, deviceScaleFactor: scale });
  try {
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e.message ?? e)));
    await page.goto(url);
    await page.evaluate(() => window.__ev.ready);
    if (problems.length > 0) throw new CaptureError('page-error', cut.id, `cut ${cut.id}: ${problems[0]}`);
    return { context, page };
  } catch (e) {
    await context.close();
    throw e;
  }
}

// captureCut -> writes outFile (an mp4 of duration + tail at captureFps).
export async function captureCut({ browser, cut, timeline, quality, url, outFile }) {
  const captureFps = timeline.fps / quality.fpsDivisor;
  const frames = frameCount(cut, captureFps);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part.mp4`;
  const { context, page } = await openPage(browser, cut, timeline, quality.scale, url);
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
      await page.evaluate((t) => window.__ev.seek(t), k / captureFps);
      const png = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(png)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
      if (ff.exitCode !== null) break;
    }
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
  const { context, page } = await openPage(browser, cut, timeline, scale, url);
  try {
    await page.evaluate((x) => window.__ev.seek(x), t);
    await page.screenshot({ type: 'png', path: outFile });
  } finally {
    await context.close();
  }
}
