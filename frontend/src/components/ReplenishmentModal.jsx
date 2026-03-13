import React, { useState, useEffect } from 'react';
import { X, Save, TrendingUp, Package, DollarSign } from 'lucide-react';
import { inventoryService } from '../services/api';

const ReplenishmentModal = ({ product, onClose, onUpdate }) => {
    const [formData, setFormData] = useState({
        minimumStock: 0,
        packSize: 1,
        costPrice: 0
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (product) {
            setFormData({
                minimumStock: product.minimumStock || 0,
                packSize: product.packSize || 1,
                costPrice: product.costPrice || 0
            });
        }
    }, [product]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Call API
            await inventoryService.updateProductConfig(product.id, formData);
            onUpdate(product.id, formData); // Optimistic update in parent
            onClose();
        } catch (error) {
            console.error(error);
            alert('Error al guardar cambios');
        } finally {
            setLoading(false);
        }
    };

    if (!product) return null;

    // Calculations for display
    const velocity = product.dailyVelocity || 0;
    const daysRemaining = velocity > 0 ? (product.currentStock / velocity) : 999;
    const recommendedOrder = Math.max(0, (velocity * 15) - product.currentStock); // Simple formula for modal display

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="bg-gray-50 border-b p-4 flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg leading-tight">{product.name}</h3>
                        <p className="text-xs text-gray-500 font-mono mt-1">{product.code} • {product.group || 'Sin Grupo'}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">

                    {/* Status Card */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                            <p className="text-xs font-bold text-blue-600 uppercase mb-1">Stock Actual</p>
                            <p className="text-2xl font-black text-blue-900">{product.currentStock}</p>
                        </div>
                        <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                            <p className="text-xs font-bold text-purple-600 uppercase mb-1">Sugerido (15d)</p>
                            <p className="text-2xl font-black text-purple-900">{Math.ceil(product.projections?.days15?.toBuy || 0)}</p>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-4">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                            <Package size={16} /> Configuración de Reaprovisionamiento
                        </h4>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Mínimo (Stock de Seguridad)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                                    value={formData.minimumStock}
                                    onChange={e => setFormData({ ...formData, minimumStock: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Pack / Caja (Unidades)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                                    value={formData.packSize}
                                    onChange={e => setFormData({ ...formData, packSize: parseFloat(e.target.value) || 1 })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Costo de Compra (Unitario)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-gray-400">$</span>
                                <input
                                    type="number"
                                    className="w-full pl-7 rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                                    value={formData.costPrice}
                                    onChange={e => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">Usado para calcular valor del inventario y pedidos.</p>
                        </div>
                    </div>

                    {/* Analysis Footer */}
                    <div className="border-t pt-4">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2 text-sm mb-3">
                            <TrendingUp size={16} /> Análisis de Consumo
                        </h4>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Velocidad Diaria:</span>
                            <span className="font-medium text-gray-900">{velocity.toFixed(2)} un/día</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                            <span className="text-gray-500">Días hasta agotarse:</span>
                            <span className={`font-medium ${daysRemaining < 7 ? 'text-red-600' : 'text-green-600'}`}>
                                {daysRemaining > 365 ? '> 1 Año' : `${Math.floor(daysRemaining)} días`}
                            </span>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                        >
                            {loading ? 'Guardando...' : <><Save size={18} /> Guardar Cambios</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ReplenishmentModal;
