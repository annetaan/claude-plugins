// Time expressions: `term (('+'|'-') term)*`.
// A term is a number with an optional unit (s, beat, beats, bar, bars; bare means seconds), `start`, `end`, or a mark name.

const EPS = 1e-6;
const TERM_RE = /\s*([+-])?\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*(beats?|bars?|s)?(?![A-Za-z0-9_])|([A-Za-z_]\w*))/y;

export class TimeError extends Error {
  constructor(message, code = 'time-expr') {
    super(message);
    this.code = code;
  }
}

// parseTimeExpr(expr) -> [{sign, kind: 'num', value, unit} | {sign, kind: 'start' | 'end'} | {sign, kind: 'mark', name}]
export function parseTimeExpr(expr) {
  const src = typeof expr === 'number' ? String(expr) : expr;
  if (typeof src !== 'string' || src.trim() === '') {
    throw new TimeError(`empty time expression: ${JSON.stringify(expr)}`);
  }
  const terms = [];
  TERM_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length && src.slice(pos).trim() !== '') {
    TERM_RE.lastIndex = pos;
    const m = TERM_RE.exec(src);
    if (!m) throw new TimeError(`cannot read time expression "${src}" at "${src.slice(pos).trim()}"`);
    if (terms.length > 0 && !m[1]) throw new TimeError(`missing + or - in time expression "${src}"`);
    const sign = m[1] === '-' ? -1 : 1;
    if (m[2] !== undefined) {
      const unit = m[3] ? (m[3].startsWith('beat') ? 'beat' : m[3].startsWith('bar') ? 'bar' : 's') : 's';
      terms.push({ sign, kind: 'num', value: Number(m[2]), unit });
    } else if (m[4] === 'start' || m[4] === 'end') {
      terms.push({ sign, kind: m[4] });
    } else {
      terms.push({ sign, kind: 'mark', name: m[4] });
    }
    pos = TERM_RE.lastIndex;
  }
  return terms;
}

// resolveTimeExpr(expr, ctx) -> seconds.
// ctx: { beat, bar, marks (name -> absolute seconds, only the marks defined so far),
//        cutStart, cutDuration (inside a cut), duration (the whole video, used for `end` outside a cut) }.
// Inside a cut the result is cut-relative, and a mark term has to land inside the cut.
// Outside a cut (no cutStart) the result is absolute.
export function resolveTimeExpr(expr, ctx) {
  const { beat, bar, marks = {} } = ctx;
  const inCut = ctx.cutStart !== undefined;
  const base = inCut ? ctx.cutStart : 0;
  const end = inCut ? ctx.cutDuration : ctx.duration;
  let total = 0;
  for (const t of parseTimeExpr(expr)) {
    let v;
    if (t.kind === 'num') {
      v = t.value * (t.unit === 'beat' ? beat : t.unit === 'bar' ? bar : 1);
    } else if (t.kind === 'start') {
      v = 0;
    } else if (t.kind === 'end') {
      if (end === undefined) throw new TimeError(`"end" has no meaning here: "${expr}"`);
      v = end;
    } else {
      if (!Object.prototype.hasOwnProperty.call(marks, t.name)) {
        throw new TimeError(`mark "${t.name}" is not defined before this point: "${expr}"`, 'unknown-mark');
      }
      v = marks[t.name] - base;
      if (inCut && (v < -EPS || v > ctx.cutDuration + EPS)) {
        throw new TimeError(`mark "${t.name}" is outside this cut: "${expr}"`, 'mark-outside-cut');
      }
    }
    total += t.sign * v;
  }
  return total;
}
