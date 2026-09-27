// ---------- Play-is-School -- Parent Dashboard Controller ----------
const user = requireRole('parent');
let myChildren = [];
let activeChildId = null;
let activeTeacherId = null;
let parentCalendar = null;

function onPanelShown(panel) {
  if (panel === 'overview') loadOverview(true);
  if (panel === 'progress') renderProgress();
  if (panel === 'attendance') renderAttendance();
  if (panel === 'fees') renderFees();
  if (panel === 'messages') openTeacherThread();
  if (panel === 'events') loadEvents();
  if (panel === 'pickup') renderPickup();
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

  const { alerts } = await api.get('/alerts');
  const recent = alerts.slice(0, 2);
  document.getElementById('alertsBanner').innerHTML = recent.map((a) => `
    <div class="alert-banner">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong style="font-size:15px;">${a.title}</strong>
        <p style="margin:4px 0 0; color:#7F1D1D;">${a.message}</p>
      </div>
    </div>
  `).join('');

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
    ? upcoming.map((e) => `
      <div class="list-row">
        <span><strong>${e.title}</strong></span>
        <span style="font-size:13px; color:var(--primary); font-weight:600;"><i class="fa-regular fa-calendar"></i> ${fmtDate(e.date)}</span>
      </div>
    `).join('')
    : '<div class="empty-state"><p>No upcoming school events scheduled.</p></div>';
}

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
  tbody.innerHTML = fees.length ? fees.map((f) => `
    <tr>
      <td><strong>${f.description}</strong></td>
      <td><strong>${fmtMoney(f.amount)}</strong></td>
      <td>${fmtMoney(f.amountPaid)}</td>
      <td>${fmtDate(f.dueDate)}</td>
      <td><span class="badge ${f.status}">${f.status}</span></td>
    </tr>
  `).join('') : `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee statements for this child.</p></div></td></tr>`;
}

// ---------- Messages ----------
async function openTeacherThread() {
  if (!activeTeacherId) {
    document.getElementById('chatThread').innerHTML = '<div class="empty-state"><p>No teacher is assigned to your child yet.</p></div>';
    return;
  }
  const child = myChildren.find((c) => c._id === activeChildId);
  document.getElementById('threadWithName').textContent = child && child.teacher ? child.teacher.name : 'Teacher';
  const { messages } = await api.get(`/messages/thread/${activeTeacherId}`);
  const thread = document.getElementById('chatThread');
  thread.innerHTML = messages.map((m) => {
    const senderId = m.sender._id || m.sender;
    return `<div class="chat-bubble ${senderId === activeTeacherId ? 'theirs' : 'mine'}">${m.content}</div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById('sendChatBtn').addEventListener('click', async () => {
  const input = document.getElementById('chatInput');
  if (!activeTeacherId || !input.value.trim()) return;
  await api.post('/messages', { receiver: activeTeacherId, student: activeChildId, content: input.value.trim() });
  input.value = '';
  openTeacherThread();
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
