import test from 'node:test';
import assert from 'node:assert/strict';
import { lintStory } from '../src/lint.js';
import { FRONT, scene, timelineOf } from './helpers.js';

// 120 bpm: a beat is 0.5 s and a bar is 2 s.
const lint = (text, opts) => lintStory(timelineOf(FRONT + text), opts);
const has = (list, code) => list.some((x) => x.code === code);

test('lint: sixty seconds or more is an error', () => {
  const long = scene(1, 'role: peak\ncuts:\n  - { part: card, bars: 30, lines: [a] }');
  const ok = scene(1, 'role: peak\ncuts:\n  - { part: card, bars: 29, lines: [a] }');
  assert.ok(has(lint(long).errors, 'too-long'));
  assert.ok(!has(lint(ok).errors, 'too-long'));
});

test('lint: a telop shorter than its reading time is a warning', () => {
  const short = scene(1, 'role: peak\ncuts:\n  - part: card\n    bars: 2\n    lines: [a]\n    telops:\n      - { text: A fairly long caption line, at: 0, for: 1beat }');
  const fine = scene(1, 'role: peak\ncuts:\n  - part: card\n    bars: 2\n    lines: [a]\n    telops:\n      - { text: A fairly long caption line, at: 0, until: end }');
  assert.ok(has(lint(short).warnings, 'telop-too-short'));
  assert.ok(!has(lint(fine).warnings, 'telop-too-short'));
});

test('lint: a telop outside its cut is an error', () => {
  const text = scene(1, 'role: peak\ncuts:\n  - part: card\n    bars: 1\n    lines: [a]\n    telops:\n      - { text: Late, at: 3bars, for: 2s }');
  assert.ok(has(lint(text).errors, 'telop-outside-cut'));
});

test('lint: a mark outside its cut is an error', () => {
  const text = scene(1, 'role: peak\ncuts:\n  - { part: card, bars: 1, marks: { late: 3bars }, lines: [a] }');
  assert.ok(has(lint(text).errors, 'mark-outside-cut'));
});

test('lint: a mark peak outside the peak scene is an error', () => {
  const text = scene(1, 'role: pain\ncuts:\n  - { part: card, bars: 2, marks: { peak: 1bar }, lines: [a] }') + scene(2, 'role: peak\ncuts:\n  - { part: card, bars: 2, lines: [b] }');
  assert.ok(has(lint(text).errors, 'peak-outside-scene'));
});

test('lint: a mark peak inside the peak scene is fine, and two peak scenes are an error', () => {
  const good = scene(1, 'role: peak\ncuts:\n  - { part: card, bars: 2, marks: { peak: 1bar }, lines: [a] }');
  assert.equal(lint(good).errors.length, 0);
  const two = scene(1, 'role: peak\ncuts:\n  - { part: card, bars: 1, lines: [a] }') + scene(2, 'role: peak\ncuts:\n  - { part: card, bars: 1, lines: [b] }');
  assert.ok(has(lint(two).errors, 'many-peak-scenes'));
});

test('lint: no peak is a warning', () => {
  assert.ok(has(lint(scene(1, 'cuts:\n  - { part: card, bars: 1, lines: [a] }')).warnings, 'no-peak'));
});

test('lint: a cut off the beat grid is a warning', () => {
  const text = scene(1, 'role: peak\ncuts:\n  - { part: card, duration: 1.3, lines: [a] }\n  - { part: card, bars: 1, lines: [b] }');
  assert.ok(has(lint(text).warnings, 'off-beat-cut'));
});

test('lint: narration longer than its scene, and narration without say, are warnings', () => {
  const text = scene(1, 'role: peak\nnarration: This narration is far too long to be spoken inside a single short bar of music.\ncuts:\n  - { part: card, bars: 1, lines: [a] }');
  assert.ok(has(lint(text).warnings, 'narration-too-long'));
  assert.ok(has(lint(text, { say: false }).warnings, 'no-say'));
  assert.ok(!has(lint(text, { say: true }).warnings, 'no-say'));
});
