import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import ShiftHandoffForm from '../components/ShiftHandoffForm';
import ShiftHandoffApproval from '../components/ShiftHandoffApproval';

// ── Shift definitions ────────────────────────────────────────────────────────
const SHIFTS = {
    MANANA: {
        label: 'Mañana', code: 'M', time: '6:00 – 14:00',
        weekDesc: 'Lun–Vie 6:00–14:00  •  Sáb 6:00–12:00',
        color: '#16a34a', bg: '#f0fdf4', gradient: 'linear-gradient(135deg, #16a34a, #22c55e)',
        icon: '🌅'
    },
    TARDE: {
        label: 'Tarde', code: 'T', time: '14:00 – 22:00',
        weekDesc: 'Lun–Vie 14:00–22:00  •  Sáb 12:00–18:00',
        color: '#ea580c', bg: '#fff7ed', gradient: 'linear-gradient(135deg, #ea580c, #f97316)',
        icon: '☀️'
    },
    NOCHE: {
        label: 'Noche', code: 'N', time: '22:00 – 6:00',
        weekDesc: 'Dom 22:00 → Vie amanecer Sáb 6:00',
        color: '#7c3aed', bg: '#faf5ff', gradient: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
        icon: '🌙'
    },
    DIURNO: {
        label: 'Diurno', code: 'D', time: '8:00 – 17:00',
        weekDesc: 'Lun–Sáb 8:00–17:00',
        color: '#6b7280', bg: '#f9fafb', gradient: 'linear-gradient(135deg, #6b7280, #9ca3af)',
        icon: '🏢'
    },
};

const AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE', 'LOGISTICA', 'ASEO'];
const AREA_LABELS = {
    PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque',
    LOGISTICA: 'Logística', ASEO: 'Servicios Generales'
};
const AREA_ICONS = {
    PRODUCCION: '⚙️', SIROPES: '🧪', EMPAQUE: '📦',
    LOGISTICA: '🚛', ASEO: '🧹'
};
const ABSENCE_REASONS = [
    { value: 'PERMISO', label: 'Permiso', icon: '📝', color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff' },
    { value: 'VACACIONES', label: 'Vacaciones', icon: '🏖️', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
    { value: 'ENFERMEDAD', label: 'Enfermedad', icon: '🤒', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    { value: 'INCAPACIDAD', label: 'Incapacidad', icon: '🏥', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
    { value: 'CALAMIDAD', label: 'Calamidad', icon: '⚠️', color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
    { value: 'PATERNIDAD', label: 'Paternidad', icon: '👶', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    { value: 'MATERNIDAD', label: 'Maternidad', icon: '🤰', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
    { value: 'DILIGENCIA', label: 'Diligencia', icon: '📋', color: '#4b5563', bg: '#f9fafb', border: '#d1d5db' },
];

// ── Date helpers ─────────────────────────────────────────────────────────────
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

function formatDateShort(d) {
    return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function formatWeekRange(start) {
    const monday = new Date(start + 'T12:00:00');
    const sunday = new Date(monday); sunday.setDate(monday.getDate() - 1);
    const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    const sunStr = sunday.toLocaleDateString('es-CO', opts);
    const satStr = saturday.toLocaleDateString('es-CO', { ...opts, year: 'numeric' });
    return `${sunStr.charAt(0).toUpperCase() + sunStr.slice(1)} al ${satStr.charAt(0).toUpperCase() + satStr.slice(1)}`;
}

function formatWeekRangeShort(start) {
    const monday = new Date(start + 'T12:00:00');
    const sunday = new Date(monday); sunday.setDate(monday.getDate() - 1);
    const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
    const opts = { day: 'numeric', month: 'short' };
    return `${sunday.toLocaleDateString('es-CO', opts)} – ${saturday.toLocaleDateString('es-CO', { ...opts, year: 'numeric' })}`;
}

function timeAgo(date) {
    if (!date) return null;
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
}

export default function ShiftSchedulePage() {
    const [tab, setTab] = useState('schedule');
    const [weekStart, setWeekStart] = useState(getMonday(new Date()).toISOString().split('T')[0]);
    const [week, setWeek] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [absences, setAbsences] = useState([]);
    const [absentMap, setAbsentMap] = useState({});
    const [partialAbsentMap, setPartialAbsentMap] = useState({});
    const [absentEmployeeIds, setAbsentEmployeeIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const tableRef = useRef(null);
    const [exporting, setExporting] = useState(false);

    // ── Handoff state ────────────────────────────────────────────────────────
    const [handoffData, setHandoffData] = useState({ handoffs: [], operators: [], outgoingShift: '', incomingShift: '' });
    const [handoffLoading, setHandoffLoading] = useState(false);
    const [handoffMsg, setHandoffMsg] = useState('');

    const today = new Date().toISOString().split('T')[0];
    const [absForm, setAbsForm] = useState({ employeeId: '', startDate: today, endDate: today, reason: 'PERMISO', notes: '' });
    const [empForm, setEmpForm] = useState({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' });
    const [editingEmp, setEditingEmp] = useState(null);

    // ── Data fetching ────────────────────────────────────────────────────────
    const fetchWeek = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/shifts/weeks', { params: { weekStart } });
            setWeek(res.data.week);
            setAbsentMap(res.data.absentMap || {});
            setPartialAbsentMap(res.data.partialAbsentMap || {});
            setAbsentEmployeeIds(res.data.absentEmployeeIds || []);
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

    // ── Handoff fetching ──────────────────────────────────────────────────
    const fetchHandoffs = useCallback(async () => {
        setHandoffLoading(true);
        try {
            const res = await api.get('/shifts/handoff/today');
            setHandoffData(res.data);
        } catch (e) { console.error('fetchHandoffs error:', e); }
        setHandoffLoading(false);
    }, []);

    useEffect(() => { fetchWeek(); fetchEmployees(); fetchAbsences(); fetchHandoffs(); }, [fetchWeek, fetchEmployees, fetchAbsences, fetchHandoffs]);

    const handleApproveHandoff = async (handoffId, pin) => {
        try {
            await api.post(`/shifts/handoff/${handoffId}/approve`, { pin });
            setHandoffMsg('✅ Entrega aprobada');
            fetchHandoffs();
        } catch (e) {
            setHandoffMsg(`❌ ${e.response?.data?.error || e.message}`);
        }
        setTimeout(() => setHandoffMsg(''), 3000);
    };

    const handleRejectHandoff = async (handoffId, pin, reason) => {
        try {
            await api.post(`/shifts/handoff/${handoffId}/reject`, { pin, reason });
            setHandoffMsg('❌ Entrega rechazada');
            fetchHandoffs();
        } catch (e) {
            setHandoffMsg(`❌ ${e.response?.data?.error || e.message}`);
        }
        setTimeout(() => setHandoffMsg(''), 3000);
    };

    const changeWeek = (offset) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + (offset * 7));
        setWeekStart(d.toISOString().split('T')[0]);
    };

    // ── Actions ──────────────────────────────────────────────────────────────
    const showMsg = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3500); };

    const handleSave = async () => {
        if (!week) return;
        setSaving(true);
        try {
            await api.post('/shifts/weeks/save', {
                weekStart,
                assignments: week.assignments.map(a => ({
                    employeeId: a.employeeId || a.employee?.id,
                    area: a.employee?.area || a.area,
                    shift: a.shift
                })),
                note: week.note
            });
            showMsg('✅ Cuadro guardado exitosamente');
            fetchWeek();
        } catch (e) { showMsg('❌ Error: ' + e.message); }
        setSaving(false);
    };

    const handlePublish = async () => {
        if (!week) return;
        await handleSave();
        try {
            await api.post(`/shifts/weeks/${week.id}/publish`);
            showMsg('📢 Cuadro publicado y listo para compartir');
            fetchWeek();
        } catch (e) { showMsg('❌ Error: ' + e.message); }
    };

    const handleRotate = async () => {
        try {
            await api.post('/shifts/weeks/generate-next', { currentWeekStart: weekStart });
            const nextMonday = new Date(weekStart);
            nextMonday.setDate(nextMonday.getDate() + 7);
            setWeekStart(nextMonday.toISOString().split('T')[0]);
            showMsg('🔄 Rotación automática aplicada exitosamente');
        } catch (e) { showMsg('❌ ' + (e.response?.data?.error || e.message)); }
    };

    const changeShift = (assignmentIdx, newShift) => {
        setWeek(prev => {
            const updated = { ...prev, assignments: [...prev.assignments] };
            updated.assignments[assignmentIdx] = { ...updated.assignments[assignmentIdx], shift: newShift };
            return updated;
        });
    };

    const handleDownloadImage = async () => {
        if (!week?.assignments) return;
        try {
            showMsg('⏳ Generando imagen HD…');

            // ── Build data from assignments ──
            const gridData = {};
            for (const area of AREAS) gridData[area] = { MANANA: [], TARDE: [], NOCHE: [], DIURNO: [] };
            week.assignments.forEach(a => {
                if (absentEmployeeIds.includes(a.employeeId)) return;
                const currentArea = a.employee?.area || a.area;
                if (gridData[currentArea]?.[a.shift]) {
                    gridData[currentArea][a.shift].push({
                        name: a.employee?.name || 'Sin nombre',
                        isLeader: a.employee?.role === 'LIDER'
                    });
                }
            });

            // ── Absent info ──
            const absentList = Object.entries(absentMap).map(([empId, reason]) => {
                const emp = week.assignments.find(a => a.employeeId === empId)?.employee;
                const ri = ABSENCE_REASONS.find(r => r.value === reason);
                return emp ? `<span style="padding:3px 10px;border-radius:8px;font-size:13px;font-weight:700;background:${ri?.bg || '#fef2f2'};color:${ri?.color || '#dc2626'};border:1px solid ${ri?.border || '#fecaca'};margin:0 4px;">${ri?.icon || '🤒'} ${emp.name} — ${ri?.label || reason}</span>` : '';
            }).filter(Boolean).join(' ');

            // ── Shift column definitions ──
            const shiftCols = [
                { key: 'MANANA', label: 'Mañana', code: 'M', color: '#16a34a', bg: '#f0fdf4', icon: '🌅', desc: 'Lun–Vie 6:00–14:00 • Sáb 6:00–12:00' },
                { key: 'TARDE', label: 'Tarde', code: 'T', color: '#ea580c', bg: '#fff7ed', icon: '☀️', desc: 'Lun–Vie 14:00–22:00 • Sáb 12:00–18:00' },
                { key: 'NOCHE', label: 'Noche', code: 'N', color: '#7c3aed', bg: '#faf5ff', icon: '🌙', desc: 'Dom 22:00 → Vie amanecer Sáb 6:00' },
                { key: 'DIURNO', label: 'Diurno', code: 'D', color: '#6b7280', bg: '#f9fafb', icon: '🏢', desc: 'Lun–Sáb 8:00–17:00' },
            ];

            // ── Build employee cell HTML ──
            const empCell = (members) => {
                if (!members || members.length === 0) return '<div style="text-align:center;color:#cbd5e1;font-style:italic;padding:10px;">Sin asignar</div>';
                return members.map(m => {
                    if (m.isLeader) {
                        return `<div style="padding:8px 12px;margin:4px 0;border-radius:10px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:800;font-size:14px;">👑 ${m.name}</div>`;
                    }
                    return `<div style="padding:8px 12px;margin:4px 0;border-radius:10px;border:1px solid #e2e8f0;font-weight:600;font-size:14px;color:#1e293b;">${m.name}</div>`;
                }).join('');
            };

            // ── Build table rows ──
            const areaRows = AREAS.map(area => {
                const showShifts = area === 'LOGISTICA' || area === 'ASEO' ? ['DIURNO'] : ['MANANA', 'TARDE', 'NOCHE'];
                const cells = shiftCols.map(sc => {
                    const isApplicable = showShifts.includes(sc.key);
                    if (!isApplicable) return `<td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;color:#e2e8f0;">—</td>`;
                    return `<td style="padding:8px;vertical-align:top;border:1px solid #e2e8f0;">${empCell(gridData[area]?.[sc.key])}</td>`;
                }).join('');
                return `<tr><td style="padding:10px 12px;font-weight:700;font-size:15px;color:#1e293b;border:1px solid #e2e8f0;background:#f8fafc;white-space:nowrap;">${AREA_ICONS[area]} ${AREA_LABELS[area]}</td>${cells}</tr>`;
            }).join('');

            // ── Build header columns ──
            const headerCols = shiftCols.map(sc => `
                <th style="padding:14px 10px;text-align:center;border:1px solid #e2e8f0;background:${sc.bg};min-width:200px;">
                    <div style="font-size:18px;margin-bottom:2px;">${sc.icon}</div>
                    <div style="font-size:17px;font-weight:800;color:${sc.color};">${sc.label} <span style="background:${sc.color};color:#fff;font-size:11px;padding:2px 7px;border-radius:5px;font-weight:800;">${sc.code}</span></div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">${sc.desc}</div>
                </th>
            `).join('');

            // ── Absent banner ──
            const absentBanner = absentList ? `
                <div style="padding:10px 20px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ⚠️ <span>Ausentes esta semana:</span> ${absentList}
                </div>
            ` : '';

            // ── Footer ──
            const footer = shiftCols.map(sc =>
                `<span style="display:inline-flex;align-items:center;gap:5px;font-size:13px;color:#78716c;"><span style="width:9px;height:9px;border-radius:50%;background:${sc.color};display:inline-block;"></span><strong style="color:${sc.color};">${sc.label}:</strong> ${sc.desc}</span>`
            ).join('&nbsp;&nbsp;&nbsp;');

            // ── Full HTML ──
            const html = `
                <div style="width:1500px;font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;background:#fff;">
                    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:#fff;padding:20px 28px;text-align:center;">
                        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px;opacity:0.7;margin-bottom:4px;">Popping Boba International S.A.S</div>
                        <div style="font-size:22px;font-weight:800;">Cuadro de Turnos — ${formatWeekRangeShort(weekStart)}</div>
                    </div>
                    ${absentBanner}
                    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
                        <colgroup>
                            <col style="width:130px;">
                            <col style="width:auto;">
                            <col style="width:auto;">
                            <col style="width:auto;">
                            <col style="width:auto;">
                        </colgroup>
                        <thead>
                            <tr>
                                <th style="padding:14px 10px;text-align:center;border:1px solid #e2e8f0;background:#f8fafc;font-size:15px;font-weight:700;color:#334155;">Área</th>
                                ${headerCols}
                            </tr>
                        </thead>
                        <tbody>${areaRows}</tbody>
                    </table>
                    <div style="padding:12px 20px;background:#fefce8;border-top:1px solid #fef08a;">
                        <span style="font-size:13px;font-weight:700;color:#92400e;">📌 Horarios:</span>&nbsp;&nbsp;${footer}
                    </div>
                </div>
            `;

            // ── Inject into hidden container and capture ──
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1500px;z-index:-1;background:#fff;';
            container.innerHTML = html;
            document.body.appendChild(container);
            const target = container.firstElementChild;

            // Wait for layout
            await new Promise(r => setTimeout(r, 200));

            const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
            const canvas = await html2canvas(target, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
                width: 1500,
                windowWidth: 1500
            });

            document.body.removeChild(container);

            const link = document.createElement('a');
            link.download = `turnos_${weekStart}.png`;
            link.href = canvas.toDataURL('image/png', 1.0);
            link.click();
            showMsg('📷 Imagen HD lista — compártela por WhatsApp');
        } catch (e) {
            showMsg('❌ Error generando imagen');
            console.error(e);
        }
    };

    const handleWhatsApp = (phone) => {
        const text = encodeURIComponent(`📋 *Cuadro de Turnos — ${formatWeekRangeShort(weekStart)}*\n\nRevisa tu turno en:\nhttps://gestionpbi.lat/shift-schedule`);
        window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
    };

    const handleDeleteEmp = async (empId, empName) => {
        if (!window.confirm(`¿Seguro que desea eliminar a "${empName}" del sistema de turnos?\n\nSe eliminarán todas sus asignaciones de turno.`)) return;
        try {
            await api.delete(`/shifts/employees/${empId}`);
            showMsg(`✅ ${empName} eliminado del sistema`);
            fetchEmployees();
            fetchWeek();
        } catch (err) { showMsg('❌ Error: ' + err.message); }
    };

    const handleAbsence = async (e) => {
        e.preventDefault();
        if (absForm.endDate < absForm.startDate) {
            showMsg('❌ La fecha de regreso no puede ser anterior a la fecha de inicio');
            return;
        }
        try {
            await api.post('/shifts/absences', absForm);
            showMsg('✅ Ausencia registrada — el empleado no aparecerá en el cuadro durante ese periodo');
            setAbsForm({ employeeId: '', startDate: today, endDate: today, reason: 'PERMISO', notes: '' });
            fetchAbsences();
            fetchWeek(); // Refresh to update absent employees in schedule
        } catch (err) { showMsg('❌ Error: ' + err.message); }
    };

    const handleDeleteAbsence = async (absId) => {
        if (!window.confirm('¿Eliminar esta ausencia? El empleado volverá a aparecer en el cuadro.')) return;
        try {
            await api.delete(`/shifts/absences/${absId}`);
            showMsg('✅ Ausencia eliminada');
            fetchAbsences();
            fetchWeek();
        } catch (err) { showMsg('❌ Error: ' + err.message); }
    };

    const handleEmpSave = async (e) => {
        e.preventDefault();
        try {
            const data = { ...empForm, groupNumber: empForm.groupNumber ? parseInt(empForm.groupNumber) : null };
            if (editingEmp) {
                await api.patch(`/shifts/employees/${editingEmp}`, data);
                showMsg('✅ Empleado actualizado — cambios reflejados en el cuadro');
            } else {
                await api.post('/shifts/employees', data);
                showMsg('✅ Empleado creado y asignado al cuadro actual');
            }
            setEmpForm({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' });
            setEditingEmp(null);
            fetchEmployees();
            fetchWeek(); // Refresh schedule to reflect changes
        } catch (err) { showMsg('❌ Error: ' + err.message); }
    };

    // ── Build grid ───────────────────────────────────────────────────────────
    const getGrid = () => {
        if (!week?.assignments) return {};
        const grid = {};
        for (const area of AREAS) grid[area] = { MANANA: [], TARDE: [], NOCHE: [], DIURNO: [] };
        week.assignments.forEach((a, idx) => {
            // Skip absent employees
            if (absentEmployeeIds.includes(a.employeeId)) return;
            const currentArea = a.employee?.area || a.area;
            if (grid[currentArea]?.[a.shift]) grid[currentArea][a.shift].push({ ...a, idx });
        });
        return grid;
    };
    const grid = getGrid();

    // Build absent-by-area map for showing in the schedule
    const getAbsentByArea = () => {
        if (!week?.assignments) return {};
        const absent = {};
        for (const area of AREAS) absent[area] = [];
        week.assignments.forEach(a => {
            if (absentEmployeeIds.includes(a.employeeId)) {
                const currentArea = a.employee?.area || a.area;
                if (absent[currentArea]) {
                    absent[currentArea].push({
                        name: a.employee?.name || 'Sin nombre',
                        reason: absentMap[a.employeeId] || 'PERMISO',
                        shift: a.shift
                    });
                }
            }
        });
        return absent;
    };
    const absentByArea = getAbsentByArea();

    // ═══════════════════════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════════════════════
    return (
        <div style={{ padding: '24px 28px', maxWidth: 1500, margin: '0 auto', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>
            {/* ── Header ──────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
                        📋 Cuadro de Turnos
                    </h1>
                    <p style={{ fontSize: 15, color: '#64748b', margin: '4px 0 0', fontWeight: 500 }}>
                        Gestión de rotación semanal — Popping Boba International
                    </p>
                </div>
                {msg && (
                    <div style={{
                        padding: '10px 20px', borderRadius: 10, fontWeight: 600, fontSize: 15,
                        background: msg.includes('❌') ? '#fef2f2' : '#f0fdf4',
                        color: msg.includes('❌') ? '#dc2626' : '#16a34a',
                        border: `1px solid ${msg.includes('❌') ? '#fecaca' : '#bbf7d0'}`,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        animation: 'fadeIn 0.3s ease'
                    }}>{msg}</div>
                )}
            </div>

            {/* ── Tabs ────────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#f1f5f9', borderRadius: 12, padding: 4 }}>
                {[['schedule', '📅 Cuadro Semanal'], ['handoffs', '🔄 Entregas'], ['absences', '🤒 Ausencias'], ['employees', '👥 Empleados']].map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        flex: 1, padding: '12px 20px', border: 'none', borderRadius: 10,
                        background: tab === key ? '#fff' : 'transparent',
                        boxShadow: tab === key ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                        fontWeight: tab === key ? 700 : 500, fontSize: 16,
                        color: tab === key ? '#0f172a' : '#64748b',
                        cursor: 'pointer', transition: 'all 0.2s'
                    }}>{label}</button>
                ))}
            </div>

            {/* ═══════ TAB 1: SCHEDULE ═══════════════════════════════════════════ */}
            {tab === 'schedule' && (
                <div>
                    {/* Week navigation */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
                        flexWrap: 'wrap', padding: '16px 20px', background: '#fff',
                        borderRadius: 14, border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                    }}>
                        <button onClick={() => changeWeek(-1)} style={navBtnStyle}>
                            ← Anterior
                        </button>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                                {formatWeekRange(weekStart)}
                            </div>
                            <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500, marginTop: 2 }}>
                                Semana de producción
                            </div>
                        </div>
                        <button onClick={() => changeWeek(1)} style={navBtnStyle}>
                            Siguiente →
                        </button>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={handleSave} disabled={saving} style={{ ...actionBtnStyle, background: saving ? '#94a3b8' : '#16a34a' }}>
                                {saving ? '⏳ ...' : '💾 Guardar'}
                            </button>
                            <button onClick={handlePublish} style={{ ...actionBtnStyle, background: '#2563eb' }}>📢 Publicar</button>
                            <button onClick={handleRotate} style={{ ...actionBtnStyle, background: '#ea580c' }}>🔄 Rotar</button>
                            <button onClick={handleDownloadImage} style={{ ...actionBtnStyle, background: '#7c3aed' }}>📷 Imagen</button>
                        </div>
                    </div>

                    {week?.status === 'PUBLISHED' && (
                        <div style={{
                            padding: '10px 20px', background: '#eff6ff', color: '#1d4ed8',
                            borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: 600,
                            border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 8
                        }}>
                            <span style={{ fontSize: 18 }}>✅</span> Publicado el {formatDate(week.publishedAt)}
                        </div>
                    )}

                    {/* Absent employees banner */}
                    {absentEmployeeIds.length > 0 && (
                        <div style={{
                            padding: '12px 20px', background: '#fef3c7', color: '#92400e',
                            borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: 600,
                            border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'
                        }}>
                            <span style={{ fontSize: 18 }}>⚠️</span>
                            <span>Empleados ausentes esta semana:</span>
                            {Object.entries(absentMap).map(([empId, reason]) => {
                                const emp = week?.assignments?.find(a => a.employeeId === empId)?.employee;
                                const reasonInfo = ABSENCE_REASONS.find(r => r.value === reason) || {};
                                return emp ? (
                                    <span key={empId} style={{
                                        padding: '3px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                                        background: reasonInfo.bg || '#fef2f2',
                                        color: reasonInfo.color || '#dc2626',
                                        border: `1px solid ${reasonInfo.border || '#fecaca'}`
                                    }}>
                                        {reasonInfo.icon || '🤒'} {emp.name} — {reasonInfo.label || reason}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    )}

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 18 }}>
                            ⏳ Cargando cuadro…
                        </div>
                    ) : (
                        <div ref={tableRef} style={{
                            background: '#fff', borderRadius: 16, overflow: 'hidden',
                            border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.06)'
                        }}>
                            {/* Title banner */}
                            <div style={{
                                background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
                                color: '#fff', padding: '18px 24px', textAlign: 'center'
                            }}>
                                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.7, marginBottom: 4 }}>
                                    Popping Boba International S.A.S
                                </div>
                                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>
                                    Cuadro de Turnos — {formatWeekRangeShort(weekStart)}
                                </div>
                            </div>

                            {/* Schedule grid */}
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...thStyle, width: 130, background: '#f8fafc' }}>
                                            <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>Área</span>
                                        </th>
                                        {Object.entries(SHIFTS).map(([key, s]) => (
                                            <th key={key} style={{ ...thStyle, background: s.bg }}>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4
                                                }}>
                                                    <span style={{ fontSize: 20 }}>{s.icon}</span>
                                                    <span style={{ fontSize: 17, fontWeight: 800, color: s.color }}>{s.label}</span>
                                                    <span style={{
                                                        background: s.gradient, color: '#fff', fontSize: 12, fontWeight: 800,
                                                        padding: '2px 8px', borderRadius: 6, letterSpacing: 1
                                                    }}>{s.code}</span>
                                                </div>
                                                <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500, lineHeight: 1.4 }}>
                                                    {s.weekDesc}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {AREAS.map(area => {
                                        const areaShifts = grid[area] || {};
                                        const areaAbsent = absentByArea[area] || [];
                                        const showShifts = area === 'LOGISTICA' || area === 'ASEO' ? ['DIURNO'] : ['MANANA', 'TARDE', 'NOCHE'];
                                        return (
                                            <tr key={area} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                <td style={{
                                                    ...tdStyle, fontWeight: 700, background: '#f8fafc',
                                                    borderRight: '2px solid #e2e8f0', minWidth: 130
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ fontSize: 20 }}>{AREA_ICONS[area]}</span>
                                                        <span style={{ fontSize: 15, color: '#1e293b' }}>{AREA_LABELS[area]}</span>
                                                    </div>
                                                    {/* Show absent employees under the area name */}
                                                    {areaAbsent.length > 0 && (
                                                        <div style={{ marginTop: 8 }}>
                                                            {areaAbsent.map((ab, i) => {
                                                                const ri = ABSENCE_REASONS.find(r => r.value === ab.reason);
                                                                return (
                                                                    <div key={i} style={{
                                                                        fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                                                        background: ri?.bg || '#fef2f2', color: ri?.color || '#dc2626',
                                                                        border: `1px solid ${ri?.border || '#fecaca'}`,
                                                                        marginBottom: 3, fontWeight: 600, lineHeight: 1.3
                                                                    }}>
                                                                        {ri?.icon || '🤒'} {ab.name}
                                                                        <div style={{ fontSize: 10, opacity: 0.8, fontWeight: 500 }}>{ri?.label || ab.reason}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </td>
                                                {Object.keys(SHIFTS).map(shiftKey => {
                                                    const members = areaShifts[shiftKey] || [];
                                                    const isApplicable = showShifts.includes(shiftKey);
                                                    const shift = SHIFTS[shiftKey];
                                                    return (
                                                        <td key={shiftKey} style={{
                                                            ...tdStyle,
                                                            background: isApplicable ? '#fff' : '#f8fafc',
                                                            minWidth: 190, verticalAlign: 'top',
                                                            borderRight: '1px solid #f1f5f9'
                                                        }}>
                                                            {isApplicable ? (
                                                                members.length > 0 ? members.map((m, i) => {
                                                                    const isLeader = m.employee?.role === 'LIDER';
                                                                    const lastLogin = m.employee?.user?.lastLogin;
                                                                    const ago = timeAgo(lastLogin);
                                                                    return (
                                                                        <EmployeeCard
                                                                            key={m.id || i}
                                                                            name={m.employee?.name || 'Sin nombre'}
                                                                            isLeader={isLeader}
                                                                            shift={shift}
                                                                            shiftKey={m.shift}
                                                                            showShifts={showShifts}
                                                                            onShiftChange={(val) => changeShift(m.idx, val)}
                                                                            lastLogin={ago}
                                                                            exporting={exporting}
                                                                            partialAbsence={partialAbsentMap[m.employee?.id || m.employeeId]}
                                                                        />
                                                                    );
                                                                }) : (
                                                                    <div style={{
                                                                        padding: 12, textAlign: 'center',
                                                                        color: '#cbd5e1', fontSize: 14, fontStyle: 'italic'
                                                                    }}>
                                                                        Sin asignar
                                                                    </div>
                                                                )
                                                            ) : (
                                                                <div style={{ padding: 12, textAlign: 'center', color: '#e2e8f0' }}>—</div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Footer legend */}
                            <div style={{
                                padding: '14px 24px', background: '#fefce8',
                                borderTop: '1px solid #fef08a', display: 'flex', flexWrap: 'wrap', gap: 24
                            }}>
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>📌 Horarios:</span>
                                {Object.entries(SHIFTS).map(([key, s]) => (
                                    <span key={key} style={{ fontSize: 14, color: '#78716c', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{
                                            width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block'
                                        }} />
                                        <strong style={{ color: s.color }}>{s.label}:</strong> {s.weekDesc}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════ TAB 2: ABSENCES ════════════════════════════════════════════ */}
            {tab === 'absences' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div style={cardStyle}>
                        <h3 style={cardTitleStyle}>🤒 Registrar Ausencia</h3>
                        <form onSubmit={handleAbsence} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <select value={absForm.employeeId} onChange={e => setAbsForm({ ...absForm, employeeId: e.target.value })} required style={inputStyle}>
                                <option value="">Seleccionar empleado…</option>
                                {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {AREA_LABELS[e.area]}</option>)}
                            </select>

                            {/* Date range */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div>
                                    <label style={labelStyle}>📅 Desde</label>
                                    <input type="date" value={absForm.startDate}
                                        onChange={e => setAbsForm({ ...absForm, startDate: e.target.value })} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>📅 Hasta (regreso)</label>
                                    <input type="date" value={absForm.endDate}
                                        onChange={e => setAbsForm({ ...absForm, endDate: e.target.value })} style={inputStyle} />
                                </div>
                            </div>

                            {/* Duration indicator */}
                            {absForm.startDate && absForm.endDate && (
                                <div style={{
                                    padding: '8px 14px', background: '#eff6ff', borderRadius: 10,
                                    fontSize: 13, fontWeight: 600, color: '#2563eb', textAlign: 'center',
                                    border: '1px solid #bfdbfe'
                                }}>
                                    📅 Duración: {Math.max(1, Math.ceil((new Date(absForm.endDate) - new Date(absForm.startDate)) / 86400000) + 1)} día(s)
                                </div>
                            )}

                            {/* Reason selector — visual cards */}
                            <div>
                                <label style={labelStyle}>Motivo de ausencia</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                                    {ABSENCE_REASONS.map(r => (
                                        <button type="button" key={r.value}
                                            onClick={() => setAbsForm({ ...absForm, reason: r.value })}
                                            style={{
                                                padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                                                background: absForm.reason === r.value ? r.bg : '#f8fafc',
                                                border: `2px solid ${absForm.reason === r.value ? r.color : '#e2e8f0'}`,
                                                color: absForm.reason === r.value ? r.color : '#64748b',
                                                fontWeight: absForm.reason === r.value ? 700 : 500,
                                                fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
                                                transition: 'all 0.2s'
                                            }}>
                                            <span style={{ fontSize: 18 }}>{r.icon}</span> {r.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <input placeholder="Notas (opcional)" value={absForm.notes} onChange={e => setAbsForm({ ...absForm, notes: e.target.value })} style={inputStyle} />
                            <button type="submit" style={{ ...actionBtnStyle, background: '#dc2626', width: '100%', padding: '14px 20px', fontSize: 16 }}>
                                🤒 Registrar Ausencia
                            </button>
                        </form>
                    </div>
                    <div style={cardStyle}>
                        <h3 style={cardTitleStyle}>📋 Historial de Ausencias</h3>
                        {absences.length === 0 ? (
                            <p style={{ color: '#94a3b8', fontSize: 15, textAlign: 'center', padding: 40 }}>
                                Sin ausencias registradas este mes
                            </p>
                        ) : (
                            <div style={{ maxHeight: 550, overflowY: 'auto' }}>
                                {absences.map(a => {
                                    const ri = ABSENCE_REASONS.find(r => r.value === a.reason) || {};
                                    const start = new Date(a.startDate);
                                    const end = new Date(a.endDate);
                                    const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
                                    return (
                                        <div key={a.id} style={{
                                            padding: '14px 16px', borderBottom: '1px solid #f1f5f9',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12
                                        }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{a.employee?.name}</div>
                                                <div style={{ fontSize: 13, color: '#64748b', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    📅 {formatDateShort(a.startDate)} → {formatDateShort(a.endDate)}
                                                    <span style={{
                                                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                                        background: '#eff6ff', color: '#2563eb'
                                                    }}>{days} día{days > 1 ? 's' : ''}</span>
                                                </div>
                                                {a.notes && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{a.notes}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{
                                                    padding: '5px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                                                    background: ri.bg || '#f1f5f9', color: ri.color || '#64748b',
                                                    border: `1px solid ${ri.border || '#e2e8f0'}`,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {ri.icon || '📋'} {ri.label || a.reason}
                                                </span>
                                                <button onClick={() => handleDeleteAbsence(a.id)} style={{
                                                    border: 'none', background: '#fef2f2', color: '#dc2626',
                                                    padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                                                    fontSize: 14, fontWeight: 600
                                                }} title="Eliminar ausencia">🗑️</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══════ TAB 3: EMPLOYEES ═══════════════════════════════════════════ */}
            {tab === 'employees' && (
                <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24 }}>
                    <div style={cardStyle}>
                        <h3 style={cardTitleStyle}>{editingEmp ? '✏️ Editar' : '➕ Nuevo'} Empleado</h3>
                        <form onSubmit={handleEmpSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <input placeholder="Nombre completo" value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} required style={inputStyle} />
                            <div>
                                <label style={labelStyle}>Línea / Área de trabajo</label>
                                <select value={empForm.area} onChange={e => setEmpForm({ ...empForm, area: e.target.value })} style={inputStyle}>
                                    {AREAS.map(a => <option key={a} value={a}>{AREA_ICONS[a]} {AREA_LABELS[a]}</option>)}
                                </select>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                                    ⚙️ Producción = Línea de Perlas  •  🧪 Siropes = Línea de Siropes
                                </div>
                            </div>
                            <select value={empForm.role} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} style={inputStyle}>
                                <option value="OPERARIO">Operario</option>
                                <option value="LIDER">Líder</option>
                            </select>
                            <input placeholder="# Grupo (1, 2 o 3)" type="number" min="1" max="3" value={empForm.groupNumber}
                                onChange={e => setEmpForm({ ...empForm, groupNumber: e.target.value })} style={inputStyle} />
                            <input placeholder="WhatsApp (ej: 573001234567)" value={empForm.whatsapp}
                                onChange={e => setEmpForm({ ...empForm, whatsapp: e.target.value })} style={inputStyle} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: '#334155', cursor: 'pointer' }}>
                                <input type="checkbox" checked={empForm.isFixed}
                                    onChange={e => setEmpForm({ ...empForm, isFixed: e.target.checked })}
                                    style={{ width: 18, height: 18 }} />
                                Turno fijo (no rota)
                            </label>
                            <div style={{ fontSize: 14, color: '#64748b' }}>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>Restricciones de turno:</div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    {['MANANA', 'TARDE', 'NOCHE'].map(s => (
                                        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={empForm.restrictions.includes(s)}
                                                onChange={e => {
                                                    const r = e.target.checked ? [...empForm.restrictions, s] : empForm.restrictions.filter(x => x !== s);
                                                    setEmpForm({ ...empForm, restrictions: r });
                                                }}
                                                style={{ width: 16, height: 16 }} />
                                            {SHIFTS[s]?.icon} {SHIFTS[s]?.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <button type="submit" style={{ ...actionBtnStyle, background: '#2563eb', width: '100%', padding: '12px 20px', fontSize: 15 }}>
                                {editingEmp ? '✏️ Actualizar Empleado' : '➕ Crear Empleado'}
                            </button>
                            {editingEmp && (
                                <button type="button" onClick={() => {
                                    setEditingEmp(null);
                                    setEmpForm({ name: '', area: 'PRODUCCION', role: 'OPERARIO', groupNumber: '', isFixed: false, restrictions: [], whatsapp: '' });
                                }} style={{ ...actionBtnStyle, background: '#94a3b8', width: '100%', padding: '12px 20px', fontSize: 15 }}>
                                    Cancelar
                                </button>
                            )}
                        </form>
                    </div>

                    <div style={cardStyle}>
                        <h3 style={cardTitleStyle}>👥 Equipo de Producción ({employees.length})</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                    <th style={empThStyle}>Nombre</th>
                                    <th style={empThStyle}>Línea / Área</th>
                                    <th style={empThStyle}>Rol</th>
                                    <th style={empThStyle}>Grupo</th>
                                    <th style={empThStyle}>Usuario ERP</th>
                                    <th style={empThStyle}>Último Login</th>
                                    <th style={empThStyle}>WhatsApp</th>
                                    <th style={empThStyle}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => (
                                    <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={empTdStyle}>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{emp.name}</span>
                                        </td>
                                        <td style={empTdStyle}>
                                            <span style={{
                                                fontSize: 13, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
                                                background: emp.area === 'PRODUCCION' ? '#eff6ff' : emp.area === 'SIROPES' ? '#faf5ff' : '#f1f5f9',
                                                color: emp.area === 'PRODUCCION' ? '#2563eb' : emp.area === 'SIROPES' ? '#7c3aed' : '#64748b'
                                            }}>
                                                {AREA_ICONS[emp.area]} {AREA_LABELS[emp.area]}
                                            </span>
                                        </td>
                                        <td style={empTdStyle}>
                                            <span style={{
                                                fontSize: 13, fontWeight: 600,
                                                padding: '3px 10px', borderRadius: 8,
                                                background: emp.role === 'LIDER' ? '#fef3c7' : '#f1f5f9',
                                                color: emp.role === 'LIDER' ? '#92400e' : '#64748b'
                                            }}>
                                                {emp.role === 'LIDER' ? '👑 Líder' : 'Operario'}
                                            </span>
                                        </td>
                                        <td style={empTdStyle}>
                                            <span style={{ fontSize: 14, color: '#334155' }}>
                                                {emp.isFixed ? '🔒 Fijo' : `Grupo ${emp.groupNumber || '—'}`}
                                            </span>
                                        </td>
                                        <td style={empTdStyle}>
                                            {emp.user ? (
                                                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                                                    {emp.user.email}
                                                </span>
                                            ) : <span style={{ color: '#cbd5e1', fontSize: 13 }}>No vinculado</span>}
                                        </td>
                                        <td style={empTdStyle}>
                                            {emp.user?.lastLogin ? (
                                                <span style={{ fontSize: 13, color: '#334155' }}>hace {timeAgo(emp.user.lastLogin)}</span>
                                            ) : <span style={{ color: '#cbd5e1', fontSize: 13 }}>—</span>}
                                        </td>
                                        <td style={empTdStyle}>
                                            {emp.whatsapp ? (
                                                <button onClick={() => handleWhatsApp(emp.whatsapp)} style={{
                                                    border: 'none', background: '#25D366', color: '#fff',
                                                    padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                                                    fontSize: 13, fontWeight: 600
                                                }}>
                                                    📱 {emp.whatsapp.slice(-4)}
                                                </button>
                                            ) : <span style={{ color: '#cbd5e1', fontSize: 13 }}>—</span>}
                                        </td>
                                        <td style={empTdStyle}>
                                            <button onClick={() => {
                                                setEditingEmp(emp.id);
                                                setEmpForm({
                                                    name: emp.name, area: emp.area, role: emp.role,
                                                    groupNumber: emp.groupNumber || '', isFixed: emp.isFixed,
                                                    restrictions: emp.restrictions || [], whatsapp: emp.whatsapp || ''
                                                });
                                            }} style={{
                                                border: 'none', background: '#eff6ff', color: '#2563eb',
                                                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                                                fontSize: 14, fontWeight: 600
                                            }}>✏️</button>
                                            <button onClick={() => handleDeleteEmp(emp.id, emp.name)} style={{
                                                border: 'none', background: '#fef2f2', color: '#dc2626',
                                                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                                                fontSize: 14, fontWeight: 600, marginLeft: 6
                                            }}>🗑️</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ═══════ TAB 4: HANDOFFS (Entregas de Turno) ═══════════════════════ */}
            {tab === 'handoffs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* Status summary */}
                    <div style={{
                        padding: '16px 20px', borderRadius: 14, display: 'flex',
                        alignItems: 'center', gap: 16, flexWrap: 'wrap',
                        background: handoffData.allDelivered
                            ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
                            : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                        border: `2px solid ${handoffData.allDelivered ? '#86efac' : '#fde68a'}`
                    }}>
                        <span style={{ fontSize: 32 }}>
                            {handoffData.allDelivered ? '🟢' : '🟡'}
                        </span>
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                                {handoffData.allDelivered
                                    ? '✅ Todas las entregas aprobadas — turno desbloqueado'
                                    : `⏳ ${handoffData.pendingCount || 0} entrega(s) pendiente(s)`
                                }
                            </div>
                            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                                Turno saliente: <strong>{handoffData.outgoingShift}</strong> →
                                Turno entrante: <strong>{handoffData.incomingShift}</strong>
                            </div>
                        </div>
                    </div>

                    {handoffMsg && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14,
                            background: handoffMsg.includes('❌') ? '#fef2f2' : '#f0fdf4',
                            color: handoffMsg.includes('❌') ? '#dc2626' : '#16a34a',
                            border: `1px solid ${handoffMsg.includes('❌') ? '#fecaca' : '#bbf7d0'}`,
                            textAlign: 'center'
                        }}>{handoffMsg}</div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
                        {/* Left: Operator form */}
                        <ShiftHandoffForm onSuccess={fetchHandoffs} />

                        {/* Right: Leader approval panel */}
                        <ShiftHandoffApproval
                            operators={handoffData.operators}
                            handoffs={handoffData.handoffs}
                            outgoingShift={handoffData.outgoingShift}
                            onApprove={handleApproveHandoff}
                            onReject={handleRejectHandoff}
                            loading={handoffLoading}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function EmployeeCard({ name, isLeader, shift, shiftKey, showShifts, onShiftChange, lastLogin, exporting, partialAbsence }) {
    const shiftInfo = SHIFTS[shiftKey];
    return (
        <div style={{
            padding: '10px 14px', margin: '6px 4px', borderRadius: 12,
            background: isLeader ? shift.gradient : '#fff',
            color: isLeader ? '#fff' : '#1e293b',
            border: isLeader ? 'none' : `2px solid ${shift.color}20`,
            boxShadow: isLeader ? '0 3px 12px rgba(0,0,0,0.15)' : '0 1px 4px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{
                    fontSize: 15, fontWeight: isLeader ? 800 : 600,
                    display: 'flex', alignItems: 'center', gap: 6,
                    flex: 1, minWidth: 0
                }}>
                    {isLeader && <span style={{ fontSize: 16, flexShrink: 0 }}>👑</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                </div>
                {exporting ? (
                    <span style={{
                        fontSize: 12, borderRadius: 6, fontWeight: 700,
                        padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0,
                        background: isLeader ? 'rgba(255,255,255,0.25)' : `${shift.color}15`,
                        color: isLeader ? '#fff' : shift.color,
                        border: isLeader ? '1px solid rgba(255,255,255,0.3)' : `1px solid ${shift.color}30`
                    }}>
                        {shiftInfo?.label} ({shiftInfo?.code})
                    </span>
                ) : (
                    <select value={shiftKey} onChange={e => onShiftChange(e.target.value)} style={{
                        fontSize: 12, border: 'none', borderRadius: 6,
                        background: isLeader ? 'rgba(255,255,255,0.2)' : `${shift.color}10`,
                        color: isLeader ? '#fff' : shift.color,
                        padding: '2px 6px', cursor: 'pointer', fontWeight: 700,
                        flexShrink: 0
                    }}>
                        {showShifts.map(s => <option key={s} value={s}>{SHIFTS[s]?.label} ({SHIFTS[s]?.code})</option>)}
                    </select>
                )}
            </div>
            {partialAbsence && (() => {
                const ri = ABSENCE_REASONS.find(r => r.value === partialAbsence.reason) || {};
                const dList = [];
                // Add T12 to force it to parse correctly regardless of timezone
                const sdStr = typeof partialAbsence.startDate === 'string' ? partialAbsence.startDate.split('T')[0] : '';
                const edStr = typeof partialAbsence.endDate === 'string' ? partialAbsence.endDate.split('T')[0] : '';
                
                const sd = new Date((sdStr || partialAbsence.startDate) + 'T12:00:00');
                const ed = new Date((edStr || partialAbsence.endDate) + 'T12:00:00');
                
                if (sdStr === edStr) {
                    dList.push(sd.toLocaleDateString('es-CO', { weekday: 'short' }).toUpperCase());
                } else {
                    dList.push(sd.toLocaleDateString('es-CO', { weekday: 'short' }).toUpperCase() + '-' + ed.toLocaleDateString('es-CO', { weekday: 'short' }).toUpperCase());
                }
                
                return (
                    <div style={{
                        marginTop: 6, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: ri.bg || '#fef2f2', color: ri.color || '#dc2626',
                        display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${ri.border || '#fecaca'}`,
                        lineHeight: 1.2
                    }}>
                        <span style={{fontSize: 14}}>{ri.icon || '🤒'}</span>
                        <div>
                            <div style={{ opacity: 0.9 }}>Mantiene turno ({dList.join('')})</div>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', marginTop: 1 }}>{ri.label || partialAbsence.reason}</div>
                        </div>
                    </div>
                );
            })()}
            {lastLogin && (
                <div style={{
                    fontSize: 12, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4,
                    opacity: isLeader ? 0.85 : 0.65
                }}>
                    <span style={{
                        width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                        background: isLeader ? '#a5f3fc' : '#22c55e'
                    }} />
                    Último acceso: {lastLogin}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const thStyle = {
    padding: '14px 16px', textAlign: 'center', fontSize: 14,
    borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9',
    verticalAlign: 'top'
};
const tdStyle = { padding: '8px 6px', verticalAlign: 'top' };

const cardStyle = {
    background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
    padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,0.04)'
};
const cardTitleStyle = {
    fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 18,
    paddingBottom: 12, borderBottom: '2px solid #f1f5f9'
};

const inputStyle = {
    padding: '11px 14px', border: '2px solid #e2e8f0', borderRadius: 10,
    fontSize: 15, width: '100%', boxSizing: 'border-box',
    transition: 'border-color 0.2s', outline: 'none', color: '#1e293b'
};

const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 700, color: '#475569',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5
};

const navBtnStyle = {
    padding: '10px 22px', border: '2px solid #e2e8f0', borderRadius: 10,
    background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15,
    color: '#334155', transition: 'all 0.2s'
};

const actionBtnStyle = {
    padding: '10px 18px', border: 'none', borderRadius: 10,
    color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14,
    transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
};

const empThStyle = {
    padding: '12px 14px', textAlign: 'left', fontSize: 13,
    fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
    letterSpacing: 0.5, borderBottom: '2px solid #e2e8f0'
};
const empTdStyle = { padding: '12px 14px', verticalAlign: 'middle' };
