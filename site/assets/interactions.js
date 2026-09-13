(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (reduced || !fine) return;

  // ---------- the light the lantern cursor is carrying ----------
  // A single fixed layer that trails the pointer, so the dark page lights up
  // around wherever the reader is looking rather than being evenly lit.
  var glow = document.createElement("div");
  glow.className = "lantern-glow";
  document.body.appendChild(glow);

  var gx = 0, gy = 0, tx = 0, ty = 0, lit = false, frame = null;

  function draw() {
    // Ease toward the pointer so the light swings rather than snaps.
    gx += (tx - gx) * 0.18;
    gy += (ty - gy) * 0.18;
    glow.style.transform = "translate3d(" + gx.toFixed(1) + "px," + gy.toFixed(1) + "px,0)";
    if (Math.abs(tx - gx) > 0.5 || Math.abs(ty - gy) > 0.5) {
      frame = requestAnimationFrame(draw);
    } else {
      frame = null;
    }
  }

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    tx = e.clientX;
    ty = e.clientY;
    if (!lit) {
      lit = true;
      gx = tx; gy = ty;
      glow.classList.add("is-lit");
    }
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: true });

  document.addEventListener("pointerleave", function () {
    glow.classList.remove("is-lit");
    lit = false;
  });

  // ---------- spotlight border on cards ----------
  var spotlightEls = document.querySelectorAll(".cell, .download-card, .snippet");
  spotlightEls.forEach(function (el) {
    el.classList.add("spotlight");
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - r.left) + "px");
      el.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  // ---------- tilt on the large feature cell ----------
  var tiltEl = document.querySelector(".cell--lg");
  if (tiltEl) {
    tiltEl.style.transformStyle = "preserve-3d";
    tiltEl.addEventListener("pointermove", function (e) {
      var r = tiltEl.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      tiltEl.style.transform = "perspective(900px) rotateX(" + (-py * 4) + "deg) rotateY(" + (px * 4) + "deg)";
    });
    tiltEl.addEventListener("pointerleave", function () {
      tiltEl.style.transform = "";
    });
  }
})();
