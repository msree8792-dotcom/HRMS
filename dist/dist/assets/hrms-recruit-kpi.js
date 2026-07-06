/**
 * hrms-recruit-kpi.js  v1
 * Recruitment KPI Dashboard — a full-screen analytics overlay.
 *
 * Injects a "📊 KPI Dashboard" button into the Recruitment page and opens a
 * rich analytics modal wired to GET /api/recruitment/kpis.
 *
 * Tabs (individual):  Overview | Pipeline | Resume Scoring | Recordings | Trends
 * Tabs (admin extra): Jobs | Team Performance
 *
 * Same no-rebuild injection pattern as hrms-rbac.js / hrms-attendance.js.
 */
(function () {
  'use strict';

  var OVERLAY_ID  = 'hrms-kpi-overlay';
  var BTN_ID      = 'hrms-kpi-btn';
  var REFRESH_MS  = 60000;

  var state = {
    tab:    'overview',
    scope:  'me',
    range:  'all',
    data:   null,
    loading: false,
    timer:  null,
  };

  /* ── session helpers ──────────────────────────────────────────────────── */
  function session() {
    try { return JSON.parse(localStorage.getItem('hrms_session') || '{}'); }
    catch (_) { return {}; }
  }
  function actorEmail() { return (session().email || '').trim(); }
  function isAdmin() {
    var s = session();
    var r = (s.role || s.userRole || '').toLowerCase();
    return r === 'admin' || r === 'hr' || r === 'hr manager' || r === 'super admin';
  }

  /* ── API helper ───────────────────────────────────────────────────────── */
  function api(path, opts) {
    opts = opts || {};
    var hdrs = { 'Content-Type': 'application/json' };
    var em = actorEmail();
    if (em) hdrs['X-User-Email'] = em;
    opts.headers = Object.assign(hdrs, opts.headers || {});
    return fetch('/api' + path, opts)
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          return { ok: r.ok, status: r.status, data: d };
        });
      })
      .catch(function () { return { ok: false, status: 0, data: null }; });
  }

  function fetchKpis() {
    var scope = isAdmin() ? state.scope : 'me';
    return api('/recruitment/kpis?scope=' + scope + '&range=' + state.range);
  }

  /* ── escape ───────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── number helpers ───────────────────────────────────────────────────── */
  function pct(v) { return (v == null ? '—' : v.toFixed(1) + '%'); }
  function num(v) { return (v == null ? '—' : v); }
  function score(v) { return (v == null || v === 0 ? '—' : v.toFixed(1)); }

  /* ── bar helper ───────────────────────────────────────────────────────── */
  function miniBar(value, max, color) {
    var w = max > 0 ? Math.round((value / max) * 100) : 0;
    return '<div style="width:100%;background:var(--border);border-radius:4px;height:6px;margin-top:4px">' +
      '<div style="width:' + w + '%;background:' + color + ';border-radius:4px;height:6px;transition:width .4s"></div>' +
      '</div>';
  }

  /* ── color map ────────────────────────────────────────────────────────── */
  var OUTCOME_COLORS = { Selected: '#22c55e', Rejected: '#ef4444', Waitlisted: '#f59e0b', Pending: '#94a3b8' };
  var VERDICT_COLORS = { PASS: '#22c55e', HOLD: '#f59e0b', FAIL: '#ef4444' };

  /* ── inject styles ────────────────────────────────────────────────────── */
  function injectStyle() {
    if (document.getElementById('hrms-kpi-style')) return;
    var s = document.createElement('style');
    s.id = 'hrms-kpi-style';
    s.textContent = [
      /* overlay backdrop */
      '#hrms-kpi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9900;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}',
      /* modal */
      '.kpi-modal{background:var(--card,#fff);border-radius:16px;width:100%;max-width:960px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25)}',
      /* header */
      '.kpi-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0;flex-shrink:0}',
      '.kpi-title{font-size:17px;font-weight:700;color:var(--text1,#111)}',
      '.kpi-sub{font-size:12px;color:var(--text3,#888);margin-top:2px}',
      '.kpi-x{background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3,#888);line-height:1;padding:4px 8px;border-radius:6px}',
      '.kpi-x:hover{background:var(--hover,#f3f4f6)}',
      /* toolbar */
      '.kpi-toolbar{display:flex;align-items:center;gap:10px;padding:14px 24px 0;flex-wrap:wrap;flex-shrink:0}',
      '.kpi-scope-btn{padding:5px 13px;border-radius:20px;border:1.5px solid var(--border,#e5e7eb);font-size:12px;cursor:pointer;background:transparent;color:var(--text2,#555);font-weight:500;transition:.15s}',
      '.kpi-scope-btn.active{background:var(--accent,#6366f1);color:#fff;border-color:var(--accent,#6366f1)}',
      '.kpi-range-sel{border:1.5px solid var(--border,#e5e7eb);border-radius:8px;padding:5px 10px;font-size:12px;background:var(--card,#fff);color:var(--text1,#111);cursor:pointer}',
      '.kpi-refresh{margin-left:auto;font-size:11px;color:var(--text3,#888)}',
      /* tabs */
      '.kpi-tabs{display:flex;gap:4px;padding:12px 24px 0;border-bottom:1.5px solid var(--border,#e5e7eb);flex-shrink:0;overflow-x:auto}',
      '.kpi-tab{padding:7px 14px;border-radius:8px 8px 0 0;border:none;background:transparent;font-size:12.5px;cursor:pointer;color:var(--text2,#666);font-weight:500;border-bottom:2.5px solid transparent;white-space:nowrap}',
      '.kpi-tab.active{color:var(--accent,#6366f1);border-bottom-color:var(--accent,#6366f1);font-weight:700}',
      /* body */
      '.kpi-body{flex:1;overflow-y:auto;padding:20px 24px 24px}',
      /* cards grid */
      '.kpi-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:20px}',
      '.kpi-card{background:var(--bg2,#f8fafc);border:1.5px solid var(--border,#e5e7eb);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden}',
      '.kpi-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px}',
      '.kpi-card.c-green::before{background:linear-gradient(90deg,#22c55e,#86efac)}',
      '.kpi-card.c-blue::before{background:linear-gradient(90deg,#6366f1,#a5b4fc)}',
      '.kpi-card.c-amber::before{background:linear-gradient(90deg,#f59e0b,#fde68a)}',
      '.kpi-card.c-red::before{background:linear-gradient(90deg,#ef4444,#fca5a5)}',
      '.kpi-card.c-purple::before{background:linear-gradient(90deg,#a855f7,#d8b4fe)}',
      '.kpi-card.c-cyan::before{background:linear-gradient(90deg,#06b6d4,#a5f3fc)}',
      '.kpi-card.c-indigo::before{background:linear-gradient(90deg,#4f46e5,#818cf8)}',
      '.kpi-card.c-pink::before{background:linear-gradient(90deg,#ec4899,#f9a8d4)}',
      '.kpi-card-val{font-size:26px;font-weight:800;color:var(--text1,#111);line-height:1.1;margin-top:6px}',
      '.kpi-card-lbl{font-size:11px;font-weight:600;color:var(--text3,#888);text-transform:uppercase;letter-spacing:.5px}',
      '.kpi-card-sub{font-size:11px;color:var(--text3,#888);margin-top:3px}',
      /* section */
      '.kpi-section{margin-bottom:22px}',
      '.kpi-section-title{font-size:13px;font-weight:700;color:var(--text1,#111);margin-bottom:12px;display:flex;align-items:center;gap:8px}',
      '.kpi-section-title::after{content:"";flex:1;height:1px;background:var(--border,#e5e7eb)}',
      /* pill list */
      '.kpi-pills{display:flex;flex-wrap:wrap;gap:8px}',
      '.kpi-pill{display:flex;align-items:center;gap:6px;background:var(--bg2,#f8fafc);border:1.5px solid var(--border,#e5e7eb);border-radius:20px;padding:4px 12px;font-size:12px;color:var(--text1,#111)}',
      '.kpi-pill-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
      '.kpi-pill-val{font-weight:700;margin-left:2px}',
      /* table */
      '.kpi-tbl{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.kpi-tbl th{text-align:left;padding:8px 10px;font-weight:700;color:var(--text3,#888);font-size:11px;text-transform:uppercase;border-bottom:1.5px solid var(--border,#e5e7eb)}',
      '.kpi-tbl td{padding:9px 10px;border-bottom:1px solid var(--border,#e5e7eb);color:var(--text1,#111)}',
      '.kpi-tbl tr:last-child td{border-bottom:none}',
      '.kpi-tbl tr:hover td{background:var(--hover,#f8fafc)}',
      /* trend chart */
      '.kpi-trend{display:flex;align-items:flex-end;gap:6px;height:100px;padding:8px 0}',
      '.kpi-trend-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}',
      '.kpi-trend-bar{width:100%;border-radius:4px 4px 0 0;min-height:2px;transition:height .4s}',
      '.kpi-trend-lbl{font-size:9px;color:var(--text3,#888);text-align:center;white-space:nowrap;overflow:hidden;max-width:40px;text-overflow:ellipsis}',
      /* scores bar */
      '.kpi-score-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
      '.kpi-score-lbl{width:130px;font-size:12px;color:var(--text2,#555);flex-shrink:0}',
      '.kpi-score-track{flex:1;background:var(--border,#e5e7eb);border-radius:20px;height:8px;overflow:hidden}',
      '.kpi-score-fill{height:100%;border-radius:20px;transition:width .6s}',
      '.kpi-score-val{width:36px;text-align:right;font-size:12px;font-weight:700;color:var(--text1,#111)}',
      /* loading */
      '.kpi-loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--text3,#888);font-size:13px}',
      /* empty */
      '.kpi-empty{text-align:center;color:var(--text3,#888);font-size:13px;padding:40px 0}',
      /* two-col */
      '.kpi-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
      '@media(max-width:580px){.kpi-two{grid-template-columns:1fr}.kpi-cards{grid-template-columns:repeat(2,1fr)}}',
      /* inject button */
      '#hrms-kpi-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1.5px solid var(--border,#e5e7eb);background:var(--card,#fff);color:var(--text1,#111);font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}',
      '#hrms-kpi-btn:hover{background:var(--accent,#6366f1);color:#fff;border-color:var(--accent,#6366f1)}',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── open / close ─────────────────────────────────────────────────────── */
  function open() {
    if (document.getElementById(OVERLAY_ID)) return;
    injectStyle();
    var o = document.createElement('div');
    o.id = OVERLAY_ID;
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.body.appendChild(o);
    document.addEventListener('keydown', onKey);
    buildShell();
    loadAndRender();
    state.timer = setInterval(function () {
      if (document.getElementById(OVERLAY_ID)) loadAndRender();
      else clearInterval(state.timer);
    }, REFRESH_MS);
  }

  function close() {
    clearInterval(state.timer);
    var o = document.getElementById(OVERLAY_ID);
    if (o) o.parentNode.removeChild(o);
    document.removeEventListener('keydown', onKey);
    state.data = null;
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  /* ── tabs definition ──────────────────────────────────────────────────── */
  function tabs() {
    var t = [
      ['overview',  '📊 Overview'],
      ['pipeline',  '🔄 Pipeline'],
      ['resumes',   '📄 Resume Scoring'],
      ['recordings','🎥 Recordings'],
      ['trends',    '📈 Trends'],
    ];
    if (isAdmin() && state.scope === 'all') {
      t.push(['jobs',    '💼 Jobs']);
      t.push(['team',    '👥 Team Performance']);
    }
    return t;
  }

  /* ── shell ────────────────────────────────────────────────────────────── */
  function buildShell() {
    var o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    var scopeBtns = isAdmin()
      ? '<button class="kpi-scope-btn' + (state.scope === 'me' ? ' active' : '') + '" data-kact="scope" data-val="me">My View</button>' +
        '<button class="kpi-scope-btn' + (state.scope === 'all' ? ' active' : '') + '" data-kact="scope" data-val="all">Org View</button>'
      : '';
    o.innerHTML =
      '<div class="kpi-modal">' +
        '<div class="kpi-head">' +
          '<div>' +
            '<div class="kpi-title">📊 Recruitment KPI Dashboard</div>' +
            '<div class="kpi-sub">Analytics across interviews, resumes & recordings</div>' +
          '</div>' +
          '<button class="kpi-x" data-kact="close">&times;</button>' +
        '</div>' +
        '<div class="kpi-toolbar">' +
          scopeBtns +
          '<select class="kpi-range-sel" data-kact="range">' +
            '<option value="all"' + (state.range === 'all'     ? ' selected' : '') + '>All Time</option>' +
            '<option value="week"' + (state.range === 'week'   ? ' selected' : '') + '>This Week</option>' +
            '<option value="month"' + (state.range === 'month' ? ' selected' : '') + '>This Month</option>' +
            '<option value="quarter"' + (state.range === 'quarter' ? ' selected' : '') + '>Last 90 Days</option>' +
          '</select>' +
          '<span class="kpi-refresh" id="kpi-refresh-lbl"></span>' +
        '</div>' +
        '<div class="kpi-tabs" id="kpi-tabs-bar">' +
          tabs().map(function (t) {
            return '<button class="kpi-tab' + (state.tab === t[0] ? ' active' : '') + '" data-kact="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="kpi-body" id="kpi-body"></div>' +
      '</div>';
    wire();
  }

  function wire() {
    var o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    o.addEventListener('click', function (e) {
      var el = e.target.closest('[data-kact]');
      if (!el) return;
      var act = el.getAttribute('data-kact');
      if (act === 'close') { close(); return; }
      if (act === 'tab') {
        state.tab = el.getAttribute('data-tab');
        updateTabs();
        renderBody();
        return;
      }
      if (act === 'scope') {
        state.scope = el.getAttribute('data-val');
        // Reset to valid tab if admin tabs disappear
        if (state.scope === 'me' && (state.tab === 'jobs' || state.tab === 'team')) state.tab = 'overview';
        buildShell();
        loadAndRender();
        return;
      }
    });
    o.addEventListener('change', function (e) {
      if (e.target && e.target.getAttribute('data-kact') === 'range') {
        state.range = e.target.value;
        loadAndRender();
      }
    });
  }

  function updateTabs() {
    var bar = document.getElementById('kpi-tabs-bar');
    if (!bar) return;
    bar.innerHTML = tabs().map(function (t) {
      return '<button class="kpi-tab' + (state.tab === t[0] ? ' active' : '') + '" data-kact="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
  }

  function setBody(html) {
    var b = document.getElementById('kpi-body');
    if (b) b.innerHTML = html;
  }

  function loadAndRender() {
    setBody('<div class="kpi-loading">Loading KPI data…</div>');
    fetchKpis().then(function (r) {
      if (!r.ok || !r.data) {
        setBody('<div class="kpi-empty">Failed to load KPIs. Check the server is running.</div>');
        return;
      }
      state.data = r.data;
      var lbl = document.getElementById('kpi-refresh-lbl');
      if (lbl) lbl.textContent = 'Updated ' + new Date().toLocaleTimeString();
      renderBody();
    });
  }

  function renderBody() {
    var d = state.data;
    if (!d) { setBody('<div class="kpi-loading">Loading…</div>'); return; }
    if (state.tab === 'overview')    return setBody(renderOverview(d));
    if (state.tab === 'pipeline')    return setBody(renderPipeline(d));
    if (state.tab === 'resumes')     return setBody(renderResumes(d));
    if (state.tab === 'recordings')  return setBody(renderRecordings(d));
    if (state.tab === 'trends')      return setBody(renderTrends(d));
    if (state.tab === 'jobs')        return setBody(renderJobs(d));
    if (state.tab === 'team')        return setBody(renderTeam(d));
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * TAB RENDERERS
   * ═════════════════════════════════════════════════════════════════════ */

  /* ── Overview ─────────────────────────────────────────────────────────── */
  function renderOverview(d) {
    var p = d.pipeline || {};
    var rs = d.resumeScoring || {};
    var rc = d.recordings || {};

    var cards = [
      { label: 'Total Interviews', val: num(p.total), sub: '', color: 'blue' },
      { label: 'Shortlist Rate',   val: pct(p.shortlistRate), sub: num(p.byOutcome && p.byOutcome.find && (p.byOutcome.find(function(x){return x.outcome==='Selected';}) || {}).count || 0) + ' selected', color: 'green' },
      { label: 'Rejection Rate',   val: pct(p.rejectionRate), sub: num((p.byOutcome && p.byOutcome.find && (p.byOutcome.find(function(x){return x.outcome==='Rejected';}) || {}).count) || 0) + ' rejected', color: 'red' },
      { label: 'Avg Candidate Score', val: score(p.avgCandidateScore), sub: 'out of 100', color: 'indigo' },
      { label: 'Resumes Screened',  val: num(rs.total), sub: '', color: 'cyan' },
      { label: 'High-Match Resumes', val: num(rs.highMatch), sub: 'score ≥ 75', color: 'green' },
      { label: 'Avg Resume Score',   val: score(rs.avgScore), sub: 'out of 100', color: 'purple' },
      { label: 'Recorded Interviews',val: num(rc.total), sub: '', color: 'amber' },
    ];
    if (d.jobs) {
      cards.push({ label: 'Open Positions', val: num(d.jobs.totalOpenings), sub: num(d.jobs.totalJobs) + ' job posts', color: 'pink' });
    }

    var html = '<div class="kpi-cards">' +
      cards.map(function (c) {
        return '<div class="kpi-card c-' + c.color + '">' +
          '<div class="kpi-card-lbl">' + esc(c.label) + '</div>' +
          '<div class="kpi-card-val">' + esc(String(c.val)) + '</div>' +
          (c.sub ? '<div class="kpi-card-sub">' + esc(c.sub) + '</div>' : '') +
        '</div>';
      }).join('') +
    '</div>';

    // Mini funnel
    html += '<div class="kpi-section">' +
      '<div class="kpi-section-title">Outcome Funnel</div>' +
      '<div class="kpi-pills">';
    (p.byOutcome || []).forEach(function (row) {
      var col = OUTCOME_COLORS[row.outcome] || '#94a3b8';
      html += '<div class="kpi-pill">' +
        '<div class="kpi-pill-dot" style="background:' + col + '"></div>' +
        esc(row.outcome) + '<span class="kpi-pill-val">' + row.count + '</span>' +
      '</div>';
    });
    html += '</div></div>';

    // Email delivery
    html += '<div class="kpi-section">' +
      '<div class="kpi-section-title">Email Delivery</div>' +
      '<div class="kpi-cards" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi-card c-green"><div class="kpi-card-lbl">Sent</div><div class="kpi-card-val">' + num(p.emailsSent) + '</div></div>' +
      '<div class="kpi-card c-amber"><div class="kpi-card-lbl">Pending</div><div class="kpi-card-val">' + num(p.emailsPending) + '</div></div>' +
      '<div class="kpi-card c-red"><div class="kpi-card-lbl">Awaiting Outcome</div><div class="kpi-card-val">' + num(p.pendingOutcome) + '</div></div>' +
      '</div></div>';

    return html;
  }

  /* ── Pipeline ─────────────────────────────────────────────────────────── */
  function renderPipeline(d) {
    var p = d.pipeline || {};
    var html = '';

    // Rate cards
    html += '<div class="kpi-cards">' +
      kpiCard('Total Interviews', p.total, '', 'blue') +
      kpiCard('Shortlist Rate', pct(p.shortlistRate), '', 'green') +
      kpiCard('Rejection Rate', pct(p.rejectionRate), '', 'red') +
      kpiCard('Waitlist Rate', pct(p.waitlistRate), '', 'amber') +
      kpiCard('Avg Score', score(p.avgCandidateScore), 'out of 100', 'indigo') +
      kpiCard('Emails Sent', p.emailsSent, '', 'green') +
      kpiCard('Pending', p.emailsPending, 'not sent', 'amber') +
      kpiCard('Awaiting Outcome', p.pendingOutcome, 'no decision', 'red') +
    '</div>';

    // By status
    html += '<div class="kpi-two">';
    html += '<div class="kpi-section"><div class="kpi-section-title">By Status</div>';
    html += pillTable(p.byStatus || [], 'status', '#6366f1');
    html += '</div>';

    // By outcome
    html += '<div class="kpi-section"><div class="kpi-section-title">By Outcome</div>';
    html += pillTable(p.byOutcome || [], 'outcome', function (row) { return OUTCOME_COLORS[row.outcome] || '#6366f1'; });
    html += '</div>';
    html += '</div>';

    // By interview type
    html += '<div class="kpi-section"><div class="kpi-section-title">By Interview Type</div>' +
      '<div class="kpi-pills">';
    (p.byInterviewType || []).forEach(function (row) {
      html += '<div class="kpi-pill"><span style="font-weight:600">' + esc(row.type) + '</span><span class="kpi-pill-val">' + row.count + '</span></div>';
    });
    html += '</div></div>';

    return html;
  }

  /* ── Resume Scoring ───────────────────────────────────────────────────── */
  function renderResumes(d) {
    var rs = d.resumeScoring || {};
    var html = '';

    html += '<div class="kpi-cards">' +
      kpiCard('Total Screened', rs.total, '', 'blue') +
      kpiCard('High-Match ≥75', rs.highMatch, '', 'green') +
      kpiCard('High-Match Rate', pct(rs.highMatchRate), '', 'green') +
      kpiCard('Avg Overall Score', score(rs.avgScore), 'out of 100', 'indigo') +
    '</div>';

    // Score breakdown bars
    var scores = [
      { label: 'Overall Score',   val: rs.avgScore,      color: '#6366f1' },
      { label: 'Technical',       val: rs.avgTechnical,  color: '#06b6d4' },
      { label: 'Experience',      val: rs.avgExperience, color: '#22c55e' },
      { label: 'Domain',          val: rs.avgDomain,     color: '#f59e0b' },
    ];
    html += '<div class="kpi-section"><div class="kpi-section-title">Score Breakdown (avg)</div>';
    scores.forEach(function (s) {
      var w = Math.min(100, Math.max(0, s.val || 0));
      html += '<div class="kpi-score-row">' +
        '<div class="kpi-score-lbl">' + esc(s.label) + '</div>' +
        '<div class="kpi-score-track">' +
          '<div class="kpi-score-fill" style="width:' + w + '%;background:' + s.color + '"></div>' +
        '</div>' +
        '<div class="kpi-score-val">' + (s.val ? s.val.toFixed(1) : '—') + '</div>' +
      '</div>';
    });
    html += '</div>';

    // By source
    html += '<div class="kpi-section"><div class="kpi-section-title">By Source</div>' +
      '<div class="kpi-pills">';
    (rs.bySource || []).forEach(function (row) {
      html += '<div class="kpi-pill">' + esc(row.source) + '<span class="kpi-pill-val">' + row.count + '</span></div>';
    });
    html += '</div></div>';

    return html;
  }

  /* ── Recordings ───────────────────────────────────────────────────────── */
  function renderRecordings(d) {
    var rc = d.recordings || {};
    var html = '';

    html += '<div class="kpi-cards">' +
      kpiCard('Total Recordings', rc.total, '', 'blue') +
      kpiCard('Avg Total Score', score(rc.avgTotalScore), 'out of 100', 'indigo') +
      kpiCard('Avg Tech Score', score(rc.avgTechScore), 'out of 100', 'cyan') +
      kpiCard('Avg Comm Score', score(rc.avgCommScore), 'out of 100', 'green') +
      kpiCard('Avg Integrity', score(rc.avgIntegrityScore), 'out of 100', 'purple') +
      kpiCard('Avg Duration', rc.avgDuration || '—', '', 'amber') +
    '</div>';

    // Verdict breakdown
    html += '<div class="kpi-section"><div class="kpi-section-title">By Verdict</div>' +
      '<div class="kpi-pills">';
    (rc.byVerdict || []).forEach(function (row) {
      var col = VERDICT_COLORS[row.verdict] || '#6366f1';
      html += '<div class="kpi-pill">' +
        '<div class="kpi-pill-dot" style="background:' + col + '"></div>' +
        esc(row.verdict) + '<span class="kpi-pill-val">' + row.count + '</span>' +
      '</div>';
    });
    if (!rc.byVerdict || rc.byVerdict.length === 0) {
      html += '<div class="kpi-empty" style="padding:12px 0">No recording data available.</div>';
    }
    html += '</div></div>';

    // Score bars
    var scores = [
      { label: 'Technical',  val: rc.avgTechScore,      color: '#06b6d4' },
      { label: 'Communication', val: rc.avgCommScore,   color: '#22c55e' },
      { label: 'Integrity',  val: rc.avgIntegrityScore, color: '#a855f7' },
    ];
    if (rc.avgTotalScore) {
      html += '<div class="kpi-section"><div class="kpi-section-title">Score Breakdown (avg)</div>';
      scores.forEach(function (s) {
        var w = Math.min(100, Math.max(0, s.val || 0));
        html += '<div class="kpi-score-row">' +
          '<div class="kpi-score-lbl">' + esc(s.label) + '</div>' +
          '<div class="kpi-score-track">' +
            '<div class="kpi-score-fill" style="width:' + w + '%;background:' + s.color + '"></div>' +
          '</div>' +
          '<div class="kpi-score-val">' + (s.val ? s.val.toFixed(1) : '—') + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  /* ── Trends ───────────────────────────────────────────────────────────── */
  function renderTrends(d) {
    var tr = d.trends || {};
    var monthly = tr.monthly || [];
    var weekly  = tr.weekly  || [];
    var html = '';

    // Monthly trend bar chart
    html += '<div class="kpi-section"><div class="kpi-section-title">Monthly Interviews (last 12 months)</div>';
    if (monthly.length === 0) {
      html += '<div class="kpi-empty">No trend data available.</div>';
    } else {
      var maxTotal = Math.max.apply(null, monthly.map(function (m) { return m.total || 0; })) || 1;
      html += '<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding-bottom:24px;position:relative;overflow-x:auto">';
      monthly.forEach(function (m) {
        var h = Math.max(4, Math.round(((m.total || 0) / maxTotal) * 100));
        var sh = Math.max(2, Math.round(((m.selected || 0) / maxTotal) * 100));
        var lbl = m.month ? m.month.replace(/^\d{4}-/, '') : '';
        html += '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:30px">' +
          '<div style="font-size:9px;color:var(--text3,#888)">' + m.total + '</div>' +
          '<div style="display:flex;align-items:flex-end;gap:2px;height:96px">' +
            '<div title="Total: ' + m.total + '" style="width:12px;height:' + h + 'px;background:#6366f1;border-radius:3px 3px 0 0;opacity:.5"></div>' +
            '<div title="Selected: ' + (m.selected||0) + '" style="width:12px;height:' + sh + 'px;background:#22c55e;border-radius:3px 3px 0 0"></div>' +
          '</div>' +
          '<div style="font-size:9px;color:var(--text3,#888);text-align:center">' + esc(lbl) + '</div>' +
        '</div>';
      });
      html += '</div>';
      html += '<div style="display:flex;gap:16px;font-size:11px;color:var(--text2,#666);margin-top:4px">' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#6366f1;border-radius:2px;opacity:.5;margin-right:4px"></span>Total</span>' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>Selected</span>' +
      '</div>';
    }
    html += '</div>';

    // Monthly table
    if (monthly.length > 0) {
      html += '<div class="kpi-section"><div class="kpi-section-title">Monthly Breakdown</div>' +
        '<div style="overflow-x:auto"><table class="kpi-tbl">' +
        '<thead><tr><th>Month</th><th>Total</th><th>Selected</th><th>Shortlist Rate</th></tr></thead><tbody>';
      monthly.slice().reverse().forEach(function (m) {
        html += '<tr><td>' + esc(m.month || '—') + '</td><td>' + m.total + '</td><td>' + (m.selected || 0) + '</td>' +
          '<td><span style="color:#22c55e;font-weight:700">' + pct(m.shortlistRate) + '</span></td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // Weekly trend (if available)
    if (weekly.length > 0) {
      html += '<div class="kpi-section"><div class="kpi-section-title">Weekly Trend (last 12 weeks)</div>' +
        '<div style="overflow-x:auto"><table class="kpi-tbl">' +
        '<thead><tr><th>Week of</th><th>Total</th><th>Selected</th></tr></thead><tbody>';
      weekly.slice().reverse().slice(0, 8).forEach(function (w) {
        html += '<tr><td>' + esc(w.week || '—') + '</td><td>' + w.total + '</td><td>' + (w.selected || 0) + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    return html;
  }

  /* ── Jobs (admin only) ────────────────────────────────────────────────── */
  function renderJobs(d) {
    var j = d.jobs;
    if (!j) return '<div class="kpi-empty">Jobs data not available. Switch to Org View.</div>';
    var html = '';

    html += '<div class="kpi-cards">' +
      kpiCard('Total Job Posts', j.totalJobs, '', 'blue') +
      kpiCard('Total Openings', j.totalOpenings, 'positions', 'green') +
      kpiCard('Remote', j.remote, 'jobs', 'cyan') +
      kpiCard('On-Site', j.onsite, 'jobs', 'amber') +
    '</div>';

    // By department
    html += '<div class="kpi-two">';
    html += '<div class="kpi-section"><div class="kpi-section-title">By Department</div>';
    if (j.byDepartment && j.byDepartment.length) {
      var maxD = j.byDepartment[0].count || 1;
      html += '<table class="kpi-tbl"><thead><tr><th>Department</th><th>Jobs</th></tr></thead><tbody>';
      j.byDepartment.forEach(function (row) {
        html += '<tr><td>' + esc(row.dept) + '</td><td>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="flex:1;background:var(--border,#e5e7eb);border-radius:4px;height:5px"><div style="width:' + Math.round(row.count/maxD*100) + '%;background:#6366f1;border-radius:4px;height:5px"></div></div>' +
            row.count +
          '</div></td></tr>';
      });
      html += '</tbody></table>';
    } else html += '<div class="kpi-empty" style="padding:12px 0">No department data.</div>';
    html += '</div>';

    // By type
    html += '<div class="kpi-section"><div class="kpi-section-title">By Job Type</div>';
    if (j.byType && j.byType.length) {
      html += '<div class="kpi-pills">';
      j.byType.forEach(function (row) {
        html += '<div class="kpi-pill">' + esc(row.type) + '<span class="kpi-pill-val">' + row.count + '</span></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';

    return html;
  }

  /* ── Team Performance (admin only) ───────────────────────────────────── */
  function renderTeam(d) {
    var stats = d.recruiterStats;
    if (!stats) return '<div class="kpi-empty">Team data not available. Switch to Org View.</div>';
    if (stats.length === 0) return '<div class="kpi-empty">No recruiter data found.</div>';

    var html = '<div class="kpi-section"><div class="kpi-section-title">Recruiter Leaderboard (Top 20)</div>' +
      '<div style="overflow-x:auto"><table class="kpi-tbl">' +
      '<thead><tr><th>#</th><th>Recruiter</th><th>Total</th><th>Selected</th><th>Rejected</th><th>Shortlist Rate</th><th>Avg Score</th></tr></thead><tbody>';

    stats.forEach(function (r, i) {
      var rate = r.shortlistRate || 0;
      var barColor = rate >= 50 ? '#22c55e' : rate >= 25 ? '#f59e0b' : '#ef4444';
      html += '<tr>' +
        '<td style="color:var(--text3,#888);font-weight:700">' + (i+1) + '</td>' +
        '<td><div style="font-weight:600">' + esc(r.interviewer) + '</div></td>' +
        '<td>' + r.total + '</td>' +
        '<td><span style="color:#22c55e;font-weight:700">' + r.selected + '</span></td>' +
        '<td><span style="color:#ef4444">' + r.rejected + '</span></td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="width:60px;background:var(--border,#e5e7eb);border-radius:4px;height:5px"><div style="width:' + Math.min(100, rate) + '%;background:' + barColor + ';border-radius:4px;height:5px"></div></div>' +
            '<span style="font-weight:700;color:' + barColor + '">' + pct(rate) + '</span>' +
          '</div>' +
        '</td>' +
        '<td>' + score(r.avgScore) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div></div>';

    // Aggregate summary
    var totalInterviews = stats.reduce(function (s, r) { return s + r.total; }, 0);
    var totalSelected   = stats.reduce(function (s, r) { return s + r.selected; }, 0);
    var orgRate = totalInterviews > 0 ? (totalSelected / totalInterviews * 100).toFixed(1) : '0.0';
    html += '<div class="kpi-cards" style="margin-top:16px">' +
      kpiCard('Recruiters Active', stats.length, '', 'blue') +
      kpiCard('Org Shortlist Rate', orgRate + '%', '', 'green') +
      kpiCard('Total by Team', totalInterviews, '', 'indigo') +
      kpiCard('Total Selected', totalSelected, 'across team', 'green') +
    '</div>';

    return html;
  }

  /* ── mini helpers ─────────────────────────────────────────────────────── */
  function kpiCard(label, val, sub, color) {
    return '<div class="kpi-card c-' + color + '">' +
      '<div class="kpi-card-lbl">' + esc(label) + '</div>' +
      '<div class="kpi-card-val">' + esc(String(val == null ? '—' : val)) + '</div>' +
      (sub ? '<div class="kpi-card-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
  }

  function pillTable(rows, keyField, colorOrFn) {
    if (!rows || rows.length === 0) return '<div class="kpi-empty" style="padding:8px 0">No data.</div>';
    var max = rows[0].count || 1;
    var html = '<div style="display:flex;flex-direction:column;gap:8px">';
    rows.forEach(function (row) {
      var col = typeof colorOrFn === 'function' ? colorOrFn(row) : colorOrFn;
      var w = Math.round((row.count / max) * 100);
      html += '<div>' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">' +
          '<span style="font-weight:600;color:var(--text1,#111)">' + esc(row[keyField]) + '</span>' +
          '<span style="color:var(--text3,#888)">' + row.count + '</span>' +
        '</div>' +
        '<div style="background:var(--border,#e5e7eb);border-radius:4px;height:6px">' +
          '<div style="width:' + w + '%;background:' + col + ';border-radius:4px;height:6px;transition:width .4s"></div>' +
        '</div>' +
      '</div>';
    });
    return html + '</div>';
  }

  /* ── inject trigger button ─────────────────────────────────────────────── */
  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    // Try to find the recruitment page topbar / page header
    var selectors = [
      '[data-route*="recruit"] .page-header',
      '[class*="recruit"] .page-actions',
      '[class*="recruit"] .topbar-actions',
      '.page-header .page-actions',
      '.page-header',
      '.topbar',
    ];
    var target = null;
    for (var i = 0; i < selectors.length; i++) {
      target = document.querySelector(selectors[i]);
      if (target) break;
    }
    if (!target) return; // not on recruitment page yet

    injectStyle();
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M5 10V8M8 10V6M11 10V7" stroke-linecap="round"/></svg>KPI Dashboard';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (document.getElementById(OVERLAY_ID)) close(); else open();
    });
    target.appendChild(btn);
  }

  /* ── also expose via window.__hrmsOpenRecruitKPI ──────────────────────── */
  window.__hrmsOpenRecruitKPI = open;

  /* ── mount on route change ────────────────────────────────────────────── */
  function tryMount() {
    // Detect if we're on a recruitment-related URL
    var path = window.location.pathname + window.location.hash;
    var onRecruit = /recruit|job|interview/i.test(path);
    if (onRecruit) {
      injectButton();
    } else {
      // Remove button if navigated away
      var btn = document.getElementById(BTN_ID);
      if (btn) btn.parentNode.removeChild(btn);
    }
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */
  function boot() {
    tryMount();
    // Observe URL changes (React SPA uses pushState)
    var lastPath = window.location.pathname + window.location.hash;
    setInterval(function () {
      var current = window.location.pathname + window.location.hash;
      if (current !== lastPath) {
        lastPath = current;
        setTimeout(tryMount, 300); // wait for React to render
      }
    }, 500);
    // Also observe DOM for React rendering the page
    var obs = new MutationObserver(function () {
      if (!document.getElementById(BTN_ID)) tryMount();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
