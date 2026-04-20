/**
 * shiftHandoverController.js — Shift Handover (Relevo de Turno) endpoints.
 * Isolated module: does NOT touch orders, inventory, auth core, or existing handoff system.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { validatePin, buildAuditEntry } = require('../services/pinValidationService');
const handoverService = require('../services/shiftHandoverService');

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/current?area=
//  Returns the current handover record for an area (with signatures)
// ═══════════════════════════════════════════════════════════════════════════════
const getCurrent = async (req, res) => {
    try {
        const enabled = await handoverService.isHandoverEnabled();
        if (!enabled) return res.json({ enabled: false });

        // Determine area from query param or from user's shiftEmployee
        let area = req.query.area;
        if (!area && req.user) {
            const emp = await prisma.shiftEmployee.findUnique({
                where: { userId: req.user.id },
                select: { area: true }
            });
            area = emp?.area;
        }

        if (!area || !handoverService.HANDOVER_AREAS.includes(area)) {
            return res.json({ enabled: true, handover: null, message: 'Área no participa en relevo' });
        }

        const activeShift = handoverService.getCurrentActiveShift();
        const opDate = handoverService.getOperationalDate(activeShift);
        const weekStartDate = handoverService.getWeekStartUTC(opDate);

        const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
        if (!week) return res.json({ enabled: true, handover: null, message: 'No hay cuadro para esta semana' });

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: {
                weekId_operationalDate_area_outgoingShift: {
                    weekId: week.id,
                    operationalDate: new Date(opDate + 'T00:00:00.000Z'),
                    area,
                    outgoingShift: activeShift
                }
            },
            include: {
                signatures: {
                    include: {
                        employee: { select: { id: true, name: true, role: true } },
                        user: { select: { id: true, name: true } }
                    },
                    orderBy: { signedAt: 'asc' }
                },
                outgoingLeader: { select: { id: true, name: true } },
                incomingLeader: { select: { id: true, name: true } },
                supervisor: { select: { id: true, name: true } }
            }
        });

        const minsUntilEnd = handoverService.getMinutesUntilShiftEnd(activeShift);

        // Filter absent employees from participants at runtime
        const absentIds = await handoverService.getAbsentEmployeeIds(opDate);
        let filteredHandover = handover;
        if (handover && absentIds.size > 0) {
            filteredHandover = {
                ...handover,
                outgoingParticipants: (handover.outgoingParticipants || []).filter(p => !absentIds.has(p.employeeId)),
                incomingParticipants: (handover.incomingParticipants || []).filter(p => !absentIds.has(p.employeeId))
            };
        }

        // Count expected vs signed (using filtered participants)
        const outgoingOps = (filteredHandover?.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
        const signedCount = filteredHandover?.signatures?.length || 0;
        const expectedCount = outgoingOps.length;

        res.json({
            enabled: true,
            handover: filteredHandover,
            area,
            outgoingShift: activeShift,
            incomingShift: handoverService.SHIFT_TRANSITIONS.find(t => t.outgoing === activeShift)?.incoming,
            minutesUntilEnd: minsUntilEnd,
            signedCount,
            expectedCount,
            allSigned: signedCount >= expectedCount && expectedCount > 0
        });
    } catch (err) {
        logger.error('[Handover] getCurrent error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/history?from=&to=&area=
// ═══════════════════════════════════════════════════════════════════════════════
const getHistory = async (req, res) => {
    try {
        const { from, to, area } = req.query;
        const where = {};

        if (from) where.operationalDate = { gte: new Date(from + 'T00:00:00.000Z') };
        if (to) {
            where.operationalDate = { ...where.operationalDate, lte: new Date(to + 'T00:00:00.000Z') };
        }
        if (area) where.area = area;

        const records = await prisma.shiftHandoverRecord.findMany({
            where,
            include: {
                signatures: {
                    include: {
                        employee: { select: { name: true, role: true } },
                        user: { select: { name: true } }
                    }
                },
                outgoingLeader: { select: { name: true } },
                incomingLeader: { select: { name: true } },
                supervisor: { select: { name: true } }
            },
            orderBy: [{ operationalDate: 'desc' }, { area: 'asc' }, { outgoingShift: 'asc' }],
            take: 100
        });

        res.json(records);
    } catch (err) {
        logger.error('[Handover] getHistory error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/checklists?area=
// ═══════════════════════════════════════════════════════════════════════════════
const getChecklists = async (req, res) => {
    try {
        const { area } = req.query;
        const where = { active: true };
        if (area) where.area = area;

        const checklists = await prisma.shiftHandoverChecklist.findMany({
            where,
            orderBy: [{ area: 'asc' }, { sortOrder: 'asc' }]
        });

        res.json(checklists);
    } catch (err) {
        logger.error('[Handover] getChecklists error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/:id
// ═══════════════════════════════════════════════════════════════════════════════
const getDetail = async (req, res) => {
    try {
        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: {
                signatures: {
                    include: {
                        employee: { select: { id: true, name: true, role: true } },
                        user: { select: { id: true, name: true } }
                    },
                    orderBy: { signedAt: 'asc' }
                },
                outgoingLeader: { select: { id: true, name: true } },
                incomingLeader: { select: { id: true, name: true } },
                supervisor: { select: { id: true, name: true } },
                forcedByUser: { select: { id: true, name: true } },
                week: { select: { weekStart: true, weekEnd: true, status: true } }
            }
        });

        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        res.json(handover);
    } catch (err) {
        logger.error('[Handover] getDetail error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/:id/signatures
// ═══════════════════════════════════════════════════════════════════════════════
const getSignatures = async (req, res) => {
    try {
        const sigs = await prisma.shiftHandoverSignature.findMany({
            where: { handoverId: req.params.id },
            include: {
                employee: { select: { id: true, name: true, role: true, area: true } },
                user: { select: { id: true, name: true } }
            },
            orderBy: { signedAt: 'asc' }
        });
        res.json(sigs);
    } catch (err) {
        logger.error('[Handover] getSignatures error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/sign — Operator signs with PIN
// ═══════════════════════════════════════════════════════════════════════════════
const signOperator = async (req, res) => {
    try {
        const { pin, notes } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });
        if (!user.shiftEmployee) return res.status(403).json({ error: 'Usuario no tiene empleado de turno asociado' });

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: { signatures: true }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });

        // Verify user is in the outgoing participants
        const outParticipants = handover.outgoingParticipants || [];
        const isOutgoing = outParticipants.some(p => p.userId === user.id || p.employeeId === user.shiftEmployee.id);
        if (!isOutgoing && user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'No estás asignado al turno saliente de este relevo' });
        }

        // Check not already signed
        const alreadySigned = handover.signatures.some(s => s.userId === user.id);
        if (alreadySigned) return res.status(409).json({ error: 'Ya firmaste este relevo' });

        // Can only sign when PENDING or IN_PROGRESS
        if (!['PENDING', 'IN_PROGRESS'].includes(handover.status)) {
            return res.status(409).json({ error: `No se puede firmar en estado: ${handover.status}` });
        }

        const audit = buildAuditEntry('OPERATOR_SIGNED', user, req);

        // Create signature
        await prisma.shiftHandoverSignature.create({
            data: {
                handoverId: handover.id,
                employeeId: user.shiftEmployee.id,
                userId: user.id,
                ipAddress: audit.ip,
                userAgent: audit.device,
                notes: notes || null
            }
        });

        // Check if all expected operators have now signed
        const outOps = outParticipants.filter(p => p.role !== 'LIDER');
        const newSignCount = handover.signatures.length + 1;
        const allSigned = newSignCount >= outOps.length && outOps.length > 0;

        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];
        const updateData = {
            status: allSigned ? 'IN_PROGRESS' : 'IN_PROGRESS', // stays IN_PROGRESS until leader authorizes
            auditLog: [...prevLog, audit]
        };
        if (allSigned) {
            updateData.allSignedAt = new Date();
        }
        // Move from PENDING to IN_PROGRESS on first signature
        if (handover.status === 'PENDING') {
            updateData.status = 'IN_PROGRESS';
        }

        await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: updateData
        });

        logger.info(`[Handover] Operator signed: ${user.name} (${user.shiftEmployee.area}) | Handover: ${handover.id} | ${newSignCount}/${outOps.length}`);

        res.json({
            success: true,
            operatorName: user.name,
            signedCount: newSignCount,
            expectedCount: outOps.length,
            allSigned
        });
    } catch (err) {
        logger.error('[Handover] signOperator error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/authorize-outgoing — Outgoing leader authorizes
// ═══════════════════════════════════════════════════════════════════════════════
const authorizeOutgoing = async (req, res) => {
    try {
        const { pin, checklist, pendingTasks, incidents, observations } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });

        // Must be LIDER or ADMIN
        const empRole = user.shiftEmployee?.role;
        if (empRole !== 'LIDER' && user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo un líder puede autorizar el relevo saliente' });
        }

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: { signatures: true }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        if (handover.status !== 'IN_PROGRESS') {
            return res.status(409).json({ error: `Estado actual no permite autorización: ${handover.status}` });
        }

        // Verify all operators have signed
        const outOps = (handover.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
        if (handover.signatures.length < outOps.length) {
            return res.status(409).json({
                error: `Faltan firmas de operarios: ${handover.signatures.length}/${outOps.length}`,
                signedCount: handover.signatures.length,
                expectedCount: outOps.length
            });
        }

        const audit = buildAuditEntry('OUTGOING_LEADER_AUTHORIZED', user, req);
        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                outgoingLeaderId: user.id,
                outgoingLeaderAt: new Date(),
                checklist: checklist || null,
                pendingTasks: pendingTasks || null,
                incidents: incidents || null,
                observations: observations || null,
                status: 'DELIVERED',
                auditLog: [...prevLog, audit]
            },
            include: {
                outgoingLeader: { select: { name: true } }
            }
        });

        logger.info(`[Handover] Outgoing leader authorized: ${user.name} | Handover: ${handover.id}`);
        res.json({ success: true, handover: updated });
    } catch (err) {
        logger.error('[Handover] authorizeOutgoing error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/accept-incoming — Incoming leader accepts
// ═══════════════════════════════════════════════════════════════════════════════
const acceptIncoming = async (req, res) => {
    try {
        const { pin, observations } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });

        const empRole = user.shiftEmployee?.role;
        if (empRole !== 'LIDER' && user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo un líder puede aceptar el relevo entrante' });
        }

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        if (handover.status !== 'DELIVERED') {
            return res.status(409).json({ error: `Estado actual no permite aceptación: ${handover.status}` });
        }

        const audit = buildAuditEntry('INCOMING_LEADER_ACCEPTED', user, req);
        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                incomingLeaderId: user.id,
                incomingLeaderAt: new Date(),
                observations: observations || handover.observations,
                status: 'RECEIVED',
                auditLog: [...prevLog, audit]
            },
            include: {
                incomingLeader: { select: { name: true } },
                outgoingLeader: { select: { name: true } }
            }
        });

        logger.info(`[Handover] Incoming leader accepted: ${user.name} | Handover: ${handover.id}`);
        res.json({ success: true, handover: updated });
    } catch (err) {
        logger.error('[Handover] acceptIncoming error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/validate — Supervisor validates (optional)
// ═══════════════════════════════════════════════════════════════════════════════
const validateHandover = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });
        if (user.role !== 'ADMIN' && user.shiftEmployee?.role !== 'LIDER') {
            return res.status(403).json({ error: 'Solo supervisores pueden validar' });
        }

        const handover = await prisma.shiftHandoverRecord.findUnique({ where: { id: req.params.id } });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        if (!['RECEIVED', 'WITH_INCIDENT'].includes(handover.status)) {
            return res.status(409).json({ error: `Estado no permite validación: ${handover.status}` });
        }

        const audit = buildAuditEntry('SUPERVISOR_VALIDATED', user, req);
        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                supervisorId: user.id,
                supervisorAt: new Date(),
                status: 'VALIDATED',
                auditLog: [...prevLog, audit]
            }
        });

        logger.info(`[Handover] Validated by supervisor: ${user.name} | Handover: ${handover.id}`);
        res.json({ success: true, handover: updated });
    } catch (err) {
        logger.error('[Handover] validateHandover error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/flag-incident — Flag incident on a handover
// ═══════════════════════════════════════════════════════════════════════════════
const flagIncident = async (req, res) => {
    try {
        const { pin, incidents } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });

        const handover = await prisma.shiftHandoverRecord.findUnique({ where: { id: req.params.id } });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });

        const audit = buildAuditEntry('INCIDENT_FLAGGED', user, req);
        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                incidents: incidents || handover.incidents,
                status: 'WITH_INCIDENT',
                auditLog: [...prevLog, audit]
            }
        });

        logger.info(`[Handover] Incident flagged by ${user.name} | Handover: ${handover.id}`);
        res.json({ success: true, handover: updated });
    } catch (err) {
        logger.error('[Handover] flagIncident error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/force-complete — Admin forces completion
// ═══════════════════════════════════════════════════════════════════════════════
const forceComplete = async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo ADMIN puede forzar completar un relevo' });
        }

        const { reason } = req.body;
        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ error: 'Debe proporcionar un motivo de al menos 5 caracteres' });
        }

        const handover = await prisma.shiftHandoverRecord.findUnique({ where: { id: req.params.id } });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });

        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];
        const audit = {
            action: 'FORCE_COMPLETED',
            userId: req.user.id,
            name: req.user.name,
            at: new Date().toISOString(),
            reason
        };

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                forcedCompleteBy: req.user.id,
                forcedCompleteAt: new Date(),
                forcedReason: reason,
                status: 'WITH_INCIDENT',
                auditLog: [...prevLog, audit]
            }
        });

        logger.warn(`[Handover] FORCE COMPLETED by admin ${req.user.name}: ${handover.id} | Reason: ${reason}`);
        res.json({ success: true, handover: updated });
    } catch (err) {
        logger.error('[Handover] forceComplete error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/verify-pin — Just verify PIN and return user info
// ═══════════════════════════════════════════════════════════════════════════════
const verifyPin = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });

        res.json({
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                shiftEmployee: user.shiftEmployee
            }
        });
    } catch (err) {
        logger.error('[Handover] verifyPin error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/alarm-status — Should user see alarm?
// ═══════════════════════════════════════════════════════════════════════════════
const alarmStatus = async (req, res) => {
    try {
        const enabled = await handoverService.isHandoverEnabled();
        if (!enabled) return res.json({ shouldAlert: false });
        if (!req.user?.id) return res.json({ shouldAlert: false });

        const info = await handoverService.getAlarmInfo(req.user.id);
        res.json(info);
    } catch (err) {
        logger.error('[Handover] alarmStatus error:', err);
        res.json({ shouldAlert: false });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/block-status — Is user blocked?
// ═══════════════════════════════════════════════════════════════════════════════
const blockStatus = async (req, res) => {
    try {
        const enabled = await handoverService.isHandoverEnabled();
        if (!enabled) return res.json({ blocked: false });
        if (!req.user?.id) return res.json({ blocked: false });

        const info = await handoverService.getBlockInfo(req.user.id);
        res.json(info);
    } catch (err) {
        logger.error('[Handover] blockStatus error:', err);
        res.json({ blocked: false });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  PUT /shift-handover/checklists — Admin manages checklist templates
// ═══════════════════════════════════════════════════════════════════════════════
const updateChecklists = async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo ADMIN puede gestionar checklists' });
        }

        const { items } = req.body; // [{id?, area, label, fieldType, sortOrder, active}]
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items debe ser un array' });

        const results = [];
        for (const item of items) {
            if (item.id) {
                const updated = await prisma.shiftHandoverChecklist.update({
                    where: { id: item.id },
                    data: {
                        label: item.label,
                        fieldType: item.fieldType || 'boolean',
                        sortOrder: item.sortOrder || 0,
                        active: item.active !== false
                    }
                });
                results.push(updated);
            } else {
                const created = await prisma.shiftHandoverChecklist.create({
                    data: {
                        area: item.area,
                        label: item.label,
                        fieldType: item.fieldType || 'boolean',
                        sortOrder: item.sortOrder || 0,
                        active: item.active !== false
                    }
                });
                results.push(created);
            }
        }

        res.json({ success: true, checklists: results });
    } catch (err) {
        logger.error('[Handover] updateChecklists error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getCurrent,
    getHistory,
    getChecklists,
    getDetail,
    getSignatures,
    signOperator,
    authorizeOutgoing,
    acceptIncoming,
    validateHandover,
    flagIncident,
    forceComplete,
    verifyPin,
    alarmStatus,
    blockStatus,
    updateChecklists
};
