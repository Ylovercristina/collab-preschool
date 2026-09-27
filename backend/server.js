require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const ensureSeedAdmin = require('./utils/seed');

const app = express();

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', name: 'Play-is-School API' }));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));
app.use('/api/progress', require('./routes/progressRoutes'));
app.use('/api/fees', require('./routes/feeRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/pickup', require('./routes/pickupRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));

app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  await ensureSeedAdmin();
  app.listen(PORT, () => console.log(`[server] Play-is-School API running on port ${PORT}`));
});
