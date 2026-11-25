import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const VIDEO = join(import.meta.dirname, "../..", "plugins/annetaan/skills/experience-video");
const EV = join(VIDEO, "renderer/bin/ev.js");

const tmp = mkdtempSync(join(tmpdir(), "experience-video-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
);

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

type Finding = { readonly code: string; readonly cut: string };

type Frame = {
  readonly file: string;
  readonly scene: number;
  readonly t: number;
  readonly cut: string;
  readonly label: string;
};

type Report = {
  readonly ok: boolean;
  readonly duration: number;
  readonly scenes: readonly unknown[];
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly rendered: readonly string[];
  readonly cached: readonly string[];
  readonly music: { readonly source: string };
  readonly deps: string;
  readonly installed: boolean;
  readonly cut: string;
  readonly file: string;
  readonly frames: readonly Frame[];
};

type Music = {
  readonly ok: boolean;
  readonly cached: boolean;
  readonly warnings: readonly Finding[];
  readonly loudestBar: number;
  readonly peakBar: number;
  readonly levels: readonly number[];
};

type Stream = {
  readonly codec_type: string;
  readonly width: number;
  readonly height: number;
  readonly duration: string;
  readonly sample_rate: string;
  readonly channels: number;
};

type Probe = {
  readonly streams: readonly Stream[];
  readonly format: { readonly duration: string };
};

const ev = (...args: readonly string[]): Ran => {
  const result = spawnSync("node", [EV, ...args], { env, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const evOk = <Parsed = Report>(...args: readonly string[]): Parsed => {
  const ran = ev(...args);
  assert.equal(ran.code, 0, `${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
};

const evFails = (...args: readonly string[]): Report => {
  const ran = ev(...args);
  assert.equal(ran.code, 1, ran.stdout);
  return JSON.parse(ran.stdout);
};

const firstError = (report: Report): Finding => {
  const error = report.errors.at(0);
  assert.ok(error, JSON.stringify(report));
  return error;
};

const firstStream = (probed: Probe): Stream => {
  const stream = probed.streams.at(0);
  assert.ok(stream, JSON.stringify(probed));
  return stream;
};

const warningCodes = (report: Report): readonly string[] =>
  report.warnings.map((warning) => warning.code);

const ffmpeg = (...args: readonly string[]): void => {
  const result = spawnSync("ffmpeg", args, { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

const probe = (
  file: string,
  entries = "stream=codec_type,width,height,duration:format=duration",
): Probe => {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-of", "json", "-show_entries", entries, file],
    {
      env,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const codecTypes = (file: string): readonly string[] =>
  probe(file)
    .streams.map((stream) => stream.codec_type)
    .toSorted();

const meanVolume = (file: string): number => {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "info", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"],
    { env, encoding: "utf8" },
  );
  const match = /mean_volume: (-?[0-9.]+) dB/u.exec(result.stderr);
  assert.ok(match?.[1], result.stderr);
  return Number(match[1]);
};

const pngSize = (file: string): readonly number[] => {
  const head = readFileSync(file).subarray(0, 24);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
};

const mtimes = (dir: string): readonly (readonly [string, bigint])[] =>
  readdirSync(dir)
    .toSorted()
    .map((name) => [name, statSync(join(dir, name), { bigint: true }).mtimeNs] as const);

const isEmptyOrMissing = (dir: string): boolean =>
  !existsSync(dir) || readdirSync(dir).length === 0;

const edit = (file: string, old: string | RegExp, replacement: string, to = file): void => {
  const text = readFileSync(file, "utf8");
  assert.ok(
    typeof old === "string" ? text.includes(old) : old.test(text),
    `${String(old)} in ${file}`,
  );
  writeFileSync(to, text.replace(old, replacement));
};

const storyWith = (dir: string, cuts: string, frontMatter = ""): void => {
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(
    join(dir, "story.md"),
    [
      "---",
      "title: Parts",
      "music: { bpm: 120, beats_per_bar: 4 }",
      `${frontMatter}---`,
      "",
      "## Brief",
      "",
      "A small test.",
      "",
      "## Scene 1 — Only",
      "",
      "Purpose.",
      "",
      "```yaml",
      "role: headline",
      "cuts:",
      cuts,
      "```",
      "",
    ].join("\n"),
  );
};

const fragmentFails = (name: string, html: string, code: string): void => {
  const dir = join(tmp, `frag-${name}`);
  storyWith(dir, "  - { id: boom, part: custom, bars: 1, src: assets/f.html }");
  writeFileSync(join(dir, "assets/f.html"), `${html}\n`);
  const report = evFails("render", join(dir, "story.md"), "--preview");
  const error = firstError(report);
  assert.deepEqual([error.code, error.cut], [code, "boom"], JSON.stringify(report));
  assert.ok(isEmptyOrMissing(join(dir, "build/cuts/preview")), `fragment ${name} left a file`);
};

const frameFinds = (name: string, html: string, code: string, position = "center"): void => {
  const dir = join(tmp, `fr-${name}`);
  storyWith(
    dir,
    [
      "  - part: custom",
      "    bars: 2",
      "    src: assets/f.html",
      "    telops:",
      `      - { text: Telop over the picture, at: 0, until: end, position: ${position}, style: headline }`,
    ].join("\n"),
  );
  writeFileSync(join(dir, "assets/f.html"), `${html}\n`);
  const report = evOk("frames", join(dir, "story.md"));
  assert.ok(warningCodes(report).includes(code), JSON.stringify(report));
};

const SAMPLE = join(tmp, "sample");
const STORY = join(SAMPLE, "story.md");
const PREVIEW = join(SAMPLE, "build/preview.mp4");
const BAD_RENDER = join(tmp, "bad-render");
const MEDIA = join(tmp, "media");
let sampleDuration = Number.NaN;

test("setup", () => {
  assert.equal(evOk("setup").ok, true);
});

test("unit tests", () => {
  const result = spawnSync("npm", ["test"], {
    cwd: join(VIDEO, "renderer"),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test("check on the sample", () => {
  cpSync(join(VIDEO, "sample"), SAMPLE, { recursive: true });
  const report = evOk("check", STORY);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.ok(0 < report.duration && report.duration < 60, JSON.stringify(report));
  assert.equal(report.scenes.length, 5, JSON.stringify(report));
  assert.ok(existsSync(join(SAMPLE, "build/timeline.json")));
  sampleDuration = report.duration;
});

test("check rejects a bad story", () => {
  const bad = join(tmp, "bad.md");
  edit(STORY, /^## Scene 2 /mu, "## Scene 7 ", bad);
  const report = evFails("check", bad);
  assert.equal(firstError(report).code, "scene-number", JSON.stringify(report));
});

test("setup --deps", () => {
  const deps = join(tmp, "deps");
  const first = evOk("setup", "--deps", deps);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.deps, deps, JSON.stringify(first));
  assert.ok(existsSync(join(deps, "node_modules")));
  const checked = evOk("check", STORY, "--deps", deps);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const again = evOk("setup", "--deps", deps);
  assert.equal(again.installed, false, JSON.stringify(again));
});

test("render --preview", () => {
  const report = evOk("render", STORY, "--preview");
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(
    report.rendered.toSorted(),
    ["basket", "headline", "order", "question", "recipe", "table", "twenty", "week"],
    JSON.stringify(report),
  );
  assert.deepEqual(report.errors, [], JSON.stringify(report));
  assert.ok(existsSync(PREVIEW));
  const probed = probe(PREVIEW);
  assert.deepEqual(codecTypes(PREVIEW), ["audio", "video"], JSON.stringify(probed));
  assert.ok(
    probed.streams.every((stream) => Math.abs(Number(stream.duration) - sampleDuration) < 0.1),
    JSON.stringify(probed),
  );
  assert.equal(report.music.source, "script", JSON.stringify(report));
  const video = firstStream(probed);
  assert.deepEqual([video.width, video.height], [960, 540], JSON.stringify(probed));
  assert.ok(
    Math.abs(Number(probed.format.duration) - sampleDuration) < 0.1,
    JSON.stringify(probed),
  );
});

test("the sample's audio is not silent", () => {
  assert.ok(meanVolume(PREVIEW) > -50);
});

const hasSay = spawnSync("sh", ["-c", "command -v say"], { env }).status === 0;

test("narration", { skip: hasSay ? false : "no say on this machine" }, () => {
  assert.equal(readdirSync(join(SAMPLE, "build/narration")).length, 1);
  const dir = join(tmp, "nar");
  const story = join(dir, "story.md");
  storyWith(dir, "  - { id: only, part: card, bars: 1, lines: [Hello] }");
  edit(story, "\nrole: headline\n", '\nrole: headline\nnarration: "Hello there."\n');
  evOk("render", story, "--preview");
  assert.equal(readdirSync(join(dir, "build/narration")).length, 1);
  edit(story, 'narration: "Hello there."\n', "");
  evOk("render", story, "--preview");
  assert.ok(isEmptyOrMissing(join(dir, "build/narration")), "a stale narration clip stayed");
});

const BASKET = "  - id: basket\n    part: image\n    bars: 2\n";
const LONGER_BASKET = "  - id: basket\n    part: image\n    bars: 3\n";

test("music", () => {
  const dir = join(tmp, "m1");
  const story = join(dir, "story.md");
  cpSync(join(VIDEO, "sample"), dir, { recursive: true });
  const first = evOk<Music>("music", story);
  assert.deepEqual(
    [first.ok, first.cached, first.warnings],
    [true, false, []],
    JSON.stringify(first),
  );
  assert.ok(first.loudestBar >= first.peakBar, JSON.stringify(first));
  const sum = (levels: readonly number[]): number => levels.reduce((a, b) => a + b, 0);
  assert.ok(
    sum(first.levels.slice(0, 3)) / 3 <=
      (0.5 * sum(first.levels.slice(first.peakBar, first.peakBar + 2))) / 2,
    JSON.stringify(first),
  );
  const wav = probe(join(dir, "build/music.wav"), "stream=sample_rate,channels:format=duration");
  const stream = firstStream(wav);
  assert.deepEqual(
    [
      stream.sample_rate,
      stream.channels,
      Math.abs(Number(wav.format.duration) - sampleDuration) < 0.05,
    ],
    ["48000", 2, true],
    JSON.stringify(wav),
  );
  assert.equal(evOk<Music>("music", story).cached, true);
  appendFileSync(join(dir, "music.js"), "// edited\n");
  assert.equal(evOk<Music>("music", story).cached, false);
  edit(story, BASKET, LONGER_BASKET);
  assert.equal(evOk<Music>("music", story).cached, false);
});

test("music.file", () => {
  const dir = join(tmp, "mfile");
  mkdirSync(join(dir, "assets"), { recursive: true });
  ffmpeg(
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    join(dir, "assets/track.wav"),
  );
  const story = join(dir, "story.md");
  writeFileSync(
    story,
    [
      "---",
      "title: File",
      "music: { bpm: 120, beats_per_bar: 4, file: assets/track.wav, offset: 1 }",
      "---",
      "",
      "## Brief",
      "",
      "A test with a given track.",
      "",
      "## Scene 1 — Only",
      "",
      "Purpose.",
      "",
      "```yaml",
      "role: headline",
      "cuts:",
      "  - part: card",
      "    bars: 2",
      "    lines: [Track]",
      "```",
      "",
    ].join("\n"),
  );
  const report = evOk("render", story, "--preview");
  assert.equal(report.music.source, "file", JSON.stringify(report));
  assert.ok(!existsSync(join(dir, "build/music.wav")));
  const video = join(dir, "build/preview.mp4");
  assert.deepEqual(codecTypes(video), ["audio", "video"]);
  assert.ok(meanVolume(video) > -50);
  const gone = join(dir, "gone.md");
  edit(story, "assets/track.wav", "assets/gone.wav", gone);
  const missing = evFails("render", gone, "--preview");
  assert.equal(firstError(missing).code, "missing-file", JSON.stringify(missing));
});

test("no music renders a silent track", () => {
  const dir = join(tmp, "silent");
  storyWith(dir, "  - { id: only, part: card, bars: 1, lines: [Quiet] }");
  const report = evOk("render", join(dir, "story.md"), "--preview");
  assert.deepEqual(
    [report.music.source, warningCodes(report).filter((code) => code === "no-music")],
    ["none", ["no-music"]],
    JSON.stringify(report),
  );
  assert.deepEqual(codecTypes(join(dir, "build/preview.mp4")), ["audio", "video"]);
});

test("a music script without compose or using the clock fails", () => {
  const dir = join(tmp, "badmusic");
  const story = join(dir, "story.md");
  storyWith(dir, "  - { id: only, part: card, bars: 1, lines: [Quiet] }");
  writeFileSync(join(dir, "music.js"), "window.notCompose = 1;\n");
  const noCompose = evFails("render", story, "--preview");
  assert.equal(firstError(noCompose).code, "music-script", JSON.stringify(noCompose));
  writeFileSync(join(dir, "music.js"), "window.compose = async () => { Date.now(); };\n");
  const clock = evFails("render", story, "--preview");
  assert.equal(firstError(clock).code, "music-script", JSON.stringify(clock));
});

test("a second render is cached", () => {
  const report = evOk("render", STORY, "--preview");
  assert.deepEqual([report.rendered, report.cached.length], [[], 8], JSON.stringify(report));
});

test("render --force", () => {
  const report = evOk("render", STORY, "--preview", "--force");
  assert.equal(report.rendered.length, 8, JSON.stringify(report));
});

test("a telop edit renders one cut", () => {
  edit(STORY, '"Again."', '"Again!"');
  const report = evOk("render", STORY, "--preview");
  assert.deepEqual(report.rendered, ["question"], JSON.stringify(report));
});

test("edits render only the cuts they change", () => {
  edit(STORY, BASKET, LONGER_BASKET);
  const longer = evOk("render", STORY, "--preview");
  assert.deepEqual(longer.rendered, ["basket"], JSON.stringify(longer));
  edit(
    STORY,
    "    zoom: out\n    in: crossfade\n",
    "    zoom: out\n    in: { type: crossfade, duration: 1 }\n",
  );
  const crossfade = evOk("render", STORY, "--preview");
  assert.deepEqual(crossfade.rendered, ["basket"], JSON.stringify(crossfade));
});

test("pruning leaves only referenced files", () => {
  assert.equal(readdirSync(join(SAMPLE, "build/cuts/preview")).length, 8);
});

test("snapshot", () => {
  const report = evOk("snapshot", STORY, "--at", "peak+0.5");
  assert.equal(report.cut, "twenty", JSON.stringify(report));
  assert.deepEqual(pngSize(report.file), [1920, 1080]);
});

test("snapshot of the screen cut", () => {
  const report = evOk("snapshot", STORY, "--at", "order+2");
  assert.equal(report.cut, "order", JSON.stringify(report));
  assert.deepEqual(pngSize(report.file), [1920, 1080]);
});

test("a dropped-in image re-renders exactly its cut", () => {
  const story = join(MEDIA, "story.md");
  storyWith(
    MEDIA,
    [
      "  - { id: pic, part: image, bars: 1, src: assets/pic.png, prompt: A red picture, zoom: in }",
      "  - { id: clip, part: video, bars: 1, src: assets/clip.mp4, prompt: A test clip, start: 0.5 }",
    ].join("\n"),
  );
  const placeholders = evOk("render", story, "--preview");
  assert.deepEqual(placeholders.rendered, ["pic", "clip"], JSON.stringify(placeholders));
  ffmpeg(
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=640x360",
    "-frames:v",
    "1",
    join(MEDIA, "assets/pic.png"),
  );
  const image = evOk("render", story, "--preview");
  assert.deepEqual(image.rendered, ["pic"], JSON.stringify(image));
});

test("a video cut renders from a clip and its frames are kept", () => {
  const story = join(MEDIA, "story.md");
  ffmpeg(
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=d=2:s=320x240:r=30",
    "-pix_fmt",
    "yuv420p",
    join(MEDIA, "assets/clip.mp4"),
  );
  const report = evOk("render", story, "--preview");
  assert.deepEqual(report.rendered, ["clip"], JSON.stringify(report));
  const probed = probe(join(MEDIA, "build/preview.mp4"));
  assert.ok(
    Math.abs(Number(probed.format.duration) - report.duration) < 0.1,
    JSON.stringify(probed),
  );
  const frames = join(MEDIA, "build/video-frames");
  const before = mtimes(frames);
  assert.equal(before.length, 1);
  evOk("render", story, "--preview", "--force");
  assert.deepEqual(mtimes(frames), before);
});

test("an undecodable image fails with bad-image", () => {
  writeFileSync(join(MEDIA, "assets/pic.png"), "not a picture\n");
  const report = evFails("render", join(MEDIA, "story.md"), "--preview");
  const error = firstError(report);
  assert.deepEqual([error.code, error.cut], ["bad-image", "pic"], JSON.stringify(report));
});

test("a fragment's relative path resolves against the story", () => {
  const dir = join(tmp, "relpath");
  storyWith(dir, "  - { id: show, part: custom, bars: 1, src: assets/f.html }");
  ffmpeg(
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=640x360",
    "-frames:v",
    "1",
    join(dir, "assets/photo.png"),
  );
  writeFileSync(
    join(dir, "assets/f.html"),
    '<img src="assets/photo.png" style="position:absolute;inset:0;width:100%;height:100%">\n',
  );
  const report = evOk("snapshot", join(dir, "story.md"), "--at", "0.5", "--preview");
  const pixel = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      report.file,
      "-vf",
      "crop=1:1:480:270",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { env },
  );
  assert.equal(pixel.status, 0, pixel.stderr.toString());
  assert.equal(pixel.stdout.length, 3);
  const [r, g, b] = [0, 1, 2].map((offset) => pixel.stdout.readUInt8(offset));
  assert.ok(
    r !== undefined && g !== undefined && b !== undefined && r > 240 && g < 15 && b < 15,
    `the middle pixel is ${[...pixel.stdout].join(" ")}`,
  );
});

test("fragments that break the rules fail", () => {
  fragmentFails(
    "clock",
    "<div>x</div><script>setTimeout(function () {}, 10)</script>",
    "fragment-clock",
  );
  fragmentFails(
    "network",
    '<div>x</div><img src="http://example.invalid/a.png">',
    "fragment-network",
  );
  fragmentFails(
    "error",
    '<div>x</div><script>throw new Error("kaboom")</script>',
    "fragment-error",
  );
});

test("9:16 screen cut", () => {
  const dir = join(tmp, "tallscreen");
  storyWith(
    dir,
    [
      "  - id: app",
      "    part: screen",
      "    device: phone",
      "    bars: 1",
      "    html: '<div style=\"padding:40px;font-size:30px\">Hello</div>'",
    ].join("\n"),
    'output: { aspect: "9:16", fps: 30 }\n',
  );
  evOk("render", join(dir, "story.md"), "--preview");
  const probed = probe(join(dir, "build/preview.mp4"));
  const video = firstStream(probed);
  assert.deepEqual([video.width, video.height], [540, 960], JSON.stringify(probed));
});

test("9:16", () => {
  const dir = join(tmp, "tall");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "story.md"),
    [
      "---",
      "title: Tall",
      'output: { aspect: "9:16", fps: 30 }',
      "music: { bpm: 120, beats_per_bar: 4 }",
      "---",
      "",
      "## Brief",
      "",
      "A one-scene vertical test.",
      "",
      "## Scene 1 — Only",
      "",
      "Purpose.",
      "",
      "```yaml",
      "role: headline",
      "cuts:",
      "  - part: card",
      "    bars: 1",
      '    lines: [Tall, { text: "and narrow", style: small }]',
      "```",
      "",
    ].join("\n"),
  );
  evOk("render", join(dir, "story.md"), "--preview");
  const probed = probe(join(dir, "build/preview.mp4"));
  const video = firstStream(probed);
  assert.deepEqual([video.width, video.height], [540, 960], JSON.stringify(probed));
});

test("render rejects a bad story", () => {
  mkdirSync(BAD_RENDER, { recursive: true });
  edit(STORY, /^## Scene 2 /mu, "## Scene 7 ", join(BAD_RENDER, "story.md"));
  assert.equal(ev("render", join(BAD_RENDER, "story.md"), "--preview").code, 1);
  assert.ok(!existsSync(join(BAD_RENDER, "build/preview.mp4")));
});

test("frames on the sample", () => {
  const report = evOk("frames", STORY);
  const shown = JSON.stringify(report);
  assert.equal(report.ok, true, shown);
  assert.ok(
    report.frames.every(
      (frame) => statSync(frame.file, { throwIfNoEntry: false })?.isFile() === true,
    ),
    shown,
  );
  assert.deepEqual(
    [...new Set(report.frames.map((frame) => frame.scene))].toSorted((a, b) => a - b),
    [1, 2, 3, 4, 5],
    shown,
  );
  const times = report.frames.map((frame) => frame.t);
  assert.deepEqual(
    times,
    times.toSorted((a, b) => a - b),
    shown,
  );
  assert.ok(
    report.frames.some((frame) => frame.cut === "twenty" && frame.label === "mark-peak"),
    shown,
  );
  assert.deepEqual(
    [...new Set(report.frames.map((frame) => pngSize(frame.file).join("x")))],
    ["960x540"],
  );
  const index = join(SAMPLE, "build/review/index.json");
  assert.ok(existsSync(index));
  const listed: Report = JSON.parse(readFileSync(index, "utf8"));
  assert.equal(listed.frames.length, report.frames.length);
  const overflow = [
    "text-outside",
    "fragment-text-clipped",
    "telop-lines",
    "telop-overlap",
    "telop-covered",
  ];
  assert.deepEqual(
    warningCodes(report).filter((code) => overflow.includes(code)),
    [],
    shown,
  );
  const again = evOk("render", STORY, "--preview");
  assert.deepEqual(again.rendered, [], JSON.stringify(again));
});

test("frames reports overflow", () => {
  const long = "a long caption that goes on and on ".repeat(8);
  const overflowDir = join(tmp, "overflow");
  storyWith(
    overflowDir,
    [
      "  - part: card",
      "    bars: 2",
      "    lines: [Hello]",
      "    telops:",
      `      - { text: "${long}", at: 0, until: end }`,
    ].join("\n"),
  );
  const overflow = evOk("frames", join(overflowDir, "story.md"));
  assert.ok(warningCodes(overflow).includes("telop-lines"), JSON.stringify(overflow));
  const tooManyDir = join(tmp, "tooMany");
  storyWith(
    tooManyDir,
    [
      "  - part: card",
      "    bars: 2",
      "    stagger: 0",
      "    lines: [{ text: one, style: big }, { text: two, style: big }, { text: three, style: big }, { text: four, style: big }, { text: five, style: big }, { text: six, style: big }, { text: seven, style: big }, { text: eight, style: big }]",
    ].join("\n"),
  );
  const tooMany = evOk("frames", join(tooManyDir, "story.md"));
  assert.ok(warningCodes(tooMany).includes("text-outside"), JSON.stringify(tooMany));
});

test("frames reads fragment text, CSS content and shapes", () => {
  frameFinds(
    "words",
    '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12vmin">Fragment words here</div>',
    "telop-overlap",
  );
  frameFinds(
    "content",
    '<style>#fragment .n::before { content: "123456789012"; font-size: 40vmin; }</style><span class="n" style="position:absolute;left:40%;top:10%"></span>',
    "fragment-text-clipped",
  );
  frameFinds(
    "ring",
    '<div style="position:absolute;left:50%;bottom:2vmin;width:30vmin;height:30vmin;margin-left:-15vmin;border:1.2vmin solid #f2a33a;border-radius:50%"></div>',
    "telop-covered",
    "bottom",
  );
});

test("an empty CSS content adds no text", () => {
  const dir = join(tmp, "decor");
  storyWith(
    dir,
    [
      "  - part: custom",
      "    bars: 2",
      "    src: assets/f.html",
      "    telops:",
      "      - { text: Caption, at: 0, until: end, position: bottom }",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "assets/f.html"),
    '<style>#fragment .h { position:absolute; left:0; right:0; top:40%; height:58%; text-align:center; font-size:6vmin } #fragment .h::after { content: "" }</style><div class="h">Short</div>\n',
  );
  const report = evOk("frames", join(dir, "story.md"));
  assert.deepEqual(
    warningCodes(report).filter((code) => code !== "no-peak"),
    [],
    JSON.stringify(report),
  );
});

test("frames leaves no stale file", () => {
  const dir = join(tmp, "stale");
  const story = join(dir, "story.md");
  storyWith(
    dir,
    [
      "  - part: card",
      "    bars: 2",
      "    lines: [Hello]",
      "    telops:",
      "      - { text: Caption, at: 0, until: end }",
    ].join("\n"),
  );
  evOk("frames", story);
  storyWith(dir, ["  - part: card", "    bars: 2", "    lines: [Hello]"].join("\n"));
  const report = evOk("frames", story);
  const pngs = readdirSync(join(dir, "build/review"), { encoding: "utf8", recursive: true }).filter(
    (name) => name.endsWith(".png"),
  );
  assert.equal(pngs.length, report.frames.length);
});

test("frames rejects a bad story", () => {
  assert.equal(ev("frames", join(BAD_RENDER, "story.md")).code, 1);
  assert.ok(!existsSync(join(BAD_RENDER, "build/review")));
});

test("clean", () => {
  evOk("clean", STORY);
  assert.ok(!existsSync(join(SAMPLE, "build")));
  assert.ok(existsSync(STORY));
});
