/**
 * hrms-mobile.js
 * Mobile/responsive helper for the HRMS dashboard. Pairs with responsive.css.
 *
 * On small screens the sidebar (already position:fixed) becomes a slide-in
 * drawer. This script injects a hamburger button into the .topbar and a
 * backdrop, and toggles `body.sidebar-open`. All visual rules live in
 * responsive.css — this only wires up the toggle. Same no-rebuild injection
 * approach as hrms-live.js / google-auth.js.
 */
(function () {
  'use strict';

  var BTN_ID = 'hrms-hamburger';
  var BACKDROP_ID = 'hrms-sidebar-backdrop';
  var MQ = '(max-width: 768px)';

  function isMobile() {
    return window.matchMedia(MQ).matches;
  }
  function openDrawer() { document.body.classList.add('sidebar-open'); }
  function closeDrawer() { document.body.classList.remove('sidebar-open'); }
  function toggleDrawer() {
    if (document.body.classList.contains('sidebar-open')) closeDrawer();
    else openDrawer();
  }

  function ensureBackdrop() {
    if (document.getElementById(BACKDROP_ID)) return;
    var bd = document.createElement('div');
    bd.id = BACKDROP_ID;
    bd.addEventListener('click', closeDrawer);
    document.body.appendChild(bd);
  }

  function ensureButton() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;                       // auth pages have no topbar
    if (document.getElementById(BTN_ID)) {
      // Keep it as the first child even if React re-renders the topbar.
      var existing = document.getElementById(BTN_ID);
      if (topbar.firstChild !== existing) topbar.insertBefore(existing, topbar.firstChild);
      return;
    }
    var b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.setAttribute('aria-label', 'Toggle menu');
    b.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDrawer();
    });
    topbar.insertBefore(b, topbar.firstChild);
  }

  function sync() {
    ensureBackdrop();
    ensureButton();
    // Never leave the drawer "open" when we're back on a desktop width.
    if (!isMobile()) closeDrawer();
  }

  // Close the drawer after tapping a nav link (delegated — survives re-renders).
  document.addEventListener('click', function (e) {
    if (!isMobile()) return;
    var navItem = e.target.closest && e.target.closest('.nav-item');
    if (navItem) setTimeout(closeDrawer, 60);
  });

  // Close on Escape.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  // Close on SPA navigation.
  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(history, arguments);
    closeDrawer();
  };
  window.addEventListener('popstate', closeDrawer);
  window.addEventListener('resize', function () { if (!isMobile()) closeDrawer(); });

  function boot() {
    sync();
    // The topbar mounts after React hydrates — keep ensuring the button.
    setInterval(sync, 800);
    setTimeout(sync, 600);
    setTimeout(sync, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
