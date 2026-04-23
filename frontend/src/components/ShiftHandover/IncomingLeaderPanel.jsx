import { useState } from 'react';
import { UserCheck, Lock, Clock } from 'lucide-react';
import api from '../../services/api';

export default function IncomingLeaderPanel({ handover, onUpdate }) {
    const [pin, setPin] = useState('');
    const [observations, setObservations] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!handover) return null;

    const canAccept = handover.status === 'DELIVERED';
    const isAccepted = ['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status);
    const requiresProductionLeader = ['SIROPES', 'EMPAQUE'].includes(handover.area);
    const acceptanceTitle = requiresProductionLeader ? 'Aceptación Líder de Producción' : 'Aceptación Líder Entrante';
    const acceptancePinLabel = requiresProductionLeader ? 'PIN del Líder de Producción (entrante)' : 'PIN del Líder Entrante';
    const incomingOps = (handover.incomingParticipants || []).filter(p => p.role !== 'LIDER');
    const incomingSignatures = (handover.signatures || []).filter(signature => signature.participantGroup === 'INCOMING');
    const incomingSignedUserIds = new Set(incomingSignatures.map(signature => signature.userId));
    const incomingSignedCount = incomingOps.filter(operator => incomingSignedUserIds.has(operator.userId)).length;
    const allIncomingSigned = incomingOps.length === 0 || incomingSignedCount >= incomingOps.length;
    const waitingText = requiresProductionLeader
        ? 'El líder de Producción debe revisar y aceptar este relevo primero'
        : 'El líder saliente debe completar el checklist y autorizar primero';

    const handleAccept = async () => {
        if (pin.length !== 4) { setError('Ingresa 4 dígitos'); return; }
        setSubmitting(true);
        setError('');
        try {
            if (!allIncomingSigned) {
                setError(`Faltan firmas de operarios entrantes: ${incomingSignedCount}/${incomingOps.length}`);
                setSubmitting(false);
                return;
            }
            await api.post(`/shift-handover/${handover.id}/accept-incoming`, {
                pin,
                observations: observations.trim() || null
            });
            setPin('');
            if (onUpdate) onUpdate();
        } catch (e) {
            setError(e.response?.data?.error || 'Error al aceptar');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{
                padding: '16px 20px',
                background: isAccepted ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
                borderBottom: `2px solid ${isAccepted ? '#86efac' : '#7dd3fc'}`
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserCheck size={20} color={isAccepted ? '#16a34a' : '#0284c7'} />
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                            {isAccepted ? '✅ Relevo Aceptado' : acceptanceTitle}
                        </div>
                        {isAccepted && handover.incomingLeader && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                                {handover.incomingLeader.name} — {handover.incomingLeaderAt && new Date(handover.incomingLeaderAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isAccepted ? (
                <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>🤝</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>
                        Relevo completado exitosamente
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                        El turno entrante está desbloqueado
                    </div>
                </div>
            ) : !canAccept ? (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Clock size={32} color="#94a3b8" style={{ marginBottom: 8 }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                        Esperando autorización del líder saliente
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        {waitingText}
                    </div>
                </div>
            ) : (
                <div style={{ padding: '16px 20px' }}>
                    {!allIncomingSigned && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                            background: '#eff6ff', border: '1px solid #bfdbfe',
                            display: 'flex', alignItems: 'center', gap: 10
                        }}>
                            <Clock size={18} color="#2563eb" />
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
                                Faltan firmas del turno entrante ({incomingSignedCount}/{incomingOps.length})
                            </span>
                        </div>
                    )}

                    {/* Show what was delivered */}
                    {handover.pendingTasks && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 10, marginBottom: 12,
                            background: '#fffbeb', border: '1px solid #fde68a'
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>📋 Pendientes del turno anterior:</div>
                            <div style={{ fontSize: 13, color: '#78350f' }}>{handover.pendingTasks}</div>
                        </div>
                    )}
                    {handover.incidents && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 10, marginBottom: 12,
                            background: '#fef2f2', border: '1px solid #fecaca'
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>⚠️ Incidencias reportadas:</div>
                            <div style={{ fontSize: 13, color: '#991b1b' }}>{handover.incidents}</div>
                        </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Observaciones del entrante (opcional)</div>
                        <textarea
                            value={observations}
                            onChange={e => setObservations(e.target.value)}
                            rows={2}
                            placeholder="Notas al recibir el turno..."
                            style={{
                                width: '100%', padding: '8px 12px', borderRadius: 10,
                                border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                        <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                        {acceptancePinLabel}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="PIN"
                            value={pin}
                            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleAccept()}
                            style={{
                                flex: 1, padding: '12px 16px', borderRadius: 12,
                                border: `2px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                                fontSize: 20, fontWeight: 700, textAlign: 'center',
                                letterSpacing: 8, fontFamily: 'monospace'
                            }}
                        />
                        <button
                            onClick={handleAccept}
                            disabled={submitting || pin.length !== 4 || !allIncomingSigned}
                            style={{
                                padding: '12px 24px', borderRadius: 12, border: 'none',
                                background: pin.length === 4 && allIncomingSigned ? '#0284c7' : '#94a3b8',
                                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                                opacity: submitting ? 0.6 : 1
                            }}
                        >
                            {submitting ? '...' : 'Aceptar Relevo'}
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
