const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_CONFIG = {
    dayStart: '06:00',
    nightStart: '21:00',
    fortnightCutoffDay: 15,
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

function allocateMinutesByBand(segment, config) {
    const dayStartMinutes = parseTimeToMinutes(config.dayStart);
    const nightStartMinutes = parseTimeToMinutes(config.nightStart);
    let daytime = 0;
    let nighttime = 0;

    const cursor = new Date(segment.start);
    while (cursor < segment.end) {
        const dayStart = startOfDay(cursor);
        const nextDay = addDays(dayStart, 1);
        const firstBandEnd = buildDateTime(dayStart, config.dayStart);
        const secondBandEnd = buildDateTime(dayStart, config.nightStart);

        const chunkEnd = new Date(Math.min(segment.end.getTime(), nextDay.getTime()));
        const pieces = [
            { start: dayStart, end: firstBandEnd, band: 'night' },
            { start: firstBandEnd, end: secondBandEnd, band: 'day' },
            { start: secondBandEnd, end: nextDay, band: 'night' },
        ];

        for (const piece of pieces) {
            const overlap = getOverlapMinutes(cursor, chunkEnd, piece.start, piece.end);
            if (!overlap) continue;
            if (piece.band === 'day') daytime += overlap;
            else nighttime += overlap;
        }

        cursor.setTime(chunkEnd.getTime());
    }

    return {
        daytime,
        nighttime,
        config: {
            dayStartMinutes,
            nightStartMinutes,
        },
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
    return {
        dayStart: typeof raw.dayStart === 'string' ? raw.dayStart : DEFAULT_CONFIG.dayStart,
        nightStart: typeof raw.nightStart === 'string' ? raw.nightStart : DEFAULT_CONFIG.nightStart,
        fortnightCutoffDay: Number.isInteger(raw.fortnightCutoffDay)
            ? raw.fortnightCutoffDay
            : DEFAULT_CONFIG.fortnightCutoffDay,
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

function addExtraSegmentToDays(segment, dayMap, config) {
    let cursor = new Date(segment.start);
    while (cursor < segment.end) {
        const dayStart = startOfDay(cursor);
        const nextDay = addDays(dayStart, 1);
        const chunkEnd = new Date(Math.min(nextDay.getTime(), segment.end.getTime()));
        const key = toDateKey(dayStart);
        const row = ensureDayRow(dayMap, key);
        row.present = true;

        const allocation = allocateMinutesByBand({ start: cursor, end: chunkEnd }, config);
        row.overtimeDayMinutes += allocation.daytime;
        row.overtimeNightMinutes += allocation.nighttime;
        cursor = chunkEnd;
    }
}

function finalizeEmployeeSummary(employee, dayRows, reasonCounter) {
    const orderedDays = [...dayRows.values()].sort((a, b) => a.date.localeCompare(b.date));

    let scheduledMinutes = 0;
    let workedMinutes = 0;
    let ordinaryMinutes = 0;
    let overtimeDayMinutes = 0;
    let overtimeNightMinutes = 0;
    let scheduledDays = 0;
    let presentDays = 0;
    let absenceDays = 0;

    for (const row of orderedDays) {
        scheduledMinutes += row.scheduledMinutes;
        workedMinutes += row.workedMinutes;
        ordinaryMinutes += row.ordinaryMinutes;
        overtimeDayMinutes += row.overtimeDayMinutes;
        overtimeNightMinutes += row.overtimeNightMinutes;
        if (row.scheduledMinutes > 0) scheduledDays++;
        if (row.present) presentDays++;
        if (row.absenceReason) absenceDays++;
    }

    const overtimeMinutes = overtimeDayMinutes + overtimeNightMinutes;
    const workedPct = scheduledMinutes > 0 ? +((workedMinutes / scheduledMinutes) * 100).toFixed(1) : 0;
    const attendancePct = scheduledDays > 0 ? +((presentDays / scheduledDays) * 100).toFixed(1) : 0;
    const absencePct = scheduledDays > 0 ? +((absenceDays / scheduledDays) * 100).toFixed(1) : 0;

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
        scheduledHours: +(scheduledMinutes / 60).toFixed(2),
        workedHours: +(workedMinutes / 60).toFixed(2),
        ordinaryHours: +(ordinaryMinutes / 60).toFixed(2),
        overtimeHours: +(overtimeMinutes / 60).toFixed(2),
        overtimeDayHours: +(overtimeDayMinutes / 60).toFixed(2),
        overtimeNightHours: +(overtimeNightMinutes / 60).toFixed(2),
        workedPct,
        attendancePct,
        absencePct,
        absenceBreakdown: reasonCounter,
        days: orderedDays.map((row) => ({
            ...row,
            scheduledHours: +(row.scheduledMinutes / 60).toFixed(2),
            workedHours: +(row.workedMinutes / 60).toFixed(2),
            ordinaryHours: +(row.ordinaryMinutes / 60).toFixed(2),
            overtimeDayHours: +(row.overtimeDayMinutes / 60).toFixed(2),
            overtimeNightHours: +(row.overtimeNightMinutes / 60).toFixed(2),
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

    const [shiftDefs, weeks, absences, records, overtimeApprovals] = await Promise.all([
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
    ]);

    const shiftDefMap = Object.fromEntries(shiftDefs.map((def) => [def.code, def]));
    const assignmentMap = buildWeekAssignmentMap(weeks);
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
        const workedIntervals = buildWorkedIntervals(employeeRecords, period.to);
        const ordinarySegments = [];

        for (const day of calendarDays) {
            const dateKey = toDateKey(day);
            const row = ensureDayRow(dayMap, dateKey);
            const scheduleWeekKey = toDateKey(getScheduleWeekMonday(day));
            const assignment = assignmentMap.get(`${employee.id}:${scheduleWeekKey}`);
            const window = assignment ? resolveShiftWindow(day, assignment.shift, shiftDefMap) : null;

            if (window) {
                row.shiftCode = window.shiftCode;
                row.shiftName = window.shiftName;
                row.scheduledStart = window.start.toISOString();
                row.scheduledEnd = window.end.toISOString();
                row.scheduledMinutes = window.scheduledMinutes;

                const ordinaryMinutes = workedIntervals.reduce((sum, interval) => (
                    sum + getOverlapMinutes(interval.start, interval.end, window.start, window.end)
                ), 0);
                row.ordinaryMinutes = ordinaryMinutes;

                for (const interval of workedIntervals) {
                    const overlap = getOverlapSegment(interval.start, interval.end, window.start, window.end);
                    if (overlap) ordinarySegments.push(overlap);
                }
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

        for (const interval of workedIntervals) {
            addWorkedMinutesToCalendarDays(interval, dayMap);
            const extras = subtractSegments(interval, ordinarySegments);
            for (const extra of extras) addExtraSegmentToDays(extra, dayMap, config);
        }

        // Add manually-approved overtime hours to the corresponding day rows
        const employeeApprovals = approvalsByEmployee.get(employee.id) || [];
        for (const approval of employeeApprovals) {
            const dateKey = toDateKey(approval.date);
            const row = ensureDayRow(dayMap, dateKey);
            row.overtimeDayMinutes += Math.round((approval.dayHours || 0) * 60);
            row.overtimeNightMinutes += Math.round((approval.nightHours || 0) * 60);
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
        summary: summary.map((item) => ({
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
            workedPct: item.workedPct,
            attendancePct: item.attendancePct,
            absencePct: item.absencePct,
            absenceBreakdown: item.absenceBreakdown,
        })),
        detail,
    };
}

module.exports = {
    getLaborSummary,
};
