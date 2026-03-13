import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, ChevronDown, ChevronRight, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL;

const formatDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatDateTime = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatNumber = (value) => Number(value || 0).toLocaleString('es-CO');
const formatPercent = (value, decimals = 1) => `${Number(value || 0).toFixed(decimals)}%`;
const displayValue = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));
const displayMetric = (value, unit = '') => (value === null || value === undefined || value === '' ? '—' : `${value}${unit}`);

const severityBadge = (severity) => {
    if (severity === 'recall') return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"><ShieldAlert size={12} /> Recall</span>;
    if (severity === 'critical') return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700"><AlertTriangle size={12} /> Crítico</span>;
    if (severity === 'warning') return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700"><AlertTriangle size={12} /> Con reportes</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> Sin reportes</span>;
};

const SummaryCard = ({ label, value, color }) => (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p>
        <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
    </div>
);

const PQRAdvancedValidation = () => {
    const navigate = useNavigate();
    const { token } = useAuth();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [payload, setPayload] = useState(null);
    const [search, setSearch] = useState('');
    const [severity, setSeverity] = useState('all');
    const [expanded, setExpanded] = useState({});

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`${API_URL}/api/pqr/analytics/advanced-validation`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setPayload(res.data);
                setError('');
            } catch (e) {
                setError(e.response?.data?.error || 'Error cargando validación avanzada');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [token]);

    const rows = payload?.rows || [];
    const damagePatterns = payload?.damagePatterns || null;
    const interactionPatterns = damagePatterns?.interactionPatterns || {};
    const dataQuality = payload?.dataQuality?.metrics || [];
    const probableLots = payload?.predictiveRisk?.probableUnreportedLots || [];
    const predictiveModel = payload?.predictiveRisk?.model || null;

    const filteredRows = useMemo(() => {
        return rows.filter((row) => {
            const matchesSeverity = severity === 'all' || row.pqr.severity === severity;
            if (!matchesSeverity) return false;

            if (!search) return true;
            const q = search.toLowerCase();
            const haystack = [
                row.displayLot,
                row.lotCode,
                row.premixLot,
                row.flavor,
                row.flavorRaw,
                ...(row.pqr.lotNumbersReported || []),
                ...(row.pqr.distributors || []),
                ...(row.pqr.products || [])
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return haystack.includes(q);
        }).sort((a, b) => {
            if (a.pqr.hasReports !== b.pqr.hasReports) return a.pqr.hasReports ? -1 : 1;
            if ((a.pqr.totalReportedUnits || 0) !== (b.pqr.totalReportedUnits || 0)) return (b.pqr.totalReportedUnits || 0) - (a.pqr.totalReportedUnits || 0);
            return new Date(b.productionDate).getTime() - new Date(a.productionDate).getTime();
        });
    }, [rows, search, severity]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-96">
                <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <button
                        onClick={() => navigate('/pqr/dashboard')}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 mb-2"
                    >
                        <ArrowLeft size={16} />
                        Volver al Dashboard PQR
                    </button>
                    <h1 className="text-2xl font-black text-gray-900">Validación Avanzada de Lotes</h1>
                    <p className="text-sm text-gray-500">
                        Cruce completo entre producción (`production_lots`) y reportes PQR por lote/presentación.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <SummaryCard label="Lotes Producción" value={formatNumber(payload?.summary?.totalProductionLots)} color="text-gray-900" />
                <SummaryCard label="Lotes con PQR" value={formatNumber(payload?.summary?.lotsWithPqr)} color="text-orange-700" />
                <SummaryCard label="Lotes sin PQR" value={formatNumber(payload?.summary?.lotsWithoutPqr)} color="text-emerald-700" />
                <SummaryCard label="Lotes Recall" value={formatNumber(payload?.summary?.recallLots)} color="text-red-700" />
                <SummaryCard label="Unidades Producidas" value={formatNumber(payload?.summary?.totalProducedUnits)} color="text-blue-700" />
                <SummaryCard label="Unidades Reportadas" value={formatNumber(payload?.summary?.totalReportedUnits)} color="text-purple-700" />
            </div>

            {damagePatterns && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-wide text-gray-700">Patrones Detectados de Lotes Dañados</h2>
                            <p className="text-xs text-gray-500">
                                Método: {damagePatterns.method?.name || '—'} · Baseline: {formatPercent(damagePatterns.baseline?.baselineDamageRatePct, 2)}
                            </p>
                        </div>
                        <div className="text-xs text-gray-500">
                            {formatNumber(damagePatterns.baseline?.damagedLots)} / {formatNumber(damagePatterns.baseline?.totalLots)} lotes con PQR
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Riesgo por Sabor</p>
                            <div className="space-y-2">
                                {(damagePatterns.byFlavor || []).slice(0, 5).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">RR {item.riskRatio} · {formatPercent((item.damageRate || 0) * 100)} · {item.damagedLots}/{item.totalLots}</span>
                                    </div>
                                ))}
                                {(damagePatterns.byFlavor || []).length === 0 && <p className="text-xs text-gray-400">Sin patrón con soporte estadístico.</p>}
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Riesgo por Presentación</p>
                            <div className="space-y-2">
                                {(damagePatterns.byPresentation || []).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">RR {item.riskRatio} · {formatPercent((item.damageRate || 0) * 100)} · {item.damagedLots}/{item.totalLots}</span>
                                    </div>
                                ))}
                                {(damagePatterns.byPresentation || []).length === 0 && <p className="text-xs text-gray-400">Sin patrón con soporte estadístico.</p>}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Patrón por Turno</p>
                            <div className="space-y-2">
                                {(damagePatterns.byShift || []).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">RR {item.riskRatio} · {formatPercent((item.damageRate || 0) * 100)}</span>
                                    </div>
                                ))}
                                {(damagePatterns.byShift || []).length === 0 && <p className="text-xs text-gray-400">Sin patrón con soporte estadístico.</p>}
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Tiempo al Primer Reporte</p>
                            <div className="space-y-2">
                                {(damagePatterns.byDaysToFirstReport || []).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">{item.lots} lotes · {formatPercent(item.pctLots)}</span>
                                    </div>
                                ))}
                                {(damagePatterns.byDaysToFirstReport || []).length === 0 && <p className="text-xs text-gray-400">Sin datos de tiempo al primer reporte.</p>}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Patrón Combinado: Sabor x Turno</p>
                            <div className="space-y-2">
                                {(interactionPatterns.byFlavorShift || []).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">RR {item.riskRatio} · {formatPercent((item.damageRate || 0) * 100)} · {item.damagedLots}/{item.totalLots}</span>
                                    </div>
                                ))}
                                {(interactionPatterns.byFlavorShift || []).length === 0 && <p className="text-xs text-gray-400">Sin patrón combinado con soporte estadístico.</p>}
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-100 p-4">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Patrón Combinado: Sabor x Presentación</p>
                            <div className="space-y-2">
                                {(interactionPatterns.byFlavorPresentation || []).map((item) => (
                                    <div key={item.key} className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-gray-700">{item.key}</span>
                                        <span className="text-gray-600">RR {item.riskRatio} · {formatPercent((item.damageRate || 0) * 100)} · {item.damagedLots}/{item.totalLots}</span>
                                    </div>
                                ))}
                                {(interactionPatterns.byFlavorPresentation || []).length === 0 && <p className="text-xs text-gray-400">Sin patrón combinado con soporte estadístico.</p>}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 p-4">
                        <p className="text-xs font-bold uppercase text-gray-500 mb-2">Señales Numéricas (Robustas)</p>
                        {(damagePatterns.numericSignals || []).length === 0 ? (
                            <p className="text-xs text-gray-400">No se detectaron desvíos robustos sobre las variables de proceso.</p>
                        ) : (
                            <div className="space-y-2">
                                {damagePatterns.numericSignals.map((signal) => (
                                    <div key={signal.metric} className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-semibold text-gray-700">{signal.label}</span>
                                        <span className="text-gray-600">
                                            {signal.direction === 'higher' ? 'Mayor' : 'Menor'} en dañados · efecto {signal.effectSize} · mediana {signal.damagedMedian} vs {signal.healthyMedian}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-xl border border-gray-100 p-4">
                        <p className="text-xs font-bold uppercase text-gray-500 mb-3">Calidad de Datos de Producción</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-gray-500 border-b border-gray-100">
                                        <th className="py-2 pr-3">Métrica</th>
                                        <th className="py-2 pr-3 text-right">No nulos</th>
                                        <th className="py-2 pr-3 text-right">Usables</th>
                                        <th className="py-2 pr-3 text-right">% usable</th>
                                        <th className="py-2 pr-3 text-right">Outliers removidos</th>
                                        <th className="py-2 text-right">Ceros</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataQuality.map((q) => (
                                        <tr key={q.metric} className="border-b border-gray-50">
                                            <td className="py-2 pr-3 font-semibold text-gray-700">{q.label}</td>
                                            <td className="py-2 pr-3 text-right text-gray-600">{formatNumber(q.nonNullCount)}</td>
                                            <td className="py-2 pr-3 text-right text-gray-600">{formatNumber(q.usableCount)}</td>
                                            <td className="py-2 pr-3 text-right text-gray-600">{formatPercent(q.usablePct)}</td>
                                            <td className="py-2 pr-3 text-right text-gray-600">{formatNumber(q.outliersRemoved)}</td>
                                            <td className="py-2 text-right text-gray-600">{formatNumber(q.zeroCount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {probableLots.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                        <h2 className="text-sm font-black uppercase tracking-wide text-red-700">Lotes Probables a Dañarse (sin reporte PQR)</h2>
                        <span className="text-xs text-gray-500">Modelo predictivo fino · {formatNumber(probableLots.length)} lotes en vigilancia</span>
                    </div>
                    {predictiveModel && (
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-4">
                            <div className="rounded-xl border border-gray-100 p-3">
                                <p className="text-[11px] font-bold uppercase text-gray-500">Umbrales de Score</p>
                                <p className="text-xs text-gray-700 mt-1">Watch: <span className="font-black">{predictiveModel.thresholds?.watch}</span></p>
                                <p className="text-xs text-gray-700">Medium: <span className="font-black">{predictiveModel.thresholds?.medium}</span></p>
                                <p className="text-xs text-gray-700">High: <span className="font-black">{predictiveModel.thresholds?.high}</span></p>
                            </div>
                            <div className="rounded-xl border border-gray-100 p-3">
                                <p className="text-[11px] font-bold uppercase text-gray-500">Backtest Medium</p>
                                <p className="text-xs text-gray-700 mt-1">Precisión: <span className="font-black">{formatPercent((predictiveModel.backtest?.medium?.precision || 0) * 100, 1)}</span></p>
                                <p className="text-xs text-gray-700">Recall: <span className="font-black">{formatPercent((predictiveModel.backtest?.medium?.recall || 0) * 100, 1)}</span></p>
                                <p className="text-xs text-gray-700">F1: <span className="font-black">{predictiveModel.backtest?.medium?.f1 ?? '—'}</span></p>
                            </div>
                            <div className="rounded-xl border border-gray-100 p-3">
                                <p className="text-[11px] font-bold uppercase text-gray-500">Backtest High</p>
                                <p className="text-xs text-gray-700 mt-1">Precisión: <span className="font-black">{formatPercent((predictiveModel.backtest?.high?.precision || 0) * 100, 1)}</span></p>
                                <p className="text-xs text-gray-700">Recall: <span className="font-black">{formatPercent((predictiveModel.backtest?.high?.recall || 0) * 100, 1)}</span></p>
                                <p className="text-xs text-gray-700">F1: <span className="font-black">{predictiveModel.backtest?.high?.f1 ?? '—'}</span></p>
                            </div>
                            <div className="rounded-xl border border-gray-100 p-3">
                                <p className="text-[11px] font-bold uppercase text-gray-500">Rendimiento Global</p>
                                <p className="text-xs text-gray-700 mt-1">AUC-ROC: <span className="font-black">{predictiveModel.performance?.aucRoc ?? '—'}</span></p>
                                <p className="text-xs text-gray-700">AUC-PR: <span className="font-black">{predictiveModel.performance?.aucPr ?? '—'}</span></p>
                                <p className="text-xs text-gray-700">Lift Top 10%: <span className="font-black">{predictiveModel.performance?.topDecileLift ?? '—'}x</span></p>
                            </div>
                        </div>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-gray-100 text-gray-500">
                                    <th className="py-2 pr-3 text-left">Lote</th>
                                    <th className="py-2 pr-3 text-left">Sabor</th>
                                    <th className="py-2 pr-3 text-right">Score</th>
                                    <th className="py-2 pr-3 text-right">Prob.</th>
                                    <th className="py-2 pr-3 text-left">Nivel</th>
                                    <th className="py-2 pr-3 text-right">Días</th>
                                    <th className="py-2 pr-3 text-right">Prod.</th>
                                    <th className="py-2 pr-3 text-right">Dañados Fab.</th>
                                    <th className="py-2 pr-3 text-right">% Daño Fab.</th>
                                    <th className="py-2 pr-3 text-right">Signals</th>
                                    <th className="py-2 text-left">Razones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {probableLots.slice(0, 20).map((item) => (
                                    <tr key={item.id} className="border-b border-gray-50">
                                        <td className="py-2 pr-3">
                                            <p className="font-mono font-bold text-gray-800">{item.displayLot}</p>
                                            <p className="text-[11px] text-gray-400">{item.lotCode}</p>
                                        </td>
                                        <td className="py-2 pr-3 font-semibold text-gray-700">{item.flavor || '—'}</td>
                                        <td className="py-2 pr-3 text-right font-black text-red-700">{item.modelScore}</td>
                                        <td className="py-2 pr-3 text-right font-black text-gray-800">{item.modelProbability !== null && item.modelProbability !== undefined ? `${item.modelProbability}%` : '—'}</td>
                                        <td className="py-2 pr-3">
                                            <span className={`px-2 py-1 rounded-full font-bold ${item.riskLevel === 'high'
                                                ? 'bg-red-100 text-red-700'
                                                : item.riskLevel === 'medium'
                                                    ? 'bg-orange-100 text-orange-700'
                                                    : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                {item.riskLevel}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-3 text-right font-semibold text-gray-700">{displayValue(item.daysSinceProduction)}</td>
                                        <td className="py-2 pr-3 text-right font-semibold text-gray-700">{formatNumber(item.producedUnits?.total || 0)}</td>
                                        <td className="py-2 pr-3 text-right font-semibold text-gray-700">{formatNumber(item.damagedAtProductionTotal)}</td>
                                        <td className="py-2 pr-3 text-right font-semibold text-gray-700">{item.internalDamageRatePct !== null ? `${item.internalDamageRatePct}%` : '—'}</td>
                                        <td className="py-2 pr-3 text-right font-semibold text-gray-700">{displayValue(item.signalHits)}</td>
                                        <td className="py-2 text-gray-600">{(item.reasons || []).slice(0, 3).join(' · ') || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <div className="flex flex-col md:flex-row gap-3 md:items-center">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por lote, sabor, distribuidor o producto..."
                            className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {['all', 'recall', 'critical', 'warning', 'none'].map((key) => (
                            <button
                                key={key}
                                onClick={() => setSeverity(key)}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border ${severity === key ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                            >
                                {key === 'all' ? 'Todos' : key === 'none' ? 'Sin reportes' : key}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Estado</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Lote</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Sabor</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">phJarabe</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">bxJarabe</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Fabricación</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Producido</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Primer Reporte</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Enlace</th>
                                <th className="px-4 py-3 text-center text-xs font-bold uppercase text-gray-500">Tickets</th>
                                <th className="px-4 py-3 text-center text-xs font-bold uppercase text-gray-500">Unid. Reportadas</th>
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-500">Dañado por Presentación</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredRows.map((row) => {
                                const isOpen = !!expanded[row.id];
                                return (
                                    <React.Fragment key={row.id}>
                                        <tr
                                            className={`cursor-pointer hover:bg-gray-50 ${row.pqr.severity === 'recall' ? 'bg-red-50/70' : ''}`}
                                            onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                    {severityBadge(row.pqr.severity)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="font-mono font-bold text-gray-900">{row.displayLot}</p>
                                                <p className="text-[11px] text-gray-400">{row.lotCode}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="font-semibold text-gray-800">{row.flavor}</p>
                                                <p className="text-[11px] text-gray-400">{row.flavorRaw}</p>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-gray-700">{displayValue(row.phJarabe)}</td>
                                            <td className="px-4 py-3 font-semibold text-gray-700">{displayValue(row.bxJarabe)}</td>
                                            <td className="px-4 py-3 font-semibold text-gray-700">{formatDate(row.productionDate)}</td>
                                            <td className="px-4 py-3">
                                                <p className="font-bold text-gray-900">{formatNumber(row.producedUnits.total)} uds</p>
                                                <p className="text-[11px] text-purple-600">
                                                    3400g:{row.producedUnits['3400g']} · 1150g:{row.producedUnits['1150g']} · 350g:{row.producedUnits['350g']}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="font-semibold text-gray-800">{formatDate(row.pqr.firstReportDate)}</p>
                                                {row.pqr.daysToFirstReport !== null && (
                                                    <p className="text-[11px] text-gray-500">{row.pqr.daysToFirstReport} días</p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold ${row.pqr.linkMode === 'lot+flavor'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : row.pqr.linkMode === 'lot'
                                                        ? 'bg-amber-100 text-amber-700'
                                                        : 'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    {row.pqr.linkMode === 'lot+flavor' ? 'Lote + Sabor' : row.pqr.linkMode === 'lot' ? 'Solo Lote' : 'Sin match'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center font-black text-gray-900">{formatNumber(row.pqr.totalTickets)}</td>
                                            <td className="px-4 py-3 text-center font-black text-gray-900">{formatNumber(row.pqr.totalReportedUnits)}</td>
                                            <td className="px-4 py-3">
                                                {row.pqr.byPresentation.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.pqr.byPresentation.map((p) => (
                                                            <span key={p.size} className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-100 rounded-md px-2 py-0.5 text-[11px] font-semibold">
                                                                {p.size}: {formatNumber(p.reportedUnits)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-gray-300">—</span>
                                                )}
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr>
                                                <td colSpan="12" className="px-4 py-4 bg-gray-50/70">
                                                    <div className="space-y-4">
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                            <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                                <p className="text-xs font-bold uppercase text-gray-500 mb-2">Datos de Producción</p>
                                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                                    <p><span className="text-gray-500">id:</span> <span className="font-semibold">{displayValue(row.id)}</span></p>
                                                                    <p><span className="text-gray-500">lotCode:</span> <span className="font-semibold">{displayValue(row.lotCode)}</span></p>
                                                                    <p><span className="text-gray-500">displayLot:</span> <span className="font-semibold">{displayValue(row.displayLot)}</span></p>
                                                                    <p><span className="text-gray-500">premixLot:</span> <span className="font-semibold">{displayValue(row.premixLot)}</span></p>
                                                                    <p><span className="text-gray-500">flavor:</span> <span className="font-semibold">{displayValue(row.flavor)}</span></p>
                                                                    <p><span className="text-gray-500">flavorRaw:</span> <span className="font-semibold">{displayValue(row.flavorRaw)}</span></p>
                                                                    <p><span className="text-gray-500">productionDate:</span> <span className="font-semibold">{formatDate(row.productionDate)}</span></p>
                                                                    <p><span className="text-gray-500">createdAt:</span> <span className="font-semibold">{formatDate(row.createdAt)}</span></p>
                                                                    <p><span className="text-gray-500">mixAssemblyNote:</span> <span className="font-semibold">{displayValue(row.mixAssemblyNote)}</span></p>
                                                                    <p><span className="text-gray-500">mixQuantityKg:</span> <span className="font-semibold">{displayMetric(row.mixQuantityKg, ' kg')}</span></p>
                                                                    <p><span className="text-gray-500">phJarabe:</span> <span className="font-semibold">{displayValue(row.phJarabe)}</span></p>
                                                                    <p><span className="text-gray-500">bxJarabe:</span> <span className="font-semibold">{displayValue(row.bxJarabe)}</span></p>
                                                                    <p><span className="text-gray-500">conductividad:</span> <span className="font-semibold">{displayValue(row.conductividad)}</span></p>
                                                                    <p><span className="text-gray-500">bxPerla:</span> <span className="font-semibold">{displayValue(row.bxPerla)}</span></p>
                                                                    <p><span className="text-gray-500">tempCoccion:</span> <span className="font-semibold">{displayValue(row.tempCoccion)}</span></p>
                                                                    <p><span className="text-gray-500">tempChiller:</span> <span className="font-semibold">{displayValue(row.tempChiller)}</span></p>
                                                                    <p><span className="text-gray-500">productionStartAt:</span> <span className="font-semibold">{formatDateTime(row.productionStartAt)}</span></p>
                                                                    <p><span className="text-gray-500">productionEndAt:</span> <span className="font-semibold">{formatDateTime(row.productionEndAt)}</span></p>
                                                                    <p><span className="text-gray-500">productionDurationMin:</span> <span className="font-semibold">{displayValue(row.productionDurationMin)}</span></p>
                                                                    <p><span className="text-gray-500">productionDurationRaw:</span> <span className="font-semibold">{displayValue(row.productionDurationRaw)}</span></p>
                                                                    <p><span className="text-gray-500">protectionLotCode:</span> <span className="font-semibold">{displayValue(row.protectionLotCode)}</span></p>
                                                                    <p><span className="text-gray-500">protectionQuantityKg:</span> <span className="font-semibold">{displayMetric(row.protectionQuantityKg, ' kg')}</span></p>
                                                                    <p><span className="text-gray-500">protectionPh:</span> <span className="font-semibold">{displayValue(row.protectionPh)}</span></p>
                                                                    <p><span className="text-gray-500">protectionBx:</span> <span className="font-semibold">{displayValue(row.protectionBx)}</span></p>
                                                                    <p><span className="text-gray-500">protectionAssemblyNote:</span> <span className="font-semibold">{displayValue(row.protectionAssemblyNote)}</span></p>
                                                                    <p><span className="text-gray-500">alginateLotCode:</span> <span className="font-semibold">{displayValue(row.alginateLotCode)}</span></p>
                                                                    <p><span className="text-gray-500">pearlGrowthCheckRaw:</span> <span className="font-semibold">{displayValue(row.pearlGrowthCheckRaw)}</span></p>
                                                                    <p><span className="text-gray-500">pearlGrowthConfirmed:</span> <span className="font-semibold">{displayValue(row.pearlGrowthConfirmed)}</span></p>
                                                                    <p><span className="text-gray-500">pearlCookTempC:</span> <span className="font-semibold">{displayValue(row.pearlCookTempC)}</span></p>
                                                                    <p><span className="text-gray-500">pearlCookTimeSec:</span> <span className="font-semibold">{displayValue(row.pearlCookTimeSec)}</span></p>
                                                                    <p><span className="text-gray-500">protectionAdded3400:</span> <span className="font-semibold">{displayValue(row.protectionAdded3400)}</span></p>
                                                                    <p><span className="text-gray-500">protectionAdded1150:</span> <span className="font-semibold">{displayValue(row.protectionAdded1150)}</span></p>
                                                                    <p><span className="text-gray-500">protectionAdded350:</span> <span className="font-semibold">{displayValue(row.protectionAdded350)}</span></p>
                                                                    <p><span className="text-gray-500">damaged3400:</span> <span className="font-semibold">{displayValue(row.damaged3400)}</span></p>
                                                                    <p><span className="text-gray-500">damaged1150:</span> <span className="font-semibold">{displayValue(row.damaged1150)}</span></p>
                                                                    <p><span className="text-gray-500">damaged350:</span> <span className="font-semibold">{displayValue(row.damaged350)}</span></p>
                                                                    <p><span className="text-gray-500">damagedAtProductionTotal:</span> <span className="font-semibold">{displayValue(row.damagedAtProductionTotal)}</span></p>
                                                                    <p><span className="text-gray-500">internalDamageRatePct:</span> <span className="font-semibold">{row.internalDamageRatePct !== null && row.internalDamageRatePct !== undefined ? `${Number(row.internalDamageRatePct).toFixed(2)}%` : '—'}</span></p>
                                                                    <p><span className="text-gray-500">pesoPerlas:</span> <span className="font-semibold">{displayValue(row.pesoPerlas)}</span></p>
                                                                    <p><span className="text-gray-500">leader:</span> <span className="font-semibold">{displayValue(row.leader)}</span></p>
                                                                    <p><span className="text-gray-500">logisticsDeliveredDate:</span> <span className="font-semibold">{formatDate(row.logisticsDeliveredDate)}</span></p>
                                                                    <p><span className="text-gray-500">logisticsDeliveredTo:</span> <span className="font-semibold">{displayValue(row.logisticsDeliveredTo)}</span></p>
                                                                    <p><span className="text-gray-500">units3400:</span> <span className="font-semibold">{displayValue(row.producedUnits['3400g'])}</span></p>
                                                                    <p><span className="text-gray-500">units1150:</span> <span className="font-semibold">{displayValue(row.producedUnits['1150g'])}</span></p>
                                                                    <p><span className="text-gray-500">units350:</span> <span className="font-semibold">{displayValue(row.producedUnits['350g'])}</span></p>
                                                                    <p><span className="text-gray-500">producedTotal:</span> <span className="font-semibold">{displayValue(row.producedUnits.total)}</span></p>
                                                                </div>
                                                            </div>
                                                            <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                                <p className="text-xs font-bold uppercase text-gray-500 mb-2">Resumen PQR del Lote</p>
                                                                <div className="space-y-1 text-xs">
                                                                    <p><span className="text-gray-500">Modo de enlace:</span> <span className="font-semibold">{displayValue(row.pqr.linkMode)}</span></p>
                                                                    <p><span className="text-gray-500">Lotes reportados en PQR:</span> <span className="font-semibold">{row.pqr.lotNumbersReported.join(', ') || '—'}</span></p>
                                                                    <p><span className="text-gray-500">Distribuidores:</span> <span className="font-semibold">{row.pqr.distributors.join(', ') || '—'}</span></p>
                                                                    <p><span className="text-gray-500">Productos:</span> <span className="font-semibold">{row.pqr.products.join(', ') || '—'}</span></p>
                                                                    <p><span className="text-gray-500">Sabores reportados:</span> <span className="font-semibold">{row.pqr.flavors.join(', ') || '—'}</span></p>
                                                                    <p><span className="text-gray-500">Último reporte:</span> <span className="font-semibold">{formatDate(row.pqr.lastReportDate)}</span></p>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                            <p className="text-xs font-bold uppercase text-gray-500 mb-3">Detalle de Reportes PQR</p>
                                                            {row.pqr.reports.length === 0 ? (
                                                                <p className="text-xs text-gray-400">Este lote no tiene reportes PQR asociados.</p>
                                                            ) : (
                                                                <div className="space-y-2 max-h-80 overflow-auto pr-1">
                                                                    {row.pqr.reports.map((report, idx) => (
                                                                        <div key={`${row.id}-${idx}`} className="border border-gray-100 rounded-lg p-3 text-xs bg-gray-50">
                                                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                                                <p className="font-bold text-gray-900">
                                                                                    Ticket {report.ticketNumber || '—'} · {report.productName}
                                                                                </p>
                                                                                <p className="text-gray-500">{formatDate(report.reportDate)}</p>
                                                                            </div>
                                                                            <p className="text-gray-600 mt-1">
                                                                                {report.size || 'Sin tamaño'} · {formatNumber(report.quantity)} {report.unit || ''} · Tipo: {report.type || '—'}
                                                                            </p>
                                                                            <p className="text-gray-600">
                                                                                Distribuidor: {report.distributor?.name || 'Desconocido'} · Estado: {report.status || '—'} · Etapa: {report.stage || '—'}
                                                                            </p>
                                                                            {report.description && (
                                                                                <p className="text-gray-500 italic mt-1">"{report.description}"</p>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="12" className="px-4 py-8 text-center text-gray-400 text-sm">
                                        No hay lotes que coincidan con el filtro aplicado.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {payload?.unmatchedPqrLots?.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
                    <h2 className="text-sm font-black uppercase tracking-wide text-amber-700 mb-3">
                        PQR sin match de producción (lote no homologado)
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {payload.unmatchedPqrLots.map((item) => (
                            <div key={item.lotNumberReported} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                                <p className="font-mono font-bold text-amber-800">{item.lotNumberReported || 'Sin lote'}</p>
                                <p className="text-xs text-amber-700 mt-1">
                                    {formatNumber(item.totalTickets)} tickets · {formatNumber(item.totalReportItems)} ítems · {formatNumber(item.totalReportedUnits)} uds
                                </p>
                                <p className="text-xs text-amber-600">Primer reporte: {formatDate(item.firstReportDate)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PQRAdvancedValidation;
