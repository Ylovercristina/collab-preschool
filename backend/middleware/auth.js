const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

module.exports = { protect, allowRoles };
