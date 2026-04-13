const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/formulas
 * Listar todas las formulaciones
 */
async function listFormulas(req, res) {
    try {
        const { productId, isActive } = req.query;

        const where = {
            product: { accountGroup: { notIn: [1402, 1405] } }
        };
        if (productId) where.productId = productId;
        if (isActive !== undefined) where.isActive = isActive === 'true';

        const formulas = await prisma.formula.findMany({
            where,
            include: {
                product: true,
                items: {
                    include: {
                        ingredient: true
                    },
                    orderBy: { additionOrder: 'asc' }
                },
                cost: true,
                _count: {
                    select: { items: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(formulas);
    } catch (error) {
        console.error('Error fetching formulas:', error);
        res.status(500).json({ error: 'Failed to fetch formulas' });
    }
}

/**
 * GET /api/formulas/:id
 * Obtener una formulación por ID
 */
async function getFormula(req, res) {
    try {
        const { id } = req.params;

        const formula = await prisma.formula.findUnique({
            where: { id },
            include: {
                product: true,
                items: {
                    include: {
                        ingredient: true
                    },
                    orderBy: { additionOrder: 'asc' }
                },
                cost: true,
                createdBy: {
                    select: { id: true, name: true, email: true }
                },
                approvedBy: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        if (!formula) {
            return res.status(404).json({ error: 'Formula not found' });
        }

        res.json(formula);
    } catch (error) {
        console.error('Error fetching formula:', error);
        res.status(500).json({ error: 'Failed to fetch formula' });
    }
}

/**
 * POST /api/formulas
 * Crear una nueva formulación
 */
async function createFormula(req, res) {
    try {
        const {
            formulaCode,
            formulaName,
            productId,
            baseUnit,
            baseQuantity,
            expectedYieldPercentage,
            description,
            notes,
            items, // Array de ingredientes
            createdById
        } = req.body;

        // Validaciones
        if (!formulaCode || !formulaName || !productId || !baseUnit || !items || items.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields: formulaCode, formulaName, productId, baseUnit, items'
            });
        }

        // Verificar que el producto existe
        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Obtener la versión más reciente
        const latestFormula = await prisma.formula.findFirst({
            where: { productId },
            orderBy: { version: 'desc' }
        });

        const newVersion = latestFormula ? latestFormula.version + 1 : 1;

        // Crear formulación con items en una transacción
        const formula = await prisma.$transaction(async (tx) => {
            // Crear formulación
            const newFormula = await tx.formula.create({
                data: {
                    formulaCode: formulaCode.toUpperCase(),
                    formulaName,
                    productId,
                    version: newVersion,
                    baseUnit,
                    baseQuantity: baseQuantity || 1.0,
                    expectedYieldPercentage: expectedYieldPercentage || 100.0,
                    description,
                    notes,
                    createdById,
                    updatedById: createdById
                }
            });

            // Calcular total para porcentajes
            let totalQuantity = 0;
            for (const item of items) {
                totalQuantity += item.quantity;
            }

            // Crear items
            for (let i = 0; i < items.length; i++) {
                const itemData = items[i];

                await tx.formulaItem.create({
                    data: {
                        formulaId: newFormula.id,
                        ingredientId: itemData.ingredientId,
                        ingredientType: itemData.ingredientType,
                        quantity: itemData.quantity,
                        unit: itemData.unit,
                        percentage: totalQuantity > 0 ? (itemData.quantity / totalQuantity) * 100 : null,
                        additionOrder: i + 1,
                        minQuantity: itemData.minQuantity,
                        maxQuantity: itemData.maxQuantity,
                        notes: itemData.notes
                    }
                });
            }

            // Retornar formulación con relaciones
            return await tx.formula.findUnique({
                where: { id: newFormula.id },
                include: {
                    product: true,
                    items: {
                        include: { ingredient: true },
                        orderBy: { additionOrder: 'asc' }
                    }
                }
            });
        });

        // ── Sync displayOrder AND quantityPerUnit on template stage inputs ──
        if (items && items.length > 0) {
            try {
                const templates = await prisma.assemblyTemplate.findMany({
                    where: { productId },
                    select: {
                        stages: {
                            select: {
                                processType: { select: { code: true } },
                                inputs: {
                                    select: { id: true, productId: true }
                                }
                            }
                        }
                    }
                });

                const ingredientMap = {};
                for (let i = 0; i < items.length; i++) {
                    const id = items[i].ingredientId;
                    if (!ingredientMap[id]) ingredientMap[id] = [];
                    ingredientMap[id].push({
                        quantity: Number(items[i].quantity) || 0,
                        displayOrder: i + 1
                    });
                }

                // SKIP ENSAMBLE and CONTEO stages — ENSAMBLE uses per-gram ratios, CONTEO has no inputs
                for (const tmpl of templates) {
                    for (const stage of tmpl.stages) {
                        if (stage.processType?.code === 'ENSAMBLE' || stage.processType?.code === 'CONTEO') continue;
                        const syncConsumed = {};
                        for (const inp of stage.inputs) {
                            const arr = ingredientMap[inp.productId];
                            if (arr && arr.length > 0) {
                                const consumedIdx = syncConsumed[inp.productId] || 0;
                                const match = arr[consumedIdx] || arr[arr.length - 1];
                                syncConsumed[inp.productId] = consumedIdx + 1;

                                await prisma.assemblyTemplateStageInput.update({
                                    where: { id: inp.id },
                                    data: {
                                        quantityPerUnit: match.quantity,
                                        displayOrder: match.displayOrder
                                    }
                                });
                            }
                        }
                    }
                }
                console.log(`[Formula Sync] Updated template inputs for product ${productId}`);
            } catch (syncErr) {
                console.warn('Template sync warning:', syncErr.message);
            }
        }

        res.status(201).json(formula);
    } catch (error) {
        console.error('Error creating formula:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({
                error: 'Formula code already exists'
            });
        }

        res.status(500).json({ error: 'Failed to create formula' });
    }
}

/**
 * PATCH /api/formulas/:id
 * Actualizar una formulación (incluyendo items)
 */
async function updateFormula(req, res) {
    try {
        const { id } = req.params;
        const {
            formulaName,
            formulaCode,
            productId,
            baseUnit,
            baseQuantity,
            description,
            notes,
            expectedYieldPercentage,
            isActive,
            items,
            updatedById
        } = req.body;

        const updates = {};
        if (formulaName !== undefined) updates.formulaName = formulaName;
        if (formulaCode !== undefined) updates.formulaCode = formulaCode;
        if (productId !== undefined) updates.productId = productId;
        if (baseUnit !== undefined) updates.baseUnit = baseUnit;
        if (baseQuantity !== undefined) updates.baseQuantity = baseQuantity;
        if (description !== undefined) updates.description = description;
        if (notes !== undefined) updates.notes = notes;
        if (expectedYieldPercentage !== undefined) updates.expectedYieldPercentage = expectedYieldPercentage;
        if (isActive !== undefined) updates.isActive = isActive;
        if (updatedById) updates.updatedById = updatedById;

        const formula = await prisma.$transaction(async (tx) => {
            // Update formula fields
            await tx.formula.update({
                where: { id },
                data: updates
            });

            // If items are provided, delete old and recreate
            if (items && items.length > 0) {
                await tx.formulaItem.deleteMany({ where: { formulaId: id } });

                let totalQuantity = 0;
                for (const item of items) {
                    totalQuantity += Number(item.quantity) || 0;
                }

                for (let i = 0; i < items.length; i++) {
                    const itemData = items[i];
                    await tx.formulaItem.create({
                        data: {
                            formulaId: id,
                            ingredientId: itemData.ingredientId,
                            ingredientType: itemData.ingredientType || 'RAW_MATERIAL',
                            quantity: Number(itemData.quantity) || 0,
                            unit: itemData.unit || '',
                            percentage: totalQuantity > 0 ? (itemData.quantity / totalQuantity) * 100 : null,
                            additionOrder: i + 1,
                            minQuantity: itemData.minQuantity || 0,
                            maxQuantity: itemData.maxQuantity || 0,
                            notes: itemData.notes || null
                        }
                    });
                }
            }

            return await tx.formula.findUnique({
                where: { id },
                include: {
                    product: true,
                    items: {
                        include: { ingredient: true },
                        orderBy: { additionOrder: 'asc' }
                    },
                    cost: true
                }
            });
        });

        // ── Sync displayOrder AND quantityPerUnit on linked template stage inputs ──
        // When formula items change, propagate to any template stage input
        // that references the same product (ingredientId = stageInput.productId)
        if (items && items.length > 0) {
            try {
                // Find the formula's product to scope template sync
                const formulaRecord = await prisma.formula.findUnique({
                    where: { id },
                    select: { productId: true }
                });

                // Find all templates for this product
                const templates = formulaRecord ? await prisma.assemblyTemplate.findMany({
                    where: { productId: formulaRecord.productId },
                    select: {
                        stages: {
                            select: {
                                processType: { select: { code: true } },
                                inputs: {
                                    select: { id: true, productId: true }
                                }
                            }
                        }
                    }
                }) : [];

                // Build a map: ingredientId -> array of { quantity, displayOrder }
                const ingredientMap = {};
                for (let i = 0; i < items.length; i++) {
                    const id = items[i].ingredientId;
                    if (!ingredientMap[id]) ingredientMap[id] = [];
                    ingredientMap[id].push({
                        quantity: Number(items[i].quantity) || 0,
                        displayOrder: i + 1
                    });
                }

                // Update each template stage input that matches a formula ingredient
                // SKIP ENSAMBLE and CONTEO stages — ENSAMBLE uses per-gram ratios, CONTEO has no inputs
                for (const tmpl of templates) {
                    for (const stage of tmpl.stages) {
                        if (stage.processType?.code === 'ENSAMBLE' || stage.processType?.code === 'CONTEO') continue;
                        const syncConsumed = {};
                        for (const inp of stage.inputs) {
                            const arr = ingredientMap[inp.productId];
                            if (arr && arr.length > 0) {
                                const consumedIdx = syncConsumed[inp.productId] || 0;
                                const match = arr[consumedIdx] || arr[arr.length - 1];
                                syncConsumed[inp.productId] = consumedIdx + 1;

                                await prisma.assemblyTemplateStageInput.update({
                                    where: { id: inp.id },
                                    data: {
                                        quantityPerUnit: match.quantity,
                                        displayOrder: match.displayOrder
                                    }
                                });
                            }
                        }
                    }
                }
                console.log(`[Formula Sync] Updated template inputs for product ${formulaRecord?.productId}`);
            } catch (syncErr) {
                console.warn('Template sync warning:', syncErr.message);
            }
        }

        res.json(formula);
    } catch (error) {
        console.error('Error updating formula:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Formula not found' });
        }

        res.status(500).json({ error: 'Failed to update formula' });
    }
}

/**
 * POST /api/formulas/:id/approve
 * Aprobar una formulación
 */
async function approveFormula(req, res) {
    try {
        const { id } = req.params;
        const { approvedById } = req.body;

        if (!approvedById) {
            return res.status(400).json({ error: 'approvedById is required' });
        }

        const formula = await prisma.formula.update({
            where: { id },
            data: {
                approvedById,
                approvedAt: new Date()
            },
            include: {
                product: true,
                items: {
                    include: { ingredient: true }
                },
                approvedBy: true
            }
        });

        res.json(formula);
    } catch (error) {
        console.error('Error approving formula:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Formula not found' });
        }

        res.status(500).json({ error: 'Failed to approve formula' });
    }
}

/**
 * POST /api/formulas/:id/calculate-cost
 * Calcular costo de una formulación
 */
async function calculateFormulaCost(req, res) {
    try {
        const { id } = req.params;
        const { laborCost, overheadCost } = req.body;

        const formula = await prisma.formula.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        ingredient: {
                            select: { costPrice: true }
                        }
                    }
                }
            }
        });

        if (!formula) {
            return res.status(404).json({ error: 'Formula not found' });
        }

        // Calcular costo de materiales
        let materialCost = 0;
        for (const item of formula.items) {
            const itemCost = item.ingredient.costPrice * item.quantity;
            materialCost += itemCost;
        }

        const totalCost = materialCost + (laborCost || 0) + (overheadCost || 0);
        const costPerUnit = totalCost / formula.baseQuantity;

        // Guardar o actualizar costo
        const cost = await prisma.formulaCost.upsert({
            where: { formulaId: id },
            create: {
                formulaId: id,
                materialCost,
                laborCost: laborCost || 0,
                overheadCost: overheadCost || 0,
                totalCost,
                costPerUnit
            },
            update: {
                materialCost,
                laborCost: laborCost || 0,
                overheadCost: overheadCost || 0,
                totalCost,
                costPerUnit,
                calculatedAt: new Date()
            }
        });

        res.json(cost);
    } catch (error) {
        console.error('Error calculating formula cost:', error);
        res.status(500).json({ error: 'Failed to calculate formula cost' });
    }
}

module.exports = {
    listFormulas,
    getFormula,
    createFormula,
    updateFormula,
    approveFormula,
    calculateFormulaCost
};
