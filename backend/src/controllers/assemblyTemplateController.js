const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/assembly-templates
 * Listar todas las plantillas de ensamble
 */
async function listAssemblyTemplates(req, res) {
    try {
        const { productId, isActive, all } = req.query;

        const where = {};
        // By default hide raw-material account groups in the template editor,
        // but allow the premix panel to fetch everything with ?all=true
        if (all !== 'true') {
            where.product = { accountGroup: { notIn: [1402, 1405] } };
        }
        if (productId) where.productId = productId;
        if (isActive !== undefined) where.isActive = isActive === 'true';

        const templates = await prisma.assemblyTemplate.findMany({
            where,
            include: {
                product: true,
                stages: {
                    include: {
                        processType: true,
                        inputs: {
                            include: {
                                product: true
                            }
                        }
                    },
                    orderBy: { stageOrder: 'asc' }
                },
                _count: {
                    select: { stages: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(templates);
    } catch (error) {
        console.error('Error fetching assembly templates:', error);
        res.status(500).json({ error: 'Failed to fetch assembly templates' });
    }
}

/**
 * GET /api/assembly-templates/:id
 * Obtener una plantilla de ensamble por ID
 */
async function getAssemblyTemplate(req, res) {
    try {
        const { id } = req.params;

        const template = await prisma.assemblyTemplate.findUnique({
            where: { id },
            include: {
                product: true,
                stages: {
                    include: {
                        processType: true,
                        outputProduct: {
                            include: {
                                formulas: {
                                    // where: { isActive: true }, // Removed to allow viewing draft formulas
                                    take: 1,
                                    include: {
                                        items: {
                                            include: {
                                                ingredient: true
                                            },
                                            orderBy: { quantity: 'desc' }
                                        }
                                    }
                                }
                            }
                        },
                        inputs: {
                            include: {
                                product: true
                            },
                            orderBy: { displayOrder: 'asc' }
                        },
                        subTemplate: {
                            select: { id: true, templateCode: true, templateName: true, totalStages: true, product: { select: { id: true, name: true } } }
                        }
                    },
                    orderBy: { stageOrder: 'asc' }
                },
                createdBy: {
                    select: { id: true, name: true, email: true }
                },
                updatedBy: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        if (!template) {
            return res.status(404).json({ error: 'Assembly template not found' });
        }

        res.json(template);
    } catch (error) {
        console.error('Error fetching assembly template:', error);
        res.status(500).json({ error: 'Failed to fetch assembly template' });
    }
}

/**
 * POST /api/assembly-templates
 * Crear una nueva plantilla de ensamble
 */
async function createAssemblyTemplate(req, res) {
    try {
        const {
            templateCode,
            templateName,
            productId,
            description,
            stages, // Array de etapas con sus inputs
            createdById
        } = req.body;

        // Validaciones
        if (!templateCode || !templateName || !productId || !stages || stages.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields: templateCode, templateName, productId, stages'
            });
        }

        // Verificar que el producto existe
        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Obtener la versión más reciente para este producto
        const latestTemplate = await prisma.assemblyTemplate.findFirst({
            where: { productId },
            orderBy: { version: 'desc' }
        });

        const newVersion = latestTemplate ? latestTemplate.version + 1 : 1;

        // Crear plantilla con etapas e inputs en una transacción
        const template = await prisma.$transaction(async (tx) => {
            // Crear plantilla
            const newTemplate = await tx.assemblyTemplate.create({
                data: {
                    templateCode: templateCode.toUpperCase(),
                    templateName,
                    productId,
                    version: newVersion,
                    description,
                    totalStages: stages.length,
                    createdById,
                    updatedById: createdById
                }
            });

            // Crear etapas
            for (let i = 0; i < stages.length; i++) {
                const stageData = stages[i];

                const stage = await tx.assemblyTemplateStage.create({
                    data: {
                        templateId: newTemplate.id,
                        stageOrder: i + 1,
                        stageName: stageData.stageName,
                        processTypeId: stageData.processTypeId,
                        processParameters: stageData.processParameters || {},
                        outputProductId: stageData.outputProductId,
                        outputClassification: stageData.outputClassification,
                        specialInstructions: stageData.specialInstructions,
                        subTemplateId: stageData.subTemplateId || null
                    }
                });

                // Crear inputs de la etapa
                if (stageData.inputs && stageData.inputs.length > 0) {
                    for (let j = 0; j < stageData.inputs.length; j++) {
                        const inputData = stageData.inputs[j];

                        await tx.assemblyTemplateStageInput.create({
                            data: {
                                stageId: stage.id,
                                inputType: inputData.inputType,
                                productId: inputData.productId,
                                fromStageOrder: inputData.fromStageOrder,
                                quantityPerUnit: inputData.quantityPerUnit,
                                unit: inputData.unit,
                                displayOrder: j + 1,
                                aggregateOnRepeat: inputData.aggregateOnRepeat || false
                            }
                        });
                    }
                }
            }

            // Retornar plantilla con relaciones
            return await tx.assemblyTemplate.findUnique({
                where: { id: newTemplate.id },
                include: {
                    product: true,
                    stages: {
                        include: {
                            processType: true,
                            inputs: {
                                include: { product: true }
                            }
                        },
                        orderBy: { stageOrder: 'asc' }
                    }
                }
            });
        });

        res.status(201).json(template);
    } catch (error) {
        console.error('Error creating assembly template:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({
                error: 'Template code already exists'
            });
        }

        res.status(500).json({ error: 'Failed to create assembly template' });
    }
}

/**
 * PATCH /api/assembly-templates/:id
 * Actualizar una plantilla de ensamble (incluidas etapas e insumos)
 */
async function updateAssemblyTemplate(req, res) {
    try {
        const { id } = req.params;
        const {
            templateName,
            templateCode,
            productId,
            description,
            isActive,
            updatedById,
            createdById,
            stages
        } = req.body;

        // Build basic updates
        const updates = {};
        if (templateName !== undefined) updates.templateName = templateName;
        if (templateCode !== undefined) updates.templateCode = templateCode;
        if (productId !== undefined) updates.productId = productId;
        if (description !== undefined) updates.description = description;
        if (isActive !== undefined) updates.isActive = isActive;
        if (updatedById) updates.updatedById = updatedById;
        if (createdById) updates.updatedById = createdById;

        // If stages are provided, do a full replace in a transaction
        if (stages && Array.isArray(stages)) {
            updates.totalStages = stages.length;

            const result = await prisma.$transaction(async (tx) => {
                // 1. Delete old stage inputs first (foreign key constraint)
                const oldStages = await tx.assemblyTemplateStage.findMany({
                    where: { templateId: id },
                    select: { id: true }
                });
                if (oldStages.length > 0) {
                    await tx.assemblyTemplateStageInput.deleteMany({
                        where: { stageId: { in: oldStages.map(s => s.id) } }
                    });
                }

                // 2. Delete old stages
                await tx.assemblyTemplateStage.deleteMany({
                    where: { templateId: id }
                });

                // 3. Update template header
                await tx.assemblyTemplate.update({
                    where: { id },
                    data: updates
                });

                // 4. Create new stages with inputs
                for (const stage of stages) {
                    await tx.assemblyTemplateStage.create({
                        data: {
                            templateId: id,
                            stageOrder: stage.stageOrder,
                            stageName: stage.stageName,
                            processTypeId: stage.processTypeId,
                            processParameters: stage.processParameters || undefined,
                            outputProductId: stage.outputProductId || null,
                            outputClassification: stage.outputClassification || null,
                            specialInstructions: stage.specialInstructions || null,
                            subTemplateId: stage.subTemplateId || null,
                            inputs: {
                                create: (stage.inputs || []).map((input, idx) => ({
                                    inputType: input.inputType || 'RAW_MATERIAL',
                                    productId: input.productId,
                                    fromStageOrder: input.fromStageOrder || null,
                                    quantityPerUnit: input.quantityPerUnit || 0,
                                    unit: input.unit || '',
                                    displayOrder: input.displayOrder || idx + 1,
                                    aggregateOnRepeat: input.aggregateOnRepeat || false
                                }))
                            }
                        }
                    });
                }

                // 5. Return updated template with includes
                return tx.assemblyTemplate.findUnique({
                    where: { id },
                    include: {
                        product: true,
                        stages: {
                            include: {
                                processType: true,
                                inputs: { include: { product: true } }
                            },
                            orderBy: { stageOrder: 'asc' }
                        }
                    }
                });
            });

            return res.json(result);
        }

        // Simple update (no stages)
        const template = await prisma.assemblyTemplate.update({
            where: { id },
            data: updates,
            include: {
                product: true,
                stages: {
                    include: {
                        processType: true,
                        inputs: {
                            include: { product: true }
                        }
                    },
                    orderBy: { stageOrder: 'asc' }
                }
            }
        });

        res.json(template);
    } catch (error) {
        console.error('Error updating assembly template:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Assembly template not found' });
        }

        res.status(500).json({ error: 'Failed to update assembly template' });
    }
}

/**
 * DELETE /api/assembly-templates/:id
 * Eliminar (desactivar) una plantilla de ensamble
 */
async function deleteAssemblyTemplate(req, res) {
    try {
        const { id } = req.params;

        // Soft delete: marcar como inactivo
        const template = await prisma.assemblyTemplate.update({
            where: { id },
            data: { isActive: false }
        });

        res.json({ message: 'Assembly template deactivated successfully', template });
    } catch (error) {
        console.error('Error deleting assembly template:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Assembly template not found' });
        }

        res.status(500).json({ error: 'Failed to delete assembly template' });
    }
}

/**
 * POST /api/assembly-templates/:id/clone
 * Clonar una plantilla (crear nueva versión)
 */
async function cloneAssemblyTemplate(req, res) {
    try {
        const { id } = req.params;
        const { createdById } = req.body;

        const originalTemplate = await prisma.assemblyTemplate.findUnique({
            where: { id },
            include: {
                stages: {
                    include: {
                        inputs: true
                    }
                }
            }
        });

        if (!originalTemplate) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Crear nueva versión
        const newVersion = originalTemplate.version + 1;
        // Generate unique templateCode — append version suffix
        let newCode = `${originalTemplate.templateCode}-v${newVersion}`;
        // If that also exists, append timestamp
        const existingCode = await prisma.assemblyTemplate.findUnique({ where: { templateCode: newCode } });
        if (existingCode) {
            newCode = `${originalTemplate.templateCode}-${Date.now().toString(36).toUpperCase()}`;
        }

        const newTemplate = await prisma.$transaction(async (tx) => {
            // Crear plantilla
            const clonedTemplate = await tx.assemblyTemplate.create({
                data: {
                    templateCode: newCode,
                    templateName: `${originalTemplate.templateName} (v${newVersion})`,
                    productId: originalTemplate.productId,
                    version: newVersion,
                    parentTemplateId: originalTemplate.id,
                    description: originalTemplate.description,
                    totalStages: originalTemplate.totalStages,
                    createdById,
                    updatedById: createdById
                }
            });

            // Clonar etapas
            for (const stage of originalTemplate.stages) {
                const clonedStage = await tx.assemblyTemplateStage.create({
                    data: {
                        templateId: clonedTemplate.id,
                        stageOrder: stage.stageOrder,
                        stageName: stage.stageName,
                        processTypeId: stage.processTypeId,
                        processParameters: stage.processParameters,
                        outputProductId: stage.outputProductId,
                        outputClassification: stage.outputClassification,
                        specialInstructions: stage.specialInstructions,
                        subTemplateId: stage.subTemplateId || null
                    }
                });

                // Clonar inputs
                for (const input of stage.inputs) {
                    await tx.assemblyTemplateStageInput.create({
                        data: {
                            stageId: clonedStage.id,
                            inputType: input.inputType,
                            productId: input.productId,
                            fromStageOrder: input.fromStageOrder,
                            quantityPerUnit: input.quantityPerUnit,
                            unit: input.unit,
                            displayOrder: input.displayOrder,
                            aggregateOnRepeat: input.aggregateOnRepeat || false
                        }
                    });
                }
            }

            return await tx.assemblyTemplate.findUnique({
                where: { id: clonedTemplate.id },
                include: {
                    product: true,
                    stages: {
                        include: {
                            processType: true,
                            inputs: {
                                include: { product: true }
                            }
                        },
                        orderBy: { stageOrder: 'asc' }
                    }
                }
            });
        });

        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('Error cloning assembly template:', error);
        res.status(500).json({ error: 'Failed to clone assembly template' });
    }
}

module.exports = {
    listAssemblyTemplates,
    getAssemblyTemplate,
    createAssemblyTemplate,
    updateAssemblyTemplate,
    deleteAssemblyTemplate,
    cloneAssemblyTemplate
};
