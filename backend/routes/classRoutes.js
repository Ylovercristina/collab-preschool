const router = require('express').Router();
const { protect, allowRoles, requirePermission: P, requireAnyPermission } = require('../middleware/auth');
const ctrl = require('../controllers/classController');
const Classroom = require('../models/Classroom');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect, allowRoles('admin', 'staff'));
// Student forms also read the class list, so student managers may list classes too.
router.get('/', requireAnyPermission(['classes', 'view'], ['students', 'manage'], ['records', 'manage']), ctrl.listClasses);
router.post('/', P('classes', 'manage'), ctrl.createClass);
router.patch('/:id', P('classes', 'manage'), versionGuard(Classroom, { label: 'class', lock: 'class' }), ctrl.updateClass);
router.patch('/:id/archive', P('classes', 'manage'), ctrl.archiveClass);
router.patch('/:id/restore', P('classes', 'manage'), ctrl.restoreClass);

module.exports = router;
