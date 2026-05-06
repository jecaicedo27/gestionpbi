/**
 * shiftController.js — Shift scheduling for production employees.
 * Handles weekly schedule CRUD, auto-rotation, absence tracking, and replacement suggestions.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { generateHandoversForWeek, isHandoverEnabled } = require('../services/shiftHandoverService');
const {
    SHIFT_OPERATION_AREAS,
    SHIFT_OPERATION_USER_ROLES,
    assignEmployeeToCurrentWeek,
    createShiftEmployeeFromUser,
    isFixedShiftArea,
    isOperationalUserRole,
    normalizeGroupNumber,
    normalizeRestrictions,
    normalizeShiftArea,
    normalizeShiftEmployeeRole,
    suggestIsFixedForUser,
    suggestShiftAreaForUser,
} = require('../services/shiftEmployeeSyncService');
const prisma = new PrismaClient();

// ── Shift definitions ────────────────────────────────────────
const SHIFTS = {
    MANANA: { label: 'Mañana', start: '6:00', end: '14:00', weekDesc: 'Lun–Vie 6:00–14:00 / Sáb 6:00–12:00' },
    TARDE:  { label: 'Tarde',  start: '14:00', end: '22:00', weekDesc: 'Lun–Vie 14:00–22:00 / Sáb 12:00–18:00' },
    NOCHE:  { label: 'Noche',  start: '22:00', end: '6:00',  weekDesc: 'Dom 22:00 → Vie amanecer Sáb 6:00' },
    DIURNO: { label: 'Diurno', start: '8:00',  end: '17:00', weekDesc: 'Lun–Sáb 8:00–17:00' },
};

const ROTATION_ORDER = ['MANANA', 'TARDE', 'NOCHE'];

// ── Helper: get Monday of a week ─────────────────────────────
function getMonday(dateInput) {
    let dStr = dateInput;
    if (typeof dStr === 'string' && dStr.length === 10) dStr += 'T12:00:00';
    const d = new Date(dStr);
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

// ── GET /employees/pending-users ─────────────────────────────
const getPendingUserEmployees = async (req, res) => {
    try {
        const linkedEmployees = await prisma.shiftEmployee.findMany({
            where: { userId: { not: null } },
            select: { userId: true }
        });
        const linkedUserIds = linkedEmployees.map((emp) => emp.userId).filter(Boolean);

        const users = await prisma.user.findMany({
            where: {
                active: true,
                role: { in: SHIFT_OPERATION_USER_ROLES },
                ...(linkedUserIds.length > 0 ? { id: { notIn: linkedUserIds } } : {})
            },
            select: { id: true, name: true, email: true, role: true, phone: true, lastLogin: true },
            orderBy: [{ role: 'asc' }, { name: 'asc' }]
        });

        res.json({
            users: users.map((user) => ({
                ...user,
                suggestedArea: suggestShiftAreaForUser(user),
                suggestedRole: user.role === 'MECANICO' ? 'MECANICO' : 'OPERARIO',
                suggestedIsFixed: suggestIsFixedForUser(user)
            })),
            areas: SHIFT_OPERATION_AREAS
        });
    } catch (err) {
        logger.error('getPendingUserEmployees error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /employees/migrate-users ────────────────────────────
const migrateUsersToEmployees = async (req, res) => {
    try {
        const rows = Array.isArray(req.body.users) ? req.body.users : [];
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Selecciona al menos un usuario para migrar.' });
        }

        const rowsByUserId = new Map();
        rows.forEach((row) => {
            if (row?.userId && !rowsByUserId.has(row.userId)) rowsByUserId.set(row.userId, row);
        });

        const userIds = [...rowsByUserId.keys()];
        if (userIds.length === 0) {
            return res.status(400).json({ error: 'No llegaron usuarios validos para migrar.' });
        }

        const users = await prisma.user.findMany({
            where: { id: { in: userIds }, active: true },
            select: { id: true, name: true, email: true, role: true, phone: true }
        });
        const usersById = new Map(users.map((user) => [user.id, user]));

        const existingEmployees = await prisma.shiftEmployee.findMany({
            where: { userId: { in: userIds } },
            select: { id: true, userId: true, name: true }
        });
        const existingByUserId = new Map(existingEmployees.map((emp) => [emp.userId, emp]));

        const created = [];
        const skipped = [];
        const errors = [];

        for (const [userId, row] of rowsByUserId.entries()) {
            const user = usersById.get(userId);
            if (!user) {
                errors.push({ userId, error: 'Usuario no encontrado o inactivo.' });
                continue;
            }

            if (existingByUserId.has(userId)) {
                skipped.push({ userId, reason: 'Ya estaba vinculado al cuadro de turnos.' });
                continue;
            }

            if (!isOperationalUserRole(user.role)) {
                skipped.push({ userId, reason: 'El rol del usuario no pertenece a Produccion o Picking/Empaque.' });
                continue;
            }

            try {
                const result = await createShiftEmployeeFromUser(prisma, user, {
                    area: row.area,
                    role: row.role,
                    groupNumber: row.groupNumber,
                    isFixed: row.isFixed,
                    assignCurrentWeek: true,
                });
                created.push({
                    id: result.employee.id,
                    userId: user.id,
                    name: result.employee.name,
                    area: result.employee.area,
                    role: result.employee.role,
                    shift: result.assignment?.shift || null,
                });
            } catch (err) {
                errors.push({ userId, error: err.message });
            }
        }

        res.json({ success: true, created, skipped, errors });
    } catch (err) {
        logger.error('migrateUsersToEmployees error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /employees ──────────────────────────────────────────
const createEmployee = async (req, res) => {
    try {
        const { name, area, role, groupNumber, isFixed, restrictions, whatsapp, userId } = req.body;
        const cleanName = typeof name === 'string' ? name.trim() : '';
        const cleanUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;

        if (!cleanName) {
            return res.status(400).json({ error: 'El nombre del empleado es obligatorio.' });
        }

        if (cleanUserId) {
            const user = await prisma.user.findUnique({ where: { id: cleanUserId }, select: { id: true } });
            if (!user) return res.status(404).json({ error: 'Usuario ERP no encontrado.' });

            const existingLink = await prisma.shiftEmployee.findUnique({ where: { userId: cleanUserId } });
            if (existingLink) return res.status(409).json({ error: 'Ese usuario ERP ya esta vinculado a un empleado de turnos.' });
        }

        const employeeArea = normalizeShiftArea(area);
        const employeeIsFixed = isFixed === undefined ? isFixedShiftArea(employeeArea) : Boolean(isFixed);

        const emp = await prisma.shiftEmployee.create({
            data: {
                name: cleanName,
                area: employeeArea,
                role: normalizeShiftEmployeeRole(role),
                groupNumber: employeeIsFixed ? null : normalizeGroupNumber(groupNumber),
                isFixed: employeeIsFixed,
                restrictions: normalizeRestrictions(restrictions),
                whatsapp: typeof whatsapp === 'string' && whatsapp.trim() ? whatsapp.trim() : null,
                userId: cleanUserId,
            }
        });

        // ── Auto-assign to current week's schedule ──────────────
        try {
            const assignment = await assignEmployeeToCurrentWeek(prisma, emp);
            logger.info(`Auto-assigned ${emp.name} to ${assignment.shift} shift`);
        } catch (autoErr) {
            logger.warn('Auto-assign to schedule failed (non-blocking):', autoErr.message);
        }

        res.json(emp);
    } catch (err) {
        logger.error('createEmployee error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── PATCH /employees/:id ─────────────────────────────────────
const updateEmployee = async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.name !== undefined) {
            data.name = typeof data.name === 'string' ? data.name.trim() : data.name;
            if (!data.name) return res.status(400).json({ error: 'El nombre del empleado es obligatorio.' });
        }
        if (data.area !== undefined) data.area = normalizeShiftArea(data.area);
        if (data.role !== undefined) data.role = normalizeShiftEmployeeRole(data.role);
        if (data.groupNumber !== undefined) data.groupNumber = normalizeGroupNumber(data.groupNumber);
        if (data.restrictions !== undefined) data.restrictions = normalizeRestrictions(data.restrictions);
        if (data.whatsapp !== undefined) data.whatsapp = typeof data.whatsapp === 'string' && data.whatsapp.trim() ? data.whatsapp.trim() : null;

        const emp = await prisma.shiftEmployee.update({
            where: { id: req.params.id },
            data
        });

        // If area was updated, force sync any existing assignments to match the new area
        if (data.area) {
            try {
                await prisma.shiftAssignment.updateMany({
                    where: { employeeId: emp.id },
                    data: { area: data.area }
                });
            } catch (err) {
                logger.error('Failed to sync assignment areas:', err);
            }
        }

        // Si el empleado quedó como isFixed o cambió de área, asegurar que tenga assignment
        // en la semana actual con el turno correcto (DIURNO para áreas fijas).
        if (data.area || data.isFixed !== undefined || data.groupNumber !== undefined) {
            try {
                await assignEmployeeToCurrentWeek(prisma, emp);
            } catch (err) {
                logger.error('Failed to auto-assign employee to current week after update:', err);
            }
        }

        res.json(emp);
    } catch (err) {
        logger.error('updateEmployee error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── DELETE /employees/:id ────────────────────────────────────
const deleteEmployee = async (req, res) => {
    try {
        // Remove all shift assignments first (cascade)
        await prisma.shiftAssignment.deleteMany({ where: { employeeId: req.params.id } });
        await prisma.shiftEmployee.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        logger.error('deleteEmployee error:', err);
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

        // ── Fetch active absences that overlap this week ──────────
        const weekAbsences = await prisma.shiftAbsence.findMany({
            where: {
                startDate: { lte: sunday },
                endDate: { gte: monday }
            },
            include: { employee: { select: { id: true, name: true } } }
        });

        const parseToUTC = (d) => {
            const dStr = typeof d === 'string' ? d : d.toISOString();
            const [y, m, day] = (dStr.split('T')[0]).split('-').map(Number);
            return Date.UTC(y, m - 1, day);
        };

        const mondayUTC = parseToUTC(monday);
        const sundayUTC = parseToUTC(sunday);

        // Build a set of absent employee IDs for this week
        const absentEmployeeIds = new Set();
        const absentMap = {}; // employeeId → absence reason
        const partialAbsentMap = {}; // employeeId → absence details for <= 3 days

        weekAbsences.forEach(a => { 
            absentMap[a.employeeId] = a.reason; 
            
            const aStartUTC = parseToUTC(a.startDate.toISOString ? a.startDate.toISOString() : a.startDate.toString());
            const aEndUTC = parseToUTC(a.endDate.toISOString ? a.endDate.toISOString() : a.endDate.toString());
            
            const overlapStart = Math.max(mondayUTC, aStartUTC);
            const overlapEnd = Math.min(sundayUTC, aEndUTC);
            const overlapDays = Math.max(0, Math.floor((overlapEnd - overlapStart) / 86400000) + 1);

            if (overlapDays >= 4) {
                absentEmployeeIds.add(a.employeeId);
            } else {
                partialAbsentMap[a.employeeId] = {
                    reason: a.reason,
                    days: overlapDays,
                    startDate: a.startDate,
                    endDate: a.endDate
                };
            }
        });

        res.json({ week, shifts: SHIFTS, weekAbsences, absentEmployeeIds: [...absentEmployeeIds], absentMap, partialAbsentMap });
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

        let handoverSync = null;
        if (week.status === 'PUBLISHED') {
            try {
                const handoverEnabled = await isHandoverEnabled();
                if (handoverEnabled) {
                    const result = await generateHandoversForWeek(week.id);
                    handoverSync = {
                        regenerated: true,
                        generated: result.generated
                    };
                    logger.info(`[saveWeekSchedule] Handover records regenerated for published week ${week.id}: ${result.generated}`);
                } else {
                    handoverSync = {
                        regenerated: false,
                        reason: 'handover_disabled'
                    };
                }
            } catch (handoverErr) {
                logger.error('[saveWeekSchedule] Handover regeneration failed:', handoverErr);
                handoverSync = {
                    regenerated: false,
                    reason: 'handover_regeneration_failed'
                };
            }
        }

        res.json({
            ...updated,
            handoverSync
        });
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

        // Generate shift handover records if module is enabled
        try {
            const handoverEnabled = await isHandoverEnabled();
            if (handoverEnabled) {
                const result = await generateHandoversForWeek(week.id);
                logger.info(`[publishWeek] Handover records generated: ${result.generated}`);
            }
        } catch (handoverErr) {
            logger.error('[publishWeek] Handover generation failed (non-blocking):', handoverErr);
        }

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

            logger.info(`Rotación: ${a.employee.name} (${a.employee.area}) ${a.shift} → ${nextShift}`);

            return {
                weekId: nextWeek.id,
                employeeId: a.employeeId,
                area: a.employee.area,  // Always use the employee's current area, not the assignment's
                shift: nextShift
            };
        });

        await prisma.shiftAssignment.createMany({ data: newAssignments });

        // ── Post-rotation validation ──────────────────────────────────────
        // Check that each area has coverage in all its applicable shifts
        const AREA_SHIFTS = {
            PRODUCCION: ['MANANA', 'TARDE', 'NOCHE'],
            SIROPES: ['MANANA', 'TARDE', 'NOCHE'],
            EMPAQUE: ['MANANA', 'TARDE', 'NOCHE'],
            LOGISTICA: ['DIURNO'],
            ASEO: ['DIURNO']
        };
        const warnings = [];
        for (const [area, shifts] of Object.entries(AREA_SHIFTS)) {
            for (const shift of shifts) {
                const count = newAssignments.filter(a => a.area === area && a.shift === shift).length;
                if (count === 0) {
                    warnings.push(`⚠️ ${area} no tiene nadie en turno ${shift}`);
                }
            }
        }
        if (warnings.length > 0) {
            logger.warn('Validación post-rotación:\n' + warnings.join('\n'));
        }

        const result = await prisma.shiftWeek.findUnique({
            where: { id: nextWeek.id },
            include: { assignments: { include: { employee: true } } }
        });

        res.json({ ...result, rotationWarnings: warnings });
    } catch (err) {
        logger.error('generateNextWeek error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── POST /absences ───────────────────────────────────────────
const registerAbsence = async (req, res) => {
    try {
        const { employeeId, startDate, endDate, reason, notes, replacedBy } = req.body;
        // Force midday parsing to avoid UTC offset shifting the date
        const sTime = startDate.length === 10 ? startDate + 'T12:00:00' : startDate;
        const eTime = (endDate || startDate).length === 10 ? (endDate || startDate) + 'T12:00:00' : (endDate || startDate);
        
        const absence = await prisma.shiftAbsence.create({
            data: {
                employeeId,
                startDate: new Date(sTime),
                endDate: new Date(eTime),
                reason,
                notes,
                replacedBy
            },
            include: { employee: true }
        });
        res.json(absence);
    } catch (err) {
        logger.error('registerAbsence error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── GET /absences?month=YYYY-MM&includeUpcoming=true ─────────
const getAbsences = async (req, res) => {
    try {
        const { month, includeUpcoming, lookaheadDays } = req.query;
        const filters = [];
        if (month) {
            const start = new Date(`${month}-01T12:00:00`);
            start.setDate(1);
            start.setHours(0,0,0,0);
            
            const end = new Date(start);
            end.setMonth(end.getMonth() + 1);
            
            // Find absences that overlap with the selected month
            filters.push({
                startDate: { lt: end },
                endDate: { gte: start }
            });
        }
        if (includeUpcoming === 'true') {
            const days = Math.min(Math.max(parseInt(lookaheadDays, 10) || 120, 1), 365);
            const today = new Date();
            today.setHours(0,0,0,0);

            const horizon = new Date(today);
            horizon.setDate(horizon.getDate() + days);

            filters.push({
                startDate: { lte: horizon },
                endDate: { gte: today }
            });
        }

        const where = filters.length > 1 ? { OR: filters } : (filters[0] || {});
        const absences = await prisma.shiftAbsence.findMany({
            where,
            include: { employee: true },
            orderBy: { startDate: 'desc' }
        });
        res.json(absences);
    } catch (err) {
        logger.error('getAbsences error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── DELETE /absences/:id ─────────────────────────────────────
const deleteAbsence = async (req, res) => {
    try {
        await prisma.shiftAbsence.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        logger.error('deleteAbsence error:', err);
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
    getEmployees, getPendingUserEmployees, migrateUsersToEmployees,
    createEmployee, updateEmployee, deleteEmployee,
    getWeekSchedule, saveWeekSchedule, publishWeek, generateNextWeek,
    registerAbsence, getAbsences, deleteAbsence, suggestReplacement
};
