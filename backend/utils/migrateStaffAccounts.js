const User = require('../models/User');
const { POSITIONS } = require('../config/permissions');

// Registrar, Finance Officer and Auditor used to be admin accounts; they are now staff accounts.
// Moves any admin account still holding a staff role to the staff type, keeping its role and any
// custom permissions, and signs it out so the next login opens the Staff Panel. Safe to run every startup.
async function migrateStaffAccounts() {
  const staffPositions = POSITIONS.filter((position) => position.accountType === 'staff').map((position) => position.key);
  const result = await User.updateMany(
    { role: 'admin', position: { $in: staffPositions } },
    { $set: { role: 'staff', sessionsValidAfter: new Date(Math.floor(Date.now() / 1000) * 1000) } }
  );
  if (result.modifiedCount) console.log(`[migrate] Moved ${result.modifiedCount} account(s) from admin to staff.`);
}

module.exports = migrateStaffAccounts;
