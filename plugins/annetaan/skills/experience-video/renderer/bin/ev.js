#!/usr/bin/env node
// experience-video renderer CLI.
//   node ev.js <command> <path/to/story.md> [--deps <dir>] [flags]
// One JSON object on stdout, logs on stderr. Exit 0 ok, 1 story error, 2 environment error.
// This file and setup use node builtins only, so setup runs before any dependency exists.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE_MAJOR = 20;
const COMMANDS = ['setup', 'check', 'music', 'render', 'snapshot', 'frames', 'clean'];

function out(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
}

const envError = (code, message) => out({ ok: false, errors: [{ code, scene: null, cut: null, message }] }, 2);

function has(cmd, args = ['-version']) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return r.status === 0;
}

function sameFile(a, b) {
  try {
    return fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  } catch {
    return false;
  }
}

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, stdio: ['ignore', process.stderr, process.stderr] }).status === 0;
}

function setup(depsDir) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) envError('node-version', `node ${MIN_NODE_MAJOR} or newer is needed; this is ${process.versions.node}`);
  const ffmpeg = has('ffmpeg');
  const ffprobe = has('ffprobe');
  if (!ffmpeg || !ffprobe) envError('no-ffmpeg', 'ffmpeg and ffprobe have to be on the PATH (macOS: brew install ffmpeg)');

  if (depsDir !== RENDERER_DIR) {
    fs.mkdirSync(depsDir, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(RENDERER_DIR, f), path.join(depsDir, f));
  }
  // The stamp is written only after npm ci succeeds, so a failed or interrupted install is retried.
  const stamp = path.join(depsDir, 'node_modules', '.ev-lock.json');
  let installed = false;
  if (!sameFile(path.join(RENDERER_DIR, 'package-lock.json'), stamp)) {
    if (!run('npm', ['ci'], depsDir)) envError('npm-ci', 'npm ci failed');
    fs.copyFileSync(path.join(RENDERER_DIR, 'package-lock.json'), stamp);
    installed = true;
  }
  if (!run('npx', ['playwright', 'install', 'chromium', '--only-shell'], depsDir)) {
    envError('chromium', 'could not install the Chromium headless shell');
  }
  out({ ok: true, installed, deps: depsDir, ffmpeg: true, chromium: true }, 0);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      deps: { type: 'string' },
      preview: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      at: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const [command, storyArg] = positionals;
  if (!COMMANDS.includes(command)) envError('usage', `usage: ev.js <${COMMANDS.join('|')}> [story.md] [--deps <dir>]`);
  const depsDir = path.resolve(values.deps ?? RENDERER_DIR);

  if (command === 'setup') return setup(depsDir);

  if (!fs.existsSync(path.join(depsDir, 'node_modules'))) {
    envError('no-deps', `dependencies are not installed in ${depsDir}; run setup first`);
  }
  if (!storyArg) envError('usage', `${command} needs the path of a story.md`);

  const say = has('say', ['-v', '?']);
  const deps = (await import('../src/deps.js')).loadDeps(depsDir);
  const storyFile = path.resolve(storyArg);

  if (command === 'check') {
    const { loadStory } = await import('../src/story.js');
    const r = loadStory(storyFile, deps, { say });
    const t = r.timeline;
    const ok = r.errors.length === 0;
    out(
      {
        ok,
        errors: r.errors,
        warnings: r.warnings,
        duration: t ? t.duration : null,
        peak: t ? t.peak : null,
        scenes: t ? t.scenes.map((s) => ({ index: s.index, name: s.name, role: s.role, start: s.start, end: s.end, bars: s.bars, cuts: s.cuts.length })) : [],
      },
      ok ? 0 : 1,
    );
  }
  if (command === 'render') {
    const { render } = await import('../src/render.js');
    const r = await render({ storyFile, deps, preview: values.preview, force: values.force, say });
    out(r.body, r.code);
  }
  if (command === 'music') {
    const { music } = await import('../src/render.js');
    const r = await music({ storyFile, deps, say });
    out(r.body, r.code);
  }
  if (command === 'snapshot') {
    if (!values.at) envError('usage', 'snapshot needs --at <time expression>');
    const { snapshot } = await import('../src/render.js');
    const r = await snapshot({ storyFile, deps, at: values.at, out: values.out, preview: values.preview, say });
    out(r.body, r.code);
  }
  if (command === 'clean') {
    const { clean } = await import('../src/cache.js');
    clean(path.dirname(storyFile));
    out({ ok: true }, 0);
  }
  envError('not-implemented', `${command} is not implemented yet`);
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  envError('internal', String(e.message ?? e));
});
