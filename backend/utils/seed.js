const User = require('../models/User');

// Creates the first admin account automatically if the database has none yet,
// using the SEED_ADMIN_* values from .env. Safe to run every startup.
async function ensureSeedAdmin() {
  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) return;

  const name = process.env.SEED_ADMIN_NAME || 'Super Admin';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@playngrow.test';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';

  await User.create({ name, email, password, role: 'admin', status: 'approved' });
  console.log(`[seed] Created initial admin account -> ${email} / ${password} (change the password after first login)`);
}

module.exports = ensureSeedAdmin;
