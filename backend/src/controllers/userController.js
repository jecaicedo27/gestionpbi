const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

const getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true, role: true, nit: true, idType: true, discountPercent: true, reteFuente: true, createdAt: true, pin: true }
        });
        // Map pin hash → boolean flag (never expose the hash)
        const safeUsers = users.map(({ pin, ...u }) => ({ ...u, hasPin: !!pin }));
        res.json({ success: true, data: safeUsers });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
};

const createUser = async (req, res) => {
    try {
        const { name, email, password, role, username, nit, idType, discountPercent, reteFuente } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        // Auto-generate username from email if not provided
        const finalUsername = username || email.split('@')[0];

        const user = await prisma.user.create({
            data: { name, email, username: finalUsername, password: hashedPassword, role, nit: nit || null, idType: idType || '13', discountPercent: discountPercent !== undefined ? parseFloat(discountPercent) : 34.8, reteFuente: reteFuente !== undefined ? Boolean(reteFuente) : true }
        });

        res.json({ success: true, data: { id: user.id, email: user.email } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creating user' });
    }
};

const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.user.delete({ where: { id } });
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting user' });
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { nit, name, role, idType, discountPercent, reteFuente } = req.body;
        const data = {};
        if (nit !== undefined) data.nit = nit || null;
        if (idType !== undefined) data.idType = idType || '13';
        if (discountPercent !== undefined) data.discountPercent = parseFloat(discountPercent) || 34.8;
        if (reteFuente !== undefined) data.reteFuente = Boolean(reteFuente);
        if (name) data.name = name;
        if (role) data.role = role;

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, name: true, email: true, role: true, nit: true, idType: true, discountPercent: true, reteFuente: true }
        });
        res.json({ success: true, data: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating user' });
    }
};

module.exports = { getUsers, createUser, deleteUser, updateUser };
