const Queue = require('bull');
const logger = require('../utils/logger');
require('dotenv').config();

// Create Queue
const rpaQueue = new Queue('rpa-tasks', {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000
        },
        removeOnComplete: true,
        removeOnFail: false
    }
});

// Event Listeners
rpaQueue.on('completed', (job, result) => {
    logger.info(`Job ${job.id} completed! Result: ${JSON.stringify(result)}`);
});

rpaQueue.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed: ${err.message}`);
});

module.exports = rpaQueue;
