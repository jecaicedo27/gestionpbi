/**
 * purchaseOrderPdf.js — Generate professional PDF for Purchase Orders
 */
const PDFDocument = require('pdfkit');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_COMPANY = {
    name: 'POPPING BOBA INTERNATIONAL S.A.S.',
    nit: '901.123.456-7',
    address: 'Colombia',
    phone: '',
};

async function getCompanyInfo() {
    try {
        const config = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
        const val = config?.value || {};
        return {
            name: val.companyName || DEFAULT_COMPANY.name,
            nit: val.companyNit || DEFAULT_COMPANY.nit,
            address: val.companyAddress || DEFAULT_COMPANY.address,
            phone: val.companyPhone || DEFAULT_COMPANY.phone,
        };
    } catch { return DEFAULT_COMPANY; }
}

function isUnitBased(unit) {
    return ['unidad', 'und', 'unit'].includes((unit || '').toLowerCase());
}

function fmtQty(value, unit) {
    if (isUnitBased(unit)) return `${Math.round(value)} und`;
    return `${(value / 1000).toFixed(1)} kg`;
}

/**
 * GET /procurement/purchase-orders/:id/pdf
 */
async function generatePDF(req, res) {
    try {
        const order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                createdBy: { select: { name: true } },
                approvedBy: { select: { name: true } }
            }
        });

        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        const COMPANY = await getCompanyInfo();
        const productUnits = {};
        for (const item of order.items) {
            const prod = await prisma.product.findFirst({
                where: { sku: item.siigoProductCode },
                select: { unit: true }
            });
            productUnits[item.siigoProductCode] = prod?.unit || 'gramo';
        }

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${order.orderNumber}.pdf"`);
        doc.pipe(res);

        // ━━━━━━━━━━━━━━ HEADER ━━━━━━━━━━━━━━
        doc.fontSize(18).font('Helvetica-Bold')
            .text(COMPANY.name, 50, 50, { width: 350 });
        doc.fontSize(9).font('Helvetica')
            .text(`NIT: ${COMPANY.nit}`, 50, 72)
            .text(COMPANY.address, 50, 84);

        // Order info box (right side)
        const boxX = 400, boxY = 45;
        doc.roundedRect(boxX, boxY, 170, 55, 4).stroke('#1890ff');
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1890ff')
            .text('ORDEN DE COMPRA', boxX + 10, boxY + 8, { width: 150, align: 'center' });
        doc.fontSize(12).fillColor('#000')
            .text(order.orderNumber, boxX + 10, boxY + 28, { width: 150, align: 'center' });

        // Separator
        doc.moveTo(50, 110).lineTo(560, 110).stroke('#ddd');

        // ━━━━━━━━━━━━━━ SUPPLIER INFO ━━━━━━━━━━━━━━
        let y = 120;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#333')
            .text('PROVEEDOR', 50, y);
        y += 18;

        const infoLeft = [
            ['Razón Social:', order.supplierName],
            ['NIT:', order.supplierNit || '-'],
        ];
        const infoRight = [
            ['Fecha:', new Date(order.createdAt).toLocaleDateString('es-CO')],
            ['Entrega esperada:', order.expectedDate ? new Date(order.expectedDate).toLocaleDateString('es-CO') : 'A convenir'],
        ];

        doc.font('Helvetica').fontSize(9);
        infoLeft.forEach(([label, val], i) => {
            doc.font('Helvetica-Bold').text(label, 50, y + i * 14, { continued: true });
            doc.font('Helvetica').text(` ${val}`);
        });
        infoRight.forEach(([label, val], i) => {
            doc.font('Helvetica-Bold').text(label, 350, y + i * 14, { continued: true });
            doc.font('Helvetica').text(` ${val}`);
        });

        y += 45;
        doc.moveTo(50, y).lineTo(560, y).stroke('#ddd');
        y += 10;

        // ━━━━━━━━━━━━━━ PRODUCTS TABLE ━━━━━━━━━━━━━━
        const tableTop = y;
        const colX = { num: 50, sku: 75, name: 155, qty: 370, pkg: 460 };
        const colW = { num: 25, sku: 80, name: 215, qty: 90, pkg: 100 };

        // Header row
        doc.roundedRect(48, tableTop - 2, 514, 20, 3).fill('#1890ff');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff');
        doc.text('#', colX.num, tableTop + 3, { width: colW.num, align: 'center' });
        doc.text('SKU', colX.sku, tableTop + 3, { width: colW.sku });
        doc.text('DESCRIPCIÓN', colX.name, tableTop + 3, { width: colW.name });
        doc.text('CANTIDAD', colX.qty, tableTop + 3, { width: colW.qty, align: 'right' });
        doc.text('EMPAQUE', colX.pkg, tableTop + 3, { width: colW.pkg });

        y = tableTop + 22;
        doc.fillColor('#000').font('Helvetica').fontSize(9);

        order.items.forEach((item, idx) => {
            const unit = productUnits[item.siigoProductCode] || 'gramo';
            const bg = idx % 2 === 0 ? '#f8f9fa' : '#fff';
            doc.rect(48, y - 2, 514, 18).fill(bg);
            doc.fillColor('#333');

            doc.text(`${idx + 1}`, colX.num, y + 2, { width: colW.num, align: 'center' });
            doc.text(item.siigoProductCode, colX.sku, y + 2, { width: colW.sku });
            doc.font('Helvetica').text(item.siigoProductName, colX.name, y + 2, { width: colW.name });
            doc.font('Helvetica-Bold').fillColor('#1890ff')
                .text(fmtQty(item.quantityOrdered, unit), colX.qty, y + 2, { width: colW.qty, align: 'right' });
            doc.font('Helvetica').fillColor('#333')
                .text(item.packagingDesc || '-', colX.pkg, y + 2, { width: colW.pkg });

            y += 18;

            // Page break check
            if (y > 680) {
                doc.addPage();
                y = 50;
            }
        });

        // Bottom line
        doc.moveTo(48, y).lineTo(562, y).stroke('#1890ff');
        y += 5;

        // Total items
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333')
            .text(`Total: ${order.items.length} producto(s)`, 350, y, { width: 210, align: 'right' });

        y += 25;

        // ━━━━━━━━━━━━━━ NOTES ━━━━━━━━━━━━━━
        if (order.notes) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#333')
                .text('NOTAS:', 50, y);
            y += 14;
            doc.fontSize(9).font('Helvetica')
                .text(order.notes, 50, y, { width: 510 });
            y += 30;
        }

        // ━━━━━━━━━━━━━━ SIGNATURES ━━━━━━━━━━━━━━
        y = y + 40;
        // If signatures would exceed page, add page break
        if (y > 680) { doc.addPage(); y = 50; }

        // Elaborated by
        doc.moveTo(50, y).lineTo(230, y).stroke('#333');
        doc.fontSize(9).font('Helvetica')
            .text('Elaborado por:', 50, y + 5)
            .text(order.createdBy?.name || '-', 50, y + 17);

        // Approved by
        doc.moveTo(350, y).lineTo(530, y).stroke('#333');
        doc.fontSize(9).font('Helvetica')
            .text('Aprobado por:', 350, y + 5)
            .text(order.approvedBy?.name || '________________', 350, y + 17);

        // Footer
        doc.fontSize(7).fillColor('#999')
            .text(`Generado el ${new Date().toLocaleString('es-CO')} — ${COMPANY.name}`, 50, 710, { width: 510, align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Error generating PO PDF:', error);
        res.status(500).json({ error: 'Error generando PDF' });
    }
}

module.exports = { generatePDF };
