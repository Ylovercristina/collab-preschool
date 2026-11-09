const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const User = require('../models/User');
const googleOAuthClients = require('./googleOAuthClients');
const { progressPhotoDirectory } = require('../middleware/progressUpload');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

class GoogleDriveError extends Error {}

function tokenKey() {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new GoogleDriveError('Google Drive token encryption is not configured.');
  return crypto.createHash('sha256').update(`play-is-school:google-drive:${secret}`).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

function decryptToken(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new GoogleDriveError('Stored Google Drive access is unreadable. Reconnect Google Drive.');
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new GoogleDriveError('Stored Google Drive access is unreadable. Reconnect Google Drive.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

async function oauthClient(selectionId = googleOAuthClients.DRIVE_ENV_CLIENT_ID) {
  const credentials = await googleOAuthClients.resolveClient(selectionId);
  const callbackUrl = selectionId === googleOAuthClients.CALENDAR_ENV_CLIENT_ID
    ? process.env.GOOGLE_CALENDAR_CALLBACK_URL
    : process.env.GOOGLE_DRIVE_CALLBACK_URL;
  return new OAuth2Client(credentials.clientId, credentials.clientSecret, callbackUrl);
}

async function getConnection(userId, fields = '') {
  const query = GoogleDriveConnection.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (fields) query.select(fields);
  return query;
}

async function createAuthorizationUrl(userId) {
  const callback = String(process.env.GOOGLE_DRIVE_CALLBACK_URL || '').trim();
  if (!callback) throw new GoogleDriveError('Configure GOOGLE_DRIVE_CALLBACK_URL to connect Google Drive.');
  const state = crypto.randomBytes(32).toString('hex');
  const selectionId = googleOAuthClients.DRIVE_ENV_CLIENT_ID;
  const user = await User.findById(userId).select('email');
  if (!user) throw new GoogleDriveError('Your Play-is-School account could not be found.');
  const client = await oauthClient(selectionId);
  await GoogleDriveConnection.updateOne({ userId }, {
    $set: {
      pendingStateHash: hashState(state),
      pendingStateExpires: new Date(Date.now() + STATE_TTL_MS),
      pendingOAuthClientSelectionId: selectionId,
    },
  });
  return client.generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    login_hint: user.email,
    prompt: 'consent',
    scope: ['openid', 'email', DRIVE_SCOPE],
    state,
  });
}

async function consumeOAuthState(state) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
  const connection = await GoogleDriveConnection.findOneAndUpdate(
    { pendingStateHash: hashState(state), pendingStateExpires: { $gt: new Date() } },
    { $set: { pendingStateHash: '', pendingStateExpires: null } },
    { new: true, projection: { userId: 1 } }
  ).select('+pendingOAuthClientSelectionId');
  if (!connection) return null;
  const clientSelectionId = connection.pendingOAuthClientSelectionId || googleOAuthClients.DRIVE_ENV_CLIENT_ID;
  connection.pendingOAuthClientSelectionId = '';
  await connection.save();
  return { userId: connection.userId, clientSelectionId };
}

async function completeConnection(code, userId, clientSelectionId) {
  const client = await oauthClient(clientSelectionId);
  const { tokens } = await client.getToken(code);
  if (!String(tokens.scope || '').split(/\s+/).includes(DRIVE_SCOPE)) {
    throw new GoogleDriveError('Google Drive file access was not granted. Please allow access and try again.');
  }
  if (!tokens.refresh_token || !tokens.id_token) {
    throw new GoogleDriveError('Google did not return the required offline access. Please try connecting again.');
  }
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: client.clientId });
  const profile = ticket.getPayload() || {};
  const [user, connection] = await Promise.all([
    User.findById(userId).select('email googleId'),
    getConnection(userId, 'googleAccountId'),
  ]);
  if (!user) throw new GoogleDriveError('Your Play-is-School account could not be found.');
  const accountId = String(profile.sub || '');
  const accountEmail = String(profile.email || '').trim().toLowerCase();
  const sameGoogleAccount = user.googleId
    ? String(user.googleId) === accountId
    : String(user.email || '').trim().toLowerCase() === accountEmail;
  if (!accountId || !accountEmail || !sameGoogleAccount) {
    throw new GoogleDriveError('Connect the Google account associated with your Play-is-School sign-in.');
  }
  await GoogleDriveConnection.updateOne({ userId }, {
    $set: {
      connected: true,
      needsReconnect: false,
      pickerScopeVersion: 2,
      accountEmail,
      googleAccountId: accountId,
      oauthClientSelectionId: clientSelectionId,
      encryptedRefreshToken: encryptToken(tokens.refresh_token),
      connectedAt: new Date(),
      lastError: '',
    },
  });
}

async function getStatus(userId) {
  const connection = await getConnection(userId);
  return {
    connected: connection.connected && !connection.needsReconnect && connection.pickerScopeVersion === 2,
    needsReconnect: connection.connected && connection.pickerScopeVersion !== 2,
    accountEmail: connection.accountEmail,
    lastError: connection.lastError,
  };
}

async function getPickerConfig(userId) {
  const apiKey = String(process.env.GOOGLE_DRIVE_PICKER_API_KEY || '').trim();
  const appId = String(process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '').trim();
  if (!apiKey || !/^\d+$/.test(appId)) {
    throw new GoogleDriveError('Google Picker is not configured. Set GOOGLE_DRIVE_PICKER_API_KEY and GOOGLE_CLOUD_PROJECT_NUMBER.');
  }
  const connection = await GoogleDriveConnection.findOne({
    userId, connected: true, needsReconnect: false, pickerScopeVersion: 2,
  })
    .select('+encryptedRefreshToken +oauthClientSelectionId');
  if (!connection) throw new GoogleDriveError('Google Drive access needs authorization.');
  const client = await oauthClient(connection.oauthClientSelectionId);
  client.setCredentials({ refresh_token: decryptToken(connection.encryptedRefreshToken) });
  let accessToken;
  try {
    accessToken = await client.getAccessToken();
  } catch {
    await GoogleDriveConnection.updateOne({ _id: connection._id }, {
      $set: { needsReconnect: true, lastError: 'Google Drive access expired or was revoked.' },
    });
    throw new GoogleDriveError('Google Drive access expired. Authorize Google Drive again.');
  }
  if (!accessToken.token) throw new GoogleDriveError('Google Drive access expired. Authorize Google Drive again.');
  return { apiKey, appId, accessToken: accessToken.token };
}

async function driveRequest(userId, endpoint, params = {}, responseType = 'json') {
  const connection = await GoogleDriveConnection.findOne({
    userId, connected: true, needsReconnect: false, pickerScopeVersion: 2,
  })
    .select('+encryptedRefreshToken +oauthClientSelectionId');
  if (!connection) throw new GoogleDriveError('Google Drive authorization expired. Choose from Google Drive again.');
  const client = await oauthClient(connection.oauthClientSelectionId);
  client.setCredentials({ refresh_token: decryptToken(connection.encryptedRefreshToken) });
  let accessToken;
  try {
    accessToken = await client.getAccessToken();
  } catch {
    await GoogleDriveConnection.updateOne({ _id: connection._id }, {
      $set: { needsReconnect: true, lastError: 'Google Drive access expired or was revoked.' },
    });
    throw new GoogleDriveError('Google Drive authorization expired. Choose from Google Drive again.');
  }
  if (!accessToken.token) {
    await GoogleDriveConnection.updateOne({ _id: connection._id }, {
      $set: { needsReconnect: true, lastError: 'Google Drive access expired or was revoked.' },
    });
    throw new GoogleDriveError('Google Drive authorization expired. Choose from Google Drive again.');
  }
  const url = new URL(`${DRIVE_API}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken.token}` },
      signal: controller.signal,
    });
  } catch (error) {
    throw new GoogleDriveError(error.name === 'AbortError'
      ? 'Google Drive took too long to respond. Try again.'
      : 'Could not connect to Google Drive.');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) {
    await GoogleDriveConnection.updateOne({ _id: connection._id }, {
      $set: { needsReconnect: true, lastError: 'Google Drive access expired or was revoked.' },
    });
    throw new GoogleDriveError('Google Drive access expired. Reconnect Google Drive.');
  }
  if (!response.ok) {
    const errorBody = await response.text();
    let googleError;
    try {
      googleError = JSON.parse(errorBody).error;
    } catch {
      console.error('[progress] Google Drive API request failed:', {
        status: response.status,
        statusText: response.statusText,
        responseBody: 'Non-JSON response',
      });
      throw new GoogleDriveError('Google Drive could not complete the request.');
    }
    const reasons = Array.isArray(googleError && googleError.errors)
      ? [...new Set(googleError.errors.map((item) => item.reason).filter((reason) => typeof reason === 'string'))]
      : [];
    console.error('[progress] Google Drive API request failed:', {
      status: response.status,
      statusText: response.statusText,
      reason: googleError && googleError.status,
      details: reasons,
    });
    throw new GoogleDriveError('Google Drive could not complete the request.');
  }
  return responseType === 'bytes'
    ? Buffer.from(await response.arrayBuffer())
    : response.json();
}

function validImage(buffer, mimetype) {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

async function importPhotos(userId, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length > 6
    || fileIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id))
    || new Set(fileIds).size !== fileIds.length) {
    throw new GoogleDriveError('Choose up to 6 valid, different Google Drive photos.');
  }
  const imported = [];
  try {
    for (const id of fileIds) {
      const metadata = await driveRequest(userId, `files/${encodeURIComponent(id)}`, {
        fields: 'id,name,mimeType,size',
        supportsAllDrives: 'true',
      });
      if (!IMAGE_TYPES[metadata.mimeType] || !Number(metadata.size) || Number(metadata.size) > MAX_PHOTO_BYTES) {
        throw new GoogleDriveError(`${metadata.name || 'A selected file'} is not a supported image under 5 MB.`);
      }
      const bytes = await driveRequest(userId, `files/${encodeURIComponent(id)}`, {
        alt: 'media',
        supportsAllDrives: 'true',
      }, 'bytes');
      if (bytes.length > MAX_PHOTO_BYTES || !validImage(bytes, metadata.mimeType)) {
        throw new GoogleDriveError(`${metadata.name || 'A selected file'} is not a valid supported image under 5 MB.`);
      }
      const filename = `${crypto.randomUUID()}${IMAGE_TYPES[metadata.mimeType]}`;
      const filePath = path.join(progressPhotoDirectory, filename);
      await fs.promises.writeFile(filePath, bytes, { flag: 'wx' });
      imported.push({
        path: filePath,
        filename,
        originalname: path.basename(metadata.name || 'Google Drive photo').slice(0, 200),
        mimetype: metadata.mimeType,
        size: bytes.length,
      });
    }
    return imported;
  } catch (error) {
    await Promise.all(imported.map((file) => fs.promises.unlink(file.path)
      .catch((unlinkError) => { if (unlinkError.code !== 'ENOENT') console.error('[progress] Could not remove imported Drive photo:', unlinkError.message); })));
    throw error;
  }
}

module.exports = {
  GoogleDriveError,
  consumeOAuthState,
  createAuthorizationUrl,
  completeConnection,
  getStatus,
  getPickerConfig,
  importPhotos,
};
