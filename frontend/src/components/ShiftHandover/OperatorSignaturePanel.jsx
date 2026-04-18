import { useState } from 'react';
import { CheckCircle, Clock, Lock, User } from 'lucide-react';
import api from '../../services/api';

const SHIFT_LABELS = { MANANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche' };

export default function OperatorSignaturePanel({ handover, onUpdate }) {
    const [pin, setPin] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [signing, setSigning] = useState(false);
    const [lastSigned, setLastSigned] = useState(null);

    if (!handover) return null;

    const outOps = (handover.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
    const signatures = handover.signatures || [];
    const signedUserIds = new Set(signatures.map(s => s.userId));
    const signedCount = signatures.length;
    const expectedCount = outOps.length;
    const allSigned = signedCount >= expectedCount && expectedCount > 0;
    const progress = expectedCount > 0 ? Math.round((signedCount / expectedCount) * 100) : 0;

    const handleSign = async () => {
        if (pin.length !== 4) { setError('Ingresa 4 dígitos'); return; }
        setSigning(true);
        setError('');
        try {
            const res = await api.post(`/shift-handover/${handover.id}/sign`, { pin, notes: notes.trim() || null });
            setLastSigned(res.data.operatorName);
            setPin('');
            setNotes('');
            if (onUpdate) onUpdate();
        } catch (e) {
            setError(e.response?.data?.error || 'Error al firmar');
        } finally {
            setSigning(false);
        }
    };

    return (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: allSigned ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                borderBottom: `2px solid ${allSigned ? '#86efac' : '#fde68a'}`
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                        {allSigned ? '✅ Todos firmaron' : '✍️ Firma de Operarios'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        Turno {SHIFT_LABELS[handover.outgoingShift]} — {handover.area}
                    </div>
                </div>
                <div style={{
                    background: allSigned ? '#16a34a' : '#f59e0b', color: '#fff',
                    borderRadius: 20, padding: '6px 14px', fontWeight: 800, fontSize: 14
                }}>
                    {signedCount}/{expectedCount}
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: '#e2e8f0' }}>
                <div style={{
                    height: '100%', width: `${progress}%`,
                    background: allSigned ? '#16a34a' : '#f59e0b',
                    transition: 'width 0.5s ease'
                }} />
            </div>

            {/* Operator list */}
            <div style={{ padding: '12px 20px' }}>
                {outOps.map((op, i) => {
                    const signed = signedUserIds.has(op.userId);
                    const sig = signatures.find(s => s.userId === op.userId);
                    return (
                        <div key={op.employeeId || i} style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                            borderBottom: i < outOps.length - 1 ? '1px solid #f1f5f9' : 'none'
                        }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: signed ? '#dcfce7' : '#f1f5f9',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                {signed
                                    ? <CheckCircle size={18} color="#16a34a" />
                                    : <User size={18} color="#94a3b8" />
                                }
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{op.name}</div>
                                {signed && sig && (
                                    <div style={{ fontSize: 11, color: '#64748b' }}>
                                        Firmó a las {new Date(sig.signedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                )}
                            </div>
                            <div style={{
                                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                                background: signed ? '#dcfce7' : '#fef3c7',
                                color: signed ? '#16a34a' : '#d97706'
                            }}>
                                {signed ? 'Firmado' : 'Pendiente'}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Sign form (only if not all signed) */}
            {!allSigned && (
                <div style={{ padding: '16px 20px', borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                    {lastSigned && (
                        <div style={{
                            padding: '8px 12px', borderRadius: 10, marginBottom: 12,
                            background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a',
                            fontSize: 13, fontWeight: 600, textAlign: 'center'
                        }}>
                            ✅ {lastSigned} firmó correctamente
                        </div>
                    )}

                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                        <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                        Ingresa tu PIN para firmar
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="PIN (4 dígitos)"
                            value={pin}
                            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleSign()}
                            style={{
                                flex: 1, padding: '12px 16px', borderRadius: 12,
                                border: `2px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                                fontSize: 20, fontWeight: 700, textAlign: 'center',
                                letterSpacing: 8, fontFamily: 'monospace'
                            }}
                        />
                        <button
                            onClick={handleSign}
                            disabled={signing || pin.length !== 4}
                            style={{
                                padding: '12px 24px', borderRadius: 12, border: 'none',
                                background: pin.length === 4 ? '#16a34a' : '#94a3b8',
                                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                                opacity: signing ? 0.6 : 1
                            }}
                        >
                            {signing ? '...' : 'Firmar'}
                        </button>
                    </div>

                    <input
                        type="text"
                        placeholder="Observación individual (opcional)"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        style={{
                            width: '100%', padding: '8px 12px', borderRadius: 10,
                            border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box'
                        }}
                    />

                    {error && (
                        <div style={{
                            marginTop: 8, padding: '8px 12px', borderRadius: 10,
                            background: '#fef2f2', color: '#dc2626', fontSize: 13,
                            fontWeight: 600, textAlign: 'center'
                        }}>
                            {error}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
