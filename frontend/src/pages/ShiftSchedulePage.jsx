import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

const SHIFTS = {
    MANANA: { label: 'Mañana (M)', time: '6:00–14:00', weekDesc: 'Lun–Vie 6–14 / Sáb 6–12', color: '#48bb78', bg: 'rgba(72,187,120,0.1)' },
    TARDE:  { label: 'Tarde (T)',  time: '14:00–22:00', weekDesc: 'Lun–Vie 14–22 / Sáb 14–18', color: '#ed8936', bg: 'rgba(237,137,54,0.1)' },
    NOCHE:  { label: 'Noche (N)', time: '22:00–6:00',  weekDesc: 'Dom 22h → Vie/Sáb 6AM', color: '#667eea', bg: 'rgba(102,126,234,0.1)' },
    DIURNO: { label: 'Diurno (D)', time: '8:00–17:00', weekDesc: 'Lun–Sáb 8–17', color: '#a0aec0', bg: 'rgba(160,174,192,0.1)' },
};

const AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE', 'LOGISTICA', 'ASEO'];
const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque', LOGISTICA: 'Logística', ASEO: 'Servicios Generales' };
const ABSENCE_REASONS = ['ENFERMEDAD', 'PERMISO', 'DILIGENCIA', 'INCAPACIDAD'];

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDate(d) {
    return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatWeekRange(start) {
    // Production week: Sunday (night shift starts) → Saturday (afternoon shift ends)
    // Parse at noon to avoid UTC-midnight timezone shifts
    const monday = new Date(start + 'T12:00:00');
    const sunday = new Date(monday); sunday.setDate(monday.getDate() - 1); // Sunday before Monday
    const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5); // Saturday after Monday
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    const sunStr = sunday.toLocaleDateString('es-CO', opts);
    const satStr = saturday.toLocaleDateString('es-CO', { ...opts, year: 'numeric' });
    return `${sunStr.charAt(0).toUpperCase() + sunStr.slice(1)} al ${satStr.charAt(0).toUpperCase() + satStr.slice(1)}`;
}

function timeAgo(date) {
    if (!date) return 'Nunca';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `hace ${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `hace ${days}d`;
}

export default function ShiftSchedulePage() {
    const [tab, setTab] = useState('schedule');
    const [weekStart, setWeekStart] = useState(getMonday(new Date()).toISOString().split('T')[0]);
    const [week, setWeek] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [absences, setAbsences] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const tableRef = useRef(null);

    // Absence form
    const [absForm, setAbsForm] = useState({ employeeId: '', date: new Date().toISOString().split('T')[0], reason: 'PERMISO', notes: '' });

    // Employee form
    const [empForm, setEmpForm] = useState({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' });
    const [editingEmp, setEditingEmp] = useState(null);

    const fetchWeek = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/shifts/weeks', { params: { weekStart } });
            setWeek(res.data.week);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, [weekStart]);

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await api.get('/shifts/employees');
            setEmployees(res.data);
        } catch (e) { console.error(e); }
    }, []);

    const fetchAbsences = useCallback(async () => {
        try {
            const month = weekStart.substring(0, 7);
            const res = await api.get('/shifts/absences', { params: { month } });
            setAbsences(res.data);
        } catch (e) { console.error(e); }
    }, [weekStart]);

    useEffect(() => { fetchWeek(); fetchEmployees(); fetchAbsences(); }, [fetchWeek, fetchEmployees, fetchAbsences]);

    const changeWeek = (offset) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + (offset * 7));
        setWeekStart(d.toISOString().split('T')[0]);
    };

    // ── Save schedule
    const handleSave = async () => {
        if (!week) return;
        setSaving(true);
        try {
            await api.post('/shifts/weeks/save', {
                weekStart,
                assignments: week.assignments.map(a => ({
                    employeeId: a.employeeId || a.employee?.id,
                    area: a.area,
                    shift: a.shift
                })),
                note: week.note
            });
            setMsg('✅ Cuadro guardado');
            fetchWeek();
        } catch (e) { setMsg('❌ Error: ' + e.message); }
        setSaving(false);
        setTimeout(() => setMsg(''), 3000);
    };

    // ── Publish
    const handlePublish = async () => {
        if (!week) return;
        await handleSave();
        try {
            await api.post(`/shifts/weeks/${week.id}/publish`);
            setMsg('📢 Cuadro publicado');
            fetchWeek();
        } catch (e) { setMsg('❌ Error: ' + e.message); }
        setTimeout(() => setMsg(''), 3000);
    };

    // ── Auto-rotate next week
    const handleRotate = async () => {
        try {
            await api.post('/shifts/weeks/generate-next', { currentWeekStart: weekStart });
            const nextMonday = new Date(weekStart);
            nextMonday.setDate(nextMonday.getDate() + 7);
            setWeekStart(nextMonday.toISOString().split('T')[0]);
            setMsg('🔄 Semana siguiente generada con rotación');
        } catch (e) { setMsg('❌ ' + (e.response?.data?.error || e.message)); }
        setTimeout(() => setMsg(''), 3000);
    };

    // ── Change employee shift (dropdown)
    const changeShift = (assignmentIdx, newShift) => {
        setWeek(prev => {
            const updated = { ...prev, assignments: [...prev.assignments] };
            updated.assignments[assignmentIdx] = { ...updated.assignments[assignmentIdx], shift: newShift };
            return updated;
        });
    };

    // ── Generate image for WhatsApp
    const handleDownloadImage = async () => {
        if (!tableRef.current) return;
        try {
            const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
            const canvas = await html2canvas(tableRef.current, { backgroundColor: '#1a202c', scale: 2 });
            const link = document.createElement('a');
            link.download = `cuadro_turnos_${weekStart}.png`;
            link.href = canvas.toDataURL();
            link.click();
            setMsg('📷 Imagen descargada — compártela por WhatsApp');
        } catch (e) {
            setMsg('❌ Error generando imagen');
            console.error(e);
        }
        setTimeout(() => setMsg(''), 4000);
    };

    // ── Send via WhatsApp (opens chat with image description)
    const handleWhatsApp = (phone) => {
        const text = encodeURIComponent(`📋 *Cuadro de Turnos — Semana ${formatWeekRange(weekStart)}*\n\nRevisa tu turno asignado en el ERP: https://gestionpbi.lat/shift-schedule`);
        window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
    };

    // ── Register absence
    const handleAbsence = async (e) => {
        e.preventDefault();
        try {
            await api.post('/shifts/absences', absForm);
            setMsg('✅ Ausencia registrada');
            setAbsForm({ employeeId: '', date: new Date().toISOString().split('T')[0], reason: 'PERMISO', notes: '' });
            fetchAbsences();
        } catch (err) { setMsg('❌ Error: ' + err.message); }
        setTimeout(() => setMsg(''), 3000);
    };

    // ── Create/update employee
    const handleEmpSave = async (e) => {
        e.preventDefault();
        try {
            const data = { ...empForm, groupNumber: empForm.groupNumber ? parseInt(empForm.groupNumber) : null };
            if (editingEmp) {
                await api.patch(`/shifts/employees/${editingEmp}`, data);
                setMsg('✅ Empleado actualizado');
            } else {
                await api.post('/shifts/employees', data);
                setMsg('✅ Empleado creado');
            }
            setEmpForm({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' });
            setEditingEmp(null);
            fetchEmployees();
        } catch (err) { setMsg('❌ Error: ' + err.message); }
        setTimeout(() => setMsg(''), 3000);
    };

    // ── Organize assignments by area and shift
    const getGrid = () => {
        if (!week?.assignments) return {};
        const grid = {};
        for (const area of AREAS) {
            grid[area] = { MANANA: [], TARDE: [], NOCHE: [], DIURNO: [] };
        }
        week.assignments.forEach((a, idx) => {
            if (grid[a.area]?.[a.shift]) {
                grid[a.area][a.shift].push({ ...a, idx });
            }
        });
        return grid;
    };

    const grid = getGrid();

    return (
        <div style={{ padding: '20px', maxWidth: 1400, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    📋 Cuadro de Turnos
                </h1>
                {msg && <div style={{ padding: '8px 16px', background: msg.includes('❌') ? '#fed7d7' : '#c6f6d5', color: msg.includes('❌') ? '#c53030' : '#276749', borderRadius: 8, fontWeight: 600, fontSize: 14 }}>{msg}</div>}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
                {[['schedule', '📅 Cuadro Semanal'], ['absences', '🤒 Ausencias'], ['employees', '👥 Empleados']].map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        padding: '10px 20px', border: 'none', borderBottom: tab === key ? '3px solid #4299e1' : '3px solid transparent',
                        background: 'transparent', fontWeight: tab === key ? 700 : 400, fontSize: 15,
                        color: tab === key ? '#2b6cb0' : '#718096', cursor: 'pointer', transition: 'all 0.2s'
                    }}>{label}</button>
                ))}
            </div>

            {/* ═══════ TAB 1: SCHEDULE ═══════ */}
            {tab === 'schedule' && (
                <div>
                    {/* Week navigation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                        <button onClick={() => changeWeek(-1)} style={navBtn}>← Anterior</button>
                        <span style={{ fontSize: 16, fontWeight: 600, minWidth: 250, textAlign: 'center' }}>
                            Semana del {formatWeekRange(weekStart)}
                        </span>
                        <button onClick={() => changeWeek(1)} style={navBtn}>Siguiente →</button>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={handleSave} disabled={saving} style={{ ...actionBtn, background: '#48bb78' }}>{saving ? '⏳...' : '💾 Guardar'}</button>
                            <button onClick={handlePublish} style={{ ...actionBtn, background: '#4299e1' }}>📢 Publicar</button>
                            <button onClick={handleRotate} style={{ ...actionBtn, background: '#ed8936' }}>🔄 Generar Siguiente</button>
                            <button onClick={handleDownloadImage} style={{ ...actionBtn, background: '#9f7aea' }}>📷 Descargar Imagen</button>
                        </div>
                    </div>

                    {week?.status === 'PUBLISHED' && (
                        <div style={{ padding: '8px 16px', background: '#ebf8ff', color: '#2b6cb0', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                            ✅ Publicado el {formatDate(week.publishedAt)}
                        </div>
                    )}

                    {loading ? <p>Cargando...</p> : (
                        <div ref={tableRef} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                            {/* Title bar */}
                            <div style={{ background: '#2b6cb0', color: '#fff', padding: '12px 16px', textAlign: 'center', fontWeight: 700, fontSize: 16 }}>
                                Cuadro semana del {formatWeekRange(weekStart)}
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#edf2f7' }}>
                                        <th style={th}>Área</th>
                                        {Object.entries(SHIFTS).map(([key, s]) => (
                                            <th key={key} style={{ ...th, background: s.bg, borderBottom: `3px solid ${s.color}` }}>
                                                <div style={{ fontWeight: 700, color: s.color }}>{s.label}</div>
                                                <div style={{ fontSize: 10, color: '#718096', lineHeight: 1.3 }}>{s.weekDesc}</div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {AREAS.map(area => {
                                        const areaShifts = grid[area] || {};
                                        const showShifts = area === 'LOGISTICA' || area === 'ASEO' ? ['DIURNO'] : ['MANANA', 'TARDE', 'NOCHE'];
                                        return (
                                            <tr key={area} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                <td style={{ ...td, fontWeight: 700, background: '#f7fafc', minWidth: 110 }}>
                                                    {AREA_LABELS[area]}
                                                </td>
                                                {Object.keys(SHIFTS).map(shiftKey => {
                                                    const members = areaShifts[shiftKey] || [];
                                                    const isApplicable = showShifts.includes(shiftKey);
                                                    return (
                                                        <td key={shiftKey} style={{ ...td, background: isApplicable ? SHIFTS[shiftKey].bg : '#f7fafc', minWidth: 160, verticalAlign: 'top' }}>
                                                            {isApplicable ? (
                                                                members.length > 0 ? members.map((m, i) => {
                                                                    const isLeader = m.employee?.role === 'LIDER';
                                                                    const userName = m.employee?.user?.name;
                                                                    const lastLogin = m.employee?.user?.lastLogin;
                                                                    return (
                                                                        <div key={m.id || i} style={{
                                                                            padding: '5px 8px', margin: '3px 0', borderRadius: 6,
                                                                            background: isLeader ? SHIFTS[shiftKey].color : '#fff',
                                                                            color: isLeader ? '#fff' : '#2d3748',
                                                                            border: `1px solid ${SHIFTS[shiftKey].color}40`,
                                                                            fontSize: 12, fontWeight: isLeader ? 700 : 400,
                                                                        }}>
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                <span>{isLeader ? '👑 ' : ''}{m.employee?.name || m.employeeId}</span>
                                                                                <select value={m.shift} onChange={e => changeShift(m.idx, e.target.value)}
                                                                                    style={{ fontSize: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
                                                                                    {showShifts.map(s => <option key={s} value={s}>{SHIFTS[s]?.label}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            {lastLogin && (
                                                                                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                                                                                    🟢 Último login: {timeAgo(lastLogin)}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                }) : <span style={{ color: '#cbd5e0', fontSize: 11 }}>— vacío —</span>
                                                            ) : <span style={{ color: '#e2e8f0' }}>—</span>}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Schedule info footer */}
                            <div style={{ padding: '10px 16px', background: '#fffff0', fontSize: 12, color: '#744210', borderTop: '1px solid #fefcbf' }}>
                                <div style={{ marginBottom: 4 }}><strong>📌 Horarios semanales:</strong></div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 4 }}>
                                    <span>🟢 <strong>Mañana:</strong> Lun–Vie 6:00–14:00 | Sáb 6:00–12:00</span>
                                    <span>🟠 <strong>Tarde:</strong> Lun–Vie 14:00–22:00 | Sáb 14:00–18:00</span>
                                    <span>🔵 <strong>Noche:</strong> Dom 22:00 → Vie amanecer Sáb 6:00</span>
                                    <span>⚪ <strong>Diurno:</strong> Lun–Sáb 8:00–17:00</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════ TAB 2: ABSENCES ═══════ */}
            {tab === 'absences' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div style={card}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Registrar Ausencia</h3>
                        <form onSubmit={handleAbsence} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <select value={absForm.employeeId} onChange={e => setAbsForm({ ...absForm, employeeId: e.target.value })} required style={input}>
                                <option value="">Seleccionar empleado...</option>
                                {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({AREA_LABELS[e.area]})</option>)}
                            </select>
                            <input type="date" value={absForm.date} onChange={e => setAbsForm({ ...absForm, date: e.target.value })} style={input} />
                            <select value={absForm.reason} onChange={e => setAbsForm({ ...absForm, reason: e.target.value })} style={input}>
                                {ABSENCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <input placeholder="Notas (opcional)" value={absForm.notes} onChange={e => setAbsForm({ ...absForm, notes: e.target.value })} style={input} />
                            <button type="submit" style={{ ...actionBtn, background: '#e53e3e' }}>🤒 Registrar Ausencia</button>
                        </form>
                    </div>
                    <div style={card}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Historial de Ausencias</h3>
                        {absences.length === 0 ? <p style={{ color: '#a0aec0' }}>Sin ausencias registradas este mes</p> : (
                            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                                {absences.map(a => (
                                    <div key={a.id} style={{ padding: '10px 12px', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <strong>{a.employee?.name}</strong>
                                            <div style={{ fontSize: 12, color: '#718096' }}>{formatDate(a.date)} — {a.reason}</div>
                                            {a.notes && <div style={{ fontSize: 11, color: '#a0aec0' }}>{a.notes}</div>}
                                        </div>
                                        <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                                            background: a.reason === 'ENFERMEDAD' ? '#fed7d7' : a.reason === 'INCAPACIDAD' ? '#feebc8' : '#e9d8fd',
                                            color: a.reason === 'ENFERMEDAD' ? '#c53030' : a.reason === 'INCAPACIDAD' ? '#c05621' : '#6b46c1'
                                        }}>{a.reason}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══════ TAB 3: EMPLOYEES ═══════ */}
            {tab === 'employees' && (
                <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 20 }}>
                    <div style={card}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{editingEmp ? '✏️ Editar' : '➕ Nuevo'} Empleado</h3>
                        <form onSubmit={handleEmpSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <input placeholder="Nombre completo" value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} required style={input} />
                            <select value={empForm.area} onChange={e => setEmpForm({ ...empForm, area: e.target.value })} style={input}>
                                {AREAS.map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
                            </select>
                            <select value={empForm.role} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} style={input}>
                                <option value="OPERARIO">Operario</option>
                                <option value="LIDER">Líder</option>
                            </select>
                            <input placeholder="# Grupo (1, 2 o 3)" type="number" min="1" max="3" value={empForm.groupNumber} onChange={e => setEmpForm({ ...empForm, groupNumber: e.target.value })} style={input} />
                            <input placeholder="WhatsApp (ej: 573001234567)" value={empForm.whatsapp} onChange={e => setEmpForm({ ...empForm, whatsapp: e.target.value })} style={input} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                <input type="checkbox" checked={empForm.isFixed} onChange={e => setEmpForm({ ...empForm, isFixed: e.target.checked })} />
                                Turno fijo (no rota)
                            </label>
                            <div style={{ fontSize: 12, color: '#718096' }}>
                                Restricciones de turno:
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    {['MANANA', 'TARDE', 'NOCHE'].map(s => (
                                        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                            <input type="checkbox" checked={empForm.restrictions.includes(s)}
                                                onChange={e => {
                                                    const r = e.target.checked ? [...empForm.restrictions, s] : empForm.restrictions.filter(x => x !== s);
                                                    setEmpForm({ ...empForm, restrictions: r });
                                                }} />
                                            {SHIFTS[s]?.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <button type="submit" style={{ ...actionBtn, background: '#4299e1' }}>{editingEmp ? '✏️ Actualizar' : '➕ Crear'}</button>
                            {editingEmp && <button type="button" onClick={() => { setEditingEmp(null); setEmpForm({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' }); }} style={{ ...actionBtn, background: '#a0aec0' }}>Cancelar</button>}
                        </form>
                    </div>
                    <div style={card}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>👥 Empleados ({employees.length})</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#edf2f7' }}>
                                    <th style={th}>Nombre</th><th style={th}>Área</th><th style={th}>Rol</th><th style={th}>Grupo</th>
                                    <th style={th}>Usuario ERP</th><th style={th}>Último Login</th><th style={th}>WhatsApp</th><th style={th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => (
                                    <tr key={emp.id} style={{ borderBottom: '1px solid #edf2f7' }}>
                                        <td style={td}><strong>{emp.name}</strong></td>
                                        <td style={td}>{AREA_LABELS[emp.area]}</td>
                                        <td style={td}>{emp.role === 'LIDER' ? '👑 Líder' : 'Operario'}</td>
                                        <td style={td}>{emp.isFixed ? '🔒 Fijo' : `Grupo ${emp.groupNumber || '—'}`}</td>
                                        <td style={td}>
                                            {emp.user ? (
                                                <span style={{ fontSize: 11 }}>
                                                    <span style={{ color: '#48bb78' }}>●</span> {emp.user.email}
                                                </span>
                                            ) : <span style={{ color: '#cbd5e0', fontSize: 11 }}>No vinculado</span>}
                                        </td>
                                        <td style={td}>
                                            {emp.user?.lastLogin ? (
                                                <span style={{ fontSize: 11, color: '#4a5568' }}>{timeAgo(emp.user.lastLogin)}</span>
                                            ) : <span style={{ color: '#cbd5e0', fontSize: 11 }}>—</span>}
                                        </td>
                                        <td style={td}>
                                            {emp.whatsapp ? (
                                                <button onClick={() => handleWhatsApp(emp.whatsapp)} style={{ border: 'none', background: '#25D366', color: '#fff', padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                                    📱 {emp.whatsapp.slice(-4)}
                                                </button>
                                            ) : <span style={{ color: '#cbd5e0', fontSize: 11 }}>Sin WA</span>}
                                        </td>
                                        <td style={td}>
                                            <button onClick={() => {
                                                setEditingEmp(emp.id);
                                                setEmpForm({ name: emp.name, area: emp.area, role: emp.role, groupNumber: emp.groupNumber || '', isFixed: emp.isFixed, restrictions: emp.restrictions || [], whatsapp: emp.whatsapp || '' });
                                                setTab('employees');
                                            }} style={{ border: 'none', background: '#ebf8ff', color: '#2b6cb0', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Styles
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#4a5568' };
const td = { padding: '8px 12px', verticalAlign: 'top' };
const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 };
const input = { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const navBtn = { padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const actionBtn = { padding: '8px 16px', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
