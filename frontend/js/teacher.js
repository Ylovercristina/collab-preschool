const user = requireRole('teacher');
let myStudents = [];
let activeThreadUserId = null;

function onPanelShown(panel) {
  if (panel === 'attendance') loadAttendance();
  if (panel === 'progress') loadProgressPanel();
  if (panel === 'messages') loadInbox();
  if (panel === 'events') loadEvents();
  if (panel === 'pickup') loadPickupPanel();
  if (panel === 'alerts') loadAlerts();
}

async function loadMyStudents() {
  const { students } = await api.get('/students');
  myStudents = students;
  return students;
}

// ---------- Overview ----------
async function loadOverview() {
  await loadMyStudents();
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card"><div class="num">${myStudents.length}</div><div class="label">My students</div></div>
  `;
  const { roster } = await api.get('/attendance/class');
  document.getElementById('todayRoster').innerHTML = roster.length ? `
    <table><thead><tr><th>Student</th><th>Status today</th></tr></thead><tbody>
      ${roster.map((r) => `<tr><td>${r.student.name}</td><td>${r.attendance ? `<span class="badge ${r.attendance.status}">${r.attendance.status}</span>` : '<em>not marked</em>'}</td></tr>`).join('')}
    </tbody></table>
  ` : '<div class="empty-state">No students assigned to you yet.</div>';
}

// ---------- Attendance ----------
const attDateInput = document.getElementById('attDate');
attDateInput.valueAsDate = new Date();
attDateInput.addEventListener('change', loadAttendance);

async function loadAttendance() {
  const date = attDateInput.value || new Date().toISOString().slice(0, 10);
  const { roster } = await api.get(`/attendance/class?date=${date}`);
  const tbody = document.getElementById('attTbody');
  if (!roster.length) { tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No students assigned to you.</div></td></tr>`; return; }

  tbody.innerHTML = roster.map((r) => `
    <tr data-student="${r.student.id}">
      <td>${r.student.name}</td>
      <td>${r.student.className || '—'}</td>
      <td>
        <select class="statusSelect">
          ${['present', 'late', 'excused', 'absent'].map((s) => `<option value="${s}" ${r.attendance && r.attendance.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input class="remarksInput" value="${r.attendance ? (r.attendance.remarks || '') : ''}" placeholder="optional" /></td>
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

// ---------- Progress ----------
async function loadProgressPanel() {
  if (!myStudents.length) await loadMyStudents();
  const sel = document.getElementById('progStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${s._id}">${s.name}</option>`).join('');
  sel.onchange = renderProgressList;
  if (myStudents.length) renderProgressList();
}

async function renderProgressList() {
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const { progress } = await api.get(`/progress/student/${sid}`);
  document.getElementById('progressList').innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:12px;">
      <p style="margin-bottom:4px; color:var(--ink); font-weight:700;">${fmtDate(p.date)}</p>
      ${p.milestone ? `<p><strong>Milestone:</strong> ${p.milestone}</p>` : ''}
      ${p.activity ? `<p><strong>Activity:</strong> ${p.activity}</p>` : ''}
      ${p.assessment ? `<p><strong>Assessment:</strong> ${p.assessment}</p>` : ''}
      ${p.notes ? `<p><strong>Notes:</strong> ${p.notes}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state">No entries logged yet for this student.</div>';
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
  if (!myStudents.length) await loadMyStudents();
  const { threads } = await api.get('/messages/inbox');
  const parentsFromStudents = new Map();
  myStudents.forEach((s) => { if (s.parent) parentsFromStudents.set(s.parent._id, s.parent); });

  const box = document.getElementById('inboxList');
  const known = new Map(threads.map((t) => [t.with.id, t]));
  parentsFromStudents.forEach((p, id) => { if (!known.has(id)) known.set(id, { with: { id, name: p.name, role: 'parent' }, unread: 0 }); });

  const items = Array.from(known.values());
  box.innerHTML = items.length ? items.map((t) => `
    <div class="list-row" style="cursor:pointer;" data-open="${t.with.id}" data-name="${t.with.name}">
      <span>${t.with.name}${t.unread ? ` <span class="badge pending">${t.unread}</span>` : ''}</span>
      <span>›</span>
    </div>
  `).join('') : '<div class="empty-state">No parents to message yet.</div>';

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

// ---------- Events ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  document.getElementById('eventsList').innerHTML = events.length ? events.map((ev) => `
    <div class="card" style="margin-bottom:14px;">
      <h3 style="margin-bottom:4px;">${ev.title}</h3>
      <p style="margin-bottom:4px;">${fmtDate(ev.date)} · audience: ${ev.audience}</p>
      <p style="margin:0;">${ev.description || ''}</p>
    </div>
  `).join('') : '<div class="empty-state">No events yet.</div>';
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>Notify parents</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="eventForm">
      <div class="field"><label>Title</label><input id="eTitle" required /></div>
      <div class="field"><label>Date</label><input type="date" id="eDate" required /></div>
      <div class="field"><label>Message</label><textarea id="eDesc" rows="3"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Send notice</button>
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
    } catch (err) { showMsg(msg, err.message); }
  });
});

// ---------- Pickup verification ----------
async function loadPickupPanel() {
  if (!myStudents.length) await loadMyStudents();
  const sel = document.getElementById('pickupStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${s._id}">${s.name}</option>`).join('');
  sel.onchange = renderPickupList;
  if (myStudents.length) renderPickupList();
}

async function renderPickupList() {
  const sid = document.getElementById('pickupStudentSelect').value;
  if (!sid) return;
  const { authorizations } = await api.get(`/pickup/student/${sid}`);
  document.getElementById('pickupList').innerHTML = authorizations.length ? authorizations.map((a) => `
    <div class="list-row">
      <span><strong>${a.authorizedName}</strong> — ${a.relationship} · ${a.contact}${a.verified.length ? ` <span class="badge active">verified ${a.verified.length}×</span>` : ''}</span>
      <button class="btn btn-secondary btn-sm" data-verify="${a._id}">Verify pickup now</button>
    </div>
  `).join('') : '<div class="empty-state">No authorized pickup people registered for this student yet.</div>';

  document.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    await api.post(`/pickup/${b.dataset.verify}/verify`, {});
    renderPickupList();
  }));
}

// ---------- Emergency alerts ----------
async function loadAlerts() {
  const { alerts } = await api.get('/alerts');
  document.getElementById('alertsList').innerHTML = alerts.length ? alerts.map((a) => `
    <div class="alert-banner">
      <strong>${a.title}</strong> — ${a.message}
      <div class="field-hint">${new Date(a.createdAt).toLocaleString()} · by ${a.createdBy ? a.createdBy.name : 'staff'}</div>
    </div>
  `).join('') : '<div class="empty-state">No alerts sent.</div>';
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
