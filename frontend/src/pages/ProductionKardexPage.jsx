import React, { useState, useEffect } from 'react';
import { Search, Loader2, ArrowUpRight, ArrowDownRight, Fingerprint, Activity, Clock, Camera } from 'lucide-react';
import api from '../services/api';

const ProductionKardexPage = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [products, setProducts] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [kardexData, setKardexData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [previewPhoto, setPreviewPhoto] = useState(null);

    // Search for products
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchTerm.length >= 3) {
                setSearching(true);
                try {
                    const res = await api.get(`/products?search=${searchTerm}`);
                    const results = res.data.data || res.data;
                    setProducts(Array.isArray(results) ? results.slice(0, 8) : []);
                } catch (e) {
                    console.error("Error searching products:", e);
                } finally {
                    setSearching(false);
                }
            } else {
                setProducts([]);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Fetch Kardex
    const fetchKardex = async (product) => {
        setSearchTerm('');
        setProducts([]);
        setSelectedProduct(product);
        setLoading(true);
        try {
            const res = await api.get(`/reports/kardex/production-zone/${product.id}`);
            if (res.data.success) {
                setKardexData(res.data.kardex);
            }
        } catch (e) {
            console.error("Error fetching kardex:", e);
            alert("No se pudo cargar el Kardex de este producto.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-700 to-indigo-600">
                        Kardex Producción
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Libro mayor de inventario transaccional de la Zona de Producción.
                    </p>
                </div>
            </div>

            {/* Selector */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">
                <label className="block text-sm font-bold text-slate-700 mb-2">Buscar Componente o Producto</label>
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Ej. BASE SIROPE CLASICA..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 border-2 border-slate-100 bg-slate-50 rounded-xl focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all text-slate-700 font-medium"
                    />
                    {searching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" size={18} />}
                </div>

                {products.length > 0 && (
                    <div className="absolute z-10 left-6 right-6 top-[90px] bg-white border border-slate-200 shadow-xl rounded-xl overflow-hidden mt-2">
                        {products.map(p => (
                            <button
                                key={p.id}
                                onClick={() => fetchKardex(p)}
                                className="w-full text-left px-5 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center justify-between"
                            >
                                <span className="font-bold text-slate-700">{p.name}</span>
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono border border-slate-200 shadow-sm">
                                    {(p.productionZoneStock || 0).toLocaleString()} {p.unit || 'g'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Kardex View */}
            {selectedProduct && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <div>
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Producto Seleccionado</div>
                            <h2 className="text-xl font-black text-slate-800">{selectedProduct.name}</h2>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Saldo Actual Producción</div>
                            <div className="text-2xl font-black text-indigo-600 bg-indigo-50 px-4 py-1 rounded-lg border border-indigo-100 inline-block">
                                {(selectedProduct.productionZoneStock || 0).toLocaleString()} {selectedProduct.unit || 'g'}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white border-b-2 border-slate-200 text-xs uppercase tracking-widest text-slate-400">
                                    <th className="px-6 py-4 font-bold">Fecha</th>
                                    <th className="px-6 py-4 font-bold">Referencia Operativa</th>
                                    <th className="px-6 py-4 font-bold">Usuario</th>
                                    <th className="px-6 py-4 font-bold text-right">Cantidad</th>
                                    <th className="px-6 py-4 font-bold text-right">Saldo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                                            <Loader2 size={24} className="animate-spin mx-auto mb-2 text-indigo-400" />
                                            Reconstruyendo Kardex...
                                        </td>
                                    </tr>
                                ) : kardexData.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                                            No hay historial transaccional para este producto en la Zona de Producción.
                                        </td>
                                    </tr>
                                ) : (
                                    kardexData.map((row, i) => {
                                        const isPositive = row.delta > 0;
                                        const isGhost = row.type === 'GHOST_INIT';
                                        const isAudit = row.type === 'AUDIT_LOG';

                                        return (
                                            <tr key={row.id + i} className={`hover:bg-slate-50 transition-colors ${isGhost ? 'bg-orange-50/50' : ''} ${isAudit ? 'bg-blue-50/30' : ''}`}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isGhost ? (
                                                        <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-md">ANTERIOR</span>
                                                    ) : (
                                                        <>
                                                            <div className="font-medium text-slate-800 text-sm">
                                                                {new Date(row.date).toLocaleDateString('es-CO')}
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                                                <Clock size={12}/>
                                                                {new Date(row.date).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                                            </div>
                                                        </>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                                        {row.reference}
                                                        {row.photoUrl ? (
                                                            <button onClick={() => setPreviewPhoto(row.photoUrl)} className="ml-2 cursor-pointer focus:outline-none" title="Ver foto de consumo">
                                                                <img src={row.photoUrl} alt="Consumo" className="w-8 h-8 object-cover rounded shadow-sm border border-slate-200 hover:scale-150 transition-transform origin-left" />
                                                            </button>
                                                        ) : (
                                                            (!isPositive && row.delta < 0 && isAudit) && (
                                                                <span className="ml-2 text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded shadow-sm uppercase shrink-0" title="El operario finalizó esta etapa sin adjuntar evidencia del lote consumido">
                                                                    ⚠ SIN FOTO
                                                                </span>
                                                            )
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 uppercase font-medium">
                                                        {isAudit ? <Activity size={12} className="text-blue-500"/> : null}
                                                        {row.operation}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <Fingerprint size={14} className="text-slate-400" />
                                                        <span className="text-sm font-medium text-slate-700">{row.user}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-black border ${isPositive ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                                                        {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                                        {isPositive ? '+' : ''}{row.delta.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="text-lg font-black text-slate-800 font-mono">
                                                        {row.balance.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal de foto */}
            {previewPhoto && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={() => setPreviewPhoto(null)}
                >
                    <div className="relative max-w-4xl max-h-screen">
                        <button 
                            className="absolute -top-12 right-0 text-white hover:text-rose-400 p-2"
                            onClick={() => setPreviewPhoto(null)}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        <img 
                            src={previewPhoto} 
                            alt="Evidencia Positiva" 
                            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
                            onClick={(e) => e.stopPropagation()} 
                        />
                    </div>
                </div>
            )}

        </div>
    );
};

export default ProductionKardexPage;
