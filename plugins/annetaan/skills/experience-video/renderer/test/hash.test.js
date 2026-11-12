import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutKey, QUALITIES, rendererVersion } from '../src/hash.js';
import { FRONT, scene, timelineOf } from './helpers.js';

const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = rendererVersion(RENDERER_DIR);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-hash-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const keys = (text, quality = QUALITIES.full) => {
  const t = timelineOf(text);
  return t.scenes.flatMap((s) => s.cuts).map((c) => cutKey(c, { timeline: t, quality, storyDir: tmp, version }));
};

// A story of card cuts: one entry per cut { id?, bars?, text?, in?, out?, telop? }.
const story = (cuts) =>
  FRONT +
  scene(
    1,
    'cuts:\n' +
      cuts
        .map((c) =>
          [
            '  - part: card',
            c.id ? `    id: ${c.id}` : null,
            `    bars: ${c.bars ?? 1}`,
            `    lines: [${c.text ?? 'x'}]`,
            c.in ? `    in: ${c.in}` : null,
            c.out ? `    out: ${c.out}` : null,
            c.telop ? `    telops:\n      - { text: ${c.telop}, at: 0, until: end }` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n'),
  );

const base = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];

test('hash: editing one cut changes only that cut\'s key', () => {
  const before = keys(story(base));
  const after = keys(story([base[0], { ...base[1], telop: 'hi' }, base[2]]));
  assert.equal(before[0], after[0]);
  assert.notEqual(before[1], after[1]);
  assert.equal(before[2], after[2]);
});

test('hash: lengthening an early cut changes no later cut\'s key', () => {
  const before = keys(story(base));
  const after = keys(story([{ ...base[0], bars: 3 }, base[1], base[2]]));
  assert.notEqual(before[0], after[0]);
  assert.equal(before[1], after[1]);
  assert.equal(before[2], after[2]);
});

test('hash: inserting a cut changes no existing cut\'s key', () => {
  const before = keys(story(base));
  const after = keys(story([base[0], { id: 'new', text: 'N' }, base[1], base[2]]));
  assert.deepEqual([after[0], after[2], after[3]], before);
});

test('hash: a written id or a renamed id does not change the key', () => {
  const defaulted = keys(story([{ text: 'A' }]));
  const renamed = keys(story([{ id: 'renamed', text: 'A' }]));
  const again = keys(story([{ id: 'other', text: 'A' }]));
  assert.equal(defaulted[0], renamed[0]);
  assert.equal(renamed[0], again[0]);
});

test('hash: changing a fade changes no key, and a crossfade\'s duration changes only the previous cut\'s key', () => {
  const plain = keys(story([base[0], { ...base[1], in: 'fade' }, base[2]]));
  const longer = keys(story([base[0], { ...base[1], in: '{ type: fade, duration: 1 }', out: 'fade' }, base[2]]));
  assert.deepEqual(plain, longer);
  const x1 = keys(story([base[0], { ...base[1], in: 'crossfade' }, base[2]]));
  const x2 = keys(story([base[0], { ...base[1], in: '{ type: crossfade, duration: 1 }' }, base[2]]));
  assert.notEqual(x1[0], x2[0]);
  assert.equal(x1[1], x2[1]);
  assert.equal(x1[2], x2[2]);
});

test('hash: a dropped-in file changes the key of the cut that names it', () => {
  const text = FRONT + scene(1, 'cuts:\n  - { id: pic, part: image, bars: 1, src: assets/pic.png, prompt: p }\n  - { id: other, part: card, bars: 1, lines: [x] }');
  const missing = keys(text);
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'assets', 'pic.png'), 'one');
  const one = keys(text);
  fs.writeFileSync(path.join(tmp, 'assets', 'pic.png'), 'two');
  const two = keys(text);
  assert.notEqual(missing[0], one[0]);
  assert.notEqual(one[0], two[0]);
  assert.equal(missing[1], one[1]);
  assert.equal(one[1], two[1]);
});

test('hash: preview and full keys differ', () => {
  assert.notEqual(keys(story(base))[0], keys(story(base), QUALITIES.preview)[0]);
});
