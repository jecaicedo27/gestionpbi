/**
 * attendanceController.js
 * Control de ingreso y salida de empleados a la planta.
 * Gestiona: check-in, check-out, descansos, enrollment facial, reportes.
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const prisma = new PrismaClient();

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

        const recentRecords = await prisma.attendanceRecord.findMany({
            where: { timestamp: { gte: today } },
            include: {
                employee: { select: { name: true, area: true, photoUrl: true } },
            },
            orderBy: { timestamp: 'desc' },
            take: 20,
        });

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

// ─── Exportar lista de roles para el middleware de login ──────────────────────
exports.KIOSK_REQUIRED_ROLES = KIOSK_REQUIRED_ROLES;
