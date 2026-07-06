/**
 * hrms-linkedin.js
 * Per-user "Connect LinkedIn" button for Settings -> Email Configuration ->
 * Social Media Accounts. Each recruiter links their OWN LinkedIn account via
 * OAuth; the token is stored server-side in user_email_config.social.linkedin
 * and used to auto-post new jobs to that recruiter's profile.
 *
 * Backend endpoints (see api/linkedin_oauth.py):
 *   GET  /api/auth/linkedin/connect?userEmail=...   (popup -> LinkedIn)
 *   GET  /api/auth/linkedin/status?userEmail=...
 *   POST /api/auth/linkedin/disconnect  {userEmail}
 *
 * Also tags POST /api/jobs with the logged-in userEmail so a job posts under
 * its creator's account (never a fallback to someone else's).
 *
 * Same injection approach as google-auth.js — no React bundle rebuild needed.
 */
(function () {
  'use strict';

  var API = '/api';
  var ROW_ID = 'hrms-li-row';
  var POLL_MS = 800;
  var configured = null; // unknown until /api/config resolves

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  function currentEmail() {
    try {
      var u = JSON.parse(localStorage.getItem('hrms_user') || 'null');
      return (u && (u.email || u.userEmail || u.mail)) || '';
    } catch (e) { return ''; }
  }

  function apiGet(path) {
    return fetch(API + path, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function showToast(msg, type) {
    var existing = document.getElementById('hrms-li-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'hrms-li-toast';
    el.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:99999', 'padding:12px 22px', 'border-radius:10px',
      'font-family:inherit', 'font-size:14px', 'font-weight:600',
      'box-shadow:0 4px 20px rgba(0,0,0,0.18)', 'color:#fff',
      'background:' + (type === 'error' ? '#ef4444' : '#0a66c2'),
      'pointer-events:none', 'transition:opacity 0.4s',
    ].join(';');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 3000);
    setTimeout(function () { el.remove(); }, 3500);
  }

  var LI_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex:none">' +
    '<path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>';

  // -------------------------------------------------------------------------
  // find the LinkedIn URL input inside the Social Media Accounts section
  // -------------------------------------------------------------------------
  function findLinkedInInput() {
    var inputs = document.querySelectorAll('input[type="text"], input[type="url"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var ph = (inputs[i].placeholder || '').toLowerCase();
      if (ph.indexOf('linkedin.com') >= 0) return inputs[i];
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // render the status row (button + label) under the LinkedIn input
  // -------------------------------------------------------------------------
  function makeButton(label, bg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = [
      'display:inline-flex', 'align-items:center', 'gap:8px',
      'padding:8px 14px', 'border-radius:8px', 'border:none',
      'background:' + bg, 'color:#fff', 'font-size:13px', 'font-weight:600',
      'cursor:pointer', 'font-family:inherit', 'transition:opacity 0.2s',
    ].join(';');
    b.onmouseover = function () { b.style.opacity = '0.88'; };
    b.onmouseout = function () { b.style.opacity = '1'; };
    b.innerHTML = label;
    return b;
  }

  function renderRow(row, state) {
    row.innerHTML = '';
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap';
    var email = currentEmail();

    if (configured === false) {
      var note = document.createElement('span');
      note.style.cssText = 'font-size:12.5px;color:var(--text-muted,#94a3b8)';
      note.textContent = 'LinkedIn auto-posting isn’t set up yet — ask your administrator to configure it.';
      row.appendChild(note);
      return;
    }
    if (!email) {
      var n2 = document.createElement('span');
      n2.style.cssText = 'font-size:12.5px;color:var(--text-muted,#94a3b8)';
      n2.textContent = 'Sign in to connect your LinkedIn account.';
      row.appendChild(n2);
      return;
    }

    if (state && state.connected && !state.expired) {
      var ok = document.createElement('span');
      ok.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#16a34a';
      ok.innerHTML = '<span style="color:#0a66c2">' + LI_ICON + '</span> Connected' +
        (state.name ? ' as ' + escapeHtml(state.name) : '');
      var dis = document.createElement('button');
      dis.type = 'button';
      dis.textContent = 'Disconnect';
      dis.style.cssText = 'background:none;border:none;color:#ef4444;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:underline;font-family:inherit';
      dis.onclick = function () { doDisconnect(row); };
      row.appendChild(ok);
      row.appendChild(dis);
      return;
    }

    if (state && state.expired) {
      var warn = document.createElement('span');
      warn.style.cssText = 'font-size:12.5px;color:#d97706;font-weight:600';
      warn.textContent = 'Connection expired';
      var re = makeButton(LI_ICON + ' Reconnect LinkedIn', '#0a66c2');
      re.onclick = function () { doConnect(row); };
      row.appendChild(warn);
      row.appendChild(re);
      return;
    }

    var btn = makeButton(LI_ICON + ' Connect LinkedIn', '#0a66c2');
    btn.onclick = function () { doConnect(row); };
    row.appendChild(btn);
    var hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted,#94a3b8)';
    hint.textContent = 'Required to auto-post new jobs to your profile.';
    row.appendChild(hint);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------
  function refreshStatus(row) {
    var email = currentEmail();
    if (!email) { renderRow(row, null); return; }
    apiGet('/auth/linkedin/status?userEmail=' + encodeURIComponent(email))
      .then(function (s) {
        if (typeof s.configured === 'boolean') configured = s.configured;
        renderRow(row, s);
      })
      .catch(function () { renderRow(row, null); });
  }

  function doConnect(row) {
    var email = currentEmail();
    if (!email) { showToast('Please sign in first.', 'error'); return; }
    var w = 600, h = 720;
    var y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    var x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
    var url = API + '/auth/linkedin/connect?userEmail=' + encodeURIComponent(email);
    var popup = window.open(url, 'hrms-linkedin-connect',
      'width=' + w + ',height=' + h + ',top=' + y + ',left=' + x);
    if (!popup) { showToast('Allow popups to connect LinkedIn.', 'error'); return; }
    // Poll for the popup closing as a fallback to postMessage.
    var iv = setInterval(function () {
      if (popup.closed) { clearInterval(iv); setTimeout(function () { refreshStatus(row); }, 400); }
    }, 700);
  }

  function doDisconnect(row) {
    var email = currentEmail();
    if (!email) return;
    apiPost('/auth/linkedin/disconnect', { userEmail: email })
      .then(function () { showToast('LinkedIn disconnected.'); refreshStatus(row); })
      .catch(function () { showToast('Could not disconnect. Try again.', 'error'); });
  }

  // postMessage from the OAuth popup (api/linkedin_oauth._popup_result)
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'hrms-linkedin') return;
    showToast(d.message || (d.ok ? 'LinkedIn connected.' : 'LinkedIn connection failed.'),
      d.ok ? 'success' : 'error');
    var row = document.getElementById(ROW_ID);
    if (row) setTimeout(function () { refreshStatus(row); }, 300);
  });

  // -------------------------------------------------------------------------
  // injection sync — keep the row present whenever the LinkedIn input shows
  // -------------------------------------------------------------------------
  function sync() {
    var input = findLinkedInInput();
    var existing = document.getElementById(ROW_ID);
    if (!input) { if (existing) existing.remove(); return; }
    if (existing) {
      // Make sure it still sits right after the input's field wrapper.
      return;
    }
    var row = document.createElement('div');
    row.id = ROW_ID;
    // Insert after the input's immediate wrapper (label/field group).
    var anchor = input;
    if (input.parentElement && input.parentElement.parentElement) {
      anchor = input.parentElement; // the field wrapper
    }
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
    renderRow(row, null);
    refreshStatus(row);
  }

  // -------------------------------------------------------------------------
  // job-create interceptor — attach the logged-in userEmail to POST /api/jobs
  // so the backend posts under the creator's own LinkedIn (not a fallback).
  // -------------------------------------------------------------------------
  function isJobsPost(url, method) {
    if (!url) return false;
    var m = (method || 'GET').toUpperCase();
    if (m !== 'POST') return false;
    return /\/api\/jobs(\?|$)/.test(String(url));
  }

  function withUserEmail(bodyStr) {
    try {
      var obj = JSON.parse(bodyStr);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (!obj.userEmail) {
          var em = currentEmail();
          if (em) obj.userEmail = em;
        }
        return JSON.stringify(obj);
      }
    } catch (e) {}
    return bodyStr;
  }

  // Wrap fetch
  var _fetch = window.fetch;
  if (_fetch && !_fetch.__hrmsLiWrapped) {
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url);
        var method = (init && init.method) || (input && input.method) || 'GET';
        if (isJobsPost(url, method) && init && typeof init.body === 'string') {
          init = Object.assign({}, init, { body: withUserEmail(init.body) });
        }
      } catch (e) {}
      return _fetch.call(this, input, init);
    };
    window.fetch.__hrmsLiWrapped = true;
  }

  // Wrap XMLHttpRequest (covers axios and other XHR-based clients)
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  if (!_open.__hrmsLiWrapped) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__hrmsLi = { method: method, url: url };
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        var meta = this.__hrmsLi;
        if (meta && isJobsPost(meta.url, meta.method) && typeof body === 'string') {
          body = withUserEmail(body);
        }
      } catch (e) {}
      return _send.call(this, body);
    };
    XMLHttpRequest.prototype.open.__hrmsLiWrapped = true;
  }

  // -------------------------------------------------------------------------
  // boot
  // -------------------------------------------------------------------------
  function boot() {
    apiGet('/config')
      .then(function (cfg) {
        if (cfg && typeof cfg.linkedinConfigured === 'boolean') configured = cfg.linkedinConfigured;
      })
      .catch(function () {})
      .then(function () {
        setInterval(sync, POLL_MS);
        setTimeout(sync, 600);
        setTimeout(sync, 1500);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
