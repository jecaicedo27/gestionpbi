const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
const {
    storeMicroSampleFiles,
    cleanupStoredFiles,
    deleteFilesByUrls
} = require('../services/microSampleFileService');
const {
    MICRO_WORKFLOW_TYPES,
    MICRO_SHIFTS,
    MICRO_LABORATORY_PROFILES,
    INTERNAL_DEFAULT_LAB,
    normalizeJsonArray,
    normalizeJsonObject,
    normalizeOptionalText,
    normalizeOptionalDateTime,
    normalizeOptionalNumber,
    normalizeWorkContextCollection,
    parseJsonArrayField,
    buildScheduleDatePlan,
    normalizeScheduleHistory,
    buildScheduleHistoryEvent,
    appendScheduleHistory,
    normalizeResults,
    normalizeInternalReadings,
    calculateCompliance,
    buildAttachmentCreateManyInput,
    getPrimaryReportUrl,
    toIsoDate,
    buildUtcDateFromIso,
    addUtcDays,
    getWeekRange,
    generateUniqueZoneCode,
    buildPointConfig,
    normalizeSchedulePayload,
    deriveSampleStatus,
    deriveScheduleEntryStatus,
    getNextSampleNumber,
    getNextInternalReportNumber,
    buildSampleSummary,
    ensureInternalSampleTypeIdentifiers,
    normalizeRequestedParameterIds,
    buildSampleEntityContext,
    buildExternalWorkflowSteps,
    buildInternalWorkflowSteps,
    normalizeInternalSampleTypeData,
    normalizeInternalAcceptanceData,
    normalizeInternalAnalysisExecutionData,
    normalizeInternalDeviationData,
    normalizeInternalTechnicalReviewData,
    normalizeInternalApprovalData,
    hasMeaningfulStructuredData
} = require('../services/microLabService');
const { buildMicroTrendPayload } = require('../services/microTrendService');
const { generateInternalMicroReport } = require('../services/microLabReportPdf');
const { generateMicroSampleLabelPdf } = require('../services/microSampleLabelPdf');

const getUploadedMicroFiles = (req) => ({
    reportFile: req.files?.report?.[0] || null,
    attachmentFiles: req.files?.attachments || []
});

const hasPhotoEvidence = (files = []) => files.some(file => (
    file?.mimetype?.startsWith('image/')
    || /\.(png|jpe?g|webp|heic|heif)$/i.test(file?.originalname || '')
));

const MANUAL_SCHEDULE_STATUS_ACTIONS = new Set(['CANCELLED', 'NOT_PERFORMED', 'RESCHEDULED']);
const INTERNAL_SAMPLE_GENERAL_CONTEXT_ID = 'GENERAL';

const SAMPLE_DETAIL_INCLUDE = {
    samplingPoint: true,
    results: {
        include: {
            parameter: true
        }
    },
    attachments: {
        orderBy: { createdAt: 'desc' }
    },
    takenBy: {
        select: { id: true, name: true }
    },
    internalLogs: {
        orderBy: { logDate: 'asc' },
        include: {
            recordedBy: {
                select: { id: true, name: true }
            },
            logReadings: {
                include: { parameter: true }
            }
        }
    },
    scheduleEntry: {
        include: {
            requestedParameters: {
                include: { parameter: true }
            }
        }
    },
    requestedParameters: {
        include: { parameter: true }
    }
};

// Standard include for schedule entry reads — includes junction table to support relational read path
const SCHEDULE_ENTRY_INCLUDE = {
    samplingPoint: true,
    requestedParameters: {
        include: { parameter: true }
    },
    sample: {
        include: SAMPLE_DETAIL_INCLUDE
    }
};

const respondWithError = (res, error, logPrefix, defaultMessage) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        logger.error(logPrefix, error);
    } else {
        logger.warn(logPrefix, { message: error.message });
    }

    res.status(statusCode).json({
        error: statusCode >= 500 ? `${defaultMessage}: ${error.message}` : error.message
    });
};

const parseBooleanQuery = (value) => ['1', 'true', 'yes', 'si'].includes(`${value || ''}`.toLowerCase());

const parseQueryValueList = (value) => {
    const rawValues = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    return Array.from(new Set(
        rawValues
            .map(item => `${item || ''}`.trim())
            .filter(Boolean)
    ));
};

const normalizeRequestedParameterIdList = (value) => (
    Array.from(new Set(
        (Array.isArray(value) ? value : normalizeJsonArray(value))
            .map(item => `${item}`.trim())
            .filter(Boolean)
    ))
);

const loadRequestedParameters = async (parameterIds = []) => {
    const normalizedIds = normalizeRequestedParameterIdList(parameterIds);
    if (normalizedIds.length === 0) return [];

    const parameters = await prisma.microParameter.findMany({
        where: { id: { in: normalizedIds } },
        orderBy: { sortOrder: 'asc' }
    });

    const parameterMap = new Map(parameters.map(parameter => [parameter.id, parameter]));
    return normalizedIds.map(parameterId => parameterMap.get(parameterId)).filter(Boolean);
};

/**
 * Resolves requestedParameterIds from relational junction if available,
 * falling back to the legacy JSON field for historical records.
 */
const resolveRequestedParameterIds = (entity) => {
    // Prefer normalized junction table (new records)
    if (Array.isArray(entity?.requestedParameters) && entity.requestedParameters.length > 0) {
        return entity.requestedParameters
            .map(jp => jp.parameterId || jp.parameter?.id)
            .filter(Boolean);
    }
    // Fallback: legacy JSON field (historical records pre-migration)
    return normalizeRequestedParameterIdList(entity?.requestedParameterIds);
};

const resolveRequestedParameterObjects = (entity) => {
    // Prefer pre-loaded objects from junction table includes
    if (Array.isArray(entity?.requestedParameters) && entity.requestedParameters.length > 0) {
        return entity.requestedParameters
            .map(jp => jp.parameter)
            .filter(Boolean)
            .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    }
    return null; // signals caller to do a DB lookup via loadRequestedParameters
};

const validateRequestedParametersExist = async (tx, parameterIds = []) => {
    const normalizedIds = normalizeRequestedParameterIdList(parameterIds);
    if (normalizedIds.length === 0) return [];

    const parameters = await tx.microParameter.findMany({
        where: { id: { in: normalizedIds } },
        select: { id: true }
    });
    const parameterSet = new Set(parameters.map(parameter => parameter.id));
    const missingIds = normalizedIds.filter(parameterId => !parameterSet.has(parameterId));

    if (missingIds.length > 0) {
        const error = new Error('Uno o más análisis solicitados ya no existen o fueron deshabilitados');
        error.statusCode = 400;
        throw error;
    }

    return normalizedIds;
};

const loadSampleAuditTrail = async (sampleId) => {
    if (!sampleId) return [];

    const auditRows = await prisma.auditLog.findMany({
        where: {
            entity: 'MicroSample',
            entityId: sampleId
        },
        include: {
            user: {
                select: { id: true, name: true }
            }
        },
        orderBy: { createdAt: 'asc' },
        take: 80
    });

    return auditRows.map(row => ({
        id: row.id,
        action: row.action,
        createdAt: row.createdAt,
        user: row.user || (row.userId ? { id: row.userId, name: null } : null),
        changes: row.changes || null
    }));
};

const logMicroAuditEvent = async (tx, {
    userId = null,
    action,
    sampleId,
    changes = null
} = {}) => {
    if (!sampleId || !action) return null;

    return tx.auditLog.create({
        data: {
            userId,
            action,
            entity: 'MicroSample',
            entityId: sampleId,
            changes
        }
    });
};

const buildActorSnapshot = (user = {}) => ({
    userId: user?.id || null,
    userName: user?.name || null
});

const validateInternalExecutionDataForResults = (analysisExecutionData = null) => {
    if (!analysisExecutionData || !hasMeaningfulStructuredData(analysisExecutionData)) {
        const error = new Error('Antes de registrar resultados finales debes completar la trazabilidad técnica del ensayo');
        error.statusCode = 400;
        throw error;
    }

    if (!analysisExecutionData.methodCode || !analysisExecutionData.methodVersion || !analysisExecutionData.analystName) {
        const error = new Error('La trazabilidad técnica debe incluir método, versión y analista responsable');
        error.statusCode = 400;
        throw error;
    }
};

const buildAttachmentNameMap = (attachments = []) => new Map(
    (attachments || [])
        .map(attachment => [attachment.id, attachment.originalName || attachment.storedName || attachment.id])
);

const buildRequestedResultCoverage = ({ requestedParameterIds = [], resultRows = [], parameterLookup = new Map() } = {}) => {
    const normalizedRequestedIds = normalizeRequestedParameterIdList(requestedParameterIds);
    const coveredParameterIds = new Set(
        (resultRows || [])
            .map(result => `${result?.parameterId || ''}`.trim())
            .filter(Boolean)
    );
    const missingParameterIds = normalizedRequestedIds.filter(parameterId => !coveredParameterIds.has(parameterId));
    const missingParameterLabels = missingParameterIds.map(parameterId => (
        parameterLookup.get(parameterId)?.name
        || parameterLookup.get(parameterId)?.code
        || parameterId
    ));

    return {
        requestedCount: normalizedRequestedIds.length,
        recordedCount: normalizedRequestedIds.length - missingParameterIds.length,
        missingParameterIds,
        missingParameterLabels
    };
};

const assertRequestedResultCoverage = ({
    requestedParameterIds = [],
    resultRows = [],
    parameterLookup = new Map(),
    defaultMessage = 'Debes registrar todos los análisis solicitados antes de continuar'
} = {}) => {
    const coverage = buildRequestedResultCoverage({
        requestedParameterIds,
        resultRows,
        parameterLookup
    });

    if (coverage.missingParameterIds.length === 0) {
        return coverage;
    }

    const error = new Error(
        `${defaultMessage}. Faltan: ${coverage.missingParameterLabels.join(', ')}`
    );
    error.statusCode = 400;
    throw error;
};

const buildSampleResponse = async (sample) => {
    if (!sample) return null;

    const requestedParameterIds = resolveRequestedParameterIds(sample);
    const preloadedParams = resolveRequestedParameterObjects(sample);
    const requestedParameters = preloadedParams !== null
        ? preloadedParams
        : await loadRequestedParameters(requestedParameterIds);
    const hydratedSample = sample.workflowType === 'INTERNAL'
        ? {
            ...sample,
            sampleTypeData: ensureInternalSampleTypeIdentifiers(sample.sampleTypeData, sample.sampleNumber)
        }
        : sample;
    const entityContext = buildSampleEntityContext({
        point: hydratedSample.samplingPoint,
        laboratoryProfile: hydratedSample.laboratoryProfile,
        productionContextData: hydratedSample.productionContextData
    });
    const auditTrail = await loadSampleAuditTrail(sample.id);

    return {
        ...hydratedSample,
        requestedParameterIds,
        requestedParameters,
        entityContext,
        auditTrail,
        workflowSteps: hydratedSample.workflowType === 'EXTERNAL'
            ? buildExternalWorkflowSteps({
                ...hydratedSample,
                requestedParameterIds
            })
            : hydratedSample.workflowType === 'INTERNAL'
                ? buildInternalWorkflowSteps({
                    ...hydratedSample,
                    requestedParameterIds
                })
                : [],
        summary: buildSampleSummary({
            ...hydratedSample,
            requestedParameterIds
        })
    };
};

const buildPointPayload = (body = {}) => {
    const payload = {
        code: normalizeOptionalText(body.code)?.toUpperCase() || null,
        name: normalizeOptionalText(body.name),
        description: normalizeOptionalText(body.description),
        processArea: normalizeOptionalText(body.processArea),
        zoneName: normalizeOptionalText(body.zoneName),
        defaultAssignedLab: normalizeOptionalText(body.defaultAssignedLab),
        defaultLaboratoryProfile: normalizeOptionalText(body.defaultLaboratoryProfile),
        allowedLaboratoryProfiles: body.allowedLaboratoryProfiles === undefined
            ? undefined
            : normalizeJsonArray(body.allowedLaboratoryProfiles).filter(profile => MICRO_LABORATORY_PROFILES.includes(profile)),
        defaultWorkContext: normalizeOptionalText(body.defaultWorkContext),
        allowedWorkContexts: body.allowedWorkContexts === undefined
            ? undefined
            : normalizeWorkContextCollection(body.allowedWorkContexts, []),
        defaultShift: normalizeOptionalText(body.defaultShift),
        allowedShifts: body.allowedShifts === undefined
            ? undefined
            : normalizeJsonArray(body.allowedShifts).filter(shift => MICRO_SHIFTS.includes(shift)),
        defaultWorkflowType: normalizeOptionalText(body.defaultWorkflowType),
        allowedWorkflowTypes: body.allowedWorkflowTypes === undefined
            ? undefined
            : normalizeJsonArray(body.allowedWorkflowTypes).filter(type => MICRO_WORKFLOW_TYPES.includes(type)),
        isEnvironmental: body.isEnvironmental === undefined
            ? undefined
            : body.isEnvironmental === true || body.isEnvironmental === 'true',
        isActive: body.isActive === undefined ? undefined : body.isActive === true || body.isActive === 'true'
    };

    const sortOrderValue = body.sortOrder !== undefined && body.sortOrder !== null && `${body.sortOrder}` !== ''
        ? Number(body.sortOrder)
        : undefined;

    if (sortOrderValue !== undefined && Number.isNaN(sortOrderValue)) {
        const error = new Error('El orden debe ser un número válido');
        error.statusCode = 400;
        throw error;
    }

    payload.sortOrder = sortOrderValue;

    if (payload.defaultWorkContext) {
        payload.allowedWorkContexts = Array.from(new Set([
            ...(payload.allowedWorkContexts || []),
            payload.defaultWorkContext
        ]));
    }

    if (payload.defaultLaboratoryProfile) {
        payload.allowedLaboratoryProfiles = Array.from(new Set([
            ...(payload.allowedLaboratoryProfiles || []),
            payload.defaultLaboratoryProfile
        ]));
    }

    if (payload.defaultShift) {
        payload.allowedShifts = Array.from(new Set([
            ...(payload.allowedShifts || []),
            payload.defaultShift
        ]));
    }

    if (payload.defaultWorkflowType) {
        payload.allowedWorkflowTypes = Array.from(new Set([
            ...(payload.allowedWorkflowTypes || []),
            payload.defaultWorkflowType
        ]));
    }

    return payload;
};

const validatePointPayload = (payload) => {
    if (!payload.code) {
        const error = new Error('Debe ingresar un código para el punto de muestreo');
        error.statusCode = 400;
        throw error;
    }

    if (!payload.name) {
        const error = new Error('Debe ingresar un nombre para el punto de muestreo');
        error.statusCode = 400;
        throw error;
    }
};

const decoratePointResponse = (point) => {
    const mappedPoint = mapPointWithConfig(point);
    const usage = point._count
        ? {
            samples: point._count.samples || 0,
            scheduleEntries: point._count.scheduleEntries || 0
        }
        : undefined;

    return usage ? { ...mappedPoint, usage } : mappedPoint;
};

const mapPointWithConfig = (point) => {
    const config = buildPointConfig(point);

    return {
        ...point,
        ...config
    };
};

const buildPointSummary = (point) => {
    const pointWithConfig = mapPointWithConfig(point);

    return {
        id: point.id,
        code: point.code,
        name: point.name,
        description: point.description,
        processArea: point.processArea,
        isEnvironmental: point.isEnvironmental,
        sortOrder: point.sortOrder,
        isActive: point.isActive,
        zoneCode: pointWithConfig.zoneCode,
        zoneName: pointWithConfig.zoneName,
        allowedLaboratoryProfiles: pointWithConfig.allowedLaboratoryProfiles,
        allowedWorkContexts: pointWithConfig.allowedWorkContexts,
        allowedShifts: pointWithConfig.allowedShifts,
        allowedWorkflowTypes: pointWithConfig.allowedWorkflowTypes,
        defaultLaboratoryProfile: pointWithConfig.defaultLaboratoryProfile,
        defaultWorkContext: pointWithConfig.defaultWorkContext,
        defaultShift: pointWithConfig.defaultShift,
        defaultWorkflowType: pointWithConfig.defaultWorkflowType,
        defaultAssignedLab: pointWithConfig.defaultAssignedLab
    };
};

const buildSamplePayloadFromInput = async (tx, sampleId) => {
    const sample = await tx.microSample.findUnique({
        where: { id: sampleId },
        include: SAMPLE_DETAIL_INCLUDE
    });

    if (!sample) return null;

    return {
        ...sample,
        summary: buildSampleSummary(sample)
    };
};

const getScheduleActorInfo = (req) => ({
    userId: req.user?.id || null,
    userName: req.user?.name || null
});

const buildScheduleAuditEvent = (req, payload = {}) => buildScheduleHistoryEvent({
    ...payload,
    ...getScheduleActorInfo(req)
});

const getScheduleDisplayStatus = (entry, sample = entry?.sample || null) => {
    if (!entry) return 'PLANNED';
    return deriveScheduleEntryStatus(sample, entry);
};

const getComparableSchedulePayload = (entry = {}) => ({
    samplingPointId: entry.samplingPointId || entry.point?.id || null,
    plannedDate: entry.plannedDate ? toIsoDate(entry.plannedDate) : null,
    plannedTime: entry.plannedTime || null,
    shift: entry.shift || null,
    workContext: entry.workContext || null,
    workflowType: entry.workflowType || null,
    laboratoryProfile: entry.laboratoryProfile || null
});

const hasSchedulingCoordinateChanges = (entry, nextPayload) => {
    const current = getComparableSchedulePayload(entry);
    const next = getComparableSchedulePayload(nextPayload);

    return (
        current.samplingPointId !== next.samplingPointId
        || current.plannedDate !== next.plannedDate
        || current.plannedTime !== next.plannedTime
        || current.shift !== next.shift
        || current.workContext !== next.workContext
        || current.workflowType !== next.workflowType
        || current.laboratoryProfile !== next.laboratoryProfile
    );
};

const canDeleteScheduleEntry = (entry) => (
    !entry?.sampleId
    && (entry?.status || 'PLANNED') === 'PLANNED'
    && getScheduleDisplayStatus(entry, entry?.sample) === 'PLANNED'
    && normalizeScheduleHistory(entry?.statusHistory).length === 0
);

const buildScheduleUniquenessKey = ({ samplingPointId, plannedDate, shift, workContext, laboratoryProfile }) => (
    [
        samplingPointId || '',
        plannedDate || '',
        shift || '',
        workContext || '',
        laboratoryProfile || ''
    ].join('|')
);

const listScheduleDatesBounds = (targetDates = []) => {
    const sortedDates = [...targetDates].sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    return {
        firstDate,
        lastDate,
        startDate: firstDate ? buildUtcDateFromIso(firstDate, 0, 0, 0, 0) : null,
        endDate: lastDate ? buildUtcDateFromIso(lastDate, 23, 59, 59, 999) : null
    };
};

const appendScheduleCreationHistory = (req, {
    targetDate,
    scheduleMode,
    rangeStartDate,
    rangeEndDate,
    selectedWeekdays,
    source = 'MANUAL'
}) => ([
    buildScheduleAuditEvent(req, {
        action: scheduleMode === 'RANGE' ? 'CREATED_RANGE' : 'CREATED',
        status: 'PLANNED',
        toDate: targetDate,
        metadata: {
            source,
            scheduleMode,
            rangeStartDate,
            rangeEndDate,
            selectedWeekdays
        }
    })
]);

const buildScheduleEntryResponse = (entry, source = 'PLANNED') => {
    const point = entry.samplingPoint ? buildPointSummary(entry.samplingPoint) : null;
    const sample = entry.sample ? { ...entry.sample, summary: buildSampleSummary(entry.sample) } : null;
    const status = source === 'SUGGESTED'
        ? 'SUGGESTED'
        : getScheduleDisplayStatus(entry, sample);
    const rawStatus = entry.status || 'PLANNED';

    // Prefer relational junction, fallback to JSON for historical records
    const requestedParameterIds = resolveRequestedParameterIds(entry);

    return {
        id: entry.id,
        source,
        plannedDate: toIsoDate(entry.plannedDate),
        plannedTime: entry.plannedTime || null,
        shift: entry.shift || null,
        workContext: entry.workContext || null,
        workflowType: entry.workflowType || null,
        laboratoryProfile: entry.laboratoryProfile || null,
        assignedLab: entry.assignedLab || null,
        zoneName: entry.zoneName || point?.zoneName || null,
        requestedParameterIds,
        notes: entry.notes || null,
        status,
        rawStatus,
        canDelete: canDeleteScheduleEntry(entry),
        statusReason: entry.statusReason || null,
        statusHistory: normalizeScheduleHistory(entry.statusHistory),
        rescheduledFromId: entry.rescheduledFromId || null,
        point,
        sample
    };
};

const buildAdHocEntry = (sample) => ({
    id: `adhoc:${sample.id}`,
    samplingPoint: sample.samplingPoint,
    plannedDate: sample.takenAt,
    plannedTime: null,
    shift: sample.shift,
    workContext: sample.workContext,
    workflowType: sample.workflowType,
    laboratoryProfile: sample.laboratoryProfile,
    assignedLab: sample.lab,
    zoneName: sample.zoneName,
    notes: 'Registro creado sin programación semanal previa.',
    status: deriveScheduleEntryStatus(sample),
    sample
});

const recalculateSampleStatus = async (tx, sampleId, fallback = {}) => {
    const resultCount = await tx.microResult.count({ where: { sampleId } });
    const internalLogCount = await tx.microInternalLog.count({ where: { sampleId } });
    const sample = await tx.microSample.findUnique({
        where: { id: sampleId },
        include: {
            attachments: true
        }
    });

    if (!sample) return null;

    const status = deriveSampleStatus({
        workflowType: sample.workflowType,
        currentStatus: sample.status,
        resultCount,
        hasReport: Boolean(sample.reportUrl),
        hasLabMetadata: Boolean(sample.lab || sample.reportNumber),
        hasDispatch: Boolean(sample.dispatchAt),
        hasResultsReceipt: Boolean(sample.resultsReceivedAt),
        internalLogCount,
        closedAt: sample.closedAt,
        finalReportData: sample.finalReportData,
        receivedAt: sample.receivedAt,
        resultsCapturedAt: sample.resultsCapturedAt,
        reviewedAt: sample.reviewedAt,
        acceptanceData: sample.acceptanceData,
        technicalReviewData: sample.technicalReviewData,
        ...fallback
    });

    const completedAt = sample.workflowType === 'EXTERNAL' && resultCount > 0
        ? sample.completedAt || new Date()
        : sample.completedAt;

    return tx.microSample.update({
        where: { id: sampleId },
        data: {
            status,
            completedAt
        }
    });
};

const syncScheduleEntryStatus = async (tx, scheduleEntryId, sampleId = null) => {
    if (!scheduleEntryId) return null;

    let sample = null;
    if (sampleId) {
        sample = await tx.microSample.findUnique({
            where: { id: sampleId },
            select: { status: true }
        });
    } else {
        const entryWithSample = await tx.microScheduleEntry.findUnique({
            where: { id: scheduleEntryId },
            include: {
                sample: {
                    select: { status: true }
                }
            }
        });
        sample = entryWithSample?.sample || null;
    }

    return tx.microScheduleEntry.update({
        where: { id: scheduleEntryId },
        data: {
            status: deriveScheduleEntryStatus(sample)
        }
    });
};

const ensureScheduleEntryAvailability = async (scheduleEntryId) => {
    if (!scheduleEntryId) return null;

    const scheduleEntry = await prisma.microScheduleEntry.findUnique({
        where: { id: scheduleEntryId },
        include: {
            samplingPoint: true,
            sample: {
                select: { id: true, status: true }
            }
        }
    });

    if (!scheduleEntry) {
        const error = new Error('La programación seleccionada no existe');
        error.statusCode = 404;
        throw error;
    }

    if (scheduleEntry.sampleId) {
        const error = new Error('La programación seleccionada ya tiene un laboratorio asociado');
        error.statusCode = 400;
        throw error;
    }

    const effectiveStatus = getScheduleDisplayStatus(scheduleEntry, scheduleEntry.sample);
    if (MANUAL_SCHEDULE_STATUS_ACTIONS.has(effectiveStatus)) {
        const error = new Error('La programación seleccionada ya no puede iniciarse. Reagéndela o revise su trazabilidad.');
        error.statusCode = 400;
        throw error;
    }

    return scheduleEntry;
};

const buildFinalReportData = ({ sample, finalResults, internalLogs, finalConclusion, generatedById, approvalData = null }) => ({
    generatedAt: new Date(),
    generatedById,
    workflowType: 'INTERNAL',
    internalLogCount: internalLogs.length,
    finalResultCount: finalResults.length,
    nonCompliantResults: finalResults.filter(result => result.isCompliant === false).length,
    finalConclusion: finalConclusion || null,
    chronology: internalLogs.map(log => ({
        logDate: log.logDate,
        dayNumber: log.dayNumber,
        recordedById: log.recordedById
    })),
    sample: {
        id: sample.id,
        sampleNumber: sample.sampleNumber,
        pointId: sample.samplingPointId,
        zoneName: sample.zoneName,
        workContext: sample.workContext,
        shift: sample.shift,
        laboratoryProfile: sample.laboratoryProfile
    },
    acceptanceData: sample.acceptanceData || null,
    sampleTypeData: sample.sampleTypeData || null,
    analysisExecutionData: sample.analysisExecutionData || null,
    technicalReviewData: sample.technicalReviewData || null,
    deviationData: sample.deviationData || null,
    approvalData: approvalData || sample.approvalData || null,
    supportAttachments: (sample.attachments || [])
        .filter(attachment => attachment.category !== 'LAB_REPORT')
        .map(attachment => ({
            id: attachment.id,
            category: attachment.category,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            url: attachment.url,
            createdAt: attachment.createdAt
        }))
});

const sampleHasPhotoEvidence = (sample = {}) => (
    (sample.attachments || []).some(attachment => (
        attachment?.category === 'PHOTO'
        || attachment?.mimeType?.startsWith('image/')
        || /\.(png|jpe?g|webp|heic|heif)$/i.test(attachment?.originalName || '')
    ))
);

const sampleHasReportAttachment = (sample = {}) => (
    Boolean(sample.reportUrl)
    || (sample.attachments || []).some(attachment => attachment?.category === 'LAB_REPORT')
);

const buildDashboardResultSummary = (samples = []) => {
    const allResults = samples.flatMap(sample => sample.results || []);
    const evaluatedResults = allResults.filter(result => result.isCompliant !== null);
    const compliantResults = evaluatedResults.filter(result => result.isCompliant === true);
    const nonCompliantResults = evaluatedResults.filter(result => result.isCompliant === false);
    const resultsWithoutCriteria = allResults.filter(result => result.isCompliant === null);
    const missingCriteriaParameters = Array.from(new Map(
        resultsWithoutCriteria
            .filter(result => result?.parameter)
            .map(result => [result.parameter.id, {
                id: result.parameter.id,
                code: result.parameter.code,
                name: result.parameter.name
            }])
    ).values());

    return {
        totalResultsRecorded: allResults.length,
        evaluatedResults: evaluatedResults.length,
        compliantResults: compliantResults.length,
        nonCompliantCount: nonCompliantResults.length,
        resultsWithoutCriteria: resultsWithoutCriteria.length,
        evaluationCoverageRate: allResults.length > 0
            ? Math.round((evaluatedResults.length / allResults.length) * 100)
            : null,
        complianceRate: evaluatedResults.length > 0
            ? Math.round((compliantResults.length / evaluatedResults.length) * 100)
            : null,
        missingCriteriaParameters
    };
};

const buildDashboardEvidenceSummary = (samples = []) => {
    const externalSamples = samples.filter(sample => sample.workflowType !== 'INTERNAL');
    const samplesWithReport = samples.filter(sampleHasReportAttachment).length;
    const samplesWithPhotoEvidence = samples.filter(sampleHasPhotoEvidence).length;
    const externalSamplesWithPhotoEvidence = externalSamples.filter(sampleHasPhotoEvidence).length;

    return {
        totalSamplesWithReport: samplesWithReport,
        samplesWithoutReport: Math.max(samples.length - samplesWithReport, 0),
        reportCoverageRate: samples.length > 0
            ? Math.round((samplesWithReport / samples.length) * 100)
            : null,
        totalSamplesWithPhotoEvidence: samplesWithPhotoEvidence,
        externalSamples: externalSamples.length,
        externalSamplesWithPhotoEvidence,
        externalSamplesWithoutPhotoEvidence: Math.max(externalSamples.length - externalSamplesWithPhotoEvidence, 0),
        photoCoverageRate: externalSamples.length > 0
            ? Math.round((externalSamplesWithPhotoEvidence / externalSamples.length) * 100)
            : null
    };
};

const buildPointInsights = (samples = []) => Array.from(samples.reduce((accumulator, sample) => {
    const pointId = sample.samplingPoint?.id || sample.samplingPointId || `point:${sample.sampleNumber}`;
    const currentPoint = accumulator.get(pointId) || {
        id: pointId,
        code: sample.samplingPoint?.code || 'SIN-PUNTO',
        name: sample.samplingPoint?.name || 'Punto no disponible',
        sampleCount: 0,
        resultCount: 0,
        evaluatedResults: 0,
        nonCompliantCount: 0,
        reportCount: 0,
        photoEvidenceCount: 0,
        latestSampleAt: null
    };

    const sampleResults = sample.results || [];
    const evaluatedResults = sampleResults.filter(result => result.isCompliant !== null).length;
    const nonCompliantCount = sampleResults.filter(result => result.isCompliant === false).length;

    currentPoint.sampleCount += 1;
    currentPoint.resultCount += sampleResults.length;
    currentPoint.evaluatedResults += evaluatedResults;
    currentPoint.nonCompliantCount += nonCompliantCount;
    currentPoint.reportCount += sampleHasReportAttachment(sample) ? 1 : 0;
    currentPoint.photoEvidenceCount += sampleHasPhotoEvidence(sample) ? 1 : 0;

    const sampleTakenAt = sample.takenAt ? new Date(sample.takenAt) : null;
    if (sampleTakenAt && (!currentPoint.latestSampleAt || sampleTakenAt > new Date(currentPoint.latestSampleAt))) {
        currentPoint.latestSampleAt = sampleTakenAt;
    }

    accumulator.set(pointId, currentPoint);
    return accumulator;
}, new Map()).values()).map(point => ({
    ...point,
    latestSampleAt: point.latestSampleAt,
    evaluationCoverageRate: point.resultCount > 0
        ? Math.round((point.evaluatedResults / point.resultCount) * 100)
        : null,
    reportCoverageRate: point.sampleCount > 0
        ? Math.round((point.reportCount / point.sampleCount) * 100)
        : null,
    photoCoverageRate: point.sampleCount > 0
        ? Math.round((point.photoEvidenceCount / point.sampleCount) * 100)
        : null
})).sort((left, right) => (
    (right.nonCompliantCount - left.nonCompliantCount)
    || (right.evaluatedResults - left.evaluatedResults)
    || (right.sampleCount - left.sampleCount)
    || left.code.localeCompare(right.code)
));

const buildDataQualityWarnings = ({ resultSummary, evidenceSummary }) => {
    const warnings = [];

    if (resultSummary.resultsWithoutCriteria > 0) {
        warnings.push({
            id: 'missing-criteria',
            severity: 'WARNING',
            title: 'Resultados sin criterio configurado',
            message: `${resultSummary.resultsWithoutCriteria} resultado(s) aparecen en tendencias pero todavía no pueden calificarse como conformes o no conformes porque al parámetro le falta criterio microbiológico.`
        });
    }

    if (evidenceSummary.externalSamplesWithoutPhotoEvidence > 0) {
        warnings.push({
            id: 'missing-photo-evidence',
            severity: 'INFO',
            title: 'Muestras externas sin evidencia fotográfica',
            message: `${evidenceSummary.externalSamplesWithoutPhotoEvidence} muestra(s) externas del histórico no tienen foto adjunta. Esto suele venir de registros previos al flujo nuevo o cargas migradas.`
        });
    }

    if (evidenceSummary.samplesWithoutReport > 0) {
        warnings.push({
            id: 'missing-report',
            severity: 'INFO',
            title: 'Casos sin informe principal',
            message: `${evidenceSummary.samplesWithoutReport} muestra(s) todavía no tienen PDF principal asociado.`
        });
    }

    return warnings;
};

// ── Sampling Points ──
exports.getSamplingPoints = async (req, res) => {
    try {
        const includeInactive = parseBooleanQuery(req.query.includeInactive);
        const includeUsage = parseBooleanQuery(req.query.includeUsage);
        const points = await prisma.microSamplingPoint.findMany({
            where: includeInactive ? undefined : { isActive: true },
            include: {
                _count: includeUsage ? {
                    select: {
                        samples: true,
                        scheduleEntries: true
                    }
                } : undefined
            },
            orderBy: [
                { sortOrder: 'asc' },
                { createdAt: 'asc' }
            ]
        });

        res.json(points.map(decoratePointResponse));
    } catch (error) {
        respondWithError(res, error, 'Error fetching sampling points', 'Error al obtener puntos de muestreo');
    }
};

exports.createSamplingPoint = async (req, res) => {
    try {
        const payload = buildPointPayload(req.body);
        validatePointPayload(payload);

        const maxSortPoint = await prisma.microSamplingPoint.findFirst({
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true }
        });

        const zoneCode = await generateUniqueZoneCode(prisma, payload);

        const point = await prisma.microSamplingPoint.create({
            data: {
                code: payload.code,
                zoneCode,
                name: payload.name,
                description: payload.description,
                processArea: payload.processArea,
                isEnvironmental: payload.isEnvironmental ?? false,
                zoneName: payload.zoneName,
                defaultAssignedLab: payload.defaultAssignedLab,
                defaultLaboratoryProfile: payload.defaultLaboratoryProfile,
                allowedLaboratoryProfiles: payload.allowedLaboratoryProfiles,
                defaultWorkContext: payload.defaultWorkContext,
                allowedWorkContexts: payload.allowedWorkContexts,
                defaultShift: payload.defaultShift,
                allowedShifts: payload.allowedShifts,
                defaultWorkflowType: payload.defaultWorkflowType || 'EXTERNAL',
                allowedWorkflowTypes: payload.allowedWorkflowTypes,
                sortOrder: payload.sortOrder ?? ((maxSortPoint?.sortOrder || 0) + 1)
            },
            include: {
                _count: {
                    select: {
                        samples: true,
                        scheduleEntries: true
                    }
                }
            }
        });

        res.status(201).json({
            message: 'Punto de muestreo creado',
            point: decoratePointResponse(point)
        });
    } catch (error) {
        if (error.code === 'P2002') {
            error.statusCode = 400;
            error.message = 'Ya existe un punto con ese código. Debe ser único.';
        }
        respondWithError(res, error, 'Error creating sampling point', 'Error al crear punto de muestreo');
    }
};

exports.updateSamplingPoint = async (req, res) => {
    try {
        const { id } = req.params;
        const currentPoint = await prisma.microSamplingPoint.findUnique({
            where: { id }
        });

        if (!currentPoint) {
            const error = new Error('Punto de muestreo no encontrado');
            error.statusCode = 404;
            throw error;
        }

        const payload = buildPointPayload(req.body);
        const mergedPayload = {
            code: payload.code ?? currentPoint.code,
            name: payload.name ?? currentPoint.name,
            description: payload.description !== undefined ? payload.description : currentPoint.description,
            processArea: payload.processArea !== undefined ? payload.processArea : currentPoint.processArea,
            zoneName: payload.zoneName !== undefined ? payload.zoneName : currentPoint.zoneName,
            defaultAssignedLab: payload.defaultAssignedLab !== undefined ? payload.defaultAssignedLab : currentPoint.defaultAssignedLab,
            defaultLaboratoryProfile: payload.defaultLaboratoryProfile !== undefined ? payload.defaultLaboratoryProfile : currentPoint.defaultLaboratoryProfile,
            allowedLaboratoryProfiles: payload.allowedLaboratoryProfiles !== undefined
                ? payload.allowedLaboratoryProfiles
                : currentPoint.allowedLaboratoryProfiles,
            defaultWorkContext: payload.defaultWorkContext !== undefined ? payload.defaultWorkContext : currentPoint.defaultWorkContext,
            allowedWorkContexts: payload.allowedWorkContexts !== undefined
                ? payload.allowedWorkContexts
                : currentPoint.allowedWorkContexts,
            defaultShift: payload.defaultShift !== undefined ? payload.defaultShift : currentPoint.defaultShift,
            allowedShifts: payload.allowedShifts !== undefined
                ? payload.allowedShifts
                : currentPoint.allowedShifts,
            defaultWorkflowType: payload.defaultWorkflowType || currentPoint.defaultWorkflowType,
            allowedWorkflowTypes: payload.allowedWorkflowTypes !== undefined
                ? payload.allowedWorkflowTypes
                : currentPoint.allowedWorkflowTypes,
            isEnvironmental: payload.isEnvironmental !== undefined ? payload.isEnvironmental : currentPoint.isEnvironmental,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
        };

        validatePointPayload(mergedPayload);

        if (mergedPayload.defaultWorkContext) {
            mergedPayload.allowedWorkContexts = Array.from(new Set([
                ...(mergedPayload.allowedWorkContexts || []),
                mergedPayload.defaultWorkContext
            ]));
        }

        if (mergedPayload.defaultLaboratoryProfile) {
            mergedPayload.allowedLaboratoryProfiles = Array.from(new Set([
                ...(mergedPayload.allowedLaboratoryProfiles || []),
                mergedPayload.defaultLaboratoryProfile
            ]));
        }

        if (mergedPayload.defaultShift) {
            mergedPayload.allowedShifts = Array.from(new Set([
                ...(mergedPayload.allowedShifts || []),
                mergedPayload.defaultShift
            ]));
        }

        if (mergedPayload.defaultWorkflowType) {
            mergedPayload.allowedWorkflowTypes = Array.from(new Set([
                ...(mergedPayload.allowedWorkflowTypes || []),
                mergedPayload.defaultWorkflowType
            ]));
        }

        const zoneCode = currentPoint.zoneCode || await generateUniqueZoneCode(prisma, mergedPayload, id);

        const point = await prisma.microSamplingPoint.update({
            where: { id },
            data: {
                code: mergedPayload.code,
                zoneCode,
                name: mergedPayload.name,
                description: mergedPayload.description,
                processArea: mergedPayload.processArea,
                zoneName: mergedPayload.zoneName,
                isEnvironmental: mergedPayload.isEnvironmental,
                isActive: mergedPayload.isActive !== undefined ? mergedPayload.isActive : currentPoint.isActive,
                defaultAssignedLab: mergedPayload.defaultAssignedLab,
                defaultLaboratoryProfile: mergedPayload.defaultLaboratoryProfile,
                allowedLaboratoryProfiles: mergedPayload.allowedLaboratoryProfiles,
                defaultWorkContext: mergedPayload.defaultWorkContext,
                allowedWorkContexts: mergedPayload.allowedWorkContexts,
                defaultShift: mergedPayload.defaultShift,
                allowedShifts: mergedPayload.allowedShifts,
                defaultWorkflowType: mergedPayload.defaultWorkflowType,
                allowedWorkflowTypes: mergedPayload.allowedWorkflowTypes,
                sortOrder: mergedPayload.sortOrder ?? currentPoint.sortOrder
            },
            include: {
                _count: {
                    select: {
                        samples: true,
                        scheduleEntries: true
                    }
                }
            }
        });

        res.json({
            message: mergedPayload.isActive === false
                ? 'Punto de muestreo deshabilitado'
                : mergedPayload.isActive === true && currentPoint.isActive === false
                    ? 'Punto de muestreo habilitado'
                    : 'Punto de muestreo actualizado',
            point: decoratePointResponse(point)
        });
    } catch (error) {
        if (error.code === 'P2002') {
            error.statusCode = 400;
            error.message = 'Ya existe un punto con ese código. Debe ser único.';
        }
        respondWithError(res, error, 'Error updating sampling point', 'Error al actualizar punto de muestreo');
    }
};

// ── Parameters ──
exports.getParameters = async (req, res) => {
    try {
        const params = await prisma.microParameter.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' }
        });
        res.json(params);
    } catch (error) {
        respondWithError(res, error, 'Error fetching micro parameters', 'Error al obtener parámetros');
    }
};

const ACTIVE_PRODUCTION_BATCH_STATUSES = ['PENDING', 'STAGE_1_BASE', 'STAGE_2_JARABE', 'STAGE_3_ESFERIFICACION', 'STAGE_4_PRODUCTO_FINAL', 'LABELING'];

const buildKeywordFilters = (keywords = []) => {
    const normalizedKeywords = Array.from(new Set(
        (Array.isArray(keywords) ? keywords : [])
            .map(keyword => `${keyword}`.trim())
            .filter(keyword => keyword.length >= 3)
    )).slice(0, 10);

    if (normalizedKeywords.length === 0) return [];

    return normalizedKeywords.flatMap(keyword => ([
        { siigoProductName: { contains: keyword, mode: 'insensitive' } },
        { lotNumber: { contains: keyword, mode: 'insensitive' } },
        { product: { is: { name: { contains: keyword, mode: 'insensitive' } } } }
    ]));
};

const buildContextBatchSummary = (batch) => {
    const activeNote = (batch.assemblyNotes || []).find(note => note.status === 'EXECUTING')
        || [...(batch.assemblyNotes || [])].reverse().find(note => note.status === 'COMPLETED')
        || (batch.assemblyNotes || [])[0]
        || null;

    return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        flavor: batch.flavor || batch.product?.flavor || null,
        status: batch.status,
        scheduledStart: batch.scheduledStart,
        scheduledEnd: batch.scheduledEnd,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        product: batch.product ? {
            id: batch.product.id,
            name: batch.product.name,
            sku: batch.product.sku,
            classification: batch.product.classification,
            type: batch.product.type,
            flavor: batch.product.flavor
        } : null,
        activeStage: activeNote ? {
            stageName: activeNote.stageName,
            status: activeNote.status,
            processType: activeNote.processType?.name || activeNote.processType?.code || null,
            startedAt: activeNote.startedAt,
            completedAt: activeNote.completedAt
        } : null,
        outputTargets: (batch.outputTargets || []).map(target => ({
            productId: target.productId,
            productName: target.product?.name || 'Producto',
            sku: target.product?.sku || null,
            classification: target.product?.classification || null,
            type: target.product?.type || null,
            flavor: target.product?.flavor || null,
            plannedUnits: target.plannedUnits,
            plannedWeightKg: target.plannedWeightKg
        }))
    };
};

exports.getSamplingContext = async (req, res) => {
    try {
        const samplingPointId = normalizeOptionalText(req.query.samplingPointId);
        if (!samplingPointId) {
            const error = new Error('Debe seleccionar un punto para consultar el contexto productivo');
            error.statusCode = 400;
            throw error;
        }

        const point = await prisma.microSamplingPoint.findUnique({ where: { id: samplingPointId } });
        if (!point) {
            const error = new Error('Punto de muestreo no encontrado');
            error.statusCode = 404;
            throw error;
        }

        const targetAt = normalizeOptionalDateTime(req.query.takenAt || req.query.targetAt, 'la fecha de la toma') || new Date();
        const dayStart = new Date(targetAt);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(targetAt);
        dayEnd.setHours(23, 59, 59, 999);
        const bufferedStart = new Date(targetAt.getTime() - (6 * 60 * 60 * 1000));
        const bufferedEnd = new Date(targetAt.getTime() + (6 * 60 * 60 * 1000));

        const laboratoryProfile = normalizeOptionalText(req.query.laboratoryProfile);
        const productionContextData = normalizeJsonObject(req.query.productionContextData, 'productionContextData') || {};
        const entityContext = buildSampleEntityContext({
            point,
            laboratoryProfile,
            productionContextData
        });

        const [scheduleEntries, activeBatches] = await Promise.all([
            prisma.microScheduleEntry.findMany({
                where: {
                    samplingPointId,
                    plannedDate: {
                        gte: dayStart,
                        lte: dayEnd
                    },
                    sampleId: null,
                    status: {
                        notIn: ['CANCELLED', 'RESCHEDULED', 'COMPLETED', 'CLOSED']
                    }
                },
                orderBy: [
                    { plannedDate: 'asc' },
                    { plannedTime: 'asc' }
                ]
            }),
            prisma.productionBatch.findMany({
                where: {
                    OR: [
                        {
                            startedAt: { not: null, lte: bufferedEnd },
                            completedAt: null
                        },
                        {
                            scheduledStart: { not: null, lte: bufferedEnd },
                            scheduledEnd: { not: null, gte: bufferedStart }
                        },
                        {
                            createdAt: { gte: dayStart, lte: dayEnd },
                            status: { in: ACTIVE_PRODUCTION_BATCH_STATUSES }
                        }
                    ]
                },
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            sku: true,
                            classification: true,
                            type: true,
                            flavor: true
                        }
                    },
                    outputTargets: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    sku: true,
                                    classification: true,
                                    type: true,
                                    flavor: true
                                }
                            }
                        },
                        orderBy: [
                            { plannedWeightKg: 'desc' },
                            { plannedUnits: 'desc' }
                        ]
                    },
                    assemblyNotes: {
                        orderBy: { stageOrder: 'asc' },
                        include: {
                            processType: {
                                select: { code: true, name: true }
                            }
                        }
                    }
                },
                orderBy: [
                    { startedAt: 'desc' },
                    { scheduledStart: 'desc' },
                    { createdAt: 'desc' }
                ],
                take: 16
            })
        ]);

        const batchSummaries = activeBatches.map(buildContextBatchSummary);
        const productMap = new Map();
        const activeFlavors = new Set();

        batchSummaries.forEach((batch) => {
            if (batch.flavor) activeFlavors.add(batch.flavor);

            if (batch.product?.id) {
                const key = batch.product.id;
                const existing = productMap.get(key) || {
                    productId: batch.product.id,
                    name: batch.product.name,
                    sku: batch.product.sku,
                    classification: batch.product.classification,
                    type: batch.product.type,
                    flavor: batch.product.flavor,
                    sourceBatchIds: [],
                    plannedUnits: 0,
                    plannedWeightKg: 0
                };
                existing.sourceBatchIds = Array.from(new Set([...existing.sourceBatchIds, batch.id]));
                productMap.set(key, existing);
            }

            batch.outputTargets.forEach((target) => {
                const key = target.productId;
                const existing = productMap.get(key) || {
                    productId: target.productId,
                    name: target.productName,
                    sku: target.sku,
                    classification: target.classification,
                    type: target.type,
                    flavor: target.flavor,
                    sourceBatchIds: [],
                    plannedUnits: 0,
                    plannedWeightKg: 0
                };
                existing.sourceBatchIds = Array.from(new Set([...existing.sourceBatchIds, batch.id]));
                existing.plannedUnits += target.plannedUnits || 0;
                existing.plannedWeightKg += target.plannedWeightKg || 0;
                productMap.set(key, existing);
                if (target.flavor) activeFlavors.add(target.flavor);
            });
        });

        const materialLotFilters = buildKeywordFilters(entityContext.keywords);
        const relevantMaterialLots = materialLotFilters.length > 0
            ? await prisma.materialLot.findMany({
                where: {
                    currentQuantity: { gt: 0 },
                    OR: materialLotFilters
                },
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            sku: true,
                            classification: true,
                            type: true
                        }
                    }
                },
                orderBy: [
                    { zone: 'asc' },
                    { receivedAt: 'desc' }
                ],
                take: 20
            })
            : [];

        const normalizedFlavorList = Array.from(activeFlavors).filter(Boolean);
        const [productionLots, syrupLots] = await Promise.all([
            prisma.productionLot.findMany({
                where: {
                    productionDate: {
                        gte: new Date(dayStart.getTime() - (3 * 24 * 60 * 60 * 1000)),
                        lte: dayEnd
                    },
                    ...(normalizedFlavorList.length > 0
                        ? { flavor: { in: normalizedFlavorList } }
                        : {})
                },
                orderBy: { productionDate: 'desc' },
                take: 12
            }),
            prisma.syrupLot.findMany({
                where: {
                    productionDate: {
                        gte: new Date(dayStart.getTime() - (3 * 24 * 60 * 60 * 1000)),
                        lte: dayEnd
                    },
                    ...(normalizedFlavorList.length > 0
                        ? { flavor: { in: normalizedFlavorList } }
                        : {})
                },
                orderBy: { productionDate: 'desc' },
                take: 12
            })
        ]);

        res.json({
            point: buildPointSummary(point),
            entityContext,
            scheduleCandidates: scheduleEntries.map(entry => buildScheduleEntryResponse(entry)),
            activeBatches: batchSummaries,
            productsInProduction: Array.from(productMap.values()),
            relevantMaterialLots: relevantMaterialLots.map(lot => ({
                id: lot.id,
                lotNumber: lot.lotNumber,
                productName: lot.product?.name || lot.siigoProductName,
                sku: lot.product?.sku || lot.siigoProductCode,
                currentQuantity: lot.currentQuantity,
                status: lot.status,
                zone: lot.zone,
                receivedAt: lot.receivedAt
            })),
            registryLots: {
                productionLots: productionLots.map(lot => ({
                    id: lot.id,
                    lotCode: lot.lotCode,
                    premixLot: lot.premixLot,
                    flavor: lot.flavor,
                    alginateLotCode: lot.alginateLotCode,
                    productionDate: lot.productionDate,
                    units3400: lot.units3400,
                    units1150: lot.units1150,
                    units350: lot.units350
                })),
                syrupLots: syrupLots.map(lot => ({
                    id: lot.id,
                    lotCode: lot.lotCode,
                    flavor: lot.flavor,
                    productionDate: lot.productionDate,
                    assemblyNote: lot.assemblyNote,
                    bxJarabe: lot.bxJarabe,
                    phJarabe: lot.phJarabe
                }))
            }
        });
    } catch (error) {
        respondWithError(res, error, 'Error fetching micro sampling context', 'Error al obtener contexto productivo de microbiología');
    }
};

// ── Week Schedule (Programación Semanal) ──
exports.getWeekSchedule = async (req, res) => {
    try {
        const { startDate, endDate, weekStart, weekEnd } = getWeekRange(req.query.weekStart);

        const points = await prisma.microSamplingPoint.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' }
        });

        const scheduleEntries = await prisma.microScheduleEntry.findMany({
            where: {
                plannedDate: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: SCHEDULE_ENTRY_INCLUDE,
            orderBy: [
                { plannedDate: 'asc' },
                { plannedTime: 'asc' },
                { shift: 'asc' }
            ]
        });

        const linkedSampleIds = scheduleEntries.map(entry => entry.sampleId).filter(Boolean);
        const adHocSamples = await prisma.microSample.findMany({
            where: {
                takenAt: {
                    gte: startDate,
                    lte: endDate
                },
                id: linkedSampleIds.length > 0 ? { notIn: linkedSampleIds } : undefined
            },
            include: SAMPLE_DETAIL_INCLUDE,
            orderBy: { takenAt: 'asc' }
        });

        const entriesByDate = new Map();

        scheduleEntries.forEach(entry => {
            const dateKey = toIsoDate(entry.plannedDate);
            if (!entriesByDate.has(dateKey)) entriesByDate.set(dateKey, []);
            entriesByDate.get(dateKey).push(buildScheduleEntryResponse(entry));
        });

        adHocSamples.forEach(sample => {
            const dateKey = toIsoDate(sample.takenAt);
            if (!entriesByDate.has(dateKey)) entriesByDate.set(dateKey, []);
            entriesByDate.get(dateKey).push(buildScheduleEntryResponse(buildAdHocEntry(sample), 'AD_HOC'));
        });

        const days = Array.from({ length: 7 }, (_, index) => {
            const currentDate = addUtcDays(startDate, index);
            const dateKey = toIsoDate(currentDate);
            const entries = (entriesByDate.get(dateKey) || []).sort((left, right) => {
                const leftTime = left.plannedTime || '99:99';
                const rightTime = right.plannedTime || '99:99';
                if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
                return (left.point?.sortOrder || 0) - (right.point?.sortOrder || 0);
            });

            return {
                date: dateKey,
                dayOfWeek: currentDate.getUTCDay(),
                entries,
                summary: {
                    planned: entries.filter(entry => entry.status === 'PLANNED').length,
                    inProgress: entries.filter(entry => entry.status === 'IN_PROGRESS' || entry.status === 'IN_PROCESS').length,
                    awaitingResults: entries.filter(entry => entry.status === 'AWAITING_RESULTS').length,
                    delayed: entries.filter(entry => entry.status === 'DELAYED').length,
                    cancelled: entries.filter(entry => entry.status === 'CANCELLED').length,
                    notPerformed: entries.filter(entry => entry.status === 'NOT_PERFORMED').length,
                    rescheduled: entries.filter(entry => entry.status === 'RESCHEDULED').length,
                    completed: entries.filter(entry => entry.status === 'COMPLETED' || entry.status === 'CLOSED').length
                }
            };
        });

        const summary = days.reduce((accumulator, day) => ({
            planned: accumulator.planned + day.summary.planned,
            inProgress: accumulator.inProgress + day.summary.inProgress,
            awaitingResults: accumulator.awaitingResults + day.summary.awaitingResults,
            delayed: accumulator.delayed + day.summary.delayed,
            cancelled: accumulator.cancelled + day.summary.cancelled,
            notPerformed: accumulator.notPerformed + day.summary.notPerformed,
            rescheduled: accumulator.rescheduled + day.summary.rescheduled,
            completed: accumulator.completed + day.summary.completed
        }), {
            planned: 0,
            inProgress: 0,
            awaitingResults: 0,
            delayed: 0,
            cancelled: 0,
            notPerformed: 0,
            rescheduled: 0,
            completed: 0
        });

        res.json({
            weekStart,
            weekEnd,
            summary,
            points: points.map(buildPointSummary),
            days
        });
    } catch (error) {
        respondWithError(res, error, 'Error fetching weekly micro schedule', 'Error al obtener programación semanal');
    }
};

exports.generateWeekPlan = async (req, res) => {
    try {
        const error = new Error('La base semanal automática fue retirada. Use programación manual o programación por rango.');
        error.statusCode = 410;
        throw error;
    } catch (error) {
        respondWithError(res, error, 'Error generating weekly plan', 'Error al generar la programación semanal');
    }
};

exports.createScheduleEntry = async (req, res) => {
    try {
        const {
            samplingPointId,
            plannedDate,
            scheduleMode,
            rangeStartDate,
            rangeEndDate,
            selectedWeekdays,
            plannedTime,
            shift,
            workContext,
            workflowType,
            laboratoryProfile,
            assignedLab,
            requestedParameterIds,
            notes
        } = req.body;

        if (!samplingPointId) {
            const error = new Error('Debe seleccionar un punto para programar el laboratorio');
            error.statusCode = 400;
            throw error;
        }

        const point = await prisma.microSamplingPoint.findUnique({ where: { id: samplingPointId } });
        if (!point) {
            const error = new Error('Punto de muestreo no encontrado');
            error.statusCode = 404;
            throw error;
        }

        const normalized = normalizeSchedulePayload(point, {
            plannedTime,
            shift,
            workContext,
            workflowType,
            laboratoryProfile,
            assignedLab
        });
        const normalizedRequestedParameterIds = await validateRequestedParametersExist(
            prisma,
            normalizeRequestedParameterIds(requestedParameterIds)
        );
        const scheduleDatePlan = buildScheduleDatePlan({
            scheduleMode,
            plannedDate,
            rangeStartDate,
            rangeEndDate,
            selectedWeekdays
        });
        const { startDate, endDate } = listScheduleDatesBounds(scheduleDatePlan.targetDates);

        const existingEntries = await prisma.microScheduleEntry.findMany({
            where: {
                samplingPointId,
                plannedDate: {
                    gte: startDate,
                    lte: endDate
                },
                shift: normalized.shift,
                workContext: normalized.workContext,
                laboratoryProfile: normalized.laboratoryProfile
            },
            include: {
                samplingPoint: true,
                sample: {
                    include: SAMPLE_DETAIL_INCLUDE
                }
            },
            orderBy: { plannedDate: 'asc' }
        });

        const existingKeys = new Set(existingEntries.map(entry => buildScheduleUniquenessKey({
            samplingPointId: entry.samplingPointId,
            plannedDate: toIsoDate(entry.plannedDate),
            shift: entry.shift,
            workContext: entry.workContext,
            laboratoryProfile: entry.laboratoryProfile
        })));
        const datesToCreate = scheduleDatePlan.targetDates.filter(targetDate => !existingKeys.has(buildScheduleUniquenessKey({
            samplingPointId,
            plannedDate: targetDate,
            shift: normalized.shift,
            workContext: normalized.workContext,
            laboratoryProfile: normalized.laboratoryProfile
        })));

        if (datesToCreate.length === 0) {
            const error = new Error(
                scheduleDatePlan.scheduleMode === 'RANGE'
                    ? 'El rango seleccionado ya tiene programaciones creadas para esos criterios. Ajuste fechas, días o parámetros.'
                    : 'Ya existe una programación con el mismo punto, fecha, turno, contexto y tipo.'
            );
            error.statusCode = 400;
            throw error;
        }

        const createdEntries = [];
        await prisma.$transaction(async (tx) => {
            for (const targetDate of datesToCreate) {
                const createdEntry = await tx.microScheduleEntry.create({
                    data: {
                        samplingPointId,
                        plannedDate: buildUtcDateFromIso(targetDate),
                        plannedTime: normalized.plannedTime,
                        shift: normalized.shift,
                        workContext: normalized.workContext,
                        workflowType: normalized.workflowType,
                        laboratoryProfile: normalized.laboratoryProfile,
                        assignedLab: normalized.assignedLab,
                        zoneName: normalized.zoneName,
                        requestedParameterIds: normalizedRequestedParameterIds,
                        notes: notes || null,
                        status: 'PLANNED',
                        statusHistory: appendScheduleCreationHistory(req, {
                            targetDate,
                            scheduleMode: scheduleDatePlan.scheduleMode,
                            rangeStartDate: scheduleDatePlan.rangeStartDate,
                            rangeEndDate: scheduleDatePlan.rangeEndDate,
                            selectedWeekdays: scheduleDatePlan.selectedWeekdays
                        }),
                        createdById: req.user.id
                    },
                    include: SCHEDULE_ENTRY_INCLUDE
                });

                // Dual-write: sync junction table
                if (normalizedRequestedParameterIds.length > 0) {
                    await tx.microScheduleEntryParameter.createMany({
                        data: normalizedRequestedParameterIds.map(parameterId => ({
                            entryId: createdEntry.id,
                            parameterId
                        })),
                        skipDuplicates: true
                    });
                }

                createdEntries.push(createdEntry);
            }
        });

        res.status(201).json({
            message: scheduleDatePlan.scheduleMode === 'RANGE'
                ? `Se crearon ${createdEntries.length} programaciones dentro del rango`
                : 'Programación creada',
            entry: buildScheduleEntryResponse(createdEntries[0]),
            entries: createdEntries.map(createdEntry => buildScheduleEntryResponse(createdEntry)),
            createdCount: createdEntries.length,
            skippedCount: scheduleDatePlan.targetDates.length - createdEntries.length,
            scheduleMode: scheduleDatePlan.scheduleMode
        });
    } catch (error) {
        respondWithError(res, error, 'Error creating schedule entry', 'Error al crear la programación');
    }
};

exports.updateScheduleEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const existingEntry = await prisma.microScheduleEntry.findUnique({
            where: { id },
            include: {
                samplingPoint: true,
                sample: true
            }
        });

        if (!existingEntry) {
            const error = new Error('Programación no encontrada');
            error.statusCode = 404;
            throw error;
        }

        if (existingEntry.status === 'RESCHEDULED') {
            const error = new Error('La programación reagendada es solo de consulta. Revise la trazabilidad o use la nueva programación activa.');
            error.statusCode = 400;
            throw error;
        }

        const nextPointId = req.body.samplingPointId || existingEntry.samplingPointId;
        if (existingEntry.sampleId && nextPointId !== existingEntry.samplingPointId) {
            const error = new Error('No puede cambiar el punto cuando la programación ya tiene un laboratorio asociado');
            error.statusCode = 400;
            throw error;
        }

        if (existingEntry.sampleId && req.body.workflowType && req.body.workflowType !== existingEntry.workflowType) {
            const error = new Error('No puede cambiar el flujo interno/externo cuando el laboratorio ya fue iniciado');
            error.statusCode = 400;
            throw error;
        }

        const point = nextPointId === existingEntry.samplingPointId
            ? existingEntry.samplingPoint
            : await prisma.microSamplingPoint.findUnique({ where: { id: nextPointId } });

        if (!point) {
            const error = new Error('Punto de muestreo no encontrado');
            error.statusCode = 404;
            throw error;
        }

        const normalized = normalizeSchedulePayload(point, {
            plannedTime: req.body.plannedTime || existingEntry.plannedTime,
            shift: req.body.shift || existingEntry.shift,
            workContext: req.body.workContext || existingEntry.workContext,
            workflowType: req.body.workflowType || existingEntry.workflowType,
            laboratoryProfile: req.body.laboratoryProfile || existingEntry.laboratoryProfile,
            assignedLab: req.body.assignedLab || existingEntry.assignedLab
        });
        const nextRequestedParameterIds = req.body.requestedParameterIds !== undefined
            ? await validateRequestedParametersExist(prisma, normalizeRequestedParameterIds(req.body.requestedParameterIds))
            : normalizeRequestedParameterIdList(existingEntry.requestedParameterIds);

        const nextPlannedDate = req.body.plannedDate
            ? buildUtcDateFromIso(`${req.body.plannedDate}`.slice(0, 10))
            : existingEntry.plannedDate;
        const nextStatusReason = req.body.statusReason !== undefined
            ? normalizeOptionalText(req.body.statusReason)
            : existingEntry.statusReason;
        const nextNotes = req.body.notes !== undefined ? req.body.notes : existingEntry.notes;
        const nextScheduleSnapshot = {
            samplingPointId: nextPointId,
            plannedDate: nextPlannedDate,
            plannedTime: normalized.plannedTime,
            shift: normalized.shift,
            workContext: normalized.workContext,
            workflowType: normalized.workflowType,
            laboratoryProfile: normalized.laboratoryProfile
        };

        if (!existingEntry.sampleId && hasSchedulingCoordinateChanges(existingEntry, nextScheduleSnapshot)) {
            const error = new Error('Para cambiar fecha, hora, turno, contexto, punto, flujo o tipo debe usar la opción de reagendar y conservar la trazabilidad.');
            error.statusCode = 400;
            throw error;
        }

        const shouldAppendUpdateEvent = (
            nextNotes !== existingEntry.notes
            || nextStatusReason !== existingEntry.statusReason
            || normalized.assignedLab !== existingEntry.assignedLab
        );
        const nextStatusHistory = shouldAppendUpdateEvent
            ? appendScheduleHistory(existingEntry.statusHistory, buildScheduleAuditEvent(req, {
                action: 'UPDATED',
                status: existingEntry.status || 'PLANNED',
                reason: nextStatusReason,
                toDate: nextPlannedDate,
                metadata: {
                    assignedLab: normalized.assignedLab,
                    notesUpdated: nextNotes !== existingEntry.notes
                }
            }))
            : appendScheduleHistory(existingEntry.statusHistory);

        const updatedEntry = await prisma.$transaction(async (tx) => {
            const entry = await tx.microScheduleEntry.update({
                where: { id },
                data: {
                    samplingPointId: nextPointId,
                    plannedDate: nextPlannedDate,
                    plannedTime: normalized.plannedTime,
                    shift: normalized.shift,
                    workContext: normalized.workContext,
                    workflowType: normalized.workflowType,
                    laboratoryProfile: normalized.laboratoryProfile,
                    assignedLab: normalized.assignedLab,
                    zoneName: normalized.zoneName,
                    requestedParameterIds: nextRequestedParameterIds,
                    notes: nextNotes,
                    statusReason: nextStatusReason,
                    statusHistory: nextStatusHistory
                },
                include: SCHEDULE_ENTRY_INCLUDE
            });

            // Dual-write: re-sync junction table (delete + recreate)
            await tx.microScheduleEntryParameter.deleteMany({ where: { entryId: id } });
            if (nextRequestedParameterIds.length > 0) {
                await tx.microScheduleEntryParameter.createMany({
                    data: nextRequestedParameterIds.map(parameterId => ({ entryId: id, parameterId })),
                    skipDuplicates: true
                });
            }

            if (existingEntry.sampleId) {
                await tx.microSample.update({
                    where: { id: existingEntry.sampleId },
                    data: {
                        samplingPointId: nextPointId,
                        workContext: normalized.workContext,
                        shift: normalized.shift,
                        zoneName: normalized.zoneName,
                        laboratoryProfile: normalized.laboratoryProfile,
                        requestedParameterIds: nextRequestedParameterIds,
                        lab: existingEntry.sample?.workflowType === 'INTERNAL'
                            ? INTERNAL_DEFAULT_LAB
                            : normalized.assignedLab
                    }
                });

                // Dual-write: re-sync sample junction table when entry has linked sample
                await tx.microSampleParameter.deleteMany({ where: { sampleId: existingEntry.sampleId } });
                if (nextRequestedParameterIds.length > 0) {
                    await tx.microSampleParameter.createMany({
                        data: nextRequestedParameterIds.map(parameterId => ({ sampleId: existingEntry.sampleId, parameterId })),
                        skipDuplicates: true
                    });
                }
            }

            return entry;
        });

        res.json({
            message: 'Programación actualizada',
            entry: buildScheduleEntryResponse(updatedEntry)
        });
    } catch (error) {
        respondWithError(res, error, 'Error updating schedule entry', 'Error al actualizar la programación');
    }
};

exports.cancelScheduleEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const entry = await prisma.microScheduleEntry.findUnique({
            where: { id },
            include: SCHEDULE_ENTRY_INCLUDE
        });

        if (!entry) {
            const error = new Error('Programación no encontrada');
            error.statusCode = 404;
            throw error;
        }

        if (entry.sampleId) {
            const error = new Error('No puede cancelar una programación que ya tiene un laboratorio asociado');
            error.statusCode = 400;
            throw error;
        }

        if (entry.status === 'CANCELLED') {
            const error = new Error('La programación ya está cancelada');
            error.statusCode = 400;
            throw error;
        }

        if (entry.status === 'RESCHEDULED') {
            const error = new Error('La programación reagendada ya quedó cerrada para trazabilidad y no puede cancelarse nuevamente');
            error.statusCode = 400;
            throw error;
        }

        const reason = normalizeOptionalText(req.body.statusReason || req.body.reason);
        const updatedEntry = await prisma.microScheduleEntry.update({
            where: { id },
            data: {
                status: 'CANCELLED',
                statusReason: reason,
                statusHistory: appendScheduleHistory(entry.statusHistory, buildScheduleAuditEvent(req, {
                    action: 'CANCELLED',
                    status: 'CANCELLED',
                    reason,
                    fromDate: entry.plannedDate,
                    metadata: {
                        previousStatus: getScheduleDisplayStatus(entry, entry.sample)
                    }
                }))
            },
            include: SCHEDULE_ENTRY_INCLUDE
        });

        res.json({
            message: 'Programación cancelada',
            entry: buildScheduleEntryResponse(updatedEntry)
        });
    } catch (error) {
        respondWithError(res, error, 'Error cancelling schedule entry', 'Error al cancelar la programación');
    }
};

exports.rescheduleScheduleEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const existingEntry = await prisma.microScheduleEntry.findUnique({
            where: { id },
            include: SCHEDULE_ENTRY_INCLUDE
        });

        if (!existingEntry) {
            const error = new Error('Programación no encontrada');
            error.statusCode = 404;
            throw error;
        }

        if (existingEntry.sampleId) {
            const error = new Error('No puede reagendar una programación que ya tiene un laboratorio asociado');
            error.statusCode = 400;
            throw error;
        }

        if (existingEntry.status === 'RESCHEDULED') {
            const error = new Error('Esta programación ya fue reagendada. Use la nueva programación activa.');
            error.statusCode = 400;
            throw error;
        }

        const nextPointId = req.body.samplingPointId || existingEntry.samplingPointId;
        const point = nextPointId === existingEntry.samplingPointId
            ? existingEntry.samplingPoint
            : await prisma.microSamplingPoint.findUnique({ where: { id: nextPointId } });

        if (!point) {
            const error = new Error('Punto de muestreo no encontrado');
            error.statusCode = 404;
            throw error;
        }

        const normalized = normalizeSchedulePayload(point, {
            plannedTime: req.body.plannedTime || existingEntry.plannedTime,
            shift: req.body.shift || existingEntry.shift,
            workContext: req.body.workContext || existingEntry.workContext,
            workflowType: req.body.workflowType || existingEntry.workflowType,
            laboratoryProfile: req.body.laboratoryProfile || existingEntry.laboratoryProfile,
            assignedLab: req.body.assignedLab || existingEntry.assignedLab
        });
        const nextRequestedParameterIds = req.body.requestedParameterIds !== undefined
            ? await validateRequestedParametersExist(prisma, normalizeRequestedParameterIds(req.body.requestedParameterIds))
            : normalizeRequestedParameterIdList(existingEntry.requestedParameterIds);
        const nextNotes = req.body.notes !== undefined ? req.body.notes : existingEntry.notes;
        const reason = normalizeOptionalText(req.body.statusReason || req.body.reason);
        const scheduleDatePlan = buildScheduleDatePlan({
            scheduleMode: req.body.scheduleMode,
            plannedDate: req.body.plannedDate,
            rangeStartDate: req.body.rangeStartDate,
            rangeEndDate: req.body.rangeEndDate,
            selectedWeekdays: req.body.selectedWeekdays
        });
        const requestedTargetDates = [...scheduleDatePlan.targetDates];
        const todayIso = toIsoDate(new Date());
        const pastTargetDate = requestedTargetDates.find(targetDate => targetDate < todayIso);

        if (pastTargetDate) {
            const error = new Error('La nueva programación debe quedar para hoy o una fecha futura');
            error.statusCode = 400;
            throw error;
        }

        const requestedScheduleSnapshot = {
            samplingPointId: nextPointId,
            plannedDate: requestedTargetDates[0] || toIsoDate(existingEntry.plannedDate),
            plannedTime: normalized.plannedTime,
            shift: normalized.shift,
            workContext: normalized.workContext,
            workflowType: normalized.workflowType,
            laboratoryProfile: normalized.laboratoryProfile
        };
        const originalKey = buildScheduleUniquenessKey({
            samplingPointId: existingEntry.samplingPointId,
            plannedDate: toIsoDate(existingEntry.plannedDate),
            shift: existingEntry.shift,
            workContext: existingEntry.workContext,
            laboratoryProfile: existingEntry.laboratoryProfile
        });
        const requestedKeys = requestedTargetDates.map(targetDate => buildScheduleUniquenessKey({
            samplingPointId: nextPointId,
            plannedDate: targetDate,
            shift: normalized.shift,
            workContext: normalized.workContext,
            laboratoryProfile: normalized.laboratoryProfile
        }));
        const includesOriginalSlot = requestedKeys.includes(originalKey);
        const onlyOriginalSlot = requestedKeys.length === 1 && includesOriginalSlot;

        const existingHistory = appendScheduleHistory(existingEntry.statusHistory);
        const previousDisplayStatus = getScheduleDisplayStatus(existingEntry, existingEntry.sample);

        if (!hasSchedulingCoordinateChanges(existingEntry, requestedScheduleSnapshot) && onlyOriginalSlot && previousDisplayStatus === 'PLANNED') {
            const error = new Error('Para reagendar debe cambiar al menos la fecha, hora, turno, contexto, punto, flujo o tipo de laboratorio');
            error.statusCode = 400;
            throw error;
        }
        if (includesOriginalSlot && !onlyOriginalSlot) {
            const error = new Error('El rango no puede incluir la misma fecha y configuración actual. Ajuste el rango o use una sola reprogramación para ese caso.');
            error.statusCode = 400;
            throw error;
        }

        const shouldReactivateSameSlot = onlyOriginalSlot && (
            normalized.plannedTime !== existingEntry.plannedTime
            || normalized.workflowType !== existingEntry.workflowType
            || normalized.assignedLab !== existingEntry.assignedLab
            || nextNotes !== existingEntry.notes
            || reason !== existingEntry.statusReason
            || previousDisplayStatus !== 'PLANNED'
        );

        if (shouldReactivateSameSlot) {
            const updatedEntry = await prisma.microScheduleEntry.update({
                where: { id: existingEntry.id },
                data: {
                    plannedTime: normalized.plannedTime,
                    workflowType: normalized.workflowType,
                    assignedLab: normalized.assignedLab,
                    zoneName: normalized.zoneName,
                    requestedParameterIds: nextRequestedParameterIds,
                    notes: nextNotes,
                    status: 'PLANNED',
                    statusReason: reason || null,
                    statusHistory: appendScheduleHistory(existingHistory, buildScheduleAuditEvent(req, {
                        action: 'REPLANNED_IN_PLACE',
                        status: 'PLANNED',
                        reason,
                        fromDate: existingEntry.plannedDate,
                        toDate: existingEntry.plannedDate,
                        metadata: {
                            previousStatus: previousDisplayStatus,
                            scheduleMode: scheduleDatePlan.scheduleMode,
                            plannedTime: normalized.plannedTime,
                            workflowType: normalized.workflowType,
                            assignedLab: normalized.assignedLab
                        }
                    }))
                },
                include: SCHEDULE_ENTRY_INCLUDE
            });

            res.status(200).json({
                message: 'Programación actualizada sobre la misma fecha',
                entry: buildScheduleEntryResponse(updatedEntry),
                entries: [buildScheduleEntryResponse(updatedEntry)],
                createdCount: 1,
                skippedCount: 0,
                scheduleMode: 'SINGLE'
            });
            return;
        }

        const { startDate, endDate } = listScheduleDatesBounds(requestedTargetDates);
        const existingEntries = await prisma.microScheduleEntry.findMany({
            where: {
                id: { not: existingEntry.id },
                samplingPointId: nextPointId,
                plannedDate: {
                    gte: startDate,
                    lte: endDate
                },
                shift: normalized.shift,
                workContext: normalized.workContext,
                laboratoryProfile: normalized.laboratoryProfile
            },
            select: {
                id: true,
                samplingPointId: true,
                plannedDate: true,
                shift: true,
                workContext: true,
                laboratoryProfile: true
            }
        });

        const existingKeys = new Set(existingEntries.map(entry => buildScheduleUniquenessKey({
            samplingPointId: entry.samplingPointId,
            plannedDate: toIsoDate(entry.plannedDate),
            shift: entry.shift,
            workContext: entry.workContext,
            laboratoryProfile: entry.laboratoryProfile
        })));
        const datesToCreate = requestedTargetDates.filter(targetDate => !existingKeys.has(buildScheduleUniquenessKey({
            samplingPointId: nextPointId,
            plannedDate: targetDate,
            shift: normalized.shift,
            workContext: normalized.workContext,
            laboratoryProfile: normalized.laboratoryProfile
        })));

        if (datesToCreate.length === 0) {
            const error = new Error(
                scheduleDatePlan.scheduleMode === 'RANGE'
                    ? 'El rango seleccionado ya tiene programaciones creadas para esos criterios. Ajuste las fechas, días o parámetros.'
                    : 'Ya existe una programación activa con el mismo punto, fecha, turno, contexto y tipo.'
            );
            error.statusCode = 400;
            throw error;
        }

        const createdEntries = await prisma.$transaction(async (tx) => {
            const newEntries = [];

            for (const targetDate of datesToCreate) {
                const newEntry = await tx.microScheduleEntry.create({
                    data: {
                        samplingPointId: nextPointId,
                        plannedDate: buildUtcDateFromIso(targetDate),
                        plannedTime: normalized.plannedTime,
                        shift: normalized.shift,
                        workContext: normalized.workContext,
                        workflowType: normalized.workflowType,
                        laboratoryProfile: normalized.laboratoryProfile,
                        assignedLab: normalized.assignedLab,
                        zoneName: normalized.zoneName,
                        requestedParameterIds: nextRequestedParameterIds,
                        notes: nextNotes,
                        status: 'PLANNED',
                        statusReason: null,
                        rescheduledFromId: existingEntry.id,
                        statusHistory: appendScheduleHistory(existingHistory, buildScheduleAuditEvent(req, {
                            action: scheduleDatePlan.scheduleMode === 'RANGE' ? 'RESCHEDULED_FROM_RANGE' : 'RESCHEDULED_FROM',
                            status: 'PLANNED',
                            reason,
                            fromDate: existingEntry.plannedDate,
                            toDate: targetDate,
                            fromEntryId: existingEntry.id,
                            metadata: {
                                previousStatus: previousDisplayStatus,
                                plannedTime: normalized.plannedTime,
                                shift: normalized.shift,
                                scheduleMode: scheduleDatePlan.scheduleMode,
                                rangeStartDate: scheduleDatePlan.rangeStartDate,
                                rangeEndDate: scheduleDatePlan.rangeEndDate,
                                selectedWeekdays: scheduleDatePlan.selectedWeekdays,
                                createdCount: datesToCreate.length,
                                skippedCount: requestedTargetDates.length - datesToCreate.length
                            }
                        })),
                        createdById: req.user.id
                    },
                    include: SCHEDULE_ENTRY_INCLUDE
                });

                newEntries.push(newEntry);
            }

            await tx.microScheduleEntry.update({
                where: { id: existingEntry.id },
                data: {
                    status: 'RESCHEDULED',
                    statusReason: reason,
                    statusHistory: appendScheduleHistory(existingHistory, buildScheduleAuditEvent(req, {
                        action: scheduleDatePlan.scheduleMode === 'RANGE' ? 'RESCHEDULED_RANGE' : 'RESCHEDULED',
                        status: 'RESCHEDULED',
                        reason,
                        fromDate: existingEntry.plannedDate,
                        toDate: datesToCreate[0],
                        toEntryId: newEntries.length === 1 ? newEntries[0].id : null,
                        metadata: {
                            previousStatus: previousDisplayStatus,
                            nextPointId,
                            nextShift: normalized.shift,
                            scheduleMode: scheduleDatePlan.scheduleMode,
                            rangeStartDate: scheduleDatePlan.rangeStartDate,
                            rangeEndDate: scheduleDatePlan.rangeEndDate,
                            selectedWeekdays: scheduleDatePlan.selectedWeekdays,
                            targetDates: requestedTargetDates,
                            createdDates: datesToCreate,
                            createdCount: newEntries.length,
                            skippedCount: requestedTargetDates.length - newEntries.length,
                            toEntryIds: newEntries.map(entry => entry.id)
                        }
                    }))
                }
            });

            return newEntries;
        });

        res.status(201).json({
            message: scheduleDatePlan.scheduleMode === 'RANGE'
                ? `Programación reagendada en ${createdEntries.length} fecha(s)`
                : 'Programación reagendada',
            entry: buildScheduleEntryResponse(createdEntries[0]),
            entries: createdEntries.map(createdEntry => buildScheduleEntryResponse(createdEntry)),
            createdCount: createdEntries.length,
            skippedCount: requestedTargetDates.length - createdEntries.length,
            scheduleMode: scheduleDatePlan.scheduleMode
        });
    } catch (error) {
        respondWithError(res, error, 'Error rescheduling entry', 'Error al reagendar la programación');
    }
};

exports.deleteScheduleEntry = async (req, res) => {
    try {
        const entry = await prisma.microScheduleEntry.findUnique({
            where: { id: req.params.id }
        });

        if (!entry) {
            const error = new Error('Programación no encontrada');
            error.statusCode = 404;
            throw error;
        }

        if (entry.sampleId) {
            const error = new Error('No puede eliminar una programación que ya tiene un laboratorio asociado');
            error.statusCode = 400;
            throw error;
        }

        if (!canDeleteScheduleEntry(entry)) {
            const error = new Error('Esta programación ya tiene trazabilidad. Use cancelar o reagendar en lugar de eliminarla.');
            error.statusCode = 400;
            throw error;
        }

        await prisma.microScheduleEntry.delete({
            where: { id: req.params.id }
        });

        res.json({ message: 'Programación eliminada' });
    } catch (error) {
        respondWithError(res, error, 'Error deleting schedule entry', 'Error al eliminar la programación');
    }
};

// ── Create Sample / Laboratory Record ──
exports.createSample = async (req, res) => {
    let storedFiles = [];

    try {
        const userId = req.user.id;
        const {
            scheduleEntryId,
            workflowType: rawWorkflowType,
            samplingPointId,
            lotNumber,
            batchCode,
            sampleDescription,
            lab,
            reportNumber,
            notes,
            takenAt,
            results,
            workContext,
            shift,
            laboratoryProfile,
            requestedParameterIds,
            dispatchAt,
            dispatchReference,
            dispatchObservations,
            resultsReceivedAt,
            productionContextData,
            sampleTypeData
        } = req.body;
        const pendingAttachmentMeta = parseJsonArrayField(req.body.pendingAttachmentMeta, 'pendingAttachmentMeta');
        const workflowType = MICRO_WORKFLOW_TYPES.includes(rawWorkflowType) ? rawWorkflowType : 'EXTERNAL';
        const normalizedResults = normalizeResults(results);
        const normalizedProductionContextData = normalizeJsonObject(productionContextData, 'productionContextData') || null;
        const { reportFile, attachmentFiles } = getUploadedMicroFiles(req);

        const scheduleEntry = await ensureScheduleEntryAvailability(scheduleEntryId);
        const point = scheduleEntry
            ? scheduleEntry.samplingPoint
            : await prisma.microSamplingPoint.findUnique({ where: { id: samplingPointId } });

        if (!point) {
            const error = new Error('Debe seleccionar un punto de muestreo válido');
            error.statusCode = 400;
            throw error;
        }

        const normalizedSchedule = normalizeSchedulePayload(point, {
            workflowType: scheduleEntry?.workflowType || workflowType,
            workContext: scheduleEntry?.workContext || workContext,
            shift: scheduleEntry?.shift || shift,
            laboratoryProfile: scheduleEntry?.laboratoryProfile || laboratoryProfile,
            assignedLab: scheduleEntry?.assignedLab || lab
        });
        const normalizedSampleTypeData = normalizedSchedule.workflowType === 'INTERNAL'
            ? normalizeInternalSampleTypeData(
                sampleTypeData,
                buildSampleEntityContext({
                    point,
                    laboratoryProfile: normalizedSchedule.laboratoryProfile,
                    productionContextData: normalizedProductionContextData
                }).entityType
            )
            : undefined;
        const mergedRequestedParameterIds = await validateRequestedParametersExist(
            prisma,
            Array.from(new Set([
                ...normalizeRequestedParameterIds(requestedParameterIds),
                ...normalizeRequestedParameterIdList(scheduleEntry?.requestedParameterIds)
            ]))
        );

        if (mergedRequestedParameterIds.length === 0) {
            const error = new Error(
                normalizedSchedule.workflowType === 'INTERNAL'
                    ? 'Debe seleccionar al menos un análisis solicitado para iniciar el laboratorio interno'
                    : 'Debe seleccionar al menos un análisis solicitado para registrar la toma externa'
            );
            error.statusCode = 400;
            throw error;
        }

        if (normalizedSchedule.workflowType === 'EXTERNAL' && !hasPhotoEvidence(attachmentFiles)) {
            const error = new Error('Debe adjuntar al menos una evidencia fotográfica de la recolección de la muestra');
            error.statusCode = 400;
            throw error;
        }

        const sampleNumber = await getNextSampleNumber(prisma);
        const persistedInternalSampleTypeData = normalizedSchedule.workflowType === 'INTERNAL'
            ? ensureInternalSampleTypeIdentifiers(normalizedSampleTypeData, sampleNumber)
            : normalizedSampleTypeData;
        storedFiles = await storeMicroSampleFiles(sampleNumber, { reportFile, attachmentFiles });

        const createdSampleId = await prisma.$transaction(async (tx) => {
            const normalizedTakenAt = takenAt ? new Date(takenAt) : new Date();
            const normalizedDispatchAt = normalizeOptionalDateTime(dispatchAt, 'la fecha de envío');
            const normalizedResultsReceivedAt = normalizeOptionalDateTime(resultsReceivedAt, 'la fecha de recepción de resultados');
            const initialStatus = deriveSampleStatus({
                workflowType: normalizedSchedule.workflowType,
                currentStatus: 'SAMPLED',
                resultCount: normalizedResults.length,
                hasReport: storedFiles.some(file => file.category === 'LAB_REPORT'),
                hasLabMetadata: Boolean(lab || reportNumber || normalizedSchedule.assignedLab),
                hasDispatch: Boolean(normalizedDispatchAt),
                hasResultsReceipt: Boolean(normalizedResultsReceivedAt),
                internalLogCount: 0
            });

            const sample = await tx.microSample.create({
                data: {
                    sampleNumber,
                    samplingPointId: point.id,
                    takenAt: normalizedTakenAt,
                    takenById: userId,
                    lotNumber: lotNumber || null,
                    batchCode: batchCode || null,
                    sampleDescription: sampleDescription || null,
                    workflowType: normalizedSchedule.workflowType,
                    workContext: normalizedSchedule.workContext,
                    shift: normalizedSchedule.shift,
                    zoneName: normalizedSchedule.zoneName,
                    laboratoryProfile: normalizedSchedule.laboratoryProfile,
                    requestedParameterIds: mergedRequestedParameterIds,
                    dispatchAt: normalizedDispatchAt,
                    dispatchReference: normalizeOptionalText(dispatchReference),
                    dispatchObservations: normalizeOptionalText(dispatchObservations),
                    resultsReceivedAt: normalizedResultsReceivedAt,
                    receivedAt: null,
                    resultsCapturedAt: normalizedSchedule.workflowType === 'INTERNAL' && normalizedResults.length > 0 ? new Date() : null,
                    reviewedAt: null,
                    productionContextData: normalizedProductionContextData
                        ? {
                            ...normalizedProductionContextData,
                            ...buildSampleEntityContext({
                                point,
                                laboratoryProfile: normalizedSchedule.laboratoryProfile,
                                productionContextData: normalizedProductionContextData
                            })
                        }
                        : buildSampleEntityContext({
                            point,
                            laboratoryProfile: normalizedSchedule.laboratoryProfile
                        }),
                    sampleTypeData: persistedInternalSampleTypeData === undefined ? null : persistedInternalSampleTypeData,
                    lab: normalizedSchedule.workflowType === 'INTERNAL'
                        ? INTERNAL_DEFAULT_LAB
                        : (lab || normalizedSchedule.assignedLab || null),
                    reportNumber: reportNumber || null,
                    notes: notes || null,
                    status: initialStatus,
                    reportUrl: getPrimaryReportUrl(storedFiles),
                    startedAt: normalizedSchedule.workflowType === 'INTERNAL' ? normalizedTakenAt : null,
                    completedAt: normalizedSchedule.workflowType === 'EXTERNAL' && normalizedResults.length > 0 ? new Date() : null
                }
            });

            await logMicroAuditEvent(tx, {
                userId,
                action: normalizedSchedule.workflowType === 'INTERNAL' ? 'MICRO_INTERNAL_CREATED' : 'MICRO_SAMPLE_CREATED',
                sampleId: sample.id,
                changes: {
                    workflowType: normalizedSchedule.workflowType,
                    pointCode: point.code,
                    requestedParameterIds: mergedRequestedParameterIds,
                    sampleTypeData: persistedInternalSampleTypeData || null
                }
            });

            if (storedFiles.length > 0) {
                if (normalizedSchedule.workflowType === 'INTERNAL') {
                    const createdAttachments = await Promise.all(
                        storedFiles.map(file => tx.microSampleAttachment.create({
                            data: {
                                sampleId: sample.id,
                                category: file.category,
                                originalName: file.originalName,
                                storedName: file.storedName,
                                mimeType: file.mimeType,
                                sizeBytes: file.sizeBytes,
                                url: file.url
                            }
                        }))
                    );

                    const nextAttachmentAssignments = {
                        ...(persistedInternalSampleTypeData?.attachmentAssignments || {})
                    };

                    createdAttachments.forEach((attachment, index) => {
                        const assignedUnitId = normalizeOptionalText(pendingAttachmentMeta[index]?.unitId);
                        if (assignedUnitId && assignedUnitId !== INTERNAL_SAMPLE_GENERAL_CONTEXT_ID) {
                            nextAttachmentAssignments[attachment.id] = assignedUnitId;
                        }
                    });

                    await tx.microSample.update({
                        where: { id: sample.id },
                        data: {
                            sampleTypeData: persistedInternalSampleTypeData && typeof persistedInternalSampleTypeData === 'object' && !Array.isArray(persistedInternalSampleTypeData)
                                ? {
                                    ...persistedInternalSampleTypeData,
                                    attachmentAssignments: nextAttachmentAssignments
                                }
                                : persistedInternalSampleTypeData
                        }
                    });
                } else {
                    await tx.microSampleAttachment.createMany({
                        data: buildAttachmentCreateManyInput(sample.id, storedFiles)
                    });
                }
            }

            for (const resultRow of normalizedResults) {
                const parameter = await tx.microParameter.findUnique({
                    where: { id: resultRow.parameterId }
                });

                await tx.microResult.create({
                    data: {
                        sampleId: sample.id,
                        parameterId: resultRow.parameterId,
                        value: resultRow.value !== undefined && resultRow.value !== null && resultRow.value !== ''
                            ? parseFloat(resultRow.value)
                            : null,
                        valueText: resultRow.valueText || null,
                        isDetected: resultRow.isDetected !== undefined ? resultRow.isDetected : null,
                        isCompliant: calculateCompliance(parameter, resultRow),
                        notes: resultRow.notes || null
                    }
                });
            }

            if (scheduleEntryId) {
                await tx.microScheduleEntry.update({
                    where: { id: scheduleEntryId },
                    data: {
                        sampleId: sample.id,
                        status: deriveScheduleEntryStatus(sample)
                    }
                });
            }

            // Dual-write: populate sample junction table
            if (mergedRequestedParameterIds.length > 0) {
                await tx.microSampleParameter.createMany({
                    data: mergedRequestedParameterIds.map(parameterId => ({
                        sampleId: sample.id,
                        parameterId
                    })),
                    skipDuplicates: true
                });
            }

            return sample.id;
        });
        const createdSample = await prisma.microSample.findUnique({
            where: { id: createdSampleId },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.status(201).json({
            message: normalizedSchedule.workflowType === 'INTERNAL'
                ? 'Laboratorio interno iniciado'
                : 'Muestra registrada',
            sample: await buildSampleResponse(createdSample)
        });
    } catch (error) {
        await cleanupStoredFiles(storedFiles);
        respondWithError(res, error, 'Error creating micro sample', 'Error al registrar el laboratorio');
    }
};

// ── Update External Results / Metadata ──
exports.updateSampleResults = async (req, res) => {
    let storedFiles = [];
    let transactionCommitted = false;

    try {
        const { id } = req.params;
        const {
            results,
            lab,
            reportNumber,
            notes,
            requestedParameterIds,
            dispatchAt,
            dispatchReference,
            dispatchObservations,
            resultsReceivedAt,
            productionContextData
        } = req.body;
        const hasLabField = Object.prototype.hasOwnProperty.call(req.body, 'lab');
        const hasReportNumberField = Object.prototype.hasOwnProperty.call(req.body, 'reportNumber');
        const hasRequestedParameterIdsField = Object.prototype.hasOwnProperty.call(req.body, 'requestedParameterIds');
        const hasDispatchAtField = Object.prototype.hasOwnProperty.call(req.body, 'dispatchAt');
        const hasDispatchReferenceField = Object.prototype.hasOwnProperty.call(req.body, 'dispatchReference');
        const hasDispatchObservationsField = Object.prototype.hasOwnProperty.call(req.body, 'dispatchObservations');
        const hasResultsReceivedAtField = Object.prototype.hasOwnProperty.call(req.body, 'resultsReceivedAt');
        const hasProductionContextDataField = Object.prototype.hasOwnProperty.call(req.body, 'productionContextData');
        const normalizedLab = hasLabField ? normalizeOptionalText(lab) : undefined;
        const normalizedReportNumber = hasReportNumberField ? normalizeOptionalText(reportNumber) : undefined;
        const normalizedResults = normalizeResults(results);
        const removedAttachmentIds = parseJsonArrayField(req.body.removedAttachmentIds, 'removedAttachmentIds');
        const clearedResultParameterIds = parseJsonArrayField(req.body.clearedResultParameterIds, 'clearedResultParameterIds');
        const normalizedProductionContextData = hasProductionContextDataField
            ? normalizeJsonObject(productionContextData, 'productionContextData')
            : undefined;
        const { reportFile, attachmentFiles } = getUploadedMicroFiles(req);

        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: {
                samplingPoint: true,
                attachments: { orderBy: { createdAt: 'desc' } },
                results: true,
                internalLogs: true,
                scheduleEntry: true
            }
        });

        if (!sample) {
            const error = new Error('Muestra no encontrada');
            error.statusCode = 404;
            throw error;
        }

        storedFiles = await storeMicroSampleFiles(sample.sampleNumber, { reportFile, attachmentFiles });

        const reportReplacementIds = reportFile
            ? sample.attachments.filter(attachment => attachment.category === 'LAB_REPORT').map(attachment => attachment.id)
            : [];
        const attachmentIdsToDelete = Array.from(new Set([...removedAttachmentIds, ...reportReplacementIds]));
        const attachmentsToDelete = sample.attachments.filter(attachment => attachmentIdsToDelete.includes(attachment.id));
        const nextRequestedParameterIds = hasRequestedParameterIdsField
            ? await validateRequestedParametersExist(prisma, normalizeRequestedParameterIds(requestedParameterIds))
            : normalizeRequestedParameterIdList(sample.requestedParameterIds);

        if (sample.workflowType === 'EXTERNAL' && nextRequestedParameterIds.length === 0) {
            const error = new Error('La muestra externa debe conservar al menos un análisis solicitado');
            error.statusCode = 400;
            throw error;
        }

        await prisma.$transaction(async (tx) => {
            if (attachmentsToDelete.length > 0) {
                await tx.microSampleAttachment.deleteMany({
                    where: {
                        sampleId: id,
                        id: { in: attachmentsToDelete.map(attachment => attachment.id) }
                    }
                });
            }

            if (clearedResultParameterIds.length > 0) {
                await tx.microResult.deleteMany({
                    where: {
                        sampleId: id,
                        parameterId: { in: clearedResultParameterIds }
                    }
                });
            }

            for (const resultRow of normalizedResults) {
                const parameter = await tx.microParameter.findUnique({
                    where: { id: resultRow.parameterId }
                });

                await tx.microResult.upsert({
                    where: {
                        sampleId_parameterId: {
                            sampleId: id,
                            parameterId: resultRow.parameterId
                        }
                    },
                    update: {
                        value: resultRow.value !== undefined && resultRow.value !== null && resultRow.value !== ''
                            ? parseFloat(resultRow.value)
                            : null,
                        valueText: resultRow.valueText || null,
                        isDetected: resultRow.isDetected !== undefined ? resultRow.isDetected : null,
                        isCompliant: calculateCompliance(parameter, resultRow),
                        notes: resultRow.notes || null
                    },
                    create: {
                        sampleId: id,
                        parameterId: resultRow.parameterId,
                        value: resultRow.value !== undefined && resultRow.value !== null && resultRow.value !== ''
                            ? parseFloat(resultRow.value)
                            : null,
                        valueText: resultRow.valueText || null,
                        isDetected: resultRow.isDetected !== undefined ? resultRow.isDetected : null,
                        isCompliant: calculateCompliance(parameter, resultRow),
                        notes: resultRow.notes || null
                    }
                });
            }

            if (storedFiles.length > 0) {
                await tx.microSampleAttachment.createMany({
                    data: buildAttachmentCreateManyInput(id, storedFiles)
                });
            }

            const persistedResultCount = await tx.microResult.count({ where: { sampleId: id } });
            const remainingAttachments = sample.attachments.filter(attachment => !attachmentIdsToDelete.includes(attachment.id));
            const currentReportUrl = getPrimaryReportUrl(storedFiles, remainingAttachments);
            const currentLabValue = normalizedLab !== undefined ? normalizedLab : sample.lab;
            const currentReportNumberValue = normalizedReportNumber !== undefined ? normalizedReportNumber : sample.reportNumber;
            const nextDispatchAtValue = hasDispatchAtField
                ? normalizeOptionalDateTime(dispatchAt, 'la fecha de envío')
                : sample.dispatchAt;
            const nextResultsReceivedAtValue = hasResultsReceivedAtField
                ? normalizeOptionalDateTime(resultsReceivedAt, 'la fecha de recepción de resultados')
                : sample.resultsReceivedAt;
            const nextProductionContextData = hasProductionContextDataField
                ? (
                    normalizedProductionContextData
                        ? {
                            ...normalizedProductionContextData,
                            ...buildSampleEntityContext({
                                point: sample.samplingPoint,
                                laboratoryProfile: sample.laboratoryProfile,
                                productionContextData: normalizedProductionContextData
                            })
                        }
                        : null
                )
                : sample.productionContextData;
            const status = deriveSampleStatus({
                workflowType: sample.workflowType,
                currentStatus: sample.status,
                resultCount: persistedResultCount,
                hasReport: Boolean(currentReportUrl),
                hasLabMetadata: Boolean(currentLabValue || currentReportNumberValue),
                hasDispatch: Boolean(nextDispatchAtValue),
                hasResultsReceipt: Boolean(nextResultsReceivedAtValue),
                internalLogCount: sample.internalLogs.length,
                closedAt: sample.closedAt,
                finalReportData: sample.finalReportData,
                receivedAt: sample.receivedAt,
                resultsCapturedAt: sample.resultsCapturedAt,
                reviewedAt: sample.reviewedAt,
                acceptanceData: sample.acceptanceData,
                technicalReviewData: sample.technicalReviewData
            });

            await tx.microSample.update({
                where: { id },
                data: {
                    status,
                    reportUrl: currentReportUrl,
                    requestedParameterIds: nextRequestedParameterIds,
                    lab: sample.workflowType === 'INTERNAL'
                        ? INTERNAL_DEFAULT_LAB
                        : currentLabValue,
                    reportNumber: currentReportNumberValue,
                    notes: notes !== undefined ? notes : sample.notes,
                    dispatchAt: nextDispatchAtValue,
                    dispatchReference: hasDispatchReferenceField
                        ? normalizeOptionalText(dispatchReference)
                        : sample.dispatchReference,
                    dispatchObservations: hasDispatchObservationsField
                        ? normalizeOptionalText(dispatchObservations)
                        : sample.dispatchObservations,
                    resultsReceivedAt: nextResultsReceivedAtValue,
                    productionContextData: nextProductionContextData,
                    completedAt: sample.workflowType === 'EXTERNAL' && persistedResultCount > 0
                        ? sample.completedAt || new Date()
                        : sample.completedAt
                }
            });

            // Dual-write: re-sync sample junction table
            await tx.microSampleParameter.deleteMany({ where: { sampleId: id } });
            if (nextRequestedParameterIds.length > 0) {
                await tx.microSampleParameter.createMany({
                    data: nextRequestedParameterIds.map(parameterId => ({ sampleId: id, parameterId })),
                    skipDuplicates: true
                });
            }

            if (sample.scheduleEntry?.id) {
                await tx.microScheduleEntry.update({
                    where: { id: sample.scheduleEntry.id },
                    data: {
                        requestedParameterIds: nextRequestedParameterIds
                    }
                });

                // Dual-write: re-sync schedule entry junction table
                await tx.microScheduleEntryParameter.deleteMany({ where: { entryId: sample.scheduleEntry.id } });
                if (nextRequestedParameterIds.length > 0) {
                    await tx.microScheduleEntryParameter.createMany({
                        data: nextRequestedParameterIds.map(parameterId => ({ entryId: sample.scheduleEntry.id, parameterId })),
                        skipDuplicates: true
                    });
                }

                await syncScheduleEntryStatus(tx, sample.scheduleEntry.id, id);
            }
        });
        transactionCommitted = true;

        if (attachmentsToDelete.length > 0) {
            try {
                await deleteFilesByUrls(attachmentsToDelete.map(attachment => attachment.url));
            } catch (fileDeleteError) {
                logger.warn('Could not delete one or more old micro attachments from disk', {
                    sampleId: id,
                    error: fileDeleteError.message
                });
            }
        }

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: 'Resultados actualizados',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        if (!transactionCommitted) {
            await cleanupStoredFiles(storedFiles);
        }
        respondWithError(res, error, 'Error updating micro results', 'Error al actualizar resultados');
    }
};

// ── Internal Lab Case Data ──
exports.updateInternalCase = async (req, res) => {
    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: {
                samplingPoint: true,
                scheduleEntry: true,
                internalLogs: true,
                results: true
            }
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('La ficha interna solo está disponible para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'CLOSED' || sample.status === 'REJECTED') {
            const error = new Error('Este caso ya no admite cambios en la ficha interna');
            error.statusCode = 400;
            throw error;
        }

        const actorSnapshot = buildActorSnapshot(req.user);
        const entityContext = buildSampleEntityContext({
            point: sample.samplingPoint,
            laboratoryProfile: sample.laboratoryProfile,
            productionContextData: sample.productionContextData
        });

        const hasSampleTypeDataField = Object.prototype.hasOwnProperty.call(req.body, 'sampleTypeData');
        const hasAnalysisExecutionDataField = Object.prototype.hasOwnProperty.call(req.body, 'analysisExecutionData');
        const hasDeviationDataField = Object.prototype.hasOwnProperty.call(req.body, 'deviationData');
        const hasNotesField = Object.prototype.hasOwnProperty.call(req.body, 'notes');
        const hasSampleDescriptionField = Object.prototype.hasOwnProperty.call(req.body, 'sampleDescription');
        const hasLotNumberField = Object.prototype.hasOwnProperty.call(req.body, 'lotNumber');
        const hasBatchCodeField = Object.prototype.hasOwnProperty.call(req.body, 'batchCode');

        const sampleTypeData = hasSampleTypeDataField
            ? normalizeInternalSampleTypeData(req.body.sampleTypeData, entityContext.entityType)
            : sample.sampleTypeData;
        const persistedSampleTypeData = ensureInternalSampleTypeIdentifiers(sampleTypeData, sample.sampleNumber);
        const analysisExecutionData = hasAnalysisExecutionDataField
            ? normalizeInternalAnalysisExecutionData(req.body.analysisExecutionData, actorSnapshot)
            : sample.analysisExecutionData;
        const deviationData = hasDeviationDataField
            ? normalizeInternalDeviationData(req.body.deviationData)
            : sample.deviationData;

        await prisma.$transaction(async (tx) => {
            await tx.microSample.update({
                where: { id },
                data: {
                    sampleTypeData: persistedSampleTypeData,
                    analysisExecutionData,
                    deviationData,
                    notes: hasNotesField ? normalizeOptionalText(req.body.notes) : sample.notes,
                    sampleDescription: hasSampleDescriptionField ? normalizeOptionalText(req.body.sampleDescription) : sample.sampleDescription,
                    lotNumber: hasLotNumberField ? normalizeOptionalText(req.body.lotNumber) : sample.lotNumber,
                    batchCode: hasBatchCodeField ? normalizeOptionalText(req.body.batchCode) : sample.batchCode
                }
            });

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_CASE_UPDATED',
                sampleId: id,
                changes: {
                    sampleTypeDataUpdated: hasSampleTypeDataField,
                    analysisExecutionUpdated: hasAnalysisExecutionDataField,
                    deviationUpdated: hasDeviationDataField,
                    notesUpdated: hasNotesField,
                    sampleDescriptionUpdated: hasSampleDescriptionField
                }
            });
        });

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: 'Ficha interna actualizada',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        respondWithError(res, error, 'Error updating internal micro case', 'Error al actualizar la ficha interna');
    }
};

// ── Internal Lab Supports / Evidence ──
exports.updateInternalSupports = async (req, res) => {
    let storedFiles = [];
    let transactionCommitted = false;

    try {
        const { id } = req.params;
        const removedAttachmentIds = parseJsonArrayField(req.body.removedAttachmentIds, 'removedAttachmentIds');
        const pendingAttachmentMeta = parseJsonArrayField(req.body.pendingAttachmentMeta, 'pendingAttachmentMeta');
        const hasSampleTypeDataField = Object.prototype.hasOwnProperty.call(req.body, 'sampleTypeData');
        const { attachmentFiles } = getUploadedMicroFiles(req);

        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: {
                attachments: { orderBy: { createdAt: 'desc' } },
                scheduleEntry: true,
                samplingPoint: true
            }
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('Los soportes de este flujo solo están disponibles para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'CLOSED') {
            const error = new Error('El caso ya está cerrado y no admite cambios en soportes o evidencias');
            error.statusCode = 400;
            throw error;
        }

        const attachmentNameMap = buildAttachmentNameMap(sample.attachments);
        const entityContext = buildSampleEntityContext({
            point: sample.samplingPoint,
            laboratoryProfile: sample.laboratoryProfile,
            productionContextData: sample.productionContextData
        });
        const baseSampleTypeData = hasSampleTypeDataField
            ? normalizeInternalSampleTypeData(req.body.sampleTypeData, entityContext.entityType)
            : sample.sampleTypeData;
        const identifiedSampleTypeData = ensureInternalSampleTypeIdentifiers(baseSampleTypeData, sample.sampleNumber);
        const reportAttachmentsToDelete = sample.attachments.filter(attachment => (
            removedAttachmentIds.includes(attachment.id) && attachment.category === 'LAB_REPORT'
        ));

        if (reportAttachmentsToDelete.length > 0) {
            const error = new Error('El informe final del laboratorio interno se genera automáticamente y no puede retirarse desde soportes');
            error.statusCode = 400;
            throw error;
        }

        const attachmentsToDelete = sample.attachments.filter(attachment => (
            removedAttachmentIds.includes(attachment.id) && attachment.category !== 'LAB_REPORT'
        ));
        const sampleTypeDataChanged = JSON.stringify(identifiedSampleTypeData || null) !== JSON.stringify(sample.sampleTypeData || null);

        if (attachmentFiles.length === 0 && attachmentsToDelete.length === 0 && !sampleTypeDataChanged) {
            const currentSample = await prisma.microSample.findUnique({
                where: { id },
                include: SAMPLE_DETAIL_INCLUDE
            });

            res.json({
                message: 'No hubo cambios en soportes o evidencias',
                sample: await buildSampleResponse(currentSample)
            });
            return;
        }

        storedFiles = await storeMicroSampleFiles(sample.sampleNumber, { attachmentFiles });

        await prisma.$transaction(async (tx) => {
            let createdAttachments = [];

            if (attachmentsToDelete.length > 0) {
                await tx.microSampleAttachment.deleteMany({
                    where: {
                        sampleId: id,
                        id: { in: attachmentsToDelete.map(attachment => attachment.id) }
                    }
                });
            }

            if (storedFiles.length > 0) {
                createdAttachments = await Promise.all(
                    storedFiles.map(file => tx.microSampleAttachment.create({
                        data: {
                            sampleId: id,
                            category: file.category,
                            originalName: file.originalName,
                            storedName: file.storedName,
                            mimeType: file.mimeType,
                            sizeBytes: file.sizeBytes,
                            url: file.url
                        }
                    }))
                );
            }

            const nextAttachmentAssignments = {
                ...(identifiedSampleTypeData?.attachmentAssignments || {})
            };

            attachmentsToDelete.forEach(attachment => {
                delete nextAttachmentAssignments[attachment.id];
            });

            Object.keys(nextAttachmentAssignments).forEach(attachmentId => {
                if (`${attachmentId}`.startsWith('legacy:')) {
                    delete nextAttachmentAssignments[attachmentId];
                }
            });

            createdAttachments.forEach((attachment, index) => {
                const assignedUnitId = normalizeOptionalText(pendingAttachmentMeta[index]?.unitId);
                if (assignedUnitId && assignedUnitId !== INTERNAL_SAMPLE_GENERAL_CONTEXT_ID) {
                    nextAttachmentAssignments[attachment.id] = assignedUnitId;
                }
            });

            const shouldUpdateSampleTypeData = (
                hasSampleTypeDataField
                || attachmentsToDelete.length > 0
                || createdAttachments.length > 0
            );
            const nextSampleTypeData = shouldUpdateSampleTypeData && identifiedSampleTypeData && typeof identifiedSampleTypeData === 'object' && !Array.isArray(identifiedSampleTypeData)
                ? {
                    ...identifiedSampleTypeData,
                    attachmentAssignments: nextAttachmentAssignments
                }
                : identifiedSampleTypeData;

            if (shouldUpdateSampleTypeData) {
                await tx.microSample.update({
                    where: { id },
                    data: {
                        sampleTypeData: nextSampleTypeData || null
                    }
                });
            }

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_SUPPORTS_UPDATED',
                sampleId: id,
                changes: {
                    addedFiles: storedFiles.map(file => ({
                        category: file.category,
                        name: file.originalName
                    })),
                    removedFiles: attachmentsToDelete.map(attachment => ({
                        id: attachment.id,
                        name: attachmentNameMap.get(attachment.id) || attachment.id
                    })),
                    attachmentAssignmentsUpdated: Object.keys(nextAttachmentAssignments).length
                }
            });
        });
        transactionCommitted = true;

        if (attachmentsToDelete.length > 0) {
            try {
                await deleteFilesByUrls(attachmentsToDelete.map(attachment => attachment.url));
            } catch (fileDeleteError) {
                logger.warn('Could not delete one or more internal support files from disk', {
                    sampleId: id,
                    error: fileDeleteError.message
                });
            }
        }

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: 'Soportes y evidencias actualizados',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        if (!transactionCommitted && storedFiles.length > 0) {
            await cleanupStoredFiles(storedFiles);
        }
        respondWithError(res, error, 'Error updating internal micro supports', 'Error al actualizar soportes del laboratorio interno');
    }
};

// ── Internal Lab Sample Acceptance ──
exports.acceptInternalSample = async (req, res) => {
    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: {
                samplingPoint: true,
                scheduleEntry: true,
                internalLogs: true,
                results: true
            }
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('La recepción y aceptación solo aplica para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'CLOSED') {
            const error = new Error('El laboratorio ya está cerrado y no puede recepcionarse nuevamente');
            error.statusCode = 400;
            throw error;
        }

        if (sample.internalLogs.length > 0 || sample.results.length > 0) {
            const error = new Error('La muestra ya tiene trazabilidad analítica registrada y no puede cambiar su aceptación');
            error.statusCode = 400;
            throw error;
        }

        const acceptanceData = normalizeInternalAcceptanceData(req.body.acceptanceData ?? req.body, buildActorSnapshot(req.user));
        const receivedAt = acceptanceData.accepted ? new Date(acceptanceData.receivedAt) : null;

        await prisma.$transaction(async (tx) => {
            const status = deriveSampleStatus({
                workflowType: 'INTERNAL',
                currentStatus: sample.status,
                resultCount: sample.results.length,
                internalLogCount: sample.internalLogs.length,
                closedAt: sample.closedAt,
                receivedAt,
                resultsCapturedAt: sample.resultsCapturedAt,
                reviewedAt: sample.reviewedAt,
                acceptanceData,
                technicalReviewData: sample.technicalReviewData
            });

            await tx.microSample.update({
                where: { id },
                data: {
                    acceptanceData,
                    receivedAt,
                    status
                }
            });

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: acceptanceData.accepted ? 'MICRO_INTERNAL_ACCEPTED' : 'MICRO_INTERNAL_REJECTED',
                sampleId: id,
                changes: acceptanceData
            });

            if (sample.scheduleEntry?.id) {
                await syncScheduleEntryStatus(tx, sample.scheduleEntry.id, id);
            }
        });

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: acceptanceData.accepted ? 'Recepción y aceptación registradas' : 'La muestra quedó rechazada al ingreso del laboratorio',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        respondWithError(res, error, 'Error accepting internal micro sample', 'Error al registrar la recepción de la muestra');
    }
};

// ── Internal Final Results Registration ──
exports.saveInternalResults = async (req, res) => {
    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('El registro de resultados finales solo aplica para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'CLOSED' || sample.status === 'REJECTED') {
            const error = new Error('Este caso ya no admite resultados finales');
            error.statusCode = 400;
            throw error;
        }

        if (!sample.receivedAt || sample.acceptanceData?.accepted === false) {
            const error = new Error('Debes registrar primero la recepción y aceptación de la muestra');
            error.statusCode = 400;
            throw error;
        }

        const hasAnalysisExecutionDataField = Object.prototype.hasOwnProperty.call(req.body, 'analysisExecutionData');
        const nextAnalysisExecutionData = hasAnalysisExecutionDataField
            ? normalizeInternalAnalysisExecutionData(req.body.analysisExecutionData, buildActorSnapshot(req.user))
            : sample.analysisExecutionData;

        validateInternalExecutionDataForResults(nextAnalysisExecutionData);

        const rawFinalResults = normalizeResults(req.body.finalResults);
        const latestLog = [...sample.internalLogs].sort((left, right) => new Date(right.logDate) - new Date(left.logDate))[0];
        const fallbackResults = latestLog?.readings || [];
        const finalResultsInput = rawFinalResults.length > 0 ? rawFinalResults : fallbackResults;
        const clearedResultParameterIds = parseJsonArrayField(req.body.clearedResultParameterIds, 'clearedResultParameterIds');
        const requestedParameterIds = normalizeRequestedParameterIdList(sample.requestedParameterIds);

        if (!finalResultsInput || finalResultsInput.length === 0) {
            const error = new Error('Debe cargar resultados finales o usar una lectura consolidada de la última bitácora');
            error.statusCode = 400;
            throw error;
        }

        if (requestedParameterIds.length > 0) {
            const invalidParameterIds = finalResultsInput
                .map(result => result.parameterId)
                .filter(parameterId => !requestedParameterIds.includes(parameterId));

            if (invalidParameterIds.length > 0) {
                const error = new Error('Los resultados finales deben corresponder a los análisis solicitados para este caso');
                error.statusCode = 400;
                throw error;
            }
        }

        const parameters = await prisma.microParameter.findMany({
            where: {
                isActive: true,
                ...(requestedParameterIds.length > 0 ? { id: { in: requestedParameterIds } } : {})
            },
            orderBy: { sortOrder: 'asc' }
        });
        const parameterMap = new Map(parameters.map(parameter => [parameter.id, parameter]));
        assertRequestedResultCoverage({
            requestedParameterIds,
            resultRows: finalResultsInput,
            parameterLookup: parameterMap,
            defaultMessage: 'Antes de consolidar resultados finales debes completar todos los análisis solicitados'
        });
        const resultsCapturedAt = new Date();
        const finalConclusion = Object.prototype.hasOwnProperty.call(req.body, 'finalConclusion')
            ? normalizeOptionalText(req.body.finalConclusion)
            : sample.finalConclusion;

        await prisma.$transaction(async (tx) => {
            if (clearedResultParameterIds.length > 0) {
                await tx.microResult.deleteMany({
                    where: {
                        sampleId: id,
                        parameterId: { in: clearedResultParameterIds }
                    }
                });
            }

            for (const resultRow of finalResultsInput) {
                const parameter = parameterMap.get(resultRow.parameterId);

                await tx.microResult.upsert({
                    where: {
                        sampleId_parameterId: {
                            sampleId: id,
                            parameterId: resultRow.parameterId
                        }
                    },
                    update: {
                        value: resultRow.value !== undefined && resultRow.value !== null && resultRow.value !== ''
                            ? parseFloat(resultRow.value)
                            : null,
                        valueText: resultRow.valueText || null,
                        isDetected: resultRow.isDetected !== undefined ? resultRow.isDetected : null,
                        isCompliant: calculateCompliance(parameter, resultRow),
                        notes: resultRow.notes || null
                    },
                    create: {
                        sampleId: id,
                        parameterId: resultRow.parameterId,
                        value: resultRow.value !== undefined && resultRow.value !== null && resultRow.value !== ''
                            ? parseFloat(resultRow.value)
                            : null,
                        valueText: resultRow.valueText || null,
                        isDetected: resultRow.isDetected !== undefined ? resultRow.isDetected : null,
                        isCompliant: calculateCompliance(parameter, resultRow),
                        notes: resultRow.notes || null
                    }
                });
            }

            const persistedResultCount = await tx.microResult.count({ where: { sampleId: id } });
            const status = deriveSampleStatus({
                workflowType: 'INTERNAL',
                currentStatus: sample.status,
                resultCount: persistedResultCount,
                internalLogCount: sample.internalLogs.length,
                receivedAt: sample.receivedAt,
                resultsCapturedAt,
                reviewedAt: null,
                acceptanceData: sample.acceptanceData,
                technicalReviewData: null,
                closedAt: sample.closedAt
            });

            await tx.microSample.update({
                where: { id },
                data: {
                    analysisExecutionData: nextAnalysisExecutionData,
                    finalConclusion,
                    resultsCapturedAt,
                    reviewedAt: null,
                    technicalReviewData: null,
                    approvalData: null,
                    status
                }
            });

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_RESULTS_CAPTURED',
                sampleId: id,
                changes: {
                    resultsCapturedAt,
                    persistedResultCount,
                    finalConclusion,
                    executionUpdated: hasAnalysisExecutionDataField
                }
            });

            if (sample.scheduleEntry?.id) {
                await syncScheduleEntryStatus(tx, sample.scheduleEntry.id, id);
            }
        });

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: 'Resultados finales registrados; el caso quedó listo para revisión técnica',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        respondWithError(res, error, 'Error saving internal micro results', 'Error al registrar resultados finales');
    }
};

// ── Internal Technical Review ──
exports.reviewInternalSample = async (req, res) => {
    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('La revisión técnica solo aplica para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'CLOSED' || sample.status === 'REJECTED') {
            const error = new Error('Este caso ya no admite revisión técnica');
            error.statusCode = 400;
            throw error;
        }

        if (!sample.resultsCapturedAt && sample.results.length === 0) {
            const error = new Error('Antes de revisar el caso debes registrar los resultados finales');
            error.statusCode = 400;
            throw error;
        }

        const requestedParameterIds = normalizeRequestedParameterIdList(sample.requestedParameterIds);
        const reviewParameterLookup = new Map(
            (sample.results || []).map(result => [result.parameterId, result.parameter || { name: result.parameterId }])
        );
        if (requestedParameterIds.length > 0) {
            const missingRequestedIds = requestedParameterIds.filter(parameterId => !reviewParameterLookup.has(parameterId));
            if (missingRequestedIds.length > 0) {
                const missingParameters = await prisma.microParameter.findMany({
                    where: { id: { in: missingRequestedIds } },
                    select: { id: true, name: true }
                });
                missingParameters.forEach(parameter => reviewParameterLookup.set(parameter.id, parameter));
            }

            assertRequestedResultCoverage({
                requestedParameterIds,
                resultRows: sample.results,
                parameterLookup: reviewParameterLookup,
                defaultMessage: 'Antes de registrar la revisión técnica debes completar todos los análisis solicitados'
            });
        }

        const actorSnapshot = buildActorSnapshot(req.user);
        const hasDeviationDataField = Object.prototype.hasOwnProperty.call(req.body, 'deviationData');
        const deviationData = hasDeviationDataField
            ? normalizeInternalDeviationData(req.body.deviationData)
            : sample.deviationData;
        const technicalReviewData = normalizeInternalTechnicalReviewData(req.body.technicalReviewData ?? req.body, actorSnapshot);
        const reviewedAt = new Date(technicalReviewData.reviewedAt);

        if (
            technicalReviewData.reviewDecision === 'REQUIRES_ACTION'
            && !hasMeaningfulStructuredData({
                details: deviationData?.details,
                immediateActions: deviationData?.immediateActions,
                capaPlan: deviationData?.capaPlan
            })
        ) {
            const error = new Error('Si la revisión técnica exige acciones, debes documentar el desvío y el plan CAPA');
            error.statusCode = 400;
            throw error;
        }

        await prisma.$transaction(async (tx) => {
            const status = deriveSampleStatus({
                workflowType: 'INTERNAL',
                currentStatus: sample.status,
                resultCount: sample.results.length,
                internalLogCount: sample.internalLogs.length,
                receivedAt: sample.receivedAt,
                resultsCapturedAt: sample.resultsCapturedAt,
                reviewedAt,
                acceptanceData: sample.acceptanceData,
                technicalReviewData,
                closedAt: sample.closedAt
            });

            await tx.microSample.update({
                where: { id },
                data: {
                    technicalReviewData,
                    deviationData,
                    reviewedAt,
                    status
                }
            });

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_TECH_REVIEWED',
                sampleId: id,
                changes: {
                    reviewDecision: technicalReviewData.reviewDecision,
                    releaseDecision: technicalReviewData.releaseDecision,
                    reviewedAt
                }
            });

            if (sample.scheduleEntry?.id) {
                await syncScheduleEntryStatus(tx, sample.scheduleEntry.id, id);
            }
        });

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: technicalReviewData.reviewDecision === 'APPROVED'
                ? 'Revisión técnica registrada; el caso quedó listo para aprobación y cierre'
                : 'Revisión técnica registrada con acciones pendientes',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        respondWithError(res, error, 'Error reviewing internal micro sample', 'Error al registrar la revisión técnica');
    }
};

// ── Internal Lab Logbook ──
exports.addInternalLog = async (req, res) => {
    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: {
                internalLogs: true,
                scheduleEntry: true
            }
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('La bitácora diaria solo está disponible para laboratorios internos');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'REJECTED') {
            const error = new Error('La muestra fue rechazada y no admite seguimiento diario');
            error.statusCode = 400;
            throw error;
        }

        if (!sample.receivedAt || sample.acceptanceData?.accepted === false) {
            const error = new Error('Debes registrar primero la recepción y aceptación de la muestra');
            error.statusCode = 400;
            throw error;
        }

        if (sample.reviewedAt || sample.closedAt) {
            const error = new Error('La revisión técnica ya fue registrada y no admite nuevas bitácoras');
            error.statusCode = 400;
            throw error;
        }

        const readings = normalizeInternalReadings(req.body.readings);
        const observations = req.body.observations || null;
        if (!observations && readings.length === 0) {
            const error = new Error('Debe registrar observaciones o lecturas para guardar la bitácora');
            error.statusCode = 400;
            throw error;
        }

        const logDateIso = req.body.logDate ? `${req.body.logDate}`.slice(0, 10) : toIsoDate(new Date());
        const logDate = buildUtcDateFromIso(logDateIso);
        const sampleStartDate = buildUtcDateFromIso(toIsoDate(sample.takenAt));
        const todayDate = buildUtcDateFromIso(toIsoDate(new Date()));

        if (logDate < sampleStartDate) {
            const error = new Error('La fecha de bitácora no puede ser anterior a la toma de la muestra');
            error.statusCode = 400;
            throw error;
        }

        if (logDate > todayDate) {
            const error = new Error('La fecha de bitácora no puede quedar en el futuro');
            error.statusCode = 400;
            throw error;
        }

        const dayNumber = Math.max(1, Math.floor((logDate.getTime() - sampleStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);

        await prisma.$transaction(async (tx) => {
            const upsertedLog = await tx.microInternalLog.upsert({
                where: {
                    sampleId_logDate: {
                        sampleId: id,
                        logDate
                    }
                },
                update: {
                    observations,
                    readings,
                    dayNumber,
                    recordedById: req.user.id
                },
                create: {
                    sampleId: id,
                    logDate,
                    dayNumber,
                    observations,
                    readings,
                    recordedById: req.user.id
                }
            });

            // Dual-write: sync MicroLogReading table (delete + recreate on upsert)
            await tx.microLogReading.deleteMany({ where: { logId: upsertedLog.id } });
            if (readings.length > 0) {
                await tx.microLogReading.createMany({
                    data: readings.map(r => ({
                        logId: upsertedLog.id,
                        parameterId: r.parameterId || null,
                        value: r.value !== undefined && r.value !== null && r.value !== '' ? String(r.value) : null,
                        valueText: r.valueText || null,
                        isDetected: r.isDetected !== undefined ? r.isDetected : null
                    })),
                    skipDuplicates: true
                });
            }

            await recalculateSampleStatus(tx, id, { currentStatus: 'IN_PROCESS' });
            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_LOG_RECORDED',
                sampleId: id,
                changes: {
                    logDate: logDateIso,
                    dayNumber,
                    readingsCount: readings.length
                }
            });
            if (sample.scheduleEntry?.id) {
                await syncScheduleEntryStatus(tx, sample.scheduleEntry.id, id);
            }
        });

        const updatedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.status(201).json({
            message: 'Seguimiento interno registrado',
            sample: await buildSampleResponse(updatedSample)
        });
    } catch (error) {
        respondWithError(res, error, 'Error adding internal micro log', 'Error al registrar el seguimiento interno');
    }
};

// ── Finalize Internal Lab and Auto-Close Report ──
exports.finalizeInternalSample = async (req, res) => {
    let generatedReportFile = null;
    let previousReportUrls = [];
    let transactionCommitted = false;

    try {
        const { id } = req.params;
        const sample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        if (!sample) {
            const error = new Error('Laboratorio no encontrado');
            error.statusCode = 404;
            throw error;
        }

        if (sample.workflowType !== 'INTERNAL') {
            const error = new Error('Solo los laboratorios internos pueden finalizarse desde este flujo');
            error.statusCode = 400;
            throw error;
        }

        if (sample.status === 'REJECTED') {
            const error = new Error('La muestra fue rechazada y no puede cerrarse como laboratorio interno ejecutado');
            error.statusCode = 400;
            throw error;
        }

        if (!sample.receivedAt || sample.acceptanceData?.accepted === false) {
            const error = new Error('Debes registrar primero la recepción y aceptación de la muestra');
            error.statusCode = 400;
            throw error;
        }

        validateInternalExecutionDataForResults(sample.analysisExecutionData);

        if (!sample.resultsCapturedAt && sample.results.length === 0) {
            const error = new Error('Antes del cierre debes registrar los resultados finales');
            error.statusCode = 400;
            throw error;
        }

        if (!sample.reviewedAt || !sample.technicalReviewData) {
            const error = new Error('Antes del cierre debes registrar la revisión técnica');
            error.statusCode = 400;
            throw error;
        }

        if (sample.technicalReviewData.reviewDecision !== 'APPROVED') {
            const error = new Error('Solo puedes cerrar el caso cuando la revisión técnica quede aprobada');
            error.statusCode = 400;
            throw error;
        }

        const requestedParameterIds = normalizeRequestedParameterIdList(sample.requestedParameterIds);
        const parameters = await prisma.microParameter.findMany({
            where: {
                isActive: true,
                ...(requestedParameterIds.length > 0 ? { id: { in: requestedParameterIds } } : {})
            },
            orderBy: { sortOrder: 'asc' }
        });
        const parameterMap = new Map(parameters.map(parameter => [parameter.id, parameter]));
        const rawFinalResults = normalizeResults(req.body.finalResults);
        const latestLog = [...sample.internalLogs].sort((left, right) => new Date(right.logDate) - new Date(left.logDate))[0];
        const fallbackResults = sample.results.length > 0 ? sample.results : (latestLog?.readings || []);
        const finalResultsInput = rawFinalResults.length > 0 ? rawFinalResults : fallbackResults;

        if (!finalResultsInput || finalResultsInput.length === 0) {
            const error = new Error('Debe existir al menos un resultado final para generar el cierre');
            error.statusCode = 400;
            throw error;
        }

        assertRequestedResultCoverage({
            requestedParameterIds,
            resultRows: finalResultsInput,
            parameterLookup: parameterMap,
            defaultMessage: 'Antes de generar el cierre debes completar todos los análisis solicitados'
        });

        if (sample.reviewedAt && rawFinalResults.length > 0) {
            const error = new Error('Los resultados finales ya fueron revisados; si debes cambiarlos registra una nueva revisión técnica');
            error.statusCode = 400;
            throw error;
        }

        const finalConclusion = normalizeOptionalText(req.body.finalConclusion) || sample.finalConclusion || null;
        const reportNumber = sample.reportNumber || await getNextInternalReportNumber(prisma);
        const closedAt = new Date();
        const approvalData = normalizeInternalApprovalData(req.body.approvalData ?? { approvalNotes: req.body.approvalNotes }, buildActorSnapshot(req.user));

        const finalResults = finalResultsInput.map(result => {
            const parameter = parameterMap.get(result.parameterId);
            return {
                ...result,
                parameter,
                value: result.value !== undefined && result.value !== null && result.value !== ''
                    ? parseFloat(result.value)
                    : null,
                valueText: result.valueText || null,
                isDetected: result.isDetected !== undefined ? result.isDetected : null,
                isCompliant: calculateCompliance(parameter, result),
                notes: result.notes || null
            };
        });

        const reportDataPayload = buildFinalReportData({
            sample,
            finalResults,
            internalLogs: sample.internalLogs,
            finalConclusion,
            generatedById: req.user.id,
            approvalData
        });

        generatedReportFile = await generateInternalMicroReport({
            sample: {
                ...sample,
                reportNumber,
                closedAt,
                finalConclusion,
                approvalData
            },
            samplingPoint: sample.samplingPoint,
            parameters,
            internalLogs: sample.internalLogs,
            finalResults
        });

        await prisma.$transaction(async (tx) => {
            previousReportUrls = sample.attachments
                .filter(attachment => attachment.category === 'LAB_REPORT')
                .map(attachment => attachment.url);

            if (sample.attachments.length > 0) {
                await tx.microSampleAttachment.deleteMany({
                    where: {
                        sampleId: id,
                        category: 'LAB_REPORT'
                    }
                });
            }

            for (const resultRow of finalResults) {
                await tx.microResult.upsert({
                    where: {
                        sampleId_parameterId: {
                            sampleId: id,
                            parameterId: resultRow.parameterId
                        }
                    },
                    update: {
                        value: resultRow.value,
                        valueText: resultRow.valueText,
                        isDetected: resultRow.isDetected,
                        isCompliant: resultRow.isCompliant,
                        notes: resultRow.notes
                    },
                    create: {
                        sampleId: id,
                        parameterId: resultRow.parameterId,
                        value: resultRow.value,
                        valueText: resultRow.valueText,
                        isDetected: resultRow.isDetected,
                        isCompliant: resultRow.isCompliant,
                        notes: resultRow.notes
                    }
                });
            }

            await tx.microSampleAttachment.create({
                data: {
                    sampleId: id,
                    category: generatedReportFile.category,
                    originalName: generatedReportFile.originalName,
                    storedName: generatedReportFile.storedName,
                    mimeType: generatedReportFile.mimeType,
                    sizeBytes: generatedReportFile.sizeBytes,
                    url: generatedReportFile.url
                }
            });

            await tx.microSample.update({
                where: { id },
                data: {
                    lab: INTERNAL_DEFAULT_LAB,
                    reportNumber,
                    reportUrl: generatedReportFile.url,
                    status: 'CLOSED',
                    finalConclusion,
                    finalReportData: reportDataPayload,
                    approvalData,
                    completedAt: closedAt,
                    closedAt
                }
            });

            await logMicroAuditEvent(tx, {
                userId: req.user.id,
                action: 'MICRO_INTERNAL_CLOSED',
                sampleId: id,
                changes: {
                    closedAt,
                    reportNumber,
                    approvedBy: approvalData?.approvedBy || null
                }
            });

            if (sample.scheduleEntry?.id) {
                await tx.microScheduleEntry.update({
                    where: { id: sample.scheduleEntry.id },
                    data: { status: 'CLOSED' }
                });
            }
        });
        transactionCommitted = true;

        if (previousReportUrls.length > 0) {
            await deleteFilesByUrls(previousReportUrls);
        }

        const finalizedSample = await prisma.microSample.findUnique({
            where: { id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        res.json({
            message: 'Laboratorio interno finalizado y reporte cerrado automáticamente',
            sample: await buildSampleResponse(finalizedSample)
        });
    } catch (error) {
        if (!transactionCommitted && generatedReportFile) {
            await cleanupStoredFiles([generatedReportFile]);
        }
        respondWithError(res, error, 'Error finalizing internal laboratory', 'Error al finalizar el laboratorio interno');
    }
};

// ── Dashboard Data ──
exports.getDashboard = async (req, res) => {
    try {
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

        const recentSamples = await prisma.microSample.findMany({
            where: { takenAt: { gte: fourWeeksAgo } },
            include: {
                samplingPoint: true,
                results: { include: { parameter: true } },
                attachments: true,
                internalLogs: true,
                takenBy: { select: { name: true } },
                scheduleEntry: true
            },
            orderBy: { takenAt: 'desc' }
        });

        const recentScheduleEntries = await prisma.microScheduleEntry.findMany({
            where: { plannedDate: { gte: fourWeeksAgo } },
            include: {
                sample: {
                    select: { status: true }
                }
            }
        });

        const resultSummary = buildDashboardResultSummary(recentSamples);
        const evidenceSummary = buildDashboardEvidenceSummary(recentSamples);
        const nonCompliant = recentSamples
            .flatMap(sample => sample.results || [])
            .filter(result => result.isCompliant === false);
        const pointInsights = buildPointInsights(recentSamples);
        const byPoint = Object.fromEntries(pointInsights.map(point => [point.code, {
            name: point.name,
            total: point.evaluatedResults,
            compliant: point.evaluatedResults - point.nonCompliantCount,
            nonCompliant: point.nonCompliantCount,
            sampleCount: point.sampleCount,
            reportCount: point.reportCount,
            photoEvidenceCount: point.photoEvidenceCount,
            evaluationCoverageRate: point.evaluationCoverageRate,
            reportCoverageRate: point.reportCoverageRate,
            photoCoverageRate: point.photoCoverageRate,
            latestSampleAt: point.latestSampleAt
        }]));

        const workflowSummary = recentSamples.reduce((accumulator, sample) => {
            const key = sample.workflowType || 'EXTERNAL';
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
        }, {});

        const statusSummary = recentSamples.reduce((accumulator, sample) => {
            accumulator[sample.status] = (accumulator[sample.status] || 0) + 1;
            return accumulator;
        }, {});
        const scheduleStatusSummary = recentScheduleEntries.reduce((accumulator, entry) => {
            const status = getScheduleDisplayStatus(entry, entry.sample);
            accumulator[status] = (accumulator[status] || 0) + 1;
            return accumulator;
        }, {});

        const alerts = generateAlerts(nonCompliant, recentSamples);
        const dataQualityWarnings = buildDataQualityWarnings({
            resultSummary,
            evidenceSummary
        });

        res.json({
            summary: {
                totalSamples: recentSamples.length,
                totalResults: resultSummary.totalResultsRecorded,
                totalResultsRecorded: resultSummary.totalResultsRecorded,
                evaluatedResults: resultSummary.evaluatedResults,
                compliantResults: resultSummary.compliantResults,
                complianceRate: resultSummary.complianceRate,
                evaluationCoverageRate: resultSummary.evaluationCoverageRate,
                nonCompliantCount: resultSummary.nonCompliantCount,
                resultsWithoutCriteria: resultSummary.resultsWithoutCriteria,
                totalSamplesWithReport: evidenceSummary.totalSamplesWithReport,
                reportCoverageRate: evidenceSummary.reportCoverageRate,
                totalSamplesWithPhotoEvidence: evidenceSummary.totalSamplesWithPhotoEvidence,
                photoCoverageRate: evidenceSummary.photoCoverageRate,
                externalSamples: evidenceSummary.externalSamples,
                externalSamplesWithoutPhotoEvidence: evidenceSummary.externalSamplesWithoutPhotoEvidence
            },
            byPoint,
            pointInsights,
            workflowSummary,
            statusSummary,
            scheduleStatusSummary,
            alerts,
            dataQualityWarnings,
            evidenceSummary,
            resultSummary,
            recentSamples: recentSamples.map(sample => ({
                ...sample,
                summary: buildSampleSummary(sample)
            }))
        });
    } catch (error) {
        respondWithError(res, error, 'Error fetching micro dashboard', 'Error al obtener dashboard microbiológico');
    }
};

// ── Trend Data ──
exports.getTrendData = async (req, res) => {
    try {
        const { pointId, parameterId, weeks = 12 } = req.query;
        const parsedWeeks = parseInt(weeks, 10);
        const normalizedWeeks = Number.isInteger(parsedWeeks) && parsedWeeks > 0
            ? Math.min(parsedWeeks, 104)
            : 12;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (normalizedWeeks * 7));

        const where = { sample: { takenAt: { gte: startDate } } };
        if (pointId) where.sample.samplingPointId = pointId;
        if (parameterId) where.parameterId = parameterId;

        const results = await prisma.microResult.findMany({
            where,
            include: {
                sample: {
                    select: {
                        sampleNumber: true,
                        takenAt: true,
                        workflowType: true,
                        workContext: true,
                        shift: true,
                        laboratoryProfile: true,
                        lotNumber: true,
                        batchCode: true,
                        zoneName: true,
                        productionContextData: true,
                        samplingPoint: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                                processArea: true,
                                zoneName: true,
                                isEnvironmental: true
                            }
                        }
                    }
                },
                parameter: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        unit: true,
                        method: true,
                        specMin: true,
                        specMax: true,
                        specText: true,
                        regulatoryRef: true
                    }
                }
            },
            orderBy: { sample: { takenAt: 'asc' } }
        });
        const trendPayload = buildMicroTrendPayload({ results });

        res.json({
            ...trendPayload,
            period: { from: startDate, weeks: normalizedWeeks },
            filters: {
                pointId: pointId || null,
                parameterId: parameterId || null
            }
        });
    } catch (error) {
        respondWithError(res, error, 'Error fetching trend data', 'Error al obtener tendencias');
    }
};

exports.generateSampleLabelPdf = async (req, res) => {
    try {
        const pdfBuffer = await generateMicroSampleLabelPdf(req.body || {});
        const fileSeed = normalizeOptionalText(req.body?.sampleNumber)
            || normalizeOptionalText(req.body?.lotNumber)
            || normalizeOptionalText(req.body?.pointCode)
            || 'micro';
        const safeFileSeed = fileSeed.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'micro';

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="etiqueta_micro_${safeFileSeed}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        respondWithError(res, error, 'Error generating micro sample label pdf', 'Error al generar etiqueta de muestra');
    }
};

// ── Get Single Sample by ID ──
exports.getSampleById = async (req, res) => {
    try {
        const sample = await prisma.microSample.findUnique({
            where: { id: req.params.id },
            include: SAMPLE_DETAIL_INCLUDE
        });

        if (!sample) {
            const error = new Error('Muestra no encontrada');
            error.statusCode = 404;
            throw error;
        }

        res.json(await buildSampleResponse(sample));
    } catch (error) {
        respondWithError(res, error, 'Error fetching micro sample', 'Error al obtener muestra');
    }
};

// ── Get All Samples (for list view) ──
exports.getSamples = async (req, res) => {
    try {
        const pointId = normalizeOptionalText(req.query.pointId);
        const search = normalizeOptionalText(req.query.search);
        const statusList = parseQueryValueList(req.query.status);
        const workflowTypeList = parseQueryValueList(req.query.workflowType);
        const onlyOpen = parseBooleanQuery(req.query.onlyOpen);
        const lite = parseBooleanQuery(req.query.lite);
        const limitValue = parseInt(req.query.limit, 10);
        const limit = Number.isInteger(limitValue) && limitValue > 0
            ? Math.min(limitValue, 300)
            : 50;
        const andFilters = [];

        if (pointId) {
            andFilters.push({ samplingPointId: pointId });
        }

        if (statusList.length === 1) {
            andFilters.push({ status: statusList[0] });
        } else if (statusList.length > 1) {
            andFilters.push({ status: { in: statusList } });
        }

        if (workflowTypeList.length === 1) {
            andFilters.push({ workflowType: workflowTypeList[0] });
        } else if (workflowTypeList.length > 1) {
            andFilters.push({ workflowType: { in: workflowTypeList } });
        }

        if (onlyOpen) {
            andFilters.push({
                status: {
                    notIn: ['CLOSED', 'COMPLETED', 'REJECTED']
                }
            });
        }

        const dateFrom = normalizeOptionalText(req.query.dateFrom);
        const dateTo = normalizeOptionalText(req.query.dateTo);
        if (dateFrom || dateTo) {
            const takenAt = {};
            if (dateFrom) {
                takenAt.gte = dateFrom.length === 10
                    ? buildUtcDateFromIso(dateFrom, 0, 0, 0, 0)
                    : normalizeOptionalDateTime(dateFrom, 'la fecha inicial');
            }
            if (dateTo) {
                takenAt.lte = dateTo.length === 10
                    ? buildUtcDateFromIso(dateTo, 23, 59, 59, 999)
                    : normalizeOptionalDateTime(dateTo, 'la fecha final');
            }
            andFilters.push({ takenAt });
        }

        if (search) {
            andFilters.push({
                OR: [
                    { sampleNumber: { contains: search, mode: 'insensitive' } },
                    { reportNumber: { contains: search, mode: 'insensitive' } },
                    { lotNumber: { contains: search, mode: 'insensitive' } },
                    { batchCode: { contains: search, mode: 'insensitive' } },
                    { sampleDescription: { contains: search, mode: 'insensitive' } },
                    { notes: { contains: search, mode: 'insensitive' } },
                    {
                        samplingPoint: {
                            is: {
                                OR: [
                                    { code: { contains: search, mode: 'insensitive' } },
                                    { name: { contains: search, mode: 'insensitive' } },
                                    { zoneCode: { contains: search, mode: 'insensitive' } },
                                    { zoneName: { contains: search, mode: 'insensitive' } }
                                ]
                            }
                        }
                    }
                ]
            });
        }

        const where = andFilters.length > 0 ? { AND: andFilters } : {};

        const samples = await prisma.microSample.findMany({
            where,
            include: {
                samplingPoint: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        zoneCode: true,
                        zoneName: true,
                        processArea: true
                    }
                },
                results: { include: { parameter: { select: { code: true, name: true, specMax: true, specText: true } } } },
                attachments: true,
                internalLogs: true,
                takenBy: { select: { id: true, name: true } },
                scheduleEntry: true
            },
            orderBy: { takenAt: 'desc' },
            take: limit
        });

        if (lite) {
            res.json(samples.map(sample => {
                const requestedParameterIds = normalizeRequestedParameterIdList(sample.requestedParameterIds);
                return {
                    ...sample,
                    requestedParameterIds,
                    summary: buildSampleSummary({
                        ...sample,
                        requestedParameterIds
                    })
                };
            }));
            return;
        }

        const hydratedSamples = await Promise.all(samples.map(sample => buildSampleResponse(sample)));
        res.json(hydratedSamples);
    } catch (error) {
        respondWithError(res, error, 'Error fetching micro samples', 'Error al obtener muestras');
    }
};

// ── Helper: Generate Alerts & Technical Suggestions ──
function generateAlerts(nonCompliantResults, recentSamples) {
    const alerts = [];

    nonCompliantResults.forEach(result => {
        const sample = recentSamples.find(candidate => candidate.results.some(row => row.id === result.id));
        if (!sample) return;

        const pointCode = sample.samplingPoint.code;
        const paramCode = result.parameter.code;

        let suggestion = '';
        let severity = 'WARNING';

        if (paramCode === 'SALMONELLA' && result.isDetected) {
            severity = 'CRITICAL';
            suggestion = 'Detener línea e investigar de inmediato. Revisar materia prima, agua, superficies y liberación del lote.';
        } else if (paramCode === 'ENTEROBACTERIAS') {
            if (pointCode.startsWith('ALG-PRE')) {
                suggestion = 'Revisar preparación previa a pasteurización: tanque, tiempos de espera y control de temperatura.';
            } else if (pointCode.startsWith('ALG-POST')) {
                severity = 'CRITICAL';
                suggestion = 'Posible contaminación post-pasteurización. Verificar equipos, fugas y manipulación posterior.';
            } else if (pointCode.startsWith('ESF')) {
                suggestion = 'Revisar cabezotes, solución de calcio, superficies y sanitización en esferificación.';
            } else {
                suggestion = 'Revisar higiene del proceso, limpieza y posibles focos de contaminación cruzada.';
            }
        } else if (paramCode === 'MOHOS_LEVADURAS') {
            if (result.value > 1000) {
                severity = 'CRITICAL';
                suggestion = 'Carga alta de mohos/levaduras. Programar limpieza profunda y revisar ambiente, humedad y ventilación.';
            } else {
                suggestion = 'Resultado elevado. Revisar limpieza, ambiente y materias primas expuestas.';
            }
        } else if (paramCode === 'AEROBIOS_MESOFILOS') {
            if (result.value > 10000000) {
                severity = 'CRITICAL';
                suggestion = 'Carga extremadamente alta. Validar cadena térmica, tiempos de proceso y sanitización general.';
            } else {
                suggestion = 'Revisar programa de limpieza y variables críticas del proceso.';
            }
        } else if (paramCode === 'COLIFORMES_TOTALES' || paramCode === 'COLIFORMES_FECALES') {
            severity = 'CRITICAL';
            suggestion = 'Revisar agua, prácticas de higiene y posible contaminación post-proceso.';
        } else {
            suggestion = 'Resultado fuera de especificación. Investigar el punto, la zona y el contexto en que se tomó la muestra.';
        }

        alerts.push({
            id: result.id,
            severity,
            date: sample.takenAt,
            sampleNumber: sample.sampleNumber,
            point: sample.samplingPoint.name,
            pointCode,
            parameter: result.parameter.name,
            value: result.value,
            valueText: result.valueText,
            specMax: result.parameter.specMax,
            suggestion
        });
    });

    const byPoint = {};
    recentSamples.forEach(sample => {
        const code = sample.samplingPoint.code;
        if (!byPoint[code]) byPoint[code] = [];
        const hasNonCompliant = sample.results.some(result => result.isCompliant === false);
        byPoint[code].push({ date: sample.takenAt, hasNonCompliant });
    });

    Object.entries(byPoint).forEach(([code, samples]) => {
        const sorted = samples.sort((left, right) => new Date(right.date) - new Date(left.date));
        const last3 = sorted.slice(0, 3);
        if (last3.length === 3 && last3.every(sample => sample.hasNonCompliant)) {
            alerts.push({
                severity: 'CRITICAL',
                point: code,
                parameter: 'Tendencia',
                suggestion: `Tres muestras consecutivas fuera de especificación en ${code}. Revisar proceso, sanitización y liberación antes de continuar.`
            });
        }
    });

    const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((left, right) => (severityOrder[left.severity] || 2) - (severityOrder[right.severity] || 2));

    return alerts;
}
