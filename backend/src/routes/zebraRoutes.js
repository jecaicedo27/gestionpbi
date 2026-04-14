/**
 * zebraRoutes.js
 *
 * Backend proxy for Zebra ZD230 printing via TCP:9100.
 * The tablet sends ZPL to this endpoint; the backend server
 * forwards it directly to the printer on the local network.
 * Eliminates the need for a PC-based relay app.
 */

const express = require('express');
const router = express.Router();
const net = require('net');
const { auth } = require('../middleware/auth');

const ZEBRA_PORT = 9100;

// --- Configurable printer IP ---
// Can be overridden per-request via body { printerIp: '...' }
// Falls back to env variable ZEBRA_PRINTER_IP, then to hardcoded default.
const DEFAULT_PRINTER_IP = process.env.ZEBRA_PRINTER_IP || '192.168.0.126';

// ── In-memory print job queue (survives process restarts poorly, but fine for labels) ──
const printJobQueue = [];
const MAX_QUEUE_SIZE = 100;

/**
 * POST /api/zebra/jobs
 * Tablet submits a ZPL print job to the VPS queue.
 * PC relay polls /jobs/next to pick it up and print via TCP.
 */
router.post('/jobs', auth, (req, res) => {
    const { zpl } = req.body;
    if (!zpl) return res.status(400).json({ error: 'Falta zpl' });
    const job = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        zpl,
        created: new Date().toISOString(),
    };
    printJobQueue.push(job);
    // Keep queue bounded
    while (printJobQueue.length > MAX_QUEUE_SIZE) printJobQueue.shift();
    console.log(`🖨️ [ZebraQueue] Job enqueued: ${job.id} (${zpl.length} bytes). Queue size: ${printJobQueue.length}`);
    res.json({ ok: true, jobId: job.id, queued: printJobQueue.length });
});

/**
 * GET /api/zebra/jobs/next
 * PC relay polls this endpoint. Returns and removes the oldest pending job.
 * No auth required — relay has no user session. Keep this endpoint low-cost.
 */
router.get('/jobs/next', (req, res) => {
    const job = printJobQueue.shift() || null;
    if (job) console.log(`🖨️ [ZebraQueue] Job dispatched to relay: ${job.id}`);
    res.json(job);
});

function testPrinter(ip, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => { sock.destroy(); resolve(false); });
        sock.connect(ZEBRA_PORT, ip);
    });
}

function sendZPL(ip, zpl, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);
        sock.on('connect', () => {
            sock.write(zpl, 'utf8', () => sock.end());
        });
        sock.on('close', () => resolve());
        sock.on('timeout', () => {
            sock.destroy();
            reject(new Error('Timeout conectando con la impresora Zebra'));
        });
        sock.on('error', (err) => {
            sock.destroy();
            reject(new Error(`Error TCP Zebra: ${err.message}`));
        });
        sock.connect(ZEBRA_PORT, ip);
    });
}

/**
 * GET /api/zebra/status
 * Checks if the Zebra printer is reachable.
 * Query: ?ip=192.168.0.126 (optional, overrides default)
 */
router.get('/status', auth, async (req, res) => {
    const printerIp = req.query.ip || DEFAULT_PRINTER_IP;
    
    // Sanitize client IP from headers (could be a comma-separated list)
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }
    // Strip IPv6 mapping if present (e.g., ::ffff:1.2.3.4)
    if (clientIp && clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.substring(7);
    }

    try {
        // 1. Try internal/local IP (only works if server is in the same LAN)
        let reachable = await testPrinter(printerIp, 1500);
        let finalIp = printerIp;

        // 2. Fallback: Try Client's Public IP (if port 9100 is open in their router)
        if (!reachable && clientIp && clientIp !== printerIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
            console.log(`[Zebra Status] Local ${printerIp} down. Trying public client IP: ${clientIp}...`);
            reachable = await testPrinter(clientIp, 2000);
            if (reachable) finalIp = clientIp;
        }

        res.json({
            relay: 'backend',
            printer: reachable ? 'connected' : 'unreachable',
            printerIp: reachable ? finalIp : null,
            isPublic: finalIp === clientIp && reachable,
            printerModel: 'Zebra ZD230',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/zebra/print
 * Body: { zpl: "^XA...", printerIp: "..." (optional) }
 * Sends the ZPL directly to the Zebra printer via TCP:9100.
 */
router.post('/print', auth, async (req, res) => {
    const { zpl, printerIp: bodyIp } = req.body;
    const printerIp = bodyIp || DEFAULT_PRINTER_IP;
    
    // Sanitize client IP from headers
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }
    if (clientIp && clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.substring(7);
    }

    if (!zpl) {
        return res.status(400).json({ error: 'Falta el campo zpl' });
    }

    try {
        // 1. Try specified/local IP
        try {
            await sendZPL(printerIp, zpl);
            console.log(`✅ Zebra [backend-proxy] → Local ${printerIp}:${ZEBRA_PORT}`);
            return res.json({ ok: true, bytes: zpl.length, printerIp });
        } catch (err) {
            // 2. Fallback: Try Client Public IP
            if (clientIp && clientIp !== printerIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
                console.log(`[Zebra Print] Local ${printerIp} failed. Trying public client IP: ${clientIp}...`);
                await sendZPL(clientIp, zpl);
                console.log(`✅ Zebra [backend-proxy] → Public ${clientIp}:${ZEBRA_PORT}`);
                return res.json({ ok: true, bytes: zpl.length, printerIp: clientIp, isPublic: true });
            }
            throw err;
        }
    } catch (err) {
        console.error(`❌ Zebra [backend-proxy] error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
