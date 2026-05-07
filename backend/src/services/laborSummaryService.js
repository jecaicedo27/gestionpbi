const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Configuración por defecto alineada al CST + Ley 2466/2025 vigente y
// Ley 100/1993 (seguridad social) + Ley 21/1982 (parafiscales) + Art. 114-1 ET (exoneraciones).
// nightStart = 19:00 desde el 26-dic-2025 (transición de la reforma laboral).
// Porcentajes son recargos sobre la hora ordinaria (sin contar el 100% base).
const DEFAULT_CONFIG = {
    // Bandas y jornada
    dayStart: '06:00',
    nightStart: '19:00',
    fortnightCutoffDay: 15,
    weeklyHours: 44,            // baja a 42 desde 15-jul-2026
    monthlyHourDivisor: 220,    // = weeklyHours × 5; sube a 230 con 42h/sem
    // Recargos sobre hora ordinaria (CST Art. 168 + Ley 2466/2025)
    surchargeNight: 0.35,
    surchargeSundayDay: 0.80,   // sube a 0.90 jul-2026, 1.00 jul-2027
    surchargeSundayNight: 1.15,
    overtimeDay: 0.25,
    overtimeNight: 0.75,
    overtimeSundayDay: 1.05,
    overtimeSundayNight: 1.55,
    // Valores legales 2026 (Decretos 1469 y 1470 de 29-dic-2025)
    smmlv: 1_750_905,                       // Decreto 1469/2025 — SMMLV 2026
    transportAllowance: 249_095,            // Decreto 1470/2025 — auxilio transporte 2026
    transportAllowanceThresholdSMMLV: 2,    // aplica si gana <= 2 SMMLV
    // Deducciones del empleado (Ley 100/1993)
    healthEmployeePct: 0.04,                // EPS 4%
    pensionEmployeePct: 0.04,               // AFP 4%
    // Aportes patronales (Ley 100 + Ley 21/1982)
    healthEmployerPct: 0.085,               // 8.5% (0% si art114Exonerated y empleado <= 10 SMMLV)
    pensionEmployerPct: 0.12,               // 12%
    arlPct: 0.01044,                        // ARL clase II default; ajustable
    ccfPct: 0.04,                           // Caja de Compensación
    icbfPct: 0.03,                          // ICBF (0% si art114Exonerated y empleado <= 10 SMMLV)
    senaPct: 0.02,                          // SENA (0% si art114Exonerated y empleado <= 10 SMMLV)
    art114Exonerated: true,                 // Art. 114-1 ET: exonera salud, ICBF, SENA para empleados <10 SMMLV
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

// Tiempo máximo de un intervalo abierto antes de considerarlo "olvido de marcar EXIT".
// 12 horas cubre cualquier turno legal (jornada máx 9h + 2h extras + buffer).
const MAX_OPEN_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Mínimo entre dos ENTRY consecutivos para tratarlos como eventos distintos.
// Por debajo de esto, se considera spam de marcación (segundo ENTRY descartado).
const ENTRY_SPAM_THRESHOLD_MS = 5 * 60 * 1000;

// Ventana después de un EXIT en la que un nuevo ENTRY se considera re-pulso del
// kiosko (no un re-ingreso real). 30 min cubre verificaciones por cara/PIN
// posteriores a la salida que en operación NO representan trabajo continuado.
const POST_EXIT_REPULSE_MS = 30 * 60 * 1000;

// Política Popping (acuerdo con el usuario): el descanso de DESAYUNO (subtype=BREAK)
// hasta 20 min se considera tiempo trabajado (no se descuenta). El ALMUERZO
// (subtype=LUNCH) y cualquier otra salida >20 min sí se descuentan.
// 20 min = 15 min reales + buffer de tolerancia de marcación.
const BREAK_PAID_MAX_MS = 20 * 60 * 1000;

function buildWorkedIntervals(records, fallbackEnd, opts = {}) {
    const isCurrentlyInPlant = !!opts.isInPlant;
    const ordered = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const intervals = [];
    let currentEntry = null;
    let lastExit = null;

    for (let i = 0; i < ordered.length; i++) {
        const record = ordered[i];
        const ts = new Date(record.timestamp);
        if (record.type === 'ENTRY') {
            // Re-pulso post-EXIT: si entró antes de 30 min después del último EXIT
            // y no hay un EXIT explícito siguiente, lo descartamos como spam del kiosko.
            if (!currentEntry && lastExit) {
                const sincePrevExit = ts.getTime() - lastExit.getTime();
                if (sincePrevExit >= 0 && sincePrevExit < POST_EXIT_REPULSE_MS) {
                    // Solo lo descartamos si NO hay EXIT más adelante en este record set.
                    const nextExit = ordered.slice(i + 1).find((r) => r.type === 'EXIT' && new Date(r.timestamp) > ts);
                    if (!nextExit) continue;
                }
            }
            if (currentEntry) {
                // Ya hay un ENTRY abierto. Tres opciones:
                //  1. Si delta < 5 min → spam de marcación, ignoramos el segundo ENTRY.
                //  2. Si delta razonable → operario olvidó marcar EXIT; cerramos
                //     el intervalo previo en este timestamp y abrimos uno nuevo.
                //  3. Si delta excede el máx (12h) → el ENTRY anterior es huérfano
                //     viejo, lo descartamos y abrimos un nuevo intervalo.
                const delta = ts.getTime() - currentEntry.getTime();
                if (delta < ENTRY_SPAM_THRESHOLD_MS) {
                    continue; // spam, mantener currentEntry
                }
                if (delta <= MAX_OPEN_INTERVAL_MS) {
                    intervals.push({ start: currentEntry, end: ts });
                }
                currentEntry = ts;
                continue;
            }
            currentEntry = ts;
            continue;
        }

        if (record.type === 'EXIT' && currentEntry && ts > currentEntry) {
            // Política Popping: el desayuno (subtype BREAK) ≤ 20 min se considera
            // tiempo trabajado. Si vemos EXIT BREAK seguido de un ENTRY dentro de
            // 20 min, NO cerramos el intervalo y saltamos el ENTRY de regreso —
            // el operario "estuvo descansando pero pago".
            if (record.subtype === 'BREAK') {
                const next = ordered[i + 1];
                if (next && next.type === 'ENTRY') {
                    const nextTs = new Date(next.timestamp);
                    if (nextTs.getTime() - ts.getTime() <= BREAK_PAID_MAX_MS) {
                        i++; // saltar el ENTRY de regreso, intervalo continúa
                        continue;
                    }
                }
            }
            intervals.push({ start: currentEntry, end: ts });
            currentEntry = null;
            lastExit = ts;
        }
    }

    // Manejo del ENTRY abierto al final de los records (sin EXIT correspondiente).
    if (currentEntry && fallbackEnd) {
        const now = new Date();
        const periodCap = new Date(Math.min(new Date(fallbackEnd).getTime(), now.getTime()));

        // Si ya hubo un EXIT en el MISMO día calendario (Colombia) que este ENTRY,
        // el operario ya cerró su jornada del día → descartamos el ENTRY huérfano
        // (es ruido del kiosko, no un re-ingreso real).
        const sameDayExit = lastExit
            && toDateKey(lastExit) === toDateKey(currentEntry)
            && lastExit < currentEntry;

        if (sameDayExit) {
            // No agregamos nada — el ENTRY huérfano post-EXIT del mismo día se ignora.
        } else {
            // Política: solo extender hasta `now` si el operario sigue marcado en planta.
            // Si no, capeamos al máximo razonable (12h después del ENTRY) para evitar
            // que un olvido de marcar EXIT genere horas fantasma.
            const maxCap = new Date(currentEntry.getTime() + MAX_OPEN_INTERVAL_MS);
            const cap = isCurrentlyInPlant
                ? new Date(Math.min(periodCap.getTime(), maxCap.getTime()))
                : new Date(Math.min(currentEntry.getTime() + 60 * 1000, periodCap.getTime()));
            if (cap > currentEntry) {
                intervals.push({ start: currentEntry, end: cap });
            }
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
 * Calcula el devengado completo en pesos según CST + Ley 100/1993 + Ley 21/1982 + Art. 114-1 ET.
 *
 * Devuelve:
 *  - Salario ordinario (suma de las 4 bandas ordinarias + dom/fest)
 *  - Horas extras ($ y horas)
 *  - Auxilio de transporte (aplica si gana <= N SMMLV y profile.transportAllowance=true)
 *  - Devengado bruto = ordinario + extras + auxilio + bono
 *  - Deducciones empleado (salud 4% + pensión 4%)
 *  - Neto a pagar = bruto - deducciones
 *  - Aportes patronales (salud, pensión, ARL, CCF, ICBF, SENA con exoneraciones aplicadas)
 *  - Costo total empresa = bruto + aportes patronales
 */
function computePayInPesos(summaryItem, profile, config) {
    if (!profile) return null;
    const salary = Number(profile.salaryMonthly) || 0;
    if (salary <= 0) return null;
    const divisor = config.monthlyHourDivisor || 220;
    const valueHour = salary / divisor;
    const round = (n) => Math.round(n);

    // ── 1) Bandas horarias × valor hora × factor de recargo ──
    const ordinaryBands = [
        { key: 'ordDay',     hours: summaryItem.ordDayHours,     factor: 1 },
        { key: 'ordNight',   hours: summaryItem.ordNightHours,   factor: 1 + (config.surchargeNight || 0) },
        { key: 'ordSunDay',  hours: summaryItem.ordSunDayHours,  factor: 1 + (config.surchargeSundayDay || 0) },
        { key: 'ordSunNight',hours: summaryItem.ordSunNightHours,factor: 1 + (config.surchargeSundayNight || 0) },
    ];
    // Extras autorizadas = se pagan
    const overtimeBandsAuth = [
        { key: 'extDay',     hours: summaryItem.extDayHoursAuth,     factor: 1 + (config.overtimeDay || 0) },
        { key: 'extNight',   hours: summaryItem.extNightHoursAuth,   factor: 1 + (config.overtimeNight || 0) },
        { key: 'extSunDay',  hours: summaryItem.extSunDayHoursAuth,  factor: 1 + (config.overtimeSundayDay || 0) },
        { key: 'extSunNight',hours: summaryItem.extSunNightHoursAuth,factor: 1 + (config.overtimeSundayNight || 0) },
    ];
    // Extras pendientes = NO se pagan, solo informativo (cuánto se pagaría si se aprueban)
    const overtimeBandsPending = [
        { key: 'extDay',     hours: summaryItem.extDayHoursPending,     factor: 1 + (config.overtimeDay || 0) },
        { key: 'extNight',   hours: summaryItem.extNightHoursPending,   factor: 1 + (config.overtimeNight || 0) },
        { key: 'extSunDay',  hours: summaryItem.extSunDayHoursPending,  factor: 1 + (config.overtimeSundayDay || 0) },
        { key: 'extSunNight',hours: summaryItem.extSunNightHoursPending,factor: 1 + (config.overtimeSundayNight || 0) },
    ];

    const breakdown = {};
    let ordinaryPay = 0;
    let overtimePay = 0;          // pago real (autorizadas)
    let overtimePendingPay = 0;   // potencial (informativo)
    let overtimeHours = 0;
    for (const b of ordinaryBands) {
        const amount = round(valueHour * (b.hours || 0) * b.factor);
        breakdown[`${b.key}Pay`] = amount;
        ordinaryPay += amount;
    }
    for (const b of overtimeBandsAuth) {
        const amount = round(valueHour * (b.hours || 0) * b.factor);
        breakdown[`${b.key}Pay`] = amount;     // se mantiene este nombre (compat) — solo autorizadas
        overtimePay += amount;
        overtimeHours += (b.hours || 0);
    }
    for (const b of overtimeBandsPending) {
        const amount = round(valueHour * (b.hours || 0) * b.factor);
        breakdown[`${b.key}PayPending`] = amount;
        overtimePendingPay += amount;
    }

    // ── 2) Bono fijo prorrateado quincenal ──
    const monthlyBonus = Number(profile.monthlyBonus) || 0;
    const proratedBonus = round(monthlyBonus / 2);

    // ── 3) Auxilio de transporte (Decreto 1573/2025) ──
    // Aplica si: profile.transportAllowance=true Y salario <= N × SMMLV.
    // No es factor salarial → NO suma al IBC.
    const smmlv = config.smmlv || 1_423_500;
    const threshold = (config.transportAllowanceThresholdSMMLV || 2) * smmlv;
    const aplicaAux = !!profile.transportAllowance && salary <= threshold;
    const transportAllowanceMonthly = aplicaAux ? (config.transportAllowance || 0) : 0;
    const transportAllowance = round(transportAllowanceMonthly / 2); // prorrateado quincena

    // ── 4) Devengado bruto ──
    const grossPay = ordinaryPay + overtimePay + proratedBonus + transportAllowance;

    // ── 5) IBC (Ingreso Base de Cotización) — Art. 17 Ley 100/1993 ──
    // IBC = salario base + bonos salariales. NO incluye aux. transporte.
    // Para quincena: salario_mensual / 2 + bono_prorrateado.
    // Para deducciones del empleado y aportes patronales se usa el IBC.
    const ibcQ = round(salary / 2) + proratedBonus;

    // ── 6) Deducciones del empleado (Ley 100/1993) ──
    const healthEmployee = round(ibcQ * (config.healthEmployeePct || 0.04));
    const pensionEmployee = round(ibcQ * (config.pensionEmployeePct || 0.04));
    const totalDeductions = healthEmployee + pensionEmployee;

    // ── 7) Neto a pagar (lo que se gira al empleado) ──
    const netPay = grossPay - totalDeductions;

    // ── 8) Aportes patronales — Ley 100 + Ley 21/1982 + Art. 114-1 ET ──
    // Exoneración: si art114Exonerated=true Y empleado gana <= 10 SMMLV,
    // empresa NO paga salud, ICBF ni SENA por ese empleado.
    const exonerated = !!config.art114Exonerated && salary <= (10 * smmlv);
    const healthEmployer = exonerated ? 0 : round(ibcQ * (config.healthEmployerPct || 0.085));
    const pensionEmployer = round(ibcQ * (config.pensionEmployerPct || 0.12));
    const arl = round(ibcQ * (config.arlPct || 0.01044));
    const ccf = round(ibcQ * (config.ccfPct || 0.04));
    const icbf = exonerated ? 0 : round(ibcQ * (config.icbfPct || 0.03));
    const sena = exonerated ? 0 : round(ibcQ * (config.senaPct || 0.02));
    const totalEmployerContrib = healthEmployer + pensionEmployer + arl + ccf + icbf + sena;

    // ── 9) Costo total para la empresa ──
    const totalEmployerCost = grossPay + totalEmployerContrib;

    return {
        salaryMonthly: salary,
        valueHour: round(valueHour),
        ibcQ,
        // Por banda
        ...breakdown,
        // Subtotales
        ordinaryPay,         // ord día + noche + dom día + dom noche (todas las "ordinarias" del CST)
        overtimePay,         // las 4 extras AUTORIZADAS (se pagan)
        overtimeHours: +overtimeHours.toFixed(2), // horas autorizadas
        overtimePendingPay,  // pesos potenciales si se aprueban las pendientes
        overtimePendingHours: summaryItem.overtimePendingHours || 0,
        bonusPay: proratedBonus,
        transportAllowance,
        // Bruto
        grossPay,
        // Deducciones empleado
        healthEmployee,
        pensionEmployee,
        totalDeductions,
        // Neto
        netPay,
        // Aportes patronales
        healthEmployer,
        pensionEmployer,
        arl,
        ccf,
        icbf,
        sena,
        totalEmployerContrib,
        exonerated,
        // Costo empresa total
        totalEmployerCost,
        // Mantener compat (campo viejo que usa el reporte actual)
        totalPay: grossPay,
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
    const bool = (key) => (typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_CONFIG[key]);
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
        smmlv: num('smmlv'),
        transportAllowance: num('transportAllowance'),
        transportAllowanceThresholdSMMLV: num('transportAllowanceThresholdSMMLV'),
        healthEmployeePct: num('healthEmployeePct'),
        pensionEmployeePct: num('pensionEmployeePct'),
        healthEmployerPct: num('healthEmployerPct'),
        pensionEmployerPct: num('pensionEmployerPct'),
        arlPct: num('arlPct'),
        ccfPct: num('ccfPct'),
        icbfPct: num('icbfPct'),
        senaPct: num('senaPct'),
        art114Exonerated: bool('art114Exonerated'),
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
    // Extras separadas SOLO por approval real:
    //   AUTH    = hay approval APPROVED ese día → se paga
    //   PENDING = todo lo demás (PENDING en BD o sin approval registrada) → admin debe aprobar
    const totalsAuth = { extDayMinutes: 0, extNightMinutes: 0, extSunDayMinutes: 0, extSunNightMinutes: 0 };
    const totalsPending = { extDayMinutes: 0, extNightMinutes: 0, extSunDayMinutes: 0, extSunNightMinutes: 0 };

    for (const row of orderedDays) {
        scheduledMinutes += row.scheduledMinutes;
        workedMinutes += row.workedMinutes;
        for (const k of Object.keys(totals)) totals[k] += row[k] || 0;
        if (row.scheduledMinutes > 0) scheduledDays++;
        if (row.present) presentDays++;
        if (row.absenceReason) absenceDays++;
        // Solo APPROVED se paga. PENDING o sin approval = pendiente de aprobación.
        const target = row.overtimeStatus === 'APPROVED' ? totalsAuth
            : (row.overtimeStatus === 'PENDING' || row.overtimeStatus === 'UNREGISTERED') ? totalsPending
            : null;
        if (target) {
            target.extDayMinutes += row.extDayMinutes || 0;
            target.extNightMinutes += row.extNightMinutes || 0;
            target.extSunDayMinutes += row.extSunDayMinutes || 0;
            target.extSunNightMinutes += row.extSunNightMinutes || 0;
        }
    }

    const ordinaryMinutes = totals.ordDayMinutes + totals.ordNightMinutes
        + totals.ordSunDayMinutes + totals.ordSunNightMinutes;
    const overtimeDayMinutes = totals.extDayMinutes + totals.extSunDayMinutes;
    const overtimeNightMinutes = totals.extNightMinutes + totals.extSunNightMinutes;
    const overtimeMinutes = overtimeDayMinutes + overtimeNightMinutes;
    const overtimePendingMinutes = totalsPending.extDayMinutes + totalsPending.extNightMinutes
        + totalsPending.extSunDayMinutes + totalsPending.extSunNightMinutes;
    const overtimeAuthorizedMinutes = totalsAuth.extDayMinutes + totalsAuth.extNightMinutes
        + totalsAuth.extSunDayMinutes + totalsAuth.extSunNightMinutes;

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
        // 8 bandas legales (TOTALES sin distinción de aprobación)
        ordDayHours: h(totals.ordDayMinutes),
        ordNightHours: h(totals.ordNightMinutes),
        ordSunDayHours: h(totals.ordSunDayMinutes),
        ordSunNightHours: h(totals.ordSunNightMinutes),
        extDayHours: h(totals.extDayMinutes),
        extNightHours: h(totals.extNightMinutes),
        extSunDayHours: h(totals.extSunDayMinutes),
        extSunNightHours: h(totals.extSunNightMinutes),
        // Extras separadas por estado de aprobación (filtro de pago)
        extDayHoursAuth: h(totalsAuth.extDayMinutes),
        extNightHoursAuth: h(totalsAuth.extNightMinutes),
        extSunDayHoursAuth: h(totalsAuth.extSunDayMinutes),
        extSunNightHoursAuth: h(totalsAuth.extSunNightMinutes),
        extDayHoursPending: h(totalsPending.extDayMinutes),
        extNightHoursPending: h(totalsPending.extNightMinutes),
        extSunDayHoursPending: h(totalsPending.extSunDayMinutes),
        extSunNightHoursPending: h(totalsPending.extSunNightMinutes),
        overtimeAuthorizedHours: h(overtimeAuthorizedMinutes),
        overtimePendingHours: h(overtimePendingMinutes),
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
        const rawIntervals = buildWorkedIntervals(employeeRecords, period.to, { isInPlant: !!employee.isInPlant });
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

        // ── POLÍTICA DE EXTRAS (acuerdo con dueño 2026-05-06) ──
        //
        // Las marcaciones (KIOSK + HANDOVER + MANUAL) capturan TODO el tiempo
        // trabajado, incluido fuera del turno (= extras naturales). Pero las
        // extras solo se PAGAN si el ADMIN las autoriza vía OvertimeApproval
        // con status=APPROVED para esa fecha del empleado.
        //
        // Estados:
        //   - APPROVED → extras del día se pagan ✓
        //   - PENDING  → extras del día quedan en "pendiente de aprobación"
        //                (visibles, NO pagadas todavía)
        //   - REJECTED → extras del día NO se pagan
        //   - sin approval → extras quedan como "pendiente" (default seguro)
        //
        // Esto evita que se paguen extras no autorizadas y mantiene visibles
        // las pendientes para que admin las revise.
        const employeeApprovals = approvalsByEmployee.get(employee.id) || [];
        const approvedDayKeys = new Set();
        const pendingDayKeys = new Set();
        for (const approval of employeeApprovals) {
            const dateKey = holidayKey(approval.date);
            if (approval.status === 'APPROVED') approvedDayKeys.add(dateKey);
            else if (approval.status === 'PENDING' || !approval.status) pendingDayKeys.add(dateKey);
        }
        // Marcar cada day-row con su estado de autorización
        for (const [dateKey, row] of dayMap.entries()) {
            const hasExtras = (row.extDayMinutes + row.extNightMinutes
                + row.extSunDayMinutes + row.extSunNightMinutes) > 0;
            if (!hasExtras) {
                row.overtimeStatus = 'NONE';
            } else if (approvedDayKeys.has(dateKey)) {
                row.overtimeStatus = 'APPROVED';
            } else if (pendingDayKeys.has(dateKey)) {
                row.overtimeStatus = 'PENDING';
            } else {
                row.overtimeStatus = 'UNREGISTERED'; // hay extras pero sin approval creada
            }
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
                // Extras separadas por estado de aprobación
                extDayHoursAuth: item.extDayHoursAuth,
                extNightHoursAuth: item.extNightHoursAuth,
                extSunDayHoursAuth: item.extSunDayHoursAuth,
                extSunNightHoursAuth: item.extSunNightHoursAuth,
                extDayHoursPending: item.extDayHoursPending,
                extNightHoursPending: item.extNightHoursPending,
                extSunDayHoursPending: item.extSunDayHoursPending,
                extSunNightHoursPending: item.extSunNightHoursPending,
                overtimeAuthorizedHours: item.overtimeAuthorizedHours,
                overtimePendingHours: item.overtimePendingHours,
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
