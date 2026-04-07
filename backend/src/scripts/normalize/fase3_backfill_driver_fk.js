/**
 * Backfill Fase 3: Order → Driver FK
 * Para cada Order con driverName != null, buscar o crear un Driver
 * y setear order.driverId con el ID encontrado/creado.
 * 
 * Separa por (name + cedula) para identificar conductores únicos.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Backfill Fase 3: Order → Driver FK\n');

    const orders = await prisma.order.findMany({
        where: { driverName: { not: null } },
        select: {
            id: true,
            orderNumber: true,
            driverName: true,
            driverCedula: true,
            driverPhone: true,
            licensePlate: true,
            driverId: true,
        },
        orderBy: { id: 'asc' }
    });

    console.log(`📊 Orders con driverName: ${orders.length}`);
    console.log(`   Orders ya con driverId: ${orders.filter(o => o.driverId).length}\n`);

    const ordersNeedingBackfill = orders.filter(o => !o.driverId);
    console.log(`🎯 Orders a procesar: ${ordersNeedingBackfill.length}\n`);

    // Agrupar por conductor único (name + cedula)
    const driverMap = new Map(); // key: "name|cedula" → driverId

    let created = 0, found = 0, linked = 0;

    for (const order of ordersNeedingBackfill) {
        const key = `${order.driverName?.trim()}|${order.driverCedula?.trim() || ''}`;

        let driverId = driverMap.get(key);

        if (!driverId) {
            // Buscar driver existente por cedula (si tiene) o por nombre exacto
            let existingDriver = null;
            if (order.driverCedula) {
                existingDriver = await prisma.driver.findUnique({
                    where: { cedula: order.driverCedula.trim() }
                });
            }
            if (!existingDriver && order.driverName) {
                existingDriver = await prisma.driver.findFirst({
                    where: { name: { equals: order.driverName.trim(), mode: 'insensitive' } }
                });
            }

            if (existingDriver) {
                driverId = existingDriver.id;
                found++;
                console.log(`  ✅ Encontrado: ${order.driverName} → Driver ${existingDriver.id.slice(0, 8)}`);
            } else {
                // Crear nuevo Driver
                const newDriver = await prisma.driver.create({
                    data: {
                        name: order.driverName.trim(),
                        cedula: order.driverCedula?.trim() || null,
                        phone: order.driverPhone?.trim() || null,
                        licensePlate: order.licensePlate?.trim() || null,
                        usageCount: 1,
                        lastUsed: new Date(),
                    }
                });
                driverId = newDriver.id;
                created++;
                console.log(`  ➕ Creado: ${order.driverName} → Driver ${newDriver.id.slice(0, 8)}`);
            }

            driverMap.set(key, driverId);
        }

        // Setear FK en Order
        await prisma.order.update({
            where: { id: order.id },
            data: { driverId }
        });
        linked++;
    }

    console.log(`\n📋 Resumen:`);
    console.log(`   Conductores encontrados en tabla: ${found}`);
    console.log(`   Conductores nuevos creados: ${created}`);
    console.log(`   Orders vinculados: ${linked}`);

    // Verificación final
    const stillMissing = await prisma.order.count({
        where: { driverName: { not: null }, driverId: null }
    });
    if (stillMissing === 0) {
        console.log(`\n✅ ÉXITO: Todos los orders con conductor tienen ahora driverId.`);
    } else {
        console.log(`\n⚠️  ATENCIÓN: ${stillMissing} orders aún sin driverId.`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
