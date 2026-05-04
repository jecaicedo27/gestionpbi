import { useState, useEffect, useRef, useCallback } from 'react';

const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const FACE_MODELS_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
const FACE_MODELS_FALLBACK = 'https://raw.githubusercontent.com/nicolo-ribaudo/face-api.js-models/refs/heads/master/';

// ── Helper to dynamically inject face-api.js script ──────────────────────────
function loadFaceApiScript() {
    return new Promise((resolve, reject) => {
        if (window.faceapi) return resolve(window.faceapi);
        const existing = document.getElementById('face-api-script');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.faceapi));
            return;
        }
        const s = document.createElement('script');
        s.id = 'face-api-script';
        s.src = FACE_API_URL;
        s.onload = () => resolve(window.faceapi);
        s.onerror = (e) => reject(new Error('Error cargando face-api.js'));
        document.head.appendChild(s);
    });
}

async function loadFaceApiModels() {
    const f = await loadFaceApiScript();
    try {
        await Promise.all([
            f.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_CDN),
            f.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODELS_CDN),
            f.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_CDN),
        ]);
    } catch {
        await Promise.all([
            f.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_FALLBACK),
            f.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODELS_FALLBACK),
            f.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_FALLBACK),
        ]);
    }
    return f;
}

export default function MarcajePage() {
    const [tab, setTab] = useState('PIN'); // 'PIN' | 'CEDULA' | 'FACE'
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    const fmtTime = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fmtDate = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                <div style={styles.header}>
                    <div style={styles.time}>{fmtTime}</div>
                    <div style={styles.date}>{fmtDate}</div>
                </div>

                <div style={styles.tabs}>
                    <TabBtn active={tab === 'PIN'} onClick={() => setTab('PIN')} icon="🔢" label="PIN" />
                    <TabBtn active={tab === 'CEDULA'} onClick={() => setTab('CEDULA')} icon="🆔" label="Cédula" />
                    <TabBtn active={tab === 'FACE'} onClick={() => setTab('FACE')} icon="📷" label="Cara" />
                </div>

                {tab === 'PIN' && <PinPanel />}
                {tab === 'CEDULA' && <CedulaPanel />}
                {tab === 'FACE' && <FacePanel />}

                <div style={styles.footer}>
                    Marcaje de Asistencia · Popping Boba Internacional
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon, label }) {
    return (
        <button onClick={onClick} style={{
            flex: 1, padding: '12px 8px', border: 'none', cursor: 'pointer',
            background: active ? '#2563eb' : '#e5e7eb',
            color: active ? 'white' : '#374151',
            fontWeight: 700, fontSize: 14, borderRadius: 0
        }}>
            <div style={{ fontSize: 22 }}>{icon}</div>
            <div>{label}</div>
        </button>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIN Panel
function PinPanel() {
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const append = (d) => { if (!busy && pin.length < 4) setPin(p => p + d); };
    const clear = () => setPin('');
    const back = () => setPin(p => p.slice(0, -1));

    const submit = async (action) => {
        if (pin.length !== 4) { setFeedback({ ok: false, text: 'PIN incompleto' }); return; }
        setBusy(true); setFeedback(null);
        try {
            const res = await fetch('/api/attendance/pin-mark', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, action })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');
            const hr = new Date(data.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            setFeedback({ ok: true, text: `${action === 'IN' ? 'ENTRADA' : 'SALIDA'} — ${data.employeeName} (${data.area}) — ${hr}` });
            setPin('');
        } catch (err) { setFeedback({ ok: false, text: err.message }); }
        finally { setBusy(false); setTimeout(() => setFeedback(null), 6000); }
    };

    return (
        <div style={styles.panel}>
            <div style={styles.pinBox}>
                <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginBottom: 8 }}>INGRESA TU PIN</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{
                            width: 44, height: 52, borderRadius: 12, background: 'white',
                            border: pin.length > i ? '3px solid #2563eb' : '2px solid #d1d5db',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 28, fontWeight: 800, color: '#1e1b4b'
                        }}>{pin[i] ? '●' : ''}</div>
                    ))}
                </div>
            </div>
            <div style={styles.keypad}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                    <button key={d} onClick={() => append(String(d))} disabled={busy} style={styles.keyDigit}>{d}</button>
                ))}
                <button onClick={clear} disabled={busy} style={styles.keyClear}>Limpiar</button>
                <button onClick={() => append('0')} disabled={busy} style={styles.keyDigit}>0</button>
                <button onClick={back} disabled={busy} style={styles.keyBack}>← Borrar</button>
            </div>
            <ActionButtons onIn={() => submit('IN')} onOut={() => submit('OUT')} ready={pin.length === 4 && !busy} />
            {feedback && <Feedback msg={feedback} />}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cédula Panel
function CedulaPanel() {
    const [cedula, setCedula] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const append = (d) => { if (!busy && cedula.length < 12) setCedula(p => p + d); };
    const clear = () => setCedula('');
    const back = () => setCedula(p => p.slice(0, -1));

    const submit = async (action) => {
        if (cedula.length < 6) { setFeedback({ ok: false, text: 'Cédula incompleta (mínimo 6 dígitos)' }); return; }
        setBusy(true); setFeedback(null);
        try {
            const res = await fetch('/api/attendance/cedula-mark', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cedula, action })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');
            const hr = new Date(data.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            setFeedback({ ok: true, text: `${action === 'IN' ? 'ENTRADA' : 'SALIDA'} — ${data.employeeName} (${data.area}) — ${hr}` });
            setCedula('');
        } catch (err) { setFeedback({ ok: false, text: err.message }); }
        finally { setBusy(false); setTimeout(() => setFeedback(null), 6000); }
    };

    return (
        <div style={styles.panel}>
            <div style={styles.pinBox}>
                <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginBottom: 8 }}>NÚMERO DE CÉDULA</div>
                <div style={{
                    display: 'inline-block', minWidth: 220, padding: '10px 16px', borderRadius: 10,
                    background: 'white', border: '2px solid #d1d5db',
                    fontSize: 26, fontWeight: 800, color: '#1e1b4b', letterSpacing: 2,
                    minHeight: 32
                }}>{cedula || ' '}</div>
            </div>
            <div style={styles.keypad}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                    <button key={d} onClick={() => append(String(d))} disabled={busy} style={styles.keyDigit}>{d}</button>
                ))}
                <button onClick={clear} disabled={busy} style={styles.keyClear}>Limpiar</button>
                <button onClick={() => append('0')} disabled={busy} style={styles.keyDigit}>0</button>
                <button onClick={back} disabled={busy} style={styles.keyBack}>← Borrar</button>
            </div>
            <ActionButtons onIn={() => submit('IN')} onOut={() => submit('OUT')} ready={cedula.length >= 6 && !busy} />
            {feedback && <Feedback msg={feedback} />}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Face Panel — uses face-api.js to detect & extract descriptor in browser,
// then sends descriptor to backend for matching.
function FacePanel() {
    const videoRef = useRef(null);
    const [modelsReady, setModelsReady] = useState(false);
    const [streamReady, setStreamReady] = useState(false);
    const [detectedDescriptor, setDetectedDescriptor] = useState(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [statusMsg, setStatusMsg] = useState('Cargando modelos...');

    // Load face-api models once
    useEffect(() => {
        loadFaceApiModels()
            .then(() => { setModelsReady(true); setStatusMsg('Activando cámara...'); })
            .catch(err => setStatusMsg(`Error: ${err.message}`));
    }, []);

    // Start camera once models are ready
    useEffect(() => {
        if (!modelsReady) return;
        let mediaStream = null;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then(s => {
                mediaStream = s;
                if (videoRef.current) videoRef.current.srcObject = s;
                setStreamReady(true);
                setStatusMsg('Mira a la cámara...');
            })
            .catch(err => setStatusMsg(`Cámara: ${err.message}. Permite el acceso.`));
        return () => {
            if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
        };
    }, [modelsReady]);

    // Detect face every 800ms
    useEffect(() => {
        if (!streamReady) return;
        let cancelled = false;
        const interval = setInterval(async () => {
            if (cancelled || !window.faceapi || !videoRef.current || busy) return;
            try {
                const det = await window.faceapi
                    .detectSingleFace(videoRef.current, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
                    .withFaceLandmarks(true)
                    .withFaceDescriptor();
                if (cancelled) return;
                if (det && det.descriptor) {
                    setDetectedDescriptor(Array.from(det.descriptor));
                    setStatusMsg('Cara detectada — toca ENTRADA o SALIDA');
                } else {
                    setDetectedDescriptor(null);
                    setStatusMsg('Buscando cara...');
                }
            } catch (e) { /* silent */ }
        }, 800);
        return () => { cancelled = true; clearInterval(interval); };
    }, [streamReady, busy]);

    const submit = async (action) => {
        if (!detectedDescriptor) { setFeedback({ ok: false, text: 'No se detecta cara' }); return; }
        setBusy(true); setFeedback(null);
        try {
            const res = await fetch('/api/attendance/face-mark', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ descriptor: detectedDescriptor, action })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');
            const hr = new Date(data.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            setFeedback({ ok: true, text: `${action === 'IN' ? 'ENTRADA' : 'SALIDA'} — ${data.employeeName} (${data.area}) — ${hr}` });
        } catch (err) { setFeedback({ ok: false, text: err.message }); }
        finally { setBusy(false); setTimeout(() => setFeedback(null), 6000); }
    };

    return (
        <div style={styles.panel}>
            <div style={{
                position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000',
                borderRadius: 12, overflow: 'hidden', marginBottom: 12,
                border: detectedDescriptor ? '3px solid #16a34a' : '2px solid #d1d5db'
            }}>
                <video ref={videoRef} autoPlay playsInline muted style={{
                    width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'
                }} />
                <div style={{
                    position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center',
                    color: 'white', fontSize: 12, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,.7)'
                }}>{statusMsg}</div>
            </div>
            <ActionButtons
                onIn={() => submit('IN')}
                onOut={() => submit('OUT')}
                ready={!!detectedDescriptor && !busy}
            />
            {feedback && <Feedback msg={feedback} />}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
function ActionButtons({ onIn, onOut, ready }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <button onClick={onIn} disabled={!ready} style={{
                padding: '18px 0', fontSize: 17, fontWeight: 800, border: 'none', borderRadius: 12,
                background: ready ? '#16a34a' : '#9ca3af', color: 'white',
                cursor: ready ? 'pointer' : 'not-allowed'
            }}>✓ ENTRADA</button>
            <button onClick={onOut} disabled={!ready} style={{
                padding: '18px 0', fontSize: 17, fontWeight: 800, border: 'none', borderRadius: 12,
                background: ready ? '#dc2626' : '#9ca3af', color: 'white',
                cursor: ready ? 'pointer' : 'not-allowed'
            }}>✕ SALIDA</button>
        </div>
    );
}

function Feedback({ msg }) {
    return (
        <div style={{
            marginTop: 12, padding: 12, borderRadius: 10, textAlign: 'center', fontWeight: 700,
            background: msg.ok ? '#dcfce7' : '#fee2e2',
            color: msg.ok ? '#166534' : '#991b1b'
        }}>{msg.text}</div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = {
    page: {
        minHeight: '100vh', background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: 'system-ui, sans-serif'
    },
    card: {
        background: 'white', borderRadius: 24, padding: 0, width: '100%', maxWidth: 480,
        boxShadow: '0 25px 50px rgba(0,0,0,0.3)', overflow: 'hidden'
    },
    header: {
        textAlign: 'center', padding: '24px 16px 12px'
    },
    time: { fontSize: 44, fontWeight: 800, color: '#1e1b4b', letterSpacing: -1 },
    date: { fontSize: 13, color: '#6b7280', textTransform: 'capitalize' },
    tabs: { display: 'flex', borderBottom: '1px solid #e5e7eb' },
    panel: { padding: 16 },
    pinBox: {
        background: '#f3f4f6', borderRadius: 14, padding: 14, marginBottom: 12, textAlign: 'center'
    },
    keypad: {
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8
    },
    keyDigit: {
        padding: '16px 0', fontSize: 24, fontWeight: 700,
        background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#1e1b4b'
    },
    keyClear: {
        padding: '16px 0', fontSize: 14, fontWeight: 700,
        background: '#fef3c7', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#92400e'
    },
    keyBack: {
        padding: '16px 0', fontSize: 14, fontWeight: 700,
        background: '#fee2e2', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#991b1b'
    },
    footer: {
        padding: '12px 16px 16px', textAlign: 'center', fontSize: 11, color: '#9ca3af'
    }
};
