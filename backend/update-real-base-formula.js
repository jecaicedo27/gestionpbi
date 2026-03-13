const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // IDs
    const processTypes = {
        STD_MIX: 'f38a6eb7-6010-4406-8d6b-bbadb820de7c'
    };

    const targetProduct = '43937035-4017-4f79-b005-d322f0c5fdd9'; // BASE LIQUIPOPS
    const templateCode = 'TEMP-BASE-LIQ';

    // Delete existing
    await prisma.assemblyTemplate.deleteMany({
        where: { templateCode }
    });

    // Real formula ingredients from user image
    const ingredients = [
        { id: 'ab09b25f-51f7-4f16-ad8e-067ccf798841', name: 'AZUCAR (MP2F01)', qty: 1000 },
        { id: 'db809b54-2c8a-46dc-b12a-53cd50c5ee95', name: 'AZUCAR INVERTER GLUCOSA (PROCELIQUIPOPS26)', qty: 1000 },
        { id: '50d0713c-9be1-47b5-bfb0-e82c531eca86', name: 'PREMEZCLA GOMAS PARA PERLAS (PROCELIQUIPOPS49)', qty: 100 },
        { id: '92fff56a-678c-4ec1-8562-2af7ade28118', name: 'PREMEZCLA FUENTE DE CALCIO PERLAS (PROCELIQUIPOPS50)', qty: 100 },
        { id: '4ee989ee-9e91-4b4a-9b6d-f0c78770863f', name: 'PREMEZCLA CONSERVANTES PERLAS (PROCELIQUIPOPS51)', qty: 50 }
    ];

    console.log('Updating Base Liquipops Template with REAL formula...');

    const template = await prisma.assemblyTemplate.create({
        data: {
            templateCode,
            templateName: 'BASE LIQUIPOPS (FÓRMULA REAL)',
            productId: targetProduct,
            description: 'Fórmula real de producción de Base Liquipops. Todas las cantidades en GRAMOS.',
            isActive: true,
            version: 1,
            totalStages: 1,
            stages: {
                create: [
                    {
                        stageOrder: 1,
                        stageName: 'MEZCLA DE BASE Y PREMEZCLAS',
                        processTypeId: processTypes.STD_MIX,
                        outputProductId: targetProduct,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        specialInstructions: 'Mezclar Azúcar y Glucose con premezclas. Seguir protocolo de hidratación.',
                        inputs: {
                            create: ingredients.map(ing => ({
                                productId: ing.id,
                                quantityPerUnit: ing.qty,
                                unit: 'g',
                                inputType: 'RAW_MATERIAL'
                            }))
                        }
                    }
                ]
            }
        }
    });

    console.log('Template updated successfully with REAL formula. ID:', template.id);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
