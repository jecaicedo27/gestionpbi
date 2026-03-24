import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Package, AlertCircle, Save, Settings, Layers, Clock, ShieldCheck, Warehouse } from 'lucide-react';
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
    const [zoneBreakdown, setZoneBreakdown] = useState(null);

    useEffect(() => {
        if (product) {
            setFormData({
                minimumStock: product.minimumStock || 0,
                packSize: product.packSize || 1
            });
            setHasChanges(false);
            // Fetch zone breakdown — MaterialLot + FinishedLotStock
            Promise.all([
                api.get(`/inventory/lots?productId=${product.id}&status=AVAILABLE,LOW_STOCK`),
                api.get(`/finished-lots/zone-summary?productId=${product.id}`).catch(() => ({ data: { summary: {} } })),
            ]).then(([lotRes, flsRes]) => {
                const lots = lotRes.data?.data || lotRes.data || [];
                const zones = {};
                lots.forEach(l => {
                    const z = l.zone || 'WAREHOUSE';
                    zones[z] = (zones[z] || 0) + (l.currentQuantity || 0);
                });
                // Merge FinishedLotStock zones
                const flsZones = flsRes.data?.summary || {};

                Object.entries(flsZones).forEach(([z, qty]) => {
                    zones[z] = (zones[z] || 0) + qty;
                });

                setZoneBreakdown(zones);
            }).catch(() => setZoneBreakdown(null));
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

                    {/* Warehouse distribution — all zones */}
                    {zoneBreakdown && Object.keys(zoneBreakdown).length > 0 && (() => {
                        const ZONE_CFG = [
                            { key: 'WAREHOUSE', label: 'Bodega', color: '#3b82f6', grad: 'linear-gradient(90deg, #3b82f6, #60a5fa)' },
                            { key: 'PRODUCTION', label: 'Producción', color: '#10b981', grad: 'linear-gradient(90deg, #10b981, #34d399)' },
                            { key: 'PRODUCCION', label: 'Producción (PT)', color: '#10b981', grad: 'linear-gradient(90deg, #10b981, #6ee7b7)' },
                            { key: 'PRODUCTO_TERMINADO', label: 'Prod. Terminado', color: '#8b5cf6', grad: 'linear-gradient(90deg, #8b5cf6, #a78bfa)' },
                            { key: 'NO_CONFORME', label: 'No Conforme', color: '#ef4444', grad: 'linear-gradient(90deg, #ef4444, #f87171)' },
                            { key: 'MAQUILA', label: 'Maquila', color: '#f97316', grad: 'linear-gradient(90deg, #f97316, #fb923c)' },
                            { key: 'CUARENTENA', label: 'Cuarentena', color: '#eab308', grad: 'linear-gradient(90deg, #eab308, #facc15)' },
                        ];
                        const zones = ZONE_CFG.filter(z => (zoneBreakdown[z.key] || 0) > 0);
                        const total = zones.reduce((s, z) => s + (zoneBreakdown[z.key] || 0), 0);
                        if (total === 0) return null;
                        return (
                            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1">
                                    <Warehouse className="w-3 h-3" />
                                    Distribución por Zona
                                </h3>
                                <div className="flex rounded-full overflow-hidden h-3 mb-1.5" style={{ border: '1px solid #e2e8f0' }}>
                                    {zones.map(z => {
                                        const pct = Math.max(Math.round((zoneBreakdown[z.key] / total) * 100), 2);
                                        return <div key={z.key} style={{ width: `${pct}%`, background: z.grad }} title={`${z.label} ${pct}%`} />;
                                    })}
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                                    {zones.map(z => {
                                        const v = zoneBreakdown[z.key];
                                        const fmt = fmtQty(v, unit);
                                        return (
                                            <span key={z.key} className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-full inline-block" style={{ background: z.color }} />
                                                <span className="font-semibold text-slate-700">{z.label}</span>
                                                <span className="text-slate-500">{fmt.value} {fmt.suffix}</span>
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

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
