const API_ROOT = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');

export const resolveAssetUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_ROOT}${url}`;
};

export const isImageUrl = (url = '') => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url || '');

export const formatDate = (value, withTime = false) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    return date.toLocaleString('es-CO', withTime
        ? {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
        : {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
};

export const formatNumber = (value, decimals = 0) => {
    if (value == null || value === '') return '-';
    return Number(value).toLocaleString('es-CO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
};

export const formatQty = (value, unit = '') => {
    if (value == null || value === '') return '-';
    return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
};

export const getStatusClasses = (status = '') => {
    const map = {
        PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
        EXECUTING: 'bg-amber-100 text-amber-800 border-amber-200',
        COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        FAILED: 'bg-rose-100 text-rose-700 border-rose-200',
        CANCELLED: 'bg-rose-100 text-rose-700 border-rose-200',
        RECEIVED: 'bg-cyan-100 text-cyan-800 border-cyan-200',
        APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
        PENDING_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200',
        PENDING_BILLING: 'bg-indigo-100 text-indigo-800 border-indigo-200',
        IN_REVIEW: 'bg-violet-100 text-violet-800 border-violet-200',
        PROCESSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        REJECTED: 'bg-rose-100 text-rose-700 border-rose-200'
    };

    return map[status] || 'bg-slate-100 text-slate-700 border-slate-200';
};

export const joinNames = (values = []) => values.filter(Boolean).join(', ');

export const prettifyKey = (value = '') => String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const clampText = (value = '', fallback = '-') => {
    if (value == null || value === '') return fallback;
    return String(value);
};

export const sumEvidenceByNotes = (notes = []) => notes.reduce((total, note) => total + (note.evidence?.length || 0), 0);

const TRACEABILITY_SEGMENT_MAP = {
    FINISHED_PRODUCT: {
        key: 'FINISHED_PRODUCT',
        label: 'Producto terminado',
        helper: 'Batch orientado a salidas comerciales',
        badge: 'border-cyan-200 bg-cyan-50 text-cyan-800'
    },
    SUBPROCESS: {
        key: 'SUBPROCESS',
        label: 'Subproceso',
        helper: 'Lote intermedio o formula interna',
        badge: 'border-amber-200 bg-amber-50 text-amber-800'
    },
    UNCLASSIFIED: {
        key: 'UNCLASSIFIED',
        label: 'Sin clasificar',
        helper: 'Pendiente de señales suficientes',
        badge: 'border-slate-200 bg-slate-100 text-slate-700'
    }
};

export const getTraceabilitySegmentMeta = (segment) => {
    const key = typeof segment === 'string' ? segment : segment?.key;
    return TRACEABILITY_SEGMENT_MAP[key] || TRACEABILITY_SEGMENT_MAP.UNCLASSIFIED;
};

export const getBatchFocusLabel = (batch = {}) => {
    if (batch?.product?.name) return batch.product.name;
    if (batch?.flavor) return batch.flavor;
    if (batch?.outputTargets?.[0]?.productName) return batch.outputTargets[0].productName;
    if (batch?.outputTargets?.[0]?.product?.name) return batch.outputTargets[0].product.name;
    return 'Sin familia principal';
};
