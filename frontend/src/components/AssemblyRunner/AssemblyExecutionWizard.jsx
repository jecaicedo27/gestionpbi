import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import StepDisplay from './StepDisplay';
import GiantControls from './GiantControls';
import { Spin, Alert, message, Modal } from 'antd';
import { Home } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAssemblyNote } from './hooks/useAssemblyNote';
import { useEmpaqueState } from './hooks/useEmpaqueState';
import { useConteoState } from './hooks/useConteoState';

// Helper: compute product-specific lot code matching backend logic
// e.g. "COMPUESTO FRESA" → "COMPUESTO-FRESA-260308-1043"
const computeLotCode = (productName) => {
    const now = new Date();
    const co = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const yy = String(co.getFullYear()).slice(-2);
    const mm = String(co.getMonth() + 1).padStart(2, '0');
    const dd = String(co.getDate()).padStart(2, '0');
    const hh = String(co.getHours()).padStart(2, '0');
    const mi = String(co.getMinutes()).padStart(2, '0');
    const short = (productName || '').toUpperCase()
        .replace(/\bSABOR\b/g, '').replace(/\bPREMEZCLA\b/g, '').replace(/\bPERLAS\b/g, '')
        .replace(/\s+A\s+/g, ' ').replace(/\s+X\s+/g, ' ').replace(/\s+DE\s+/g, ' ')
        .replace(/\bGR\b/g, '').replace(/\bG\b/g, '').replace(/\bML\b/g, '').replace(/\bKG\b/g, '')
        .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/-$/, '');
    return `${short}-${yy}${mm}${dd}-${hh}${mi}`;
};

const AssemblyExecutionWizard = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const location = useLocation();
    const skipIntroParam = new URLSearchParams(location.search).get('skipIntro') === '1';

    // ── Custom hooks ─────────────────────────────────────────────────────────
    const {
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
        saveWizardStep,
    } = useAssemblyNote(id);

    // ── Zone validation blocked modal ──
    const showZoneBlockedModal = (errorMsg) => {
        const lines = (errorMsg || '').split('\n').filter(Boolean);
        const title = lines[0] || 'Bloqueado';
        const shortages = lines.slice(1).filter(l => l.includes('necesita'));
        const footer = lines.find(l => l.includes('Ingrese'));
        Modal.error({
            title: '⛔ Producción Bloqueada',
            width: 520,
            centered: true,
            okText: 'Entendido',
            content: (
                <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: 12 }}>Los siguientes insumos no tienen stock suficiente en la <strong>Zona de Producción</strong>:</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {shortages.map((s, i) => {
                            const [name, rest] = s.split(': ');
                            return (
                                <div key={i} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 700, color: '#991b1b' }}>{name}</span>
                                    <span style={{ fontSize: '0.8rem', color: '#dc2626' }}>{rest}</span>
                                </div>
                            );
                        })}
                    </div>
                    {footer && <p style={{ marginTop: 16, fontSize: '0.85rem', color: '#6366f1', fontWeight: 600 }}>📦 {footer}</p>}
                </div>
            )
        });
    };

    const {
        empaqueDefective, setEmpaqueDefective,
        empaquePhotoUrls, setPhotoUrl,
        empaqueDefectReasons, setDefectReason,
        restoreFromDraft: restoreEmpaqueDraft,
        setNoteId: setEmpaqueNoteId,
    } = useEmpaqueState();

    const {
        conteoActuals, setConteoActual,
        conteoPhotos, setConteoPhoto,
        carriots, addCarritoLocal, removeCarritoLocal, preloadCarriots,
        preloadPhotos, preloadActuals
    } = useConteoState();

    // ── Empaque-side carriots (read from the CONTEO note) ─────────────────────
    const [empaqueCarriots, setEmpaqueCarriots] = useState([]);


    // ── Local wizard state ───────────────────────────────────────────────────
    const [submitting, setSubmitting] = useState(false);
    const [showCompletionPanel, setShowCompletionPanel] = useState(false);
    const [showHandoff, setShowHandoff] = useState(false);
    const [empaqueReceptionConfirmed, setEmpaqueReceptionConfirmed] = useState(false);
    const [savedReceptionPhotos, setSavedReceptionPhotos] = useState({});
    const [marcadoCajas, setMarcadoCajas] = useState({ unidadesPorCaja: 0, totalCajas: 0 });
    const [weighingPhotos, setWeighingPhotos] = useState({});
    const [selectedLotIds, setSelectedLotIds] = useState({});
    const [coccionData, setCoccionData] = useState(null);
    const [medicionData, setMedicionData] = useState(null);
    const [qcData, setQcData] = useState(null);
    const [formacionQcData, setFormacionQcData] = useState(null);
    const [esferificacionData, setEsferificacionData] = useState(null);
    const [aguaData, setAguaData] = useState(null);
    const [proteccionValidated, setProteccionValidated] = useState(false);
    const [adicionData, setAdicionData] = useState(null);
    // { productId: true } — tracks which presentations have been labeled by packaging
    const [rotuladoStatus, setRotuladoStatus] = useState({});
    // Extra conteo targets added by operators (sizes not in original schedule)
    const [extraConteoTargets, setExtraConteoTargets] = useState([]);
    // IMPRESION_LOTE state
    const [printLotData, setPrintLotData] = useState({ printed: false, copies: 1 });

    // ── Pre-load carriots, conteo, and photos from processParameters on note load (session resume) ─
    useEffect(() => {
        if (!note) return;
        const pp = note.processParameters || {};
        if (pp.carriots?.length > 0 && carriots.length === 0) {
            preloadCarriots(pp.carriots);
        }
        if (pp.conteo_draft && Object.keys(conteoActuals).length === 0) {
            preloadActuals(pp.conteo_draft);
        }
        if (pp.conteo_photos_draft && Object.keys(conteoPhotos).length === 0) {
            preloadPhotos(pp.conteo_photos_draft);
        }
        if (pp.extra_conteo_targets?.length > 0 && extraConteoTargets.length === 0) {
            setExtraConteoTargets(pp.extra_conteo_targets);
        }
        // Restore PESAJE_BATCH photos & lot selections
        if (pp.weighing_photos && Object.keys(weighingPhotos).length === 0) {
            setWeighingPhotos(pp.weighing_photos);
        }
        if (pp.lot_selections && Object.keys(lotSelections).length === 0) {
            const restored = {};
            Object.entries(pp.lot_selections).forEach(([itemId, lotId]) => {
                if (lotId) restored[itemId] = [{ lotId }];
            });
            if (Object.keys(restored).length > 0) setLotSelections(restored);
        }
    }, [note?.id]); // eslint-disable-line

    // ── Restore empaque reception state from processParameters (survive F5) ─
    useEffect(() => {
        if (!note) return;
        const pp = note.processParameters;
        if (pp?.empaque_reception_confirmed) {
            setEmpaqueReceptionConfirmed(true);
        }
        if (pp?.reception_photos && Object.keys(pp.reception_photos).length > 0) {
            setSavedReceptionPhotos(pp.reception_photos);
        }
    }, [note?.id]); // eslint-disable-line

    // ── Bind noteId + restore empaque QC draft from processParameters (survive screen-lock / F5) ─
    useEffect(() => {
        if (!note?.id) return;
        setEmpaqueNoteId(note.id);
        const draft = note.processParameters?.empaque_draft;
        if (draft && draft.defective_qty > 0) {
            restoreEmpaqueDraft(draft);
        }
    }, [note?.id]); // eslint-disable-line

    // ── Auto-complete invisible para ENSAMBLE de PROTECCION/PREMEZCLA ─
    // Si el operario aterriza en una nota ENSAMBLE de un producto cuyo
    // cierre Siigo no requiere su intervención, la completamos en backend
    // y avanzamos a la siguiente etapa (o cierre del bache) sin mostrar UI.
    useEffect(() => {
        if (!note?.id || note.status === 'COMPLETED') return;
        const productNameUpper = (note.product?.name || '').toUpperCase();
        const isAutoCloseProduct = productNameUpper.startsWith('PROTECCION') ||
                                    productNameUpper.startsWith('PREMEZCLA') ||
                                    productNameUpper.startsWith('PROTONICO') ||
                                    productNameUpper.startsWith('ALGINATO PREPARADO') ||
                                    productNameUpper.startsWith('BASE LIQUIPOPS') ||
                                    productNameUpper.startsWith('COMPUESTO');
        const isEnsambleNote = note.processType?.code === 'ENSAMBLE';
        if (!isAutoCloseProduct || !isEnsambleNote) return;

        let cancelled = false;
        (async () => {
            try {
                if (note.status === 'PENDING') {
                    await api.post(`/assembly-notes/${note.id}/start`, { operatorId: user?.id });
                }
                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: note.targetQuantity,
                    observations: 'Auto-completado (ENSAMBLE invisible)'
                });
                if (cancelled) return;
                const batchId = note.productionBatchId;
                const refreshed = await api.get(`/assembly-notes?batchId=${batchId}`);
                const fresh = refreshed.data || [];
                const nextNote = fresh.find(n => n.stageOrder > note.stageOrder && n.status !== 'COMPLETED');
                if (cancelled) return;
                if (nextNote) {
                    message.info(`Avanzando a Etapa ${nextNote.stageOrder}: ${nextNote.stageName}`);
                    setTimeout(() => {
                        navigate(`/assembly-execution/${nextNote.id}`, { replace: true });
                        window.location.reload();
                    }, 800);
                } else {
                    message.success('🎉 ¡Bache completado!');
                    setShowCompletionPanel(true);
                }
            } catch (e) {
                console.warn('[ENSAMBLE invisible auto-complete on mount]', e.response?.data?.error || e.message);
            }
        })();
        return () => { cancelled = true; };
    }, [note?.id]); // eslint-disable-line

    // ── Debounced auto-save for conteo actuals & photos (survive F5/logout) ──
    const saveConteoDraftTimeout = useRef(null);
    useEffect(() => {
        if (!note?.id || submitting) {
            if (saveConteoDraftTimeout.current) clearTimeout(saveConteoDraftTimeout.current);
            return;
        }
        // Skip if everything is empty to avoid overwriting on initial mount
        if (Object.keys(conteoActuals).length === 0 && Object.keys(conteoPhotos).length === 0) return;

        if (saveConteoDraftTimeout.current) clearTimeout(saveConteoDraftTimeout.current);
        saveConteoDraftTimeout.current = setTimeout(async () => {
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        conteo_draft: conteoActuals,
                        conteo_photos_draft: conteoPhotos,
                        extra_conteo_targets: extraConteoTargets.length > 0 ? extraConteoTargets : undefined
                    }
                });
                if (note.processParameters) {
                    note.processParameters.conteo_draft = conteoActuals;
                    note.processParameters.conteo_photos_draft = conteoPhotos;
                    if (extraConteoTargets.length > 0) note.processParameters.extra_conteo_targets = extraConteoTargets;
                }
            } catch (e) {
                console.warn('Error saving conteo draft:', e.message);
            }
        }, 1500); // 1.5s debounce
        return () => clearTimeout(saveConteoDraftTimeout.current);
    }, [conteoActuals, conteoPhotos, extraConteoTargets, note?.id, submitting]); // eslint-disable-line

    // ── Debounced auto-save para PESAJE — funciona tanto para INPUT (uno-a-uno) como PESAJE_BATCH ──
    // Persiste actualQuantity, lotNumber, photo y lot_selections cada vez que cambian (debounce 2s),
    // sin esperar a "Confirmar". Si el operario sale o recarga, los datos quedan guardados.
    const savePesajeDraftTimeout = useRef(null);
    useEffect(() => {
        if (!note?.id || submitting) {
            if (savePesajeDraftTimeout.current) clearTimeout(savePesajeDraftTimeout.current);
            return;
        }
        const currentStep = wizardSteps[currentStepIndex];
        if (!currentStep) return;

        // Determinar items a guardar según el tipo de step
        let batchItems = [];
        if (currentStep.type === 'PESAJE_BATCH') {
            batchItems = currentStep.data || [];
        } else if (currentStep.type === 'INPUT' && currentStep.data?.id) {
            batchItems = [currentStep.data];
        } else {
            return;
        }

        const hasAnyData = batchItems.some(item =>
            (actualQuantities[item.id] !== undefined && actualQuantities[item.id] !== '') ||
            lotNumbers[item.id]?.trim() ||
            weighingPhotos[item.id] ||
            (lotSelections[item.id] && lotSelections[item.id].length > 0)
        );
        if (!hasAnyData) return;

        if (savePesajeDraftTimeout.current) clearTimeout(savePesajeDraftTimeout.current);
        savePesajeDraftTimeout.current = setTimeout(async () => {
            try {
                for (const item of batchItems) {
                    const qty = actualQuantities[item.id];
                    const lot = lotNumbers[item.id];
                    if ((qty !== undefined && qty !== '') || lot?.trim()) {
                        await api.patch(`/assembly-notes/${note.id}/items/${item.id}`, {
                            actualQuantity: parseFloat(qty) || 0,
                            lotNumber: lot || null,
                            operatorId: user?.id
                        }).catch(() => {});
                    }
                }
                const updatedParams = { ...(note.processParameters || {}) };
                const allPhotos = { ...(updatedParams.weighing_photos || {}) };
                const allLotSel = { ...(updatedParams.lot_selections || {}) };
                batchItems.forEach(item => {
                    if (weighingPhotos[item.id]) allPhotos[item.id] = weighingPhotos[item.id];
                    const itemSel = lotSelections[item.id];
                    if (itemSel?.length > 0) allLotSel[item.id] = itemSel[0]?.lotId || null;
                });
                updatedParams.weighing_photos = allPhotos;
                updatedParams.lot_selections = allLotSel;
                await api.patch(`/assembly-notes/${note.id}`, { processParameters: updatedParams }).catch(() => {});
                if (note.processParameters) {
                    note.processParameters.weighing_photos = allPhotos;
                    note.processParameters.lot_selections = allLotSel;
                }
                console.log(`[${currentStep.type}] Auto-saved draft (${batchItems.length} item${batchItems.length > 1 ? 's' : ''})`);
            } catch (e) {
                console.warn(`[${currentStep.type}] Error saving draft:`, e.message);
            }
        }, 2000);
        return () => clearTimeout(savePesajeDraftTimeout.current);
    }, [actualQuantities, lotNumbers, weighingPhotos, lotSelections, currentStepIndex, note?.id, submitting]); // eslint-disable-line

    // ── Handlers: carrito production side (CONTEO step) ──────────────────────
    const handleAddCarrito = useCallback(async (productId, productName, qty) => {
        // Capture current carriots BEFORE async state update
        const carriotosBefore = carriots;
        const newEntry = addCarritoLocal(productId, productName, qty);
        // Use captured local state + new entry — avoids stale note.processParameters
        try {
            const allCarriots = [...carriotosBefore, newEntry];
            await api.patch(`/assembly-notes/${note.id}`, {
                processParameters: {
                    ...note.processParameters,
                    carriots: allCarriots,
                }
            });
            message.success(`🛒 Carrito #${newEntry.carritoNum} registrado — ${qty} uds de ${productName}`);
        } catch (e) {
            console.warn('Error saving carrito:', e.message);
        }
    }, [note, carriots, addCarritoLocal]);

    const handleRemoveCarrito = useCallback(async (carritoId) => {
        removeCarritoLocal(carritoId);
        try {
            // Use current carriots state to avoid stale reads
            const remaining = carriots.filter(c => c.id !== carritoId);
            await api.patch(`/assembly-notes/${note.id}`, {
                processParameters: { ...note.processParameters, carriots: remaining }
            });
        } catch (e) { console.warn('Error removing carrito:', e.message); }
    }, [note, carriots, removeCarritoLocal]);

    // ── Handlers: empaque reception side (EMPAQUE step) ──────────────────────
    // Find CONTEO note from allBatchNotes to read its carriots
    const conteoNote = allBatchNotes?.find(n => n.processType?.code === 'CONTEO' || n.stageName?.toLowerCase().includes('conteo'));

    const handleConfirmCarrito = useCallback(async (carritoId, ncQty = 0, ncCause = '') => {
        // Fallback: when packaging role opens the CONTEO note directly, conteoNote = note itself
        const targetNote = conteoNote || note;
        if (!targetNote) return;
        const updated = (empaqueCarriots.length > 0 ? empaqueCarriots : targetNote.processParameters?.carriots || []).map(c =>
            c.id === carritoId ? { ...c, receivedAt: new Date().toISOString(), ncQty: ncQty || 0, ncCause: ncCause || '' } : c
        );
        setEmpaqueCarriots(updated);
        try {
            await api.patch(`/assembly-notes/${targetNote.id}`, {
                processParameters: { ...targetNote.processParameters, carriots: updated }
            });
            message.success(`✅ Carrito recibido${ncQty > 0 ? ` — ${ncQty} NC registradas` : ''}`);
        } catch (e) { console.warn('Error confirming carrito:', e.message); }
    }, [conteoNote, note, empaqueCarriots]);

    // ── Polling: re-fetch carriots every 20s when on EMPAQUE step OR packaging role on CONTEO ──
    useEffect(() => {
        const currentStep = wizardSteps[currentStepIndex];
        const isPackaging = ['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role);
        // Run polling on EMPAQUE step, OR when packaging role views any step (e.g. CONTEO)
        if (currentStep?.type !== 'EMPAQUE' && !isPackaging) return;
        if (!note?.productionBatchId) return;

        // Immediate preload: if we're packaging role on the CONTEO note itself,
        // the carriots are already in note.processParameters — use them right away
        if (isPackaging && note?.processParameters?.carriots?.length > 0 && empaqueCarriots.length === 0) {
            setEmpaqueCarriots(note.processParameters.carriots);
        }

        // Async refresh from server (also runs every 20s)
        const loadCarriots = async () => {
            try {
                const batchNotes = await api.get(`/assembly-notes?batchId=${note.productionBatchId}`);
                const cNote = batchNotes.data.find(n => n.processType?.code === 'CONTEO');
                if (cNote?.processParameters?.carriots) {
                    setEmpaqueCarriots(cNote.processParameters.carriots);
                }
            } catch (e) { /* silent */ }
        };
        loadCarriots();
        const interval = setInterval(loadCarriots, 20000);
        return () => clearInterval(interval);
    }, [currentStepIndex, wizardSteps, note?.productionBatchId, user?.role]); // eslint-disable-line


    // Auto-advance past INTRO when arriving with ?skipIntro=1 (from empaque selector or other)
    useEffect(() => {
        if (!skipIntroParam || !note || wizardSteps.length === 0) return;

        const currentStep = wizardSteps[currentStepIndex];
        if (currentStep?.type === 'INTRO') {
            const isEmpaqueProcess = note.processType?.code === 'EMPAQUE';
            // For EMPAQUE, jump directly to the EMPAQUE step (past auto-processed INPUTs)
            const targetIdx = isEmpaqueProcess
                ? wizardSteps.findIndex(s => s.type === 'EMPAQUE') || 1
                : 1;

            // If note is PENDING, auto-start it first
            if (note.status === 'PENDING') {
                (async () => {
                    try {
                        setSubmitting(true);
                        await api.post(`/assembly-notes/${note.id}/start`, { operatorId: user?.id });
                        const refreshed = await api.get(`/assembly-notes/${note.id}`);
                        setNote(refreshed.data);
                        message.success('Materiales consumidos — Proceso iniciado');
                        setCurrentStepIndex(targetIdx);
                        saveWizardStep(targetIdx);
                        navigate(`/assembly-execution/${id}`, { replace: true });
                    } catch (e) {
                        const errMsg = e.response?.data?.error || e.message;
                        if (errMsg.includes('BLOQUEADO')) {
                            showZoneBlockedModal(errMsg);
                        } else {
                            message.error(`Error al iniciar: ${errMsg}`);
                        }
                    } finally {
                        setSubmitting(false);
                    }
                })();
            } else {
                // Already executing, just advance
                setCurrentStepIndex(targetIdx);
                saveWizardStep(targetIdx);
                navigate(`/assembly-execution/${id}`, { replace: true });
            }
        }
    }, [skipIntroParam, note, wizardSteps]);

    // ── Auto-advance EMPAQUE INPUT steps (operator doesn't interact) ─────────
    // When auto-assignment fills weight + lot for EMPAQUE items, skip past them
    const autoAdvanceRef = useRef(null);
    useEffect(() => {
        if (!note || wizardSteps.length === 0) return;
        const isEmpaqueProcess = note.processType?.code === 'EMPAQUE';
        if (!isEmpaqueProcess) return;

        const currentStep = wizardSteps[currentStepIndex];
        if (currentStep?.type !== 'INPUT') return;

        const itemId = currentStep.data?.id;
        if (!itemId) return;

        const hasWeight = actualQuantities[itemId] !== undefined && actualQuantities[itemId] !== '';
        const lotVal = lotNumbers[itemId];
        const hasLot = typeof lotVal === 'string' && lotVal.trim().length > 0;

        if (hasWeight && hasLot && !submitting) {
            // Avoid double-firing for same step
            if (autoAdvanceRef.current === `${currentStepIndex}-${itemId}`) return;
            autoAdvanceRef.current = `${currentStepIndex}-${itemId}`;

            const timer = setTimeout(() => {
                handleNext();
            }, 600);
            return () => clearTimeout(timer);
        }
    }, [currentStepIndex, wizardSteps, note, actualQuantities, lotNumbers, submitting]);

    // ── Siigo RPA helper ─────────────────────────────────────────────────────
    const resolveEnsambleQty = async (noteData, targetQty) => {
        const qtySource = noteData.processParameters?.qty_source;
        const qtyField = noteData.processParameters?.qty_field;

        // For ENSAMBLE, try to get unit count from conteo or output targets
        try {
            const allNotesRes = await api.get(`/assembly-notes?batchId=${noteData.productionBatchId}`);
            const conteoNote = allNotesRes.data.find(n => n.processType?.code === 'CONTEO' && n.status === 'COMPLETED');

            if (qtySource === 'conteo' && conteoNote?.processParameters) {
                const params = conteoNote.processParameters;
                if (qtyField === 'esferas_total' && params.esferas_total) {
                    return params.esferas_total;
                } else if (qtyField === 'tarros_by_product' && params.conteo) {
                    const productId = noteData.processParameters?.product_id || noteData.outputProductId;
                    const entry = Object.values(params.conteo).find(c => c.productId === productId);
                    if (entry?.actual) return entry.actual;
                }
            }

            // Auto-resolve from conteo by matching product
            if (conteoNote?.processParameters?.conteo) {
                const productId = noteData.productId;
                const entry = Object.values(conteoNote.processParameters.conteo).find(c => c.productId === productId);
                if (entry?.actual) return entry.actual;
            }

            // ── EMPAQUE fallback (SIROPES without CONTEO) ──
            // "No se ensambla lo que se programa, se ensambla lo que sale real"
            // Check completed EMPAQUE notes for actual approved quantities
            const empaqueNote = allNotesRes.data.find(n =>
                n.processType?.code === 'EMPAQUE' && n.status === 'COMPLETED' &&
                n.productId === noteData.productId
            );
            if (empaqueNote?.processParameters) {
                const empParams = empaqueNote.processParameters;
                // Priority 1: empaque.approved_qty (set by handleComplete for EMPAQUE)
                const approvedQty = empParams.empaque?.approved_qty;
                if (approvedQty && approvedQty > 0) return approvedQty;
                // Priority 2: empaque.conteo_qty (set by handleComplete)
                const empConteoQty = empParams.empaque?.conteo_qty;
                if (empConteoQty && empConteoQty > 0) return empConteoQty;
                // Priority 3: empaqueRef.conteo_qty (manual conteo for siropes, set in IntroStep)
                const conteoQty = empParams.empaqueRef?.conteo_qty;
                if (conteoQty && conteoQty > 0) return conteoQty;
            }

            // ── PREMIX / INTERMEDIATE fallback (no CONTEO, no EMPAQUE) ──
            // For batches without CONTEO or EMPAQUE (premixes, protecciones, intermedios),
            // targetQuantity was correctly calculated by quickStart from the formula.
            // Using it directly avoids picking up wrong values from preceding stages
            // (e.g. COCCION actual=1 lote instead of the real gram quantity).
            const hasConteo = allNotesRes.data.some(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code) && n.status === 'COMPLETED');
            const hasEmpaque = allNotesRes.data.some(n => ['EMPAQUE', 'G_EMPAQUE'].includes(n.processType?.code) && n.status === 'COMPLETED');
            if (!hasConteo && !hasEmpaque && noteData.targetQuantity > 0) {
                return noteData.targetQuantity;
            }

            // Last resort: output targets (planned units) — WARNING: these are programmed, not actual
            const outputTargets = noteData.productionBatch?.outputTargets || [];
            const stageName = (noteData.stageName || '').toLowerCase();
            const nums = (stageName.match(/\d{3,}/g) || []);
            const matchedTarget = outputTargets.find(t =>
                nums.some(n => (t.product?.name || '').toLowerCase().includes(n))
            ) || (outputTargets.length === 1 ? outputTargets[0] : null);
            if (matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
        } catch (e) {
            console.warn('Could not look up CONTEO/target data:', e.message);
        }

        return parseFloat(targetQty) || noteData.targetQuantity || 1;
    };

    // ── handleNext ───────────────────────────────────────────────────────────
    const handleNext = async () => {
        if (submitting) return;
        const currentStep = wizardSteps[currentStepIndex];

        // INTRO → Start note (consume materials)
        if (currentStep.type === 'INTRO' && note.status === 'PENDING') {
            try {
                setSubmitting(true);
                await api.post(`/assembly-notes/${note.id}/start`, { operatorId: user?.id });
                message.success('Materiales consumidos — Proceso iniciado');
                const refreshed = await api.get(`/assembly-notes/${note.id}`);
                setNote(refreshed.data);
            } catch (e) {
                const errMsg = e.response?.data?.error || e.message;
                if (errMsg.includes('BLOQUEADO')) {
                    showZoneBlockedModal(errMsg);
                } else {
                    message.error(`Error al iniciar: ${errMsg}`);
                }
                return;
            } finally {
                setSubmitting(false);
            }
        }

        // INPUT → Save actual weight + lot number + optional weighing photo
        if (currentStep.type === 'INPUT') {
            const item = currentStep.data;
            const actualQty = actualQuantities[item.id];

            // ── REQUIRED PHOTO VALIDATION ──
            const savedPhoto = note.processParameters?.weighing_photos?.[item.id];
            const localPhoto = weighingPhotos[item.id];
            if (!savedPhoto && !localPhoto) {
                message.error('⚠️ Debe tomar la foto de evidencia del pesaje antes de continuar');
                return;
            }

            // ── Hard lot validation (belt-and-suspenders) ──
            if (!lotNumbers[item.id]?.trim()) {
                message.error('⚠️ Debe seleccionar un LOTE del insumo antes de continuar');
                return;
            }
            // If multi-lot selections exist, verify coverage (skip for EMPAQUE — auto-assigned)
            const isEmpaqueInput = note?.processType?.code === 'EMPAQUE';
            const itemLotSel = lotSelections[item.id] || [];
            if (itemLotSel.length > 0 && !isEmpaqueInput) {
                const totalCov = itemLotSel.reduce((s, sel) => s + (sel.qty || 0), 0);
                const plannedQty = item.plannedQuantity || 0;
                if (plannedQty > 0 && totalCov < plannedQty * 0.97) {
                    message.error(`⚠️ Cobertura de lote insuficiente: ${totalCov.toLocaleString()} de ${plannedQty.toLocaleString()} requeridos`);
                    return;
                }
            }
            if (actualQty !== undefined && actualQty !== '') {
                try {
                    await api.patch(`/assembly-notes/${note.id}/items/${item.id}`, {
                        actualQuantity: parseFloat(actualQty),
                        lotNumber: lotNumbers[item.id] || null,
                        operatorId: user?.id
                    });
                    // Build consolidated process parameters payload to prevent racing/overwriting
                    const updatedParams = { ...(note.processParameters || {}) };
                    let needsPatch = false;

                    // Save weighing photo if present
                    const photoUrl = weighingPhotos[item.id];
                    if (photoUrl) {
                        updatedParams.weighing_photos = {
                            ...(updatedParams.weighing_photos || {}),
                            [item.id]: photoUrl
                        };
                        needsPatch = true;
                    }

                    // ── Persist lot selections to processParameters (survive page refresh) ──
                    const currentLotSel = lotSelections[item.id];
                    const currentLotId = selectedLotIds[item.id];
                    if (currentLotSel?.length > 0 || currentLotId) {
                        updatedParams.lot_selections = {
                            ...(updatedParams.lot_selections || {}),
                            [item.id]: currentLotId || currentLotSel?.[0]?.lotId || null
                        };
                        needsPatch = true;
                    }

                    if (needsPatch) {
                        await api.patch(`/assembly-notes/${note.id}`, {
                            processParameters: updatedParams
                        }).catch(() => { });
                        // Keep local note in sync
                        note.processParameters = updatedParams;
                    }
                    // Lot consumption is deferred to handleComplete (batch consume on finalize)
                } catch (e) {
                    console.warn('Error saving actual qty:', e);
                }
            }
        }

        // PESAJE_BATCH → Save all items' weight + lot + photos at once
        if (currentStep.type === 'PESAJE_BATCH') {
            const batchItems = currentStep.data || [];
            for (const item of batchItems) {
                const actualQty = actualQuantities[item.id];
                const nameU = (item.component?.name || '').toUpperCase();
                const isAgua = nameU.includes('AGUA');
                const isIntermediate = nameU.startsWith('BASE ') ||
                    nameU.startsWith('ALGINATO PREPARADO') ||
                    nameU.startsWith('COMPUESTO') ||
                    nameU.startsWith('PROTECCION') ||
                    nameU.startsWith('PREMEZCLA') ||
                    nameU.startsWith('PROTONICO') ||
                    nameU.startsWith('SABORIZACION');

                const savedPhoto = note.processParameters?.weighing_photos?.[item.id];
                const localPhoto = weighingPhotos[item.id];
                if (!isAgua && !isIntermediate && !savedPhoto && !localPhoto) {
                    message.error(`⚠️ Falta foto de evidencia para: ${item.component?.name || 'ingrediente'}`);
                    return;
                }
                if (!lotNumbers[item.id]?.trim()) {
                    message.error(`⚠️ Falta lote para: ${item.component?.name || 'ingrediente'}`);
                    return;
                }
                if (!actualQty || actualQty === '') {
                    message.error(`⚠️ Falta peso para: ${item.component?.name || 'ingrediente'}`);
                    return;
                }
                const planned = item.plannedQuantity || 0;
                const actual = parseFloat(actualQty) || 0;
                if (planned > 0 && actual < planned * 0.80) {
                    message.error(`⚠️ ${item.component?.name}: peso muy por debajo del requerido (${actual.toLocaleString()} de ${planned.toLocaleString()} g)`);
                    return;
                }

                try {
                    await api.patch(`/assembly-notes/${note.id}/items/${item.id}`, {
                        actualQuantity: parseFloat(actualQty),
                        lotNumber: lotNumbers[item.id] || null,
                        operatorId: user?.id
                    });
                } catch (e) {
                    console.warn(`Error saving item ${item.id}:`, e);
                }
            }

            // Persist all photos and lot selections
            const updatedParams = { ...(note.processParameters || {}) };
            const allPhotos = { ...(updatedParams.weighing_photos || {}) };
            const allLotSel = { ...(updatedParams.lot_selections || {}) };
            batchItems.forEach(item => {
                if (weighingPhotos[item.id]) allPhotos[item.id] = weighingPhotos[item.id];
                const itemSel = lotSelections[item.id];
                if (itemSel?.length > 0) allLotSel[item.id] = itemSel[0]?.lotId || null;
            });
            updatedParams.weighing_photos = allPhotos;
            updatedParams.lot_selections = allLotSel;

            try {
                await api.patch(`/assembly-notes/${note.id}`, { processParameters: updatedParams }).catch(() => {});
                note.processParameters = updatedParams;
            } catch (e) {}
            message.success('✅ Todos los ingredientes pesados correctamente');
        }

        // ADICION_BATCH → Validate all ingredients confirmed before advancing
        if (currentStep.type === 'ADICION_BATCH') {
            if (!adicionData?.allConfirmed) {
                message.error('⚠️ Debe adicionar todos los ingredientes antes de continuar');
                return;
            }
            message.success('✅ Todos los ingredientes adicionados a la olla');
        }

        // ── EMPAQUE QC → persist defective data before advancing to MARCADO_CAJAS ──
        if (currentStep.type === 'EMPAQUE' && note.processType?.code === 'EMPAQUE') {
            const empData = note.empaqueData || {};
            const conteoQty =
                empData.conteo_qty
                ?? note.processParameters?.empaqueRef?.conteo_qty
                ?? note.targetQuantity
                ?? 0;
            const defectivos = parseInt(empaqueDefective || 0, 10);
            const aprobados = Math.max(0, conteoQty - defectivos);

            // Validate: every defective jar must have a cause selected
            if (defectivos > 0) {
                const missingCauses = Array.from({ length: defectivos }).filter((_, i) => !empaqueDefectReasons[i]?.cause);
                if (missingCauses.length > 0) {
                    message.error(`⚠️ Debe seleccionar la causa del defecto para ${missingCauses.length === 1 ? 'el tarro defectuoso' : `los ${missingCauses.length} tarros defectuosos`}`);
                    return;
                }
            }

            // Persist empaque QC data (survive F5/logout)
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        empaque: {
                            conteo_qty: conteoQty,
                            defective_qty: defectivos,
                            approved_qty: aprobados,
                            photo_urls: empaquePhotoUrls,
                            defect_reasons: empaqueDefectReasons,
                        }
                    }
                });
                // Keep local note in sync
                if (note.processParameters) {
                    note.processParameters.empaque = {
                        conteo_qty: conteoQty, defective_qty: defectivos,
                        approved_qty: aprobados, photo_urls: empaquePhotoUrls,
                        defect_reasons: empaqueDefectReasons,
                    };
                }
                message.success(`✅ QC guardado — ${aprobados} buenas, ${defectivos} defectuosas`);
            } catch (e) {
                console.warn('Error persisting empaque QC:', e.message);
            }
        }

        // IMPRESION_LOTE → block until printed
        if (currentStep.type === 'IMPRESION_LOTE') {
            if (!printLotData.printed) {
                Modal.warning({
                    title: 'Debes imprimir la etiqueta',
                    content: 'No puedes avanzar sin imprimir la etiqueta del lote primero. Presiona el botón "Imprimir Etiqueta" antes de continuar.',
                    okText: 'Entendido',
                });
                return;
            }
        }

        // MARCADO_CAJAS → save box data to processParameters before advancing
        // Auto-ingest is now deferred to ENSAMBLE step (handleComplete)
        if (currentStep.type === 'MARCADO_CAJAS') {
            if (marcadoCajas.isValid === false) {
                message.error(`🚫 ${marcadoCajas.invalidReason || 'La distribución de cajas no es válida. Revisa destino y cantidades.'}`);
                return;
            }
            const isEmpaqueProcess = note.processType?.code === 'EMPAQUE';
            if (isEmpaqueProcess && !marcadoCajas.printed && marcadoCajas.totalCajas > 0) {
                Modal.warning({
                    title: 'Debes imprimir las etiquetas',
                    content: 'No puedes avanzar sin imprimir las etiquetas primero. Presiona el botón de imprimir antes de continuar.',
                    okText: 'Entendido',
                });
                return;
            }
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        marcado_cajas: {
                            unidades_por_caja: marcadoCajas.unidadesPorCaja,
                            cajas_llenas: marcadoCajas.cajasLlenas,
                            unidades_sueltas: marcadoCajas.unidadesSueltas,
                            total_cajas: marcadoCajas.totalCajas,
                            ingest_total: marcadoCajas.ingestTotal || (marcadoCajas.totalCajas * marcadoCajas.unidadesPorCaja),
                            contramuestra_qty: marcadoCajas.contramuestraQty || 0,
                            maquila_qty: marcadoCajas.maquilaQty || 0,
                            destino: marcadoCajas.destino || null,
                            etiquetas_impresas: marcadoCajas.printed || false,
                            lote: note.productionBatch?.batchNumber,
                            fecha_marcado: new Date().toISOString(),
                        }
                    }
                });
                // Keep local note in sync
                if (note.processParameters) {
                    note.processParameters.marcado_cajas = {
                        unidades_por_caja: marcadoCajas.unidadesPorCaja,
                        cajas_llenas: marcadoCajas.cajasLlenas,
                        unidades_sueltas: marcadoCajas.unidadesSueltas,
                        total_cajas: marcadoCajas.totalCajas,
                        ingest_total: marcadoCajas.ingestTotal || (marcadoCajas.totalCajas * marcadoCajas.unidadesPorCaja),
                        contramuestra_qty: marcadoCajas.contramuestraQty || 0,
                        maquila_qty: marcadoCajas.maquilaQty || 0,
                        destino: marcadoCajas.destino || null,
                        etiquetas_impresas: marcadoCajas.printed || false,
                        lote: note.productionBatch?.batchNumber,
                    };
                }
                message.success(`📦 Marcado guardado — ${marcadoCajas.cajasLlenas || 0} cajas llenas y ${marcadoCajas.unidadesSueltas || 0} uds sueltas`);

                // ── Pending Box management ──
                // Delete old pending box if it was completed or discarded
                if (marcadoCajas.pendingBox && (marcadoCajas.pendingBoxFill > 0 || !marcadoCajas.pendingBox)) {
                    try {
                        await api.delete(`/finished-lots/pending-box/${marcadoCajas.pendingBox.id}`);
                        console.log('[MarcadoCajas] Deleted completed pending box');
                    } catch (e) { console.warn('[MarcadoCajas] Delete pending box:', e.message); }
                }
                // Create new pending box if there are partial units remaining
                const newPartial = Number(marcadoCajas.unidadesSueltas) || 0;
                if (newPartial > 0 && note.productId && marcadoCajas.unidadesPorCaja > 0) {
                    try {
                        await api.post('/finished-lots/pending-box', {
                            productId: note.productId,
                            boxSize: marcadoCajas.unidadesPorCaja,
                            entries: [{
                                lot: note.productionBatch?.batchNumber || '',
                                qty: newPartial,
                                expiry: note.productionBatch?.expiresAt || null,
                            }],
                        });
                        console.log(`[MarcadoCajas] Created new pending box: ${newPartial}/${marcadoCajas.unidadesPorCaja}`);
                    } catch (e) { console.warn('[MarcadoCajas] Create pending box:', e.message); }
                }
            } catch (e) {
                console.warn('Error guardando marcado de cajas:', e.message);
                // Non-blocking — continue anyway
            }
        }

        // ── ADMIN RE-EDIT: if note is already COMPLETED, save was enough — don't advance to ENSAMBLE ──
        if (currentStep.type === 'MARCADO_CAJAS' && note.status === 'COMPLETED') {
            message.success('✅ Datos de empaque actualizados (re-edición Admin)');
            // Navigate back to batch empaque selector
            const parentEmpaqueId = allBatchNotes?.find(n =>
                n.processType?.code === 'EMPAQUE' && n.id !== note.id
            )?.id || note.id;
            setTimeout(() => navigate('/production/operator'), 1200);
            return;
        }

        // AGUA (flujo PROTECCION) → save llenado data to processParameters
        if (currentStep.type === 'AGUA') {
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        agua_llenado: {
                            startedAt: aguaData?.startedAt,
                            endedAt: aguaData?.endedAt,
                            durationMin: aguaData?.durationMin,
                            completedAt: new Date().toISOString()
                        }
                    }
                });
                message.success(`🚰 Llenado de agua registrado (${aguaData?.durationMin || 0} min)`);
            } catch (e) {
                console.warn('Error guardando llenado de agua:', e.message);
            }
        }

        // COCCION → save temperature + photo data to processParameters
        if (currentStep.type === 'COCCION') {
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        coccion_result: {
                            ...(note.processParameters?.coccion_result || {}),
                            realTemperature: coccionData?.realTemperature,
                            targetTemperature: coccionData?.targetTemperature,
                            photoUrl: coccionData?.photoUrl,
                            timerCompleted: coccionData?.timerCompleted,
                            completedAt: new Date().toISOString()
                        }
                    }
                });
                message.success(`🌡️ Temperatura registrada: ${coccionData?.realTemperature}°C`);
            } catch (e) {
                console.warn('Error guardando cocción:', e.message);
            }
            // Reset for next coccion step
            setCoccionData(null);
        }

        // MEDICION → save measurement data
        if (currentStep.type === 'MEDICION') {
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        medicion_result: {
                            values: medicionData?.values,
                            photos: medicionData?.photos,
                            completedAt: new Date().toISOString()
                        }
                    }
                });
                const labels = Object.entries(medicionData?.values || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
                message.success(`🧪 Mediciones registradas: ${labels}`);
            } catch (e) {
                console.warn('Error guardando medición:', e.message);
            }
            setMedicionData(null);
        }


        // ENSAMBLE → RPA now fires from backend completeNote (lot concordance)

        if (currentStepIndex < wizardSteps.length - 1) {
            const nextIdx = currentStepIndex + 1;
            setCurrentStepIndex(nextIdx);
            saveWizardStep(nextIdx); // persist so user can resume here
        }
    };

    const handlePrev = () => {
        if (currentStepIndex > 0) {
            let prevIdx = currentStepIndex - 1;
            // In EMPAQUE, skip past INPUT steps (they were auto-processed)
            const isEmpaqueProcess = note?.processType?.code === 'EMPAQUE';
            if (isEmpaqueProcess) {
                while (prevIdx > 0 && wizardSteps[prevIdx]?.type === 'INPUT') {
                    prevIdx--;
                }
            }
            setCurrentStepIndex(prevIdx);
            saveWizardStep(prevIdx);
        }
    };

    // ── handleComplete ───────────────────────────────────────────────────────
    const handleComplete = async () => {
        if (submitting) return;
        try {
            setSubmitting(true);
            const currentStep = wizardSteps[currentStepIndex];

            // ADICION_BATCH → validate all additions confirmed before completing
            if (currentStep?.type === 'ADICION_BATCH') {
                if (!adicionData?.allConfirmed) {
                    message.error('⚠️ Debe adicionar todos los ingredientes antes de finalizar');
                    setSubmitting(false);
                    return;
                }
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: { ...note.processParameters, adicion_completed: true, adicion_completed_at: new Date().toISOString() }
                }).catch(() => {});
            }

            // Validate REAL PRODUCIDO is filled for OUTPUT (verification) steps
            if (currentStep?.type === 'OUTPUT') {
                if (!outputQuantity || parseFloat(outputQuantity) <= 0) {
                    alert('⚠️ Debe ingresar la cantidad real producida antes de finalizar');
                    setSubmitting(false);
                    return;
                }
                // Save QC data to processParameters
                if (qcData) {
                    await api.patch(`/assembly-notes/${note.id}`, {
                        processParameters: {
                            ...note.processParameters,
                            qc_result: {
                                values: qcData.values,
                                photos: qcData.photos,
                                sensoryChecks: qcData.sensoryChecks,
                                temperature: qcData.temperature,
                                verificationPhoto: qcData.verificationPhoto,
                                completedAt: new Date().toISOString()
                            }
                        }
                    }).catch(() => { });
                }
                // Save Formacion QC data if present
                if (formacionQcData) {
                    const { isComplete, ...qcPayload } = formacionQcData;
                    await api.patch(`/assembly-notes/${note.id}`, {
                        processParameters: {
                            ...note.processParameters,
                            formacion_qc: { ...qcPayload, completedAt: new Date().toISOString() }
                        }
                    }).catch(() => { });
                }
                // Save Esferificacion timer data if present
                if (esferificacionData) {
                    const { isComplete: _ic, ...timerPayload } = esferificacionData;
                    await api.patch(`/assembly-notes/${note.id}`, {
                        processParameters: {
                            ...note.processParameters,
                            esferificacion: { ...timerPayload, completedAt: new Date().toISOString() }
                        }
                    }).catch(() => { });
                }
            }

            // COCCION → save temperature data before completing
            if (currentStep?.type === 'COCCION') {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        coccion_result: {
                            realTemperature: coccionData?.realTemperature,
                            targetTemperature: coccionData?.targetTemperature,
                            photoUrl: coccionData?.photoUrl,
                            timerCompleted: coccionData?.timerCompleted,
                            completedAt: new Date().toISOString()
                        }
                    }
                });
            }

            // MEDICION → save measurement data before completing
            if (currentStep?.type === 'MEDICION') {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        medicion_result: {
                            values: medicionData?.values,
                            photos: medicionData?.photos,
                            completedAt: new Date().toISOString()
                        }
                    }
                });
            }

            // ENSAMBLE / FORMACION → RPA now fires from backend completeNote (lot concordance)

            // ══════════════════════════════════════════════════════════════════════
            // ENSAMBLE WITHIN EMPAQUE NOTE → Final step of unified wizard
            // Fires: persist empaque data → Siigo RPA → completeNote → auto-ingest → auto-complete ENSAMBLE note
            // ══════════════════════════════════════════════════════════════════════
            if (currentStep?.type === 'ENSAMBLE' && note.processType?.code === 'EMPAQUE') {
                const empData = note.empaqueData || {};
                const emp = note.processParameters?.empaque || {};
                const conteoQty = emp.conteo_qty
                    || empData.conteo_qty
                    || note.processParameters?.empaqueRef?.conteo_qty
                    || note.targetQuantity
                    || 0;
                const defectivos = emp.defective_qty || 0;
                const aprobados = emp.approved_qty || Math.max(0, conteoQty - defectivos);
                const totalEmpaque = conteoQty; // all units (buenos + malos)

                // 1. Siigo RPA (fire-and-forget)
                if (note.processParameters?.assembly_on_complete) {
                    const productName = empData.product_name || note.product?.name || 'Producto';
                    const productSku = note.product?.sku || null;
                    (async () => {
                        try {
                            await api.post('/rpa/siigo-assembly', {
                                productName, productSku, quantity: conteoQty, assemblyType: 'proceso',
                                observations: `Empaque ${note.stageName}. Lote: ${note.productionBatch?.batchNumber || computeLotCode(productName)}. Real fabricado: ${conteoQty}. Aprobados: ${aprobados}. Defectuosos: ${defectivos}.`,
                                assemblyNoteId: note.id
                            });
                            message.success(`🤖 Siigo: ${conteoQty} × ${productName}`);
                        } catch (e) {
                            message.warning('⚠️ Siigo no disponible — proceso continúa');
                        }
                    })();
                    if (defectivos > 0) {
                        const defectReasons = emp.defect_reasons || empaqueDefectReasons;
                        const photoUrls = emp.photo_urls || empaquePhotoUrls;
                        (async () => {
                            try {
                                await api.post('/rpa/siigo-adjustment', {
                                    productName, productSku, quantity: -defectivos,
                                    reason: `Defectuosos empaque - ${note.stageName}`,
                                    photoUrls, defectReasons,
                                });
                            } catch (e) { console.warn('Adjustment skip:', e.message); }
                        })();
                    }
                }

                // 2. Complete the EMPAQUE note
                const persistedLotSelEmp = note.processParameters?.lot_selections || {};
                const mergedLotIdsEmp = { ...persistedLotSelEmp, ...selectedLotIds };
                Object.keys(mergedLotIdsEmp).forEach(k => { if (!mergedLotIdsEmp[k]) delete mergedLotIdsEmp[k]; });

                const ensambleObs = [
                    outputObservations || '',
                    `Aprobados: ${aprobados}/${conteoQty}`,
                    defectivos > 0 ? `Defectuosos: ${defectivos} — ${(emp.defect_reasons || []).map(r => r?.cause).filter(Boolean).join(', ')}` : null,
                ].filter(Boolean).join('. ');

                const completeRes = await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: totalEmpaque,
                    observations: ensambleObs,
                    lotSelections: mergedLotIdsEmp
                });
                if (completeRes.data?.consumptionAlerts?.length > 0) {
                    const alerts = completeRes.data.consumptionAlerts;
                    message.warning(`⚠️ Alerta de consumo: ${alerts.map(a => `${a.component} (esperado: ${a.expected}, consumido: ${a.consumed})`).join(', ')}`, 10);
                }

                // 3. Auto-ingest to PRODUCCION zone (all units — logistics handles NC split)
                if (totalEmpaque > 0 && note.productId) {
                    const empBatchNumber = note.productionBatch?.batchNumber
                        || allBatchNotes?.find(n => n.productionBatch?.batchNumber)?.productionBatch?.batchNumber;
                    const empBatchId = note.productionBatchId
                        || allBatchNotes?.find(n => n.productionBatchId)?.productionBatchId;
                    if (empBatchNumber) {
                        api.post('/finished-lots/ingest', {
                            productId: note.productId,
                            lotNumber: empBatchNumber,
                            quantity: totalEmpaque,
                            batchId: empBatchId || null,
                        }).then(() => {
                            message.success(`📥 Stock: ${aprobados} buenos + ${defectivos} NC = ${totalEmpaque} uds de ${note.product?.name} en PRODUCCIÓN`);
                        }).catch(ingErr => {
                            const ingMsg = ingErr.response?.data?.error || '';
                            if (!ingMsg.startsWith('DUPLICATE_INGESTION') && !ingMsg.startsWith('ASSEMBLY_INCOMPLETE')) {
                                console.error('[EMPAQUE-ENSAMBLE AUTO-INGEST]', ingMsg, { productId: note.productId, empBatchNumber, totalEmpaque });
                            }
                        });
                    }
                }

                // 4. Auto-complete the separate ENSAMBLE note (mirror note for Siigo traceability)
                // NOTE: Only Liquipops ENSAMBLE — Geniality (G_ENSAMBLE) is NOT touched here
                try {
                    const batchId = note.productionBatchId;
                    const allNotesRes2 = await api.get(`/assembly-notes?batchId=${batchId}`);
                    const ensambleNotes = (allNotesRes2.data || []).filter(n =>
                        n.id !== note.id &&
                        n.status !== 'COMPLETED' &&
                        n.processType?.code === 'ENSAMBLE' &&
                        n.productId === note.productId
                    );
                    for (const ensambleNote of ensambleNotes) {
                        try {
                            // Must START before COMPLETE (PENDING notes reject /complete)
                            if (ensambleNote.status === 'PENDING') {
                                await api.post(`/assembly-notes/${ensambleNote.id}/start`, {
                                    operatorId: user?.id
                                });
                            }
                            await api.post(`/assembly-notes/${ensambleNote.id}/complete`, {
                                operatorId: user?.id,
                                actualQuantity: totalEmpaque,
                                observations: `Auto-completado desde empaque unificado. ${ensambleObs}`
                            });
                            console.log(`[ENSAMBLE auto-complete] ✅ ${ensambleNote.id} completed`);
                            // Also trigger ingest from ENSAMBLE note for finished goods
                            const empBatchNumber2 = note.productionBatch?.batchNumber
                                || allBatchNotes?.find(n => n.productionBatch?.batchNumber)?.productionBatch?.batchNumber;
                            if (ensambleNote.productId && empBatchNumber2 && batchId) {
                                api.post('/finished-lots/ingest', {
                                    productId: ensambleNote.productId,
                                    lotNumber: empBatchNumber2,
                                    quantity: totalEmpaque,
                                    batchId,
                                }).catch(ingErr => {
                                    const ingMsg = ingErr.response?.data?.error || '';
                                    if (!ingMsg.startsWith('DUPLICATE_INGESTION')) {
                                        console.warn('[ENSAMBLE MIRROR INGEST]', ingMsg);
                                    }
                                });
                            }
                        } catch (ensambleErr) {
                            console.warn(`[ENSAMBLE auto-complete] ${ensambleNote.id}:`, ensambleErr.message);
                        }
                    }
                } catch (e) {
                    console.warn('[ENSAMBLE auto-complete scan]', e.message);
                }
            } else if (currentStep?.type === 'CONTEO') {
                // ── Packaging role finalizing CONTEO ──
                // Siigo is fired per-carrito in ConteoStep.
                // But we must still complete the CONTEO note + auto-complete ENSAMBLE
                // on the backend so productionZoneStock gets incremented.
                const isPackagingRole = ['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role);
                const usesCarritos = note.product?.name?.toUpperCase().includes('SIROPE') || 
                                     note.product?.name?.toUpperCase().includes('MASA') ||
                                     note.product?.name?.toUpperCase().includes('GENIALITY') ||
                                     note.product?.name?.toUpperCase().includes('SABORIZACION');

                if (isPackagingRole && usesCarritos) {
                    const batchId = note.productionBatchId;
                    const batchNumber = note.productionBatch?.batchNumber || '';

                    // ── 1. Calculate real total from received carriots ──
                    const receivedCarriots = empaqueCarriots.filter(c => c.receivedAt);
                    const totalRealQty = receivedCarriots.reduce((s, c) => s + (c.qty || 0), 0);

                    // ── 2. Complete the CONTEO note on the backend ──
                    try {
                        const conteoCounts = {};
                        (note.productionBatch?.outputTargets || []).forEach(t => {
                            const actualUds = receivedCarriots
                                .filter(c => c.productId === t.productId)
                                .reduce((s, c) => s + c.qty, 0);
                            conteoCounts[t.product?.name || t.productId] = {
                                productId: t.productId,
                                productName: t.product?.name,
                                planned: t.plannedUnits,
                                actual: actualUds,
                            };
                        });
                        await api.patch(`/assembly-notes/${note.id}`, {
                            processParameters: { conteo: conteoCounts }
                        }).catch(() => {});
                        await api.post(`/assembly-notes/${note.id}/complete`, {
                            operatorId: user?.id,
                            actualQuantity: totalRealQty || note.targetQuantity,
                            observations: `Empaque Liquipops — carriots recibidos: ${receivedCarriots.length}. Lote: ${batchNumber}.`
                        });
                    } catch (e) {
                        console.warn('[CONTEO complete]', e.message);
                    }

                    // ── 3. Find + auto-complete the ENSAMBLE note → triggers productionZoneStock ──
                    try {
                        const allNotesRes = await api.get(`/assembly-notes?batchId=${batchId}`);
                        const batchNotes = allNotesRes.data || [];

                        // Complete each product's ENSAMBLE note with its real carrito qty
                        const ensambleNotes = batchNotes.filter(n =>
                            n.stageOrder >= note.stageOrder &&
                            n.status !== 'COMPLETED' &&
                            (n.processType?.code === 'ENSAMBLE' || n.processType?.code === 'G_ENSAMBLE')
                        );

                        for (const ensambleNote of ensambleNotes) {
                            // Calculate how many units this ENSAMBLE note covers
                            const ensambleProductId = ensambleNote.productId;
                            const ensambleQty = ensambleProductId
                                ? receivedCarriots
                                    .filter(c => c.productId === ensambleProductId)
                                    .reduce((s, c) => s + c.qty, 0)
                                : totalRealQty;

                            const qty = ensambleQty > 0 ? ensambleQty : (ensambleNote.targetQuantity || totalRealQty);
                            if (qty <= 0) continue;

                            try {
                                await api.post(`/assembly-notes/${ensambleNote.id}/complete`, {
                                    operatorId: user?.id,
                                    actualQuantity: qty,
                                    observations: `Ensamble auto — empaque completo. Carriots: ${receivedCarriots.length}. Lote: ${batchNumber}.`
                                });
                                message.success(`📦 Stock actualizado: ${qty} uds de ${ensambleNote.product?.name || 'Producto'} en zona PRODUCCIÓN`);

                                // After completing ENSAMBLE, trigger the finished-lot ingest
                                if (ensambleNote.productId && batchNumber && batchId) {
                                    api.post('/finished-lots/ingest', {
                                        productId: ensambleNote.productId,
                                        lotNumber: batchNumber,
                                        quantity: qty,
                                        batchId,
                                    }).catch(ingErr => {
                                        const ingMsg = ingErr.response?.data?.error || '';
                                        if (!ingMsg.startsWith('DUPLICATE_INGESTION')) {
                                            console.warn('[ENSAMBLE INGEST]', ingMsg);
                                        }
                                    });
                                }
                            } catch (ensambleErr) {
                                console.warn(`[ENSAMBLE auto-complete] ${ensambleNote.id}:`, ensambleErr.message);
                            }
                        }

                        message.success('✅ Empaque completado — productos registrados en zona PRODUCCIÓN');
                        setTimeout(() => navigate('/production/operator'), 1500);
                    } catch {
                        message.success('✅ Proceso de empaque completado');
                        setTimeout(() => navigate('/production/operator'), 1200);
                    }
                    return;
                }

                // Production role completing CONTEO → save actual counts + esferas
                const esferaFactors = note.processParameters?.esfera_factors || {};
                const counts = {};
                let esferas_total = 0;
                const conteoTargets = note.productionBatch?.outputTargets || [];
                const allConteoTargets = [
                    ...conteoTargets,
                    ...extraConteoTargets.filter(et => !conteoTargets.some(t => t.productId === et.productId))
                ];
                allConteoTargets.forEach(t => {
                    const rawVal = conteoActuals[t.productId];
                    const conteoPlanned = note.processParameters?.conteo?.[t.product?.name]?.planned;
                    const lastActual = note.processParameters?.conteo?.[t.product?.name]?.actual;
                    const fallbackPlanned = t.plannedUnits > 0 ? t.plannedUnits : (conteoPlanned ?? t.plannedUnits);

                    const defaultVal = (lastActual != null && lastActual !== 0) ? lastActual : fallbackPlanned;
                    const actualStr = rawVal !== undefined && rawVal !== '' ? rawVal : defaultVal;
                    const actual = parseInt(actualStr, 10);
                    const factor = esferaFactors[t.productId] || 0;
                    const esferas = actual * factor;
                    esferas_total += esferas;
                    counts[t.product?.name || t.productId] = {
                        productId: t.productId, productName: t.product?.name,
                        planned: fallbackPlanned, actual, esfera_factor: factor, esferas,
                        ...(t._isExtra ? { isExtra: true } : {})
                    };
                });
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        conteo: counts,
                        conteo_draft: conteoActuals,
                        esferas_total,
                        conteo_photos: conteoPhotos,
                        conteo_photos_draft: conteoPhotos,
                        extra_conteo_targets: extraConteoTargets.length > 0 ? extraConteoTargets : undefined
                    }
                }).catch(() => { });

                // Use the sum of all real counted units as the actualQuantity
                const totalConteoUnits = allConteoTargets.reduce((sum, t) => {
                    const countRaw = conteoActuals[t.productId];
                    const cPlanned = note.processParameters?.conteo?.[t.product?.name]?.planned;
                    const fPlanned = t.plannedUnits > 0 ? t.plannedUnits : (cPlanned ?? t.plannedUnits);
                    return sum + parseInt(countRaw !== undefined && countRaw !== '' ? countRaw : fPlanned, 10);
                }, 0);

                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: totalConteoUnits || parseFloat(outputQuantity) || note.targetQuantity,
                    observations: outputObservations || null
                });
            } else if (currentStep?.type === 'ENSAMBLE') {
                // ENSAMBLE → use unit count from conteo, not gram-based targetQuantity
                const ensambleQty = await resolveEnsambleQty(note, targetQuantity);
                const persistedLotSelE = note.processParameters?.lot_selections || {};
                const mergedLotIdsE = { ...persistedLotSelE, ...selectedLotIds };
                Object.keys(mergedLotIdsE).forEach(k => { if (!mergedLotIdsE[k]) delete mergedLotIdsE[k]; });
                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: ensambleQty,
                    observations: outputObservations || null,
                    lotSelections: mergedLotIdsE
                });

                // ── AUTO-INGEST to PRODUCCION zone after ENSAMBLE ──────────────────
                // When EMPAQUE fires ingest, the ASSEMBLY_INCOMPLETE guard may block it
                // (ENSAMBLE still pending). Now that ENSAMBLE is done, retry the ingest.
                // Only for finished goods (accountGroup 1401 or 1402).
                const productAccountGroup = note.product?.accountGroup;
                if ([1401, 1402].includes(productAccountGroup) && ensambleQty > 0) {
                    // Robust batchNumber resolution: try note directly first,
                    // then scan allBatchNotes (any note in the batch has it),
                    // final fallback: any note in the batch that carries a productionBatch.
                    const batchNumber = note.productionBatch?.batchNumber
                        || allBatchNotes?.find(n => n.productionBatch?.batchNumber)?.productionBatch?.batchNumber
                        || allBatchNotes?.find(n => n.id === note.id)?.productionBatch?.batchNumber;
                    const batchId = note.productionBatchId
                        || allBatchNotes?.find(n => n.productionBatchId)?.productionBatchId;

                    if (batchNumber && batchId) {
                        try {
                            await api.post('/finished-lots/ingest', {
                                productId: note.productId,
                                lotNumber: batchNumber,
                                quantity: ensambleQty,
                                batchId,
                            });
                        } catch (ingestErr) {
                            // If already ingested (duplicate guard) — OK, silently ignore
                            const msg = ingestErr.response?.data?.error || '';
                            if (!msg.startsWith('DUPLICATE_INGESTION')) {
                                console.error('[AUTO-INGEST] Error after ENSAMBLE:', msg, { productId: note.productId, batchNumber, ensambleQty });
                            }
                        }
                    } else {
                        console.error('[AUTO-INGEST] No batchNumber found — ingest skipped!', {
                            noteId: note.id, productionBatchId: note.productionBatchId,
                            hasBatch: !!note.productionBatch, allBatchNotesCount: allBatchNotes?.length
                        });
                    }
                }
            } else if (note.processType?.code === 'G_EMPAQUE') {
                // ══════════════════════════════════════════════════════════════════════
                // GENIALITY G_EMPAQUE → Finalize from any wizard step (G_CONTEO_CARRITOS, MARCADO_CAJAS)
                // Mismos pasos que el branch CONTEO pero disparados desde la propia nota G_EMPAQUE.
                // ══════════════════════════════════════════════════════════════════════
                const batchId = note.productionBatchId;
                const batchNumber = note.productionBatch?.batchNumber || '';

                // 1. Total real desde carriots recibidos (si los hay) — fallback al targetQuantity
                const receivedCarriots = empaqueCarriots.filter(c => c.receivedAt);
                let totalRealQty = receivedCarriots.reduce((s, c) => s + (c.qty || 0), 0);
                if (totalRealQty <= 0) {
                    // Fallback: si no hay carriots, usar outputTargets actuales del producto de esta nota
                    const target = note.productionBatch?.outputTargets?.find(t => t.productId === note.productId);
                    totalRealQty = target?.actualUnits || target?.plannedUnits || note.targetQuantity || 0;
                }

                // 2. Persistir conteo en processParameters + completar la nota G_EMPAQUE
                try {
                    if (receivedCarriots.length > 0) {
                        const conteoCounts = {};
                        (note.productionBatch?.outputTargets || []).forEach(t => {
                            const actualUds = receivedCarriots
                                .filter(c => c.productId === t.productId)
                                .reduce((s, c) => s + c.qty, 0);
                            conteoCounts[t.product?.name || t.productId] = {
                                productId: t.productId,
                                productName: t.product?.name,
                                planned: t.plannedUnits,
                                actual: actualUds,
                            };
                        });
                        await api.patch(`/assembly-notes/${note.id}`, {
                            processParameters: { ...(note.processParameters || {}), conteo: conteoCounts }
                        }).catch(() => {});
                    }

                    await api.post(`/assembly-notes/${note.id}/complete`, {
                        operatorId: user?.id,
                        actualQuantity: totalRealQty,
                        observations: receivedCarriots.length > 0
                            ? `G_EMPAQUE — carritos recibidos: ${receivedCarriots.length}. Lote: ${batchNumber}.`
                            : `G_EMPAQUE — finalizado. Lote: ${batchNumber}. Real: ${totalRealQty}.`
                    });
                } catch (e) {
                    console.warn('[G_EMPAQUE complete]', e.message);
                }

                // 3. Auto-completar G_ENSAMBLE pendientes asociadas (si las hay) + ingest finished lot
                try {
                    const allNotesRes = await api.get(`/assembly-notes?batchId=${batchId}`);
                    const batchNotes = allNotesRes.data || [];
                    const ensambleNotes = batchNotes.filter(n =>
                        ['ENSAMBLE', 'G_ENSAMBLE'].includes(n.processType?.code) &&
                        n.status !== 'COMPLETED'
                    );
                    for (const ens of ensambleNotes) {
                        const ensQty = ens.productId
                            ? receivedCarriots.filter(c => c.productId === ens.productId).reduce((s, c) => s + c.qty, 0)
                            : 0;
                        const qty = ensQty > 0 ? ensQty : (ens.targetQuantity || totalRealQty);
                        if (qty <= 0) continue;
                        try {
                            await api.post(`/assembly-notes/${ens.id}/complete`, {
                                operatorId: user?.id,
                                actualQuantity: qty,
                                observations: `Auto-completado tras G_EMPAQUE. Lote: ${batchNumber}.`
                            });
                            if (ens.productId && batchNumber && batchId) {
                                api.post('/finished-lots/ingest', {
                                    productId: ens.productId,
                                    lotNumber: batchNumber,
                                    quantity: qty,
                                    batchId,
                                }).catch(ingErr => {
                                    const m = ingErr.response?.data?.error || '';
                                    if (!m.startsWith('DUPLICATE_INGESTION')) console.warn('[G_EMPAQUE ingest]', m);
                                });
                            }
                        } catch (ensErr) {
                            console.warn(`[G_ENSAMBLE auto-complete] ${ens.id}:`, ensErr.message);
                        }
                    }
                    message.success('✅ Empaque Geniality finalizado');
                } catch (e) {
                    console.warn('[G_EMPAQUE auto-ensamble scan]', e.message);
                }
            } else {
                // ── Merge persisted lot_selections with local selectedLotIds ──
                const persistedLotSel = note.processParameters?.lot_selections || {};
                const mergedLotIds = { ...persistedLotSel, ...selectedLotIds };
                // Remove empty entries
                Object.keys(mergedLotIds).forEach(k => { if (!mergedLotIds[k]) delete mergedLotIds[k]; });

                // ── Pass lot selections to backend for atomic consumption ──
                const completeRes2 = await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: parseFloat(outputQuantity) || parseFloat(targetQuantity) || note.targetQuantity,
                    observations: outputObservations || null,
                    lotSelections: mergedLotIds
                });
                if (completeRes2.data?.consumptionAlerts?.length > 0) {
                    const alerts = completeRes2.data.consumptionAlerts;
                    message.warning(`⚠️ Alerta de consumo: ${alerts.map(a => `${a.component} (esperado: ${a.expected}, consumido: ${a.consumed})`).join(', ')}`, 10);
                }
            }

            message.success(`Etapa ${note.stageOrder} — ${note.stageName} completada ✅`);

            const batchId = note.productionBatchId;
            const allNotesRes = await api.get(`/assembly-notes?batchId=${batchId}`);
            const allBatchNotesFresh = allNotesRes.data || [];

            // ── Special case: finishing a sub-EMPAQUE wizard ──────────────────────
            // When the unified EMPAQUE wizard (QC→MARCADO→ENSAMBLE) completes,
            // we must return to the EMPAQUE multi-selector (parent note), NOT advance
            // to the next sequential stage.
            const isFinishingEmpaqueWizard = note.processType?.code === 'EMPAQUE' && currentStep?.type === 'ENSAMBLE';

            if (isFinishingEmpaqueWizard) {
                // The selector note is the lowest-stageOrder EMPAQUE note that is NOT the current sub-note.
                const selectorNote = allBatchNotesFresh
                    .filter(n => n.processType?.code === 'EMPAQUE' && n.id !== note.id)
                    .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0];

                if (selectorNote) {
                    console.log('[EMPAQUE wizard] Regresando al selector:', selectorNote.id);
                    setTimeout(() => {
                        navigate(`/assembly-execution/${selectorNote.id}`, { replace: true });
                        window.location.reload();
                    }, 800);
                } else {
                    // All EMPAQUE notes done — advance to the true next stage (skip ENSAMBLE mirrors)
                    const nextStage = allBatchNotesFresh.find(n =>
                        n.stageOrder > note.stageOrder &&
                        n.status !== 'COMPLETED' &&
                        n.processType?.code !== 'ENSAMBLE'
                    );
                    if (nextStage) {
                        message.info(`Avanzando a ${nextStage.stageName}`);
                        setTimeout(() => {
                            navigate(`/assembly-execution/${nextStage.id}`, { replace: true });
                            window.location.reload();
                        }, 1200);
                    } else {
                        message.success('🎉 ¡Todas las etapas completadas!');
                        setShowCompletionPanel(true);
                    }
                }
                return;
            }

            // ── Standard next-note navigation (non-EMPAQUE wizard) ───────────────
            let nextNote = allBatchNotesFresh.find(n =>
                n.stageOrder > note.stageOrder && n.status !== 'COMPLETED'
            );

            // Auto-complete ENSAMBLE invisible para PROTECCION/PREMEZCLA — al
            // operario no le interesa esta pantalla; el cierre Siigo se dispara
            // por la lógica de RPA en backend al completar la nota.
            try {
                const productNameUpper = (note.product?.name || '').toUpperCase();
                const isAutoCloseProduct = productNameUpper.startsWith('PROTECCION') ||
                                            productNameUpper.startsWith('PREMEZCLA') ||
                                            productNameUpper.startsWith('PROTONICO') ||
                                            productNameUpper.startsWith('ALGINATO PREPARADO') ||
                                            productNameUpper.startsWith('BASE LIQUIPOPS') ||
                                            productNameUpper.startsWith('COMPUESTO');
                while (nextNote && nextNote.processType?.code === 'ENSAMBLE' && isAutoCloseProduct) {
                    if (nextNote.status === 'PENDING') {
                        await api.post(`/assembly-notes/${nextNote.id}/start`, { operatorId: user?.id });
                    }
                    await api.post(`/assembly-notes/${nextNote.id}/complete`, {
                        operatorId: user?.id,
                        actualQuantity: parseFloat(outputQuantity) || nextNote.targetQuantity,
                        observations: `Auto-completado tras cierre de ${note.stageName}`
                    });
                    console.log(`[ENSAMBLE auto-complete invisible] ✅ ${nextNote.id}`);
                    const refreshed = await api.get(`/assembly-notes?batchId=${batchId}`);
                    const fresh = refreshed.data || [];
                    nextNote = fresh.find(n => n.stageOrder > nextNote.stageOrder && n.status !== 'COMPLETED');
                }
            } catch (autoErr) {
                console.warn('[ENSAMBLE auto-complete invisible]', autoErr.response?.data?.error || autoErr.message);
            }

            if (nextNote) {
                const nextIsEmpaque = nextNote.processType?.code === 'EMPAQUE';
                const isProduccion = user?.role === 'PRODUCCION';

                if (nextIsEmpaque && isProduccion) {
                    setShowHandoff(true);
                } else {
                    message.info(`Avanzando a Etapa ${nextNote.stageOrder}: ${nextNote.stageName}`);
                    const skipIntroFlag = nextIsEmpaque && !isProduccion ? '?skipIntro=1' : '';
                    setTimeout(() => {
                        navigate(`/assembly-execution/${nextNote.id}${skipIntroFlag}`, { replace: true });
                        window.location.reload();
                    }, 1200);
                }
            } else {
                message.success('🎉 ¡Todas las etapas completadas!');
                setShowCompletionPanel(true);
            }
        } catch (e) {
            message.error(`Error: ${e.response?.data?.error || e.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleActualQtyChange = useCallback((itemId, value) => {
        setActualQuantities(prev => ({ ...prev, [itemId]: value }));
    }, []);

    // ── Render guards ────────────────────────────────────────────────────────
    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-slate-100">
            <Spin size="large" tip="Cargando interfaz de producción..." />
        </div>
    );

    if (error) return (
        <div className="h-screen flex flex-col items-center justify-center bg-slate-100 p-8 gap-4">
            <Alert message="Error" description={error} type="error" showIcon />
            <button onClick={() => navigate('/production/operator')}
                className="px-6 py-3 bg-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-300">
                Volver al Panel
            </button>
        </div>
    );

    if (!note || wizardSteps.length === 0) return null;

    // ── Handoff to empaque panel ───────────────────────────────────────────
    if (showHandoff) {
        const batchNum = note.productionBatch?.batchNumber || '';
        return (
            <div style={{
                minHeight: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                padding: 32, gap: 24
            }}>
                <div style={{ fontSize: 80, animation: 'bounce 1s ease infinite' }}>🛒</div>
                <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', textAlign: 'center', textShadow: '0 2px 20px rgba(0,0,0,0.3)' }}>
                    ¡Conteo Completado!
                </h1>
                <div style={{
                    background: 'rgba(255,255,255,0.95)', borderRadius: 20, padding: '24px 40px',
                    textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
                        🏷️ Lote para escribir en el carrito
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#1e293b', letterSpacing: 1 }}>
                        {batchNum}
                    </div>
                </div>
                <p style={{ fontSize: 20, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 400, fontWeight: 600, lineHeight: 1.4 }}>
                    Escriba el lote en el carrito y entréguelo al personal de empaque
                </p>
                <button onClick={() => navigate('/production/operator')}
                    style={{
                        padding: '20px 48px', fontSize: 22, fontWeight: 800,
                        background: 'rgba(255,255,255,0.25)', color: '#fff',
                        border: '2px solid rgba(255,255,255,0.5)', borderRadius: 16,
                        cursor: 'pointer', backdropFilter: 'blur(10px)', transition: 'all 0.3s'
                    }}>
                    ← Volver al Panel
                </button>
                <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-15px)} }`}</style>
            </div>
        );
    }

    // ── Completion panel ─────────────────────────────────────────────────────
    if (showCompletionPanel) {
        return (
            <div style={{
                minHeight: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                padding: 32, gap: 32
            }}>
                <div style={{ fontSize: 80, animation: 'bounce 1s ease infinite' }}>🎉</div>
                <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', textAlign: 'center', textShadow: '0 2px 20px rgba(0,0,0,0.3)' }}>¡Proceso Completado!</h1>
                <p style={{ fontSize: 20, color: 'rgba(255,255,255,0.9)', textAlign: 'center', maxWidth: 500 }}>
                    {note.stageName} — <b>{note.product?.name}</b><br />
                    Cantidad producida: <b>{parseFloat(outputQuantity) || note.targetQuantity || 1}</b>
                </p>
                <button onClick={() => navigate('/production/operator')}
                    style={{
                        padding: '20px 48px', fontSize: 22, fontWeight: 800,
                        background: 'rgba(255,255,255,0.2)', color: '#fff',
                        border: '2px solid rgba(255,255,255,0.4)', borderRadius: 16,
                        cursor: 'pointer', backdropFilter: 'blur(10px)', transition: 'all 0.3s'
                    }}>
                    ← Volver a Producir
                </button>
                <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-15px)} }`}</style>
            </div>
        );
    }

    // ── Wizard step navigation state ─────────────────────────────────────────
    const currentStep = wizardSteps[currentStepIndex];

    // Guard: notas con wizardSteps vacíos (ENSAMBLE invisible para
    // PROTECCION/PREMEZCLA). Mostramos un loader mientras el useEffect
    // de auto-complete on-mount cierra la nota y navega adelante.
    if (!currentStep) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-100">
                <Spin size="large" tip="Cerrando ensamble en Siigo..." />
            </div>
        );
    }

    const isLastStep = currentStepIndex === wizardSteps.length - 1;

    const isInputStep = currentStep.type === 'INPUT';
    const currentItemId = isInputStep ? currentStep.data.id : null;
    let canAdvance = true;
    if (isInputStep && currentItemId) {
        const hasWeight = actualQuantities[currentItemId] !== undefined && actualQuantities[currentItemId] !== '';
        const lotVal = lotNumbers[currentItemId];
        const hasLot = typeof lotVal === 'string' && lotVal.trim().length > 0;
        const hasPhoto = !!weighingPhotos[currentItemId] || !!note?.processParameters?.weighing_photos?.[currentItemId];
        // PESAJE notes: photo per ingredient is OPTIONAL (final verification photo is the gate)
        // All other process types: photo remains MANDATORY per ingredient
        const isPesajeProcess = note?.processType?.code === 'PESAJE';
        canAdvance = hasWeight && hasLot && (hasPhoto || isPesajeProcess);

        // Multi-lot validation: if lots exist in inventory, block until coverage >= planned
        // Skip for EMPAQUE — lots are auto-assigned with whatever is available
        const isEmpaqueProcess = note?.processType?.code === 'EMPAQUE';
        const itemSelections = lotSelections[currentItemId] || [];
        if (itemSelections.length > 0 && !isEmpaqueProcess) {
            const totalCovered = itemSelections.reduce((sum, s) => sum + (s.qty || 0), 0);
            const planned = currentStep.data?.plannedQuantity || 0;
            if (planned > 0 && totalCovered < planned * 0.97) {
                canAdvance = false;
            }
        }
    }

    // PESAJE_BATCH: block until ALL items have weight + lot + photo (AGUA y
    // los insumos intermedios del mismo bache están exentos de foto).
    // También bloquea si algún peso está < 80% del planificado (tooLow).
    if (currentStep.type === 'PESAJE_BATCH') {
        const batchItems = currentStep.data || [];
        canAdvance = batchItems.every(item => {
            const nameU = (item.component?.name || '').toUpperCase();
            const isAgua = nameU.includes('AGUA');
            const isIntermediate = nameU.startsWith('BASE ') ||
                nameU.startsWith('ALGINATO PREPARADO') ||
                nameU.startsWith('COMPUESTO') ||
                nameU.startsWith('PROTECCION') ||
                nameU.startsWith('PREMEZCLA') ||
                nameU.startsWith('PROTONICO') ||
                nameU.startsWith('SABORIZACION');
            const hasWeight = actualQuantities[item.id] !== undefined && actualQuantities[item.id] !== '';
            const hasLot = typeof lotNumbers[item.id] === 'string' && lotNumbers[item.id].trim().length > 0;
            const hasPhoto = isAgua || isIntermediate || !!weighingPhotos[item.id] || !!note?.processParameters?.weighing_photos?.[item.id];
            const planned = item.plannedQuantity || 0;
            const actual = parseFloat(actualQuantities[item.id]) || 0;
            const tooLow = planned > 0 && actual > 0 && actual < planned * 0.80;
            return hasWeight && hasLot && hasPhoto && !tooLow;
        });
    }

    // ADICION_BATCH: block until all ingredients are confirmed
    if (currentStep.type === 'ADICION_BATCH') {
        canAdvance = !!(adicionData?.allConfirmed);
    }

    // Block SIGUIENTE on EMPAQUE multi-presentation selector until ALL are completed
    const isEmpaque = note.processType?.code === 'EMPAQUE';
    const empaqueNotes = isEmpaque ? allBatchNotes.filter(n => n.processType?.code === 'EMPAQUE') : [];
    const isEmpaqueMultiSelector = isEmpaque && currentStep.type === 'INTRO' && empaqueNotes.length >= 1;
    const allEmpaqueDone = empaqueNotes.every(n => n.status === 'COMPLETED');
    if (isEmpaqueMultiSelector && !allEmpaqueDone) {
        canAdvance = false;
    }

    // Block FINALIZAR on CONTEO step until every product has a count entered
    // AND every product with actual > 0 has a photo.
    // CONTEO is Liquipops-only (direct input). Geniality uses its own wizard.
    if (currentStep.type === 'CONTEO') {
        // Packaging roles must NEVER finalize CONTEO — it's production only
        const isPackaging = ['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role);
        if (isPackaging) {
            canAdvance = false;
        } else {
            const targets = [
                ...(note.productionBatch?.outputTargets || []),
                ...extraConteoTargets.filter(et => !(note.productionBatch?.outputTargets || []).some(t => t.productId === et.productId))
            ];
            const allHaveCounts = targets.length > 0 && targets.every(t => {
                const val = conteoActuals[t.productId];
                const conteoPlanned = note.processParameters?.conteo?.[t.product?.name]?.planned;
                const planned = t.plannedUnits > 0 ? t.plannedUnits : (conteoPlanned ?? t.plannedUnits);

                if (planned === 0 && (val === undefined || val === '')) return true;
                return val !== undefined && val !== '' && !isNaN(parseInt(val, 10));
            });
            if (!allHaveCounts) canAdvance = false;

            if (allHaveCounts) {
                const allHavePhotos = targets.every(t => {
                    const conteoPlanned = note.processParameters?.conteo?.[t.product?.name]?.planned;
                    const planned = t.plannedUnits > 0 ? t.plannedUnits : (conteoPlanned ?? t.plannedUnits);
                    const val = conteoActuals[t.productId];
                    const actual = (val === undefined || val === '') ? 0 : parseInt(val, 10);
                    if (isNaN(actual) || actual <= 0) return true;
                    return !!conteoPhotos[t.productId];
                });
                if (!allHavePhotos) canAdvance = false;
            }
        }
    }

    // Block on COCCION step if not complete (photo + timer + temperature)
    if (currentStep.type === 'COCCION') {
        if (!coccionData?.isComplete) canAdvance = false;
    }

    // Block on MEDICION step if not all measurements filled
    if (currentStep.type === 'MEDICION') {
        if (!medicionData?.isComplete) canAdvance = false;
    }

    // Block FINALIZAR on OUTPUT step if REAL PRODUCIDO is empty or variation > 5%
    if (currentStep.type === 'OUTPUT') {
        const realQty = parseFloat(outputQuantity);
        const isEnsambleNote = note.processType?.code === 'ENSAMBLE';
        const isPesajeNote = note.processType?.code === 'PESAJE';
        const isFormacionNote = note.processType?.code === 'FORMACION';
        const productNameUpper = (note.product?.name || '').toUpperCase();
        const isPesajeSimple = isEnsambleNote || isFormacionNote || (isPesajeNote && !productNameUpper.startsWith('COMPUESTO') && !productNameUpper.startsWith('PROTECCION'));

        if (isPesajeSimple) {
            // For simple pesaje/ensamble, the OutputStep auto-fills and hides the field.
            // Do not block if state is lagging or empty, as the operator cannot manually enter it.
        } else if (!outputQuantity || realQty <= 0) {
            canAdvance = false;
        } else if (!isEnsambleNote) {
            // For complex PESAJE/FORMACION: enforce 5% variation limit
            const pesajeTotal = isPesajeNote && note.items?.length > 0
                ? note.items.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
                : null;

            // Same logic as OutputStep: try to find a previous completed PESAJE step for batch total
            const previousPesajeOutput = isPesajeNote && allBatchNotes?.length > 0
                ? allBatchNotes
                    .filter(n => n.processType?.code === 'PESAJE' && n.status === 'COMPLETED' && n.actualQuantity > 0 && n.id !== note.id)
                    .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0]?.actualQuantity
                : null;

            const formulaBaseQty = note.product?.formulas?.[0]?.baseQuantity || 0;
            const noteMultiplier = note.multiplier || 1;

            // Determine if MAJOR pesaje step or ADDITIVE (like conservante)
            const pesajeIsMajor = pesajeTotal && previousPesajeOutput && pesajeTotal > previousPesajeOutput * 0.1;

            let expectedQty;
            if (pesajeIsMajor || !previousPesajeOutput) {
                expectedQty = pesajeTotal
                    || previousPesajeOutput
                    || (isFormacionNote && formulaBaseQty > 1 ? formulaBaseQty * noteMultiplier : null)
                    || parseFloat(targetQuantity)
                    || note.targetQuantity
                    || 0;
            } else {
                // Additive step: expected = previous batch output + items being added
                expectedQty = previousPesajeOutput + (pesajeTotal || 0);
            }

            if (expectedQty > 0) {
                const variationPct = Math.abs((realQty - expectedQty) / expectedQty) * 100;
                if (variationPct > 5) {
                    canAdvance = false;
                }
            }
        }
        // ENSAMBLE: only blocks if qty is empty/0 (already handled above)
        // No 5% variation — operator enters real tarros/grams freely

        // Block if QC parameters are not complete (out of range, missing photos, or checklist incomplete)
        if (qcData && !qcData.isComplete) {
            canAdvance = false;
        }
    }

    // Block FORMACION_QC step if QC checks incomplete
    if (currentStep.type === 'FORMACION_QC') {
        if (!formacionQcData || !formacionQcData.isComplete) {
            canAdvance = false;
        }
    }

    // Block ESFERIFICACION step until timer is finished
    if (currentStep.type === 'ESFERIFICACION') {
        if (!esferificacionData || !esferificacionData.isComplete) {
            canAdvance = false;
        }
    }

    // Block AGUA step (flujo PROTECCION) hasta que se pulse "Agua llena"
    if (currentStep.type === 'AGUA') {
        if (!aguaData || !aguaData.isComplete) {
            canAdvance = false;
        }
    }

    // Block PROTECCION_GATE step until stock validated
    if (currentStep.type === 'PROTECCION_GATE') {
        if (!proteccionValidated) canAdvance = false;
    }

    // Block EMPAQUE step until all defective jars have a cause + photo
    if (currentStep.type === 'EMPAQUE') {
        const defectivos = parseInt(empaqueDefective || 0, 10);
        if (defectivos > 0) {
            const allHaveCause = Array.from({ length: defectivos }).every((_, i) => empaqueDefectReasons[i]?.cause);
            const allHavePhoto = empaquePhotoUrls.filter(Boolean).length >= defectivos;
            if (!allHaveCause || !allHavePhoto) canAdvance = false;
        }
    }

    // Block ENSAMBLE step within EMPAQUE note — always allow (informational summary)
    // The user clicks FINALIZAR to trigger the complete flow

    let nextLabel = 'SIGUIENTE';
    if (currentStep.type === 'INTRO' && note.status === 'PENDING') nextLabel = 'INICIAR PROCESO';
    if (currentStep.type === 'INPUT') nextLabel = 'CONFIRMAR PESO';
    if (currentStep.type === 'PESAJE_BATCH') nextLabel = 'CONFIRMAR TODOS LOS PESOS';
    if (currentStep.type === 'ADICION_BATCH') nextLabel = 'CONFIRMAR ADICIONES ✓';
    if (currentStep.type === 'CONTEO') nextLabel = 'PRODUCCIÓN TERMINADA ✓';
    // Unified EMPAQUE wizard labels
    if (currentStep.type === 'EMPAQUE' && isEmpaque) nextLabel = 'CONFIRMAR QC ✓';
    if (currentStep.type === 'MARCADO_CAJAS' && isEmpaque) nextLabel = 'ETIQUETAS LISTAS ✓';
    // ENSAMBLE within EMPAQUE uses the default FINALIZAR label (isLastStep)


    // ── Main render ──────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-100 flex flex-col overflow-hidden">
            {/* Compact header bar */}
            <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center justify-between z-40">
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                        {note.noteNumber} — {note.status === 'EXECUTING' ? '🔄 En Proceso' : note.status === 'COMPLETED' ? '✅ Completado' : '⏳ Pendiente'}
                    </div>
                    <div className="text-sm font-bold text-slate-700 truncate">{note.stageName}</div>
                    {allBatchNotes.length > 1 && (
                        <div className="flex gap-0.5 mt-1">
                            {allBatchNotes.sort((a, b) => a.stageOrder - b.stageOrder).map((n, i) => (
                                <div key={i}
                                    className={`h-1.5 rounded-full transition-all ${n.status === 'COMPLETED' ? 'bg-green-500 w-5' :
                                        n.id === note.id ? 'bg-blue-500 w-8 animate-pulse' : 'bg-slate-300 w-5'}`}
                                    title={`Etapa ${n.stageOrder}: ${n.stageName} (${n.status})`}
                                />
                            ))}
                        </div>
                    )}
                </div>
                <button
                    onClick={() => navigate('/production/operator')}
                    className="p-2 bg-slate-100 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all font-bold flex items-center gap-1 ml-2 shrink-0"
                >
                    <span className="text-[10px] uppercase">Salir</span>
                    <Home size={16} />
                </button>
            </div>

            {/* Main step display */}
            <div className="flex-1 overflow-auto">
                <StepDisplay
                    key={`${currentStepIndex}-${currentStep.data?.id || currentStep.type}`}
                    stepType={currentStep.type}
                    stepData={currentStep.data}
                    batchMultiplier={note?.processParameters?.repeatTotal || allBatchNotes.filter(n => n.stageName === note.stageName).length}
                    currentCount={currentStepIndex + 1}
                    totalSteps={wizardSteps.length}
                    actualQuantities={actualQuantities}
                    onActualQtyChange={handleActualQtyChange}
                    lotNumbers={lotNumbers}
                    onLotNumberChange={(itemId, value) => setLotNumbers(prev => ({ ...prev, [itemId]: value }))}
                    weighingPhotoUrl={currentStep.type === 'INPUT' ? (weighingPhotos[currentStep.data?.id] || note?.processParameters?.weighing_photos?.[currentStep.data?.id]) : undefined}
                    weighingPhotos={weighingPhotos}
                    onWeighingPhotoChange={(itemId, url) => setWeighingPhotos(prev => ({ ...prev, [itemId]: url }))}
                    onLotIdSelected={(itemId, lotId) => setSelectedLotIds(prev => ({ ...prev, [itemId]: lotId }))}
                    lotSelections={lotSelections}
                    onLotSelectionsChange={(itemId, selections) => setLotSelections(prev => ({ ...prev, [itemId]: selections }))}
                    outputQuantity={outputQuantity}
                    onOutputQtyChange={setOutputQuantity}
                    outputObservations={outputObservations}
                    onObservationsChange={setOutputObservations}
                    targetQuantityValue={targetQuantity}
                    onTargetQtyChange={(val) => {
                        setTargetQuantity(val);
                        if (note?.productionBatchId) {
                            localStorage.setItem(`batch_target_${note.productionBatchId}`, val);
                        }
                    }}
                    note={note}
                    allBatchNotes={allBatchNotes}
                    conteoActuals={conteoActuals}
                    onConteoActualChange={setConteoActual}
                    conteoPhotos={conteoPhotos}
                    onConteoPhotoChange={setConteoPhoto}
                    extraConteoTargets={extraConteoTargets}
                    onAddExtraConteoTarget={(target) => setExtraConteoTargets(prev => [...prev, target])}
                    onRemoveExtraConteoTarget={(productId) => {
                        setExtraConteoTargets(prev => prev.filter(t => t.productId !== productId));
                        setConteoActual(productId, undefined);
                    }}
                    isPackagingRole={['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role)}
                    carriots={['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role) || wizardSteps[currentStepIndex]?.type === 'EMPAQUE'
                        ? empaqueCarriots
                        : carriots}
                    onAddCarrito={handleAddCarrito}
                    onRemoveCarrito={handleRemoveCarrito}
                    onConfirmCarrito={handleConfirmCarrito}
                    onRotuladoChange={setRotuladoStatus}

                    empaqueDefective={empaqueDefective}
                    onEmpaqueDefectiveChange={setEmpaqueDefective}
                    onCoccionChange={setCoccionData}
                    onMedicionChange={setMedicionData}
                    onQcDataChange={setQcData}
                    onFormacionQcChange={setFormacionQcData}
                    onEsferificacionChange={setEsferificacionData}
                    onAguaChange={setAguaData}
                    onAdicionChange={setAdicionData}
                    empaquePhotoUrls={empaquePhotoUrls}
                    onEmpaquePhotoChange={setPhotoUrl}
                    empaqueDefectReasons={empaqueDefectReasons}
                    onEmpaqueDefectReasonChange={setDefectReason}
                    empaqueReceptionConfirmed={empaqueReceptionConfirmed}
                    savedReceptionPhotos={savedReceptionPhotos}
                    onReceptionConfirm={async (receptionPhotos) => {
                        // Persist to backend BEFORE setting local state
                        try {
                            await api.patch(`/assembly-notes/${note.id}/process-params`, {
                                processParameters: {
                                    empaque_reception_confirmed: true,
                                    empaque_reception_confirmed_at: new Date().toISOString(),
                                    empaque_reception_confirmed_by: user?.name || user?.email,
                                    reception_photos: receptionPhotos || {},
                                }
                            });
                        } catch (e) {
                            console.error('Error persisting reception:', e);
                        }
                        setEmpaqueReceptionConfirmed(true);
                        if (receptionPhotos) setSavedReceptionPhotos(receptionPhotos);
                    }}
                    esferaOutputFactor={esferaOutputFactor}
                    onMarcadoChange={setMarcadoCajas}
                    onPrintChange={setPrintLotData}
                    onProteccionValidated={setProteccionValidated}
                    onSkipToEmpaque={() => {
                        // Skip INTRO and go directly to EMPAQUE step
                        if (note.status === 'PENDING') {
                            (async () => {
                                try {
                                    setSubmitting(true);
                                    await api.post(`/assembly-notes/${note.id}/start`, { operatorId: user?.id });
                                    const refreshed = await api.get(`/assembly-notes/${note.id}`);
                                    setNote(refreshed.data);
                                    message.success('Materiales consumidos — Proceso iniciado');
                                    setCurrentStepIndex(1);
                                } catch (e) {
                                    const errMsg = e.response?.data?.error || e.message;
                                    if (errMsg.includes('BLOQUEADO')) {
                                        showZoneBlockedModal(errMsg);
                                    } else {
                                        message.error(`Error al iniciar: ${errMsg}`);
                                    }
                                } finally {
                                    setSubmitting(false);
                                }
                            })();
                        } else {
                            setCurrentStepIndex(1);
                        }
                    }}
                />
            </div>

            {/* Giant controls bar */}
            <GiantControls
                onNext={handleNext}
                onPrev={handlePrev}
                onComplete={handleComplete}
                canGoNext={canAdvance && !submitting}
                canGoPrev={currentStepIndex > 0 && !submitting && currentStep.type !== 'CONTEO'}
                isLastStep={isLastStep}
                isFirstStep={currentStepIndex === 0 || currentStep.type === 'CONTEO'}
                nextLabel={nextLabel}
                submitting={submitting}
            />
        </div>
    );
};

export default AssemblyExecutionWizard;
