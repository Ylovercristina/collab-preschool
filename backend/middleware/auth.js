const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const INTEGRATION_ACCESS_TTL = '30m';

// Verifies the JWT and attaches req.user
async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated. Please log in.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Account no longer exists.' });
    if (user.status === 'archived') return res.status(403).json({ message: 'This account has been archived.' });

    req.user = user;
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

module.exports = { protect, allowRoles, requireIntegrationOtp };
