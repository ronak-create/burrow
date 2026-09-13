// Reveals each chamber as it enters the viewport while digging down the page.
// Skipped entirely under prefers-reduced-motion, where CSS already shows
// everything at rest.
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var chambers = document.querySelectorAll(".chamber");
  if (reduced || !("IntersectionObserver" in window)) {
    chambers.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
  );
  chambers.forEach(function (el) { observer.observe(el); });
})();
