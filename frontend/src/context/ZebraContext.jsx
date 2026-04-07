/**
 * ZebraContext.jsx
 *
 * Global Zebra printer state para toda la app.
 *
 * ── Modo HTTP (tablet en red local) ──────────────────────────────────────────
 *   La app se sirve por http://72.60.175.159  →  sin bloqueo mixed-content
 *   → ping y print directo a http://ZEBRA_IP via fetch
 *
 * ── Modo HTTPS (acceso normal) ───────────────────────────────────────────────
 *   Usa proxy backend /api/zebra/* (solo funciona si el servidor
 *   está en la misma red que la impresora).
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

const ZebraContext = createContext(null);

const POLL_INTERVAL_MS = 10_000;
const ZEBRA_IP = '192.168.68.113';

// ¿La app está sirviendo por HTTP? (sin TLS)
const isHttp = () => window.location.protocol === 'http:';

export const ZebraProvider = ({ children }) => {
    const { user } = useAuth();
    const [zebraStatus, setZebraStatus] = useState(null);
    const [zebraIp, setZebraIp] = useState('');
    const [lastError, setLastError] = useState(null);
    const [isRechecking, setIsRechecking] = useState(false);
    
    // Manual Overrides (for tablets/domestic networks)
    const [configIp, setConfigIp] = useState(() => localStorage.getItem('zebra_manual_ip') || ZEBRA_IP);
    const [relayIp, setRelayIp] = useState(() => localStorage.getItem('zebra_relay_ip') || '');
    // Force direct IP: bypasses PNA auto-detection (for Android Chrome)
    const [forceIp, setForceIpState] = useState(() => localStorage.getItem('zebra_force_ip') || '');

    const intervalRef = useRef(null);

    const checkStatus = useCallback(async (isManual = false) => {
        if (!user) return;
        if (isManual) setIsRechecking(true);

        // ── Force Direct IP mode (for Android Chrome PNA block) ──
        if (forceIp) {
            setZebraStatus('connected');
            setZebraIp(forceIp);
            if (isManual) setIsRechecking(false);
            return;
        }
        try {
            // 0. Zebra Browser Print (Android App) — Runs locally on the tablet itself
            //    App: "Zebra Browser Print" on Google Play. Exposes port 9090 on localhost.
            //    This is the most reliable path: browser → localhost (no PNA block possible).
            const browserPrintUrls = ['http://localhost:9090', 'http://127.0.0.1:9090'];
            for (const bpUrl of browserPrintUrls) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 1500);
                    const res = await fetch(`${bpUrl}/available`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (res.ok) {
                        const data = await res.json();
                        // data.printer is an array of connected printers
                        const hasPrinter = data.printer && data.printer.length > 0;
                        setZebraStatus(hasPrinter ? 'connected' : 'unreachable');
                        setZebraIp(hasPrinter ? `BrowserPrint@${data.printer[0].name || 'ZD230'}` : '');
                        if (isManual) setIsRechecking(false);
                        return;
                    }
                } catch (e) {
                    // App not installed or not running
                }
            }

            // 1. Direct LAN Attempt (WiFi Mode — HTTP only, no PNA block)
            const targetIp = configIp || ZEBRA_IP;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), isManual ? 4500 : 3500); 
                await fetch(`http://${targetIp}/index.html`, { 
                    method: 'GET',
                    mode: 'no-cors',
                    signal: controller.signal 
                });
                clearTimeout(timeoutId);
                setZebraStatus('connected');
                setZebraIp(targetIp);
                if (isManual) setIsRechecking(false);
                return;
            } catch (err) {
                // Not reachable or blocked by browser
            }

            // 2. Local/Remote Relay Attempt (PC Mode)
            const relays = [];
            if (relayIp) relays.push(`http://${relayIp}:3939`);
            relays.push('http://127.0.0.1:3939', 'http://localhost:3939');

            for (const baseUrl of relays) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 1500);
                    const res = await fetch(`${baseUrl}/status`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (res.ok) {
                        const data = await res.json();
                        setZebraStatus(data.printer === 'connected' ? 'connected' : 'unreachable');
                        setZebraIp(baseUrl.replace('http://', ''));
                        if (isManual) setIsRechecking(false);
                        return;
                    }
                } catch (e) {}
            }

            // 3. VPS Queue Check — if backend is up, we can queue print jobs (AP-isolation fallback)
            const token = localStorage.getItem('token');
            const queueRes = await fetch('/api/zebra/jobs/next', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });
            if (queueRes.ok) {
                // Backend reachable — tablet can enqueue jobs, PC relay prints them
                setZebraStatus('connected');
                setZebraIp('VPS-Queue');
            } else {
                setZebraStatus('unreachable');
            }
        } catch (error) {
            console.error('[ZebraContext] status check error:', error);
            setZebraStatus('unreachable');
        } finally {
            if (isManual) setIsRechecking(false);
        }
    }, [user, configIp, relayIp, forceIp]);

    useEffect(() => {
        if (!user) {
            setZebraStatus(null);
            setZebraIp('');
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        setZebraStatus('checking');

        // Initial delay for tablets: browser sandbox needs a moment to stabilize
        // after F5 before allowing site-to-LAN fetches.
        const initTimeout = setTimeout(() => {
            checkStatus();
            intervalRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
        }, 3000); 

        return () => {
            clearTimeout(initTimeout);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [user, checkStatus]);

    /**
     * printZPL(zpl) → { ok, error? }
     * HTTP mode: POST directo al endpoint /pstprnt de la Zebra
     * HTTPS mode: PC Relay (localhost:3939) -> Proxy backend
     */
    const printZPL = useCallback(async (zpl) => {
        setLastError(null);
        try {
            // 0. Zebra Browser Print Android App
            if (zebraIp && zebraIp.startsWith('BrowserPrint@')) {
                // The app expects: POST /write with body { device: {...}, data: "ZPL" }
                // First get the available device to get its uid
                let device = null;
                for (const bpUrl of ['http://localhost:9090', 'http://127.0.0.1:9090']) {
                    try {
                        const r = await fetch(`${bpUrl}/available`);
                        if (r.ok) {
                            const d = await r.json();
                            if (d.printer && d.printer.length > 0) {
                                device = d.printer[0];
                                const writeRes = await fetch(`${bpUrl}/write`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ device, data: zpl }),
                                });
                                if (writeRes.ok) return { ok: true };
                                throw new Error('Error en Zebra Browser Print');
                            }
                        }
                    } catch (e2) {
                        throw e2;
                    }
                }
                throw new Error('Impresora no encontrada en Browser Print');
            }

            // 0.5. VPS Queue mode — but always try direct WiFi first.
            // From HTTP (tablet): works directly. From HTTPS (PC): browser may block
            // mixed-content → catch → fall to VPS Queue silently.
            if (zebraIp === 'VPS-Queue' && !forceIp) {
                const wifiIp = configIp || ZEBRA_IP;
                try {
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 2500);
                    await fetch(`http://${wifiIp}/pstprnt`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: zpl,
                        mode: 'no-cors',
                        signal: ctrl.signal,
                    });
                    clearTimeout(timer);
                    return { ok: true }; // no-cors → opaque response, assume success
                } catch (_wifiErr) {
                    // Mixed-content block or unreachable → fall to VPS Queue
                }
                const token = localStorage.getItem('token');
                const res = await fetch('/api/zebra/jobs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ zpl }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Error al encolar impresión');
                return { ok: true, queued: true, jobId: data.jobId };
            }

            // 1. Direct LAN Printing (includes force-IP mode)
            const directIp = forceIp || (zebraIp === configIp || zebraIp === ZEBRA_IP ? zebraIp : null);
            if (directIp) {
                await fetch(`http://${directIp}/pstprnt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: zpl,
                    mode: 'no-cors',
                });
                return { ok: true };
            } 
            
            // 2. PC Relay Printing
            if (zebraIp.includes(':3939')) {
                const res = await fetch(`http://${zebraIp}/print`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zpl })
                });
                if (!res.ok) throw new Error('Error en Zebra Relay local');
                return { ok: true };
            }

            // 3. VPS Job Queue (AP-isolation bypass — PC relay polls /api/zebra/jobs/next)
            const token = localStorage.getItem('token');
            const res = await fetch('/api/zebra/jobs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ zpl }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.error || 'Error al encolar trabajo de impresión';
                setLastError(msg);
                return { ok: false, error: msg };
            }
            // Job queued — PC relay will pick it up within ~1.5s
            return { ok: true, queued: true, jobId: data.jobId };
            
        } catch (err) {
            console.error('[ZebraContext] print error:', err);
            const msg = err.message || 'Sin conexión con la impresora';
            setLastError(msg);
            return { ok: false, error: msg };
        }
    }, [zebraIp, configIp, forceIp]);

    const updateConfig = (newIp, newRelay) => {
        if (newIp) {
            setConfigIp(newIp);
            localStorage.setItem('zebra_manual_ip', newIp);
        }
        if (newRelay !== undefined) {
            setRelayIp(newRelay);
            localStorage.setItem('zebra_relay_ip', newRelay);
        }
    };

    const setForceDirectIp = (ip) => {
        setForceIpState(ip);
        if (ip) {
            localStorage.setItem('zebra_force_ip', ip);
            setZebraStatus('connected');
            setZebraIp(ip);
        } else {
            localStorage.removeItem('zebra_force_ip');
            setZebraStatus('checking');
            setZebraIp('');
        }
    };

    return (
        <ZebraContext.Provider value={{ 
            zebraStatus, isRechecking, zebraIp, printZPL, lastError, recheckNow: () => checkStatus(true),
            configIp, relayIp, updateConfig, forceIp, setForceDirectIp
        }}>
            {children}
        </ZebraContext.Provider>
    );
};

export const useZebra = () => {
    const ctx = useContext(ZebraContext);
    if (!ctx) throw new Error('useZebra must be used inside <ZebraProvider>');
    return ctx;
};
