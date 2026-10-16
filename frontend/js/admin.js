// ---------- Play-is-School -- Admin Dashboard Controller ----------
const user = requireRole('admin');
let adminCalendar = null;

function onPanelShown(panel) {
  if (panel === 'overview') return loadOverview();
  if (panel === 'users') return loadUsers();
  if (panel === 'students') return loadStudents();
  if (panel === 'enrollment') return loadAdminEnrollment();
  if (panel === 'academic-progress') return window.loadAcademicProgress();
  if (panel === 'records') return window.loadManagedRecords();
  if (panel === 'fees') return loadFees();
  if (panel === 'events') return loadEvents();
  if (panel === 'alerts') return loadAdminAlerts();
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
let cachedUsers = [];
let activeAccountRole = 'teacher';
let usersInitialized = false;

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts.length || !parts[0]) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function initUsersSection() {
  if (usersInitialized) return;
  usersInitialized = true;

  // Segmented role tabs
  document.querySelectorAll('.account-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.account-tab').forEach((t) => {
        t.classList.remove('active');
        t.style.background = 'none';
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--ink-muted)';
      });
      tab.classList.add('active');
      tab.style.background = 'rgba(46,125,50,0.06)';
      tab.style.borderBottomColor = 'var(--primary)';
      tab.style.color = 'var(--primary)';
      activeAccountRole = tab.dataset.accountRole;
      renderFilteredUsers();
    });
  });

  // Search input
  document.getElementById('userSearchInput')?.addEventListener('input', renderFilteredUsers);

  // Status filter
  document.getElementById('userStatusFilter')?.addEventListener('change', renderFilteredUsers);

  // Reset filter button
  document.getElementById('userResetFilterBtn')?.addEventListener('click', () => {
    const searchInput = document.getElementById('userSearchInput');
    const statusFilter = document.getElementById('userStatusFilter');
    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = '';
    renderFilteredUsers();
  });
}

function updateTabCounts() {
  const teacherCount = cachedUsers.filter((u) => u.role === 'teacher').length;
  const parentCount = cachedUsers.filter((u) => u.role === 'parent').length;
  const adminCount = cachedUsers.filter((u) => u.role === 'admin').length;

  const elT = document.getElementById('tabCountTeacher');
  const elP = document.getElementById('tabCountParent');
  const elA = document.getElementById('tabCountAdmin');
  if (elT) elT.textContent = teacherCount;
  if (elP) elP.textContent = parentCount;
  if (elA) elA.textContent = adminCount;
}

async function loadUsers() {
  initUsersSection();
  const { users } = await api.get('/users');
  cachedUsers = users || [];
  updateTabCounts();
  renderFilteredUsers();
}

function renderFilteredUsers() {
  const tbody = document.getElementById('usersTbody');
  if (!tbody) return;

  const roleLabels = {
    teacher: 'Teacher',
    parent: 'Parent',
    admin: 'Administrator',
  };
  const currentRoleLabel = roleLabels[activeAccountRole] || 'User';

  const roleUsers = cachedUsers.filter((u) => u.role === activeAccountRole);

  const statusFilter = document.getElementById('userStatusFilter')?.value || '';
  const query = (document.getElementById('userSearchInput')?.value || '').trim().toLowerCase();

  let filtered = roleUsers;
  if (statusFilter) {
    filtered = filtered.filter((u) => u.status === statusFilter);
  }
  if (query) {
    filtered = filtered.filter((u) => {
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }

  // Update counter
  const counterEl = document.getElementById('userSearchResultsCount');
  if (counterEl) {
    if (query || statusFilter) {
      counterEl.textContent = `Showing ${filtered.length} of ${roleUsers.length} ${currentRoleLabel} accounts`;
    } else {
      counterEl.textContent = `Total: ${roleUsers.length} ${currentRoleLabel} account${roleUsers.length === 1 ? '' : 's'}`;
    }
  }

  if (!filtered.length) {
    let emptyMsg = `No ${currentRoleLabel.toLowerCase()} accounts found.`;
    if (query && statusFilter) {
      emptyMsg = `No ${currentRoleLabel.toLowerCase()} accounts match "${query}" with status "${statusFilter}".`;
    } else if (query) {
      emptyMsg = `No ${currentRoleLabel.toLowerCase()} accounts found matching "${query}".`;
    } else if (statusFilter) {
      emptyMsg = `No ${currentRoleLabel.toLowerCase()} accounts with status "${statusFilter}".`;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state" style="padding:36px 16px;">
            <i class="fa-solid fa-user-slash" style="font-size:28px; color:var(--ink-light); margin-bottom:8px;"></i>
            <p style="margin:0; font-size:14px; font-weight:600; color:var(--ink-muted);">${emptyMsg}</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((u) => {
    const statusLabels = { approved: 'Approved', pending: 'Pending', archived: 'Archived', rejected: 'Rejected' };
    const displayStatus = statusLabels[u.status] || u.status;
    const isArchived = u.status === 'archived';

    return `
      <tr style="${isArchived ? 'opacity:0.65; background:#FAFAFA;' : ''}">
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:34px; height:34px; border-radius:50%; background:rgba(46,125,50,0.1); color:var(--primary); font-weight:800; font-size:12.5px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${getInitials(u.name)}
            </div>
            <div>
              <strong style="color:var(--ink); font-size:13.5px;">${u.name}</strong>
              ${u.phone ? `<div style="font-size:11.5px; color:var(--ink-muted);"><i class="fa-solid fa-phone" style="font-size:10px; margin-right:4px;"></i>${u.phone}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          <a href="mailto:${u.email}" style="color:var(--ink); font-size:13px; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
            <i class="fa-regular fa-envelope" style="color:var(--ink-muted); font-size:12px;"></i>
            ${u.email}
          </a>
          ${u.role === 'parent' ? `<div><span class="badge ${u.emailVerified ? 'approved' : 'pending'}" style="margin-top:5px;">${u.emailVerified ? 'Verified' : 'Not verified'}</span></div>` : ''}
        </td>
        <td>
          <span class="badge ${u.status}" style="font-size:11.5px; padding:3px 9px;">${displayStatus}</span>
        </td>
        <td style="color:#64748B; font-size:12.5px; white-space:nowrap;">
          ${u.createdAt ? fmtDate(u.createdAt) : '—'}
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
            ${u.status === 'pending' ? `
              <button class="btn btn-secondary btn-sm" data-approve="${u.id}" style="padding:4px 10px; font-size:12px; font-weight:700;" title="Approve account">
                <i class="fa-solid fa-check"></i> Approve
              </button>
            ` : ''}
            ${u.role === 'parent' && !u.emailVerified && !isArchived ? `
              <button class="btn btn-secondary btn-sm" data-verify-email="${u.id}" style="padding:4px 10px; font-size:12px;" title="Verify this parent's current email address">
                <i class="fa-solid fa-envelope-circle-check"></i> Verify email
              </button>
            ` : ''}
            ${!isArchived ? `
              <button class="btn btn-ghost btn-sm" data-archive="${u.id}" style="padding:4px 8px; font-size:12px;" title="Archive account">
                <i class="fa-solid fa-box-archive"></i> Archive
              </button>
            ` : `
              <button class="btn btn-ghost btn-sm" data-reactivate="${u.id}" style="padding:4px 8px; font-size:12px; color:var(--primary);" title="Reactivate account">
                <i class="fa-solid fa-rotate-left"></i> Reactivate
              </button>
            `}
            ${u.status !== 'archived' ? `
              <a class="btn btn-ghost btn-sm" href="edit-user.html?id=${encodeURIComponent(u.id)}" style="padding:4px 7px; font-size:12px; text-decoration:none;" title="Edit user profile & photo">
                <i class="fa-solid fa-pen-to-square"></i>
              </a>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind actions
  tbody.querySelectorAll('[data-approve]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api.patch(`/users/${b.dataset.approve}/approve`);
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  tbody.querySelectorAll('[data-verify-email]').forEach((button) => {
    button.addEventListener('click', async () => {
      const parent = cachedUsers.find((item) => item.id === button.dataset.verifyEmail);
      if (!parent || !confirm(`Verify ${parent.email} for ${parent.name}? Only verify an address the parent controls.`)) return;
      try {
        await api.patch(`/users/${button.dataset.verifyEmail}/verify-email`, {});
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  tbody.querySelectorAll('[data-archive]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to archive this user account?')) return;
      try {
        await api.patch(`/users/${b.dataset.archive}/archive`);
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  tbody.querySelectorAll('[data-reactivate]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api.patch(`/users/${b.dataset.reactivate}/reactivate`);
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
  });


  tbody.querySelectorAll('[data-approve]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api.patch(`/users/${button.dataset.approve}/approve`);
      alert(result.message);
      await loadUsers();
    } catch (err) {
      alert(err.message);
      button.disabled = false;
    }
  }));
  tbody.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', () => api.patch(`/users/${b.dataset.archive}/archive`).then(loadUsers)));
  tbody.querySelectorAll('[data-reactivate]').forEach((b) => b.addEventListener('click', () => api.patch(`/users/${b.dataset.reactivate}/reactivate`).then(loadUsers)));

}

document.getElementById('addUserBtn').addEventListener('click', () => {
  Modal.open(`
    <h3>Add Teaching Staff, Parent, or Admin</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="userForm">
      <div class="field">
        <label>Account Role</label>
        <select id="uRole">
          <option value="teacher" ${activeAccountRole === 'teacher' ? 'selected' : ''}>Teacher</option>
          <option value="parent" ${activeAccountRole === 'parent' ? 'selected' : ''}>Parent</option>
          <option value="admin" ${activeAccountRole === 'admin' ? 'selected' : ''}>Administrator</option>
        </select>
      </div>
      <div class="field"><label>Full Name</label><input id="uName" placeholder="e.g. Sarah Jenkins" required /></div>
      <div class="field"><label>Email Address</label><input type="email" id="uEmail" placeholder="sarah@example.com" required /></div>
      <div class="field"><label>Phone Number</label><input id="uPhone" placeholder="Optional phone number" /></div>
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
        phone: document.getElementById('uPhone').value.trim() || undefined,
        password: document.getElementById('uPassword').value,
      });
      Modal.close();
      await loadUsers();
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
let cachedFees = [];

async function loadFees() {
  const { fees } = await api.get('/fees');
  cachedFees = fees || [];
  applyFeesFilterAndRender();
}

function applyFeesFilterAndRender() {
  const query = (document.getElementById('feeSearchInput')?.value || '').trim().toLowerCase();
  const countEl = document.getElementById('feeSearchCount');

  let filtered = cachedFees;
  if (query) {
    filtered = cachedFees.filter((f) => {
      const studentName = (f.student?.name || '').toLowerCase();
      const studentId = String(f.student?._id || '').toLowerCase();
      return studentName.includes(query) || studentId.includes(query);
    });
    if (countEl) countEl.textContent = `Showing ${filtered.length} of ${cachedFees.length} records`;
  } else {
    if (countEl) countEl.textContent = '';
  }

  renderFeesTable(filtered, query);
}

function renderFeesTable(fees, query = '') {
  const tbody = document.getElementById('feesTbody');
  if (!tbody) return;

  if (!fees.length) {
    if (query) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>No payment records found matching "${query}".</p></div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee statements generated yet.</p></div></td></tr>`;
    }
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
  tbody.querySelectorAll('[data-open-fee-history]').forEach((b) => {
    b.addEventListener('click', () => {
      const fee = cachedFees.find((item) => item._id === b.dataset.openFeeHistory);
      if (fee) openPaymentHistoryModal(fee);
    });
  });
}

function renderAdminPaymentHistory(fee) {
  if (!fee.payments || !fee.payments.length) return '';
  return `
    <div style="margin-top:5px;">
      <button type="button" class="btn btn-ghost btn-sm" data-open-fee-history="${fee._id}" style="color:var(--primary); font-weight:600; padding:2px 8px; font-size:12px; border:1px solid rgba(46,125,50,0.25); background:rgba(46,125,50,0.06); border-radius:4px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
        <i class="fa-solid fa-clock-rotate-left"></i> Payment History (${fee.payments.length})
      </button>
    </div>
  `;
}

function openPaymentHistoryModal(fee) {
  const payments = fee.payments || [];
  const totalPaid = Number(payments
    .filter((p) => p.receiptState !== 'voided')
    .reduce((sum, p) => sum + Number(p.amountPaid || 0), 0)
    .toFixed(2));
  const remainingBalance = Math.max(0, Number((Number(fee.amount) - totalPaid).toFixed(2)));
  const status = totalPaid <= 0 ? 'unpaid' : (remainingBalance === 0 ? 'paid' : 'partial');
  const statusLabel = { unpaid: 'Unpaid', partial: 'Partial Payment', paid: 'Paid' }[status];

  Modal.open(`
    <!-- Header with safe right padding so close button never overlaps -->
    <div style="padding-bottom:14px; border-bottom:1px solid #E2E8F0; padding-right:48px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; flex-wrap:wrap;">
        <h2 style="margin:0; font-size:20px; font-weight:800; color:var(--ink); display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-clock-rotate-left" style="color:var(--primary);"></i> Payment History
        </h2>
        <span class="badge ${status}" style="font-size:12px; padding:3px 10px;">${statusLabel}</span>
      </div>
      <p style="margin:0; font-size:13.5px; color:var(--ink-muted); line-height:1.4;">
        Student: <strong style="color:var(--ink); font-size:14px;">${fee.student ? fee.student.name : '—'}</strong>
        ${fee.student?.className ? `<span style="color:var(--ink-muted);"> (${fee.student.className})</span>` : ''}
        &nbsp;&bull;&nbsp; Fee: <strong style="color:var(--ink);">${fee.description}</strong>
      </p>
    </div>

    <!-- Overview Bar (4 balanced metric cards) -->
    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin:16px 0; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px 18px;">
      <div>
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Total Fee</div>
        <div style="font-size:17px; font-weight:800; color:var(--ink); margin-top:3px;">${fmtMoney(fee.amount)}</div>
      </div>
      <div>
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Total Paid</div>
        <div style="font-size:17px; font-weight:800; color:#15803D; margin-top:3px;">${fmtMoney(totalPaid)}</div>
      </div>
      <div>
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Remaining Balance</div>
        <div style="font-size:17px; font-weight:800; color:${remainingBalance === 0 ? '#15803D' : '#B45309'}; margin-top:3px;">${fmtMoney(remainingBalance)}</div>
      </div>
      <div>
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Total Payments</div>
        <div style="font-size:17px; font-weight:800; color:var(--ink); margin-top:3px;">${payments.length} record${payments.length === 1 ? '' : 's'}</div>
      </div>
    </div>

    <!-- Payments List Table -->
    <div style="margin-top:14px;">
      <h4 style="margin:0 0 10px; font-size:12px; font-weight:700; color:var(--ink-muted); text-transform:uppercase; letter-spacing:0.06em;">Recorded Transactions</h4>
      ${!payments.length ? '<p style="color:var(--ink-muted); font-size:13px; margin:16px 0; text-align:center;">No payments recorded for this fee yet.</p>' : `
        <div style="max-height:360px; overflow-x:auto; overflow-y:auto; border:1px solid #E2E8F0; border-radius:10px; background:#fff;">
          <table style="width:100%; border-collapse:collapse; margin:0; font-size:13px; min-width:700px;">
            <thead>
              <tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0;">
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Date Paid</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Receipt No.</th>
                <th style="padding:10px 14px; text-align:right; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Amount Paid</th>
                <th style="padding:10px 14px; text-align:right; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Balance After</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Recorded By</th>
                <th style="padding:10px 14px; text-align:center; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Status</th>
                <th style="padding:10px 14px; text-align:right; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map((p) => {
                const isVoided = p.receiptState === 'voided';
                const receiptNum = p.receiptNumber || 'Pending';
                const balAfter = p.receiptSnapshot?.remainingBalance ?? 0;
                return `
                  <tr style="border-bottom:1px solid #F1F5F9; ${isVoided ? 'opacity:0.6; background:#FEF2F2;' : ''}">
                    <td style="padding:12px 14px; white-space:nowrap; color:#334155;">${fmtDate(p.datePaid)}</td>
                    <td style="padding:12px 14px; white-space:nowrap; font-weight:700; color:var(--primary); font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12.5px;">${receiptNum}</td>
                    <td style="padding:12px 14px; white-space:nowrap; text-align:right; font-weight:700; color:${isVoided ? '#94A3B8' : '#15803D'}; font-size:13.5px;">${fmtMoney(p.amountPaid)}</td>
                    <td style="padding:12px 14px; white-space:nowrap; text-align:right; color:#475569; font-weight:600;">${fmtMoney(balAfter)}</td>
                    <td style="padding:12px 14px; white-space:nowrap; color:#334155;">${p.loggedBy?.name || 'Admin'}</td>
                    <td style="padding:12px 14px; white-space:nowrap; text-align:center;">
                      <span class="badge ${isVoided ? 'archived' : 'approved'}" style="font-size:11px; padding:2px 8px;">${isVoided ? 'Voided' : 'Issued'}</span>
                    </td>
                    <td style="padding:12px 14px; white-space:nowrap; text-align:right;">
                      <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                        <button class="btn btn-secondary btn-sm" data-modal-receipt="${p._id}" data-fee-id="${fee._id}" style="padding:4px 10px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;" title="View official receipt">
                          <i class="fa-solid fa-receipt"></i> View Receipt
                        </button>
                        ${isVoided ? '' : `
                          <button class="btn btn-ghost btn-sm" data-modal-edit="${p._id}" data-fee-id="${fee._id}" title="Edit payment" style="padding:4px 7px;">
                            <i class="fa-solid fa-pen"></i>
                          </button>
                          <button class="btn btn-ghost btn-sm" data-modal-delete="${p._id}" data-fee-id="${fee._id}" title="Void payment" style="padding:4px 7px; color:#DC2626;">
                            <i class="fa-solid fa-trash-can"></i>
                          </button>
                        `}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div style="margin-top:18px; display:flex; justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" id="closeHistoryModalBtn"><i class="fa-solid fa-xmark"></i> Close</button>
    </div>
  `, true);

  const modalEl = document.getElementById('modalBody');
  if (modalEl) modalEl.style.maxWidth = '880px';

  document.getElementById('closeHistoryModalBtn')?.addEventListener('click', () => {
    if (modalEl) modalEl.style.maxWidth = '';
    Modal.close();
  });

  modalEl?.querySelectorAll('[data-modal-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showPaymentReceipt(btn.dataset.feeId, btn.dataset.modalReceipt);
    });
  });

  modalEl?.querySelectorAll('[data-modal-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const payment = payments.find((p) => p._id === btn.dataset.modalEdit);
      if (payment) openEditPaymentModal(fee, payment, totalPaid);
    });
  });

  modalEl?.querySelectorAll('[data-modal-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Void this recorded payment? The receipt will be marked voided and the fee balance and parent notification will be updated.')) return;
      try {
        await api.del(`/fees/${btn.dataset.feeId}/payments/${btn.dataset.modalDelete}`);
        await loadFees();
        const updatedFee = cachedFees.find((f) => f._id === fee._id);
        if (updatedFee) openPaymentHistoryModal(updatedFee);
        else Modal.close();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function openPaymentReportsModal() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentYear = now.getFullYear();

  const allPayments = [];
  cachedFees.forEach((fee) => {
    (fee.payments || []).forEach((p) => {
      allPayments.push({
        ...p,
        feeId: fee._id,
        feeDescription: fee.description,
        feeAmount: fee.amount,
        studentName: fee.student ? fee.student.name : '—',
        studentId: fee.student ? fee.student._id : '—',
        studentClass: fee.student?.className || '',
      });
    });
  });

  const yearsSet = new Set([currentYear]);
  allPayments.forEach((p) => {
    if (p.datePaid) {
      yearsSet.add(new Date(p.datePaid).getFullYear());
    }
  });
  const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

  let currentReportType = 'daily';
  let lastGeneratedReportData = null;

  Modal.open(`
    <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px; margin-bottom:16px; padding-right:48px;">
      <h2 style="margin:0 0 4px; font-size:20px; font-weight:800; color:var(--ink); display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-file-invoice-dollar" style="color:var(--primary);"></i> Payment &amp; Collections Reports
      </h2>
      <p style="margin:0; font-size:13px; color:var(--ink-muted);">Generate official daily, monthly, and yearly payment collection reports.</p>
    </div>

    <!-- Report Type Tabs & Filter Row -->
    <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-sm btn-primary" id="tabDailyReport">Daily Report</button>
          <button type="button" class="btn btn-sm btn-secondary" id="tabMonthlyReport">Monthly Report</button>
          <button type="button" class="btn btn-sm btn-secondary" id="tabYearlyReport">Yearly Report</button>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <div id="filterDailyWrapper" style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:13px; font-weight:600; color:var(--ink);">Date:</label>
          <input type="date" id="reportDailyInput" value="${todayStr}" style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;" />
        </div>
        <div id="filterMonthlyWrapper" style="display:none; align-items:center; gap:8px;">
          <label style="font-size:13px; font-weight:600; color:var(--ink);">Month:</label>
          <input type="month" id="reportMonthlyInput" value="${thisMonthStr}" style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;" />
        </div>
        <div id="filterYearlyWrapper" style="display:none; align-items:center; gap:8px;">
          <label style="font-size:13px; font-weight:600; color:var(--ink);">Year:</label>
          <select id="reportYearlyInput" style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
            ${sortedYears.map((y) => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btnRunReport"><i class="fa-solid fa-arrows-rotate"></i> Generate Report</button>
      </div>
    </div>

    <!-- Report Output Container -->
    <div id="reportOutputArea"></div>

    <div style="margin-top:18px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #E2E8F0; padding-top:12px;">
      <button class="btn btn-ghost btn-sm" id="closeReportModalBtn"><i class="fa-solid fa-xmark"></i> Close</button>
      <button class="btn btn-primary btn-sm" id="printReportDocBtn" style="display:none;"><i class="fa-solid fa-print"></i> Print Report</button>
    </div>
  `, true);

  const modalEl = document.getElementById('modalBody');
  if (modalEl) modalEl.style.maxWidth = '920px';

  const tabDaily = document.getElementById('tabDailyReport');
  const tabMonthly = document.getElementById('tabMonthlyReport');
  const tabYearly = document.getElementById('tabYearlyReport');
  const filterDaily = document.getElementById('filterDailyWrapper');
  const filterMonthly = document.getElementById('filterMonthlyWrapper');
  const filterYearly = document.getElementById('filterYearlyWrapper');
  const printBtn = document.getElementById('printReportDocBtn');

  function setTab(type) {
    currentReportType = type;
    tabDaily.className = `btn btn-sm ${type === 'daily' ? 'btn-primary' : 'btn-secondary'}`;
    tabMonthly.className = `btn btn-sm ${type === 'monthly' ? 'btn-primary' : 'btn-secondary'}`;
    tabYearly.className = `btn btn-sm ${type === 'yearly' ? 'btn-primary' : 'btn-secondary'}`;
    filterDaily.style.display = type === 'daily' ? 'flex' : 'none';
    filterMonthly.style.display = type === 'monthly' ? 'flex' : 'none';
    filterYearly.style.display = type === 'yearly' ? 'flex' : 'none';
    generateReport();
  }

  tabDaily.addEventListener('click', () => setTab('daily'));
  tabMonthly.addEventListener('click', () => setTab('monthly'));
  tabYearly.addEventListener('click', () => setTab('yearly'));

  document.getElementById('btnRunReport').addEventListener('click', () => generateReport());
  document.getElementById('reportDailyInput').addEventListener('change', () => generateReport());
  document.getElementById('reportMonthlyInput').addEventListener('change', () => generateReport());
  document.getElementById('reportYearlyInput').addEventListener('change', () => generateReport());
  document.getElementById('closeReportModalBtn').addEventListener('click', () => {
    if (modalEl) modalEl.style.maxWidth = '';
    Modal.close();
  });

  printBtn.addEventListener('click', () => {
    if (lastGeneratedReportData) {
      printPaymentReport(lastGeneratedReportData);
    }
  });

  function generateReport() {
    let filteredPayments = [];
    let title = '';
    let periodLabel = '';

    if (currentReportType === 'daily') {
      const selectedDate = document.getElementById('reportDailyInput').value;
      if (!selectedDate) return;
      title = 'Daily Payment Collection Report';
      const dObj = new Date(selectedDate + 'T00:00:00');
      periodLabel = dObj.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

      filteredPayments = allPayments.filter((p) => {
        if (!p.datePaid) return false;
        const d = new Date(p.datePaid);
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return ymd === selectedDate;
      });
    } else if (currentReportType === 'monthly') {
      const selectedMonth = document.getElementById('reportMonthlyInput').value;
      if (!selectedMonth) return;
      title = 'Monthly Payment Collection Report';
      const [yStr, mStr] = selectedMonth.split('-');
      const dObj = new Date(Number(yStr), Number(mStr) - 1, 1);
      periodLabel = dObj.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });

      filteredPayments = allPayments.filter((p) => {
        if (!p.datePaid) return false;
        const d = new Date(p.datePaid);
        return d.getFullYear() === Number(yStr) && (d.getMonth() + 1) === Number(mStr);
      });
    } else if (currentReportType === 'yearly') {
      const selectedYear = Number(document.getElementById('reportYearlyInput').value);
      title = 'Yearly Payment Collection Report';
      periodLabel = `Year ${selectedYear}`;

      filteredPayments = allPayments.filter((p) => {
        if (!p.datePaid) return false;
        const d = new Date(p.datePaid);
        return d.getFullYear() === selectedYear;
      });
    }

    const activePayments = filteredPayments.filter((p) => p.receiptState !== 'voided');
    const voidedPayments = filteredPayments.filter((p) => p.receiptState === 'voided');
    const totalCollected = activePayments.reduce((sum, p) => sum + Number(p.amountPaid || 0), 0);
    const voidedTotal = voidedPayments.reduce((sum, p) => sum + Number(p.amountPaid || 0), 0);
    const uniqueStudents = new Set(activePayments.map((p) => p.studentId || p.studentName));

    lastGeneratedReportData = {
      title,
      periodLabel,
      totalCollected,
      totalCount: activePayments.length,
      voidedCount: voidedPayments.length,
      voidedTotal,
      uniqueStudentsCount: uniqueStudents.size,
      payments: filteredPayments,
    };

    printBtn.style.display = 'inline-flex';

    const outputEl = document.getElementById('reportOutputArea');
    outputEl.innerHTML = `
      <div style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
        <div>
          <h3 style="margin:0; font-size:16px; color:var(--ink);">${title}</h3>
          <span style="font-size:13px; color:var(--ink-muted); font-weight:600;">${periodLabel}</span>
        </div>
        <span style="font-size:12px; color:var(--ink-muted);">Generated on: ${new Date().toLocaleTimeString('en-PH')}</span>
      </div>

      <!-- Stat Cards -->
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:16px;">
        <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:12px 16px;">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:#15803D; letter-spacing:0.04em;">Total Collections</div>
          <div style="font-size:18px; font-weight:800; color:#15803D; margin-top:2px;">${fmtMoney(totalCollected)}</div>
        </div>
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:12px 16px;">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Transactions</div>
          <div style="font-size:18px; font-weight:800; color:var(--ink); margin-top:2px;">${activePayments.length} paid</div>
        </div>
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:12px 16px;">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-muted); letter-spacing:0.04em;">Unique Students</div>
          <div style="font-size:18px; font-weight:800; color:var(--ink); margin-top:2px;">${uniqueStudents.size}</div>
        </div>
        <div style="background:${voidedPayments.length ? '#FEF2F2' : '#F8FAFC'}; border:1px solid ${voidedPayments.length ? '#FECACA' : '#E2E8F0'}; border-radius:10px; padding:12px 16px;">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:${voidedPayments.length ? '#DC2626' : 'var(--ink-muted)'}; letter-spacing:0.04em;">Voided Payments</div>
          <div style="font-size:18px; font-weight:800; color:${voidedPayments.length ? '#DC2626' : 'var(--ink)'}; margin-top:2px;">${voidedPayments.length} (${fmtMoney(voidedTotal)})</div>
        </div>
      </div>

      <!-- Report Transactions Table -->
      ${!filteredPayments.length ? `
        <div class="empty-state" style="padding:28px 16px; border:1px solid #E2E8F0; border-radius:10px;">
          <i class="fa-solid fa-receipt"></i>
          <p>No payment records found for ${periodLabel}.</p>
        </div>
      ` : `
        <div style="max-height:320px; overflow-x:auto; overflow-y:auto; border:1px solid #E2E8F0; border-radius:10px; background:#fff;">
          <table style="width:100%; border-collapse:collapse; margin:0; font-size:13px; min-width:720px;">
            <thead>
              <tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0;">
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Date Paid</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Receipt No.</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Student</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Description</th>
                <th style="padding:10px 14px; text-align:right; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Amount Paid</th>
                <th style="padding:10px 14px; text-align:left; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Recorded By</th>
                <th style="padding:10px 14px; text-align:center; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Status</th>
                <th style="padding:10px 14px; text-align:right; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">Receipt</th>
              </tr>
            </thead>
            <tbody>
              ${filteredPayments.map((p) => {
                const isVoid = p.receiptState === 'voided';
                return `
                  <tr style="border-bottom:1px solid #F1F5F9; ${isVoid ? 'opacity:0.6; background:#FEF2F2;' : ''}">
                    <td style="padding:10px 14px; white-space:nowrap; color:#334155;">${fmtDate(p.datePaid)}</td>
                    <td style="padding:10px 14px; font-weight:700; color:var(--primary); font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12.5px; white-space:nowrap;">${p.receiptNumber || 'Pending'}</td>
                    <td style="padding:10px 14px; white-space:nowrap;"><strong>${p.studentName}</strong></td>
                    <td style="padding:10px 14px; white-space:nowrap;">${p.feeDescription}</td>
                    <td style="padding:10px 14px; font-weight:700; text-align:right; color:${isVoid ? '#94A3B8' : '#15803D'}; white-space:nowrap;">${fmtMoney(p.amountPaid)}</td>
                    <td style="padding:10px 14px; white-space:nowrap; color:#334155;">${p.loggedBy?.name || 'Admin'}</td>
                    <td style="padding:10px 14px; text-align:center; white-space:nowrap;"><span class="badge ${isVoid ? 'archived' : 'approved'}" style="font-size:11px; padding:2px 8px;">${isVoid ? 'Voided' : 'Issued'}</span></td>
                    <td style="padding:10px 14px; text-align:right; white-space:nowrap;">
                      <button class="btn btn-secondary btn-sm" data-rep-receipt="${p._id}" data-rep-fee="${p.feeId}" style="padding:3px 8px; font-size:12px; display:inline-flex; align-items:center; gap:4px;">
                        <i class="fa-solid fa-receipt"></i> View
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    outputEl.querySelectorAll('[data-rep-receipt]').forEach((b) => {
      b.addEventListener('click', () => {
        showPaymentReceipt(b.dataset.repFee, b.dataset.repReceipt);
      });
    });
  }

  generateReport();
}

function printPaymentReport(reportData) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print the report.');
    return;
  }
  const rowsHtml = reportData.payments.map((p) => `
    <tr style="${p.receiptState === 'voided' ? 'color:#94a3b8; text-decoration:line-through;' : ''}">
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px;">${fmtDate(p.datePaid)}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px; font-weight:700;">${p.receiptNumber || 'Pending'}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px;"><strong>${p.studentName}</strong></td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px;">${p.feeDescription}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px; font-weight:700; text-align:right;">${fmtMoney(p.amountPaid)}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px;">${p.loggedBy?.name || 'Admin'}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12.5px;">${p.receiptState === 'voided' ? 'Voided' : 'Issued'}</td>
    </tr>
  `).join('');

  printWindow.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${reportData.title} — Play-is-School</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 32px; background: #fff; }
    .report-wrap { max-width: 800px; margin: 0 auto; }
    .report-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #276749; padding-bottom: 16px; margin-bottom: 20px; }
    .report-title h1 { margin: 0; font-size: 20px; color: #276749; }
    .report-title p { margin: 4px 0 0; font-size: 13px; color: #64748b; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat-box { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px; padding: 10px 14px; }
    .stat-box .lbl { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; }
    .stat-box .val { font-size: 16px; font-weight: 800; color: #1e293b; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #f1f5f9; text-align: left; padding: 9px 10px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 1px solid #cbd5e1; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11.5px; color: #94a3b8; }
    @media print {
      body { padding: 12px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="report-wrap">
    <div class="report-header">
      <div class="report-title">
        <h1>Play-is-School</h1>
        <p><strong>${reportData.title}</strong> &bull; Period: ${reportData.periodLabel}</p>
      </div>
      <div style="text-align:right; font-size:12px; color:#64748b;">
        <div>Generated: ${new Date().toLocaleString('en-PH')}</div>
        <div>Staff: ${user.name}</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box"><div class="lbl">Total Collected</div><div class="val" style="color:#276749;">${fmtMoney(reportData.totalCollected)}</div></div>
      <div class="stat-box"><div class="lbl">Total Transactions</div><div class="val">${reportData.totalCount}</div></div>
      <div class="stat-box"><div class="lbl">Unique Students</div><div class="val">${reportData.uniqueStudentsCount}</div></div>
      <div class="stat-box"><div class="lbl">Voided Records</div><div class="val" style="color:#dc2626;">${reportData.voidedCount}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Date Paid</th>
          <th>Receipt No.</th>
          <th>Student</th>
          <th>Fee Description</th>
          <th style="text-align:right;">Amount Paid</th>
          <th>Recorded By</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding:16px; color:#64748b;">No transactions recorded.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>Play-is-School Official Accounts &amp; Finance Record</div>
      <div>Page 1 of 1</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', () => { window.print(); });
  </script>
</body>
</html>`);
  printWindow.document.close();
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

document.getElementById('paymentReportBtn')?.addEventListener('click', () => {
  openPaymentReportsModal();
});

document.getElementById('feeSearchInput')?.addEventListener('input', () => {
  applyFeesFilterAndRender();
});

// ---------- Events Calendar ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  const calendarEvents = events.filter((event) => !['pending', 'rejected'].includes(event.publicationStatus));
  if (!adminCalendar) {
    adminCalendar = new EventsCalendar({
      containerId: 'eventsCalendarContainer',
      events: calendarEvents,
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
    adminCalendar.setEvents(calendarEvents);
  }
  renderEventStatusList(events, document.getElementById('adminEventStatusList'));
  const pending = events.filter((event) => event.publicationStatus === 'pending' && event.reviewStatus !== 'publishing');
  document.getElementById('pendingEventsCount').textContent = `${pending.length} pending`;
  document.getElementById('pendingEventsList').innerHTML = pending.length ? pending.map((event) => `
    <article class="event-review-card">
      <div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><strong>${escapeDashboardHtml(event.title)}</strong><span class="badge status-badge-pending">Pending approval</span></div>
        <p class="event-review-meta">Submitted by ${escapeDashboardHtml(event.createdBy?.name || 'Teacher')} · ${fmtDate(event.date)}${event.time ? ` · ${escapeDashboardHtml(event.time)}` : ''}${event.venue ? ` · ${escapeDashboardHtml(event.venue)}` : ''}</p>
        <p style="margin:6px 0 0;">${escapeDashboardHtml(event.description)}</p>
        <p class="event-review-meta">Recipients: ${event.targetType === 'classes' ? escapeDashboardHtml((event.targetClasses || []).join(', ')) : 'All parents'}</p>
      </div>
      <div class="event-review-actions"><button type="button" class="btn btn-primary btn-sm" data-review-event="${escapeDashboardHtml(event._id)}" data-decision="approved"><i class="fa-solid fa-check" aria-hidden="true"></i> Approve &amp; Publish</button><button type="button" class="btn btn-ghost btn-sm" data-review-event="${escapeDashboardHtml(event._id)}" data-decision="rejected"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Reject</button></div>
    </article>
  `).join('') : '<div class="notification-empty">No teacher events are waiting for approval.</div>';
  document.querySelectorAll('[data-review-event]').forEach((button) => button.addEventListener('click', () => {
    const event = pending.find((item) => item._id === button.dataset.reviewEvent);
    if (event) openEventReview(event, button.dataset.decision);
  }));
}

function openEventReview(event, decision) {
  const approving = decision === 'approved';
  Modal.open(`
    <h3>${approving ? 'Approve and Publish Event' : 'Reject Event'}</h3>
    <p><strong>${escapeDashboardHtml(event.title)}</strong></p>
    <p>${escapeDashboardHtml(event.description)}</p>
    <p><strong>Date:</strong> ${fmtDate(event.date)} · ${escapeDashboardHtml(event.time || '—')}<br><strong>Venue:</strong> ${escapeDashboardHtml(event.venue || '—')}</p>
    <p><strong>Recipients:</strong> ${event.targetType === 'classes' ? escapeDashboardHtml((event.targetClasses || []).join(', ')) : 'All parents'}</p>
    <p class="field-hint">${approving ? 'Parents will receive an in-app notification and eligible email after approval.' : 'Rejected events will not be shown to parents or send notifications.'}</p>
    <div class="field"><label for="eventReviewNotes">Review note <span class="field-hint">(optional)</span></label><textarea id="eventReviewNotes" rows="2" maxlength="500"></textarea></div>
    <div id="eventReviewError" class="form-msg" role="alert"></div>
    <div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelEventReview">Cancel</button><button type="button" class="btn ${approving ? 'btn-primary' : 'btn-danger'}" id="confirmEventReview">${approving ? 'Approve & Publish' : 'Confirm Rejection'}</button></div>
  `, true);
  document.getElementById('cancelEventReview').addEventListener('click', () => Modal.close());
  document.getElementById('confirmEventReview').addEventListener('click', async (clickEvent) => {
    const button = clickEvent.currentTarget;
    setButtonLoading(button, true, approving ? 'Publishing' : 'Rejecting');
    try {
      const response = await api.patch(`/events/${event._id}/review`, {
        decision,
        reviewNotes: document.getElementById('eventReviewNotes').value.trim(),
      });
      Modal.close();
      showToast(response.message || (approving ? 'Event approved and published.' : 'Event rejected.'), approving ? 'success' : 'info');
      const summary = document.getElementById('adminEventSummary');
      if (approving && response.emailSummary) {
        summary.className = 'form-msg success';
        summary.textContent = `Sent ${response.emailSummary.sent}, skipped ${response.emailSummary.skipped}, failed ${response.emailSummary.failed}${response.emailSummary.complete ? '' : ' (delivery logs still updating)'}.`;
      }
      await loadEvents();
    } catch (error) {
      showMsg(document.getElementById('eventReviewError'), error.message || 'Could not review this event.');
      setButtonLoading(button, false);
    }
  });
}

document.getElementById('addEventBtn').addEventListener('click', async () => {
  try {
    const { students } = await api.get('/students');
    const classes = [...new Set(students.map((student) => student.className).filter(Boolean))].sort();
    openEventComposer({
      classes,
      onSave: (event) => api.post('/events', event),
      onComplete: async ({ event, emailSummary }) => {
        await loadEvents();
        const output = document.getElementById('adminEventSummary');
        output.textContent = event.publicationStatus === 'draft'
          ? 'Draft saved.'
          : `Sent ${emailSummary.sent}, skipped ${emailSummary.skipped}, failed ${emailSummary.failed}${emailSummary.complete ? '' : ' (delivery logs still updating)'}.`;
        output.className = 'form-msg success';
        if (!emailSummary.complete && event.emailRecipientCount) {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const latest = await api.get(`/events/${event._id}/email-summary`);
            const summary = latest.emailSummary;
            output.textContent = `Sent ${summary.sent}, skipped ${summary.skipped}, failed ${summary.failed}${summary.complete ? '' : ' (delivery logs still updating)'}.`;
            if (summary.complete) break;
          }
        }
      },
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

let adminStudentCache = [];
let adminAudiencePicker = null;
let adminAlertView = 'active';

async function loadAdminAlerts() {
  const { students } = await api.get('/students');
  adminStudentCache = (students || []).filter((student) => student.status === 'active');
  if (!adminAudiencePicker) {
    adminAudiencePicker = createEmergencyAudiencePicker({
      containerId: 'adminEmergencyAudience',
      students: adminStudentCache,
      wholeDescription: 'All active pupils in the school',
    });
  }
  const { alerts: displayedAlerts } = await api.get(`/alerts?view=${adminAlertView}`);
  document.getElementById('adminAlertsList').innerHTML = displayedAlerts.length ? displayedAlerts.map((alert) => `
    <article class="alert-banner">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      <div><strong>${escapeDashboardHtml(alert.title)}</strong><p>${escapeDashboardHtml(alert.description || alert.message)}</p><small>${escapeDashboardHtml(alert.severity || 'high')} · ${fmtDate(alert.createdAt)} · ${(alert.students || []).length} pupils · ${(alert.acknowledgements || []).length} acknowledged</small>
      <div class="event-form-actions">
        ${adminAlertView === 'archived' && alert.status === 'archived' ? `<button type="button" class="btn btn-secondary btn-sm" data-admin-alert-restore="${escapeDashboardHtml(alert._id)}">Restore</button>` : ''}
        ${alert.status !== 'deleted' ? `${adminAlertView === 'active' ? `<button type="button" class="btn btn-ghost btn-sm" data-admin-alert-archive="${escapeDashboardHtml(alert._id)}">Archive</button>` : ''}<button type="button" class="btn btn-danger btn-sm" data-admin-alert-delete="${escapeDashboardHtml(alert._id)}">Delete</button>` : '<span class="badge status-badge-rejected">Soft deleted</span>'}
        ${adminAlertView === 'active' && alert.status !== 'all-clear' && alert.status !== 'deleted' ? `<button type="button" class="btn btn-secondary btn-sm" data-admin-alert-update="${escapeDashboardHtml(alert._id)}">Send update</button><button type="button" class="btn btn-ghost btn-sm" data-admin-alert-clear="${escapeDashboardHtml(alert._id)}">Send all-clear</button>` : ''}
      </div></div>
    </article>
  `).join('') : `<div class="notification-empty">No ${adminAlertView === 'archived' ? 'archived' : 'active'} alerts.</div>`;
  document.querySelectorAll('[data-admin-alert-view]').forEach((tab) => {
    const active = tab.dataset.adminAlertView === adminAlertView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  bindAdminAlertManagement();
  bindAdminAlertUpdates();
}

document.querySelectorAll('[data-admin-alert-view]').forEach((button) => button.addEventListener('click', async () => {
  adminAlertView = button.dataset.adminAlertView;
  try { await loadAdminAlerts(); } catch (error) { showToast(error.message, 'error'); }
}));

function bindAdminAlertManagement() {
  document.querySelectorAll('[data-admin-alert-archive]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Archive this emergency alert? It will leave the active list and can be restored later. Email logs and acknowledgments will remain.')) return;
    try {
      await api.patch(`/alerts/${button.dataset.adminAlertArchive}/archive`, {});
      showToast('Emergency alert archived.', 'info');
      await loadAdminAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-admin-alert-restore]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.patch(`/alerts/${button.dataset.adminAlertRestore}/restore`, {});
      showToast('Emergency alert restored.');
      await loadAdminAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-admin-alert-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Soft-delete this alert? It will remain in the Archived tab marked as deleted. The alert, acknowledgments, and email logs are retained.')) return;
    try {
      await api.del(`/alerts/${button.dataset.adminAlertDelete}`);
      showToast('Emergency alert soft-deleted.', 'info');
      await loadAdminAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
}

function bindAdminAlertUpdates() {
  document.querySelectorAll('[data-admin-alert-update], [data-admin-alert-clear]').forEach((button) => button.addEventListener('click', async () => {
    const allClear = Boolean(button.dataset.adminAlertClear);
    Modal.open(`<h3>${allClear ? 'Send All-Clear' : 'Send Emergency Update'}</h3><div class="field"><label for="adminAlertFollowup">Message <span class="required-mark" aria-hidden="true">*</span></label><textarea id="adminAlertFollowup" rows="4" required></textarea></div><div id="adminAlertFollowupError" class="form-msg" role="alert"></div><div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelAdminAlertFollowup">Cancel</button><button type="button" class="btn ${allClear ? 'btn-primary' : 'btn-danger'}" id="sendAdminAlertFollowup">${allClear ? 'Send All-Clear' : 'Send Update'}</button></div>`);
    document.getElementById('cancelAdminAlertFollowup').addEventListener('click', () => Modal.close());
    document.getElementById('sendAdminAlertFollowup').addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      const message = document.getElementById('adminAlertFollowup').value.trim();
      if (!message) return showMsg(document.getElementById('adminAlertFollowupError'), 'Enter an update message.');
      setButtonLoading(submit, true, 'Sending');
      try {
        await api.post(`/alerts/${button.dataset.adminAlertUpdate || button.dataset.adminAlertClear}/updates`, { message, status: allClear ? 'all-clear' : 'update' });
        Modal.close();
        showToast(allClear ? 'All-clear notice sent.' : 'Emergency update sent.');
        await loadAdminAlerts();
      } catch (err) {
        showMsg(document.getElementById('adminAlertFollowupError'), err.message);
        setButtonLoading(submit, false);
      }
    });
  }));
}

document.getElementById('adminAlertForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!adminAudiencePicker?.validate()) return;
  const audience = adminAudiencePicker.getSelection();
  const values = {
    emergencyType: document.getElementById('adminAlertType').value,
    title: document.getElementById('adminAlertTitle').value.trim(),
    description: document.getElementById('adminAlertDescription').value.trim(),
    safetyInstructions: document.getElementById('adminAlertInstructions').value.trim(),
    severity: document.querySelector('input[name="adminAlertSeverity"]:checked').value,
    students: audience.students,
    affectedClasses: audience.affectedClasses,
  };
  const errors = {
    type: values.emergencyType ? '' : 'Select an emergency type.',
    title: values.title ? '' : 'Alert title is required.',
    description: values.description ? '' : 'Description is required.',
    instructions: values.safetyInstructions ? '' : 'Safety instructions are required.',
  };
  Object.entries(errors).forEach(([key, message]) => {
    const node = document.querySelector(`[data-alert-error="${key}"]`);
    node.textContent = message;
    document.querySelector(`[data-alert-field="${key}"]`)?.classList.toggle('has-error', Boolean(message));
  });
  if (Object.values(errors).some(Boolean)) return;
  const targets = adminAudiencePicker.getTargetStudents();
  const parents = new Map();
  targets.forEach((student) => {
    if (student.parent) parents.set(String(student.parent._id || student.parent), student.parent);
  });
  const emailEligible = [...parents.values()].filter((parent) => parent && typeof parent === 'object'
    && parent.status === 'approved' && parent.email && parent.emailVerified && parent.emailVerifiedBy).length;
  const contactSummary = Array.from(parents.values()).map((parent) => `<li>${escapeDashboardHtml(parent.name || 'Parent')} · ${escapeDashboardHtml(parent.email || 'No email')} · ${parent.emailVerified && parent.emailVerifiedBy ? 'Verified' : 'Not verified'}</li>`).join('');
  Modal.open(`<h3>Review Emergency Alert</h3><p class="alert-banner"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>This will immediately notify parents by email.</span></p><p><strong>${escapeDashboardHtml(values.title)}</strong> · ${escapeDashboardHtml(values.severity)}</p><p>${escapeDashboardHtml(values.description)}</p><p><strong>Recipients:</strong> ${parents.size} linked parents; ${emailEligible} eligible email addresses</p><ul class="event-summary-list">${contactSummary || '<li>No linked parent accounts found.</li>'}</ul><div id="adminAlertConfirmError" class="form-msg" role="alert"></div><div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelAdminAlertSend">Cancel</button><button type="button" class="btn btn-danger" id="confirmAdminAlertSend">Send Alert</button></div>`);
  document.getElementById('cancelAdminAlertSend').addEventListener('click', () => Modal.close());
  document.getElementById('confirmAdminAlertSend').addEventListener('click', async (confirmEvent) => {
    const button = confirmEvent.currentTarget;
    setButtonLoading(button, true, 'Sending');
    try {
      const response = await api.post('/alerts', values);
      Modal.close();
      document.getElementById('adminAlertForm').reset();
      adminAudiencePicker = createEmergencyAudiencePicker({
        containerId: 'adminEmergencyAudience',
        students: adminStudentCache,
        wholeDescription: 'All active pupils in the school',
      });
      await showAdminEmailSummary(response);
      await loadAdminAlerts();
    } catch (err) {
      showMsg(document.getElementById('adminAlertConfirmError'), err.message);
      setButtonLoading(button, false);
    }
  });
});

async function showAdminEmailSummary(response) {
  const output = document.getElementById('adminAlertEmailSummary');
  const summary = response.emailSummary || { sent: 0, skipped: 0, failed: 0, expected: response.recipientCount || 0, complete: false };
  const renderSummary = () => {
    output.className = 'form-msg success';
    output.textContent = `Emergency alert processed: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped.`;
  };
  renderSummary();
  if (!summary.complete && response.alert?._id) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const latest = await api.get(`/alerts/${response.alert._id}/email-summary`);
      Object.assign(summary, latest.emailSummary);
      renderSummary();
      if (summary.complete) break;
    }
  }
  showToast(`Emergency alert: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped.`, summary.failed ? 'error' : 'success');
}

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
