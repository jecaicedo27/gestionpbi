const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CONFIG_KEY = 'PRODUCTION_CONFIG';

exports.getConfig = async (req, res) => {
    try {
        const config = await prisma.systemSettings.findUnique({
            where: { key: CONFIG_KEY }
        });

        if (!config) {
            // Return sensible defaults instead of 404
            return res.json({
                targetDays: 8,
                minStockDays: 15,
                alertYellow: 12,
                alertRed: 3,
                syrupRatio: 0.70,
                batchDuration: 140,
                geniality_targetDays: 8,
                geniality_alertYellow: 12,
                geniality_alertRed: 3
            });
        }

        res.json(config.value);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching config' });
    }
};

exports.updateConfig = async (req, res) => {
    try {
        const newSettings = req.body; // Expects object with targetDays, minStockDays, etc.

        // Validation could go here

        const updated = await prisma.systemSettings.upsert({
            where: { key: CONFIG_KEY },
            update: { value: newSettings },
            create: {
                key: CONFIG_KEY,
                value: newSettings,
                description: 'Comportamiento del Programador de Producción'
            }
        });

        res.json({ message: 'Configuración actualizada', config: updated.value });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating config' });
    }
};

// Helper for internal use
exports.getInternalConfig = async () => {
    const config = await prisma.systemSettings.findUnique({
        where: { key: CONFIG_KEY }
    });
    return config ? config.value : null;
};

// Default PQR report types (used as fallback if not configured)
const DEFAULT_PQR_TYPES = [
    { value: 'CALCIFICACION', label: 'Calcificación' },
    { value: 'INFLADO', label: 'Inflado' },
    { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
    { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
    { value: 'MAL_SELLADO', label: 'Mal Sellado' },
    { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
    { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
    { value: 'VENCIDO', label: 'Vencido' },
    { value: 'CONTAMINADO', label: 'Contaminado' },
    { value: 'OTRO', label: 'Otro' }
];

/**
 * GET /api/config/pqr-types
 * Returns PQR report types (configurable from admin panel)
 */
exports.getPqrTypes = async (req, res) => {
    try {
        const config = await prisma.systemSettings.findUnique({
            where: { key: CONFIG_KEY }
        });
        const types = config?.value?.pqr_report_types || DEFAULT_PQR_TYPES;
        res.json(types);
    } catch (error) {
        console.error('Error fetching PQR types:', error);
        res.json(DEFAULT_PQR_TYPES);
    }
};
