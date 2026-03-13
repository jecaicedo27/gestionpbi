import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, Loader2, Plus, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PQRForm from '../../components/PQR/PQRForm';
import PQRDetail from '../../components/PQR/PQRDetail';

const API_URL = import.meta.env.VITE_API_URL;

const formatCollectedAt = (value) => {
    if (!value) return '';
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) return '';
    return asDate.toLocaleString('es-CO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const PQRDistributor = () => {
    const { token } = useAuth();
    const [pqrs, setPqrs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [selectedPQR, setSelectedPQR] = useState(null);
    const [recallLots, setRecallLots] = useState([]);
    const [recallDismissed, setRecallDismissed] = useState(false);
    const [updatingLots, setUpdatingLots] = useState({});
    const [lotAnimations, setLotAnimations] = useState({});
    const [recallActionError, setRecallActionError] = useState('');

    const fetchPQRs = async (options = {}) => {
        const { showLoader = true } = options;
        if (!token) return;
        try {
            if (showLoader) setLoading(true);
            const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/pqr`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('PQRs Response Data:', response.data);

            if (Array.isArray(response.data)) {
                setPqrs(response.data);
            } else {
                console.error('API response is not an array:', response.data);
                setPqrs([]);
            }
        } catch (err) {
            console.error('Error fetching PQRs:', err);
            setPqrs([]);
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
            const lots = Array.isArray(res.data) ? res.data : [];
            setRecallLots(lots.map((lot) => ({
                ...lot,
                isCollected: Boolean(lot.isCollected),
                collectedAt: lot.collectedAt || null
            })));
        } catch (e) {
            console.error('Error fetching recall lots:', e);
        }
    };

    const triggerLotAnimation = (lotNumber, mode) => {
        setLotAnimations((prev) => ({ ...prev, [lotNumber]: mode }));
        setTimeout(() => {
            setLotAnimations((prev) => {
                const next = { ...prev };
                delete next[lotNumber];
                return next;
            });
        }, 800);
    };

    const updateLotCollectedStatus = async (lotNumber, nextCollected) => {
        if (!token || !lotNumber) return;
        setRecallActionError('');
        setUpdatingLots((prev) => ({ ...prev, [lotNumber]: true }));

        try {
            const res = await axios.patch(
                `${API_URL}/api/pqr/recall-lots/${encodeURIComponent(lotNumber)}/collection-status`,
                { collected: nextCollected },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const collectedAt = res?.data?.collectedAt || null;
            setRecallLots((prevLots) => prevLots.map((lot) => {
                if (lot.lot !== lotNumber) return lot;
                return {
                    ...lot,
                    isCollected: nextCollected,
                    collectedAt: nextCollected ? collectedAt : null
                };
            }));
            triggerLotAnimation(lotNumber, nextCollected ? 'collected' : 'pending');
        } catch (error) {
            console.error('Error updating lot collected status:', error);
            setRecallActionError('No se pudo actualizar el lote. Intente de nuevo.');
        } finally {
            setUpdatingLots((prev) => ({ ...prev, [lotNumber]: false }));
        }
    };

    useEffect(() => {
        if (!token) return;
        fetchPQRs();
    }, [showForm, token]);

    useEffect(() => {
        if (!token) return;
        fetchRecallLots();
    }, [token]);

    const recallLotsSorted = useMemo(() => {
        return [...recallLots].sort((a, b) => {
            if (a.isCollected !== b.isCollected) return a.isCollected ? 1 : -1;
            return (b.quantity || 0) - (a.quantity || 0);
        });
    }, [recallLots]);

    const recallSummary = useMemo(() => {
        const total = recallLots.length;
        const collected = recallLots.filter((lot) => lot.isCollected).length;
        const pending = total - collected;
        return { total, collected, pending };
    }, [recallLots]);

    const getStatusBadge = (status) => {
        const styles = {
            PENDING: 'bg-yellow-100 text-yellow-800',
            IN_REVIEW: 'bg-blue-100 text-blue-800',
            APPROVED: 'bg-green-100 text-green-800',
            REJECTED: 'bg-red-100 text-red-800',
            PROCESSED: 'bg-purple-100 text-purple-800'
        };
        const labels = {
            PENDING: 'Pendiente',
            IN_REVIEW: 'En Revisión',
            APPROVED: 'Aprobado',
            REJECTED: 'Rechazado',
            PROCESSED: 'Procesado'
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
                {labels[status] || status}
            </span>
        );
    };

    const getStageBadge = (stage) => {
        const stageStyles = {
            PENDING_REVIEW: 'bg-blue-100 text-blue-800',
            PENDING_BILLING: 'bg-amber-100 text-amber-800',
            PENDING_INVOICE: 'bg-indigo-100 text-indigo-800',
            PENDING_LOGISTICS: 'bg-purple-100 text-purple-800',
            COMPLETED: 'bg-emerald-100 text-emerald-800',
            REJECTED: 'bg-red-100 text-red-800'
        };
        const stageLabels = {
            PENDING_REVIEW: 'Revisión Calidad',
            PENDING_BILLING: 'Nota Crédito',
            PENDING_INVOICE: 'Facturación',
            PENDING_LOGISTICS: 'Logística',
            COMPLETED: 'Completado',
            REJECTED: 'Rechazado'
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${stageStyles[stage] || 'bg-gray-100 text-gray-800'}`}>
                {stageLabels[stage] || stage}
            </span>
        );
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mis Garantías y PQRs</h1>
                    <p className="text-gray-500">Gestione sus reportes de daños y solicitudes de garantía</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus size={20} />
                    Nueva Solicitud (PQR)
                </button>
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
                                    <h2 className="text-lg font-black text-white">NOTICIAS IMPORTANTES - ALERTA DE RECALL</h2>
                                    <p className="text-red-100 text-sm mt-0.5">
                                        Los siguientes lotes han sido reportados y <strong>NO deben venderse</strong>.
                                        Marque cada lote como recolectado para llevar control por usuario.
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setRecallDismissed(true)} className="text-red-200 hover:text-white p-1 flex-shrink-0">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className="bg-white text-red-700 text-xs font-black px-3 py-1 rounded-full">
                                Pendientes: {recallSummary.pending}
                            </span>
                            <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-3 py-1 rounded-full">
                                Recolectados: {recallSummary.collected}
                            </span>
                        </div>

                        {recallActionError && (
                            <p className="mt-3 text-xs font-semibold text-yellow-100 bg-red-700/40 border border-red-300/40 rounded-md px-3 py-2">
                                {recallActionError}
                            </p>
                        )}

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {recallLotsSorted.map((lot, i) => {
                                const isUpdating = Boolean(updatingLots[lot.lot]);
                                const isCollected = Boolean(lot.isCollected);
                                const animationType = lotAnimations[lot.lot];
                                const animationClass = animationType ? 'animate-pulse scale-[1.01]' : '';

                                return (
                                    <div
                                        key={`${lot.lot}-${i}`}
                                        className={`backdrop-blur-sm rounded-xl p-4 border transition-all duration-500 transform ${isCollected
                                            ? 'bg-emerald-500/20 border-emerald-200/60'
                                            : 'bg-white/10 border-white/20'
                                            } ${animationClass}`}
                                    >
                                        <div className="flex items-center justify-between mb-2 gap-2">
                                            <span className={`font-mono font-black text-lg ${isCollected ? 'text-emerald-50' : 'text-white'}`}>
                                                {lot.lot}
                                            </span>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${isCollected ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-red-700'}`}>
                                                {lot.quantity} uds
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5">
                                            {lot.flavors.map((f, j) => (
                                                <span
                                                    key={j}
                                                    className={`text-xs px-2 py-0.5 rounded-md font-medium ${isCollected ? 'bg-emerald-800/50 text-emerald-100' : 'bg-red-800/50 text-red-100'}`}
                                                >
                                                    {f}
                                                </span>
                                            ))}
                                        </div>

                                        <p className={`text-[11px] mt-2 font-medium ${isCollected ? 'text-emerald-100' : 'text-red-200'}`}>
                                            {isCollected ? 'Lote marcado como recolectado por su usuario' : 'NO VENDER - Pendiente de recolección'}
                                        </p>

                                        {isCollected && lot.collectedAt && (
                                            <p className="text-[10px] text-emerald-100/90 mt-1">
                                                Marcado: {formatCollectedAt(lot.collectedAt)}
                                            </p>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => updateLotCollectedStatus(lot.lot, !isCollected)}
                                            disabled={isUpdating}
                                            className={`mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isCollected
                                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                                                : 'bg-white text-red-700 border-red-100 hover:bg-red-50'
                                                }`}
                                        >
                                            {isUpdating ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : isCollected ? (
                                                <RotateCcw size={14} />
                                            ) : (
                                                <CheckCircle2 size={14} />
                                            )}
                                            {isCollected ? 'Marcar como NO recolectado' : 'Marcar lote recolectado'}
                                        </button>
                                    </div>
                                );
                            })}
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
                        Hay {recallSummary.pending} lote(s) pendiente(s) de recall{recallSummary.collected > 0 ? ` (${recallSummary.collected} ya recolectados)` : ''} - Click para ver
                    </button>
                </div>
            )}

            {/* List */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ticket</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subdistribuidor / Tercero</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detalle</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Etapa</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nota</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr>
                                    <td colSpan="8" className="px-6 py-4 text-center text-gray-500">Cargando...</td>
                                </tr>
                            ) : Array.isArray(pqrs) && pqrs.length > 0 ? (
                                pqrs.map((pqr) => (
                                    <tr
                                        key={pqr.id}
                                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                                        onClick={() => setSelectedPQR(pqr)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            #{pqr.ticketNumber}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(pqr.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {pqr.items && pqr.items.length > 0 ? (
                                                pqr.items.length > 1 ? (
                                                    <div className="font-medium text-blue-600">{pqr.items.length} Productos</div>
                                                ) : (
                                                    <div>
                                                        {pqr.items[0].product?.name || 'Producto Desconocido'}
                                                        <div className="text-xs text-gray-500">{pqr.items[0].type}</div>
                                                    </div>
                                                )
                                            ) : (
                                                <span className="text-gray-400">Sin detalles</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {pqr.reportedByName ? (
                                                <span className="font-medium">{pqr.reportedByName}</span>
                                            ) : (
                                                <span className="text-gray-400">No registrado</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {pqr.items && pqr.items.length > 0 ? (
                                                pqr.items.length > 1 ? (
                                                    <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">Varios Items</span>
                                                ) : (
                                                    <div>
                                                        {pqr.items[0].quantity} {pqr.items[0].unit || 'Unidades'}
                                                        {pqr.items[0].lotNumber && (
                                                            <div className="text-xs bg-gray-100 px-1 rounded mt-1 inline-block">
                                                                Lote: {pqr.items[0].lotNumber}
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(pqr.status)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStageBadge(pqr.stage)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={pqr.internalNotes}>
                                            {pqr.rejectionReason && <span className="text-red-500 block">Rechazo: {pqr.rejectionReason}</span>}
                                            {pqr.replacementOrderId && <span className="text-green-600 block">Reposición ID: {pqr.replacementOrderId}</span>}
                                            {!pqr.rejectionReason && !pqr.replacementOrderId && '-'}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="8" className="px-6 py-4 text-center text-gray-500">{loading ? '...' : 'No hay solicitudes registradas.'}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showForm && <PQRForm onClose={() => setShowForm(false)} onSuccess={fetchPQRs} />}

            {/* Detail View (Read Only) */}
            {selectedPQR && (
                <PQRDetail
                    pqr={selectedPQR}
                    onClose={() => setSelectedPQR(null)}
                    isReadOnly={true}
                />
            )}
        </div>
    );
};

export default PQRDistributor;
