// ---------- Play-is-School -- Admin Dashboard Controller ----------
const user = requireRole('admin');
let adminCalendar = null;

function onPanelShown(panel) {
  if (panel === 'overview') return loadOverview();
  if (panel === 'users') return loadUsers();
  if (panel === 'students') return loadStudents();
  if (panel === 'fees') return loadFees();
  if (panel === 'events') return loadEvents();
  if (panel === 'logs') return loadLogs();
}

function initOverviewNavigation() {
  const overview = document.getElementById('panel-overview');
  if (!overview) return;

  const navigateFrom = (target) => {
    const navItem = document.querySelector(`.nav-item[data-panel="${target.dataset.overviewPanel}"]`);
    if (navItem) navItem.click();
  };

  overview.addEventListener('click', (event) => {
    const target = event.target.closest('[data-overview-panel]');
    if (target) navigateFrom(target);
  });
  overview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-overview-panel]');
    if (!target) return;
    event.preventDefault();
    navigateFrom(target);
  });
}

initOverviewNavigation();

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
      <div class="stat-card overview-clickable" data-overview-panel="students" role="button" tabindex="0" aria-label="View ${students.active} active students">
        <div class="stat-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <div class="stat-content"><div class="num">${students.active}</div><div class="label">Active Students</div></div>
      </div>
      <div class="stat-card overview-clickable" data-overview-panel="fees" role="button" tabindex="0" aria-label="View outstanding fees">
        <div class="stat-icon"><i class="fa-solid fa-receipt"></i></div>
        <div class="stat-content"><div class="num">${fmtMoney(fees.outstanding)}</div><div class="label">Outstanding Fees</div></div>
      </div>
      <div class="stat-card overview-clickable" data-overview-panel="users" role="button" tabindex="0" aria-label="View ${pendingParents} pending account approvals">
        <div class="stat-icon"><i class="fa-solid fa-user-clock"></i></div>
        <div class="stat-content"><div class="num">${pendingParents}</div><div class="label">Pending Approvals</div></div>
      </div>
      <div class="stat-card overview-clickable" data-overview-panel="users" role="button" tabindex="0" aria-label="View ${teachersCount} teaching staff accounts">
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
        <div class="list-row overview-clickable" data-overview-panel="students" role="button" tabindex="0" aria-label="View ${c.count} students in ${c._id || 'Unassigned'}">
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
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee statements generated yet.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = fees.map((f) => {
    const totalPaid = Number((f.payments || [])
      .filter((payment) => payment.receiptState !== 'voided')
      .reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0)
      .toFixed(2));
    const remainingBalance = Math.max(0, Number((Number(f.amount) - totalPaid).toFixed(2)));
    const status = totalPaid <= 0 ? 'unpaid' : (remainingBalance === 0 ? 'paid' : 'partial');
    const statusLabel = { unpaid: 'Unpaid', partial: 'Partial Payment', paid: 'Paid' }[status];
    return `
      <tr>
        <td><strong>${f.student ? f.student.name : '—'}</strong></td>
        <td>${f.description}${renderAdminPaymentHistory(f)}</td>
        <td><strong>${fmtMoney(f.amount)}</strong></td>
        <td>${fmtMoney(totalPaid)}</td>
        <td>${fmtMoney(remainingBalance)}</td>
        <td>${fmtDate(f.dueDate)}</td>
        <td><span class="badge ${status}">${statusLabel}</span></td>
        <td>${status !== 'paid' ? `<button class="btn btn-secondary btn-sm" data-pay="${f._id}" data-remaining="${remainingBalance}" data-total-fee="${f.amount}"><i class="fa-solid fa-money-bill-wave"></i> Record Cash</button>` : '<span style="color:var(--primary); font-weight:700;"><i class="fa-solid fa-check"></i> Paid</span>'}</td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.pay, Number(b.dataset.remaining), Number(b.dataset.totalFee))));
  tbody.querySelectorAll('[data-view-receipt]').forEach((b) => {
    b.addEventListener('click', () => showPaymentReceipt(b.dataset.feeId, b.dataset.viewReceipt));
  });
  tbody.querySelectorAll('[data-edit-payment]').forEach((b) => {
    b.addEventListener('click', () => {
      const fee = fees.find((item) => item._id === b.dataset.feeId);
      const payment = fee && fee.payments.find((item) => item._id === b.dataset.editPayment);
      if (!fee || !payment) return;
      const totalPaid = fee.payments
        .filter((item) => item.receiptState !== 'voided')
        .reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
      openEditPaymentModal(fee, payment, Number(totalPaid.toFixed(2)));
    });
  });
  tbody.querySelectorAll('[data-delete-payment]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Void this recorded payment? The receipt will be marked voided and the fee balance and parent notification will be updated.')) return;
      try {
        await api.del(`/fees/${b.dataset.feeId}/payments/${b.dataset.deletePayment}`);
        await loadFees();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderAdminPaymentHistory(fee) {
  if (!fee.payments || !fee.payments.length) return '';
  return `
    <details style="margin-top:4px; font-size:12.5px;">
      <summary style="cursor:pointer; color:var(--primary); font-weight:600;">Payment history (${fee.payments.length})</summary>
      <div style="margin-top:6px;">
        ${fee.payments.map((payment) => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:4px 0;">
            <span>${fmtMoney(payment.amountPaid)} - ${fmtDate(payment.datePaid)} - Cash - Receipt ${payment.receiptNumber || 'pending'} - Remaining after payment: ${fmtMoney(payment.receiptSnapshot?.remainingBalance ?? 0)}${payment.remarks ? ` - ${payment.remarks}` : ''} - Recorded by ${payment.loggedBy?.name || 'Admin'}${payment.receiptState !== 'issued' ? ` - ${payment.receiptState}` : ''}</span>
            <span style="display:flex; gap:4px;">
              <button class="btn btn-ghost btn-sm" data-view-receipt="${payment._id}" data-fee-id="${fee._id}" title="View receipt">View Receipt</button>
              ${payment.receiptState === 'voided' ? '' : `
                <button class="btn btn-ghost btn-sm" data-edit-payment="${payment._id}" data-fee-id="${fee._id}" title="Edit payment"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-ghost btn-sm" data-delete-payment="${payment._id}" data-fee-id="${fee._id}" title="Void payment"><i class="fa-solid fa-trash-can"></i></button>
              `}
            </span>
          </div>
        `).join('')}
      </div>
    </details>
  `;
}

function openPaymentModal(feeId, remainingBalance, totalFee) {
  const currentDate = new Date();
  const today = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
  Modal.open(`
    <h3>Record Payment</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="payForm">
      <div class="field"><label>Amount Paid (₱)</label><input type="number" min="0.01" max="${remainingBalance.toFixed(2)}" step="0.01" id="pAmount" required /></div>
      <div class="field"><label>Date Received</label><input type="date" id="pDate" value="${today}" required /></div>
      <div class="field"><label>Payment Method</label><p style="margin:0;">Cash</p></div>
      <div class="field"><label>Remarks</label><textarea id="pRemarks" rows="2"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Save Payment</button>
    </form>
  `);
  document.getElementById('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    const amountValue = document.getElementById('pAmount').value;
    const amountPaid = Number(amountValue);
    if (!amountValue || !Number.isFinite(amountPaid) || amountPaid <= 0) {
      showMsg(msg, 'Enter a valid payment amount greater than zero.');
      return;
    }
    if (amountPaid > remainingBalance) {
      showMsg(msg, `Payment exceeds the remaining balance of ${fmtMoney(remainingBalance)}. Total paid cannot exceed the total fee of ${fmtMoney(totalFee)}.`);
      return;
    }
    try {
      await api.post(`/fees/${feeId}/payments`, {
        amountPaid,
        datePaid: document.getElementById('pDate').value,
        remarks: document.getElementById('pRemarks').value.trim(),
      });
      await loadFees();
      Modal.close();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
}

function openEditPaymentModal(fee, payment, totalPaid) {
  const remainingBalance = Math.max(0, Number((fee.amount - (totalPaid - payment.amountPaid)).toFixed(2)));
  const dateReceived = new Date(payment.datePaid).toISOString().slice(0, 10);
  Modal.open(`
    <h3>Edit Cash Payment</h3>
    <div id="editPaymentMsg" class="form-msg"></div>
    <form id="editPaymentForm">
      <div class="field"><label>Amount Paid (₱)</label><input type="number" min="0.01" max="${remainingBalance.toFixed(2)}" step="0.01" id="editPaymentAmount" value="${payment.amountPaid}" required /></div>
      <div class="field"><label>Date Received</label><input type="date" id="editPaymentDate" value="${dateReceived}" required /></div>
      <div class="field"><label>Payment Method</label><p style="margin:0;">Cash</p></div>
      <div class="field"><label>Remarks</label><textarea id="editPaymentRemarks" rows="2">${payment.remarks || ''}</textarea></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Save Changes</button>
    </form>
  `);
  document.getElementById('editPaymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('editPaymentMsg');
    const amountValue = document.getElementById('editPaymentAmount').value;
    const amountPaid = Number(amountValue);
    if (!amountValue || !Number.isFinite(amountPaid) || amountPaid <= 0) {
      showMsg(msg, 'Enter a valid payment amount greater than zero.');
      return;
    }
    if (amountPaid > remainingBalance) {
      showMsg(msg, `Payment exceeds the remaining balance of ${fmtMoney(remainingBalance)}.`);
      return;
    }
    try {
      await api.patch(`/fees/${fee._id}/payments/${payment._id}`, {
        amountPaid,
        datePaid: document.getElementById('editPaymentDate').value,
        remarks: document.getElementById('editPaymentRemarks').value.trim(),
      });
      await loadFees();
      Modal.close();
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
      await loadFees();
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
        await loadEvents();
      },
      onEventUpdated: async (eventId, updates) => {
        await api.patch(`/events/${eventId}`, updates);
        await loadEvents();
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
      await loadEvents();
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
