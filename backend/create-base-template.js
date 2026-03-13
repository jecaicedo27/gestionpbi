const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // IDs
    const processTypes = {
        STD_MIX: 'f38a6eb7-6010-4406-8d6b-bbadb820de7c'
    };

    const targetProduct = '43937035-4017-4f79-b005-d322f0c5fdd9'; // BASE LIQUIPOPS

    const ingredients = [
        { id: 'ab09b25f-51f7-4f16-ad8e-067ccf798841', name: 'AZUCAR', qty: 83.0 / 235.4 },
        { id: '75c306f5-5f22-421d-ba9a-ed21d618da39', name: 'ALGINATO DE SODIO', qty: 0.5 / 235.4 },
        { id: '200581d1-440a-4d13-b38b-32575c87923e', name: 'ALMIDON POLTEC GEL CREAM', qty: 0.5 / 235.4 },
        { id: '21f5f328-88e9-42ab-bf87-2436e9731e0d', name: 'ALMIDON POLTEC GEL THIN', qty: 0.5 / 235.4 },
        { id: '111298e5-c23b-4db0-9d98-e85ff70f30f9', name: 'DIOXIDO DE TITANIO', qty: 0.5 / 235.4 },
        { id: '0b432ede-a4d4-4401-bf20-9fb0dde2f4da', name: 'COLAGENO MARINO', qty: 0.1 / 235.4 },
        { id: '581fae46-931b-47d3-baaa-3d06586238bf', name: 'ACIDO TARTARICO', qty: 0.15 / 235.4 },
        { id: '4ee989ee-9e91-4b4a-9b6d-f0c78770863f', name: 'PREMEZCLA CONSERVANTES PERLAS', qty: 0.15 / 235.4 }
    ];

    console.log('Creating Base Liquipops Template...');

    const template = await prisma.assemblyTemplate.create({
        data: {
            templateCode: 'TEMP-BASE-LIQ',
            templateName: 'BASE LIQUIPOPS (FÓRMULA MAESTRA)',
            productId: targetProduct,
            description: 'Preparación de la base neutra para Liquipops según imagen de fórmula.',
            isActive: true,
            version: 1,
            totalStages: 1,
            stages: {
                create: [
                    {
                        stageOrder: 1,
                        stageName: 'MEZCLA Y PREPARACIÓN DE BASE',
                        processTypeId: processTypes.STD_MIX,
                        outputProductId: targetProduct,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        specialInstructions: 'Mezclar ingredientes secos e hidratar. Nota: Incluye 150L de Agua por cada bache de formula completa.',
                        inputs: {
                            create: ingredients.map(ing => ({
                                productId: ing.id,
                                quantityPerUnit: ing.qty,
                                unit: 'KG',
                                inputType: 'RAW_MATERIAL'
                            }))
                        }
                    }
                ]
            }
        }
    });

    console.log('Template created successfully with ID:', template.id);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
