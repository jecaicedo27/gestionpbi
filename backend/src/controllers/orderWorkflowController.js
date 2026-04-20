const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const finishedLotService = require('../services/finishedLotService');

/**
 * Director Logística: Approve order
 * POST /api/orders/:id/approve
 */
exports.approveOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { removedItems = [], modifiedQuantities = {} } = req.body;
        const approverId = req.user.id;

        // Verify user is Director Logística
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo el Director Logística puede aprobar pedidos'
            });
        }

        // Get order with items
        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden aprobar pedidos pendientes'
            });
        }

        // Remove items if specified
        if (removedItems.length > 0) {
            await prisma.orderItem.deleteMany({
                where: {
                    id: { in: removedItems }
                }
            });
        }

        // Modify quantities if specified
        for (const [itemId, newQty] of Object.entries(modifiedQuantities)) {
            await prisma.orderItem.update({
                where: { id: itemId },
                data: {
                    requestedQty: newQty,
                    allocatedQty: newQty,
                    pendingQty: 0
                }
            });
        }

        // Update order status
        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'APPROVED',
                approvedBy: approverId,
                approvedAt: new Date()
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                },
                distributor: true
            }
        });

        res.json({
            success: true,
            message: 'Pedido aprobado exitosamente',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error approving order:', error);
        res.status(500).json({
            success: false,
            error: 'Error al aprobar el pedido'
        });
    }
};

/**
 * Director Logística: Reject order
 * POST /api/orders/:id/reject
 */
exports.rejectOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const approverId = req.user.id;

        // Verify user is Director Logística
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo el Director Logística puede rechazar pedidos'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden rechazar pedidos pendientes'
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'REJECTED',
                approvedBy: approverId,
                approvedAt: new Date(),
                dispatchNotes: reason || 'Rechazado por Director Logística'
            },
            include: {
                distributor: true
            }
        });

        res.json({
            success: true,
            message: 'Pedido rechazado',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error rejecting order:', error);
        res.status(500).json({
            success: false,
            error: 'Error al rechazar el pedido'
        });
    }
};

/**
 * Operario Picking: Start picking an order
 * POST /api/orders/:id/start-picking
 */
exports.startPicking = async (req, res) => {
    try {
        const { id } = req.params;
        const pickerId = req.user.id;

        // Verify user is Operario Picking
        if (!['ADMIN', 'OPERARIO_PICKING', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo operarios de picking pueden iniciar la separación'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'APPROVED') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden separar pedidos aprobados'
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'IN_PICKING',
                pickingStartedAt: new Date(),
                pickingStartedBy: pickerId,
                pickingProgress: 0
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        res.json({
            success: true,
            message: 'Separación iniciada',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error starting picking:', error);
        res.status(500).json({
            success: false,
            error: 'Error al iniciar la separación'
        });
    }
};

/**
 * Operario Picking: Scan QR code and record item
 * POST /api/orders/:id/scan
 */
exports.scanItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderItemId, qrData, scannedQty } = req.body;
        const scannerId = req.user.id;

        // Verify user is Operario Picking
        if (!['ADMIN', 'OPERARIO_PICKING', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo operarios de picking pueden escanear items'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'IN_PICKING') {
            return res.status(400).json({
                success: false,
                error: 'El pedido no está en proceso de separación'
            });
        }

        // Validate QR data — only productCode (SKU) and lotNumber are mandatory.
        // barcode and expirationDate may be absent in TSPL thermal-label QRs.
        if (!qrData.productCode || !qrData.lotNumber) {
            return res.status(400).json({
                success: false,
                error: 'Datos de QR incompletos: se requiere SKU y número de lote'
            });
        }

        // ── STRICT PRODUCT VALIDATION: ensure scanned product matches the target order item ──
        const targetItem = order.items.find(item => item.id === orderItemId);
        if (!targetItem) {
            return res.status(400).json({
                success: false,
                error: 'Item de pedido no encontrado en esta orden'
            });
        }

        // Load the product for this order item to compare
        const targetProduct = await prisma.product.findUnique({
            where: { id: targetItem.productId },
            select: { sku: true, barcode: true, name: true }
        });

        // The scanned product code must match the target item's SKU or barcode
        const scannedSku = qrData.productCode;
        const scannedBarcode = qrData.barcode;
        const productMatches = (
            scannedSku === targetProduct?.sku ||
            scannedSku === targetProduct?.barcode ||
            (scannedBarcode && scannedBarcode === targetProduct?.barcode) ||
            (scannedBarcode && scannedBarcode === targetProduct?.sku)
        );

        if (!productMatches) {
            console.warn(`[SCAN BLOCKED] Product mismatch: scanned SKU=${scannedSku} BAR=${scannedBarcode} but target is SKU=${targetProduct?.sku} BAR=${targetProduct?.barcode} (${targetProduct?.name})`);
            return res.status(400).json({
                success: false,
                error: `Producto escaneado (${scannedSku}) no coincide con ${targetProduct?.name || 'el item seleccionado'} (${targetProduct?.sku})`
            });
        }

        // ── LOT VALIDATION: lot must exist in FinishedLotStock for this product ──
        const scannedLot = (qrData.lotNumber || qrData.lot || '').trim();
        if (!scannedLot) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere número de lote para registrar el escaneo'
            });
        }
        let lotExists = await prisma.finishedLotStock.findFirst({
            where: {
                productId: targetItem.productId,
                lotNumber: scannedLot,
                currentQuantity: { gt: 0 }
            },
            select: { id: true, lotNumber: true, currentQuantity: true, zone: true }
        });
        // Fallback: strip flavor prefix (e.g. "MARACUYA-260331-0722" → "260331-0722")
        if (!lotExists) {
            const strippedLot = scannedLot.replace(/^[A-Z-]+?(\d{6}-\d+)$/i, '$1');
            if (strippedLot !== scannedLot) {
                lotExists = await prisma.finishedLotStock.findFirst({
                    where: { productId: targetItem.productId, lotNumber: strippedLot, currentQuantity: { gt: 0 } },
                    select: { id: true, lotNumber: true, currentQuantity: true, zone: true }
                });
                if (lotExists) {
                    qrData.lotNumber = strippedLot;
                }
            }
        }
        // Fallback: try with flavor prefix if lot was stored with it
        if (!lotExists) {
            lotExists = await prisma.finishedLotStock.findFirst({
                where: { productId: targetItem.productId, lotNumber: { endsWith: scannedLot }, currentQuantity: { gt: 0 } },
                select: { id: true, lotNumber: true, currentQuantity: true, zone: true }
            });
            if (lotExists) {
                qrData.lotNumber = lotExists.lotNumber;
            }
        }
        if (!lotExists) {
            console.warn(`[SCAN BLOCKED] Lot not found: "${scannedLot}" for product ${targetProduct?.sku} (${targetProduct?.name})`);
            return res.status(400).json({
                success: false,
                error: `Lote "${scannedLot}" no existe para ${targetProduct?.name || targetProduct?.sku}. Verifica el número de lote.`
            });
        }

        // Zone validation: lot must be in PRODUCTO_TERMINADO for picking
        if (lotExists.zone !== 'PRODUCTO_TERMINADO') {
            const ptStock = await prisma.finishedLotStock.findFirst({
                where: { productId: targetItem.productId, zone: 'PRODUCTO_TERMINADO', currentQuantity: { gt: 0 } },
                select: { currentQuantity: true }
            });
            const prodStock = await prisma.finishedLotStock.aggregate({
                where: { productId: targetItem.productId, zone: 'PRODUCCION', currentQuantity: { gt: 0 } },
                _sum: { currentQuantity: true }
            });
            const prodQty = prodStock._sum.currentQuantity || 0;
            console.warn(`[SCAN BLOCKED] Lot "${scannedLot}" is in ${lotExists.zone}, not PRODUCTO_TERMINADO. Product: ${targetProduct?.sku}`);
            return res.status(400).json({
                success: false,
                zoneWarning: true,
                lotZone: lotExists.zone,
                produccionStock: prodQty,
                ptStock: ptStock?.currentQuantity || 0,
                error: `No hay stock en PRODUCTO TERMINADO. Hay ${prodQty} und en PRODUCCIÓN. Transfiere el lote antes de pickear.`
            });
        }

        // Create picking item record
        await prisma.orderPickingItem.create({
            data: {
                orderItemId,
                productCode: qrData.productCode,
                barcode: qrData.barcode,
                productName: qrData.name || qrData.productName || '',
                unitsPerBox: qrData.unitsPerBox || 1,
                lotNumber: qrData.lotNumber || qrData.lot,
                expirationDate: qrData.expirationDate
                    ? new Date(qrData.expirationDate)
                    : new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // default 2 years
                scannedQty: scannedQty || qrData.unitsPerBox || 1,
                scannedBy: scannerId
            }
        });

        // Calculate progress using allocatedQty (partial fulfillment target) when available
        const totalRequested = order.items.reduce((sum, item) => sum + (item.allocatedQty || item.requestedQty), 0);
        const updatedOrder = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
                    }
                }
            }
        });

        const totalScanned = updatedOrder.items.reduce((sum, item) =>
            sum + item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0), 0
        );

        const progress = Math.min(100, Math.round((totalScanned / totalRequested) * 100));

        // Update order progress
        const finalOrder = await prisma.order.update({
            where: { id },
            data: { pickingProgress: progress },
            include: {
                items: {
                    include: {
                        product: true,
                        pickingItems: true
                    }
                }
            }
        });

        res.json({
            success: true,
            message: 'Item escaneado correctamente',
            data: {
                order: finalOrder,
                progress,
                scannedQty: totalScanned,
                totalQty: totalRequested
            }
        });
    } catch (error) {
        console.error('Error scanning item:', error);
        res.status(500).json({
            success: false,
            error: 'Error al escanear el item'
        });
    }
};

/**
 * Operario Picking: Complete picking
 * POST /api/orders/:id/complete-picking
 * Body: { partial?: boolean }
 *   partial=true → allows closing even if some items weren't fully scanned.
 *   Only scanned quantities will be invoiced; items with 0 scanned are removed.
 */
exports.completePicking = async (req, res) => {
    try {
        const { id } = req.params;
        const { partial = false } = req.body || {};

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'IN_PICKING') {
            return res.status(400).json({ success: false, error: 'El pedido no está en proceso de separación' });
        }

        // Build per-item scanned totals
        const itemScanned = order.items.map(item => ({
            id: item.id,
            productId: item.productId,
            requestedQty: item.requestedQty,
            allocatedQty: item.allocatedQty,
            scannedQty: item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0)
        }));

        // Check completion using allocatedQty (partial fulfillment target) when available
        const allComplete = itemScanned.every(i => i.scannedQty >= (i.allocatedQty || i.requestedQty));

        // ── PARTIAL COMPLETION: ADMIN-ONLY ──
        // Logistics can complete ONLY when all items are 100% scanned.
        // Partial completion (incomplete items) requires admin authorization
        // to prevent premature order finalization with missing inventory.
        if (partial && req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden completar parcialmente. Complete todos los items o contacte al Admin.'
            });
        }

        if (!partial && !allComplete) {
            return res.status(400).json({
                success: false,
                error: 'No todos los items han sido escaneados completamente'
            });
        }

        // For partial completion: remove items with 0 scanned, set allocatedQty = scannedQty
        const updatedOrder = await prisma.$transaction(async (tx) => {
            // Remove items where nothing was scanned
            const zeroItems = itemScanned.filter(i => i.scannedQty <= 0).map(i => i.id);
            if (zeroItems.length > 0) {
                await tx.orderItem.deleteMany({ where: { id: { in: zeroItems } } });
            }

            // Update allocatedQty to actual scanned for each remaining item
            for (const item of itemScanned.filter(i => i.scannedQty > 0)) {
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        allocatedQty: item.scannedQty,
                        // If partial and scanned < requested, mark the remaining as pending
                        pendingQty: Math.max(0, item.requestedQty - item.scannedQty)
                    }
                });
            }

            const scannedTotal = itemScanned.reduce((s, i) => s + i.scannedQty, 0);
            const requestedTotal = itemScanned.reduce((s, i) => s + i.requestedQty, 0);
            const pickingPct = Math.round((scannedTotal / requestedTotal) * 100);

            return tx.order.update({
                where: { id },
                data: {
                    status: 'READY',
                    pickingProgress: pickingPct,
                    ...(partial && !allComplete ? { notes: (order.notes ? order.notes + ' ' : '') + '[Facturado parcialmente]' } : {})
                },
                include: {
                    items: { include: { product: true, pickingItems: true } },
                    distributor: true
                }
            });
        });

        // ── Consume FinishedLotStock for each scanned lot (post-transaction) ──
        // This runs outside the main tx to avoid nested transaction deadlocks.
        // Each lot consumption is independent; failures are logged but don't block picking.
        const lotConsumptionResults = [];
        for (const item of itemScanned.filter(i => i.scannedQty > 0)) {
            // Group scanned qty by lotNumber from pickingItems
            const pickingItems = order.items.find(i => i.id === item.id)?.pickingItems || [];
            const lotQtys = {};
            for (const pi of pickingItems) {
                const lot = pi.lotNumber;
                if (lot) lotQtys[lot] = (lotQtys[lot] || 0) + pi.scannedQty;
            }

            for (const [lotNumber, qty] of Object.entries(lotQtys)) {
                try {
                    await finishedLotService.consumeForOrder({
                        productId: item.productId,
                        lotNumber,
                        quantity: qty,
                        orderId: id,
                        userId: req.user.id,
                    });
                    lotConsumptionResults.push({ lotNumber, qty, status: 'OK' });
                    console.log(`[completePicking] ✅ Consumed ${qty} from lot ${lotNumber} for order ${updatedOrder.orderNumber}`);
                } catch (lotErr) {
                    lotConsumptionResults.push({ lotNumber, qty, status: 'FAILED', error: lotErr.message });
                    console.warn(`[completePicking] ⚠️ Lot consumption failed for ${lotNumber} qty=${qty}: ${lotErr.message}`);
                }
            }
        }

        res.json({
            success: true,
            message: partial && !allComplete
                ? 'Separación completada parcialmente. Pedido listo para facturar solo lo escaneado.'
                : 'Separación completada. Pedido listo para despacho',
            data: updatedOrder,
            lotConsumption: lotConsumptionResults,
        });
    } catch (error) {
        console.error('Error completing picking:', error);
        res.status(500).json({ success: false, error: 'Error al completar la separación' });
    }
};

/**
 * Operario Picking: Complete picking WITH backorder creation
 * POST /api/orders/:id/complete-with-backorder
 * ADMIN ONLY — Closes current order with scanned items, creates new PENDING order for deficit items.
 * The new order inherits the same distributor and references the original order.
 */
exports.completePickingWithBackorder = async (req, res) => {
    try {
        const { id } = req.params;

        // ADMIN ONLY
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden usar completar + reordenar'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true,
                        product: { select: { id: true, name: true, sku: true } }
                    }
                },
                distributor: { select: { id: true, name: true } }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'IN_PICKING') {
            return res.status(400).json({ success: false, error: 'El pedido no está en proceso de separación' });
        }

        // Build per-item scanned totals
        const itemScanned = order.items.map(item => ({
            id: item.id,
            productId: item.productId,
            productName: item.product?.name || '',
            requestedQty: item.requestedQty,
            allocatedQty: item.allocatedQty,
            scannedQty: item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0)
        }));

        // Validate: must have SOME scanned and SOME deficit
        const someScanned = itemScanned.some(i => i.scannedQty > 0);
        const deficitItems = itemScanned.filter(i => i.requestedQty - i.scannedQty > 0);

        if (!someScanned) {
            return res.status(400).json({
                success: false,
                error: 'No hay items escaneados. Escanee al menos un producto antes de completar.'
            });
        }

        if (deficitItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Todos los items están completos. Use "Completar Separación" normal.'
            });
        }

        // ── ATOMIC TRANSACTION: close current order + create backorder ──
        const { updatedOrder, backorder } = await prisma.$transaction(async (tx) => {
            // 1. Remove items where nothing was scanned from original order
            const zeroItems = itemScanned.filter(i => i.scannedQty <= 0).map(i => i.id);
            if (zeroItems.length > 0) {
                await tx.orderItem.deleteMany({ where: { id: { in: zeroItems } } });
            }

            // 2. Update allocatedQty to actual scanned for remaining items
            for (const item of itemScanned.filter(i => i.scannedQty > 0)) {
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        allocatedQty: item.scannedQty,
                        pendingQty: Math.max(0, item.requestedQty - item.scannedQty)
                    }
                });
            }

            // 3. Build traceability detail strings
            const scannedTotal = itemScanned.reduce((s, i) => s + i.scannedQty, 0);
            const requestedTotal = itemScanned.reduce((s, i) => s + i.requestedQty, 0);
            const pickingPct = Math.round((scannedTotal / requestedTotal) * 100);

            // 4. Generate unique backorder number based on original (preventing -BKO1-BKO1)
            const realBaseNumber = order.orderNumber.split('-BKO')[0];
            const existingBKOs = await tx.order.count({
                where: { orderNumber: { startsWith: `${realBaseNumber}-BKO` } }
            });
            const newOrderNumber = `${realBaseNumber}-BKO${existingBKOs + 1}`;

            // 5. Build backorder items (only products with deficit)
            const backorderItems = deficitItems.map(item => ({
                productId: item.productId,
                requestedQty: item.requestedQty - item.scannedQty,
                pendingQty: item.requestedQty - item.scannedQty,
                allocatedQty: 0
            }));

            // Clean up old autogenerated text to prevent huge notes blocks
            const cleanOldNotes = (order.notes || '')
                .split(' | ')
                .filter(n => !n.includes('[Backorder de') && !n.includes('[Parcial') && !n.includes('Origen:') && !n.includes('Facturado:') && !n.includes('Faltantes:') && !n.includes('Creado automático') && !n.includes('Faltantes movidos a') && !n.includes('BKO de') && !n.includes('Completado Parcial'))
                .map(n => n.trim())
                .filter(Boolean)
                .join(' | ');

            // 6. Create backorder as APPROVED
            const backorderNotes = [
                cleanOldNotes,
                `🚚 [BKO de ${order.orderNumber}] Creado automático`
            ].filter(Boolean).join(' | ');

            const newOrder = await tx.order.create({
                data: {
                    orderNumber: newOrderNumber,
                    distributorId: order.distributorId,
                    status: 'APPROVED',
                    approvedBy: order.approvedBy || req.user.id,
                    approvedAt: order.approvedAt || new Date(),
                    createdAt: order.createdAt, // Inherited to keep FIFO ranking in production/picking
                    notes: backorderNotes,
                    items: { create: backorderItems }
                },
                include: {
                    items: { include: { product: { select: { name: true, sku: true } } } },
                    distributor: { select: { name: true } }
                }
            });

            // 7. Close original order as READY with traceability
            const originalNotes = [
                cleanOldNotes,
                `📦 [Completado Parcial ${pickingPct}%] -> Faltantes en ${newOrderNumber}`
            ].filter(Boolean).join(' | ');

            const closed = await tx.order.update({
                where: { id },
                data: {
                    status: 'READY',
                    pickingProgress: pickingPct,
                    notes: originalNotes
                },
                include: {
                    items: { include: { product: true, pickingItems: true } },
                    distributor: true
                }
            });

            return { updatedOrder: closed, backorder: newOrder };
        });

        // ── Consume FinishedLotStock for scanned lots (outside tx to avoid deadlock) ──
        const lotConsumptionResults = [];
        for (const item of itemScanned.filter(i => i.scannedQty > 0)) {
            const pickingItems = order.items.find(i => i.id === item.id)?.pickingItems || [];
            const lotQtys = {};
            for (const pi of pickingItems) {
                const lot = pi.lotNumber;
                if (lot) lotQtys[lot] = (lotQtys[lot] || 0) + pi.scannedQty;
            }

            for (const [lotNumber, qty] of Object.entries(lotQtys)) {
                try {
                    await finishedLotService.consumeForOrder({
                        productId: item.productId,
                        lotNumber,
                        quantity: qty,
                        orderId: id,
                        userId: req.user.id,
                    });
                    lotConsumptionResults.push({ lotNumber, qty, status: 'OK' });
                    console.log(`[completeWithBackorder] ✅ Consumed ${qty} from lot ${lotNumber} for order ${updatedOrder.orderNumber}`);
                } catch (lotErr) {
                    lotConsumptionResults.push({ lotNumber, qty, status: 'FAILED', error: lotErr.message });
                    console.warn(`[completeWithBackorder] ⚠️ Lot consumption failed for ${lotNumber} qty=${qty}: ${lotErr.message}`);
                }
            }
        }

        // Socket notification for the new backorder
        const io = req.app?.get?.('io');
        if (io) {
            io.emit('order:new', {
                id: backorder.id,
                orderNumber: backorder.orderNumber,
                distributor: order.distributor?.name,
                source: 'backorder'
            });
        }

        console.log(`[completeWithBackorder] ✅ Order ${order.orderNumber} closed → Backorder ${backorder.orderNumber} created with ${deficitItems.length} items for ${order.distributor?.name}`);

        res.json({
            success: true,
            message: `Separación completada. Nuevo pedido ${backorder.orderNumber} creado con ${deficitItems.length} productos faltantes.`,
            data: updatedOrder,
            backorder: {
                id: backorder.id,
                orderNumber: backorder.orderNumber,
                itemCount: backorder.items.length,
                items: backorder.items.map(i => ({
                    product: i.product?.name,
                    quantity: i.requestedQty
                }))
            },
            lotConsumption: lotConsumptionResults,
        });
    } catch (error) {
        console.error('Error completing picking with backorder:', error);
        res.status(500).json({ success: false, error: 'Error al completar con backorder: ' + error.message });
    }
};

/**
 * Get picking progress for an order
 * GET /api/orders/:id/picking-progress
 */
exports.getPickingProgress = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                barcode: true,
                                packSize: true
                            }
                        },
                        pickingItems: true
                    }
                },
                picker: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        // Calculate detailed progress
        // Use allocatedQty as target when set (partial fulfillment); fallback to requestedQty
        const itemsProgress = order.items.map(item => {
            const targetQty = item.allocatedQty || item.requestedQty;
            const scannedQty = item.pickingItems.reduce((sum, pi) => sum + pi.scannedQty, 0);
            const progress = Math.min(100, Math.round((scannedQty / targetQty) * 100));

            return {
                itemId: item.id,
                productName: item.product.name,
                requestedQty: targetQty,
                scannedQty,
                progress,
                completed: scannedQty >= targetQty,
                pickingItems: item.pickingItems
            };
        });

        const totalRequested = order.items.reduce((sum, item) => sum + (item.allocatedQty || item.requestedQty), 0);
        const totalScanned = order.items.reduce((sum, item) =>
            sum + item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0), 0
        );

        res.json({
            success: true,
            data: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                pickingProgress: Math.min(100, totalRequested > 0 ? Math.round((totalScanned / totalRequested) * 100) : 0),
                pickingStartedAt: order.pickingStartedAt,
                picker: order.picker,
                totalRequested,
                totalScanned,
                itemsProgress,
                itemsCompleted: itemsProgress.filter(i => i.completed).length,
                itemsTotal: itemsProgress.length
            }
        });
    } catch (error) {
        console.error('Error getting picking progress:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener el progreso'
        });
    }
};

/**
 * ADMIN ONLY: Remove a scanned picking item (unscan / unmark)
 * DELETE /api/orders/:id/picking-item/:pickingItemId
 */
exports.unscanItem = async (req, res) => {
    try {
        const { id, pickingItemId } = req.params;

        // Only ADMIN can unscan
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden desmarcar items escaneados'
            });
        }

        // Verify picking item exists and belongs to this order
        const pickingItem = await prisma.orderPickingItem.findUnique({
            where: { id: pickingItemId },
            include: {
                orderItem: {
                    include: { pickingItems: true }
                }
            }
        });

        if (!pickingItem) {
            return res.status(404).json({ success: false, error: 'Item de picking no encontrado' });
        }

        // Verify it belongs to this order
        const orderItem = await prisma.orderItem.findUnique({
            where: { id: pickingItem.orderItemId },
            select: { orderId: true }
        });

        if (orderItem.orderId !== id) {
            return res.status(400).json({ success: false, error: 'El item no pertenece a esta orden' });
        }

        // Delete the picking record
        await prisma.orderPickingItem.delete({ where: { id: pickingItemId } });

        // Recalculate order picking progress
        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: { include: { pickingItems: true } } }
        });

        const totalRequested = order.items.reduce((sum, item) => sum + item.requestedQty, 0);
        const totalScanned = order.items.reduce((sum, item) =>
            sum + item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0), 0
        );
        const progress = totalRequested > 0 ? Math.min(100, Math.round((totalScanned / totalRequested) * 100)) : 0;

        await prisma.order.update({
            where: { id },
            data: { pickingProgress: progress }
        });

        res.json({
            success: true,
            message: `Item desmarcado. Progreso actualizado a ${progress}%`,
            data: { progress, totalScanned, totalRequested }
        });
    } catch (error) {
        console.error('Error unscanning item:', error);
        res.status(500).json({ success: false, error: 'Error al desmarcar el item' });
    }
};

/**
 * Admin: Revert order from READY back to IN_PICKING
 * POST /api/orders/:id/revert-to-picking
 */
exports.revertToPicking = async (req, res) => {
    try {
        const { id } = req.params;

        // Only ADMIN
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, error: 'Solo administradores pueden devolver pedidos a alistamiento' });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            select: { id: true, orderNumber: true, status: true, notes: true }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'READY') {
            return res.status(400).json({ success: false, error: `El pedido está en estado "${order.status}", solo se pueden devolver pedidos en estado Listo` });
        }

        const revertNote = `[Devuelto a alistamiento por ${req.user.name || 'Admin'} el ${new Date().toLocaleDateString('es-CO')}]`;
        const updatedNotes = [order.notes || '', revertNote].filter(Boolean).join(' | ');

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'IN_PICKING',
                notes: updatedNotes
            }
        });

        console.log(`[revertToPicking] ✅ Order ${order.orderNumber} reverted READY → IN_PICKING by ${req.user.name}`);

        res.json({
            success: true,
            message: `Pedido ${order.orderNumber} devuelto a En Alistamiento`,
            data: updated
        });
    } catch (error) {
        console.error('Error reverting order:', error);
        res.status(500).json({ success: false, error: 'Error al devolver el pedido' });
    }
};
