import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryError } from '../src/story.js';
import { FRONT, scene, card, parse, timelineOf } from './helpers.js';

const codes = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof StoryError) return e.findings.map((x) => x.code);
    throw e;
  }
  return [];
};

test('story: yaml blocks are taken in document order', () => {
  const text = FRONT + scene(1, 'role: pain\n' + card(), 'First') + scene(2, 'role: headline\n' + card(), 'Second');
  const p = parse(text);
  assert.deepEqual(p.scenes.map((s) => [s.index, s.name, s.data.role]), [[1, 'First', 'pain'], [2, 'Second', 'headline']]);
});

test('story: a scene with no yaml block is an error', () => {
  const text = FRONT + '\n## Scene 1 — Bare\n\nJust prose.\n';
  assert.deepEqual(codes(() => parse(text)), ['scene-yaml']);
});

test('story: a scene with two yaml blocks is an error', () => {
  const text = FRONT + scene(1, card()) + '\n```yaml\nx: 1\n```\n';
  assert.deepEqual(codes(() => parse(text)), ['scene-yaml']);
});

test('story: a heading number that does not match the position is an error', () => {
  const text = FRONT + scene(1, card()) + scene(3, card());
  assert.ok(codes(() => parse(text)).includes('scene-number'));
});

test('story: the heading separator may be a dash or a colon', () => {
  const text = FRONT + '\n## Scene 1 - A\n\n```yaml\n' + card() + '```\n\n## Scene 2: B\n\n```yaml\n' + card() + '```\n';
  assert.deepEqual(parse(text).scenes.map((s) => s.name), ['A', 'B']);
});

test('story: a cut needs exactly one of bars and duration', () => {
  const both = scene(1, 'cuts:\n  - { part: card, bars: 1, duration: 2, lines: [a] }');
  const neither = scene(1, 'cuts:\n  - { part: card, lines: [a] }');
  assert.deepEqual(codes(() => parse(FRONT + both)), ['bars-or-duration']);
  assert.deepEqual(codes(() => parse(FRONT + neither)), ['bars-or-duration']);
});

test('story: unknown fields and parts are errors', () => {
  assert.deepEqual(codes(() => parse(FRONT + scene(1, 'cuts:\n  - { part: card, bars: 1, lines: [a], zoom: in }'))), ['unknown-field']);
  assert.deepEqual(codes(() => parse(FRONT + scene(1, 'cuts:\n  - { part: gif, bars: 1 }'))), ['unknown-part']);
});

test('story: a written cut id is a mark and a defaulted one is not', () => {
  const text = FRONT + scene(1, 'cuts:\n  - { part: card, bars: 1, lines: [a] }\n  - { id: second, part: card, bars: 1, lines: [b] }');
  const t = timelineOf(text);
  assert.deepEqual(Object.keys(t.marks), ['second']);
  assert.equal(t.marks.second, 2);
  assert.equal(t.scenes[0].cuts[0].id, 's1c1');
});

test('story: duplicate cut ids and marks are errors', () => {
  const dupId = scene(1, 'cuts:\n  - { id: a, part: card, bars: 1, lines: [x] }\n  - { id: a, part: card, bars: 1, lines: [y] }');
  const dupMark = scene(1, 'cuts:\n  - { id: a, part: card, bars: 2, marks: { a: 1bar }, lines: [x] }');
  assert.ok(codes(() => timelineOf(FRONT + dupId)).includes('duplicate-id'));
  assert.ok(codes(() => timelineOf(FRONT + dupMark)).includes('duplicate-mark'));
});

test('story: a crossfade gives the previous cut a tail and moves no start', () => {
  const plain = FRONT + scene(1, 'cuts:\n  - { part: card, bars: 2, lines: [a] }\n  - { part: card, bars: 2, lines: [b] }');
  const fading = FRONT + scene(1, 'cuts:\n  - { part: card, bars: 2, lines: [a] }\n  - { part: card, bars: 2, lines: [b], in: { type: crossfade, duration: 1beat } }');
  const a = timelineOf(plain).scenes[0].cuts;
  const b = timelineOf(fading).scenes[0].cuts;
  assert.equal(a[0].tail, 0);
  assert.equal(b[0].tail, 0.5);
  assert.deepEqual(b.map((c) => [c.start, c.end]), a.map((c) => [c.start, c.end]));
  assert.deepEqual(b[1].in, { type: 'crossfade', duration: 0.5 });
});

test('story: crossfade defaults to half a second, and a plain cut after it clears the tail', () => {
  const text = FRONT + scene(1, [
    'cuts:',
    '  - { part: card, bars: 1, lines: [a] }',
    '  - { part: card, bars: 1, lines: [b], in: crossfade }',
    '  - { part: card, bars: 1, lines: [c] }',
  ].join('\n'));
  const cuts = timelineOf(text).scenes[0].cuts;
  assert.equal(cuts[0].tail, 0.5);
  assert.equal(cuts[1].tail, 0);
});

test('story: peak is the mark peak, else the start of the peak scene', () => {
  const withMark = FRONT + scene(1, card()) + scene(2, 'role: peak\ncuts:\n  - { part: card, bars: 2, marks: { peak: 1bar }, lines: [a] }');
  const withRole = FRONT + scene(1, card()) + scene(2, 'role: peak\n' + card());
  const none = FRONT + scene(1, card());
  assert.equal(timelineOf(withMark).peak, 2 + 2);
  assert.equal(timelineOf(withRole).peak, 2);
  assert.equal(timelineOf(none).peak, null);
});

test('story: telop times resolve cut-relative, for and until', () => {
  const text = FRONT + scene(1, [
    'cuts:',
    '  - part: card',
    '    bars: 2',
    '    lines: [a]',
    '    marks: { hit: 1bar }',
    '    telops:',
    '      - { text: One, at: 1beat, for: 2beats }',
    '      - { text: Two, at: hit, until: end }',
  ].join('\n'));
  const [one, two] = timelineOf(text).scenes[0].cuts[0].telops;
  assert.deepEqual([one.at, one.until], [0.5, 1.5]);
  assert.deepEqual([two.at, two.until], [2, 4]);
  assert.equal(two.position, 'bottom');
});

test('story: a screen or custom cut with a missing src is an error, an image with a missing src is not', () => {
  const missing = scene(1, 'cuts:\n  - { part: custom, bars: 1, src: assets/nothing.html }');
  const image = scene(1, 'cuts:\n  - { part: image, bars: 1, src: assets/nothing.png, prompt: x }');
  assert.ok(codes(() => timelineOf(FRONT + missing)).includes('missing-file'));
  assert.deepEqual(codes(() => timelineOf(FRONT + image)), []);
});

test('story: the frontmatter picks the size from the aspect', () => {
  const text = FRONT.replace('music:', 'output: { aspect: "9:16", fps: 24 }\nmusic:') + scene(1, card());
  const t = timelineOf(text);
  assert.deepEqual([t.width, t.height, t.fps], [1080, 1920, 24]);
});

test('story: card stagger and count duration resolve to seconds', () => {
  const text = FRONT + scene(1, [
    'cuts:',
    '  - part: card',
    '    bars: 2',
    '    stagger: 1beat',
    '    lines:',
    '      - { text: "{n} min", style: big, count: { from: 45, to: 20, duration: 1bar, decimals: 1 } }',
    '      - { text: "{n}", count: { from: 0, to: 9 } }',
  ].join('\n'));
  const p = timelineOf(text).scenes[0].cuts[0].props;
  assert.equal(p.stagger, 0.5);
  assert.deepEqual(p.lines[0].count, { from: 45, to: 20, duration: 2, decimals: 1 });
  // no duration means one bar, and no decimals means 0
  assert.deepEqual(p.lines[1].count, { from: 0, to: 9, duration: 2, decimals: 0 });
  assert.equal(p.align, 'center');
});

test('story: a string card line becomes a line object', () => {
  const p = timelineOf(FRONT + scene(1, card())).scenes[0].cuts[0].props;
  assert.deepEqual(p.lines, [{ text: 'hello', style: null, count: null }]);
  assert.equal(p.stagger, 0.3);
});

test('story: a count duration is capped at the cut duration', () => {
  const text = FRONT + scene(1, 'cuts:\n  - part: card\n    bars: 1\n    lines:\n      - { text: "{n}", count: { from: 0, to: 1, duration: 5bars } }');
  assert.equal(timelineOf(text).scenes[0].cuts[0].props.lines[0].count.duration, 2);
});
