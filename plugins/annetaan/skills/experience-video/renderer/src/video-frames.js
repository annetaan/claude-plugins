// Extracts the frames of a video cut as numbered JPEGs, so the page never needs a <video> element.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileHash } from './hash.js';
import { CaptureError } from './capture.js';

const countFrames = (dir) => fs.readdirSync(dir).filter((f) => /^\d{5}\.jpg$/.test(f)).length;

// The directory the frames of these arguments live in: build/video-frames/<hash12>.
export function framesPath({ file, start, seconds, fps, maxWidth, framesDir }) {
  const key = createHash('sha256')
    .update(JSON.stringify([fileHash(file), start, seconds, fps, maxWidth]))
    .digest('hex')
    .slice(0, 12);
  return path.join(framesDir, key);
}

// extractFrames({ file, start, seconds, fps, maxWidth, framesDir, cutId }) -> { dir, count }
// Frames are <dir>/00001.jpg and on. An existing directory is reused as it is.
export function extractFrames({ file, start, seconds, fps, maxWidth, framesDir, cutId }) {
  const dir = framesPath({ file, start, seconds, fps, maxWidth, framesDir });
  if (fs.existsSync(dir)) return { dir, count: countFrames(dir) };

  fs.mkdirSync(framesDir, { recursive: true });
  const tmp = `${dir}.part`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-ss', String(start), '-i', file, '-t', String(seconds), '-vf', `fps=${fps},scale='min(${Math.round(maxWidth)},iw)':-2`, '-q:v', '3', path.join(tmp, '%05d.jpg')],
    { encoding: 'utf8' },
  );
  const count = r.status === 0 ? countFrames(tmp) : 0;
  if (r.status !== 0 || count === 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const why = r.status !== 0 ? String(r.stderr ?? '').trim().split('\n').pop() : `no frames at ${start}s`;
    const e = new CaptureError('bad-video', cutId, `cut ${cutId}: cannot read frames from ${path.basename(file)}: ${why}`);
    e.story = true;
    throw e;
  }
  fs.renameSync(tmp, dir);
  return { dir, count };
}
