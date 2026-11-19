const mongoose = require('mongoose');
const User = require('../models/User');
const RolePermission = require('../models/RolePermission');
const ActivityLog = require('../models/ActivityLog');
const logActivity = require('../utils/logActivity');
const {
  ACTIONS, MODULES, POSITIONS, positionInfo, normalizePermissions, positionForUser,
} = require('../config/permissions');
const {
  clearRolePermissionCache, rolePermissionMap, effectivePermissions, accessSummary,
} = require('../services/permissionService');

const PERMISSION_LOG_ACTIONS = ['role-permissions-updated', 'role-permissions-reset', 'user-permissions-updated', 'user-position-changed', 'user-permissions-reset'];

function catalog() {
  return {
    actions: ACTIONS,
    modules: MODULES.map(({ key, label, types, approvable, approveHint }) => ({ key, label, types, approvable, approveHint: approveHint || '' })),
    positions: POSITIONS.map(({ key, label, accountType, description, locked }) => ({ key, label, accountType, description, locked: Boolean(locked) })),
  };
}

// Readable "what changed" text for the audit trail, e.g. "Fees: +manage; Logs: -view".
function describeChanges(before, after) {
  const changes = [];
  MODULES.forEach((module) => {
    const a = before[module.key] || {};
    const b = after[module.key] || {};
    const parts = ACTIONS
      .filter((action) => Boolean(a[action]) !== Boolean(b[action]))
      .map((action) => `${b[action] ? '+' : '-'}${action}`);
    if (parts.length) changes.push(`${module.label}: ${parts.join(' ')}`);
  });
  return changes.join('; ') || 'no changes';
}

async function countActiveSystemAdmins(excludeId) {
  const admins = await User.find({ role: 'admin', status: 'approved', _id: { $ne: excludeId } }).select('role position');
  return admins.filter((admin) => positionForUser(admin) === 'system_admin').length;
}

// GET /api/permissions/me  (any signed-in account: what am I allowed to do?)
exports.myPermissions = async (req, res) => {
  const permissions = await effectivePermissions(req.user);
  const position = positionInfo(positionForUser(req.user));
  res.json({
    position: position ? { key: position.key, label: position.label } : null,
    isSystemAdmin: req.user.role === 'admin' && positionForUser(req.user) === 'system_admin',
    permissions,
  });
};

// GET /api/permissions  (System Administrator: catalog, role matrix, users, recent changes)
exports.overview = async (req, res) => {
  const [roleMap, users, logs] = await Promise.all([
    rolePermissionMap(),
    User.find({ status: { $ne: 'archived' } }).sort({ role: 1, name: 1 }),
    ActivityLog.find({ action: { $in: PERMISSION_LOG_ACTIONS } }).populate('user', 'name').sort({ createdAt: -1 }).limit(30),
  ]);
  const roles = {};
  Object.entries(roleMap).forEach(([key, value]) => {
    roles[key] = { permissions: value.permissions, customized: value.customized, updatedAt: value.updatedAt };
  });
  const userRows = await Promise.all(users.map(async (user) => {
    const permissions = await effectivePermissions(user);
    return {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      position: positionForUser(user),
      customized: Boolean(user.customPermissions) && !(positionInfo(positionForUser(user)) || {}).locked,
      permissions,
      access: accessSummary(permissions),
      isSelf: user._id.equals(req.user._id),
      updatedAt: user.updatedAt,
    };
  }));
  res.json({
    ...catalog(),
    roles,
    users: userRows,
    audit: logs.map((log) => ({ id: log._id, action: log.action, details: log.details, by: log.user ? log.user.name : 'System', at: log.createdAt })),
  });
};

// PUT /api/permissions/roles/:position  { permissions } or { reset: true }
exports.updateRolePermissions = async (req, res) => {
  const position = positionInfo(req.params.position);
  if (!position) return res.status(404).json({ message: 'Unknown role.' });
  if (position.locked) return res.status(400).json({ message: `${position.label} always has full access and cannot be changed.` });
  const before = (await rolePermissionMap())[position.key].permissions;
  if (req.body && req.body.reset === true) {
    await RolePermission.deleteOne({ position: position.key });
    clearRolePermissionCache();
    const after = (await rolePermissionMap())[position.key].permissions;
    await logActivity(req.user._id, 'role-permissions-reset', `${position.label} reset to defaults (${describeChanges(before, after)})`);
    return res.json({ message: `${position.label} permissions were reset to the defaults.`, permissions: after });
  }
  const permissions = normalizePermissions(req.body && req.body.permissions, position.accountType);
  await RolePermission.findOneAndUpdate(
    { position: position.key },
    { $set: { permissions, updatedBy: req.user._id } },
    { upsert: true, new: true }
  );
  clearRolePermissionCache();
  await logActivity(req.user._id, 'role-permissions-updated', `${position.label}: ${describeChanges(before, permissions)}`);
  res.json({ message: `${position.label} permissions saved. Accounts using the role defaults get them immediately.`, permissions });
};

// PUT /api/permissions/users/:id  { position?, permissions? } or { reset: true }
exports.updateUserPermissions = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'User not found.' });
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(403).json({ message: 'You cannot change your own role or permissions. Ask another System Administrator.' });
  }
  const user = await User.findById(req.params.id);
  if (!user || user.status === 'archived') return res.status(404).json({ message: 'User not found.' });

  const beforePosition = positionForUser(user);
  const beforePermissions = await effectivePermissions(user);
  const details = [];

  if (req.body.position !== undefined) {
    const next = positionInfo(req.body.position);
    if (!next || next.accountType !== user.role) {
      return res.status(400).json({ message: `Choose a role that fits a ${user.role} account.` });
    }
    if (beforePosition === 'system_admin' && next.key !== 'system_admin' && user.status === 'approved'
      && await countActiveSystemAdmins(user._id) === 0) {
      return res.status(400).json({ message: 'At least one active System Administrator is required.' });
    }
    if (next.key !== beforePosition) {
      user.position = next.key;
      user.customPermissions = null; // a new role starts from that role's defaults
      details.push(`role ${positionInfo(beforePosition)?.label || beforePosition} → ${next.label}`);
    }
  }

  const position = positionInfo(positionForUser(user));
  if (req.body.reset === true) {
    user.customPermissions = null;
    details.push('permissions reset to role defaults');
  } else if (req.body.permissions !== undefined) {
    if (position && position.locked) {
      return res.status(400).json({ message: 'A System Administrator always has full access. Change the role first to restrict this account.' });
    }
    user.customPermissions = normalizePermissions(req.body.permissions, user.role);
  }

  user.markModified('customPermissions');
  await user.save();
  const afterPermissions = await effectivePermissions(user);
  const permissionChanges = describeChanges(beforePermissions, afterPermissions);
  if (permissionChanges !== 'no changes') details.push(permissionChanges);
  const action = req.body.reset === true ? 'user-permissions-reset'
    : details.some((item) => item.startsWith('role ')) ? 'user-position-changed' : 'user-permissions-updated';
  await logActivity(req.user._id, action, `${user.name} (${user.email}): ${details.join('; ') || 'no changes'}`);

  res.json({
    message: `${user.name}'s access was updated. It applies to their next request.`,
    user: {
      id: user._id,
      position: positionForUser(user),
      customized: Boolean(user.customPermissions) && !(position || {}).locked,
      permissions: afterPermissions,
      access: accessSummary(afterPermissions),
    },
  });
};
