import React from 'react';

/**
 * ConteoStep
 *
 * Counting step: operator inputs actual produced units per presentation.
 * Shows deviation vs planned, esferas calculation per product, and a total summary.
 */
const ConteoStep = ({
    stepData,
    conteoActuals = {},
    onConteoActualChange,
}) => {
    const noteData = stepData;
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const batchNumber = noteData.productionBatch?.batchNumber || '';
    const esferaFactors = noteData.processParameters?.esfera_factors || {};

    const getEsferaFactor = (target) => esferaFactors[target.productId] || null;

    const totalEsferas = outputTargets.reduce((sum, t) => {
        const factor = getEsferaFactor(t);
        if (!factor) return sum;
        const actual = parseInt(conteoActuals[t.productId] ?? t.plannedUnits ?? 0, 10);
        return sum + (actual * factor);
    }, 0);

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-2xl shadow-md">
                    📋
                </div>
                <div>
                    <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">CONTEO DE PRESENTACIONES</div>
                    <div className="text-xs text-slate-400">Conteo por presentación</div>
                </div>
            </div>

            {/* ── Lot banner — production must write this on the cart ── */}
            <div className="bg-emerald-500 rounded-2xl p-5 text-center shadow-lg mb-6">
                <div className="text-xs font-bold text-emerald-100 uppercase tracking-widest mb-2">🏷️ LOTE PARA ESCRIBIR EN EL CARRITO</div>
                <div className="text-3xl font-black text-white tracking-wider">{batchNumber}</div>
                <div className="text-xs text-emerald-100 mt-2 font-semibold">Escribe este lote en el carrito antes de entregar a empaque</div>
            </div>

            <div className="bg-white rounded-3xl shadow-2xl border-4 border-cyan-400 overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-600 to-sky-500 p-4 text-center">
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">📋 ¿Cuántas unidades salieron?</span>
                </div>

                <div className="p-6 space-y-4">
                    {outputTargets.length === 0 && (
                        <div className="text-center text-slate-400 py-8">
                            No hay presentaciones programadas para este bache.
                        </div>
                    )}
                    {outputTargets.map((target) => {
                        const actual = conteoActuals[target.productId];
                        const planned = target.plannedUnits;
                        const actualNum = parseInt(actual ?? planned ?? 0, 10);
                        const deviation = actual !== undefined && planned > 0
                            ? ((actualNum - planned) / planned * 100).toFixed(1) : null;
                        const isOk = deviation === null || Math.abs(parseFloat(deviation)) <= 5;
                        const factor = getEsferaFactor(target);
                        const esferas = factor ? actualNum * factor : null;

                        return (
                            <div key={target.id} className={`rounded-2xl border-2 p-5 transition-all ${actual !== undefined
                                ? (isOk ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50')
                                : 'border-slate-200 bg-slate-50'
                                }`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="font-bold text-slate-800 text-base">{target.product?.name || 'Producto'}</div>
                                        <div className="text-xs text-slate-400">
                                            Planeado: <span className="font-semibold text-slate-600">{planned?.toLocaleString('es-CO')} tarros</span>
                                            <span className="ml-2">(≈ {target.plannedWeightKg?.toFixed(1)} kg)</span>
                                        </div>
                                    </div>
                                    {deviation !== null && (
                                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${isOk ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                                            {deviation > 0 ? '+' : ''}{deviation}%
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 mt-2">
                                    {/* Objetivo */}
                                    <div className="flex-1 bg-slate-100 rounded-xl p-3 text-center border border-slate-200">
                                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Objetivo</label>
                                        <div className="text-3xl font-black text-slate-600">{planned?.toLocaleString('es-CO')}</div>
                                        <div className="text-xs text-slate-400">tarros</div>
                                    </div>

                                    <div className="text-slate-300 font-bold text-2xl">→</div>

                                    {/* Real fabricado */}
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-purple-600 uppercase mb-1 block">Real Fabricado</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={actual ?? ''}
                                            onChange={(e) => onConteoActualChange && onConteoActualChange(target.productId, e.target.value)}
                                            className="w-full text-3xl font-black text-center text-purple-700 py-3 px-4 rounded-xl border-2 border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 focus:outline-none bg-white transition-all"
                                            placeholder={planned?.toString()}
                                        />
                                        <div className="text-xs text-center text-slate-400 mt-1">tarros</div>
                                    </div>

                                    {factor && (
                                        <div className="bg-slate-100 rounded-xl p-3 text-center min-w-[90px]">
                                            <div className="text-xs text-slate-400 font-bold uppercase">Esferas</div>
                                            <div className="text-xl font-black text-slate-700">{esferas?.toLocaleString('es-CO')}</div>
                                            <div className="text-xs text-slate-400">× {factor.toLocaleString('es-CO')}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Total esferas */}
                {totalEsferas > 0 && (
                    <div className="mx-6 mb-4 rounded-2xl bg-indigo-600 text-white p-4 flex justify-between items-center">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider opacity-80">TOTAL ESFERAS A ENSAMBLAR EN SIIGO</div>
                            <div className="text-3xl font-black">{totalEsferas.toLocaleString('es-CO')}</div>
                        </div>
                        <div className="text-4xl opacity-80">🫧</div>
                    </div>
                )}

                <div className="px-6 pb-6">
                    <div className="text-xs text-slate-400 text-center bg-slate-50 rounded-xl p-3">
                        💡 Después del conteo se crearán en Siigo: <strong>1 nota de ESFERAS</strong> ({totalEsferas.toLocaleString('es-CO')} und) + <strong>{outputTargets.length} notas</strong> por presentación.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConteoStep;
