const { PrismaClient } = require('@prisma/client');
const siigoService = require('../services/siigoService');
const prisma = new PrismaClient();

const generateInvoice = async (req, res) => {
    try {
        const { orderId } = req.body;

        const order = await prisma.order.findUnique({
            where: { id: parseInt(orderId) },
            include: {
                items: { include: { product: true } },
                user: true
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Trigger SIIGO Invoice
        const siigoInvoice = await siigoService.createInvoice(order);

        // Update Order with Invoice Number
        await prisma.order.update({
            where: { id: parseInt(orderId) },
            data: {
                status: 'INVOICED',
                // In a real app, we would store externalInvoiceId here
            }
        });

        res.json({ success: true, data: siigoInvoice });

    } catch (error) {
        res.status(500).json({ error: 'Error generating invoice' });
    }
};

module.exports = { generateInvoice };
