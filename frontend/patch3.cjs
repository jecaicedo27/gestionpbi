const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// 1. Hook for focus
const effectTarget = "    useEffect(() => { fetchSessions(); }, [fetchSessions]);";
const effectRepl = `    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    useGlobalScanner((txt) => {
        if (activeSession && activeSession.status === 'IN_PROGRESS') {
            if (scannerInputRef.current && document.activeElement !== scannerInputRef.current && document.activeElement?.dataset?.scannerIgnore !== 'true') {
                scannerInputRef.current.focus();
            }
        }
    });

    const playSuccess = useCallback(() => {
        try { new Audio('/sounds/scan-success.mp3').play(); } catch (e) {}
    }, []);
    const playError = useCallback(() => {
        try { new Audio('/sounds/error.mp3').play(); } catch (e) {}
    }, []);`;

code = code.replace(effectTarget, effectRepl);

// 2. Fetch pickedSummary
const openSessionTarget = `            const [{ data: sess }, matRes, finRes] = await Promise.all([
                api.get(\`/inventory-count/sessions/\${session.id}\`),
                api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK'),
                api.get('/finished-lots/all-active')
            ]);`;

const openSessionRepl = `            const [{ data: sess }, matRes, finRes, pickedRes] = await Promise.all([
                api.get(\`/inventory-count/sessions/\${session.id}\`),
                api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK'),
                api.get('/finished-lots/all-active'),
                api.get('/inventory-count/picked-summary')
            ]);
            setPickedSummary(pickedRes.data.data || {});`;

code = code.replace(openSessionTarget, openSessionRepl);

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
