import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

// ── Area labels & icons ──────────────────────────────────────────────────────
const AREA_LABELS = {
    PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque'
};
const AREA_ICONS = { PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦' };
const SHIFT_LABELS = {
    MANANA: '🌅 Mañana', TARDE: '☀️ Tarde', NOCHE: '🌙 Noche'
};

export default function ShiftHandoffForm({ onSuccess }) {
    const [checklists, setChecklists] = useState({});
    const [outgoingShift, setOutgoingShift] = useState('');
    const [selectedArea, setSelectedArea] = useState('');
    const [formState, setFormState] = useState({});
    const [pin, setPin] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [msg, setMsg] = useState('');

    // ── Load checklists ──────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/shifts/handoff/checklists');
                setChecklists(res.data.checklists || {});
                setOutgoingShift(res.data.outgoingShift || '');
            } catch (e) {
                console.error(e);
            }
        })();
    }, []);

    // ── Build form state when area changes ───────────────────────────────────
    useEffect(() => {
        if (!selectedArea || !checklists[selectedArea]) return;
        const items = checklists[selectedArea];
        const initial = {};
        items.forEach((item, i) => {
            initial[i] = item.type === 'boolean' ? false : '';
        });
        setFormState(initial);
    }, [selectedArea, checklists]);

    const currentChecklist = checklists[selectedArea] || [];

    // ── Submit ───────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!selectedArea) return setMsg('❌ Selecciona tu área');
        if (!pin || pin.length !== 4) return setMsg('❌ Ingresa tu PIN de 4 dígitos');

        // Build checklist payload
        const checklist = currentChecklist.map((item, i) => ({
            label: item.label,
            type: item.type,
            value: formState[i] ?? (item.type === 'boolean' ? false : '')
        }));

        // Extract text fields for notes/pending/lots
        const textItems = checklist.filter(c => c.type === 'text');
        const notes = textItems.find(c => c.label.toLowerCase().includes('novedades'))?.value || '';
        const pendingTasks = textItems.find(c => c.label.toLowerCase().includes('pendientes'))?.value || '';
        const lotsProduced = textItems.find(c => c.label.toLowerCase().includes('lotes'))?.value || '';

        setSubmitting(true);
        setMsg('');
        try {
            const res = await api.post('/shifts/handoff', {
                pin, checklist, notes, pendingTasks, lotsProduced
            });
            setMsg(`✅ Entrega registrada correctamente — ${res.data.operatorName}`);
            setPin('');
            if (onSuccess) onSuccess();
        } catch (e) {
            setMsg(`❌ ${e.response?.data?.error || e.message}`);
        }
        setSubmitting(false);
    };

    return (
        <div style={cardStyle}>
            <h3 style={titleStyle}>
                📋 Entregar Turno — {SHIFT_LABELS[outgoingShift] || outgoingShift}
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px', fontWeight: 500 }}>
                Completa el checklist de tu área y confirma con tu PIN
            </p>

            {/* Area selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {Object.keys(AREA_LABELS).map(area => (
                    <button
                        key={area}
                        onClick={() => setSelectedArea(area)}
                        style={{
                            flex: 1, padding: '14px 12px', borderRadius: 12, cursor: 'pointer',
                            background: selectedArea === area
                                ? 'linear-gradient(135deg, #1e3a5f, #2563eb)' : '#f8fafc',
                            color: selectedArea === area ? '#fff' : '#334155',
                            border: selectedArea === area ? 'none' : '2px solid #e2e8f0',
                            fontWeight: 700, fontSize: 15, transition: 'all 0.2s',
                            boxShadow: selectedArea === area ? '0 4px 12px rgba(37,99,235,0.3)' : 'none'
                        }}
                    >
                        {AREA_ICONS[area]} {AREA_LABELS[area]}
                    </button>
                ))}
            </div>

            {selectedArea && currentChecklist.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {currentChecklist.map((item, i) => (
                        <div key={i}>
                            {item.type === 'boolean' ? (
                                <button
                                    onClick={() => setFormState(prev => ({ ...prev, [i]: !prev[i] }))}
                                    style={{
                                        width: '100%', padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        background: formState[i] ? '#f0fdf4' : '#fef2f2',
                                        border: `2px solid ${formState[i] ? '#86efac' : '#fecaca'}`,
                                        fontWeight: 600, fontSize: 15, color: '#1e293b',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <span style={{
                                        width: 32, height: 32, borderRadius: 8,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 18,
                                        background: formState[i]
                                            ? 'linear-gradient(135deg, #16a34a, #22c55e)'
                                            : 'linear-gradient(135deg, #ef4444, #f87171)',
                                        color: '#fff'
                                    }}>
                                        {formState[i] ? '✓' : '✗'}
                                    </span>
                                    {item.label}
                                </button>
                            ) : (
                                <div>
                                    <label style={{
                                        fontSize: 13, fontWeight: 700, color: '#475569',
                                        marginBottom: 4, display: 'block'
                                    }}>
                                        📝 {item.label}
                                    </label>
                                    <textarea
                                        value={formState[i] || ''}
                                        onChange={e => setFormState(prev => ({ ...prev, [i]: e.target.value }))}
                                        placeholder={`Escribe aquí...`}
                                        style={{
                                            width: '100%', padding: '12px 14px', borderRadius: 10,
                                            border: '2px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
                                            resize: 'vertical', minHeight: 60, outline: 'none',
                                            transition: 'border 0.2s', boxSizing: 'border-box'
                                        }}
                                        onFocus={e => e.target.style.borderColor = '#2563eb'}
                                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                </div>
                            )}
                        </div>
                    ))}

                    {/* PIN input */}
                    <div style={{
                        marginTop: 8, padding: '16px', background: '#f8fafc',
                        borderRadius: 14, border: '2px solid #e2e8f0'
                    }}>
                        <label style={{
                            fontSize: 14, fontWeight: 700, color: '#334155',
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10
                        }}>
                            🔐 Ingresa tu PIN para confirmar
                        </label>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                            {[0, 1, 2, 3].map(idx => (
                                <input
                                    key={idx}
                                    type="password"
                                    maxLength={1}
                                    value={pin[idx] || ''}
                                    onChange={e => {
                                        const val = e.target.value.replace(/\D/g, '');
                                        const newPin = pin.split('');
                                        newPin[idx] = val;
                                        setPin(newPin.join(''));
                                        // Auto-focus next
                                        if (val && idx < 3) {
                                            const nextField = e.target.parentElement?.children[idx + 1];
                                            if (nextField) nextField.focus();
                                        }
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Backspace' && !pin[idx] && idx > 0) {
                                            const prevField = e.target.parentElement?.children[idx - 1];
                                            if (prevField) prevField.focus();
                                        }
                                    }}
                                    style={{
                                        width: 56, height: 56, textAlign: 'center', fontSize: 24,
                                        fontWeight: 800, borderRadius: 12,
                                        border: '2px solid #cbd5e1',
                                        outline: 'none', background: '#fff',
                                        transition: 'border 0.2s'
                                    }}
                                    onFocus={e => e.target.style.borderColor = '#2563eb'}
                                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Submit */}
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        style={{
                            width: '100%', padding: '16px 20px', borderRadius: 14, border: 'none',
                            background: submitting
                                ? '#94a3b8'
                                : 'linear-gradient(135deg, #16a34a, #22c55e)',
                            color: '#fff', fontWeight: 800, fontSize: 17, cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(22,163,74,0.3)',
                            transition: 'all 0.2s', marginTop: 4
                        }}
                    >
                        {submitting ? '⏳ Enviando…' : '✅ CONFIRMAR ENTREGA DE TURNO'}
                    </button>

                    {msg && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14,
                            background: msg.includes('❌') ? '#fef2f2' : '#f0fdf4',
                            color: msg.includes('❌') ? '#dc2626' : '#16a34a',
                            border: `1px solid ${msg.includes('❌') ? '#fecaca' : '#bbf7d0'}`,
                            textAlign: 'center'
                        }}>{msg}</div>
                    )}
                </div>
            )}
        </div>
    );
}

const cardStyle = {
    background: '#fff', borderRadius: 16, padding: '24px', border: '1px solid #e2e8f0',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)'
};

const titleStyle = {
    fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 4px',
    display: 'flex', alignItems: 'center', gap: 10
};
