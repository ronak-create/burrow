/* Critters: small living details laid over the root artwork — the same
   lantern, mushroom, bush and fern sprites, ping-pong looped in place so
   each one reads as flicker/sway rather than a slideshow. Purely
   decorative: aria-hidden, no pointer events, and it does nothing under
   reduced motion beyond painting frame 0. The wind toggle (wind.js) stills
   them too: they hold whatever frame they are on until it is switched back. */

(function () {
  var SPRITE_ROWS = window.CRITTER_SPRITES || [];

  var ROW_FOR = {
    lanternA:  0,
    lanternB:  1,
    bushA:     2,
    bushB:     3,
    mushroomA: 4,
    mushroomB: 4,
    fern:      5,
    fernB:     6
  };

  function buildPingPongOrder(n) {
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    for (var i = n - 2; i > 0; i--) order.push(i);
    return order;
  }

  function mount(el) {
    var key = el.getAttribute('data-sprite');
    var rowIndex = ROW_FOR[key];
    if (rowIndex == null) return;
    var row = SPRITE_ROWS[rowIndex];
    if (!row || !row.frames || !row.frames.length) return;

    var img = document.createElement('img');
    img.src = row.frames[0];
    img.alt = '';
    img.decoding = 'async';
    el.appendChild(img);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return; // frame 0 only, no timer
    }

    var order = buildPingPongOrder(row.frames.length);
    if (order.length < 2) return;

    // Stagger both phase and speed a little so instances of the same
    // sprite (e.g. the two mushrooms) don't flicker in lockstep.
    var step = Math.floor(Math.random() * order.length);
    var interval = 110 + Math.random() * 70;
    var timer = null;
    var visible = !('IntersectionObserver' in window);

    function tick() {
      step = (step + 1) % order.length;
      img.src = row.frames[order[step]];
    }

    function update() {
      var on = visible && document.documentElement.dataset.ambience !== 'off';
      if (on && !timer) timer = setInterval(tick, interval);
      if (!on && timer) { clearInterval(timer); timer = null; }
    }

    document.addEventListener('ambience', update);

    // Only animate what is on screen; there are a few dozen of these.
    if (visible) { update(); return; }
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      update();
    }, { rootMargin: '200px 0px' }).observe(el);
  }

  function init() {
    var nodes = document.querySelectorAll('.critter[data-sprite]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();