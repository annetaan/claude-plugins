// Runs before the stage is parsed, so a custom or screen fragment already finds window.cut, the theme variables and
// the --mark-<name> variables. Plain browser script: no imports, no timers, no clock.
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

  Object.keys(cut.marks || {}).forEach(function (name) {
    root.style.setProperty('--mark-' + name, cut.marks[name] + 's');
  });

  // The logical size of each device screen, in CSS pixels. A screen fragment lays out against it.
  var DEVICES = { phone: { width: 390, height: 844 }, laptop: { width: 1280, height: 800 } };
  var width = data.width;
  var height = data.height;
  if (cut.part === 'screen') {
    var d = DEVICES[(cut.props && cut.props.device) || 'phone'];
    width = d.width;
    height = d.height;
  }
  window.cut = {
    duration: cut.duration,
    marks: cut.marks || {},
    beat: data.beat,
    bar: data.bar,
    width: width,
    height: height,
    language: data.language,
    stage: { width: data.width, height: data.height },
  };
  window.__evDevices = DEVICES;
})();
