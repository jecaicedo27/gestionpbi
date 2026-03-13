/**
 * Fix MARACUYA batch consumption:
 * 1. Reverse incorrect CAFÉ consumptions (PROTECCION CAFÉ 93g, ESFERAS CAFÉ 257g)
 * 2. Create correct MARACUYA consumptions for 40×3400g + 100×350g jars
 * 
 * Formula quantities per jar:
 * - 3400g: ESFERAS 2500g, PROTECCIÓN 900g
 * - 350g:  ESFERAS 257g,  PROTECCIÓN 93g
 * 
 * Totals:
 * - ESFERAS MARACUYA:    40×2500 + 100×257 = 125,700g
 * - PROTECCION MARACUYA: 40×900  + 100×93  = 45,300g
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// IDs from investigation
const CAFE_CONSUMPTIONS_TO_REVERSE = [
    { consumptionId: '252edf5d-a8a', lotId: '3b78c6e4-ee1', qty: 93, name: 'PROTECCION CAFÉ' },
    { consumptionId: '5bf8be51-2e0', lotId: '92a3f5e0-817', name: 'ESFERAS CAFÉ', qty: 257 }
];

// These need full IDs
const ESFERAS_MARACUYA_LOT_ID = '05eae34c-03f6-4d9a-9029-871d557415bd';
const PROTECCION_MARACUYA_LOT_ID = 'b561577f-ee51-4273-aad9-92b06a2fdb77';
const SYSTEM_USER_ID = 'cm65zgnqr0000kk04fhbfmxrg'; // Admin user ID placeholder

async function main() {
    // Step 0: Get the full IDs of the CAFÉ consumptions
    const allConsumptions = await prisma.lotConsumption.findMany({
        where: { usedAt: { gte: new Date('2026-03-10') } },
        select: { id: true, quantityUsed: true, materialLotId: true, materialLot: { select: { siigoProductName: true } } }
    });
    
    const cafeProtConsumption = allConsumptions.find(c => c.materialLot?.siigoProductName === 'PROTECCION CAFÉ' && c.quantityUsed === 93);
    const cafeEsfConsumption = allConsumptions.find(c => c.materialLot?.siigoProductName === 'ESFERAS CAFÉ' && c.quantityUsed === 257);
    
    if (!cafeProtConsumption || !cafeEsfConsumption) {
        console.log('CAFÉ consumptions not found! Available:');
        allConsumptions.forEach(c => console.log(c.quantityUsed, c.materialLot?.siigoProductName, c.id));
        return;
    }
    
    console.log('Found CAFÉ consumptions to reverse:');
    console.log('  PROTECCION CAFÉ:', cafeProtConsumption.id, '| qty:', cafeProtConsumption.quantityUsed);
    console.log('  ESFERAS CAFÉ:', cafeEsfConsumption.id, '| qty:', cafeEsfConsumption.quantityUsed);
    
    // Get admin user ID
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const userId = admin?.id;
    if (!userId) { console.error('No admin user found'); return; }
    console.log('Using admin user:', admin.name, userId);

    // Quantities to consume
    const esferasTotal = 40 * 2500 + 100 * 257;  // 125,700g
    const proteccionTotal = 40 * 900 + 100 * 93;  // 45,300g
    console.log('Consumption totals: ESFERAS', esferasTotal, 'g | PROTECCION', proteccionTotal, 'g');
    
    // Check available quantities
    const esferasLot = await prisma.materialLot.findUnique({ where: { id: ESFERAS_MARACUYA_LOT_ID } });
    const proteccionLot = await prisma.materialLot.findUnique({ where: { id: PROTECCION_MARACUYA_LOT_ID } });
    console.log('ESFERAS MARACUYA available:', esferasLot.currentQuantity, 'g (need', esferasTotal, ')');
    console.log('PROTECCION MARACUYA available:', proteccionLot.currentQuantity, 'g (need', proteccionTotal, ')');
    
    if (esferasLot.currentQuantity < esferasTotal) {
        console.error('NOT ENOUGH ESFERAS MARACUYA!');
        return;
    }
    if (proteccionLot.currentQuantity < proteccionTotal) {
        console.error('NOT ENOUGH PROTECCION MARACUYA!');
        return;
    }

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
        // ── 1. Reverse CAFÉ Consumptions ──
        // Delete the consumption records
        await tx.lotConsumption.delete({ where: { id: cafeProtConsumption.id } });
        await tx.lotConsumption.delete({ where: { id: cafeEsfConsumption.id } });
        console.log('✅ Deleted CAFÉ consumption records');
        
        // Add back to CAFÉ lots
        await tx.materialLot.update({
            where: { id: cafeProtConsumption.materialLotId },
            data: { currentQuantity: { increment: 93 }, status: 'AVAILABLE' }
        });
        await tx.materialLot.update({
            where: { id: cafeEsfConsumption.materialLotId },
            data: { currentQuantity: { increment: 257 }, status: 'AVAILABLE' }
        });
        console.log('✅ Restored CAFÉ lot quantities (+93g PROTECCION, +257g ESFERAS)');

        // ── 2. Create MARACUYA Consumptions ──
        // ESFERAS MARACUYA
        await tx.lotConsumption.create({
            data: {
                materialLotId: ESFERAS_MARACUYA_LOT_ID,
                quantityUsed: esferasTotal,
                usedById: userId,
                observations: 'Corrección: Empaque MARACUYA 40×3400g + 100×350g'
            }
        });
        await tx.materialLot.update({
            where: { id: ESFERAS_MARACUYA_LOT_ID },
            data: {
                currentQuantity: { decrement: esferasTotal },
                status: esferasLot.currentQuantity - esferasTotal <= 0 ? 'DEPLETED' : 'AVAILABLE'
            }
        });
        console.log('✅ Created ESFERAS MARACUYA consumption:', esferasTotal, 'g');

        // PROTECCION MARACUYA
        await tx.lotConsumption.create({
            data: {
                materialLotId: PROTECCION_MARACUYA_LOT_ID,
                quantityUsed: proteccionTotal,
                usedById: userId,
                observations: 'Corrección: Empaque MARACUYA 40×3400g + 100×350g'
            }
        });
        await tx.materialLot.update({
            where: { id: PROTECCION_MARACUYA_LOT_ID },
            data: {
                currentQuantity: { decrement: proteccionTotal },
                status: proteccionLot.currentQuantity - proteccionTotal <= 0 ? 'DEPLETED' : 'AVAILABLE'
            }
        });
        console.log('✅ Created PROTECCION MARACUYA consumption:', proteccionTotal, 'g');
    });

    console.log('\n🎉 DONE! Inventory corrected:');
    console.log('  - Reversed: PROTECCION CAFÉ 93g, ESFERAS CAFÉ 257g');
    console.log('  - Added: ESFERAS MARACUYA', esferasTotal, 'g');
    console.log('  - Added: PROTECCION MARACUYA', proteccionTotal, 'g');
    
    await prisma.$disconnect();
}

main().catch(e => { console.error('ERROR:', e.message); prisma.$disconnect(); process.exit(1); });
