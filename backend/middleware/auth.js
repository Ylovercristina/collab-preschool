const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const INTEGRATION_ACCESS_TTL = '30m';

// Verifies the JWT and attaches req.user
async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated. Please log in.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Only sign-in (session) tokens are accepted here. Other tokens signed by this server — for
    // example the short-lived Integrations verification tokens — carry a `scope` and no role.
    if (!decoded || decoded.scope || !decoded.role || !decoded.id || !decoded.iat) {
      return res.status(401).json({ code: 'TOKEN_INVALID', message: 'Session expired or invalid. Please log in again.' });
    }
    if (await RevokedToken.exists({ tokenHash: hashToken(token) })) {
      return res.status(401).json({ code: 'TOKEN_REVOKED', message: 'You have been logged out. Please log in again.' });
    }
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ code: 'TOKEN_INVALID', message: 'Account no longer exists.' });
    if (user.status === 'archived') return res.status(403).json({ message: 'This account has been archived.' });
    if (user.status === 'rejected') return res.status(403).json({ message: 'This registration was not approved.' });
    // The token must still describe this account: same account type, issued after the last
    // password reset / account-type change.
    if (decoded.role !== user.role) {
      return res.status(401).json({ code: 'TOKEN_STALE', message: 'Your account was changed. Please sign in again.' });
    }
    if (user.sessionsValidAfter && decoded.iat * 1000 < user.sessionsValidAfter.getTime()) {
      return res.status(401).json({ code: 'TOKEN_STALE', message: 'Your password or account was changed. Please sign in again.' });
    }
    // Saving (anything other than reading) also needs an approved account.
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (isWrite && user.status !== 'approved') {
      return res.status(403).json({ code: 'ACCOUNT_NOT_ACTIVE', message: 'Your account is not active, so changes cannot be saved.' });
    }

    req.user = user;
    req.authToken = token;
    req.authTokenExpiresAt = decoded.exp ? new Date(decoded.exp * 1000) : null;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid. Please log in again.' });
  }
}

// Restricts a route to specific roles, e.g. allowRoles('admin', 'teacher')
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    next();
  };
}

// Role-based access control: the account needs `action` (view / manage / approve) on `moduleKey`.
// Permissions are read fresh on every request, so an administrator's change applies immediately.
function requirePermission(moduleKey, action = 'view') {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Not authenticated. Please log in.' });
      // Loaded lazily to avoid a require cycle (the service needs models that need nothing from here).
      const { effectivePermissions, can } = require('../services/permissionService');
      if (!req.permissions) req.permissions = await effectivePermissions(req.user);
      if (can(req.permissions, moduleKey, action)) return next();
      const { MODULES } = require('../config/permissions');
      const label = (MODULES.find((module) => module.key === moduleKey) || {}).label || moduleKey;
      const verb = { view: 'access', manage: 'make changes in', approve: 'approve items in' }[action] || 'use';
      return res.status(403).json({
        code: 'PERMISSION_DENIED',
        module: moduleKey,
        action,
        message: `Your account does not have permission to ${verb} ${label}. Ask a System Administrator for access.`,
      });
    } catch (err) {
      console.error('[rbac] Permission check failed:', err.message);
      return res.status(500).json({ message: 'Could not check your permissions.' });
    }
  };
}

// Passes when the account has ANY of the listed [module, action] permissions. Used for shared
// lookups another module needs (e.g. the teacher list in the Classes form).
function requireAnyPermission(...pairs) {
  return async (req, res, next) => {
    try {
      const { effectivePermissions, can } = require('../services/permissionService');
      if (!req.permissions) req.permissions = await effectivePermissions(req.user);
      if (pairs.some(([moduleKey, action]) => can(req.permissions, moduleKey, action || 'view'))) return next();
      return res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Your account does not have permission to do that. Ask a System Administrator for access.' });
    } catch (err) {
      console.error('[rbac] Permission check failed:', err.message);
      return res.status(500).json({ message: 'Could not check your permissions.' });
    }
  };
}

// Only a System Administrator may change positions or permissions.
async function requireSystemAdmin(req, res, next) {
  const { positionForUser } = require('../config/permissions');
  if (req.user && req.user.role === 'admin' && positionForUser(req.user) === 'system_admin') return next();
  return res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Only a System Administrator can change roles and permissions.' });
}

function requireIntegrationOtp(purpose = 'access') {
  return async (req, res, next) => {
    let decoded;
    try {
      const token = req.get('X-Integration-Access');
      decoded = token && jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(403).json({ message: 'Verify the integration code to continue.' });
    }
    if (!decoded || decoded.scope !== 'settings:integrations' || decoded.purpose !== purpose
      || decoded.id !== String(req.user._id)
      || (purpose === 'access' && decoded.stage !== undefined)) {
      return res.status(403).json({ message: 'Verify the integration code to continue.' });
    }
    if (purpose === 'save') {
      if (typeof decoded.jti !== 'string' || !decoded.jti) {
        return res.status(403).json({ message: 'Verify the integration code before saving changes.' });
      }
      const grantHash = crypto.createHash('sha256').update(decoded.jti).digest('hex');
      try {
        const result = await User.updateOne(
          { _id: req.user._id, integrationSaveGrantHash: grantHash, integrationSaveGrantExpires: { $gt: new Date() } },
          { $unset: { integrationSaveGrantHash: 1, integrationSaveGrantExpires: 1 } }
        );
        if (result.modifiedCount !== 1) {
          return res.status(403).json({ message: 'This verification code has expired or was already used. Request a new code.' });
        }
      } catch (err) {
        console.error('[auth] Could not consume integration save verification:', err.message);
        return res.status(503).json({ message: 'Could not verify access to save integration settings.' });
      }
    }
    if (purpose === 'access') {
      // Sliding session: every verified request inside Integrations renews the grant,
      // so saving settings never asks for the OTP/PIN again while the admin is active.
      const refreshed = jwt.sign(
        { id: decoded.id, scope: decoded.scope, purpose: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: INTEGRATION_ACCESS_TTL }
      );
      res.set('X-Integration-Access-Refresh', refreshed);
    }
    return next();
  };
}

module.exports = { protect, allowRoles, requirePermission, requireAnyPermission, requireSystemAdmin, requireIntegrationOtp, hashToken };
