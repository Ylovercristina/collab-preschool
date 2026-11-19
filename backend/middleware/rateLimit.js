const crypto = require('crypto');

// ---------------------------------------------------------------------------------------------
// Rate limiting (in memory, no extra dependency).
// Each limiter counts requests per key (signed-in session, IP address, or IP + email) in a fixed
// time window. Over the limit, the request is refused with 429 and a Retry-After header.
// Counters live in this server process; behind several servers, use a shared store instead.
// ---------------------------------------------------------------------------------------------

const stores = [];

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Signed-in requests are counted per session token (so a whole school behind one Wi-Fi address
// does not share one budget); everything else per IP address.
function sessionOrIp(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return `t:${crypto.createHash('sha256').update(header.slice(7)).digest('hex').slice(0, 32)}`;
  }
  return `ip:${clientIp(req)}`;
}

function ipAndEmail(req) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  return `ip:${clientIp(req)}|${email}`;
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function rateLimit({ name, windowMs, max, key = sessionOrIp, skip, message }) {
  const hits = new Map(); // key -> { count, resetAt }
  stores.push(hits);
  return (req, res, next) => {
    if (skip && skip(req)) return next();
    const now = Date.now();
    const id = `${name}:${key(req)}`;
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));
    if (entry.count > max) {
      const wait = entry.resetAt - now;
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      if (entry.count === max + 1) console.warn(`[rate-limit] ${name} limit reached for ${id.replace(/\|.*/, '|…')}`);
      return res.status(429).json({
        code: 'RATE_LIMITED',
        retryAfterSeconds: Math.ceil(wait / 1000),
        message: `${message || 'Too many requests.'} Please wait ${formatWait(wait)} and try again.`,
      });
    }
    return next();
  };
}

// Drop expired counters every minute so memory stays small.
setInterval(() => {
  const now = Date.now();
  stores.forEach((hits) => {
    hits.forEach((entry, id) => { if (entry.resetAt <= now) hits.delete(id); });
  });
}, 60 * 1000).unref();

const MINUTE = 60 * 1000;
const isWrite = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

const limits = {
  // Everything under /api. Dashboards poll every few seconds, so this is generous per session.
  api: rateLimit({ name: 'api', windowMs: 5 * MINUTE, max: 1500, message: 'Too many requests from this session.' }),
  // Saves, uploads, deletions.
  writes: rateLimit({ name: 'writes', windowMs: MINUTE, max: 120, skip: (req) => !isWrite(req), message: 'Too many changes in a short time.' }),
  // Password guessing: per IP + email, plus a ceiling per IP across all emails.
  login: rateLimit({ name: 'login', windowMs: 15 * MINUTE, max: 10, key: ipAndEmail, message: 'Too many sign-in attempts for this account.' }),
  loginIp: rateLimit({ name: 'login-ip', windowMs: 15 * MINUTE, max: 50, key: (req) => `ip:${clientIp(req)}`, message: 'Too many sign-in attempts from this network.' }),
  signup: rateLimit({ name: 'signup', windowMs: 60 * MINUTE, max: 10, key: (req) => `ip:${clientIp(req)}`, message: 'Too many accounts created from this network.' }),
  // OTP / password reset codes (each sends an email).
  passwordReset: rateLimit({ name: 'password-reset', windowMs: 15 * MINUTE, max: 8, key: ipAndEmail, message: 'Too many password reset attempts.' }),
  googleSignIn: rateLimit({ name: 'google', windowMs: 15 * MINUTE, max: 30, key: (req) => `ip:${clientIp(req)}`, message: 'Too many Google sign-in attempts.' }),
  integrationCode: rateLimit({ name: 'integration-code', windowMs: 15 * MINUTE, max: 10, message: 'Too many verification attempts.' }),
  // Heavy operations.
  backups: rateLimit({ name: 'backups', windowMs: 60 * MINUTE, max: 20, skip: (req) => !isWrite(req), message: 'Too many backup or restore operations.' }),
  emailBlast: rateLimit({ name: 'email-blast', windowMs: 15 * MINUTE, max: 10, message: 'Too many reminder emails sent.' }),
};

module.exports = { rateLimit, limits, clientIp };
