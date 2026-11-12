// Parse story.md, validate it, resolve it into a timeline, and write build/timeline.json.
import fs from 'node:fs';
import path from 'node:path';
import { resolveTimeExpr, TimeError } from './time.js';
import { lintStory } from './lint.js';

export class StoryError extends Error {
  constructor(findings) {
    super(findings.map((x) => x.message).join('; '));
    this.findings = findings;
  }
}

const finding = (code, message, scene = null, cut = null) => ({ code, scene, cut, message });

export const ROLES = ['pain', 'encounter', 'peak', 'everyday', 'headline', 'points', 'one-more-thing'];
export const TYPES = ['concept', 'pitch', 'team'];
export const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
const POSITIONS = ['top', 'center', 'bottom'];
const TELOP_STYLES = ['caption', 'title', 'headline'];
const TRANSITION_TYPES_IN = ['none', 'fade', 'crossfade'];
const TRANSITION_TYPES_OUT = ['none', 'fade'];
const DEFAULT_TRANSITION_SECONDS = 0.5;
const NAME_RE = /^[A-Za-z_]\w*$/;
const RESERVED = ['start', 'end'];

const COMMON_CUT_FIELDS = ['id', 'part', 'bars', 'duration', 'marks', 'in', 'out', 'telops'];
const PART_FIELDS = {
  card: ['lines', 'stagger', 'align', 'background'],
  image: ['src', 'prompt', 'fit', 'zoom', 'focus'],
  video: ['src', 'prompt', 'start', 'fit'],
  screen: ['device', 'html', 'src'],
  custom: ['html', 'src'],
};

const round = (x) => Math.round(x * 1e6) / 1e6;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isTime = (v) => isNum(v) || (typeof v === 'string' && v.trim() !== '');

// ---------------------------------------------------------------------------------------------------------------
// Parsing

const SCENE_HEADING_RE = /^Scene\s+(\d+)\s*[—:-]\s*(.+)$/;

function splitFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { front: null, body: text };
  return { front: m[1], body: text.slice(m[0].length) };
}

// Splits the body into scene sections. Headings and yaml blocks inside other fences are not looked at.
function splitScenes(body, errors) {
  const scenes = [];
  let current = null; // the scene section being read, or null in the brief or any other section
  let fence = null; // { info, lines } while inside a fenced block
  let order = 0;
  for (const line of body.split('\n')) {
    if (fence) {
      if (/^```\s*$/.test(line)) {
        if (current && /^ya?ml$/i.test(fence.info)) current.blocks.push(fence.lines.join('\n'));
        fence = null;
      } else {
        fence.lines.push(line);
      }
      if (current) current.prose.push(line);
      continue;
    }
    const open = /^```\s*([\w-]*)\s*$/.exec(line);
    if (open) {
      fence = { info: open[1], lines: [] };
      if (current) current.prose.push(line);
      continue;
    }
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) {
      const sm = SCENE_HEADING_RE.exec(h[1]);
      if (sm) {
        order += 1;
        current = { n: Number(sm[1]), name: sm[2].trim(), position: order, blocks: [], prose: [] };
        scenes.push(current);
        if (current.n !== order) {
          errors.push(finding('scene-number', `heading "Scene ${current.n}" is at position ${order}; the numbers count from 1 in order`, order));
        }
      } else {
        if (/^Scene\b/i.test(h[1])) {
          errors.push(finding('scene-heading', `cannot read the heading "## ${h[1]}"; write "## Scene N — name"`));
        }
        current = null;
      }
      continue;
    }
    if (current) current.prose.push(line);
  }
  return scenes;
}

function unknownKeys(obj, allowed, where, scene, cut, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(finding('unknown-field', `unknown field "${k}" in ${where}`, scene, cut));
  }
}

function checkEnum(value, list, what, scene, cut, errors) {
  if (value !== undefined && !list.includes(value)) {
    errors.push(finding('bad-value', `${what} must be one of ${list.join(', ')}; got ${JSON.stringify(value)}`, scene, cut));
  }
}

function checkTransition(v, types, what, scene, cut, errors) {
  if (v === undefined) return;
  if (typeof v === 'string') return checkEnum(v, types, what, scene, cut, errors);
  if (!isObj(v)) return errors.push(finding('bad-value', `${what} must be a name or { type, duration }`, scene, cut));
  unknownKeys(v, ['type', 'duration'], what, scene, cut, errors);
  checkEnum(v.type, types, `${what}.type`, scene, cut, errors);
  if (v.duration !== undefined && !isTime(v.duration)) {
    errors.push(finding('bad-value', `${what}.duration must be a time expression`, scene, cut));
  }
}

function validateFrontmatter(raw, yaml, errors) {
  let fm = {};
  if (raw !== null) {
    try {
      fm = yaml.parse(raw) ?? {};
    } catch (e) {
      errors.push(finding('yaml-syntax', `frontmatter is not valid YAML: ${String(e.message).split('\n')[0]}`));
      return null;
    }
  }
  if (!isObj(fm)) {
    errors.push(finding('frontmatter', 'frontmatter must be a YAML mapping'));
    return null;
  }
  unknownKeys(fm, ['title', 'language', 'type', 'output', 'music', 'theme', 'narration'], 'the frontmatter', null, null, errors);
  if (typeof fm.title !== 'string' || fm.title.trim() === '') {
    errors.push(finding('frontmatter', 'frontmatter needs a title'));
  }
  checkEnum(fm.type, TYPES, 'type', null, null, errors);
  const out = fm.output ?? {};
  const music = fm.music ?? {};
  const theme = fm.theme ?? {};
  const narration = fm.narration ?? {};
  for (const [name, v] of [['output', out], ['music', music], ['theme', theme], ['narration', narration]]) {
    if (!isObj(v)) errors.push(finding('frontmatter', `${name} must be a mapping`));
  }
  if (![out, music, theme, narration].every(isObj)) return null;
  unknownKeys(out, ['aspect', 'fps'], 'output', null, null, errors);
  unknownKeys(music, ['bpm', 'beats_per_bar', 'file', 'offset', 'volume', 'fade_out'], 'music', null, null, errors);
  unknownKeys(theme, ['background', 'foreground', 'accent', 'font'], 'theme', null, null, errors);
  unknownKeys(narration, ['voice', 'rate'], 'narration', null, null, errors);
  const aspect = out.aspect ?? '16:9';
  if (!ASPECTS[aspect]) errors.push(finding('bad-value', `output.aspect must be one of ${Object.keys(ASPECTS).join(', ')}`));
  const fps = out.fps ?? 30;
  if (!isNum(fps) || fps <= 0) errors.push(finding('bad-value', 'output.fps must be a positive number'));
  const bpm = music.bpm ?? 100;
  if (!isNum(bpm) || bpm <= 0) errors.push(finding('bad-value', 'music.bpm must be a positive number'));
  const bpb = music.beats_per_bar ?? 4;
  if (!Number.isInteger(bpb) || bpb <= 0) errors.push(finding('bad-value', 'music.beats_per_bar must be a positive integer'));
  for (const k of ['offset', 'volume', 'fade_out']) {
    if (music[k] !== undefined && !isNum(music[k])) errors.push(finding('bad-value', `music.${k} must be a number`));
  }
  if (music.file !== undefined && typeof music.file !== 'string') errors.push(finding('bad-value', 'music.file must be a path'));
  const [width, height] = ASPECTS[aspect] ?? ASPECTS['16:9'];
  return {
    title: fm.title,
    language: typeof fm.language === 'string' ? fm.language : 'en',
    type: fm.type ?? null,
    aspect,
    width,
    height,
    fps,
    bpm,
    beatsPerBar: bpb,
    music: { file: music.file ?? null, offset: music.offset ?? 0, volume: music.volume ?? 0.8, fadeOut: music.fade_out ?? 1.5 },
    theme,
    narration,
  };
}

function validateTelops(telops, scene, cutId, errors) {
  if (telops === undefined) return;
  if (!Array.isArray(telops)) return errors.push(finding('bad-value', 'telops must be a list', scene, cutId));
  telops.forEach((t, i) => {
    if (!isObj(t)) return errors.push(finding('bad-value', `telop ${i + 1} must be a mapping`, scene, cutId));
    unknownKeys(t, ['text', 'at', 'until', 'for', 'position', 'style'], `telop ${i + 1}`, scene, cutId, errors);
    if (typeof t.text !== 'string' || t.text === '') errors.push(finding('bad-value', `telop ${i + 1} needs text`, scene, cutId));
    for (const k of ['at', 'until', 'for']) {
      if (t[k] !== undefined && !isTime(t[k])) errors.push(finding('bad-value', `telop ${i + 1}: ${k} must be a time expression`, scene, cutId));
    }
    if (t.until !== undefined && t.for !== undefined) errors.push(finding('bad-value', `telop ${i + 1} has both until and for`, scene, cutId));
    checkEnum(t.position, POSITIONS, `telop ${i + 1} position`, scene, cutId, errors);
    checkEnum(t.style, TELOP_STYLES, `telop ${i + 1} style`, scene, cutId, errors);
  });
}

function validatePart(cut, scene, cutId, errors) {
  const e = (msg) => errors.push(finding('bad-value', msg, scene, cutId));
  switch (cut.part) {
    case 'card': {
      if (!Array.isArray(cut.lines) || cut.lines.length === 0) return e('a card needs lines');
      cut.lines.forEach((l, i) => {
        if (typeof l === 'string') return;
        if (!isObj(l)) return e(`card line ${i + 1} must be a string or a mapping`);
        unknownKeys(l, ['text', 'style', 'count'], `card line ${i + 1}`, scene, cutId, errors);
        if (typeof l.text !== 'string') e(`card line ${i + 1} needs text`);
        checkEnum(l.style, ['big', 'small', 'accent'], `card line ${i + 1} style`, scene, cutId, errors);
        if (l.count !== undefined) {
          if (!isObj(l.count)) return e(`card line ${i + 1}: count must be a mapping`);
          unknownKeys(l.count, ['from', 'to', 'duration', 'decimals'], `card line ${i + 1} count`, scene, cutId, errors);
          if (!isNum(l.count.from) || !isNum(l.count.to)) e(`card line ${i + 1}: count needs numeric from and to`);
          if (l.count.duration !== undefined && !isTime(l.count.duration)) e(`card line ${i + 1}: count.duration must be a time expression`);
          if (typeof l.text === 'string' && !l.text.includes('{n}')) e(`card line ${i + 1}: a counted line needs {n} in its text`);
        }
      });
      if (cut.stagger !== undefined && !isTime(cut.stagger)) e('stagger must be a time expression');
      checkEnum(cut.align, ['left', 'center', 'right'], 'align', scene, cutId, errors);
      if (cut.background !== undefined && typeof cut.background !== 'string') e('background must be a CSS colour string');
      break;
    }
    case 'image':
      checkEnum(cut.fit, ['cover', 'contain'], 'fit', scene, cutId, errors);
      checkEnum(cut.zoom, ['in', 'out', 'none'], 'zoom', scene, cutId, errors);
      break;
    case 'video':
      checkEnum(cut.fit, ['cover', 'contain'], 'fit', scene, cutId, errors);
      if (cut.start !== undefined && !isTime(cut.start)) e('start must be a time expression');
      break;
    case 'screen':
    case 'custom':
      if (cut.part === 'screen') checkEnum(cut.device, ['phone', 'laptop'], 'device', scene, cutId, errors);
      if ((cut.html === undefined) === (cut.src === undefined)) e(`a ${cut.part} cut needs exactly one of html and src`);
      break;
  }
  for (const k of ['src', 'prompt', 'focus', 'html']) {
    if (cut[k] !== undefined && typeof cut[k] !== 'string') e(`${k} must be a string`);
  }
}

function validateScene(data, n, errors) {
  if (!isObj(data)) return errors.push(finding('bad-value', 'the yaml block must be a mapping', n));
  unknownKeys(data, ['role', 'narration', 'cuts'], 'the scene block', n, null, errors);
  checkEnum(data.role, ROLES, 'role', n, null, errors);
  const nar = data.narration;
  if (nar !== undefined && typeof nar !== 'string') {
    if (!isObj(nar) || typeof nar.text !== 'string') {
      errors.push(finding('bad-value', 'narration must be a string or { text, at, voice }', n));
    } else {
      unknownKeys(nar, ['text', 'at', 'voice'], 'narration', n, null, errors);
      if (nar.at !== undefined && !isTime(nar.at)) errors.push(finding('bad-value', 'narration.at must be a time expression', n));
      if (nar.voice !== undefined && typeof nar.voice !== 'string') errors.push(finding('bad-value', 'narration.voice must be a string', n));
    }
  }
  if (!Array.isArray(data.cuts) || data.cuts.length === 0) {
    return errors.push(finding('no-cuts', 'a scene needs at least one cut', n));
  }
  data.cuts.forEach((cut, i) => {
    const label = isObj(cut) && typeof cut.id === 'string' ? cut.id : `s${n}c${i + 1}`;
    if (!isObj(cut)) return errors.push(finding('bad-value', `cut ${i + 1} must be a mapping`, n));
    if (!PART_FIELDS[cut.part]) {
      return errors.push(finding('unknown-part', `cut ${i + 1} has part ${JSON.stringify(cut.part)}; use one of ${Object.keys(PART_FIELDS).join(', ')}`, n, label));
    }
    unknownKeys(cut, [...COMMON_CUT_FIELDS, ...PART_FIELDS[cut.part]], `cut ${label} (${cut.part})`, n, label, errors);
    if (cut.id !== undefined && (typeof cut.id !== 'string' || !NAME_RE.test(cut.id) || RESERVED.includes(cut.id))) {
      errors.push(finding('bad-id', `cut id ${JSON.stringify(cut.id)} must be a plain name (letters, digits, _) and not start or end`, n, label));
    }
    if ((cut.bars === undefined) === (cut.duration === undefined)) {
      errors.push(finding('bars-or-duration', 'a cut needs exactly one of bars and duration', n, label));
    } else {
      const v = cut.bars ?? cut.duration;
      if (!isNum(v) || v <= 0) errors.push(finding('bad-value', 'bars and duration must be positive numbers', n, label));
    }
    if (cut.marks !== undefined) {
      if (!isObj(cut.marks)) errors.push(finding('bad-value', 'marks must be a mapping of name: time', n, label));
      else {
        for (const [name, expr] of Object.entries(cut.marks)) {
          if (!NAME_RE.test(name) || RESERVED.includes(name)) errors.push(finding('bad-id', `mark name ${JSON.stringify(name)} must be a plain name and not start or end`, n, label));
          if (!isTime(expr)) errors.push(finding('bad-value', `mark ${name} must be a time expression`, n, label));
        }
      }
    }
    checkTransition(cut.in, TRANSITION_TYPES_IN, 'in', n, label, errors);
    checkTransition(cut.out, TRANSITION_TYPES_OUT, 'out', n, label, errors);
    validateTelops(cut.telops, n, label, errors);
    validatePart(cut, n, label, errors);
  });
}

// parseStory(text, { yaml }) -> { meta, scenes: [{ index, name, prose, data }] }. Throws StoryError.
export function parseStory(text, { yaml }) {
  const errors = [];
  const { front, body } = splitFrontmatter(text.replace(/\r\n?/g, '\n'));
  const meta = validateFrontmatter(front, yaml, errors);
  const sections = splitScenes(body, errors);
  if (sections.length === 0) errors.push(finding('no-scenes', 'the story has no "## Scene N — name" section'));
  const scenes = [];
  for (const s of sections) {
    if (s.blocks.length !== 1) {
      errors.push(finding('scene-yaml', `Scene ${s.position} has ${s.blocks.length} yaml blocks; it needs exactly one`, s.position));
      continue;
    }
    let data;
    try {
      data = yaml.parse(s.blocks[0]);
    } catch (e) {
      errors.push(finding('yaml-syntax', `Scene ${s.position}: the yaml block is not valid YAML: ${String(e.message).split('\n')[0]}`, s.position));
      continue;
    }
    validateScene(data, s.position, errors);
    scenes.push({ index: s.position, name: s.name, prose: s.prose.join('\n').trim(), data });
  }
  if (errors.length > 0) throw new StoryError(errors);
  return { meta, scenes };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolving

function transition(v, defaultType, ctx, fail) {
  const spec = typeof v === 'string' ? { type: v } : (v ?? {});
  const type = spec.type ?? defaultType;
  let duration = 0;
  if (type !== 'none') {
    duration = spec.duration === undefined ? DEFAULT_TRANSITION_SECONDS : fail(() => resolveTimeExpr(spec.duration, ctx), DEFAULT_TRANSITION_SECONDS);
  }
  return { type, duration: round(Math.max(0, duration)) };
}

// resolveStory(parsed, { storyDir }) -> timeline. Throws StoryError.
export function resolveStory(parsed, { storyDir = '.' } = {}) {
  const { meta } = parsed;
  const errors = [];
  const beat = 60 / meta.bpm;
  const bar = beat * meta.beatsPerBar;
  const marks = {}; // name -> absolute seconds, in definition order
  const cutIds = new Set();
  const scenes = [];
  let cursor = 0;
  let prevCut = null;

  for (const sc of parsed.scenes) {
    const sceneStart = cursor;
    const cuts = [];
    sc.data.cuts.forEach((c, i) => {
      const written = c.id !== undefined;
      const id = written ? c.id : `s${sc.index}c${i + 1}`;
      const fail = (fn, fallback) => {
        try {
          return fn();
        } catch (e) {
          if (!(e instanceof TimeError)) throw e;
          errors.push(finding(e.code, `${e.message}`, sc.index, id));
          return fallback;
        }
      };
      if (cutIds.has(id)) errors.push(finding('duplicate-id', `cut id "${id}" is used twice`, sc.index, id));
      cutIds.add(id);
      const dur = round(c.bars !== undefined ? c.bars * bar : c.duration);
      const start = round(cursor);
      const end = round(start + dur);
      cursor = end;
      const defineMark = (name, abs) => {
        if (Object.prototype.hasOwnProperty.call(marks, name)) {
          errors.push(finding('duplicate-mark', `mark "${name}" is defined twice`, sc.index, id));
        } else {
          marks[name] = round(abs);
        }
      };
      if (written) defineMark(id, start);
      const ctx = () => ({ beat, bar, marks, cutStart: start, cutDuration: dur });
      const ownMarks = {};
      for (const [name, expr] of Object.entries(c.marks ?? {})) {
        const rel = fail(() => resolveTimeExpr(expr, ctx()), null);
        if (rel === null) continue;
        ownMarks[name] = round(rel);
        defineMark(name, start + rel);
      }
      const telops = (c.telops ?? []).map((t) => {
        const at = t.at === undefined ? 0 : fail(() => resolveTimeExpr(t.at, ctx()), 0);
        let until = dur;
        if (t.until !== undefined) until = fail(() => resolveTimeExpr(t.until, ctx()), dur);
        else if (t.for !== undefined) until = at + fail(() => resolveTimeExpr(t.for, ctx()), 0);
        return { text: t.text, at: round(at), until: round(until), position: t.position ?? 'bottom', style: t.style ?? 'caption' };
      });
      const inT = transition(c.in, 'none', ctx(), fail);
      const outT = transition(c.out, 'none', ctx(), fail);
      if (prevCut) prevCut.tail = inT.type === 'crossfade' ? inT.duration : 0;

      const props = {};
      for (const k of PART_FIELDS[c.part]) if (c[k] !== undefined) props[k] = c[k];
      const refs = [];
      if (typeof props.src === 'string') {
        const abs = path.resolve(storyDir, props.src);
        const rel = path.relative(path.resolve(storyDir), abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          errors.push(finding('src-outside', `src "${props.src}" has to stay inside the story's directory`, sc.index, id));
        } else {
          refs.push(rel);
          if ((c.part === 'screen' || c.part === 'custom') && !fs.existsSync(abs)) {
            errors.push(finding('missing-file', `src "${props.src}" does not exist`, sc.index, id));
          }
        }
      }
      const cut = { id, part: c.part, start, end, tail: 0, duration: dur, in: inT, out: outT, marks: ownMarks, telops, props, refs };
      cuts.push(cut);
      prevCut = cut;
    });

    const sceneEnd = cursor;
    let narration = null;
    if (sc.data.narration !== undefined) {
      const n = typeof sc.data.narration === 'string' ? { text: sc.data.narration } : sc.data.narration;
      let at = 0;
      if (n.at !== undefined) {
        try {
          at = resolveTimeExpr(n.at, { beat, bar, marks, cutStart: sceneStart, cutDuration: sceneEnd - sceneStart });
        } catch (e) {
          if (!(e instanceof TimeError)) throw e;
          errors.push(finding(e.code, e.message, sc.index));
        }
      }
      narration = { text: n.text, at: round(sceneStart + at), voice: n.voice ?? null };
    }
    scenes.push({
      index: sc.index,
      name: sc.name,
      role: sc.data.role ?? null,
      start: round(sceneStart),
      end: round(sceneEnd),
      startBar: round(sceneStart / bar),
      bars: round((sceneEnd - sceneStart) / bar),
      narration,
      cuts,
    });
  }
  if (errors.length > 0) throw new StoryError(errors);

  const peakScene = scenes.find((s) => s.role === 'peak');
  let peak = null;
  if (Object.prototype.hasOwnProperty.call(marks, 'peak')) peak = marks.peak;
  else if (peakScene) peak = peakScene.start;
  return {
    title: meta.title,
    language: meta.language,
    type: meta.type,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    bpm: meta.bpm,
    beatsPerBar: meta.beatsPerBar,
    beat: round(beat),
    bar: round(bar),
    duration: round(cursor),
    peak,
    marks,
    music: meta.music,
    theme: meta.theme,
    narration: meta.narration,
    scenes,
  };
}

// loadStory(file, deps, { say }) -> { timeline, errors, warnings }. Writes build/timeline.json when the story resolves.
export function loadStory(file, deps, { say = true } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { timeline: null, errors: [finding('no-story', `cannot read ${file}: ${e.code ?? e.message}`)], warnings: [] };
  }
  const storyDir = path.dirname(path.resolve(file));
  let timeline = null;
  const errors = [];
  let warnings = [];
  try {
    timeline = resolveStory(parseStory(text, deps), { storyDir });
  } catch (e) {
    if (!(e instanceof StoryError)) throw e;
    errors.push(...e.findings);
  }
  if (timeline) {
    const lint = lintStory(timeline, { say });
    errors.push(...lint.errors);
    warnings = lint.warnings;
    const buildDir = path.join(storyDir, 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  }
  return { timeline, errors, warnings };
}
