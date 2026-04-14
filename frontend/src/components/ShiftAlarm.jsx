import { useEffect, useState } from 'react';
import api from '../services/api';

const SHIFT_END_MINUTES = {
    MANANA: 14 * 60, // 14:00
    TARDE: 22 * 60,  // 22:00
    NOCHE: 6 * 60    // 06:00
};

export default function ShiftAlarm() {
    const [alarmData, setAlarmData] = useState(null);
    const [showModal, setShowModal] = useState(false);
    
    // Check alarm status occasionally
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await api.get('/shifts/handoff/alarm-status');
                setAlarmData(res.data);
            } catch (e) {
                console.error('Error fetching alarm status', e);
            }
        };
        
        checkStatus();
        const interval = setInterval(checkStatus, 5 * 60 * 1000); // Check every 5 mins
        return () => clearInterval(interval);
    }, []);

    // Check time every 30 seconds
    useEffect(() => {
        const isSimulated = window.location.search.includes('simular-alarma=true');
        if (!alarmData?.shouldAlert && !isSimulated) return;

        const timer = setInterval(() => {
            const now = new Date();
            const localMinutes = now.getHours() * 60 + now.getMinutes();
            const shiftEnd = SHIFT_END_MINUTES[alarmData.outgoingShift];
            
            if (!shiftEnd) return;

            // Handle Noche edge case where shift is overnight
            let diff = shiftEnd - localMinutes;
            if (diff < -720) diff += 1440; 

            // Trigger window is between 0 and 20 mins before shift end
            const isSimulated = window.location.search.includes('simular-alarma=true');
            const isWithin20Mins = (diff > 0 && diff <= 20) || isSimulated;

            if (isWithin20Mins) {
                const dismissKey = `alarm_dismissed_${now.toISOString().split('T')[0]}_${alarmData.outgoingShift}`;
                if (!localStorage.getItem(dismissKey) && !showModal) {
                    setShowModal(true);
                }
            } else {
                setShowModal(false);
            }
        }, 10000); // Poll every 10 seconds for reactivity

        return () => clearInterval(timer);
    }, [alarmData, showModal]);

    // Audio Alert
    useEffect(() => {
        if (!showModal) return;

        let actx;
        let osc;
        let gain;
        let pulse;
        let isPlaying = true;

        try {
            actx = new (window.AudioContext || window.webkitAudioContext)();
            osc = actx.createOscillator();
            gain = actx.createGain();
            osc.connect(gain);
            gain.connect(actx.destination);

            osc.type = 'square';
            osc.frequency.setValueAtTime(800, actx.currentTime); // Beep tone
            
            // Pulsing pattern
            pulse = setInterval(() => {
                if (!isPlaying || actx.state !== 'running') return;
                gain.gain.setValueAtTime(0.5, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.5);
            }, 1000);

            osc.start();
            
            // Need to resume context if blocked by browser auto-play policy
            if (actx.state === 'suspended') {
                actx.resume();
            }
        } catch(e) {
            console.error("Audio API error", e);
        }

        return () => {
            isPlaying = false;
            clearInterval(pulse);
            try { if (osc) osc.stop(); } catch(e){}
            try { if (actx) actx.close(); } catch(e){}
        };
    }, [showModal]);

    const handleDismiss = () => {
        const now = new Date();
        const dismissKey = `alarm_dismissed_${now.toISOString().split('T')[0]}_${alarmData.outgoingShift}`;
        localStorage.setItem(dismissKey, 'true');
        setShowModal(false);
    };

    if (!showModal) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(220,38,38,0.95)', // Solid Red
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontFamily: "'Inter', system-ui, sans-serif"
        }}>
            <style>{`
                @keyframes pulse-bell {
                    0% { transform: scale(1) rotate(0deg); }
                    25% { transform: scale(1.2) rotate(-15deg); }
                    50% { transform: scale(1.2) rotate(15deg); }
                    75% { transform: scale(1.2) rotate(-15deg); }
                    100% { transform: scale(1) rotate(0deg); }
                }
            `}</style>
            <div style={{
                fontSize: 100, marginBottom: 20,
                animation: 'pulse-bell 1s infinite ease-in-out'
            }}>
                🔔
            </div>
            
            <h1 style={{ fontSize: 40, fontWeight: 900, textAlign: 'center', margin: '0 20px 10px', textTransform: 'uppercase' }}>
                ¡ATENCIÓN {alarmData?.role === 'LIDER' ? 'LÍDER' : 'OPERARIO'} DE {alarmData?.area}!
            </h1>
            <p style={{ fontSize: 24, fontWeight: 700, margin: '0 20px 40px', textAlign: 'center', maxWidth: 800, lineHeight: 1.5 }}>
                Quedan 20 minutos para que acabe el turno <strong style={{color:'#fde047'}}>{alarmData?.outgoingShift}</strong>.<br/>
                Es momento de organizar el área, verificar la máquina y preparar la entrega de turno.
            </p>

            <button onClick={handleDismiss} style={{
                fontSize: 24, fontWeight: 800, padding: '24px 48px',
                background: '#fff', color: '#dc2626', border: 'none',
                borderRadius: 20, cursor: 'pointer',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: 1
            }} onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
               onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}>
                ✅ Entendido, voy a entregar
            </button>
        </div>
    );
}
