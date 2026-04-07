import { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Delete, ArrowRight, LogOut } from 'lucide-react';

const PinLockScreen = ({ lastUser, onUnlock, onFullLogout }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [shake, setShake] = useState(false);
    const [success, setSuccess] = useState(false);
    const containerRef = useRef(null);

    // Auto-submit when 4 digits entered
    useEffect(() => {
        if (pin.length === 4) {
            handleSubmit();
        }
    }, [pin]);

    const handleSubmit = async () => {
        if (loading || pin.length !== 4) return;
        setLoading(true);
        setError('');
        try {
            const result = await onUnlock(pin);
            if (result.success) {
                setSuccess(true);
                setTimeout(() => {
                    setSuccess(false);
                    setPin('');
                }, 600);
            } else {
                triggerError(result.error || 'PIN incorrecto');
            }
        } catch (err) {
            triggerError(err.message || 'Error de conexión');
        }
        setLoading(false);
    };

    const triggerError = (msg) => {
        setError(msg);
        setShake(true);
        setPin('');
        setTimeout(() => setShake(false), 500);
        // Vibrate on supported devices
        if (navigator.vibrate) navigator.vibrate(200);
    };

    const handleKeyPress = useCallback((num) => {
        if (pin.length < 4 && !loading) {
            setPin(prev => prev + num);
            setError('');
        }
    }, [pin, loading]);

    const handleDelete = useCallback(() => {
        setPin(prev => prev.slice(0, -1));
        setError('');
    }, []);

    const handleClear = useCallback(() => {
        setPin('');
        setError('');
    }, []);

    // Physical keyboard support
    useEffect(() => {
        const handler = (e) => {
            if (e.key >= '0' && e.key <= '9') {
                handleKeyPress(e.key);
            } else if (e.key === 'Backspace') {
                handleDelete();
            } else if (e.key === 'Escape') {
                handleClear();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleKeyPress, handleDelete, handleClear]);

    const dots = Array(4).fill(0).map((_, i) => (
        <div
            key={i}
            className={`pin-dot ${i < pin.length ? 'pin-dot--filled' : ''} ${success ? 'pin-dot--success' : ''}`}
        />
    ));

    const numpad = [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['clear', '0', 'delete']
    ];

    const roleLabel = {
        ADMIN: 'Administrador',
        LOGISTICA: 'Logística',
        OPERARIO_PICKING: 'Empaque',
        PRODUCCION: 'Producción',
        CALIDAD: 'Calidad',
        CONTABILIDAD: 'Contabilidad',
        COMERCIAL: 'Comercial',
        QUIMICO: 'Químico',
        CARTERA: 'Cartera',
    };

    return (
        <div className="pin-lock-overlay" ref={containerRef}>
            <div className="pin-lock-card">
                {/* Lock icon */}
                <div className={`pin-lock-icon ${success ? 'pin-lock-icon--success' : ''}`}>
                    <Lock size={28} />
                </div>

                <h2 className="pin-lock-title">Sesión Bloqueada</h2>

                {lastUser && (
                    <div className="pin-lock-lastuser">
                        <div className="pin-lock-avatar">
                            {lastUser.name?.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <p className="pin-lock-name">{lastUser.name}</p>
                            <p className="pin-lock-role">{roleLabel[lastUser.role] || lastUser.role}</p>
                        </div>
                    </div>
                )}

                <p className="pin-lock-subtitle">
                    Digita tu PIN de 4 dígitos para continuar
                </p>

                {/* PIN dots */}
                <div className={`pin-dots-container ${shake ? 'pin-shake' : ''}`}>
                    {dots}
                </div>

                {/* Error message */}
                {error && (
                    <p className="pin-error">{error}</p>
                )}

                {/* Numpad */}
                <div className="pin-numpad">
                    {numpad.map((row, ri) => (
                        <div key={ri} className="pin-numpad-row">
                            {row.map((key) => {
                                if (key === 'clear') {
                                    return (
                                        <button
                                            key={key}
                                            onClick={handleClear}
                                            className="pin-key pin-key--action"
                                            disabled={loading}
                                        >
                                            <span className="text-xs font-medium">AC</span>
                                        </button>
                                    );
                                }
                                if (key === 'delete') {
                                    return (
                                        <button
                                            key={key}
                                            onClick={handleDelete}
                                            className="pin-key pin-key--action"
                                            disabled={loading}
                                        >
                                            <Delete size={20} />
                                        </button>
                                    );
                                }
                                return (
                                    <button
                                        key={key}
                                        onClick={() => handleKeyPress(key)}
                                        className="pin-key"
                                        disabled={loading}
                                    >
                                        {key}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Loading indicator */}
                {loading && (
                    <div className="pin-loading">
                        <div className="pin-spinner" />
                        <span>Verificando...</span>
                    </div>
                )}

                {/* Fallback actions */}
                <div className="pin-lock-actions">
                    <button onClick={onFullLogout} className="pin-fallback-btn">
                        <LogOut size={14} />
                        <span>Usar email y contraseña</span>
                        <ArrowRight size={14} />
                    </button>
                </div>
            </div>

            <style>{`
                .pin-lock-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 9999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(15, 23, 42, 0.85);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    animation: pinFadeIn 0.3s ease-out;
                }

                @keyframes pinFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .pin-lock-card {
                    background: white;
                    border-radius: 24px;
                    padding: 32px 28px;
                    width: 340px;
                    max-width: 95vw;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.3);
                    animation: pinSlideUp 0.35s ease-out;
                }

                @keyframes pinSlideUp {
                    from { transform: translateY(24px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                .pin-lock-icon {
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 12px;
                    transition: all 0.3s;
                }
                .pin-lock-icon--success {
                    background: linear-gradient(135deg, #10b981, #34d399);
                    transform: scale(1.1);
                }

                .pin-lock-title {
                    font-size: 1.25rem;
                    font-weight: 700;
                    color: #1e293b;
                    margin: 0 0 8px 0;
                }

                .pin-lock-lastuser {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 8px 14px;
                    margin-bottom: 8px;
                    width: 100%;
                }
                .pin-lock-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.75rem;
                    font-weight: 700;
                    flex-shrink: 0;
                }
                .pin-lock-name {
                    font-size: 0.85rem;
                    font-weight: 600;
                    color: #334155;
                    margin: 0;
                    line-height: 1.2;
                }
                .pin-lock-role {
                    font-size: 0.7rem;
                    color: #94a3b8;
                    margin: 0;
                    font-weight: 500;
                }

                .pin-lock-subtitle {
                    font-size: 0.8rem;
                    color: #94a3b8;
                    margin: 4px 0 16px;
                    text-align: center;
                }

                .pin-dots-container {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 8px;
                }
                .pin-dot {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 2px solid #cbd5e1;
                    transition: all 0.15s ease;
                }
                .pin-dot--filled {
                    background: #6366f1;
                    border-color: #6366f1;
                    transform: scale(1.15);
                }
                .pin-dot--success {
                    background: #10b981 !important;
                    border-color: #10b981 !important;
                }

                @keyframes pinShake {
                    0%, 100% { transform: translateX(0); }
                    15%, 45%, 75% { transform: translateX(-8px); }
                    30%, 60%, 90% { transform: translateX(8px); }
                }
                .pin-shake {
                    animation: pinShake 0.4s ease-in-out;
                }

                .pin-error {
                    color: #ef4444;
                    font-size: 0.75rem;
                    font-weight: 600;
                    margin: 4px 0 4px;
                    text-align: center;
                    min-height: 18px;
                }

                .pin-numpad {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin: 12px 0 8px;
                    width: 100%;
                    max-width: 260px;
                }
                .pin-numpad-row {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                }
                .pin-key {
                    width: 72px;
                    height: 56px;
                    border-radius: 14px;
                    border: 1px solid #e2e8f0;
                    background: #f8fafc;
                    font-size: 1.35rem;
                    font-weight: 600;
                    color: #334155;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.12s;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                    touch-action: manipulation;
                }
                .pin-key:active {
                    background: #6366f1;
                    color: white;
                    border-color: #6366f1;
                    transform: scale(0.95);
                }
                .pin-key:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .pin-key--action {
                    background: transparent;
                    border-color: transparent;
                    color: #94a3b8;
                    font-size: 0.9rem;
                }
                .pin-key--action:active {
                    background: #f1f5f9;
                    color: #475569;
                }

                .pin-loading {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #6366f1;
                    font-size: 0.8rem;
                    font-weight: 600;
                    margin: 8px 0;
                }
                .pin-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid #e2e8f0;
                    border-top-color: #6366f1;
                    border-radius: 50%;
                    animation: pinSpin 0.6s linear infinite;
                }
                @keyframes pinSpin {
                    to { transform: rotate(360deg); }
                }

                .pin-lock-actions {
                    margin-top: 16px;
                    width: 100%;
                    display: flex;
                    justify-content: center;
                }
                .pin-fallback-btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: none;
                    border: none;
                    color: #94a3b8;
                    font-size: 0.75rem;
                    font-weight: 500;
                    cursor: pointer;
                    padding: 8px 12px;
                    border-radius: 8px;
                    transition: all 0.15s;
                }
                .pin-fallback-btn:hover {
                    color: #6366f1;
                    background: #f1f5f9;
                }
            `}</style>
        </div>
    );
};

export default PinLockScreen;
