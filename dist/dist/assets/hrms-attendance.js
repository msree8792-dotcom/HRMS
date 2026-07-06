/**
 * hrms-attendance.js  v1
 * A Check-In / Check-Out attendance timeline modal (Zoho-Cliq style).
 *
 * Opened via window.__hrmsOpenAttendance() (wired to the avatar drawer's
 * "Attendance" item). Fetches the signed-in user's real attendance from the
 * Django API (/api/attendance?email=&from=&to=) and draws, per day, a bar
 * from check-in to check-out on a 24-hour timeline, with worked hours and a
 * green marker showing the AVERAGE check-in time for the visible week/month
 * (recomputed dynamically per range). Weekly / Monthly views with prev/next
 * navigation; refreshes live when the user checks in/out.
 *
 * Same no-rebuild injection pattern as hrms-checkin.js / hrms-status.js.
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'hrms-att-overlay';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var INFO_SVG =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"' +
    ' stroke-width="1.4" style="flex-shrink:0;margin-top:1px"><circle cx="8" cy="8" r="6.5"/>' +
    '<path d="M8 7.5v3.5M8 5h.01" stroke-linecap="round"/></svg>';

  var state = { view: 'monthly', anchor: null, start: null, end: null, data: {}, tick: null };

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function actorEmail() {
    try { return (JSON.parse(localStorage.getItem('hrms_session') || '{}').email) || ''; }
    catch (_) { return ''; }
  }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function rangeLabel(d) { return pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtMins(m) { m = m || 0; return pad(Math.floor(m / 60)) + 'hr ' + pad(m % 60) + 'm'; }

  /* fraction of the day [0..1] for a "YYYY-MM-DD HH:MM:SS" timestamp */
  function frac(ts) {
    if (!ts) return 0;
    var t = (String(ts).split(' ')[1] || '00:00:00').split(':');
    return ((parseInt(t[0], 10) || 0) + (parseInt(t[1], 10) || 0) / 60) / 24;
  }
  function nowFrac() {
    var n = new Date();
    return (n.getHours() + n.getMinutes() / 60) / 24;
  }

  /* 12-hour label ("9:14 AM") for a day fraction */
  function fracToTime(f) {
    var mins = Math.round(f * 1440);
    var h = Math.floor(mins / 60), m = mins % 60;
    var ap = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + pad(m) + ' ' + ap;
  }

  /* average check-in time across the loaded range (null if no check-ins) */
  function avgCheckin() {
    var sum = 0, n = 0;
    for (var k in state.data) {
      var r = state.data[k];
      if (r && r.checkIn) { sum += frac(r.checkIn); n++; }
    }
    if (!n) return null;
    var f = sum / n;
    return { frac: f, count: n, label: fracToTime(f) };
  }

  function computeRange() {
    var a = state.anchor;
    if (state.view === 'weekly') {
      var day = a.getDay();
      var toMon = (day === 0 ? -6 : 1 - day);
      var s = new Date(a.getFullYear(), a.getMonth(), a.getDate() + toMon);
      var e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
      state.start = s; state.end = e;
    } else {
      state.start = new Date(a.getFullYear(), a.getMonth(), 1);
      state.end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    }
  }

  function shift(dir) {
    var a = state.anchor;
    if (state.view === 'weekly') state.anchor = new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7);
    else state.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    computeRange();
    load(render);
  }

  function load(cb) {
    var em = actorEmail();
    state.data = {};
    if (!em) { cb && cb(); return; }
    var url = '/api/attendance?email=' + encodeURIComponent(em) +
              '&from=' + iso(state.start) + '&to=' + iso(state.end);
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        (rows || []).forEach(function (r) { if (r && r.date) state.data[r.date] = r; });
        cb && cb();
      })
      .catch(function () { cb && cb(); });
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  function hoursHeader() {
    var labels = ['0am', '3am', '6am', '9am', '12pm', '3pm', '6pm', '9pm'];
    return labels.map(function (lb, i) {
      return '<span class="hrms-att-hour" style="left:' + (i * 12.5) + '%">' + lb + '</span>';
    }).join('');
  }

  function gridLines(avg) {
    var html = '';
    for (var i = 0; i < 8; i++) html += '<div class="hrms-att-vline" style="left:' + (i * 12.5) + '%"></div>';
    /* green line = AVERAGE check-in time for the current week/month */
    if (avg) html += '<div class="hrms-att-now" style="left:' + (avg.frac * 100) + '%"></div>';
    return html;
  }

  function rowsHtml() {
    var html = '';
    var todayIso = iso(new Date());
    var d = new Date(state.start);
    while (d <= state.end) {
      var key = iso(d);
      var rec = state.data[key];
      var name = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + WD[d.getDay()];
      var bar = '', attrs = '', hrs = '';
      if (rec && rec.checkIn) {
        var inF = frac(rec.checkIn);
        /* "live" = an open session today. Use the serializer's checkedIn flag
           (check_in after the last check_out) rather than "no check_out", so a
           re-check-in following an earlier check-out still draws a growing live
           bar to NOW instead of collapsing onto the stale check-out time. */
        var live = (key === todayIso) && !!rec.checkedIn;
        var outF = live ? nowFrac() : (rec.checkOut ? frac(rec.checkOut) : inF + 0.02);
        var left = inF * 100, width = Math.max(outF * 100 - left, 0.6);
        bar = '<div class="hrms-att-bar" style="left:' + left + '%;width:' + width + '%"></div>';
        /* total worked = accumulated stored minutes + the live current session
           (identical to the Check-In page's formula so the two always match) */
        var totalMins = (rec.workedMinutes || 0) +
                        (live ? Math.max(Math.floor((Date.now() - Date.parse(String(rec.checkIn).replace(' ', 'T'))) / 60000), 0) : 0);
        hrs = fmtMins(totalMins);
        var inLabel = fracToTime(inF);
        var outLabel = live ? 'In progress' : (rec.checkOut ? fracToTime(frac(rec.checkOut)) : '—');
        attrs = ' data-tip="day" data-day="' + name + '" data-in="' + inLabel +
                '" data-out="' + outLabel + '" data-total="' + hrs + '"';
      }
      html +=
        '<div class="hrms-att-row"' + attrs + '>' +
          '<div class="hrms-att-day"><div class="hrms-att-dname">' + name + '</div>' +
            (hrs ? '<div class="hrms-att-dhrs">' + hrs + '</div>' : '') + '</div>' +
          '<div class="hrms-att-track">' + bar + '</div>' +
        '</div>';
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return html;
  }

  function render() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    var avg = avgCheckin();

    overlay.innerHTML =
      '<div class="hrms-att-modal">' +
        '<div class="hrms-att-head">' +
          '<span class="hrms-att-title">Attendance</span>' +
          '<button class="hrms-att-x" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="hrms-att-scroll">' +
          '<div class="hrms-att-nav">' +
            '<div class="hrms-att-navleft">' +
              '<button class="hrms-att-arrow hrms-att-prev" aria-label="Previous">&lsaquo;</button>' +
              '<span class="hrms-att-range">' + rangeLabel(state.start) + '  -  ' + rangeLabel(state.end) + '</span>' +
              '<button class="hrms-att-arrow hrms-att-next" aria-label="Next">&rsaquo;</button>' +
            '</div>' +
            '<select class="hrms-att-view">' +
              '<option value="weekly"' + (state.view === 'weekly' ? ' selected' : '') + '>Weekly view</option>' +
              '<option value="monthly"' + (state.view === 'monthly' ? ' selected' : '') + '>Monthly view</option>' +
            '</select>' +
          '</div>' +
          '<div class="hrms-att-tl-label">Check In/Check Out Timeline:' +
            (avg ? '<span class="hrms-att-avg-note">Avg check-in ' + avg.label + ' · ' + avg.count + ' day' + (avg.count === 1 ? '' : 's') + '</span>' : '') +
          '</div>' +
          '<div class="hrms-att-hours">' + hoursHeader() +
            (avg ? '<span class="hrms-att-avg-tag" data-tip="avg" data-avg="' + avg.label + '" style="left:' + (avg.frac * 100) + '%">' + avg.label + '</span>' : '') +
          '</div>' +
          '<div class="hrms-att-body">' +
            '<div class="hrms-att-grid">' + gridLines(avg) + '</div>' +
            '<div class="hrms-att-rows">' + rowsHtml() + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    overlay.querySelector('.hrms-att-x').addEventListener('click', close);
    overlay.querySelector('.hrms-att-prev').addEventListener('click', function () { shift(-1); });
    overlay.querySelector('.hrms-att-next').addEventListener('click', function () { shift(1); });
    overlay.querySelector('.hrms-att-view').addEventListener('change', function (e) {
      state.view = e.target.value;
      computeRange();
      load(render);
    });

    attachTips(overlay);
  }

  /* hover tooltips: per-day check-in/out/total, and the average marker */
  function attachTips(overlay) {
    var tip = document.createElement('div');
    tip.className = 'hrms-att-tip';
    tip.style.display = 'none';
    overlay.appendChild(tip);

    function show(html, x, y) {
      tip.innerHTML = html;
      tip.style.display = 'block';
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = x - tw / 2, top = y - th - 14;
      if (left < 8) left = 8;
      if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      if (top < 8) top = y + 18;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hide() { tip.style.display = 'none'; }

    overlay.querySelectorAll('[data-tip]').forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var html;
        if (el.getAttribute('data-tip') === 'avg') {
          html = '<div class="hrms-att-tip-head">Average check-in</div>' +
                 '<div><b>' + el.getAttribute('data-avg') + '</b></div>';
        } else {
          html = '<div class="hrms-att-tip-head">' + el.getAttribute('data-day') + '</div>' +
                 '<div>Check In: <b>' + el.getAttribute('data-in') + '</b></div>' +
                 '<div>Check Out: <b>' + el.getAttribute('data-out') + '</b></div>' +
                 '<div>Total: <b>' + el.getAttribute('data-total') + '</b></div>';
        }
        show(html, e.clientX, e.clientY);
      });
      el.addEventListener('mouseleave', hide);
    });
  }

  function close() {
    var o = document.getElementById(OVERLAY_ID);
    if (o) o.parentNode.removeChild(o);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hrmsAttendanceSynced', onSync);
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  /* live update: re-pull + redraw when the user checks in/out while open */
  function onSync() { if (document.getElementById(OVERLAY_ID)) load(render); }

  function open() {
    if (document.getElementById(OVERLAY_ID)) return;
    state.anchor = new Date();
    computeRange();
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'hrms-att-overlay';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hrmsAttendanceSynced', onSync);
    /* tick the live session so the current-day bar + total grow while open */
    if (state.tick) clearInterval(state.tick);
    state.tick = setInterval(function () {
      if (document.getElementById(OVERLAY_ID)) render(); else close();
    }, 60000);
    render();           // immediate frame (empty), then fill once data arrives
    load(render);
  }

  window.__hrmsOpenAttendance = open;
  console.log('[hrms-attendance v1] loaded');
})();
