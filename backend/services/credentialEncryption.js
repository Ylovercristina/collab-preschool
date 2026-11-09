const crypto = require('crypto');

function encryptionKey(purpose) {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('GOOGLE_OAUTH_CLIENT_ENCRYPTION_KEY or JWT_SECRET is required to encrypt managed credential secrets.');
  return crypto.createHash('sha256').update(`play-is-school:${purpose}:${secret}`).digest();
}

function encryptSecret(secret, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(purpose), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

function decryptSecret(value, purpose, label) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error(`Stored ${label} is unreadable.`);
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error(`Stored ${label} is unreadable.`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
