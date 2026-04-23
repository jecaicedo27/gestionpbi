import { CheckCircle } from 'lucide-react';

const STEPS = [
    { label: 'Inicio', icon: '🕐' },
    { label: 'Firman Salientes', icon: '📤' },
    { label: 'Entrega Líder Saliente', icon: '📋' },
    { label: 'Firman Entrantes', icon: '📥' },
    { label: 'Acepta Líder Entrante', icon: '🤝' }
];

function getSignatureState(handover) {
    const signatures = handover?.signatures || [];
    const outgoingOps = (handover?.outgoingParticipants || []).filter(participant => participant.role !== 'LIDER');
    const incomingOps = (handover?.incomingParticipants || []).filter(participant => participant.role !== 'LIDER');
    const outgoingSignedIds = new Set(signatures.filter(signature => signature.participantGroup === 'OUTGOING').map(signature => signature.userId));
    const incomingSignedIds = new Set(signatures.filter(signature => signature.participantGroup === 'INCOMING').map(signature => signature.userId));

    return {
        outgoingAllSigned: outgoingOps.length === 0 || outgoingOps.every(operator => outgoingSignedIds.has(operator.userId)),
        incomingAllSigned: incomingOps.length === 0 || incomingOps.every(operator => incomingSignedIds.has(operator.userId))
    };
}

function getCurrentStepIndex(handover) {
    if (!handover) return 0;
    const { outgoingAllSigned, incomingAllSigned } = getSignatureState(handover);

    if (['RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status)) return STEPS.length;
    if (handover.status === 'DELIVERED') return incomingAllSigned ? 4 : 3;
    if (handover.status === 'IN_PROGRESS') return outgoingAllSigned ? 2 : 1;
    return 0;
}

export default function HandoverTimeline({ handover }) {
    const currentIndex = getCurrentStepIndex(handover);
    const isIncident = handover?.status === 'WITH_INCIDENT';

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            padding: '12px 16px',
            overflowX: 'auto'
        }}>
            {STEPS.map((step, index) => {
                const done = index < currentIndex;
                const active = index === currentIndex && currentIndex < STEPS.length;

                return (
                    <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                            minWidth: 84
                        }}>
                            <div style={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: done ? '#dcfce7' : active ? (isIncident ? '#fef2f2' : '#eff6ff') : '#f1f5f9',
                                border: `2px solid ${done ? '#16a34a' : active ? (isIncident ? '#dc2626' : '#2563eb') : '#e2e8f0'}`
                            }}>
                                {done ? <CheckCircle size={16} color="#16a34a" /> : <span style={{ fontSize: 14 }}>{isIncident && active ? '⚠️' : step.icon}</span>}
                            </div>
                            <span style={{
                                fontSize: 10,
                                fontWeight: active ? 800 : 600,
                                color: done ? '#16a34a' : active ? (isIncident ? '#dc2626' : '#2563eb') : '#94a3b8',
                                textAlign: 'center',
                                whiteSpace: 'nowrap'
                            }}>
                                {isIncident && active ? 'Novedad' : step.label}
                            </span>
                        </div>
                        {index < STEPS.length - 1 && (
                            <div style={{
                                width: 26,
                                height: 2,
                                margin: '0 2px 18px',
                                background: index < currentIndex ? '#16a34a' : '#e2e8f0'
                            }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
