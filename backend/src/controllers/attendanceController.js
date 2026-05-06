/**
 * attendanceController.js
 * Control de ingreso y salida de empleados a la planta.
 * Gestiona: check-in, check-out, descansos, enrollment facial, reportes.
 */
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { getLaborSummary } = require('../services/laborSummaryService');
const prisma = new PrismaClient();

// Servicio Python YOLOv8 + InsightFace ArcFace
const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:3063';

const PAYROLL_CONFIG_KEY = 'attendance_payroll_config';
const PAYROLL_CLOSURE_PREFIX = 'attendance_payroll_closure:';
const DEFAULT_PAYROLL_CONFIG = {
    dayStart: '06:00',
    nightStart: '19:00',
    fortnightCutoffDay: 15,
    weeklyHours: 44,
    monthlyHourDivisor: 220,
    surchargeNight: 0.35,
    surchargeSundayDay: 0.80,
    surchargeSundayNight: 1.15,
    overtimeDay: 0.25,
    overtimeNight: 0.75,
    overtimeSundayDay: 1.05,
    overtimeSundayNight: 1.55,
};
const LABOR_NOVELTY_TYPES = [
    'AUSENCIA',
    'INCAPACIDAD',
    'PERMISO',
    'LICENCIA',
    'VACACIONES',
    'SUSPENSION',
    'CALAMIDAD',
];

function buildPayrollClosureKey(period) {
    return `${PAYROLL_CLOSURE_PREFIX}${period.type}:${period.from}:${period.to}`;
}

function buildClosureActor(user) {
    if (!user) return null;
    return {
        id: user.id,
        name: user.name,
        role: user.role,
    };
}

function appendClosureEvent(history, event) {
    const current = Array.isArray(history) ? history : [];
    return [...current, event];
}

function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

function buildPayrollClosureCsv(snapshot) {
    const rows = Array.isArray(snapshot?.summary) ? snapshot.summary : [];
    const headers = [
        'Empleado',
        'Cedula',
        'Area',
        'Cargo',
        'Dias Programados',
        'Dias Presentes',
        'Dias Ausencia',
        'Horas Programadas',
        'Horas Trabajadas',
        'Horas Ordinarias',
        'Horas Extra Diurnas',
        'Horas Extra Nocturnas',
        'Horas Extra Totales',
        'Porcentaje Trabajado',
        'Porcentaje Asistencia',
        'Porcentaje Ausencia',
        'Ausencias',
        'Incapacidades',
        'Permisos',
        'Licencias',
        'Vacaciones',
        'Suspensiones',
        'Calamidades',
        'Otras Novedades',
    ];

    const lines = [headers.join(',')];

    for (const row of rows) {
        const breakdown = row.absenceBreakdown || {};
        const knownReasons = new Set(LABOR_NOVELTY_TYPES);
        const otherNoveltyCount = Object.entries(breakdown).reduce((sum, [reason, count]) => (
            knownReasons.has(reason) ? sum : sum + Number(count || 0)
        ), 0);

        lines.push([
            row.employee?.name,
            row.employee?.cedula,
            row.employee?.area,
            row.employee?.role,
            row.scheduledDays,
            row.presentDays,
            row.absenceDays,
            row.scheduledHours,
            row.workedHours,
            row.ordinaryHours,
            row.overtimeDayHours,
            row.overtimeNightHours,
            row.overtimeHours,
            row.workedPct,
            row.attendancePct,
            row.absencePct,
            breakdown.AUSENCIA || 0,
            breakdown.INCAPACIDAD || 0,
            breakdown.PERMISO || 0,
            breakdown.LICENCIA || 0,
            breakdown.VACACIONES || 0,
            breakdown.SUSPENSION || 0,
            breakdown.CALAMIDAD || 0,
            otherNoveltyCount,
        ].map(escapeCsv).join(','));
    }

    return lines.join('\n');
}

// Roles que DEBEN registrar ingreso en kiosko para acceder a gestionpbi
const KIOSK_REQUIRED_ROLES = [
    'OPERARIO_PICKING',
    'PRODUCCION',
    'LOGISTICA',
    'CARTERA',
    'CONTABILIDAD',
    'RECURSOS_HUMANOS',
    'CALIDAD',
    'QUIMICO',
    'COMERCIAL',
];

// Roles que PUEDEN aparecer en el cuadro de turnos y marcar en kiosko (pero no es obligatorio para acceder)
// Incluye los REQUIRED + ADMIN (para que el equipo de administración pueda marcar entrada/desayuno/almuerzo/salida).
const KIOSK_ELIGIBLE_ROLES = [...KIOSK_REQUIRED_ROLES, 'ADMIN'];

// Turnos donde los descansos descuentan de las horas trabajadas (8:00-17:00 oficina)
const OFFICE_SHIFT_CODES = ['OFICINA', 'DIURNO'];

// ─── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Calcula la distancia euclidiana entre dos descriptores faciales (arrays de 128 floats).
 */
function faceDistance(d1, d2) {
    if (!d1 || !d2 || d1.length !== d2.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < d1.length; i++) {
        sum += (d1[i] - d2[i]) ** 2;
    }
    return Math.sqrt(sum);
}

/**
 * Normaliza el `faceDescriptor` almacenado a un array de descriptores.
 * Soporta dos formatos:
 *   - Legacy: array plano de 128 floats → [array]
 *   - Nuevo:  array de arrays de 128 floats → tal cual
 */
function getDescriptorList(stored) {
    if (!Array.isArray(stored) || stored.length === 0) return [];
    if (typeof stored[0] === 'number') return [stored]; // legacy
    return stored.filter(d => Array.isArray(d) && d.length === 128);
}

/**
 * Devuelve la MÍNIMA distancia entre el descriptor query y cualquiera de los
 * descriptores guardados del empleado. Mejora robustez bajo cambios de luz/ángulo.
 */
function bestFaceDistance(query, stored) {
    const list = getDescriptorList(stored);
    if (list.length === 0) return Infinity;
    let best = Infinity;
    for (const d of list) {
        const dist = faceDistance(query, d);
        if (dist < best) best = dist;
    }
    return best;
}

/**
 * Retorna el estado de presencia actual de un ShiftEmployee.
 * Un empleado está "en planta" si su último registro del día es ENTRY
 * y no tiene un EXIT FINAL posterior.
 */
async function getPresenceStatus(employeeId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const records = await prisma.attendanceRecord.findMany({
        where: {
            employeeId,
            timestamp: { gte: today },
        },
        orderBy: { timestamp: 'asc' },
    });

    if (records.length === 0) return { isInPlant: false, currentState: 'OUT', records };

    const last = records[records.length - 1];

    let currentState;
    if (last.type === 'ENTRY') {
        currentState = 'IN';
    } else if (last.type === 'EXIT' && last.subtype === 'FINAL') {
        currentState = 'OUT';
    } else {
        // EXIT con subtype BREAK/LUNCH/MEDICAL/PERSONAL
        currentState = 'BREAK';
    }

    return { isInPlant: currentState === 'IN', currentState, records };
}

/**
 * Calcula las horas trabajadas netas de un empleado en un rango de fechas.
 * Para turno OFICINA: descuenta descansos (BREAK, LUNCH, MEDICAL, PERSONAL).
 * Para otros turnos: no descuenta descansos.
 */
async function calcWorkedHours(employeeId, from, to) {
    const records = await prisma.attendanceRecord.findMany({
        where: {
            employeeId,
            timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: 'asc' },
    });

    // Buscar el turno de la semana activa mas reciente para saber si es OFICINA
    const weekAssignment = await prisma.shiftAssignment.findFirst({
        where: { employeeId },
        include: { week: true },
        orderBy: { week: { weekStart: 'desc' } },
    });

    const shiftCode = weekAssignment?.shift?.toUpperCase() || '';
    const isOfficeShift = OFFICE_SHIFT_CODES.includes(shiftCode);

    // Cálculo robusto:
    //  - Cada ENTRY abre un período de trabajo.
    //  - Cualquier EXIT cierra el período (sea FINAL, BREAK, LUNCH, etc).
    //  - Si el EXIT es BREAK/LUNCH/MEDICAL/PERSONAL, el lapso hasta el próximo ENTRY se cuenta como break.
    //  - Si la última marca es ENTRY (empleado todavía dentro), el período abierto se cierra al min(to, now).
    let totalMs = 0;
    let breakMs = 0;
    let entryTime = null;
    let breakStart = null;
    let breakSubtype = null;

    for (const rec of records) {
        const ts = new Date(rec.timestamp);
        if (rec.type === 'ENTRY') {
            // Si veníamos de un break, cerrar el lapso de break ahora
            if (breakStart) {
                breakMs += ts - breakStart;
                breakStart = null;
                breakSubtype = null;
            }
            entryTime = ts;
        } else if (rec.type === 'EXIT') {
            // Cualquier EXIT cierra el período de trabajo abierto
            if (entryTime) {
                totalMs += ts - entryTime;
                entryTime = null;
            }
            // Si es break/lunch/medical/personal, marcar inicio de break
            if (['BREAK', 'LUNCH', 'MEDICAL', 'PERSONAL'].includes(rec.subtype)) {
                breakStart = ts;
                breakSubtype = rec.subtype;
            }
        }
    }

    // Si el empleado todavía estaba dentro al final del rango, cerrar el período abierto al min(to, now)
    if (entryTime) {
        const cap = new Date(Math.min(new Date(to).getTime(), Date.now()));
        if (cap > entryTime) {
            totalMs += cap - entryTime;
        }
    }

    // Para horas netas: en turno OFICINA el almuerzo se descuenta. En turnos productivos, no.
    const netMs = isOfficeShift ? totalMs - breakMs : totalMs;

    return {
        totalHours: +(totalMs / 3600000).toFixed(2),
        breakHours: +(breakMs / 3600000).toFixed(2),
        netHours: +(netMs / 3600000).toFixed(2),
        isOfficeShift,
    };
}

// ─── Kiosko: búsqueda de empleado ────────────────────────────────────────────

/**
 * GET /api/attendance/find-by-cedula/:cedula
 * Retorna datos del empleado para mostrar en pantalla del kiosko.
 * Público (no requiere JWT).
 */
exports.findByCedula = async (req, res) => {
    try {
        const employee = await prisma.shiftEmployee.findUnique({
            where: { cedula: req.params.cedula, active: true },
            select: {
                id: true, name: true, area: true, role: true,
                photoUrl: true, isInPlant: true, lastEntryAt: true,
                cedula: true, faceDescriptor: true, faceDescriptorInsightface: true,
            },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const { isInPlant, currentState } = await getPresenceStatus(employee.id);
        // Indicar booleanos para el cliente (no enviar los embeddings completos)
        const { faceDescriptor, faceDescriptorInsightface, ...rest } = employee;
        res.json({
            ...rest,
            isInPlant,
            currentState,
            faceDescriptor: faceDescriptor ? true : null,
            faceDescriptorInsightface: faceDescriptorInsightface ? true : null,
        });
    } catch (err) {
        logger.error('findByCedula error:', err);
        res.status(500).json({ error: 'Error al buscar empleado' });
    }
};

/**
 * POST /api/attendance/match-face
 * Compara un descriptor facial contra todos los empleados activos.
 * Retorna el mejor match si la distancia es < threshold.
 * Público (no requiere JWT).
 */
exports.matchFace = async (req, res) => {
    try {
        const { descriptor } = req.body;
        if (!descriptor || !Array.isArray(descriptor)) {
            return res.status(400).json({ error: 'Descriptor facial requerido' });
        }

        const threshold = parseFloat(
            (await prisma.systemSettings.findUnique({ where: { key: 'face_match_threshold' } }))?.value ?? '0.6'
        );

        const employees = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null } },
            select: {
                id: true, name: true, area: true, role: true,
                photoUrl: true, isInPlant: true, cedula: true,
                faceDescriptor: true,
            },
        });

        let bestMatch = null;
        let bestDist = Infinity;

        for (const emp of employees) {
            const dist = bestFaceDistance(descriptor, emp.faceDescriptor);
            if (dist < bestDist) {
                bestDist = dist;
                bestMatch = emp;
            }
        }

        if (!bestMatch || bestDist > threshold) {
            return res.status(404).json({ error: 'Rostro no reconocido', distance: bestDist });
        }

        const { faceDescriptor: _, ...safe } = bestMatch;
        const { isInPlant, currentState } = await getPresenceStatus(bestMatch.id);
        res.json({ ...safe, isInPlant, currentState, distance: bestDist });
    } catch (err) {
        logger.error('matchFace error:', err);
        res.status(500).json({ error: 'Error en reconocimiento facial' });
    }
};

// ─── Kiosko: check-in / check-out ────────────────────────────────────────────

/**
 * POST /api/attendance/checkin
 * Registra la entrada de un empleado a la planta.
 * Público.
 */
exports.checkIn = async (req, res) => {
    try {
        const { employeeId, latitude, longitude, accuracy, photoPath, verified, source } = req.body;
        if (!employeeId) return res.status(400).json({ error: 'employeeId requerido' });

        const employee = await prisma.shiftEmployee.findUnique({
            where: { id: employeeId, active: true },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const { currentState } = await getPresenceStatus(employeeId);
        if (currentState === 'IN') {
            return res.status(409).json({ error: 'El empleado ya tiene una entrada activa' });
        }

        const [record] = await prisma.$transaction([
            prisma.attendanceRecord.create({
                data: {
                    employeeId,
                    type: 'ENTRY',
                    latitude: latitude ?? null,
                    longitude: longitude ?? null,
                    accuracy: accuracy ?? null,
                    photoPath: photoPath ?? null,
                    verified: verified ?? false,
                    source: source ?? 'KIOSK',
                },
            }),
            prisma.shiftEmployee.update({
                where: { id: employeeId },
                data: { isInPlant: true, lastEntryAt: new Date() },
            }),
        ]);

        res.json({ success: true, record });
        logger.info(`ENTRY: ${employee.name} (${employee.cedula})`);
    } catch (err) {
        logger.error('checkIn error:', err);
        res.status(500).json({ error: 'Error al registrar entrada' });
    }
};

/**
 * POST /api/attendance/checkout
 * Registra la salida (final o descanso) de un empleado.
 * Público.
 */
exports.checkOut = async (req, res) => {
    try {
        const { employeeId, subtype, latitude, longitude, accuracy, photoPath, verified, source, notes } = req.body;
        if (!employeeId) return res.status(400).json({ error: 'employeeId requerido' });
        if (!subtype) return res.status(400).json({ error: 'subtype requerido (BREAK, LUNCH, MEDICAL, PERSONAL, FINAL)' });

        const employee = await prisma.shiftEmployee.findUnique({
            where: { id: employeeId, active: true },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const { currentState } = await getPresenceStatus(employeeId);
        if (currentState === 'OUT') {
            return res.status(409).json({ error: 'El empleado no tiene una entrada activa' });
        }

        const isFinal = subtype === 'FINAL';
        let timestamp = new Date();
        let overtimeNotice = null;

        // Detección de tiempo extra al marcar FIN DE TURNO (solo turnos fijos)
        if (isFinal) {
            const ot = assessOvertime(employee, timestamp);
            if (ot.applies) {
                if (ot.status === 'requires_auth') {
                    return res.status(422).json({
                        error: `⚠️ Saliste ${ot.minutesOver} min después de tu hora oficial. Requiere autorización del ADMIN.`,
                        requiresOvertimeAuth: true,
                        employeeName: employee.name,
                        cedula: employee.cedula,
                        minutesOver: ot.minutesOver,
                        scheduledEnd: ot.scheduledEnd,
                    });
                }
                if (ot.status === 'warning') {
                    timestamp = new Date(ot.scheduledEnd);
                    overtimeNotice = {
                        minutesOver: ot.minutesOver,
                        message: `✓ Completaste tu horario. Veo que estás saliendo ${ot.minutesOver} min después de las ${ot.scheduledEnd.toISOString().slice(11,16)} UTC. Se registra el horario normal.`,
                    };
                }
            }
        }

        const [record] = await prisma.$transaction([
            prisma.attendanceRecord.create({
                data: {
                    employeeId,
                    type: 'EXIT',
                    subtype,
                    timestamp,
                    latitude: latitude ?? null,
                    longitude: longitude ?? null,
                    accuracy: accuracy ?? null,
                    photoPath: photoPath ?? null,
                    verified: verified ?? false,
                    source: source ?? 'KIOSK',
                    notes: overtimeNotice ? `${notes ?? ''} | Salida real ${new Date().toISOString().slice(11,16)} pero capeada a hora-fin (${overtimeNotice.minutesOver} min sin justificar)` : (notes ?? null),
                },
            }),
            prisma.shiftEmployee.update({
                where: { id: employeeId },
                data: { isInPlant: isFinal ? false : employee.isInPlant },
            }),
        ]);

        res.json({ success: true, record, overtimeNotice });
        logger.info(`EXIT(${subtype}): ${employee.name} (${employee.cedula})${overtimeNotice ? ` [overtime warn ${overtimeNotice.minutesOver}min]` : ''}`);
    } catch (err) {
        logger.error('checkOut error:', err);
        res.status(500).json({ error: 'Error al registrar salida' });
    }
};

/**
 * GET /api/attendance/status/:employeeId
 * Estado actual de presencia de un empleado.
 * Público.
 */
exports.getStatus = async (req, res) => {
    try {
        const { isInPlant, currentState, records } = await getPresenceStatus(req.params.employeeId);
        res.json({ isInPlant, currentState, todayRecords: records });
    } catch (err) {
        logger.error('getStatus error:', err);
        res.status(500).json({ error: 'Error al obtener estado' });
    }
};

// ─── Admin: dashboard y presencia ────────────────────────────────────────────

/**
 * GET /api/attendance/present
 * Lista de empleados actualmente en planta.
 * Requiere JWT.
 */
exports.getPresent = async (req, res) => {
    try {
        const employees = await prisma.shiftEmployee.findMany({
            where: { isInPlant: true, active: true },
            select: {
                id: true, name: true, area: true, role: true,
                photoUrl: true, cedula: true, lastEntryAt: true,
            },
            orderBy: { lastEntryAt: 'asc' },
        });
        res.json({ count: employees.length, employees });
    } catch (err) {
        logger.error('getPresent error:', err);
        res.status(500).json({ error: 'Error al obtener presentes' });
    }
};

/**
 * GET /api/attendance/dashboard
 * Resumen del día para el panel admin.
 * Requiere JWT.
 */
exports.getDashboard = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [present, todayEntries, todayExits, byArea] = await Promise.all([
            prisma.shiftEmployee.count({ where: { isInPlant: true, active: true } }),
            prisma.attendanceRecord.count({
                where: { type: 'ENTRY', timestamp: { gte: today, lt: tomorrow } },
            }),
            prisma.attendanceRecord.count({
                where: { type: 'EXIT', subtype: 'FINAL', timestamp: { gte: today, lt: tomorrow } },
            }),
            prisma.shiftEmployee.groupBy({
                by: ['area'],
                where: { isInPlant: true, active: true },
                _count: { id: true },
            }),
        ]);

        // Fetch the most recent records (last 7 days), then keep only the LATEST
        // per employee. This way the activity feed reflects the CURRENT state of
        // each person — including night-shift entries from the previous day —
        // and never shows "stale" exits after a return-from-break.
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentRaw = await prisma.attendanceRecord.findMany({
            where: { timestamp: { gte: sevenDaysAgo } },
            include: {
                employee: { select: { name: true, area: true, photoUrl: true } },
            },
            orderBy: { timestamp: 'desc' },
            take: 200,
        });
        const seenEmployees = new Set();
        const recentRecords = [];
        for (const r of recentRaw) {
            if (!seenEmployees.has(r.employeeId)) {
                seenEmployees.add(r.employeeId);
                recentRecords.push(r);
            }
            if (recentRecords.length >= 20) break;
        }

        res.json({
            present,
            todayEntries,
            todayExits,
            byArea: byArea.map(a => ({ area: a.area, count: a._count.id })),
            recentRecords,
        });
    } catch (err) {
        logger.error('getDashboard error:', err);
        res.status(500).json({ error: 'Error al obtener dashboard' });
    }
};

// ─── Admin: historial ─────────────────────────────────────────────────────────

/**
 * GET /api/attendance/history
 * Historial de registros con filtros y paginación.
 * Requiere JWT.
 */
exports.getHistory = async (req, res) => {
    try {
        const { employeeId, from, to, type, page = 1, limit = 50 } = req.query;
        const where = {};

        if (employeeId) where.employeeId = employeeId;
        if (type) where.type = type;
        if (from || to) {
            where.timestamp = {};
            if (from) where.timestamp.gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setHours(23, 59, 59, 999);
                where.timestamp.lte = toDate;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [total, records] = await Promise.all([
            prisma.attendanceRecord.count({ where }),
            prisma.attendanceRecord.findMany({
                where,
                include: {
                    employee: { select: { name: true, area: true, cedula: true, photoUrl: true } },
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: parseInt(limit),
            }),
        ]);

        res.json({ total, page: parseInt(page), pages: Math.ceil(total / limit), records });
    } catch (err) {
        logger.error('getHistory error:', err);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
};

// ─── Admin: reportes ──────────────────────────────────────────────────────────

/**
 * GET /api/attendance/hours/:employeeId?from=&to=
 * Horas trabajadas reales de un empleado en un rango.
 * Requiere JWT.
 */
exports.getHours = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const from = req.query.from ? new Date(req.query.from) : (() => {
            const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
        })();
        const to = req.query.to ? new Date(req.query.to) : new Date();

        const employee = await prisma.shiftEmployee.findUnique({
            where: { id: employeeId },
            select: { id: true, name: true, area: true, cedula: true },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const hours = await calcWorkedHours(employeeId, from, to);
        res.json({ employee, from, to, ...hours });
    } catch (err) {
        logger.error('getHours error:', err);
        res.status(500).json({ error: 'Error calculando horas' });
    }
};

/**
 * GET /api/attendance/punctuality?from=&to=
 * Reporte de tardanzas por empleado.
 * Requiere JWT.
 */
exports.getPunctuality = async (req, res) => {
    try {
        const from = req.query.from ? new Date(req.query.from) : (() => {
            const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
        })();
        const to = req.query.to ? new Date(req.query.to) : new Date();

        // Tolerance in minutes from SystemSettings
        const toleranceSetting = await prisma.systemSettings.findUnique({
            where: { key: 'late_tolerance_minutes' },
        });
        const toleranceMin = parseInt(toleranceSetting?.value ?? '5');

        // Get all ENTRY records in range
        const entries = await prisma.attendanceRecord.findMany({
            where: { type: 'ENTRY', timestamp: { gte: from, lte: to } },
            include: {
                employee: {
                    select: { id: true, name: true, area: true, cedula: true },
                    include: {
                        assignments: {
                            include: { week: true },
                            orderBy: { week: { weekStart: 'desc' } },
                            take: 1,
                        },
                    },
                },
            },
            orderBy: { timestamp: 'asc' },
        });

        // Get shift definitions for comparison
        const shiftDefs = await prisma.shiftScheduleDefinition.findMany({ where: { active: true } });
        const defMap = Object.fromEntries(shiftDefs.map(s => [s.code, s]));

        const lateMap = {};

        for (const entry of entries) {
            const shiftCode = entry.employee.assignments[0]?.shift?.toUpperCase();
            const def = defMap[shiftCode];
            if (!def) continue;

            const day = new Date(entry.timestamp).getDay(); // 0=Sun, 6=Sat
            let startStr = def.weekdayStart;
            if (day === 6 && def.saturdayStart) startStr = def.saturdayStart;
            if (day === 0 && def.sundayStart) startStr = def.sundayStart;

            const [sh, sm] = startStr.split(':').map(Number);
            const scheduled = new Date(entry.timestamp);
            scheduled.setHours(sh, sm + toleranceMin, 0, 0);

            const isLate = new Date(entry.timestamp) > scheduled;
            const lateMin = isLate
                ? Math.round((new Date(entry.timestamp) - scheduled) / 60000)
                : 0;

            const empId = entry.employee.id;
            if (!lateMap[empId]) {
                lateMap[empId] = {
                    employee: { id: empId, name: entry.employee.name, area: entry.employee.area, cedula: entry.employee.cedula },
                    totalDays: 0, lateDays: 0, totalLateMin: 0,
                };
            }
            lateMap[empId].totalDays++;
            if (isLate) { lateMap[empId].lateDays++; lateMap[empId].totalLateMin += lateMin; }
        }

        const report = Object.values(lateMap).map(r => ({
            ...r,
            lateRate: r.totalDays > 0 ? +((r.lateDays / r.totalDays) * 100).toFixed(1) : 0,
            avgLateMin: r.lateDays > 0 ? +(r.totalLateMin / r.lateDays).toFixed(1) : 0,
        }));

        res.json({ from, to, toleranceMin, report });
    } catch (err) {
        logger.error('getPunctuality error:', err);
        res.status(500).json({ error: 'Error generando reporte de puntualidad' });
    }
};

/**
 * GET /api/attendance/overtime?from=&to=
 * Reporte de horas extra por empleado.
 * Requiere JWT.
 */
exports.getOvertime = async (req, res) => {
    try {
        const from = req.query.from ? new Date(req.query.from) : (() => {
            const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
        })();
        const to = req.query.to ? new Date(req.query.to) : new Date();

        const shiftDefs = await prisma.shiftScheduleDefinition.findMany({ where: { active: true } });
        const defMap = Object.fromEntries(shiftDefs.map(s => [s.code, s]));

        const employees = await prisma.shiftEmployee.findMany({
            where: { active: true },
            include: {
                assignments: {
                    include: { week: true },
                    orderBy: { week: { weekStart: 'desc' } },
                    take: 1,
                },
            },
        });

        const results = await Promise.all(employees.map(async (emp) => {
            const shiftCode = emp.assignments[0]?.shift?.toUpperCase();
            const def = defMap[shiftCode];
            if (!def) return null;

            const [sh, sm] = def.weekdayStart.split(':').map(Number);
            const [eh, em] = def.weekdayEnd.split(':').map(Number);
            let scheduledHours = (eh * 60 + em - sh * 60 - sm) / 60;
            if (def.crossesMidnight) scheduledHours += 24;

            const worked = await calcWorkedHours(emp.id, from, to);

            // Count working days in range (excluding Sundays, simplified)
            let days = 0;
            const cur = new Date(from);
            while (cur <= to) {
                if (cur.getDay() !== 0) days++;
                cur.setDate(cur.getDate() + 1);
            }
            const expectedHours = scheduledHours * days;
            const overtime = Math.max(0, worked.netHours - expectedHours);

            return {
                employee: { id: emp.id, name: emp.name, area: emp.area, cedula: emp.cedula },
                shiftCode,
                expectedHours: +expectedHours.toFixed(2),
                workedHours: worked.netHours,
                overtimeHours: +overtime.toFixed(2),
            };
        }));

        res.json({ from, to, report: results.filter(Boolean) });
    } catch (err) {
        logger.error('getOvertime error:', err);
        res.status(500).json({ error: 'Error generando reporte de horas extra' });
    }
};

/**
 * GET /api/attendance/payroll-summary
 * Resumen laboral por quincena, mes o rango personalizado.
 * Reutiliza empleados, turnos semanales, asistencias y ausencias existentes.
 */
exports.getPayrollSummary = async (req, res) => {
    try {
        const {
            periodType = 'fortnight',
            anchorDate,
            from,
            to,
            employeeId,
            area,
        } = req.query;

        const summary = await getLaborSummary({
            periodType,
            anchorDate,
            from,
            to,
            employeeId,
            area,
        });

        res.json(summary);
    } catch (err) {
        logger.error('getPayrollSummary error:', err);
        res.status(500).json({ error: err.message || 'Error generando resumen laboral' });
    }
};

/**
 * GET /api/attendance/payroll-summary/export?format=xlsx
 * Exporta el resumen quincenal con las 8 bandas legales (CST + Ley 2466/2025).
 * Listo para Siigo Nómina / World Office.
 */
exports.exportPayrollSummary = async (req, res) => {
    try {
        const { periodType = 'fortnight', anchorDate, from, to, area, format = 'xlsx' } = req.query;
        const summary = await getLaborSummary({ periodType, anchorDate, from, to, area });

        // ── Datos de empresa (de SystemSettings) ──
        const companyRow = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } }).catch(() => null);
        const companyVal = (companyRow && typeof companyRow.value === 'object') ? companyRow.value : {};
        const company = {
            name: companyVal.companyName || 'POPPING BOBA INTERNATIONAL S.A.S.',
            nit:  companyVal.companyNit  || '901.878.434',
            address: companyVal.companyAddress || 'Colombia',
        };

        const anyPay = (summary.summary || []).some((r) => r.pay && r.pay.totalPay > 0);
        const generatedBy = req.user?.name || req.user?.email || 'Sistema';
        const generatedAt = new Date().toLocaleString('es-CO', {
            timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
        });
        const fmtDateLong = (iso) => {
            const d = new Date(`${iso}T12:00:00`);
            return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
        };

        // ── Definición de columnas con grupos (para colorear y bordes) ──
        // group: identificador del bloque (info | hours-ord | hours-ordnight | hours-sun | hours-sunnight | hours-ext | hours-extnight | hours-extsun | hours-extsunnight | totals | $info | $ord | $ordnight | $sun | $sunnight | $ext | $extnight | $extsun | $extsunnight | $bonus | $total)
        // header: encabezado
        // sub: subencabezado pequeño con porcentaje
        // width: ancho columna
        const COLOR = {
            corp:           'FF0E2954', // azul corporativo oscuro
            corpAccent:     'FF1E63B5',
            zebra:          'FFF7FAFC',
            border:         'FFB8C2CC',
            ord:            'FFE8F1FB', // azul muy claro (ord día)
            ordNight:       'FFD7E0F5', // índigo claro
            sun:            'FFFCE7E7', // rojo claro (dom/fest día)
            sunNight:       'FFF8C9C9', // rojo medio
            ext:            'FFFEF3C7', // amarillo claro (extra día)
            extNight:       'FFFDE68A', // amarillo más fuerte
            extSun:         'FFFCE7F3', // rosa (extra dom día)
            extSunNight:    'FFF9A8D4', // rosa fuerte
            totalH:         'FFE6E9F0', // gris azulado (total horas)
            money:          'FFE9F8EE', // verde pálido
            moneyTotal:     'FF15803D', // verde fuerte
            footerTotal:    'FFD1FAE5',
        };

        const columns = [
            { key: 'name',        header: 'EMPLEADO',           sub: '',         width: 30, group: 'info',   align: 'left'  },
            { key: 'cedula',      header: 'CÉDULA',             sub: '',         width: 14, group: 'info',   align: 'center' },
            { key: 'area',        header: 'ÁREA',               sub: '',         width: 16, group: 'info',   align: 'center' },
            { key: 'sched',       header: 'DÍAS PROG.',         sub: '',         width: 10, group: 'info',   align: 'center' },
            { key: 'present',     header: 'DÍAS PRES.',         sub: '',         width: 10, group: 'info',   align: 'center' },
            { key: 'absent',      header: 'AUSENCIAS',          sub: '',         width: 10, group: 'info',   align: 'center' },
            { key: 'ordDay',      header: 'H. ORD. DÍA',        sub: '0%',       width: 12, group: 'ord',     align: 'right', fmt: '0.00' },
            { key: 'ordNight',    header: 'H. ORD. NOCHE',      sub: '+35%',     width: 13, group: 'ordNight',align: 'right', fmt: '0.00' },
            { key: 'ordSunDay',   header: 'H. DOM/FEST DÍA',    sub: '+80%',     width: 14, group: 'sun',     align: 'right', fmt: '0.00' },
            { key: 'ordSunNight', header: 'H. DOM/FEST NOCHE',  sub: '+115%',    width: 14, group: 'sunNight',align: 'right', fmt: '0.00' },
            { key: 'extDay',      header: 'H. EXTRA DÍA',       sub: '+25%',     width: 12, group: 'ext',     align: 'right', fmt: '0.00' },
            { key: 'extNight',    header: 'H. EXTRA NOCHE',     sub: '+75%',     width: 13, group: 'extNight',align: 'right', fmt: '0.00' },
            { key: 'extSunDay',   header: 'H. EX. DOM DÍA',     sub: '+105%',    width: 13, group: 'extSun',  align: 'right', fmt: '0.00' },
            { key: 'extSunNight', header: 'H. EX. DOM NOCHE',   sub: '+155%',    width: 14, group: 'extSunNight', align: 'right', fmt: '0.00' },
            { key: 'totalH',      header: 'TOTAL HORAS',        sub: '',         width: 12, group: 'totalH',  align: 'right', fmt: '0.00' },
        ];
        if (anyPay) {
            columns.push(
                { key: 'salary',     header: 'SALARIO BASE',     sub: 'mensual',   width: 14, group: 'money',     align: 'right', fmt: '$#,##0' },
                { key: 'valueHour',  header: 'VALOR HORA',       sub: '',          width: 12, group: 'money',     align: 'right', fmt: '$#,##0' },
                { key: '$ordDay',    header: '$ ORD. DÍA',       sub: '',          width: 13, group: 'ord',        align: 'right', fmt: '$#,##0' },
                { key: '$ordNight',  header: '$ ORD. NOCHE',     sub: '',          width: 13, group: 'ordNight',   align: 'right', fmt: '$#,##0' },
                { key: '$sunDay',    header: '$ DOM/FEST DÍA',   sub: '',          width: 14, group: 'sun',        align: 'right', fmt: '$#,##0' },
                { key: '$sunNight',  header: '$ DOM/FEST NOCHE', sub: '',          width: 14, group: 'sunNight',   align: 'right', fmt: '$#,##0' },
                { key: '$extDay',    header: '$ EXTRA DÍA',      sub: '',          width: 13, group: 'ext',        align: 'right', fmt: '$#,##0' },
                { key: '$extNight',  header: '$ EXTRA NOCHE',    sub: '',          width: 13, group: 'extNight',   align: 'right', fmt: '$#,##0' },
                { key: '$extSunDay', header: '$ EX. DOM DÍA',    sub: '',          width: 14, group: 'extSun',     align: 'right', fmt: '$#,##0' },
                { key: '$extSunNight', header: '$ EX. DOM NOCHE', sub: '',         width: 14, group: 'extSunNight',align: 'right', fmt: '$#,##0' },
                { key: '$bonus',     header: '$ BONO',           sub: 'prorrateado', width: 12, group: 'money',     align: 'right', fmt: '$#,##0' },
                { key: '$total',     header: '$ TOTAL DEVENGADO', sub: 'quincena',   width: 18, group: 'moneyTotal', align: 'right', fmt: '$#,##0' },
            );
        }

        const groupColor = (g) => COLOR[g] || COLOR.zebra;

        // ── CSV (sin estilos) ──
        if (format === 'csv') {
            const csvHeaders = columns.map((c) => c.sub ? `${c.header} (${c.sub})` : c.header);
            const csvRows = (summary.summary || []).map((r) => {
                const p = r.pay || {};
                const totalH = +(r.ordDayHours + r.ordNightHours + r.ordSunDayHours + r.ordSunNightHours
                    + r.extDayHours + r.extNightHours + r.extSunDayHours + r.extSunNightHours).toFixed(2);
                const base = [
                    r.employee.name, r.employee.cedula || '', r.employee.area,
                    r.scheduledDays, r.presentDays, r.absenceDays,
                    r.ordDayHours, r.ordNightHours, r.ordSunDayHours, r.ordSunNightHours,
                    r.extDayHours, r.extNightHours, r.extSunDayHours, r.extSunNightHours,
                    totalH,
                ];
                if (!anyPay) return base;
                return [...base,
                    p.salaryMonthly || 0, p.valueHour || 0,
                    p.ordDayPay || 0, p.ordNightPay || 0, p.ordSunDayPay || 0, p.ordSunNightPay || 0,
                    p.extDayPay || 0, p.extNightPay || 0, p.extSunDayPay || 0, p.extSunNightPay || 0,
                    p.bonusPay || 0, p.totalPay || 0,
                ];
            });
            const csv = [csvHeaders, ...csvRows].map((row) => row.map(escapeCsv).join(',')).join('\n');
            const filename = `nomina_${summary.period.from}_${summary.period.to}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send('﻿' + csv);
        }

        // ── XLSX con exceljs ──
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.creator = company.name;
        wb.created = new Date();
        const ws = wb.addWorksheet('Nómina quincenal', {
            views: [{ state: 'frozen', xSplit: 1, ySplit: 9, showGridLines: false }],
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
        });

        const lastColLetter = (n) => {
            let s = '';
            while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
            return s;
        };
        const N = columns.length;
        const lastCol = lastColLetter(N);

        // Set columns widths
        ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

        // ── Encabezado corporativo ──
        // Fila 1: Nombre empresa
        ws.mergeCells(`A1:${lastCol}1`);
        const r1 = ws.getCell('A1');
        r1.value = company.name;
        r1.font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
        r1.alignment = { vertical: 'middle', horizontal: 'center' };
        r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.corp } };
        ws.getRow(1).height = 32;

        // Fila 2: NIT y dirección
        ws.mergeCells(`A2:${lastCol}2`);
        const r2 = ws.getCell('A2');
        r2.value = `NIT ${company.nit}    ·    ${company.address}`;
        r2.font = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' } };
        r2.alignment = { vertical: 'middle', horizontal: 'center' };
        r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.corpAccent } };
        ws.getRow(2).height = 20;

        // Fila 3: Título reporte
        ws.mergeCells(`A3:${lastCol}3`);
        const r3 = ws.getCell('A3');
        r3.value = 'REPORTE QUINCENAL DE NÓMINA';
        r3.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR.corp } };
        r3.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.getRow(3).height = 26;

        // Fila 4: Período
        ws.mergeCells(`A4:${lastCol}4`);
        const r4 = ws.getCell('A4');
        r4.value = `Período: del ${fmtDateLong(summary.period.from)} al ${fmtDateLong(summary.period.to)}`;
        r4.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF334155' } };
        r4.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.getRow(4).height = 18;

        // Fila 5: Festivos
        const holidaysText = (summary.holidays || []).length
            ? `Festivos en período: ${summary.holidays.map((h) => `${fmtDateLong(h.date)} – ${h.name}`).join('  ·  ')}`
            : 'Sin festivos en este período';
        ws.mergeCells(`A5:${lastCol}5`);
        const r5 = ws.getCell('A5');
        r5.value = holidaysText;
        r5.font = { name: 'Calibri', size: 10, color: { argb: 'FF991B1B' } };
        r5.alignment = { vertical: 'middle', horizontal: 'center' };
        r5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        ws.getRow(5).height = 18;

        // Fila 6: Generado por / fecha
        ws.mergeCells(`A6:${lastCol}6`);
        const r6 = ws.getCell('A6');
        r6.value = `Generado por: ${generatedBy}    ·    Fecha de generación: ${generatedAt}    ·    Empleados: ${(summary.summary || []).length}`;
        r6.font = { name: 'Calibri', size: 9, color: { argb: 'FF64748B' } };
        r6.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.getRow(6).height = 16;

        // Fila 7 vacía (separador)
        ws.getRow(7).height = 6;

        // Fila 8: Headers
        const headerRowNum = 8;
        const subRowNum = 9;
        columns.forEach((c, i) => {
            const cell = ws.getCell(headerRowNum, i + 1);
            cell.value = c.header;
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.corp } };
            cell.border = {
                top:    { style: 'thin', color: { argb: COLOR.corp } },
                left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
                right:  { style: 'thin', color: { argb: 'FFFFFFFF' } },
                bottom: { style: 'thin', color: { argb: COLOR.corp } },
            };
        });
        ws.getRow(headerRowNum).height = 28;

        // Fila 9: Sub-header (porcentajes)
        columns.forEach((c, i) => {
            const cell = ws.getCell(subRowNum, i + 1);
            cell.value = c.sub || '';
            cell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF1E40AF' }, bold: true };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupColor(c.group) } };
            cell.border = {
                top:    { style: 'thin', color: { argb: COLOR.border } },
                bottom: { style: 'medium', color: { argb: COLOR.corp } },
                left:   { style: 'thin', color: { argb: COLOR.border } },
                right:  { style: 'thin', color: { argb: COLOR.border } },
            };
        });
        ws.getRow(subRowNum).height = 18;

        // ── Filas de datos ──
        const dataStartRow = subRowNum + 1;
        (summary.summary || []).forEach((r, idx) => {
            const p = r.pay || {};
            const totalH = +(
                r.ordDayHours + r.ordNightHours + r.ordSunDayHours + r.ordSunNightHours +
                r.extDayHours + r.extNightHours + r.extSunDayHours + r.extSunNightHours
            ).toFixed(2);
            const valueByKey = {
                name: r.employee.name,
                cedula: r.employee.cedula || '',
                area: r.employee.area,
                sched: r.scheduledDays,
                present: r.presentDays,
                absent: r.absenceDays,
                ordDay: r.ordDayHours,
                ordNight: r.ordNightHours,
                ordSunDay: r.ordSunDayHours,
                ordSunNight: r.ordSunNightHours,
                extDay: r.extDayHours,
                extNight: r.extNightHours,
                extSunDay: r.extSunDayHours,
                extSunNight: r.extSunNightHours,
                totalH,
                salary: p.salaryMonthly || null,
                valueHour: p.valueHour || null,
                $ordDay: p.ordDayPay || null,
                $ordNight: p.ordNightPay || null,
                $sunDay: p.ordSunDayPay || null,
                $sunNight: p.ordSunNightPay || null,
                $extDay: p.extDayPay || null,
                $extNight: p.extNightPay || null,
                $extSunDay: p.extSunDayPay || null,
                $extSunNight: p.extSunNightPay || null,
                $bonus: p.bonusPay || null,
                $total: p.totalPay || null,
            };
            const rowNum = dataStartRow + idx;
            const isZebra = idx % 2 === 1;
            columns.forEach((c, i) => {
                const cell = ws.getCell(rowNum, i + 1);
                const v = valueByKey[c.key];
                cell.value = (v === null || v === undefined || v === '') ? null : v;
                cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', indent: c.align === 'left' ? 1 : 0 };
                cell.font = {
                    name: 'Calibri', size: 10,
                    bold: c.key === 'name' || c.group === 'moneyTotal' || c.key === 'totalH',
                    color: { argb: c.group === 'moneyTotal' ? COLOR.moneyTotal : 'FF1F2937' },
                };
                if (c.fmt) cell.numFmt = c.fmt;
                // Fondo: zebra excepto en grupos coloreados de banda
                const groupBg = ['ord','ordNight','sun','sunNight','ext','extNight','extSun','extSunNight','totalH','moneyTotal'].includes(c.group)
                    ? groupColor(c.group)
                    : (isZebra ? COLOR.zebra : 'FFFFFFFF');
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupBg } };
                cell.border = {
                    top:    { style: 'hair', color: { argb: COLOR.border } },
                    bottom: { style: 'hair', color: { argb: COLOR.border } },
                    left:   { style: 'hair', color: { argb: COLOR.border } },
                    right:  { style: 'hair', color: { argb: COLOR.border } },
                };
                // Resaltar celdas con valor 0 como vacío
                if (typeof v === 'number' && v === 0 && c.fmt) {
                    cell.value = null;
                }
            });
            ws.getRow(rowNum).height = 22;
        });

        // ── Fila de TOTALES ──
        const totalRowNum = dataStartRow + (summary.summary || []).length;
        const totals = {};
        const sumKey = (k) => (summary.summary || []).reduce((s, r) => s + (r[k] || 0), 0);
        const sumPay = (k) => (summary.summary || []).reduce((s, r) => s + (r.pay?.[k] || 0), 0);
        totals.ordDay      = sumKey('ordDayHours');
        totals.ordNight    = sumKey('ordNightHours');
        totals.ordSunDay   = sumKey('ordSunDayHours');
        totals.ordSunNight = sumKey('ordSunNightHours');
        totals.extDay      = sumKey('extDayHours');
        totals.extNight    = sumKey('extNightHours');
        totals.extSunDay   = sumKey('extSunDayHours');
        totals.extSunNight = sumKey('extSunNightHours');
        totals.totalH = totals.ordDay + totals.ordNight + totals.ordSunDay + totals.ordSunNight
            + totals.extDay + totals.extNight + totals.extSunDay + totals.extSunNight;
        totals.$ordDay     = sumPay('ordDayPay');
        totals.$ordNight   = sumPay('ordNightPay');
        totals.$sunDay     = sumPay('ordSunDayPay');
        totals.$sunNight   = sumPay('ordSunNightPay');
        totals.$extDay     = sumPay('extDayPay');
        totals.$extNight   = sumPay('extNightPay');
        totals.$extSunDay  = sumPay('extSunDayPay');
        totals.$extSunNight= sumPay('extSunNightPay');
        totals.$bonus      = sumPay('bonusPay');
        totals.$total      = sumPay('totalPay');

        columns.forEach((c, i) => {
            const cell = ws.getCell(totalRowNum, i + 1);
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: c.group === 'moneyTotal' ? 'FFFFFFFF' : COLOR.corp } };
            cell.alignment = { vertical: 'middle', horizontal: c.align || 'left' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.group === 'moneyTotal' ? COLOR.moneyTotal : COLOR.footerTotal } };
            cell.border = {
                top:    { style: 'medium', color: { argb: COLOR.corp } },
                bottom: { style: 'medium', color: { argb: COLOR.corp } },
                left:   { style: 'thin', color: { argb: COLOR.border } },
                right:  { style: 'thin', color: { argb: COLOR.border } },
            };
            if (i === 0) cell.value = 'TOTALES';
            else if (i < 6) cell.value = '';
            else if (totals[c.key] !== undefined) {
                cell.value = totals[c.key] || null;
                if (c.fmt) cell.numFmt = c.fmt;
            }
        });
        ws.getRow(totalRowNum).height = 26;

        // ── Pie de página ──
        const footerRowNum = totalRowNum + 2;
        ws.mergeCells(`A${footerRowNum}:${lastCol}${footerRowNum}`);
        const fc = ws.getCell(`A${footerRowNum}`);
        fc.value = `Documento generado automáticamente por gestionpbi.lat   ·   ${company.name}   ·   NIT ${company.nit}`;
        fc.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        fc.alignment = { vertical: 'middle', horizontal: 'center' };

        // Print options: filas y columnas a repetir
        ws.pageSetup.printTitlesRow = `${headerRowNum}:${subRowNum}`;

        const buffer = await wb.xlsx.writeBuffer();
        const filename = `nomina_${summary.period.from}_${summary.period.to}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buffer));
    } catch (err) {
        logger.error('exportPayrollSummary error:', err);
        res.status(500).json({ error: err.message || 'Error exportando resumen laboral' });
    }
};

exports.getPayrollConfig = async (req, res) => {
    try {
        const row = await prisma.systemSettings.findUnique({
            where: { key: PAYROLL_CONFIG_KEY },
        });
        const value = (row && typeof row.value === 'object' && row.value) ? row.value : {};
        res.json({
            ...DEFAULT_PAYROLL_CONFIG,
            ...value,
        });
    } catch (err) {
        logger.error('getPayrollConfig error:', err);
        res.status(500).json({ error: 'Error obteniendo configuracion laboral' });
    }
};

exports.updatePayrollConfig = async (req, res) => {
    try {
        const payload = req.body || {};
        const numericKeys = [
            'weeklyHours', 'monthlyHourDivisor',
            'surchargeNight', 'surchargeSundayDay', 'surchargeSundayNight',
            'overtimeDay', 'overtimeNight', 'overtimeSundayDay', 'overtimeSundayNight',
        ];
        const config = {
            dayStart: typeof payload.dayStart === 'string' ? payload.dayStart : DEFAULT_PAYROLL_CONFIG.dayStart,
            nightStart: typeof payload.nightStart === 'string' ? payload.nightStart : DEFAULT_PAYROLL_CONFIG.nightStart,
            fortnightCutoffDay: parseInt(payload.fortnightCutoffDay, 10) || DEFAULT_PAYROLL_CONFIG.fortnightCutoffDay,
        };
        for (const key of numericKeys) {
            const raw = payload[key];
            const num = typeof raw === 'number' ? raw : parseFloat(raw);
            config[key] = Number.isFinite(num) ? num : DEFAULT_PAYROLL_CONFIG[key];
        }

        if (!config.dayStart.includes(':') || !config.nightStart.includes(':')) {
            return res.status(400).json({ error: 'Las franjas diurna y nocturna deben tener formato HH:MM' });
        }
        if (config.fortnightCutoffDay < 1 || config.fortnightCutoffDay > 28) {
            return res.status(400).json({ error: 'El corte quincenal debe estar entre 1 y 28' });
        }
        for (const key of numericKeys) {
            if (config[key] < 0 || config[key] > 5) {
                return res.status(400).json({ error: `El valor de ${key} debe estar entre 0 y 5` });
            }
        }

        const updated = await prisma.systemSettings.upsert({
            where: { key: PAYROLL_CONFIG_KEY },
            update: { value: config, description: 'Configuracion de liquidacion laboral y horas extra' },
            create: {
                key: PAYROLL_CONFIG_KEY,
                value: config,
                description: 'Configuracion de liquidacion laboral y horas extra',
            },
        });

        res.json(updated.value);
    } catch (err) {
        logger.error('updatePayrollConfig error:', err);
        res.status(500).json({ error: 'Error guardando configuracion laboral' });
    }
};

// ── Festivos (PayrollHoliday) ──────────────────────────────────────────────────

exports.listHolidays = async (req, res) => {
    try {
        const year = parseInt(req.query.year, 10);
        const where = Number.isInteger(year) ? { year } : {};
        const holidays = await prisma.payrollHoliday.findMany({
            where,
            orderBy: { date: 'asc' },
        });
        res.json(holidays);
    } catch (err) {
        logger.error('listHolidays error:', err);
        res.status(500).json({ error: 'Error obteniendo festivos' });
    }
};

exports.createHoliday = async (req, res) => {
    try {
        const { date, name } = req.body || {};
        if (!date || !name) return res.status(400).json({ error: 'date y name son obligatorios' });
        const parsed = new Date(`${date}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'date inválido' });
        const holiday = await prisma.payrollHoliday.create({
            data: { date: parsed, name: String(name).trim(), year: parsed.getFullYear() },
        });
        res.status(201).json(holiday);
    } catch (err) {
        if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un festivo en esa fecha' });
        logger.error('createHoliday error:', err);
        res.status(500).json({ error: 'Error creando festivo' });
    }
};

exports.deleteHoliday = async (req, res) => {
    try {
        await prisma.payrollHoliday.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ error: 'Festivo no encontrado' });
        logger.error('deleteHoliday error:', err);
        res.status(500).json({ error: 'Error eliminando festivo' });
    }
};

// ── Perfiles de nómina (EmployeePayrollProfile) ────────────────────────────────

exports.listPayrollProfiles = async (req, res) => {
    try {
        const profiles = await prisma.employeePayrollProfile.findMany({
            include: {
                employee: { select: { id: true, name: true, area: true, role: true, cedula: true, active: true } },
            },
            orderBy: [{ employee: { area: 'asc' } }, { employee: { name: 'asc' } }],
        });
        res.json(profiles.map((p) => ({
            ...p,
            salaryMonthly: Number(p.salaryMonthly),
            monthlyBonus: Number(p.monthlyBonus),
        })));
    } catch (err) {
        logger.error('listPayrollProfiles error:', err);
        res.status(500).json({ error: 'Error obteniendo perfiles de nómina' });
    }
};

exports.upsertPayrollProfile = async (req, res) => {
    try {
        const {
            employeeId, salaryMonthly, startDate,
            transportAllowance, monthlyBonus, contractType, active, notes,
        } = req.body || {};

        if (!employeeId) return res.status(400).json({ error: 'employeeId es obligatorio' });
        const salary = parseFloat(salaryMonthly);
        if (!Number.isFinite(salary) || salary < 0) return res.status(400).json({ error: 'salaryMonthly inválido' });
        const start = startDate ? new Date(`${startDate}T12:00:00`) : null;
        if (!start || Number.isNaN(start.getTime())) return res.status(400).json({ error: 'startDate inválido' });

        const data = {
            employeeId,
            salaryMonthly: salary,
            startDate: start,
            transportAllowance: transportAllowance !== false,
            monthlyBonus: parseFloat(monthlyBonus) || 0,
            contractType: contractType || 'INDEFINIDO',
            active: active !== false,
            notes: notes || null,
        };

        const profile = await prisma.employeePayrollProfile.upsert({
            where: { employeeId },
            create: data,
            update: data,
        });
        res.json({
            ...profile,
            salaryMonthly: Number(profile.salaryMonthly),
            monthlyBonus: Number(profile.monthlyBonus),
        });
    } catch (err) {
        logger.error('upsertPayrollProfile error:', err);
        res.status(500).json({ error: err.message || 'Error guardando perfil' });
    }
};

exports.deletePayrollProfile = async (req, res) => {
    try {
        await prisma.employeePayrollProfile.delete({ where: { employeeId: req.params.employeeId } });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ error: 'Perfil no encontrado' });
        logger.error('deletePayrollProfile error:', err);
        res.status(500).json({ error: 'Error eliminando perfil' });
    }
};

exports.getLaborNovelties = async (req, res) => {
    try {
        const { employeeId, from, to, reason } = req.query;
        const where = {};

        if (employeeId) where.employeeId = employeeId;
        if (reason) where.reason = reason;
        if (from || to) {
            where.AND = [];
            if (from) where.AND.push({ endDate: { gte: new Date(`${from}T00:00:00`) } });
            if (to) where.AND.push({ startDate: { lte: new Date(`${to}T23:59:59.999`) } });
        }

        const novelties = await prisma.shiftAbsence.findMany({
            where,
            include: {
                employee: {
                    select: { id: true, name: true, area: true, cedula: true },
                },
            },
            orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
            take: 200,
        });

        res.json({
            types: LABOR_NOVELTY_TYPES,
            novelties,
        });
    } catch (err) {
        logger.error('getLaborNovelties error:', err);
        res.status(500).json({ error: 'Error obteniendo novedades laborales' });
    }
};

exports.createLaborNovelty = async (req, res) => {
    try {
        const {
            employeeId,
            type,
            startDate,
            endDate,
            notes,
            replacedBy,
        } = req.body || {};

        if (!employeeId) return res.status(400).json({ error: 'employeeId es requerido' });
        if (!type || !LABOR_NOVELTY_TYPES.includes(type)) {
            return res.status(400).json({ error: 'Tipo de novedad invalido' });
        }
        if (!startDate) return res.status(400).json({ error: 'startDate es requerido' });

        const employee = await prisma.shiftEmployee.findUnique({ where: { id: employeeId } });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const novelty = await prisma.shiftAbsence.create({
            data: {
                employeeId,
                reason: type,
                startDate: new Date(`${startDate}T12:00:00`),
                endDate: new Date(`${(endDate || startDate)}T12:00:00`),
                notes: notes?.trim() || null,
                replacedBy: replacedBy?.trim() || null,
            },
            include: {
                employee: {
                    select: { id: true, name: true, area: true, cedula: true },
                },
            },
        });

        res.status(201).json(novelty);
    } catch (err) {
        logger.error('createLaborNovelty error:', err);
        res.status(500).json({ error: 'Error creando novedad laboral' });
    }
};

exports.deleteLaborNovelty = async (req, res) => {
    try {
        await prisma.shiftAbsence.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        logger.error('deleteLaborNovelty error:', err);
        res.status(500).json({ error: 'Error eliminando novedad laboral' });
    }
};

exports.getPayrollClosures = async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const rows = await prisma.systemSettings.findMany({
            where: {
                key: { startsWith: PAYROLL_CLOSURE_PREFIX },
            },
            orderBy: { updatedAt: 'desc' },
            take: Math.min(parseInt(limit, 10) || 20, 100),
        });

        const closures = rows.map((row) => {
            const value = (row && typeof row.value === 'object' && row.value) ? row.value : {};
            return {
                id: row.id,
                key: row.key,
                updatedAt: row.updatedAt,
                closedAt: value.closedAt || row.updatedAt,
                closedBy: value.closedBy || null,
                status: value.status || 'CLOSED',
                reopenedAt: value.reopenedAt || null,
                reopenedBy: value.reopenedBy || null,
                period: value.period || null,
                notes: value.notes || '',
                employees: Array.isArray(value.summary) ? value.summary.length : 0,
            };
        });

        res.json(closures);
    } catch (err) {
        logger.error('getPayrollClosures error:', err);
        res.status(500).json({ error: 'Error obteniendo cierres laborales' });
    }
};

exports.getPayrollClosureDetail = async (req, res) => {
    try {
        const row = await prisma.systemSettings.findUnique({
            where: { id: req.params.id },
        });
        if (!row || !row.key.startsWith(PAYROLL_CLOSURE_PREFIX)) {
            return res.status(404).json({ error: 'Cierre laboral no encontrado' });
        }
        res.json(row.value);
    } catch (err) {
        logger.error('getPayrollClosureDetail error:', err);
        res.status(500).json({ error: 'Error obteniendo detalle del cierre' });
    }
};

exports.closePayrollPeriod = async (req, res) => {
    try {
        const {
            periodType = 'fortnight',
            anchorDate,
            from,
            to,
            area,
            notes,
            overwrite = false,
        } = req.body || {};

        const existing = await prisma.systemSettings.findUnique({
            where: {
                key: buildPayrollClosureKey(
                    (await getLaborSummary({ periodType, anchorDate, from, to, area })).period
                ),
            },
        });
        const existingValue = (existing && typeof existing.value === 'object' && existing.value) ? existing.value : null;
        if (existing && existingValue?.status === 'CLOSED' && !overwrite) {
            return res.status(409).json({
                error: 'Este periodo ya fue cerrado. Usa overwrite si deseas reemplazar el snapshot.',
                existingId: existing.id,
            });
        }

        const snapshot = await getLaborSummary({
            periodType,
            anchorDate,
            from,
            to,
            area,
        });
        const closureKey = buildPayrollClosureKey(snapshot.period);
        const actor = buildClosureActor(req.user);
        const nowIso = new Date().toISOString();
        const nextStatus = existingValue?.status === 'REOPENED' ? 'RECLOSED' : 'CLOSED';

        const payload = {
            ...snapshot,
            notes: notes?.trim() || '',
            closedAt: nowIso,
            closedBy: actor,
            status: nextStatus,
            reopenedAt: existingValue?.reopenedAt || null,
            reopenedBy: existingValue?.reopenedBy || null,
            reopenReason: existingValue?.reopenReason || '',
            history: appendClosureEvent(existingValue?.history, {
                type: nextStatus === 'RECLOSED' ? 'RECLOSED' : 'CLOSED',
                at: nowIso,
                by: actor,
                notes: notes?.trim() || '',
            }),
        };

        const saved = await prisma.systemSettings.upsert({
            where: { key: closureKey },
            update: {
                value: payload,
                description: `Cierre laboral ${snapshot.period.label}`,
            },
            create: {
                key: closureKey,
                value: payload,
                description: `Cierre laboral ${snapshot.period.label}`,
            },
        });

        res.status(existing ? 200 : 201).json({
            id: saved.id,
            key: saved.key,
            ...payload,
        });
    } catch (err) {
        logger.error('closePayrollPeriod error:', err);
        res.status(500).json({ error: err.message || 'Error cerrando periodo laboral' });
    }
};

exports.exportPayrollClosure = async (req, res) => {
    try {
        const row = await prisma.systemSettings.findUnique({
            where: { id: req.params.id },
        });
        if (!row || !row.key.startsWith(PAYROLL_CLOSURE_PREFIX)) {
            return res.status(404).json({ error: 'Cierre laboral no encontrado' });
        }

        const snapshot = (row && typeof row.value === 'object' && row.value) ? row.value : {};
        const csv = buildPayrollClosureCsv(snapshot);
        const period = snapshot.period || {};
        const safeFrom = period.from || 'sin-fecha';
        const safeTo = period.to || 'sin-fecha';
        const filename = `nomina_${period.type || 'periodo'}_${safeFrom}_${safeTo}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(`\uFEFF${csv}`);
    } catch (err) {
        logger.error('exportPayrollClosure error:', err);
        res.status(500).json({ error: 'Error exportando cierre laboral' });
    }
};

exports.reopenPayrollClosure = async (req, res) => {
    try {
        const { reason, notes } = req.body || {};
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: 'Debes indicar el motivo de la reapertura.' });
        }

        const row = await prisma.systemSettings.findUnique({
            where: { id: req.params.id },
        });
        if (!row || !row.key.startsWith(PAYROLL_CLOSURE_PREFIX)) {
            return res.status(404).json({ error: 'Cierre laboral no encontrado' });
        }

        const value = (row && typeof row.value === 'object' && row.value) ? row.value : {};
        if (value.status === 'REOPENED') {
            return res.status(409).json({ error: 'Este cierre ya se encuentra reabierto.' });
        }

        const actor = buildClosureActor(req.user);
        const nowIso = new Date().toISOString();
        const updatedValue = {
            ...value,
            status: 'REOPENED',
            reopenedAt: nowIso,
            reopenedBy: actor,
            reopenReason: String(reason).trim(),
            history: appendClosureEvent(value.history, {
                type: 'REOPENED',
                at: nowIso,
                by: actor,
                reason: String(reason).trim(),
                notes: notes?.trim() || '',
            }),
        };

        const updated = await prisma.systemSettings.update({
            where: { id: req.params.id },
            data: { value: updatedValue },
        });

        res.json(updated.value);
    } catch (err) {
        logger.error('reopenPayrollClosure error:', err);
        res.status(500).json({ error: 'Error reabriendo cierre laboral' });
    }
};

// ─── Admin: gestión de empleados del kiosko ───────────────────────────────────

/**
 * GET /api/attendance/employees
 * Lista todos los ShiftEmployees con su estado de presencia.
 * Requiere JWT.
 */
exports.getEmployees = async (req, res) => {
    try {
        const { search, area } = req.query;
        const where = { active: true };
        if (area) where.area = area;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { cedula: { contains: search } },
            ];
        }

        const employees = await prisma.shiftEmployee.findMany({
            where,
            select: {
                id: true, name: true, area: true, role: true, cedula: true,
                photoUrl: true, isInPlant: true, lastEntryAt: true,
                faceDescriptor: false, // no exponer el vector
                pin: false,
                userId: true,
                user: { select: { id: true, email: true, role: true } },
            },
            orderBy: { name: 'asc' },
        });

        // Verificar cuales tienen face descriptor sin exponer el vector
        const withFace = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null } },
            select: { id: true },
        });
        const faceSet = new Set(withFace.map(e => e.id));

        // IDs de usuarios ya vinculados a shift_employees
        const linkedUserIds = new Set(employees.filter(e => e.userId).map(e => e.userId));

        // Usuarios registrados en gestionpbi con roles elegibles de kiosko pero SIN shift_employee.
        // Incluye ADMIN (equipo administración) para que pueda migrarse al cuadro de turnos.
        const pendingUsers = await prisma.user.findMany({
            where: {
                active: true,
                role: { in: KIOSK_ELIGIBLE_ROLES },
                id: { notIn: [...linkedUserIds] },
                ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
            },
            select: { id: true, name: true, email: true, role: true },
            orderBy: { name: 'asc' },
        });

        const enrolled = employees.map(e => ({ ...e, hasFace: faceSet.has(e.id), pending: false }));
        const pending = pendingUsers.map(u => ({
            id: null,
            userId: u.id,
            name: u.name,
            area: null,
            role: u.role,
            cedula: null,
            photoUrl: null,
            isInPlant: false,
            lastEntryAt: null,
            hasFace: false,
            pending: true,
            user: { id: u.id, email: u.email, role: u.role },
        }));

        res.json([...enrolled, ...pending]);
    } catch (err) {
        logger.error('getEmployees error:', err);
        res.status(500).json({ error: 'Error al listar empleados' });
    }
};

/**
 * POST /api/attendance/employees/from-user/:userId
 * Crea un ShiftEmployee vinculado a un usuario existente de gestionpbi
 * que aún no tiene registro en el kiosko (estado "pendiente").
 * Requiere JWT + roles admin/RRHH.
 */
exports.createFromUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { area, cedula } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const existing = await prisma.shiftEmployee.findFirst({ where: { userId } });
        if (existing) return res.status(409).json({ error: 'Este usuario ya tiene un registro en el kiosko' });

        if (!area) return res.status(400).json({ error: 'El área es requerida' });

        // Usa el helper de sync para crear shiftEmployee + asignar la semana actual al turno correcto.
        // Esto garantiza que el empleado quede listo en el cuadro de turnos sin paso adicional.
        const { createShiftEmployeeFromUser } = require('../services/shiftEmployeeSyncService');
        const result = await createShiftEmployeeFromUser(prisma, user, {
            area,
            assignCurrentWeek: true,
        });
        const employee = result.employee;

        // Si vino cédula, actualizarla en el shiftEmployee recién creado
        if (cedula?.trim()) {
            await prisma.shiftEmployee.update({
                where: { id: employee.id },
                data: { cedula: cedula.trim() },
            }).catch(err => {
                if (err.code === 'P2002') {
                    logger.warn(`Cédula duplicada al crear empleado ${user.name}: ${cedula}`);
                }
            });
        }

        res.status(201).json({ success: true, employee });
        logger.info(`ShiftEmployee created from user ${user.name} (${user.role}) → área ${employee.area}`);
    } catch (err) {
        logger.error('createFromUser error:', err);
        res.status(500).json({ error: err.message || 'Error al crear registro de kiosko' });
    }
};

/**
 * PUT /api/attendance/employees/:id/face
 * Enrolla o actualiza el descriptor facial de un empleado.
 * También guarda la foto de referencia.
 * Requiere JWT + roles admin/RRHH.
 */
exports.enrollFace = async (req, res) => {
    try {
        const { descriptor, descriptors, photoUrl, mode = 'replace' } = req.body;

        // Aceptar uno o varios descriptores
        let newDescriptors = [];
        if (Array.isArray(descriptors) && descriptors.length > 0) {
            for (const d of descriptors) {
                if (!Array.isArray(d) || d.length !== 128) {
                    return res.status(400).json({ error: 'Cada descriptor debe ser array de 128 floats' });
                }
                newDescriptors.push(d);
            }
        } else if (Array.isArray(descriptor) && descriptor.length === 128) {
            newDescriptors = [descriptor];
        } else {
            return res.status(400).json({ error: 'Debes enviar `descriptor` (array 128) o `descriptors` (array de arrays 128)' });
        }

        // Verificar duplicado contra otros empleados (usa el primer descriptor)
        const others = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null }, id: { not: req.params.id } },
            select: { id: true, name: true, faceDescriptor: true },
        });
        for (const other of others) {
            const dist = bestFaceDistance(newDescriptors[0], other.faceDescriptor);
            if (dist < 0.5) {
                return res.status(409).json({
                    error: `Rostro muy similar al de ${other.name} (distancia: ${dist.toFixed(3)}). Verifica que sea la persona correcta.`,
                    conflictEmployeeId: other.id,
                });
            }
        }

        // Construir el array final según mode
        let finalDescriptors = newDescriptors;
        if (mode === 'append') {
            const current = await prisma.shiftEmployee.findUnique({
                where: { id: req.params.id },
                select: { faceDescriptor: true }
            });
            const existing = getDescriptorList(current?.faceDescriptor);
            finalDescriptors = [...existing, ...newDescriptors].slice(-10); // máximo 10 por empleado
        }

        const updated = await prisma.shiftEmployee.update({
            where: { id: req.params.id },
            data: {
                faceDescriptor: finalDescriptors,
                ...(photoUrl ? { photoUrl } : {}),
            },
            select: { id: true, name: true, photoUrl: true },
        });

        res.json({ success: true, employee: updated, descriptorsCount: finalDescriptors.length });
        logger.info(`Face enrolled: ${updated.name} (mode=${mode}, descriptors=${finalDescriptors.length})`);
    } catch (err) {
        logger.error('enrollFace error:', err);
        res.status(500).json({ error: 'Error al enrollar descriptor facial' });
    }
};

/**
 * PUT /api/attendance/employees/:id/pin
 * Asigna o actualiza el PIN de acceso al kiosko.
 * Requiere JWT + roles admin/RRHH.
 */
exports.setPin = async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN debe tener al menos 4 dígitos' });

        await prisma.shiftEmployee.update({
            where: { id: req.params.id },
            data: { pin },
        });

        res.json({ success: true });
    } catch (err) {
        logger.error('setPin error:', err);
        res.status(500).json({ error: 'Error al actualizar PIN' });
    }
};

/**
 * PUT /api/attendance/employees/:id/cedula
 * Asigna la cédula física al empleado.
 * Requiere JWT + roles admin/RRHH.
 */
exports.setCedula = async (req, res) => {
    try {
        const { cedula } = req.body;
        if (!cedula) return res.status(400).json({ error: 'Cédula requerida' });

        const existing = await prisma.shiftEmployee.findUnique({ where: { cedula } });
        if (existing && existing.id !== req.params.id) {
            return res.status(409).json({ error: 'Esa cédula ya está asignada a otro empleado' });
        }

        await prisma.shiftEmployee.update({ where: { id: req.params.id }, data: { cedula } });
        res.json({ success: true });
    } catch (err) {
        logger.error('setCedula error:', err);
        res.status(500).json({ error: 'Error al actualizar cédula' });
    }
};

/**
 * POST /api/attendance/employees/:id/manual-record
 * Registro manual de entrada/salida (solo admin/RRHH).
 * Requiere JWT.
 */
exports.manualRecord = async (req, res) => {
    try {
        const { type, subtype, timestamp, notes } = req.body;
        if (!type) return res.status(400).json({ error: 'type requerido' });

        const ts = timestamp ? new Date(timestamp) : new Date();
        const isFinal = type === 'EXIT' && subtype === 'FINAL';

        const record = await prisma.attendanceRecord.create({
            data: {
                employeeId: req.params.id,
                type,
                subtype: subtype ?? null,
                timestamp: ts,
                verified: false,
                source: 'MANUAL',
                notes: notes ?? `Registro manual por ${req.user.name}`,
            },
        });

        if (type === 'ENTRY') {
            await prisma.shiftEmployee.update({
                where: { id: req.params.id },
                data: { isInPlant: true, lastEntryAt: ts },
            });
        } else if (isFinal) {
            await prisma.shiftEmployee.update({
                where: { id: req.params.id },
                data: { isInPlant: false },
            });
        }

        res.json({ success: true, record });
    } catch (err) {
        logger.error('manualRecord error:', err);
        res.status(500).json({ error: 'Error al crear registro manual' });
    }
};

// ─── Definiciones de turno ────────────────────────────────────────────────────

/**
 * GET /api/attendance/shift-definitions
 * Lista los turnos con sus horarios.
 * Requiere JWT.
 */
exports.getShiftDefinitions = async (req, res) => {
    try {
        const defs = await prisma.shiftScheduleDefinition.findMany({
            where: { active: true },
            orderBy: { name: 'asc' },
        });
        res.json(defs);
    } catch (err) {
        logger.error('getShiftDefinitions error:', err);
        res.status(500).json({ error: 'Error al obtener definiciones de turno' });
    }
};

/**
 * PUT /api/attendance/shift-definitions/:id
 * Actualiza las horas de un turno.
 * Requiere JWT + ADMIN.
 */
exports.updateShiftDefinition = async (req, res) => {
    try {
        const { weekdayStart, weekdayEnd, saturdayStart, saturdayEnd, sundayStart, sundayEnd, crossesMidnight } = req.body;
        const def = await prisma.shiftScheduleDefinition.update({
            where: { id: req.params.id },
            data: { weekdayStart, weekdayEnd, saturdayStart, saturdayEnd, sundayStart, sundayEnd, crossesMidnight },
        });
        res.json(def);
    } catch (err) {
        logger.error('updateShiftDefinition error:', err);
        res.status(500).json({ error: 'Error al actualizar turno' });
    }
};

// ─── Vigilancia de puerta (YOLOv8 door monitor) ──────────────────────────────

const { Pool } = require('pg');
const _pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * GET /api/attendance/door-crossings
 * Retorna resumen de cruces de puerta agrupados por hora para el dashboard.
 * Query params: date (YYYY-MM-DD, default hoy), hours (int, default 24)
 */
exports.getDoorCrossings = async (req, res) => {
    try {
        const date  = req.query.date  || new Date().toISOString().split('T')[0];
        const hours = Math.min(parseInt(req.query.hours) || 24, 168);

        const { rows } = await _pgPool.query(
            `SELECT
                date_trunc('hour', created_at AT TIME ZONE 'America/Bogota') AS hour,
                direction,
                COUNT(*) AS crossings
             FROM door_crossing_events
             WHERE created_at >= ($1::date AT TIME ZONE 'America/Bogota')
               AND created_at <  ($1::date AT TIME ZONE 'America/Bogota') + INTERVAL '1 day'
             GROUP BY 1, 2
             ORDER BY 1`,
            [date]
        );

        // También contar registros de kiosko del mismo día (para comparación)
        const kiosk = await prisma.attendanceRecord.groupBy({
            by: ['type'],
            where: {
                timestamp: {
                    gte: new Date(`${date}T00:00:00-05:00`),
                    lt:  new Date(`${date}T23:59:59-05:00`),
                },
            },
            _count: { id: true },
        });

        res.json({ crossings: rows, kioskRecords: kiosk, date });
    } catch (err) {
        logger.error('getDoorCrossings error:', err);
        res.status(500).json({ error: 'Error al obtener cruces de puerta' });
    }
};

/**
 * GET /api/attendance/door-crossings/recent
 * Últimos N eventos de cruce con snapshot.
 */
exports.getDoorCrossingsRecent = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const { rows } = await _pgPool.query(
            `SELECT id, direction, confidence, snapshot_path, bbox_area_start, bbox_area_end, source, created_at
             FROM door_crossing_events
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
        );
        res.json(rows);
    } catch (err) {
        logger.error('getDoorCrossingsRecent error:', err);
        res.status(500).json({ error: 'Error al obtener historial de cruces' });
    }
};

/**
 * GET /api/attendance/door-crossings/summary
 * Resumen rápido: total hoy, última hora, comparativa kiosko.
 */
exports.getDoorCrossingsSummary = async (req, res) => {
    try {
        const { rows } = await _pgPool.query(
            `SELECT
                COUNT(*)                                                              AS total_today,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')      AS last_hour,
                COUNT(*) FILTER (WHERE direction = 'EXIT_PRODUCTION')                AS exits_today,
                COUNT(*) FILTER (WHERE direction = 'ENTER_PRODUCTION')               AS entries_today,
                COUNT(*) FILTER (WHERE direction = 'EXIT_PRODUCTION'
                                   AND created_at >= NOW() - INTERVAL '1 hour')      AS exits_last_hour
             FROM door_crossing_events
             WHERE created_at >= CURRENT_DATE AT TIME ZONE 'America/Bogota'`
        );

        const kioskBreaks = await prisma.attendanceRecord.count({
            where: {
                type: 'EXIT',
                subtype: { in: ['BREAK', 'LUNCH', 'MEDICAL', 'PERSONAL'] },
                timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            },
        });

        const result = rows[0];
        res.json({
            ...result,
            kiosk_breaks_today: kioskBreaks,
            discrepancy: parseInt(result.exits_today) - kioskBreaks,
        });
    } catch (err) {
        logger.error('getDoorCrossingsSummary error:', err);
        res.status(500).json({ error: 'Error al obtener resumen de vigilancia' });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Marcaje multi-método (PIN / Cédula / Cara) para personal que no pasa por
// el flujo de relevo. Todos crean AttendanceRecord con source=HANDOVER.
// Helper interno reutilizado por las 3 variantes.
// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
//  Overtime detection — SOLO LOGISTICA, ASEO y EMPAQUE con turno fijo 8-17
//  Excluidos por decisión operativa: PERSONAL_OFICINA, CALIDAD, CONTABILIDAD,
//  COMERCIAL (registran normal aunque salgan tarde) y rotativos PROD/SIROPES.
// ═════════════════════════════════════════════════════════════════════════════
const OVERTIME_AREAS = new Set(['LOGISTICA', 'ASEO', 'EMPAQUE']);
const OVERTIME_TOLERANCE_MIN = 15;
const OVERTIME_AUTH_THRESHOLD_MIN = 30;

function getScheduledShiftEnd(employee, ts) {
    // Aplica solo a empleados con turno fijo 8-17 en las áreas controladas
    if (!OVERTIME_AREAS.has(employee.area)) return null;
    if (employee.isFixed === false) return null; // si está explícitamente como rotativo, no aplica
    if (employee.isFixed !== true) return null;  // requiere isFixed=true (no asumir)
    // Hora Colombia
    const colTime = new Date(ts.getTime() - 5 * 3600 * 1000);
    const colDay = colTime.getUTCDay(); // 0=Sun, 6=Sat
    if (colDay === 0) return null; // domingo no aplica
    let endHour = 17, endMin = 0; // L-V default 17:00
    if (colDay === 6) { endHour = 12; endMin = 0; } // sábado 12:00
    // Construir end en Colombia time, devolver en UTC
    const colYear  = colTime.getUTCFullYear();
    const colMonth = colTime.getUTCMonth();
    const colDate  = colTime.getUTCDate();
    const endColUtc = new Date(Date.UTC(colYear, colMonth, colDate, endHour, endMin, 0));
    // De Colombia (UTC-5) a UTC: +5h
    return new Date(endColUtc.getTime() + 5 * 3600 * 1000);
}

function assessOvertime(employee, exitTimestamp) {
    const scheduledEnd = getScheduledShiftEnd(employee, exitTimestamp);
    if (!scheduledEnd) return { applies: false };
    const minutesOver = Math.round((exitTimestamp - scheduledEnd) / 60000);
    if (minutesOver <= OVERTIME_TOLERANCE_MIN) return { applies: true, status: 'normal', minutesOver, scheduledEnd };
    if (minutesOver <= OVERTIME_AUTH_THRESHOLD_MIN) return { applies: true, status: 'warning', minutesOver, scheduledEnd };
    return { applies: true, status: 'requires_auth', minutesOver, scheduledEnd };
}

async function _markEmployeeAttendance({ shiftEmployee, action, methodLabel, subtype = null }) {
    if (!shiftEmployee) {
        return { error: 'Sin perfil de empleado de turno', status: 403 };
    }
    if (!['IN', 'OUT'].includes(action)) {
        return { error: 'action debe ser IN u OUT', status: 400 };
    }
    const validSubtypes = ['BREAK', 'LUNCH', 'MEDICAL', 'PERSONAL', 'FINAL'];
    let safeSubtype = null;
    if (action === 'OUT') {
        if (!subtype) {
            return { error: 'Para salir debes elegir motivo: BREAK, LUNCH o FINAL', status: 400 };
        }
        if (!validSubtypes.includes(subtype)) {
            return { error: `Motivo inválido. Usa: ${validSubtypes.join(', ')}`, status: 400 };
        }
        safeSubtype = subtype;
    }

    // BLOQUEO: rotativos PROD/SIROPES/EMPAQUE no pueden marcar ENTRY ni EXIT FINAL por kiosko
    // Su flujo de inicio/fin de turno es por firma de relevo en /turnos.
    const ROTATING_AREAS = new Set(['PRODUCCION', 'SIROPES', 'EMPAQUE']);
    if (ROTATING_AREAS.has(shiftEmployee.area) && shiftEmployee.isFixed === false) {
        if (action === 'IN') {
            return {
                error: '🚫 Tu turno INICIA con la firma del relevo en zona de producción (no por kiosko). Solo usa el kiosko para registrar tu desayuno cuando ya estés trabajando.',
                status: 403,
                blocked: 'rotating_entry'
            };
        }
        if (action === 'OUT' && safeSubtype === 'FINAL') {
            return {
                error: '🚫 Tu turno TERMINA con la firma del relevo cuando llegue el turno entrante (no por kiosko). Si solo vas al desayuno, elige 🍞 DESAYUNO.',
                status: 403,
                blocked: 'rotating_exit_final'
            };
        }
        // BREAK/LUNCH/MEDICAL/PERSONAL sí los permite (descansos intermedios)
    }

    let ts = new Date();
    let overtimeNotice = null;

    // Detección de tiempo extra al marcar FIN DE TURNO
    if (action === 'OUT' && safeSubtype === 'FINAL') {
        const ot = assessOvertime(shiftEmployee, ts);
        if (ot.applies) {
            if (ot.status === 'requires_auth') {
                return {
                    error: `⚠️ Saliste ${ot.minutesOver} min después de tu hora oficial. Requiere autorización del ADMIN.`,
                    status: 422,
                    requiresOvertimeAuth: true,
                    employeeName: shiftEmployee.name,
                    minutesOver: ot.minutesOver,
                    scheduledEnd: ot.scheduledEnd,
                };
            }
            if (ot.status === 'warning') {
                // Cap al timestamp de hora-fin: no se cuentan extras pero queda registrada la salida
                ts = new Date(ot.scheduledEnd);
                overtimeNotice = {
                    minutesOver: ot.minutesOver,
                    message: `✓ Completaste tu horario. Veo que estás saliendo ${ot.minutesOver} min después de las ${ot.scheduledEnd.toISOString().slice(11,16)} UTC. Se registra el horario normal.`,
                };
            }
        }
    }

    const fourHoursAgo = new Date(ts.getTime() - 4 * 60 * 60 * 1000);
    const recent = await prisma.attendanceRecord.findFirst({
        where: { employeeId: shiftEmployee.id, timestamp: { gte: fourHoursAgo } },
        orderBy: { timestamp: 'desc' }
    });
    if (recent && recent.type === (action === 'IN' ? 'ENTRY' : 'EXIT')) {
        return {
            error: `Ya marcaste ${action === 'IN' ? 'entrada' : 'salida'} hace menos de 4 horas`,
            status: 409,
            lastMark: recent.timestamp
        };
    }

    const record = await prisma.attendanceRecord.create({
        data: {
            employeeId: shiftEmployee.id,
            type: action === 'IN' ? 'ENTRY' : 'EXIT',
            subtype: safeSubtype,
            source: 'KIOSK',
            timestamp: ts,
            verified: true,
            notes: `Marcaje ${methodLabel} (${shiftEmployee.area})${safeSubtype ? ` - ${safeSubtype}` : ''}`
        }
    });

    // Sync presence flag — solo sale de planta si es FINAL.
    // BREAK/LUNCH = sigue contando como en planta (descanso interno).
    const goingOutFinal = action === 'OUT' && safeSubtype === 'FINAL';
    if (action === 'IN' || goingOutFinal) {
        await prisma.shiftEmployee.update({
            where: { id: shiftEmployee.id },
            data: action === 'IN'
                ? { isInPlant: true,  lastEntryAt: ts }
                : { isInPlant: false }
        });
    }

    logger.info(`[Mark${methodLabel}] ${action} ${shiftEmployee.name} (${shiftEmployee.area}) at ${ts.toISOString()}${overtimeNotice ? ` [overtime warning ${overtimeNotice.minutesOver}min]` : ''}`);
    return {
        success: true,
        employeeName: shiftEmployee.name,
        area: shiftEmployee.area,
        type: record.type,
        timestamp: record.timestamp,
        method: methodLabel,
        overtimeNotice, // null o { minutesOver, message }
    };
}

// POST /api/attendance/pin-mark — body: { pin, action, subtype? }
exports.pinMark = async (req, res) => {
    try {
        const { pin, action, subtype } = req.body || {};
        if (!pin || !/^\d{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN debe ser 4 dígitos' });
        }
        const bcrypt = require('bcrypt');
        const users = await prisma.user.findMany({
            where: { active: true, pin: { not: null }, role: { not: 'DISTRIBUIDOR' } },
            select: { id: true, name: true, pin: true, shiftEmployee: { select: { id: true, name: true, area: true, isFixed: true, cedula: true } } }
        });
        let matched = null;
        for (const u of users) {
            if (await bcrypt.compare(pin, u.pin)) { matched = u; break; }
        }
        if (!matched) return res.status(401).json({ error: 'PIN incorrecto' });

        const result = await _markEmployeeAttendance({
            shiftEmployee: matched.shiftEmployee, action, methodLabel: 'PIN', subtype
        });
        if (result.error) return res.status(result.status).json({ error: result.error, lastMark: result.lastMark });
        res.json(result);
    } catch (err) {
        logger.error('pinMark error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/attendance/cedula-mark — body: { cedula, action, subtype? }
exports.cedulaMark = async (req, res) => {
    try {
        const { cedula, action, subtype } = req.body || {};
        if (!cedula || !/^\d{6,12}$/.test(String(cedula).trim())) {
            return res.status(400).json({ error: 'Cédula inválida (6-12 dígitos)' });
        }
        const employee = await prisma.shiftEmployee.findUnique({
            where: { cedula: String(cedula).trim() },
            select: { id: true, name: true, area: true, active: true, isFixed: true, cedula: true }
        });
        if (!employee) return res.status(404).json({ error: 'Cédula no registrada' });
        if (!employee.active) return res.status(403).json({ error: 'Empleado inactivo' });

        const result = await _markEmployeeAttendance({
            shiftEmployee: employee, action, methodLabel: 'CEDULA', subtype
        });
        if (result.error) return res.status(result.status).json({ error: result.error, lastMark: result.lastMark });
        res.json(result);
    } catch (err) {
        logger.error('cedulaMark error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/attendance/face-mark — body: { descriptor: [128 floats], action }
// Server compares with all enrolled employees (faceDescriptor stored as JSON array).
// Match si distancia euclidiana < FACE_MATCH_THRESHOLD.
const FACE_MATCH_THRESHOLD = 0.5;
function _euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}
exports.faceMark = async (req, res) => {
    try {
        const { descriptor, action, subtype } = req.body || {};
        if (!Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ error: 'Descriptor facial inválido (debe ser array de 128 floats)' });
        }
        const employees = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null } },
            select: { id: true, name: true, area: true, faceDescriptor: true, isFixed: true, cedula: true }
        });
        let bestMatch = null;
        let bestDist = Infinity;
        for (const emp of employees) {
            const d = bestFaceDistance(descriptor, emp.faceDescriptor);
            if (d < bestDist) { bestDist = d; bestMatch = emp; }
        }
        if (!bestMatch || bestDist > FACE_MATCH_THRESHOLD) {
            return res.status(401).json({
                error: 'Cara no reconocida',
                bestDistance: bestDist === Infinity ? null : Math.round(bestDist * 1000) / 1000
            });
        }

        const result = await _markEmployeeAttendance({
            shiftEmployee: bestMatch, action, methodLabel: 'FACE', subtype
        });
        if (result.error) return res.status(result.status).json({ error: result.error, lastMark: result.lastMark });
        res.json({ ...result, faceDistance: Math.round(bestDist * 1000) / 1000 });
    } catch (err) {
        logger.error('faceMark error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Overtime Approvals — admin approves extra hours per employee per day
// ═════════════════════════════════════════════════════════════════════════════
exports.listOvertimeApprovals = async (req, res) => {
    try {
        const { employeeId, from, to } = req.query;
        const where = {};
        if (employeeId) where.employeeId = employeeId;
        if (from || to) {
            where.date = {};
            if (from) where.date.gte = new Date(`${from}T00:00:00.000-05:00`);
            if (to)   where.date.lte = new Date(`${to}T23:59:59.999-05:00`);
        }
        const items = await prisma.overtimeApproval.findMany({
            where,
            include: {
                employee: { select: { id: true, name: true, area: true } },
                approvedBy: { select: { id: true, name: true } }
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            take: 500
        });
        res.json({ items });
    } catch (err) {
        logger.error('listOvertimeApprovals error:', err);
        res.status(500).json({ error: 'Error obteniendo aprobaciones de horas extra' });
    }
};

exports.createOvertimeApproval = async (req, res) => {
    try {
        const { employeeId, date, dayHours, nightHours, reason } = req.body || {};
        if (!employeeId) return res.status(400).json({ error: 'employeeId requerido' });
        if (!date) return res.status(400).json({ error: 'date requerida (YYYY-MM-DD)' });
        const day = Number(dayHours) || 0;
        const night = Number(nightHours) || 0;
        if (day < 0 || night < 0 || day > 24 || night > 24) {
            return res.status(400).json({ error: 'horas inválidas (0-24)' });
        }
        if (day === 0 && night === 0) {
            return res.status(400).json({ error: 'Debe registrar al menos 1 hora (día o noche)' });
        }
        if (!reason || String(reason).trim().length < 3) {
            return res.status(400).json({ error: 'reason requerido (mínimo 3 caracteres)' });
        }

        const employee = await prisma.shiftEmployee.findUnique({ where: { id: employeeId } });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        // Warn if employee has a registered absence that day (does NOT block — admin may
        // legitimately approve partial-day overtime if the person worked some hours).
        const target = new Date(`${date}T12:00:00.000-05:00`);
        const absence = await prisma.shiftAbsence.findFirst({
            where: {
                employeeId,
                startDate: { lte: target },
                endDate: { gte: target }
            },
            select: { reason: true }
        });

        const approval = await prisma.overtimeApproval.create({
            data: {
                employeeId,
                date: target,
                dayHours: day,
                nightHours: night,
                reason: String(reason).trim(),
                approvedById: req.user.id
            },
            include: {
                employee: { select: { id: true, name: true, area: true } },
                approvedBy: { select: { id: true, name: true } }
            }
        });
        logger.info(`[OvertimeApproval] +${day}h día +${night}h noche to ${employee.name} on ${date} by ${req.user.name}`);
        res.json({
            approval,
            warning: absence
                ? `Atención: ${employee.name} tiene una ausencia registrada (${absence.reason}) en ${date}. Las horas extra se registraron de todas formas.`
                : undefined
        });
    } catch (err) {
        logger.error('createOvertimeApproval error:', err);
        res.status(500).json({ error: 'Error registrando aprobación' });
    }
};

exports.deleteOvertimeApproval = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.overtimeApproval.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'No encontrado' });
        await prisma.overtimeApproval.delete({ where: { id } });
        logger.info(`[OvertimeApproval] deleted ${id} by ${req.user.name}`);
        res.json({ success: true });
    } catch (err) {
        logger.error('deleteOvertimeApproval error:', err);
        res.status(500).json({ error: 'Error eliminando aprobación' });
    }
};

// ─── Exportar lista de roles para el middleware de login ──────────────────────
exports.KIOSK_REQUIRED_ROLES = KIOSK_REQUIRED_ROLES;

// ═════════════════════════════════════════════════════════════════════════════
// recordHandoverAttendance
// Registra entrada/salida derivada de la firma del relevo.
// - eventType: 'IN' (entrante) o 'OUT' (saliente)
// - outgoingShift: 'MANANA' | 'TARDE' | 'NOCHE' (para el cap +10 min en OUT)
// - signatureTime: Date de la firma (default: ahora)
// Reglas:
//   * Si el usuario no tiene shiftEmployee → no-op silencioso.
//   * Si ya hay AttendanceRecord en las últimas 4h → no-op (kiosko o relevo previo gana).
//   * Para 'OUT' la hora se topa en endTime + 10 min (evita extras por demora administrativa).
//   * Cualquier excepción se loguea pero NO se propaga (no debe romper la firma del relevo).
// ═════════════════════════════════════════════════════════════════════════════
const HANDOVER_OUT_GRACE_MINUTES = 10;

const HANDOVER_END_HOURS = {
    MANANA: { weekday: { h: 14, m: 0 }, saturday: { h: 12, m: 0 } },
    TARDE:  { weekday: { h: 22, m: 0 }, saturday: { h: 18, m: 0 } },
    NOCHE:  { weekday: { h: 6,  m: 0 }, saturday: { h: 6,  m: 0 } }, // ends next day
};

function colombiaDateForSignature(signatureTime) {
    const utc = new Date(signatureTime);
    return new Date(utc.getTime() - (5 * 60 * 60 * 1000));
}

function computeShiftEndCapForOut(outgoingShift, signatureTime) {
    const endCfg = HANDOVER_END_HOURS[outgoingShift];
    if (!endCfg) return null;
    const colTime = colombiaDateForSignature(signatureTime);
    const isSat = colTime.getUTCDay() === 6;
    const cfg = isSat ? endCfg.saturday : endCfg.weekday;

    // Build end-of-shift in Colombia time, then convert back to UTC for storage
    const colYear = colTime.getUTCFullYear();
    const colMonth = colTime.getUTCMonth();
    const colDate = colTime.getUTCDate();
    let endCol = new Date(Date.UTC(colYear, colMonth, colDate, cfg.h, cfg.m, 0));
    if (outgoingShift === 'NOCHE') {
        // NOCHE ends next morning; if the signature is past 22:00 the same calendar day,
        // the end is tomorrow morning at 06:00.
        if (colTime.getUTCHours() >= 12) {
            endCol = new Date(endCol.getTime() + 24 * 60 * 60 * 1000);
        }
    }
    const endUtc = new Date(endCol.getTime() + (5 * 60 * 60 * 1000));
    return new Date(endUtc.getTime() + HANDOVER_OUT_GRACE_MINUTES * 60 * 1000);
}

exports.recordHandoverAttendance = async ({ userId, eventType, outgoingShift, signatureTime }) => {
    try {
        if (!userId || !eventType) return { skipped: 'missing-args' };
        const ts = signatureTime ? new Date(signatureTime) : new Date();

        const employee = await prisma.shiftEmployee.findUnique({
            where: { userId },
            select: { id: true, name: true }
        });
        if (!employee) return { skipped: 'no-shiftEmployee' };

        // Skip only if the latest record in the last 4h is of the SAME type
        // (e.g. ENTRY → ENTRY = duplicate). ENTRY → EXIT or EXIT → ENTRY MUST
        // be allowed — going out after coming in (or vice-versa) is legitimate.
        const fourHoursAgo = new Date(ts.getTime() - 4 * 60 * 60 * 1000);
        const recent = await prisma.attendanceRecord.findFirst({
            where: { employeeId: employee.id, timestamp: { gte: fourHoursAgo, lte: new Date(ts.getTime() + 60 * 1000) } },
            orderBy: { timestamp: 'desc' },
            select: { id: true, type: true, source: true, timestamp: true }
        });
        const targetType = eventType === 'OUT' ? 'EXIT' : 'ENTRY';
        if (recent && recent.type === targetType) {
            logger.info(`[HandoverAttendance] Skipped duplicate ${recent.type} (${recent.source} at ${recent.timestamp.toISOString()}) for ${employee.name}`);
            return { skipped: 'duplicate-same-type', recent };
        }

        // For OUT, cap timestamp at shiftEnd + grace
        let stamp = ts;
        if (eventType === 'OUT' && outgoingShift) {
            const cap = computeShiftEndCapForOut(outgoingShift, ts);
            if (cap && ts > cap) stamp = cap;
        }

        const record = await prisma.attendanceRecord.create({
            data: {
                employeeId: employee.id,
                type: eventType === 'OUT' ? 'EXIT' : 'ENTRY',
                source: 'HANDOVER',
                timestamp: stamp,
                verified: true,
                notes: `Firma de relevo (${outgoingShift || '-'}, ${eventType})`
            }
        });

        // Sync presence flag so the "En Planta Ahora" dashboard counts correctly.
        await prisma.shiftEmployee.update({
            where: { id: employee.id },
            data: eventType === 'IN'
                ? { isInPlant: true, lastEntryAt: stamp }
                : { isInPlant: false }
        });

        logger.info(`[HandoverAttendance] Recorded ${record.type} for ${employee.name} at ${record.timestamp.toISOString()} (capped=${stamp.getTime() !== ts.getTime()})`);
        return { recorded: true, record };
    } catch (err) {
        logger.error('[HandoverAttendance] error (non-blocking):', err);
        return { error: err.message };
    }
};

// ═════════════════════════════════════════════════════════════════════════════
//  YOLOv8 + InsightFace (delega al servicio Python en :3063)
// ═════════════════════════════════════════════════════════════════════════════

exports.enrollFaceInsightface = async (req, res) => {
    try {
        const employeeId = req.params.id;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Debes subir al menos 1 foto en el campo "files"' });
        }
        const form = new FormData();
        for (const f of req.files) {
            form.append('files', f.buffer, { filename: f.originalname || 'photo.jpg', contentType: f.mimetype || 'image/jpeg' });
        }
        const url = `${FACE_SERVICE_URL}/enroll-multi/${employeeId}`;
        const response = await axios.post(url, form, {
            headers: form.getHeaders(),
            timeout: 30000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
        logger.info(`[InsightFace enroll] ${employeeId} → ${response.data.photos_used} fotos válidas`);
        res.json({ success: true, ...response.data });
    } catch (err) {
        const msg = err.response?.data?.detail || err.message;
        logger.error('[enrollFaceInsightface] error:', msg);
        res.status(err.response?.status || 500).json({ error: msg });
    }
};

exports.faceMarkInsightface = async (req, res) => {
    try {
        const { action, subtype } = req.body || {};
        if (!req.file) return res.status(400).json({ error: 'Falta la foto en campo "photo"' });
        if (!['IN', 'OUT'].includes(action)) return res.status(400).json({ error: 'action debe ser IN u OUT' });

        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname || 'kiosk.jpg', contentType: req.file.mimetype || 'image/jpeg' });

        const r = await axios.post(`${FACE_SERVICE_URL}/match`, form, {
            headers: form.getHeaders(),
            timeout: 10000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        if (!r.data.matched) {
            const reason = r.data.reason === 'no_face_detected' ? 'No se detectó cara'
                : r.data.reason === 'no_enrolled_employees' ? 'No hay empleados enrolados'
                : `Rostro no reconocido (distancia: ${r.data.best_distance ?? '?'})`;
            return res.status(401).json({ error: reason, faceServiceResponse: r.data });
        }

        const employee = await prisma.shiftEmployee.findUnique({
            where: { id: r.data.employee_id },
            select: { id: true, name: true, area: true, active: true }
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no existe en BD' });
        if (!employee.active) return res.status(403).json({ error: 'Empleado inactivo' });

        const result = await _markEmployeeAttendance({
            shiftEmployee: employee, action, methodLabel: 'FACE_INSIGHTFACE', subtype
        });
        if (result.error) return res.status(result.status).json({ error: result.error, lastMark: result.lastMark });

        res.json({ ...result, similarity: r.data.similarity, distance: r.data.distance });
    } catch (err) {
        const msg = err.response?.data?.detail || err.message;
        logger.error('[faceMarkInsightface] error:', msg);
        res.status(err.response?.status || 500).json({ error: msg });
    }
};

/**
 * Verifica que la foto coincide con la cédula ingresada.
 * NO marca asistencia — solo identifica + valida match.
 * Body: multipart con `photo` + `cedula`.
 * Devuelve { verified, employee?, currentState?, similarity?, reason? }.
 */
exports.verifyFaceByCedula = async (req, res) => {
    try {
        const { cedula } = req.body || {};
        if (!req.file) return res.status(400).json({ error: 'Falta la foto en campo "photo"' });
        if (!cedula) return res.status(400).json({ error: 'Falta cédula' });

        // 1) Buscar empleado por cédula
        const employee = await prisma.shiftEmployee.findUnique({
            where: { cedula: String(cedula).trim() },
            select: {
                id: true, name: true, area: true, role: true,
                photoUrl: true, isInPlant: true, active: true,
            }
        });
        if (!employee) return res.status(404).json({ verified: false, reason: 'cedula_not_found', error: 'Cédula no registrada' });
        if (!employee.active) return res.status(403).json({ verified: false, reason: 'inactive', error: 'Empleado inactivo' });

        // 2) Identificar cara con InsightFace
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname || 'kiosk.jpg', contentType: req.file.mimetype || 'image/jpeg' });

        let matchData;
        try {
            const r = await axios.post(`${FACE_SERVICE_URL}/match`, form, {
                headers: form.getHeaders(),
                timeout: 10000,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            matchData = r.data;
        } catch (err) {
            const msg = err.response?.data?.detail || err.message;
            logger.error('[verifyFaceByCedula] face-service error:', msg);
            return res.status(503).json({ verified: false, reason: 'face_service_error', error: 'Servicio de reconocimiento no responde' });
        }

        // 3) Casos de respuesta
        if (!matchData.matched) {
            const reason = matchData.reason || 'unknown';
            return res.status(200).json({
                verified: false,
                reason,
                expected: { id: employee.id, name: employee.name },
                best_distance: matchData.best_distance ?? null,
            });
        }

        // 4) Match encontrado — validar que coincide con la cédula
        if (matchData.employee_id !== employee.id) {
            logger.warn(`[verifyFaceByCedula] MISMATCH: cédula=${cedula} (esperado: ${employee.name}) cara_detectada=${matchData.name} (id=${matchData.employee_id}) sim=${matchData.similarity}`);
            return res.status(200).json({
                verified: false,
                reason: 'face_mismatch',
                expected: { id: employee.id, name: employee.name },
                detected: { id: matchData.employee_id, name: matchData.name },
                similarity: matchData.similarity,
            });
        }

        // 5) Verified — calcular estado actual del empleado
        const currentState = await _getEmployeeCurrentState(employee.id);

        logger.info(`[verifyFaceByCedula] ✅ ${employee.name} (cédula ${cedula}) — sim=${matchData.similarity} state=${currentState}`);
        return res.json({
            verified: true,
            employee: {
                id: employee.id,
                name: employee.name,
                area: employee.area,
                role: employee.role,
                photoUrl: employee.photoUrl,
                isInPlant: employee.isInPlant,
            },
            currentState,
            similarity: matchData.similarity,
            distance: matchData.distance,
        });
    } catch (err) {
        logger.error('[verifyFaceByCedula] error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Helper: estado actual del empleado (OUT, IN, BREAK)
async function _getEmployeeCurrentState(employeeId) {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const last = await prisma.attendanceRecord.findFirst({
        where: { employeeId, timestamp: { gte: fourHoursAgo } },
        orderBy: { timestamp: 'desc' },
        select: { type: true, subtype: true }
    });
    if (!last) return 'OUT';
    if (last.type === 'ENTRY') return 'IN';
    if (last.type === 'EXIT' && last.subtype === 'FINAL') return 'OUT';
    return 'BREAK'; // EXIT con BREAK / LUNCH / MEDICAL / PERSONAL
}

/**
 * Justifica salida con tiempo extra. Pide PIN del admin que autoriza.
 * POST /api/attendance/justify-overtime
 * Body: { cedula, reason, adminPin }
 */
exports.justifyOvertime = async (req, res) => {
    try {
        const { cedula, reason, adminPin } = req.body || {};
        if (!cedula) return res.status(400).json({ error: 'Falta cédula' });
        if (!reason || reason.trim().length < 5) return res.status(400).json({ error: 'Motivo demasiado corto (mínimo 5 caracteres)' });
        if (!adminPin || !/^\d{4}$/.test(adminPin)) return res.status(400).json({ error: 'PIN admin debe ser 4 dígitos' });

        // 1) Buscar empleado
        const employee = await prisma.shiftEmployee.findUnique({
            where: { cedula: String(cedula).trim() },
            select: { id: true, name: true, area: true, active: true, isFixed: true }
        });
        if (!employee) return res.status(404).json({ error: 'Cédula no registrada' });
        if (!employee.active) return res.status(403).json({ error: 'Empleado inactivo' });

        // 2) Validar PIN admin
        const bcrypt = require('bcrypt');
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', pin: { not: null } },
            select: { id: true, name: true, pin: true }
        });
        let admin = null;
        for (const a of admins) {
            if (await bcrypt.compare(adminPin, a.pin)) { admin = a; break; }
        }
        if (!admin) return res.status(401).json({ error: 'PIN admin incorrecto' });

        // 3) Calcular tiempo extra
        const ts = new Date();
        const ot = assessOvertime(employee, ts);
        if (!ot.applies || ot.status === 'normal') {
            return res.status(400).json({ error: 'No hay tiempo extra que justificar (estás dentro del horario)' });
        }

        // 4) Calcular horas día/noche según hora actual Colombia
        const colHour = new Date(ts.getTime() - 5 * 3600 * 1000).getUTCHours();
        const isNight = colHour >= 21 || colHour < 6;
        const minutesOver = Math.max(0, (ts - ot.scheduledEnd) / 60000);
        const overtimeHours = +(minutesOver / 60).toFixed(2);
        const dayHours   = isNight ? 0 : overtimeHours;
        const nightHours = isNight ? overtimeHours : 0;

        // 5) Crear AttendanceRecord (timestamp REAL, no capeado)
        const record = await prisma.attendanceRecord.create({
            data: {
                employeeId: employee.id,
                type: 'EXIT',
                subtype: 'FINAL',
                source: 'KIOSK',
                timestamp: ts,
                verified: true,
                notes: `Tiempo extra autorizado por ${admin.name} | Motivo: ${reason}`,
            }
        });

        // 6) Crear OvertimeApproval
        const approval = await prisma.overtimeApproval.create({
            data: {
                employeeId: employee.id,
                date: ts,
                dayHours,
                nightHours,
                reason: reason.trim(),
                approvedById: admin.id,
            }
        });

        // 7) Marcar como salido de planta
        await prisma.shiftEmployee.update({
            where: { id: employee.id },
            data: { isInPlant: false }
        });

        logger.info(`[justifyOvertime] ✅ ${employee.name} | +${minutesOver.toFixed(0)}min (${dayHours}d/${nightHours}n) | autorizado por ${admin.name} | motivo: ${reason}`);
        res.json({
            success: true,
            employeeName: employee.name,
            area: employee.area,
            minutesOver: Math.round(minutesOver),
            dayHours,
            nightHours,
            authorizedBy: admin.name,
            approvalId: approval.id,
            recordId: record.id,
        });
    } catch (err) {
        logger.error('[justifyOvertime] error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.faceServiceHealth = async (req, res) => {
    try {
        const r = await axios.get(`${FACE_SERVICE_URL}/health`, { timeout: 5000 });
        res.json(r.data);
    } catch (err) {
        res.status(503).json({ error: 'Servicio facial no responde', detail: err.message });
    }
};
