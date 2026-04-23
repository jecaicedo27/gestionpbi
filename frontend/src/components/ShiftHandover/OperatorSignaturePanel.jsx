import { useState } from 'react';
import { CheckCircle, Lock, User, Users } from 'lucide-react';
import api from '../../services/api';

const SHIFT_LABELS = { MANANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche' };

function getGroupSignatures(handover, participantGroup) {
    return (handover.signatures || []).filter(signature => signature.participantGroup === participantGroup);
}

function getGroupOperators(handover, participantGroup) {
    const participants = participantGroup === 'INCOMING'
        ? (handover.incomingParticipants || [])
        : (handover.outgoingParticipants || []);
    return participants.filter(participant => participant.role !== 'LIDER');
}

function getGroupState(handover, participantGroup) {
    const operators = getGroupOperators(handover, participantGroup);
    const signatures = getGroupSignatures(handover, participantGroup);
    const signedUserIds = new Set(signatures.map(signature => signature.userId));
    return {
        operators,
        signatures,
        signedCount: operators.filter(operator => signedUserIds.has(operator.userId)).length,
        expectedCount: operators.length,
        allSigned: operators.length === 0 || operators.every(operator => signedUserIds.has(operator.userId))
    };
}

function SignatureSection({
    title,
    subtitle,
    participantGroup,
    handover,
    form,
    setForm,
    canSign,
    lockedMessage,
    accent,
    onUpdate
}) {
    const { operators, signatures, signedCount, expectedCount, allSigned } = getGroupState(handover, participantGroup);
    const signedUserIds = new Set(signatures.map(signature => signature.userId));
    const progress = expectedCount > 0 ? Math.round((signedCount / expectedCount) * 100) : 0;

    const handleSign = async () => {
        if (form.pin.length !== 4) {
            setForm(prev => ({ ...prev, error: 'Ingresa 4 dígitos' }));
            return;
        }

        setForm(prev => ({ ...prev, signing: true, error: '' }));
        try {
            const res = await api.post(`/shift-handover/${handover.id}/sign`, {
                pin: form.pin,
                notes: form.notes.trim() || null,
                participantGroup
            });
            setForm({
                pin: '',
                notes: '',
                error: '',
                signing: false,
                lastSigned: res.data.operatorName || null
            });
            if (onUpdate) onUpdate();
        } catch (e) {
            setForm(prev => ({
                ...prev,
                signing: false,
                error: e.response?.data?.error || 'Error al firmar'
            }));
        }
    };

    return (
        <div style={{
            border: `1px solid ${accent.border}`,
            borderRadius: 14,
            overflow: 'hidden',
            background: '#fff'
        }}>
            <div style={{
                padding: '14px 16px',
                background: accent.header,
                borderBottom: `1px solid ${accent.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: accent.color }}>{title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{subtitle}</div>
                </div>
                <div style={{
                    background: accent.badge,
                    color: '#fff',
                    borderRadius: 999,
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 800
                }}>
                    {signedCount}/{expectedCount}
                </div>
            </div>

            <div style={{ height: 4, background: '#e2e8f0' }}>
                <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: allSigned ? '#16a34a' : accent.badge,
                    transition: 'width 0.3s ease'
                }} />
            </div>

            <div style={{ padding: '12px 16px' }}>
                {operators.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
                        No hay operarios programados en este lado del relevo.
                    </div>
                ) : (
                    operators.map((operator, index) => {
                        const signed = signedUserIds.has(operator.userId);
                        const signature = signatures.find(item => item.userId === operator.userId);
                        return (
                            <div key={operator.employeeId || index} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 0',
                                borderBottom: index < operators.length - 1 ? '1px solid #f1f5f9' : 'none'
                            }}>
                                <div style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: '50%',
                                    background: signed ? '#dcfce7' : '#f8fafc',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    {signed ? <CheckCircle size={18} color="#16a34a" /> : <User size={18} color="#94a3b8" />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{operator.name}</div>
                                    {signed && signature && (
                                        <div style={{ fontSize: 11, color: '#64748b' }}>
                                            Firmó a las {new Date(signature.signedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    padding: '4px 10px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    background: signed ? '#dcfce7' : '#fef3c7',
                                    color: signed ? '#16a34a' : '#d97706'
                                }}>
                                    {signed ? 'Firmó' : 'Pendiente'}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {!allSigned && (
                <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    {form.lastSigned && (
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: 10,
                            marginBottom: 12,
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            color: '#16a34a',
                            fontSize: 13,
                            fontWeight: 600,
                            textAlign: 'center'
                        }}>
                            ✅ {form.lastSigned} firmó correctamente
                        </div>
                    )}

                    {!canSign ? (
                        <div style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            color: '#1d4ed8',
                            fontSize: 13,
                            fontWeight: 600,
                            textAlign: 'center'
                        }}>
                            {lockedMessage}
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                                <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                                Firma con PIN
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={4}
                                    placeholder="PIN (4 dígitos)"
                                    value={form.pin}
                                    onChange={e => setForm(prev => ({
                                        ...prev,
                                        pin: e.target.value.replace(/\D/g, '').slice(0, 4),
                                        error: ''
                                    }))}
                                    onKeyDown={e => e.key === 'Enter' && handleSign()}
                                    style={{
                                        flex: 1,
                                        padding: '12px 16px',
                                        borderRadius: 12,
                                        border: `2px solid ${form.error ? '#fca5a5' : '#e2e8f0'}`,
                                        fontSize: 20,
                                        fontWeight: 700,
                                        textAlign: 'center',
                                        letterSpacing: 8,
                                        fontFamily: 'monospace'
                                    }}
                                />
                                <button
                                    onClick={handleSign}
                                    disabled={form.signing || form.pin.length !== 4}
                                    style={{
                                        padding: '12px 20px',
                                        borderRadius: 12,
                                        border: 'none',
                                        background: form.pin.length === 4 ? accent.badge : '#94a3b8',
                                        color: '#fff',
                                        fontWeight: 800,
                                        fontSize: 14,
                                        cursor: 'pointer',
                                        opacity: form.signing ? 0.7 : 1
                                    }}
                                >
                                    {form.signing ? '...' : 'Firmar'}
                                </button>
                            </div>

                            <input
                                type="text"
                                placeholder="Observación individual (opcional)"
                                value={form.notes}
                                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: 10,
                                    border: '1px solid #e2e8f0',
                                    fontSize: 13,
                                    boxSizing: 'border-box'
                                }}
                            />

                            {form.error && (
                                <div style={{
                                    marginTop: 8,
                                    padding: '8px 12px',
                                    borderRadius: 10,
                                    background: '#fef2f2',
                                    color: '#dc2626',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    textAlign: 'center'
                                }}>
                                    {form.error}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default function OperatorSignaturePanel({ handover, onUpdate }) {
    const [outgoingForm, setOutgoingForm] = useState({ pin: '', notes: '', error: '', signing: false, lastSigned: null });
    const [incomingForm, setIncomingForm] = useState({ pin: '', notes: '', error: '', signing: false, lastSigned: null });

    if (!handover) return null;

    const incomingCanSign = handover.status === 'DELIVERED';
    const isCompleted = ['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status);

    return (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{
                padding: '16px 20px',
                background: 'linear-gradient(135deg, #f8fafc, #eef2ff)',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap'
            }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
                        <Users size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                        Hoja Única de Firmas
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                        {SHIFT_LABELS[handover.outgoingShift]} entrega a {SHIFT_LABELS[handover.incomingShift]}
                    </div>
                </div>
                {isCompleted && (
                    <div style={{
                        padding: '6px 12px',
                        borderRadius: 999,
                        background: '#dcfce7',
                        color: '#166534',
                        fontSize: 12,
                        fontWeight: 800
                    }}>
                        Relevo cerrado
                    </div>
                )}
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 16,
                padding: 16
            }}>
                <SignatureSection
                    title="Salen"
                    subtitle={`Turno ${SHIFT_LABELS[handover.outgoingShift]} — firman quienes entregan`}
                    participantGroup="OUTGOING"
                    handover={handover}
                    form={outgoingForm}
                    setForm={setOutgoingForm}
                    canSign={!['DELIVERED', 'RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status)}
                    lockedMessage="Las firmas de salida se cierran cuando el líder saliente entrega el relevo."
                    accent={{ color: '#b45309', border: '#fcd34d', header: '#fffbeb', badge: '#f59e0b' }}
                    onUpdate={onUpdate}
                />

                <SignatureSection
                    title="Entran"
                    subtitle={`Turno ${SHIFT_LABELS[handover.incomingShift]} — firman quienes reciben`}
                    participantGroup="INCOMING"
                    handover={handover}
                    form={incomingForm}
                    setForm={setIncomingForm}
                    canSign={incomingCanSign}
                    lockedMessage="Las firmas de ingreso se habilitan cuando el líder saliente entrega el relevo."
                    accent={{ color: '#2563eb', border: '#93c5fd', header: '#eff6ff', badge: '#2563eb' }}
                    onUpdate={onUpdate}
                />
            </div>
        </div>
    );
}
