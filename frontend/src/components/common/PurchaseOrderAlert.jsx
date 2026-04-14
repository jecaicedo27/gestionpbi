import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';

const socket = io(import.meta.env.VITE_POPPING_SOCKET_URL || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

const PurchaseOrderAlert = () => {
    const { user } = useAuth();
    const [alerts, setAlerts] = useState([]); // [{orderNumber, supplierName, ...}]
    const audioCtxRef = useRef(null);

    // Check if current user is allowed to see this alert (CARTERA or CONTABILIDAD)
    const isAllowed = user && (
        user.role?.toUpperCase() === 'CARTERA' ||
        user.role?.toUpperCase() === 'CONTABILIDAD'
    );

    useEffect(() => {
        if (!isAllowed) return;

        // Request OS native notification permission
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }

        const handleNewOrder = (data) => {
            setAlerts(prev => {
                // Prevent duplicate by orderNumber
                if (prev.some(a => a.orderNumber === data.orderNumber)) return prev;
                
                // Fire Native OS Notification
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('🛒 Nueva Orden de Compra', {
                        body: `El proveedor ${data.supplierName} tiene una nueva orden (${data.orderNumber}) por revisar.`,
                        icon: '/favicon.ico', // or logo
                        requireInteraction: true // Keeps the notification on screen until interacted with
                    });
                }

                return [...prev, data];
            });
        };

        socket.on('purchase_order:new', handleNewOrder);

        return () => {
            socket.off('purchase_order:new', handleNewOrder);
        };
    }, [isAllowed]);

    // Play a happy notification sound for new purchase orders
    useEffect(() => {
        if (alerts.length === 0) return;

        try {
            // Reutilizar un único contexto global para evitar saturar el hilo de audio del navegador (evita que se congele)
            if (!window.__globalPoppingAudioCtx) {
                window.__globalPoppingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = window.__globalPoppingAudioCtx;
            audioCtxRef.current = ctx;
            
            // Force resume in case it's suspended
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const playTada = () => {
                if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
                
                // Clásico sonido de alerta o campana digital (Din-Din-Don)
                const frequencies = [783.99, 1046.50, 1567.98]; // G5, C6, G6
                
                frequencies.forEach((freq, i) => {
                    setTimeout(() => {
                        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        
                        // 'sine' produce un pitido limpio tipo campana digital sin distorsión
                        osc.frequency.value = freq;
                        osc.type = 'sine'; 
                        
                        osc.start(ctx.currentTime);
                        
                        // Golpe inicial fuerte y caída elegante
                        gain.gain.setValueAtTime(1.0, ctx.currentTime);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                        
                        osc.stop(ctx.currentTime + 0.4);
                    }, i * 200); // Ligeramente más separado para sonar a alerta y no a chicharra ruidosa
                });
            };

            playTada();
        } catch (e) {
            console.warn('Audio not available:', e);
        }

    }, [alerts.length]); // Re-play when alerts length changes

    const handleDismiss = (orderNumber) => {
        setAlerts(prev => prev.filter(a => a.orderNumber !== orderNumber));
    };

    if (alerts.length === 0) return null;

    return (
        <div style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
            display: 'flex', flexDirection: 'column', gap: '12px',
            pointerEvents: 'none' // The container won't block clicks
        }}>
            {alerts.map((alert, idx) => (
                <div key={alert.orderNumber || idx} style={{
                    background: '#fff', borderRadius: 12, width: 320,
                    padding: '16px 20px',
                    borderLeft: '6px solid #10b981',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                    animation: 'po-slide-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                    position: 'relative',
                    pointerEvents: 'auto' // Re-enable clicks for the alert card
                }}>
                    <button 
                        onClick={() => handleDismiss(alert.orderNumber)}
                        style={{
                            position: 'absolute', top: 8, right: 8,
                            background: 'none', border: 'none',
                            fontSize: 18, color: '#94a3b8', cursor: 'pointer',
                            padding: '4px'
                        }}
                    >
                        ×
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <div style={{ fontSize: 24 }}>🛒</div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a', fontWeight: 700 }}>
                                Nueva Orden de Compra
                            </h3>
                            <p style={{ margin: 0, fontSize: 13, color: '#10b981', fontWeight: 600 }}>
                                {alert.orderNumber}
                            </p>
                        </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.4 }}>
                        El proveedor <strong>{alert.supplierName}</strong> tiene una nueva orden pendiente por revisión.
                    </p>
                    <button
                        onClick={() => {
                            handleDismiss(alert.orderNumber);
                            window.location.href = '/procurement/purchase-orders';
                        }}
                        style={{
                            marginTop: 12, width: '100%', padding: '8px 0',
                            background: '#f1f5f9', color: '#334155',
                            border: 'none', borderRadius: 6,
                            fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            transition: 'background 0.2s'
                        }}
                        onMouseOver={e => e.target.style.background = '#e2e8f0'}
                        onMouseOut={e => e.target.style.background = '#f1f5f9'}
                    >
                        VER ÓRDENES
                    </button>
                </div>
            ))}
            <style>{`
                @keyframes po-slide-in {
                    0% { transform: translateX(120%); opacity: 0; }
                    100% { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default PurchaseOrderAlert;
