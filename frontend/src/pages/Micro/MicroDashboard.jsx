import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { Microscope, Calendar, TrendingUp, AlertTriangle, CheckCircle, XCircle, Clock, Plus, ChevronLeft, ChevronRight, FlaskConical, Eye } from 'lucide-react';
import MicroSampleEntry from './MicroSampleEntry';

const API = import.meta.env.VITE_API_URL;

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const STATUS_ICONS = {
    COMPLETED: <CheckCircle size={16} className="text-green-500" />,
    SAMPLED: <Clock size={16} className="text-blue-500" />,
    PENDING: <XCircle size={16} className="text-red-400" />,
    NOT_SCHEDULED: <span className="text-gray-200">—</span>
};

const MicroDashboard = () => {
    const { token } = useAuth();
    const [schedule, setSchedule] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0);
    const [showEntry, setShowEntry] = useState(false);
    const [selectedPoint, setSelectedPoint] = useState(null);
    const [editSampleId, setEditSampleId] = useState(null);

    const headers = { Authorization: `Bearer ${token}` };

    const getWeekStart = useCallback(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
    }, [weekOffset]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [schedRes, dashRes] = await Promise.all([
                axios.get(`${API}/api/micro/schedule`, { headers, params: { weekStart: getWeekStart() } }),
                axios.get(`${API}/api/micro/dashboard`, { headers })
            ]);
            setSchedule(schedRes.data);
            setDashboard(dashRes.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [getWeekStart]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const complianceColor = (rate) => {
        if (rate === null) return 'text-gray-400';
        if (rate >= 95) return 'text-green-600';
        if (rate >= 80) return 'text-amber-600';
        return 'text-red-600';
    };

    const severityStyle = (s) => ({
        CRITICAL: 'bg-red-50 border-red-200 text-red-800',
        WARNING: 'bg-amber-50 border-amber-200 text-amber-800',
        INFO: 'bg-blue-50 border-blue-200 text-blue-800'
    }[s] || 'bg-gray-50 border-gray-200');

    if (loading && !schedule) return (
        <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-gray-400"><FlaskConical className="animate-pulse" size={32} /> Cargando módulo microbiológico...</div>
        </div>
    );

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-teal-200">
                        <Microscope size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Control Microbiológico</h1>
                        <p className="text-sm text-gray-500">Seguimiento de análisis y carga bacteriana en proceso</p>
                    </div>
                </div>
                <button onClick={() => { setSelectedPoint(null); setEditSampleId(null); setShowEntry(true); }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-xl font-medium shadow-lg shadow-teal-200 transition-all">
                    <Plus size={18} /> Registrar Muestra
                </button>
            </div>

            {/* KPI Cards */}
            {dashboard?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase">Muestras (4 sem)</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">{dashboard.summary.totalSamples}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase">Cumplimiento</p>
                        <p className={`text-3xl font-bold mt-1 ${complianceColor(dashboard.summary.complianceRate)}`}>
                            {dashboard.summary.complianceRate !== null ? `${dashboard.summary.complianceRate}%` : '—'}
                        </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase">Conformes</p>
                        <p className="text-3xl font-bold text-green-600 mt-1">{dashboard.summary.compliantResults}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase">No Conformes</p>
                        <p className="text-3xl font-bold text-red-600 mt-1">{dashboard.summary.nonCompliantCount}</p>
                    </div>
                </div>
            )}

            {/* Schedule Grid */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-teal-50 to-emerald-50">
                    <div className="flex items-center gap-2">
                        <Calendar size={18} className="text-teal-600" />
                        <h2 className="font-bold text-teal-900">Cronograma Semanal de Muestreo</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-teal-100 text-teal-600"><ChevronLeft size={18} /></button>
                        <button onClick={() => setWeekOffset(0)} className="text-xs font-medium text-teal-700 px-3 py-1 rounded-lg hover:bg-teal-100">Hoy</button>
                        <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-teal-100 text-teal-600"><ChevronRight size={18} /></button>
                    </div>
                </div>

                {schedule?.schedule && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase w-64">Punto de Muestreo</th>
                                    {[0, 1, 2, 3, 4, 5, 6].map(d => {
                                        const firstPoint = schedule.schedule[0];
                                        const dayData = firstPoint?.days[d];
                                        const isToday = dayData?.date === new Date().toISOString().split('T')[0];
                                        return (
                                            <th key={d} className={`text-center px-3 py-3 text-xs font-bold uppercase ${isToday ? 'bg-teal-100 text-teal-800' : 'text-gray-500'}`}>
                                                <div>{DAY_NAMES[dayData?.dayOfWeek ?? d]}</div>
                                                <div className="text-[10px] font-normal">{dayData?.date?.slice(5)}</div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {schedule.schedule.map(point => (
                                    <tr key={point.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">{point.code}</span>
                                                <span className="text-sm text-gray-700 truncate max-w-[180px]">{point.name}</span>
                                            </div>
                                        </td>
                                        {[0, 1, 2, 3, 4, 5, 6].map(d => {
                                            const day = point.days[d];
                                            const isToday = day?.date === new Date().toISOString().split('T')[0];
                                            return (
                                                <td key={d} className={`text-center px-3 py-2.5 ${isToday ? 'bg-teal-50/50' : ''}`}>
                                                    {day?.isScheduled ? (
                                                        <button
                                                            onClick={() => {
                                                                if (day.status === 'PENDING') {
                                                                    setEditSampleId(null);
                                                                    setSelectedPoint({ pointId: point.id, pointName: point.name, code: point.code, date: day.date });
                                                                    setShowEntry(true);
                                                                } else if ((day.status === 'COMPLETED' || day.status === 'SAMPLED') && day.samples?.length > 0) {
                                                                    setSelectedPoint(null);
                                                                    setEditSampleId(day.samples[0].id);
                                                                    setShowEntry(true);
                                                                }
                                                            }}
                                                            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${day.status === 'COMPLETED' ? 'bg-green-100 hover:bg-green-200 ring-1 ring-green-200' :
                                                                day.status === 'SAMPLED' ? 'bg-blue-100 hover:bg-blue-200 ring-1 ring-blue-200' :
                                                                    day.status === 'PENDING' ? 'bg-red-50 hover:bg-red-100 ring-1 ring-red-200' :
                                                                        ''
                                                                }`}
                                                            title={day.status === 'PENDING' ? 'Click para registrar muestra' : 'Click para ver / editar muestra'}
                                                        >
                                                            {STATUS_ICONS[day.status]}
                                                        </button>
                                                    ) : (
                                                        <span className="text-gray-200">—</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-6 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5"><CheckCircle size={12} className="text-green-500" /> Completado</span>
                    <span className="flex items-center gap-1.5"><Clock size={12} className="text-blue-500" /> Muestreado (sin resultados)</span>
                    <span className="flex items-center gap-1.5"><XCircle size={12} className="text-red-400" /> Pendiente</span>
                    <span className="flex items-center gap-1.5"><span className="text-gray-300">—</span> No programado</span>
                </div>
            </div>

            {/* Compliance by Point */}
            {dashboard?.byPoint && Object.keys(dashboard.byPoint).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                    <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
                        <TrendingUp size={18} className="text-teal-600" /> Cumplimiento por Punto de Control
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {Object.entries(dashboard.byPoint).map(([code, data]) => {
                            const rate = data.total > 0 ? Math.round((data.compliant / data.total) * 100) : null;
                            return (
                                <div key={code} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">{code}</span>
                                        <span className={`text-lg font-bold ${complianceColor(rate)}`}>{rate !== null ? `${rate}%` : '—'}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 truncate">{data.name}</p>
                                    <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${rate >= 95 ? 'bg-green-500' : rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                                            style={{ width: `${rate || 0}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Alerts & Suggestions */}
            {dashboard?.alerts?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                    <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
                        <AlertTriangle size={18} className="text-amber-600" /> Alertas y Sugerencias Técnicas
                    </h2>
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                        {dashboard.alerts.map((alert, i) => (
                            <div key={i} className={`p-4 rounded-xl border ${severityStyle(alert.severity)}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${alert.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                                        }`}>{alert.severity}</span>
                                    <span className="text-xs font-medium">{alert.point}</span>
                                    {alert.parameter && <span className="text-xs">— {alert.parameter}</span>}
                                    {alert.sampleNumber && <span className="text-xs text-gray-500">({alert.sampleNumber})</span>}
                                </div>
                                <p className="text-sm mt-1">{alert.suggestion}</p>
                                {alert.value !== undefined && alert.value !== null && (
                                    <p className="text-xs mt-1 opacity-70">
                                        Valor: <strong>{alert.value} {alert.valueText || ''}</strong>
                                        {alert.specMax && <span> • Límite M: {alert.specMax}</span>}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Recent Samples */}
            {dashboard?.recentSamples?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="font-bold text-gray-800">Últimas Muestras</h2>
                    </div>
                    <table className="min-w-full divide-y divide-gray-100">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Muestra</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Punto</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Fecha</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Lab</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Estado</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Resultados</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {dashboard.recentSamples.map(s => {
                                const allCompliant = s.results.length > 0 && s.results.every(r => r.isCompliant === true);
                                const anyNC = s.results.some(r => r.isCompliant === false);
                                return (
                                    <tr key={s.id} className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                                        onClick={() => { setSelectedPoint(null); setEditSampleId(s.id); setShowEntry(true); }}
                                        title="Click para ver / editar muestra">
                                        <td className="px-4 py-2.5 text-sm font-bold text-teal-700 flex items-center gap-1.5">
                                            <Eye size={13} className="text-teal-400" />{s.sampleNumber}
                                        </td>
                                        <td className="px-4 py-2.5 text-sm text-gray-700">{s.samplingPoint?.name}</td>
                                        <td className="px-4 py-2.5 text-sm text-gray-500">{new Date(s.takenAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-2.5 text-sm text-gray-500">{s.lab || '—'}</td>
                                        <td className="px-4 py-2.5">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                                                s.status === 'RECEIVED' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>{s.status}</span>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {s.results.length > 0 ? (
                                                <div className="flex items-center gap-1">
                                                    {allCompliant && <CheckCircle size={14} className="text-green-500" />}
                                                    {anyNC && <XCircle size={14} className="text-red-500" />}
                                                    <span className="text-xs text-gray-500">{s.results.length} parámetro(s)</span>
                                                </div>
                                            ) : <span className="text-xs text-gray-400">Pendiente</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Sample Entry Modal */}
            {showEntry && (
                <MicroSampleEntry
                    preselectedPoint={selectedPoint}
                    existingSampleId={editSampleId}
                    onClose={() => { setShowEntry(false); setSelectedPoint(null); setEditSampleId(null); }}
                    onSuccess={() => { setShowEntry(false); setSelectedPoint(null); setEditSampleId(null); fetchData(); }}
                />
            )}
        </div>
    );
};

export default MicroDashboard;
