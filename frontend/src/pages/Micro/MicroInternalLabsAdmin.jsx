import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ClipboardList,
    Clock3,
    FileText,
    Filter,
    Layers3,
    Plus,
    RefreshCcw,
    Search,
    ShieldAlert
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MicroInternalLabEntry from './MicroInternalLabEntry';
import {
    LABORATORY_PROFILE_OPTIONS,
    SHIFT_OPTIONS,
    STATUS_META,
    WORK_CONTEXT_OPTIONS,
    buildOptionLabel,
    formatDateTimeLabel
} from './microLabConfig';

const API = import.meta.env.VITE_API_URL;

const ADMIN_STATUSES = [
    { value: 'ALL', label: 'Todos los estados' },
    { value: 'RECEIVED', label: 'Recepcionados' },
    { value: 'IN_PROCESS', label: 'En seguimiento' },
    { value: 'RESULTS_RECORDED', label: 'Resultados listos' },
    { value: 'TECHNICAL_REVIEW', label: 'En revisión' },
    { value: 'REJECTED', label: 'Rechazados' },
    { value: 'CLOSED', label: 'Cerrados' }
];

const QUICK_FILTERS = [
    { id: 'ALL', label: 'Todos' },
    { id: 'OPEN', label: 'Abiertos' },
    { id: 'ATTENTION', label: 'Con brechas' },
    { id: 'READY_REVIEW', label: 'Listos revisión' },
    { id: 'DEVIATION', label: 'Con desvío' },
    { id: 'CLOSED', label: 'Cerrados' }
];

const PIPELINE_ORDER = ['RECEIVED', 'IN_PROCESS', 'RESULTS_RECORDED', 'TECHNICAL_REVIEW', 'REJECTED', 'CLOSED'];

const isClosedLike = (status) => ['CLOSED', 'COMPLETED'].includes(status);
const isOperationallyOpen = (status) => !isClosedLike(status) && status !== 'REJECTED';

const getLatestActivityAt = (sample = {}) => (
    sample?.summary?.reviewedAt
    || sample?.summary?.resultsCapturedAt
    || sample?.summary?.latestLogDate
    || sample?.summary?.receivedAt
    || sample?.takenAt
    || null
);

const getInternalCaseActionLabel = (sample = {}) => {
    if (sample.status === 'RESULTS_RECORDED') return 'Abrir revisión';
    if (sample.status === 'TECHNICAL_REVIEW') return 'Aprobar caso';
    if (sample.status === 'REJECTED' || isClosedLike(sample.status)) return 'Ver caso';
    return 'Continuar';
};

const MicroInternalLabsAdmin = ({
    embedded = false,
    refreshSignal = 0,
    onDataChange,
    onOpenDashboard
}) => {
    const { token } = useAuth();
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [samples, setSamples] = useState([]);
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchInput, setSearchInput] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPointId, setSelectedPointId] = useState('');
    const [selectedStatus, setSelectedStatus] = useState('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [onlyOpen, setOnlyOpen] = useState(true);
    const [quickFilter, setQuickFilter] = useState('OPEN');

    const [showInternalEntry, setShowInternalEntry] = useState(false);
    const [internalScheduleEntry, setInternalScheduleEntry] = useState(null);
    const [internalSampleId, setInternalSampleId] = useState(null);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setSearchTerm(searchInput.trim());
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [searchInput]);

    const fetchAdminData = async () => {
        setLoading(true);
        setError('');

        try {
            const [samplesResponse, pointsResponse] = await Promise.all([
                axios.get(`${API}/api/micro/samples`, {
                    headers,
                    params: {
                        workflowType: 'INTERNAL',
                        lite: 1,
                        limit: 250,
                        pointId: selectedPointId || undefined,
                        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
                        search: searchTerm || undefined,
                        dateFrom: dateFrom || undefined,
                        dateTo: dateTo || undefined,
                        onlyOpen: onlyOpen || undefined
                    }
                }),
                axios.get(`${API}/api/micro/sampling-points`, { headers })
            ]);

            setSamples(samplesResponse.data || []);
            setPoints(pointsResponse.data || []);
        } catch (fetchError) {
            setError(fetchError.response?.data?.error || 'No fue posible cargar la administración del laboratorio interno.');
            setSamples([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAdminData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [headers, refreshSignal, selectedPointId, selectedStatus, searchTerm, dateFrom, dateTo, onlyOpen]);

    const summary = useMemo(() => ({
        total: samples.length,
        open: samples.filter(sample => isOperationallyOpen(sample.status)).length,
        readyReview: samples.filter(sample => ['RESULTS_RECORDED', 'TECHNICAL_REVIEW'].includes(sample.status)).length,
        withMissingResults: samples.filter(sample => (sample.summary?.missingRequestedResultsCount || 0) > 0).length,
        withoutSupports: samples.filter(sample => (sample.summary?.supportAttachmentsCount || 0) === 0).length,
        withDeviation: samples.filter(sample => Boolean(sample.summary?.hasDeviation)).length
    }), [samples]);

    const pipelineCards = useMemo(() => (
        PIPELINE_ORDER.map(status => ({
            status,
            label: STATUS_META[status]?.label || status,
            value: samples.filter(sample => sample.status === status).length,
            chipClass: STATUS_META[status]?.chipClass || 'bg-slate-100 text-slate-700 border border-slate-200'
        }))
    ), [samples]);

    const visibleSamples = useMemo(() => {
        if (quickFilter === 'ALL') return samples;
        if (quickFilter === 'OPEN') return samples.filter(sample => isOperationallyOpen(sample.status));
        if (quickFilter === 'ATTENTION') {
            return samples.filter(sample => (
                (sample.summary?.missingRequestedResultsCount || 0) > 0
                || (sample.summary?.supportAttachmentsCount || 0) === 0
                || Boolean(sample.summary?.hasDeviation)
            ));
        }
        if (quickFilter === 'READY_REVIEW') {
            return samples.filter(sample => ['RESULTS_RECORDED', 'TECHNICAL_REVIEW'].includes(sample.status));
        }
        if (quickFilter === 'DEVIATION') {
            return samples.filter(sample => Boolean(sample.summary?.hasDeviation));
        }
        if (quickFilter === 'CLOSED') {
            return samples.filter(sample => isClosedLike(sample.status));
        }
        return samples;
    }, [quickFilter, samples]);

    const attentionCases = useMemo(() => (
        samples
            .filter(sample => (
                (sample.summary?.missingRequestedResultsCount || 0) > 0
                || (sample.summary?.supportAttachmentsCount || 0) === 0
                || Boolean(sample.summary?.hasDeviation)
            ))
            .slice(0, 6)
    ), [samples]);

    const closeInternalEntry = () => {
        setShowInternalEntry(false);
        setInternalScheduleEntry(null);
        setInternalSampleId(null);
    };

    const handleRefresh = async () => {
        await fetchAdminData();
        if (typeof onDataChange === 'function') onDataChange();
    };

    const openInternalCase = (sample = null) => {
        setInternalScheduleEntry(sample?.scheduleEntry || null);
        setInternalSampleId(sample?.id || null);
        setShowInternalEntry(true);
    };

    const resetFilters = () => {
        setSearchInput('');
        setSelectedPointId('');
        setSelectedStatus('ALL');
        setDateFrom('');
        setDateTo('');
        setOnlyOpen(true);
        setQuickFilter('OPEN');
    };

    const handleStatusFilterChange = (value) => {
        setSelectedStatus(value);
        if (['CLOSED', 'REJECTED'].includes(value)) {
            setOnlyOpen(false);
        }
    };

    const handleQuickFilterChange = (filterId) => {
        setQuickFilter(filterId);
        if (filterId === 'CLOSED') {
            setOnlyOpen(false);
        } else if (filterId === 'OPEN' && selectedStatus === 'ALL') {
            setOnlyOpen(true);
        }
    };

    if (loading && samples.length === 0) {
        return (
            <div className="flex h-64 items-center justify-center text-slate-400">
                <div className="flex items-center gap-3">
                    <ClipboardList className="animate-pulse" size={28} />
                    Cargando administración del laboratorio interno...
                </div>
            </div>
        );
    }

    return (
        <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[1680px] space-y-6 p-6'}>
            <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-950 via-teal-950 to-emerald-900 px-6 py-6 text-white">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex items-start gap-4">
                            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                                <ClipboardList size={28} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Administración de Laboratorios Internos</h1>
                                <p className="mt-1 text-sm text-teal-50/90">
                                    Lista operativa para filtrar, abrir, continuar y cerrar casos internos con visibilidad de resultados, soportes, desvíos y etapa actual.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {typeof onOpenDashboard === 'function' && (
                                <button
                                    type="button"
                                    onClick={onOpenDashboard}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
                                >
                                    <Layers3 size={16} />
                                    Ver agenda
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleRefresh}
                                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
                            >
                                <RefreshCcw size={16} />
                                Actualizar
                            </button>
                            <button
                                type="button"
                                onClick={() => openInternalCase()}
                                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-teal-50"
                            >
                                <Plus size={16} />
                                Nuevo laboratorio interno
                            </button>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
                            <div className="xl:col-span-2">
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Buscar caso</label>
                                <div className="relative">
                                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={searchInput}
                                        onChange={event => setSearchInput(event.target.value)}
                                        placeholder="Caso, reporte, lote, batch o punto"
                                        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Estado</label>
                                <select
                                    value={selectedStatus}
                                    onChange={event => handleStatusFilterChange(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                                >
                                    {ADMIN_STATUSES.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Punto</label>
                                <select
                                    value={selectedPointId}
                                    onChange={event => setSelectedPointId(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                                >
                                    <option value="">Todos los puntos</option>
                                    {points.map(point => (
                                        <option key={point.id} value={point.id}>{point.code} — {point.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Desde</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={event => setDateFrom(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Hasta</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={event => setDateTo(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                                />
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 xl:min-w-[260px]">
                            <div className="flex items-center gap-2 text-slate-700">
                                <Filter size={15} />
                                <span className="text-sm font-bold">Filtro operativo</span>
                            </div>
                            <label className="mt-3 flex items-center gap-3 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={onlyOpen}
                                    onChange={event => setOnlyOpen(event.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                                />
                                Mostrar solo casos abiertos
                            </label>
                            <button
                                type="button"
                                onClick={resetFilters}
                                className="mt-3 text-xs font-semibold text-teal-700 hover:text-teal-800"
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertTriangle size={16} />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Casos cargados</p>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{summary.total}</p>
                </div>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Abiertos</p>
                    <p className="mt-2 text-3xl font-bold text-cyan-900">{summary.open}</p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Listos revisión</p>
                    <p className="mt-2 text-3xl font-bold text-violet-900">{summary.readyReview}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Resultados faltantes</p>
                    <p className="mt-2 text-3xl font-bold text-amber-900">{summary.withMissingResults}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Sin soportes</p>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{summary.withoutSupports}</p>
                </div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Con desvío</p>
                    <p className="mt-2 text-3xl font-bold text-rose-900">{summary.withDeviation}</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {QUICK_FILTERS.map(filter => {
                    const isActive = quickFilter === filter.id;
                    return (
                        <button
                            key={filter.id}
                            type="button"
                            onClick={() => handleQuickFilterChange(filter.id)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${isActive
                                ? 'bg-slate-900 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            {filter.label}
                        </button>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_380px]">
                <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="font-bold text-slate-900">Mesa operativa de laboratorios internos</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Casos visibles: {visibleSamples.length}. Haz clic sobre una fila o usa el botón de acción para continuar el proceso.
                            </p>
                        </div>
                        <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                            {quickFilter === 'ALL' ? 'Vista completa' : `Filtro: ${QUICK_FILTERS.find(filter => filter.id === quickFilter)?.label || quickFilter}`}
                        </span>
                    </div>

                    {visibleSamples.length === 0 ? (
                        <div className="px-6 py-14 text-center text-sm text-slate-500">
                            No hay laboratorios internos que coincidan con los filtros actuales.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3">Caso</th>
                                        <th className="px-4 py-3">Punto</th>
                                        <th className="px-4 py-3">Contexto</th>
                                        <th className="px-4 py-3">Estado</th>
                                        <th className="px-4 py-3">Resultados</th>
                                        <th className="px-4 py-3">Soportes</th>
                                        <th className="px-4 py-3">Última actividad</th>
                                        <th className="px-4 py-3">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {visibleSamples.map(sample => {
                                        const statusMeta = STATUS_META[sample.status] || STATUS_META.PLANNED;
                                        const sampleSummary = sample.summary || {};
                                        const latestActivity = getLatestActivityAt(sample);
                                        const resultCoverageLabel = sampleSummary.requestedParametersCount > 0
                                            ? `${sampleSummary.requestedResultsRecordedCount || 0}/${sampleSummary.requestedParametersCount}`
                                            : `${sampleSummary.resultsCount || 0}`;

                                        return (
                                            <tr
                                                key={sample.id}
                                                className="cursor-pointer hover:bg-slate-50/70"
                                                onClick={() => openInternalCase(sample)}
                                            >
                                                <td className="px-4 py-3">
                                                    <div>
                                                        <p className="font-semibold text-slate-900">{sample.sampleNumber}</p>
                                                        <p className="text-xs text-slate-500">{sample.reportNumber || 'Sin reporte final'}</p>
                                                        <p className="mt-1 text-xs text-slate-400">{formatDateTimeLabel(sample.takenAt)}</p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">
                                                    <div>
                                                        <p className="font-medium text-slate-800">{sample.samplingPoint?.code || '—'} · {sample.samplingPoint?.name || 'Sin punto'}</p>
                                                        <p className="text-xs text-slate-500">{sample.samplingPoint?.zoneCode || sample.zoneName || 'Sin zona'}</p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-slate-700">{buildOptionLabel(WORK_CONTEXT_OPTIONS, sample.workContext)}</span>
                                                        <span className="text-xs text-slate-500">
                                                            {buildOptionLabel(SHIFT_OPTIONS, sample.shift)} · {buildOptionLabel(LABORATORY_PROFILE_OPTIONS, sample.laboratoryProfile)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col gap-2">
                                                        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.chipClass}`}>
                                                            {statusMeta.label}
                                                        </span>
                                                        {sampleSummary.hasDeviation && (
                                                            <span className="inline-flex w-fit rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                                                Con desvío
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">
                                                    <div>
                                                        <p className="font-semibold text-slate-800">{resultCoverageLabel}</p>
                                                        <p className="text-xs text-slate-500">
                                                            {(sampleSummary.missingRequestedResultsCount || 0) > 0
                                                                ? `${sampleSummary.missingRequestedResultsCount} pendiente(s)`
                                                                : 'Cobertura completa'}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="inline-flex items-center gap-1 text-xs">
                                                            <FileText size={12} className="text-slate-400" />
                                                            {sampleSummary.supportAttachmentsCount || 0} soporte(s)
                                                        </span>
                                                        <span className="text-xs text-slate-500">
                                                            {sampleSummary.reportAttachmentsCount || sample.reportUrl ? 'Con reporte final' : 'Sin reporte'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-500">
                                                    {latestActivity ? formatDateTimeLabel(latestActivity) : '—'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            openInternalCase(sample);
                                                        }}
                                                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                                                    >
                                                        <ArrowRight size={13} />
                                                        {getInternalCaseActionLabel(sample)}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Pipeline interno</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Distribución rápida de casos por etapa real del laboratorio.
                            </p>
                        </div>
                        <div className="p-5 space-y-3">
                            {pipelineCards.map(card => (
                                <div key={card.status} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="min-w-0">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${card.chipClass}`}>
                                            {card.label}
                                        </span>
                                    </div>
                                    <span className="text-lg font-bold text-slate-900">{card.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Brechas a resolver</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Casos con faltantes de resultados, soportes o desviaciones documentadas.
                            </p>
                        </div>
                        <div className="p-5 space-y-3">
                            {attentionCases.length === 0 ? (
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                                    No hay brechas abiertas en los casos visibles.
                                </div>
                            ) : (
                                attentionCases.map(sample => {
                                    const sampleSummary = sample.summary || {};
                                    const needsResults = (sampleSummary.missingRequestedResultsCount || 0) > 0;
                                    const needsSupports = (sampleSummary.supportAttachmentsCount || 0) === 0;
                                    return (
                                        <button
                                            key={sample.id}
                                            type="button"
                                            onClick={() => openInternalCase(sample)}
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left hover:bg-slate-100"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-semibold text-slate-900">{sample.sampleNumber}</p>
                                                    <p className="mt-1 text-xs text-slate-500">{sample.samplingPoint?.code || 'Sin punto'} · {sample.samplingPoint?.name || 'Sin nombre'}</p>
                                                </div>
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${(STATUS_META[sample.status] || STATUS_META.PLANNED).chipClass}`}>
                                                    {(STATUS_META[sample.status] || STATUS_META.PLANNED).label}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {needsResults && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                                        <Clock3 size={12} />
                                                        {sampleSummary.missingRequestedResultsCount} resultado(s) faltante(s)
                                                    </span>
                                                )}
                                                {needsSupports && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                                        <FileText size={12} />
                                                        Sin soportes
                                                    </span>
                                                )}
                                                {sampleSummary.hasDeviation && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                                        <ShieldAlert size={12} />
                                                        Desvío activo
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Lectura del motor interno</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Qué está resolviendo bien el sistema y dónde conviene enfocar el siguiente ajuste.
                            </p>
                        </div>
                        <div className="p-5 space-y-3 text-sm">
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-emerald-800">
                                <div className="flex items-start gap-3">
                                    <CheckCircle2 size={18} className="mt-0.5" />
                                    <div>
                                        <p className="font-semibold">Motor de workflow interno activo</p>
                                        <p className="mt-1 text-emerald-700">
                                            La tabla ya refleja recepción, seguimiento, resultados, revisión, desvíos y cierre sin mezclar todas las etapas en una sola vista.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-amber-900">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle size={18} className="mt-0.5" />
                                    <div>
                                        <p className="font-semibold">Foco recomendado</p>
                                        <p className="mt-1 text-amber-800">
                                            El siguiente salto natural es separar bandejas por responsabilidad operativa, revisión técnica y aprobación, antes de entrar a permisos por rol.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showInternalEntry && (
                <MicroInternalLabEntry
                    scheduleEntry={internalScheduleEntry}
                    existingSampleId={internalSampleId}
                    onClose={closeInternalEntry}
                    onDataChange={async () => {
                        closeInternalEntry();
                        await handleRefresh();
                    }}
                />
            )}
        </div>
    );
};

export default MicroInternalLabsAdmin;
