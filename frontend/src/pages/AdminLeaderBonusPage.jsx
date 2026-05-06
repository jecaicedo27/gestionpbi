import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ChevronLeft, RefreshCw, TrendingDown, TrendingUp, AlertTriangle, DollarSign, Users } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────
// AdminLeaderBonusPage
//
// Vista solo-ADMIN para revisar el bono mensual proyectado de cada líder.
// Modelo: $3.000.000 base por cuadrilla / mes (3 cuadrillas → $9M total).
// % del bonus se calcula sobre TODO el cronograma productivo del turno
// (BASES + ALGINATOS + PROTECCIÓN + ESFER), ponderado por tipo:
//   • BASE: peso 1.0 · ALGINATO: 0.8-1.0 · PROTECCIÓN: 0.7-0.8 · COMIDA/ALISTAMIENTO: 0
// Cada turno tiene su cronograma propio:
//   • Lun-Vie MAÑANA / TARDE: 7 BASE + 2 ALG + 2 PROT (suma weights ≈ 10)
//   • Lun-Vie NOCHE: 7 BASE + 3 ALG + 3 PROT (≈ 11.7)
//   • Sábado MAÑANA: 6 BASE + 2 ALG + 2 PROT
//   • Sábado TARDE: 5 BASE + 2 ALG + 2 PROT
//   • Domingo NOCHE arranque: 4 BASE + 3 ALG + 2 PROT (≈ 8.4) — sin presión inalcanzable
// pct = sum(weight de pasos hechos) / sum(weight de pasos productivos esperados)
// Si el equipo cumple TODO el cronograma → 100% del bonus de ese turno.
// FALLA registrada no penaliza. Adherencia (puntualidad) es informativa.
// FALLAS registradas no penalizan baches pero adherencia sigue aplicando.
// ──────────────────────────────────────────────────────────────────────

const SHIFT_LABEL = { MANANA: '☀️ Mañana', TARDE: '🌅 Tarde', NOCHE: '🌙 Noche' };
const fmtCOP = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const monthNow = () => new Date().toISOString().slice(0, 7);

const pctColor = (pct) => {
    if (pct >= 85) return 'bg-emerald-50 text-emerald-700 border-emerald-300';
    if (pct >= 60) return 'bg-amber-50 text-amber-700 border-amber-300';
    return 'bg-red-50 text-red-700 border-red-300';
};

const AdminLeaderBonusPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user?.role === 'ADMIN';

    const [month, setMonth]         = useState(monthNow());
    const [leaders, setLeaders]     = useState([]);
    const [leaderId, setLeaderId]   = useState('');
    const [data, setData]           = useState(null);
    const [loading, setLoading]     = useState(false);

    // Cargar líderes activos
    useEffect(() => {
        api.get('/shift-discipline/leader-ranking').then(r => {
            const list = (r.data?.data || [])
                .filter(g => g.leaderId)
                .map(g => ({ id: g.leaderId, name: g.leaderName }));
            setLeaders(list);
            if (list.length > 0 && !leaderId) setLeaderId(list[0].id);
        }).catch(() => {});
    }, []); // eslint-disable-line

    const load = useCallback(async () => {
        if (!leaderId) return;
        setLoading(true);
        try {
            const r = await api.get(`/shift-discipline/bonus?month=${month}&leaderId=${leaderId}`);
            setData(r.data);
        } catch (e) {
            console.warn('bonus load error:', e.message);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [month, leaderId]);

    useEffect(() => { load(); }, [load]);

    if (!isAdmin) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 text-red-700">
                    Acceso denegado. Esta sección es exclusiva para ADMIN.
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100">
                            <ChevronLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">💰 Bonificación de líderes</h1>
                            <p className="text-xs text-slate-500">Modelo de pérdida — base $3.000.000/mes/cuadrilla · vista ADMIN</p>
                        </div>
                    </div>
                    <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>

                {/* Filtros */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mes</label>
                            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Líder</label>
                            <select value={leaderId} onChange={e => setLeaderId(e.target.value)}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm">
                                <option value="">Selecciona…</option>
                                {leaders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                {loading && <div className="text-center text-slate-400 py-12">Calculando…</div>}

                {!loading && data && (
                    <>
                        {/* Resultado principal */}
                        <div className={`rounded-2xl border-4 p-6 mb-4 ${pctColor(data.percentRetained)}`}>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                                <div className="text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider opacity-70">% Retenido del mes</div>
                                    <div className="text-6xl font-black mt-1">{data.percentRetained}%</div>
                                    <div className="text-xs opacity-70 mt-1">{data.shiftsClosed} de {data.totalShiftsInMonth} turnos cerrados</div>
                                </div>
                                <div className="text-center md:border-l md:border-r border-current/30 px-4">
                                    <div className="text-xs font-bold uppercase tracking-wider opacity-70">Ganado hasta ahora</div>
                                    <div className="text-3xl font-black mt-1">{fmtCOP(data.totalEarned)}</div>
                                    <div className="text-xs opacity-70 mt-1">de {fmtCOP(data.baseBonus)} base</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider opacity-70">Por persona ({data.peoplePerGroup})</div>
                                    <div className="text-3xl font-black mt-1">{fmtCOP(Math.round(data.totalEarned / data.peoplePerGroup))}</div>
                                    <div className="text-xs opacity-70 mt-1">de {fmtCOP(data.baseBonusPerPerson)} base/persona</div>
                                </div>
                            </div>
                        </div>

                        {/* Mini KPIs */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <Kpi icon={<TrendingDown size={16} className="text-red-500" />}
                                label="Perdido en el mes" value={fmtCOP(data.totalLost)}
                                subtitle={`Por bajo cumplimiento + adherencia`} />
                            <Kpi icon={<TrendingUp size={16} className="text-emerald-500" />}
                                label="Máximo recuperable" value={fmtCOP(data.maxRecoverable)}
                                subtitle={`Si los ${data.shiftsRemaining} turnos restantes van 100%`} />
                            <Kpi icon={<DollarSign size={16} className="text-blue-500" />}
                                label="Valor por turno" value={fmtCOP(data.valuePerShift)}
                                subtitle="Base = total / # turnos del mes" />
                            <Kpi icon={<Users size={16} className="text-violet-500" />}
                                label="Proyección si 100%" value={fmtCOP(data.projectedTotal)}
                                subtitle={`= ${fmtCOP(data.projectedPerPerson)} c/u`} />
                        </div>

                        {/* Tabla de turnos */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                                <h2 className="font-bold text-slate-700">📋 Detalle por turno cerrado ({data.details.length})</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-100 border-b border-slate-200">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Fecha</th>
                                            <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Turno</th>
                                            <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Esfer</th>
                                            <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Bases</th>
                                            <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">% efectivo</th>
                                            <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Adher.</th>
                                            <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Falla</th>
                                            <th className="text-right px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Base</th>
                                            <th className="text-right px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Retenido</th>
                                            <th className="text-right px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Perdido</th>
                                            <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.details.length === 0 && (
                                            <tr><td colSpan={11} className="text-center py-8 text-slate-400">Sin turnos cerrados aún en este mes</td></tr>
                                        )}
                                        {data.details.map(d => {
                                            const pct = d.pctEfectivo ?? d.pctBaches ?? 0;
                                            const esfer = d.esfer ?? 0;
                                            const bases = d.bases ?? d.batches ?? 0;
                                            return (
                                            <tr key={d.runId} className="border-b border-slate-100 hover:bg-blue-50/40">
                                                <td className="px-3 py-2 font-medium text-slate-700">{d.date}</td>
                                                <td className="px-3 py-2 text-slate-600">{SHIFT_LABEL[d.shift] || d.shift}</td>
                                                <td className="px-3 py-2 text-center font-bold text-slate-700">{Number(esfer).toFixed(2)} <span className="text-[10px] text-slate-400">({d.pctEsfer ?? 0}%)</span></td>
                                                <td className="px-3 py-2 text-center font-bold text-slate-700">{Number(bases).toFixed(1)} <span className="text-[10px] text-slate-400">({d.pctBases ?? 0}%)</span></td>
                                                <td className={`px-3 py-2 text-center font-bold ${
                                                    pct >= 100 ? 'text-emerald-600' :
                                                    pct >= 75 ? 'text-blue-600' :
                                                    pct >= 50 ? 'text-amber-600' : 'text-red-600'
                                                }`}>{pct}%</td>
                                                <td className={`px-3 py-2 text-center font-bold ${
                                                    d.adherence >= 90 ? 'text-emerald-600' :
                                                    d.adherence >= 75 ? 'text-blue-600' :
                                                    d.adherence >= 60 ? 'text-amber-600' : 'text-red-600'
                                                }`}>{d.adherence}%</td>
                                                <td className="px-3 py-2 text-center">
                                                    {d.hadFailure ? <AlertTriangle size={14} className="text-amber-500 inline" /> : <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-slate-500">{fmtCOP(d.baseValue)}</td>
                                                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">{fmtCOP(d.retainedValue)}</td>
                                                <td className={`px-3 py-2 text-right font-mono font-bold ${d.lostValue > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                                                    {d.lostValue > 0 ? `−${fmtCOP(d.lostValue)}` : '—'}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-500">{d.reason}</td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Tabla de referencia */}
                        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                            <div className="font-bold mb-1">📐 Cómo se calcula:</div>
                            <div>• <b>Por turno:</b> valor = (base / # turnos del mes) × <b>% esfer extras</b> × <b>% cronograma soporte</b></div>
                            <div className="text-[11px] italic text-blue-600">  ↳ El bono se paga SOLO sobre las esferificaciones que la empresa empieza a ganar (las primeras son lo normal, cubiertas por el sueldo).</div>
                            <div className="mt-1">• <b>% esfer extras</b> (curva por meta del turno):</div>
                            <div className="ml-4 text-[11px]">– <b>Lun-Vie meta=7:</b> ≤4 = 0% (normal) · <b>5 = 20%</b> · <b>6 = 50%</b> · <b>7 = 100%</b></div>
                            <div className="ml-4 text-[11px]">– <b>Sáb-mañana meta=6:</b> ≤3 = 0% · 4 = 20% · 5 = 50% · 6 = 100%</div>
                            <div className="ml-4 text-[11px]">– <b>Sáb-tarde / Dom-noche arranque meta=3:</b> ≤1 = 0% · 2 = 20% · 3 = 100%</div>
                            <div className="mt-1">• <b>% cronograma soporte</b> (multiplicador 0–1) = pesos pasos hechos / pesos productivos esperados</div>
                            <div className="ml-4 text-[11px]">– Pesos: <b>BASE 1.0</b> · <b>ALGINATO 0.8–1.0</b> · <b>PROTECCIÓN 0.7–0.8</b> · COMIDA/ALISTAMIENTO 0</div>
                            <div className="ml-4 text-[11px] italic text-blue-600">  ↳ Si no cumple bases/alginatos/protección, descuenta proporcionalmente — sin soporte la cadena se rompe para la siguiente cuadrilla.</div>
                            <div>• <b>FALLA registrada:</b> mantiene 100% en esferificaciones — no penaliza</div>
                            <div>• <b>Adherencia (puntualidad):</b> métrica educativa, NO descuenta del bono</div>
                            <div>• <b>Cross-turnos:</b> un bache cuenta para el turno donde INICIA, aunque la esferificación caiga al siguiente</div>
                            <div>• <b>Reparto:</b> total ÷ {data.peoplePerGroup} personas (líder + operarios)</div>
                        </div>
                    </>
                )}

                {!loading && !data && leaderId && (
                    <div className="text-center text-slate-400 py-12">No hay datos disponibles para este líder y mes.</div>
                )}
                {!loading && !leaderId && (
                    <div className="text-center text-slate-400 py-12">Selecciona un líder para ver su bonificación proyectada.</div>
                )}
            </div>
        </div>
    );
};

const Kpi = ({ icon, label, value, subtitle }) => (
    <div className="rounded-xl bg-white border border-slate-200 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {icon}{label}
        </div>
        <div className="text-lg font-black text-slate-800 mt-1">{value}</div>
        {subtitle && <div className="text-[10px] text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
);

export default AdminLeaderBonusPage;
