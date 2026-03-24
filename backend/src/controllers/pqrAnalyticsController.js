const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const PDFDocument = require('pdfkit');

const toQuantityNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const roundNumber = (value, decimals = 2) => {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
};

const percentile = (sortedValues, p) => {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
    if (p <= 0) return sortedValues[0];
    if (p >= 1) return sortedValues[sortedValues.length - 1];
    const pos = (sortedValues.length - 1) * p;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return sortedValues[lower];
    const weight = pos - lower;
    return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
};

const mean = (values) => {
    if (!values.length) return null;
    return values.reduce((sum, n) => sum + n, 0) / values.length;
};

const stdDev = (values, avgValue = null) => {
    if (values.length < 2) return 0;
    const avg = avgValue !== null ? avgValue : mean(values);
    const variance = values.reduce((sum, n) => sum + ((n - avg) ** 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
};

const normalizePresentationSize = (size) => {
    const digits = String(size || '').replace(/[^\d]/g, '');
    if (!digits) return 'sin-tamano';
    const asNumber = parseInt(digits, 10);
    if (!Number.isFinite(asNumber)) return 'sin-tamano';
    if (asNumber === 1100) return '1150g';
    return `${asNumber}g`;
};

const parseHourFromLotKey = (lotKey) => {
    if (!lotKey || String(lotKey).length < 8) return null;
    const hour = parseInt(String(lotKey).slice(6, 8), 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    return hour;
};

const hourToShift = (hour) => {
    if (hour === null || hour === undefined) return 'Sin turno';
    if (hour < 6) return 'Madrugada';
    if (hour < 12) return 'Mañana';
    if (hour < 18) return 'Tarde';
    return 'Noche';
};

const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
const safeDivideNumber = (a, b, fallback = 0) => (b ? a / b : fallback);
const sampleArrayDeterministic = (values, maxItems = 220) => {
    if (!Array.isArray(values) || values.length <= maxItems) return values || [];
    const sampled = [];
    const step = values.length / maxItems;
    for (let i = 0; i < maxItems; i++) {
        sampled.push(values[Math.floor(i * step)]);
    }
    return sampled;
};
const cliffsDeltaRobust = (groupA, groupB) => {
    if (!groupA.length || !groupB.length) return 0;
    const a = sampleArrayDeterministic(groupA, 220);
    const b = sampleArrayDeterministic(groupB, 220);
    let gt = 0;
    let lt = 0;
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            if (a[i] > b[j]) gt += 1;
            else if (a[i] < b[j]) lt += 1;
        }
    }
    const pairs = a.length * b.length;
    return pairs > 0 ? (gt - lt) / pairs : 0;
};
const erfApprox = (x) => {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * absX);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absX * absX);
    return sign * y;
};
const twoTailedPValue = (z) => {
    const cdf = 0.5 * (1 + erfApprox(Math.abs(z) / Math.SQRT2));
    return clampValue(2 * (1 - cdf), 0, 1);
};
const medianAbsoluteDeviation = (values, med = null) => {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const median = med !== null && med !== undefined ? med : percentile(sorted, 0.5);
    const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    return percentile(deviations, 0.5);
};

const DAY_MS = 1000 * 60 * 60 * 24;
const sigmoidSafe = (z) => 1 / (1 + Math.exp(-clampValue(z, -35, 35)));
const FOLLOW_UP_RECENT_DAYS = 7;
const FOLLOW_UP_MONITOR_DAYS = 14;
const FOLLOW_UP_STOPPED_DAYS = 21;
const CONTINUATION_LOOKBACK_DAYS = 14;
const CONTINUATION_HORIZON_DAYS = 14;
const FINAL_COVERAGE_WINDOW_DAYS = 45;
const SEVERITY_PRIORITY_WEIGHT = {
    recall: 1.45,
    critical: 1.3,
    warning: 1.12,
    review: 1,
    normal: 0.92
};
const CONTINUITY_PRIORITY_WEIGHT = {
    nuevo_riesgo: 1.18,
    activo_recurrente: 1.25,
    vigilancia: 1,
    enfriando: 0.78,
    sin_reporte_reciente: 0.58,
    sin_datos: 0.65
};

const LOT_CONTINUITY_BUCKETS = [
    {
        key: 'nuevo_riesgo',
        label: 'Nuevos en riesgo',
        description: 'Lotes nuevos con reportes recientes y alta continuidad probable.',
        color: '#7c3aed'
    },
    {
        key: 'activo_recurrente',
        label: 'Siguen dañandose',
        description: 'Lotes con reportes recientes que siguen activos en reclamo.',
        color: '#dc2626'
    },
    {
        key: 'vigilancia',
        label: 'En vigilancia',
        description: 'Lotes con continuidad moderada o en ventana de observacion.',
        color: '#f59e0b'
    },
    {
        key: 'enfriando',
        label: 'En enfriamiento',
        description: 'Lotes cuya presion de reportes ya viene bajando.',
        color: '#06b6d4'
    },
    {
        key: 'sin_reporte_reciente',
        label: 'Sin reporte reciente',
        description: 'Lotes con mas de 21 dias sin reporte; candidatos a cierre.',
        color: '#10b981'
    },
    {
        key: 'sin_datos',
        label: 'Sin datos',
        description: 'Lotes sin datos suficientes para clasificar continuidad.',
        color: '#94a3b8'
    }
];

const LOT_CONTINUITY_BUCKET_META = LOT_CONTINUITY_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = bucket;
    return acc;
}, {});

const DEFECT_ALIAS_MAP = {
    INFLADO: 'INFLADO',
    INFLADOS: 'INFLADO',
    MAL_SELLADO: 'MAL_SELLADO',
    MALSELLADO: 'MAL_SELLADO',
    MAL_ETIQUETADO: 'MAL_ETIQUETADO',
    MALETIQUETADO: 'MAL_ETIQUETADO',
    TARRO_VACIO: 'TARRO_VACIO',
    TARROVACIO: 'TARRO_VACIO',
    ELEMENTO_EXTRANO: 'ELEMENTO_EXTRANO',
    ELEMENTOEXTRANO: 'ELEMENTO_EXTRANO',
    SABOR_DIFERENTE: 'SABOR_DIFERENTE',
    SABORDIFERENTE: 'SABOR_DIFERENTE',
    AVERIA_TRANSPORTE: 'AVERIA_TRANSPORTE',
    AVERIATRANSPORTE: 'AVERIA_TRANSPORTE',
    CALCIFICACION: 'CALCIFICACION',
    CONTAMINADO: 'CONTAMINADO',
    FALTANTE: 'FALTANTE',
    SOBRANTE: 'SOBRANTE',
    TROCADO: 'TROCADO',
    VENCIDO: 'VENCIDO',
    OTRO: 'OTRO',
    CALIDAD: 'OTRO'
};

const DEFECT_PATTERN_RULES = [
    { key: 'INFLADO', regex: /\bINFLAD[OA]S?\b/ },
    { key: 'MAL_SELLADO', regex: /\bMAL[\s_-]*SELLAD[OA]S?\b/ },
    { key: 'MAL_ETIQUETADO', regex: /\bMAL[\s_-]*ETIQUETAD[OA]S?\b/ },
    { key: 'TARRO_VACIO', regex: /\bTARR?O[\s_-]*VACI[OA]S?\b/ },
    { key: 'ELEMENTO_EXTRANO', regex: /\bELEMENTO[\s_-]*EXTRAN[OA]S?\b/ },
    { key: 'SABOR_DIFERENTE', regex: /\bSABOR[\s_-]*DIFERENTE\b/ },
    { key: 'AVERIA_TRANSPORTE', regex: /\bAVERI[A]?\s*(DE\s*)?TRANSPORTE\b/ },
    { key: 'CALCIFICACION', regex: /\bCALCIFICACION\b/ },
    { key: 'CONTAMINADO', regex: /\bCONTAMINAD[OA]S?\b/ },
    { key: 'FALTANTE', regex: /\bFALTANTE(S)?\b/ },
    { key: 'SOBRANTE', regex: /\bSOBRANTE(S)?\b/ },
    { key: 'TROCADO', regex: /\bTROCAD[OA]S?\b/ },
    { key: 'VENCIDO', regex: /\bVENCID[OA]S?\b/ }
];

const DEFECT_PRIOR_ADJUSTMENT_PCT = {
    INFLADO: 10,
    CONTAMINADO: 11,
    ELEMENTO_EXTRANO: 9,
    MAL_SELLADO: -4,
    TARRO_VACIO: 5,
    CALCIFICACION: 6,
    FALTANTE: 5,
    SABOR_DIFERENTE: 4,
    MAL_ETIQUETADO: -2,
    TROCADO: 2,
    VENCIDO: 4,
    AVERIA_TRANSPORTE: -1,
    SOBRANTE: -2,
    OTRO: 0
};

const DEFECT_ALERT_POLICY = {
    INFLADO: {
        mode: 'grave',
        warningRatePct: 0.35,
        criticalRatePct: 0.9,
        recallRatePct: 2.2,
        warningUnits: 22,
        criticalUnits: 75,
        recallUnits: 180,
        probabilityPenaltyPct: 0
    },
    CONTAMINADO: {
        mode: 'grave',
        warningRatePct: 0.28,
        criticalRatePct: 0.75,
        recallRatePct: 1.9,
        warningUnits: 18,
        criticalUnits: 60,
        recallUnits: 140,
        probabilityPenaltyPct: 0
    },
    ELEMENTO_EXTRANO: {
        mode: 'grave',
        warningRatePct: 0.3,
        criticalRatePct: 0.8,
        recallRatePct: 2.0,
        warningUnits: 20,
        criticalUnits: 65,
        recallUnits: 150,
        probabilityPenaltyPct: 0
    },
    TARRO_VACIO: {
        mode: 'grave',
        warningRatePct: 0.4,
        criticalRatePct: 1.0,
        recallRatePct: 2.5,
        warningUnits: 25,
        criticalUnits: 80,
        recallUnits: 200,
        probabilityPenaltyPct: 0
    },
    CALCIFICACION: {
        mode: 'grave',
        warningRatePct: 0.45,
        criticalRatePct: 1.1,
        recallRatePct: 2.6,
        warningUnits: 28,
        criticalUnits: 85,
        recallUnits: 210,
        probabilityPenaltyPct: 0
    },
    FALTANTE: {
        mode: 'grave',
        warningRatePct: 0.5,
        criticalRatePct: 1.2,
        recallRatePct: 2.8,
        warningUnits: 30,
        criticalUnits: 90,
        recallUnits: 220,
        probabilityPenaltyPct: 2
    },
    SABOR_DIFERENTE: {
        mode: 'grave',
        warningRatePct: 0.55,
        criticalRatePct: 1.25,
        recallRatePct: 3.0,
        warningUnits: 32,
        criticalUnits: 95,
        recallUnits: 230,
        probabilityPenaltyPct: 2
    },
    VENCIDO: {
        mode: 'grave',
        warningRatePct: 0.5,
        criticalRatePct: 1.25,
        recallRatePct: 3.0,
        warningUnits: 30,
        criticalUnits: 95,
        recallUnits: 230,
        probabilityPenaltyPct: 1
    },
    MAL_SELLADO: {
        mode: 'revision',
        warningRatePct: 0.95,
        criticalRatePct: 1.9,
        recallRatePct: 3.6,
        warningUnits: 40,
        criticalUnits: 120,
        recallUnits: 280,
        probabilityPenaltyPct: 16
    },
    MAL_ETIQUETADO: {
        mode: 'revision',
        warningRatePct: 0.85,
        criticalRatePct: 1.8,
        recallRatePct: 3.4,
        warningUnits: 36,
        criticalUnits: 110,
        recallUnits: 260,
        probabilityPenaltyPct: 12
    },
    AVERIA_TRANSPORTE: {
        mode: 'revision',
        warningRatePct: 0.75,
        criticalRatePct: 1.6,
        recallRatePct: 3.2,
        warningUnits: 34,
        criticalUnits: 105,
        recallUnits: 250,
        probabilityPenaltyPct: 10
    },
    SOBRANTE: {
        mode: 'revision',
        warningRatePct: 0.9,
        criticalRatePct: 2.0,
        recallRatePct: 3.8,
        warningUnits: 42,
        criticalUnits: 120,
        recallUnits: 280,
        probabilityPenaltyPct: 11
    },
    TROCADO: {
        mode: 'revision',
        warningRatePct: 0.85,
        criticalRatePct: 1.85,
        recallRatePct: 3.5,
        warningUnits: 38,
        criticalUnits: 115,
        recallUnits: 270,
        probabilityPenaltyPct: 10
    },
    OTRO: {
        mode: 'revision',
        warningRatePct: 0.8,
        criticalRatePct: 1.7,
        recallRatePct: 3.3,
        warningUnits: 35,
        criticalUnits: 110,
        recallUnits: 260,
        probabilityPenaltyPct: 9
    }
};

const getDefectAlertPolicy = (defectType) => {
    const key = resolveDefectAlias(defectType) || 'OTRO';
    return DEFECT_ALERT_POLICY[key] || DEFECT_ALERT_POLICY.OTRO;
};

const normalizeDefectToken = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const resolveDefectAlias = (value) => {
    const token = normalizeDefectToken(value);
    if (!token) return null;
    if (Object.prototype.hasOwnProperty.call(DEFECT_ALIAS_MAP, token)) return DEFECT_ALIAS_MAP[token];
    return null;
};

const formatDefectLabel = (defectType) => {
    const key = resolveDefectAlias(defectType) || 'OTRO';
    return key.replace(/_/g, ' ');
};

const extractDefectTypeFromText = (description, fallbackType = null) => {
    const rawText = String(description || '');
    if (rawText) {
        const bracketMatch = rawText.match(/\[\s*Defecto\s*:\s*([^\]]+)\]/i);
        if (bracketMatch?.[1]) {
            const fromBracket = resolveDefectAlias(bracketMatch[1]);
            if (fromBracket) return fromBracket;
        }

        const normalizedText = rawText
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
        for (let i = 0; i < DEFECT_PATTERN_RULES.length; i += 1) {
            const rule = DEFECT_PATTERN_RULES[i];
            if (rule.regex.test(normalizedText)) return rule.key;
        }

        const cleaned = resolveDefectAlias(rawText);
        if (cleaned) return cleaned;
    }

    const fallbackDefect = resolveDefectAlias(fallbackType);
    return fallbackDefect || 'OTRO';
};

const lotDigitsToDisplay = (digitsValue) => {
    const digits = String(digitsValue || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    return `${digits.slice(0, 6)}-${digits.slice(6, 10)}`;
};

const parseLotReference = (lotValue) => {
    const raw = String(lotValue || '').trim();
    const digits = raw.replace(/\D/g, '');
    const dateKey = digits.length >= 6 ? digits.slice(0, 6) : null;
    const timeToken = digits.length > 6 ? digits.slice(6, 10) : null;
    const hasFullTime = Boolean(timeToken && timeToken.length === 4);
    const canonical10 = hasFullTime && dateKey ? `${dateKey}${timeToken}` : null;
    return {
        raw,
        digits,
        dateKey,
        timeToken,
        hasFullTime,
        isShortAlias: Boolean(dateKey) && !hasFullTime,
        canonical10,
        canonicalDisplay: canonical10 ? lotDigitsToDisplay(canonical10) : null
    };
};

const buildDefectSummaryFromItems = (items) => {
    const defectCounts = {};
    const defectUnits = {};
    (items || []).forEach((item) => {
        const defectType = resolveDefectAlias(item.defectType)
            || extractDefectTypeFromText(item.description, item.type)
            || 'OTRO';
        const qty = toQuantityNumber(item.quantity);
        defectCounts[defectType] = (defectCounts[defectType] || 0) + 1;
        defectUnits[defectType] = (defectUnits[defectType] || 0) + qty;
    });

    const defectEntries = Object.entries(defectCounts).sort((a, b) => b[1] - a[1]);
    const defectUnitEntries = Object.entries(defectUnits).sort((a, b) => toQuantityNumber(b[1]) - toQuantityNumber(a[1]));
    const totalDefectReports = defectEntries.reduce((sum, [, count]) => sum + toQuantityNumber(count), 0);
    const totalDefectUnits = defectUnitEntries.reduce((sum, [, qty]) => sum + toQuantityNumber(qty), 0);
    const primaryDefect = defectUnitEntries[0]?.[0] || defectEntries[0]?.[0] || 'OTRO';
    const primaryDefectCount = toQuantityNumber((defectEntries.find(([type]) => type === primaryDefect) || [null, 0])[1]);
    const primaryDefectUnits = toQuantityNumber((defectUnitEntries.find(([type]) => type === primaryDefect) || [null, 0])[1]);
    const defectMix = defectEntries.slice(0, 6).map(([defectType, count]) => ({
        defectType,
        label: formatDefectLabel(defectType),
        count: toQuantityNumber(count),
        sharePct: totalDefectReports > 0
            ? roundNumber((toQuantityNumber(count) / totalDefectReports) * 100, 1)
            : 0
    }));
    const defectMixByUnits = defectUnitEntries.slice(0, 6).map(([defectType, qty]) => ({
        defectType,
        label: formatDefectLabel(defectType),
        units: roundNumber(toQuantityNumber(qty), 2),
        sharePct: totalDefectUnits > 0
            ? roundNumber((toQuantityNumber(qty) / totalDefectUnits) * 100, 1)
            : 0
    }));

    return {
        primaryDefect,
        primaryDefectLabel: formatDefectLabel(primaryDefect),
        primaryDefectCount,
        primaryDefectUnits,
        totalDefectReports,
        totalDefectUnits,
        defectMix,
        defectMixByUnits,
        defectUnitsByType: defectUnits
    };
};

const buildDefectContinuationModel = (samples) => {
    if (!Array.isArray(samples) || samples.length === 0) {
        return {
            globalContinueRatePct: null,
            sampleSize: 0,
            byDefect: {},
            topDefects: []
        };
    }

    const usable = samples
        .map((sample) => ({
            defectType: resolveDefectAlias(sample.defectType) || 'OTRO',
            label: sample.label ? 1 : 0
        }))
        .filter((sample) => sample.defectType);
    if (!usable.length) {
        return {
            globalContinueRatePct: null,
            sampleSize: 0,
            byDefect: {},
            topDefects: []
        };
    }

    const globalContinueRate = safeDivideNumber(
        usable.reduce((sum, sample) => sum + sample.label, 0),
        usable.length,
        0
    );
    const priorWeight = 6;
    const aggregate = {};
    usable.forEach((sample) => {
        if (!aggregate[sample.defectType]) {
            aggregate[sample.defectType] = {
                defectType: sample.defectType,
                sampleSize: 0,
                continueCount: 0
            };
        }
        aggregate[sample.defectType].sampleSize += 1;
        aggregate[sample.defectType].continueCount += sample.label;
    });

    const profiles = Object.values(aggregate)
        .map((entry) => {
            const priorAdjustment = toQuantityNumber(
                DEFECT_PRIOR_ADJUSTMENT_PCT[entry.defectType] ?? DEFECT_PRIOR_ADJUSTMENT_PCT.OTRO
            );
            const priorRate = clampValue(globalContinueRate + (priorAdjustment / 100), 0.03, 0.97);
            const observedRate = safeDivideNumber(entry.continueCount, entry.sampleSize, 0);
            const smoothedRate = safeDivideNumber(
                entry.continueCount + (priorRate * priorWeight),
                entry.sampleSize + priorWeight,
                observedRate
            );
            const supportFactor = clampValue(entry.sampleSize / 20, 0.25, 1);
            const adjustmentPct = clampValue((smoothedRate - globalContinueRate) * 100 * supportFactor, -18, 18);
            const growthFactor = clampValue(1 + (adjustmentPct / 100) * 0.65, 0.82, 1.2);
            const policy = getDefectAlertPolicy(entry.defectType);

            let riskBand = 'neutral';
            if (adjustmentPct >= 6) riskBand = 'alto_arrastre';
            else if (adjustmentPct >= 2) riskBand = 'arrastre_medio';
            else if (adjustmentPct <= -4) riskBand = 'autolimitado';

            return {
                defectType: entry.defectType,
                label: formatDefectLabel(entry.defectType),
                sampleSize: entry.sampleSize,
                continueCount: entry.continueCount,
                continueRatePct: roundNumber(observedRate * 100, 2),
                smoothedContinueRatePct: roundNumber(smoothedRate * 100, 2),
                adjustmentPct: roundNumber(adjustmentPct, 2),
                growthFactor: roundNumber(growthFactor, 3),
                riskBand,
                policyMode: policy.mode
            };
        })
        .sort((a, b) => b.sampleSize - a.sampleSize);

    const byDefect = {};
    profiles.forEach((profile) => {
        byDefect[profile.defectType] = profile;
    });

    if (!byDefect.OTRO) {
        byDefect.OTRO = {
            defectType: 'OTRO',
            label: 'OTRO',
            sampleSize: 0,
            continueCount: 0,
            continueRatePct: roundNumber(globalContinueRate * 100, 2),
            smoothedContinueRatePct: roundNumber(globalContinueRate * 100, 2),
            adjustmentPct: 0,
            growthFactor: 1,
            riskBand: 'neutral',
            policyMode: getDefectAlertPolicy('OTRO').mode
        };
    }

    return {
        globalContinueRatePct: roundNumber(globalContinueRate * 100, 2),
        sampleSize: usable.length,
        byDefect,
        topDefects: profiles.slice(0, 10)
    };
};

const resolveDefectContinuationProfile = (model, defectType) => {
    const key = resolveDefectAlias(defectType) || 'OTRO';
    const stored = model?.byDefect?.[key];
    if (stored) return stored;

    const priorAdjustment = toQuantityNumber(DEFECT_PRIOR_ADJUSTMENT_PCT[key] ?? DEFECT_PRIOR_ADJUSTMENT_PCT.OTRO);
    const policy = getDefectAlertPolicy(key);
    return {
        defectType: key,
        label: formatDefectLabel(key),
        sampleSize: 0,
        continueCount: 0,
        continueRatePct: model?.globalContinueRatePct ?? null,
        smoothedContinueRatePct: model?.globalContinueRatePct ?? null,
        adjustmentPct: roundNumber(priorAdjustment * 0.6, 2),
        growthFactor: roundNumber(clampValue(1 + ((priorAdjustment * 0.6) / 100) * 0.65, 0.82, 1.2), 3),
        riskBand: priorAdjustment >= 6 ? 'alto_arrastre' : priorAdjustment >= 2 ? 'arrastre_medio' : priorAdjustment <= -4 ? 'autolimitado' : 'neutral',
        policyMode: policy.mode
    };
};

const computeDefectPressureAgainstGood = ({ defectUnits, producedUnitsTotal }) => {
    const defectiveUnits = Math.max(0, toQuantityNumber(defectUnits));
    const producedUnits = Math.max(0, toQuantityNumber(producedUnitsTotal));
    if (producedUnits <= 0) {
        return {
            defectiveUnits,
            producedUnits,
            goodUnits: null,
            defectRatePct: null,
            defectVsGoodPct: null,
            hasGoodReference: false
        };
    }

    const goodUnits = Math.max(producedUnits - defectiveUnits, 0);
    const denominator = goodUnits + defectiveUnits;
    const defectRatePct = roundNumber((defectiveUnits / producedUnits) * 100, 4);
    const defectVsGoodPct = denominator > 0
        ? roundNumber((defectiveUnits / denominator) * 100, 4)
        : null;
    return {
        defectiveUnits,
        producedUnits,
        goodUnits,
        defectRatePct,
        defectVsGoodPct,
        hasGoodReference: true
    };
};

const classifySeverityByEnvases = ({
    defectType,
    defectUnits,
    producedUnitsTotal,
    reportCount
}) => {
    const policy = getDefectAlertPolicy(defectType);
    const pressure = computeDefectPressureAgainstGood({ defectUnits, producedUnitsTotal });
    const units = pressure.defectiveUnits;
    const defectRate = toQuantityNumber(
        pressure.defectVsGoodPct !== null && pressure.defectVsGoodPct !== undefined
            ? pressure.defectVsGoodPct
            : pressure.defectRatePct
    );

    let severity = 'normal';
    if (pressure.hasGoodReference) {
        if (defectRate >= toQuantityNumber(policy.recallRatePct) || units >= toQuantityNumber(policy.recallUnits)) {
            severity = 'recall';
        } else if (defectRate >= toQuantityNumber(policy.criticalRatePct) || units >= toQuantityNumber(policy.criticalUnits)) {
            severity = 'critical';
        } else if (defectRate >= toQuantityNumber(policy.warningRatePct) || units >= toQuantityNumber(policy.warningUnits)) {
            severity = policy.mode === 'revision' ? 'review' : 'warning';
        } else if (policy.mode === 'revision' && units > 0) {
            severity = 'review';
        }
    } else {
        if (units >= toQuantityNumber(policy.recallUnits) || units >= 220) {
            severity = 'recall';
        } else if (units >= toQuantityNumber(policy.criticalUnits) || units >= 90) {
            severity = 'critical';
        } else if (units >= toQuantityNumber(policy.warningUnits) || toQuantityNumber(reportCount) >= 3) {
            severity = policy.mode === 'revision' ? 'review' : 'warning';
        } else if (policy.mode === 'revision' && units > 0) {
            severity = 'review';
        }
    }

    if (policy.mode === 'revision' && pressure.hasGoodReference && (severity === 'critical' || severity === 'recall')) {
        const guarded = defectRate < (toQuantityNumber(policy.criticalRatePct) * 1.3)
            && units < (toQuantityNumber(policy.criticalUnits) * 1.25);
        if (guarded) severity = 'review';
    }

    return {
        severity,
        policyMode: policy.mode,
        pressure
    };
};

const applyDefectReviewGuard = ({
    defectType,
    baseProbabilityPct,
    defectUnits,
    producedUnitsTotal
}) => {
    const policy = getDefectAlertPolicy(defectType);
    const pressure = computeDefectPressureAgainstGood({ defectUnits, producedUnitsTotal });
    let adjusted = clampValue(toQuantityNumber(baseProbabilityPct), 1, 99);
    let guardLevel = 'none';

    if (policy.mode === 'revision' && pressure.hasGoodReference) {
        const defectRate = toQuantityNumber(
            pressure.defectVsGoodPct !== null && pressure.defectVsGoodPct !== undefined
                ? pressure.defectVsGoodPct
                : pressure.defectRatePct
        );
        const lowRate = defectRate < toQuantityNumber(policy.warningRatePct);
        const mediumRate = defectRate < toQuantityNumber(policy.criticalRatePct);
        const lowUnits = pressure.defectiveUnits < toQuantityNumber(policy.warningUnits);

        if (lowRate || (mediumRate && lowUnits)) {
            adjusted -= toQuantityNumber(policy.probabilityPenaltyPct);
            guardLevel = 'strong';
        } else if (mediumRate) {
            adjusted -= (toQuantityNumber(policy.probabilityPenaltyPct) * 0.55);
            guardLevel = 'soft';
        }
    }

    return {
        adjustedProbabilityPct: Math.round(clampValue(adjusted, 1, 99)),
        guardLevel,
        policyMode: policy.mode,
        pressure
    };
};

const buildLotSnapshotAtDate = ({ reportEvents, firstReportDate, asOfDate, producedUnitsTotal = 0 }) => {
    if (!Array.isArray(reportEvents) || reportEvents.length === 0) return null;
    const firstDate = new Date(firstReportDate);
    const asOf = new Date(asOfDate);
    if (isNaN(firstDate.getTime()) || isNaN(asOf.getTime())) return null;

    const events = reportEvents
        .map((event) => {
            const d = new Date(event.date);
            if (isNaN(d.getTime())) return null;
            return {
                dateObj: d,
                reports: toQuantityNumber(event.reports),
                units: toQuantityNumber(event.units)
            };
        })
        .filter(Boolean)
        .filter((event) => event.dateObj <= asOf)
        .sort((a, b) => a.dateObj - b.dateObj);

    if (!events.length) return null;

    let reportedUnitsToDate = 0;
    let reports7d = 0;
    let reports14d = 0;
    let reportsPrevious7d = 0;
    let units7d = 0;
    let units14d = 0;
    let uniqueReportDays14d = 0;

    const recent14dDates = [];
    events.forEach((event) => {
        reportedUnitsToDate += event.units;
        const ageDays = Math.floor((asOf - event.dateObj) / DAY_MS);
        if (ageDays < 0) return;

        if (ageDays <= 14) {
            reports14d += event.reports;
            units14d += event.units;
            uniqueReportDays14d += 1;
            recent14dDates.push(event.dateObj);
        } else if (ageDays <= 21) {
            reportsPrevious7d += event.reports;
        }
        if (ageDays <= 7) {
            reports7d += event.reports;
            units7d += event.units;
        }
    });

    let cadenceAvgDays14d = null;
    if (recent14dDates.length > 1) {
        let gapSum = 0;
        let gapCount = 0;
        for (let i = 1; i < recent14dDates.length; i += 1) {
            const gap = Math.max(0, Math.round((recent14dDates[i] - recent14dDates[i - 1]) / DAY_MS));
            gapSum += gap;
            gapCount += 1;
        }
        cadenceAvgDays14d = gapCount > 0 ? roundNumber(gapSum / gapCount, 2) : null;
    }

    const lastEventDate = events[events.length - 1].dateObj;
    const daysSinceLastReport = Math.max(0, Math.floor((asOf - lastEventDate) / DAY_MS));
    const daysSinceFirstReportAtAsOf = Math.max(0, Math.floor((asOf - firstDate) / DAY_MS));
    const trend7vPrev7 = reportsPrevious7d > 0
        ? reports7d / reportsPrevious7d
        : (reports7d > 0 ? 2 : 0);
    const coveragePct = producedUnitsTotal > 0
        ? clampValue((reportedUnitsToDate / producedUnitsTotal) * 100, 0, 100)
        : null;

    return {
        reports7d,
        reports14d,
        reportsPrevious7d,
        units7d: roundNumber(units7d, 4),
        units14d: roundNumber(units14d, 4),
        uniqueReportDays14d,
        daysSinceLastReport,
        daysSinceFirstReportAtAsOf,
        cadenceAvgDays14d,
        trend7vPrev7: roundNumber(trend7vPrev7, 4),
        reportedUnitsToDate: roundNumber(reportedUnitsToDate, 4),
        coveragePct: coveragePct !== null ? roundNumber(coveragePct, 4) : null
    };
};

const resolveOperationalContinuityBucket = ({
    status,
    daysSinceLastReport,
    isNewLot
}) => {
    const daysSinceLast = toFiniteNumber(daysSinceLastReport);
    if (daysSinceLast === null) return LOT_CONTINUITY_BUCKET_META.sin_datos;
    if (daysSinceLast > FOLLOW_UP_STOPPED_DAYS || status === 'detenida') {
        return LOT_CONTINUITY_BUCKET_META.sin_reporte_reciente;
    }
    if (status === 'nuevo') return LOT_CONTINUITY_BUCKET_META.nuevo_riesgo;
    if (status === 'continua') return LOT_CONTINUITY_BUCKET_META.activo_recurrente;
    if (status === 'observacion') return LOT_CONTINUITY_BUCKET_META.vigilancia;
    if (status === 'enfriando') return LOT_CONTINUITY_BUCKET_META.enfriando;
    if (isNewLot && daysSinceLast <= FOLLOW_UP_RECENT_DAYS) {
        return LOT_CONTINUITY_BUCKET_META.nuevo_riesgo;
    }
    return LOT_CONTINUITY_BUCKET_META.vigilancia;
};

const resolvePredictionFallbackMeta = (fallbackReason) => {
    const minimumMatureHistoryDays = CONTINUATION_LOOKBACK_DAYS + CONTINUATION_HORIZON_DAYS;
    if (fallbackReason === 'insufficient_mature_history') {
        return {
            label: 'Historial aun inmaduro',
            detail: `Todavia no existen lotes con al menos ${minimumMatureHistoryDays} dias entre ventana de observacion y horizonte de continuidad.`
        };
    }
    if (fallbackReason === 'insufficient_snapshot_activity') {
        return {
            label: 'Snapshots insuficientes',
            detail: 'Existe historia temporal, pero aun no hay suficiente densidad de reportes para construir snapshots supervisados utiles.'
        };
    }
    if (fallbackReason === 'insufficient_samples') {
        return {
            label: 'Muestra insuficiente',
            detail: 'La cobertura historica disponible todavia no aporta el volumen minimo para estabilizar un modelo supervisado.'
        };
    }
    return {
        label: 'Cobertura historica limitada',
        detail: 'La prediccion opera con la mejor evidencia disponible, pero todavia no cuenta con una base supervisada madura.'
    };
};

const buildPredictionModelNarrative = ({
    trained,
    fallbackReason,
    trainingSamples,
    trainingDiagnostics,
    reliabilityScorePct,
    calibration
}) => {
    const minimumMatureHistoryDays = CONTINUATION_LOOKBACK_DAYS + CONTINUATION_HORIZON_DAYS;
    const reliability = toQuantityNumber(reliabilityScorePct);
    const samples = toQuantityNumber(trainingSamples);
    const candidateLots = toQuantityNumber(trainingDiagnostics?.candidateLots);
    const lookbackEligibleLots = toQuantityNumber(trainingDiagnostics?.lookbackEligibleLots);
    const horizonEligibleLots = toQuantityNumber(trainingDiagnostics?.horizonEligibleLots);
    const usableSnapshotLots = toQuantityNumber(trainingDiagnostics?.usableSnapshotLots);
    const fallbackMeta = resolvePredictionFallbackMeta(fallbackReason);

    let readinessLevel = 'baja';
    let readinessLabel = 'Lectura exploratoria';
    if (trained && reliability >= 72) {
        readinessLevel = 'alta';
        readinessLabel = 'Modelo supervisado confiable';
    } else if (trained || reliability >= 46 || lookbackEligibleLots >= 25) {
        readinessLevel = 'media';
        readinessLabel = trained ? 'Modelo supervisado util' : 'Cold-start controlado';
    }

    let summary = `Modelo supervisado entrenado con ${samples} muestras y soporte de evidencia temporal para estabilizar la lectura lote a lote.`;
    let limitation = calibration?.isCalibrated
        ? 'La cobertura final ya cuenta con calibracion historica adicional.'
        : 'La cobertura final aun no tiene calibracion historica suficiente.';
    let nextMilestone = calibration?.isCalibrated
        ? 'Mantener el monitoreo del error de calibracion y ampliar la muestra supervisada.'
        : 'Ampliar lotes maduros para calibrar mejor la cobertura final esperada.';
    let recommendedUse = 'Use probabilidad, impacto ajustado y confianza en conjunto para priorizar acciones operativas.';

    if (!trained) {
        summary = fallbackReason === 'insufficient_mature_history'
            ? `El motor opera en evidencia temporal porque ${horizonEligibleLots} de ${candidateLots} lotes alcanzan hoy el horizonte minimo de ${minimumMatureHistoryDays} dias para entrenamiento supervisado.`
            : `El motor opera con evidencia temporal porque solo ${usableSnapshotLots} snapshots utiles estan disponibles para entrenamiento supervisado.`;
        limitation = fallbackMeta.detail;
        nextMilestone = fallbackReason === 'insufficient_mature_history'
            ? `A medida que los lotes completen ${minimumMatureHistoryDays}+ dias desde su primer reporte, el sistema podra activar entrenamiento supervisado.`
            : 'Incrementar densidad de reportes observables y snapshots utiles para habilitar el entrenamiento supervisado.';
        recommendedUse = 'Use la proyeccion ajustada como ranking operativo, siempre leyendo junto con recencia, severidad y cobertura abierta.';
    }

    return {
        executionMode: trained ? 'supervised_blended' : 'evidence_engine_cold_start',
        methodologyLabel: trained
            ? 'Modelo supervisado + evidencia temporal'
            : 'Motor de evidencia temporal',
        readiness: {
            level: readinessLevel,
            label: readinessLabel
        },
        summary,
        limitation,
        nextMilestone,
        recommendedUse,
        minimumMatureHistoryDays,
        coverageStatus: calibration?.isCalibrated ? 'calibrated' : 'uncalibrated',
        fallbackLabel: trained ? null : fallbackMeta.label
    };
};

const classifyContinuityAnalysisQuality = ({
    predictionModel,
    confidenceValues,
    totalLots
}) => {
    const values = Array.isArray(confidenceValues)
        ? confidenceValues.filter((value) => Number.isFinite(value))
        : [];
    const sortedValues = [...values].sort((a, b) => a - b);
    const avgConfidence = values.length
        ? roundNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 1)
        : null;
    const medianConfidence = values.length
        ? roundNumber(percentile(sortedValues, 0.5), 1)
        : null;
    const trained = Boolean(predictionModel?.trained);
    const reliabilityScorePct = toQuantityNumber(predictionModel?.reliabilityScorePct);
    const fallbackReason = predictionModel?.fallbackReason || null;
    const minimumMatureHistoryDays = toQuantityNumber(predictionModel?.minimumMatureHistoryDays)
        || (CONTINUATION_LOOKBACK_DAYS + CONTINUATION_HORIZON_DAYS);

    let level = 'baja';
    let label = 'Proyeccion orientativa';
    let hint = 'Use la proyeccion como ranking exploratorio y priorice la evidencia observada reciente.';
    let recommendedLens = 'observado_primero';

    if (trained && (avgConfidence || 0) >= 62 && reliabilityScorePct >= 68 && totalLots >= 60) {
        level = 'alta';
        label = 'Proyeccion confiable';
        hint = 'La proyeccion puede usarse como soporte fuerte de priorizacion.';
        recommendedLens = 'proyeccion_confiable';
    } else if ((trained && (avgConfidence || 0) >= 48 && reliabilityScorePct >= 50) || (avgConfidence || 0) >= 38) {
        level = 'media';
        label = 'Proyeccion util con cautela';
        hint = 'Combine tendencia reciente, severidad y proyeccion ajustada por confianza.';
        recommendedLens = 'mixto';
    }

    if (!trained && fallbackReason === 'insufficient_mature_history' && (avgConfidence || 0) >= 46 && totalLots >= 40) {
        level = 'media';
        label = 'Lectura observacional estable';
        hint = `La priorizacion es util, pero todavia no existen lotes con ${minimumMatureHistoryDays}+ dias para activar entrenamiento supervisado.`;
        recommendedLens = 'observado_con_proyeccion_ajustada';
    } else if (!trained && fallbackReason === 'insufficient_snapshot_activity') {
        level = level === 'alta' ? 'media' : level;
        label = 'Lectura parcial';
        hint = 'Existe historia temporal, pero faltan snapshots con suficiente actividad para consolidar un modelo supervisado.';
        recommendedLens = 'observado_primero';
    }

    return {
        level,
        label,
        hint,
        recommendedLens,
        trained,
        fallbackReason,
        reliabilityScorePct,
        averageConfidencePct: avgConfidence,
        medianConfidencePct: medianConfidence,
        sampleSize: values.length
    };
};

const extractContinuationFeatures = (snapshot) => {
    if (!snapshot) return null;
    return [
        Math.log1p(toQuantityNumber(snapshot.reports7d)),
        Math.log1p(toQuantityNumber(snapshot.reports14d)),
        Math.log1p(toQuantityNumber(snapshot.units7d)),
        Math.log1p(toQuantityNumber(snapshot.units14d)),
        toQuantityNumber(snapshot.uniqueReportDays14d),
        toQuantityNumber(snapshot.daysSinceLastReport),
        toQuantityNumber(snapshot.cadenceAvgDays14d ?? 14),
        toQuantityNumber(snapshot.coveragePct) / 100,
        toQuantityNumber(snapshot.trend7vPrev7),
        toQuantityNumber(snapshot.daysSinceFirstReportAtAsOf) / 30
    ];
};

const standardizeFeatureMatrix = (matrix) => {
    if (!Array.isArray(matrix) || matrix.length === 0) {
        return { normalized: [], means: [], stds: [] };
    }
    const featureCount = matrix[0].length;
    const means = Array(featureCount).fill(0);
    const stds = Array(featureCount).fill(1);

    for (let j = 0; j < featureCount; j += 1) {
        const col = matrix.map((row) => toQuantityNumber(row[j]));
        const colMean = col.reduce((sum, v) => sum + v, 0) / col.length;
        const variance = col.reduce((sum, v) => sum + ((v - colMean) ** 2), 0) / col.length;
        means[j] = colMean;
        stds[j] = variance > 0 ? Math.sqrt(variance) : 1;
    }

    const normalized = matrix.map((row) => row.map((v, j) => (toQuantityNumber(v) - means[j]) / stds[j]));
    return { normalized, means, stds };
};

const normalizeFeatureVector = (vector, means, stds) => vector.map((v, i) => {
    const std = stds[i] || 1;
    return (toQuantityNumber(v) - (means[i] || 0)) / std;
});

const computeAucRoc = (labels, probabilities) => {
    if (!Array.isArray(labels) || !Array.isArray(probabilities) || labels.length !== probabilities.length) return null;
    if (labels.length === 0) return null;
    const pairs = labels.map((label, idx) => ({
        label: label ? 1 : 0,
        prob: toQuantityNumber(probabilities[idx])
    })).sort((a, b) => a.prob - b.prob);

    let positiveCount = 0;
    let negativeCount = 0;
    pairs.forEach((item) => {
        if (item.label === 1) positiveCount += 1;
        else negativeCount += 1;
    });
    if (positiveCount === 0 || negativeCount === 0) return null;

    let rank = 1;
    let rankSumPositive = 0;
    for (let i = 0; i < pairs.length; i += 1) {
        let j = i;
        while (j + 1 < pairs.length && pairs[j + 1].prob === pairs[i].prob) j += 1;
        const avgRank = (rank + (rank + (j - i))) / 2;
        for (let k = i; k <= j; k += 1) {
            if (pairs[k].label === 1) rankSumPositive += avgRank;
        }
        rank += (j - i + 1);
        i = j;
    }

    const auc = (rankSumPositive - (positiveCount * (positiveCount + 1) / 2)) / (positiveCount * negativeCount);
    return clampValue(auc, 0, 1);
};

const evaluateBinaryModel = (labels, probabilities, threshold = 0.5) => {
    if (!Array.isArray(labels) || !Array.isArray(probabilities) || labels.length !== probabilities.length || labels.length === 0) {
        return {
            sampleSize: 0,
            positives: 0,
            negatives: 0,
            accuracy: null,
            precision: null,
            recall: null,
            f1: null,
            brier: null,
            aucRoc: null
        };
    }

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let brierSum = 0;
    for (let i = 0; i < labels.length; i += 1) {
        const y = labels[i] ? 1 : 0;
        const p = clampValue(toQuantityNumber(probabilities[i]), 0, 1);
        const pred = p >= threshold ? 1 : 0;
        brierSum += ((p - y) ** 2);
        if (pred === 1 && y === 1) tp += 1;
        else if (pred === 1 && y === 0) fp += 1;
        else if (pred === 0 && y === 0) tn += 1;
        else fn += 1;
    }

    const sampleSize = labels.length;
    const precision = safeDivideNumber(tp, tp + fp, 0);
    const recall = safeDivideNumber(tp, tp + fn, 0);
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const accuracy = safeDivideNumber(tp + tn, sampleSize, 0);
    const aucRoc = computeAucRoc(labels, probabilities);

    return {
        sampleSize,
        positives: labels.filter(Boolean).length,
        negatives: labels.filter((x) => !x).length,
        accuracy: roundNumber(accuracy, 4),
        precision: roundNumber(precision, 4),
        recall: roundNumber(recall, 4),
        f1: roundNumber(f1, 4),
        brier: roundNumber(brierSum / sampleSize, 4),
        aucRoc: aucRoc !== null ? roundNumber(aucRoc, 4) : null
    };
};

const optimizeDecisionThreshold = (labels, probabilities) => {
    if (!Array.isArray(labels) || !Array.isArray(probabilities) || labels.length !== probabilities.length || labels.length === 0) {
        return 0.5;
    }

    let bestThreshold = 0.5;
    let bestF1 = -1;
    let bestPrecision = -1;
    let bestRecall = -1;

    for (let step = 20; step <= 80; step += 2) {
        const threshold = step / 100;
        const metrics = evaluateBinaryModel(labels, probabilities, threshold);
        const f1 = toQuantityNumber(metrics.f1);
        const precision = toQuantityNumber(metrics.precision);
        const recall = toQuantityNumber(metrics.recall);
        const isBetterF1 = f1 > (bestF1 + 0.0001);
        const isTieWithBetterPrecision = Math.abs(f1 - bestF1) <= 0.0001 && precision > (bestPrecision + 0.0001);
        const isTieWithBetterRecall = Math.abs(f1 - bestF1) <= 0.0001
            && Math.abs(precision - bestPrecision) <= 0.0001
            && recall > bestRecall;
        if (isBetterF1 || isTieWithBetterPrecision || isTieWithBetterRecall) {
            bestThreshold = threshold;
            bestF1 = f1;
            bestPrecision = precision;
            bestRecall = recall;
        }
    }

    return roundNumber(bestThreshold, 2);
};

const aggregateValidationMetrics = (metricsList) => {
    if (!Array.isArray(metricsList) || metricsList.length === 0) return null;
    const avg = (key) => {
        const values = metricsList
            .map((m) => m?.[key])
            .map((value) => (value === null || value === undefined ? null : toQuantityNumber(value)))
            .filter((value) => Number.isFinite(value));
        if (values.length === 0) return null;
        return roundNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
    };

    return {
        folds: metricsList.length,
        sampleSize: metricsList.reduce((sum, metrics) => sum + toQuantityNumber(metrics?.sampleSize), 0),
        positives: metricsList.reduce((sum, metrics) => sum + toQuantityNumber(metrics?.positives), 0),
        negatives: metricsList.reduce((sum, metrics) => sum + toQuantityNumber(metrics?.negatives), 0),
        accuracy: avg('accuracy'),
        precision: avg('precision'),
        recall: avg('recall'),
        f1: avg('f1'),
        brier: avg('brier'),
        aucRoc: avg('aucRoc')
    };
};

const trainContinuationCore = (trainSamples) => {
    if (!Array.isArray(trainSamples) || trainSamples.length === 0) return null;
    const trainMatrix = trainSamples.map((sample) => sample.features);
    const trainLabels = trainSamples.map((sample) => sample.label);
    const { normalized: trainNormalized, means, stds } = standardizeFeatureMatrix(trainMatrix);
    if (!Array.isArray(trainNormalized) || trainNormalized.length === 0 || !Array.isArray(trainNormalized[0])) return null;

    const featureCount = trainNormalized[0].length;
    let weights = Array(featureCount).fill(0);
    let bias = 0;
    let learningRate = 0.08;
    const iterations = 900;
    const l2 = 0.0015;

    for (let iter = 0; iter < iterations; iter += 1) {
        const gradW = Array(featureCount).fill(0);
        let gradB = 0;

        for (let i = 0; i < trainNormalized.length; i += 1) {
            const x = trainNormalized[i];
            const y = trainLabels[i];
            let z = bias;
            for (let j = 0; j < featureCount; j += 1) z += weights[j] * x[j];
            const p = sigmoidSafe(z);
            const error = p - y;

            gradB += error;
            for (let j = 0; j < featureCount; j += 1) gradW[j] += error * x[j];
        }

        const n = trainNormalized.length || 1;
        bias -= learningRate * (gradB / n);
        for (let j = 0; j < featureCount; j += 1) {
            const regGrad = (gradW[j] / n) + (l2 * weights[j]);
            weights[j] -= learningRate * regGrad;
        }

        if (iter > 0 && iter % 120 === 0) learningRate *= 0.92;
    }

    const predictRawProbability = (featuresVector) => {
        const normalized = normalizeFeatureVector(featuresVector, means, stds);
        let z = bias;
        for (let j = 0; j < featureCount; j += 1) z += weights[j] * normalized[j];
        return clampValue(sigmoidSafe(z), 0.001, 0.999);
    };

    const trainProbabilities = trainSamples.map((sample) => predictRawProbability(sample.features));
    const decisionThreshold = optimizeDecisionThreshold(trainLabels, trainProbabilities);
    const trainMetrics = evaluateBinaryModel(trainLabels, trainProbabilities, decisionThreshold);

    return {
        trainLabels,
        trainProbabilities,
        decisionThreshold,
        trainMetrics,
        predictRawProbability,
        parameters: {
            means,
            stds,
            weights,
            bias
        }
    };
};

const trainContinuationProbabilityModel = (samples) => {
    const minSamples = 45;
    const minClassSupport = 12;
    if (!Array.isArray(samples) || samples.length < minSamples) {
        return {
            isTrained: false,
            reason: 'insufficient_samples',
            sampleSize: samples?.length || 0
        };
    }

    const usable = samples
        .map((sample) => {
            const features = extractContinuationFeatures(sample.snapshot);
            if (!features) return null;
            return {
                ...sample,
                features,
                label: sample.label ? 1 : 0
            };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.snapshotDate) - new Date(b.snapshotDate));

    const positives = usable.filter((s) => s.label === 1).length;
    const negatives = usable.length - positives;
    if (usable.length < minSamples || positives < minClassSupport || negatives < minClassSupport) {
        return {
            isTrained: false,
            reason: 'class_imbalance_or_low_support',
            sampleSize: usable.length,
            positives,
            negatives
        };
    }

    const validationWindow = Math.max(10, Math.round(usable.length * 0.16));
    const foldDefinitions = [
        { ratio: 0.6, label: 'fold_60' },
        { ratio: 0.7, label: 'fold_70' },
        { ratio: 0.8, label: 'fold_80' }
    ];
    const validationFolds = [];
    const foldThresholds = [];

    foldDefinitions.forEach((fold) => {
        const trainSize = Math.round(usable.length * fold.ratio);
        const trainSamples = usable.slice(0, trainSize);
        const validationSamples = usable.slice(trainSize, trainSize + validationWindow);
        if (trainSamples.length < 28 || validationSamples.length < 10) return;

        const trainPositives = trainSamples.filter((s) => s.label === 1).length;
        const trainNegatives = trainSamples.length - trainPositives;
        const validationPositives = validationSamples.filter((s) => s.label === 1).length;
        const validationNegatives = validationSamples.length - validationPositives;
        if (
            trainPositives < 8
            || trainNegatives < 8
            || validationPositives < 3
            || validationNegatives < 3
        ) {
            return;
        }

        const foldModel = trainContinuationCore(trainSamples);
        if (!foldModel) return;

        const valLabels = validationSamples.map((sample) => sample.label);
        const valProbabilities = validationSamples.map((sample) => foldModel.predictRawProbability(sample.features));
        const valMetrics = evaluateBinaryModel(valLabels, valProbabilities, foldModel.decisionThreshold);

        validationFolds.push({
            label: fold.label,
            trainSize: trainSamples.length,
            validationSize: validationSamples.length,
            decisionThreshold: foldModel.decisionThreshold,
            metrics: valMetrics
        });
        foldThresholds.push(foldModel.decisionThreshold);
    });

    const aggregatedValidation = aggregateValidationMetrics(validationFolds.map((fold) => fold.metrics));
    if (!aggregatedValidation || validationFolds.length < 2) {
        return {
            isTrained: false,
            reason: 'insufficient_validation_folds',
            sampleSize: usable.length,
            positives,
            negatives,
            validation: aggregatedValidation,
            validationFolds
        };
    }

    const qualityGate = {
        minF1: 0.5,
        minAucRoc: 0.6,
        maxBrier: 0.27
    };
    const validationF1 = toQuantityNumber(aggregatedValidation.f1);
    const validationAuc = toQuantityNumber(aggregatedValidation.aucRoc);
    const validationBrier = toQuantityNumber(aggregatedValidation.brier);
    const passesQualityGate = validationF1 >= qualityGate.minF1
        && validationAuc >= qualityGate.minAucRoc
        && validationBrier <= qualityGate.maxBrier;

    if (!passesQualityGate) {
        return {
            isTrained: false,
            reason: 'quality_gate_failed',
            sampleSize: usable.length,
            positives,
            negatives,
            validation: aggregatedValidation,
            validationFolds,
            qualityGate: {
                ...qualityGate,
                passed: false
            }
        };
    }

    const fullModel = trainContinuationCore(usable);
    if (!fullModel) {
        return {
            isTrained: false,
            reason: 'training_failure',
            sampleSize: usable.length,
            positives,
            negatives,
            validation: aggregatedValidation,
            validationFolds
        };
    }

    const sortedThresholds = [...foldThresholds].sort((a, b) => a - b);
    const medianThreshold = sortedThresholds.length > 0
        ? sortedThresholds[Math.floor(sortedThresholds.length / 2)]
        : fullModel.decisionThreshold;

    return {
        isTrained: true,
        reason: null,
        sampleSize: usable.length,
        positives,
        negatives,
        decisionThreshold: roundNumber(medianThreshold, 2),
        training: fullModel.trainMetrics,
        validation: aggregatedValidation,
        validationFolds,
        qualityGate: {
            ...qualityGate,
            passed: true
        },
        parameters: fullModel.parameters
    };
};

const predictContinuationProbability = (model, snapshot) => {
    if (!model?.isTrained || !snapshot) return null;
    const features = extractContinuationFeatures(snapshot);
    if (!features) return null;
    const { means, stds, weights, bias } = model.parameters || {};
    if (!Array.isArray(means) || !Array.isArray(stds) || !Array.isArray(weights)) return null;

    const normalized = normalizeFeatureVector(features, means, stds);
    let z = toQuantityNumber(bias);
    for (let i = 0; i < weights.length; i += 1) z += toQuantityNumber(weights[i]) * toQuantityNumber(normalized[i]);
    return clampValue(sigmoidSafe(z), 0.001, 0.999);
};

const heuristicContinuationProbability = ({ snapshot, coveragePct, missingUnitsTotal }) => {
    if (!snapshot) return 50;
    let score = 0;
    const daysSinceLast = toQuantityNumber(snapshot.daysSinceLastReport);
    if (daysSinceLast <= 3) score += 30;
    else if (daysSinceLast <= 7) score += 20;
    else if (daysSinceLast <= 14) score += 8;
    else if (daysSinceLast <= 30) score -= 8;
    else score -= 22;

    score += Math.min(24, toQuantityNumber(snapshot.uniqueReportDays14d) * 4);
    if (toQuantityNumber(snapshot.reports7d) > 0) score += 10;
    if (toQuantityNumber(snapshot.reports14d) >= 3) score += 8;
    if (toQuantityNumber(snapshot.trend7vPrev7) >= 1.2) score += 6;
    if (toQuantityNumber(snapshot.cadenceAvgDays14d) > 0 && toQuantityNumber(snapshot.cadenceAvgDays14d) <= 5) score += 5;

    if (coveragePct !== null && coveragePct !== undefined) {
        const cov = toQuantityNumber(coveragePct);
        if (cov < 30) score += 9;
        else if (cov < 60) score += 4;
        else if (cov >= 85) score -= 10;
    }
    if (missingUnitsTotal !== null && missingUnitsTotal <= 0) score -= 30;

    return Math.round(clampValue(50 + score, 1, 99));
};

const normalizeRangeScore = (value, min, max, options = {}) => {
    const { invert = false, fallback = 0 } = options;
    const numericValue = toFiniteNumber(value);
    if (numericValue === null) return fallback;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return clampValue(numericValue, 0, 1);
    }
    const normalized = clampValue((numericValue - min) / (max - min), 0, 1);
    return invert ? (1 - normalized) : normalized;
};

const computePredictionModelReliabilityScore = (model) => {
    if (!model?.isTrained || !model.validation) return 0.34;
    const f1 = clampValue(toQuantityNumber(model.validation.f1), 0, 1);
    const auc = clampValue(toQuantityNumber(model.validation.aucRoc), 0.5, 1);
    const aucNormalized = clampValue((auc - 0.5) / 0.5, 0, 1);
    const brier = clampValue(toQuantityNumber(model.validation.brier), 0, 0.35);
    const brierNormalized = clampValue(1 - (brier / 0.35), 0, 1);
    return roundNumber(
        clampValue(
            0.22 + (f1 * 0.36) + (aucNormalized * 0.26) + (brierNormalized * 0.16),
            0.34,
            0.94
        ),
        4
    );
};

const computeEvidenceBasedContinuationProbability = ({
    snapshot,
    missingUnitsTotal,
    producedUnitsTotal,
    defectProfile,
    defectUnits,
    defectPressure
}) => {
    if (!snapshot) {
        return {
            probabilityPct: 50,
            weightedSignal: 0.5,
            components: []
        };
    }

    const policy = getDefectAlertPolicy(defectProfile?.defectType || 'OTRO');
    const recencyScore = normalizeRangeScore(snapshot.daysSinceLastReport, 0, FOLLOW_UP_STOPPED_DAYS, { invert: true, fallback: 0.35 });
    const densityScore = normalizeRangeScore(snapshot.uniqueReportDays14d, 1, 6, { fallback: 0.18 });
    const volumeScore = normalizeRangeScore(snapshot.reports14d, 1, 6, { fallback: 0.16 });
    const momentumScore = normalizeRangeScore(snapshot.trend7vPrev7, 0.65, 1.9, { fallback: 0.45 });
    const cadenceScore = normalizeRangeScore(snapshot.cadenceAvgDays14d, 1, 9, { invert: true, fallback: 0.4 });
    const coverageOpenScore = snapshot.coveragePct !== null && snapshot.coveragePct !== undefined
        ? normalizeRangeScore(snapshot.coveragePct, 18, 92, { invert: true, fallback: 0.45 })
        : 0.45;
    const missingCoverageRatio = producedUnitsTotal > 0
        ? safeDivideNumber(Math.max(0, toQuantityNumber(missingUnitsTotal)), producedUnitsTotal, 0)
        : null;
    const missingOpenScore = missingCoverageRatio !== null
        ? normalizeRangeScore(missingCoverageRatio, 0.02, 0.72, { fallback: 0.42 })
        : 0.42;
    const persistenceScore = normalizeRangeScore(snapshot.daysSinceFirstReportAtAsOf, 2, 21, { fallback: 0.4 });

    let defectRiskScore = 0.5;
    if (defectProfile?.riskBand === 'alto_arrastre') defectRiskScore = 0.84;
    else if (defectProfile?.riskBand === 'arrastre_medio') defectRiskScore = 0.67;
    else if (defectProfile?.riskBand === 'autolimitado') defectRiskScore = 0.3;

    let pressureScore = 0.5;
    if (defectPressure?.hasGoodReference) {
        pressureScore = normalizeRangeScore(
            defectPressure.defectVsGoodPct ?? defectPressure.defectRatePct,
            Math.max(0.01, toQuantityNumber(policy.warningRatePct) * 0.6),
            Math.max(toQuantityNumber(policy.recallRatePct) * 1.15, toQuantityNumber(policy.warningRatePct) * 2.2),
            { fallback: 0.5 }
        );
    } else {
        pressureScore = normalizeRangeScore(
            defectUnits,
            Math.max(1, toQuantityNumber(policy.warningUnits) * 0.4),
            Math.max(toQuantityNumber(policy.recallUnits), toQuantityNumber(policy.warningUnits) * 2),
            { fallback: 0.5 }
        );
    }

    const weightedSignal = (
        (recencyScore * 0.24) +
        (densityScore * 0.12) +
        (volumeScore * 0.1) +
        (momentumScore * 0.08) +
        (cadenceScore * 0.08) +
        (coverageOpenScore * 0.1) +
        (missingOpenScore * 0.09) +
        (persistenceScore * 0.07) +
        (defectRiskScore * 0.06) +
        (pressureScore * 0.06)
    );

    let probabilityPct = Math.round(
        clampValue(
            sigmoidSafe((weightedSignal - 0.46) * 5.4) * 100,
            8,
            94
        )
    );

    if (toQuantityNumber(snapshot.reports7d) > 0 && toQuantityNumber(snapshot.uniqueReportDays14d) >= 2) {
        probabilityPct = Math.min(95, probabilityPct + 3);
    }
    if (toQuantityNumber(snapshot.daysSinceLastReport) > FOLLOW_UP_STOPPED_DAYS) {
        probabilityPct = Math.min(probabilityPct, 42);
    }
    if (missingUnitsTotal !== null && toQuantityNumber(missingUnitsTotal) <= 0) {
        probabilityPct = Math.max(8, probabilityPct - 18);
    }

    return {
        probabilityPct,
        weightedSignal: roundNumber(weightedSignal, 4),
        components: [
            { key: 'recency', label: 'Recencia', score: roundNumber(recencyScore, 4) },
            { key: 'density', label: 'Frecuencia dias', score: roundNumber(densityScore, 4) },
            { key: 'volume', label: 'Volumen reportes', score: roundNumber(volumeScore, 4) },
            { key: 'momentum', label: 'Momentum', score: roundNumber(momentumScore, 4) },
            { key: 'cadence', label: 'Cadencia', score: roundNumber(cadenceScore, 4) },
            { key: 'coverage_open', label: 'Cobertura abierta', score: roundNumber(coverageOpenScore, 4) },
            { key: 'missing_open', label: 'Pendiente por reportar', score: roundNumber(missingOpenScore, 4) },
            { key: 'persistence', label: 'Persistencia', score: roundNumber(persistenceScore, 4) },
            { key: 'defect_risk', label: 'Riesgo defecto', score: roundNumber(defectRiskScore, 4) },
            { key: 'pressure', label: 'Presion defecto', score: roundNumber(pressureScore, 4) }
        ]
    };
};

const computePredictionConfidenceScore = ({
    snapshot,
    producedUnitsTotal,
    defectProfile,
    defectPressure,
    predictionModel
}) => {
    if (!snapshot) {
        return {
            confidenceScore: 20,
            modelReliabilityScorePct: roundNumber(computePredictionModelReliabilityScore(predictionModel) * 100, 1),
            components: []
        };
    }

    const modelReliability = computePredictionModelReliabilityScore(predictionModel);
    const uniqueDaysScore = normalizeRangeScore(snapshot.uniqueReportDays14d, 1, 5, { fallback: 0.16 });
    const reportVolumeScore = normalizeRangeScore(snapshot.reports14d, 1, 6, { fallback: 0.14 });
    const maturityScore = normalizeRangeScore(snapshot.daysSinceFirstReportAtAsOf, 2, 18, { fallback: 0.2 });
    const cadenceObservabilityScore = normalizeRangeScore(snapshot.cadenceAvgDays14d, 1, 10, { invert: true, fallback: 0.38 });
    const productionLinkScore = producedUnitsTotal > 0 ? 1 : 0.34;
    const coverageLinkScore = snapshot.coveragePct !== null && snapshot.coveragePct !== undefined ? 1 : 0.4;
    const defectSupportScore = normalizeRangeScore(defectProfile?.sampleSize || 0, 0, 18, { fallback: 0.18 });
    const defectReferenceScore = defectPressure?.hasGoodReference ? 1 : 0.46;

    const baseConfidence = (
        15 +
        (uniqueDaysScore * 12) +
        (reportVolumeScore * 10) +
        (maturityScore * 8) +
        (cadenceObservabilityScore * 7) +
        (productionLinkScore * 8) +
        (coverageLinkScore * 7) +
        (defectSupportScore * 7) +
        (defectReferenceScore * 6) +
        (modelReliability * 18)
    );
    const maxConfidence = predictionModel?.isTrained ? 92 : (producedUnitsTotal > 0 ? 58 : 52);
    const confidenceScore = Math.round(clampValue(baseConfidence, 20, maxConfidence));

    return {
        confidenceScore,
        modelReliabilityScorePct: roundNumber(modelReliability * 100, 1),
        components: [
            { key: 'unique_days', label: 'Dias observados', score: roundNumber(uniqueDaysScore, 4) },
            { key: 'report_volume', label: 'Volumen', score: roundNumber(reportVolumeScore, 4) },
            { key: 'maturity', label: 'Madurez temporal', score: roundNumber(maturityScore, 4) },
            { key: 'cadence', label: 'Observabilidad cadencia', score: roundNumber(cadenceObservabilityScore, 4) },
            { key: 'production_link', label: 'Cruce produccion', score: roundNumber(productionLinkScore, 4) },
            { key: 'coverage_link', label: 'Cobertura', score: roundNumber(coverageLinkScore, 4) },
            { key: 'defect_support', label: 'Soporte defecto', score: roundNumber(defectSupportScore, 4) },
            { key: 'defect_reference', label: 'Referencia buenos', score: roundNumber(defectReferenceScore, 4) },
            { key: 'model_reliability', label: 'Confiabilidad modelo', score: roundNumber(modelReliability, 4) }
        ]
    };
};

const blendContinuationProbabilityPct = ({
    modelProbability,
    evidenceProbabilityPct,
    confidenceScore,
    predictionModel
}) => {
    if (modelProbability === null || !predictionModel?.isTrained) return evidenceProbabilityPct;
    const modelReliability = computePredictionModelReliabilityScore(predictionModel);
    const confidenceFactor = clampValue(toQuantityNumber(confidenceScore) / 100, 0.24, 0.92);
    const modelWeight = clampValue(0.28 + (modelReliability * 0.42) + (confidenceFactor * 0.08), 0.34, 0.76);
    return Math.round(
        clampValue(
            ((modelProbability * 100) * modelWeight) + (toQuantityNumber(evidenceProbabilityPct) * (1 - modelWeight)),
            1,
            99
        )
    );
};

const estimateCoverageProjection = ({
    snapshot,
    probabilityPct,
    confidenceScore,
    defectProfile,
    producedUnitsTotal,
    reportedUnitsTotal
}) => {
    if (!snapshot || producedUnitsTotal <= 0) {
        return {
            expectedFinalCoveragePct: null,
            expectedFinalReportedUnits: null,
            expectedAdditionalUnitsToReport: null,
            expectedFinalCoverageRangePct: null
        };
    }

    const currentCoverage = clampValue(toQuantityNumber(snapshot.coveragePct), 0, 100);
    const remainingCoverage = Math.max(100 - currentCoverage, 0);
    const continuationFactor = clampValue(toQuantityNumber(probabilityPct) / 100, 0.05, 0.95);
    const confidenceFactor = clampValue(0.24 + (toQuantityNumber(confidenceScore) / 100 * 0.56), 0.24, 0.82);
    const recentActivityFactor = toQuantityNumber(snapshot.reports7d) > 0
        ? 1
        : (toQuantityNumber(snapshot.reports14d) > 0 ? 0.8 : 0.55);
    const daysSinceLast = toQuantityNumber(snapshot.daysSinceLastReport);
    const latencyDecay = daysSinceLast <= FOLLOW_UP_RECENT_DAYS
        ? 1
        : (daysSinceLast <= FOLLOW_UP_MONITOR_DAYS
            ? 0.82
            : (daysSinceLast <= FOLLOW_UP_STOPPED_DAYS ? 0.62 : 0.4));
    const cadenceSupport = snapshot.cadenceAvgDays14d !== null && snapshot.cadenceAvgDays14d !== undefined
        ? clampValue(0.55 + (normalizeRangeScore(snapshot.cadenceAvgDays14d, 1, 10, { invert: true, fallback: 0.4 }) * 0.45), 0.45, 1)
        : 0.72;
    const defectGrowthFactor = clampValue(toQuantityNumber(defectProfile?.growthFactor || 1), 0.84, 1.18);

    let growthShare = continuationFactor * confidenceFactor * recentActivityFactor * latencyDecay * cadenceSupport * defectGrowthFactor;
    growthShare = clampValue(growthShare, 0.02, 0.88);

    const uncertaintyFactor = clampValue(0.12 + ((1 - (toQuantityNumber(confidenceScore) / 100)) * 0.34), 0.14, 0.42);
    const lowerGrowthShare = clampValue(growthShare * (1 - uncertaintyFactor), 0.01, 1);
    const upperGrowthShare = clampValue(growthShare * (1 + uncertaintyFactor), 0.02, 1);

    const expectedFinalCoveragePct = roundNumber(
        clampValue(currentCoverage + (remainingCoverage * growthShare), currentCoverage, 100),
        2
    );
    const lowerCoveragePct = roundNumber(
        clampValue(currentCoverage + (remainingCoverage * lowerGrowthShare), currentCoverage, 100),
        2
    );
    const upperCoveragePct = roundNumber(
        clampValue(currentCoverage + (remainingCoverage * upperGrowthShare), currentCoverage, 100),
        2
    );
    const expectedFinalReportedUnits = Math.round((producedUnitsTotal * expectedFinalCoveragePct) / 100);
    const expectedAdditionalUnitsToReport = Math.max(expectedFinalReportedUnits - reportedUnitsTotal, 0);

    return {
        expectedFinalCoveragePct,
        expectedFinalReportedUnits,
        expectedAdditionalUnitsToReport,
        expectedFinalCoverageRangePct: {
            min: lowerCoveragePct,
            max: upperCoveragePct
        }
    };
};

const calibrateCoverageGrowthExponent = ({ samples, model }) => {
    if (!Array.isArray(samples) || samples.length < 18 || !model?.isTrained) {
        return {
            isCalibrated: false,
            gamma: 1.0,
            sampleSize: samples?.length || 0
        };
    }

    const usable = samples
        .map((sample) => {
            const probability = predictContinuationProbability(model, sample.snapshot);
            if (probability === null) return null;
            const target = clampValue(toQuantityNumber(sample.additionalShare), 0, 1);
            return {
                probability,
                target
            };
        })
        .filter(Boolean);

    if (usable.length < 18) {
        return {
            isCalibrated: false,
            gamma: 1.0,
            sampleSize: usable.length
        };
    }

    let bestGamma = 1.0;
    let bestMse = Number.POSITIVE_INFINITY;
    let baselineMse = 0;
    usable.forEach((item) => {
        baselineMse += ((item.probability - item.target) ** 2);
    });
    baselineMse /= usable.length;

    for (let gamma = 0.35; gamma <= 2.4; gamma += 0.05) {
        let mse = 0;
        usable.forEach((item) => {
            const estimate = Math.pow(item.probability, gamma);
            mse += ((estimate - item.target) ** 2);
        });
        mse /= usable.length;
        if (mse < bestMse) {
            bestMse = mse;
            bestGamma = gamma;
        }
    }

    return {
        isCalibrated: true,
        gamma: roundNumber(bestGamma, 3),
        sampleSize: usable.length,
        mse: roundNumber(bestMse, 5),
        baselineMse: roundNumber(baselineMse, 5)
    };
};

const detectDamagePatternsLegacy = (rows) => {
    const totalLots = rows.length;
    const damagedRows = rows.filter(r => r.pqr?.hasReports);
    const damagedLots = damagedRows.length;
    const baselineDamageRate = totalLots > 0 ? damagedLots / totalLots : 0;

    const buildCategoryRisk = ({ keyFn, minLots = 10, minDamaged = 3 }) => {
        const groups = new Map();
        rows.forEach((row) => {
            const key = keyFn(row) || 'No definido';
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    totalLots: 0,
                    damagedLots: 0,
                    totalReportedUnits: 0,
                    totalReportItems: 0
                });
            }
            const g = groups.get(key);
            g.totalLots += 1;
            if (row.pqr?.hasReports) {
                g.damagedLots += 1;
                g.totalReportedUnits += row.pqr.totalReportedUnits || 0;
                g.totalReportItems += row.pqr.totalReportItems || 0;
            }
        });

        return Array.from(groups.values())
            .filter(g => g.totalLots >= minLots && g.damagedLots >= minDamaged)
            .map((g) => {
                const damageRate = g.totalLots > 0 ? g.damagedLots / g.totalLots : 0;
                const riskRatio = baselineDamageRate > 0 ? damageRate / baselineDamageRate : 0;
                const excessDamageRate = damageRate - baselineDamageRate;
                return {
                    key: g.key,
                    totalLots: g.totalLots,
                    damagedLots: g.damagedLots,
                    damageRate: roundNumber(damageRate, 4),
                    riskRatio: roundNumber(riskRatio, 2),
                    excessDamageRate: roundNumber(excessDamageRate, 4),
                    totalReportedUnits: g.totalReportedUnits,
                    totalReportItems: g.totalReportItems
                };
            })
            .filter(item => (item.riskRatio || 0) >= 1.15 && (item.excessDamageRate || 0) > 0)
            .sort((a, b) => {
                if ((b.riskRatio || 0) !== (a.riskRatio || 0)) return (b.riskRatio || 0) - (a.riskRatio || 0);
                if ((b.excessDamageRate || 0) !== (a.excessDamageRate || 0)) return (b.excessDamageRate || 0) - (a.excessDamageRate || 0);
                return (b.totalReportedUnits || 0) - (a.totalReportedUnits || 0);
            });
    };

    const byFlavor = buildCategoryRisk({
        keyFn: (row) => row.flavor || row.flavorRaw || 'Sin sabor',
        minLots: 12,
        minDamaged: 3
    });

    const byShift = buildCategoryRisk({
        keyFn: (row) => {
            const hour = parseHourFromLotKey(row.lotKey);
            return hourToShift(hour);
        },
        minLots: 20,
        minDamaged: 3
    });

    const presentationSizes = ['3400g', '1150g', '350g'];
    const byPresentation = presentationSizes.map((size) => {
        const lotsWithProduction = rows.filter(r => (r.producedUnits?.[size] || 0) > 0);
        const damagedLotsForSize = lotsWithProduction.filter((row) => {
            return (row.pqr?.byPresentation || []).some((p) => {
                const normalized = normalizePresentationSize(p.size);
                return normalized === size && (p.reportedUnits || 0) > 0;
            });
        });
        const damageRate = lotsWithProduction.length > 0 ? damagedLotsForSize.length / lotsWithProduction.length : 0;
        const riskRatio = baselineDamageRate > 0 ? damageRate / baselineDamageRate : 0;
        const totalReportedUnits = damagedLotsForSize.reduce((sum, row) => {
            const found = (row.pqr.byPresentation || []).find((p) => normalizePresentationSize(p.size) === size);
            return sum + (found?.reportedUnits || 0);
        }, 0);
        return {
            key: size,
            totalLots: lotsWithProduction.length,
            damagedLots: damagedLotsForSize.length,
            damageRate: roundNumber(damageRate, 4),
            riskRatio: roundNumber(riskRatio, 2),
            excessDamageRate: roundNumber(damageRate - baselineDamageRate, 4),
            totalReportedUnits: roundNumber(totalReportedUnits, 2)
        };
    }).filter(item => item.totalLots >= 10 && item.damagedLots >= 2 && (item.riskRatio || 0) >= 1.05 && (item.excessDamageRate || 0) > 0)
        .sort((a, b) => (b.riskRatio || 0) - (a.riskRatio || 0));

    const dayBucketOrder = ['0d', '1-3d', '4-7d', '8-15d', '16-30d', '31d+'];
    const dayBuckets = {};
    dayBucketOrder.forEach(k => {
        dayBuckets[k] = { key: k, lots: 0, reportedUnits: 0 };
    });

    damagedRows.forEach((row) => {
        const days = row.pqr?.daysToFirstReport;
        if (!Number.isFinite(days) || days < 0) return;
        let key = '31d+';
        if (days === 0) key = '0d';
        else if (days <= 3) key = '1-3d';
        else if (days <= 7) key = '4-7d';
        else if (days <= 15) key = '8-15d';
        else if (days <= 30) key = '16-30d';
        dayBuckets[key].lots += 1;
        dayBuckets[key].reportedUnits += row.pqr.totalReportedUnits || 0;
    });

    const lotsWithValidFirstReport = Object.values(dayBuckets).reduce((s, b) => s + b.lots, 0);
    const byDaysToFirstReport = dayBucketOrder
        .map((key) => {
            const bucket = dayBuckets[key];
            return {
                key: bucket.key,
                lots: bucket.lots,
                pctLots: lotsWithValidFirstReport > 0 ? roundNumber((bucket.lots / lotsWithValidFirstReport) * 100, 1) : 0,
                reportedUnits: roundNumber(bucket.reportedUnits, 2)
            };
        })
        .filter(bucket => bucket.lots > 0);

    const numericDefs = [
        { field: 'phJarabe', label: 'pH Jarabe', unit: '' },
        { field: 'bxJarabe', label: 'Bx Jarabe', unit: '' },
        { field: 'conductividad', label: 'Conductividad', unit: '' },
        { field: 'bxPerla', label: 'Bx Perla', unit: '' },
        { field: 'tempCoccion', label: 'Temp Cocción', unit: 'C' },
        { field: 'tempChiller', label: 'Temp Chiller', unit: 'C' },
        { field: 'pesoPerlas', label: 'Peso Perlas', unit: '' },
        { field: 'mixQuantityKg', label: 'Mezcla (kg)', unit: 'kg' },
        { field: 'protectionQuantityKg', label: 'Protección (kg)', unit: 'kg' },
        { field: 'protectionPh', label: 'pH Protección', unit: '' },
        { field: 'protectionBx', label: 'Bx Protección', unit: '' },
        { field: 'pearlCookTempC', label: 'Temp Cocción Perla', unit: 'C' },
        { field: 'pearlCookTimeSec', label: 'Tiempo Cocción Perla', unit: 's' },
        { field: 'productionDurationMin', label: 'Duración Producción', unit: 'min' },
        { field: 'damagedAtProductionTotal', label: 'Dañados en Fabricación', unit: 'uds' },
        { field: 'internalDamageRatePct', label: '% Daño en Fabricación', unit: '%' }
    ];

    const numericSignals = [];
    const dataQuality = [];

    numericDefs.forEach((def) => {
        const rawValues = rows.map(r => toFiniteNumber(r[def.field])).filter(v => v !== null);
        if (rawValues.length === 0) {
            dataQuality.push({
                metric: def.field,
                label: def.label,
                totalRows: totalLots,
                nonNullCount: 0,
                usableCount: 0,
                outliersRemoved: 0,
                zeroCount: 0,
                usablePct: 0
            });
            return;
        }

        const sortedRaw = [...rawValues].sort((a, b) => a - b);
        const q1 = percentile(sortedRaw, 0.25);
        const q3 = percentile(sortedRaw, 0.75);
        const iqr = (q3 ?? 0) - (q1 ?? 0);
        const lower = iqr > 0 ? q1 - (1.5 * iqr) : q1;
        const upper = iqr > 0 ? q3 + (1.5 * iqr) : q3;

        const usableRows = rows
            .map((row) => ({ damaged: Boolean(row.pqr?.hasReports), value: toFiniteNumber(row[def.field]) }))
            .filter(item => item.value !== null && item.value >= lower && item.value <= upper);

        const damagedVals = usableRows.filter(r => r.damaged).map(r => r.value);
        const healthyVals = usableRows.filter(r => !r.damaged).map(r => r.value);
        const allUsableVals = usableRows.map(r => r.value);

        const removed = rawValues.length - usableRows.length;
        const zeroCount = rawValues.filter(v => v === 0).length;

        dataQuality.push({
            metric: def.field,
            label: def.label,
            totalRows: totalLots,
            nonNullCount: rawValues.length,
            usableCount: usableRows.length,
            outliersRemoved: removed,
            zeroCount,
            usablePct: roundNumber((usableRows.length / totalLots) * 100, 1),
            lowerBound: roundNumber(lower, 4),
            upperBound: roundNumber(upper, 4)
        });

        if (damagedVals.length < 12 || healthyVals.length < 40) return;

        const damagedMedian = percentile([...damagedVals].sort((a, b) => a - b), 0.5);
        const healthyMedian = percentile([...healthyVals].sort((a, b) => a - b), 0.5);
        const diff = (damagedMedian ?? 0) - (healthyMedian ?? 0);
        const globalMean = mean(allUsableVals);
        const globalStd = stdDev(allUsableVals, globalMean);
        const effectSize = globalStd > 0 ? diff / globalStd : 0;
        const pctDiff = Math.abs(healthyMedian || 0) > 0
            ? (diff / Math.abs(healthyMedian)) * 100
            : null;

        if (Math.abs(effectSize) < 0.25) return;

        numericSignals.push({
            metric: def.field,
            label: def.label,
            unit: def.unit,
            direction: diff >= 0 ? 'higher' : 'lower',
            damagedMedian: roundNumber(damagedMedian, 4),
            healthyMedian: roundNumber(healthyMedian, 4),
            absoluteDiff: roundNumber(diff, 4),
            pctDiff: roundNumber(pctDiff, 2),
            effectSize: roundNumber(effectSize, 3),
            damagedSample: damagedVals.length,
            healthySample: healthyVals.length
        });
    });

    numericSignals.sort((a, b) => Math.abs(b.effectSize || 0) - Math.abs(a.effectSize || 0));

    const flavorRiskMap = new Map(
        byFlavor.map(item => [String(item.key || '').toLowerCase(), item])
    );
    const shiftRiskMap = new Map(
        byShift.map(item => [item.key, item])
    );

    const now = new Date();
    const likelyDamagedUnreported = rows
        .filter(row => !row.pqr?.hasReports)
        .map((row) => {
            let score = 0;
            const reasons = [];

            const flavorKey = String(row.flavor || row.flavorRaw || '').toLowerCase();
            const flavorRisk = flavorRiskMap.get(flavorKey);
            if (flavorRisk) {
                const contribution = Math.max(0, Math.log(flavorRisk.riskRatio || 1) * 2.2);
                if (contribution > 0) {
                    score += contribution;
                    reasons.push(`Sabor ${row.flavor} (RR ${flavorRisk.riskRatio})`);
                }
            }

            const shiftKey = hourToShift(parseHourFromLotKey(row.lotKey));
            const shiftRisk = shiftRiskMap.get(shiftKey);
            if (shiftRisk) {
                const contribution = Math.max(0, Math.log(shiftRisk.riskRatio || 1) * 1.5);
                if (contribution > 0) {
                    score += contribution;
                    reasons.push(`Turno ${shiftKey} (RR ${shiftRisk.riskRatio})`);
                }
            }

            const internalDamaged = toFiniteNumber(row.damagedAtProductionTotal) || 0;
            if (internalDamaged > 0) {
                const contribution = 0.9 + Math.min(2.2, Math.log1p(internalDamaged));
                score += contribution;
                reasons.push(`Dañados en fabricación: ${internalDamaged}`);
            }

            const internalDamageRatePct = toFiniteNumber(row.internalDamageRatePct);
            if (internalDamageRatePct && internalDamageRatePct > 0.2) {
                const contribution = Math.min(2, internalDamageRatePct / 1.6);
                score += contribution;
                reasons.push(`Daño interno ${roundNumber(internalDamageRatePct, 2)}%`);
            }

            let signalHits = 0;
            numericSignals.forEach((signal) => {
                const value = toFiniteNumber(row[signal.metric]);
                if (value === null) return;
                const target = toFiniteNumber(signal.damagedMedian);
                if (target === null) return;

                const matches = signal.direction === 'higher'
                    ? value >= target
                    : value <= target;
                if (!matches) return;

                const contribution = Math.min(1.25, Math.abs(signal.effectSize || 0) * 0.45);
                if (contribution <= 0) return;
                score += contribution;
                signalHits += 1;

                if (reasons.length < 6) {
                    reasons.push(`${signal.label}: ${value} (${signal.direction === 'higher' ? 'alto' : 'bajo'})`);
                }
            });

            const daysSinceProduction = row.productionDate
                ? Math.max(0, Math.floor((now - new Date(row.productionDate)) / (1000 * 60 * 60 * 24)))
                : null;
            if (daysSinceProduction !== null && daysSinceProduction <= 45) {
                score += 0.35;
            }

            const riskLevel = score >= 4 ? 'high'
                : score >= 2.8 ? 'medium'
                    : score >= 1.6 ? 'watch'
                        : 'low';

            return {
                id: row.id,
                lotCode: row.lotCode,
                displayLot: row.displayLot,
                flavor: row.flavor,
                productionDate: row.productionDate,
                daysSinceProduction,
                producedUnits: row.producedUnits,
                damagedAtProduction: row.damagedAtProduction,
                damagedAtProductionTotal: internalDamaged,
                internalDamageRatePct: roundNumber(internalDamageRatePct, 2),
                phJarabe: row.phJarabe,
                bxJarabe: row.bxJarabe,
                conductividad: row.conductividad,
                bxPerla: row.bxPerla,
                tempCoccion: row.tempCoccion,
                pearlCookTempC: row.pearlCookTempC,
                pearlCookTimeSec: row.pearlCookTimeSec,
                protectionPh: row.protectionPh,
                protectionBx: row.protectionBx,
                productionDurationMin: row.productionDurationMin,
                modelScore: roundNumber(score, 3),
                riskLevel,
                signalHits,
                reasons: reasons.slice(0, 6)
            };
        })
        .filter(item => (item.modelScore || 0) >= 1.6)
        .sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0))
        .slice(0, 50);

    return {
        method: {
            name: 'Risk Ratio + Robust Numeric Signals',
            version: 'v1',
            baseline: 'tasa de lotes con reportes PQR',
            numericCleaning: 'IQR (Q1-1.5*IQR, Q3+1.5*IQR)',
            minimumSupport: {
                categoricalLots: 10,
                categoricalDamagedLots: 3,
                numericDamagedSample: 12,
                numericHealthySample: 40
            }
        },
        baseline: {
            totalLots,
            damagedLots,
            baselineDamageRate: roundNumber(baselineDamageRate, 4),
            baselineDamageRatePct: roundNumber(baselineDamageRate * 100, 2)
        },
        byFlavor: byFlavor.slice(0, 12),
        byShift: byShift.slice(0, 6),
        byPresentation,
        byDaysToFirstReport,
        numericSignals: numericSignals.slice(0, 8),
        probableUnreportedLots: likelyDamagedUnreported,
        dataQuality
    };
};

const detectDamagePatterns = (rows) => {
    const legacy = detectDamagePatternsLegacy(rows);
    const totalLots = rows.length;
    const damagedRows = rows.filter(r => r.pqr?.hasReports);
    const damagedLots = damagedRows.length;
    const baselineDamageRate = totalLots > 0 ? damagedLots / totalLots : 0;
    const baselineSafe = Math.max(baselineDamageRate, 0.0001);
    const priorWeight = 20;

    const buildCategoryRisk = ({ keyFn, minLots = 10, minDamaged = 3, minRiskRatio = 1.1 }) => {
        const grouped = new Map();
        rows.forEach((row) => {
            const key = keyFn(row) || 'No definido';
            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    totalLots: 0,
                    damagedLots: 0,
                    totalReportedUnits: 0,
                    totalReportItems: 0
                });
            }
            const g = grouped.get(key);
            g.totalLots += 1;
            if (row.pqr?.hasReports) {
                g.damagedLots += 1;
                g.totalReportedUnits += row.pqr.totalReportedUnits || 0;
                g.totalReportItems += row.pqr.totalReportItems || 0;
            }
        });

        return Array.from(grouped.values())
            .filter(item => item.totalLots >= minLots && item.damagedLots >= minDamaged)
            .map((item) => {
                const rawRate = safeDivideNumber(item.damagedLots, item.totalLots, 0);
                const smoothedRate = safeDivideNumber(
                    item.damagedLots + baselineSafe * priorWeight,
                    item.totalLots + priorWeight,
                    baselineSafe
                );
                const riskRatio = safeDivideNumber(smoothedRate, baselineSafe, 0);
                const expected = item.totalLots * baselineSafe;
                const variance = item.totalLots * baselineSafe * (1 - baselineSafe);
                const zScore = variance > 0 ? (item.damagedLots - expected) / Math.sqrt(variance) : 0;
                const confidenceScore = clampValue(((Math.abs(zScore) - 0.7) / 3.3) * 100, 0, 100);
                return {
                    ...item,
                    damageRate: roundNumber(rawRate, 4),
                    smoothedDamageRate: roundNumber(smoothedRate, 4),
                    riskRatio: roundNumber(riskRatio, 2),
                    excessDamageRate: roundNumber(smoothedRate - baselineSafe, 4),
                    zScore: roundNumber(zScore, 3),
                    pValue: roundNumber(twoTailedPValue(zScore), 4),
                    confidenceScore: roundNumber(confidenceScore, 1)
                };
            })
            .filter(item =>
                (item.riskRatio || 0) >= minRiskRatio &&
                (item.excessDamageRate || 0) > 0 &&
                (item.zScore || 0) >= 0.8
            )
            .sort((a, b) => {
                const scoreA = (a.riskRatio || 0) * (0.5 + (a.confidenceScore || 0) / 100);
                const scoreB = (b.riskRatio || 0) * (0.5 + (b.confidenceScore || 0) / 100);
                if (scoreB !== scoreA) return scoreB - scoreA;
                return (b.totalReportedUnits || 0) - (a.totalReportedUnits || 0);
            });
    };

    const byFlavor = buildCategoryRisk({
        keyFn: (row) => row.flavor || row.flavorRaw || 'Sin sabor',
        minLots: 12,
        minDamaged: 3,
        minRiskRatio: 1.15
    });
    const byShift = buildCategoryRisk({
        keyFn: (row) => hourToShift(parseHourFromLotKey(row.lotKey)),
        minLots: 20,
        minDamaged: 3,
        minRiskRatio: 1.1
    });

    const presentationSizes = ['3400g', '1150g', '350g'];
    const byPresentation = presentationSizes
        .map((size) => {
            const lotsWithProduction = rows.filter(r => (r.producedUnits?.[size] || 0) > 0);
            const damagedLotsForSize = lotsWithProduction.filter((row) =>
                (row.pqr?.byPresentation || []).some((p) => normalizePresentationSize(p.size) === size && (p.reportedUnits || 0) > 0)
            );
            const rawRate = safeDivideNumber(damagedLotsForSize.length, lotsWithProduction.length, 0);
            const smoothedRate = safeDivideNumber(
                damagedLotsForSize.length + baselineSafe * priorWeight,
                lotsWithProduction.length + priorWeight,
                baselineSafe
            );
            const riskRatio = safeDivideNumber(smoothedRate, baselineSafe, 0);
            const expected = lotsWithProduction.length * baselineSafe;
            const variance = lotsWithProduction.length * baselineSafe * (1 - baselineSafe);
            const zScore = variance > 0 ? (damagedLotsForSize.length - expected) / Math.sqrt(variance) : 0;
            const confidenceScore = clampValue(((Math.abs(zScore) - 0.6) / 3.2) * 100, 0, 100);
            const totalReportedUnits = damagedLotsForSize.reduce((sum, row) => {
                const match = (row.pqr?.byPresentation || []).find((p) => normalizePresentationSize(p.size) === size);
                return sum + (match?.reportedUnits || 0);
            }, 0);
            return {
                key: size,
                totalLots: lotsWithProduction.length,
                damagedLots: damagedLotsForSize.length,
                damageRate: roundNumber(rawRate, 4),
                smoothedDamageRate: roundNumber(smoothedRate, 4),
                riskRatio: roundNumber(riskRatio, 2),
                excessDamageRate: roundNumber(smoothedRate - baselineSafe, 4),
                zScore: roundNumber(zScore, 3),
                confidenceScore: roundNumber(confidenceScore, 1),
                totalReportedUnits: roundNumber(totalReportedUnits, 2)
            };
        })
        .filter(item =>
            item.totalLots >= 10 &&
            item.damagedLots >= 2 &&
            (item.riskRatio || 0) >= 1.08 &&
            (item.excessDamageRate || 0) > 0 &&
            (item.zScore || 0) >= 0.7
        )
        .sort((a, b) => {
            const scoreA = (a.riskRatio || 0) * (0.5 + (a.confidenceScore || 0) / 100);
            const scoreB = (b.riskRatio || 0) * (0.5 + (b.confidenceScore || 0) / 100);
            return scoreB - scoreA;
        });

    const buildInteractionRisk = ({ keyFn, minLots = 8, minDamaged = 2, minRiskRatio = 1.15 }) => {
        const grouped = new Map();
        rows.forEach((row) => {
            const key = keyFn(row) || 'No definido';
            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    totalLots: 0,
                    damagedLots: 0,
                    totalReportedUnits: 0
                });
            }
            const g = grouped.get(key);
            g.totalLots += 1;
            if (row.pqr?.hasReports) {
                g.damagedLots += 1;
                g.totalReportedUnits += row.pqr.totalReportedUnits || 0;
            }
        });

        return Array.from(grouped.values())
            .filter(item => item.totalLots >= minLots && item.damagedLots >= minDamaged)
            .map((item) => {
                const rawRate = safeDivideNumber(item.damagedLots, item.totalLots, 0);
                const smoothedRate = safeDivideNumber(
                    item.damagedLots + baselineSafe * priorWeight,
                    item.totalLots + priorWeight,
                    baselineSafe
                );
                const riskRatio = safeDivideNumber(smoothedRate, baselineSafe, 0);
                const expected = item.totalLots * baselineSafe;
                const variance = item.totalLots * baselineSafe * (1 - baselineSafe);
                const zScore = variance > 0 ? (item.damagedLots - expected) / Math.sqrt(variance) : 0;
                return {
                    ...item,
                    damageRate: roundNumber(rawRate, 4),
                    smoothedDamageRate: roundNumber(smoothedRate, 4),
                    riskRatio: roundNumber(riskRatio, 2),
                    excessDamageRate: roundNumber(smoothedRate - baselineSafe, 4),
                    zScore: roundNumber(zScore, 3),
                    confidenceScore: roundNumber(clampValue(((Math.abs(zScore) - 0.65) / 3.2) * 100, 0, 100), 1)
                };
            })
            .filter(item =>
                (item.riskRatio || 0) >= minRiskRatio &&
                (item.excessDamageRate || 0) > 0 &&
                (item.zScore || 0) >= 0.5
            )
            .sort((a, b) => {
                const scoreA = (a.riskRatio || 0) * (0.45 + (a.confidenceScore || 0) / 100);
                const scoreB = (b.riskRatio || 0) * (0.45 + (b.confidenceScore || 0) / 100);
                if (scoreB !== scoreA) return scoreB - scoreA;
                return (b.totalReportedUnits || 0) - (a.totalReportedUnits || 0);
            });
    };

    const byFlavorShift = buildInteractionRisk({
        keyFn: (row) => `${row.flavor || row.flavorRaw || 'Sin sabor'} · ${hourToShift(parseHourFromLotKey(row.lotKey))}`,
        minLots: 8,
        minDamaged: 2,
        minRiskRatio: 1.2
    }).slice(0, 10);

    const byFlavorPresentation = buildInteractionRisk({
        keyFn: (row) => {
            const sizes = ['3400g', '1150g', '350g'].filter(size => (row.producedUnits?.[size] || 0) > 0);
            return `${row.flavor || row.flavorRaw || 'Sin sabor'} · ${sizes.length ? sizes.join('+') : 'Sin presentación'}`;
        },
        minLots: 10,
        minDamaged: 2,
        minRiskRatio: 1.15
    }).slice(0, 10);

    const numericDefs = [
        { field: 'phJarabe', label: 'pH Jarabe', unit: '' },
        { field: 'bxJarabe', label: 'Bx Jarabe', unit: '' },
        { field: 'conductividad', label: 'Conductividad', unit: '' },
        { field: 'bxPerla', label: 'Bx Perla', unit: '' },
        { field: 'tempCoccion', label: 'Temp Cocción', unit: 'C' },
        { field: 'tempChiller', label: 'Temp Chiller', unit: 'C' },
        { field: 'pesoPerlas', label: 'Peso Perlas', unit: '' },
        { field: 'mixQuantityKg', label: 'Mezcla (kg)', unit: 'kg' },
        { field: 'protectionQuantityKg', label: 'Protección (kg)', unit: 'kg' },
        { field: 'protectionPh', label: 'pH Protección', unit: '' },
        { field: 'protectionBx', label: 'Bx Protección', unit: '' },
        { field: 'pearlCookTempC', label: 'Temp Cocción Perla', unit: 'C' },
        { field: 'pearlCookTimeSec', label: 'Tiempo Cocción Perla', unit: 's' },
        { field: 'productionDurationMin', label: 'Duración Producción', unit: 'min' },
        { field: 'damagedAtProductionTotal', label: 'Dañados en Fabricación', unit: 'uds' },
        { field: 'internalDamageRatePct', label: '% Daño en Fabricación', unit: '%' }
    ];

    const numericSignals = [];
    numericDefs.forEach((def) => {
        const values = rows
            .map((row) => ({ damaged: Boolean(row.pqr?.hasReports), value: toFiniteNumber(row[def.field]) }))
            .filter(entry => entry.value !== null);
        if (!values.length) return;

        const sorted = values.map(v => v.value).sort((a, b) => a - b);
        const q1 = percentile(sorted, 0.25);
        const q3 = percentile(sorted, 0.75);
        const iqr = (q3 ?? 0) - (q1 ?? 0);
        const lower = iqr > 0 ? q1 - 1.5 * iqr : q1;
        const upper = iqr > 0 ? q3 + 1.5 * iqr : q3;

        const cleaned = values.filter(v => v.value >= lower && v.value <= upper);
        const damaged = cleaned.filter(v => v.damaged).map(v => v.value);
        const healthy = cleaned.filter(v => !v.damaged).map(v => v.value);
        if (damaged.length < 12 || healthy.length < 50) return;

        const damagedSorted = [...damaged].sort((a, b) => a - b);
        const healthySorted = [...healthy].sort((a, b) => a - b);
        const damagedMedian = percentile(damagedSorted, 0.5);
        const healthyMedian = percentile(healthySorted, 0.5);
        const healthyQ1 = percentile(healthySorted, 0.25);
        const healthyQ3 = percentile(healthySorted, 0.75);
        const healthyIqr = (healthyQ3 ?? 0) - (healthyQ1 ?? 0);
        const mad = medianAbsoluteDeviation(healthy, healthyMedian);
        const robustScale = Math.max(
            (mad ? mad * 1.4826 : 0),
            healthyIqr > 0 ? healthyIqr / 1.349 : 0,
            0.0001
        );
        const diff = (damagedMedian ?? 0) - (healthyMedian ?? 0);
        const robustDiffZ = diff / robustScale;
        const delta = cliffsDeltaRobust(damaged, healthy);
        const confidenceScore = roundNumber(
            clampValue(
                ((Math.min(damaged.length, healthy.length) / 120) * 45) +
                (Math.max(Math.abs(robustDiffZ) / 3, Math.abs(delta)) * 55),
                0,
                100
            ),
            1
        );
        if (Math.abs(robustDiffZ) < 0.35 && Math.abs(delta) < 0.18) return;

        numericSignals.push({
            metric: def.field,
            label: def.label,
            unit: def.unit,
            direction: diff >= 0 ? 'higher' : 'lower',
            damagedMedian: roundNumber(damagedMedian, 4),
            healthyMedian: roundNumber(healthyMedian, 4),
            absoluteDiff: roundNumber(diff, 4),
            pctDiff: roundNumber(Math.abs(healthyMedian || 0) > 0 ? (diff / Math.abs(healthyMedian)) * 100 : null, 2),
            robustDiffZ: roundNumber(robustDiffZ, 3),
            effectSize: roundNumber(robustDiffZ, 3),
            cliffsDelta: roundNumber(delta, 3),
            probabilityDamagedGreater: roundNumber((delta + 1) / 2, 3),
            robustScale: roundNumber(robustScale, 6),
            confidenceScore,
            damagedSample: damaged.length,
            healthySample: healthy.length
        });
    });

    numericSignals.sort((a, b) => {
        const scoreA = Math.abs(a.robustDiffZ || 0) * (0.5 + (a.confidenceScore || 0) / 100);
        const scoreB = Math.abs(b.robustDiffZ || 0) * (0.5 + (b.confidenceScore || 0) / 100);
        return scoreB - scoreA;
    });

    const flavorRiskMap = new Map(byFlavor.map(item => [String(item.key || '').toLowerCase(), item]));
    const shiftRiskMap = new Map(byShift.map(item => [item.key, item]));
    const presentationRiskMap = new Map(byPresentation.map(item => [item.key, item]));
    const now = new Date();

    const scoreLot = (row) => {
        let score = 0;
        const reasons = [];
        const pushReason = (label, contribution) => {
            if (contribution <= 0) return;
            score += contribution;
            if (reasons.length < 8) reasons.push(`${label} (+${roundNumber(contribution, 2)})`);
        };

        const flavorRisk = flavorRiskMap.get(String(row.flavor || row.flavorRaw || '').toLowerCase());
        if (flavorRisk) {
            const contribution = clampValue(
                Math.log(Math.max(flavorRisk.riskRatio || 1, 1)) * (0.95 + (flavorRisk.confidenceScore || 0) / 100),
                0,
                3.6
            );
            pushReason(`Sabor ${row.flavor} RR ${flavorRisk.riskRatio}`, contribution);
        }

        const shiftKey = hourToShift(parseHourFromLotKey(row.lotKey));
        const shiftRisk = shiftRiskMap.get(shiftKey);
        if (shiftRisk) {
            const contribution = clampValue(
                Math.log(Math.max(shiftRisk.riskRatio || 1, 1)) * (0.8 + (shiftRisk.confidenceScore || 0) / 130),
                0,
                2.5
            );
            pushReason(`Turno ${shiftKey} RR ${shiftRisk.riskRatio}`, contribution);
        }

        const presentationContrib = ['3400g', '1150g', '350g'].reduce((acc, size) => {
            if ((row.producedUnits?.[size] || 0) <= 0) return acc;
            const risk = presentationRiskMap.get(size);
            if (!risk) return acc;
            return acc + clampValue(Math.log(Math.max(risk.riskRatio || 1, 1)) * 0.45, 0, 1.2);
        }, 0);
        if (presentationContrib > 0) pushReason('Patrón por presentación', presentationContrib);

        const internalDamaged = toFiniteNumber(row.damagedAtProductionTotal) || 0;
        if (internalDamaged > 0) {
            pushReason(`Dañados fabricación ${internalDamaged}`, clampValue(0.8 + Math.log1p(internalDamaged), 0, 2.9));
        }
        const internalDamageRatePct = toFiniteNumber(row.internalDamageRatePct);
        if (internalDamageRatePct && internalDamageRatePct > 0.15) {
            pushReason(`Tasa daño interno ${roundNumber(internalDamageRatePct, 2)}%`, clampValue(internalDamageRatePct / 1.5, 0, 2.5));
        }

        let signalHits = 0;
        numericSignals.slice(0, 10).forEach((signal) => {
            const value = toFiniteNumber(row[signal.metric]);
            const healthyMedian = toFiniteNumber(signal.healthyMedian);
            const robustScale = Math.max(toFiniteNumber(signal.robustScale) || 0, 0.0001);
            if (value === null || healthyMedian === null) return;
            const orientedZ = signal.direction === 'higher'
                ? (value - healthyMedian) / robustScale
                : (healthyMedian - value) / robustScale;
            if (orientedZ <= 0) return;

            const weight = 0.45 + Math.min(1, Math.abs(signal.robustDiffZ || 0) * 0.24) + Math.min(0.6, Math.abs(signal.cliffsDelta || 0));
            const confidenceWeight = 0.55 + (signal.confidenceScore || 0) / 100;
            const contribution = clampValue(Math.min(2.5, orientedZ) * weight * confidenceWeight * 0.45, 0, 2.7);
            if (contribution <= 0) return;
            signalHits += 1;
            pushReason(`${signal.label} ${signal.direction === 'higher' ? 'alto' : 'bajo'}`, contribution);
        });

        const daysSinceProduction = row.productionDate
            ? Math.max(0, Math.floor((now - new Date(row.productionDate)) / (1000 * 60 * 60 * 24)))
            : null;
        if (daysSinceProduction !== null) {
            if (daysSinceProduction <= 21) score += 0.55;
            else if (daysSinceProduction <= 45) score += 0.4;
            else if (daysSinceProduction <= 75) score += 0.2;
            else if (daysSinceProduction >= 180) score -= 0.25;
        }

        return {
            id: row.id,
            lotCode: row.lotCode,
            displayLot: row.displayLot,
            flavor: row.flavor,
            productionDate: row.productionDate,
            daysSinceProduction,
            producedUnits: row.producedUnits,
            damagedAtProduction: row.damagedAtProduction,
            damagedAtProductionTotal: internalDamaged,
            internalDamageRatePct: roundNumber(internalDamageRatePct, 2),
            phJarabe: row.phJarabe,
            bxJarabe: row.bxJarabe,
            conductividad: row.conductividad,
            bxPerla: row.bxPerla,
            tempCoccion: row.tempCoccion,
            pearlCookTempC: row.pearlCookTempC,
            pearlCookTimeSec: row.pearlCookTimeSec,
            protectionPh: row.protectionPh,
            protectionBx: row.protectionBx,
            productionDurationMin: row.productionDurationMin,
            modelScore: roundNumber(score, 3),
            signalHits,
            reasons: reasons.slice(0, 6),
            hasReports: Boolean(row.pqr?.hasReports)
        };
    };

    const scored = rows.map(scoreLot);
    const nonReportedScores = scored
        .filter(item => !item.hasReports)
        .map(item => item.modelScore || 0)
        .sort((a, b) => a - b);

    const defaultThresholds = { watch: 1.8, medium: 2.8, high: 4 };
    const thresholds = {
        watch: roundNumber(Math.max(defaultThresholds.watch, percentile(nonReportedScores, 0.88) || defaultThresholds.watch), 3),
        medium: roundNumber(Math.max(defaultThresholds.medium, percentile(nonReportedScores, 0.94) || defaultThresholds.medium), 3),
        high: roundNumber(Math.max(defaultThresholds.high, percentile(nonReportedScores, 0.98) || defaultThresholds.high), 3)
    };
    if (thresholds.medium <= thresholds.watch) thresholds.medium = roundNumber(thresholds.watch + 0.45, 3);
    if (thresholds.high <= thresholds.medium) thresholds.high = roundNumber(thresholds.medium + 0.6, 3);

    const scoreCenter = thresholds.medium;
    const scoreScale = Math.max(0.8, (thresholds.high - thresholds.watch) / 2.3);

    const scoredWithProbability = scored.map((item) => {
        const probability = 1 / (1 + Math.exp(-((item.modelScore - scoreCenter) / scoreScale)));
        let riskLevel = 'low';
        if (item.modelScore >= thresholds.high) riskLevel = 'high';
        else if (item.modelScore >= thresholds.medium) riskLevel = 'medium';
        else if (item.modelScore >= thresholds.watch) riskLevel = 'watch';
        return {
            ...item,
            riskLevel,
            modelProbability: roundNumber(probability * 100, 2)
        };
    });

    const evaluateThreshold = (threshold) => {
        let tp = 0;
        let fp = 0;
        let tn = 0;
        let fn = 0;
        scoredWithProbability.forEach((row) => {
            const predicted = (row.modelScore || 0) >= threshold;
            const actual = Boolean(row.hasReports);
            if (predicted && actual) tp += 1;
            else if (predicted && !actual) fp += 1;
            else if (!predicted && actual) fn += 1;
            else tn += 1;
        });
        const precision = safeDivideNumber(tp, tp + fp, 0);
        const recall = safeDivideNumber(tp, tp + fn, 0);
        const specificity = safeDivideNumber(tn, tn + fp, 0);
        const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        return {
            threshold: roundNumber(threshold, 3),
            tp,
            fp,
            tn,
            fn,
            precision: roundNumber(precision, 3),
            recall: roundNumber(recall, 3),
            specificity: roundNumber(specificity, 3),
            f1: roundNumber(f1, 3)
        };
    };

    const evaluateRankingPerformance = () => {
        const positives = scoredWithProbability.filter(r => r.hasReports).length;
        const negatives = scoredWithProbability.length - positives;
        if (!positives || !negatives) {
            return {
                aucRoc: null,
                aucPr: null,
                topDecileLift: null,
                topDecileDamageRatePct: null
            };
        }

        const sorted = [...scoredWithProbability].sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0));
        let tp = 0;
        let fp = 0;
        let idx = 0;
        const rocPoints = [{ fpr: 0, tpr: 0 }];
        const prPoints = [{ recall: 0, precision: 1 }];

        while (idx < sorted.length) {
            const currentScore = sorted[idx].modelScore || 0;
            let groupTp = 0;
            let groupFp = 0;
            while (idx < sorted.length && (sorted[idx].modelScore || 0) === currentScore) {
                if (sorted[idx].hasReports) groupTp += 1;
                else groupFp += 1;
                idx += 1;
            }
            tp += groupTp;
            fp += groupFp;
            const tpr = safeDivideNumber(tp, positives, 0);
            const fpr = safeDivideNumber(fp, negatives, 0);
            const precision = safeDivideNumber(tp, tp + fp, 1);
            rocPoints.push({ fpr, tpr });
            prPoints.push({ recall: tpr, precision });
        }

        const aucRoc = rocPoints.reduce((acc, point, i) => {
            if (i === 0) return 0;
            const prev = rocPoints[i - 1];
            return acc + ((point.fpr - prev.fpr) * (point.tpr + prev.tpr)) / 2;
        }, 0);
        const aucPr = prPoints.reduce((acc, point, i) => {
            if (i === 0) return 0;
            const prev = prPoints[i - 1];
            return acc + ((point.recall - prev.recall) * (point.precision + prev.precision)) / 2;
        }, 0);

        const topDecileN = Math.max(1, Math.ceil(sorted.length * 0.1));
        const topDecile = sorted.slice(0, topDecileN);
        const topDecilePositives = topDecile.filter(r => r.hasReports).length;
        const topDecileRate = safeDivideNumber(topDecilePositives, topDecileN, 0);
        const topDecileLift = baselineDamageRate > 0 ? topDecileRate / baselineDamageRate : null;

        return {
            aucRoc: roundNumber(aucRoc, 3),
            aucPr: roundNumber(aucPr, 3),
            topDecileLift: roundNumber(topDecileLift, 3),
            topDecileDamageRatePct: roundNumber(topDecileRate * 100, 2)
        };
    };

    const rankingPerformance = evaluateRankingPerformance();

    const probableUnreportedLots = scoredWithProbability
        .filter(item => !item.hasReports && (item.modelScore || 0) >= thresholds.watch)
        .sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0))
        .slice(0, 80)
        .map(({ hasReports, ...rest }) => rest);

    return {
        method: {
            name: 'Robust Pattern + Risk Scoring Engine',
            version: 'v2.1',
            baseline: 'Tasa histórica de lotes con PQR',
            categoricalSmoothing: `Bayesian prior weight=${priorWeight}`,
            numericCleaning: 'IQR + robust scale (MAD/IQR)',
            effectMetrics: ['z-score binomial', 'robust z-diff', 'cliff delta'],
            interactionPatterns: ['flavor x shift', 'flavor x presentation'],
            minimumSupport: {
                categoricalLots: 10,
                categoricalDamagedLots: 3,
                numericDamagedSample: 12,
                numericHealthySample: 50
            }
        },
        baseline: {
            totalLots,
            damagedLots,
            baselineDamageRate: roundNumber(baselineDamageRate, 4),
            baselineDamageRatePct: roundNumber(baselineDamageRate * 100, 2)
        },
        byFlavor: byFlavor.slice(0, 12),
        byShift: byShift.slice(0, 6),
        byPresentation,
        interactionPatterns: {
            byFlavorShift,
            byFlavorPresentation
        },
        byDaysToFirstReport: legacy.byDaysToFirstReport || [],
        numericSignals: numericSignals.slice(0, 10),
        probableUnreportedLots,
        predictiveModel: {
            thresholds,
            backtest: {
                watch: evaluateThreshold(thresholds.watch),
                medium: evaluateThreshold(thresholds.medium),
                high: evaluateThreshold(thresholds.high)
            },
            scoreCenter: roundNumber(scoreCenter, 3),
            scoreScale: roundNumber(scoreScale, 3),
            performance: {
                ...rankingPerformance,
                baselineDamageRatePct: roundNumber(baselineDamageRate * 100, 2)
            },
            trainingPopulation: {
                total: scoredWithProbability.length,
                positives: scoredWithProbability.filter(r => r.hasReports).length,
                negatives: scoredWithProbability.filter(r => !r.hasReports).length
            }
        },
        dataQuality: legacy.dataQuality || []
    };
};

/**
 * GET /api/pqr/analytics
 * Returns all PQR analytics aggregations in a single response
 */
exports.getPQRAnalytics = async (req, res) => {
    try {
        const distributorIdFilter = typeof req.query.distributorId === 'string'
            ? req.query.distributorId.trim()
            : '';

        // Fetch all PQRs with items and product details
        const pqrs = await prisma.pQR.findMany({
            where: distributorIdFilter
                ? { userId: distributorIdFilter }
                : undefined,
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, flavor: true, size: true } },
                        evidence: true
                    }
                },
                user: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Flatten all items with parent PQR info
        const allItems = pqrs.flatMap(pqr =>
            pqr.items.map(item => ({
                ...item,
                pqrStage: pqr.stage,
                pqrStatus: pqr.status,
                pqrRefundMethod: pqr.refundMethod,
                pqrCreatedAt: pqr.createdAt,
                pqrResolvedAt: pqr.resolvedAt,
                distributorName: pqr.user?.name || 'Desconocido',
                distributorEmail: pqr.user?.email || '',
                productName: item.product?.name || 'Producto Desconocido',
                productSku: item.product?.sku || '',
                productFlavor: item.product?.flavor || 'Sin sabor',
                productSize: item.product?.size || 'Sin tamaño'
            }))
        );

        // 1. KPIs
        const totalPQRs = pqrs.length;
        const totalUnitsAffected = allItems.reduce((sum, item) => sum + toQuantityNumber(item.quantity), 0);
        const resolvedPQRs = pqrs.filter(p => p.stage === 'COMPLETED' || p.stage === 'REJECTED');
        const resolutionRate = totalPQRs > 0 ? Math.round((resolvedPQRs.length / totalPQRs) * 100) : 0;

        // Average resolution time (days) for resolved PQRs
        const resolvedWithTime = pqrs.filter(p => p.resolvedAt && p.createdAt);
        const avgResolutionDays = resolvedWithTime.length > 0
            ? Math.round(resolvedWithTime.reduce((sum, p) => {
                const diff = new Date(p.resolvedAt) - new Date(p.createdAt);
                return sum + diff / (1000 * 60 * 60 * 24);
            }, 0) / resolvedWithTime.length * 10) / 10
            : 0;

        const kpis = { totalPQRs, totalUnitsAffected, resolutionRate, avgResolutionDays, totalProducts: allItems.length };

        // 2. By Stage
        const byStage = {};
        pqrs.forEach(pqr => {
            byStage[pqr.stage] = (byStage[pqr.stage] || 0) + 1;
        });
        const stageLabels = {
            PENDING_REVIEW: 'Revisión Calidad',
            PENDING_BILLING: 'Nota Crédito',
            PENDING_INVOICE: 'Facturación',
            PENDING_LOGISTICS: 'Logística',
            COMPLETED: 'Completado',
            REJECTED: 'Rechazado'
        };
        const byStageData = Object.entries(byStage).map(([key, value]) => ({
            stage: key, label: stageLabels[key] || key, count: value
        }));

        // 3. By Defect Type
        const byType = {};
        allItems.forEach(item => {
            const type = item.type || 'CALIDAD';
            if (!byType[type]) byType[type] = { count: 0, quantity: 0 };
            byType[type].count++;
            byType[type].quantity += toQuantityNumber(item.quantity);
        });
        const typeLabels = { CALIDAD: 'Calidad', FALTANTE: 'Faltante', SOBRANTE: 'Sobrante' };
        const byTypeData = Object.entries(byType).map(([key, value]) => ({
            type: key, label: typeLabels[key] || key, ...value
        }));

        // 4. By Product (top 15)
        const byProduct = {};
        allItems.forEach(item => {
            const key = item.productSku || item.productName;
            if (!byProduct[key]) byProduct[key] = { name: item.productName, sku: item.productSku, count: 0, quantity: 0 };
            byProduct[key].count++;
            byProduct[key].quantity += toQuantityNumber(item.quantity);
        });
        const byProductData = Object.values(byProduct)
            .sort((a, b) => b.count - a.count)
            .slice(0, 15);

        // 5. By Flavor
        const byFlavor = {};
        allItems.forEach(item => {
            const flavor = item.productFlavor;
            if (!byFlavor[flavor]) byFlavor[flavor] = { count: 0, quantity: 0 };
            byFlavor[flavor].count++;
            byFlavor[flavor].quantity += toQuantityNumber(item.quantity);
        });
        const byFlavorData = Object.entries(byFlavor).map(([key, value]) => ({
            flavor: key, ...value
        })).sort((a, b) => b.count - a.count);

        // 6. By Size
        const bySize = {};
        allItems.forEach(item => {
            const size = item.productSize;
            if (!bySize[size]) bySize[size] = { count: 0, quantity: 0 };
            bySize[size].count++;
            bySize[size].quantity += toQuantityNumber(item.quantity);
        });
        const bySizeData = Object.entries(bySize).map(([key, value]) => ({
            size: key, ...value
        })).sort((a, b) => b.count - a.count);

        // 7. By Lot (critical tracking — consolidated by flavor, ignoring size)
        const byLot = {};
        allItems.forEach(item => {
            if (!item.lotNumber) return;
            const lot = item.lotNumber;
            if (!byLot[lot]) {
                byLot[lot] = {
                    lot,
                    products: new Set(),
                    flavors: new Set(),
                    items: [],
                    count: 0,
                    quantity: 0,
                    distributors: new Set(),
                    byPresentation: {},
                    defectCounts: {},
                    defectUnits: {}
                };
            }
            byLot[lot].count++;
            const qty = toQuantityNumber(item.quantity);
            byLot[lot].quantity += qty;
            const defectType = extractDefectTypeFromText(item.description, item.type);
            byLot[lot].products.add(item.productName);
            byLot[lot].flavors.add(item.productFlavor);
            byLot[lot].distributors.add(item.distributorName);
            byLot[lot].defectCounts[defectType] = (byLot[lot].defectCounts[defectType] || 0) + 1;
            byLot[lot].defectUnits[defectType] = (byLot[lot].defectUnits[defectType] || 0) + qty;
            const presentation = item.productSize || 'Sin tamaño';
            if (!byLot[lot].byPresentation[presentation]) {
                byLot[lot].byPresentation[presentation] = {
                    size: presentation,
                    count: 0,
                    itemCount: 0,
                    quantity: 0,
                    reportedUnits: 0
                };
            }
            byLot[lot].byPresentation[presentation].count += 1;
            byLot[lot].byPresentation[presentation].itemCount += 1;
            byLot[lot].byPresentation[presentation].quantity += qty;
            byLot[lot].byPresentation[presentation].reportedUnits += qty;
            byLot[lot].items.push({
                product: item.productName,
                sku: item.productSku,
                flavor: item.productFlavor,
                size: item.productSize,
                quantity: qty,
                unit: item.unit,
                description: item.description,
                distributor: item.distributorName,
                date: item.pqrCreatedAt,
                type: item.type,
                defectType,
                defectLabel: formatDefectLabel(defectType),
                evidence: (item.evidence || []).map(e => ({ url: e.url, type: e.type }))
            });
        });
        const sortPresentations = (a, b) => {
            const aNum = parseInt(String(a.size || '').replace(/[^\d]/g, ''), 10);
            const bNum = parseInt(String(b.size || '').replace(/[^\d]/g, ''), 10);
            const aHasNum = !isNaN(aNum);
            const bHasNum = !isNaN(bNum);
            if (aHasNum && bHasNum) return bNum - aNum;
            if (aHasNum) return -1;
            if (bHasNum) return 1;
            return String(a.size || '').localeCompare(String(b.size || ''));
        };

        let byLotData = Object.values(byLot)
            .map((l) => {
                const defectSummary = buildDefectSummaryFromItems(l.items);
                return {
                    lot: l.lot,
                    lotAliases: [l.lot],
                    count: l.count,
                    quantity: l.quantity,
                    flavors: Array.from(l.flavors),
                    products: Array.from(l.products),
                    items: l.items,
                    distributors: Array.from(l.distributors),
                    presentationCounts: Object.values(l.byPresentation).sort(sortPresentations),
                    defectSummary,
                    severity: l.quantity >= 10 ? 'recall' : l.count >= 3 ? 'critical' : l.count >= 2 ? 'warning' : 'normal'
                };
            })
            .sort((a, b) => b.count - a.count);

        // 8. By Distributor
        const byDistributor = {};
        pqrs.forEach(pqr => {
            const key = pqr.user?.id || `unknown:${pqr.user?.name || 'Desconocido'}`;
            if (!byDistributor[key]) {
                byDistributor[key] = {
                    distributorId: pqr.user?.id || null,
                    distributor: pqr.user?.name || 'Desconocido',
                    count: 0,
                    quantity: 0
                };
            }
            byDistributor[key].count++;
            byDistributor[key].quantity += pqr.items.reduce((s, i) => s + toQuantityNumber(i.quantity), 0);
        });
        const byDistributorData = Object.values(byDistributor)
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return a.distributor.localeCompare(b.distributor);
            });

        // 9. By Month (timeline)
        const byMonth = {};
        pqrs.forEach(pqr => {
            const d = new Date(pqr.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!byMonth[key]) byMonth[key] = { count: 0, quantity: 0 };
            byMonth[key].count++;
            byMonth[key].quantity += pqr.items.reduce((s, i) => s + toQuantityNumber(i.quantity), 0);
        });
        const byMonthData = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => {
                const [year, month] = key.split('-');
                const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                return { month: `${monthNames[parseInt(month) - 1]} ${year}`, ...value };
            });

        // 10. By Refund Method
        const byRefundMethod = {};
        pqrs.forEach(pqr => {
            const method = pqr.refundMethod || 'NO_DEFINIDO';
            byRefundMethod[method] = (byRefundMethod[method] || 0) + 1;
        });
        const methodLabels = { WALLET_BALANCE: 'Saldo a Favor', PHYSICAL_REPLACEMENT: 'Reposición Física', NO_DEFINIDO: 'No Definido' };
        const byRefundMethodData = Object.entries(byRefundMethod).map(([key, value]) => ({
            method: key, label: methodLabels[key] || key, count: value
        }));

        // 11. Defect keyword analysis (from descriptions)
        const defectKeywords = {};
        allItems.forEach(item => {
            const desc = (item.description || '').toUpperCase();
            const keywords = ['INFLADO', 'DESINFLADO', 'ROTO', 'VENCIDO', 'DERRAMADO', 'CONTAMINADO', 'GOLPEADO', 'ABIERTO', 'HÚMEDO', 'DECOLORADO'];
            keywords.forEach(kw => {
                if (desc.includes(kw)) {
                    defectKeywords[kw] = (defectKeywords[kw] || 0) + 1;
                }
            });
        });
        const defectKeywordsData = Object.entries(defectKeywords)
            .map(([keyword, count]) => ({ keyword, count }))
            .sort((a, b) => b.count - a.count);

        // 12. Lot Age Analysis — days from production to first PQR report
        const DAY_MS = 1000 * 60 * 60 * 24;
        const now = new Date();

        // Parse production date from lot code format YYMMDD-HHMM
        const parseLotDate = (lotCode) => {
            if (!lotCode) return null;
            const match = lotCode.match(/^(\d{2})(\d{2})(\d{2})/);
            if (!match) return null;
            const [, yy, mm, dd] = match;
            const year = 2000 + parseInt(yy);
            const month = parseInt(mm) - 1;
            const day = parseInt(dd);
            if (month < 0 || month > 11 || day < 1 || day > 31) return null;
            return new Date(year, month, day);
        };

        const normalizeFlavorValue = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        // Batch lookup of production dates and quantities from DB
        // PQR lots use format '260206-1220', DB stores '2602061220SA4' — need prefix matching
        const lotCodes = byLotData.map(l => l.lot);
        const lotRefMap = new Map(
            lotCodes.map((lotCode) => [lotCode, parseLotReference(lotCode)])
        );
        const lotPrefixes = lotCodes.map((lotCode) => lotRefMap.get(lotCode)?.digits || '');
        const lotDatePrefixes = Array.from(new Set(
            lotCodes
                .map((lotCode) => lotRefMap.get(lotCode)?.dateKey)
                .filter(Boolean)
        ));
        const searchPrefixes = Array.from(new Set([
            ...lotPrefixes.filter((prefix) => prefix && prefix.length >= 6),
            ...lotDatePrefixes
        ]));

        // Fetch all production lots that start with any of our prefixes
        const [allProdLots, allSyrupLots] = await Promise.all([
            searchPrefixes.length > 0
                ? prisma.$queryRawUnsafe(
                    `SELECT "lotCode", "flavor", "productionDate", "mixQuantityKg", "pesoPerlas", units3400, units1150, units350 FROM production_lots WHERE ${searchPrefixes.map((_, i) => `"lotCode" LIKE $${i + 1}`).join(' OR ')}`,
                    ...searchPrefixes.map(p => `${p}%`)
                )
                : [],
            prisma.syrupLot.findMany({
                where: { lotCode: { in: lotCodes } },
                select: { lotCode: true, productionDate: true, mixQuantityKg: true }
            })
        ]);

        // Build maps: for each PQR lotCode, find matching production lots by prefix
        const prodDateMap = {};
        const prodUnitsMap = {};
        const prodMatchModeMap = {};
        const lotMetaMap = new Map(
            byLotData.map((entry) => [entry.lot, entry])
        );
        const lotFlavorNormMap = new Map(
            lotCodes.map((pqrLot) => {
                const lotMeta = lotMetaMap.get(pqrLot);
                const norms = new Set(
                    (lotMeta?.flavors || [])
                        .map((f) => normalizeFlavorValue(f))
                        .filter(Boolean)
                );
                return [pqrLot, norms];
            })
        );
        const filterMatchesByFlavor = (matches, flavorNorms) => {
            if (!Array.isArray(matches) || matches.length === 0) return { selected: [], hasFlavorScoped: false };
            if (!flavorNorms || flavorNorms.size === 0) return { selected: matches, hasFlavorScoped: false };
            const scoped = matches.filter((m) => flavorNorms.has(normalizeFlavorValue(m.flavor)));
            return {
                selected: scoped.length > 0 ? scoped : matches,
                hasFlavorScoped: scoped.length > 0
            };
        };
        const unitsFromMatches = (matches) => {
            const u3400 = matches.reduce((s, m) => s + (parseInt(m.units3400) || 0), 0);
            const u1150 = matches.reduce((s, m) => s + (parseInt(m.units1150) || 0), 0);
            const u350 = matches.reduce((s, m) => s + (parseInt(m.units350) || 0), 0);
            return { '3400g': u3400, '1150g': u1150, '350g': u350, total: u3400 + u1150 + u350 };
        };
        const matchesByDirectPrefixMap = {};
        const matchesByDatePrefixMap = {};
        const directSelectedMap = {};
        const directFlavorScopedMap = {};
        lotCodes.forEach((pqrLot, idx) => {
            const prefix = lotPrefixes[idx];
            const lotRef = lotRefMap.get(pqrLot);
            const directMatches = prefix
                ? allProdLots.filter((pl) => String(pl.lotCode || '').startsWith(prefix))
                : [];
            const dateMatches = lotRef?.dateKey
                ? allProdLots.filter((pl) => String(pl.lotCode || '').startsWith(lotRef.dateKey))
                : [];
            matchesByDirectPrefixMap[pqrLot] = directMatches;
            matchesByDatePrefixMap[pqrLot] = dateMatches;
            const directFlavorSelection = filterMatchesByFlavor(directMatches, lotFlavorNormMap.get(pqrLot));
            directSelectedMap[pqrLot] = directFlavorSelection.selected || [];
            directFlavorScopedMap[pqrLot] = Boolean(directFlavorSelection.hasFlavorScoped);
        });

        const rawLotCodeSet = new Set(lotCodes);
        const matchModeRank = {
            none: 0,
            date: 1,
            'date+flavor': 2,
            lot: 3,
            'lot+flavor': 4
        };
        const lotCanonicalMap = {};
        lotCodes.forEach((pqrLot) => {
            const lotRef = lotRefMap.get(pqrLot);
            const directSelected = directSelectedMap[pqrLot] || [];
            const hasDirect = directSelected.length > 0;
            const directFlavorScoped = Boolean(directFlavorScopedMap[pqrLot]);
            let selectedMatches = directSelected;
            let matchMode = hasDirect
                ? (directFlavorScoped ? 'lot+flavor' : 'lot')
                : 'none';
            let canonicalLot = pqrLot;

            if (!hasDirect) {
                const dateCandidatesSelection = filterMatchesByFlavor(
                    matchesByDatePrefixMap[pqrLot] || [],
                    lotFlavorNormMap.get(pqrLot)
                );
                selectedMatches = dateCandidatesSelection.selected || [];
                if (selectedMatches.length > 0) {
                    matchMode = dateCandidatesSelection.hasFlavorScoped ? 'date+flavor' : 'date';
                }

                if (lotRef?.isShortAlias && lotRef.dateKey) {
                    const flavorNorms = lotFlavorNormMap.get(pqrLot) || new Set();
                    const siblingCandidates = lotCodes
                        .filter((otherLot) => otherLot !== pqrLot)
                        .map((otherLot) => ({
                            lot: otherLot,
                            ref: lotRefMap.get(otherLot),
                            matches: directSelectedMap[otherLot] || []
                        }))
                        .filter((row) => row.ref?.hasFullTime && row.ref.dateKey === lotRef.dateKey && row.matches.length > 0)
                        .map((row) => {
                            const otherFlavorNorms = lotFlavorNormMap.get(row.lot) || new Set();
                            let flavorOverlap = 0;
                            if (flavorNorms.size > 0 && otherFlavorNorms.size > 0) {
                                flavorNorms.forEach((value) => {
                                    if (otherFlavorNorms.has(value)) flavorOverlap += 1;
                                });
                            }
                            const units = unitsFromMatches(row.matches).total;
                            return {
                                ...row,
                                flavorOverlap,
                                units
                            };
                        })
                        .filter((row) => flavorNorms.size === 0 || row.flavorOverlap > 0)
                        .sort((a, b) => {
                            if (b.flavorOverlap !== a.flavorOverlap) return b.flavorOverlap - a.flavorOverlap;
                            if (b.units !== a.units) return b.units - a.units;
                            return String(a.lot).localeCompare(String(b.lot));
                        });

                    if (siblingCandidates.length > 0) {
                        const sibling = siblingCandidates[0];
                        const siblingPreferred = lotDigitsToDisplay(String(sibling.matches[0]?.lotCode || '').replace(/\D/g, ''));
                        const siblingCanonical = siblingPreferred || sibling.lot;
                        const siblingCanonicalDigits = parseLotReference(siblingCanonical).canonical10;
                        if (siblingCanonicalDigits && selectedMatches.length > 0) {
                            const anchored = selectedMatches.filter((m) => {
                                const digits = String(m.lotCode || '').replace(/\D/g, '');
                                return digits.startsWith(siblingCanonicalDigits);
                            });
                            if (anchored.length > 0) selectedMatches = anchored;
                        }
                        canonicalLot = siblingCanonical;
                    }
                }
            }

            if (selectedMatches.length > 0) {
                if (selectedMatches[0].productionDate) prodDateMap[pqrLot] = new Date(selectedMatches[0].productionDate);
                const units = unitsFromMatches(selectedMatches);
                if (units.total > 0) prodUnitsMap[pqrLot] = units;
                prodMatchModeMap[pqrLot] = matchMode;

                const preferredDisplay = lotDigitsToDisplay(String(selectedMatches[0].lotCode || '').replace(/\D/g, ''));
                if (lotRef?.isShortAlias && preferredDisplay) {
                    canonicalLot = preferredDisplay;
                } else if (preferredDisplay && rawLotCodeSet.has(preferredDisplay)) {
                    canonicalLot = preferredDisplay;
                }
            } else {
                prodMatchModeMap[pqrLot] = 'none';
            }

            lotCanonicalMap[pqrLot] = canonicalLot || pqrLot;
        });
        allSyrupLots.forEach(l => {
            if (l.productionDate && !prodDateMap[l.lotCode]) prodDateMap[l.lotCode] = new Date(l.productionDate);
        });

        const mergedByLotMap = new Map();
        byLotData.forEach((lot) => {
            const canonicalLot = lotCanonicalMap[lot.lot] || lot.lot;
            if (!mergedByLotMap.has(canonicalLot)) {
                mergedByLotMap.set(canonicalLot, {
                    lot: canonicalLot,
                    count: 0,
                    quantity: 0,
                    items: [],
                    lotAliases: new Set(),
                    flavorsSet: new Set(),
                    productsSet: new Set(),
                    distributorsSet: new Set(),
                    presentationMap: {}
                });
            }
            const target = mergedByLotMap.get(canonicalLot);
            target.lotAliases.add(lot.lot);
            (lot.lotAliases || []).forEach((alias) => target.lotAliases.add(alias));
            target.count += toQuantityNumber(lot.count);
            target.quantity += toQuantityNumber(lot.quantity);
            (lot.flavors || []).forEach((flavor) => target.flavorsSet.add(flavor));
            (lot.products || []).forEach((product) => target.productsSet.add(product));
            (lot.distributors || []).forEach((distributor) => target.distributorsSet.add(distributor));
            target.items = [...(target.items || []), ...(lot.items || [])];
            (lot.presentationCounts || []).forEach((presentation) => {
                const size = presentation.size || 'Sin tamaño';
                if (!target.presentationMap[size]) {
                    target.presentationMap[size] = {
                        size,
                        count: 0,
                        itemCount: 0,
                        quantity: 0,
                        reportedUnits: 0
                    };
                }
                target.presentationMap[size].count += toQuantityNumber(presentation.count);
                target.presentationMap[size].itemCount += toQuantityNumber(presentation.itemCount);
                target.presentationMap[size].quantity += toQuantityNumber(presentation.quantity);
                target.presentationMap[size].reportedUnits += toQuantityNumber(
                    presentation.reportedUnits ?? presentation.quantity
                );
            });
        });

        byLotData = Array.from(mergedByLotMap.values())
            .map((lot) => {
                const lotAliases = Array.from(lot.lotAliases || []).sort();
                const mergedFromLots = lotAliases.filter((alias) => alias !== lot.lot);
                const presentationCounts = Object.values(lot.presentationMap || {}).sort(sortPresentations);
                const defectSummary = buildDefectSummaryFromItems(lot.items || []);
                const severity = toQuantityNumber(lot.quantity) >= 10
                    ? 'recall'
                    : toQuantityNumber(lot.count) >= 3
                        ? 'critical'
                        : toQuantityNumber(lot.count) >= 2
                            ? 'warning'
                            : 'normal';
                return {
                    ...lot,
                    lotAliases,
                    mergedFromLots,
                    mergedAliasCount: mergedFromLots.length,
                    count: toQuantityNumber(lot.count),
                    quantity: roundNumber(toQuantityNumber(lot.quantity), 2),
                    flavors: Array.from(lot.flavorsSet || []).sort(),
                    products: Array.from(lot.productsSet || []).sort(),
                    distributors: Array.from(lot.distributorsSet || []).sort(),
                    presentationCounts,
                    defectSummary,
                    severity,
                    isAliasMerged: mergedFromLots.length > 0
                };
            })
            .sort((a, b) => b.count - a.count);

        byLotData.forEach((lot) => {
            const sourceLots = new Set([lot.lot, ...(lot.mergedFromLots || [])]);
            sourceLots.forEach((sourceLot) => {
                if (sourceLot === lot.lot) return;
                const sourceUnits = prodUnitsMap[sourceLot];
                const sourceDate = prodDateMap[sourceLot];
                const sourceMode = prodMatchModeMap[sourceLot] || 'none';
                const currentUnits = prodUnitsMap[lot.lot];
                const currentMode = prodMatchModeMap[lot.lot] || 'none';

                if (sourceUnits && (!currentUnits || toQuantityNumber(sourceUnits.total) > toQuantityNumber(currentUnits.total))) {
                    prodUnitsMap[lot.lot] = sourceUnits;
                }
                if (sourceDate && (!prodDateMap[lot.lot] || new Date(sourceDate) < new Date(prodDateMap[lot.lot]))) {
                    prodDateMap[lot.lot] = new Date(sourceDate);
                }
                if ((matchModeRank[sourceMode] || 0) > (matchModeRank[currentMode] || 0)) {
                    prodMatchModeMap[lot.lot] = sourceMode;
                }
            });
        });

        // Compute daysToReport for each lot
        byLotData.forEach(lot => {
            lot.producedUnits = prodUnitsMap[lot.lot] || null;
            lot.productionMatchMode = prodMatchModeMap[lot.lot] || 'none';

            const reportedByPresentation = { '3400g': 0, '1150g': 0, '350g': 0 };
            (lot.presentationCounts || []).forEach((p) => {
                const normalized = normalizePresentationSize(p.size);
                if (!Object.prototype.hasOwnProperty.call(reportedByPresentation, normalized)) return;
                reportedByPresentation[normalized] += toQuantityNumber(p.reportedUnits ?? p.quantity);
            });

            const produced = lot.producedUnits || { '3400g': 0, '1150g': 0, '350g': 0, total: 0 };
            const producedUnitsTotal = toQuantityNumber(produced.total);
            const reportedUnitsTotal = toQuantityNumber(lot.quantity);
            const missingUnitsTotal = producedUnitsTotal > 0
                ? Math.max(producedUnitsTotal - reportedUnitsTotal, 0)
                : null;

            const byPresentationCross = ['3400g', '1150g', '350g']
                .map((size) => {
                    const producedUnits = toQuantityNumber(produced[size]);
                    const reportedUnits = toQuantityNumber(reportedByPresentation[size]);
                    return {
                        size,
                        producedUnits,
                        reportedUnits,
                        missingUnits: producedUnits > 0 ? Math.max(producedUnits - reportedUnits, 0) : 0
                    };
                })
                .filter((entry) => entry.producedUnits > 0 || entry.reportedUnits > 0);

            lot.productionVsReported = {
                hasProductionData: producedUnitsTotal > 0,
                matchMode: lot.productionMatchMode,
                producedUnitsTotal,
                reportedUnitsTotal,
                missingUnitsTotal,
                coveragePct: producedUnitsTotal > 0 ? roundNumber((reportedUnitsTotal / producedUnitsTotal) * 100, 2) : null,
                byPresentation: byPresentationCross
            };
            const primaryDefect = lot.defectSummary?.primaryDefect || 'OTRO';
            const primaryDefectUnits = toQuantityNumber(
                lot.defectSummary?.primaryDefectUnits ?? lot.quantity
            );
            const severityByEnvases = classifySeverityByEnvases({
                defectType: primaryDefect,
                defectUnits: primaryDefectUnits,
                producedUnitsTotal,
                reportCount: lot.count
            });
            lot.severity = severityByEnvases.severity;
            lot.defectSummary = {
                ...(lot.defectSummary || {}),
                policyMode: severityByEnvases.policyMode,
                pressureAgainstGood: severityByEnvases.pressure
            };

            // Get the earliest PQR date for this lot
            const pqrDates = lot.items.map(i => new Date(i.date)).filter(d => !isNaN(d));
            if (pqrDates.length === 0) {
                lot.daysToReport = null;
                lot.followUp = {
                    status: 'sin_datos',
                    statusLabel: 'Sin datos de reporte',
                    hasContinuedReporting: false,
                    timeline: {
                        uniqueReportDays: 0,
                        reportsLast7d: 0,
                        reportsLast14d: 0,
                        unitsLast7d: 0,
                        unitsLast14d: 0,
                        daysSinceFirstReport: null,
                        daysSinceLastReport: null,
                        cadenceAvgDays: null,
                        isNewLot: false
                    },
                    prediction: {
                        continueReportingProbabilityPct: null,
                        confidenceScore: null,
                        expectedFinalCoveragePct: null,
                        expectedFinalReportedUnits: null,
                        expectedAdditionalUnitsToReport: null,
                        predictedOutcome: 'indeterminado',
                        predictedOutcomeLabel: 'Sin datos'
                    }
                };
                return;
            }
            const firstPqrDate = new Date(Math.min(...pqrDates));
            const lastPqrDate = new Date(Math.max(...pqrDates));
            lot.firstReportDate = firstPqrDate.toISOString();
            lot.lastReportDate = lastPqrDate.toISOString();

            const reportsByDay = {};
            (lot.items || []).forEach((item) => {
                const reportDate = new Date(item.date);
                if (isNaN(reportDate.getTime())) return;
                const key = reportDate.toISOString().slice(0, 10);
                if (!reportsByDay[key]) reportsByDay[key] = { date: key, reports: 0, units: 0 };
                reportsByDay[key].reports += 1;
                reportsByDay[key].units += toQuantityNumber(item.quantity);
            });
            const reportEvents = Object.values(reportsByDay).sort((a, b) => a.date.localeCompare(b.date));

            const daysSinceFirstReport = Math.max(0, Math.floor((now - firstPqrDate) / DAY_MS));
            const daysSinceLastReport = Math.max(0, Math.floor((now - lastPqrDate) / DAY_MS));

            let reportsLast7d = 0;
            let reportsLast14d = 0;
            let unitsLast7d = 0;
            let unitsLast14d = 0;
            reportEvents.forEach((event) => {
                const eventDate = new Date(event.date);
                if (isNaN(eventDate.getTime())) return;
                const ageDays = Math.floor((now - eventDate) / DAY_MS);
                if (ageDays < 0) return;
                if (ageDays <= 14) {
                    reportsLast14d += event.reports;
                    unitsLast14d += event.units;
                }
                if (ageDays <= 7) {
                    reportsLast7d += event.reports;
                    unitsLast7d += event.units;
                }
            });

            const cadenceGaps = [];
            for (let idx = 1; idx < reportEvents.length; idx += 1) {
                const prevDate = new Date(reportEvents[idx - 1].date);
                const currDate = new Date(reportEvents[idx].date);
                if (isNaN(prevDate.getTime()) || isNaN(currDate.getTime())) continue;
                const gap = Math.max(0, Math.round((currDate - prevDate) / DAY_MS));
                cadenceGaps.push(gap);
            }
            const cadenceAvgDays = cadenceGaps.length > 0
                ? roundNumber(cadenceGaps.reduce((sum, n) => sum + n, 0) / cadenceGaps.length, 1)
                : null;

            const isNewLot = daysSinceFirstReport <= 10;
            let followUpStatus = 'detenida';
            let followUpStatusLabel = 'No se volvió a reportar';
            if (isNewLot && daysSinceLastReport <= 7) {
                followUpStatus = 'nuevo';
                followUpStatusLabel = 'Lote nuevo en observación';
            } else if (daysSinceLastReport <= 7) {
                followUpStatus = 'continua';
                followUpStatusLabel = 'Sigue reportándose';
            } else if (daysSinceLastReport <= 14) {
                followUpStatus = 'observacion';
                followUpStatusLabel = 'Aún en ventana de seguimiento';
            } else if (daysSinceLastReport <= 30) {
                followUpStatus = 'enfriando';
                followUpStatusLabel = 'Reportes en descenso';
            }

            let continuationScore = 0;
            if (daysSinceLastReport <= 3) continuationScore += 30;
            else if (daysSinceLastReport <= 7) continuationScore += 22;
            else if (daysSinceLastReport <= 14) continuationScore += 10;
            else if (daysSinceLastReport <= 30) continuationScore -= 8;
            else continuationScore -= 20;

            continuationScore += Math.min(24, reportEvents.length * 4);
            if (reportsLast7d > 0) continuationScore += 12;
            if (reportsLast14d >= 3) continuationScore += 8;
            if (isNewLot) continuationScore += 8;
            if (cadenceAvgDays !== null && cadenceAvgDays <= 5) continuationScore += 6;

            const coveragePct = toFiniteNumber(lot.productionVsReported?.coveragePct);
            if (coveragePct !== null) {
                if (coveragePct < 30) continuationScore += 10;
                else if (coveragePct < 60) continuationScore += 4;
                else if (coveragePct >= 85) continuationScore -= 12;
            }
            if (missingUnitsTotal !== null && missingUnitsTotal <= 0) continuationScore -= 30;
            if (daysSinceFirstReport > 45 && reportsLast14d === 0) continuationScore -= 12;

            const continueReportingProbabilityPct = Math.round(
                clampValue(50 + continuationScore, 1, 99)
            );

            let expectedFinalCoveragePct = null;
            let expectedFinalReportedUnits = null;
            let expectedAdditionalUnitsToReport = null;
            let predictedOutcome = 'indeterminado';
            let predictedOutcomeLabel = 'Sin suficiente producción para proyectar';

            if (producedUnitsTotal > 0) {
                const currentCoverage = clampValue(toQuantityNumber(coveragePct), 0, 100);
                const remainingCoverage = Math.max(100 - currentCoverage, 0);
                const growthWeight = continueReportingProbabilityPct >= 80
                    ? 0.9
                    : continueReportingProbabilityPct >= 65
                        ? 0.65
                        : continueReportingProbabilityPct >= 50
                            ? 0.42
                            : continueReportingProbabilityPct >= 35
                                ? 0.22
                                : 0.08;
                expectedFinalCoveragePct = roundNumber(
                    clampValue(currentCoverage + (remainingCoverage * growthWeight), currentCoverage, 100),
                    2
                );
                expectedFinalReportedUnits = Math.round((producedUnitsTotal * expectedFinalCoveragePct) / 100);
                expectedAdditionalUnitsToReport = Math.max(
                    expectedFinalReportedUnits - reportedUnitsTotal,
                    0
                );

                if (expectedFinalCoveragePct >= 85) {
                    predictedOutcome = 'todo_lote';
                    predictedOutcomeLabel = 'Probable reporte de casi todo el lote';
                } else if (expectedFinalCoveragePct >= 45) {
                    predictedOutcome = 'parcial_alta';
                    predictedOutcomeLabel = 'Probable reporte parcial alto';
                } else {
                    predictedOutcome = 'parcial_baja';
                    predictedOutcomeLabel = 'Probable reporte parcial bajo';
                }
            }

            const confidenceScore = Math.round(
                clampValue(
                    (producedUnitsTotal > 0 ? 35 : 20) +
                    Math.min(35, reportEvents.length * 6) +
                    (daysSinceFirstReport > 21 ? 10 : 0),
                    20,
                    producedUnitsTotal > 0 ? 92 : 78
                )
            );

            lot.followUp = {
                status: followUpStatus,
                statusLabel: followUpStatusLabel,
                hasContinuedReporting: reportsLast14d > 0 && reportEvents.length > 1,
                timeline: {
                    uniqueReportDays: reportEvents.length,
                    reportsLast7d,
                    reportsLast14d,
                    unitsLast7d: roundNumber(unitsLast7d, 2),
                    unitsLast14d: roundNumber(unitsLast14d, 2),
                    daysSinceFirstReport,
                    daysSinceLastReport,
                    cadenceAvgDays,
                    isNewLot
                },
                prediction: {
                    continueReportingProbabilityPct,
                    confidenceScore,
                    expectedFinalCoveragePct,
                    expectedFinalReportedUnits,
                    expectedAdditionalUnitsToReport,
                    predictedOutcome,
                    predictedOutcomeLabel
                }
            };

            // Get production date: prefer DB lookup, fallback to parsing lot code
            const prodDate = prodDateMap[lot.lot] || parseLotDate(lot.lot);
            if (!prodDate) { lot.daysToReport = null; return; }

            const days = Math.round((firstPqrDate - prodDate) / (1000 * 60 * 60 * 24));
            lot.daysToReport = days >= 0 ? days : null;
            lot.productionDate = prodDate.toISOString();
        });

        const lotPredictionContexts = byLotData
            .map((lot) => {
                if (!lot.firstReportDate) return null;
                const firstReportDate = new Date(lot.firstReportDate);
                const lastReportDate = lot.lastReportDate ? new Date(lot.lastReportDate) : null;
                if (isNaN(firstReportDate.getTime())) return null;

                const reportsByDay = {};
                (lot.items || []).forEach((item) => {
                    const reportDate = new Date(item.date);
                    if (isNaN(reportDate.getTime())) return;
                    const key = reportDate.toISOString().slice(0, 10);
                    if (!reportsByDay[key]) reportsByDay[key] = { date: key, reports: 0, units: 0 };
                    reportsByDay[key].reports += 1;
                    reportsByDay[key].units += toQuantityNumber(item.quantity);
                });

                const reportEvents = Object.values(reportsByDay).sort((a, b) => a.date.localeCompare(b.date));
                if (!reportEvents.length) return null;

                const producedUnitsTotal = toQuantityNumber(
                    lot.productionVsReported?.producedUnitsTotal ?? lot.producedUnits?.total
                );
                const reportedUnitsTotal = toQuantityNumber(
                    lot.productionVsReported?.reportedUnitsTotal ?? lot.quantity
                );
                const missingUnitsTotal = producedUnitsTotal > 0
                    ? Math.max(producedUnitsTotal - reportedUnitsTotal, 0)
                    : null;
                const primaryDefect = lot.defectSummary?.primaryDefect || 'OTRO';
                const primaryDefectUnits = toQuantityNumber(
                    lot.defectSummary?.primaryDefectUnits ?? reportedUnitsTotal
                );

                return {
                    lot,
                    reportEvents,
                    firstReportDate,
                    lastReportDate: lastReportDate && !isNaN(lastReportDate.getTime()) ? lastReportDate : firstReportDate,
                    producedUnitsTotal,
                    reportedUnitsTotal,
                    missingUnitsTotal,
                    primaryDefect,
                    primaryDefectUnits
                };
            })
            .filter(Boolean);

        const continuationTrainingSamples = [];
        const coverageCalibrationSamples = [];
        const trainingDiagnostics = {
            candidateLots: lotPredictionContexts.length,
            lookbackEligibleLots: 0,
            horizonEligibleLots: 0,
            usableSnapshotLots: 0,
            labeledSamples: 0,
            coverageCalibrationEligibleLots: 0
        };

        lotPredictionContexts.forEach((ctx) => {
            const snapshotDate = new Date(ctx.firstReportDate.getTime() + (CONTINUATION_LOOKBACK_DAYS * DAY_MS));
            if (snapshotDate > now) return;
            trainingDiagnostics.lookbackEligibleLots += 1;

            const horizonEndDate = new Date(snapshotDate.getTime() + (CONTINUATION_HORIZON_DAYS * DAY_MS));
            if (horizonEndDate > now) return;
            trainingDiagnostics.horizonEligibleLots += 1;

            const snapshot = buildLotSnapshotAtDate({
                reportEvents: ctx.reportEvents,
                firstReportDate: ctx.firstReportDate,
                asOfDate: snapshotDate,
                producedUnitsTotal: ctx.producedUnitsTotal
            });
            if (!snapshot || toQuantityNumber(snapshot.reports14d) <= 0) return;
            trainingDiagnostics.usableSnapshotLots += 1;

            const continuedInHorizon = ctx.reportEvents.some((event) => {
                const d = new Date(event.date);
                return !isNaN(d.getTime()) && d > snapshotDate && d <= horizonEndDate;
            });
            continuationTrainingSamples.push({
                lot: ctx.lot.lot,
                snapshotDate: snapshotDate.toISOString(),
                snapshot,
                defectType: ctx.primaryDefect,
                defectUnits: ctx.primaryDefectUnits,
                defectRatePct: ctx.producedUnitsTotal > 0
                    ? roundNumber((ctx.primaryDefectUnits / ctx.producedUnitsTotal) * 100, 4)
                    : null,
                label: continuedInHorizon ? 1 : 0
            });
            trainingDiagnostics.labeledSamples += 1;

            const matureDate = new Date(ctx.firstReportDate.getTime() + (FINAL_COVERAGE_WINDOW_DAYS * DAY_MS));
            if (matureDate > now || ctx.producedUnitsTotal <= 0) return;
            const finalSnapshot = buildLotSnapshotAtDate({
                reportEvents: ctx.reportEvents,
                firstReportDate: ctx.firstReportDate,
                asOfDate: matureDate,
                producedUnitsTotal: ctx.producedUnitsTotal
            });
            if (!finalSnapshot || snapshot.coveragePct === null || finalSnapshot.coveragePct === null) return;

            const currentCoverage = toQuantityNumber(snapshot.coveragePct);
            const finalCoverage = clampValue(toQuantityNumber(finalSnapshot.coveragePct), currentCoverage, 100);
            const remaining = Math.max(100 - currentCoverage, 0);
            const additionalShare = remaining > 0
                ? clampValue((finalCoverage - currentCoverage) / remaining, 0, 1)
                : 0;

            coverageCalibrationSamples.push({
                snapshot,
                additionalShare
            });
            trainingDiagnostics.coverageCalibrationEligibleLots += 1;
        });

        const trainedContinuationModel = trainContinuationProbabilityModel(continuationTrainingSamples);
        const defectContinuationModel = buildDefectContinuationModel(continuationTrainingSamples);
        const coverageGrowthCalibration = calibrateCoverageGrowthExponent({
            samples: coverageCalibrationSamples,
            model: trainedContinuationModel
        });
        const predictionModelReliabilityPct = roundNumber(
            computePredictionModelReliabilityScore(trainedContinuationModel) * 100,
            1
        );
        const resolvedFallbackReason = !trainedContinuationModel.isTrained
            ? (
                continuationTrainingSamples.length === 0
                    ? (
                        trainingDiagnostics.horizonEligibleLots === 0
                            ? 'insufficient_mature_history'
                            : (trainingDiagnostics.usableSnapshotLots === 0
                                ? 'insufficient_snapshot_activity'
                                : trainedContinuationModel.reason || 'insufficient_samples')
                    )
                    : trainedContinuationModel.reason
            )
            : null;
        const predictionMethodology = buildPredictionModelNarrative({
            trained: Boolean(trainedContinuationModel.isTrained),
            fallbackReason: resolvedFallbackReason,
            trainingSamples: trainedContinuationModel.sampleSize,
            trainingDiagnostics,
            reliabilityScorePct: predictionModelReliabilityPct,
            calibration: coverageGrowthCalibration
        });

        lotPredictionContexts.forEach((ctx) => {
            const snapshotNow = buildLotSnapshotAtDate({
                reportEvents: ctx.reportEvents,
                firstReportDate: ctx.firstReportDate,
                asOfDate: now,
                producedUnitsTotal: ctx.producedUnitsTotal
            });
            if (!snapshotNow) return;

            const modelProbability = predictContinuationProbability(trainedContinuationModel, snapshotNow);
            const defectProfile = resolveDefectContinuationProfile(defectContinuationModel, ctx.primaryDefect);
            const defectAdjustmentPct = toQuantityNumber(defectProfile.adjustmentPct);
            const evidenceProbability = computeEvidenceBasedContinuationProbability({
                snapshot: snapshotNow,
                missingUnitsTotal: ctx.missingUnitsTotal,
                producedUnitsTotal: ctx.producedUnitsTotal,
                defectProfile,
                defectUnits: ctx.primaryDefectUnits,
                defectPressure: computeDefectPressureAgainstGood({
                    defectUnits: ctx.primaryDefectUnits,
                    producedUnitsTotal: ctx.producedUnitsTotal
                })
            });
            const confidenceProfile = computePredictionConfidenceScore({
                snapshot: snapshotNow,
                producedUnitsTotal: ctx.producedUnitsTotal,
                defectProfile,
                defectPressure: computeDefectPressureAgainstGood({
                    defectUnits: ctx.primaryDefectUnits,
                    producedUnitsTotal: ctx.producedUnitsTotal
                }),
                predictionModel: trainedContinuationModel
            });
            const blendedBaseProbabilityPct = blendContinuationProbabilityPct({
                modelProbability,
                evidenceProbabilityPct: evidenceProbability.probabilityPct,
                confidenceScore: confidenceProfile.confidenceScore,
                predictionModel: trainedContinuationModel
            });
            const defectReviewGuard = applyDefectReviewGuard({
                defectType: ctx.primaryDefect,
                baseProbabilityPct: blendedBaseProbabilityPct + defectAdjustmentPct,
                defectUnits: ctx.primaryDefectUnits,
                producedUnitsTotal: ctx.producedUnitsTotal
            });
            const blendedProbabilityPct = defectReviewGuard.adjustedProbabilityPct;
            const defectPressure = defectReviewGuard.pressure;
            const hasGoodReference = Boolean(defectPressure?.hasGoodReference);
            const defectVsGoodPct = hasGoodReference
                ? toQuantityNumber(defectPressure.defectVsGoodPct)
                : null;

            const daysSinceFirst = toQuantityNumber(snapshotNow.daysSinceFirstReportAtAsOf);
            const daysSinceLast = toQuantityNumber(snapshotNow.daysSinceLastReport);
            const isNewLot = daysSinceFirst <= 10;
            const continueThreshold = defectProfile.riskBand === 'alto_arrastre'
                ? 52
                : (defectProfile.riskBand === 'autolimitado' ? 58 : 55);
            const observationThreshold = defectProfile.riskBand === 'alto_arrastre'
                ? 34
                : (defectProfile.riskBand === 'autolimitado' ? 42 : 38);

            let followUpStatus = 'detenida';
            let followUpStatusLabel = 'No se volvió a reportar';
            if (isNewLot && daysSinceLast <= FOLLOW_UP_RECENT_DAYS && blendedProbabilityPct >= continueThreshold) {
                followUpStatus = 'nuevo';
                followUpStatusLabel = 'Lote nuevo en observación';
            } else if (daysSinceLast <= FOLLOW_UP_RECENT_DAYS && blendedProbabilityPct >= continueThreshold) {
                followUpStatus = 'continua';
                followUpStatusLabel = 'Sigue reportándose';
            } else if (daysSinceLast <= FOLLOW_UP_MONITOR_DAYS && blendedProbabilityPct >= observationThreshold) {
                followUpStatus = 'observacion';
                followUpStatusLabel = 'Aún en ventana de seguimiento';
            } else if (daysSinceLast <= 30) {
                followUpStatus = 'enfriando';
                followUpStatusLabel = 'Reportes en descenso';
            }
            if (defectReviewGuard.guardLevel === 'strong' && (followUpStatus === 'continua' || followUpStatus === 'nuevo')) {
                followUpStatus = 'observacion';
                followUpStatusLabel = 'Defecto en revisión; continuidad moderada';
            }

            let expectedFinalCoveragePct = null;
            let expectedFinalReportedUnits = null;
            let expectedAdditionalUnitsToReport = null;
            let expectedFinalCoverageRangePct = null;
            let predictedOutcome = 'indeterminado';
            let predictedOutcomeLabel = 'Sin suficiente producción para proyectar';

            if (ctx.producedUnitsTotal > 0) {
                const projection = estimateCoverageProjection({
                    snapshot: snapshotNow,
                    probabilityPct: blendedProbabilityPct,
                    confidenceScore: confidenceProfile.confidenceScore,
                    defectProfile: {
                        ...defectProfile,
                        growthFactor: coverageGrowthCalibration.isCalibrated
                            ? roundNumber(
                                clampValue(
                                    toQuantityNumber(defectProfile.growthFactor || 1) * toQuantityNumber(coverageGrowthCalibration.gamma || 1),
                                    0.78,
                                    1.22
                                ),
                                3
                            )
                            : defectProfile.growthFactor
                    },
                    producedUnitsTotal: ctx.producedUnitsTotal,
                    reportedUnitsTotal: ctx.reportedUnitsTotal
                });
                expectedFinalCoveragePct = projection.expectedFinalCoveragePct;
                expectedFinalReportedUnits = projection.expectedFinalReportedUnits;
                expectedAdditionalUnitsToReport = projection.expectedAdditionalUnitsToReport;
                expectedFinalCoverageRangePct = projection.expectedFinalCoverageRangePct;

                if (expectedFinalCoveragePct >= 86) {
                    predictedOutcome = 'todo_lote';
                    predictedOutcomeLabel = 'Probable reporte de casi todo el lote';
                } else if (expectedFinalCoveragePct >= 52) {
                    predictedOutcome = 'parcial_alta';
                    predictedOutcomeLabel = 'Probable reporte parcial alto';
                } else {
                    predictedOutcome = 'parcial_baja';
                    predictedOutcomeLabel = 'Probable reporte parcial bajo';
                }
            }

            const confidenceScore = confidenceProfile.confidenceScore;

            const operationalBucket = resolveOperationalContinuityBucket({
                status: followUpStatus,
                daysSinceLastReport: daysSinceLast,
                isNewLot
            });

            ctx.lot.followUp = {
                status: followUpStatus,
                statusLabel: followUpStatusLabel,
                operationalBucket: operationalBucket.key,
                operationalBucketLabel: operationalBucket.label,
                operationalBucketDescription: operationalBucket.description,
                hasContinuedReporting: toQuantityNumber(snapshotNow.reports14d) > 0 && toQuantityNumber(snapshotNow.uniqueReportDays14d) > 1,
                timeline: {
                    uniqueReportDays: toQuantityNumber(snapshotNow.uniqueReportDays14d),
                    reportsLast7d: toQuantityNumber(snapshotNow.reports7d),
                    reportsLast14d: toQuantityNumber(snapshotNow.reports14d),
                    unitsLast7d: roundNumber(toQuantityNumber(snapshotNow.units7d), 2),
                    unitsLast14d: roundNumber(toQuantityNumber(snapshotNow.units14d), 2),
                    daysSinceFirstReport: daysSinceFirst,
                    daysSinceLastReport: daysSinceLast,
                    cadenceAvgDays: snapshotNow.cadenceAvgDays14d !== null ? roundNumber(snapshotNow.cadenceAvgDays14d, 2) : null,
                    isNewLot
                },
                prediction: {
                    continueReportingProbabilityPct: blendedProbabilityPct,
                    confidenceScore: Math.round(confidenceScore),
                    expectedFinalCoveragePct,
                    expectedFinalReportedUnits,
                    expectedAdditionalUnitsToReport,
                    expectedFinalCoverageRangePct,
                    predictedOutcome,
                    predictedOutcomeLabel,
                    defectType: defectProfile.defectType,
                    defectLabel: defectProfile.label,
                    defectRiskBand: defectProfile.riskBand,
                    defectAdjustmentPct: roundNumber(defectAdjustmentPct, 2),
                    defectContinueRatePct: defectProfile.smoothedContinueRatePct,
                    defectPolicyMode: defectReviewGuard.policyMode,
                    reviewGuardLevel: defectReviewGuard.guardLevel,
                    primaryDefectUnits: roundNumber(ctx.primaryDefectUnits, 2),
                    goodUnitsReference: hasGoodReference ? roundNumber(defectPressure.goodUnits, 2) : null,
                    defectVsGoodPct: hasGoodReference ? roundNumber(defectVsGoodPct, 4) : null,
                    modelProbabilityPct: modelProbability !== null ? roundNumber(modelProbability * 100, 2) : null,
                    evidenceProbabilityPct: evidenceProbability.probabilityPct,
                    evidenceSignalScore: evidenceProbability.weightedSignal,
                    evidenceComponents: evidenceProbability.components,
                    confidenceComponents: confidenceProfile.components,
                    methodology: trainedContinuationModel.isTrained ? 'supervised_blended' : 'evidence_engine_cold_start',
                    modelReliabilityScorePct: confidenceProfile.modelReliabilityScorePct,
                    source: trainedContinuationModel.isTrained ? 'trained_model_blended' : 'evidence_engine_cold_start'
                }
            };
        });

        const predictionModel = {
            strategy: 'hybrid_continuity_engine',
            supervisedStrategy: 'temporal_logistic_regression',
            evidenceStrategy: 'temporal_evidence_engine',
            executionMode: predictionMethodology.executionMode,
            methodologyLabel: predictionMethodology.methodologyLabel,
            lookbackDays: CONTINUATION_LOOKBACK_DAYS,
            horizonDays: CONTINUATION_HORIZON_DAYS,
            coverageWindowDays: FINAL_COVERAGE_WINDOW_DAYS,
            minimumMatureHistoryDays: predictionMethodology.minimumMatureHistoryDays,
            trained: Boolean(trainedContinuationModel.isTrained),
            fallbackReason: trainedContinuationModel.isTrained ? null : resolvedFallbackReason,
            trainingSamples: toQuantityNumber(trainedContinuationModel.sampleSize),
            positives: toQuantityNumber(trainedContinuationModel.positives),
            negatives: toQuantityNumber(trainedContinuationModel.negatives),
            decisionThreshold: trainedContinuationModel.decisionThreshold ?? null,
            validation: trainedContinuationModel.validation || null,
            validationFolds: Array.isArray(trainedContinuationModel.validationFolds)
                ? trainedContinuationModel.validationFolds
                : [],
            qualityGate: trainedContinuationModel.qualityGate || null,
            defectModel: {
                globalContinueRatePct: defectContinuationModel.globalContinueRatePct,
                sampleSize: defectContinuationModel.sampleSize,
                topDefects: defectContinuationModel.topDefects
            },
            calibration: coverageGrowthCalibration,
            reliabilityScorePct: predictionModelReliabilityPct,
            trainingDiagnostics,
            readiness: predictionMethodology.readiness,
            summary: predictionMethodology.summary,
            limitation: predictionMethodology.limitation,
            nextMilestone: predictionMethodology.nextMilestone,
            recommendedUse: predictionMethodology.recommendedUse,
            fallbackLabel: predictionMethodology.fallbackLabel,
            coverageStatus: predictionMethodology.coverageStatus
        };

        const windowSummary = {
            recent14d: { reports: 0, units: 0 },
            previous14d: { reports: 0, units: 0 }
        };
        allItems.forEach((item) => {
            const reportDate = new Date(item.pqrCreatedAt);
            if (isNaN(reportDate.getTime())) return;
            const ageDays = Math.floor((now - reportDate) / DAY_MS);
            if (ageDays < 0) return;
            const qty = toQuantityNumber(item.quantity);
            if (ageDays <= 14) {
                windowSummary.recent14d.reports += 1;
                windowSummary.recent14d.units += qty;
            } else if (ageDays <= 28) {
                windowSummary.previous14d.reports += 1;
                windowSummary.previous14d.units += qty;
            }
        });

        const followUpLots = byLotData.filter((lot) => lot.followUp);
        const activeLots = followUpLots.filter((lot) => ['nuevo', 'continua', 'observacion'].includes(lot.followUp.status)).length;
        const coolingLots = followUpLots.filter((lot) => lot.followUp.status === 'enfriando').length;
        const stoppedLots = followUpLots.filter((lot) => lot.followUp.status === 'detenida').length;

        const newLotsActive = followUpLots.filter((lot) => lot.followUp.timeline.isNewLot && lot.followUp.timeline.reportsLast14d > 0).length;
        const residualLotsActive = followUpLots.filter((lot) => !lot.followUp.timeline.isNewLot && lot.followUp.timeline.reportsLast14d > 0).length;
        const lotsStillReporting = followUpLots.filter((lot) => (lot.followUp.prediction.continueReportingProbabilityPct || 0) >= 60).length;
        const lotsStoppedReporting = followUpLots.filter((lot) => (lot.followUp.timeline.daysSinceLastReport || 0) > 21).length;
        const newLotsLikelyContinue = followUpLots.filter((lot) => (
            lot.followUp.timeline.isNewLot &&
            (lot.followUp.prediction.continueReportingProbabilityPct || 0) >= 60
        )).length;
        const residualBacklogLots = followUpLots.filter((lot) => {
            if (lot.followUp.timeline.isNewLot) return false;
            const expectedAdditional = lot.followUp.prediction.expectedAdditionalUnitsToReport;
            const missingUnits = expectedAdditional !== null && expectedAdditional !== undefined
                ? expectedAdditional
                : toQuantityNumber(lot.productionVsReported?.missingUnitsTotal);
            return missingUnits > 0 && (lot.followUp.timeline.daysSinceLastReport || 0) > 14;
        }).length;
        const defectProjectionMap = {};
        followUpLots.forEach((lot) => {
            const prediction = lot.followUp?.prediction || {};
            const defectType = resolveDefectAlias(prediction.defectType || lot.defectSummary?.primaryDefect) || 'OTRO';
            const defectLabel = prediction.defectLabel || formatDefectLabel(defectType);
            const probability = clampValue(toQuantityNumber(prediction.continueReportingProbabilityPct), 0, 100);
            const confidence = clampValue(toQuantityNumber(prediction.confidenceScore), 0, 100);
            const defectUnits = Math.max(
                0,
                toQuantityNumber(
                    prediction.primaryDefectUnits
                    ?? lot.defectSummary?.primaryDefectUnits
                    ?? lot.quantity
                )
            );
            const producedUnitsTotal = toQuantityNumber(
                lot.productionVsReported?.producedUnitsTotal
            );
            const goodUnitsReference = prediction.goodUnitsReference !== null && prediction.goodUnitsReference !== undefined
                ? Math.max(0, toQuantityNumber(prediction.goodUnitsReference))
                : (producedUnitsTotal > 0 ? Math.max(producedUnitsTotal - defectUnits, 0) : 0);
            const unitWeight = Math.max(1, defectUnits);
            if (!defectProjectionMap[defectType]) {
                defectProjectionMap[defectType] = {
                    defectType,
                    defectLabel,
                    policyMode: getDefectAlertPolicy(defectType).mode,
                    lots: 0,
                    continueLikelyLots: 0,
                    uncertainLots: 0,
                    stopLikelyLots: 0,
                    defectiveUnits: 0,
                    goodUnitsReference: 0,
                    continueLikelyUnits: 0,
                    uncertainUnits: 0,
                    stopLikelyUnits: 0,
                    probabilitySum: 0,
                    confidenceSum: 0,
                    weightedProbabilitySum: 0,
                    weightedConfidenceSum: 0
                };
            }
            defectProjectionMap[defectType].lots += 1;
            defectProjectionMap[defectType].defectiveUnits += defectUnits;
            defectProjectionMap[defectType].goodUnitsReference += goodUnitsReference;
            defectProjectionMap[defectType].probabilitySum += probability;
            defectProjectionMap[defectType].confidenceSum += confidence;
            defectProjectionMap[defectType].weightedProbabilitySum += (probability * unitWeight);
            defectProjectionMap[defectType].weightedConfidenceSum += (confidence * unitWeight);
            if (probability >= 62 && confidence >= 45) {
                defectProjectionMap[defectType].continueLikelyLots += 1;
                defectProjectionMap[defectType].continueLikelyUnits += defectUnits;
            } else if (probability <= 40 || (confidence < 32 && probability < 52)) {
                defectProjectionMap[defectType].stopLikelyLots += 1;
                defectProjectionMap[defectType].stopLikelyUnits += defectUnits;
            } else {
                defectProjectionMap[defectType].uncertainLots += 1;
                defectProjectionMap[defectType].uncertainUnits += defectUnits;
            }
        });
        const defectFollowUpProjection = Object.values(defectProjectionMap)
            .map((entry) => {
                const lots = Math.max(1, entry.lots);
                const units = Math.max(1, toQuantityNumber(entry.defectiveUnits));
                const producedReferenceUnits = entry.defectiveUnits + entry.goodUnitsReference;
                const defectRateVsGoodPct = producedReferenceUnits > 0
                    ? roundNumber((entry.defectiveUnits / producedReferenceUnits) * 100, 4)
                    : null;
                const severityAssessment = classifySeverityByEnvases({
                    defectType: entry.defectType,
                    defectUnits: entry.defectiveUnits,
                    producedUnitsTotal: producedReferenceUnits,
                    reportCount: entry.lots
                });
                return {
                    defectType: entry.defectType,
                    defectLabel: entry.defectLabel,
                    policyMode: entry.policyMode,
                    lots: entry.lots,
                    continueLikelyLots: entry.continueLikelyLots,
                    uncertainLots: entry.uncertainLots,
                    stopLikelyLots: entry.stopLikelyLots,
                    defectiveUnits: roundNumber(entry.defectiveUnits, 2),
                    goodUnitsReference: roundNumber(entry.goodUnitsReference, 2),
                    producedReferenceUnits: roundNumber(producedReferenceUnits, 2),
                    defectRateVsGoodPct,
                    continueLikelyUnits: roundNumber(entry.continueLikelyUnits, 2),
                    uncertainUnits: roundNumber(entry.uncertainUnits, 2),
                    stopLikelyUnits: roundNumber(entry.stopLikelyUnits, 2),
                    continueLikelyPct: roundNumber((entry.continueLikelyUnits / units) * 100, 1),
                    uncertainPct: roundNumber((entry.uncertainUnits / units) * 100, 1),
                    stopLikelyPct: roundNumber((entry.stopLikelyUnits / units) * 100, 1),
                    avgProbabilityPct: roundNumber(entry.probabilitySum / lots, 1),
                    avgConfidencePct: roundNumber(entry.confidenceSum / lots, 1),
                    weightedAvgProbabilityPct: roundNumber(entry.weightedProbabilitySum / units, 1),
                    weightedAvgConfidencePct: roundNumber(entry.weightedConfidenceSum / units, 1),
                    alertLevel: severityAssessment.severity
                };
            })
            .sort((a, b) => b.defectiveUnits - a.defectiveUnits)
            .slice(0, 10);

        const lotContinuityOverviewAcc = LOT_CONTINUITY_BUCKETS.reduce((acc, bucket) => {
            acc[bucket.key] = {
                ...bucket,
                lots: 0,
                reportedUnits: 0,
                projectedAdditionalUnits: 0,
                weightedProjectedAdditionalUnits: 0,
                rawImpactUnits: 0,
                impactUnits: 0,
                avgProbabilitySum: 0,
                avgConfidenceSum: 0,
                avgDaysSinceLastReportSum: 0,
                avgDaysSinceFirstReportSum: 0,
                highSeverityLots: 0
            };
            return acc;
        }, {});
        const defectContinuityBreakdownMap = {};
        const lotContinuityMap = [];

        followUpLots.forEach((lot) => {
            const followUp = lot.followUp || {};
            const prediction = followUp.prediction || {};
            const timeline = followUp.timeline || {};
            const bucketKey = followUp.operationalBucket || 'sin_datos';
            const bucketMeta = LOT_CONTINUITY_BUCKET_META[bucketKey] || LOT_CONTINUITY_BUCKET_META.sin_datos;
            const reportedUnits = roundNumber(toQuantityNumber(lot.quantity), 2) || 0;
            const projectedAdditionalUnits = roundNumber(
                Math.max(0, toQuantityNumber(prediction.expectedAdditionalUnitsToReport)),
                2
            ) || 0;
            const probability = clampValue(toQuantityNumber(prediction.continueReportingProbabilityPct), 0, 100);
            const confidenceScore = clampValue(toQuantityNumber(prediction.confidenceScore), 0, 100);
            const confidenceFactor = clampValue(confidenceScore / 100, 0, 1);
            const weightedProjectedAdditionalUnits = roundNumber(projectedAdditionalUnits * confidenceFactor, 2) || 0;
            const rawImpactUnits = roundNumber(Math.max(reportedUnits + projectedAdditionalUnits, 0), 2) || 0;
            const impactUnits = roundNumber(Math.max(reportedUnits + weightedProjectedAdditionalUnits, 0), 2) || 0;
            const daysSinceLastReport = toFiniteNumber(timeline.daysSinceLastReport);
            const daysSinceFirstReport = toFiniteNumber(timeline.daysSinceFirstReport);
            const defectType = resolveDefectAlias(prediction.defectType || lot.defectSummary?.primaryDefect) || 'OTRO';
            const defectLabel = prediction.defectLabel || formatDefectLabel(defectType);
            const defectiveUnits = roundNumber(
                Math.max(
                    0,
                    toQuantityNumber(
                        prediction.primaryDefectUnits
                        ?? lot.defectSummary?.primaryDefectUnits
                        ?? lot.quantity
                    )
                ),
                2
            ) || 0;
            const severityWeight = SEVERITY_PRIORITY_WEIGHT[lot.severity] || SEVERITY_PRIORITY_WEIGHT.normal;
            const continuityWeight = CONTINUITY_PRIORITY_WEIGHT[bucketKey] || CONTINUITY_PRIORITY_WEIGHT.sin_datos;
            const probabilityWeight = 0.6 + (probability / 100 * 0.4);
            const priorityScore = roundNumber(impactUnits * severityWeight * continuityWeight * probabilityWeight, 2) || 0;

            lotContinuityOverviewAcc[bucketKey].lots += 1;
            lotContinuityOverviewAcc[bucketKey].reportedUnits += reportedUnits;
            lotContinuityOverviewAcc[bucketKey].projectedAdditionalUnits += projectedAdditionalUnits;
            lotContinuityOverviewAcc[bucketKey].weightedProjectedAdditionalUnits += weightedProjectedAdditionalUnits;
            lotContinuityOverviewAcc[bucketKey].rawImpactUnits += rawImpactUnits;
            lotContinuityOverviewAcc[bucketKey].impactUnits += impactUnits;
            lotContinuityOverviewAcc[bucketKey].avgProbabilitySum += probability;
            lotContinuityOverviewAcc[bucketKey].avgConfidenceSum += confidenceScore;
            lotContinuityOverviewAcc[bucketKey].avgDaysSinceLastReportSum += daysSinceLastReport ?? 0;
            lotContinuityOverviewAcc[bucketKey].avgDaysSinceFirstReportSum += daysSinceFirstReport ?? 0;
            if (['critical', 'recall'].includes(lot.severity)) {
                lotContinuityOverviewAcc[bucketKey].highSeverityLots += 1;
            }

            if (!defectContinuityBreakdownMap[defectType]) {
                defectContinuityBreakdownMap[defectType] = {
                    defectType,
                    defectLabel,
                    totalLots: 0,
                    defectiveUnits: 0,
                    projectedAdditionalUnits: 0,
                    weightedProjectedAdditionalUnits: 0,
                    impactUnits: 0,
                    avgProbabilitySum: 0,
                    avgConfidenceSum: 0,
                    avgDaysSinceLastReportSum: 0
                };
                LOT_CONTINUITY_BUCKETS.forEach((bucket) => {
                    defectContinuityBreakdownMap[defectType][bucket.key] = 0;
                    defectContinuityBreakdownMap[defectType][`${bucket.key}Units`] = 0;
                });
            }

            defectContinuityBreakdownMap[defectType].totalLots += 1;
            defectContinuityBreakdownMap[defectType].defectiveUnits += defectiveUnits;
            defectContinuityBreakdownMap[defectType].projectedAdditionalUnits += projectedAdditionalUnits;
            defectContinuityBreakdownMap[defectType].weightedProjectedAdditionalUnits += weightedProjectedAdditionalUnits;
            defectContinuityBreakdownMap[defectType].impactUnits += impactUnits;
            defectContinuityBreakdownMap[defectType].avgProbabilitySum += probability;
            defectContinuityBreakdownMap[defectType].avgConfidenceSum += confidenceScore;
            defectContinuityBreakdownMap[defectType].avgDaysSinceLastReportSum += daysSinceLastReport ?? 0;
            defectContinuityBreakdownMap[defectType][bucketKey] += 1;
            defectContinuityBreakdownMap[defectType][`${bucketKey}Units`] += defectiveUnits;

            lotContinuityMap.push({
                lot: lot.lot,
                flavors: Array.isArray(lot.flavors) ? lot.flavors : [],
                severity: lot.severity,
                defectType,
                defectLabel,
                operationalBucket: bucketMeta.key,
                operationalBucketLabel: bucketMeta.label,
                continueReportingProbabilityPct: probability,
                confidenceScore,
                daysSinceLastReport,
                daysSinceFirstReport,
                reportedUnits,
                projectedAdditionalUnits,
                weightedProjectedAdditionalUnits,
                rawImpactUnits,
                impactUnits,
                priorityScore,
                isNewLot: Boolean(timeline.isNewLot),
                predictedOutcome: prediction.predictedOutcome || null,
                predictedOutcomeLabel: prediction.predictedOutcomeLabel || null
            });
        });

        lotContinuityMap.sort((a, b) => b.priorityScore - a.priorityScore);

        const lotContinuityBuckets = LOT_CONTINUITY_BUCKETS.map((bucket) => {
            const entry = lotContinuityOverviewAcc[bucket.key];
            const lots = entry.lots;
            const safeLots = Math.max(lots, 1);
            return {
                key: bucket.key,
                label: bucket.label,
                description: bucket.description,
                color: bucket.color,
                lots,
                reportedUnits: roundNumber(entry.reportedUnits, 2),
                projectedAdditionalUnits: roundNumber(entry.projectedAdditionalUnits, 2),
                weightedProjectedAdditionalUnits: roundNumber(entry.weightedProjectedAdditionalUnits, 2),
                rawImpactUnits: roundNumber(entry.rawImpactUnits, 2),
                impactUnits: roundNumber(entry.impactUnits, 2),
                highSeverityLots: entry.highSeverityLots,
                avgProbabilityPct: lots > 0 ? roundNumber(entry.avgProbabilitySum / safeLots, 1) : null,
                avgConfidencePct: lots > 0 ? roundNumber(entry.avgConfidenceSum / safeLots, 1) : null,
                avgDaysSinceLastReport: lots > 0 ? roundNumber(entry.avgDaysSinceLastReportSum / safeLots, 1) : null,
                avgDaysSinceFirstReport: lots > 0 ? roundNumber(entry.avgDaysSinceFirstReportSum / safeLots, 1) : null,
                lotSharePct: followUpLots.length > 0 ? roundNumber((lots / followUpLots.length) * 100, 1) : 0
            };
        });

        const getContinuityBucketLots = (key) => (
            lotContinuityBuckets.find((bucket) => bucket.key === key)?.lots || 0
        );

        const lotContinuityOverview = {
            totalLots: followUpLots.length,
            thresholds: {
                recentDays: FOLLOW_UP_RECENT_DAYS,
                monitorDays: FOLLOW_UP_MONITOR_DAYS,
                stoppedDays: FOLLOW_UP_STOPPED_DAYS
            },
            recentActiveLots: getContinuityBucketLots('nuevo_riesgo') + getContinuityBucketLots('activo_recurrente'),
            monitoringLots: getContinuityBucketLots('vigilancia'),
            coolingLots: getContinuityBucketLots('enfriando'),
            stoppedRecentLots: getContinuityBucketLots('sin_reporte_reciente'),
            buckets: lotContinuityBuckets
        };

        const defectContinuityBreakdown = Object.values(defectContinuityBreakdownMap)
            .map((entry) => {
                const safeLots = Math.max(entry.totalLots, 1);
                const activeLotsForDefect = toQuantityNumber(entry.nuevo_riesgo) + toQuantityNumber(entry.activo_recurrente);
                const coolingOrStoppedLots = toQuantityNumber(entry.enfriando) + toQuantityNumber(entry.sin_reporte_reciente);
                return {
                    defectType: entry.defectType,
                    defectLabel: entry.defectLabel,
                    totalLots: entry.totalLots,
                    defectiveUnits: roundNumber(entry.defectiveUnits, 2),
                    projectedAdditionalUnits: roundNumber(entry.projectedAdditionalUnits, 2),
                    weightedProjectedAdditionalUnits: roundNumber(entry.weightedProjectedAdditionalUnits, 2),
                    impactUnits: roundNumber(entry.impactUnits, 2),
                    avgProbabilityPct: roundNumber(entry.avgProbabilitySum / safeLots, 1),
                    avgConfidencePct: roundNumber(entry.avgConfidenceSum / safeLots, 1),
                    avgDaysSinceLastReport: roundNumber(entry.avgDaysSinceLastReportSum / safeLots, 1),
                    activeSharePct: roundNumber((activeLotsForDefect / safeLots) * 100, 1),
                    coolingSharePct: roundNumber((coolingOrStoppedLots / safeLots) * 100, 1),
                    ...LOT_CONTINUITY_BUCKETS.reduce((acc, bucket) => {
                        acc[bucket.key] = entry[bucket.key];
                        acc[`${bucket.key}Units`] = roundNumber(entry[`${bucket.key}Units`], 2);
                        return acc;
                    }, {})
                };
            })
            .sort((a, b) => {
                if (b.totalLots !== a.totalLots) return b.totalLots - a.totalLots;
                return toQuantityNumber(b.defectiveUnits) - toQuantityNumber(a.defectiveUnits);
            })
            .slice(0, 8);

        const confidenceValues = lotContinuityMap
            .map((row) => toFiniteNumber(row.confidenceScore))
            .filter((value) => value !== null);
        const analysisQuality = classifyContinuityAnalysisQuality({
            predictionModel,
            confidenceValues,
            totalLots: followUpLots.length
        });

        const observedUnitsTotal = roundNumber(
            lotContinuityMap.reduce((sum, row) => sum + toQuantityNumber(row.reportedUnits), 0),
            2
        ) || 0;
        const projectedAdditionalUnitsTotal = roundNumber(
            lotContinuityMap.reduce((sum, row) => sum + toQuantityNumber(row.projectedAdditionalUnits), 0),
            2
        ) || 0;
        const weightedProjectedAdditionalUnitsTotal = roundNumber(
            lotContinuityMap.reduce((sum, row) => sum + toQuantityNumber(row.weightedProjectedAdditionalUnits), 0),
            2
        ) || 0;
        const weightedImpactUnitsTotal = roundNumber(
            lotContinuityMap.reduce((sum, row) => sum + toQuantityNumber(row.impactUnits), 0),
            2
        ) || 0;
        const activeBucketKeys = new Set(['nuevo_riesgo', 'activo_recurrente']);
        const closureBucketKeys = new Set(['enfriando', 'sin_reporte_reciente']);
        const activeHighSeverityLots = lotContinuityMap.filter((row) => (
            activeBucketKeys.has(row.operationalBucket)
            && ['critical', 'recall'].includes(row.severity)
        )).length;
        const topDefectDriver = defectContinuityBreakdown[0] || null;
        const topPriorityLots = [...lotContinuityMap]
            .sort((a, b) => b.priorityScore - a.priorityScore)
            .slice(0, 6);
        const closureCandidates = lotContinuityMap
            .filter((row) => closureBucketKeys.has(row.operationalBucket))
            .sort((a, b) => {
                if (toQuantityNumber(b.daysSinceLastReport) !== toQuantityNumber(a.daysSinceLastReport)) {
                    return toQuantityNumber(b.daysSinceLastReport) - toQuantityNumber(a.daysSinceLastReport);
                }
                return toQuantityNumber(b.reportedUnits) - toQuantityNumber(a.reportedUnits);
            })
            .slice(0, 6);

        let pressureLevel = 'media';
        let pressureLabel = 'Presion activa contenida';
        if (lotContinuityOverview.recentActiveLots >= 40 || activeHighSeverityLots >= 12) {
            pressureLevel = 'alta';
            pressureLabel = 'Presion activa alta';
        } else if (lotContinuityOverview.recentActiveLots <= 18 && activeHighSeverityLots <= 5) {
            pressureLevel = 'baja';
            pressureLabel = 'Presion activa baja';
        }

        const executiveSummary = {
            pressureLevel,
            pressureLabel,
            headline: `${pressureLabel}: ${lotContinuityOverview.recentActiveLots} lotes con actividad reciente`,
            narrative: topDefectDriver
                ? `${topDefectDriver.defectLabel} concentra ${topDefectDriver.totalLots} lotes y ${topDefectDriver.defectiveUnits} unidades defectuosas. ${lotContinuityOverview.coolingLots + lotContinuityOverview.stoppedRecentLots} lotes ya muestran salida progresiva del problema.`
                : `${lotContinuityOverview.recentActiveLots} lotes tienen actividad reciente y ${lotContinuityOverview.coolingLots + lotContinuityOverview.stoppedRecentLots} ya muestran salida del problema.`,
            observedUnitsTotal,
            projectedAdditionalUnitsTotal,
            weightedProjectedAdditionalUnitsTotal,
            weightedImpactUnitsTotal,
            activeHighSeverityLots,
            closureOpportunityLots: lotContinuityOverview.coolingLots + lotContinuityOverview.stoppedRecentLots,
            priorityFocus: topDefectDriver
                ? `${topDefectDriver.defectLabel} es el defecto dominante y concentra la mayor presion activa.`
                : 'No hay un defecto dominante claro con la informacion actual.',
            qualityNote: analysisQuality.hint,
            nextActions: [
                `Priorizar ${activeHighSeverityLots} lotes criticos o recall con actividad reciente.`,
                `Mantener vigilancia sobre ${lotContinuityOverview.monitoringLots} lotes intermedios, especialmente ${topDefectDriver?.defectLabel || 'los defectos dominantes'}.`,
                `Revisar cierre controlado de ${lotContinuityOverview.coolingLots + lotContinuityOverview.stoppedRecentLots} lotes en salida o sin reporte reciente.`
            ],
            topPriorityLots,
            closureCandidates
        };

        const unitsTrendPct = windowSummary.previous14d.units > 0
            ? roundNumber(((windowSummary.recent14d.units - windowSummary.previous14d.units) / windowSummary.previous14d.units) * 100, 1)
            : (windowSummary.recent14d.units > 0 ? 100 : 0);
        const reportsTrendPct = windowSummary.previous14d.reports > 0
            ? roundNumber(((windowSummary.recent14d.reports - windowSummary.previous14d.reports) / windowSummary.previous14d.reports) * 100, 1)
            : (windowSummary.recent14d.reports > 0 ? 100 : 0);

        let trendDirection = 'stable';
        if ((unitsTrendPct || 0) >= 15 || (reportsTrendPct || 0) >= 15) trendDirection = 'up';
        else if ((unitsTrendPct || 0) <= -15 || (reportsTrendPct || 0) <= -15) trendDirection = 'down';

        let sourceMix = 'balanceado';
        let sourceMixLabel = 'Mix balanceado entre nuevos y rezagos';
        if (newLotsActive > residualLotsActive) {
            sourceMix = 'nuevos';
            sourceMixLabel = 'Predominan reportes de lotes nuevos';
        } else if (residualLotsActive > newLotsActive) {
            sourceMix = 'rezagos';
            sourceMixLabel = 'Predominan reportes rezagados';
        }

        let level = 'media';
        let levelLabel = 'Temperatura media';
        const reportsExhausted = windowSummary.recent14d.reports === 0 && activeLots === 0;
        if (reportsExhausted) {
            level = 'sin_reportes';
            levelLabel = 'Reportes de lotes dañados prácticamente agotados';
        } else if (
            windowSummary.recent14d.units >= Math.max(12, windowSummary.previous14d.units * 1.25) ||
            activeLots >= 5 ||
            newLotsActive >= 3
        ) {
            level = 'alta';
            levelLabel = 'Temperatura alta de reportes';
        } else if (trendDirection === 'down' && activeLots <= 2) {
            level = 'baja';
            levelLabel = 'Temperatura baja de reportes';
        }

        let attentionHint = 'Monitoreo normal de PQR.';
        if (level === 'alta') {
            attentionHint = 'Subir capacidad de atención PQR y priorizar lotes con continuidad alta.';
        } else if (reportsExhausted) {
            attentionHint = 'Foco en cierre y verificación final; no hay presión alta de reportes nuevos.';
        } else if (trendDirection === 'down' && sourceMix === 'rezagos') {
            attentionHint = 'Los reportes bajan y predominan rezagos: priorizar cierres pendientes.';
        } else if (sourceMix === 'nuevos') {
            attentionHint = 'Entraron lotes nuevos con reportes: activar seguimiento temprano.';
        }

        const calmLightParams = {
            shortDaysQuantile: 0.25,
            shortDaysCapDays: 14,
            noNewShortLookbackDays: 10,
            newShortActiveLastReportDays: 7,
            minLotsWithDays: 6,
            minShortLotsSample: 2,
            stableTrendPct: 6
        };
        const lotsWithDays = byLotData
            .filter((lot) => lot.daysToReport !== null && lot.daysToReport !== undefined && lot.daysToReport >= 0)
            .filter((lot) => lot.firstReportDate);
        const sortedDays = lotsWithDays
            .map((lot) => toQuantityNumber(lot.daysToReport))
            .filter((days) => days >= 0)
            .sort((a, b) => a - b);
        const shortDaysQuantileValue = sortedDays.length > 0
            ? percentile(sortedDays, calmLightParams.shortDaysQuantile)
            : null;
        const shortDaysThreshold = shortDaysQuantileValue !== null
            ? Math.max(1, Math.round(Math.min(calmLightParams.shortDaysCapDays, shortDaysQuantileValue)))
            : calmLightParams.shortDaysCapDays;
        const shortLots = lotsWithDays.filter((lot) => toQuantityNumber(lot.daysToReport) <= shortDaysThreshold);
        const firstReportedLot = lotsWithDays
            .map((lot) => ({
                lotCode: lot.lot,
                firstReportDate: lot.firstReportDate,
                firstReportDateObj: new Date(lot.firstReportDate),
                daysToReport: toQuantityNumber(lot.daysToReport)
            }))
            .filter((lot) => !isNaN(lot.firstReportDateObj.getTime()))
            .sort((a, b) => a.firstReportDateObj - b.firstReportDateObj)[0] || null;
        const firstReportWasShortLot = Boolean(
            firstReportedLot && toQuantityNumber(firstReportedLot.daysToReport) <= shortDaysThreshold
        );
        const shortNewLotsRecent = followUpLots.filter((lot) => {
            const timeline = lot.followUp?.timeline || {};
            const isShort = toQuantityNumber(lot.daysToReport) <= shortDaysThreshold;
            return isShort
                && Boolean(timeline.isNewLot)
                && toQuantityNumber(timeline.daysSinceFirstReport) <= calmLightParams.noNewShortLookbackDays;
        }).length;
        const shortNewLotsActive = followUpLots.filter((lot) => {
            const timeline = lot.followUp?.timeline || {};
            const isShort = toQuantityNumber(lot.daysToReport) <= shortDaysThreshold;
            return isShort
                && Boolean(timeline.isNewLot)
                && toQuantityNumber(timeline.daysSinceLastReport) <= calmLightParams.newShortActiveLastReportDays
                && toQuantityNumber(timeline.reportsLast14d) > 0;
        }).length;
        const canEvaluateCalmLight = lotsWithDays.length >= calmLightParams.minLotsWithDays
            && shortLots.length >= calmLightParams.minShortLotsSample;
        let calmScore = 22;
        if (firstReportWasShortLot) calmScore += 30;
        if (shortNewLotsRecent === 0) calmScore += 18;
        else calmScore -= Math.min(18, shortNewLotsRecent * 4);
        if (shortNewLotsActive === 0) calmScore += 18;
        else calmScore -= Math.min(20, shortNewLotsActive * 5);
        if ((unitsTrendPct || 0) <= calmLightParams.stableTrendPct && (reportsTrendPct || 0) <= calmLightParams.stableTrendPct) {
            calmScore += 12;
        }
        if (trendDirection === 'down') calmScore += 8;
        if (trendDirection === 'up') calmScore -= 10;
        if (level === 'alta') calmScore -= 10;
        if (reportsExhausted) calmScore += 8;
        calmScore = Math.round(clampValue(calmScore, 0, 100));

        let calmState = 'sin_calma';
        let calmLabel = 'Sin señal de calma';
        let calmHint = 'Persisten entradas recientes de lotes nuevos de días cortos.';
        if (!canEvaluateCalmLight) {
            calmState = 'datos_insuficientes';
            calmLabel = 'Datos insuficientes';
            calmHint = 'Aún no hay base estadística suficiente para evaluar la señal de calma.';
        } else if (firstReportWasShortLot && shortNewLotsRecent === 0 && shortNewLotsActive === 0 && calmScore >= 70) {
            calmState = 'calma_alta';
            calmLabel = 'Luz de calma alta';
            calmHint = 'Hubo arranque en lotes de días cortos, pero no entraron nuevos lotes cortos recientemente.';
        } else if (calmScore >= 58 && shortNewLotsActive <= 1) {
            calmState = 'calma_moderada';
            calmLabel = 'Luz de calma moderada';
            calmHint = 'La presión de lotes cortos nuevos baja, pero todavía hay monitoreo activo.';
        }

        const calmLight = {
            state: calmState,
            isCalm: ['calma_alta', 'calma_moderada'].includes(calmState),
            label: calmLabel,
            hint: calmHint,
            score: calmScore,
            shortDaysThreshold,
            shortLotsSample: shortLots.length,
            lotsWithDaysSample: lotsWithDays.length,
            firstReportWasShortLot,
            firstReportedLot: firstReportedLot
                ? {
                    lot: firstReportedLot.lotCode,
                    firstReportDate: firstReportedLot.firstReportDate,
                    daysToReport: firstReportedLot.daysToReport
                }
                : null,
            newShortLots: {
                recentLookbackDays: calmLightParams.noNewShortLookbackDays,
                activeLastReportDays: calmLightParams.newShortActiveLastReportDays,
                recentCount: shortNewLotsRecent,
                activeCount: shortNewLotsActive
            },
            parameters: calmLightParams
        };

        const reportTemperature = {
            level,
            levelLabel,
            trendDirection,
            unitsTrendPct,
            reportsTrendPct,
            reportsExhausted,
            hasManyReports: level === 'alta' || windowSummary.recent14d.reports >= 20,
            window: {
                recent14d: {
                    reports: windowSummary.recent14d.reports,
                    units: roundNumber(windowSummary.recent14d.units, 2)
                },
                previous14d: {
                    reports: windowSummary.previous14d.reports,
                    units: roundNumber(windowSummary.previous14d.units, 2)
                }
            },
            workload: {
                activeLots,
                coolingLots,
                stoppedLots,
                lotsStillReporting,
                lotsStoppedReporting
            },
            sourceMix: {
                type: sourceMix,
                label: sourceMixLabel,
                newLotsActive,
                residualLotsActive,
                newLotsLikelyContinue,
                residualBacklogLots
            },
            attentionHint,
            calmLight,
            predictionModel
        };

        const lotFollowUpSummary = {
            totalLotsAnalyzed: followUpLots.length,
            lotsStillReporting,
            lotsStoppedReporting,
            newLotsLikelyContinue,
            newLotsActive,
            residualLotsActive,
            residualBacklogLots,
            recentActiveLots: lotContinuityOverview.recentActiveLots,
            monitoringLots: lotContinuityOverview.monitoringLots,
            coolingLots: lotContinuityOverview.coolingLots,
            stoppedRecentLots: lotContinuityOverview.stoppedRecentLots,
            lotContinuityOverview,
            analysisQuality,
            executiveSummary,
            calmLight,
            defectFollowUpProjection,
            defectContinuityBreakdown,
            predictionModel
        };

        // Gaussian outlier elimination (iterative mean ± 2σ)
        const validDays = byLotData.map(l => l.daysToReport).filter(d => d !== null && d >= 0);
        let filteredDays = [...validDays];
        if (filteredDays.length >= 3) {
            for (let iter = 0; iter < 3; iter++) {
                const n = filteredDays.length;
                if (n < 3) break;
                const mean = filteredDays.reduce((s, v) => s + v, 0) / n;
                const stdDev = Math.sqrt(filteredDays.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
                const lo = mean - 2 * stdDev;
                const hi = mean + 2 * stdDev;
                const next = filteredDays.filter(v => v >= lo && v <= hi);
                if (next.length === n) break; // converged
                filteredDays = next;
            }
        }
        const lotAgeAnalysis = {
            avgDaysRaw: validDays.length > 0 ? Math.round(validDays.reduce((s, v) => s + v, 0) / validDays.length * 10) / 10 : null,
            avgDaysFiltered: filteredDays.length > 0 ? Math.round(filteredDays.reduce((s, v) => s + v, 0) / filteredDays.length * 10) / 10 : null,
            medianDays: filteredDays.length > 0 ? (() => { const sorted = [...filteredDays].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10; })() : null,
            stdDev: filteredDays.length > 0 ? Math.round(Math.sqrt(filteredDays.reduce((s, v) => s + (v - filteredDays.reduce((a, b) => a + b, 0) / filteredDays.length) ** 2, 0) / filteredDays.length) * 10) / 10 : null,
            sampleSize: validDays.length,
            filteredSize: filteredDays.length,
            outliersRemoved: validDays.length - filteredDays.length
        };

        res.json({
            kpis,
            byStage: byStageData,
            byType: byTypeData,
            byProduct: byProductData,
            byFlavor: byFlavorData,
            bySize: bySizeData,
            byLot: byLotData,
            byDistributor: byDistributorData,
            byMonth: byMonthData,
            byRefundMethod: byRefundMethodData,
            defectKeywords: defectKeywordsData,
            lotAgeAnalysis,
            lotFollowUpSummary,
            reportTemperature,
            defectFollowUpProjection,
            lotContinuityOverview,
            analysisQuality,
            executiveSummary,
            defectContinuityBreakdown,
            lotContinuityMap
        });
    } catch (error) {
        console.error('PQR Analytics error:', error);
        res.status(500).json({ error: 'Error al obtener analíticas de PQR' });
    }
};

/**
 * GET /api/pqr/analytics/recall-report
 * Generates a PDF report of lots in RECALL status (quantity >= 10)
 * for distribution to commercial partners
 */
exports.getRecallReport = async (req, res) => {
    try {
        const distributorIdFilter = typeof req.query.distributorId === 'string'
            ? req.query.distributorId.trim()
            : '';

        const pqrs = await prisma.pQR.findMany({
            where: distributorIdFilter
                ? { userId: distributorIdFilter }
                : undefined,
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, flavor: true, size: true } },
                    }
                },
                user: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const allItems = pqrs.flatMap(pqr =>
            pqr.items.map(item => ({
                ...item,
                pqrCreatedAt: pqr.createdAt,
                distributorName: pqr.user?.name || 'Desconocido',
                productName: item.product?.name || 'Producto Desconocido',
                productFlavor: item.product?.flavor || 'Sin sabor',
                productSize: item.product?.size || 'Sin tamaño'
            }))
        );

        // Aggregate by lot
        const byLot = {};
        allItems.forEach(item => {
            if (!item.lotNumber) return;
            const lot = item.lotNumber;
            if (!byLot[lot]) byLot[lot] = { lot, flavors: new Set(), items: [], count: 0, quantity: 0, distributors: new Set() };
            byLot[lot].count++;
            const qty = toQuantityNumber(item.quantity);
            byLot[lot].quantity += qty;
            byLot[lot].flavors.add(item.productFlavor);
            byLot[lot].distributors.add(item.distributorName);
            byLot[lot].items.push({
                product: item.productName,
                size: item.productSize,
                flavor: item.productFlavor,
                quantity: qty,
                unit: item.unit,
                description: item.description,
                distributor: item.distributorName,
                date: item.pqrCreatedAt
            });
        });

        // Filter only recall lots (quantity >= 10)
        const recallLots = Object.values(byLot)
            .filter(l => l.quantity >= 10)
            .map(l => ({
                ...l,
                flavors: Array.from(l.flavors),
                distributors: Array.from(l.distributors)
            }))
            .sort((a, b) => b.quantity - a.quantity);

        if (recallLots.length === 0) {
            return res.status(404).json({ error: 'No hay lotes en estado de recall actualmente.' });
        }

        // Generate PDF
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        const today = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="RECALL_LIQUIPOPS_${today}.pdf"`);
        doc.pipe(res);

        // ── HEADER ──
        doc.rect(0, 0, doc.page.width, 100).fill('#DC2626');
        doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
            .text('[!]  ALERTA DE RECALL', 50, 25, { align: 'center' });
        doc.fontSize(11).fill('#FEE2E2').font('Helvetica')
            .text('LIQUIPOPS — Informe de lotes que deben ser retirados de la venta', 50, 60, { align: 'center' });

        // Date + summary
        doc.fill('#111827').font('Helvetica-Bold').fontSize(11)
            .text(`Fecha de emisión: ${today}`, 50, 120);
        doc.font('Helvetica').fontSize(10).fill('#4B5563')
            .text(`Total de lotes en recall: ${recallLots.length}`, 50, 138)
            .text(`Total de unidades afectadas: ${recallLots.reduce((s, l) => s + l.quantity, 0).toLocaleString()}`, 50, 152);

        doc.moveTo(50, 175).lineTo(doc.page.width - 50, 175).strokeColor('#E5E7EB').lineWidth(1).stroke();

        let y = 190;
        const pageBottom = doc.page.height - 80;

        const checkPage = (needed = 80) => {
            if (y + needed > pageBottom) {
                doc.addPage();
                y = 50;
            }
        };

        // ── LOT ENTRIES ──
        recallLots.forEach((lot, idx) => {
            checkPage(140);

            // Lot header bar
            doc.rect(50, y, doc.page.width - 100, 28).fill('#FEF2F2');
            doc.font('Helvetica-Bold').fontSize(12).fill('#991B1B')
                .text(`[!] LOTE: ${lot.lot}`, 58, y + 7);
            doc.font('Helvetica-Bold').fontSize(10).fill('#DC2626')
                .text(`${lot.quantity} unidades`, doc.page.width - 180, y + 8, { width: 130, align: 'right' });
            y += 36;

            // Lot info
            doc.font('Helvetica').fontSize(9).fill('#4B5563');
            doc.text(`Sabor(es): ${lot.flavors.join(', ')}`, 58, y);
            y += 14;
            doc.text(`Reclamos totales: ${lot.count}`, 58, y);
            y += 14;
            doc.text(`Distribuidores afectados: ${lot.distributors.join(', ')}`, 58, y);
            y += 20;

            // Items table header
            checkPage(40);
            doc.rect(58, y, doc.page.width - 116, 18).fill('#F3F4F6');
            doc.font('Helvetica-Bold').fontSize(8).fill('#374151');
            doc.text('PRODUCTO', 62, y + 5, { width: 180 });
            doc.text('TAMAÑO', 245, y + 5, { width: 60 });
            doc.text('CANT.', 310, y + 5, { width: 40 });
            doc.text('DISTRIBUIDOR', 355, y + 5, { width: 120 });
            doc.text('FECHA', 480, y + 5, { width: 70 });
            y += 22;

            // Items
            lot.items.forEach(item => {
                checkPage(18);
                doc.font('Helvetica').fontSize(8).fill('#111827');
                doc.text(item.product, 62, y, { width: 180 });
                doc.text(item.size || '-', 245, y, { width: 60 });
                doc.text(`${toQuantityNumber(item.quantity)}`, 310, y, { width: 40 });
                doc.text(item.distributor, 355, y, { width: 120 });
                doc.text(item.date ? new Date(item.date).toLocaleDateString('es-CO') : '-', 480, y, { width: 70 });
                y += 15;

                if (item.description) {
                    checkPage(14);
                    doc.font('Helvetica-Oblique').fontSize(7).fill('#6B7280')
                        .text(`  → ${item.description}`, 66, y, { width: 480 });
                    y += 12;
                }
            });

            y += 10;
            if (idx < recallLots.length - 1) {
                doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
                y += 15;
            }
        });

        // ── FOOTER ──
        checkPage(80);
        y += 15;
        doc.rect(50, y, doc.page.width - 100, 50).fill('#FEF2F2');
        doc.font('Helvetica-Bold').fontSize(9).fill('#991B1B')
            .text('ACCIÓN REQUERIDA:', 58, y + 8, { width: doc.page.width - 116 });
        doc.font('Helvetica').fontSize(8).fill('#7F1D1D')
            .text('Por favor RETIRE de la venta inmediatamente todos los productos correspondientes a los lotes listados anteriormente. En caso de tener unidades en bodega, sepárelas e informe al departamento de calidad de LIQUIPOPS para proceder con la devolución.', 58, y + 22, { width: doc.page.width - 130 });

        doc.end();

    } catch (error) {
        console.error('Recall report error:', error);
        res.status(500).json({ error: 'Error al generar informe de recall' });
    }
};

/**
 * GET /api/pqr/recall-lots
 * Returns recall lots (quantity >= 10) as JSON — lightweight endpoint for distributor portal
 */
exports.getRecallLots = async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const pqrs = await prisma.pQR.findMany({
            include: {
                items: {
                    include: {
                        product: { select: { name: true, flavor: true, size: true } },
                    }
                }
            }
        });

        const allItems = pqrs.flatMap(pqr =>
            pqr.items.map(item => ({
                lotNumber: item.lotNumber,
                quantity: item.quantity,
                productFlavor: item.product?.flavor || 'Sin sabor',
                productName: item.product?.name || 'Desconocido',
                productSize: item.product?.size || ''
            }))
        );

        const byLot = {};
        allItems.forEach(item => {
            if (!item.lotNumber) return;
            const lot = item.lotNumber;
            if (!byLot[lot]) byLot[lot] = { lot, flavors: new Set(), quantity: 0, products: new Set() };
            byLot[lot].quantity += toQuantityNumber(item.quantity);
            byLot[lot].flavors.add(item.productFlavor);
            byLot[lot].products.add(item.productName);
        });

        const recallLots = Object.values(byLot)
            .filter(l => l.quantity >= 10)
            .map(l => ({
                lot: l.lot,
                quantity: l.quantity,
                flavors: Array.from(l.flavors),
                products: Array.from(l.products)
            }))
            .sort((a, b) => b.quantity - a.quantity);

        if (!userId || recallLots.length === 0) {
            return res.json(recallLots.map((lot) => ({
                ...lot,
                isCollected: false,
                collectedAt: null
            })));
        }

        const collectedRows = await prisma.recallLotCollection.findMany({
            where: {
                userId,
                lotNumber: { in: recallLots.map((lot) => lot.lot) }
            },
            select: {
                lotNumber: true,
                collectedAt: true
            }
        });

        const collectedByLot = new Map(collectedRows.map((row) => [row.lotNumber, row]));

        const enrichedRecallLots = recallLots
            .map((lot) => {
                const collectedInfo = collectedByLot.get(lot.lot);
                return {
                    ...lot,
                    isCollected: Boolean(collectedInfo),
                    collectedAt: collectedInfo?.collectedAt || null
                };
            })
            .sort((a, b) => {
                if (a.isCollected !== b.isCollected) return a.isCollected ? 1 : -1;
                return b.quantity - a.quantity;
            });

        res.json(enrichedRecallLots);
    } catch (error) {
        console.error('Recall lots error:', error);
        res.status(500).json({ error: 'Error al obtener lotes en recall' });
    }
};

/**
 * PATCH /api/pqr/recall-lots/:lotNumber/collection-status
 * Marks/unmarks recall lot as collected for the authenticated user.
 */
exports.updateRecallLotCollectionStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        let lotNumber = String(req.params.lotNumber || '').trim();
        try {
            lotNumber = decodeURIComponent(lotNumber).trim();
        } catch (_) {
            lotNumber = lotNumber.trim();
        }

        if (!lotNumber) {
            return res.status(400).json({ error: 'Debe indicar un lote válido.' });
        }

        const rawCollected = req.body?.collected;
        const collected = typeof rawCollected === 'boolean'
            ? rawCollected
            : String(rawCollected).toLowerCase() === 'true'
                ? true
                : String(rawCollected).toLowerCase() === 'false'
                    ? false
                    : null;

        if (collected === null) {
            return res.status(400).json({ error: 'El campo "collected" debe ser booleano.' });
        }

        if (collected) {
            const aggregate = await prisma.pQRItem.aggregate({
                where: { lotNumber },
                _sum: { quantity: true }
            });
            const totalReported = toQuantityNumber(aggregate?._sum?.quantity);
            if (totalReported < 10) {
                return res.status(404).json({ error: 'El lote no está actualmente en recall.' });
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            if (collected) {
                const now = new Date();
                return tx.recallLotCollection.upsert({
                    where: {
                        userId_lotNumber: {
                            userId,
                            lotNumber
                        }
                    },
                    update: {
                        collectedAt: now
                    },
                    create: {
                        userId,
                        lotNumber,
                        collectedAt: now
                    }
                });
            }

            await tx.recallLotCollection.deleteMany({
                where: {
                    userId,
                    lotNumber
                }
            });
            return null;
        });

        res.json({
            lot: lotNumber,
            collected,
            collectedAt: result?.collectedAt || null
        });
    } catch (error) {
        console.error('Recall lot collection status error:', error);
        res.status(500).json({ error: 'Error al actualizar el estado de recolección del lote.' });
    }
};

/**
 * GET /api/pqr/valid-lots?flavor=Fresa&category=LIQUIPOPS
 * Returns production lots filtered by flavor for PQR form validation.
 * category=GENIALITY → queries SyrupLot table
 * category=LIQUIPOPS (default) → queries ProductionLot table
 */
exports.getValidLots = async (req, res) => {
    try {
        const { flavor, category } = req.query;
        const where = flavor
            ? { flavor: { equals: flavor, mode: 'insensitive' } }
            : {};

        if (category === 'GENIALITY') {
            // Query syrup lots
            const lots = await prisma.syrupLot.findMany({
                where,
                select: {
                    lotCode: true,
                    flavor: true,
                    productionDate: true,
                    mixQuantityKg: true,
                    phJarabe: true,
                    bxJarabe: true,
                    assemblyNote: true,
                },
                orderBy: { productionDate: 'desc' },
            });

            // For syrup lots, lotCode IS the display lot (e.g. "260109-1")
            const result = lots.map(lot => ({
                ...lot,
                premixLot: null,
                displayLot: lot.lotCode,
            }));

            return res.json(result);
        }

        // Default: Liquipops production lots
        const lots = await prisma.productionLot.findMany({
            where,
            select: {
                lotCode: true,
                premixLot: true,
                flavor: true,
                productionDate: true,
                mixQuantityKg: true,
                phJarabe: true,
                bxJarabe: true,
            },
            orderBy: { productionDate: 'desc' },
        });

        // Compute displayLot: extract YYMMDD-HHMM from lotCode
        // e.g. "2601051940MA12" → "260105-1940"
        const result = lots.map(lot => {
            const digits = lot.lotCode.replace(/[^0-9]/g, '');
            const displayLot = digits.length >= 10
                ? digits.slice(0, 6) + '-' + digits.slice(6, 10)
                : lot.premixLot || lot.lotCode;
            return { ...lot, displayLot };
        });

        res.json(result);
    } catch (error) {
        console.error('Valid lots error:', error);
        res.status(500).json({ error: 'Error al obtener lotes válidos' });
    }
};

/**
 * GET /api/pqr/analytics/advanced-validation
 * Unified validation dataset: all production lots + aggregated PQR impact by lot/presentation.
 */
exports.getAdvancedLotValidation = async (req, res) => {
    try {
        const [productionLots, pqrItems] = await Promise.all([
            prisma.productionLot.findMany({
                orderBy: [{ productionDate: 'desc' }, { lotCode: 'desc' }],
                select: {
                    id: true,
                    lotCode: true,
                    premixLot: true,
                    flavor: true,
                    flavorRaw: true,
                    productionDate: true,
                    mixAssemblyNote: true,
                    mixQuantityKg: true,
                    phJarabe: true,
                    bxJarabe: true,
                    conductividad: true,
                    bxPerla: true,
                    tempCoccion: true,
                    tempChiller: true,
                    productionStartAt: true,
                    productionEndAt: true,
                    productionDurationMin: true,
                    productionDurationRaw: true,
                    protectionLotCode: true,
                    protectionQuantityKg: true,
                    protectionPh: true,
                    protectionBx: true,
                    protectionAssemblyNote: true,
                    alginateLotCode: true,
                    pearlGrowthCheckRaw: true,
                    pearlGrowthConfirmed: true,
                    pearlCookTempC: true,
                    pearlCookTimeSec: true,
                    protectionAdded3400: true,
                    protectionAdded1150: true,
                    protectionAdded350: true,
                    damaged3400: true,
                    damaged1150: true,
                    damaged350: true,
                    pesoPerlas: true,
                    leader: true,
                    units3400: true,
                    units1150: true,
                    units350: true,
                    logisticsDeliveredDate: true,
                    logisticsDeliveredTo: true,
                    createdAt: true
                }
            }),
            prisma.pQRItem.findMany({
                where: { lotNumber: { not: null } },
                include: {
                    pqr: {
                        select: {
                            id: true,
                            ticketNumber: true,
                            stage: true,
                            status: true,
                            refundMethod: true,
                            createdAt: true,
                            resolvedAt: true,
                            user: { select: { id: true, name: true, email: true } }
                        }
                    },
                    product: {
                        select: {
                            id: true,
                            sku: true,
                            name: true,
                            flavor: true,
                            size: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
        ]);

        const toKey = (value) => {
            if (!value) return null;
            const digits = String(value).replace(/\D/g, '');
            if (digits.length < 10) return null;
            return digits.slice(0, 10);
        };

        const keyToDisplay = (key) => {
            if (!key || key.length < 10) return null;
            return `${key.slice(0, 6)}-${key.slice(6, 10)}`;
        };

        const getProductionKey = (lot) => {
            const fromCode = toKey(lot.lotCode);
            if (fromCode) return fromCode;
            return toKey(lot.premixLot);
        };

        const sortPresentations = (a, b) => {
            const aNum = parseInt(String(a.size || '').replace(/[^\d]/g, ''), 10);
            const bNum = parseInt(String(b.size || '').replace(/[^\d]/g, ''), 10);
            const aHasNum = !isNaN(aNum);
            const bHasNum = !isNaN(bNum);
            if (aHasNum && bHasNum) return bNum - aNum;
            if (aHasNum) return -1;
            if (bHasNum) return 1;
            return String(a.size || '').localeCompare(String(b.size || ''));
        };

        const normalizeFlavor = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        const buildEmptyAgg = (key) => ({
            lotKey: key,
            displayLot: keyToDisplay(key),
            firstReportDate: null,
            lastReportDate: null,
            ticketNumbers: new Set(),
            lotNumbersReported: new Set(),
            distributors: new Set(),
            products: new Set(),
            flavors: new Set(),
            totalReportItems: 0,
            totalReportedUnits: 0,
            byPresentation: {},
            reports: []
        });

        const applyReportToAgg = (agg, payload) => {
            const reportDate = payload.reportDate ? new Date(payload.reportDate) : null;
            const size = payload.size || 'Sin tamaño';

            agg.totalReportItems += 1;
            agg.totalReportedUnits += payload.quantity || 0;
            if (payload.ticketNumber) agg.ticketNumbers.add(payload.ticketNumber);
            if (payload.lotNumberReported) agg.lotNumbersReported.add(payload.lotNumberReported);
            if (payload.distributor?.name) agg.distributors.add(payload.distributor.name);
            if (payload.productName) agg.products.add(payload.productName);
            if (payload.flavor) agg.flavors.add(payload.flavor);

            if (!agg.byPresentation[size]) {
                agg.byPresentation[size] = { size, itemCount: 0, reportedUnits: 0 };
            }
            agg.byPresentation[size].itemCount += 1;
            agg.byPresentation[size].reportedUnits += payload.quantity || 0;

            if (reportDate) {
                if (!agg.firstReportDate || reportDate < agg.firstReportDate) agg.firstReportDate = reportDate;
                if (!agg.lastReportDate || reportDate > agg.lastReportDate) agg.lastReportDate = reportDate;
            }

            agg.reports.push(payload);
        };

        const pqrByKey = new Map();
        const pqrByKeyFlavor = new Map();
        const unmatchedPqrByLot = new Map();

        pqrItems.forEach((item) => {
            const rawLot = item.lotNumber || '';
            const key = toKey(rawLot);
            const qty = toQuantityNumber(item.quantity);
            const size = item.product?.size || 'Sin tamaño';
            const flavor = item.product?.flavor || 'Sin sabor';
            const flavorNorm = normalizeFlavor(flavor);
            const ticketNumber = item.pqr?.ticketNumber || '';
            const reportDate = item.pqr?.createdAt ? new Date(item.pqr.createdAt) : null;
            const distributor = item.pqr?.user?.name || 'Desconocido';

            const reportPayload = {
                pqrId: item.pqr?.id || null,
                ticketNumber,
                stage: item.pqr?.stage || null,
                status: item.pqr?.status || null,
                refundMethod: item.pqr?.refundMethod || null,
                reportDate: item.pqr?.createdAt || null,
                resolvedAt: item.pqr?.resolvedAt || null,
                lotNumberReported: rawLot,
                productId: item.product?.id || null,
                sku: item.product?.sku || null,
                productName: item.product?.name || 'Producto Desconocido',
                flavor,
                size,
                type: item.type || null,
                quantity: qty,
                unit: item.unit || null,
                description: item.description || null,
                distributor: item.pqr?.user || null
            };

            if (!key) {
                if (!unmatchedPqrByLot.has(rawLot)) {
                    unmatchedPqrByLot.set(rawLot, {
                        lotNumberReported: rawLot,
                        totalReportItems: 0,
                        totalReportedUnits: 0,
                        ticketNumbers: new Set(),
                        firstReportDate: null,
                        reports: []
                    });
                }
                const unmatched = unmatchedPqrByLot.get(rawLot);
                unmatched.totalReportItems += 1;
                unmatched.totalReportedUnits += qty;
                if (ticketNumber) unmatched.ticketNumbers.add(ticketNumber);
                if (reportDate && (!unmatched.firstReportDate || reportDate < unmatched.firstReportDate)) {
                    unmatched.firstReportDate = reportDate;
                }
                unmatched.reports.push(reportPayload);
                return;
            }

            if (!pqrByKey.has(key)) {
                pqrByKey.set(key, buildEmptyAgg(key));
            }
            const keyFlavor = `${key}::${flavorNorm || 'sin-sabor'}`;
            if (!pqrByKeyFlavor.has(keyFlavor)) {
                pqrByKeyFlavor.set(keyFlavor, buildEmptyAgg(key));
            }

            applyReportToAgg(pqrByKey.get(key), reportPayload);
            applyReportToAgg(pqrByKeyFlavor.get(keyFlavor), reportPayload);
        });

        const rows = productionLots.map((lot) => {
            const lotKey = getProductionKey(lot);
            const displayLot = keyToDisplay(lotKey) || lot.premixLot || lot.lotCode;
            const prodFlavorNorm = normalizeFlavor(lot.flavor || lot.flavorRaw);
            const flavorKey = lotKey ? `${lotKey}::${prodFlavorNorm || 'sin-sabor'}` : null;
            const pqrAggByFlavor = flavorKey ? pqrByKeyFlavor.get(flavorKey) : null;
            const pqrAggByLot = lotKey ? pqrByKey.get(lotKey) : null;
            const pqrAgg = pqrAggByFlavor || pqrAggByLot || null;

            const units3400 = parseInt(lot.units3400 || 0, 10) || 0;
            const units1150 = parseInt(lot.units1150 || 0, 10) || 0;
            const units350 = parseInt(lot.units350 || 0, 10) || 0;
            const producedTotal = units3400 + units1150 + units350;

            const damaged3400 = parseInt(lot.damaged3400 || 0, 10) || 0;
            const damaged1150 = parseInt(lot.damaged1150 || 0, 10) || 0;
            const damaged350 = parseInt(lot.damaged350 || 0, 10) || 0;
            const damagedAtProductionTotal = damaged3400 + damaged1150 + damaged350;

            const protectionAdded3400 = toFiniteNumber(lot.protectionAdded3400) || 0;
            const protectionAdded1150 = toFiniteNumber(lot.protectionAdded1150) || 0;
            const protectionAdded350 = toFiniteNumber(lot.protectionAdded350) || 0;
            const protectionAddedTotal = protectionAdded3400 + protectionAdded1150 + protectionAdded350;

            const firstReportDate = pqrAgg?.firstReportDate || null;
            const daysToFirstReport = firstReportDate
                ? Math.round((new Date(firstReportDate) - new Date(lot.productionDate)) / (1000 * 60 * 60 * 24))
                : null;

            const byPresentation = pqrAgg
                ? Object.values(pqrAgg.byPresentation).sort(sortPresentations)
                : [];

            return {
                id: lot.id,
                lotCode: lot.lotCode,
                lotKey,
                displayLot,
                premixLot: lot.premixLot,
                flavor: lot.flavor,
                flavorRaw: lot.flavorRaw,
                productionDate: lot.productionDate,
                mixAssemblyNote: lot.mixAssemblyNote,
                mixQuantityKg: lot.mixQuantityKg,
                phJarabe: lot.phJarabe,
                bxJarabe: lot.bxJarabe,
                conductividad: lot.conductividad,
                bxPerla: lot.bxPerla,
                tempCoccion: lot.tempCoccion,
                tempChiller: lot.tempChiller,
                productionStartAt: lot.productionStartAt,
                productionEndAt: lot.productionEndAt,
                productionDurationMin: lot.productionDurationMin,
                productionDurationRaw: lot.productionDurationRaw,
                protectionLotCode: lot.protectionLotCode,
                protectionQuantityKg: lot.protectionQuantityKg,
                protectionPh: lot.protectionPh,
                protectionBx: lot.protectionBx,
                protectionAssemblyNote: lot.protectionAssemblyNote,
                alginateLotCode: lot.alginateLotCode,
                pearlGrowthCheckRaw: lot.pearlGrowthCheckRaw,
                pearlGrowthConfirmed: lot.pearlGrowthConfirmed,
                pearlCookTempC: lot.pearlCookTempC,
                pearlCookTimeSec: lot.pearlCookTimeSec,
                protectionAdded3400,
                protectionAdded1150,
                protectionAdded350,
                protectionAddedTotal,
                damaged3400,
                damaged1150,
                damaged350,
                damagedAtProductionTotal,
                internalDamageRatePct: producedTotal > 0 ? (damagedAtProductionTotal / producedTotal) * 100 : null,
                pesoPerlas: lot.pesoPerlas,
                leader: lot.leader,
                logisticsDeliveredDate: lot.logisticsDeliveredDate,
                logisticsDeliveredTo: lot.logisticsDeliveredTo,
                createdAt: lot.createdAt,
                producedUnits: {
                    '3400g': units3400,
                    '1150g': units1150,
                    '350g': units350,
                    total: producedTotal
                },
                damagedAtProduction: {
                    '3400g': damaged3400,
                    '1150g': damaged1150,
                    '350g': damaged350,
                    total: damagedAtProductionTotal
                },
                protectionAdded: {
                    '3400g': protectionAdded3400,
                    '1150g': protectionAdded1150,
                    '350g': protectionAdded350,
                    total: protectionAddedTotal
                },
                pqr: {
                    hasReports: Boolean(pqrAgg),
                    linkMode: pqrAggByFlavor ? 'lot+flavor' : (pqrAggByLot ? 'lot' : 'none'),
                    firstReportDate: firstReportDate ? new Date(firstReportDate).toISOString() : null,
                    lastReportDate: pqrAgg?.lastReportDate ? new Date(pqrAgg.lastReportDate).toISOString() : null,
                    daysToFirstReport: (daysToFirstReport !== null && daysToFirstReport >= 0) ? daysToFirstReport : null,
                    totalTickets: pqrAgg ? pqrAgg.ticketNumbers.size : 0,
                    totalReportItems: pqrAgg?.totalReportItems || 0,
                    totalReportedUnits: pqrAgg?.totalReportedUnits || 0,
                    lotNumbersReported: pqrAgg ? Array.from(pqrAgg.lotNumbersReported).sort() : [],
                    distributors: pqrAgg ? Array.from(pqrAgg.distributors).sort() : [],
                    products: pqrAgg ? Array.from(pqrAgg.products).sort() : [],
                    flavors: pqrAgg ? Array.from(pqrAgg.flavors).sort() : [],
                    byPresentation,
                    reports: pqrAgg
                        ? [...pqrAgg.reports].sort((a, b) => {
                            const da = a.reportDate ? new Date(a.reportDate).getTime() : 0;
                            const db = b.reportDate ? new Date(b.reportDate).getTime() : 0;
                            return db - da;
                        })
                        : [],
                    severity: (pqrAgg?.totalReportedUnits || 0) >= 10
                        ? 'recall'
                        : (pqrAgg?.totalReportItems || 0) >= 3
                            ? 'critical'
                            : (pqrAgg?.totalReportItems || 0) >= 1
                                ? 'warning'
                                : 'none'
                }
            };
        });

        const lotsWithPqr = rows.filter(r => r.pqr.hasReports).length;
        const totalProducedUnits = rows.reduce((s, r) => s + (r.producedUnits.total || 0), 0);
        const totalReportedUnits = rows.reduce((s, r) => s + (r.pqr.totalReportedUnits || 0), 0);

        const unmatchedPqrLots = Array.from(unmatchedPqrByLot.values())
            .map(item => ({
                lotNumberReported: item.lotNumberReported,
                totalReportItems: item.totalReportItems,
                totalReportedUnits: item.totalReportedUnits,
                totalTickets: item.ticketNumbers.size,
                firstReportDate: item.firstReportDate ? item.firstReportDate.toISOString() : null,
                reports: item.reports.sort((a, b) => {
                    const da = a.reportDate ? new Date(a.reportDate).getTime() : 0;
                    const db = b.reportDate ? new Date(b.reportDate).getTime() : 0;
                    return db - da;
                })
            }))
            .sort((a, b) => b.totalReportedUnits - a.totalReportedUnits);

        const patternAnalysis = detectDamagePatterns(rows);

        res.json({
            summary: {
                totalProductionLots: rows.length,
                lotsWithPqr,
                lotsWithoutPqr: rows.length - lotsWithPqr,
                recallLots: rows.filter(r => r.pqr.severity === 'recall').length,
                totalProducedUnits,
                totalReportedUnits
            },
            rows,
            unmatchedPqrLots,
            damagePatterns: {
                method: patternAnalysis.method,
                baseline: patternAnalysis.baseline,
                byFlavor: patternAnalysis.byFlavor,
                byShift: patternAnalysis.byShift,
                byPresentation: patternAnalysis.byPresentation,
                interactionPatterns: patternAnalysis.interactionPatterns || {},
                byDaysToFirstReport: patternAnalysis.byDaysToFirstReport,
                numericSignals: patternAnalysis.numericSignals
            },
            predictiveRisk: {
                probableUnreportedLots: patternAnalysis.probableUnreportedLots,
                model: patternAnalysis.predictiveModel || null
            },
            dataQuality: {
                metrics: patternAnalysis.dataQuality
            }
        });
    } catch (error) {
        console.error('Advanced lot validation error:', error);
        res.status(500).json({ error: 'Error al obtener validación avanzada de lotes' });
    }
};
