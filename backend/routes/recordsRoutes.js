const router = require('express').Router();
const fs = require('fs');
const { protect, allowRoles, requirePermission: P, requireAnyPermission } = require('../middleware/auth');
const { upload } = require('../middleware/recordUpload');
const ctrl = require('../controllers/recordsController');
const Student = require('../models/Student');
const User = require('../models/User');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect, allowRoles('admin', 'staff'));

function uploadDocuments(req, res, next) {
  upload.array('documents', 5)(req, res, async (err) => {
    if (!err) return next();
    await Promise.all((req.files || []).map((file) => fs.promises.unlink(file.path).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') console.error('Could not remove incomplete record upload:', cleanupError);
    })));
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code === 'LIMIT_FILE_COUNT' ? 400 : 400;
    return res.status(status).json({
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Each document must be 10 MB or smaller.'
        : err.message,
    });
  });
}

router.get('/students', P('records', 'view'), ctrl.listStudents);
router.post('/students', P('records', 'manage'), ctrl.createStudent);
router.patch('/students/:id', P('records', 'manage'), versionGuard(Student, { label: 'student record', lock: 'student' }), ctrl.updateStudent);
// The Classes form uses this teacher list as well.
router.get('/teachers', requireAnyPermission(['records', 'view'], ['classes', 'view']), ctrl.listTeachers);
router.post('/teachers', P('records', 'manage'), ctrl.createTeacher);
router.patch('/teachers/:id', P('records', 'manage'), versionGuard(User, { label: 'teacher record', lock: 'user' }), ctrl.updateTeacher);
router.post('/:type/:id/documents', P('records', 'manage'), uploadDocuments, ctrl.uploadDocuments);
router.get('/:type/:id/documents/:documentId', P('records', 'view'), ctrl.downloadDocument);
router.delete('/:type/:id/documents/:documentId', P('records', 'manage'), ctrl.deleteDocument);

module.exports = router;
