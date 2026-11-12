// Audio: narration clips from macOS `say`, and the ffmpeg inputs and filter graph that mix music and narration.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha, stable } from './hash.js';
import { CaptureError } from './capture.js';

const RATE = 48000;
const n = (x) => x.toFixed(6);

// voiceFor(language, listText) -> a voice name or null. listText is the output of `say -v ?`: one voice per line,
// "<name>  <locale>  # <sample>". The first voice whose locale is the language, else the first of the same language.
export function voiceFor(language, listText) {
  if (!language) return null;
  const voices = [];
  for (const line of String(listText).split('\n')) {
    const m = line.match(/^(.+?)\s+([A-Za-z]{2,3}[_-][A-Za-z0-9]+)\s+#/);
    if (m) voices.push({ name: m[1].trim(), locale: m[2].replace('-', '_').toLowerCase() });
  }
  const wanted = String(language).replace('-', '_').toLowerCase();
  const exact = voices.find((v) => v.locale === wanted);
  if (exact) return exact.name;
  const base = wanted.split('_')[0];
  return voices.find((v) => v.locale.split('_')[0] === base)?.name ?? null;
}

function clipSeconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number.parseFloat(r.stdout);
  return Number.isFinite(d) ? d : 0;
}

// narrationClips({ timeline, buildDir, say }) -> { clips: [{ file, at }], warnings }
// `say` says whether the machine can speak. A clip is kept in build/narration/ under a hash of what it says.
export function narrationClips({ timeline, buildDir, say }) {
  const scenes = timeline.scenes.filter((s) => s.narration);
  const dir = path.join(buildDir, 'narration');
  if (!say) return { clips: [], warnings: [] };
  if (scenes.length === 0) {
    fs.rmSync(dir, { recursive: true, force: true }); // no scene speaks, so no clip is kept
    return { clips: [], warnings: [] };
  }
  fs.mkdirSync(dir, { recursive: true });
  let list = null;
  const languageVoice = () => {
    list ??= spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout ?? '';
    return voiceFor(timeline.language, list);
  };
  const clips = [];
  const warnings = [];
  const keep = new Set();
  for (const scene of scenes) {
    const nar = scene.narration;
    const voice = nar.voice ?? timeline.narration?.voice ?? languageVoice();
    const rate = timeline.narration?.rate ?? null;
    const file = path.join(dir, `${sha(stable({ text: nar.text, voice, rate })).slice(0, 12)}.aiff`);
    keep.add(file);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.part.aiff`;
      const args = [...(voice ? ['-v', voice] : []), ...(rate ? ['-r', String(rate)] : []), '-o', tmp, '--', nar.text];
      const r = spawnSync('say', args, { encoding: 'utf8' });
      if (r.status !== 0 || !fs.existsSync(tmp)) {
        fs.rmSync(tmp, { force: true });
        throw new CaptureError('say', null, `say failed for scene ${scene.index}: ${String(r.stderr || r.error?.message || 'no output').trim()}`);
      }
      fs.renameSync(tmp, file);
    }
    const length = clipSeconds(file);
    if (nar.at + length > scene.end + 1e-6) {
      warnings.push({
        code: 'narration-overruns',
        scene: scene.index,
        cut: null,
        message: `narration of scene ${scene.index} ends at ${(nar.at + length).toFixed(1)} s, after the scene's end at ${scene.end.toFixed(1)} s`,
      });
    }
    clips.push({ file, at: nar.at });
  }
  for (const f of fs.readdirSync(dir)) {
    const abs = path.join(dir, f);
    if (!keep.has(abs)) fs.rmSync(abs, { recursive: true, force: true });
  }
  return { clips, warnings };
}

// audioPlan({ timeline, music, clips, firstInput }) -> { inputs, graph }. Pure.
//   music: null, { kind: 'file', file, offset } or { kind: 'script', file } (file is build/music.wav).
//   inputs are ffmpeg arguments that follow the video inputs; the first of them is input number firstInput.
//   graph ends in [aout]: every input as 48 kHz stereo, mixed without normalising, padded and cut to the duration,
//   faded out over music.fadeOut.
export function audioPlan({ timeline, music, clips, firstInput }) {
  const stereo = `aformat=sample_rates=${RATE}:channel_layouts=stereo`;
  const inputs = [];
  const chains = [];
  const labels = [];
  const add = (args, chain) => {
    const i = firstInput + labels.length;
    inputs.push(...args);
    const label = `a${labels.length}`;
    chains.push(`[${i}:a]${chain}[${label}]`);
    labels.push(label);
  };
  if (music) {
    add(music.kind === 'file' ? ['-ss', String(music.offset ?? 0), '-i', music.file] : ['-i', music.file], `${stereo},volume=${n(timeline.music.volume)}`);
  }
  for (const clip of clips) {
    const ms = Math.max(0, Math.round(clip.at * 1000));
    add(['-i', clip.file], `${stereo},adelay=${ms}:all=1`);
  }
  const d = n(timeline.duration);
  const fade = timeline.music.fadeOut > 0 ? `,afade=t=out:st=${n(Math.max(0, timeline.duration - timeline.music.fadeOut))}:d=${n(Math.min(timeline.music.fadeOut, timeline.duration))}` : '';
  if (labels.length === 0) {
    // Nothing to play: a silent stream, so every output has one video and one audio stream.
    inputs.push('-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo`);
    return { inputs, graph: `[${firstInput}:a]atrim=duration=${d},asetpts=PTS-STARTPTS[aout]` };
  }
  const mix = `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${d},atrim=duration=${d},asetpts=PTS-STARTPTS${fade}[aout]`;
  return { inputs, graph: [...chains, mix].join(';') };
}
