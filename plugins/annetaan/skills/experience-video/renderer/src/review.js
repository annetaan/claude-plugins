// The frame check: which moments of a cut to look at, what to measure there, and what the measurements say.
// No browser in this file; measure() is the one function that runs inside a page.

export const TELOP_LEAD_SECONDS = 0.5; // a telop is looked at this long after it appears, or halfway when it is shorter
export const MARK_LEAD_SECONDS = 0.25; // a mark or the peak is looked at this long after it
export const END_BEFORE_SECONDS = 0.05; // the cut's last frame is looked at this long before its end
export const MERGE_SECONDS = 0.2; // frames closer than this are one frame
export const MAX_FRAMES_PER_CUT = 6;
export const SAFE_MARGIN = 0.03; // of the stage's shorter side
export const MAX_TELOP_LINES = 2;
export const MIN_OPACITY = 0.05; // text fainter than this is not there
export const CROSS_PIXELS = 1; // a rectangle has to leave its box by more than this to count as crossing
export const MIN_PAINT_ALPHA = 0.05; // a colour fainter than this paints nothing
export const MEASURE_ARG = { minPaintAlpha: MIN_PAINT_ALPHA }; // what measure() needs from outside the page
const EPS = 1e-6;

const round = (x) => Math.round(x * 1e6) / 1e6;

// keyTimes(cut, { peak }) -> [{ t, label }], cut-relative and sorted by t. peak is the story's peak in
// cut-relative seconds when it falls inside this cut, else null.
export function keyTimes(cut, { peak = null } = {}) {
  const d = cut.duration;
  const cap = (t) => round(Math.min(Math.max(t, 0), d));
  // In the order that survives a cut to MAX_FRAMES_PER_CUT: the end, marks and the peak, then telops in order.
  const wanted = [{ t: cap(d - END_BEFORE_SECONDS), label: 'end' }];
  for (const [name, at] of Object.entries(cut.marks ?? {})) wanted.push({ t: cap(at + MARK_LEAD_SECONDS), label: `mark-${name}` });
  if (peak !== null && !Object.prototype.hasOwnProperty.call(cut.marks ?? {}, 'peak')) wanted.push({ t: cap(peak + MARK_LEAD_SECONDS), label: 'peak' });
  (cut.telops ?? []).forEach((t, i) => wanted.push({ t: cap(t.at + Math.min(TELOP_LEAD_SECONDS, (t.until - t.at) / 2)), label: `telop${i + 1}` }));
  if ((cut.telops ?? []).length === 0 && Object.keys(cut.marks ?? {}).length === 0) wanted.push({ t: cap(d / 2), label: 'mid' });

  const merged = [];
  for (const w of [...wanted].sort((a, b) => a.t - b.t)) {
    const last = merged[merged.length - 1];
    if (last && w.t - last.t < MERGE_SECONDS - EPS) {
      last.members.push(w);
    } else merged.push({ t: w.t, label: w.label, members: [w] });
  }
  // A merged frame ranks as its best member.
  const rank = (m) => Math.min(...m.members.map((w) => wanted.indexOf(w)));
  const kept = [...merged].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_FRAMES_PER_CUT);
  return kept.sort((a, b) => a.t - b.t).map(({ t, label }) => ({ t, label }));
}

// Runs inside the page, passed to page.evaluate: no closure, no clock. Reads the rectangles of what the page
// runtime built (.telop, .line, .placeholder .prompt, #fragment) and returns plain data.
export function measure({ minPaintAlpha }) {
  const stage = document.getElementById('stage');
  const stageRect = stage.getBoundingClientRect();
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const stageBox = box(stageRect);
  const opacityOf = (node) => {
    let o = 1;
    for (let e = node; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  // The text of a node as the range sees it: its bounding rectangle, after transforms, and its number of lines.
  const textOf = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) return null;
    const tops = rects.map((r) => ({ top: r.top, height: r.height })).sort((a, b) => a.top - b.top);
    let lines = 0;
    let lineTop = -Infinity;
    for (const r of tops) {
      if (r.top >= lineTop + r.height * 0.5) {
        lines += 1;
        lineTop = r.top;
      }
    }
    return { rect: box(range.getBoundingClientRect()), lines };
  };
  const cut40 = (s) => Array.from(s.replace(/\s+/g, ' ').trim()).slice(0, 40).join('');
  const items = [];
  const add = (kind, el, text, container, opacityNode) => {
    const m = textOf(el);
    if (!m || text.trim() === '') return;
    items.push({ kind, text: cut40(text), rect: m.rect, lines: m.lines, opacity: opacityOf(opacityNode), container });
  };
  document.querySelectorAll('.telop').forEach((el) => add('telop', el, el.textContent, stageBox, el));
  document.querySelectorAll('.line').forEach((el) => add('line', el, el.textContent, stageBox, el));
  document.querySelectorAll('.placeholder .prompt').forEach((el) => add('prompt', el, el.textContent, stageBox, el));
  const fragment = document.getElementById('fragment');
  if (fragment) {
    const container = box(fragment.getBoundingClientRect());
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.closest('script, style, noscript')) continue;
      add('fragment-text', n, n.textContent, container, parent);
    }
    const alphaOf = (c) => {
      if (!c || c === 'transparent') return 0;
      const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(c) || /\/\s*([\d.]+%?)\s*\)$/.exec(c);
      if (!m) return 1;
      return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    };
    const paintedBy = (el, style) => {
      if (['SVG', 'IMG', 'CANVAS', 'VIDEO'].includes(el.tagName.toUpperCase())) return true;
      if (alphaOf(style.backgroundColor) > minPaintAlpha || style.backgroundImage !== 'none') return true;
      return ['Top', 'Right', 'Bottom', 'Left'].some(
        (s) => parseFloat(style[`border${s}Width`]) > 0 && style[`border${s}Style`] !== 'none' && alphaOf(style[`border${s}Color`]) > minPaintAlpha,
      );
    };
    fragment.querySelectorAll('*').forEach((el) => {
      if (el.closest('script, style, noscript') || (el.closest('svg') && el.closest('svg') !== el)) return;
      const style = getComputedStyle(el);
      // Text drawn by CSS content is not a text node: measure it as the element's own box.
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(el, pseudo).content;
        if (content === 'none' || content === 'normal' || content.startsWith('url(')) continue;
        const quoted = content.startsWith('"') || content.startsWith("'");
        // A quoted string says its own text; "" is a decoration and adds none (the walker has the element's own text).
        // A counter or attr() has no text to read here, so the element's own text, else the value, stands for it.
        const text = quoted ? content.slice(1, -1) : el.textContent.trim() || content;
        if (text.trim() === '') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const lineTops = new Set(Array.from(el.getClientRects()).map((c) => Math.round(c.top)));
        items.push({ kind: 'fragment-text', text: cut40(text), rect: box(r), lines: lineTops.size, opacity: opacityOf(el), container });
      }
      if (!paintedBy(el, style)) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const name = `<${el.tagName.toLowerCase()}${el.classList.length ? `.${el.classList[0]}` : ''}>`;
      items.push({ kind: 'painted', text: name, rect: box(r), lines: 1, opacity: opacityOf(el), container });
    });
  }
  return { stage: { width: stageRect.width, height: stageRect.height }, items };
}

const w = (code, scene, cut, message, text) => ({ code, scene: scene.index, cut: cut.id, message, text });

const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const inside = (r, b) => area(r, b) > 0;
// Partly inside and partly outside the box, by more than CROSS_PIXELS. Wholly outside (waiting off stage) is not crossing.
const crosses = (r, b) =>
  inside(r, b) && (r.left < b.left - CROSS_PIXELS || r.right > b.right + CROSS_PIXELS || r.top < b.top - CROSS_PIXELS || r.bottom > b.bottom + CROSS_PIXELS);
// Touching or overlapping by less than a pixel is not an intersection.
const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > CROSS_PIXELS && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > CROSS_PIXELS;

const contains = (outer, r) => r.left >= outer.left - CROSS_PIXELS && r.right <= outer.right + CROSS_PIXELS && r.top >= outer.top - CROSS_PIXELS && r.bottom <= outer.bottom + CROSS_PIXELS;

// judge(measured, { cut, scene }) -> warnings { code, scene, cut, message, text } for one frame.
export function judge(measured, { cut, scene }) {
  const { stage } = measured;
  const margin = Math.min(stage.width, stage.height) * SAFE_MARGIN;
  const safe = { left: margin, top: margin, right: stage.width - margin, bottom: stage.height - margin };
  const items = measured.items.filter((i) => i.opacity > MIN_OPACITY);
  const out = [];
  for (const i of items) {
    if (i.kind === 'fragment-text') {
      if (crosses(i.rect, i.container)) out.push(w('fragment-text-clipped', scene, cut, `cut ${cut.id}: the text "${i.text}" is cut by the edge of the screen it sits in`, i.text));
    } else if (i.kind !== 'painted' && crosses(i.rect, safe)) {
      out.push(w('text-outside', scene, cut, `cut ${cut.id}: the ${i.kind} "${i.text}" crosses the edge of the safe area`, i.text));
    }
    if (i.kind === 'telop' && i.lines > MAX_TELOP_LINES) {
      out.push(w('telop-lines', scene, cut, `cut ${cut.id}: the telop "${i.text}" runs to ${i.lines} lines; ${MAX_TELOP_LINES} is the most`, i.text));
    }
  }
  const telops = items.filter((i) => i.kind === 'telop');
  const others = items.filter((i) => i.kind === 'line' || i.kind === 'prompt' || i.kind === 'fragment-text');
  const painted = items.filter((i) => i.kind === 'painted');
  telops.forEach((a, k) => {
    for (const b of [...telops.slice(k + 1), ...others]) {
      if (intersects(a.rect, b.rect)) out.push(w('telop-overlap', scene, cut, `cut ${cut.id}: the telop "${a.text}" overlaps the ${b.kind} "${b.text}"`, `${a.text} | ${b.text}`));
    }
    // A shape whose edge runs through the text spoils it; one that holds the whole telop is a plate.
    for (const b of painted) {
      if (intersects(a.rect, b.rect) && !contains(b.rect, a.rect)) {
        out.push(w('telop-covered', scene, cut, `cut ${cut.id}: the fragment's ${b.text} is drawn across the telop "${a.text}"`, `${a.text} | ${b.text}`));
      }
    }
  });
  return out;
}

// Drops a warning whose code, cut and text already appeared earlier in the list. Keeps the order.
export function mergeWarnings(list) {
  const seen = new Set();
  return list.filter((x) => {
    const key = JSON.stringify([x.code, x.cut, x.text]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
