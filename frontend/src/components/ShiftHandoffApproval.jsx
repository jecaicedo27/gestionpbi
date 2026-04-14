import { useState } from 'react';

const AREA_LABELS = {
    PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque'
};
const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };

const STATUS_BADGES = {
    NOT_DELIVERED: { label: 'No entregó', icon: '🔴', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    PENDING:      { label: 'Esperando', icon: '🟡', bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    APPROVED:     { label: 'Aprobado', icon: '🟢', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    REJECTED:     { label: 'Rechazado', icon: '🔴', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
};

export default function ShiftHandoffApproval({ operators, handoffs, outgoingShift, onApprove, onReject, loading }) {
    const [expandedId, setExpandedId] = useState(null);
    const [pinInputs, setPinInputs] = useState({}); // { handoffId: 'XXXX' }
    const [rejectReason, setRejectReason] = useState({});
    const [actionLoading, setActionLoading] = useState(null);

    const handleApprove = async (handoffId, status) => {
        const pin = pinInputs[handoffId];
        if (!pin || pin.length !== 4) return;
        setActionLoading(handoffId);
        await onApprove(handoffId, pin, status);
        setActionLoading(null);
        setPinInputs(prev => ({ ...prev, [handoffId]: '' }));
    };

    const handleReject = async (handoffId) => {
        const pin = pinInputs[handoffId];
        const reason = rejectReason[handoffId];
        if (!pin || pin.length !== 4) return;
        if (!reason?.trim()) return;
        setActionLoading(handoffId);
        await onReject(handoffId, pin, reason);
        setActionLoading(null);
        setPinInputs(prev => ({ ...prev, [handoffId]: '' }));
        setRejectReason(prev => ({ ...prev, [handoffId]: '' }));
    };

    // Group operators by area
    const byArea = {};
    (operators || []).forEach(op => {
        if (!byArea[op.area]) byArea[op.area] = [];
        byArea[op.area].push(op);
    });

    const allApproved = operators?.length > 0 && operators.every(o => o.status === 'APPROVED');

    return (
        <div style={cardStyle}>
            <h3 style={titleStyle}>
                👑 Aprobación de Entregas — Turno {outgoingShift || ''}
            </h3>

            {allApproved && (
                <div style={{
                    padding: '14px 20px', background: '#f0fdf4', borderRadius: 12,
                    border: '2px solid #86efac', marginBottom: 16, textAlign: 'center',
                    fontWeight: 700, fontSize: 16, color: '#16a34a'
                }}>
                    ✅ Todas las entregas aprobadas — Turno desbloqueado
                </div>
            )}

            {Object.entries(byArea).map(([area, ops]) => (
                <div key={area} style={{ marginBottom: 20 }}>
                    <div style={{
                        fontSize: 16, fontWeight: 700, color: '#334155', marginBottom: 10,
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', background: '#f8fafc', borderRadius: 10
                    }}>
                        {AREA_ICONS[area]} {AREA_LABELS[area] || area}
                    </div>

                    {ops.map(op => {
                        const badge = STATUS_BADGES[op.status] || STATUS_BADGES.NOT_DELIVERED;
                        const handoff = handoffs?.find(h => h.deliveredBy?.id === op.userId);
                        const isExpanded = expandedId === (handoff?.id || op.shiftEmployeeId);

                        return (
                            <div key={op.shiftEmployeeId} style={{
                                padding: '14px 16px', borderBottom: '1px solid #f1f5f9',
                                borderRadius: 10, marginBottom: 6,
                                background: op.status === 'APPROVED' ? '#fafffe' : '#fff',
                                border: `1px solid ${badge.border}`
                            }}>
                                {/* Header row */}
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    alignItems: 'center', gap: 12
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                                            {op.role === 'LIDER' && '👑 '}{op.name}
                                        </div>
                                        {handoff?.deliveredAt && (
                                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                                Entregó: {new Date(handoff.deliveredAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{
                                            padding: '4px 12px', borderRadius: 8, fontSize: 13,
                                            fontWeight: 700, background: badge.bg, color: badge.color,
                                            border: `1px solid ${badge.border}`
                                        }}>
                                            {badge.icon} {badge.label}
                                        </span>
                                        {handoff && (
                                            <button
                                                onClick={() => setExpandedId(isExpanded ? null : (handoff.id || op.shiftEmployeeId))}
                                                style={{
                                                    padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                                                    background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                                    color: '#64748b'
                                                }}
                                            >
                                                {isExpanded ? '▲ Cerrar' : '▼ Ver detalle'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {op.rejectionReason && (
                                    <div style={{
                                        marginTop: 8, padding: '8px 12px', background: '#fef2f2',
                                        borderRadius: 8, fontSize: 13, color: '#dc2626', fontWeight: 600
                                    }}>
                                        ⚠️ Motivo de rechazo: {op.rejectionReason}
                                    </div>
                                )}

                                {/* Expanded detail */}
                                {isExpanded && handoff && (
                                    <div style={{
                                        marginTop: 12, padding: '14px', background: '#f8fafc',
                                        borderRadius: 12, border: '1px solid #e2e8f0'
                                    }}>
                                        {/* Checklist items */}
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                                                Checklist:
                                            </div>
                                            {(handoff.checklist || []).map((item, i) => (
                                                <div key={i} style={{
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    padding: '6px 10px', marginBottom: 4, borderRadius: 8,
                                                    background: item.type === 'boolean'
                                                        ? (item.value ? '#f0fdf4' : '#fef2f2')
                                                        : '#fff',
                                                    fontSize: 14
                                                }}>
                                                    {item.type === 'boolean' ? (
                                                        <>
                                                            <span style={{ fontSize: 16 }}>{item.value ? '✅' : '❌'}</span>
                                                            <span style={{ fontWeight: 600, color: '#334155' }}>{item.label}</span>
                                                        </>
                                                    ) : (
                                                        <div style={{ width: '100%' }}>
                                                            <span style={{ fontWeight: 700, color: '#475569', fontSize: 12 }}>{item.label}:</span>
                                                            <div style={{
                                                                padding: '6px 10px', background: '#fff', borderRadius: 6,
                                                                border: '1px solid #e2e8f0', marginTop: 4, fontSize: 13,
                                                                color: '#334155', fontWeight: 500
                                                            }}>
                                                                {item.value || '—'}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {handoff.notes && (
                                            <div style={{ marginBottom: 8, fontSize: 13 }}>
                                                <strong style={{ color: '#475569' }}>Novedades:</strong>
                                                <span style={{ color: '#334155', marginLeft: 6 }}>{handoff.notes}</span>
                                            </div>
                                        )}

                                        {/* Approve / Reject actions */}
                                        {['PENDING', 'PENDING_INCOMING'].includes(handoff.status) && (
                                            <div style={{
                                                marginTop: 12, padding: '14px', background: '#fff',
                                                borderRadius: 12, border: '2px solid #e2e8f0'
                                            }}>
                                                <div style={{
                                                    fontSize: 13, fontWeight: 700, color: '#334155',
                                                    marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6
                                                }}>
                                                    🔐 PIN del líder para aprobar/rechazar
                                                </div>
                                                <input
                                                    type="password"
                                                    maxLength={4}
                                                    placeholder="PIN (4 dígitos)"
                                                    value={pinInputs[handoff.id] || ''}
                                                    onChange={e => setPinInputs(prev => ({
                                                        ...prev,
                                                        [handoff.id]: e.target.value.replace(/\D/g, '')
                                                    }))}
                                                    style={{
                                                        width: '100%', padding: '12px 14px', borderRadius: 10,
                                                        border: '2px solid #cbd5e1', fontSize: 18,
                                                        textAlign: 'center', letterSpacing: 12, fontWeight: 800,
                                                        outline: 'none', marginBottom: 10, boxSizing: 'border-box'
                                                    }}
                                                />
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <button
                                                        onClick={() => handleApprove(handoff.id, handoff.status)}
                                                        disabled={actionLoading === handoff.id}
                                                        style={{
                                                            flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                                                            background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                                                            color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer'
                                                        }}
                                                    >
                                                        {actionLoading === handoff.id ? '⏳' : '✅ Aprobar'}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const el = document.getElementById(`reject-${handoff.id}`);
                                                            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                                                        }}
                                                        style={{
                                                            flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                                                            background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                                                            color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer'
                                                        }}
                                                    >
                                                        ❌ Rechazar
                                                    </button>
                                                </div>
                                                <div id={`reject-${handoff.id}`} style={{ display: 'none', marginTop: 10 }}>
                                                    <textarea
                                                        placeholder="Motivo del rechazo..."
                                                        value={rejectReason[handoff.id] || ''}
                                                        onChange={e => setRejectReason(prev => ({ ...prev, [handoff.id]: e.target.value }))}
                                                        style={{
                                                            width: '100%', padding: '10px', borderRadius: 8,
                                                            border: '2px solid #fecaca', fontSize: 14,
                                                            minHeight: 60, resize: 'vertical', outline: 'none',
                                                            marginBottom: 8, fontFamily: 'inherit', boxSizing: 'border-box'
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => handleReject(handoff.id)}
                                                        disabled={actionLoading === handoff.id}
                                                        style={{
                                                            width: '100%', padding: '10px', borderRadius: 8, border: 'none',
                                                            background: '#dc2626', color: '#fff', fontWeight: 700,
                                                            fontSize: 14, cursor: 'pointer'
                                                        }}
                                                    >
                                                        {actionLoading === handoff.id ? '⏳' : '❌ Confirmar Rechazo'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {(!operators || operators.length === 0) && !loading && (
                <div style={{
                    textAlign: 'center', padding: '40px 20px', color: '#94a3b8',
                    fontSize: 15, fontStyle: 'italic'
                }}>
                    No hay operarios asignados al turno saliente
                </div>
            )}
        </div>
    );
}

const cardStyle = {
    background: '#fff', borderRadius: 16, padding: '24px', border: '1px solid #e2e8f0',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)'
};

const titleStyle = {
    fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 4px',
    display: 'flex', alignItems: 'center', gap: 10
};
