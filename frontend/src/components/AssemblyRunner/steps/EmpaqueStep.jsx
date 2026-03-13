import React from 'react';

/**
 * EmpaqueStep
 *
 * Quality control step for EMPAQUE process:
 * - Purple gradient header with stats (planned / conteo / aprobados)
 * - Approval rate progress bar
 * - Defective unit counter (+/- buttons)
 * - Per-tarro photo evidence capture with cause selector + description
 * - Bottom summary bar
 */
const EmpaqueStep = ({
    stepData,
    empaqueDefective = 0,
    onEmpaqueDefectiveChange,
    empaquePhotoUrls = [],
    onEmpaquePhotoChange,
    empaqueDefectReasons = [],
    onEmpaqueDefectReasonChange,
}) => {
    const noteData = stepData;
    const empData = noteData.empaqueData || {};
    const conteoQty = empData.conteo_qty ?? null;
    const plannedQty = empData.planned_qty ?? null;
    const defectivos = parseInt(empaqueDefective || 0, 10);
    const aprobados = conteoQty !== null ? Math.max(0, conteoQty - defectivos) : null;
    const needsPhoto = defectivos > 0 && empaquePhotoUrls.filter(Boolean).length < defectivos;
    const pctAprobados = conteoQty > 0 && aprobados !== null ? Math.round((aprobados / conteoQty) * 100) : 100;

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-6 pb-36 px-4 animate-in fade-in duration-300">

            {/* ── Hero Header ── */}
            <div className="rounded-3xl overflow-hidden shadow-2xl mb-5"
                style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #9333ea 100%)' }}>
                <div className="px-8 pt-7 pb-5 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-2xl">📦</span>
                            <span className="text-white/70 text-xs font-bold uppercase tracking-[0.2em]">Empaque · Control de Calidad</span>
                        </div>
                        <h2 className="text-white font-black text-2xl leading-tight">
                            {noteData.product?.name || noteData.stageName}
                        </h2>
                        <div className="text-white/50 text-xs mt-1">Lote {noteData.productionBatch?.batchNumber}</div>
                    </div>
                    <div className="text-right">
                        <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur rounded-full px-3 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-white text-xs font-semibold">En Proceso</span>
                        </div>
                    </div>
                </div>

                {/* ── 3-stat strip ── */}
                <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
                    {[
                        { label: 'Planificado', value: plannedQty, sub: 'programado', color: 'text-white/60' },
                        { label: 'Producción Real', value: conteoQty, sub: 'del conteo', color: 'text-cyan-200' },
                        { label: 'Aprobados', value: aprobados, sub: 'para inventario', color: aprobados === conteoQty ? 'text-emerald-300' : aprobados > 0 ? 'text-yellow-300' : 'text-red-300' },
                    ].map(({ label, value, sub, color }) => (
                        <div key={label} className="px-6 py-4 text-center">
                            <div className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-0.5">{label}</div>
                            <div className={`text-3xl font-black ${color}`}>{value?.toLocaleString('es-CO') ?? '—'}</div>
                            <div className="text-white/40 text-[10px] mt-0.5">{sub}</div>
                        </div>
                    ))}
                </div>

                {/* ── Progress bar ── */}
                <div className="px-8 pb-5">
                    <div className="flex justify-between text-white/40 text-[10px] mb-1.5">
                        <span>Tasa de aprobación</span>
                        <span className="font-bold">{pctAprobados}%</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${pctAprobados}%`,
                                background: pctAprobados === 100 ? '#34d399' : pctAprobados > 80 ? '#fbbf24' : '#f87171'
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* ── Pre-consumed materials summary (read-only) ── */}
            {noteData.processParameters?.materialsPreConsumed && noteData.items?.length > 0 && (
                <div className="bg-white rounded-2xl shadow border border-slate-100 p-5 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-base">📋</span>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Materiales consumidos al completar conteo</span>
                        <span className="ml-auto bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ Auto</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {noteData.items.map((item, i) => {
                            const name = item.component?.name || 'Material';
                            const qty = item.actualQuantity || item.plannedQuantity || 0;
                            const unit = item.unit || item.component?.unit || 'und';
                            const fmtQty = unit === 'gramo' ? `${qty.toLocaleString('es-CO')}g` : `${qty} ${unit}`;
                            return (
                                <div key={i} className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-slate-50 text-sm">
                                    <span className="text-slate-600 font-medium">{name}</span>
                                    <span className="text-slate-800 font-bold">{fmtQty}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Defective input card ── */}
            <div className="bg-white rounded-3xl shadow-lg border border-slate-100 p-6 mb-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="text-sm font-bold text-slate-700">Unidades Defectuosas / En Mal Estado</div>
                        <div className="text-xs text-slate-400 mt-0.5">Jarras con problemas de sellado, etiqueta o formulación</div>
                    </div>
                    {defectivos === 0
                        ? <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full">✓ Sin defectos</span>
                        : <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">⚠ {defectivos} defectuosos</span>
                    }
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.max(0, defectivos - 1))}
                        className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-2xl font-bold flex items-center justify-center transition-all active:scale-95"
                    >−</button>
                    <input
                        type="number"
                        min="0"
                        max={conteoQty ?? 9999}
                        value={empaqueDefective}
                        onChange={e => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.max(0, parseInt(e.target.value || 0, 10)))}
                        className="flex-1 text-4xl font-black text-center text-slate-800 py-3 rounded-2xl border-2 border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 focus:outline-none bg-slate-50 transition-all"
                    />
                    <button
                        onClick={() => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.min(conteoQty ?? 9999, defectivos + 1))}
                        className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-2xl font-bold flex items-center justify-center transition-all active:scale-95"
                    >+</button>
                </div>
            </div>

            {/* ── Per-tarro photo evidence ── */}
            {defectivos > 0 && (
                <div className="flex flex-col gap-3 mb-4">
                    <div className="flex items-center gap-2 px-1">
                        <span className="text-lg">📸</span>
                        <div>
                            <div className="text-sm font-bold text-slate-700">Evidencia Fotográfica — 1 foto por tarro defectuoso</div>
                            <div className="text-xs text-slate-400">{empaquePhotoUrls.filter(Boolean).length} de {defectivos} fotos tomadas</div>
                        </div>
                    </div>
                    {Array.from({ length: defectivos }).map((_, i) => {
                        const photoUrl = empaquePhotoUrls[i] || '';
                        const isUploaded = !!photoUrl;
                        return (
                            <div key={i} className={`bg-white rounded-2xl shadow border-2 p-4 transition-all ${isUploaded ? 'border-emerald-300' : 'border-amber-300'}`}>
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tarro Defectuoso #{i + 1}</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isUploaded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {isUploaded ? '✓ Foto cargada' : '📷 Pendiente'}
                                    </span>
                                </div>
                                {photoUrl && (
                                    <img src={photoUrl} alt={`Defectuoso #${i + 1}`}
                                        className="w-full max-h-40 object-cover rounded-xl border border-emerald-200 mb-3 shadow-sm" />
                                )}
                                {/* Cause selector */}
                                <div className="mb-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Causa del Defecto</label>
                                    <select
                                        value={empaqueDefectReasons[i]?.cause || ''}
                                        onChange={e => onEmpaqueDefectReasonChange && onEmpaqueDefectReasonChange(i, 'cause', e.target.value)}
                                        className="w-full py-2.5 px-3 rounded-xl border-2 border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:outline-none bg-white text-sm font-semibold text-slate-700"
                                    >
                                        <option value="">— Seleccionar causa —</option>
                                        <option value="mal_sellado">Mal Sellado</option>
                                        <option value="tarro_deforme">Tarro Deforme</option>
                                        <option value="tarro_danado">Tarro se Dañó</option>
                                        <option value="cuerpo_extrano">Cuerpo Extraño</option>
                                        <option value="medio_lleno">Medio Lleno</option>
                                    </select>
                                </div>
                                {/* Description */}
                                <div className="mb-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Descripción (opcional)</label>
                                    <input
                                        type="text"
                                        value={empaqueDefectReasons[i]?.description || ''}
                                        onChange={e => onEmpaqueDefectReasonChange && onEmpaqueDefectReasonChange(i, 'description', e.target.value)}
                                        placeholder="Detalle adicional del defecto..."
                                        className="w-full py-2 px-3 rounded-xl border-2 border-slate-200 focus:border-violet-400 focus:outline-none text-sm bg-white"
                                    />
                                </div>
                                {/* Camera button */}
                                <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95 ${isUploaded ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                                    <span className="text-xl">{isUploaded ? '🔄' : '📷'}</span>
                                    <span className="font-semibold text-sm">{isUploaded ? 'Cambiar foto' : 'Tomar foto'}</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        className="sr-only"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const localUrl = URL.createObjectURL(file);
                                            onEmpaquePhotoChange && onEmpaquePhotoChange(i, localUrl);
                                            try {
                                                const fd = new FormData();
                                                fd.append('photo', file);
                                                fd.append('noteId', noteData?.id || '');
                                                fd.append('context', `empaque_defecto_${i + 1}`);
                                                const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
                                                const data = await res.json();
                                                if (data.url) onEmpaquePhotoChange && onEmpaquePhotoChange(i, data.url);
                                            } catch (err) {
                                                console.warn('Upload failed, using local preview:', err);
                                            }
                                        }}
                                    />
                                </label>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Bottom summary ── */}
            {aprobados !== null && (
                <div className={`rounded-2xl p-4 flex items-center justify-center gap-3 text-sm font-bold ${aprobados === conteoQty
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border border-amber-200 text-amber-800'
                    }`}>
                    {aprobados === conteoQty
                        ? <><span>✅</span><span>Todos los <strong>{aprobados}</strong> tarros aprobados — se registrarán en Siigo al completar</span></>
                        : <><span>⚠️</span><span><strong>{aprobados}</strong> aprobados · <strong className="text-red-600">{defectivos} defectuosos</strong> — Siigo generará un ajuste de inventario{needsPhoto ? ' (falta foto)' : ''}</span></>
                    }
                </div>
            )}
        </div>
    );
};

export default EmpaqueStep;
