const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

const prisma = new PrismaClient();

/**
 * Admin/Logistics: Approve an order
 * Allocates inventory and changes status to APPROVED
 */
exports.approveOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const approverId = req.user.id;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: true
                    }
                },
                distributor: {
                    select: {
                        name: true,
                        email: true
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

        if (order.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: `No se puede aprobar un pedido con estado ${order.status}`
            });
        }

        // Note: Stock validation removed — backorders are allowed.
        // Insufficient stock items will be fulfilled from upcoming production.

        const { skipInsufficient } = req.body || {};

        // Approve and allocate in transaction
        const updated = await prisma.$transaction(async (tx) => {
            // If skipInsufficient: drop items with ZERO stock; keep items with partial stock (allocate available)
            if (skipInsufficient) {
                const zeroStockItems = order.items.filter(
                    item => (item.product?.currentStock || 0) === 0
                );
                if (zeroStockItems.length > 0) {
                    await tx.orderItem.deleteMany({
                        where: { id: { in: zeroStockItems.map(i => i.id) } }
                    });
                }
            }

            // Get remaining items: if skipInsufficient drop stock=0, else keep all
            const remainingItems = skipInsufficient
                ? order.items.filter(item => (item.product?.currentStock || 0) > 0)
                : order.items;

            if (remainingItems.length === 0) {
                throw new Error('No quedan productos con stock disponible para aprobar');
            }

            // Update order status
            const approvedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'APPROVED',
                    approvedBy: approverId,
                    approvedAt: new Date(),
                    ...(skipInsufficient ? { notes: (order.notes || '') + ' [Aprobado con stock parcial]' } : {})
                },
                include: {
                    items: { include: { product: true } },
                    distributor: true,
                    approver: { select: { name: true } }
                }
            });

            // Allocate quantities — partial for insufficient, full for sufficient
            for (const item of remainingItems) {
                const stock = item.product?.currentStock || 0;
                const allocated = skipInsufficient ? Math.min(stock, item.requestedQty) : item.requestedQty;
                const pending = item.requestedQty - allocated;
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: { allocatedQty: allocated, pendingQty: pending }
                });
            }

            return approvedOrder;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Notify distributor via WebSocket
        const io = req.app.get('io');
        if (io) {
            io.emit('order:approved', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId
            });
        }

        logger.info(`Order ${updated.orderNumber} approved by ${req.user.email}`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Approve Order Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al aprobar pedido'
        });
    }
};

/**
 * Admin/Logistics: Reject an order
 */
exports.rejectOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

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

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'REJECTED',
                rejectedReason: reason,
                approvedBy: req.user.id,
                approvedAt: new Date()
            },
            include: {
                distributor: true,
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        // Notify distributor
        const io = req.app.get('io');
        if (io) {
            io.emit('order:rejected', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                reason
            });
        }

        logger.info(`Order ${updated.orderNumber} rejected by ${req.user.email}`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Reject Order Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al rechazar pedido'
        });
    }
};

/**
 * Logistics: Mark order as ready for dispatch
 */
exports.markReady = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (!['APPROVED', 'IN_PROGRESS'].includes(order.status)) {
            return res.status(400).json({
                success: false,
                error: 'El pedido debe estar aprobado o en progreso'
            });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'READY',
                readyAt: new Date(),
                completionPercent: 100
            },
            include: {
                distributor: true,
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        // Notify
        const io = req.app.get('io');
        if (io) {
            io.emit('order:ready', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId
            });
        }

        logger.info(`Order ${updated.orderNumber} marked as ready`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Mark Ready Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al marcar como listo'
        });
    }
};

/**
 * Commercial: Invoice order (upload invoice PDF + account statement)
 * POST /api/orders/:id/invoice
 */
exports.invoiceOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: true,
                        pickingItems: { select: { scannedQty: true, lotNumber: true } }
                    }
                },
                distributor: true
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'READY') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar listo para facturar' });
        }

        // ── Create invoice in Siigo ──
        let siigoResult = null;
        let siigoError = null;
        try {
            const siigoService = require('../services/siigoService');
            siigoResult = await siigoService.createInvoice(order);
            logger.info(`✅ Siigo invoice created for order ${order.orderNumber}: ${siigoResult.name || siigoResult.number}`);
        } catch (siigoErr) {
            siigoError = siigoErr;
            logger.error(`⚠️ Siigo invoice failed for order ${order.orderNumber}:`, JSON.stringify(siigoErr));
            if (!siigoResult) {
                return res.status(500).json({
                    success: false,
                    error: 'Error creando factura en Siigo',
                    siigoError: siigoErr.error || siigoErr.message || 'Error desconocido',
                    siigoDetails: siigoErr.details || []
                });
            }
        }

        const invoiceRef = siigoResult?.name || siigoResult?.number?.toString() || 'N/A';

        // ── Mark as INVOICED + deduct FinishedLotStock in a single transaction ──
        const updated = await prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'INVOICED',
                    invoicedAt: new Date(),
                    invoicedBy: req.user.id,
                    invoiceNumber: invoiceRef !== 'N/A' ? invoiceRef : null,
                    invoicePdfUrl: siigoResult?.public_url || null
                },
                include: { distributor: { select: { name: true } } }
            });

            // ── FIFO deduction from PRODUCTO_TERMINADO ──────────────────────────
            // For every order item, consume the scanned quantity from finished lots.
            // Creates a FinishedLotTransfer record per lot consumed so the
            // reconciliation dashboard can show "Salida factura FV-2-xxxx".
            for (const item of order.items) {
                const scannedQty = (item.pickingItems || []).reduce((s, p) => s + p.scannedQty, 0);
                if (scannedQty <= 0 || !item.productId) continue;

                const lots = await tx.finishedLotStock.findMany({
                    where: {
                        productId: item.productId,
                        zone: 'PRODUCTO_TERMINADO',
                        currentQuantity: { gt: 0 },
                        status: { not: 'DEPLETED' }
                    },
                    orderBy: { createdAt: 'asc' }  // FIFO
                });

                let remaining = scannedQty;
                for (const lot of lots) {
                    if (remaining <= 0) break;
                    const consume = Math.min(remaining, lot.currentQuantity);
                    const newQty = lot.currentQuantity - consume;

                    await tx.finishedLotStock.update({
                        where: { id: lot.id },
                        data: {
                            currentQuantity: newQty,
                            status: newQty <= 0 ? 'DEPLETED'
                                : newQty < (lot.initialQuantity || 1) * 0.1 ? 'LOW'
                                : 'AVAILABLE'
                        }
                    });

                    await tx.finishedLotTransfer.create({
                        data: {
                            finishedLotStockId: lot.id,
                            productId: item.productId,
                            lotNumber: lot.lotNumber,
                            fromZone: 'PRODUCTO_TERMINADO',
                            toZone: 'BODEGA',
                            quantity: consume,
                            reason: `Salida · Factura ${invoiceRef} · Pedido ${order.orderNumber}`,
                            orderId: order.id,
                            transferredById: req.user.id,
                            observations: `${consume} uds → ${order.distributor?.name || 'distribuidor'}`
                        }
                    });

                    remaining -= consume;
                    logger.info(`  📤 ${item.product?.sku} lote ${lot.lotNumber}: -${consume} uds (queda: ${newQty})`);
                }

                if (remaining > 0) {
                    logger.warn(`[invoiceOrder] ⚠️ ${item.product?.sku}: ${remaining} uds sin lote PT — sincronizar con Siigo`);
                }
            }

            return updatedOrder;
        });

        logger.info(`Order ${updated.orderNumber} invoiced by ${req.user.name || req.user.id} → Siigo: ${invoiceRef}`);

        res.json({
            success: true,
            data: updated,
            siigoInvoice: siigoResult ? { id: siigoResult.id, number: siigoResult.number, name: siigoResult.name } : null
        });

    } catch (error) {
        logger.error('Invoice Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al facturar pedido' });
    }
};


/**
 * Logistics: Dispatch order with enhanced details + auto transport guide
 * POST /api/orders/:id/dispatch
 */
exports.dispatchOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            driverName, licensePlate, driverCedula, driverPhone,
            amountPaid, destination, destinationCity, dispatchTime, dispatchNotes,
            receiverName, receiverPhone
        } = req.body;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { name: true, packSize: true } } } }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'INVOICED') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar facturado para despachar' });
        }

        if (!driverName || !licensePlate || !destination) {
            return res.status(400).json({ success: false, error: 'Nombre del conductor, placa y destino son requeridos' });
        }

        // Auto-calc total weight based on product name
        const getWeightGrams = (name) => {
            const n = (name || '').toUpperCase();
            if (n.includes('SIROPE') || n.includes('GENIALITY')) return n.includes('1000') ? 1300 : n.includes('360') ? 500 : 1300;
            if (n.includes('LIQUIMON')) return n.includes('1000') ? 1000 : 500;
            const m = n.match(/(\d+)\s*GR/); if (m) return parseInt(m[1]);
            return 350;
        };
        const totalWeightKg = order.items.reduce((sum, item) => {
            return sum + ((item.allocatedQty || 0) * getWeightGrams(item.product?.name) / 1000);
        }, 0);

        // Auto-generate transport guide number
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
        const count = await prisma.order.count({ where: { transportGuideNumber: { not: null } } });
        const transportGuideNumber = `GUIA-${dateStr}-${String(count + 1).padStart(4, '0')}`;

        // Deduct from physical stock when dispatching
        const updated = await prisma.$transaction(async (tx) => {
            const dispatchedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'DISPATCHED',
                    dispatchedAt: now,
                    driverName,
                    licensePlate: licensePlate.toUpperCase(),
                    driverCedula,
                    driverPhone: driverPhone || null,
                    amountPaid: amountPaid ? parseFloat(amountPaid) : null,
                    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
                    dispatchTime: dispatchTime || now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
                    destination,
                    destinationCity: destinationCity || null,
                    dispatchNotes,
                    receiverName: receiverName || null,
                    receiverPhone: receiverPhone || null,
                    transportGuideNumber,
                    trackingGuide: transportGuideNumber
                },
                include: {
                    items: { include: { product: true } },
                    distributor: true
                }
            });

            // Deduct stock
            for (const item of dispatchedOrder.items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { currentStock: { decrement: item.allocatedQty } }
                });

                // Update inventory alternate (safe — skip if not found)
                try {
                    await tx.inventoryAlternate.update({
                        where: { productId: item.productId },
                        data: { reservedQty: { decrement: item.allocatedQty } }
                    });
                } catch (e) { /* No alternate record */ }
            }

            return dispatchedOrder;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Notify
        const io = req.app.get('io');
        if (io) {
            io.emit('order:dispatched', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                transportGuideNumber
            });
        }

        logger.info(`Order ${updated.orderNumber} dispatched — guide: ${transportGuideNumber}, driver: ${driverName}`);

        res.json({ success: true, data: updated });

    } catch (error) {
        logger.error('Dispatch Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al despachar pedido' });
    }
};

/**
 * Mark order as DELIVERED
 * POST /api/orders/:id/deliver
 * Can include a signed guide image upload
 */
exports.deliverOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: { distributor: { select: { name: true, id: true } } }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'DISPATCHED') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar despachado para confirmar entrega' });
        }

        // Distributors can only deliver their own orders
        if (req.user.role === 'DISTRIBUIDOR' && order.distributorId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'No autorizado' });
        }

        const data = {
            status: 'DELIVERED',
            deliveredAt: new Date()
        };

        // If a signed guide file was uploaded
        if (req.file) {
            data.signedGuideUrl = `/uploads/signed-guides/${req.file.filename}`;
        }

        const updated = await prisma.order.update({
            where: { id },
            data,
            include: { distributor: { select: { name: true } } }
        });

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('order:delivered', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                confirmedBy: req.user.name || req.user.email
            });
        }

        logger.info(`Order ${updated.orderNumber} delivered — confirmed by ${req.user.name || req.user.email}`);

        res.json({ success: true, data: updated });

    } catch (error) {
        logger.error('Deliver Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al confirmar entrega' });
    }
};

/**
 * Get printable transport guide HTML
 * GET /api/orders/:id/transport-guide
 */
exports.getTransportGuide = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { name: true, sku: true, packSize: true } } } },
                distributor: { select: { name: true, email: true } }
            }
        });

        if (!order || !order.transportGuideNumber) {
            return res.status(404).json({ success: false, error: 'Guía no encontrada' });
        }

        const getWeightG = (name) => {
            const n = (name || '').toUpperCase();
            if (n.includes('SIROPE') || n.includes('GENIALITY')) return n.includes('1000') ? 1300 : n.includes('360') ? 500 : 1300;
            if (n.includes('LIQUIMON')) return n.includes('1000') ? 1000 : 500;
            const m = n.match(/(\d+)\s*GR/); if (m) return parseInt(m[1]);
            return 350;
        };
        const rows = order.items.map(item => {
            const qty = item.allocatedQty || 0;
            const weightG = getWeightG(item.product?.name);
            const unitsPerBox = (item.product?.packSize && item.product.packSize > 1) ? item.product.packSize : 1;
            const boxes = Math.ceil(qty / unitsPerBox);
            const weightKg = (qty * weightG / 1000).toFixed(2);
            return `<tr>
                <td>${item.product?.name || item.product?.sku}</td>
                <td style="text-align:center">${qty}</td>
                <td style="text-align:center">${boxes}</td>
                <td style="text-align:center">${weightKg} kg</td>
            </tr>`;
        }).join('');

        const totalUnits = order.items.reduce((s, i) => s + (i.allocatedQty || 0), 0);
        const totalBoxes = order.items.reduce((s, item) => {
            const qty = item.allocatedQty || 0;
            const unitsPerBox = (item.product?.packSize && item.product.packSize > 1) ? item.product.packSize : 1;
            return s + Math.ceil(qty / unitsPerBox);
        }, 0);

        // ── Category summary: group boxes by product type/size ──
        const categories = [
            { key: 'sirope', label: 'Siropes', color: '#7C3AED', match: (n) => n.includes('SIROPE') || n.includes('GENIALITY') },
            { key: '3400',   label: '3400 GR', color: '#DC2626', match: (n) => !n.includes('SIROPE') && !n.includes('GENIALITY') && n.includes('3400') },
            { key: '1150',   label: '1150 GR', color: '#EA580C', match: (n) => !n.includes('SIROPE') && !n.includes('GENIALITY') && n.includes('1150') },
            { key: '500',    label: '500 GR',  color: '#0891B2', match: (n) => !n.includes('SIROPE') && !n.includes('GENIALITY') && n.includes('500') },
            { key: '360',    label: '360 ML',  color: '#4F46E5', match: (n) => !n.includes('SIROPE') && !n.includes('GENIALITY') && n.includes('360') },
            { key: '350',    label: '350 GR',  color: '#16A34A', match: (n) => !n.includes('SIROPE') && !n.includes('GENIALITY') && n.includes('350') },
        ];
        const catSummary = {};
        categories.forEach(c => { catSummary[c.key] = { boxes: 0, units: 0, weightKg: 0 }; });
        catSummary['otros'] = { boxes: 0, units: 0, weightKg: 0 };

        order.items.forEach(item => {
            const qty = item.allocatedQty || 0;
            if (qty <= 0) return;
            const name = (item.product?.name || '').toUpperCase();
            const unitsPerBox = (item.product?.packSize && item.product.packSize > 1) ? item.product.packSize : 1;
            const boxes = Math.ceil(qty / unitsPerBox);
            const weightKg = qty * getWeightG(item.product?.name) / 1000;
            const cat = categories.find(c => c.match(name));
            const key = cat ? cat.key : 'otros';
            catSummary[key].boxes += boxes;
            catSummary[key].units += qty;
            catSummary[key].weightKg += weightKg;
        });

        const catChips = categories
            .filter(c => catSummary[c.key].boxes > 0)
            .map(c => {
                const d = catSummary[c.key];
                return `<div style="flex:1;min-width:120px;background:${c.color}10;border:2px solid ${c.color}30;border-radius:10px;padding:10px 12px;text-align:center">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${c.color};letter-spacing:1px;margin-bottom:4px">${c.label}</div>
                    <div style="font-size:22px;font-weight:900;color:${c.color}">${d.boxes}</div>
                    <div style="font-size:10px;color:#666">cajas · ${d.units} uds</div>
                    <div style="font-size:9px;color:#999;margin-top:2px">${d.weightKg.toFixed(1)} kg</div>
                </div>`;
            }).join('');
        // Add "otros" if exists
        const otrosChip = catSummary['otros'].boxes > 0
            ? `<div style="flex:1;min-width:120px;background:#f1f5f9;border:2px solid #cbd5e1;border-radius:10px;padding:10px 12px;text-align:center">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:1px;margin-bottom:4px">Otros</div>
                <div style="font-size:22px;font-weight:900;color:#64748b">${catSummary['otros'].boxes}</div>
                <div style="font-size:10px;color:#666">cajas · ${catSummary['otros'].units} uds</div>
                <div style="font-size:9px;color:#999;margin-top:2px">${catSummary['otros'].weightKg.toFixed(1)} kg</div>
            </div>`
            : '';

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Guía de Transporte - ${order.transportGuideNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7C3AED; padding-bottom: 15px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 800; color: #7C3AED; }
        .guide-number { font-size: 18px; font-weight: 700; color: #7C3AED; text-align: right; }
        .guide-number small { display: block; font-size: 12px; color: #999; font-weight: 400; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
        .info-box { border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; }
        .info-box h4 { font-size: 11px; text-transform: uppercase; color: #7C3AED; margin-bottom: 6px; letter-spacing: 1px; }
        .info-box p { font-size: 14px; margin: 2px 0; }
        .info-box .value { font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #7C3AED; color: white; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
        tr:nth-child(even) { background: #F9FAFB; }
        .totals { display: flex; justify-content: flex-end; gap: 30px; margin-bottom: 15px; font-size: 14px; }
        .totals span { font-weight: 700; color: #7C3AED; }
        .cat-summary { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 25px; padding: 12px; background: #FAFAFA; border: 1px solid #E5E7EB; border-radius: 10px; }
        .cat-title { width: 100%; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #7C3AED; letter-spacing: 1.5px; margin-bottom: 4px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
        .sig-block { border-top: 2px solid #333; padding-top: 8px; text-align: center; }
        .sig-block p { font-size: 12px; color: #666; }
        .sig-block .name { font-weight: 700; font-size: 14px; color: #333; }
        .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #E5E7EB; padding-top: 10px; }
        @media print { body { padding: 15px; } }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="logo">LIQUIPOPS</div>
            <p style="font-size:12px;color:#666">Guía de Transporte de Mercancía</p>
        </div>
        <div class="guide-number">
            ${order.transportGuideNumber}
            <small>Pedido: ${order.orderNumber}</small>
        </div>
    </div>

    <div class="info-grid">
        <div class="info-box">
            <h4>Datos del Distribuidor</h4>
            <p><span class="value">${order.distributor?.name}</span></p>
            <p>${order.distributor?.email || ''}</p>
        </div>
        <div class="info-box">
            <h4>Datos del Conductor</h4>
            <p>Nombre: <span class="value">${order.driverName || ''}</span></p>
            <p>Cédula: <span class="value">${order.driverCedula || ''}</span></p>
            <p>Celular: <span class="value">${order.driverPhone || ''}</span></p>
            <p>Placa: <span class="value">${order.licensePlate || ''}</span></p>
        </div>
        <div class="info-box">
            <h4>Despacho</h4>
            <p>Fecha: <span class="value">${order.dispatchedAt ? new Date(order.dispatchedAt).toLocaleDateString('es-CO') : ''}</span></p>
            <p>Hora: <span class="value">${order.dispatchTime || ''}</span></p>
            <p>Destino: <span class="value">${order.destination || ''}</span></p>
            ${order.destinationCity ? `<p>Ciudad: <span class="value">${order.destinationCity}</span></p>` : ''}
            ${order.receiverName ? `<p>Recibe: <span class="value">${order.receiverName}</span></p>` : ''}
            ${order.receiverPhone ? `<p>Tel. contacto: <span class="value">${order.receiverPhone}</span></p>` : ''}
        </div>
        <div class="info-box">
            <h4>Resumen</h4>
            <p>Peso total: <span class="value">${order.totalWeightKg || 0} kg</span></p>
            <p>Monto: <span class="value">$${(order.amountPaid || 0).toLocaleString('es-CO')}</span></p>
            <p>Factura: <span class="value">${order.invoiceNumber || 'N/A'}</span></p>
        </div>
    </div>

    <table>
        <thead>
            <tr><th>Producto</th><th>Unidades</th><th>Cajas</th><th>Peso</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="totals">
        <div>Total productos: <span>${order.items.length}</span></div>
        <div>Total unidades: <span>${totalUnits}</span></div>
        <div>Total cajas: <span>${totalBoxes}</span></div>
        <div>Total peso: <span>${order.totalWeightKg || 0} kg</span></div>
    </div>

    <div class="cat-summary">
        <div class="cat-title">📦 Resumen de Cajas por Categoría</div>
        ${catChips}${otrosChip}
    </div>

    ${order.dispatchNotes ? `
    <div style="margin-bottom:20px;padding:12px;background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#EA580C;letter-spacing:1px;margin-bottom:6px">📝 Notas de Despacho</div>
        <p style="font-size:13px;color:#333;margin:0;white-space:pre-wrap">${order.dispatchNotes}</p>
    </div>
    ` : ''}

    <div class="signatures">
        <div class="sig-block">
            <p class="name">${order.driverName || 'Conductor'}</p>
            <p>C.C. ${order.driverCedula || ''}</p>
            <p>Firma del Conductor</p>
        </div>
        <div class="sig-block">
            <p class="name">Responsable Logística</p>
            <p>LIQUIPOPS SAS</p>
            <p>Firma Autorizada</p>
        </div>
    </div>

    <div class="footer">
        Documento generado automáticamente — ${new Date().toLocaleString('es-CO')}
    </div>

    <script>window.onload = () => window.print();</script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        logger.error('Transport Guide Error:', error);
        res.status(500).json({ success: false, error: 'Error al generar guía' });
    }
};

/**
 * Get order counts by status (for tab badges)
 */
exports.getOrderCounts = async (req, res) => {
    try {
        const where = {};
        // Scope to distributor if not admin
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        const statuses = ['PENDING', 'APPROVED', 'IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED', 'DELIVERED'];
        const counts = {};

        await Promise.all(statuses.map(async (status) => {
            counts[status] = await prisma.order.count({ where: { ...where, status } });
        }));

        res.json({ success: true, data: counts });
    } catch (error) {
        logger.error('Get Order Counts Error:', error);
        res.status(500).json({ success: false, error: 'Error al obtener contadores' });
    }
};

/**
 * Get all orders with filters (Admin/Logistics only)
 */
exports.getAllOrders = async (req, res) => {
    try {
        const { status, distributorId, page = 1, limit = 50, startDate, endDate } = req.query;
        const skip = (page - 1) * limit;

        const where = {};

        if (status) where.status = status;
        if (distributorId) where.distributorId = distributorId;

        // Scope to own orders for distributors
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    distributor: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            discountPercent: true,
                            reteFuente: true
                        }
                    },
                    items: {
                        orderBy: { sortOrder: 'asc' },
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    sku: true,
                                    type: true,
                                    packSize: true,
                                    currentStock: true
                                }
                            },
                            pickingItems: {
                                select: {
                                    id: true,
                                    lotNumber: true,
                                    scannedQty: true
                                }
                            }
                        }
                    },
                    approver: {
                        select: {
                            name: true
                        }
                    }
                },
                // Dynamic sort: FIFO for operational statuses, date-specific for post-invoicing
                orderBy: status === 'INVOICED'  ? { invoicedAt: 'desc' }
                       : status === 'DISPATCHED' ? { dispatchedAt: 'desc' }
                       : status === 'DELIVERED'  ? { deliveredAt: 'desc' }
                       : { createdAt: 'asc' },   // FIFO for PENDING/APPROVED/IN_PICKING/READY
                skip: Number(skip),
                take: Number(limit)
            }),
            prisma.order.count({ where })
        ]);

        // Calculate global true FIFO rank for active queues
        // This ensures distributors see their absolute position in the global queue
        if (['PENDING', 'APPROVED', 'IN_PICKING', 'READY'].includes(status)) {
            await Promise.all(orders.map(async (order) => {
                const rankCount = await prisma.order.count({
                    where: {
                        status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] },
                        createdAt: { lte: order.createdAt }
                    }
                });
                order.globalFifoRank = rankCount;
            }));
        }

        res.json({
            success: true,
            data: orders,
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get All Orders Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener pedidos'
        });
    }
};

/**
 * Get order by ID with full details
 */
/**
 * Get printable picking sheet HTML
 * GET /api/orders/:id/picking-sheet
 * Generates a print-friendly document to place on pallets during picking
 */
exports.getPickingSheet = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                        product: { select: { name: true, sku: true, packSize: true, barcode: true, flavor: true } },
                        pickingItems: { select: { lotNumber: true, scannedQty: true } }
                    }
                },
                distributor: { select: { name: true, email: true } }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        // Build product rows — use allocatedQty (actual dispatch qty), fallback to requestedQty
        const rows = order.items.map((item, idx) => {
            const qty = item.allocatedQty || item.requestedQty;
            const packSize = item.product?.packSize || 1;
            const boxes = Math.ceil(qty / packSize);
            const name = item.product?.name || item.product?.sku || '?';
            const sku = item.product?.sku || '';
            // Show if qty was adjusted from original request
            const wasAdjusted = item.allocatedQty && item.allocatedQty !== item.requestedQty;
            const adjustedNote = wasAdjusted
                ? `<div style="font-size:9px;color:#B45309;font-style:italic">Pedido: ${item.requestedQty} → Asignado: ${item.allocatedQty}</div>`
                : '';
            // Group picking items by lot
            const lotMap = {};
            (item.pickingItems || []).forEach(pi => {
                if (pi.lotNumber) lotMap[pi.lotNumber] = (lotMap[pi.lotNumber] || 0) + (pi.scannedQty || 0);
            });
            const lots = Object.entries(lotMap);
            const lotStr = lots.length > 0
                ? lots.map(([lot, q]) => `${lot} (${q} uds)`).join(', ')
                : '';
            return `<tr>
                <td style="text-align:center;font-weight:600">${idx + 1}</td>
                <td>
                    <div style="font-weight:600">${name}</div>
                    <div style="font-size:10px;color:#888">${sku}</div>
                    ${adjustedNote}
                </td>
                <td style="text-align:center;font-weight:700;font-size:16px">${boxes}</td>
                <td style="text-align:center;font-weight:700;font-size:14px;color:#7C3AED">${qty}</td>
                <td style="min-width:140px">${lotStr || '<span style="color:#ccc;font-style:italic">_______________</span>'}</td>
                <td style="text-align:center">
                    <div style="width:22px;height:22px;border:2px solid #7C3AED;border-radius:4px;margin:0 auto"></div>
                </td>
            </tr>`;
        }).join('');

        const totalBoxes = order.items.reduce((s, item) => {
            const qty = item.allocatedQty || item.requestedQty;
            const packSize = item.product?.packSize || 1;
            return s + Math.ceil(qty / packSize);
        }, 0);
        const totalUnits = order.items.reduce((s, i) => s + (i.allocatedQty || i.requestedQty), 0);

        const createdDate = new Date(order.createdAt).toLocaleDateString('es-CO', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
        const createdTime = new Date(order.createdAt).toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit'
        });

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Hoja de Picking - ${order.orderNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #333; font-size: 13px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7C3AED; padding-bottom: 12px; margin-bottom: 15px; }
        .logo { font-size: 22px; font-weight: 800; color: #7C3AED; }
        .logo small { display: block; font-size: 11px; font-weight: 400; color: #666; letter-spacing: 2px; text-transform: uppercase; }
        .order-info { text-align: right; }
        .order-info .order-number { font-size: 17px; font-weight: 800; color: #7C3AED; }
        .order-info .date { font-size: 11px; color: #888; }
        .info-bar { display: flex; gap: 20px; margin-bottom: 15px; padding: 10px 14px; background: #F5F3FF; border: 1px solid #E8E0FF; border-radius: 8px; }
        .info-bar .item { flex: 1; }
        .info-bar .label { font-size: 9px; text-transform: uppercase; color: #7C3AED; font-weight: 700; letter-spacing: 1px; }
        .info-bar .value { font-size: 14px; font-weight: 600; color: #333; }
        .notes { margin-bottom: 15px; padding: 8px 12px; background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 6px; font-size: 12px; color: #92400E; }
        .notes strong { color: #78350F; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        thead th { background: #7C3AED; color: white; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        thead th:first-child { border-radius: 6px 0 0 0; }
        thead th:last-child { border-radius: 0 6px 0 0; }
        tbody td { padding: 7px 10px; border-bottom: 1px solid #E5E7EB; font-size: 12px; vertical-align: middle; }
        tbody tr:nth-child(even) { background: #FAFAFA; }
        tbody tr:hover { background: #F5F3FF; }
        .totals-bar { display: flex; justify-content: flex-end; gap: 25px; padding: 10px 14px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
        .totals-bar .total-item { }
        .totals-bar .total-label { color: #666; }
        .totals-bar .total-value { font-weight: 800; color: #7C3AED; margin-left: 4px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 35px; }
        .sig-block { border-top: 2px solid #333; padding-top: 6px; text-align: center; }
        .sig-block .title { font-size: 11px; font-weight: 600; color: #333; }
        .sig-block .subtitle { font-size: 10px; color: #888; }
        .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #BBB; border-top: 1px solid #E5E7EB; padding-top: 8px; }
        @media print {
            body { padding: 15px; }
            .no-print { display: none; }
            tbody tr:hover { background: transparent; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="logo">
                LIQUIPOPS
                <small>Hoja de Separación / Picking</small>
            </div>
        </div>
        <div class="order-info">
            <div class="order-number">${order.orderNumber}</div>
            <div class="date">${createdDate} · ${createdTime}</div>
        </div>
    </div>

    <div class="info-bar">
        <div class="item">
            <div class="label">Distribuidor</div>
            <div class="value">${order.distributor?.name || 'N/A'}</div>
        </div>
        <div class="item">
            <div class="label">Total Productos</div>
            <div class="value">${order.items.length}</div>
        </div>
        <div class="item">
            <div class="label">Total Cajas</div>
            <div class="value">${totalBoxes}</div>
        </div>
        <div class="item">
            <div class="label">Total Unidades</div>
            <div class="value">${totalUnits}</div>
        </div>
    </div>

    ${order.notes ? `<div class="notes"><strong>📋 Nota:</strong> ${order.notes}</div>` : ''}

    <table>
        <thead>
            <tr>
                <th style="width:35px;text-align:center">#</th>
                <th>Producto</th>
                <th style="text-align:center;width:70px">Cajas</th>
                <th style="text-align:center;width:70px">Uds</th>
                <th style="width:160px">Lote</th>
                <th style="text-align:center;width:40px">✓</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="totals-bar">
        <div class="total-item">
            <span class="total-label">Productos:</span>
            <span class="total-value">${order.items.length}</span>
        </div>
        <div class="total-item">
            <span class="total-label">Cajas:</span>
            <span class="total-value">${totalBoxes}</span>
        </div>
        <div class="total-item">
            <span class="total-label">Unidades:</span>
            <span class="total-value">${totalUnits}</span>
        </div>
    </div>

    <div class="signatures">
        <div class="sig-block">
            <div class="title">Separado por</div>
            <div class="subtitle">Nombre y firma</div>
        </div>
        <div class="sig-block">
            <div class="title">Verificado por</div>
            <div class="subtitle">Nombre y firma</div>
        </div>
        <div class="sig-block">
            <div class="title">Recibido por</div>
            <div class="subtitle">Nombre y firma</div>
        </div>
    </div>

    <div class="footer">
        Documento generado automáticamente — ${new Date().toLocaleString('es-CO')} — LIQUIPOPS SAS
    </div>

    <script>window.onload = () => window.print();</script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        logger.error('Picking Sheet Error:', error);
        res.status(500).json({ success: false, error: 'Error al generar hoja de picking' });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                distributor: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        username: true
                    }
                },
                items: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                type: true,
                                flavor: true,
                                size: true
                            }
                        }
                    }
                },
                approver: {
                    select: {
                        id: true,
                        name: true,
                        email: true
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

        // Check permissions: distributors can only see their own orders
        if (req.user.role === 'DISTRIBUIDOR' && order.distributorId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'No autorizado'
            });
        }

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        logger.error('Get Order By ID Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener pedido'
        });
    }
};

/**
 * Get orders pending delivery for consolidation (matrix view)
 * GET /api/orders/pending-summary?statuses=APPROVED,IN_PICKING,READY,INVOICED,DISPATCHED&limit=2000
 */
exports.getPendingDeliverySummary = async (req, res) => {
    try {
        const rawStatuses = String(req.query.statuses || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '2000', 10) || 2000, 5000);

        const defaultStatuses = ['APPROVED', 'IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED'];
        const statuses = rawStatuses
            ? rawStatuses.split(',').map(s => s.trim()).filter(Boolean)
            : defaultStatuses;

        const where = { status: { in: statuses } };

        // Distributors only see their own orders
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        const orders = await prisma.order.findMany({
            where,
            include: {
                distributor: { select: { id: true, name: true } },
                items: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                flavor: true,
                                size: true,
                                accountGroup: true,
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });

        res.json({
            success: true,
            data: orders,
            meta: { total: orders.length, statuses }
        });
    } catch (error) {
        logger.error('Get Pending Summary Error:', error);
        res.status(500).json({ success: false, error: 'Error al obtener consolidado de pendientes' });
    }
};
