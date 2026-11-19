const mongoose = require('mongoose');
const EditLock = require('../models/EditLock');

// How long a lock lasts without a heartbeat (the browser renews it every 30 seconds while the
// edit form is open; a closed tab or crashed browser frees the record within this time).
const LOCK_TTL_MS = 90 * 1000;

// Records that can be locked for editing, with a readable name for messages.
const RESOURCES = {
  student: 'student record',
  user: 'account',
  class: 'class',
  event: 'event',
  progress: 'progress record',
  pickup: 'pickup authorization',
  payment: 'payment',
};

function lockHolder(lock) {
  return {
    userId: String(lock.user),
    name: lock.userName,
    role: lock.userRole,
    since: lock.acquiredAt,
    expiresAt: lock.expiresAt,
  };
}

function lockedMessage(resource, holder) {
  return `${holder.name} is currently editing this ${RESOURCES[resource] || 'record'}. Please wait for them to save their changes, then refresh and try again.`;
}

function validTarget(resource, recordId) {
  return Object.prototype.hasOwnProperty.call(RESOURCES, resource) && mongoose.isObjectIdOrHexString(String(recordId || ''));
}

// Atomically takes (or renews) the lock for `user`. Returns { ok: true, lock } or
// { ok: false, holder } when another person holds a live lock.
async function acquire(resource, recordId, user) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  const id = new mongoose.Types.ObjectId(String(recordId));
  try {
    // Already ours (e.g. a heartbeat): just extend it, keeping the original start time.
    const renewed = await EditLock.findOneAndUpdate(
      { resource, recordId: id, user: user._id },
      { $set: { expiresAt, userName: user.name } },
      { new: true }
    );
    if (renewed) return { ok: true, lock: lockHolder(renewed) };
    // Free or expired: take it. A live lock held by someone else does not match, so the upsert
    // tries to insert and the unique index refuses it — two people can never both win.
    const lock = await EditLock.findOneAndUpdate(
      { resource, recordId: id, expiresAt: { $lte: now } },
      { $set: { user: user._id, userName: user.name, userRole: user.role, acquiredAt: now, expiresAt } },
      { upsert: true, new: true }
    );
    return { ok: true, lock: lockHolder(lock) };
  } catch (err) {
    if (err.code !== 11000) throw err;
    const lock = await EditLock.findOne({ resource, recordId: id });
    if (!lock) return acquire(resource, recordId, user); // it was just released — try again
    return { ok: false, holder: lockHolder(lock) };
  }
}

async function release(resource, recordId, user) {
  await EditLock.deleteOne({ resource, recordId: new mongoose.Types.ObjectId(String(recordId)), user: user._id });
}

// Who else (if anyone) holds a live lock on this record.
async function heldByOther(resource, recordId, user) {
  if (!mongoose.isObjectIdOrHexString(String(recordId || ''))) return null;
  const lock = await EditLock.findOne({
    resource,
    recordId: new mongoose.Types.ObjectId(String(recordId)),
    expiresAt: { $gt: new Date() },
    user: { $ne: user._id },
  });
  return lock ? lockHolder(lock) : null;
}

module.exports = { LOCK_TTL_MS, RESOURCES, acquire, release, heldByOther, lockedMessage, validTarget };
