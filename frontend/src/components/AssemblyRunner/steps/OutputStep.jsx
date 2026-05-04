import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, CheckCircle, Thermometer, Beaker, Eye, Droplets, X } from 'lucide-react';
import api from '../../../services/api';

/**
 * OutputStep — Final production verification step with:
 * - Actual produced quantity
 * - Temperature verification (30°C target)
 * - Quality control parameters (°Brix, pH, Conductividad)
 * - Sensory checklist (Color, Sabor, Viscosidad)
 * - Photo evidence
 * - Observations
 * - Materials summary with deviations
 */
const QC_PARAMS_COMPUESTO = [
    { key: 'brix', label: '°Brix', min: 40, max: 43, step: 0.1, unit: '°Bx', icon: '🔬' },
    { key: 'ph', label: 'pH', min: 4.0, max: 4.3, step: 0.01, unit: '', icon: '🧪' },
    { key: 'conductividad', label: 'Conductividad', min: 0.6, max: 1.8, step: 0.01, unit: 'mS/cm', icon: '⚡' },
];

const QC_PARAMS_PROTECCION = [
    { key: 'brix', label: '°Brix', min: 32, max: 34, step: 0.1, unit: '°Bx', icon: '🔬' },
    { key: 'ph', label: 'pH', min: 2.8, max: 3.2, step: 0.01, unit: '', icon: '🧪' },
];

const QC_PARAMS_SABORIZACION = [
    { key: 'brix', label: '°Brix', min: 60, max: 65, step: 0.1, unit: '°Bx', icon: '🔬' },
    { key: 'ph', label: 'pH', min: 2.8, max: 3.5, step: 0.01, unit: '', icon: '🧪' },
];

const getQcParams = (productName) => {
    const name = (productName || '').toUpperCase();
    if (name.startsWith('PROTECCION')) return QC_PARAMS_PROTECCION;
    if (name.startsWith('COMPUESTO')) return QC_PARAMS_COMPUESTO;
    if (name.startsWith('SABORIZACION')) return QC_PARAMS_SABORIZACION;
    return [];
};

const SENSORY_CHECKS = [
    { key: 'color', label: 'Color', description: 'Verificar que el color sea uniforme y corresponda al estándar', icon: '🎨' },
    { key: 'sabor', label: 'Sabor', description: 'Verificar sabor característico, sin notas extrañas', icon: '👅' },
    { key: 'viscosidad', label: 'Viscosidad', description: 'Verificar consistencia adecuada del producto', icon: '💧' },
];

const OutputStep = ({
    stepData,
    targetQuantityValue = '',
    outputQuantity = '',
    onOutputQtyChange,
    outputObservations = '',
    onObservationsChange,
    actualQuantities = {},
    onQcDataChange,
    allBatchNotes = [],
}) => {
    const noteData = stepData;
    const baseUnit = noteData.product?.formulas?.[0]?.baseUnit || noteData.unit || 'g';
    const isPesaje = noteData.processType?.code === 'PESAJE';
    const isFormacion = noteData.processType?.code === 'FORMACION';
    const productNameUpper = (noteData.product?.name || '').toUpperCase();
    // "Simple" output = PESAJE (BASE SIROPE, SABORIZACION, etc.) or ENSAMBLE
    // These don't need manual "Real Producido" — auto-fill + confirmation + mandatory photo
    const isEnsambleNote = ['ENSAMBLE', 'G_ENSAMBLE'].includes(noteData.processType?.code);
    const isPesajeSimple = isEnsambleNote || (isPesaje && !productNameUpper.startsWith('COMPUESTO') && !productNameUpper.startsWith('PROTECCION'));
    const draft = noteData.processParameters?.output_qc_draft || {};
    const [pesajeConfirmed, setPesajeConfirmed] = useState(!!draft.pesajeConfirmed);
    const pesajeTotalGrams = isPesaje && noteData.items?.length > 0
        ? noteData.items.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
        : null;
    const formulaBase = noteData.product?.formulas?.[0]?.baseQuantity || 0;
    const multiplier = noteData.multiplier || 1;

    // For PESAJE: expected = just THIS note's ingredient sum (independent per batch)
    // BUT: for intermediate PESAJE notes (like "Agregar Conservante"), the ESPERADO should be the
    // total batch output (from a previous completed PESAJE step) + the items being added.
    const pesajeExpected = pesajeTotalGrams;

    // Check if there's a completed PESAJE note with actual output (e.g. the main batch weight)
    const previousPesajeOutput = isPesaje && allBatchNotes?.length > 0
        ? allBatchNotes
            .filter(n => n.processType?.code === 'PESAJE' && n.status === 'COMPLETED' && n.actualQuantity > 0 && n.id !== noteData.id)
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0]?.actualQuantity
        : null;

    // Determine if this is a MAJOR pesaje step (items sum is large relative to the batch)
    // or an ADDITIVE step (small ingredients being added to an existing batch)
    const pesajeIsMajor = pesajeExpected && previousPesajeOutput && pesajeExpected > previousPesajeOutput * 0.1;

    const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE'].includes(noteData.processType?.code);

    let targetGrams;
    if (isEnsamble) {
        // ENSAMBLE: always use the note's target quantity (full batch output)
        targetGrams = noteData.targetQuantity || Number(targetQuantityValue) || 1;
    } else if (pesajeIsMajor || !previousPesajeOutput) {
        // Major step or first step: use items sum directly
        targetGrams = pesajeExpected
            || previousPesajeOutput
            || (isFormacion && formulaBase > 1 ? formulaBase * multiplier : null)
            || Number(targetQuantityValue)
            || noteData.targetQuantity
            || formulaBase
            || 1;
    } else {
        // Additive step: expected = previous batch output + items being added
        targetGrams = previousPesajeOutput + (pesajeExpected || 0);
    }
    const outputNum = parseFloat(outputQuantity) || 0;
    const deviation = outputNum > 0 && targetGrams > 0
        ? (((outputNum - targetGrams) / targetGrams) * 100).toFixed(1) : null;

    // Auto-fill output for simple PESAJE (no physical scale available) and FORMACIÓN (theoretical output known)
    useEffect(() => {
        if ((isPesajeSimple || isFormacion) && targetGrams > 0 && !outputQuantity) {
            onOutputQtyChange(String(targetGrams));
        }
    }, [isPesajeSimple, isFormacion, targetGrams]); // eslint-disable-line

    // ═══ PERSISTENCE: Restore draft from processParameters ═══

    // Temperature verification state
    const [temperature, setTemperature] = useState(draft.temperature || '');
    const TARGET_TEMP = 30;
    const TEMP_TOLERANCE = 2;
    const tempNum = parseFloat(temperature) || 0;
    const tempDeviation = tempNum > 0 ? Math.abs(tempNum - TARGET_TEMP) : null;
    const tempOk = tempDeviation !== null && tempDeviation <= TEMP_TOLERANCE;
    const tempWarning = tempDeviation !== null && tempDeviation > TEMP_TOLERANCE;

    // QC parameters state
    const [qcValues, setQcValues] = useState(draft.qcValues || {});
    const [qcPhotos, setQcPhotos] = useState(draft.qcPhotos || {});

    // Sensory checklist state
    const [sensoryChecks, setSensoryChecks] = useState(draft.sensoryChecks || {});

    // Photo evidence state
    const [verificationPhoto, setVerificationPhoto] = useState(draft.verificationPhoto || '');
    const [tempPhoto, setTempPhoto] = useState(draft.tempPhoto || '');

    // Photo modal state
    const [modalPhoto, setModalPhoto] = useState(null);

    // ═══ PERSISTENCE: Save on blur / after photo upload ═══
    const stateRef = useRef({});
    stateRef.current = { temperature, qcValues, qcPhotos, sensoryChecks, verificationPhoto, tempPhoto, pesajeConfirmed };

    const saveDraft = useCallback(async () => {
        if (!noteData.id) return;
        try {
            const s = stateRef.current;
            await api.patch(`/assembly-notes/${noteData.id}/process-params`, {
                processParameters: {
                    output_qc_draft: {
                        temperature: s.temperature, qcValues: s.qcValues,
                        qcPhotos: s.qcPhotos, sensoryChecks: s.sensoryChecks,
                        verificationPhoto: s.verificationPhoto, tempPhoto: s.tempPhoto,
                        pesajeConfirmed: s.pesajeConfirmed,
                    }
                }
            });
        } catch (err) {
            console.warn('OutputStep draft save failed:', err);
        }
    }, [noteData.id]);

    const handleTempPhoto = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setTempPhoto(localUrl);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', noteData.id || '');
            fd.append('context', 'verificacion_temperatura');
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) setTempPhoto(data.url);
        } catch (err) {
            console.warn('Upload failed:', err);
        }
        setTimeout(saveDraft, 500);
    };
    // Compute QC validity
    const QC_PARAMS = getQcParams(productNameUpper);
    const isProteccion = productNameUpper.startsWith('PROTECCION');
    const qcParamResults = QC_PARAMS.map(p => {
        const val = parseFloat(qcValues[p.key]);
        const filled = !isNaN(val);
        const inRange = filled && val >= p.min && val <= p.max;
        return { ...p, val, filled, inRange };
    });
    const allQcFilled = qcParamResults.every(r => r.filled);
    const allQcInRange = qcParamResults.every(r => r.inRange);
    const allQcPhotos = QC_PARAMS.every(p => qcPhotos[p.key]);
    const allSensoryChecked = isProteccion ? true : SENSORY_CHECKS.every(s => sensoryChecks[s.key]);
    const isCompuesto = productNameUpper.startsWith('COMPUESTO');
    const showPesajeQC = isPesaje && (isCompuesto || isProteccion);
    const qcComplete = isPesajeSimple
        ? (pesajeConfirmed && !!verificationPhoto)  // Simple pesaje: confirm + mandatory photo
        : showPesajeQC
            ? (allQcFilled && allQcInRange && allQcPhotos && allSensoryChecked)
            : true;

    // Notify parent of QC validity
    useEffect(() => {
        onQcDataChange?.({
            isComplete: qcComplete,
            values: qcValues,
            photos: qcPhotos,
            sensoryChecks,
            temperature,
            verificationPhoto,
        });
    }, [qcComplete, qcValues, qcPhotos, sensoryChecks, temperature, verificationPhoto, pesajeConfirmed]);

    const handleQcPhotoCapture = async (paramKey, e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setQcPhotos(prev => ({ ...prev, [paramKey]: localUrl }));
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', noteData.id || '');
            fd.append('context', `qc_${paramKey}`);
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) setQcPhotos(prev => ({ ...prev, [paramKey]: data.url }));
        } catch (err) {
            console.warn('Upload failed:', err);
        }
        setTimeout(saveDraft, 500);
    };

    const handleVerificationPhoto = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setVerificationPhoto(localUrl);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', noteData.id || '');
            fd.append('context', 'verificacion_produccion');
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) setVerificationPhoto(data.url);
        } catch (err) {
            console.warn('Upload failed:', err);
        }
        setTimeout(saveDraft, 500);
    };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-1 pb-24 px-3">
            {/* Main card */}
            <div className="bg-white rounded-xl shadow border-2 border-green-400 overflow-hidden flex-1 flex flex-col">
                <div className="bg-gradient-to-r from-green-600 to-emerald-500 py-1.5 px-3 flex items-center justify-between gap-2">
                    <span className="text-white font-extrabold text-xs uppercase tracking-wider">
                        ✅ {noteData.product?.name}
                    </span>
                    <span className="text-white/80 text-[10px] font-bold">PASO FINAL</span>
                </div>

                <div className="flex-1 flex flex-col p-3 gap-2.5 overflow-auto">

                    {/* Metric chips */}
                    {isPesajeSimple ? (
                        /* ─── PESAJE SIMPLE: auto-value + confirmation ─── */
                        <div className="space-y-3">
                            <div className="bg-green-50 rounded-xl p-4 text-center border-2 border-green-300">
                                <div className="text-[10px] font-bold text-green-600 uppercase mb-1">Cantidad Producida (según fórmula)</div>
                                <div className="text-3xl font-black text-green-700">
                                    {Number(targetGrams).toLocaleString('es-CO')}
                                </div>
                                <div className="text-[10px] text-green-500">{baseUnit}</div>
                            </div>
                            <label
                                className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all active:scale-[0.98] ${
                                    pesajeConfirmed
                                        ? 'bg-green-50 border-green-400'
                                        : 'bg-amber-50 border-amber-300 hover:border-amber-400'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={pesajeConfirmed}
                                    onChange={(e) => { setPesajeConfirmed(e.target.checked); setTimeout(saveDraft, 300); }}
                                    className="w-7 h-7 rounded-lg border-2 border-slate-300 text-green-600 focus:ring-green-200 cursor-pointer flex-shrink-0"
                                />
                                <div className="flex-1">
                                    <div className="font-bold text-slate-800 text-sm">
                                        {pesajeConfirmed ? '✅ Verificado' : '⚠️ Confirmar'}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                        Todos los materiales están correctamente pesados y la mezcla está lista
                                    </div>
                                </div>
                            </label>
                            {!pesajeConfirmed && (
                                <div className="text-center text-xs text-amber-600 font-bold">
                                    ⚠️ Debe confirmar que todo está correcto para habilitar FINALIZAR
                                </div>
                            )}
                        </div>
                    ) : (
                        /* ─── NORMAL: manual input ─── */
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200">
                                <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Esperado</div>
                                <div className="text-xl font-black text-slate-700">
                                    {Number(targetGrams).toLocaleString('es-CO')}
                                </div>
                                <div className="text-[10px] text-slate-400">{baseUnit}</div>
                            </div>

                            <div className="bg-green-50 rounded-xl p-2.5 text-center border-2 border-green-300">
                                <div className="text-[10px] font-bold text-green-600 uppercase mb-0.5">Real Producido</div>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    value={outputQuantity}
                                    onChange={(e) => onOutputQtyChange(e.target.value)}
                                    className="w-full text-center text-xl font-black bg-transparent text-green-700 focus:outline-none"
                                    placeholder="—"
                                />
                                <div className="text-[10px] text-green-500">{baseUnit}</div>
                            </div>

                            <div className={`rounded-xl p-2.5 text-center border ${deviation === null ? 'bg-slate-50 border-slate-200' : parseFloat(deviation) < -5 || parseFloat(deviation) > 10 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-200'}`}>
                                <div className={`text-[10px] font-bold uppercase mb-0.5 ${deviation === null ? 'text-slate-400' : 'text-slate-600'}`}>Variación</div>
                                <div className={`text-xl font-black ${deviation === null ? 'text-slate-300' : parseFloat(deviation) < -5 || parseFloat(deviation) > 10 ? 'text-amber-600' : 'text-green-600'}`}>
                                    {deviation !== null ? (parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`) : '—'}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Temperature, QC params, and Sensory — ONLY for PESAJE (COMPUESTO) */}
                    {showPesajeQC && <>
                        {/* Temperature verification — not for PROTECCION */}
                        {!isProteccion && (
                            <div className={`rounded-2xl p-4 border-2 transition-all ${tempWarning ? 'bg-red-50 border-red-300' :
                                tempOk ? 'bg-emerald-50 border-emerald-300' :
                                    'bg-orange-50 border-orange-200'
                                }`}>
                                <div className="flex items-center gap-2 mb-3">
                                    <Thermometer size={20} className={tempWarning ? 'text-red-500' : tempOk ? 'text-emerald-600' : 'text-orange-500'} />
                                    <span className={`text-sm font-bold uppercase ${tempWarning ? 'text-red-600' : tempOk ? 'text-emerald-700' : 'text-orange-600'}`}>
                                        🌡️ Verificación de Temperatura
                                    </span>
                                    <span className="ml-auto text-xs font-bold bg-white/80 px-2 py-1 rounded-full text-slate-500">
                                        Meta: {TARGET_TEMP}°C
                                    </span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.1"
                                            value={temperature}
                                            onChange={(e) => setTemperature(e.target.value)}
                                            onBlur={saveDraft}
                                            placeholder={`${TARGET_TEMP}`}
                                            className={`w-full text-center text-3xl font-black py-3 px-4 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all ${tempWarning ? 'border-red-300 bg-white text-red-700 focus:ring-red-200' :
                                                tempOk ? 'border-emerald-300 bg-white text-emerald-700 focus:ring-emerald-200' :
                                                    'border-orange-200 bg-white text-orange-700 focus:ring-orange-200'
                                                }`}
                                        />
                                    </div>
                                    <div className="text-2xl font-black text-slate-400">°C</div>
                                </div>
                                {tempDeviation !== null && (
                                    <div className={`mt-2 text-sm font-bold text-center ${tempOk ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {tempOk
                                            ? `✅ Temperatura OK (${tempNum}°C)`
                                            : `⚠️ Fuera de rango: ${tempNum}°C (tolerancia: ${TARGET_TEMP - TEMP_TOLERANCE}°C – ${TARGET_TEMP + TEMP_TOLERANCE}°C)`
                                        }
                                    </div>
                                )}
                                {/* Temperature photo evidence */}
                                <div className="mt-3">
                                    {tempPhoto && (
                                        <img src={tempPhoto} alt="Temperatura"
                                            onClick={() => setModalPhoto(tempPhoto)}
                                            className="w-full max-h-32 object-cover rounded-xl border border-emerald-200 mb-2 shadow-sm cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all" />
                                    )}
                                    <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95 text-sm
                                ${tempPhoto
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                            : 'border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>
                                        {tempPhoto
                                            ? <><CheckCircle size={18} /> <span className="font-bold">Foto ✓ — Cambiar</span></>
                                            : <><Camera size={18} /> <span className="font-bold">📷 Foto de evidencia (Temperatura)</span></>
                                        }
                                        <input type="file" accept="image/*" capture="environment" className="sr-only"
                                            onChange={handleTempPhoto} />
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* ═══ QUALITY CONTROL PARAMETERS ═══ */}
                        <div className="rounded-xl border-2 border-indigo-300 overflow-hidden">
                            <div className="bg-gradient-to-r from-indigo-600 to-violet-500 py-1.5 px-3 text-center">
                                <span className="text-white font-extrabold text-xs uppercase tracking-wider">
                                    🔬 Control de Calidad
                                </span>
                            </div>
                            <div className={`p-2 grid gap-2 bg-indigo-50/50 ${qcParamResults.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
                                {qcParamResults.map((param) => (
                                    <div key={param.key} className={`rounded-lg p-2 border-2 transition-all ${param.filled
                                        ? param.inRange
                                            ? 'bg-green-50 border-green-300'
                                            : 'bg-red-50 border-red-300'
                                        : 'bg-white border-slate-200'
                                        }`}>
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-1">
                                                <span className="text-sm">{param.icon}</span>
                                                <span className="font-bold text-slate-700 text-xs">{param.label}</span>
                                            </div>
                                            <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded-full text-slate-500">
                                                {param.min}–{param.max}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                step={param.step}
                                                value={qcValues[param.key] || ''}
                                                onChange={(e) => setQcValues(prev => ({ ...prev, [param.key]: e.target.value }))}
                                                onBlur={saveDraft}
                                                placeholder={`${param.min}`}
                                                className={`flex-1 text-center text-xl font-black py-1.5 px-2 rounded-lg border-2 focus:outline-none focus:ring-2 transition-all ${param.filled
                                                    ? param.inRange
                                                        ? 'border-green-300 bg-white text-green-700 focus:ring-green-200'
                                                        : 'border-red-300 bg-white text-red-700 focus:ring-red-200'
                                                    : 'border-slate-200 bg-white text-slate-700 focus:ring-indigo-200'
                                                    }`}
                                            />
                                            {param.unit && <span className="text-[10px] font-bold text-slate-400 shrink-0">{param.unit}</span>}
                                        </div>
                                        {/* Photo evidence — compact */}
                                        <div className="mt-1.5">
                                            {qcPhotos[param.key] && (
                                                <img src={qcPhotos[param.key]} alt={`QC ${param.label}`}
                                                    onClick={() => setModalPhoto(qcPhotos[param.key])}
                                                    className="w-full max-h-20 object-cover rounded-md border border-emerald-200 mb-1 shadow-sm cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all" />
                                            )}
                                            <label className={`flex items-center justify-center gap-1 w-full py-1 rounded-md border border-dashed cursor-pointer transition-all active:scale-95 text-[10px]
                                            ${qcPhotos[param.key]
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                                    : 'border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                                                {qcPhotos[param.key]
                                                    ? <><CheckCircle size={12} /> <span className="font-bold">Foto ✓</span></>
                                                    : <><Camera size={12} /> <span className="font-bold">📷 Evidencia</span></>
                                                }
                                                <input type="file" accept="image/*" capture="environment" className="sr-only"
                                                    onChange={(e) => handleQcPhotoCapture(param.key, e)} />
                                            </label>
                                        </div>
                                        {param.filled && !param.inRange && (
                                            <div className="mt-1 text-[10px] font-bold text-red-600 text-center">
                                                ❌ Fuera de rango
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {allQcFilled && (
                                    <div className={`col-span-full text-center py-1.5 rounded-md font-bold text-[11px] ${allQcInRange && allQcPhotos
                                        ? 'bg-green-100 text-green-700 border border-green-300'
                                        : 'bg-red-100 text-red-700 border border-red-300'
                                        }`}>
                                        {allQcInRange && allQcPhotos
                                            ? '✅ Parámetros OK con evidencia'
                                            : !allQcInRange
                                                ? '❌ Hay parámetros fuera de rango'
                                                : '📷 Falta evidencia fotográfica'
                                        }
                                    </div>
                                )}
                                {/* Foto general del producto — dentro del bloque de QC */}
                                <div className="col-span-full mt-1">
                                    <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">
                                        📷 Foto general del producto
                                    </div>
                                    {verificationPhoto && (
                                        <img src={verificationPhoto} alt="Verificación"
                                            onClick={() => setModalPhoto(verificationPhoto)}
                                            className="w-full max-h-24 object-cover rounded-md border border-emerald-200 mb-1 shadow-sm cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all" />
                                    )}
                                    <label className={`flex items-center justify-center gap-1 w-full py-1.5 rounded-md border border-dashed cursor-pointer transition-all active:scale-95 text-xs ${verificationPhoto
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                        : 'border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                                        {verificationPhoto
                                            ? <><CheckCircle size={14} /> <span className="font-bold">Foto ✓ — Cambiar</span></>
                                            : <><Camera size={14} /> <span className="font-bold">Tomar foto del producto</span></>
                                        }
                                        <input type="file" accept="image/*" capture="environment" className="sr-only"
                                            onChange={handleVerificationPhoto} />
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* ═══ SENSORY EVALUATION CHECKLIST ═══ */}
                        {isCompuesto && (
                            <div className="rounded-2xl border-2 border-amber-300 overflow-hidden">
                                <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-3 text-center">
                                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                                        👁️ EVALUACIÓN SENSORIAL — Checklist
                                    </span>
                                </div>
                                <div className="p-4 space-y-3 bg-amber-50/50">
                                    {SENSORY_CHECKS.map((check) => (
                                        <label key={check.key}
                                            className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all active:scale-[0.98] ${sensoryChecks[check.key]
                                                ? 'bg-green-50 border-green-300'
                                                : 'bg-white border-slate-200 hover:border-amber-300'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!!sensoryChecks[check.key]}
                                                onChange={(e) => { setSensoryChecks(prev => ({ ...prev, [check.key]: e.target.checked })); setTimeout(saveDraft, 300); }}
                                                className="w-7 h-7 rounded-lg border-2 border-slate-300 text-green-600 focus:ring-green-200 cursor-pointer flex-shrink-0"
                                            />
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">{check.icon}</span>
                                                    <span className="font-bold text-slate-800">{check.label}</span>
                                                    {sensoryChecks[check.key] && (
                                                        <span className="text-green-600 text-sm font-bold">✅ Verificado</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-0.5">{check.description}</div>
                                            </div>
                                        </label>
                                    ))}

                                    {/* Sensory summary */}
                                    <div className={`text-center py-3 rounded-xl font-bold text-sm ${allSensoryChecked
                                        ? 'bg-green-100 text-green-700 border border-green-300'
                                        : 'bg-amber-100 text-amber-700 border border-amber-300'
                                        }`}>
                                        {allSensoryChecked
                                            ? '✅ Evaluación sensorial completa'
                                            : `⚠️ Faltan ${SENSORY_CHECKS.filter(s => !sensoryChecks[s.key]).length} verificaciones sensoriales`
                                        }
                                    </div>
                                </div>
                            </div>
                        )}
                    </>/* End showPesajeQC */}

                    {/* Photo evidence (solo si NO hay QC; con QC ya está adentro) */}
                    {!showPesajeQC && (
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
                                📷 Verificación Fotográfica del Producto
                            </label>
                            {verificationPhoto && (
                                <img src={verificationPhoto} alt="Verificación"
                                    onClick={() => setModalPhoto(verificationPhoto)}
                                    className="w-full max-h-32 object-cover rounded-xl border-2 border-emerald-200 mb-2 shadow-sm cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all" />
                            )}
                            <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95
                                ${verificationPhoto
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                    : 'border-green-300 bg-green-50 text-green-600 hover:bg-green-100'}`}>
                                {verificationPhoto
                                    ? <><CheckCircle size={18} /> <span className="font-bold text-xs">Foto tomada — Cambiar</span></>
                                    : <><Camera size={18} /> <span className="font-bold text-xs">Tomar foto de verificación</span></>
                                }
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="sr-only"
                                    onChange={handleVerificationPhoto}
                                />
                            </label>
                        </div>
                    )}

                    {/* Observations */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
                            Observaciones (opcional)
                        </label>
                        <textarea
                            value={outputObservations}
                            onChange={(e) => onObservationsChange(e.target.value)}
                            placeholder="Notas sobre el proceso, merma, incidencias..."
                            rows={2}
                            className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-green-400 focus:ring-2 focus:ring-green-200 focus:outline-none text-slate-700 text-sm resize-none"
                        />
                    </div>

                </div>
            </div>

            {/* ═══ PHOTO MODAL ═══ */}
            {modalPhoto && (
                <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setModalPhoto(null)}>
                    <button onClick={() => setModalPhoto(null)}
                        className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 rounded-full p-2 transition-all">
                        <X size={28} className="text-white" />
                    </button>
                    <img src={modalPhoto} alt="Foto ampliada"
                        onClick={(e) => e.stopPropagation()}
                        className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default OutputStep;
