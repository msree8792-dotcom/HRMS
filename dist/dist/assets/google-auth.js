/**
 * google-auth.js
 * Injects a "Continue with Google" button into the HRMS login/signup form.
 * Communicates with POST /api/auth/google (backend verifies the Google ID token).
 *
 * Requires: Google Identity Services script loaded in index.html
 *   <script src="https://accounts.google.com/gsi/client" async defer></script>
 *
 * GOOGLE_CLIENT_ID must be set on the backend (.env) AND here (or fetched from /api/config).
 * For now we read it from a meta tag or window.__GOOGLE_CLIENT_ID if set at deploy time.
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Config — loaded from GET /api/config at boot (reads GOOGLE_CLIENT_ID from .env).
  // Can also be overridden via window.__GOOGLE_CLIENT_ID or a <meta> tag.
  // -------------------------------------------------------------------------
  var GOOGLE_CLIENT_ID =
    window.__GOOGLE_CLIENT_ID ||
    (document.querySelector('meta[name="google-client-id"]') || {}).content ||
    '';

  var API_BASE = '/api';
  var DIVIDER_ID = 'hrms-google-divider';
  var BTN_ID = 'hrms-google-btn';

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function showToast(msg, type) {
    var existing = document.getElementById('hrms-google-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'hrms-google-toast';
    el.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:99999', 'padding:12px 22px', 'border-radius:10px',
      'font-family:inherit', 'font-size:14px', 'font-weight:600',
      'box-shadow:0 4px 20px rgba(0,0,0,0.18)',
      'color:#fff',
      'background:' + (type === 'error' ? '#ef4444' : '#22c55e'),
      'pointer-events:none', 'transition:opacity 0.4s',
    ].join(';');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 2800);
    setTimeout(function () { el.remove(); }, 3300);
  }

  // -------------------------------------------------------------------------
  // Google callback — called by GSI after user picks an account
  // -------------------------------------------------------------------------
  window.__hrmsGoogleCallback = function (response) {
    if (!response || !response.credential) {
      showToast('Google sign-in was cancelled.', 'error');
      return;
    }
    var btn = document.getElementById(BTN_ID);
    if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }

    apiPost('/auth/google', { idToken: response.credential })
      .then(function (data) {
        if (!data.ok) {
          showToast(data.message || 'Google sign-in failed.', 'error');
          if (btn) { btn.textContent = 'Continue with Google'; btn.disabled = false; }
          return;
        }
        // Persist user in localStorage the same way the React app expects
        try { localStorage.setItem('hrms_user', JSON.stringify(data.user)); } catch (e) {}

        showToast(data.isNew ? 'Account created! Welcome 🎉' : 'Signed in successfully!', 'success');

        // Let React re-hydrate by dispatching a storage event (AuthContext listens)
        try { window.dispatchEvent(new StorageEvent('storage', { key: 'hrms_user' })); } catch (e) {}

        // Hard redirect after a short pause so React can pick up the auth state
        setTimeout(function () {
          window.location.href = '/dashboard';
        }, 600);
      })
      .catch(function (err) {
        console.error('[Google Auth]', err);
        showToast('Network error during Google sign-in.', 'error');
        if (btn) { btn.textContent = 'Continue with Google'; btn.disabled = false; }
      });
  };

  // -------------------------------------------------------------------------
  // Build the Google button DOM
  // -------------------------------------------------------------------------
  function buildGoogleButton() {
    var divider = document.createElement('div');
    divider.id = DIVIDER_ID;
    divider.style.cssText =
      'display:flex;align-items:center;gap:10px;margin:16px 0;';
    divider.innerHTML =
      '<div style="flex:1;height:1px;background:var(--border,#e2e8f0)"></div>' +
      '<span style="font-size:12px;color:var(--text-muted,#94a3b8);white-space:nowrap">or continue with</span>' +
      '<div style="flex:1;height:1px;background:var(--border,#e2e8f0)"></div>';

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:10px',
      'width:100%', 'padding:11px 16px', 'border-radius:10px',
      'border:1.5px solid var(--border,#e2e8f0)', 'background:var(--surface,#fff)',
      'color:var(--text,#1e293b)', 'font-size:14px', 'font-weight:600',
      'cursor:pointer', 'transition:all 0.2s', 'font-family:inherit',
    ].join(';');
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 48 48">' +
      '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
      '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
      '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
      '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
      '</svg>' +
      'Continue with Google';

    btn.onmouseover = function () {
      btn.style.background = 'var(--surface-hover,#f8fafc)';
      btn.style.borderColor = '#4285F4';
    };
    btn.onmouseout = function () {
      btn.style.background = 'var(--surface,#fff)';
      btn.style.borderColor = 'var(--border,#e2e8f0)';
    };

    btn.addEventListener('click', function () {
      if (!GOOGLE_CLIENT_ID) {
        showToast('Google Sign-In is not configured. Contact your administrator.', 'error');
        return;
      }
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.prompt();
      } else {
        showToast('Google Sign-In is loading. Please try again.', 'error');
      }
    });

    return { divider: divider, btn: btn };
  }

  // -------------------------------------------------------------------------
  // Initialise GSI and inject button into login/signup form
  // -------------------------------------------------------------------------
  function initGoogle() {
    if (!GOOGLE_CLIENT_ID) return; // Silently skip if not configured
    if (!window.google || !window.google.accounts) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: window.__hrmsGoogleCallback,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  }

  function _isLoginOrSignupPage() {
    var heading = document.querySelector('h1, h2, h3');
    if (!heading) return false;
    var h = (heading.textContent || '').toLowerCase();

    var passwordInputs = document.querySelectorAll('input[type="password"]');

    // Login: exactly one password field, heading says "welcome back"
    if (passwordInputs.length === 1 && h.includes('welcome')) return true;

    // Sign Up: BOTH password fields must be present before we inject
    // (React renders confirm-password after the initial mount — wait for it)
    if (passwordInputs.length === 2 && (h.includes('create') || h.includes('sign up') || h.includes('register'))) return true;

    return false;
  }

  function removeButton() {
    var old = document.getElementById(DIVIDER_ID);
    if (old) old.remove();
    var oldBtn = document.getElementById(BTN_ID);
    if (oldBtn) oldBtn.remove();
  }

  function tryInjectButton() {
    if (!_isLoginOrSignupPage()) {
      // Remove stale button if we navigated away from login/signup within the same SPA route
      removeButton();
      return;
    }

    // Already injected?
    if (document.getElementById(DIVIDER_ID)) return;

    var passwordInputs = document.querySelectorAll('input[type="password"]');
    var passwordInput = passwordInputs[0];
    // Walk up to find the form or a suitable parent container
    var form = passwordInput.closest('form') || passwordInput.parentElement;
    if (!form) return;

    var els = buildGoogleButton();

    // Anchor to the LAST password input's closest direct-form-child wrapper.
    // This is stable — React has already rendered all password fields by the
    // time _isLoginOrSignupPage() passes (requires 2 inputs for signup).
    var allPwdInputs = Array.from(form.querySelectorAll('input[type="password"]'));
    var lastPwd = allPwdInputs[allPwdInputs.length - 1];

    // Walk up to find the direct child of `form` that contains this input
    var anchor = lastPwd;
    while (anchor && anchor.parentNode !== form) { anchor = anchor.parentNode; }

    if (anchor && anchor.nextSibling) {
      // Insert divider + button after the last password wrapper
      form.insertBefore(els.divider, anchor.nextSibling);
      form.insertBefore(els.btn, els.divider.nextSibling);
    } else if (anchor) {
      form.appendChild(els.divider);
      form.appendChild(els.btn);
    } else {
      // Fallback: insert before the submit button
      var allBtns = Array.from(form.querySelectorAll('button'));
      var submitBtn = allBtns.find(function (b) {
        var t = (b.textContent || '').toLowerCase();
        return t.includes('sign in') || t.includes('create') || t.includes('register');
      }) || allBtns[allBtns.length - 1];
      if (submitBtn) {
        submitBtn.parentNode.insertBefore(els.btn, submitBtn);
        submitBtn.parentNode.insertBefore(els.divider, els.btn);
      }
    }

    initGoogle();
  }

  // -------------------------------------------------------------------------
  // Sync: called periodically and on navigation — ensures button shows only
  // on login/signup, and is removed everywhere else (including same-route
  // view toggles like "Forgot password?" which don't change the URL).
  // Also detects and corrects misplaced buttons (injected before React
  // finished rendering all form fields).
  // -------------------------------------------------------------------------
  function _isButtonMisplaced() {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return false;
    var form = btn.closest('form');
    if (!form) return false;

    // For signup: button must come AFTER both password wrappers
    var pwdInputs = form.querySelectorAll('input[type="password"]');
    if (pwdInputs.length < 2) return false; // can't tell yet

    var lastPwd = pwdInputs[pwdInputs.length - 1];
    var lastPwdWrapper = lastPwd;
    while (lastPwdWrapper && lastPwdWrapper.parentNode !== form) { lastPwdWrapper = lastPwdWrapper.parentNode; }
    if (!lastPwdWrapper) return false;

    // Button is misplaced if it appears BEFORE the last password wrapper in DOM
    return !!(btn.compareDocumentPosition(lastPwdWrapper) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function syncButton() {
    var hasButton = !!document.getElementById(DIVIDER_ID);
    var shouldHave = _isLoginOrSignupPage();
    if (hasButton && !shouldHave) {
      removeButton();
    } else if (hasButton && shouldHave && _isButtonMisplaced()) {
      // Button exists but is in the wrong position — re-inject after React settles
      removeButton();
      setTimeout(tryInjectButton, 200);
    } else if (!hasButton && shouldHave) {
      tryInjectButton();
    }
  }

  function startObserver() {
    // Poll every 600ms — lightweight enough, avoids MutationObserver feedback loops
    setInterval(syncButton, 600);

    // Also react immediately on SPA navigation
    var _pushState = history.pushState;
    history.pushState = function () {
      _pushState.apply(history, arguments);
      removeButton(); // remove immediately on navigate
      setTimeout(syncButton, 600);
      setTimeout(syncButton, 1200);
    };
    window.addEventListener('popstate', function () {
      removeButton();
      setTimeout(syncButton, 600);
      setTimeout(syncButton, 1200);
    });
  }

  // -------------------------------------------------------------------------
  // Boot — fetch client config first, then start injection
  // -------------------------------------------------------------------------
  function boot() {
    // Fetch Google Client ID from backend config endpoint
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.googleClientId && !GOOGLE_CLIENT_ID) {
          GOOGLE_CLIENT_ID = cfg.googleClientId;
        }
        startObserver();
        setTimeout(syncButton, 800);
        setTimeout(syncButton, 1600);
        setTimeout(syncButton, 2500);
      })
      .catch(function () {
        // Config fetch failed — still start observer (button shows "not configured" on click)
        startObserver();
        setTimeout(syncButton, 800);
        setTimeout(syncButton, 1600);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
