const fs = require('fs');
const file = '/var/www/gestionpbi/frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Rewrite handleConfirmCarrito
const confirmCarritoRegex = /const handleConfirmCarrito = useCallback\(async \(carritoId, productId, photoUrl\) => \{[\s\S]*?\}, \[conteoNote, note, empaqueCarriots, allBatchNotes, navigate\]\);/m;
const newConfirmCarrito = `const handleConfirmCarrito = useCallback(async (carritoId, productId, photoUrl) => {
        const targetNote = conteoNote || note;
        if (!targetNote) return;

        const currentCarriots = empaqueCarriots.length > 0 ? empaqueCarriots : targetNote.processParameters?.carriots || [];
        const activeCarrito = currentCarriots.find(c => c.id === carritoId);
        if (!activeCarrito) return;
        const carritoQty = activeCarrito.qty || 0;

        const empaqueNote = allBatchNotes?.find(n => n.productId === productId && (n.processType?.code === 'EMPAQUE' || n.processType?.code === 'G_EMPAQUE'));

        const updated = currentCarriots.map(c =>
            c.id === carritoId ? { ...c, receivedAt: new Date().toISOString(), labeledAt: new Date().toISOString(), photoUrl: photoUrl || null } : c
        );
        setEmpaqueCarriots(updated);
        try {
            await api.patch(\`/assembly-notes/\${targetNote.id}\`, {
                processParameters: { ...targetNote.processParameters, carriots: updated }
            });
            message.success(\`✅ Carrito recibido y evidencia guardada\`);

            if (empaqueNote) {
                const productName = empaqueNote.product?.name || 'Producto';
                const productSku = empaqueNote.product?.sku || null;
                const batchNumber = empaqueNote.productionBatch?.batchNumber || '';
                const formatLabel = productName.match(/X\\s*\\d+\\s*ML/i) ? productName.match(/X\\s*\\d+\\s*ML/i)[0] : 'Uds';

                // 2. Ingest
                if (carritoQty > 0 && empaqueNote.productId && batchNumber) {
                    api.post('/finished-lots/ingest', {
                        productId: empaqueNote.productId,
                        lotNumber: batchNumber,
                        quantity: carritoQty,
                        batchId: empaqueNote.productionBatchId || null,
                        perCarrito: true,
                        reason: \`Ingreso per carrito \${activeCarrito?.carritoNum || carritoId}\`
                    }).then(() => message.success(\`📥 Stock actualizado en PRODUCCIÓN\`))
                    .catch(e => {
                        if (!e.response?.data?.error?.includes('DUPLICATE')) console.warn('[CARRITO INGEST]', e.response?.data?.error || e.message);
                    });
                }

                // 3. Consume Packaging
                api.post(\`/assembly-notes/\${empaqueNote.id}/consume-carrito\`, {
                    carritoId, carritoQty, operatorId: user?.id
                }).catch(e => console.warn('[CARRITO CONSUME]', e.message));
                
                // Record consumption in EMPAQUE note
                const prevConsumed = empaqueNote.processParameters?.carriots_consumed || [];
                await api.patch(\`/assembly-notes/\${empaqueNote.id}\`, {
                    processParameters: {
                        ...empaqueNote.processParameters,
                        activeCarritoId: null,
                        carriots_consumed: [...prevConsumed, { carritoId, qty: carritoQty, processedAt: new Date().toISOString() }]
                    }
                });

                // 1. RPA
                const isRpaEnabledCarrito = empaqueNote.processParameters?.assembly_on_complete || ['EMPAQUE', 'G_EMPAQUE'].includes(empaqueNote.processType?.code);
                if (isRpaEnabledCarrito) {
                    (async () => {
                        try {
                            const rpaRes = await api.post('/rpa/siigo-assembly', {
                                assemblyNoteId: empaqueNote.id,
                                productName, productSku, quantity: carritoQty, assemblyType: 'proceso',
                                observations: \`Empaque carrito. Lote: \${batchNumber}. Carrito: \${carritoQty} uds. Aprobados: \${carritoQty}. Defectuosos: 0.\`
                            });
                            message.success(\`🤖 Siigo: Encolado para carrito \${carritoQty} × \${formatLabel}\`);
                            
                            if (rpaRes.data?.executionId) {
                                // Add rpaExecutionId to the carrito state
                                setEmpaqueCarriots(prev => {
                                    const nextUpdated = prev.map(c => c.id === carritoId ? { ...c, rpaExecutionId: rpaRes.data.executionId } : c);
                                    
                                    // Save it to DB in background
                                    api.patch(\`/assembly-notes/\${targetNote.id}\`, {
                                        processParameters: { ...targetNote.processParameters, carriots: nextUpdated }
                                    }).catch(console.error);

                                    return nextUpdated;
                                });
                            }

                        } catch (e) {
                            message.warning('⚠️ Siigo no disponible para carrito — proceso continúa');
                        }
                    })();
                }
            }
        } catch (e) { 
            console.warn('Error confirming carrito:', e.message); 
            message.error('Ocurrió un error al confirmar el carrito.');
        }
    }, [conteoNote, note, empaqueCarriots, allBatchNotes, user]);`;

content = content.replace(confirmCarritoRegex, newConfirmCarrito);

// 2. Inject G_CONTEO_CARRITOS completion inside handleComplete
const completeRegex = /if \(currentStep\?\.type === 'ENSAMBLE' && note\.processType\?\.code === 'EMPAQUE'\) \{/;
const newComplete = `if (currentStep?.type === 'G_CONTEO_CARRITOS') {
            // Auto-complete all EMPAQUE and ENSAMBLE notes for Geniality
            const batchId = note.productionBatchId;
            const batchNumber = note.productionBatch?.batchNumber || '';
            const isPackagingRole = ['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role);
            
            try {
                // Complete the current CONTEO note
                const receivedCarriots = empaqueCarriots.filter(c => c.receivedAt);
                const totalRealQty = receivedCarriots.reduce((s, c) => s + (c.qty || 0), 0);
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
                await api.patch(\`/assembly-notes/\${note.id}\`, {
                    processParameters: { conteo: conteoCounts }
                }).catch(() => {});
                
                await api.post(\`/assembly-notes/\${note.id}/complete\`, {
                    operatorId: user?.id,
                    actualQuantity: totalRealQty || note.targetQuantity,
                    observations: \`Empaque Siropes — carriots recibidos: \${receivedCarriots.length}. Lote: \${batchNumber}.\`
                });

                // Complete all related EMPAQUE and ENSAMBLE notes
                const allNotesRes = await api.get(\`/assembly-notes?batchId=\${batchId}\`);
                const batchNotes = allNotesRes.data || [];
                
                const dependentNotes = batchNotes.filter(n =>
                    n.stageOrder > note.stageOrder &&
                    n.status !== 'COMPLETED' &&
                    ['EMPAQUE', 'G_EMPAQUE', 'ENSAMBLE', 'G_ENSAMBLE'].includes(n.processType?.code)
                );

                for (const dNote of dependentNotes) {
                    const dProductId = dNote.productId;
                    const dQty = dProductId
                        ? receivedCarriots.filter(c => c.productId === dProductId).reduce((s, c) => s + c.qty, 0)
                        : totalRealQty;
                    
                    const qty = dQty > 0 ? dQty : (dNote.targetQuantity || totalRealQty);
                    if (qty <= 0) {
                        // Just complete with 0
                        await api.post(\`/assembly-notes/\${dNote.id}/complete\`, {
                            operatorId: user?.id,
                            actualQuantity: 0,
                            observations: \`Sin producción registrada en conteo.\`
                        });
                        continue;
                    }

                    try {
                        await api.post(\`/assembly-notes/\${dNote.id}/complete\`, {
                            operatorId: user?.id,
                            actualQuantity: qty,
                            observations: \`Auto-completado — empaque geniality. Carriots: \${receivedCarriots.length}. Lote: \${batchNumber}.\`
                        });
                    } catch (e) { console.warn('Auto-complete err:', e.message); }
                }

                message.success('🎉 ¡Empaque y Recepción completados exitosamente!');
                setShowCompletionPanel(true);
                return;
            } catch (e) {
                console.warn('[G_CONTEO_CARRITOS complete]', e.message);
                message.error('Error finalizando el empaque.');
            }
        }
        
        if (currentStep?.type === 'ENSAMBLE' && note.processType?.code === 'EMPAQUE') {`;

content = content.replace(completeRegex, newComplete);

// 3. Remove the old MARCADO_CAJAS handleNext block to clean up since it's now dead code. (optional)

fs.writeFileSync(file, content, 'utf8');
console.log('Wizard patched!');
