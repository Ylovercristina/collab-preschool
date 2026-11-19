const mongoose = require('mongoose');

// ---------------------------------------------------------------------------------------------
// Database concurrency control
//
// 1) versionGuard — optimistic locking for edits.
//    The browser sends the record version it loaded (its `updatedAt`) in the X-Record-Version
//    header. Before the controller runs, the version is claimed with one atomic
//    compare-and-set: { _id, updatedAt: <loaded version> } -> updatedAt = <new version>.
//    If someone else saved first, nothing matches and the request is refused with 409
//    instead of silently overwriting their changes. Two simultaneous saves of the same
//    version can never both win. If the controller then rejects the request (4xx/5xx),
//    the claim is undone so the user can fix the form and save again.
//
// 2) exclusiveLock — a short-lived lock on one document for multi-step operations that read,
//    check and then write (e.g. recording a payment against a fee balance). Taking the lock is a
//    single atomic update; it expires on its own if the server stops mid-operation.
// ---------------------------------------------------------------------------------------------

const VERSION_HEADER = 'x-record-version';

function conflict(res, label, current) {
  return res.status(409).json({
    code: 'VERSION_CONFLICT',
    message: `This ${label} was changed by someone else after you opened it. Reload to see the latest version, then make your changes again.`,
    currentVersion: current || null,
  });
}

function versionGuard(Model, { param = 'id', label = 'record', lock = null } = {}) {
  return async (req, res, next) => {
    const id = req.params[param];
    if (!mongoose.isObjectIdOrHexString(id)) return next();
    // Pessimistic edit lock: while someone else has this record open for editing, nobody else
    // may save it (checked even for requests that send no version).
    if (lock && req.user) {
      try {
        const { heldByOther, lockedMessage } = require('../services/editLockService');
        const holder = await heldByOther(lock, id, req.user);
        if (holder) {
          return res.status(423).json({ code: 'EDIT_LOCKED', lockedBy: holder, message: lockedMessage(lock, holder) });
        }
      } catch (err) {
        console.error('[concurrency] Edit lock check failed:', err.message);
        return res.status(500).json({ message: 'Could not check whether someone else is editing this.' });
      }
    }
    const raw = req.get(VERSION_HEADER);
    if (!raw) return next(); // older clients / quick actions without a loaded version
    const expected = new Date(raw);
    if (Number.isNaN(expected.getTime())) {
      return res.status(400).json({ message: 'The record version sent with this change is not valid. Reload and try again.' });
    }
    try {
      const _id = new mongoose.Types.ObjectId(String(id));
      // A strictly newer timestamp, so the next version always differs from the one claimed.
      const claimed = new Date(Math.max(Date.now(), expected.getTime() + 1));
      // Raw collection update: no Mongoose hooks or timestamps interfere with the compare-and-set.
      const result = await Model.collection.updateOne(
        { _id, updatedAt: expected },
        { $set: { updatedAt: claimed } }
      );
      if (result.matchedCount === 0) {
        const current = await Model.collection.findOne({ _id }, { projection: { updatedAt: 1 } });
        if (!current) return next(); // let the controller answer "not found"
        return conflict(res, label, current.updatedAt);
      }
      // If the change is rejected, give the version back so the user can correct and retry.
      res.on('finish', () => {
        if (res.statusCode < 400) return;
        Model.collection.updateOne({ _id, updatedAt: claimed }, { $set: { updatedAt: expected } })
          .catch((err) => console.error('[concurrency] Could not release version claim:', err.message));
      });
      return next();
    } catch (err) {
      console.error('[concurrency] Version check failed:', err.message);
      return res.status(500).json({ message: 'Could not check whether this record was changed. Try again.' });
    }
  };
}

function exclusiveLock(Model, { param = 'id', field = 'lockedUntil', ttlMs = 30 * 1000, message } = {}) {
  return async (req, res, next) => {
    const id = req.params[param];
    if (!mongoose.isObjectIdOrHexString(id)) return next();
    const _id = new mongoose.Types.ObjectId(String(id));
    const now = new Date();
    const token = new mongoose.Types.ObjectId(); // identifies this request's lock
    try {
      const result = await Model.collection.updateOne(
        { _id, $or: [{ [field]: null }, { [field]: { $exists: false } }, { [`${field}.until`]: { $lt: now } }] },
        { $set: { [field]: { until: new Date(now.getTime() + ttlMs), token } } }
      );
      if (result.matchedCount === 0) {
        const exists = await Model.collection.countDocuments({ _id }, { limit: 1 });
        if (!exists) return next();
        return res.status(409).json({
          code: 'LOCKED',
          message: message || 'Someone else is updating this record right now. Try again in a moment.',
        });
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        Model.collection.updateOne({ _id, [`${field}.token`]: token }, { $set: { [field]: null } })
          .catch((err) => console.error('[concurrency] Could not release lock:', err.message));
      };
      res.on('finish', release);
      res.on('close', release);
      return next();
    } catch (err) {
      console.error('[concurrency] Lock failed:', err.message);
      return res.status(500).json({ message: 'Could not lock the record. Try again.' });
    }
  };
}

module.exports = { versionGuard, exclusiveLock, VERSION_HEADER };
