import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const socket = io(import.meta.env.VITE_POPPING_SOCKET_URL || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

const PROCUREMENT_ALERT_EVENT = 'purchase_order:workflow-alert';
const PROCUREMENT_ALERT_CHANNEL = 'PURCHASE_ORDER_FINANCE';
const PROCUREMENT_ALERT_ROLES = ['CARTERA', 'CONTABILIDAD'];
const ROLE_LABELS = {
    CARTERA: 'Cartera',
    CONTABILIDAD: 'Contabilidad'
};

const normalizeRole = (role) => String(role || '').trim().toUpperCase();

const getAlertId = (alert) => alert?.id || `${alert?.type || 'PO'}:${alert?.orderId || alert?.orderNumber}`;

const isPurchaseFinanceAlert = (alert) => {
    if (!alert) return false;
    if (alert.eventName && alert.eventName !== PROCUREMENT_ALERT_EVENT) return false;
    if (alert.channel) return alert.channel === PROCUREMENT_ALERT_CHANNEL;
    return alert.module === 'PROCUREMENT' && alert.source === 'PURCHASE_ORDERS';
};

const canRoleSeeAlert = (role, alert) => {
    const normalizedRole = normalizeRole(role);
    if (!PROCUREMENT_ALERT_ROLES.includes(normalizedRole)) return false;
    if (!isPurchaseFinanceAlert(alert)) return false;
    const targetRoles = Array.isArray(alert?.targetRoles)
        ? alert.targetRoles.map(normalizeRole)
        : [];
    return targetRoles.includes(normalizedRole);
};

const showNativeNotification = (alert) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const rawTitle = alert.title || 'Alerta de orden de compra';
    const title = rawTitle.toUpperCase().includes('COMPRAS')
        ? rawTitle
        : `COMPRAS - ${rawTitle}`;

    new Notification(title, {
        body: alert.message || `${alert.orderNumber || 'OC'} requiere revisión.`,
        icon: '/favicon.ico',
        requireInteraction: true
    });
};

const PurchaseOrderAlert = () => {
    const { user } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const audioCtxRef = useRef(null);
    const userRole = normalizeRole(user?.role);
    const isAllowedRole = PROCUREMENT_ALERT_ROLES.includes(userRole);

    useEffect(() => {
        if (!isAllowedRole) {
            setAlerts([]);
            return;
        }

        setAlerts(prev => prev.filter(alert => canRoleSeeAlert(userRole, alert)));
    }, [isAllowedRole, userRole]);

    useEffect(() => {
        if (!isAllowedRole) return;

        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }

        let cancelled = false;
        api.get('/procurement/purchase-order-alerts/pending')
            .then(res => {
                if (cancelled) return;
                const pendingAlerts = Array.isArray(res.data?.alerts) ? res.data.alerts : [];
                const visibleAlerts = pendingAlerts.filter(alert => canRoleSeeAlert(userRole, alert));
                if (visibleAlerts.length === 0) return;

                setAlerts(prev => {
                    const existing = new Set(prev.map(getAlertId));
                    const fresh = visibleAlerts.filter(alert => !existing.has(getAlertId(alert)));
                    return fresh.length ? [...prev, ...fresh].slice(-5) : prev;
                });
            })
            .catch(error => {
                console.warn('No se pudieron cargar alertas pendientes de compras:', error.message);
            });

        return () => {
            cancelled = true;
        };
    }, [isAllowedRole, userRole]);

    useEffect(() => {
        if (!isAllowedRole) return;

        const handleWorkflowAlert = (data) => {
            if (!canRoleSeeAlert(userRole, data)) return;

            setAlerts(prev => {
                const alertId = getAlertId(data);
                if (prev.some(alert => getAlertId(alert) === alertId)) return prev;
                showNativeNotification(data);
                return [...prev, data].slice(-5);
            });
        };

        socket.on(PROCUREMENT_ALERT_EVENT, handleWorkflowAlert);

        return () => {
            socket.off(PROCUREMENT_ALERT_EVENT, handleWorkflowAlert);
        };
    }, [isAllowedRole, userRole]);

    useEffect(() => {
        if (!isAllowedRole || alerts.length === 0) return;

        try {
            if (!window.__globalPoppingAudioCtx) {
                window.__globalPoppingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = window.__globalPoppingAudioCtx;
            audioCtxRef.current = ctx;

            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const frequencies = [440, 587.33, 740];
            frequencies.forEach((freq, i) => {
                setTimeout(() => {
                    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'sine';
                    osc.start(ctx.currentTime);
                    gain.gain.setValueAtTime(0.65, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
                    osc.stop(ctx.currentTime + 0.28);
                }, i * 220);
            });
        } catch (error) {
            console.warn('Audio not available:', error);
        }
    }, [alerts.length, isAllowedRole]);

    const handleDismiss = (alertId) => {
        setAlerts(prev => prev.filter(alert => getAlertId(alert) !== alertId));
    };

    if (alerts.length === 0) return null;

    return (
        <div style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
            display: 'flex', flexDirection: 'column', gap: '12px',
            pointerEvents: 'none'
        }}>
            {alerts.map((alert, idx) => {
                const alertId = getAlertId(alert);
                const color = alert.color || '#2563eb';
                const scopeLabel = alert.scopeLabel || 'COMPRAS';
                const audienceLabel = alert.audienceLabel || `Solo ${ROLE_LABELS[userRole] || userRole}`;
                const title = alert.title || 'Orden de compra';

                return (
                    <div key={alertId || idx} style={{
                        background: '#fff',
                        borderRadius: 8,
                        width: 340,
                        maxWidth: 'calc(100vw - 32px)',
                        padding: '16px 20px',
                        borderLeft: `6px solid ${color}`,
                        borderTop: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                        borderBottom: '1px solid #e2e8f0',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                        animation: 'po-slide-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                        position: 'relative',
                        pointerEvents: 'auto'
                    }}>
                        <button
                            onClick={() => handleDismiss(alertId)}
                            style={{
                                position: 'absolute', top: 8, right: 8,
                                background: 'none', border: 'none',
                                fontSize: 18, color: '#94a3b8', cursor: 'pointer',
                                padding: '4px'
                            }}
                            aria-label="Cerrar alerta de compra"
                        >
                            ×
                        </button>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 10,
                            paddingRight: 24
                        }}>
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: '#111827',
                                color: '#ffffff',
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: 0
                            }}>
                                {scopeLabel}
                            </span>
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: '#f8fafc',
                                color,
                                border: `1px solid ${color}33`,
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: 0
                            }}>
                                {audienceLabel}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <div style={{ fontSize: 24 }}>{alert.icon || '🛒'}</div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a', fontWeight: 700 }}>
                                    {title}
                                </h3>
                                <p style={{ margin: 0, fontSize: 13, color, fontWeight: 700 }}>
                                    {alert.orderNumber}
                                </p>
                            </div>
                        </div>
                        <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.4 }}>
                            {alert.message || (
                                <>
                                    El proveedor <strong>{alert.supplierName}</strong> tiene una orden pendiente.
                                </>
                            )}
                        </p>
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.35 }}>
                            Alerta exclusiva del flujo de compras para {audienceLabel.replace('Solo ', '')}.
                        </p>
                        <button
                            onClick={() => {
                                handleDismiss(alertId);
                                window.location.href = alert.url || '/procurement/purchase-orders';
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
                            {alert.actionLabel || 'VER ÓRDENES'}
                        </button>
                    </div>
                );
            })}
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
