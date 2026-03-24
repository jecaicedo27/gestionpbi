export const BUCKET_ORDER = [
    'nuevo_riesgo',
    'activo_recurrente',
    'vigilancia',
    'enfriando',
    'sin_reporte_reciente',
    'sin_datos'
];

export const BUCKET_META = {
    nuevo_riesgo: {
        label: 'Nuevos en riesgo',
        color: '#7c3aed',
        cardClass: 'border-violet-200 bg-violet-50 text-violet-700'
    },
    activo_recurrente: {
        label: 'Siguen dañándose',
        color: '#dc2626',
        cardClass: 'border-red-200 bg-red-50 text-red-700'
    },
    vigilancia: {
        label: 'En vigilancia',
        color: '#f59e0b',
        cardClass: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    enfriando: {
        label: 'En enfriamiento',
        color: '#06b6d4',
        cardClass: 'border-cyan-200 bg-cyan-50 text-cyan-700'
    },
    sin_reporte_reciente: {
        label: 'Sin reporte reciente',
        color: '#10b981',
        cardClass: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    },
    sin_datos: {
        label: 'Sin datos',
        color: '#94a3b8',
        cardClass: 'border-slate-200 bg-slate-50 text-slate-700'
    }
};

export const PRESSURE_META = {
    alta: {
        label: 'Presión alta',
        className: 'border-red-200 bg-red-50 text-red-700'
    },
    media: {
        label: 'Presión media',
        className: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    baja: {
        label: 'Presión baja',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }
};

export const QUALITY_META = {
    alta: {
        label: 'Calidad analítica alta',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    },
    media: {
        label: 'Calidad analítica media',
        className: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    baja: {
        label: 'Calidad analítica baja',
        className: 'border-slate-200 bg-slate-50 text-slate-700'
    }
};

export const PREDICTION_READINESS_META = {
    alta: {
        label: 'Readiness alto',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    },
    media: {
        label: 'Readiness medio',
        className: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    baja: {
        label: 'Readiness bajo',
        className: 'border-slate-200 bg-slate-50 text-slate-700'
    }
};

export const toUnitsNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const formatShortList = (values) => {
    if (!Array.isArray(values) || values.length === 0) return 'Sin sabor';
    if (values.length <= 2) return values.join(', ');
    return `${values.slice(0, 2).join(', ')} +${values.length - 2}`;
};

export const resolveBucketMeta = (bucketKey) => BUCKET_META[bucketKey] || BUCKET_META.sin_datos;

export const resolvePredictionReadinessMeta = (level) => (
    PREDICTION_READINESS_META[level] || PREDICTION_READINESS_META.baja
);

export const resolvePredictionModeLabel = (predictionModel) => {
    if (predictionModel?.methodologyLabel) return predictionModel.methodologyLabel;
    return predictionModel?.trained
        ? 'Modelo supervisado + evidencia temporal'
        : 'Motor de evidencia temporal';
};

export const getSeverityBadgeClass = (severity) => {
    if (severity === 'recall') return 'bg-red-600 text-white';
    if (severity === 'critical') return 'bg-red-100 text-red-700';
    if (severity === 'warning') return 'bg-amber-100 text-amber-700';
    if (severity === 'review') return 'bg-sky-100 text-sky-700';
    return 'bg-slate-100 text-slate-600';
};
