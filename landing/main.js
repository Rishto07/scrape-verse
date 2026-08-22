(function () {
  "use strict";

  /* ============================================================
     Count-up stats
     ============================================================ */

  var easeOutCubic = function (t) {
    return 1 - Math.pow(1 - t, 3);
  };

  var animateCount = function (el) {
    var target = parseFloat(el.dataset.target);
    var suffix = el.dataset.suffix || "";
    var decimals = parseInt(el.dataset.decimals || "0", 10);
    var index = parseInt(el.dataset.i || "0", 10);
    var duration = 1500 + index * 80;
    var startOffset = 480 + index * 90;

    el.textContent = "0" + suffix;

    setTimeout(function () {
      var start = null;

      var tick = function (ts) {
        if (start === null) start = ts;
        var progress = Math.min(1, (ts - start) / duration);
        var eased = easeOutCubic(progress);
        el.textContent = (target * eased).toFixed(decimals) + suffix;
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = target.toFixed(decimals) + suffix;
        }
      };

      requestAnimationFrame(tick);
    }, startOffset);
  };

  var statEls = Array.prototype.slice.call(document.querySelectorAll(".stat-value"));

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          animateCount(entry.target);
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.25 }
    );

    statEls.forEach(function (el, i) {
      el.dataset.i = String(i);
      observer.observe(el);
    });
  } else {
    statEls.forEach(function (el, i) {
      el.dataset.i = String(i);
      el.textContent =
        parseFloat(el.dataset.target).toFixed(parseInt(el.dataset.decimals || "0", 10)) +
        (el.dataset.suffix || "");
    });
  }

  /* ============================================================
     Mobile menu
     ============================================================ */

  var burger = document.querySelector(".burger");
  var overlay = document.getElementById("overlay");
  var menu = document.getElementById("mobile-menu");
  var body = document.body;

  var setMenu = function (open) {
    burger.setAttribute("aria-expanded", String(open));
    burger.classList.toggle("open", open);
    menu.hidden = !open;
    overlay.hidden = !open;
    body.classList.toggle("menu-open", open);
  };

  burger.addEventListener("click", function () {
    setMenu(burger.getAttribute("aria-expanded") !== "true");
  });

  overlay.addEventListener("click", function () {
    setMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setMenu(false);
  });

  Array.prototype.slice.call(menu.querySelectorAll("a")).forEach(function (link) {
    link.addEventListener("click", function () {
      setMenu(false);
    });
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 720) setMenu(false);
  });
})();