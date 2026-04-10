const express = require('express');
const cors = require('cors');
const { json } = require('express');
const router = require('./routes');
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();
const path = require('path');

// Middleware
app.use(cors({
    origin: [
        'https://gestionpbi.lat',
        'https://www.gestionpbi.lat',
        'http://72.60.175.159',     // Tablet LAN access
        'http://localhost:5173',     // Dev mode
        'http://localhost:3000'      // Dev mode
    ],
    credentials: true,
    exposedHeaders: ['Content-Disposition']
}));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/rpa-screenshots', express.static(path.join(__dirname, 'rpa-screenshots')));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(generalLimiter);

// Routes
// Routes
app.use('/api', router);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// Error Handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = app;
