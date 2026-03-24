import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, CheckCircle, Thermometer } from 'lucide-react';
import api from '../../../services/api';

/**
 * FormacionQCStep — Quality control checks for spherification (Esferas) process.
 *
 * 11 sections covering equipment verification, ingredient additions,
 * temperature controls, Brix measurements, pearl weight, and machine parameters.
 *
 * All fields persist to processParameters.formacion_qc_draft so the operator
 * can leave and return without losing data.
 */

const SECTIONS = {
    alginato: { title: '🧊 Recirculación de Alginato', subtitle: 'Verificar temperatura del alginato en máquina', tempMin: 12, tempMax: 20, unit: '°C' },
    marmita: { title: '🔥 Marmita de Calentamiento', subtitle: 'Temperatura post-lavado antes de esferificar', tempMin: 90, tempMax: 94, unit: '°C' },
};

const EQUIPMENT_CHECKS = [
    { key: 'inyectores_ok', label: 'Inyectores del cabezote', desc: 'Funcionamiento correcto, perla redonda' },
    { key: 'bomba_ok', label: 'Bomba de llenado', desc: 'Funcionamiento correcto del sistema' },
    { key: 'sensor_ok', label: 'Sensor de llenado de jarabe', desc: 'Sensor calibrado y operativo' },
    { key: 'perlas_redondas', label: 'Forma de perlas', desc: 'Perlas salen con forma redonda uniforme' },
];

const FormacionQCStep = ({ stepData, onFormacionQcChange }) => {
    const noteData = stepData;
    const noteId = noteData?.id;
    const draft = noteData?.processParameters?.formacion_qc_draft;

    // ── Section 1: Alginato Temperature ──
    const [alginatoTemp, setAlginatoTemp] = useState(draft?.alginatoTemp ?? '');
    const [alginatoPhoto, setAlginatoPhoto] = useState(draft?.alginatoPhoto ?? '');

    // ── Section 2: Equipment Checklist ──
    const [equipChecks, setEquipChecks] = useState(draft?.equipChecks ?? {});

    // ── Section 2b: Flavor Change (Cambio de Sabor) ──
    const [flavorChange, setFlavorChange] = useState(draft?.flavorChange ?? null);
    const [cabezoteWashed, setCabezoteWashed] = useState(draft?.cabezoteWashed ?? false);
    const [disinfectant, setDisinfectant] = useState(draft?.disinfectant ?? '');
    const [flavorChangePhoto, setFlavorChangePhoto] = useState(draft?.flavorChangePhoto ?? '');

    // ── Section 3: Tween 20 ──
    const [tweenUsed, setTweenUsed] = useState(draft?.tweenUsed ?? null);
    const [tweenQty, setTweenQty] = useState(draft?.tweenQty ?? '');

    // ── Section 4: Pearl Wash + Citrosan ──
    const [washChanged, setWashChanged] = useState(draft?.washChanged ?? false);
    const [citrosanQty, setCitrosanQty] = useState(draft?.citrosanQty ?? '');
    const [citrosanPhoto, setCitrosanPhoto] = useState(draft?.citrosanPhoto ?? '');

    // ── Section 5: Marmita Temperature ──
    const [marmitaTemp, setMarmitaTemp] = useState(draft?.marmitaTemp ?? '');
    const [marmitaPhoto, setMarmitaPhoto] = useState(draft?.marmitaPhoto ?? '');

    // ── Section 6: Brix Post-Lavado ──
    const [brixPostWash, setBrixPostWash] = useState(draft?.brixPostWash ?? '');
    const [brixPostWashPhoto, setBrixPostWashPhoto] = useState(draft?.brixPostWashPhoto ?? '');

    // ── Section 7: Brix Post-Cocción ──
    const [brixPostCook, setBrixPostCook] = useState(draft?.brixPostCook ?? '');
    const [brixPostCookPhoto, setBrixPostCookPhoto] = useState(draft?.brixPostCookPhoto ?? '');

    // ── Section 8: Weight of 10 pearls ──
    const [pearlWeight, setPearlWeight] = useState(draft?.pearlWeight ?? '');
    const [pearlWeightPhoto, setPearlWeightPhoto] = useState(draft?.pearlWeightPhoto ?? '');

    // ── Section 9: Machine Parameters Photo ──
    const [machinePhoto, setMachinePhoto] = useState(draft?.machinePhoto ?? '');

    // ── Validation ──
    const alginatoVal = parseFloat(alginatoTemp);
    const alginatoOk = !isNaN(alginatoVal) && alginatoVal >= 12 && alginatoVal <= 20;
    const marmitaVal = parseFloat(marmitaTemp);
    const marmitaOk = !isNaN(marmitaVal) && marmitaVal >= 90 && marmitaVal <= 94;
    const citrosanVal = parseFloat(citrosanQty);
    const citrosanOk = !isNaN(citrosanVal) && citrosanVal > 0;
    const allEquipChecked = EQUIPMENT_CHECKS.every(c => equipChecks[c.key]);
    const tweenDecided = tweenUsed !== null;
    const tweenValid = tweenUsed === false || (tweenUsed === true && parseFloat(tweenQty) > 0);
    const flavorChangeDecided = flavorChange !== null;
    const flavorChangeValid = flavorChange === false || (flavorChange === true && cabezoteWashed && disinfectant !== '' && !!flavorChangePhoto);

    const isComplete =
        alginatoOk && !!alginatoPhoto &&
        allEquipChecked &&
        flavorChangeDecided && flavorChangeValid &&
        tweenDecided && tweenValid &&
        washChanged && citrosanOk && !!citrosanPhoto &&
        marmitaOk && !!marmitaPhoto &&
        brixPostWash !== '' && !!brixPostWashPhoto &&
        brixPostCook !== '' && !!brixPostCookPhoto &&
        pearlWeight !== '' && !!pearlWeightPhoto &&
        !!machinePhoto;

    // ── Auto-save draft to processParameters (debounced 2s) ───────────────
    const saveTimerRef = useRef(null);
    const saveDraft = useCallback(() => {
        if (!noteId) return;
        const draftData = {
            alginatoTemp, alginatoPhoto, equipChecks,
            flavorChange, cabezoteWashed, disinfectant, flavorChangePhoto,
            tweenUsed, tweenQty, washChanged, citrosanQty, citrosanPhoto,
            marmitaTemp, marmitaPhoto, brixPostWash, brixPostWashPhoto,
            brixPostCook, brixPostCookPhoto, pearlWeight, pearlWeightPhoto,
            machinePhoto,
        };
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            try {
                const res = await api.get(`/assembly-notes/${noteId}`);
                const currentParams = res.data?.processParameters || {};
                await api.patch(`/assembly-notes/${noteId}`, {
                    processParameters: { ...currentParams, formacion_qc_draft: draftData }
                });
            } catch (e) { console.warn('QC draft save failed:', e.message); }
        }, 2000);
    }, [noteId, alginatoTemp, alginatoPhoto, equipChecks,
        flavorChange, cabezoteWashed, disinfectant, flavorChangePhoto,
        tweenUsed, tweenQty, washChanged, citrosanQty, citrosanPhoto,
        marmitaTemp, marmitaPhoto, brixPostWash, brixPostWashPhoto,
        brixPostCook, brixPostCookPhoto, pearlWeight, pearlWeightPhoto, machinePhoto]);

    // Skip saving on initial mount (draft restore)
    const mountedRef = useRef(false);
    useEffect(() => {
        if (!mountedRef.current) { mountedRef.current = true; return; }
        saveDraft();
    }, [saveDraft]);

    // Notify parent
    useEffect(() => {
        onFormacionQcChange?.({
            isComplete,
            alginatoTemp, alginatoPhoto,
            equipChecks,
            flavorChange, cabezoteWashed, disinfectant, flavorChangePhoto,
            tweenUsed, tweenQty,
            washChanged, citrosanQty, citrosanPhoto,
            marmitaTemp, marmitaPhoto,
            brixPostWash, brixPostWashPhoto,
            brixPostCook, brixPostCookPhoto,
            pearlWeight, pearlWeightPhoto,
            machinePhoto,
        });
    }, [isComplete, alginatoTemp, alginatoPhoto, equipChecks,
        flavorChange, cabezoteWashed, disinfectant, flavorChangePhoto,
        tweenUsed, tweenQty,
        washChanged, citrosanQty, citrosanPhoto, marmitaTemp, marmitaPhoto,
        brixPostWash, brixPostWashPhoto, brixPostCook, brixPostCookPhoto,
        pearlWeight, pearlWeightPhoto, machinePhoto]);

    // Photo upload helper
    const uploadPhoto = async (file, context, setFn) => {
        const localUrl = URL.createObjectURL(file);
        setFn(localUrl);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', noteData.id || '');
            fd.append('context', context);
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) setFn(data.url);
        } catch (err) { console.warn('Upload failed:', err); }
    };

    const PhotoButton = ({ photo, setPhoto, context, label }) => (
        <div className="mt-3">
            {photo && (
                <img src={photo} alt={label}
                    className="w-full max-h-32 object-cover rounded-xl border border-emerald-200 mb-2 shadow-sm" />
            )}
            <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95 text-sm
                ${photo
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                    : 'border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>
                {photo
                    ? <><CheckCircle size={18} /> <span className="font-bold">Foto ✓ — Cambiar</span></>
                    : <><Camera size={18} /> <span className="font-bold">📷 {label}</span></>
                }
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                    onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0], context, setPhoto)} />
            </label>
        </div>
    );

    const TempSection = ({ title, subtitle, min, max, value, setValue, ok, photo, setPhoto, context }) => {
        const [tempInput, setTempInput] = React.useState(value || '');
        const [outOfRangeMsg, setOutOfRangeMsg] = React.useState('');

        // Sync external value changes
        React.useEffect(() => { setTempInput(value || ''); }, [value]);

        const handleBlur = () => {
            const num = parseFloat(tempInput);
            if (tempInput === '' || isNaN(num)) {
                setValue('');
                setOutOfRangeMsg('');
                return;
            }
            if (num < min || num > max) {
                setOutOfRangeMsg(`❌ ${num}°C está fuera del rango permitido (${min}°C – ${max}°C). Ingrese un valor válido.`);
                setTempInput('');
                setValue('');
                setTimeout(() => setOutOfRangeMsg(''), 4000);
            } else {
                setValue(tempInput);
                setOutOfRangeMsg('');
            }
        };

        return (
            <div className={`rounded-2xl p-4 border-2 transition-all ${ok ? 'bg-emerald-50 border-emerald-300' :
                outOfRangeMsg ? 'bg-red-50 border-red-300' : 'bg-orange-50 border-orange-200'
                }`}>
                <div className="flex items-center gap-2 mb-3">
                    <Thermometer size={20} className={ok ? 'text-emerald-600' : outOfRangeMsg ? 'text-red-500' : 'text-orange-500'} />
                    <span className={`text-sm font-bold uppercase ${ok ? 'text-emerald-700' : outOfRangeMsg ? 'text-red-600' : 'text-orange-600'}`}>
                        {title}
                    </span>
                    <span className="ml-auto text-xs font-bold bg-white/80 px-2 py-1 rounded-full text-slate-500">
                        Rango: {min}–{max}°C
                    </span>
                </div>
                <div className="text-xs text-slate-500 mb-3">{subtitle}</div>
                <div className="flex items-center gap-4">
                    <input
                        type="text" inputMode="decimal"
                        value={tempInput}
                        onChange={(e) => setTempInput(e.target.value.replace(/[^0-9.]/g, ''))}
                        onBlur={handleBlur}
                        placeholder={`${min}`}
                        className={`flex-1 text-center text-3xl font-black py-3 px-4 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all ${ok ? 'border-emerald-300 bg-white text-emerald-700 focus:ring-emerald-200' :
                            'border-orange-200 bg-white text-orange-700 focus:ring-orange-200'
                            }`}
                    />
                    <div className="text-2xl font-black text-slate-400">°C</div>
                </div>
                {ok && (
                    <div className="mt-2 text-sm font-bold text-center text-emerald-600">
                        ✅ Temperatura OK ({value}°C)
                    </div>
                )}
                {outOfRangeMsg && (
                    <div className="mt-2 text-sm font-bold text-center text-red-600 animate-pulse">
                        {outOfRangeMsg}
                    </div>
                )}
                <PhotoButton photo={photo} setPhoto={setPhoto} context={context} label={`Foto ${title}`} />
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Badge */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-teal-600 to-cyan-500 text-white flex items-center justify-center text-2xl shadow-md">
                    🔬
                </div>
                <div>
                    <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">CONTROL DE CALIDAD — ESFERAS</div>
                    <div className="text-xs text-slate-400">Complete todos los parámetros para continuar</div>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-2xl border-4 border-teal-400 overflow-hidden flex-1 flex flex-col">
                <div className="bg-gradient-to-r from-teal-600 to-cyan-500 p-4 text-center">
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        🔬 VERIFICACIÓN DE PROCESO — ESFERIFICACIÓN
                    </span>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">

                    {/* ═══ 1. ALGINATO TEMPERATURE ═══ */}
                    <TempSection
                        title="🧊 Recirculación de Alginato"
                        subtitle="Verificar que el alginato esté recirculando a la temperatura adecuada"
                        min={12} max={20}
                        value={alginatoTemp} setValue={setAlginatoTemp}
                        ok={alginatoOk}
                        photo={alginatoPhoto} setPhoto={setAlginatoPhoto}
                        context="alginato_temp"
                    />

                    {/* ═══ 2–4. EQUIPMENT CHECKLIST ═══ */}
                    <div className="rounded-2xl border-2 border-indigo-300 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-violet-500 p-3 text-center">
                            <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                                ⚙️ VERIFICACIÓN DE EQUIPOS
                            </span>
                        </div>
                        <div className="p-4 space-y-3 bg-indigo-50/50">
                            {EQUIPMENT_CHECKS.map(check => (
                                <label key={check.key}
                                    className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all active:scale-[0.98] ${equipChecks[check.key]
                                        ? 'bg-green-50 border-green-300'
                                        : 'bg-white border-slate-200 hover:border-indigo-300'
                                        }`}>
                                    <input
                                        type="checkbox"
                                        checked={!!equipChecks[check.key]}
                                        onChange={(e) => setEquipChecks(prev => ({ ...prev, [check.key]: e.target.checked }))}
                                        className="w-7 h-7 rounded-lg border-2 border-slate-300 text-green-600 focus:ring-green-200 cursor-pointer flex-shrink-0"
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800">{check.label}</span>
                                            {equipChecks[check.key] && <span className="text-green-600 text-sm font-bold">✅</span>}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5">{check.desc}</div>
                                    </div>
                                </label>
                            ))}
                            <div className={`text-center py-2 rounded-xl font-bold text-sm ${allEquipChecked ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-amber-100 text-amber-700 border border-amber-300'
                                }`}>
                                {allEquipChecked ? '✅ Todos los equipos verificados' : `⚠️ Faltan ${EQUIPMENT_CHECKS.filter(c => !equipChecks[c.key]).length} verificaciones`}
                            </div>
                        </div>
                    </div>

                    {/* ═══ 2b. CAMBIO DE SABOR ═══ */}
                    <div className="rounded-2xl border-2 border-rose-300 overflow-hidden">
                        <div className="bg-gradient-to-r from-rose-500 to-pink-500 p-3 text-center">
                            <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                                🔄 CAMBIO DE SABOR
                            </span>
                        </div>
                        <div className="p-4 bg-rose-50/50 space-y-3">
                            <div className="text-sm text-slate-600 mb-2">¿Hubo cambio de sabor en este bache?</div>
                            <div className="flex gap-3 mb-3">
                                <button
                                    onClick={() => setFlavorChange(true)}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${flavorChange === true
                                        ? 'bg-rose-600 text-white shadow-md'
                                        : 'bg-white border-2 border-rose-200 text-rose-600 hover:bg-rose-50'
                                        }`}>
                                    ✅ SÍ hubo cambio
                                </button>
                                <button
                                    onClick={() => { setFlavorChange(false); setCabezoteWashed(false); setDisinfectant(''); setFlavorChangePhoto(''); }}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${flavorChange === false
                                        ? 'bg-slate-600 text-white shadow-md'
                                        : 'bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}>
                                    ❌ NO hubo cambio
                                </button>
                            </div>
                            {flavorChange === true && (
                                <div className="space-y-3 mt-3 border-t border-rose-200 pt-3">
                                    {/* Cabezote wash confirmation */}
                                    <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${cabezoteWashed ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
                                        }`}>
                                        <input
                                            type="checkbox" checked={cabezoteWashed}
                                            onChange={(e) => setCabezoteWashed(e.target.checked)}
                                            className="w-7 h-7 rounded-lg border-2 border-slate-300 text-green-600 focus:ring-green-200 cursor-pointer flex-shrink-0"
                                        />
                                        <div>
                                            <span className="font-bold text-slate-800">Lavado del cabezote realizado</span>
                                            <div className="text-xs text-slate-500">Confirmar que se lavó el cabezote por cambio de sabor</div>
                                        </div>
                                    </label>

                                    {/* Disinfectant selection */}
                                    <div>
                                        <div className="text-xs font-bold text-rose-600 uppercase mb-2">Desinfectante utilizado</div>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setDisinfectant('citrosan')}
                                                className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${disinfectant === 'citrosan'
                                                    ? 'bg-cyan-600 text-white shadow-md'
                                                    : 'bg-white border-2 border-cyan-200 text-cyan-600 hover:bg-cyan-50'
                                                    }`}>
                                                🧴 Citrosán
                                            </button>
                                            <button
                                                onClick={() => setDisinfectant('acido_peracetico')}
                                                className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${disinfectant === 'acido_peracetico'
                                                    ? 'bg-amber-600 text-white shadow-md'
                                                    : 'bg-white border-2 border-amber-200 text-amber-600 hover:bg-amber-50'
                                                    }`}>
                                                ⚗️ Ácido Peracético
                                            </button>
                                        </div>
                                    </div>

                                    <PhotoButton photo={flavorChangePhoto} setPhoto={setFlavorChangePhoto} context="cambio_sabor_desinf" label="Foto evidencia desinfección" />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ═══ 5. TWEEN 20 ═══ */}
                    <div className="rounded-2xl border-2 border-purple-300 overflow-hidden">
                        <div className="bg-gradient-to-r from-purple-500 to-fuchsia-500 p-3 text-center">
                            <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                                🧴 TWEEN 20
                            </span>
                        </div>
                        <div className="p-4 bg-purple-50/50">
                            <div className="text-sm text-slate-600 mb-3">¿Se agregó Tween 20 en este bache?</div>
                            <div className="flex gap-3 mb-3">
                                <button
                                    onClick={() => setTweenUsed(true)}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${tweenUsed === true
                                        ? 'bg-purple-600 text-white shadow-md'
                                        : 'bg-white border-2 border-purple-200 text-purple-600 hover:bg-purple-50'
                                        }`}>
                                    ✅ SÍ se agregó
                                </button>
                                <button
                                    onClick={() => { setTweenUsed(false); setTweenQty(''); }}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${tweenUsed === false
                                        ? 'bg-slate-600 text-white shadow-md'
                                        : 'bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}>
                                    ❌ NO se agregó
                                </button>
                            </div>
                            {tweenUsed === true && (
                                <div className="mt-3">
                                    <label className="text-xs font-bold text-purple-600 uppercase mb-2 block">Cantidad (gramos)</label>
                                    <input
                                        type="number" inputMode="decimal" step="0.1"
                                        value={tweenQty}
                                        onChange={(e) => setTweenQty(e.target.value)}
                                        placeholder="Ej: 5"
                                        className="w-full text-center text-2xl font-black py-3 px-4 rounded-xl border-2 border-purple-300 bg-white text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-200"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ═══ 6. LAVADO DE PERLAS + CITROSÁN ═══ */}
                    <div className="rounded-2xl border-2 border-cyan-300 overflow-hidden">
                        <div className="bg-gradient-to-r from-cyan-600 to-sky-500 p-3 text-center">
                            <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                                🫧 LAVADO DE PERLAS + CITROSÁN
                            </span>
                        </div>
                        <div className="p-4 space-y-4 bg-cyan-50/50">
                            <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${washChanged ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
                                }`}>
                                <input
                                    type="checkbox" checked={washChanged}
                                    onChange={(e) => setWashChanged(e.target.checked)}
                                    className="w-7 h-7 rounded-lg border-2 border-slate-300 text-green-600 focus:ring-green-200 cursor-pointer flex-shrink-0"
                                />
                                <div>
                                    <span className="font-bold text-slate-800">Lavado cambiado este bache</span>
                                    <div className="text-xs text-slate-500">Confirmar que el agua de lavado fue renovada</div>
                                </div>
                            </label>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-bold text-cyan-600 uppercase">Cantidad de Citrosán (ml)</label>
                                    <span className="text-xs font-bold bg-white/80 px-2 py-1 rounded-full text-slate-500">
                                        Rango: 30–40 ml / 80 kg agua
                                    </span>
                                </div>
                                <input
                                    type="number" inputMode="decimal" step="1"
                                    value={citrosanQty}
                                    onChange={(e) => setCitrosanQty(e.target.value)}
                                    placeholder="Ej: 40"
                                    className={`w-full text-center text-2xl font-black py-3 px-4 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all ${citrosanOk ? 'border-green-300 bg-white text-green-700 focus:ring-green-200' : 'border-cyan-200 bg-white text-cyan-700 focus:ring-cyan-200'
                                        }`}
                                />
                            </div>

                            <PhotoButton photo={citrosanPhoto} setPhoto={setCitrosanPhoto} context="citrosan_lavado" label="Foto del lavado + Citrosán" />
                        </div>
                    </div>

                    {/* ═══ 7. MARMITA DE CALENTAMIENTO ═══ */}
                    <TempSection
                        title="🔥 Marmita de Calentamiento"
                        subtitle="Temperatura de la marmita después del lavado, antes de esferificar"
                        min={90} max={94}
                        value={marmitaTemp} setValue={setMarmitaTemp}
                        ok={marmitaOk}
                        photo={marmitaPhoto} setPhoto={setMarmitaPhoto}
                        context="marmita_temp"
                    />

                    {/* ═══ 8. BRIX POST-LAVADO ═══ */}
                    <div className={`rounded-2xl p-4 border-2 ${brixPostWash ? 'bg-blue-50 border-blue-300' : 'bg-blue-50/50 border-blue-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">🔬</span>
                            <span className="text-sm font-bold text-blue-700 uppercase">°Brix — Post-Lavado (agua + Citrosán)</span>
                        </div>
                        <div className="text-xs text-slate-500 mb-3">Medición de grados Brix después del lavado con agua y citrosán</div>
                        <input
                            type="number" inputMode="decimal" step="0.1"
                            value={brixPostWash}
                            onChange={(e) => setBrixPostWash(e.target.value)}
                            placeholder="°Bx"
                            className="w-full text-center text-3xl font-black py-3 px-4 rounded-xl border-2 border-blue-300 bg-white text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <PhotoButton photo={brixPostWashPhoto} setPhoto={setBrixPostWashPhoto} context="brix_post_lavado" label="Foto °Brix post-lavado" />
                    </div>

                    {/* ═══ 9. BRIX POST-COCCIÓN ═══ */}
                    <div className={`rounded-2xl p-4 border-2 ${brixPostCook ? 'bg-amber-50 border-amber-300' : 'bg-amber-50/50 border-amber-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">🔬</span>
                            <span className="text-sm font-bold text-amber-700 uppercase">°Brix — Post-Cocción</span>
                        </div>
                        <div className="text-xs text-slate-500 mb-3">Medición de grados Brix después de la cocción de las perlas</div>
                        <input
                            type="number" inputMode="decimal" step="0.1"
                            value={brixPostCook}
                            onChange={(e) => setBrixPostCook(e.target.value)}
                            placeholder="°Bx"
                            className="w-full text-center text-3xl font-black py-3 px-4 rounded-xl border-2 border-amber-300 bg-white text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
                        />
                        <PhotoButton photo={brixPostCookPhoto} setPhoto={setBrixPostCookPhoto} context="brix_post_coccion" label="Foto °Brix post-cocción" />
                    </div>

                    {/* ═══ 10. PESO DE 10 PERLAS ═══ */}
                    <div className={`rounded-2xl p-4 border-2 ${pearlWeight ? 'bg-green-50 border-green-300' : 'bg-green-50/50 border-green-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">⚖️</span>
                            <span className="text-sm font-bold text-green-700 uppercase">Peso de 10 Perlas (post-cocción)</span>
                        </div>
                        <div className="text-xs text-slate-500 mb-3">Pesar 10 perlas después de cocción y registrar el peso total</div>
                        <div className="flex items-center gap-4">
                            <input
                                type="number" inputMode="decimal" step="0.01"
                                value={pearlWeight}
                                onChange={(e) => setPearlWeight(e.target.value)}
                                placeholder="Ej: 12.5"
                                className="flex-1 text-center text-3xl font-black py-3 px-4 rounded-xl border-2 border-green-300 bg-white text-green-700 focus:outline-none focus:ring-2 focus:ring-green-200"
                            />
                            <div className="text-2xl font-black text-slate-400">g</div>
                        </div>
                        <PhotoButton photo={pearlWeightPhoto} setPhoto={setPearlWeightPhoto} context="peso_10_perlas" label="Foto peso de 10 perlas" />
                    </div>

                    {/* ═══ 11. MACHINE PARAMETERS PHOTO ═══ */}
                    <div className={`rounded-2xl p-4 border-2 ${machinePhoto ? 'bg-slate-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">🖥️</span>
                            <span className="text-sm font-bold text-slate-700 uppercase">Foto del Tablero de Parámetros</span>
                        </div>
                        <div className="text-xs text-slate-500 mb-3">Tomar foto del tablero de la máquina con los parámetros configurados para validar</div>
                        <PhotoButton photo={machinePhoto} setPhoto={setMachinePhoto} context="tablero_maquina" label="Foto del tablero de la máquina" />
                    </div>

                    {/* ═══ OVERALL SUMMARY ═══ */}
                    {isComplete ? (
                        <div className="text-center py-4 rounded-2xl font-bold bg-green-100 text-green-700 border-2 border-green-300">
                            ✅ TODOS LOS CONTROLES COMPLETADOS — Puede continuar
                        </div>
                    ) : (
                        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                            <div className="text-center font-bold text-amber-700 mb-3">⚠️ Faltan controles por completar:</div>
                            <ul className="space-y-1 text-sm text-amber-800">
                                {(!alginatoOk || !alginatoPhoto) && <li>❌ Temperatura de Alginato {!alginatoOk ? '(valor fuera de rango o vacío)' : '(falta foto)'}</li>}
                                {!allEquipChecked && <li>❌ Verificación de Equipos ({EQUIPMENT_CHECKS.filter(c => !equipChecks[c.key]).length} pendientes)</li>}
                                {!flavorChangeDecided && <li>❌ Cambio de sabor (seleccione SÍ o NO)</li>}
                                {flavorChangeDecided && !flavorChangeValid && <li>❌ Cambio de sabor (falta lavado, desinfectante o foto)</li>}
                                {!tweenDecided && <li>❌ Tween 20 (seleccione SÍ o NO)</li>}
                                {tweenDecided && !tweenValid && <li>❌ Tween 20 (ingrese cantidad en gramos)</li>}
                                {!washChanged && <li>❌ Lavado de perlas (confirmar cambio de bache)</li>}
                                {!citrosanOk && <li>❌ Citrosán (ingrese cantidad en ml)</li>}
                                {washChanged && citrosanOk && !citrosanPhoto && <li>❌ Citrosán (falta foto)</li>}
                                {(!marmitaOk || !marmitaPhoto) && <li>❌ Marmita {!marmitaOk ? '(valor fuera de rango o vacío)' : '(falta foto)'}</li>}
                                {(brixPostWash === '' || !brixPostWashPhoto) && <li>❌ °Brix Post-Lavado {brixPostWash === '' ? '(ingrese valor)' : '(falta foto)'}</li>}
                                {(brixPostCook === '' || !brixPostCookPhoto) && <li>❌ °Brix Post-Cocción {brixPostCook === '' ? '(ingrese valor)' : '(falta foto)'}</li>}
                                {(pearlWeight === '' || !pearlWeightPhoto) && <li>❌ Peso de 10 Perlas {pearlWeight === '' ? '(ingrese valor)' : '(falta foto)'}</li>}
                                {!machinePhoto && <li>❌ Foto del Tablero de la Máquina</li>}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormacionQCStep;
