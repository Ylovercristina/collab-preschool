// Role-based access control catalog for Play-is-School.
//
// Each account still has an account type (`role`: admin / teacher / parent) that decides which
// dashboard it uses. On top of that, every account has a `position` (its job in the school) and a
// permission set per module:
//   view    = Limited access: open the module and do the everyday actions it allows
//   manage  = Full access: create, edit, delete and manage the module's records
//   approve = Approval access: review and approve the module's transactions
// No box ticked = No access. "manage" and "approve" always include "view".

const ACTIONS = ['view', 'manage', 'approve'];

// key, label, which account types the module exists for, and whether it has an approval step.
const MODULES = [
  { key: 'dashboard', label: 'Dashboard', types: ['admin', 'teacher', 'parent'], approvable: false },
  { key: 'users', label: 'User Management', types: ['admin'], approvable: true, approveHint: 'Approve or reject parent registrations' },
  { key: 'students', label: 'Students', types: ['admin', 'teacher', 'parent'], approvable: false },
  { key: 'classes', label: 'Classes', types: ['admin'], approvable: false },
  { key: 'enrollment', label: 'Enrollment', types: ['admin', 'teacher', 'parent'], approvable: true, approveHint: 'Approve or reject enrollment applications' },
  { key: 'records', label: 'Records Management', types: ['admin'], approvable: false },
  { key: 'attendance', label: 'Attendance', types: ['teacher', 'parent'], approvable: false },
  { key: 'progress', label: 'Academic Progress', types: ['admin', 'teacher', 'parent'], approvable: true, approveHint: 'Mark progress records as reviewed' },
  { key: 'fees', label: 'Fees & Payments', types: ['admin', 'teacher', 'parent'], approvable: false },
  { key: 'events', label: 'Events & Calendar', types: ['admin', 'teacher', 'parent'], approvable: true, approveHint: 'Review and approve teacher events' },
  { key: 'messages', label: 'Messages', types: ['teacher', 'parent'], approvable: false },
  { key: 'alerts', label: 'Emergency Alerts', types: ['admin', 'teacher', 'parent'], approvable: false },
  { key: 'pickup', label: 'Pickup Authorization', types: ['admin', 'teacher', 'parent'], approvable: true, approveHint: 'Verify pickups at release' },
  { key: 'reports', label: 'Reports', types: ['admin'], approvable: false },
  { key: 'logs', label: 'Activity Logs', types: ['admin'], approvable: false },
  { key: 'settings', label: 'System Settings', types: ['admin'], approvable: false },
];

const MODULE_KEYS = MODULES.map((module) => module.key);

const F = { view: true, manage: true, approve: false }; // Full access
const FA = { view: true, manage: true, approve: true }; // Full access + approval
const L = { view: true, manage: false, approve: false }; // Limited access
const A = { view: true, manage: false, approve: true }; // Approval access
const N = { view: false, manage: false, approve: false }; // No access

// Positions (the eight roles), adapted from the reference access-control matrix:
//   System Administrator -> System Administrator     Store Manager     -> Principal
//   Inventory Officer    -> Registrar               Purchasing Officer -> Finance Officer
//   Warehouse Staff      -> Teacher                 Sales Cashier      -> Parent / Guardian (self-service)
//   Sales Associate      -> Teacher Aide            Auditor            -> Auditor
const POSITIONS = [
  {
    key: 'system_admin', label: 'System Administrator', accountType: 'admin', locked: true,
    description: 'Manage users, roles, permissions and system configuration.',
    defaults: Object.fromEntries(MODULE_KEYS.map((key) => [key, FA])),
  },
  {
    key: 'principal', label: 'Principal', accountType: 'admin',
    description: 'Oversee school operations and approve enrollments, events and progress reviews.',
    defaults: {
      dashboard: L, users: A, students: F, classes: F, enrollment: FA, records: F, progress: A,
      fees: L, events: FA, alerts: F, pickup: L, reports: L, logs: L, settings: N,
    },
  },
  {
    key: 'registrar', label: 'Registrar', accountType: 'admin',
    description: 'Maintain student records, classes and enrollment.',
    defaults: {
      dashboard: L, users: N, students: F, classes: F, enrollment: F, records: F, progress: L,
      fees: N, events: L, alerts: L, pickup: L, reports: L, logs: N, settings: N,
    },
  },
  {
    key: 'finance_officer', label: 'Finance Officer', accountType: 'admin',
    description: 'Manage fee statements, payments and receipts.',
    defaults: {
      dashboard: L, users: N, students: L, classes: N, enrollment: L, records: N, progress: N,
      fees: F, events: L, alerts: L, pickup: N, reports: L, logs: N, settings: N,
    },
  },
  {
    key: 'auditor', label: 'Auditor', accountType: 'admin',
    description: 'Review records, payments, reports and activity logs (read-only).',
    defaults: {
      dashboard: L, users: N, students: L, classes: L, enrollment: L, records: L, progress: L,
      fees: L, events: L, alerts: L, pickup: L, reports: L, logs: L, settings: N,
    },
  },
  {
    key: 'teacher', label: 'Teacher', accountType: 'teacher',
    description: 'Teach assigned classes: attendance, progress, messages, events and pickups.',
    defaults: {
      dashboard: L, students: F, enrollment: L, attendance: F, progress: F, fees: L,
      events: F, messages: F, alerts: F, pickup: FA,
    },
  },
  {
    key: 'teacher_aide', label: 'Teacher Aide', accountType: 'teacher',
    description: 'Assist teachers: take attendance, verify pickups and check student information.',
    defaults: {
      dashboard: L, students: L, enrollment: N, attendance: F, progress: L, fees: N,
      events: L, messages: F, alerts: L, pickup: A,
    },
  },
  {
    key: 'parent', label: 'Parent / Guardian', accountType: 'parent',
    description: "Follow their child's progress, attendance, fees and school events.",
    defaults: {
      dashboard: L, students: L, enrollment: L, attendance: L, progress: L, fees: L,
      events: L, messages: F, alerts: L, pickup: F,
    },
  },
];

const POSITION_KEYS = POSITIONS.map((position) => position.key);
const DEFAULT_POSITION_BY_ROLE = { admin: 'system_admin', teacher: 'teacher', parent: 'parent' };

function positionInfo(key) {
  return POSITIONS.find((position) => position.key === key) || null;
}

function moduleAppliesTo(moduleKey, accountType) {
  const module = MODULES.find((item) => item.key === moduleKey);
  return Boolean(module && module.types.includes(accountType));
}

// Cleans an incoming permission map: known modules only, booleans only, manage/approve imply view,
// approve only where the module has an approval step, and nothing for modules the account type lacks.
function normalizePermissions(input, accountType) {
  const result = {};
  MODULES.forEach((module) => {
    const raw = (input && typeof input === 'object' && input[module.key]) || {};
    if (!module.types.includes(accountType)) {
      result[module.key] = { ...N };
      return;
    }
    const manage = raw.manage === true;
    const approve = module.approvable && raw.approve === true;
    result[module.key] = { view: raw.view === true || manage || approve, manage, approve };
  });
  return result;
}

function positionForUser(user) {
  const info = positionInfo(user && user.position);
  if (info && info.accountType === user.role) return info.key;
  return DEFAULT_POSITION_BY_ROLE[user && user.role] || null;
}

module.exports = {
  ACTIONS,
  MODULES,
  MODULE_KEYS,
  POSITIONS,
  POSITION_KEYS,
  DEFAULT_POSITION_BY_ROLE,
  positionInfo,
  moduleAppliesTo,
  normalizePermissions,
  positionForUser,
};
