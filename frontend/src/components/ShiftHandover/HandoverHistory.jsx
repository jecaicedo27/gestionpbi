import { useState, useEffect, useCallback } from 'react';
import { Calendar, ChevronDown, ChevronUp, Search } from 'lucide-react';
import api from '../../services/api';

const SHIFT_LABELS = { MANANA: '🌅 Mañana', TARDE: '☀️ Tarde', NOCHE: '🌙 Noche' };
const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque' };
const STATUS_LABELS = {
    PENDING: { label: 'Pendiente', color: '#94a3b8', bg: '#f1f5f9' },
    IN_PROGRESS: { label: 'En Progreso', color: '#f59e0b', bg: '#fffbeb' },
    DELIVERED: { label: 'Entregado', color: '#7c3aed', bg: '#faf5ff' },
    RECEIVED: { label: 'Recibido', color: '#16a34a', bg: '#f0fdf4' },
    WITH_INCIDENT: { label: 'Con Novedad', color: '#dc2626', bg: '#fef2f2' },
    VALIDATED: { label: 'Validado', color: '#2563eb', bg: '#eff6ff' }
};

export default function HandoverHistory({ isAdmin }) {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [detailCache, setDetailCache] = useState({});
    const [filters, setFilters] = useState({
        area: '',
        from: '',
        to: ''
    });

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (filters.area) params.area = filters.area;
            if (filters.from) params.from = filters.from;
            if (filters.to) params.to = filters.to;
            const res = await api.get('/shift-handover/history', { params });
            setRecords(res.data);
        } catch (e) {
            console.error('Error loading history:', e);
        }
        setLoading(false);
    }, [filters]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    const toggleExpand = async (id) => {
        if (expandedId === id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(id);
        if (!detailCache[id]) {
            try {
                const res = await api.get(`/shift-handover/${id}`);
                setDetailCache(prev => ({ ...prev, [id]: res.data }));
            } catch (e) {
                console.error('Error loading detail:', e);
            }
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div>
            {/* Filters */}
            <div style={{
                display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end'
            }}>
                {isAdmin && (
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Área</div>
                        <select
                            value={filters.area}
                            onChange={e => setFilters(p => ({ ...p, area: e.target.value }))}
                            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600 }}
                        >
                            <option value="">Todas</option>
                            <option value="PRODUCCION">Producción</option>
                            <option value="SIROPES">Siropes</option>
                            <option value="EMPAQUE">Empaque</option>
                        </select>
                    </div>
                )}
                <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Desde</div>
                    <input
                        type="date"
                        value={filters.from}
                        onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
                        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                    />
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Hasta</div>
                    <input
                        type="date"
                        value={filters.to}
                        onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
                        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                    />
                </div>
            </div>

            {/* Records list */}
            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Cargando historial...</div>
            ) : records.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <Search size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Sin registros</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Ajusta los filtros para buscar relevos anteriores</div>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                    {records.map(r => {
                        const st = STATUS_LABELS[r.status] || STATUS_LABELS.PENDING;
                        const expanded = expandedId === r.id;
                        const detail = detailCache[r.id];

                        return (
                            <div key={r.id} style={{
                                border: '1px solid #e2e8f0', borderRadius: 12,
                                background: '#fff', overflow: 'hidden'
                            }}>
                                {/* Row summary */}
                                <button
                                    onClick={() => toggleExpand(r.id)}
                                    style={{
                                        width: '100%', padding: '14px 16px', border: 'none', background: 'transparent',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left'
                                    }}
                                >
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', minWidth: 100 }}>
                                            {formatDate(r.operationalDate)}
                                        </span>
                                        <span style={{ fontSize: 12, color: '#64748b' }}>
                                            {AREA_LABELS[r.area]}
                                        </span>
                                        <span style={{ fontSize: 12, color: '#64748b' }}>
                                            {SHIFT_LABELS[r.outgoingShift]} → {SHIFT_LABELS[r.incomingShift]}
                                        </span>
                                    </div>
                                    <span style={{
                                        padding: '4px 10px', borderRadius: 8, fontWeight: 700, fontSize: 11,
                                        background: st.bg, color: st.color, whiteSpace: 'nowrap'
                                    }}>
                                        {st.label}
                                    </span>
                                    {expanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
                                </button>

                                {/* Expanded detail */}
                                {expanded && (
                                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f1f5f9' }}>
                                        {!detail ? (
                                            <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Cargando...</div>
                                        ) : (
                                            <div style={{ paddingTop: 12 }}>
                                                {/* Signatures */}
                                                {detail.signatures && detail.signatures.length > 0 && (
                                                    <div style={{ marginBottom: 12 }}>
                                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Firmas</div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                            {detail.signatures.map((s, i) => (
                                                                <span key={i} style={{
                                                                    padding: '4px 10px', borderRadius: 8, fontSize: 12,
                                                                    background: '#f0fdf4', color: '#16a34a', fontWeight: 600
                                                                }}>
                                                                    ✅ {s.employee?.name || s.user?.name || 'Operario'} — {formatTime(s.signedAt)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Leaders */}
                                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                                                    {detail.outgoingLeader && (
                                                        <div style={{ fontSize: 12 }}>
                                                            <span style={{ fontWeight: 700, color: '#64748b' }}>Líder saliente: </span>
                                                            <span style={{ color: '#334155' }}>
                                                                {detail.outgoingLeader.name} — {formatTime(detail.outgoingLeaderAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {detail.incomingLeader && (
                                                        <div style={{ fontSize: 12 }}>
                                                            <span style={{ fontWeight: 700, color: '#64748b' }}>Líder entrante: </span>
                                                            <span style={{ color: '#334155' }}>
                                                                {detail.incomingLeader.name} — {formatTime(detail.incomingLeaderAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Checklist */}
                                                {detail.checklist && Array.isArray(detail.checklist) && detail.checklist.length > 0 && (
                                                    <div style={{ marginBottom: 12 }}>
                                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Checklist</div>
                                                        {detail.checklist.map((item, i) => (
                                                            <div key={i} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 6 }}>
                                                                <span>{item.fieldType === 'boolean' ? (item.value ? '✅' : '❌') : '•'}</span>
                                                                <span style={{ color: '#334155' }}>
                                                                    {item.label}{item.fieldType !== 'boolean' && item.value ? `: ${item.value}` : ''}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Pending / Incidents */}
                                                {detail.pendingTasks && (
                                                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                                                        <span style={{ fontWeight: 700, color: '#d97706' }}>Pendientes: </span>
                                                        <span style={{ color: '#334155' }}>{detail.pendingTasks}</span>
                                                    </div>
                                                )}
                                                {detail.incidents && (
                                                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                                                        <span style={{ fontWeight: 700, color: '#dc2626' }}>Incidencias: </span>
                                                        <span style={{ color: '#334155' }}>{detail.incidents}</span>
                                                    </div>
                                                )}

                                                {/* Forced */}
                                                {detail.forcedBy && (
                                                    <div style={{
                                                        padding: '8px 12px', borderRadius: 8, marginTop: 8,
                                                        background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12
                                                    }}>
                                                        <span style={{ fontWeight: 700, color: '#dc2626' }}>Forzado por: </span>
                                                        <span style={{ color: '#991b1b' }}>{detail.forcedBy.name}</span>
                                                        {detail.forceReason && (
                                                            <span style={{ color: '#991b1b' }}> — {detail.forceReason}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
