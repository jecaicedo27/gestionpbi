/**
 * shiftHandoverController.js — Shift Handover (Relevo de Turno) endpoints.
 * Isolated module: does NOT touch orders, inventory, auth core, or existing handoff system.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { validatePin, buildAuditEntry } = require('../services/pinValidationService');
const handoverService = require('../services/shiftHandoverService');
const { buildShiftProductionSummary } = require('../services/shiftProductionSummaryService');
const { recordHandoverAttendance } = require('./attendanceController');

const prisma = new PrismaClient();
const COMPLETED_HANDOVER_STATUSES = ['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'];
const PRODUCTION_VALIDATED_AREAS = ['SIROPES', 'EMPAQUE'];
const AUTO_BATCH_SUMMARY_ID = 'AUTO_SHIFT_BATCH_SUMMARY';
const REVIEWABLE_HANDOVER_STATUSES = ['PENDING', 'IN_PROGRESS'];

async function getHandoverWithActiveParticipants(handover) {
    if (!handover) return handover;
    const absentSets = await handoverService.getAbsentParticipantSetsForHandover(handover);
    return handoverService.filterParticipantsByAbsentIds(handover, absentSets);
}

function getHandoverWindowTimes(handover) {
    if (!handover?.operationalDate) return null;
    const operationalDate = new Date(handover.operationalDate);
    const dateStr = `${operationalDate.getUTCFullYear()}-${String(operationalDate.getUTCMonth() + 1).padStart(2, '0')}-${String(operationalDate.getUTCDate()).padStart(2, '0')}`;
    const isSat = handoverService.isDateSaturday(dateStr);
    const transition = handoverService.getEffectiveTransition(handover.outgoingShift, isSat);
    if (!transition) return null;

    const endAt = new Date(`${dateStr}T${String(transition.endHour).padStart(2, '0')}:${String(transition.endMinute).padStart(2, '0')}:00-05:00`);

    if (handover.outgoingShift === 'NOCHE') {
        endAt.setUTCDate(endAt.getUTCDate() + 1);
    }

    return {
        endAt,
        preHandoverStartAt: new Date(endAt.getTime() - (handoverService.PRE_ALERT_MINUTES * 60 * 1000))
    };
}

function ensureOutgoingWindowIsOpen(handover) {
    const windowTimes = getHandoverWindowTimes(handover);
    if (!windowTimes) {
        return { allowed: false, error: `Turno saliente inválido: ${handover?.outgoingShift || 'desconocido'}` };
    }

    const now = new Date();
    if (now < windowTimes.preHandoverStartAt) {
        return {
            allowed: false,
            error: `La firma de salida solo se habilita desde ${windowTimes.preHandoverStartAt.toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })}`
        };
    }

    return { allowed: true, windowTimes };
}

async function resolveCurrentHandoverForArea(area) {
    if (!area || !handoverService.HANDOVER_AREAS.includes(area)) {
        return { enabled: true, area, handover: null, message: 'Área no participa en relevo' };
    }

    const activeShift = handoverService.getCurrentActiveShift();
    const currentTransition = handoverService.getCurrentTransition();

    const loadHandover = async (transition) => {
        if (!transition) return null;
        const opDate = handoverService.getOperationalDate(transition.outgoing);
        const weekStartDate = handoverService.getWeekStartUTC(opDate);
        const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
        if (!week) return null;

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: {
                weekId_operationalDate_area_outgoingShift: {
                    weekId: week.id,
                    operationalDate: new Date(opDate + 'T00:00:00.000Z'),
                    area,
                    outgoingShift: transition.outgoing
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

        return { handover, opDate, outgoingShift: transition.outgoing, incomingShift: transition.incoming };
    };

    const effectiveTransitions = handoverService.isColombiaSaturday() ? handoverService.SATURDAY_TRANSITIONS : handoverService.SHIFT_TRANSITIONS;
    const previousTransition = effectiveTransitions.find(t => t.incoming === activeShift);
    const activeTransition = effectiveTransitions.find(t => t.outgoing === activeShift);
    const candidates = currentTransition
        ? [currentTransition]
        : [previousTransition, activeTransition].filter(Boolean);

    let selected = null;
    for (const transition of candidates) {
        const candidate = await loadHandover(transition);
        if (!candidate) continue;
        if (!selected) selected = candidate;
        if (candidate.handover && !COMPLETED_HANDOVER_STATUSES.includes(candidate.handover.status)) {
            selected = candidate;
            break;
        }
    }

    if (!selected) {
        return { enabled: true, area, handover: null, message: 'No hay cuadro para esta semana' };
    }

    const { handover, opDate, outgoingShift, incomingShift } = selected;
    const minsUntilEnd = handoverService.getMinutesUntilShiftEnd(outgoingShift);

    const filteredHandover = await getHandoverWithActiveParticipants(handover);

    const outgoingOps = (filteredHandover?.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
    const signatureState = filteredHandover
        ? handoverService.getHandoverSignatureState(filteredHandover)
        : {
            outgoing: { signedCount: 0, expectedCount: outgoingOps.length, allSigned: false, missingParticipants: [] },
            incoming: { signedCount: 0, expectedCount: 0, allSigned: false, missingParticipants: [] }
        };

    return {
        enabled: true,
        handover: filteredHandover,
        area,
        outgoingShift,
        incomingShift,
        minutesUntilEnd: minsUntilEnd,
        signedCount: signatureState.outgoing.signedCount,
        expectedCount: signatureState.outgoing.expectedCount,
        allSigned: signatureState.outgoing.allSigned,
        signatureState
    };
}

function isLeaderParticipant(participants, user) {
    return (participants || []).some((participant) =>
        participant.role === 'LIDER' &&
        (participant.userId === user.id || participant.employeeId === user.shiftEmployee?.id)
    );
}

async function findAssignmentParticipant({ handover, user, participantSide }) {
    if (!handover?.weekId || !user?.shiftEmployee?.id) return null;

    const expectedShift = participantSide === 'INCOMING'
        ? handover.incomingShift
        : handover.outgoingShift;

    const assignment = await prisma.shiftAssignment.findFirst({
        where: {
            weekId: handover.weekId,
            employeeId: user.shiftEmployee.id,
            area: handover.area,
            shift: expectedShift
        },
        include: {
            employee: {
                select: {
                    id: true,
                    name: true,
                    role: true,
                    userId: true
                }
            }
        }
    });

    if (!assignment?.employee) return null;

    return {
        employeeId: assignment.employee.id,
        name: assignment.employee.name,
        role: assignment.employee.role,
        userId: assignment.employee.userId
    };
}

async function syncParticipantFromAssignment({ handover, user, participantSide }) {
    const assignmentParticipant = await findAssignmentParticipant({ handover, user, participantSide });
    if (!assignmentParticipant) return { handover, participant: null };

    const field = participantSide === 'INCOMING' ? 'incomingParticipants' : 'outgoingParticipants';
    const currentParticipants = Array.isArray(handover[field]) ? handover[field] : [];
    const alreadyPresent = currentParticipants.some(participant =>
        participant.employeeId === assignmentParticipant.employeeId ||
        participant.userId === assignmentParticipant.userId
    );

    if (alreadyPresent) {
        return { handover, participant: assignmentParticipant };
    }

    const updatedParticipants = [...currentParticipants, assignmentParticipant];
    const updatedHandover = await prisma.shiftHandoverRecord.update({
        where: { id: handover.id },
        data: { [field]: updatedParticipants },
        include: { signatures: true }
    });

    return { handover: updatedHandover, participant: assignmentParticipant };
}

function isParticipantOrAdmin(handover, user) {
    if (user.role === 'ADMIN') return true;
    const employeeId = user.shiftEmployee?.id;
    return [
        ...(handover.outgoingParticipants || []),
        ...(handover.incomingParticipants || [])
    ].some(participant =>
        participant.userId === user.id ||
        (employeeId && participant.employeeId === employeeId)
    );
}

function findSavedBatchSummary(checklist) {
    if (!Array.isArray(checklist)) return null;
    const item = checklist.find(entry =>
        entry?.id === AUTO_BATCH_SUMMARY_ID ||
        entry?.fieldType === 'production_summary'
    );
    return item?.value || null;
}

function withSavedReviewSelections(summary, handover) {
    const saved = findSavedBatchSummary(handover.checklist);
    if (!saved?.reviewSelections) return summary;
    return {
        ...summary,
        reviewSelections: saved.reviewSelections,
        reviewedAt: saved.reviewedAt || summary.reviewedAt || null
    };
}

function normalizeReviewSelections(reviewSelections, user) {
    if (!reviewSelections || typeof reviewSelections !== 'object' || Array.isArray(reviewSelections)) {
        return {};
    }

    const normalized = {};
    for (const [section, entries] of Object.entries(reviewSelections)) {
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
        const sectionEntries = {};
        for (const [batchKey, value] of Object.entries(entries)) {
            const selected = typeof value === 'object' ? value.selected !== false : Boolean(value);
            if (!selected) continue;
            sectionEntries[batchKey] = {
                selected: true,
                userId: value?.userId || user.id,
                userName: value?.userName || user.name,
                selectedAt: value?.selectedAt || new Date().toISOString()
            };
        }
        if (Object.keys(sectionEntries).length > 0) {
            normalized[section] = sectionEntries;
        }
    }
    return normalized;
}

function upsertBatchSummaryChecklistItem(checklist, summary) {
    const existing = Array.isArray(checklist) ? checklist : [];
    const filtered = existing.filter(entry =>
        entry?.id !== AUTO_BATCH_SUMMARY_ID &&
        entry?.fieldType !== 'production_summary'
    );
    return [
        {
            id: AUTO_BATCH_SUMMARY_ID,
            label: summary.title || 'Baches del turno',
            fieldType: 'production_summary',
            value: summary
        },
        ...filtered
    ];
}

function mergeReviewSelections(savedSelections = {}, submittedSelections = {}) {
    const merged = { ...savedSelections };
    for (const [section, entries] of Object.entries(submittedSelections || {})) {
        merged[section] = {
            ...(merged[section] || {}),
            ...(entries || {})
        };
    }
    return merged;
}

function mergeSubmittedChecklistWithSavedReview(submittedChecklist, handover) {
    if (!Array.isArray(submittedChecklist)) return submittedChecklist || null;
    const savedSummary = findSavedBatchSummary(handover.checklist);
    if (!savedSummary?.reviewSelections) return submittedChecklist;

    return submittedChecklist.map(item => {
        if (item?.id !== AUTO_BATCH_SUMMARY_ID && item?.fieldType !== 'production_summary') return item;
        return {
            ...item,
            value: {
                ...(item.value || {}),
                reviewSelections: mergeReviewSelections(
                    savedSummary.reviewSelections,
                    item.value?.reviewSelections || {}
                ),
                reviewedAt: item.value?.reviewedAt || savedSummary.reviewedAt || new Date().toISOString()
            }
        };
    });
}

async function ensureLeaderCanValidateHandover({ user, handover, participantSide }) {
    if (user.shiftEmployee?.role !== 'LIDER') {
        return {
            allowed: false,
            error: participantSide === 'OUTGOING'
                ? 'Solo un líder puede autorizar el relevo saliente'
                : 'Solo un líder puede aceptar el relevo entrante'
        };
    }

    const validationArea = PRODUCTION_VALIDATED_AREAS.includes(handover.area) ? 'PRODUCCION' : handover.area;
    let validationSource = handover;

    if (validationArea !== handover.area) {
        validationSource = await prisma.shiftHandoverRecord.findUnique({
            where: {
                weekId_operationalDate_area_outgoingShift: {
                    weekId: handover.weekId,
                    operationalDate: handover.operationalDate,
                    area: validationArea,
                    outgoingShift: handover.outgoingShift
                }
            }
        });
    }

    if (!validationSource) {
        return {
            allowed: false,
            error: `No se encontró el relevo de ${validationArea.toLowerCase()} para validar ${handover.area.toLowerCase()}`
        };
    }

    validationSource = await getHandoverWithActiveParticipants(validationSource);

    const participants = participantSide === 'OUTGOING'
        ? validationSource.outgoingParticipants
        : validationSource.incomingParticipants;

    if (isLeaderParticipant(participants, user)) {
        return { allowed: true };
    }

    if (PRODUCTION_VALIDATED_AREAS.includes(handover.area)) {
        return {
            allowed: false,
            error: participantSide === 'OUTGOING'
                ? `El relevo de ${handover.area.toLowerCase()} solo lo puede autorizar el líder saliente de Producción`
                : `El relevo de ${handover.area.toLowerCase()} solo lo puede aceptar el líder entrante de Producción`
        };
    }

    return {
        allowed: false,
        error: participantSide === 'OUTGOING'
            ? 'Solo el líder saliente asignado puede autorizar este relevo'
            : 'Solo el líder entrante asignado puede aceptar este relevo'
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/simulation/tarde-noche
//  Admin-only dry run: validates the real roster without writing signatures.
// ═══════════════════════════════════════════════════════════════════════════════
const getTardeNocheSimulation = async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo ADMIN puede iniciar simulacros de relevo' });
        }

        const enabled = await handoverService.isHandoverEnabled();
        if (!enabled) return res.json({ enabled: false, simulation: true, records: [] });

        const outgoingShift = 'TARDE';
        const incomingShift = 'NOCHE';
        const opDate = handoverService.getOperationalDate(outgoingShift);
        const weekStartDate = handoverService.getWeekStartUTC(opDate);
        const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
        if (!week) {
            return res.json({
                enabled: true,
                simulation: true,
                records: [],
                message: 'No hay cuadro publicado para simular el relevo Tarde → Noche'
            });
        }

        const records = await prisma.shiftHandoverRecord.findMany({
            where: {
                weekId: week.id,
                operationalDate: new Date(opDate + 'T00:00:00.000Z'),
                outgoingShift,
                incomingShift,
                area: { in: handoverService.HANDOVER_AREAS }
            },
            orderBy: { area: 'asc' }
        });

        const checklists = await prisma.shiftHandoverChecklist.findMany({
            where: { active: true, area: { in: handoverService.HANDOVER_AREAS } },
            orderBy: [{ area: 'asc' }, { sortOrder: 'asc' }]
        });

        const simulationRecords = await Promise.all(records.map(async (record) => {
            const filteredRecord = await getHandoverWithActiveParticipants(record);
            return {
            id: `SIM-${record.id}`,
            realHandoverId: record.id,
            actualStatus: record.status,
            area: record.area,
            operationalDate: record.operationalDate,
            outgoingShift: record.outgoingShift,
            incomingShift: record.incomingShift,
            graceDeadline: record.graceDeadline,
            status: 'PENDING',
            outgoingParticipants: filteredRecord.outgoingParticipants || [],
            incomingParticipants: filteredRecord.incomingParticipants || [],
            signatures: [],
            outgoingLeader: null,
            outgoingLeaderAt: null,
            incomingLeader: null,
            incomingLeaderAt: null,
            checklist: null,
            pendingTasks: null,
            incidents: null,
            observations: null
        };
        }));

        res.json({
            enabled: true,
            simulation: true,
            operationalDate: opDate,
            outgoingShift,
            incomingShift,
            records: simulationRecords,
            checklists,
            generatedAt: new Date().toISOString()
        });
    } catch (err) {
        logger.error('[Handover] getTardeNocheSimulation error:', err);
        res.status(500).json({ error: err.message });
    }
};

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

        res.json(await resolveCurrentHandoverForArea(area));
    } catch (err) {
        logger.error('[Handover] getCurrent error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /shift-handover/current-all
//  Shared dashboard helper: returns all handover areas in one request
// ═══════════════════════════════════════════════════════════════════════════════
const getCurrentAll = async (req, res) => {
    try {
        const enabled = await handoverService.isHandoverEnabled();
        if (!enabled) {
            return res.json({
                enabled: false,
                areas: handoverService.HANDOVER_AREAS.map(area => ({ enabled: false, area, handover: null }))
            });
        }

        const areas = await Promise.all(
            handoverService.HANDOVER_AREAS.map(area => resolveCurrentHandoverForArea(area))
        );

        res.json({ enabled: true, areas });
    } catch (err) {
        logger.error('[Handover] getCurrentAll error:', err);
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
//  GET /shift-handover/:id/production-summary
//  Automatic production snapshot for the leader handover checklist.
// ═══════════════════════════════════════════════════════════════════════════════
const getProductionSummary = async (req, res) => {
    try {
        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });

        const summary = withSavedReviewSelections(
            await buildShiftProductionSummary(prisma, handover),
            handover
        );
        res.json(summary);
    } catch (err) {
        logger.error('[Handover] getProductionSummary error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  PATCH /shift-handover/:id/review-selection
//  Saves visual review checks only inside the handover checklist JSON.
// ═══════════════════════════════════════════════════════════════════════════════
const updateReviewSelection = async (req, res) => {
    try {
        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        if (!REVIEWABLE_HANDOVER_STATUSES.includes(handover.status)) {
            return res.status(409).json({ error: `No se puede modificar la revisión en estado: ${handover.status}` });
        }
        const shiftEmployee = await prisma.shiftEmployee.findUnique({
            where: { userId: req.user.id }
        });
        const user = { ...req.user, shiftEmployee };
        if (!isParticipantOrAdmin(handover, user)) {
            return res.status(403).json({ error: 'Solo participantes del relevo o ADMIN pueden marcar esta revisión' });
        }

        const reviewSelections = normalizeReviewSelections(req.body?.reviewSelections, user);
        const summary = {
            ...(await buildShiftProductionSummary(prisma, handover)),
            reviewSelections,
            reviewedAt: new Date().toISOString()
        };
        const checklist = upsertBatchSummaryChecklistItem(handover.checklist, summary);

        await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: { checklist }
        });

        res.json({ success: true, summary });
    } catch (err) {
        logger.error('[Handover] updateReviewSelection error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /shift-handover/:id/sign — Operator signs with PIN
// ═══════════════════════════════════════════════════════════════════════════════
const signOperator = async (req, res) => {
    try {
        const { pin, notes } = req.body;
        const participantGroup = req.body?.participantGroup === 'INCOMING' ? 'INCOMING' : 'OUTGOING';
        const user = await validatePin(pin);
        if (!user) return res.status(401).json({ error: 'PIN inválido' });
        if (!user.shiftEmployee) return res.status(403).json({ error: 'Usuario no tiene empleado de turno asociado' });
        if (user.shiftEmployee.role === 'LIDER' && user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'La firma de operarios es solo para personal operativo. Los líderes firman en su paso de autorización.' });
        }

        let handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: { signatures: true }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });

        const participants = participantGroup === 'INCOMING'
            ? (handover.incomingParticipants || [])
            : (handover.outgoingParticipants || []);

        let isParticipant = participants.some(p => p.role !== 'LIDER' && (p.userId === user.id || p.employeeId === user.shiftEmployee.id));
        if (!isParticipant && user.role !== 'ADMIN') {
            const syncResult = await syncParticipantFromAssignment({
                handover,
                user,
                participantSide: participantGroup
            });
            if (syncResult.participant && syncResult.participant.role !== 'LIDER') {
                handover = syncResult.handover;
                isParticipant = true;
            }
        }
        if (!isParticipant && user.role !== 'ADMIN') {
            return res.status(403).json({
                error: participantGroup === 'INCOMING'
                    ? 'No estás asignado al turno entrante de este relevo'
                    : 'No estás asignado al turno saliente de este relevo'
            });
        }

        // Check not already signed
        const alreadySigned = handover.signatures.some(s => s.userId === user.id && s.participantGroup === participantGroup);
        if (alreadySigned) return res.status(409).json({ error: 'Ya firmaste este relevo' });

        if (participantGroup === 'OUTGOING' && !['PENDING', 'IN_PROGRESS'].includes(handover.status)) {
            return res.status(409).json({ error: `No se puede firmar salida en estado: ${handover.status}` });
        }
        if (participantGroup === 'INCOMING' && handover.status !== 'DELIVERED') {
            return res.status(409).json({ error: `No se puede firmar ingreso en estado: ${handover.status}` });
        }
        if (participantGroup === 'OUTGOING') {
            const outgoingWindow = ensureOutgoingWindowIsOpen(handover);
            if (!outgoingWindow.allowed) {
                return res.status(409).json({ error: outgoingWindow.error });
            }
        }

        const audit = buildAuditEntry(`${participantGroup}_OPERATOR_SIGNED`, user, req);

        // Create signature
        await prisma.shiftHandoverSignature.create({
            data: {
                handoverId: handover.id,
                employeeId: user.shiftEmployee.id,
                userId: user.id,
                participantGroup,
                ipAddress: audit.ip,
                userAgent: audit.device,
                notes: notes || null
            }
        });

        const updatedHandover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: handover.id },
            include: { signatures: true }
        });
        const signatureState = handoverService.getHandoverSignatureState(updatedHandover);
        const currentState = participantGroup === 'INCOMING' ? signatureState.incoming : signatureState.outgoing;

        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];
        const updateData = participantGroup === 'OUTGOING' ? {
            status: 'IN_PROGRESS',
            auditLog: [...prevLog, audit]
        } : {
            auditLog: [...prevLog, audit]
        };
        if (participantGroup === 'OUTGOING' && currentState.allSigned) {
            updateData.allSignedAt = new Date();
        }

        await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: updateData
        });

        logger.info(`[Handover] ${participantGroup} operator signed: ${user.name} (${user.shiftEmployee.area}) | Handover: ${handover.id} | ${currentState.signedCount}/${currentState.expectedCount}`);

        // Auto check-in/out from relevo signature (non-blocking)
        recordHandoverAttendance({
            userId: user.id,
            eventType: participantGroup === 'INCOMING' ? 'IN' : 'OUT',
            outgoingShift: handover.outgoingShift,
            signatureTime: new Date()
        }).catch(() => {});

        res.json({
            success: true,
            operatorName: user.name,
            participantGroup,
            signedCount: currentState.signedCount,
            expectedCount: currentState.expectedCount,
            allSigned: currentState.allSigned,
            signatureState
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

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: { signatures: true }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        // Permite PENDING si no hay operarios esperados (líder solo). Si hay operarios, deben firmar antes (mueven a IN_PROGRESS).
        if (!['PENDING', 'IN_PROGRESS'].includes(handover.status)) {
            return res.status(409).json({ error: `Estado actual no permite autorización: ${handover.status}` });
        }

        const outgoingWindow = ensureOutgoingWindowIsOpen(handover);
        if (!outgoingWindow.allowed) {
            return res.status(409).json({ error: outgoingWindow.error });
        }

        const filteredHandover = await getHandoverWithActiveParticipants(handover);

        const authorization = await ensureLeaderCanValidateHandover({
            user,
            handover: filteredHandover,
            participantSide: 'OUTGOING'
        });
        if (!authorization.allowed) {
            return res.status(403).json({ error: authorization.error });
        }

        // Verify all operators have signed (si hay operarios)
        const signatureState = handoverService.getHandoverSignatureState(filteredHandover);
        if (signatureState.outgoing.expectedCount > 0 && !signatureState.outgoing.allSigned) {
            return res.status(409).json({
                error: `Faltan firmas de operarios salientes: ${signatureState.outgoing.signedCount}/${signatureState.outgoing.expectedCount}`,
                signedCount: signatureState.outgoing.signedCount,
                expectedCount: signatureState.outgoing.expectedCount
            });
        }

        const audit = buildAuditEntry('OUTGOING_LEADER_AUTHORIZED', user, req);
        const prevLog = Array.isArray(handover.auditLog) ? handover.auditLog : [];
        const checklistForSave = mergeSubmittedChecklistWithSavedReview(checklist, handover);

        const updated = await prisma.shiftHandoverRecord.update({
            where: { id: handover.id },
            data: {
                outgoingLeaderId: user.id,
                outgoingLeaderAt: new Date(),
                checklist: checklistForSave,
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

        // Auto check-out from relevo signature (non-blocking)
        recordHandoverAttendance({
            userId: user.id,
            eventType: 'OUT',
            outgoingShift: handover.outgoingShift,
            signatureTime: new Date()
        }).catch(() => {});

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

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: { id: req.params.id },
            include: { signatures: true }
        });
        if (!handover) return res.status(404).json({ error: 'Relevo no encontrado' });
        if (handover.status !== 'DELIVERED') {
            return res.status(409).json({ error: `Estado actual no permite aceptación: ${handover.status}` });
        }

        const filteredHandover = await getHandoverWithActiveParticipants(handover);

        const authorization = await ensureLeaderCanValidateHandover({
            user,
            handover: filteredHandover,
            participantSide: 'INCOMING'
        });
        if (!authorization.allowed) {
            return res.status(403).json({ error: authorization.error });
        }

        const signatureState = handoverService.getHandoverSignatureState(filteredHandover);
        if (signatureState.incoming.expectedCount > 0 && !signatureState.incoming.allSigned) {
            return res.status(409).json({
                error: `Faltan firmas de operarios entrantes: ${signatureState.incoming.signedCount}/${signatureState.incoming.expectedCount}`,
                signedCount: signatureState.incoming.signedCount,
                expectedCount: signatureState.incoming.expectedCount
            });
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

        // Auto check-in from relevo signature (non-blocking)
        recordHandoverAttendance({
            userId: user.id,
            eventType: 'IN',
            outgoingShift: handover.outgoingShift,
            signatureTime: new Date()
        }).catch(() => {});

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

        const transition = handoverService.SHIFT_TRANSITIONS.find(t => t.outgoing === handover.outgoingShift);
        if (!transition) {
            return res.status(400).json({ error: `Turno saliente inválido: ${handover.outgoingShift}` });
        }

        const opDate = new Date(handover.operationalDate);
        const opDateStr = `${opDate.getUTCFullYear()}-${String(opDate.getUTCMonth() + 1).padStart(2, '0')}-${String(opDate.getUTCDate()).padStart(2, '0')}`;
        const handoverEndAt = new Date(`${opDateStr}T${String(transition.endHour).padStart(2, '0')}:${String(transition.endMinute).padStart(2, '0')}:00-05:00`);
        if (handover.outgoingShift === 'NOCHE') {
            handoverEndAt.setUTCDate(handoverEndAt.getUTCDate() + 1);
        }

        const forceWindowStartAt = new Date(handoverEndAt.getTime() - (handoverService.PRE_ALERT_MINUTES * 60 * 1000));
        if (new Date() < forceWindowStartAt) {
            return res.status(409).json({
                error: `No se puede forzar este relevo antes de ${forceWindowStartAt.toLocaleString('es-CO', {
                    timeZone: 'America/Bogota',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })}`
            });
        }

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
    getTardeNocheSimulation,
    getCurrent,
    getCurrentAll,
    getHistory,
    getChecklists,
    getDetail,
    getSignatures,
    getProductionSummary,
    updateReviewSelection,
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
