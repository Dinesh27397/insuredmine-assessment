const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('node:fs');

const uploadDirectory = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.xls','.xlsx','.csv'];
  if (allowedTypes.includes(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only XLS, XLSX, and CSV are allowed.'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter,limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = upload;
