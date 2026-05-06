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

            // Auto-complete redundant ENSAMBLE notes (G_ENSAMBLE for Geniality, or "Ensamble Siigo" for azúcar invertida)
            const isAutoEnsamble = data.processType?.code === 'G_ENSAMBLE'
                || (data.processType?.code === 'ENSAMBLE' && (data.stageName || '').toLowerCase().includes('siigo'));
            if ((data.status === 'PENDING' || data.status === 'EXECUTING') && isAutoEnsamble) {
                try {
                    const isEnsambleSiigo = (data.stageName || '').toLowerCase().includes('ensamble siigo');
                    let actualQty = data.targetQuantity;
                    
                    if (isEnsambleSiigo && data.productionBatchId) {
                        try {
                            const batchNotesRes = await api.get(`/assembly-notes?batchId=${data.productionBatchId}`);
                            const conteoNote = batchNotesRes.data?.find(n => n.processType?.code === 'CONTEO');

                            if (conteoNote) {
                                const isPreConteo = (data.stageOrder || 0) < (conteoNote.stageOrder || 0);

                                if (!isPreConteo) {
                                    if (conteoNote.status !== 'COMPLETED') {
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
                                    console.log(`[Auto-Skip] ✅ Pre-CONTEO Ensamble Siigo ${data.id} — completing immediately (RPA will fire)`);
                                }
                            }
                            // No CONTEO in this batch (e.g. azúcar invertida) → complete directly, RPA will fire
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
                        window.location.href = '/production/operator';
                        return;
                    }
                } catch (skipErr) {
                    console.warn('Auto-skip ENSAMBLE failed:', skipErr.message);
                }
            }

            // Auto-start ADICION notes (no INTRO step to trigger start manually)
            if (data.status === 'PENDING' && data.processType?.code === 'ADICION') {
                try {
                    await api.post(`/assembly-notes/${data.id}/start`, { operatorId: null });
                    data.status = 'EXECUTING';
                } catch (e) {
                    console.warn('Auto-start ADICION failed:', e.message);
                }
            }

            // Auto-skip orphaned notes (notes whose template stage was deleted)
            // BUT: sub-template expanded stages and manually-added presentations have stageId=null by design
            const isFromSubTemplate = data.processParameters?.fromSubTemplate;
            const isManuallyAdded = data.processParameters?.empaque_reception_confirmed;
            if ((data.status === 'PENDING' || data.status === 'EXECUTING') && !data.stageId && !isFromSubTemplate && !isManuallyAdded) {
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
            const batchNotesList = batchNotesRes.data || [];
            setAllBatchNotes(batchNotesList);
            setNote(data);
            buildWizardSteps(data, batchNotesList);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Error cargando la orden de producción.');
        } finally {
            setLoading(false);
        }
    };

    const buildWizardSteps = (noteData, batchNotesList = []) => {
        const steps = [];
        let skipOutput = false;
        const processCode = noteData.processType?.code;
        const isPesaje = ['PESAJE', 'G_PESAJE'].includes(processCode);
        const isFormacion = ['FORMACION', 'G_FORMACION'].includes(processCode);
        const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE'].includes(processCode);
        const isConteo = ['CONTEO', 'G_CONTEO'].includes(processCode);
        const isEmpaque = ['EMPAQUE', 'G_EMPAQUE'].includes(processCode);
        const isCoccion = processCode === 'COCCION';
        const isAdicion = processCode === 'ADICION';
        const isMedicion = processCode === 'MEDICION';
        const isProteccionGate = processCode === 'PROTECCION_GATE';
        const isImpresionLote = processCode === 'IMPRESION_LOTE';
        const isGEPremix = processCode === 'GE_PREMIX';
        const isGEBaseLiquida = processCode === 'GE_BASE_LIQUIDA';
        const isGECoccion = processCode === 'GE_COCCION';
        const isEscarchadoStep = isGEPremix || isGEBaseLiquida || isGECoccion;

        const isGenialityRoute = window.location.pathname.includes('/geniality/');
        const isSiropeGeniality = (
            ['G_EMPAQUE', 'EMPAQUE', 'CONTEO', 'G_CONTEO'].includes(processCode)
        ) && (
            isGenialityRoute ||
            noteData.product?.name?.toUpperCase().includes('SIROPE') ||
            noteData.product?.name?.toUpperCase().includes('MASA') ||
            noteData.product?.name?.toUpperCase().includes('GENIALITY') ||
            noteData.product?.name?.toUpperCase().includes('SABORIZACION')
        );

        const BATCH_TEMPLATES = ['TMPL-AZINV-001', 'TMPL-FRUCT-001'];
        const isBatchFlow = BATCH_TEMPLATES.includes(noteData.template?.templateCode);

        // Detección de flujo PROTECCION — aplica a TODAS las plantillas de
        // protección (TMPL015 Maracuya, TMPL019 Sandia, TMPL025 Manzana Verde,
        // Blueberry, Fresa, Mango, Café, etc.) sin tocar las plantillas en BD.
        // Solo afecta el render del wizard, NO toca esferificación, Liquipops,
        // Geniality, Azúcar Invertida ni ningún otro flujo.
        const _productNameUC = (noteData.product?.name || '').toUpperCase();
        const isProteccionFlow = _productNameUC.startsWith('PROTECCION') ||
            _productNameUC.startsWith('BASE LIQUIPOPS') ||
            _productNameUC.startsWith('COMPUESTO') ||
            _productNameUC.startsWith('BASE SIROPE') ||
            _productNameUC.startsWith('SABORIZACION');

        // Map de productos producidos por etapas previas COMPLETED del MISMO bache.
        // Sirve para auto-rellenar items y SALTAR pantallas INPUT de insumos
        // intermedios (ej. FORMACION usa ALGINATO PREPARADO + COMPUESTO BLUEBERRY,
        // ambos producidos en stages anteriores → no requieren foto ni captura).
        const _producedByPrevStage = new Map();
        (batchNotesList || []).forEach(n => {
            if (n.id === noteData.id) return;
            if (n.status !== 'COMPLETED') return;
            if (!n.productId) return;
            const prev = _producedByPrevStage.get(n.productId);
            if (!prev || (n.stageOrder || 0) > (prev.stageOrder || 0)) {
                _producedByPrevStage.set(n.productId, n);
            }
        });
        const isIntermediateItem = (item) => _producedByPrevStage.has(item.componentId);

        // Detección de flujo PREMEZCLA (CONSERVANTES, GOMAS, FUENTE DE CALCIO,
        // CALCIO DIOXIDO, etc.) y PROTONICO. Se tratan como un pesaje compacto
        // sin adición a la olla — el operario pesa todo en una pantalla y cierra.
        const productNameU = (noteData.product?.name || '').toUpperCase();
        const isPremezclaFlow = productNameU.startsWith('PREMEZCLA') ||
                                 productNameU === 'PROTONICO' ||
                                 productNameU.startsWith('PROTONICO') ||
                                 productNameU.startsWith('ALGINATO PREPARADO');

        // Skip INTRO for Geniality notes, Escarchado, ADICION, IMPRESION_LOTE,
        // batch-flow stages, y los flujos rediseñados (PROTECCION/PREMEZCLA y
        // sus variantes BASE SIROPE/SABORIZACION/COMPUESTO/etc.) que ya tienen
        // su propio header en PESAJE_BATCH/ADICION_BATCH.
        const skipIntroForFlow = (isProteccionFlow || isPremezclaFlow) && isPesaje;
        if (!isSiropeGeniality && !isEscarchadoStep && !isAdicion && !isImpresionLote && !isBatchFlow && !skipIntroForFlow) {
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
            } else if (isEnsamble && (isProteccionFlow || isPremezclaFlow)) {
                // ENSAMBLE invisible para PROTECCION/PREMEZCLA — el cierre Siigo
                // se dispara automáticamente al montar la nota; no se renderiza UI.
                // No se push-ean pasos: AssemblyExecutionWizard detecta wizardSteps=0
                // y auto-completa el ENSAMBLE en backend.
            } else if (isEnsamble) {
                // ENSAMBLE Siigo: solo registrar cantidad real y cerrar en Siigo (RPA).
                // El marcado de cajas es responsabilidad del EMPAQUE, no del ENSAMBLE.
                steps.push({ type: 'OUTPUT', data: noteData });
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
        } else if (isAdicion) {
            steps.push({ type: 'ADICION_BATCH', data: noteData.items || [] });
        } else if (isMedicion) {
            steps.push({ type: 'MEDICION', data: noteData });
        } else if (isProteccionGate) {
            steps.push({ type: 'PROTECCION_GATE', data: noteData });
        } else if (isImpresionLote) {
            steps.push({ type: 'IMPRESION_LOTE', data: noteData });
            skipOutput = true;
        } else if (isEscarchadoStep) {
            // Escarchado: GE_BASE_LIQUIDA y GE_PREMIX son pesajes — usan
            // PESAJE_BATCH para garantizar foto + lote + cantidad por
            // ingrediente, igual que PROTECCION/COMPUESTO/SABORIZACION.
            // GE_COCCION sí mantiene su componente especializado (control
            // de temperatura, no pesaje).
            if (isGEBaseLiquida || isGEPremix) {
                if (noteData.items?.length > 0) {
                    // GE_PREMIX: si todos los items YA tienen actualQuantity > 0
                    // (porque el operario los pesó en el panel "Mientras esperas"
                    // del COCCION_INVERSION del stage anterior), saltar PESAJE_BATCH
                    // y dejar solo ADICION_BATCH.
                    const allPrePesado = isGEPremix && noteData.items.every(
                        it => it.actualQuantity != null && it.actualQuantity > 0
                    );
                    if (!allPrePesado) {
                        steps.push({ type: 'PESAJE_BATCH', data: noteData.items });
                    }
                    const adicionItems = (noteData.items || []).slice().sort(
                        (a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999)
                    );
                    steps.push({ type: 'ADICION_BATCH', data: adicionItems });
                }
                // GE_BASE_LIQUIDA: después de adicionar, cocción + enfriamiento
                // de la azúcar invertida (90°C calentamiento → 50°C enfriamiento)
                // antes de incorporar el premix.
                if (isGEBaseLiquida) steps.push({ type: 'COCCION_INVERSION', data: noteData });
                // GE_PREMIX: ya está cubierto por PESAJE_BATCH + ADICION_BATCH;
                // no se necesita la pantalla dedicada — sería repetir.
            }
            if (isGECoccion) steps.push({ type: 'GE_COCCION', data: noteData });
            skipOutput = true;
        } else if (isProteccionFlow && isPesaje && noteData.items?.length > 0) {
            // Flujo PROTECCION (TMPL015/019/025/Blueberry/Fresa/Mango/Café/etc.)
            // Mismo patrón que Azúcar Invertida: el agua es un ingrediente más
            // en la lista del PESAJE_BATCH (orden 1). El operario va al pesaje,
            // deja el agua llenando mientras pesa los demás ingredientes.
            //   PESAJE_BATCH (con AGUA incluida) → ADICION_BATCH → OUTPUT
            steps.push({ type: 'PESAJE_BATCH', data: noteData.items });
            const adicionItems = (noteData.items || []).slice().sort(
                (a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999)
            );
            steps.push({ type: 'ADICION_BATCH', data: adicionItems });
            // BASE SIROPE no necesita OUTPUT — ya pasa a SABORIZACION donde
            // se toma el QC final del producto. SABORIZACION sí muestra OUTPUT
            // con parámetros (°Brix, pH, sabor, foto del producto).
            if (_productNameUC.startsWith('BASE SIROPE')) {
                skipOutput = true;
            }
        } else if (isPremezclaFlow && isPesaje && noteData.items?.length > 0) {
            // Flujo PREMEZCLA (CONSERVANTES, GOMAS, FUENTE DE CALCIO, etc.)
            // No hay olla ni adición: el operario pesa todo en una sola
            // pantalla y va directo al cierre. Reemplaza N pantallas INPUT.
            //   PESAJE_BATCH → OUTPUT
            steps.push({ type: 'PESAJE_BATCH', data: noteData.items });
        } else {
            const isBatchPesaje = isPesaje && isBatchFlow && noteData.items?.length > 0;
            if (isBatchPesaje) {
                steps.push({ type: 'PESAJE_BATCH', data: noteData.items });
                skipOutput = true;
            } else if (noteData.items && noteData.items.length > 0) {
                // Skip INPUT screens for items que son producto intermedio del mismo
                // bache (ej. ALGINATO PREPARADO, COMPUESTO BLUEBERRY en FORMACION).
                // Esos items se auto-rellenan y consumen, sin foto ni interacción.
                noteData.items.forEach(item => {
                    if (isIntermediateItem(item)) return;
                    steps.push({ type: 'INPUT', data: item });
                });
            }
            // For FORMACION (Esferas): QC step → timer after inputs
            if (isFormacion) {
                steps.push({ type: 'FORMACION_QC', data: noteData });
                steps.push({ type: 'ESFERIFICACION', data: noteData });
            }
        }
        } // Close the outer if statement

        if (!isEnsamble && !isConteo && !isEmpaque && !isCoccion && !isAdicion && !isMedicion && !isProteccionGate && !isImpresionLote && !isSiropeGeniality && !isEscarchadoStep && !skipOutput) {
            steps.push({ type: 'OUTPUT', data: noteData });
        }

        setWizardSteps(steps);

        // ── Restore state from server-saved data ──────────────────────────
        // Items que ya tienen actualQuantity y/o lotNumber persistidos en BD.
        // También restauramos `lotSelections` desde processParameters.lot_selections
        // para que el chip verde "Lote: XXX" reaparezca al volver al wizard.
        const restoredActuals = {};
        const restoredLots = {};
        const restoredLotSelections = {};
        const persistedLotSel = noteData.processParameters?.lot_selections || {};

        // Auto-fill: si un item del PESAJE actual (ej: COMPUESTO usa BASE LIQUIPOPS)
        // fue producido por un stage previo del mismo bache, sembramos cantidad y lote.
        // Match: componentId === productId del nodo previo COMPLETED. El lote se toma
        // del batchNumber del bache (igual que el lote autogenerado en el wizard).
        const batchNumberAuto = (batchNotesList[0]?.productionBatch?.batchNumber)
            || (noteData.productionBatch?.batchNumber)
            || null;
        const producedByPrevStage = new Map();
        (batchNotesList || []).forEach(n => {
            if (n.id === noteData.id) return;
            if (n.status !== 'COMPLETED') return;
            if (!n.productId) return;
            const prev = producedByPrevStage.get(n.productId);
            if (!prev || (n.stageOrder || 0) > (prev.stageOrder || 0)) {
                producedByPrevStage.set(n.productId, n);
            }
        });

        (noteData.items || []).forEach(item => {
            if (item.actualQuantity != null && item.actualQuantity !== 0) {
                restoredActuals[item.id] = item.actualQuantity;
            }
            if (item.lotNumber) {
                restoredLots[item.id] = item.lotNumber;
                // Reconstruir lotSelections desde lotNumber + lot_selections
                // (así el componente PesajeBatchStep muestra el chip seleccionado).
                const persistedLotId = persistedLotSel[item.id] || null;
                restoredLotSelections[item.id] = [{
                    lotId: persistedLotId,
                    lotNumber: item.lotNumber,
                    qty: item.actualQuantity || item.plannedQuantity || 0,
                }];
            }

            // Auto-fill desde stage previo del mismo bache si aún no hay valor.
            if (!restoredActuals[item.id] || !restoredLots[item.id]) {
                const producer = producedByPrevStage.get(item.componentId);
                if (producer && batchNumberAuto) {
                    if (!restoredActuals[item.id]) {
                        restoredActuals[item.id] = producer.actualQuantity || item.plannedQuantity || 0;
                    }
                    if (!restoredLots[item.id]) {
                        restoredLots[item.id] = batchNumberAuto;
                        restoredLotSelections[item.id] = [{
                            lotId: null,
                            lotNumber: batchNumberAuto,
                            qty: restoredActuals[item.id],
                        }];
                    }
                }
            }
        });
        setActualQuantities(restoredActuals);
        setLotNumbers(restoredLots);
        setLotSelections(restoredLotSelections);

        // Persistir en backend los items intermedios auto-rellenados (para que
        // el OUTPUT/completeNote funcione sin pasar por la pantalla INPUT).
        // Best-effort: si falla, el wizard normal sigue trabajando.
        (noteData.items || []).forEach(item => {
            const producer = producedByPrevStage.get(item.componentId);
            if (!producer || !batchNumberAuto) return;
            const alreadyOk = (item.actualQuantity != null && item.actualQuantity !== 0) && item.lotNumber;
            if (alreadyOk) return;
            api.patch(`/assembly-notes/${noteData.id}/items/${item.id}`, {
                actualQuantity: restoredActuals[item.id],
                lotNumber: batchNumberAuto,
            }).catch(() => {});
        });

        // Determine correct starting step:
        // - If note is EXECUTING (already started), skip INTRO (except EMPAQUE which uses INTRO for selection)
        // - Jump to the first INPUT step that hasn't been filled yet
        // - Si COMPLETED, abrir directo en el último paso útil (mantener el
        //   contexto del operario si abrió la nota cerrada para revisar/seguir).
        let startIdx = 0;
        if (noteData.status === 'COMPLETED' && steps.length > 0) {
            const savedStep = noteData.processParameters?.wizardStep;
            if (typeof savedStep === 'number' && savedStep > 0 && savedStep < steps.length) {
                startIdx = savedStep;
            } else {
                // último paso (saltar INTRO si es el primero)
                startIdx = steps.length - 1;
            }
        } else if (noteData.status === 'EXECUTING') {
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
