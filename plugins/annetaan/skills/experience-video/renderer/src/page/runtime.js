// Page runtime for one cut. Plain browser script: no imports, no timers, no requestAnimationFrame, no clock.
// Reads window.__evCut and exposes window.__ev = { ready, seek }.
(function () {
  var data = window.__evCut;
  var cut = data.cut;
  var root = document.documentElement;
  var theme = data.theme || {};
  if (theme.background) root.style.setProperty('--bg', theme.background);
  if (theme.foreground) root.style.setProperty('--fg', theme.foreground);
  if (theme.accent) root.style.setProperty('--accent', theme.accent);
  if (theme.font) root.style.setProperty('--font', theme.font);
  else root.style.setProperty('--font', 'system-ui');

  var stage = document.getElementById('stage');
  var counters = [];
  var EASE_IN_MS = 500;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function hold(anim) {
    anim.pause();
    return anim;
  }

  function buildCard(props) {
    var part = el('div', 'part card align-' + (props.align || 'center'));
    if (props.background) part.style.background = props.background;
    var stagger = props.stagger === undefined ? 0.3 : props.stagger;
    (props.lines || []).forEach(function (line, i) {
      var node = el('div', 'line ' + (line.style || 'plain'), line.text);
      var delay = i * stagger;
      hold(node.animate(
        [{ opacity: 0, transform: 'translateY(3vmin)' }, { opacity: 1, transform: 'translateY(0)' }],
        { delay: delay * 1000, duration: EASE_IN_MS, fill: 'both', easing: 'ease-out' }
      ));
      if (line.count) counters.push({ node: node, line: line, delay: delay });
      part.appendChild(node);
    });
    return part;
  }

  function buildPlaceholder(part, props) {
    var box = el('div', 'part');
    if (props.background) box.style.background = props.background;
    var frame = el('div', 'placeholder');
    frame.appendChild(el('div', 'word', part));
    if (props.prompt) frame.appendChild(el('div', 'prompt', props.prompt));
    if (props.src) frame.appendChild(el('div', 'src', props.src));
    box.appendChild(frame);
    return box;
  }

  function buildTelops(telops) {
    var layer = el('div');
    layer.id = 'telops';
    var end = cut.duration;
    telops.forEach(function (t) {
      var node = el('div', 'telop ' + t.position + ' ' + t.style, t.text);
      var stays = t.until >= end - 1e-6;
      if (stays) {
        hold(node.animate([{ opacity: 0 }, { opacity: 1 }], { delay: t.at * 1000, duration: 250, fill: 'both' }));
      } else if (t.until > t.at) {
        var u = t.until;
        var tin = Math.min(t.at + 0.25, u);
        var tout = Math.max(u - 0.2, tin);
        hold(node.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: t.at / u },
            { opacity: 1, offset: tin / u },
            { opacity: 1, offset: tout / u },
            { opacity: 0, offset: 1 },
          ],
          { duration: u * 1000, fill: 'both' }
        ));
      }
      layer.appendChild(node);
    });
    return layer;
  }

  var ease = function (p) { return 1 - Math.pow(1 - p, 3); };

  function updateCounters(t) {
    counters.forEach(function (c) {
      var d = c.line.count.duration;
      var p = d > 0 ? Math.min(1, Math.max(0, (t - c.delay) / d)) : 1;
      var v = c.line.count.from + (c.line.count.to - c.line.count.from) * ease(p);
      c.node.textContent = c.line.text.split('{n}').join(v.toFixed(c.line.count.decimals));
    });
  }

  if (cut.part === 'card') stage.appendChild(buildCard(cut.props));
  else stage.appendChild(buildPlaceholder(cut.part, cut.props));
  stage.appendChild(buildTelops(cut.telops));

  var ready = document.fonts.ready.then(function () { return true; });

  function seek(t) {
    document.getAnimations().forEach(function (a) {
      a.pause();
      a.currentTime = t * 1000;
    });
    root.style.setProperty('--t', String(t));
    root.style.setProperty('--p', String(cut.duration > 0 ? t / cut.duration : 0));
    updateCounters(t);
    if (typeof window.renderAt === 'function') window.renderAt(t);
  }

  window.__ev = { ready: ready, seek: seek };
})();
