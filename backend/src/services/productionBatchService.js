const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Service to handle Production Batch lifecycle and final inventory updates
 */
class ProductionBatchService {
    /**
     * Closes a production batch and increases final product stock
     * @param {string} batchId 
     */
    async closeBatch(batchId, operatorId) {
        return await prisma.$transaction(async (tx) => {
            // 1. Get Batch and its Assembly Notes
            const batch = await tx.productionBatch.findUnique({
                where: { id: batchId },
                include: {
                    assemblyNotes: true,
                    product: true
                }
            });

            if (!batch) throw new Error('Batch not found');
            if (batch.status === 'COMPLETED') throw new Error('Batch is already completed');

            // 2. Verify all notes are completed
            const pendingNotes = batch.assemblyNotes.filter(n => n.status !== 'COMPLETED');
            if (pendingNotes.length > 0) {
                throw new Error(`Cannot close batch: ${pendingNotes.length} assembly notes are still pending.`);
            }

            // 3. Calculate final production quantity (from the last note or sum)
            // Usually, the last stage defines the final yield.
            const lastNote = batch.assemblyNotes.sort((a, b) => b.stageOrder - a.stageOrder)[0];
            const finalQuantity = lastNote ? (lastNote.actualQuantity || 0) : (batch.expectedOutput || 0);

            // 4. Update Final Product Inventory (only if not already incremented by note completion)
            // The assembly note completion already increments per-stage output.
            // Only increment here if the batch product differs from the last stage output.
            // For safety, we skip incrementing here to avoid double-counting.

            // 5. Update Batch Status
            const updatedBatch = await tx.productionBatch.update({
                where: { id: batchId },
                data: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    actualOutput: finalQuantity
                }
            });

            // 6. Log Audit Trail
            await tx.auditLog.create({
                data: {
                    userId: operatorId,
                    action: 'BATCH_CLOSE',
                    entity: 'ProductionBatch',
                    entityId: batchId,
                    changes: { quantity: finalQuantity, status: 'COMPLETED' }
                }
            });

            return updatedBatch;
        });
    }

    /**
     * Records a quality check for an assembly note
     */
    async recordQualityCheck(noteId, data, operatorId) {
        return await prisma.assemblyQualityCheck.create({
            data: {
                assemblyNoteId: noteId,
                checkType: data.checkType,
                checkName: data.checkName || data.parameterName || 'QC',
                resultValue: data.resultValue || data.actualValue,
                expectedValue: data.expectedValue,
                passed: data.passed ?? data.isPass ?? true,
                notes: data.notes || data.observations || null,
                checkedById: operatorId
            }
        });
    }
}

module.exports = new ProductionBatchService();
