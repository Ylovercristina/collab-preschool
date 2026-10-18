// ---------- Play-is-School -- Parent Dashboard Controller ----------
const user = requireRole('parent');
let myChildren = [];
let activeChildId = null;
let activeTeacherId = null;
let parentCalendar = null;
let notificationFilter = 'all';
let notificationSearchQuery = '';
let knownNotificationIds = new Set();
let notificationsInitialized = false;
let notificationPolling = false;

function onPanelShown(panel) {
  if (panel === 'overview') return loadOverview(true);
  if (panel === 'notifications') return loadPaymentNotifications();
  if (panel === 'enrollment') return loadParentEnrollment();
  if (panel === 'progress') return renderProgress();
  if (panel === 'attendance') return renderAttendance();
  if (panel === 'fees') {
    return Promise.all([renderFees(), loadPaymentNotifications()]);
  }
  if (panel === 'messages') return openTeacherThread();
  if (panel === 'events') return loadEvents();
  if (panel === 'pickup') return renderPickup();
}

async function loadChildren() {
  const { students } = await api.get('/students');
  myChildren = students;
  if (myChildren.length) {
    if (!activeChildId || !myChildren.some((c) => c._id === activeChildId)) {
      activeChildId = myChildren[0]._id;
      activeTeacherId = myChildren[0].teacher ? (myChildren[0].teacher._id || myChildren[0].teacher) : null;
    }
  }
  const box = document.getElementById('childSwitcherBox');
  if (myChildren.length > 1) {
    box.innerHTML = `
      <div style="background:#F0FDF4; border:1px solid #BBF7D0; padding:12px 16px; border-radius:10px; display:inline-flex; align-items:center; gap:10px;">
        <i class="fa-solid fa-children" style="color:var(--primary); font-size:18px;"></i>
        <label style="font-weight:700; font-size:14px; color:var(--ink);">Select Child: </label>
        <select id="childSwitch" style="padding:6px 12px; border-radius:6px; border:1.5px solid #38A169; font-weight:700; background:#FFF;">
          ${myChildren.map((c) => `<option value="${c._id}" ${c._id === activeChildId ? 'selected' : ''}>${c.name} (${c.className || 'General'})</option>`).join('')}
        </select>
      </div>
    `;
    document.getElementById('childSwitch').addEventListener('change', (e) => {
      activeChildId = e.target.value;
      const child = myChildren.find((c) => c._id === activeChildId);
      activeTeacherId = child && child.teacher ? (child.teacher._id || child.teacher) : null;
      loadOverview(true);
    });
  } else if (myChildren.length === 1) {
    box.innerHTML = `
      <div style="background:#F0FDF4; border:1px solid #BBF7D0; padding:10px 16px; border-radius:10px; display:inline-flex; align-items:center; gap:10px;">
        <i class="fa-solid fa-child" style="color:var(--primary); font-size:18px;"></i>
        <span style="font-weight:700; color:var(--ink);">${myChildren[0].name}</span>
        ${myChildren[0].className ? `<span class="badge approved">${myChildren[0].className}</span>` : ''}
      </div>
    `;
  } else {
    box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-clock"></i><p>No student profile is currently linked to your parent account. Please contact the school administration.</p></div>`;
  }
}

async function loadOverview(skipChildLoad) {
  if (!skipChildLoad) await loadChildren();

  await Promise.all([loadPaymentNotifications(), renderEmergencyBanners()]);

  if (!activeChildId) {
    document.getElementById('latestProgress').innerHTML = '<div class="empty-state"><p>No child selected.</p></div>';
    document.getElementById('upcomingEvents').innerHTML = '<div class="empty-state"><p>No upcoming events.</p></div>';
    return;
  }

  const { progress } = await api.get(`/progress/student/${activeChildId}`);
  document.getElementById('latestProgress').innerHTML = progress.length ? `
    <p style="color:var(--primary); font-weight:700; margin-bottom:6px;">
      <i class="fa-regular fa-calendar-check" style="margin-right:4px;"></i> ${fmtDate(progress[0].date)}
    </p>
    <p style="font-weight:600; color:var(--ink); margin-bottom:4px;">${progress[0].milestone || progress[0].activity || 'Daily Observation'}</p>
    <p style="margin:0; font-size:13.5px; color:var(--ink-soft);">${progress[0].assessment || progress[0].notes || 'Logged by teacher'}</p>
  ` : '<div class="empty-state"><p>No learning observations recorded yet.</p></div>';

  const { events } = await api.get('/events');
  const upcoming = events.filter((e) => new Date(e.date) >= new Date()).slice(0, 3);
  document.getElementById('upcomingEvents').innerHTML = upcoming.length
    ? upcoming.map((e) => {
      const evStatus = computeEventStatus(e);
      return `
      <div class="list-row">
        <span><strong>${escapeParentMessage(e.title)}</strong></span>
        <span style="font-size:13px; color:var(--primary); font-weight:600;"><i class="fa-regular fa-calendar"></i> ${fmtDate(e.date)}</span>
        <span class="status-badge ${evStatus}" style="font-size:10px; padding:2px 6px;">${evStatus.charAt(0).toUpperCase() + evStatus.slice(1)}</span>
      </div>
    `;
    }).join('')
    : '<div class="empty-state"><p>No upcoming school events scheduled.</p></div>';
}

async function renderEmergencyBanners() {
  const container = document.getElementById('alertsBanner');
  if (!container) return;
  const { alerts } = await api.get('/alerts');
  const unresolved = alerts.filter((alert) => alert.status !== 'all-clear'
    && !(alert.acknowledgements || []).some((item) => String(item.parent?._id || item.parent) === String(user.id))).slice(0, 3);
  container.innerHTML = unresolved.map((a) => {
    const latestUpdate = (a.updates || []).slice(-1)[0];
    return `
    <div class="alert-banner">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong style="font-size:15px;">URGENT: ${escapeParentMessage(a.title)}</strong>
        <p style="margin:4px 0 0; color:#7F1D1D;">${escapeParentMessage(latestUpdate ? latestUpdate.message : (a.description || a.message))}</p>
        ${a.safetyInstructions ? `<p style="margin:4px 0 0;"><strong>Instructions:</strong> ${escapeParentMessage(a.safetyInstructions)}</p>` : ''}
        <p style="margin:4px 0 0;font-size:12px;">${escapeParentMessage(a.severity || 'high')} · Issued ${fmtDate(a.createdAt)}</p>
        <button type="button" class="btn btn-danger btn-sm" data-ack-alert="${escapeParentMessage(a._id)}" style="margin-top:8px;">Acknowledge</button>
      </div>
    </div>
  `;
  }).join('');
  document.querySelectorAll('[data-ack-alert]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.patch(`/alerts/${button.dataset.ackAlert}/acknowledge`, {});
      showToast('Emergency acknowledged.', 'info');
      await renderEmergencyBanners();
    } catch (err) { alert(err.message); }
  }));
}

function relativeNotificationTime(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function loadPaymentNotifications({ silent = false } = {}) {
  const fullContainer = document.getElementById('parentNotificationsList');
  if (fullContainer && !notificationsInitialized) fullContainer.innerHTML = '<div class="notification-loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Loading notifications</div>';
  let notifications;
  let unreadCount;
  try {
    ({ notifications, unreadCount } = await api.get('/notifications'));
  } catch (error) {
    if (fullContainer) fullContainer.innerHTML = `<div class="notification-empty">${escapeParentMessage(error.message || 'Notifications could not be loaded.')}</div>`;
    if (!silent) showToast(error.message || 'Notifications could not be loaded.', 'error');
    return;
  }
  notifications = (notifications || []).slice().sort((left, right) => {
    const priority = (right.priority || 0) - (left.priority || 0);
    return priority || new Date(right.createdAt) - new Date(left.createdAt);
  });
  const nextIds = new Set(notifications.map((item) => item._id));
  if (notificationsInitialized && !silent) {
    notifications.filter((item) => !knownNotificationIds.has(item._id)).forEach((item) => showToast(`New ${item.type === 'emergency' ? 'emergency' : 'school'} notification: ${item.title}`, item.type === 'emergency' ? 'error' : 'info'));
  }
  knownNotificationIds = nextIds;
  notificationsInitialized = true;
  const badge = document.getElementById('notificationUnreadBadge');
  if (badge) {
    badge.hidden = unreadCount === 0;
    badge.textContent = unreadCount;
    badge.setAttribute('aria-label', `${unreadCount} unread notifications`);
  }
  const renderList = (container, compact = false) => {
    if (!container) return;
    const filtered = compact ? notifications.filter((notification) => !notification.readAt).slice(0, 3) : notifications.filter((notification) => (
      notificationFilter === 'all'
      || (notificationFilter === 'events' && notification.type === 'event')
      || (notificationFilter === 'emergencies' && notification.type === 'emergency')
      || (notificationFilter === 'unread' && !notification.readAt)
    )).filter((notification) => !notificationSearchQuery
      || `${notification.title} ${notification.message} ${notification.type}`.toLowerCase().includes(notificationSearchQuery));
    if (!filtered.length) {
      if (compact) {
        container.innerHTML = '<div class="notification-empty">No new notifications.</div>';
      } else {
        container.innerHTML = `<div class="record-category-tabs" role="tablist" aria-label="Notification type">${[['all', 'All'], ['events', 'Events'], ['emergencies', 'Emergencies'], ['unread', 'Unread']].map(([value, label]) => `<button type="button" class="record-category-tab ${notificationFilter === value ? 'active' : ''}" data-notification-filter="${value}" role="tab" aria-selected="${notificationFilter === value}">${label}</button>`).join('')}</div><div class="records-filterbar"><input id="notificationSearchInput" data-notification-search type="search" value="${escapeParentMessage(notificationSearchQuery)}" placeholder="Search title or message..." aria-label="Search notifications" /><button type="button" class="btn btn-secondary btn-sm" data-mark-all-read ${unreadCount ? '' : 'disabled'}><i class="fa-solid fa-check-double" aria-hidden="true"></i> Mark all as read</button><span class="records-result-count">0 notifications</span></div><div class="notification-empty">${notifications.length ? 'No notifications match these filters.' : 'No notifications yet.'}</div>`;
        bindFullNotificationControls(container, notifications, renderList);
      }
      return;
    }
    if (!compact) {
      container.innerHTML = `
        <div class="record-category-tabs" role="tablist" aria-label="Notification type">
          ${[['all', 'All'], ['events', 'Events'], ['emergencies', 'Emergencies'], ['unread', 'Unread']].map(([value, label]) => `<button type="button" class="record-category-tab ${notificationFilter === value ? 'active' : ''}" data-notification-filter="${value}" role="tab" aria-selected="${notificationFilter === value}">${label}</button>`).join('')}
        </div>
        <div class="records-filterbar">
          <input id="notificationSearchInput" data-notification-search type="search" value="${escapeParentMessage(notificationSearchQuery)}" placeholder="Search title or message..." aria-label="Search notifications" />
          <button type="button" class="btn btn-secondary btn-sm" data-mark-all-read ${unreadCount ? '' : 'disabled'}><i class="fa-solid fa-check-double" aria-hidden="true"></i> Mark all as read</button>
          <span class="records-result-count">Showing ${filtered.length} of ${notifications.length} notifications</span>
        </div>
        <div class="table-responsive">
          <table class="notification-table">
            <thead><tr><th>Type</th><th>Notification</th><th>Received</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${filtered.map((notification) => {
              const emergency = notification.type === 'emergency';
              const icon = emergency ? 'fa-triangle-exclamation' : (notification.type === 'event' ? 'fa-calendar-days' : 'fa-receipt');
              return `<tr class="${emergency ? 'notification-emergency-row' : ''} ${notification.readAt ? '' : 'notification-unread-row'}">
                <td><span class="badge ${emergency ? 'archived' : 'approved'}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${emergency ? 'Emergency' : (notification.type === 'event' ? 'Event' : 'Fee')}</span></td>
                <td><strong>${escapeParentMessage(notification.title)}</strong><div class="notification-preview">${escapeParentMessage(notification.message)}</div></td>
                <td><time datetime="${escapeParentMessage(notification.createdAt)}">${relativeNotificationTime(notification.createdAt)}</time></td>
                <td><span class="badge ${notification.readAt ? 'approved' : 'pending'}">${notification.readAt ? 'Read' : 'Unread'}</span></td>
                <td><div class="notification-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-open-notification="${escapeParentMessage(notification._id)}">Details</button>${notification.payment && notification.fee ? `<button type="button" class="btn btn-ghost btn-sm" data-view-notification-receipt="${escapeParentMessage(notification.payment._id)}" data-fee-id="${escapeParentMessage(notification.fee._id)}">Receipt</button>` : ''}</div></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      `;
      bindFullNotificationControls(container, notifications, renderList);
      return;
    }
    container.innerHTML = `
      <div class="${compact ? 'card' : ''}" style="${compact ? 'margin-bottom:20px;' : ''}">
        ${compact ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><i class="fa-solid fa-bell" style="color:var(--primary);"></i><h3 style="margin:0;">Recent unread notifications</h3>${unreadCount ? `<span class="badge pending">${unreadCount} unread</span>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-open-notifications-panel>All</button></div>` : `
          <div class="parent-notification-toolbar">
            <div class="notification-filters" role="group" aria-label="Filter notifications">
              ${[['all', 'All'], ['events', 'Events'], ['emergencies', 'Emergencies'], ['unread', 'Unread']].map(([value, label]) => `<button type="button" class="btn btn-ghost btn-sm notification-filter" data-notification-filter="${value}" aria-pressed="${notificationFilter === value}">${label}</button>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-mark-all-read ${unreadCount ? '' : 'disabled'}><i class="fa-solid fa-check-double" aria-hidden="true"></i> Mark all as read</button>
          </div>
        `}
        ${filtered.map((notification) => {
          const emergency = notification.type === 'emergency';
          const icon = emergency ? 'fa-triangle-exclamation' : (notification.type === 'event' ? 'fa-calendar-days' : 'fa-receipt');
          return `<article class="notification-row ${!notification.readAt ? 'unread' : ''} ${emergency ? 'notification-type-emergency' : ''}">
            <span class="notification-type-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
            <div><div class="notification-title">${escapeParentMessage(notification.title)}</div><p style="margin:2px 0 4px;font-size:13px;">${escapeParentMessage(notification.message)}</p><time datetime="${escapeParentMessage(notification.createdAt)}" style="font-size:12px;color:var(--ink-muted);">${relativeNotificationTime(notification.createdAt)}</time></div>
            <div style="display:flex;align-items:center;gap:6px;">${!notification.readAt ? '<span class="notification-unread-dot" aria-label="Unread"></span>' : ''}<button type="button" class="btn btn-ghost btn-sm" data-open-notification="${escapeParentMessage(notification._id)}">Details</button>${notification.payment && notification.fee ? `<button type="button" class="btn btn-ghost btn-sm" data-view-notification-receipt="${escapeParentMessage(notification.payment._id)}" data-fee-id="${escapeParentMessage(notification.fee._id)}">Receipt</button>` : ''}</div>
          </article>`;
        }).join('')}
      </div>
    `;
  };
  renderList(document.getElementById('paymentNotifications'), true);
  renderList(document.getElementById('parentNotificationsList'));
  document.querySelectorAll('[data-open-notifications-panel]').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('.nav-item[data-panel="notifications"]')?.click();
  }));
}

function bindFullNotificationControls(container, notifications, renderList) {
  container.querySelectorAll('[data-notification-filter]').forEach((button) => button.addEventListener('click', () => {
    notificationFilter = button.dataset.notificationFilter;
    renderList(container);
    bindFullNotificationControls(container, notifications, renderList);
  }));
  container.querySelector('[data-notification-search]')?.addEventListener('input', (event) => {
    notificationSearchQuery = event.target.value.trim().toLowerCase();
    renderList(container);
    bindFullNotificationControls(container, notifications, renderList);
    const search = container.querySelector('[data-notification-search]');
    search?.focus();
    search?.setSelectionRange(notificationSearchQuery.length, notificationSearchQuery.length);
  });
  container.querySelector('[data-mark-all-read]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const unread = notifications.filter((notification) => !notification.readAt);
    button.disabled = true;
    try {
      await Promise.all(unread.map((notification) => api.patch(`/notifications/${notification._id}/read`, {})));
      await loadPaymentNotifications({ silent: true });
      showToast('All notifications marked as read.');
    } catch (error) {
      showToast(error.message || 'Could not mark all notifications as read.', 'error');
      button.disabled = false;
    }
  });
  container.querySelectorAll('[data-open-notification]').forEach((button) => button.addEventListener('click', async () => {
    const notification = notifications.find((item) => item._id === button.dataset.openNotification);
    if (!notification) return;
    if (!notification.readAt) await api.patch(`/notifications/${notification._id}/read`, {});
    const event = notification.event;
    const alert = notification.alert;
    const details = event ? `
      <p>${escapeParentMessage(event.description || notification.message)}</p>
      <p><strong>Date:</strong> ${fmtDate(event.date)}<br><strong>Time:</strong> ${escapeParentMessage(event.time || '—')}<br><strong>Venue:</strong> ${escapeParentMessage(event.venue || '—')}</p>
    ` : alert ? `
      <p>${escapeParentMessage(notification.message)}</p>
      ${alert.safetyInstructions ? `<p><strong>Safety instructions:</strong> ${escapeParentMessage(alert.safetyInstructions)}</p>` : ''}
      <p><strong>Severity:</strong> ${escapeParentMessage(alert.severity || 'high')}<br><strong>Status:</strong> ${escapeParentMessage(alert.status || 'active')}</p>
    ` : `<p>${escapeParentMessage(notification.message)}</p>`;
    Modal.open(`<h3>${escapeParentMessage(notification.title)}</h3>${details}`);
    await loadPaymentNotifications({ silent: true });
  }));
  container.querySelectorAll('[data-view-notification-receipt]').forEach((button) => button.addEventListener('click', () => {
    showPaymentReceipt(button.dataset.feeId, button.dataset.viewNotificationReceipt);
  }));
}

window.setInterval(async () => {
  if (notificationPolling) return;
  if (document.visibilityState !== 'visible') return;
  notificationPolling = true;
  try {
    await Promise.all([loadPaymentNotifications({ silent: false }), renderEmergencyBanners()]);
  } finally {
    notificationPolling = false;
  }
}, 30000);

// ---------- Progress ----------
async function renderProgress() {
  if (!activeChildId) return;
  const { progress } = await api.get(`/progress/student/${activeChildId}`);
  document.getElementById('progressList').innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:var(--primary); font-weight:700;"><i class="fa-regular fa-calendar"></i> ${fmtDate(p.date)}</span>
        <span style="font-size:13px; color:var(--ink-muted);"><i class="fa-solid fa-chalkboard-user"></i> ${p.teacher ? p.teacher.name : 'Teacher'}</span>
      </div>
      ${p.milestone ? `<p style="margin-bottom:4px;"><strong>Milestone:</strong> ${p.milestone}</p>` : ''}
      ${p.activity ? `<p style="margin-bottom:4px;"><strong>Activity:</strong> ${p.activity}</p>` : ''}
      ${p.assessment ? `<p style="margin-bottom:4px;"><strong>Assessment:</strong> ${p.assessment}</p>` : ''}
      ${p.notes ? `<p style="margin:0; color:var(--ink-soft); font-style:italic;">Notes: ${p.notes}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-chart-line"></i><p>No academic progress entries recorded yet.</p></div>';
}

// ---------- Attendance ----------
async function renderAttendance() {
  if (!activeChildId) return;
  const { attendance } = await api.get(`/attendance/student/${activeChildId}`);
  const tbody = document.getElementById('attTbody');
  tbody.innerHTML = attendance.length ? attendance.map((a) => `
    <tr>
      <td><strong>${fmtDate(a.date)}</strong></td>
      <td><span class="badge ${a.status}">${a.status}</span></td>
      <td>${a.remarks || '—'}</td>
    </tr>
  `).join('') : `<tr><td colspan="3"><div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No attendance records logged yet.</p></div></td></tr>`;
}

// ---------- Fees ----------
async function renderFees() {
  if (!activeChildId) return;
  const { fees } = await api.get(`/fees/student/${activeChildId}`);
  const tbody = document.getElementById('feesTbody');
  tbody.innerHTML = fees.length ? fees.map((f) => {
    const totalPaid = Number((f.payments || [])
      .filter((payment) => payment.receiptState !== 'voided')
      .reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0)
      .toFixed(2));
    const remainingBalance = Math.max(0, Number((Number(f.amount) - totalPaid).toFixed(2)));
    const status = totalPaid <= 0 ? 'unpaid' : (remainingBalance === 0 ? 'paid' : 'partial');
    const statusLabel = { unpaid: 'Unpaid', partial: 'Partial Payment', paid: 'Paid' }[status];
    return `
      <tr>
        <td data-label="Description"><strong class="fee-primary-value">${escapeParentMessage(f.description)}</strong>${renderPaymentHistory(f.payments, f._id, f.amount)}</td>
        <td data-label="Total Amount" class="fee-numeric"><strong class="fee-primary-value">${fmtMoney(f.amount)}</strong></td>
        <td data-label="Total Paid" class="fee-numeric">${fmtMoney(totalPaid)}</td>
        <td data-label="Remaining Balance" class="fee-numeric"><span class="fee-balance">${fmtMoney(remainingBalance)}</span></td>
        <td data-label="Due Date">${fmtDate(f.dueDate)}</td>
        <td data-label="Status"><span class="badge ${status}">${statusLabel}</span></td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee statements for this child.</p></div></td></tr>`;
  tbody.querySelectorAll('[data-view-receipt]').forEach((button) => {
    button.addEventListener('click', () => showPaymentReceipt(button.dataset.feeId, button.dataset.viewReceipt));
  });
}

// ---------- Messages ----------
function escapeParentMessage(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function openTeacherThread() {
  if (!activeTeacherId) {
    document.getElementById('chatThread').innerHTML = '<div class="empty-state"><p>No teacher is assigned to your child yet.</p></div>';
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendChatBtn').disabled = true;
    return;
  }
  document.getElementById('chatInput').disabled = false;
  document.getElementById('sendChatBtn').disabled = false;
  document.getElementById('parentMessageFormMessage').textContent = '';
  const child = myChildren.find((c) => c._id === activeChildId);
  document.getElementById('threadWithName').textContent = child && child.teacher ? child.teacher.name : 'Teacher';
  const { messages } = await api.get(`/messages/thread/${activeTeacherId}`);
  const thread = document.getElementById('chatThread');
  thread.innerHTML = messages.map((m) => {
    const senderId = String(m.sender._id || m.sender);
    const content = escapeParentMessage(m.content).replace(/\r?\n/g, '<br>');
    return `<div class="chat-bubble ${senderId === String(activeTeacherId) ? 'theirs' : 'mine'}">${content}</div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById('sendChatBtn').addEventListener('click', async () => {
  const input = document.getElementById('chatInput');
  if (!activeTeacherId || !input.value.trim()) return;
  const button = document.getElementById('sendChatBtn');
  button.disabled = true;
  document.getElementById('parentMessageFormMessage').textContent = '';
  try {
    await api.post('/messages', { receiver: activeTeacherId, student: activeChildId, content: input.value.trim() });
    input.value = '';
    await openTeacherThread();
  } catch (err) {
    showMsg(document.getElementById('parentMessageFormMessage'), err.message);
  } finally {
    button.disabled = !activeTeacherId || !activeChildId;
  }
});

// ---------- Events Calendar ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  if (!parentCalendar) {
    parentCalendar = new EventsCalendar({
      containerId: 'parentEventsCalendarContainer',
      events,
      canManage: false,
    });
  } else {
    parentCalendar.setEvents(events);
  }
}

// ---------- Pickup Authorization ----------
async function renderPickup() {
  if (!activeChildId) {
    document.getElementById('pickupList').innerHTML = '<div class="empty-state"><p>No child selected.</p></div>';
    return;
  }
  const { authorizations } = await api.get(`/pickup/student/${activeChildId}`);
  const listEl = document.getElementById('pickupList');

  listEl.innerHTML = authorizations.length ? authorizations.map((a) => `
    <div class="pickup-person-card">
      <div>
        <div class="info-title">
          ${a.authorizedName}
          ${a.verified.length ? `<span class="badge approved" style="margin-left:8px;"><i class="fa-solid fa-check-double"></i> Verified by school ${a.verified.length}×</span>` : '<span class="badge pending" style="margin-left:8px;">Registered</span>'}
        </div>
        <div class="info-meta">
          <strong>Relationship:</strong> ${a.relationship} &nbsp;|&nbsp;
          <strong>Contact:</strong> ${a.contact}
        </div>
        ${a.identification ? `
          <div class="info-meta" style="margin-top:4px;">
            <strong>Identification / Details:</strong> ${a.identification}
          </div>
        ` : ''}
      </div>

      <div class="pickup-actions">
        <button class="btn btn-ghost btn-sm" data-edit-p="${a._id}" title="Edit Information">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button class="btn btn-danger btn-sm" data-del-p="${a._id}" title="Remove Person">
          <i class="fa-solid fa-trash-can"></i> Remove
        </button>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-shield-halved"></i><p>No authorized pickup persons added yet. Register trusted family members or guardians who may pick up your child.</p></div>';

  // Bind Edit button
  listEl.querySelectorAll('[data-edit-p]').forEach((b) => b.addEventListener('click', () => {
    const item = authorizations.find((x) => x._id === b.dataset.editP);
    if (item) {
      openPickupFormModal({ studentId: activeChildId, pickup: item }, renderPickup);
    }
  }));

  // Bind Delete button
  listEl.querySelectorAll('[data-del-p]').forEach((b) => b.addEventListener('click', async () => {
    const item = authorizations.find((x) => x._id === b.dataset.delP);
    if (item && confirm(`Remove ${item.authorizedName} from authorized pickup list?`)) {
      await api.del(`/pickup/${item._id}`);
      renderPickup();
    }
  }));
}

document.getElementById('addPickupBtn').addEventListener('click', () => {
  if (!activeChildId) return alert('No child linked to your account yet.');
  openPickupFormModal({ studentId: activeChildId }, renderPickup);
});

loadOverview();
