import { useState, useEffect } from 'react';
import api from '../services/api';

const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };

export default function ShiftBlockScreen({ userRole }) {
    const [blocked, setBlocked] = useState(false);
    const [pending, setPending] = useState([]);
    const [checking, setChecking] = useState(true);
    const [outgoingShift, setOutgoingShift] = useState('');

    useEffect(() => {
        // Only check for production roles
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
        // Re-check every 30 seconds
        const interval = setInterval(checkBlock, 30000);
        return () => clearInterval(interval);
    }, [userRole]);

    if (checking) return null;
    if (!blocked) return null;

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

                <p style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                    Contacta al líder del turno {outgoingShift} para agilizar la entrega
                </p>

                {/* Refresh button */}
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        marginTop: 16, padding: '12px 28px', borderRadius: 12, border: 'none',
                        background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                        color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                        boxShadow: '0 4px 16px rgba(37,99,235,0.3)'
                    }}
                >
                    🔄 Verificar de nuevo
                </button>
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
