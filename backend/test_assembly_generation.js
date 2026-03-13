const assemblyService = require('./src/services/assemblyService');

(async () => {
    try {
        console.log('Testing assembly note generation...');
        const result = await assemblyService.generateNotesForBatch('6af395ae-e9b3-441e-8b67-fd0393b0e39a');
        console.log('✅ Success:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.log('❌ Error:', error.message);
        console.log('Stack:', error.stack);
    }
})();
