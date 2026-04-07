const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

const prisma = new PrismaClient();

const createOrder = async (req, res) => {
    const { items } = req.body;
    const distributorId = req.user.id;

    try {
        // 1. Validate Items and Check Stock
        // We need to check both Physical Stock AND Available Stock (Physical - Reserved)
        // For MVP Phase 2, we will trust the frontend sent valid IDs, but we must check quantities.

        const productIds = items.map(i => i.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            include: { inventoryAlternate: true }
        });

        // Check availability
        for (const item of items) {
            const product = products.find(p => p.id === item.productId);
            if (!product) {
                return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
            }

            const reserved = product.inventoryAlternate?.reservedQty || 0;
            const available = product.currentStock - reserved;

            if (available < item.quantity) {
                return res.status(400).json({
                    error: `Stock insuficiente para ${product.name}. Disponible: ${available}, Solicitado: ${item.quantity}`
                });
            }

            // Validate full box
            if (product.packSize && product.packSize > 1 && item.quantity % product.packSize !== 0) {
                return res.status(400).json({
                    error: `${product.name}: solo se aceptan cajas completas de ${product.packSize} unidades. Pediste ${item.quantity}, debes pedir múltiplos de ${product.packSize}.`
                });
            }
        }

        // 2. Create Order Transaction
        // We use a transaction to ensure Order Creation AND Stock Reservation happen atomically.

        const result = await prisma.$transaction(async (tx) => {
            // Generate Order Number: ORD-COMERCIAL-DDMMYYYY-N
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const dateStr = `${dd}${mm}${yyyy}`;
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayCount = await tx.order.count({ where: { createdAt: { gte: startOfDay } } });
            const orderNumber = `ORD-COMERCIAL-${dateStr}-${todayCount + 1}`;

            // Create Order
            const order = await tx.order.create({
                data: {
                    orderNumber,
                    distributorId,
                    status: 'PENDING',
                    items: {
                        create: items.map((item, idx) => ({
                            productId: item.productId,
                            requestedQty: item.quantity,
                            pendingQty: item.quantity,
                            allocatedQty: 0,
                            sortOrder: idx
                        }))
                    }
                },
                include: { items: true }
            });

            // Reserve Stock (Update InventoryAlternate)
            for (const item of items) {
                await tx.inventoryAlternate.upsert({
                    where: { productId: item.productId },
                    update: {
                        reservedQty: { increment: item.quantity },
                        availableQty: { decrement: item.quantity } // Optional: sync availableQty field or calc on fly
                    },
                    create: {
                        productId: item.productId,
                        reservedQty: item.quantity,
                        availableQty: -item.quantity // Initial state if no record existed (should match product stock calc)
                    }
                });
            }

            return order;
        });

        // Invalidate dashboard cache as stock properties changed
        await cacheService.invalidatePattern('inventory:*');

        // Notify Logistics (via Socket.io if available)
        const io = req.app.get('io');
        if (io) {
            io.emit('order:new', {
                id: result.id,
                orderNumber: result.orderNumber,
                distributor: req.user.name
            });
        }

        logger.info(`Order created: ${result.orderNumber} by ${req.user.email}`);

        res.json({ success: true, data: result });

    } catch (error) {
        logger.error('Create Order Error:', error);
        res.status(500).json({ error: 'Error creando el pedido' });
    }
};

const getOrders = async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        const where = {};
        if (status) where.status = status;

        // Distributors only see their own orders
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    distributor: { select: { name: true, email: true, discountPercent: true, reteFuente: true } },
                    items: { include: { product: { select: { name: true, sku: true, currentStock: true, packSize: true, unit: true } } } }
                },
                orderBy: { createdAt: 'desc' },
                skip: Number(skip),
                take: Number(limit)
            }),
            prisma.order.count({ where })
        ]);

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
        logger.error('Get Orders Error:', error);
        res.status(500).json({ error: 'Error obteniendo pedidos' });
    }
};

const updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, trackingNumber, carrier } = req.body;

    try {
        const updateData = {
            status,
            // Update timestamps
            ...(status === 'READY' ? { readyAt: new Date() } : {}),
            ...(status === 'DISPATCHED' ? {
                dispatchedAt: new Date(),
                trackingGuide: trackingNumber,
                dispatchNotes: carrier
            } : {}),
            ...(status === 'INVOICED' ? { invoicedAt: new Date() } : {})
        };

        const order = await prisma.order.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Emit socket event
        const io = req.app.get('io');
        if (io) io.emit('order:updated', order);

        res.json({ success: true, data: order });
    } catch (error) {
        logger.error('Update Order Error:', error);
        res.status(500).json({ error: 'Error actualizando pedido' });
    }
};

// ─── Excel Template Download ──────────────────────────────────
const XLSX = require('xlsx');
const XLSX_STYLE = require('xlsx-js-style');

const getOrderTemplate = async (req, res) => {
    try {
        const allProducts = await prisma.product.findMany({
            where: { active: true, barcode: { not: '' }, group: { name: { in: ['LIQUIPOPS', 'GENIALITY'] } } },
            select: { id: true, name: true, barcode: true, packSize: true },
            orderBy: { name: 'asc' }
        });
        const products = allProducts.filter(p => /^\d+$/.test(p.barcode));

        // ── Style definitions ──
        const blueBg = { fgColor: { rgb: '1B3A5C' } };
        const greenBg = { fgColor: { rgb: '16A34A' } };
        const altBg = { fgColor: { rgb: 'EFF6FF' } };
        const whiteBg = { fgColor: { rgb: 'FFFFFF' } };
        const qtyBg = { fgColor: { rgb: 'DBEAFE' } };
        const footerBg = { fgColor: { rgb: 'F1F5F9' } };
        const wFont = { color: { rgb: 'FFFFFF' }, bold: true, name: 'Calibri', sz: 11 };
        const tFont = { color: { rgb: 'FFFFFF' }, bold: true, name: 'Calibri', sz: 14 };
        const dFont = { name: 'Calibri', sz: 10, color: { rgb: '1F2937' } };
        const bFont = { name: 'Consolas', sz: 10, color: { rgb: '374151' } };
        const thinB = { style: 'thin', color: { rgb: 'B8D4F0' } };
        const hairB = { style: 'hair', color: { rgb: 'D1E5F7' } };
        const accB = { style: 'medium', color: { rgb: '2563EB' } };

        const wsData = [];
        // Headers (row 0)
        wsData.push([
            { v: 'BARRAS', s: { font: wFont, fill: blueBg, alignment: { horizontal: 'left', vertical: 'center' }, border: { bottom: accB, right: thinB } } },
            { v: 'PRODUCTO', s: { font: wFont, fill: blueBg, alignment: { horizontal: 'left', vertical: 'center' }, border: { bottom: accB, right: thinB } } },
            { v: 'CANTIDADES A SOLICITAR', s: { font: wFont, fill: greenBg, alignment: { horizontal: 'center', vertical: 'center' }, border: { bottom: accB } } }
        ]);
        // Data (row 1+) — only cols A & B; col C added separately to keep it truly empty
        products.forEach((p, idx) => {
            const bg = idx % 2 === 1 ? altBg : whiteBg;
            wsData.push([
                { v: p.barcode || '', t: 's', s: { font: bFont, fill: bg, border: { bottom: hairB, left: thinB, right: hairB } } },
                { v: p.name, s: { font: dFont, fill: bg, border: { bottom: hairB, right: hairB } } }
            ]);
        });

        const ws = XLSX_STYLE.utils.aoa_to_sheet(wsData);

        // Add styled empty cells for quantity column C (rows 1..N, 0-indexed)
        const qtyCellStyle = { font: { name: 'Calibri', sz: 11, bold: true }, fill: qtyBg, alignment: { horizontal: 'center' }, border: { bottom: hairB, left: thinB, right: thinB } };
        products.forEach((_, idx) => {
            const cellRef = XLSX_STYLE.utils.encode_cell({ r: idx + 1, c: 2 });
            ws[cellRef] = { t: 'z', s: qtyCellStyle }; // type 'z' = empty/stub cell
        });
        // Update sheet range to include column C
        const range = XLSX_STYLE.utils.decode_range(ws['!ref']);
        range.e.c = 2; // ensure C column is included
        ws['!ref'] = XLSX_STYLE.utils.encode_range(range);

        ws['!cols'] = [{ wch: 18 }, { wch: 52 }, { wch: 26 }];
        ws['!rows'] = [{ hpt: 28 }];

        const wb = XLSX_STYLE.utils.book_new();
        XLSX_STYLE.utils.book_append_sheet(wb, ws, 'Pedido');

        // Instructions sheet
        const instrData = [
            [{ v: 'INSTRUCCIONES PARA HACER TU PEDIDO', s: { font: tFont, fill: blueBg, alignment: { horizontal: 'center', vertical: 'center' } } }],
            [{ v: '' }],
            [{ v: '1.  Ve a la pestana "Pedido"', s: { font: { name: 'Calibri', sz: 12 } } }],
            [{ v: '2.  En la columna C escribe las unidades que quieres', s: { font: { name: 'Calibri', sz: 12 } } }],
            [{ v: '3.  La columna A es el codigo de barras — NO la modifiques', s: { font: { name: 'Calibri', sz: 12 } } }],
            [{ v: '4.  Guarda el archivo y subelo en la plataforma', s: { font: { name: 'Calibri', sz: 12 } } }],
            [{ v: '' }],
            [{ v: 'IMPORTANTE:', s: { font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: 'DC2626' } } } }],
            [{ v: '  - Solo llena la columna C (resaltada en azul)', s: { font: { name: 'Calibri', sz: 11, color: { rgb: '4B5563' } } } }],
            [{ v: '  - Las cantidades son en UNIDADES, no en cajas', s: { font: { name: 'Calibri', sz: 11, color: { rgb: '4B5563' } } } }],
            [{ v: '  - Si quieres 3 cajas de x20, escribe 60', s: { font: { name: 'Calibri', sz: 11, color: { rgb: '4B5563' } } } }],
            [{ v: '  - Puedes ELIMINAR filas que no necesitas', s: { font: { name: 'Calibri', sz: 11, color: { rgb: '4B5563' } } } }],
        ];
        const wsInstr = XLSX_STYLE.utils.aoa_to_sheet(instrData);
        wsInstr['!cols'] = [{ wch: 65 }];
        wsInstr['!rows'] = [{ hpt: 36 }];
        XLSX_STYLE.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

        const buffer = XLSX_STYLE.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const d = new Date();
        const fileName = `OC_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);

    } catch (error) {
        console.error('❌ TEMPLATE ERROR:', error.message, error.stack);
        logger.error('Get Order Template Error:', error);
        res.status(500).json({ error: 'Error generando plantilla' });
    }
};

// ─── Excel Upload ─────────────────────────────────────────────

const createOrderFromExcel = async (req, res) => {
    try {
        let { distributorId } = req.body;

        // Distributors self-assign — they don't pick a distributor
        if (req.user.role === 'DISTRIBUIDOR') {
            distributorId = req.user.id;
        }

        if (!distributorId) return res.status(400).json({ error: 'distributorId es requerido' });
        if (!req.file) return res.status(400).json({ error: 'Archivo Excel es requerido' });

        // Validate distributor exists
        const distributor = await prisma.user.findUnique({
            where: { id: distributorId },
            select: { id: true, name: true, role: true }
        });
        if (!distributor) return res.status(404).json({ error: 'Distribuidor no encontrado' });

        // Parse Excel
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Skip header row (row 0), start from row 1
        // Current format: Col A = barcode, Col C (idx 2) = quantity
        // Legacy fallbacks: barcode at idx 1 with qty at idx 2-6
        const parsedItems = [];
        const warnings = [];
        const debugRows = []; // for debugging

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            // Smart barcode detection: try col A (new 3-col format); if not a barcode, try col B (legacy)
            const colA = String(row[0] || '').trim();
            const colB = String(row[1] || '').trim();
            const isColABarcode = /^\d{8,14}$/.test(colA);
            const barcode = isColABarcode ? colA : colB;

            // Smart quantity detection: try from right to left depending on format
            let qty = 0;
            if (isColABarcode) {
                // New 3-col format: qty at idx 2
                qty = parseFloat(row[2]) || 0;
            } else {
                // Legacy formats: qty could be at idx 2, 4, 5, or 6
                qty = parseFloat(row[6]) || parseFloat(row[5]) || parseFloat(row[4]) || parseFloat(row[2]) || 0;
            }
            const productName = String(row[isColABarcode ? 1 : 2] || '').trim();

            // Debug: capture first 5 rows
            if (i <= 5) {
                debugRows.push({ rowNum: i + 1, colA: row[0], colB: row[1], colC: row[2], colD: row[3], colE: row[4], colF: row[5], colG: row[6], parsedBarcode: barcode, parsedQty: qty, format: isColABarcode ? 'new-3col' : 'legacy' });
            }

            if (!barcode || qty <= 0) continue;

            // Find product by barcode
            const product = await prisma.product.findFirst({
                where: { barcode },
                select: { id: true, name: true, sku: true, barcode: true, currentStock: true, packSize: true }
            });

            if (!product) {
                warnings.push(`Fila ${i + 1}: código de barras ${barcode} ("${productName}") no encontrado`);
                continue;
            }

            // Validate full box: quantity must be multiple of packSize
            if (product.packSize && product.packSize > 1 && qty % product.packSize !== 0) {
                warnings.push(`${product.name}: pediste ${qty} unidades, pero solo se aceptan cajas completas de ${product.packSize}. Debes pedir múltiplos de ${product.packSize} (ej: ${product.packSize}, ${product.packSize * 2}, ${product.packSize * 3}...)`);
                continue;
            }

            parsedItems.push({
                productId: product.id,
                quantity: qty,
                sortOrder: parsedItems.length,
                product
            });
        }

        if (parsedItems.length === 0) {
            const foundBarcodes = rows.slice(1).filter(r => /^\d{8,14}$/.test(String(r[0] || '').trim())).length;
            let errorMsg;
            if (warnings.length > 0 && warnings.some(w => w.includes('cajas completas'))) {
                errorMsg = 'Ningún producto cumple con la condición de caja completa. Corrige las cantidades:';
            } else if (foundBarcodes > 0) {
                errorMsg = `Se encontraron ${foundBarcodes} productos pero ninguno tiene cantidad. Llena la columna C.`;
            } else {
                errorMsg = 'No se encontraron productos válidos en el Excel';
            }
            return res.status(400).json({
                error: errorMsg,
                warnings,
                debug: { totalRows: rows.length, headerRow: rows[0], sampleRows: debugRows }
            });
        }

        // If ?preview=1, return parsed items without creating order
        if (req.query.preview === '1') {
            // ═══ Calculate REAL available stock (same formula as template/catalog) ═══
            const previewProductIds = parsedItems.map(i => i.productId);

            const finishedStocks = await prisma.finishedLotStock.groupBy({
                by: ['productId'],
                where: { zone: 'PRODUCTO_TERMINADO', currentQuantity: { gt: 0 }, productId: { in: previewProductIds } },
                _sum: { currentQuantity: true }
            });
            const physicalMap = {};
            finishedStocks.forEach(s => { physicalMap[s.productId] = s._sum.currentQuantity || 0; });

            const now = new Date();
            const cartRes = await prisma.cartReservation.groupBy({
                by: ['productId'],
                where: { expiresAt: { gt: now }, productId: { in: previewProductIds } },
                _sum: { quantity: true }
            });
            const cartMap = {};
            cartRes.forEach(r => { cartMap[r.productId] = r._sum.quantity || 0; });

            const pendingItems = await prisma.orderItem.findMany({
                where: { order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] } }, productId: { in: previewProductIds } },
                select: { productId: true, requestedQty: true }
            });
            const orderMap = {};
            pendingItems.forEach(item => {
                orderMap[item.productId] = (orderMap[item.productId] || 0) + item.requestedQty;
            });

            return res.json({
                preview: true,
                items: parsedItems.map(i => {
                    const physical = physicalMap[i.productId] || 0;
                    const cartReserved = cartMap[i.productId] || 0;
                    const orderReserved = orderMap[i.productId] || 0;
                    const available = Math.max(0, physical - cartReserved - orderReserved);
                    return {
                        productId: i.productId,
                        name: i.product.name,
                        sku: i.product.sku,
                        barcode: i.product.barcode,
                        quantity: i.quantity,
                        currentStock: available,
                        packSize: i.product.packSize
                    };
                }),
                warnings
            });
        }

        // Create order (same transactional pattern as createOrder)
        const result = await prisma.$transaction(async (tx) => {
            // Generate order number: ORD-COMERCIAL-DDMMYYYY-N
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const dateStr = `${dd}${mm}${yyyy}`;
            // Count orders created today to get the sequence number
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayCount = await tx.order.count({ where: { createdAt: { gte: startOfDay } } });
            const orderNumber = `ORD-COMERCIAL-${dateStr}-${todayCount + 1}`;

            const order = await tx.order.create({
                data: {
                    orderNumber,
                    distributorId,
                    status: 'PENDING',
                    notes: `[Excel] Pedido cargado desde archivo Excel`,
                    items: {
                        create: parsedItems.map((item, idx) => ({
                            productId: item.productId,
                            requestedQty: item.quantity,
                            pendingQty: item.quantity,
                            allocatedQty: 0,
                            sortOrder: item.sortOrder ?? idx
                        }))
                    }
                },
                include: {
                    items: { include: { product: { select: { name: true, sku: true } } } },
                    distributor: { select: { name: true } }
                }
            });

            // Reserve stock
            for (const item of parsedItems) {
                await tx.inventoryAlternate.upsert({
                    where: { productId: item.productId },
                    update: { reservedQty: { increment: item.quantity }, availableQty: { decrement: item.quantity } },
                    create: { productId: item.productId, reservedQty: item.quantity, availableQty: -item.quantity }
                });
            }

            return order;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Socket notification
        const io = req.app.get('io');
        if (io) {
            io.emit('order:new', {
                id: result.id,
                orderNumber: result.orderNumber,
                distributor: distributor.name,
                source: 'excel'
            });
        }

        logger.info(`Excel order created: ${result.orderNumber} for ${distributor.name} (${parsedItems.length} items)`);

        res.json({ success: true, data: result, warnings });

    } catch (error) {
        logger.error('Create Order from Excel Error:', error);
        res.status(500).json({ error: 'Error creando pedido desde Excel: ' + error.message });
    }
};

// Import admin/logistics methods
const {
    approveOrder,
    rejectOrder,
    markReady,
    invoiceOrder,
    dispatchOrder,
    deliverOrder,
    getTransportGuide,
    getPickingSheet,
    getAllOrders,
    getOrderById,
    getOrderCounts
} = require('./orderControllerExtensions');

// ─── Partial Update (PATCH) ────────────────────────────────────
const patchOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = ['packingMode', 'notes', 'dispatchNotes'];
        const data = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                data[field] = req.body[field];
            }
        }
        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
        }
        const order = await prisma.order.update({ where: { id }, data });
        res.json({ success: true, data: order });
    } catch (error) {
        logger.error('Patch Order Error:', error);
        res.status(500).json({ success: false, error: 'Error actualizando pedido' });
    }
};

module.exports = {
    createOrder,
    createOrderFromExcel,
    getOrderTemplate,
    getOrders,
    updateOrderStatus,
    patchOrder,
    approveOrder,
    rejectOrder,
    markReady,
    invoiceOrder,
    dispatchOrder,
    deliverOrder,
    getTransportGuide,
    getPickingSheet,
    getAllOrders,
    getOrderById,
    getOrderCounts
};
