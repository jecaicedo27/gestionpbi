import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * IntroStep — redesigned with card + gradient header style.
 * Shows production context, batch info, materials list, and production target.
 * For EMPAQUE notes with multiple presentations: shows a selection grid.
 */
const IntroStep = ({
    note,
    allBatchNotes = [],
    targetQuantityValue = '',
    onTargetQtyChange,
    esferaOutputFactor = 1.1,
    onSkipToEmpaque,
}) => {
    const navigate = useNavigate();
    const noteData = note;
    const isAlreadyStarted = noteData.status === 'EXECUTING';

    const isFormacion = noteData.processType?.code === 'FORMACION';
    const isEnsamble = noteData.processType?.code === 'ENSAMBLE';
    const isConteo = noteData.processType?.code === 'CONTEO';
    const isEmpaque = noteData.processType?.code === 'EMPAQUE';

    const outputTargets = noteData.productionBatch?.outputTargets || [];

    // ── FORMACION meta ──────────────────────────────────────────────────────
    // Uses targetQuantity from backend (= formula.baseQuantity, e.g. 150,000g).
    //
    // Factor de Rendimiento (DESHABILITADO — ahora se usa la fórmula directamente):
    //   esferaOutputFactor = 1.25 (alginato aporta ~25% masa extra)
    //   Cálculo: Esferas = Compuesto × 1.25
    //   Ej: 122,518g compuesto × 1.25 = 153,147g esferas
    //   Si se necesita reactivar:
    //     const compuestoItem = noteData.items?.find(it =>
    //         it.component?.name?.toUpperCase().includes('COMPUESTO'));
    //     const baseQty = noteData.compuestoActualQty || compuestoItem?.plannedQuantity;
    //     formacionMeta = baseQty ? (baseQty * 1.25).toFixed(0) : noteData.targetQuantity;
    let formacionMeta = null;
    if (isFormacion) {
        formacionMeta = noteData.targetQuantity || null;
    }

    // ── ENSAMBLE meta ───────────────────────────────────────────────────────
    let ensambleMeta = null;
    let ensambleMetaUnit = 'uds';
    if (isEnsamble) {
        const stageName = (noteData.stageName || '').toLowerCase();
        const nums = (stageName.match(/\d{3,}/g) || []);
        const target = outputTargets.find(t => {
            const pName = (t.product?.name || t.product?.sku || '').toLowerCase();
            return nums.some(n => pName.includes(n));
        }) || (outputTargets.length === 1 ? outputTargets[0] : null);

        if (target?.plannedUnits && target.plannedUnits < 50000) {
            // Final product ENSAMBLE (unit-based, e.g. 160 tarros)
            ensambleMeta = target.plannedUnits;
            ensambleMetaUnit = 'uds';
        } else if (noteData.targetQuantity) {
            // Weight-based ENSAMBLE (e.g. PROTECCION 108,000g, BASE 240,000g)
            ensambleMeta = noteData.targetQuantity;
            ensambleMetaUnit = noteData.unit || 'g';
        }

        // Fallback: sum of note's own weight items (always available on first render)
        if (!ensambleMeta && noteData.items?.length > 0) {
            const weightUnits = ['g', 'kg', 'gramo', 'gramos'];
            const total = noteData.items.reduce((sum, item) => {
                if (!weightUnits.includes(item.unit)) return sum;
                const qty = item.plannedQuantity || 0;
                return sum + (item.unit === 'kg' ? qty * 1000 : qty);
            }, 0);
            if (total > 0) {
                ensambleMeta = Math.round(total);
                ensambleMetaUnit = 'g';
            }
        }
    }

    // ── EMPAQUE meta ────────────────────────────────────────────────────────
    let empaquePlanned = null;
    let empaqueConteo = null;
    if (isEmpaque) {
        const stageName = (noteData.stageName || '').toLowerCase();
        const nums = (stageName.match(/\d{3,}/g) || []);
        const target = outputTargets.find(t => {
            const pName = (t.product?.name || '').toLowerCase();
            return nums.some(n => pName.includes(n));
        }) || (outputTargets.length === 1 ? outputTargets[0] : null);
        empaquePlanned = target?.plannedUnits ?? null;
        empaqueConteo = noteData.empaqueData?.conteo_qty ?? null;
    }

    // ── EMPAQUE multi-presentation selector ─────────────────────────────────
    if (isEmpaque) {
        const empaqueNotes = allBatchNotes
            .filter(n => n.processType?.code === 'EMPAQUE')
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));

        if (empaqueNotes.length > 1) {
            const completedCount = empaqueNotes.filter(n => n.status === 'COMPLETED').length;
            const allDone = completedCount === empaqueNotes.length;
            return (
                <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-12 w-12 rounded-full bg-violet-500 text-white flex items-center justify-center text-2xl shadow-md">📦</div>
                        <div>
                            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">EMPAQUE · SELECCIÓN</div>
                            <div className="text-xs text-slate-400 mt-0.5">{completedCount} de {empaqueNotes.length} presentaciones completadas</div>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl shadow-2xl border-4 border-violet-400 overflow-hidden flex-1 flex flex-col">
                        <div className="bg-gradient-to-r from-violet-600 to-purple-500 p-4 text-center">
                            <span className="text-white font-extrabold text-lg uppercase tracking-widest">📦 ¿Qué presentación vas a empacar?</span>
                        </div>

                        {/* Progress bar */}
                        <div className="px-6 pt-4">
                            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                                <span>Progreso de empaque</span>
                                <span className="font-bold">{completedCount}/{empaqueNotes.length}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-violet-500'}`}
                                    style={{ width: `${(completedCount / empaqueNotes.length) * 100}%` }}
                                />
                            </div>
                        </div>

                        <div className="flex-1 p-6 space-y-3">
                            <p className="text-sm text-slate-400 font-medium">Lote {noteData.productionBatch?.batchNumber}</p>
                            {empaqueNotes.map(en => {
                                const isCompleted = en.status === 'COMPLETED';
                                const isExecuting = en.status === 'EXECUTING';
                                const nums2 = (en.stageName || '').toLowerCase().match(/\d{3,}/g) || [];
                                const target2 = outputTargets.find(t =>
                                    nums2.some(n => (t.product?.name || '').toLowerCase().includes(n))
                                );
                                const planned2 = target2?.plannedUnits;
                                return (
                                    <button key={en.id} disabled={isCompleted}
                                        onClick={() => {
                                            if (isCompleted) return;
                                            if (en.id === noteData.id) {
                                                // Current note — skip intro, go to EMPAQUE step directly
                                                if (onSkipToEmpaque) onSkipToEmpaque();
                                            } else {
                                                // Different note — navigate with skipIntro flag
                                                navigate(`/assembly-execution/${en.id}?skipIntro=1`);
                                                setTimeout(() => window.location.reload(), 100);
                                            }
                                        }}
                                        className={`w-full text-left rounded-2xl border-2 p-5 flex items-center justify-between transition-all shadow-sm
                                            ${isCompleted ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed' :
                                                isExecuting ? 'bg-blue-50 border-blue-400 hover:border-blue-500 cursor-pointer' :
                                                    'bg-white border-slate-200 hover:border-violet-400 hover:bg-violet-50 cursor-pointer'}`}>
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${isCompleted ? 'bg-slate-100' : isExecuting ? 'bg-blue-100' : 'bg-violet-100'}`}>
                                                {isCompleted ? '✅' : isExecuting ? '⚡' : '📦'}
                                            </div>
                                            <div>
                                                <div className="font-black text-slate-800 text-base">{en.stageName || en.product?.name}</div>
                                                <div className="text-xs text-slate-400 mt-0.5">
                                                    {planned2 ? `${planned2.toLocaleString('es-CO')} tarros planificados` : 'Ver detalle'}
                                                    {!isCompleted && (
                                                        <span className="ml-2 text-violet-600 font-bold">
                                                            {isExecuting ? '→ Continuar empaque' : '→ Ir a empacar'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isCompleted ? 'bg-slate-200 text-slate-600' : isExecuting ? 'bg-blue-200 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                                            {isCompleted ? 'Completado' : isExecuting ? 'En Proceso' : 'Pendiente'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Bottom guidance banner */}
                        <div className={`mx-6 mb-6 rounded-2xl p-4 text-center text-sm font-bold ${allDone
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                            : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                            {allDone
                                ? '✅ Todas las presentaciones completadas — presiona SIGUIENTE para avanzar'
                                : `⚠️ Debes completar TODAS las presentaciones (${empaqueNotes.length - completedCount} pendientes) antes de pasar al siguiente proceso`
                            }
                        </div>
                    </div>
                </div>
            );
        }

    }

    // ── Target quantity value for display ────────────────────────────────────
    const isPesaje = noteData.processType?.code === 'PESAJE';
    const pesajeTotalG = isPesaje && noteData.items?.length > 0
        ? noteData.items.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
        : null;

    // ── Generic formula meta for other process types (Cocción, Enfriamiento, etc.) ──
    const formulaBaseQty = noteData.product?.formulas?.[0]?.baseQuantity || null;
    const formulaBaseUnit = noteData.product?.formulas?.[0]?.baseUnit || 'g';

    // For ENSAMBLE, show actual produced quantity from the LAST completed PESAJE step
    // (each PESAJE reports cumulative output, so the last one includes everything)
    const completedPesajes = isEnsamble
        ? allBatchNotes
            .filter(n => n.processType?.code === 'PESAJE' && n.status === 'COMPLETED' && n.actualQuantity > 0)
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))
        : [];
    const ensambleMetaQty = completedPesajes.length > 0
        ? completedPesajes[completedPesajes.length - 1].actualQuantity
        : null;

    // ── For any step after PESAJE: show actual produced from completed PESAJE steps ──
    const isCoccion = noteData.processType?.code === 'COCCION';
    const isEnfriamiento = noteData.processType?.code === 'ENFRIAMIENTO';
    const isPostPesaje = !isPesaje && !isEnsamble && !isEmpaque && !isFormacion && !isConteo;
    // Use the LAST completed PESAJE actual (cumulative, includes everything)
    const postPesajeCompleted = isPostPesaje
        ? allBatchNotes
            .filter(n => n.processType?.code === 'PESAJE' && n.status === 'COMPLETED' && n.actualQuantity > 0)
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))
        : [];
    const actualProducedTotal = postPesajeCompleted.length > 0
        ? postPesajeCompleted[postPesajeCompleted.length - 1].actualQuantity
        : null;

    const metaValue = isEnsamble && ensambleMeta
        ? `${Number(ensambleMeta).toLocaleString('es-CO')} ${ensambleMetaUnit}`
        : isEmpaque
                ? `${empaqueConteo?.toLocaleString('es-CO') ?? empaquePlanned?.toLocaleString('es-CO') ?? '—'} tarros`
                : isFormacion && formacionMeta
                    ? `${Number(formacionMeta).toLocaleString('es-CO')} g`
                    : isPostPesaje && actualProducedTotal > 0
                        ? `${actualProducedTotal.toLocaleString('es-CO', { maximumFractionDigits: 1 })} g`
                        : pesajeTotalG
                            ? `${pesajeTotalG.toLocaleString('es-CO', { maximumFractionDigits: 1 })} g`
                            : formulaBaseQty
                                ? `${Number(formulaBaseQty).toLocaleString('es-CO')} ${formulaBaseUnit}`
                                : null;

    // Color theme based on process type
    const colors = isEnsamble
        ? { from: 'from-emerald-600', to: 'to-teal-500', border: 'border-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : isEmpaque
            ? { from: 'from-rose-500', to: 'to-pink-400', border: 'border-rose-400', badge: 'bg-rose-50 text-rose-700 border-rose-200' }
            : isConteo
                ? { from: 'from-cyan-600', to: 'to-sky-500', border: 'border-cyan-400', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' }
                : { from: 'from-blue-600', to: 'to-indigo-500', border: 'border-blue-400', badge: 'bg-blue-50 text-blue-700 border-blue-200' };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Step label */}
            <div className="flex items-center gap-3 mb-6">
                <div className={`h-12 w-12 rounded-full text-white flex items-center justify-center text-2xl shadow-md bg-gradient-to-br ${colors.from} ${colors.to}`}>
                    {isAlreadyStarted ? '⚡' : '🚀'}
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    {isAlreadyStarted ? 'PROCESO EN CURSO' : 'INICIO DE PROCESO'}
                </div>
            </div>

            {/* Main card */}
            <div className={`bg-white rounded-3xl shadow-2xl border-4 ${colors.border} overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300`}>
                <div className={`bg-gradient-to-r ${colors.from} ${colors.to} p-4 text-center`}>
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        {noteData.stageName}
                    </span>
                    <div className="text-white/70 text-xs mt-0.5">{noteData.processType?.name}</div>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">
                    {/* Metric chips */}
                    <div className="grid grid-cols-3 gap-3">
                        {/* Meta chip */}
                        {metaValue ? (
                            <div className={`rounded-2xl p-3 text-center border ${colors.badge}`}>
                                <div className="text-xs font-bold uppercase mb-1 opacity-70">
                                    {isEnsamble ? 'Meta' : isEmpaque ? 'A Empacar' : isFormacion ? 'Meta (g)' : isPesaje ? 'Total (g)' : isPostPesaje ? 'Total Producido' : 'Total Lote'}
                                </div>
                                <div className="text-xl font-black">{metaValue}</div>
                            </div>
                        ) : noteData.processParameters?.repeatTotal ? (
                            <div className="bg-indigo-50 rounded-2xl p-3 text-center border border-indigo-200">
                                <div className="text-xs font-bold text-indigo-500 uppercase mb-1">Lotes a Fabricar</div>
                                <div className="text-xl font-black text-indigo-700">{noteData.processParameters.repeatTotal}</div>
                                <div className="text-xs text-indigo-400 font-semibold">
                                    Este es el #{noteData.processParameters.repeatBatch}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-blue-50 rounded-2xl p-3 text-center border border-blue-200">
                                <div className="text-xs font-bold text-blue-500 uppercase mb-1">Meta</div>
                                <input
                                    type="number"
                                    value={targetQuantityValue}
                                    onChange={(e) => onTargetQtyChange?.(e.target.value)}
                                    className="text-xl font-black text-blue-700 w-full text-center bg-transparent border-none outline-none"
                                    min="1"
                                />
                            </div>
                        )}

                        {/* Lote chip */}
                        <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Lote</div>
                            <div className="text-sm font-black text-slate-800 break-all leading-tight">
                                {noteData.productionBatch?.batchNumber || '—'}
                            </div>
                        </div>

                        {/* Materiales chip */}
                        <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Materiales</div>
                            <div className="text-xl font-black text-slate-800">{noteData.items?.length || 0}</div>
                            <div className="text-xs text-slate-400">ingredientes</div>
                        </div>
                    </div>

                    {/* CONTEO: list presentations */}
                    {isConteo && outputTargets.length > 0 && (
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                            <div className="text-xs font-bold text-slate-400 uppercase mb-3">Presentaciones a Contar</div>
                            <div className="space-y-2">
                                {outputTargets.map((t, i) => (
                                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                                        <span className="text-sm font-semibold text-slate-700">{t.product?.name || t.product?.sku}</span>
                                        <span className="text-sm font-black text-cyan-600">{t.plannedUnits?.toLocaleString('es-CO')} uds</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* EMPAQUE: planificado vs conteo */}
                    {isEmpaque && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                                <div className="text-xs font-bold text-slate-500 uppercase mb-1">Planificado</div>
                                <div className="text-xl font-black text-slate-700">{empaquePlanned?.toLocaleString('es-CO') ?? '—'}</div>
                            </div>
                            <div className="bg-rose-50 rounded-2xl p-3 text-center border border-rose-200">
                                <div className="text-xs font-bold text-rose-500 uppercase mb-1">Del Conteo</div>
                                <div className="text-xl font-black text-rose-700">{empaqueConteo?.toLocaleString('es-CO') ?? '—'}</div>
                            </div>
                        </div>
                    )}

                    {/* Materials list */}
                    {noteData.items?.length > 0 && (
                        <div>
                            <div className="text-xs font-bold text-slate-400 uppercase mb-2">Ingredientes a utilizar:</div>
                            <div className="space-y-2">
                                {noteData.items.map((item, i) => (
                                    <div key={i} className="flex justify-between bg-slate-50 px-4 py-3 rounded-xl border border-slate-100 text-sm">
                                        <span className="font-medium text-slate-700">{item.component?.name || 'Material'}</span>
                                        <span className="font-bold text-blue-600">
                                            {(item.plannedQuantity || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} {item.unit}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Call to action */}
                    <div className="text-center pt-2 pb-2">
                        <div className={`inline-block text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full ${isAlreadyStarted ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-700'}`}>
                            {isAlreadyStarted ? '⚡ Ya iniciado — Presiona SIGUIENTE' : '🚀 Presiona INICIAR PROCESO para consumir materiales'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default IntroStep;
