import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceFor, audioPlan } from '../src/audio.js';

const LIST = `Albert              en_US    # Hello! My name is Albert.
Eddy (English (US)) en_US    # Hello! My name is Eddy.
Daniel              en_GB    # Hello! My name is Daniel.
Kyoko               ja_JP    # Hello, my name is Kyoko.
Eddy (Japanese (Japan)) ja_JP    # Hello.
Amelie              fr_CA    # Bonjour, je m'appelle Amelie.
Thomas              fr_FR    # Bonjour, je m'appelle Thomas.
`;

test('audio: a voice is picked by the story\'s language', () => {
  assert.equal(voiceFor('ja', LIST), 'Kyoko');
  assert.equal(voiceFor('ja-JP', LIST), 'Kyoko');
  assert.equal(voiceFor('en-GB', LIST), 'Daniel');
  assert.equal(voiceFor('en', LIST), 'Albert');
  assert.equal(voiceFor('fr-FR', LIST), 'Thomas');
  assert.equal(voiceFor('fr', LIST), 'Amelie');
  assert.equal(voiceFor('sv', LIST), null);
  assert.equal(voiceFor('en', ''), null);
});

const timeline = { duration: 20, music: { volume: 0.8, fadeOut: 1.5 } };

test('audio: narration is delayed to its scene\'s time', () => {
  const plan = audioPlan({ timeline, music: null, clips: [{ file: '/n/a.aiff', at: 2.5 }], firstInput: 3 });
  assert.deepEqual(plan.inputs, ['-i', '/n/a.aiff']);
  assert.match(plan.graph, /\[3:a\][^;]*adelay=2500:all=1/);
  assert.match(plan.graph, /amix=inputs=1:normalize=0/);
  assert.match(plan.graph, /\[aout\]$/);
});

test('audio: no music and no narration gives a silent track', () => {
  const plan = audioPlan({ timeline, music: null, clips: [], firstInput: 8 });
  assert.deepEqual(plan.inputs.slice(0, 3), ['-f', 'lavfi', '-i']);
  assert.match(plan.inputs[3], /^anullsrc/);
  assert.match(plan.graph, /^\[8:a\]atrim=duration=20\.000000/);
  assert.match(plan.graph, /\[aout\]$/);
});

test('audio: a music file starts at its offset', () => {
  const plan = audioPlan({ timeline, music: { kind: 'file', file: '/m/t.mp3', offset: 12.5 }, clips: [{ file: '/n/a.aiff', at: 1 }], firstInput: 2 });
  assert.deepEqual(plan.inputs, ['-ss', '12.5', '-i', '/m/t.mp3', '-i', '/n/a.aiff']);
  assert.match(plan.graph, /\[2:a\][^;]*volume=0\.800000/);
  assert.match(plan.graph, /amix=inputs=2:normalize=0/);
  assert.match(plan.graph, /afade=t=out:st=18\.500000:d=1\.500000/);
});

test('audio: a script track plays from its WAV without an offset', () => {
  const plan = audioPlan({ timeline, music: { kind: 'script', file: '/b/music.wav' }, clips: [], firstInput: 1 });
  assert.deepEqual(plan.inputs, ['-i', '/b/music.wav']);
});
