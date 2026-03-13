const rpaQueue = require('./src/services/queueService');
const logger = require('./src/utils/logger');

async function testRPA() {
    console.log('🤖 Disparando tarea de prueba al Bot RPA con Playwright...\n');

    try {
        // Agregar una tarea de prueba al queue
        const job = await rpaQueue.add({
            type: 'SCREENSHOT_TEST',
            data: {
                url: 'https://gestionpbi.lat'
            }
        });

        console.log(`✅ Tarea agregada al queue (Job ID: ${job.id})`);
        console.log('⏳ Esperando resultado...\n');

        // Esperar el resultado
        const result = await job.finished();

        console.log('🎉 Resultado del Bot RPA:');
        console.log(JSON.stringify(result, null, 2));

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al ejecutar el bot:', error.message);
        process.exit(1);
    }
}

testRPA();
