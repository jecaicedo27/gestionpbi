/**
 * handoffRoutes.js
 * 
 * REST endpoints for Production -> Logistics handoffs.
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const handoffService = require('../services/handoffService');

// ── GET /pending — Get all pending handoffs ───────────────────────────────
router.get('/pending', auth, async (req, res) => {
    try {
        const handoffs = await handoffService.getPendingHandoffs();
        res.json({ success: true, handoffs });
    } catch (err) {
        console.error('handoffs/pending error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /history — Get completed/rejected handoffs ────────────────────────
router.get('/history', auth, async (req, res) => {
    try {
        const history = await handoffService.getHandoffHistory(100);
        res.json({ success: true, history });
    } catch (err) {
        console.error('handoffs/history error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST / — Create a new handoff (Production only) ───────────────────────
router.post('/', auth, async (req, res) => {
    try {
        const { items, notes, observations, batchNumber, batchId, source } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Debes incluir al menos un lote.' });
        }
        
        // Normalize items: accept 'quantity' or 'requestedQuantity'
        const normalizedItems = items.map(i => ({
            productId: i.productId,
            lotNumber: i.lotNumber,
            requestedQuantity: i.requestedQuantity || i.quantity || 0,
            ncQuantity: i.ncQuantity || 0,
        }));

        const handoff = await handoffService.createHandoff({
            userId: req.user.id,
            items: normalizedItems,
            notes: notes || observations || null,
            batchNumber: batchNumber || null,
            batchId: batchId || null,
            source: source || null,
        });
        
        res.status(201).json({ success: true, handoff, handoffNumber: handoff.handoffNumber });
    } catch (err) {
        console.error('handoffs/create error:', err);
        const status = err.message.includes('insuficiente') ? 409 : err.message.includes('pendiente') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── POST /:id/receive — Logistics receives the handoff ────────────────────
router.post('/:id/receive', auth, async (req, res) => {
    try {
        const { receivedItems } = req.body; // Array of { itemId, receivedQuantity }
        if (!receivedItems || !Array.isArray(receivedItems)) {
            return res.status(400).json({ error: 'receivedItems debe ser un array con las cantidades verificadas.' });
        }

        const handoff = await handoffService.receiveHandoff({
            handoffId: req.params.id,
            receivedById: req.user.id,
            receivedItems
        });
        
        res.json({ success: true, handoff });
    } catch (err) {
        console.error('handoffs/receive error:', err);
        const status = err.message.includes('insuficiente') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── POST /:id/reject — Logistics rejects the handoff entirely ─────────────
router.post('/:id/reject', auth, async (req, res) => {
    try {
        const { reason } = req.body;
        const handoff = await handoffService.rejectHandoff({
            handoffId: req.params.id,
            receivedById: req.user.id,
            reason: reason || 'Rechazado por Logística'
        });
        res.json({ success: true, handoff });
    } catch (err) {
        console.error('handoffs/reject error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
