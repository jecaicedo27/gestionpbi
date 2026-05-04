/**
 * attendanceController.js
 * Control de ingreso y salida de empleados a la planta.
 * Gestiona: check-in, check-out, descansos, enrollment facial, reportes.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { getLaborSummary } = require('../services/laborSummaryService');
const prisma = new PrismaClient();

const PAYROLL_CONFIG_KEY = 'attendance_payroll_config';
const PAYROLL_CLOSURE_PREFIX = 'attendance_payroll_closure:';
const DEFAULT_PAYROLL_CONFIG = {
    dayStart: '06:00',
    nightStart: '21:00',
    fortnightCutoffDay: 15,
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

// Turnos donde los descansos descuentan de las horas trabajadas
const OFFICE_SHIFT_CODES = ['OFICINA'];

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

    // Obtener asignacion de turno vigente para saber si es OFICINA
    const employee = await prisma.shiftEmployee.findUnique({
        where: { id: employeeId },
    });

    // Buscar el turno de la semana activa mas reciente
    const weekAssignment = await prisma.shiftAssignment.findFirst({
        where: { employeeId },
        include: { week: true },
        orderBy: { week: { weekStart: 'desc' } },
    });

    const shiftCode = weekAssignment?.shift?.toUpperCase() || '';
    const isOfficeShift = OFFICE_SHIFT_CODES.includes(shiftCode);

    let totalMs = 0;
    let breakMs = 0;
    let entryTime = null;
    let breakStart = null;

    for (const rec of records) {
        if (rec.type === 'ENTRY') {
            entryTime = new Date(rec.timestamp);
            breakStart = null;
        } else if (rec.type === 'EXIT') {
            if (rec.subtype === 'FINAL' && entryTime) {
                totalMs += new Date(rec.timestamp) - entryTime;
                entryTime = null;
            } else if (['BREAK', 'LUNCH', 'MEDICAL', 'PERSONAL'].includes(rec.subtype)) {
                breakStart = new Date(rec.timestamp);
            }
        }
        // Re-ENTRY after break
        if (rec.type === 'ENTRY' && breakStart) {
            if (isOfficeShift) {
                breakMs += new Date(rec.timestamp) - breakStart;
            }
            breakStart = null;
        }
    }

    const netMs = totalMs - (isOfficeShift ? breakMs : 0);
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
                cedula: true, faceDescriptor: true,
            },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const { isInPlant, currentState } = await getPresenceStatus(employee.id);
        res.json({ ...employee, isInPlant, currentState });
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
            const dist = faceDistance(descriptor, emp.faceDescriptor);
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

        const [record] = await prisma.$transaction([
            prisma.attendanceRecord.create({
                data: {
                    employeeId,
                    type: 'EXIT',
                    subtype,
                    latitude: latitude ?? null,
                    longitude: longitude ?? null,
                    accuracy: accuracy ?? null,
                    photoPath: photoPath ?? null,
                    verified: verified ?? false,
                    source: source ?? 'KIOSK',
                    notes: notes ?? null,
                },
            }),
            prisma.shiftEmployee.update({
                where: { id: employeeId },
                data: { isInPlant: isFinal ? false : employee.isInPlant },
            }),
        ]);

        res.json({ success: true, record });
        logger.info(`EXIT(${subtype}): ${employee.name} (${employee.cedula})`);
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

        // Fetch all today's records, then keep only the LATEST per employee.
        // This way the activity feed always reflects the CURRENT state of each
        // person — no "stale" exits showing after a return-from-break.
        const allTodayRecords = await prisma.attendanceRecord.findMany({
            where: { timestamp: { gte: today } },
            include: {
                employee: { select: { name: true, area: true, photoUrl: true } },
            },
            orderBy: { timestamp: 'desc' },
        });
        const seenEmployees = new Set();
        const recentRecords = [];
        for (const r of allTodayRecords) {
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
        const config = {
            dayStart: typeof payload.dayStart === 'string' ? payload.dayStart : DEFAULT_PAYROLL_CONFIG.dayStart,
            nightStart: typeof payload.nightStart === 'string' ? payload.nightStart : DEFAULT_PAYROLL_CONFIG.nightStart,
            fortnightCutoffDay: parseInt(payload.fortnightCutoffDay, 10) || DEFAULT_PAYROLL_CONFIG.fortnightCutoffDay,
        };

        if (!config.dayStart.includes(':') || !config.nightStart.includes(':')) {
            return res.status(400).json({ error: 'Las franjas diurna y nocturna deben tener formato HH:MM' });
        }
        if (config.fortnightCutoffDay < 1 || config.fortnightCutoffDay > 28) {
            return res.status(400).json({ error: 'El corte quincenal debe estar entre 1 y 28' });
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

        // Usuarios registrados en gestionpbi con roles de kiosko pero SIN shift_employee
        const pendingUsers = await prisma.user.findMany({
            where: {
                active: true,
                role: { in: KIOSK_REQUIRED_ROLES },
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

        const employee = await prisma.shiftEmployee.create({
            data: {
                name: user.name,
                area,
                role: user.role,
                cedula: cedula?.trim() || null,
                userId: user.id,
                active: true,
                isInPlant: false,
            },
        });

        res.status(201).json({ success: true, employee });
        logger.info(`ShiftEmployee created from user ${user.name} (${user.role})`);
    } catch (err) {
        logger.error('createFromUser error:', err);
        res.status(500).json({ error: 'Error al crear registro de kiosko' });
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
        const { descriptor, photoUrl } = req.body;
        if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ error: 'Descriptor facial inválido (requiere array de 128 floats)' });
        }

        // Verificar duplicado (distancia < 0.5 con otro empleado)
        const others = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null }, id: { not: req.params.id } },
            select: { id: true, name: true, faceDescriptor: true },
        });

        for (const other of others) {
            const dist = faceDistance(descriptor, other.faceDescriptor);
            if (dist < 0.5) {
                return res.status(409).json({
                    error: `Rostro muy similar al de ${other.name} (distancia: ${dist.toFixed(3)}). Verifica que sea la persona correcta.`,
                    conflictEmployeeId: other.id,
                });
            }
        }

        const updated = await prisma.shiftEmployee.update({
            where: { id: req.params.id },
            data: {
                faceDescriptor: descriptor,
                ...(photoUrl ? { photoUrl } : {}),
            },
            select: { id: true, name: true, photoUrl: true },
        });

        res.json({ success: true, employee: updated });
        logger.info(`Face enrolled: ${updated.name}`);
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
async function _markEmployeeAttendance({ shiftEmployee, action, methodLabel }) {
    if (!shiftEmployee) {
        return { error: 'Sin perfil de empleado de turno', status: 403 };
    }
    if (!['IN', 'OUT'].includes(action)) {
        return { error: 'action debe ser IN u OUT', status: 400 };
    }

    const ts = new Date();
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
            source: 'HANDOVER',
            timestamp: ts,
            verified: true,
            notes: `Marcaje ${methodLabel} (${shiftEmployee.area})`
        }
    });

    // Sync presence flag so the "En Planta Ahora" dashboard counts correctly.
    await prisma.shiftEmployee.update({
        where: { id: shiftEmployee.id },
        data: action === 'IN'
            ? { isInPlant: true,  lastEntryAt: ts }
            : { isInPlant: false }
    });

    logger.info(`[Mark${methodLabel}] ${action} ${shiftEmployee.name} (${shiftEmployee.area}) at ${ts.toISOString()}`);
    return {
        success: true,
        employeeName: shiftEmployee.name,
        area: shiftEmployee.area,
        type: record.type,
        timestamp: record.timestamp,
        method: methodLabel
    };
}

// POST /api/attendance/pin-mark — body: { pin, action }
exports.pinMark = async (req, res) => {
    try {
        const { pin, action } = req.body || {};
        if (!pin || !/^\d{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN debe ser 4 dígitos' });
        }
        const bcrypt = require('bcrypt');
        const users = await prisma.user.findMany({
            where: { active: true, pin: { not: null }, role: { not: 'DISTRIBUIDOR' } },
            select: { id: true, name: true, pin: true, shiftEmployee: { select: { id: true, name: true, area: true } } }
        });
        let matched = null;
        for (const u of users) {
            if (await bcrypt.compare(pin, u.pin)) { matched = u; break; }
        }
        if (!matched) return res.status(401).json({ error: 'PIN incorrecto' });

        const result = await _markEmployeeAttendance({
            shiftEmployee: matched.shiftEmployee, action, methodLabel: 'PIN'
        });
        if (result.error) return res.status(result.status).json({ error: result.error, lastMark: result.lastMark });
        res.json(result);
    } catch (err) {
        logger.error('pinMark error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/attendance/cedula-mark — body: { cedula, action }
exports.cedulaMark = async (req, res) => {
    try {
        const { cedula, action } = req.body || {};
        if (!cedula || !/^\d{6,12}$/.test(String(cedula).trim())) {
            return res.status(400).json({ error: 'Cédula inválida (6-12 dígitos)' });
        }
        const employee = await prisma.shiftEmployee.findUnique({
            where: { cedula: String(cedula).trim() },
            select: { id: true, name: true, area: true, active: true }
        });
        if (!employee) return res.status(404).json({ error: 'Cédula no registrada' });
        if (!employee.active) return res.status(403).json({ error: 'Empleado inactivo' });

        const result = await _markEmployeeAttendance({
            shiftEmployee: employee, action, methodLabel: 'CEDULA'
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
        const { descriptor, action } = req.body || {};
        if (!Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ error: 'Descriptor facial inválido (debe ser array de 128 floats)' });
        }
        const employees = await prisma.shiftEmployee.findMany({
            where: { active: true, faceDescriptor: { not: null } },
            select: { id: true, name: true, area: true, faceDescriptor: true }
        });
        let bestMatch = null;
        let bestDist = Infinity;
        for (const emp of employees) {
            const stored = Array.isArray(emp.faceDescriptor) ? emp.faceDescriptor : [];
            if (stored.length !== 128) continue;
            const d = _euclideanDistance(descriptor, stored);
            if (d < bestDist) { bestDist = d; bestMatch = emp; }
        }
        if (!bestMatch || bestDist > FACE_MATCH_THRESHOLD) {
            return res.status(401).json({
                error: 'Cara no reconocida',
                bestDistance: bestDist === Infinity ? null : Math.round(bestDist * 1000) / 1000
            });
        }

        const result = await _markEmployeeAttendance({
            shiftEmployee: bestMatch, action, methodLabel: 'FACE'
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
