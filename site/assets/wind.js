// Wind: slow breezes drifting through the burrow, and the sound of them.
//
// A breeze is a bundle of a few long wavy lines that sweeps across the screen:
// a lit stretch travels along a slowly undulating path, tapering in and out,
// so it reads as a current of air rather than as particles. Two layers: a
// fuller one under the root artwork, so breezes only show through the open
// ground between the roots, and a sparse, fainter one over it, so some of the
// air passes in front of everything. Each layer is one viewport-sized canvas
// fixed over the whole page, so the air keeps moving wherever the reader is.
// Fewer breezes on narrow screens; none under reduced motion.
//
// The sound is a short recorded loop, fetched only once the reader clicks or
// presses a key (browsers allow sound no earlier), with generated wind as the
// fallback. Over it runs one gust level shared by sound and sight: a gust
// swells, the wind gets louder and higher, and the breezes quicken and
// brighten with it, then it all settles back to a steady breeze. It eases
// down, not out, while the trailer is on screen and playing with sound.
//
// One toggle stills the whole place: breezes, sound, and the sprites in
// critters.js, which reads <html data-ambience> and listens for the
// "ambience" event. The choice is remembered.
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var KEY = "burrow-wind";
  var wanted = true;
  try { wanted = localStorage.getItem(KEY) !== "off"; } catch (e) {}
  document.documentElement.dataset.ambience = wanted ? "on" : "off";

  // ---------- gusts ----------
  // gust is where the wind is heading (0 = steady breeze, 1 = full gust) and
  // rise how many seconds it takes to get there. Mostly gentle, now and then big.
  var gust = 0.15, rise = 3, gustNow = 0.15, onGust = null;
  (function nextGust() {
    var big = Math.random() < 0.35;
    gust = big ? 0.65 + Math.random() * 0.35 : Math.random() * 0.3;
    rise = 1.5 + Math.random() * (big ? 2.5 : 4);
    if (onGust) onGust();
    setTimeout(nextGust, (rise + 1 + Math.random() * (big ? 3 : 6)) * 1000);
  })();

  // ---------- breezes ----------

  function makeLayer(cls, count, rgb, alpha, width) {
    var wrap = document.createElement("div");
    wrap.className = "wind " + cls;
    wrap.setAttribute("aria-hidden", "true");
    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    document.body.appendChild(wrap);
    return { canvas: canvas, ctx: canvas.getContext("2d"), gusts: [],
             count: count, rgb: rgb, alpha: alpha, width: width };
  }

  var layers = [];
  var W = 0, H = 0, dpr = 1, running = false, frame = null;
  var lastScroll = window.scrollY;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawn(g, anywhere) {
    g.len = rand(260, 620);                 // length of the lit stretch
    g.y = rand(H * 0.05, H * 0.95);
    g.amp = rand(4, 14);
    g.wave = rand(420, 900);                // wavelength of the path
    g.phase = rand(0, Math.PI * 2);
    g.drift = rand(-0.06, 0.06);            // slight rise or fall across the screen
    g.speed = rand(1.8, 3.6);
    g.lines = 2 + Math.floor(Math.random() * 3);
    g.gap = rand(5, 10);
    g.wait = anywhere ? 0 : Math.floor(rand(20, 240));
    g.head = anywhere ? rand(-g.len, W) : -rand(0, 120);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    W = window.innerWidth;
    H = window.innerHeight;
    layers.forEach(function (L) {
      L.canvas.width = Math.round(W * dpr);
      L.canvas.height = Math.round(H * dpr);
      L.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.ctx.lineCap = "round";
      L.gusts.length = 0;
      var n = W < 700 ? Math.ceil(L.count / 2) : L.count;
      for (var i = 0; i < n; i++) { var g = {}; spawn(g, true); L.gusts.push(g); }
    });
  }

  // Breezes live in screen space, so scrolling carries them with the page.
  function onScroll() {
    var dy = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    layers.forEach(function (L) { L.gusts.forEach(function (g) { g.y -= dy; }); });
  }

  var t = 0;
  function pathY(g, x, k) {
    return g.y + x * g.drift
      + g.amp * Math.sin((x / g.wave) * Math.PI * 2 + g.phase + t * 0.012)
      + k * g.gap;
  }

  // Each line of the bundle is one path, stroked twice: a wide faint pass for
  // the haze of moving air, then a thin core. A gradient along the stretch
  // tapers both ends to nothing.
  function drawGust(c, g, L, bright) {
    var STEP = 16;
    var tail = g.head - g.len;
    for (var k = 0; k < g.lines; k++) {
      // Outer lines are shorter and fainter, so the bundle has a soft edge.
      var edge = Math.abs(k - (g.lines - 1) / 2) / Math.max(1, (g.lines - 1) / 2);
      var trim = g.len * 0.18 * edge;
      var a0 = tail + trim, a1 = g.head - trim;
      var x0 = Math.max(a0, -STEP), x1 = Math.min(a1, W + STEP);
      if (x1 <= x0) continue;
      c.beginPath();
      c.moveTo(x0, pathY(g, x0, k));
      for (var x = x0 + STEP; x < x1; x += STEP) c.lineTo(x, pathY(g, x, k));
      c.lineTo(x1, pathY(g, x1, k));

      var peak = Math.min(1, L.alpha * bright * (1 - 0.45 * edge));
      var grad = c.createLinearGradient(a0, 0, a1, 0);
      grad.addColorStop(0, "rgba(" + L.rgb + ",0)");
      grad.addColorStop(0.55, "rgba(" + L.rgb + "," + peak + ")");
      grad.addColorStop(1, "rgba(" + L.rgb + ",0)");
      c.strokeStyle = grad;

      c.globalAlpha = 0.22;
      c.lineWidth = L.width * 5;
      c.stroke();
      c.globalAlpha = 1;
      c.lineWidth = L.width;
      c.stroke();
    }
  }

  function step() {
    t += 1;
    gustNow += (gust - gustNow) / (rise * 60);
    var push = 0.75 + gustNow * 1.1;
    layers.forEach(function (L) {
      var c = L.ctx;
      c.clearRect(0, 0, W, H);
      for (var i = 0; i < L.gusts.length; i++) {
        var g = L.gusts[i];
        if (g.wait > 0) { g.wait -= 1; continue; }
        g.head += g.speed * push;
        c.globalAlpha = 1;
        drawGust(c, g, L, 0.8 + gustNow * 0.5);
        if (g.head - g.len > W || g.y < -80 || g.y > H + 80) spawn(g, false);
      }
      c.globalAlpha = 1;
    });
    frame = requestAnimationFrame(step);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) {
      lastScroll = window.scrollY;
      frame = requestAnimationFrame(step);
    } else {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      layers.forEach(function (L) { L.ctx.clearRect(0, 0, W, H); });
    }
  }

  if (!reduced) {
    layers.push(makeLayer("wind--back", 9, "200,188,255", 0.5, 1.5));
    layers.push(makeLayer("wind--front", 5, "238,234,255", 0.34, 1.3));
    resize();

    var update = function () {
      setRunning(wanted && document.visibilityState === "visible");
    };
    document.addEventListener("ambience", update);
    document.addEventListener("visibilitychange", update);
    update();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---------- sound ----------

  var AC = window.AudioContext || window.webkitAudioContext;

  var LOOP = "assets/wind-loop.mp3";

  var LEVEL = 0.8, DUCKED = 0.4;
  var audio = null;

  // Used only if the recording cannot be fetched or decoded.
  function noiseBuffer(ctx) {
    var rate = ctx.sampleRate, len = rate * 8, blend = rate;
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), last = 0;
      for (var i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 0.6;
      }
      for (var j = 0; j < blend; j++) {
        var k = j / blend;
        d[len - blend + j] = d[len - blend + j] * (1 - k) + d[j] * k;
      }
    }
    return buf;
  }

  function build() {
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0;
    // A gust is louder and brighter: more of the high whistle gets through.
    var swell = ctx.createGain();
    var tone = ctx.createBiquadFilter();
    tone.type = "lowpass"; tone.Q.value = 0.9;
    swell.connect(tone).connect(master).connect(ctx.destination);
    var a = { ctx: ctx, master: master, swell: swell, tone: tone };
    shape(a, 0.5);

    function play(buf, filtered) {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var out = src;
      if (filtered) {
        var band = ctx.createBiquadFilter();
        band.type = "bandpass"; band.frequency.value = 420; band.Q.value = 0.7;
        out = src.connect(band);
      }
      out.connect(swell);
      src.start();
    }

    fetch(LOOP)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (data) {
        return new Promise(function (ok, fail) { ctx.decodeAudioData(data, ok, fail); });
      })
      .then(function (buf) { play(buf, false); })
      .catch(function () { play(noiseBuffer(ctx), true); });
    return a;
  }

  function shape(a, seconds) {
    var now = a.ctx.currentTime, end = now + seconds;
    [[a.swell.gain, 0.6 + gust * 0.8], [a.tone.frequency, 1400 + gust * 7600]].forEach(function (p) {
      p[0].cancelScheduledValues(now);
      p[0].setValueAtTime(p[0].value, now);
      p[0].linearRampToValueAtTime(p[1], end);
    });
  }
  onGust = function () { if (audio) shape(audio, rise); };

  // Eased down only while the trailer is both audible and on screen.
  var trailer = document.querySelector(".pocket--video video");
  var trailerSeen = false;
  if (trailer && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      trailerSeen = entries[0].isIntersecting;
      apply(0.8);
    }, { threshold: 0.25 }).observe(trailer);
  }
  function targetLevel() {
    if (!wanted) return 0;
    var loud = trailerSeen && !trailer.paused && !trailer.muted;
    return loud ? DUCKED : LEVEL;
  }
  function apply(seconds) {
    if (!audio) return;
    var g = audio.master.gain, now = audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(targetLevel(), now + seconds);
  }

  function start() {
    if (!wanted || !AC) return;
    if (!audio) audio = build();
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    apply(3);
  }

  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "wind-toggle";
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/></svg>' +
    '<span class="wind-toggle-label"></span>';
  function label() {
    toggle.setAttribute("aria-pressed", String(wanted));
    toggle.setAttribute("aria-label", wanted ? "Still the wind, sound and animation" : "Bring back the wind, sound and animation");
    toggle.querySelector(".wind-toggle-label").textContent = wanted ? "Wind on" : "Wind off";
  }
  label();
  document.body.appendChild(toggle);

  toggle.addEventListener("click", function () {
    wanted = !wanted;
    try { localStorage.setItem(KEY, wanted ? "on" : "off"); } catch (e) {}
    label();
    document.documentElement.dataset.ambience = wanted ? "on" : "off";
    document.dispatchEvent(new CustomEvent("ambience", { detail: { on: wanted } }));
    if (wanted) start(); else apply(0.6);
  });

  // The first gesture anywhere else is the browser's permission for sound.
  ["pointerdown", "keydown"].forEach(function (type) {
    document.addEventListener(type, function once(e) {
      if (toggle.contains(e.target)) return;
      document.removeEventListener(type, once, true);
      start();
    }, true);
  });

  if (trailer) {
    ["play", "pause", "volumechange"].forEach(function (type) {
      trailer.addEventListener(type, function () { apply(0.8); });
    });
  }

  document.addEventListener("visibilitychange", function () {
    if (!audio) return;
    if (document.visibilityState === "hidden") audio.ctx.suspend();
    else if (wanted) audio.ctx.resume();
  });
})();
