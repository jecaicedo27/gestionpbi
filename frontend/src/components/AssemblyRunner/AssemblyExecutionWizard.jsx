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
    } = useEmpaqueState();

    const { conteoActuals, setConteoActual } = useConteoState();

    // ── Local wizard state ───────────────────────────────────────────────────
    const [submitting, setSubmitting] = useState(false);
    const [showCompletionPanel, setShowCompletionPanel] = useState(false);
    const [marcadoCajas, setMarcadoCajas] = useState({ unidadesPorCaja: 0, totalCajas: 0 });
    const [weighingPhotos, setWeighingPhotos] = useState({});
    const [selectedLotIds, setSelectedLotIds] = useState({});
    const [coccionData, setCoccionData] = useState(null);
    const [medicionData, setMedicionData] = useState(null);
    const [qcData, setQcData] = useState(null);
    const [formacionQcData, setFormacionQcData] = useState(null);
    const [esferificacionData, setEsferificacionData] = useState(null);
    const [proteccionValidated, setProteccionValidated] = useState(false);

    // Auto-advance past INTRO when arriving with ?skipIntro=1 (from empaque multi-selector)
    useEffect(() => {
        if (!skipIntroParam || !note || wizardSteps.length === 0) return;
        const currentStep = wizardSteps[currentStepIndex];
        if (currentStep?.type === 'INTRO') {
            // If note is PENDING, auto-start it first
            if (note.status === 'PENDING') {
                (async () => {
                    try {
                        setSubmitting(true);
                        await api.post(`/assembly-notes/${note.id}/start`, { operatorId: user?.id });
                        const refreshed = await api.get(`/assembly-notes/${note.id}`);
                        setNote(refreshed.data);
                        message.success('Materiales consumidos — Proceso iniciado');
                        // Only advance past INTRO on success
                        setCurrentStepIndex(1);
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
                setCurrentStepIndex(1);
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

            // Fallback to output targets (planned units)
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
                    // Save weighing photo if present
                    const photoUrl = weighingPhotos[item.id];
                    if (photoUrl) {
                        await api.patch(`/assembly-notes/${note.id}`, {
                            processParameters: {
                                ...note.processParameters,
                                weighing_photos: {
                                    ...(note.processParameters?.weighing_photos || {}),
                                    [item.id]: photoUrl
                                }
                            }
                        }).catch(() => { });
                    }
                    // ── Persist lot selections to processParameters (survive page refresh) ──
                    const currentLotSel = lotSelections[item.id];
                    const currentLotId = selectedLotIds[item.id];
                    if (currentLotSel?.length > 0 || currentLotId) {
                        const mergedLotSelections = {
                            ...(note.processParameters?.lot_selections || {}),
                            [item.id]: currentLotId || currentLotSel?.[0]?.lotId || null
                        };
                        await api.patch(`/assembly-notes/${note.id}`, {
                            processParameters: {
                                ...note.processParameters,
                                lot_selections: mergedLotSelections
                            }
                        }).catch(() => { });
                        // Keep local note in sync
                        if (note.processParameters) {
                            note.processParameters.lot_selections = mergedLotSelections;
                        }
                    }
                    // Lot consumption is deferred to handleComplete (batch consume on finalize)
                } catch (e) {
                    console.warn('Error saving actual qty:', e);
                }
            }
        }

        // MARCADO_CAJAS → save box data to processParameters before advancing
        if (currentStep.type === 'MARCADO_CAJAS') {
            try {
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...note.processParameters,
                        marcado_cajas: {
                            unidades_por_caja: marcadoCajas.unidadesPorCaja,
                            total_cajas: marcadoCajas.totalCajas,
                            lote: note.productionBatch?.batchNumber,
                            fecha_marcado: new Date().toISOString(),
                        }
                    }
                });
                message.success(`📦 Marcado guardado — ${marcadoCajas.totalCajas} cajas × ${marcadoCajas.unidadesPorCaja} uds`);
            } catch (e) {
                console.warn('Error guardando marcado de cajas:', e.message);
                // Non-blocking — continue anyway
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

            // EMPAQUE → save defective data + fire Siigo fire-and-forget
            if (currentStep?.type === 'EMPAQUE') {
                const empData = note.empaqueData || {};
                const conteoQty = empData.conteo_qty ?? parseFloat(targetQuantity) ?? 0;
                const defectivos = parseInt(empaqueDefective || 0, 10);
                const aprobados = Math.max(0, conteoQty - defectivos);

                // Validate: every defective jar must have a cause selected
                if (defectivos > 0) {
                    const missingCauses = Array.from({ length: defectivos }).filter((_, i) => !empaqueDefectReasons[i]?.cause);
                    if (missingCauses.length > 0) {
                        message.error(`⚠️ Debe seleccionar la causa del defecto para ${missingCauses.length === 1 ? 'el tarro defectuoso' : `los ${missingCauses.length} tarros defectuosos`}`);
                        setSubmitting(false);
                        return;
                    }
                }

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
                }).catch(() => { });

                if (note.processParameters?.assembly_on_complete) {
                    (async () => {
                        try {
                            const productName = empData.product_name || note.product?.name || 'Producto';
                            const productSku = note.product?.sku || null;
                            await api.post('/rpa/siigo-assembly', {
                                productName, productSku, quantity: aprobados, assemblyType: 'proceso',
                                observations: `Empaque ${note.stageName}. Lote: ${computeLotCode(productName)}. Aprobados: ${aprobados}/${conteoQty}.`
                            });
                            message.success(`🤖 Siigo: ${aprobados} × ${productName}`);
                        } catch (e) {
                            message.warning('⚠️ Siigo no disponible — proceso continúa');
                        }
                    })();
                    if (defectivos > 0) {
                        (async () => {
                            try {
                                const productName = empData.product_name || note.product?.name || 'Producto';
                                const productSku = note.product?.sku || null;
                                await api.post('/rpa/siigo-adjustment', {
                                    productName, productSku, quantity: -defectivos,
                                    reason: `Defectuosos empaque - ${note.stageName}`,
                                    photoUrls: empaquePhotoUrls,
                                    defectReasons: empaqueDefectReasons,
                                });
                            } catch (e) { console.warn('Adjustment skip:', e.message); }
                        })();
                    }
                }

                // Use aprobados as the completion quantity
                // Merge persisted lot_selections with local selectedLotIds for lot-based consumption
                const persistedLotSelEmp = note.processParameters?.lot_selections || {};
                const mergedLotIdsEmp = { ...persistedLotSelEmp, ...selectedLotIds };
                Object.keys(mergedLotIdsEmp).forEach(k => { if (!mergedLotIdsEmp[k]) delete mergedLotIdsEmp[k]; });

                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: aprobados,
                    observations: outputObservations || null,
                    lotSelections: mergedLotIdsEmp
                });
            } else if (currentStep?.type === 'CONTEO') {
                // CONTEO → save actual counts + esferas
                const esferaFactors = note.processParameters?.esfera_factors || {};
                const counts = {};
                let esferas_total = 0;
                const targets = note.productionBatch?.outputTargets || [];
                targets.forEach(t => {
                    const actual = parseInt(conteoActuals[t.productId] || t.plannedUnits, 10);
                    const factor = esferaFactors[t.productId] || 0;
                    const esferas = actual * factor;
                    esferas_total += esferas;
                    counts[t.product?.name || t.productId] = {
                        productId: t.productId, productName: t.product?.name,
                        planned: t.plannedUnits, actual, esfera_factor: factor, esferas
                    };
                });
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: { conteo: counts, esferas_total }
                }).catch(() => { });

                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: parseFloat(outputQuantity) || parseFloat(targetQuantity) || note.targetQuantity,
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
            } else {
                // ── Merge persisted lot_selections with local selectedLotIds ──
                const persistedLotSel = note.processParameters?.lot_selections || {};
                const mergedLotIds = { ...persistedLotSel, ...selectedLotIds };
                // Remove empty entries
                Object.keys(mergedLotIds).forEach(k => { if (!mergedLotIds[k]) delete mergedLotIds[k]; });

                // ── Pass lot selections to backend for atomic consumption ──
                await api.post(`/assembly-notes/${note.id}/complete`, {
                    operatorId: user?.id,
                    actualQuantity: parseFloat(outputQuantity) || parseFloat(targetQuantity) || note.targetQuantity,
                    observations: outputObservations || null,
                    lotSelections: mergedLotIds
                });
            }

            message.success(`Etapa ${note.stageOrder} — ${note.stageName} completada ✅`);

            const batchId = note.productionBatchId;
            const allNotesRes = await api.get(`/assembly-notes?batchId=${batchId}`);
            const nextNote = allNotesRes.data.find(n =>
                n.stageOrder > note.stageOrder && n.status !== 'COMPLETED'
            );

            if (nextNote) {
                message.info(`Avanzando a Etapa ${nextNote.stageOrder}: ${nextNote.stageName}`);
                setTimeout(() => {
                    navigate(`/assembly-execution/${nextNote.id}`, { replace: true });
                    window.location.reload();
                }, 1200);
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
    const isLastStep = currentStepIndex === wizardSteps.length - 1;

    const isInputStep = currentStep.type === 'INPUT';
    const currentItemId = isInputStep ? currentStep.data.id : null;
    let canAdvance = true;
    if (isInputStep && currentItemId) {
        const hasWeight = actualQuantities[currentItemId] !== undefined && actualQuantities[currentItemId] !== '';
        const lotVal = lotNumbers[currentItemId];
        const hasLot = typeof lotVal === 'string' && lotVal.trim().length > 0;
        canAdvance = hasWeight && hasLot;

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

    // Block SIGUIENTE on EMPAQUE multi-presentation selector until ALL are completed
    const isEmpaque = note.processType?.code === 'EMPAQUE';
    const empaqueNotes = isEmpaque ? allBatchNotes.filter(n => n.processType?.code === 'EMPAQUE') : [];
    const isEmpaqueMultiSelector = isEmpaque && currentStep.type === 'INTRO' && empaqueNotes.length > 1;
    const allEmpaqueDone = empaqueNotes.every(n => n.status === 'COMPLETED');
    if (isEmpaqueMultiSelector && !allEmpaqueDone) {
        canAdvance = false;
    }

    // Block on CONTEO step if not all outputs have been counted
    if (currentStep.type === 'CONTEO') {
        const targets = note.productionBatch?.outputTargets || [];
        const allCounted = targets.length > 0 && targets.every(t => {
            const val = conteoActuals[t.productId];
            return val !== undefined && val !== '';
        });
        if (!allCounted) canAdvance = false;
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
        // For PESAJE, expectedQty = sum of ingredient quantities (not targetQuantity which is 1)
        const isPesajeNote = note.processType?.code === 'PESAJE';
        const isFormacionNote = note.processType?.code === 'FORMACION';
        const pesajeTotal = isPesajeNote && note.items?.length > 0
            ? note.items.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
            : null;
        // Each PESAJE note is independent — expected = just this note's ingredient sum
        const pesajeExpected = pesajeTotal;
        const formulaBaseQty = note.product?.formulas?.[0]?.baseQuantity || 0;
        const noteMultiplier = note.multiplier || 1;
        const expectedQty = pesajeExpected
            || (isFormacionNote && formulaBaseQty > 1 ? formulaBaseQty * noteMultiplier : null)
            || parseFloat(targetQuantity)
            || note.targetQuantity
            || 0;
        if (!outputQuantity || realQty <= 0) {
            canAdvance = false;
        } else if (expectedQty > 0) {
            const variationPct = Math.abs((realQty - expectedQty) / expectedQty) * 100;
            if (variationPct > 5) {
                canAdvance = false;
            }
        }
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

    let nextLabel = 'SIGUIENTE';
    if (currentStep.type === 'INTRO' && note.status === 'PENDING') nextLabel = 'INICIAR PROCESO';
    if (currentStep.type === 'INPUT') nextLabel = 'CONFIRMAR PESO';

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
                    weighingPhotoUrl={currentStep.type === 'INPUT' ? weighingPhotos[currentStep.data?.id] : undefined}
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
                    empaqueDefective={empaqueDefective}
                    onEmpaqueDefectiveChange={setEmpaqueDefective}
                    onCoccionChange={setCoccionData}
                    onMedicionChange={setMedicionData}
                    onQcDataChange={setQcData}
                    onFormacionQcChange={setFormacionQcData}
                    onEsferificacionChange={setEsferificacionData}
                    empaquePhotoUrls={empaquePhotoUrls}
                    onEmpaquePhotoChange={setPhotoUrl}
                    empaqueDefectReasons={empaqueDefectReasons}
                    onEmpaqueDefectReasonChange={setDefectReason}
                    esferaOutputFactor={esferaOutputFactor}
                    onMarcadoChange={setMarcadoCajas}
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
                canGoPrev={currentStepIndex > 0 && !submitting}
                isLastStep={isLastStep}
                isFirstStep={currentStepIndex === 0}
                nextLabel={nextLabel}
                submitting={submitting}
            />
        </div>
    );
};

export default AssemblyExecutionWizard;
