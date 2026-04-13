import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { 
    Search, AlertCircle, RefreshCw, CheckCircle2, 
    XCircle, Clock, ChevronDown, ChevronUp, FileSpreadsheet, ArrowRight
} from 'lucide-react';
import { Link } from 'react-router-dom';

const ProductionAuditPage = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filterProcess, setFilterProcess] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [batchLimit, setBatchLimit] = useState(50); // Default a 50 lotes

    const fetchAuditData = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await api.get(`/audit?limit=${batchLimit}`);
            if (response.data.success) {
                setData(response.data.data);
            } else {
                throw new Error("Error fetching audit data");
            }
        } catch (err) {
            console.error("Error fetching audit report:", err);
            setError("Falló la conexión al servidor de auditoría.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAuditData();
    }, [batchLimit]);

    const filteredData = useMemo(() => {
        return data.filter(item => {
            const matchesProcess = filterProcess === 'ALL' || item.process === filterProcess;
            const matchesSearch = item.batchNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.component.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesProcess && matchesSearch;
        });
    }, [data, filterProcess, searchTerm]);

    const uniqueProcesses = ['ALL', ...new Set(data.map(item => item.process))];

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-primary-400">
                        Auditoría de Lotes
                    </h1>
                    <p className="text-neutral-500 mt-1">
                        Monitoreo en tiempo real de consumos proyectados vs. reales.
                    </p>
                    <Link to="/production/kardex" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-all">
                        Ir al Kardex de Bodega (Ledger) <ArrowRight size={14} />
                    </Link>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={batchLimit}
                        onChange={(e) => setBatchLimit(Number(e.target.value))}
                        className="px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white outline-none cursor-pointer text-sm font-medium text-neutral-600"
                    >
                        <option value={20}>Últimos 20 Lotes</option>
                        <option value={50}>Últimos 50 Lotes</option>
                        <option value={100}>Últimos 100 Lotes</option>
                        <option value={250}>Últimos 250 Lotes</option>
                        <option value={500}>Últimos 500 Lotes</option>
                        <option value={1000}>Últimos 1000 Lotes</option>
                        <option value={5000}>Hasta 5000 Lotes</option>
                    </select>
                    <button
                        onClick={fetchAuditData}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:shadow-sm transition-all text-sm font-medium"
                    >
                        <RefreshCw size={18} className={`${loading ? 'animate-spin text-primary-500' : 'text-neutral-600'}`} />
                        <span className="text-neutral-700">Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/80 backdrop-blur-xl border border-neutral-200/60 shadow-lg shadow-neutral-200/20 p-6 rounded-2xl relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl"></div>
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-sm font-medium text-neutral-500">Registros Auditados</p>
                            <h3 className="text-3xl font-bold text-neutral-800 mt-1">{data.length}</h3>
                        </div>
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <FileSpreadsheet size={24} />
                        </div>
                    </div>
                </div>
                
                <div className="bg-white/80 backdrop-blur-xl border border-neutral-200/60 shadow-lg shadow-neutral-200/20 p-6 rounded-2xl relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-red-500/10 rounded-full blur-2xl"></div>
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-sm font-medium text-neutral-500">Descuadres Críticos</p>
                            <h3 className="text-3xl font-bold text-neutral-800 mt-1">
                                {data.filter(d => d.diff < 0).length}
                            </h3>
                        </div>
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                            <AlertCircle size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white/80 backdrop-blur-xl border border-neutral-200/60 shadow-lg shadow-neutral-200/20 p-6 rounded-2xl relative overflow-hidden">
                     <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl"></div>
                     <div className="flex items-start justify-between">
                         <div>
                             <p className="text-sm font-medium text-neutral-500">Alineados</p>
                             <h3 className="text-3xl font-bold text-neutral-800 mt-1">
                                 {data.filter(d => d.diff >= 0 && d.actual > 0).length}
                             </h3>
                         </div>
                         <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                             <CheckCircle2 size={24} />
                         </div>
                     </div>
                 </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-xl border border-neutral-200 shadow-sm">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por lote o componente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-sm"
                    />
                </div>
                <div className="w-full md:w-64">
                    <select
                        value={filterProcess}
                        onChange={(e) => setFilterProcess(e.target.value)}
                        className="w-full px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white outline-none cursor-pointer text-sm"
                    >
                        {uniqueProcesses.map(p => (
                            <option key={p} value={p}>{p === 'ALL' ? 'Todos los procesos' : p}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-neutral-50 border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500">
                                <th className="px-6 py-4 font-semibold">Fecha</th>
                                <th className="px-6 py-4 font-semibold">Lote</th>
                                <th className="px-6 py-4 font-semibold">Proceso</th>
                                <th className="px-6 py-4 font-semibold">Componente</th>
                                <th className="px-4 py-4 font-semibold text-right">Planeado</th>
                                <th className="px-4 py-4 font-semibold text-right">Real / Contado</th>
                                <th className="px-4 py-4 font-semibold text-right">Consumido</th>
                                <th className="px-6 py-4 font-semibold text-right">Diff</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {loading ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-neutral-400">
                                        <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-primary-400" />
                                        Cargando auditoría...
                                    </td>
                                </tr>
                            ) : error ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-red-500">
                                        <AlertCircle size={24} className="mx-auto mb-2" />
                                        {error}
                                    </td>
                                </tr>
                            ) : filteredData.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-neutral-500">
                                        No se encontraron datos que coincidan con la búsqueda.
                                    </td>
                                </tr>
                            ) : (
                                filteredData.map((row) => {
                                    const diff = row.diff;
                                    const isCritical = diff < 0;
                                    const isWarning = row.consumed === 0 && row.actual > 0;
                                    
                                    return (
                                        <tr key={row.id} className="hover:bg-neutral-50/50 transition-colors">
                                            <td className="px-6 py-4 border-r border-neutral-50 whitespace-nowrap">
                                                <div className="font-medium text-neutral-800 text-sm">
                                                    {new Date(row.date).toLocaleDateString('es-CO')}
                                                </div>
                                                <div className="text-xs text-neutral-500 mt-1">
                                                    {new Date(row.date).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 border-r border-neutral-50">
                                                <div className="font-medium text-neutral-800 text-sm">{row.batchNumber}</div>
                                                <div className="text-xs text-neutral-500 mt-1">{row.type}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700">
                                                    {row.process}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-neutral-700 font-medium">
                                                {row.component}
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-neutral-400 font-normal">{row.componentType}</span>
                                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm ${row.direction === 'Entrada' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                                                        {row.direction}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-right text-sm text-neutral-600 bg-neutral-50/30">
                                                {Math.round(row.planned)}
                                            </td>
                                            <td className="px-4 py-4 text-right text-sm font-semibold text-neutral-700">
                                                {row.status !== 'COMPLETED' ? '-' : Math.round(row.actual)}
                                            </td>
                                            <td className="px-4 py-4 text-right text-sm text-neutral-600 bg-neutral-50/30">
                                                {row.status !== 'COMPLETED' ? '-' : Math.round(row.consumed)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm font-bold">
                                                {row.status !== 'COMPLETED' ? (
                                                    <span className="text-blue-600 bg-blue-50 px-2.5 py-1 text-xs rounded-md border border-blue-100 flex items-center gap-1 w-max ml-auto">
                                                        <Clock size={14} />
                                                        En Proceso
                                                    </span>
                                                ) : diff === 0 ? (
                                                    <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Perfecto</span>
                                                ) : isCritical ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 text-red-700 border border-red-100">
                                                        <AlertCircle size={14} />
                                                        {Math.round(diff)}
                                                    </span>
                                                ) : isWarning ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-yellow-50 text-yellow-700 border border-yellow-100">
                                                        <XCircle size={14} />
                                                        Sin descontar
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-500">+{Math.round(diff)}</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ProductionAuditPage;
