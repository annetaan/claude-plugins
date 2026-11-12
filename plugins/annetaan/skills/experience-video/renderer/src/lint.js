// Lint a resolved timeline. Errors stop a render; warnings are for the frame check.

export const MAX_DURATION = 60; // seconds; a video of this length or longer is an error
export const READING_MIN_SECONDS = 1;
export const READING_CHARS_PER_SECOND = { cjk: 4, other: 15 };
export const NARRATION_CHARS_PER_SECOND = { cjk: 6, other: 15 };
export const BEAT_TOLERANCE = 0.02; // seconds
const EPS = 1e-6;

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿＀-￯]/g;

function perSecond(text, table) {
  const chars = [...String(text)].length;
  const cjk = (String(text).match(CJK_RE) || []).length;
  return { chars, rate: cjk * 2 > chars ? table.cjk : table.other };
}

export function readingTime(text) {
  const { chars, rate } = perSecond(text, READING_CHARS_PER_SECOND);
  return Math.max(READING_MIN_SECONDS, chars / rate);
}

export function speakingTime(text) {
  const { chars, rate } = perSecond(text, NARRATION_CHARS_PER_SECOND);
  return chars / rate;
}

const f = (code, scene, cut, message) => ({ code, scene, cut, message });

// lintStory(timeline, { say }) -> { errors, warnings }. `say` says whether the machine can speak narration.
export function lintStory(timeline, { say = true } = {}) {
  const errors = [];
  const warnings = [];
  const { beat } = timeline;
  const onGrid = (t) => {
    const k = t / beat;
    return Math.abs(k - Math.round(k)) * beat <= BEAT_TOLERANCE;
  };

  if (timeline.duration >= MAX_DURATION - EPS) {
    errors.push(f('too-long', null, null, `the video is ${timeline.duration.toFixed(1)} s; it has to stay under ${MAX_DURATION} s`));
  }

  const peakScenes = timeline.scenes.filter((s) => s.role === 'peak');
  if (peakScenes.length > 1) {
    errors.push(f('many-peak-scenes', peakScenes[1].index, null, `${peakScenes.length} scenes have role: peak; only one may`));
  }
  const peakMark = timeline.marks.peak;
  if (peakMark !== undefined && peakScenes.length > 0) {
    const inside = peakScenes.some((s) => peakMark >= s.start - EPS && peakMark <= s.end + EPS);
    if (!inside) {
      errors.push(f('peak-outside-scene', peakScenes[0].index, null, `mark "peak" (${peakMark.toFixed(2)} s) is outside the scene with role: peak`));
    }
  }
  if (timeline.peak === null) {
    warnings.push(f('no-peak', null, null, 'the story has no peak: add a scene with role: peak or a mark named peak'));
  }

  for (const scene of timeline.scenes) {
    for (const cut of scene.cuts) {
      const dur = cut.end - cut.start;
      if (!onGrid(cut.start)) {
        warnings.push(f('off-beat-cut', scene.index, cut.id, `cut starts at ${cut.start.toFixed(3)} s, off the beat grid`));
      }
      for (const [name, rel] of Object.entries(cut.marks)) {
        if (rel < -EPS || rel > dur + EPS) {
          errors.push(f('mark-outside-cut', scene.index, cut.id, `mark "${name}" is outside its cut`));
        }
      }
      for (const t of cut.telops) {
        const label = JSON.stringify(t.text.length > 24 ? `${t.text.slice(0, 24)}...` : t.text);
        if (t.at < -EPS || t.until > dur + EPS || t.until <= t.at + EPS) {
          errors.push(f('telop-outside-cut', scene.index, cut.id, `telop ${label} runs ${t.at.toFixed(2)}-${t.until.toFixed(2)} s in a cut of ${dur.toFixed(2)} s`));
          continue;
        }
        if (t.until - t.at < readingTime(t.text) - EPS) {
          warnings.push(f('telop-too-short', scene.index, cut.id, `telop ${label} shows for ${(t.until - t.at).toFixed(2)} s; reading takes ${readingTime(t.text).toFixed(2)} s`));
        }
        if (!onGrid(cut.start + t.at)) {
          warnings.push(f('off-beat-telop', scene.index, cut.id, `telop ${label} starts off the beat grid`));
        }
      }
    }
    if (scene.narration) {
      if (!say) {
        warnings.push(f('no-say', scene.index, null, 'this machine has no `say`; narration will be skipped'));
      }
      const room = scene.end - scene.narration.at;
      if (speakingTime(scene.narration.text) > room + EPS) {
        warnings.push(f('narration-too-long', scene.index, null, `narration takes about ${speakingTime(scene.narration.text).toFixed(1)} s; the scene leaves ${room.toFixed(1)} s`));
      }
    }
  }
  if (!onGrid(timeline.duration)) {
    warnings.push(f('off-beat-end', null, null, 'the video ends off the beat grid'));
  }
  return { errors, warnings };
}
