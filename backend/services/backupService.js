const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Backups hold every record (including password hashes), so they live outside any public folder
// and are only served to a System Administrator through an authenticated endpoint.
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const FORMAT = 'play-is-school-backup';
const FORMAT_VERSION = 1;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const AUTO_BACKUPS_TO_KEEP = 14;
const SAFETY_BACKUPS_TO_KEEP = 5;
const INSERT_BATCH = 500;

// Revoked sign-in tokens are security state, not school data: restoring an old list would
// make signed-out sessions valid again, so the current list is always kept.
const NEVER_RESTORE = new Set(['revokedtokens']);

let busy = null; // 'backup' | 'restore' — one operation at a time

function assertIdle(operation) {
  if (busy) {
    const error = new Error(`A ${busy} is already running. Try again when it finishes.`);
    error.status = 409;
    throw error;
  }
  busy = operation;
}

function fileNameFor(type, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `backup-${stamp}-${type}-${crypto.randomBytes(3).toString('hex')}.json.gz`;
}

function safeBackupPath(fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !/^backup-[\w-]+\.json\.gz$/.test(fileName)) {
    return null;
  }
  return path.join(BACKUP_DIR, fileName);
}

async function appCollections() {
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  return collections
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();
}

// Serializes the whole database to a gzipped Extended JSON document (keeps ObjectIds and dates exact).
async function buildBackupBuffer({ type, createdBy }) {
  const db = mongoose.connection.db;
  const names = await appCollections();
  const collections = {};
  const counts = {};
  for (const name of names) {
    const documents = await db.collection(name).find({}).toArray();
    collections[name] = documents;
    counts[name] = documents.length;
  }
  const payload = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date(),
    type,
    createdBy: createdBy || null,
    database: db.databaseName,
    counts,
    collections,
  };
  const json = EJSON.stringify(payload, { relaxed: false });
  return { buffer: await gzip(Buffer.from(json, 'utf8')), counts };
}

async function writeMeta(fileName, meta) {
  await fs.promises.writeFile(path.join(BACKUP_DIR, `${fileName}.meta.json`), JSON.stringify(meta, null, 2));
}

async function readMeta(fileName) {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(BACKUP_DIR, `${fileName}.meta.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function saveBackup({ type, createdBy }) {
  const { buffer, counts } = await buildBackupBuffer({ type, createdBy });
  const fileName = fileNameFor(type);
  await fs.promises.writeFile(path.join(BACKUP_DIR, fileName), buffer);
  const meta = {
    fileName,
    type,
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    size: buffer.length,
    collections: Object.keys(counts).length,
    documents: Object.values(counts).reduce((sum, count) => sum + count, 0),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
  await writeMeta(fileName, meta);
  return meta;
}

// Creates a backup on request (manual) or on schedule (auto).
async function createBackup({ type = 'manual', createdBy = null } = {}) {
  assertIdle('backup');
  try {
    const meta = await saveBackup({ type, createdBy });
    await pruneBackups();
    return meta;
  } finally {
    busy = null;
  }
}

async function listBackups() {
  const files = (await fs.promises.readdir(BACKUP_DIR)).filter((name) => safeBackupPath(name));
  const rows = await Promise.all(files.map(async (fileName) => {
    const meta = await readMeta(fileName);
    if (meta) return meta;
    const stats = await fs.promises.stat(path.join(BACKUP_DIR, fileName));
    return { fileName, type: 'uploaded', createdAt: stats.mtime.toISOString(), size: stats.size, createdBy: null };
  }));
  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function deleteBackup(fileName) {
  const filePath = safeBackupPath(fileName);
  if (!filePath) return false;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  await fs.promises.unlink(`${filePath}.meta.json`).catch(() => {});
  return true;
}

// Keeps the newest automatic and pre-restore safety backups; manual ones are never pruned.
async function pruneBackups() {
  const backups = await listBackups();
  const limits = { auto: AUTO_BACKUPS_TO_KEEP, 'pre-restore': SAFETY_BACKUPS_TO_KEEP };
  for (const [type, keep] of Object.entries(limits)) {
    const old = backups.filter((backup) => backup.type === type).slice(keep);
    for (const backup of old) await deleteBackup(backup.fileName);
  }
}

// Reads and validates a backup (gzipped or plain JSON) into collections of BSON documents.
async function parseBackup(buffer) {
  let raw = buffer;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      raw = await gunzip(buffer);
    } catch {
      throw Object.assign(new Error('The backup file is damaged and could not be decompressed.'), { status: 400 });
    }
  }
  let payload;
  try {
    payload = EJSON.parse(raw.toString('utf8'), { relaxed: false });
  } catch {
    throw Object.assign(new Error('This is not a valid backup file.'), { status: 400 });
  }
  if (!payload || payload.format !== FORMAT || typeof payload.collections !== 'object') {
    throw Object.assign(new Error('This file is not a Play-is-School backup.'), { status: 400 });
  }
  if (payload.version > FORMAT_VERSION) {
    throw Object.assign(new Error('This backup was made by a newer version of the system and cannot be restored here.'), { status: 400 });
  }
  for (const [name, documents] of Object.entries(payload.collections)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || name.startsWith('system.') || !Array.isArray(documents)) {
      throw Object.assign(new Error(`The backup contains an invalid collection: ${name}`), { status: 400 });
    }
  }
  return payload;
}

async function replaceCollections(collections) {
  const db = mongoose.connection.db;
  const restored = {};
  for (const [name, documents] of Object.entries(collections)) {
    if (NEVER_RESTORE.has(name)) continue;
    const collection = db.collection(name);
    await collection.deleteMany({});
    for (let index = 0; index < documents.length; index += INSERT_BATCH) {
      await collection.insertMany(documents.slice(index, index + INSERT_BATCH), { ordered: true });
    }
    restored[name] = documents.length;
  }
  // Collections created after the backup was taken are emptied too, so the data matches the backup.
  const current = await appCollections();
  for (const name of current) {
    if (!(name in collections) && !NEVER_RESTORE.has(name)) {
      await db.collection(name).deleteMany({});
      restored[name] = 0;
    }
  }
  return restored;
}

// Replaces the database with the backup. A safety backup is taken first; if anything fails
// part-way, the safety backup is put back automatically.
async function restoreBackup(buffer, { restoredBy = null } = {}) {
  const payload = await parseBackup(buffer);
  assertIdle('restore');
  let safety = null;
  try {
    safety = await saveBackup({ type: 'pre-restore', createdBy: restoredBy });
    try {
      const restored = await replaceCollections(payload.collections);
      return {
        restored,
        backupCreatedAt: payload.createdAt,
        safetyBackup: safety.fileName,
      };
    } catch (err) {
      console.error('[backup] Restore failed, rolling back:', err.message);
      const safetyPayload = await parseBackup(await fs.promises.readFile(path.join(BACKUP_DIR, safety.fileName)));
      await replaceCollections(safetyPayload.collections);
      throw Object.assign(new Error(`The restore failed and the database was rolled back to how it was before (${err.message}).`), { status: 500 });
    }
  } finally {
    busy = null;
    pruneBackups().catch(() => {});
  }
}

async function readBackupFile(fileName) {
  const filePath = safeBackupPath(fileName);
  if (!filePath) return null;
  try {
    return await fs.promises.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Stores an uploaded backup alongside the others (after validating it) and returns its metadata.
async function storeUploadedBackup(buffer, uploadedBy) {
  const payload = await parseBackup(buffer);
  const compressed = buffer[0] === 0x1f && buffer[1] === 0x8b ? buffer : await gzip(buffer);
  const fileName = fileNameFor('uploaded');
  await fs.promises.writeFile(path.join(BACKUP_DIR, fileName), compressed);
  const counts = payload.counts || {};
  const meta = {
    fileName,
    type: 'uploaded',
    createdAt: new Date().toISOString(),
    originalCreatedAt: payload.createdAt ? new Date(payload.createdAt).toISOString() : null,
    createdBy: uploadedBy || null,
    size: compressed.length,
    collections: Object.keys(payload.collections).length,
    documents: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
  await writeMeta(fileName, meta);
  return meta;
}

function startAutomaticBackups() {
  const run = async () => {
    try {
      const latest = (await listBackups()).find((backup) => backup.type === 'auto');
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < AUTO_BACKUP_INTERVAL_MS - 60 * 1000) return;
      const meta = await createBackup({ type: 'auto', createdBy: 'System' });
      console.log(`[backup] Automatic backup saved: ${meta.fileName}`);
    } catch (err) {
      if (err.status !== 409) console.error('[backup] Automatic backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // check hourly, back up once a day
}

module.exports = {
  AUTO_BACKUPS_TO_KEEP,
  SAFETY_BACKUPS_TO_KEEP,
  createBackup,
  listBackups,
  deleteBackup,
  readBackupFile,
  restoreBackup,
  storeUploadedBackup,
  parseBackup,
  startAutomaticBackups,
};
