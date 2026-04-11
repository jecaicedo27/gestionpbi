/**
 * shiftController.js — Shift scheduling for production employees.
 * Handles weekly schedule CRUD, auto-rotation, absence tracking, and replacement suggestions.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const prisma = new PrismaClient();

// ── Shift definitions ────────────────────────────────────────
const SHIFTS = {
    MANANA: { label: 'Mañana', start: '6:00', end: '14:00', weekDesc: 'Lun–Vie 6:00–14:00 / Sáb 6:00–12:00' },
    TARDE:  { label: 'Tarde',  start: '14:00', end: '22:00', weekDesc: 'Lun–Vie 14:00–22:00 / Sáb 14:00–18:00' },
    NOCHE:  { label: 'Noche',  start: '22:00', end: '6:00',  weekDesc: 'Dom 22:00 → Vie amanecer Sáb 6:00' },
    DIURNO: { label: 'Diurno', start: '8:00',  end: '17:00', weekDesc: 'Lun–Sáb 8:00–17:00' },
};

const ROTATION_ORDER = ['MANANA', 'TARDE', 'NOCHE'];

// ── Helper: get Monday of a week ─────────────────────────────
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getSunday(monday) {
    const s = new Date(monday);
    s.setDate(s.getDate() + 6);
    s.setHours(23, 59, 59, 999);
    return s;
}

// ── GET /employees ───────────────────────────────────────────
const getEmployees = async (req, res) => {
    try {
        const employees = await prisma.shiftEmployee.findMany({
            where: { active: true },
            include: { user: { select: { id: true, name: true, email: true, role: true, lastLogin: true, phone: true } } },
            orderBy: [{ area: 'asc' }, { role: 'desc' }, { name: 'asc' }]
        });
        res.json(employees);
    } catch (err) {
        logger.error('getEmployees error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /employees ──────────────────────────────────────────
const createEmployee = async (req, res) => {
    try {
        const { name, area, role, groupNumber, isFixed, restrictions, whatsapp, userId } = req.body;
        const emp = await prisma.shiftEmployee.create({
            data: { name, area, role: role || 'OPERARIO', groupNumber, isFixed: isFixed || false, restrictions: restrictions || [], whatsapp, userId }
        });
        res.json(emp);
    } catch (err) {
        logger.error('createEmployee error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── PATCH /employees/:id ─────────────────────────────────────
const updateEmployee = async (req, res) => {
    try {
        const emp = await prisma.shiftEmployee.update({
            where: { id: req.params.id },
            data: req.body
        });
        res.json(emp);
    } catch (err) {
        logger.error('updateEmployee error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── GET /weeks?weekStart=YYYY-MM-DD ──────────────────────────
const getWeekSchedule = async (req, res) => {
    try {
        const monday = getMonday(req.query.weekStart || new Date());
        const sunday = getSunday(monday);

        let week = await prisma.shiftWeek.findUnique({
            where: { weekStart: monday },
            include: {
                assignments: {
                    include: { employee: { include: { user: { select: { id: true, name: true, email: true, lastLogin: true } } } } },
                    orderBy: [{ area: 'asc' }, { shift: 'asc' }]
                }
            }
        });

        if (!week) {
            // Create draft week
            week = await prisma.shiftWeek.create({
                data: {
                    weekStart: monday,
                    weekEnd: sunday,
                    note: 'NOCHE: Dom 22:00 → Vie amanecer Sáb 6:00 | MAÑANA: Lun–Sáb(12PM) | TARDE: Lun–Sáb(18h)'
                },
                include: { assignments: { include: { employee: true } } }
            });
        }

        res.json({ week, shifts: SHIFTS });
    } catch (err) {
        logger.error('getWeekSchedule error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /weeks/save ─────────────────────────────────────────
const saveWeekSchedule = async (req, res) => {
    try {
        const { weekStart, assignments, note } = req.body;
        const monday = getMonday(weekStart);
        const sunday = getSunday(monday);

        const week = await prisma.shiftWeek.upsert({
            where: { weekStart: monday },
            create: { weekStart: monday, weekEnd: sunday, note },
            update: { note }
        });

        // Delete existing assignments and recreate
        await prisma.shiftAssignment.deleteMany({ where: { weekId: week.id } });

        if (assignments && assignments.length > 0) {
            await prisma.shiftAssignment.createMany({
                data: assignments.map(a => ({
                    weekId: week.id,
                    employeeId: a.employeeId,
                    area: a.area,
                    shift: a.shift
                }))
            });
        }

        const updated = await prisma.shiftWeek.findUnique({
            where: { id: week.id },
            include: { assignments: { include: { employee: true } } }
        });

        res.json(updated);
    } catch (err) {
        logger.error('saveWeekSchedule error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /weeks/:id/publish ──────────────────────────────────
const publishWeek = async (req, res) => {
    try {
        const week = await prisma.shiftWeek.update({
            where: { id: req.params.id },
            data: { status: 'PUBLISHED', publishedAt: new Date() }
        });
        res.json(week);
    } catch (err) {
        logger.error('publishWeek error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /weeks/generate-next ────────────────────────────────
const generateNextWeek = async (req, res) => {
    try {
        const { currentWeekStart } = req.body;
        const currentMonday = getMonday(currentWeekStart || new Date());
        const nextMonday = new Date(currentMonday);
        nextMonday.setDate(nextMonday.getDate() + 7);
        const nextSunday = getSunday(nextMonday);

        // Get current week's assignments
        const currentWeek = await prisma.shiftWeek.findUnique({
            where: { weekStart: currentMonday },
            include: { assignments: { include: { employee: true } } }
        });

        if (!currentWeek || currentWeek.assignments.length === 0) {
            return res.status(400).json({ error: 'No hay cuadro de la semana actual para rotar' });
        }

        // Create next week
        const nextWeek = await prisma.shiftWeek.upsert({
            where: { weekStart: nextMonday },
            create: {
                weekStart: nextMonday,
                weekEnd: nextSunday,
                note: 'NOCHE: Dom 22:00 → Vie amanecer Sáb 6:00 | MAÑANA: Lun–Sáb(12PM) | TARDE: Lun–Sáb(18h)'
            },
            update: {}
        });

        // Delete existing assignments for next week
        await prisma.shiftAssignment.deleteMany({ where: { weekId: nextWeek.id } });

        // Rotate: M→T, T→N, N→M (only for non-fixed employees)
        const newAssignments = currentWeek.assignments.map(a => {
            let nextShift = a.shift;

            if (!a.employee.isFixed && ROTATION_ORDER.includes(a.shift)) {
                const currentIdx = ROTATION_ORDER.indexOf(a.shift);
                nextShift = ROTATION_ORDER[(currentIdx + 1) % 3];

                // Check restrictions
                if (a.employee.restrictions && a.employee.restrictions.length > 0) {
                    if (!a.employee.restrictions.includes(nextShift)) {
                        // Find nearest allowed shift
                        for (let i = 1; i <= 2; i++) {
                            const candidate = ROTATION_ORDER[(currentIdx + 1 + i) % 3];
                            if (a.employee.restrictions.includes(candidate)) {
                                nextShift = candidate;
                                break;
                            }
                        }
                    }
                }
            }

            return {
                weekId: nextWeek.id,
                employeeId: a.employeeId,
                area: a.area,
                shift: nextShift
            };
        });

        await prisma.shiftAssignment.createMany({ data: newAssignments });

        const result = await prisma.shiftWeek.findUnique({
            where: { id: nextWeek.id },
            include: { assignments: { include: { employee: true } } }
        });

        res.json(result);
    } catch (err) {
        logger.error('generateNextWeek error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /absences ───────────────────────────────────────────
const registerAbsence = async (req, res) => {
    try {
        const { employeeId, date, reason, notes, replacedBy } = req.body;
        const absence = await prisma.shiftAbsence.create({
            data: { employeeId, date: new Date(date), reason, notes, replacedBy },
            include: { employee: true }
        });
        res.json(absence);
    } catch (err) {
        logger.error('registerAbsence error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── GET /absences?month=YYYY-MM ──────────────────────────────
const getAbsences = async (req, res) => {
    try {
        const { month } = req.query;
        let where = {};
        if (month) {
            const start = new Date(`${month}-01`);
            const end = new Date(start);
            end.setMonth(end.getMonth() + 1);
            where = { date: { gte: start, lt: end } };
        }
        const absences = await prisma.shiftAbsence.findMany({
            where,
            include: { employee: true },
            orderBy: { date: 'desc' }
        });
        res.json(absences);
    } catch (err) {
        logger.error('getAbsences error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── GET /suggest-replacement/:employeeId?weekStart= ──────────
const suggestReplacement = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const monday = getMonday(req.query.weekStart || new Date());

        // Get the absent employee's assignment
        const week = await prisma.shiftWeek.findUnique({ where: { weekStart: monday } });
        if (!week) return res.json({ suggestions: [] });

        const absentAssignment = await prisma.shiftAssignment.findUnique({
            where: { weekId_employeeId: { weekId: week.id, employeeId } },
            include: { employee: true }
        });
        if (!absentAssignment) return res.json({ suggestions: [] });

        // Find all employees NOT assigned this week who could fill the role
        const assignedIds = (await prisma.shiftAssignment.findMany({
            where: { weekId: week.id },
            select: { employeeId: true }
        })).map(a => a.employeeId);

        const available = await prisma.shiftEmployee.findMany({
            where: {
                active: true,
                id: { notIn: assignedIds },
                area: absentAssignment.area
            }
        });

        // Also consider employees on different shifts who could swap
        const samAreaDiffShift = await prisma.shiftAssignment.findMany({
            where: {
                weekId: week.id,
                area: absentAssignment.area,
                shift: { not: absentAssignment.shift },
                employeeId: { not: employeeId }
            },
            include: { employee: true }
        });

        res.json({
            absent: absentAssignment,
            suggestions: available,
            swapCandidates: samAreaDiffShift.map(a => ({
                ...a.employee,
                currentShift: a.shift
            }))
        });
    } catch (err) {
        logger.error('suggestReplacement error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getEmployees, createEmployee, updateEmployee,
    getWeekSchedule, saveWeekSchedule, publishWeek, generateNextWeek,
    registerAbsence, getAbsences, suggestReplacement
};
