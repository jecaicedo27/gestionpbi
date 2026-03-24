import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import {
    X,
    FlaskConical,
    Save,
    Info,
    Eye,
    Pencil,
    Building2,
    Clock3,
    Layers3,
    Camera,
    FileSearch,
    Tag
} from 'lucide-react';
import {
    SHIFT_OPTIONS,
    LABORATORY_PROFILE_OPTIONS,
    STATUS_META,
    SAMPLE_ENTITY_META,
    buildResultRows,
    extractFilledResults,
    getAllowedOptions,
    buildOptionLabel,
    buildSampleEntityContext,
    buildExternalWorkflowPreview,
    inferShiftFromTime
} from './microLabConfig';
import {
    FEATURED_PARAMETER_CODES,
    normalizeExistingAttachments,
    sortMicroParameters
} from './microSampleEntryConfig';
import {
    buildIsoDateTimeValue,
    buildMicroLabelPayloadFromExternalForm,
    downloadMicroLabelPdf,
    formatDateInputValue,
    formatTimeInputValue,
    getCurrentDateInputValue,
    getCurrentTimeInputValue
} from './microLabelUtils';
import MicroWorkContextField from './components/MicroWorkContextField';
import MicroAttachmentsPanel from './components/MicroAttachmentsPanel';
import MicroResultField from './components/MicroResultField';
import MicroAnalysisSelector from './components/MicroAnalysisSelector';
import MicroProductionContextPanel from './components/MicroProductionContextPanel';
import MicroWorkflowTimeline from './components/MicroWorkflowTimeline';

const API = import.meta.env.VITE_API_URL;

const EMPTY_RESULT_VALUES = {
    value: '',
    valueText: '',
    isDetected: null,
    notes: ''
};

const fileIsPhoto = (file) => (
    file?.type?.startsWith('image/')
    || /\.(png|jpe?g|webp|heic|heif)$/i.test(file?.name || '')
);

const MicroSampleEntry = ({ preselectedPoint, scheduleEntry, existingSampleId, onClose, onSuccess }) => {
    const { token } = useAuth();
    const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
    const isEditMode = Boolean(existingSampleId);

    const [points, setPoints] = useState([]);
    const [fetchingData, setFetchingData] = useState(false);
    const [loading, setLoading] = useState(false);
    const [labelLoading, setLabelLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const [samplingPointId, setSamplingPointId] = useState(scheduleEntry?.point?.id || preselectedPoint?.pointId || '');
    const [takenAt, setTakenAt] = useState(scheduleEntry?.plannedDate || preselectedPoint?.date || getCurrentDateInputValue());
    const [takenTime, setTakenTime] = useState(scheduleEntry?.plannedTime || getCurrentTimeInputValue());
    const [lotNumber, setLotNumber] = useState('');
    const [batchCode, setBatchCode] = useState('');
    const [sampleDescription, setSampleDescription] = useState('');
    const [lab, setLab] = useState(scheduleEntry?.assignedLab || '');
    const [reportNumber, setReportNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [reportFile, setReportFile] = useState(null);
    const [sampleNumber, setSampleNumber] = useState('');
    const [sampleStatus, setSampleStatus] = useState('');
    const [shift, setShift] = useState(scheduleEntry?.shift || '');
    const [workContext, setWorkContext] = useState(scheduleEntry?.workContext || '');
    const [laboratoryProfile, setLaboratoryProfile] = useState(scheduleEntry?.laboratoryProfile || '');
    const [zoneName, setZoneName] = useState(scheduleEntry?.zoneName || '');
    const [requestedParameterIds, setRequestedParameterIds] = useState(scheduleEntry?.requestedParameterIds || []);
    const [dispatchAt, setDispatchAt] = useState('');
    const [dispatchReference, setDispatchReference] = useState('');
    const [dispatchObservations, setDispatchObservations] = useState('');
    const [resultsReceivedAt, setResultsReceivedAt] = useState('');
    const [results, setResults] = useState([]);
    const [parameters, setParameters] = useState([]);
    const [samplingContext, setSamplingContext] = useState(null);
    const [contextLoading, setContextLoading] = useState(false);
    const [contextError, setContextError] = useState('');
    const [selectedScheduleEntryId, setSelectedScheduleEntryId] = useState(scheduleEntry?.id || '');
    const [selectedBatchIds, setSelectedBatchIds] = useState([]);
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [selectedMaterialLotIds, setSelectedMaterialLotIds] = useState([]);
    const [selectedRegistryLotKeys, setSelectedRegistryLotKeys] = useState([]);
    const [existingWorkflowSteps, setExistingWorkflowSteps] = useState([]);
    const [productionContextData, setProductionContextData] = useState(null);
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [clearedResultParameterIds, setClearedResultParameterIds] = useState([]);

    useEffect(() => {
        const fetchConfig = async () => {
            setFetchingData(true);
            setError('');

            try {
                const [pointsResponse, parametersResponse] = await Promise.all([
                    axios.get(`${API}/api/micro/sampling-points`, { headers: authHeaders }),
                    axios.get(`${API}/api/micro/parameters`, { headers: authHeaders })
                ]);

                const loadedPoints = pointsResponse.data || [];
                const orderedParams = sortMicroParameters(parametersResponse.data || []);

                setPoints(loadedPoints);
                setParameters(orderedParams);

                if (isEditMode) {
                    const sampleResponse = await axios.get(`${API}/api/micro/samples/${existingSampleId}`, { headers: authHeaders });
                    const sample = sampleResponse.data;

                    setSamplingPointId(sample.samplingPointId);
                    setTakenAt(formatDateInputValue(sample.takenAt));
                    setTakenTime(formatTimeInputValue(sample.takenAt) || scheduleEntry?.plannedTime || getCurrentTimeInputValue());
                    setLotNumber(sample.lotNumber || '');
                    setBatchCode(sample.batchCode || '');
                    setSampleDescription(sample.sampleDescription || '');
                    setLab(sample.lab || '');
                    setReportNumber(sample.reportNumber || '');
                    setNotes(sample.notes || '');
                    setReportFile(null);
                    setSampleNumber(sample.sampleNumber || '');
                    setSampleStatus(sample.status || '');
                    setShift(sample.shift || '');
                    setWorkContext(sample.workContext || '');
                    setLaboratoryProfile(sample.laboratoryProfile || '');
                    setZoneName(sample.zoneName || sample.samplingPoint?.zoneName || sample.samplingPoint?.processArea || '');
                    setRequestedParameterIds(sample.requestedParameterIds || sample.requestedParameters?.map(parameter => parameter.id) || []);
                    setDispatchAt(formatDateInputValue(sample.dispatchAt));
                    setDispatchReference(sample.dispatchReference || '');
                    setDispatchObservations(sample.dispatchObservations || '');
                    setResultsReceivedAt(formatDateInputValue(sample.resultsReceivedAt));
                    setResults(buildResultRows(orderedParams, sample.results || []));
                    setProductionContextData(sample.productionContextData || null);
                    setSelectedScheduleEntryId(sample.scheduleEntry?.id || scheduleEntry?.id || '');
                    setSelectedBatchIds((sample.productionContextData?.linkedBatches || []).map(item => item.id));
                    setSelectedProductIds((sample.productionContextData?.linkedProducts || []).map(item => item.productId || item.id).filter(Boolean));
                    setSelectedMaterialLotIds((sample.productionContextData?.linkedMaterialLots || []).map(item => item.id));
                    setSelectedRegistryLotKeys((sample.productionContextData?.linkedRegistryLots || []).map(item => item.key));
                    setExistingWorkflowSteps(sample.workflowSteps || []);
                    setExistingAttachments(normalizeExistingAttachments(sample));
                    setRemovedAttachmentIds([]);
                    setPendingAttachments([]);
                    setClearedResultParameterIds([]);
                } else {
                    setResults(buildResultRows(orderedParams, []));
                    setRequestedParameterIds(scheduleEntry?.requestedParameterIds || []);
                    setDispatchAt('');
                    setDispatchReference('');
                    setDispatchObservations('');
                    setResultsReceivedAt('');
                    setProductionContextData(null);
                    setSelectedScheduleEntryId(scheduleEntry?.id || '');
                    setSelectedBatchIds([]);
                    setSelectedProductIds([]);
                    setSelectedMaterialLotIds([]);
                    setSelectedRegistryLotKeys([]);
                    setExistingWorkflowSteps([]);
                    setExistingAttachments([]);
                    setRemovedAttachmentIds([]);
                    setPendingAttachments([]);
                    setClearedResultParameterIds([]);
                    setReportFile(null);
                    setSampleNumber('');
                    setSampleStatus('');
                    setTakenTime(scheduleEntry?.plannedTime || getCurrentTimeInputValue());
                }
            } catch (fetchError) {
                setError('Error cargando configuración del laboratorio externo');
            } finally {
                setFetchingData(false);
            }
        };

        fetchConfig();
    }, [authHeaders, existingSampleId, isEditMode, scheduleEntry]);

    const selectedPoint = useMemo(
        () => points.find(point => point.id === samplingPointId) || scheduleEntry?.point || null,
        [points, samplingPointId, scheduleEntry]
    );
    const entityContext = useMemo(
        () => samplingContext?.entityContext || buildSampleEntityContext({
            point: selectedPoint,
            laboratoryProfile,
            productionContextData
        }),
        [laboratoryProfile, productionContextData, samplingContext?.entityContext, selectedPoint]
    );

    useEffect(() => {
        if (!selectedPoint || isEditMode || scheduleEntry) return;

        setZoneName(selectedPoint.zoneName || selectedPoint.processArea || '');
        setShift(previous => previous || selectedPoint.defaultShift || '');
        setWorkContext(previous => previous || selectedPoint.defaultWorkContext || '');
        setLaboratoryProfile(previous => previous || selectedPoint.defaultLaboratoryProfile || '');
        setLab(previous => previous || selectedPoint.defaultAssignedLab || '');
    }, [isEditMode, scheduleEntry, selectedPoint]);

    const allowedShiftOptions = useMemo(
        () => getAllowedOptions(SHIFT_OPTIONS, selectedPoint?.allowedShifts || []),
        [selectedPoint]
    );
    const allowedProfileOptions = useMemo(
        () => getAllowedOptions(LABORATORY_PROFILE_OPTIONS, selectedPoint?.allowedLaboratoryProfiles || []),
        [selectedPoint]
    );
    const allowedShiftValues = useMemo(
        () => allowedShiftOptions.map(option => option.value),
        [allowedShiftOptions]
    );
    const visiblePhotoEvidenceCount = useMemo(() => (
        existingAttachments.filter(attachment => (
            attachment.category === 'PHOTO'
            && !removedAttachmentIds.includes(attachment.id)
        )).length
        + pendingAttachments.filter(fileIsPhoto).length
    ), [existingAttachments, pendingAttachments, removedAttachmentIds]);
    const filledResultsCount = useMemo(
        () => extractFilledResults(results).length,
        [results]
    );
    const statusMeta = STATUS_META[sampleStatus] || STATUS_META.IN_PROCESS;
    const entityMeta = SAMPLE_ENTITY_META[entityContext.entityType] || SAMPLE_ENTITY_META.OTRO;
    const workflowSteps = useMemo(() => (
        isEditMode
            ? (existingWorkflowSteps || [])
            : buildExternalWorkflowPreview({
                takenAt: buildIsoDateTimeValue(takenAt, takenTime),
                dispatchAt,
                resultsReceivedAt,
                hasResults: filledResultsCount > 0,
                hasReport: Boolean(reportFile),
                photoCount: visiblePhotoEvidenceCount,
                requestedCount: requestedParameterIds.length,
                isDraft: true
            })
    ), [
        dispatchAt,
        existingWorkflowSteps,
        filledResultsCount,
        isEditMode,
        reportFile,
        requestedParameterIds.length,
        resultsReceivedAt,
        takenAt,
        takenTime,
        visiblePhotoEvidenceCount
    ]);

    useEffect(() => {
        if (isEditMode || scheduleEntry) return;

        const inferredShift = inferShiftFromTime(takenTime);
        if (!inferredShift) return;
        if (allowedShiftValues.length > 0 && !allowedShiftValues.includes(inferredShift)) return;
        if (shift !== inferredShift) {
            setShift(inferredShift);
        }
    }, [allowedShiftValues, isEditMode, scheduleEntry, shift, takenTime]);

    useEffect(() => {
        if (isEditMode || !samplingPointId || !takenAt) {
            if (!isEditMode) {
                setSamplingContext(null);
                setContextError('');
            }
            return;
        }

        let mounted = true;
        const targetAt = buildIsoDateTimeValue(takenAt, takenTime);

        const fetchContext = async () => {
            setContextLoading(true);
            setContextError('');

            try {
                const response = await axios.get(`${API}/api/micro/context`, {
                    headers: authHeaders,
                    params: {
                        samplingPointId,
                        takenAt: targetAt,
                        laboratoryProfile
                    }
                });

                if (!mounted) return;

                const nextContext = response.data || null;
                setSamplingContext(nextContext);

                if (!selectedScheduleEntryId && Array.isArray(nextContext?.scheduleCandidates) && nextContext.scheduleCandidates.length === 1) {
                    const singleCandidate = nextContext.scheduleCandidates[0];
                    setSelectedScheduleEntryId(singleCandidate.id);
                    setShift(singleCandidate.shift || shift);
                    setWorkContext(singleCandidate.workContext || workContext);
                    setLaboratoryProfile(singleCandidate.laboratoryProfile || laboratoryProfile);
                    setRequestedParameterIds(singleCandidate.requestedParameterIds || []);
                    setLab(singleCandidate.assignedLab || lab);
                }
            } catch (fetchError) {
                if (mounted) {
                    setContextError(fetchError.response?.data?.error || 'No fue posible analizar la producción y las programaciones del momento');
                }
            } finally {
                if (mounted) {
                    setContextLoading(false);
                }
            }
        };

        fetchContext();

        return () => {
            mounted = false;
        };
    }, [
        authHeaders,
        isEditMode,
        laboratoryProfile,
        lab,
        samplingPointId,
        selectedScheduleEntryId,
        shift,
        takenAt,
        takenTime,
        workContext
    ]);

    const toggleSelection = (currentValues, nextValue) => (
        currentValues.includes(nextValue)
            ? currentValues.filter(value => value !== nextValue)
            : [...currentValues, nextValue]
    );

    const handleSelectScheduleCandidate = (entryId) => {
        setSelectedScheduleEntryId(entryId);

        const selectedEntry = (samplingContext?.scheduleCandidates || []).find(candidate => candidate.id === entryId);
        if (!selectedEntry) return;

        setShift(selectedEntry.shift || '');
        setWorkContext(selectedEntry.workContext || '');
        setLaboratoryProfile(selectedEntry.laboratoryProfile || '');
        setRequestedParameterIds(selectedEntry.requestedParameterIds || []);
        setLab(selectedEntry.assignedLab || '');
    };

    const buildProductionContextPayload = () => {
        if (!samplingContext && !productionContextData) return null;

        const sourceContext = samplingContext || {};
        const linkedBatches = (sourceContext.activeBatches || []).filter(batch => selectedBatchIds.includes(batch.id));
        const linkedProducts = (sourceContext.productsInProduction || []).filter(product => selectedProductIds.includes(product.productId));
        const linkedMaterialLots = (sourceContext.relevantMaterialLots || []).filter(lot => selectedMaterialLotIds.includes(lot.id));
        const linkedRegistryLots = [
            ...(sourceContext.registryLots?.productionLots || []).map(lot => ({
                key: `production:${lot.lotCode}`,
                type: 'PRODUCTION',
                label: `${lot.lotCode} · ${lot.flavor}`,
                ...lot
            })),
            ...(sourceContext.registryLots?.syrupLots || []).map(lot => ({
                key: `syrup:${lot.lotCode}:${lot.flavor}`,
                type: 'SYRUP',
                label: `${lot.lotCode} · ${lot.flavor}`,
                ...lot
            }))
        ].filter(lot => selectedRegistryLotKeys.includes(lot.key));

        return {
            entityType: entityContext.entityType,
            entityLabel: entityContext.entityLabel,
            keywords: entityContext.keywords || [],
            linkedScheduleEntryId: selectedScheduleEntryId || null,
            linkedBatches: linkedBatches.map(batch => ({
                id: batch.id,
                batchNumber: batch.batchNumber,
                flavor: batch.flavor,
                status: batch.status
            })),
            linkedProducts: linkedProducts.map(product => ({
                productId: product.productId,
                name: product.name,
                sku: product.sku
            })),
            linkedMaterialLots: linkedMaterialLots.map(lot => ({
                id: lot.id,
                lotNumber: lot.lotNumber,
                productName: lot.productName,
                status: lot.status,
                zone: lot.zone
            })),
            linkedRegistryLots: linkedRegistryLots
        };
    };

    const updateResult = (index, field, value) => {
        const resultRow = results[index];

        if (resultRow?.parameterId) {
            setClearedResultParameterIds(previous => previous.filter(parameterId => parameterId !== resultRow.parameterId));
        }

        setResults(previous => previous.map((result, resultIndex) => (
            resultIndex === index ? { ...result, [field]: value } : result
        )));
    };

    const clearResult = (parameterId) => {
        setClearedResultParameterIds(previous => (
            previous.includes(parameterId) ? previous : [...previous, parameterId]
        ));

        setResults(previous => previous.map(result => (
            result.parameterId === parameterId ? { ...result, ...EMPTY_RESULT_VALUES } : result
        )));
    };

    const toggleExistingAttachment = (attachmentId) => {
        setRemovedAttachmentIds(previous => (
            previous.includes(attachmentId)
                ? previous.filter(currentId => currentId !== attachmentId)
                : [...previous, attachmentId]
        ));
    };

    const addPendingAttachments = (files = []) => {
        if (!Array.isArray(files) || files.length === 0) return;
        setPendingAttachments(previous => [...previous, ...files]);
        setError('');
    };

    const removePendingAttachment = (fileIndex) => {
        setPendingAttachments(previous => previous.filter((_, index) => index !== fileIndex));
    };

    const handleGenerateLabel = async () => {
        if (!samplingPointId) {
            setError('Seleccione un punto de muestreo para generar la etiqueta');
            return;
        }

        if (!takenAt) {
            setError('Seleccione la fecha de recolección antes de generar la etiqueta');
            return;
        }

        setLabelLoading(true);
        setError('');

        try {
            await downloadMicroLabelPdf({
                token,
                payload: buildMicroLabelPayloadFromExternalForm({
                    sampleNumber,
                    selectedPoint,
                    zoneName,
                    takenDate: takenAt,
                    takenTime,
                    lotNumber,
                    batchCode,
                    shift,
                    workContext,
                    laboratoryProfile,
                    lab,
                    sampleDescription,
                    notes
                })
            });
        } catch (labelError) {
            setError(labelError.response?.data?.error || 'No fue posible generar la etiqueta PDF');
        } finally {
            setLabelLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!samplingPointId) {
            setError('Seleccione un punto de muestreo');
            return;
        }

        if (!takenAt) {
            setError('Seleccione la fecha de recolección de la muestra');
            return;
        }

        if (requestedParameterIds.length === 0) {
            setError('Seleccione al menos un análisis solicitado para esta muestra');
            return;
        }

        if (!isEditMode && visiblePhotoEvidenceCount === 0) {
            setError('Debe adjuntar al menos una evidencia fotográfica para registrar la recolección externa');
            return;
        }

        setLoading(true);
        setError('');
        setSuccessMsg('');

        try {
            const formData = new FormData();
            const nextProductionContextPayload = isEditMode
                ? productionContextData
                : buildProductionContextPayload();

            if (isEditMode) {
                formData.append('lab', lab);
                formData.append('reportNumber', reportNumber);
                formData.append('notes', notes);
                formData.append('requestedParameterIds', JSON.stringify(requestedParameterIds));
                formData.append('dispatchAt', dispatchAt || '');
                formData.append('dispatchReference', dispatchReference || '');
                formData.append('dispatchObservations', dispatchObservations || '');
                formData.append('resultsReceivedAt', resultsReceivedAt || '');
                if (nextProductionContextPayload) {
                    formData.append('productionContextData', JSON.stringify(nextProductionContextPayload));
                }
                if (reportFile) formData.append('report', reportFile);
                pendingAttachments.forEach(file => formData.append('attachments', file));

                const filledResults = extractFilledResults(results);
                if (filledResults.length > 0) {
                    formData.append('results', JSON.stringify(filledResults));
                }
                if (removedAttachmentIds.length > 0) {
                    formData.append(
                        'removedAttachmentIds',
                        JSON.stringify(removedAttachmentIds.filter(attachmentId => !`${attachmentId}`.startsWith('legacy:')))
                    );
                }
                if (clearedResultParameterIds.length > 0) {
                    formData.append('clearedResultParameterIds', JSON.stringify(clearedResultParameterIds));
                }

                await axios.patch(`${API}/api/micro/samples/${existingSampleId}/results`, formData, {
                    headers: { ...authHeaders, 'Content-Type': 'multipart/form-data' }
                });

                setSuccessMsg('Resultados y soportes del laboratorio actualizados correctamente');
                setTimeout(() => onSuccess(), 600);
                return;
            }

            formData.append('workflowType', 'EXTERNAL');
            if (scheduleEntry?.id || selectedScheduleEntryId) {
                formData.append('scheduleEntryId', scheduleEntry?.id || selectedScheduleEntryId);
            }
            formData.append('samplingPointId', samplingPointId);
            formData.append('takenAt', buildIsoDateTimeValue(takenAt, takenTime));
            formData.append('shift', shift);
            formData.append('workContext', workContext);
            formData.append('laboratoryProfile', laboratoryProfile);
            formData.append('requestedParameterIds', JSON.stringify(requestedParameterIds));
            formData.append('dispatchAt', dispatchAt || '');
            formData.append('dispatchReference', dispatchReference || '');
            formData.append('dispatchObservations', dispatchObservations || '');
            formData.append('resultsReceivedAt', resultsReceivedAt || '');
            if (lotNumber) formData.append('lotNumber', lotNumber);
            if (batchCode) formData.append('batchCode', batchCode);
            if (sampleDescription) formData.append('sampleDescription', sampleDescription);
            if (lab) formData.append('lab', lab);
            if (notes) formData.append('notes', notes);
            if (nextProductionContextPayload) {
                formData.append('productionContextData', JSON.stringify(nextProductionContextPayload));
            }
            pendingAttachments.forEach(file => formData.append('attachments', file));

            await axios.post(`${API}/api/micro/samples`, formData, {
                headers: { ...authHeaders, 'Content-Type': 'multipart/form-data' }
            });

            onSuccess();
        } catch (submitError) {
            setError(submitError.response?.data?.error || 'Error al guardar el laboratorio externo');
        } finally {
            setLoading(false);
        }
    };

    if (fetchingData) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-3">
                    <FlaskConical className="animate-pulse text-orange-600" size={32} />
                    <p className="text-gray-600 text-sm font-medium">Cargando laboratorio externo...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className={`px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r ${isEditMode ? 'from-blue-700 to-cyan-700' : 'from-orange-600 to-amber-600'}`}>
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/15 rounded-xl">
                            {isEditMode ? <Eye size={22} /> : <Building2 size={22} />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">
                                {isEditMode ? 'Respuesta de Laboratorio Externo' : 'Registrar Recolección Externa'}
                            </h2>
                            <p className="text-xs text-white/80">
                                {isEditMode && sampleNumber
                                    ? `${sampleNumber} · Carga de resultados, informe y soportes del tercero`
                                    : 'Programe la recolección, adjunte evidencia fotográfica y deje el caso en proceso hasta recibir resultados'}
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
                        <div className="bg-green-50 text-green-700 p-3 rounded-2xl border border-green-100 text-sm flex items-center gap-2">
                            <Info size={16} /> {successMsg}
                        </div>
                    )}

                    {(scheduleEntry || selectedPoint) && (
                        <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-orange-700 border border-orange-200">
                                    <Building2 size={12} /> {selectedPoint?.code || scheduleEntry?.point?.code || 'Punto'}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                                    <Layers3 size={12} /> {zoneName || selectedPoint?.zoneName || selectedPoint?.processArea || 'Sin zona'}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                                    <Clock3 size={12} /> {buildOptionLabel(SHIFT_OPTIONS, shift)}
                                </span>
                                {isEditMode && sampleStatus && (
                                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.chipClass}`}>
                                        {statusMeta.label}
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-orange-900 font-semibold">{selectedPoint?.name || scheduleEntry?.point?.name}</p>
                            <p className="text-xs text-orange-800 mt-1">
                                Contexto: {workContext || '—'} · Tipo: {buildOptionLabel(LABORATORY_PROFILE_OPTIONS, laboratoryProfile)} · Ente: {entityContext.entityLabel}
                            </p>
                            <p className="text-xs text-orange-800 mt-1">
                                Análisis solicitados: {requestedParameterIds.length || 0}
                            </p>
                        </div>
                    )}

                    <div className={`rounded-2xl border px-5 py-4 ${isEditMode ? 'border-blue-100 bg-blue-50/70' : 'border-orange-100 bg-orange-50/80'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`rounded-xl p-2 ${isEditMode ? 'bg-white text-blue-700' : 'bg-white text-orange-600'}`}>
                                {isEditMode ? <FileSearch size={18} /> : <Camera size={18} />}
                            </div>
                            <div>
                                <h3 className={`text-sm font-bold ${isEditMode ? 'text-blue-900' : 'text-orange-900'}`}>
                                    {isEditMode ? 'Respuesta del tercero en una sola gestión' : 'Registro inicial con evidencia fotográfica obligatoria'}
                                </h3>
                                <p className={`mt-1 text-sm ${isEditMode ? 'text-blue-800' : 'text-orange-800'}`}>
                                    {isEditMode
                                        ? 'Aquí puede cargar resultados analíticos, el PDF del informe y documentos complementarios sin volver a registrar la muestra.'
                                        : 'Primero registre la fecha de recolección, el laboratorio tercero y al menos una foto de la muestra tomada. El estado quedará en proceso hasta recibir la respuesta del laboratorio.'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <MicroWorkflowTimeline steps={workflowSteps} />

                    <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                        <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider mb-1">
                            {isEditMode ? 'Datos de la Recolección Registrada' : 'Programación y Recolección de la Muestra'}
                        </h3>
                        <p className="text-xs text-gray-500 mb-4">
                            {isEditMode
                                ? 'Revise la información base de la muestra enviada al tercero. Los campos operativos quedan bloqueados para proteger la trazabilidad.'
                                : 'Defina la fecha de recolección y los datos base de la muestra antes de enviarla al laboratorio tercero.'}
                        </p>

                        {entityContext?.entityLabel && (
                            <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Formulario adaptado al ente muestreado</p>
                                <p className="mt-1 text-sm font-semibold text-indigo-900">{entityContext.entityLabel}</p>
                                <p className="mt-1 text-xs text-indigo-800">{entityMeta.helper}</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Punto de Muestreo *</label>
                                <select
                                    value={samplingPointId}
                                    onChange={event => {
                                        setSamplingPointId(event.target.value);
                                        if (!scheduleEntry) {
                                            setSelectedScheduleEntryId('');
                                            setSelectedBatchIds([]);
                                            setSelectedProductIds([]);
                                            setSelectedMaterialLotIds([]);
                                            setSelectedRegistryLotKeys([]);
                                        }
                                    }}
                                    disabled={isEditMode || Boolean(scheduleEntry)}
                                    className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode || scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
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
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha de Recolección *</label>
                                <input
                                    type="date"
                                    value={takenAt}
                                    onChange={event => {
                                        setTakenAt(event.target.value);
                                        if (!scheduleEntry) {
                                            setSelectedScheduleEntryId('');
                                        }
                                    }}
                                    disabled={isEditMode || Boolean(scheduleEntry)}
                                    className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode || scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Hora de Recolección</label>
                                <input
                                    type="time"
                                    value={takenTime}
                                    onChange={event => {
                                        setTakenTime(event.target.value);
                                        if (!scheduleEntry) {
                                            setSelectedScheduleEntryId('');
                                        }
                                    }}
                                    disabled={isEditMode}
                                    className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Laboratorio tercero</label>
                                <input
                                    type="text"
                                    value={lab}
                                    onChange={event => setLab(event.target.value)}
                                    placeholder="Ej: Biotrends Laboratorios"
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Turno</label>
                                <select
                                    value={shift}
                                    onChange={event => setShift(event.target.value)}
                                    disabled={isEditMode || Boolean(scheduleEntry)}
                                    className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode || scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
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
                                disabled={isEditMode || Boolean(scheduleEntry)}
                                helperText="Puede usar el contexto sincronizado desde el punto o escribir uno manual para este laboratorio externo."
                            />

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tipo de laboratorio</label>
                                <select
                                    value={laboratoryProfile}
                                    onChange={event => setLaboratoryProfile(event.target.value)}
                                    disabled={isEditMode || Boolean(scheduleEntry)}
                                    className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode || scheduleEntry ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                >
                                    {allowedProfileOptions.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            {!entityMeta.hideLotField && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{entityMeta.lotLabel}</label>
                                    <input
                                        type="text"
                                        value={lotNumber}
                                        onChange={event => setLotNumber(event.target.value)}
                                        placeholder="Ej: L260126"
                                        disabled={isEditMode}
                                        className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                            )}

                            {!entityMeta.hideBatchField && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{entityMeta.batchLabel}</label>
                                    <input
                                        type="text"
                                        value={batchCode}
                                        onChange={event => setBatchCode(event.target.value)}
                                        placeholder="Opcional"
                                        disabled={isEditMode}
                                        className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                            )}

                            {isEditMode && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">N° Informe / Resultado</label>
                                    <input
                                        type="text"
                                        value={reportNumber}
                                        onChange={event => setReportNumber(event.target.value)}
                                        placeholder="Ej: M-26-27561-0"
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="mt-4">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Descripción de muestra / referencia</label>
                            <input
                                type="text"
                                value={sampleDescription}
                                onChange={event => setSampleDescription(event.target.value)}
                                placeholder={entityMeta.hideLotField
                                    ? 'Ej: mango de marmita, tubería o ambiente del área'
                                    : 'Describe la muestra enviada al tercero'}
                                disabled={isEditMode}
                                className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                            />
                        </div>
                    </div>

                    <MicroAnalysisSelector
                        parameters={parameters}
                        selectedIds={requestedParameterIds}
                        onChange={setRequestedParameterIds}
                        entityType={entityContext.entityType}
                        disabled={loading}
                        helperText={isEditMode
                            ? 'Puedes ajustar el alcance del laboratorio solicitado si el tercero amplió o corrigió el panel analítico.'
                            : 'Selecciona desde ya qué análisis se van a solicitar para que la toma y la programación sigan la misma intención microbiológica.'}
                    />

                    {isEditMode && productionContextData && (
                        <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4">
                            <p className="text-sm font-bold text-cyan-900">Contexto productivo vinculado</p>
                            <p className="mt-1 text-xs text-cyan-800">
                                Ente: {productionContextData.entityLabel || entityContext.entityLabel}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(productionContextData.linkedBatches || []).map(batch => (
                                    <span key={batch.id} className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700">
                                        {batch.batchNumber}
                                    </span>
                                ))}
                                {(productionContextData.linkedMaterialLots || []).map(lot => (
                                    <span key={lot.id} className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700">
                                        {lot.lotNumber}
                                    </span>
                                ))}
                                {(productionContextData.linkedProducts || []).map(product => (
                                    <span key={product.productId || product.id} className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700">
                                        {product.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isEditMode && (
                        <MicroProductionContextPanel
                            context={samplingContext}
                            loading={contextLoading}
                            error={contextError}
                            selectedScheduleEntryId={selectedScheduleEntryId}
                            onSelectScheduleEntry={handleSelectScheduleCandidate}
                            selectedBatchIds={selectedBatchIds}
                            onToggleBatch={(batchId) => setSelectedBatchIds(current => toggleSelection(current, batchId))}
                            selectedProductIds={selectedProductIds}
                            onToggleProduct={(productId) => setSelectedProductIds(current => toggleSelection(current, productId))}
                            selectedMaterialLotIds={selectedMaterialLotIds}
                            onToggleMaterialLot={(lotId) => setSelectedMaterialLotIds(current => toggleSelection(current, lotId))}
                            selectedRegistryLotKeys={selectedRegistryLotKeys}
                            onToggleRegistryLot={(registryKey) => setSelectedRegistryLotKeys(current => toggleSelection(current, registryKey))}
                        />
                    )}

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">
                            Seguimiento del flujo externo
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                            Registra despacho, guía o recepción de resultados para que la muestra no se quede solo como una toma aislada.
                        </p>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha de envío</label>
                                <input
                                    type="date"
                                    value={dispatchAt}
                                    onChange={event => setDispatchAt(event.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Guía / Remisión</label>
                                <input
                                    type="text"
                                    value={dispatchReference}
                                    onChange={event => setDispatchReference(event.target.value)}
                                    placeholder="Ej: CT-000245"
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha recepción resultados</label>
                                <input
                                    type="date"
                                    value={resultsReceivedAt}
                                    onChange={event => setResultsReceivedAt(event.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Programación vinculada</label>
                                <input
                                    type="text"
                                    value={selectedScheduleEntryId || scheduleEntry?.id || 'Sin programación vinculada'}
                                    disabled
                                    className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm outline-none cursor-not-allowed opacity-75"
                                />
                            </div>
                        </div>

                        <div className="mt-4">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones de envío / recepción</label>
                            <textarea
                                value={dispatchObservations}
                                onChange={event => setDispatchObservations(event.target.value)}
                                rows={3}
                                placeholder="Cadena de custodia, courier, temperatura, novedades del laboratorio..."
                                className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                            />
                        </div>
                    </div>

                    {isEditMode ? (
                        <>
                            <div className="bg-white rounded-2xl border border-blue-100 overflow-hidden">
                                <div className="bg-blue-50 px-5 py-3 border-b border-blue-100">
                                    <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
                                        <FlaskConical size={16} /> Resultados del tercero
                                    </h3>
                                    <p className="text-xs text-blue-700 mt-1">
                                        Cargue la respuesta analítica del laboratorio tercero. Puede limpiar parámetros si algún valor quedó registrado por error.
                                    </p>
                                </div>

                                <div className="p-5">
                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                                            {filledResultsCount} parámetro(s) con resultado
                                        </span>
                                        <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
                                            {visiblePhotoEvidenceCount} evidencia(s) fotográfica(s)
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                        {results.map((result, index) => (
                                            <MicroResultField
                                                key={result.parameterId}
                                                result={result}
                                                featured={FEATURED_PARAMETER_CODES.includes(result.parameterCode)}
                                                onChange={(field, value) => updateResult(index, field, value)}
                                                onClear={() => clearResult(result.parameterId)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <MicroAttachmentsPanel
                                apiBase={API}
                                existingAttachments={existingAttachments}
                                removedAttachmentIds={removedAttachmentIds}
                                onToggleExistingAttachment={toggleExistingAttachment}
                                reportFile={reportFile}
                                onReportSelected={setReportFile}
                                onClearReport={() => setReportFile(null)}
                                pendingAttachments={pendingAttachments}
                                onAddAttachments={addPendingAttachments}
                                onRemovePendingAttachment={removePendingAttachment}
                                introText="Suba el informe PDF del laboratorio y adjunte fotos, hojas de análisis u otros documentos complementarios de la respuesta."
                                reportTitle="Informe principal recibido del tercero"
                                reportDescription="Este PDF quedará como soporte principal del resultado microbiológico."
                                supportDescription="Puede complementar la respuesta con fotos, cadenas de custodia, hojas de análisis o soportes del proveedor."
                            />
                        </>
                    ) : (
                        <>
                            <MicroAttachmentsPanel
                                apiBase={API}
                                existingAttachments={existingAttachments}
                                removedAttachmentIds={removedAttachmentIds}
                                onToggleExistingAttachment={toggleExistingAttachment}
                                reportFile={reportFile}
                                onReportSelected={setReportFile}
                                onClearReport={() => setReportFile(null)}
                                pendingAttachments={pendingAttachments}
                                onAddAttachments={addPendingAttachments}
                                onRemovePendingAttachment={removePendingAttachment}
                                showReportSection={false}
                                introText="Adjunte la evidencia de recolección desde el registro inicial. La foto es obligatoria y los resultados se cargarán después."
                                supportTitle="Evidencia fotográfica y soportes de envío"
                                supportDescription="Agregue mínimo una foto de la muestra tomada. También puede incluir guías, cadenas de custodia o soportes del despacho."
                                supportInputLabel="Agregar evidencia y documentos"
                                supportInputHelper="Puede cargar imágenes, PDF, Word o Excel. Se requiere al menos una imagen para guardar."
                            />

                            <div className={`rounded-2xl border px-4 py-3 ${visiblePhotoEvidenceCount > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                <p className={`text-sm font-semibold ${visiblePhotoEvidenceCount > 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {visiblePhotoEvidenceCount > 0
                                        ? `${visiblePhotoEvidenceCount} evidencia(s) fotográfica(s) lista(s) para registrar la muestra`
                                        : 'Falta adjuntar al menos una evidencia fotográfica para registrar la recolección externa'}
                                </p>
                                <p className={`mt-1 text-xs ${visiblePhotoEvidenceCount > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    Los resultados del tercero, el PDF del informe y otros soportes de respuesta se cargan después desde la misma muestra.
                                </p>
                            </div>
                        </>
                    )}

                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Observaciones</label>
                        <textarea
                            value={notes}
                            onChange={event => setNotes(event.target.value)}
                            rows={isEditMode ? 6 : 5}
                            placeholder={isEditMode
                                ? 'Notas de recepción de resultados, hallazgos del tercero o aclaraciones del informe...'
                                : 'Notas de recolección, envío, cadena de custodia o aclaraciones para el tercero...'}
                            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                        />
                    </div>
                </div>

                <div className="p-5 border-t border-gray-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <button
                        type="button"
                        onClick={handleGenerateLabel}
                        disabled={loading || labelLoading || !samplingPointId || !takenAt}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-900 hover:text-white disabled:opacity-50"
                    >
                        {labelLoading ? <span className="w-4 h-4 border-2 border-slate-400/40 border-t-slate-900 rounded-full animate-spin" /> : <Tag size={16} />}
                        {labelLoading ? 'Generando etiqueta...' : 'Generar Etiqueta PDF'}
                    </button>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button
                            onClick={onClose}
                            disabled={loading}
                            className="px-5 py-2.5 border border-gray-200 rounded-2xl text-gray-600 font-medium hover:bg-gray-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !samplingPointId}
                            className={`px-6 py-2.5 text-white rounded-2xl font-medium shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 ${isEditMode
                                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 shadow-blue-200'
                                : 'bg-gradient-to-r from-orange-600 to-amber-600 shadow-orange-200'
                                }`}
                        >
                            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : isEditMode ? <Pencil size={16} /> : <Save size={16} />}
                            {loading ? 'Guardando...' : isEditMode ? 'Guardar Resultados' : 'Registrar Recolección'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MicroSampleEntry;
