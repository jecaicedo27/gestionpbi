const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const startOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const isTaskDueOnDate = (task, date) => {
    const dow = date.getDay();
    if (task.frequency === 'DAILY') return true;
    if (task.frequency === 'WEEKLY' || task.frequency === 'BIWEEKLY') {
        if (!task.daysOfWeek || task.daysOfWeek.length === 0) return dow === 1;
        return task.daysOfWeek.includes(dow);
    }
    if (task.frequency === 'MONTHLY') {
        return date.getDate() === 1;
    }
    return false;
};

const generateExecutionsForDate = async (date = new Date()) => {
    const day = startOfDay(date);
    const tasks = await prisma.cleaningTask.findMany({
        where: { active: true, assignedToId: { not: null } },
    });

    let created = 0;
    for (const task of tasks) {
        if (!isTaskDueOnDate(task, day)) continue;
        try {
            await prisma.cleaningExecution.create({
                data: {
                    taskId: task.id,
                    userId: task.assignedToId,
                    scheduledFor: day,
                    status: 'PENDING',
                },
            });
            created++;
        } catch (err) {
            if (err.code !== 'P2002') throw err;
        }
    }
    return { date: day, created, totalTasks: tasks.length };
};

const getTodayTasksForUser = async (userId) => {
    const day = startOfDay();
    await generateExecutionsForDate(day);

    return prisma.cleaningExecution.findMany({
        where: { userId, scheduledFor: day },
        include: {
            task: {
                include: { zone: true },
            },
        },
        orderBy: [{ task: { zone: { sortOrder: 'asc' } } }, { task: { timeSlot: 'asc' } }],
    });
};

const startExecution = async (executionId, userId) => {
    const exec = await prisma.cleaningExecution.findUnique({ where: { id: executionId } });
    if (!exec) throw new Error('Ejecución no encontrada');
    if (exec.userId !== userId) throw new Error('No autorizado');
    if (exec.status === 'COMPLETED') throw new Error('Ya completada');

    return prisma.cleaningExecution.update({
        where: { id: executionId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
};

const completeExecution = async (executionId, userId, { notes, photoBefore, photoAfter }) => {
    const exec = await prisma.cleaningExecution.findUnique({ where: { id: executionId } });
    if (!exec) throw new Error('Ejecución no encontrada');
    if (exec.userId !== userId) throw new Error('No autorizado');

    const completedAt = new Date();
    const startedAt = exec.startedAt || completedAt;
    const durationMin = Math.max(1, Math.round((completedAt - startedAt) / 60000));

    return prisma.cleaningExecution.update({
        where: { id: executionId },
        data: {
            status: 'COMPLETED',
            completedAt,
            startedAt,
            durationMin,
            notes: notes || null,
            photoBefore: photoBefore || null,
            photoAfter: photoAfter || null,
        },
    });
};

const verifyExecution = async (executionId, supervisorId, { approved, notes }) => {
    return prisma.cleaningExecution.update({
        where: { id: executionId },
        data: {
            verifiedById: supervisorId,
            verifiedAt: new Date(),
            verifyStatus: approved ? 'APPROVED' : 'REJECTED',
            verifyNotes: notes || null,
        },
    });
};

const reportSupplyLow = async (supplyId, userId, message) => {
    const supply = await prisma.cleaningSupply.update({
        where: { id: supplyId },
        data: { status: 'LOW', updatedById: userId },
    });
    const alert = await prisma.cleaningSupplyAlert.create({
        data: {
            supplyId,
            reportedById: userId,
            message: message || `${supply.name} está por terminarse`,
        },
    });
    return { supply, alert };
};

const getDailyReport = async (date = new Date()) => {
    const day = startOfDay(date);
    const executions = await prisma.cleaningExecution.findMany({
        where: { scheduledFor: day },
        include: { task: { include: { zone: true } }, user: { select: { id: true, name: true } } },
    });

    const total = executions.length;
    const completed = executions.filter(e => e.status === 'COMPLETED').length;
    const inProgress = executions.filter(e => e.status === 'IN_PROGRESS').length;
    const pending = executions.filter(e => e.status === 'PENDING').length;
    const skipped = executions.filter(e => e.status === 'SKIPPED' || e.status === 'NOT_DONE').length;
    const compliance = total > 0 ? Math.round((completed / total) * 100) : 0;

    const byZone = {};
    for (const e of executions) {
        const code = e.task.zone.code;
        if (!byZone[code]) byZone[code] = { name: e.task.zone.name, total: 0, completed: 0 };
        byZone[code].total++;
        if (e.status === 'COMPLETED') byZone[code].completed++;
    }

    return { date: day, total, completed, inProgress, pending, skipped, compliance, byZone, executions };
};

const getWeeklyReport = async (userId, fromDate = null) => {
    const from = fromDate ? startOfDay(fromDate) : startOfDay(new Date(Date.now() - 7 * 86400000));
    const where = { scheduledFor: { gte: from } };
    if (userId) where.userId = userId;

    const executions = await prisma.cleaningExecution.findMany({
        where,
        include: { task: { include: { zone: true } } },
    });

    const byDay = {};
    for (const e of executions) {
        const key = e.scheduledFor.toISOString().slice(0, 10);
        if (!byDay[key]) byDay[key] = { total: 0, completed: 0 };
        byDay[key].total++;
        if (e.status === 'COMPLETED') byDay[key].completed++;
    }

    return { from, byDay, totalExecutions: executions.length };
};

module.exports = {
    startOfDay,
    isTaskDueOnDate,
    generateExecutionsForDate,
    getTodayTasksForUser,
    startExecution,
    completeExecution,
    verifyExecution,
    reportSupplyLow,
    getDailyReport,
    getWeeklyReport,
};
