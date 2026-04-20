import { CheckCircle, Circle, ArrowRight } from 'lucide-react';

const STEPS = [
    { key: 'PENDING', label: 'Inicio', icon: '🕐' },
    { key: 'IN_PROGRESS', label: 'Firmas', icon: '✍️' },
    { key: 'DELIVERED', label: 'Entregado', icon: '📋' },
    { key: 'RECEIVED', label: 'Recibido', icon: '🤝' },
];

const STATUS_ORDER = { PENDING: 0, IN_PROGRESS: 1, DELIVERED: 2, RECEIVED: 3, WITH_INCIDENT: 3, VALIDATED: 4 };

export default function HandoverTimeline({ status }) {
    const currentIndex = STATUS_ORDER[status] ?? 0;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 0, padding: '12px 16px', overflowX: 'auto'
        }}>
            {STEPS.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                const isIncident = active && status === 'WITH_INCIDENT';

                return (
                    <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            minWidth: 64
                        }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: done ? '#dcfce7' : active ? (isIncident ? '#fef2f2' : '#eff6ff') : '#f1f5f9',
                                border: `2px solid ${done ? '#16a34a' : active ? (isIncident ? '#dc2626' : '#2563eb') : '#e2e8f0'}`,
                                transition: 'all 0.3s ease'
                            }}>
                                {done ? (
                                    <CheckCircle size={16} color="#16a34a" />
                                ) : (
                                    <span style={{ fontSize: 14 }}>{isIncident ? '⚠️' : step.icon}</span>
                                )}
                            </div>
                            <span style={{
                                fontSize: 10, fontWeight: active ? 800 : 600,
                                color: done ? '#16a34a' : active ? (isIncident ? '#dc2626' : '#2563eb') : '#94a3b8',
                                textAlign: 'center', whiteSpace: 'nowrap'
                            }}>
                                {isIncident ? 'Novedad' : step.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div style={{
                                width: 24, height: 2, margin: '0 2px',
                                background: i < currentIndex ? '#16a34a' : '#e2e8f0',
                                marginBottom: 18, transition: 'background 0.3s ease'
                            }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
