const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const logActivity = require('../utils/logActivity');

const RESET_OTP_TTL_MS = 5 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESET_GENERIC_MESSAGE = 'If this email is registered, we will send a reset code. If it does not arrive, try again later.';
const INVALID_RESET_OTP_MESSAGE = 'OTP is incorrect, expired, or no longer valid. Please request a new OTP.';
const RESET_FIELDS = '+passwordResetOtpHash +passwordResetOtpExpires +passwordResetOtpAttempts +passwordResetOtpSentAt +resetPasswordToken +resetPasswordExpires';
const GOOGLE_STATE_COOKIE = 'play_google_oauth_state';
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_HANDOFF_TTL_MS = 2 * 60 * 1000;
const emailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

function logResetDebug(...args) {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
}

function redactEmailSecret(value) {
  let text = String(value || '');
  if (process.env.EMAIL_PASS) text = text.split(process.env.EMAIL_PASS).join('[redacted]');
  return text;
}

function emailTransportError(error) {
  return {
    message: redactEmailSecret(error.message),
    code: error.code,
    response: redactEmailSecret(error.response),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resetEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function clearResetOtp(user) {
  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpires = undefined;
  user.passwordResetOtpAttempts = 0;
}

async function sendResetOtp(user, otp) {
  await emailTransporter.sendMail({
    from: `Play-is-School <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: 'Your Play-is-School password reset OTP',
    text: `Your Play-is-School password reset OTP is ${otp}. It expires in 5 minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.5">
        <h2 style="color:#287a62;margin-bottom:8px">Play-is-School</h2>
        <p>Use this code to reset your password:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#174f42">${otp}</p>
        <p>This OTP expires in <strong>5 minutes</strong>.</p>
        <p style="font-size:13px;color:#64748b">For your security, never share this code. If you did not request a password reset, ignore this email.</p>
      </div>`,
  });
}

exports.verifyEmailTransport = () => emailTransporter.verify();
exports.emailTransportError = emailTransportError;

async function issueResetOtp(user) {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const now = new Date();
  user.passwordResetOtpHash = await bcrypt.hash(otp, 10);
  user.passwordResetOtpExpires = new Date(now.getTime() + RESET_OTP_TTL_MS);
  user.passwordResetOtpAttempts = 0;
  user.passwordResetOtpSentAt = now;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  try {
    await sendResetOtp(user, otp);
    logResetDebug('[auth] password reset OTP email sent successfully');
    return true;
  } catch (err) {
    clearResetOtp(user);
    try {
      await user.save();
    } catch (saveError) {
      if (process.env.NODE_ENV !== 'production') console.error('[auth] failed to clear OTP after email delivery error:', saveError);
    }
    console.error('[auth] password reset OTP email failed:', emailTransportError(err));
    return false;
  }
}

function resetUserQuery(email) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({ email: { $regex: `^${escapedEmail}$`, $options: 'i' } }).select(RESET_FIELDS);
}

function resendCooldownSeconds(user) {
  if (!user.passwordResetOtpSentAt) return 0;
  return Math.max(0, Math.ceil((user.passwordResetOtpSentAt.getTime() + RESET_OTP_COOLDOWN_MS - Date.now()) / 1000));
}

function createGoogleOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    throw new Error('Google OAuth environment variables are not configured.');
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL);
}

function googleStateMac(payload) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required to protect Google OAuth state.');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex');
}

function createGoogleState(mode) {
  const payload = `${mode}.${Date.now()}.${crypto.randomBytes(24).toString('hex')}`;
  return `${payload}.${googleStateMac(payload)}`;
}

function requestCookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function validateGoogleState(state, cookieState) {
  if (typeof state !== 'string' || !cookieState) return null;
  const stateBuffer = Buffer.from(state);
  const cookieBuffer = Buffer.from(cookieState);
  if (stateBuffer.length !== cookieBuffer.length || !crypto.timingSafeEqual(stateBuffer, cookieBuffer)) return null;

  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [mode, timestampValue, nonce, signature] = parts;
  const timestamp = Number(timestampValue);
  if (!['login', 'signup'].includes(mode) || !Number.isFinite(timestamp) || !/^[a-f0-9]{48}$/.test(nonce)) return null;
  if (Date.now() - timestamp < 0 || Date.now() - timestamp > GOOGLE_STATE_TTL_MS) return null;

  const expectedSignature = Buffer.from(googleStateMac(parts.slice(0, 3).join('.')), 'hex');
  const providedSignature = Buffer.from(signature, 'hex');
  if (expectedSignature.length !== providedSignature.length || !crypto.timingSafeEqual(expectedSignature, providedSignature)) return null;
  return mode;
}

function setGoogleStateCookie(res, state, clear = false) {
  const cookieParts = [
    `${GOOGLE_STATE_COOKIE}=${clear ? '' : encodeURIComponent(state)}`,
    'Path=/api/auth/google/callback',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : GOOGLE_STATE_TTL_MS / 1000}`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function frontendLoginUrl(query = {}) {
  const url = new URL('/pages/login.html', process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500');
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function redirectGoogleError(res, error) {
  setGoogleStateCookie(res, '', true);
  return res.redirect(frontendLoginUrl({ googleError: error }).toString());
}

function redirectGoogleNotice(res, notice) {
  setGoogleStateCookie(res, '', true);
  return res.redirect(frontendLoginUrl({ googleNotice: notice }).toString());
}

function googleEmailQuery(email) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { email: { $regex: `^${escapedEmail}$`, $options: 'i' } };
}

async function findGoogleUser(googleId, email) {
  const googleUser = await User.findOne({ googleId });
  if (googleUser) return { user: googleUser, matchedByGoogleId: true };
  return { user: await User.findOne(googleEmailQuery(email)), matchedByGoogleId: false };
}

async function redirectWithGoogleHandoff(user, res, notice) {
  const code = crypto.randomBytes(32).toString('hex');
  user.googleLoginCodeHash = crypto.createHash('sha256').update(code).digest('hex');
  user.googleLoginCodeExpires = new Date(Date.now() + GOOGLE_HANDOFF_TTL_MS);
  await user.save();

  const url = frontendLoginUrl({ googleCode: code });
  if (notice) url.searchParams.set('googleNotice', notice);
  setGoogleStateCookie(res, '', true);
  return res.redirect(url.toString());
}

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
    avatar: user.avatar,
  };
}

// POST /api/auth/signup  (admin or parent self-signup; teachers are added by an admin)
exports.signup = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    const normalizedEmail = resetEmail(email);
    if (!name || !normalizedEmail || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password and role are required.' });
    }
    if (!isValidEmail(normalizedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (!['admin', 'parent'].includes(role)) {
      return res.status(400).json({ message: 'Only admin and parent accounts can self-register. Ask an admin to create a teacher account.' });
    }
    const exists = await User.findOne(googleEmailQuery(normalizedEmail));
    if (exists) return res.status(409).json({ message: 'An account with that email already exists.' });

    const user = await User.create({ name, email: normalizedEmail, password, role, phone });
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
    const normalizedEmail = resetEmail(email);
    if (!isValidEmail(normalizedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' });

    const user = await User.findOne(googleEmailQuery(normalizedEmail)).select('+password');
    if (user && !user.password && user.googleId) {
      return res.status(401).json({ message: 'This account uses Google sign-in.' });
    }
    if (!user || !user.password || !(await user.comparePassword(password))) {
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
    const email = resetEmail(req.body.email);
    if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });

    const user = await resetUserQuery(email);
    if (!user) return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });

    const resendAfter = resendCooldownSeconds(user);
    if (resendAfter > 0) {
      return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
    }

    if (!(await issueResetOtp(user))) {
      return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
    }
    res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[auth] password reset request failed:', err);
    res.status(500).json({ message: 'Could not process request.' });
  }
};

// POST /api/auth/resend-reset-otp
exports.resendResetOtp = async (req, res) => {
  try {
    const email = resetEmail(req.body.email);
    if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });

    const user = await resetUserQuery(email);
    if (!user) return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });

    const resendAfter = resendCooldownSeconds(user);
    if (resendAfter > 0) {
      return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
    }

    if (!(await issueResetOtp(user))) {
      return res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
    }
    res.json({ message: RESET_GENERIC_MESSAGE, resendAfter: 60 });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[auth] password reset resend failed:', err);
    res.status(500).json({ message: 'Could not process request.' });
  }
};

// POST /api/auth/verify-reset-otp
exports.verifyResetOtp = async (req, res) => {
  try {
    const email = resetEmail(req.body.email);
    if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });

    const otp = req.body.otp;
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'OTP must be exactly 6 digits.' });
    }

    const user = await resetUserQuery(email);
    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpires) {
      return res.status(400).json({ message: INVALID_RESET_OTP_MESSAGE });
    }
    if (user.passwordResetOtpExpires.getTime() <= Date.now()) {
      clearResetOtp(user);
      await user.save();
      return res.status(400).json({ message: INVALID_RESET_OTP_MESSAGE });
    }

    if ((user.passwordResetOtpAttempts || 0) >= 5) {
      clearResetOtp(user);
      await user.save();
      return res.status(400).json({ message: INVALID_RESET_OTP_MESSAGE });
    }

    const isCorrect = await bcrypt.compare(otp, user.passwordResetOtpHash);
    if (!isCorrect) {
      user.passwordResetOtpAttempts = (user.passwordResetOtpAttempts || 0) + 1;
      if (user.passwordResetOtpAttempts >= 5) {
        clearResetOtp(user);
        await user.save();
        return res.status(400).json({ message: INVALID_RESET_OTP_MESSAGE });
      }
      await user.save();
      return res.status(400).json({ message: INVALID_RESET_OTP_MESSAGE });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    clearResetOtp(user);
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();
    res.json({ resetToken });
  } catch (err) {
    console.error('[auth] OTP verification failed:', err.message);
    res.status(500).json({ message: 'Could not verify OTP.' });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken } = req.body;
    const newPassword = req.body.password || req.body.newPassword;
    if (typeof resetToken !== 'string' || !resetToken || !newPassword) {
      return res.status(400).json({ message: 'Reset session and new password are required.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const hashed = crypto.createHash('sha256').update(resetToken).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) return res.status(400).json({ message: 'Reset session is invalid or has expired. Please request a new OTP.' });

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    clearResetOtp(user);
    await user.save();
    await logActivity(user._id, 'password-reset');

    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('[auth] password reset failed:', err.message);
    res.status(500).json({ message: 'Could not reset password.' });
  }
};

// GET /api/auth/google?mode=login|signup
exports.googleStart = async (req, res) => {
  const mode = req.query.mode;
  if (!['login', 'signup'].includes(mode)) return redirectGoogleError(res, 'invalid-mode');

  try {
    const state = createGoogleState(mode);
    const authorizationUrl = createGoogleOAuthClient().generateAuthUrl({
      access_type: 'online',
      scope: ['profile', 'email'],
      state,
    });
    setGoogleStateCookie(res, state);
    res.redirect(authorizationUrl);
  } catch (err) {
    console.error('[Google OAuth configuration error]:', err.message);
    redirectGoogleError(res, 'configuration');
  }
};

// GET /api/auth/google/callback
exports.googleCallback = async (req, res) => {
  let mode;
  try {
    mode = validateGoogleState(req.query.state, requestCookie(req, GOOGLE_STATE_COOKIE));
  } catch (err) {
    return redirectGoogleError(res, 'invalid-state');
  }
  if (!mode) return redirectGoogleError(res, 'invalid-state');
  setGoogleStateCookie(res, '', true);

  if (req.query.error) {
    return redirectGoogleError(res, req.query.error === 'access_denied' ? 'cancelled' : 'failed');
  }
  if (typeof req.query.code !== 'string') return redirectGoogleError(res, 'failed');

  try {
    const googleClient = createGoogleOAuthClient();
    const { tokens } = await googleClient.getToken(req.query.code);
    googleClient.setCredentials(tokens);
    const { data: profile } = await googleClient.request({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });

    const email = resetEmail(profile.email);
    const googleId = profile.id ? String(profile.id) : '';
    const emailVerified = profile.email_verified === true || profile.verified_email === true;
    if (!emailVerified || !isValidEmail(email) || !googleId) return redirectGoogleError(res, 'unverified');

    let { user, matchedByGoogleId } = await findGoogleUser(googleId, email);
    if (!user && mode === 'login') return redirectGoogleError(res, 'no-account');

    if (!user) {
      try {
        user = await User.create({
          name: profile.name || profile.given_name || email.split('@')[0],
          email,
          googleId,
          avatar: typeof profile.picture === 'string' && profile.picture.startsWith('https://') ? profile.picture : null,
          emailVerified: true,
          role: 'parent',
          status: 'pending',
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
        ({ user, matchedByGoogleId } = await findGoogleUser(googleId, email));
        if (!user) throw err;
      }

      if (user.status === 'pending') {
        await logActivity(user._id, 'signup', 'Google parent account created; pending admin approval');
        return redirectGoogleNotice(res, 'approval');
      }
    }

    if (!matchedByGoogleId && user.googleId && user.googleId !== googleId) {
      return redirectGoogleError(res, 'linked-account');
    }

    if (!user.googleId) user.googleId = googleId;
    if (resetEmail(user.email) === email) user.emailVerified = true;
    if (typeof profile.picture === 'string' && profile.picture.startsWith('https://')) user.avatar = profile.picture;
    await user.save();

    if (user.status === 'archived') return redirectGoogleError(res, 'archived');
    if (user.status === 'pending') return redirectGoogleNotice(res, 'approval');

    await redirectWithGoogleHandoff(user, res, mode === 'signup' ? 'account-exists' : '');
  } catch (err) {
    redirectGoogleError(res, 'failed');
  }
};

// POST /api/auth/google/exchange
exports.googleExchange = async (req, res) => {
  try {
    const { code } = req.body;
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
      return res.status(400).json({ message: 'Google sign-in session is invalid or expired.' });
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const user = await User.findOneAndUpdate(
      { googleLoginCodeHash: codeHash, googleLoginCodeExpires: { $gt: new Date() } },
      { $unset: { googleLoginCodeHash: 1, googleLoginCodeExpires: 1 } },
      { new: true }
    );
    if (!user) return res.status(401).json({ message: 'Google sign-in session is invalid or expired.' });
    if (user.status === 'pending') return res.status(403).json({ message: 'Your account is awaiting admin approval.' });
    if (user.status === 'archived') return res.status(403).json({ message: 'This account has been archived.' });

    const token = signToken(user);
    await logActivity(user._id, 'login', 'Google sign-in');
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Could not complete Google sign-in.' });
  }
};
