import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, RefreshCw, Search, Printer, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';

const PrintLabelsPage = () => {
    const navigate = useNavigate();
    const [labels, setLabels] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);  // product object
    const [qty, setQty] = useState('');
    const [obs, setObs] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [msg, setMsg] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [r1, r2] = await Promise.all([
                api.get('/print/labels'),
                api.get('/print/history?limit=20'),
            ]);
            setLabels(r1.data?.data || []);
            setHistory(r2.data?.data || []);
        } catch (e) { console.warn('load', e.message); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

    const filtered = useMemo(() => {
        const s = (search || '').trim().toLowerCase();
        if (!s) return labels;
        return labels.filter(l => l.sku.toLowerCase().includes(s) || l.name.toLowerCase().includes(s));
    }, [labels, search]);

    const summary = useMemo(() => {
        const negativos = labels.filter(l => l.isNegative);
        const necesitanImpr = labels.filter(l => l.needsPrint && !l.isNegative);
        return {
            total: labels.length,
            negativos: negativos.length,
            negativosTotal: negativos.reduce((a, l) => a + Math.abs(l.currentStock), 0),
            necesitanImpr: necesitanImpr.length,
        };
    }, [labels]);

    const submit = async () => {
        if (!selected || !(parseInt(qty, 10) > 0)) return;
        setSubmitting(true); setMsg(null);
        try {
            const r = await api.post('/print/register', { productId: selected.id, quantity: parseInt(qty, 10), observations: obs });
            setMsg({ type: 'success', text: r.data?.message || 'Encolado al RPA Siigo' });
            setSelected(null); setQty(''); setObs('');
            await load();
        } catch (e) {
            setMsg({ type: 'error', text: e.response?.data?.error || e.message });
        } finally { setSubmitting(false); }
    };

    const StatusBadge = ({ s }) => {
        const cfg = {
            'RUNNING': { bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock, label: 'En curso' },
            'SUCCESS': { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle, label: 'OK' },
            'FAILED':  { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle, label: 'Falló' },
            'PENDING': { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock, label: 'Pendiente' },
        }[s] || { bg: 'bg-slate-100', text: 'text-slate-600', icon: Clock, label: s };
        const Icon = cfg.icon;
        return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${cfg.bg} ${cfg.text}`}><Icon size={10} /> {cfg.label}</span>;
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100">
                            <ChevronLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">🖨️ Imprimir Etiquetas</h1>
                            <p className="text-xs text-slate-500">Selecciona la etiqueta y la cantidad — el sistema enviará el ensamble a Siigo</p>
                        </div>
                    </div>
                    <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Recargar
                    </button>
                </div>

                {/* Resumen */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-white rounded-xl p-3 border border-slate-200">
                        <div className="text-[11px] text-slate-500 uppercase font-bold">Etiquetas activas</div>
                        <div className="text-2xl font-black text-slate-700">{summary.total}</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                        <div className="text-[11px] text-red-700 uppercase font-bold">⛔ En negativo</div>
                        <div className="text-2xl font-black text-red-700">{summary.negativos}</div>
                        <div className="text-[10px] text-red-600">faltan {summary.negativosTotal.toLocaleString('es-CO')} unds</div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
                        <div className="text-[11px] text-amber-700 uppercase font-bold">⚠️ Bajo mínimo</div>
                        <div className="text-2xl font-black text-amber-700">{summary.necesitanImpr}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                        <div className="text-[11px] text-emerald-700 uppercase font-bold">RPA hoy</div>
                        <div className="text-2xl font-black text-emerald-700">{history.filter(h => new Date(h.createdAt) > new Date(Date.now() - 86400000)).length}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Lista de etiquetas */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex items-center gap-2">
                            <Search size={16} className="text-slate-400" />
                            <input value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Buscar etiqueta..." className="flex-1 outline-none text-sm" />
                        </div>
                        <div className="overflow-x-auto max-h-[60vh]">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-100 border-b border-slate-200 sticky top-0">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Etiqueta</th>
                                        <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Stock</th>
                                        <th className="px-2"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(l => (
                                        <tr key={l.id} className={`border-b border-slate-100 ${l.isNegative ? 'bg-red-50/40' : l.needsPrint ? 'bg-amber-50/30' : ''}`}>
                                            <td className="px-3 py-2">
                                                <div className="font-mono text-xs font-bold text-slate-700">{l.sku}</div>
                                                <div className="text-xs text-slate-500 truncate max-w-xs">{l.name}</div>
                                            </td>
                                            <td className={`px-3 py-2 text-center font-mono font-bold ${l.isNegative ? 'text-red-600' : l.needsPrint ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                {l.currentStock.toLocaleString('es-CO')}
                                            </td>
                                            <td className="px-2 py-2">
                                                <button
                                                    onClick={() => { setSelected(l); setQty(''); setObs(''); setMsg(null); }}
                                                    className="px-2 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 flex items-center gap-1"
                                                >
                                                    <Printer size={11} /> Imprimir
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={3} className="text-center py-8 text-slate-400">Sin etiquetas</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Historial RPA + form */}
                    <div className="space-y-4">
                        {selected ? (
                            <div className="bg-white rounded-2xl shadow-md border-2 border-blue-300 p-5">
                                <h3 className="font-black text-blue-700 text-base mb-3 flex items-center gap-2">
                                    <Printer size={18} /> Confirmar impresión
                                </h3>
                                <div className="bg-blue-50 rounded-xl p-3 mb-3 border border-blue-200">
                                    <div className="text-[11px] font-bold text-blue-600 uppercase">Etiqueta seleccionada</div>
                                    <div className="font-extrabold text-slate-800 text-base">{selected.name}</div>
                                    <div className="text-xs text-slate-500 font-mono">{selected.sku} · stock actual: {selected.currentStock.toLocaleString('es-CO')}</div>
                                </div>
                                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Cantidad impresa</label>
                                <input
                                    type="number" min="1" value={qty}
                                    onChange={e => setQty(e.target.value)}
                                    placeholder="Ej: 1000"
                                    className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg text-base font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
                                />
                                <label className="block text-xs font-bold text-slate-600 uppercase mb-1 mt-3">Observaciones (opcional)</label>
                                <input
                                    type="text" value={obs}
                                    onChange={e => setObs(e.target.value)}
                                    placeholder="Ej: Lote 2026-12, máquina Zebra-1"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                />
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => setSelected(null)} className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-bold">Cancelar</button>
                                    <button
                                        onClick={submit}
                                        disabled={submitting || !(parseInt(qty, 10) > 0)}
                                        className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-black hover:bg-emerald-700 disabled:opacity-30 flex items-center justify-center gap-2"
                                    >
                                        {submitting ? '⏳ Encolando…' : '✅ Confirmar y enviar a Siigo'}
                                    </button>
                                </div>
                                {msg && (
                                    <div className={`mt-3 p-2 rounded text-xs flex items-center gap-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                        {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                                        {msg.text}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-center text-slate-400 text-sm">
                                ← Selecciona una etiqueta de la lista para imprimir
                            </div>
                        )}

                        {/* Historial */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 font-bold text-sm text-slate-700">
                                Últimas impresiones (RPA)
                            </div>
                            <div className="max-h-[40vh] overflow-y-auto divide-y divide-slate-100">
                                {history.length === 0 && <div className="text-center py-6 text-slate-400 text-sm">Sin historial</div>}
                                {history.map(h => (
                                    <div key={h.id} className="px-4 py-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-700 truncate flex-1">{h.productName}</span>
                                            <StatusBadge s={h.status} />
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                            {h.quantity.toLocaleString('es-CO')} unds · {h.triggeredBy} · {new Date(h.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                                        </div>
                                        {h.errorMessage && <div className="text-red-600 text-[10px] mt-1 italic">{h.errorMessage}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PrintLabelsPage;
