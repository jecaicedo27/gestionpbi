import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { ChevronLeft, RefreshCw, Search, AlertTriangle, CheckCircle } from 'lucide-react';

const AdminPhysicalInventoryPage = () => {
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [edits, setEdits] = useState({});      // {sku: physicalQty}
    const [saving, setSaving] = useState(null);  // sku currently saving
    const [results, setResults] = useState({});  // {sku: {success, message}}

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/inventory/physical-status');
            setRows(r.data?.data || []);
        } catch (e) { console.warn('load', e.message); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        const s = (search || '').trim().toLowerCase();
        if (!s) return rows;
        return rows.filter(r => r.sku.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
    }, [rows, search]);

    const summary = useMemo(() => {
        const fantasma = rows.filter(r => r.diff > 0).reduce((a, r) => a + r.diff, 0);
        const faltante = rows.filter(r => r.diff < 0).reduce((a, r) => a + Math.abs(r.diff), 0);
        const okCount = rows.filter(r => r.diff === 0).length;
        const fantasmaCount = rows.filter(r => r.diff > 0).length;
        const faltanteCount = rows.filter(r => r.diff < 0).length;
        return { fantasma, faltante, okCount, fantasmaCount, faltanteCount };
    }, [rows]);

    const adjust = async (sku) => {
        const physicalQty = parseInt(edits[sku], 10);
        if (isNaN(physicalQty) || physicalQty < 0) return;
        setSaving(sku);
        try {
            const r = await api.post('/inventory/physical-adjust', { sku, physicalQty, notes: 'Conteo físico admin' });
            setResults(prev => ({ ...prev, [sku]: r.data }));
            setEdits(prev => { const c = { ...prev }; delete c[sku]; return c; });
            await load();
        } catch (e) {
            setResults(prev => ({ ...prev, [sku]: { success: false, message: e.response?.data?.error || e.message } }));
        }
        finally { setSaving(null); }
    };

    const fmt = (n) => Number(n).toLocaleString('es-CO');

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100">
                            <ChevronLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">📦 Inventario físico</h1>
                            <p className="text-xs text-slate-500">Cuadrar gestionpbi al stock real contado en bodega — ajusta finishedLotStock por FEFO</p>
                        </div>
                    </div>
                    <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Recargar
                    </button>
                </div>

                {/* Resumen */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-white rounded-xl p-3 border border-slate-200">
                        <div className="text-[11px] text-slate-500 uppercase font-bold">Productos</div>
                        <div className="text-2xl font-black text-slate-700">{rows.length}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                        <div className="text-[11px] text-emerald-700 uppercase font-bold">✓ Cuadrados</div>
                        <div className="text-2xl font-black text-emerald-700">{summary.okCount}</div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
                        <div className="text-[11px] text-amber-700 uppercase font-bold">👻 Fantasma</div>
                        <div className="text-2xl font-black text-amber-700">{summary.fantasmaCount}</div>
                        <div className="text-[10px] text-amber-600">{fmt(summary.fantasma)} unds sobrantes</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                        <div className="text-[11px] text-red-700 uppercase font-bold">⚠️ Faltante</div>
                        <div className="text-2xl font-black text-red-700">{summary.faltanteCount}</div>
                        <div className="text-[10px] text-red-600">{fmt(summary.faltante)} unds faltantes</div>
                    </div>
                </div>

                {/* Buscador */}
                <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex items-center gap-2">
                    <Search size={16} className="text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por SKU o nombre..."
                        className="flex-1 outline-none text-sm" />
                </div>

                {/* Tabla */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 border-b border-slate-200">
                                <tr>
                                    <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">SKU</th>
                                    <th className="text-left px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Producto</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Siigo</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Lotes (gestionpbi)</th>
                                    <th className="text-center px-3 py-2 font-bold text-slate-600 uppercase text-[11px]">Diff</th>
                                    <th className="text-center px-3 py-2 font-bold text-emerald-700 uppercase text-[11px]">📦 Físico real</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => {
                                    const result = results[r.sku];
                                    return (
                                        <tr key={r.sku} className="border-b border-slate-100 hover:bg-blue-50/30">
                                            <td className="px-3 py-2 font-mono text-xs font-bold text-slate-700">{r.sku}</td>
                                            <td className="px-3 py-2 text-slate-600 text-xs max-w-md truncate">{r.name}</td>
                                            <td className="px-3 py-2 text-center font-mono">{fmt(r.contable)}</td>
                                            <td className="px-3 py-2 text-center font-mono">{fmt(r.lotes)} <span className="text-[10px] text-slate-400">({r.numLotes})</span></td>
                                            <td className={`px-3 py-2 text-center font-bold ${r.diff > 0 ? 'text-amber-600' : r.diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {r.diff > 0 ? `+${r.diff} 👻` : r.diff < 0 ? `${r.diff} ⚠️` : '✓ 0'}
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="number" min="0"
                                                    value={edits[r.sku] ?? ''}
                                                    onChange={e => setEdits(p => ({ ...p, [r.sku]: e.target.value }))}
                                                    placeholder="—"
                                                    className="w-20 px-2 py-1 border border-emerald-300 rounded text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => adjust(r.sku)}
                                                        disabled={saving === r.sku || edits[r.sku] === undefined || edits[r.sku] === ''}
                                                        className="px-3 py-1 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        {saving === r.sku ? '…' : 'Ajustar'}
                                                    </button>
                                                    {result && (
                                                        <span className={`text-[10px] flex items-center gap-1 ${result.success ? 'text-emerald-600' : 'text-red-600'}`}>
                                                            {result.success ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                                                            <span className="max-w-xs truncate">{result.message}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={7} className="text-center py-8 text-slate-400">Sin resultados</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                    <div className="font-bold mb-1">📐 Cómo funciona:</div>
                    <div>• Cuentas físicamente el producto en bodega y escribes el número en <b>📦 Físico real</b>.</div>
                    <div>• <b>Si físico &lt; lotes</b>: el sistema descuenta FEFO (lotes más antiguos primero) hasta cuadrar.</div>
                    <div>• <b>Si físico &gt; lotes</b>: el sistema avisa que hay producción no registrada (no ajusta hacia arriba — necesita ingest manual).</div>
                    <div>• <b>Si físico = lotes</b>: ya está cuadrado.</div>
                    <div>• <b>Cada ajuste deja registro</b> en <code>finished_lot_transfers</code> con razón "AJUSTE FÍSICO".</div>
                </div>
            </div>
        </div>
    );
};

export default AdminPhysicalInventoryPage;
