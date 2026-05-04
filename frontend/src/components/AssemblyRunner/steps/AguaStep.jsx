import { useState, useEffect, useRef } from 'react';

/**
 * AguaStep — paso inicial del flujo de PROTECCIÓN.
 *
 * Mientras el operario llena el agua del tanque/baño ácido, este step
 * registra el cronómetro de llenado y, al pulsar "Agua llena", persiste
 * `processParameters.agua_llenado = { startedAt, endedAt, durationMin }`.
 *
 * Restaura el cronómetro en caso de refresco si ya estaba arrancado.
 */
const AguaStep = ({ stepData, onAguaChange }) => {
    const noteData = stepData;
    const saved = noteData?.processParameters?.agua_llenado;

    const [startedAt, setStartedAt] = useState(saved?.startedAt || new Date().toISOString());
    const [completed, setCompleted] = useState(!!saved?.endedAt);
    const [tick, setTick] = useState(0);

    // Tick cada segundo mientras no esté completado
    const intervalRef = useRef(null);
    useEffect(() => {
        if (completed) return;
        intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalRef.current);
    }, [completed]);

    const elapsedMs = (saved?.endedAt ? new Date(saved.endedAt).getTime() : Date.now()) - new Date(startedAt).getTime();
    const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');

    // Notificar al wizard padre cuando cambie el estado
    useEffect(() => {
        onAguaChange?.({
            isComplete: completed,
            startedAt,
            endedAt: completed ? (saved?.endedAt || new Date().toISOString()) : null,
            durationMin: completed ? Math.round(elapsedMs / 60000) : null,
        });
    }, [completed, startedAt]); // eslint-disable-line

    const handleListo = () => {
        const endedAt = new Date().toISOString();
        const durationMin = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000);
        setCompleted(true);
        onAguaChange?.({
            isComplete: true,
            startedAt,
            endedAt,
            durationMin,
        });
    };

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto pt-8 pb-32 px-4 items-center">
            <div className="flex items-center gap-3 mb-6">
                <div className="h-14 w-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 text-white flex items-center justify-center text-3xl shadow-lg">
                    🚰
                </div>
                <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">PASO 1 · LLENADO DE AGUA</div>
                    <div className="text-sm text-slate-500">Baño ácido — protección</div>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-2xl border-4 border-cyan-400 w-full overflow-hidden">
                <div className={`bg-gradient-to-r ${completed ? 'from-emerald-500 to-teal-600' : 'from-cyan-500 to-blue-600'} p-4 text-center`}>
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        {completed ? '✅ AGUA LLENA' : '🟢 LLENANDO AGUA'}
                    </span>
                </div>

                <div className="p-6 flex flex-col items-center gap-5">
                    <div className="text-center">
                        <div className="text-xs font-bold text-slate-400 uppercase mb-1">TIEMPO DE LLENADO</div>
                        <div className={`text-7xl font-black tracking-wider font-mono ${completed ? 'text-emerald-700' : 'text-cyan-700'}`}>
                            {mm}:{ss}
                        </div>
                    </div>

                    <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4 text-center text-sm text-cyan-800">
                        <div className="font-bold mb-1">📋 Mientras se llena el agua:</div>
                        <div>1. Lleva el carrito a la zona de pesaje.</div>
                        <div>2. Pesa todos los ingredientes con foto.</div>
                        <div>3. Vuelve y procede con la adición en orden.</div>
                    </div>

                    {!completed ? (
                        <button
                            onClick={handleListo}
                            className="w-full py-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold text-lg uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3">
                            ✅ Agua llena · seguir al pesaje
                        </button>
                    ) : (
                        <div className="w-full py-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-emerald-700 font-extrabold text-center text-base">
                            ✅ Llenado completado en {Math.round(elapsedMs / 60000)} min — Avanza al pesaje
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AguaStep;
