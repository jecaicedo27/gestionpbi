const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '/var/www/gestionpbi/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { getClientIp, isInternalNetwork } = require('../middleware/auth');
const { sendPushToAll } = require('../services/webPushService');
const { KIOSK_REQUIRED_ROLES } = require('./attendanceController');

const prisma = new PrismaClient();

const saveLoginAudit = (auditData) => {
    prisma.loginAudit.create({ data: auditData }).catch(e =>
        logger.error('LoginAudit save failed:', e.message)
    );
};

const getExternalAdminEmail = () => (process.env.EXTERNAL_ADMIN_EMAIL || '').toLowerCase();

const isExternalAdminUser = (user) => {
    const externalAdmin = getExternalAdminEmail();
    const userEmail = (user?.email || '').toLowerCase();
    return user?.role === 'ADMIN' || (externalAdmin && userEmail === externalAdmin);
};

const login = async (req, res) => {
    try {
        const { email, password, geoLat, geoLon } = req.body;
        const clientIp = getClientIp(req);
        const userAgent = req.headers['user-agent'] || null;

        // Helper: save audit record (fire-and-forget)
        const saveAudit = saveLoginAudit;

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.active) {
            saveAudit({ email: email || 'unknown', ip: clientIp, allowed: false, reason: 'USER_NOT_FOUND', geoLat: geoLat || null, geoLon: geoLon || null, userAgent });
            return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
        }

        // ── Network Access Control ──────────────────────────────────────
        if (!isInternalNetwork(clientIp)) {
            const isAdmin = isExternalAdminUser(user);
            const isDistribuidor = user.role === 'DISTRIBUIDOR';
            const isContabilidad = user.role === 'CONTABILIDAD';
            if (!isAdmin && !isDistribuidor && !isContabilidad) {
                logger.warn(`⛔ External login blocked: ${email} (${user.role}) from IP ${clientIp}`);
                saveAudit({ email, role: user.role, ip: clientIp, allowed: false, reason: 'EXTERNAL_BLOCKED', geoLat: geoLat || null, geoLon: geoLon || null, userAgent });

                // 🚨 Push notification alert to admin
                sendPushToAll({
                    title: '🚨 Intento de acceso bloqueado',
                    body: `${email} (${user.role}) intentó ingresar desde IP ${clientIp}`,
                    tag: 'security-alert',
                    data: { url: '/security-map.html' }
                }).catch(() => {});

                return res.status(403).json({
                    error: '⛔ Acceso denegado. Solo se permite el ingreso desde la red interna de la empresa.'
                });
            }
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            saveAudit({ email, role: user.role, ip: clientIp, allowed: false, reason: 'WRONG_PASSWORD', geoLat: geoLat || null, geoLon: geoLon || null, userAgent });
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // ── Successful login ────────────────────────────────────────────
        const isInternal = isInternalNetwork(clientIp);
        const reason = isInternal ? 'INTERNAL'
            : isExternalAdminUser(user) ? 'ADMIN_EXTERNAL'
                : user.role === 'CONTABILIDAD' ? 'CONTABILIDAD_EXTERNAL'
                : 'DISTRIBUIDOR_EXTERNAL';

        saveAudit({ email, role: user.role, ip: clientIp, allowed: true, reason, geoLat: geoLat || null, geoLon: geoLon || null, userAgent });

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // ── Verificación de presencia en planta ─────────────────────────
        if (KIOSK_REQUIRED_ROLES.includes(user.role)) {
            const presenceSetting = await prisma.systemSettings.findUnique({
                where: { key: 'require_plant_presence' }
            });
            const presenceRequired = presenceSetting?.value !== false && presenceSetting?.value !== 'false';

            if (presenceRequired) {
                const shiftEmployee = await prisma.shiftEmployee.findUnique({
                    where: { userId: user.id },
                    select: { isInPlant: true, name: true }
                });
                if (shiftEmployee && !shiftEmployee.isInPlant) {
                    saveAudit({ email, role: user.role, ip: clientIp, allowed: false, reason: 'NOT_IN_PLANT', geoLat: geoLat || null, geoLon: geoLon || null, userAgent });
                    logger.warn(`⛔ Login bloqueado (no en planta): ${email}`);
                    return res.status(403).json({
                        error: '⛔ Debes registrar tu ingreso en el kiosko de planta antes de acceder.',
                        code: 'NOT_IN_PLANT'
                    });
                }
            }
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        const { password: _, ...userData } = user;

        res.json({ success: true, user: userData, token });
        logger.info(`User logged in: ${user.email} from ${clientIp} (${reason})`);
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
        const clientIp = getClientIp(req);
        const userAgent = req.headers['user-agent'] || null;
        const isInternal = isInternalNetwork(clientIp);

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
            saveLoginAudit({
                email: 'pin-login',
                ip: clientIp,
                allowed: false,
                reason: 'PIN_WRONG',
                userAgent
            });
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        // ── Network Access Control: external PIN login only for admins ──
        if (!isInternal && !isExternalAdminUser(matchedUser)) {
            logger.warn(`⛔ External PIN login blocked: ${matchedUser.email} (${matchedUser.role}) from IP ${clientIp}`);
            saveLoginAudit({
                email: matchedUser.email,
                role: matchedUser.role,
                ip: clientIp,
                allowed: false,
                reason: 'PIN_EXTERNAL_BLOCKED',
                userAgent
            });
            return res.status(403).json({
                error: '⛔ Acceso externo por PIN solo disponible para administradores.'
            });
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

        const reason = isInternal ? 'PIN_INTERNAL' : 'PIN_ADMIN_EXTERNAL';
        saveLoginAudit({
            email: matchedUser.email,
            role: matchedUser.role,
            ip: clientIp,
            allowed: true,
            reason,
            userAgent
        });

        res.json({ success: true, user: userData, token });
        logger.info(`PIN login: ${matchedUser.name} (${matchedUser.role}) from ${clientIp} (${reason})`);
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
