const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const processTypes = [
        {
            code: 'STD_MIX',
            name: 'Mezcla Estándar',
            category: 'STANDARD',
            icon: '🥣',
            parametersSchema: {
                telasMixTime: { type: 'number', description: 'Tiempo de mezcla (min)', unit: 'min' },
                mixSpeed: { type: 'string', description: 'Velocidad (BAJA/MEDIA/ALTA)' }
            }
        },
        {
            code: 'ESFERIFICACION',
            name: 'Esferificación',
            category: 'SPECIAL',
            icon: '🔮',
            parametersSchema: {
                bathTemp: { type: 'number', description: 'Temp Baño (°C)', unit: '°C' },
                pearlSize: { type: 'string', description: 'Tamaño Perla (mm)' },
                phValue: { type: 'number', description: 'pH Alginato' }
            }
        },
        {
            code: 'PROTECCION',
            name: 'Protección',
            category: 'SPECIAL',
            icon: '🛡️',
            parametersSchema: {
                restingTime: { type: 'number', description: 'Tiempo Reposo (min)', unit: 'min' },
                solutionTemp: { type: 'number', description: 'Temp Solución (°C)', unit: '°C' }
            }
        },
        {
            code: 'ENVASADO',
            name: 'Envasado y Empaque',
            category: 'STANDARD',
            icon: '📦',
            parametersSchema: {
                unitsPerContainer: { type: 'number', description: 'Unidades por tarro' },
                sealCheck: { type: 'string', description: 'Verificación Sello (OK/FAIL)' }
            }
        },
        {
            code: 'HOMOGENIZACION',
            name: 'Homogenización',
            category: 'SPECIAL',
            icon: '🌪️',
            parametersSchema: {
                pressure: { type: 'number', description: 'Presión (PSI)', unit: 'PSI' },
                cycles: { type: 'number', description: 'Número de ciclos' }
            }
        }
    ];

    console.log('Seeding Process Types...');
    for (const pt of processTypes) {
        await prisma.processType.upsert({
            where: { code: pt.code },
            update: pt,
            create: pt
        });
    }
    console.log('Seeding completed successfully!');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
