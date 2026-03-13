import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import InternalPQRDetail from '../../components/PQR/InternalPQRDetail';
import { AlertTriangle } from 'lucide-react';

const STAGE_LABELS = {
    PENDING_REVIEW: 'Revisión Calidad',
    PENDING_BILLING: 'Ajuste Inventario',
    COMPLETED: 'Completado',
    REJECTED: 'Rechazado'
};
const STAGE_STYLES = {
    PENDING_REVIEW: 'bg-blue-100 text-blue-800',
    PENDING_BILLING: 'bg-amber-100 text-amber-800',
    COMPLETED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800'
};
const ORIGIN_LABELS = {
    DETERIORO_PLANTA: '🏭 Deterioro',
    DEFECTO_FABRICACION: '⚠️ Fabricación'
};

const InternalPQRManagement = () => {
    const { token, user } = useAuth();
    const [pqrs, setPqrs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);
    const [filterStatus, setFilterStatus] = useState('ALL');

    const fetchPQRs = async (options = {}) => {
        const { showLoader = true } = options;
        if (!token) return;
        try {
            if (showLoader) setLoading(true);
            const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/internal-pqr`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { status: filterStatus !== 'ALL' ? filterStatus : undefined }
            });
            setPqrs(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            if (showLoader) setLoading(false);
        }
    };

    useEffect(() => {
        if (!token) return;
        fetchPQRs();
    }, [filterStatus, token]);

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <div className="flex items-center gap-2">
                        <AlertTriangle size={22} className="text-orange-600" />
                        <h1 className="text-2xl font-bold text-gray-900">PQR Internos — Gestión</h1>
                    </div>
                    <p className="text-gray-500 text-sm mt-0.5">Productos dañados o mal fabricados en planta</p>
                </div>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400">
                    <option value="ALL">Todos</option>
                    <option value="PENDING">Pendientes</option>
                    <option value="IN_REVIEW">En Proceso</option>
                    <option value="REJECTED">Rechazados</option>
                    <option value="PROCESSED">Completados</option>
                </select>
            </div>

            {['ADMIN', 'CALIDAD'].includes(user?.role) && pqrs.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {Object.entries(pqrs.reduce((acc, p) => { acc[p.stage] = (acc[p.stage] || 0) + 1; return acc; }, {}))
                        .map(([stage, count]) => (
                            <div key={stage} className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm text-center">
                                <p className="text-2xl font-bold text-gray-900">{count}</p>
                                <p className="text-xs text-gray-500 mt-1">{STAGE_LABELS[stage] || stage}</p>
                            </div>
                        ))}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm flex-1 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Ticket</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Fecha</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Reportado Por</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Origen</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Producto(s)</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Etapa</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan="7" className="text-center py-6 text-gray-400">Cargando...</td></tr>
                            ) : pqrs.length > 0 ? (
                                pqrs.map(pqr => (
                                    <tr key={pqr.id} className="hover:bg-orange-50/30 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-orange-700">#{pqr.ticketNumber}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{new Date(pqr.createdAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-800">
                                            {pqr.user?.name}
                                            <div className="text-xs text-gray-400">{pqr.user?.role}</div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                                            <span className="text-xs">{ORIGIN_LABELS[pqr.origin] || pqr.origin || '—'}</span>
                                            {pqr.daysAfterProduction && <div className="text-xs text-gray-400">{pqr.daysAfterProduction} días</div>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px]">
                                            {pqr.items?.length > 1
                                                ? <span className="font-bold text-orange-600">{pqr.items.length} Productos</span>
                                                : <div className="truncate">{pqr.items?.[0]?.product?.name || 'Sin especificar'}
                                                    <div className="text-xs text-gray-400">{pqr.items?.[0]?.quantity} {pqr.items?.[0]?.unit}</div>
                                                </div>
                                            }
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${STAGE_STYLES[pqr.stage] || 'bg-gray-100 text-gray-800'}`}>
                                                {STAGE_LABELS[pqr.stage] || pqr.stage}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => setSelected(pqr)}
                                                className="text-orange-600 hover:text-orange-900 text-sm font-medium hover:underline">Gestionar</button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan="7" className="text-center py-10 text-gray-400">No hay PQR internos registrados.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selected && (
                <InternalPQRDetail pqr={selected} onClose={() => setSelected(null)}
                    onUpdate={() => { fetchPQRs(); setSelected(null); }} />
            )}
        </div>
    );
};

export default InternalPQRManagement;
