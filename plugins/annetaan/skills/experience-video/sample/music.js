// The music of the sample story. It reads every time from `timeline` and `helpers`, so a longer scene or another
// tempo moves the music with it. The roles of the scenes shape the track:
//   pain        sparse and low: a pad and a slow bass note
//   encounter   a pulse joins and grows
//   peak        a build-up (hats speeding up, a rising sweep) that lands on timeline.peak, then the full arrangement
//   everyday    a steady groove, lighter than the full arrangement
//   headline    a chord that resolves and rings into the fade
window.compose = async (ctx, timeline, helpers) => {
  const { bar, beat, random } = helpers;
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // Master chain: gain into a compressor, so the loudest section stays below clipping.
  const master = ctx.createGain();
  master.gain.value = 0.62;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = random() * 2 - 1;

  const env = (g, t, peak, attack, hold, release) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
  };
  const tone = (type, freq, t, dur, vel, { attack = 0.01, release = 0.2, filter = null, detune = 0, to = master } = {}) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    env(g, t, vel, attack, Math.max(0, dur - attack), release);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(to);
    o.start(t);
    o.stop(t + dur + release + 0.05);
  };
  const burst = (t, dur, vel, type, freq, q = 0.7) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, vel, 0.002, 0, dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.05);
  };

  // Building blocks.
  const kick = (t, vel) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, vel, 0.003, 0.05, 0.28);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.4);
  };
  const hat = (t, vel) => burst(t, 0.045, vel * (0.7 + 0.3 * random()), 'highpass', 7500);
  const clap = (t, vel) => burst(t, 0.14, vel, 'bandpass', 1900, 0.9);
  const bass = (t, dur, midi, vel) => tone('triangle', hz(midi), t, dur, vel, { attack: 0.02, release: 0.12, filter: 500 });
  const pad = (t, dur, midis, vel) => {
    for (const m of midis) {
      for (const cents of [-7, 7]) tone('sawtooth', hz(m), t, dur, vel / midis.length, { attack: 0.5, release: 0.7, filter: 1100, detune: cents });
    }
  };
  const pluck = (t, midi, vel) => tone('triangle', hz(midi), t, 0.18, vel, { attack: 0.005, release: 0.25, filter: 2800 });
  const sweep = (t, dur, vel) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.1);
  };

  // A four-chord loop in a minor key: Am F C G. Chord tones as MIDI notes above the root.
  const chords = [
    { root: 45, tones: [57, 60, 64] },
    { root: 41, tones: [53, 57, 60] },
    { root: 48, tones: [55, 60, 64] },
    { root: 43, tones: [55, 59, 62] },
  ];
  const beatsPerBar = timeline.beatsPerBar;
  const peakT = timeline.peak;
  const end = timeline.duration;

  for (const scene of timeline.scenes) {
    const firstBar = Math.round(scene.startBar);
    const count = Math.ceil(scene.bars - 1e-6);
    for (let k = 0; k < count; k++) {
      const g = firstBar + k; // the bar's number in the whole video
      const t0 = bar(g);
      if (t0 >= end - 1e-6) break;
      const chord = chords[g % chords.length];
      const progress = count > 1 ? k / (count - 1) : 1;
      const inPeakScene = peakT !== null && peakT >= scene.start - 1e-6 && peakT < scene.end - 1e-6;
      const full = inPeakScene && t0 >= peakT - 1e-6;
      const room = Math.min(bar(1), end - t0);

      if (full) {
        // The full arrangement: four on the floor, claps, eighth hats, bass, pad and an arpeggio.
        pad(t0, room, chord.tones, 0.34);
        for (let b = 0; b < beatsPerBar; b++) {
          const t = t0 + beat(b);
          kick(t, 0.95);
          if (b % 2 === 1) clap(t, 0.32);
          hat(t, 0.16);
          hat(t + beat(0.5), 0.2);
          bass(t + beat(0.5), beat(0.45), chord.root, 0.5);
          pluck(t, chord.tones[b % 3] + 12, 0.22);
          pluck(t + beat(0.5), chord.tones[(b + 1) % 3] + 12, 0.16);
        }
        if (peakT !== null && Math.abs(t0 - peakT) < 1e-3) burst(t0, 1.6, 0.35, 'highpass', 5000);
      } else if (scene.role === 'pain') {
        pad(t0, room, [chord.tones[0], chord.tones[2]], 0.07);
        bass(t0, beat(2), chord.root - 12, 0.22);
        if (k % 2 === 1) hat(t0 + beat(2), 0.05);
      } else if (scene.role === 'encounter') {
        pad(t0, room, chord.tones, 0.09 + 0.1 * progress);
        const vel = 0.25 + 0.35 * progress;
        for (let b = 0; b < beatsPerBar; b += 2) kick(t0 + beat(b), vel);
        for (let b = 0; b < beatsPerBar; b++) hat(t0 + beat(b) + beat(0.5), 0.04 + 0.08 * progress);
        bass(t0, beat(1.5), chord.root, 0.25 + 0.15 * progress);
      } else if (inPeakScene) {
        // Build-up: the pulse tightens bar by bar and a sweep rises into the peak.
        pad(t0, room, chord.tones, 0.14 + 0.14 * progress);
        const steps = progress > 0.5 ? 4 : 2; // eighths, then sixteenths
        for (let b = 0; b < beatsPerBar; b++) {
          kick(t0 + beat(b), 0.35 + 0.4 * progress);
          for (let s = 0; s < steps; s++) hat(t0 + beat(b) + beat(s / steps), 0.08 + 0.1 * progress);
        }
        bass(t0, beat(2), chord.root, 0.45);
        if (k === 0) sweep(scene.start, Math.max(0.5, (peakT ?? scene.end) - scene.start), 0.28);
        if (peakT !== null && t0 + bar(1) > peakT - 1e-6) {
          // The last bar before the peak: a snare roll.
          for (let s = 0; s < beatsPerBar * 4; s++) clap(t0 + beat(s / 4), 0.1 + 0.18 * (s / (beatsPerBar * 4)));
        }
      } else if (scene.role === 'headline') {
        if (k === 0) kick(t0, 0.7);
        // A resolving chord (C major with a ninth) that rings on into the fade-out.
        const resolve = [48, 55, 60, 64, 67];
        pad(t0, room + bar(1), resolve, 0.3);
        if (k === 0) for (const m of [72, 76, 79, 83]) tone('sine', hz(m), t0 + beat(0.5), bar(count), 0.07, { attack: 0.03, release: 1.5 });
      } else {
        // Everyday and anything else: a steady groove, lighter than the full arrangement.
        pad(t0, room, chord.tones, 0.17);
        for (let b = 0; b < beatsPerBar; b++) {
          const t = t0 + beat(b);
          if (b % 2 === 0) kick(t, 0.45);
          hat(t + beat(0.5), 0.1);
          pluck(t, chord.tones[b % 3] + 12, 0.1);
        }
        bass(t0, beat(1.5), chord.root, 0.35);
        bass(t0 + beat(2), beat(1.5), chord.root, 0.3);
      }
    }
  }
};
