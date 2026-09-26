const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logActivity = require('../utils/logActivity');

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone,
  };
}

// POST /api/auth/signup  (admin or parent self-signup; teachers are added by an admin)
exports.signup = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password and role are required.' });
    }
    if (!['admin', 'parent'].includes(role)) {
      return res.status(400).json({ message: 'Only admin and parent accounts can self-register. Ask an admin to create a teacher account.' });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'An account with that email already exists.' });

    const user = await User.create({ name, email, password, role, phone });
    await logActivity(user._id, 'signup', `${role} account created`);

    if (user.role === 'parent') {
      return res.status(201).json({
        message: 'Account created. An admin needs to approve it before you can log in.',
        user: publicUser(user),
      });
    }

    const token = signToken(user);
    res.status(201).json({ message: 'Account created.', token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Signup failed.', error: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ message: 'Your account is awaiting admin approval.' });
    }
    if (user.status === 'archived') {
      return res.status(403).json({ message: 'This account has been archived. Contact the school admin.' });
    }

    const token = signToken(user);
    await logActivity(user._id, 'login');
    res.json({ message: 'Logged in.', token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Login failed.', error: err.message });
  }
};

// POST /api/auth/logout  (JWTs are stateless; client just discards the token)
exports.logout = async (req, res) => {
  if (req.user) await logActivity(req.user._id, 'logout');
  res.json({ message: 'Logged out. Please discard your access token.' });
};

// GET /api/auth/me
exports.me = async (req, res) => {
  res.json({ user: publicUser(req.user) });
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    // Always respond the same way so we don't reveal which emails exist.
    const genericMsg = 'If that email is registered, a password reset link has been generated.';
    if (!user) return res.json({ message: genericMsg });

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    // NOTE: no email service is wired up. In production, email `rawToken` to the user
    // instead of returning it in the response.
    res.json({ message: genericMsg, devResetToken: rawToken });
  } catch (err) {
    res.status(500).json({ message: 'Could not process request.', error: err.message });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'Token and new password are required.' });

    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) return res.status(400).json({ message: 'Reset link is invalid or has expired.' });

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    await logActivity(user._id, 'password-reset');

    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: 'Could not reset password.', error: err.message });
  }
};
