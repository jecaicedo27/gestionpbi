export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export const WORKFLOW_OPTIONS = [
    { value: 'EXTERNAL', label: 'Laboratorio Externo' },
    { value: 'INTERNAL', label: 'Laboratorio Interno' }
];

export const SCHEDULE_MODE_OPTIONS = [
    { value: 'SINGLE', label: 'Una vez' },
    { value: 'RANGE', label: 'Por rango' }
];

export const WEEKDAY_OPTIONS = DAY_NAMES.map((label, value) => ({
    value,
    label
}));

export const WORK_CONTEXT_OPTIONS = [
    { value: 'PRODUCCION', label: 'Producción' },
    { value: 'LAVADO', label: 'Lavado' },
    { value: 'LIBERACION', label: 'Liberación' }
];

export const WORK_CONTEXT_LABEL_MAP = WORK_CONTEXT_OPTIONS.reduce((accumulator, option) => {
    accumulator[option.value] = option.label;
    return accumulator;
}, {});

export const SHIFT_OPTIONS = [
    { value: 'MADRUGADA', label: 'Madrugada' },
    { value: 'MANANA', label: 'Mañana' },
    { value: 'TARDE', label: 'Tarde' },
    { value: 'NOCHE', label: 'Noche' }
];

export const SHIFT_DEFAULT_TIME = {
    MADRUGADA: '04:00',
    MANANA: '06:00',
    TARDE: '14:00',
    NOCHE: '22:00'
};

export const LABORATORY_PROFILE_OPTIONS = [
    { value: 'PRODUCTO', label: 'Producto' },
    { value: 'AMBIENTE', label: 'Ambiente' },
    { value: 'SUPERFICIE', label: 'Superficie' },
    { value: 'AGUA', label: 'Agua' },
    { value: 'LIBERACION', label: 'Liberación' }
];

export const SAMPLE_ENTITY_OPTIONS = [
    { value: 'ALGINATO', label: 'Alginato' },
    { value: 'COMPUESTO', label: 'Compuesto' },
    { value: 'ESFERAS', label: 'Esferas' },
    { value: 'SIROPE', label: 'Sirope / Jarabe' },
    { value: 'AGUA', label: 'Agua' },
    { value: 'SUPERFICIE', label: 'Superficie' },
    { value: 'AMBIENTE', label: 'Ambiente' },
    { value: 'MATERIA_PRIMA', label: 'Materia prima' },
    { value: 'PRODUCTO_TERMINADO', label: 'Producto fabricado' },
    { value: 'TOTE', label: 'Tote / Recipiente' },
    { value: 'OTRO', label: 'Otro' }
];

export const SAMPLE_ENTITY_META = {
    ALGINATO: {
        label: 'Alginato',
        helper: 'Prioriza lotes de alginato preparado y su estado actual en producción.',
        lotLabel: 'Lote de alginato',
        batchLabel: 'Producción relacionada',
        hideLotField: false,
        hideBatchField: false
    },
    COMPUESTO: {
        label: 'Compuesto',
        helper: 'Muestra el compuesto activo, batches vinculados y referencias fabricadas.',
        lotLabel: 'Lote de compuesto',
        batchLabel: 'Batch / tote relacionado',
        hideLotField: false,
        hideBatchField: false
    },
    ESFERAS: {
        label: 'Esferas',
        helper: 'Relaciona la toma con esferificación en curso y productos finales objetivo.',
        lotLabel: 'Lote de esferas',
        batchLabel: 'Batch / tote de esferificación',
        hideLotField: false,
        hideBatchField: false
    },
    SIROPE: {
        label: 'Sirope / Jarabe',
        helper: 'Busca lotes de sirope/jarabe y la programación activa para ese sabor.',
        lotLabel: 'Lote de sirope',
        batchLabel: 'Programación relacionada',
        hideLotField: false,
        hideBatchField: false
    },
    AGUA: {
        label: 'Agua',
        helper: 'El foco es el punto de agua y la condición operativa; el lote puede ser opcional.',
        lotLabel: 'Punto o lote de agua',
        batchLabel: 'Contexto operativo',
        hideLotField: false,
        hideBatchField: false
    },
    SUPERFICIE: {
        label: 'Superficie',
        helper: 'Usa un formulario de superficie y muestra equipos o lotes cercanos solo como referencia.',
        lotLabel: 'Equipo / referencia',
        batchLabel: 'Proceso cercano',
        hideLotField: true,
        hideBatchField: true
    },
    AMBIENTE: {
        label: 'Ambiente',
        helper: 'Enfoca la toma en el área y etapa operativa del turno.',
        lotLabel: 'Área / referencia',
        batchLabel: 'Proceso cercano',
        hideLotField: true,
        hideBatchField: true
    },
    MATERIA_PRIMA: {
        label: 'Materia prima',
        helper: 'Muestra lotes activos de la materia prima detectada en el punto.',
        lotLabel: 'Lote de materia prima',
        batchLabel: 'Producción relacionada',
        hideLotField: false,
        hideBatchField: false
    },
    PRODUCTO_TERMINADO: {
        label: 'Producto fabricado',
        helper: 'Lista los productos fabricados en el momento de la toma y sus batches fuente.',
        lotLabel: 'Lote / referencia final',
        batchLabel: 'Batch programado',
        hideLotField: false,
        hideBatchField: false
    },
    TOTE: {
        label: 'Tote / Recipiente',
        helper: 'Relaciona la muestra con totes o contenedores en producción.',
        lotLabel: 'Tote / recipiente',
        batchLabel: 'Batch asociado',
        hideLotField: false,
        hideBatchField: false
    },
    OTRO: {
        label: 'Otro',
        helper: 'Formulario flexible para puntos sin una clasificación clara.',
        lotLabel: 'Lote / referencia',
        batchLabel: 'Batch / contexto',
        hideLotField: false,
        hideBatchField: false
    }
};

export const INTERNAL_ACCEPTANCE_INTEGRITY_OPTIONS = [
    { value: 'INTEGRO', label: 'Envase íntegro' },
    { value: 'OBSERVADO', label: 'Con observaciones' },
    { value: 'COMPROMETIDO', label: 'Comprometido' }
];

export const INTERNAL_REVIEW_DECISION_OPTIONS = [
    { value: 'APPROVED', label: 'Aprobado' },
    { value: 'REQUIRES_ACTION', label: 'Requiere acciones' }
];

export const INTERNAL_RELEASE_DECISION_OPTIONS = [
    { value: 'LIBERAR', label: 'Liberar' },
    { value: 'RETENER', label: 'Retener' },
    { value: 'RE_MUESTREAR', label: 'Re-muestrear' },
    { value: 'LIMPIEZA', label: 'Ejecutar limpieza' },
    { value: 'INVESTIGAR', label: 'Investigar' },
    { value: 'ESCALAR', label: 'Escalar a calidad' }
];

export const INTERNAL_DEVIATION_CATEGORY_OPTIONS = [
    { value: 'OOS', label: 'Resultado fuera de especificación' },
    { value: 'MUESTRA', label: 'Condición de muestra' },
    { value: 'METODO', label: 'Método / ejecución' },
    { value: 'EQUIPO', label: 'Equipo / incubación' },
    { value: 'DOCUMENTAL', label: 'Documental' },
    { value: 'OTRO', label: 'Otro' }
];

export const SAMPLE_ENTITY_FIELD_MAP = {
    AGUA: [
        { name: 'waterPoint', label: 'Punto de agua', placeholder: 'Ej: Agua de ingreso EPM', required: true },
        { name: 'waterSource', label: 'Fuente / sistema', placeholder: 'Red pública, tanque, línea...' },
        { name: 'preservationMethod', label: 'Preservación', placeholder: 'Frasco estéril, refrigeración, etc.' },
        { name: 'sampleTemperatureC', label: 'Temperatura muestra (°C)', type: 'number', placeholder: 'Ej: 6.5' },
        { name: 'referenceName', label: 'Referencia operativa', placeholder: 'Línea, turno o condición operativa' }
    ],
    SUPERFICIE: [
        { name: 'surfaceName', label: 'Superficie / equipo', placeholder: 'Ej: Mesa de empaque', required: true },
        { name: 'equipmentReference', label: 'Referencia del equipo', placeholder: 'Código, lote o equipo cercano' },
        { name: 'surfaceMethod', label: 'Técnica de muestreo', placeholder: 'Hisopo, placa contacto...' },
        { name: 'sampledAreaCm2', label: 'Área muestreada (cm²)', type: 'number', placeholder: 'Ej: 100' },
        { name: 'referenceName', label: 'Etapa / contexto', placeholder: 'Post-lavado, pre-operación...' }
    ],
    AMBIENTE: [
        { name: 'ambientArea', label: 'Área / ambiente', placeholder: 'Ej: Cuarto de proceso', required: true },
        { name: 'collectionMethod', label: 'Método de captura', placeholder: 'Sedimentación, placa expuesta...' },
        { name: 'exposureMinutes', label: 'Tiempo de exposición (min)', type: 'number', placeholder: 'Ej: 15' },
        { name: 'airflowCondition', label: 'Condición del ambiente', placeholder: 'Puertas abiertas, ventilación, etc.' },
        { name: 'referenceName', label: 'Referencia operativa', placeholder: 'Turno, limpieza o etapa' }
    ],
    DEFAULT: [
        { name: 'referenceName', label: 'Referencia de la muestra', placeholder: 'Ej: Jarabe fresa en marmita 2', required: true },
        { name: 'processStage', label: 'Etapa del proceso', placeholder: 'Pre-pasteurización, liberación, etc.' },
        { name: 'productReference', label: 'Producto / sabor', placeholder: 'Ej: Liquipops Fresa' },
        { name: 'presentation', label: 'Presentación / recipiente', placeholder: 'Tote, marmita, caneca...' },
        { name: 'flavor', label: 'Sabor / variante', placeholder: 'Opcional' }
    ]
};

export const getSampleEntityFieldConfig = (entityType = 'OTRO') => (
    SAMPLE_ENTITY_FIELD_MAP[entityType] || SAMPLE_ENTITY_FIELD_MAP.DEFAULT
);

export const INTERNAL_SAMPLE_GENERAL_CONTEXT_ID = 'GENERAL';

const INTERNAL_SAMPLE_TYPE_RESERVED_KEYS = new Set([
    'sampleUnits',
    'attachmentAssignments',
    'activeSampleUnitId'
]);

const sanitizeClientStructuredValue = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value
            .map(item => sanitizeClientStructuredValue(item))
            .filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .map(([key, nestedValue]) => [key, sanitizeClientStructuredValue(nestedValue)])
                .filter(([, nestedValue]) => nestedValue !== undefined)
        );
    }
    if (typeof value === 'string') return value.trim();
    return value;
};

const buildInternalSampleUnitId = () => (
    `sample-unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

export const createDefaultInternalSampleUnit = (entityType = 'OTRO', index = 1) => ({
    id: buildInternalSampleUnitId(),
    label: `Muestra ${index}`,
    sampleIdentifier: '',
    analysisLabel: '',
    purpose: '',
    linkedParameterIds: [],
    entityType: normalizeSampleEntityType(entityType) || 'OTRO',
    fields: {},
    collectionData: {
        collectedAt: '',
        collectorName: '',
        collectionMethod: '',
        collectionNotes: '',
        inoculationNotes: '',
        traceabilityNotes: ''
    }
});

export const createDefaultInternalSampleTypeState = (entityType = 'OTRO') => {
    const firstSampleUnit = createDefaultInternalSampleUnit(entityType, 1);

    return {
        sampleUnits: [firstSampleUnit],
        attachmentAssignments: {},
        activeSampleUnitId: firstSampleUnit.id
    };
};

const normalizeAttachmentAssignmentMap = (value = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .map(([attachmentId, unitId]) => [`${attachmentId || ''}`.trim(), `${unitId || ''}`.trim()])
            .filter(([attachmentId, unitId]) => attachmentId && unitId)
    );
};

const normalizeInternalSampleUnitClientState = (unit = {}, fallbackEntityType = 'OTRO', index = 0) => {
    const normalizedEntityType = normalizeSampleEntityType(unit.entityType) || normalizeSampleEntityType(fallbackEntityType) || 'OTRO';
    const sanitizedFields = sanitizeClientStructuredValue(
        unit.fields && typeof unit.fields === 'object' && !Array.isArray(unit.fields)
            ? unit.fields
            : {}
    ) || {};
    const sanitizedCollection = sanitizeClientStructuredValue(
        unit.collectionData && typeof unit.collectionData === 'object' && !Array.isArray(unit.collectionData)
            ? unit.collectionData
            : {}
    ) || {};

    return {
        id: `${unit.id || ''}`.trim() || buildInternalSampleUnitId(),
        label: `${unit.label || ''}`.trim() || `Muestra ${index + 1}`,
        sampleIdentifier: `${unit.sampleIdentifier || ''}`.trim(),
        analysisLabel: `${unit.analysisLabel || ''}`.trim(),
        purpose: `${unit.purpose || ''}`.trim(),
        linkedParameterIds: Array.from(new Set(
            (Array.isArray(unit.linkedParameterIds) ? unit.linkedParameterIds : [])
                .map(item => `${item || ''}`.trim())
                .filter(Boolean)
        )),
        entityType: normalizedEntityType,
        fields: sanitizedFields,
        collectionData: {
            collectedAt: sanitizedCollection.collectedAt || '',
            collectorName: sanitizedCollection.collectorName || '',
            collectionMethod: sanitizedCollection.collectionMethod || '',
            collectionNotes: sanitizedCollection.collectionNotes || '',
            inoculationNotes: sanitizedCollection.inoculationNotes || '',
            traceabilityNotes: sanitizedCollection.traceabilityNotes || ''
        }
    };
};

export const normalizeInternalSampleTypeDataForState = (value, fallbackEntityType = 'OTRO') => {
    const defaultState = createDefaultInternalSampleTypeState(fallbackEntityType);

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaultState;
    }

    if (Array.isArray(value.sampleUnits) && value.sampleUnits.length > 0) {
        const sampleUnits = value.sampleUnits.map((unit, index) => (
            normalizeInternalSampleUnitClientState(unit, fallbackEntityType, index)
        ));
        const activeSampleUnitId = sampleUnits.some(unit => unit.id === value.activeSampleUnitId)
            ? value.activeSampleUnitId
            : sampleUnits[0]?.id || '';

        return {
            sampleUnits,
            attachmentAssignments: normalizeAttachmentAssignmentMap(value.attachmentAssignments),
            activeSampleUnitId
        };
    }

    const legacyFields = Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !INTERNAL_SAMPLE_TYPE_RESERVED_KEYS.has(key))
            .map(([key, rawFieldValue]) => [key, sanitizeClientStructuredValue(rawFieldValue)])
            .filter(([, fieldValue]) => fieldValue !== undefined)
    );
    const legacyUnit = normalizeInternalSampleUnitClientState({
        label: value.referenceName || value.surfaceName || value.ambientArea || value.waterPoint || 'Muestra 1',
        entityType: normalizeSampleEntityType(value.entityType) || fallbackEntityType,
        fields: legacyFields
    }, fallbackEntityType, 0);

    return {
        sampleUnits: [legacyUnit],
        attachmentAssignments: normalizeAttachmentAssignmentMap(value.attachmentAssignments),
        activeSampleUnitId: legacyUnit.id
    };
};

export const buildInternalSampleUnitLabel = (unit = {}, index = 0) => (
    unit.label
    || unit.analysisLabel
    || unit.fields?.referenceName
    || unit.fields?.surfaceName
    || unit.fields?.ambientArea
    || unit.fields?.waterPoint
    || `Muestra ${index + 1}`
);

export const buildInternalSampleUnitIdentifier = (sampleNumber = '', index = 0) => {
    const normalizedSampleNumber = `${sampleNumber || ''}`.trim();
    if (!normalizedSampleNumber) return '';
    return `${normalizedSampleNumber}-S${String(index + 1).padStart(2, '0')}`;
};

const AUTO_GENERATED_INTERNAL_SAMPLE_LABEL = /^Muestra\s+\d+$/i;

const buildRequestedAnalysisLabel = (parameter = null, index = 0) => (
    parameter?.name
    || parameter?.code
    || `Análisis ${index + 1}`
);

export const buildRequestedAnalysisPurpose = (parameter = null) => {
    const analysisLabel = parameter?.name || parameter?.code || 'análisis solicitado';
    return `Muestra destinada a ${analysisLabel}`;
};

export const syncInternalSampleTypeDataWithRequestedParameters = ({
    sampleTypeData,
    requestedIds = [],
    parameters = [],
    fallbackEntityType = 'OTRO',
    sampleNumber = ''
} = {}) => {
    const normalized = normalizeInternalSampleTypeDataForState(sampleTypeData, fallbackEntityType);
    const uniqueRequestedIds = Array.from(new Set(
        (Array.isArray(requestedIds) ? requestedIds : [])
            .map(requestedId => `${requestedId || ''}`.trim())
            .filter(Boolean)
    ));
    if (uniqueRequestedIds.length === 0) return normalized;

    const parameterMap = new Map((parameters || []).map(parameter => [parameter.id, parameter]));
    const consumedUnitIds = new Set();
    const findExistingUnit = (parameterId, index) => {
        const exactUnit = normalized.sampleUnits.find(unit => (
            !consumedUnitIds.has(unit.id)
            && (unit.linkedParameterIds || []).includes(parameterId)
        ));
        if (exactUnit) return exactUnit;

        const indexedUnit = normalized.sampleUnits[index];
        if (indexedUnit && !consumedUnitIds.has(indexedUnit.id)) return indexedUnit;

        return normalized.sampleUnits.find(unit => !consumedUnitIds.has(unit.id)) || null;
    };

    const nextUnits = uniqueRequestedIds.map((parameterId, index) => {
        const parameter = parameterMap.get(parameterId);
        const existingUnit = findExistingUnit(parameterId, index) || createDefaultInternalSampleUnit(fallbackEntityType, index + 1);
        const analysisLabel = buildRequestedAnalysisLabel(parameter, index);
        const shouldAutoRename = !existingUnit.label || AUTO_GENERATED_INTERNAL_SAMPLE_LABEL.test(existingUnit.label);

        consumedUnitIds.add(existingUnit.id);

        return {
            ...existingUnit,
            label: shouldAutoRename ? `Muestra ${index + 1}` : existingUnit.label,
            sampleIdentifier: existingUnit.sampleIdentifier || buildInternalSampleUnitIdentifier(sampleNumber, index),
            analysisLabel: analysisLabel || existingUnit.analysisLabel,
            purpose: existingUnit.purpose || buildRequestedAnalysisPurpose(parameter),
            linkedParameterIds: [parameterId]
        };
    });

    return {
        ...normalized,
        sampleUnits: nextUnits,
        attachmentAssignments: Object.fromEntries(
            Object.entries(normalized.attachmentAssignments || {}).filter(([, unitId]) => (
                nextUnits.some(unit => unit.id === unitId)
            ))
        ),
        activeSampleUnitId: nextUnits.some(unit => unit.id === normalized.activeSampleUnitId)
            ? normalized.activeSampleUnitId
            : nextUnits[0]?.id || ''
    };
};

const getInternalSampleUnitRequiredFieldCompletion = (unit = {}) => {
    const requiredFields = getSampleEntityFieldConfig(unit.entityType)
        .filter(field => field.required);

    if (requiredFields.length === 0) {
        return hasMeaningfulDataObject(unit.fields);
    }

    return requiredFields.every(field => hasMeaningfulDataObject(unit.fields?.[field.name]));
};

const getInternalSampleUnitHasPartialIdentification = (unit = {}) => hasMeaningfulDataObject(unit.fields);

export const getInternalSampleUnitAttachmentCount = (sampleTypeData = {}, unitId = '') => {
    const assignments = sampleTypeData?.attachmentAssignments || {};
    return Object.values(assignments).filter(currentUnitId => currentUnitId === unitId).length;
};

export const buildInternalSampleUnitProgress = (unit = {}, attachmentCount = 0) => {
    const identificationComplete = getInternalSampleUnitRequiredFieldCompletion(unit);
    const identificationStarted = getInternalSampleUnitHasPartialIdentification(unit);
    const collectionStarted = hasMeaningfulDataObject(unit.collectionData);

    return [
        {
            key: 'IDENTIFICATION',
            label: 'Identificación',
            status: identificationComplete ? 'completed' : identificationStarted ? 'in_progress' : 'pending'
        },
        {
            key: 'COLLECTION',
            label: 'Recolección',
            status: collectionStarted ? 'completed' : 'pending'
        },
        {
            key: 'EVIDENCE',
            label: 'Evidencias',
            status: attachmentCount > 0 ? 'completed' : 'pending'
        }
    ];
};

export const hasMeaningfulInternalSampleTypeData = (sampleTypeData = {}) => {
    const normalized = normalizeInternalSampleTypeDataForState(sampleTypeData);

    return normalized.sampleUnits.some(unit => (
        hasMeaningfulDataObject(unit.fields)
        || hasMeaningfulDataObject(unit.collectionData)
        || getInternalSampleUnitAttachmentCount(normalized, unit.id) > 0
    ));
};

export const buildInternalSampleTypeSummaryItems = (sampleTypeData = {}) => {
    const normalized = normalizeInternalSampleTypeDataForState(sampleTypeData);

    return normalized.sampleUnits.map((unit, index) => {
        const summaryParts = [];
        const primaryFieldValue = (
            unit.fields?.referenceName
            || unit.fields?.surfaceName
            || unit.fields?.ambientArea
            || unit.fields?.waterPoint
            || unit.fields?.productReference
        );

        if (primaryFieldValue) {
            summaryParts.push(primaryFieldValue);
        }
        if (unit.fields?.processStage) {
            summaryParts.push(`Etapa: ${unit.fields.processStage}`);
        }
        if (unit.analysisLabel) {
            summaryParts.push(`Análisis: ${unit.analysisLabel}`);
        }
        if (unit.sampleIdentifier) {
            summaryParts.push(`ID: ${unit.sampleIdentifier}`);
        }
        if (unit.purpose) {
            summaryParts.push(unit.purpose);
        }
        if (unit.collectionData?.collectorName) {
            summaryParts.push(`Tomó: ${unit.collectionData.collectorName}`);
        }
        if (unit.collectionData?.collectedAt) {
            summaryParts.push(`Toma: ${unit.collectionData.collectedAt}`);
        }

        return {
            label: buildInternalSampleUnitLabel(unit, index),
            value: [
                buildOptionLabel(SAMPLE_ENTITY_OPTIONS, unit.entityType),
                ...summaryParts
            ].filter(Boolean).join(' · ')
        };
    });
};

export const createDefaultInternalAcceptanceData = () => ({
    receivedAt: new Date().toISOString().slice(0, 16),
    accepted: true,
    containerIntegrity: 'INTEGRO',
    sampleCondition: '',
    transportCondition: '',
    chainOfCustodyRef: '',
    sampleTemperatureC: '',
    sampleQuantity: '',
    quantityUnit: 'mL',
    conditionNotes: '',
    rejectionReason: ''
});

export const createDefaultInternalExecutionData = () => ({
    methodCode: '',
    methodVersion: '',
    analystName: '',
    equipmentName: '',
    incubatorName: '',
    mediaLot: '',
    diluentLot: '',
    plateBatch: '',
    positiveControl: '',
    negativeControl: '',
    duplicatePerformed: false,
    acceptanceCriteria: '',
    incubationStartedAt: '',
    incubationEndedAt: '',
    executionNotes: '',
    normativeRefs: []
});

export const createDefaultInternalDeviationData = () => ({
    hasDeviation: false,
    category: 'OOS',
    details: '',
    immediateActions: '',
    capaPlan: '',
    productionImpact: '',
    linkedReference: '',
    requiresHold: false
});

export const createDefaultInternalReviewData = () => ({
    reviewedAt: new Date().toISOString().slice(0, 16),
    reviewDecision: 'APPROVED',
    releaseDecision: 'LIBERAR',
    reviewNotes: '',
    normativeRefs: []
});

export const createDefaultInternalApprovalData = () => ({
    approvedAt: new Date().toISOString().slice(0, 16),
    approvalNotes: ''
});

export const hasMeaningfulDataObject = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => hasMeaningfulDataObject(item));
    if (typeof value === 'object') return Object.values(value).some(item => hasMeaningfulDataObject(item));
    return false;
};

export const buildAuditActionLabel = (action = '') => {
    const labels = {
        MICRO_INTERNAL_CREATED: 'Caso interno iniciado',
        MICRO_SAMPLE_CREATED: 'Muestra registrada',
        MICRO_INTERNAL_CASE_UPDATED: 'Ficha interna actualizada',
        MICRO_INTERNAL_ACCEPTED: 'Muestra aceptada',
        MICRO_INTERNAL_REJECTED: 'Muestra rechazada',
        MICRO_INTERNAL_LOG_RECORDED: 'Bitácora registrada',
        MICRO_INTERNAL_SUPPORTS_UPDATED: 'Soportes actualizados',
        MICRO_INTERNAL_RESULTS_CAPTURED: 'Resultados finales registrados',
        MICRO_INTERNAL_TECH_REVIEWED: 'Revisión técnica registrada',
        MICRO_INTERNAL_CLOSED: 'Aprobación y cierre'
    };

    return labels[action] || action || 'Movimiento';
};

const SAMPLE_ENTITY_STOP_WORDS = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'PRE', 'POST', 'INICIO', 'SALIDA', 'LOTE', 'DIARIO']);

export const STATUS_META = {
    SUGGESTED: {
        label: 'Sugerido',
        chipClass: 'bg-amber-50 text-amber-700 border border-amber-200',
        actionLabel: 'Programar',
        actionClass: 'bg-amber-50 text-amber-700 hover:bg-amber-100'
    },
    PLANNED: {
        label: 'Programado',
        chipClass: 'bg-slate-100 text-slate-700 border border-slate-200',
        actionLabel: 'Iniciar',
        actionClass: 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    },
    IN_PROGRESS: {
        label: 'En proceso',
        chipClass: 'bg-blue-50 text-blue-700 border border-blue-200',
        actionLabel: 'Continuar',
        actionClass: 'bg-blue-50 text-blue-700 hover:bg-blue-100'
    },
    IN_PROCESS: {
        label: 'En proceso',
        chipClass: 'bg-blue-50 text-blue-700 border border-blue-200',
        actionLabel: 'Continuar',
        actionClass: 'bg-blue-50 text-blue-700 hover:bg-blue-100'
    },
    DELAYED: {
        label: 'Retrasado',
        chipClass: 'bg-amber-50 text-amber-800 border border-amber-200',
        actionLabel: 'Continuar',
        actionClass: 'bg-amber-50 text-amber-800 hover:bg-amber-100'
    },
    CANCELLED: {
        label: 'Cancelado',
        chipClass: 'bg-rose-50 text-rose-700 border border-rose-200',
        actionLabel: 'Reagendar',
        actionClass: 'bg-rose-50 text-rose-700 hover:bg-rose-100'
    },
    NOT_PERFORMED: {
        label: 'No realizado',
        chipClass: 'bg-red-50 text-red-700 border border-red-200',
        actionLabel: 'Reagendar',
        actionClass: 'bg-red-50 text-red-700 hover:bg-red-100'
    },
    RESCHEDULED: {
        label: 'Reagendado',
        chipClass: 'bg-violet-50 text-violet-700 border border-violet-200',
        actionLabel: 'Ver trazabilidad',
        actionClass: 'bg-violet-50 text-violet-700 hover:bg-violet-100'
    },
    AWAITING_RESULTS: {
        label: 'En proceso',
        chipClass: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
        actionLabel: 'Cargar resultados',
        actionClass: 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
    },
    COMPLETED: {
        label: 'Completado',
        chipClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        actionLabel: 'Ver reporte',
        actionClass: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    },
    CLOSED: {
        label: 'Cerrado',
        chipClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        actionLabel: 'Ver reporte',
        actionClass: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    },
    REPORT_READY: {
        label: 'Reporte listo',
        chipClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        actionLabel: 'Ver reporte',
        actionClass: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    },
    RECEIVED: {
        label: 'Recepcionado',
        chipClass: 'bg-sky-50 text-sky-700 border border-sky-200',
        actionLabel: 'Continuar',
        actionClass: 'bg-sky-50 text-sky-700 hover:bg-sky-100'
    },
    RESULTS_RECORDED: {
        label: 'Resultados listos',
        chipClass: 'bg-violet-50 text-violet-700 border border-violet-200',
        actionLabel: 'Revisar',
        actionClass: 'bg-violet-50 text-violet-700 hover:bg-violet-100'
    },
    TECHNICAL_REVIEW: {
        label: 'En revisión',
        chipClass: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
        actionLabel: 'Aprobar',
        actionClass: 'bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100'
    },
    SAMPLED: {
        label: 'Muestreado',
        chipClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        actionLabel: 'Continuar',
        actionClass: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
    },
    REJECTED: {
        label: 'Rechazado',
        chipClass: 'bg-rose-50 text-rose-700 border border-rose-200',
        actionLabel: 'Ver trazabilidad',
        actionClass: 'bg-rose-50 text-rose-700 hover:bg-rose-100'
    }
};

export const LAB_LABELS = {
    EXTERNAL: 'Externo',
    INTERNAL: 'Interno'
};

export const LAB_COLOR = {
    EXTERNAL: 'bg-orange-50 text-orange-700 border border-orange-200',
    INTERNAL: 'bg-teal-50 text-teal-700 border border-teal-200'
};

export const formatDateLabel = (isoDate) => {
    if (!isoDate) return '—';
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('es-CO', {
        month: 'short',
        day: 'numeric'
    });
};

export const getWeekdayFromIsoDate = (isoDate) => {
    if (!isoDate) return null;
    return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
};

export const formatDateTimeLabel = (value) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('es-CO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

export const isQualitativeResult = (result) => `${result?.specText || ''}`.toLowerCase().includes('ausente');

export const buildResultRows = (parameters = [], existingResults = []) => (
    parameters.map(parameter => {
        const existing = existingResults.find(result => result.parameterId === parameter.id);
        return {
            parameterId: parameter.id,
            parameterCode: parameter.code,
            parameterName: parameter.name,
            unit: parameter.unit,
            specMin: parameter.specMin,
            specMax: parameter.specMax,
            specText: parameter.specText,
            value: existing?.value !== null && existing?.value !== undefined ? String(existing.value) : '',
            valueText: existing?.valueText || '',
            isDetected: existing?.isDetected ?? null,
            isCompliant: existing?.isCompliant ?? null,
            notes: existing?.notes || ''
        };
    })
);

export const extractFilledResults = (results = []) => (
    results
        .filter(result => result.value !== '' || result.valueText !== '' || result.isDetected !== null)
        .map(result => ({
            parameterId: result.parameterId,
            value: result.value !== '' ? parseFloat(result.value) : null,
            valueText: result.valueText || null,
            isDetected: result.isDetected,
            notes: result.notes || null
        }))
);

export const getVisibleMicroParameters = (parameters = [], requestedIds = [], existingResults = []) => {
    const requestedIdSet = new Set((requestedIds || []).map(id => `${id}`).filter(Boolean));
    if (requestedIdSet.size > 0) {
        const requestedParameters = parameters.filter(parameter => requestedIdSet.has(`${parameter.id}`));
        if (requestedParameters.length > 0) {
            return requestedParameters;
        }
    }

    const existingResultIdSet = new Set((existingResults || []).map(result => `${result.parameterId || ''}`).filter(Boolean));
    if (existingResultIdSet.size > 0) {
        const parametersWithResults = parameters.filter(parameter => existingResultIdSet.has(`${parameter.id}`));
        if (parametersWithResults.length > 0) {
            return parametersWithResults;
        }
    }

    return parameters;
};

export const buildScopedResultRows = ({
    parameters = [],
    requestedIds = [],
    existingResults = []
} = {}) => (
    buildResultRows(
        getVisibleMicroParameters(parameters, requestedIds, existingResults),
        existingResults
    )
);

export const buildOptionLabel = (options = [], value) => options.find(option => option.value === value)?.label || value || '—';

export const getAllowedOptions = (options = [], allowedValues = []) => {
    if (!Array.isArray(allowedValues) || allowedValues.length === 0) return options;
    return options.filter(option => allowedValues.includes(option.value));
};

export const normalizeSampleEntityType = (value) => {
    const normalized = `${value || ''}`.trim().toUpperCase();
    return SAMPLE_ENTITY_OPTIONS.some(option => option.value === normalized) ? normalized : '';
};

export const inferSampleEntityType = (point = null, laboratoryProfile = '') => {
    const pointText = `${point?.code || ''} ${point?.name || ''} ${point?.processArea || ''} ${point?.zoneName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (laboratoryProfile === 'AGUA' || pointText.includes('AGUA')) return 'AGUA';
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
    if (point?.isEnvironmental || laboratoryProfile === 'AMBIENTE' || laboratoryProfile === 'SUPERFICIE') {
        return laboratoryProfile === 'SUPERFICIE' ? 'SUPERFICIE' : 'AMBIENTE';
    }
    if (pointText.includes('GLUCOSA') || pointText.includes('AZUCAR') || pointText.includes('GOMA') || pointText.includes('MATERIAS PRIMAS')) {
        return 'MATERIA_PRIMA';
    }
    if (laboratoryProfile === 'PRODUCTO' || laboratoryProfile === 'LIBERACION') return 'PRODUCTO_TERMINADO';
    return 'OTRO';
};

export const buildSampleEntityContext = ({ point = null, laboratoryProfile = '', productionContextData = null } = {}) => {
    const requestedType = normalizeSampleEntityType(productionContextData?.entityType);
    const entityType = requestedType || inferSampleEntityType(point, laboratoryProfile);
    const pointKeywords = `${point?.code || ''} ${point?.name || ''} ${point?.processArea || ''} ${point?.zoneName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/g)
        .filter(token => token.length >= 3 && !SAMPLE_ENTITY_STOP_WORDS.has(token));
    const contextKeywords = Array.isArray(productionContextData?.keywords)
        ? productionContextData.keywords.map(keyword => `${keyword}`.trim()).filter(Boolean)
        : [];
    const keywords = Array.from(new Set([
        ...(Array.isArray(productionContextData?.keywords) ? contextKeywords : []),
        ...pointKeywords
    ]));

    return {
        entityType,
        entityLabel: SAMPLE_ENTITY_META[entityType]?.label || buildOptionLabel(SAMPLE_ENTITY_OPTIONS, entityType),
        helper: SAMPLE_ENTITY_META[entityType]?.helper || '',
        keywords
    };
};

const buildExternalWorkflowProgress = ({
    takenAt = '',
    dispatchAt = '',
    resultsReceivedAt = '',
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

export const buildExternalWorkflowPreview = ({
    takenAt = '',
    dispatchAt = '',
    resultsReceivedAt = '',
    hasResults = false,
    hasReport = false,
    photoCount = 0,
    requestedCount = 0,
    isDraft = false
} = {}) => {
    const workflowProgress = buildExternalWorkflowProgress({
        takenAt,
        dispatchAt,
        resultsReceivedAt,
        hasResults,
        isFinished: hasResults,
        isDraft
    });

    return [
    {
        key: 'SAMPLE_COLLECTION',
        label: 'Toma de muestras',
        status: workflowProgress.collected ? 'completed' : workflowProgress.currentStepKey === 'SAMPLE_COLLECTION' ? 'current' : 'pending',
        date: takenAt || null,
        detail: photoCount > 0
            ? `${photoCount} evidencia(s)`
            : isDraft
                ? 'Pendiente por registrar'
                : 'Sin evidencia'
    },
    {
        key: 'LAB_DISPATCH',
        label: 'Envío a laboratorio',
        status: workflowProgress.dispatched ? 'completed' : workflowProgress.currentStepKey === 'LAB_DISPATCH' ? 'current' : 'pending',
        date: dispatchAt || null,
        detail: isDraft && dispatchAt ? 'Se guardará al registrar la muestra' : dispatchAt || null
    },
    {
        key: 'AWAITING_RESULTS',
        label: 'Espera de resultados',
        status: workflowProgress.resultsReceived ? 'completed' : workflowProgress.currentStepKey === 'AWAITING_RESULTS' ? 'current' : 'pending',
        date: resultsReceivedAt || null,
        detail: requestedCount > 0 ? `${requestedCount} análisis solicitado(s)` : 'Sin análisis definidos'
    },
    {
        key: 'RESULT_RECORDING',
        label: 'Registro de resultados',
        status: workflowProgress.resultsRecorded ? 'completed' : workflowProgress.currentStepKey === 'RESULT_RECORDING' ? 'current' : 'pending',
        date: resultsReceivedAt || null,
        detail: workflowProgress.resultsRecorded ? 'Resultados cargados' : null
    },
    {
        key: 'FINISHED',
        label: 'Fin',
        status: workflowProgress.finished ? 'completed' : workflowProgress.currentStepKey === 'FINISHED' ? 'current' : 'pending',
        date: resultsReceivedAt || null,
        detail: workflowProgress.finished && hasReport ? 'Informe disponible' : null
    }
    ];
};

const buildInternalWorkflowProgress = ({
    takenAt = '',
    receivedAt = '',
    isRejected = false,
    logCount = 0,
    resultsCapturedAt = '',
    reviewedAt = '',
    finalResultCount = 0,
    hasReport = false,
    isClosed = false,
    isDraft = false
} = {}) => {
    const collected = !isDraft && Boolean(takenAt || isClosed);
    const received = !isDraft && Boolean(receivedAt || isRejected || isClosed);
    const trackingCompleted = !isDraft && (logCount > 0 || finalResultCount > 0 || isClosed);
    const finalResultsCompleted = !isDraft && Boolean(resultsCapturedAt || finalResultCount > 0 || isClosed);
    const technicalReviewCompleted = !isDraft && Boolean(reviewedAt || isClosed);
    const reportReady = !isDraft && Boolean(hasReport || isClosed);

    let currentStepKey = null;
    if (!collected) currentStepKey = 'INTERNAL_COLLECTION';
    else if (!received) currentStepKey = 'INTERNAL_RECEPTION';
    else if (isRejected) currentStepKey = null;
    else if (!trackingCompleted) currentStepKey = 'INTERNAL_FOLLOW_UP';
    else if (!finalResultsCompleted) currentStepKey = 'INTERNAL_FINAL_RESULTS';
    else if (!technicalReviewCompleted) currentStepKey = 'INTERNAL_TECHNICAL_REVIEW';
    else if (!reportReady) currentStepKey = 'INTERNAL_APPROVAL';

    return {
        collected,
        received,
        trackingCompleted,
        finalResultsCompleted,
        technicalReviewCompleted,
        reportReady,
        currentStepKey
    };
};

export const buildInternalWorkflowPreview = ({
    takenAt = '',
    receivedAt = '',
    isRejected = false,
    latestLogAt = '',
    resultsCapturedAt = '',
    reviewedAt = '',
    closedAt = '',
    logCount = 0,
    finalResultCount = 0,
    hasReport = false,
    requestedCount = 0,
    isDraft = false
} = {}) => {
    const workflowProgress = buildInternalWorkflowProgress({
        takenAt,
        receivedAt,
        isRejected,
        logCount,
        resultsCapturedAt,
        reviewedAt,
        finalResultCount,
        hasReport,
        isClosed: Boolean(closedAt),
        isDraft
    });

    return [
        {
            key: 'INTERNAL_COLLECTION',
            label: 'Toma interna',
            status: workflowProgress.collected ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_COLLECTION' ? 'current' : 'pending',
            date: workflowProgress.collected ? takenAt || null : null,
            detail: isDraft ? 'Pendiente por iniciar el caso interno' : 'Caso interno registrado'
        },
        {
            key: 'INTERNAL_RECEPTION',
            label: 'Recepción y aceptación',
            status: workflowProgress.received ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_RECEPTION' ? 'current' : 'pending',
            date: receivedAt || null,
            detail: isRejected
                ? 'Muestra rechazada al ingreso'
                : workflowProgress.received
                    ? 'Muestra aceptada en laboratorio'
                    : 'Pendiente por recepcionar'
        },
        {
            key: 'INTERNAL_FOLLOW_UP',
            label: 'Seguimiento e incubacion',
            status: workflowProgress.trackingCompleted ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_FOLLOW_UP' ? 'current' : 'pending',
            date: latestLogAt || null,
            detail: logCount > 0 ? `${logCount} bitacora(s) registrada(s)` : 'Sin bitacoras registradas'
        },
        {
            key: 'INTERNAL_FINAL_RESULTS',
            label: 'Resultados finales',
            status: workflowProgress.finalResultsCompleted ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_FINAL_RESULTS' ? 'current' : 'pending',
            date: resultsCapturedAt || (workflowProgress.finalResultsCompleted ? (closedAt || latestLogAt || null) : null),
            detail: finalResultCount > 0
                ? `${finalResultCount} resultado(s) final(es)`
                : requestedCount > 0
                    ? `${requestedCount} analisis definidos`
                    : 'Sin analisis definidos'
        },
        {
            key: 'INTERNAL_TECHNICAL_REVIEW',
            label: 'Revisión técnica',
            status: workflowProgress.technicalReviewCompleted ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_TECHNICAL_REVIEW' ? 'current' : 'pending',
            date: reviewedAt || null,
            detail: workflowProgress.technicalReviewCompleted ? 'Dictamen técnico registrado' : 'Pendiente por revisar'
        },
        {
            key: 'INTERNAL_APPROVAL',
            label: 'Aprobación y cierre',
            status: workflowProgress.reportReady ? 'completed' : workflowProgress.currentStepKey === 'INTERNAL_APPROVAL' ? 'current' : 'pending',
            date: closedAt || null,
            detail: workflowProgress.reportReady ? 'Reporte disponible' : 'Pendiente por aprobar y cerrar'
        }
    ];
};

export const normalizeWorkContextValue = (value) => {
    if (value === undefined || value === null) return value;

    const trimmed = `${value}`.trim();
    if (!trimmed) return '';

    const aliasKey = trimmed
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .toUpperCase();

    if (aliasKey === 'PRODUCCION') return 'PRODUCCION';
    if (aliasKey === 'LAVADO') return 'LAVADO';
    if (aliasKey === 'LIBERACION') return 'LIBERACION';

    return trimmed;
};

export const normalizeWorkContextCollection = (values = []) => (
    Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(item => normalizeWorkContextValue(item))
            .filter(Boolean)
    ))
);

export const buildWorkContextOptions = (allowedValues = []) => {
    const normalizedAllowedValues = normalizeWorkContextCollection(allowedValues);

    if (normalizedAllowedValues.length === 0) return WORK_CONTEXT_OPTIONS;

    return normalizedAllowedValues.map(value => ({
        value,
        label: WORK_CONTEXT_LABEL_MAP[value] || value
    }));
};

export const appendWorkContextOption = (values = [], nextValue) => {
    const normalizedValue = normalizeWorkContextValue(nextValue);
    if (!normalizedValue) return normalizeWorkContextCollection(values);

    return normalizeWorkContextCollection([...values, normalizedValue]);
};

const parseTimeToMinutes = (value) => {
    const trimmed = `${value || ''}`.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (
        Number.isNaN(hours)
        || Number.isNaN(minutes)
        || hours < 0
        || hours > 23
        || minutes < 0
        || minutes > 59
    ) {
        return null;
    }

    return (hours * 60) + minutes;
};

export const normalizePlannedTime = (value) => {
    const totalMinutes = parseTimeToMinutes(value);
    if (totalMinutes === null) return '';

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const inferShiftFromTime = (value) => {
    const totalMinutes = parseTimeToMinutes(value);
    if (totalMinutes === null) return '';

    if (totalMinutes >= (22 * 60) || totalMinutes < (4 * 60)) return 'NOCHE';
    if (totalMinutes < (6 * 60)) return 'MADRUGADA';
    if (totalMinutes < (14 * 60)) return 'MANANA';
    return 'TARDE';
};
