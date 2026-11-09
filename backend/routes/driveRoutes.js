const router = require('express').Router();
const ctrl = require('../controllers/calendarController');

router.get('/google/callback', ctrl.driveCallback);

module.exports = router;
