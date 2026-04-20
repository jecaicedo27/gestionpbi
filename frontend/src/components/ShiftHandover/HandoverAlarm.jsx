import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/**
 * Pre-alert overlay: shows 15 min before shift end to remind outgoing workers.
 * Includes audible alarm that plays every 30 seconds.
 * Dismissible — it's an alert, not a block. The block comes later via HandoverBlockScreen.
 */

// Create alarm sound using Web Audio API
function playAlarmSound(urgent = false) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

        if (urgent) {
            // Urgent: rapid triple beep, repeated twice
            for (let rep = 0; rep < 2; rep++) {
                for (let i = 0; i < 3; i++) {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = 880;
                    osc.type = 'square';
                    const start = now + rep * 0.6 + i * 0.15;
                    gain.gain.setValueAtTime(0.3, start);
                    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.12);
                    osc.start(start);
                    osc.stop(start + 0.12);
                }
            }
        } else {
            // Normal: two gentle tones
            for (let i = 0; i < 2; i++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 660;
                osc.type = 'sine';
                const start = now + i * 0.3;
                gain.gain.setValueAtTime(0.25, start);
                gain.gain.exponentialRampToValueAtTime(0.01, start + 0.25);
                osc.start(start);
                osc.stop(start + 0.25);
            }
        }
        // Close context after sounds finish
        setTimeout(() => ctx.close(), 2000);
    } catch {
        // Audio not supported — silent fallback
    }
}

export default function HandoverAlarm() {
    const { user } = useAuth();
    const [alarm, setAlarm] = useState(null);
    const [dismissed, setDismissed] = useState(false);
    const lastSoundRef = useRef(0);
    const hasPlayedInitial = useRef(false);

    const playSound = useCallback((urgent) => {
        const now = Date.now();
        // Play sound at most every 30 seconds
        if (now - lastSoundRef.current > 25000) {
            lastSoundRef.current = now;
            playAlarmSound(urgent);
        }
    }, []);

    useEffect(() => {
        if (!user || user.role === 'ADMIN') return;

        const check = async () => {
            try {
                const res = await api.get('/shift-handover/alarm-status');
                if (res.data?.shouldAlert) {
                    setAlarm(res.data);
                    // Play sound when alarm first appears or periodically
                    const isUrgent = res.data.minutesUntilEnd != null && res.data.minutesUntilEnd <= 5;
                    if (!hasPlayedInitial.current) {
                        hasPlayedInitial.current = true;
                        playAlarmSound(isUrgent);
                        lastSoundRef.current = Date.now();
                    } else {
                        playSound(isUrgent);
                    }
                } else {
                    setAlarm(null);
                    setDismissed(false);
                    hasPlayedInitial.current = false;
                }
            } catch {
                // Silently ignore — feature might be disabled
            }
        };

        check();
        const interval = setInterval(check, 30000);
        return () => clearInterval(interval);
    }, [user, playSound]);

    if (!alarm || dismissed) return null;

    const isUrgent = alarm.minutesUntilEnd != null && alarm.minutesUntilEnd <= 5;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 8000,
            padding: '0 16px', display: 'flex', justifyContent: 'center',
            animation: 'handoverAlarmSlideDown 0.4s ease'
        }}>
            <div style={{
                maxWidth: 520, width: '100%', marginTop: 16,
                padding: '16px 20px', borderRadius: 16,
                background: isUrgent
                    ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                    : 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#fff',
                boxShadow: `0 8px 32px ${isUrgent ? 'rgba(220,38,38,0.4)' : 'rgba(245,158,11,0.4)'}`,
                display: 'flex', alignItems: 'center', gap: 14
            }}>
                <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0,
                    animation: isUrgent ? 'handoverAlarmPulse 0.8s ease-in-out infinite' : 'none'
                }}>
                    {isUrgent ? '🚨' : '⏰'}
                </div>

                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>
                        {isUrgent ? 'Relevo de turno urgente' : 'Relevo de turno próximo'}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>
                        Tu turno termina en <strong>{alarm.minutesUntilEnd} min</strong>.
                        Dirígete al área de relevo.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                        onClick={() => { window.location.href = '/shift-schedule'; }}
                        style={{
                            padding: '8px 14px', borderRadius: 10, border: '2px solid rgba(255,255,255,0.4)',
                            background: 'rgba(255,255,255,0.15)', color: '#fff',
                            fontWeight: 700, fontSize: 12, cursor: 'pointer'
                        }}
                    >
                        Ir a Relevo
                    </button>
                    <button
                        onClick={() => setDismissed(true)}
                        style={{
                            padding: '8px 10px', borderRadius: 10, border: 'none',
                            background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)',
                            fontWeight: 600, fontSize: 12, cursor: 'pointer'
                        }}
                    >
                        Cerrar
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes handoverAlarmSlideDown {
                    from { transform: translateY(-100%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes handoverAlarmPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
            `}</style>
        </div>
    );
}
