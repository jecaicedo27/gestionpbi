const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const siigoService = require('../services/siigoService');
const logger = require('../utils/logger'); // Assuming logger exists based on file list
const path = require('path');
const fs = require('fs');

// Helper to delete files if transaction fails
const deleteUploadedFiles = (files) => {
    if (!files) return;
    files.forEach(file => {
        try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (e) {
            console.error('Error deleting file:', e);
        }
    });
};

const cleanReportingPartyName = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeReportingPartyName = (value) => cleanReportingPartyName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

exports.createPQR = async (req, res) => {
    // req.files contains uploaded images driven by multer
    const files = req.files || [];

    try {
        const userId = req.user.id;
        const { refundMethod, reportedByName } = req.body;
        const cleanedReportedByName = cleanReportingPartyName(reportedByName);
        const normalizedReportedByName = cleanedReportedByName
            ? normalizeReportingPartyName(cleanedReportedByName)
            : null;

        if (cleanedReportedByName && (cleanedReportedByName.length < 3 || cleanedReportedByName.length > 120)) {
            return res.status(400).json({ error: 'El nombre del subdistribuidor/cliente final debe tener entre 3 y 120 caracteres.' });
        }

        let itemsToCreate = [];

        if (req.body.items) {
            try {
                itemsToCreate = JSON.parse(req.body.items);
            } catch (e) {
                return res.status(400).json({ error: 'Formato de items inválido' });
            }
        } else {
            return res.status(400).json({ error: 'No se enviaron items para el reporte' });
        }

        if (itemsToCreate.length === 0) {
            return res.status(400).json({ error: 'No se enviaron items para el reporte' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Generate Friendly Ticket Number — find actual max sequence
            const lastPQR = await tx.pQR.findFirst({
                where: { ticketNumber: { startsWith: 'PQR-PBI-' } },
                orderBy: { ticketNumber: 'desc' }
            });

            let nextSequence = 1;
            if (lastPQR?.ticketNumber) {
                const lastSeq = parseInt(lastPQR.ticketNumber.replace('PQR-PBI-', ''), 10);
                if (!isNaN(lastSeq)) nextSequence = lastSeq + 1;
            }

            const ticketNumber = `PQR-PBI-${String(nextSequence).padStart(3, '0')}`;

            let canonicalReportedByName = null;
            if (normalizedReportedByName) {
                const existingReportedByName = await tx.pQR.findFirst({
                    where: {
                        userId,
                        reportedByNameNormalized: normalizedReportedByName
                    },
                    select: {
                        reportedByName: true
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                });
                canonicalReportedByName = existingReportedByName?.reportedByName || cleanedReportedByName;
            }

            // 2. Create Header
            const pqrHeader = await tx.pQR.create({
                data: {
                    userId,
                    ticketNumber,
                    status: 'PENDING',
                    stage: 'PENDING_REVIEW', // Initial Stage
                    refundMethod: refundMethod || 'WALLET_BALANCE', // Default
                    reportedByName: canonicalReportedByName,
                    reportedByNameNormalized: normalizedReportedByName || null
                }
            });

            // 3. Create Items
            let fileIndex = 0;

            for (const item of itemsToCreate) {
                const {
                    type,
                    productId,
                    quantity,
                    unit,
                    lotNumber,
                    description,
                    evidenceCount = 0
                } = item;

                // Map frontend specific types to backend generic types
                let backendType = type;
                const cleanedDescription = String(description || '').trim();
                let finalDescription = cleanedDescription;

                const validTypes = ['CALIDAD', 'FALTANTE', 'TROCADO', 'AVERIA_TRANSPORTE'];
                if (!validTypes.includes(type)) {
                    backendType = 'CALIDAD'; // Default to Quality for specific defects
                    finalDescription = cleanedDescription
                        ? `[Defecto: ${type}] ${cleanedDescription}`
                        : `[Defecto: ${type}]`;
                }

                if (!finalDescription) {
                    finalDescription = 'Sin descripción';
                }

                // Create Item
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

                // Assign Evidence
                const itemFiles = files.slice(fileIndex, fileIndex + evidenceCount);
                fileIndex += evidenceCount;

                if (itemFiles.length > 0) {
                    const evidenceData = itemFiles.map(file => ({
                        pqrItemId: pqrItem.id,
                        url: `/uploads/pqr/${file.filename}`,
                        type: file.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO'
                    }));

                    await tx.pQREvidence.createMany({
                        data: evidenceData
                    });
                }
            }

            return pqrHeader;
        });

        res.status(201).json({
            message: 'Reporte creado exitosamente',
            ticketNumber: result.ticketNumber,
            id: result.id
        });

    } catch (e) {
        console.error('CRITICAL ERROR Creating PQR:', e); // Force output to PM2 logs
        logger.error('Error creating PQR:', e);
        if (req.files) deleteUploadedFiles(req.files);
        res.status(500).json({ error: 'Error interno al crear el reporte: ' + e.message });
    }
};

exports.getReportingParties = async (req, res) => {
    try {
        const userId = req.user.id;
        const query = cleanReportingPartyName(req.query.q || '');
        const normalizedQuery = normalizeReportingPartyName(query);

        const history = await prisma.pQR.findMany({
            where: {
                userId,
                reportedByName: { not: null }
            },
            select: {
                reportedByName: true,
                reportedByNameNormalized: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 300
        });

        const unique = [];
        const seen = new Set();

        for (const row of history) {
            const displayName = cleanReportingPartyName(row.reportedByName);
            const normalizedName = row.reportedByNameNormalized || normalizeReportingPartyName(displayName);

            if (!displayName || !normalizedName) continue;
            if (normalizedQuery && !normalizedName.includes(normalizedQuery)) continue;
            if (seen.has(normalizedName)) continue;

            seen.add(normalizedName);
            unique.push(displayName);

            if (unique.length >= 20) break;
        }

        res.json(unique);
    } catch (error) {
        logger.error('Error fetching reporting parties:', error);
        res.status(500).json({ error: 'Error al obtener sugerencias de subdistribuidor/cliente final.' });
    }
};

exports.getPQRs = async (req, res) => {
    try {
        const { status, startDate, endDate } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;

        const where = {};

        if (userRole === 'DISTRIBUIDOR') {
            where.userId = userId;
        }

        // Role-based stage filtering: each role only sees PQRs they need to act on
        const roleStageMap = {
            'CALIDAD': ['PENDING_REVIEW'],
            'CONTABILIDAD': ['PENDING_BILLING'],
            'COMERCIAL': ['PENDING_INVOICE'],
            'LOGISTICA': ['PENDING_LOGISTICS']
        };

        if (roleStageMap[userRole]) {
            where.stage = { in: roleStageMap[userRole] };
        }

        if (status && status !== 'ALL') where.status = status;

        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }

        const pqrs = await prisma.pQR.findMany({
            where,
            include: {
                user: {
                    select: { name: true, email: true, username: true }
                },
                items: {
                    include: {
                        product: {
                            select: { name: true, sku: true }
                        },
                        evidence: true
                    }
                },
                managedBy: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(pqrs);
    } catch (error) {
        logger.error('Error fetching PQRs:', error);
        res.status(500).json({ error: 'Error al obtener PQRs' });
    }
};

exports.getPQRById = async (req, res) => {
    try {
        const { id } = req.params;
        const pqr = await prisma.pQR.findUnique({
            where: { id },
            include: {
                user: true,
                items: {
                    include: {
                        product: true,
                        evidence: true
                    }
                },
                managedBy: { select: { name: true } }
            }
        });

        if (!pqr) return res.status(404).json({ error: 'PQR no encontrado' });

        if (req.user.role === 'DISTRIBUIDOR' && pqr.userId !== req.user.id) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        res.json(pqr);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener detalle de PQR' });
    }
};

exports.updatePQRStatus = async (req, res) => {
    const { id } = req.params;
    const {
        action, // 'APPROVE_QUALITY', 'REJECT', 'CONFIRM_BILLING', 'DISPATCH'
        rejectionReason,
        internalNotes,
        creditNoteId,
        dispatchEvidenceUrl
    } = req.body;

    const reviewerId = req.user.id;
    const userRole = req.user.role;

    try {
        const currentPQR = await prisma.pQR.findUnique({
            where: { id },
            include: { user: true, items: { include: { product: true } } }
        });

        if (!currentPQR) return res.status(404).json({ error: 'PQR no encontrado' });

        const updateData = {
            managedById: reviewerId,
            internalNotes: internalNotes // Append logic could be handled here or frontend
        };

        // --- WORKFLOW LOGIC ---

        // 1. REJECTION (Any Stage)
        if (action === 'REJECT') {
            updateData.status = 'REJECTED';
            updateData.stage = 'REJECTED';
            updateData.rejectionReason = rejectionReason;
            updateData.resolvedAt = new Date();
        }

        // 2. QUALITY APPROVAL (Distributor -> Quality -> Billing)
        else if (action === 'APPROVE_QUALITY') {
            // Check Role
            if (!['ADMIN', 'CALIDAD'].includes(userRole)) {
                return res.status(403).json({ error: 'No autorizado para aprobar calidad.' });
            }

            updateData.status = 'IN_REVIEW';
            updateData.stage = 'PENDING_BILLING';
            updateData.rejectionReason = null; // Clear if previously rejected?
        }

        // 3. LOGISTICS DISPATCH (Logistics -> Completed)
        else if (action === 'DISPATCH') {
            if (!['ADMIN', 'LOGISTICA'].includes(userRole)) {
                return res.status(403).json({ error: 'No autorizado para despachar.' });
            }

            if (dispatchEvidenceUrl) {
                updateData.dispatchEvidenceUrl = dispatchEvidenceUrl;
            }

            updateData.stage = 'COMPLETED';
            updateData.status = 'PROCESSED';
            updateData.resolvedAt = new Date();
        }

        else {
            return res.status(400).json({ error: `Acción desconocida: ${action}` });
        }

        const updatedPQR = await prisma.pQR.update({
            where: { id },
            data: updateData
        });

        res.json({ pqr: updatedPQR });

    } catch (error) {
        logger.error('Error updating PQR:', error);
        res.status(500).json({ error: 'Error al actualizar PQR' });
    }
};

/**
 * Upload billing document (credit note or invoice PDF)
 * POST /api/pqr/:id/billing
 */
exports.uploadBillingDocument = async (req, res) => {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const userRole = req.user.role;
    const { documentType, notes } = req.body; // 'credit_note' or 'invoice'

    if (!['ADMIN', 'CONTABILIDAD', 'COMERCIAL'].includes(userRole)) {
        return res.status(403).json({ error: 'No autorizado.' });
    }

    // Handle files from upload.fields()
    const mainFile = req.files?.file?.[0];
    const accountStatementFile = req.files?.accountStatement?.[0];

    if (!mainFile) {
        return res.status(400).json({ error: 'Debe subir el documento PDF.' });
    }

    const fileUrl = `/uploads/pqr/${mainFile.filename}`;

    try {
        const currentPQR = await prisma.pQR.findUnique({ where: { id } });
        if (!currentPQR) return res.status(404).json({ error: 'PQR no encontrado' });

        const updateData = {
            managedById: reviewerId,
            internalNotes: notes || currentPQR.internalNotes
        };

        if (documentType === 'credit_note' && ['ADMIN', 'CONTABILIDAD'].includes(userRole)) {
            // Require account statement for credit notes
            if (!accountStatementFile) {
                return res.status(400).json({ error: 'Debe subir el estado de cuenta del cliente.' });
            }

            updateData.creditNoteUrl = fileUrl;
            updateData.accountStatementUrl = `/uploads/pqr/${accountStatementFile.filename}`;

            if (currentPQR.refundMethod === 'PHYSICAL_REPLACEMENT') {
                updateData.stage = 'PENDING_INVOICE';
                updateData.status = 'IN_REVIEW';
            } else {
                // Wallet balance -> completed
                updateData.stage = 'COMPLETED';
                updateData.status = 'PROCESSED';
                updateData.resolvedAt = new Date();
            }
        } else if (documentType === 'invoice' && ['ADMIN', 'COMERCIAL'].includes(userRole)) {
            // Invoice uploaded -> advance to logistics
            updateData.invoiceUrl = fileUrl;
            updateData.stage = 'PENDING_LOGISTICS';
            updateData.status = 'IN_REVIEW';
        } else {
            return res.status(400).json({ error: 'documentType debe ser credit_note o invoice' });
        }

        const updatedPQR = await prisma.pQR.update({
            where: { id },
            data: updateData
        });

        res.json({ pqr: updatedPQR });
    } catch (error) {
        logger.error('Error uploading billing document:', error);
        res.status(500).json({ error: 'Error al subir documento de facturación.' });
    }
};

exports.dispatchPQR = async (req, res) => {
    const { id } = req.params;
    const reviewerId = req.user.id;

    if (!req.file) {
        return res.status(400).json({ error: 'Debe subir la evidencia del despacho (Guía o Foto).' });
    }

    const evidenceUrl = `/uploads/pqr/${req.file.filename}`;

    try {
        const updatedPQR = await prisma.pQR.update({
            where: { id },
            data: {
                status: 'PROCESSED',
                stage: 'COMPLETED',
                dispatchEvidenceUrl: evidenceUrl,
                managedById: reviewerId,
                resolvedAt: new Date()
            }
        });

        res.json({ pqr: updatedPQR });
    } catch (error) {
        console.error('Error dispatching PQR:', error);
        res.status(500).json({ error: 'Error al registrar despacho.' });
    }
};
