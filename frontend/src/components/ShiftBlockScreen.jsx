import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import ShiftHandoffForm from './ShiftHandoffForm';
import ShiftHandoffApproval from './ShiftHandoffApproval';

const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };

export default function ShiftBlockScreen({ userRole }) {
    const [blocked, setBlocked] = useState(false);
    const [preHandoffBlock, setPreHandoffBlock] = useState(false);
    const [minutesToEnd, setMinutesToEnd] = useState(null);
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
                setPreHandoffBlock(res.data.preHandoffBlock || false);
                setMinutesToEnd(res.data.minutesToEnd || null);
                setPending(res.data.pending || []);
                setOutgoingShift(res.data.outgoingShift || '');
                if (res.data.blocked) {
                    loadHandoffData();
                }
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

    const [selectedAction, setSelectedAction] = useState(null); // { type: 'OPERATOR'|'LEADER_OUT'|'LEADER_IN', data }

    // ── PIN verification: validate against backend ──
    const handlePinSubmit = async () => {
        if (entregaPin.length !== 4) {
            setEntregaPinError('Ingresa los 4 dígitos');
            return;
        }

        setVerifyingPin(true);
        setEntregaPinError('');

        try {
            const res = await api.post('/shifts/handoff/verify-pin', { pin: entregaPin });
            const identifiedUser = res.data.user;

            if (selectedAction) {
                if (selectedAction.type === 'OPERATOR') {
                    if (identifiedUser.id === selectedAction.data.userId || identifiedUser.role === 'ADMIN') {
                        setAuthenticatedUser(identifiedUser);
                        await loadHandoffData();
                    } else {
                        setEntregaPinError(`PIN no pertenece a ${selectedAction.data.name.split(' ')[0]}`);
                    }
                } else if (selectedAction.type === 'LEADER_OUT' || selectedAction.type === 'LEADER_IN') {
                    if (identifiedUser.role !== 'LIDER' && identifiedUser.role !== 'ADMIN') {
                        setEntregaPinError('Acceso denegado: Solo un líder puede firmar');
                        setVerifyingPin(false);
                        return;
                    }

                    const targetStatus = selectedAction.type === 'LEADER_OUT' ? 'Firma pendiente: Líder Saliente' : 'Firma pendiente: Líder Entrante';
                    const route = selectedAction.type === 'LEADER_OUT' ? 'approve-outgoing' : 'approve-incoming';
                    const pendingIds = pending.filter(p => p.reason === targetStatus && p.handoffId).map(p => p.handoffId);

                    await Promise.all(pendingIds.map(id => api.post(`/shifts/handoff/${id}/${route}`, { pin: entregaPin })));
                    
                    setShowEntregaMode(false);
                    setSelectedAction(null);
                    setEntregaPin('');
                    
                    const blockRes = await api.get('/shifts/handoff/block-status');
                    setBlocked(blockRes.data.blocked);
                    setPending(blockRes.data.pending || []);
                }
            } else {
                if (identifiedUser) {
                    setAuthenticatedUser(identifiedUser);
                    await loadHandoffData();
                } else {
                    setEntregaPinError('PIN no reconocido');
                }
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
            setTimeout(() => {
                // Must access latest state via dispatch or ref if it was stale, but using it directly is fine for this async boundary if we simulate a click or run a function outside
                // Due to closure staleness with setTimeout, we use a submit trigger by relying on the effect or just passing the joined value. 
                // Wait, React state `entregaPin` would be stale in `handlePinSubmit`. 
            }, 50);
        }
    };

    // We use a useEffect to auto-submit when length === 4 to avoid closure staleness.
    useEffect(() => {
        if (entregaPin.length === 4 && !verifyingPin && !entregaPinError) {
            handlePinSubmit();
        }
    }, [entregaPin]);

    const handlePinKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !entregaPin[index] && index > 0) {
            pinRefs.current[index - 1]?.focus();
        }
        if (e.key === 'Enter' && entregaPin.length === 4) {
            handlePinSubmit();
        }
    };

    // ── Approval handlers ──
    const handleApprove = async (handoffId, pin, status) => {
        try {
            const endpoint = status === 'PENDING' ? 'approve-outgoing' : 'approve-incoming';
            await api.post(`/shifts/handoff/${handoffId}/${endpoint}`, { pin });
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

    // ── PRE-HANDOFF BLOCK: 10 min before shift end → only allow going to handoff page ──
    if (preHandoffBlock && !showEntregaMode) {
        const isUrgent = minutesToEnd !== null && minutesToEnd <= 3;
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
            }}>
                <div style={{
                    maxWidth: 480, width: '92%', textAlign: 'center',
                    padding: '48px 32px', borderRadius: 28,
                    background: 'rgba(255,255,255,0.05)',
                    backdropFilter: 'blur(20px)',
                    border: `2px solid ${isUrgent ? 'rgba(220,38,38,0.4)' : 'rgba(245,158,11,0.3)'}`,
                    boxShadow: `0 24px 60px ${isUrgent ? 'rgba(220,38,38,0.3)' : 'rgba(245,158,11,0.2)'}`
                }}>
                    {/* Animated icon */}
                    <div style={{
                        width: 88, height: 88, borderRadius: '50%', margin: '0 auto 24px',
                        background: isUrgent
                            ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                            : 'linear-gradient(135deg, #f59e0b, #d97706)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 44,
                        boxShadow: `0 10px 40px ${isUrgent ? 'rgba(220,38,38,0.5)' : 'rgba(245,158,11,0.4)'}`,
                        animation: isUrgent ? 'preBlockShake 0.6s ease-in-out infinite' : 'preBlockPulse 2s ease-in-out infinite'
                    }}>
                        {isUrgent ? '🚨' : '⏰'}
                    </div>

                    <h2 style={{
                        fontSize: 26, fontWeight: 800, color: '#fff',
                        margin: '0 0 8px', letterSpacing: '-0.5px'
                    }}>
                        {isUrgent ? '¡ENTREGA TU TURNO AHORA!' : 'Hora de Entregar el Turno'}
                    </h2>

                    <p style={{
                        fontSize: 15, color: '#94a3b8', margin: '0 0 8px',
                        lineHeight: 1.5, fontWeight: 500
                    }}>
                        Turno <strong style={{ color: '#fff' }}>{outgoingShift}</strong> finaliza en:
                    </p>

                    {/* Countdown */}
                    <div style={{
                        fontSize: 48, fontWeight: 900, letterSpacing: '-2px',
                        color: isUrgent ? '#ef4444' : '#fbbf24',
                        margin: '8px 0 24px',
                        textShadow: `0 0 20px ${isUrgent ? 'rgba(239,68,68,0.5)' : 'rgba(251,191,36,0.4)'}`
                    }}>
                        {minutesToEnd || '?'} min
                    </div>

                    <p style={{
                        fontSize: 13, color: '#64748b', margin: '0 0 28px',
                        lineHeight: 1.6, fontWeight: 500
                    }}>
                        🔒 El sistema está bloqueado hasta que completes la entrega de turno.
                        Todos los operarios deben firmar con su PIN personal.
                    </p>

                    {/* Main action button */}
                    <button
                        onClick={() => { window.location.href = '/shift-schedule'; }}
                        style={{
                            width: '100%', padding: '18px 24px', borderRadius: 16,
                            background: isUrgent
                                ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                                : 'linear-gradient(135deg, #f59e0b, #d97706)',
                            border: 'none', color: '#fff', cursor: 'pointer',
                            fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px',
                            boxShadow: `0 8px 32px ${isUrgent ? 'rgba(220,38,38,0.5)' : 'rgba(245,158,11,0.4)'}`,
                            transition: 'transform 0.2s, box-shadow 0.2s'
                        }}
                        onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                        🔄 Ir a Entregar Turno
                    </button>
                </div>

                <style>{`
                    @keyframes preBlockPulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.06); }
                    }
                    @keyframes preBlockShake {
                        0%, 100% { transform: translateX(0) scale(1); }
                        25% { transform: translateX(-3px) scale(1.02); }
                        75% { transform: translateX(3px) scale(1.02); }
                    }
                `}</style>
            </div>
        );
    }

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
                        {selectedAction?.type === 'OPERATOR' ? `Hola, ${selectedAction.data.name.split(' ')[0]}` :
                         selectedAction?.type === 'LEADER_OUT' ? 'Firma Líder Saliente' :
                         selectedAction?.type === 'LEADER_IN' ? 'Firma Líder Entrante' :
                         'Identificación'}
                    </h2>

                    <p style={{
                        fontSize: 14, color: '#94a3b8', margin: '0 0 24px',
                        lineHeight: 1.5, fontWeight: 500
                    }}>
                        {selectedAction?.type === 'OPERATOR' ? `Ingresa tu PIN para completar el checklist de ${selectedAction.data.area}` :
                         selectedAction?.type === 'LEADER_OUT' ? 'Ingresa tu PIN de líder para aprobar las entregas salientes' :
                         selectedAction?.type === 'LEADER_IN' ? 'Ingresa tu PIN para recibir la planta formalmente' :
                         'Ingresa tu PIN para acceder al sistema'}
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

    // ── Default block screen (Tablero Inicial Interactivo) ──
    const operariosPorArea = {};
    (handoffOperators || []).forEach(op => {
        if (!operariosPorArea[op.area]) operariosPorArea[op.area] = [];
        operariosPorArea[op.area].push(op);
    });

    const pendingEntrega = pending.filter(p => !p.reason.startsWith('Firma pendiente:'));
    const pendingLeaderOut = pending.some(p => p.reason === 'Firma pendiente: Líder Saliente');
    const pendingLeaderIn = pending.some(p => p.reason === 'Firma pendiente: Líder Entrante');
    const allOperatorsDelivered = pendingEntrega.length === 0;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            overflow: 'auto', padding: '20px 0'
        }}>
            <div style={{
                maxWidth: 600, width: '95%',
                padding: '30px 24px', borderRadius: 24,
                background: 'rgba(255,255,255,0.05)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
                    borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 16
                }}>
                    <div style={{
                        width: 50, height: 50, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 24, boxShadow: '0 4px 14px rgba(37,99,235,0.4)'
                    }}>
                        🔄
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>
                            Turno en proceso de entrega
                        </h1>
                        <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
                            Turno Saliente: {outgoingShift}
                        </div>
                    </div>
                </div>

                {/* Lista de operarios por área */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                    {Object.entries(operariosPorArea).map(([area, ops]) => (
                        <div key={area} style={{
                            background: 'rgba(255,255,255,0.02)', borderRadius: 16,
                            padding: '12px 16px', border: '1px solid rgba(255,255,255,0.05)'
                        }}>
                            <div style={{
                                fontSize: 13, fontWeight: 700, color: '#94a3b8',
                                marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1,
                                display: 'flex', alignItems: 'center', gap: 8
                            }}>
                                {AREA_ICONS[area]} {area}
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {ops.map(op => {
                                    const needsDelivery = op.status === 'NOT_DELIVERED' || op.status === 'REJECTED';
                                    return (
                                        <div key={op.userId} style={{
                                            padding: '12px 14px', borderRadius: 12,
                                            background: needsDelivery ? 'rgba(255,255,255,0.05)' : 'rgba(34,197,94,0.05)',
                                            border: `1px solid ${needsDelivery ? 'rgba(255,255,255,0.1)' : 'rgba(34,197,94,0.2)'}`,
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                        }}>
                                            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
                                                {op.role === 'LIDER' ? '👑 ' : ''}{op.name}
                                            </div>
                                            
                                            {needsDelivery ? (
                                                <button
                                                    onClick={() => {
                                                        setSelectedAction({ type: 'OPERATOR', data: op });
                                                        setShowEntregaMode(true);
                                                    }}
                                                    style={{
                                                        padding: '8px 16px', borderRadius: 8, border: 'none',
                                                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                                        color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                                                        boxShadow: '0 2px 8px rgba(37,99,235,0.3)', transition: 'transform 0.1s'
                                                    }}
                                                    onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
                                                    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                                                >
                                                    Entregar
                                                </button>
                                            ) : (
                                                <div style={{
                                                    fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                                                    color: op.status === 'APPROVED' ? '#4ade80' : '#facc15'
                                                }}>
                                                    {op.status === 'APPROVED' ? '✅ Aprobado' : '✅ Entregado'} 
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    
                    {handoffLoading && (!handoffOperators || handoffOperators.length === 0) && (
                        <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>
                            Cargando datos del turno...
                        </div>
                    )}
                    {!handoffLoading && (!handoffOperators || handoffOperators.length === 0) && (
                        <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>
                            No se encontraron operarios en el turno saliente. (La sesión de bloqueo podría ser de otro empleado o haber un error de red).
                        </div>
                    )}
                </div>

                {/* ── ACTION BUTTONS FOR LEADERS ── */}
                {handoffOperators.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10,
                        paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)'
                    }}>
                        {allOperatorsDelivered && pendingLeaderOut && (
                            <button
                                onClick={() => {
                                    setSelectedAction({ type: 'LEADER_OUT' });
                                    setShowEntregaMode(true);
                                }}
                                style={{
                                    padding: '14px 24px', borderRadius: 14, border: 'none',
                                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                    color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer',
                                    boxShadow: '0 4px 20px rgba(245,158,11,0.35)', width: '100%'
                                }}
                            >
                                📝 Firma Líder Saliente (Aprobar Todas)
                            </button>
                        )}

                        {!pendingLeaderOut && pendingLeaderIn && (
                            <button
                                onClick={() => {
                                    setSelectedAction({ type: 'LEADER_IN' });
                                    setShowEntregaMode(true);
                                }}
                                style={{
                                    padding: '14px 24px', borderRadius: 14, border: 'none',
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                    color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer',
                                    boxShadow: '0 4px 20px rgba(16,185,129,0.35)', width: '100%'
                                }}
                            >
                                ✅ Recibir Turno (Líder Entrante)
                            </button>
                        )}
                        
                        {!allOperatorsDelivered && (
                            <div style={{
                                textAlign: 'center', fontSize: 13, color: '#f87171', fontWeight: 600,
                                background: 'rgba(239,68,68,0.1)', padding: '10px', borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)'
                            }}>
                                ⏳ Esperando que todos los operarios entreguen para habilitar la firma del líder
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
