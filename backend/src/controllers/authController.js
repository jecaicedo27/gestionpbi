const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '/var/www/gestionpbi/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

const login = async (req, res) => {
    try {
        console.log('Login Request Body:', req.body);
        const { email, password } = req.body;

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.active) {
            return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
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
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo perfil' });
    }
};

module.exports = { login, getMe };
