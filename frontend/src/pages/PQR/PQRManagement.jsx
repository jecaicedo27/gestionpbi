import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Filter, Eye, Check, X, ChevronLeft, ChevronRight, ShieldAlert, ChevronDown, ChevronUp, FileSpreadsheet, Copy, ClipboardCheck, Upload, CheckSquare, Square } from 'lucide-react';
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
    const [activeTab, setActiveTab] = useState('pqrs');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkUpload, setBulkUpload] = useState(null); // { creditNote: File|null, accountStatement: File|null }
    const [bulkUploading, setBulkUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);

    const isAdmin = user?.role === 'ADMIN';
    const isAccounting = user?.role === 'CONTABILIDAD';


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

    const [copied, setCopied] = useState(false);

    // ─── Bulk Upload Handler ─────────────────────────────
    const handleBulkUpload = async () => {
        if (!bulkUpload?.creditNote || !bulkUpload?.accountStatement) {
            alert('Debes subir la nota crédito y el estado de cuenta.');
            return;
        }
        setBulkUploading(true);
        try {
            const formData = new FormData();
            formData.append('pqrIds', JSON.stringify([...selectedIds]));
            formData.append('file', bulkUpload.creditNote);
            formData.append('accountStatement', bulkUpload.accountStatement);

            const res = await axios.post(`${API_URL}/api/pqr/bulk-billing`, formData, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            setBulkResult(res.data);
            setSelectedIds(new Set());
            setBulkUpload(null);
            fetchPQRs({ showLoader: false });
        } catch (err) {
            alert(err.response?.data?.error || 'Error al subir documentos masivos');
        } finally {
            setBulkUploading(false);
        }
    };

    const selectedDistributorName = useMemo(() => {
        if (filterDistributor === 'ALL') return 'Todos los distribuidores';
        const opt = distributorOptions.find(o => o.key === filterDistributor);
        return opt?.label || filterDistributor;
    }, [filterDistributor, distributorOptions]);

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

    // Credit Note Summary — product breakdown for PQRs without creditNoteId
    const creditNoteSummary = useMemo(() => {
        const pending = filteredPqrs.filter(p => !p.creditNoteId && p.stage !== 'REJECTED' && p.stage !== 'COMPLETED');
        if (pending.length === 0) return null;
        const products = {};
        let totalUnits = 0;
        for (const pqr of pending) {
            for (const item of (pqr.items || [])) {
                const sku = item.product?.sku || '-';
                const name = item.product?.name || item.description || 'N/A';
                const key = sku;
                if (!products[key]) products[key] = { sku, name, qty: 0, motivos: {}, metodos: {}, tickets: new Set() };
                products[key].qty += item.quantity;
                const tipo = item.type || 'N/A';
                products[key].motivos[tipo] = (products[key].motivos[tipo] || 0) + item.quantity;
                // Track refund method
                const metodo = pqr.refundMethod === 'PHYSICAL_REPLACEMENT' ? 'Reposición' : 'Saldo';
                products[key].metodos[metodo] = (products[key].metodos[metodo] || 0) + item.quantity;
                products[key].tickets.add(pqr.ticketNumber);
                totalUnits += item.quantity;
            }
        }
        const sorted = Object.values(products).sort((a, b) => b.qty - a.qty);
        return { products: sorted, totalUnits, totalPqrs: pending.length };
    }, [filteredPqrs]);

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

                <div className="flex gap-3 items-center">
                    <div className="relative">
                        <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="pl-8 pr-4 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer hover:border-gray-300 transition-colors"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.2em 1.2em', paddingRight: '2rem' }}
                        >
                            <option value="ALL">📋 Todos</option>
                            <option value="PENDING">⏳ Pendientes</option>
                            <option value="IN_REVIEW">🔄 En Proceso</option>
                            <option value="REJECTED">❌ Rechazados</option>
                            <option value="PROCESSED">✅ Procesados</option>
                        </select>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <select
                            value={filterDistributor}
                            onChange={(e) => setFilterDistributor(e.target.value)}
                            className="pl-8 pr-4 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer hover:border-gray-300 transition-colors min-w-[280px]"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.2em 1.2em', paddingRight: '2rem' }}
                        >
                            <option value="ALL">👥 Todos los distribuidores</option>
                            {distributorOptions.map((option) => (
                                <option key={option.key} value={option.key}>{option.label}</option>
                            ))}
                        </select>
                    </div>
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

            {/* Tab Navigation — only for ADMIN / CONTABILIDAD */}
            {(isAdmin || isAccounting) && creditNoteSummary && (
                <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('pqrs')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                            activeTab === 'pqrs'
                                ? 'bg-white shadow-sm text-gray-900'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        📋 PQRs
                    </button>
                    <button
                        onClick={() => setActiveTab('credit')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
                            activeTab === 'credit'
                                ? 'bg-amber-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <FileSpreadsheet size={14} />
                        Nota Crédito
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                            activeTab === 'credit' ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'
                        }`}>
                            {creditNoteSummary.totalPqrs}
                        </span>
                    </button>
                </div>
            )}

            {/* Credit Note Summary Tab */}
            {activeTab === 'credit' && (isAdmin || isAccounting) && creditNoteSummary && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 overflow-hidden flex flex-col">
                    <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center justify-between">
                        <div>
                            <h2 className="text-base font-bold text-amber-900">Resumen para Nota Crédito Genérica</h2>
                            <p className="text-xs text-amber-700 mt-0.5">
                                {creditNoteSummary.totalPqrs} PQRs • {creditNoteSummary.totalUnits.toLocaleString('es-CO')} unidades • {creditNoteSummary.products.length} productos
                                {filterDistributor !== 'ALL' && <span className="font-semibold"> • {selectedDistributorName}</span>}
                            </p>
                        </div>
                        <button
                            onClick={() => {
                                const lines = ['Nota Crédito por devolución de producto — Reportes de Calidad (PQR)', ''];
                                if (filterDistributor !== 'ALL') lines.push(`Distribuidor: ${selectedDistributorName}`, '');
                                lines.push(`Aplicación de nota crédito correspondiente a ${creditNoteSummary.totalPqrs} reportes de calidad (PQR). Detalle:`, '');
                                for (const p of creditNoteSummary.products) {
                                    const tickets = [...p.tickets].join(', ');
                                    const metodo = Object.entries(p.metodos).map(([m, q]) => `${m}: ${q}`).join(', ');
                                    lines.push(`- ${p.sku} — ${p.name} — ${p.qty} uds — ${metodo} (${tickets})`);
                                }
                                lines.push('', `Total: ${creditNoteSummary.totalUnits.toLocaleString('es-CO')} unidades`);
                                lines.push('', `Tickets: ${creditNoteSummary.products.flatMap(p => [...p.tickets]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
                                navigator.clipboard.writeText(lines.join('\n'));
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2500);
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                copied
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-white text-amber-800 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 shadow-sm'
                            }`}
                        >
                            {copied ? <><ClipboardCheck size={15} /> ¡Copiado!</> : <><Copy size={15} /> Copiar Observación</>}
                        </button>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Código</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Producto</th>
                                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">Cantidad</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Motivo</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Método</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase"># PQR</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {creditNoteSummary.products.map((p, i) => (
                                    <tr key={p.sku} className={`hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                                        <td className="px-4 py-2.5 font-mono font-bold text-xs text-gray-700">{p.sku}</td>
                                        <td className="px-4 py-2.5 text-gray-900 font-medium">
                                            <div>{p.name}</div>
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-extrabold text-gray-900 text-base tabular-nums">{p.qty}</td>
                                        <td className="px-4 py-2.5">
                                            {Object.entries(p.motivos).map(([tipo, qty]) => (
                                                <span key={tipo} className="inline-block text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold mr-1">
                                                    {tipo}: {qty}
                                                </span>
                                            ))}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {Object.entries(p.metodos).map(([met, qty]) => (
                                                <span key={met} className={`inline-block text-xs px-2 py-0.5 rounded-full font-semibold mr-1 ${
                                                    met === 'Saldo' ? 'bg-emerald-50 text-emerald-700' : 'bg-purple-50 text-purple-700'
                                                }`}>
                                                    {met === 'Saldo' ? '💰' : '📦'} {met}: {qty}
                                                </span>
                                            ))}
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[300px]">
                                            <div className="truncate" title={[...p.tickets].join(', ')}>
                                                {[...p.tickets].join(', ')}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-amber-50 font-bold border-t-2 border-amber-200">
                                    <td className="px-4 py-3" colSpan="2">TOTAL</td>
                                    <td className="px-4 py-3 text-right text-lg tabular-nums">{creditNoteSummary.totalUnits.toLocaleString('es-CO')}</td>
                                    <td className="px-4 py-3"></td>
                                    <td className="px-4 py-3"></td>
                                    <td className="px-4 py-3 text-xs">{creditNoteSummary.totalPqrs} PQRs</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* PQR List Tab */}
            {activeTab === 'pqrs' && (
            <div className="bg-white rounded-lg shadow flex-1 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-2 py-3 text-center w-10">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 accent-purple-600 cursor-pointer"
                                        checked={filteredPqrs.filter(p => p.status !== 'PROCESSED' && p.stage !== 'COMPLETED' && p.stage !== 'REJECTED').length > 0 && selectedIds.size === filteredPqrs.filter(p => p.status !== 'PROCESSED' && p.stage !== 'COMPLETED' && p.stage !== 'REJECTED').length}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedIds(new Set(filteredPqrs.filter(p => p.status !== 'PROCESSED' && p.stage !== 'COMPLETED' && p.stage !== 'REJECTED').map(p => p.id)));
                                            } else {
                                                setSelectedIds(new Set());
                                            }
                                        }}
                                    />
                                </th>
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
                                <tr><td colSpan="10" className="text-center py-4">Cargando...</td></tr>
                            ) : Array.isArray(filteredPqrs) && filteredPqrs.length > 0 ? (
                                filteredPqrs.map((pqr) => (
                                    <tr key={pqr.id} className={`hover:bg-gray-50 transition-colors ${
                                        pqr.pendingAdjustment ? 'bg-orange-50/60 border-l-2 border-l-orange-400' :
                                        selectedIds.has(pqr.id) ? 'bg-purple-50' : ''
                                    }`}>
                                        <td className="px-2 py-3 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 accent-purple-600 cursor-pointer"
                                                disabled={pqr.status === 'PROCESSED' || pqr.stage === 'COMPLETED' || pqr.stage === 'REJECTED'}
                                                checked={selectedIds.has(pqr.id)}
                                                onChange={(e) => {
                                                    setSelectedIds(prev => {
                                                        const next = new Set(prev);
                                                        if (e.target.checked) next.add(pqr.id);
                                                        else next.delete(pqr.id);
                                                        return next;
                                                    });
                                                }}
                                            />
                                        </td>
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
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {getStageBadge(pqr.stage)}
                                                {pqr.pendingAdjustment && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 whitespace-nowrap">🔧 Ajuste</span>
                                                )}
                                            </div>
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
                                <tr><td colSpan="10" className="text-center py-8 text-gray-400">No hay PQRs para el filtro seleccionado.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* ── FLOATING BULK ACTION BAR ── */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-purple-700 to-indigo-700 text-white rounded-2xl shadow-2xl px-6 py-3 flex items-center gap-4 animate-in slide-in-from-bottom">
                    <span className="font-bold text-sm">{selectedIds.size} PQR{selectedIds.size > 1 ? 's' : ''} seleccionado{selectedIds.size > 1 ? 's' : ''}</span>
                    <div className="w-px h-6 bg-white/30" />
                    <button
                        onClick={() => setBulkUpload({ creditNote: null, accountStatement: null })}
                        className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition-colors"
                    >
                        <Upload size={16} /> Adjuntar Nota Crédito + Estado de Cuenta
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-colors"
                    >
                        <X size={14} /> Deseleccionar
                    </button>
                </div>
            )}

            {/* ── BULK UPLOAD MODAL ── */}
            {bulkUpload && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setBulkUpload(null); setBulkResult(null); }}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                            <h3 className="text-white font-bold text-lg">Adjuntar Documentos a {selectedIds.size} PQRs</h3>
                            <p className="text-purple-200 text-sm">Los mismos archivos se aplicarán a todos los PQRs seleccionados</p>
                        </div>
                        <div className="p-6 space-y-4">
                            {bulkResult ? (
                                <div className="text-center py-4">
                                    <div className="text-4xl mb-2">✅</div>
                                    <p className="font-bold text-green-700 text-lg">{bulkResult.message}</p>
                                    <div className="mt-3 text-sm text-gray-600 max-h-40 overflow-auto">
                                        {bulkResult.results?.map(r => (
                                            <div key={r.id} className="flex justify-between py-1">
                                                <span className="font-mono">{r.ticket}</span>
                                                <span className={r.newStage === 'COMPLETED' ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                                    {r.newStage === 'COMPLETED' ? '✅ Completado' : '📋 Facturación'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => { setBulkUpload(null); setBulkResult(null); }} className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700">Cerrar</button>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">📎 Nota Crédito (PDF)</label>
                                        <input
                                            type="file"
                                            accept=".pdf,image/*"
                                            onChange={(e) => setBulkUpload(prev => ({ ...prev, creditNote: e.target.files[0] }))}
                                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-purple-100 file:text-purple-700 file:font-semibold file:cursor-pointer hover:file:bg-purple-200"
                                        />
                                        {bulkUpload.creditNote && <p className="text-xs text-green-600 mt-1">✓ {bulkUpload.creditNote.name}</p>}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">📎 Estado de Cuenta (PDF)</label>
                                        <input
                                            type="file"
                                            accept=".pdf,image/*"
                                            onChange={(e) => setBulkUpload(prev => ({ ...prev, accountStatement: e.target.files[0] }))}
                                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:text-indigo-700 file:font-semibold file:cursor-pointer hover:file:bg-indigo-200"
                                        />
                                        {bulkUpload.accountStatement && <p className="text-xs text-green-600 mt-1">✓ {bulkUpload.accountStatement.name}</p>}
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={() => { setBulkUpload(null); setBulkResult(null); }}
                                            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-semibold hover:bg-gray-50"
                                        >Cancelar</button>
                                        <button
                                            onClick={handleBulkUpload}
                                            disabled={bulkUploading || !bulkUpload.creditNote || !bulkUpload.accountStatement}
                                            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-bold hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {bulkUploading ? (
                                                <>⏳ Subiendo...</>
                                            ) : (
                                                <>✓ Aplicar a {selectedIds.size} PQRs</>
                                            )}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
