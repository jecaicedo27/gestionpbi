// services/cacheService.js

const Redis = require('ioredis');
const logger = require('../utils/logger');
require('dotenv').config();

class CacheService {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            maxRetriesPerRequest: null,
        });

        this.redis.on('error', (err) => {
            // Prevent crashing if Redis is not available locally during dev
            logger.error('Redis connection error:', err);
        });

        this.defaultTTL = 300; // 5 minutes
    }

    async get(key) {
        try {
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null; // Fail gracefully
        }
    }

    async set(key, value, ttl = this.defaultTTL) {
        try {
            await this.redis.setex(key, ttl, JSON.stringify(value));
        } catch (e) {
            // Ignore set errors
        }
    }

    async invalidatePattern(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } catch (e) {
            // Ignore
        }
    }

    async getOrFetch(key, fetchFn, ttl = this.defaultTTL) {
        let cached = await this.get(key);
        if (cached) return cached;

        const data = await fetchFn();
        await this.set(key, data, ttl);
        return data;
    }
}

module.exports = new CacheService();
