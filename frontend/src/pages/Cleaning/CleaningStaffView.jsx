import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, CheckCircle2, Clock, AlertTriangle, Package, ChevronRight } from 'lucide-react';
import * as cleaningApi from '../../api/cleaning';

const STATUS_LABEL = {
    PENDING: { label: 'Pendiente', color: 'bg-gray-100 text-gray-700' },
    IN_PROGRESS: { label: 'En curso', color: 'bg-yellow-100 text-yellow-800' },
    COMPLETED: { label: 'Completada', color: 'bg-green-100 text-green-800' },
    SKIPPED: { label: 'Saltada', color: 'bg-red-100 text-red-700' },
};

const TIME_SLOT_LABEL = { AM: '🌅 Mañana', PM: '🌇 Tarde', ANYTIME: '⏰ Cualquier hora' };

const CleaningStaffView = () => {
    const navigate = useNavigate();
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTask, setActiveTask] = useState(null);
    const [notes, setNotes] = useState('');
    const [completing, setCompleting] = useState(false);

    const load = async () => {
        try {
            const data = await cleaningApi.getTodayTasks();
            setTasks(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleStart = async (id) => {
        try {
            await cleaningApi.startExecution(id);
            await load();
        } catch (err) {
            alert(err.response?.data?.error || 'Error al iniciar');
        }
    };

    const handleComplete = async (id) => {
        setCompleting(true);
        try {
            await cleaningApi.completeExecution(id, { notes: notes.trim() || null });
            setActiveTask(null);
            setNotes('');
            await load();
        } catch (err) {
            alert(err.response?.data?.error || 'Error al completar');
        } finally {
            setCompleting(false);
        }
    };

    if (loading) {
        return <div className="p-6 text-center">Cargando tareas...</div>;
    }

    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'COMPLETED').length;
    const compliance = total > 0 ? Math.round((completed / total) * 100) : 0;

    const grouped = tasks.reduce((acc, t) => {
        const zone = t.task.zone.name;
        if (!acc[zone]) acc[zone] = [];
        acc[zone].push(t);
        return acc;
    }, {});

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Header */}
            <div className="bg-blue-600 text-white px-4 py-5 sticky top-0 z-10 shadow-md">
                <h1 className="text-2xl font-bold">🧹 Mis Tareas de Aseo</h1>
                <p className="text-blue-100 text-sm mt-1">
                    {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <div className="mt-3 flex items-center justify-between bg-blue-700/40 rounded-lg p-3">
                    <div>
                        <div className="text-3xl font-bold">{compliance}%</div>
                        <div className="text-xs text-blue-100">Cumplimiento</div>
                    </div>
                    <div className="text-right">
                        <div className="text-xl">{completed} / {total}</div>
                        <div className="text-xs text-blue-100">Tareas</div>
                    </div>
                </div>
            </div>

            {/* Botón insumos */}
            <button
                onClick={() => navigate('/aseo/insumos')}
                className="mx-4 mt-4 w-[calc(100%-2rem)] bg-orange-500 hover:bg-orange-600 text-white font-semibold py-4 px-4 rounded-xl flex items-center justify-between shadow-md"
            >
                <span className="flex items-center gap-3">
                    <Package size={24} />
                    <span>Reportar insumos por terminar</span>
                </span>
                <ChevronRight size={20} />
            </button>

            {/* Lista de tareas agrupadas por zona */}
            <div className="px-4 mt-4 space-y-4">
                {Object.entries(grouped).map(([zone, items]) => (
                    <div key={zone}>
                        <h2 className="font-bold text-gray-700 mb-2 px-1">{zone}</h2>
                        <div className="space-y-2">
                            {items.map((exec) => {
                                const st = STATUS_LABEL[exec.status] || STATUS_LABEL.PENDING;
                                const isActive = exec.status === 'IN_PROGRESS';
                                const isDone = exec.status === 'COMPLETED';
                                return (
                                    <div
                                        key={exec.id}
                                        className={`bg-white rounded-xl shadow-sm border-l-4 ${isDone ? 'border-green-500 opacity-70' : isActive ? 'border-yellow-500' : 'border-blue-500'} p-4`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1">
                                                <div className="font-semibold text-gray-900">{exec.task.title}</div>
                                                {exec.task.timeSlot && (
                                                    <div className="text-xs text-gray-500 mt-1">{TIME_SLOT_LABEL[exec.task.timeSlot]}</div>
                                                )}
                                                {exec.task.instructions && (
                                                    <div className="text-sm text-gray-600 mt-2 bg-blue-50 p-2 rounded">
                                                        💡 {exec.task.instructions}
                                                    </div>
                                                )}
                                                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                    <Clock size={12} /> {exec.task.estimatedMin} min
                                                </div>
                                            </div>
                                            <span className={`text-xs font-semibold px-2 py-1 rounded ${st.color}`}>
                                                {st.label}
                                            </span>
                                        </div>

                                        {!isDone && exec.status === 'PENDING' && (
                                            <button
                                                onClick={() => handleStart(exec.id)}
                                                className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
                                            >
                                                <Play size={20} /> Iniciar tarea
                                            </button>
                                        )}

                                        {isActive && (
                                            <div className="mt-3 space-y-2">
                                                {activeTask !== exec.id ? (
                                                    <button
                                                        onClick={() => setActiveTask(exec.id)}
                                                        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
                                                    >
                                                        <CheckCircle2 size={20} /> Marcar como terminada
                                                    </button>
                                                ) : (
                                                    <>
                                                        <textarea
                                                            placeholder="Notas (opcional)..."
                                                            value={notes}
                                                            onChange={e => setNotes(e.target.value)}
                                                            className="w-full p-2 border rounded text-sm"
                                                            rows={2}
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => { setActiveTask(null); setNotes(''); }}
                                                                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded"
                                                            >
                                                                Cancelar
                                                            </button>
                                                            <button
                                                                onClick={() => handleComplete(exec.id)}
                                                                disabled={completing}
                                                                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded disabled:opacity-50"
                                                            >
                                                                {completing ? 'Guardando...' : 'Confirmar'}
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {isDone && exec.completedAt && (
                                            <div className="mt-2 text-xs text-green-700 flex items-center gap-1">
                                                <CheckCircle2 size={14} /> Completada a las {new Date(exec.completedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                                {exec.durationMin && <span className="ml-2 text-gray-500">({exec.durationMin} min)</span>}
                                            </div>
                                        )}

                                        {exec.notes && (
                                            <div className="mt-2 text-xs text-gray-600 italic">📝 {exec.notes}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {tasks.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                    <AlertTriangle size={48} className="mx-auto mb-2 text-yellow-500" />
                    <p>No tienes tareas asignadas para hoy.</p>
                </div>
            )}
        </div>
    );
};

export default CleaningStaffView;
