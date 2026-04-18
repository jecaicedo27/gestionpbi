/**
 * shiftHandoffController.js — Shift handoff (Entrega de Turno) with PIN auth.
 * Handles: create delivery, approve/reject, blocking status, today's handoffs.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const logger = require('../utils/logger');
const prisma = new PrismaClient();

// ── Checklist templates per area ─────────────────────────────────────────────
const CHECKLISTS = {
    PRODUCCION: [
        { label: '¿Máquina de esferificación limpia?', type: 'boolean' },
        { label: '¿Tanques vaciados y enjuagados?', type: 'boolean' },
        { label: '¿Piso y drenajes limpios?', type: 'boolean' },
        { label: '¿Herramientas organizadas?', type: 'boolean' },
        { label: 'Lotes producidos durante el turno', type: 'text' },
        { label: 'Novedades / problemas de máquina', type: 'text' },
        { label: 'Pendientes para el siguiente turno', type: 'text' },
    ],
    SIROPES: [
        { label: '¿Marmitas limpias?', type: 'boolean' },
        { label: '¿Piso y área limpia?', type: 'boolean' },
        { label: '¿Herramientas organizadas?', type: 'boolean' },
        { label: 'Lotes de sirope preparados', type: 'text' },
        { label: 'Novedades / problemas', type: 'text' },
        { label: 'Pendientes para el siguiente turno', type: 'text' },
    ],
    EMPAQUE: [
        { label: '¿Marcado de cajas completo?', type: 'boolean' },
        { label: 'Novedades de baches', type: 'text' },
        { label: 'Recepción de baches entrantes', type: 'text' },
        { label: 'Novedades generales', type: 'text' },
    ],
};

// ── Grace period: 20 minutes after shift change for handoff completion ───────
const GRACE_MINUTES = 20;
const PRE_HANDOFF_MINUTES = 10; // Block outgoing workers 10 min before shift end

function getNow() {
    return process.env.MOCK_TIME ? new Date(process.env.MOCK_TIME) : new Date();
}

function getColombiaMinutes() {
    const now = getNow();
    const colombiaOffset = -5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    return ((utcMinutes + colombiaOffset) % 1440 + 1440) % 1440;
}

// ── Get employee IDs with active absence on a given date ─────────────────────
async function getAbsentEmployeeIds(date) {
    const absences = await prisma.shiftAbsence.findMany({
        where: {
            startDate: { lte: date },
            endDate: { gte: date }
        },
        select: { employeeId: true }
    });
    return new Set(absences.map(a => a.employeeId));
}

// ── Get current active shift (no grace period) ──────────────────────────────
function getCurrentActiveShift() {
    const localMinutes = getColombiaMinutes();
    if (localMinutes >= 6 * 60 && localMinutes < 14 * 60) return 'MANANA';
    if (localMinutes >= 14 * 60 && localMinutes < 22 * 60) return 'TARDE';
    return 'NOCHE';
}

// ── Minutes until a specific shift ends ──────────────────────────────────────
function getMinutesUntilShiftEnd(shift) {
    const localMinutes = getColombiaMinutes();
    const endTimes = { MANANA: 14 * 60, TARDE: 22 * 60, NOCHE: 6 * 60 };
    let endMin = endTimes[shift];
    // NOCHE: if past 22:00, end is tomorrow at 6:00
    if (shift === 'NOCHE' && localMinutes >= 22 * 60) endMin += 24 * 60;
    return endMin - localMinutes;
}

// ── Determine outgoing shift by current hour (Colombia UTC-5) ────────────────
// With GRACE_MINUTES: e.g. at 14:10 (within grace), outgoing is still NOCHE
// so MANANA workers can still hand off and TARDE workers are NOT blocked yet.
function getOutgoingShift() {
    const localMinutes = getColombiaMinutes();

    // From 06:20 to 14:20 -> MANANA shift is working and will hand off near 14:00
    // From 14:20 to 22:20 -> TARDE shift is working and will hand off near 22:00
    // From 22:20 to 06:20 -> NOCHE shift is working and will hand off near 06:00

    const morningGrace = 6 * 60 + GRACE_MINUTES; // 380
    const afternoonGrace = 14 * 60 + GRACE_MINUTES; // 860

    if (localMinutes >= morningGrace && localMinutes < afternoonGrace) return 'MANANA';
    if (localMinutes >= afternoonGrace) return 'TARDE';
    return 'NOCHE'; // less than morningGrace (00:00 to 06:20) OR after nightGrace (22:20 to 00:00). Wait, 22:20 to 24:00 localMinutes >= 1340. 
}

// ── Get the actual date the current Shift STARTED ────────────────────────
function getShiftDate() {
    const today = getTodayDate();
    const localMinutes = getColombiaMinutes();
    const morningGrace = 6 * 60 + GRACE_MINUTES; // 380

    // If we are looking at NOCHE shift (before 06:20), it belongs to YESTERDAY
    if (localMinutes < morningGrace) {
        today.setDate(today.getDate() - 1);
    }
    return today;
}

// ── Build audit log entry ────────────────────────────────────────────────────
function buildAuditEntry(action, user, req) {
    return {
        action,
        userId: user.id,
        name: user.name,
        at: new Date().toISOString(),
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        device: (req.headers['user-agent'] || 'unknown').substring(0, 150)
    };
}

// ── Determine incoming shift (the one starting now) ──────────────────────────
function getIncomingShift() {
    const outgoing = getOutgoingShift();
    if (outgoing === 'NOCHE') return 'MANANA';
    if (outgoing === 'MANANA') return 'TARDE';
    return 'NOCHE';
}

// ── Get Monday of a week ─────────────────────────────────────────────────────
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

// ── Get today as date-only (for @db.Date field) ──────────────────────────────
function getTodayDate() {
    const now = getNow();
    // Colombia UTC-5
    const colombiaMs = now.getTime() + (-5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000);
    const colombia = new Date(colombiaMs);
    return new Date(colombia.getFullYear(), colombia.getMonth(), colombia.getDate());
}

// ── Validate PIN against all active users, return matched user ────────────────
async function validatePin(pin) {
    if (!pin || !/^\d{4}$/.test(pin)) return null;

    const users = await prisma.user.findMany({
        where: { active: true, pin: { not: null }, role: { not: 'DISTRIBUIDOR' } },
        include: {
            shiftEmployee: { select: { id: true, area: true, role: true, name: true } }
        }
    });

    for (const u of users) {
        const isMatch = await bcrypt.compare(pin, u.pin);
        if (isMatch) return u;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /handoff/checklists — Return checklist templates per area
// ═══════════════════════════════════════════════════════════════════════════════
const getChecklists = async (req, res) => {
    let today = getShiftDate();
    let outgoingShift = getOutgoingShift();

    // Check if query overrides shift/date
    if (req.query.date) {
        today = new Date(req.query.date + 'T00:00:00.000Z');
    }
    if (req.query.shift) {
        outgoingShift = req.query.shift;
    }

    // Sunday daytime shifts don't exist
    if (today.getDay() === 0 && (outgoingShift === 'MANANA' || outgoingShift === 'TARDE')) {
        return res.json({
            checklists: [],
            outgoingShift,
            incomingShift: getIncomingShift(),
            isSimulated: true
        });
    }
    res.json({
        checklists: CHECKLISTS,
        outgoingShift: getOutgoingShift(),
        incomingShift: getIncomingShift()
    });
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff — Create a shift handoff (operator delivers with PIN)
// ═══════════════════════════════════════════════════════════════════════════════
const createHandoff = async (req, res) => {
    try {
        const { pin, checklist, notes, pendingTasks, lotsProduced } = req.body;

        // 1. Validate PIN
        const user = await validatePin(pin);
        if (!user) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        // 2. Get shift employee link
        const shiftEmployee = user.shiftEmployee;
        if (!shiftEmployee) {
            return res.status(400).json({ error: `${user.name} no está vinculado a ningún empleado de turnos` });
        }

        // 3. Get current week
        const today = getTodayDate();
        const monday = getMonday(today);
        const week = await prisma.shiftWeek.findUnique({
            where: { weekStart: monday },
            include: { assignments: { include: { employee: true } } }
        });

        if (!week) {
            return res.status(400).json({ error: 'No hay un cuadro de turnos para esta semana' });
        }

        // 4. Verify this employee is assigned in the outgoing shift this week
        const outgoingShift = getOutgoingShift();
        const assignment = week.assignments.find(a =>
            a.employeeId === shiftEmployee.id && a.shift === outgoingShift
        );

        if (!assignment) {
            return res.status(400).json({
                error: `${user.name} no está asignado al turno ${outgoingShift} esta semana`
            });
        }

        const area = shiftEmployee.area;

        // 5. Check for existing handoff today
        const existing = await prisma.shiftHandoff.findUnique({
            where: {
                weekId_date_deliveredById: {
                    weekId: week.id,
                    date: today,
                    deliveredById: user.id
                }
            }
        });

        if (existing && existing.status !== 'REJECTED') {
            return res.status(409).json({ error: 'Ya entregaste tu turno hoy. Espera la aprobación del líder.' });
        }

        // 6. Build audit entry
        const auditEntry = buildAuditEntry('DELIVERED', user, req);

        // 7. Create or update (re-deliver after rejection)
        let handoff;
        if (existing && existing.status === 'REJECTED') {
            const prevLog = Array.isArray(existing.auditLog) ? existing.auditLog : [];
            handoff = await prisma.shiftHandoff.update({
                where: { id: existing.id },
                data: {
                    checklist,
                    notes,
                    pendingTasks,
                    lotsProduced,
                    deliveredAt: new Date(),
                    status: 'PENDING',
                    outgoingLeaderId: null,
                    outgoingLeaderAt: null,
                    incomingLeaderId: null,
                    incomingLeaderAt: null,
                    rejectionReason: null,
                    auditLog: [...prevLog, auditEntry]
                }
            });
            logger.info(`Re-delivery after rejection: ${user.name} (${area}) - ${outgoingShift} | IP: ${auditEntry.ip}`);
        } else {
            handoff = await prisma.shiftHandoff.create({
                data: {
                    weekId: week.id,
                    date: today,
                    area,
                    outgoingShift,
                    deliveredById: user.id,
                    deliveredAt: new Date(),
                    checklist,
                    notes,
                    pendingTasks,
                    lotsProduced,
                    auditLog: [auditEntry]
                }
            });
            logger.info(`Shift handoff created: ${user.name} (${area}) - ${outgoingShift} | IP: ${auditEntry.ip}`);
        }

        res.json({ success: true, handoff, operatorName: user.name });
    } catch (err) {
        logger.error('createHandoff error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff/:id/approve-outgoing — Leader outgoing approves a handoff
// ═══════════════════════════════════════════════════════════════════════════════
const approveOutgoing = async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN incorrecto' });

        const shiftEmployee = user.shiftEmployee;
        if (!shiftEmployee || shiftEmployee.role !== 'LIDER') {
            return res.status(403).json({ error: 'Solo un líder puede aprobar entregas' });
        }

        const handoff = await prisma.shiftHandoff.findUnique({ where: { id } });
        if (!handoff) return res.status(404).json({ error: 'Entrega no encontrada' });
        if (handoff.status !== 'PENDING') return res.status(409).json({ error: 'El estado actual no permite esta firma' });

        const auditEntry = buildAuditEntry('OUTGOING_LEADER_APPROVED', user, req);
        const prevLog = Array.isArray(handoff.auditLog) ? handoff.auditLog : [];

        const updated = await prisma.shiftHandoff.update({
            where: { id },
            data: {
                outgoingLeaderId: user.id,
                outgoingLeaderAt: new Date(),
                status: 'PENDING_INCOMING',
                auditLog: [...prevLog, auditEntry]
            },
            include: { deliveredBy: { select: { name: true } } }
        });

        logger.info(`Handoff outgoing approved: ${updated.deliveredBy.name} by leader ${user.name} | IP: ${auditEntry.ip}`);
        res.json({ success: true, handoff: updated });
    } catch (err) {
        logger.error('approveOutgoing error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff/:id/approve-incoming — Leader incoming approves a handoff
// ═══════════════════════════════════════════════════════════════════════════════
const approveIncoming = async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN incorrecto' });

        const shiftEmployee = user.shiftEmployee;
        if (!shiftEmployee || shiftEmployee.role !== 'LIDER') {
            return res.status(403).json({ error: 'Solo un líder puede aprobar entregas' });
        }

        const handoff = await prisma.shiftHandoff.findUnique({ where: { id } });
        if (!handoff) return res.status(404).json({ error: 'Entrega no encontrada' });
        if (handoff.status === 'APPROVED') return res.status(409).json({ error: 'Esta entrega ya fue aprobada completamente' });

        const auditEntry = buildAuditEntry('INCOMING_LEADER_APPROVED', user, req);
        const prevLog = Array.isArray(handoff.auditLog) ? handoff.auditLog : [];

        const updated = await prisma.shiftHandoff.update({
            where: { id },
            data: {
                incomingLeaderId: user.id,
                incomingLeaderAt: new Date(),
                status: 'APPROVED',
                auditLog: [...prevLog, auditEntry]
            },
            include: { deliveredBy: { select: { name: true } } }
        });

        logger.info(`Handoff incoming approved: ${updated.deliveredBy.name} by leader ${user.name} | IP: ${auditEntry.ip}`);
        res.json({ success: true, handoff: updated });
    } catch (err) {
        logger.error('approveIncoming error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff/:id/reject — Leader rejects a handoff with reason
// ═══════════════════════════════════════════════════════════════════════════════
const rejectHandoff = async (req, res) => {
    try {
        const { id } = req.params;
        const { pin, reason } = req.body;

        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Debes indicar un motivo de rechazo' });
        }

        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN incorrecto' });

        const shiftEmployee = user.shiftEmployee;
        if (!shiftEmployee || (shiftEmployee.role !== 'LIDER' && user.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'Solo un líder o admin puede rechazar entregas' });
        }

        const handoff = await prisma.shiftHandoff.findUnique({ where: { id } });
        if (!handoff) return res.status(404).json({ error: 'Entrega no encontrada' });

        const updated = await prisma.shiftHandoff.update({
            where: { id },
            data: {
                incomingLeaderId: user.id,
                rejectionReason: reason.trim(),
                status: 'REJECTED'
            },
            include: { deliveredBy: { select: { name: true } } }
        });

        logger.info(`Handoff rejected: ${updated.deliveredBy.name} by ${user.name} — reason: ${reason}`);
        res.json({ success: true, handoff: updated });
    } catch (err) {
        logger.error('rejectHandoff error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /handoff/today — All handoffs for today with operator status
// ═══════════════════════════════════════════════════════════════════════════════
const getTodayHandoffs = async (req, res) => {
    try {
        const today = getTodayDate();
        const outgoingShift = getOutgoingShift();

        // El turno inicia el domingo a las 22:00 (NOCHE). 
        // Antes de eso, y hasta el lunes a las 06:00, no se exige entrega del turno 'TARDE' porque el domingo de día no se trabaja.
        const isSunday = today.getDay() === 0;
        const isMondayEarlyMorning = today.getDay() === 1 && outgoingShift === 'TARDE';

        if (isSunday || isMondayEarlyMorning) {
            return res.json({
                handoffs: [],
                operators: [],
                outgoingShift,
                incomingShift: getIncomingShift(),
                weekId: null,
                allDelivered: true,
                pendingCount: 0
            });
        }

        const monday = getMonday(today);

        const week = await prisma.shiftWeek.findUnique({
            where: { weekStart: monday },
            include: {
                assignments: {
                    include: {
                        employee: {
                            include: { user: { select: { id: true, name: true, role: true } } }
                        }
                    }
                }
            }
        });

        if (!week) {
            return res.json({ handoffs: [], operators: [], outgoingShift: getOutgoingShift(), weekId: null });
        }

        // Get all operators assigned to the outgoing shift (only production areas)
        // Exclude employees with active absences and LIDERs (they only sign, don't deliver)
        const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
        const absentIds = await getAbsentEmployeeIds(today);
        const outgoingOperators = week.assignments
            .filter(a => a.shift === outgoingShift && productionAreas.includes(a.employee?.area) && !absentIds.has(a.employeeId) && a.employee?.role !== 'LIDER')
            .map(a => ({
                shiftEmployeeId: a.employeeId,
                userId: a.employee?.user?.id || null,
                name: a.employee?.name || 'Sin nombre',
                area: a.employee?.area,
                role: a.employee?.role,
            }));

        // Get today's handoffs
        const handoffs = await prisma.shiftHandoff.findMany({
            where: { weekId: week.id, date: today, outgoingShift },
            include: {
                deliveredBy: { select: { id: true, name: true } },
                outgoingLeader: { select: { id: true, name: true } },
                incomingLeader: { select: { id: true, name: true } }
            },
            orderBy: { deliveredAt: 'asc' }
        });

        // Build status per operator
        const operatorStatus = outgoingOperators.map(op => {
            const handoff = handoffs.find(h => h.deliveredById === op.userId);
            return {
                ...op,
                status: handoff ? handoff.status : 'NOT_DELIVERED',
                handoffId: handoff?.id || null,
                deliveredAt: handoff?.deliveredAt || null,
                outgoingLeaderAt: handoff?.outgoingLeaderAt || null,
                incomingLeaderAt: handoff?.incomingLeaderAt || null,
                rejectionReason: handoff?.rejectionReason || null,
            };
        });

        res.json({
            handoffs,
            operators: operatorStatus,
            outgoingShift,
            incomingShift: getIncomingShift(),
            weekId: week.id,
            allDelivered: operatorStatus.length > 0 && operatorStatus.every(o => o.status === 'APPROVED'),
            pendingCount: operatorStatus.filter(o => o.status !== 'APPROVED').length,
        });
    } catch (err) {
        logger.error('getTodayHandoffs error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /handoff/block-status — Check if current shift is blocked
//  Returns { blocked: true/false, pending: [...] }
// ═══════════════════════════════════════════════════════════════════════════════
const getBlockStatus = async (req, res) => {
    try {
        // Admin never blocked
        if (req.user?.role === 'ADMIN') {
            return res.json({ blocked: false, pending: [] });
        }

        const today = getShiftDate();
        const outgoingShift = getOutgoingShift();

        if (today.getDay() === 0 && (outgoingShift === 'MANANA' || outgoingShift === 'TARDE')) {
            return res.json({ blocked: false, pending: [] });
        }

        // ── Pre-handoff window detection ──────────────────────────────────────
        // 10 min before shift end: block outgoing workers BEFORE the grace period
        const activeShift = getCurrentActiveShift();
        const minutesToEnd = getMinutesUntilShiftEnd(activeShift);
        const isPreHandoffWindow = minutesToEnd <= PRE_HANDOFF_MINUTES && minutesToEnd > 0;

        const monday = getMonday(today);

        const week = await prisma.shiftWeek.findUnique({
            where: { weekStart: monday },
            include: {
                assignments: {
                    include: {
                        employee: {
                            include: { user: { select: { id: true, name: true, role: true } } }
                        }
                    }
                }
            }
        });

        if (!week) {
            return res.json({ blocked: false, pending: [], reason: 'No hay cuadro de turnos' });
        }

        const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];

        // Get outgoing shift operators (only those with a linked user account, since they need a PIN)
        // Exclude employees with active absences and LIDERs (they only sign, don't deliver)
        const absentIds = await getAbsentEmployeeIds(today);
        const outgoingOperators = week.assignments
            .filter(a => a.shift === outgoingShift && productionAreas.includes(a.employee?.area) && a.employee?.user?.id != null && !absentIds.has(a.employeeId) && a.employee?.role !== 'LIDER')
            .map(a => ({
                userId: a.employee?.user?.id,
                name: a.employee?.name || 'Sin nombre',
                area: a.employee?.area,
            }));

        // If no outgoing operators, not blocked
        if (outgoingOperators.length === 0) {
            return res.json({ blocked: false, pending: [] });
        }

        // Get today's handoffs for outgoing shift
        const handoffs = await prisma.shiftHandoff.findMany({
            where: { weekId: week.id, date: today, outgoingShift }
        });

        // Determine current user's area group
        let currentUserAreaGroup = null; // 'PRODUCCION_SIROPES' or 'EMPAQUE'
        const currentUserShiftEmp = await prisma.shiftEmployee.findFirst({
            where: { userId: req.user?.id }
        });

        if (currentUserShiftEmp) {
            if (['PRODUCCION', 'SIROPES'].includes(currentUserShiftEmp.area)) {
                currentUserAreaGroup = 'PRODUCCION_SIROPES';
            } else if (currentUserShiftEmp.area === 'EMPAQUE') {
                currentUserAreaGroup = 'EMPAQUE';
            }
        }

        const pending = [];
        for (const op of outgoingOperators) {
            // Determine if the operator is in the same area group as the current user
            // If the user's group is unknown, or they are an admin, we check everything by default, 
            // but Admin is already handled and never blocked.
            let opGroup = null;
            if (['PRODUCCION', 'SIROPES'].includes(op.area)) {
                opGroup = 'PRODUCCION_SIROPES';
            } else if (op.area === 'EMPAQUE') {
                opGroup = 'EMPAQUE';
            }

            // Only consider operators in the same area group as the current user
            if (currentUserAreaGroup && opGroup !== currentUserAreaGroup) continue;

            const handoff = handoffs.find(h => h.deliveredById === op.userId);
            if (!handoff) {
                pending.push({ userId: op.userId, name: op.name, area: op.area, reason: 'No ha entregado su turno', handoffId: null });
            } else if (handoff.status === 'PENDING') {
                pending.push({ userId: op.userId, name: op.name, area: op.area, reason: 'Firma pendiente: Líder Saliente', handoffId: handoff.id });
            } else if (handoff.status === 'PENDING_INCOMING') {
                pending.push({ userId: op.userId, name: op.name, area: op.area, reason: 'Firma pendiente: Líder Entrante', handoffId: handoff.id });
            } else if (handoff.status === 'REJECTED') {
                pending.push({ userId: op.userId, name: op.name, area: op.area, reason: 'Entrega rechazada — debe re-entregar', handoffId: handoff.id });
            }
        }

        const blocked = pending.length > 0;

        // Check if current user is in the incoming or outgoing shift
        const incomingShift = getIncomingShift();
        let isIncomingWorker = false;
        let isOutgoingWorker = false;
        if (currentUserShiftEmp) {
            const incomingAssignment = week.assignments.find(a =>
                a.employeeId === currentUserShiftEmp.id && a.shift === incomingShift
            );
            isIncomingWorker = !!incomingAssignment;

            const outgoingAssignment = week.assignments.find(a =>
                a.employeeId === currentUserShiftEmp.id && a.shift === outgoingShift
            );
            isOutgoingWorker = !!outgoingAssignment;
        }

        // Outgoing workers: blocked until all operators have delivered AND outgoing leader has signed
        // (i.e., no more NOT_DELIVERED, PENDING, or REJECTED statuses — only PENDING_INCOMING or APPROVED)
        const outgoingPending = pending.filter(p =>
            p.reason === 'No ha entregado su turno' ||
            p.reason === 'Firma pendiente: Líder Saliente' ||
            p.reason.startsWith('Entrega rechazada')
        );
        const outgoingBlocked = outgoingPending.length > 0;

        // ── Pre-handoff window: also block the user who is in the ACTIVE (ending) shift ──
        let preHandoffBlock = false;
        if (isPreHandoffWindow && currentUserShiftEmp) {
            const userInEndingShift = week.assignments.find(a =>
                a.employeeId === currentUserShiftEmp.id && a.shift === activeShift
            );
            if (userInEndingShift) {
                // Check if THIS user has already delivered
                const alreadyDelivered = await prisma.shiftHandoff.findFirst({
                    where: {
                        weekId: week.id,
                        date: today,
                        deliveredById: req.user.id,
                        status: { not: 'REJECTED' }
                    }
                });
                if (!alreadyDelivered) {
                    preHandoffBlock = true;
                }
            }
        }

        // Block if:
        // 1. Incoming shift worker and not all deliveries done
        // 2. Outgoing shift worker and leader signatures still needed
        // 3. Pre-handoff window and user hasn't delivered yet
        res.json({
            blocked: (blocked && isIncomingWorker) || (outgoingBlocked && isOutgoingWorker) || preHandoffBlock,
            preHandoffBlock,
            pending,
            outgoingShift: preHandoffBlock ? activeShift : outgoingShift,
            incomingShift,
            isOutgoingWorker: isOutgoingWorker || preHandoffBlock,
            isIncomingWorker,
            minutesToEnd: isPreHandoffWindow ? minutesToEnd : null
        });
    } catch (err) {
        logger.error('getBlockStatus error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /handoff/:id — Get a single handoff detail
// ═══════════════════════════════════════════════════════════════════════════════
const getHandoffDetail = async (req, res) => {
    try {
        const handoff = await prisma.shiftHandoff.findUnique({
            where: { id: req.params.id },
            include: {
                deliveredBy: { select: { id: true, name: true } },
                outgoingLeader: { select: { id: true, name: true } },
                incomingLeader: { select: { id: true, name: true } }
            }
        });
        if (!handoff) return res.status(404).json({ error: 'No encontrada' });
        res.json(handoff);
    } catch (err) {
        logger.error('getHandoffDetail error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff/verify-pin — Verify PIN and return user info for block screen
// ═══════════════════════════════════════════════════════════════════════════════
const verifyPin = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await validatePin(pin);
        if (!user) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        const shiftEmployee = user.shiftEmployee;
        res.json({
            user: {
                id: user.id,
                name: user.name,
                role: shiftEmployee?.role || user.role,
                area: shiftEmployee?.area || null,
                shiftEmployeeId: shiftEmployee?.id || null,
            }
        });
    } catch (err) {
        logger.error('verifyPin error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /handoff/alarm-status — Checks if current user should receive alarms
// ═══════════════════════════════════════════════════════════════════════════════
const getAlarmStatus = async (req, res) => {
    try {
        if (!req.user?.id) return res.json({ shouldAlert: false });

        const today = getShiftDate();
        const outgoingShift = getOutgoingShift(); // El turno que ESTÁ SALIENDO o A PUNTO DE SALIR
        
        if (today.getDay() === 0 && (outgoingShift === 'MANANA' || outgoingShift === 'TARDE')) {
            return res.json({ shouldAlert: false });
        }

        const monday = getMonday(today);
        const shiftEmp = await prisma.shiftEmployee.findFirst({
            where: { userId: req.user.id }
        });

        if (!shiftEmp) return res.json({ shouldAlert: false });

        const week = await prisma.shiftWeek.findUnique({
            where: { weekStart: monday },
            include: { assignments: { where: { employeeId: shiftEmp.id } } }
        });

        if (!week) return res.json({ shouldAlert: false });

        const assignment = week.assignments.find(a => a.shift === outgoingShift);
        if (!assignment) return res.json({ shouldAlert: false }); // User is not in the outgoing shift

        let shouldAlert = false;
        
        // Rules for alerting:
        // 1. Produccion/Siropes: Only the LIDER.
        // 2. Empaque: Any operator in Empaque.
        if (['PRODUCCION', 'SIROPES'].includes(shiftEmp.area)) {
            if (shiftEmp.role === 'LIDER') shouldAlert = true;
        } else if (shiftEmp.area === 'EMPAQUE') {
            shouldAlert = true;
        }

        res.json({
            shouldAlert,
            outgoingShift,
            area: shiftEmp.area,
            role: shiftEmp.role,
            userName: req.user.name
        });

    } catch (err) {
        logger.error('getAlarmStatus error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getChecklists,
    createHandoff,
    approveOutgoing,
    approveIncoming,
    rejectHandoff,
    getTodayHandoffs,
    getBlockStatus,
    getHandoffDetail,
    verifyPin,
    getAlarmStatus
};
