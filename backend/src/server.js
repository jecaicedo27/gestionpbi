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
        // ═══ CRON Sync ventas: DESACTIVADO 2026-05-07 ═══
        // El descuento de finishedLotStock por VTA Siigo causaba doble descuento
        // (picking interno YA descuenta los lotes; el cron repetía la operación).
        // Los pedidos internos pasan por picking → descuentan lotes correctamente.
        // El sync Siigo ya no aporta valor para inventario terminado y solo
        // generaba descuadre. Si se necesita reactivar, también modificar
        // siigoService.processInvoiceAsMovement para que NO llame consumeFEFO.
        // La función syncInvoicesRange queda disponible para llamadas manuales
        // desde /api/movements/sync (auditoría) sin tocar finishedLotStock.
        const dataMiningService_ = dataMiningService;
        const recalcVelocidades = () => dataMiningService_.calculateVelocities()
            .then(() => logger.info('⏰ CRON Velocidades actualizadas'))
            .catch(err => logger.warn(`⏰ CRON Velocidades error: ${err.message}`));
        setTimeout(recalcVelocidades, 30000);
        setInterval(recalcVelocidades, 3600000);
        logger.info('⏰ CRON: Sync ventas DESACTIVADO. Solo recálculo de velocidades cada 1h.');

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

        // ═══ CRON: Cierra el run de disciplina del turno saliente y crea el del entrante ═══
        const { _closeRun } = require('./controllers/shiftDisciplineController');
        const prismaCron = new (require('@prisma/client').PrismaClient)();
        cron.schedule('0 6,14,22 * * *', async () => {
            try {
                // Buscar el run sin cerrar más reciente (el que acaba de terminar)
                const open = await prismaCron.shiftDisciplineRun.findFirst({
                    where: { closedAt: null },
                    orderBy: { shiftStart: 'desc' },
                });
                if (open) {
                    const closed = await _closeRun(open.id);
                    logger.info(`⏰ DISCIPLINA: Cerrado run ${open.shiftDate} ${open.shiftCode} → score ${closed?.finalScore} (${closed?.finalGrade})`);
                }
            } catch (e) { logger.error(`⏰ DISCIPLINA cron error: ${e.message}`); }
        }, { timezone: 'America/Bogota' });
        logger.info('⏰ CRON: Cierre de turno disciplinador programado a las 6:00, 14:00, 22:00 COT');

        // ═══ CRON: Cada 5 min revisa retrasos > 15 min y envía push al líder ═══
        const { checkRetrasos } = require('./controllers/shiftDisciplineController');
        cron.schedule('*/5 * * * *', async () => {
            try { await checkRetrasos(); } catch (e) { logger.warn(`⏰ checkRetrasos error: ${e.message}`); }
        }, { timezone: 'America/Bogota' });
        logger.info('⏰ CRON: Revisión de retrasos disciplinador cada 5 min');

        // ═══ CRON: Generación diaria de tareas de aseo a las 5:00 AM Colombia ═══
        const cleaningService = require('./services/cleaningService');
        cron.schedule('0 5 * * *', async () => {
            try {
                const result = await cleaningService.generateExecutionsForDate(new Date());
                logger.info(`🧹 ASEO: ${result.created} ejecuciones generadas para ${result.date.toISOString().slice(0,10)}`);
            } catch (e) { logger.error(`🧹 ASEO cron error: ${e.message}`); }
        }, { timezone: 'America/Bogota' });
        logger.info('🧹 CRON: Generación diaria de tareas de aseo a las 5:00 AM COT');
    });
});

// Handle generic errors
process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    // process.exit(1);
});
