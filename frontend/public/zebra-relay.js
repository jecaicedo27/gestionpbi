#!/usr/bin/env node
/**
 * zebra-relay.js — Local print relay for Zebra ZD230t
 * 
 * Runs on the user's PC (same network as the Zebra printer).
 * Receives ZPL from the web app and forwards it to the printer via TCP:9100.
 *
 * Usage:
 *   node zebra-relay.js                          # Auto-discovers Zebra printer
 *   node zebra-relay.js --ip 192.168.1.50        # Manual IP
 *   node zebra-relay.js --ip 192.168.1.50 --port 3939
 *
 * The web app sends POST http://localhost:3939/print with body { zpl: "..." }
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');

// ── Parse CLI args ──
const args = process.argv.slice(2);
let printerIp = null;
let relayPort = 3939;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ip' && args[i + 1]) printerIp = args[i + 1];
    if (args[i] === '--port' && args[i + 1]) relayPort = parseInt(args[i + 1]);
}

const ZEBRA_PORT = 9100;

// ── Auto-discover Zebra printer via mDNS-like scan ──
async function discoverZebra() {
    console.log('🔍 Buscando impresora Zebra en la red local...');
    
    // Get local network info
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const localNets = [];
    
    for (const iface of Object.values(interfaces)) {
        for (const cfg of iface) {
            if (cfg.family === 'IPv4' && !cfg.internal) {
                const parts = cfg.address.split('.');
                localNets.push(parts.slice(0, 3).join('.'));
            }
        }
    }
    
    if (localNets.length === 0) {
        console.log('❌ No se encontraron interfaces de red activas');
        return null;
    }
    
    // Scan port 9100 on local subnet (common for Zebra printers)
    const subnet = localNets[0];
    console.log(`   Escaneando ${subnet}.0/24 puerto 9100...`);
    
    const found = [];
    const promises = [];
    
    for (let i = 1; i < 255; i++) {
        const ip = `${subnet}.${i}`;
        promises.push(new Promise(resolve => {
            const sock = new net.Socket();
            sock.setTimeout(300);
            sock.on('connect', () => {
                found.push(ip);
                sock.destroy();
                resolve();
            });
            sock.on('timeout', () => { sock.destroy(); resolve(); });
            sock.on('error', () => { sock.destroy(); resolve(); });
            sock.connect(ZEBRA_PORT, ip);
        }));
    }
    
    await Promise.all(promises);
    
    if (found.length === 0) {
        console.log('❌ No se encontró ninguna impresora en puerto 9100');
        return null;
    }
    
    if (found.length === 1) {
        console.log(`✅ Impresora encontrada: ${found[0]}`);
        return found[0];
    }
    
    console.log(`⚠️  Múltiples impresoras encontradas: ${found.join(', ')}`);
    console.log(`   Usando la primera: ${found[0]}`);
    console.log(`   Para usar otra, ejecute: node zebra-relay.js --ip <IP>`);
    return found[0];
}

// ── Test printer connectivity ──
async function testPrinter(ip) {
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
        sock.on('connect', () => {
            sock.write(zpl, 'utf8', () => {
                sock.end();
            });
        });
        sock.on('close', () => resolve());
        sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout conectando a impresora')); });
        sock.on('error', (err) => { sock.destroy(); reject(new Error(`Error de conexión: ${err.message}`)); });
        sock.connect(ZEBRA_PORT, ip);
    });
}

// ── Main ──
(async () => {
    // Discover or verify printer IP
    if (!printerIp) {
        printerIp = await discoverZebra();
        if (!printerIp) {
            console.log('\n💡 Use: node zebra-relay.js --ip <IP_DE_ZEBRA>');
            process.exit(1);
        }
    }
    
    const ok = await testPrinter(printerIp);
    if (!ok) {
        console.log(`❌ No se puede conectar a ${printerIp}:${ZEBRA_PORT}`);
        console.log('   Verifique que la Zebra esté encendida y en la misma red');
        process.exit(1);
    }
    
    console.log(`\n🖨️  Zebra ZD230 detectada en ${printerIp}:${ZEBRA_PORT}`);
    
    // ── Start HTTP relay server ──
    const server = http.createServer(async (req, res) => {
        // CORS headers (allow browser from any origin)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        
        // Health check
        if (req.method === 'GET' && req.url === '/status') {
            const alive = await testPrinter(printerIp);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                relay: 'ok',
                printer: alive ? 'connected' : 'unreachable',
                printerIp,
                printerModel: 'Zebra ZD230t',
            }));
            return;
        }
        
        // Print endpoint
        if (req.method === 'POST' && req.url === '/print') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { zpl } = JSON.parse(body);
                    if (!zpl) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing zpl field' }));
                        return;
                    }
                    
                    await sendZPL(printerIp, zpl);
                    console.log(`✅ Etiqueta enviada (${zpl.length} bytes)`);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, bytes: zpl.length }));
                } catch (err) {
                    console.error(`❌ Error:`, err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }
        
        res.writeHead(404);
        res.end('Not found');
    });
    
    server.listen(relayPort, '0.0.0.0', () => {
        console.log(`\n🚀 Relay activo en http://localhost:${relayPort}`);
        console.log(`   POST /print  → Enviar etiqueta ZPL`);
        console.log(`   GET  /status → Estado de la impresora\n`);
        console.log(`   Abre gestionpbi.lat/labeling y selecciona "Zebra ZD230"\n`);
    });
})();
