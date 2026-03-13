import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Eye, Check, X, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import PQRDetail from '../../components/PQR/PQRDetail';

const API_URL = import.meta.env.VITE_API_URL;

const stageLabels = {
    PENDING_REVIEW: 'Revisión Calidad',
    PENDING_BILLING: 'Nota Crédito',
    PENDING_INVOICE: 'Facturación',
    PENDING_LOGISTICS: 'Logística',
    DISPATCHED: 'Despachado',
    COMPLETED: 'Completado',
    REJECTED: 'Rechazado'
};

const stageStyles = {
    PENDING_REVIEW: 'bg-blue-100 text-blue-800',
    PENDING_BILLING: 'bg-amber-100 text-amber-800',
    PENDING_INVOICE: 'bg-indigo-100 text-indigo-800',
    PENDING_LOGISTICS: 'bg-purple-100 text-purple-800',
    DISPATCHED: 'bg-cyan-100 text-cyan-800',
    COMPLETED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800'
};

const statusLabels = {
    PENDING: 'Pendiente',
    IN_REVIEW: 'En Proceso',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    PROCESSED: 'Procesado'
};

const PQRManagement = () => {
    const { token, user } = useAuth();
    const [pqrs, setPqrs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPQR, setSelectedPQR] = useState(null);
    const [filterStatus, setFilterStatus] = useState('ALL');
    const [filterDistributor, setFilterDistributor] = useState('ALL');
    const [recallLots, setRecallLots] = useState([]);
    const [recallDismissed, setRecallDismissed] = useState(false);

    const isAdmin = user?.role === 'ADMIN';

    const fetchPQRs = async (options = {}) => {
        const { showLoader = true } = options;
        if (!token) return;
        try {
            if (showLoader) setLoading(true);
            const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/pqr`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { status: filterStatus !== 'ALL' ? filterStatus : undefined }
            });
            setPqrs(response.data);
        } catch (error) {
            console.error('Error fetching PQRs:', error);
        } finally {
            if (showLoader) setLoading(false);
        }
    };

    const fetchRecallLots = async () => {
        if (!token) return;
        try {
            const res = await axios.get(`${API_URL}/api/pqr/recall-lots`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setRecallLots(res.data || []);
        } catch (e) {
            console.error('Error fetching recall lots:', e);
        }
    };

    useEffect(() => {
        if (!token) return;
        fetchPQRs();
    }, [filterStatus, token]);

    useEffect(() => {
        if (!token) return;
        fetchRecallLots();
    }, [token]);

    const distributorOptions = useMemo(() => {
        const byDistributor = new Map();
        pqrs.forEach((pqr) => {
            const key = pqr.user?.username || pqr.user?.email || pqr.user?.name || 'SIN_DISTRIBUIDOR';
            if (!byDistributor.has(key)) {
                const name = pqr.user?.name || 'Sin nombre';
                const email = pqr.user?.email || '';
                byDistributor.set(key, {
                    key,
                    label: email ? `${name} (${email})` : name
                });
            }
        });
        return Array.from(byDistributor.values()).sort((a, b) =>
            a.label.localeCompare(b.label, 'es', { sensitivity: 'base' })
        );
    }, [pqrs]);

    useEffect(() => {
        if (filterDistributor === 'ALL') return;
        const stillExists = distributorOptions.some((option) => option.key === filterDistributor);
        if (!stillExists) setFilterDistributor('ALL');
    }, [distributorOptions, filterDistributor]);

    const filteredPqrs = useMemo(() => {
        if (filterDistributor === 'ALL') return pqrs;
        return pqrs.filter((pqr) => {
            const key = pqr.user?.username || pqr.user?.email || pqr.user?.name || 'SIN_DISTRIBUIDOR';
            return key === filterDistributor;
        });
    }, [pqrs, filterDistributor]);

    const getStageBadge = (stage) => {
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${stageStyles[stage] || 'bg-gray-100 text-gray-800'}`}>
                {stageLabels[stage] || stage}
            </span>
        );
    };

    const getStatusBadge = (status) => {
        const styles = {
            PENDING: 'bg-yellow-100 text-yellow-800',
            IN_REVIEW: 'bg-blue-100 text-blue-800',
            APPROVED: 'bg-green-100 text-green-800',
            REJECTED: 'bg-red-100 text-red-800',
            PROCESSED: 'bg-emerald-100 text-emerald-800'
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
                {statusLabels[status] || status}
            </span>
        );
    };

    const getRefundBadge = (method) => {
        if (!method) return null;
        if (method === 'WALLET_BALANCE') return <span className="text-xs text-blue-600">💰 Saldo</span>;
        return <span className="text-xs text-purple-600">📦 Reposición</span>;
    };

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Gestión de Calidad y PQR</h1>
                    <p className="text-gray-500">Revise y gestione las solicitudes de garantía</p>
                </div>

                <div className="flex gap-2">
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="ALL">Todos</option>
                        <option value="PENDING">Pendientes</option>
                        <option value="IN_REVIEW">En Proceso</option>
                        <option value="REJECTED">Rechazados</option>
                        <option value="PROCESSED">Procesados</option>
                    </select>
                    <select
                        value={filterDistributor}
                        onChange={(e) => setFilterDistributor(e.target.value)}
                        className="min-w-[240px] border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="ALL">Todos los distribuidores</option>
                        {distributorOptions.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Recall Alerts */}
            {recallLots.length > 0 && !recallDismissed && (
                <div className="mb-6 bg-red-600 rounded-2xl shadow-xl overflow-hidden border-2 border-red-700">
                    <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/20 rounded-xl">
                                    <ShieldAlert size={28} className="text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white">ALERTA DE RECALL — {recallLots.length} LOTE(S) CON ≥10 UNIDADES AFECTADAS</h2>
                                    <p className="text-red-100 text-sm mt-0.5">Estos lotes deben ser retirados de la venta. Informar a los distribuidores de inmediato.</p>
                                </div>
                            </div>
                            <button onClick={() => setRecallDismissed(true)} className="text-red-200 hover:text-white p-1 flex-shrink-0">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {recallLots.map((lot, i) => (
                                <div key={i} className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="font-mono font-black text-white">{lot.lot}</span>
                                        <span className="bg-white text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{lot.quantity} uds</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {lot.flavors.map((f, j) => (
                                            <span key={j} className="bg-red-800/50 text-red-100 text-[11px] px-1.5 py-0.5 rounded font-medium">{f}</span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {recallLots.length > 0 && recallDismissed && (
                <div className="mb-4">
                    <button
                        onClick={() => setRecallDismissed(false)}
                        className="flex items-center gap-2 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-xl border border-red-200 transition-colors"
                    >
                        <ShieldAlert size={16} />
                        {recallLots.length} lote(s) en alerta de recall — Click para ver
                    </button>
                </div>
            )}

            {/* Summary Cards */}
            {isAdmin && filteredPqrs.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                    {Object.entries(
                        filteredPqrs.reduce((acc, p) => {
                            const s = p.stage || 'PENDING_REVIEW';
                            acc[s] = (acc[s] || 0) + 1;
                            return acc;
                        }, {})
                    ).map(([stage, count]) => (
                        <div key={stage} className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm text-center">
                            <p className="text-2xl font-bold text-gray-900">{count}</p>
                            <p className="text-xs text-gray-500 mt-1">{stageLabels[stage] || stage}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="bg-white rounded-lg shadow flex-1 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Distribuidor</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subdistribuidor / Tercero</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Método</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Etapa</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan="9" className="text-center py-4">Cargando...</td></tr>
                            ) : Array.isArray(filteredPqrs) && filteredPqrs.length > 0 ? (
                                filteredPqrs.map((pqr) => (
                                    <tr key={pqr.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">#{pqr.ticketNumber}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{new Date(pqr.createdAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                            {pqr.user?.name}
                                            <div className="text-xs text-gray-400">{pqr.user?.email}</div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                                            {pqr.reportedByName || <span className="text-gray-400">No registrado</span>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-900 max-w-[200px]">
                                            {pqr.items && pqr.items.length > 0 ? (
                                                pqr.items.length > 1 ? (
                                                    <div>
                                                        <span className="font-bold text-blue-600">{pqr.items.length} Productos</span>
                                                    </div>
                                                ) : (
                                                    <div className="truncate">
                                                        {pqr.items[0].product?.name || 'Producto'}
                                                        <div className="text-xs text-gray-400">
                                                            {pqr.items[0].quantity} {pqr.items[0].unit}
                                                        </div>
                                                    </div>
                                                )
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                                            {getRefundBadge(pqr.refundMethod)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {getStageBadge(pqr.stage)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {getStatusBadge(pqr.status)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                            <button
                                                onClick={() => setSelectedPQR(pqr)}
                                                className="text-blue-600 hover:text-blue-900 font-medium hover:underline"
                                            >
                                                Gestionar
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan="9" className="text-center py-8 text-gray-400">No hay PQRs para el filtro seleccionado.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedPQR && (
                <PQRDetail
                    pqr={selectedPQR}
                    onClose={() => setSelectedPQR(null)}
                    onUpdate={() => {
                        fetchPQRs();
                        setSelectedPQR(null);
                    }}
                />
            )}
        </div>
    );
};

export default PQRManagement;
