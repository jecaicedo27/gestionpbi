const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

module.exports = { auth, roles };
