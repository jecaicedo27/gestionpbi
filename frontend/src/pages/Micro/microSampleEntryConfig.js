export const FEATURED_PARAMETER_CODES = ['LEVADURAS', 'COLIFORMES_TOTALES'];

export const LAB_OPTIONS = [
    { value: 'Biotrends', label: 'Biotrends Laboratorios' },
    { value: 'Confía Control', label: 'Confía Control S.A.S' },
    { value: 'UniNacional', label: 'Universidad Nacional' },
    { value: 'Otro', label: 'Otro' }
];

export const hasResultData = (result) => (
    result.value !== ''
    || result.valueText !== ''
    || result.isDetected !== null
);

export const sortMicroParameters = (parameters) => {
    const featuredPriority = new Map(FEATURED_PARAMETER_CODES.map((code, index) => [code, index]));

    return [...parameters].sort((left, right) => {
        const leftPriority = featuredPriority.has(left.code) ? featuredPriority.get(left.code) : 999;
        const rightPriority = featuredPriority.has(right.code) ? featuredPriority.get(right.code) : 999;

        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
        return String(left.name || '').localeCompare(String(right.name || ''));
    });
};

export const getInitialAdditionalSelection = (results) => results
    .filter(result => !FEATURED_PARAMETER_CODES.includes(result.parameterCode) && hasResultData(result))
    .map(result => result.parameterId);

export const formatFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return 'Sin dato';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getAttachmentKindMeta = (attachment) => {
    switch (attachment.category) {
        case 'LAB_REPORT':
            return {
                label: 'Informe',
                tone: 'bg-blue-50 text-blue-700 border-blue-200'
            };
        case 'PHOTO':
            return {
                label: 'Foto',
                tone: 'bg-amber-50 text-amber-700 border-amber-200'
            };
        case 'VIDEO':
            return {
                label: 'Video',
                tone: 'bg-sky-50 text-sky-700 border-sky-200'
            };
        default:
            return {
                label: 'Documento',
                tone: 'bg-slate-50 text-slate-700 border-slate-200'
            };
    }
};

export const normalizeExistingAttachments = (sample) => {
    if (Array.isArray(sample.attachments) && sample.attachments.length > 0) {
        return sample.attachments;
    }

    if (!sample.reportUrl) return [];

    const fallbackName = sample.reportUrl.split('/').pop() || 'informe.pdf';

    return [{
        id: `legacy:${sample.reportUrl}`,
        url: sample.reportUrl,
        category: 'LAB_REPORT',
        originalName: fallbackName,
        storedName: fallbackName,
        mimeType: 'application/pdf',
        sizeBytes: null,
        isLegacyFallback: true
    }];
};
