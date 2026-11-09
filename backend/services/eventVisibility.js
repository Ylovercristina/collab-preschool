const Student = require('../models/Student');

async function isEventVisibleToUser(event, user) {
  if (!event || !user) return false;
  if (user.role === 'admin') return true;

  const audience = event.audience || 'parents';
  const createdByUser = String(event.createdBy && (event.createdBy._id || event.createdBy)) === String(user._id);
  if (user.role === 'parent' && !['all', 'parents'].includes(audience)) return false;
  if (user.role === 'teacher' && !['all', 'teachers'].includes(audience) && !createdByUser) return false;
  if (!['parent', 'teacher'].includes(user.role)) return false;

  if (event.targetType !== 'classes') return true;
  if (user.role === 'teacher' && createdByUser) return true;

  const classNames = user.role === 'parent'
    ? await Student.distinct('className', { parent: user._id, status: 'active' })
    : [
      ...await Student.distinct('className', { teacher: user._id, status: 'active' }),
      ...(user.assignedClass ? [user.assignedClass] : []),
    ];
  return (event.targetClasses || []).some((className) => classNames.includes(className));
}

module.exports = { isEventVisibleToUser };
