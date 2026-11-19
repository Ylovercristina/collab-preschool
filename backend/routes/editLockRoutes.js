const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/editLockController');

router.use(protect);
router.post('/', ctrl.acquire);
router.delete('/', ctrl.release);

module.exports = router;
