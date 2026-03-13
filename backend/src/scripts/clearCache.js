
const cacheService = require('../services/cacheService');

async function main() {
    try {
        console.log("🧹 Invalidating cache...");
        await cacheService.invalidatePattern('replenishment_projection_v2');
        console.log("✅ Cache invalidated: replenishment_projection_v2");
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit();
    }
}

main();
