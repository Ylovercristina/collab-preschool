const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Private folder: never served statically; files are streamed only after a permission check.
const progressPhotoDirectory = path.join(__dirname, '..', 'private-records', 'progress');
fs.mkdirSync(progressPhotoDirectory, { recursive: true });

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS_PER_UPLOAD = 6;
const MAX_PHOTOS_PER_ENTRY = 12;

const allowedTypes = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: progressPhotoDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${allowedTypes[file.mimetype][0]}`),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_UPLOAD },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes[file.mimetype] || !allowedTypes[file.mimetype].includes(extension)) {
      return callback(new Error('Photos must be JPG, PNG or WEBP images.'));
    }
    callback(null, true);
  },
});

// Checks the file really is the image type it claims to be.
async function hasImageSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (file.mimetype === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally {
    await handle.close();
  }
}

async function removeUploadedFiles(files = []) {
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch((err) => {
    if (err.code !== 'ENOENT') console.error('[progress] Could not remove upload:', err.message);
  })));
}

function uploadProgressPhotos(req, res, next) {
  upload.array('photos', MAX_PHOTOS_PER_UPLOAD)(req, res, async (err) => {
    if (err) {
      await removeUploadedFiles(req.files);
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Each photo must be 5 MB or smaller.'
        : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          ? `Attach up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`
          : err.message;
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message });
    }
    try {
      const checks = await Promise.all((req.files || []).map(hasImageSignature));
      if (checks.includes(false)) {
        await removeUploadedFiles(req.files);
        return res.status(400).json({ message: 'One of the photos is not a valid image file.' });
      }
      return next();
    } catch (checkError) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'The photos could not be read. Try again.' });
    }
  });
}

module.exports = { uploadProgressPhotos, removeUploadedFiles, progressPhotoDirectory, MAX_PHOTOS_PER_ENTRY };
