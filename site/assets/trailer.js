// The trailer starts itself once it is reached, loops, and only stops when the
// reader pauses it. It starts buffering a screen early so it is ready on
// arrival. Browsers refuse sound before the reader has clicked or pressed a key
// somewhere, so if that is refused it plays muted with a button to turn the
// sound on, and the reader's first click anywhere turns it on too.
// Under prefers-reduced-motion nothing starts on its own.
(function () {
  var video = document.querySelector(".pocket--video video");
  if (!video) return;
  var unmute = document.querySelector(".trailer-unmute");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  video.loop = true;

  var started = false;      // autoplay has fired once; never again after that
  var forcedMute = false;   // we muted it, not the reader

  function showUnmute(on) {
    if (unmute) unmute.hidden = !on;
  }

  function soundOn() {
    if (!forcedMute) return;
    forcedMute = false;
    video.muted = false;
    showUnmute(false);
  }

  function start() {
    if (started) return;
    started = true;
    video.muted = false;
    var p = video.play();
    if (!p || !p.catch) return;
    p.catch(function () {
      forcedMute = true;
      video.muted = true;
      showUnmute(true);
      video.play().catch(function () { showUnmute(false); });
    });
  }

  if (unmute) unmute.addEventListener("click", soundOn);

  // The first real gesture anywhere is permission for sound.
  ["pointerdown", "keydown"].forEach(function (type) {
    document.addEventListener(type, function once() {
      document.removeEventListener(type, once, true);
      soundOn();
    }, true);
  });

  // Unmuting from the video's own controls does the button's job for it.
  video.addEventListener("volumechange", function () {
    if (!video.muted && forcedMute) { forcedMute = false; showUnmute(false); }
  });
  video.addEventListener("pause", function () { showUnmute(false); });

  if (reduced || !("IntersectionObserver" in window)) return;

  var warm = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting) return;
    warm.disconnect();
    video.preload = "auto";
    video.load();
  }, { rootMargin: "100% 0px" });
  warm.observe(video);

  var reach = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting) return;
    reach.disconnect();
    start();
  }, { threshold: 0.5 });
  reach.observe(video);
})();
