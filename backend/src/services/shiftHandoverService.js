/**
 * shiftHandoverService.js — Business logic for Shift Handover (Relevo de Turno).
 * Generates handover records, manages time windows, and calculates block status.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// ── Shift transitions: outgoing → incoming ────────────────────────────────────
const SHIFT_TRANSITIONS = [
    { outgoing: 'MANANA', incoming: 'TARDE',  endHour: 14, endMinute: 0 },
    { outgoing: 'TARDE',  incoming: 'NOCHE',  endHour: 22, endMinute: 0 },
    { outgoing: 'NOCHE',  incoming: 'MANANA', endHour: 6,  endMinute: 0 },
];

const HANDOVER_AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
const PRE_ALERT_MINUTES = 15;
const PRE_BLOCK_MINUTES = 10;
const GRACE_MINUTES = 10;
const COMPLETED_STATUSES = ['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'];

// ── Colombia timezone helpers ─────────────────────────────────────────────────

function getColombiaTime() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcMs + (-5 * 3600000));
}

function getColombiaMinutes() {
    const col = getColombiaTime();
    return col.getHours() * 60 + col.getMinutes();
}

function formatLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getColombiaDateString() {
    const col = getColombiaTime();
    return formatLocalDate(col);
}

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

// Build weekStart as stored in DB (midnight Colombia = T05:00:00.000Z)
function getWeekStartUTC(dateInput) {
    const monday = getMonday(dateInput);
    const dateStr = formatLocalDate(monday);
    return new Date(dateStr + 'T05:00:00.000Z');
}

// ── Get current active shift (no grace period) ────────────────────────────────
function getCurrentActiveShift() {
    const mins = getColombiaMinutes();
    if (mins >= 360 && mins < 840) return 'MANANA';   // 06:00–13:59
    if (mins >= 840 && mins < 1320) return 'TARDE';    // 14:00–21:59
    return 'NOCHE';                                     // 22:00–05:59
}

// ── Get current transition being processed ────────────────────────────────────
function getCurrentTransition() {
    const mins = getColombiaMinutes();

    for (const t of SHIFT_TRANSITIONS) {
        const endMins = t.endHour * 60 + t.endMinute;
        const preStart = (24 * 60 + endMins - PRE_ALERT_MINUTES) % (24 * 60);
        const graceEnd = (endMins + GRACE_MINUTES) % (24 * 60);

        if (preStart <= graceEnd) {
            if (mins >= preStart && mins <= graceEnd) return { ...t, preStart, graceEnd };
        } else if (mins >= preStart || mins <= graceEnd) {
            return { ...t, preStart, graceEnd };
        }
    }
    return null;
}

// ── Get operational date for a shift ──────────────────────────────────────────
// NOCHE that starts Sunday 22:00 → operational date is Sunday
// NOCHE pre-06:00 Monday morning → operational date is Sunday (previous day)
function getOperationalDate(shift) {
    const col = getColombiaTime();
    const mins = col.getHours() * 60 + col.getMinutes();

    if (shift === 'NOCHE' && mins < 1320) {
        // Before the next night shift starts, NOCHE belongs to yesterday.
        const yesterday = new Date(col);
        yesterday.setDate(yesterday.getDate() - 1);
        return formatLocalDate(yesterday);
    }
    return formatLocalDate(col);
}

// ── Minutes until a shift ends ────────────────────────────────────────────────
function getMinutesUntilShiftEnd(shift) {
    const mins = getColombiaMinutes();
    const transition = SHIFT_TRANSITIONS.find(t => t.outgoing === shift);
    if (!transition) return Infinity;

    let endMins = transition.endHour * 60 + transition.endMinute;
    if (shift === 'NOCHE' && mins >= 1320) endMins += 1440; // past 22:00 → end tomorrow
    return endMins - mins;
}

function getHandoverWindowPhase(outgoingShift) {
    const minutesUntilEnd = getMinutesUntilShiftEnd(outgoingShift);
    if (minutesUntilEnd <= PRE_BLOCK_MINUTES && minutesUntilEnd >= 0) return 'PRE_HANDOVER';
    if (minutesUntilEnd < 0 && minutesUntilEnd >= -GRACE_MINUTES) return 'GRACE';
    if (minutesUntilEnd < -GRACE_MINUTES) return 'POST_GRACE';
    return null;
}

function isParticipant(participants, employeeId) {
    return (participants || []).some(p => p.employeeId === employeeId);
}

function getParticipantOperators(participants) {
    return (participants || []).filter(p => p.role !== 'LIDER');
}

function getSignaturesByGroup(handover, participantGroup) {
    return (handover.signatures || []).filter(signature => signature.participantGroup === participantGroup);
}

function getSignedUserIdsByGroup(handover, participantGroup) {
    return new Set(getSignaturesByGroup(handover, participantGroup).map(signature => signature.userId));
}

function getMissingParticipants(participants, signedUserIds) {
    return getParticipantOperators(participants).filter(participant => !signedUserIds.has(participant.userId));
}

function getHandoverSignatureState(handover) {
    const outgoingSignedUserIds = getSignedUserIdsByGroup(handover, 'OUTGOING');
    const incomingSignedUserIds = getSignedUserIdsByGroup(handover, 'INCOMING');
    const outgoingOperators = getParticipantOperators(handover.outgoingParticipants);
    const incomingOperators = getParticipantOperators(handover.incomingParticipants);
    const outgoingMissing = getMissingParticipants(handover.outgoingParticipants, outgoingSignedUserIds);
    const incomingMissing = getMissingParticipants(handover.incomingParticipants, incomingSignedUserIds);

    return {
        outgoing: {
            signedCount: outgoingOperators.length - outgoingMissing.length,
            expectedCount: outgoingOperators.length,
            allSigned: outgoingOperators.length > 0 && outgoingMissing.length === 0,
            missingParticipants: outgoingMissing
        },
        incoming: {
            signedCount: incomingOperators.length - incomingMissing.length,
            expectedCount: incomingOperators.length,
            allSigned: incomingOperators.length > 0 && incomingMissing.length === 0,
            missingParticipants: incomingMissing
        }
    };
}

function getHandoverPendingSteps(handover) {
    const signatureState = getHandoverSignatureState(handover);
    const steps = [];

    if (signatureState.outgoing.missingParticipants.length > 0) {
        steps.push(`Faltan firmas de salida: ${signatureState.outgoing.missingParticipants.map(p => p.name).join(', ')}`);
    }
    if (signatureState.outgoing.missingParticipants.length === 0 && ['PENDING', 'IN_PROGRESS'].includes(handover.status)) {
        steps.push('Falta autorización del líder saliente');
    }
    if (handover.status === 'DELIVERED' && signatureState.incoming.missingParticipants.length > 0) {
        steps.push(`Faltan firmas de ingreso: ${signatureState.incoming.missingParticipants.map(p => p.name).join(', ')}`);
    }
    if (handover.status === 'DELIVERED' && signatureState.incoming.missingParticipants.length === 0) {
        steps.push('Falta aceptación del líder entrante');
    }

    return {
        steps,
        missingSigners: [
            ...signatureState.outgoing.missingParticipants.map(p => ({
                participantGroup: 'OUTGOING',
                employeeId: p.employeeId,
                userId: p.userId,
                name: p.name
            })),
            ...signatureState.incoming.missingParticipants.map(p => ({
                participantGroup: 'INCOMING',
                employeeId: p.employeeId,
                userId: p.userId,
                name: p.name
            }))
        ],
        signatureState
    };
}

function getParticipantPendingSteps(handover, participantSide) {
    const pending = getHandoverPendingSteps(handover);
    if (participantSide === 'OUTGOING') {
        return {
            steps: pending.steps.filter(step => !step.startsWith('Faltan firmas de ingreso')),
            missingSigners: pending.missingSigners.filter(item => item.participantGroup === 'OUTGOING')
        };
    }

    if (handover.status === 'PENDING' || handover.status === 'IN_PROGRESS') {
        return {
            steps: pending.steps,
            missingSigners: pending.missingSigners
        };
    }

    return {
        steps: pending.steps.filter(step => !step.startsWith('Faltan firmas de salida') && step !== 'Falta autorización del líder saliente'),
        missingSigners: pending.missingSigners.filter(item => item.participantGroup === 'INCOMING')
    };
}

// ── Check if feature flag is enabled ──────────────────────────────────────────
async function isHandoverEnabled() {
    const setting = await prisma.systemSettings.findUnique({
        where: { key: 'SHIFT_HANDOVER_ENABLED' }
    });
    return setting?.value === true || setting?.value === 'true';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Generate handover records for a published week
// ═══════════════════════════════════════════════════════════════════════════════
async function generateHandoversForWeek(weekId) {
    const week = await prisma.shiftWeek.findUnique({
        where: { id: weekId },
        include: {
            assignments: {
                include: { employee: { select: { id: true, name: true, role: true, userId: true, active: true } } }
            }
        }
    });

    if (!week || week.status !== 'PUBLISHED') {
        logger.warn(`[Handover] Cannot generate: week ${weekId} not published`);
        return { generated: 0 };
    }

    // Load ALL absences that overlap with this week (Sunday before through Saturday)
    const mondayDate = new Date(week.weekStart);
    const sundayBeforeDate = new Date(mondayDate);
    sundayBeforeDate.setDate(mondayDate.getDate() - 1);
    const saturdayDate = new Date(mondayDate);
    saturdayDate.setDate(mondayDate.getDate() + 6);

    const absences = await prisma.shiftAbsence.findMany({
        where: {
            startDate: { lte: saturdayDate },
            endDate: { gte: sundayBeforeDate }
        },
        select: { employeeId: true, startDate: true, endDate: true }
    });

    // Helper: check if an employee is absent on a specific date
    const isAbsentOnDate = (employeeId, dateStr) => {
        const d = new Date(dateStr + 'T12:00:00');
        return absences.some(a =>
            a.employeeId === employeeId &&
            a.startDate <= d &&
            a.endDate >= d
        );
    };

    // Filter to handover-eligible areas
    const assignments = week.assignments.filter(a =>
        HANDOVER_AREAS.includes(a.area) &&
        ['MANANA', 'TARDE', 'NOCHE'].includes(a.shift) &&
        a.employee.active
    );

    // Build participant map: { area: { shift: [employees] } }
    const participantMap = {};
    for (const a of assignments) {
        if (!participantMap[a.area]) participantMap[a.area] = {};
        if (!participantMap[a.area][a.shift]) participantMap[a.area][a.shift] = [];
        participantMap[a.area][a.shift].push({
            employeeId: a.employee.id,
            name: a.employee.name,
            role: a.employee.role,
            userId: a.employee.userId
        });
    }

    // Generate dates: Monday through Saturday (Sun night→Mon morning is handled as Sunday operational date)
    const monday = new Date(week.weekStart);
    const dates = [];
    for (let i = 0; i < 7; i++) { // Sun (via NOCHE) through Sat
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }

    // Also include the Sunday before (for NOCHE starting Sunday 22:00)
    const sundayBefore = new Date(monday);
    sundayBefore.setDate(monday.getDate() - 1);
    dates.unshift(sundayBefore.toISOString().split('T')[0]);

    let generated = 0;

    for (const area of HANDOVER_AREAS) {
        for (const transition of SHIFT_TRANSITIONS) {
            for (const dateStr of dates) {
                const opDate = new Date(dateStr + 'T00:00:00.000Z');
                const dayOfWeek = opDate.getUTCDay(); // 0=Sun

                // Skip Sunday daytime shifts (no MANANA→TARDE or TARDE→NOCHE on Sunday)
                if (dayOfWeek === 0 && (transition.outgoing === 'MANANA' || transition.outgoing === 'TARDE')) continue;

                // Filter out absent employees for THIS specific date
                const outgoing = (participantMap[area]?.[transition.outgoing] || [])
                    .filter(p => !isAbsentOnDate(p.employeeId, dateStr));
                const incoming = (participantMap[area]?.[transition.incoming] || [])
                    .filter(p => !isAbsentOnDate(p.employeeId, dateStr));
                if (outgoing.length === 0 && incoming.length === 0) continue;

                // Calculate grace deadline
                let graceDate = new Date(dateStr + 'T00:00:00.000Z');
                graceDate.setUTCHours(transition.endHour + 5, transition.endMinute + GRACE_MINUTES); // UTC = Colombia + 5
                if (transition.outgoing === 'NOCHE') {
                    // NOCHE ends next day at 06:00, grace until 06:10
                    graceDate = new Date(dateStr + 'T00:00:00.000Z');
                    graceDate.setDate(graceDate.getDate() + 1);
                    graceDate.setUTCHours(6 + 5, GRACE_MINUTES);
                }

                try {
                    await prisma.shiftHandoverRecord.upsert({
                        where: {
                            weekId_operationalDate_area_outgoingShift: {
                                weekId: week.id,
                                operationalDate: opDate,
                                area,
                                outgoingShift: transition.outgoing
                            }
                        },
                        create: {
                            weekId: week.id,
                            publishedAtSnapshot: week.publishedAt,
                            area,
                            operationalDate: opDate,
                            outgoingShift: transition.outgoing,
                            incomingShift: transition.incoming,
                            outgoingParticipants: outgoing,
                            incomingParticipants: incoming,
                            graceDeadline: graceDate,
                            status: 'PENDING',
                            auditLog: [{ action: 'GENERATED', at: new Date().toISOString(), source: 'publish' }]
                        },
                        update: {
                            // If re-published, update participants but don't reset status if already in progress
                            outgoingParticipants: outgoing,
                            incomingParticipants: incoming,
                            publishedAtSnapshot: week.publishedAt,
                            graceDeadline: graceDate
                        }
                    });
                    generated++;
                } catch (err) {
                    logger.error(`[Handover] Error generating for ${area}/${transition.outgoing}/${dateStr}: ${err.message}`);
                }
            }
        }
    }

    logger.info(`[Handover] Generated/updated ${generated} handover records for week ${weekId}`);
    return { generated };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Get the current handover record for a given area
// ═══════════════════════════════════════════════════════════════════════════════
async function getCurrentHandover(area) {
    const activeShift = getCurrentActiveShift();
    const opDate = getOperationalDate(activeShift);
    const weekStartDate = getWeekStartUTC(opDate);

    const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
    if (!week) return null;

    return prisma.shiftHandoverRecord.findUnique({
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
                }
            },
            outgoingLeader: { select: { id: true, name: true } },
            incomingLeader: { select: { id: true, name: true } },
            supervisor: { select: { id: true, name: true } }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Alarm status: should user see the pre-shift-end alarm?
// ═══════════════════════════════════════════════════════════════════════════════
async function getAlarmInfo(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { shiftEmployee: { select: { id: true, area: true, role: true } } }
    });

    if (!user?.shiftEmployee) return { shouldAlert: false };
    if (!HANDOVER_AREAS.includes(user.shiftEmployee.area)) return { shouldAlert: false };

    const activeShift = getCurrentActiveShift();
    const minsUntilEnd = getMinutesUntilShiftEnd(activeShift);
    const area = user.shiftEmployee.area;
    const opDate = getOperationalDate(activeShift);

    // Check if this user is in the current outgoing shift
    const weekStartDate = getWeekStartUTC(opDate);
    const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
    if (!week) return { shouldAlert: false };

    const assignment = await prisma.shiftAssignment.findFirst({
        where: {
            weekId: week.id,
            employeeId: user.shiftEmployee.id,
            shift: activeShift
        }
    });
    if (!assignment) return { shouldAlert: false };

    // Sunday daytime → no alert
    const dayOfWeek = new Date(opDate + 'T12:00:00').getDay();
    if (dayOfWeek === 0 && (activeShift === 'MANANA' || activeShift === 'TARDE')) {
        return { shouldAlert: false };
    }

    const shouldAlert = minsUntilEnd <= PRE_ALERT_MINUTES && minsUntilEnd > -GRACE_MINUTES;

    return {
        shouldAlert,
        minutesUntilEnd: minsUntilEnd,
        area,
        outgoingShift: activeShift,
        role: user.shiftEmployee.role
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Block status: is the incoming shift blocked?
// ═══════════════════════════════════════════════════════════════════════════════
async function getBlockInfo(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { shiftEmployee: { select: { id: true, area: true, role: true } } }
    });

    if (!user?.shiftEmployee) return { blocked: false };
    if (user.role === 'ADMIN') return { blocked: false };
    if (!HANDOVER_AREAS.includes(user.shiftEmployee.area)) return { blocked: false };

    const area = user.shiftEmployee.area;
    const activeShift = getCurrentActiveShift();
    const todayDate = getColombiaDateString();

    // Sunday daytime → no block
    const dayOfWeek = new Date(todayDate + 'T12:00:00').getDay();
    if (dayOfWeek === 0 && (activeShift === 'MANANA' || activeShift === 'TARDE')) {
        return { blocked: false };
    }

    const weekStartDate = getWeekStartUTC(todayDate);
    const week = await prisma.shiftWeek.findUnique({ where: { weekStart: weekStartDate } });
    if (!week) return { blocked: false };

    // Determine what transition the user would be involved in
    const userAssignment = await prisma.shiftAssignment.findFirst({
        where: { weekId: week.id, employeeId: user.shiftEmployee.id }
    });
    if (!userAssignment) return { blocked: false };
    const userShift = userAssignment.shift;

    const candidates = [];
    const addCandidate = (transition, participantSide) => {
        if (!transition) return;
        const phase = getHandoverWindowPhase(transition.outgoing);
        if (!phase) return;
        const opDate = getOperationalDate(transition.outgoing);
        const key = `${opDate}:${transition.outgoing}:${participantSide}`;
        if (candidates.some(c => c.key === key)) return;
        candidates.push({ key, transition, participantSide, phase, opDate });
    };

    const currentTransition = getCurrentTransition();
    if (currentTransition) {
        if (userShift === currentTransition.outgoing) addCandidate(currentTransition, 'OUTGOING');
        if (userShift === currentTransition.incoming) addCandidate(currentTransition, 'INCOMING');
    }

    addCandidate(SHIFT_TRANSITIONS.find(t => t.incoming === userShift), 'INCOMING');
    addCandidate(SHIFT_TRANSITIONS.find(t => t.outgoing === userShift), 'OUTGOING');

    for (const candidate of candidates) {
        const candidateWeek = await prisma.shiftWeek.findUnique({
            where: { weekStart: getWeekStartUTC(candidate.opDate) }
        });
        if (!candidateWeek) continue;

        const handover = await prisma.shiftHandoverRecord.findUnique({
            where: {
                weekId_operationalDate_area_outgoingShift: {
                    weekId: candidateWeek.id,
                    operationalDate: new Date(candidate.opDate + 'T00:00:00.000Z'),
                    area,
                    outgoingShift: candidate.transition.outgoing
                }
            },
            include: { signatures: true }
        });
        if (!handover || COMPLETED_STATUSES.includes(handover.status)) continue;

        const participants = candidate.participantSide === 'OUTGOING'
            ? handover.outgoingParticipants
            : handover.incomingParticipants;
        if (!isParticipant(participants, user.shiftEmployee.id)) continue;

        const pending = getParticipantPendingSteps(handover, candidate.participantSide);
        const signatureState = getHandoverSignatureState(handover);
        const minutesUntilEnd = getMinutesUntilShiftEnd(candidate.transition.outgoing);

        return {
            blocked: true,
            handoverId: handover.id,
            handoverStatus: handover.status,
            blockPhase: candidate.phase,
            participantSide: candidate.participantSide,
            pendingSteps: pending.steps,
            missingSigners: pending.missingSigners,
            signatureState,
            minutesUntilEnd,
            graceDeadline: handover.graceDeadline,
            requiresAdminRelease: candidate.phase === 'POST_GRACE' && pending.missingSigners.length > 0,
            area,
            outgoingShift: candidate.transition.outgoing,
            incomingShift: candidate.transition.incoming
        };
    }

    return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Get absent employee IDs for a given date
// ═══════════════════════════════════════════════════════════════════════════════
async function getAbsentEmployeeIds(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const absences = await prisma.shiftAbsence.findMany({
        where: {
            startDate: { lte: d },
            endDate: { gte: d }
        },
        select: { employeeId: true }
    });
    return new Set(absences.map(a => a.employeeId));
}

module.exports = {
    HANDOVER_AREAS,
    SHIFT_TRANSITIONS,
    PRE_ALERT_MINUTES,
    GRACE_MINUTES,
    getColombiaTime,
    getColombiaMinutes,
    getColombiaDateString,
    getMonday,
    getWeekStartUTC,
    getCurrentActiveShift,
    getCurrentTransition,
    getOperationalDate,
    getMinutesUntilShiftEnd,
    getHandoverSignatureState,
    getHandoverPendingSteps,
    getParticipantPendingSteps,
    isHandoverEnabled,
    generateHandoversForWeek,
    getCurrentHandover,
    getAlarmInfo,
    getBlockInfo,
    getAbsentEmployeeIds
};
