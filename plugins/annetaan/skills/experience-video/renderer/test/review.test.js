import test from 'node:test';
import assert from 'node:assert/strict';
import { keyTimes, judge, mergeWarnings } from '../src/review.js';
import { FRONT, scene, timelineOf } from './helpers.js';

// 120 bpm: a beat is 0.5 s and a bar is 2 s.
const cutOf = (yaml) => timelineOf(FRONT + scene(1, `role: peak\ncuts:\n${yaml}`)).scenes[0].cuts[0];
const labels = (list) => list.map((k) => k.label);

test('review: every telop, every mark and the cut\'s end get a frame', () => {
  const cut = cutOf('  - part: card\n    bars: 4\n    lines: [a]\n    marks: { hit: 3s }\n    telops:\n      - { text: One, at: 0, until: 2s }\n      - { text: Two, at: 4s, until: end }');
  const keys = keyTimes(cut, { peak: null });
  assert.deepEqual(labels(keys), ['telop1', 'mark-hit', 'telop2', 'end']);
  assert.deepEqual(keys.map((k) => k.t), [0.5, 3.25, 4.5, 7.95]);
});

test('review: a cut with no telop and no mark gets a frame at its middle', () => {
  const cut = cutOf('  - { part: card, bars: 2, lines: [a] }');
  assert.deepEqual(keyTimes(cut, { peak: null }), [{ t: 2, label: 'mid' }, { t: 3.95, label: 'end' }]);
});

test('review: the story\'s peak gets a frame when no mark names it', () => {
  const cut = cutOf('  - { part: card, bars: 4, lines: [a], marks: { hit: 1s } }');
  const keys = keyTimes(cut, { peak: 5 });
  assert.deepEqual(labels(keys), ['mark-hit', 'peak', 'end']);
  assert.equal(keys[1].t, 5.25);
  // a mark named peak is the peak: no second frame for it
  const named = cutOf('  - { part: card, bars: 4, lines: [a], marks: { peak: 5s } }');
  assert.deepEqual(labels(keyTimes(named, { peak: 5 })), ['mark-peak', 'end']);
});

test('review: times closer than 0.2 s merge', () => {
  const cut = cutOf('  - part: card\n    bars: 4\n    lines: [a]\n    marks: { hit: 1s }\n    telops:\n      - { text: One, at: 0.8s, until: end }');
  // the telop is looked at at 1.3 s and the mark at 1.25 s: one frame, with the first label
  const keys = keyTimes(cut, { peak: null });
  assert.deepEqual(labels(keys), ['mark-hit', 'end']);
});

test('review: a cut gets at most six frames and keeps its end', () => {
  const telops = Array.from({ length: 8 }, (_, i) => `      - { text: T${i}, at: ${i}s, until: ${i + 0.9}s }`).join('\n');
  const cut = cutOf(`  - part: card\n    bars: 5\n    lines: [a]\n    telops:\n${telops}`);
  const keys = keyTimes(cut, { peak: null });
  assert.equal(keys.length, 6);
  assert.equal(keys[keys.length - 1].label, 'end');
  assert.deepEqual(labels(keys).slice(0, 5), ['telop1', 'telop2', 'telop3', 'telop4', 'telop5']);
});

// A stage of 1000x500: the safe area is inset by 15 px (3% of 500).
const STAGE = { width: 1000, height: 500 };
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const item = (kind, rect, extra = {}) => ({ kind, text: kind, rect, lines: 1, opacity: 1, container: box(0, 0, 1000, 500), ...extra });
const ctx = { cut: { id: 'c' }, scene: { index: 2 } };
const codes = (items) => judge({ stage: STAGE, items }, ctx).map((w) => w.code);

test('review: text partly outside the safe area is a warning', () => {
  assert.deepEqual(codes([item('line', box(100, 100, 400, 140))]), []);
  assert.deepEqual(codes([item('line', box(5, 100, 400, 140))]), ['text-outside']);
  assert.deepEqual(codes([item('telop', box(100, 460, 400, 505))]), ['text-outside']);
  const [w] = judge({ stage: STAGE, items: [item('line', box(5, 100, 400, 140))] }, ctx);
  assert.equal(w.scene, 2);
  assert.equal(w.cut, 'c');
});

test('review: text wholly off stage is not a warning', () => {
  assert.deepEqual(codes([item('line', box(1100, 100, 1500, 140))]), []);
  assert.deepEqual(codes([item('line', box(100, -90, 400, -10))]), []);
});

test('review: invisible text is not a warning', () => {
  assert.deepEqual(codes([item('line', box(5, 100, 400, 140), { opacity: 0 })]), []);
  assert.deepEqual(codes([item('line', box(5, 100, 400, 140), { opacity: 0.05 })]), []);
});

test('review: a telop on three lines is a warning', () => {
  assert.deepEqual(codes([item('telop', box(100, 100, 900, 200), { lines: 2 })]), []);
  assert.deepEqual(codes([item('telop', box(100, 100, 900, 200), { lines: 3 })]), ['telop-lines']);
});

test('review: a telop over a card line is a warning', () => {
  assert.deepEqual(codes([item('telop', box(100, 400, 900, 450)), item('line', box(100, 100, 900, 200))]), []);
  assert.deepEqual(codes([item('telop', box(100, 150, 900, 250)), item('line', box(100, 100, 900, 200))]), ['telop-overlap']);
  assert.deepEqual(codes([item('telop', box(100, 150, 900, 250)), item('telop', box(100, 200, 900, 300))]), ['telop-overlap']);
  assert.deepEqual(codes([item('telop', box(100, 150, 900, 250)), item('prompt', box(100, 200, 900, 300))]), ['telop-overlap']);
  // two lines overlapping each other is the card's own business
  assert.deepEqual(codes([item('line', box(100, 150, 900, 250)), item('line', box(100, 200, 900, 300))]), []);
});

test('review: a telop over fragment text is a warning', () => {
  const frag = (rect) => item('fragment-text', rect, { container: box(0, 0, 1000, 500) });
  assert.deepEqual(codes([item('telop', box(100, 200, 900, 260)), frag(box(200, 220, 800, 300))]), ['telop-overlap']);
  assert.deepEqual(codes([item('telop', box(100, 400, 900, 460)), frag(box(200, 220, 800, 300))]), []);
});

test('review: a shape across a telop is a warning, a plate behind it is not', () => {
  const telop = item('telop', box(300, 400, 700, 460));
  const shape = (rect) => item('painted', rect, { text: '<div.ring>' });
  assert.deepEqual(codes([telop, shape(box(450, 300, 600, 450))]), ['telop-covered']);
  assert.deepEqual(codes([telop, shape(box(250, 380, 750, 480))]), []); // a plate holding the whole telop
  assert.deepEqual(codes([telop, shape(box(100, 50, 300, 250))]), []); // elsewhere
  assert.deepEqual(codes([telop, { ...shape(box(450, 300, 600, 450)), opacity: 0 }]), []); // invisible
  // a shape is not text: it may cross the safe area
  assert.deepEqual(codes([shape(box(-50, -50, 400, 100))]), []);
});

test('review: fragment text cut by its screen is a warning', () => {
  const screen = box(300, 50, 700, 450);
  const frag = (rect) => item('fragment-text', rect, { container: screen });
  assert.deepEqual(codes([frag(box(320, 100, 680, 140))]), []);
  assert.deepEqual(codes([frag(box(320, 100, 740, 140))]), ['fragment-text-clipped']);
  assert.deepEqual(codes([frag(box(720, 100, 900, 140))]), []);
});

test('review: the same warning in two frames of a cut is reported once', () => {
  const w = (code, cut, text, frame) => ({ code, scene: 1, cut, message: 'm', text, frame });
  const merged = mergeWarnings([w('text-outside', 'a', 'x', 'f1'), w('text-outside', 'a', 'x', 'f2'), w('text-outside', 'b', 'x', 'f3'), w('text-outside', 'a', 'y', 'f4'), w('telop-lines', 'a', 'x', 'f5')]);
  assert.deepEqual(merged.map((x) => x.frame), ['f1', 'f3', 'f4', 'f5']);
});
