// The build/ layout of one story directory. build/ is fully derived.
import fs from 'node:fs';
import path from 'node:path';

export function paths(storyDir, quality) {
  const buildDir = path.join(storyDir, 'build');
  return {
    buildDir,
    cutsDir: path.join(buildDir, 'cuts', quality),
    pagesDir: path.join(buildDir, 'pages'),
    videoFramesDir: path.join(buildDir, 'video-frames'),
    snapshotsDir: path.join(buildDir, 'snapshots'),
    preview: path.join(buildDir, 'preview.mp4'),
    out: path.join(storyDir, 'out.mp4'),
  };
}

export const cutFile = (cutsDir, key) => path.join(cutsDir, `${key.slice(0, 12)}.mp4`);

// Deletes every file in cutsDir that is not in keepFiles (absolute paths), empties pagesDir, and removes the
// directories of videoFramesDir that are not in keepFrameDirs. Call it only after a render in which every cut succeeded.
export function prune(cutsDir, keepFiles, pagesDir, videoFramesDir, keepFrameDirs = []) {
  const keep = new Set(keepFiles);
  if (fs.existsSync(cutsDir)) {
    for (const f of fs.readdirSync(cutsDir)) {
      const abs = path.join(cutsDir, f);
      if (!keep.has(abs)) fs.rmSync(abs, { recursive: true, force: true });
    }
  }
  if (pagesDir && fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir)) fs.rmSync(path.join(pagesDir, f), { recursive: true, force: true });
  }
  if (videoFramesDir && fs.existsSync(videoFramesDir)) {
    const keepDirs = new Set(keepFrameDirs);
    for (const f of fs.readdirSync(videoFramesDir)) {
      const abs = path.join(videoFramesDir, f);
      if (!keepDirs.has(abs)) fs.rmSync(abs, { recursive: true, force: true });
    }
  }
}

// Removes build/ whole; out.mp4, music.js and assets/ stay.
export function clean(storyDir) {
  fs.rmSync(path.join(storyDir, 'build'), { recursive: true, force: true });
}
