// ---------- Play-is-School -- Admin Dashboard Controller ----------
const user = requireRole('admin');
let adminCalendar = null;

function onPanelShown(panel) {
  if (panel === 'overview') loadOverview();
  if (panel === 'users') loadUsers();
  if (panel === 'students') loadStudents();
  if (panel === 'fees') loadFees();
  if (panel === 'events') loadEvents();
  if (panel === 'logs') loadLogs();
}

// ---------- Overview ----------
async function loadOverview() {
  try {
    const [students, fees, users] = await Promise.all([
      api.get('/reports/students'),
      api.get('/reports/fees'),
      api.get('/users'),
    ]);
    const pendingParents = users.users.filter((u) => u.status === 'pending').length;
    const teachersCount = users.users.filter((u) => u.role === 'teacher').length;

    document.getElementById('statRow').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <div class="stat-content"><div class="num">${students.active}</div><div class="label">Active Students</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="fa-solid fa-receipt"></i></div>
        <div class="stat-content"><div class="num">${fmtMoney(fees.outstanding)}</div><div class="label">Outstanding Fees</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="fa-solid fa-user-clock"></i></div>
        <div class="stat-content"><div class="num">${pendingParents}</div><div class="label">Pending Approvals</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="fa-solid fa-chalkboard-user"></i></div>
        <div class="stat-content"><div class="num">${teachersCount}</div><div class="label">Teaching Staff</div></div>
      </div>
    `;

    document.getElementById('feeReport').innerHTML = `
      <p style="margin-bottom:8px;">Billed: <strong>${fmtMoney(fees.totalBilled)}</strong> &nbsp;|&nbsp; Collected: <strong>${fmtMoney(fees.totalCollected)}</strong></p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <span class="badge approved"><i class="fa-solid fa-check"></i> Paid: ${fees.byStatus.paid || 0}</span>
        <span class="badge pending"><i class="fa-solid fa-clock"></i> Partial: ${fees.byStatus.partial || 0}</span>
        <span class="badge archived"><i class="fa-solid fa-circle-exclamation"></i> Unpaid: ${fees.byStatus.unpaid || 0}</span>
      </div>
    `;

    document.getElementById('classReport').innerHTML = students.byClass.length
      ? students.byClass.map((c) => `
        <div class="list-row">
          <span><i class="fa-solid fa-door-open" style="color:var(--primary); margin-right:8px;"></i>${c._id || 'Unassigned'}</span>
          <strong>${c.count} student${c.count > 1 ? 's' : ''}</strong>
        </div>
      `).join('')
      : '<p class="empty-state">No students enrolled yet.</p>';
  } catch (err) {
    console.error('Error loading overview:', err);
  }
}

// ---------- Users / Accounts ----------
async function loadUsers() {
  const roleFilter = document.getElementById('roleFilter').value;
  const { users: list } = await api.get(`/users${roleFilter ? `?role=${roleFilter}` : ''}`);
  const tbody = document.getElementById('usersTbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>No user accounts found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((u) => `
    <tr>
      <td><strong>${u.name}</strong></td>
      <td>${u.email}</td>
      <td style="text-transform:capitalize;"><span class="badge" style="background:#F1F5F9; color:var(--ink);">${u.role}</span></td>
      <td><span class="badge ${u.status}">${u.status}</span></td>
      <td>
        <div style="display:flex; gap:6px;">
          ${u.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-approve="${u.id}"><i class="fa-solid fa-check"></i> Approve</button>` : ''}
          ${u.status !== 'archived' ? `<button class="btn btn-ghost btn-sm" data-archive="${u.id}">Archive</button>` : `<button class="btn btn-ghost btn-sm" data-reactivate="${u.id}">Reactivate</button>`}
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => api.patch(`/users/${b.dataset.approve}/approve`).then(loadUsers)));
  tbody.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', () => api.patch(`/users/${b.dataset.archive}/archive`).then(loadUsers)));
  tbody.querySelectorAll('[data-reactivate]').forEach((b) => b.addEventListener('click', () => api.patch(`/users/${b.dataset.reactivate}/reactivate`).then(loadUsers)));
}
document.getElementById('roleFilter').addEventListener('change', loadUsers);

document.getElementById('addUserBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>Add Teaching Staff or Admin</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="userForm">
      <div class="field">
        <label>Account Role</label>
        <select id="uRole">
          <option value="teacher">Teacher</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <div class="field"><label>Full Name</label><input id="uName" placeholder="e.g. Sarah Jenkins" required /></div>
      <div class="field"><label>Email Address</label><input type="email" id="uEmail" placeholder="sarah@example.com" required /></div>
      <div class="field"><label>Temporary Password</label><input type="password" id="uPassword" minlength="6" placeholder="At least 6 characters" required /></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Create Account</button>
    </form>
  `);
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/users', {
        role: document.getElementById('uRole').value,
        name: document.getElementById('uName').value.trim(),
        email: document.getElementById('uEmail').value.trim(),
        password: document.getElementById('uPassword').value,
      });
      Modal.close();
      loadUsers();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Students ----------
async function loadStudents() {
  const { students } = await api.get('/students');
  const tbody = document.getElementById('studentsTbody');
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students enrolled yet. Add your first student.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = students.map((s) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.className ? `<span class="badge" style="background:#F1F5F9; color:var(--ink);">${s.className}</span>` : '<em>Unassigned</em>'}</td>
      <td>${s.parent ? s.parent.name : '<em>Unassigned</em>'}</td>
      <td>${s.teacher ? s.teacher.name : '<em>Unassigned</em>'}</td>
      <td><span class="badge ${s.status}">${s.status}</span></td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" data-edit-student="${s._id}" title="Edit Student">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          <button class="btn btn-ghost btn-sm" data-details-student="${s._id}" title="View Profile & Pickup Details">
            <i class="fa-solid fa-shield-halved"></i> Pickup &amp; Profile
          </button>
          ${s.status === 'active' ? `
            <button class="btn btn-danger btn-sm" data-archive-student="${s._id}" title="Archive Student">
              Archive
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  // Bind Edit buttons
  tbody.querySelectorAll('[data-edit-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = students.find((x) => x._id === btn.dataset.editStudent);
      if (s) openEditStudentModal(s, loadStudents);
    });
  });

  // Bind Details & Pickup buttons
  tbody.querySelectorAll('[data-details-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showStudentDetailsModal(btn.dataset.detailsStudent, { canEdit: true, onStudentUpdated: loadStudents });
    });
  });

  // Bind Archive buttons
  tbody.querySelectorAll('[data-archive-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Archive this student record?')) {
        api.patch(`/students/${btn.dataset.archiveStudent}/archive`).then(loadStudents);
      }
    });
  });
}

document.getElementById('addStudentBtn').addEventListener('click', async () => {
  const [{ users: parents }, { users: teachers }] = await Promise.all([
    api.get('/users?role=parent&status=approved'),
    api.get('/users?role=teacher'),
  ]);
  Modal.open(`
    <h3>Enroll New Student</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="studentForm">
      <div class="field"><label>Full Name</label><input id="sName" placeholder="e.g. Liam Johnson" required /></div>
      <div class="grid-2">
        <div class="field"><label>Birthdate</label><input type="date" id="sBirthdate" /></div>
        <div class="field"><label>Class / Group</label><input id="sClass" placeholder="e.g. Sunbeams" /></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Parent / Guardian</label>
          <select id="sParent"><option value="">— Select parent —</option>${parents.map((p) => `<option value="${p.id}">${p.name} (${p.email})</option>`).join('')}</select>
        </div>
        <div class="field"><label>Assigned Teacher</label>
          <select id="sTeacher"><option value="">— Select teacher —</option>${teachers.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>Notes / Dietary / Emergency</label><textarea id="sNotes" rows="2" placeholder="Optional notes…"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Save Student</button>
    </form>
  `);
  document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/students', {
        name: document.getElementById('sName').value.trim(),
        birthdate: document.getElementById('sBirthdate').value || undefined,
        className: document.getElementById('sClass').value.trim() || undefined,
        parent: document.getElementById('sParent').value || undefined,
        teacher: document.getElementById('sTeacher').value || undefined,
        notes: document.getElementById('sNotes').value.trim() || undefined,
      });
      Modal.close();
      loadStudents();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Fees ----------
async function loadFees() {
  const { fees } = await api.get('/fees');
  const tbody = document.getElementById('feesTbody');
  if (!fees.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee statements generated yet.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = fees.map((f) => `
    <tr>
      <td><strong>${f.student ? f.student.name : '—'}</strong></td>
      <td>${f.description}</td>
      <td><strong>${fmtMoney(f.amount)}</strong></td>
      <td>${fmtMoney(f.amountPaid)}</td>
      <td>${fmtDate(f.dueDate)}</td>
      <td><span class="badge ${f.status}">${f.status}</span></td>
      <td>${f.status !== 'paid' ? `<button class="btn btn-secondary btn-sm" data-pay="${f._id}"><i class="fa-solid fa-money-bill-wave"></i> Log Payment</button>` : '<span style="color:var(--primary); font-weight:700;"><i class="fa-solid fa-check"></i> Paid</span>'}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.pay)));
}

function openPaymentModal(feeId) {
  Modal.open(`
    <h3>Record Payment</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="payForm">
      <div class="field"><label>Amount Paid (₱)</label><input type="number" min="0" step="0.01" id="pAmount" required /></div>
      <div class="field"><label>Payment Method</label>
        <select id="pMethod">
          <option value="cash">Cash</option>
          <option value="bank transfer">Bank Transfer</option>
          <option value="gcash">GCash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Save Payment</button>
    </form>
  `);
  document.getElementById('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post(`/fees/${feeId}/payments`, {
        amountPaid: Number(document.getElementById('pAmount').value),
        method: document.getElementById('pMethod').value,
      });
      Modal.close();
      loadFees();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
}

document.getElementById('addFeeBtn').addEventListener('click', async () => {
  const { students } = await api.get('/students?status=active');
  Modal.open(`
    <h3>Create Fee Statement</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="feeForm">
      <div class="field"><label>Student</label>
        <select id="fStudent" required>${students.map((s) => `<option value="${s._id}">${s.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Description</label><input id="fDesc" placeholder="e.g. Tuition Fee — October" required /></div>
      <div class="grid-2">
        <div class="field"><label>Amount (₱)</label><input type="number" min="0" step="0.01" id="fAmount" required /></div>
        <div class="field"><label>Due Date</label><input type="date" id="fDue" required /></div>
      </div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Create Fee Statement</button>
    </form>
  `);
  document.getElementById('feeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/fees', {
        student: document.getElementById('fStudent').value,
        description: document.getElementById('fDesc').value.trim(),
        amount: Number(document.getElementById('fAmount').value),
        dueDate: document.getElementById('fDue').value,
      });
      Modal.close();
      loadFees();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Events Calendar ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  if (!adminCalendar) {
    adminCalendar = new EventsCalendar({
      containerId: 'eventsCalendarContainer',
      events,
      canManage: true,
      onDeleteEvent: async (eventId) => {
        await api.del(`/events/${eventId}`);
        loadEvents();
      },
    });
  } else {
    adminCalendar.setEvents(events);
  }
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>Schedule School Event</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="eventForm">
      <div class="field"><label>Event Title</label><input id="eTitle" placeholder="e.g. Annual Sports Day" required /></div>
      <div class="grid-2">
        <div class="field"><label>Event Date</label><input type="date" id="eDate" required /></div>
        <div class="field"><label>Target Audience</label>
          <select id="eAudience">
            <option value="all">Everyone (Parents &amp; Staff)</option>
            <option value="parents">Parents only</option>
            <option value="teachers">Teachers only</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Description / Details</label><textarea id="eDesc" rows="3" placeholder="Provide schedule, attire, or instructions…"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Publish Event</button>
    </form>
  `);
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/events', {
        title: document.getElementById('eTitle').value.trim(),
        date: document.getElementById('eDate').value,
        audience: document.getElementById('eAudience').value,
        description: document.getElementById('eDesc').value.trim(),
      });
      Modal.close();
      loadEvents();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
});

// ---------- Activity Logs ----------
async function loadLogs() {
  const { logs } = await api.get('/logs');
  const tbody = document.getElementById('logsTbody');
  tbody.innerHTML = logs.length ? logs.map((l) => `
    <tr>
      <td style="white-space:nowrap; font-size:13px;"><i class="fa-regular fa-clock" style="color:var(--primary); margin-right:6px;"></i>${new Date(l.createdAt).toLocaleString()}</td>
      <td><strong>${l.user ? `${l.user.name}` : 'System'}</strong> ${l.user ? `<span class="badge" style="background:#F1F5F9; color:var(--ink);">${l.user.role}</span>` : ''}</td>
      <td><code>${l.action}</code></td>
      <td>${l.details || '—'}</td>
    </tr>
  `).join('') : `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>No activity recorded yet.</p></div></td></tr>`;
}

loadOverview();
