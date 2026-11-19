const RolePermission = require('../models/RolePermission');
const {
  MODULES, POSITIONS, positionInfo, normalizePermissions, positionForUser,
} = require('../config/permissions');

// Role defaults change rarely; cache them briefly so every request doesn't hit the database.
// Saving role permissions clears the cache, so changes apply on the next request.
const CACHE_MS = 30 * 1000;
let roleCache = null;
let roleCacheAt = 0;

function clearRolePermissionCache() {
  roleCache = null;
  roleCacheAt = 0;
}

async function rolePermissionMap() {
  if (roleCache && Date.now() - roleCacheAt < CACHE_MS) return roleCache;
  const saved = await RolePermission.find().lean();
  const savedByPosition = new Map(saved.map((doc) => [doc.position, doc]));
  const map = {};
  POSITIONS.forEach((position) => {
    const doc = savedByPosition.get(position.key);
    // The System Administrator always keeps full access, so nobody can lock the school out.
    const source = !position.locked && doc ? doc.permissions : position.defaults;
    map[position.key] = {
      permissions: normalizePermissions(source, position.accountType),
      customized: Boolean(!position.locked && doc),
      updatedAt: doc ? doc.updatedAt : null,
      updatedBy: doc ? doc.updatedBy : null,
    };
  });
  roleCache = map;
  roleCacheAt = Date.now();
  return map;
}

async function roleDefaults(positionKey) {
  const map = await rolePermissionMap();
  return map[positionKey] ? map[positionKey].permissions : null;
}

// The permissions that apply to this account right now.
async function effectivePermissions(user) {
  const positionKey = positionForUser(user);
  const position = positionInfo(positionKey);
  if (!position) return normalizePermissions({}, user.role);
  if (position.locked) return normalizePermissions(position.defaults, user.role);
  if (user.customPermissions && typeof user.customPermissions === 'object') {
    return normalizePermissions(user.customPermissions, user.role);
  }
  return (await roleDefaults(positionKey)) || normalizePermissions({}, user.role);
}

function can(permissions, moduleKey, action = 'view') {
  const entry = permissions && permissions[moduleKey];
  return Boolean(entry && entry[action]);
}

// Lists the modules and levels an account has, e.g. for the user table.
function accessSummary(permissions) {
  return MODULES
    .map((module) => {
      const entry = permissions[module.key] || {};
      if (!entry.view) return null;
      const level = entry.manage ? 'full' : entry.approve ? 'approve' : 'limited';
      return { module: module.key, label: module.label, level, approve: Boolean(entry.approve) };
    })
    .filter(Boolean);
}

module.exports = {
  clearRolePermissionCache,
  rolePermissionMap,
  roleDefaults,
  effectivePermissions,
  can,
  accessSummary,
};
