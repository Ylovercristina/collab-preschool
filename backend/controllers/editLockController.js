const locks = require('../services/editLockService');

function readTarget(req) {
  const resource = String((req.body && req.body.resource) || req.query.resource || '');
  const recordId = String((req.body && req.body.id) || req.query.id || '');
  return locks.validTarget(resource, recordId) ? { resource, recordId } : null;
}

// POST /api/locks  { resource, id } — start editing (also used as the heartbeat to keep it).
exports.acquire = async (req, res) => {
  const target = readTarget(req);
  if (!target) return res.status(400).json({ message: 'Unknown record to lock.' });
  try {
    const result = await locks.acquire(target.resource, target.recordId, req.user);
    if (result.ok) return res.json({ lock: result.lock, ttlMs: locks.LOCK_TTL_MS });
    return res.status(423).json({
      code: 'EDIT_LOCKED',
      lockedBy: result.holder,
      message: locks.lockedMessage(target.resource, result.holder),
    });
  } catch (err) {
    console.error('[locks] Acquire failed:', err.message);
    return res.status(500).json({ message: 'Could not check whether someone else is editing this.' });
  }
};

// DELETE /api/locks?resource=&id= — finished editing (saved, cancelled or closed).
exports.release = async (req, res) => {
  const target = readTarget(req);
  if (!target) return res.status(400).json({ message: 'Unknown record to unlock.' });
  try {
    await locks.release(target.resource, target.recordId, req.user);
    return res.json({ released: true });
  } catch (err) {
    console.error('[locks] Release failed:', err.message);
    return res.status(500).json({ message: 'Could not release the edit lock.' });
  }
};
