const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding Example Formula and Assembly Template...');

    try {
        // 1. Get or Create Products (Ingredients & Consumables)
        // We need: Base Citrica, Sabor Fresa, Azucar, Colorante, Envase, Tapa, Etiqueta
        // And the Final Product: Liquipops Fresa 350g

        // 0. Ensure Group Exists
        await prisma.inventoryGroup.upsert({
            where: { siigoId: 'SEED-GROUP' },
            update: {},
            create: { siigoId: 'SEED-GROUP', name: 'Materiales Demo', type: 'MATERIA_PRIMA' }
        });
        const groupId = (await prisma.inventoryGroup.findUnique({ where: { siigoId: 'SEED-GROUP' } })).id;

        const createProduct = async (name, sku, type, classification) => {
            return await prisma.product.upsert({
                where: { sku },
                update: {},
                create: {
                    name, sku, barcode: sku, siigoId: sku,
                    type, classification, unit: 'Kg', groupId: groupId
                }
            });
        };

        const baseCitrica = await createProduct('Base Citrica Neutra', 'ING-BASE-01', 'BASE_CITRICA', 'MATERIA_PRIMA');
        const saborFresa = await createProduct('Saborizante Fresa', 'ING-SAB-01', 'MATERIA_PRIMA', 'MATERIA_PRIMA');
        const azucar = await createProduct('Azucar Blanco', 'ING-AZU-01', 'MATERIA_PRIMA', 'MATERIA_PRIMA');
        const colorante = await createProduct('Colorante Rojo', 'ING-COL-01', 'MATERIA_PRIMA', 'MATERIA_PRIMA');

        const envase = await createProduct('Envase PET 350g', 'EMP-ENV-350', 'MATERIA_PRIMA', 'MATERIA_PRIMA');
        const tapa = await createProduct('Tapa Blanca 38mm', 'EMP-TAP-01', 'MATERIA_PRIMA', 'MATERIA_PRIMA');
        const etiqueta = await createProduct('Etiqueta Fresa', 'EMP-ETI-FRE', 'MATERIA_PRIMA', 'MATERIA_PRIMA');

        // Intermediate Product (Output of Formula)
        const jarabeFresa = await createProduct('Jarabe Fresa Estándar', 'PROD-JAR-FRE', 'SYRUP', 'PRODUCTO_EN_PROCESO');

        // Final Product
        const liquipopsFresa = await createProduct('Liquipops Fresa 350g', 'LIQ-FRE-350', 'PERLA_EXPLOSIVA', 'PRODUCTO_TERMINADO');

        // 2. Create FORMULA (Chemical Content)
        // Formula for "Jarabe Fresa Estándar"
        console.log('🧪 Creating Formula...');

        const formula = await prisma.formula.upsert({
            where: { formulaCode: 'FORM-JAR-FRESA-01' },
            update: {},
            create: {
                formulaCode: 'FORM-JAR-FRESA-01',
                formulaName: 'Jarabe Base Fresa Estándar',
                productId: jarabeFresa.id,
                version: 1,
                isActive: true,
                baseUnit: 'Kg',
                baseQuantity: 100, // Per 100 Kg
                description: 'Fórmula estándar para producción de Jarabe de Fresa',
                items: {
                    create: [
                        { ingredientId: baseCitrica.id, quantity: 80, unit: 'Kg', percentage: 80, ingredientType: 'RAW_MATERIAL' }, // 80%
                        { ingredientId: azucar.id, quantity: 14.8, unit: 'Kg', percentage: 14.8, ingredientType: 'RAW_MATERIAL' }, // 14.8%
                        { ingredientId: saborFresa.id, quantity: 5, unit: 'Kg', percentage: 5, ingredientType: 'RAW_MATERIAL' },    // 5%
                        { ingredientId: colorante.id, quantity: 0.2, unit: 'Kg', percentage: 0.2, ingredientType: 'RAW_MATERIAL' }  // 0.2%
                    ]
                }
            }
        });

        // 3. Create Process Types (if not exist)
        console.log('⚙️ Ensuring Process Types...');
        const typeMixing = await prisma.processType.upsert({
            where: { code: 'PROC-MIXING' },
            update: {},
            create: { code: 'PROC-MIXING', name: 'Mezclado / Preparación', category: 'STANDARD', icon: 'blender' }
        });

        const typeSpherification = await prisma.processType.upsert({
            where: { code: 'PROC-SPHERIFICATION' },
            update: {},
            create: { code: 'PROC-SPHERIFICATION', name: 'Esferificación', category: 'SPECIAL', icon: 'flask' }
        });

        const typePackaging = await prisma.processType.upsert({
            where: { code: 'PROC-PACKAGING' },
            update: {},
            create: { code: 'PROC-PACKAGING', name: 'Envasado y Etiquetado', category: 'STANDARD', icon: 'package' }
        });

        // 4. Create ASSEMBLY TEMPLATE (The Process)
        console.log('📋 Creating Assembly Template...');

        // Clean up previous if exists to ensure clean structure in this demo
        try {
            const existingTemplate = await prisma.assemblyTemplate.findUnique({ where: { templateCode: 'TEMP-LIQ-350-FRESA' } });
            if (existingTemplate) {
                await prisma.assemblyTemplate.delete({ where: { id: existingTemplate.id } });
            }
        } catch (e) { }

        const template = await prisma.assemblyTemplate.create({
            data: {
                templateCode: 'TEMP-LIQ-350-FRESA',
                templateName: 'Proceso Estándar - Liquipops Fresa 350g',
                productId: liquipopsFresa.id,
                version: 1,
                isActive: true,
                totalStages: 3,
                description: 'Plantilla completa desde jarabe hasta producto terminado',
                stages: {
                    create: [
                        {
                            stageOrder: 1,
                            stageName: 'Preparación de Jarabe',
                            processTypeId: typeMixing.id,
                            outputProductId: jarabeFresa.id, // Output is the Syrup
                            outputClassification: 'PRODUCTO_EN_PROCESO',
                            specialInstructions: 'Agitar vigorosamente por 30 minutos.',
                            // No direct inputs here, effectively it "uses" the Formula of the output product implicitly
                            // OR we can explicitly list the Formula ingredients as inputs if we want granular control in the Note.
                            // For this demo, let's say the Input is "Resources" defined by the Formula logic in the backend.
                        },
                        {
                            stageOrder: 2,
                            stageName: 'Esferificación',
                            processTypeId: typeSpherification.id,
                            // Input is previous stage output (implicit flow usually, or explicit)
                            inputs: {
                                create: [
                                    {
                                        inputType: 'FROM_PREVIOUS_STAGE',
                                        quantityPerUnit: 1, // 1 Kg in -> ~1 Kg out
                                        unit: 'Kg',
                                        fromStageOrder: 1
                                    }
                                ]
                            }
                        },
                        {
                            stageOrder: 3,
                            stageName: 'Envasado Final',
                            processTypeId: typePackaging.id,
                            outputProductId: liquipopsFresa.id, // Final Product
                            outputClassification: 'PRODUCTO_TERMINADO',
                            inputs: {
                                create: [
                                    {
                                        inputType: 'FROM_PREVIOUS_STAGE', // The pearls
                                        quantityPerUnit: 0.200, // 200g of pearls per unit
                                        unit: 'Kg',
                                        fromStageOrder: 2
                                    },
                                    {
                                        inputType: 'RAW_MATERIAL', // The Packaging
                                        productId: envase.id,
                                        quantityPerUnit: 1,
                                        unit: 'Und'
                                    },
                                    {
                                        inputType: 'RAW_MATERIAL',
                                        productId: tapa.id,
                                        quantityPerUnit: 1,
                                        unit: 'Und'
                                    },
                                    {
                                        inputType: 'RAW_MATERIAL',
                                        productId: etiqueta.id,
                                        quantityPerUnit: 1,
                                        unit: 'Und'
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        });

        console.log('✅ Demo Data Created Successfully!');
        console.log(`Formula ID: ${formula.id}`);
        console.log(`Template ID: ${template.id}`);

    } catch (error) {
        console.error('❌ Error creating demo data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
