import React, { useState } from 'react';
import api from '../services/api';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Copy, ChevronDown, ChevronUp } from 'lucide-react';

const Badge = ({ children, color = 'slate' }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-${color}-100 text-${color}-700`}>
        {children}
    </span>
);

const fmtQty = (q) => {
    if (q === null || q === undefined) return '—';
    return Number(q).toLocaleString('es-CO', { maximumFractionDigits: 1 });
};

const Section = ({ title, icon: Icon, count, color = 'slate', defaultOpen = true, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={`border-2 border-${color}-200 rounded-2xl overflow-hidden`}>
            <button onClick={() => setOpen(!open)}
                className={`w-full flex items-center gap-3 px-5 py-3 bg-${color}-50 hover:bg-${color}-100 transition-colors`}>
                {Icon && <Icon size={18} className={`text-${color}-600`} />}
                <span className="font-black text-sm text-slate-800">{title}</span>
                {count !== undefined && <Badge color={color}>{count}</Badge>}
                <div className="flex-1" />
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {open && <div className="p-4">{children}</div>}
        </div>
    );
};

export default function InventoryAuditPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('ALL');

    const runAudit = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/inventory-audit/run');
            setData(res.data);
        } catch (err) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    };

    const filtered = (data?.discrepancies || []).filter(d => {
        if (typeFilter !== 'ALL' && d.type !== typeFilter) return false;
        if (filter && !d.name.toLowerCase().includes(filter.toLowerCase()) && !d.sku.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
    });

    const summary = data?.summary || {};

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Auditoría Inventario</h1>
                    <p className="text-sm text-slate-500">Compara stock entre Siigo y la app en tiempo real</p>
                </div>
                <button onClick={runAudit} disabled={loading}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${
                        loading ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl active:scale-95'
                    }`}>
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    {loading ? 'Consultando Siigo...' : 'Ejecutar Auditoría'}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border-2 border-red-300 rounded-xl px-4 py-3 mb-4 text-red-700 text-sm font-bold">
                    {error}
                </div>
            )}

            {!data && !loading && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <AlertTriangle size={48} className="mb-3 opacity-30" />
                    <p className="text-lg font-bold">Presiona "Ejecutar Auditoría" para iniciar</p>
                    <p className="text-sm mt-1">Se conectará a Siigo y comparará con los lotes de la app</p>
                </div>
            )}

            {data && (
                <div className="space-y-4">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-white rounded-xl border p-4 text-center">
                            <div className="text-2xl font-black text-slate-700">{summary.totalProductsChecked}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">Productos App</div>
                        </div>
                        <div className="bg-white rounded-xl border p-4 text-center">
                            <div className="text-2xl font-black text-blue-600">{summary.totalSiigoProducts}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">Productos Siigo</div>
                        </div>
                        <div className={`rounded-xl border p-4 text-center ${summary.discrepancies > 0 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'}`}>
                            <div className={`text-2xl font-black ${summary.discrepancies > 0 ? 'text-amber-600' : 'text-green-600'}`}>{summary.discrepancies}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">Discrepancias</div>
                        </div>
                        <div className={`rounded-xl border p-4 text-center ${summary.duplicateRpas > 0 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                            <div className={`text-2xl font-black ${summary.duplicateRpas > 0 ? 'text-red-600' : 'text-green-600'}`}>{summary.duplicateRpas}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">RPAs Duplicados</div>
                        </div>
                        <div className={`rounded-xl border p-4 text-center ${summary.rpaFailures > 0 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                            <div className={`text-2xl font-black ${summary.rpaFailures > 0 ? 'text-red-600' : 'text-green-600'}`}>{summary.rpaFailures}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">RPAs Fallidos</div>
                        </div>
                    </div>

                    <div className="text-[10px] text-slate-400 text-right">
                        Generado: {new Date(data.timestamp).toLocaleString('es-CO')}
                    </div>

                    {/* Discrepancies */}
                    <Section title="Discrepancias Siigo vs App" icon={AlertTriangle} count={filtered.length} color="amber">
                        <div className="flex flex-wrap gap-2 mb-3">
                            <input value={filter} onChange={e => setFilter(e.target.value)}
                                placeholder="Buscar producto..."
                                className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm" />
                            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                                className="px-3 py-2 border rounded-lg text-sm font-bold">
                                <option value="ALL">Todos</option>
                                <option value="RAW_MATERIAL">Materia Prima</option>
                                <option value="FINISHED_PRODUCT">Producto Terminado</option>
                                <option value="INTERMEDIATE">Intermedio</option>
                                <option value="PACKAGING">Empaque</option>
                            </select>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-100 text-left">
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs">SKU</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs">PRODUCTO</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs">TIPO</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs text-right">SIIGO</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs text-right">APP (LOTES)</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 text-xs text-right">DIFERENCIA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((d, i) => {
                                        const isNeg = d.diffSiigoVsLots < 0;
                                        const isHigh = Math.abs(d.diffSiigoVsLots) > 1000;
                                        return (
                                            <tr key={i} className={`border-b hover:bg-slate-50 ${isHigh ? 'bg-amber-50/50' : ''}`}>
                                                <td className="px-3 py-2 font-mono text-xs text-slate-500">{d.sku}</td>
                                                <td className="px-3 py-2 font-bold text-slate-700 max-w-[250px] truncate">{d.name}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                        d.type === 'RAW_MATERIAL' ? 'bg-violet-100 text-violet-700' :
                                                        d.type === 'FINISHED_PRODUCT' ? 'bg-emerald-100 text-emerald-700' :
                                                        d.type === 'PACKAGING' ? 'bg-orange-100 text-orange-700' :
                                                        'bg-slate-100 text-slate-600'
                                                    }`}>{d.type === 'RAW_MATERIAL' ? 'MP' : d.type === 'FINISHED_PRODUCT' ? 'PT' : d.type === 'PACKAGING' ? 'EMP' : d.type?.slice(0,4)}</span>
                                                </td>
                                                <td className="px-3 py-2 text-right font-bold text-blue-600">{fmtQty(d.siigoQty)}</td>
                                                <td className="px-3 py-2 text-right font-bold text-slate-600">{fmtQty(d.appLotStock)}</td>
                                                <td className={`px-3 py-2 text-right font-black ${isNeg ? 'text-red-600' : 'text-amber-600'}`}>
                                                    {isNeg ? '' : '+'}{fmtQty(d.diffSiigoVsLots)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filtered.length === 0 && (
                                <div className="text-center py-8 text-slate-400 text-sm">
                                    {data.discrepancies?.length === 0 ? 'Sin discrepancias' : 'Sin resultados para este filtro'}
                                </div>
                            )}
                        </div>
                    </Section>

                    {/* Duplicate RPAs */}
                    {data.duplicateRpas?.length > 0 && (
                        <Section title="RPAs Duplicados (misma nota, múltiples ejecuciones exitosas)" icon={Copy} count={data.duplicateRpas.length} color="red">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-100 text-left">
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">PRODUCTO</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">CANTIDAD</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">NOTA SIIGO</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">FECHA</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">NOTA ASSEMBLY</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.duplicateRpas.map((r, i) => (
                                            <tr key={i} className="border-b hover:bg-red-50/50">
                                                <td className="px-3 py-2 font-bold text-slate-700">{r.productName}</td>
                                                <td className="px-3 py-2 font-bold text-slate-600">{fmtQty(r.quantity)}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-blue-600">{r.siigoNoteCode || '—'}</td>
                                                <td className="px-3 py-2 text-xs text-slate-500">
                                                    {r.startedAt ? new Date(r.startedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.assemblyNoteId?.slice(0, 8)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>
                    )}

                    {/* RPA Failures */}
                    {data.rpaFailures?.length > 0 && (
                        <Section title="RPAs Fallidos (últimos 7 días)" icon={XCircle} count={data.rpaFailures.length} color="red" defaultOpen={false}>
                            <div className="space-y-2">
                                {data.rpaFailures.map((r, i) => (
                                    <div key={i} className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
                                        <XCircle size={16} className="text-red-500 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-sm text-slate-700 truncate">{r.productName}</div>
                                            <div className="text-xs text-red-500 truncate">{r.errorMessage || 'Sin mensaje de error'}</div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="font-bold text-sm text-slate-600">{fmtQty(r.quantity)}</div>
                                            <div className="text-[10px] text-slate-400">
                                                {r.startedAt ? new Date(r.startedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Orphan Consumptions */}
                    {data.orphanConsumptions?.length > 0 && (
                        <Section title="Consumos Huérfanos (nota eliminada, consumo persiste)" icon={AlertTriangle} count={data.orphanConsumptions.length} color="orange" defaultOpen={false}>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-100 text-left">
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">MATERIAL</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">LOTE</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs text-right">CANTIDAD</th>
                                            <th className="px-3 py-2 font-bold text-slate-500 text-xs">FECHA</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.orphanConsumptions.map((c, i) => (
                                            <tr key={i} className="border-b">
                                                <td className="px-3 py-2 font-bold text-slate-700">{c.siigoProductName}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.lotNumber}</td>
                                                <td className="px-3 py-2 text-right font-bold text-orange-600">{fmtQty(c.quantityUsed)}</td>
                                                <td className="px-3 py-2 text-xs text-slate-500">
                                                    {c.usedAt ? new Date(c.usedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>
                    )}

                    {/* All green */}
                    {summary.discrepancies === 0 && summary.duplicateRpas === 0 && summary.rpaFailures === 0 && (
                        <div className="bg-green-50 border-2 border-green-400 rounded-2xl px-6 py-8 text-center">
                            <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                            <div className="text-xl font-black text-green-700">Inventario cuadrado</div>
                            <div className="text-sm text-green-500 mt-1">Siigo y la app coinciden en todos los productos</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
