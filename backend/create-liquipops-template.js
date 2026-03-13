const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // IDs
    const processTypes = {
        STD_MIX: 'f38a6eb7-6010-4406-8d6b-bbadb820de7c',
        ESFERIFICACION: '42f6610a-0c13-4df3-9643-bda6601e249a',
        PROTECCION: '7a4911d6-ad95-4724-b167-11329a6b5ec8',
        ENVASADO: '2e5db66d-274d-4cd1-bb75-e20f20bf1b83'
    };

    const products = {
        BASE: '43937035-4017-4f79-b005-d322f0c5fdd9',
        COMPUESTO_FRESA: '005fb2ca-20cb-4612-982c-c48264906631',
        ESFERAS_FRESA: '26959e9c-f3d5-4390-9096-297fba97d0a0',
        PROTECCION_FRESA: 'aedb2c55-b1ed-4def-91a1-80e2257052fc',
        FINAL_FRESA_1150: 'f734fca2-32ca-45db-85b5-4faf84d44cd0',

        // Ingredients
        AZUCAR: 'ab09b25f-51f7-4f16-ad8e-067ccf798841',
        SABOR_FRESA: '43ebfd9e-b077-4e78-a6cc-0e6b6cdd342f',
        COLOR_FRESA: 'f727f9b8-d37f-4afd-bb94-f8dacf535d4d',
        ALGINATO_NA: '75c306f5-5f22-421d-ba9a-ed21d618da39',
        ALGINATO_PREP: 'e3b26ecf-f274-4070-bc96-462f7c41be9e',
        TARRO_1150: '7968bd40-1466-4ff0-8674-32c567c63abd',
        ETIQUETA_FRESA: 'f76e8300-7fcd-41e8-91a2-afd8e80b798e',
        SELLO_1150: '4f0331ce-8b26-4303-8923-2820cc0d799f'
    };

    console.log('Creating Assembly Template...');

    const template = await prisma.assemblyTemplate.create({
        data: {
            templateCode: 'LIQ-FRESA-1150',
            templateName: 'LIQUIPOPS FRESA 1150G - PROCESO COMPLETO',
            productId: products.FINAL_FRESA_1150,
            description: 'Plantilla de demostración con las 5 etapas de producción de Liquipops.',
            isActive: true,
            version: 1,
            totalStages: 5,
            stages: {
                create: [
                    {
                        stageOrder: 1,
                        stageName: '1. PREPARACIÓN DE BASE',
                        processTypeId: processTypes.STD_MIX,
                        outputProductId: products.BASE,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        inputs: {
                            create: [
                                { productId: products.AZUCAR, quantityPerUnit: 0.15, unit: 'KG', inputType: 'RAW_MATERIAL' }
                            ]
                        }
                    },
                    {
                        stageOrder: 2,
                        stageName: '2. SABORIZACIÓN (COMPUESTO)',
                        processTypeId: processTypes.STD_MIX,
                        outputProductId: products.COMPUESTO_FRESA,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        inputs: {
                            create: [
                                { productId: products.BASE, quantityPerUnit: 1, unit: 'KG', inputType: 'SUB_ASSEMBLY' },
                                { productId: products.SABOR_FRESA, quantityPerUnit: 0.05, unit: 'KG', inputType: 'RAW_MATERIAL' },
                                { productId: products.COLOR_FRESA, quantityPerUnit: 0.01, unit: 'KG', inputType: 'RAW_MATERIAL' }
                            ]
                        }
                    },
                    {
                        stageOrder: 3,
                        stageName: '3. ESFERIFICACIÓN',
                        processTypeId: processTypes.ESFERIFICACION,
                        outputProductId: products.ESFERAS_FRESA,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        inputs: {
                            create: [
                                { productId: products.COMPUESTO_FRESA, quantityPerUnit: 1, unit: 'KG', inputType: 'SUB_ASSEMBLY' },
                                { productId: products.ALGINATO_PREP, quantityPerUnit: 2, unit: 'KG', inputType: 'SUB_ASSEMBLY' }
                            ]
                        }
                    },
                    {
                        stageOrder: 4,
                        stageName: '4. LÍQUIDO DE PROTECCIÓN',
                        processTypeId: processTypes.PROTECCION,
                        outputProductId: products.PROTECCION_FRESA,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        inputs: {
                            create: [
                                { productId: products.SABOR_FRESA, quantityPerUnit: 0.02, unit: 'KG', inputType: 'RAW_MATERIAL' },
                                { productId: products.AZUCAR, quantityPerUnit: 0.1, unit: 'KG', inputType: 'RAW_MATERIAL' }
                            ]
                        }
                    },
                    {
                        stageOrder: 5,
                        stageName: '5. ENVASADO FINAL',
                        processTypeId: processTypes.ENVASADO,
                        outputProductId: products.FINAL_FRESA_1150,
                        outputClassification: 'PRODUCTO_TERMINADO',
                        inputs: {
                            create: [
                                { productId: products.ESFERAS_FRESA, quantityPerUnit: 0.8, unit: 'KG', inputType: 'SUB_ASSEMBLY' },
                                { productId: products.PROTECCION_FRESA, quantityPerUnit: 0.35, unit: 'KG', inputType: 'SUB_ASSEMBLY' },
                                { productId: products.TARRO_1150, quantityPerUnit: 1, unit: 'UND', inputType: 'RAW_MATERIAL' },
                                { productId: products.ETIQUETA_FRESA, quantityPerUnit: 1, unit: 'UND', inputType: 'RAW_MATERIAL' },
                                { productId: products.SELLO_1150, quantityPerUnit: 1, unit: 'UND', inputType: 'RAW_MATERIAL' }
                            ]
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
