import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';

const socket = io(import.meta.env.VITE_POPPING_SOCKET_URL || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// Emails allowed to see cocción alarms (besides ADMIN)
const ALARM_ALLOWED_EMAILS = ['gabriel@pbi.com', 'jesus@pbi.com', 'jontiveros@pbi.com'];

// ── Push subscription helper ──
async function subscribeToPush() {
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('🔔 Push: Notification permission denied');
            return;
        }

        const registration = await navigator.serviceWorker.ready;

        // Get VAPID public key from backend
        const apiBase = import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3051/api';
        const resp = await fetch(`${apiBase}/push/vapid-key`);
        if (!resp.ok) return;
        const { publicKey } = await resp.json();
        if (!publicKey) return;

        // Convert VAPID key to Uint8Array
        const urlBase64ToUint8Array = (base64String) => {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
        };

        // Subscribe (or get existing subscription)
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });
        }

        // Send subscription to backend
        await fetch(`${apiBase}/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription.toJSON()),
        });

        console.log('🔔 Push: Subscribed successfully');
    } catch (err) {
        console.warn('🔔 Push subscription error:', err.message);
    }
}

const GlobalTimerAlert = () => {
    const { user } = useAuth();
    const [alerts, setAlerts] = useState([]); // [{noteId, ...}]
    const audioCtxRef = useRef(null);
    const beepRef = useRef(null);
    const vibRef = useRef(null);

    // Check if current user is allowed to see alarms
    const isAllowed = user && (
        user.role?.toUpperCase() === 'ADMIN' ||
        ALARM_ALLOWED_EMAILS.includes(user.email?.toLowerCase())
    );

    // ── Subscribe to Web Push on mount ──
    useEffect(() => {
        if (isAllowed) subscribeToPush();
    }, [isAllowed]);

    useEffect(() => {
        if (!isAllowed) return; // Don't listen if not allowed

        const handleAlarm = (data) => {
            setAlerts(prev => {
                // Don't duplicate
                if (prev.some(a => a.noteId === data.noteId)) return prev;
                return [...prev, data];
            });
        };

        const handleDismiss = ({ noteId }) => {
            setAlerts(prev => prev.filter(a => a.noteId !== noteId));
        };

        socket.on('production:timer-alarm', handleAlarm);
        socket.on('production:timer-dismissed', handleDismiss);

        return () => {
            socket.off('production:timer-alarm', handleAlarm);
            socket.off('production:timer-dismissed', handleDismiss);
        };
    }, [isAllowed]);

    // Sound + vibration when alerts present
    useEffect(() => {
        if (alerts.length === 0) {
            stopAlarm();
            return;
        }

        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtxRef.current = ctx;

            const playBeep = () => {
                if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880;
                osc.type = 'square';
                gain.gain.value = 0.25;
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.stop(ctx.currentTime + 0.4);
            };

            playBeep();
            beepRef.current = setInterval(playBeep, 1200);
        } catch (e) {
            console.warn('Audio not available:', e);
        }

        const startVib = () => {
            if ('vibrate' in navigator) navigator.vibrate([400, 200, 400]);
        };
        startVib();
        vibRef.current = setInterval(startVib, 2000);

        return () => stopAlarm();
    }, [alerts.length > 0]);

    const stopAlarm = () => {
        if (beepRef.current) { clearInterval(beepRef.current); beepRef.current = null; }
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
        }
        if (vibRef.current) { 
            clearInterval(vibRef.current); 
            vibRef.current = null; 
            if ('vibrate' in navigator) navigator.vibrate(0);
        }
    };

    const handleAck = (noteId) => {
        socket.emit('production:timer-ack', { noteId });
        setAlerts(prev => prev.filter(a => a.noteId !== noteId));
    };

    if (alerts.length === 0) return null;

    const alert = alerts[0]; // Show one at a time

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        }}>
            <div style={{
                background: '#fff', borderRadius: 24, maxWidth: 440, width: '90%',
                padding: '36px 28px', textAlign: 'center',
                border: '4px solid #ef4444',
                boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
                animation: 'gta-pulse 1s ease-in-out infinite',
            }}>
                <div style={{ fontSize: 64, marginBottom: 12, animation: 'gta-bounce 0.6s ease infinite' }}>🔔</div>
                <h2 style={{
                    fontSize: 28, fontWeight: 900, color: '#dc2626',
                    margin: '0 0 8px', lineHeight: 1.1,
                }}>
                    ¡TIEMPO COMPLETADO!
                </h2>
                <p style={{ fontSize: 16, color: '#334155', fontWeight: 600, margin: '0 0 4px' }}>
                    {alert.alertType === 'COCCION'
                        ? <>Cocción a <span style={{ color: '#dc2626', fontWeight: 900 }}>{alert.targetTemp}{alert.tempUnit}</span> · {alert.timerMinutes} min</>
                        : 'Timer de producción finalizado'
                    }
                </p>
                <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 6px' }}>
                    {alert.batchNumber} {alert.flavor && `— ${alert.flavor}`}
                </p>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>
                    {alert.stageName}
                </p>
                <button
                    onClick={() => handleAck(alert.noteId)}
                    style={{
                        width: '100%', padding: '16px 0',
                        background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                        color: '#fff', border: 'none', borderRadius: 16,
                        fontSize: 18, fontWeight: 900, cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(220,38,38,0.4)',
                        transition: 'transform 0.1s',
                    }}
                    onMouseDown={(e) => e.target.style.transform = 'scale(0.97)'}
                    onMouseUp={(e) => e.target.style.transform = 'scale(1)'}
                >
                    ✅ ENTENDIDO — VERIFICADO
                </button>
                {alerts.length > 1 && (
                    <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, marginTop: 10 }}>
                        ⚠️ {alerts.length - 1} alerta(s) más pendiente(s)
                    </p>
                )}
            </div>

            <style>{`
                @keyframes gta-pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                }
                @keyframes gta-bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
            `}</style>
        </div>
    );
};

export default GlobalTimerAlert;
