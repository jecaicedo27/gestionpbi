const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '/var/www/gestionpbi/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { getClientIp, isInternalNetwork } = require('../middleware/auth');

const prisma = new PrismaClient();

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const clientIp = getClientIp(req);

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.active) {
            return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
        }

        // ── Network Access Control ──────────────────────────────────────
        // External networks: only EXTERNAL_ADMIN_EMAIL and DISTRIBUIDOR users can log in.
        // Internal network (ALLOWED_IPS): any user can log in.
        const externalAdmin = (process.env.EXTERNAL_ADMIN_EMAIL || '').toLowerCase();
        if (!isInternalNetwork(clientIp)) {
            const isAdmin = email?.toLowerCase() === externalAdmin;
            const isDistribuidor = user.role === 'DISTRIBUIDOR';
            if (!isAdmin && !isDistribuidor) {
                logger.warn(`⛔ External login blocked: ${email} (${user.role}) from IP ${clientIp}`);
                return res.status(403).json({
                    error: '⛔ Acceso denegado. Solo se permite el ingreso desde la red interna de la empresa.'
                });
            }
            logger.info(`🌐 External login allowed: ${email} (${user.role}) from IP ${clientIp}`);
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Generate token
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        // Return user data (excluding password) and token
        const { password: _, ...userData } = user;

        res.json({
            success: true,
            user: userData,
            token
        });

        logger.info(`User logged in: ${user.email}`);
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Error en el servidor' });
    }
};

const getMe = async (req, res) => {
    try {
        const user = req.user;
        const { password: _, pin: _p, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo perfil' });
    }
};

// ── PIN-based quick login (lock screen) ──────────────────────────
const pinLogin = async (req, res) => {
    try {
        // ── Network restriction: PIN login only from internal network ──
        const clientIp = getClientIp(req);
        if (!isInternalNetwork(clientIp)) {
            logger.warn(`⛔ External PIN login blocked from IP ${clientIp}`);
            return res.status(403).json({
                error: '⛔ Acceso por PIN solo disponible desde la red interna de la empresa.'
            });
        }

        const { pin } = req.body;
        if (!pin || !/^\d{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN debe ser exactamente 4 dígitos' });
        }

        // Fetch all active non-DISTRIBUIDOR users that have a PIN set
        const users = await prisma.user.findMany({
            where: {
                active: true,
                pin: { not: null },
                role: { not: 'DISTRIBUIDOR' }
            }
        });

        // Compare against each user's hashed PIN
        let matchedUser = null;
        for (const u of users) {
            const isMatch = await bcrypt.compare(pin, u.pin);
            if (isMatch) {
                matchedUser = u;
                break;
            }
        }

        if (!matchedUser) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        // Update last login
        await prisma.user.update({
            where: { id: matchedUser.id },
            data: { lastLogin: new Date() }
        });

        // Generate token
        const token = jwt.sign(
            { userId: matchedUser.id, role: matchedUser.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        const { password: _, pin: _p2, ...userData } = matchedUser;

        res.json({ success: true, user: userData, token });
        logger.info(`PIN login: ${matchedUser.name} (${matchedUser.role})`);
    } catch (error) {
        logger.error('PIN login error:', error);
        res.status(500).json({ success: false, error: 'Error en el servidor' });
    }
};

// ── Set/Update PIN (admin or self) ───────────────────────────────
const setPin = async (req, res) => {
    try {
        const { pin, userId } = req.body;

        if (!pin || !/^\d{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN debe ser exactamente 4 dígitos numéricos' });
        }

        // Determine target user: admin can set for any user, others only for themselves
        const targetId = (req.user.role === 'ADMIN' && userId) ? userId : req.user.id;

        // Check PIN uniqueness: hash all active users' PINs and compare
        const usersWithPin = await prisma.user.findMany({
            where: { active: true, pin: { not: null }, id: { not: targetId } }
        });

        for (const u of usersWithPin) {
            const isDuplicate = await bcrypt.compare(pin, u.pin);
            if (isDuplicate) {
                return res.status(409).json({ error: `PIN ya está en uso por otro usuario` });
            }
        }

        const hashedPin = await bcrypt.hash(pin, 10);
        await prisma.user.update({
            where: { id: targetId },
            data: { pin: hashedPin }
        });

        res.json({ success: true, message: 'PIN actualizado correctamente' });
        logger.info(`PIN set for user ${targetId} by ${req.user.email}`);
    } catch (error) {
        logger.error('Set PIN error:', error);
        res.status(500).json({ success: false, error: 'Error al establecer PIN' });
    }
};

// ── Remove PIN ───────────────────────────────────────────────────
const removePin = async (req, res) => {
    try {
        const { userId } = req.params;
        const targetId = (req.user.role === 'ADMIN' && userId) ? userId : req.user.id;

        await prisma.user.update({
            where: { id: targetId },
            data: { pin: null }
        });

        res.json({ success: true, message: 'PIN eliminado' });
        logger.info(`PIN removed for user ${targetId} by ${req.user.email}`);
    } catch (error) {
        logger.error('Remove PIN error:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar PIN' });
    }
};

module.exports = { login, getMe, pinLogin, setPin, removePin };
