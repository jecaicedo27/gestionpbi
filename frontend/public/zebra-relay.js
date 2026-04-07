#!/usr/bin/env node
/**
 * zebra-relay.js — Local print relay for Zebra ZD230t
 *
 * Runs on the user's PC (same network as the Zebra printer).
 * Receives ZPL from the web app and forwards it to the printer via TCP:9100.
 *
 * Usage:
 *   node zebra-relay.js                      # Auto-discovers Zebra printer
 *   node zebra-relay.js --ip 192.168.1.50    # Manual IP
 */

const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');

// ── Parse CLI args ──
const args = process.argv.slice(2);
let printerIp = null;
let relayPort = 3939;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ip' && args[i + 1]) printerIp = args[i + 1];
    if (args[i] === '--port' && args[i + 1]) relayPort = parseInt(args[i + 1]);
}

const ZEBRA_PORT = 9100;
let discovering = false;
let lastDiscoveryFailed = false;

// ── Test printer connectivity ──
function testPrinter(ip) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(2000);
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => { sock.destroy(); resolve(false); });
        sock.connect(ZEBRA_PORT, ip);
    });
}

// ── Send ZPL to printer ──
function sendZPL(ip, zpl) {
    return new Promise((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(5000);
        sock.on('connect', () => { sock.write(zpl, 'utf8', () => sock.end()); });
        sock.on('close', () => resolve());
        sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout al conectar con la impresora')); });
        sock.on('error', (err) => { sock.destroy(); reject(new Error(`Error TCP: ${err.message}`)); });
        sock.connect(ZEBRA_PORT, ip);
    });
}

// ── Auto-discover Zebra on local network ──
async function discoverZebra() {
    if (discovering) return;
    discovering = true;
    lastDiscoveryFailed = false;
    console.log('\n🔍 Buscando impresora Zebra en la red local (puerto 9100)...');

    const interfaces = os.networkInterfaces();
    const subnets = new Set();
    for (const iface of Object.values(interfaces)) {
        for (const cfg of iface) {
            if (cfg.family === 'IPv4' && !cfg.internal) {
                subnets.add(cfg.address.split('.').slice(0, 3).join('.'));
            }
        }
    }

    for (const subnet of subnets) {
        console.log(`   Escaneando ${subnet}.1-254 ...`);
        const found = [];
        const promises = [];
        for (let i = 1; i < 255; i++) {
            const ip = `${subnet}.${i}`;
            promises.push(new Promise(resolve => {
                const sock = new net.Socket();
                sock.setTimeout(400);
                sock.on('connect', () => { found.push(ip); sock.destroy(); resolve(); });
                sock.on('timeout', () => { sock.destroy(); resolve(); });
                sock.on('error', () => { sock.destroy(); resolve(); });
                sock.connect(ZEBRA_PORT, ip);
            }));
        }
        await Promise.all(promises);
        if (found.length > 0) {
            printerIp = found[0];
            console.log(`✅ Zebra encontrada: ${printerIp}`);
            if (found.length > 1) console.log(`   (Otras: ${found.slice(1).join(', ')}) — use --ip para especificar`);
            discovering = false;
            return;
        }
    }

    console.log('⚠️  No se encontró ninguna impresora en puerto 9100.');
    console.log('   → Verifique que la Zebra esté encendida y en la misma red WiFi');
    console.log('   → O ingrese la IP manualmente desde gestionpbi.lat/labeling\n');
    lastDiscoveryFailed = true;
    discovering = false;
}

// ── Start HTTP relay server immediately ──
const server = http.createServer(async (req, res) => {
    console.log(`\n[📡] Petición entrante del navegador: ${req.method} ${req.url}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // GET /status
    if (req.method === 'GET' && req.url === '/status') {
        let printerStatus = 'unreachable';
        if (discovering) {
            printerStatus = 'searching';
        } else if (printerIp) {
            const alive = await testPrinter(printerIp);
            printerStatus = alive ? 'connected' : 'unreachable';
            if (!alive) {
                // Retry discovery if lost
                discoverZebra().catch(() => {});
            }
        } else {
            printerStatus = lastDiscoveryFailed ? 'not_found' : 'searching';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            relay: 'ok',
            printer: printerStatus,
            printerIp: printerIp || null,
            printerModel: 'Zebra ZD230t',
            discovering,
        }));
        return;
    }

    // POST /set-ip — set printer IP manually from the web app
    if (req.method === 'POST' && req.url === '/set-ip') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { ip } = JSON.parse(body);
                if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'IP inválida' }));
                    return;
                }
                const ok = await testPrinter(ip);
                if (!ok) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: `No se puede alcanzar ${ip}:${ZEBRA_PORT}` }));
                    return;
                }
                printerIp = ip;
                lastDiscoveryFailed = false;
                console.log(`✅ IP configurada manualmente: ${printerIp}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, printerIp }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // POST /print
    if (req.method === 'POST' && req.url === '/print') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                if (!printerIp) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Impresora no encontrada. Configure la IP desde la app.' }));
                    return;
                }
                const { zpl } = JSON.parse(body);
                if (!zpl) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falta el campo zpl' }));
                    return;
                }
                await sendZPL(printerIp, zpl);
                console.log(`✅ Etiqueta enviada a ${printerIp} (${zpl.length} bytes)`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, bytes: zpl.length }));
            } catch (err) {
                console.error(`❌ Error al imprimir:`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

server.listen(relayPort, '0.0.0.0', () => {
    console.log('\n===============================================');
    console.log('   ZEBRA ZD230 RELAY - LIQUIPOPS');
    console.log('===============================================');
    console.log(`\n🚀 Relay activo en el puerto ${relayPort} (Escuchando red local 0.0.0.0)`);
    console.log(`   (La Tablet u otra PC puede conectarse usando tu IP local: http://<TU_IP>:${relayPort})`);
    console.log('   Abre gestionpbi.lat/labeling o /assembly-execution → Zebra ZD230\n');

    // Start printer discovery in background (don't block server startup)
    if (!printerIp) {
        discoverZebra().catch(() => {});
    } else {
        testPrinter(printerIp).then(ok => {
            if (ok) console.log(`✅ Zebra en ${printerIp}:${ZEBRA_PORT} — Lista para imprimir`);
            else console.log(`⚠️  No se puede conectar a ${printerIp} — Verificando...`);
        });
    }
});

// ── VPS Queue Polling (for tablets behind AP isolation) ──
// Polls gestionpbi.lat/api/zebra/jobs/next every 1.5s.
// When the tablet queues a job via the VPS, this relay picks it up and prints it.
function fetchNextJob() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'gestionpbi.lat',
            path: '/api/zebra/jobs/next',
            method: 'GET',
            timeout: 4000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

setInterval(async () => {
    if (!printerIp || discovering) return;
    const job = await fetchNextJob();
    if (job && job.zpl) {
        try {
            await sendZPL(printerIp, job.zpl);
            console.log(`✅ [Queue] Etiqueta impresa desde VPS (job: ${job.id}, ${job.zpl.length} bytes)`);
        } catch (err) {
            console.error(`❌ [Queue] Error al imprimir job ${job.id}:`, err.message);
        }
    }
}, 1500);
