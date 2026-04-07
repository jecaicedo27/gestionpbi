import React, { useState } from 'react';
import { CheckCircle, Loader } from 'lucide-react';

/**
 * GMezclado — Paso de Mezclado para Geniality
 * Pantalla simple de instrucciones + confirmación del operador.
 */
const GMezclado = ({ note, onConfirm }) => {
    const [confirmed, setConfirmed] = useState(false);
    const instruction = note?.processParameters?.instruction || 'Mezclar los ingredientes según la fórmula hasta obtener una mezcla homogénea.';

    const handleConfirm = () => {
        setConfirmed(true);
        setTimeout(() => onConfirm?.(), 400);
    };

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto justify-center items-center px-4 gap-6">
            <div className="bg-white rounded-2xl shadow-lg border-2 border-teal-400 w-full overflow-hidden">
                <div className="bg-gradient-to-r from-teal-600 to-emerald-500 p-3 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">🌀 MEZCLADO</span>
                </div>
                <div className="p-6 flex flex-col gap-4">
                    <div className="bg-teal-50 border-2 border-teal-200 rounded-xl p-4">
                        <div className="text-xs font-bold text-teal-500 uppercase mb-2">Instrucción de Proceso</div>
                        <div className="text-base text-slate-700 font-semibold leading-relaxed">{instruction}</div>
                    </div>

                    {note?.processParameters?.time_minutes && (
                        <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-center">
                            <div className="text-xs font-bold text-amber-500 uppercase">Tiempo estimado</div>
                            <div className="text-3xl font-black text-amber-700">{note.processParameters.time_minutes} min</div>
                        </div>
                    )}

                    <button
                        onClick={handleConfirm}
                        disabled={confirmed}
                        className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                            ${confirmed
                                ? 'bg-green-100 border-2 border-green-300 text-green-700'
                                : 'bg-gradient-to-r from-teal-600 to-emerald-500 text-white hover:shadow-xl'
                            }`}
                    >
                        {confirmed ? <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> ¡Mezclado completado!</span> : '✅ Confirmar Mezclado'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GMezclado;
