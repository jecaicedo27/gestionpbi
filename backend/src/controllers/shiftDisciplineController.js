const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

// ── Tabla maestra cíclica del cronograma disciplinador ──────────────────────
// El ciclo es 24h con 21 BASES + 7 ALG + 7 PROT distribuidos según la regla
// "ALG cada 3 BASES estricto" sin importar el corte de turno.
// Cada turno tiene un patrón distinto (asimetría natural del ciclo).
// Se incluye un step COMIDA (15-20min) en cada turno como descanso del operario.
// `offsetMin` = minutos desde el inicio del turno (06:00, 14:00 o 22:00).

const TEMPLATE_MANANA = [
    { n: 1,  type: 'BASE',     label: 'Base Liquipops #1', offsetMin: 0,   weight: 1.0 },
    { n: 2,  type: 'BASE',     label: 'Base Liquipops #2', offsetMin: 50,  weight: 1.0 },
    { n: 3,  type: 'BASE',     label: 'Base Liquipops #3', offsetMin: 100, weight: 1.0 },
    { n: 4,  type: 'ALGINATO', label: 'Alginato #1',       offsetMin: 130, weight: 0.8 },
    { n: 5,  type: 'PROTECCION', label: 'Protección #1',   offsetMin: 145, weight: 0.7 },
    { n: 6,  type: 'BASE',     label: 'Base Liquipops #4', offsetMin: 190, weight: 1.0 },
    { n: 7,  type: 'BASE',     label: 'Base Liquipops #5', offsetMin: 240, weight: 1.0 },
    { n: 8,  type: 'COMIDA',   label: 'Almuerzo (15-20min)', offsetMin: 270, weight: 0 },
    { n: 9,  type: 'BASE',     label: 'Base Liquipops #6', offsetMin: 290, weight: 1.0 },
    { n: 10, type: 'ALGINATO', label: 'Alginato #2',       offsetMin: 320, weight: 0.8 },
    { n: 11, type: 'PROTECCION', label: 'Protección #2',   offsetMin: 335, weight: 0.7 },
    { n: 12, type: 'BASE',     label: 'Base Liquipops #7', offsetMin: 380, weight: 1.0 },
];

const TEMPLATE_TARDE = [
    { n: 1,  type: 'BASE',     label: 'Base Liquipops #1', offsetMin: 0,   weight: 1.0 },
    { n: 2,  type: 'BASE',     label: 'Base Liquipops #2', offsetMin: 50,  weight: 1.0 },
    { n: 3,  type: 'ALGINATO', label: 'Alginato #1',       offsetMin: 80,  weight: 0.8 },
    { n: 4,  type: 'PROTECCION', label: 'Protección #1',   offsetMin: 95,  weight: 0.7 },
    { n: 5,  type: 'BASE',     label: 'Base Liquipops #3', offsetMin: 140, weight: 1.0 },
    { n: 6,  type: 'BASE',     label: 'Base Liquipops #4', offsetMin: 190, weight: 1.0 },
    { n: 7,  type: 'COMIDA',   label: 'Cena (15-20min)',   offsetMin: 220, weight: 0 },
    { n: 8,  type: 'BASE',     label: 'Base Liquipops #5', offsetMin: 240, weight: 1.0 },
    { n: 9,  type: 'ALGINATO', label: 'Alginato #2',       offsetMin: 270, weight: 0.8 },
    { n: 10, type: 'PROTECCION', label: 'Protección #2',   offsetMin: 285, weight: 0.7 },
    { n: 11, type: 'BASE',     label: 'Base Liquipops #6', offsetMin: 330, weight: 1.0 },
    { n: 12, type: 'BASE',     label: 'Base Liquipops #7', offsetMin: 380, weight: 1.0 },
];

const TEMPLATE_NOCHE = [
    { n: 1,  type: 'BASE',     label: 'Base Liquipops #1', offsetMin: 0,   weight: 1.0 },
    { n: 2,  type: 'ALGINATO', label: 'Alginato #1',       offsetMin: 30,  weight: 0.8 },
    { n: 3,  type: 'PROTECCION', label: 'Protección #1',   offsetMin: 45,  weight: 0.7 },
    { n: 4,  type: 'BASE',     label: 'Base Liquipops #2', offsetMin: 90,  weight: 1.0 },
    { n: 5,  type: 'BASE',     label: 'Base Liquipops #3', offsetMin: 140, weight: 1.0 },
    { n: 6,  type: 'BASE',     label: 'Base Liquipops #4', offsetMin: 190, weight: 1.0 },
    { n: 7,  type: 'ALGINATO', label: 'Alginato #2',       offsetMin: 220, weight: 0.8 },
    { n: 8,  type: 'PROTECCION', label: 'Protección #2',   offsetMin: 235, weight: 0.7 },
    { n: 9,  type: 'COMIDA',   label: 'Comida (15min)',    offsetMin: 265, weight: 0 },
    { n: 10, type: 'BASE',     label: 'Base Liquipops #5', offsetMin: 280, weight: 1.0 },
    { n: 11, type: 'BASE',     label: 'Base Liquipops #6', offsetMin: 330, weight: 1.0 },
    { n: 12, type: 'BASE',     label: 'Base Liquipops #7', offsetMin: 380, weight: 1.0 },
    { n: 13, type: 'ALGINATO', label: 'Alginato #3 (cierre ciclo)', offsetMin: 410, weight: 0.9 },
    { n: 14, type: 'PROTECCION', label: 'Protección #3 (cierre ciclo)', offsetMin: 425, weight: 0.8 },
];

// Domingo NOCHE (22:00 dom → 06:00 lun) = arranque de semana.
// 22:00-01:00 (3h): ALISTAMIENTO PURO de maquinaria (encender marmitas,
// preparar equipos, calibración). NO se hacen baches.
// 01:00-02:30: 3 ALGINATOS necesarios (sin alginato no se puede esferificar).
// Después: ciclo normal (Base + Protección + Bases sucesivas).
const TEMPLATE_NOCHE_ARRANQUE = [
    { n: 1,  type: 'ALISTAMIENTO', label: 'Alistamiento de maquinaria (3h)', offsetMin: 0,   weight: 0 },   // 22:00 → 01:00
    { n: 2,  type: 'ALGINATO',   label: 'Alginato #1 (arranque)',          offsetMin: 180, weight: 1.0 }, // 01:00
    { n: 3,  type: 'ALGINATO',   label: 'Alginato #2 (arranque)',          offsetMin: 210, weight: 1.0 }, // 01:30
    { n: 4,  type: 'ALGINATO',   label: 'Alginato #3 (arranque)',          offsetMin: 240, weight: 1.0 }, // 02:00
    { n: 5,  type: 'BASE',       label: 'Base Liquipops #1',               offsetMin: 270, weight: 1.0 }, // 02:30
    { n: 6,  type: 'PROTECCION', label: 'Protección #1',                   offsetMin: 285, weight: 0.7 }, // 02:45
    { n: 7,  type: 'BASE',       label: 'Base Liquipops #2',               offsetMin: 330, weight: 1.0 }, // 03:30
    { n: 8,  type: 'BASE',       label: 'Base Liquipops #3',               offsetMin: 380, weight: 1.0 }, // 04:20
    { n: 9,  type: 'PROTECCION', label: 'Protección #2',                   offsetMin: 405, weight: 0.7 }, // 04:45
    { n: 10, type: 'BASE',       label: 'Base Liquipops #4',               offsetMin: 430, weight: 1.0 }, // 05:10
];

const SHIFT_TEMPLATE_BY_CODE = {
    MANANA: TEMPLATE_MANANA,
    TARDE: TEMPLATE_TARDE,
    NOCHE: TEMPLATE_NOCHE,
};

const SHIFT_HOURS = { MANANA: 6, TARDE: 14, NOCHE: 22 };
const SHIFT_DURATION_MIN = 480;

// ── Ventanas sin producción ────────────────────────────────────────────────
// Reglas operativas:
//   • Sábado: el último bache de esferificación inicia 5 PM y termina 6 PM.
//     De 6 PM a 10 PM hay LAVADO PROFUNDO (no se hacen baches). Después no
//     se trabaja hasta el domingo 10 PM.
//   • Domingo MAÑANA y TARDE: NO se labora.
//   • Domingo NOCHE (22:00 → 02:00 lun): ALISTAMIENTO de maquinaria
//     (4 horas no productivas). Producción real arranca lunes 2 AM.
// Para no inflar el promedio con turnos cero-score:
//   • Sábado NOCHE → no-work
//   • Domingo MAÑANA y TARDE → no-work
//   • Domingo NOCHE → contabiliza como no-work del cronograma de bases
//     (alistamiento, no producción de bases)
// dayIdx: 0=Dom, 1=Lun, ..., 6=Sab.
// Caché en memoria de NON_WORK_DAYS (TTL 60s) para evitar leer systemSettings
// en cada llamada al matcher / endpoint de history.
let _nonWorkDaysCache = { dates: new Set(), ts: 0 };
const _loadNonWorkDays = async () => {
    const now = Date.now();
    if (now - _nonWorkDaysCache.ts < 60_000) return _nonWorkDaysCache.dates;
    try {
        const row = await prisma.systemSettings.findUnique({ where: { key: 'NON_WORK_DAYS' } });
        const list = row?.value?.dates || [];
        _nonWorkDaysCache = {
            dates: new Set(list.map(d => d.date)),
            ts: now,
        };
    } catch { _nonWorkDaysCache = { dates: new Set(), ts: now }; }
    return _nonWorkDaysCache.dates;
};
const _isNonWorkDay = (shiftDate) => _nonWorkDaysCache.dates.has(shiftDate);

const isNonWorkWindow = (shiftDate, shiftCode) => {
    if (!shiftDate || !shiftCode) return false;
    if (_isNonWorkDay(shiftDate)) return true; // día festivo o no laborado manualmente
    const d = new Date(`${shiftDate}T12:00:00.000Z`);
    const dayIdx = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dayIdx === 6 && shiftCode === 'NOCHE') return true; // sáb noche
    if (dayIdx === 0 && (shiftCode === 'MANANA' || shiftCode === 'TARDE')) return true; // dom día
    // Domingo NOCHE (22:00 dom → 06:00 lun): SÍ hay trabajo (alistamiento +
    // 3 alginatos, primera base 1 AM lun). Usa TEMPLATE_NOCHE_ARRANQUE.
    return false;
};

// Detecta si la fecha+turno es el arranque de semana (dom NOCHE → lun amanecer)
const isArranqueSemana = (shiftDate, shiftCode) => {
    if (shiftCode !== 'NOCHE') return false;
    const d = new Date(`${shiftDate}T12:00:00.000Z`);
    return d.getUTCDay() === 0; // domingo
};

const getShiftCodeForHour = (hour) => {
    if (hour >= 6 && hour < 14) return 'MANANA';
    if (hour >= 14 && hour < 22) return 'TARDE';
    return 'NOCHE';
};

const getShiftDateStr = (date) => {
    // IMPORTANTE: el `date` que recibimos ya viene en hora Colombia
    // (parsed desde toLocaleString). Si usamos toISOString() perdemos la
    // fecha local porque convierte a UTC y un domingo 22:00 COT se reporta
    // como lunes 03:00 UTC. Usamos componentes locales para preservar el
    // día Colombia.
    const d = new Date(date);
    const target = new Date(d);
    if (d.getHours() < 6) target.setDate(target.getDate() - 1);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const buildIdealSchedule = (shiftCode, shiftStart, shiftDate) => {
    const startMs = new Date(shiftStart).getTime();
    let template = SHIFT_TEMPLATE_BY_CODE[shiftCode] || TEMPLATE_MANANA;
    // Domingo NOCHE = arranque de semana — alistamiento + 3 alginatos antes
    // de la primera base a las 1 AM del lunes.
    if (shiftDate && isArranqueSemana(shiftDate, shiftCode)) {
        template = TEMPLATE_NOCHE_ARRANQUE;
    }
    return template.map(t => ({
        ...t,
        idealTime: new Date(startMs + t.offsetMin * 60000).toISOString(),
        doneAt: null,
        doneBy: null,
        actualBatchId: null,
        deltaMin: null,
        score: null,
    }));
};

// Score por step. Las BASES son estrictas (cuello de botella, marca el ritmo).
// ALGINATO y PROTECCION son más flexibles porque pueden iniciar en horas distintas
// si el operario está priorizando hacer BASES.
const computeStepScore = (deltaMin, type) => {
    if (deltaMin === null || deltaMin === undefined) return 0;
    const abs = Math.abs(deltaMin);
    if (type === 'ALGINATO' || type === 'PROTECCION') {
        if (abs <= 30) return 100;
        if (abs <= 45) return 85;
        if (abs <= 60) return 65;
        if (abs <= 90) return 40;
        return 0;
    }
    // BASES: tolerancia uniforme ±90 (igualada a ALG/PROT por decisión de
    // negocio — el operario que deja "lista" la base para el siguiente turno
    // cumple el cronograma aunque la esferificación termine después).
    if (abs <= 10) return 100;
    if (abs <= 20) return 85;
    if (abs <= 45) return 65;
    if (abs <= 90) return 40;
    return 0;
};

const computeFinalGrade = (score) => {
    if (score >= 90) return 'EXCELENTE';
    if (score >= 75) return 'BUENO';
    if (score >= 60) return 'ACEPTABLE';
    return 'DEFICIENTE';
};

// Tolerancia uniforme ±90 min para los STEPS al asignarse contra baches reales.
const STEP_MATCH_MARGIN_MS = 90 * 60000;

// Filtros estrictos:
//   - BASE final = product.group.name === 'LIQUIPOPS' (sólo PERLAS terminadas, excluye AZUCAR INVERTIDA / FRUCTOSA / intermedios).
//   - AUX (ALG/PROT) = batchNumber con prefijo correspondiente.
// Geniality (siropes, granadina, masas) queda automáticamente excluido.
const LIQUIPOPS_FINAL_GROUP = 'LIQUIPOPS';
// Para countBatchesForShift y reportes auxiliares aún consultamos el grupo intermedio.
const LIQUIPOPS_GROUP_NAMES = ['LIQUIPOPS'];

const detectBatchType = (batch) => {
    const f = (batch.flavor || batch.batchNumber || '').toUpperCase();
    if (f.includes('ALGINATO')) return 'ALGINATO';
    if (f.includes('PROTECCION') || f.includes('PROTECCIÓN')) return 'PROTECCION';
    return 'BASE';
};

// Verifica que un bache sea realmente BASE Liquipops final (con outputTarget
// del grupo 'LIQUIPOPS'). Usado para filtrar intermedios como FRUCTOSA.
const isFinalLiquipopsBase = (batch) => {
    if (!Array.isArray(batch.outputTargets) || batch.outputTargets.length === 0) return false;
    return batch.outputTargets.some(t => t.product?.group?.name === LIQUIPOPS_FINAL_GROUP);
};

// Cruza cada step pendiente con productionBatch.startedAt para auto-marcar `doneAt`.
//
// Cambios clave del matcher (2026-04-29):
//   1. Tolerancia uniforme ±90 min (BASE, ALG, PROT) — el operario que deja
//      lista una base aunque la esferificación caiga al siguiente turno SÍ cumple.
//   2. Filtro estricto Liquipops — descarta Geniality (granadina, siropes, etc.).
//   3. Asignación óptima global (no greedy): minimiza la suma de Δ
//      empareja step ↔ bache evitando que un bache "robe" el slot equivocado.
//   4. La regla de "bache hecho" es startedAt del productionBatch, no fin de
//      esferificación — refleja el momento de compromiso del operario.
const refreshStepsFromProduction = async (run) => {
    const steps = Array.isArray(run.steps) ? run.steps : JSON.parse(run.steps || '[]');
    const shiftStart = new Date(run.shiftStart).getTime();
    const shiftEnd = new Date(run.shiftEnd).getTime();

    // Ventana ESTRICTA del turno: un bache pertenece al turno donde se INICIÓ.
    // Sin extensión hacia atrás — los baches que arrancaron antes del turno
    // son del operario anterior. Hacia adelante extendemos hasta el fin para
    // permitir los últimos arranques antes del cambio de turno.
    const batches = await prisma.productionBatch.findMany({
        where: {
            startedAt: { gte: new Date(shiftStart), lt: new Date(shiftEnd) },
            OR: [
                // BASE final: outputTarget en grupo LIQUIPOPS (excluye intermedios)
                { outputTargets: { some: { product: { group: { name: LIQUIPOPS_FINAL_GROUP } } } } },
                // AUX por prefijo de batchNumber
                { batchNumber: { startsWith: 'PROTECCION-' } },
                { batchNumber: { startsWith: 'PROTECCIÓN-' } },
                { batchNumber: { startsWith: 'ALGINATO-' } },
            ],
        },
        select: {
            id: true, flavor: true, startedAt: true, batchNumber: true,
            outputTargets: { select: { product: { select: { group: { select: { name: true } } } } } },
            assemblyNotes: { select: { executedById: true }, orderBy: { stageOrder: 'asc' }, take: 1 }
        },
        orderBy: { startedAt: 'asc' },
    });

    // Filtro post-query: si es BASE, exigir que sea final Liquipops (no intermedio).
    // Los AUX no necesitan validación adicional (el prefijo basta).
    const validBatches = batches.filter(b => {
        const t = detectBatchType(b);
        if (t === 'BASE') return isFinalLiquipopsBase(b);
        return true;
    });

    // Reset: no respetamos asignaciones previas; siempre recalculamos para
    // que cambios de tolerancia/algoritmo se apliquen también a los runs existentes.
    for (const s of steps) {
        if (s.type === 'COMIDA' || s.type === 'ALISTAMIENTO') continue;
        s.doneAt = null;
        s.doneBy = null;
        s.actualBatchId = null;
        s.actualBatchNumber = null;
        s.actualFlavor = null;
        s.deltaMin = null;
        s.score = 0;
    }

    // Asignación óptima global: para cada tipo (BASE/ALG/PROT) emparejamos
    // los steps disponibles con los baches candidatos minimizando la suma de Δ
    // (versión simplificada, suficiente para N pequeño: 7 steps × ≤10 baches).
    // Algoritmo: backtracking sobre permutaciones por tipo (N! ≤ 7! = 5040
    // por tipo, cap razonable). Si la cardinalidad crece, sustituir por Húngaro.
    const assignByType = (type) => {
        const candidateSteps = steps
            .map((s, idx) => ({ s, idx, ideal: new Date(s.idealTime).getTime() }))
            .filter(({ s }) => s.type === type);
        const candidateBatches = validBatches.filter(b => detectBatchType(b) === type);
        if (candidateSteps.length === 0 || candidateBatches.length === 0) return;

        // Costo step→bache (Δ en ms); Infinity si fuera de tolerancia.
        const cost = (sIdx, bIdx) => {
            const d = Math.abs(candidateBatches[bIdx].startedAt.getTime() - candidateSteps[sIdx].ideal);
            return d <= STEP_MATCH_MARGIN_MS ? d : Infinity;
        };

        // Backtracking: probar todas las asignaciones step→bache (cada bache a
        // lo más a un step) y quedarse con la suma de costos mínima.
        // Penalidad por dejar un step sin asignar: 100× la tolerancia máxima.
        // Esto garantiza que si existe UN bache válido dentro de ±90 min, el
        // algoritmo SIEMPRE preferirá asignarlo (aunque su Δ sea grande) en
        // lugar de dejar el step vacío. Sin esta penalidad alta, el matcher
        // dejaba slots vacíos cuando otra asignación tenía costo menor en
        // términos de Δ — lo que castigaba injustamente al líder por baches
        // que sí hizo.
        const EMPTY_PENALTY = STEP_MATCH_MARGIN_MS * 100;
        const N = candidateSteps.length;
        const M = candidateBatches.length;
        const used = new Array(M).fill(false);
        const best = { total: Infinity, mapping: null };

        const recurse = (sIdx, currentTotal, mapping) => {
            if (currentTotal >= best.total) return; // poda
            if (sIdx === N) {
                best.total = currentTotal;
                best.mapping = [...mapping];
                return;
            }
            // Opción A: dejar este step sin asignar
            mapping[sIdx] = -1;
            recurse(sIdx + 1, currentTotal + EMPTY_PENALTY, mapping);
            // Opción B: probar cada bache no usado dentro de tolerancia
            for (let bIdx = 0; bIdx < M; bIdx++) {
                if (used[bIdx]) continue;
                const c = cost(sIdx, bIdx);
                if (!isFinite(c)) continue;
                used[bIdx] = true;
                mapping[sIdx] = bIdx;
                recurse(sIdx + 1, currentTotal + c, mapping);
                used[bIdx] = false;
            }
        };
        recurse(0, 0, new Array(N).fill(-1));

        if (!best.mapping) return;

        // Asignación principal (dentro de tolerancia)
        const assignedBatchIndices = new Set();
        for (let i = 0; i < N; i++) {
            const bIdx = best.mapping[i];
            if (bIdx < 0) continue;
            assignedBatchIndices.add(bIdx);
        }

        // Pase de relajación: si quedan baches sin asignar (porque excedieron
        // tolerancia ±90 min) y aún hay steps vacíos del mismo tipo, emparejarlos
        // al step vacío más cercano. El score saldrá 0 si el delta excede el
        // máximo de la tabla, pero el bache aparece como "hecho fuera de tiempo"
        // en lugar de invisible. Refleja el esfuerzo del operario aunque no
        // premie el incumplimiento.
        const emptyStepIdxs = [];
        for (let i = 0; i < N; i++) if (best.mapping[i] < 0) emptyStepIdxs.push(i);
        const unassignedBatchIdxs = [];
        for (let bIdx = 0; bIdx < M; bIdx++) if (!assignedBatchIndices.has(bIdx)) unassignedBatchIdxs.push(bIdx);

        for (const bIdx of unassignedBatchIdxs) {
            if (emptyStepIdxs.length === 0) break;
            // Step vacío más cercano (en idealTime) a este bache
            const batchTime = candidateBatches[bIdx].startedAt.getTime();
            let bestStepIdxInList = 0;
            let bestStepDelta = Infinity;
            for (let k = 0; k < emptyStepIdxs.length; k++) {
                const stepIdx = emptyStepIdxs[k];
                const d = Math.abs(candidateSteps[stepIdx].ideal - batchTime);
                if (d < bestStepDelta) { bestStepDelta = d; bestStepIdxInList = k; }
            }
            const stepIdx = emptyStepIdxs.splice(bestStepIdxInList, 1)[0];
            best.mapping[stepIdx] = bIdx;
        }

        // Marcar qué baches vinieron del pase de relajación para aplicarles
        // la regla "ALGINATO dentro del turno cuenta con score mínimo 40".
        const relaxedBatchIdxs = new Set(unassignedBatchIdxs.filter(bIdx => {
            for (let i = 0; i < N; i++) if (best.mapping[i] === bIdx) return true;
            return false;
        }));

        for (let i = 0; i < N; i++) {
            const bIdx = best.mapping[i];
            if (bIdx < 0) continue;
            const step = candidateSteps[i].s;
            const batch = candidateBatches[bIdx];
            step.doneAt = batch.startedAt.toISOString();
            step.doneBy = batch.assemblyNotes?.[0]?.executedById || null;
            step.actualBatchId = batch.id;
            step.actualBatchNumber = batch.batchNumber || null;
            step.actualFlavor = batch.flavor || null;
            step.deltaMin = Math.round((batch.startedAt.getTime() - candidateSteps[i].ideal) / 60000);
            step.score = computeStepScore(step.deltaMin, step.type);

            // Regla flexible para AUX (ALGINATO y PROTECCION): si está dentro
            // del turno, score mínimo 40 aunque exceda la tolerancia ±90 min.
            // No son procesos de cuello de botella: mientras se preparen en el
            // turno, cuentan como cumplidos pero con menos score por adherencia.
            // BASE sigue siendo estricto (marca el ritmo de producción).
            if ((type === 'ALGINATO' || type === 'PROTECCION') && step.score === 0) {
                const batchTime = batch.startedAt.getTime();
                if (batchTime >= shiftStart && batchTime < shiftEnd) {
                    step.score = 40;
                }
            }
        }
    };

    assignByType('BASE');
    assignByType('ALGINATO');
    assignByType('PROTECCION');

    return steps;
};

// Resuelve el líder asignado a un (shiftDate, shiftCode) consultando
// shift_assignments y shift_employees. Devuelve el id del ShiftEmployee con
// rol "LIDER" cuya semana cubre la fecha y cuyo turno coincide.
// Si no se encuentra → null. Tolerante a fallos de datos.
const findLeaderIdForShift = async (shiftDate, shiftCode) => {
    try {
        // shiftDate es 'YYYY-MM-DD' — convertir a Date (00:00 UTC) para query de rango
        const dateObj = new Date(`${shiftDate}T12:00:00.000Z`); // mediodía UTC para evitar saltos
        const week = await prisma.shiftWeek.findFirst({
            where: { weekStart: { lte: dateObj }, weekEnd: { gte: dateObj } },
            select: { id: true },
        });
        if (!week) return null;
        const assignment = await prisma.shiftAssignment.findFirst({
            where: {
                weekId: week.id,
                shift: shiftCode,
                employee: { role: 'LIDER', active: true },
            },
            select: { employeeId: true },
        });
        return assignment?.employeeId || null;
    } catch (e) {
        logger.warn(`[shift-discipline] findLeaderIdForShift error: ${e.message}`);
        return null;
    }
};

// Si el run no tiene leaderId, intentar resolverlo y persistir. Idempotente.
// Devuelve el run posiblemente actualizado.
const ensureLeaderId = async (run) => {
    if (!run || run.leaderId) return run;
    const leaderId = await findLeaderIdForShift(run.shiftDate, run.shiftCode);
    if (!leaderId) return run;
    try {
        const updated = await prisma.shiftDisciplineRun.update({
            where: { id: run.id },
            data: { leaderId },
        });
        logger.info(`[shift-discipline] backfilled leaderId for run ${run.id} (${run.shiftDate} ${run.shiftCode}) → ${leaderId}`);
        return updated;
    } catch (e) {
        logger.warn(`[shift-discipline] ensureLeaderId persist error: ${e.message}`);
        return run;
    }
};

const getOrCreateCurrentRun = async () => {
    const now = new Date();
    const colombiaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const hour = colombiaNow.getHours();
    const shiftCode = getShiftCodeForHour(hour);
    const shiftDate = getShiftDateStr(colombiaNow);

    // Compute shiftStart en hora local Colombia → guardar como UTC
    const shiftStartLocal = new Date(colombiaNow);
    shiftStartLocal.setHours(SHIFT_HOURS[shiftCode], 0, 0, 0);
    if (shiftCode === 'NOCHE' && hour < 6) {
        shiftStartLocal.setDate(shiftStartLocal.getDate() - 1);
    }
    // Volver a UTC sumando offset
    const offsetMin = colombiaNow.getTimezoneOffset() - new Date().getTimezoneOffset();
    const shiftStart = new Date(shiftStartLocal.getTime() - offsetMin * 60000);
    const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION_MIN * 60000);

    let run = await prisma.shiftDisciplineRun.findUnique({
        where: { shiftDate_shiftCode: { shiftDate, shiftCode } },
    });

    if (!run) {
        // No crear runs en ventanas sin producción (sábado noche, domingo
        // día y domingo noche-alistamiento). Devolvemos un run "virtual"
        // mínimo para que la UI no rompa, sin persistirlo.
        if (isNonWorkWindow(shiftDate, shiftCode)) {
            return {
                id: null,
                shiftDate,
                shiftCode,
                shiftStart,
                shiftEnd,
                steps: [],
                leaderId: null,
                finalScore: null,
                finalGrade: null,
                closedAt: null,
                _nonWork: true,
            };
        }
        const initialSteps = buildIdealSchedule(shiftCode, shiftStart, shiftDate);
        const leaderId = await findLeaderIdForShift(shiftDate, shiftCode);
        run = await prisma.shiftDisciplineRun.create({
            data: { shiftDate, shiftCode, shiftStart, shiftEnd, steps: initialSteps, leaderId },
        });
        logger.info(`[shift-discipline] Created new run for ${shiftDate} ${shiftCode} (leader=${leaderId || 'none'})`);
    } else {
        run = await ensureLeaderId(run);
    }
    return run;
};

// ── Endpoints ───────────────────────────────────────────────────────────────
// Score de adherencia al cronómetro (tiempo de esferificación):
//   ≤90 min  → 100  (excelente)
//   91-120  → 85
//   121-150 → 65
//   >150    → 40
const computeEsferAdherence = (elapsedMin) => {
    if (elapsedMin == null) return 0;
    if (elapsedMin <= 90)  return 100;
    if (elapsedMin <= 120) return 85;
    if (elapsedMin <= 150) return 65;
    return 40;
};

// Tiempo objetivo de esferificación (min). Usado como denominador para
// calcular la fracción de mérito de baches que aún no han FINALIZADO.
const ESFER_TARGET_MIN = 70;

// Resumen de esferificaciones de la cuadrilla del turno actual.
// Regla acordada: NO se penaliza por "no terminar" en el turno. Cada cuadrilla
// recibe mérito proporcional al tiempo de cronómetro dentro de su ventana de
// turno. Mañana inicia 0.4 + tarde termina 0.6 → ambas suman para sus metas.
// Para baches en curso, la fracción se calcula contra el tiempo objetivo (70 min)
// para no esperar a que terminen.
const buildEsferificacionSummary = async (shiftStart, shiftEnd) => {
    const TARGET = 7;
    const ws = shiftStart.getTime();
    const we = shiftEnd.getTime();

    // Filtros estrictos para excluir cronómetros huérfanos:
    //  - Solo baches cuyo productionBatch.startedAt sea de las últimas 24h
    //    (evita arrastrar timers olvidados de días/semanas atrás)
    //  - Solo baches activos en la ventana del turno o cercanos a ella
    const lookbackStart = new Date(ws - 24 * 3600000);
    const notes = await prisma.assemblyNote.findMany({
        where: {
            processType: { code: 'FORMACION' },
            status: { in: ['EXECUTING', 'COMPLETED'] },
            productionBatch: { startedAt: { gte: lookbackStart } },
        },
        select: {
            id: true, processParameters: true,
            executedBy: { select: { id: true, name: true } },
            productionBatch: { select: { batchNumber: true, flavor: true } },
        },
    });

    // Filtros para evitar contaminar el cálculo con cronómetros huérfanos
    // del PASADO (días viejos), pero siendo permisivos con baches actuales
    // problemáticos (operario olvidó FINALIZAR pero el bache es real).
    //  - Baches FINALIZADOS: siempre se muestran.
    //  - Baches IN_PROGRESS/PAUSED con elapsedNetMin > 6h se consideran
    //    huérfanos viejos y se excluyen.
    const ABANDON_NET_MIN = 360; // 6 horas

    const baches = [];
    for (const n of notes) {
        const t = n.processParameters?.esferificacion_timer;
        if (!t || !t.startTime) continue;
        const s = new Date(t.startTime).getTime();
        const e = t.endTime ? new Date(t.endTime).getTime() : Date.now();

        // Overlap real con la ventana del turno
        const overlapStart = Math.max(s, ws);
        const overlapEnd   = Math.min(e, we);
        if (overlapEnd <= overlapStart) continue;
        const overlapMin = Math.round((overlapEnd - overlapStart) / 60000);

        const isFinished = t.status === 'FINISHED';

        // Tiempo NETO en proceso (sin pausas, calculado al instante):
        //  - FINISHED → t.elapsedMs ya está cerrado
        //  - RUNNING  → t.elapsedMs + (now - segmentStartedAt)
        //  - PAUSED   → t.elapsedMs (la pausa no cuenta)
        let elapsedNetMs = t.elapsedMs || 0;
        if (t.status === 'RUNNING' && t.segmentStartedAt) {
            elapsedNetMs += Math.max(0, Date.now() - new Date(t.segmentStartedAt).getTime());
        }
        const elapsedNet = Math.round(elapsedNetMs / 60000);
        const adherence  = isFinished ? computeEsferAdherence(elapsedNet) : null;

        // Denominador para el % de mérito:
        //  - Finalizado → tiempo neto real del cronómetro
        //  - En curso   → tiempo objetivo (70 min) para no esperar
        const denom = isFinished ? Math.max(1, elapsedNet) : ESFER_TARGET_MIN;
        const fraction = Math.min(1, overlapMin / denom);

        let status;
        if (isFinished) {
            status = adherence >= 85 ? 'done_good' : adherence >= 40 ? 'done_late' : 'done_bad';
        } else if (t.status === 'PAUSED') {
            status = 'paused';
        } else {
            status = 'in_progress';
        }

        // Filtro de huérfanos: in_progress/paused con tiempo neto > 3h
        // probablemente es un cronómetro olvidado. No contamina el cálculo.
        if (!isFinished && elapsedNet > ABANDON_NET_MIN) continue;

        baches.push({
            noteId: n.id,
            batchNumber: n.productionBatch?.batchNumber || null,
            flavor: n.productionBatch?.flavor || null,
            operatorId: n.executedBy?.id || null,
            operatorName: n.executedBy?.name || null,
            startedAt: t.startTime,
            endedAt: t.endTime || null,
            status,
            elapsedMin: elapsedNet,                // mostrar tiempo NETO al usuario
            elapsedGrossMin: Math.round((Date.now() - s) / 60000),  // bruto solo para tooltip
            elapsedNetMin: elapsedNet,
            score: adherence,
            fraction: parseFloat(fraction.toFixed(3)),
            overlapMin,
            isInherited: s < ws,
        });
    }

    baches.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    // Mérito acumulado capeado a la meta del turno (7). Nunca puede pasar de 7.
    const rawMerit = baches.reduce((s, b) => s + b.fraction, 0);
    const meritFractional = Math.min(TARGET, rawMerit);

    const finishedScores = baches
        .filter(b => b.status.startsWith('done_') && typeof b.score === 'number')
        .map(b => b.score);
    const avgAdherence = finishedScores.length > 0
        ? Math.round(finishedScores.reduce((a, b) => a + b, 0) / finishedScores.length)
        : null;

    // Ritmo esperado a la hora actual del turno: lineal sobre la meta total.
    // Ej: turno 8h, meta 7 → 0.875 baches/h. A las 4h del turno → expected = 3.5.
    const shiftDurationMs = we - ws;
    const elapsedShiftMs = Math.max(0, Math.min(Date.now(), we) - ws);
    const expectedAtNow = (elapsedShiftMs / shiftDurationMs) * TARGET;
    const paceRatio = expectedAtNow > 0 ? Math.min(2, meritFractional / expectedAtNow) : 1;

    // Etiqueta combinada calidad (adherencia) + ritmo. La pieza más débil manda.
    const adh = avgAdherence == null ? 100 : avgAdherence;
    let paceLabel, paceLevel;
    if (paceRatio < 0.6) {
        paceLabel = '🐢 Atrasado';      paceLevel = 'bad';
    } else if (paceRatio < 0.85 || adh < 60) {
        paceLabel = '⚠ Mejorable';     paceLevel = 'warn';
    } else if (paceRatio < 1.0 || adh < 90) {
        paceLabel = '⚡ Bueno';         paceLevel = 'good';
    } else {
        paceLabel = '🥇 Excelente';     paceLevel = 'excellent';
    }

    return {
        target: TARGET,
        meritFractional: parseFloat(meritFractional.toFixed(2)),
        meritRounded: Math.round(meritFractional),
        finishedCount: baches.filter(b => b.status.startsWith('done_')).length,
        inProgressCount: baches.filter(b => b.status === 'in_progress' || b.status === 'paused').length,
        avgAdherence,
        expectedAtNow: parseFloat(expectedAtNow.toFixed(2)),
        paceRatio: parseFloat(paceRatio.toFixed(2)),
        paceLabel,
        paceLevel,
        baches,
    };
};

exports.getCurrent = async (req, res) => {
    try {
        const run = await getOrCreateCurrentRun();
        const refreshedSteps = await refreshStepsFromProduction(run);
        const updated = await prisma.shiftDisciplineRun.update({
            where: { id: run.id },
            data: { steps: refreshedSteps },
        });
        // Resumen de esferificaciones de la cuadrilla
        const esferificacion = await buildEsferificacionSummary(run.shiftStart, run.shiftEnd);
        res.json({ success: true, data: { ...updated, esferificacion } });
    } catch (e) {
        logger.error('[shift-discipline] getCurrent error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.refresh = async (req, res) => {
    try {
        const { id } = req.params;
        const run = await prisma.shiftDisciplineRun.findUnique({ where: { id } });
        if (!run) return res.status(404).json({ success: false, error: 'Run no encontrado' });
        const refreshedSteps = await refreshStepsFromProduction(run);
        const updated = await prisma.shiftDisciplineRun.update({
            where: { id }, data: { steps: refreshedSteps },
        });
        res.json({ success: true, data: updated });
    } catch (e) {
        logger.error('[shift-discipline] refresh error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.close = async (req, res) => {
    try {
        const { id } = req.params;
        const run = await prisma.shiftDisciplineRun.findUnique({ where: { id } });
        if (!run) return res.status(404).json({ success: false, error: 'Run no encontrado' });

        const refreshedSteps = await refreshStepsFromProduction(run);
        const totalWeight = refreshedSteps.reduce((s, st) => s + ((st.weight ?? 1)), 0);
        const weightedScore = refreshedSteps.reduce((s, st) => s + ((st.score || 0) * ((st.weight ?? 1))), 0);
        const finalScore = Math.round(weightedScore / totalWeight);
        const finalGrade = computeFinalGrade(finalScore);

        const updated = await prisma.shiftDisciplineRun.update({
            where: { id },
            data: { steps: refreshedSteps, finalScore, finalGrade, closedAt: new Date() },
        });
        logger.info(`[shift-discipline] Closed ${run.shiftDate} ${run.shiftCode}: score=${finalScore} (${finalGrade})`);
        res.json({ success: true, data: updated });
    } catch (e) {
        logger.error('[shift-discipline] close error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.getPrevious = async (req, res) => {
    try {
        const last = await prisma.shiftDisciplineRun.findFirst({
            where: { closedAt: { not: null } },
            orderBy: { closedAt: 'desc' },
        });
        res.json({ success: true, data: last });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// Listado paginado de runs cerrados con filtros (rango fecha, líder, turno)
// Devuelve resumen para tabla histórica.
exports.history = async (req, res) => {
    try {
        await _loadNonWorkDays();
        const { from, to, leaderId, shiftCode } = req.query;
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '50', 10)));

        const where = { closedAt: { not: null } };
        if (from || to) {
            where.shiftDate = {};
            if (from) where.shiftDate.gte = from;
            if (to)   where.shiftDate.lte = to;
        }
        if (leaderId)  where.leaderId  = leaderId;
        if (shiftCode) where.shiftCode = shiftCode;

        const [total, rawRows] = await Promise.all([
            prisma.shiftDisciplineRun.count({ where }),
            prisma.shiftDisciplineRun.findMany({
                where,
                orderBy: [{ shiftDate: 'desc' }, { shiftStart: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);

        // Excluir runs en ventanas sin producción (sáb-noche, dom-día,
        // dom-noche-alistamiento). No deben afectar promedios de líderes.
        const filteredRows = rawRows.filter(r => !isNonWorkWindow(r.shiftDate, r.shiftCode));

        // Lazy backfill: para runs históricos sin leaderId intentar resolverlo
        // a partir de shift_assignments y persistir. Ejecutado en paralelo.
        const rows = await Promise.all(filteredRows.map(r => r.leaderId ? r : ensureLeaderId(r)));

        // Resolver nombres de líderes
        const leaderIds = [...new Set(rows.map(r => r.leaderId).filter(Boolean))];
        const employees = leaderIds.length > 0 ? await prisma.shiftEmployee.findMany({
            where: { id: { in: leaderIds } },
            select: { id: true, name: true },
        }) : [];
        const nameMap = new Map(employees.map(e => [e.id, e.name]));

        const summarized = rows.map(r => {
            const steps = Array.isArray(r.steps) ? r.steps : [];
            const total = steps.length;
            const done = steps.filter(s => s.doneAt).length;
            const late = steps.filter(s => s.doneAt && typeof s.deltaMin === 'number' && s.deltaMin > 5).length;
            const missed = steps.filter(s => !s.doneAt).length;
            const alerted = Array.isArray(r.alertedSteps) ? r.alertedSteps.length : 0;
            return {
                id: r.id,
                shiftDate: r.shiftDate,
                shiftCode: r.shiftCode,
                shiftStart: r.shiftStart,
                shiftEnd: r.shiftEnd,
                leaderId: r.leaderId,
                leaderName: nameMap.get(r.leaderId) || '— Sin líder —',
                finalScore: r.finalScore,
                finalGrade: r.finalGrade,
                closedAt: r.closedAt,
                stepsTotal: total,
                stepsDone: done,
                stepsLate: late,
                stepsMissed: missed,
                alertsCount: alerted,
            };
        });

        res.json({ success: true, total, page, pageSize, data: summarized });
    } catch (e) {
        logger.error('[shift-discipline] history error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

// POST /api/shift-discipline/runs/:id/recompute
// Vuelve a aplicar el matcher al run (incluso si ya está cerrado) con las
// reglas vigentes del controlador (tolerancia, asignación óptima, filtros).
// Recalcula score y grade. Útil tras cambios en el algoritmo o para corregir
// turnos donde la detección quedó incompleta.
exports.recomputeRun = async (req, res) => {
    try {
        const { id } = req.params;
        let run = await prisma.shiftDisciplineRun.findUnique({ where: { id } });
        if (!run) return res.status(404).json({ success: false, error: 'Run no encontrado' });
        run = await ensureLeaderId(run);
        const refreshedSteps = await refreshStepsFromProduction(run);
        const totalWeight = refreshedSteps.reduce((s, st) => s + ((st.weight ?? 1)), 0);
        const weighted = refreshedSteps.reduce((s, st) => s + ((st.score || 0) * ((st.weight ?? 1))), 0);
        const finalScore = Math.round(weighted / totalWeight);
        const finalGrade = computeFinalGrade(finalScore);
        const updated = await prisma.shiftDisciplineRun.update({
            where: { id },
            data: { steps: refreshedSteps, finalScore, finalGrade },
        });
        res.json({ success: true, data: updated });
    } catch (e) {
        logger.error('[shift-discipline] recomputeRun error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

// Detalle completo de un run cerrado: timeline reproducible.
exports.getRunDetail = async (req, res) => {
    try {
        const { id } = req.params;
        let run = await prisma.shiftDisciplineRun.findUnique({ where: { id } });
        if (!run) return res.status(404).json({ success: false, error: 'Run no encontrado' });

        // Backfill lazy si quedó sin líder
        run = await ensureLeaderId(run);

        let leaderName = null;
        if (run.leaderId) {
            const emp = await prisma.shiftEmployee.findUnique({
                where: { id: run.leaderId }, select: { name: true },
            });
            leaderName = emp?.name || null;
        }
        // Resumen histórico de esferificaciones de la cuadrilla en la ventana del turno
        let esferificacion = null;
        try {
            esferificacion = await buildEsferificacionSummary(run.shiftStart, run.shiftEnd);
        } catch (e) {
            logger.warn('[shift-discipline] esferificacion summary failed:', e?.message);
        }
        res.json({ success: true, data: { ...run, leaderName, esferificacion } });
    } catch (e) {
        logger.error('[shift-discipline] getRunDetail error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

// Ranking mensual de líderes por score promedio de disciplina
exports.leaderRanking = async (req, res) => {
    try {
        await _loadNonWorkDays();
        const month = req.query.month; // formato YYYY-MM, opcional
        const target = month || new Date().toISOString().slice(0, 7);
        const monthStart = `${target}-01`;
        const [y, m] = target.split('-').map(Number);
        const monthEnd = `${target}-${new Date(y, m, 0).getDate().toString().padStart(2, '0')}`;

        const allRuns = await prisma.shiftDisciplineRun.findMany({
            where: { closedAt: { not: null }, shiftDate: { gte: monthStart, lte: monthEnd } },
            select: { leaderId: true, finalScore: true, finalGrade: true, shiftCode: true, shiftDate: true },
        });
        // Excluir ventanas sin producción del ranking (sáb-noche, dom-día, dom-noche)
        const runs = allRuns.filter(r => !isNonWorkWindow(r.shiftDate, r.shiftCode));

        // Buscar nombres de líderes desde shift_assignments
        const leaderIds = [...new Set(runs.map(r => r.leaderId).filter(Boolean))];
        const employees = leaderIds.length > 0 ? await prisma.shiftEmployee.findMany({
            where: { id: { in: leaderIds } },
            select: { id: true, name: true },
        }) : [];
        const nameMap = new Map(employees.map(e => [e.id, e.name]));

        // Agrupar por leaderId
        const grouped = {};
        for (const r of runs) {
            const key = r.leaderId || 'sin_lider';
            if (!grouped[key]) grouped[key] = { leaderId: r.leaderId, leaderName: nameMap.get(r.leaderId) || '— Sin líder —', runs: [], totalScore: 0, count: 0 };
            grouped[key].runs.push({ shiftDate: r.shiftDate, shiftCode: r.shiftCode, finalScore: r.finalScore, finalGrade: r.finalGrade });
            grouped[key].totalScore += (r.finalScore || 0);
            grouped[key].count += 1;
        }
        const ranking = Object.values(grouped).map(g => ({
            ...g,
            avgScore: g.count > 0 ? Math.round(g.totalScore / g.count) : 0,
        })).sort((a, b) => b.avgScore - a.avgScore);

        res.json({ success: true, month: target, data: ranking });
    } catch (e) {
        logger.error('[shift-discipline] leaderRanking error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

// ──────────────────────────────────────────────────────────────────────
// GET /api/shift-discipline/bonus?month=YYYY-MM&leaderId=...
//
// Calcula el bono mensual proyectado de un líder según el modelo "pérdida":
//   - Bono base configurable (default $1.000.000) repartido entre el grupo (default 4 personas).
//   - Por cada turno cerrado del líder en el mes:
//       * Contar baches Liquipops esferificados, prorrateando los que cruzaron turno
//         por el % de tiempo de esferificación que cayó dentro del turno.
//       * Aplicar tabla de % retención por baches con interpolación lineal:
//           7+ → 100%   ·   6 → 75%   ·   5 → 50%   ·   ≤4 → 0%
//         (decimales interpolados: 6.5 → 87.5%, 5.5 → 62.5%, etc.)
//       * Si el turno tuvo FALLA registrada (productionBatch flavor='FALLA') → forzar 100% baches.
//       * Multiplicar por factor adherencia = run.finalScore / 100.
//   - valorTurno = (BASE / totalTurnosMes) × pctBaches × factorAdherencia
//
// Respuesta:
//   {
//     success, month, leaderId, leaderName,
//     baseBonus, peoplePerGroup, baseBonusPerPerson,
//     totalShiftsInMonth, shiftsClosed, shiftsRemaining,
//     valuePerShift, totalEarned, totalLost, projectedTotal,
//     projectedPerPerson, percentRetained,
//     maxRecoverable, // si todos los turnos restantes fueran 100%
//     details: [ { date, shift, batches, score, hadFailure, baseValue, retainedValue, lostValue, reason } ]
//   }
// ──────────────────────────────────────────────────────────────────────

const BONUS_DEFAULT_BASE         = 1_000_000;
const BONUS_DEFAULT_PEOPLE       = 4;
const BONUS_BACHES_THRESHOLDS    = [
    { batches: 4, pct: 0   },
    { batches: 5, pct: 0.5 },
    { batches: 6, pct: 0.75 },
    { batches: 7, pct: 1.0 },
];

const interpolatePctByBaches = (b) => {
    if (b <= 4) return 0;
    if (b >= 7) return 1.0;
    // Buscar segmento
    for (let i = 0; i < BONUS_BACHES_THRESHOLDS.length - 1; i++) {
        const lo = BONUS_BACHES_THRESHOLDS[i];
        const hi = BONUS_BACHES_THRESHOLDS[i + 1];
        if (b >= lo.batches && b <= hi.batches) {
            const t = (b - lo.batches) / (hi.batches - lo.batches);
            return lo.pct + t * (hi.pct - lo.pct);
        }
    }
    return 0;
};

// Cuenta baches BASE Liquipops FINALES cuyo `startedAt` cae DENTRO del turno.
// Regla de negocio (2026-04-29): un bache cuenta para el turno donde se INICIA,
// no donde se esferifica. El operario que arranca el bache antes del fin del
// turno cumplió el cronograma — el siguiente turno hereda y termina.
// Solo cuentan baches con outputTarget en grupo 'LIQUIPOPS' (PERLAS finales),
// excluye intermedios como AZUCAR INVERTIDA / FRUCTOSA y AUX (ALG/PROT).
const countBatchesForShift = async (shiftStart, shiftEnd) => {
    const batches = await prisma.productionBatch.findMany({
        where: {
            startedAt: { gte: shiftStart, lt: shiftEnd },
            outputTargets: { some: { product: { group: { name: LIQUIPOPS_FINAL_GROUP } } } },
        },
        select: {
            id: true, batchNumber: true, flavor: true, startedAt: true,
            outputTargets: { select: { product: { select: { group: { select: { name: true } } } } } }
        },
    });
    let total = 0;
    for (const b of batches) {
        if (detectBatchType(b) === 'BASE' && isFinalLiquipopsBase(b)) total += 1;
    }
    return total;
};

// Devuelve true si en la ventana del turno hubo al menos una FALLA registrada
// (productionBatch flavor='FALLA' que solapa la ventana).
const shiftHadFailure = async (shiftStart, shiftEnd) => {
    const fail = await prisma.productionBatch.findFirst({
        where: {
            flavor: 'FALLA',
            OR: [
                { startedAt: { gte: shiftStart, lt: shiftEnd } },
                { scheduledStart: { gte: shiftStart, lt: shiftEnd } },
            ],
        },
        select: { id: true },
    });
    return !!fail;
};

exports.monthlyBonus = async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
        const leaderId = req.query.leaderId || null;
        if (!leaderId) return res.status(400).json({ success: false, error: 'leaderId requerido' });

        // Permitir override de bono base por query
        const baseBonus = parseInt(req.query.baseBonus || BONUS_DEFAULT_BASE, 10);
        const peoplePerGroup = parseInt(req.query.peoplePerGroup || BONUS_DEFAULT_PEOPLE, 10);

        // Resolver líder
        const leader = await prisma.shiftEmployee.findUnique({
            where: { id: leaderId }, select: { id: true, name: true },
        });
        if (!leader) return res.status(404).json({ success: false, error: 'Líder no encontrado' });

        // Rango del mes
        const [y, m] = month.split('-').map(Number);
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-${new Date(y, m, 0).getDate().toString().padStart(2, '0')}`;

        // Estimar total de turnos del mes asignados a este líder según shift_assignments
        // (si no podemos resolver, fallback a 78 turnos típicos del mes).
        const monthStartDate = new Date(`${monthStart}T00:00:00.000Z`);
        const monthEndDate   = new Date(`${monthEnd}T23:59:59.999Z`);
        const weeks = await prisma.shiftWeek.findMany({
            where: { weekEnd: { gte: monthStartDate }, weekStart: { lte: monthEndDate } },
            select: { id: true },
        });
        const weekIds = weeks.map(w => w.id);
        const assignments = weekIds.length > 0 ? await prisma.shiftAssignment.findMany({
            where: { weekId: { in: weekIds }, employeeId: leaderId },
            select: { id: true, shift: true },
        }) : [];
        // 1 asignación = 6 turnos por semana del mismo turno (Lun-Sáb), aproximación
        const totalShiftsInMonth = Math.max(1, assignments.length * 24); // 4 semanas × 6 días

        // Runs cerrados del líder en el mes (excluye ventanas sin producción)
        const allRunsLeader = await prisma.shiftDisciplineRun.findMany({
            where: {
                leaderId,
                closedAt: { not: null },
                shiftDate: { gte: monthStart, lte: monthEnd },
            },
            orderBy: [{ shiftDate: 'asc' }, { shiftStart: 'asc' }],
        });
        const runs = allRunsLeader.filter(r => !isNonWorkWindow(r.shiftDate, r.shiftCode));

        const valuePerShift = baseBonus / totalShiftsInMonth;

        let totalEarned = 0;
        let totalLost = 0;
        const details = [];

        for (const r of runs) {
            const baches = await countBatchesForShift(r.shiftStart, r.shiftEnd);
            const hadFailure = await shiftHadFailure(r.shiftStart, r.shiftEnd);
            const pctBaches = hadFailure ? 1.0 : interpolatePctByBaches(baches);
            const adherence = (r.finalScore || 0) / 100;
            const baseValue = valuePerShift;
            const retainedValue = baseValue * pctBaches * adherence;
            const lostValue = baseValue - retainedValue;

            const reasons = [];
            if (!hadFailure && baches < 7) {
                reasons.push(`Solo ${baches.toFixed(1)} baches (objetivo 7) → retiene ${(pctBaches*100).toFixed(0)}%`);
            }
            if (hadFailure) {
                reasons.push('FALLA registrada → no penaliza por baches');
            }
            if (adherence < 1) {
                reasons.push(`Adherencia ${Math.round((r.finalScore || 0))}% (factor ${(adherence).toFixed(2)})`);
            }

            totalEarned += retainedValue;
            totalLost   += lostValue;
            details.push({
                runId: r.id,
                date: r.shiftDate,
                shift: r.shiftCode,
                batches: parseFloat(baches.toFixed(2)),
                score: r.finalScore || 0,
                grade: r.finalGrade || null,
                hadFailure,
                baseValue: Math.round(baseValue),
                pctBaches: parseFloat((pctBaches * 100).toFixed(1)),
                adherence: parseFloat((adherence * 100).toFixed(1)),
                retainedValue: Math.round(retainedValue),
                lostValue: Math.round(lostValue),
                reason: reasons.join(' · ') || 'Cumplió 100%',
            });
        }

        const shiftsClosed     = runs.length;
        const shiftsRemaining  = Math.max(0, totalShiftsInMonth - shiftsClosed);
        const maxRecoverable   = shiftsRemaining * valuePerShift;
        const projectedTotal   = totalEarned + maxRecoverable; // si los próximos van 100%
        const percentRetained  = baseBonus > 0 ? Math.round((totalEarned / baseBonus) * 100) : 0;

        res.json({
            success: true,
            month,
            leaderId: leader.id,
            leaderName: leader.name,
            baseBonus,
            peoplePerGroup,
            baseBonusPerPerson: Math.round(baseBonus / peoplePerGroup),
            totalShiftsInMonth,
            shiftsClosed,
            shiftsRemaining,
            valuePerShift: Math.round(valuePerShift),
            totalEarned: Math.round(totalEarned),
            totalLost: Math.round(totalLost),
            projectedTotal: Math.round(projectedTotal),
            projectedPerPerson: Math.round(projectedTotal / peoplePerGroup),
            percentRetained,
            maxRecoverable: Math.round(maxRecoverable),
            details,
        });
    } catch (e) {
        logger.error('[shift-discipline] monthlyBonus error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

// Job que se ejecuta cada 5 min para detectar steps con > 15 min de retraso y enviar push
exports.checkRetrasos = async () => {
    try {
        const webPush = require('../services/webPushService');
        const open = await prisma.shiftDisciplineRun.findFirst({
            where: { closedAt: null },
            orderBy: { shiftStart: 'desc' },
        });
        if (!open) return;
        const steps = Array.isArray(open.steps) ? open.steps : JSON.parse(open.steps || '[]');
        const now = Date.now();
        const alerted = open.alertedSteps || [];
        const newAlerted = [...alerted];

        for (const step of steps) {
            if (step.type === 'COMIDA' || step.type === 'ALISTAMIENTO') continue;
            if (step.doneAt) continue;
            const ideal = new Date(step.idealTime).getTime();
            const delta = now - ideal;
            const alertKey = `s${step.n}`;
            if (delta >= 15 * 60000 && !alerted.includes(alertKey)) {
                await webPush.sendPushToAll({
                    title: '⚠️ Retraso en cronograma',
                    body: `${step.label} llegó tarde 15 min. Hora ideal: ${new Date(step.idealTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`,
                    icon: '/icon-192.png',
                    tag: `discipline-${alertKey}`,
                    data: { url: '/production/operator' }
                });
                newAlerted.push(alertKey);
                logger.info(`🔔 Push de retraso enviado: ${step.label} (${alertKey})`);
            }
        }
        if (newAlerted.length !== alerted.length) {
            await prisma.shiftDisciplineRun.update({
                where: { id: open.id },
                data: { steps, alertedSteps: newAlerted },
            }).catch(() => {});
        }
    } catch (e) {
        logger.warn('[shift-discipline] checkRetrasos error:', e.message);
    }
};

// Para uso interno por cron
exports._closeRun = async (id) => {
    let run = await prisma.shiftDisciplineRun.findUnique({ where: { id } });
    if (!run || run.closedAt) return null;
    // Asegurar líder asignado antes de cerrar (idempotente)
    run = await ensureLeaderId(run);
    const refreshedSteps = await refreshStepsFromProduction(run);
    const totalWeight = refreshedSteps.reduce((s, st) => s + ((st.weight ?? 1)), 0);
    const weightedScore = refreshedSteps.reduce((s, st) => s + ((st.score || 0) * ((st.weight ?? 1))), 0);
    const finalScore = Math.round(weightedScore / totalWeight);
    const finalGrade = computeFinalGrade(finalScore);
    return prisma.shiftDisciplineRun.update({
        where: { id }, data: { steps: refreshedSteps, finalScore, finalGrade, closedAt: new Date() },
    });
};

exports.SHIFT_TEMPLATE_BY_CODE = SHIFT_TEMPLATE_BY_CODE;

// ── Días especiales (festivos / no-laborados) ─────────────────────────────
// CRUD sobre systemSettings.NON_WORK_DAYS. Estructura:
//   { dates: [{ date: "YYYY-MM-DD", reason: "..." }] }
exports.listNonWorkDays = async (_req, res) => {
    try {
        const row = await prisma.systemSettings.findUnique({ where: { key: 'NON_WORK_DAYS' } });
        const list = row?.value?.dates || [];
        list.sort((a, b) => (a.date < b.date ? 1 : -1));
        res.json({ success: true, data: list });
    } catch (e) {
        logger.error('[shift-discipline] listNonWorkDays error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.addNonWorkDay = async (req, res) => {
    try {
        const { date, reason } = req.body || {};
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ success: false, error: 'date YYYY-MM-DD requerido' });
        }
        const row = await prisma.systemSettings.findUnique({ where: { key: 'NON_WORK_DAYS' } });
        const list = row?.value?.dates || [];
        if (!list.find(d => d.date === date)) {
            list.push({ date, reason: reason || 'No laborado' });
        }
        await prisma.systemSettings.upsert({
            where: { key: 'NON_WORK_DAYS' },
            create: { key: 'NON_WORK_DAYS', value: { dates: list } },
            update: { value: { dates: list } },
        });
        // También borrar runs ya creados para esa fecha (para que no afecten promedios)
        const deleted = await prisma.shiftDisciplineRun.deleteMany({ where: { shiftDate: date } });
        // Invalidar caché
        _nonWorkDaysCache = { dates: new Set(), ts: 0 };
        res.json({ success: true, data: list, runsDeleted: deleted.count });
    } catch (e) {
        logger.error('[shift-discipline] addNonWorkDay error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.removeNonWorkDay = async (req, res) => {
    try {
        const { date } = req.params;
        const row = await prisma.systemSettings.findUnique({ where: { key: 'NON_WORK_DAYS' } });
        const list = (row?.value?.dates || []).filter(d => d.date !== date);
        await prisma.systemSettings.upsert({
            where: { key: 'NON_WORK_DAYS' },
            create: { key: 'NON_WORK_DAYS', value: { dates: list } },
            update: { value: { dates: list } },
        });
        _nonWorkDaysCache = { dates: new Set(), ts: 0 };
        res.json({ success: true, data: list });
    } catch (e) {
        logger.error('[shift-discipline] removeNonWorkDay error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
