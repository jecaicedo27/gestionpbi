import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';

/**
 * useAssemblyNote
 *
 * Manages fetching/resolving an assembly note (by noteId or batchId),
 * building the wizard step sequence, and related navigation state.
 */
export function useAssemblyNote(id) {
    const navigate = useNavigate();

    const [note, setNote] = useState(null);
    const [allBatchNotes, setAllBatchNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [wizardSteps, setWizardSteps] = useState([]);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [actualQuantities, setActualQuantities] = useState({});
    const [lotNumbers, setLotNumbers] = useState({});
    const [lotSelections, setLotSelections] = useState({}); // {itemId: [{lotId, lotNumber, qty}]}
    const [outputQuantity, setOutputQuantity] = useState('');
    const [outputObservations, setOutputObservations] = useState('');
    const [targetQuantity, setTargetQuantity] = useState('');
    const [esferaOutputFactor, setEsferaOutputFactor] = useState(1.1);

    useEffect(() => {
        fetchNote();
        api.get('/config').then(r => {
            if (r.data?.esfera_output_factor) setEsferaOutputFactor(parseFloat(r.data.esfera_output_factor));
        }).catch(() => { });
    }, [id]);

    const fetchNote = async () => {
        try {
            setLoading(true);
            setError(null);
            let data = null;

            try {
                const response = await api.get(`/assembly-notes/${id}`);
                data = response.data;
            } catch (err) {
                if (err.response && err.response.status === 404) {
                    const existingNotesRes = await api.get(`/assembly-notes?batchId=${id}`);
                    if (existingNotesRes.data && existingNotesRes.data.length > 0) {
                        const sorted = [...existingNotesRes.data].sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));
                        const activeNote = sorted.find(n => n.status === 'EXECUTING')
                            || sorted.find(n => n.status === 'PENDING')
                            || sorted[0];
                        const fullRes = await api.get(`/assembly-notes/${activeNote.id}`);
                        data = fullRes.data;
                        window.history.replaceState(null, '', `/assembly-execution/${activeNote.id}`);
                    } else {
                        const genRes = await api.post('/assembly-notes/generate', { batchId: id });
                        if (genRes.data?.notes?.length > 0) {
                            const firstNote = genRes.data.notes[0];
                            const fullRes = await api.get(`/assembly-notes/${firstNote.id}`);
                            data = fullRes.data;
                            window.history.replaceState(null, '', `/assembly-execution/${firstNote.id}`);
                        } else {
                            throw new Error('No se pudo generar la nota. Verifique que el producto tenga una Plantilla de Producción activa.');
                        }
                    }
                } else {
                    throw err;
                }
            }

            if (!data) throw new Error('No se encontró información de ejecución.');

            // Auto-skip orphaned notes (notes whose template stage was deleted)
            // BUT: sub-template expanded stages have stageId=null by design — they are NOT orphaned
            const isFromSubTemplate = data.processParameters?.fromSubTemplate;
            if ((data.status === 'PENDING' || data.status === 'EXECUTING') && !data.stageId && !isFromSubTemplate) {
                try {
                    if (data.status === 'PENDING') {
                        await api.post(`/assembly-notes/${data.id}/start`, { operatorId: null }).catch(() => { });
                    }
                    await api.post(`/assembly-notes/${data.id}/complete`, {
                        actualQuantity: 0,
                        observations: 'Auto-completado: etapa eliminada del flujo de producción'
                    });
                    const allNotesRes = await api.get(`/assembly-notes?batchId=${data.productionBatchId}`);
                    const nextNote = allNotesRes.data
                        .filter(n => n.id !== data.id && n.status !== 'COMPLETED')
                        .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0];
                    if (nextNote) {
                        window.history.replaceState(null, '', `/assembly-execution/${nextNote.id}`);
                        window.location.reload();
                        return;
                    }
                } catch (skipErr) {
                    console.warn('Auto-skip failed:', skipErr.message);
                }
            }

            const batchNotesRes = await api.get(`/assembly-notes?batchId=${data.productionBatchId}`);
            setAllBatchNotes(batchNotesRes.data || []);
            setNote(data);
            buildWizardSteps(data);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Error cargando la orden de producción.');
        } finally {
            setLoading(false);
        }
    };

    const buildWizardSteps = (noteData) => {
        const steps = [];
        const isEnsamble = noteData.processType?.code === 'ENSAMBLE';
        const isConteo = noteData.processType?.code === 'CONTEO';
        const isEmpaque = noteData.processType?.code === 'EMPAQUE';
        const isCoccion = noteData.processType?.code === 'COCCION';
        const isMedicion = noteData.processType?.code === 'MEDICION';
        const isProteccionGate = noteData.processType?.code === 'PROTECCION_GATE';

        steps.push({ type: 'INTRO', data: noteData });

        if (isConteo) {
            steps.push({ type: 'CONTEO', data: noteData });
        } else if (isEnsamble) {
            steps.push({ type: 'MARCADO_CAJAS', data: noteData });
            steps.push({ type: 'ENSAMBLE', data: noteData });
        } else if (isEmpaque) {
            // If materials were pre-consumed at CONTEO, skip all INPUT steps
            const preConsumed = noteData.processParameters?.materialsPreConsumed === true;
            if (!preConsumed) {
                // Legacy: Add INPUT steps for items needing lot selection (not ETIQUETA, SELLO, CAJA)
                const exemptKeywords = ['ETIQUETA', 'SELLO', 'CAJA'];
                const lotItems = (noteData.items || []).filter(item => {
                    const name = (item.component?.name || '').toUpperCase();
                    return !exemptKeywords.some(kw => name.includes(kw));
                });
                lotItems.forEach(item => steps.push({ type: 'INPUT', data: item }));
            }
            steps.push({ type: 'EMPAQUE', data: noteData });
        } else if (isCoccion) {
            steps.push({ type: 'COCCION', data: noteData });
        } else if (isMedicion) {
            steps.push({ type: 'MEDICION', data: noteData });
        } else if (isProteccionGate) {
            steps.push({ type: 'PROTECCION_GATE', data: noteData });
        } else {
            if (noteData.items && noteData.items.length > 0) {
                noteData.items.forEach(item => steps.push({ type: 'INPUT', data: item }));
            }
            // For FORMACION (Esferas): QC step → timer after inputs
            if (noteData.processType?.code === 'FORMACION') {
                steps.push({ type: 'FORMACION_QC', data: noteData });
                steps.push({ type: 'ESFERIFICACION', data: noteData });
            }
        }

        if (!isEnsamble && !isConteo && !isEmpaque && !isCoccion && !isMedicion && !isProteccionGate) {
            steps.push({ type: 'OUTPUT', data: noteData });
        }

        setWizardSteps(steps);

        // ── Restore state from server-saved data ──────────────────────────
        // Items that were already weighed/filled have actualQuantity and lotNumber
        const restoredActuals = {};
        const restoredLots = {};
        (noteData.items || []).forEach(item => {
            if (item.actualQuantity != null && item.actualQuantity !== 0) {
                restoredActuals[item.id] = item.actualQuantity;
            }
            if (item.lotNumber) {
                restoredLots[item.id] = item.lotNumber;
            }
        });
        setActualQuantities(restoredActuals);
        setLotNumbers(restoredLots);

        // Determine correct starting step:
        // - If note is EXECUTING (already started), skip INTRO
        // - Jump to the first INPUT step that hasn't been filled yet
        let startIdx = 0;
        if (noteData.status === 'EXECUTING') {
            // 1. Check for server-saved wizard step position (persisted when user navigates away)
            const savedStep = noteData.processParameters?.wizardStep;
            if (typeof savedStep === 'number' && savedStep > 0 && savedStep < steps.length) {
                startIdx = savedStep;
            } else {
                // 2. Fallback: Skip INTRO (step 0) and find first unfilled INPUT
                startIdx = 1;
                const inputSteps = steps.map((s, i) => ({ ...s, idx: i })).filter(s => s.type === 'INPUT');
                if (inputSteps.length > 0) {
                    const firstUnfilled = inputSteps.find(s => {
                        const itemId = s.data?.id;
                        return !restoredActuals[itemId];
                    });
                    if (firstUnfilled) {
                        startIdx = firstUnfilled.idx;
                    } else {
                        // All inputs filled — check for FORMACION_QC / ESFERIFICACION before going to OUTPUT
                        const qcIdx = steps.findIndex(s => s.type === 'FORMACION_QC');
                        const outputIdx = steps.findIndex(s => s.type === 'OUTPUT');
                        startIdx = qcIdx >= 0 ? qcIdx : outputIdx >= 0 ? outputIdx : steps.length - 1;
                    }
                }
            }
        }
        setCurrentStepIndex(startIdx);

        // Calculate expected output quantity
        const weightUnits = ['g', 'kg', 'KG', 'gramo', 'gramos'];
        let plannedTotal = (noteData.items || []).reduce((sum, item) => {
            if (!weightUnits.includes(item.unit)) return sum;
            const qty = item.plannedQuantity || 0;
            const inGrams = (item.unit === 'kg' || item.unit === 'KG') ? qty * 1000 : qty;
            return sum + inGrams;
        }, 0);

        if (noteData.processType?.code === 'FORMACION') {
            const compuestoItem = (noteData.items || []).find(i =>
                i.component?.name?.toUpperCase().includes('COMPUESTO')
            );
            if (compuestoItem?.plannedQuantity) {
                plannedTotal = compuestoItem.plannedQuantity * esferaOutputFactor;
            }
        }

        if (noteData.processType?.code === 'ENSAMBLE') {
            const productId = noteData.processParameters?.product_id;
            const target = (noteData.productionBatch?.outputTargets || []).find(t => t.productId === productId);
            if (target?.plannedUnits) plannedTotal = target.plannedUnits;
        }

        if (noteData.processType?.code === 'EMPAQUE' && noteData.empaqueData?.conteo_qty != null) {
            plannedTotal = noteData.empaqueData.conteo_qty;
        }

        // For PESAJE: use the note's targetQuantity directly (e.g. "1 lote")
        // instead of summing item grams (which would give 156 for 108g + 48g)
        if (noteData.processType?.code === 'PESAJE' && noteData.targetQuantity) {
            plannedTotal = noteData.targetQuantity;
        }

        const batchKey = `batch_target_${noteData.productionBatchId}`;
        const savedTarget = localStorage.getItem(batchKey);
        const defaultTarget = savedTarget || (plannedTotal > 0 ? plannedTotal.toFixed(0) : (noteData.targetQuantity || 1).toString());
        setOutputQuantity('');
        setTargetQuantity(defaultTarget);
        setOutputObservations('');
    };

    // Persist wizard step to processParameters so user can resume where they left off
    const saveWizardStep = async (stepIdx) => {
        if (!note?.id) return;
        try {
            await api.patch(`/assembly-notes/${note.id}`, {
                processParameters: {
                    ...note.processParameters,
                    wizardStep: stepIdx
                }
            });
            if (note.processParameters) {
                note.processParameters.wizardStep = stepIdx;
            }
        } catch (e) {
            console.warn('Could not save wizard step:', e.message);
        }
    };

    return {
        note, setNote,
        allBatchNotes,
        loading, error,
        wizardSteps,
        currentStepIndex, setCurrentStepIndex,
        actualQuantities, setActualQuantities,
        lotNumbers, setLotNumbers,
        lotSelections, setLotSelections,
        outputQuantity, setOutputQuantity,
        outputObservations, setOutputObservations,
        targetQuantity, setTargetQuantity,
        esferaOutputFactor,
        fetchNote,
        saveWizardStep,
    };
}
