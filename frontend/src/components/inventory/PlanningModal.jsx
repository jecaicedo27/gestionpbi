
import React, { useState } from 'react';
import { X, FileDown, Calendar, Database } from 'lucide-react';
import api from '../../services/api';

const PlanningModal = ({ onClose }) => {
    const [prodDays, setProdDays] = useState(8);
    const [purchDays, setPurchDays] = useState(15);
    const [loadingProd, setLoadingProd] = useState(false);
    const [loadingPurch, setLoadingPurch] = useState(false);

    const downloadReport = async (type, days, setLoading) => {
        try {
            setLoading(true);
            const response = await api.get(`/reports/${type}?days=${days}`, {
                responseType: 'blob'
            });

            // Create download link
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const fileName = type === 'production'
                ? `Plan_Produccion_${days}dias.xlsx`
                : `Plan_Compras_${days}dias.xlsx`;

            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);

        } catch (error) {
            console.error('Error downloading report:', error);
            alert('Error al generar el reporte.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[50]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1 hover:bg-gray-100 rounded-full transition-colors"
                >
                    <X className="w-5 h-5 text-gray-400" />
                </button>

                <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center">
                    <Calendar className="w-5 h-5 mr-2 text-indigo-600" />
                    Planificación
                </h2>
                <p className="text-sm text-gray-500 mb-6">Genera reportes de Excel para programar la operación.</p>

                <div className="space-y-6">
                    {/* Production Section */}
                    <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                        <h3 className="text-sm font-bold text-orange-800 mb-3 flex items-center">
                            🏭 Planeación de Producción
                            <span className="ml-auto text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">Prod. Terminado</span>
                        </h3>

                        <div className="flex items-end gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Días a Cubrir</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={prodDays}
                                    onChange={(e) => setProdDays(Math.max(1, parseInt(e.target.value) || 0))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                                />
                            </div>
                            <button
                                onClick={() => downloadReport('production', prodDays, setLoadingProd)}
                                disabled={loadingProd}
                                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded shadow-sm text-sm font-medium flex items-center transition-colors disabled:opacity-50 h-[38px]"
                            >
                                {loadingProd ? (
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                                ) : (
                                    <FileDown className="w-4 h-4 mr-2" />
                                )}
                                {loadingProd ? 'Generando...' : 'Descargar'}
                            </button>
                        </div>
                    </div>

                    {/* Purchasing Section */}
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <h3 className="text-sm font-bold text-blue-800 mb-3 flex items-center">
                            🛒 Planeación de Compras
                            <span className="ml-auto text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">Materia Prima</span>
                        </h3>

                        <div className="flex items-end gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Días a Cubrir</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={purchDays}
                                    onChange={(e) => setPurchDays(Math.max(1, parseInt(e.target.value) || 0))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                />
                            </div>
                            <button
                                onClick={() => downloadReport('purchasing', purchDays, setLoadingPurch)}
                                disabled={loadingPurch}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-sm text-sm font-medium flex items-center transition-colors disabled:opacity-50 h-[38px]"
                            >
                                {loadingPurch ? (
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                                ) : (
                                    <FileDown className="w-4 h-4 mr-2" />
                                )}
                                {loadingPurch ? 'Generando...' : 'Descargar'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-6 text-center">
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs underline">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PlanningModal;
