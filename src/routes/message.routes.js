const router = require('express').Router();
const { scheduleMessage } = require('../controllers/message.controller');

router.post('/', scheduleMessage);

module.exports = router;
