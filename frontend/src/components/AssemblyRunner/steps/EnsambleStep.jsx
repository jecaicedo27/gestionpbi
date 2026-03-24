import React from 'react';

/**
 * EnsambleStep
 *
 * Displays the Siigo RPA assembly step: shows the product, quantity to assemble,
 * and ingredient list. Clicking "SIGUIENTE" triggers the Siigo bot.
 */
const EnsambleStep = ({ stepData, targetQuantityValue = '' }) => {
    const noteData = stepData;
    const productName = noteData.product?.name || 'Producto';

    // ── Cantidad a ensamblar ─────────────────────────────────────────────────
    // Prioridad:
    //  1. outputTarget que coincida con el stageName (tarros reales del conteo)
    //  2. targetQuantityValue del wizard (fallback)
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const stageName = (noteData.stageName || '').toLowerCase();
    const nums = stageName.match(/\d{3,}/g) || [];

    const matchedTarget = outputTargets.find(t => {
        const pName = (t.product?.name || '').toLowerCase();
        return nums.some(n => pName.includes(n));
    }) || (outputTargets.length === 1 ? outputTargets[0] : null);

    // Use note's targetQuantity (updated by post-CONTEO with actual counts) over outputTarget planned
    const noteTarget = noteData.targetQuantity;
    // For weight-based intermediates (BASE, COMPUESTO, SIROPE) the noteTarget is in grams (e.g. 100000)
    // For unit-based products (LIQUIPOPS X 350) the noteTarget is in units (e.g. 100)
    const isWeightBased = !matchedTarget?.plannedUnits;
    const displayQty = isWeightBased
        ? (noteTarget || Number(targetQuantityValue) || 0)
        : (noteTarget && noteTarget < 50000 ? noteTarget : (matchedTarget?.plannedUnits ?? Number(targetQuantityValue) ?? 0));
    const displayUnit = isWeightBased ? 'g' : 'tarros';

    // Para compatibilidad con código legacy que aún usa targetGrams
    const baseQty = noteData.product?.formulas?.[0]?.baseQuantity || 1;
    const targetGrams = matchedTarget?.plannedUnits ?? (Number(targetQuantityValue) || baseQty);

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-2xl shadow-md">
                        🔧
                    </div>
                    <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                        ENSAMBLE SIIGO
                    </div>
                </div>
            </div>

            {/* Card */}
            <div className="bg-white rounded-3xl shadow-2xl border-4 border-emerald-500 overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300">
                <div className="bg-gradient-to-r from-emerald-600 to-teal-500 p-4 text-center">
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        CREAR NOTA DE ENSAMBLE
                    </span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
                    <div className="text-6xl">🔧</div>

                    <h2 className="text-3xl font-black text-slate-800 text-center">{productName}</h2>

                    <div className="text-center">
                        <span className="text-slate-400 font-bold uppercase text-xs block mb-2">CANTIDAD A ENSAMBLAR</span>
                        <span className="text-5xl font-black text-emerald-600">
                            {displayQty?.toLocaleString('es-CO') ?? '—'}
                        </span>
                        <span className="text-xl text-slate-400 ml-2">{displayUnit}</span>
                    </div>

                    <div className="text-center text-slate-500 max-w-md">
                        <p>Al hacer clic en <b>"SIGUIENTE"</b>, se creará automáticamente la <b>Nota de Ensamble en Siigo</b> mediante el bot RPA.</p>
                    </div>

                    {noteData.items && noteData.items.length > 0 && (
                        <div className="w-full max-w-md bg-slate-50 rounded-2xl p-4 border border-slate-200">
                            <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Ingredientes del Ensamble</h3>
                            {noteData.items.map((item, idx) => (
                                <div key={item.id || idx} className="flex justify-between py-1 border-b border-slate-100 last:border-0">
                                    <span className="text-sm text-slate-600">{item.component?.name || 'Componente'}</span>
                                    <span className="text-sm font-bold text-slate-800">
                                        {(item.plannedQuantity || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} {item.unit}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EnsambleStep;
