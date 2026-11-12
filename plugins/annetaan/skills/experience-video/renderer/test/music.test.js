import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { musicKey, musicSource, musicWarnings, writeWav, SAMPLE_RATE } from '../src/music.js';
import { FRONT, scene, timelineOf } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-music-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const story = (telop = 'hi', bars = 2) =>
  FRONT +
  scene(1, `role: peak\ncuts:\n  - part: card\n    bars: ${bars}\n    lines: [a]\n    telops:\n      - { text: ${telop}, at: 0, until: end }`);

test('wav: the header describes the samples', () => {
  const file = path.join(tmp, 'a.wav');
  const pcm = new Int16Array([0, 1000, -1000, 32767, -32768, 5]); // three stereo frames
  writeWav(file, pcm, { sampleRate: SAMPLE_RATE, channels: 2 });
  const b = fs.readFileSync(file);
  assert.equal(b.length, 44 + pcm.byteLength);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(4), 36 + pcm.byteLength);
  assert.equal(b.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(b.readUInt16LE(20), 1);
  assert.equal(b.readUInt16LE(22), 2);
  assert.equal(b.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(b.readUInt32LE(28), SAMPLE_RATE * 4);
  assert.equal(b.readUInt16LE(32), 4);
  assert.equal(b.readUInt16LE(34), 16);
  assert.equal(b.toString('ascii', 36, 40), 'data');
  assert.equal(b.readUInt32LE(40), pcm.byteLength);
  assert.equal(b.readInt16LE(44 + 6), 32767);
});

test('music: the key changes with the script and with the timing', () => {
  const t = timelineOf(story());
  const base = musicKey('window.compose = () => {}', t, 'v1');
  assert.notEqual(base, musicKey('window.compose = () => { }', t, 'v1'));
  assert.notEqual(base, musicKey('window.compose = () => {}', timelineOf(story('hi', 3)), 'v1'));
  assert.notEqual(base, musicKey('window.compose = () => {}', t, 'v2'));
  assert.equal(base, musicKey('window.compose = () => {}', timelineOf(story()), 'v1'));
});

test('music: the key does not change when a telop changes', () => {
  const script = 'window.compose = () => {}';
  assert.equal(musicKey(script, timelineOf(story('hi')), 'v1'), musicKey(script, timelineOf(story('another')), 'v1'));
});

test('music: the source is the file, else the script, else none', () => {
  const dir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const plain = timelineOf(story());
  assert.equal(musicSource(plain, dir), null);
  fs.writeFileSync(path.join(dir, 'music.js'), '');
  assert.deepEqual(musicSource(plain, dir), { kind: 'script', script: path.join(dir, 'music.js') });
  const withFile = { ...plain, music: { ...plain.music, file: 'assets/t.mp3', offset: 3 } };
  assert.deepEqual(musicSource(withFile, dir), { kind: 'file', file: path.join(dir, 'assets/t.mp3'), offset: 3 });
});

test('music: the three warnings', () => {
  const t = { ...timelineOf(story('hi', 4)), peak: 5 };
  const peakBar = Math.floor(5 / t.bar + 1e-6);
  const loud = Array.from({ length: 8 }, (_, i) => (i >= peakBar ? 0.3 : 0.1));
  const codes = (info) => musicWarnings(info, t).map((w) => w.code);
  assert.deepEqual(codes({ levels: loud, clipped: 0 }), []);
  assert.deepEqual(codes({ levels: loud, clipped: 3 }), ['music-clipping']);
  assert.ok(codes({ levels: loud.map(() => 0), clipped: 0 }).includes('music-silent'));
  assert.deepEqual(codes({ levels: loud.map((_, i) => (i >= peakBar ? 0.1 : 0.3)), clipped: 0 }), ['music-peak-weak']);
  // A flat track, and a peak barely above the intro, have no peak.
  assert.deepEqual(codes({ levels: loud.map(() => 0.2), clipped: 0 }), ['music-peak-weak']);
  assert.deepEqual(codes({ levels: loud.map((_, i) => (i >= peakBar ? 0.21 : 0.2)), clipped: 0 }), ['music-peak-weak']);
});
