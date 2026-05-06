const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Configuración por defecto alineada al CST + Ley 2466/2025 vigente.
// nightStart = 19:00 desde el 26-dic-2025 (transición de la reforma laboral).
// Porcentajes son recargos sobre la hora ordinaria (sin contar el 100% base).
const DEFAULT_CONFIG = {
    dayStart: '06:00',
    nightStart: '19:00',
    fortnightCutoffDay: 15,
    weeklyHours: 44,            // baja a 42 desde 15-jul-2026
    monthlyHourDivisor: 220,    // = weeklyHours × 5; sube a 230 con 42h/sem
    surchargeNight: 0.35,       // recargo nocturno (Art. 168 CST)
    surchargeSundayDay: 0.80,   // dom/fest diurno (Ley 2466/2025; sube a 0.90 jul-2026, 1.00 jul-2027)
    surchargeSundayNight: 1.15, // dom/fest nocturno = 0.80 + 0.35
    overtimeDay: 0.25,          // extra diurna
    overtimeNight: 0.75,        // extra nocturna
    overtimeSundayDay: 1.05,    // extra dom/fest diurna = 0.25 + 0.80
    overtimeSundayNight: 1.55,  // extra dom/fest nocturna = 0.75 + 0.80
};

function pad(value) {
    return String(value).padStart(2, '0');
}

function toDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cloneDate(date) {
    return new Date(new Date(date).getTime());
}

function startOfDay(date) {
    const d = cloneDate(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = cloneDate(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function addDays(date, days) {
    const d = cloneDate(date);
    d.setDate(d.getDate() + days);
    return d;
}

function enumerateDays(from, to) {
    const days = [];
    const cursor = startOfDay(from);
    const end = startOfDay(to);
    while (cursor <= end) {
        days.push(cloneDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
}

function parseTimeToMinutes(value) {
    if (!value || typeof value !== 'string' || !value.includes(':')) return null;
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return (hours * 60) + minutes;
}

function buildDateTime(date, hhmm) {
    const d = cloneDate(date);
    const [hours, minutes] = hhmm.split(':').map(Number);
    d.setHours(hours, minutes, 0, 0);
    return d;
}

function getOverlapMinutes(startA, endA, startB, endB) {
    const start = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
    const end = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
    return end > start ? Math.round((end - start) / 60000) : 0;
}

function getOverlapSegment(startA, endA, startB, endB) {
    const start = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
    const end = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
    return end > start ? { start: new Date(start), end: new Date(end) } : null;
}

function getScheduleWeekMonday(dateInput) {
    const date = startOfDay(dateInput);
    if (date.getDay() === 0) {
        date.setDate(date.getDate() + 1);
        return date;
    }
    const diff = date.getDate() - date.getDay() + 1;
    date.setDate(diff);
    return date;
}

function resolveShiftWindow(date, shiftCode, shiftDefs) {
    const def = shiftDefs[shiftCode];
    if (!def) return null;

    const dayOfWeek = new Date(date).getDay();
    let startField = def.weekdayStart;
    let endField = def.weekdayEnd;

    if (dayOfWeek === 6) {
        startField = def.saturdayStart;
        endField = def.saturdayEnd;
    } else if (dayOfWeek === 0) {
        startField = def.sundayStart;
        endField = def.sundayEnd;
    }

    if (!startField || !endField) return null;

    const start = buildDateTime(date, startField);
    const end = buildDateTime(date, endField);
    if (def.crossesMidnight || end <= start) {
        end.setDate(end.getDate() + 1);
    }

    return {
        shiftCode,
        shiftName: def.name,
        start,
        end,
        scheduledMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
    };
}

function buildWorkedIntervals(records, fallbackEnd) {
    const ordered = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const intervals = [];
    let currentEntry = null;

    for (const record of ordered) {
        const ts = new Date(record.timestamp);
        if (record.type === 'ENTRY') {
            currentEntry = ts;
            continue;
        }

        if (record.type === 'EXIT' && currentEntry && ts > currentEntry) {
            intervals.push({ start: currentEntry, end: ts });
            currentEntry = null;
        }
    }

    if (currentEntry && fallbackEnd) {
        // For an open ENTRY (no matching EXIT), close at min(fallbackEnd, now).
        // Without the `now` cap a person currently in plant accumulates hours
        // until the end of the reporting period — generating phantom worked time.
        const now = new Date();
        const cap = new Date(Math.min(new Date(fallbackEnd).getTime(), now.getTime()));
        if (cap > currentEntry) {
            intervals.push({ start: currentEntry, end: cap });
        }
    }

    return intervals;
}

function mergeSegments(segments) {
    if (!segments.length) return [];
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    const merged = [ordered[0]];

    for (let i = 1; i < ordered.length; i++) {
        const current = ordered[i];
        const last = merged[merged.length - 1];
        if (current.start <= last.end) {
            if (current.end > last.end) last.end = current.end;
        } else {
            merged.push({ start: current.start, end: current.end });
        }
    }

    return merged;
}

function subtractSegments(base, blockers) {
    const relevant = mergeSegments(
        blockers
            .map((segment) => getOverlapSegment(base.start, base.end, segment.start, segment.end))
            .filter(Boolean)
    );

    if (!relevant.length) return [base];

    const pieces = [];
    let cursor = new Date(base.start);
    for (const blocker of relevant) {
        if (blocker.start > cursor) {
            pieces.push({ start: new Date(cursor), end: new Date(blocker.start) });
        }
        if (blocker.end > cursor) cursor = new Date(blocker.end);
    }
    if (cursor < base.end) {
        pieces.push({ start: new Date(cursor), end: new Date(base.end) });
    }

    return pieces.filter((piece) => piece.end > piece.start);
}

/**
 * Reparte los minutos de un segmento en 4 bandas legales:
 *   day, night, sunDay, sunNight
 * "sun" cubre domingos Y festivos colombianos. Si holidaySet está vacío
 * solo se usa el dayOfWeek === 0 para detectar dominical.
 */
function allocateMinutesByBand(segment, config, holidaySet = new Set()) {
    let day = 0;
    let night = 0;
    let sunDay = 0;
    let sunNight = 0;

    const cursor = new Date(segment.start);
    while (cursor < segment.end) {
        const dayStart = startOfDay(cursor);
        const nextDay = addDays(dayStart, 1);
        const firstBandEnd = buildDateTime(dayStart, config.dayStart);
        const secondBandEnd = buildDateTime(dayStart, config.nightStart);

        const chunkEnd = new Date(Math.min(segment.end.getTime(), nextDay.getTime()));
        const isSundayOrHoliday = dayStart.getDay() === 0 || holidaySet.has(toDateKey(dayStart));

        const pieces = [
            { start: dayStart, end: firstBandEnd, band: 'night' },
            { start: firstBandEnd, end: secondBandEnd, band: 'day' },
            { start: secondBandEnd, end: nextDay, band: 'night' },
        ];

        for (const piece of pieces) {
            const overlap = getOverlapMinutes(cursor, chunkEnd, piece.start, piece.end);
            if (!overlap) continue;
            if (isSundayOrHoliday) {
                if (piece.band === 'day') sunDay += overlap;
                else sunNight += overlap;
            } else {
                if (piece.band === 'day') day += overlap;
                else night += overlap;
            }
        }

        cursor.setTime(chunkEnd.getTime());
    }

    return { day, night, sunDay, sunNight };
}

const ZERO_BANDS = () => ({
    ordDayMinutes: 0,
    ordNightMinutes: 0,
    ordSunDayMinutes: 0,
    ordSunNightMinutes: 0,
    extDayMinutes: 0,
    extNightMinutes: 0,
    extSunDayMinutes: 0,
    extSunNightMinutes: 0,
});

/**
 * Calcula el devengado en pesos para un empleado a partir de las 8 bandas
 * y el perfil de nómina. Aplica recargos sobre la hora ordinaria base.
 * Retorna null si no hay perfil cargado.
 */
function computePayInPesos(summaryItem, profile, config) {
    if (!profile) return null;
    const salary = Number(profile.salaryMonthly) || 0;
    if (salary <= 0) return null;
    const divisor = config.monthlyHourDivisor || 220;
    const valueHour = salary / divisor;
    const round = (n) => Math.round(n);

    const bands = [
        { key: 'ordDay',     hours: summaryItem.ordDayHours,     factor: 1 },
        { key: 'ordNight',   hours: summaryItem.ordNightHours,   factor: 1 + (config.surchargeNight || 0) },
        { key: 'ordSunDay',  hours: summaryItem.ordSunDayHours,  factor: 1 + (config.surchargeSundayDay || 0) },
        { key: 'ordSunNight',hours: summaryItem.ordSunNightHours,factor: 1 + (config.surchargeSundayNight || 0) },
        { key: 'extDay',     hours: summaryItem.extDayHours,     factor: 1 + (config.overtimeDay || 0) },
        { key: 'extNight',   hours: summaryItem.extNightHours,   factor: 1 + (config.overtimeNight || 0) },
        { key: 'extSunDay',  hours: summaryItem.extSunDayHours,  factor: 1 + (config.overtimeSundayDay || 0) },
        { key: 'extSunNight',hours: summaryItem.extSunNightHours,factor: 1 + (config.overtimeSundayNight || 0) },
    ];

    const breakdown = {};
    let total = 0;
    for (const b of bands) {
        const amount = round(valueHour * (b.hours || 0) * b.factor);
        breakdown[`${b.key}Pay`] = amount;
        total += amount;
    }

    const monthlyBonus = Number(profile.monthlyBonus) || 0;
    // Bono fijo prorrateado a quincena (15/30 de mes)
    const proratedBonus = round(monthlyBonus / 2);

    return {
        salaryMonthly: salary,
        valueHour: round(valueHour),
        ...breakdown,
        bonusPay: proratedBonus,
        totalPay: total + proratedBonus,
    };
}

function incrementReasonCounter(counter, reason) {
    if (!reason) return;
    counter[reason] = (counter[reason] || 0) + 1;
}

async function loadPayrollConfig() {
    const row = await prisma.systemSettings.findUnique({
        where: { key: 'attendance_payroll_config' },
    }).catch(() => null);

    const raw = (row && typeof row.value === 'object' && row.value) ? row.value : {};
    const num = (key) => (typeof raw[key] === 'number' && !Number.isNaN(raw[key])) ? raw[key] : DEFAULT_CONFIG[key];
    return {
        dayStart: typeof raw.dayStart === 'string' ? raw.dayStart : DEFAULT_CONFIG.dayStart,
        nightStart: typeof raw.nightStart === 'string' ? raw.nightStart : DEFAULT_CONFIG.nightStart,
        fortnightCutoffDay: Number.isInteger(raw.fortnightCutoffDay)
            ? raw.fortnightCutoffDay
            : DEFAULT_CONFIG.fortnightCutoffDay,
        weeklyHours: num('weeklyHours'),
        monthlyHourDivisor: num('monthlyHourDivisor'),
        surchargeNight: num('surchargeNight'),
        surchargeSundayDay: num('surchargeSundayDay'),
        surchargeSundayNight: num('surchargeSundayNight'),
        overtimeDay: num('overtimeDay'),
        overtimeNight: num('overtimeNight'),
        overtimeSundayDay: num('overtimeSundayDay'),
        overtimeSundayNight: num('overtimeSundayNight'),
    };
}

function resolvePeriod({ periodType = 'fortnight', anchorDate, from, to, config }) {
    if (periodType === 'custom') {
        if (!from || !to) throw new Error('Para periodo personalizado debes enviar from y to.');
        const start = startOfDay(new Date(from));
        const end = endOfDay(new Date(to));
        return {
            periodType,
            from: start,
            to: end,
            label: `${toDateKey(start)} a ${toDateKey(end)}`,
        };
    }

    const anchor = anchorDate ? new Date(`${anchorDate}T12:00:00`) : new Date();
    if (Number.isNaN(anchor.getTime())) throw new Error('anchorDate invalida.');

    if (periodType === 'month') {
        const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
        return {
            periodType,
            from: start,
            to: end,
            label: `${anchor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`,
        };
    }

    const cutoff = config.fortnightCutoffDay || 15;
    const day = anchor.getDate();
    if (day <= cutoff) {
        const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const end = new Date(anchor.getFullYear(), anchor.getMonth(), cutoff, 23, 59, 59, 999);
        return {
            periodType: 'fortnight',
            from: start,
            to: end,
            label: `1 al ${cutoff} de ${anchor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`,
        };
    }

    const start = new Date(anchor.getFullYear(), anchor.getMonth(), cutoff + 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
        periodType: 'fortnight',
        from: start,
        to: end,
        label: `${cutoff + 1} al ${end.getDate()} de ${anchor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`,
    };
}

function buildWeekAssignmentMap(weeks) {
    const map = new Map();
    for (const week of weeks) {
        const weekKey = toDateKey(week.weekStart);
        for (const assignment of week.assignments || []) {
            map.set(`${assignment.employeeId}:${weekKey}`, assignment);
        }
    }
    return map;
}

function ensureDayRow(dayMap, dateKey) {
    if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, {
            date: dateKey,
            shiftCode: null,
            shiftName: null,
            scheduledStart: null,
            scheduledEnd: null,
            scheduledMinutes: 0,
            workedMinutes: 0,
            ordinaryMinutes: 0,
            overtimeDayMinutes: 0,
            overtimeNightMinutes: 0,
            ...ZERO_BANDS(),
            isHoliday: false,
            holidayName: null,
            absenceReason: null,
            present: false,
        });
    }
    return dayMap.get(dateKey);
}

function addWorkedMinutesToCalendarDays(interval, dayMap) {
    let cursor = new Date(interval.start);
    while (cursor < interval.end) {
        const dayStart = startOfDay(cursor);
        const nextDay = addDays(dayStart, 1);
        const chunkEnd = new Date(Math.min(nextDay.getTime(), interval.end.getTime()));
        const key = toDateKey(dayStart);
        const row = ensureDayRow(dayMap, key);
        row.workedMinutes += Math.round((chunkEnd.getTime() - cursor.getTime()) / 60000);
        row.present = true;
        cursor = chunkEnd;
    }
}

function addBandedSegmentToDays(segment, dayMap, config, holidaySet, kind /* 'ord' | 'ext' */) {
    let cursor = new Date(segment.start);
    while (cursor < segment.end) {
        const dayStart = startOfDay(cursor);
        const nextDay = addDays(dayStart, 1);
        const chunkEnd = new Date(Math.min(nextDay.getTime(), segment.end.getTime()));
        const key = toDateKey(dayStart);
        const row = ensureDayRow(dayMap, key);
        row.present = true;

        const allocation = allocateMinutesByBand({ start: cursor, end: chunkEnd }, config, holidaySet);
        if (kind === 'ord') {
            row.ordDayMinutes += allocation.day;
            row.ordNightMinutes += allocation.night;
            row.ordSunDayMinutes += allocation.sunDay;
            row.ordSunNightMinutes += allocation.sunNight;
        } else {
            row.extDayMinutes += allocation.day;
            row.extNightMinutes += allocation.night;
            row.extSunDayMinutes += allocation.sunDay;
            row.extSunNightMinutes += allocation.sunNight;
            // Mantener campos legacy para compatibilidad con consumidores existentes
            row.overtimeDayMinutes += allocation.day + allocation.sunDay;
            row.overtimeNightMinutes += allocation.night + allocation.sunNight;
        }
        cursor = chunkEnd;
    }
}

function addOrdinarySegmentToDays(segment, dayMap, config, holidaySet) {
    addBandedSegmentToDays(segment, dayMap, config, holidaySet, 'ord');
}

function addExtraSegmentToDays(segment, dayMap, config, holidaySet) {
    addBandedSegmentToDays(segment, dayMap, config, holidaySet, 'ext');
}

function finalizeEmployeeSummary(employee, dayRows, reasonCounter) {
    const orderedDays = [...dayRows.values()].sort((a, b) => a.date.localeCompare(b.date));

    let scheduledMinutes = 0;
    let workedMinutes = 0;
    let scheduledDays = 0;
    let presentDays = 0;
    let absenceDays = 0;
    const totals = ZERO_BANDS();

    for (const row of orderedDays) {
        scheduledMinutes += row.scheduledMinutes;
        workedMinutes += row.workedMinutes;
        for (const k of Object.keys(totals)) totals[k] += row[k] || 0;
        if (row.scheduledMinutes > 0) scheduledDays++;
        if (row.present) presentDays++;
        if (row.absenceReason) absenceDays++;
    }

    const ordinaryMinutes = totals.ordDayMinutes + totals.ordNightMinutes
        + totals.ordSunDayMinutes + totals.ordSunNightMinutes;
    const overtimeDayMinutes = totals.extDayMinutes + totals.extSunDayMinutes;
    const overtimeNightMinutes = totals.extNightMinutes + totals.extSunNightMinutes;
    const overtimeMinutes = overtimeDayMinutes + overtimeNightMinutes;

    const workedPct = scheduledMinutes > 0 ? +((workedMinutes / scheduledMinutes) * 100).toFixed(1) : 0;
    const attendancePct = scheduledDays > 0 ? +((presentDays / scheduledDays) * 100).toFixed(1) : 0;
    const absencePct = scheduledDays > 0 ? +((absenceDays / scheduledDays) * 100).toFixed(1) : 0;

    const h = (min) => +(min / 60).toFixed(2);

    return {
        employee: {
            id: employee.id,
            name: employee.name,
            area: employee.area,
            role: employee.role,
            cedula: employee.cedula,
        },
        scheduledDays,
        presentDays,
        absenceDays,
        scheduledHours: h(scheduledMinutes),
        workedHours: h(workedMinutes),
        ordinaryHours: h(ordinaryMinutes),
        overtimeHours: h(overtimeMinutes),
        overtimeDayHours: h(overtimeDayMinutes),
        overtimeNightHours: h(overtimeNightMinutes),
        // 8 bandas legales
        ordDayHours: h(totals.ordDayMinutes),
        ordNightHours: h(totals.ordNightMinutes),
        ordSunDayHours: h(totals.ordSunDayMinutes),
        ordSunNightHours: h(totals.ordSunNightMinutes),
        extDayHours: h(totals.extDayMinutes),
        extNightHours: h(totals.extNightMinutes),
        extSunDayHours: h(totals.extSunDayMinutes),
        extSunNightHours: h(totals.extSunNightMinutes),
        workedPct,
        attendancePct,
        absencePct,
        absenceBreakdown: reasonCounter,
        days: orderedDays.map((row) => ({
            ...row,
            scheduledHours: h(row.scheduledMinutes),
            workedHours: h(row.workedMinutes),
            ordinaryHours: h(row.ordinaryMinutes),
            overtimeDayHours: h(row.overtimeDayMinutes),
            overtimeNightHours: h(row.overtimeNightMinutes),
            ordDayHours: h(row.ordDayMinutes),
            ordNightHours: h(row.ordNightMinutes),
            ordSunDayHours: h(row.ordSunDayMinutes),
            ordSunNightHours: h(row.ordSunNightMinutes),
            extDayHours: h(row.extDayMinutes),
            extNightHours: h(row.extNightMinutes),
            extSunDayHours: h(row.extSunDayMinutes),
            extSunNightHours: h(row.extSunNightMinutes),
        })),
    };
}

async function getLaborSummary({
    periodType = 'fortnight',
    anchorDate,
    from,
    to,
    employeeId,
    area,
}) {
    const config = await loadPayrollConfig();
    const period = resolvePeriod({ periodType, anchorDate, from, to, config });
    const calendarDays = enumerateDays(period.from, period.to);
    const weekStarts = [...new Set(calendarDays.map((day) => toDateKey(getScheduleWeekMonday(day))))];

    const employeeWhere = {
        active: true,
        ...(employeeId ? { id: employeeId } : {}),
        ...(area ? { area } : {}),
    };

    const employees = await prisma.shiftEmployee.findMany({
        where: employeeWhere,
        orderBy: [{ area: 'asc' }, { name: 'asc' }],
    });

    if (!employees.length) {
        return {
            period: {
                type: period.periodType,
                label: period.label,
                from: toDateKey(period.from),
                to: toDateKey(period.to),
            },
            config,
            summary: [],
            detail: null,
        };
    }

    const employeeIds = employees.map((employee) => employee.id);

    // Query weeks by range instead of exact `in` lookup. Avoids timezone-sensitive
    // matching (`weekStart` is stored as Colombia-midnight UTC, but local Date()
    // construction in Node was producing different UTC instants → no match → 0 hours).
    // We compare by date keys (YYYY-MM-DD) after fetch.
    const weekStartsSet = new Set(weekStarts);
    const earliestKey = [...weekStartsSet].sort()[0];
    const latestKey = [...weekStartsSet].sort().slice(-1)[0];
    const earliest = earliestKey ? new Date(`${earliestKey}T00:00:00.000-05:00`) : period.from;
    const latest = latestKey ? new Date(`${latestKey}T23:59:59.999-05:00`) : period.to;

    const [shiftDefs, weeks, absences, records, overtimeApprovals, holidays, payrollProfiles] = await Promise.all([
        prisma.shiftScheduleDefinition.findMany({ where: { active: true } }),
        prisma.shiftWeek.findMany({
            where: { weekStart: { gte: earliest, lte: latest } },
            include: {
                assignments: {
                    where: { employeeId: { in: employeeIds } },
                },
            },
        }),
        prisma.shiftAbsence.findMany({
            where: {
                employeeId: { in: employeeIds },
                startDate: { lte: period.to },
                endDate: { gte: period.from },
            },
            orderBy: { startDate: 'asc' },
        }),
        prisma.attendanceRecord.findMany({
            where: {
                employeeId: { in: employeeIds },
                timestamp: {
                    gte: addDays(period.from, -1),
                    lte: addDays(period.to, 1),
                },
            },
            orderBy: { timestamp: 'asc' },
        }),
        prisma.overtimeApproval.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: { gte: period.from, lte: period.to },
            },
        }),
        prisma.payrollHoliday.findMany({
            where: { date: { gte: period.from, lte: period.to } },
        }),
        prisma.employeePayrollProfile.findMany({
            where: { employeeId: { in: employeeIds }, active: true },
        }),
    ]);

    // PayrollHoliday.date es DATE en Postgres; viene como YYYY-MM-DDT00:00:00Z.
    // Tomamos la fecha en UTC para evitar que la zona horaria local la corra al día anterior.
    const holidayKey = (d) => new Date(d).toISOString().substring(0, 10);
    const holidaySet = new Set(holidays.map((h) => holidayKey(h.date)));
    const holidayNameMap = new Map(holidays.map((h) => [holidayKey(h.date), h.name]));
    const shiftDefMap = Object.fromEntries(shiftDefs.map((def) => [def.code, def]));
    const assignmentMap = buildWeekAssignmentMap(weeks);
    const profilesByEmployee = new Map(
        (payrollProfiles || []).map((p) => [p.employeeId, {
            ...p,
            salaryMonthly: Number(p.salaryMonthly),
            monthlyBonus: Number(p.monthlyBonus),
        }])
    );
    const recordsByEmployee = new Map();
    const absencesByEmployee = new Map();
    const approvalsByEmployee = new Map();

    for (const record of records) {
        if (!recordsByEmployee.has(record.employeeId)) recordsByEmployee.set(record.employeeId, []);
        recordsByEmployee.get(record.employeeId).push(record);
    }

    for (const absence of absences) {
        if (!absencesByEmployee.has(absence.employeeId)) absencesByEmployee.set(absence.employeeId, []);
        absencesByEmployee.get(absence.employeeId).push(absence);
    }

    for (const approval of overtimeApprovals) {
        if (!approvalsByEmployee.has(approval.employeeId)) approvalsByEmployee.set(approval.employeeId, []);
        approvalsByEmployee.get(approval.employeeId).push(approval);
    }

    const summary = employees.map((employee) => {
        const dayMap = new Map();
        const reasonCounter = {};
        const employeeAbsences = absencesByEmployee.get(employee.id) || [];
        const employeeRecords = recordsByEmployee.get(employee.id) || [];
        const rawIntervals = buildWorkedIntervals(employeeRecords, period.to);
        // Clip intervals to the reporting period. Records are loaded with ±1 day
        // of padding to handle night shifts that cross midnight, but only the
        // portion of work that lies inside [period.from, period.to] should count.
        const workedIntervals = rawIntervals
            .map((iv) => {
                const start = new Date(Math.max(iv.start.getTime(), period.from.getTime()));
                const end = new Date(Math.min(iv.end.getTime(), period.to.getTime()));
                return end > start ? { start, end } : null;
            })
            .filter(Boolean);
        const ordinarySegments = [];

        for (const day of calendarDays) {
            const dateKey = toDateKey(day);
            const row = ensureDayRow(dayMap, dateKey);
            if (holidaySet.has(dateKey)) {
                row.isHoliday = true;
                row.holidayName = holidayNameMap.get(dateKey) || null;
            }
            const scheduleWeekKey = toDateKey(getScheduleWeekMonday(day));
            const assignment = assignmentMap.get(`${employee.id}:${scheduleWeekKey}`);
            const window = assignment ? resolveShiftWindow(day, assignment.shift, shiftDefMap) : null;

            if (window) {
                row.shiftCode = window.shiftCode;
                row.shiftName = window.shiftName;
                row.scheduledStart = window.start.toISOString();
                row.scheduledEnd = window.end.toISOString();
                row.scheduledMinutes = window.scheduledMinutes;

                let ordinaryMinutes = 0;
                for (const interval of workedIntervals) {
                    const overlap = getOverlapSegment(interval.start, interval.end, window.start, window.end);
                    if (overlap) {
                        ordinarySegments.push(overlap);
                        ordinaryMinutes += Math.round((overlap.end - overlap.start) / 60000);
                    }
                }
                row.ordinaryMinutes = ordinaryMinutes;
            }

            const activeAbsence = employeeAbsences.find((absence) => {
                const absenceStart = startOfDay(absence.startDate);
                const absenceEnd = endOfDay(absence.endDate);
                return day >= absenceStart && day <= absenceEnd;
            });

            if (activeAbsence && row.scheduledMinutes > 0) {
                row.absenceReason = activeAbsence.reason;
                incrementReasonCounter(reasonCounter, activeAbsence.reason);
            }
        }

        // Repartir SEGMENTOS ORDINARIOS en 4 bandas (ordDay/ordNight/ordSunDay/ordSunNight)
        for (const ord of ordinarySegments) {
            addOrdinarySegmentToDays(ord, dayMap, config, holidaySet);
        }

        for (const interval of workedIntervals) {
            addWorkedMinutesToCalendarDays(interval, dayMap);
            const extras = subtractSegments(interval, ordinarySegments);
            for (const extra of extras) addExtraSegmentToDays(extra, dayMap, config, holidaySet);
        }

        // Add manually-approved overtime hours to the corresponding day rows.
        // Hoy OvertimeApproval solo guarda dayHours/nightHours; las repartimos
        // a las bandas extras laborables. Si más adelante agregamos campos
        // sundayDayHours/sundayNightHours, se enrutan a extSun*.
        const employeeApprovals = approvalsByEmployee.get(employee.id) || [];
        for (const approval of employeeApprovals) {
            const dateKey = toDateKey(approval.date);
            const row = ensureDayRow(dayMap, dateKey);
            const dayMin = Math.round((approval.dayHours || 0) * 60);
            const nightMin = Math.round((approval.nightHours || 0) * 60);
            if (row.isHoliday || new Date(`${dateKey}T12:00:00`).getDay() === 0) {
                row.extSunDayMinutes += dayMin;
                row.extSunNightMinutes += nightMin;
            } else {
                row.extDayMinutes += dayMin;
                row.extNightMinutes += nightMin;
            }
            row.overtimeDayMinutes += dayMin;
            row.overtimeNightMinutes += nightMin;
        }

        return finalizeEmployeeSummary(employee, dayMap, reasonCounter);
    });

    const detail = employeeId
        ? summary.find((item) => item.employee.id === employeeId) || null
        : null;

    return {
        period: {
            type: period.periodType,
            label: period.label,
            from: toDateKey(period.from),
            to: toDateKey(period.to),
        },
        config,
        holidays: holidays.map((h) => ({ date: holidayKey(h.date), name: h.name })),
        summary: summary.map((item) => {
            const profile = profilesByEmployee.get(item.employee.id);
            const pay = computePayInPesos(item, profile, config);
            return {
                employee: item.employee,
                scheduledDays: item.scheduledDays,
                presentDays: item.presentDays,
                absenceDays: item.absenceDays,
                scheduledHours: item.scheduledHours,
                workedHours: item.workedHours,
                ordinaryHours: item.ordinaryHours,
                overtimeHours: item.overtimeHours,
                overtimeDayHours: item.overtimeDayHours,
                overtimeNightHours: item.overtimeNightHours,
                // 8 bandas legales (CST + Ley 2466/2025)
                ordDayHours: item.ordDayHours,
                ordNightHours: item.ordNightHours,
                ordSunDayHours: item.ordSunDayHours,
                ordSunNightHours: item.ordSunNightHours,
                extDayHours: item.extDayHours,
                extNightHours: item.extNightHours,
                extSunDayHours: item.extSunDayHours,
                extSunNightHours: item.extSunNightHours,
                workedPct: item.workedPct,
                attendancePct: item.attendancePct,
                absencePct: item.absencePct,
                absenceBreakdown: item.absenceBreakdown,
                pay, // null si no hay perfil; objeto con pesos si hay salario
            };
        }),
        detail,
    };
}

module.exports = {
    getLaborSummary,
};
