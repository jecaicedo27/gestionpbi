const MICRO_WORKFLOW_TYPES = ['EXTERNAL', 'INTERNAL'];
const MICRO_WORK_CONTEXTS = ['PRODUCCION', 'LAVADO', 'LIBERACION'];
const MICRO_SHIFTS = ['MADRUGADA', 'MANANA', 'TARDE', 'NOCHE'];
const MICRO_LABORATORY_PROFILES = ['PRODUCTO', 'AMBIENTE', 'SUPERFICIE', 'AGUA', 'LIBERACION'];
const MICRO_SAMPLE_ENTITY_TYPES = ['ALGINATO', 'COMPUESTO', 'ESFERAS', 'SIROPE', 'AGUA', 'SUPERFICIE', 'AMBIENTE', 'MATERIA_PRIMA', 'PRODUCTO_TERMINADO', 'TOTE', 'OTRO'];
const MICRO_SCHEDULE_FINAL_STATUSES = ['CANCELLED', 'NOT_PERFORMED', 'RESCHEDULED', 'COMPLETED', 'CLOSED', 'REJECTED'];
const MICRO_SCHEDULE_MODES = ['SINGLE', 'RANGE'];
const MICRO_INTERNAL_REVIEW_DECISIONS = ['APPROVED', 'REQUIRES_ACTION'];
const MICRO_INTERNAL_RELEASE_DECISIONS = ['LIBERAR', 'RETENER', 'RE_MUESTREAR', 'LIMPIEZA', 'INVESTIGAR', 'ESCALAR'];

const SHIFT_DEFAULT_TIME = {
    MADRUGADA: '04:00',
    MANANA: '06:00',
    TARDE: '14:00',
    NOCHE: '22:00'
};

const EXTERNAL_DEFAULT_LAB = 'Biotrends Laboratorios';
const INTERNAL_DEFAULT_LAB = 'Laboratorio Interno Planta';

const MICRO_ENTITY_LABELS = {
    ALGINATO: 'Alginato',
    COMPUESTO: 'Compuesto',
    ESFERAS: 'Esferas',
    SIROPE: 'Sirope / Jarabe',
    AGUA: 'Agua',
    SUPERFICIE: 'Superficie',
    AMBIENTE: 'Ambiente',
    MATERIA_PRIMA: 'Materia prima',
    PRODUCTO_TERMINADO: 'Producto fabricado',
    TOTE: 'Tote / Recipiente',
    OTRO: 'Otro'
};

const SAMPLE_ENTITY_KEYWORD_MAP = {
    ALGINATO: ['ALGINATO', 'ALGIN'],
    COMPUESTO: ['COMPUESTO'],
    ESFERAS: ['ESFERAS', 'ESFERIFICACION'],
    SIROPE: ['SIROPE', 'JARABE', 'BASE SIROPE'],
    AGUA: ['AGUA'],
    SUPERFICIE: ['SUPERFICIE', 'TUBERIA', 'TANQUE', 'MARMITA', 'MESA', 'LINEA', 'TOTE'],
    AMBIENTE: ['AMBIENTE', 'AREA'],
    MATERIA_PRIMA: ['GLUCOSA', 'AZUCAR', 'GOMA', 'GOMAS', 'MATERIA PRIMA'],
    PRODUCTO_TERMINADO: ['LIQUIPOPS', 'PRODUCTO TERMINADO'],
    TOTE: ['TOTE', 'RECIPIENTE']
};

const WORK_CONTEXT_ALIAS_MAP = {
    PRODUCCION: 'PRODUCCION',
    PRODUCCIÓN: 'PRODUCCION',
    LAVADO: 'LAVADO',
    LIBERACION: 'LIBERACION',
    LIBERACIÓN: 'LIBERACION'
};

const normalizeJsonArray = (value, fallback = []) => {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map(item => `${item}`.trim()).filter(Boolean)));
    }

    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return Array.from(new Set(parsed.map(item => `${item}`.trim()).filter(Boolean)));
            }
        } catch (error) {
            return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)));
        }
    }

    return [...fallback];
};

const normalizeJsonObject = (value, fieldName = 'payload') => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            // Ignore and fall through to validation error below.
        }
    }

    const error = new Error(`Formato inválido para ${fieldName}`);
    error.statusCode = 400;
    throw error;
};

const buildConfiguredOptions = ({
    configuredValues,
    fallbackValues = [],
    defaultValue = null,
    normalizeItem = (item) => item,
    isAllowed = () => true
}) => {
    const normalizeCollection = (values = []) => Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(item => normalizeItem(item))
            .filter(item => item && isAllowed(item))
    ));

    const normalizedConfigured = normalizeCollection(normalizeJsonArray(configuredValues));
    const normalizedFallback = normalizeCollection(fallbackValues);
    const normalizedDefaultValue = normalizeItem(defaultValue);
    const baseValues = normalizedConfigured.length > 0 ? normalizedConfigured : normalizedFallback;

    return Array.from(new Set([
        ...baseValues,
        normalizedDefaultValue && isAllowed(normalizedDefaultValue) ? normalizedDefaultValue : null
    ].filter(Boolean)));
};

const normalizeOptionalText = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const trimmed = `${value}`.trim();
    return trimmed || null;
};

const normalizeOptionalNumber = (value, fieldName = 'el valor') => {
    if (value === undefined) return undefined;

    const normalizedText = normalizeOptionalText(value);
    if (normalizedText === null) return null;

    const parsed = Number(normalizedText);
    if (Number.isNaN(parsed)) {
        const error = new Error(`Debe indicar un número válido para ${fieldName}`);
        error.statusCode = 400;
        throw error;
    }

    return parsed;
};

const normalizeBooleanValue = (value, fallback = undefined) => {
    if (value === undefined) return fallback;
    if (value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = `${value}`.trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return fallback;
};

const normalizeStringCollection = (value, fieldName = 'la lista') => {
    if (value === undefined) return undefined;
    return Array.from(new Set(
        parseJsonArrayField(value, fieldName)
            .map(item => normalizeOptionalText(item))
            .filter(Boolean)
    ));
};

const sanitizeJsonValue = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (Array.isArray(value)) {
        const sanitizedItems = value
            .map(item => sanitizeJsonValue(item))
            .filter(item => item !== undefined);
        return sanitizedItems;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, nestedValue]) => [key, sanitizeJsonValue(nestedValue)])
            .filter(([, nestedValue]) => nestedValue !== undefined);
        return Object.fromEntries(entries);
    }

    if (typeof value === 'string') {
        const normalized = normalizeOptionalText(value);
        return normalized === null ? null : normalized;
    }

    return value;
};

const hasMeaningfulStructuredData = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => hasMeaningfulStructuredData(item));
    if (typeof value === 'object') return Object.values(value).some(item => hasMeaningfulStructuredData(item));
    return false;
};

const normalizeOptionalDateTime = (value, fieldName) => {
    if (value === undefined) return undefined;

    const normalized = normalizeOptionalText(value);
    if (normalized === null) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        const error = new Error(`Debe indicar una fecha válida para ${fieldName}`);
        error.statusCode = 400;
        throw error;
    }

    return parsed;
};

const normalizeWorkContextValue = (value) => {
    const normalizedText = normalizeOptionalText(value);
    if (normalizedText === undefined || normalizedText === null) return normalizedText;

    const aliasKey = normalizedText
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .toUpperCase();

    return WORK_CONTEXT_ALIAS_MAP[aliasKey] || normalizedText;
};

const normalizeWorkContextCollection = (value, fallback = []) => {
    const merged = normalizeJsonArray(value, fallback)
        .map(item => normalizeWorkContextValue(item))
        .filter(Boolean);

    return Array.from(new Set(merged));
};

const normalizeRequestedParameterIds = (value) => (
    Array.from(new Set(
        parseJsonArrayField(value, 'requestedParameterIds')
            .map(item => `${item}`.trim())
            .filter(Boolean)
    ))
);

const SAMPLE_ENTITY_STOP_WORDS = new Set([
    'DE',
    'DEL',
    'LA',
    'EL',
    'LOS',
    'LAS',
    'Y',
    'POST',
    'PRE',
    'INICIO',
    'SALIDA',
    'DIARIO',
    'LOTE',
    'TOMA',
    'PUNTO',
    'MUESTRA',
    'MUESTREO'
]);

const tokenizeEntityHints = (...values) => Array.from(new Set(
    values
        .filter(Boolean)
        .flatMap((value) => `${value}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .split(/[^A-Z0-9]+/g)
            .filter(token => token.length >= 3 && !SAMPLE_ENTITY_STOP_WORDS.has(token)))
));

const inferSampleEntityType = (point = null, laboratoryProfile = null) => {
    const profile = normalizeOptionalText(laboratoryProfile);
    const pointText = `${point?.code || ''} ${point?.name || ''} ${point?.processArea || ''} ${point?.zoneName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (profile === 'AGUA' || pointText.includes('AGUA')) return 'AGUA';
    if (pointText.includes('ALGIN')) return 'ALGINATO';
    if (pointText.includes('COMPUEST')) return 'COMPUESTO';
    if (pointText.includes('ESFER')) return 'ESFERAS';
    if (pointText.includes('SIROPE') || pointText.includes('JARABE')) return 'SIROPE';
    if (
        point?.isEnvironmental
        && /(SUPERF|TUBER|MARMITA|TANQUE|LINEA|MESA|EQUIPO)/.test(pointText)
    ) {
        return 'SUPERFICIE';
    }
    if (point?.isEnvironmental || profile === 'AMBIENTE' || profile === 'SUPERFICIE') return point?.isEnvironmental ? 'AMBIENTE' : profile;
    if (
        pointText.includes('GLUCOSA')
        || pointText.includes('AZUCAR')
        || pointText.includes('GOMA')
        || pointText.includes('MATERIAS PRIMAS')
    ) {
        return 'MATERIA_PRIMA';
    }
    if (profile === 'PRODUCTO' || profile === 'LIBERACION') return 'PRODUCTO_TERMINADO';
    return 'OTRO';
};

const buildSampleEntityContext = ({ point = null, laboratoryProfile = null, productionContextData = null } = {}) => {
    const normalizedContextData = productionContextData && typeof productionContextData === 'object' && !Array.isArray(productionContextData)
        ? productionContextData
        : {};
    const requestedEntityType = normalizeOptionalText(normalizedContextData.entityType)?.toUpperCase();
    const entityType = MICRO_SAMPLE_ENTITY_TYPES.includes(requestedEntityType)
        ? requestedEntityType
        : inferSampleEntityType(point, laboratoryProfile);
    const baseKeywords = SAMPLE_ENTITY_KEYWORD_MAP[entityType] || [];
    const pointKeywords = tokenizeEntityHints(point?.code, point?.name, point?.processArea, point?.zoneName);
    const contextKeywords = normalizeJsonArray(normalizedContextData.keywords || []);
    const keywords = Array.from(new Set([...baseKeywords, ...pointKeywords, ...contextKeywords]));

    return {
        entityType,
        entityLabel: MICRO_ENTITY_LABELS[entityType] || entityType,
        keywords
    };
};

const normalizeSampleEntityTypeValue = (value) => {
    const normalized = normalizeOptionalText(value)?.toUpperCase() || null;
    return MICRO_SAMPLE_ENTITY_TYPES.includes(normalized) ? normalized : null;
};

const validateInternalSampleFieldPayload = (sanitized = {}, entityType = 'OTRO', sampleLabel = 'la muestra') => {
    const requiredFieldErrors = [];

    if (entityType === 'AGUA' && !normalizeOptionalText(sanitized?.waterPoint || sanitized?.waterSource || sanitized?.referenceName)) {
        requiredFieldErrors.push(`Debe indicar el punto o fuente del agua para ${sampleLabel}`);
    }
    if (entityType === 'SUPERFICIE' && !normalizeOptionalText(sanitized?.surfaceName || sanitized?.equipmentReference || sanitized?.referenceName)) {
        requiredFieldErrors.push(`Debe indicar la superficie o equipo muestreado para ${sampleLabel}`);
    }
    if (entityType === 'AMBIENTE' && !normalizeOptionalText(sanitized?.ambientArea || sanitized?.referenceName)) {
        requiredFieldErrors.push(`Debe indicar el área o ambiente muestreado para ${sampleLabel}`);
    }
    if (
        ['ALGINATO', 'COMPUESTO', 'ESFERAS', 'SIROPE', 'MATERIA_PRIMA', 'PRODUCTO_TERMINADO', 'TOTE', 'OTRO'].includes(entityType)
        && !normalizeOptionalText(sanitized?.referenceName || sanitized?.productReference || sanitized?.processStage)
    ) {
        requiredFieldErrors.push(`Debe indicar una referencia operativa para ${sampleLabel}`);
    }

    if (requiredFieldErrors.length > 0) {
        const error = new Error(requiredFieldErrors.join('. '));
        error.statusCode = 400;
        throw error;
    }
};

const normalizeInternalAttachmentAssignments = (value = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .map(([attachmentId, unitId]) => [normalizeOptionalText(attachmentId), normalizeOptionalText(unitId)])
            .filter(([attachmentId, unitId]) => attachmentId && unitId)
    );
};

const normalizeInternalSampleUnit = (value = {}, fallbackEntityType = 'OTRO', index = 0) => {
    const rawUnit = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const entityType = normalizeSampleEntityTypeValue(rawUnit.entityType) || normalizeSampleEntityTypeValue(fallbackEntityType) || 'OTRO';
    const linkedParameterIds = Array.from(new Set(
        (Array.isArray(rawUnit.linkedParameterIds) ? rawUnit.linkedParameterIds : [])
            .map(parameterId => normalizeOptionalText(parameterId))
            .filter(Boolean)
    ));
    const fields = sanitizeJsonValue(
        rawUnit.fields && typeof rawUnit.fields === 'object' && !Array.isArray(rawUnit.fields)
            ? rawUnit.fields
            : {}
    ) || {};

    validateInternalSampleFieldPayload(fields, entityType, `la muestra ${index + 1}`);

    return {
        id: normalizeOptionalText(rawUnit.id) || `sample-unit-${index + 1}`,
        label: normalizeOptionalText(rawUnit.label) || `Muestra ${index + 1}`,
        sampleIdentifier: normalizeOptionalText(rawUnit.sampleIdentifier),
        analysisLabel: normalizeOptionalText(rawUnit.analysisLabel),
        purpose: normalizeOptionalText(rawUnit.purpose),
        linkedParameterIds,
        entityType,
        fields,
        collectionData: sanitizeJsonValue({
            collectedAt: normalizeOptionalText(rawUnit.collectionData?.collectedAt),
            collectorName: normalizeOptionalText(rawUnit.collectionData?.collectorName),
            collectionMethod: normalizeOptionalText(rawUnit.collectionData?.collectionMethod),
            collectionNotes: normalizeOptionalText(rawUnit.collectionData?.collectionNotes),
            inoculationNotes: normalizeOptionalText(rawUnit.collectionData?.inoculationNotes),
            traceabilityNotes: normalizeOptionalText(rawUnit.collectionData?.traceabilityNotes)
        }) || {}
    };
};

const normalizeInternalSampleTypeData = (value, entityType = 'OTRO') => {
    if (value === undefined) return undefined;

    const raw = normalizeJsonObject(value, 'sampleTypeData');
    if (raw === null) return null;

    const normalizedEntityType = normalizeSampleEntityTypeValue(entityType) || 'OTRO';

    if (Array.isArray(raw.sampleUnits) && raw.sampleUnits.length > 0) {
        const sampleUnits = raw.sampleUnits.map((unit, index) => (
            normalizeInternalSampleUnit(unit, normalizedEntityType, index)
        ));
        const requestedActiveUnitId = normalizeOptionalText(raw.activeSampleUnitId);
        const activeSampleUnitId = sampleUnits.some(unit => unit.id === requestedActiveUnitId)
            ? requestedActiveUnitId
            : sampleUnits[0]?.id || null;

        return sanitizeJsonValue({
            sampleUnits,
            attachmentAssignments: normalizeInternalAttachmentAssignments(raw.attachmentAssignments),
            activeSampleUnitId
        });
    }

    const sanitized = sanitizeJsonValue(raw);
    validateInternalSampleFieldPayload(sanitized, normalizedEntityType, 'la muestra');

    return sanitized;
};

const normalizeInternalAcceptanceData = (value, actor = {}) => {
    if (value === undefined) return undefined;

    const raw = normalizeJsonObject(value, 'acceptanceData');
    if (raw === null) return null;

    const accepted = normalizeBooleanValue(raw.accepted, undefined);
    if (accepted === undefined || accepted === null) {
        const error = new Error('Debe indicar si la muestra fue aceptada o rechazada al ingreso del laboratorio');
        error.statusCode = 400;
        throw error;
    }

    const receivedAt = normalizeOptionalDateTime(raw.receivedAt || new Date().toISOString(), 'la recepción de la muestra');
    const sampleTemperatureC = normalizeOptionalNumber(raw.sampleTemperatureC, 'la temperatura de recepción');
    const sampleQuantity = normalizeOptionalNumber(raw.sampleQuantity, 'la cantidad recibida');
    const rejectionReason = normalizeOptionalText(raw.rejectionReason);

    if (!accepted && !rejectionReason) {
        const error = new Error('Debe indicar el motivo de rechazo de la muestra');
        error.statusCode = 400;
        throw error;
    }

    return {
        receivedAt: receivedAt ? receivedAt.toISOString() : null,
        accepted,
        containerIntegrity: normalizeOptionalText(raw.containerIntegrity),
        sampleCondition: normalizeOptionalText(raw.sampleCondition),
        transportCondition: normalizeOptionalText(raw.transportCondition),
        chainOfCustodyRef: normalizeOptionalText(raw.chainOfCustodyRef),
        sampleTemperatureC,
        sampleQuantity,
        quantityUnit: normalizeOptionalText(raw.quantityUnit),
        conditionNotes: normalizeOptionalText(raw.conditionNotes),
        rejectionReason,
        receivedBy: {
            id: normalizeOptionalText(actor.userId),
            name: normalizeOptionalText(actor.userName)
        }
    };
};

const normalizeInternalAnalysisExecutionData = (value, actor = {}) => {
    if (value === undefined) return undefined;

    const raw = normalizeJsonObject(value, 'analysisExecutionData');
    if (raw === null) return null;

    const incubationStartedAt = normalizeOptionalDateTime(raw.incubationStartedAt, 'el inicio de incubación');
    const incubationEndedAt = normalizeOptionalDateTime(raw.incubationEndedAt, 'el fin de incubación');

    if (incubationStartedAt && incubationEndedAt && incubationEndedAt < incubationStartedAt) {
        const error = new Error('La fecha final de incubación no puede ser anterior al inicio de incubación');
        error.statusCode = 400;
        throw error;
    }

    return {
        methodCode: normalizeOptionalText(raw.methodCode),
        methodVersion: normalizeOptionalText(raw.methodVersion),
        analystName: normalizeOptionalText(raw.analystName) || normalizeOptionalText(actor.userName),
        equipmentName: normalizeOptionalText(raw.equipmentName),
        incubatorName: normalizeOptionalText(raw.incubatorName),
        mediaLot: normalizeOptionalText(raw.mediaLot),
        diluentLot: normalizeOptionalText(raw.diluentLot),
        plateBatch: normalizeOptionalText(raw.plateBatch),
        positiveControl: normalizeOptionalText(raw.positiveControl),
        negativeControl: normalizeOptionalText(raw.negativeControl),
        duplicatePerformed: normalizeBooleanValue(raw.duplicatePerformed, null),
        acceptanceCriteria: normalizeOptionalText(raw.acceptanceCriteria),
        incubationStartedAt: incubationStartedAt ? incubationStartedAt.toISOString() : null,
        incubationEndedAt: incubationEndedAt ? incubationEndedAt.toISOString() : null,
        executionNotes: normalizeOptionalText(raw.executionNotes),
        normativeRefs: normalizeStringCollection(raw.normativeRefs, 'normativeRefs') || []
    };
};

const normalizeInternalDeviationData = (value) => {
    if (value === undefined) return undefined;

    const raw = normalizeJsonObject(value, 'deviationData');
    if (raw === null) return null;

    const hasDeviation = normalizeBooleanValue(raw.hasDeviation, undefined);
    const sanitized = {
        hasDeviation: hasDeviation === undefined ? false : hasDeviation,
        category: normalizeOptionalText(raw.category),
        details: normalizeOptionalText(raw.details),
        immediateActions: normalizeOptionalText(raw.immediateActions),
        capaPlan: normalizeOptionalText(raw.capaPlan),
        productionImpact: normalizeOptionalText(raw.productionImpact),
        linkedReference: normalizeOptionalText(raw.linkedReference),
        requiresHold: normalizeBooleanValue(raw.requiresHold, null)
    };

    if (sanitized.hasDeviation && !sanitized.details) {
        const error = new Error('Debe documentar el detalle del desvío o hallazgo');
        error.statusCode = 400;
        throw error;
    }

    return sanitized;
};

const normalizeInternalTechnicalReviewData = (value, actor = {}) => {
    if (value === undefined) return undefined;

    const raw = normalizeJsonObject(value, 'technicalReviewData');
    if (raw === null) return null;

    const reviewDecision = normalizeOptionalText(raw.reviewDecision)?.toUpperCase() || null;
    const releaseDecision = normalizeOptionalText(raw.releaseDecision)?.toUpperCase() || null;

    if (!MICRO_INTERNAL_REVIEW_DECISIONS.includes(reviewDecision)) {
        const error = new Error('Debe indicar un dictamen de revisión técnica válido');
        error.statusCode = 400;
        throw error;
    }

    if (!MICRO_INTERNAL_RELEASE_DECISIONS.includes(releaseDecision)) {
        const error = new Error('Debe indicar una decisión operativa válida para la revisión técnica');
        error.statusCode = 400;
        throw error;
    }

    const reviewedAt = normalizeOptionalDateTime(raw.reviewedAt || new Date().toISOString(), 'la revisión técnica');
    const reviewNotes = normalizeOptionalText(raw.reviewNotes);

    if (!reviewNotes) {
        const error = new Error('Debe dejar observaciones de revisión técnica');
        error.statusCode = 400;
        throw error;
    }

    return {
        reviewedAt: reviewedAt ? reviewedAt.toISOString() : null,
        reviewDecision,
        releaseDecision,
        reviewNotes,
        normativeRefs: normalizeStringCollection(raw.normativeRefs, 'normativeRefs') || [],
        reviewedBy: {
            id: normalizeOptionalText(actor.userId),
            name: normalizeOptionalText(actor.userName)
        }
    };
};

const normalizeInternalApprovalData = (value, actor = {}) => {
    const raw = value === undefined
        ? {}
        : normalizeJsonObject(value, 'approvalData') || {};

    const approvedAt = normalizeOptionalDateTime(raw.approvedAt || new Date().toISOString(), 'la aprobación final');

    return {
        approvedAt: approvedAt ? approvedAt.toISOString() : null,
        approvalNotes: normalizeOptionalText(raw.approvalNotes),
        approvedBy: {
            id: normalizeOptionalText(actor.userId),
            name: normalizeOptionalText(actor.userName)
        }
    };
};

const buildExternalWorkflowProgress = ({
    takenAt = null,
    dispatchAt = null,
    resultsReceivedAt = null,
    hasResults = false,
    isFinished = false,
    isDraft = false
} = {}) => {
    const resultsRecorded = Boolean(hasResults);
    const finished = !isDraft && Boolean(isFinished);
    const resultsReceived = !isDraft && (Boolean(resultsReceivedAt) || resultsRecorded || finished);
    const dispatched = !isDraft && (Boolean(dispatchAt) || resultsReceived || resultsRecorded || finished);
    const collected = !isDraft && (Boolean(takenAt) || dispatched || resultsReceived || resultsRecorded || finished);

    let currentStepKey = null;
    if (!collected) currentStepKey = 'SAMPLE_COLLECTION';
    else if (!dispatched) currentStepKey = 'LAB_DISPATCH';
    else if (!resultsReceived) currentStepKey = 'AWAITING_RESULTS';
    else if (!resultsRecorded) currentStepKey = 'RESULT_RECORDING';
    else if (!finished) currentStepKey = 'FINISHED';

    return {
        collected,
        dispatched,
        resultsReceived,
        resultsRecorded,
        finished,
        currentStepKey
    };
};

const buildExternalWorkflowSteps = (sample = {}) => {
    const attachments = sample.attachments || [];
    const requestedParameterIds = Array.isArray(sample.requestedParameterIds)
        ? sample.requestedParameterIds
        : normalizeJsonArray(sample.requestedParameterIds);
    const resultCount = sample.results ? sample.results.length : Number(sample.resultCount || 0);
    const hasPhotoEvidence = attachments.some(attachment => attachment.category === 'PHOTO');
    const workflowProgress = buildExternalWorkflowProgress({
        takenAt: sample.takenAt,
        dispatchAt: sample.dispatchAt,
        resultsReceivedAt: sample.resultsReceivedAt,
        hasResults: resultCount > 0,
        isFinished: ['COMPLETED', 'CLOSED', 'REPORT_READY'].includes(sample.status) || Boolean(sample.completedAt || sample.closedAt)
    });

    return [
        {
            key: 'SAMPLE_COLLECTION',
            label: 'Toma de muestras',
            status: workflowProgress.collected ? 'completed' : workflowProgress.currentStepKey === 'SAMPLE_COLLECTION' ? 'current' : 'pending',
            date: sample.takenAt || null,
            detail: hasPhotoEvidence ? `${attachments.filter(attachment => attachment.category === 'PHOTO').length} evidencia(s)` : 'Sin evidencia fotográfica'
        },
        {
            key: 'LAB_DISPATCH',
            label: 'Envío a laboratorio',
            status: workflowProgress.dispatched ? 'completed' : workflowProgress.currentStepKey === 'LAB_DISPATCH' ? 'current' : 'pending',
            date: sample.dispatchAt || null,
            detail: sample.dispatchReference || sample.dispatchObservations || null
        },
        {
            key: 'AWAITING_RESULTS',
            label: 'Espera de resultados',
            status: workflowProgress.resultsReceived ? 'completed' : workflowProgress.currentStepKey === 'AWAITING_RESULTS' ? 'current' : 'pending',
            date: sample.resultsReceivedAt || null,
            detail: requestedParameterIds.length > 0 ? `${requestedParameterIds.length} análisis solicitado(s)` : 'Sin análisis definidos'
        },
        {
            key: 'RESULT_RECORDING',
            label: 'Registro de resultados',
            status: workflowProgress.resultsRecorded ? 'completed' : workflowProgress.currentStepKey === 'RESULT_RECORDING' ? 'current' : 'pending',
            date: sample.resultsReceivedAt || sample.completedAt || null,
            detail: workflowProgress.resultsRecorded ? `${resultCount} resultado(s)` : null
        },
        {
            key: 'FINISHED',
            label: 'Fin',
            status: workflowProgress.finished ? 'completed' : workflowProgress.currentStepKey === 'FINISHED' ? 'current' : 'pending',
            date: sample.closedAt || sample.completedAt || null,
            detail: sample.reportNumber || (workflowProgress.finished && sample.reportUrl ? 'Informe disponible' : null)
        }
    ];
};

const buildInternalWorkflowSteps = (sample = {}) => {
    const requestedParameterIds = Array.isArray(sample.requestedParameterIds)
        ? sample.requestedParameterIds
        : normalizeJsonArray(sample.requestedParameterIds);
    const acceptanceData = sample.acceptanceData && typeof sample.acceptanceData === 'object' && !Array.isArray(sample.acceptanceData)
        ? sample.acceptanceData
        : null;
    const technicalReviewData = sample.technicalReviewData && typeof sample.technicalReviewData === 'object' && !Array.isArray(sample.technicalReviewData)
        ? sample.technicalReviewData
        : null;
    const approvalData = sample.approvalData && typeof sample.approvalData === 'object' && !Array.isArray(sample.approvalData)
        ? sample.approvalData
        : null;
    const internalLogCount = Array.isArray(sample.internalLogs)
        ? sample.internalLogs.length
        : Number(sample.internalLogCount || 0);
    const resultCount = Array.isArray(sample.results)
        ? sample.results.length
        : Number(sample.resultCount || 0);
    const isRejected = sample.status === 'REJECTED' || acceptanceData?.accepted === false;
    const isClosed = sample.status === 'CLOSED' || Boolean(sample.closedAt);
    const collected = Boolean(sample.takenAt || sample.startedAt) || isClosed || isRejected;
    const received = Boolean(sample.receivedAt || acceptanceData?.receivedAt) || isRejected;
    const trackingCompleted = internalLogCount > 0 || Boolean(sample.resultsCapturedAt || sample.reviewedAt || sample.closedAt);
    const finalResultsCompleted = Boolean(sample.resultsCapturedAt) || resultCount > 0 || Boolean(sample.reviewedAt || sample.closedAt);
    const technicalReviewCompleted = Boolean(sample.reviewedAt || technicalReviewData?.reviewedAt || sample.closedAt);
    const reportReady = Boolean(sample.reportUrl || sample.finalReportData || sample.reportNumber || sample.closedAt);

    let currentStepKey = null;
    if (!collected) currentStepKey = 'INTERNAL_COLLECTION';
    else if (!received) currentStepKey = 'INTERNAL_RECEPTION';
    else if (isRejected) currentStepKey = null;
    else if (!trackingCompleted) currentStepKey = 'INTERNAL_FOLLOW_UP';
    else if (!finalResultsCompleted) currentStepKey = 'INTERNAL_FINAL_RESULTS';
    else if (!technicalReviewCompleted) currentStepKey = 'INTERNAL_TECHNICAL_REVIEW';
    else if (!reportReady) currentStepKey = 'INTERNAL_APPROVAL';

    const latestLogDate = Array.isArray(sample.internalLogs) && sample.internalLogs.length > 0
        ? sample.internalLogs[sample.internalLogs.length - 1].logDate
        : null;

    return [
        {
            key: 'INTERNAL_COLLECTION',
            label: 'Toma interna',
            status: collected ? 'completed' : currentStepKey === 'INTERNAL_COLLECTION' ? 'current' : 'pending',
            date: sample.takenAt || sample.startedAt || null,
            detail: sample.sampleNumber || (collected ? 'Caso interno registrado' : 'Pendiente por iniciar')
        },
        {
            key: 'INTERNAL_RECEPTION',
            label: 'Recepcion y aceptacion',
            status: received ? 'completed' : currentStepKey === 'INTERNAL_RECEPTION' ? 'current' : 'pending',
            date: sample.receivedAt || acceptanceData?.receivedAt || null,
            detail: isRejected
                ? `Muestra rechazada${acceptanceData?.rejectionReason ? `: ${acceptanceData.rejectionReason}` : ''}`
                : received
                    ? 'Muestra aceptada en laboratorio'
                    : 'Pendiente por recepcionar'
        },
        {
            key: 'INTERNAL_FOLLOW_UP',
            label: 'Seguimiento e incubacion',
            status: trackingCompleted ? 'completed' : currentStepKey === 'INTERNAL_FOLLOW_UP' ? 'current' : 'pending',
            date: latestLogDate || null,
            detail: internalLogCount > 0
                ? `${internalLogCount} bitacora(s) registrada(s)`
                : 'Sin bitacoras registradas'
        },
        {
            key: 'INTERNAL_FINAL_RESULTS',
            label: 'Resultados finales',
            status: finalResultsCompleted ? 'completed' : currentStepKey === 'INTERNAL_FINAL_RESULTS' ? 'current' : 'pending',
            date: sample.resultsCapturedAt || (finalResultsCompleted ? (sample.completedAt || sample.closedAt || latestLogDate || null) : null),
            detail: resultCount > 0
                ? `${resultCount} resultado(s) final(es)`
                : requestedParameterIds.length > 0
                    ? `${requestedParameterIds.length} analisis objetivo`
                    : 'Sin analisis definidos'
        },
        {
            key: 'INTERNAL_TECHNICAL_REVIEW',
            label: 'Revision tecnica',
            status: technicalReviewCompleted ? 'completed' : currentStepKey === 'INTERNAL_TECHNICAL_REVIEW' ? 'current' : 'pending',
            date: sample.reviewedAt || technicalReviewData?.reviewedAt || null,
            detail: technicalReviewCompleted
                ? `${technicalReviewData?.reviewDecision === 'APPROVED' ? 'Dictamen aprobado' : 'Revision registrada'}`
                : 'Pendiente por revisar'
        },
        {
            key: 'INTERNAL_APPROVAL',
            label: 'Aprobacion y cierre',
            status: reportReady ? 'completed' : currentStepKey === 'INTERNAL_APPROVAL' ? 'current' : 'pending',
            date: sample.closedAt || sample.completedAt || null,
            detail: sample.reportNumber
                || approvalData?.approvedBy?.name
                || (reportReady ? 'Reporte disponible' : 'Pendiente por aprobar y cerrar')
        }
    ];
};

const parseJsonArrayField = (value, fieldName) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error(`Formato inválido para ${fieldName}`);
            return parsed;
        } catch (error) {
            throw new Error(`Formato inválido para ${fieldName}`);
        }
    }

    return [];
};

const normalizeScheduleMode = (value) => (
    value === 'RANGE' ? 'RANGE' : 'SINGLE'
);

const normalizeWeekdayCollection = (value, fallback = []) => {
    const rawValues = Array.isArray(value) ? value : parseJsonArrayField(value, 'selectedWeekdays');
    const fallbackValues = Array.isArray(fallback) ? fallback : [];

    const normalized = (rawValues.length > 0 ? rawValues : fallbackValues)
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item >= 0 && item <= 6);

    return Array.from(new Set(normalized));
};

const parseIsoDateInput = (value, fieldName) => {
    const normalized = `${value || ''}`.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        const error = new Error(`Debe indicar una fecha válida para ${fieldName}`);
        error.statusCode = 400;
        throw error;
    }

    const parsedDate = buildUtcDateFromIso(normalized, 0, 0, 0, 0);
    if (Number.isNaN(parsedDate.getTime()) || toIsoDate(parsedDate) !== normalized) {
        const error = new Error(`Debe indicar una fecha válida para ${fieldName}`);
        error.statusCode = 400;
        throw error;
    }

    return {
        isoDate: normalized,
        date: parsedDate
    };
};

const buildScheduleDatePlan = ({
    scheduleMode,
    plannedDate,
    rangeStartDate,
    rangeEndDate,
    selectedWeekdays
} = {}) => {
    const normalizedMode = normalizeScheduleMode(scheduleMode);

    if (normalizedMode === 'SINGLE') {
        const parsed = parseIsoDateInput(plannedDate || rangeStartDate, 'la fecha planeada');
        return {
            scheduleMode: normalizedMode,
            targetDates: [parsed.isoDate],
            rangeStartDate: parsed.isoDate,
            rangeEndDate: parsed.isoDate,
            selectedWeekdays: [parsed.date.getUTCDay()]
        };
    }

    const parsedStart = parseIsoDateInput(rangeStartDate || plannedDate, 'la fecha inicial');
    const parsedEnd = parseIsoDateInput(rangeEndDate || rangeStartDate || plannedDate, 'la fecha final');

    if (parsedEnd.date < parsedStart.date) {
        const error = new Error('La fecha final debe ser igual o posterior a la fecha inicial');
        error.statusCode = 400;
        throw error;
    }

    const normalizedWeekdays = normalizeWeekdayCollection(selectedWeekdays, [parsedStart.date.getUTCDay()]);
    if (normalizedWeekdays.length === 0) {
        const error = new Error('Debe seleccionar al menos un día para la programación por rango');
        error.statusCode = 400;
        throw error;
    }

    const targetDates = [];
    for (let currentDate = new Date(parsedStart.date); currentDate <= parsedEnd.date; currentDate = addUtcDays(currentDate, 1)) {
        if (normalizedWeekdays.includes(currentDate.getUTCDay())) {
            targetDates.push(toIsoDate(currentDate));
        }
    }

    if (targetDates.length === 0) {
        const error = new Error('El rango seleccionado no genera fechas válidas con los días elegidos');
        error.statusCode = 400;
        throw error;
    }

    return {
        scheduleMode: normalizedMode,
        targetDates,
        rangeStartDate: parsedStart.isoDate,
        rangeEndDate: parsedEnd.isoDate,
        selectedWeekdays: normalizedWeekdays
    };
};

const normalizeScheduleHistory = (value) => {
    if (Array.isArray(value)) {
        return value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
    }

    if (typeof value === 'string' && value.trim()) {
        try {
            return normalizeScheduleHistory(JSON.parse(value));
        } catch (error) {
            return [];
        }
    }

    return [];
};

const buildScheduleHistoryEvent = ({
    action,
    status,
    userId = null,
    userName = null,
    reason = null,
    fromDate = null,
    toDate = null,
    fromEntryId = null,
    toEntryId = null,
    metadata = null
} = {}) => ({
    at: new Date().toISOString(),
    action: normalizeOptionalText(action) || 'UPDATED',
    status: normalizeOptionalText(status),
    userId: normalizeOptionalText(userId),
    userName: normalizeOptionalText(userName),
    reason: normalizeOptionalText(reason),
    fromDate: fromDate ? toIsoDate(fromDate) : null,
    toDate: toDate ? toIsoDate(toDate) : null,
    fromEntryId: normalizeOptionalText(fromEntryId),
    toEntryId: normalizeOptionalText(toEntryId),
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null
});

const appendScheduleHistory = (history = [], nextEvent = null) => {
    const normalizedHistory = normalizeScheduleHistory(history);
    return nextEvent ? [...normalizedHistory, nextEvent] : normalizedHistory;
};

const hasMeaningfulMicroResult = (result) => (
    result &&
    (
        result.value !== '' && result.value !== null && result.value !== undefined
        || result.valueText !== '' && result.valueText !== null && result.valueText !== undefined
        || result.isDetected !== null && result.isDetected !== undefined
    )
);

const normalizeResults = (rawResults) => parseJsonArrayField(rawResults, 'results').filter(hasMeaningfulMicroResult);

const normalizeInternalReadings = (rawReadings) => parseJsonArrayField(rawReadings, 'readings').filter(hasMeaningfulMicroResult);

const calculateCompliance = (param, result) => {
    if (!param) return null;

    if (`${param.specText || ''}`.toLowerCase().includes('ausente')) {
        return result.isDetected === null || result.isDetected === undefined ? null : !result.isDetected;
    }

    if (param.specMax !== null && result.value !== null && result.value !== undefined && result.value !== '') {
        return parseFloat(result.value) <= param.specMax;
    }

    return null;
};

const buildAttachmentCreateManyInput = (sampleId, storedFiles) => storedFiles.map(file => ({
    sampleId,
    category: file.category,
    originalName: file.originalName,
    storedName: file.storedName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    url: file.url
}));

const getPrimaryReportUrl = (storedFiles = [], existingAttachments = []) => {
    const newReport = storedFiles.find(file => file.category === 'LAB_REPORT');
    if (newReport) return newReport.url;

    const currentReport = existingAttachments.find(attachment => attachment.category === 'LAB_REPORT');
    return currentReport?.url || null;
};

const toIsoDate = (date) => {
    const baseDate = date instanceof Date ? date : new Date(date);
    return baseDate.toISOString().slice(0, 10);
};

const buildUtcDateFromIso = (isoDate, hours = 12, minutes = 0, seconds = 0, ms = 0) => {
    const [year, month, day] = `${isoDate}`.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
};

const getMondayUtc = (dateInput = new Date()) => {
    const date = dateInput instanceof Date ? new Date(dateInput) : buildUtcDateFromIso(`${dateInput}`.slice(0, 10));
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    date.setUTCHours(0, 0, 0, 0);
    return date;
};

const addUtcDays = (date, days) => {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
};

const getWeekRange = (weekStartInput) => {
    const startDate = weekStartInput
        ? buildUtcDateFromIso(`${weekStartInput}`.slice(0, 10), 0, 0, 0, 0)
        : getMondayUtc(new Date());
    const endDate = buildUtcDateFromIso(toIsoDate(addUtcDays(startDate, 6)), 23, 59, 59, 999);

    return {
        startDate,
        endDate,
        weekStart: toIsoDate(startDate),
        weekEnd: toIsoDate(endDate)
    };
};

const getDefaultLaboratoryProfiles = (point) => {
    const processArea = `${point.processArea || ''}`.toLowerCase();
    if (processArea.includes('agua')) return ['AGUA'];
    if (point.isEnvironmental) return ['AMBIENTE', 'SUPERFICIE'];
    return ['PRODUCTO', 'LIBERACION'];
};

const getDefaultWorkContexts = (point) => {
    if (point.isEnvironmental) return ['LAVADO', 'LIBERACION'];
    return ['PRODUCCION', 'LIBERACION'];
};

const getDefaultShifts = () => ['MANANA', 'TARDE'];

const parseTimeToMinutes = (value) => {
    const trimmed = `${value || ''}`.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);

    if (
        Number.isNaN(hours)
        || Number.isNaN(minutes)
        || Number.isNaN(seconds)
        || hours < 0
        || hours > 23
        || minutes < 0
        || minutes > 59
        || seconds < 0
        || seconds > 59
    ) {
        return null;
    }

    return (hours * 60) + minutes;
};

const normalizePlannedTime = (value) => {
    const totalMinutes = parseTimeToMinutes(value);
    if (totalMinutes === null) return null;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const inferShiftFromTime = (value) => {
    const totalMinutes = parseTimeToMinutes(value);
    if (totalMinutes === null) return null;

    if (totalMinutes >= (22 * 60) || totalMinutes < (4 * 60)) return 'NOCHE';
    if (totalMinutes < (6 * 60)) return 'MADRUGADA';
    if (totalMinutes < (14 * 60)) return 'MANANA';
    return 'TARDE';
};

const slugifyZoneCodeToken = (value) => {
    const normalized = `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return normalized;
};

const buildZoneCodeBase = (point = {}) => {
    const rawBase = [
        point.code,
        point.zoneName,
        point.processArea,
        point.name
    ].map(slugifyZoneCodeToken).find(Boolean) || 'PUNTO';

    return `ZMU-${rawBase.slice(0, 40)}`;
};

const generateUniqueZoneCode = async (prismaClient, point = {}, excludeId = null) => {
    const baseCode = buildZoneCodeBase(point);
    let suffix = 1;

    while (suffix < 1000) {
        const candidate = suffix === 1 ? baseCode : `${baseCode}-${String(suffix).padStart(2, '0')}`;
        const existing = await prismaClient.microSamplingPoint.findFirst({
            where: {
                zoneCode: candidate,
                id: excludeId ? { not: excludeId } : undefined
            },
            select: { id: true }
        });

        if (!existing) return candidate;
        suffix += 1;
    }

    throw new Error('No fue posible generar un código de zona único');
};

const buildPointConfig = (point) => {
    const normalizedDefaultLaboratoryProfile = MICRO_LABORATORY_PROFILES.includes(point.defaultLaboratoryProfile)
        ? point.defaultLaboratoryProfile
        : null;
    const normalizedDefaultWorkContext = normalizeWorkContextValue(point.defaultWorkContext);
    const normalizedDefaultShift = MICRO_SHIFTS.includes(point.defaultShift)
        ? point.defaultShift
        : null;
    const normalizedDefaultWorkflowType = MICRO_WORKFLOW_TYPES.includes(point.defaultWorkflowType)
        ? point.defaultWorkflowType
        : null;

    const allowedLaboratoryProfiles = buildConfiguredOptions({
        configuredValues: point.allowedLaboratoryProfiles,
        fallbackValues: getDefaultLaboratoryProfiles(point),
        defaultValue: normalizedDefaultLaboratoryProfile,
        isAllowed: profile => MICRO_LABORATORY_PROFILES.includes(profile)
    });
    const allowedWorkContexts = buildConfiguredOptions({
        configuredValues: point.allowedWorkContexts,
        fallbackValues: getDefaultWorkContexts(point),
        defaultValue: normalizedDefaultWorkContext,
        normalizeItem: normalizeWorkContextValue
    });
    const allowedShifts = buildConfiguredOptions({
        configuredValues: point.allowedShifts,
        fallbackValues: getDefaultShifts(),
        defaultValue: normalizedDefaultShift,
        isAllowed: shift => MICRO_SHIFTS.includes(shift)
    });
    const allowedWorkflowTypes = buildConfiguredOptions({
        configuredValues: point.allowedWorkflowTypes,
        fallbackValues: MICRO_WORKFLOW_TYPES,
        defaultValue: normalizedDefaultWorkflowType,
        isAllowed: type => MICRO_WORKFLOW_TYPES.includes(type)
    });

    const defaultLaboratoryProfile = allowedLaboratoryProfiles.includes(normalizedDefaultLaboratoryProfile)
        ? normalizedDefaultLaboratoryProfile
        : allowedLaboratoryProfiles[0] || 'PRODUCTO';
    const defaultWorkContext = allowedWorkContexts.includes(normalizedDefaultWorkContext)
        ? normalizedDefaultWorkContext
        : allowedWorkContexts[0] || 'PRODUCCION';
    const defaultShift = allowedShifts.includes(normalizedDefaultShift)
        ? normalizedDefaultShift
        : allowedShifts[0] || 'MANANA';
    const defaultWorkflowType = allowedWorkflowTypes.includes(normalizedDefaultWorkflowType)
        ? normalizedDefaultWorkflowType
        : allowedWorkflowTypes[0] || 'EXTERNAL';

    return {
        zoneCode: point.zoneCode || null,
        zoneName: point.zoneName || point.processArea || 'Sin zona definida',
        allowedLaboratoryProfiles,
        allowedWorkContexts,
        allowedShifts,
        allowedWorkflowTypes,
        defaultLaboratoryProfile,
        defaultWorkContext,
        defaultShift,
        defaultWorkflowType,
        defaultAssignedLab: point.defaultAssignedLab || (defaultWorkflowType === 'INTERNAL' ? INTERNAL_DEFAULT_LAB : EXTERNAL_DEFAULT_LAB)
    };
};

const normalizeSchedulePayload = (point, payload = {}) => {
    const config = buildPointConfig(point);

    const requestedPlannedTime = normalizeOptionalText(payload.plannedTime);
    const plannedTime = requestedPlannedTime
        ? normalizePlannedTime(requestedPlannedTime)
        : null;
    if (requestedPlannedTime && !plannedTime) {
        const error = new Error('La hora planeada debe tener formato HH:MM');
        error.statusCode = 400;
        throw error;
    }

    const inferredShift = plannedTime ? inferShiftFromTime(plannedTime) : null;
    const workflowType = payload.workflowType || config.defaultWorkflowType;
    const laboratoryProfile = payload.laboratoryProfile || config.defaultLaboratoryProfile;
    const manualWorkContext = normalizeWorkContextValue(payload.workContext);
    const workContext = manualWorkContext || config.defaultWorkContext;
    const shift = inferredShift || payload.shift || config.defaultShift;
    const assignedLab = payload.assignedLab
        || (workflowType === 'INTERNAL' ? INTERNAL_DEFAULT_LAB : config.defaultAssignedLab || EXTERNAL_DEFAULT_LAB);
    const zoneName = payload.zoneName || config.zoneName;
    const resolvedPlannedTime = plannedTime || SHIFT_DEFAULT_TIME[shift] || SHIFT_DEFAULT_TIME[config.defaultShift] || '06:00';

    const errors = [];

    if (!config.allowedWorkflowTypes.includes(workflowType)) {
        errors.push(`El punto ${point.code} no permite el flujo ${workflowType}`);
    }
    if (!config.allowedLaboratoryProfiles.includes(laboratoryProfile)) {
        errors.push(`El punto ${point.code} no admite el tipo ${laboratoryProfile}`);
    }
    const acceptedWorkContexts = manualWorkContext
        ? Array.from(new Set([...config.allowedWorkContexts, manualWorkContext]))
        : config.allowedWorkContexts;

    if (!acceptedWorkContexts.includes(workContext)) {
        errors.push(`El punto ${point.code} no admite el contexto ${workContext}`);
    }
    if (!config.allowedShifts.includes(shift)) {
        errors.push(`El punto ${point.code} no admite el turno ${shift}`);
    }

    if (errors.length > 0) {
        const error = new Error(errors.join('. '));
        error.statusCode = 400;
        throw error;
    }

    return {
        workflowType,
        laboratoryProfile,
        workContext,
        shift,
        assignedLab,
        zoneName,
        plannedTime: resolvedPlannedTime,
        pointConfig: {
            ...config,
            allowedWorkContexts: acceptedWorkContexts
        }
    };
};

const deriveSampleStatus = ({
    workflowType = 'EXTERNAL',
    currentStatus = 'PLANNED',
    resultCount = 0,
    hasReport = false,
    hasLabMetadata = false,
    hasDispatch = false,
    hasResultsReceipt = false,
    internalLogCount = 0,
    closedAt = null,
    finalReportData = null,
    receivedAt = null,
    resultsCapturedAt = null,
    reviewedAt = null,
    acceptanceData = null,
    technicalReviewData = null
}) => {
    if (closedAt) return 'CLOSED';

    if (workflowType === 'INTERNAL') {
        if (acceptanceData?.accepted === false || currentStatus === 'REJECTED') return 'REJECTED';
        if (reviewedAt || technicalReviewData?.reviewedAt) return 'TECHNICAL_REVIEW';
        if (resultsCapturedAt || resultCount > 0) return 'RESULTS_RECORDED';
        if (internalLogCount > 0) return 'IN_PROCESS';
        if (receivedAt || acceptanceData?.receivedAt) return 'RECEIVED';
        return currentStatus === 'PLANNED' ? 'PLANNED' : 'SAMPLED';
    }

    if (resultCount > 0) return 'COMPLETED';
    if (hasResultsReceipt || hasReport || currentStatus === 'IN_PROCESS') return 'IN_PROCESS';
    if (hasDispatch || currentStatus === 'AWAITING_RESULTS') return 'AWAITING_RESULTS';
    return currentStatus === 'PLANNED' ? 'PLANNED' : 'SAMPLED';
};

const deriveScheduleEntryStatus = (sample = null, entry = null, referenceDate = new Date()) => {
    if (sample) {
        if (sample.status === 'CLOSED') return 'CLOSED';
        if (sample.status === 'REJECTED') return 'REJECTED';
        if (sample.status === 'COMPLETED' || sample.status === 'REPORT_READY') return 'COMPLETED';
        if (['IN_PROCESS', 'SAMPLED', 'RECEIVED', 'RESULTS_RECORDED', 'TECHNICAL_REVIEW', 'AWAITING_RESULTS'].includes(sample.status)) return 'IN_PROGRESS';
        return sample.status || 'PLANNED';
    }

    const rawStatus = entry?.status || 'PLANNED';
    if (MICRO_SCHEDULE_FINAL_STATUSES.includes(rawStatus)) return rawStatus;
    if (!entry?.plannedDate) return rawStatus;

    const plannedDate = buildUtcDateFromIso(toIsoDate(entry.plannedDate), 0, 0, 0, 0);
    const today = buildUtcDateFromIso(toIsoDate(referenceDate), 0, 0, 0, 0);
    const currentWeekStart = getMondayUtc(referenceDate);

    if (plannedDate < currentWeekStart) return 'NOT_PERFORMED';
    if (plannedDate < today) return 'DELAYED';

    return rawStatus;
};

const getNextSampleNumber = async (prisma) => {
    const lastSample = await prisma.microSample.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { sampleNumber: true }
    });

    let nextSeq = 1;
    if (lastSample?.sampleNumber?.startsWith('MIC-')) {
        const seq = parseInt(lastSample.sampleNumber.split('-')[1], 10);
        if (!Number.isNaN(seq)) nextSeq = seq + 1;
    }

    return `MIC-${String(nextSeq).padStart(4, '0')}`;
};

const getNextInternalReportNumber = async (prisma) => {
    const year = new Date().getUTCFullYear();
    const prefix = `INT-${year}-`;
    const lastInternalReport = await prisma.microSample.findFirst({
        where: {
            workflowType: 'INTERNAL',
            reportNumber: {
                startsWith: prefix
            }
        },
        orderBy: { reportNumber: 'desc' },
        select: { reportNumber: true }
    });

    let nextSeq = 1;
    if (lastInternalReport?.reportNumber?.startsWith(prefix)) {
        const seq = parseInt(lastInternalReport.reportNumber.replace(prefix, ''), 10);
        if (!Number.isNaN(seq)) nextSeq = seq + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
};

const buildInternalSampleUnitIdentifier = (sampleNumber = '', index = 0) => {
    const normalizedSampleNumber = normalizeOptionalText(sampleNumber);
    if (!normalizedSampleNumber) return null;
    return `${normalizedSampleNumber}-S${String(index + 1).padStart(2, '0')}`;
};

const ensureInternalSampleTypeIdentifiers = (sampleTypeData, sampleNumber = '') => {
    const normalized = normalizeInternalSampleTypeData(sampleTypeData);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return normalized;
    if (!Array.isArray(normalized.sampleUnits) || normalized.sampleUnits.length === 0) return normalized;

    return sanitizeJsonValue({
        ...normalized,
        sampleUnits: normalized.sampleUnits.map((unit, index) => ({
            ...unit,
            sampleIdentifier: unit.sampleIdentifier || buildInternalSampleUnitIdentifier(sampleNumber, index)
        }))
    });
};

const buildSampleSummary = (sample) => {
    const results = sample.results || [];
    const internalLogs = sample.internalLogs || [];
    const attachments = sample.attachments || [];
    const requestedParameterIds = Array.isArray(sample.requestedParameterIds)
        ? sample.requestedParameterIds
        : normalizeJsonArray(sample.requestedParameterIds);
    const requestedResultsRecordedCount = requestedParameterIds.length > 0
        ? requestedParameterIds.filter(parameterId => results.some(result => result.parameterId === parameterId)).length
        : results.length;
    const missingRequestedResultsCount = Math.max(requestedParameterIds.length - requestedResultsRecordedCount, 0);
    const photoAttachmentsCount = attachments.filter(attachment => attachment?.category === 'PHOTO').length;
    const videoAttachmentsCount = attachments.filter(attachment => attachment?.category === 'VIDEO').length;
    const reportAttachmentsCount = attachments.filter(attachment => attachment?.category === 'LAB_REPORT').length;
    const documentAttachmentsCount = attachments.filter(attachment => attachment?.category === 'DOCUMENT').length;

    return {
        resultsCount: results.length,
        nonCompliantResults: results.filter(result => result.isCompliant === false).length,
        internalLogCount: internalLogs.length,
        hasReport: Boolean(sample.reportUrl),
        latestLogDate: internalLogs.length > 0 ? toIsoDate(internalLogs[internalLogs.length - 1].logDate) : null,
        requestedParametersCount: requestedParameterIds.length,
        requestedResultsRecordedCount,
        missingRequestedResultsCount,
        requestedResultsCoverageRate: requestedParameterIds.length > 0
            ? Math.round((requestedResultsRecordedCount / requestedParameterIds.length) * 100)
            : null,
        receivedAt: sample.receivedAt || sample.acceptanceData?.receivedAt || null,
        resultsCapturedAt: sample.resultsCapturedAt || null,
        reviewedAt: sample.reviewedAt || sample.technicalReviewData?.reviewedAt || null,
        hasDeviation: Boolean(sample.deviationData?.hasDeviation),
        reviewDecision: sample.technicalReviewData?.reviewDecision || null,
        photoAttachmentsCount,
        videoAttachmentsCount,
        documentAttachmentsCount,
        supportAttachmentsCount: photoAttachmentsCount + videoAttachmentsCount + documentAttachmentsCount,
        reportAttachmentsCount
    };
};

module.exports = {
    MICRO_WORKFLOW_TYPES,
    MICRO_SHIFTS,
    MICRO_LABORATORY_PROFILES,
    MICRO_WORK_CONTEXTS,
    MICRO_SAMPLE_ENTITY_TYPES,
    MICRO_SCHEDULE_FINAL_STATUSES,
    MICRO_SCHEDULE_MODES,
    MICRO_INTERNAL_REVIEW_DECISIONS,
    MICRO_INTERNAL_RELEASE_DECISIONS,
    EXTERNAL_DEFAULT_LAB,
    INTERNAL_DEFAULT_LAB,
    SHIFT_DEFAULT_TIME,
    normalizeJsonArray,
    normalizeJsonObject,
    normalizeOptionalText,
    normalizeOptionalNumber,
    normalizeOptionalDateTime,
    normalizeWorkContextValue,
    normalizeWorkContextCollection,
    normalizeRequestedParameterIds,
    normalizeInternalSampleTypeData,
    normalizeInternalAcceptanceData,
    normalizeInternalAnalysisExecutionData,
    normalizeInternalDeviationData,
    normalizeInternalTechnicalReviewData,
    normalizeInternalApprovalData,
    sanitizeJsonValue,
    hasMeaningfulStructuredData,
    normalizePlannedTime,
    inferShiftFromTime,
    inferSampleEntityType,
    buildSampleEntityContext,
    buildExternalWorkflowSteps,
    buildInternalWorkflowSteps,
    parseJsonArrayField,
    normalizeScheduleMode,
    normalizeWeekdayCollection,
    buildScheduleDatePlan,
    normalizeScheduleHistory,
    buildScheduleHistoryEvent,
    appendScheduleHistory,
    hasMeaningfulMicroResult,
    normalizeResults,
    normalizeInternalReadings,
    calculateCompliance,
    buildAttachmentCreateManyInput,
    getPrimaryReportUrl,
    toIsoDate,
    buildUtcDateFromIso,
    getMondayUtc,
    addUtcDays,
    getWeekRange,
    generateUniqueZoneCode,
    buildPointConfig,
    normalizeSchedulePayload,
    deriveSampleStatus,
    deriveScheduleEntryStatus,
    getNextSampleNumber,
    getNextInternalReportNumber,
    buildInternalSampleUnitIdentifier,
    ensureInternalSampleTypeIdentifiers,
    buildSampleSummary
};
