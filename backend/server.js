const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const ensureSeedAdmin = require('./utils/seed');
const migrateStaffAccounts = require('./utils/migrateStaffAccounts');
const authController = require('./controllers/authController');
const authRoutes = require('./routes/authRoutes');
const emailService = require('./services/emailService');
const { startArchivedAccountPurge } = require('./utils/accountPurge');
const { startAutomaticBackups } = require('./services/backupService');
const { limits } = require('./middleware/rateLimit');

const app = express();

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  exposedHeaders: ['X-Integration-Access-Refresh'],
}));
app.use(express.json());
// Express 5 leaves req.body undefined when a request has no body; default it to {} so handlers
// answer with a validation message (400) instead of crashing with a 500.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
// Rate limiting: a general limit per session/IP, and a tighter one for saves.
app.use('/api', limits.api, limits.writes);
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', name: 'Play-is-School API' }));
app.get('/api/config/maps', (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    mapTilerApiKey: String(process.env.MAPTILER_API_KEY || '').trim(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/permissions', require('./routes/permissionRoutes'));
app.use('/api/backups', require('./routes/backupRoutes'));
app.use('/api/locks', require('./routes/editLockRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/enrollment', require('./routes/enrollmentRoutes'));
app.use('/api/records', require('./routes/recordsRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));
app.use('/api/progress', require('./routes/progressRoutes'));
app.use('/api/fees', require('./routes/feeRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/calendar', require('./routes/calendarRoutes'));
app.use('/api/drive', require('./routes/driveRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/pickup', require('./routes/pickupRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));

app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((err, req, res, next) => {
  // Client mistakes get a 4xx with a readable message instead of a generic 500.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'The request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'The request is too large.' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for ${err.path === '_id' ? 'ID' : err.path}.` });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 5000;

function logRegisteredAuthRoutes() {
  console.log('[server] Registered auth routes:');
  authRoutes.stack
    .filter((layer) => layer.route)
    .forEach((layer) => {
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      Object.keys(layer.route.methods).forEach((method) => {
        console.log(`[server] ${method.toUpperCase()} /api/auth${routePath}`);
      });
    });
}

connectDB().then(async () => {
  await ensureSeedAdmin();
  await migrateStaffAccounts();
  try {
    await emailService.verifyEmailTransport();
    console.log('Email server ready');
  } catch (err) {
    console.error('[email] SMTP verification failed:', emailService.emailTransportError(err));
  }
  logRegisteredAuthRoutes();
  // Archived accounts not restored within 30 days are deleted permanently (checked hourly).
  startArchivedAccountPurge();
  // Daily automatic database backup (newest 14 kept).
  startAutomaticBackups();
  app.listen(PORT, () => console.log(`[server] Play-is-School API running on port ${PORT}`));
});
