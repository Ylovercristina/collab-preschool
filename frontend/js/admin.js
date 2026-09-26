const user = requireRole('admin');

function onPanelShown(panel) {
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

    document.getElementById('statRow').innerHTML = `
      <div class="stat-card"><div class="num">${students.active}</div><div class="label">Active students</div></div>
      <div class="stat-card"><div class="num">${fmtMoney(fees.outstanding)}</div><div class="label">Outstanding fees</div></div>
      <div class="stat-card"><div class="num">${pendingParents}</div><div class="label">Pending approvals</div></div>
      <div class="stat-card"><div class="num">${users.users.filter(u=>u.role==='teacher').length}</div><div class="label">Teachers</div></div>
    `;

    document.getElementById('feeReport').innerHTML = `
      <p>Billed: <strong>${fmtMoney(fees.totalBilled)}</strong> · Collected: <strong>${fmtMoney(fees.totalCollected)}</strong></p>
      <p>Paid: ${fees.byStatus.paid || 0} · Partial: ${fees.byStatus.partial || 0} · Unpaid: ${fees.byStatus.unpaid || 0}</p>
    `;
    document.getElementById('classReport').innerHTML = students.byClass.length
      ? students.byClass.map((c) => `<div class="list-row"><span>${c._id || 'Unassigned'}</span><strong>${c.count}</strong></div>`).join('')
      : '<p class="empty-state">No students yet.</p>';
  } catch (err) {
    console.error(err);
  }
}

// ---------- Users / Accounts ----------
async function loadUsers() {
  const roleFilter = document.getElementById('roleFilter').value;
  const { users: list } = await api.get(`/users${roleFilter ? `?role=${roleFilter}` : ''}`);
  const tbody = document.getElementById('usersTbody');
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No accounts found.</div></td></tr>`; return; }

  tbody.innerHTML = list.map((u) => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td style="text-transform:capitalize;">${u.role}</td>
      <td><span class="badge ${u.status}">${u.status}</span></td>
      <td>
        ${u.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-approve="${u.id}">Approve</button>` : ''}
        ${u.status !== 'archived' ? `<button class="btn btn-ghost btn-sm" data-archive="${u.id}">Archive</button>` : `<button class="btn btn-ghost btn-sm" data-reactivate="${u.id}">Reactivate</button>`}
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
    <h3>Add teacher or admin</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="userForm">
      <div class="field"><label>Role</label>
        <select id="uRole"><option value="teacher">Teacher</option><option value="admin">Admin</option></select>
      </div>
      <div class="field"><label>Full name</label><input id="uName" required /></div>
      <div class="field"><label>Email</label><input type="email" id="uEmail" required /></div>
      <div class="field"><label>Temporary password</label><input type="password" id="uPassword" minlength="6" required /></div>
      <button class="btn btn-primary btn-block" type="submit">Create account</button>
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
    } catch (err) { showMsg(msg, err.message); }
  });
});

// ---------- Students ----------
async function loadStudents() {
  const { students } = await api.get('/students');
  const tbody = document.getElementById('studentsTbody');
  if (!students.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No students yet. Add your first one.</div></td></tr>`; return; }

  tbody.innerHTML = students.map((s) => `
    <tr>
      <td>${s.name}</td>
      <td>${s.className || '—'}</td>
      <td>${s.parent ? s.parent.name : '<em>unassigned</em>'}</td>
      <td>${s.teacher ? s.teacher.name : '<em>unassigned</em>'}</td>
      <td><span class="badge ${s.status}">${s.status}</span></td>
      <td>${s.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-archive="${s._id}">Archive</button>` : ''}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', () => api.patch(`/students/${b.dataset.archive}/archive`).then(loadStudents)));
}

document.getElementById('addStudentBtn').addEventListener('click', async () => {
  const [{ users: parents }, { users: teachers }] = await Promise.all([
    api.get('/users?role=parent&status=approved'),
    api.get('/users?role=teacher'),
  ]);
  Modal.open(`
    <h3>Add student</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="studentForm">
      <div class="field"><label>Full name</label><input id="sName" required /></div>
      <div class="field"><label>Birthdate</label><input type="date" id="sBirthdate" /></div>
      <div class="field"><label>Class</label><input id="sClass" placeholder="e.g. Sunbeams" /></div>
      <div class="field"><label>Parent</label>
        <select id="sParent"><option value="">— none yet —</option>${parents.map((p) => `<option value="${p.id}">${p.name} (${p.email})</option>`).join('')}</select>
      </div>
      <div class="field"><label>Teacher</label>
        <select id="sTeacher"><option value="">— none yet —</option>${teachers.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Add student</button>
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
      });
      Modal.close();
      loadStudents();
    } catch (err) { showMsg(msg, err.message); }
  });
});

// ---------- Fees ----------
async function loadFees() {
  const { fees } = await api.get('/fees');
  const tbody = document.getElementById('feesTbody');
  if (!fees.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No fee records yet.</div></td></tr>`; return; }

  tbody.innerHTML = fees.map((f) => `
    <tr>
      <td>${f.student ? f.student.name : '—'}</td>
      <td>${f.description}</td>
      <td>${fmtMoney(f.amount)}</td>
      <td>${fmtMoney(f.amountPaid)}</td>
      <td>${fmtDate(f.dueDate)}</td>
      <td><span class="badge ${f.status}">${f.status}</span></td>
      <td>${f.status !== 'paid' ? `<button class="btn btn-secondary btn-sm" data-pay="${f._id}">Log payment</button>` : '—'}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.pay)));
}

function openPaymentModal(feeId) {
  Modal.open(`
    <h3>Log a payment</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="payForm">
      <div class="field"><label>Amount paid</label><input type="number" min="0" step="0.01" id="pAmount" required /></div>
      <div class="field"><label>Method</label>
        <select id="pMethod"><option value="cash">Cash</option><option value="bank transfer">Bank transfer</option><option value="gcash">GCash</option><option value="other">Other</option></select>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Save payment</button>
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
    } catch (err) { showMsg(msg, err.message); }
  });
}

document.getElementById('addFeeBtn').addEventListener('click', async () => {
  const { students } = await api.get('/students?status=active');
  Modal.open(`
    <h3>New fee</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="feeForm">
      <div class="field"><label>Student</label>
        <select id="fStudent" required>${students.map((s) => `<option value="${s._id}">${s.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Description</label><input id="fDesc" placeholder="e.g. Tuition — October" required /></div>
      <div class="field"><label>Amount</label><input type="number" min="0" step="0.01" id="fAmount" required /></div>
      <div class="field"><label>Due date</label><input type="date" id="fDue" required /></div>
      <button class="btn btn-primary btn-block" type="submit">Create fee</button>
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
    } catch (err) { showMsg(msg, err.message); }
  });
});

// ---------- Events ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  const box = document.getElementById('eventsList');
  box.innerHTML = events.length ? events.map((ev) => `
    <div class="card" style="margin-bottom:14px;">
      <div class="toolbar" style="margin-bottom:6px;">
        <h3 style="margin:0;">${ev.title}</h3>
        <button class="btn btn-ghost btn-sm" data-del="${ev._id}">Remove</button>
      </div>
      <p style="margin-bottom:4px;">${fmtDate(ev.date)} · audience: ${ev.audience}</p>
      <p style="margin:0;">${ev.description || ''}</p>
    </div>
  `).join('') : '<div class="empty-state">No events scheduled yet.</div>';
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => api.del(`/events/${b.dataset.del}`).then(loadEvents)));
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>New event</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="eventForm">
      <div class="field"><label>Title</label><input id="eTitle" required /></div>
      <div class="field"><label>Date</label><input type="date" id="eDate" required /></div>
      <div class="field"><label>Audience</label>
        <select id="eAudience"><option value="all">Everyone</option><option value="parents">Parents only</option><option value="teachers">Teachers only</option></select>
      </div>
      <div class="field"><label>Description</label><textarea id="eDesc" rows="3"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Create event</button>
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
    } catch (err) { showMsg(msg, err.message); }
  });
});

// ---------- Logs ----------
async function loadLogs() {
  const { logs } = await api.get('/logs');
  const tbody = document.getElementById('logsTbody');
  tbody.innerHTML = logs.length ? logs.map((l) => `
    <tr>
      <td>${new Date(l.createdAt).toLocaleString()}</td>
      <td>${l.user ? `${l.user.name} (${l.user.role})` : 'system'}</td>
      <td>${l.action}</td>
      <td>${l.details || ''}</td>
    </tr>
  `).join('') : `<tr><td colspan="4"><div class="empty-state">No activity yet.</div></td></tr>`;
}

loadOverview();
