const router = require('express').Router();
const fs = require('fs');
const { protect, allowRoles } = require('../middleware/auth');
const { upload } = require('../middleware/recordUpload');
const ctrl = require('../controllers/recordsController');

router.use(protect, allowRoles('admin'));

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

router.get('/students', ctrl.listStudents);
router.post('/students', ctrl.createStudent);
router.patch('/students/:id', ctrl.updateStudent);
router.get('/teachers', ctrl.listTeachers);
router.post('/teachers', ctrl.createTeacher);
router.patch('/teachers/:id', ctrl.updateTeacher);
router.post('/:type/:id/documents', uploadDocuments, ctrl.uploadDocuments);
router.get('/:type/:id/documents/:documentId', ctrl.downloadDocument);
router.delete('/:type/:id/documents/:documentId', ctrl.deleteDocument);

module.exports = router;
