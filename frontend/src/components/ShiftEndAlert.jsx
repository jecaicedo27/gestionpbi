import { useState, useEffect } from 'react';

/**
 * ShiftEndAlert — Shows a banner 10 minutes before the shift ends
 * reminding the leader to prepare for handoff.
 * 
 * Shift schedule (Colombia UTC-5):
 *   MAÑANA: 06:00 - 14:00 → alert at 13:50
 *   TARDE:  14:00 - 22:00 → alert at 21:50
 *   NOCHE:  22:00 - 06:00 → alert at 05:50
 */

const SHIFT_END_TIMES = {
    MANANA: { hour: 14, minute: 0 },
    TARDE:  { hour: 22, minute: 0 },
    NOCHE:  { hour: 6,  minute: 0 },  // next day
};

const SHIFT_LABELS = {
    MANANA: '🌅 Mañana',
    TARDE:  '☀️ Tarde',
    NOCHE:  '🌙 Noche',
};

const ALERT_MINUTES_BEFORE = 10;

function getColombiaTime() {
    const now = new Date();
    // Get UTC time, then offset -5 hours for Colombia
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcMs + (-5 * 3600000));
}

function getCurrentShift(colombiaTime) {
    const h = colombiaTime.getHours();
    if (h >= 6 && h < 14) return 'MANANA';
    if (h >= 14 && h < 22) return 'TARDE';
    return 'NOCHE';
}

function getMinutesUntilShiftEnd(colombiaTime, shift) {
    const endTime = SHIFT_END_TIMES[shift];
    if (!endTime) return Infinity;

    const currentMinutes = colombiaTime.getHours() * 60 + colombiaTime.getMinutes();
    let endMinutes = endTime.hour * 60 + endTime.minute;

    // NOCHE shift: if current time is after 22:00, end is tomorrow at 6:00
    if (shift === 'NOCHE' && currentMinutes >= 22 * 60) {
        endMinutes = 24 * 60 + endTime.hour * 60 + endTime.minute; // next day
    }

    return endMinutes - currentMinutes;
}

export default function ShiftEndAlert({ userRole }) {
    const [visible, setVisible] = useState(false);
    const [minutesLeft, setMinutesLeft] = useState(null);
    const [currentShift, setCurrentShift] = useState('');
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        // Only show for production roles
        const productionRoles = ['PRODUCCION', 'OPERARIO_PICKING', 'ADMIN'];
        if (!productionRoles.includes(userRole)) return;

        const check = () => {
            const colombiaTime = getColombiaTime();
            const shift = getCurrentShift(colombiaTime);
            const minsLeft = getMinutesUntilShiftEnd(colombiaTime, shift);

            setCurrentShift(shift);
            setMinutesLeft(minsLeft);

            // Show alert when <= ALERT_MINUTES_BEFORE and > 0
            if (minsLeft <= ALERT_MINUTES_BEFORE && minsLeft > 0) {
                setVisible(true);
            } else {
                setVisible(false);
                setDismissed(false); // Reset dismiss for next cycle
            }
        };

        check();
        const interval = setInterval(check, 30000); // Check every 30 seconds
        return () => clearInterval(interval);
    }, [userRole]);

    if (!visible || dismissed) return null;

    const isUrgent = minutesLeft <= 3;
    const nextShift = currentShift === 'MANANA' ? 'TARDE' : currentShift === 'TARDE' ? 'NOCHE' : 'MANANA';

    return (
        <div style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            width: '94%',
            maxWidth: 520,
            animation: 'slideUp 0.4s ease-out, alertGlow 2s ease-in-out infinite',
        }}>
            <div style={{
                background: isUrgent
                    ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                    : 'linear-gradient(135deg, #f59e0b, #d97706)',
                borderRadius: 18,
                padding: '16px 20px',
                boxShadow: isUrgent
                    ? '0 8px 32px rgba(220,38,38,0.5)'
                    : '0 8px 32px rgba(245,158,11,0.45)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                border: '1px solid rgba(255,255,255,0.2)',
            }}>
                {/* Bell icon */}
                <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, flexShrink: 0,
                    animation: isUrgent ? 'shake 0.5s ease-in-out infinite' : 'none'
                }}>
                    {isUrgent ? '🚨' : '🔔'}
                </div>

                <div style={{ flex: 1 }}>
                    <div style={{
                        color: '#fff', fontWeight: 800, fontSize: 15,
                        marginBottom: 2, letterSpacing: '-0.3px'
                    }}>
                        {isUrgent
                            ? `⚠️ ¡${minutesLeft} min para entrega!`
                            : `Entrega de turno en ${minutesLeft} minutos`
                        }
                    </div>
                    <div style={{
                        color: 'rgba(255,255,255,0.85)', fontSize: 13,
                        fontWeight: 500, lineHeight: 1.4
                    }}>
                        {SHIFT_LABELS[currentShift]} termina pronto.
                        Líder: prepara checklist para {SHIFT_LABELS[nextShift]}
                    </div>
                </div>

                {/* Dismiss button */}
                <button
                    onClick={() => setDismissed(true)}
                    style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: 'rgba(255,255,255,0.15)',
                        border: 'none', color: '#fff', cursor: 'pointer',
                        fontSize: 16, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', flexShrink: 0,
                    }}
                    title="Cerrar alerta"
                >
                    ✕
                </button>
            </div>

            <style>{`
                @keyframes slideUp {
                    from { transform: translateX(-50%) translateY(100px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
                @keyframes alertGlow {
                    0%, 100% { filter: brightness(1); }
                    50% { filter: brightness(1.05); }
                }
                @keyframes shake {
                    0%, 100% { transform: rotate(0deg); }
                    25% { transform: rotate(-5deg); }
                    75% { transform: rotate(5deg); }
                }
            `}</style>
        </div>
    );
}
