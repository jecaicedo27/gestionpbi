require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes('--execute');

function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
        d.getFullYear(),
        pad(d.getMonth() + 1),
        pad(d.getDate()),
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    ].join('-');
}

function jsonReplacer(_key, value) {
    if (typeof value === 'bigint') return value.toString();
    return value;
}

async function rows(query) {
    return prisma.$queryRawUnsafe(query);
}

async function countRows(query) {
    const result = await prisma.$queryRawUnsafe(query);
    const value = result?.[0]?.count ?? result?.[0]?.rows ?? 0;
    return Number(value);
}

const fpWhereSql = `
    SELECT p.id
    FROM products p
    WHERE (p.classification = 'PRODUCTO_TERMINADO' OR p."accountGroup" IN (1401, 1402))
      AND p.sku NOT LIKE 'PROCE%'
`;

async function collectCounts() {
    const queries = {
        finishedProductProducts: `SELECT count(*) FROM (${fpWhereSql}) fp`,
        orders: 'SELECT count(*) FROM orders',
        orderItems: 'SELECT count(*) FROM order_items',
        orderPickingItems: 'SELECT count(*) FROM order_picking_items',
        cartReservations: `SELECT count(*) FROM cart_reservations WHERE "productId" IN (${fpWhereSql})`,
        inventoryAlternate: `SELECT count(*) FROM inventory_alternate WHERE "productId" IN (${fpWhereSql})`,
        finishedLotStock: `SELECT count(*) FROM finished_lot_stock WHERE "productId" IN (${fpWhereSql})`,
        finishedLotTransfers: `SELECT count(*) FROM finished_lot_transfers WHERE "productId" IN (${fpWhereSql}) OR "orderId" IN (SELECT id FROM orders)`,
        productHandoffs: `
            SELECT count(*)
            FROM product_handoffs
            WHERE id IN (
                SELECT DISTINCT ph.id
                FROM product_handoffs ph
                JOIN handoff_items hi ON hi."handoffId" = ph.id
                WHERE hi."productId" IN (${fpWhereSql})
            )
        `,
        handoffItems: `
            SELECT count(*)
            FROM handoff_items
            WHERE "productId" IN (${fpWhereSql})
               OR "handoffId" IN (
                   SELECT DISTINCT ph.id
                   FROM product_handoffs ph
                   JOIN handoff_items hi ON hi."handoffId" = ph.id
                   WHERE hi."productId" IN (${fpWhereSql})
               )
        `,
        pendingBoxes: `SELECT count(*) FROM pending_boxes WHERE "productId" IN (${fpWhereSql})`,
        pendingBoxEntries: `SELECT count(*) FROM pending_box_entries WHERE box_id IN (SELECT id FROM pending_boxes WHERE "productId" IN (${fpWhereSql}))`,
        physicalCounts: `
            SELECT count(*)
            FROM physical_counts
            WHERE id IN (
                SELECT DISTINCT pc.id
                FROM physical_counts pc
                LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
                WHERE pci."productId" IN (${fpWhereSql})
                   OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
            )
        `,
        physicalCountItems: `
            SELECT count(*)
            FROM physical_count_items
            WHERE "productId" IN (${fpWhereSql})
               OR "physicalCountId" IN (
                   SELECT DISTINCT pc.id
                   FROM physical_counts pc
                   LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
                   WHERE pci."productId" IN (${fpWhereSql})
                      OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
               )
        `,
        packageLabels: `
            SELECT count(*)
            FROM package_labels pl
            WHERE pl.finished_lot_stock_id IS NOT NULL
               OR (pl.product_id IN (${fpWhereSql}) AND pl.material_lot_id IS NULL)
        `,
        packageLabelScans: `
            SELECT count(*)
            FROM package_label_scans
            WHERE package_label_id IN (
                SELECT pl.id
                FROM package_labels pl
                WHERE pl.finished_lot_stock_id IS NOT NULL
                   OR (pl.product_id IN (${fpWhereSql}) AND pl.material_lot_id IS NULL)
            )
        `,
        materialLotsZeroed: `SELECT count(*) FROM material_lots WHERE "productId" IN (${fpWhereSql})`,
        materialLotConsumptionsKept: `SELECT count(*) FROM lot_consumptions WHERE "materialLotId" IN (SELECT id FROM material_lots WHERE "productId" IN (${fpWhereSql}))`,
        zoneTransfers: `
            SELECT count(*)
            FROM zone_transfers
            WHERE "productId" IN (${fpWhereSql})
               OR "materialLotId" IN (SELECT id FROM material_lots WHERE "productId" IN (${fpWhereSql}))
        `,
        consumptionHistory: `SELECT count(*) FROM consumption_history WHERE "productId" IN (${fpWhereSql})`,
        movementsKept: `SELECT count(*) FROM movements WHERE product_id IN (${fpWhereSql})`,
        pqrKept: `
            SELECT count(DISTINCT p.id)
            FROM pqr p
            JOIN pqr_items pi ON pi."pqrId" = p.id
            WHERE pi."productId" IN (${fpWhereSql})
        `,
    };

    const result = {};
    for (const [key, query] of Object.entries(queries)) {
        result[key] = await countRows(query);
    }

    const stock = await prisma.$queryRawUnsafe(`
        SELECT
            COALESCE(sum(p."currentStock"), 0) AS "currentStock",
            COALESCE(sum(p."productionZoneStock"), 0) AS "productionZoneStock"
        FROM products p
        WHERE p.id IN (${fpWhereSql})
    `);
    result.stockTotals = stock[0] || { currentStock: 0, productionZoneStock: 0 };
    return result;
}

async function collectBackupData() {
    const data = {};
    data.products = await rows(`SELECT * FROM products WHERE id IN (${fpWhereSql}) ORDER BY name`);
    data.orders = await rows('SELECT * FROM orders ORDER BY "createdAt"');
    data.orderItems = await rows('SELECT * FROM order_items ORDER BY sort_order, id');
    data.orderPickingItems = await rows('SELECT * FROM order_picking_items ORDER BY "scannedAt", id');
    data.cartReservations = await rows(`SELECT * FROM cart_reservations WHERE "productId" IN (${fpWhereSql}) ORDER BY "createdAt", id`);
    data.inventoryAlternate = await rows(`SELECT * FROM inventory_alternate WHERE "productId" IN (${fpWhereSql}) ORDER BY "lastUpdated", id`);
    data.finishedLotStock = await rows(`SELECT * FROM finished_lot_stock WHERE "productId" IN (${fpWhereSql}) ORDER BY "createdAt", id`);
    data.finishedLotTransfers = await rows(`
        SELECT *
        FROM finished_lot_transfers
        WHERE "productId" IN (${fpWhereSql}) OR "orderId" IN (SELECT id FROM orders)
        ORDER BY "createdAt", id
    `);
    data.productHandoffs = await rows(`
        SELECT *
        FROM product_handoffs
        WHERE id IN (
            SELECT DISTINCT ph.id
            FROM product_handoffs ph
            JOIN handoff_items hi ON hi."handoffId" = ph.id
            WHERE hi."productId" IN (${fpWhereSql})
        )
        ORDER BY "createdAt", id
    `);
    data.handoffItems = await rows(`
        SELECT *
        FROM handoff_items
        WHERE "productId" IN (${fpWhereSql})
           OR "handoffId" IN (
               SELECT DISTINCT ph.id
               FROM product_handoffs ph
               JOIN handoff_items hi ON hi."handoffId" = ph.id
               WHERE hi."productId" IN (${fpWhereSql})
           )
        ORDER BY id
    `);
    data.pendingBoxes = await rows(`SELECT * FROM pending_boxes WHERE "productId" IN (${fpWhereSql}) ORDER BY "createdAt", id`);
    data.pendingBoxEntries = await rows(`SELECT * FROM pending_box_entries WHERE box_id IN (SELECT id FROM pending_boxes WHERE "productId" IN (${fpWhereSql})) ORDER BY "createdAt", id`);
    data.physicalCounts = await rows(`
        SELECT *
        FROM physical_counts
        WHERE id IN (
            SELECT DISTINCT pc.id
            FROM physical_counts pc
            LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
            WHERE pci."productId" IN (${fpWhereSql})
               OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
        )
        ORDER BY "startedAt", id
    `);
    data.physicalCountItems = await rows(`
        SELECT *
        FROM physical_count_items
        WHERE "productId" IN (${fpWhereSql})
           OR "physicalCountId" IN (
               SELECT DISTINCT pc.id
               FROM physical_counts pc
               LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
               WHERE pci."productId" IN (${fpWhereSql})
                  OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
           )
        ORDER BY id
    `);
    data.packageLabels = await rows(`
        SELECT *
        FROM package_labels pl
        WHERE pl.finished_lot_stock_id IS NOT NULL
           OR (pl.product_id IN (${fpWhereSql}) AND pl.material_lot_id IS NULL)
        ORDER BY created_at, id
    `);
    data.packageLabelScans = await rows(`
        SELECT *
        FROM package_label_scans
        WHERE package_label_id IN (
            SELECT pl.id
            FROM package_labels pl
            WHERE pl.finished_lot_stock_id IS NOT NULL
               OR (pl.product_id IN (${fpWhereSql}) AND pl.material_lot_id IS NULL)
        )
        ORDER BY scanned_at, id
    `);
    data.materialLots = await rows(`SELECT * FROM material_lots WHERE "productId" IN (${fpWhereSql}) ORDER BY "receivedAt", id`);
    data.zoneTransfers = await rows(`
        SELECT *
        FROM zone_transfers
        WHERE "productId" IN (${fpWhereSql})
           OR "materialLotId" IN (SELECT id FROM material_lots WHERE "productId" IN (${fpWhereSql}))
        ORDER BY "createdAt", id
    `);
    data.consumptionHistory = await rows(`SELECT * FROM consumption_history WHERE "productId" IN (${fpWhereSql}) ORDER BY date, id`);
    data.keptHistory = {
        movements: await countRows(`SELECT count(*) FROM movements WHERE product_id IN (${fpWhereSql})`),
        pqr: await countRows(`
            SELECT count(DISTINCT p.id)
            FROM pqr p
            JOIN pqr_items pi ON pi."pqrId" = p.id
            WHERE pi."productId" IN (${fpWhereSql})
        `),
    };
    return data;
}

function writeReadme({ backupDir, fullDumpPath, countsBefore, countsAfter }) {
    const body = `# Recuperacion - limpieza de producto terminado

Fecha: ${new Date().toISOString()}
Script: backend/src/scripts/resetFinishedProductData.js

## Respaldo generado antes de limpiar

- Dump completo de PostgreSQL: ${path.basename(fullDumpPath)}
- Respaldo focalizado: backup.json
- Script de restauracion focalizada: restore_finished_product_targeted.js

## Alcance limpiado

- Pedidos comerciales: orders, order_items, order_picking_items.
- Reservas comerciales de producto terminado: cart_reservations e inventory_alternate.
- Lotes e historial operativo de producto terminado: finished_lot_stock, finished_lot_transfers.
- Actas de entrega, cajas pendientes, conteos fisicos y etiquetas de producto terminado.
- consumption_history de productos terminados.
- Stock del catalogo de producto terminado en products.currentStock y products.productionZoneStock.
- Lotes de producto terminado registrados en material_lots se conservaron, pero quedaron en currentQuantity = 0 y status = DEPLETED para no romper trazabilidad de produccion.

## Protegido

- Materia prima, compras, recepciones y lotes de materia prima.
- Programaciones de produccion: production_orders, production_batches, assembly_notes y sus items.
- Formulas, plantillas, usuarios y proveedores.
- PQR y movimientos historicos de Siigo quedaron intactos por seguridad.

## Conteos antes

\`\`\`json
${JSON.stringify(countsBefore, jsonReplacer, 2)}
\`\`\`

## Conteos despues

\`\`\`json
${JSON.stringify(countsAfter, jsonReplacer, 2)}
\`\`\`

## Restaurar todo el sistema al punto anterior

Usar el dump completo solo si se quiere volver TODA la base de datos al momento previo a esta limpieza:

\`\`\`bash
cd /var/www/gestionpbi/backend
set -a
. ./.env
set +a
pg_restore --clean --if-exists --dbname="$DATABASE_URL" "${fullDumpPath}"
pm2 restart popping-backend
\`\`\`

## Restaurar solo producto terminado/pedidos

El script focalizado usa backup.json y restaura solamente los datos limpiados:

\`\`\`bash
cd /var/www/gestionpbi/backend
node "${path.join(backupDir, 'restore_finished_product_targeted.js')}"
pm2 restart popping-backend
\`\`\`
`;
    fs.writeFileSync(path.join(backupDir, 'README_RECUPERACION.md'), body);
}

function writeRestoreScript(backupDir) {
    const restorePath = path.join(backupDir, 'restore_finished_product_targeted.js');
    const script = `require('dotenv').config({ path: '/var/www/gestionpbi/backend/.env' });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const backup = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup.json'), 'utf8'));

const fpWhereSql = \`
    SELECT p.id
    FROM products p
    WHERE (p.classification = 'PRODUCTO_TERMINADO' OR p."accountGroup" IN (1401, 1402))
      AND p.sku NOT LIKE 'PROCE%'
\`;

function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
}

async function upsertRows(client, table, rows) {
    for (const row of rows || []) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const values = cols.map((col) => {
            const value = row[col];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return JSON.stringify(value);
            }
            return value;
        });
        const placeholders = cols.map((_, idx) => '$' + (idx + 1));
        const updates = cols
            .filter((col) => col !== 'id')
            .map((col) => \`\${quoteIdent(col)} = EXCLUDED.\${quoteIdent(col)}\`);
        const sql = \`
            INSERT INTO \${table} (\${cols.map(quoteIdent).join(', ')})
            VALUES (\${placeholders.join(', ')})
            ON CONFLICT ("id") DO UPDATE SET \${updates.length ? updates.join(', ') : '"id" = EXCLUDED."id"'}
        \`;
        await client.query(sql, values);
    }
}

async function main() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta definido');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        await client.query('BEGIN');

        await client.query(\`
            DELETE FROM package_label_scans
            WHERE package_label_id IN (
                SELECT pl.id
                FROM package_labels pl
                WHERE pl.finished_lot_stock_id IS NOT NULL
                   OR (pl.product_id IN (\${fpWhereSql}) AND pl.material_lot_id IS NULL)
            );
            DELETE FROM package_labels
            WHERE finished_lot_stock_id IS NOT NULL
               OR (product_id IN (\${fpWhereSql}) AND material_lot_id IS NULL);
            DELETE FROM finished_lot_transfers
            WHERE "productId" IN (\${fpWhereSql}) OR "orderId" IN (SELECT id FROM orders);
            DELETE FROM order_picking_items WHERE "orderItemId" IN (SELECT id FROM order_items);
            DELETE FROM order_items;
            DELETE FROM orders;
            DELETE FROM cart_reservations WHERE "productId" IN (\${fpWhereSql});
            DELETE FROM inventory_alternate WHERE "productId" IN (\${fpWhereSql});
            DELETE FROM product_handoffs
            WHERE id IN (
                SELECT DISTINCT ph.id
                FROM product_handoffs ph
                JOIN handoff_items hi ON hi."handoffId" = ph.id
                WHERE hi."productId" IN (\${fpWhereSql})
            );
            DELETE FROM pending_box_entries WHERE box_id IN (SELECT id FROM pending_boxes WHERE "productId" IN (\${fpWhereSql}));
            DELETE FROM pending_boxes WHERE "productId" IN (\${fpWhereSql});
            DELETE FROM physical_count_items
            WHERE "productId" IN (\${fpWhereSql})
               OR "physicalCountId" IN (
                   SELECT DISTINCT pc.id
                   FROM physical_counts pc
                   LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
                   WHERE pci."productId" IN (\${fpWhereSql})
                      OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
               );
            DELETE FROM physical_counts
            WHERE id NOT IN (SELECT DISTINCT "physicalCountId" FROM physical_count_items)
              AND zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD');
            DELETE FROM zone_transfers
            WHERE "productId" IN (\${fpWhereSql})
               OR "materialLotId" IN (SELECT id FROM material_lots WHERE "productId" IN (\${fpWhereSql}));
            DELETE FROM consumption_history WHERE "productId" IN (\${fpWhereSql});
        \`);

        await upsertRows(client, 'products', backup.data.products);
        await upsertRows(client, 'material_lots', backup.data.materialLots);
        await upsertRows(client, 'orders', backup.data.orders);
        await upsertRows(client, 'order_items', backup.data.orderItems);
        await upsertRows(client, 'order_picking_items', backup.data.orderPickingItems);
        await upsertRows(client, 'cart_reservations', backup.data.cartReservations);
        await upsertRows(client, 'inventory_alternate', backup.data.inventoryAlternate);
        await upsertRows(client, 'finished_lot_stock', backup.data.finishedLotStock);
        await upsertRows(client, 'finished_lot_transfers', backup.data.finishedLotTransfers);
        await upsertRows(client, 'product_handoffs', backup.data.productHandoffs);
        await upsertRows(client, 'handoff_items', backup.data.handoffItems);
        await upsertRows(client, 'pending_boxes', backup.data.pendingBoxes);
        await upsertRows(client, 'pending_box_entries', backup.data.pendingBoxEntries);
        await upsertRows(client, 'physical_counts', backup.data.physicalCounts);
        await upsertRows(client, 'physical_count_items', backup.data.physicalCountItems);
        await upsertRows(client, 'package_labels', backup.data.packageLabels);
        await upsertRows(client, 'package_label_scans', backup.data.packageLabelScans);
        await upsertRows(client, 'zone_transfers', backup.data.zoneTransfers);
        await upsertRows(client, 'consumption_history', backup.data.consumptionHistory);

        await client.query('COMMIT');
        console.log('Restauracion focalizada completada.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Restauracion fallida:', error);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main();
`;
    fs.writeFileSync(restorePath, script);
}

async function createFullDump(fullDumpPath) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta definido');
    const result = spawnSync('pg_dump', ['--format=custom', `--file=${fullDumpPath}`, process.env.DATABASE_URL], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`pg_dump fallo: ${result.stderr || result.stdout}`);
    }
}

async function cleanup() {
    await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
            DELETE FROM package_label_scans
            WHERE package_label_id IN (
                SELECT pl.id
                FROM package_labels pl
                WHERE pl.finished_lot_stock_id IS NOT NULL
                   OR (pl.product_id IN (${fpWhereSql}) AND pl.material_lot_id IS NULL)
            )
        `);
        await tx.$executeRawUnsafe(`
            DELETE FROM package_labels
            WHERE finished_lot_stock_id IS NOT NULL
               OR (product_id IN (${fpWhereSql}) AND material_lot_id IS NULL)
        `);
        await tx.$executeRawUnsafe(`
            DELETE FROM finished_lot_transfers
            WHERE "productId" IN (${fpWhereSql}) OR "orderId" IN (SELECT id FROM orders)
        `);
        await tx.orderPickingItem.deleteMany({});
        await tx.orderItem.deleteMany({});
        await tx.order.deleteMany({});
        await tx.$executeRawUnsafe(`DELETE FROM cart_reservations WHERE "productId" IN (${fpWhereSql})`);
        await tx.$executeRawUnsafe(`DELETE FROM inventory_alternate WHERE "productId" IN (${fpWhereSql})`);
        await tx.$executeRawUnsafe(`
            DELETE FROM product_handoffs
            WHERE id IN (
                SELECT DISTINCT ph.id
                FROM product_handoffs ph
                JOIN handoff_items hi ON hi."handoffId" = ph.id
                WHERE hi."productId" IN (${fpWhereSql})
            )
        `);
        await tx.$executeRawUnsafe(`DELETE FROM pending_box_entries WHERE box_id IN (SELECT id FROM pending_boxes WHERE "productId" IN (${fpWhereSql}))`);
        await tx.$executeRawUnsafe(`DELETE FROM pending_boxes WHERE "productId" IN (${fpWhereSql})`);
        await tx.$executeRawUnsafe(`
            DELETE FROM physical_count_items
            WHERE "productId" IN (${fpWhereSql})
               OR "physicalCountId" IN (
                   SELECT DISTINCT pc.id
                   FROM physical_counts pc
                   LEFT JOIN physical_count_items pci ON pci."physicalCountId" = pc.id
                   WHERE pci."productId" IN (${fpWhereSql})
                      OR pc.zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
               )
        `);
        await tx.$executeRawUnsafe(`
            DELETE FROM physical_counts
            WHERE id NOT IN (SELECT DISTINCT "physicalCountId" FROM physical_count_items)
              AND zone IN ('PRODUCCION','PRODUCTO_TERMINADO','NO_CONFORME','BODEGA','CUARENTENA','MAQUILA','PUBLICIDAD')
        `);
        await tx.$executeRawUnsafe(`
            DELETE FROM zone_transfers
            WHERE "productId" IN (${fpWhereSql})
               OR "materialLotId" IN (SELECT id FROM material_lots WHERE "productId" IN (${fpWhereSql}))
        `);
        await tx.$executeRawUnsafe(`DELETE FROM consumption_history WHERE "productId" IN (${fpWhereSql})`);
        await tx.$executeRawUnsafe(`
            UPDATE material_lots
            SET "currentQuantity" = 0,
                status = 'DEPLETED'
            WHERE "productId" IN (${fpWhereSql})
        `);
        await tx.$executeRawUnsafe(`
            UPDATE products
            SET "currentStock" = 0,
                "productionZoneStock" = 0,
                "updatedAt" = now()
            WHERE id IN (${fpWhereSql})
        `);
        await tx.$executeRawUnsafe(`DELETE FROM finished_lot_stock WHERE "productId" IN (${fpWhereSql})`);
    }, { timeout: 60000 });
}

async function main() {
    const backupRoot = path.resolve(__dirname, '../../../backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backupDir = path.join(backupRoot, `finished-product-reset-${stamp()}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const fullDumpPath = path.join(backupDir, 'full_database_before_cleanup.dump');
    const countsBefore = await collectCounts();
    const data = await collectBackupData();

    console.log('Creando dump completo:', fullDumpPath);
    await createFullDump(fullDumpPath);

    const backup = {
        createdAt: new Date().toISOString(),
        execute: EXECUTE,
        scope: {
            productFilter: 'products.classification = PRODUCTO_TERMINADO OR accountGroup IN (1401, 1402), excluding SKU PROCE%',
            kept: ['materia prima', 'compras', 'recepciones', 'programaciones de produccion', 'production_batches', 'assembly_notes', 'formulas', 'PQR', 'movements'],
        },
        countsBefore,
        data,
    };
    fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify(backup, jsonReplacer, 2));
    writeRestoreScript(backupDir);

    let countsAfter = null;
    if (EXECUTE) {
        console.log('Ejecutando limpieza transaccional...');
        await cleanup();
        countsAfter = await collectCounts();
    } else {
        console.log('Dry-run: no se modifico la base. Usa --execute para limpiar.');
        countsAfter = countsBefore;
    }

    writeReadme({ backupDir, fullDumpPath, countsBefore, countsAfter });

    console.log(JSON.stringify({
        execute: EXECUTE,
        backupDir,
        countsBefore,
        countsAfter,
    }, jsonReplacer, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
