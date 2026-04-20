const { PrismaClient } = require('@prisma/client');
const dataMiningService = require('../services/dataMiningService');
const prisma = new PrismaClient();

exports.getReplenishment = async (req, res) => {
    try {
        const projection = await dataMiningService.getReplenishmentProjection();
        res.json(projection);
    } catch (error) {
        console.error('Replenishment Projection Error:', error);
        res.status(500).json({ error: 'Failed to generate replenishment projection' });
    }
};

exports.runMining = async (req, res) => {
    try {
        const result = await dataMiningService.calculateVelocities();
        res.json({ message: 'Data Mining Completed', result });
    } catch (error) {
        console.error('Data Mining Trigger Error:', error);
        res.status(500).json({ error: 'Failed to run data mining' });
    }
};
exports.getConsumption = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // Last 30 days

        const movements = await prisma.movement.groupBy({
            by: ['date'],
            where: {
                date: { gte: cutoffDate },
                type: { in: ['VTA', 'CONS'] }
            },
            _sum: {
                quantity: true
            },
            orderBy: {
                date: 'asc'
            }
        });

        const formattedData = movements.map(m => ({
            date: m.date.toISOString().split('T')[0],
            value: m._sum.quantity || 0
        }));

        res.json({ success: true, data: { data: formattedData } });
    } catch (error) {
        console.error('Consumption Error:', error);
        res.status(500).json({ error: 'Failed to fetch consumption data' });
    }
};

exports.getRoleDashboardKpis = async (req, res) => {
    try {
        const user = req.user;
        const role = user?.role || 'ADMIN';
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let data = {};

        if (role === 'OPERARIO_PICKING' || role === 'EMPAQUE') {
            // OPERARIO KPIs
            const notes = await prisma.assemblyNote.findMany({
                where: {
                    status: 'COMPLETED',
                    completedAt: { gte: today },
                    completedById: user.id
                }
            });

            const pendingNotes = await prisma.assemblyNote.count({
                where: {
                    status: { in: ['PENDING', 'EXECUTING'] },
                    executedById: user.id
                }
            });

            let unidadesBuenas = 0;
            let unidadesMalas = 0;

            notes.forEach(note => {
                // Para Geniality el conteo está en empaqueData, para otras en processParameters
                const empaque = note.processParameters?.empaque || note.empaqueData || {};
                unidadesBuenas += Number(empaque.conteo_qty) || Number(empaque.good_qty) || 0;
                unidadesMalas += Number(empaque.defect_qty) || 0;
            });

            const totalUnidades = unidadesBuenas + unidadesMalas;
            const tasaCalidad = totalUnidades > 0 ? ((unidadesBuenas / totalUnidades) * 100).toFixed(1) : 100;
            
            data = {
                unidadesBuenas,
                unidadesMalas,
                tasaCalidad,
                lotesCompletados: notes.length,
                pendingNotes
            };

        } else if (role === 'PRODUCCION' || role === 'QUIMICO') {
            // PRODUCCION KPIs
            const planedLots = await prisma.productionBatch.count({
                where: { createdAt: { gte: today } }
            });
            const completedBatchesToday = await prisma.productionBatch.count({
                 where: { status: 'COMPLETED', updatedAt: { gte: today } }
            });

            const activeBatches = await prisma.productionBatch.count({
                 where: { status: { notIn: ['PENDING', 'COMPLETED'] } }
            });

            const totalScrapItems = await prisma.assemblyNote.findMany({
                 where: { completedAt: { gte: today }, status: 'COMPLETED' },
                 select: { processParameters: true }
            });

            let mermaGlobal = 0;
            totalScrapItems.forEach(note => {
                const empaque = note.processParameters?.empaque || note.empaqueData || {};
                mermaGlobal += Number(empaque.defect_qty) || 0;
            });

            const alertsInventory = await prisma.product.count({
                where: { daysOfStock: { lt: 15 }, active: true }
            });

            data = {
                lotesPlantaTotales: planedLots,
                lotesCompletados: completedBatchesToday,
                activeBatches,
                mermaGlobal,
                cumplimiento: planedLots > 0 ? ((completedBatchesToday / planedLots) * 100).toFixed(1) : (completedBatchesToday > 0 ? 100 : 0),
                alertsInventory
            };

        } else if (role === 'LOGISTICA') {
            // LOGISTICA KPIs
            const pendientesAlistar = await prisma.order.count({
                where: { status: { in: ['PENDING', 'IN_PICKING'] } }
            });
            
            // Actas de Entrega sin firmar
            const actasPendientes = await prisma.productHandoff.count({
                where: { status: 'PENDING' }
            });

            const actasFirmadasHoy = await prisma.productHandoff.count({
                where: { completedAt: { gte: today }, status: 'COMPLETED' }
            });

            const ordenesDespachadas = await prisma.order.count({
                 where: { status: 'DELIVERED', updatedAt: { gte: today } }
            });

            data = {
                pendientesAlistar,
                actasPendientes,
                actasHoy: actasFirmadasHoy,
                ordenesDespachadas
            };

        } else if (role === 'CALIDAD') {
            // CALIDAD KPIs
            const pqrsAbiertasInt = await prisma.pQR.count({
                where: { status: { notIn: ['Resolved', 'Closed'] }, isInternal: true }
            });
            
            const pqrsAbiertasExt = await prisma.pQR.count({
                where: { status: { notIn: ['Resolved', 'Closed'] }, isInternal: false }
            });

            const lotesCuarentena = await prisma.finishedLotStock.count({
                where: { status: 'CUARENTENA' }
            });
            
            // LIMS Light Integration
            const tareasLims = await prisma.microSample.count({
                 where: { status: { notIn: ['COMPLETED', 'CLOSED', 'REJECTED'] } }
            });

            const rechazosEnsamble = await prisma.assemblyQualityCheck.count({
                where: { passed: false, checkedAt: { gte: today } }
            });

            data = { pqrsAbiertas: (pqrsAbiertasInt + pqrsAbiertasExt), pqrsAbiertasInt, pqrsAbiertasExt, lotesCuarentena, tareasLims, rechazosEnsamble };
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Role Dashboard KPIs Error:', error);
        res.status(500).json({ error: 'Failed to fetch personal KPIs' });
    }
};
