import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

const SyncProgressModal = ({ isOpen, onClose, progressData }) => {
    if (!isOpen) return null;

    const isCompleted = progressData?.status === 'COMPLETED';
    const isError = progressData?.status === 'ERROR';
    const isConfirm = progressData?.status === 'CONFIRM';

    const handleConfirm = () => {
        if (progressData.onConfirm) progressData.onConfirm();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 p-6">

                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-gray-900">
                        {isCompleted ? '¡Sincronización Exitosa!' : isError ? 'Error en Sincronización' : isConfirm ? 'Confirmar Acción' : 'Sincronizando Inventario'}
                    </h3>
                    {(isCompleted || isError || isConfirm) && (
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="space-y-6">
                    {/* Status Icon & Message */}
                    <div className="flex flex-col items-center justify-center text-center space-y-3">
                        {isCompleted ? (
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-2">
                                <CheckCircle className="w-8 h-8 text-green-600" />
                            </div>
                        ) : isError ? (
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-2">
                                <AlertTriangle className="w-8 h-8 text-red-600" />
                            </div>
                        ) : isConfirm ? (
                            <div className="w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center mb-2">
                                <AlertTriangle className="w-8 h-8 text-yellow-600" />
                            </div>
                        ) : (
                            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-2 relative">
                                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                            </div>
                        )}

                        <p className="text-gray-600 font-medium">{progressData?.message || 'Iniciando...'}</p>
                    </div>

                    {/* Progress Bar */}
                    {!isCompleted && !isError && !isConfirm && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-gray-500 font-medium">
                                <span>Progreso</span>
                                <span>{Math.round(progressData?.percentage || 0)}%</span>
                            </div>
                            <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${progressData?.percentage || 0}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Results Summary */}
                    {isCompleted && progressData?.result && (
                        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-center border border-gray-100">
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Total</p>
                                <p className="text-lg font-bold text-gray-900">{progressData.result.total}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Éxito</p>
                                <p className="text-lg font-bold text-green-600">{progressData.result.synced}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Errores</p>
                                <p className="text-lg font-bold text-red-500">{progressData.result.errors}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                {isCompleted && (
                    <div className="mt-8">
                        <button
                            onClick={onClose}
                            className="w-full py-2.5 px-4 bg-gray-900 hover:bg-black text-white rounded-xl font-medium transition-colors shadow-lg shadow-gray-200"
                        >
                            Cerrar y Recargar
                        </button>
                    </div>
                )}

                {isConfirm && (
                    <div className="mt-8 flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-2.5 px-4 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-medium transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-200"
                        >
                            Confirmar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SyncProgressModal;
