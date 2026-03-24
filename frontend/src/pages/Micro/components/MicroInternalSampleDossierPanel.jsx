import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Boxes, Camera, ClipboardCheck, Download, ExternalLink, FileText, PlusCircle, Trash2, Video } from 'lucide-react';
import MicroInternalSampleTypeFields from './MicroInternalSampleTypeFields';
import {
    SAMPLE_ENTITY_OPTIONS,
    buildInternalSampleUnitLabel,
    buildInternalSampleUnitProgress,
    buildOptionLabel,
    createDefaultInternalSampleUnit
} from '../microLabConfig';
import { formatFileSize } from '../microSampleEntryConfig';

const SAMPLE_STEP_META = {
    IDENTIFICATION: {
        title: 'Identificación',
        description: 'Define la naturaleza de la muestra y diligencia solo la ficha técnica que le corresponde.'
    },
    COLLECTION: {
        title: 'Recolección',
        description: 'Documenta la toma, responsable, método y observaciones propias de esta muestra.'
    },
    EVIDENCE: {
        title: 'Evidencias',
        description: 'Relaciona fotos, videos y documentos que deben quedar amarrados a esta muestra.'
    }
};

const STEP_STATUS_CLASS = {
    completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    in_progress: 'border-amber-200 bg-amber-50 text-amber-800',
    pending: 'border-slate-200 bg-white text-slate-700'
};

const unwrapPendingFile = (entry) => entry?.file || entry;

const getPendingEvidenceCategory = (entry) => {
    const file = unwrapPendingFile(entry);
    if (file?.type?.startsWith('image/')) return 'PHOTO';
    if (file?.type?.startsWith('video/')) return 'VIDEO';
    return 'DOCUMENT';
};

const EvidencePreviewCard = ({
    title,
    subtitle,
    category,
    previewUrl = '',
    href = '',
    pending = false,
    onRemove,
    removable = true
}) => {
    const isPhoto = category === 'PHOTO';
    const isVideo = category === 'VIDEO';
    const chipClass = isPhoto
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : isVideo
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-slate-200 bg-slate-50 text-slate-700';

    return (
        <div className={`overflow-hidden rounded-2xl border ${pending ? 'border-teal-200 bg-teal-50/60' : 'border-slate-200 bg-white'}`}>
            <div className="aspect-[4/3] bg-slate-100">
                {isPhoto && previewUrl ? (
                    <img src={previewUrl} alt={title} className="h-full w-full object-cover" />
                ) : isVideo && previewUrl ? (
                    <video src={previewUrl} className="h-full w-full object-cover" controls preload="metadata" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <FileText size={28} />
                    </div>
                )}
            </div>
            <div className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chipClass}`}>
                            {isPhoto ? 'Foto' : isVideo ? 'Video' : 'Documento'}
                        </span>
                        <p className="mt-2 truncate text-sm font-semibold text-slate-900">{title}</p>
                        {subtitle && (
                            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
                        )}
                    </div>
                    {removable && typeof onRemove === 'function' && (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="rounded-xl border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                        >
                            <span className="inline-flex items-center gap-1">
                                <Trash2 size={12} />
                                Quitar
                            </span>
                        </button>
                    )}
                </div>
                {href && (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-800"
                    >
                        <ExternalLink size={12} />
                        Abrir archivo
                    </a>
                )}
            </div>
        </div>
    );
};

const PendingEvidenceCard = ({ entry, onRemove }) => {
    const file = unwrapPendingFile(entry);
    const category = getPendingEvidenceCategory(entry);
    const [previewUrl, setPreviewUrl] = useState('');

    useEffect(() => {
        if (category !== 'PHOTO' && category !== 'VIDEO') {
            setPreviewUrl('');
            return undefined;
        }

        const nextUrl = URL.createObjectURL(file);
        setPreviewUrl(nextUrl);

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [category, file]);

    return (
        <EvidencePreviewCard
            title={file?.name || 'Archivo pendiente'}
            subtitle={`Pendiente por guardar${file?.size ? ` · ${formatFileSize(file.size)}` : ''}`}
            category={category}
            previewUrl={previewUrl}
            pending
            onRemove={onRemove}
        />
    );
};

const SavedEvidenceCard = ({ attachment, apiBase, onRemove, removable = true }) => {
    const fileUrl = `${apiBase}${attachment.url}`;

    return (
        <EvidencePreviewCard
            title={attachment.originalName || attachment.storedName || 'Adjunto'}
            subtitle={formatFileSize(attachment.sizeBytes)}
            category={attachment.category}
            previewUrl={fileUrl}
            href={fileUrl}
            onRemove={onRemove}
            removable={removable}
        />
    );
};

const MicroInternalSampleDossierPanel = ({
    sampleTypeData,
    onChange,
    disabled = false,
    activeUnitId = '',
    onActiveUnitChange,
    analysisDrivenCount = 0,
    attachmentStatsByUnit = {},
    onOpenSupports,
    canUploadEvidence = false,
    onEvidenceFilesSelected,
    apiBase = '',
    existingEvidenceByUnit = {},
    pendingEvidenceByUnit = {},
    onRemoveExistingEvidence,
    onRemovePendingEvidence,
    onGenerateLabel,
    labelLoadingUnitId = ''
}) => {
    const sampleUnits = sampleTypeData?.sampleUnits || [];
    const selectedUnit = sampleUnits.find(unit => unit.id === activeUnitId) || sampleUnits[0] || null;
    const [sampleStepByUnit, setSampleStepByUnit] = useState({});
    const activeSampleStep = selectedUnit ? sampleStepByUnit[selectedUnit.id] || 'IDENTIFICATION' : 'IDENTIFICATION';
    const autoManagedByRequestedAnalyses = analysisDrivenCount > 0;
    const photoInputRef = useRef(null);
    const videoInputRef = useRef(null);
    const documentInputRef = useRef(null);

    useEffect(() => {
        if (!selectedUnit) return;
        if (!activeUnitId || !sampleUnits.some(unit => unit.id === activeUnitId)) {
            onActiveUnitChange?.(selectedUnit.id);
        }
    }, [activeUnitId, onActiveUnitChange, sampleUnits, selectedUnit]);

    useEffect(() => {
        const validUnitIds = new Set(sampleUnits.map(unit => unit.id));
        setSampleStepByUnit(previous => {
            const nextEntries = Object.entries(previous).filter(([unitId]) => validUnitIds.has(unitId));
            if (nextEntries.length === Object.keys(previous).length) return previous;
            return Object.fromEntries(nextEntries);
        });
    }, [sampleUnits]);

    const selectedUnitProgress = useMemo(() => (
        selectedUnit
            ? buildInternalSampleUnitProgress(selectedUnit, attachmentStatsByUnit[selectedUnit.id]?.total || 0)
            : []
    ), [attachmentStatsByUnit, selectedUnit]);

    useEffect(() => {
        if (!selectedUnit?.id) return;
        if (!selectedUnitProgress.length) return;
        const currentStep = selectedUnitProgress.find(step => step.key === activeSampleStep);
        if (currentStep) return;
        setSampleStepByUnit(previous => ({
            ...previous,
            [selectedUnit.id]: selectedUnitProgress[0]?.key || 'IDENTIFICATION'
        }));
    }, [activeSampleStep, selectedUnit?.id, selectedUnitProgress]);

    const commitState = (updater) => {
        if (typeof onChange !== 'function') return;
        onChange(previous => {
            const nextState = typeof updater === 'function' ? updater(previous) : updater;
            return nextState;
        });
    };

    const selectUnit = (unitId) => {
        if (!unitId) return;
        onActiveUnitChange?.(unitId);

        const nextUnit = sampleUnits.find(unit => unit.id === unitId);
        const nextProgress = buildInternalSampleUnitProgress(nextUnit, attachmentStatsByUnit[unitId]?.total || 0);
        const fallbackStep = nextProgress.find(step => step.status !== 'completed')?.key
            || nextProgress[0]?.key
            || 'IDENTIFICATION';

        setSampleStepByUnit(previous => ({
            ...previous,
            [unitId]: previous[unitId] || fallbackStep
        }));
    };

    const addSampleUnit = () => {
        if (autoManagedByRequestedAnalyses) return;
        const nextUnit = createDefaultInternalSampleUnit(selectedUnit?.entityType || 'OTRO', sampleUnits.length + 1);
        commitState(previous => ({
            ...previous,
            sampleUnits: [...(previous?.sampleUnits || []), nextUnit],
            activeSampleUnitId: nextUnit.id
        }));
        setSampleStepByUnit(previous => ({
            ...previous,
            [nextUnit.id]: 'IDENTIFICATION'
        }));
        selectUnit(nextUnit.id);
    };

    const removeSampleUnit = (unitId) => {
        if (autoManagedByRequestedAnalyses) return;
        if (!unitId || sampleUnits.length <= 1) return;

        commitState(previous => {
            const nextUnits = (previous?.sampleUnits || []).filter(unit => unit.id !== unitId);
            const nextAssignments = Object.fromEntries(
                Object.entries(previous?.attachmentAssignments || {}).filter(([, assignedUnitId]) => assignedUnitId !== unitId)
            );
            const fallbackUnitId = nextUnits[0]?.id || '';

            return {
                ...previous,
                sampleUnits: nextUnits,
                attachmentAssignments: nextAssignments,
                activeSampleUnitId: previous?.activeSampleUnitId === unitId ? fallbackUnitId : previous?.activeSampleUnitId
            };
        });
        setSampleStepByUnit(previous => Object.fromEntries(
            Object.entries(previous).filter(([currentUnitId]) => currentUnitId !== unitId)
        ));

        if (activeUnitId === unitId) {
            selectUnit(sampleUnits.find(unit => unit.id !== unitId)?.id || '');
        }
    };

    const updateUnit = (unitId, updater) => {
        commitState(previous => ({
            ...previous,
            sampleUnits: (previous?.sampleUnits || []).map(unit => (
                unit.id === unitId ? updater(unit) : unit
            ))
        }));
    };

    const triggerEvidencePicker = (kind) => {
        if (disabled || !canUploadEvidence || !selectedUnit?.id) return;

        if (kind === 'PHOTO') photoInputRef.current?.click();
        if (kind === 'VIDEO') videoInputRef.current?.click();
        if (kind === 'DOCUMENT') documentInputRef.current?.click();
    };

    const handleEvidenceSelection = (event, kind) => {
        const files = Array.from(event.target.files || []);
        if (typeof onEvidenceFilesSelected === 'function' && files.length > 0 && selectedUnit?.id) {
            onEvidenceFilesSelected(files, {
                unitId: selectedUnit.id,
                kind
            });
        }
        event.target.value = '';
    };

    const selectedStats = attachmentStatsByUnit[selectedUnit?.id] || { total: 0, photo: 0, video: 0, document: 0 };
    const selectedUnitIndex = selectedUnit ? sampleUnits.findIndex(unit => unit.id === selectedUnit.id) : -1;
    const isLabelLoading = selectedUnit?.id && labelLoadingUnitId === selectedUnit.id;
    const selectedExistingEvidence = selectedUnit?.id ? (existingEvidenceByUnit[selectedUnit.id] || []) : [];
    const selectedPendingEvidence = selectedUnit?.id ? (pendingEvidenceByUnit[selectedUnit.id] || []) : [];

    return (
        <div className="rounded-2xl border border-indigo-100 bg-white overflow-hidden">
            <div className="bg-indigo-50 px-5 py-4 border-b border-indigo-100">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                            <Boxes size={16} /> Dossiers por muestra
                        </h3>
                        <p className="text-xs text-indigo-700 mt-1 max-w-3xl">
                            {autoManagedByRequestedAnalyses
                                ? `Se generaron ${analysisDrivenCount} dossier(s) automáticamente a partir de los análisis solicitados. Cada uno tiene propósito, formulario y trazabilidad propia.`
                                : 'Cada muestra maneja su propia naturaleza, captura y trazabilidad. La etapa actual solo muestra la muestra activa para no mezclar expedientes.'}
                        </p>
                        {sampleUnits.length > 1 && (
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
                                Haz clic sobre una tarjeta para abrir el paso a paso de esa muestra.
                            </p>
                        )}
                    </div>
                    {!autoManagedByRequestedAnalyses && !disabled ? (
                        <button
                            type="button"
                            onClick={addSampleUnit}
                            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            <PlusCircle size={14} />
                            Añadir muestra
                        </button>
                    ) : autoManagedByRequestedAnalyses ? (
                        <div className="inline-flex items-center rounded-2xl border border-indigo-200 bg-white px-4 py-2 text-xs font-semibold text-indigo-700">
                            {sampleUnits.length || analysisDrivenCount} dossier(s) ligados a análisis
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="p-5 space-y-5">
                <div className="grid gap-3 xl:grid-cols-3">
                    {sampleUnits.map((unit, index) => {
                        const stats = attachmentStatsByUnit[unit.id] || { total: 0 };
                        const progress = buildInternalSampleUnitProgress(unit, stats.total || 0);
                        const isActive = unit.id === selectedUnit?.id;

                        return (
                            <div
                                key={unit.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={isActive}
                                onClick={() => selectUnit(unit.id)}
                                onKeyDown={event => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    selectUnit(unit.id);
                                }}
                                className={`rounded-2xl border p-4 transition-colors cursor-pointer ${isActive ? 'border-indigo-300 bg-indigo-50/70 ring-2 ring-indigo-100' : 'border-slate-200 bg-slate-50/60 hover:border-indigo-200 hover:bg-white'}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 text-left">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="truncate text-sm font-bold text-slate-900">
                                                {buildInternalSampleUnitLabel(unit, index)}
                                            </p>
                                            {isActive && (
                                                <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                                                    Seleccionada
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {buildOptionLabel(SAMPLE_ENTITY_OPTIONS, unit.entityType)}
                                        </p>
                                        {unit.analysisLabel && (
                                            <p className="mt-2 text-xs font-semibold text-indigo-700">
                                                Análisis: {unit.analysisLabel}
                                            </p>
                                        )}
                                        {unit.sampleIdentifier && (
                                            <p className="mt-1 text-xs font-semibold text-slate-700">
                                                ID: {unit.sampleIdentifier}
                                            </p>
                                        )}
                                        {unit.purpose && (
                                            <p className="mt-1 text-xs text-slate-600">
                                                {unit.purpose}
                                            </p>
                                        )}
                                    </div>
                                    {sampleUnits.length > 1 && !autoManagedByRequestedAnalyses && !disabled && (
                                        <button
                                            type="button"
                                            onClick={event => {
                                                event.stopPropagation();
                                                removeSampleUnit(unit.id);
                                            }}
                                            className="rounded-xl border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                                        >
                                            <span className="inline-flex items-center gap-1">
                                                <Trash2 size={12} />
                                                Quitar
                                            </span>
                                        </button>
                                    )}
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {progress.map(step => (
                                        <span
                                            key={`${unit.id}-${step.key}`}
                                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STEP_STATUS_CLASS[step.status] || STEP_STATUS_CLASS.pending}`}
                                        >
                                            {step.label}
                                        </span>
                                    ))}
                                </div>

                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                    <p>
                                        Soportes vinculados: <span className="font-semibold text-slate-700">{stats.total || 0}</span>
                                    </p>
                                    <span className="font-semibold text-indigo-600">
                                        {isActive ? 'Dossier abierto' : 'Abrir dossier'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {selectedUnit && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Muestra activa</p>
                                <h4 className="mt-1 text-lg font-bold text-slate-900">
                                    {buildInternalSampleUnitLabel(selectedUnit, selectedUnitIndex)}
                                </h4>
                                <p className="mt-1 text-sm text-slate-600">
                                    {buildOptionLabel(SAMPLE_ENTITY_OPTIONS, selectedUnit.entityType)}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                                        Dossier {selectedUnitIndex + 1} de {sampleUnits.length}
                                    </span>
                                    {selectedUnit.sampleIdentifier && (
                                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                                            ID: {selectedUnit.sampleIdentifier}
                                        </span>
                                    )}
                                    {selectedUnit.analysisLabel && (
                                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                            Análisis: {selectedUnit.analysisLabel}
                                        </span>
                                    )}
                                </div>
                                {selectedUnit.purpose && (
                                    <p className="mt-3 max-w-3xl text-sm text-slate-700">
                                        {selectedUnit.purpose}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {typeof onGenerateLabel === 'function' && (
                                    <button
                                        type="button"
                                        onClick={() => onGenerateLabel(selectedUnit)}
                                        disabled={disabled || isLabelLoading}
                                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isLabelLoading ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" /> : <Download size={13} />}
                                        {isLabelLoading ? 'Generando...' : 'Etiqueta 50 x 40 mm'}
                                    </button>
                                )}
                                {selectedUnitProgress.map(step => (
                                    <button
                                        key={step.key}
                                        type="button"
                                        onClick={() => setSampleStepByUnit(previous => ({
                                            ...previous,
                                            [selectedUnit.id]: step.key
                                        }))}
                                        className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${activeSampleStep === step.key ? 'border-indigo-300 bg-indigo-600 text-white' : STEP_STATUS_CLASS[step.status] || STEP_STATUS_CLASS.pending}`}
                                    >
                                        {step.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-white bg-white p-4 shadow-sm">
                            <div className="mb-4">
                                <p className="text-sm font-bold text-slate-900">
                                    {SAMPLE_STEP_META[activeSampleStep]?.title || 'Detalle de muestra'}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {SAMPLE_STEP_META[activeSampleStep]?.description || 'Gestiona el detalle de la muestra sin mezclarlo con otras.'}
                                    {selectedUnit.analysisLabel ? ` Análisis asignado: ${selectedUnit.analysisLabel}.` : ''}
                                </p>
                            </div>

                            {activeSampleStep === 'IDENTIFICATION' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Identificación única</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.sampleIdentifier || 'Se asigna al guardar'}
                                                readOnly
                                                className="w-full rounded-2xl border border-gray-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Análisis solicitado</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.analysisLabel || 'Sin análisis vinculado'}
                                                readOnly
                                                className="w-full rounded-2xl border border-gray-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none"
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Propósito de la muestra</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.purpose || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    purpose: event.target.value
                                                }))}
                                                disabled={disabled}
                                                placeholder="Ej: Muestra destinada al análisis solicitado"
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Nombre interno</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.label || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    label: event.target.value
                                                }))}
                                                disabled={disabled}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Naturaleza de la muestra</label>
                                            <select
                                                value={selectedUnit.entityType || 'OTRO'}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    entityType: event.target.value,
                                                    fields: {}
                                                }))}
                                                disabled={disabled}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            >
                                                {SAMPLE_ENTITY_OPTIONS.map(option => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <MicroInternalSampleTypeFields
                                        entityType={selectedUnit.entityType}
                                        data={selectedUnit.fields}
                                        onChange={(updater) => updateUnit(selectedUnit.id, unit => ({
                                            ...unit,
                                            fields: typeof updater === 'function' ? updater(unit.fields || {}) : updater
                                        }))}
                                        disabled={disabled}
                                    />
                                </div>
                            )}

                            {activeSampleStep === 'COLLECTION' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha y hora de toma</label>
                                            <input
                                                type="datetime-local"
                                                value={selectedUnit.collectionData?.collectedAt || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    collectionData: {
                                                        ...(unit.collectionData || {}),
                                                        collectedAt: event.target.value
                                                    }
                                                }))}
                                                disabled={disabled}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Responsable</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.collectionData?.collectorName || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    collectionData: {
                                                        ...(unit.collectionData || {}),
                                                        collectorName: event.target.value
                                                    }
                                                }))}
                                                disabled={disabled}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Método / toma</label>
                                            <input
                                                type="text"
                                                value={selectedUnit.collectionData?.collectionMethod || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    collectionData: {
                                                        ...(unit.collectionData || {}),
                                                        collectionMethod: event.target.value
                                                    }
                                                }))}
                                                disabled={disabled}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones de recolección</label>
                                            <textarea
                                                value={selectedUnit.collectionData?.collectionNotes || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    collectionData: {
                                                        ...(unit.collectionData || {}),
                                                        collectionNotes: event.target.value
                                                    }
                                                }))}
                                                rows={4}
                                                disabled={disabled}
                                                placeholder="Condición del punto, novedades en toma, preparación, temperatura..."
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Inoculación / preparación</label>
                                            <textarea
                                                value={selectedUnit.collectionData?.inoculationNotes || ''}
                                                onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                    ...unit,
                                                    collectionData: {
                                                        ...(unit.collectionData || {}),
                                                        inoculationNotes: event.target.value
                                                    }
                                                }))}
                                                rows={4}
                                                disabled={disabled}
                                                placeholder="Diluciones, siembra, preparación o manejo específico de esta muestra..."
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notas de trazabilidad</label>
                                        <textarea
                                            value={selectedUnit.collectionData?.traceabilityNotes || ''}
                                            onChange={event => updateUnit(selectedUnit.id, unit => ({
                                                ...unit,
                                                collectionData: {
                                                    ...(unit.collectionData || {}),
                                                    traceabilityNotes: event.target.value
                                                }
                                            }))}
                                            rows={3}
                                            disabled={disabled}
                                            placeholder="Custodia, traslado interno, relación con lote, batch o condición particular..."
                                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                        />
                                    </div>
                                </div>
                            )}

                            {activeSampleStep === 'EVIDENCE' && (
                                <div className="space-y-4">
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Fotos</p>
                                            <p className="mt-2 text-2xl font-bold text-amber-900">{selectedStats.photo || 0}</p>
                                        </div>
                                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Videos</p>
                                            <p className="mt-2 text-2xl font-bold text-sky-900">{selectedStats.video || 0}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Documentos</p>
                                            <p className="mt-2 text-2xl font-bold text-slate-900">{selectedStats.document || 0}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/60 p-4">
                                        <p className="text-sm font-semibold text-indigo-900">
                                            Esta muestra ya tiene {selectedStats.total || 0} soporte(s) vinculado(s).
                                        </p>
                                        <p className="mt-1 text-xs text-indigo-700">
                                            Puedes capturar fotos, videos y documentos desde esta misma etapa durante la recolección. Si el expediente aún no se ha creado, quedarán listos para guardarse cuando inicies el caso; luego podrás revisarlos en soportes sin perder la trazabilidad.
                                        </p>
                                        {typeof onOpenSupports === 'function' && (
                                            <button
                                                type="button"
                                                onClick={() => onOpenSupports(selectedUnit.id)}
                                                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                                            >
                                                <ArrowRight size={14} />
                                                Revisar soportes de esta muestra
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                                        <button
                                            type="button"
                                            onClick={() => triggerEvidencePicker('PHOTO')}
                                            disabled={disabled || !canUploadEvidence}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <Camera size={12} /> Agregar foto
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => triggerEvidencePicker('VIDEO')}
                                            disabled={disabled || !canUploadEvidence}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-medium text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <Video size={12} /> Agregar video
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => triggerEvidencePicker('DOCUMENT')}
                                            disabled={disabled || !canUploadEvidence}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <ClipboardCheck size={12} /> Agregar documento
                                        </button>
                                    </div>
                                    {!canUploadEvidence && (
                                        <p className="text-xs text-slate-500">
                                            La carga de evidencias está temporalmente bloqueada mientras el expediente se está guardando o ya no admite cambios.
                                        </p>
                                    )}
                                    {(selectedPendingEvidence.length > 0 || selectedExistingEvidence.length > 0) && (
                                        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900">Evidencias visibles de esta muestra</p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    Aquí puedes revisar lo que ya subiste y quitar archivos si hace falta antes del cierre del expediente.
                                                </p>
                                            </div>

                                            {selectedPendingEvidence.length > 0 && (
                                                <div className="space-y-3">
                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                                                        En cola por guardar
                                                    </p>
                                                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                        {selectedPendingEvidence.map(entry => (
                                                            <PendingEvidenceCard
                                                                key={entry.id}
                                                                entry={entry}
                                                                onRemove={() => onRemovePendingEvidence?.(entry.id)}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {selectedExistingEvidence.length > 0 && (
                                                <div className="space-y-3">
                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                                                        Ya guardadas en el expediente
                                                    </p>
                                                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                        {selectedExistingEvidence.map(attachment => (
                                                            <SavedEvidenceCard
                                                                key={attachment.id}
                                                                attachment={attachment}
                                                                apiBase={apiBase}
                                                                onRemove={() => onRemoveExistingEvidence?.(attachment.id)}
                                                                removable={!disabled && !attachment.isLegacyFallback}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <input
                                        ref={photoInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={(event) => handleEvidenceSelection(event, 'PHOTO')}
                                        className="hidden"
                                    />
                                    <input
                                        ref={videoInputRef}
                                        type="file"
                                        accept="video/*"
                                        multiple
                                        onChange={(event) => handleEvidenceSelection(event, 'VIDEO')}
                                        className="hidden"
                                    />
                                    <input
                                        ref={documentInputRef}
                                        type="file"
                                        accept="application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                                        multiple
                                        onChange={(event) => handleEvidenceSelection(event, 'DOCUMENT')}
                                        className="hidden"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MicroInternalSampleDossierPanel;
