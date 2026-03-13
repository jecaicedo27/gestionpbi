const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

const getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true, role: true, nit: true, createdAt: true }
        });
        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
};

const createUser = async (req, res) => {
    try {
        const { name, email, password, role, username, nit } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        // Auto-generate username from email if not provided
        const finalUsername = username || email.split('@')[0];

        const user = await prisma.user.create({
            data: { name, email, username: finalUsername, password: hashedPassword, role, nit: nit || null }
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
        const { nit, name, role } = req.body;
        const data = {};
        if (nit !== undefined) data.nit = nit || null;
        if (name) data.name = name;
        if (role) data.role = role;

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, name: true, email: true, role: true, nit: true }
        });
        res.json({ success: true, data: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating user' });
    }
};

module.exports = { getUsers, createUser, deleteUser, updateUser };
