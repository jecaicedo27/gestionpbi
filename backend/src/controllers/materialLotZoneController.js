/**
 * materialLotZoneController.js
 * Handles the display, transfer, and printing of raw material lots across zones.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
// const { printTSPL } = require('../services/labelPrinterService'); // Assuming this exists or we can mock it based on others

// ── 1. GET Lots by Zone ───────────────────────────────────────────────────
exports.getLotsByZone = async (req, res) => {
    try {
        const lots = await prisma.materialLot.findMany({
            where: {
                // Include DEPLETED (qty=0) so operators see the result after adjustments
                status: { in: ['AVAILABLE', 'LOW_STOCK', 'DEPLETED'] },
                currentQuantity: { gte: 0 }
            },
            include: {
                product: {
                    select: {
                        name: true,
                        classification: true,
                        type: true,
                        accountGroup: true,
                        packSize: true,
                        currentStock: true
                    }
                }
            },
            orderBy: { receivedAt: 'desc' }
        });

        // Group by zone
        const grouped = {
            WAREHOUSE: [],
            PRODUCCION: [],
            CUARENTENA: [],
            NO_CONFORME: []
        };

        for (const lot of lots) {
            let zone = lot.zone || 'WAREHOUSE';
            if (zone === 'PRODUCTION') zone = 'PRODUCCION'; // Normalize to match frontend map
            
            if (!grouped[zone]) grouped[zone] = [];
            grouped[zone].push({
                id: lot.id,
                productId: lot.productId,
                productName: lot.siigoProductName || lot.product?.name,
                lotNumber: lot.lotNumber,
                sku: lot.siigoProductCode,
                currentQuantity: lot.currentQuantity,
                status: lot.status,
                siigoStock: lot.product?.currentStock || 0,
                unit: lot.unit,
                receivedAt: lot.receivedAt,
                qrData: lot.qrData,
                labelPrinted: lot.labelPrinted,
                packSize: lot.product?.packSize || null
            });
        }

        res.json(grouped);
    } catch (error) {
        logger.error('Error fetching material lots by zone:', error.message);
        res.status(500).json({ error: 'Error cargando zonas de materias primas' });
    }
};

// ── 4. POST Adjust stock (Ajuste Faltante/Sobrante) ─────────────────────────
exports.adjustLot = async (req, res) => {
    try {
        const { lotId, reason, adjustType } = req.body;
        const quantityAdjusted = req.body.quantityToAdjust || req.body.quantityToDeduct;
        const type = adjustType || 'SUBTRACT'; 
        const userId = req.user.id;

        if (!quantityAdjusted || quantityAdjusted <= 0) {
            return res.status(400).json({ error: 'La cantidad a ajustar debe ser mayor a 0' });
        }
        if (!lotId || !reason) {
            return res.status(400).json({ error: 'Se requiere el lote y el motivo del ajuste' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const source = await tx.materialLot.findUnique({
                where: { id: lotId }
            });

            if (!source) throw new Error('Lote no encontrado');

            let newSourceQty;
            if (type === 'SUBTRACT') {
                if (source.currentQuantity < quantityAdjusted) {
                    throw new Error(`Stock físico insuficiente: disponible ${source.currentQuantity}, solicitado descontar ${quantityAdjusted}`);
                }
                newSourceQty = source.currentQuantity - quantityAdjusted;
            } else {
                newSourceQty = source.currentQuantity + quantityAdjusted;
            }

            let status = 'AVAILABLE';
            if (newSourceQty === 0) status = 'DEPLETED';
            else if (newSourceQty < (source.initialQuantity * 0.1)) status = 'LOW_STOCK';

            await tx.materialLot.update({
                where: { id: lotId },
                data: { currentQuantity: newSourceQty, status }
            });

            const direction = type === 'SUBTRACT' ? 'BAJA / AJUSTE FALTANTE (-)' : 'INGRESO / AJUSTE SOBRANTE (+)';

            // Registrar trazabilidad
            if (source.productId) {
                await tx.zoneTransfer.create({
                    data: {
                        productId: source.productId,
                        materialLotId: source.id,
                        direction,
                        quantity: quantityAdjusted,
                        unit: source.unit,
                        lotNumber: source.lotNumber,
                        transferredById: userId,
                        observations: reason,
                        photos: JSON.stringify([])
                    }
                });
            }

            return { success: true, newQty: newSourceQty };
        });

        logger.info(`⚖️ Lote de Material ${lotId} ajustado por ${req.user.name} (${type === 'ADD' ? '+' : '-'}${quantityAdjusted} uds. Motivo: ${reason})`);
        res.json(result);
    } catch (error) {
        logger.error('Error material adjustment:', error.message);
        res.status(400).json({ error: error.message });
    }
};

// ── 2. POST Transfer stock ────────────────────────────────────────────────
exports.transferZone = async (req, res) => {
    try {
        const { sourceLotId, fromZone, toZone, quantity, observations } = req.body;
        const userId = req.user.id;

        if (fromZone === toZone) {
            return res.status(400).json({ error: 'Origen y destino no pueden ser iguales' });
        }
        if (!quantity || quantity <= 0) {
            return res.status(400).json({ error: 'La cantidad a transferir debe ser mayor a 0' });
        }
        if (!sourceLotId) {
            return res.status(400).json({ error: 'Se requiere el ID del lote origen' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Validate Source
            const source = await tx.materialLot.findUnique({
                where: { id: sourceLotId }
            });

            if (!source || source.currentQuantity < quantity) {
                const available = source?.currentQuantity || 0;
                throw new Error(`Stock insuficiente en origen: disponible ${available}, solicitado ${quantity}`);
            }

            // Normalizar destino (si mandan PRODUCCION, lo guardamos como PRODUCTION en la BD nativa)
            const internalToZone = toZone === 'PRODUCCION' ? 'PRODUCTION' : toZone;

            // 2. Decrement Source
            const newSourceQty = source.currentQuantity - quantity;
            let status = 'AVAILABLE';
            if (newSourceQty === 0) status = 'DEPLETED';
            else if (newSourceQty < (source.initialQuantity * 0.1)) status = 'LOW_STOCK';

            await tx.materialLot.update({
                where: { id: sourceLotId },
                data: { currentQuantity: newSourceQty, status }
            });

            // 3. Upsert Destination
            // Comprobamos si ya existe un MaterialLot idéntico en el destino para apilar (evitar fragmentación)
            const existingDest = await tx.materialLot.findFirst({
                where: {
                    productId: source.productId,
                    lotNumber: source.lotNumber,
                    zone: internalToZone,
                    status: { in: ['AVAILABLE', 'LOW_STOCK'] }
                }
            });

            let destId;
            if (existingDest) {
                const newInit = existingDest.initialQuantity + quantity;
                const newCurr = existingDest.currentQuantity + quantity;
                await tx.materialLot.update({
                    where: { id: existingDest.id },
                    data: {
                        initialQuantity: newInit,
                        currentQuantity: newCurr,
                        status: 'AVAILABLE'
                    }
                });
                destId = existingDest.id;
            } else {
                // Generar copia en destino
                const newDest = await tx.materialLot.create({
                    data: {
                        purchaseOrderItemId: source.purchaseOrderItemId,
                        siigoProductCode: source.siigoProductCode,
                        siigoProductName: source.siigoProductName,
                        lotNumber: source.lotNumber,
                        initialQuantity: quantity,
                        currentQuantity: quantity,
                        unit: source.unit,
                        qrData: source.qrData,
                        receivedAt: source.receivedAt,
                        expiresAt: source.expiresAt,
                        status: 'AVAILABLE',
                        productId: source.productId,
                        zone: internalToZone,
                        labelPrinted: false
                    }
                });
                destId = newDest.id;
            }

            // 4. Registrar trazabilidad
            if (source.productId) {
                await tx.zoneTransfer.create({
                    data: {
                        productId: source.productId,
                        materialLotId: source.id,
                        direction: `TRANSFER: ${fromZone} -> ${toZone}`,
                        quantity: quantity,
                        unit: source.unit,
                        lotNumber: source.lotNumber,
                        transferredById: userId,
                        observations: observations || null,
                        photos: JSON.stringify([])
                    }
                });
            }

            return { success: true };
        });

        logger.info(`📦 Material Lot ${req.body.sourceLotId} transferido por ${req.user.name} (${quantity} uds de ${fromZone} a ${toZone})`);
        res.json(result);
    } catch (error) {
        logger.error('Error material transfer:', error.message);
        res.status(400).json({ error: error.message });
    }
};

// ── 3. POST Print Label ───────────────────────────────────────────────────
exports.printLabel = async (req, res) => {
    try {
        const { lotId } = req.body;
        
        const lot = await prisma.materialLot.findUnique({
            where: { id: lotId },
            include: { product: true }
        });

        if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });

        // Build ZPL output for raw materials
        const name = lot.siigoProductName || lot.product?.name || 'Materia Prima';
        const lotNum = lot.lotNumber;
        const qty = `${lot.currentQuantity} ${lot.unit}`;
        const date = lot.receivedAt ? lot.receivedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        
        // El contenido del QR lo leemos de lot.qrData si existe (viene de recepcionController)
        let qrPayload = lot.qrData;
        if (!qrPayload) {
             qrPayload = JSON.stringify({
                 sku: lot.siigoProductCode,
                 lot: lotNum,
                 qty: lot.currentQuantity
             });
        }

        // Just mark as printed in DB
        await prisma.materialLot.update({
            where: { id: lotId },
            data: { labelPrinted: true, labelPrintedAt: new Date() }
        });

        // Generamos un formato visual genérico para TSPL/ZPL en el cliente (impresión local / Zebra)
        // Similar a microLabelUtils.js
        const zpl = `
^XA
^PW400
^LL200
^FO20,20^A0N,25,25^FD${name}^FS
^FO20,60^A0N,20,20^FDLote: ${lotNum}^FS
^FO20,90^A0N,20,20^FDCant: ${qty}^FS
^FO20,120^A0N,20,20^FDFecha: ${date}^FS
^FO280,30^BQN,2,4^FDA,${qrPayload}^FS
^XZ`;

        res.json({ success: true, zpl, payload: JSON.parse(qrPayload) });
    } catch (error) {
        logger.error('Error printing material label:', error.message);
        res.status(500).json({ error: 'Error generando etiqueta' });
    }
};
