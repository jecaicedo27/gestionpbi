import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Calendar, Filter } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import OperatorSignaturePanel from './OperatorSignaturePanel';
import LeaderAuthorizationPanel from './LeaderAuthorizationPanel';
import IncomingLeaderPanel from './IncomingLeaderPanel';
import HandoverTimeline from './HandoverTimeline';
import HandoverHistory from './HandoverHistory';

const SHIFT_LABELS = { MANANA: '🌅 Mañana', TARDE: '☀️ Tarde', NOCHE: '🌙 Noche' };
const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque' };
const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };
const STATUS_LABELS = {
    PENDING: { label: 'Pendiente', color: '#94a3b8', bg: '#f1f5f9' },
    IN_PROGRESS: { label: 'En Progreso', color: '#f59e0b', bg: '#fffbeb' },
    DELIVERED: { label: 'Entregado', color: '#7c3aed', bg: '#faf5ff' },
    RECEIVED: { label: 'Recibido', color: '#16a34a', bg: '#f0fdf4' },
    WITH_INCIDENT: { label: 'Con Novedad', color: '#dc2626', bg: '#fef2f2' },
    VALIDATED: { label: 'Validado', color: '#2563eb', bg: '#eff6ff' }
};

export default function ShiftHandoverTab() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';

    const [view, setView] = useState('current'); // 'current' | 'history'
    const [handoverData, setHandoverData] = useState(null);
    const [checklists, setChecklists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [areaFilter, setAreaFilter] = useState(''); // '' = auto from user

    // For admin: load all 3 areas
    const [allAreas, setAllAreas] = useState([]);

    const fetchCurrent = useCallback(async () => {
        setLoading(true);
        try {
            if (isAdmin && !areaFilter) {
                // Load all areas
                const results = await Promise.all(
                    ['PRODUCCION', 'SIROPES', 'EMPAQUE'].map(area =>
                        api.get('/shift-handover/current', { params: { area } }).then(r => r.data).catch(() => null)
                    )
                );
                setAllAreas(results.filter(Boolean));
                setHandoverData(null);
            } else {
                const params = areaFilter ? { area: areaFilter } : {};
                const res = await api.get('/shift-handover/current', { params });
                setHandoverData(res.data);
                setAllAreas([]);
            }
        } catch (e) {
            console.error('Error loading handover:', e);
        }
        setLoading(false);
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
            const interval = setInterval(fetchCurrent, 30000);
            return () => clearInterval(interval);
        }
    }, [view, fetchCurrent, fetchChecklists]);

    const handleUpdate = () => {
        fetchCurrent();
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
        const areaChecklists = checklists.filter(c => c.area === h.area);

        return (
            <div>
                {/* Status banner */}
                <div style={{
                    padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                    background: status.bg, borderBottom: `2px solid ${status.color}20`, marginBottom: 20, borderRadius: 12
                }}>
                    <span style={{ fontSize: 28 }}>{AREA_ICONS[h.area]}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                            {AREA_LABELS[h.area]} — Relevo de Turno
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
                        padding: '6px 14px', borderRadius: 20, fontWeight: 800, fontSize: 12,
                        background: status.color, color: '#fff', textTransform: 'uppercase'
                    }}>
                        {status.label}
                    </div>
                </div>

                {/* Timeline */}
                <HandoverTimeline status={h.status} />

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
                    {[['current', '🔄 Relevo Actual'], ['history', '📋 Historial']].map(([key, label]) => (
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
                        <button onClick={fetchCurrent} disabled={loading} style={{
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
                    {loading ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
                    ) : allAreas.length > 0 ? (
                        // Admin multi-area view
                        <div style={{ display: 'grid', gap: 24 }}>
                            {allAreas.map((data, i) => (
                                <div key={data?.handover?.id || i} style={{
                                    border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, background: '#fff'
                                }}>
                                    {renderAreaHandover(data)}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, background: '#fff' }}>
                            {renderAreaHandover(handoverData)}
                        </div>
                    )}
                </>
            )}

            {/* History view */}
            {view === 'history' && <HandoverHistory isAdmin={isAdmin} />}
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
