const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const { pool } = require('./config/database');
const logger = require('./utils/logger');
require('dotenv').config();

const port = process.env.PORT || 3050;
const server = http.createServer(app);

// WebSocket Setup
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST']
    }
});

// Store io instance in app for use in controllers
app.set('io', io);

io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

// Database Connection Check & Server Start
// Database Connection Check & Server Start

// Prevent multiple listen calls in the same process
if (global.serverStarted) {
    logger.warn('Server start attempt ignored: Server already started in this process.');
    return;
}
global.serverStarted = true;

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        logger.error('Database connection failed:', err);
        process.exit(1);
    }
    logger.info('Database connected successfully');

    // ═══ STARTUP RECOVERY: Mark stuck RPA executions as FAILED ═══
    (async () => {
        try {
            const { PrismaClient } = require('@prisma/client');
            const prisma = new PrismaClient();
            const fixed = await prisma.rpaExecution.updateMany({
                where: { status: 'RUNNING' },
                data: { status: 'FAILED', errorMessage: 'Backend reiniciado durante ejecución', completedAt: new Date() }
            });
            if (fixed.count > 0) logger.info(`🔧 RPA Recovery: ${fixed.count} ejecuciones stuck marcadas como FAILED`);
            await prisma.$disconnect();
        } catch (e) { /* ignore */ }
    })();

    logger.info(`DEBUG: process.env.PORT: ${process.env.PORT}`);
    logger.info(`DEBUG: CWD: ${process.cwd()}`);

    server.listen(port, () => {
        logger.info(`Server running on port ${port}`);

        // ═══ CRON: Sync ventas desde Siigo cada hora ═══
        const siigoService = require('./services/siigoService');
        const dataMiningService = require('./services/dataMiningService');
        const siigoQueue = require('./services/siigoQueue');

        const syncSales = () => siigoQueue.enqueue('sync-ventas', async () => {
            const now = new Date();
            const dateEnd = now.toISOString().split('T')[0];
            const start = new Date(now);
            start.setDate(start.getDate() - 60);
            const dateStart = start.toISOString().split('T')[0];

            logger.info(`⏰ CRON Sync ventas: ${dateStart} → ${dateEnd}`);
            const result = await siigoService.syncInvoicesRange(dateStart, dateEnd);
            logger.info(`⏰ CRON Sync ventas: ${result.totalProcessed || 0} facturas procesadas`);
            await dataMiningService.calculateVelocities().catch(() => { });
            logger.info('⏰ CRON Velocidades actualizadas');
        }).catch(err => logger.error(`⏰ CRON Sync ventas error: ${err.message}`));

        // Ejecutar al iniciar (después de 30s para que todo esté listo)
        setTimeout(syncSales, 30000);
        // Repetir cada hora (3600000ms)
        setInterval(syncSales, 3600000);
        logger.info('⏰ CRON: Sync ventas programado cada 1 hora');

        // ═══ CRON: Global timer alerts (cocción, etc.) ═══
        const { startTimerAlertCron } = require('./services/timerAlertService');
        startTimerAlertCron(io);

        // ═══ CRON: Sync inventario desde Siigo cada 30 min ═══
        const syncInventory = () => siigoQueue.enqueue('sync-inventario', async () => {
            logger.info('⏰ CRON Sync inventario: iniciando...');
            const result = await siigoService.syncAllProducts();
            logger.info(`⏰ CRON Sync inventario: ${result.synced}/${result.total} productos sincronizados`);
        }).catch(err => logger.error(`⏰ CRON Sync inventario error: ${err.message}`));

        // Ejecutar 60s después de arrancar
        setTimeout(syncInventory, 60000);
        // Repetir cada 30 min (1800000ms)
        setInterval(syncInventory, 1800000);
        logger.info('⏰ CRON: Sync inventario programado cada 30 minutos');

        // ═══ CRON: Cart reservation cleanup every 5 min ═══
        const { cleanupExpired } = require('./controllers/cartController');
        setInterval(() => cleanupExpired(io), 5 * 60 * 1000);
        logger.info('🛒 CRON: Cart cleanup programado cada 5 minutos');

        // ═══ CRON: Shift reschedule at 6:00, 14:00, 22:00 Colombia ═══
        const cron = require('node-cron');
        const { _reschedulePendingForShift } = require('./controllers/productionSchedulerController');
        cron.schedule('0 6,14,22 * * *', async () => {
            try {
                const result = await _reschedulePendingForShift('liquipops');
                if (result.rescheduled > 0) {
                    logger.info(`⏰ SHIFT RESCHEDULE [liquipops]: ${result.rescheduled} baches recorridos. Inicio efectivo: ${result.effectiveStart}`);
                }
            } catch (e) { logger.error(`⏰ SHIFT RESCHEDULE error: ${e.message}`); }
        }, { timezone: 'America/Bogota' });
        logger.info('⏰ CRON: Shift reschedule programado a las 6:00, 14:00, 22:00 COT');
    });
});

// Handle generic errors
process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    // process.exit(1);
});
