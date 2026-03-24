const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Service to handle Material Requirements Planning (MRP)
 */
class MRPService {
    /**
     * Calculates gross and net material requirements for all pending batches
     */
    async calculateGlobalRequirements() {
        try {
            // 1. Get all pending or scheduled batches
            const pendingBatches = await prisma.productionBatch.findMany({
                where: {
                    status: { in: ['PENDING'] }
                },
                include: {
                    product: true
                }
            });

            const requirements = {}; // productId -> { name, unit, requiredQty, currentStock }

            // 2. Iterate and explode Boms for each batch
            for (const batch of pendingBatches) {
                await this.explodeBatchRequirements(batch, batch.quantity, requirements);
            }

            // 3. Format result and calculate shortages
            const results = Object.values(requirements).map(item => {
                const shortage = Math.max(0, item.requiredQty - item.currentStock);
                return {
                    ...item,
                    shortage,
                    isShortage: shortage > 0,
                    status: shortage > 0 ? 'SHORTAGE' : 'OK'
                };
            });

            return results;
        } catch (error) {
            console.error('Error calculating MRP:', error);
            throw error;
        }
    }

    /**
     * Recursive function to explode requirements for a batch
     */
    async explodeBatchRequirements(batch, targetQty, requirements) {
        // Skip batches without a productId (e.g. Geniality multi-product batches)
        if (!batch.productId) return;

        // Get Template for the product
        const template = await prisma.assemblyTemplate.findFirst({
            where: { productId: batch.productId, isActive: true },
            orderBy: { version: 'desc' },
            include: {
                stages: {
                    include: {
                        inputs: {
                            include: { product: true }
                        }
                    }
                }
            }
        });

        if (!template) {
            console.warn(`No active template found for product ${batch.productId}`);
            return;
        }

        for (const stage of template.stages) {
            for (const input of stage.inputs) {
                // If it's a raw material, add to requirements
                if (input.inputType === 'RAW_MATERIAL') {
                    const productId = input.productId;
                    const qtyNeeded = input.quantityPerUnit * targetQty;

                    if (!requirements[productId]) {
                        requirements[productId] = {
                            productId,
                            name: input.product.name,
                            sku: input.product.sku,
                            unit: input.unit,
                            requiredQty: 0,
                            currentStock: input.product.currentStock || 0
                        };
                    }
                    requirements[productId].requiredQty += qtyNeeded;
                }
                // If it's a sub-assembly, we could recursively explode it if we want full raw material view
                // For now, we treat sub-assemblies as products themselves that might need their own production
                else if (input.inputType === 'SUB_ASSEMBLY') {
                    const productId = input.productId;
                    const qtyNeeded = input.quantityPerUnit * targetQty;

                    if (!requirements[productId]) {
                        requirements[productId] = {
                            productId,
                            name: input.product.name,
                            sku: input.product.sku,
                            unit: input.unit,
                            requiredQty: 0,
                            currentStock: input.product.currentStock || 0,
                            isSubAssembly: true
                        };
                    }
                    requirements[productId].requiredQty += qtyNeeded;
                }
            }
        }
    }

    /**
     * Generates purchase recommendations based on shortages
     */
    async getPurchaseRecommendations() {
        const requirements = await this.calculateGlobalRequirements();

        return requirements
            .filter(item => item.shortage > 0)
            .map(item => ({
                productId: item.productId,
                name: item.name,
                sku: item.sku,
                shortage: item.shortage,
                suggestedPurchase: item.shortage * 1.1, // 10% safety margin example
                unit: item.unit
            }));
    }
}

module.exports = new MRPService();
