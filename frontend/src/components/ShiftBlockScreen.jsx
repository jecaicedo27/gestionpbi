import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import ShiftHandoffForm from './ShiftHandoffForm';
import ShiftHandoffApproval from './ShiftHandoffApproval';

const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };

export default function ShiftBlockScreen({ userRole }) {
    const [blocked, setBlocked] = useState(false);
    const [pending, setPending] = useState([]);
    const [checking, setChecking] = useState(true);
    const [outgoingShift, setOutgoingShift] = useState('');

    // ── Entrega mode: PIN unlock to show handoff form ──
    const [showEntregaMode, setShowEntregaMode] = useState(false);
    const [entregaPin, setEntregaPin] = useState('');
    const [entregaPinError, setEntregaPinError] = useState('');
    const [authenticatedUser, setAuthenticatedUser] = useState(null);
    const [verifyingPin, setVerifyingPin] = useState(false);
    const pinRefs = useRef([]);

    // ── Approval data ──
    const [handoffOperators, setHandoffOperators] = useState([]);
    const [handoffList, setHandoffList] = useState([]);
    const [handoffLoading, setHandoffLoading] = useState(false);

    useEffect(() => {
        const productionRoles = ['PRODUCCION', 'OPERARIO_PICKING'];
        if (userRole === 'ADMIN' || !productionRoles.includes(userRole)) {
            setChecking(false);
            setBlocked(false);
            return;
        }

        const checkBlock = async () => {
            try {
                const res = await api.get('/shifts/handoff/block-status');
                setBlocked(res.data.blocked);
                setPending(res.data.pending || []);
                setOutgoingShift(res.data.outgoingShift || '');
            } catch (e) {
                console.error('Block check error:', e);
                setBlocked(false);
            }
            setChecking(false);
        };

        checkBlock();
        const interval = setInterval(checkBlock, 30000);
        return () => clearInterval(interval);
    }, [userRole]);

    // ── Load handoff data for approval panel ──
    const loadHandoffData = async () => {
        setHandoffLoading(true);
        try {
            const res = await api.get('/shifts/handoff/today');
            setHandoffOperators(res.data.operators || []);
            setHandoffList(res.data.handoffs || []);
        } catch (e) {
            console.error(e);
        }
        setHandoffLoading(false);
    };

    // ── PIN verification: validate against backend ──
    const handlePinSubmit = async () => {
        if (entregaPin.length !== 4) {
            setEntregaPinError('Ingresa los 4 dígitos');
            return;
        }

        setVerifyingPin(true);
        setEntregaPinError('');

        try {
            // We'll use a lightweight endpoint to verify PIN and get user info
            // Try to hit the checklists endpoint with auth - if PIN is valid, user exists
            const res = await api.post('/shifts/handoff/verify-pin', { pin: entregaPin });
            if (res.data.user) {
                setAuthenticatedUser(res.data.user);
                await loadHandoffData();
            } else {
                setEntregaPinError('PIN no reconocido');
            }
        } catch (e) {
            setEntregaPinError(e.response?.data?.error || 'PIN incorrecto');
        }
        setVerifyingPin(false);
    };

    // Handle PIN digit input with auto-focus
    const handlePinDigit = (index, value) => {
        const digit = value.replace(/\D/g, '');
        const newPin = entregaPin.split('');
        newPin[index] = digit;
        const joined = newPin.join('');
        setEntregaPin(joined);
        setEntregaPinError('');

        if (digit && index < 3) {
            pinRefs.current[index + 1]?.focus();
        }

        // Auto-submit on 4 digits
        if (joined.replace(/\s/g, '').length === 4 && index === 3) {
            setTimeout(() => handlePinSubmit(), 200);
        }
    };

    const handlePinKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !entregaPin[index] && index > 0) {
            pinRefs.current[index - 1]?.focus();
        }
        if (e.key === 'Enter') {
            handlePinSubmit();
        }
    };

    // ── Approval handlers ──
    const handleApprove = async (handoffId, pin) => {
        try {
            await api.post(`/shifts/handoff/${handoffId}/approve`, { pin });
            await loadHandoffData();
            // Re-check block status
            const blockRes = await api.get('/shifts/handoff/block-status');
            setBlocked(blockRes.data.blocked);
            setPending(blockRes.data.pending || []);
        } catch (e) {
            alert(e.response?.data?.error || 'Error aprobando');
        }
    };

    const handleReject = async (handoffId, pin, reason) => {
        try {
            await api.post(`/shifts/handoff/${handoffId}/reject`, { pin, reason });
            await loadHandoffData();
        } catch (e) {
            alert(e.response?.data?.error || 'Error rechazando');
        }
    };

    const handleFormSuccess = async () => {
        await loadHandoffData();
        // Re-check block status
        const blockRes = await api.get('/shifts/handoff/block-status');
        setBlocked(blockRes.data.blocked);
        setPending(blockRes.data.pending || []);
    };

    if (checking) return null;
    if (!blocked) return null;

    // ── If authenticated user is in: show handoff form + approval panel ──
    if (showEntregaMode && authenticatedUser) {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                overflow: 'auto', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
            }}>
                {/* Top bar */}
                <div style={{
                    position: 'sticky', top: 0, zIndex: 10,
                    background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(10px)',
                    padding: '12px 20px', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 24 }}>🔄</span>
                        <div>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
                                Entrega de Turno — {authenticatedUser.name}
                            </div>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 500 }}>
                                {authenticatedUser.area && `${AREA_ICONS[authenticatedUser.area] || ''} ${authenticatedUser.area}`}
                                {authenticatedUser.role === 'LIDER' && ' · 👑 Líder'}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            setShowEntregaMode(false);
                            setAuthenticatedUser(null);
                            setEntregaPin('');
                        }}
                        style={{
                            padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)',
                            background: 'rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer',
                            fontWeight: 600, fontSize: 13
                        }}
                    >
                        ✕ Cerrar
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    maxWidth: 600, margin: '0 auto', padding: '20px 16px 40px',
                    display: 'flex', flexDirection: 'column', gap: 20
                }}>
                    {/* Handoff form for operators */}
                    <ShiftHandoffForm onSuccess={handleFormSuccess} />

                    {/* Approval panel for leaders */}
                    {authenticatedUser.role === 'LIDER' && (
                        <ShiftHandoffApproval
                            operators={handoffOperators}
                            handoffs={handoffList}
                            outgoingShift={outgoingShift}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            loading={handoffLoading}
                        />
                    )}

                    {/* Also show approval for non-leaders if there are pending approvals */}
                    {authenticatedUser.role !== 'LIDER' && handoffOperators.length > 0 && (
                        <div style={{
                            background: 'rgba(255,255,255,0.05)', borderRadius: 16,
                            padding: 20, border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                            <h3 style={{ color: '#fff', margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
                                📊 Estado de entregas del turno
                            </h3>
                            {handoffOperators.map((op, i) => (
                                <div key={i} style={{
                                    padding: '10px 14px', marginBottom: 6, borderRadius: 10,
                                    background: 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${op.status === 'APPROVED' ? 'rgba(34,197,94,0.3)' : op.status === 'PENDING' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                                            {AREA_ICONS[op.area]} {op.name}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                                        background: op.status === 'APPROVED' ? 'rgba(34,197,94,0.2)' : op.status === 'PENDING' ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)',
                                        color: op.status === 'APPROVED' ? '#4ade80' : op.status === 'PENDING' ? '#fbbf24' : '#f87171'
                                    }}>
                                        {op.status === 'APPROVED' ? '✅ Aprobado' : op.status === 'PENDING' ? '🟡 Esperando' : '🔴 Pendiente'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── PIN entry screen (before authentication) ──
    if (showEntregaMode && !authenticatedUser) {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
            }}>
                <div style={{
                    maxWidth: 420, width: '90%', textAlign: 'center',
                    padding: '40px 32px', borderRadius: 24,
                    background: 'rgba(255,255,255,0.05)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
                }}>
                    <div style={{
                        width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
                        background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 36, boxShadow: '0 8px 30px rgba(37,99,235,0.4)'
                    }}>
                        🔑
                    </div>

                    <h2 style={{
                        fontSize: 22, fontWeight: 800, color: '#fff',
                        margin: '0 0 8px', letterSpacing: '-0.5px'
                    }}>
                        Identificación
                    </h2>

                    <p style={{
                        fontSize: 14, color: '#94a3b8', margin: '0 0 24px',
                        lineHeight: 1.5, fontWeight: 500
                    }}>
                        Ingresa tu PIN para acceder al formulario de entrega de turno
                    </p>

                    {/* PIN input */}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }}>
                        {[0, 1, 2, 3].map(idx => (
                            <input
                                key={idx}
                                ref={el => pinRefs.current[idx] = el}
                                type="password"
                                inputMode="numeric"
                                maxLength={1}
                                value={entregaPin[idx] || ''}
                                onChange={e => handlePinDigit(idx, e.target.value)}
                                onKeyDown={e => handlePinKeyDown(idx, e)}
                                autoFocus={idx === 0}
                                style={{
                                    width: 60, height: 64, textAlign: 'center', fontSize: 28,
                                    fontWeight: 800, borderRadius: 14,
                                    border: `2px solid ${entregaPinError ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                                    outline: 'none', background: 'rgba(255,255,255,0.08)',
                                    color: '#fff', transition: 'border 0.2s',
                                    caretColor: '#3b82f6'
                                }}
                                onFocus={e => { if (!entregaPinError) e.target.style.borderColor = '#3b82f6'; }}
                                onBlur={e => { if (!entregaPinError) e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                            />
                        ))}
                    </div>

                    {entregaPinError && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 10, marginBottom: 16,
                            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                            color: '#f87171', fontSize: 14, fontWeight: 600
                        }}>
                            ❌ {entregaPinError}
                        </div>
                    )}

                    <button
                        onClick={handlePinSubmit}
                        disabled={verifyingPin || entregaPin.length < 4}
                        style={{
                            width: '100%', padding: '14px 24px', borderRadius: 14, border: 'none',
                            background: verifyingPin
                                ? '#475569'
                                : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                            color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
                            marginBottom: 12, transition: 'all 0.2s'
                        }}
                    >
                        {verifyingPin ? '⏳ Verificando…' : '→ Ingresar a entrega'}
                    </button>

                    <button
                        onClick={() => {
                            setShowEntregaMode(false);
                            setEntregaPin('');
                            setEntregaPinError('');
                        }}
                        style={{
                            padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
                            background: 'transparent', color: '#64748b', cursor: 'pointer',
                            fontWeight: 600, fontSize: 14
                        }}
                    >
                        ← Volver
                    </button>
                </div>
            </div>
        );
    }

    // ── Default block screen ──
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
        }}>
            <div style={{
                maxWidth: 480, width: '90%', textAlign: 'center',
                padding: '40px 32px', borderRadius: 24,
                background: 'rgba(255,255,255,0.05)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
            }}>
                {/* Lock icon */}
                <div style={{
                    width: 80, height: 80, borderRadius: '50%', margin: '0 auto 20px',
                    background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 40, boxShadow: '0 8px 30px rgba(220,38,38,0.4)',
                    animation: 'pulse 2s ease-in-out infinite'
                }}>
                    🔒
                </div>

                <h1 style={{
                    fontSize: 26, fontWeight: 800, color: '#fff',
                    margin: '0 0 8px', letterSpacing: '-0.5px'
                }}>
                    TURNO NO ENTREGADO
                </h1>

                <p style={{
                    fontSize: 15, color: '#94a3b8', margin: '0 0 24px',
                    lineHeight: 1.5, fontWeight: 500
                }}>
                    No puedes ingresar al sistema hasta que <strong style={{ color: '#e2e8f0' }}>TODOS</strong> los
                    operarios del turno anterior entreguen y el líder apruebe.
                </p>

                {/* Pending list */}
                <div style={{
                    background: 'rgba(220,38,38,0.1)', borderRadius: 16,
                    padding: '16px', border: '1px solid rgba(220,38,38,0.2)',
                    textAlign: 'left', marginBottom: 20
                }}>
                    <div style={{
                        fontSize: 13, fontWeight: 700, color: '#f87171',
                        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1
                    }}>
                        ⏳ Pendientes ({pending.length})
                    </div>
                    {pending.map((p, i) => (
                        <div key={i} style={{
                            padding: '10px 12px', marginBottom: 6, borderRadius: 10,
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            display: 'flex', alignItems: 'center', gap: 10
                        }}>
                            <span style={{ fontSize: 18 }}>{AREA_ICONS[p.area] || '👤'}</span>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{p.name}</div>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{p.reason}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <p style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginBottom: 16 }}>
                    Contacta al líder del turno {outgoingShift} para agilizar la entrega
                </p>

                {/* ── ACTION BUTTONS ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Main CTA: Enter handoff mode */}
                    <button
                        onClick={() => setShowEntregaMode(true)}
                        style={{
                            padding: '14px 24px', borderRadius: 14, border: 'none',
                            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                            color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer',
                            boxShadow: '0 4px 20px rgba(245,158,11,0.35)',
                            transition: 'all 0.2s', width: '100%'
                        }}
                    >
                        🔑 Soy del turno anterior — Entregar
                    </button>

                    {/* Leader CTA: Go to shift schedule to verify */}
                    <button
                        onClick={() => { window.location.href = '/shift-schedule'; }}
                        style={{
                            padding: '12px 24px', borderRadius: 12, border: 'none',
                            background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
                            color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                            width: '100%'
                        }}
                    >
                        📋 Ver Cuadro de Turnos
                    </button>

                    {/* Secondary: refresh */}
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '12px 24px', borderRadius: 12, border: 'none',
                            background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                            color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
                            width: '100%'
                        }}
                    >
                        🔄 Verificar de nuevo
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
            `}</style>
        </div>
    );
}
