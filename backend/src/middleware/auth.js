const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const allowedIpsService = require('../services/allowedIpsService');
const prisma = new PrismaClient();

/**
 * Extract the real client IP from the request.
 * Nginx must forward X-Real-IP / X-Forwarded-For headers.
 */
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // X-Forwarded-For can be "client, proxy1, proxy2" — take the first
        return forwarded.split(',')[0].trim();
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) return realIp.trim();
    // Fallback to req.ip (Express) — strip IPv6 prefix
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
};

/**
 * Check if a client IP is from an allowed internal network.
 * Allowed IPs are configured in .env ALLOWED_IPS (comma-separated).
 * Localhost (127.0.0.1, ::1) is always allowed.
 */
const isInternalNetwork = (ip) => {
    if (!ip) return false;
    const clean = ip.replace(/^::ffff:/, '');
    // Localhost always allowed
    if (['127.0.0.1', '::1', 'localhost'].includes(clean)) return true;
    // Private ranges (in case the server is on the same LAN)
    if (clean.startsWith('192.168.') || clean.startsWith('10.') || clean.startsWith('172.')) return true;
    // Configured allowed IPs (env)
    const allowedIps = (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowedIps.includes(clean)) return true;
    // Dynamic allowed IPs (admin-managed, JSON file — hot-reloaded)
    return allowedIpsService.isAllowed(clean);
};

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;

        if (!token) {
            throw new Error();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId, active: true }
        });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'No autenticado' });
    }
};

const roles = (...args) => {
    // Support both roles('ADMIN', 'CALIDAD') and roles(['ADMIN'])
    const allowedRoles = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Sin permisos' });
        }
        next();
    };
};

module.exports = { auth, roles, getClientIp, isInternalNetwork };
