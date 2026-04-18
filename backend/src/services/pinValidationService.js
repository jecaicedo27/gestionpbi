/**
 * pinValidationService.js — Isolated PIN validation service.
 * Replicates the bcrypt-based PIN lookup used in shiftHandoffController
 * without modifying that controller. Both coexist independently.
 */
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Validate a 4-digit PIN against all active users.
 * Returns the matched User (with shiftEmployee data) or null.
 */
async function validatePin(pin) {
    if (!pin || !/^\d{4}$/.test(pin)) return null;

    const users = await prisma.user.findMany({
        where: { active: true, pin: { not: null }, role: { not: 'DISTRIBUIDOR' } },
        include: {
            shiftEmployee: { select: { id: true, area: true, role: true, name: true } }
        }
    });

    for (const u of users) {
        const isMatch = await bcrypt.compare(pin, u.pin);
        if (isMatch) return u;
    }
    return null;
}

/**
 * Build a standard audit log entry.
 */
function buildAuditEntry(action, user, req) {
    return {
        action,
        userId: user.id,
        name: user.name,
        at: new Date().toISOString(),
        ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        device: (req.headers?.['user-agent'] || 'unknown').substring(0, 150)
    };
}

module.exports = { validatePin, buildAuditEntry };
