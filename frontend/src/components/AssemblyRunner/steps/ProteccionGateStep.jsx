import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw, ArrowRight } from 'lucide-react';
import api from '../../../services/api';

/**
 * ProteccionGateStep
 *
 * Validation gate before esferificación (FORMACION).
 * Checks MaterialLot stock for PROTECCION {FLAVOR}.
 * Blocks if stock = 0, allows passage if stock > 0.
 */
const ProteccionGateStep = ({ stepData, onProteccionValidated }) => {
    const noteId = stepData?.id;
    const [checking, setChecking] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const checkStock = useCallback(async () => {
        if (!noteId) return;
        try {
            setChecking(true);
            setError(null);
            const res = await api.get(`/assembly-notes/${noteId}/check-proteccion`);
            setResult(res.data);
            onProteccionValidated?.(res.data.sufficient);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
            onProteccionValidated?.(false);
        } finally {
            setChecking(false);
        }
    }, [noteId, onProteccionValidated]);

    useEffect(() => { checkStock(); }, [checkStock]);

    const sufficient = result?.sufficient;
    const available = result?.available || 0;
    const flavor = result?.flavor || '';

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto pt-8 pb-36 px-4">
            <div className="flex items-center gap-3 mb-6">
                <div className={`h-12 w-12 rounded-full ${sufficient ? 'bg-green-500' : 'bg-red-500'} text-white flex items-center justify-center font-bold text-2xl shadow-md`}>
                    {sufficient ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    Validación de Protección
                </div>
            </div>

            <div className={`rounded-3xl shadow-2xl border-4 ${sufficient ? 'border-green-400' : 'border-red-400'} overflow-hidden flex-1 flex flex-col`}>
                <div className={`p-5 text-center ${sufficient ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-rose-400'}`}>
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        {sufficient ? '✅ Protección Disponible' : '⛔ Sin Protección'}
                    </span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 bg-white">
                    {checking ? (
                        <div className="flex flex-col items-center gap-4">
                            <RefreshCw size={48} className="text-slate-300 animate-spin" />
                            <p className="text-slate-500 font-medium">Verificando stock de protección...</p>
                        </div>
                    ) : error ? (
                        <div className="text-center space-y-4">
                            <p className="text-red-600 font-bold text-lg">Error verificando protección</p>
                            <p className="text-slate-500">{error}</p>
                        </div>
                    ) : sufficient ? (
                        <div className="text-center space-y-4">
                            <div className="text-6xl">🛡️</div>
                            <h2 className="text-2xl font-black text-green-700">
                                PROTECCIÓN {flavor.toUpperCase()}
                            </h2>
                            <div className="bg-green-50 rounded-2xl p-6 border border-green-200">
                                <div className="text-4xl font-black text-green-600">
                                    {Number(available).toLocaleString('es-CO')} g
                                </div>
                                <div className="text-sm text-green-500 mt-1">disponibles</div>
                            </div>
                            {result?.lots?.length > 0 && (
                                <div className="text-sm text-slate-500 space-y-1">
                                    {result.lots.map((l, i) => (
                                        <div key={i} className="flex justify-between gap-4">
                                            <span className="font-mono">{l.lotNumber}</span>
                                            <span className="font-bold">{Number(l.quantity).toLocaleString('es-CO')}g</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-green-600 font-bold text-lg mt-4">
                                ✅ Puede continuar con esferificación
                            </p>
                        </div>
                    ) : (
                        <div className="text-center space-y-4">
                            <div className="text-6xl">⛔</div>
                            <h2 className="text-2xl font-black text-red-700">
                                NO HAY PROTECCIÓN {flavor.toUpperCase()}
                            </h2>
                            <div className="bg-red-50 rounded-2xl p-6 border border-red-200 max-w-sm">
                                <p className="text-red-700 font-medium leading-relaxed">
                                    Debe fabricar <strong>PROTECCIÓN {flavor.toUpperCase()}</strong> antes de esferificar.
                                </p>
                                <p className="text-red-500 text-sm mt-3">
                                    Vaya al <strong>Panel de Premezclas → Protección</strong>, fabrique el lote y vuelva aquí.
                                </p>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={checkStock}
                        disabled={checking}
                        className="flex items-center gap-2 px-8 py-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-bold text-slate-700 transition-all disabled:opacity-40"
                    >
                        <RefreshCw size={20} className={checking ? 'animate-spin' : ''} />
                        Re-validar Protección
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProteccionGateStep;
