import axios from 'axios';
import {
    LABORATORY_PROFILE_OPTIONS,
    LAB_LABELS,
    SAMPLE_ENTITY_OPTIONS,
    SHIFT_OPTIONS,
    WORK_CONTEXT_OPTIONS,
    buildInternalSampleUnitIdentifier,
    buildOptionLabel
} from './microLabConfig';

const API = import.meta.env.VITE_API_URL;

const padValue = (value) => `${value}`.padStart(2, '0');

const sanitizeText = (value) => `${value || ''}`.replace(/\s+/g, ' ').trim();

export const formatDateInputValue = (value) => {
    const normalized = sanitizeText(value);
    if (!normalized) return '';

    const directMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (directMatch) {
        return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return `${parsed.getFullYear()}-${padValue(parsed.getMonth() + 1)}-${padValue(parsed.getDate())}`;
};

export const formatTimeInputValue = (value) => {
    const normalized = sanitizeText(value);
    if (!normalized) return '';

    const timeMatch = normalized.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return `${padValue(parsed.getHours())}:${padValue(parsed.getMinutes())}`;
};

export const getCurrentDateInputValue = () => formatDateInputValue(new Date());

export const getCurrentTimeInputValue = () => formatTimeInputValue(new Date());

export const buildIsoDateTimeValue = (dateValue, timeValue = '12:00') => {
    const normalizedDate = sanitizeText(dateValue);
    if (!normalizedDate) return '';

    const normalizedTime = formatTimeInputValue(timeValue) || '12:00';
    return new Date(`${normalizedDate}T${normalizedTime}:00`).toISOString();
};

const buildLabelDownloadName = (payload = {}) => {
    const fileSeed = sanitizeText(payload.sampleIdentifier)
        || sanitizeText(payload.sampleNumber)
        || sanitizeText(payload.lotNumber)
        || sanitizeText(payload.pointCode)
        || 'micro';

    return `etiqueta_micro_${fileSeed.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'micro'}.pdf`;
};

export const buildMicroLabelPayloadFromExternalForm = ({
    sampleNumber,
    selectedPoint,
    zoneName,
    takenDate,
    takenTime,
    lotNumber,
    batchCode,
    shift,
    workContext,
    laboratoryProfile,
    lab,
    sampleDescription,
    notes
}) => ({
    sampleNumber: sampleNumber || '',
    pointCode: selectedPoint?.code || '',
    pointName: selectedPoint?.name || '',
    zoneName: zoneName || selectedPoint?.zoneName || selectedPoint?.processArea || '',
    collectionDate: takenDate || '',
    collectionTime: formatTimeInputValue(takenTime),
    lotNumber: lotNumber || '',
    batchCode: batchCode || '',
    shiftLabel: buildOptionLabel(SHIFT_OPTIONS, shift),
    workContextLabel: buildOptionLabel(WORK_CONTEXT_OPTIONS, workContext),
    laboratoryProfileLabel: buildOptionLabel(LABORATORY_PROFILE_OPTIONS, laboratoryProfile),
    workflowLabel: LAB_LABELS.EXTERNAL,
    labName: lab || '',
    sampleDescription: sampleDescription || '',
    notes: notes || ''
});

export const buildMicroLabelPayloadFromScheduleEntry = (entry = {}) => {
    const sample = entry.sample || {};
    const point = entry.point || sample.samplingPoint || {};
    const workflowType = sample.workflowType || entry.workflowType || 'EXTERNAL';

    return {
        sampleNumber: sample.sampleNumber || '',
        pointCode: point.code || '',
        pointName: point.name || '',
        zoneName: sample.zoneName || entry.zoneName || point.zoneName || point.processArea || '',
        collectionDate: sample.takenAt ? formatDateInputValue(sample.takenAt) : (entry.plannedDate || ''),
        collectionTime: sample.takenAt ? formatTimeInputValue(sample.takenAt) : formatTimeInputValue(entry.plannedTime),
        lotNumber: sample.lotNumber || '',
        batchCode: sample.batchCode || '',
        shiftLabel: buildOptionLabel(SHIFT_OPTIONS, sample.shift || entry.shift),
        workContextLabel: buildOptionLabel(WORK_CONTEXT_OPTIONS, sample.workContext || entry.workContext),
        laboratoryProfileLabel: buildOptionLabel(LABORATORY_PROFILE_OPTIONS, sample.laboratoryProfile || entry.laboratoryProfile),
        workflowLabel: LAB_LABELS[workflowType] || workflowType,
        labName: sample.lab || entry.assignedLab || '',
        sampleDescription: sample.sampleDescription || '',
        notes: sample.notes || entry.notes || ''
    };
};

export const buildMicroLabelPayloadFromInternalUnit = ({
    sample = {},
    samplingPoint = {},
    unit = {},
    unitIndex = 0,
    zoneName = '',
    workContext = '',
    shift = '',
    laboratoryProfile = ''
}) => {
    const resolvedSampleNumber = sample.sampleNumber || '';
    const resolvedIdentifier = unit.sampleIdentifier || buildInternalSampleUnitIdentifier(resolvedSampleNumber, unitIndex);
    const collectedAt = unit.collectionData?.collectedAt || sample.takenAt || '';
    const entityLabel = buildOptionLabel(SAMPLE_ENTITY_OPTIONS, unit.entityType);
    const pointLine = [samplingPoint?.code, samplingPoint?.name].filter(Boolean).join(' · ');
    const traceabilityLine = [
        resolvedSampleNumber,
        entityLabel,
        buildOptionLabel(LABORATORY_PROFILE_OPTIONS, sample.laboratoryProfile || laboratoryProfile),
        buildOptionLabel(WORK_CONTEXT_OPTIONS, sample.workContext || workContext)
    ].filter(Boolean).join(' · ');

    return {
        labelTitle: 'ETIQUETA MICRO INTERNA',
        sampleNumber: resolvedSampleNumber,
        sampleIdentifier: resolvedIdentifier,
        sampleAlias: unit.label || `Muestra ${unitIndex + 1}`,
        analysisLabel: unit.analysisLabel || '',
        traceabilityLine,
        pointCode: samplingPoint?.code || '',
        pointName: samplingPoint?.name || '',
        zoneName: zoneName || sample.zoneName || samplingPoint?.zoneName || samplingPoint?.processArea || '',
        collectionDate: formatDateInputValue(collectedAt),
        collectionTime: formatTimeInputValue(collectedAt),
        lotNumber: sample.lotNumber || '',
        batchCode: sample.batchCode || '',
        shiftLabel: buildOptionLabel(SHIFT_OPTIONS, sample.shift || shift),
        workContextLabel: buildOptionLabel(WORK_CONTEXT_OPTIONS, sample.workContext || workContext),
        laboratoryProfileLabel: buildOptionLabel(LABORATORY_PROFILE_OPTIONS, sample.laboratoryProfile || laboratoryProfile),
        workflowLabel: LAB_LABELS.INTERNAL,
        labName: unit.purpose || '',
        sampleDescription: [pointLine, sample.sampleDescription].filter(Boolean).join(' · '),
        notes: unit.purpose || sample.notes || ''
    };
};

export const downloadMicroLabelPdf = async ({ token, payload }) => {
    const response = await axios.post(`${API}/api/micro/sample-label`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
    });

    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', buildLabelDownloadName(payload));
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
    }, 1000);
};
