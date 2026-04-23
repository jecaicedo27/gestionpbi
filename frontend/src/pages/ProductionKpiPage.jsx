import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RefreshCw, Clock, TrendingUp, TrendingDown, AlertTriangle, Star, ChevronUp, ChevronDown, Minus, Beaker } from 'lucide-react';

const fmtCOP = (v) => v != null ? `$${Number(v).toLocaleString('es-CO')}` : '—';
const fmtKg = (g) => g != null ? `${(g / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg` : '—';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtMin = (v) => {
    if (v == null) return '—';
    if (v < 60) return `${v}m`;
    const h = Math.floor(v / 60), m = Math.round(v % 60);
    return `${h}h ${m}m`;
};

const ScoreBar = ({ value, max = 100 }) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs font-bold w-8 text-right ${pct >= 70 ? 'text-emerald-600' : pct >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                {Math.round(pct)}
            </span>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const ProductionKpiPage = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [days, setDays] = useState(30);
    const [lineFilter, setLineFilter] = useState('all'); // all, liquipops, geniality
    const [sortKey, setSortKey] = useState('overallScore');
    const [sortDir, setSortDir] = useState('desc');
    const [adherenceData, setAdherenceData] = useState(null);
    const [shiftPage, setShiftPage] = useState(0);
    const [expandedShift, setExpandedShift] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [res, adhRes] = await Promise.all([
                api.get(`/production-kpis?days=${days}&line=${lineFilter}`),
                api.get(`/production-kpis/schedule-adherence?days=${days}&line=${lineFilter}`)
            ]);
            setData(res.data);
            setAdherenceData(adhRes.data);
        } catch (e) {
            setError(e.response?.data?.error || 'Error cargando KPIs');
        } finally {
            setLoading(false);
        }
    }, [days, lineFilter]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ k }) => {
        if (sortKey !== k) return <Minus size={12} className="text-slate-300" />;
        return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
    };

    const operatorsSorted = (data?.operatorKpis || []).slice().sort((a, b) => {
        const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
        return sortDir === 'asc' ? va - vb : vb - va;
    });

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">KPIs de Producción</h1>
                        <p className="text-sm text-slate-400 capitalize mt-0.5">
                            {format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Line Filter */}
                        <div className="flex bg-slate-100 p-1 rounded-lg text-sm font-medium">
                            {['all', 'liquipops', 'geniality'].map(l => (
                                <button key={l}
                                    onClick={() => setLineFilter(l)}
                                    className={`px-3 py-1.5 rounded-md capitalize transition-colors ${lineFilter === l ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                                    {l === 'all' ? 'Global' : l}
                                </button>
                            ))}
                        </div>
                        {/* Period selector */}
                        <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm font-medium">
                            {[7, 30, 90].map(d => (
                                <button key={d}
                                    onClick={() => setDays(d)}
                                    className={`px-4 py-2 transition-colors ${days === d ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                                    {d}d
                                </button>
                            ))}
                        </div>
                        <button onClick={loadData} disabled={loading}
                            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-medium px-3 py-2 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Summary chips */}
                {data?.summary && (
                    <div className="grid grid-cols-4 gap-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                            <div className="text-2xl font-bold text-slate-800">{data.summary.totalCompleted}</div>
                            <div className="text-xs text-slate-400 mt-0.5">Etapas completadas</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                            <div className="text-2xl font-bold text-blue-600">{fmtMin(data.summary.globalAvgMin)}</div>
                            <div className="text-xs text-slate-400 mt-0.5">Tiempo prom. global</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                            <div className="text-2xl font-bold text-slate-800">{data.summary.empaqueNotes}</div>
                            <div className="text-xs text-slate-400 mt-0.5">Lotes empacados</div>
                        </div>
                        <div className={`border rounded-lg px-4 py-3 ${data.summary.avgDefectivePct > 5 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                            <div className={`text-2xl font-bold ${data.summary.avgDefectivePct > 5 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {data.summary.avgDefectivePct}%
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">Tasa defectos prom.</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-6">
                {loading ? (
                    <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
                        <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        <span className="text-sm">Calculando KPIs...</span>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
                        <AlertTriangle size={16} /> {error}
                    </div>
                ) : !data ? null : (
                    <>
                        {/* ── Schedule Adherence ──────────────────────────────────── */}
                        {adherenceData && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingUp size={15} className="text-indigo-500" />
                                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Adherencia Esferificación</h2>
                                    <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">KPI 50%</span>
                                </div>

                                {/* Summary cards */}
                                <div className="grid grid-cols-5 gap-3 mb-4">
                                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
                                        <div className={`text-2xl font-bold ${(adherenceData.summary.avgAdherence ?? 0) >= 80 ? 'text-emerald-600' : (adherenceData.summary.avgAdherence ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                            {adherenceData.summary.avgAdherence != null ? `${adherenceData.summary.avgAdherence}%` : '—'}
                                        </div>
                                        <div className="text-xs text-slate-400 mt-0.5">Promedio</div>
                                        {adherenceData.summary.avgAdherence != null && (
                                            <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${(adherenceData.summary.avgAdherence ?? 0) >= 80 ? 'bg-emerald-500' : (adherenceData.summary.avgAdherence ?? 0) >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${adherenceData.summary.avgAdherence}%` }} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
                                        <div className="text-2xl font-bold text-slate-800">{adherenceData.summary.totalBatches}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Total baches</div>
                                    </div>
                                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 shadow-sm">
                                        <div className="text-2xl font-bold text-emerald-600">{adherenceData.summary.onTime}</div>
                                        <div className="text-xs text-emerald-500 mt-0.5">A tiempo</div>
                                    </div>
                                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 shadow-sm">
                                        <div className="text-2xl font-bold text-red-600">{adherenceData.summary.delayed}</div>
                                        <div className="text-xs text-red-500 mt-0.5">Retrasados</div>
                                    </div>
                                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 shadow-sm">
                                        <div className="text-2xl font-bold text-blue-600">{adherenceData.summary.inProgress}</div>
                                        <div className="text-xs text-blue-500 mt-0.5">En curso</div>
                                    </div>
                                </div>

                                {/* Batch detail table */}
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Bache</th>
                                                <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Objetivo</th>
                                                <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Esferificación</th>
                                                <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Exceso</th>
                                                <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Score</th>
                                                <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(adherenceData.batches || []).map((b, i) => {
                                                const score = b.adherenceScore ?? b.projectedAdherence ?? null;
                                                const scoreColor = score == null ? 'text-slate-400' : score >= 90 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
                                                const light = b.trafficLight;
                                                const lightColors = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-500' };
                                                return (
                                                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-semibold text-slate-700">{b.flavor || b.batchNumber.split('-').slice(0, -2).join(' ')}</span>
                                                                {b.crossShift && <span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-bold" title={`Inició en turno ${b.startShift} y terminó en ${b.endShift}`}>⇄ 2 turnos</span>}
                                                            </div>
                                                            <div className="text-[10px] text-slate-400">{b.scheduledStart ? format(new Date(b.scheduledStart), 'dd/MM HH:mm') : ''}</div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right text-slate-600">{fmtMin(b.targetDurationMin)}</td>
                                                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{b.actualMin != null ? fmtMin(b.actualMin) : '—'}</td>
                                                        <td className="px-3 py-2 text-right">
                                                            {b.delayMin != null ? (
                                                                <span className={b.delayMin > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                                                                    {b.delayMin > 0 ? `+${fmtMin(b.delayMin)}` : 'OK'}
                                                                </span>
                                                            ) : '—'}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className={`font-bold ${scoreColor}`}>{score != null ? `${score}%` : '—'}</span>
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {b.status === 'completed' ? (
                                                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">Completado</span>
                                                            ) : b.status === 'in_progress' ? (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                                                                    <span className={`w-2 h-2 rounded-full ${lightColors[light] || 'bg-slate-300'}`} />
                                                                    {light === 'green' ? 'A tiempo' : light === 'yellow' ? 'Ajustado' : light === 'red' ? 'Retrasado' : 'Pendiente'}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">Pendiente</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    {(!adherenceData.batches || adherenceData.batches.length === 0) && (
                                        <div className="text-center py-8 text-sm text-slate-400">No hay baches programados en este periodo</div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* ── Shift Completion ──────────────────────────────── */}
                        {adherenceData?.shiftCompletion?.length > 0 && (() => {
                            const SHIFT_ORDER = { MANANA: 0, TARDE: 1, NOCHE: 2 };
                            const sorted = [...adherenceData.shiftCompletion].sort((a, b) => {
                                const dateCmp = b.date.localeCompare(a.date);
                                if (dateCmp !== 0) return dateCmp;
                                return SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift];
                            });
                            const PER_PAGE = 6;
                            const totalPages = Math.ceil(sorted.length / PER_PAGE);
                            const page = shiftPage || 0;
                            const visible = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
                            const target = adherenceData.meta?.shiftBatchTarget || 5;

                            return (
                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp size={15} className="text-amber-500" />
                                        <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Cumplimiento por Turno</h2>
                                        <span className="text-xs text-slate-400">(meta: {target} baches)</span>
                                    </div>
                                    {totalPages > 1 && (
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setShiftPage(Math.max(0, page - 1))} disabled={page === 0}
                                                className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">← Recientes</button>
                                            <span className="text-xs text-slate-400 px-2">{page + 1}/{totalPages}</span>
                                            <button onClick={() => setShiftPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                                                className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">Anteriores →</button>
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {visible.map((s, i) => {
                                        const pct = s.completionPct;
                                        const shiftLabel = s.shift === 'MANANA' ? 'Mañana' : s.shift === 'TARDE' ? 'Tarde' : 'Noche';
                                        const shiftIcon = s.shift === 'MANANA' ? '🌅' : s.shift === 'TARDE' ? '☀️' : '🌙';
                                        const shiftKey = `${s.date}_${s.shift}`;
                                        const isExpanded = expandedShift === shiftKey;
                                        return (
                                            <div key={i} className={`bg-white border rounded-xl shadow-sm cursor-pointer transition-all ${isExpanded ? 'border-blue-400 ring-1 ring-blue-200 col-span-2 md:col-span-3' : 'border-slate-200 hover:border-blue-300'}`}
                                                onClick={() => setExpandedShift(isExpanded ? null : shiftKey)}>
                                                <div className="px-4 py-3">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <div className="text-xs font-semibold text-slate-500">{shiftIcon} {s.date} — {shiftLabel}</div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-lg font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                                                            <ChevronDown size={14} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                        </div>
                                                    </div>
                                                    {s.leader && <div className="text-[10px] text-blue-600 font-semibold mb-0.5">👤 Líder: {s.leader}</div>}
                                                    <div className="text-xs text-slate-400">{s.completed}/{target} batches esferificados</div>
                                                    <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                                    </div>
                                                </div>
                                                {isExpanded && (
                                                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50" onClick={e => e.stopPropagation()}>
                                                        {s.team?.length > 0 && (
                                                            <div className="mb-3">
                                                                <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Equipo Producción</div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {s.team.map((name, ti) => (
                                                                        <span key={ti} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{name}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Baches Esferificados</div>
                                                        {(!s.batches || s.batches.length === 0) ? (
                                                            <div className="text-xs text-slate-400 italic">Sin baches registrados</div>
                                                        ) : (
                                                            <div className="space-y-1.5">
                                                                {s.batches.map((batch, bi) => (
                                                                    <div key={bi} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-slate-100">
                                                                        <div className="flex-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs font-bold text-slate-700">{batch.flavor}</span>
                                                                                <span className="text-[10px] text-slate-400 font-mono">{batch.batchNumber}</span>
                                                                                {batch.inProgress && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold animate-pulse">En progreso</span>}
                                                                            </div>
                                                                            {batch.actualMin != null && <div className="text-[10px] text-slate-400">Duración: {fmtMin(batch.actualMin)}</div>}
                                                                            <div className="text-[10px] text-slate-400">
                                                                                {batch.startedBy && <span>Inició: <span className="font-semibold text-slate-600">{batch.startedBy}</span></span>}
                                                                                {batch.completedByName && batch.completedByName !== batch.startedBy && <span> → Completó: <span className="font-semibold text-slate-600">{batch.completedByName}</span></span>}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            {batch.fractionPct != null && batch.fractionPct < 100 ? (
                                                                                <div>
                                                                                    <div className={`text-sm font-bold ${batch.fractionPct >= 50 ? 'text-blue-600' : 'text-amber-600'}`}>{batch.fractionPct}%</div>
                                                                                    <div className="text-[9px] text-slate-400">{batch.minutes}min de este turno</div>
                                                                                </div>
                                                                            ) : batch.adherenceScore != null ? (
                                                                                <div className={`text-sm font-bold ${batch.adherenceScore >= 90 ? 'text-emerald-600' : batch.adherenceScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                                                                    Score: {batch.adherenceScore}%
                                                                                </div>
                                                                            ) : null}
                                                                        </div>
                                                                        <div className="w-12">
                                                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                                <div className={`h-full rounded-full ${batch.fractionPct >= 100 || batch.fractionPct == null ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                                                                    style={{ width: `${batch.fractionPct ?? 100}%` }} />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Process counts */}
                                                        {s.processCounts && Object.keys(s.processCounts).length > 0 && (() => {
                                                            const PROC_COLORS = {
                                                                PESAJE: 'bg-purple-100 text-purple-700',
                                                                COCCION: 'bg-orange-100 text-orange-700',
                                                                MEZCLADO: 'bg-yellow-100 text-yellow-700',
                                                                PROTECCION_GATE: 'bg-teal-100 text-teal-700',
                                                                FORMACION: 'bg-blue-100 text-blue-700',
                                                                CONTEO: 'bg-indigo-100 text-indigo-700',
                                                                EMPAQUE: 'bg-green-100 text-green-700',
                                                                ENSAMBLE: 'bg-pink-100 text-pink-700',
                                                                G_PESAJE: 'bg-purple-50 text-purple-600',
                                                                G_EMPAQUE: 'bg-green-50 text-green-600',
                                                                G_ENSAMBLE: 'bg-pink-50 text-pink-600',
                                                                G_MEZCLADO: 'bg-yellow-50 text-yellow-600',
                                                                GE_BASE_LIQUIDA: 'bg-cyan-100 text-cyan-700',
                                                                GE_COCCION: 'bg-orange-50 text-orange-600',
                                                                GE_PREMIX: 'bg-lime-100 text-lime-700',
                                                            };
                                                            const PROC_LABELS = {
                                                                PESAJE: 'Pesaje', COCCION: 'Cocción', MEZCLADO: 'Mezclado',
                                                                PROTECCION_GATE: 'Protección', FORMACION: 'Formación',
                                                                CONTEO: 'Conteo', EMPAQUE: 'Empaque', ENSAMBLE: 'Ensamble',
                                                                MEDICION: 'Medición', MAESTRO_PERLAS: 'Maestro',
                                                                G_PESAJE: 'Pesaje (G)', G_EMPAQUE: 'Empaque (G)', G_ENSAMBLE: 'Ensamble (G)',
                                                                G_MEZCLADO: 'Mezclado (G)', GE_BASE_LIQUIDA: 'Base Líquida (G)',
                                                                GE_COCCION: 'Cocción (G)', GE_PREMIX: 'Premix (G)',
                                                            };
                                                            const ORDER = ['PESAJE', 'COCCION', 'MEZCLADO', 'PROTECCION_GATE', 'FORMACION', 'CONTEO', 'EMPAQUE', 'ENSAMBLE', 'G_PESAJE', 'G_MEZCLADO', 'G_EMPAQUE', 'G_ENSAMBLE', 'GE_BASE_LIQUIDA', 'GE_COCCION', 'GE_PREMIX'];
                                                            const entries = Object.entries(s.processCounts).sort((a, b) => {
                                                                const ai = ORDER.indexOf(a[0]), bi = ORDER.indexOf(b[0]);
                                                                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                                                            });
                                                            return (
                                                                <div className="mt-3">
                                                                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Procesos completados este turno</div>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {entries.map(([code, count]) => (
                                                                            <span key={code} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PROC_COLORS[code] || 'bg-slate-100 text-slate-600'}`}>
                                                                                {PROC_LABELS[code] || code}: {count}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Key material stock */}
                                                        {(() => {
                                                            if (!adherenceData.keyMaterialStock?.length) return null;
                                                            const THRESHOLDS = {
                                                                'PROCELIQUIPOPS27': { green: 300000, yellow: 150000 },
                                                                'PROCELIQUIPOPS43': { green: 30000, yellow: 15000 },
                                                                'PROCELIQUIPOPS26': { green: 30000, yellow: 15000 },
                                                                'PROCELIQUIPOPS01': { green: 50000, yellow: 25000 },
                                                            };
                                                            const SHORT_NAMES = {
                                                                'PROCELIQUIPOPS27': 'Alginato',
                                                                'PROCELIQUIPOPS43': 'Fructosa',
                                                                'PROCELIQUIPOPS26': 'Glucosa',
                                                                'PROCELIQUIPOPS01': 'Base Liquipops',
                                                            };
                                                            return (
                                                                <div className="mt-3">
                                                                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Insumos intermedios (stock actual)</div>
                                                                    <div className="grid grid-cols-2 gap-1.5">
                                                                        {adherenceData.keyMaterialStock.map(m => {
                                                                            const thresh = THRESHOLDS[m.sku] || { green: 50000, yellow: 20000 };
                                                                            const stock = m.productionZoneStock || 0;
                                                                            const stockKg = (stock / 1000).toFixed(1);
                                                                            const colorCls = stock >= thresh.green ? 'border-emerald-300 bg-emerald-50'
                                                                                : stock >= thresh.yellow ? 'border-amber-300 bg-amber-50'
                                                                                : 'border-red-300 bg-red-50';
                                                                            const textCls = stock >= thresh.green ? 'text-emerald-700'
                                                                                : stock >= thresh.yellow ? 'text-amber-700' : 'text-red-700';
                                                                            return (
                                                                                <div key={m.sku} className={`border rounded-lg px-2.5 py-1.5 ${colorCls}`}>
                                                                                    <div className="text-[9px] font-semibold text-slate-600">{SHORT_NAMES[m.sku] || m.name}</div>
                                                                                    <div className={`text-sm font-bold ${textCls}`}>{stockKg} kg</div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                            );
                        })()}

                        {/* ── Time KPIs per process ──────────────────────────────── */}
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <Clock size={15} className="text-slate-400" />
                                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Tiempo por tipo de proceso</h2>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 bg-slate-50">
                                            <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Proceso</th>
                                            <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Etapas</th>
                                            <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Promedio</th>
                                            <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Mínimo</th>
                                            <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Máximo</th>
                                            <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Variabilidad</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.timeKpis.length === 0 ? (
                                            <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">Sin datos en el período seleccionado</td></tr>
                                        ) : data.timeKpis.map((row, i) => (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                <td className="px-5 py-3.5 font-semibold text-slate-700">{row.process_type}</td>
                                                <td className="px-4 py-3.5 text-center text-slate-500">{row.total}</td>
                                                <td className="px-4 py-3.5 text-center font-bold text-blue-600">{fmtMin(row.avg_min)}</td>
                                                <td className="px-4 py-3.5 text-center text-emerald-600 font-medium">{fmtMin(row.min_min)}</td>
                                                <td className="px-4 py-3.5 text-center text-slate-500">{fmtMin(row.max_min)}</td>
                                                <td className="px-4 py-3.5 text-center text-slate-400 text-xs">{row.std_min != null ? `±${row.std_min}m` : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        {/* ── Operator Ranking ───────────────────────────────────── */}
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <Star size={15} className="text-slate-400" />
                                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Ranking de operarios</h2>
                                <span className="text-xs text-slate-400 ml-1">(velocidad 40% + calidad 60%)</span>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 bg-slate-50">
                                            <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Operario</th>
                                            <th className="text-center px-3 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('totalNotes')}>
                                                <div className="flex items-center justify-center gap-1">Etapas <SortIcon k="totalNotes" /></div>
                                            </th>
                                            <th className="text-center px-3 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('avgDurationMin')}>
                                                <div className="flex items-center justify-center gap-1">T. Prom <SortIcon k="avgDurationMin" /></div>
                                            </th>
                                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('speedScore')}>
                                                <div className="flex items-center gap-1">Score Velocidad <SortIcon k="speedScore" /></div>
                                            </th>
                                            <th className="text-center px-3 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('avgDefectivePct')}>
                                                <div className="flex items-center justify-center gap-1">Defectos% <SortIcon k="avgDefectivePct" /></div>
                                            </th>
                                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('qualityScore')}>
                                                <div className="flex items-center gap-1">Score Calidad <SortIcon k="qualityScore" /></div>
                                            </th>
                                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700" onClick={() => handleSort('overallScore')}>
                                                <div className="flex items-center gap-1">Score Global <SortIcon k="overallScore" /></div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {operatorsSorted.length === 0 ? (
                                            <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-sm">Sin operarios con datos en el período</td></tr>
                                        ) : operatorsSorted.map((op, i) => (
                                            <tr key={op.operatorId} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                <td className="px-5 py-3.5">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-700/70' : 'bg-slate-200 text-slate-500'}`}>
                                                            {i + 1}
                                                        </div>
                                                        <span className="font-semibold text-slate-700">{op.operatorName}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3.5 text-center text-slate-500">{op.totalNotes}</td>
                                                <td className="px-3 py-3.5 text-center font-medium text-blue-600">{fmtMin(op.avgDurationMin)}</td>
                                                <td className="px-4 py-3.5 min-w-[120px]">
                                                    {op.speedScore != null ? <ScoreBar value={op.speedScore} /> : <span className="text-slate-300 text-xs">—</span>}
                                                </td>
                                                <td className="px-3 py-3.5 text-center">
                                                    {op.avgDefectivePct != null
                                                        ? <span className={`font-medium ${op.avgDefectivePct > 5 ? 'text-red-600' : op.avgDefectivePct > 2 ? 'text-amber-600' : 'text-emerald-600'}`}>{op.avgDefectivePct}%</span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 min-w-[120px]">
                                                    {op.qualityScore != null ? <ScoreBar value={op.qualityScore} /> : <span className="text-slate-300 text-xs">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 min-w-[120px]">
                                                    {op.overallScore != null ? <ScoreBar value={op.overallScore} /> : <span className="text-slate-300 text-xs">—</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        {/* ── Filling Efficiency KPI (Geniality) ─────────────────── */}
                        {lineFilter !== 'liquipops' && data.fillingKpis?.batches?.length > 0 && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingDown size={15} className="text-violet-400" />
                                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Eficiencia de Llenado — Geniality</h2>
                                    <span className="text-xs text-slate-400 ml-1">(saborizacion consumida vs. fórmula)</span>
                                </div>

                                {/* Summary chips */}
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
                                    <div className="bg-violet-50 border border-violet-100 rounded-lg px-4 py-3">
                                        <div className="text-2xl font-bold text-violet-700">{data.fillingKpis.summary.batchCount}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Batches analizados</div>
                                    </div>
                                    <div className={`border rounded-lg px-4 py-3 ${
                                        data.fillingKpis.summary.avgMermaPct <= 5 ? 'bg-emerald-50 border-emerald-200' :
                                        data.fillingKpis.summary.avgMermaPct <= 10 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
                                    }`}>
                                        <div className={`text-2xl font-bold ${
                                            data.fillingKpis.summary.avgMermaPct <= 5 ? 'text-emerald-600' :
                                            data.fillingKpis.summary.avgMermaPct <= 10 ? 'text-amber-600' : 'text-rose-600'
                                        }`}>{data.fillingKpis.summary.avgMermaPct}%</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Merma promedio</div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                                        <div className="text-2xl font-bold text-slate-700">{fmtKg(data.fillingKpis.summary.totalMermaG)}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Merma acumulada</div>
                                    </div>

                                    {(() => {
                                        const lossDaño = data.fillingKpis.batches.reduce((sum, r) => sum + (r.lostMoney || 0), 0);
                                        return (
                                            <div className="bg-rose-50/50 border border-rose-200 rounded-lg px-4 py-3">
                                                <div className="text-lg font-bold text-rose-600">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(lossDaño)}</div>
                                                <div className="text-xs text-rose-400 mt-0.5 font-medium">Perdid. No Conformes</div>
                                            </div>
                                        );
                                    })()}
                                    
                                    {(() => {
                                        const lossMerma = data.fillingKpis.batches.reduce((sum, r) => sum + (r.mermaLostMoney || 0), 0);
                                        return (
                                            <div className="bg-rose-50/50 border border-rose-200 rounded-lg px-4 py-3">
                                                <div className="text-lg font-bold text-rose-600">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(lossMerma)}</div>
                                                <div className="text-xs text-rose-400 mt-0.5 font-medium">Perdid. Merma Exceso</div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Per-batch table */}
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50">
                                                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Batch</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Uds Planeadas</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Uds Reales</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Dañados</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Producidas (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Empacadas (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Merma (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Merma%</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.fillingKpis.batches.map((row, i) => (
                                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                    <td className="px-5 py-3 font-mono text-xs font-bold text-violet-700">{row.batchNumber}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="font-bold text-slate-800">{row.plannedUnits || 0}</div>
                                                        {row.breakdown && Object.entries(row.breakdown).map(([size, counts]) => (
                                                            <div key={size} className="text-[9px] text-slate-400 font-medium">
                                                                {size}: {counts.planned || 0}
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="font-bold text-slate-800">{row.actualUnits || 0}</div>
                                                        {row.breakdown && Object.entries(row.breakdown).map(([size, counts]) => (
                                                            <div key={size} className="text-[9px] text-slate-400 font-medium">
                                                                {size}: {counts.actual || 0}
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td className="px-5 py-3 text-center">
                                                        {row.defective > 0 ? (
                                                            <>
                                                                <span className="font-bold text-rose-600">{row.defective} <span className="text-[10px] font-semibold text-rose-400/80">{row.defectivePct}%</span></span>
                                                                {row.defectiveBreakdown && row.defectiveBreakdown.map((db, idx) => (
                                                                    <div key={idx} className="text-[10px] text-rose-400 mt-1 leading-tight">
                                                                        <span className="font-semibold">{db.size}:</span> {db.qty}u ({db.reasonText})
                                                                        {db.lostMoney > 0 && <span className="block mt-0.5 font-bold text-rose-500">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(db.lostMoney)}</span>}
                                                                    </div>
                                                                ))}
                                                                {row.lostMoney > 0 && (
                                                                    <div className="mt-2 pt-1 border-t border-rose-100 text-[10px] font-bold text-rose-600">
                                                                        Total Perdido: -{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(row.lostMoney)}
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-slate-300">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-500">{fmtKg(row.productionG)}</td>
                                                    <td className="px-4 py-3 text-center text-blue-600 font-medium">{fmtKg(row.expectedG)}</td>
                                                    <td className="px-4 py-3 text-center text-slate-600 font-medium">{fmtKg(row.mermaG)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${
                                                            row.mermaPct <= 5 ? 'bg-emerald-100 text-emerald-700' :
                                                            row.mermaPct <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                                                        }`}>{row.mermaPct}%</span>
                                                        {row.mermaPct > 5 && (
                                                            <div className="mt-2 pt-1 border-t border-rose-100 text-[10px] leading-tight text-rose-500 font-bold">
                                                                Pérdida (Sobre 5%): -{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(row.mermaLostMoney)}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* ── Filling Efficiency KPI (Liquipops) ─────────────────── */}
                        {lineFilter !== 'geniality' && data.fillingLiquipops?.batches?.length > 0 && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingDown size={15} className="text-violet-400" />
                                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Eficiencia de Empaque — Liquipops</h2>
                                    <span className="text-xs text-slate-400 ml-1">(esferas empacadas vs producidas teóricas)</span>
                                </div>

                                {/* Summary chips */}
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
                                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">
                                        <div className="text-2xl font-bold text-indigo-700">{data.fillingLiquipops.summary.batchCount}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Batches analizados</div>
                                    </div>
                                    <div className={`border rounded-lg px-4 py-3 ${
                                        data.fillingLiquipops.summary.avgMermaPct <= 5 ? 'bg-emerald-50 border-emerald-200' :
                                        data.fillingLiquipops.summary.avgMermaPct <= 10 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
                                    }`}>
                                        <div className={`text-2xl font-bold ${
                                            data.fillingLiquipops.summary.avgMermaPct <= 5 ? 'text-emerald-600' :
                                            data.fillingLiquipops.summary.avgMermaPct <= 10 ? 'text-amber-600' : 'text-rose-600'
                                        }`}>{data.fillingLiquipops.summary.avgMermaPct}%</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Merma promedio</div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                                        <div className="text-2xl font-bold text-slate-700">{fmtKg(data.fillingLiquipops.summary.totalMermaG)}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">Merma acumulada</div>
                                    </div>

                                    {(() => {
                                        const lossDaño = data.fillingLiquipops.batches.reduce((sum, r) => sum + (r.lostMoney || 0), 0);
                                        return (
                                            <div className="bg-rose-50/50 border border-rose-200 rounded-lg px-4 py-3">
                                                <div className="text-lg font-bold text-rose-600">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(lossDaño)}</div>
                                                <div className="text-xs text-rose-400 mt-0.5 font-medium">Perdid. No Conformes</div>
                                            </div>
                                        );
                                    })()}
                                    
                                    {(() => {
                                        const lossMerma = data.fillingLiquipops.batches.reduce((sum, r) => sum + (r.mermaLostMoney || 0), 0);
                                        return (
                                            <div className="bg-rose-50/50 border border-rose-200 rounded-lg px-4 py-3">
                                                <div className="text-lg font-bold text-rose-600">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(lossMerma)}</div>
                                                <div className="text-xs text-rose-400 mt-0.5 font-medium">Perdid. Merma Exceso</div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Per-batch table */}
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50">
                                                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Batch</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Uds Planeadas</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Uds Reales</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Dañados</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Producidas (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Empacadas (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Formuladas (g/tarro)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Merma (g)</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Merma%</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.fillingLiquipops.batches.map((row, i) => (
                                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                    <td className="px-5 py-3 font-mono text-xs font-bold text-violet-700">{row.batchNumber}</td>
                                                    <td className="px-4 py-3 text-center text-slate-500">
                                                        <div className="font-bold text-slate-600">{row.plannedUnits}</div>
                                                        {row.breakdown && Object.entries(row.breakdown).map(([size, dt]) => (
                                                            <div key={size} className="text-[10px] text-slate-400">{size}: {dt.planned}</div>
                                                        ))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-500">
                                                        <div className="font-bold text-slate-600">{row.actualUnits}</div>
                                                        {row.breakdown && Object.entries(row.breakdown).map(([size, dt]) => (
                                                            <div key={size} className="text-[10px] text-emerald-600/70">{size}: {dt.actual}</div>
                                                        ))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-rose-500">
                                                        {row.defective > 0 ? (
                                                            <>
                                                                <div className="font-bold flex items-center justify-center gap-1">
                                                                    <span>{row.defective}</span>
                                                                    <span className="text-[10px] bg-rose-100/50 text-rose-600 px-1 rounded-sm leading-none">{row.defectivePct}%</span>
                                                                </div>
                                                                {row.defectiveBreakdown && row.defectiveBreakdown.map((db, idx) => (
                                                                    <div key={idx} className="text-[10px] text-rose-400 mt-1 leading-tight">
                                                                        <span className="font-semibold">{db.size}:</span> {db.qty}u ({db.reasonText})
                                                                        {db.lostMoney > 0 && <span className="block mt-0.5 font-bold text-rose-500">-{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(db.lostMoney)}</span>}
                                                                    </div>
                                                                ))}
                                                                {row.lostMoney > 0 && (
                                                                    <div className="mt-2 pt-1 border-t border-rose-100 text-[10px] font-bold text-rose-600">
                                                                        Total Perdido: -{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(row.lostMoney)}
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-slate-300">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-500">{fmtKg(row.productionG)}</td>
                                                    <td className="px-4 py-3 text-center text-emerald-600 font-medium">{fmtKg(row.expectedG)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        {row.breakdown && Object.entries(row.breakdown).map(([size, dt]) => (
                                                            <div key={size} className="text-[10px] text-slate-600 font-medium whitespace-nowrap">
                                                                <span className="capitalize">{size}</span>: <span className="font-bold text-slate-800">{dt.gpv || 0}g</span>
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-amber-600 font-medium">{fmtKg(row.mermaG)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${
                                                            row.mermaPct <= 5 ? 'bg-emerald-100 text-emerald-700' :
                                                            row.mermaPct <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                                                        }`}>{row.mermaPct}%</span>
                                                        {row.mermaPct > 5 && (
                                                            <div className="mt-2 pt-1 border-t border-rose-100 text-[10px] leading-tight text-rose-500 font-bold">
                                                                Pérdida (Sobre 5%): -{new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(row.mermaLostMoney)}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* ── Quality detail per batch (EMPAQUE) ─────────────────── */}
                        {data.qualityKpis?.detail?.length > 0 && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingUp size={15} className="text-slate-400" />
                                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Calidad por lote — Empaque</h2>
                                </div>
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50">
                                                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Nota</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase">Lote</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase">Operario</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Total</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Defectuoso</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Tasa</th>
                                                <th className="text-center px-4 py-3 text-xs font-bold text-slate-500 uppercase">Duración</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.qualityKpis.detail.slice(0, 20).map((row, i) => (
                                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.noteNumber}</td>
                                                    <td className="px-4 py-3 text-slate-600 text-xs">{row.batchNumber || '—'}</td>
                                                    <td className="px-4 py-3 text-slate-700 font-medium">{row.operatorName}</td>
                                                    <td className="px-4 py-3 text-center text-slate-500">{Math.round(row.totalUnits)}</td>
                                                    <td className="px-4 py-3 text-center font-medium">{Math.round(row.defectiveCount)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${row.defectivePct > 5 ? 'bg-red-100 text-red-700' : row.defectivePct > 2 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                            {row.defectivePct}%
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-400">{fmtMin(row.durationMin)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ProductionKpiPage;
