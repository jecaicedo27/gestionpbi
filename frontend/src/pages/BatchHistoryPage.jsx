import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Filter, X, Clock, User, Package, FlaskConical, AlertTriangle, CheckCircle2, Circle, ArrowLeft, Layers, BarChart2, Calendar } from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '') + '/api';

/* ════════════════════════════════════════════════════════════════════════════
   Helper functions
   ════════════════════════════════════════════════════════════════════════════ */
const fmt = (v, dec = 0) =>
    v != null ? Number(v).toLocaleString('es-CO', { maximumFractionDigits: dec }) : '—';

const fmtDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtTime = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
};
const fmtDateTime = (d) => d ? `${fmtDate(d)} ${fmtTime(d)}` : '—';

const fmtDuration = (mins) => {
    if (!mins && mins !== 0) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const statusColors = {
    PENDING: 'bg-slate-100 text-slate-600',
    STAGE_1_BASE: 'bg-amber-100 text-amber-700',
    STAGE_2_COMPUESTO: 'bg-blue-100 text-blue-700',
    STAGE_3_ESFERAS: 'bg-purple-100 text-purple-700',
    STAGE_4_ENSAMBLE: 'bg-cyan-100 text-cyan-700',
    EXECUTING: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-red-100 text-red-700'
};

const noteStatusIcon = (status) => {
    if (status === 'COMPLETED') return <CheckCircle2 size={18} className="text-emerald-500" />;
    if (status === 'EXECUTING') return <Clock size={18} className="text-blue-500 animate-pulse" />;
    return <Circle size={18} className="text-slate-300" />;
};

/* ════════════════════════════════════════════════════════════════════════════
   Main Component
   ════════════════════════════════════════════════════════════════════════════ */
const BatchHistoryPage = () => {
    const [batches, setBatches] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0, limit: 20 });
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Detail view
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // ── Fetch list ──
    const fetchBatches = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: 20 });
            if (search) params.set('search', search);
            if (statusFilter) params.set('status', statusFilter);
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            const res = await fetch(`${API}/batch-history?${params}`);
            const json = await res.json();
            setBatches(json.data || []);
            setPagination(json.pagination || { page: 1, total: 0, totalPages: 0, limit: 20 });
        } catch (err) {
            console.error('Error fetching batch history:', err);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, dateFrom, dateTo]);

    useEffect(() => { fetchBatches(1); }, [fetchBatches]);

    // ── Fetch detail ──
    const openDetail = async (batchId) => {
        setSelectedBatch(batchId);
        setDetailLoading(true);
        try {
            const res = await fetch(`${API}/batch-history/${batchId}`);
            const json = await res.json();
            setDetail(json);
        } catch (err) {
            console.error('Error fetching batch detail:', err);
        } finally {
            setDetailLoading(false);
        }
    };

    // ── DETAIL VIEW ──
    if (selectedBatch) {
        return (
            <div className="min-h-screen bg-slate-50 pb-20">
                {/* Header */}
                <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                    <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
                        <button onClick={() => { setSelectedBatch(null); setDetail(null); }}
                            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                            <ArrowLeft size={18} /> Volver
                        </button>
                        {detail && (
                            <div className="flex-1 flex items-center justify-between">
                                <div>
                                    <h1 className="text-lg font-black text-slate-800">{detail.batchNumber}</h1>
                                    <span className="text-sm text-slate-400">{detail.flavor} · {detail.product}</span>
                                </div>
                                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${statusColors[detail.status] || statusColors.PENDING}`}>
                                    {detail.status}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {detailLoading ? (
                    <div className="flex justify-center items-center py-32">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
                    </div>
                ) : detail ? (
                    <div className="max-w-7xl mx-auto px-4 pt-6 space-y-6">
                        {/* KPI cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                            <KpiCard label="Duración" value={fmtDuration(detail.durationMinutes)} icon={<Clock size={16} />} color="blue" />
                            <KpiCard label="Etapas" value={`${detail.kpis?.stagesCompleted ?? 0}/${detail.kpis?.stagesTotal ?? 0}`} icon={<Layers size={16} />} color="indigo" />
                            <KpiCard label="Producido" value={`${fmt(detail.actualOutput || detail.expectedOutput)} g`} icon={<Package size={16} />} color="emerald" />
                            <KpiCard label="Uds Conteo" value={fmt(detail.kpis?.unitsActual)} icon={<BarChart2 size={16} />} color="cyan" />
                            <KpiCard label="Defectuosas" value={fmt(detail.kpis?.unitsDefective)} icon={<AlertTriangle size={16} />} color="rose" />
                            <KpiCard label="Efectividad" value={detail.kpis?.effectiveness != null ? `${detail.kpis.effectiveness}%` : '—'} icon={<CheckCircle2 size={16} />}
                                color={detail.kpis?.effectiveness >= 95 ? 'emerald' : detail.kpis?.effectiveness >= 80 ? 'amber' : 'rose'} />
                        </div>

                        {/* Dates row */}
                        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-6">
                            <InfoItem label="Creado" value={fmtDateTime(detail.createdAt)} />
                            <InfoItem label="Inicio Producción" value={fmtDateTime(detail.startedAt)} />
                            <InfoItem label="Fin Producción" value={fmtDateTime(detail.completedAt)} />
                            <InfoItem label="Sabor" value={detail.flavor || '—'} />
                            <InfoItem label="Plantilla" value={detail.template || '—'} />
                        </div>

                        {/* Output targets */}
                        {detail.outputTargets?.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Productos de Salida</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {detail.outputTargets.map((t, i) => (
                                        <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                            <div className="font-bold text-sm text-slate-700">{t.product}</div>
                                            <div className="text-xs text-slate-400 mt-1">
                                                {t.plannedUnits > 0 ? `${fmt(t.plannedUnits)} uds` : ''}
                                                {t.plannedWeightKg > 0 ? ` · ${fmt(t.plannedWeightKg, 1)} kg` : ''}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── TIMELINE ── */}
                        <div>
                            <h2 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2">
                                <Clock size={16} /> Timeline del Proceso
                            </h2>
                            <div className="relative pl-8 space-y-4">
                                {/* Vertical line */}
                                <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-blue-300 via-emerald-300 to-slate-200" />

                                {detail.timeline?.map((stage, idx) => (
                                    <TimelineCard key={stage.id} stage={stage} index={idx} />
                                ))}
                            </div>
                        </div>

                        {/* Production lots */}
                        {detail.productionLots?.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Lotes Producidos</h3>
                                <div className="space-y-2">
                                    {detail.productionLots.map((lot, i) => (
                                        <div key={i} className="flex justify-between items-center bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                                            <div>
                                                <div className="font-bold text-sm text-slate-700">{lot.product}</div>
                                                <div className="text-xs text-slate-400 font-mono">{lot.lotNumber}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-sm text-emerald-600">{fmt(lot.initialQuantity)} g</div>
                                                <div className="text-xs text-slate-400">
                                                    {lot.expiresAt ? `Vence: ${fmtDate(lot.expiresAt)}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        );
    }

    // ── LIST VIEW ──
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h1 className="text-xl font-black text-slate-800">Historial de Batches</h1>
                            <p className="text-sm text-slate-400">Auditoría de producción · {fmt(pagination.total)} registros</p>
                        </div>
                        <button onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            <Filter size={16} /> Filtros
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar por lote o sabor..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Filters row */}
                    {showFilters && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 animate-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Estado</label>
                                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                                    <option value="">Todos</option>
                                    <option value="PENDING">Pendiente</option>
                                    <option value="STAGE_1_BASE">Etapa 1 — Base</option>
                                    <option value="STAGE_2_COMPUESTO">Etapa 2 — Compuesto</option>
                                    <option value="STAGE_3_ESFERAS">Etapa 3 — Esferas</option>
                                    <option value="STAGE_4_ENSAMBLE">Etapa 4 — Ensamble</option>
                                    <option value="COMPLETED">Completado</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Desde</label>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Hasta</label>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="max-w-7xl mx-auto px-4 pt-4 pb-20">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
                    </div>
                ) : batches.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <Package size={48} className="mx-auto mb-3 opacity-30" />
                        <p className="font-bold">No se encontraron batches</p>
                        <p className="text-sm">Ajusta los filtros o busca por otro término</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-xs font-bold text-slate-400 uppercase">
                                        <th className="text-left px-4 py-3">Lote</th>
                                        <th className="text-left px-4 py-3">Sabor</th>
                                        <th className="text-center px-4 py-3">Estado</th>
                                        <th className="text-center px-4 py-3">Inicio</th>
                                        <th className="text-center px-4 py-3">Duración</th>
                                        <th className="text-right px-4 py-3">Producido</th>
                                        <th className="text-center px-4 py-3">Uds</th>
                                        <th className="text-center px-4 py-3">Defect.</th>
                                        <th className="text-center px-4 py-3">Efect.</th>
                                        <th className="text-center px-4 py-3">Etapas</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {batches.map(b => (
                                        <tr key={b.id} onClick={() => openDetail(b.id)}
                                            className="hover:bg-blue-50/50 cursor-pointer transition-colors">
                                            <td className="px-4 py-3 font-bold text-blue-600 whitespace-nowrap">{b.batchNumber}</td>
                                            <td className="px-4 py-3 text-slate-700">{b.flavor || '—'}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${statusColors[b.status] || statusColors.PENDING}`}>
                                                    {b.status?.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-500 whitespace-nowrap">{fmtDate(b.startedAt)}</td>
                                            <td className="px-4 py-3 text-center text-slate-500">{fmtDuration(b.durationMinutes)}</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(b.actualOutput || b.expectedOutput)} g</td>
                                            <td className="px-4 py-3 text-center text-slate-600">{b.unitsActual || '—'}</td>
                                            <td className="px-4 py-3 text-center">
                                                {b.unitsDefective > 0
                                                    ? <span className="text-rose-600 font-bold">{b.unitsDefective}</span>
                                                    : <span className="text-slate-300">0</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {b.effectiveness != null
                                                    ? <span className={`font-bold ${b.effectiveness >= 95 ? 'text-emerald-600' : b.effectiveness >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                        {b.effectiveness}%
                                                    </span>
                                                    : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-500">{b.stagesCompleted}/{b.stagesTotal}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="lg:hidden space-y-3">
                            {batches.map(b => (
                                <div key={b.id} onClick={() => openDetail(b.id)}
                                    className="bg-white rounded-2xl border border-slate-200 p-4 active:bg-blue-50 transition-colors cursor-pointer shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <div className="font-black text-blue-600">{b.batchNumber}</div>
                                            <div className="text-xs text-slate-400">{b.flavor}</div>
                                        </div>
                                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusColors[b.status] || statusColors.PENDING}`}>
                                            {b.status?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center mt-3">
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Producido</div>
                                            <div className="text-sm font-bold text-slate-700">{fmt(b.actualOutput || b.expectedOutput)}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Uds</div>
                                            <div className="text-sm font-bold text-slate-700">{b.unitsActual || '—'}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Efect.</div>
                                            <div className={`text-sm font-bold ${b.effectiveness >= 95 ? 'text-emerald-600' : b.effectiveness >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                {b.effectiveness != null ? `${b.effectiveness}%` : '—'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {pagination.totalPages > 1 && (
                            <div className="flex justify-center items-center gap-3 mt-6">
                                <button disabled={pagination.page <= 1} onClick={() => fetchBatches(pagination.page - 1)}
                                    className="p-2 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                                    <ChevronLeft size={18} />
                                </button>
                                <span className="text-sm text-slate-500">
                                    Página <span className="font-bold text-slate-700">{pagination.page}</span> de {pagination.totalPages}
                                </span>
                                <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchBatches(pagination.page + 1)}
                                    className="p-2 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

/* ════════════════════════════════════════════════════════════════════════════
   Sub-components
   ════════════════════════════════════════════════════════════════════════════ */

const KpiCard = ({ label, value, icon, color = 'blue' }) => {
    const colors = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
        rose: 'bg-rose-50 text-rose-700 border-rose-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
    };
    return (
        <div className={`rounded-2xl p-3 text-center border ${colors[color] || colors.blue}`}>
            <div className="flex items-center justify-center gap-1 text-xs font-bold uppercase opacity-60 mb-1">
                {icon} {label}
            </div>
            <div className="text-xl font-black">{value}</div>
        </div>
    );
};

const InfoItem = ({ label, value }) => (
    <div>
        <div className="text-xs font-bold text-slate-400 uppercase">{label}</div>
        <div className="text-sm font-semibold text-slate-700">{value}</div>
    </div>
);

const TimelineCard = ({ stage, index }) => {
    const [expanded, setExpanded] = useState(index < 3); // auto-expand first 3

    return (
        <div className="relative">
            {/* Dot on timeline */}
            <div className="absolute -left-8 top-4 z-10">{noteStatusIcon(stage.status)}</div>

            <div className={`bg-white rounded-2xl border overflow-hidden shadow-sm transition-all ${stage.status === 'COMPLETED' ? 'border-emerald-200' : stage.status === 'EXECUTING' ? 'border-blue-300' : 'border-slate-200'}`}>
                {/* Header — always visible */}
                <button onClick={() => setExpanded(!expanded)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-300 w-6">{stage.stageOrder}.</span>
                        <div>
                            <div className="font-bold text-sm text-slate-800">{stage.stageName}</div>
                            <div className="text-xs text-slate-400">
                                {stage.processTypeName}
                                {stage.operator && <> · <User size={12} className="inline" /> {stage.operator}</>}
                                {stage.durationMinutes != null && <> · <Clock size={12} className="inline" /> {fmtDuration(stage.durationMinutes)}</>}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {stage.actualQuantity > 0 && (
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                {fmt(stage.actualQuantity)} {stage.processType === 'CONTEO' ? 'uds' : 'g'}
                            </span>
                        )}
                        <ChevronRight size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </div>
                </button>

                {/* Expanded content */}
                {expanded && (
                    <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/30">
                        {/* Times */}
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                            {stage.startedAt && <span>📍 Inicio: <strong>{fmtDateTime(stage.startedAt)}</strong></span>}
                            {stage.completedAt && <span>🏁 Fin: <strong>{fmtDateTime(stage.completedAt)}</strong></span>}
                            {stage.targetQuantity > 0 && <span>🎯 Meta: <strong>{fmt(stage.targetQuantity)}</strong></span>}
                        </div>

                        {/* Ingredients */}
                        {stage.ingredients?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Ingredientes</div>
                                <div className="space-y-1.5">
                                    {stage.ingredients.map((ing, i) => (
                                        <div key={i} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs">
                                            <div>
                                                <span className="font-semibold text-slate-700">{ing.name}</span>
                                                {ing.lotNumber && (
                                                    <span className="ml-2 text-slate-400 font-mono text-[10px]">{ing.lotNumber}</span>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <span className="font-bold text-blue-600">{fmt(ing.actualQuantity || ing.plannedQuantity)} {ing.unit}</span>
                                                {ing.actualQuantity && ing.plannedQuantity && ing.actualQuantity !== ing.plannedQuantity && (
                                                    <span className="ml-1 text-slate-400">/ {fmt(ing.plannedQuantity)} plan</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Lot consumptions */}
                        {stage.lotConsumptions?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Consumo de Lotes</div>
                                <div className="space-y-1.5">
                                    {stage.lotConsumptions.map((lc, i) => (
                                        <div key={i} className="flex justify-between items-center bg-amber-50/50 rounded-lg px-3 py-2 border border-amber-100 text-xs">
                                            <div>
                                                <span className="font-semibold text-slate-700">{lc.product}</span>
                                                <span className="ml-2 font-mono text-slate-400 text-[10px]">{lc.lotNumber}</span>
                                                {lc.expiresAt && (
                                                    <span className={`ml-2 text-[10px] ${new Date(lc.expiresAt) < new Date() ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                                                        Vence: {fmtDate(lc.expiresAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="font-bold text-amber-700">{fmt(lc.quantityUsed)} g</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Conteo breakdown */}
                        {stage.processType === 'CONTEO' && stage.processParameters?.conteo && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Conteo por Referencia</div>
                                <div className="space-y-1.5">
                                    {Object.entries(stage.processParameters.conteo).map(([name, data]) => (
                                        <div key={name} className="flex justify-between items-center bg-cyan-50/50 rounded-lg px-3 py-2 border border-cyan-100 text-xs">
                                            <span className="font-semibold text-slate-700">{name}</span>
                                            <div className="flex gap-3">
                                                <span className="text-slate-400">Plan: {fmt(data.planned)}</span>
                                                <span className="font-bold text-cyan-700">Real: {fmt(data.actual)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empaque data */}
                        {stage.processType === 'EMPAQUE' && stage.processParameters?.empaque && (
                            <div className="flex gap-4">
                                <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Conteo</div>
                                    <div className="font-bold text-emerald-700 text-lg">{fmt(stage.processParameters.empaque.conteo_qty)}</div>
                                </div>
                                <div className="bg-rose-50 rounded-lg px-3 py-2 border border-rose-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Defectuosos</div>
                                    <div className="font-bold text-rose-700 text-lg">{fmt(stage.processParameters.empaque.defective)}</div>
                                </div>
                                <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Aprobados</div>
                                    <div className="font-bold text-blue-700 text-lg">{fmt(stage.processParameters.empaque.approved)}</div>
                                </div>
                            </div>
                        )}

                        {/* Process variables */}
                        {stage.processVariables?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Variables de Proceso</div>
                                <div className="flex flex-wrap gap-2">
                                    {stage.processVariables.map((pv, i) => (
                                        <span key={i} className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full border border-indigo-100">
                                            {pv.name}: {pv.value} {pv.unit}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quality Checks */}
                        {stage.qualityChecks?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Control de Calidad</div>
                                <div className="space-y-1.5">
                                    {stage.qualityChecks.map((qc, i) => (
                                        <div key={i} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs">
                                            <span className="font-semibold text-slate-700">{qc.parameterName}</span>
                                            <span className={`font-bold ${qc.passed ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {qc.value} {qc.unit} {qc.passed ? '✅' : '❌'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Observations */}
                        {stage.observations && (
                            <div className="text-xs text-slate-500 bg-white rounded-lg p-3 border border-slate-100 italic">
                                💬 {stage.observations}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BatchHistoryPage;
