const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// CONFIGURACIÓN (Áreas y Químicos)
// ==========================================

async function getSanitationConfig(req, res) {
    try {
        const areas = await prisma.sanitationArea.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
            include: {
                components: {
                    where: { isActive: true },
                    orderBy: { sortOrder: 'asc' }
                }
            }
        });
        
        const chemicals = await prisma.sanitationChemical.findMany({
            where: { isActive: true },
            orderBy: { type: 'asc' }
        });
        
        res.json({ areas, chemicals });
    } catch (error) {
        console.error('Error fetching sanitation config:', error);
        res.status(500).json({ error: 'Failed to fetch sanitation config' });
    }
}

async function createArea(req, res) {
    try {
        const { name, description, productionLine } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        
        const area = await prisma.sanitationArea.create({
            data: { name, description, productionLine: productionLine || 'GENERAL' }
        });
        res.status(201).json(area);
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ error: 'El nombre ya existe' });
        res.status(500).json({ error: 'Failed to create area' });
    }
}

async function updateArea(req, res) {
    try {
        const { id } = req.params;
        const { name, description, productionLine, isActive } = req.body;
        
        const area = await prisma.sanitationArea.update({
            where: { id },
            data: { name, description, productionLine, isActive }
        });
        res.json(area);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update area' });
    }
}

async function createChemical(req, res) {
    try {
        const { name, type, activePrinciple, standardDose } = req.body;
        if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
        
        const chem = await prisma.sanitationChemical.create({
            data: { name, type, activePrinciple, standardDose }
        });
        res.status(201).json(chem);
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ error: 'El nombre ya existe' });
        res.status(500).json({ error: 'Failed to create chemical' });
    }
}

async function updateChemical(req, res) {
    try {
        const { id } = req.params;
        const { name, type, activePrinciple, standardDose, isActive } = req.body;
        
        const chem = await prisma.sanitationChemical.update({
            where: { id },
            data: { name, type, activePrinciple, standardDose, isActive }
        });
        res.json(chem);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update chemical' });
    }
}

// ==========================================
// COMPONENTES DE EQUIPOS (Checklist Parts)
// ==========================================

async function listComponents(req, res) {
    try {
        const { areaId } = req.params;
        const components = await prisma.sanitationComponent.findMany({
            where: { areaId, isActive: true },
            orderBy: { sortOrder: 'asc' }
        });
        res.json(components);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list components' });
    }
}

async function createComponent(req, res) {
    try {
        const { areaId, name, sortOrder } = req.body;
        if (!areaId || !name) return res.status(400).json({ error: 'areaId and name are required' });
        
        const maxOrder = await prisma.sanitationComponent.aggregate({
            where: { areaId },
            _max: { sortOrder: true }
        });
        const comp = await prisma.sanitationComponent.create({
            data: { areaId, name, sortOrder: sortOrder ?? ((maxOrder._max.sortOrder ?? 0) + 1) }
        });
        res.status(201).json(comp);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create component' });
    }
}

async function updateComponent(req, res) {
    try {
        const { id } = req.params;
        const { name, sortOrder, isActive } = req.body;
        const comp = await prisma.sanitationComponent.update({
            where: { id },
            data: { name, sortOrder, isActive }
        });
        res.json(comp);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update component' });
    }
}

// ==========================================
// REGISTROS (Sanitation Records)
// ==========================================

async function listRecords(req, res) {
    try {
        const { startDate, endDate, areaId, type } = req.query;
        
        const where = {};
        
        if (startDate && endDate) {
            where.startedAt = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }
        
        if (areaId) where.areaId = areaId;
        if (type) where.type = type;

        const records = await prisma.sanitationRecord.findMany({
            where,
            include: {
                area: true,
                performedBy: { select: { id: true, name: true } },
                verifiedBy: { select: { id: true, name: true } },
                detergent: true,
                disinfectant: true,
                checkItems: { include: { component: true }, orderBy: { component: { sortOrder: 'asc' } } }
            },
            orderBy: { startedAt: 'desc' },
            take: 100 // Limit for performance on initial load
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error fetching sanitation records:', error);
        res.status(500).json({ error: 'Failed to fetch sanitation records' });
    }
}

async function createRecord(req, res) {
    try {
        const {
            areaId,
            type,
            performedById,
            startedAt,
            completedAt,
            detergentId,
            detergentDose,
            detergentTimeMinutes,
            disinfectantId,
            disinfectantDose,
            disinfectantTimeMinutes,
            photoUrl,
            observations,
            checkItems // Array of { componentId, checked, photoUrl }
        } = req.body;

        if (!areaId || !type || !performedById || !startedAt || !completedAt) {
            return res.status(400).json({ error: 'Faltan campos obligatorios para el registro POES' });
        }

        const record = await prisma.sanitationRecord.create({
            data: {
                areaId,
                type,
                performedById,
                startedAt: new Date(startedAt),
                completedAt: new Date(completedAt),
                detergentId,
                detergentDose,
                detergentTimeMinutes: detergentTimeMinutes ? parseInt(detergentTimeMinutes) : null,
                disinfectantId,
                disinfectantDose,
                disinfectantTimeMinutes: disinfectantTimeMinutes ? parseInt(disinfectantTimeMinutes) : null,
                photoUrl,
                observations,
                status: 'COMPLETED',
                checkItems: checkItems && checkItems.length > 0 ? {
                    create: checkItems.map(ci => ({
                        componentId: ci.componentId,
                        checked: ci.checked || false,
                        photoUrl: ci.photoUrl || null,
                        checkedAt: ci.checked ? new Date() : null
                    }))
                } : undefined
            },
            include: {
                area: true,
                detergent: true,
                disinfectant: true,
                performedBy: { select: { id: true, name: true } },
                checkItems: { include: { component: true } }
            }
        });

        res.status(201).json(record);
    } catch (error) {
        console.error('Error creating sanitation record:', error);
        res.status(500).json({ error: 'Failed to create sanitation record' });
    }
}

async function verifyRecord(req, res) {
    try {
        const { id } = req.params;
        const { verifiedById } = req.body;

        if (!verifiedById) {
            return res.status(400).json({ error: 'verifiedById requerído' });
        }

        const record = await prisma.sanitationRecord.update({
            where: { id },
            data: {
                verifiedById,
                status: 'VERIFIED'
            },
            include: {
                verifiedBy: { select: { id: true, name: true } }
            }
        });

        res.json(record);
    } catch (error) {
        console.error('Error verifying sanitation record:', error);
        res.status(500).json({ error: 'Failed to verify sanitation record' });
    }
}

async function updateCheckItem(req, res) {
    try {
        const { id } = req.params;
        const { checked, photoUrl } = req.body;

        const item = await prisma.sanitationCheckItem.update({
            where: { id },
            data: {
                checked: checked !== undefined ? checked : undefined,
                photoUrl: photoUrl !== undefined ? photoUrl : undefined,
                checkedAt: checked ? new Date() : null
            },
            include: { component: true }
        });
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update check item' });
    }
}

module.exports = {
    getSanitationConfig,
    createArea,
    updateArea,
    createChemical,
    updateChemical,
    listComponents,
    createComponent,
    updateComponent,
    listRecords,
    createRecord,
    verifyRecord,
    updateCheckItem
};
