// Page runtime for one cut. Plain browser script: no imports, no timers, no requestAnimationFrame, no clock.
// Reads window.__evCut and exposes window.__ev = { ready, seek }.
(function () {
  var data = window.__evCut;
  var cut = data.cut;
  var root = document.documentElement;

  var stage = document.getElementById('stage');
  var counters = [];
  var videoStep = null; // set by buildVideo: t -> promise
  var ownImage = null; // the image of an image or video part
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

  function buildImage(props, asset) {
    var box = el('div', 'part image');
    var img = el('img');
    img.style.objectFit = props.fit || 'cover';
    img.style.objectPosition = props.focus || 'center';
    img.src = asset.url;
    box.appendChild(img);
    ownImage = img;
    var span = (cut.duration + cut.tail) * 1000;
    if (props.zoom === 'in' || props.zoom === 'out') {
      var frames = [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }];
      if (props.zoom === 'out') frames.reverse();
      hold(img.animate(frames, { duration: span, fill: 'both', easing: 'linear' }));
    }
    return box;
  }

  function buildVideo(props, asset) {
    var box = el('div', 'part video');
    var img = el('img');
    img.style.objectFit = props.fit || 'cover';
    box.appendChild(img);
    ownImage = img;
    var shown = -1;
    function name(i) {
      return asset.dir + '/' + ('00000' + (i + 1)).slice(-5) + '.jpg';
    }
    videoStep = function (t) {
      var i = Math.max(0, Math.min(asset.count - 1, Math.floor(t * asset.fps + 1e-6)));
      if (i === shown) return null;
      shown = i;
      img.src = name(i);
      return img.decode();
    };
    img.src = name(0);
    shown = 0;
    return box;
  }

  function fitDevice(device, size) {
    var content = document.getElementById('fragment');
    var dev = content.parentNode;
    var logical = (window.__evDevices || {})[device];
    content.style.width = logical.width + 'px';
    content.style.height = logical.height + 'px';
    // Outer size of the device in CSS pixels: the screen plus bezel (and the laptop's base).
    var outerW = logical.width + (device === 'phone' ? 28 : 24 + 96);
    var outerH = logical.height + (device === 'phone' ? 28 : 24 + 20);
    var scale = device === 'phone'
      ? Math.min((size.height * 0.8) / outerH, (size.width * 0.8) / outerW)
      : Math.min((size.width * 0.78) / outerW, (size.height * 0.7) / outerH);
    dev.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
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

  var asset = data.asset;
  if (cut.part === 'card') stage.appendChild(buildCard(cut.props));
  else if (cut.part === 'image' && asset) stage.appendChild(buildImage(cut.props, asset));
  else if (cut.part === 'video' && asset) stage.appendChild(buildVideo(cut.props, asset));
  else if (cut.part === 'screen') fitDevice(cut.props.device, data);
  else if (cut.part === 'custom') { /* the fragment is already in the stage */ }
  else stage.appendChild(buildPlaceholder(cut.part, cut.props));
  stage.appendChild(buildTelops(cut.telops));

  // Fonts, then every image decoded. Only the image part's own image can fail the cut; the others are reported by
  // the request rules, or are the fragment's own business.
  var ready = document.fonts.ready.then(function () {
    return Promise.all(Array.prototype.map.call(document.images, function (img) {
      return img.decode().catch(function (err) {
        if (img === ownImage) throw new Error('ev-bad-image: ' + (img.getAttribute('src') || '') + ': ' + (err && err.message));
      });
    }));
  }).then(function () { return true; });

  function seek(t) {
    document.getAnimations().forEach(function (a) {
      a.pause();
      a.currentTime = t * 1000;
    });
    root.style.setProperty('--t', String(t));
    root.style.setProperty('--p', String(cut.duration > 0 ? t / cut.duration : 0));
    updateCounters(t);
    if (typeof window.renderAt === 'function') window.renderAt(t);
    return videoStep ? videoStep(t) : undefined;
  }

  window.__ev = { ready: ready, seek: seek };
})();
