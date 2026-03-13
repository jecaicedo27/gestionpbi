const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

function generateMovementHash(data) {
    const { date, documentNumber, sku, type, quantity } = data;
    const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : String(date).split('T')[0];
    const content = `${dateStr}|${documentNumber}|${sku}|${type}|${quantity}`;
    return crypto.createHash('md5').update(content).digest('hex');
}

async function migrate() {
    console.log('🚀 Starting movement ID migration to Hash format...');

    try {
        const movements = await prisma.movement.findMany({
            include: { product: true }
        });

        console.log(`Found ${movements.length} movements to migrate.`);

        for (const mov of movements) {
            const newId = generateMovementHash({
                date: mov.date,
                documentNumber: mov.documentNumber,
                sku: mov.product.sku,
                type: mov.type,
                quantity: mov.quantity
            });

            if (mov.id === newId) {
                // Already migrated or collision? 
                continue;
            }

            // Check if record with newId already exists
            const existing = await prisma.movement.findUnique({ where: { id: newId } });

            if (existing) {
                // If it exists, this record is a duplicate of the newer hashing logic.
                // We can just delete the old one.
                console.log(`🗑️ Deleting duplicate legacy record: ${mov.id} (matches ${newId})`);
                await prisma.movement.delete({ where: { id: mov.id } });
            } else {
                // We cannot "update" an ID easily in some DBs because of relations or PK constraints.
                // Safest way: Create new, delete old.
                console.log(`🔄 Migrating ${mov.id} -> ${newId}`);

                // Copy all fields except ID
                const { id, product, createdAt, updatedAt, ...rest } = mov;

                await prisma.movement.create({
                    data: {
                        ...rest,
                        id: newId
                    }
                });

                await prisma.movement.delete({ where: { id: mov.id } });
            }
        }

        console.log('✅ Migration completed successfully.');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

migrate();
