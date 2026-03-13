/**
 * lotLabelPdf.js — Generate printable lot labels (small stickers)
 */
const PDFDocument = require('pdfkit');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /procurement/lots/:id/label — Generate a label PDF for a single lot
 */
async function generateLotLabel(req, res) {
    try {
        const lot = await prisma.materialLot.findUnique({
            where: { id: req.params.id },
            include: {
                purchaseOrderItem: {
                    select: {
                        purchaseOrder: { select: { orderNumber: true, supplierName: true } }
                    }
                }
            }
        });

        if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });

        // Create a small label ~ 10cm x 6cm
        const doc = new PDFDocument({
            size: [283, 170], // 10cm x 6cm in points
            margin: 10
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Lote-${lot.lotNumber}.pdf"`);
        doc.pipe(res);

        // ── Company ──
        doc.fontSize(7).font('Helvetica').fillColor('#999')
            .text('POPPING BOBA INTERNATIONAL S.A.S.', 10, 8, { width: 263, align: 'center' });

        // ── Product Name ──
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
            .text(lot.siigoProductName, 10, 20, { width: 263, align: 'center' });

        // ── SKU + Lot ──
        doc.fontSize(8).font('Helvetica').fillColor('#333');
        const y1 = 40;

        // Left column
        doc.font('Helvetica-Bold').text('SKU:', 10, y1);
        doc.font('Helvetica').text(lot.siigoProductCode, 45, y1);

        doc.font('Helvetica-Bold').text('Lote:', 10, y1 + 14);
        doc.font('Helvetica').text(lot.lotNumber, 45, y1 + 14);

        // Right column
        doc.font('Helvetica-Bold').text('Cantidad:', 150, y1);
        const qtyText = lot.unit === 'unidad' || lot.unit === 'und'
            ? `${lot.initialQuantity} und`
            : `${(lot.initialQuantity / 1000).toFixed(1)} kg`;
        doc.font('Helvetica').text(qtyText, 200, y1);

        doc.font('Helvetica-Bold').text('Restante:', 150, y1 + 14);
        const remText = lot.unit === 'unidad' || lot.unit === 'und'
            ? `${lot.currentQuantity} und`
            : `${(lot.currentQuantity / 1000).toFixed(1)} kg`;
        doc.font('Helvetica').text(remText, 200, y1 + 14);

        // ── Dates ──
        const y2 = y1 + 34;
        doc.font('Helvetica-Bold').text('Recepción:', 10, y2);
        doc.font('Helvetica').text(new Date(lot.receivedAt).toLocaleDateString('es-CO'), 70, y2);

        doc.font('Helvetica-Bold').text('Vencimiento:', 150, y2);
        doc.font('Helvetica').text(lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString('es-CO') : 'N/A', 220, y2);

        // ── Supplier ──
        const y3 = y2 + 14;
        const supplier = lot.purchaseOrderItem?.purchaseOrder?.supplierName || '-';
        const ocNum = lot.purchaseOrderItem?.purchaseOrder?.orderNumber || '-';
        doc.font('Helvetica-Bold').text('Proveedor:', 10, y3);
        doc.font('Helvetica').text(supplier, 70, y3, { width: 200 });

        const y4 = y3 + 14;
        doc.font('Helvetica-Bold').text('OC:', 10, y4);
        doc.font('Helvetica').text(ocNum, 30, y4);

        // ── Status bar ──
        const statusColor = lot.status === 'AVAILABLE' ? '#52c41a' : lot.status === 'LOW_STOCK' ? '#faad14' : '#ff4d4f';
        doc.roundedRect(10, 145, 263, 16, 3).fill(statusColor);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff')
            .text(lot.status === 'AVAILABLE' ? 'DISPONIBLE' : lot.status === 'LOW_STOCK' ? 'STOCK BAJO' : 'AGOTADO', 10, 148, { width: 263, align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Error generating lot label:', error);
        res.status(500).json({ error: 'Error generando etiqueta' });
    }
}

module.exports = { generateLotLabel };
