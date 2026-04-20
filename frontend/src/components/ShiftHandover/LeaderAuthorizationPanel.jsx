import { useState, useEffect } from 'react';
import { Shield, Lock, CheckSquare, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

export default function LeaderAuthorizationPanel({ handover, checklists, onUpdate }) {
    const [pin, setPin] = useState('');
    const [pendingTasks, setPendingTasks] = useState('');
    const [incidents, setIncidents] = useState('');
    const [observations, setObservations] = useState('');
    const [checkValues, setCheckValues] = useState({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Initialize checklist values
    useEffect(() => {
        if (checklists?.length > 0 && Object.keys(checkValues).length === 0) {
            const init = {};
            checklists.forEach(c => { init[c.id] = c.fieldType === 'boolean' ? false : ''; });
            setCheckValues(init);
        }
    }, [checklists]);

    if (!handover) return null;

    const canAuthorize = handover.status === 'IN_PROGRESS';
    const isAuthorized = ['DELIVERED', 'RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status);

    // Check all ops signed
    const outOps = (handover.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
    const signedCount = handover.signatures?.length || 0;
    const allOpsSigned = signedCount >= outOps.length && outOps.length > 0;

    const handleAuthorize = async () => {
        if (pin.length !== 4) { setError('Ingresa 4 dígitos'); return; }
        if (!allOpsSigned) { setError('Todos los operarios deben firmar primero'); return; }

        // Build checklist with values
        const checklistData = (checklists || []).map(c => ({
            id: c.id,
            label: c.label,
            fieldType: c.fieldType,
            value: checkValues[c.id] ?? (c.fieldType === 'boolean' ? false : '')
        }));

        setSubmitting(true);
        setError('');
        try {
            await api.post(`/shift-handover/${handover.id}/authorize-outgoing`, {
                pin,
                checklist: checklistData,
                pendingTasks: pendingTasks.trim() || null,
                incidents: incidents.trim() || null,
                observations: observations.trim() || null
            });
            setPin('');
            if (onUpdate) onUpdate();
        } catch (e) {
            setError(e.response?.data?.error || 'Error al autorizar');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                background: isAuthorized ? 'linear-gradient(135deg, #eff6ff, #dbeafe)' : 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
                borderBottom: `2px solid ${isAuthorized ? '#93c5fd' : '#d8b4fe'}`
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Shield size={20} color={isAuthorized ? '#2563eb' : '#7c3aed'} />
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                            {isAuthorized ? '✅ Líder Saliente Autorizó' : 'Autorización Líder Saliente'}
                        </div>
                        {isAuthorized && handover.outgoingLeader && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                                {handover.outgoingLeader.name} — {handover.outgoingLeaderAt && new Date(handover.outgoingLeaderAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isAuthorized ? (
                <div style={{ padding: '16px 20px' }}>
                    {handover.checklist && Array.isArray(handover.checklist) && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Checklist</div>
                            {handover.checklist.map((item, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                                    {item.fieldType === 'boolean'
                                        ? <span>{item.value ? '✅' : '❌'}</span>
                                        : <span style={{ color: '#475569' }}>{item.value || '—'}</span>
                                    }
                                    <span style={{ color: '#334155' }}>{item.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {handover.pendingTasks && (
                        <div style={{ marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Pendientes: </span>
                            <span style={{ fontSize: 13, color: '#334155' }}>{handover.pendingTasks}</span>
                        </div>
                    )}
                    {handover.incidents && (
                        <div style={{ marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>Incidencias: </span>
                            <span style={{ fontSize: 13, color: '#334155' }}>{handover.incidents}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ padding: '16px 20px' }}>
                    {!allOpsSigned && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 12, marginBottom: 16,
                            background: '#fef3c7', border: '1px solid #fde68a',
                            display: 'flex', alignItems: 'center', gap: 10
                        }}>
                            <AlertTriangle size={18} color="#d97706" />
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                                Esperando firmas de operarios ({signedCount}/{outOps.length})
                            </span>
                        </div>
                    )}

                    {/* Checklist */}
                    {checklists && checklists.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                                <CheckSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                                Checklist de Entrega
                            </div>
                            {checklists.map(c => (
                                <div key={c.id} style={{ marginBottom: 8 }}>
                                    {c.fieldType === 'boolean' ? (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                                            <input
                                                type="checkbox"
                                                checked={checkValues[c.id] || false}
                                                onChange={e => setCheckValues(prev => ({ ...prev, [c.id]: e.target.checked }))}
                                                style={{ width: 18, height: 18, accentColor: '#7c3aed' }}
                                            />
                                            {c.label}
                                        </label>
                                    ) : (
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
                                            <input
                                                type="text"
                                                value={checkValues[c.id] || ''}
                                                onChange={e => setCheckValues(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                style={{
                                                    width: '100%', padding: '8px 12px', borderRadius: 10,
                                                    border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Text fields */}
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Pendientes para el próximo turno</div>
                        <textarea
                            value={pendingTasks}
                            onChange={e => setPendingTasks(e.target.value)}
                            rows={2}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Incidencias / Novedades</div>
                        <textarea
                            value={incidents}
                            onChange={e => setIncidents(e.target.value)}
                            rows={2}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Observaciones generales</div>
                        <textarea
                            value={observations}
                            onChange={e => setObservations(e.target.value)}
                            rows={2}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                    </div>

                    {/* PIN + authorize */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                        <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                        PIN del Líder Saliente
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="PIN"
                            value={pin}
                            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleAuthorize()}
                            style={{
                                flex: 1, padding: '12px 16px', borderRadius: 12,
                                border: `2px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                                fontSize: 20, fontWeight: 700, textAlign: 'center',
                                letterSpacing: 8, fontFamily: 'monospace'
                            }}
                        />
                        <button
                            onClick={handleAuthorize}
                            disabled={submitting || pin.length !== 4 || !allOpsSigned}
                            style={{
                                padding: '12px 24px', borderRadius: 12, border: 'none',
                                background: (allOpsSigned && pin.length === 4) ? '#7c3aed' : '#94a3b8',
                                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                                opacity: submitting ? 0.6 : 1
                            }}
                        >
                            {submitting ? '...' : 'Autorizar'}
                        </button>
                    </div>

                    {error && (
                        <div style={{
                            marginTop: 8, padding: '8px 12px', borderRadius: 10,
                            background: '#fef2f2', color: '#dc2626', fontSize: 13,
                            fontWeight: 600, textAlign: 'center'
                        }}>{error}</div>
                    )}
                </div>
            )}
        </div>
    );
}
