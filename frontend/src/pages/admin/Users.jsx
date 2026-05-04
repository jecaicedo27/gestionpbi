import { useState, useEffect } from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import api from '../../services/api';
import { Trash2, UserPlus, Pencil, Check, X, Settings, LockKeyhole, Unlock, Sparkles } from 'lucide-react';

const ID_TYPES = [
    { id: '13', label: 'NIT' },
    { id: '12', label: 'Cédula' },
    { id: '11', label: 'Reg. Civil' },
];

const SHIFT_SYNC_ROLES = ['PRODUCCION', 'OPERARIO_PICKING', 'LOGISTICA'];
const SHIFT_AREA_OPTIONS = [
    { value: 'PRODUCCION', label: 'Producción' },
    { value: 'SIROPES', label: 'Siropes' },
    { value: 'EMPAQUE', label: 'Empaque' },
    { value: 'LOGISTICA', label: 'Logística' },
    { value: 'ASEO', label: 'Servicios Generales' },
];
const FIXED_SHIFT_AREAS = ['LOGISTICA', 'ASEO'];

const getDefaultShiftArea = (role) => {
    if (role === 'OPERARIO_PICKING') return 'EMPAQUE';
    if (role === 'LOGISTICA') return 'LOGISTICA';
    return 'PRODUCCION';
};

const isFixedShiftArea = (area) => FIXED_SHIFT_AREAS.includes(area);

const getInitialFormData = () => ({
    name: '',
    email: '',
    password: '',
    role: 'DISTRIBUIDOR',
    nit: '',
    idType: '13',
    discountPercent: '34.8',
    reteFuente: true,
    addToShiftSchedule: false,
    shiftArea: 'PRODUCCION',
    shiftEmployeeRole: 'OPERARIO',
    shiftGroupNumber: '',
    shiftIsFixed: false
});

const Users = () => {
    const [users, setUsers] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState(getInitialFormData());
    const [editingNit, setEditingNit] = useState(null); // { userId, value }
    const [editingName, setEditingName] = useState(null); // { userId, value }
    const [editingBilling, setEditingBilling] = useState(null); // { userId, nit, idType, discountPercent }
    const [editingRole, setEditingRole] = useState(null); // { userId, value }
    const [editingCleaning, setEditingCleaning] = useState(null); // { userId, isCleaningStaff, isCleaningSupervisor }
    const [pinModal, setPinModal] = useState(null); // { userId, name }
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const [savedPin, setSavedPin] = useState(null); // Shows assigned PIN after save

    useEffect(() => { loadUsers(); }, []);

    const loadUsers = async () => {
        const res = await api.get('/admin/users');
        setUsers(res.data.data);
    };

    const handleRoleChange = (role) => {
        const canSyncToShifts = SHIFT_SYNC_ROLES.includes(role);
        const nextShiftArea = canSyncToShifts ? getDefaultShiftArea(role) : 'PRODUCCION';
        setFormData(prev => ({
            ...prev,
            role,
            addToShiftSchedule: canSyncToShifts ? prev.addToShiftSchedule : false,
            shiftArea: nextShiftArea,
            shiftIsFixed: isFixedShiftArea(nextShiftArea),
            shiftGroupNumber: isFixedShiftArea(nextShiftArea) ? '' : prev.shiftGroupNumber
        }));
    };

    const handleDelete = async (id) => {
        if (confirm('¿Eliminar usuario?')) {
            await api.delete(`/admin/users/${id}`);
            loadUsers();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.post('/admin/users', {
                ...formData,
                discountPercent: parseFloat(formData.discountPercent) || 34.8
            });
            setShowModal(false);
            loadUsers();
            setFormData(getInitialFormData());
        } catch (error) {
            alert(error.response?.data?.error || 'Error creando usuario');
        }
    };

    const handleSaveNit = async (userId) => {
        try {
            await api.patch(`/admin/users/${userId}`, { nit: editingNit.value });
            setEditingNit(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando NIT');
        }
    };

    const handleSaveName = async (userId) => {
        try {
            await api.patch(`/admin/users/${userId}`, { name: editingName.value });
            setEditingName(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando Nombre');
        }
    };

    const handleSaveRole = async (userId, newRole) => {
        try {
            await api.patch(`/admin/users/${userId}`, { role: newRole });
            setEditingRole(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando rol');
        }
    };

    const handleSaveCleaning = async () => {
        if (!editingCleaning) return;
        try {
            await api.patch(`/admin/users/${editingCleaning.userId}`, {
                isCleaningStaff: editingCleaning.isCleaningStaff,
                isCleaningSupervisor: editingCleaning.isCleaningSupervisor,
            });
            setEditingCleaning(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando configuración de aseo');
        }
    };

    const handleSaveBilling = async () => {
        try {
            await api.patch(`/admin/users/${editingBilling.userId}`, {
                nit: editingBilling.nit,
                idType: editingBilling.idType,
                discountPercent: parseFloat(editingBilling.discountPercent) || 34.8,
                reteFuente: editingBilling.reteFuente
            });
            setEditingBilling(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando datos de facturación');
        }
    };

    // ── PIN Management ──────────────────────────────────────
    const handleSetPin = async () => {
        if (!/^\d{4}$/.test(pinInput)) {
            setPinError('Debe ser exactamente 4 dígitos');
            return;
        }
        setPinLoading(true);
        setPinError('');
        try {
            await api.post('/auth/set-pin', { pin: pinInput, userId: pinModal.userId });
            setSavedPin({ pin: pinInput, name: pinModal.name });
            setPinInput('');
            loadUsers();
        } catch (error) {
            setPinError(error.response?.data?.error || 'Error al establecer PIN');
        }
        setPinLoading(false);
    };

    const handleRemovePin = async (userId) => {
        if (!confirm('¿Eliminar PIN de este usuario?')) return;
        try {
            await api.delete(`/auth/remove-pin/${userId}`);
            loadUsers();
        } catch (error) {
            alert('Error eliminando PIN');
        }
    };

    const generateRandomPin = () => {
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        setPinInput(pin);
        setPinError('');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Administración de Usuarios</h1>
                <Button onClick={() => setShowModal(true)} icon={UserPlus}>Nuevo Usuario</Button>
            </div>

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b">
                                <th className="p-3">Nombre</th>
                                <th className="p-3">Email</th>
                                <th className="p-3">Rol</th>
                                <th className="p-3">PIN</th>
                                <th className="p-3">NIT / Cédula</th>
                                <th className="p-3">Tipo Doc</th>
                                <th className="p-3">Descuento %</th>
                                <th className="p-3">ReteFuente</th>
                                <th className="p-3">Fecha Registro</th>
                                <th className="p-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b hover:bg-neutral-50 group">
                                    {/* Edit Name */}
                                    <td className="p-3">
                                        {editingName?.userId === user.id ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    className="w-full px-2 py-1 border rounded text-sm font-medium"
                                                    value={editingName.value}
                                                    onChange={e => setEditingName({ ...editingName, value: e.target.value })}
                                                    placeholder="Nombre"
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleSaveName(user.id);
                                                        if (e.key === 'Escape') setEditingName(null);
                                                    }}
                                                />
                                                <button onClick={() => handleSaveName(user.id)} className="text-green-600 hover:bg-green-50 p-1 rounded"><Check size={16} /></button>
                                                <button onClick={() => setEditingName(null)} className="text-red-600 hover:bg-red-50 p-1 rounded"><X size={16} /></button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1">
                                                <span className="font-medium">{user.name}</span>
                                                <button
                                                    onClick={() => setEditingName({ userId: user.id, value: user.name || '' })}
                                                    className="text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-purple-600 hover:bg-purple-50 p-1 rounded"
                                                    title="Editar Nombre"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3 text-neutral-600">{user.email}</td>
                                    <td className="p-3">
                                        {editingRole?.userId === user.id ? (
                                            <select
                                                className="px-2 py-1 border-2 border-indigo-400 rounded text-xs font-semibold bg-white focus:outline-none"
                                                value={editingRole.value}
                                                onChange={e => {
                                                    const newRole = e.target.value;
                                                    setEditingRole({ ...editingRole, value: newRole });
                                                    handleSaveRole(user.id, newRole);
                                                }}
                                                onBlur={() => setEditingRole(null)}
                                                autoFocus
                                            >
                                                <option value="ADMIN">Administrador</option>
                                                <option value="LOGISTICA">Logística</option>
                                                <option value="OPERARIO_PICKING">Operario Picking</option>
                                                <option value="PRODUCCION">Producción</option>
                                                <option value="CARTERA">Cartera</option>
                                                <option value="DISTRIBUIDOR">Distribuidor</option>
                                                <option value="CALIDAD">Calidad</option>
                                                <option value="CONTABILIDAD">Contabilidad</option>
                                                <option value="COMERCIAL">Comercial</option>
                                                <option value="QUIMICO">Químico</option>
                                                <option value="RECURSOS_HUMANOS">Recursos Humanos</option>
                                            </select>
                                        ) : (
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <button
                                                    onClick={() => setEditingRole({ userId: user.id, value: user.role })}
                                                    className="px-2 py-1 bg-neutral-100 rounded text-xs hover:bg-indigo-100 hover:text-indigo-700 transition-colors cursor-pointer"
                                                    title="Clic para cambiar rol"
                                                >
                                                    {user.role}
                                                </button>
                                                {user.isCleaningStaff && (
                                                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-semibold" title="Personal de aseo">🧹</span>
                                                )}
                                                {user.isCleaningSupervisor && (
                                                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-semibold" title="Supervisor de aseo">👁️</span>
                                                )}
                                                <button
                                                    onClick={() => setEditingCleaning({
                                                        userId: user.id,
                                                        name: user.name,
                                                        isCleaningStaff: !!user.isCleaningStaff,
                                                        isCleaningSupervisor: !!user.isCleaningSupervisor,
                                                    })}
                                                    className={`p-1 rounded transition-opacity ${(user.isCleaningStaff || user.isCleaningSupervisor) ? 'text-emerald-600 hover:bg-emerald-50' : 'text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                                    title="Configurar aseo"
                                                >
                                                    <Sparkles size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    
                                    {/* PIN status */}
                                    <td className="p-3">
                                        {user.role === 'DISTRIBUIDOR' ? (
                                            <span className="text-neutral-300">—</span>
                                        ) : user.hasPin ? (
                                            <div className="flex items-center gap-1">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
                                                    <LockKeyhole size={11} /> Activo
                                                </span>
                                                <button
                                                    onClick={() => { setPinModal({ userId: user.id, name: user.name }); setPinInput(''); setPinError(''); }}
                                                    className="text-neutral-400 hover:text-indigo-600 p-0.5 rounded" title="Cambiar PIN"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                                <button
                                                    onClick={() => handleRemovePin(user.id)}
                                                    className="text-neutral-400 hover:text-red-500 p-0.5 rounded" title="Eliminar PIN"
                                                >
                                                    <Unlock size={12} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => { setPinModal({ userId: user.id, name: user.name }); setPinInput(''); setPinError(''); }}
                                                className="text-xs text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded font-medium transition-colors"
                                            >
                                                + Asignar PIN
                                            </button>
                                        )}
                                    </td>

                                    {/* NIT inline edit */}
                                    <td className="p-3">
                                        {editingNit?.userId === user.id ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    className="w-32 px-2 py-1 border rounded text-sm font-mono"
                                                    value={editingNit.value}
                                                    onChange={e => setEditingNit({ ...editingNit, value: e.target.value })}
                                                    placeholder="NIT"
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleSaveNit(user.id);
                                                        if (e.key === 'Escape') setEditingNit(null);
                                                    }}
                                                />
                                                <button onClick={() => handleSaveNit(user.id)} className="text-green-600 hover:bg-green-50 p-1 rounded"><Check size={16} /></button>
                                                <button onClick={() => setEditingNit(null)} className="text-red-600 hover:bg-red-50 p-1 rounded"><X size={16} /></button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1">
                                                <span className={`text-sm font-mono ${user.nit ? 'text-neutral-700' : 'text-red-400 italic'}`}>
                                                    {user.nit || 'Sin NIT'}
                                                </span>
                                                <button
                                                    onClick={() => setEditingNit({ userId: user.id, value: user.nit || '' })}
                                                    className="text-neutral-400 hover:text-purple-600 hover:bg-purple-50 p-1 rounded"
                                                    title="Editar NIT"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </td>

                                    {/* idType display */}
                                    <td className="p-3 text-sm">
                                        {user.role === 'DISTRIBUIDOR' ? (
                                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                                                {ID_TYPES.find(t => t.id === user.idType)?.label || user.idType || 'NIT'}
                                            </span>
                                        ) : (
                                            <span className="text-neutral-300">—</span>
                                        )}
                                    </td>

                                    {/* discountPercent display */}
                                    <td className="p-3 text-sm">
                                        {user.role === 'DISTRIBUIDOR' ? (
                                            <span className="font-mono text-emerald-700">
                                                {user.discountPercent != null ? `${user.discountPercent}%` : '34.8%'}
                                            </span>
                                        ) : (
                                            <span className="text-neutral-300">—</span>
                                        )}
                                    </td>

                                    {/* reteFuente badge */}
                                    <td className="p-3 text-sm">
                                        {user.role === 'DISTRIBUIDOR' ? (
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${user.reteFuente !== false ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                                                {user.reteFuente !== false ? '🏢 Jurídica' : '👤 Natural'}
                                            </span>
                                        ) : (
                                            <span className="text-neutral-300">—</span>
                                        )}
                                    </td>

                                    <td className="p-3 text-sm text-neutral-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                                    <td className="p-3 flex items-center gap-1">
                                        {/* Billing settings button (for DISTRIBUIDOR) */}
                                        {user.role === 'DISTRIBUIDOR' && (
                                            <button
                                                onClick={() => setEditingBilling({ userId: user.id, nit: user.nit || '', idType: user.idType || '13', discountPercent: String(user.discountPercent ?? 34.8), reteFuente: user.reteFuente !== false })}
                                                className="text-blue-500 hover:bg-blue-50 p-1 rounded"
                                                title="Configurar facturación Siigo"
                                            >
                                                <Settings size={16} />
                                            </button>
                                        )}
                                        <button onClick={() => handleDelete(user.id)} className="text-red-600 hover:bg-red-50 p-1 rounded">
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Cleaning flags modal */}
            {editingCleaning && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setEditingCleaning(null)}>
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                            <Sparkles size={18} className="text-emerald-600" />
                            Aseo — {editingCleaning.name}
                        </h2>
                        <p className="text-xs text-neutral-500 mb-4">Define si este usuario participa en el módulo de aseo.</p>
                        <div className="space-y-3">
                            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-emerald-50 transition-colors">
                                <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 accent-emerald-600"
                                    checked={editingCleaning.isCleaningStaff}
                                    onChange={e => setEditingCleaning({ ...editingCleaning, isCleaningStaff: e.target.checked })}
                                />
                                <div>
                                    <div className="font-semibold text-sm">🧹 Personal de aseo</div>
                                    <div className="text-xs text-neutral-500">Recibe y ejecuta tareas asignadas. Verá <code>/aseo</code> en su menú.</div>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors">
                                <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 accent-indigo-600"
                                    checked={editingCleaning.isCleaningSupervisor}
                                    onChange={e => setEditingCleaning({ ...editingCleaning, isCleaningSupervisor: e.target.checked })}
                                />
                                <div>
                                    <div className="font-semibold text-sm">👁️ Supervisor de aseo</div>
                                    <div className="text-xs text-neutral-500">Verifica/aprueba ejecuciones y ve reportes. Verá <code>/aseo/supervisor</code>.</div>
                                </div>
                            </label>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setEditingCleaning(null)} className="flex-1 py-2 border rounded text-sm hover:bg-neutral-50">Cancelar</button>
                            <button onClick={handleSaveCleaning} className="flex-1 py-2 bg-emerald-600 text-white rounded text-sm font-semibold hover:bg-emerald-700">Guardar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Billing settings modal */}
            {editingBilling && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                        <h2 className="text-lg font-bold mb-1">Configuración Facturación Siigo</h2>
                        <p className="text-xs text-neutral-500 mb-4">Estos valores se usarán en facturas y notas crédito.</p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">NIT / Cédula</label>
                                <input className="w-full p-2 border rounded font-mono" placeholder="Ej: 901749888"
                                    value={editingBilling.nit}
                                    onChange={e => setEditingBilling({ ...editingBilling, nit: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Tipo de Documento</label>
                                <select className="w-full p-2 border rounded"
                                    value={editingBilling.idType}
                                    onChange={e => setEditingBilling({ ...editingBilling, idType: e.target.value })}>
                                    {ID_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Descuento en factura (%)</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min="0" max="100" step="0.1" className="w-full p-2 border rounded"
                                        value={editingBilling.discountPercent}
                                        onChange={e => setEditingBilling({ ...editingBilling, discountPercent: e.target.value })} />
                                    <span className="text-neutral-500 font-medium">%</span>
                                </div>
                                <p className="text-xs text-neutral-400 mt-1">Defecto global: 34.8%</p>
                            </div>
                            {/* ReteFuente toggle */}
                            <div>
                                <label className="block text-sm font-medium mb-2">Tipo de Persona</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEditingBilling({ ...editingBilling, reteFuente: true })}
                                        className={`flex-1 py-2.5 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                                            editingBilling.reteFuente !== false
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-200 bg-white text-gray-500'
                                        }`}
                                    >
                                        🏢 Jurídica<br/>
                                        <span className="text-xs font-normal">Aplica ReteFuente 2.5%</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditingBilling({ ...editingBilling, reteFuente: false })}
                                        className={`flex-1 py-2.5 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                                            editingBilling.reteFuente === false
                                                ? 'border-amber-500 bg-amber-50 text-amber-700'
                                                : 'border-gray-200 bg-white text-gray-500'
                                        }`}
                                    >
                                        👤 Natural<br/>
                                        <span className="text-xs font-normal">No aplica ReteFuente</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end mt-6">
                            <Button variant="secondary" onClick={() => setEditingBilling(null)}>Cancelar</Button>
                            <Button onClick={handleSaveBilling}>Guardar</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* PIN setter modal */}
            {pinModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                        {savedPin ? (
                            /* ── Success: Show assigned PIN ── */
                            <>
                                <div className="text-center mb-4">
                                    <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                                        <Check size={28} />
                                    </div>
                                    <h2 className="text-lg font-bold text-neutral-800">PIN Asignado</h2>
                                    <p className="text-sm text-neutral-500 mt-1">Para <span className="font-semibold text-neutral-700">{savedPin.name}</span></p>
                                </div>
                                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-6 text-center mb-4">
                                    <p className="text-xs text-indigo-500 font-medium mb-2">PIN de acceso</p>
                                    <p className="text-5xl font-mono font-bold text-indigo-700 tracking-[0.3em] select-all">{savedPin.pin}</p>
                                </div>
                                <p className="text-xs text-neutral-400 text-center mb-4">
                                    ⚠️ Comparte este PIN con el usuario. No se podrá ver después de cerrar esta ventana.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            navigator.clipboard?.writeText(savedPin.pin);
                                            alert('PIN copiado al portapapeles');
                                        }}
                                        className="flex-1"
                                    >
                                        📋 Copiar
                                    </Button>
                                    <Button
                                        onClick={() => { setPinModal(null); setSavedPin(null); }}
                                        className="flex-1"
                                    >
                                        ✅ Listo
                                    </Button>
                                </div>
                            </>
                        ) : (
                            /* ── Input: Enter PIN ── */
                            <>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center">
                                        <LockKeyhole size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold">Asignar PIN</h2>
                                        <p className="text-xs text-neutral-500">{pinModal.name}</p>
                                    </div>
                                </div>
                                <p className="text-sm text-neutral-600 mb-3">Ingresa un PIN de 4 dígitos para este usuario:</p>
                                <div className="flex items-center gap-2 mb-2">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={4}
                                        value={pinInput}
                                        onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
                                        placeholder="0000"
                                        className="w-full p-3 border-2 border-neutral-200 rounded-xl text-center text-2xl font-mono tracking-[1em] focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter') handleSetPin(); }}
                                    />
                                </div>
                                <button onClick={generateRandomPin} className="text-xs text-indigo-600 hover:underline mb-3 block w-full text-center">
                                    🎲 Generar PIN aleatorio
                                </button>
                                {pinError && <p className="text-red-500 text-xs font-semibold text-center mb-2">{pinError}</p>}
                                <div className="flex gap-2 justify-end">
                                    <Button variant="secondary" onClick={() => { setPinModal(null); setSavedPin(null); }}>Cancelar</Button>
                                    <Button onClick={handleSetPin} disabled={pinLoading || pinInput.length !== 4}>
                                        {pinLoading ? 'Guardando...' : 'Guardar PIN'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Create user modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-lg font-bold mb-4">Crear Usuario</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Nombre</label>
                                <input className="w-full p-2 border rounded" required
                                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Email</label>
                                <input className="w-full p-2 border rounded" type="email" required
                                    value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Contraseña</label>
                                <input className="w-full p-2 border rounded" type="password" required
                                    value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Rol</label>
                                <select className="w-full p-2 border rounded"
                                    value={formData.role} onChange={e => handleRoleChange(e.target.value)}>
                                    <option value="DISTRIBUIDOR">Distribuidor</option>
                                    <option value="ADMIN">Administrador</option>
                                    <option value="LOGISTICA">Logística</option>
                                    <option value="OPERARIO_PICKING">Operario Picking</option>
                                    <option value="PRODUCCION">Producción</option>
                                    <option value="CARTERA">Cartera</option>
                                    <option value="CALIDAD">Calidad</option>
                                    <option value="CONTABILIDAD">Contabilidad</option>
                                    <option value="COMERCIAL">Comercial</option>
                                    <option value="QUIMICO">Químico</option>
                                    <option value="RECURSOS_HUMANOS">Recursos Humanos</option>
                                </select>
                            </div>
                            {SHIFT_SYNC_ROLES.includes(formData.role) && (
                                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-3">
                                    <label className="flex items-start gap-2 text-sm font-semibold text-blue-900">
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={formData.addToShiftSchedule}
                                            onChange={e => setFormData({ ...formData, addToShiftSchedule: e.target.checked })}
                                        />
                                            <span>
                                                Agregar tambien al cuadro de turnos
                                                <span className="block text-xs font-normal text-blue-700 mt-0.5">
                                                Producción, Siropes y Empaque rotan. Logística y Servicios Generales quedan fijos 8:00 a 17:00.
                                                </span>
                                            </span>
                                        </label>
                                    {formData.addToShiftSchedule && (
                                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-900 mb-1">Area</label>
                                                <select
                                                    className="w-full p-2 border rounded bg-white text-sm"
                                                    value={formData.shiftArea}
                                                    onChange={e => {
                                                        const nextArea = e.target.value;
                                                        setFormData({
                                                            ...formData,
                                                            shiftArea: nextArea,
                                                            shiftIsFixed: isFixedShiftArea(nextArea),
                                                            shiftGroupNumber: isFixedShiftArea(nextArea) ? '' : formData.shiftGroupNumber
                                                        });
                                                    }}
                                                >
                                                    {SHIFT_AREA_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-900 mb-1">Rol turno</label>
                                                <select
                                                    className="w-full p-2 border rounded bg-white text-sm"
                                                    value={formData.shiftEmployeeRole}
                                                    onChange={e => setFormData({ ...formData, shiftEmployeeRole: e.target.value })}
                                                >
                                                    <option value="OPERARIO">Operario</option>
                                                    <option value="LIDER">Lider</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-900 mb-1">Grupo</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="3"
                                                    className="w-full p-2 border rounded bg-white text-sm"
                                                    disabled={formData.shiftIsFixed}
                                                    placeholder="Luego"
                                                    value={formData.shiftGroupNumber}
                                                    onChange={e => setFormData({ ...formData, shiftGroupNumber: e.target.value })}
                                                />
                                            </div>
                                            <label className="flex items-center gap-2 text-xs font-semibold text-blue-900 pt-5">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.shiftIsFixed}
                                                    onChange={e => setFormData({
                                                        ...formData,
                                                        shiftIsFixed: e.target.checked,
                                                        shiftGroupNumber: e.target.checked ? '' : formData.shiftGroupNumber
                                                    })}
                                                />
                                                Turno fijo
                                            </label>
                                        </div>
                                    )}
                                </div>
                            )}
                            {formData.role === 'DISTRIBUIDOR' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">NIT / Cédula</label>
                                        <input className="w-full p-2 border rounded font-mono" placeholder="Ej: 901749888"
                                            value={formData.nit} onChange={e => setFormData({ ...formData, nit: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Tipo de Documento</label>
                                        <select className="w-full p-2 border rounded"
                                            value={formData.idType} onChange={e => setFormData({ ...formData, idType: e.target.value })}>
                                            {ID_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Descuento en factura (%)</label>
                                        <input type="number" min="0" max="100" step="0.1" className="w-full p-2 border rounded"
                                            value={formData.discountPercent}
                                            onChange={e => setFormData({ ...formData, discountPercent: e.target.value })} />
                                    </div>
                                    {/* ReteFuente */}
                                    <div>
                                        <label className="block text-sm font-medium mb-2">Tipo de Persona</label>
                                        <div className="flex gap-2">
                                            <button type="button"
                                                onClick={() => setFormData({ ...formData, reteFuente: true })}
                                                className={`flex-1 py-2 px-3 rounded-lg border-2 text-sm font-semibold ${
                                                    formData.reteFuente !== false ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'
                                                }`}>
                                                🏢 Jurídica (ReteFuente 2.5%)
                                            </button>
                                            <button type="button"
                                                onClick={() => setFormData({ ...formData, reteFuente: false })}
                                                className={`flex-1 py-2 px-3 rounded-lg border-2 text-sm font-semibold ${
                                                    formData.reteFuente === false ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                                                }`}>
                                                👤 Natural (Sin Rete)
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="flex gap-2 justify-end mt-6">
                                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                                <Button type="submit">Guardar</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Users;
