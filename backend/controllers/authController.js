
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const AuthSettings = require('../models/AuthSettings');
const GoogleOAuthClient = require('../models/GoogleOAuthClient');
const RecaptchaClient = require('../models/RecaptchaClient');
const googleOAuthClients = require('../services/googleOAuthClients');
const recaptchaClients = require('../services/recaptchaClients');
const logActivity = require('../utils/logActivity');
const { sendEmail, verifyEmailTransport, emailTransportError } = require('../services/emailService');

const RESET_OTP_TTL_MS = 5 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESET_GENERIC_MESSAGE = 'If this email is registered, we will send a reset code. If it does not arrive, try again later.';
const INVALID_RESET_OTP_MESSAGE = 'OTP is incorrect, expired, or no longer valid. Please request a new OTP.';
const RESET_FIELDS = '+passwordResetOtpHash +passwordResetOtpExpires +passwordResetOtpAttempts +passwordResetOtpSentAt +resetPasswordToken +resetPasswordExpires';
const GOOGLE_STATE_COOKIE = 'play_google_oauth_state';
const GOOGLE_CAPTCHA_COOKIE = 'play_google_captcha';
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_HANDOFF_TTL_MS = 2 * 60 * 1000;
const GOOGLE_CAPTCHA_TTL_MS = 10 * 60 * 1000;
const INTEGRATION_OTP_TTL_MS = 5 * 60 * 1000;
const INTEGRATION_OTP_COOLDOWN_MS = 60 * 1000;
const INTEGRATION_OTP_MAX_ATTEMPTS = 5;
const INTEGRATION_OTP_LOCK_MS = 15 * 60 * 1000;
const INTEGRATION_ACCESS_TTL = '30m';
const INTEGRATION_PIN_CHALLENGE_TTL = '2m';
const INTEGRATION_SAVE_TTL = '5m';
const INTEGRATION_OTP_FIELDS = '+integrationOtpHash +integrationOtpExpires +integrationOtpAttempts +integrationOtpSentAt +integrationOtpPurpose +integrationOtpLockedUntil +integrationPinChallengeHash +integrationPinChallengeExpires +integrationPinAttempts +integrationPinLockedUntil +integrationSaveGrantHash +integrationSaveGrantExpires';
const INVALID_INTEGRATION_OTP_MESSAGE = 'The code is incorrect, expired, or no longer valid. Request a new code.';
const DEFAULT_AUTH_SETTINGS = {
  googleAuthEnabled: true,
  captchaEnabled: true,
  activeGoogleOAuthClientId: googleOAuthClients.DEFAULT_CLIENT_ID,
  activeRecaptchaClientId: recaptchaClients.DEFAULT_CLIENT_ID,
};
function logResetDebug(...args) {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
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
  const result = await sendEmail({
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
  if (!result.success) throw new Error(result.error);
}

exports.verifyEmailTransport = verifyEmailTransport;
exports.emailTransportError = emailTransportError;


exports.sendAccountApprovalEmail = async (user) => {
  const name = String(user.name || 'there');
  const role = String(user.role || 'user');
  const signInInstructions = user.googleId
    ? 'Sign in using the Google account linked to this email address. If you also registered a password, you can sign in with your email address and password.'
    : 'Sign in using your registered email address and password.';
  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const result = await sendEmail({
    to: user.email,
    subject: 'Your Play-is-School account has been approved!',
    text: `Hello ${name},

Good news! Your Play-is-School ${role} account has been approved by the school administrator.

${signInInstructions}

Thank you for joining Play-is-School!`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.6">
        <h2 style="color:#287a62">Play-is-School</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Good news! Your Play-is-School ${escapeHtml(role)} account has been approved by the school administrator.</p>
        <p>${escapeHtml(signInInstructions)}</p>
        <p>Thank you for joining Play-is-School!</p>
      </div>`,
  });
  if (!result.success) throw new Error(result.error || 'Email delivery failed.');
};

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

function activeGoogleOAuthClientId(settings) {
  return settings.activeGoogleOAuthClientId
    || (settings.customGoogleClientEnabled ? googleOAuthClients.ENV_CUSTOM_CLIENT_ID : googleOAuthClients.DEFAULT_CLIENT_ID);
}

function activeRecaptchaClientId(settings) {
  return settings.activeRecaptchaClientId || recaptchaClients.DEFAULT_CLIENT_ID;
}

async function createGoogleOAuthClient(selectionId, settings) {
  const credentials = await googleOAuthClients.resolveClient(selectionId, settings);
  const callbackUrl = credentials.callbackUrl || String(process.env.GOOGLE_CALLBACK_URL || '').trim();
  if (!callbackUrl) throw new Error('GOOGLE_CALLBACK_URL is not configured.');
  return new OAuth2Client(credentials.clientId, credentials.clientSecret, callbackUrl);
}

// Used when starting Google sign-in: falls back to the .env clients if the selected one is
// rejected by Google. The chosen selection ID travels in the OAuth state so the callback
// exchanges the code with the same client.
async function selectGoogleOAuthClient(settings) {
  const credentials = await googleOAuthClients.resolveUsableClient(activeGoogleOAuthClientId(settings), settings);
  const callbackUrl = credentials.callbackUrl || String(process.env.GOOGLE_CALLBACK_URL || '').trim();
  if (!callbackUrl) throw new Error('GOOGLE_CALLBACK_URL is not configured.');
  return {
    clientSelectionId: credentials.selectionId,
    googleClient: new OAuth2Client(credentials.clientId, credentials.clientSecret, callbackUrl),
  };
}

async function loadAuthSettings() {
  return AuthSettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global', ...DEFAULT_AUTH_SETTINGS } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function authSettingsPayload(settings) {
  return {
    googleAuthEnabled: settings.googleAuthEnabled === true,
    captchaEnabled: settings.captchaEnabled === true,
    activeGoogleOAuthClientId: activeGoogleOAuthClientId(settings),
    activeRecaptchaClientId: activeRecaptchaClientId(settings),
    captchaConfigured: await recaptchaClients.isConfigured(activeRecaptchaClientId(settings)),
  };
}

function createCaptchaGate() {
  const payload = `${Date.now()}.${crypto.randomBytes(24).toString('hex')}`;
  return `${payload}.${googleStateMac(payload)}`;
}

function validateCaptchaGate(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [timestampValue, nonce, signature] = parts;
  const timestamp = Number(timestampValue);
  if (!Number.isFinite(timestamp) || !/^[a-f0-9]{48}$/.test(nonce)) return false;
  if (Date.now() - timestamp < 0 || Date.now() - timestamp > GOOGLE_CAPTCHA_TTL_MS) return false;
  const expectedSignature = Buffer.from(googleStateMac(`${timestampValue}.${nonce}`), 'hex');
  const providedSignature = Buffer.from(signature, 'hex');
  return expectedSignature.length === providedSignature.length
    && crypto.timingSafeEqual(expectedSignature, providedSignature);
}

function setCaptchaGateCookie(res, value, clear = false) {
  const cookieParts = [
    `${GOOGLE_CAPTCHA_COOKIE}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/api/auth/google',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : GOOGLE_CAPTCHA_TTL_MS / 1000}`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
  res.append('Set-Cookie', cookieParts.join('; '));
}

async function verifyRecaptchaToken(token, remoteIp, selectionId) {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'missing' };

  const credentials = await recaptchaClients.resolveClient(selectionId);
  const params = new URLSearchParams({ secret: credentials.secretKey, response: token.trim() });
  if (remoteIp) params.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!response.ok) return { ok: false, reason: 'verification' };
    const result = await response.json();
    const hostnameAllowed = !credentials.allowedHostnames.length
      || credentials.allowedHostnames.includes(String(result.hostname || '').toLowerCase());
    return result.success && hostnameAllowed
      ? { ok: true }
      : { ok: false, reason: 'invalid' };
  } catch (err) {
    console.error('[CAPTCHA verification error]:', err.message);
    return { ok: false, reason: 'verification' };
  }
}

function googleStateMac(payload) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required to protect Google OAuth state.');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex');
}

function createGoogleState(mode, clientSelectionId) {
  const payload = `${mode}.${clientSelectionId}.${Date.now()}.${crypto.randomBytes(24).toString('hex')}`;
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
  if (parts.length === 4) {
    const [mode, timestampValue, nonce, signature] = parts;
    const timestamp = Number(timestampValue);
    if (!['login', 'signup'].includes(mode) || !Number.isFinite(timestamp)
      || !/^[a-f0-9]{48}$/.test(nonce)
      || Date.now() - timestamp < 0
      || Date.now() - timestamp > GOOGLE_STATE_TTL_MS) return null;
    const expectedSignature = Buffer.from(googleStateMac(parts.slice(0, 3).join('.')), 'hex');
    const providedSignature = Buffer.from(signature, 'hex');
    if (expectedSignature.length !== providedSignature.length
      || !crypto.timingSafeEqual(expectedSignature, providedSignature)) return null;
    return { mode, clientSelectionId: null };
  }
  if (parts.length !== 5) return null;
  const [mode, clientSelectionId, timestampValue, nonce, signature] = parts;
  const timestamp = Number(timestampValue);
  if (!['login', 'signup'].includes(mode)
    || !/^(default|env-custom|[a-f\d]{24})$/i.test(clientSelectionId)
    || !Number.isFinite(timestamp)
    || !/^[a-f0-9]{48}$/.test(nonce)) return null;
  if (Date.now() - timestamp < 0 || Date.now() - timestamp > GOOGLE_STATE_TTL_MS) return null;

  const expectedSignature = Buffer.from(googleStateMac(parts.slice(0, 4).join('.')), 'hex');
  const providedSignature = Buffer.from(signature, 'hex');
  if (expectedSignature.length !== providedSignature.length || !crypto.timingSafeEqual(expectedSignature, providedSignature)) return null;
  return { mode, clientSelectionId };
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
  const url = new URL(
    '/frontend/pages/login.html',
    process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500'
  );

  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

function redirectGoogleError(res, error) {
  setGoogleStateCookie(res, '', true);
  setCaptchaGateCookie(res, '', true);
  return res.redirect(frontendLoginUrl({ googleError: error }).toString());
}

function redirectGoogleNotice(res, notice) {
  setGoogleStateCookie(res, '', true);
  setCaptchaGateCookie(res, '', true);
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

async function redirectWithGoogleHandoff(user, res, notice, mode, captchaVerified) {
  const code = crypto.randomBytes(32).toString('hex');
  user.googleLoginCodeHash = crypto.createHash('sha256').update(code).digest('hex');
  user.googleLoginCodeExpires = new Date(Date.now() + GOOGLE_HANDOFF_TTL_MS);
  user.googleLoginMode = mode;
  user.googleLoginCaptchaVerified = captchaVerified === true;
  await user.save();

  const url = frontendLoginUrl({ googleCode: code });
  if (notice) url.searchParams.set('googleNotice', notice);
  setGoogleStateCookie(res, '', true);
  setCaptchaGateCookie(res, '', true);
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

// GET /api/auth/settings
exports.getAuthSettings = async (req, res) => {
  try {
    const settings = await loadAuthSettings();
    res.json({ settings: await authSettingsPayload(settings) });
  } catch (err) {
    console.error('[auth] Could not load authentication settings:', err.message);
    res.status(503).json({ message: 'Authentication settings are temporarily unavailable.' });
  }
};

function integrationOtpEmail() {
  return String(process.env.super_user_email || process.env.SUPER_USER_EMAIL || process.env.SU_EMAIL || '').trim().toLowerCase();
}

function clearIntegrationOtp(user) {
  user.integrationOtpHash = undefined;
  user.integrationOtpExpires = undefined;
  user.integrationOtpPurpose = undefined;
}

exports.requestIntegrationOtp = async (req, res) => {
  const purpose = req.body?.purpose;
  if (!['access', 'save'].includes(purpose)) {
    return res.status(400).json({ message: 'Choose a valid integration verification action.' });
  }
  const email = integrationOtpEmail();
  if (!isValidEmail(email)) {
    return res.status(503).json({ message: 'The integration verification email is not configured.' });
  }

  try {
    const user = await User.findById(req.user._id).select(INTEGRATION_OTP_FIELDS);
    if (!user) return res.status(401).json({ message: 'Account no longer exists.' });
    const now = new Date();
    if (user.integrationOtpLockedUntil && user.integrationOtpLockedUntil.getTime() > now.getTime()) {
      return res.status(429).json({ message: 'Too many incorrect codes. Please try again later.' });
    }
    if (purpose === 'access' && user.integrationPinLockedUntil && user.integrationPinLockedUntil.getTime() > now.getTime()) {
      return res.status(429).json({ message: 'Too many incorrect PIN attempts. Please try again later.' });
    }
    if (user.integrationOtpSentAt) {
      const resendAfter = Math.ceil((user.integrationOtpSentAt.getTime() + INTEGRATION_OTP_COOLDOWN_MS - now.getTime()) / 1000);
      if (resendAfter > 0) return res.status(429).json({ message: `Wait ${resendAfter} seconds before requesting another code.` });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    user.integrationOtpHash = await bcrypt.hash(otp, 10);
    user.integrationOtpExpires = new Date(now.getTime() + INTEGRATION_OTP_TTL_MS);
    user.integrationOtpAttempts = 0;
    user.integrationOtpSentAt = now;
    user.integrationOtpPurpose = purpose;
    user.integrationPinChallengeHash = undefined;
    user.integrationPinChallengeExpires = undefined;
    user.integrationPinAttempts = 0;
    await user.save();

    const result = await sendEmail({
      to: email,
      subject: 'Your Play-is-School integration verification code',
      text: `Your verification code is ${otp}. It expires in 5 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.5"><h2 style="color:#287a62">Play-is-School</h2><p>Use this code to verify ${purpose === 'save' ? 'your settings change' : 'access to integration settings'}:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#174f42">${otp}</p><p>This code expires in <strong>5 minutes</strong> and can only be used once.</p><p style="font-size:13px;color:#64748b">Never share this code. If you did not request it, ignore this email.</p></div>`,
    });
    if (!result.success) throw new Error(result.error || 'Email delivery failed.');

    res.set('Cache-Control', 'no-store').json({ message: 'A verification code has been sent to the configured email address.', expiresInSeconds: 300 });
  } catch (err) {
    try {
      await User.updateOne({ _id: req.user._id }, {
        $unset: { integrationOtpHash: 1, integrationOtpExpires: 1, integrationOtpPurpose: 1 },
        $set: { integrationOtpSentAt: null, integrationOtpAttempts: 0 },
      });
    } catch (clearError) {
      console.error('[auth] Could not clear integration OTP after email failure:', clearError.message);
    }
    console.error('[auth] Integration verification email failed:', emailTransportError(err));
    res.status(503).json({ message: 'Could not send the integration verification code.' });
  }
};

exports.verifyIntegrationOtp = async (req, res) => {
  const purpose = req.body?.purpose;
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!['access', 'save'].includes(purpose) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: 'Enter the six-digit verification code.' });
  }

  try {
    const user = await User.findById(req.user._id).select(INTEGRATION_OTP_FIELDS);
    if (!user) return res.status(401).json({ message: 'Account no longer exists.' });
    const now = new Date();
    if (user.integrationOtpLockedUntil && user.integrationOtpLockedUntil.getTime() > now.getTime()) {
      return res.status(429).json({ message: 'Too many incorrect codes. Please try again later.' });
    }
    if (user.integrationOtpPurpose !== purpose || !user.integrationOtpHash || !user.integrationOtpExpires
      || user.integrationOtpExpires.getTime() <= now.getTime()) {
      if (user.integrationOtpExpires && user.integrationOtpExpires.getTime() <= now.getTime()) {
        clearIntegrationOtp(user);
        await user.save();
      }
      return res.status(400).json({ message: INVALID_INTEGRATION_OTP_MESSAGE });
    }
    if ((user.integrationOtpAttempts || 0) >= INTEGRATION_OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect codes. Please request a new code later.' });
    }
    if (!await bcrypt.compare(otp, user.integrationOtpHash)) {
      const failedAttempt = await User.findOneAndUpdate(
        {
          _id: user._id,
          integrationOtpHash: user.integrationOtpHash,
          integrationOtpExpires: { $gt: now },
          integrationOtpPurpose: purpose,
          integrationOtpAttempts: { $lt: INTEGRATION_OTP_MAX_ATTEMPTS },
        },
        { $inc: { integrationOtpAttempts: 1 } },
        { new: true }
      ).select('+integrationOtpAttempts');
      if (!failedAttempt) return res.status(400).json({ message: INVALID_INTEGRATION_OTP_MESSAGE });
      if (failedAttempt.integrationOtpAttempts >= INTEGRATION_OTP_MAX_ATTEMPTS) {
        await User.updateOne(
          {
            _id: user._id,
            integrationOtpHash: user.integrationOtpHash,
            integrationOtpAttempts: { $gte: INTEGRATION_OTP_MAX_ATTEMPTS },
          },
          {
            $set: { integrationOtpLockedUntil: new Date(now.getTime() + INTEGRATION_OTP_LOCK_MS) },
            $unset: { integrationOtpHash: 1, integrationOtpExpires: 1, integrationOtpPurpose: 1 },
          }
        );
        return res.status(429).json({ message: 'Too many incorrect codes. Please try again later.' });
      }
      return res.status(400).json({ message: INVALID_INTEGRATION_OTP_MESSAGE });
    }

    if (!process.env.JWT_SECRET) {
      console.error('[auth] Cannot issue integration access without JWT_SECRET.');
      return res.status(503).json({ message: 'Integration verification is temporarily unavailable.' });
    }

    const consumed = await User.findOneAndUpdate(
      {
        _id: user._id,
        integrationOtpHash: user.integrationOtpHash,
        integrationOtpExpires: { $gt: now },
        integrationOtpPurpose: purpose,
        integrationOtpAttempts: { $lt: INTEGRATION_OTP_MAX_ATTEMPTS },
      },
      {
        $unset: { integrationOtpHash: 1, integrationOtpExpires: 1, integrationOtpPurpose: 1 },
        $set: { integrationOtpAttempts: 0, integrationOtpSentAt: null },
      },
      { new: false }
    );
    if (!consumed) return res.status(400).json({ message: INVALID_INTEGRATION_OTP_MESSAGE });

    const claims = { id: String(req.user._id), scope: 'settings:integrations', purpose };
    if (purpose === 'access') {
      claims.stage = 'email-verified';
      claims.jti = crypto.randomBytes(32).toString('hex');
    } else {
      claims.jti = crypto.randomBytes(32).toString('hex');
    }
    const accessToken = jwt.sign(claims, process.env.JWT_SECRET, {
      expiresIn: purpose === 'save' ? INTEGRATION_SAVE_TTL : INTEGRATION_PIN_CHALLENGE_TTL,
    });
    if (purpose === 'save') {
      const grantHash = crypto.createHash('sha256').update(claims.jti).digest('hex');
      const grantResult = await User.updateOne(
        { _id: req.user._id },
        { $set: { integrationSaveGrantHash: grantHash, integrationSaveGrantExpires: new Date(now.getTime() + 5 * 60 * 1000) } }
      );
      if (grantResult.matchedCount !== 1) {
        return res.status(401).json({ message: 'Account no longer exists.' });
      }
      return res.set('Cache-Control', 'no-store').json({
        accessToken,
        expiresInSeconds: 300,
      });
    }

    const challengeHash = crypto.createHash('sha256').update(claims.jti).digest('hex');
    const challengeResult = await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          integrationPinChallengeHash: challengeHash,
          integrationPinChallengeExpires: new Date(now.getTime() + 2 * 60 * 1000),
          integrationPinAttempts: 0,
        },
      }
    );
    if (challengeResult.matchedCount !== 1) {
      return res.status(401).json({ message: 'Account no longer exists.' });
    }
    res.set('Cache-Control', 'no-store').json({
      pinChallenge: accessToken,
      requiresPin: true,
      expiresInSeconds: 120,
    });
  } catch (err) {
    console.error('[auth] Integration verification failed:', err.message);
    res.status(503).json({ message: 'Could not verify the integration code.' });
  }
};

exports.verifyIntegrationPin = async (req, res) => {
  const configuredPin = String(process.env.SU_PIN || '').trim();
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
  const challengeToken = typeof req.body?.pinChallenge === 'string' ? req.body.pinChallenge : '';
  if (!configuredPin || configuredPin.length > 64) {
    return res.status(503).json({ message: 'The integration PIN is not configured.' });
  }
  if (!pin || pin.length > 64 || !challengeToken) {
    return res.status(400).json({ message: 'Enter the configured integration PIN.' });
  }
  if (!process.env.JWT_SECRET) {
    console.error('[auth] Cannot verify integration PIN without JWT_SECRET.');
    return res.status(503).json({ message: 'Integration verification is temporarily unavailable.' });
  }

  let challenge;
  try {
    challenge = jwt.verify(challengeToken, process.env.JWT_SECRET);
  } catch {
    return res.status(403).json({ message: 'Email verification expired. Request a new code.' });
  }
  if (challenge.scope !== 'settings:integrations' || challenge.purpose !== 'access'
    || challenge.stage !== 'email-verified' || challenge.id !== String(req.user._id)
    || typeof challenge.jti !== 'string') {
    return res.status(403).json({ message: 'Email verification is invalid. Request a new code.' });
  }

  try {
    const user = await User.findById(req.user._id).select(INTEGRATION_OTP_FIELDS);
    if (!user) return res.status(401).json({ message: 'Account no longer exists.' });
    const now = new Date();
    if (user.integrationPinLockedUntil && user.integrationPinLockedUntil.getTime() > now.getTime()) {
      return res.status(429).json({ message: 'Too many incorrect PIN attempts. Please try again later.' });
    }
    const challengeHash = crypto.createHash('sha256').update(challenge.jti).digest('hex');
    if (user.integrationPinChallengeHash !== challengeHash || !user.integrationPinChallengeExpires
      || user.integrationPinChallengeExpires.getTime() <= now.getTime()) {
      return res.status(403).json({ message: 'Email verification expired or was already used. Request a new code.' });
    }
    if ((user.integrationPinAttempts || 0) >= INTEGRATION_OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect PIN attempts. Please try again later.' });
    }

    const expected = Buffer.from(configuredPin);
    const supplied = Buffer.from(pin);
    const comparisonLength = Math.max(supplied.length, expected.length);
    const suppliedPadded = Buffer.alloc(comparisonLength);
    const expectedPadded = Buffer.alloc(comparisonLength);
    supplied.copy(suppliedPadded);
    expected.copy(expectedPadded);
    const pinMatches = crypto.timingSafeEqual(suppliedPadded, expectedPadded)
      && supplied.length === expected.length;
    if (!pinMatches) {
      const failedAttempt = await User.findOneAndUpdate(
        {
          _id: user._id,
          integrationPinChallengeHash: challengeHash,
          integrationPinChallengeExpires: { $gt: now },
          integrationPinAttempts: { $lt: INTEGRATION_OTP_MAX_ATTEMPTS },
        },
        { $inc: { integrationPinAttempts: 1 } },
        { new: true }
      ).select('+integrationPinAttempts');
      if (!failedAttempt) return res.status(403).json({ message: 'Email verification expired or was already used. Request a new code.' });
      if (failedAttempt.integrationPinAttempts >= INTEGRATION_OTP_MAX_ATTEMPTS) {
        await User.updateOne(
          {
            _id: user._id,
            integrationPinChallengeHash: challengeHash,
            integrationPinAttempts: { $gte: INTEGRATION_OTP_MAX_ATTEMPTS },
          },
          {
            $set: { integrationPinLockedUntil: new Date(now.getTime() + INTEGRATION_OTP_LOCK_MS) },
            $unset: { integrationPinChallengeHash: 1, integrationPinChallengeExpires: 1 },
          }
        );
        return res.status(429).json({ message: 'Too many incorrect PIN attempts. Please try again later.' });
      }
      return res.status(403).json({ message: 'The integration PIN is incorrect.' });
    }

    const consumedChallenge = await User.findOneAndUpdate(
      {
        _id: user._id,
        integrationPinChallengeHash: challengeHash,
        integrationPinChallengeExpires: { $gt: now },
        integrationPinAttempts: { $lt: INTEGRATION_OTP_MAX_ATTEMPTS },
      },
      {
        $unset: { integrationPinChallengeHash: 1, integrationPinChallengeExpires: 1 },
        $set: { integrationPinAttempts: 0 },
      },
      { new: false }
    );
    if (!consumedChallenge) return res.status(403).json({ message: 'Email verification expired or was already used. Request a new code.' });

    const accessToken = jwt.sign(
      { id: String(req.user._id), scope: 'settings:integrations', purpose: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: INTEGRATION_ACCESS_TTL }
    );
    res.set('Cache-Control', 'no-store').json({ accessToken, expiresInSeconds: 1800 });
  } catch (err) {
    console.error('[auth] Integration PIN verification failed:', err.message);
    res.status(503).json({ message: 'Could not verify the integration PIN.' });
  }
};

// Only tell the admin UI whether a custom configuration is active; never send the
// stored identifiers back to the browser.
function publicIntegrationStatus(config) {
  return { source: config.source, customConfigured: config.source === 'managed' };
}

exports.getGoogleOAuthConfig = async (req, res) => {
  try {
    const settings = await AuthSettings.findOne({ key: 'global' }) || DEFAULT_AUTH_SETTINGS;
    res.set('Cache-Control', 'no-store')
      .json({ config: publicIntegrationStatus(await googleOAuthClients.managementConfig(settings)) });
  } catch (err) {
    console.error('[auth] Could not load Google OAuth configuration:', err.message);
    res.status(503).json({ message: 'Could not load Google OAuth configuration.' });
  }
};

exports.getRecaptchaConfig = async (req, res) => {
  try {
    const settings = await AuthSettings.findOne({ key: 'global' }) || DEFAULT_AUTH_SETTINGS;
    res.set('Cache-Control', 'no-store')
      .json({ config: publicIntegrationStatus(await recaptchaClients.managementConfig(settings)) });
  } catch (err) {
    console.error('[auth] Could not load reCAPTCHA configuration:', err.message);
    res.status(503).json({ message: 'Could not load reCAPTCHA configuration.' });
  }
};

function recaptchaClientInput(body, { requireSecret = true } = {}) {
  const siteKey = typeof body.siteKey === 'string' ? body.siteKey.trim() : '';
  const secretKey = typeof body.secretKey === 'string' ? body.secretKey.trim() : '';
  if (!siteKey || siteKey.length > 256) throw new Error('Enter a reCAPTCHA site key of 1 to 256 characters.');
  if (requireSecret && !secretKey) throw new Error('Enter the reCAPTCHA secret key.');
  if (secretKey.length > 2048) throw new Error('The reCAPTCHA secret key is too long.');
  const allowedHostnames = Array.isArray(body.allowedHostnames)
    ? body.allowedHostnames
    : typeof body.allowedHostnames === 'string'
      ? body.allowedHostnames.split(',')
      : [];
  const normalizedHostnames = [...new Set(allowedHostnames.map((hostname) => String(hostname).trim().toLowerCase()).filter(Boolean))];
  if (!normalizedHostnames.length || normalizedHostnames.some((hostname) => (
    hostname.length > 253
    || !/^(localhost|(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*)$/.test(hostname)
  ))) {
    throw new Error('Enter comma-separated hostnames without URLs or ports.');
  }
  return { siteKey, secretKey, allowedHostnames: normalizedHostnames };
}

exports.saveRecaptchaClient = async (req, res) => {
  try {
    const settings = await loadAuthSettings();
    const currentConfig = await recaptchaClients.managementConfig(settings);
    const currentClient = recaptchaClients.MANAGED_CLIENT_ID_PATTERN.test(currentConfig.id)
      ? await RecaptchaClient.findById(currentConfig.id).select('+encryptedSecret')
      : null;
    const input = recaptchaClientInput(req.body || {}, { requireSecret: !currentClient });
    if (await recaptchaClients.findDuplicate(input.siteKey, currentClient && currentClient._id)) {
      return res.status(409).json({ message: 'That reCAPTCHA site key is already configured.' });
    }
    const client = currentClient || new RecaptchaClient({ label: 'Custom reCAPTCHA configuration' });
    client.siteKey = input.siteKey;
    client.normalizedSiteKey = input.siteKey.toLowerCase();
    client.allowedHostnames = input.allowedHostnames;
    if (input.secretKey) client.encryptedSecret = recaptchaClients.encryptSecret(input.secretKey);
    await client.save();
    await AuthSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { activeRecaptchaClientId: String(client._id) } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ config: publicIntegrationStatus(await recaptchaClients.managementConfig({ activeRecaptchaClientId: String(client._id) })) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That reCAPTCHA site key is already configured.' });
    if (err.name === 'ValidationError' || err.message.startsWith('Enter ') || err.message.startsWith('The reCAPTCHA')) {
      return res.status(400).json({ message: err.message });
    }
    console.error('[auth] Could not save reCAPTCHA configuration:', err.message);
    res.status(503).json({ message: 'Could not save reCAPTCHA configuration.' });
  }
};

function googleOAuthClientInput(body, { requireSecret = true } = {}) {
  // Tolerate common copy-paste artifacts: surrounding whitespace and a trailing period.
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim().replace(/\.+$/, '') : '';
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
  if (!googleOAuthClients.validClientId(clientId)) {
    if (!clientId) throw new Error('Enter the Google OAuth Client ID.');
    if (/\s/.test(clientId)) throw new Error('Enter the Google OAuth Client ID without spaces.');
    if (!/\.apps\.googleusercontent\.com$/i.test(clientId)) {
      throw new Error('Enter a Google OAuth Client ID ending in .apps.googleusercontent.com.');
    }
    if (!/^\d+-/.test(clientId)) {
      throw new Error('Enter the full Google OAuth Client ID. It must start with your project number and a dash, e.g. 123456789012-abc123.apps.googleusercontent.com. Copy it from Google Cloud Console > APIs & Services > Credentials.');
    }
    throw new Error('Enter a valid Google OAuth Client ID, e.g. 123456789012-abc123.apps.googleusercontent.com.');
  }
  if (requireSecret && !clientSecret) throw new Error('Enter the Google OAuth Client Secret.');
  if (clientSecret.length > 2048) throw new Error('Google OAuth Client Secret is too long.');
  return { clientId, clientSecret };
}

exports.saveGoogleOAuthClient = async (req, res) => {
  try {
    const settings = await loadAuthSettings();
    const currentConfig = await googleOAuthClients.managementConfig(settings);
    const currentClient = googleOAuthClients.MANAGED_CLIENT_ID_PATTERN.test(currentConfig.id)
      ? await GoogleOAuthClient.findById(currentConfig.id).select('+encryptedClientSecret')
      : null;
    const input = googleOAuthClientInput(req.body || {}, { requireSecret: !currentClient });
    // Blank callback => use the server's GOOGLE_CALLBACK_URL. Anything else must target the
    // backend sign-in callback route, or Google sign-in breaks (redirect_uri_mismatch).
    const enteredCallbackUrl = typeof req.body.callbackUrl === 'string' ? req.body.callbackUrl.trim() : '';
    const callbackUrl = (enteredCallbackUrl || googleOAuthClients.defaultCallbackUrl()).replace(/\/+$/, '');
    if (!googleOAuthClients.isSignInCallbackUrl(callbackUrl)) {
      const example = googleOAuthClients.defaultCallbackUrl()
        || `http://localhost:5000${googleOAuthClients.SIGN_IN_CALLBACK_PATH}`;
      return res.status(400).json({
        message: `The Google callback URL must point to the backend sign-in route (${googleOAuthClients.SIGN_IN_CALLBACK_PATH}), e.g. ${example}. Leave it blank to use the server default.`,
      });
    }
    if (await googleOAuthClients.findDuplicate(input.clientId, currentClient && currentClient._id)) {
      return res.status(409).json({ message: 'That Google OAuth Client ID is already configured.' });
    }
    // Check the credentials with Google before storing them, so a mistyped or autofilled
    // secret is rejected instead of silently breaking Google sign-in.
    const secretToCheck = input.clientSecret
      || (await googleOAuthClients.resolveClient(String(currentClient._id), settings)).clientSecret;
    const credentialStatus = await googleOAuthClients.checkCredentials({
      clientId: input.clientId,
      clientSecret: secretToCheck,
      callbackUrl,
    });
    if (credentialStatus === 'invalid') {
      return res.status(400).json({
        message: 'Google rejected this Client ID and Client Secret. Check both values in Google Cloud Console. Nothing was saved.',
      });
    }

    const client = currentClient || new GoogleOAuthClient({ label: 'Custom Google client' });
    client.clientId = input.clientId;
    client.normalizedClientId = input.clientId.toLowerCase();
    client.callbackUrl = callbackUrl;
    if (input.clientSecret) client.encryptedClientSecret = googleOAuthClients.encryptSecret(input.clientSecret);
    await client.save();
    await AuthSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: {
        activeGoogleOAuthClientId: String(client._id),
        customGoogleClientEnabled: true,
      } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ config: publicIntegrationStatus(await googleOAuthClients.managementConfig({ activeGoogleOAuthClientId: String(client._id) })) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That Google OAuth Client ID is already configured.' });
    if (err.name === 'ValidationError' || err.message.startsWith('Enter ') || err.message.startsWith('Google OAuth')) {
      return res.status(400).json({ message: err.message });
    }
    console.error('[auth] Could not save Google OAuth configuration:', err.message);
    res.status(503).json({ message: 'Could not save Google OAuth configuration.' });
  }
};

// PATCH /api/auth/settings (admin only)
exports.updateAuthSettings = async (req, res) => {
  const body = req.body || {};
  const { googleAuthEnabled, captchaEnabled } = body;
  if (typeof googleAuthEnabled !== 'boolean' || typeof captchaEnabled !== 'boolean') {
    return res.status(400).json({ message: 'Google Authentication and CAPTCHA values must be true or false.' });
  }

  try {
    const settings = await loadAuthSettings();
    const activeGoogleId = body.activeGoogleOAuthClientId
      || (typeof body.customGoogleClientEnabled === 'boolean'
        ? (body.customGoogleClientEnabled ? googleOAuthClients.ENV_CUSTOM_CLIENT_ID : googleOAuthClients.DEFAULT_CLIENT_ID)
        : activeGoogleOAuthClientId(settings));
    const activeRecaptchaId = body.activeRecaptchaClientId || activeRecaptchaClientId(settings);
    if (typeof activeGoogleId !== 'string' || activeGoogleId.length > 64
      || typeof activeRecaptchaId !== 'string' || activeRecaptchaId.length > 64) {
      return res.status(400).json({ message: 'Select a valid authentication configuration.' });
    }
    if (googleAuthEnabled) await googleOAuthClients.resolveClient(activeGoogleId, settings);
    if (captchaEnabled && !await recaptchaClients.isConfigured(activeRecaptchaId)) {
      return res.status(400).json({ message: 'CAPTCHA cannot be enabled until a site and secret key are configured.' });
    }

    const savedSettings = await AuthSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: {
        googleAuthEnabled,
        captchaEnabled,
        activeGoogleOAuthClientId: activeGoogleId,
        activeRecaptchaClientId: activeRecaptchaId,
        customGoogleClientEnabled: activeGoogleId !== googleOAuthClients.DEFAULT_CLIENT_ID,
      } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
    res.json({ message: 'Authentication security settings saved.', settings: await authSettingsPayload(savedSettings) });
  } catch (err) {
    console.error('[auth] Could not save authentication security settings:', err.message);
    res.status(503).json({ message: 'Could not save authentication security settings.' });
  }
};

// GET /api/auth/google?mode=login|signup
exports.googleStart = async (req, res) => {
  const mode = req.query.mode;
  if (!['login', 'signup'].includes(mode)) return redirectGoogleError(res, 'invalid-mode');

  let settings;
  try {
    settings = await loadAuthSettings();
  } catch (err) {
    return redirectGoogleError(res, 'configuration');
  }
  if (settings.googleAuthEnabled !== true) return redirectGoogleError(res, 'google-disabled');
  if (mode === 'login' && settings.captchaEnabled === true
    && !validateCaptchaGate(requestCookie(req, GOOGLE_CAPTCHA_COOKIE))) {
    return redirectGoogleError(res, 'captcha-required');
  }

  try {
    const { clientSelectionId, googleClient } = await selectGoogleOAuthClient(settings);
    const state = createGoogleState(mode, clientSelectionId);
    const authorizationUrl = googleClient.generateAuthUrl({
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

// GET /api/auth/recaptcha-config
exports.recaptchaConfig = async (req, res) => {
  try {
    const settings = await loadAuthSettings();
    const siteKey = await recaptchaClients.siteKey(activeRecaptchaClientId(settings));
    res.json({ siteKey });
  } catch (err) {
    console.error('[auth] Could not load active reCAPTCHA configuration:', err.message);
    res.status(503).json({ message: 'CAPTCHA is not configured.' });
  }
};

// POST /api/auth/google/start
exports.googleStartWithCaptcha = async (req, res) => {
  let settings;
  try {
    settings = await loadAuthSettings();
  } catch (err) {
    return res.status(503).json({ message: 'Authentication settings are temporarily unavailable.' });
  }
  if (settings.googleAuthEnabled !== true) {
    return res.status(403).json({ message: 'Google sign-in is currently disabled by the school administrator.' });
  }

  const captchaRequired = settings.captchaEnabled === true;
  let result = { ok: true };
  if (captchaRequired) {
    try {
      result = await verifyRecaptchaToken(
        req.body && req.body.token,
        req.ip,
        activeRecaptchaClientId(settings)
      );
    } catch (err) {
      console.error('[CAPTCHA configuration error]:', err.message);
      return res.status(503).json({ message: 'CAPTCHA is not configured. Please contact the school admin.' });
    }
  }
  if (!result.ok) {
    const messages = {
      configuration: 'CAPTCHA is not configured. Please contact the school admin.',
      missing: 'Please complete the CAPTCHA verification first.',
      invalid: 'CAPTCHA verification failed or expired. Please try again.',
      verification: 'CAPTCHA verification could not be completed. Please try again.',
    };
    return res.status(result.reason === 'configuration' ? 503 : 400)
      .json({ message: messages[result.reason] || messages.invalid });
  }
  if (req.body.mode !== 'login') {
    return res.status(400).json({ message: 'Google sign-in mode is invalid.' });
  }

  try {
    const { clientSelectionId, googleClient } = await selectGoogleOAuthClient(settings);
    const state = createGoogleState('login', clientSelectionId);
    const loginHint = typeof req.body.loginHint === 'string'
      ? resetEmail(req.body.loginHint)
      : '';
    const authorizationUrl = googleClient.generateAuthUrl({
      access_type: 'online',
      ...(isValidEmail(loginHint) ? { login_hint: loginHint } : {}),
      scope: ['profile', 'email'],
      state,
    });
    setGoogleStateCookie(res, state);
    if (captchaRequired) setCaptchaGateCookie(res, createCaptchaGate());
    res.json({ authorizationUrl });
  } catch (err) {
    console.error('[Google OAuth configuration error]:', err.message);
    res.status(503).json({ message: 'Google sign-in is not configured. Please contact the school admin.' });
  }
};

// GET /api/auth/google/callback
exports.googleCallback = async (req, res) => {
  let googleState;
  try {
    googleState = validateGoogleState(req.query.state, requestCookie(req, GOOGLE_STATE_COOKIE));
  } catch (err) {
    return redirectGoogleError(res, 'invalid-state');
  }
  if (!googleState) return redirectGoogleError(res, 'invalid-state');
  const { mode } = googleState;
  let settings;
  try {
    settings = await loadAuthSettings();
  } catch (err) {
    return redirectGoogleError(res, 'configuration');
  }
  if (settings.googleAuthEnabled !== true) return redirectGoogleError(res, 'google-disabled');
  const captchaRequired = mode === 'login' && settings.captchaEnabled === true;
  if (captchaRequired && !validateCaptchaGate(requestCookie(req, GOOGLE_CAPTCHA_COOKIE))) {
    return redirectGoogleError(res, 'captcha-required');
  }
  setGoogleStateCookie(res, '', true);

  if (req.query.error) {
    if (req.query.error !== 'access_denied') console.error('[auth] Google returned an error:', req.query.error);
    return redirectGoogleError(res, req.query.error === 'access_denied' ? 'cancelled' : 'failed');
  }
  if (typeof req.query.code !== 'string') {
    console.error('[auth] Google callback arrived without an authorization code.');
    return redirectGoogleError(res, 'failed');
  }

  try {
    const googleClient = await createGoogleOAuthClient(
      googleState.clientSelectionId || activeGoogleOAuthClientId(settings),
      settings
    );
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
          emailVerified: false,
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
    if (user.role === 'parent' && !user.emailVerifiedBy) user.emailVerified = false;
    if (typeof profile.picture === 'string' && profile.picture.startsWith('https://')) user.avatar = profile.picture;
    await user.save();

    if (user.status === 'archived') return redirectGoogleError(res, 'archived');
    if (user.status === 'pending') return redirectGoogleNotice(res, 'approval');

    await redirectWithGoogleHandoff(
      user,
      res,
      mode === 'signup' ? 'account-exists' : '',
      mode,
      captchaRequired
    );
  } catch (err) {
    const detail = err.response && err.response.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error('[auth] Google sign-in callback failed:', detail);
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

    const settings = await loadAuthSettings();
    if (settings.googleAuthEnabled !== true) {
      return res.status(403).json({ message: 'Google sign-in is currently disabled by the school administrator.' });
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const pendingUser = await User.findOne(
      { googleLoginCodeHash: codeHash, googleLoginCodeExpires: { $gt: new Date() } }
    ).select('+googleLoginMode +googleLoginCaptchaVerified');
    if (!pendingUser) return res.status(401).json({ message: 'Google sign-in session is invalid or expired.' });
    if (settings.captchaEnabled === true && pendingUser.googleLoginMode === 'login'
      && pendingUser.googleLoginCaptchaVerified !== true) {
      return res.status(403).json({ message: 'CAPTCHA verification is required. Please start Google sign-in again.' });
    }

    const user = await User.findOneAndUpdate(
      { googleLoginCodeHash: codeHash, googleLoginCodeExpires: { $gt: new Date() } },
      {
        $unset: {
          googleLoginCodeHash: 1,
          googleLoginCodeExpires: 1,
        },
      },
      { new: true }
    ).select('+googleLoginMode +googleLoginCaptchaVerified');
    if (!user) return res.status(401).json({ message: 'Google sign-in session is invalid or expired.' });
    user.googleLoginMode = undefined;
    user.googleLoginCaptchaVerified = undefined;
    await user.save();
    if (user.status === 'pending') return res.status(403).json({ message: 'Your account is awaiting admin approval.' });
    if (user.status === 'archived') return res.status(403).json({ message: 'This account has been archived.' });

    const token = signToken(user);
    await logActivity(user._id, 'login', 'Google sign-in');
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Could not complete Google sign-in.' });
  }
};
