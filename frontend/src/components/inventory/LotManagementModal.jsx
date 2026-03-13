import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Package, Trash2, ChevronDown, ChevronUp, Clock, User, AlertCircle } from 'lucide-react';
import api from '../../services/api';

const LotManagementModal = ({ product, onClose }) => {
    const [lots, setLots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [expandedLot, setExpandedLot] = useState(null);
    const [lotHistory, setLotHistory] = useState({});

    // Add form state
    const [newLot, setNewLot] = useState({ lotNumber: '', packs: '', quantity: '', expiresAt: '' });
    const [saving, setSaving] = useState(false);

    const totalStock = product?.currentStock || 0;
    const unit = product?.unit || 'gramo';
    const isGrams = ['gramo', 'gramos', 'g', 'G'].includes(unit);

    const loadLots = useCallback(async () => {
        if (!product) return;
        try {
            const res = await api.get(`/inventory/lots?productId=${product.id}&status=AVAILABLE,LOW_STOCK,DEPLETED`);
            setLots(res.data);
        } catch (err) {
            console.error('Error loading lots:', err);
        } finally {
            setLoading(false);
        }
    }, [product]);

    useEffect(() => { loadLots(); }, [loadLots]);

    const totalAssigned = lots.reduce((acc, l) => acc + l.initialQuantity, 0);
    const totalRemaining = lots.reduce((acc, l) => acc + l.currentQuantity, 0);
    const unassigned = Math.max(0, totalStock - totalRemaining);

    const handleAdd = async () => {
        if (!newLot.lotNumber.trim() || !newLot.quantity) return;
        setSaving(true);
        try {
            await api.post('/inventory/lots', {
                productId: product.id,
                lotNumber: newLot.lotNumber.trim().toUpperCase(),
                quantity: parseInt(newLot.quantity),
                unit,
                expiresAt: newLot.expiresAt || null
            });
            setNewLot({ lotNumber: '', packs: '', quantity: '', expiresAt: '' });
            setShowAddForm(false);
            loadLots();
        } catch (err) {
            alert(err.response?.data?.error || 'Error al crear lote');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (lotId) => {
        if (!confirm('¿Eliminar este lote? Solo posible si no tiene consumos.')) return;
        try {
            await api.delete(`/inventory/lots/${lotId}`);
            loadLots();
        } catch (err) {
            alert(err.response?.data?.error || 'No se puede eliminar');
        }
    };

    const toggleHistory = async (lotId) => {
        if (expandedLot === lotId) {
            setExpandedLot(null);
            return;
        }
        setExpandedLot(lotId);
        if (!lotHistory[lotId]) {
            try {
                const res = await api.get(`/inventory/lots/${lotId}/history`);
                setLotHistory(prev => ({ ...prev, [lotId]: res.data.consumptions || [] }));
            } catch (err) {
                console.error('Error loading history:', err);
            }
        }
    };

    const getStatusBadge = (status, qty, initial) => {
        const pct = initial > 0 ? (qty / initial) * 100 : 0;
        if (status === 'DEPLETED' || qty <= 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">AGOTADO</span>;
        if (status === 'LOW_STOCK' || pct < 15) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">BAJO</span>;
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">DISPONIBLE</span>;
    };

    const fmtQty = (q) => `${q.toLocaleString('es-CO')} ${unit}`;

    if (!product) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white flex justify-between items-start flex-shrink-0">
                    <div>
                        <h2 className="text-lg font-extrabold">📦 Lotes — {product.name}</h2>
                        <div className="flex gap-3 mt-2 text-xs">
                            <span className="bg-white/20 px-2 py-0.5 rounded">{product.code}</span>
                            <span className="bg-white/20 px-2 py-0.5 rounded">Stock Siigo: {fmtQty(totalStock)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Summary bar */}
                <div className="grid grid-cols-3 gap-3 p-4 bg-gray-50 border-b flex-shrink-0">
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Asignado a Lotes</div>
                        <div className="text-lg font-black text-indigo-700">{fmtQty(totalAssigned)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Disponible en Lotes</div>
                        <div className="text-lg font-black text-green-700">{fmtQty(totalRemaining)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Sin Asignar</div>
                        <div className={`text-lg font-black ${unassigned > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{fmtQty(unassigned)}</div>
                    </div>
                </div>

                {/* Lots list  */}
                <div className="flex-1 overflow-auto p-4 space-y-3">
                    {loading ? (
                        <div className="text-center py-8 text-gray-400">Cargando lotes...</div>
                    ) : lots.length === 0 ? (
                        <div className="text-center py-8">
                            <Package className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p className="text-gray-500 font-medium">No hay lotes registrados</p>
                            <p className="text-gray-400 text-sm">Agrega el primer lote para iniciar la trazabilidad</p>
                        </div>
                    ) : (
                        lots.map(lot => {
                            const pct = lot.initialQuantity > 0 ? Math.round((lot.currentQuantity / lot.initialQuantity) * 100) : 0;
                            const isExpanded = expandedLot === lot.id;
                            const history = lotHistory[lot.id] || [];
                            return (
                                <div key={lot.id} className={`border rounded-xl overflow-hidden transition-all ${lot.currentQuantity <= 0 ? 'opacity-60' : ''}`}>
                                    <div className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer" onClick={() => toggleHistory(lot.id)}>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-gray-900">{lot.lotNumber}</span>
                                                {getStatusBadge(lot.status, lot.currentQuantity, lot.initialQuantity)}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                Recibido: {new Date(lot.receivedAt).toLocaleDateString('es-CO')} · Inicial: {fmtQty(lot.initialQuantity)}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-black text-gray-800">{fmtQty(lot.currentQuantity)}</div>
                                            <div className="w-20 h-1.5 bg-gray-200 rounded-full mt-1">
                                                <div className={`h-full rounded-full ${pct > 30 ? 'bg-green-500' : pct > 10 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                    style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {lot._count?.consumptions === 0 && (
                                                <button onClick={(e) => { e.stopPropagation(); handleDelete(lot.id); }}
                                                    className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="bg-gray-50 border-t p-3">
                                            <div className="text-xs font-bold text-gray-500 uppercase mb-2">Historial de Consumo</div>
                                            {history.length === 0 ? (
                                                <div className="text-xs text-gray-400 py-2">Sin consumos registrados</div>
                                            ) : (
                                                <div className="space-y-1.5 max-h-40 overflow-auto">
                                                    {history.map(c => (
                                                        <div key={c.id} className="flex items-center gap-2 text-xs bg-white p-2 rounded-lg border">
                                                            <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                            <span className="text-gray-500">{new Date(c.usedAt).toLocaleString('es-CO')}</span>
                                                            <span className="font-bold text-red-600">-{fmtQty(c.quantityUsed)}</span>
                                                            <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                            <span className="text-gray-700">{c.usedBy?.name || 'N/A'}</span>
                                                            {c.observations && <span className="text-gray-400 truncate">({c.observations})</span>}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Add form */}
                <div className="border-t p-4 bg-gray-50 flex-shrink-0">
                    {showAddForm ? (
                        <div className="space-y-3">
                            {/* Row 1: Lote + Packs + Gramos */}
                            <div className="grid grid-cols-12 gap-3">
                                <div className="col-span-3">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Nº Lote</label>
                                    <input type="text" value={newLot.lotNumber}
                                        onChange={e => setNewLot(p => ({ ...p, lotNumber: e.target.value }))}
                                        placeholder="Ej: LOTE-2026-001"
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold uppercase focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none" />
                                </div>
                                {(product.packSize > 1) && (
                                    <div className="col-span-3">
                                        <label className="text-[10px] font-bold text-indigo-500 uppercase block mb-1">
                                            📦 Packs / Bultos
                                        </label>
                                        <input type="number" value={newLot.packs}
                                            onChange={e => {
                                                const packs = e.target.value;
                                                const grams = packs ? Math.round(parseFloat(packs) * (product.packSize || 1)) : '';
                                                setNewLot(p => ({ ...p, packs, quantity: grams.toString() }));
                                            }}
                                            min="0" step="1"
                                            placeholder="Ej: 3"
                                            className="w-full px-3 py-2.5 border-2 border-indigo-300 bg-indigo-50 rounded-lg text-sm font-black text-center text-indigo-700 focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none" />
                                    </div>
                                )}
                                <div className={(product.packSize > 1) ? "col-span-3" : "col-span-5"}>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                        Total ({isGrams ? 'gramos' : unit})
                                    </label>
                                    <input type="number" value={newLot.quantity}
                                        onChange={e => {
                                            const qty = e.target.value;
                                            const packs = (product.packSize > 1 && qty) ? (parseFloat(qty) / product.packSize).toFixed(1) : '';
                                            setNewLot(p => ({ ...p, quantity: qty, packs }));
                                        }}
                                        placeholder="50000"
                                        className={`w-full px-3 py-2.5 border rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none ${(product.packSize > 1 && newLot.packs) ? 'bg-green-50 border-green-300 text-green-700' : ''}`} />
                                </div>
                                <div className="col-span-3">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Vencimiento</label>
                                    <input type="date" value={newLot.expiresAt}
                                        onChange={e => setNewLot(p => ({ ...p, expiresAt: e.target.value }))}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none" />
                                </div>
                            </div>
                            {/* Pack calculation hint */}
                            {(product.packSize > 1 && newLot.packs) && (
                                <div className="flex items-center gap-2 text-xs bg-indigo-50 border border-indigo-200 p-2 rounded-lg text-indigo-700 font-medium">
                                    <Package className="w-4 h-4 flex-shrink-0" />
                                    {newLot.packs} pack{newLot.packs != 1 ? 's' : ''} × {(product.packSize >= 1000 ? (product.packSize / 1000) + ' kg' : product.packSize + ' g')} = <strong>{parseInt(newLot.quantity || 0).toLocaleString()} {isGrams ? 'g' : unit}</strong>
                                    {isGrams && parseInt(newLot.quantity) >= 1000 && (
                                        <span className="text-indigo-400 ml-1">({(parseInt(newLot.quantity) / 1000).toFixed(1)} kg)</span>
                                    )}
                                </div>
                            )}
                            {unassigned > 0 && parseInt(newLot.quantity) > unassigned && (
                                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    La cantidad excede el stock sin asignar ({fmtQty(unassigned)})
                                </div>
                            )}
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => { setShowAddForm(false); setNewLot({ lotNumber: '', packs: '', quantity: '', expiresAt: '' }); }}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
                                    Cancelar
                                </button>
                                <button onClick={handleAdd} disabled={saving || !newLot.lotNumber || (product.packSize > 1 && !newLot.packs) || !newLot.quantity || !newLot.expiresAt}
                                    className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    {saving ? 'Guardando...' : 'Agregar Lote'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setShowAddForm(true)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-indigo-300 rounded-xl text-indigo-600 font-bold text-sm hover:bg-indigo-50 transition-colors">
                            <Plus className="w-4 h-4" /> Agregar Lote
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LotManagementModal;
