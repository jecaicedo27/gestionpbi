import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ChevronRight,
    Filter,
    RefreshCcw,
    Search,
    ShieldCheck,
    SlidersHorizontal,
    X
} from 'lucide-react';
import api from '../../services/api';
import ProductiveTraceabilityDetail from './ProductiveTraceabilityDetail';
import {
    formatDate,
    formatNumber,
    getBatchFocusLabel,
    getStatusClasses,
    getTraceabilitySegmentMeta
} from './utils';

const STATUS_OPTIONS = [
    { value: '', label: 'Todos los estados' },
    { value: 'PENDING', label: 'Pendiente' },
    { value: 'EXECUTING', label: 'En ejecucion' },
    { value: 'COMPLETED', label: 'Completado' },
    { value: 'FAILED', label: 'Fallido' }
];

const SEGMENT_OPTIONS = [
    { value: '', label: 'Todos los segmentos' },
    { value: 'FINISHED_PRODUCT', label: 'Producto terminado' },
    { value: 'SUBPROCESS', label: 'Subproceso' }
];

const SEGMENT_ORDER = ['FINISHED_PRODUCT', 'SUBPROCESS', 'UNCLASSIFIED'];

const EMPTY_FILTERS = {
    search: '',
    status: '',
    segment: '',
    productId: '',
    processType: '',
    dateFrom: '',
    dateTo: ''
};

const EMPTY_AVAILABLE_FILTERS = {
    segments: [],
    products: [],
    processTypes: []
};

const ProductiveTraceabilityPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [availableFilters, setAvailableFilters] = useState(EMPTY_AVAILABLE_FILTERS);
    const [batches, setBatches] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1, limit: 30 });
    const [listLoading, setListLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detail, setDetail] = useState(null);
    const [listError, setListError] = useState('');
    const [detailError, setDetailError] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(true);
    const [collapsedGroups, setCollapsedGroups] = useState({
        FINISHED_PRODUCT: false,
        SUBPROCESS: false,
        UNCLASSIFIED: true
    });

    const selectedBatchId = searchParams.get('batch') || '';
    const activeTab = searchParams.get('tab') || 'overview';

    const syncSearchParams = (updates = {}) => {
        const next = new URLSearchParams(searchParams);

        Object.entries(updates).forEach(([key, value]) => {
            if (value) next.set(key, value);
            else next.delete(key);
        });

        setSearchParams(next, { replace: true });
    };

    const fetchBatches = async (page = 1, currentFilters = filters) => {
        setListLoading(true);
        setListError('');

        try {
            const response = await api.get('/productive-traceability/batches', {
                params: {
                    page,
                    limit: pagination.limit || 30,
                    search: currentFilters.search || undefined,
                    status: currentFilters.status || undefined,
                    segment: currentFilters.segment || undefined,
                    productId: currentFilters.productId || undefined,
                    processType: currentFilters.processType || undefined,
                    dateFrom: currentFilters.dateFrom || undefined,
                    dateTo: currentFilters.dateTo || undefined
                }
            });

            const nextItems = response.data?.data || [];
            setBatches(nextItems);
            setAvailableFilters(response.data?.filters || EMPTY_AVAILABLE_FILTERS);
            setPagination(response.data?.pagination || { page: 1, total: 0, totalPages: 1, limit: 30 });

            if (nextItems.length && !selectedBatchId) {
                syncSearchParams({ batch: nextItems[0].id, tab: activeTab || 'overview' });
            } else if (selectedBatchId && !nextItems.some(item => item.id === selectedBatchId)) {
                syncSearchParams({ batch: nextItems[0]?.id || '', tab: activeTab || 'overview' });
            } else if (!nextItems.length) {
                syncSearchParams({ batch: '', tab: activeTab || 'overview' });
            }
        } catch (fetchError) {
            setListError(fetchError.response?.data?.error || 'No se pudo cargar la trazabilidad productiva.');
            setBatches([]);
            setAvailableFilters(EMPTY_AVAILABLE_FILTERS);
            setPagination({ page: 1, total: 0, totalPages: 1, limit: 30 });
        } finally {
            setListLoading(false);
        }
    };

    const fetchDetail = async (batchId) => {
        if (!batchId) {
            setDetail(null);
            setDetailError('');
            return;
        }

        setDetailLoading(true);
        setDetailError('');

        try {
            const response = await api.get(`/productive-traceability/batches/${batchId}`);
            setDetail(response.data);
        } catch (fetchError) {
            setDetail(null);
            setDetailError(fetchError.response?.data?.error || 'No se pudo cargar el expediente del lote.');
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => {
        fetchBatches(1, filters);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchDetail(selectedBatchId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBatchId]);

    const applyFilters = () => {
        fetchBatches(1, filters);
    };

    const resetFilters = () => {
        setFilters(EMPTY_FILTERS);
        fetchBatches(1, EMPTY_FILTERS);
    };

    const handleSelectBatch = (batchId) => {
        syncSearchParams({ batch: batchId, tab: activeTab || 'overview' });
    };

    const toggleGroup = (key) => {
        setCollapsedGroups(previous => ({
            ...previous,
            [key]: !previous[key]
        }));
    };

    const groupedBatches = {
        FINISHED_PRODUCT: [],
        SUBPROCESS: [],
        UNCLASSIFIED: []
    };

    batches.forEach((batch) => {
        const key = batch.segment?.key || 'UNCLASSIFIED';
        if (!groupedBatches[key]) groupedBatches[key] = [];
        groupedBatches[key].push(batch);
    });

    const selectedSummary = batches.find(item => item.id === selectedBatchId) || null;
    const selectedSegment = getTraceabilitySegmentMeta(selectedSummary?.segment);
    const activeFilterCount = Object.values(filters).filter(Boolean).length;
    const finishedCount = availableFilters.segments.find(item => item.key === 'FINISHED_PRODUCT')?.count || 0;
    const subprocessCount = availableFilters.segments.find(item => item.key === 'SUBPROCESS')?.count || 0;

    return (
        <div className="mx-auto flex max-w-[1760px] flex-col gap-6 p-6">
            <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
                <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_35%),linear-gradient(135deg,#020617_0%,#0f172a_35%,#065f46_100%)] px-6 py-6 text-white">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-50">
                                <ShieldCheck size={14} />
                                Calidad
                            </div>
                            <h1 className="mt-4 text-3xl font-black tracking-tight">Trazabilidad Productiva</h1>
                            <p className="mt-3 text-sm text-slate-200">
                                Expediente unificado para seguir un lote y ahora separar con claridad los lotes de subproceso de los lotes orientados a producto terminado.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">Lotes listados</p>
                                <p className="mt-2 text-2xl font-black">{formatNumber(pagination.total || 0)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">Producto terminado</p>
                                <p className="mt-2 text-2xl font-black">{formatNumber(finishedCount)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">Subproceso</p>
                                <p className="mt-2 text-2xl font-black">{formatNumber(subprocessCount)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">Seleccion</p>
                                <p className="mt-2 text-base font-black">{selectedSummary?.displayLot || 'Sin lote'}</p>
                                <p className="mt-1 text-xs text-slate-300">{selectedSegment.label}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t border-white/10 bg-slate-50 px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Explorador de expedientes</p>
                            <p className="mt-1 text-sm text-slate-500">Filtra por segmento, producto, proceso, estado o fecha y oculta el panel cuando solo quieras navegar la lista.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {activeFilterCount > 0 && (
                                <div className="inline-flex items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                    {activeFilterCount} filtro(s) activo(s)
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => setFiltersOpen(previous => !previous)}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                            >
                                <SlidersHorizontal size={15} />
                                {filtersOpen ? 'Ocultar filtros' : 'Mostrar filtros'}
                            </button>
                        </div>
                    </div>

                    {filtersOpen && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <label className="relative xl:col-span-2">
                                <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={filters.search}
                                    onChange={(event) => setFilters(previous => ({ ...previous, search: event.target.value }))}
                                    placeholder="Buscar por lote, batch, sabor, producto o familia"
                                    className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                                />
                            </label>

                            <select
                                value={filters.status}
                                onChange={(event) => setFilters(previous => ({ ...previous, status: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            >
                                {STATUS_OPTIONS.map((option) => (
                                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <select
                                value={filters.segment}
                                onChange={(event) => setFilters(previous => ({ ...previous, segment: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            >
                                {SEGMENT_OPTIONS.map((option) => (
                                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <select
                                value={filters.productId}
                                onChange={(event) => setFilters(previous => ({ ...previous, productId: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            >
                                <option value="">Todos los productos</option>
                                {availableFilters.products.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.name} {option.segment === 'SUBPROCESS' ? '· Subproceso' : '· Producto terminado'}
                                    </option>
                                ))}
                            </select>

                            <select
                                value={filters.processType}
                                onChange={(event) => setFilters(previous => ({ ...previous, processType: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            >
                                <option value="">Todos los procesos</option>
                                {availableFilters.processTypes.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(event) => setFilters(previous => ({ ...previous, dateFrom: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            />

                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(event) => setFilters(previous => ({ ...previous, dateTo: event.target.value }))}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-300"
                            />

                            <div className="flex gap-2 xl:col-span-2">
                                <button
                                    type="button"
                                    onClick={applyFilters}
                                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                                >
                                    <Filter size={15} />
                                    Aplicar filtros
                                </button>
                                <button
                                    type="button"
                                    onClick={resetFilters}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                                >
                                    <X size={15} />
                                    Limpiar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        fetchBatches(pagination.page || 1, filters);
                                        fetchDetail(selectedBatchId);
                                    }}
                                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                                    title="Refrescar"
                                >
                                    <RefreshCcw size={15} />
                                </button>
                            </div>
                        </div>
                    )}

                    {listError && (
                        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {listError}
                        </div>
                    )}
                </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
                <aside className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-slate-950">Expedientes segmentados</p>
                                <p className="mt-1 text-xs text-slate-500">La columna separa producto terminado, subproceso y lotes pendientes de clasificar.</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                                {formatNumber(pagination.total || 0)}
                            </div>
                        </div>
                    </div>

                    <div className="max-h-[calc(100vh-280px)] overflow-y-auto p-4">
                        {listLoading ? (
                            <div className="space-y-3">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <div key={index} className="h-32 animate-pulse rounded-3xl bg-slate-100" />
                                ))}
                            </div>
                        ) : batches.length ? (
                            <div className="space-y-4">
                                {SEGMENT_ORDER.map((segmentKey) => {
                                    const items = groupedBatches[segmentKey] || [];
                                    const segmentMeta = getTraceabilitySegmentMeta(segmentKey);
                                    const segmentCount = availableFilters.segments.find(item => item.key === segmentKey)?.count || items.length;

                                    if (!items.length && filters.segment !== segmentKey) return null;

                                    return (
                                        <section key={segmentKey} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                                            <button
                                                type="button"
                                                onClick={() => toggleGroup(segmentKey)}
                                                className="flex w-full items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 text-left"
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`rounded-2xl border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] ${segmentMeta.badge}`}>
                                                        {segmentMeta.label}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-950">{segmentMeta.label}</p>
                                                        <p className="mt-1 text-xs text-slate-500">{segmentMeta.helper}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                                                        {formatNumber(segmentCount)}
                                                    </div>
                                                    {collapsedGroups[segmentKey] ? <ChevronRight size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                                                </div>
                                            </button>

                                            {!collapsedGroups[segmentKey] && (
                                                <div className="space-y-3 p-3">
                                                    {items.length ? items.map((batch) => {
                                                        const isSelected = selectedBatchId === batch.id;
                                                        const batchSegment = getTraceabilitySegmentMeta(batch.segment);

                                                        return (
                                                            <button
                                                                key={batch.id}
                                                                type="button"
                                                                onClick={() => handleSelectBatch(batch.id)}
                                                                className={`w-full rounded-3xl border px-4 py-4 text-left transition-all ${isSelected
                                                                    ? 'border-emerald-200 bg-emerald-50 shadow-sm ring-2 ring-emerald-100'
                                                                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                                                    }`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div>
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <span className="inline-flex items-center rounded-full bg-slate-950 px-2.5 py-1 text-xs font-bold text-white">
                                                                                {batch.displayLot || batch.batchNumber}
                                                                            </span>
                                                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${batchSegment.badge}`}>
                                                                                {batchSegment.label}
                                                                            </span>
                                                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(batch.status)}`}>
                                                                                {batch.status}
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-3 text-sm font-bold text-slate-950">{batch.batchNumber}</p>
                                                                        <p className="mt-1 text-xs text-slate-500">
                                                                            {getBatchFocusLabel(batch)} · {formatDate(batch.startedAt || batch.scheduledStart || batch.createdAt, true)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Etapas</p>
                                                                        <p className="mt-1 text-sm font-black text-slate-950">
                                                                            {batch.stats?.stagesCompleted || 0}/{batch.stats?.stagesTotal || 0}
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                {!!batch.trackedProducts?.length && (
                                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                                        {batch.trackedProducts.slice(0, 3).map((productName) => (
                                                                            <span key={`${batch.id}-${productName}`} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                                                                {productName}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Operadores</p>
                                                                        <p className="mt-1 text-sm font-bold text-slate-950">{formatNumber(batch.stats?.operatorCount || 0)}</p>
                                                                    </div>
                                                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidencias</p>
                                                                        <p className="mt-1 text-sm font-bold text-slate-950">{formatNumber(batch.stats?.evidenceCount || 0)}</p>
                                                                    </div>
                                                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Procesos</p>
                                                                        <p className="mt-1 text-xs font-semibold text-slate-700">{batch.stats?.processTypes?.slice(0, 2).join(', ') || '-'}</p>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    }) : (
                                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                                                            No hay resultados en este segmento con los filtros actuales.
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                                    <Factory size={24} />
                                </div>
                                <p className="mt-4 text-sm font-bold text-slate-900">Sin lotes para mostrar</p>
                                <p className="mt-2 text-sm text-slate-500">Ajusta los filtros o espera a que se generen nuevos batches con informacion trazable.</p>
                            </div>
                        )}
                    </div>
                </aside>

                <ProductiveTraceabilityDetail
                    detail={detail}
                    loading={detailLoading}
                    error={detailError}
                    activeTab={activeTab}
                    onTabChange={(tabId) => syncSearchParams({ batch: selectedBatchId, tab: tabId })}
                />
            </div>
        </div>
    );
};

export default ProductiveTraceabilityPage;
