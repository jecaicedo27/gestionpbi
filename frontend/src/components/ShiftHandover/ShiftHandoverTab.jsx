import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Calendar, Filter } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import OperatorSignaturePanel from './OperatorSignaturePanel';
import LeaderAuthorizationPanel from './LeaderAuthorizationPanel';
import IncomingLeaderPanel from './IncomingLeaderPanel';
import HandoverTimeline from './HandoverTimeline';
import HandoverHistory from './HandoverHistory';
import HandoverSimulationPanel from './HandoverSimulationPanel';

const SHIFT_LABELS = { MANANA: '🌅 Mañana', TARDE: '☀️ Tarde', NOCHE: '🌙 Noche' };
const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque' };
const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };
const ADMIN_AREA_ORDER = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
const CURRENT_REFRESH_MS = 15000;
const AREA_THEMES = {
    PRODUCCION: { color: '#1d4ed8', bg: '#eff6ff', headerBg: '#dbeafe', border: '#93c5fd', soft: '#f8fbff' },
    SIROPES: { color: '#0e7490', bg: '#ecfeff', headerBg: '#cffafe', border: '#67e8f9', soft: '#f6feff' },
    EMPAQUE: { color: '#15803d', bg: '#f0fdf4', headerBg: '#dcfce7', border: '#86efac', soft: '#f8fff9' }
};
const DEFAULT_THEME = { color: '#475569', bg: '#f8fafc', headerBg: '#f1f5f9', border: '#cbd5e1', soft: '#ffffff' };
const STATUS_LABELS = {
    PENDING: { label: 'Pendiente', color: '#94a3b8', bg: '#f1f5f9' },
    IN_PROGRESS: { label: 'En Progreso', color: '#f59e0b', bg: '#fffbeb' },
    DELIVERED: { label: 'Entregado', color: '#7c3aed', bg: '#faf5ff' },
    RECEIVED: { label: 'Recibido', color: '#16a34a', bg: '#f0fdf4' },
    WITH_INCIDENT: { label: 'Con Novedad', color: '#dc2626', bg: '#fef2f2' },
    VALIDATED: { label: 'Validado', color: '#2563eb', bg: '#eff6ff' }
};

function getAreaTheme(area) {
    return AREA_THEMES[area] || DEFAULT_THEME;
}

function getOperatorState(handover, participantGroup) {
    const participants = participantGroup === 'INCOMING'
        ? (handover?.incomingParticipants || [])
        : (handover?.outgoingParticipants || []);
    const operators = participants.filter(participant => participant.role !== 'LIDER');
    const signatures = (handover?.signatures || []).filter(signature => signature.participantGroup === participantGroup);
    const signedUserIds = new Set(signatures.map(signature => signature.userId));
    const missing = operators.filter(operator => !signedUserIds.has(operator.userId));

    return {
        total: operators.length,
        signed: operators.length - missing.length,
        missing
    };
}

function LiveHandoverTracker({ handover }) {
    if (!handover) return null;

    const outgoing = getOperatorState(handover, 'OUTGOING');
    const incoming = getOperatorState(handover, 'INCOMING');
    const outgoingLeaderDone = Boolean(handover.outgoingLeaderAt);
    const incomingLeaderDone = Boolean(handover.incomingLeaderAt);

    const trackerCards = [
        {
            key: 'outgoing',
            title: 'Faltan por firmar salida',
            accent: '#f59e0b',
            bg: '#fffbeb',
            done: outgoing.missing.length === 0,
            summary: `${outgoing.signed}/${outgoing.total}`,
            names: outgoing.missing.map(person => person.name)
        },
        {
            key: 'incoming',
            title: 'Faltan por firmar entrada',
            accent: '#2563eb',
            bg: '#eff6ff',
            done: incoming.missing.length === 0,
            summary: `${incoming.signed}/${incoming.total}`,
            names: incoming.missing.map(person => person.name)
        },
        {
            key: 'leaders',
            title: 'Cierre de líderes',
            accent: '#7c3aed',
            bg: '#faf5ff',
            done: outgoingLeaderDone && incomingLeaderDone,
            summary: `${Number(outgoingLeaderDone) + Number(incomingLeaderDone)}/2`,
            names: [
                ...(outgoingLeaderDone ? [] : ['Falta autorización del líder saliente']),
                ...(incomingLeaderDone ? [] : ['Falta aceptación del líder entrante'])
            ]
        }
    ];

    return (
        <div style={{
            marginTop: 18,
            marginBottom: 18,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#ffffff'
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
                flexWrap: 'wrap'
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                        Control En Vivo del Relevo
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        Muestra exactamente quién falta por firmar y en qué paso va el cierre.
                    </div>
                </div>
                <div style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: 12,
                    fontWeight: 800
                }}>
                    {SHIFT_LABELS[handover.outgoingShift]} → {SHIFT_LABELS[handover.incomingShift]}
                </div>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
            }}>
                {trackerCards.map(card => (
                    <div key={card.key} style={{
                        border: `1px solid ${card.done ? '#bbf7d0' : `${card.accent}44`}`,
                        borderRadius: 12,
                        padding: 14,
                        background: card.done ? '#f0fdf4' : card.bg
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            marginBottom: 8
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                                {card.title}
                            </div>
                            <div style={{
                                padding: '4px 10px',
                                borderRadius: 999,
                                background: card.done ? '#16a34a' : card.accent,
                                color: '#fff',
                                fontSize: 11,
                                fontWeight: 900
                            }}>
                                {card.done ? 'Listo' : card.summary}
                            </div>
                        </div>

                        {card.names.length === 0 ? (
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
                                Todo completo en este paso.
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: 6 }}>
                                {card.names.map((name) => (
                                    <div key={name} style={{
                                        padding: '8px 10px',
                                        borderRadius: 10,
                                        background: '#fff',
                                        border: '1px solid #e2e8f0',
                                        fontSize: 13,
                                        fontWeight: 700,
                                        color: '#334155'
                                    }}>
                                        {name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function ShiftHandoverTab() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';

    const [view, setView] = useState('current'); // 'current' | 'history' | 'simulation'
    const [handoverData, setHandoverData] = useState(null);
    const [checklists, setChecklists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [areaFilter, setAreaFilter] = useState(''); // '' = auto from user

    // Current relevo must show the 3 areas, like the simulator, so everyone can sign.
    const [allAreas, setAllAreas] = useState([]);

    const fetchCurrent = useCallback(async ({ silent = false } = {}) => {
        if (silent && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            return;
        }
        if (!silent) setLoading(true);
        try {
            if (!areaFilter) {
                const res = await api.get('/shift-handover/current-all');
                const areas = Array.isArray(res.data?.areas) ? res.data.areas : [];
                const orderedAreas = ADMIN_AREA_ORDER.map(area =>
                    areas.find(item => item?.area === area) || { enabled: true, area, handover: null }
                );
                setAllAreas(orderedAreas);
                setHandoverData(null);
            } else {
                const params = areaFilter ? { area: areaFilter } : {};
                const res = await api.get('/shift-handover/current', { params });
                setHandoverData(res.data);
                setAllAreas([]);
            }
        } catch (e) {
            console.error('Error loading handover:', e);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [isAdmin, areaFilter]);

    const fetchChecklists = useCallback(async () => {
        try {
            const params = areaFilter ? { area: areaFilter } : {};
            const res = await api.get('/shift-handover/checklists', { params });
            setChecklists(res.data);
        } catch (e) {
            console.error('Error loading checklists:', e);
        }
    }, [areaFilter]);

    useEffect(() => {
        if (view === 'current') {
            fetchCurrent();
            fetchChecklists();
            const interval = setInterval(() => fetchCurrent({ silent: true }), CURRENT_REFRESH_MS);
            return () => clearInterval(interval);
        }
    }, [view, fetchCurrent, fetchChecklists]);

    const handleUpdate = () => {
        fetchCurrent({ silent: true });
    };

    const getAreaShellStyle = (data) => {
        const area = data?.handover?.area || data?.area;
        const theme = getAreaTheme(area);
        return {
            border: `2px solid ${theme.border}`,
            borderRadius: 8,
            padding: 20,
            background: theme.soft,
            boxShadow: `0 10px 28px ${theme.border}33`
        };
    };

    // Render a single area handover card
    const renderAreaHandover = (data) => {
        if (!data?.enabled) {
            return (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    Módulo de relevo deshabilitado
                </div>
            );
        }
        if (!data?.handover) {
            return (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <Calendar size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                    <div style={{ fontSize: 14, fontWeight: 600 }}>No hay relevo programado</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Publica el cuadro semanal para generar relevos</div>
                </div>
            );
        }

        const h = data.handover;
        const status = STATUS_LABELS[h.status] || STATUS_LABELS.PENDING;
        const theme = getAreaTheme(h.area);
        const areaChecklists = checklists.filter(c => c.area === h.area);

        return (
            <div>
                {/* Status banner */}
                <div style={{
                    padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                    background: h.status === 'RECEIVED' ? '#f0fdf4' : theme.headerBg,
                    borderBottom: `2px solid ${theme.border}`,
                    marginBottom: 20,
                    borderRadius: 8
                }}>
                    <span style={{ fontSize: 32 }}>{AREA_ICONS[h.area]}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 26, fontWeight: 950, color: theme.color, lineHeight: 1.05 }}>
                            {AREA_LABELS[h.area]}
                        </div>
                        <div style={{ fontSize: 13, color: '#334155', marginTop: 3, fontWeight: 800 }}>
                            Relevo de Turno
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                            {SHIFT_LABELS[h.outgoingShift]} → {SHIFT_LABELS[h.incomingShift]}
                            {data.minutesUntilEnd != null && data.minutesUntilEnd > 0 && (
                                <span style={{ marginLeft: 12, fontWeight: 700, color: data.minutesUntilEnd <= 5 ? '#dc2626' : '#f59e0b' }}>
                                    ⏱ {data.minutesUntilEnd} min restantes
                                </span>
                            )}
                        </div>
                    </div>
                    <div style={{
                        padding: '6px 14px', borderRadius: 8, fontWeight: 800, fontSize: 12,
                        background: status.color, color: '#fff', textTransform: 'uppercase'
                    }}>
                        {status.label}
                    </div>
                </div>

                {/* Timeline */}
                <HandoverTimeline handover={h} />
                <LiveHandoverTracker handover={h} />

                {/* Panels */}
                <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
                    <OperatorSignaturePanel handover={h} onUpdate={handleUpdate} />
                    <LeaderAuthorizationPanel handover={h} checklists={areaChecklists} onUpdate={handleUpdate} />
                    <IncomingLeaderPanel handover={h} onUpdate={handleUpdate} />
                </div>

                {/* Admin force-complete */}
                {isAdmin && !['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(h.status) && (
                    <AdminForceComplete handoverId={h.id} onUpdate={handleUpdate} />
                )}
            </div>
        );
    };

    return (
        <div>
            {/* Top controls */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 20, flexWrap: 'wrap', gap: 12
            }}>
                <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
                    {[
                        ['current', '🔄 Relevo Actual'],
                        ...(isAdmin ? [['simulation', '🧪 Simulacro']] : []),
                        ['history', '📋 Historial']
                    ].map(([key, label]) => (
                        <button key={key} onClick={() => setView(key)} style={{
                            padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer',
                            background: view === key ? '#fff' : 'transparent',
                            boxShadow: view === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                            fontWeight: view === key ? 700 : 500, fontSize: 14,
                            color: view === key ? '#0f172a' : '#64748b'
                        }}>{label}</button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isAdmin && view === 'current' && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <Filter size={14} color="#64748b" />
                            <select
                                value={areaFilter}
                                onChange={e => setAreaFilter(e.target.value)}
                                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600 }}
                            >
                                <option value="">Todas las áreas</option>
                                <option value="PRODUCCION">Producción</option>
                                <option value="SIROPES">Siropes</option>
                                <option value="EMPAQUE">Empaque</option>
                            </select>
                        </div>
                    )}
                    {view === 'current' && (
                        <button onClick={() => fetchCurrent()} disabled={loading} style={{
                            padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                            background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
                        }}>
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                    )}
                </div>
            </div>

            {/* Current view */}
            {view === 'current' && (
                <>
                    {loading && !handoverData && allAreas.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
                    ) : !areaFilter ? (
                        // Multi-area view: all workers see the same live relevo board.
                        allAreas.length > 0 ? (
                            <div style={{ display: 'grid', gap: 24 }}>
                                {allAreas.map((data) => (
                                    <div key={data?.area || data?.handover?.id} style={getAreaShellStyle(data)}>
                                        {renderAreaHandover(data)}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                                No fue posible cargar el relevo actual. Usa refrescar para reintentar.
                            </div>
                        )
                    ) : (
                        <div style={getAreaShellStyle(handoverData)}>
                            {renderAreaHandover(handoverData)}
                        </div>
                    )}
                </>
            )}

            {/* History view */}
            {view === 'history' && <HandoverHistory isAdmin={isAdmin} />}

            {/* Simulation view */}
            {view === 'simulation' && isAdmin && <HandoverSimulationPanel />}
        </div>
    );
}

// ── Admin Force Complete sub-component ──────────────────────────────────────
function AdminForceComplete({ handoverId, onUpdate }) {
    const [show, setShow] = useState(false);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleForce = async () => {
        if (reason.trim().length < 5) { setError('Motivo debe tener al menos 5 caracteres'); return; }
        setSubmitting(true);
        setError('');
        try {
            await api.post(`/shift-handover/${handoverId}/force-complete`, { reason: reason.trim() });
            setShow(false);
            setReason('');
            if (onUpdate) onUpdate();
        } catch (e) {
            setError(e.response?.data?.error || 'Error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!show) {
        return (
            <div style={{ marginTop: 16, textAlign: 'right' }}>
                <button onClick={() => setShow(true)} style={{
                    padding: '8px 16px', borderRadius: 10, border: '2px solid #fca5a5',
                    background: '#fff', color: '#dc2626', fontWeight: 700, fontSize: 12, cursor: 'pointer'
                }}>
                    ⚠️ Forzar Completar (Admin)
                </button>
            </div>
        );
    }

    return (
        <div style={{
            marginTop: 16, padding: 16, borderRadius: 12,
            background: '#fef2f2', border: '2px solid #fca5a5'
        }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#991b1b', marginBottom: 8 }}>
                ⚠️ Forzar Completar Relevo
            </div>
            <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 12 }}>
                Esto desbloqueará el turno entrante y quedará registrado como novedad.
            </div>
            <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Motivo obligatorio (min. 5 caracteres)..."
                rows={2}
                style={{
                    width: '100%', padding: '8px 12px', borderRadius: 10,
                    border: '1px solid #fca5a5', fontSize: 13, marginBottom: 8,
                    resize: 'vertical', boxSizing: 'border-box'
                }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShow(false); setReason(''); }} style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                    background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                }}>Cancelar</button>
                <button onClick={handleForce} disabled={submitting} style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                    opacity: submitting ? 0.6 : 1
                }}>{submitting ? '...' : 'Forzar Completar'}</button>
            </div>
            {error && <div style={{ marginTop: 8, color: '#dc2626', fontSize: 12, fontWeight: 600 }}>{error}</div>}
        </div>
    );
}
