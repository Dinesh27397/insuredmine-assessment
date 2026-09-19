const express = require('express');
const router = express.Router();
const { importPolicyData } = require('../controllers/import.controller');

const upload = require('../middleware/upload');

router.post('/import', upload.single('file'), importPolicyData);

module.exports = router;