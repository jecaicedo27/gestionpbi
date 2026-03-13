import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RefreshCw, Play, RotateCcw, CheckCircle, Clock, Layers, ChevronRight, Timer, Factory, Warehouse } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDuration = (ms) => {
    if (!ms || ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const fmtTime = (dateStr) => {
    if (!dateStr) return null;
    return format(new Date(dateStr), 'HH:mm');
};

// ─── Live Elapsed Timer ───────────────────────────────────────────────────────
const LiveTimer = ({ startedAt, className = '' }) => {
    const [elapsed, setElapsed] = useState('');
    useEffect(() => {
        if (!startedAt) return;
        const tick = () => {
            const ms = Date.now() - new Date(startedAt).getTime();
            setElapsed(fmtDuration(ms) || '0s');
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [startedAt]);
    return <span className={className}>{elapsed}</span>;
};

// ─── Compact Progress Bar with stage dots ─────────────────────────────────────
const StageProgress = ({ notes }) => {
    const total = notes.length;
    const completed = notes.filter(n => n.status === 'COMPLETED').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="w-full">
            {/* Progress track */}
            <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {/* Dot indicators */}
            <div className="flex items-center mt-1.5 gap-0.5">
                {notes.map((n, i) => {
                    const isDone = n.status === 'COMPLETED';
                    const isRunning = n.status === 'EXECUTING';
                    return (
                        <div
                            key={i}
                            className="flex-1 h-1 rounded-full"
                            style={{
                                background: isDone ? '#334155' : isRunning ? '#3b82f6' : '#e2e8f0',
                                boxShadow: isRunning ? '0 0 4px rgba(59,130,246,.6)' : 'none'
                            }}
                            title={`${i + 1}. ${n.stageName || ''} (${n.status})`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

// ─── Batch Card (Redesigned) ──────────────────────────────────────────────────
const BatchCard = ({ batch, onStart }) => {
    const [showSummary, setShowSummary] = useState(false);
    const isDone = batch.allDone;
    const isStarted = batch.completed > 0;
    const isRunning = batch.inProgress;
    const progressPct = batch.total > 0 ? Math.round((batch.completed / batch.total) * 100) : 0;

    const currentStage = batch.notes.find(n => n.status === 'EXECUTING');
    const currentStageName = currentStage?.stageName
        ?.replace(/Ensamble Siigo\s*/i, 'Ens. ')
        .replace(/Pesaje de\s*/i, '')
        .replace(/Formación de\s*/i, 'Form. ')
        .replace(/Empaque\s*/i, 'Emp. ')
        .replace(/Conteo de\s*/i, 'Conteo ')
        .trim()
        .slice(0, 30);

    const batchStartedAt = batch.notes
        .filter(n => n.startedAt)
        .map(n => new Date(n.startedAt))
        .sort((a, b) => a - b)[0] || null;

    const batchCompletedAt = isDone
        ? batch.notes.filter(n => n.completedAt).map(n => new Date(n.completedAt)).sort((a, b) => b - a)[0] || null
        : null;

    // ── Build radiography data for completed batches ──
    const ingredients = [];
    if (isDone) {
        const seen = new Set();
        for (const note of batch.notes) {
            for (const item of (note.items || [])) {
                const name = item.component?.name || item.componentId;
                const key = `${name}-${item.plannedQuantity}`;
                if (seen.has(key)) continue;
                seen.add(key);
                ingredients.push({
                    name,
                    planned: item.plannedQuantity,
                    actual: item.actualQuantity,
                    unit: item.unit || 'g',
                });
            }
        }
    }
    // Total produced weight = sum of all ingredient quantities
    const totalWeight = ingredients.reduce((sum, ing) => sum + (Number(ing.actual) || Number(ing.planned) || 0), 0);
    // Number of lots from note metadata
    const numLots = isDone ? (batch.notes[0]?.repeatTotal || batch.notes.filter(n => (n.processType?.code || '').includes('PESAJE')).length || null) : null;

    // Card accent
    const accent = isDone
        ? { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
        : isRunning
            ? { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' }
            : { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-500', dot: 'bg-slate-300' };

    return (
        <div className={`bg-white rounded-2xl border ${accent.border} overflow-hidden transition-all hover:shadow-lg group`}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>

            {/* Top section */}
            <div className="p-5 pb-3">
                {/* Status badge + time */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${accent.dot} ${isRunning ? 'animate-pulse' : ''}`} />
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${accent.text}`}>
                            {isDone ? '✓ Completado' : isRunning ? 'En Proceso' : 'Pendiente'}
                        </span>
                    </div>
                    {batchStartedAt && !isDone && (
                        <div className="flex items-center gap-1 text-[11px] text-blue-500 font-semibold">
                            <Timer size={10} />
                            <LiveTimer startedAt={batchStartedAt} />
                        </div>
                    )}
                    {isDone && batchStartedAt && batchCompletedAt && (
                        <span className="text-[11px] text-emerald-600 font-semibold">
                            ⏱ {fmtDuration(batchCompletedAt - batchStartedAt)}
                        </span>
                    )}
                    {!isDone && batch.scheduledStart && (
                        <span className="text-[11px] text-slate-400">
                            Prog. {fmtTime(batch.scheduledStart)}
                        </span>
                    )}
                </div>

                {/* Product name */}
                <h3 className="text-lg font-extrabold text-slate-800 leading-tight mb-0.5">
                    {batch.productName}
                </h3>
                <div className="text-xs text-slate-400 font-mono tracking-tight">
                    {batch.batchNumber}
                </div>

                {/* Current stage label */}
                {currentStageName && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1">
                        <Play size={10} className="fill-blue-500 text-blue-500" />
                        {currentStageName}
                    </div>
                )}
            </div>

            {/* Progress section */}
            <div className="px-5 pb-3">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-slate-400 font-medium">
                        {batch.completed}/{batch.total} etapas
                    </span>
                    <span className={`text-sm font-bold ${isDone ? 'text-emerald-600' : isRunning ? 'text-blue-600' : 'text-slate-400'}`}>
                        {progressPct}%
                    </span>
                </div>
                <StageProgress notes={batch.notes} />
            </div>

            {/* ── Completed: Radiography summary ── */}
            {isDone && (
                <div className="px-5 pb-3">
                    {/* Always visible: start/end times */}
                    {batchStartedAt && batchCompletedAt && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                            <span>🕐 <b className="text-slate-700">{fmtTime(batchStartedAt)}</b></span>
                            <span className="text-slate-300">→</span>
                            <span>🏁 <b className="text-slate-700">{fmtTime(batchCompletedAt)}</b></span>
                            <span className="ml-auto font-bold text-emerald-600">
                                ⏱ {fmtDuration(batchCompletedAt - batchStartedAt)}
                            </span>
                        </div>
                    )}

                    {ingredients.length > 0 && (
                        <>
                            <button
                                onClick={() => setShowSummary(!showSummary)}
                                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-500 hover:text-slate-700 py-1.5 transition-colors"
                            >
                                <span>📋 Resumen de producción</span>
                                <span style={{ transform: showSummary ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>▼</span>
                            </button>

                            {showSummary && (
                                <div className="mt-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs space-y-2.5">
                                    {/* What was produced */}
                                    <div>
                                        <div className="font-bold text-emerald-700 mb-1 flex items-center gap-1">
                                            📦 Producido
                                        </div>
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-slate-700">{batch.productName}</div>
                                                <div className="text-slate-500 font-mono text-[10px]">Lote: {batch.batchNumber}</div>
                                            </div>
                                            <div className="text-right">
                                                {totalWeight > 0 && (
                                                    <div className="text-lg font-extrabold text-emerald-700">
                                                        {totalWeight >= 1000
                                                            ? `${(totalWeight / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg`
                                                            : `${totalWeight.toLocaleString('es-CO')} g`
                                                        }
                                                    </div>
                                                )}
                                                {numLots && numLots > 1 && (
                                                    <div className="text-[10px] text-emerald-600 font-semibold">{numLots} lotes</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Ingredients used */}
                                    <div>
                                        <div className="font-bold text-slate-600 mb-1 flex items-center gap-1">
                                            🧪 Ingredientes consumidos
                                        </div>
                                        <div className="space-y-1">
                                            {ingredients.map((ing, i) => (
                                                <div key={i} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                                                    <span className="text-slate-700 truncate" style={{ maxWidth: '60%' }}>{ing.name}</span>
                                                    <span className="font-mono font-semibold text-slate-500 flex-shrink-0">
                                                        {ing.actual != null
                                                            ? <>{Number(ing.actual).toLocaleString('es-CO')} <span className="text-slate-400">{ing.unit}</span></>
                                                            : <>{Number(ing.planned).toLocaleString('es-CO')} <span className="text-slate-400">{ing.unit}</span></>
                                                        }
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* CTA */}
            {!isDone ? (
                <button
                    onClick={() => onStart(batch)}
                    className="w-full py-3 flex items-center justify-center gap-2 font-bold text-sm bg-slate-800 hover:bg-slate-900 text-white transition-colors group-hover:bg-blue-600">
                    {isStarted ? <RotateCcw size={14} /> : <Play size={14} />}
                    {isStarted ? 'Continuar proceso' : 'Iniciar proceso'}
                    <ChevronRight size={14} className="ml-1 opacity-50" />
                </button>
            ) : (
                <div className="w-full py-2.5 bg-emerald-50 flex items-center justify-center gap-2 text-emerald-600 text-xs font-semibold border-t border-emerald-100">
                    <CheckCircle size={14} /> Finalizado
                </div>
            )}
        </div>
    );
};

// ─── Main Page ─────────────────────────────────────────────────────────────
const ProductionOperatorPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [batches, setBatches] = useState([]);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState('active');

    const fetchData = useCallback(async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
            const res = await api.get('/assembly-notes');
            const notes = res.data || [];

            const batchMap = {};
            for (const note of notes) {
                const bId = note.productionBatchId;
                if (!bId) continue;
                if (!batchMap[bId]) {
                    batchMap[bId] = {
                        id: bId,
                        batchNumber: note.productionBatch?.batchNumber || bId.slice(0, 8),
                        productName: note.product?.name || 'Producto',
                        scheduledStart: note.productionBatch?.scheduledStart,
                        status: note.productionBatch?.status,
                        notes: []
                    };
                }
                batchMap[bId].notes.push(note);
            }

            const batchList = Object.values(batchMap)
                .map(b => {
                    b.notes.sort((a, c) => (a.stageOrder || 0) - (c.stageOrder || 0));
                    b.completed = b.notes.filter(n => n.status === 'COMPLETED').length;
                    b.total = b.notes.length;
                    b.allDone = b.completed === b.total;
                    b.inProgress = b.notes.some(n => n.status === 'EXECUTING');
                    b.firstPending = b.notes.find(n => n.status !== 'COMPLETED');
                    return b;
                })
                .sort((a, c) => {
                    if (a.allDone !== c.allDone) return a.allDone ? 1 : -1;
                    if (a.inProgress !== c.inProgress) return a.inProgress ? -1 : 1;
                    return new Date(c.scheduledStart || 0) - new Date(a.scheduledStart || 0);
                });

            setBatches(batchList);
            setLastRefresh(new Date());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(), 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleStart = (batch) => {
        if (batch.firstPending) navigate(`/assembly-execution/${batch.firstPending.id}`);
    };

    const total = batches.length;
    const inProgress = batches.filter(b => !b.allDone && b.completed > 0).length;
    const completedCount = batches.filter(b => b.allDone).length;
    const pending = batches.filter(b => b.completed === 0 && !b.allDone).length;

    const activeBatches = batches.filter(b => !b.allDone);
    const completedBatches = batches.filter(b => b.allDone);

    const stats = [
        { label: 'Total', value: total, icon: Factory, color: 'text-slate-700', bg: 'bg-white', border: 'border-slate-200' },
        { label: 'En Proceso', value: inProgress, icon: Play, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
        { label: 'Pendientes', value: pending, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
        { label: 'Completados', value: completedCount, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    ];

    const tabs = [
        { key: 'active', label: 'En curso', count: activeBatches.length, icon: '⚡' },
        { key: 'completed', label: 'Completados', count: completedBatches.length, icon: '✅' },
    ];

    const visibleBatches = activeTab === 'active' ? activeBatches : completedBatches;

    return (
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #f0f4ff 100%)' }}>
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-6 py-5 sticky top-0 z-10">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-2.5 mb-0.5">
                                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                                    <Layers size={16} className="text-white" />
                                </div>
                                <h1 className="text-xl font-extrabold text-slate-800">Panel de Producción</h1>
                            </div>
                            <p className="text-xs text-slate-400 capitalize ml-11">
                                {format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => navigate('/production/zone')}
                                className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-900 font-semibold px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors border border-indigo-200 bg-indigo-50">
                                <Warehouse size={13} />
                                Zona
                            </button>
                            <button
                                onClick={() => fetchData(true)}
                                disabled={refreshing}
                                className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 font-semibold px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200">
                                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                                Actualizar
                            </button>
                        </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-3">
                        {stats.map(s => (
                            <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl px-4 py-3 flex items-center gap-3`}>
                                <s.icon size={18} className={`${s.color} opacity-60`} />
                                <div>
                                    <div className={`text-2xl font-extrabold leading-none ${s.color}`}>{s.value}</div>
                                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">{s.label}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1 ml-1">
                        <Clock size={9} />
                        {format(lastRefresh, 'HH:mm:ss')} · auto-refresh 30s
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="px-6 py-6">
                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                padding: '0.6rem 1.25rem',
                                borderRadius: 10,
                                border: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                                background: activeTab === tab.key ? '#eff6ff' : '#fff',
                                color: activeTab === tab.key ? '#1e40af' : '#64748b',
                                fontWeight: 700,
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all .2s',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                            }}
                        >
                            <span>{tab.icon}</span>
                            {tab.label}
                            <span style={{
                                background: activeTab === tab.key ? '#3b82f6' : '#e2e8f0',
                                color: activeTab === tab.key ? '#fff' : '#64748b',
                                borderRadius: 20,
                                padding: '0.1rem 0.55rem',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                minWidth: 22,
                                textAlign: 'center',
                            }}>{tab.count}</span>
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
                        <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        <span className="text-sm">Cargando procesos...</span>
                    </div>
                ) : visibleBatches.length === 0 ? (
                    <div className="text-center py-24 text-slate-400">
                        <div className="text-5xl mb-3">{activeTab === 'active' ? '🎉' : '📋'}</div>
                        <div className="font-semibold text-slate-500 mb-1">
                            {activeTab === 'active' ? 'Sin procesos pendientes' : 'Sin procesos completados'}
                        </div>
                        <div className="text-sm">
                            {activeTab === 'active' ? '¡Todo está al día!' : 'Aún no se ha completado ningún proceso hoy.'}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {visibleBatches.map(batch => (
                            <BatchCard key={batch.id} batch={batch} onStart={handleStart} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductionOperatorPage;
