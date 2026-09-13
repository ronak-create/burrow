(function () {
  // Mobile sidebar drawer
  var toggle = document.querySelector(".menu-toggle");
  var scrim = document.querySelector(".sidebar-scrim");
  function closeSidebar() { document.body.classList.remove("sidebar-open"); }
  if (toggle) {
    toggle.addEventListener("click", function () {
      document.body.classList.toggle("sidebar-open");
    });
  }
  if (scrim) scrim.addEventListener("click", closeSidebar);
  document.querySelectorAll(".docs-sidebar a").forEach(function (a) {
    a.addEventListener("click", closeSidebar);
  });

  // Highlight the current page in the sidebar
  var here = location.pathname.replace(/\/index\.html$/, "/");
  document.querySelectorAll(".sidebar-group a").forEach(function (a) {
    var target = new URL(a.getAttribute("href"), location.href).pathname.replace(/\/index\.html$/, "/");
    if (target === here) a.classList.add("is-active");
  });

  // Highlight the on-page TOC entry that matches the section in view
  var tocLinks = document.querySelectorAll(".docs-toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var el = document.getElementById(id);
      if (el) map[id] = a;
    });
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var link = map[entry.target.id];
          if (!link) return;
          if (entry.isIntersecting) {
            tocLinks.forEach(function (a) { a.classList.remove("is-active"); });
            link.classList.add("is-active");
          }
        });
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    Object.keys(map).forEach(function (id) {
      observer.observe(document.getElementById(id));
    });
  }
})();
