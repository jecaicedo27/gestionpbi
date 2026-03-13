import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Package, AlertCircle, Save, Settings, Layers, Clock, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import LotManagementModal from './LotManagementModal';

/**
 * Format large gram numbers into readable form:
 *  - <1000 → "890 g"
 *  - >=1000 → "7,955.8 kg"  (1 decimal)
 *  - >=1000000 → "7.96 ton" (2 decimals)
 */
const fmtQty = (raw, unit = 'gramo') => {
    const n = Number(raw) || 0;
    const isGrams = ['gramo', 'gramos', 'g', 'G'].includes(unit);
    if (!isGrams) return { value: Math.round(n).toLocaleString('es-CO'), suffix: unit };
    if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(2), suffix: 'ton' };
    if (n >= 1_000) return { value: (n / 1_000).toFixed(1), suffix: 'kg' };
    return { value: Math.round(n).toLocaleString('es-CO'), suffix: 'g' };
};

const ProductAnalysisModal = ({ product, onClose, onUpdate }) => {
    const [formData, setFormData] = useState({ minimumStock: 0, packSize: 1 });
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [showLots, setShowLots] = useState(false);

    useEffect(() => {
        if (product) {
            setFormData({
                minimumStock: product.minimumStock || 0,
                packSize: product.packSize || 1
            });
            setHasChanges(false);
        }
    }, [product]);

    if (!product) return null;

    const velocity = product.dailyVelocity || 0;
    const stock = product.currentStock || 0;
    const daysOfStock = product.daysOfStock || 0;
    const unit = product.unit || 'und';

    const needed15 = Math.ceil(velocity * 15);
    const needed30 = Math.ceil(velocity * 30);
    const suggest15 = Math.max(0, needed15 - stock);
    const suggest30 = Math.max(0, needed30 - stock);

    const stockFmt = fmtQty(stock, unit);
    const velFmt = fmtQty(velocity, unit);
    const s15Fmt = fmtQty(suggest15, unit);
    const s30Fmt = fmtQty(suggest30, unit);
    const n15Fmt = fmtQty(needed15, unit);
    const n30Fmt = fmtQty(needed30, unit);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post(`/inventory/product/${product.id}/config`, {
                minimumStock: formData.minimumStock,
                packSize: formData.packSize
            });
            setHasChanges(false);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Failed to save config', error);
        } finally {
            setSaving(false);
        }
    };

    // Days-of-stock indicator color
    const daysColor = daysOfStock <= 7 ? 'text-red-600' : daysOfStock <= 15 ? 'text-amber-600' : 'text-emerald-600';
    const daysBg = daysOfStock <= 7 ? 'bg-red-50 border-red-100' : daysOfStock <= 15 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm max-h-[75vh] overflow-hidden" style={{ animation: 'scaleIn .15s ease-out' }} onClick={e => e.stopPropagation()}>
                {/* Header — compact gradient */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-3 py-2 flex justify-between items-center">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-bold text-white leading-tight">{product.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-white/15 text-white/70">{product.code}</span>
                            <span className="text-[10px] text-white/50">{product.group}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
                        <X className="w-4 h-4 text-white/60" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-2.5 space-y-2.5 overflow-auto" style={{ maxHeight: 'calc(75vh - 56px)' }}>

                    {/* Metrics row — 3 compact cards */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-blue-50 rounded-lg border border-blue-100">
                            <div className="flex items-center gap-1 mb-1">
                                <Package className="w-3 h-3 text-blue-500" />
                                <span className="text-[9px] font-bold text-blue-500 uppercase">Stock</span>
                            </div>
                            <div className="text-lg font-black text-blue-900 leading-none">{stockFmt.value}</div>
                            <div className="text-[10px] text-blue-500 mt-0.5">{stockFmt.suffix}</div>
                        </div>

                        <div className="p-2 bg-violet-50 rounded-lg border border-violet-100">
                            <div className="flex items-center gap-1 mb-1">
                                <TrendingUp className="w-3 h-3 text-violet-500" />
                                <span className="text-[9px] font-bold text-violet-500 uppercase">Velocidad</span>
                            </div>
                            <div className="text-lg font-black text-violet-900 leading-none">{velFmt.value}</div>
                            <div className="text-[10px] text-violet-500 mt-0.5">{velFmt.suffix} / día</div>
                        </div>

                        <div className={`p-2 rounded-lg border ${daysBg}`}>
                            <div className="flex items-center gap-1 mb-1">
                                <Clock className="w-3 h-3" style={{ opacity: 0.7 }} />
                                <span className="text-[9px] font-bold uppercase opacity-70">Cobertura</span>
                            </div>
                            <div className={`text-lg font-black leading-none ${daysColor}`}>{Math.round(daysOfStock)}</div>
                            <div className="text-[10px] opacity-60 mt-0.5">días</div>
                        </div>
                    </div>

                    {/* Config Section — inline */}
                    <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                        <h3 className="text-[10px] font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                            <Settings className="w-3 h-3" />
                            Configuración
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Stock Mínimo</label>
                                <input
                                    type="number"
                                    name="minimumStock"
                                    value={formData.minimumStock}
                                    onChange={handleChange}
                                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Pack / Caja</label>
                                <input
                                    type="number"
                                    name="packSize"
                                    value={formData.packSize}
                                    onChange={handleChange}
                                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Suggestions — compact */}
                    {(suggest15 > 0 || suggest30 > 0) && (
                        <div className="bg-amber-50/60 rounded-lg p-2.5 border border-amber-100">
                            <h3 className="text-[10px] font-bold text-amber-600 uppercase mb-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Reaprovisionamiento
                            </h3>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-white p-2 rounded-lg border border-amber-100">
                                    <div className="text-[9px] font-bold text-gray-400 uppercase">15 Días</div>
                                    <div className="text-base font-black text-gray-900 mt-0.5">{s15Fmt.value} <span className="text-[10px] font-normal text-gray-400">{s15Fmt.suffix}</span></div>
                                </div>
                                <div className="bg-white p-2 rounded-lg border border-amber-100">
                                    <div className="text-[9px] font-bold text-gray-400 uppercase">30 Días</div>
                                    <div className="text-base font-black text-gray-900 mt-0.5">{s30Fmt.value} <span className="text-[10px] font-normal text-gray-400">{s30Fmt.suffix}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Actions — compact */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowLots(true)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 
                                hover:from-indigo-600 hover:to-violet-600 rounded-lg text-white font-bold text-xs transition-all shadow-sm"
                        >
                            <Layers className="w-3.5 h-3.5" />
                            Gestionar Lotes
                        </button>
                        {hasChanges && (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-all shadow-sm disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                {saving ? '...' : 'Guardar'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {showLots && <LotManagementModal product={product} onClose={() => setShowLots(false)} />}
        </div>
    );
};

export default ProductAnalysisModal;
