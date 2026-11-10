const crypto = require('crypto');
const GoogleOAuthClient = require('../models/GoogleOAuthClient');
const credentialEncryption = require('./credentialEncryption');

const DEFAULT_CLIENT_ID = 'default';
const ENV_CUSTOM_CLIENT_ID = 'env-custom';
const CALENDAR_ENV_CLIENT_ID = 'calendar-env';
const DRIVE_ENV_CLIENT_ID = 'drive-env';
const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[A-Za-z0-9_-]+\.apps.googleusercontent.com$/;
const MANAGED_CLIENT_ID_PATTERN = /^[a-f\d]{24}$/i;

// Google must redirect sign-ins back to this backend route; any other URL (e.g. the
// frontend origin) breaks the flow with redirect_uri_mismatch or a lost auth code.
const SIGN_IN_CALLBACK_PATH = '/api/auth/google/callback';

function defaultCallbackUrl() {
  return String(process.env.GOOGLE_CALLBACK_URL || '').trim();
}

function isSignInCallbackUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol)
      && url.pathname.replace(/\/+$/, '') === SIGN_IN_CALLBACK_PATH;
  } catch {
    return false;
  }
}

// Uses the stored callback only when it targets the sign-in route; otherwise the .env one.
function signInCallbackUrl(stored) {
  return isSignInCallbackUrl(stored) ? String(stored).trim().replace(/\/+$/, '') : defaultCallbackUrl();
}

function validClientId(value) {
  return typeof value === 'string' && GOOGLE_CLIENT_ID_PATTERN.test(value.trim());
}

function envClient(selectionId, settings = {}) {
  const credentials = {
    [CALENDAR_ENV_CLIENT_ID]: ['Google Calendar client (.env)', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET'],
    [DRIVE_ENV_CLIENT_ID]: ['Google Drive client (.env)', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
    [DEFAULT_CLIENT_ID]: ['Default Google client (.env)', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    [ENV_CUSTOM_CLIENT_ID]: ['Custom Google client (.env)', 'CUSTOM_GOOGLE_CLIENT_ID', 'CUSTOM_GOOGLE_CLIENT_SECRET'],
  }[selectionId];
  if (!credentials) return null;
  const [label, clientIdEnv, clientSecretEnv] = credentials;
  return {
    selectionId,
    label,
    clientId: String(process.env[clientIdEnv] || (selectionId === ENV_CUSTOM_CLIENT_ID ? settings.customGoogleClientId : '') || '').trim(),
    clientSecret: String(process.env[clientSecretEnv] || '').trim(),
    callbackUrl: String(process.env.GOOGLE_CALLBACK_URL || '').trim(),
    source: 'environment',
  };
}

async function findDuplicate(clientId, excludeId) {
  const normalized = clientId.trim().toLowerCase();
  const query = { normalizedClientId: normalized };
  if (excludeId && MANAGED_CLIENT_ID_PATTERN.test(String(excludeId))) query._id = { $ne: excludeId };
  return Boolean(await GoogleOAuthClient.exists(query));
}

async function resolveClient(selectionId, settings = {}) {
  const environment = envClient(selectionId, settings);
  if (environment) {
    if (!environment.clientId || !environment.clientSecret) {
      throw new Error(`Configure the selected Google client credentials in backend/.env.`);
    }
    return environment;
  }
  if (!MANAGED_CLIENT_ID_PATTERN.test(String(selectionId))) {
    throw new Error('The selected Google OAuth client is invalid.');
  }
  const client = await GoogleOAuthClient.findById(selectionId).select('+encryptedClientSecret');
  if (!client) throw new Error('The selected Google OAuth client is no longer available.');
  return {
    selectionId: String(client._id),
    label: client.label,
    clientId: client.clientId,
    callbackUrl: signInCallbackUrl(client.callbackUrl),
    clientSecret: credentialEncryption.decryptSecret(
      client.encryptedClientSecret,
      'google-oauth-client',
      'Google OAuth client secret'
    ),
    source: 'managed',
  };
}

// ---------- Credential validation ----------
// Google's token endpoint checks the client ID/secret before the authorization code, so a
// dummy code tells us whether the credentials are usable without any user interaction:
// invalid_client => wrong ID/secret; invalid_grant => credentials accepted.
const CREDENTIAL_CHECK_TTL_MS = 10 * 60 * 1000;
const credentialChecks = new Map();

function credentialCacheKey({ clientId, clientSecret, callbackUrl }) {
  return crypto.createHash('sha256').update(`${clientId}\n${clientSecret}\n${callbackUrl}`).digest('hex');
}

// Returns 'valid', 'invalid', or 'unknown' (Google unreachable — not treated as invalid).
async function checkCredentials(credentials) {
  const key = credentialCacheKey(credentials);
  const cached = credentialChecks.get(key);
  if (cached && Date.now() - cached.at < CREDENTIAL_CHECK_TTL_MS) return cached.status;
  let status = 'unknown';
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code: 'credential-check',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: credentials.callbackUrl,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => ({}));
    if (['invalid_client', 'unauthorized_client'].includes(data.error)) status = 'invalid';
    else if (data.error === 'invalid_grant') status = 'valid';
  } catch (err) {
    console.error('[auth] Could not reach Google to validate OAuth credentials:', err.message);
  }
  if (status !== 'unknown') credentialChecks.set(key, { status, at: Date.now() });
  return status;
}

// Picks the Google client to sign in with: the admin-selected client when its credentials
// work, otherwise the .env custom client, otherwise the .env default client. Nothing is
// written anywhere — a bad custom secret can never replace the .env fallbacks.
async function resolveUsableClient(selectionId, settings = {}) {
  const candidates = [...new Set([selectionId, ENV_CUSTOM_CLIENT_ID, DEFAULT_CLIENT_ID])];
  let lastError = null;
  for (const candidate of candidates) {
    let credentials;
    try {
      credentials = await resolveClient(candidate, settings);
    } catch (err) {
      if (candidate === selectionId) console.error(`[auth] Google client "${candidate}" is unusable:`, err.message);
      lastError = err;
      continue;
    }
    const status = await checkCredentials(credentials);
    if (status !== 'invalid') {
      if (candidate !== selectionId) {
        console.warn(`[auth] Google client "${selectionId}" has invalid credentials; signing in with "${candidate}" instead.`);
      }
      return credentials;
    }
    console.error(`[auth] Google rejected the credentials of client "${candidate}" (${credentials.label}).`);
    lastError = new Error('Google rejected the configured client ID or secret.');
  }
  throw lastError || new Error('No usable Google OAuth client is configured.');
}

async function managementConfig(settings = {}) {
  const activeId = settings.activeGoogleOAuthClientId
    || (settings.customGoogleClientEnabled ? ENV_CUSTOM_CLIENT_ID : DEFAULT_CLIENT_ID);
  let client = MANAGED_CLIENT_ID_PATTERN.test(String(activeId))
    ? await GoogleOAuthClient.findById(activeId)
    : null;
  if (!client) client = await GoogleOAuthClient.findOne().sort({ createdAt: 1, _id: 1 });
  if (client) {
    return {
      id: String(client._id),
      source: 'managed',
      clientId: client.clientId,
      callbackUrl: signInCallbackUrl(client.callbackUrl),
    };
  }
  const environment = envClient(activeId, settings) || envClient(DEFAULT_CLIENT_ID, settings);
  return {
    id: environment.selectionId,
    source: 'environment',
    clientId: environment.clientId,
    callbackUrl: environment.callbackUrl,
  };
}

module.exports = {
  DEFAULT_CLIENT_ID,
  ENV_CUSTOM_CLIENT_ID,
  CALENDAR_ENV_CLIENT_ID,
  DRIVE_ENV_CLIENT_ID,
  MANAGED_CLIENT_ID_PATTERN,
  SIGN_IN_CALLBACK_PATH,
  validClientId,
  isSignInCallbackUrl,
  defaultCallbackUrl,
  findDuplicate,
  managementConfig,
  resolveClient,
  resolveUsableClient,
  checkCredentials,
  encryptSecret: (secret) => credentialEncryption.encryptSecret(secret, 'google-oauth-client'),
};
