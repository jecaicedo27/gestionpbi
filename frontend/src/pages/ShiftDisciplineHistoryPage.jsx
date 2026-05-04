import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { EsferificacionStrip } from '../components/ShiftDisciplineTimeline';

// ──────────────────────────────────────────────────────────────────────
// ShiftDisciplineHistoryPage
//
// Tabla histórica de runs disciplinadores cerrados, con filtros y un drawer
// que muestra la timeline reproducida en modo solo-lectura.
//
// Acceso: ADMIN y LIDER (operarios siguen viendo solo el turno actual en el
// componente ShiftDisciplineTimeline embebido en el panel de producción).
// ──────────────────────────────────────────────────────────────────────

const SHIFT_LABEL = { MANANA: '☀️ Mañana', TARDE: '🌅 Tarde', NOCHE: '🌙 Noche' };
const STEP_ICONS = { BASE: '🧪', ALGINATO: '🟡', PROTECCION: '🟢', COMIDA: '🍽️', ALISTAMIENTO: '🔧' };
const STEP_COLORS_DONE = {
    BASE: 'bg-emerald-500', ALGINATO: 'bg-amber-500', PROTECCION: 'bg-green-500', COMIDA: 'bg-slate-400', ALISTAMIENTO: 'bg-indigo-400'
};

const fmtTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const stepDisplayLabel = (step) => {
    if (step.type === 'BASE') {
        const num = step.label?.match(/#(\d+)/)?.[1] || step.label?.split(' ').pop() || '';
        return { line1: 'BASE', line2: `Liquipops #${num}` };
    }
    if (step.type === 'ALGINATO') {
        const num = step.label?.match(/#(\d+)/)?.[1] || '';
        const isHerencia = step.label?.toLowerCase().includes('herencia') || step.label?.toLowerCase().includes('cierre');
        return { line1: 'ALGINATO', line2: isHerencia ? `#${num} (cierre)` : `#${num}` };
    }
    if (step.type === 'PROTECCION') {
        const num = step.label?.match(/#(\d+)/)?.[1] || '';
        const isHerencia = step.label?.toLowerCase().includes('herencia') || step.label?.toLowerCase().includes('cierre');
        return { line1: 'PROTECCIÓN', line2: isHerencia ? `#${num} (cierre)` : `#${num}` };
    }
    if (step.type === 'COMIDA') return { line1: 'COMIDA', line2: '15-20 min' };
    return { line1: step.type, line2: step.label };
};

const gradeColor = (score) => {
    if (score == null) return 'bg-slate-50 text-slate-500';
    if (score >= 90) return 'bg-emerald-50 text-emerald-700';
    if (score >= 75) return 'bg-blue-50 text-blue-700';
    if (score >= 60) return 'bg-amber-50 text-amber-700';
    return 'bg-red-50 text-red-700';
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
};

const ShiftDisciplineHistoryPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Restringido a ADMIN / LIDER. Los demás roles no deberían entrar a esta ruta.
    const allowed = ['ADMIN', 'LIDER', 'PRODUCCION'].includes(user?.role);

    const [from, setFrom]               = useState(daysAgoISO(30));
    const [to, setTo]                   = useState(todayISO());
    const [shiftCode, setShiftCode]     = useState('');
    const [leaderId, setLeaderId]       = useState('');
    const [leaders, setLeaders]         = useState([]);
    const [rows, setRows]               = useState([]);
    const [total, setTotal]             = useState(0);
    const [page, setPage]               = useState(1);
    const [pageSize]                    = useState(50);
    const [loading, setLoading]         = useState(false);
    // Inline expand: cuando el usuario hace click en una fila, cargamos el
    // detalle completo y lo renderizamos como fila adicional debajo. Mejor que
    // drawer porque el usuario ve la lista + el detalle del turno seleccionado
    // en el mismo contexto y puede comparar.
    const [expandedId, setExpandedId]   = useState(null);
    const [detailById, setDetailById]   = useState({});      // cache: id → run
    const [loadingDetail, setLoadingDetail] = useState(null); // id en carga

    // Cargar líderes (de los runs ya cargados o pidiéndolos a /shift-discipline/leader-ranking)
    useEffect(() => {
        api.get('/shift-discipline/leader-ranking').then(r => {
            const list = (r.data?.data || [])
                .filter(g => g.leaderId)
                .map(g => ({ id: g.leaderId, name: g.leaderName }));
            setLeaders(list);
        }).catch(() => {});
    }, []);

    const load = useCallback(async () => {
        if (!allowed) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (from)      params.set('from', from);
            if (to)        params.set('to', to);
            if (shiftCode) params.set('shiftCode', shiftCode);
            if (leaderId)  params.set('leaderId', leaderId);
            params.set('page', String(page));
            params.set('pageSize', String(pageSize));
            const r = await api.get(`/shift-discipline/history?${params.toString()}`);
            setRows(r.data?.data || []);
            setTotal(r.data?.total || 0);
        } catch (e) {
            console.warn('load history error:', e.message);
            setRows([]); setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [from, to, shiftCode, leaderId, page, pageSize, allowed]);

    useEffect(() => { load(); }, [load]);

    // KPIs agregados sobre el rango filtrado
    const kpis = useMemo(() => {
        if (rows.length === 0) return null;
        const scores = rows.map(r => r.finalScore).filter(s => typeof s === 'number');
        const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        const best = rows.reduce((m, r) => (r.finalScore != null && (!m || r.finalScore > m.finalScore) ? r : m), null);
        const worst = rows.reduce((m, r) => (r.finalScore != null && (!m || r.finalScore < m.finalScore) ? r : m), null);
        const totalDone = rows.reduce((s, r) => s + (r.stepsDone || 0), 0);
        const totalSteps = rows.reduce((s, r) => s + (r.stepsTotal || 0), 0);
        const totalLate = rows.reduce((s, r) => s + (r.stepsLate || 0), 0);
        const adherence = totalSteps > 0 ? Math.round(((totalDone - totalLate) / totalSteps) * 100) : 0;
        return { avg, best, worst, totalDone, totalSteps, totalLate, adherence, count: rows.length };
    }, [rows]);

    const toggleExpand = async (rowId) => {
        if (expandedId === rowId) { setExpandedId(null); return; }
        setExpandedId(rowId);
        if (detailById[rowId]) return; // already cached
        setLoadingDetail(rowId);
        try {
            const r = await api.get(`/shift-discipline/runs/${rowId}`);
            setDetailById(prev => ({ ...prev, [rowId]: r.data?.data || null }));
        } catch (e) {
            console.warn('load run detail error:', e.message);
            setDetailById(prev => ({ ...prev, [rowId]: null }));
        } finally {
            setLoadingDetail(null);
        }
    };

    if (!allowed) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 text-red-700">
                    Acceso denegado. Esta sección requiere rol ADMIN, LIDER o PRODUCCION.
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
                            <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">📊 Historial de turnos disciplinador</h1>
                            <p className="text-xs text-slate-500">Resultados cerrados — Mañana / Tarde / Noche</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {user?.role === 'ADMIN' && (
                            <button onClick={() => navigate('/admin/leader-bonus')} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700">
                                💰 Bonificación líderes
                            </button>
                        )}
                        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Filtros */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Desde</label>
                            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Hasta</label>
                            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Turno</label>
                            <select value={shiftCode} onChange={e => { setShiftCode(e.target.value); setPage(1); }}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm">
                                <option value="">Todos</option>
                                <option value="MANANA">Mañana</option>
                                <option value="TARDE">Tarde</option>
                                <option value="NOCHE">Noche</option>
                            </select>
                        </div>
                        <div className="col-span-2 md:col-span-2">
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Líder</label>
                            <select value={leaderId} onChange={e => { setLeaderId(e.target.value); setPage(1); }}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm">
                                <option value="">Todos</option>
                                {leaders.map(l => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* KPIs */}
                {kpis && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                        <Kpi label="Turnos cerrados" value={kpis.count} />
                        <Kpi label="Score promedio" value={kpis.avg ?? '—'} accent={gradeColor(kpis.avg)} />
                        <Kpi label="Adherencia horario" value={`${kpis.adherence}%`} />
                        <Kpi label="Pasos hechos" value={`${kpis.totalDone}/${kpis.totalSteps}`} subtitle={`${kpis.totalLate} con retraso`} />
                        <Kpi label="Mejor / Peor"
                             value={kpis.best ? `${kpis.best.finalScore}` : '—'}
                             subtitle={kpis.worst ? `peor ${kpis.worst.finalScore}` : ''} />
                    </div>
                )}

                {/* Días especiales (festivos / no laborados) */}
                <NonWorkDaysCard />

                {/* Tabla */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 border-b border-slate-200">
                                <tr>
                                    <th className="w-8 px-2 py-2"></th>
                                    <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Fecha</th>
                                    <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Turno</th>
                                    <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Líder</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Score</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Grade</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Pasos</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Tarde</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Sin hacer</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Alertas</th>
                                    <th className="text-right px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Cerrado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan={11} className="text-center py-8 text-slate-400">Cargando…</td></tr>
                                )}
                                {!loading && rows.length === 0 && (
                                    <tr><td colSpan={11} className="text-center py-8 text-slate-400">Sin resultados en el rango seleccionado</td></tr>
                                )}
                                {!loading && rows.map(r => {
                                    const isExpanded = expandedId === r.id;
                                    const detail = detailById[r.id];
                                    return (
                                        <React.Fragment key={r.id}>
                                            <tr className={`border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/60' : ''}`}
                                                onClick={() => toggleExpand(r.id)}>
                                                <td className="text-center text-slate-400 px-2">{isExpanded ? '▼' : '▶'}</td>
                                                <td className="px-3 py-2 font-medium text-slate-700">{r.shiftDate}</td>
                                                <td className="px-3 py-2 text-slate-600">{SHIFT_LABEL[r.shiftCode] || r.shiftCode}</td>
                                                <td className="px-3 py-2 text-slate-600">{r.leaderName || '—'}</td>
                                                <td className={`px-3 py-2 text-center font-extrabold ${gradeColor(r.finalScore)}`}>{r.finalScore ?? '—'}</td>
                                                <td className="px-3 py-2 text-center font-bold text-slate-700">{r.finalGrade || '—'}</td>
                                                <td className="px-3 py-2 text-center text-slate-600">{r.stepsDone}/{r.stepsTotal}</td>
                                                <td className={`px-3 py-2 text-center font-bold ${r.stepsLate > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{r.stepsLate}</td>
                                                <td className={`px-3 py-2 text-center font-bold ${r.stepsMissed > 0 ? 'text-red-600' : 'text-slate-400'}`}>{r.stepsMissed}</td>
                                                <td className={`px-3 py-2 text-center ${r.alertsCount > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>{r.alertsCount}</td>
                                                <td className="px-3 py-2 text-right text-xs text-slate-400">
                                                    {r.closedAt ? new Date(r.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="bg-slate-50 border-b-2 border-blue-200">
                                                    <td colSpan={11} className="p-0">
                                                        <RunDetail
                                                            detail={detail}
                                                            loading={loadingDetail === r.id}
                                                            summary={r}
                                                            isAdmin={user?.role === 'ADMIN'}
                                                            onRecomputed={async () => {
                                                                setDetailById(prev => ({ ...prev, [r.id]: null }));
                                                                setLoadingDetail(r.id);
                                                                try {
                                                                    await api.post(`/shift-discipline/runs/${r.id}/recompute`);
                                                                    const fresh = await api.get(`/shift-discipline/runs/${r.id}`);
                                                                    setDetailById(prev => ({ ...prev, [r.id]: fresh.data?.data || null }));
                                                                    load(); // refresh table totals
                                                                } catch (e) {
                                                                    console.warn('recompute error:', e.message);
                                                                } finally {
                                                                    setLoadingDetail(null);
                                                                }
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {/* Paginación */}
                    {total > pageSize && (
                        <div className="flex items-center justify-between p-3 border-t border-slate-200 bg-slate-50">
                            <span className="text-xs text-slate-500">Página {page} · Total {total}</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                                    className="px-3 py-1 text-xs font-bold border border-slate-300 rounded disabled:opacity-40">Anterior</button>
                                <button disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)}
                                    className="px-3 py-1 text-xs font-bold border border-slate-300 rounded disabled:opacity-40">Siguiente</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────
// RunDetail — bloque desplegable con la timeline + tabla paso a paso
// del turno seleccionado. Pensado para que un líder pueda mostrarle al
// equipo punto por punto qué se hizo bien y qué se hizo mal.
// ──────────────────────────────────────────────────────────────────────
const RunDetail = ({ detail, loading, summary, isAdmin, onRecomputed }) => {
    const [recomputing, setRecomputing] = useState(false);
    if (loading) {
        return <div className="p-6 text-center text-slate-400">Cargando detalle del turno…</div>;
    }
    if (!detail) {
        return <div className="p-6 text-center text-red-500">No se pudo cargar el detalle.</div>;
    }
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const productive = steps.filter(s => s.type !== 'COMIDA');

    return (
        <div className="p-5 border-l-4 border-blue-400 bg-gradient-to-br from-blue-50/40 to-white">
            {/* Botón recalcular (admin only) */}
            {isAdmin && (
                <div className="flex justify-end mb-3">
                    <button
                        disabled={recomputing}
                        onClick={async () => {
                            setRecomputing(true);
                            try { await onRecomputed?.(); } finally { setRecomputing(false); }
                        }}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 disabled:opacity-50">
                        {recomputing ? '⏳ Recalculando…' : '🔁 Recalcular este turno'}
                    </button>
                </div>
            )}

            {/* Cronograma reproducido (pills) */}
            <div className="mb-5">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    📋 Cronograma reproducido — {detail.shiftDate} · {SHIFT_LABEL[detail.shiftCode] || detail.shiftCode}
                </div>
                <div className="flex flex-wrap gap-2">
                    {steps.map((step, idx) => {
                        const isComida = step.type === 'COMIDA';
                        const lbl = stepDisplayLabel(step);
                        const delta = typeof step.deltaMin === 'number' ? step.deltaMin : null;
                        const isLate     = step.doneAt && delta != null && delta > 15;
                        const isVeryLate = step.doneAt && delta != null && delta > 45;
                        const isOnTime   = step.doneAt && delta != null && Math.abs(delta) <= 15;
                        const isEarly    = step.doneAt && delta != null && delta < -5;

                        // Color base de la pill
                        let pillClass = 'bg-slate-50 border-slate-200 text-slate-500 border-dashed';
                        if (isComida) {
                            pillClass = 'bg-slate-100 border-slate-300 text-slate-600 border-dashed';
                        } else if (step.doneAt) {
                            pillClass = `${STEP_COLORS_DONE[step.type] || 'bg-slate-400'} border-transparent text-white`;
                        } else {
                            pillClass = 'bg-red-50 border-red-300 text-red-700';
                        }

                        // Sabor (solo BASE — los AUX no tienen flavor relevante)
                        const flavor = step.type === 'BASE' && step.actualFlavor
                            ? step.actualFlavor
                            : null;

                        return (
                            <div key={idx}
                                className={`min-w-[120px] rounded-lg border-2 overflow-hidden ${pillClass}`}
                                title={`${step.label} · ideal ${fmtTime(step.idealTime)}${step.doneAt ? ` · hecho ${fmtTime(step.doneAt)} (Δ${step.deltaMin ?? '?'}m, score ${step.score ?? '—'})${flavor ? ` · ${flavor}` : ''}` : ' · NO HECHO'}`}>
                                {/* Header con icono y tipo */}
                                <div className="px-2 py-1 text-center">
                                    <div className="flex items-center justify-center gap-1 leading-none">
                                        <span className="text-xs">{STEP_ICONS[step.type]}</span>
                                        <span className="text-[10px] font-black tracking-tight">{lbl.line1}</span>
                                    </div>
                                    <div className="text-[10px] font-semibold leading-tight mt-0.5 truncate">{lbl.line2}</div>
                                </div>

                                {/* Sabor (solo BASE hechas) */}
                                {flavor && (
                                    <div className="bg-white/25 backdrop-blur-sm px-1.5 py-0.5 text-center">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider">
                                            🫧 {flavor}
                                        </span>
                                    </div>
                                )}

                                {/* Hora ideal */}
                                <div className="px-2 pt-1 text-center text-[10px] font-bold opacity-90">
                                    {fmtTime(step.idealTime)}
                                </div>

                                {/* Hora real + delta + score */}
                                {step.doneAt ? (
                                    <>
                                        <div className="px-2 text-center text-[10px] mt-0.5 opacity-90 flex items-center justify-center gap-1">
                                            <span>→</span>
                                            <span className="font-bold">{fmtTime(step.doneAt)}</span>
                                            {isOnTime && <span className="text-[8px]">✓</span>}
                                            {isEarly && <span className="text-[8px]">↩</span>}
                                        </div>
                                        {/* Tag de retraso integrado al pie */}
                                        {isLate && (
                                            <div className={`mt-0.5 px-2 py-0.5 text-center text-[10px] font-extrabold ${
                                                isVeryLate ? 'bg-red-700/30' : 'bg-black/20'
                                            }`}>
                                                ⏱ Tarde +{delta}m
                                            </div>
                                        )}
                                        {typeof step.score === 'number' && (
                                            <div className="px-2 pb-1 text-center text-[10px] font-black mt-0.5">
                                                ★ {step.score}
                                            </div>
                                        )}
                                    </>
                                ) : (!isComida && (
                                    <div className="px-2 pb-1 text-center text-[10px] font-bold mt-0.5">
                                        ✖ no hecho
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Esferificación de la cuadrilla en el turno */}
            {detail.esferificacion && (
                <div className="mb-5 p-3 rounded-xl bg-gradient-to-br from-purple-50/60 to-white border border-purple-200">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        🫧 Esferificación de la cuadrilla
                    </div>
                    <EsferificacionStrip data={detail.esferificacion} />
                </div>
            )}

            {/* Tabla paso a paso */}
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                <table className="w-full text-xs">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="text-left px-2 py-1.5 font-bold text-slate-600 uppercase">#</th>
                            <th className="text-left px-2 py-1.5 font-bold text-slate-600 uppercase">Tarea</th>
                            <th className="text-center px-2 py-1.5 font-bold text-slate-600 uppercase">Hora ideal</th>
                            <th className="text-center px-2 py-1.5 font-bold text-slate-600 uppercase">Hora real</th>
                            <th className="text-center px-2 py-1.5 font-bold text-slate-600 uppercase">Δ min</th>
                            <th className="text-center px-2 py-1.5 font-bold text-slate-600 uppercase">Score</th>
                            <th className="text-left px-2 py-1.5 font-bold text-slate-600 uppercase">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {steps.map((step, idx) => {
                            const lbl = stepDisplayLabel(step);
                            const isComida = step.type === 'COMIDA';
                            const done = !!step.doneAt;
                            const delta = typeof step.deltaMin === 'number' ? step.deltaMin : null;
                            let estado = '—';
                            let estadoClass = 'text-slate-500';
                            if (isComida) { estado = '🍽️ Pausa comida'; estadoClass = 'text-slate-500'; }
                            else if (!done) { estado = '✖ No realizado'; estadoClass = 'text-red-600 font-bold'; }
                            else if (delta == null) { estado = '✓ Hecho'; estadoClass = 'text-emerald-600 font-bold'; }
                            else if (Math.abs(delta) <= 5) { estado = '✓ A tiempo'; estadoClass = 'text-emerald-600 font-bold'; }
                            else if (delta < 0) { estado = `✓ Adelantado ${Math.abs(delta)}m`; estadoClass = 'text-emerald-600 font-bold'; }
                            else if (delta <= 15) { estado = `⚠️ Tarde +${delta}m`; estadoClass = 'text-amber-600 font-bold'; }
                            else if (delta <= 45) { estado = `🟠 Iniciado tarde +${delta}m`; estadoClass = 'text-orange-600 font-bold'; }
                            else { estado = `🔴 Muy tarde +${delta}m`; estadoClass = 'text-red-600 font-bold'; }
                            return (
                                <tr key={idx} className={`border-t border-slate-100 ${isComida ? 'bg-slate-50/50' : ''}`}>
                                    <td className="px-2 py-1.5 text-slate-400">{idx + 1}</td>
                                    <td className="px-2 py-1.5">
                                        <span className="mr-1">{STEP_ICONS[step.type]}</span>
                                        <span className="font-bold text-slate-700">{lbl.line1}</span>
                                        <span className="text-slate-500"> · {lbl.line2}</span>
                                        {step.type === 'BASE' && step.actualFlavor && (
                                            <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-extrabold uppercase tracking-wider">
                                                🫧 {step.actualFlavor}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center font-mono text-slate-600">{fmtTime(step.idealTime)}</td>
                                    <td className="px-2 py-1.5 text-center font-mono text-slate-600">{done ? fmtTime(step.doneAt) : '—'}</td>
                                    <td className={`px-2 py-1.5 text-center font-bold ${
                                        delta == null ? 'text-slate-400' :
                                        delta <= 5 ? 'text-emerald-600' :
                                        delta <= 15 ? 'text-amber-600' : 'text-red-600'
                                    }`}>{delta != null ? `${delta > 0 ? '+' : ''}${delta}` : '—'}</td>
                                    <td className="px-2 py-1.5 text-center font-extrabold text-slate-700">
                                        {isComida ? '—' : (typeof step.score === 'number' ? step.score : (done ? '—' : '0'))}
                                    </td>
                                    <td className={`px-2 py-1.5 ${estadoClass}`}>{estado}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Resumen ejecutivo */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-white border border-slate-200 p-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Líder</div>
                    <div className="font-bold text-slate-700">{detail.leaderName || '—'}</div>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 p-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Hechos / Total</div>
                    <div className="font-bold text-slate-700">
                        {productive.filter(s => s.doneAt).length}/{productive.length}
                    </div>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 p-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Score final</div>
                    <div className={`font-extrabold ${gradeColor(detail.finalScore)} px-2 rounded`}>
                        {detail.finalScore ?? '—'} · {detail.finalGrade || '—'}
                    </div>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 p-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Cerrado</div>
                    <div className="font-bold text-slate-700">
                        {detail.closedAt ? new Date(detail.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </div>
                </div>
            </div>

            {/* Alertas push */}
            {Array.isArray(detail.alertedSteps) && detail.alertedSteps.length > 0 && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <span className="font-bold">⚠️ Alertas push enviadas ({detail.alertedSteps.length}):</span>{' '}
                    {detail.alertedSteps.map(s => String(s)).join(', ')}
                </div>
            )}
        </div>
    );
};

// Tarjeta de administración de días especiales (festivos / no laborados).
// Lee/escribe systemSettings.NON_WORK_DAYS vía /api/shift-discipline/non-work-days.
const NonWorkDaysCard = () => {
    const [days, setDays] = useState([]);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ date: '', reason: '' });
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const r = await api.get('/shift-discipline/non-work-days');
            setDays(r.data?.data || []);
        } catch (e) { console.warn('load non-work-days', e?.message); }
    };
    useEffect(() => { load(); }, []);

    const add = async (e) => {
        e.preventDefault();
        if (!form.date) return;
        setBusy(true);
        try {
            const r = await api.post('/shift-discipline/non-work-days', form);
            setDays(r.data?.data || []);
            setForm({ date: '', reason: '' });
            setAdding(false);
            if (r.data?.runsDeleted > 0) {
                alert(`✓ Día marcado. Se borraron ${r.data.runsDeleted} run(s) afectados — ya no se cuentan en el promedio.`);
            }
        } catch (err) {
            alert('Error: ' + (err.response?.data?.error || err.message));
        }
        setBusy(false);
    };

    const remove = async (date) => {
        if (!confirm(`¿Quitar marca de ${date}? Los runs no se restauran (si quieres re-evaluar tendrás que recrearlos).`)) return;
        setBusy(true);
        try {
            const r = await api.delete(`/shift-discipline/non-work-days/${date}`);
            setDays(r.data?.data || []);
        } catch (err) {
            alert('Error: ' + (err.response?.data?.error || err.message));
        }
        setBusy(false);
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="text-sm font-bold text-slate-700">📅 Días especiales (festivos / no laborados)</div>
                    <div className="text-[11px] text-slate-500">Estos días no se crean runs y se excluyen del promedio</div>
                </div>
                <button onClick={() => setAdding(!adding)}
                    className="px-3 py-1.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold hover:bg-amber-200">
                    {adding ? '✕ Cancelar' : '+ Marcar día'}
                </button>
            </div>
            {adding && (
                <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Fecha</label>
                        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                            required className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Razón (opcional)</label>
                        <input type="text" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                            placeholder="Ej: Festivo Día del Trabajo"
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                    </div>
                    <button type="submit" disabled={busy}
                        className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                        {busy ? '⏳' : 'Guardar'}
                    </button>
                </form>
            )}
            {days.length === 0 ? (
                <div className="text-xs text-slate-400 italic">No hay días marcados. Domingo y sábado-noche se excluyen automáticamente.</div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {days.map(d => (
                        <div key={d.date} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
                            <span className="font-bold text-amber-800">{d.date}</span>
                            <span className="text-slate-600 text-[11px]">{d.reason}</span>
                            <button onClick={() => remove(d.date)} className="text-red-500 hover:text-red-700 font-bold">✕</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const Kpi = ({ label, value, subtitle, accent }) => (
    <div className={`rounded-2xl border border-slate-200 p-3 ${accent || 'bg-white'}`}>
        <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</div>
        <div className="text-2xl font-black mt-1">{value}</div>
        {subtitle && <div className="text-[11px] mt-0.5 opacity-70">{subtitle}</div>}
    </div>
);

export default ShiftDisciplineHistoryPage;
