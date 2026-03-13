const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const deleteUploadedFiles = (files) => {
    if (!files) return;
    files.forEach(file => {
        try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { }
    });
};

// ── Create Internal PQR (same PQR table, isInternal = true) ──
exports.createInternalPQR = async (req, res) => {
    const files = req.files || [];
    try {
        const userId = req.user.id;
        const { origin, daysAfterProduction } = req.body;

        let itemsToCreate = [];
        if (req.body.items) {
            try { itemsToCreate = JSON.parse(req.body.items); } catch (e) {
                return res.status(400).json({ error: 'Formato de items inválido' });
            }
        }
        if (itemsToCreate.length === 0) {
            return res.status(400).json({ error: 'No se enviaron items para el reporte' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Ticket number: PQR-INT-XXX (differentiated from external PQR-PBI-XXX)
            const lastPQR = await tx.pQR.findFirst({
                where: { isInternal: true },
                orderBy: { createdAt: 'desc' }
            });
            let nextSequence = 1;
            if (lastPQR?.ticketNumber?.startsWith('PQR-INT-')) {
                const parts = lastPQR.ticketNumber.split('-');
                const lastSeq = parseInt(parts[2], 10);
                if (!isNaN(lastSeq)) nextSequence = lastSeq + 1;
            }
            const ticketNumber = `PQR-INT-${String(nextSequence).padStart(3, '0')}`;

            // Create PQR header in the SAME table
            const pqrHeader = await tx.pQR.create({
                data: {
                    userId,
                    ticketNumber,
                    status: 'PENDING',
                    stage: 'PENDING_REVIEW',
                    isInternal: true,
                    origin: origin || null,
                    daysAfterProduction: daysAfterProduction ? parseInt(daysAfterProduction) : null,
                    refundMethod: null // No refund for internal PQRs
                }
            });

            // Create Items (same PQRItem table)
            let fileIndex = 0;
            for (const item of itemsToCreate) {
                const { type, productId, quantity, unit, lotNumber, description, evidenceCount = 0 } = item;

                let backendType = type;
                let finalDescription = description;
                const validTypes = ['CALIDAD', 'FALTANTE', 'TROCADO', 'AVERIA_TRANSPORTE'];
                if (!validTypes.includes(type)) {
                    backendType = 'CALIDAD';
                    finalDescription = `[Defecto: ${type}] ${description}`;
                }

                const pqrItem = await tx.pQRItem.create({
                    data: {
                        pqrId: pqrHeader.id,
                        type: backendType,
                        productId,
                        quantity: parseFloat(quantity),
                        unit: unit || 'UNIDADES',
                        lotNumber,
                        description: finalDescription
                    }
                });

                // Assign evidence files
                const itemFiles = files.slice(fileIndex, fileIndex + evidenceCount);
                fileIndex += evidenceCount;
                if (itemFiles.length > 0) {
                    await tx.pQREvidence.createMany({
                        data: itemFiles.map(file => ({
                            pqrItemId: pqrItem.id,
                            url: `/uploads/pqr/${file.filename}`,
                            type: file.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO'
                        }))
                    });
                }
            }
            return pqrHeader;
        });

        res.status(201).json({
            message: 'PQR Interno creado exitosamente',
            ticketNumber: result.ticketNumber,
            id: result.id
        });
    } catch (e) {
        console.error('Error creating Internal PQR:', e);
        if (req.files) deleteUploadedFiles(req.files);
        res.status(500).json({ error: 'Error interno al crear el PQR: ' + e.message });
    }
};

// ── List Internal PQRs ──
exports.getInternalPQRs = async (req, res) => {
    try {
        const { status } = req.query;
        const userRole = req.user.role;

        const where = { isInternal: true };

        // Role-based filtering
        if (userRole === 'CONTABILIDAD') {
            where.stage = 'PENDING_BILLING'; // Contabilidad only sees their stage
        }

        if (status && status !== 'ALL') where.status = status;

        const pqrs = await prisma.pQR.findMany({
            where,
            include: {
                user: { select: { name: true, email: true, role: true } },
                managedBy: { select: { name: true } },
                items: {
                    include: {
                        product: { select: { name: true, sku: true } },
                        evidence: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(pqrs);
    } catch (error) {
        logger.error('Error fetching Internal PQRs:', error);
        res.status(500).json({ error: 'Error al obtener PQRs internos' });
    }
};

// ── Get Internal PQR by ID ──
exports.getInternalPQRById = async (req, res) => {
    try {
        const { id } = req.params;
        const pqr = await prisma.pQR.findUnique({
            where: { id },
            include: {
                user: { select: { name: true, email: true, role: true } },
                managedBy: { select: { name: true } },
                items: {
                    include: {
                        product: { select: { name: true, sku: true } },
                        evidence: true
                    }
                }
            }
        });
        if (!pqr || !pqr.isInternal) return res.status(404).json({ error: 'PQR Interno no encontrado' });
        res.json(pqr);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener detalle del PQR interno' });
    }
};

// ── Update Internal PQR Status ──
exports.updateInternalPQRStatus = async (req, res) => {
    const { id } = req.params;
    const { action, rejectionReason, internalNotes } = req.body;
    const reviewerId = req.user.id;
    const userRole = req.user.role;

    try {
        const currentPQR = await prisma.pQR.findUnique({ where: { id } });
        if (!currentPQR || !currentPQR.isInternal) {
            return res.status(404).json({ error: 'PQR Interno no encontrado' });
        }

        const updateData = {
            managedById: reviewerId,
            internalNotes: internalNotes || currentPQR.internalNotes
        };

        if (action === 'REJECT') {
            if (!['ADMIN', 'CALIDAD'].includes(userRole)) {
                return res.status(403).json({ error: 'No autorizado para rechazar.' });
            }
            updateData.status = 'REJECTED';
            updateData.stage = 'REJECTED';
            updateData.rejectionReason = rejectionReason;
            updateData.resolvedAt = new Date();

        } else if (action === 'APPROVE_QUALITY') {
            if (!['ADMIN', 'CALIDAD'].includes(userRole)) {
                return res.status(403).json({ error: 'No autorizado para aprobar calidad.' });
            }
            updateData.status = 'IN_REVIEW';
            updateData.stage = 'PENDING_BILLING'; // Reuse PENDING_BILLING stage for accounting

        } else if (action === 'CONFIRM_ADJUSTMENT') {
            if (!['ADMIN', 'CONTABILIDAD'].includes(userRole)) {
                return res.status(403).json({ error: 'No autorizado para confirmar ajuste.' });
            }
            updateData.status = 'PROCESSED';
            updateData.stage = 'COMPLETED';
            updateData.resolvedAt = new Date();

        } else {
            return res.status(400).json({ error: `Acción desconocida: ${action}` });
        }

        const updated = await prisma.pQR.update({ where: { id }, data: updateData });
        res.json({ pqr: updated });
    } catch (error) {
        logger.error('Error updating Internal PQR status:', error);
        res.status(500).json({ error: 'Error al actualizar PQR interno' });
    }
};

// ── Upload Adjustment Document (Contabilidad) ──
exports.uploadAdjustmentDocument = async (req, res) => {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const userRole = req.user.role;
    const { notes } = req.body;

    if (!['ADMIN', 'CONTABILIDAD'].includes(userRole)) {
        return res.status(403).json({ error: 'No autorizado.' });
    }

    try {
        const currentPQR = await prisma.pQR.findUnique({ where: { id } });
        if (!currentPQR || !currentPQR.isInternal) {
            return res.status(404).json({ error: 'PQR Interno no encontrado' });
        }

        const updateData = {
            managedById: reviewerId,
            status: 'PROCESSED',
            stage: 'COMPLETED',
            resolvedAt: new Date(),
            internalNotes: notes || currentPQR.internalNotes
        };

        if (req.file) {
            updateData.adjustmentDocUrl = `/uploads/pqr/${req.file.filename}`;
        }

        const updated = await prisma.pQR.update({ where: { id }, data: updateData });
        res.json({ pqr: updated });
    } catch (error) {
        logger.error('Error uploading adjustment document:', error);
        res.status(500).json({ error: 'Error al confirmar ajuste de inventario.' });
    }
};
