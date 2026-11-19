const mongoose = require('mongoose');

// Administrator-customized default permissions for a position (role).
// When no document exists for a position, the defaults in config/permissions.js apply.
const rolePermissionSchema = new mongoose.Schema(
  {
    position: { type: String, required: true, unique: true, trim: true },
    permissions: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
