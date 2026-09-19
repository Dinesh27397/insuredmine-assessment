const express= require('express');
const dotenv = require('dotenv');
const importRoutes = require('./routes/import.routes');
const policyRoutes = require('./routes/policy.routes');
const messageRoutes = require('./routes/message.routes');
const helmet = require("helmet");
const cors = require('cors');
const rateLimit = require("express-rate-limit");


dotenv.config();





const app = express();


app.use(helmet());
app.use(cors({ origin: '*' }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '5mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false
});


app.get('/api/health', (req, res) => {
  res.send({ status: 'Up' ,uptime: process.uptime(), timestamp: new Date().toISOString(), message: 'API is running...' });
});


app.use('/api', apiLimiter);
app.use('/api', importRoutes);

app.use('/api/policies', policyRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/metrics/cpu', (req, res) => {
  res.json({ success: true, data: req.app.locals.cpuMonitor?.getMetrics() || null });
});

module.exports = app;

