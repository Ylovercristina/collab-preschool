const EmailLog = require('../models/EmailLog');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

const queue = [];
let processing = false;

function queueEmailDelivery({ parents, type, subject, html, text, eventId, alertId, feeId, notificationId }) {
  const priority = type === 'emergency' ? 2 : 1;
  parents.forEach((parent) => {
    queue.push({ parentId: parent._id, email: parent.email, type, subject, html, text, eventId, alertId, feeId, notificationId, priority });
  });
  queue.sort((left, right) => right.priority - left.priority);
  setImmediate(processQueue);
}

async function recordSkipped(job, parent, reason) {
  await EmailLog.create({
    parent: job.parentId,
    email: (parent && parent.email) || job.email || 'unknown',
    type: job.type,
    event: job.eventId || null,
    alert: job.alertId || null,
    fee: job.feeId || null,
    notification: job.notificationId || null,
    status: 'skipped',
    errorMessage: reason,
  });
}

async function deliverOne(job) {
  let parent;
  try {
    parent = await User.findById(job.parentId).select('email role status emailVerified emailVerifiedBy');
    if (!parent || !['parent', 'teacher'].includes(parent.role)) {
      await recordSkipped(job, parent, 'Recipient account is unavailable.');
      return;
    }
    if (parent.status !== 'approved') {
      await recordSkipped(job, parent, 'Recipient account is not active.');
      return;
    }
    if (!parent.email) {
      await recordSkipped(job, parent, 'Recipient account has no email address.');
      return;
    }

    let result = await sendEmail({ to: parent.email, subject: job.subject, html: job.html, text: job.text });
    if (!result.success) {
      const retry = await sendEmail({ to: parent.email, subject: job.subject, html: job.html, text: job.text });
      if (retry.success) result = retry;
      else result = { success: false, error: `${result.error}; retry failed: ${retry.error}` };
    }
    await EmailLog.create({
      parent: parent._id,
      email: parent.email,
      type: job.type,
      event: job.eventId || null,
      alert: job.alertId || null,
      fee: job.feeId || null,
      notification: job.notificationId || null,
      status: result.success ? 'sent' : 'failed',
      errorMessage: result.success ? '' : result.error,
      sentAt: result.success ? new Date() : null,
    });
  } catch (error) {
    console.error('[email] delivery tracking failed:', error.message);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      await deliverOne(job);
    }
  } finally {
    processing = false;
    if (queue.length) setImmediate(processQueue);
  }
}

module.exports = { queueEmailDelivery };