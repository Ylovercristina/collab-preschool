// ---------- Play-is-School -- Teacher Dashboard Controller ----------
const user = requireRole('teacher');
let myStudents = [];
let activeThreadUserId = null;
let teacherCalendar = null;

function escapeTeacherHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function relatedUserId(value) {
  return value ? String(value._id || value.id || value) : '';
}

function localDateValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function onPanelShown(panel) {
  if (panel === 'overview') return loadOverview();
  if (panel === 'enrollment') return loadTeacherEnrollment();
  if (panel === 'students') return loadStudentsPanel();
  if (panel === 'fees') return loadFeeStatuses();
  if (panel === 'attendance') return loadAttendance();
  if (panel === 'progress') return loadProgressPanel();
  if (panel === 'messages') return loadInbox();
  if (panel === 'events') return loadEvents();
  if (panel === 'pickup') return loadPickupPanel();
  if (panel === 'alerts') return loadAlerts();
}

async function loadMyStudents() {
  const { students } = await api.get('/students');
  myStudents = students || [];
  return myStudents;
}

// ---------- Overview ----------
async function loadOverview() {
  await loadMyStudents();
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-user-graduate"></i></div>
      <div class="stat-content"><div class="num">${myStudents.length}</div><div class="label">Assigned Students</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
      <div class="stat-content"><div class="num">${myStudents.filter((student) => student.status === 'active').length}</div><div class="label">Active Students</div></div>
    </div>
  `;
  const { roster } = await api.get(`/attendance/class?date=${localDateValue()}`);
  document.getElementById('todayRoster').innerHTML = roster.length ? `
    <div class="table-responsive">
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Today's Status</th></tr></thead>
        <tbody>
          ${roster.map((r) => `
            <tr>
              <td><strong>${r.student.name}</strong></td>
              <td>${r.student.className || '—'}</td>
              <td>${r.attendance ? `<span class="badge ${escapeTeacherHtml(r.attendance.status)}">${['late', 'tardy'].includes(r.attendance.status) ? 'Tardy' : escapeTeacherHtml(r.attendance.status)}</span>` : '<span style="color:var(--ink-muted); font-style:italic;">Not marked yet</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty-state"><i class="fa-solid fa-clipboard-question"></i><p>No students assigned to your class roster yet.</p></div>';
}

// ---------- Students Panel (Edit Student Information & Pickup) ----------
async function loadStudentsPanel() {
  await loadMyStudents();
  const displayList = myStudents;

  const tbody = document.getElementById('teacherStudentsTbody');
  if (!displayList.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map((s) => {
    const bdate = s.birthdate ? new Date(s.birthdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    return `
      <tr>
        <td><strong>${escapeTeacherHtml(s.name)}</strong></td>
        <td><span class="badge" style="background:#F1F5F9; color:var(--ink);">${escapeTeacherHtml(s.className || 'Unassigned')}</span></td>
        <td>${s.parent ? escapeTeacherHtml(s.parent.name) : '<em>Unassigned</em>'}</td>
        <td>${bdate}</td>
        <td><span class="badge ${escapeTeacherHtml(s.status)}">${escapeTeacherHtml(s.status)}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-student="${escapeTeacherHtml(s._id)}" title="Edit Student Information">
              <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-details-student="${escapeTeacherHtml(s._id)}" title="View Details & Authorized Pickup">
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
      if (s) openEditStudentModal(s, loadStudentsPanel, { teacherMode: true });
    });
  });

  // Bind Details & Pickup buttons
  tbody.querySelectorAll('[data-details-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showStudentDetailsModal(btn.dataset.detailsStudent, {
        canEdit: true,
        onStudentUpdated: loadStudentsPanel,
        teacherMode: true,
      });
    });
  });
}

async function loadFeeStatuses() {
  const { fees } = await api.get('/fees/teacher');
  const tbody = document.getElementById('teacherFeesTbody');
  if (!fees.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee records for your assigned students.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = fees.map((fee) => {
    const totalPaid = Number(Number(fee.amountPaid || 0).toFixed(2));
    const remaining = Math.max(0, Number((Number(fee.amount) - totalPaid).toFixed(2)));
    const status = totalPaid <= 0 ? 'unpaid' : (remaining === 0 ? 'paid' : 'partial');
    const statusLabel = { unpaid: 'Unpaid', partial: 'Partial Payment', paid: 'Paid' }[status];
    return `
      <tr>
        <td><strong>${fee.student ? fee.student.name : '—'}</strong></td>
        <td>${fee.student ? fee.student.className || '—' : '—'}</td>
        <td>${fee.description}</td>
        <td>${fmtMoney(fee.amount)}</td>
        <td>${fmtMoney(totalPaid)}</td>
        <td>${fmtMoney(remaining)}</td>
        <td>${fmtDate(fee.dueDate)}</td>
        <td><span class="badge ${status}">${statusLabel}</span></td>
      </tr>
    `;
  }).join('');
}

// ---------- Attendance ----------
const attDateInput = document.getElementById('attDate');
attDateInput.value = localDateValue();
attDateInput.addEventListener('change', loadAttendance);

async function loadAttendance() {
  const date = attDateInput.value || new Date().toISOString().slice(0, 10);
  const tbody = document.getElementById('attTbody');
  const message = document.getElementById('attendanceMessage');
  message.textContent = '';
  try {
    const { roster } = await api.get(`/attendance/class?date=${encodeURIComponent(date)}`);
    if (!roster.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-clipboard-user"></i><p>No students assigned to you.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = roster.map((r) => `
      <tr data-student="${escapeTeacherHtml(r.student.id)}">
        <td><strong>${escapeTeacherHtml(r.student.name)}</strong></td>
        <td>${escapeTeacherHtml(r.student.className || '—')}</td>
        <td>
          <select class="statusSelect" aria-label="Attendance status for ${escapeTeacherHtml(r.student.name)}" style="padding:6px 10px; border-radius:6px; border:1px solid #CBD5E1;">
            ${[['present', 'Present'], ['absent', 'Absent'], ['tardy', 'Tardy'], ['excused', 'Excused']].map(([value, label]) => `<option value="${value}" ${r.attendance && (r.attendance.status === value || (value === 'tardy' && r.attendance.status === 'late')) ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </td>
        <td><input class="remarksInput" maxlength="500" value="${escapeTeacherHtml(r.attendance ? (r.attendance.remarks || '') : '')}" aria-label="Attendance remarks for ${escapeTeacherHtml(r.student.name)}" placeholder="Optional remarks" style="padding:6px 10px; border-radius:6px; border:1px solid #CBD5E1; width:100%; max-width:240px;" /></td>
        <td><div style="display:flex;align-items:center;gap:8px;"><button type="button" class="btn btn-secondary btn-sm" data-save-attendance>Save</button><span data-attendance-state aria-live="polite">${r.attendance ? 'Saved' : 'Not recorded'}</span></div></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach((row) => {
      const saveButton = row.querySelector('[data-save-attendance]');
      const state = row.querySelector('[data-attendance-state]');
      const markUnsaved = () => { state.textContent = 'Unsaved changes'; };
      row.querySelector('.statusSelect').addEventListener('change', markUnsaved);
      row.querySelector('.remarksInput').addEventListener('input', markUnsaved);
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        state.textContent = 'Saving…';
        document.getElementById('attendanceMessage').textContent = '';
        try {
          await api.post('/attendance', {
            student: row.dataset.student,
            date,
            status: row.querySelector('.statusSelect').value,
            remarks: row.querySelector('.remarksInput').value.trim(),
          });
          state.textContent = 'Saved';
        } catch (err) {
          state.textContent = 'Not saved';
          showMsg(document.getElementById('attendanceMessage'), err.message);
        } finally {
          saveButton.disabled = false;
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Attendance roster could not be loaded.</p></div></td></tr>';
    showMsg(message, err.message);
  }
}

// ---------- Academic Progress ----------
let editingProgressId = '';

function escapeProgressText(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function resetProgressEdit() {
  editingProgressId = '';
  const form = document.getElementById('progressForm');
  form.reset();
  document.getElementById('pDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('progressFormTitle').innerHTML = '<i class="fa-solid fa-plus-circle" style="color:var(--primary); margin-right:6px;"></i>Log Milestone or Activity';
  document.getElementById('progressSaveButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Entry';
  document.getElementById('progressCancelEdit').hidden = true;
}

function editProgressEntry(entry) {
  editingProgressId = entry._id;
  document.getElementById('pDate').value = entry.date ? new Date(entry.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('pLearningArea').value = entry.learningArea || '';
  document.getElementById('pMilestone').value = entry.milestone || '';
  document.getElementById('pActivity').value = entry.activity || '';
  document.getElementById('pAssessment').value = entry.assessment || '';
  document.getElementById('pEvaluation').value = entry.evaluation || '';
  document.getElementById('pStrengths').value = entry.strengths || '';
  document.getElementById('pAreasForImprovement').value = entry.areasForImprovement || '';
  document.getElementById('pOverallDevelopment').value = entry.overallDevelopment || '';
  document.getElementById('pNotes').value = entry.notes || '';
  document.getElementById('progressFormTitle').textContent = 'Update Progress Entry';
  document.getElementById('progressSaveButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Entry';
  document.getElementById('progressCancelEdit').hidden = false;
  document.getElementById('progressForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadProgressPanel() {
  if (!document.getElementById('pDate').value) document.getElementById('pDate').value = new Date().toISOString().slice(0, 10);
  await loadMyStudents();
  const sel = document.getElementById('progStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${escapeTeacherHtml(s._id)}">${escapeTeacherHtml(s.name)}</option>`).join('');
  sel.onchange = renderProgressList;
  if (myStudents.length) renderProgressList();
  else document.getElementById('progressList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No students are assigned to you.</p></div>';
}

async function renderProgressList() {
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const { progress } = await api.get(`/progress/student/${sid}`);
  const list = document.getElementById('progressList');
  list.innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:var(--primary); font-weight:700;"><i class="fa-regular fa-calendar"></i> ${fmtDate(p.date)}${p.learningArea ? ` &middot; ${escapeProgressText(p.learningArea)}` : ''}</span>
        ${String(p.teacher?._id || p.teacher) === String(user.id) ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-progress="${escapeProgressText(p._id)}"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}
      </div>
      ${p.milestone ? `<p style="margin-bottom:4px;"><strong>Milestone:</strong> ${escapeProgressText(p.milestone)}</p>` : ''}
      ${p.activity ? `<p style="margin-bottom:4px;"><strong>Activity:</strong> ${escapeProgressText(p.activity)}</p>` : ''}
      ${p.assessment ? `<p style="margin-bottom:4px;"><strong>Assessment:</strong> ${escapeProgressText(p.assessment)}</p>` : ''}
      ${p.evaluation ? `<p style="margin-bottom:4px;"><strong>Teacher evaluation:</strong> ${escapeProgressText(p.evaluation)}</p>` : ''}
      ${p.strengths ? `<p style="margin-bottom:4px;"><strong>Strengths:</strong> ${escapeProgressText(p.strengths)}</p>` : ''}
      ${p.areasForImprovement ? `<p style="margin-bottom:4px;"><strong>Areas for improvement:</strong> ${escapeProgressText(p.areasForImprovement)}</p>` : ''}
      ${p.overallDevelopment ? `<p style="margin-bottom:4px;"><strong>Overall development:</strong> ${escapeProgressText(p.overallDevelopment)}</p>` : ''}
      ${p.notes ? `<p style="margin:0; color:var(--ink-soft); font-style:italic;">Notes: ${escapeProgressText(p.notes)}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No progress entries logged yet for this student.</p></div>';
  list.querySelectorAll('[data-edit-progress]').forEach((button) => {
    const entry = progress.find((item) => item._id === button.dataset.editProgress);
    if (entry) button.addEventListener('click', () => editProgressEntry(entry));
  });
}

document.getElementById('progressForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const message = document.getElementById('progressFormMessage');
  message.textContent = '';
  try {
    const values = {
      student: sid,
      date: document.getElementById('pDate').value,
      milestone: document.getElementById('pMilestone').value.trim(),
      activity: document.getElementById('pActivity').value.trim(),
      assessment: document.getElementById('pAssessment').value.trim(),
      learningArea: document.getElementById('pLearningArea').value,
      evaluation: document.getElementById('pEvaluation').value.trim(),
      strengths: document.getElementById('pStrengths').value.trim(),
      areasForImprovement: document.getElementById('pAreasForImprovement').value.trim(),
      overallDevelopment: document.getElementById('pOverallDevelopment').value.trim(),
      notes: document.getElementById('pNotes').value.trim(),
    };
    if (editingProgressId) {
      delete values.student;
      await api.patch(`/progress/${editingProgressId}`, values);
    } else {
      await api.post('/progress', values);
    }
    resetProgressEdit();
    message.textContent = '';
    await renderProgressList();
  } catch (err) {
    showMsg(message, err.message);
  }
});

document.getElementById('progressCancelEdit').addEventListener('click', () => {
  resetProgressEdit();
  document.getElementById('progressFormMessage').textContent = '';
});

// ---------- Messages ----------
async function loadInbox() {
  await loadMyStudents();
  const { threads } = await api.get('/messages/inbox');
  const parentsFromStudents = new Map();
  myStudents.forEach((student) => {
    if (student.status === 'active' && student.parent) parentsFromStudents.set(relatedUserId(student.parent), student.parent);
  });

  const box = document.getElementById('inboxList');
  const known = new Map(threads
    .filter((thread) => thread.with.role === 'parent' && parentsFromStudents.has(String(thread.with.id)))
    .map((thread) => [String(thread.with.id), thread]));
  parentsFromStudents.forEach((p, id) => {
    if (!known.has(id)) known.set(id, { with: { id, name: p.name, role: 'parent' }, unread: 0 });
  });

  const items = Array.from(known.values());
  box.innerHTML = items.length ? items.map((t) => `
    <button type="button" class="list-row" style="cursor:pointer;width:100%;text-align:left;border:0;font:inherit;" data-open="${escapeTeacherHtml(t.with.id)}" data-name="${escapeTeacherHtml(t.with.name)}">
      <span><i class="fa-solid fa-user" style="color:var(--primary); margin-right:8px;"></i>${escapeTeacherHtml(t.with.name)}${t.unread ? ` <span class="badge pending">${t.unread} new</span>` : ''}</span>
      <i class="fa-solid fa-chevron-right" style="color:var(--ink-light); font-size:12px;"></i>
    </button>
  `).join('') : '<div class="empty-state"><p>No parents to message yet.</p></div>';

  box.querySelectorAll('[data-open]').forEach((row) => row.addEventListener('click', async () => {
    try {
      await openThread(row.dataset.open, row.dataset.name);
    } catch (err) {
      showMsg(document.getElementById('messageFormMessage'), err.message);
    }
  }));
}

async function openThread(userId, name) {
  const parentStudents = myStudents.filter((student) => student.status === 'active'
    && relatedUserId(student.parent) === String(userId));
  activeThreadUserId = userId;
  document.getElementById('threadWithName').textContent = name;
  const studentSelect = document.getElementById('messageStudentSelect');
  const previousStudentId = studentSelect.value;
  studentSelect.innerHTML = parentStudents.map((student) => (
    `<option value="${escapeTeacherHtml(student._id)}">${escapeTeacherHtml(student.name)}${student.className ? ` — ${escapeTeacherHtml(student.className)}` : ''}</option>`
  )).join('');
  if (parentStudents.some((student) => student._id === previousStudentId)) {
    studentSelect.value = previousStudentId;
  }
  studentSelect.disabled = !parentStudents.length;
  document.getElementById('chatInput').disabled = !parentStudents.length;
  document.getElementById('sendChatBtn').disabled = !parentStudents.length;
  document.getElementById('messageFormMessage').textContent = '';
  const { messages } = await api.get(`/messages/thread/${userId}`);
  const thread = document.getElementById('chatThread');
  thread.innerHTML = messages.map((message) => {
    const senderId = relatedUserId(message.sender);
    const content = escapeTeacherHtml(message.content).replace(/\r?\n/g, '<br>');
    return `<div class="chat-bubble ${senderId === String(userId) ? 'theirs' : 'mine'}">${content}</div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById('teacherMessageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const studentId = document.getElementById('messageStudentSelect').value;
  if (!activeThreadUserId || !studentId || !input.value.trim()) return;
  const sendButton = document.getElementById('sendChatBtn');
  sendButton.disabled = true;
  document.getElementById('messageFormMessage').textContent = '';
  try {
    await api.post('/messages', {
      receiver: activeThreadUserId,
      student: studentId,
      content: input.value.trim(),
    });
    input.value = '';
    await openThread(activeThreadUserId, document.getElementById('threadWithName').textContent);
    await loadInbox();
  } catch (err) {
    showMsg(document.getElementById('messageFormMessage'), err.message);
  } finally {
    sendButton.disabled = false;
  }
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
        await loadEvents();
      },
      onEventUpdated: async (eventId, updates) => {
        await api.patch(`/events/${eventId}`, updates);
        await loadEvents();
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
      await loadEvents();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Pickup Verification Panel ----------
async function loadPickupPanel() {
  await loadMyStudents();
  const sel = document.getElementById('pickupStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${escapeTeacherHtml(s._id)}">${escapeTeacherHtml(s.name)}</option>`).join('');
  sel.disabled = !myStudents.length;
  sel.onchange = renderPickupList;
  if (myStudents.length) renderPickupList();
  else document.getElementById('pickupList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students are assigned to you.</p></div>';
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
