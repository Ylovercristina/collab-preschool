const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDirectory = path.join(__dirname, '..', 'uploads', 'profiles');
fs.mkdirSync(uploadDirectory, { recursive: true });

const extensionsByMimeType = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: uploadDirectory,
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${extensionsByMimeType[file.mimetype] || ''}`);
  },
});

function fileFilter(req, file, callback) {
  if (!extensionsByMimeType[file.mimetype]) {
    return callback(new Error('Profile image must be a JPG, PNG or WEBP file.'));
  }
  callback(null, true);
}

module.exports = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter,
});