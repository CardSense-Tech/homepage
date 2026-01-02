/*
  main.js
  - Mobile nav toggle (accessible)
  - Page reveal animations (IntersectionObserver)
  - Contact form: client-side mailto helper (no backend required)
*/

(function () {
  "use strict";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  // Mobile navigation
  var toggle = qs('[data-nav-toggle]');
  var nav = qs('[data-nav]');

  if (toggle && nav) {
    var collapsed = true;
    nav.setAttribute('data-collapsed', 'true');
    toggle.setAttribute('aria-expanded', 'false');

    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      nav.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    // Close menu when clicking a nav link on small screens
    nav.addEventListener('click', function (e) {
      var target = e.target;
      if (target && target.tagName === 'A') {
        nav.setAttribute('data-collapsed', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        collapsed = true;
      }
    });
  }

  // Reveal animations (subtle; respects prefers-reduced-motion via CSS)
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    // Fallback: show everything
    revealEls.forEach(function (el) {
      el.classList.add('is-visible');
    });
  }
})();
