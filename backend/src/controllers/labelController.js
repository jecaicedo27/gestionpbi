const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const verifyQR = async (req, res) => {
    try {
        const { code } = req.body; // Expecting "B-YYYYMMDD-XXX"

        const batch = await prisma.productionBatch.findUnique({
            where: { batchCode: code },
            include: {
                product: true,
                productionOrder: true
            }
        });

        if (!batch) {
            return res.status(404).json({ success: false, message: 'Lote no encontrado' });
        }

        res.json({ success: true, data: batch });
    } catch (error) {
        res.status(500).json({ error: 'Error verificando QR' });
    }
};

module.exports = { verifyQR };
