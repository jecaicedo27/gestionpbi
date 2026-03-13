const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

// ── Sampling Points ──
exports.getSamplingPoints = async (req, res) => {
    try {
        const points = await prisma.microSamplingPoint.findMany({
            where: { isActive: true },
            include: { schedules: { where: { isActive: true } } },
            orderBy: { sortOrder: 'asc' }
        });
        res.json(points);
    } catch (error) {
        logger.error('Error fetching sampling points:', error);
        res.status(500).json({ error: 'Error al obtener puntos de muestreo' });
    }
};

// ── Parameters ──
exports.getParameters = async (req, res) => {
    try {
        const params = await prisma.microParameter.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' }
        });
        res.json(params);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener parámetros' });
    }
};

// ── Week Schedule (Cronograma Semanal) ──
exports.getWeekSchedule = async (req, res) => {
    try {
        const { weekStart } = req.query; // ISO date string for Monday
        const startDate = weekStart ? new Date(weekStart) : getMonday(new Date());
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);

        // Get all active points with their schedules
        const points = await prisma.microSamplingPoint.findMany({
            where: { isActive: true },
            include: {
                schedules: { where: { isActive: true } },
                samples: {
                    where: {
                        takenAt: { gte: startDate, lte: endDate }
                    },
                    include: {
                        results: { include: { parameter: true } },
                        takenBy: { select: { name: true } }
                    },
                    orderBy: { takenAt: 'desc' }
                }
            },
            orderBy: { sortOrder: 'asc' }
        });

        // Build schedule grid: for each point, for each day, whether it's scheduled and whether there's a sample
        const schedule = points.map(point => {
            const days = {};
            for (let d = 0; d <= 6; d++) {
                const dayDate = new Date(startDate);
                dayDate.setDate(dayDate.getDate() + d);
                const dayOfWeek = dayDate.getDay(); // 0=Sunday

                const isScheduled = point.schedules.some(s => s.dayOfWeek === dayOfWeek);
                const daySamples = point.samples.filter(s => {
                    const sd = new Date(s.takenAt);
                    return sd.getDay() === dayOfWeek;
                });

                days[d] = {
                    date: dayDate.toISOString().split('T')[0],
                    dayOfWeek,
                    isScheduled,
                    sampleCount: daySamples.length,
                    samples: daySamples,
                    status: !isScheduled ? 'NOT_SCHEDULED'
                        : daySamples.length > 0 ? (daySamples.some(s => s.status === 'COMPLETED') ? 'COMPLETED' : 'SAMPLED')
                            : 'PENDING'
                };
            }
            return {
                id: point.id,
                code: point.code,
                name: point.name,
                processArea: point.processArea,
                isEnvironmental: point.isEnvironmental,
                days
            };
        });

        res.json({
            weekStart: startDate.toISOString().split('T')[0],
            weekEnd: endDate.toISOString().split('T')[0],
            schedule
        });
    } catch (error) {
        logger.error('Error fetching week schedule:', error);
        res.status(500).json({ error: 'Error al obtener cronograma semanal' });
    }
};

// ── Create Sample ──
exports.createSample = async (req, res) => {
    try {
        const userId = req.user.id;
        const { samplingPointId, lotNumber, batchCode, sampleDescription, lab, reportNumber, notes, takenAt, results } = req.body;

        // Generate sample number
        const lastSample = await prisma.microSample.findFirst({ orderBy: { createdAt: 'desc' } });
        let nextSeq = 1;
        if (lastSample?.sampleNumber?.startsWith('MIC-')) {
            const seq = parseInt(lastSample.sampleNumber.split('-')[1], 10);
            if (!isNaN(seq)) nextSeq = seq + 1;
        }
        const sampleNumber = `MIC-${String(nextSeq).padStart(4, '0')}`;

        const sample = await prisma.$transaction(async (tx) => {
            const newSample = await tx.microSample.create({
                data: {
                    sampleNumber,
                    samplingPointId,
                    takenAt: takenAt ? new Date(takenAt) : new Date(),
                    takenById: userId,
                    lotNumber,
                    batchCode,
                    sampleDescription,
                    lab,
                    reportNumber,
                    notes,
                    status: results && results.length > 0 ? 'COMPLETED' : 'PENDING',
                    reportUrl: req.file ? `/uploads/micro/${req.file.filename}` : null
                }
            });

            // Create results if provided
            if (results && results.length > 0) {
                const parsedResults = typeof results === 'string' ? JSON.parse(results) : results;

                for (const r of parsedResults) {
                    // Auto-calculate compliance
                    const param = await tx.microParameter.findUnique({ where: { id: r.parameterId } });
                    let isCompliant = null;
                    if (param) {
                        if (param.specText === 'Ausente') {
                            isCompliant = !r.isDetected;
                        } else if (param.specMax !== null && r.value !== null && r.value !== undefined) {
                            isCompliant = r.value <= param.specMax;
                        }
                    }

                    await tx.microResult.create({
                        data: {
                            sampleId: newSample.id,
                            parameterId: r.parameterId,
                            value: r.value !== undefined && r.value !== null && r.value !== '' ? parseFloat(r.value) : null,
                            valueText: r.valueText || null,
                            isDetected: r.isDetected !== undefined ? r.isDetected : null,
                            isCompliant,
                            notes: r.notes || null
                        }
                    });
                }
            }

            return newSample;
        });

        res.status(201).json({ message: 'Muestra registrada', sampleNumber: sample.sampleNumber, id: sample.id });
    } catch (error) {
        logger.error('Error creating micro sample:', error);
        res.status(500).json({ error: 'Error al registrar muestra: ' + error.message });
    }
};

// ── Update Sample Results ──
exports.updateSampleResults = async (req, res) => {
    try {
        const { id } = req.params;
        const { results, lab, reportNumber, notes } = req.body;

        const sample = await prisma.microSample.findUnique({ where: { id } });
        if (!sample) return res.status(404).json({ error: 'Muestra no encontrada' });

        await prisma.$transaction(async (tx) => {
            // Update sample metadata
            const updateData = { status: 'COMPLETED' };
            if (lab) updateData.lab = lab;
            if (reportNumber) updateData.reportNumber = reportNumber;
            if (notes) updateData.notes = notes;
            if (req.file) updateData.reportUrl = `/uploads/micro/${req.file.filename}`;

            await tx.microSample.update({ where: { id }, data: updateData });

            // Upsert results
            if (results) {
                const parsedResults = typeof results === 'string' ? JSON.parse(results) : results;
                for (const r of parsedResults) {
                    const param = await tx.microParameter.findUnique({ where: { id: r.parameterId } });
                    let isCompliant = null;
                    if (param) {
                        if (param.specText === 'Ausente') {
                            isCompliant = !r.isDetected;
                        } else if (param.specMax !== null && r.value !== null && r.value !== undefined) {
                            isCompliant = parseFloat(r.value) <= param.specMax;
                        }
                    }

                    await tx.microResult.upsert({
                        where: { sampleId_parameterId: { sampleId: id, parameterId: r.parameterId } },
                        update: {
                            value: r.value !== undefined && r.value !== null && r.value !== '' ? parseFloat(r.value) : null,
                            valueText: r.valueText || null,
                            isDetected: r.isDetected !== undefined ? r.isDetected : null,
                            isCompliant,
                            notes: r.notes || null
                        },
                        create: {
                            sampleId: id,
                            parameterId: r.parameterId,
                            value: r.value !== undefined && r.value !== null && r.value !== '' ? parseFloat(r.value) : null,
                            valueText: r.valueText || null,
                            isDetected: r.isDetected !== undefined ? r.isDetected : null,
                            isCompliant,
                            notes: r.notes || null
                        }
                    });
                }
            }
        });

        res.json({ message: 'Resultados actualizados' });
    } catch (error) {
        logger.error('Error updating micro results:', error);
        res.status(500).json({ error: 'Error al actualizar resultados' });
    }
};

// ── Dashboard Data ──
exports.getDashboard = async (req, res) => {
    try {
        // Last 4 weeks of data
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

        const recentSamples = await prisma.microSample.findMany({
            where: { takenAt: { gte: fourWeeksAgo } },
            include: {
                samplingPoint: true,
                results: { include: { parameter: true } },
                takenBy: { select: { name: true } }
            },
            orderBy: { takenAt: 'desc' }
        });

        // Compliance stats
        const allResults = recentSamples.flatMap(s => s.results);
        const totalResults = allResults.filter(r => r.isCompliant !== null).length;
        const compliantResults = allResults.filter(r => r.isCompliant === true).length;
        const nonCompliant = allResults.filter(r => r.isCompliant === false);

        // Compliance by point
        const byPoint = {};
        recentSamples.forEach(s => {
            const code = s.samplingPoint.code;
            if (!byPoint[code]) byPoint[code] = { name: s.samplingPoint.name, total: 0, compliant: 0, nonCompliant: 0 };
            s.results.forEach(r => {
                if (r.isCompliant !== null) {
                    byPoint[code].total++;
                    if (r.isCompliant) byPoint[code].compliant++;
                    else byPoint[code].nonCompliant++;
                }
            });
        });

        // Generate alerts and suggestions
        const alerts = generateAlerts(nonCompliant, recentSamples);

        res.json({
            summary: {
                totalSamples: recentSamples.length,
                totalResults,
                compliantResults,
                complianceRate: totalResults > 0 ? Math.round((compliantResults / totalResults) * 100) : null,
                nonCompliantCount: nonCompliant.length
            },
            byPoint,
            alerts,
            recentSamples: recentSamples.slice(0, 10)
        });
    } catch (error) {
        logger.error('Error fetching micro dashboard:', error);
        res.status(500).json({ error: 'Error al obtener dashboard microbiológico' });
    }
};

// ── Trend Data ──
exports.getTrendData = async (req, res) => {
    try {
        const { pointId, parameterId, weeks = 12 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (parseInt(weeks) * 7));

        const where = { sample: { takenAt: { gte: startDate } } };
        if (pointId) where.sample.samplingPointId = pointId;
        if (parameterId) where.parameterId = parameterId;

        const results = await prisma.microResult.findMany({
            where,
            include: {
                sample: {
                    include: { samplingPoint: { select: { code: true, name: true } } }
                },
                parameter: { select: { code: true, name: true, specMin: true, specMax: true, specText: true, unit: true } }
            },
            orderBy: { sample: { takenAt: 'asc' } }
        });

        // Group by parameter for charting
        const grouped = {};
        results.forEach(r => {
            const key = r.parameter.code;
            if (!grouped[key]) {
                grouped[key] = {
                    parameter: r.parameter,
                    dataPoints: []
                };
            }
            grouped[key].dataPoints.push({
                date: r.sample.takenAt,
                value: r.value,
                valueText: r.valueText,
                isCompliant: r.isCompliant,
                sampleNumber: r.sample.sampleNumber,
                point: r.sample.samplingPoint
            });
        });

        res.json({ trends: Object.values(grouped), period: { from: startDate, weeks: parseInt(weeks) } });
    } catch (error) {
        logger.error('Error fetching trend data:', error);
        res.status(500).json({ error: 'Error al obtener tendencias' });
    }
};

// ── Get Single Sample by ID ──
exports.getSampleById = async (req, res) => {
    try {
        const sample = await prisma.microSample.findUnique({
            where: { id: req.params.id },
            include: {
                samplingPoint: true,
                results: { include: { parameter: true } },
                takenBy: { select: { name: true } }
            }
        });
        if (!sample) return res.status(404).json({ error: 'Muestra no encontrada' });
        res.json(sample);
    } catch (error) {
        logger.error('Error fetching micro sample:', error);
        res.status(500).json({ error: 'Error al obtener muestra' });
    }
};

// ── Get All Samples (for list view) ──
exports.getSamples = async (req, res) => {
    try {
        const { pointId, status, limit = 50 } = req.query;
        const where = {};
        if (pointId) where.samplingPointId = pointId;
        if (status) where.status = status;

        const samples = await prisma.microSample.findMany({
            where,
            include: {
                samplingPoint: { select: { code: true, name: true } },
                results: { include: { parameter: { select: { code: true, name: true, specMax: true, specText: true } } } },
                takenBy: { select: { name: true } }
            },
            orderBy: { takenAt: 'desc' },
            take: parseInt(limit)
        });
        res.json(samples);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener muestras' });
    }
};

// ── Helper: Generate Alerts & Technical Suggestions ──
function generateAlerts(nonCompliantResults, recentSamples) {
    const alerts = [];

    nonCompliantResults.forEach(r => {
        const sample = recentSamples.find(s => s.results.some(sr => sr.id === r.id));
        if (!sample) return;

        const pointCode = sample.samplingPoint.code;
        const paramCode = r.parameter.code;

        let suggestion = '';
        let severity = 'WARNING'; // WARNING, CRITICAL, INFO

        // Technical suggestions based on patterns
        if (paramCode === 'SALMONELLA' && r.isDetected) {
            severity = 'CRITICAL';
            suggestion = '🚨 DETENER LÍNEA INMEDIATAMENTE. Descartar lote afectado. Sanitizar toda la planta con hipoclorito. Investigar fuente de contaminación (materias primas, agua, operarios). Notificar a dirección.';
        } else if (paramCode === 'ENTEROBACTERIAS') {
            if (pointCode.startsWith('ALG-PRE')) {
                suggestion = '⚠️ Carga alta antes de pasteurización. Revisar: temperatura de almacenamiento del alginato, limpieza del tanque de preparación, y tiempo entre preparación y pasteurización.';
            } else if (pointCode.startsWith('ALG-POST')) {
                severity = 'CRITICAL';
                suggestion = '🚨 Contaminación POST-pasteurización. La pasteurización no está eliminando la carga. Revisar: temperatura real vs. seteada del pasteurizador, tiempo de retención, posibles fugas en intercambiador de calor.';
            } else if (pointCode.startsWith('ESF')) {
                suggestion = '⚠️ Contaminación en esferificación. Revisar: limpieza de cabezotes de inyección, solución de cloruro de calcio, y superficies de contacto.';
            } else {
                suggestion = '⚠️ Carga de Enterobacterias elevada. Revisar condiciones de higiene, almacenamiento, y posible contaminación cruzada.';
            }
        } else if (paramCode === 'MOHOS_LEVADURAS') {
            if (r.value > 1000) {
                severity = 'CRITICAL';
                suggestion = '🚨 Carga muy alta de Mohos/Levaduras. Posible contaminación ambiental severa. Programar sanitización profunda de toda la planta, revisar sistema de ventilación y filtros de aire.';
            } else {
                suggestion = '📈 Mohos/Levaduras por encima del límite. Revisar: programa de limpieza y desinfección, condiciones ambientales (humedad, temperatura), y posible contaminación de materia prima.';
            }
        } else if (paramCode === 'AEROBIOS_MESOFILOS') {
            if (r.value > 10000000) {
                severity = 'CRITICAL';
                suggestion = '🚨 Aerobios mesófilos extremadamente altos (>10⁷ UFC/g). Indica condiciones favorables para crecimiento bacteriano. Revisar cadena de frío, tiempos de proceso, y sanitización general.';
            } else {
                suggestion = '⚠️ Aerobios mesófilos elevados. Revisar programa de limpieza e indicadores de proceso térmico.';
            }
        } else if (paramCode === 'COLIFORMES_TOTALES' || paramCode === 'COLIFORMES_FECALES') {
            severity = 'CRITICAL';
            suggestion = '🚨 Presencia de Coliformes. Indica contaminación fecal o post-proceso. Revisar: prácticas de higiene de operarios, agua de proceso, y posible contaminación cruzada. Considerar análisis de agua.';
        } else {
            suggestion = '⚠️ Resultado fuera de especificación. Revisar condiciones de proceso y sanitización.';
        }

        alerts.push({
            id: r.id,
            severity,
            date: sample.takenAt,
            sampleNumber: sample.sampleNumber,
            point: sample.samplingPoint.name,
            pointCode,
            parameter: r.parameter.name,
            value: r.value,
            valueText: r.valueText,
            specMax: r.parameter.specMax,
            suggestion
        });
    });

    // Check for trends: 3+ consecutive non-compliant
    const byPoint = {};
    recentSamples.forEach(s => {
        const code = s.samplingPoint.code;
        if (!byPoint[code]) byPoint[code] = [];
        const hasNC = s.results.some(r => r.isCompliant === false);
        byPoint[code].push({ date: s.takenAt, hasNC });
    });

    Object.entries(byPoint).forEach(([code, samples]) => {
        const sorted = samples.sort((a, b) => new Date(b.date) - new Date(a.date));
        const last3 = sorted.slice(0, 3);
        if (last3.length === 3 && last3.every(s => s.hasNC)) {
            alerts.push({
                severity: 'CRITICAL',
                point: code,
                parameter: 'Tendencia',
                suggestion: `🔴 TENDENCIA NEGATIVA: 3 muestras consecutivas fuera de especificación en ${code}. Se recomienda: 1) Detener proceso para investigación, 2) Revisar todo el programa de sanitización, 3) Considerar análisis de agua y materias primas.`
            });
        }
    });

    // Sort by severity
    const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

    return alerts;
}

// Helper: Get Monday of current week
function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}
