import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/**
 * Full-screen block: shown after grace period expires for incoming shift workers
 * whose handover has not been completed. They cannot use the system until the
 * outgoing shift completes the handover process or an admin force-completes it.
 *
 * Includes audible alarm that plays when block first appears and every 60 seconds.
 * IMPORTANT: Does NOT block on /shift-schedule so users can actually complete the handover.
 */

function playBlockAlarm() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        // Alarming siren: rising then falling tone
        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            const start = now + i * 0.5;
            osc.frequency.setValueAtTime(400, start);
            osc.frequency.linearRampToValueAtTime(900, start + 0.25);
            osc.frequency.linearRampToValueAtTime(400, start + 0.5);
            gain.gain.setValueAtTime(0.2, start);
            gain.gain.exponentialRampToValueAtTime(0.01, start + 0.48);
            osc.start(start);
            osc.stop(start + 0.5);
        }
        setTimeout(() => ctx.close(), 3000);
    } catch {
        // Audio not available
    }
}

export default function HandoverBlockScreen() {
    const { user } = useAuth();
    const location = useLocation();
    const [blockInfo, setBlockInfo] = useState(null);
    const [checking, setChecking] = useState(true);
    const soundIntervalRef = useRef(null);
    const hasPlayedRef = useRef(false);

    useEffect(() => {
        if (!user || user.role === 'ADMIN') {
            setChecking(false);
            return;
        }

        const check = async () => {
            try {
                const res = await api.get('/shift-handover/block-status');
                setBlockInfo(res.data?.blocked ? res.data : null);
            } catch {
                setBlockInfo(null);
            }
            setChecking(false);
        };

        check();
        const interval = setInterval(check, 20000);
        return () => clearInterval(interval);
    }, [user]);

    // Play alarm sound when block appears
    useEffect(() => {
        if (blockInfo && location.pathname !== '/shift-schedule') {
            if (!hasPlayedRef.current) {
                hasPlayedRef.current = true;
                playBlockAlarm();
            }
            // Repeat alarm every 60 seconds while blocked
            soundIntervalRef.current = setInterval(() => {
                playBlockAlarm();
            }, 60000);
        } else {
            hasPlayedRef.current = false;
        }
        return () => {
            if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
        };
    }, [blockInfo, location.pathname]);

    // Don't block on the shift schedule page — that's where they complete the handover
    if (location.pathname === '/shift-schedule') return null;

    if (checking || !blockInfo) return null;

    const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque' };
    const SHIFT_LABELS = { MANANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche' };

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
                border: '2px solid rgba(220,38,38,0.3)',
                boxShadow: '0 24px 60px rgba(220,38,38,0.2)'
            }}>
                {/* Icon */}
                <div style={{
                    width: 88, height: 88, borderRadius: '50%', margin: '0 auto 24px',
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 44,
                    boxShadow: '0 10px 40px rgba(220,38,38,0.5)',
                    animation: 'handoverBlockPulse 2s ease-in-out infinite'
                }}>
                    🔒
                </div>

                <h2 style={{
                    fontSize: 24, fontWeight: 800, color: '#fff',
                    margin: '0 0 8px', letterSpacing: '-0.5px'
                }}>
                    Turno Bloqueado
                </h2>

                <p style={{
                    fontSize: 15, color: '#94a3b8', margin: '0 0 24px',
                    lineHeight: 1.6, fontWeight: 500
                }}>
                    El relevo de turno de <strong style={{ color: '#fff' }}>
                    {AREA_LABELS[blockInfo.area] || blockInfo.area}</strong> no se ha completado.
                    {blockInfo.outgoingShift && (
                        <> El turno <strong style={{ color: '#fff' }}>
                        {SHIFT_LABELS[blockInfo.outgoingShift]}</strong> debe entregar primero.</>
                    )}
                </p>

                {/* Pending items */}
                {blockInfo.pendingSteps && blockInfo.pendingSteps.length > 0 && (
                    <div style={{
                        padding: '14px 18px', borderRadius: 14, marginBottom: 24,
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        textAlign: 'left'
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 8, textTransform: 'uppercase' }}>
                            Pasos pendientes:
                        </div>
                        {blockInfo.pendingSteps.map((step, i) => (
                            <div key={i} style={{
                                fontSize: 13, color: '#fca5a5', padding: '4px 0',
                                display: 'flex', alignItems: 'center', gap: 8
                            }}>
                                <span style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: '#ef4444', flexShrink: 0
                                }} />
                                {step}
                            </div>
                        ))}
                    </div>
                )}

                {/* Navigate to handover */}
                <button
                    onClick={() => { window.location.href = '/shift-schedule'; }}
                    style={{
                        width: '100%', padding: '16px 24px', borderRadius: 14,
                        background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                        border: 'none', color: '#fff', cursor: 'pointer',
                        fontWeight: 800, fontSize: 16,
                        boxShadow: '0 8px 32px rgba(220,38,38,0.4)',
                        marginBottom: 12
                    }}
                >
                    🔄 Ir a Relevo de Turno
                </button>

                <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}>
                    Si necesitas ayuda, contacta al líder del turno saliente o a un administrador.
                </p>
            </div>

            <style>{`
                @keyframes handoverBlockPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
            `}</style>
        </div>
    );
}
