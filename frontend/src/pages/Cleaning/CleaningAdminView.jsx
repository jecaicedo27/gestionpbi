import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Zap, X, RefreshCw } from 'lucide-react';
import * as cleaningApi from '../../api/cleaning';

const FREQUENCIES = [
    { value: 'DAILY', label: 'Diaria' },
    { value: 'WEEKLY', label: 'Semanal' },
    { value: 'BIWEEKLY', label: 'Quincenal' },
    { value: 'MONTHLY', label: 'Mensual' },
    { value: 'ONE_TIME', label: 'Una sola vez' },
];

const TIME_SLOTS = [
    { value: '', label: 'Cualquier hora' },
    { value: 'AM', label: 'Mañana' },
    { value: 'PM', label: 'Tarde' },
];

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const emptyTask = {
    zoneId: '',
    title: '',
    description: '',
    instructions: '',
    frequency: 'DAILY',
    daysOfWeek: [],
    timeSlot: '',
    estimatedMin: 15,
    requirePhoto: false,
    requireNotes: false,
    assignedToId: '',
};

const CleaningAdminView = () => {
    const [zones, setZones] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [users, setUsers] = useState([]);
    const [filterZone, setFilterZone] = useState('');
    const [filterFreq, setFilterFreq] = useState('');
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyTask);
    const [showExtra, setShowExtra] = useState(false);
    const [extraForm, setExtraForm] = useState({ zoneId: '', title: '', instructions: '', estimatedMin: 30, assignedToId: '' });

    const load = async () => {
        const [z, t, s] = await Promise.all([
            cleaningApi.listZones(),
            cleaningApi.listTasks(),
            cleaningApi.listStaff(),
        ]);
        setZones(z);
        setTasks(t);
        setUsers(s);
    };

    useEffect(() => { load(); }, []);

    const filtered = tasks.filter(t =>
        (!filterZone || t.zoneId === filterZone) &&
        (!filterFreq || t.frequency === filterFreq)
    );

    const openNew = () => { setForm({ ...emptyTask, zoneId: zones[0]?.id || '' }); setEditing('new'); };
    const openEdit = (t) => {
        setForm({
            zoneId: t.zoneId,
            title: t.title,
            description: t.description || '',
            instructions: t.instructions || '',
            frequency: t.frequency,
            daysOfWeek: t.daysOfWeek || [],
            timeSlot: t.timeSlot || '',
            estimatedMin: t.estimatedMin,
            requirePhoto: t.requirePhoto,
            requireNotes: t.requireNotes,
            assignedToId: t.assignedToId || '',
        });
        setEditing(t.id);
    };

    const save = async () => {
        try {
            const payload = { ...form, assignedToId: form.assignedToId || null };
            if (editing === 'new') {
                await cleaningApi.createTask(payload);
            } else {
                await cleaningApi.updateTask(editing, payload);
            }
            setEditing(null);
            await load();
        } catch (err) {
            alert(err.response?.data?.error || 'Error al guardar');
        }
    };

    const remove = async (id) => {
        if (!confirm('¿Desactivar esta tarea?')) return;
        await cleaningApi.deleteTask(id);
        await load();
    };

    const sendExtra = async () => {
        if (!extraForm.title || !extraForm.zoneId || !extraForm.assignedToId) {
            alert('Completa todos los campos');
            return;
        }
        try {
            await cleaningApi.assignExtraTask(extraForm);
            setShowExtra(false);
            setExtraForm({ zoneId: '', title: '', instructions: '', estimatedMin: 30, assignedToId: '' });
            alert('✅ Tarea extra asignada para hoy');
        } catch (err) {
            alert(err.response?.data?.error || 'Error');
        }
    };

    const toggleDow = (d) => {
        const days = form.daysOfWeek.includes(d) ? form.daysOfWeek.filter(x => x !== d) : [...form.daysOfWeek, d].sort();
        setForm({ ...form, daysOfWeek: days });
    };

    const regenerate = async () => {
        if (!confirm('¿Regenerar tareas del día (no duplicará las ya creadas)?')) return;
        const r = await cleaningApi.regenerateToday();
        alert(`✅ ${r.created} ejecuciones nuevas creadas`);
    };

    return (
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h1 className="text-2xl font-bold">🧹 Admin Aseo</h1>
                <div className="flex gap-2">
                    <button
                        onClick={regenerate}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
                    >
                        <RefreshCw size={16} /> Regenerar día
                    </button>
                    <button
                        onClick={() => setShowExtra(true)}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
                    >
                        <Zap size={16} /> Tarea extra hoy
                    </button>
                    <button
                        onClick={openNew}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
                    >
                        <Plus size={16} /> Nueva tarea
                    </button>
                </div>
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
                <select value={filterZone} onChange={e => setFilterZone(e.target.value)} className="border rounded px-3 py-2 text-sm">
                    <option value="">Todas las zonas ({tasks.length})</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <select value={filterFreq} onChange={e => setFilterFreq(e.target.value)} className="border rounded px-3 py-2 text-sm">
                    <option value="">Todas las frecuencias</option>
                    {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <span className="text-sm text-gray-600 self-center">{filtered.length} tareas</span>
            </div>

            <div className="bg-white rounded-lg shadow overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="px-3 py-2 text-left">Zona</th>
                            <th className="px-3 py-2 text-left">Tarea</th>
                            <th className="px-3 py-2 text-left">Frecuencia</th>
                            <th className="px-3 py-2 text-left">Horario</th>
                            <th className="px-3 py-2 text-left">Min</th>
                            <th className="px-3 py-2 text-left">Asignada a</th>
                            <th className="px-3 py-2 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(t => (
                            <tr key={t.id} className={`border-b hover:bg-gray-50 ${!t.active ? 'opacity-50' : ''}`}>
                                <td className="px-3 py-2">{t.zone.name}</td>
                                <td className="px-3 py-2 font-medium">{t.title}</td>
                                <td className="px-3 py-2">
                                    {FREQUENCIES.find(f => f.value === t.frequency)?.label || t.frequency}
                                    {t.daysOfWeek?.length > 0 && (
                                        <div className="text-xs text-gray-500">{t.daysOfWeek.map(d => DOW[d]).join(', ')}</div>
                                    )}
                                </td>
                                <td className="px-3 py-2">{t.timeSlot || '-'}</td>
                                <td className="px-3 py-2">{t.estimatedMin}</td>
                                <td className="px-3 py-2">{t.assignedTo?.name?.split(' ')[0] || '-'}</td>
                                <td className="px-3 py-2 text-right">
                                    <button onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-800 mr-2">
                                        <Edit2 size={16} />
                                    </button>
                                    {t.active && (
                                        <button onClick={() => remove(t.id)} className="text-red-600 hover:text-red-800">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal editar/crear */}
            {editing && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold">{editing === 'new' ? 'Nueva tarea' : 'Editar tarea'}</h2>
                            <button onClick={() => setEditing(null)}><X size={20} /></button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm font-medium block mb-1">Zona</label>
                                <select value={form.zoneId} onChange={e => setForm({ ...form, zoneId: e.target.value })} className="w-full border rounded px-3 py-2">
                                    {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">Título</label>
                                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full border rounded px-3 py-2" />
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">Instrucciones (opcional)</label>
                                <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} className="w-full border rounded px-3 py-2" rows={2} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium block mb-1">Frecuencia</label>
                                    <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="w-full border rounded px-3 py-2">
                                        {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium block mb-1">Horario</label>
                                    <select value={form.timeSlot} onChange={e => setForm({ ...form, timeSlot: e.target.value })} className="w-full border rounded px-3 py-2">
                                        {TIME_SLOTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            {(form.frequency === 'WEEKLY' || form.frequency === 'BIWEEKLY') && (
                                <div>
                                    <label className="text-sm font-medium block mb-1">Días de la semana</label>
                                    <div className="flex gap-1">
                                        {DOW.map((d, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => toggleDow(i)}
                                                className={`flex-1 py-2 rounded text-sm ${form.daysOfWeek.includes(i) ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="text-sm font-medium block mb-1">Minutos estimados</label>
                                <input type="number" value={form.estimatedMin} onChange={e => setForm({ ...form, estimatedMin: parseInt(e.target.value) || 15 })} className="w-full border rounded px-3 py-2" />
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">Asignar a</label>
                                <select value={form.assignedToId || ''} onChange={e => setForm({ ...form, assignedToId: e.target.value })} className="w-full border rounded px-3 py-2">
                                    <option value="">Sin asignar (no se generarán ejecuciones)</option>
                                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                                {users.length === 0 && (
                                    <p className="text-xs text-orange-600 mt-1">No hay personal de aseo. Activa "Personal de aseo" en /admin/usuarios.</p>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setEditing(null)} className="flex-1 bg-gray-300 py-2 rounded">Cancelar</button>
                                <button onClick={save} className="flex-1 bg-blue-600 text-white py-2 rounded">Guardar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal tarea extra */}
            {showExtra && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Zap size={20} className="text-orange-500" /> Tarea extra hoy
                            </h2>
                            <button onClick={() => setShowExtra(false)}><X size={20} /></button>
                        </div>
                        <div className="space-y-3">
                            <select value={extraForm.zoneId} onChange={e => setExtraForm({ ...extraForm, zoneId: e.target.value })} className="w-full border rounded px-3 py-2">
                                <option value="">Selecciona zona...</option>
                                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                            </select>
                            <input
                                placeholder="Título de la tarea"
                                value={extraForm.title}
                                onChange={e => setExtraForm({ ...extraForm, title: e.target.value })}
                                className="w-full border rounded px-3 py-2"
                            />
                            <textarea
                                placeholder="Instrucciones detalladas"
                                value={extraForm.instructions}
                                onChange={e => setExtraForm({ ...extraForm, instructions: e.target.value })}
                                className="w-full border rounded px-3 py-2"
                                rows={3}
                            />
                            <input
                                type="number"
                                placeholder="Minutos estimados"
                                value={extraForm.estimatedMin}
                                onChange={e => setExtraForm({ ...extraForm, estimatedMin: parseInt(e.target.value) || 30 })}
                                className="w-full border rounded px-3 py-2"
                            />
                            <select value={extraForm.assignedToId} onChange={e => setExtraForm({ ...extraForm, assignedToId: e.target.value })} className="w-full border rounded px-3 py-2">
                                <option value="">Asignar a...</option>
                                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                            <div className="flex gap-3">
                                <button onClick={() => setShowExtra(false)} className="flex-1 bg-gray-300 py-2 rounded">Cancelar</button>
                                <button onClick={sendExtra} className="flex-1 bg-orange-600 text-white py-2 rounded">Enviar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CleaningAdminView;
