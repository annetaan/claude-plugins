// Joins the rendered cuts into one mp4 with one ffmpeg process.
//   - Each cut is visible from its start, on top until its end, and under the next cut for its tail.
//   - in: fade / crossfade ramps the cut's alpha over the transition's duration; out: fade goes to black at its end.
//   - Output is exactly timeline.duration long, at the capture frame rate, h264 yuv420p with +faststart.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const n = (x) => x.toFixed(6);

// buildGraph(timeline, captureFps, outW, outH) -> filter_complex string; input i is the file of cut i.
export function buildGraph(timeline, captureFps, outW, outH, cuts = timeline.scenes.flatMap((s) => s.cuts)) {
  const parts = [`color=c=black:s=${outW}x${outH}:r=${captureFps}:d=${n(timeline.duration)},format=yuv420p[b0]`];
  cuts.forEach((cut, i) => {
    const chain = [`[${i}:v]trim=duration=${n(cut.duration + cut.tail)}`, 'setpts=PTS-STARTPTS', 'format=yuva420p'];
    if (cut.in.type !== 'none' && cut.in.duration > 0) chain.push(`fade=t=in:st=0:d=${n(cut.in.duration)}:alpha=1`);
    if (cut.out.type === 'fade' && cut.out.duration > 0) {
      chain.push(`fade=t=out:st=${n(Math.max(0, cut.duration - cut.out.duration))}:d=${n(cut.out.duration)}`);
    }
    chain.push(`setpts=PTS+${n(cut.start)}/TB`);
    parts.push(`${chain.join(',')}[v${i}]`);
    parts.push(`[b${i}][v${i}]overlay=enable='gte(t,${n(cut.start)})':eof_action=pass:format=auto[b${i + 1}]`);
  });
  parts.push(`[b${cuts.length}]trim=duration=${n(timeline.duration)},setpts=PTS-STARTPTS[out]`);
  return parts.join(';');
}

// assemble({ timeline, files, quality, outFile }): files[i] is the mp4 of cut i, in timeline order.
export async function assemble({ timeline, files, quality, outFile }) {
  const captureFps = timeline.fps / quality.fpsDivisor;
  const outW = Math.round(timeline.width * quality.scale);
  const outH = Math.round(timeline.height * quality.scale);
  const cuts = timeline.scenes.flatMap((s) => s.cuts);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part.mp4`;
  const args = ['-v', 'error', '-y'];
  for (const f of files) args.push('-i', f);
  args.push(
    '-filter_complex', buildGraph(timeline, captureFps, outW, outH, cuts),
    '-map', '[out]',
    '-r', String(captureFps),
    '-t', n(timeline.duration),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    tmp,
  );
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((resolve) => ff.on('close', resolve));
  if (code !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`ffmpeg assembly failed: ${stderr.trim().split('\n').pop()}`);
  }
  fs.renameSync(tmp, outFile);
}
