(function () {
  'use strict';

  var STORAGE_KEY = 'hrms_session';
  var WRAPPER_ID = 'hrms-notifications-wrapper';
  var BUTTON_ID = 'hrms-notifications-btn';
  var PANEL_ID = 'hrms-notifications-panel';
  var SEARCH_ID = 'hrms-notifications-search';
  var FILTER_ID = 'hrms-notifications-filter';
  var SELECT_ALL_ID = 'hrms-notifications-select-all';
  var DELETE_SELECTED_ID = 'hrms-notifications-delete-selected';
  var CLEAR_ALL_ID = 'hrms-notifications-clear-all';
  var MARK_READ_ID = 'hrms-notifications-mark-all-read';
  var REFRESH_MS = 30000;

  var state = {
    items: [],
    filter: 'all',
    search: '',
    selected: {},
  };

  function actorEmail() {
    try {
      var session = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return (session.email || session.userEmail || session.user?.email || '').toString().trim();
    } catch (_) {
      return '';
    }
  }

  function findExistingBell() {
    var selectors = [
      '.topbar [aria-label*="notif" i]',
      '.topbar [title*="notif" i]',
      '.topbar button[class*="bell" i]',
      '.topbar [data-route*="notif" i]',
      '.topbar [class*="notification" i]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      // Accept BUTTON, A, or DIV — React often renders interactive elements as divs
      if (el && el.tagName && /BUTTON|A|DIV/i.test(el.tagName)) {
        return el;
      }
    }
    return null;
  }

  function buildIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 17h5"></path><path d="M5 17h5"></path><path d="M8 17V10a4 4 0 1 1 8 0v7"></path><path d="M10 17h4"></path></svg>';
  }

  function createButton() {
    var wrap = document.createElement('div');
    wrap.id = WRAPPER_ID;
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';

    var btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Notifications');
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '38px';
    btn.style.height = '38px';
    btn.style.borderRadius = '999px';
    btn.style.border = '1px solid var(--border, rgba(255,255,255,0.16))';
    btn.style.background = 'var(--surface2, rgba(255,255,255,0.08))';
    btn.style.color = 'var(--text1, #e5e7eb)';
    btn.style.cursor = 'pointer';
    btn.style.position = 'relative';
    btn.innerHTML = buildIcon();

    var badge = document.createElement('span');
    badge.id = 'hrms-notifications-badge';
    badge.textContent = '0';
    badge.style.position = 'absolute';
    badge.style.top = '-2px';
    badge.style.right = '-2px';
    badge.style.minWidth = '18px';
    badge.style.height = '18px';
    badge.style.padding = '0 5px';
    badge.style.fontSize = '10px';
    badge.style.lineHeight = '18px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'var(--accent, #4f8ef7)';
    badge.style.color = '#fff';
    badge.style.display = 'none';

    btn.appendChild(badge);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    wrap.appendChild(btn);
    return { wrap: wrap, btn: btn, badge: badge };
  }

  function createPanel() {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.position = 'absolute';
    panel.style.width = '360px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.maxHeight = '420px';
    panel.style.overflow = 'hidden';
    panel.style.background = 'var(--surface, #0f172a)';
    panel.style.border = '1px solid var(--border, rgba(255,255,255,0.12))';
    panel.style.borderRadius = '14px';
    panel.style.boxShadow = '0 14px 45px rgba(0,0,0,0.24)';
    panel.style.display = 'none';
    panel.style.zIndex = '2000';
    panel.style.minWidth = '320px';
    panel.style.fontFamily = 'Inter, system-ui, sans-serif';

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border, rgba(255,255,255,0.12));">
        <strong style="font-size:13px;">Notifications</strong>
        <button type="button" id="hrms-notifications-close" style="border:none;background:none;color:var(--text2,#94a3b8);cursor:pointer;font-size:12px;">Close</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border, rgba(255,255,255,0.12));">
        <input id="${SEARCH_ID}" placeholder="Search notifications..." style="flex:1;min-width:120px;background:var(--surface2,rgba(255,255,255,0.06));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;padding:8px 10px;color:var(--text1);font-size:12px;" />
        <select id="${FILTER_ID}" style="background:var(--surface2,rgba(255,255,255,0.06));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;padding:8px 10px;color:var(--text1);font-size:12px;">
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border, rgba(255,255,255,0.12));gap:8px;flex-wrap:wrap;">
        <label style="display:inline-flex;align-items:center;gap:6px;color:var(--text2,#94a3b8);font-size:12px;">
          <input id="${SELECT_ALL_ID}" type="checkbox" style="accent-color:var(--accent,#4f8ef7);width:14px;height:14px;cursor:pointer;" />
          Select all
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="${MARK_READ_ID}" type="button" style="border:1px solid var(--border,rgba(255,255,255,0.10));background:var(--surface2,rgba(255,255,255,0.06));color:var(--text1);border-radius:10px;padding:8px 10px;font-size:12px;cursor:pointer;">Mark all read</button>
          <button id="${DELETE_SELECTED_ID}" type="button" style="border:1px solid var(--border,rgba(255,255,255,0.10));background:var(--surface2,rgba(255,255,255,0.06));color:var(--text1);border-radius:10px;padding:8px 10px;font-size:12px;cursor:pointer;">Delete selected</button>
          <button id="${CLEAR_ALL_ID}" type="button" style="border:1px solid var(--border,rgba(255,255,255,0.10));background:var(--surface2,rgba(255,255,255,0.06));color:var(--text1);border-radius:10px;padding:8px 10px;font-size:12px;cursor:pointer;">Clear all</button>
        </div>
      </div>
      <div id="hrms-notifications-list" style="max-height:280px;overflow:auto;padding:8px 8px 12px;"></div>
    `.trim();

    var closeBtn = panel.querySelector('#hrms-notifications-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hidePanel();
      });
    }

    return panel;
  }

  function syncBadgeVisibility(btn) {
    if (!btn) return;
    Array.from(btn.children).forEach(function (child) {
      if (child.id !== 'hrms-notifications-badge' && child.tagName && child.tagName.toLowerCase() !== 'svg') {
        child.style.display = 'none';
      }
    });
  }

  function setBadge(count) {
    var badge = document.getElementById('hrms-notifications-badge');
    if (!badge) return;
    var n = Number(count || 0);
    badge.textContent = String(n);
    badge.style.display = n > 0 ? 'inline-block' : 'none';

    var btn = document.getElementById(BUTTON_ID);
    if (btn) {
      syncBadgeVisibility(btn);
    }
  }

  function normalizeString(value) {
    return (value || '').toString().toLowerCase();
  }

  function filteredItems() {
    var items = state.items || [];
    var q = normalizeString(state.search);
    if (state.filter === 'unread') {
      items = items.filter(function (item) { return item.isRead === false; });
    } else if (state.filter === 'read') {
      items = items.filter(function (item) { return item.isRead === true; });
    }
    if (q) {
      items = items.filter(function (item) {
        return normalizeString(item.title).indexOf(q) !== -1 ||
               normalizeString(item.message).indexOf(q) !== -1 ||
               normalizeString(item.link).indexOf(q) !== -1;
      });
    }
    return items;
  }

  function updateSelectAllControl() {
    var checkbox = document.getElementById(SELECT_ALL_ID);
    if (!checkbox) return;
    var visible = filteredItems();
    var total = visible.length;
    var selected = visible.filter(function (item) {
      return state.selected[item.id];
    }).length;
    checkbox.checked = total > 0 && selected === total;
    checkbox.indeterminate = selected > 0 && selected < total;
  }

  function renderList(items) {
    var list = document.getElementById('hrms-notifications-list');
    if (!list) return;
    if (!items || !items.length) {
      list.innerHTML = '<div style="padding:18px 10px;font-size:13px;color:var(--text2,#94a3b8);text-align:center;">No notifications match your search or filter.</div>';
      return;
    }

    list.innerHTML = '';
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '20px 1fr 24px';
      row.style.gap = '10px';
      row.style.alignItems = 'start';
      row.style.padding = '10px 10px 12px';
      row.style.borderRadius = '10px';
      row.style.marginBottom = '6px';
      row.style.background = item.isRead ? 'transparent' : 'rgba(79, 142, 247, 0.12)';
      row.style.border = '1px solid var(--border, rgba(255,255,255,0.10))';

      var checkboxWrap = document.createElement('div');
      checkboxWrap.style.display = 'flex';
      checkboxWrap.style.alignItems = 'center';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(state.selected[item.id]);
      checkbox.style.accentColor = 'var(--accent,#4f8ef7)';
      checkbox.style.cursor = 'pointer';
      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      checkbox.addEventListener('change', function () {
        state.selected[item.id] = checkbox.checked;
        updateSelectAllControl();
      });
      checkboxWrap.appendChild(checkbox);

      var content = document.createElement('div');
      content.style.cursor = 'pointer';
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.addEventListener('click', function () {
        if (!item.id) return;
        if (!item.isRead) {
          markRead(item.id);
          item.isRead = true;
        }
        renderPanel();
        if (item.link) {
          try {
            window.history.pushState(null, '', item.link);
            window.dispatchEvent(new CustomEvent('hrmsNavigate', { detail: { path: item.link } }));
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch (_) {}
        }
      });

      var title = document.createElement('div');
      title.textContent = item.title || 'Notification';
      title.style.fontWeight = '700';
      title.style.fontSize = '13px';
      title.style.marginBottom = '4px';

      var message = document.createElement('div');
      message.textContent = item.message || '';
      message.style.fontSize = '12px';
      message.style.color = 'var(--text2,#94a3b8)';
      message.style.lineHeight = '1.4';

      var meta = document.createElement('div');
      meta.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
      meta.style.fontSize = '11px';
      meta.style.marginTop = '8px';
      meta.style.color = 'var(--text3,#64748b)';

      content.appendChild(title);
      content.appendChild(message);
      content.appendChild(meta);

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.innerHTML = '&#x2715;';
      deleteButton.title = 'Delete notification';
      deleteButton.style.border = 'none';
      deleteButton.style.background = 'transparent';
      deleteButton.style.color = 'var(--text2,#94a3b8)';
      deleteButton.style.cursor = 'pointer';
      deleteButton.style.fontSize = '14px';
      deleteButton.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        deleteNotification(item.id);
      });

      row.appendChild(checkboxWrap);
      row.appendChild(content);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });
  }

  function renderPanel() {
    var visible = filteredItems();
    renderList(visible);
    updateSelectAllControl();
  }

  function fetchNotifications() {
    var email = actorEmail();
    if (!email) {
      setBadge(0);
      return;
    }
    var headers = { 'X-User-Email': email };
    fetch('/api/notifications?unreadOnly=true', { headers: headers })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (items) {
        var count = Array.isArray(items) ? items.length : 0;
        setBadge(count);
        if (document.getElementById(PANEL_ID) && document.getElementById(PANEL_ID).style.display !== 'none') {
          loadPanelItems();
        }
      })
      .catch(function () { setBadge(0); });
  }

  function loadPanelItems() {
    var email = actorEmail();
    if (!email) return;
    var headers = { 'X-User-Email': email };
    fetch('/api/notifications', { headers: headers })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (items) {
        state.items = Array.isArray(items) ? items : [];
        renderPanel();
      })
      .catch(function () {
        state.items = [];
        renderPanel();
      });
  }

  function markRead(id) {
    var email = actorEmail();
    if (!email || !id) return;
    fetch('/api/notifications/' + id + '/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Email': email }
    }).then(function () {
      state.items = state.items.map(function (item) {
        if (item.id === id) {
          item.isRead = true;
        }
        return item;
      });
      fetchNotifications();
    }).catch(function () {});
  }

  function deleteNotification(id) {
    var email = actorEmail();
    if (!email || !id) return;
    fetch('/api/notifications/' + id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-User-Email': email }
    }).then(function (res) {
      if (res.ok) {
        state.items = state.items.filter(function (item) { return item.id !== id; });
        delete state.selected[id];
        renderPanel();
        fetchNotifications();
      }
    }).catch(function () {});
  }

  function deleteSelected() {
    var ids = Object.keys(state.selected).filter(function (id) {
      return state.selected[id];
    });
    if (!ids.length) {
      return;
    }
    deleteNotifications(ids);
  }

  function deleteNotifications(ids) {
    var email = actorEmail();
    if (!email || !ids || !ids.length) return;
    fetch('/api/notifications/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': email,
      },
      body: JSON.stringify({ ids: ids })
    }).then(function (res) {
      if (res.ok) {
        var toRemove = ids.map(Number);
        state.items = state.items.filter(function (item) {
          return toRemove.indexOf(Number(item.id)) === -1;
        });
        toRemove.forEach(function (id) { delete state.selected[id]; });
        renderPanel();
        fetchNotifications();
      }
    }).catch(function () {});
  }

  function clearAll() {
    var ids = state.items.map(function (item) { return item.id; });
    if (!ids.length) return;
    deleteNotifications(ids);
  }

  function markAllRead() {
    var unread = state.items.filter(function (item) { return !item.isRead; });
    unread.forEach(function (item) { markRead(item.id); });
  }

  function positionPanel(panel, trigger) {
    if (!panel || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var left = rect.left + window.pageXOffset;
    var top = rect.bottom + window.pageYOffset + 8;
    panel.style.left = Math.min(left, window.innerWidth - panel.offsetWidth - 12) + 'px';
    panel.style.top = top + 'px';
  }

  function showPanel() {
    var panel = document.getElementById(PANEL_ID);
    var btn = document.getElementById(BUTTON_ID);
    if (!panel || !btn) return;
    panel.style.display = 'block';
    positionPanel(panel, btn);
    loadPanelItems();
  }

  function hidePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.style.display = 'none';
  }

  function togglePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (panel.style.display === 'block') {
      hidePanel();
    } else {
      showPanel();
    }
  }

  function wirePanel(toolbar, panel) {
    var search = toolbar.querySelector('#' + SEARCH_ID);
    var filter = toolbar.querySelector('#' + FILTER_ID);
    var selectAll = toolbar.querySelector('#' + SELECT_ALL_ID);
    var deleteSelectedBtn = toolbar.querySelector('#' + DELETE_SELECTED_ID);
    var clearAllBtn = toolbar.querySelector('#' + CLEAR_ALL_ID);
    var markReadBtn = toolbar.querySelector('#' + MARK_READ_ID);

    if (search) {
      search.addEventListener('input', function (e) {
        state.search = e.target.value || '';
        renderPanel();
      });
    }
    if (filter) {
      filter.addEventListener('change', function (e) {
        state.filter = e.target.value || 'all';
        renderPanel();
      });
    }
    if (selectAll) {
      selectAll.addEventListener('change', function (e) {
        var visible = filteredItems();
        visible.forEach(function (item) {
          state.selected[item.id] = e.target.checked;
        });
        renderPanel();
      });
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', function () {
        deleteSelected();
      });
    }
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        clearAll();
      });
    }
    if (markReadBtn) {
      markReadBtn.addEventListener('click', function () {
        markAllRead();
      });
    }
  }

  function injectWidget() {
    var topbar = document.querySelector('.topbar') || document.querySelector('[class*="topbar" i]') || document.querySelector('header') || document.body;
    if (!topbar) {
      setTimeout(injectWidget, 500);
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;

    var existing = findExistingBell();
    var btn;
    var badge;
    if (existing) {
      btn = existing;
      btn.id = BUTTON_ID;
      btn.setAttribute('aria-label', 'Notifications');
      btn.style.position = btn.style.position || 'relative';
      badge = document.getElementById('hrms-notifications-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'hrms-notifications-badge';
        badge.textContent = '0';
        badge.style.position = 'absolute';
        badge.style.top = '-2px';
        badge.style.right = '-2px';
        badge.style.minWidth = '18px';
        badge.style.height = '18px';
        badge.style.padding = '0 5px';
        badge.style.fontSize = '10px';
        badge.style.lineHeight = '18px';
        badge.style.borderRadius = '999px';
        badge.style.background = 'var(--danger, #ef4444)';
        badge.style.color = '#fff';
        badge.style.display = 'none';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      });
    } else {
      var ui = createButton();
      if (topbar === document.body) {
        document.body.appendChild(ui.wrap);
        ui.wrap.style.position = 'fixed';
        ui.wrap.style.top = '16px';
        ui.wrap.style.right = '16px';
        ui.wrap.style.zIndex = '2200';
      } else {
        topbar.appendChild(ui.wrap);
      }
      btn = ui.btn;
      badge = ui.badge;
    }

    var panel = createPanel();
    document.body.appendChild(panel);
    wirePanel(panel, panel);

    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      if (target.closest('#' + PANEL_ID) || target.closest('#' + BUTTON_ID)) return;
      hidePanel();
    });

    window.addEventListener('resize', function () {
      var panel = document.getElementById(PANEL_ID);
      if (panel && panel.style.display === 'block' && btn) {
        positionPanel(panel, btn);
      }
    });

    fetchNotifications();
    setInterval(fetchNotifications, REFRESH_MS);

    setInterval(function () {
      var btn = document.getElementById(BUTTON_ID);
      if (btn) {
        syncBadgeVisibility(btn);
      }
    }, 500);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        injectWidget();
      });
    } else {
      injectWidget();
    }
  }

  init();
})();
