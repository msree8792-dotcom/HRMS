/**
 * hrms-perms.js
 * Client-side RBAC enforcement. Loads the signed-in user's effective permission
 * codes from the Django API (/api/me/permissions) and HIDES any element tagged
 * with a `data-perm="<code>"` the user's role does not grant.
 *
 * The React bundle tags gated actions (e.g. the Leave Approve / Decline buttons
 * carry data-perm="leave.approve" / "leave.reject"); this helper does the
 * hiding — reactively, via a MutationObserver — so removing a permission in the
 * Access Control console immediately stops that role from using the action.
 *
 * Fail-open: until a permission set is actually loaded (e.g. RBAC tables not yet
 * migrated, or API unreachable) nothing is hidden, so the app keeps working.
 */
(function () {
  'use strict';

  var set = new Set();
  var known = false;   // true ONLY after a fresh, successful /api/me/permissions

  // We deliberately do NOT seed enforcement from the localStorage cache. Enforcing
  // from a stale cache (e.g. a previous user, or while the API is unreachable) can
  // leave the UI stuck hiding things — as happened here. Instead we fail OPEN until
  // the live API confirms the current role's permissions.

  function sessionEmail() {
    try { return (JSON.parse(localStorage.getItem('hrms_session') || '{}').email) || ''; }
    catch (_) { return ''; }
  }
  function can(code) { return known ? set.has(code) : true; }

  /* public API (parity with the other helpers) */
  window.__hrmsCan = can;
  window.__hrmsPerms = function () { return known ? Array.from(set) : null; };

  /* ── route → required permission (most-specific prefix first) ──────────────
     Single source of truth: drives BOTH sidebar nav hiding (applyNav) AND the
     full-page access guard (applyRouteGuard). Longer prefixes must come before
     their shorter parents so e.g. /settings/users resolves to settings.manage
     rather than the broader /settings → settings.view. */
  /* Each entry: [prefix, requiredPermission, exact?]. `exact:true` matches only
     when the path is identical (needed for '/', which otherwise prefix-matches
     every route). Listed most-specific first so the first match wins. */
  var ROUTE_PERMS = [
    ['/employees/attendance',  'attendance.view'],
    ['/employees/checkin',     'attendance.view'],
    ['/employees/tasks',       'employee.view'],
    ['/employees/submissions', 'employee.view'],
    ['/employees/leave',       'leave.view'],
    ['/employees/work',        'employee.view'],
    ['/settings/users',        'settings.manage'],
    ['/settings/email',        'settings.manage'],
    ['/settings',              'settings.view'],
    ['/payroll',               'payroll.view'],
    ['/recruit',               'recruitment.view'],
    ['/reports',               'reports.view'],
    ['/ai-analytics',          'reports.view'],
    ['/hr',                    'employee.view'],
    ['/',                      'dashboard.view', true],   // exact: the dashboard landing page
  ];
  /* Nav uses the same map (kept as an alias for readability below). */
  var NAV_PERMS = ROUTE_PERMS;

  /* ── action-level gating: hide specific action BUTTONS by their label ──────
     The React bundle only tags the two Leave buttons with data-perm, so we
     can't rely on data-perm for the rest. Instead we match a button's visible
     text (normalised — emoji/“+ ”/punctuation stripped) against known action
     labels and hide it when the role lacks the matching permission. Labels are
     the exact ones the bundle renders (verified against the built JS). `route`
     scopes a rule to a page when its label could otherwise be ambiguous; a null
     route means "anywhere". The backend still enforces every action with a 403,
     so a missed button fails safely — this layer is purely cosmetic. */
  var ACTION_RULES = [
    // Recruitment
    { route: '/recruit', perm: 'recruitment.create', labels: [
        'post job', 'post new job', 'create interview', 'create new interview',
        'create interview generate link', 'schedule interview generate link'] },
    { route: '/recruit', perm: 'recruitment.edit', labels: [
        'generate meeting link', 'send interview invite via email', 'send invite now'] },
    // Employee (tasks / submissions / employee list under HR)
    { route: null, perm: 'employee.create', labels: [
        'create task', 'create new task', 'new task', 'new submission',
        'add employee', 'add new employee'] },
    // Work submissions review — buttons are labelled "Approve"/"Reject" on the
    // submissions page; scope to that route so we don't touch the Leave page's
    // own Approve/Reject (which already carry data-perm).
    { route: '/employees/submissions', perm: 'submission.approve', labels: ['approve'] },
    { route: '/employees/submissions', perm: 'submission.reject', labels: ['reject'] },
    // Leave (approve/reject already carry data-perm in the bundle)
    { route: null, perm: 'leave.create', labels: ['apply leave'] },
    // Attendance
    { route: null, perm: 'attendance.checkinout', labels: [
        'check in', 'check out', 'check in out'] },
    // Reports
    { route: '/reports', perm: 'reports.export', labels: ['export csv', 'export pdf'] },
  ];
  /* Normalise a label: keep letters + single spaces, lowercase. Strips emoji,
     leading "+ ", arrows and other decoration so "▶ Check In" -> "check in". */
  function normLabel(s) {
    return (s || '').replace(/[^a-zA-Z ]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* Nav items that the React bundle may NOT render for certain legacy roles.
     When the user holds the corresponding permission, we inject them so they
     appear in the sidebar dynamically (fixes payroll.view for Recruiter role). */
  var NAV_INJECT = [
    {
      perm: 'payroll.view',
      section: 'Payroll',
      items: [
        { href: '/payroll/run',              label: 'Payroll Run' },
        { href: '/payroll/employer-record',  label: 'Employer of Record' },
        { href: '/payroll/contractor-record',label: 'Contractor of Record' },
        { href: '/payroll/contractor-mgmt',  label: 'Contractor Mgmt' },
        { href: '/payroll/peo',              label: 'PEO' },
      ]
    },
    {
      perm: 'reports.view',
      section: 'Reports',
      items: [
        { href: '/reports', label: 'Reports' }
      ]
    }
  ];

  /* Inject a synthetic sidebar section when permitted but not rendered. */
  function injectMissingNavSections() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    for (var ni = 0; ni < NAV_INJECT.length; ni++) {
      var def = NAV_INJECT[ni];
      if (!known) continue;
      var hasPerm = set.has(def.perm);
      var syntheticId = 'hrms-injected-nav-' + def.perm.replace(/\./g, '-');
      var existing = document.getElementById(syntheticId);
      if (!hasPerm) {
        // Remove previously injected section if permission was revoked
        if (existing) existing.parentNode.removeChild(existing);
        continue;
      }
      // Check if the React bundle has already rendered items for this section
      var alreadyInDom = false;
      for (var ii = 0; ii < def.items.length; ii++) {
        if (sidebar.querySelector('a.nav-item[href="' + def.items[ii].href + '"]')) { alreadyInDom = true; break; }
      }
      if (alreadyInDom) {
        // React rendered them — remove our injected section (if any) and let React own them
        if (existing) existing.parentNode.removeChild(existing);
        continue;
      }
      if (existing) continue; // already injected
      // Build section
      var sec = document.createElement('div');
      sec.className = 'nav-section';
      sec.id = syntheticId;
      var labelEl = document.createElement('div');
      labelEl.className = 'nav-label';
      labelEl.textContent = def.section;
      sec.appendChild(labelEl);
      for (var ji = 0; ji < def.items.length; ji++) {
        var item = def.items[ji];
        var a = document.createElement('a');
        a.className = 'nav-item';
        a.href = item.href;
        a.textContent = item.label;
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          // Use React Router's history if available, otherwise fallback
          if (window.__reactRouterNavigate) { window.__reactRouterNavigate(this.getAttribute('href')); }
          else { window.history.pushState({}, '', this.getAttribute('href')); window.dispatchEvent(new PopStateEvent('popstate')); }
        });
        sec.appendChild(a);
      }
      // Insert before the sidebar footer
      var footer = sidebar.querySelector('.sidebar-footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(sec, footer);
      else sidebar.appendChild(sec);
    }
  }

  /* Resolve the permission a path/href requires (shared by nav + route guard).
     Honours the optional `exact` flag so '/' only matches the dashboard itself,
     not every route (which all begin with '/'). */
  function permForPath(path) {
    if (!path) return null;
    for (var i = 0; i < ROUTE_PERMS.length; i++) {
      var prefix = ROUTE_PERMS[i][0], exact = ROUTE_PERMS[i][2];
      var hit = exact ? (path === prefix) : (path.indexOf(prefix) === 0);
      if (hit) return ROUTE_PERMS[i][1];
    }
    return null;
  }
  function navPermFor(href) { return permForPath(href); }
  function setHidden(el, hide, flag) {
    if (hide) {
      if (el.style.display !== 'none') { el.dataset[flag] = '1'; el.style.display = 'none'; }
    } else if (el.dataset[flag]) {
      el.style.display = '';
      delete el.dataset[flag];
    }
  }
  function applyNav() {
    if (!known) return;                 // don't restrict until we know the role's perms
    // First ensure any missing nav sections are injected for permitted modules
    injectMissingNavSections();
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var a = items[i];
      var perm = navPermFor(a.getAttribute('href') || '');
      if (perm) setHidden(a, !set.has(perm), 'hrmsNavHidden');
    }
    // collapse any section whose items are now all hidden (skip our own console entry)
    var secs = document.querySelectorAll('.nav-section');
    for (var j = 0; j < secs.length; j++) {
      var sec = secs[j];
      if (sec.id === 'hrms-rbac-nav') continue;
      // Skip injected sections — they manage their own visibility
      if (sec.id && sec.id.indexOf('hrms-injected-nav-') === 0) continue;
      var links = sec.querySelectorAll('.nav-item');
      if (!links.length) continue;
      var anyVisible = false;
      for (var k = 0; k < links.length; k++) { if (links[k].style.display !== 'none') { anyVisible = true; break; } }
      setHidden(sec, !anyVisible, 'hrmsSecHidden');
    }
  }

  /* ── full-page access guard: block routes the role can't view ──────────── */
  /* The React bundle only tags a couple of buttons with data-perm, so hiding
     alone can't restrict whole pages. This finds the permission required by the
     CURRENT route (ROUTE_PERMS) and, when the role lacks it, covers the page
     with an "Access denied" overlay. Fail-open: only enforces once `known`. */
  var GUARD_ID = 'hrms-access-denied';
  function navTo(href) {
    if (window.__reactRouterNavigate) { window.__reactRouterNavigate(href); }
    else { window.history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }
  }
  /* The first route the user IS allowed to open — used as the overlay's landing
     target so we never bounce them to a page they also can't see. Dashboard is
     preferred; otherwise the first granted module. Returns null if none. */
  function firstAllowedRoute() {
    if (set.has('dashboard.view')) return '/';
    for (var i = 0; i < ROUTE_PERMS.length; i++) {
      if (ROUTE_PERMS[i][0] === '/') continue;
      if (set.has(ROUTE_PERMS[i][1])) return ROUTE_PERMS[i][0];
    }
    return null;
  }
  function removeGuard() {
    var g = document.getElementById(GUARD_ID);
    if (g && g.parentNode) g.parentNode.removeChild(g);
  }
  function buildGuard() {
    var landing = firstAllowedRoute();
    var o = document.createElement('div');
    o.id = GUARD_ID;
    o.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(248,250,252,0.97)', 'backdrop-filter:blur(2px)',
      'font-family:inherit', 'text-align:center', 'padding:24px'
    ].join(';'));
    o.innerHTML =
      '<div style="max-width:420px">' +
        '<div style="font-size:44px;line-height:1;margin-bottom:16px">🔒</div>' +
        '<div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:8px">Access denied</div>' +
        '<div style="font-size:14px;color:#475569;margin-bottom:20px">Your role doesn’t include access to this page. ' +
        'Contact an administrator if you believe this is a mistake.</div>' +
        (landing
          ? '<button id="hrms-access-denied-home" style="background:#2563eb;color:#fff;border:0;border-radius:8px;' +
            'padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Go to an allowed page</button>'
          : '') +
      '</div>';
    var btn = o.querySelector('#hrms-access-denied-home');
    if (btn) btn.addEventListener('click', function () { navTo(landing); });
    return o;
  }
  function applyRouteGuard() {
    var perm = permForPath(location.pathname || '');
    var denied = known && perm && !set.has(perm);
    if (denied) { if (!document.getElementById(GUARD_ID)) document.body.appendChild(buildGuard()); }
    else removeGuard();
  }

  /* Hide action buttons whose label maps to a permission the role lacks. */
  function applyActions() {
    if (!known) return;
    var path = location.pathname || '';
    var btns = document.querySelectorAll('button, [role="button"], a.btn, a.button');
    for (var r = 0; r < ACTION_RULES.length; r++) {
      var rule = ACTION_RULES[r];
      if (rule.route && path.indexOf(rule.route) !== 0) continue;   // rule not for this page
      var lack = !set.has(rule.perm);
      for (var i = 0; i < btns.length; i++) {
        var el = btns[i];
        if (rule.labels.indexOf(normLabel(el.textContent)) !== -1) {
          setHidden(el, lack, 'hrmsActHidden');
        }
      }
    }
  }

  /* ── hide/show every [data-perm] element + gate nav per loaded perms ───── */
  /* The observer is DISCONNECTED while we mutate the sidebar and reconnected
     afterwards, so our own inserts/hides never re-fire it. This is what breaks
     the insert → React-reverts → observer → re-insert feedback loop that made
     the sidebar shake. */
  var _mo = null;
  function _observe() { if (_mo) _mo.observe(document.body, { childList: true, subtree: true }); }
  function applyPerms() {
    if (_mo) _mo.disconnect();
    try {
      var els = document.querySelectorAll('[data-perm]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var code = el.getAttribute('data-perm');
        if (!code) continue;
        setHidden(el, known && !set.has(code), 'hrmsHidden');
      }
      applyNav();
      applyRouteGuard();
      applyActions();
    } finally {
      _observe();
    }
  }
  var _t = null;
  function scheduleApply() {
    if (_t) return;                       // trailing debounce — never runs at frame rate
    _t = setTimeout(function () { _t = null; applyPerms(); }, 120);
  }

  /* ── load the effective permissions for the signed-in user ─────────────── */
  function refresh() {
    var em = sessionEmail();
    if (!em) { known = false; applyPerms(); return; }
    var hdrs = {};
    try { hdrs['X-User-Email'] = em; } catch (_) {}
    fetch('/api/me/permissions?email=' + encodeURIComponent(em), { headers: hdrs })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.permissions)) {
          set = new Set(d.permissions);
          known = true;
          try {
            localStorage.setItem('hrms_permissions', JSON.stringify(d.permissions));
            localStorage.setItem('hrms_role_name', d.role || '');
          } catch (_) {}
          window.dispatchEvent(new CustomEvent('hrmsPermsLoaded', { detail: { permissions: d.permissions, role: d.role } }));
        } else {
          known = false;   // reachable but no valid set → don't enforce
        }
        applyPerms();
      })
      .catch(function () {
        // API unreachable (e.g. server down) → fail OPEN, never hold stale restrictions
        known = false;
        applyPerms();
      });
  }

  /* ── observe React renders + re-check on navigation ────────────────────── */
  function watch() {
    _mo = new MutationObserver(scheduleApply);
    applyPerms();   // applyPerms (re)connects the observer in its finally block
  }

  /* re-load when the signed-in account changes (same-tab login/logout) */
  var curEmail = sessionEmail();
  setInterval(function () {
    var em = sessionEmail();
    if (em !== curEmail) {
      curEmail = em;
      set = new Set(); known = false;
      if (em) refresh(); else { try { localStorage.removeItem('hrms_permissions'); } catch (_) {} applyPerms(); }
    }
  }, 2000);
  /* pick up permission changes made by an admin without a full re-login */
  setInterval(refresh, 10000);
  /* cross-tab: another tab logged in/out or perms changed */
  window.addEventListener('storage', function (e) {
    if (e.key === 'hrms_session' || e.key === 'hrms_permissions') {
      set = new Set(); known = false; curEmail = sessionEmail(); applyPerms(); refresh();
    }
  });
  /* SPA route change → re-apply gating/guard immediately, and re-pull the live
     permission set so an admin's edits take effect on the very next navigation
     (not just on the 10s poll). */
  function onRouteChange() { scheduleApply(); applyRouteGuard(); refresh(); }
  var _push = history.pushState;
  history.pushState = function () { _push.apply(history, arguments); onRouteChange(); };
  window.addEventListener('popstate', onRouteChange);
  /* allow other scripts to force a reload of permissions */
  window.__hrmsRefreshPerms = refresh;

  refresh();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  console.log('[hrms-perms] loaded — known:', known);
})();
