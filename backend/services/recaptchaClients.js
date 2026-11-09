const RecaptchaClient = require('../models/RecaptchaClient');
const credentialEncryption = require('./credentialEncryption');

const DEFAULT_CLIENT_ID = 'default';
const MANAGED_CLIENT_ID_PATTERN = /^[a-f\d]{24}$/i;

function environmentClient() {
  return {
    id: DEFAULT_CLIENT_ID,
    label: 'Default reCAPTCHA configuration (.env)',
    siteKey: String(process.env.RECAPTCHA_SITE_KEY || '').trim(),
    secretKey: String(process.env.RECAPTCHA_SECRET_KEY || '').trim(),
    allowedHostnames: String(process.env.RECAPTCHA_ALLOWED_HOSTNAMES || '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
    source: 'environment',
  };
}

async function findDuplicate(siteKey, excludeId) {
  const normalized = siteKey.trim().toLowerCase();
  const query = { normalizedSiteKey: normalized };
  if (excludeId && MANAGED_CLIENT_ID_PATTERN.test(String(excludeId))) query._id = { $ne: excludeId };
  return Boolean(await RecaptchaClient.exists(query));
}

async function resolveClient(selectionId = DEFAULT_CLIENT_ID) {
  if (selectionId === DEFAULT_CLIENT_ID) {
    const client = environmentClient();
    if (!client.siteKey || !client.secretKey) {
      throw new Error('Configure both RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY in backend/.env.');
    }
    return client;
  }
  if (!MANAGED_CLIENT_ID_PATTERN.test(String(selectionId))) {
    throw new Error('The selected reCAPTCHA configuration is invalid.');
  }
  const client = await RecaptchaClient.findById(selectionId).select('+encryptedSecret');
  if (!client) throw new Error('The selected reCAPTCHA configuration is no longer available.');
  return {
    id: String(client._id),
    label: client.label,
    siteKey: client.siteKey,
    secretKey: credentialEncryption.decryptSecret(client.encryptedSecret, 'recaptcha-client', 'reCAPTCHA secret'),
    allowedHostnames: client.allowedHostnames || [],
    source: 'managed',
  };
}

async function siteKey(selectionId = DEFAULT_CLIENT_ID) {
  return (await resolveClient(selectionId)).siteKey;
}

async function isConfigured(selectionId = DEFAULT_CLIENT_ID) {
  if (selectionId === DEFAULT_CLIENT_ID) {
    const client = environmentClient();
    return Boolean(client.siteKey && client.secretKey);
  }
  return MANAGED_CLIENT_ID_PATTERN.test(String(selectionId))
    && Boolean(await RecaptchaClient.exists({ _id: selectionId }));
}

async function managementConfig(settings = {}) {
  const activeId = settings.activeRecaptchaClientId || DEFAULT_CLIENT_ID;
  let client = MANAGED_CLIENT_ID_PATTERN.test(String(activeId))
    ? await RecaptchaClient.findById(activeId)
    : null;
  if (!client) client = await RecaptchaClient.findOne().sort({ createdAt: 1, _id: 1 });
  if (client) {
    return {
      id: String(client._id),
      source: 'managed',
      siteKey: client.siteKey,
      allowedHostnames: client.allowedHostnames || [],
    };
  }
  const environment = environmentClient();
  return {
    id: DEFAULT_CLIENT_ID,
    source: 'environment',
    siteKey: environment.siteKey,
    allowedHostnames: environment.allowedHostnames,
  };
}

module.exports = {
  DEFAULT_CLIENT_ID,
  MANAGED_CLIENT_ID_PATTERN,
  encryptSecret: (secret) => credentialEncryption.encryptSecret(secret, 'recaptcha-client'),
  findDuplicate,
  isConfigured,
  managementConfig,
  resolveClient,
  siteKey,
};
