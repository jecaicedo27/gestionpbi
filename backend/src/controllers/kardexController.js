const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getProductionZoneKardex = async (req, res) => {
    try {
        const { productId } = req.params;

        // Verify product
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, productionZoneStock: true }
        });

        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        // 1. Fetch ZoneTransfers (IN / OUT)
        const transfers = await prisma.zoneTransfer.findMany({
            where: { productId },
            include: { transferredBy: { select: { name: true } } }
        });

        const formattedTransfers = transfers.map(t => {
            const isOut = t.direction === 'OUT' || t.direction === 'PRODUCTION_TO_GENERAL';
            let photoUrl = null;
            if (t.photos && Array.isArray(t.photos) && t.photos.length > 0) {
                photoUrl = t.photos[0];
            }
            return {
                id: t.id,
                date: t.createdAt,
                reference: t.direction === 'IN' ? `Transferencia Zonas: IN` : `Transferencia Zonas: OUT`,
                user: t.transferredBy?.name || 'Sistema',
                operation: isOut ? 'SALIDA' : 'INGRESO',
                delta: isOut ? -Math.abs(t.quantity) : Math.abs(t.quantity),
                type: 'ZONE_TRANSFER',
                photoUrl
            };
        });

        // 2. Fetch LotConsumptions (OUT)
        const consumptions = await prisma.lotConsumption.findMany({
            where: { materialLot: { productId, zone: 'PRODUCTION' } },
            include: { 
                usedBy: { select: { name: true } }, 
                assemblyNote: { 
                    select: { 
                        noteNumber: true, 
                        processType: { select: { name: true } },
                        processParameters: true,
                        items: {
                            select: { id: true, componentId: true }
                        }
                    } 
                } 
            }
        });

        const formattedConsumptions = consumptions.map(c => {
            let photoUrl = null;
            if (c.assemblyNote && c.assemblyNote.processParameters) {
                const pp = c.assemblyNote.processParameters;
                
                // Try specific item first
                if (c.assemblyNote.items) {
                    const item = c.assemblyNote.items.find(i => i.componentId === productId);
                    if (item) {
                        if (pp.weighing_photos && pp.weighing_photos[item.id]) {
                            photoUrl = pp.weighing_photos[item.id];
                        } else if (pp.weighing_data && pp.weighing_data[item.id] && pp.weighing_data[item.id].photoUrl) {
                            photoUrl = pp.weighing_data[item.id].photoUrl;
                        }
                    }
                }
                
                // Fallback: QC Verification photo (some templates use this for the step photo)
                if (!photoUrl && pp.qc_result && pp.qc_result.verificationPhoto) {
                    photoUrl = pp.qc_result.verificationPhoto;
                }
            }

            return {
                id: c.id,
                date: c.usedAt,
                reference: c.assemblyNote ? `Ensamble ${c.assemblyNote.processType?.name || ''} # ${c.assemblyNote.noteNumber || ''}` : `Consumo manual/Ajuste`,
                user: c.usedBy?.name || 'Sistema',
                operation: 'CONSUMO',
                delta: -Math.abs(c.quantityUsed),
                type: 'LOT_CONSUMPTION',
                photoUrl
            };
        });

        // 4. Fetch Assembly Outputs (INGRESO NATIVO)
        const productionOutputs = await prisma.assemblyNote.findMany({
            where: { productId, status: 'COMPLETED' },
            include: { completedBy: { select: { name: true } }, processType: { select: { name: true } } }
        });
        
        const formattedOutputs = productionOutputs.map(note => {
            // Only non-finished products natively enter production zone stock here
            return {
                id: note.id,
                date: note.completedAt || note.updatedAt,
                reference: `Producción ${note.processType?.name || 'Ensamble'} # ${note.noteNumber}`,
                user: note.completedBy?.name || 'Sistema',
                operation: 'INGRESO RESULTANTE',
                delta: Math.abs(note.actualQuantity || 0),
                type: 'NOTE_OUTPUT'
            };
        });

        // 3. Fetch AuditLogs (AUTO_RECONCILE)
        const auditLogs = await prisma.auditLog.findMany({
            where: { action: 'AUTO_RECONCILE', entity: 'PRODUCTION_ZONE_STOCK', entityId: productId }
        });

        const formattedAudits = auditLogs.map(a => {
            const drift = a.changes?.drift || 0;
            return {
                id: a.id,
                date: a.createdAt,
                reference: 'Auto-Reconciliación del Sistema',
                user: '⚙️ Sistema ERP',
                operation: drift >= 0 ? 'AJUSTE POSITIVO' : 'AJUSTE NEGATIVO',
                delta: drift,
                type: 'AUDIT_LOG'
            };
        });

        // Combine and sort chronologically (oldest first for running balance)
        const allTransactions = [...formattedTransfers, ...formattedConsumptions, ...formattedAudits, ...formattedOutputs].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Let's compute a running balance and find the "initial" missing drift.
        // The final running balance must equal product.productionZoneStock.
        const sumDeltas = allTransactions.reduce((sum, tx) => sum + tx.delta, 0);
        const actualStock = product.productionZoneStock || 0;
        
        const initialDescuadreGhost = actualStock - sumDeltas;
        
        let runningBalance = initialDescuadreGhost;
        
        // Formulated Kardex
        const kardex = allTransactions.map(tx => {
            runningBalance += tx.delta;
            return { ...tx, balance: runningBalance };
        });

        // Put the Ghost record at the top if it's significant
        if (Math.abs(initialDescuadreGhost) > 1) {
            kardex.unshift({
                id: 'ghost-000',
                date: new Date(2020, 0, 1), // far past so it shows first
                reference: 'Saldo Anterior / Discrepancia No Registrada',
                user: '—',
                operation: initialDescuadreGhost > 0 ? 'SALDO INICIAL POSITIVO' : 'SALDO INICIAL NEGATIVO',
                delta: initialDescuadreGhost,
                balance: initialDescuadreGhost,
                type: 'GHOST_INIT'
            });
        }

        // Return descending for UI
        res.json({
            success: true,
            product: { id: product.id, name: product.name, currentStock: product.productionZoneStock },
            kardex: kardex.sort((a, b) => new Date(b.date) - new Date(a.date))
        });

    } catch (error) {
        console.error('Kardex Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
