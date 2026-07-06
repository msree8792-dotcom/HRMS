/**
 * hrms-status.js  v1
 * Adds a presence / STATUS picker to the Settings -> My Profile page,
 * styled after the Zoho-Cliq status selector:
 *   Available · Away · Busy · Invisible · Do not disturb
 *
 * Presence is tied to Check-In (hrms-checkin.js):
 *   - checked out  -> status is forced to "Offline" and the picker is disabled
 *   - on check-in  -> status defaults to "Available"
 *
 * The chosen status is persisted in localStorage and shown as a colored dot
 * on the topbar avatar so it is visible across the whole app.
 *
 * Same no-rebuild injection pattern as hrms-checkin.js / hrms-live.js.
 */
(function () {
  'use strict';

  /* ── storage keys ────────────────────────────────────────────────────── */
  var STORAGE_STATUS  = 'hrms_presence_status';   // available|away|busy|invisible|dnd
  var STORAGE_CHECKIN = 'hrms_checked_in';        // shared with hrms-checkin.js
  var BLOCK_ID        = 'hrms-ps-block';

  /* ── status catalogue ────────────────────────────────────────────────── */
  var STATUSES = [
    { key: 'available', label: 'Available',      color: '#22c55e' },
    { key: 'away',      label: 'Away',           color: '#f59e0b', arrow: true },
    { key: 'busy',      label: 'Busy',           color: '#ef4444' },
    { key: 'invisible', label: 'Invisible',      color: '#9ca3af' },
    { key: 'dnd',       label: 'Do not disturb', color: '#ef4444', bell: true }
  ];
  var CUSTOM = [
    { key: 'travelling', label: 'Travelling',   color: '#06b6d4', custom: true },
    { key: 'meeting',    label: 'In a Meeting', color: '#8b5cf6', custom: true },
    { key: 'coffee',     label: 'Coffee break', color: '#b45309', custom: true }
  ];
  var OFFLINE = { key: 'offline', label: 'Offline', color: '#9ca3af',
                  desc: 'Check in to set your status.' };

  /* panel open/closed is module-level so it survives re-renders */
  var panelOpen = false;

  /* ── backend presence sync (drives the Team Status Now panel) ─────────── */
  function actorEmail() {
    try { return (JSON.parse(localStorage.getItem('hrms_session') || '{}').email) || ''; }
    catch (_) { return ''; }
  }
  function actorName() {
    try {
      var s = JSON.parse(localStorage.getItem('hrms_session') || '{}');
      return (s && (s.name || s.fullName)) || '';
    } catch (_) { return ''; }
  }

  /* Persist the chosen presence to the attendance API so every other employee
     sees it in "Team Status Now". Only meaningful while checked in (the API
     rejects presence changes otherwise). Fires 'hrmsAttendanceSynced' so an
     open Check-In page refreshes its team table immediately. */
  function postPresence(key) {
    var em = actorEmail();
    if (!em) return;
    var st = findStatus(key);
    var label = (st && st.label) || 'Available';
    fetch('/api/attendance/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: em, employee: actorName(), key: key, label: label })
    })
      .then(function () {
        window.dispatchEvent(new CustomEvent('hrmsAttendanceSynced', { detail: {} }));
      })
      .catch(function () {});
  }

  /* ── SVG icons ───────────────────────────────────────────────────────── */
  var CHEVRON =
    '<svg class="hrms-ps-chevron" viewBox="0 0 16 16" fill="none">' +
    '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var BELL =
    '<svg class="hrms-ps-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
    '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  var ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"' +
    ' stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';

  var CHECK =
    '<svg class="hrms-ps-check" viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.4 3.4L13 5"/></svg>';

  function iconHtml(s) {
    if (s.bell)   return '<span class="hrms-ps-ic" style="color:' + s.color + '">' + BELL + '</span>';
    if (s.arrow)  return '<span class="hrms-ps-ic" style="color:' + s.color + '">' + ARROW + '</span>';
    return '<span class="hrms-ps-ic"><span class="hrms-ps-dot" style="background:' + s.color + '"></span></span>';
  }

  function optRow(s, curKey) {
    return '<button type="button" class="hrms-ps-option' + (s.key === curKey ? ' is-active' : '') +
           '" data-key="' + s.key + '">' + iconHtml(s) +
           '<span class="hrms-ps-opt-title">' + s.label + '</span>' +
           (s.key === curKey ? CHECK : '') + '</button>';
  }

  /* ── state helpers ───────────────────────────────────────────────────── */
  function isCheckedIn() {
    return localStorage.getItem(STORAGE_CHECKIN) === 'true';
  }

  function findStatus(key) {
    if (key === 'offline') return OFFLINE;
    var all = STATUSES.concat(CUSTOM);
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === key) return all[i];
    }
    return null;
  }

  /* effective status: offline whenever checked out */
  function getStatusKey() {
    if (!isCheckedIn()) return 'offline';
    var k = localStorage.getItem(STORAGE_STATUS);
    return findStatus(k) && k !== 'offline' ? k : 'available';
  }

  function setStatus(key) {
    if (!isCheckedIn()) return;            // cannot change presence while offline
    if (!findStatus(key) || key === 'offline') return;
    localStorage.setItem(STORAGE_STATUS, key);
    panelOpen = false;
    render();
    paintAvatarDots();
    postPresence(key);            // reflect in Team Status Now (cross-user)
    window.dispatchEvent(new CustomEvent('hrmsStatusChange', { detail: { status: key } }));
    console.log('[hrms-status] status →', key);
  }

  /* ── find the "My Profile" card on the Settings page ─────────────────── */
  function findProfileCard() {
    var titles = document.querySelectorAll('.card-title');
    for (var i = 0; i < titles.length; i++) {
      if (titles[i].textContent.trim() === 'My Profile') {
        return titles[i].closest('.card') || titles[i].parentNode;
      }
    }
    return null;
  }

  /* ── render the picker contents into the block ───────────────────────── */
  function render() {
    var block = document.getElementById(BLOCK_ID);
    if (!block) return;

    var checked = isCheckedIn();
    var curKey  = getStatusKey();
    var cur     = findStatus(curKey);

    var panel =
      '<div class="hrms-ps-section">Default Status</div>' +
      STATUSES.map(function (s) { return optRow(s, curKey); }).join('') +
      '<div class="hrms-ps-section hrms-ps-section-sep">Custom Status</div>' +
      CUSTOM.map(function (s) { return optRow(s, curKey); }).join('');

    block.innerHTML =
      '<div class="hrms-ps-head"><span class="hrms-ps-title">STATUS</span></div>' +
      '<div class="hrms-ps-field">' +
        '<button type="button" class="hrms-ps-control' +
          (checked ? '' : ' is-disabled') + (panelOpen ? ' is-open' : '') + '"' +
          (checked ? '' : ' aria-disabled="true"') + '>' +
          iconHtml(cur) +
          '<span class="hrms-ps-current">' + cur.label + '</span>' +
          CHEVRON +
        '</button>' +
        '<div class="hrms-ps-panel"' + (panelOpen && checked ? '' : ' hidden') + '>' + panel + '</div>' +
      '</div>' +
      (checked ? '' : '<div class="hrms-ps-hint">' + OFFLINE.desc + '</div>');

    /* wire control */
    var ctrl = block.querySelector('.hrms-ps-control');
    ctrl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!isCheckedIn()) return;
      panelOpen = !panelOpen;
      render();
    });

    block.querySelectorAll('.hrms-ps-option').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setStatus(btn.getAttribute('data-key'));
      });
    });
  }

  /* ── inject the block (prefer the #hrms-ps-slot anchor) ──────────────── */
  function ensureBlock() {
    /* already injected? leave it (avoid re-render loops with the observer) */
    if (document.getElementById(BLOCK_ID)) return;

    /* 1. Preferred: the explicit slot rendered inside the My Profile card */
    var slot = document.getElementById('hrms-ps-slot');
    if (slot) {
      var b1 = document.createElement('div');
      b1.id = BLOCK_ID;
      b1.className = 'hrms-ps-block';
      slot.appendChild(b1);
      render();
      return;
    }

    /* 2. Fallback: insert after the My Profile card title */
    var card = findProfileCard();
    if (!card) return;

    var block = document.createElement('div');
    block.id        = BLOCK_ID;
    block.className = 'hrms-ps-block';

    var title = card.querySelector('.card-title');
    if (title && title.nextSibling)      card.insertBefore(block, title.nextSibling);
    else if (title)                      card.appendChild(block);
    else                                 card.insertBefore(block, card.firstChild);

    render();
  }

  /* ── presence dot on the topbar avatar ───────────────────────────────── */
  function paintAvatarDots() {
    var st  = findStatus(getStatusKey());
    var avs = document.querySelectorAll('.topbar .av');
    avs.forEach(function (av) {
      if (getComputedStyle(av).position === 'static') av.style.position = 'relative';
      var dot = av.querySelector('.hrms-presence-dot');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'hrms-presence-dot';
        av.appendChild(dot);
      }
      dot.style.background = st.color;
      dot.title = st.label;
    });
  }

  /* ── react to check-in changes (from topbar OR employee module) ──────── */
  function onCheckinChange() {
    if (isCheckedIn()) {
      var k = localStorage.getItem(STORAGE_STATUS);
      if (!findStatus(k) || k === 'offline') localStorage.setItem(STORAGE_STATUS, 'available');
    } else {
      panelOpen = false;
    }
    render();
    paintAvatarDots();
  }

  window.addEventListener('hrmsCheckinToggle', onCheckinChange);
  window.addEventListener('hrmsContextUpdate', onCheckinChange);
  /* status changed elsewhere (e.g. the avatar drawer's selector) → resync */
  window.addEventListener('hrmsStatusChange', function () {
    render();
    paintAvatarDots();
  });
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_CHECKIN || e.key === STORAGE_STATUS) {
      render();
      paintAvatarDots();
    }
  });

  /* close the panel on outside click */
  document.addEventListener('click', function (e) {
    if (!panelOpen) return;
    var block = document.getElementById(BLOCK_ID);
    if (block && !block.contains(e.target)) {
      panelOpen = false;
      render();
    }
  });

  /* ── boot + observe React re-renders ─────────────────────────────────── */
  function watch() {
    ensureBlock();
    paintAvatarDots();

    var obs = new MutationObserver(function () {
      ensureBlock();       // re-inject if React re-rendered the profile page
      paintAvatarDots();   // keep the avatar dot present after topbar re-renders
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* external API (parity with hrms-checkin.js) */
  window.__hrmsStatusAPI = {
    get:  function () { return getStatusKey(); },
    set:  function (key) { setStatus(key); },
    list: function () { return STATUSES.slice(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }

  console.log('[hrms-status v1] loaded — status:', getStatusKey());
})();
