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

            // Auto-complete redundant G_ENSAMBLE notes for Geniality
            // The operator already weighed the ingredients and took the verification photo in the G_PESAJE / G_EMPAQUE step.
            if ((data.status === 'PENDING' || data.status === 'EXECUTING') && data.processType?.code === 'G_ENSAMBLE') {
                try {
                    const isEnsambleSiigo = (data.stageName || '').toLowerCase().includes('ensamble siigo');
                    let actualQty = data.targetQuantity;
                    
                    if (isEnsambleSiigo && data.productionBatchId) {
                        try {
                            const batchNotesRes = await api.get(`/assembly-notes?batchId=${data.productionBatchId}`);
                            const conteoNote = batchNotesRes.data?.find(n => n.processType?.code === 'CONTEO');
                            const isPreConteo = conteoNote && (data.stageOrder || 0) < (conteoNote.stageOrder || 0);

                            if (!isPreConteo) {
                                // ── Finished product Ensamble Siigo (after CONTEO) ──
                                // Per-carrito RPAs already handled Siigo. Defer until CONTEO completes.
                                if (conteoNote?.status !== 'COMPLETED') {
                                    console.log(`[Auto-Skip] ⏸️ Deferring Ensamble Siigo ${data.id} — CONTEO not completed`);
                                    const nextNote = batchNotesRes.data
                                        ?.filter(n => n.id !== data.id && n.status !== 'COMPLETED')
                                        .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0];
                                    if (nextNote) {
                                        window.history.replaceState(null, '', `/geniality/assembly-execution/${nextNote.id}`);
                                        window.location.reload();
                                    } else {
                                        window.location.href = '/production/operator';
                                    }
                                    return;
                                }

                                const carriots = conteoNote.processParameters?.carriots || [];
                                const productCarriots = carriots.filter(c => c.productId === data.productId && c.receivedAt);
                                const realQty = productCarriots.reduce((s, c) => s + (c.qty || 0), 0);
                                if (realQty > 0) actualQty = realQty;

                                await api.patch(`/assembly-notes/${data.id}`, {
                                    processParameters: { ...(data.processParameters || {}), skipRpa: true }
                                });
                            } else {
                                // ── Intermediate product Ensamble Siigo (before CONTEO) ──
                                // e.g. SABORIZACION: needs its own RPA, no CONTEO dependency
                                console.log(`[Auto-Skip] ✅ Pre-CONTEO Ensamble Siigo ${data.id} — completing immediately (RPA will fire)`);
                            }
                        } catch (e) {
                            console.warn('[Auto-Skip] Could not fetch CONTEO data for Ensamble Siigo:', e.message);
                        }
                    }
                    
                    console.log(`[Auto-Skip] Completing G_ENSAMBLE ${data.id} (${isEnsambleSiigo ? 'Ensamble Siigo' : 'intermediate'}, qty: ${actualQty})`);
                    if (data.status === 'PENDING') {
                        await api.post(`/assembly-notes/${data.id}/start`, { operatorId: null }).catch(() => { });
                    }
                    await api.post(`/assembly-notes/${data.id}/complete`, {
                        actualQuantity: actualQty,
                        observations: isEnsambleSiigo 
                            ? `Auto-completado: Ensamble Siigo post-empaque (qty real: ${actualQty}, RPA per-carrito)`
                            : 'Auto-completado: ensamble implícito tras G_PESAJE / G_EMPAQUE'
                    });
                    
                    const allNotesRes = await api.get(`/assembly-notes?batchId=${data.productionBatchId}`);
                    const nextNote = allNotesRes.data
                        .filter(n => n.id !== data.id && n.status !== 'COMPLETED')
                        .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0];
                        
                    if (nextNote) {
                        window.history.replaceState(null, '', `/assembly-execution/${nextNote.id}`);
                        window.location.reload();
                        return;
                    } else {
                        window.location.reload();
                        return;
                    }
                } catch (skipErr) {
                    console.warn('Auto-skip G_ENSAMBLE failed:', skipErr.message);
                }
            }

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
        const processCode = noteData.processType?.code;
        const isPesaje = ['PESAJE', 'G_PESAJE'].includes(processCode);
        const isFormacion = ['FORMACION', 'G_FORMACION'].includes(processCode);
        const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE'].includes(processCode);
        const isConteo = ['CONTEO', 'G_CONTEO'].includes(processCode);
        const isEmpaque = ['EMPAQUE', 'G_EMPAQUE'].includes(processCode);
        const isCoccion = processCode === 'COCCION';
        const isMedicion = processCode === 'MEDICION';
        const isProteccionGate = processCode === 'PROTECCION_GATE';
        const isGEPremix = processCode === 'GE_PREMIX';
        const isGEBaseLiquida = processCode === 'GE_BASE_LIQUIDA';
        const isGECoccion = processCode === 'GE_COCCION';
        const isEscarchadoStep = isGEPremix || isGEBaseLiquida || isGECoccion;

        const isSiropeGeniality = (
            ['G_EMPAQUE', 'EMPAQUE', 'CONTEO', 'G_CONTEO'].includes(processCode)
        ) && (
            noteData.product?.name?.toUpperCase().includes('SIROPE') || 
            noteData.product?.name?.toUpperCase().includes('MASA') ||
            noteData.product?.name?.toUpperCase().includes('GENIALITY') ||
            noteData.product?.name?.toUpperCase().includes('SABORIZACION')
        );

        // Skip INTRO for Geniality notes and Escarchado dedicated steps
        if (!isSiropeGeniality && !isEscarchadoStep) {
            steps.push({ type: 'INTRO', data: noteData });
        }

        if (isSiropeGeniality) {
            steps.push({ type: 'G_CONTEO_CARRITOS', data: noteData });
            // Only inject MARCADO_CAJAS for label printing deep-links.
            // DO NOT inject generic EMPAQUE or ENSAMBLE steps for Geniality.
            if (isEmpaque) {
                steps.push({ type: 'MARCADO_CAJAS', data: noteData });
            }
        } 
        
        if (!isSiropeGeniality) {
            // Only execute these standard flows if it's NOT a sirope Geniality.
            if (isConteo) {
                steps.push({ type: 'CONTEO', data: noteData });
            } else if (isEnsamble) {
                steps.push({ type: 'MARCADO_CAJAS', data: noteData });
                steps.push({ type: 'OUTPUT', data: noteData });   // Mandatory: operator enters REAL qty
                steps.push({ type: 'ENSAMBLE', data: noteData });
            } else if (isEmpaque) {
                const preConsumed = noteData.processParameters?.materialsPreConsumed === true;
            if (!preConsumed) {
                // Exempt packaging materials AND bulk ingredients already weighed in earlier steps
                const exemptKeywords = [
                    'ETIQUETA', 'SELLO', 'CAJA',         // packaging labels/seals/boxes
                    'TARRO', 'TAPA', 'FOIL', 'LINER', 'ENVASE',  // containers
                    'SABORIZACION', 'COMPUESTO', 'PROTECCION', 'BASE', 'SIROPE', // bulk ingredients
                    'ESFERA',  // spheres: auto-consumed from MaterialLot on completeNote
                ];
                const lotItems = (noteData.items || []).filter(item => {
                    const name = (item.component?.name || '').toUpperCase();
                    return !exemptKeywords.some(kw => name.includes(kw));
                });
                lotItems.forEach(item => steps.push({ type: 'INPUT', data: item }));
            }
            steps.push({ type: 'EMPAQUE', data: noteData });
            steps.push({ type: 'MARCADO_CAJAS', data: noteData });  // Etiquetado QR (buenas + NC)
            steps.push({ type: 'ENSAMBLE', data: noteData });       // Ensamble final (incluye merma)
        } else if (isCoccion) {
            steps.push({ type: 'COCCION', data: noteData });
        } else if (isMedicion) {
            steps.push({ type: 'MEDICION', data: noteData });
        } else if (isProteccionGate) {
            steps.push({ type: 'PROTECCION_GATE', data: noteData });
        } else if (isEscarchadoStep) {
            // Escarchado dedicated steps — each has its own specialized UI
            if (isGEPremix) steps.push({ type: 'GE_PREMIX', data: noteData });
            if (isGEBaseLiquida) steps.push({ type: 'GE_BASE_LIQUIDA', data: noteData });
            if (isGECoccion) steps.push({ type: 'GE_COCCION', data: noteData });
        } else {
            if (noteData.items && noteData.items.length > 0) {
                noteData.items.forEach(item => steps.push({ type: 'INPUT', data: item }));
            }
            // For FORMACION (Esferas): QC step → timer after inputs
            if (isFormacion) {
                steps.push({ type: 'FORMACION_QC', data: noteData });
                steps.push({ type: 'ESFERIFICACION', data: noteData });
            }
        }
        } // Close the outer if statement

        if (!isEnsamble && !isConteo && !isEmpaque && !isCoccion && !isMedicion && !isProteccionGate && !isSiropeGeniality && !isEscarchadoStep) {
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
        // - If note is EXECUTING (already started), skip INTRO (except EMPAQUE which uses INTRO for selection)
        // - Jump to the first INPUT step that hasn't been filled yet
        let startIdx = 0;
        if (noteData.status === 'EXECUTING') {
            // ── Priority 1: URL param ?skipIntro=1&step=TYPE overrides everything ──
            // Handles "Etiquetar" button navigation: G_CONTEO_CARRITOS → MARCADO_CAJAS
            const urlParams = new URLSearchParams(window.location.search);
            const skipIntroUrl = urlParams.get('skipIntro') === '1';
            const urlStepType = urlParams.get('step');
            if (skipIntroUrl && urlStepType) {
                const urlStepIdx = steps.findIndex(s => s.type === urlStepType);
                if (urlStepIdx >= 0) {
                    startIdx = urlStepIdx;
                }
            } else {
            if (isEmpaque) {
                // Restore to persisted wizard step (survive F5/logout/tablet lock)
                const savedStepEmp = noteData.processParameters?.wizardStep;
                if (typeof savedStepEmp === 'number' && savedStepEmp > 0 && savedStepEmp < steps.length) {
                    startIdx = savedStepEmp;
                } else {
                    startIdx = 0; // Default: start at selector
                }
            } else if (isSiropeGeniality) {
                // Geniality notes: only restore MARCADO_CAJAS step if there's an active carrito
                const savedStep = noteData.processParameters?.wizardStep;
                const hasActiveCarrito = !!noteData.processParameters?.activeCarritoId;
                if (typeof savedStep === 'number' && savedStep > 0 && savedStep < steps.length) {
                    const savedStepType = steps[savedStep]?.type;
                    if (savedStepType === 'MARCADO_CAJAS' && !hasActiveCarrito) {
                        startIdx = 0; // No active carrito — show carrito list
                    } else {
                        startIdx = savedStep;
                    }
                } else {
                    startIdx = 0; // Default: carrito list
                }
            } else {
                // 1. Check for server-saved wizard step position (persisted when user navigates away)
                const savedStep = noteData.processParameters?.wizardStep;
                if (typeof savedStep === 'number' && savedStep > 0 && savedStep < steps.length) {
                    startIdx = savedStep;
                } else {
                    // 2. Fallback: Skip INTRO (step 0) if present, otherwise start at 0
                    const hasIntro = steps[0]?.type === 'INTRO';
                    startIdx = hasIntro ? 1 : 0;
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
            } // end else (no URL step override)
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

        if (isFormacion) {
            const compuestoItem = (noteData.items || []).find(i =>
                i.component?.name?.toUpperCase().includes('COMPUESTO')
            );
            if (compuestoItem?.plannedQuantity) {
                plannedTotal = compuestoItem.plannedQuantity * esferaOutputFactor;
            }
        }

        if (isEnsamble) {
            const productId = noteData.processParameters?.product_id;
            const target = (noteData.productionBatch?.outputTargets || []).find(t => t.productId === productId);
            if (target?.plannedUnits) plannedTotal = target.plannedUnits;
        }

        if (isEmpaque && noteData.empaqueData?.conteo_qty != null) {
            plannedTotal = noteData.empaqueData.conteo_qty;
        }

        // For aggregate PESAJE notes, targetQuantity may come from older generated
        // data as the lot count (e.g. 2 lotes), while items hold the real grams.
        if (isPesaje && noteData.targetQuantity && !noteData.processParameters?.aggregateNote) {
            plannedTotal = noteData.targetQuantity;
        }

        const batchKey = `batch_target_${noteData.productionBatchId}`;
        const savedTarget = localStorage.getItem(batchKey);
        const defaultTarget = savedTarget || (plannedTotal > 0 ? plannedTotal.toFixed(0) : (noteData.targetQuantity || 1).toString());

        // For PESAJE: auto-fill Real Producido = Planificado (no scale at output step)
        setOutputQuantity(isPesaje ? defaultTarget : '');
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
