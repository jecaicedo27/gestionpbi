const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/drivers?q=nombre — buscar conductores guardados
router.get('/', auth, async (req, res) => {
    try {
        const { q = '' } = req.query;
        const drivers = await prisma.driver.findMany({
            where: q ? {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { cedula: { contains: q, mode: 'insensitive' } },
                    { licensePlate: { contains: q, mode: 'insensitive' } },
                ]
            } : {},
            orderBy: [{ usageCount: 'desc' }, { lastUsed: 'desc' }],
            take: 8,
        });
        res.json({ success: true, data: drivers });
    } catch (err) {
        console.error('Error fetching drivers:', err);
        res.status(500).json({ success: false, error: 'Error al buscar conductores' });
    }
});

// POST /api/drivers/upsert — guardar o actualizar conductor
router.post('/upsert', auth, async (req, res) => {
    try {
        const { name, cedula, phone, licensePlate } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Nombre requerido' });

        let driver;
        if (cedula) {
            driver = await prisma.driver.upsert({
                where: { cedula },
                update: {
                    name,
                    phone: phone || undefined,
                    licensePlate: licensePlate || undefined,
                    usageCount: { increment: 1 },
                    lastUsed: new Date(),
                },
                create: { name, cedula, phone, licensePlate },
            });
        } else {
            // No cedula — match by name (case-insensitive)
            const existing = await prisma.driver.findFirst({
                where: { name: { equals: name, mode: 'insensitive' }, cedula: null },
            });
            if (existing) {
                driver = await prisma.driver.update({
                    where: { id: existing.id },
                    data: {
                        phone: phone || existing.phone,
                        licensePlate: licensePlate || existing.licensePlate,
                        usageCount: { increment: 1 },
                        lastUsed: new Date(),
                    },
                });
            } else {
                driver = await prisma.driver.create({ data: { name, phone, licensePlate } });
            }
        }

        res.json({ success: true, data: driver });
    } catch (err) {
        console.error('Error upserting driver:', err);
        res.status(500).json({ success: false, error: 'Error al guardar conductor' });
    }
});

module.exports = router;
