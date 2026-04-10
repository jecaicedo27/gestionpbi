import React from 'react';

/**
 * EnsambleStep
 *
 * Two modes:
 * 1. Standalone ENSAMBLE note — shows product + qty + ingredients (original)
 * 2. Within unified EMPAQUE wizard — shows pre-finalization summary with QC + marcado data
 */
const EnsambleStep = ({ stepData, targetQuantityValue = '', allBatchNotes = [], carriots = [], activeCarritoId }) => {
    const noteData = stepData;
    const productName = noteData.product?.name || 'Producto';
    const isEmpaqueNote = noteData.processType?.code === 'EMPAQUE';
    const isGeniality = productName.toUpperCase().includes('GENIALITY');

    // ── Mode 2: Unified EMPAQUE wizard — pre-finalization summary ─────────
    if (isEmpaqueNote) {
        let receivedQty = 0;
        if (carriots?.length > 0) {
            const received = activeCarritoId 
                ? carriots.filter(c => c.id === activeCarritoId)
                : carriots.filter(c => c.receivedAt && !c.ingestedAt && c.productId === noteData.productId);
            receivedQty = received.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
        }

        const emp = noteData.processParameters?.empaque || {};
        const mc = noteData.processParameters?.marcado_cajas || {};
        const conteoQty = receivedQty > 0 ? receivedQty : (emp.conteo_qty || noteData.empaqueData?.conteo_qty || noteData.targetQuantity || 0);
        const defectivos = receivedQty > 0 ? 0 : (emp.defective_qty || 0); // Delta processing uses 0 defects by default until registered
        const aprobados = receivedQty > 0 ? Math.max(0, conteoQty - defectivos) : (emp.approved_qty || Math.max(0, conteoQty - defectivos));
        const defReasons = emp.defect_reasons || [];
        const batchNumber = noteData.productionBatch?.batchNumber || noteData.noteNumber || '';

        return (
            <div className="flex flex-col h-full max-w-3xl mx-auto pt-2 pb-24 px-4">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-base shadow">
                        ✅
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Resumen Final — Ensamble</span>
                </div>

                {/* Main card */}
                <div className="bg-white rounded-2xl shadow-lg border-2 border-emerald-400 overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300">
                    {/* Banner */}
                    <div className="bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2.5 text-center">
                        <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                            Resumen de Producción
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {/* Product & Batch */}
                        <div className="text-center pb-3 border-b border-slate-100">
                            <h2 className="text-lg font-black text-slate-800 leading-tight mb-1">{productName}</h2>
                            <div className="text-xs text-slate-400">Lote: <b className="text-slate-600">{batchNumber}</b></div>
                        </div>

                        {/* Qty Summary Cards */}
                        <div className={`grid gap-3 ${defectivos > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                            <div className="bg-blue-50 rounded-2xl p-3 text-center border border-blue-200">
                                <div className="text-[10px] text-blue-500 font-bold uppercase mb-1">Total Conteo</div>
                                <div className="text-3xl font-black text-blue-700">{Number(conteoQty).toLocaleString('es-CO')}</div>
                            </div>
                            {defectivos > 0 && (
                                <div className="bg-red-50 rounded-2xl p-3 text-center border border-red-200">
                                    <div className="text-[10px] text-red-500 font-bold uppercase mb-1">Defectuosos</div>
                                    <div className="text-3xl font-black text-red-700">{defectivos}</div>
                                </div>
                            )}
                            <div className="bg-emerald-50 rounded-2xl p-3 text-center border border-emerald-200">
                                <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Aprobados</div>
                                <div className="text-3xl font-black text-emerald-700">{Number(aprobados).toLocaleString('es-CO')}</div>
                            </div>
                        </div>

                        {/* Defect Reasons */}
                        {defectivos > 0 && defReasons.length > 0 && (
                            <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                                <div className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">Causas de Defecto</div>
                                <div className="space-y-1">
                                    {defReasons.map((r, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <span className="w-5 h-5 rounded-full bg-red-200 text-red-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0">{i + 1}</span>
                                            <span className="text-red-700 font-medium">{r?.cause || 'Sin causa'}</span>
                                            {r?.detail && <span className="text-red-400 truncate">— {r.detail}</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Marcado Cajas Summary */}
                        {mc.cajas_llenas != null && !isGeniality && (
                            <div className="bg-orange-50 rounded-xl p-3 border border-orange-200">
                                <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-2">📦 Etiquetado</div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <div className="text-[10px] text-orange-400 font-bold uppercase">Cajas Llenas</div>
                                        <div className="text-xl font-black text-orange-700">{mc.cajas_llenas}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-orange-400 font-bold uppercase">Uds/Caja</div>
                                        <div className="text-xl font-black text-orange-700">{mc.unidades_por_caja}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-orange-400 font-bold uppercase">Sueltas</div>
                                        <div className="text-xl font-black text-orange-700">{mc.unidades_sueltas || 0}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* CTA */}
                        <div className="text-center pt-2">
                            <p className="text-sm text-slate-400 leading-relaxed">
                                Al hacer clic en <b className="text-emerald-600">«FINALIZAR»</b>, se cerrará oficialmente el lote de empaque
                                {noteData.processParameters?.assembly_on_complete && ' y el bot RPA creará la nota de ensamble en Siigo'}
                                {isGeniality 
                                    ? '. (El inventario ya fue ingresado dinámicamente carrito por carrito).' 
                                    : ' e ingresará el inventario consolidado a la zona de PRODUCCIÓN.'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Mode 1: Standalone ENSAMBLE note — original layout ───────────────
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const stageName = (noteData.stageName || '').toLowerCase();
    const nums = stageName.match(/\d{3,}/g) || [];

    const matchedTarget = outputTargets.find(t => {
        const pName = (t.product?.name || '').toLowerCase();
        return nums.some(n => pName.includes(n));
    }) || (outputTargets.length === 1 ? outputTargets[0] : null);

    const noteTarget = noteData.targetQuantity;
    const isWeightBased = !matchedTarget?.plannedUnits;

    // For siropes: resolve real qty from completed EMPAQUE note (approved_qty or empaqueRef.conteo_qty)
    // This mirrors resolveEnsambleQty logic so the display matches what the RPA will actually send
    let resolvedRealQty = null;
    if (!isWeightBased && allBatchNotes.length > 0) {
        const empaqueNote = allBatchNotes.find(n =>
            n.processType?.code === 'EMPAQUE' &&
            n.status === 'COMPLETED' &&
            n.productId === noteData.productId
        );
        if (empaqueNote?.processParameters) {
            const ep = empaqueNote.processParameters;
            resolvedRealQty = ep.empaque?.approved_qty
                || ep.empaque?.conteo_qty
                || ep.empaqueRef?.conteo_qty
                || null;
        }
    }

    const displayQty = isWeightBased
        ? (noteTarget || Number(targetQuantityValue) || 0)
        : (resolvedRealQty                                          // real conteo (siropes)
            ?? (noteTarget && noteTarget < 50000 ? noteTarget : null) // note's own target
            ?? matchedTarget?.plannedUnits                           // planned (fallback)
            ?? Number(targetQuantityValue)
            ?? 0);
    const displayUnit = isWeightBased ? 'g' : 'tarros';

    const items = noteData.items || [];

    return (
        <div className="flex flex-col h-full max-w-3xl mx-auto pt-2 pb-24 px-4">
            {/* Compact header */}
            <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-base shadow">
                    🔧
                </div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ensamble Siigo</span>
            </div>

            {/* Main card */}
            <div className="bg-white rounded-2xl shadow-lg border-2 border-emerald-400 overflow-hidden flex-1 flex flex-col">
                {/* Banner */}
                <div className="bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2 flex items-center justify-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        Crear Nota de Ensamble
                    </span>
                </div>

                {/* Body — horizontal split on desktop */}
                <div className="flex flex-col md:flex-row flex-1 min-h-0">
                    {/* Left: product + quantity */}
                    <div className="flex flex-col items-center justify-center p-5 gap-3 md:w-1/2 border-b md:border-b-0 md:border-r border-slate-100">
                        <h2 className="text-lg font-black text-slate-800 text-center leading-tight">{productName}</h2>

                        <div className="text-center">
                            <span className="text-slate-400 font-bold uppercase text-[10px] block mb-1">Cantidad a ensamblar</span>
                            <span className="text-5xl font-black text-emerald-600">
                                {displayQty?.toLocaleString('es-CO') ?? '—'}
                            </span>
                            <span className="text-base text-slate-400 ml-1.5">{displayUnit}</span>
                        </div>

                        <p className="text-center text-slate-400 text-xs max-w-xs">
                            Al hacer clic en <b className="text-slate-600">«FINALIZAR»</b>, el bot RPA creará la nota de ensamble en Siigo automáticamente.
                        </p>
                    </div>

                    {/* Right: ingredients */}
                    {items.length > 0 && (
                        <div className="flex flex-col p-4 md:w-1/2 overflow-y-auto">
                            <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-wider">
                                Ingredientes del ensamble
                            </h3>
                            <div className="space-y-1">
                                {items.map((item, idx) => (
                                    <div key={item.id || idx} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
                                        <span className="text-xs text-slate-600 leading-snug pr-2">{item.component?.name || 'Componente'}</span>
                                        <span className="text-xs font-bold text-slate-800 whitespace-nowrap flex-shrink-0">
                                            {(item.plannedQuantity || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} {item.unit}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EnsambleStep;

