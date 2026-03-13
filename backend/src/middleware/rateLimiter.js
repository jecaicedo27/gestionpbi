const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000, // Increased from 500 to 5000
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // Increased from 5 to 100
    skipSuccessfulRequests: true,
    message: 'Too many login attempts, please try again later'
});

module.exports = { generalLimiter, loginLimiter };
