/**
 * hrms-checkin.js  v4
 * Removes the Settings icon from the topbar and replaces it with a
 * Check-In / Check-Out toggle switch.  Shows a mobile icon when checked-in
 * from mobile, a desktop/PC icon when checked-in from a PC.
 * toggle switch.  Shows a mobile icon when checked-in from mobile,
 * a desktop/PC icon when checked-in from a PC.
 *
 * The device icon appears BOTH on the toggle and in the topbar (next to
 * the toggle) so every other employee viewing the topbar can see whether
 * the currently-checked-in user came from mobile or desktop.
 *
 * Same no-rebuild injection pattern as hrms-live.js / hrms-mobile.js.
 */
(function () {
  'use strict';

  /* ── storage keys ────────────────────────────────────────────────────── */
  var STORAGE_DEVICE   = 'hrms_checkin_device';
  var STORAGE_STATE    = 'hrms_checked_in';
  var TOGGLE_ID        = 'hrms-checkin-toggle';
  var WRAPPER_ID       = 'hrms-checkin-wrapper';

  /* ── initial state (restored from localStorage) ──────────────────────── */
  var isCheckedIn = localStorage.getItem(STORAGE_STATE) === 'true';

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function detectDevice() {
    return /mobile|android|iphone|ipad|phone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  function getCheckinDevice() {
    return localStorage.getItem(STORAGE_DEVICE) || detectDevice();
  }

  /* ── backend attendance sync ─────────────────────────────────────────── */
  function getActor() {
    try {
      var s = JSON.parse(localStorage.getItem('hrms_session') || '{}');
      return { email: (s && s.email) || '', name: (s && (s.name || s.fullName)) || '' };
    } catch (_) {
      return { email: '', name: '' };
    }
  }

  /* Records the check-in / check-out against the Django attendance API.
     Auth + actor headers are attached automatically by hrms-actor.js. Fires
     'hrmsAttendanceSynced' with the saved record so the check-in page can
     display real times. No-op when logged out. */
  function syncAttendance(checkedIn, device) {
    var actor = getActor();
    if (!actor.email) return;
    var path = checkedIn ? '/api/attendance/check-in' : '/api/attendance/check-out';
    var body = checkedIn
      ? { email: actor.email, device: device || detectDevice(), employee: actor.name }
      : { email: actor.email };
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (record) {
        window.dispatchEvent(new CustomEvent('hrmsAttendanceSynced', {
          detail: { checkedIn: checkedIn, record: record }
        }));
        console.log('[hrms-checkin] attendance', checkedIn ? 'check-in' : 'check-out', record);
      })
      .catch(function (e) { console.warn('[hrms-checkin] attendance sync failed', e); });
  }

  /* ── SVG icons ───────────────────────────────────────────────────────── */
  var MOBILE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
    ' stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' +
    '<rect x="5" y="2" width="14" height="20" rx="2"/>' +
    '<line x1="12" y1="18" x2="12.01" y2="18"/>' +
    '</svg>';

  var DESKTOP_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
    ' stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' +
    '<rect x="2" y="3" width="20" height="14" rx="2"/>' +
    '<polyline points="8 21 12 17 16 21"/>' +
    '</svg>';

  function deviceIcon(device) {
    return device === 'mobile' ? MOBILE_ICON : DESKTOP_ICON;
  }

  /* ── build the toggle widget ─────────────────────────────────────────── */
  function buildWrapper() {
    var device  = getCheckinDevice();

    /* outer wrapper — flex row: [device-icon] [switch] */
    var wrap = document.createElement('div');
    wrap.id        = WRAPPER_ID;
    wrap.className = 'hrms-ci-wrap' + (isCheckedIn ? ' ci-active' : '');
    wrap.title     = isCheckedIn ? 'Checked In — click to Check Out' : 'Click to Check In';

    /* device icon badge */
    var iconEl = document.createElement('span');
    iconEl.className = 'hrms-ci-icon';
    iconEl.innerHTML = deviceIcon(device);

    /* toggle pill */
    var toggle = document.createElement('button');
    toggle.id        = TOGGLE_ID;
    toggle.type      = 'button';
    toggle.className = 'hrms-ci-switch' + (isCheckedIn ? ' ci-on' : '');
    toggle.setAttribute('aria-label',   'Toggle Check In / Check Out');
    toggle.setAttribute('aria-pressed', isCheckedIn ? 'true' : 'false');
    toggle.setAttribute('role',         'switch');

    /* toggle knob */
    var knob = document.createElement('span');
    knob.className = 'hrms-ci-knob';
    toggle.appendChild(knob);

    /* click handler */
    wrap.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      handleToggle(wrap, toggle, iconEl);
    });

    wrap.appendChild(iconEl);
    wrap.appendChild(toggle);

    return wrap;
  }

  function handleToggle(wrap, toggle, iconEl) {
    isCheckedIn = !isCheckedIn;

    /* update device on check-in (re-detect each time so switching browsers
       is picked up on next check-in) */
    var device = detectDevice();
    if (isCheckedIn) {
      localStorage.setItem(STORAGE_DEVICE, device);
    }
    localStorage.setItem(STORAGE_STATE, isCheckedIn ? 'true' : 'false');

    refreshUI(wrap, toggle, iconEl, device);

    /* notify React / other scripts */
    window.dispatchEvent(new CustomEvent('hrmsCheckinToggle', {
      detail: { checkedIn: isCheckedIn, device: device }
    }));

    /* persist to the attendance backend */
    syncAttendance(isCheckedIn, device);

    console.log('[hrms-checkin] toggled →', { checkedIn: isCheckedIn, device: device });
  }

  function refreshUI(wrap, toggle, iconEl, device) {
    device = device || getCheckinDevice();

    if (isCheckedIn) {
      wrap.classList.add('ci-active');
      toggle.classList.add('ci-on');
      toggle.setAttribute('aria-pressed', 'true');
      wrap.title = 'Checked In — click to Check Out';
    } else {
      wrap.classList.remove('ci-active');
      toggle.classList.remove('ci-on');
      toggle.setAttribute('aria-pressed', 'false');
      wrap.title = 'Click to Check In';
    }

    iconEl.innerHTML = deviceIcon(device);
  }

  /* ── find insertion point (replace Settings gear OR insert after theme) ─ */
  function findSettingsBtn(topbar) {
    /* 1. Look for an <a> or <button> linking to /settings */
    var links = topbar.querySelectorAll('a[href*="settings"], button[data-route*="settings"]');
    if (links.length) return { el: links[0], mode: 'replace' };

    /* 2. Look for a gear / settings svg icon inside the topbar */
    var svgs = topbar.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var parent = svgs[i].closest('a, button');
      if (parent) {
        var html = parent.innerHTML.toLowerCase();
        if (html.indexOf('settings') !== -1 || html.indexOf('gear') !== -1) {
          return { el: parent, mode: 'replace' };
        }
      }
    }

    /* 3. Fallback: insert after theme-toggle */
    var theme = document.getElementById('theme-toggle');
    if (theme) return { el: theme, mode: 'after' };

    /* 4. Last resort: before the avatar */
    var av = topbar.querySelector('.av, [class*="avatar"]');
    if (av) return { el: av, mode: 'before' };

    return null;
  }

  /* ── hide/remove Settings from topbar ───────────────────────────────── */
  function openSettingsRoute() {
    try {
      if (window.location.pathname === '/settings') {
        window.history.replaceState(null, '', '/settings');
        window.dispatchEvent(new CustomEvent('hrmsNavigate', { detail: { path: '/settings' } }));
        return;
      }
      window.history.pushState(null, '', '/settings');
      window.dispatchEvent(new CustomEvent('hrmsNavigate', { detail: { path: '/settings' } }));
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (_) {}
  }

  function wireSettingsFallback() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var el = target.closest('a, button, div');
      if (!el) return;
      var text = (el.textContent || '').trim().toLowerCase();
      var title = (el.getAttribute && (el.getAttribute('title') || '').toLowerCase()) || '';
      var aria = (el.getAttribute && (el.getAttribute('aria-label') || '').toLowerCase()) || '';
      var href = (el.getAttribute && (el.getAttribute('href') || '').toLowerCase()) || '';
      var dataRoute = (el.getAttribute && (el.getAttribute('data-route') || '').toLowerCase()) || '';
      var isSettings = text === 'settings' || title.indexOf('setting') !== -1 || aria.indexOf('setting') !== -1 || href.indexOf('/settings') !== -1 || dataRoute.indexOf('/settings') !== -1 || href.indexOf('settings') !== -1;
      if (!isSettings) return;
      e.preventDefault();
      e.stopPropagation();
      openSettingsRoute();
    }, true);
  }

  function hideSettings() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;

    /* 1. href-based: <a href="/settings"> */
    topbar.querySelectorAll('a[href*="settings"]').forEach(function (el) {
      el.style.display = 'none';
    });

    /* 2. title / aria-label containing "settings" (case-insensitive) */
    topbar.querySelectorAll('[title], [aria-label]').forEach(function (el) {
      var title = (el.getAttribute('title') || '').toLowerCase();
      var label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (title.indexOf('setting') !== -1 || label.indexOf('setting') !== -1) {
        el.style.display = 'none';
      }
    });

    /* 3. SVG gear / cog icon detection inside topbar buttons/links */
    topbar.querySelectorAll('button, a').forEach(function (el) {
      var svgs = el.querySelectorAll('svg');
      svgs.forEach(function (svg) {
        var d = svg.innerHTML;
        /* Gear/cog paths typically contain many arcs; look for common gear
           path signatures (M12 or circle + multiple teeth patterns) */
        if (
          /M12[, ]2[ac]/i.test(d) ||
          /gear|cog|settings/i.test(d) ||
          (d.indexOf('rotate') !== -1 && d.indexOf('circle') !== -1)
        ) {
          el.style.display = 'none';
        }
      });
    });

    /* 4. Text-content check: button/link whose visible text is "Settings" */
    topbar.querySelectorAll('button, a, span').forEach(function (el) {
      if (el.children.length === 0 &&
          el.textContent.trim().toLowerCase() === 'settings') {
        var parent = el.closest('button, a') || el;
        parent.style.display = 'none';
      }
    });
  }

  /* ── main injection ──────────────────────────────────────────────────── */
  function ensureWidget() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;

    /* Always hide settings first */
    hideSettings();

    /* already injected? → just refresh state */
    var existingWrap   = document.getElementById(WRAPPER_ID);
    var existingToggle = document.getElementById(TOGGLE_ID);
    if (existingWrap && existingToggle) {
      var iconEl = existingWrap.querySelector('.hrms-ci-icon');
      refreshUI(existingWrap, existingToggle, iconEl);
      return;
    }

    var wrap = buildWrapper();

    var target = findSettingsBtn(topbar);
    if (!target) {
      /* Insert before avatar or append at end */
      var av = topbar.querySelector('.av, [class*="avatar"]');
      if (av) { topbar.insertBefore(wrap, av); }
      else     { topbar.appendChild(wrap); }
      return;
    }

    if (target.mode === 'replace') {
      /* hide the original settings element; insert our widget in its place */
      target.el.style.display = 'none';
      target.el.parentNode.insertBefore(wrap, target.el);
    } else if (target.mode === 'after') {
      var next = target.el.nextSibling;
      if (next) {
        target.el.parentNode.insertBefore(wrap, next);
      } else {
        target.el.parentNode.appendChild(wrap);
      }
    } else {
      target.el.parentNode.insertBefore(wrap, target.el);
    }
  }

  /* ── observe topbar for React re-renders ────────────────────────────── */
  function watchTopbar() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) {
      setTimeout(watchTopbar, 500);
      return;
    }

    ensureWidget();

    var obs = new MutationObserver(function () {
      /* Re-hide settings every time React re-renders the topbar */
      hideSettings();
      if (!document.getElementById(WRAPPER_ID)) {
        ensureWidget();
      }
    });
    obs.observe(topbar, { childList: true, subtree: true });
  }

  /* ── external API (for React context sync) ───────────────────────────── */
  window.addEventListener('hrmsContextUpdate', function (e) {
    if (e.detail && e.detail.checkedIn !== undefined) {
      isCheckedIn = !!e.detail.checkedIn;
      var wrap   = document.getElementById(WRAPPER_ID);
      var toggle = document.getElementById(TOGGLE_ID);
      if (wrap && toggle) {
        var iconEl = wrap.querySelector('.hrms-ci-icon');
        refreshUI(wrap, toggle, iconEl, e.detail.device);
      }
      /* React-origin toggle (employee Check-In/Out page) → persist attendance.
         Topbar toggles go through handleToggle instead, so this never double-fires. */
      if (!e.detail.fromTopbar) {
        syncAttendance(isCheckedIn, e.detail.device);
      }
    }
  });

  window.__hrmsCheckinAPI = {
    toggle: function (device) {
      if (device) localStorage.setItem(STORAGE_DEVICE, device);
      var wrap   = document.getElementById(WRAPPER_ID);
      var toggle = document.getElementById(TOGGLE_ID);
      if (wrap && toggle) {
        var iconEl = wrap.querySelector('.hrms-ci-icon');
        handleToggle(wrap, toggle, iconEl);
      }
    },
    setState: function (state, device) {
      isCheckedIn = !!state;
      if (device) localStorage.setItem(STORAGE_DEVICE, device);
      var wrap   = document.getElementById(WRAPPER_ID);
      var toggle = document.getElementById(TOGGLE_ID);
      if (wrap && toggle) {
        var iconEl = wrap.querySelector('.hrms-ci-icon');
        refreshUI(wrap, toggle, iconEl, device);
      }
    },
    getState: function () {
      return { checkedIn: isCheckedIn, device: getCheckinDevice() };
    }
  };

  /* ── boot ────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireSettingsFallback();
      watchTopbar();
    });
  } else {
    wireSettingsFallback();
    watchTopbar();
  }

  console.log('[hrms-checkin v3] loaded — state:', isCheckedIn, '| device:', getCheckinDevice());
})();
