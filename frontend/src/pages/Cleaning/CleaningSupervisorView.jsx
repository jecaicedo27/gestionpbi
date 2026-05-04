import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, AlertCircle, Clock, ChevronRight, Package } from 'lucide-react';
import * as cleaningApi from '../../api/cleaning';

const CleaningSupervisorView = () => {
    const navigate = useNavigate();
    const [report, setReport] = useState(null);
    const [pending, setPending] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(null);
    const [verifyNotes, setVerifyNotes] = useState('');

    const load = async () => {
        try {
            const [r, p, a] = await Promise.all([
                cleaningApi.getDailyReport(),
                cleaningApi.listPendingVerifications(),
                cleaningApi.listAlerts({ status: 'OPEN' }),
            ]);
            setReport(r);
            setPending(p);
            setAlerts(a);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleVerify = async (id, approved) => {
        try {
            await cleaningApi.verifyExecution(id, { approved, notes: verifyNotes.trim() || null });
            setVerifying(null);
            setVerifyNotes('');
            await load();
        } catch (err) {
            alert(err.response?.data?.error || 'Error');
        }
    };

    if (loading) return <div className="p-6 text-center">Cargando...</div>;

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <div className="bg-purple-600 text-white px-4 py-5 shadow-md">
                <h1 className="text-2xl font-bold">👮 Supervisión de Aseo</h1>
                <p className="text-purple-100 text-sm mt-1">Verificación, cumplimiento e insumos</p>
            </div>

            {/* Stats */}
            <div className="px-4 mt-4 grid grid-cols-4 gap-2">
                <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                    <div className="text-2xl font-bold text-blue-600">{report?.compliance ?? 0}%</div>
                    <div className="text-xs text-gray-600">Cumplimiento</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                    <div className="text-2xl font-bold text-green-600">{report?.completed ?? 0}</div>
                    <div className="text-xs text-gray-600">Completas</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                    <div className="text-2xl font-bold text-yellow-600">{report?.pending ?? 0}</div>
                    <div className="text-xs text-gray-600">Pendientes</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                    <div className="text-2xl font-bold text-red-600">{report?.skipped ?? 0}</div>
                    <div className="text-xs text-gray-600">Saltadas</div>
                </div>
            </div>

            {/* Alertas insumos */}
            {alerts.length > 0 && (
                <div className="mx-4 mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
                    <h2 className="font-bold text-orange-800 flex items-center gap-2 mb-2">
                        <Package size={20} /> Insumos por terminar ({alerts.length})
                    </h2>
                    <ul className="space-y-1 text-sm">
                        {alerts.map(a => (
                            <li key={a.id} className="text-orange-900">
                                • <strong>{a.supply.name}</strong>
                                {a.message && <span className="text-orange-700"> — {a.message}</span>}
                                <span className="text-xs text-gray-500 ml-2">
                                    ({a.reportedBy?.name?.split(' ')[0]}, {new Date(a.createdAt).toLocaleDateString('es-CO')})
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Cumplimiento por zona */}
            {report?.byZone && Object.keys(report.byZone).length > 0 && (
                <div className="mx-4 mt-4 bg-white rounded-xl shadow-sm p-4">
                    <h2 className="font-bold text-gray-800 mb-3">Cumplimiento por zona</h2>
                    <div className="space-y-2">
                        {Object.entries(report.byZone).map(([code, z]) => {
                            const pct = z.total > 0 ? Math.round((z.completed / z.total) * 100) : 0;
                            return (
                                <div key={code}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-medium">{z.name}</span>
                                        <span className="text-gray-600">{z.completed}/{z.total} ({pct}%)</span>
                                    </div>
                                    <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                                        <div className={`h-full ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Verificaciones pendientes */}
            <div className="px-4 mt-4">
                <h2 className="font-bold text-gray-800 mb-2">
                    Pendientes de verificar ({pending.length})
                </h2>
                {pending.length === 0 ? (
                    <div className="bg-white rounded-xl p-6 text-center text-gray-500 shadow-sm">
                        <CheckCircle2 size={40} className="mx-auto mb-2 text-green-500" />
                        Sin verificaciones pendientes
                    </div>
                ) : (
                    <div className="space-y-2">
                        {pending.map(exec => (
                            <div key={exec.id} className="bg-white rounded-xl shadow-sm border-l-4 border-blue-500 p-4">
                                <div className="font-semibold">{exec.task.title}</div>
                                <div className="text-xs text-gray-600 mt-1">
                                    {exec.task.zone.name} • {exec.user.name?.split(' ')[0]}
                                </div>
                                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                    <Clock size={12} />
                                    Completada a las {new Date(exec.completedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                    {exec.durationMin && <span> ({exec.durationMin} min)</span>}
                                </div>
                                {exec.notes && <div className="text-xs italic text-gray-600 mt-2">📝 {exec.notes}</div>}

                                {verifying === exec.id ? (
                                    <div className="mt-3 space-y-2">
                                        <textarea
                                            placeholder="Notas (opcional)"
                                            value={verifyNotes}
                                            onChange={e => setVerifyNotes(e.target.value)}
                                            className="w-full p-2 border rounded text-sm"
                                            rows={2}
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleVerify(exec.id, false)}
                                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded flex items-center justify-center gap-1"
                                            >
                                                <XCircle size={18} /> Rechazar
                                            </button>
                                            <button
                                                onClick={() => handleVerify(exec.id, true)}
                                                className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded flex items-center justify-center gap-1"
                                            >
                                                <CheckCircle2 size={18} /> Aprobar
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => { setVerifying(null); setVerifyNotes(''); }}
                                            className="w-full text-sm text-gray-500"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setVerifying(exec.id)}
                                        className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded"
                                    >
                                        Verificar
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="px-4 mt-6">
                <button
                    onClick={() => navigate('/aseo/admin')}
                    className="w-full bg-gray-700 hover:bg-gray-800 text-white py-3 rounded-lg flex items-center justify-center gap-2"
                >
                    Ir a administración de tareas <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
};

export default CleaningSupervisorView;
