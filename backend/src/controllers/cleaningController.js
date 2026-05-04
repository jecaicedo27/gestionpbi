const { PrismaClient } = require('@prisma/client');
const cleaningService = require('../services/cleaningService');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';
const isSupervisor = (user) => user?.isCleaningSupervisor || isAdmin(user);
const isStaff = (user) => user?.isCleaningStaff || isSupervisor(user);

// ===== STAFF (para asignar tareas) =====
exports.listStaff = async (req, res) => {
    try {
        const staff = await prisma.user.findMany({
            where: {
                OR: [
                    { isCleaningStaff: true },
                    { isCleaningSupervisor: true },
                ],
            },
            select: { id: true, name: true, email: true, isCleaningStaff: true, isCleaningSupervisor: true },
            orderBy: { name: 'asc' },
        });
        res.json(staff);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ===== ZONAS =====
exports.listZones = async (req, res) => {
    try {
        const zones = await prisma.cleaningZone.findMany({
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
        });
        res.json(zones);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createZone = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const zone = await prisma.cleaningZone.create({ data: req.body });
        res.status(201).json(zone);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.updateZone = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const zone = await prisma.cleaningZone.update({
            where: { id: req.params.id },
            data: req.body,
        });
        res.json(zone);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ===== TAREAS =====
exports.listTasks = async (req, res) => {
    try {
        const { zoneId, frequency, active } = req.query;
        const where = {};
        if (zoneId) where.zoneId = zoneId;
        if (frequency) where.frequency = frequency;
        if (active !== undefined) where.active = active === 'true';
        const tasks = await prisma.cleaningTask.findMany({
            where,
            include: { zone: true, assignedTo: { select: { id: true, name: true } } },
            orderBy: [{ zone: { sortOrder: 'asc' } }, { timeSlot: 'asc' }],
        });
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createTask = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const task = await prisma.cleaningTask.create({
            data: { ...req.body, createdById: req.user.id },
        });
        res.status(201).json(task);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.updateTask = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const task = await prisma.cleaningTask.update({
            where: { id: req.params.id },
            data: req.body,
        });
        res.json(task);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.deleteTask = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        await prisma.cleaningTask.update({
            where: { id: req.params.id },
            data: { active: false },
        });
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.assignExtraTask = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const { zoneId, title, instructions, estimatedMin, assignedToId, dueDate } = req.body;
        const task = await prisma.cleaningTask.create({
            data: {
                zoneId,
                title,
                instructions,
                estimatedMin: estimatedMin || 30,
                frequency: 'ONE_TIME',
                assignedToId,
                createdById: req.user.id,
            },
        });
        const day = cleaningService.startOfDay(dueDate ? new Date(dueDate) : new Date());
        const execution = await prisma.cleaningExecution.create({
            data: {
                taskId: task.id,
                userId: assignedToId,
                scheduledFor: day,
                status: 'PENDING',
            },
        });
        res.status(201).json({ task, execution });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ===== EJECUCIONES (LEDDY) =====
exports.getTodayTasks = async (req, res) => {
    try {
        const tasks = await cleaningService.getTodayTasksForUser(req.user.id);
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.startExecution = async (req, res) => {
    try {
        const exec = await cleaningService.startExecution(req.params.id, req.user.id);
        res.json(exec);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.completeExecution = async (req, res) => {
    try {
        const exec = await cleaningService.completeExecution(req.params.id, req.user.id, req.body);
        res.json(exec);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.skipExecution = async (req, res) => {
    try {
        const exec = await prisma.cleaningExecution.findUnique({ where: { id: req.params.id } });
        if (!exec) return res.status(404).json({ error: 'No encontrada' });
        if (exec.userId !== req.user.id && !isSupervisor(req.user)) {
            return res.status(403).json({ error: 'Sin permisos' });
        }
        const updated = await prisma.cleaningExecution.update({
            where: { id: req.params.id },
            data: { status: 'SKIPPED', notes: req.body.notes || 'Saltada' },
        });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ===== VERIFICACIÓN (DIANA) =====
exports.listPendingVerifications = async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const items = await prisma.cleaningExecution.findMany({
            where: { status: 'COMPLETED', verifiedAt: null },
            include: {
                task: { include: { zone: true } },
                user: { select: { id: true, name: true } },
            },
            orderBy: { completedAt: 'desc' },
        });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.verifyExecution = async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const exec = await cleaningService.verifyExecution(req.params.id, req.user.id, req.body);
        res.json(exec);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ===== INSUMOS =====
exports.listSupplies = async (req, res) => {
    try {
        const supplies = await prisma.cleaningSupply.findMany({
            where: { active: true },
            orderBy: { name: 'asc' },
        });
        res.json(supplies);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createSupply = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const supply = await prisma.cleaningSupply.create({ data: req.body });
        res.status(201).json(supply);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.updateSupply = async (req, res) => {
    if (!isSupervisor(req.user) && !isStaff(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const supply = await prisma.cleaningSupply.update({
            where: { id: req.params.id },
            data: { ...req.body, updatedById: req.user.id },
        });
        res.json(supply);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.reportSupplyLow = async (req, res) => {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const result = await cleaningService.reportSupplyLow(req.params.id, req.user.id, req.body.message);
        res.status(201).json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.listAlerts = async (req, res) => {
    try {
        const { status } = req.query;
        const where = {};
        if (status) where.status = status;
        else where.status = { in: ['OPEN', 'ACKNOWLEDGED'] };
        const alerts = await prisma.cleaningSupplyAlert.findMany({
            where,
            include: { supply: true, reportedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.resolveAlert = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const alert = await prisma.cleaningSupplyAlert.update({
            where: { id: req.params.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        res.json(alert);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ===== REPORTES =====
exports.getDailyReport = async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const date = req.query.date ? new Date(req.query.date) : new Date();
        const report = await cleaningService.getDailyReport(date);
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getWeeklyReport = async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const { userId, from } = req.query;
        const report = await cleaningService.getWeeklyReport(userId, from ? new Date(from) : null);
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.regenerateToday = async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
    try {
        const result = await cleaningService.generateExecutionsForDate(new Date());
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
