import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { ChevronLeft, RefreshCw } from 'lucide-react';

const TimingAnalysisPage = () => {
    const navigate = useNavigate();
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get(`/shift-discipline/analytics/timing-stats?month=${month}`);
            setData(r.data);
        } catch (e) { console.warn('timingStats', e?.message); }
        setLoading(false);
    };
    useEffect(() => { load(); }, [month]);

    const fmtMin = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} min`;
    const fmtScore = (v) => v == null ? '—' : Math.round(v);

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-200">
                            <ChevronLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">📊 Analítica de Tiempos del Cronograma</h1>
                            <p className="text-xs text-slate-500">Aprende del sistema real para ajustar el cronograma teórico</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                            className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {!data ? (
                    <div className="text-center py-12 text-slate-400">Cargando...</div>
                ) : (
                    <>
                        {/* KPIs top */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <Kpi label="Turnos analizados" value={data.totalRuns} />
                            <Kpi label="Cumplieron meta" value={`${data.metGoalCount}`}
                                subtitle={`${Math.round((data.metGoalRate || 0) * 100)}% del total`}
                                accent={data.metGoalRate >= 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} />
                            <Kpi label="Bajo meta" value={data.underGoalCount}
                                subtitle="Aprende dónde mejorar"
                                accent="bg-rose-50 text-rose-700" />
                            <Kpi label="Turnos perfectos (100)" value={data.perfectShifts}
                                accent="bg-violet-50 text-violet-700" />
                        </div>

                        {/* Δ por tipo */}
                        <Card title="⏱ Δ promedio (vs hora ideal del cronograma)">
                            <div className="text-xs text-slate-500 mb-2">
                                Si el promedio es positivo grande → el cronograma teórico es muy optimista (los operarios consistentemente arrancan tarde).
                                Si es negativo → arrancan antes de lo previsto (el cronograma puede comprimirse).
                            </div>
                            <table className="w-full text-sm">
                                <thead className="bg-slate-100">
                                    <tr>
                                        <th className="text-left px-2 py-1.5">Tipo</th>
                                        <th className="text-center px-2 py-1.5">Muestras</th>
                                        <th className="text-center px-2 py-1.5">Δ promedio</th>
                                        <th className="text-center px-2 py-1.5">Mediana</th>
                                        <th className="text-center px-2 py-1.5">P90 (peor 10%)</th>
                                        <th className="text-center px-2 py-1.5">Min / Max</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {['BASE', 'ALGINATO', 'PROTECCION'].map(t => {
                                        const s = data.deltaByType[t];
                                        return (
                                            <tr key={t} className="border-t border-slate-100">
                                                <td className="px-2 py-1.5 font-bold">{t}</td>
                                                <td className="px-2 py-1.5 text-center">{s.count}</td>
                                                <td className={`px-2 py-1.5 text-center font-bold ${s.avg > 15 ? 'text-rose-600' : s.avg > 5 ? 'text-amber-600' : s.avg < -5 ? 'text-blue-600' : 'text-emerald-600'}`}>
                                                    {fmtMin(s.avg)}
                                                </td>
                                                <td className="px-2 py-1.5 text-center">{fmtMin(s.p50)}</td>
                                                <td className="px-2 py-1.5 text-center">{fmtMin(s.p90)}</td>
                                                <td className="px-2 py-1.5 text-center text-xs text-slate-500">
                                                    {fmtMin(s.min)} / {fmtMin(s.max)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Card>

                        {/* Cycle time entre BASES */}
                        <Card title="🔄 Tiempo real entre BASES consecutivas">
                            <div className="text-xs text-slate-500 mb-2">
                                Cronograma teórico: 50 min entre BASES. Si la mediana real es muy distinta, el cronograma necesita ajuste.
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                <Stat label="Promedio" value={`${data.cycleTime.avg?.toFixed(0) || 0} min`} />
                                <Stat label="Mediana" value={`${data.cycleTime.p50?.toFixed(0) || 0} min`} highlight />
                                <Stat label="P90" value={`${data.cycleTime.p90?.toFixed(0) || 0} min`} />
                                <Stat label="Min / Max" value={`${data.cycleTime.min?.toFixed(0) || 0} / ${data.cycleTime.max?.toFixed(0) || 0}`} />
                            </div>
                        </Card>

                        {/* Distribución de baches */}
                        <Card title="🎯 Distribución de baches por turno">
                            <div className="text-xs text-slate-500 mb-2">
                                ¿Qué tan frecuente es cada cantidad de baches por turno? Si la mayoría queda en 5-6, la meta de 7 puede ser optimista.
                            </div>
                            <div className="flex gap-1 items-end h-32">
                                {[0,1,2,3,4,5,6,7,8].map(n => {
                                    const count = data.goalDistribution[n] || 0;
                                    const max = Math.max(...Object.values(data.goalDistribution || {}), 1);
                                    const pct = max > 0 ? (count / max) * 100 : 0;
                                    const isMeta = n >= 5;
                                    return (
                                        <div key={n} className="flex-1 flex flex-col items-center justify-end">
                                            <span className="text-[10px] text-slate-500 font-bold mb-1">{count || ''}</span>
                                            <div className={`w-full rounded-t transition-all ${
                                                n >= 7 ? 'bg-emerald-500' : n >= 5 ? 'bg-amber-400' : 'bg-rose-300'
                                            }`} style={{ height: `${pct}%`, minHeight: count > 0 ? '4px' : '0' }} />
                                            <span className="text-[10px] text-slate-700 mt-1 font-bold">{n}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="text-[10px] text-slate-400 text-center mt-1">baches por turno</div>
                        </Card>

                        {/* Tendencia diaria */}
                        {data.dailyTrend?.length > 0 && (
                            <Card title="📈 Tendencia diaria del mes">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-100">
                                            <tr>
                                                <th className="text-left px-2 py-1">Día</th>
                                                <th className="text-center px-2 py-1">Turnos</th>
                                                <th className="text-center px-2 py-1">Baches totales</th>
                                                <th className="text-center px-2 py-1">Score promedio</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.dailyTrend.map(d => (
                                                <tr key={d.date} className="border-t border-slate-100">
                                                    <td className="px-2 py-1 font-mono">{d.date}</td>
                                                    <td className="px-2 py-1 text-center">{d.runs}</td>
                                                    <td className="px-2 py-1 text-center font-bold">{d.baches}</td>
                                                    <td className={`px-2 py-1 text-center font-bold ${
                                                        d.avgScore >= 85 ? 'text-emerald-600' :
                                                        d.avgScore >= 60 ? 'text-amber-600' : 'text-rose-600'
                                                    }`}>{fmtScore(d.avgScore)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        )}

                        {/* Heatmap por hora */}
                        <Card title="🕐 Score promedio por hora del día">
                            <div className="text-xs text-slate-500 mb-2">
                                Identifica horas con peor rendimiento — útil para detectar patrones (cansancio, cambio de turno).
                            </div>
                            <div className="grid grid-cols-12 md:grid-cols-24 gap-1">
                                {Array.from({ length: 24 }, (_, h) => {
                                    const key = String(h).padStart(2, '0');
                                    const v = data.heatmapByHour[key];
                                    const score = v?.avgScore;
                                    const bg = score == null ? 'bg-slate-100 text-slate-400' :
                                        score >= 85 ? 'bg-emerald-500 text-white' :
                                        score >= 60 ? 'bg-amber-400 text-white' :
                                        'bg-rose-500 text-white';
                                    return (
                                        <div key={h} className={`rounded text-center py-2 text-[10px] font-bold ${bg}`}
                                            title={v ? `${v.samples} pasos, score ${Math.round(score)}` : 'sin datos'}>
                                            <div>{key}h</div>
                                            <div className="text-[9px]">{score != null ? Math.round(score) : '—'}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    </>
                )}
            </div>
        </div>
    );
};

const Card = ({ title, children }) => (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-bold text-slate-700 mb-3">{title}</h2>
        {children}
    </div>
);
const Kpi = ({ label, value, subtitle, accent }) => (
    <div className={`rounded-xl border border-slate-200 p-3 ${accent || 'bg-white'}`}>
        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</div>
        <div className="text-2xl font-black mt-1">{value}</div>
        {subtitle && <div className="text-[10px] mt-0.5 opacity-70">{subtitle}</div>}
    </div>
);
const Stat = ({ label, value, highlight }) => (
    <div className={`rounded-lg p-2 ${highlight ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
        <div className="text-[10px] font-bold text-slate-500 uppercase">{label}</div>
        <div className={`text-base font-extrabold ${highlight ? 'text-emerald-700' : 'text-slate-700'}`}>{value}</div>
    </div>
);

export default TimingAnalysisPage;
