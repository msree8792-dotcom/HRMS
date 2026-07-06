/*
 * HRMS Live Interview — peer-to-peer WebRTC.
 *
 * Publisher (candidate): the bundle calls window.HRMSLive.publish(stream, meta)
 *   when the candidate's AI interview starts. We create an RTCPeerConnection,
 *   add the camera/mic tracks, POST the SDP offer to /api/live/start and poll
 *   the session row for the recruiter's answer + ICE candidates.
 *
 * Viewer (recruiter): a floating "Live Interviews" button opens a monitor that
 *   lists active sessions (GET /api/live) and joins one as a receive-only peer,
 *   completing signaling via /api/live/<id>/answer + /ice and showing the feed.
 *
 * Signaling is exchanged by polling the backend; the audio/video itself flows
 * directly browser-to-browser, so no media server is required.
 */
(function () {
  if (window.HRMSLive) return;
  var ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ];

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    }).catch(function (e) { return { ok: false, status: 0, data: { message: String(e) } }; });
  }
  function get(path) {
    return fetch(path).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    }).catch(function (e) { return { ok: false, status: 0, data: { message: String(e) } }; });
  }
  function session() {
    try { return JSON.parse(localStorage.getItem("hrms_session") || "null"); }
    catch (_) { return null; }
  }

  // ====================================================================
  // Publisher (candidate)
  // ====================================================================
  var pub = null;

  async function publish(stream, meta) {
    if (!window.RTCPeerConnection || !stream) return null;
    meta = meta || {};
    try {
      stop();
      var sid = "live_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      var pc = new RTCPeerConnection({ iceServers: ICE });
      stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
      var state = { sid: sid, pc: pc, closed: false, recruiterIce: 0, answered: false, poll: null, hb: null, started: false, iceQueue: [] };
      pub = state;

      // ICE candidates start firing the instant setLocalDescription() runs —
      // which is BEFORE /api/live/start has created the session row. Posting
      // them too early 404s and the (critical host) candidates are lost, so
      // the peer connection never completes ("Connection: failed"). Buffer
      // until the session exists, then flush.
      pc.onicecandidate = function (e) {
        if (e.candidate && !state.closed) {
          var c = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
          if (!state.started) { state.iceQueue.push(c); return; }
          post("/api/live/" + sid + "/ice", { role: "candidate", candidate: c });
        }
      };

      var offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await post("/api/live/start", {
        sessionId: sid,
        candidateName: meta.candidateName || "Candidate",
        role: meta.role || "",
        interviewId: meta.interviewId || null,
        offer: JSON.stringify(pc.localDescription)
      });

      // Session row now exists — flush any ICE candidates gathered while it
      // was being created, then send the rest live.
      state.started = true;
      var queued = state.iceQueue; state.iceQueue = [];
      queued.forEach(function (c) {
        if (!state.closed) post("/api/live/" + sid + "/ice", { role: "candidate", candidate: c });
      });

      state.poll = setInterval(async function () {
        if (state.closed) return;
        var r = await get("/api/live/" + sid);
        if (!r.ok || !r.data) return;
        if (!state.answered && r.data.answer) {
          state.answered = true;
          try { await pc.setRemoteDescription(JSON.parse(r.data.answer)); } catch (_) {}
        }
        var ice = r.data.recruiterIce || [];
        for (var i = state.recruiterIce; i < ice.length; i++) {
          try { await pc.addIceCandidate(ice[i]); } catch (_) {}
        }
        state.recruiterIce = ice.length;
      }, 2500);

      // Heartbeat keeps the session listed as "live" for recruiters.
      state.hb = setInterval(function () {
        if (!state.closed) post("/api/live/" + sid + "/update", { status: "live" });
      }, 20000);

      return sid;
    } catch (e) {
      console.warn("[HRMSLive] publish failed:", e);
      return null;
    }
  }

  function update(fields) {
    if (pub && !pub.closed) post("/api/live/" + pub.sid + "/update", fields || {});
  }

  // Live captions: the React bundle calls these as the candidate speaks so the
  // recruiter monitor can show, in real time, what's being said. captionBuf
  // accumulates the finalized text for the current question; interim words are
  // appended transiently. Reset at the start of each new question.
  var captionBuf = "";
  function pushCaption(finalChunk, interim) {
    captionBuf += finalChunk || "";
    update({ transcript: (captionBuf + (interim || "")).slice(-800) });
  }
  function resetCaption(question) {
    captionBuf = "";
    update({ currentQuestion: question || "", transcript: "" });
  }
  window.__hrmsPushCaption = pushCaption;
  window.__hrmsResetCaption = resetCaption;

  function stop() {
    if (!pub) return;
    var s = pub; pub = null; s.closed = true;
    try { clearInterval(s.poll); } catch (_) {}
    try { clearInterval(s.hb); } catch (_) {}
    try { post("/api/live/" + s.sid + "/end", {}); } catch (_) {}
    try { s.pc.close(); } catch (_) {}
  }

  // ====================================================================
  // Viewer (recruiter) — overlay UI
  // ====================================================================
  var monitor = null; // active viewer connection

  function css(el, styles) { for (var k in styles) el.style[k] = styles[k]; return el; }

  function closeViewer() {
    if (!monitor) return;
    var m = monitor; monitor = null; m.closed = true;
    try { clearInterval(m.poll); } catch (_) {}
    try { m.pc.close(); } catch (_) {}
  }

  async function joinSession(sid, videoEl, statusEl, cc) {
    closeViewer();
    var pc = new RTCPeerConnection({ iceServers: ICE });
    var state = { sid: sid, pc: pc, closed: false, candIce: 0, poll: null };
    monitor = state;

    var remote = new MediaStream();
    pc.ontrack = function (e) {
      (e.streams && e.streams[0] ? e.streams[0] : remote).getTracks().forEach(function (t) {
        if (remote.getTracks().indexOf(t) === -1) remote.addTrack(t);
      });
      videoEl.srcObject = e.streams && e.streams[0] ? e.streams[0] : remote;
      videoEl.play().catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      if (statusEl) statusEl.textContent = "Connection: " + pc.connectionState;
    };
    pc.onicecandidate = function (e) {
      if (e.candidate && !state.closed) {
        post("/api/live/" + sid + "/ice", {
          role: "recruiter",
          candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate
        });
      }
    };

    var r = await get("/api/live/" + sid);
    if (!r.ok || !r.data || !r.data.offer) {
      if (statusEl) statusEl.textContent = "Could not load this session (it may have ended).";
      return;
    }
    try {
      await pc.setRemoteDescription(JSON.parse(r.data.offer));
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await post("/api/live/" + sid + "/answer", { answer: JSON.stringify(pc.localDescription) });
    } catch (e) {
      if (statusEl) statusEl.textContent = "Failed to connect: " + e;
      return;
    }

    state.poll = setInterval(async function () {
      if (state.closed) return;
      var rr = await get("/api/live/" + sid);
      if (!rr.ok || !rr.data) return;
      var ice = rr.data.candidateIce || [];
      for (var i = state.candIce; i < ice.length; i++) {
        try { await pc.addIceCandidate(ice[i]); } catch (_) {}
      }
      state.candIce = ice.length;
      // Live captions pushed by the candidate as they speak.
      if (cc) {
        if (cc.q) cc.q.textContent = rr.data.currentQuestion ? ("Q: " + rr.data.currentQuestion) : "";
        if (cc.t) cc.t.textContent = rr.data.transcript || "Waiting for the candidate to speak…";
      }
      if (rr.data.status === "ended" && statusEl) statusEl.textContent = "Candidate ended the session.";
    }, 2500);
  }

  function buildOverlay() {
    var wrap = css(document.createElement("div"), {
      position: "fixed", inset: "0", zIndex: "100000",
      background: "rgba(2,6,23,0.78)", display: "flex",
      alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)"
    });
    var card = css(document.createElement("div"), {
      background: "#0f172a", color: "#e2e8f0", borderRadius: "16px",
      width: "min(900px,94vw)", maxHeight: "90vh", overflow: "auto",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)", border: "1px solid #1e293b",
      fontFamily: "'Segoe UI',Arial,sans-serif"
    });
    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'padding:18px 22px;border-bottom:1px solid #1e293b;background:linear-gradient(135deg,#4f8ef7,#a855f7);border-radius:16px 16px 0 0;">' +
      '<div style="font-size:17px;font-weight:800;color:#fff;">🔴 Live Interviews</div>' +
      '<button data-x style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:18px;' +
      'width:30px;height:30px;border-radius:8px;cursor:pointer;">×</button></div>' +
      '<div style="padding:18px 22px;">' +
      '<div data-list></div>' +
      '<div data-stage style="display:none;margin-top:14px;">' +
      '<video data-video autoplay playsinline style="width:100%;border-radius:12px;background:#000;aspect-ratio:16/9;"></video>' +
      '<div data-cc style="margin-top:10px;background:rgba(0,0,0,0.55);border:1px solid #1e293b;border-radius:8px;padding:8px 12px;max-height:120px;overflow-y:auto;">' +
      '<div style="font-size:10px;color:#64748b;margin-bottom:3px;">🎤 Live Captions</div>' +
      '<div data-cc-q style="font-size:11px;color:#94a3b8;margin-bottom:4px;font-style:italic;"></div>' +
      '<div data-cc-t style="font-size:14px;color:#e2e8f0;line-height:1.5;">Waiting for the candidate to speak…</div>' +
      '</div>' +
      '<div data-status style="font-size:12px;color:#94a3b8;margin-top:8px;"></div>' +
      '<button data-leave style="margin-top:10px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;' +
      'padding:8px 16px;border-radius:8px;cursor:pointer;">← Back to list</button>' +
      '</div></div>';
    wrap.appendChild(card);

    var listEl = card.querySelector("[data-list]");
    var stageEl = card.querySelector("[data-stage]");
    var videoEl = card.querySelector("[data-video]");
    var statusEl = card.querySelector("[data-status]");
    var ccQEl = card.querySelector("[data-cc-q]");
    var ccTEl = card.querySelector("[data-cc-t]");
    var cc = { q: ccQEl, t: ccTEl };
    var refresh = null;

    function teardown() {
      try { clearInterval(refresh); } catch (_) {}
      closeViewer();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
    card.querySelector("[data-x]").onclick = teardown;
    wrap.onclick = function (e) { if (e.target === wrap) teardown(); };
    card.querySelector("[data-leave]").onclick = function () {
      closeViewer();
      stageEl.style.display = "none";
      listEl.style.display = "block";
      videoEl.srcObject = null;
      if (cc.q) cc.q.textContent = "";
      if (cc.t) cc.t.textContent = "Waiting for the candidate to speak…";
    };

    async function renderList() {
      var r = await get("/api/live");
      var rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
      if (!rows.length) {
        listEl.innerHTML = '<div style="text-align:center;color:#64748b;padding:34px 0;font-size:14px;">' +
          'No interviews are live right now.<br><span style="font-size:12px;">' +
          'When a candidate starts their AI interview, it appears here.</span></div>';
        return;
      }
      listEl.innerHTML = rows.map(function (s) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
          'padding:13px 14px;border:1px solid #1e293b;border-radius:10px;margin-bottom:10px;background:#0b1220;">' +
          '<div><div style="font-weight:700;font-size:14px;">' + esc(s.candidateName || "Candidate") + '</div>' +
          '<div style="font-size:12px;color:#94a3b8;">' + esc(s.role || "") +
          ' · <span style="color:#22d3a5;">● live</span></div></div>' +
          '<button data-join="' + esc(s.sessionId) + '" style="background:linear-gradient(135deg,#4f8ef7,#a855f7);' +
          'border:none;color:#fff;font-weight:700;font-size:12px;padding:8px 16px;border-radius:8px;cursor:pointer;">▶ Join</button>' +
          '</div>';
      }).join("");
      Array.prototype.forEach.call(listEl.querySelectorAll("[data-join]"), function (btn) {
        btn.onclick = function () {
          var sid = btn.getAttribute("data-join");
          listEl.style.display = "none";
          stageEl.style.display = "block";
          statusEl.textContent = "Connecting…";
          if (cc.q) cc.q.textContent = "";
          if (cc.t) cc.t.textContent = "Waiting for the candidate to speak…";
          joinSession(sid, videoEl, statusEl, cc);
        };
      });
    }

    document.body.appendChild(wrap);
    renderList();
    refresh = setInterval(function () { if (stageEl.style.display === "none") renderList(); }, 4000);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function openMonitor() { buildOverlay(); }

  // ====================================================================
  // Floating launcher button (recruiters / admins)
  // ====================================================================
  function mountButton() {
    if (document.getElementById("hrms-live-btn")) return;
    // Mount unconditionally and toggle visibility on the login state — the app
    // is a SPA, so we won't get a fresh page load after the user signs in.
    var btn = document.createElement("button");
    btn.id = "hrms-live-btn";
    css(btn, {
      position: "fixed", right: "20px", bottom: "84px", zIndex: "99999",
      background: "linear-gradient(135deg,#f43f5e,#a855f7)", color: "#fff",
      border: "none", borderRadius: "30px", padding: "12px 18px", cursor: "pointer",
      fontFamily: "'Segoe UI',Arial,sans-serif", fontWeight: "700", fontSize: "13px",
      boxShadow: "0 8px 24px rgba(244,63,94,0.45)", alignItems: "center", gap: "8px",
      display: (session() && !new URLSearchParams(location.search).get("candidateEmail")) ? "flex" : "none"
    });
    btn.innerHTML = '🔴 Live Interviews <span id="hrms-live-count" style="background:rgba(255,255,255,0.25);' +
      'border-radius:10px;padding:1px 8px;font-size:11px;display:none;">0</span>';
    btn.onclick = openMonitor;
    document.body.appendChild(btn);

    async function tick() {
      if (!session() || new URLSearchParams(location.search).get("candidateEmail")) { btn.style.display = "none"; return; }
      btn.style.display = "flex";
      var r = await get("/api/live");
      var n = (r.ok && Array.isArray(r.data)) ? r.data.length : 0;
      var c = document.getElementById("hrms-live-count");
      if (c) { c.textContent = n; c.style.display = n ? "inline-block" : "none"; }
    }
    tick();
    setInterval(tick, 8000);
  }

  window.HRMSLive = { publish: publish, stop: stop, update: update, openMonitor: openMonitor };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
