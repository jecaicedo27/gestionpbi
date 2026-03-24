import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { Beaker, CheckCircle2, ClipboardList, Clock3, ExternalLink, FileCog, FlaskConical, History, Info, Layers3, ListChecks, Paperclip, PlusCircle, Save, ScrollText, X } from 'lucide-react';
import {
    INTERNAL_SAMPLE_GENERAL_CONTEXT_ID,
    LABORATORY_PROFILE_OPTIONS,
    SHIFT_OPTIONS,
    STATUS_META,
    buildInternalSampleTypeSummaryItems,
    buildInternalWorkflowPreview,
    buildInternalSampleUnitLabel,
    buildSampleEntityContext,
    createDefaultInternalAcceptanceData,
    createDefaultInternalApprovalData,
    createDefaultInternalDeviationData,
    createDefaultInternalExecutionData,
    createDefaultInternalReviewData,
    createDefaultInternalSampleTypeState,
    buildScopedResultRows,
    buildOptionLabel,
    extractFilledResults,
    formatDateTimeLabel,
    getAllowedOptions,
    hasMeaningfulDataObject,
    hasMeaningfulInternalSampleTypeData,
    isQualitativeResult,
    normalizeInternalSampleTypeDataForState,
    syncInternalSampleTypeDataWithRequestedParameters
} from './microLabConfig';
import MicroAnalysisSelector from './components/MicroAnalysisSelector';
import MicroWorkContextField from './components/MicroWorkContextField';
import MicroWorkflowTimeline from './components/MicroWorkflowTimeline';
import MicroInternalAcceptancePanel from './components/MicroInternalAcceptancePanel';
import MicroInternalExecutionPanel from './components/MicroInternalExecutionPanel';
import MicroInternalReviewPanel from './components/MicroInternalReviewPanel';
import MicroAuditTrailPanel from './components/MicroAuditTrailPanel';
import MicroStructuredSummaryCard from './components/MicroStructuredSummaryCard';
import MicroInternalWorkspaceNav from './components/MicroInternalWorkspaceNav';
import MicroInternalLogbookPanel from './components/MicroInternalLogbookPanel';
import MicroInternalResultsPanel from './components/MicroInternalResultsPanel';
import MicroInternalSampleDossierPanel from './components/MicroInternalSampleDossierPanel';
import MicroAttachmentsPanel from './components/MicroAttachmentsPanel';
import { normalizeExistingAttachments } from './microSampleEntryConfig';
import { buildMicroLabelPayloadFromInternalUnit, downloadMicroLabelPdf } from './microLabelUtils';

const API = import.meta.env.VITE_API_URL;
const INTERNAL_PANEL_IDS = {
    SETUP: 'SETUP',
    OVERVIEW: 'OVERVIEW',
    RECEPTION: 'RECEPTION',
    CASE: 'CASE',
    EXECUTION: 'EXECUTION',
    SUPPORTS: 'SUPPORTS',
    LOGBOOK: 'LOGBOOK',
    RESULTS: 'RESULTS',
    REVIEW: 'REVIEW',
    TRACEABILITY: 'TRACEABILITY'
};

const toDateKey = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const getRequestedParameterIds = (sample = null, fallbackIds = []) => (
    sample?.requestedParameterIds
    || sample?.requestedParameters?.map(parameter => parameter.id)
    || fallbackIds
    || []
);

const hasReadingValue = (reading = {}) => (
    reading?.value !== '' && reading?.value !== null && reading?.value !== undefined
    || reading?.valueText !== '' && reading?.valueText !== null && reading?.valueText !== undefined
    || reading?.isDetected !== null && reading?.isDetected !== undefined
);

const formatReadingDisplayValue = (reading = {}) => {
    if (reading.isDetected === true) return 'Detectado';
    if (reading.isDetected === false) return 'Ausente';
    if (reading.value !== null && reading.value !== undefined && reading.value !== '') return `${reading.value}`;
    if (reading.valueText) return reading.valueText;
    return 'Sin dato';
};

const formatDateTimeLocalInput = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const unwrapPendingAttachmentFile = (entry) => entry?.file || entry;

const fileIsPhoto = (entry) => {
    const file = unwrapPendingAttachmentFile(entry);
    return file?.type?.startsWith('image/')
        || /\.(png|jpe?g|webp|heic|heif)$/i.test(file?.name || '');
};

const fileIsVideo = (entry) => {
    const file = unwrapPendingAttachmentFile(entry);
    return file?.type?.startsWith('video/')
        || /\.(mp4|mov|avi|mkv|webm)$/i.test(file?.name || '');
};

const createPendingAttachmentId = (index = 0) => (
    `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`
);

const MicroInternalLabEntry = ({ scheduleEntry, existingSampleId, onClose, onDataChange }) => {
    const { token } = useAuth();
    const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [points, setPoints] = useState([]);
    const [params, setParams] = useState([]);
    const [currentSampleId, setCurrentSampleId] = useState(existingSampleId || null);
    const [sample, setSample] = useState(null);
    const [fetchingData, setFetchingData] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const [samplingPointId, setSamplingPointId] = useState(scheduleEntry?.point?.id || '');
    const [takenAt, setTakenAt] = useState(scheduleEntry?.plannedDate || new Date().toISOString().split('T')[0]);
    const [lotNumber, setLotNumber] = useState('');
    const [batchCode, setBatchCode] = useState('');
    const [sampleDescription, setSampleDescription] = useState('');
    const [notes, setNotes] = useState('');
    const [shift, setShift] = useState(scheduleEntry?.shift || '');
    const [workContext, setWorkContext] = useState(scheduleEntry?.workContext || '');
    const [laboratoryProfile, setLaboratoryProfile] = useState(scheduleEntry?.laboratoryProfile || '');
    const [zoneName, setZoneName] = useState(scheduleEntry?.zoneName || '');
    const [requestedParameterIds, setRequestedParameterIds] = useState(scheduleEntry?.requestedParameterIds || []);

    const [dailyLogDate, setDailyLogDate] = useState(new Date().toISOString().split('T')[0]);
    const [dailyObservations, setDailyObservations] = useState('');
    const [dailyReadings, setDailyReadings] = useState([]);
    const [finalConclusion, setFinalConclusion] = useState('');
    const [finalResults, setFinalResults] = useState([]);
    const [sampleTypeData, setSampleTypeData] = useState(createDefaultInternalSampleTypeState());
    const [acceptanceData, setAcceptanceData] = useState(createDefaultInternalAcceptanceData());
    const [analysisExecutionData, setAnalysisExecutionData] = useState(createDefaultInternalExecutionData());
    const [deviationData, setDeviationData] = useState(createDefaultInternalDeviationData());
    const [reviewData, setReviewData] = useState(createDefaultInternalReviewData());
    const [approvalData, setApprovalData] = useState(createDefaultInternalApprovalData());
    const [activePanel, setActivePanel] = useState(existingSampleId ? '' : INTERNAL_PANEL_IDS.SETUP);
    const [selectedLogDateKey, setSelectedLogDateKey] = useState('');
    const [seededSampleId, setSeededSampleId] = useState('');
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [activeSampleUnitId, setActiveSampleUnitId] = useState('');
    const [supportContextId, setSupportContextId] = useState(INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
    const [labelLoadingUnitId, setLabelLoadingUnitId] = useState('');

    useEffect(() => {
        const loadData = async () => {
            setFetchingData(true);
            setError('');
            try {
                const [pointsResponse, parametersResponse] = await Promise.all([
                    axios.get(`${API}/api/micro/sampling-points`, { headers: authHeaders }),
                    axios.get(`${API}/api/micro/parameters`, { headers: authHeaders })
                ]);

                const loadedPoints = pointsResponse.data || [];
                const loadedParams = parametersResponse.data || [];
                setPoints(loadedPoints);
                setParams(loadedParams);

                if (currentSampleId) {
                    const sampleResponse = await axios.get(`${API}/api/micro/samples/${currentSampleId}`, { headers: authHeaders });
                    const loadedSample = sampleResponse.data;
                    const nextRequestedParameterIds = getRequestedParameterIds(loadedSample, scheduleEntry?.requestedParameterIds || []);
                    const latestLog = [...(loadedSample.internalLogs || [])].sort((left, right) => new Date(right.logDate) - new Date(left.logDate))[0];
                    const normalizedLoadedSampleTypeData = normalizeInternalSampleTypeDataForState(
                        loadedSample.sampleTypeData,
                        loadedSample.entityContext?.entityType
                            || buildSampleEntityContext({
                                point: loadedSample.samplingPoint,
                                laboratoryProfile: loadedSample.laboratoryProfile,
                                productionContextData: loadedSample.productionContextData
                            }).entityType
                    );

                    setSample(loadedSample);
                    setSamplingPointId(loadedSample.samplingPointId);
                    setTakenAt(new Date(loadedSample.takenAt).toISOString().split('T')[0]);
                    setLotNumber(loadedSample.lotNumber || '');
                    setBatchCode(loadedSample.batchCode || '');
                    setSampleDescription(loadedSample.sampleDescription || '');
                    setNotes(loadedSample.notes || '');
                    setShift(loadedSample.shift || scheduleEntry?.shift || '');
                    setWorkContext(loadedSample.workContext || scheduleEntry?.workContext || '');
                    setLaboratoryProfile(loadedSample.laboratoryProfile || scheduleEntry?.laboratoryProfile || '');
                    setZoneName(loadedSample.zoneName || loadedSample.samplingPoint?.zoneName || loadedSample.samplingPoint?.processArea || '');
                    setRequestedParameterIds(nextRequestedParameterIds);
                    setFinalConclusion(loadedSample.finalConclusion || '');
                    setSampleTypeData(normalizedLoadedSampleTypeData);
                    setActiveSampleUnitId(normalizedLoadedSampleTypeData.activeSampleUnitId || normalizedLoadedSampleTypeData.sampleUnits?.[0]?.id || '');
                    setSupportContextId(normalizedLoadedSampleTypeData.activeSampleUnitId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
                    setExistingAttachments(normalizeExistingAttachments(loadedSample));
                    setRemovedAttachmentIds([]);
                    setPendingAttachments([]);
                    setAcceptanceData({
                        ...createDefaultInternalAcceptanceData(),
                        ...(loadedSample.acceptanceData || {}),
                        receivedAt: formatDateTimeLocalInput(loadedSample.acceptanceData?.receivedAt || loadedSample.receivedAt)
                    });
                    setAnalysisExecutionData({
                        ...createDefaultInternalExecutionData(),
                        ...(loadedSample.analysisExecutionData || {}),
                        incubationStartedAt: formatDateTimeLocalInput(loadedSample.analysisExecutionData?.incubationStartedAt),
                        incubationEndedAt: formatDateTimeLocalInput(loadedSample.analysisExecutionData?.incubationEndedAt)
                    });
                    setDeviationData({
                        ...createDefaultInternalDeviationData(),
                        ...(loadedSample.deviationData || {})
                    });
                    setReviewData({
                        ...createDefaultInternalReviewData(),
                        ...(loadedSample.technicalReviewData || {}),
                        reviewedAt: formatDateTimeLocalInput(loadedSample.technicalReviewData?.reviewedAt || loadedSample.reviewedAt)
                    });
                    setApprovalData({
                        ...createDefaultInternalApprovalData(),
                        ...(loadedSample.approvalData || {}),
                        approvedAt: formatDateTimeLocalInput(loadedSample.approvalData?.approvedAt || loadedSample.closedAt)
                    });
                    setDailyLogDate(latestLog ? new Date(latestLog.logDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
                    setDailyObservations(latestLog?.observations || '');
                    setDailyReadings(buildScopedResultRows({
                        parameters: loadedParams,
                        requestedIds: nextRequestedParameterIds,
                        existingResults: latestLog?.readings || []
                    }));
                    setFinalResults(buildScopedResultRows({
                        parameters: loadedParams,
                        requestedIds: nextRequestedParameterIds,
                        existingResults: loadedSample.results || latestLog?.readings || []
                    }));
                } else {
                    const initialRequestedParameterIds = scheduleEntry?.requestedParameterIds || [];
                    setRequestedParameterIds(initialRequestedParameterIds);
                    setExistingAttachments([]);
                    setRemovedAttachmentIds([]);
                    setPendingAttachments([]);
                    const initialSampleTypeState = createDefaultInternalSampleTypeState(
                        buildSampleEntityContext({
                            point: scheduleEntry?.point || loadedPoints.find(point => point.id === samplingPointId) || null,
                            laboratoryProfile: scheduleEntry?.laboratoryProfile || laboratoryProfile
                        }).entityType
                    );
                    setSampleTypeData(initialSampleTypeState);
                    setActiveSampleUnitId(initialSampleTypeState.activeSampleUnitId || initialSampleTypeState.sampleUnits?.[0]?.id || '');
                    setSupportContextId(initialSampleTypeState.activeSampleUnitId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
                    setAcceptanceData(createDefaultInternalAcceptanceData());
                    setAnalysisExecutionData(createDefaultInternalExecutionData());
                    setDeviationData(createDefaultInternalDeviationData());
                    setReviewData(createDefaultInternalReviewData());
                    setApprovalData(createDefaultInternalApprovalData());
                    setDailyReadings(buildScopedResultRows({
                        parameters: loadedParams,
                        requestedIds: initialRequestedParameterIds,
                        existingResults: []
                    }));
                    setFinalResults(buildScopedResultRows({
                        parameters: loadedParams,
                        requestedIds: initialRequestedParameterIds,
                        existingResults: []
                    }));
                }
            } catch (loadError) {
                setError('Error cargando el flujo interno de laboratorio');
            } finally {
                setFetchingData(false);
            }
        };

        loadData();
    }, [authHeaders, currentSampleId, scheduleEntry]);

    const selectedPoint = useMemo(
        () => points.find(point => point.id === samplingPointId) || scheduleEntry?.point || null,
        [points, samplingPointId, scheduleEntry]
    );

    useEffect(() => {
        if (!selectedPoint || currentSampleId) return;
        setZoneName(selectedPoint.zoneName || selectedPoint.processArea || '');
        setShift(previous => previous || selectedPoint.defaultShift || '');
        setWorkContext(previous => previous || selectedPoint.defaultWorkContext || '');
        setLaboratoryProfile(previous => previous || selectedPoint.defaultLaboratoryProfile || '');
    }, [currentSampleId, selectedPoint]);

    const allowedShiftOptions = useMemo(
        () => getAllowedOptions(SHIFT_OPTIONS, selectedPoint?.allowedShifts || []),
        [selectedPoint]
    );
    const allowedProfileOptions = useMemo(
        () => getAllowedOptions(LABORATORY_PROFILE_OPTIONS, selectedPoint?.allowedLaboratoryProfiles || []),
        [selectedPoint]
    );
    const entityContext = useMemo(
        () => buildSampleEntityContext({ point: selectedPoint, laboratoryProfile }),
        [laboratoryProfile, selectedPoint]
    );
    const normalizedSampleTypeData = useMemo(
        () => normalizeInternalSampleTypeDataForState(sampleTypeData, entityContext.entityType),
        [entityContext.entityType, sampleTypeData]
    );
    const syncedSampleTypeData = useMemo(
        () => syncInternalSampleTypeDataWithRequestedParameters({
            sampleTypeData: normalizedSampleTypeData,
            requestedIds: requestedParameterIds,
            parameters: params,
            fallbackEntityType: entityContext.entityType,
            sampleNumber: sample?.sampleNumber
        }),
        [entityContext.entityType, normalizedSampleTypeData, params, requestedParameterIds, sample?.sampleNumber]
    );
    const sampleUnits = syncedSampleTypeData.sampleUnits || [];
    const attachmentAssignments = syncedSampleTypeData.attachmentAssignments || {};
    const latestInternalLog = useMemo(
        () => [...(sample?.internalLogs || [])].sort((left, right) => new Date(right.logDate) - new Date(left.logDate))[0] || null,
        [sample?.internalLogs]
    );
    const parameterMap = useMemo(
        () => new Map((params || []).map(parameter => [parameter.id, parameter])),
        [params]
    );
    const dailyFilledReadingsCount = useMemo(
        () => extractFilledResults(dailyReadings).length,
        [dailyReadings]
    );
    const finalFilledResultsCount = useMemo(
        () => extractFilledResults(finalResults).length,
        [finalResults]
    );
    const finalMissingResultsCount = useMemo(
        () => Math.max(requestedParameterIds.length - finalFilledResultsCount, 0),
        [finalFilledResultsCount, requestedParameterIds.length]
    );
    const latestLogFilledReadingsCount = useMemo(
        () => (latestInternalLog?.readings || []).filter(hasReadingValue).length,
        [latestInternalLog]
    );
    const activeSupportAttachments = useMemo(
        () => existingAttachments.filter(attachment => (
            attachment.category !== 'LAB_REPORT' && !removedAttachmentIds.includes(attachment.id)
        )),
        [existingAttachments, removedAttachmentIds]
    );
    const removedSupportAttachments = useMemo(
        () => existingAttachments.filter(attachment => (
            attachment.category !== 'LAB_REPORT' && removedAttachmentIds.includes(attachment.id)
        )),
        [existingAttachments, removedAttachmentIds]
    );
    const attachmentStatsByUnit = useMemo(() => {
        const initialStats = Object.fromEntries(
            sampleUnits.map(unit => [unit.id, {
                total: 0,
                photo: 0,
                video: 0,
                document: 0
            }])
        );

        const assignAttachmentToStats = (contextId, category) => {
            if (!contextId || contextId === INTERNAL_SAMPLE_GENERAL_CONTEXT_ID || !initialStats[contextId]) return;
            initialStats[contextId].total += 1;
            if (category === 'PHOTO') initialStats[contextId].photo += 1;
            else if (category === 'VIDEO') initialStats[contextId].video += 1;
            else initialStats[contextId].document += 1;
        };

        activeSupportAttachments.forEach(attachment => {
            assignAttachmentToStats(attachmentAssignments[attachment.id], attachment.category);
        });
        pendingAttachments.forEach(entry => {
            const category = fileIsPhoto(entry) ? 'PHOTO' : fileIsVideo(entry) ? 'VIDEO' : 'DOCUMENT';
            assignAttachmentToStats(entry.contextId, category);
        });

        return initialStats;
    }, [activeSupportAttachments, attachmentAssignments, pendingAttachments, sampleUnits]);
    const existingEvidenceByUnit = useMemo(() => {
        const initialMap = Object.fromEntries(sampleUnits.map(unit => [unit.id, []]));

        activeSupportAttachments.forEach(attachment => {
            const unitId = attachmentAssignments[attachment.id];
            if (!unitId || unitId === INTERNAL_SAMPLE_GENERAL_CONTEXT_ID || !initialMap[unitId]) return;
            initialMap[unitId].push(attachment);
        });

        return initialMap;
    }, [activeSupportAttachments, attachmentAssignments, sampleUnits]);
    const pendingEvidenceByUnit = useMemo(() => {
        const initialMap = Object.fromEntries(sampleUnits.map(unit => [unit.id, []]));

        pendingAttachments.forEach(entry => {
            const unitId = entry.contextId;
            if (!unitId || unitId === INTERNAL_SAMPLE_GENERAL_CONTEXT_ID || !initialMap[unitId]) return;
            initialMap[unitId].push(entry);
        });

        return initialMap;
    }, [pendingAttachments, sampleUnits]);
    const supportPhotoCount = useMemo(
        () => activeSupportAttachments.filter(attachment => attachment.category === 'PHOTO').length + pendingAttachments.filter(fileIsPhoto).length,
        [activeSupportAttachments, pendingAttachments]
    );
    const supportVideoCount = useMemo(
        () => activeSupportAttachments.filter(attachment => attachment.category === 'VIDEO').length + pendingAttachments.filter(fileIsVideo).length,
        [activeSupportAttachments, pendingAttachments]
    );
    const supportDocumentCount = useMemo(
        () => activeSupportAttachments.filter(attachment => !['PHOTO', 'VIDEO'].includes(attachment.category)).length
            + pendingAttachments.filter(entry => !fileIsPhoto(entry) && !fileIsVideo(entry)).length,
        [activeSupportAttachments, pendingAttachments]
    );
    const attachmentContextOptions = useMemo(() => ([
        { value: INTERNAL_SAMPLE_GENERAL_CONTEXT_ID, label: 'Expediente general' },
        ...sampleUnits.map((unit, index) => ({
            value: unit.id,
            label: buildInternalSampleUnitLabel(unit, index)
        }))
    ]), [sampleUnits]);
    const persistedSampleTypeData = useMemo(() => ({
        ...syncedSampleTypeData,
        activeSampleUnitId: activeSampleUnitId || syncedSampleTypeData.activeSampleUnitId || sampleUnits[0]?.id || ''
    }), [activeSampleUnitId, sampleUnits, syncedSampleTypeData]);
    const currentSampleAttachmentAssignments = useMemo(
        () => normalizeInternalSampleTypeDataForState(sample?.sampleTypeData, entityContext.entityType).attachmentAssignments || {},
        [entityContext.entityType, sample?.sampleTypeData]
    );
    const hasSupportAssignmentChanges = useMemo(
        () => JSON.stringify(currentSampleAttachmentAssignments) !== JSON.stringify(persistedSampleTypeData.attachmentAssignments || {}),
        [currentSampleAttachmentAssignments, persistedSampleTypeData.attachmentAssignments]
    );
    const sampleStatusMeta = STATUS_META[sample?.status] || STATUS_META.PLANNED;
    const isClosed = sample?.status === 'CLOSED';
    const isRejected = sample?.status === 'REJECTED';
    const isAccepted = Boolean(sample?.receivedAt || sample?.acceptanceData?.receivedAt) && sample?.acceptanceData?.accepted !== false;
    const hasTechnicalReview = Boolean(sample?.reviewedAt || sample?.technicalReviewData?.reviewedAt);
    const canRegisterResults = Boolean(currentSampleId) && isAccepted && !isClosed && !isRejected;
    const hasCompleteFinalResults = finalMissingResultsCount === 0 && Boolean(sample?.resultsCapturedAt || sample?.results?.length || finalFilledResultsCount);
    const canSubmitReview = canRegisterResults && hasCompleteFinalResults;
    const canCloseCase = canSubmitReview && hasTechnicalReview && sample?.technicalReviewData?.reviewDecision === 'APPROVED';

    useEffect(() => {
        const normalizedSnapshot = JSON.stringify(normalizedSampleTypeData);
        const syncedSnapshot = JSON.stringify(syncedSampleTypeData);
        if (normalizedSnapshot === syncedSnapshot) return;
        setSampleTypeData(syncedSampleTypeData);
    }, [normalizedSampleTypeData, syncedSampleTypeData]);

    useEffect(() => {
        if (sampleUnits.length === 0) {
            if (activeSampleUnitId) setActiveSampleUnitId('');
            if (supportContextId !== INTERNAL_SAMPLE_GENERAL_CONTEXT_ID) {
                setSupportContextId(INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
            }
            return;
        }

        if (!activeSampleUnitId || !sampleUnits.some(unit => unit.id === activeSampleUnitId)) {
            setActiveSampleUnitId(persistedSampleTypeData.activeSampleUnitId || sampleUnits[0]?.id || '');
        }

        if (
            supportContextId !== INTERNAL_SAMPLE_GENERAL_CONTEXT_ID
            && !sampleUnits.some(unit => unit.id === supportContextId)
        ) {
            setSupportContextId(activeSampleUnitId || persistedSampleTypeData.activeSampleUnitId || sampleUnits[0]?.id || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
        }
    }, [activeSampleUnitId, persistedSampleTypeData.activeSampleUnitId, sampleUnits, supportContextId]);

    const workflowSteps = useMemo(() => (
        sample?.workflowSteps?.length > 0
            ? sample.workflowSteps
            : buildInternalWorkflowPreview({
                takenAt: currentSampleId ? `${takenAt}T12:00:00` : '',
                receivedAt: sample?.receivedAt || sample?.acceptanceData?.receivedAt || '',
                isRejected,
                latestLogAt: latestInternalLog?.logDate || '',
                resultsCapturedAt: sample?.resultsCapturedAt || '',
                reviewedAt: sample?.reviewedAt || sample?.technicalReviewData?.reviewedAt || '',
                closedAt: sample?.closedAt || '',
                logCount: sample?.internalLogs?.length || 0,
                finalResultCount: sample?.results?.length || finalFilledResultsCount,
                hasReport: Boolean(sample?.reportUrl),
                requestedCount: requestedParameterIds.length,
                isDraft: !currentSampleId
            })
    ), [
        currentSampleId,
        finalFilledResultsCount,
        isRejected,
        latestInternalLog?.logDate,
        requestedParameterIds.length,
        sample?.closedAt,
        sample?.receivedAt,
        sample?.resultsCapturedAt,
        sample?.reviewedAt,
        sample?.technicalReviewData?.reviewedAt,
        sample?.acceptanceData?.receivedAt,
        sample?.internalLogs?.length,
        sample?.reportUrl,
        sample?.results?.length,
        sample?.workflowSteps,
        takenAt
    ]);
    const canFinalize = useMemo(
        () => !isClosed && !isRejected && (finalFilledResultsCount > 0 || latestLogFilledReadingsCount > 0),
        [finalFilledResultsCount, isClosed, isRejected, latestLogFilledReadingsCount]
    );
    const processMetrics = useMemo(() => ([
        {
            label: 'Muestras',
            value: sampleUnits.length,
            tone: 'border-slate-200 bg-slate-50 text-slate-900'
        },
        {
            label: 'Analisis objetivo',
            value: requestedParameterIds.length,
            tone: 'border-indigo-100 bg-indigo-50 text-indigo-900'
        },
        {
            label: 'Bitacoras',
            value: sample?.internalLogs?.length || 0,
            tone: 'border-teal-100 bg-teal-50 text-teal-900'
        },
        {
            label: 'Lecturas del dia',
            value: dailyFilledReadingsCount,
            tone: 'border-cyan-100 bg-cyan-50 text-cyan-900'
        },
        {
            label: 'Resultados finales',
            value: requestedParameterIds.length > 0
                ? `${sample?.results?.length || finalFilledResultsCount}/${requestedParameterIds.length}`
                : sample?.results?.length || finalFilledResultsCount,
            tone: 'border-emerald-100 bg-emerald-50 text-emerald-900'
        },
        {
            label: 'Soportes',
            value: activeSupportAttachments.length + pendingAttachments.length,
            tone: 'border-violet-100 bg-violet-50 text-violet-900'
        }
    ]), [
        dailyFilledReadingsCount,
        finalFilledResultsCount,
        activeSupportAttachments.length,
        pendingAttachments.length,
        requestedParameterIds.length,
        sampleUnits.length,
        sample?.internalLogs?.length,
        sample?.results?.length
    ]);
    const hasCaseData = useMemo(
        () => Boolean(sampleDescription || lotNumber || batchCode || notes || hasMeaningfulInternalSampleTypeData(normalizedSampleTypeData)),
        [batchCode, lotNumber, notes, normalizedSampleTypeData, sampleDescription]
    );
    const hasExecutionData = useMemo(
        () => hasMeaningfulDataObject(analysisExecutionData),
        [analysisExecutionData]
    );
    const hasDeviationData = useMemo(
        () => Boolean(deviationData?.hasDeviation && hasMeaningfulDataObject(deviationData)),
        [deviationData]
    );
    const acceptanceSummaryItems = useMemo(() => ([
        { label: 'Estado', value: isRejected ? 'Rechazada' : isAccepted ? 'Aceptada' : 'Pendiente' },
        { label: 'Ingreso', value: formatDateTimeLabel(sample?.acceptanceData?.receivedAt || sample?.receivedAt) },
        { label: 'Integridad', value: sample?.acceptanceData?.containerIntegrity || acceptanceData.containerIntegrity || '—' },
        { label: 'Temperatura', value: sample?.acceptanceData?.sampleTemperatureC ?? acceptanceData.sampleTemperatureC ?? '—' },
        { label: 'Cantidad', value: [sample?.acceptanceData?.sampleQuantity ?? acceptanceData.sampleQuantity, sample?.acceptanceData?.quantityUnit || acceptanceData.quantityUnit].filter(Boolean).join(' ') || '—' },
        { label: isRejected ? 'Motivo de rechazo' : 'Observaciones', value: sample?.acceptanceData?.rejectionReason || sample?.acceptanceData?.conditionNotes || acceptanceData.rejectionReason || acceptanceData.conditionNotes || '—', fullWidth: true }
    ]), [acceptanceData, isAccepted, isRejected, sample?.acceptanceData, sample?.receivedAt]);
    const caseSummaryItems = useMemo(() => ([
        { label: 'Descripción', value: sampleDescription || '—' },
        { label: 'Lote', value: lotNumber || '—' },
        { label: 'Batch', value: batchCode || '—' },
        { label: 'Ente', value: entityContext.entityLabel || '—' },
        { label: 'Submuestras', value: sampleUnits.length || 0 },
        ...buildInternalSampleTypeSummaryItems(normalizedSampleTypeData),
        { label: 'Observaciones de caso', value: notes || '—', fullWidth: true }
    ]), [batchCode, entityContext.entityLabel, lotNumber, notes, normalizedSampleTypeData, sampleDescription, sampleUnits.length]);
    const executionSummaryItems = useMemo(() => ([
        { label: 'Método', value: analysisExecutionData.methodCode || '—' },
        { label: 'Versión', value: analysisExecutionData.methodVersion || '—' },
        { label: 'Analista', value: analysisExecutionData.analystName || '—' },
        { label: 'Equipo', value: analysisExecutionData.equipmentName || '—' },
        { label: 'Incubador', value: analysisExecutionData.incubatorName || '—' },
        { label: 'Lote medio', value: analysisExecutionData.mediaLot || '—' },
        { label: 'Control positivo', value: analysisExecutionData.positiveControl || '—' },
        { label: 'Control negativo', value: analysisExecutionData.negativeControl || '—' },
        { label: 'Inicio incubación', value: formatDateTimeLabel(analysisExecutionData.incubationStartedAt) },
        { label: 'Fin incubación', value: formatDateTimeLabel(analysisExecutionData.incubationEndedAt) },
        { label: 'Duplicado', value: analysisExecutionData.duplicatePerformed ? 'Sí' : 'No' },
        { label: 'Normas base', value: Array.isArray(analysisExecutionData.normativeRefs) && analysisExecutionData.normativeRefs.length > 0 ? analysisExecutionData.normativeRefs.join(', ') : '—', fullWidth: true },
        { label: 'Desviaciones', value: hasDeviationData ? 'Sí, con CAPA / acciones' : 'Sin desviaciones documentadas', fullWidth: true },
        { label: 'Notas de ejecución', value: analysisExecutionData.executionNotes || '—', fullWidth: true }
    ]), [analysisExecutionData, hasDeviationData]);
    const reviewSummaryItems = useMemo(() => ([
        { label: 'Dictamen', value: sample?.technicalReviewData?.reviewDecision || 'Pendiente' },
        { label: 'Decisión operativa', value: sample?.technicalReviewData?.releaseDecision || 'Pendiente' },
        { label: 'Fecha revisión', value: formatDateTimeLabel(sample?.technicalReviewData?.reviewedAt || sample?.reviewedAt) },
        { label: 'Fecha aprobación', value: formatDateTimeLabel(sample?.approvalData?.approvedAt || sample?.closedAt) },
        { label: 'Base normativa', value: Array.isArray(sample?.technicalReviewData?.normativeRefs) && sample.technicalReviewData.normativeRefs.length > 0 ? sample.technicalReviewData.normativeRefs.join(', ') : '—', fullWidth: true },
        { label: 'Observaciones', value: sample?.technicalReviewData?.reviewNotes || '—', fullWidth: true },
        { label: 'Notas aprobación', value: sample?.approvalData?.approvalNotes || '—', fullWidth: true }
    ]), [sample?.approvalData?.approvalNotes, sample?.approvalData?.approvedAt, sample?.closedAt, sample?.reviewedAt, sample?.technicalReviewData?.normativeRefs, sample?.technicalReviewData?.releaseDecision, sample?.technicalReviewData?.reviewDecision, sample?.technicalReviewData?.reviewNotes, sample?.technicalReviewData?.reviewedAt]);
    const supportsSummaryItems = useMemo(() => ([
        { label: 'Fotos activas', value: supportPhotoCount },
        { label: 'Videos activos', value: supportVideoCount },
        { label: 'Documentos activos', value: supportDocumentCount },
        { label: 'Pendientes por guardar', value: pendingAttachments.length },
        { label: 'Marcados para retiro', value: removedSupportAttachments.length },
        { label: 'Informe final', value: sample?.reportNumber || (sample?.reportUrl ? 'Disponible' : 'Pendiente') },
        { label: 'Notas', value: pendingAttachments.length > 0 ? 'Hay archivos en cola de guardado.' : 'Sin cambios pendientes en soportes.', fullWidth: true }
    ]), [pendingAttachments.length, removedSupportAttachments.length, sample?.reportNumber, sample?.reportUrl, supportDocumentCount, supportPhotoCount, supportVideoCount]);
    const nextAction = useMemo(() => {
        if (!currentSampleId) {
            return { sectionId: INTERNAL_PANEL_IDS.SETUP, label: 'Crear caso interno' };
        }
        if (isRejected) {
            return { sectionId: INTERNAL_PANEL_IDS.TRACEABILITY, label: 'Revisar rechazo y trazabilidad' };
        }
        if (!isAccepted) {
            return { sectionId: INTERNAL_PANEL_IDS.RECEPTION, label: 'Registrar recepción' };
        }
        if (!hasExecutionData) {
            return { sectionId: INTERNAL_PANEL_IDS.EXECUTION, label: 'Completar trazabilidad técnica' };
        }
        if ((sample?.internalLogs?.length || 0) === 0 && !(sample?.resultsCapturedAt || sample?.results?.length)) {
            return { sectionId: INTERNAL_PANEL_IDS.LOGBOOK, label: 'Registrar primera bitácora' };
        }
        if (!hasCompleteFinalResults) {
            return { sectionId: INTERNAL_PANEL_IDS.RESULTS, label: 'Completar resultados finales' };
        }
        if (!hasTechnicalReview) {
            return { sectionId: INTERNAL_PANEL_IDS.REVIEW, label: 'Registrar revisión técnica' };
        }
        if (!isClosed) {
            return { sectionId: INTERNAL_PANEL_IDS.REVIEW, label: 'Aprobar y cerrar caso' };
        }
        return { sectionId: INTERNAL_PANEL_IDS.TRACEABILITY, label: 'Consultar trazabilidad y reporte' };
    }, [currentSampleId, hasCompleteFinalResults, hasExecutionData, hasTechnicalReview, isAccepted, isClosed, isRejected, sample?.internalLogs?.length]);
    const workspaceSections = useMemo(() => {
        const resolveStatus = (sectionId, completed = false, needsAttention = false, blocked = false) => {
            if (activePanel === sectionId) return 'current';
            if (blocked) return 'blocked';
            if (completed) return 'completed';
            if (needsAttention) return 'attention';
            return 'pending';
        };

        return [
            {
                id: INTERNAL_PANEL_IDS.OVERVIEW,
                label: 'Resumen',
                helper: 'Vista ejecutiva del caso interno.',
                icon: Layers3,
                status: resolveStatus(INTERNAL_PANEL_IDS.OVERVIEW, Boolean(currentSampleId))
            },
            {
                id: INTERNAL_PANEL_IDS.RECEPTION,
                label: 'Recepción',
                helper: isRejected ? 'Muestra rechazada al ingreso.' : isAccepted ? 'Recepción cerrada.' : 'Pendiente por aceptar.',
                icon: CheckCircle2,
                badge: isRejected ? 'Rechazo' : isAccepted ? 'OK' : 'Pend.',
                status: resolveStatus(INTERNAL_PANEL_IDS.RECEPTION, isAccepted, !isAccepted && !isRejected, isRejected)
            },
            {
                id: INTERNAL_PANEL_IDS.CASE,
                label: 'Muestras',
                helper: hasCaseData
                    ? `${sampleUnits.length || 0} submuestra(s) organizadas con ficha propia.`
                    : 'Completa la ficha general y crea las submuestras del caso.',
                icon: FlaskConical,
                badge: sampleUnits.length || null,
                status: resolveStatus(INTERNAL_PANEL_IDS.CASE, hasCaseData, currentSampleId && !hasCaseData)
            },
            {
                id: INTERNAL_PANEL_IDS.EXECUTION,
                label: 'Ejecución',
                helper: hasExecutionData ? 'Método, analista, incubación y controles.' : 'Falta trazabilidad técnica.',
                icon: FileCog,
                status: resolveStatus(INTERNAL_PANEL_IDS.EXECUTION, hasExecutionData, isAccepted && !hasExecutionData)
            },
            {
                id: INTERNAL_PANEL_IDS.SUPPORTS,
                label: 'Soportes',
                helper: activeSupportAttachments.length > 0 || pendingAttachments.length > 0
                    ? 'Fotos, videos y documentos asignados al expediente o a submuestras.'
                    : 'Sin soportes cargados aún.',
                icon: Paperclip,
                badge: activeSupportAttachments.length + pendingAttachments.length || null,
                status: resolveStatus(
                    INTERNAL_PANEL_IDS.SUPPORTS,
                    activeSupportAttachments.length > 0 || Boolean(sample?.reportUrl),
                    pendingAttachments.length > 0 || removedSupportAttachments.length > 0
                )
            },
            {
                id: INTERNAL_PANEL_IDS.LOGBOOK,
                label: 'Bitácora',
                helper: sample?.internalLogs?.length > 0 ? `${sample.internalLogs.length} día(s) registrados.` : 'Sin seguimiento registrado.',
                icon: ClipboardList,
                badge: sample?.internalLogs?.length || null,
                status: resolveStatus(INTERNAL_PANEL_IDS.LOGBOOK, (sample?.internalLogs?.length || 0) > 0, isAccepted && (sample?.internalLogs?.length || 0) === 0)
            },
            {
                id: INTERNAL_PANEL_IDS.RESULTS,
                label: 'Resultados',
                helper: hasCompleteFinalResults
                    ? 'Resultados finales completos.'
                    : sample?.resultsCapturedAt || sample?.results?.length || finalFilledResultsCount
                        ? `Faltan ${finalMissingResultsCount} analisis por consolidar.`
                        : 'Pendiente por consolidar.',
                icon: ScrollText,
                badge: sample?.results?.length || null,
                status: resolveStatus(
                    INTERNAL_PANEL_IDS.RESULTS,
                    hasCompleteFinalResults,
                    isAccepted && !hasCompleteFinalResults
                )
            },
            {
                id: INTERNAL_PANEL_IDS.REVIEW,
                label: 'Revisión',
                helper: hasTechnicalReview ? 'Dictamen técnico registrado.' : 'Pendiente por revisar.',
                icon: ListChecks,
                status: resolveStatus(INTERNAL_PANEL_IDS.REVIEW, hasTechnicalReview, hasCompleteFinalResults && !hasTechnicalReview)
            },
            {
                id: INTERNAL_PANEL_IDS.TRACEABILITY,
                label: 'Trazabilidad',
                helper: isClosed ? 'Caso cerrado con reporte.' : 'Auditoría, historial y soportes.',
                icon: History,
                status: resolveStatus(INTERNAL_PANEL_IDS.TRACEABILITY, isClosed)
            }
        ];
    }, [activePanel, activeSupportAttachments.length, currentSampleId, finalFilledResultsCount, finalMissingResultsCount, hasCaseData, hasCompleteFinalResults, hasExecutionData, hasTechnicalReview, isAccepted, isClosed, isRejected, pendingAttachments.length, removedSupportAttachments.length, sample?.internalLogs?.length, sample?.reportUrl, sample?.results?.length, sample?.resultsCapturedAt, sampleUnits.length]);
    const activeWorkspaceSection = useMemo(
        () => workspaceSections.find(section => section.id === activePanel) || workspaceSections[0] || null,
        [activePanel, workspaceSections]
    );
    const traceabilitySummaryItems = useMemo(() => ([
        { label: 'Bitácoras registradas', value: sample?.internalLogs?.length || 0 },
        { label: 'Última bitácora', value: formatDateTimeLabel(latestInternalLog?.logDate) },
        { label: 'Resultados consolidados', value: requestedParameterIds.length > 0 ? `${sample?.results?.length || finalFilledResultsCount}/${requestedParameterIds.length}` : sample?.results?.length || finalFilledResultsCount },
        { label: 'Soportes activos', value: activeSupportAttachments.length },
        { label: 'Eventos auditados', value: sample?.auditTrail?.length || 0 },
        { label: 'Reporte final', value: sample?.reportNumber || (sample?.reportUrl ? 'Disponible' : 'Pendiente') },
        { label: 'Conclusión final', value: sample?.finalConclusion || finalConclusion || '—', fullWidth: true }
    ]), [
        activeSupportAttachments.length,
        finalConclusion,
        finalFilledResultsCount,
        latestInternalLog?.logDate,
        requestedParameterIds.length,
        sample?.auditTrail?.length,
        sample?.finalConclusion,
        sample?.internalLogs?.length,
        sample?.reportNumber,
        sample?.reportUrl,
        sample?.results?.length
    ]);
    const stageSummaryCards = useMemo(() => ({
        [INTERNAL_PANEL_IDS.RECEPTION]: {
            id: INTERNAL_PANEL_IDS.RECEPTION,
            title: 'Recepción',
            description: 'Ingreso y aceptación del material recibido.',
            tone: isRejected ? 'rose' : isAccepted ? 'sky' : 'slate',
            items: acceptanceSummaryItems
        },
        [INTERNAL_PANEL_IDS.CASE]: {
            id: INTERNAL_PANEL_IDS.CASE,
            title: 'Ficha del expediente',
            description: 'Marco general y submuestras documentadas.',
            tone: 'indigo',
            items: caseSummaryItems
        },
        [INTERNAL_PANEL_IDS.EXECUTION]: {
            id: INTERNAL_PANEL_IDS.EXECUTION,
            title: 'Trazabilidad técnica',
            description: 'Método, incubación, controles y desviaciones.',
            tone: 'teal',
            items: executionSummaryItems
        },
        [INTERNAL_PANEL_IDS.SUPPORTS]: {
            id: INTERNAL_PANEL_IDS.SUPPORTS,
            title: 'Soportes',
            description: 'Evidencias vinculadas al expediente y submuestras.',
            tone: 'emerald',
            items: supportsSummaryItems
        },
        [INTERNAL_PANEL_IDS.LOGBOOK]: {
            id: INTERNAL_PANEL_IDS.LOGBOOK,
            title: 'Bitácora',
            description: 'Seguimiento diario del ensayo y lecturas.',
            tone: 'teal',
            items: [
                { label: 'Registros', value: sample?.internalLogs?.length || 0 },
                { label: 'Última fecha', value: formatDateTimeLabel(latestInternalLog?.logDate) },
                { label: 'Lecturas última bitácora', value: latestLogFilledReadingsCount }
            ]
        },
        [INTERNAL_PANEL_IDS.RESULTS]: {
            id: INTERNAL_PANEL_IDS.RESULTS,
            title: 'Resultados',
            description: 'Cobertura consolidada frente al alcance analítico.',
            tone: 'emerald',
            items: [
                { label: 'Cobertura', value: requestedParameterIds.length > 0 ? `${finalFilledResultsCount}/${requestedParameterIds.length}` : finalFilledResultsCount },
                { label: 'Pendientes', value: finalMissingResultsCount },
                { label: 'Conclusión', value: finalConclusion || sample?.finalConclusion || '—', fullWidth: true }
            ]
        },
        [INTERNAL_PANEL_IDS.REVIEW]: {
            id: INTERNAL_PANEL_IDS.REVIEW,
            title: 'Revisión y cierre',
            description: 'Dictamen, decisión operativa y aprobación.',
            tone: 'fuchsia',
            items: reviewSummaryItems
        }
    }), [
        acceptanceSummaryItems,
        caseSummaryItems,
        executionSummaryItems,
        finalConclusion,
        finalFilledResultsCount,
        finalMissingResultsCount,
        isAccepted,
        isRejected,
        latestInternalLog?.logDate,
        latestLogFilledReadingsCount,
        requestedParameterIds.length,
        reviewSummaryItems,
        sample?.finalConclusion,
        sample?.internalLogs?.length,
        supportsSummaryItems
    ]);
    const priorStageCards = useMemo(() => {
        const orderedPanels = [
            INTERNAL_PANEL_IDS.RECEPTION,
            INTERNAL_PANEL_IDS.CASE,
            INTERNAL_PANEL_IDS.EXECUTION,
            INTERNAL_PANEL_IDS.SUPPORTS,
            INTERNAL_PANEL_IDS.LOGBOOK,
            INTERNAL_PANEL_IDS.RESULTS,
            INTERNAL_PANEL_IDS.REVIEW
        ];
        const activeIndex = orderedPanels.indexOf(activePanel);
        if (activeIndex <= 0) return [];

        return orderedPanels
            .slice(0, activeIndex)
            .map(panelId => stageSummaryCards[panelId])
            .filter(Boolean);
    }, [activePanel, stageSummaryCards]);

    const renderStageWorkspace = (mainContent) => (
        <div className={`grid gap-4 ${priorStageCards.length > 0 ? 'xl:grid-cols-[1.22fr_0.78fr]' : 'grid-cols-1'}`}>
            <div className="space-y-4">
                {mainContent}
            </div>
            {priorStageCards.length > 0 && (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Resumen previo</p>
                        <p className="mt-2 text-sm text-slate-700">
                            Esta etapa solo muestra el trabajo en curso. Lo anterior queda condensado aquí para no mezclar pantallas ni duplicar formularios.
                        </p>
                    </div>
                    {priorStageCards.map(card => (
                        <MicroStructuredSummaryCard
                            key={card.id}
                            title={card.title}
                            description={card.description}
                            tone={card.tone}
                            items={card.items}
                        />
                    ))}
                </div>
            )}
        </div>
    );

    const updateResultRows = (setter, index, field, value) => {
        setter(previous => previous.map((result, resultIndex) => (
            resultIndex === index ? { ...result, [field]: value } : result
        )));
    };

    const toggleExistingAttachment = (attachmentId) => {
        setRemovedAttachmentIds(previous => (
            previous.includes(attachmentId)
                ? previous.filter(currentId => currentId !== attachmentId)
                : [...previous, attachmentId]
        ));
    };

    const updateExistingAttachmentContext = (attachmentId, contextId) => {
        setSampleTypeData(previous => ({
            ...previous,
            attachmentAssignments: {
                ...(previous?.attachmentAssignments || {}),
                [attachmentId]: contextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID
            }
        }));
    };

    const addPendingAttachments = (files = [], { contextId = '' } = {}) => {
        if (!Array.isArray(files) || files.length === 0) return;
        const resolvedContextId = contextId || supportContextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID;
        setPendingAttachments(previous => ([
            ...previous,
            ...files.map((file, index) => ({
                id: createPendingAttachmentId(index),
                file,
                contextId: resolvedContextId
            }))
        ]));
        setError('');
    };

    const handleEvidenceFilesSelected = (files = [], { unitId = '' } = {}) => {
        if (!Array.isArray(files) || files.length === 0) return;

        const resolvedContextId = unitId || activeSampleUnitId || supportContextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID;

        addPendingAttachments(files, { contextId: resolvedContextId });
        handleActiveUnitSelection(unitId || activeSampleUnitId || '');

        if (currentSampleId) {
            setActivePanel(INTERNAL_PANEL_IDS.SUPPORTS);
        }

        setError('');
        setSuccessMsg('');
    };

    const handleGenerateInternalUnitLabel = async (unit = null) => {
        if (!unit?.id || !sample?.sampleNumber) {
            setError('Guarda o recarga el laboratorio antes de generar la etiqueta de la muestra');
            return;
        }

        const unitIndex = sampleUnits.findIndex(currentUnit => currentUnit.id === unit.id);
        if (unitIndex < 0) {
            setError('No fue posible ubicar la submuestra para generar su etiqueta');
            return;
        }

        setLabelLoadingUnitId(unit.id);
        setError('');

        try {
            await downloadMicroLabelPdf({
                token,
                payload: buildMicroLabelPayloadFromInternalUnit({
                    sample,
                    samplingPoint: selectedPoint || sample?.samplingPoint || {},
                    unit,
                    unitIndex,
                    zoneName,
                    workContext,
                    shift,
                    laboratoryProfile
                })
            });
        } catch (labelError) {
            setError(labelError.response?.data?.error || 'No fue posible generar la etiqueta 50 x 40 mm de la muestra');
        } finally {
            setLabelLoadingUnitId('');
        }
    };

    const removePendingAttachment = (fileIndex) => {
        setPendingAttachments(previous => previous.filter((_, index) => index !== fileIndex));
    };

    const removePendingAttachmentById = (pendingId) => {
        if (!pendingId) return;
        setPendingAttachments(previous => previous.filter(entry => entry.id !== pendingId));
    };

    const updatePendingAttachmentContext = (pendingId, contextId) => {
        setPendingAttachments(previous => previous.map(entry => (
            entry.id === pendingId
                ? { ...entry, contextId: contextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID }
                : entry
        )));
    };

    const handleActiveUnitSelection = (unitId = '') => {
        setActiveSampleUnitId(unitId);
        setSupportContextId(unitId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
    };

    const openSupportsForUnit = (unitId = '') => {
        if (unitId) {
            handleActiveUnitSelection(unitId);
        }
        setActivePanel(INTERNAL_PANEL_IDS.SUPPORTS);
    };

    useEffect(() => {
        if (!currentSampleId) {
            setActivePanel(INTERNAL_PANEL_IDS.SETUP);
            setSelectedLogDateKey('');
            setSeededSampleId('');
            setExistingAttachments([]);
            setRemovedAttachmentIds([]);
            setPendingAttachments([]);
            return;
        }

        if (!sample?.id || seededSampleId === sample.id) return;

        setActivePanel(nextAction.sectionId || INTERNAL_PANEL_IDS.OVERVIEW);
        setSelectedLogDateKey(toDateKey(latestInternalLog?.logDate) || dailyLogDate || new Date().toISOString().slice(0, 10));
        setSeededSampleId(sample.id);
    }, [currentSampleId, dailyLogDate, hasCaseData, hasExecutionData, latestInternalLog?.logDate, nextAction.sectionId, sample?.id, seededSampleId]);

    const refreshParent = () => {
        if (typeof onDataChange === 'function') onDataChange();
    };

    const handleCreateInternalLab = async () => {
        if (!samplingPointId) {
            setError('Seleccione un punto para iniciar el laboratorio interno');
            return;
        }

        if (requestedParameterIds.length === 0) {
            setError('Seleccione al menos un analisis solicitado para iniciar el laboratorio interno');
            return;
        }

        setSaving(true);
        setError('');
        setSuccessMsg('');

        try {
            const formData = new FormData();
            formData.append('workflowType', 'INTERNAL');
            if (scheduleEntry?.id) formData.append('scheduleEntryId', scheduleEntry.id);
            formData.append('samplingPointId', samplingPointId);
            formData.append('takenAt', new Date(`${takenAt}T12:00:00`).toISOString());
            formData.append('shift', shift);
            formData.append('workContext', workContext);
            formData.append('laboratoryProfile', laboratoryProfile);
            formData.append('requestedParameterIds', JSON.stringify(requestedParameterIds));
            formData.append('sampleTypeData', JSON.stringify(persistedSampleTypeData || {}));
            if (pendingAttachments.length > 0) {
                pendingAttachments.forEach(entry => formData.append('attachments', entry.file));
                formData.append('pendingAttachmentMeta', JSON.stringify(
                    pendingAttachments.map(entry => ({
                        id: entry.id,
                        unitId: entry.contextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID
                    }))
                ));
            }
            if (lotNumber) formData.append('lotNumber', lotNumber);
            if (batchCode) formData.append('batchCode', batchCode);
            if (sampleDescription) formData.append('sampleDescription', sampleDescription);
            if (notes) formData.append('notes', notes);

            const response = await axios.post(`${API}/api/micro/samples`, formData, {
                headers: { ...authHeaders, 'Content-Type': 'multipart/form-data' }
            });

            const createdSample = response.data?.sample || null;
            const normalizedCreatedSampleTypeData = normalizeInternalSampleTypeDataForState(
                createdSample?.sampleTypeData,
                createdSample?.entityContext?.entityType || entityContext.entityType
            );
            setSample(createdSample);
            setExistingAttachments(normalizeExistingAttachments(createdSample || {}));
            setRemovedAttachmentIds([]);
            setPendingAttachments([]);
            setRequestedParameterIds(getRequestedParameterIds(createdSample, requestedParameterIds));
            setSampleTypeData(normalizedCreatedSampleTypeData);
            setActiveSampleUnitId(normalizedCreatedSampleTypeData.activeSampleUnitId || normalizedCreatedSampleTypeData.sampleUnits?.[0]?.id || '');
            setSupportContextId(normalizedCreatedSampleTypeData.activeSampleUnitId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID);
            setCurrentSampleId(createdSample?.id || response.data?.sample?.sample?.id || response.data?.sample?.sampleId || null);
            setActivePanel(INTERNAL_PANEL_IDS.RECEPTION);
            setSuccessMsg('Laboratorio interno iniciado. Ahora ya puedes registrar el seguimiento diario.');
            refreshParent();
        } catch (createError) {
            setError(createError.response?.data?.error || 'Error iniciando el laboratorio interno');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveInternalCase = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        try {
            const response = await axios.patch(`${API}/api/micro/samples/${currentSampleId}/internal-case`, {
                sampleTypeData: persistedSampleTypeData,
                analysisExecutionData,
                deviationData,
                notes,
                sampleDescription,
                lotNumber,
                batchCode
            }, { headers: authHeaders });

            const updatedSample = response.data?.sample || null;
            const normalizedUpdatedSampleTypeData = normalizeInternalSampleTypeDataForState(
                updatedSample?.sampleTypeData,
                updatedSample?.entityContext?.entityType || entityContext.entityType
            );
            setSample(updatedSample);
            setExistingAttachments(normalizeExistingAttachments(updatedSample || {}));
            setSampleTypeData(normalizedUpdatedSampleTypeData);
            setActiveSampleUnitId(normalizedUpdatedSampleTypeData.activeSampleUnitId || normalizedUpdatedSampleTypeData.sampleUnits?.[0]?.id || '');
            setAnalysisExecutionData({
                ...createDefaultInternalExecutionData(),
                ...(updatedSample?.analysisExecutionData || {}),
                incubationStartedAt: formatDateTimeLocalInput(updatedSample?.analysisExecutionData?.incubationStartedAt),
                incubationEndedAt: formatDateTimeLocalInput(updatedSample?.analysisExecutionData?.incubationEndedAt)
            });
            setDeviationData({
                ...createDefaultInternalDeviationData(),
                ...(updatedSample?.deviationData || {})
            });
            setSuccessMsg('Ficha interna actualizada');
            refreshParent();
        } catch (saveError) {
            setError(saveError.response?.data?.error || 'Error actualizando la ficha interna');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveInternalSupports = async () => {
        if (!currentSampleId) return;

        if (pendingAttachments.length === 0 && removedSupportAttachments.length === 0 && !hasSupportAssignmentChanges) {
            setSuccessMsg('No hay cambios pendientes en soportes o evidencias');
            return;
        }

        setSaving(true);
        setError('');
        setSuccessMsg('');

        try {
            const formData = new FormData();
            pendingAttachments.forEach(entry => formData.append('attachments', entry.file));
            formData.append('sampleTypeData', JSON.stringify(persistedSampleTypeData || {}));
            formData.append('pendingAttachmentMeta', JSON.stringify(
                pendingAttachments.map(entry => ({
                    id: entry.id,
                    unitId: entry.contextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID
                }))
            ));
            if (removedAttachmentIds.length > 0) {
                formData.append(
                    'removedAttachmentIds',
                    JSON.stringify(removedAttachmentIds.filter(attachmentId => !`${attachmentId}`.startsWith('legacy:')))
                );
            }

            const response = await axios.patch(`${API}/api/micro/samples/${currentSampleId}/internal-supports`, formData, {
                headers: { ...authHeaders, 'Content-Type': 'multipart/form-data' }
            });

            const updatedSample = response.data?.sample || null;
            const normalizedUpdatedSampleTypeData = normalizeInternalSampleTypeDataForState(
                updatedSample?.sampleTypeData,
                updatedSample?.entityContext?.entityType || entityContext.entityType
            );
            setSample(updatedSample);
            setExistingAttachments(normalizeExistingAttachments(updatedSample || {}));
            setSampleTypeData(normalizedUpdatedSampleTypeData);
            setRemovedAttachmentIds([]);
            setPendingAttachments([]);
            setSuccessMsg(response.data?.message || 'Soportes y evidencias actualizados');
            setActivePanel(INTERNAL_PANEL_IDS.SUPPORTS);
            refreshParent();
        } catch (supportError) {
            setError(supportError.response?.data?.error || 'Error actualizando soportes del laboratorio interno');
        } finally {
            setSaving(false);
        }
    };

    const handleSelectLog = (log) => {
        if (!log) return;

        const logDateKey = toDateKey(log.logDate);
        setSelectedLogDateKey(logDateKey);
        setDailyLogDate(logDateKey);
        setDailyObservations(log.observations || '');
        setDailyReadings(buildScopedResultRows({
            parameters: params,
            requestedIds: requestedParameterIds,
            existingResults: log.readings || []
        }));
    };

    const handleCreateNewLog = () => {
        const todayKey = new Date().toISOString().slice(0, 10);
        setSelectedLogDateKey(todayKey);
        setDailyLogDate(todayKey);
        setDailyObservations('');
        setDailyReadings(buildScopedResultRows({
            parameters: params,
            requestedIds: requestedParameterIds,
            existingResults: []
        }));
    };

    const handleAcceptInternalSample = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        try {
            const response = await axios.post(`${API}/api/micro/samples/${currentSampleId}/accept-internal`, {
                acceptanceData
            }, { headers: authHeaders });

            const updatedSample = response.data?.sample || null;
            setSample(updatedSample);
            setExistingAttachments(normalizeExistingAttachments(updatedSample || {}));
            setAcceptanceData({
                ...createDefaultInternalAcceptanceData(),
                ...(updatedSample?.acceptanceData || {}),
                receivedAt: formatDateTimeLocalInput(updatedSample?.acceptanceData?.receivedAt || updatedSample?.receivedAt)
            });
            setActivePanel(hasExecutionData ? INTERNAL_PANEL_IDS.LOGBOOK : INTERNAL_PANEL_IDS.EXECUTION);
            setSuccessMsg(response.data?.message || 'Recepción registrada');
            refreshParent();
        } catch (acceptError) {
            setError(acceptError.response?.data?.error || 'Error registrando la recepción');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveDailyLog = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        const targetLogDate = dailyLogDate;
        try {
            await axios.post(`${API}/api/micro/samples/${currentSampleId}/internal-logs`, {
                logDate: dailyLogDate,
                observations: dailyObservations,
                readings: extractFilledResults(dailyReadings)
            }, { headers: authHeaders });

            setSuccessMsg('Seguimiento diario registrado');
            refreshParent();

            const sampleResponse = await axios.get(`${API}/api/micro/samples/${currentSampleId}`, { headers: authHeaders });
            const updatedSample = sampleResponse.data;
            const nextRequestedParameterIds = getRequestedParameterIds(updatedSample, requestedParameterIds);
            setSample(updatedSample);
            setExistingAttachments(normalizeExistingAttachments(updatedSample || {}));
            setRequestedParameterIds(nextRequestedParameterIds);
            const matchedLog = (updatedSample.internalLogs || []).find(log => toDateKey(log.logDate) === targetLogDate)
                || [...(updatedSample.internalLogs || [])].sort((left, right) => new Date(right.logDate) - new Date(left.logDate))[0];
            setSelectedLogDateKey(toDateKey(matchedLog?.logDate));
            setDailyLogDate(toDateKey(matchedLog?.logDate) || targetLogDate);
            setDailyObservations(matchedLog?.observations || '');
            setDailyReadings(buildScopedResultRows({
                parameters: params,
                requestedIds: nextRequestedParameterIds,
                existingResults: matchedLog?.readings || []
            }));
            setFinalResults(buildScopedResultRows({
                parameters: params,
                requestedIds: nextRequestedParameterIds,
                existingResults: updatedSample.results || matchedLog?.readings || []
            }));
            setActivePanel(INTERNAL_PANEL_IDS.LOGBOOK);
        } catch (logError) {
            setError(logError.response?.data?.error || 'Error guardando el seguimiento diario');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveInternalResults = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        try {
            const response = await axios.post(`${API}/api/micro/samples/${currentSampleId}/internal-results`, {
                analysisExecutionData,
                finalResults: extractFilledResults(finalResults),
                finalConclusion
            }, { headers: authHeaders });

            const updatedSample = response.data?.sample || null;
            const nextRequestedParameterIds = getRequestedParameterIds(updatedSample, requestedParameterIds);
            setSample(updatedSample);
            setExistingAttachments(normalizeExistingAttachments(updatedSample || {}));
            setRequestedParameterIds(nextRequestedParameterIds);
            setSuccessMsg(response.data?.message || 'Resultados finales registrados');
            setReviewData(createDefaultInternalReviewData());
            setApprovalData(createDefaultInternalApprovalData());
            setAnalysisExecutionData({
                ...createDefaultInternalExecutionData(),
                ...(updatedSample?.analysisExecutionData || {}),
                incubationStartedAt: formatDateTimeLocalInput(updatedSample?.analysisExecutionData?.incubationStartedAt),
                incubationEndedAt: formatDateTimeLocalInput(updatedSample?.analysisExecutionData?.incubationEndedAt)
            });
            setFinalResults(buildScopedResultRows({
                parameters: params,
                requestedIds: nextRequestedParameterIds,
                existingResults: updatedSample?.results || []
            }));
            setActivePanel(INTERNAL_PANEL_IDS.REVIEW);
            refreshParent();
        } catch (resultError) {
            setError(resultError.response?.data?.error || 'Error registrando resultados finales');
        } finally {
            setSaving(false);
        }
    };

    const handleReviewInternalSample = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        try {
            const response = await axios.post(`${API}/api/micro/samples/${currentSampleId}/internal-review`, {
                technicalReviewData: reviewData,
                deviationData
            }, { headers: authHeaders });

            const reviewedSample = response.data?.sample || null;
            setSample(reviewedSample);
            setExistingAttachments(normalizeExistingAttachments(reviewedSample || {}));
            setReviewData({
                ...createDefaultInternalReviewData(),
                ...(reviewedSample?.technicalReviewData || {}),
                reviewedAt: formatDateTimeLocalInput(reviewedSample?.technicalReviewData?.reviewedAt || reviewedSample?.reviewedAt)
            });
            setDeviationData({
                ...createDefaultInternalDeviationData(),
                ...(reviewedSample?.deviationData || {})
            });
            setActivePanel(INTERNAL_PANEL_IDS.REVIEW);
            setSuccessMsg(response.data?.message || 'Revisión técnica registrada');
            refreshParent();
        } catch (reviewError) {
            setError(reviewError.response?.data?.error || 'Error registrando la revisión técnica');
        } finally {
            setSaving(false);
        }
    };

    const handleFinalize = async () => {
        if (!currentSampleId) return;

        setSaving(true);
        setError('');
        setSuccessMsg('');
        try {
            const response = await axios.post(`${API}/api/micro/samples/${currentSampleId}/finalize-internal`, {
                approvalData,
                finalConclusion
            }, { headers: authHeaders });

            const finalizedSample = response.data?.sample || null;
            setSample(finalizedSample);
            setExistingAttachments(normalizeExistingAttachments(finalizedSample || {}));
            setRemovedAttachmentIds([]);
            setPendingAttachments([]);
            setRequestedParameterIds(getRequestedParameterIds(finalizedSample, requestedParameterIds));
            setApprovalData({
                ...createDefaultInternalApprovalData(),
                ...(finalizedSample?.approvalData || {}),
                approvedAt: formatDateTimeLocalInput(finalizedSample?.approvalData?.approvedAt || finalizedSample?.closedAt)
            });
            setActivePanel(INTERNAL_PANEL_IDS.TRACEABILITY);
            setSuccessMsg('Laboratorio interno cerrado. El reporte final quedó generado y auditado.');
            refreshParent();
        } catch (finalizeError) {
            setError(finalizeError.response?.data?.error || 'Error finalizando el laboratorio interno');
        } finally {
            setSaving(false);
        }
    };

    const renderWorkspacePanel = () => {
        if (!currentSampleId) return null;

        if (activePanel === INTERNAL_PANEL_IDS.OVERVIEW) {
            return (
                <div className="grid gap-4 xl:grid-cols-2">
                    <MicroStructuredSummaryCard
                        title="Recepción y aceptación"
                        description="Estado de ingreso de la muestra al laboratorio."
                        tone={isRejected ? 'rose' : isAccepted ? 'sky' : 'slate'}
                        items={acceptanceSummaryItems}
                        actionLabel={!isClosed && !isRejected && !(sample?.internalLogs?.length || sample?.results?.length) ? 'Gestionar recepción' : ''}
                        onAction={() => setActivePanel(INTERNAL_PANEL_IDS.RECEPTION)}
                    />
                    <MicroStructuredSummaryCard
                        title="Ficha del ente muestreado"
                        description="Referencia técnica del punto, lote, batch y ente."
                        tone="indigo"
                        items={caseSummaryItems}
                        emptyText="Aún no hay información complementaria en la ficha de muestra."
                        actionLabel={!isClosed && !isRejected ? 'Editar ficha' : ''}
                        onAction={() => setActivePanel(INTERNAL_PANEL_IDS.CASE)}
                    />
                    <MicroStructuredSummaryCard
                        title="Trazabilidad del ensayo"
                        description="Método, analista, incubación, controles y desvíos."
                        tone="teal"
                        items={executionSummaryItems}
                        emptyText="Todavía no se ha diligenciado la trazabilidad técnica."
                        actionLabel={!isClosed && !isRejected ? 'Editar trazabilidad' : ''}
                        onAction={() => setActivePanel(INTERNAL_PANEL_IDS.EXECUTION)}
                    />
                    <MicroStructuredSummaryCard
                        title="Soportes y evidencias"
                        description="Fotos, documentos, cadenas de custodia y demás soportes del caso."
                        tone="emerald"
                        items={supportsSummaryItems}
                        actionLabel={!isClosed ? 'Gestionar soportes' : ''}
                        onAction={() => setActivePanel(INTERNAL_PANEL_IDS.SUPPORTS)}
                    />
                    <MicroStructuredSummaryCard
                        title="Revisión y cierre"
                        description="Dictamen técnico, aprobación final y estado del reporte."
                        tone="fuchsia"
                        items={reviewSummaryItems}
                        actionLabel={!isRejected ? 'Ir a revisión' : ''}
                        onAction={() => setActivePanel(INTERNAL_PANEL_IDS.REVIEW)}
                        footer={sample?.reportUrl ? (
                            <a
                                href={`${API}${sample.reportUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                                <ExternalLink size={13} /> Ver reporte final
                            </a>
                        ) : null}
                    />
                </div>
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.RECEPTION) {
            return renderStageWorkspace(
                <MicroInternalAcceptancePanel
                    data={acceptanceData}
                    onChange={setAcceptanceData}
                    onSubmit={handleAcceptInternalSample}
                    disabled={isClosed || isRejected || Boolean(sample?.internalLogs?.length || sample?.results?.length)}
                    saving={saving}
                />
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.CASE) {
            return renderStageWorkspace(
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-indigo-100 overflow-hidden">
                        <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100">
                            <h3 className="font-bold text-indigo-900 text-sm">Marco general del expediente</h3>
                            <p className="text-xs text-indigo-700 mt-1">
                                Este bloque conserva la información común del caso. Las submuestras viven debajo con su propio paso a paso y ya no comparten un mismo formulario genérico.
                            </p>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote</label>
                                    <input
                                        type="text"
                                        value={lotNumber}
                                        onChange={event => setLotNumber(event.target.value)}
                                        disabled={isClosed || isRejected}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${(isClosed || isRejected) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Batch</label>
                                    <input
                                        type="text"
                                        value={batchCode}
                                        onChange={event => setBatchCode(event.target.value)}
                                        disabled={isClosed || isRejected}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${(isClosed || isRejected) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Descripción del expediente</label>
                                <input
                                    type="text"
                                    value={sampleDescription}
                                    onChange={event => setSampleDescription(event.target.value)}
                                    disabled={isClosed || isRejected}
                                    className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${(isClosed || isRejected) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones del expediente</label>
                                <textarea
                                    value={notes}
                                    onChange={event => setNotes(event.target.value)}
                                    rows={4}
                                    disabled={isClosed || isRejected}
                                    className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${(isClosed || isRejected) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                />
                            </div>
                        </div>
                    </div>

                    <MicroInternalSampleDossierPanel
                        sampleTypeData={persistedSampleTypeData}
                        onChange={setSampleTypeData}
                        disabled={isClosed || isRejected}
                        activeUnitId={activeSampleUnitId}
                        onActiveUnitChange={handleActiveUnitSelection}
                        analysisDrivenCount={requestedParameterIds.length}
                        attachmentStatsByUnit={attachmentStatsByUnit}
                        onOpenSupports={currentSampleId ? openSupportsForUnit : null}
                        canUploadEvidence={!saving && !isClosed && !isRejected}
                        onEvidenceFilesSelected={handleEvidenceFilesSelected}
                        apiBase={API}
                        existingEvidenceByUnit={existingEvidenceByUnit}
                        pendingEvidenceByUnit={pendingEvidenceByUnit}
                        onRemoveExistingEvidence={toggleExistingAttachment}
                        onRemovePendingEvidence={removePendingAttachmentById}
                        onGenerateLabel={currentSampleId ? handleGenerateInternalUnitLabel : null}
                        labelLoadingUnitId={labelLoadingUnitId}
                    />

                    {!isClosed && !isRejected && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveInternalCase}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                                Guardar ficha interna
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.EXECUTION) {
            return renderStageWorkspace(
                <MicroInternalExecutionPanel
                    executionData={analysisExecutionData}
                    deviationData={deviationData}
                    onExecutionChange={setAnalysisExecutionData}
                    onDeviationChange={setDeviationData}
                    onSubmit={handleSaveInternalCase}
                    disabled={isClosed || isRejected}
                    saving={saving}
                />
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.SUPPORTS) {
            return renderStageWorkspace(
                <div className="space-y-4">
                    <MicroAttachmentsPanel
                        apiBase={API}
                        existingAttachments={existingAttachments}
                        removedAttachmentIds={removedAttachmentIds}
                        onToggleExistingAttachment={toggleExistingAttachment}
                        reportFile={null}
                        onReportSelected={() => {}}
                        onClearReport={() => {}}
                        pendingAttachments={pendingAttachments}
                        onAddAttachments={addPendingAttachments}
                        onRemovePendingAttachment={removePendingAttachment}
                        contextOptions={attachmentContextOptions}
                        selectedContextId={supportContextId}
                        onSelectedContextChange={setSupportContextId}
                        existingAttachmentAssignments={attachmentAssignments}
                        pendingAttachmentAssignments={Object.fromEntries(pendingAttachments.map(entry => [entry.id, entry.contextId || INTERNAL_SAMPLE_GENERAL_CONTEXT_ID]))}
                        onExistingAttachmentContextChange={updateExistingAttachmentContext}
                        onPendingAttachmentContextChange={updatePendingAttachmentContext}
                        showReportSection={false}
                        introText="Carga aquí fotos, videos, cadenas de custodia y documentos. Cada archivo puede quedar amarrado al expediente general o a una submuestra específica."
                        supportTitle="Soportes del expediente interno"
                        supportDescription="Puedes cargar fotos, videos, PDF, Word o Excel. El informe final del laboratorio interno se genera automáticamente al cierre."
                        supportInputLabel="Agregar fotos, videos y documentos"
                        supportInputHelper="Los soportes quedan auditados en el caso y puedes asignarlos a la submuestra activa."
                    />
                    {!isClosed && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveInternalSupports}
                                disabled={saving || (pendingAttachments.length === 0 && removedSupportAttachments.length === 0 && !hasSupportAssignmentChanges)}
                                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                                Guardar soportes
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.LOGBOOK) {
            return renderStageWorkspace(
                <MicroInternalLogbookPanel
                    sampleStatusMeta={sampleStatusMeta}
                    requestedCount={requestedParameterIds.length}
                    canEdit={isAccepted && !isRejected && !isClosed}
                    dailyLogDate={dailyLogDate}
                    onDailyLogDateChange={setDailyLogDate}
                    dailyObservations={dailyObservations}
                    onDailyObservationsChange={setDailyObservations}
                    dailyReadings={dailyReadings}
                    onReadingChange={(index, field, value) => updateResultRows(setDailyReadings, index, field, value)}
                    onSave={handleSaveDailyLog}
                    onNewLog={handleCreateNewLog}
                    saving={saving}
                    logs={sample?.internalLogs || []}
                    selectedLogDate={selectedLogDateKey}
                    onSelectLog={handleSelectLog}
                    isQualitativeResult={isQualitativeResult}
                    formatDateTimeLabel={formatDateTimeLabel}
                />
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.RESULTS) {
            return renderStageWorkspace(
                <MicroInternalResultsPanel
                    results={finalResults}
                    finalConclusion={finalConclusion}
                    onConclusionChange={setFinalConclusion}
                    onResultChange={(index, field, value) => updateResultRows(setFinalResults, index, field, value)}
                    onSave={handleSaveInternalResults}
                    canEdit={canRegisterResults}
                    canSave={canRegisterResults && canFinalize && finalMissingResultsCount === 0}
                    saving={saving}
                    isQualitativeResult={isQualitativeResult}
                    showMissingDataWarning={!canFinalize && !isClosed && !isRejected}
                    requiredCount={requestedParameterIds.length}
                    completedCount={finalFilledResultsCount}
                    missingCount={finalMissingResultsCount}
                />
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.REVIEW) {
            return renderStageWorkspace(
                <MicroInternalReviewPanel
                    reviewData={reviewData}
                    approvalData={approvalData}
                    onReviewChange={setReviewData}
                    onApprovalChange={setApprovalData}
                    onReviewSubmit={handleReviewInternalSample}
                    onCloseSubmit={handleFinalize}
                    canReview={canSubmitReview}
                    canClose={canCloseCase}
                    disabled={isRejected}
                    saving={saving}
                    isClosed={isClosed}
                />
            );
        }

        if (activePanel === INTERNAL_PANEL_IDS.TRACEABILITY) {
            return (
                <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
                    <div className="space-y-4">
                        <MicroStructuredSummaryCard
                            title="Estado del cierre"
                            description="Resumen final del caso, con dictamen, aprobación y acceso al reporte."
                            tone={isClosed ? 'emerald' : isRejected ? 'rose' : 'slate'}
                            items={reviewSummaryItems}
                            footer={sample?.reportUrl ? (
                                <a
                                    href={`${API}${sample.reportUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                                >
                                    <ExternalLink size={13} /> Ver reporte final
                                </a>
                            ) : (
                                <p className="text-xs text-slate-500">El reporte final aparecerá aquí cuando el caso quede cerrado.</p>
                            )}
                        />
                        <MicroStructuredSummaryCard
                            title="Recepción y ficha"
                            description="Información base con la que se ejecutó el ensayo."
                            tone="indigo"
                            items={[...acceptanceSummaryItems, ...caseSummaryItems.slice(0, 6)]}
                        />
                        <MicroStructuredSummaryCard
                            title="Consolidado del proceso"
                            description="Indicadores finales del expediente interno y del soporte emitido."
                            tone="teal"
                            items={traceabilitySummaryItems}
                        />
                    </div>
                    <div className="space-y-4">
                        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900">Historial operativo consolidado</h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Bitácoras internas registradas durante la incubación, lectura y seguimiento del caso.
                                    </p>
                                </div>
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                    {(sample?.internalLogs || []).length} registro(s)
                                </span>
                            </div>
                            <div className="mt-4 space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                {(sample?.internalLogs || []).length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                                        Aún no hay bitácoras diarias registradas para este caso.
                                    </div>
                                ) : (
                                    sample.internalLogs.map(log => (
                                        <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900">Día {log.dayNumber || '—'}</p>
                                                    <p className="text-xs text-slate-500">{formatDateTimeLabel(log.logDate)}</p>
                                                </div>
                                                <span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
                                                    {(log.readings || []).filter(hasReadingValue).length} lectura(s)
                                                </span>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-500">
                                                Registró: {log.recordedBy?.name || 'Sistema'}
                                            </p>
                                            <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">
                                                {log.observations || 'Sin observaciones.'}
                                            </p>
                                            {(log.readings || []).filter(hasReadingValue).length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {(log.readings || []).filter(hasReadingValue).map((reading, index) => (
                                                        <span key={`${log.id}-${reading.parameterId || index}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
                                                            {(parameterMap.get(reading.parameterId)?.name || reading.parameterId || 'Parametro')}: {formatReadingDisplayValue(reading)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <MicroAuditTrailPanel auditTrail={sample?.auditTrail || []} />
                    </div>
                </div>
            );
        }

        return null;
    };

    if (fetchingData) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-3">
                    <Beaker className="animate-pulse text-teal-600" size={32} />
                    <p className="text-gray-600 text-sm font-medium">Cargando laboratorio interno...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl w-[96vw] max-w-[1760px] h-[94vh] max-h-[94vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-teal-700 via-emerald-700 to-cyan-700">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/15 rounded-xl">
                            <Beaker size={22} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Laboratorio Interno en Planta</h2>
                            <p className="text-xs text-white/80">
                                Toma de muestra, seguimiento diario, observaciones, resultados y cierre automático del reporte final
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white">
                        <X size={22} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-2xl border border-red-100 text-sm flex items-center gap-2">
                            <Info size={16} /> {error}
                        </div>
                    )}
                    {successMsg && (
                        <div className="bg-emerald-50 text-emerald-700 p-3 rounded-2xl border border-emerald-100 text-sm flex items-center gap-2">
                            <Info size={16} /> {successMsg}
                        </div>
                    )}

                    <div className="rounded-2xl border border-teal-100 bg-teal-50/70 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-700 border border-teal-200">
                                <FlaskConical size={12} /> {selectedPoint?.code || scheduleEntry?.point?.code || 'Punto'}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                                <Layers3 size={12} /> {zoneName || selectedPoint?.zoneName || selectedPoint?.processArea || 'Sin zona'}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                                <Clock3 size={12} /> {buildOptionLabel(SHIFT_OPTIONS, shift)}
                            </span>
                            {sample?.status && (
                                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${sampleStatusMeta.chipClass}`}>
                                    {sampleStatusMeta.label}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-teal-950 font-semibold">{selectedPoint?.name || scheduleEntry?.point?.name}</p>
                        <p className="text-xs text-teal-800 mt-1">
                            Contexto: {workContext || '—'} · Tipo: {buildOptionLabel(LABORATORY_PROFILE_OPTIONS, laboratoryProfile)}
                        </p>
                        <p className="text-xs text-teal-800 mt-1">
                            Ente: {entityContext.entityLabel} · Analisis definidos: {requestedParameterIds.length || 0} · Submuestras: {sampleUnits.length || 0}
                        </p>
                        {sample?.sampleNumber && (
                            <p className="text-xs text-teal-900 mt-2">
                                Código interno: <strong>{sample.sampleNumber}</strong>
                                {sample.reportNumber && <> · Reporte final: <strong>{sample.reportNumber}</strong></>}
                            </p>
                        )}
                    </div>

                    <MicroWorkflowTimeline
                        steps={workflowSteps}
                        title="Ruta operativa del laboratorio interno"
                    />

                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        {processMetrics.map(metric => (
                            <div key={metric.label} className={`rounded-2xl border px-4 py-3 ${metric.tone}`}>
                                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{metric.label}</p>
                                <p className="mt-2 text-2xl font-bold">{metric.value}</p>
                            </div>
                        ))}
                    </div>

                    {(!currentSampleId || activePanel === INTERNAL_PANEL_IDS.OVERVIEW) ? (
                        <MicroAnalysisSelector
                            parameters={params}
                            selectedIds={requestedParameterIds}
                            onChange={setRequestedParameterIds}
                            entityType={entityContext.entityType}
                            disabled={Boolean(currentSampleId) || saving}
                            helperText={currentSampleId
                                ? 'El alcance analitico del laboratorio interno queda congelado una vez iniciado para proteger la trazabilidad del proceso.'
                                : 'Define desde el inicio que analisis internos se van a ejecutar para que la toma, la bitacora y el cierre trabajen sobre el mismo panel.'}
                        />
                    ) : (
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                            Alcance analítico congelado: <strong>{requestedParameterIds.length || 0}</strong> análisis configurados para este expediente interno.
                        </div>
                    )}

                    {!currentSampleId && (
                        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100 space-y-4">
                            <div>
                                <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Inicio del laboratorio interno</h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Este paso registra la toma de muestra en planta y crea el caso interno para seguimiento diario.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Punto *</label>
                                    <select
                                        value={samplingPointId}
                                        onChange={event => setSamplingPointId(event.target.value)}
                                        disabled={Boolean(scheduleEntry)}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    >
                                        <option value="">Seleccionar...</option>
                                        {points.map(point => (
                                            <option key={point.id} value={point.id}>
                                                {point.code} — {point.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha de toma</label>
                                    <input
                                        type="date"
                                        value={takenAt}
                                        onChange={event => setTakenAt(event.target.value)}
                                        disabled={Boolean(scheduleEntry)}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Turno</label>
                                    <select
                                        value={shift}
                                        onChange={event => setShift(event.target.value)}
                                        disabled={Boolean(scheduleEntry)}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    >
                                        {allowedShiftOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <MicroWorkContextField
                                    label="Contexto"
                                    value={workContext}
                                    onChange={setWorkContext}
                                    allowedValues={selectedPoint?.allowedWorkContexts || []}
                                    defaultValue={selectedPoint?.defaultWorkContext || ''}
                                    disabled={Boolean(scheduleEntry)}
                                    helperText="Mantén el contexto sugerido por el punto o define uno manual para este laboratorio interno."
                                />
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tipo</label>
                                    <select
                                        value={laboratoryProfile}
                                        onChange={event => setLaboratoryProfile(event.target.value)}
                                        disabled={Boolean(scheduleEntry)}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    >
                                        {allowedProfileOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote</label>
                                    <input
                                        type="text"
                                        value={lotNumber}
                                        onChange={event => setLotNumber(event.target.value)}
                                        placeholder="Ej: L260126"
                                        className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Batch</label>
                                    <input
                                        type="text"
                                        value={batchCode}
                                        onChange={event => setBatchCode(event.target.value)}
                                        placeholder="Opcional"
                                        className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Descripción de muestra</label>
                                <input
                                    type="text"
                                    value={sampleDescription}
                                    onChange={event => setSampleDescription(event.target.value)}
                                    placeholder="Describe la muestra tomada en planta"
                                    className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones iniciales</label>
                                <textarea
                                    value={notes}
                                    onChange={event => setNotes(event.target.value)}
                                    rows={4}
                                    placeholder="Condiciones de toma, observaciones de planta, hallazgos de arranque..."
                                    className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 resize-none"
                                />
                            </div>

                            <MicroInternalSampleDossierPanel
                                sampleTypeData={persistedSampleTypeData}
                                onChange={setSampleTypeData}
                                disabled={saving}
                                activeUnitId={activeSampleUnitId}
                                onActiveUnitChange={handleActiveUnitSelection}
                                analysisDrivenCount={requestedParameterIds.length}
                                attachmentStatsByUnit={attachmentStatsByUnit}
                                onOpenSupports={currentSampleId ? openSupportsForUnit : null}
                                canUploadEvidence={!saving}
                                onEvidenceFilesSelected={handleEvidenceFilesSelected}
                                apiBase={API}
                                existingEvidenceByUnit={existingEvidenceByUnit}
                                pendingEvidenceByUnit={pendingEvidenceByUnit}
                                onRemoveExistingEvidence={toggleExistingAttachment}
                                onRemovePendingEvidence={removePendingAttachmentById}
                                onGenerateLabel={currentSampleId ? handleGenerateInternalUnitLabel : null}
                                labelLoadingUnitId={labelLoadingUnitId}
                            />

                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={handleCreateInternalLab}
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-200 disabled:opacity-60"
                                >
                                    {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <PlusCircle size={16} />}
                                    {saving ? 'Creando...' : 'Iniciar Laboratorio'}
                                </button>
                            </div>
                        </div>
                    )}

                    {currentSampleId && (
                        <div className="space-y-4">
                            {isRejected && (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                                    Este caso quedó rechazado en la recepción del laboratorio. La trazabilidad permanece visible, pero ya no admite nuevas bitácoras, resultados ni cierre.
                                </div>
                            )}
                            {!isAccepted && !isRejected && (
                                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                                    Antes de registrar bitácoras o resultados, confirma la recepción y aceptación de la muestra en laboratorio.
                                </div>
                            )}

                            <MicroInternalWorkspaceNav
                                sections={workspaceSections}
                                activeSectionId={activePanel}
                                onChange={setActivePanel}
                                nextAction={nextAction}
                            />

                            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
                                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                            Panel activo
                                        </p>
                                        <h3 className="mt-1 text-xl font-bold text-slate-900">
                                            {activeWorkspaceSection?.label || 'Proceso interno'}
                                        </h3>
                                        <p className="mt-1 max-w-3xl text-sm text-slate-600">
                                            {activeWorkspaceSection?.helper || 'Gestiona esta etapa del laboratorio sin mezclarla con las demás.'}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {activePanel !== INTERNAL_PANEL_IDS.OVERVIEW && (
                                            <button
                                                type="button"
                                                onClick={() => setActivePanel(INTERNAL_PANEL_IDS.OVERVIEW)}
                                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                            >
                                                <Layers3 size={14} />
                                                Volver al resumen
                                            </button>
                                        )}
                                        {nextAction?.sectionId && nextAction.sectionId !== activePanel && (
                                            <button
                                                type="button"
                                                onClick={() => setActivePanel(nextAction.sectionId)}
                                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                                            >
                                                <ScrollText size={14} />
                                                {nextAction.label}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-5">
                                    {renderWorkspacePanel()}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MicroInternalLabEntry;
