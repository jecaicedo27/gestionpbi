import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RefreshCw, Clock, TrendingUp, AlertTriangle, Star, ChevronUp, ChevronDown, Minus } from 'lucide-react';

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
    const [sortKey, setSortKey] = useState('overallScore');
    const [sortDir, setSortDir] = useState('desc');

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get(`/production-kpis?days=${days}`);
            setData(res.data);
        } catch (e) {
            setError(e.response?.data?.error || 'Error cargando KPIs');
        } finally {
            setLoading(false);
        }
    }, [days]);

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
