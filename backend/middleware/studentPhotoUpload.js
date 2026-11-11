const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { hasImageSignature } = require('./progressUpload');

// Private folder: never served statically; photos are streamed only after a permission check.
const studentPhotoDirectory = path.join(__dirname, '..', 'private-records', 'student-photos');
fs.mkdirSync(studentPhotoDirectory, { recursive: true });

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const allowedTypes = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: studentPhotoDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${allowedTypes[file.mimetype][0]}`),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes[file.mimetype] || !allowedTypes[file.mimetype].includes(extension)) {
      return callback(new Error('The student photo must be a JPG, PNG or WEBP image.'));
    }
    callback(null, true);
  },
});

function photoPath(filename) {
  return path.join(studentPhotoDirectory, path.basename(String(filename || '')));
}

async function removeStudentPhotoFile(filename) {
  if (!filename) return;
  await fs.promises.unlink(photoPath(filename)).catch((err) => {
    if (err.code !== 'ENOENT') console.error('[students] Could not remove photo:', err.message);
  });
}

// Copies a stored photo to a new file so two records never share (and delete) one file.
async function copyStudentPhoto(photo) {
  if (!photo || !photo.filename) return undefined;
  const filename = `${crypto.randomUUID()}${path.extname(photo.filename)}`;
  await fs.promises.copyFile(photoPath(photo.filename), photoPath(filename));
  return { filename, mimetype: photo.mimetype, size: photo.size, uploadedAt: new Date() };
}

function photoRecord(file) {
  return { filename: file.filename, mimetype: file.mimetype, size: file.size, uploadedAt: new Date() };
}

// Accepts one optional image in `fieldName`; the route handler decides whether it is required.
function uploadStudentPhoto(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, async (err) => {
      if (err) {
        if (req.file) await removeStudentPhotoFile(req.file.filename);
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'The student photo must be 5 MB or smaller.'
          : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
            ? 'Attach one student photo.'
            : err.message;
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message });
      }
      if (!req.file) return next();
      try {
        if (!(await hasImageSignature(req.file))) {
          await removeStudentPhotoFile(req.file.filename);
          return res.status(400).json({ message: 'The student photo is not a valid image file.' });
        }
        return next();
      } catch {
        await removeStudentPhotoFile(req.file.filename);
        return res.status(400).json({ message: 'The student photo could not be read. Try again.' });
      }
    });
  };
}

// Streams a stored photo with private, no-store headers.
function sendStudentPhoto(res, photo) {
  res.set({
    'Content-Type': photo.mimetype,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(photoPath(photo.filename), (err) => {
    if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ message: 'Photo file is missing.' });
  });
}

module.exports = {
  uploadStudentPhoto,
  removeStudentPhotoFile,
  copyStudentPhoto,
  photoRecord,
  sendStudentPhoto,
};
