import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, TrendingUp, Package, AlertCircle, Save, Settings, Layers, Clock, Warehouse, Plus, Pencil, Trash2, ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react';
import api from '../../services/api';
import LotManagementModal from './LotManagementModal';
import {
    normalizeInventoryDecimalInput,
    normalizeInventoryIntegerInput,
    parseInventoryNumberInput
} from '../../utils/inventoryNumberInput';

const PACK_CONTAINER_OPTIONS = [
    { value: 'CAJA', label: 'Caja' },
    { value: 'BULTO', label: 'Bulto' },
    { value: 'SACO', label: 'Saco' },
    { value: 'BOLSA', label: 'Bolsa' },
    { value: 'CANECA', label: 'Caneca' },
    { value: 'ENVASE', label: 'Envase' },
    { value: 'TAMBOR', label: 'Tambor' },
    { value: 'GARRAFA', label: 'Garrafa' },
];

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

const summarizePackCoverage = (stock, option, unit) => {
    const quantityPerPack = Number(option?.quantity || 0);
    const currentStock = Number(stock || 0);
    if (quantityPerPack <= 0 || currentStock <= 0) {
        return {
            fullUnits: 0,
            represented: fmtQty(0, unit),
            loose: fmtQty(currentStock, unit)
        };
    }

    const fullUnits = Math.floor(currentStock / quantityPerPack);
    const represented = fullUnits * quantityPerPack;
    const loose = Math.max(currentStock - represented, 0);

    return {
        fullUnits,
        represented: fmtQty(represented, unit),
        loose: fmtQty(loose, unit)
    };
};

const ProductAnalysisModal = ({ product, initialLotScan, onLotScanConsumed, onClose, onUpdate }) => {
    const [formData, setFormData] = useState({ minimumStock: '0', packSize: '1' });
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [showLots, setShowLots] = useState(false);
    const [lotScanForModal, setLotScanForModal] = useState(null);
    const [zoneBreakdown, setZoneBreakdown] = useState(null);
    const [reservation, setReservation] = useState(null);
    const [packOptions, setPackOptions] = useState([]);
    const [packOptionsLoading, setPackOptionsLoading] = useState(false);
    const [showPackFormats, setShowPackFormats] = useState(false);
    const [editingPackOptionId, setEditingPackOptionId] = useState(null);
    const [packForm, setPackForm] = useState({
        quantity: '',
        label: '',
        containerType: 'CAJA',
        isDefault: false
    });

    const loadPackOptions = async (productId) => {
        if (!productId) return;
        setPackOptionsLoading(true);
        try {
            const { data } = await api.get(`/inventory/products/${productId}/pack-options`);
            setPackOptions(data.options || []);
        } catch (error) {
            console.error('Failed to load pack options', error);
            setPackOptions([]);
        } finally {
            setPackOptionsLoading(false);
        }
    };

    const loadReservation = useCallback(async (targetProduct) => {
        if (!targetProduct?.id) return;
        try {
            const { data } = await api.get(`/inventory/product/${targetProduct.id}/reservation`);
            setReservation(data);
        } catch {
            setReservation(null);
        }
    }, []);

    const loadZoneBreakdown = useCallback(async (targetProduct) => {
        if (!targetProduct?.id) return;
        try {
            const [lotRes, flsRes] = await Promise.all([
                api.get(`/inventory/lots?productId=${targetProduct.id}&status=AVAILABLE,LOW_STOCK`),
                api.get(`/finished-lots/zone-summary?productId=${targetProduct.id}`).catch(() => ({ data: { summary: {} } })),
            ]);
            const lots = lotRes.data?.data || lotRes.data || [];
            const zones = {};
            lots.forEach(l => {
                const z = l.zone || 'WAREHOUSE';
                zones[z] = (zones[z] || 0) + (l.currentQuantity || 0);
            });
            const flsZones = flsRes.data?.summary || {};
            Object.entries(flsZones).forEach(([z, qty]) => {
                zones[z] = (zones[z] || 0) + qty;
            });
            const assignedQty = Object.values(zones).reduce((sum, qty) => sum + Number(qty || 0), 0);
            const unassignedQty = Math.max(0, Number(targetProduct.currentStock || 0) - assignedQty);
            if (unassignedQty > 0) zones.SIIGO_UNASSIGNED = unassignedQty;
            setZoneBreakdown(zones);
        } catch {
            setZoneBreakdown(null);
        }
    }, []);

    useEffect(() => {
        if (!product) return;
        setFormData({
            minimumStock: normalizeInventoryDecimalInput(product.minimumStock || 0),
            packSize: normalizeInventoryDecimalInput(product.packSize || 1)
        });
        setHasChanges(false);
        setShowPackFormats(false);
        setEditingPackOptionId(null);
        setPackForm({
            quantity: product.packSize > 1 ? normalizeInventoryIntegerInput(Math.round(product.packSize)) : '',
            label: '',
            containerType: 'CAJA',
            isDefault: true
        });
        loadPackOptions(product.id);
        loadZoneBreakdown(product);
        loadReservation(product);
    }, [product, loadZoneBreakdown, loadReservation]);

    useEffect(() => {
        if (!initialLotScan || !product) return;
        const sameProduct =
            initialLotScan.productId === product.id ||
            initialLotScan.sku === product.code ||
            initialLotScan.sku === product.sku ||
            initialLotScan.barcode === product.barcode;
        if (!sameProduct) return;
        setLotScanForModal(initialLotScan);
        setShowLots(true);
    }, [initialLotScan, product]);

    const velocity = product?.dailyVelocity || 0;
    const stock = product?.currentStock || 0;
    const daysOfStock = product?.daysOfStock || 0;
    const unit = product?.unit || 'und';

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
    const packOptionSummaries = useMemo(() => (
        packOptions.map(option => ({
            ...option,
            coverage: summarizePackCoverage(stock, option, unit)
        }))
    ), [packOptions, stock, unit]);
    const packSummary = useMemo(() => {
        const defaultOption = packOptionSummaries.find(option => option.isDefault) || null;
        const mostUsedOption = packOptionSummaries.find(option => option.isMostUsed) || null;
        const totalUnits = packOptionSummaries.reduce((sum, option) => sum + (option.coverage?.fullUnits || 0), 0);
        const totalActivePackages = packOptionSummaries.reduce((sum, option) => sum + Number(option.activeCount || 0), 0);
        const totalActiveQuantity = packOptionSummaries.reduce((sum, option) => sum + Number(option.activeQuantity || 0), 0);

        return {
            totalFormats: packOptionSummaries.length,
            totalUnits,
            totalActivePackages,
            totalActiveQuantity: fmtQty(totalActiveQuantity, unit),
            defaultOption,
            mostUsedOption
        };
    }, [packOptionSummaries]);

    if (!product) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        const normalized = name === 'packSize'
            ? normalizeInventoryDecimalInput(value)
            : normalizeInventoryDecimalInput(value);
        setFormData(prev => ({ ...prev, [name]: normalized }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post(`/inventory/product/${product.id}/config`, {
                minimumStock: parseInventoryNumberInput(formData.minimumStock, 0),
                packSize: parseInventoryNumberInput(formData.packSize, 1)
            });
            setHasChanges(false);
            if (onUpdate) onUpdate();
            await loadPackOptions(product.id);
        } catch (error) {
            console.error('Failed to save config', error);
        } finally {
            setSaving(false);
        }
    };

    const resetPackForm = () => {
        setEditingPackOptionId(null);
        setPackForm({
            quantity: normalizeInventoryIntegerInput(Math.round(parseInventoryNumberInput(formData.packSize, 1))),
            label: '',
            containerType: 'CAJA',
            isDefault: false
        });
    };

    const handlePackFormChange = (field, value) => {
        setPackForm(prev => ({
            ...prev,
            [field]: field === 'quantity' ? normalizeInventoryIntegerInput(value) : value
        }));
    };

    const handleSavePackOption = async () => {
        try {
            const payload = {
                quantity: parseInventoryNumberInput(packForm.quantity, 0),
                label: packForm.label.trim() || null,
                containerType: packForm.containerType || null,
                isDefault: Boolean(packForm.isDefault)
            };

            if (!payload.quantity) return;

            if (editingPackOptionId) {
                await api.patch(`/inventory/pack-options/${editingPackOptionId}`, payload);
            } else {
                await api.post(`/inventory/products/${product.id}/pack-options`, payload);
            }

            if (payload.isDefault) {
                setFormData(prev => ({
                    ...prev,
                    packSize: normalizeInventoryDecimalInput(payload.quantity)
                }));
                setHasChanges(true);
            }

            resetPackForm();
            await loadPackOptions(product.id);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Failed to save pack option', error);
        }
    };

    const handleEditPackOption = (option) => {
        setEditingPackOptionId(option.id);
        setPackForm({
            quantity: normalizeInventoryIntegerInput(option.quantity),
            label: option.label || '',
            containerType: option.containerType || 'CAJA',
            isDefault: Boolean(option.isDefault)
        });
    };

    const handleDeletePackOption = async (optionId) => {
        if (!window.confirm('¿Ocultar este formato de empaque?')) return;
        try {
            await api.delete(`/inventory/pack-options/${optionId}`);
            if (editingPackOptionId === optionId) resetPackForm();
            await loadPackOptions(product.id);
        } catch (error) {
            console.error('Failed to delete pack option', error);
        }
    };

    // Days-of-stock indicator color
    const daysColor = daysOfStock <= 7 ? 'text-red-600' : daysOfStock <= 15 ? 'text-amber-600' : 'text-emerald-600';
    const daysBg = daysOfStock <= 7 ? 'bg-red-50 border-red-100' : daysOfStock <= 15 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100';

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-2rem)] max-w-5xl overflow-hidden flex flex-col" style={{ animation: 'scaleIn .15s ease-out' }} onClick={e => e.stopPropagation()}>
                {/* Header — compact gradient */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 sm:px-5 py-3 flex justify-between items-center flex-shrink-0 gap-3">
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

                {/* Content — two columns */}
                <div className="p-3 sm:p-4 overflow-y-auto flex-1 min-h-0 overscroll-contain">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* ═══ LEFT COLUMN: INVENTARIO ═══ */}
                <div className="space-y-3">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                        <Package className="w-3 h-3" /> Inventario
                    </h3>

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
                            { key: 'SIIGO_UNASSIGNED', label: 'Sin asignar', color: '#f59e0b', grad: 'linear-gradient(90deg, #f59e0b, #fbbf24)' },
                            { key: 'WAREHOUSE', label: 'Bodega', color: '#3b82f6', grad: 'linear-gradient(90deg, #3b82f6, #60a5fa)' },
                            { key: 'BODEGA', label: 'Bodega', color: '#3b82f6', grad: 'linear-gradient(90deg, #3b82f6, #60a5fa)' },
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
                                    type="text"
                                    name="minimumStock"
                                    value={formData.minimumStock}
                                    onChange={handleChange}
                                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Pack / Caja</label>
                                <input
                                    type="text"
                                    name="packSize"
                                    value={formData.packSize}
                                    onChange={handleChange}
                                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[10px] font-bold text-gray-500 uppercase">Formatos de Empaque</h3>
                                <div className="text-[11px] text-gray-500 mt-1">
                                    {packSummary.totalFormats > 0
                                        ? `${packSummary.totalFormats} formato(s) guardado(s) · ${packSummary.totalActivePackages} ID(s) activos · ${packSummary.totalUnits} unidad(es) completas posibles con el stock actual`
                                        : 'Sin formatos guardados todavía'}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPackFormats(prev => !prev)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100"
                            >
                                {showPackFormats ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                {showPackFormats ? 'Ocultar' : 'Expandir'}
                            </button>
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="rounded-lg border border-white bg-white px-3 py-2">
                                <div className="text-[9px] font-bold uppercase text-gray-400">Formatos</div>
                                <div className="mt-1 text-base font-black text-gray-900">{packSummary.totalFormats}</div>
                            </div>
                            <div className="rounded-lg border border-white bg-white px-3 py-2">
                                <div className="text-[9px] font-bold uppercase text-gray-400">IDs activos</div>
                                <div className="mt-1 text-base font-black text-gray-900">{packSummary.totalActivePackages}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                    {packSummary.totalActiveQuantity.value} {packSummary.totalActiveQuantity.suffix}
                                </div>
                            </div>
                            <div className="rounded-lg border border-white bg-white px-3 py-2">
                                <div className="text-[9px] font-bold uppercase text-gray-400">Pack por defecto</div>
                                <div className="mt-1 text-xs font-bold text-gray-900 break-words">
                                    {packSummary.defaultOption?.label || 'Sin definir'}
                                </div>
                            </div>
                            <div className="rounded-lg border border-white bg-white px-3 py-2">
                                <div className="text-[9px] font-bold uppercase text-gray-400">Más usado</div>
                                <div className="mt-1 text-xs font-bold text-gray-900 break-words">
                                    {packSummary.mostUsedOption?.label || 'Sin histórico'}
                                </div>
                            </div>
                        </div>

                        {showPackFormats && (
                            <div className="mt-3 space-y-3">
                                <div className="space-y-2">
                                    {packOptionsLoading ? (
                                        <div className="text-[11px] text-gray-400">Cargando formatos...</div>
                                    ) : packOptionSummaries.length === 0 ? (
                                        <div className="text-[11px] text-gray-400">Sin formatos guardados.</div>
                                    ) : packOptionSummaries.map(option => (
                                        <div key={option.id} className="bg-white border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-bold text-gray-800 break-words">{option.label}</span>
                                                        {option.isDefault && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">Default</span>}
                                                        {option.isMostUsed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">Más usado</span>}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">
                                                        {option.quantity} {product.unit || 'g'} por unidad · {option.containerType || 'Sin tipo'} · {option.usageCount || 0} registro(s)
                                                    </div>
                                                </div>
                                                <button onClick={() => handleEditPackOption(option)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => handleDeletePackOption(option.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>

                                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                                    <div className="text-[9px] font-bold uppercase text-gray-400">IDs activos</div>
                                                    <div className="mt-1 text-base font-black text-gray-900">{option.activeCount || 0}</div>
                                                </div>
                                                <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                                    <div className="text-[9px] font-bold uppercase text-gray-400">Cantidad activa</div>
                                                    <div className="mt-1 text-xs font-black text-gray-900">
                                                        {fmtQty(option.activeQuantity || 0, unit).value} {fmtQty(option.activeQuantity || 0, unit).suffix}
                                                    </div>
                                                </div>
                                                <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                                    <div className="text-[9px] font-bold uppercase text-gray-400">Unidades completas</div>
                                                    <div className="mt-1 text-base font-black text-gray-900">{option.coverage.fullUnits}</div>
                                                </div>
                                                <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                                    <div className="text-[9px] font-bold uppercase text-gray-400">Suelto</div>
                                                    <div className="mt-1 text-xs font-black text-gray-900">
                                                        {option.coverage.loose.value} {option.coverage.loose.suffix}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-lg border border-dashed border-gray-200 bg-white p-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                        <div className="sm:col-span-4">
                                            <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Cantidad</label>
                                            <input
                                                type="text"
                                                value={packForm.quantity}
                                                onChange={(e) => handlePackFormChange('quantity', e.target.value)}
                                                className="w-full px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                            />
                                        </div>
                                        <div className="sm:col-span-4">
                                            <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Contenedor</label>
                                            <select
                                                value={packForm.containerType}
                                                onChange={(e) => handlePackFormChange('containerType', e.target.value)}
                                                className="w-full px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                            >
                                                {PACK_CONTAINER_OPTIONS.map(option => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="sm:col-span-4">
                                            <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Alias</label>
                                            <input
                                                type="text"
                                                value={packForm.label}
                                                onChange={(e) => handlePackFormChange('label', e.target.value)}
                                                placeholder="Opcional"
                                                className="w-full px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3">
                                        <label className="inline-flex items-center gap-2 text-[11px] text-gray-600 font-medium">
                                            <input
                                                type="checkbox"
                                                checked={packForm.isDefault}
                                                onChange={(e) => setPackForm(prev => ({ ...prev, isDefault: e.target.checked }))}
                                            />
                                            Usar como pack por defecto
                                        </label>
                                        <div className="flex items-center gap-2">
                                            {editingPackOptionId && (
                                                <button onClick={resetPackForm} className="px-2.5 py-2 text-[11px] font-bold text-gray-600 bg-white border border-gray-200 rounded-lg">
                                                    Cancelar
                                                </button>
                                            )}
                                            <button onClick={handleSavePackOption} className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">
                                                <Plus className="w-3.5 h-3.5" />
                                                {editingPackOptionId ? 'Actualizar' : 'Guardar'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
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
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <button
                            onClick={() => setShowLots(true)}
                            className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 py-2 bg-gradient-to-r from-indigo-500 to-violet-500
                                hover:from-indigo-600 hover:to-violet-600 rounded-lg text-white font-bold text-xs transition-all shadow-sm"
                        >
                            <Layers className="w-3.5 h-3.5" />
                            Gestionar Lotes
                        </button>
                        {hasChanges && (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-all shadow-sm disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                {saving ? '...' : 'Guardar'}
                            </button>
                        )}
                    </div>
                </div>

                {/* ═══ RIGHT COLUMN: VENTAS ═══ */}
                <div className="space-y-3">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                        <ShoppingCart className="w-3 h-3" /> Ventas
                    </h3>

                    {/* Summary cards */}
                    {reservation && (() => {
                        const available = stock - (reservation.reservedQty || 0);
                        const pickedOrders = (reservation.orders || []).filter(o => (o.scannedQty || 0) > 0);
                        const pendingOrders = (reservation.orders || []).filter(o => (o.scannedQty || 0) === 0);
                        const pickedQty = pickedOrders.reduce((s, o) => s + (o.scannedQty || 0), 0);
                        const pendingQty = pendingOrders.reduce((s, o) => s + (o.pendingQty || 0), 0);
                        const dbStock = reservation.dbStock;
                        const siigoStock = reservation.siigoStock;
                        const stockMatch = siigoStock !== null && dbStock !== null && Math.round(siigoStock) === Math.round(dbStock);
                        const stockDiff = siigoStock !== null && dbStock !== null ? Math.round(siigoStock - dbStock) : null;

                        return (
                            <>
                                {/* DB vs Siigo comparison */}
                                {(() => {
                                    const bothNegative = dbStock < 0 || (siigoStock !== null && siigoStock < 0);
                                    const hasDiff = stockDiff !== null && stockDiff !== 0;
                                    const borderColor = bothNegative ? 'bg-red-50 border-red-300' : hasDiff ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200';
                                    return (
                                        <div className={`rounded-lg p-2.5 border ${borderColor}`}>
                                            {bothNegative && (
                                                <div className="text-[10px] font-bold text-red-600 text-center mb-1.5">⚠ Stock negativo — requiere conteo físico</div>
                                            )}
                                            <div className="grid grid-cols-3 gap-2 text-center">
                                                <div>
                                                    <div className="text-[9px] font-bold text-gray-500 uppercase">Sistema</div>
                                                    <div className={`text-lg font-black ${dbStock < 0 ? 'text-red-600' : 'text-gray-800'}`}>{dbStock !== null ? Math.round(dbStock) : '—'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[9px] font-bold text-gray-500 uppercase">Siigo</div>
                                                    <div className={`text-lg font-black ${siigoStock !== null && siigoStock < 0 ? 'text-red-600' : 'text-gray-800'}`}>{siigoStock !== null ? Math.round(siigoStock) : '...'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[9px] font-bold text-gray-500 uppercase">Diferencia</div>
                                                    {stockDiff !== null ? (
                                                        <div className={`text-lg font-black ${stockDiff === 0 ? 'text-gray-400' : 'text-red-600'}`}>
                                                            {stockDiff === 0 ? '0' : (stockDiff > 0 ? `+${stockDiff}` : stockDiff)}
                                                        </div>
                                                    ) : (
                                                        <div className="text-lg font-black text-gray-400">—</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-3 gap-2">
                                    <div className="p-2 bg-orange-50 rounded-lg border border-orange-200 text-center">
                                        <div className="text-[9px] font-bold text-orange-600 uppercase">Comprometido</div>
                                        <div className="text-lg font-black text-orange-600">{Math.round(reservation.reservedQty)}</div>
                                    </div>
                                    <div className={`p-2 rounded-lg border text-center ${available >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                                        <div className="text-[9px] font-bold uppercase text-gray-500">Libre</div>
                                        <div className={`text-lg font-black ${available >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Math.round(available)}</div>
                                    </div>
                                    <div className="p-2 bg-blue-50 rounded-lg border border-blue-100 text-center">
                                        <div className="text-[9px] font-bold text-blue-500 uppercase">Piqueado</div>
                                        <div className="text-lg font-black text-blue-900">{Math.round(pickedQty)}</div>
                                    </div>
                                </div>

                                {/* Picking section */}
                                {pickedOrders.length > 0 && (
                                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-bold text-blue-700 uppercase">Piqueado</h4>
                                            <span className="text-sm font-black text-blue-700">{Math.round(pickedQty)} uds</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {pickedOrders.map((o, i) => (
                                                <div key={i} className="bg-white/80 rounded-lg px-3 py-2">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm font-black text-blue-800">{Math.round(o.scannedQty)} / {Math.round(o.requestedQty)} uds</span>
                                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-200 text-blue-800">PIQUEADO</span>
                                                    </div>
                                                    <div className="text-[11px] text-gray-600 mt-0.5 truncate">{o.orderNumber}</div>
                                                    {o.distributor && <div className="text-[10px] text-gray-400">{o.distributor}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Pending/Approved section */}
                                {pendingOrders.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-bold text-amber-700 uppercase">Solo Pedido</h4>
                                            <span className="text-sm font-black text-amber-700">{Math.round(pendingQty)} uds</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {pendingOrders.map((o, i) => (
                                                <div key={i} className="bg-white/80 rounded-lg px-3 py-2">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm font-black text-amber-800">{Math.round(o.pendingQty)} uds</span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                            o.status === 'APPROVED' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-700'
                                                        }`}>{o.status === 'APPROVED' ? 'APROBADO' : 'PENDIENTE'}</span>
                                                    </div>
                                                    <div className="text-[11px] text-gray-600 mt-0.5 truncate">{o.orderNumber}</div>
                                                    {o.distributor && <div className="text-[10px] text-gray-400">{o.distributor}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {(!reservation.orders || reservation.orders.length === 0) && reservation.reservedQty === 0 && (
                                    <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100 text-center">
                                        <div className="text-sm font-bold text-emerald-600">Sin pedidos activos</div>
                                        <div className="text-[10px] text-emerald-500 mt-0.5">Todo el stock está disponible</div>
                                    </div>
                                )}
                            </>
                        );
                    })()}

                    {!reservation && (
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 text-center">
                            <div className="text-[11px] text-gray-400">Cargando información de ventas...</div>
                        </div>
                    )}
                </div>

                </div>
                </div>
            </div>
            {showLots && (
                <LotManagementModal
                    key={product.id}
                    product={product}
                    initialScan={lotScanForModal}
                    onScanConsumed={() => {
                        setLotScanForModal(null);
                        onLotScanConsumed?.();
                    }}
                    onClose={() => {
                        setLotScanForModal(null);
                        setShowLots(false);
                    }}
                    onChanged={() => {
                        loadZoneBreakdown(product);
                        onUpdate?.();
                    }}
                />
            )}
        </div>
    );
};

export default React.memo(ProductAnalysisModal);
