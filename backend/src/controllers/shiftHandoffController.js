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

// ── Determine outgoing shift by current hour (Colombia UTC-5) ────────────────
function getOutgoingShift() {
    const now = new Date();
    // Adjust to Colombia timezone (UTC-5)
    const colombiaOffset = -5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const localMinutes = utcMinutes + colombiaOffset;
    const localHour = Math.floor(((localMinutes % 1440) + 1440) % 1440 / 60);

    // Shift that just ended:
    // 6:00-14:00 → if current is between 6 and 14, outgoing is NOCHE
    // 14:00-22:00 → if current is between 14 and 22, outgoing is MANANA
    // 22:00-6:00 → if current is between 22 and 6, outgoing is TARDE
    if (localHour >= 6 && localHour < 14) return 'NOCHE';
    if (localHour >= 14 && localHour < 22) return 'MANANA';
    return 'TARDE';
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
    const now = new Date();
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

        // 6. Create or update (re-deliver after rejection)
        let handoff;
        if (existing && existing.status === 'REJECTED') {
            handoff = await prisma.shiftHandoff.update({
                where: { id: existing.id },
                data: {
                    checklist,
                    notes,
                    pendingTasks,
                    lotsProduced,
                    deliveredAt: new Date(),
                    status: 'PENDING',
                    approvedById: null,
                    approvedAt: null,
                    rejectionReason: null
                }
            });
            logger.info(`Re-delivery after rejection: ${user.name} (${area}) - ${outgoingShift}`);
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
                    lotsProduced
                }
            });
            logger.info(`Shift handoff created: ${user.name} (${area}) - ${outgoingShift}`);
        }

        res.json({ success: true, handoff, operatorName: user.name });
    } catch (err) {
        logger.error('createHandoff error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /handoff/:id/approve — Leader approves a handoff with PIN
// ═══════════════════════════════════════════════════════════════════════════════
const approveHandoff = async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        // 1. Validate PIN
        const user = await validatePin(pin);
        if (!user) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        // 2. Check if they're a leader
        const shiftEmployee = user.shiftEmployee;
        if (!shiftEmployee || shiftEmployee.role !== 'LIDER') {
            return res.status(403).json({ error: 'Solo un líder de turno puede aprobar entregas' });
        }

        // 3. Verify leader is in the incoming shift this week
        const today = getTodayDate();
        const monday = getMonday(today);
        const week = await prisma.shiftWeek.findUnique({ where: { weekStart: monday } });
        if (!week) return res.status(400).json({ error: 'No hay cuadro de turnos esta semana' });

        const incomingShift = getIncomingShift();
        const leaderAssignment = await prisma.shiftAssignment.findFirst({
            where: { weekId: week.id, employeeId: shiftEmployee.id, shift: incomingShift }
        });

        if (!leaderAssignment && user.role !== 'ADMIN') {
            return res.status(403).json({
                error: `Solo el líder del turno entrante (${incomingShift}) puede aprobar`
            });
        }

        // 4. Get handoff and approve
        const handoff = await prisma.shiftHandoff.findUnique({ where: { id } });
        if (!handoff) return res.status(404).json({ error: 'Entrega no encontrada' });
        if (handoff.status === 'APPROVED') return res.status(409).json({ error: 'Esta entrega ya fue aprobada' });

        const updated = await prisma.shiftHandoff.update({
            where: { id },
            data: {
                approvedById: user.id,
                approvedAt: new Date(),
                status: 'APPROVED'
            },
            include: { deliveredBy: { select: { name: true } } }
        });

        logger.info(`Handoff approved: ${updated.deliveredBy.name} by leader ${user.name}`);
        res.json({ success: true, handoff: updated });
    } catch (err) {
        logger.error('approveHandoff error:', err);
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
                approvedById: user.id,
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
        const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
        const outgoingOperators = week.assignments
            .filter(a => a.shift === outgoingShift && productionAreas.includes(a.employee?.area))
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
                approvedBy: { select: { id: true, name: true } }
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
                approvedAt: handoff?.approvedAt || null,
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

        const today = getTodayDate();
        const outgoingShift = getOutgoingShift();

        // El turno inicia el domingo a las 22:00 (NOCHE). 
        // Antes de eso, y hasta el lunes a las 06:00, no se exige entrega del turno 'TARDE' porque el domingo de día no se trabaja.
        const isSunday = today.getDay() === 0;
        const isMondayEarlyMorning = today.getDay() === 1 && outgoingShift === 'TARDE';

        if (isSunday || isMondayEarlyMorning) {
            return res.json({ blocked: false, pending: [] });
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
            return res.json({ blocked: false, pending: [], reason: 'No hay cuadro de turnos' });
        }

        const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];

        // Get outgoing shift operators
        const outgoingOperators = week.assignments
            .filter(a => a.shift === outgoingShift && productionAreas.includes(a.employee?.area))
            .map(a => ({
                userId: a.employee?.user?.id || null,
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

        const pending = [];
        for (const op of outgoingOperators) {
            const handoff = handoffs.find(h => h.deliveredById === op.userId);
            if (!handoff) {
                pending.push({ name: op.name, area: op.area, reason: 'No ha entregado su turno' });
            } else if (handoff.status === 'PENDING') {
                pending.push({ name: op.name, area: op.area, reason: 'Entregó pero falta aprobación del líder' });
            } else if (handoff.status === 'REJECTED') {
                pending.push({ name: op.name, area: op.area, reason: 'Entrega rechazada — debe re-entregar' });
            }
        }

        const blocked = pending.length > 0;

        // Check if current user is in the incoming shift (only block incoming shift workers)
        const incomingShift = getIncomingShift();
        const currentUserShiftEmp = await prisma.shiftEmployee.findFirst({
            where: { userId: req.user?.id }
        });

        let isIncomingWorker = false;
        if (currentUserShiftEmp) {
            const incomingAssignment = week.assignments.find(a =>
                a.employeeId === currentUserShiftEmp.id && a.shift === incomingShift
            );
            isIncomingWorker = !!incomingAssignment;
        }

        // Only block if user is in the incoming shift
        res.json({
            blocked: blocked && isIncomingWorker,
            pending,
            outgoingShift,
            incomingShift
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
                approvedBy: { select: { id: true, name: true } }
            }
        });
        if (!handoff) return res.status(404).json({ error: 'No encontrada' });
        res.json(handoff);
    } catch (err) {
        logger.error('getHandoffDetail error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getChecklists,
    createHandoff,
    approveHandoff,
    rejectHandoff,
    getTodayHandoffs,
    getBlockStatus,
    getHandoffDetail
};
