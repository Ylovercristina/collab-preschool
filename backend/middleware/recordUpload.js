const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDirectory = path.join(__dirname, '..', 'private-records');
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedTypes = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${allowedTypes[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes[file.mimetype] || allowedTypes[file.mimetype] !== extension) {
      return callback(new Error('Upload a PDF, JPG, PNG, WEBP, DOC or DOCX document.'));
    }
    callback(null, true);
  },
});

module.exports = { upload, uploadDirectory };
