/**
 * siigoQueue.js — Simple mutex/queue for Siigo API calls.
 * Ensures only ONE Siigo-heavy operation runs at a time,
 * preventing 429 rate-limit conflicts between CRON jobs and manual syncs.
 */
const logger = require('../utils/logger');

class SiigoQueue {
    constructor() {
        this.running = null; // name of current job
        this.queue = [];     // [{name, fn, resolve, reject}]
    }

    /**
     * Enqueue a Siigo job. Only one runs at a time.
     * @param {string} name  - Job label for logging
     * @param {Function} fn  - Async function to execute
     * @returns {Promise}     - Resolves with fn's return value
     */
    enqueue(name, fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ name, fn, resolve, reject });
            logger.info(`📋 SiigoQueue: "${name}" enqueued (queue size: ${this.queue.length}, running: ${this.running || 'none'})`);
            this._processNext();
        });
    }

    async _processNext() {
        if (this.running || this.queue.length === 0) return;

        const job = this.queue.shift();
        this.running = job.name;
        logger.info(`▶️ SiigoQueue: Starting "${job.name}" (${this.queue.length} waiting)`);

        try {
            const result = await job.fn();
            job.resolve(result);
        } catch (err) {
            job.reject(err);
        } finally {
            logger.info(`✅ SiigoQueue: "${job.name}" finished`);
            this.running = null;
            this._processNext();
        }
    }

    /** Check if a specific job type is running */
    isRunning(name) {
        return this.running === name;
    }

    /** Get queue status */
    status() {
        return {
            running: this.running,
            queued: this.queue.map(j => j.name)
        };
    }
}

// Singleton
module.exports = new SiigoQueue();
