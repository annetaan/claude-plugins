import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeExpr, resolveTimeExpr, TimeError } from '../src/time.js';

const beat = 0.5; // 120 bpm
const bar = 2;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('time: bars and beats follow the bpm', () => {
  const ctx = { beat, bar, marks: {} };
  near(resolveTimeExpr('2bars', ctx), 4);
  near(resolveTimeExpr('3 beats', ctx), 1.5);
  near(resolveTimeExpr('1bar + 1beat - 0.25s', ctx), 2.25);
  near(resolveTimeExpr('1.5', ctx), 1.5);
  near(resolveTimeExpr(2, ctx), 2);
});

test('time: mark plus offset resolves inside the cut', () => {
  const ctx = { beat, bar, marks: { peak: 12 }, cutStart: 10, cutDuration: 6 };
  near(resolveTimeExpr('peak', ctx), 2);
  near(resolveTimeExpr('peak + 1beat', ctx), 2.5);
  near(resolveTimeExpr('end - 1bar', ctx), 4);
  near(resolveTimeExpr('start', ctx), 0);
});

test('time: a mark from another cut resolves through absolute time', () => {
  const marks = { earlier: 7 };
  near(resolveTimeExpr('earlier', { beat, bar, marks, cutStart: 6, cutDuration: 4 }), 1);
  assert.throws(
    () => resolveTimeExpr('earlier', { beat, bar, marks, cutStart: 10, cutDuration: 4 }),
    (e) => e instanceof TimeError && e.code === 'mark-outside-cut',
  );
  // Outside a cut the result is absolute.
  near(resolveTimeExpr('earlier + 1bar', { beat, bar, marks, duration: 30 }), 9);
});

test('time: a forward mark reference is an error', () => {
  assert.throws(
    () => resolveTimeExpr('later', { beat, bar, marks: {}, cutStart: 0, cutDuration: 4 }),
    (e) => e instanceof TimeError && e.code === 'unknown-mark',
  );
});

test('time: malformed expressions are errors', () => {
  for (const bad of ['', '1 2', '2foo', '+', '1 +']) {
    assert.throws(() => parseTimeExpr(bad), TimeError, bad);
  }
});
