const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/process-types
 * Obtener todos los tipos de proceso
 */
async function listProcessTypes(req, res) {
    try {
        const { active, category } = req.query;

        const where = {};
        if (active !== undefined) {
            where.active = active === 'true';
        }
        if (category) {
            where.category = category;
        }

        const processTypes = await prisma.processType.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        res.json(processTypes);
    } catch (error) {
        console.error('Error fetching process types:', error);
        res.status(500).json({ error: 'Failed to fetch process types' });
    }
}

/**
 * GET /api/process-types/:id
 * Obtener un tipo de proceso por ID
 */
async function getProcessType(req, res) {
    try {
        const { id } = req.params;

        const processType = await prisma.processType.findUnique({
            where: { id }
        });

        if (!processType) {
            return res.status(404).json({ error: 'Process type not found' });
        }

        res.json(processType);
    } catch (error) {
        console.error('Error fetching process type:', error);
        res.status(500).json({ error: 'Failed to fetch process type' });
    }
}

/**
 * POST /api/process-types
 * Crear un nuevo tipo de proceso
 */
async function createProcessType(req, res) {
    try {
        const {
            code,
            name,
            category,
            icon,
            color,
            parametersSchema
        } = req.body;

        // Validaciones
        if (!code || !name || !category) {
            return res.status(400).json({
                error: 'Missing required fields: code, name, category'
            });
        }

        if (!['STANDARD', 'SPECIAL'].includes(category)) {
            return res.status(400).json({
                error: 'Category must be STANDARD or SPECIAL'
            });
        }

        const processType = await prisma.processType.create({
            data: {
                code: code.toUpperCase(),
                name,
                category,
                icon,
                color,
                parametersSchema
            }
        });

        res.status(201).json(processType);
    } catch (error) {
        console.error('Error creating process type:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({
                error: 'Process type code already exists'
            });
        }

        res.status(500).json({ error: 'Failed to create process type' });
    }
}

/**
 * PATCH /api/process-types/:id
 * Actualizar un tipo de proceso
 */
async function updateProcessType(req, res) {
    try {
        const { id } = req.params;
        const {
            name,
            category,
            icon,
            color,
            parametersSchema,
            active
        } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (category !== undefined) updates.category = category;
        if (icon !== undefined) updates.icon = icon;
        if (color !== undefined) updates.color = color;
        if (parametersSchema !== undefined) updates.parametersSchema = parametersSchema;
        if (active !== undefined) updates.active = active;

        const processType = await prisma.processType.update({
            where: { id },
            data: updates
        });

        res.json(processType);
    } catch (error) {
        console.error('Error updating process type:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Process type not found' });
        }

        res.status(500).json({ error: 'Failed to update process type' });
    }
}

/**
 * DELETE /api/process-types/:id
 * Eliminar (desactivar) un tipo de proceso
 */
async function deleteProcessType(req, res) {
    try {
        const { id } = req.params;

        // Soft delete: marcar como inactivo
        const processType = await prisma.processType.update({
            where: { id },
            data: { active: false }
        });

        res.json({ message: 'Process type deactivated successfully', processType });
    } catch (error) {
        console.error('Error deleting process type:', error);

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Process type not found' });
        }

        res.status(500).json({ error: 'Failed to delete process type' });
    }
}

module.exports = {
    listProcessTypes,
    getProcessType,
    createProcessType,
    updateProcessType,
    deleteProcessType
};
