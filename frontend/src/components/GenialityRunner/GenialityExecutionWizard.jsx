import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Loader, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import GInputStep from './steps/GInputStep';
import GMezclado from './steps/GMezclado';
import GEmpaqueStep from './steps/GEmpaqueStep';
import GEnsambleStep from './steps/GEnsambleStep';
// ── Escarchado steps (GE_*) ─────────────────────────────────────────────────
import GEPremixStep from './steps/GEPremixStep';
import GEBaseLiquidaStep from './steps/GEBaseLiquidaStep';
import GECoccionStep from './steps/GECoccionStep';

/**
 * GenialityExecutionWizard
 * Motor de ejecución exclusivo para Geniality (Siropes).
 * Solo procesa pasos G_* (G_PESAJE, G_MEZCLADO, G_EMPAQUE, G_ENSAMBLE).
 * NO contiene lógica de Liquipops: sin ESFERIFICACION, COCCION, CONTEO, MARCADO_CAJAS, FORMACION_QC.
 */
const GenialityExecutionWizard = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    const [note, setNote] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [completing, setCompleting] = useState(false);

    // State for INPUT (G_PESAJE) steps
    const [actualQuantities, setActualQuantities] = useState({});
    const [lotNumbers, setLotNumbers] = useState({});
    const [weighingPhotos, setWeighingPhotos] = useState({});
    const [lotSelections, setLotSelections] = useState({});

    // State for G_EMPAQUE step
    const [empaqueData, setEmpaqueData] = useState({});

    // ── Load note from Geniality API ─────────────────────────────────────────
    const loadNote = useCallback(async () => {
        if (!id) return;
        try {
            setLoading(true);
            setError(null);
            const res = await api.get(`/geniality/assembly-notes/${id}`);
            setNote(res.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Error cargando nota de ensamble');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { loadNote(); }, [loadNote]);

    // ── Build wizard steps from note ─────────────────────────────────────────
    const buildWizardSteps = (noteData) => {
        if (!noteData) return [];
        const steps = [];

        const processCode = noteData.processType?.code || '';

        if (processCode === 'G_PESAJE') {
            // Each ingredient from the formula becomes an INPUT step
            const inputs = noteData.formulaItems || noteData.processParameters?.formulaItems || [];
            inputs.forEach((item, idx) => {
                steps.push({ type: 'INPUT', id: item.id || `input_${idx}`, data: { ...item, assemblyNoteId: noteData.id } });
            });
            // If no formula items defined, show a generic weighing step
            if (inputs.length === 0) {
                steps.push({ type: 'INPUT', id: 'generic_weighing', data: { id: 'generic', component: { name: 'Ingredientes' }, plannedQuantity: 0, unit: 'g', assemblyNoteId: noteData.id } });
            }
        } else if (processCode === 'G_MEZCLADO') {
            steps.push({ type: 'MEZCLADO', id: 'mezclado' });
        } else if (processCode === 'G_EMPAQUE') {
            steps.push({ type: 'EMPAQUE', id: 'empaque' });
        } else if (processCode === 'G_ENSAMBLE') {
            steps.push({ type: 'ENSAMBLE', id: 'ensamble' });
        }
        // ── Escarchado (GE_*) — proceso diferente, mismo empaque/ensamble ──
        else if (processCode === 'GE_PREMIX') {
            steps.push({ type: 'GE_PREMIX', id: 'ge_premix' });
        } else if (processCode === 'GE_BASE_LIQUIDA') {
            steps.push({ type: 'GE_BASE_LIQUIDA', id: 'ge_base_liquida' });
        } else if (processCode === 'GE_COCCION') {
            steps.push({ type: 'GE_COCCION', id: 'ge_coccion' });
        } else {
            // Generic fallback — show a confirmation step
            steps.push({ type: 'CONFIRM', id: 'confirm' });
        }

        return steps;
    };

    const wizardSteps = note ? buildWizardSteps(note) : [];
    const currentStep = wizardSteps[currentStepIndex];
    const isLastStep = currentStepIndex >= wizardSteps.length - 1;
    const isFirstStep = currentStepIndex === 0;

    // ── Validate current step before advancing ───────────────────────────────
    const validateCurrentStep = () => {
        if (!currentStep) return true;

        if (currentStep.type === 'INPUT') {
            const item = currentStep.data;
            const actualQty = parseFloat(actualQuantities[item.id] || '0');
            const planned = item.plannedQuantity || 0;
            // Must have some qty entered
            if (actualQty <= 0) return false;
            // Must have a lot (either from selections or manual)
            const hasLotSelection = (lotSelections[item.id] || []).length > 0;
            const hasManualLot = !!(lotNumbers[item.id] || '').trim();
            if (!hasLotSelection && !hasManualLot) return false;
            // Must have a weighing photo (mandatory for traceability)
            if (!weighingPhotos[item.id]) return false;
        }

        if (currentStep.type === 'EMPAQUE') {
            if (!empaqueData.qty || parseFloat(empaqueData.qty) <= 0) return false;
        }

        return true;
    };

    // ── Save step data on advance ────────────────────────────────────────────
    const persistStepData = async (step) => {
        try {
            if (step.type === 'INPUT') {
                const item = step.data;
                await api.patch(`/geniality/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        weighing_data: {
                            ...(note.processParameters?.weighing_data || {}),
                            [item.id]: {
                                actualQty: actualQuantities[item.id],
                                lotNumber: lotNumbers[item.id],
                                lotSelections: lotSelections[item.id],
                                photoUrl: weighingPhotos[item.id]
                            }
                        }
                    }
                });
            } else if (step.type === 'EMPAQUE') {
                await api.patch(`/geniality/assembly-notes/${note.id}`, {
                    processParameters: { ...note.processParameters, empaque_result: empaqueData }
                });
            }
        } catch (err) {
            console.warn('Persist step data failed (non-critical):', err.message);
        }
    };

    const handleNext = async () => {
        if (!validateCurrentStep()) return;
        await persistStepData(currentStep);

        if (isLastStep) {
            // Complete the note
            if (currentStep.type === 'ENSAMBLE') return; // GEnsambleStep handles completion
            await completeNote();
        } else {
            setCurrentStepIndex(i => i + 1);
        }
    };

    const completeNote = async () => {
        setCompleting(true);
        try {
            await api.post(`/geniality/assembly-notes/${note.id}/complete`, {
                finalData: { actualQuantities, lotNumbers, lotSelections, empaqueData }
            });
            navigate(-1);
        } catch (err) {
            setError(err.response?.data?.error || 'Error al completar nota');
        } finally {
            setCompleting(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
                <Loader size={40} className="animate-spin text-emerald-500" />
                <span className="font-bold">Cargando proceso Geniality...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
                <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 max-w-md w-full text-center">
                    <AlertTriangle size={40} className="text-red-500 mx-auto mb-3" />
                    <div className="font-black text-red-700 mb-2">Error al cargar</div>
                    <div className="text-sm text-red-600">{error}</div>
                    <button onClick={loadNote} className="mt-4 bg-red-600 text-white rounded-xl px-6 py-2 font-bold hover:bg-red-700 transition-all">
                        Reintentar
                    </button>
                </div>
            </div>
        );
    }

    if (!note || wizardSteps.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 font-bold">
                No hay pasos definidos para esta nota de ensamble Geniality.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-700 to-teal-600 text-white px-4 py-3 flex items-center gap-3 shadow-lg flex-shrink-0">
                <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-white/20 transition-all">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">GENIALITY — {note.processType?.name || 'Proceso'}</div>
                    <div className="font-black text-sm truncate">{note.productionBatch?.batchNumber || note.id}</div>
                </div>
                {/* Step indicator */}
                <div className="flex items-center gap-1">
                    {wizardSteps.map((_, idx) => (
                        <div key={idx} className={`h-2 rounded-full transition-all ${idx === currentStepIndex ? 'w-6 bg-white' : idx < currentStepIndex ? 'w-2 bg-white/60' : 'w-2 bg-white/30'}`} />
                    ))}
                </div>
            </div>

            {/* Step content */}
            <div className="flex-1 overflow-y-auto">
                {currentStep?.type === 'INPUT' && (
                    <GInputStep
                        stepData={currentStep.data}
                        currentCount={currentStepIndex + 1}
                        totalSteps={wizardSteps.filter(s => s.type === 'INPUT').length}
                        actualQuantities={actualQuantities}
                        onActualQtyChange={(id, val) => setActualQuantities(p => ({ ...p, [id]: val }))}
                        lotNumbers={lotNumbers}
                        onLotNumberChange={(id, val) => setLotNumbers(p => ({ ...p, [id]: val }))}
                        onWeighingPhotoChange={(id, url) => setWeighingPhotos(p => ({ ...p, [id]: url }))}
                        weighingPhotoUrl={weighingPhotos[currentStep.data?.id]}
                        onLotIdSelected={(id, lotId) => {}}
                        lotSelections={lotSelections}
                        onLotSelectionsChange={(id, sels) => setLotSelections(p => ({ ...p, [id]: sels }))}
                        batchMultiplier={note.processParameters?.batchMultiplier || 1}
                        note={note}
                    />
                )}

                {currentStep?.type === 'MEZCLADO' && (
                    <GMezclado note={note} onConfirm={handleNext} />
                )}

                {currentStep?.type === 'EMPAQUE' && (
                    <GEmpaqueStep note={note} onDataChange={setEmpaqueData} savedData={empaqueData} />
                )}

                {currentStep?.type === 'ENSAMBLE' && (
                    <GEnsambleStep note={note} onComplete={() => navigate(-1)} />
                )}

                {/* ── Escarchado Steps ─────────────────────────────── */}
                {currentStep?.type === 'GE_PREMIX' && (
                    <GEPremixStep note={note} onConfirm={handleNext} />
                )}

                {currentStep?.type === 'GE_BASE_LIQUIDA' && (
                    <GEBaseLiquidaStep note={note} onConfirm={handleNext} />
                )}

                {currentStep?.type === 'GE_COCCION' && (
                    <GECoccionStep note={note} onConfirm={handleNext} />
                )}

                {currentStep?.type === 'CONFIRM' && (
                    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
                        <div className="text-slate-500 text-center">
                            <div className="text-4xl mb-3">✅</div>
                            <div className="font-black text-xl text-slate-700">Confirmar proceso</div>
                            <div className="text-sm text-slate-500 mt-2">Proceso: {note.processType?.name}</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer navigation — hidden for MEZCLADO, ENSAMBLE, and GE_* steps (they self-advance) */}
            {currentStep?.type !== 'MEZCLADO' && currentStep?.type !== 'ENSAMBLE'
                && currentStep?.type !== 'GE_PREMIX' && currentStep?.type !== 'GE_BASE_LIQUIDA' && currentStep?.type !== 'GE_COCCION' && (
                <div className="bg-white border-t border-slate-200 px-4 py-3 flex gap-3 flex-shrink-0 shadow-lg">
                    {!isFirstStep && (
                        <button
                            onClick={() => setCurrentStepIndex(i => i - 1)}
                            className="flex items-center gap-2 px-5 py-3 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-600 font-bold hover:bg-slate-100 transition-all active:scale-95"
                        >
                            <ArrowLeft size={18} /> Atrás
                        </button>
                    )}
                    <button
                        onClick={handleNext}
                        disabled={!validateCurrentStep() || completing}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-base transition-all active:scale-95 shadow-md
                            ${!validateCurrentStep() || completing
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : isLastStep
                                    ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:shadow-lg'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:shadow-lg'
                            }`}
                    >
                        {completing
                            ? <><Loader size={20} className="animate-spin" /> Completando...</>
                            : isLastStep
                                ? <><CheckCircle size={20} /> Completar Proceso</>
                                : <>Siguiente <ArrowRight size={20} /></>
                        }
                    </button>
                </div>
            )}
        </div>
    );
};

export default GenialityExecutionWizard;
