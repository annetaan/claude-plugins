// Content hashes for the cut cache. A cut's key depends only on what changes its pixels, never on where it sits.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const QUALITIES = {
  full: { name: 'full', scale: 1, fpsDivisor: 1, crf: 14 },
  preview: { name: 'preview', scale: 0.5, fpsDivisor: 2, crf: 20 },
};

const sha = (data) => createHash('sha256').update(data).digest('hex');

// Sorted-key JSON, so the same value always hashes the same.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// Package version plus a hash of everything under src/page/.
export function rendererVersion(rendererDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rendererDir, 'package.json'), 'utf8'));
  const pageDir = path.join(rendererDir, 'src', 'page');
  const h = createHash('sha256');
  if (fs.existsSync(pageDir)) {
    for (const f of fs.readdirSync(pageDir).sort()) {
      h.update(f);
      h.update(fs.readFileSync(path.join(pageDir, f)));
    }
  }
  return `${pkg.version}-${h.digest('hex').slice(0, 16)}`;
}

export function fileHash(absPath) {
  try {
    return sha(fs.readFileSync(absPath));
  } catch {
    return 'missing';
  }
}

// Left out on purpose: id, start, end, in, out and scene info.
export function cutKey(cut, { timeline, quality, storyDir, version }) {
  const refs = cut.refs.map((rel) => [rel, fileHash(path.resolve(storyDir, rel))]);
  return sha(
    stable({
      version,
      quality: quality.name,
      stage: {
        width: timeline.width,
        height: timeline.height,
        fps: timeline.fps,
        language: timeline.language,
        theme: timeline.theme,
        beat: timeline.beat,
        bar: timeline.bar,
      },
      cut: { part: cut.part, duration: cut.duration, tail: cut.tail, marks: cut.marks, telops: cut.telops, props: cut.props },
      refs,
    }),
  );
}
