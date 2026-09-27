// ---------- Play-is-School -- Teacher Dashboard Controller ----------
const user = requireRole('teacher');
let myStudents = [];
let allStudents = [];
let activeThreadUserId = null;
let teacherCalendar = null;

function onPanelShown(panel) {
  if (panel === 'overview') loadOverview();
  if (panel === 'students') loadStudentsPanel();
  if (panel === 'attendance') loadAttendance();
  if (panel === 'progress') loadProgressPanel();
  if (panel === 'messages') loadInbox();
  if (panel === 'events') loadEvents();
  if (panel === 'pickup') loadPickupPanel();
  if (panel === 'alerts') loadAlerts();
}

async function loadMyStudents() {
  const { students } = await api.get('/students');
  allStudents = students;
  myStudents = students.filter((s) => s.teacher && (s.teacher._id === user.id || s.teacher === user.id));
  if (!myStudents.length) {
    // If not specifically assigned by ID, show all active students in class roster
    myStudents = allStudents;
  }
  return myStudents;
}

// ---------- Overview ----------
async function loadOverview() {
  await loadMyStudents();
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-user-graduate"></i></div>
      <div class="stat-content"><div class="num">${myStudents.length}</div><div class="label">My Class Students</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-users"></i></div>
      <div class="stat-content"><div class="num">${allStudents.length}</div><div class="label">Total School Students</div></div>
    </div>
  `;
  const { roster } = await api.get('/attendance/class');
  document.getElementById('todayRoster').innerHTML = roster.length ? `
    <div class="table-responsive">
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Today's Status</th></tr></thead>
        <tbody>
          ${roster.map((r) => `
            <tr>
              <td><strong>${r.student.name}</strong></td>
              <td>${r.student.className || '—'}</td>
              <td>${r.attendance ? `<span class="badge ${r.attendance.status}">${r.attendance.status}</span>` : '<span style="color:var(--ink-muted); font-style:italic;">Not marked yet</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty-state"><i class="fa-solid fa-clipboard-question"></i><p>No students assigned to your class roster yet.</p></div>';
}

// ---------- Students Panel (Edit Student Information & Pickup) ----------
async function loadStudentsPanel() {
  const { students } = await api.get('/students');
  allStudents = students;
  myStudents = students.filter((s) => s.teacher && (s.teacher._id === user.id || s.teacher === user.id));

  const filter = document.getElementById('teacherStudentFilter')?.value || 'my';
  const displayList = (filter === 'my' && myStudents.length) ? myStudents : allStudents;

  const tbody = document.getElementById('teacherStudentsTbody');
  if (!displayList.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map((s) => {
    const bdate = s.birthdate ? new Date(s.birthdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    return `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td><span class="badge" style="background:#F1F5F9; color:var(--ink);">${s.className || 'Unassigned'}</span></td>
        <td>${s.parent ? `${s.parent.name}` : '<em>Unassigned</em>'}</td>
        <td>${bdate}</td>
        <td><span class="badge ${s.status}">${s.status}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-secondary btn-sm" data-edit-student="${s._id}" title="Edit Student Information">
              <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button class="btn btn-ghost btn-sm" data-details-student="${s._id}" title="View Details & Authorized Pickup">
              <i class="fa-solid fa-shield-halved"></i> Details &amp; Pickup
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind Edit buttons
  tbody.querySelectorAll('[data-edit-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = displayList.find((x) => x._id === btn.dataset.editStudent);
      if (s) openEditStudentModal(s, loadStudentsPanel);
    });
  });

  // Bind Details & Pickup buttons
  tbody.querySelectorAll('[data-details-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showStudentDetailsModal(btn.dataset.detailsStudent, { canEdit: true, onStudentUpdated: loadStudentsPanel });
    });
  });
}

document.getElementById('teacherStudentFilter')?.addEventListener('change', loadStudentsPanel);

// ---------- Attendance ----------
const attDateInput = document.getElementById('attDate');
attDateInput.valueAsDate = new Date();
attDateInput.addEventListener('change', loadAttendance);

async function loadAttendance() {
  const date = attDateInput.value || new Date().toISOString().slice(0, 10);
  const { roster } = await api.get(`/attendance/class?date=${date}`);
  const tbody = document.getElementById('attTbody');
  if (!roster.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-clipboard-user"></i><p>No students assigned to you.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = roster.map((r) => `
    <tr data-student="${r.student.id}">
      <td><strong>${r.student.name}</strong></td>
      <td>${r.student.className || '—'}</td>
      <td>
        <select class="statusSelect" style="padding:6px 10px; border-radius:6px; border:1px solid #CBD5E1;">
          ${['present', 'late', 'excused', 'absent'].map((s) => `<option value="${s}" ${r.attendance && r.attendance.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input class="remarksInput" value="${r.attendance ? (r.attendance.remarks || '') : ''}" placeholder="Optional remarks" style="padding:6px 10px; border-radius:6px; border:1px solid #CBD5E1; width:100%; max-width:240px;" /></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach((row) => {
    const save = async () => {
      await api.post('/attendance', {
        student: row.dataset.student,
        date,
        status: row.querySelector('.statusSelect').value,
        remarks: row.querySelector('.remarksInput').value,
      });
    };
    row.querySelector('.statusSelect').addEventListener('change', save);
    row.querySelector('.remarksInput').addEventListener('change', save);
  });
}

// ---------- Academic Progress ----------
async function loadProgressPanel() {
  if (!allStudents.length) await loadMyStudents();
  const sel = document.getElementById('progStudentSelect');
  const targetList = myStudents.length ? myStudents : allStudents;
  sel.innerHTML = targetList.map((s) => `<option value="${s._id}">${s.name}</option>`).join('');
  sel.onchange = renderProgressList;
  if (targetList.length) renderProgressList();
}

async function renderProgressList() {
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const { progress } = await api.get(`/progress/student/${sid}`);
  document.getElementById('progressList').innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:var(--primary); font-weight:700;"><i class="fa-regular fa-calendar"></i> ${fmtDate(p.date)}</span>
      </div>
      ${p.milestone ? `<p style="margin-bottom:4px;"><strong>Milestone:</strong> ${p.milestone}</p>` : ''}
      ${p.activity ? `<p style="margin-bottom:4px;"><strong>Activity:</strong> ${p.activity}</p>` : ''}
      ${p.assessment ? `<p style="margin-bottom:4px;"><strong>Assessment:</strong> ${p.assessment}</p>` : ''}
      ${p.notes ? `<p style="margin:0; color:var(--ink-soft); font-style:italic;">Notes: ${p.notes}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No progress entries logged yet for this student.</p></div>';
}

document.getElementById('progressForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  await api.post('/progress', {
    student: sid,
    milestone: document.getElementById('pMilestone').value.trim(),
    activity: document.getElementById('pActivity').value.trim(),
    assessment: document.getElementById('pAssessment').value.trim(),
    notes: document.getElementById('pNotes').value.trim(),
  });
  document.getElementById('progressForm').reset();
  renderProgressList();
});

// ---------- Messages ----------
async function loadInbox() {
  if (!allStudents.length) await loadMyStudents();
  const { threads } = await api.get('/messages/inbox');
  const parentsFromStudents = new Map();
  allStudents.forEach((s) => { if (s.parent) parentsFromStudents.set(s.parent._id, s.parent); });

  const box = document.getElementById('inboxList');
  const known = new Map(threads.map((t) => [t.with.id, t]));
  parentsFromStudents.forEach((p, id) => {
    if (!known.has(id)) known.set(id, { with: { id, name: p.name, role: 'parent' }, unread: 0 });
  });

  const items = Array.from(known.values());
  box.innerHTML = items.length ? items.map((t) => `
    <div class="list-row" style="cursor:pointer;" data-open="${t.with.id}" data-name="${t.with.name}">
      <span><i class="fa-solid fa-user" style="color:var(--primary); margin-right:8px;"></i>${t.with.name}${t.unread ? ` <span class="badge pending">${t.unread} new</span>` : ''}</span>
      <i class="fa-solid fa-chevron-right" style="color:var(--ink-light); font-size:12px;"></i>
    </div>
  `).join('') : '<div class="empty-state"><p>No parents to message yet.</p></div>';

  box.querySelectorAll('[data-open]').forEach((row) => row.addEventListener('click', () => openThread(row.dataset.open, row.dataset.name)));
}

async function openThread(userId, name) {
  activeThreadUserId = userId;
  document.getElementById('threadWithName').textContent = name;
  const { messages } = await api.get(`/messages/thread/${userId}`);
  const thread = document.getElementById('chatThread');
  thread.innerHTML = messages.map((m) => `<div class="chat-bubble ${m.sender === userId || m.sender._id === userId ? 'theirs' : 'mine'}">${m.content}</div>`).join('');
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById('sendChatBtn').addEventListener('click', async () => {
  const input = document.getElementById('chatInput');
  if (!activeThreadUserId || !input.value.trim()) return;
  await api.post('/messages', { receiver: activeThreadUserId, content: input.value.trim() });
  input.value = '';
  openThread(activeThreadUserId, document.getElementById('threadWithName').textContent);
});

// ---------- Events Calendar ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  if (!teacherCalendar) {
    teacherCalendar = new EventsCalendar({
      containerId: 'teacherEventsCalendarContainer',
      events,
      canManage: true,
      onDeleteEvent: async (eventId) => {
        await api.del(`/events/${eventId}`);
        loadEvents();
      },
    });
  } else {
    teacherCalendar.setEvents(events);
  }
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>Publish Notice / Event</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="eventForm">
      <div class="field"><label>Title</label><input id="eTitle" placeholder="e.g. Field Trip Permission Reminder" required /></div>
      <div class="field"><label>Date</label><input type="date" id="eDate" required /></div>
      <div class="field"><label>Message / Description</label><textarea id="eDesc" rows="3" placeholder="Enter notice details for parents…"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Publish Notice</button>
    </form>
  `);
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/events', {
        title: document.getElementById('eTitle').value.trim(),
        date: document.getElementById('eDate').value,
        audience: 'parents',
        description: document.getElementById('eDesc').value.trim(),
      });
      Modal.close();
      loadEvents();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Pickup Verification Panel ----------
async function loadPickupPanel() {
  if (!allStudents.length) await loadMyStudents();
  const sel = document.getElementById('pickupStudentSelect');
  const targetList = myStudents.length ? myStudents : allStudents;
  sel.innerHTML = targetList.map((s) => `<option value="${s._id}">${s.name}</option>`).join('');
  sel.onchange = renderPickupList;
  if (targetList.length) renderPickupList();
}

async function renderPickupList() {
  const sid = document.getElementById('pickupStudentSelect').value;
  if (!sid) return;
  const { authorizations } = await api.get(`/pickup/student/${sid}`);
  const listEl = document.getElementById('pickupList');

  listEl.innerHTML = authorizations.length ? authorizations.map((a) => `
    <div class="pickup-person-card">
      <div>
        <div class="info-title">
          ${a.authorizedName}
          ${a.verified.length ? `<span class="badge approved" style="margin-left:8px;"><i class="fa-solid fa-check-double"></i> Verified ${a.verified.length}×</span>` : '<span class="badge pending" style="margin-left:8px;">Pending verification</span>'}
        </div>
        <div class="info-meta">
          <strong>Relationship:</strong> ${a.relationship} &nbsp;|&nbsp;
          <strong>Contact:</strong> ${a.contact}
        </div>
        ${a.identification ? `
          <div class="info-meta" style="margin-top:4px;">
            <strong>ID / Details:</strong> ${a.identification}
          </div>
        ` : ''}
      </div>

      <div class="pickup-actions">
        <button class="btn btn-primary btn-sm" data-verify="${a._id}">
          <i class="fa-solid fa-user-check"></i> Verify Pickup Now
        </button>
        <button class="btn btn-ghost btn-sm" data-edit-p="${a._id}" title="Edit Information">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-danger btn-sm" data-del-p="${a._id}" title="Remove Person">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-shield-halved"></i><p>No authorized pickup people registered for this student yet.</p></div>';

  // Bind Verify button
  listEl.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    await api.post(`/pickup/${b.dataset.verify}/verify`, {});
    renderPickupList();
  }));

  // Bind Edit button
  listEl.querySelectorAll('[data-edit-p]').forEach((b) => b.addEventListener('click', () => {
    const item = authorizations.find((x) => x._id === b.dataset.editP);
    if (item) {
      openPickupFormModal({ studentId: sid, pickup: item }, renderPickupList);
    }
  }));

  // Bind Delete button
  listEl.querySelectorAll('[data-del-p]').forEach((b) => b.addEventListener('click', async () => {
    const item = authorizations.find((x) => x._id === b.dataset.delP);
    if (item && confirm(`Remove ${item.authorizedName} from authorized pickup list?`)) {
      await api.del(`/pickup/${item._id}`);
      renderPickupList();
    }
  }));
}

document.getElementById('teacherAddPickupBtn')?.addEventListener('click', () => {
  const sid = document.getElementById('pickupStudentSelect').value;
  if (!sid) return alert('Please select a student first.');
  openPickupFormModal({ studentId: sid }, renderPickupList);
});

// ---------- Emergency Alerts ----------
async function loadAlerts() {
  const { alerts } = await api.get('/alerts');
  document.getElementById('alertsList').innerHTML = alerts.length ? alerts.map((a) => `
    <div class="alert-banner">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong style="font-size:15px;">${a.title}</strong>
        <p style="margin:4px 0 6px; color:#7F1D1D;">${a.message}</p>
        <div class="field-hint" style="color:#991B1B;">
          ${new Date(a.createdAt).toLocaleString()} &bull; Sent by ${a.createdBy ? a.createdBy.name : 'Staff'}
        </div>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-shield-heart"></i><p>No emergency alerts issued.</p></div>';
}

document.getElementById('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api.post('/alerts', {
    title: document.getElementById('aTitle').value.trim(),
    message: document.getElementById('aMessage').value.trim(),
  });
  document.getElementById('alertForm').reset();
  loadAlerts();
});

loadOverview();
