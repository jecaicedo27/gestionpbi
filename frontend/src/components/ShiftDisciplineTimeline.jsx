import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

// Tonos de alerta sonora (Web Audio API)
const playBeep = (freq, duration = 200, volume = 0.15) => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.value = volume;
        osc.start(); osc.stop(ctx.currentTime + duration / 1000);
    } catch {}
};

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

const STEP_ICONS = { BASE: '🧪', ALGINATO: '🟡', PROTECCION: '🟢', COMIDA: '🍽️', ALISTAMIENTO: '🔧' };
const STEP_COLORS_DONE = { BASE: 'bg-emerald-500', ALGINATO: 'bg-amber-500', PROTECCION: 'bg-green-500', COMIDA: 'bg-slate-400', ALISTAMIENTO: 'bg-indigo-400' };

// Etiqueta visible en la pill — más descriptiva
const stepDisplayLabel = (step) => {
    if (step.type === 'BASE') {
        const num = step.label.match(/#(\d+)/)?.[1] || step.label.split(' ').pop();
        return { line1: 'BASE', line2: `Liquipops #${num}` };
    }
    if (step.type === 'ALGINATO') {
        const num = step.label.match(/#(\d+)/)?.[1] || '';
        const isHerencia = step.label.toLowerCase().includes('herencia') || step.label.toLowerCase().includes('cierre');
        return { line1: 'ALGINATO', line2: isHerencia ? `#${num} (cierre)` : `#${num}` };
    }
    if (step.type === 'PROTECCION') {
        const num = step.label.match(/#(\d+)/)?.[1] || '';
        const isHerencia = step.label.toLowerCase().includes('herencia') || step.label.toLowerCase().includes('cierre');
        return { line1: 'PROTECCIÓN', line2: isHerencia ? `#${num} (cierre)` : `#${num}` };
    }
    if (step.type === 'COMIDA') {
        return { line1: 'COMIDA', line2: '15-20 min' };
    }
    return { line1: step.type, line2: step.label };
};

const stepStatus = (step, now) => {
    const ideal = new Date(step.idealTime).getTime();
    const delta = now - ideal; // ms
    // COMIDA es informativa: solo "now" durante su ventana, sin penalización por retraso
    if (step.type === 'COMIDA') {
        if (delta < -2 * 60000) return { status: 'pending' };
        if (delta < 20 * 60000) return { status: 'now' }; // ventana de 20 min
        return { status: 'past' };
    }
    if (step.doneAt) return { status: 'done', score: step.score };
    if (delta < -2 * 60000) return { status: 'pending' };
    if (delta < 5 * 60000) return { status: 'now' };
    if (delta < 15 * 60000) return { status: 'late' };
    return { status: 'very-late' };
};

const ShiftDisciplineTimeline = () => {
    const [run, setRun] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [previousRun, setPreviousRun] = useState(null);
    const [showPrevModal, setShowPrevModal] = useState(false);
    const refreshTimer = useRef(null);
    const tickTimer = useRef(null);
    const lastAlertRef = useRef({}); // por stepN, último beep

    const fetchCurrent = useCallback(async () => {
        try {
            const { data } = await api.get('/shift-discipline/current');
            if (data?.data) setRun(data.data);
        } catch (e) { console.warn('[discipline] fetch error', e.message); }
    }, []);

    const fetchPrevious = useCallback(async () => {
        try {
            const { data } = await api.get('/shift-discipline/previous');
            if (data?.data?.id !== previousRun?.id) {
                setPreviousRun(data?.data || null);
                if (data?.data && !sessionStorage.getItem(`prev_seen_${data.data.id}`)) {
                    setShowPrevModal(true);
                    sessionStorage.setItem(`prev_seen_${data.data.id}`, '1');
                }
            }
        } catch {}
    }, [previousRun?.id]);

    useEffect(() => {
        fetchCurrent();
        fetchPrevious();
        refreshTimer.current = setInterval(fetchCurrent, 120000); // re-sync con BD cada 2 min
        tickTimer.current = setInterval(() => setNow(Date.now()), 30000); // tick local cada 30 s
        return () => { clearInterval(refreshTimer.current); clearInterval(tickTimer.current); };
    }, [fetchCurrent, fetchPrevious]);

    // Alertas sonoras al pasar steps por umbrales
    useEffect(() => {
        if (!run?.steps) return;
        const steps = Array.isArray(run.steps) ? run.steps : JSON.parse(run.steps);
        for (const step of steps) {
            if (step.type === 'COMIDA') continue; // sin alarma para descansos
            const ideal = new Date(step.idealTime).getTime();
            const delta = now - ideal;
            const key = `${step.n}`;
            const last = lastAlertRef.current[key] || 0;
            if (step.doneAt) continue;
            // -2 min: beep suave
            if (delta >= -2 * 60000 && delta < -1.5 * 60000 && last < 1) {
                playBeep(700, 150, 0.1);
                lastAlertRef.current[key] = 1;
            }
            // +5 min: beep moderado
            else if (delta >= 5 * 60000 && delta < 6 * 60000 && last < 2) {
                playBeep(500, 250, 0.18);
                lastAlertRef.current[key] = 2;
            }
            // +15 min: alarma fuerte
            else if (delta >= 15 * 60000 && delta < 16 * 60000 && last < 3) {
                playBeep(350, 600, 0.25);
                setTimeout(() => playBeep(350, 600, 0.25), 800);
                lastAlertRef.current[key] = 3;
            }
        }
    }, [now, run?.steps]);

    if (!run) return null;
    const steps = Array.isArray(run.steps) ? run.steps : JSON.parse(run.steps);
    const shiftLabel = { MANANA: '🌅 Mañana', TARDE: '☀️ Tarde', NOCHE: '🌙 Noche' }[run.shiftCode];

    // Próximo step pendiente (sin contar COMIDA que es informativa)
    const productiveSteps = steps.filter(s => s.type !== 'COMIDA');
    const nextStep = productiveSteps.find(s => !s.doneAt);
    const nextDelta = nextStep ? Math.round((new Date(nextStep.idealTime).getTime() - now) / 60000) : null;

    // Resumen estado
    const doneCount = productiveSteps.filter(s => s.doneAt).length;
    const lateCount = productiveSteps.filter(s => !s.doneAt && now - new Date(s.idealTime).getTime() > 5 * 60000).length;
    const overallStatus = lateCount === 0 ? 'good' : lateCount <= 2 ? 'warn' : 'bad';
    const statusColor = { good: 'bg-emerald-50 border-emerald-300 text-emerald-800',
                          warn: 'bg-amber-50 border-amber-300 text-amber-800',
                          bad: 'bg-red-50 border-red-300 text-red-800' }[overallStatus];

    // Score parcial del LÍDER de fabricación de bases.
    // Promedio ponderado de los steps con score asignado: los hechos (con su
    // score real) + los muy atrasados sin hacer (score 0). Los pendientes que
    // aún no han llegado a su tiempo no penalizan.
    const scoredSteps = productiveSteps.filter(s => s.doneAt || (now - new Date(s.idealTime).getTime()) > 90 * 60000);
    let leaderScore = null, leaderLabel = null, leaderLevel = null;
    if (scoredSteps.length > 0) {
        const totalW = scoredSteps.reduce((s, st) => s + (st.weight ?? 1), 0);
        const sumW   = scoredSteps.reduce((s, st) => s + ((st.score || 0) * (st.weight ?? 1)), 0);
        leaderScore  = totalW > 0 ? Math.round(sumW / totalW) : null;
        if (leaderScore != null) {
            if (leaderScore >= 90)      { leaderLabel = '🥇 Excelente';  leaderLevel = 'excellent'; }
            else if (leaderScore >= 75) { leaderLabel = '⚡ Bueno';       leaderLevel = 'good'; }
            else if (leaderScore >= 60) { leaderLabel = '⚠ Mejorable';  leaderLevel = 'warn'; }
            else                        { leaderLabel = '🐢 Bajo';       leaderLevel = 'bad'; }
        }
    }

    // Mensaje motivacional sólo cuando hay alerta (warn/bad). Cuando todo va
    // bien, el badge de score arriba es suficiente — sin texto extra.
    let motivacional = '';
    if (overallStatus === 'warn') {
        motivacional = `⚠️ ${lateCount} tarea${lateCount > 1 ? 's' : ''} con retraso${nextStep ? ` · sigue: ${nextStep.label}` : ''}`;
    } else if (overallStatus === 'bad') {
        motivacional = `🔴 ${lateCount} atrasadas${nextStep ? ` · sigue: ${nextStep.label}` : ''}`;
    }

    return (
        <>
            <div className={`mb-2 rounded-lg border px-2 py-1.5 ${statusColor}`}>
                {/* HEADER del turno: hechos · TURNO GRANDE CENTRADO · historial+reloj */}
                <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="font-semibold opacity-80 flex-1">
                        {doneCount}/{productiveSteps.length} hechos
                        {nextStep && <> · próx <b>{stepDisplayLabel(nextStep).line2 || stepDisplayLabel(nextStep).line1}</b> {fmtTime(nextStep.idealTime)}</>}
                    </span>
                    <span className="font-extrabold text-base tracking-tight text-center">
                        {shiftLabel} <span className="opacity-75 font-bold text-sm">{fmtTime(run.shiftStart)}–{fmtTime(run.shiftEnd)}</span>
                    </span>
                    <span className="flex items-center justify-end gap-2 flex-1">
                        <a href="/shift-discipline/history"
                            onClick={(e) => { e.preventDefault(); window.location.href = '/shift-discipline/history'; }}
                            className="font-bold underline opacity-75 hover:opacity-100">📊 Historial</a>
                        <span className="font-bold tabular-nums">{new Date(now).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                </div>

                {/* FILA 1 — LÍDER BASES: etiqueta IZQUIERDA · pills CENTRO · score GRANDE DERECHA */}
                <div className="flex items-center gap-2">
                    <span className="font-extrabold uppercase tracking-wide bg-white/70 px-2 py-1 rounded border border-current/20 whitespace-nowrap text-[11px] shrink-0 min-w-[120px] text-center">
                        🧑‍🏭 Líder Bases
                    </span>
                    <div className="flex items-stretch gap-0.5 overflow-x-auto pb-0.5 flex-1">
                    {steps.map((step, idx) => {
                        const st = stepStatus(step, now);
                        const isComida = step.type === 'COMIDA';
                        let pillClass = 'bg-white border-slate-200 text-slate-500';
                        if (isComida) {
                            pillClass = st.status === 'now'
                                ? 'bg-slate-200 border-slate-400 text-slate-700 animate-pulse'
                                : 'bg-slate-50 border-slate-200 text-slate-500 border-dashed';
                        } else if (st.status === 'done') pillClass = `${STEP_COLORS_DONE[step.type]} border-transparent text-white`;
                        else if (st.status === 'now') pillClass = 'bg-blue-100 border-blue-400 text-blue-800 animate-pulse';
                        else if (st.status === 'late') pillClass = 'bg-amber-100 border-amber-400 text-amber-800';
                        else if (st.status === 'very-late') pillClass = 'bg-red-100 border-red-500 text-red-800 animate-pulse';
                        const num = (step.label.match(/#(\d+)/)?.[1]) || '';
                        const typeLabel = isComida ? 'COMIDA'
                            : step.type === 'BASE' ? `BASE #${num}`
                            : step.type === 'ALGINATO' ? `ALGINATO #${num}`
                            : step.type === 'PROTECCION' ? `PROT #${num}`
                            : step.type;
                        return (
                            <div key={idx}
                                 className={`flex-shrink-0 min-w-[82px] rounded border px-1.5 py-1 text-center ${pillClass}`}
                                 title={`${step.label} · ideal ${fmtTime(step.idealTime)}${step.doneAt ? ` · hecho ${fmtTime(step.doneAt)} (Δ${step.deltaMin}m, ★${step.score})` : ''}`}>
                                <div className="flex items-center justify-center gap-1 leading-none">
                                    <span className="text-[11px]">{STEP_ICONS[step.type]}</span>
                                    <span className="text-[10px] font-black tracking-tight">{typeLabel}</span>
                                </div>
                                <div className="text-[10px] font-bold opacity-90 leading-tight tabular-nums mt-0.5">{fmtTime(step.idealTime)}</div>
                                {st.status === 'done' && st.score !== null && (
                                    <div className="text-[10px] font-black leading-tight">★{step.score}</div>
                                )}
                            </div>
                        );
                    })}
                    </div>
                    {/* Score GRANDE del líder de bases a la derecha (presión visual) */}
                    {leaderLabel && (
                        <div className={`shrink-0 min-w-[100px] text-center px-2 py-1 rounded-lg font-extrabold ${
                            leaderLevel === 'excellent' ? 'bg-emerald-100 text-emerald-700'
                            : leaderLevel === 'good'    ? 'bg-blue-100 text-blue-700'
                            : leaderLevel === 'warn'    ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                            title={`Score parcial del líder de bases: ${leaderScore}/100`}>
                            <div className="text-lg leading-none">{leaderLabel.split(' ')[0]}</div>
                            <div className="text-[10px] uppercase mt-0.5 tracking-wide">{leaderLabel.split(' ').slice(1).join(' ')}</div>
                        </div>
                    )}
                </div>

                {/* Mensaje motivacional del líder de bases (NO de esferificación) */}
                {motivacional && (
                    <div className="mt-1 text-[11px] font-bold text-center opacity-90">{motivacional}</div>
                )}

                {/* Mini-tira de esferificaciones (meta 7 cuadrilla) — sin motivacional propio */}
                {run?.esferificacion && (
                    <EsferificacionStrip data={run.esferificacion} />
                )}
            </div>

            {/* Modal calificación turno anterior */}
            {showPrevModal && previousRun && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowPrevModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 mb-1">Calificación del turno anterior</h2>
                        <p className="text-xs text-slate-500 mb-4">{previousRun.shiftDate} · {previousRun.shiftCode}</p>
                        <div className={`text-center py-6 rounded-xl ${
                            previousRun.finalScore >= 90 ? 'bg-emerald-50 text-emerald-700' :
                            previousRun.finalScore >= 75 ? 'bg-blue-50 text-blue-700' :
                            previousRun.finalScore >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                        }`}>
                            <div className="text-6xl font-black">{previousRun.finalScore}</div>
                            <div className="text-2xl font-bold mt-2">{previousRun.finalGrade}</div>
                        </div>
                        <button onClick={() => setShowPrevModal(false)} className="mt-4 w-full bg-slate-800 text-white font-bold py-2.5 rounded-lg hover:bg-slate-700 transition-colors">
                            Continuar
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

// ──────────────────────────────────────────────────────────────────────
// EsferificacionStrip — 7 slots horizontales que muestran el avance de
// esferificación de la cuadrilla en el turno. Crédito proporcional al
// tiempo de cronómetro dentro del turno (cuadrillas que cruzan reciben
// mérito ambas, no se penaliza por no terminar).
// ──────────────────────────────────────────────────────────────────────
const fmtMin = (m) => {
    if (m == null) return '';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r === 0 ? `${h}h` : `${h}h${r}m`;
};

export const EsferificacionStrip = ({ data }) => {
    const { target = 7, meritFractional = 0, inProgressCount = 0,
            avgAdherence = null, baches = [],
            expectedAtNow = null, paceLabel = null, paceLevel = null } = data || {};

    // Mensaje motivacional sólo en alerta. Incluye conversión a tiempo:
    // turno 8h ÷ 7 baches = ~68 min/bache → gap_min = gap_baches × 68.
    const MIN_PER_BATCH = Math.round(480 / target); // ~68 min
    let esferMsg = '';
    if (expectedAtNow != null) {
        const gap = Math.round((expectedAtNow - meritFractional) * 10) / 10;
        const gapMin = Math.round(gap * MIN_PER_BATCH);
        const lateLabel = gapMin >= 60
            ? `${Math.floor(gapMin / 60)}h ${gapMin % 60}m`
            : `${gapMin} min`;
        if (paceLevel === 'warn' && gap > 0) {
            esferMsg = `⚠️ Faltan ${gap} baches (≈ ${lateLabel} de atraso) para el ritmo esperado`;
        } else if (paceLevel === 'bad' && gap > 0) {
            esferMsg = `🔴 Atrasados ${lateLabel} (${gap} baches) · ¡Aceleren!`;
        }
    }

    const sorted = [...baches];
    const slots = Array.from({ length: target }).map((_, i) => sorted[i] || null);

    const slotStyle = (slot) => {
        if (!slot) return { bg: 'bg-slate-50', border: 'border-dashed border-slate-300', text: 'text-slate-400', icon: '' };
        if (slot.status === 'done_good') return { bg: 'bg-emerald-500',  border: 'border-emerald-600', text: 'text-white', icon: '✓' };
        if (slot.status === 'done_late') return { bg: 'bg-amber-400',    border: 'border-amber-500',   text: 'text-white', icon: '✓' };
        if (slot.status === 'done_bad')  return { bg: 'bg-rose-500',     border: 'border-rose-600',    text: 'text-white', icon: '✓' };
        const overTime = (slot.elapsedNetMin || 0) > 120;
        if (slot.status === 'paused')    return { bg: overTime ? 'bg-rose-200 animate-pulse' : 'bg-orange-100', border: overTime ? 'border-rose-500' : 'border-orange-400', text: overTime ? 'text-rose-900' : 'text-orange-800', icon: '⏸' };
        if (slot.status === 'in_progress') return { bg: overTime ? 'bg-rose-200 animate-pulse' : 'bg-blue-100 animate-pulse', border: overTime ? 'border-rose-500' : 'border-blue-400', text: overTime ? 'text-rose-900' : 'text-blue-800', icon: overTime ? '⚠' : '◐' };
        return { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-400', icon: '' };
    };

    // Helper para extraer el sufijo del batchNumber (últimos 4 dígitos =
    // hora de creación del bache, ej. "MARACUYA-260429-2123" → "2123").
    const lotSuffix = (bn) => {
        if (!bn) return '';
        const parts = bn.split('-');
        return parts[parts.length - 1] || '';
    };

    // Una sola fila alineada con la del Líder: etiqueta izq · slots centro · score derecho
    return (
        <div className="mt-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="font-extrabold uppercase tracking-wide bg-white/70 text-slate-700 px-2 py-1 rounded border border-slate-300 whitespace-nowrap shrink-0 min-w-[120px] text-center">
                🫧 Esferificación
            </span>
            <div className="flex gap-0.5 flex-1 min-w-0 overflow-x-auto">
                {slots.map((slot, i) => {
                    const st = slotStyle(slot);
                    const flavor = slot?.flavor || '';
                    const lot = lotSuffix(slot?.batchNumber);
                    const isActive = slot?.status === 'in_progress' || slot?.status === 'paused';
                    return (
                        <div key={i}
                             className={`relative shrink-0 rounded border ${st.bg} ${st.border} flex flex-col items-center justify-center px-0.5 py-0.5 leading-none`}
                             style={{ width: '64px', minHeight: '34px' }}
                             title={slot
                                ? `${slot.batchNumber || slot.flavor || 'bache'}\n` +
                                  `Inicio: ${fmtTime(slot.startedAt)}` +
                                  (slot.endedAt ? `\nFin: ${fmtTime(slot.endedAt)} (${fmtMin(slot.elapsedNetMin)})` : `\nEn curso: ${fmtMin(slot.elapsedMin)}`) +
                                  (slot.operatorName ? `\nOp: ${slot.operatorName}` : '') +
                                  (slot.isInherited ? '\n↩ Heredado' : '') +
                                  `\nMérito cuadrilla: ${Math.round(slot.fraction * 100)}%` +
                                  (slot.score != null ? `\nScore: ${slot.score}` : '')
                                : `Slot ${i + 1} pendiente`}>
                            {slot ? (
                                <>
                                    {/* Línea 1: sabor abreviado */}
                                    <div className={`text-[9px] font-black ${st.text} truncate w-full text-center leading-tight`}>
                                        {flavor.length > 8 ? flavor.slice(0, 8) : (flavor || '—')}
                                    </div>
                                    {/* Línea 2: estado/tiempo */}
                                    <div className={`text-[8px] font-bold ${st.text} flex items-center justify-center gap-0.5 w-full leading-tight`}>
                                        {slot.status === 'paused' && <span>⏸</span>}
                                        {slot.status === 'in_progress' && <span>◐</span>}
                                        {isActive ? <span>{fmtMin(slot.elapsedMin)}</span> : <span>{st.icon}</span>}
                                    </div>
                                    {/* Línea 3: lote (más grande, más legible) */}
                                    {lot && (
                                        <div className={`text-[10px] font-extrabold ${st.text} opacity-85 leading-tight`}>
                                            {lot}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <span className="text-[9px] text-slate-300">—</span>
                            )}
                            {slot?.isInherited && (
                                <span className="absolute -top-1 -right-1 text-[7px] bg-violet-500 text-white w-2.5 h-2.5 flex items-center justify-center rounded-full font-bold">↩</span>
                            )}
                        </div>
                    );
                })}
            </div>
            {/* Score GRANDE de esferificación a la derecha (presión visual) */}
            {paceLabel && (() => {
                const cls = paceLevel === 'excellent' ? 'bg-emerald-100 text-emerald-700'
                    : paceLevel === 'good'   ? 'bg-blue-100 text-blue-700'
                    : paceLevel === 'warn'   ? 'bg-amber-100 text-amber-700'
                    : 'bg-rose-100 text-rose-700';
                return (
                    <div className={`shrink-0 min-w-[100px] text-center px-2 py-1 rounded-lg font-extrabold ${cls}`}
                          title={`${meritFractional.toFixed(1)}/${target} esferificaciones · Esperado: ${expectedAtNow ?? '—'} · Adherencia: ${avgAdherence ?? '—'}/100`}>
                        <div className="text-base leading-none tabular-nums">{meritFractional.toFixed(1)}/{target}</div>
                        <div className="text-[10px] uppercase mt-0.5 tracking-wide flex items-center justify-center gap-1">
                            {paceLabel}
                            {inProgressCount > 0 && <span className="text-blue-600">◐{inProgressCount}</span>}
                        </div>
                    </div>
                );
            })()}
          </div>
          {esferMsg && (
              <div className="mt-1 font-bold opacity-90 text-center">{esferMsg}</div>
          )}
        </div>
    );
};

export default ShiftDisciplineTimeline;
