/**
 * AttendancePage.jsx
 * Panel admin de Control de Ingreso integrado en gestionpbi.
 * Tabs: Dashboard | Empleados | Historial | Reportes | Turnos
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import {
    Users, Clock, BarChart2, Settings, LogIn, LogOut,
    Coffee, Sun, Moon, AlertCircle, CheckCircle2, XCircle,
    Camera, RefreshCw, Download, Search, Filter, ChevronDown,
    Calendar, MapPin, Fingerprint, Hash, Edit2, Save,
    Loader2, TrendingUp, TrendingDown, Timer, Building2, Plus,
    Eye, ArrowRightLeft, ArrowRight, ArrowLeft, Image, WalletCards
} from 'lucide-react';
import LaborManagementPage from './LaborManagementPage';

// ── Constantes ───────────────────────────────────────────────────────────────

const TABS = [
    { id: 'dashboard',    label: 'En Planta Ahora', icon: Building2 },
    { id: 'employees',    label: 'Empleados',        icon: Users },
    { id: 'operation',    label: 'Operación',        icon: WalletCards },
    { id: 'history',      label: 'Historial',        icon: Clock },
    { id: 'reports',      label: 'Reportes',         icon: BarChart2 },
    { id: 'shifts',       label: 'Turnos',           icon: Settings },
    { id: 'surveillance', label: 'Vigilancia',       icon: Eye },
];

const STATE_LABELS = {
    IN:    { label: 'En planta',    color: 'text-emerald-600', bg: 'bg-emerald-50',    dot: 'bg-emerald-500' },
    BREAK: { label: 'Descanso',     color: 'text-amber-600',   bg: 'bg-amber-50',      dot: 'bg-amber-500'   },
    OUT:   { label: 'Fuera',        color: 'text-neutral-400', bg: 'bg-neutral-100',   dot: 'bg-neutral-400' },
};

const TYPE_LABELS = {
    ENTRY: { label: 'Entrada',  icon: LogIn,  color: 'text-emerald-600', bg: 'bg-emerald-50'  },
    EXIT:  { label: 'Salida',   icon: LogOut, color: 'text-red-500',     bg: 'bg-red-50'      },
};

const SUBTYPE_LABELS = {
    BREAK:    { label: 'Descanso',  icon: Coffee, color: 'text-amber-600'   },
    LUNCH:    { label: 'Almuerzo',  icon: Sun,    color: 'text-orange-500'  },
    MEDICAL:  { label: 'Médico',    icon: AlertCircle, color: 'text-blue-500' },
    PERSONAL: { label: 'Personal',  icon: Users,  color: 'text-purple-500'  },
    FINAL:    { label: 'Definitiva',icon: XCircle, color: 'text-red-600'    },
};

const fmt = (ts) => ts
    ? new Date(ts).toLocaleString('es-CO', { timeZone:'America/Bogota', hour:'2-digit', minute:'2-digit', hour12:true, day:'2-digit', month:'2-digit' })
    : '—';

const fmtTime = (ts) => ts
    ? new Date(ts).toLocaleTimeString('es-CO', { timeZone:'America/Bogota', hour:'2-digit', minute:'2-digit', hour12:true })
    : '—';

const todayISO = () => new Date().toISOString().split('T')[0];
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };

// ── Helpers UI ───────────────────────────────────────────────────────────────
function Badge({ children, className = '' }) {
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>{children}</span>;
}
function Card({ children, className = '' }) {
    return <div className={`bg-white rounded-2xl border border-neutral-200 shadow-sm ${className}`}>{children}</div>;
}
function KpiCard({ label, value, icon: Icon, color = 'text-primary-600', sub }) {
    return (
        <Card className="p-5 flex items-center gap-4">
            <div className={`p-3 rounded-xl bg-neutral-50 ${color}`}>
                <Icon size={22} />
            </div>
            <div>
                <p className="text-2xl font-bold text-neutral-900">{value ?? '—'}</p>
                <p className="text-sm text-neutral-500">{label}</p>
                {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
            </div>
        </Card>
    );
}
function Spinner() { return <Loader2 size={20} className="animate-spin text-primary-500" />; }

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 1 — DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function TabDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const timer = useRef(null);

    const load = useCallback(async () => {
        try {
            const r = await api.get('/attendance/dashboard');
            setData(r.data);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); timer.current = setInterval(load, 30000); return () => clearInterval(timer.current); }, [load]);

    if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

    const recent = data?.recentRecords ?? [];
    const byArea = data?.byArea ?? [];

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="En planta ahora" value={data?.present} icon={Building2} color="text-emerald-600" />
                <KpiCard label="Entradas hoy" value={data?.todayEntries} icon={LogIn} color="text-blue-600" />
                <KpiCard label="Salidas hoy" value={data?.todayExits} icon={LogOut} color="text-red-500" />
                <KpiCard label="Áreas activas" value={byArea.length} icon={MapPin} color="text-purple-600" />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Por área */}
                <Card className="p-5">
                    <h3 className="font-bold text-neutral-800 mb-4 flex items-center gap-2">
                        <Building2 size={16} className="text-primary-500" /> Presencia por área
                    </h3>
                    {byArea.length === 0
                        ? <p className="text-sm text-neutral-400 text-center py-6">No hay empleados en planta</p>
                        : <div className="space-y-2">
                            {byArea.map(a => (
                                <div key={a.area} className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
                                    <span className="text-sm font-medium text-neutral-700">{a.area}</span>
                                    <Badge className="bg-emerald-50 text-emerald-700">{a.count} personas</Badge>
                                </div>
                            ))}
                        </div>
                    }
                </Card>

                {/* Actividad reciente */}
                <Card className="p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-neutral-800 flex items-center gap-2">
                            <Clock size={16} className="text-primary-500" /> Actividad reciente
                        </h3>
                        <button onClick={load} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors">
                            <RefreshCw size={14} />
                        </button>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {recent.length === 0
                            ? <p className="text-sm text-neutral-400 text-center py-6">Sin registros hoy</p>
                            : recent.map(r => {
                                const T = TYPE_LABELS[r.type] ?? TYPE_LABELS.ENTRY;
                                const S = r.subtype ? SUBTYPE_LABELS[r.subtype] : null;
                                const TIcon = T.icon;
                                return (
                                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-neutral-50 last:border-0">
                                        <div className={`p-1.5 rounded-lg ${T.bg}`}>
                                            <TIcon size={14} className={T.color} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-neutral-800 truncate">
                                                {r.employee?.name ?? '—'}
                                            </p>
                                            <p className="text-xs text-neutral-400">
                                                {T.label}{S ? ` · ${S.label}` : ''} · {r.employee?.area}
                                            </p>
                                        </div>
                                        <span className="text-xs text-neutral-400 whitespace-nowrap">{fmtTime(r.timestamp)}</span>
                                    </div>
                                );
                            })
                        }
                    </div>
                </Card>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 2 — EMPLEADOS (gestión + enrollment facial)
// ══════════════════════════════════════════════════════════════════════════════
function TabEmployees() {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading]     = useState(true);
    const [search, setSearch]       = useState('');
    const [selected, setSelected]   = useState(null); // empleado seleccionado para editar
    const [enrolling, setEnrolling] = useState(false);
    const panelRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/attendance/employees', { params: { search } });
            setEmployees(r.data);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    // Auto-scroll al panel cuando se selecciona un empleado en pantallas pequeñas (tablet/móvil).
    useEffect(() => {
        if (selected && panelRef.current && window.innerWidth < 1024) {
            setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        }
    }, [selected]);

    const filtered = employees; // ya filtrado en backend

    return (
        <div className="grid md:grid-cols-5 gap-6">
            {/* Lista */}
            <div className="md:col-span-3 space-y-4">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                        className="w-full pl-9 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                        placeholder="Buscar por nombre o cédula..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {loading
                    ? <div className="flex justify-center py-12"><Spinner /></div>
                    : <div className="space-y-2">
                        {filtered.map(emp => {
                            const isPending = emp.pending === true;
                            const st = emp.isInPlant ? 'IN' : 'OUT';
                            const S = STATE_LABELS[st];
                            const isSelected = isPending
                                ? selected?.userId === emp.userId && selected?.pending
                                : selected?.id === emp.id;
                            return (
                                <button
                                    key={isPending ? `pending-${emp.userId}` : emp.id}
                                    onClick={() => { setSelected(emp); setEnrolling(false); }}
                                    className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-all ${isSelected ? 'border-primary-400 bg-primary-50' : isPending ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300' : 'border-neutral-200 bg-white hover:border-primary-200 hover:bg-neutral-50'}`}
                                >
                                    {/* Avatar */}
                                    <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                                        {emp.photoUrl
                                            ? <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" onError={e => e.target.style.display='none'} />
                                            : <span className="text-lg">{isPending ? '⚠️' : '👤'}</span>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-neutral-800 truncate">{emp.name}</p>
                                        <p className="text-xs text-neutral-400 truncate">
                                            {isPending ? emp.role : `${emp.area} · ${emp.cedula ?? 'Sin cédula'}`}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        {isPending
                                            ? <Badge className="bg-amber-100 text-amber-700">Sin turno asignado</Badge>
                                            : <>
                                                <Badge className={`${S.bg} ${S.color}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${S.dot}`} />
                                                    {S.label}
                                                </Badge>
                                                {emp.hasFace && <Badge className="bg-violet-50 text-violet-600">Face ✓</Badge>}
                                            </>
                                        }
                                    </div>
                                </button>
                            );
                        })}
                        {filtered.length === 0 && <p className="text-center text-neutral-400 py-10 text-sm">No se encontraron empleados</p>}
                    </div>
                }
            </div>

            {/* Panel derecho */}
            <div ref={panelRef} className="md:col-span-2 md:sticky md:top-4 md:self-start">
                {selected?.pending
                    ? <PendingUserPanel
                        user={selected}
                        onSaved={() => { load(); setSelected(null); }}
                        onCancel={() => setSelected(null)}
                      />
                    : selected
                    ? <EmployeePanel
                        employee={selected}
                        enrolling={enrolling}
                        setEnrolling={setEnrolling}
                        onSaved={() => { load(); setSelected(null); }}
                      />
                    : <Card className="p-8 flex flex-col items-center justify-center text-center text-neutral-400 min-h-48">
                        <Users size={32} className="mb-3 opacity-40" />
                        <p className="text-sm">Selecciona un empleado para gestionar su acceso al kiosko</p>
                    </Card>
                }
            </div>
        </div>
    );
}

const AREAS = ['PRODUCCION', 'LOGISTICA', 'CALIDAD', 'COMERCIAL', 'CARTERA', 'CONTABILIDAD', 'RECURSOS_HUMANOS', 'OFICINA', 'OPERACIONES'];

function PendingUserPanel({ user, onSaved, onCancel }) {
    const [area, setArea]     = useState(user.role === 'PRODUCCION' ? 'PRODUCCION' : user.role === 'LOGISTICA' ? 'LOGISTICA' : user.role === 'CALIDAD' ? 'CALIDAD' : '');
    const [cedula, setCedula] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]       = useState(null);

    const handleCreate = async () => {
        if (!area) { setMsg({ type:'err', text:'Selecciona un área' }); return; }
        setSaving(true); setMsg(null);
        try {
            await api.post(`/attendance/employees/from-user/${user.userId}`, { area, cedula: cedula || undefined });
            setMsg({ type:'ok', text:'Empleado registrado en el kiosko' });
            setTimeout(onSaved, 1200);
        } catch(e) {
            setMsg({ type:'err', text: e.response?.data?.error ?? 'Error al crear registro' });
        } finally { setSaving(false); }
    };

    return (
        <Card className="p-5 space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-2xl flex-shrink-0">⚠️</div>
                <div>
                    <h3 className="font-bold text-neutral-900">{user.name}</h3>
                    <p className="text-sm text-neutral-400">{user.role}</p>
                    <Badge className="bg-amber-100 text-amber-700 mt-1">Pendiente · Sin turno asignado</Badge>
                </div>
            </div>

            <p className="text-xs text-neutral-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Este usuario existe en gestionpbi pero no tiene registro en el kiosko de ingreso. Asígnale un área para activarlo.
            </p>

            {msg && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${msg.type==='ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {msg.type==='ok' ? <CheckCircle2 size={14}/> : <XCircle size={14}/>}
                    {msg.text}
                </div>
            )}

            <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Área de trabajo</label>
                <select
                    className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                    value={area}
                    onChange={e => setArea(e.target.value)}
                >
                    <option value="">Seleccionar área...</option>
                    {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
            </div>

            <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                    <Hash size={11} className="inline mr-1"/>Cédula (opcional)
                </label>
                <input
                    className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                    placeholder="Número de cédula"
                    value={cedula}
                    onChange={e => setCedula(e.target.value)}
                    type="number"
                />
            </div>

            <div className="flex gap-2 pt-1">
                <button
                    onClick={onCancel}
                    className="flex-1 py-2 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                >
                    Cancelar
                </button>
                <button
                    onClick={handleCreate}
                    disabled={saving || !area}
                    className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                    {saving ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
                    Activar en kiosko
                </button>
            </div>
        </Card>
    );
}

function EmployeePanel({ employee, enrolling, setEnrolling, onSaved }) {
    const [cedula, setCedula] = useState(employee.cedula ?? '');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]       = useState(null); // { type: 'ok'|'err', text }

    // Guarda: no debería llegarse aquí con id=null (eso va a PendingUserPanel)
    if (!employee.id) {
        return (
            <Card className="p-8 flex flex-col items-center justify-center text-center text-amber-600 min-h-48 gap-3">
                <AlertCircle size={28} className="opacity-60" />
                <p className="text-sm font-medium">Este empleado aún no tiene registro en el kiosko.<br/>Usa "Activar en kiosko" primero.</p>
            </Card>
        );
    }

    const saveCedula = async () => {
        if (!cedula.trim()) return;
        setSaving(true); setMsg(null);
        try {
            await api.put(`/attendance/employees/${employee.id}/cedula`, { cedula: cedula.trim() });
            setMsg({ type:'ok', text:'Cédula guardada correctamente' });
            setTimeout(onSaved, 1200);
        } catch(e) {
            setMsg({ type:'err', text: e.response?.data?.error ?? 'Error al guardar' });
        } finally { setSaving(false); }
    };

    return (
        <Card className="p-5 space-y-5">
            {/* Header empleado */}
            <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center overflow-hidden">
                    {employee.photoUrl
                        ? <img src={employee.photoUrl} alt={employee.name} className="w-full h-full object-cover" />
                        : <span className="text-2xl">👤</span>}
                </div>
                <div>
                    <h3 className="font-bold text-neutral-900">{employee.name}</h3>
                    <p className="text-sm text-neutral-400">{employee.area} · {employee.role}</p>
                    {employee.hasFace
                        ? <Badge className="bg-violet-50 text-violet-600 mt-1"><Fingerprint size={11}/> Rostro enrollado</Badge>
                        : <Badge className="bg-amber-50 text-amber-600 mt-1"><AlertCircle size={11}/> Sin rostro</Badge>
                    }
                </div>
            </div>

            {msg && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${msg.type==='ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {msg.type==='ok' ? <CheckCircle2 size={14}/> : <XCircle size={14}/>}
                    {msg.text}
                </div>
            )}

            {/* Cédula */}
            <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                    <Hash size={11} className="inline mr-1"/>Cédula (para identificación en kiosko)
                </label>
                <div className="flex gap-2">
                    <input
                        className="flex-1 px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                        placeholder="Número de cédula"
                        value={cedula}
                        onChange={e => setCedula(e.target.value)}
                        type="number"
                    />
                    <button
                        onClick={saveCedula}
                        disabled={saving}
                        className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                        Guardar
                    </button>
                </div>
            </div>

            {/* Enrollment facial */}
            <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                    <Fingerprint size={11} className="inline mr-1"/>Reconocimiento facial
                </label>
                {enrolling
                    ? <FaceEnroller employeeId={employee.id} onDone={onSaved} onCancel={() => setEnrolling(false)} />
                    : <button
                        onClick={() => setEnrolling(true)}
                        className="w-full py-3 border-2 border-dashed border-violet-300 rounded-xl text-sm font-semibold text-violet-600 hover:bg-violet-50 transition-colors flex items-center justify-center gap-2"
                    >
                        <Camera size={16}/>
                        {employee.hasFace ? 'Actualizar descriptor facial' : 'Enrollar rostro'}
                    </button>
                }
            </div>
        </Card>
    );
}

// ── Componente de enrollment facial ─────────────────────────────────────────
// Helpers para cargar face-api.js dinámicamente (no se asume preinstalada).
function loadFaceApiScriptAttendance() {
    return new Promise((resolve, reject) => {
        if (window.faceapi) return resolve(window.faceapi);
        const existing = document.getElementById('face-api-script');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.faceapi));
            existing.addEventListener('error', () => reject(new Error('Falló carga de face-api.js')));
            return;
        }
        const s = document.createElement('script');
        s.id = 'face-api-script';
        s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
        s.onload = () => resolve(window.faceapi);
        s.onerror = () => reject(new Error('Falló carga de face-api.js (verifica internet)'));
        document.head.appendChild(s);
    });
}

function FaceEnroller({ employeeId, onDone, onCancel }) {
    const videoRef  = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [status, setStatus] = useState('Cargando librería de reconocimiento...');
    const [phase, setPhase]   = useState('loading'); // loading | scanning | captured | saving
    const [descriptor, setDescriptor] = useState(null);
    const [photoDataUrl, setPhotoDataUrl] = useState(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // 1) Asegurar que face-api.js está cargada en window
                await loadFaceApiScriptAttendance();
                if (cancelled) return;
                if (!window.faceapi) throw new Error('face-api.js no disponible');

                // 2) Cargar modelos (con fallback si CDN principal falla)
                setStatus('Cargando modelos de IA...');
                const CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
                const FALLBACK = 'https://raw.githubusercontent.com/nicolo-ribaudo/face-api.js-models/refs/heads/master/';
                const needsLoad = !window.faceapi.nets.tinyFaceDetector.params;
                if (needsLoad) {
                    try {
                        await Promise.all([
                            window.faceapi.nets.tinyFaceDetector.loadFromUri(CDN),
                            window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(CDN),
                            window.faceapi.nets.faceRecognitionNet.loadFromUri(CDN),
                        ]);
                    } catch {
                        await Promise.all([
                            window.faceapi.nets.tinyFaceDetector.loadFromUri(FALLBACK),
                            window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(FALLBACK),
                            window.faceapi.nets.faceRecognitionNet.loadFromUri(FALLBACK),
                        ]);
                    }
                }
                if (cancelled) return;

                // 3) Activar cámara
                setStatus('Activando cámara...');
                const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:{ideal:640}, height:{ideal:480} } });
                streamRef.current = stream;
                videoRef.current.srcObject = stream;
                await new Promise(r => { videoRef.current.onloadedmetadata = () => videoRef.current.play().then(r).catch(r); setTimeout(r,3000); });
                if (cancelled) return;
                setStatus('Busque su rostro en la cámara...');
                setPhase('scanning');
                startDetection();
            } catch(e) {
                setStatus('Error: ' + (e.message || 'No se pudo acceder a la cámara'));
            }
        })();
        return () => { cancelled=true; stopAll(); };
    }, []);

    function stopAll() {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    }

    function startDetection() {
        let detecting = false;
        let goodFrames = 0;
        intervalRef.current = setInterval(async () => {
            if (detecting || !videoRef.current) return;
            detecting = true;
            try {
                const det = await window.faceapi
                    .detectSingleFace(videoRef.current, new window.faceapi.TinyFaceDetectorOptions({ inputSize:224, scoreThreshold:0.5 }))
                    .withFaceLandmarks(true)
                    .withFaceDescriptor();
                if (!det) { goodFrames=0; setStatus('No se detecta rostro. Mire a la cámara.'); return; }
                const ratio = (det.detection.box.width * det.detection.box.height) / (videoRef.current.videoWidth * videoRef.current.videoHeight);
                if (ratio < 0.08) { setStatus('⚠️ Acérquese más a la cámara'); goodFrames=0; return; }
                goodFrames++;
                setStatus(`Rostro detectado — ${goodFrames >= 3 ? 'capturando...' : `estabilizando (${goodFrames}/3)...`}`);
                if (goodFrames >= 3) {
                    clearInterval(intervalRef.current);
                    // Capturar foto
                    const cv = canvasRef.current;
                    cv.width = videoRef.current.videoWidth;
                    cv.height = videoRef.current.videoHeight;
                    cv.getContext('2d').drawImage(videoRef.current, 0, 0);
                    setPhotoDataUrl(cv.toDataURL('image/jpeg', 0.85));
                    setDescriptor(Array.from(det.descriptor));
                    setPhase('captured');
                    setStatus('¡Rostro capturado! Confirme para guardar.');
                    stopAll();
                }
            } catch { /* ignore */ }
            finally { detecting=false; }
        }, 400);
    }

    const save = async () => {
        setPhase('saving');
        setStatus('Guardando descriptor...');
        try {
            await api.put(`/attendance/employees/${employeeId}/face`, {
                descriptor,
                photoUrl: photoDataUrl,
            });
            setStatus('✅ Rostro enrollado correctamente');
            setTimeout(onDone, 1000);
        } catch(e) {
            setStatus('Error: ' + (e.response?.data?.error ?? 'No se pudo guardar'));
            setPhase('captured');
        }
    };

    return (
        <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                <canvas ref={canvasRef} className="hidden" />
                {phase === 'captured' && photoDataUrl && (
                    <img src={photoDataUrl} alt="capture" className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
                )}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full text-center max-w-[90%]">
                    {status}
                </div>
            </div>
            <div className="flex gap-2">
                {phase === 'captured' && (
                    <button onClick={save} className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 flex items-center justify-center gap-1">
                        <Save size={14}/> Confirmar y guardar
                    </button>
                )}
                {phase === 'saving' && <div className="flex-1 flex justify-center py-2"><Spinner/></div>}
                <button onClick={() => { stopAll(); onCancel(); }} className="py-2.5 px-4 border border-neutral-200 rounded-xl text-sm text-neutral-500 hover:bg-neutral-50">
                    Cancelar
                </button>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 3 — HISTORIAL
// ══════════════════════════════════════════════════════════════════════════════
function TabHistory() {
    const [records, setRecords]   = useState([]);
    const [total, setTotal]       = useState(0);
    const [page, setPage]         = useState(1);
    const [loading, setLoading]   = useState(true);
    const [from, setFrom]         = useState(todayISO());
    const [to, setTo]             = useState(todayISO());
    const [typeFilter, setType]   = useState('');
    const [employeeId, setEmployeeId] = useState('');
    const [employees, setEmployees]   = useState([]);

    useEffect(() => {
        api.get('/attendance/employees').then(r => setEmployees(r.data || [])).catch(() => {});
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/attendance/history', { params: { from, to, type: typeFilter||undefined, employeeId: employeeId||undefined, page, limit:50 } });
            setRecords(r.data.records);
            setTotal(r.data.total);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [from, to, typeFilter, employeeId, page]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            {/* Filtros */}
            <Card className="p-4">
                <div className="flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Desde</label>
                        <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                    </div>
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
                        <input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                    </div>
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Tipo</label>
                        <select value={typeFilter} onChange={e=>{setType(e.target.value);setPage(1);}}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300">
                            <option value="">Todos</option>
                            <option value="ENTRY">Entradas</option>
                            <option value="EXIT">Salidas</option>
                        </select>
                    </div>
                    <div className="min-w-[220px]">
                        <label className="block text-xs text-neutral-500 mb-1">Empleado</label>
                        <select value={employeeId} onChange={e=>{setEmployeeId(e.target.value);setPage(1);}}
                            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300">
                            <option value="">Todos</option>
                            {employees.filter(e => !e.pending).map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.area})</option>
                            ))}
                        </select>
                    </div>
                    <button onClick={load} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 flex items-center gap-1">
                        <Filter size={14}/> Filtrar
                    </button>
                    <span className="text-sm text-neutral-400 ml-auto">{total} registros</span>
                </div>
            </Card>

            {/* Tabla */}
            <Card className="overflow-hidden">
                {loading
                    ? <div className="flex justify-center py-12"><Spinner /></div>
                    : <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 border-b border-neutral-200">
                                <tr>
                                    {['Empleado','Área','Tipo','Subtipo','Hora','Verificado','Fuente'].map(h=>(
                                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-neutral-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {records.map(r => {
                                    const T  = TYPE_LABELS[r.type] ?? TYPE_LABELS.ENTRY;
                                    const TI = T.icon;
                                    const S  = r.subtype ? SUBTYPE_LABELS[r.subtype] : null;
                                    return (
                                        <tr key={r.id} className="hover:bg-neutral-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-neutral-800">{r.employee?.name ?? '—'}</td>
                                            <td className="px-4 py-3 text-neutral-500">{r.employee?.area ?? '—'}</td>
                                            <td className="px-4 py-3">
                                                <Badge className={`${T.bg} ${T.color}`}>
                                                    <TI size={11}/>{T.label}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3">
                                                {S ? <span className={`text-xs font-medium ${S.color}`}>{S.label}</span> : <span className="text-neutral-300">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{fmt(r.timestamp)}</td>
                                            <td className="px-4 py-3">
                                                {r.verified
                                                    ? <CheckCircle2 size={16} className="text-emerald-500"/>
                                                    : <XCircle size={16} className="text-neutral-300"/>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge className={r.source==='KIOSK' ? 'bg-blue-50 text-blue-600' : 'bg-neutral-100 text-neutral-500'}>
                                                    {r.source}
                                                </Badge>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {records.length === 0 && (
                                    <tr><td colSpan={7} className="text-center text-neutral-400 py-12">Sin registros en el rango seleccionado</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                }
                {/* Paginación */}
                {total > 50 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200">
                        <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-neutral-50">← Anterior</button>
                        <span className="text-sm text-neutral-500">Página {page} de {Math.ceil(total/50)}</span>
                        <button onClick={()=>setPage(p=>p+1)} disabled={page>=Math.ceil(total/50)}
                            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-neutral-50">Siguiente →</button>
                    </div>
                )}
            </Card>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 4 — REPORTES
// ══════════════════════════════════════════════════════════════════════════════
function TabReports() {
    const [activeReport, setActiveReport] = useState('hours');
    const [from, setFrom] = useState(monthStart());
    const [to, setTo]     = useState(todayISO());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [employees, setEmployees] = useState([]);
    const [empId, setEmpId] = useState('');

    useEffect(() => {
        api.get('/attendance/employees').then(r => setEmployees(r.data)).catch(()=>{});
    }, []);

    const run = async () => {
        setLoading(true); setData(null);
        try {
            if (activeReport === 'hours') {
                if (!empId) return;
                const r = await api.get(`/attendance/hours/${empId}`, { params:{ from, to } });
                setData(r.data);
            } else if (activeReport === 'punctuality') {
                const r = await api.get('/attendance/punctuality', { params:{ from, to } });
                setData(r.data);
            } else {
                const r = await api.get('/attendance/overtime', { params:{ from, to } });
                setData(r.data);
            }
        } catch { /* ignore */ }
        finally { setLoading(false); }
    };

    return (
        <div className="space-y-5">
            {/* Selector de reporte */}
            <Card className="p-4">
                <div className="flex flex-wrap gap-2 mb-4">
                    {[
                        { id:'hours',       label:'Horas trabajadas', icon: Timer },
                        { id:'punctuality', label:'Puntualidad',      icon: CheckCircle2 },
                        { id:'overtime',    label:'Horas extra',      icon: TrendingUp },
                    ].map(r => (
                        <button key={r.id} onClick={()=>{setActiveReport(r.id);setData(null);}}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeReport===r.id ? 'bg-primary-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
                            <r.icon size={14}/>{r.label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Desde</label>
                        <input type="date" value={from} onChange={e=>setFrom(e.target.value)}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                    </div>
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
                        <input type="date" value={to} onChange={e=>setTo(e.target.value)}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                    </div>
                    {activeReport === 'hours' && (
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Empleado</label>
                            <select value={empId} onChange={e=>setEmpId(e.target.value)}
                                className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 min-w-[180px]">
                                <option value="">Seleccione...</option>
                                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                        </div>
                    )}
                    <button onClick={run} disabled={loading || (activeReport==='hours' && !empId)}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1">
                        {loading ? <Loader2 size={14} className="animate-spin"/> : <BarChart2 size={14}/>}
                        Generar
                    </button>
                </div>
            </Card>

            {/* Resultado */}
            {loading && <div className="flex justify-center py-12"><Spinner /></div>}

            {data && activeReport === 'hours' && (
                <Card className="p-6">
                    <h3 className="font-bold text-neutral-800 mb-4">{data.employee?.name}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiCard label="Horas brutas" value={`${data.totalHours}h`} icon={Timer} color="text-blue-600" />
                        <KpiCard label="Descansos" value={`${data.breakHours}h`} icon={Coffee} color="text-amber-600" />
                        <KpiCard label="Horas netas" value={`${data.netHours}h`} icon={CheckCircle2} color="text-emerald-600" />
                        <KpiCard label="Turno OFICINA" value={data.isOfficeShift ? 'Sí' : 'No'} icon={Building2} color="text-neutral-500"
                            sub={data.isOfficeShift ? 'Descansos descontados' : 'Sin descuento'} />
                    </div>
                </Card>
            )}

            {data && activeReport === 'punctuality' && (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 border-b">
                                <tr>
                                    {['Empleado','Área','Días','Tardanzas','% Tardanza','Prom. min tarde'].map(h=>(
                                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-neutral-500 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {(data.report ?? []).sort((a,b)=>b.lateRate-a.lateRate).map(row => (
                                    <tr key={row.employee.id} className="hover:bg-neutral-50">
                                        <td className="px-4 py-3 font-medium">{row.employee.name}</td>
                                        <td className="px-4 py-3 text-neutral-500">{row.employee.area}</td>
                                        <td className="px-4 py-3">{row.totalDays}</td>
                                        <td className="px-4 py-3">
                                            <span className={row.lateDays>0 ? 'text-red-600 font-bold' : 'text-neutral-400'}>{row.lateDays}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden max-w-[80px]">
                                                    <div className={`h-full rounded-full ${row.lateRate>30?'bg-red-500':row.lateRate>10?'bg-amber-500':'bg-emerald-500'}`}
                                                        style={{width:`${Math.min(row.lateRate,100)}%`}}/>
                                                </div>
                                                <span className={`text-xs font-semibold ${row.lateRate>30?'text-red-600':row.lateRate>10?'text-amber-600':'text-emerald-600'}`}>
                                                    {row.lateRate}%
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-neutral-600">{row.avgLateMin > 0 ? `${row.avgLateMin} min` : '—'}</td>
                                    </tr>
                                ))}
                                {(data.report??[]).length===0 && <tr><td colSpan={6} className="text-center text-neutral-400 py-10">Sin datos</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {data && activeReport === 'overtime' && (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 border-b">
                                <tr>
                                    {['Empleado','Área','Turno','Hrs esperadas','Hrs trabajadas','Hrs extra'].map(h=>(
                                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-neutral-500 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {(data.report??[]).sort((a,b)=>b.overtimeHours-a.overtimeHours).map(row => (
                                    <tr key={row.employee.id} className="hover:bg-neutral-50">
                                        <td className="px-4 py-3 font-medium">{row.employee.name}</td>
                                        <td className="px-4 py-3 text-neutral-500">{row.employee.area}</td>
                                        <td className="px-4 py-3"><Badge className="bg-neutral-100 text-neutral-600">{row.shiftCode}</Badge></td>
                                        <td className="px-4 py-3 text-neutral-600">{row.expectedHours}h</td>
                                        <td className="px-4 py-3 text-neutral-600">{row.workedHours}h</td>
                                        <td className="px-4 py-3">
                                            {row.overtimeHours > 0
                                                ? <span className="font-bold text-amber-600 flex items-center gap-1"><TrendingUp size={13}/>{row.overtimeHours}h</span>
                                                : <span className="text-neutral-300">—</span>}
                                        </td>
                                    </tr>
                                ))}
                                {(data.report??[]).length===0 && <tr><td colSpan={6} className="text-center text-neutral-400 py-10">Sin datos</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 5 — TURNOS (definición de horarios)
// ══════════════════════════════════════════════════════════════════════════════
function TabShifts() {
    const [defs, setDefs]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [form, setForm]     = useState({});
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]       = useState(null);

    const load = async () => {
        setLoading(true);
        try { const r = await api.get('/attendance/shift-definitions'); setDefs(r.data); }
        catch { /* ignore */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const startEdit = (def) => { setEditing(def.id); setForm({ ...def }); setMsg(null); };
    const cancelEdit = () => { setEditing(null); setForm({}); };

    const save = async () => {
        setSaving(true); setMsg(null);
        try {
            await api.put(`/attendance/shift-definitions/${editing}`, form);
            setMsg({ type:'ok', text:'Turno actualizado' });
            setEditing(null);
            load();
        } catch(e) {
            setMsg({ type:'err', text: e.response?.data?.error ?? 'Error al guardar' });
        } finally { setSaving(false); }
    };

    const shiftIcons = { OFICINA:'🏢', MANANA:'🌅', TARDE:'☀️', NOCHE:'🌙' };

    if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

    return (
        <div className="space-y-4">
            {msg && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${msg.type==='ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {msg.type==='ok' ? <CheckCircle2 size={14}/> : <XCircle size={14}/>}
                    {msg.text}
                </div>
            )}
            {defs.map(def => (
                <Card key={def.id} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">{shiftIcons[def.code] ?? '⏱️'}</span>
                            <div>
                                <h3 className="font-bold text-neutral-800">{def.name}</h3>
                                <p className="text-xs text-neutral-400 font-mono">{def.code}</p>
                            </div>
                        </div>
                        {editing !== def.id
                            ? <button onClick={()=>startEdit(def)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50">
                                <Edit2 size={13}/> Editar
                              </button>
                            : <div className="flex gap-2">
                                <button onClick={save} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                                    {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>} Guardar
                                </button>
                                <button onClick={cancelEdit} className="px-3 py-1.5 text-sm border rounded-lg text-neutral-500 hover:bg-neutral-50">Cancelar</button>
                              </div>
                        }
                    </div>

                    {editing === def.id
                        ? <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                                ['weekdayStart','Inicio Lun–Vie'],['weekdayEnd','Fin Lun–Vie'],
                                ['saturdayStart','Inicio Sábado'],['saturdayEnd','Fin Sábado'],
                                ['sundayStart','Inicio Domingo'],['sundayEnd','Fin Domingo'],
                            ].map(([key, label]) => (
                                <div key={key}>
                                    <label className="block text-xs text-neutral-500 mb-1">{label}</label>
                                    <input type="time" value={form[key] ?? ''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                                </div>
                            ))}
                            <div className="flex items-center gap-2 col-span-full">
                                <input type="checkbox" id={`midnight-${def.id}`} checked={!!form.crossesMidnight}
                                    onChange={e=>setForm(f=>({...f,crossesMidnight:e.target.checked}))}
                                    className="rounded"/>
                                <label htmlFor={`midnight-${def.id}`} className="text-sm text-neutral-600">Cruza medianoche (turno nocturno)</label>
                            </div>
                          </div>
                        : <div className="grid grid-cols-3 gap-3 text-sm">
                            <div className="bg-neutral-50 rounded-xl p-3">
                                <p className="text-xs text-neutral-400 mb-1">Lun – Vie</p>
                                <p className="font-semibold text-neutral-700">{def.weekdayStart} – {def.weekdayEnd}</p>
                            </div>
                            <div className="bg-neutral-50 rounded-xl p-3">
                                <p className="text-xs text-neutral-400 mb-1">Sábado</p>
                                <p className="font-semibold text-neutral-700">{def.saturdayStart ? `${def.saturdayStart} – ${def.saturdayEnd}` : '—'}</p>
                            </div>
                            <div className="bg-neutral-50 rounded-xl p-3">
                                <p className="text-xs text-neutral-400 mb-1">Domingo</p>
                                <p className="font-semibold text-neutral-700">{def.sundayStart ? `${def.sundayStart} – ${def.sundayEnd}` : '—'}</p>
                            </div>
                            {def.crossesMidnight && (
                                <div className="col-span-3">
                                    <Badge className="bg-violet-50 text-violet-600"><Moon size={11}/> Cruza medianoche</Badge>
                                </div>
                            )}
                          </div>
                    }
                </Card>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB 6 — VIGILANCIA (YOLOv8 door monitor)
// ══════════════════════════════════════════════════════════════════════════════
function TabSurveillance() {
    const [summary, setSummary]   = useState(null);
    const [recent,  setRecent]    = useState([]);
    const [hourly,  setHourly]    = useState([]);
    const [date,    setDate]      = useState(todayISO());
    const [loading, setLoading]   = useState(true);
    const [snapshot, setSnapshot] = useState(null); // URL para lightbox

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [sumR, recR, hourR] = await Promise.all([
                api.get('/attendance/door-crossings/summary'),
                api.get('/attendance/door-crossings/recent', { params: { limit: 40 } }),
                api.get('/attendance/door-crossings', { params: { date } }),
            ]);
            setSummary(sumR.data);
            setRecent(recR.data);
            setHourly(hourR.data.crossings || []);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [date]);

    useEffect(() => { load(); }, [load]);

    const discrepancy = summary ? parseInt(summary.discrepancy || 0) : 0;
    const discColor   = discrepancy > 3 ? 'text-red-600 bg-red-50' : discrepancy > 0 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';

    // Agrupar cruces horarios para mostrar
    const hourMap = {};
    hourly.forEach(row => {
        const h = new Date(row.hour).toLocaleTimeString('es-CO', { timeZone:'America/Bogota', hour:'2-digit', minute:'2-digit', hour12:true });
        if (!hourMap[h]) hourMap[h] = { EXIT_PRODUCTION: 0, ENTER_PRODUCTION: 0 };
        hourMap[h][row.direction] = parseInt(row.crossings);
    });

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Salidas de producción hoy"   value={summary?.exits_today ?? '—'}    icon={ArrowRight}       color="text-amber-600" />
                <KpiCard label="Entradas a producción hoy"   value={summary?.entries_today ?? '—'}  icon={ArrowLeft}        color="text-emerald-600" />
                <KpiCard label="Descansos registrados kiosko" value={summary?.kiosk_breaks_today ?? '—'} icon={Coffee}      color="text-blue-600" />
                <KpiCard
                    label="Discrepancia"
                    value={discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                    icon={AlertCircle}
                    color={discrepancy > 3 ? 'text-red-600' : discrepancy > 0 ? 'text-amber-600' : 'text-emerald-600'}
                    sub="cruces sin registrar en kiosko"
                />
            </div>

            {discrepancy > 2 && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5"/>
                    <div>
                        <p className="font-bold">Alerta de discrepancia</p>
                        <p>Se detectaron <strong>{summary.exits_today}</strong> salidas físicas de producción pero solo <strong>{summary.kiosk_breaks_today}</strong> descansos registrados en el kiosko hoy. Diferencia: <strong>{discrepancy} cruce(s)</strong> sin registrar.</p>
                    </div>
                </div>
            )}

            {/* Selector de fecha + refresh */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <Calendar size={15} className="text-neutral-400"/>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"/>
                </div>
                <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/> Actualizar
                </button>
                <span className="text-xs text-neutral-400 ml-auto">Actualización cada 2 s desde la tablet · YOLOv8n</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Tabla horaria */}
                <Card className="overflow-hidden">
                    <div className="p-4 border-b border-neutral-100">
                        <h3 className="font-semibold text-neutral-800 flex items-center gap-2">
                            <ArrowRightLeft size={16} className="text-primary-500"/> Cruces por hora — {date}
                        </h3>
                    </div>
                    {Object.keys(hourMap).length === 0
                        ? <p className="text-center text-neutral-400 py-10 text-sm">Sin datos para esta fecha</p>
                        : <div className="overflow-auto max-h-80">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50 text-xs text-neutral-500 uppercase">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Hora</th>
                                        <th className="px-4 py-2 text-center text-amber-600">Sale producción</th>
                                        <th className="px-4 py-2 text-center text-emerald-600">Entra producción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {Object.entries(hourMap).map(([h, v]) => (
                                        <tr key={h} className="hover:bg-neutral-50">
                                            <td className="px-4 py-2.5 font-medium text-neutral-700">{h}</td>
                                            <td className="px-4 py-2.5 text-center">
                                                {v.EXIT_PRODUCTION > 0
                                                    ? <Badge className="bg-amber-50 text-amber-700">{v.EXIT_PRODUCTION}</Badge>
                                                    : <span className="text-neutral-300">—</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-center">
                                                {v.ENTER_PRODUCTION > 0
                                                    ? <Badge className="bg-emerald-50 text-emerald-700">{v.ENTER_PRODUCTION}</Badge>
                                                    : <span className="text-neutral-300">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                          </div>
                    }
                </Card>

                {/* Últimos eventos */}
                <Card className="overflow-hidden">
                    <div className="p-4 border-b border-neutral-100">
                        <h3 className="font-semibold text-neutral-800 flex items-center gap-2">
                            <Eye size={16} className="text-primary-500"/> Últimos cruces detectados
                        </h3>
                    </div>
                    {loading
                        ? <div className="flex justify-center py-8"><Spinner/></div>
                        : <div className="overflow-auto max-h-80 divide-y divide-neutral-100">
                            {recent.length === 0 && <p className="text-center text-neutral-400 py-10 text-sm">Sin datos aún</p>}
                            {recent.map(ev => {
                                const isExit = ev.direction === 'EXIT_PRODUCTION';
                                return (
                                    <div key={ev.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50">
                                        <div className={`p-1.5 rounded-lg flex-shrink-0 ${isExit ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                                            {isExit ? <ArrowRight size={14} className="text-amber-600"/> : <ArrowLeft size={14} className="text-emerald-600"/>}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-semibold ${isExit ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                {isExit ? 'Sale de producción' : 'Entra a producción'}
                                            </p>
                                            <p className="text-xs text-neutral-400">{fmt(ev.created_at)} · conf. {(ev.confidence * 100).toFixed(0)}%</p>
                                        </div>
                                        {ev.snapshot_path && (
                                            <button onClick={() => setSnapshot(ev.snapshot_path)} title="Ver foto"
                                                className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 flex-shrink-0">
                                                <Image size={14}/>
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                          </div>
                    }
                </Card>
            </div>

            {/* Lightbox snapshot */}
            {snapshot && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSnapshot(null)}>
                    <div className="relative max-w-2xl w-full">
                        <img src={snapshot} alt="Snapshot cruce" className="w-full rounded-xl shadow-2xl" />
                        <button onClick={() => setSnapshot(null)} className="absolute top-3 right-3 bg-white/20 hover:bg-white/30 text-white rounded-full p-2">
                            <XCircle size={20}/>
                        </button>
                        <p className="text-white/60 text-xs text-center mt-2">Frame capturado por YOLOv8 · Clic para cerrar</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PÁGINA PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function AttendancePage() {
    const [tab, setTab] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const initial = params.get('tab');
        return TABS.some(t => t.id === initial) ? initial : 'dashboard';
    });

    // Cargar face-api.js si no está cargado (necesario para FaceEnroller)
    useEffect(() => {
        if (window.faceapi) return;
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
        s.defer = true;
        document.head.appendChild(s);
    }, []);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
                        <Building2 className="text-primary-600" size={24}/> Control de Ingreso
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">Gestión de asistencia y presencia en planta</p>
                </div>
                <a href="/kiosko" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors">
                    <Camera size={15}/> Abrir Kiosko
                </a>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl w-fit">
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab===t.id ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}>
                        <t.icon size={14}/>{t.label}
                    </button>
                ))}
            </div>

            {/* Contenido del tab activo */}
            {tab === 'dashboard'  && <TabDashboard />}
            {tab === 'employees'  && <TabEmployees />}
            {tab === 'operation'  && <LaborManagementPage />}
            {tab === 'history'    && <TabHistory />}
            {tab === 'reports'    && <TabReports />}
            {tab === 'shifts'       && <TabShifts />}
            {tab === 'surveillance' && <TabSurveillance />}
        </div>
    );
}
