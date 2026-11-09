const crypto = require('crypto');
const mongoose = require('mongoose');
const GoogleOAuthClient = require('../models/GoogleOAuthClient');

const DEFAULT_CLIENT_ID = 'default';
const ENV_CUSTOM_CLIENT_ID = 'env-custom';
const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

function encryptionKey() {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('GOOGLE_OAUTH_CLIENT_ENCRYPTION_KEY or JWT_SECRET is required to encrypt Google OAuth client secrets.');
  return crypto.createHash('sha256').update(`play-is-school:google-oauth-client:${secret}`).digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

function decryptSecret(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Stored Google OAuth client secret is unreadable.');
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error('Stored Google OAuth client secret is unreadable.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function validClientId(value) {
  return typeof value === 'string' && GOOGLE_CLIENT_ID_PATTERN.test(value.trim());
}

function validManagedClientId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

function envClient(selectionId, settings = {}) {
  if (selectionId === DEFAULT_CLIENT_ID) {
    return {
      selectionId,
      label: 'Default Google client (.env)',
      clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
      clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
      source: 'environment',
    };
  }
  if (selectionId === ENV_CUSTOM_CLIENT_ID) {
    return {
      selectionId,
      label: 'Custom Google client (.env)',
      clientId: String(process.env.CUSTOM_GOOGLE_CLIENT_ID || settings.customGoogleClientId || '').trim(),
      clientSecret: String(process.env.CUSTOM_GOOGLE_CLIENT_SECRET || '').trim(),
      source: 'environment',
    };
  }
  return null;
}

function publicEnvironmentClient(client) {
  return {
    id: client.selectionId,
    label: client.label,
    clientId: client.clientId,
    source: client.source,
    secretConfigured: Boolean(client.clientSecret),
    configured: Boolean(client.clientId && client.clientSecret),
  };
}

function publicManagedClient(client) {
  return {
    id: String(client._id),
    label: client.label,
    clientId: client.clientId,
    source: 'managed',
    secretConfigured: true,
    configured: true,
  };
}

async function listClients(settings = {}) {
  const clients = await GoogleOAuthClient.find().sort({ createdAt: 1, _id: 1 });
  const customEnvironmentClient = envClient(ENV_CUSTOM_CLIENT_ID, settings);
  return {
    options: [
      publicEnvironmentClient(envClient(DEFAULT_CLIENT_ID)),
      ...(customEnvironmentClient.clientId || customEnvironmentClient.clientSecret
        ? [publicEnvironmentClient(customEnvironmentClient)]
        : []),
      ...clients.map(publicManagedClient),
    ],
    clients: clients.map(publicManagedClient),
  };
}

async function findDuplicate(clientId, excludeId, settings = {}) {
  const normalized = clientId.trim().toLowerCase();
  const environmentIds = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.CUSTOM_GOOGLE_CLIENT_ID,
    settings.customGoogleClientId,
  ].map((id) => String(id || '').trim().toLowerCase()).filter(Boolean);
  if (environmentIds.includes(normalized)) return true;
  const query = { normalizedClientId: normalized };
  if (excludeId && validManagedClientId(String(excludeId))) query._id = { $ne: excludeId };
  return Boolean(await GoogleOAuthClient.exists(query));
}

async function resolveClient(selectionId, settings = {}) {
  const configuredEnvClient = envClient(selectionId, settings);
  if (configuredEnvClient) {
    if (!configuredEnvClient.clientId || !configuredEnvClient.clientSecret) {
      throw new Error('The selected Google OAuth client is not configured in backend/.env.');
    }
    return configuredEnvClient;
  }

  if (!validManagedClientId(selectionId)) throw new Error('The selected Google OAuth client is invalid.');
  const client = await GoogleOAuthClient.findById(selectionId).select('+encryptedClientSecret');
  if (!client) throw new Error('The selected Google OAuth client is no longer available.');
  return {
    selectionId: String(client._id),
    label: client.label,
    clientId: client.clientId,
    clientSecret: decryptSecret(client.encryptedClientSecret),
    source: 'managed',
  };
}

async function clientExists(selectionId, settings = {}) {
  if ([DEFAULT_CLIENT_ID, ENV_CUSTOM_CLIENT_ID].includes(selectionId)) {
    const client = envClient(selectionId, settings);
    return selectionId === DEFAULT_CLIENT_ID
      || Boolean(client.clientId || client.clientSecret);
  }
  return validManagedClientId(selectionId)
    && Boolean(await GoogleOAuthClient.exists({ _id: selectionId }));
}

module.exports = {
  DEFAULT_CLIENT_ID,
  ENV_CUSTOM_CLIENT_ID,
  GOOGLE_CLIENT_ID_PATTERN,
  encryptSecret,
  clientExists,
  findDuplicate,
  listClients,
  publicManagedClient,
  resolveClient,
  validManagedClientId,
  validClientId,
};
