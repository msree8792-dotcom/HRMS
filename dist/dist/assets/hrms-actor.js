/*
 * HRMS auth + actor attribution (no bundle changes required).
 *
 * Wraps window.fetch to:
 *   1. Capture the session token from the login response (/api/auth/verify-otp
 *      or /api/auth/google) and stash it in localStorage("hrms_token").
 *   2. On same-origin /api/ requests, attach:
 *         Authorization: Bearer <token>   (so protected admin endpoints accept
 *                                          the request once signed in)
 *         X-Actor-Email: <email>          (so the audit log attributes actions)
 *   3. Clear the token on logout (when the app removes hrms_session).
 *
 * When logged out there is no token/session, so nothing is attached and the
 * candidate portal is unaffected.
 */
(function () {
  if (window.__hrmsAuthPatched || !window.fetch) return;
  window.__hrmsAuthPatched = true;

  var nativeFetch = window.fetch.bind(window);
  var SESSION_KEY = "hrms_session";
  var TOKEN_KEY = "hrms_token";

  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function urlOf(input) {
    return typeof input === "string" ? input : (input && input.url) || "";
  }

  function isSameOriginApi(input) {
    var url = urlOf(input);
    if (!url || url.indexOf("/api/") === -1) return false;
    if (/^https?:\/\//i.test(url)) return url.indexOf(location.origin) === 0;
    return true; // relative path -> same origin
  }

  function isAuthLogin(input) {
    var url = urlOf(input);
    return url.indexOf("/api/auth/verify-otp") !== -1 ||
           url.indexOf("/api/auth/google") !== -1;
  }

  window.fetch = function (input, init) {
    try {
      if (isSameOriginApi(input)) {
        var s = session();
        // Logged out: drop any stale token so we don't send it around.
        if (!s) {
          localStorage.removeItem(TOKEN_KEY);
        }
        var token = s ? localStorage.getItem(TOKEN_KEY) : null;
        var email = (s && s.email) || "";

        if (token || email) {
          init = init || {};
          var headers = new Headers(
            init.headers || (typeof input !== "string" && input && input.headers) || {}
          );
          if (token && !headers.has("Authorization")) {
            headers.set("Authorization", "Bearer " + token);
          }
          if (email && !headers.has("X-Actor-Email")) {
            headers.set("X-Actor-Email", email);
          }
          if (email && !headers.has("X-User-Email")) {
            headers.set("X-User-Email", email);
          }
          init.headers = headers;
        }
      }
    } catch (_) {
      /* never let attribution/auth wrapping break a request */
    }

    var p = nativeFetch(input, init);

    // Capture the token returned by a successful login.
    if (isAuthLogin(input)) {
      p.then(function (resp) {
        try {
          if (resp && resp.ok) {
            resp.clone().json().then(function (data) {
              if (data && data.token) localStorage.setItem(TOKEN_KEY, data.token);
            }).catch(function () {});
          }
        } catch (_) {}
        return resp;
      });
    }
    return p;
  };
})();
