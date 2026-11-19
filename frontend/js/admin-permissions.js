// ---------- User Management: Roles & Permissions (Role-based access control) ----------
// Only a System Administrator sees and uses this view; the server enforces the same rule.

// Mirrors backend/config/permissions.js (labels only — the server owns the rules).
const RBAC_POSITIONS = [
  { key: 'system_admin', label: 'System Administrator', accountType: 'admin' },
  { key: 'principal', label: 'Principal', accountType: 'admin' },
  { key: 'registrar', label: 'Registrar', accountType: 'admin' },
  { key: 'finance_officer', label: 'Finance Officer', accountType: 'admin' },
  { key: 'auditor', label: 'Auditor', accountType: 'admin' },
  { key: 'teacher', label: 'Teacher', accountType: 'teacher' },
  { key: 'teacher_aide', label: 'Teacher Aide', accountType: 'teacher' },
  { key: 'parent', label: 'Parent / Guardian', accountType: 'parent' },
];
const RBAC_ACTION_LABELS = { view: 'V', manage: 'M', approve: 'A' };
const RBAC_ACTION_TITLES = { view: 'View (limited access)', manage: 'Manage (full access)', approve: 'Approve' };

let rbacData = null; // { modules, positions, roles, users, audit }
let rbacRoleDraft = {}; // position -> permissions being edited
let rbacDirtyRoles = new Set();
let rbacSelectedUserId = '';

function rbacPositionLabel(key) {
  return (RBAC_POSITIONS.find((position) => position.key === key) || {}).label || key || '—';
}

// "Role & access" cell in the accounts table.
function userRoleAccessCell(account) {
  const row = rbacData && rbacData.users.find((item) => String(item.id) === String(account.id));
  const label = escapeDashboardHtml(rbacPositionLabel(row ? row.position : account.position));
  if (!row) return `<span class="rbac-role-pill">${label}</span>`;
  return `<span class="rbac-role-pill">${label}</span>${row.customized ? ' <span class="badge pending rbac-custom-badge">Custom</span>' : ''}
    <div class="rbac-access-count">${row.access.length} module${row.access.length === 1 ? '' : 's'}</div>`;
}

function rbacClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rbacModuleApplies(module, accountType) {
  return module.types.includes(accountType);
}

// Ticking Manage or Approve also ticks View; unticking View clears the others.
function rbacSetAction(permissions, moduleKey, action, checked) {
  const entry = permissions[moduleKey] || { view: false, manage: false, approve: false };
  entry[action] = checked;
  if (action !== 'view' && checked) entry.view = true;
  if (action === 'view' && !checked) {
    entry.manage = false;
    entry.approve = false;
  }
  permissions[moduleKey] = entry;
}

function rbacCellHtml({ module, accountType, permissions, scope, locked }) {
  if (!rbacModuleApplies(module, accountType)) return '<td class="rbac-na" title="Not part of this account type">n/a</td>';
  const entry = permissions[module.key] || {};
  const boxes = ['view', 'manage', 'approve']
    .filter((action) => action !== 'approve' || module.approvable)
    .map((action) => `<label class="rbac-check" title="${RBAC_ACTION_TITLES[action]}${action === 'approve' && module.approveHint ? `: ${escapeDashboardHtml(module.approveHint)}` : ''}">
        <input type="checkbox" data-rbac-scope="${scope}" data-rbac-module="${module.key}" data-rbac-action="${action}" ${entry[action] ? 'checked' : ''} ${locked ? 'disabled' : ''} />
        <span>${RBAC_ACTION_LABELS[action]}</span>
      </label>`).join('');
  return `<td class="rbac-cell ${entry.view ? 'has-access' : 'no-access'}">${boxes}</td>`;
}

function renderRbacRoleMatrix() {
  const table = document.getElementById('rbacRoleMatrix');
  const { modules, positions } = rbacData;
  table.innerHTML = `
    <thead>
      <tr><th scope="col">Module</th>${positions.map((position) => `
        <th scope="col" class="rbac-role-head">
          <span>${escapeDashboardHtml(position.label)}</span>
          <small>${escapeDashboardHtml(position.accountType)} account${position.locked ? ' · always full' : ''}</small>
          ${!position.locked && rbacData.roles[position.key].customized ? `<button type="button" class="rbac-reset-link" data-rbac-reset-role="${position.key}">Reset</button>` : ''}
        </th>`).join('')}</tr>
    </thead>
    <tbody>${modules.map((module) => `
      <tr><th scope="row">${escapeDashboardHtml(module.label)}</th>${positions.map((position) => rbacCellHtml({
        module,
        accountType: position.accountType,
        permissions: rbacRoleDraft[position.key],
        scope: `role:${position.key}`,
        locked: position.locked,
      })).join('')}</tr>`).join('')}
    </tbody>`;

  table.querySelectorAll('input[data-rbac-scope^="role:"]').forEach((input) => input.addEventListener('change', () => {
    const position = input.dataset.rbacScope.slice(5);
    rbacSetAction(rbacRoleDraft[position], input.dataset.rbacModule, input.dataset.rbacAction, input.checked);
    rbacDirtyRoles.add(position);
    renderRbacRoleMatrix();
    updateRbacRoleDirty();
  }));
  table.querySelectorAll('[data-rbac-reset-role]').forEach((button) => button.addEventListener('click', () => resetRbacRole(button.dataset.rbacResetRole)));
}

function updateRbacRoleDirty() {
  document.getElementById('rbacRoleDirty').hidden = rbacDirtyRoles.size === 0;
  document.getElementById('rbacSaveRoles').disabled = rbacDirtyRoles.size === 0;
}

async function saveRbacRoles() {
  const message = document.getElementById('rbacRoleMessage');
  const button = document.getElementById('rbacSaveRoles');
  button.disabled = true;
  try {
    for (const position of rbacDirtyRoles) {
      await api.put(`/permissions/roles/${position}`, { permissions: rbacRoleDraft[position] });
    }
    showToast('Role permissions saved.');
    await loadRbac();
  } catch (err) {
    showMsg(message, err.message);
    button.disabled = false;
  }
}

async function resetRbacRole(position) {
  if (!confirm(`Reset ${rbacPositionLabel(position)} to the default permissions?`)) return;
  try {
    const result = await api.put(`/permissions/roles/${position}`, { reset: true });
    showToast(result.message);
    await loadRbac();
  } catch (err) {
    showMsg(document.getElementById('rbacRoleMessage'), err.message);
  }
}

function renderRbacUserOptions() {
  document.getElementById('rbacUserOptions').innerHTML = rbacData.users
    .map((row) => `<option value="${escapeDashboardHtml(`${row.name} <${row.email}>`)}"></option>`).join('');
}

function renderRbacUserEditor() {
  const editor = document.getElementById('rbacUserEditor');
  const row = rbacData.users.find((item) => String(item.id) === String(rbacSelectedUserId));
  if (!row) {
    editor.innerHTML = '<p class="rbac-empty">Choose an account above to see and change its access.</p>';
    return;
  }
  const positions = rbacData.positions.filter((position) => position.accountType === row.role);
  const position = rbacData.positions.find((item) => item.key === row.position) || {};
  const locked = row.isSelf || position.locked;
  const draft = rbacClone(row.permissions);
  editor.innerHTML = `
    <div class="rbac-user-head">
      <div><strong>${escapeDashboardHtml(row.name)}</strong><span>${escapeDashboardHtml(row.email)} · ${escapeDashboardHtml(row.role)} account</span></div>
      <span class="badge ${row.customized ? 'pending' : 'approved'}">${row.customized ? 'Custom permissions' : 'Using role defaults'}</span>
    </div>
    ${row.isSelf ? '<div class="form-msg error" style="display:block;">You cannot change your own role or permissions.</div>' : ''}
    <div class="grid-2 rbac-user-fields">
      <div class="field"><label for="rbacUserPosition">Role</label>
        <select id="rbacUserPosition" ${row.isSelf ? 'disabled' : ''}>${positions.map((item) => `<option value="${item.key}" ${item.key === row.position ? 'selected' : ''}>${escapeDashboardHtml(item.label)}</option>`).join('')}</select>
        <div class="field-hint">${escapeDashboardHtml(position.description || '')}</div>
      </div>
    </div>
    ${position.locked ? '<p class="rbac-empty">A System Administrator always has full access. Change the role to restrict this account.</p>' : ''}
    <div class="table-responsive"><table class="rbac-matrix rbac-user-matrix">
      <thead><tr><th scope="col">Module</th><th scope="col">Access</th><th scope="col">Level</th></tr></thead>
      <tbody>${rbacData.modules.filter((module) => rbacModuleApplies(module, row.role)).map((module) => {
        const entry = draft[module.key] || {};
        const level = entry.manage ? 'Full access' : entry.approve ? 'Approval access' : entry.view ? 'Limited access' : 'No access';
        return `<tr><th scope="row">${escapeDashboardHtml(module.label)}</th>${rbacCellHtml({ module, accountType: row.role, permissions: draft, scope: 'user', locked })}<td class="rbac-level" data-rbac-level="${module.key}">${level}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="rbac-user-actions">
      ${row.customized && !locked ? '<button type="button" class="btn btn-ghost btn-sm" id="rbacUserReset"><i class="fa-solid fa-rotate-left"></i> Use role defaults</button>' : ''}
      <button type="button" class="btn btn-primary btn-sm" id="rbacUserSave" ${row.isSelf ? 'disabled' : ''}><i class="fa-solid fa-floppy-disk"></i> Save access</button>
    </div>`;

  let permissionsTouched = false;
  editor.querySelectorAll('input[data-rbac-scope="user"]').forEach((input) => input.addEventListener('change', () => {
    rbacSetAction(draft, input.dataset.rbacModule, input.dataset.rbacAction, input.checked);
    permissionsTouched = true;
    const entry = draft[input.dataset.rbacModule];
    editor.querySelectorAll(`input[data-rbac-scope="user"][data-rbac-module="${input.dataset.rbacModule}"]`).forEach((box) => {
      box.checked = Boolean(entry[box.dataset.rbacAction]);
    });
    editor.querySelector(`[data-rbac-level="${input.dataset.rbacModule}"]`).textContent = entry.manage ? 'Full access' : entry.approve ? 'Approval access' : entry.view ? 'Limited access' : 'No access';
    input.closest('td').className = `rbac-cell ${entry.view ? 'has-access' : 'no-access'}`;
  }));

  editor.querySelector('#rbacUserSave')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const message = document.getElementById('rbacUserMessage');
    const nextPosition = editor.querySelector('#rbacUserPosition').value;
    const body = {};
    if (nextPosition !== row.position) body.position = nextPosition;
    // A changed role starts from that role's defaults; custom boxes apply to the current role.
    if (permissionsTouched && nextPosition === row.position) body.permissions = draft;
    if (!Object.keys(body).length) {
      showMsg(message, 'Nothing to save.', 'info');
      return;
    }
    if (body.position && permissionsTouched) {
      showMsg(message, 'The role changed, so the account now uses that role\'s defaults. Adjust the boxes again and save if you need custom access.', 'info');
    }
    button.disabled = true;
    try {
      const result = await api.put(`/permissions/users/${row.id}`, body, { version: row.updatedAt });
      showToast(result.message);
      await loadRbac();
      if (typeof loadUsers === 'function') loadUsers().catch(() => {});
    } catch (err) {
      showMsg(message, err.message);
      button.disabled = false;
    }
  });

  editor.querySelector('#rbacUserReset')?.addEventListener('click', async () => {
    try {
      const result = await api.put(`/permissions/users/${row.id}`, { reset: true }, { version: row.updatedAt });
      showToast(result.message);
      await loadRbac();
    } catch (err) {
      showMsg(document.getElementById('rbacUserMessage'), err.message);
    }
  });
}

function renderRbacAudit() {
  const list = document.getElementById('rbacAudit');
  const labels = {
    'role-permissions-updated': 'Role permissions changed',
    'role-permissions-reset': 'Role reset to defaults',
    'user-permissions-updated': 'User permissions changed',
    'user-position-changed': 'User role changed',
    'user-permissions-reset': 'User reset to role defaults',
  };
  list.innerHTML = rbacData.audit.length ? rbacData.audit.map((item) => `
    <li>
      <div><strong>${escapeDashboardHtml(labels[item.action] || item.action)}</strong> <span>by ${escapeDashboardHtml(item.by)} · ${escapeDashboardHtml(new Date(item.at).toLocaleString())}</span></div>
      <p>${escapeDashboardHtml(item.details || '')}</p>
    </li>`).join('') : '<li class="rbac-empty">No permission changes yet.</li>';
}

async function loadRbac() {
  if (!currentAccess || !currentAccess.isSystemAdmin) return;
  try {
    rbacData = await api.get('/permissions');
    rbacRoleDraft = {};
    Object.entries(rbacData.roles).forEach(([key, value]) => { rbacRoleDraft[key] = rbacClone(value.permissions); });
    rbacDirtyRoles = new Set();
    renderRbacRoleMatrix();
    updateRbacRoleDirty();
    renderRbacUserOptions();
    renderRbacUserEditor();
    renderRbacAudit();
  } catch (err) {
    showMsg(document.getElementById('rbacRoleMessage'), err.message);
  }
}

function showUsersView(view) {
  document.querySelectorAll('[data-users-view]').forEach((tab) => {
    const active = tab.dataset.usersView === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('usersAccountsView').hidden = view !== 'accounts';
  document.getElementById('usersPermissionsView').hidden = view !== 'permissions';
  if (view !== 'permissions' && rbacUserLock) selectRbacUser('');
  if (view === 'permissions') loadRbac();
}

// Selecting an account locks it for editing (others see who is editing it); switching account or
// leaving the view releases the lock. Returns false when someone else is editing that account.
let rbacUserLock = null;
async function selectRbacUser(userId) {
  if (rbacUserLock) {
    rbacUserLock.release();
    rbacUserLock = null;
  }
  const id = String(userId || '');
  if (id && String(id) !== String(user.id)) {
    const lock = await EditLocks.acquire('user', id, {
      isActive: () => rbacSelectedUserId === id && !document.getElementById('usersPermissionsView').hidden
        && document.getElementById('panel-users')?.classList.contains('active'),
    });
    if (!lock) {
      rbacSelectedUserId = '';
      return false;
    }
    rbacUserLock = lock;
  }
  rbacSelectedUserId = id;
  return true;
}

// Opens the permissions view on one account (from the accounts table).
async function openUserPermissions(userId) {
  showUsersView('permissions');
  await selectRbacUser(userId);
  await loadRbac();
  const row = rbacData && rbacData.users.find((item) => String(item.id) === rbacSelectedUserId);
  if (row) document.getElementById('rbacUserSearch').value = `${row.name} <${row.email}>`;
  document.getElementById('rbacUserEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initRbacView() {
  document.querySelectorAll('[data-users-view]').forEach((tab) => tab.addEventListener('click', () => showUsersView(tab.dataset.usersView)));
  document.getElementById('rbacSaveRoles').addEventListener('click', saveRbacRoles);
  document.getElementById('rbacUserSearch').addEventListener('change', async (event) => {
    const value = event.target.value.trim().toLowerCase();
    const row = rbacData && rbacData.users.find((item) => `${item.name} <${item.email}>`.toLowerCase() === value
      || item.email.toLowerCase() === value);
    if (!(await selectRbacUser(row ? row.id : ''))) event.target.value = '';
    document.getElementById('rbacUserMessage').textContent = '';
    document.getElementById('rbacUserMessage').className = 'form-msg';
    renderRbacUserEditor();
  });
  // Once permissions are known, load the data so the accounts table can show each account's access.
  let loadedOnce = false;
  document.addEventListener('permissions-loaded', () => {
    if (loadedOnce || !currentAccess || !currentAccess.isSystemAdmin) return;
    loadedOnce = true;
    loadRbac().then(() => { if (typeof renderFilteredUsers === 'function') renderFilteredUsers(); });
  });
}

initRbacView();
