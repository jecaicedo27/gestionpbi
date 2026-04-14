import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import { Calendar, Save, Trash2, Search, ArrowRight, Eye, Play, Plus, X, PackageSearch, PenTool } from 'lucide-react';
import { parseScanInput } from '../services/scannerParser';
import { playSuccess, playError } from '../services/scannerSounds';
import { useGlobalScanner } from '../hooks/useGlobalScanner';

// ─── 5 bodegas fijas ─────────────────────────────────────────────────────────
const WAREHOUSES = [
    { id: 'Bodega Principal', label: 'Bodega Principal', icon: '🏭', desc: 'Materia prima seca y empaque', zone: 'WAREHOUSE' },
    { id: 'Zona Producción', label: 'Zona Producción', icon: '⚙️', desc: 'Lotes en proceso y activos', zone: 'PRODUCTION' },
    { id: 'Producto Terminado', label: 'Producto Terminado', icon: '📦', desc: 'Stock de producto terminado', zone: 'FINISHED' },
    { id: 'Maquilas', label: 'Maquilas', icon: '🔧', desc: 'Producto en maquila externa', zone: 'MAQUILA' },
    { id: 'No Conformes', label: 'No Conformes', icon: '⚠️', desc: 'Producto no conforme / outlet', zone: 'NO_CONFORME' },
];

const MONTH_OPTIONS = (() => {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long' });
        opts.push({ val, label });
    }
    return opts;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtGrams = (qty, unitName = 'g') => {
    if (qty == null || qty === '') return '—';
    const n = Number(qty);
    if (isNaN(n)) return '—';
    const strVal = new Intl.NumberFormat('es-CO').format(Math.round(n));
    let u = (unitName || 'g').toLowerCase();
    if (u === 'unidad' || u === 'unidades') u = 'uds';
    else if (u === 'gramo' || u === 'gramos') u = 'g';
    else if (u === 'mililitro' || u === 'mililitros') u = 'ml';
    return `${strVal} ${u}`;
};

const extractSiigoTotal = (lot) => {
    // product.currentStock = stock total sincronizado desde Siigo (en gramos para MP)
    if (lot.product?.currentStock != null) return lot.product.currentStock;
    // Fallback: sumar warehouses JSON
    if (!lot.product?.warehouses) return null;
    try {
        const arr = typeof lot.product.warehouses === 'string'
            ? JSON.parse(lot.product.warehouses)
            : lot.product.warehouses;
        if (!Array.isArray(arr)) return null;
        return arr.reduce((s, w) => s + (w.quantity || 0), 0);
    } catch { return null; }
};

const diffBadge = (diff, unitName) => {
    if (diff == null) return null;
    const abs = Math.abs(diff);
    let u = (unitName || 'g').toLowerCase();
    let isOk = (u === 'unidad' || u === 'unidades' || u === 'uds') ? (abs === 0) : (abs < 100);
    if (isOk) return { bg: '#f0fdf4', color: '#15803d', text: '≈ OK' };
    if (diff < 0) return { bg: '#fef2f2', color: '#dc2626', text: `−${fmtGrams(abs, unitName)}` };
    return { bg: '#fffbeb', color: '#d97706', text: `+${fmtGrams(abs, unitName)}` };
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InventoryCountPage() {
    const [view, setView] = useState('list');
    const [sessions, setSessions] = useState([]);
    const [activeSession, setActiveSession] = useState(null);
    const [loadingSessions, setLoadingSessions] = useState(false);

    const [systemLots, setSystemLots] = useState([]);
    const [loadingLots, setLoadingLots] = useState(false);
    const [countLines, setCountLines] = useState([]);

    const [showNewForm, setShowNewForm] = useState(false);
    const [newForm, setNewForm] = useState({ month: MONTH_OPTIONS[0].val, warehouseName: WAREHOUSES[0].id });
    const [creating, setCreating] = useState(false);

    const [systemProducts, setSystemProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [filterUncounted, setFilterUncounted] = useState(false);
    const [savingMap, setSavingMap] = useState({});
    const [inputMap, setInputMap] = useState({});
    const [pickedSummary, setPickedSummary] = useState({});
    const scannerInputRef = useRef(null);
    const [lastScan, setLastScan] = useState(null);
    const scanHandlerRef = useRef(null);

    // ── Global Scanner Hook: intercept fast keystrokes so they don't leak into visible inputs ──
    // Use a ref so the hook gets a stable callback that always points to the latest handler
    useGlobalScanner({
        onScan: useCallback((rawValue) => {
            if (scanHandlerRef.current) scanHandlerRef.current(rawValue);
        }, []),
        enabled: view === 'session' && activeSession?.status === 'IN_PROGRESS',
    });

    // ── Auto-focus scanner input ──────────────────────────────────────────────
    useEffect(() => {
        if (view !== 'session' || activeSession?.status !== 'IN_PROGRESS') return;
        const focusScanner = () => {
            if (scannerInputRef.current && document.activeElement !== scannerInputRef.current && document.activeElement?.dataset?.scannerIgnore !== 'true') {
                scannerInputRef.current.focus({ preventScroll: true });
            }
        };
        focusScanner();
        const interval = setInterval(focusScanner, 2000);
        return () => clearInterval(interval);
    }, [view, activeSession]);

    // ── Load sessions ─────────────────────────────────────────────────────────
    const fetchSessions = useCallback(async () => {
        setLoadingSessions(true);
        try { const { data } = await api.get('/inventory-count/sessions'); setSessions(data); }
        catch (e) { console.error(e); }
        setLoadingSessions(false);
    }, []);
    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    // ── Open session ────────────────────────────────────────────────────
    const openSession = useCallback(async (session) => {
        setLoadingLots(true);
        try {
            // Cargamos TODOS los lotes de todas las zonas en paralelo
            const [{ data: sess }, matRes, finRes, pickRes, prodRes] = await Promise.all([
                api.get(`/inventory-count/sessions/${session.id}`),
                api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK'),
                api.get('/finished-lots/all-active'),
                api.get('/inventory/picked-summary').catch(() => ({ data: { data: {} } })),
                api.get('/inventory/products').catch(() => ({ data: [] }))
            ]);
            setActiveSession(sess);
            if (pickRes?.data?.data) setPickedSummary(pickRes.data.data);
            if (prodRes?.data) setSystemProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
            const matLots = Array.isArray(matRes.data) ? matRes.data : [];
            const finLots = Array.isArray(finRes.data) ? finRes.data : [];
            // Merge: mat lots already have zone WAREHOUSE/PRODUCTION; finished have zone from FinishedLotStock
            setSystemLots([...matLots, ...finLots]);
            const lines = sess.lines || [];
            setCountLines(lines);
            const im = {};
            lines.forEach(ln => {
                let key = ln.lotId;
                if (!key) {
                    if (ln.lotNumber === 'S/L') {
                        key = `nolot-${ln.productId}`;
                    } else {
                        // For finished lots, match by finding the UUID in finLots
                        const match = finLots.find(f => f.productId === ln.productId && f.lotNumber === ln.lotNumber);
                        key = match ? match.id : `pseudo-${ln.id}`;
                    }
                }
                im[key] = { physicalGrams: ln.physicalQty, notes: ln.notes || '', lineId: ln.id };
            });
            setInputMap(im);
            setSearch('');
            setFilterUncounted(false);
            setView('session');
        } catch (e) { console.error(e); }
        setLoadingLots(false);
    }, []);

    // ── Create session ────────────────────────────────────────────────────────
    const createSession = async () => {
        setCreating(true);
        try {
            const wh = WAREHOUSES.find(w => w.id === newForm.warehouseName);
            const isFin = ['FINISHED', 'MAQUILA', 'NO_CONFORME'].includes(wh?.zone);

            const { data: sess } = await api.post('/inventory-count/sessions', {
                month: newForm.month,
                warehouseName: newForm.warehouseName,
                type: isFin ? 'TERMINADO' : 'MATERIA_PRIMA'
            });
            setShowNewForm(false);
            await fetchSessions();
            openSession(sess);
        } catch (e) { alert('Error: ' + (e.response?.data?.error || e.message)); }
        setCreating(false);
    };

    // ── Close session ─────────────────────────────────────────────────────────
    const closeSessionFn = async () => {
        if (!confirm('¿Cerrar esta sesión? Ya no se podrán editar las cantidades.')) return;
        try { await api.put(`/inventory-count/sessions/${activeSession.id}/close`); openSession(activeSession); }
        catch (e) { alert(e.message); }
    };

    const downloadExcel = async () => {
        try {
            const res = await api.get(`/inventory-count/sessions/${activeSession.id}/export`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `conteo-siigo-${activeSession.sessionCode}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (err) {
            alert('Error al descargar el Excel consolidado. ' + (err.response?.data?.error || err.message));
        }
    };

    const downloadMonthExcel = async (m) => {
        try {
            const res = await api.get(`/inventory-count/export/month/${m}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `conteo-siigo-global-${m}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (err) {
            alert('Error al descargar el Excel. ' + (err.response?.data?.error || err.message));
        }
    };

    // ── Save a single lot count ───────────────────────────────────────────────
    const saveLotCount = useCallback(async (item, isProductOnly = false, overrideQty = null) => {
        const key = isProductOnly ? `nolot-${item.productId}` : item.id;
        const inp = inputMap[key] || {};
        const physicalGrams = overrideQty !== null ? overrideQty : parseFloat(inp.physicalGrams);
        if (isNaN(physicalGrams) || physicalGrams === '' || physicalGrams == null) return;
        setSavingMap(m => ({ ...m, [key]: true }));
        try {
            let payload;
            if (isProductOnly) {
                payload = {
                    lineId: inp.lineId || null,
                    productId: item.productId || null,
                    productName: item.productName || 'Sin nombre',
                    siigoProductCode: item.productCode || null,
                    lotId: null,
                    lotNumber: 'S/L',
                    physicalQty: Math.round(physicalGrams),
                    unit: item.unit || 'gramo',
                    notes: inp.notes || null
                };
            } else {
                payload = {
                    lineId: inp.lineId || null,
                    productId: item.productId || null,
                    productName: item.siigoProductName || item.product?.name || 'Sin nombre',
                    siigoProductCode: item.siigoProductCode || null,
                    lotId: (item._source === 'FINISHED_LOT' || String(item.id).startsWith('pseudo-')) ? null : item.id,
                    lotNumber: item.lotNumber,
                    physicalQty: Math.round(physicalGrams),
                    unit: item.unit || item.product?.unit || 'gramo',
                    notes: inp.notes || null
                };
            }
            const { data: savedLine } = await api.post(`/inventory-count/sessions/${activeSession.id}/lines`, payload);
            setInputMap(m => ({ ...m, [key]: { ...m[key], lineId: savedLine.id } }));
            setCountLines(prev => {
                const searchKey = isProductOnly 
                    ? (l => l.productId === item.productId && !l.lotId && l.lotNumber === 'S/L') 
                    : (l => {
                        // Match by lineId first (most reliable)
                        if (inp.lineId && l.id === inp.lineId) return true;
                        // Match by lotId for raw materials
                        if (l.lotId && l.lotId === item.id) return true;
                        // Match by productId + lotNumber for finished lots (lotId is null)
                        if (item._source === 'FINISHED_LOT' && l.productId === item.productId && l.lotNumber === item.lotNumber) return true;
                        return false;
                    });
                const idx = prev.findIndex(searchKey);
                if (idx >= 0) { const c = [...prev]; c[idx] = savedLine; return c; }
                return [...prev, savedLine];
            });
        } catch (e) { alert('Error al guardar: ' + (e.response?.data?.error || e.message)); }
        setSavingMap(m => ({ ...m, [key]: false }));
    }, [inputMap, activeSession]);



    // Zona activa de la sesión: determina qué lotes son editables vs referencia
    const activeZone = useMemo(() => {
        if (!activeSession) return null;
        return WAREHOUSES.find(w => w.id === activeSession.warehouseName)?.zone || 'WAREHOUSE';
    }, [activeSession]);

    // Etiquetas legibles por zona
    const ZONE_LABELS = { WAREHOUSE: 'Bodega Ppal.', PRODUCTION: 'En Producción', PRODUCCION: 'En Producción', PRODUCTO_TERMINADO: 'Prod. Terminado', FINISHED: 'Prod. Terminado', MAQUILA: 'Maquila', NO_CONFORME: 'No Conforme' };
    const ZONE_COLORS = { WAREHOUSE: 'bg-blue-50 text-blue-600 border-blue-200', PRODUCTION: 'bg-orange-50 text-orange-600 border-orange-200', PRODUCCION: 'bg-orange-50 text-orange-600 border-orange-200', PRODUCTO_TERMINADO: 'bg-purple-50 text-purple-600 border-purple-200', FINISHED: 'bg-purple-50 text-purple-600 border-purple-200', MAQUILA: 'bg-teal-50 text-teal-600 border-teal-200', NO_CONFORME: 'bg-red-50 text-red-600 border-red-200' };

    // Nombres legibles para los grupos de cuenta Siigo
    const ACCOUNT_GROUP_NAMES = {
        1400: '🧪 MATERIA PRIMA FABRICACION 19%',
        1401: '💻 GRUPO LIQUIPOPS',
        1402: '💻 GRUPO GENIALITY',
        1403: '🧪 MATERIA PRIMA FABRICACION 5%',
        1404: '🔄 PRODUCTOS EN PROCESO LIQUIPOPS',
        1405: '🔄 PRODUCTOS EN PROCESO GENIALITY',
        1406: '🍬 MATERIA PRIMA SABORES',
        1407: '🎨 MATERIA PRIMA COLORES',
        1408: '📦 MATERIAL DE EMPAQUE',
        1409: '🏷️ MATERIA PRIMA ETIQUETAS Y SELLOS',
        11615: '⚙️ MATERIA PRIMA TRANSITORIA',
        477: '📦 PRODUCTOS',
        478: '📦 SERVICIOS'
    };

    // ── Flat lot rows: activos ───────────────────────────────────────────────
    // Zonas de producto terminado: solo muestran FinishedLotStock, no MP
    const FINISHED_ZONES = ['FINISHED', 'MAQUILA', 'NO_CONFORME'];
    const isFinishedSession = FINISHED_ZONES.includes(activeZone);

    const allLotRows = useMemo(() => {
        if (!systemLots.length && !countLines.length) return [];
        let activeLots = systemLots.filter(l => ['AVAILABLE', 'LOW_STOCK', 'LOW'].includes(l.status) && (l.currentQuantity || 0) > 0);
        // En sesiones de PT/Maquila/NC: solo lotes de FinishedLotStock (no MP)
        if (isFinishedSession) {
            activeLots = activeLots.filter(l => {
                if (l._source !== 'FINISHED_LOT') return false;
                const p = l.product || {};
                if (![1401, 1402].includes(p.accountGroup)) return false;
                if (p.classification === 'PRODUCTO_EN_PROCESO' || p.type === 'SEMI_PROCESADO') return false;
                if ((p.group?.name || '').toUpperCase().includes('ETIQUETA')) return false;
                if ((p.name || '').toUpperCase().includes('ETIQUETA') || (p.name || '').toUpperCase().includes('SELLO')) return false;
                return true;
            });
        } else {
            // En sesiones de Bodega/Producción: excluir lotes de Producto Terminado por accountGroup
            const FINISHED_ACCOUNT_GROUPS = [1401, 1402]; // LIQUIPOPS, GENIALITY
            activeLots = activeLots.filter(l => {
                const ag = l.product?.accountGroup;
                return !FINISHED_ACCOUNT_GROUPS.includes(ag);
            });
        }
        const lineByLotId = {};
        countLines.forEach(ln => { 
            if (ln.lotId) {
                lineByLotId[ln.lotId] = ln; 
            } else if (ln.lotNumber && ln.lotNumber !== 'S/L') {
                lineByLotId[`${ln.productId}-${ln.lotNumber}`] = ln;
            }
        });
        const ZONE_MAP = {
            WAREHOUSE: ['WAREHOUSE'],
            PRODUCTION: ['PRODUCTION', 'PRODUCCION'],
            FINISHED: ['PRODUCTO_TERMINADO'],
            MAQUILA: ['MAQUILA'],
            NO_CONFORME: ['NO_CONFORME'],
        };
        const activeZones = ZONE_MAP[activeZone] || [activeZone];
        const mappedReal = activeLots.map(lot => {
            const rawZone = lot.zone || 'WAREHOUSE';
            const isActive = activeZones.includes(rawZone);
            const savedLine = isActive ? (lineByLotId[lot.id] || (lot._source === 'FINISHED_LOT' ? lineByLotId[`${lot.productId}-${lot.lotNumber}`] : null)) : null;
            const isCounted = !!savedLine;
            const physicalGrams = savedLine ? savedLine.physicalQty : null;
            const systemGrams = lot.currentQuantity || 0;
            const diff = physicalGrams != null ? physicalGrams - systemGrams : null;
            return { lot, isActive, isCounted, physicalGrams, systemGrams, diff, zone: rawZone };
        });

        // Pseudo-lots: only countLines that have NO lotId AND are truly "S/L" (not finished lots
        // that were saved with lotId=null but have a real lotNumber matching an activeLot)
        const activeLotKeys = new Set(
            activeLots.map(l => `${l.productId}-${l.lotNumber}`)
        );
        const mappedPseudo = countLines
            .filter(ln => {
                if (ln.lotId) return false; // Has lotId → already in mappedReal
                
                // Do NOT map S/L lines as pseudo-lots because they are handled strictly by the generic S/L cards
                if (!ln.lotNumber || ln.lotNumber === 'S/L') return false;

                // If the line has a real lotNumber (not S/L) AND there's a matching active lot,
                // it's already represented in mappedReal via lineByLotId — skip it to avoid duplication
                if (ln.lotNumber && ln.lotNumber !== 'S/L' && activeLotKeys.has(`${ln.productId}-${ln.lotNumber}`)) {
                    return false;
                }
                return true;
            })
            .map(ln => {
                const prod = systemProducts.find(p => p.id === ln.productId) || {};
                return {
                    lot: {
                        id: `pseudo-${ln.id}`,
                        productId: ln.productId,
                        lotNumber: ln.lotNumber || 'S/L',
                        siigoProductName: ln.productName,
                        siigoProductCode: ln.siigoProductCode,
                        unit: ln.unit || prod.unit || 'gramo',
                        currentQuantity: 0,
                        zone: activeZone, // Se marca en esta zona para que sea editable
                        product: {
                            name: ln.productName,
                            accountGroup: prod.accountGroup || prod.group?.name || 'N/A'
                        }
                    },
                    isActive: true, // Pseudo-lotes introducidos en esta sesión siempre son editables
                    isCounted: true,
                    physicalGrams: ln.physicalQty,
                    systemGrams: 0,
                    diff: ln.physicalQty,
                    zone: activeZone
                };
            });

        return [...mappedReal, ...mappedPseudo];
    }, [systemLots, countLines, activeZone, isFinishedSession, systemProducts]);

    // ── Grouped by AccountGroup → Producto → Lotes ──────────────────────────────
    const accountGroups = useMemo(() => {
        const agMap = {};
        
        // 1. Pre-fill all expected products for this zone so we can see them even if 0 lots are available
        for (const p of systemProducts) {
            // Filter products based on session type constraints
            if (isFinishedSession) {
                // EXCLUSION AGRESIVA ESTRICTA: Solo permitir Liquidpops (1401) y Geniality (1402)
                if (![1401, 1402].includes(p.accountGroup)) continue;
                // Excluir productos en proceso que puedan haberse colado (aunque no deberian si el accountGroup esta bloqueado, pero por seguridad)
                if (p.classification === 'PRODUCTO_EN_PROCESO' || p.type === 'SEMI_PROCESADO') continue;
                if ((p.group?.name || '').toUpperCase().includes('ETIQUETA')) continue;
                if (p.name.toUpperCase().includes('ETIQUETA') || p.name.toUpperCase().includes('SELLO')) continue;
            } else if (activeZone === 'WAREHOUSE') {
                if (p.type !== 'MATERIA_PRIMA' && p.type !== 'EMPAQUE') continue;
            } else if (activeZone === 'PRODUCTION') {
                if (p.type !== 'MATERIA_PRIMA' && p.type !== 'EMPAQUE' && p.type !== 'SEMI_PROCESADO') continue;
            }

            const ag = p.accountGroup ?? p.group?.name ?? 'N/A';
            const agName = ACCOUNT_GROUP_NAMES[ag] || `📄 Grupo ${ag}`;
            if (!agMap[ag]) agMap[ag] = { agId: ag, agName, products: {} };
            
            agMap[ag].products[p.id] = {
                productId: p.id,
                productName: p.name,
                productCode: p.sku || '',
                siigoTotal: p.currentStock || 0,
                unit: p.unit || 'gramo',
                lots: []
            };
        }

        // 2. Map existing active lots
        for (const row of allLotRows) {
            const ag = row.lot.product?.accountGroup ?? row.lot.product?.group?.name ?? 'N/A';
            const agName = ACCOUNT_GROUP_NAMES[ag] || `📄 Grupo ${ag}`;
            if (!agMap[ag]) agMap[ag] = { agId: ag, agName, products: {} };
            const pid = row.lot.productId || row.lot.siigoProductCode || row.lot.siigoProductName || 'unknown';
            if (!agMap[ag].products[pid]) {
                agMap[ag].products[pid] = {
                    productId: pid,
                    productName: row.lot.siigoProductName || row.lot.product?.name || '—',
                    productCode: row.lot.siigoProductCode || '',
                    siigoTotal: extractSiigoTotal(row.lot),
                    unit: row.lot.unit || row.lot.product?.unit || 'gramo',
                    lots: []
                };
            }
            agMap[ag].products[pid].lots.push(row);
        }
        return Object.values(agMap)
            .sort((a, b) => String(a.agId).localeCompare(String(b.agId)))
            .map(ag => ({
                ...ag,
                products: Object.values(ag.products).sort((a, b) => a.productName.localeCompare(b.productName))
            }));
    }, [allLotRows, systemProducts, activeZone, isFinishedSession]);

    // ── Filtered accountGroups ────────────────────────────────────────────────
    const filteredAccountGroups = useMemo(() => {
        return accountGroups
            .map(ag => ({
                ...ag,
                products: ag.products
                    .map(g => {
                        let lots = g.lots;
                        let productMatchesSearch = true;

                        if (search.trim()) {
                            const pText = `${g.productName || ''} ${g.productCode || ''}`.toLowerCase();
                            productMatchesSearch = search.toLowerCase().split(/\\s+/).every(word => {
                                const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*');
                                return new RegExp(pattern).test(pText);
                            });

                            lots = lots.filter(r => {
                                if (productMatchesSearch) return true;
                                const lText = `${r.lot.lotNumber || ''}`.toLowerCase();
                                return search.toLowerCase().split(/\\s+/).every(word => {
                                    const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*');
                                    return new RegExp(pattern).test(lText);
                                });
                            });
                        }

                        if (filterUncounted && lots.length > 0 && !lots.some(r => r.isActive && !r.isCounted)) return null;

                        const initiallyEmpty = g.lots.length === 0;
                        if (lots.length > 0 || (initiallyEmpty && productMatchesSearch)) {
                            return { ...g, lots };
                        }
                        return null;
                    })
                    .filter(Boolean)
            }))
            .filter(ag => ag.products.length > 0);
    }, [accountGroups, search, filterUncounted]);

    // Stats: solo cuentan la zona activa
    const stats = useMemo(() => {
        const activeRows = allLotRows.filter(r => r.isActive);
        const total = activeRows.length;
        const counted = activeRows.filter(r => r.isCounted).length;
        const withDiff = activeRows.filter(r => r.diff != null && Math.abs(r.diff) >= 100).length;
        return { total, counted, withDiff };
    }, [allLotRows]);

    // ── Handle Scanner Input ──────────────────────────────────────────────────
    const handleScannerInput = useCallback(async (rawValue) => {
        if (!rawValue || rawValue.length < 4) return;
        const scan = parseScanInput(rawValue);
        
        let productMatch = systemProducts.find(p => p.sku === scan.sku || p.barcode === scan.barcode || p.sku === scan.barcode);
        if (!productMatch && scan.barcode) {
             productMatch = systemProducts.find(p => p.sku === scan.barcode);
        }

        if (!productMatch) {
            playError();
            setLastScan({ status: 'error', message: `Producto no encontrado (${scan.barcode || scan.sku})` });
            return;
        }

        let targetRow = null;
        let isProductOnly = false;
        let targetItem = null;

        if (scan.lotNumber) {
            // 1. Exact match: productId + lotNumber
            targetRow = allLotRows.find(r => r.isActive && r.lot.productId === productMatch.id && r.lot.lotNumber === scan.lotNumber);
            
            if (!targetRow) {
                // 2. Scanned lot may have a flavor prefix (e.g. "ESCARCHADOR-260409-0428")
                //    but DB stores just "260409-0428" → strip prefix and try suffix match
                const dashIdx = scan.lotNumber.indexOf('-');
                const lotSuffix = dashIdx > 0 ? scan.lotNumber.slice(dashIdx + 1) : null;
                if (lotSuffix) {
                    targetRow = allLotRows.find(r => r.isActive && r.lot.productId === productMatch.id && r.lot.lotNumber === lotSuffix);
                }
            }
            
            if (!targetRow) {
                // 3. DB lot may have the prefix but scanned doesn't → check if DB lot ends with scanned
                targetRow = allLotRows.find(r => r.isActive && r.lot.productId === productMatch.id && r.lot.lotNumber.endsWith(scan.lotNumber));
            }
            
            if (!targetRow && scan.lotNumber) {
                // 4. Cross-product fallback: maybe the lot exists under a different presentation of the same product
                targetRow = allLotRows.find(r => r.isActive && r.lot.lotNumber === scan.lotNumber);
                if (!targetRow) {
                    const dashIdx = scan.lotNumber.indexOf('-');
                    const lotSuffix = dashIdx > 0 ? scan.lotNumber.slice(dashIdx + 1) : null;
                    if (lotSuffix) {
                        targetRow = allLotRows.find(r => r.isActive && r.lot.lotNumber === lotSuffix);
                    }
                }
            }

            if (targetRow) targetItem = targetRow.lot;
        }

        if (!targetItem) {
            const activeLots = allLotRows.filter(r => r.isActive && r.lot.productId === productMatch.id);
            if (activeLots.length === 1 && activeLots[0].lot.lotNumber !== 'S/L') {
                 targetItem = activeLots[0].lot;
            } else {
                 isProductOnly = true;
                 targetItem = {
                     productId: productMatch.id,
                     productName: productMatch.name,
                     productCode: productMatch.sku,
                     unit: productMatch.unit || 'gramo'
                 };
            }
        }

        const key = isProductOnly ? `nolot-${targetItem.productId}` : targetItem.id;
        const qtyToAdd = scan.unitsPerBox || 1;

        setInputMap(m => {
             const startVal = parseFloat(m[key]?.physicalGrams);
             const safeCurrent = isNaN(startVal) ? 0 : startVal;
             const nextQty = safeCurrent + qtyToAdd;
             
             // Queue the save async so it uses the calculated nextQty
             setTimeout(() => saveLotCount(targetItem, isProductOnly, nextQty), 50);

             return { ...m, [key]: { ...m[key], physicalGrams: nextQty } };
        });
        
        // Desplazar la pantalla (scroll) hacia el producto encontrado para que el usuario no tenga que buscarlo
        setTimeout(() => {
            const elements = document.querySelectorAll(`[id="row-${key}"]`);
            for (const el of elements) {
                if (el.offsetParent !== null) { // true if visible
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    break;
                }
            }
        }, 100);

        playSuccess();
        setLastScan({ status: 'success', message: `+${qtyToAdd} ${productMatch.name}` });
    }, [systemProducts, allLotRows, inputMap, saveLotCount]);

    // Keep the ref in sync so useGlobalScanner always calls the latest version
    scanHandlerRef.current = handleScannerInput;

    const isScannerDataLine = (val) => {
        return val.includes('LOT:') || val.includes('SKU:') || val.includes('BAR:')
            || val.startsWith('{')
            || (val.length >= 13 && /^\d+$/.test(val.replace(/[^0-9]/g, ''))); // Only safely assume 13+ digits are barcodes without speed
    };

    const typingTimers = useRef({});

    const handleInputKeyDown = useCallback((e, inputKey, val, onNormalEnter, setterFunc) => {
        if (e.key !== 'Enter') {
            if (!typingTimers.current[inputKey] || Date.now() - typingTimers.current[inputKey].startTime > 800) {
                // Initiates tracking or resets if it's been a long pause (human typing)
                typingTimers.current[inputKey] = {
                    startTime: Date.now(),
                    baseValue: val // the exact state BEFORE this keystroke is appended
                };
            }
            return false;
        }

        // It is an Enter key
        e.preventDefault();
        
        const tracker = typingTimers.current[inputKey];
        delete typingTimers.current[inputKey];
        
        const baseVal = tracker ? tracker.baseValue : '';
        const fullVal = val;
        
        // Extract strictly what the scanner injected
        const injectedPart = fullVal.startsWith(baseVal) ? fullVal.substring(baseVal.length) : fullVal;
        const trimmedInjected = injectedPart.trim() || fullVal.trim();
        
        // Calculate typing speed of the injected part
        const elapsed = tracker ? Date.now() - tracker.startTime : 1000;
        const charsAdded = trimmedInjected.length || 1;
        const timePerChar = elapsed / charsAdded;
        
        // Extremely tight speed threshold for pure numbers, guaranteeing it's a machine
        const isFastScan = charsAdded >= 4 && timePerChar < 30;
        const isScan = isScannerDataLine(trimmedInjected) || isFastScan;

        if (isScan) {
            // Restore visual input to the user's base value (removing the barcode visually)
            if (setterFunc) setterFunc(baseVal);
            
            // Pass the pure barcode to the backend
            if (scanHandlerRef.current) scanHandlerRef.current(trimmedInjected);
            
            // Re-arm focus
            if (scannerInputRef.current) scannerInputRef.current.focus({ preventScroll: true });
            return true;
        } else {
            if (onNormalEnter) onNormalEnter();
            return false;
        }
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 bg-neutral-50 min-h-screen">

            {/* HEADER */}
            <div className="flex items-start gap-3 mb-6 flex-wrap">
                {view === 'session' && (
                    <button onClick={() => { setView('list'); setActiveSession(null); setSystemLots([]); setCountLines([]); setInputMap({}); }}
                        className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 border border-neutral-200 bg-white rounded-lg px-3 py-2 transition-colors">
                        ← Volver
                    </button>
                )}
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-neutral-800">
                        📦 Inventario Físico Mensual
                        {activeSession && (
                            <span className="text-sm font-normal text-neutral-500 ml-2">
                                {activeSession.warehouseName} — {activeSession.month}
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        Todos los lotes se pre-cargan desde el sistema. El operario solo llena la columna "Físico".
                    </p>
                </div>
                <div className="flex gap-2">
                    {view === 'list' && (
                        <>
                            {sessions.length > 0 && (
                                <button onClick={() => downloadMonthExcel(sessions[0].month)}
                                    className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                                    ⬇️ Exportar Total Mes ({sessions[0].month})
                                </button>
                            )}
                            <button onClick={() => setShowNewForm(true)}
                                className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                                + Nueva sesión
                            </button>
                        </>
                    )}
                    {view === 'session' && activeSession?.status === 'IN_PROGRESS' && (
                        <button onClick={closeSessionFn}
                            className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                            🔒 Cerrar sesión
                        </button>
                    )}
                </div>
            </div>

            {/* ── MODAL: Nueva sesión ─────────────────────────────────────────── */}
            {showNewForm && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-md">
                        <h3 className="text-base font-bold text-neutral-800 mb-4">Nueva sesión de inventario</h3>
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mb-1.5">Mes</label>
                        <select value={newForm.month} onChange={e => setNewForm(f => ({ ...f, month: e.target.value }))}
                            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-700 mb-4 focus:outline-none focus:ring-2 focus:ring-primary-300">
                            {MONTH_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                        </select>
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mb-2">Bodega</label>
                        <div className="space-y-2 mb-5">
                            {WAREHOUSES.map(w => (
                                <label key={w.id} onClick={() => setNewForm(f => ({ ...f, warehouseName: w.id }))}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${newForm.warehouseName === w.id ? 'border-primary-400 bg-primary-50' : 'border-neutral-200 hover:border-neutral-300 bg-white'}`}>
                                    <span className="text-2xl">{w.icon}</span>
                                    <div>
                                        <div className="font-semibold text-sm text-neutral-800">{w.label}</div>
                                        <div className="text-xs text-neutral-500">{w.desc}</div>
                                    </div>
                                    <input type="radio" className="ml-auto" checked={newForm.warehouseName === w.id} readOnly />
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-3">
                            <button onClick={createSession} disabled={creating}
                                className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
                                {creating ? 'Iniciando...' : 'Iniciar conteo'}
                            </button>
                            <button onClick={() => setShowNewForm(false)}
                                className="px-4 py-2.5 border border-neutral-200 text-neutral-600 text-sm rounded-lg hover:bg-neutral-50 transition-colors">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── VIEW: Lista de sesiones ─────────────────────────────────────── */}
            {view === 'list' && (
                <div className="space-y-3">
                    {loadingSessions ? (
                        <p className="text-neutral-400 text-sm text-center py-10">Cargando sesiones...</p>
                    ) : sessions.length === 0 ? (
                        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center">
                            <div className="text-5xl mb-3">📋</div>
                            <p className="text-neutral-500 mb-4">No hay sesiones de inventario aún.</p>
                            <button onClick={() => setShowNewForm(true)}
                                className="bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors">
                                Iniciar primer inventario
                            </button>
                        </div>
                    ) : sessions.map(s => (
                        <div key={s.id} className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center gap-4 flex-wrap shadow-sm hover:shadow-md transition-shadow">
                            <span className="text-3xl">{WAREHOUSES.find(w => w.id === s.warehouseName)?.icon || '📦'}</span>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-neutral-800">{s.warehouseName}</div>
                                <div className="text-xs text-neutral-500 mt-0.5">
                                    {s.month} · <code className="text-primary-600">{s.sessionCode}</code>
                                    {s.createdBy?.name && ` · ${s.createdBy.name}`}
                                </div>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.status === 'CLOSED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {s.status === 'CLOSED' ? '🔒 Cerrada' : '🟡 En curso'}
                                </span>
                                <span className="text-sm text-neutral-500">{s._count?.lines || 0} lotes contados</span>
                                <button onClick={() => openSession(s)}
                                    className="bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-semibold px-3 py-1.5 rounded-lg border border-primary-200 transition-colors">
                                    {s.status === 'CLOSED' ? 'Ver resultados' : 'Continuar →'}
                                </button>
                                {s.status === 'IN_PROGRESS' && (
                                    <button onClick={async () => {
                                        if (!confirm('¿Eliminar sesión?')) return;
                                        await api.delete(`/inventory-count/sessions/${s.id}`);
                                        fetchSessions();
                                    }} className="text-red-400 hover:text-red-600 text-sm border border-red-100 hover:border-red-200 px-2 py-1.5 rounded-lg transition-colors">
                                        🗑
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {/* ── VIEW: Sesión activa ─────────────────────────────────────────── */}
            {view === 'session' && activeSession && (
                <div className="space-y-4">
                    {activeSession.status === 'IN_PROGRESS' && (
                        <input
                            ref={scannerInputRef}
                            type="text"
                            className="fixed -top-full -left-full opacity-0 outline-none w-0 h-0"
                            tabIndex={-1}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const rawValue = e.target.value.trim();
                                    e.target.value = '';
                                    if (rawValue) {
                                        handleScannerInput(rawValue);
                                    }
                                }
                            }}
                        />
                    )}

                    {lastScan && (
                        <div className={`p-4 rounded-xl border flex items-center gap-4 shadow-sm transition-all ${
                            lastScan.status === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                            'bg-green-50 border-green-200 text-green-700'
                        }`}>
                            <span className="text-3xl">{lastScan.status === 'error' ? '❌' : '✅'}</span>
                            <div className="font-bold text-lg">{lastScan.message}</div>
                        </div>
                    )}

                    {/* Progress card */}
                    <div className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
                        <div className="flex gap-8 flex-wrap items-center mb-3">
                            <StatBox label="Total en sistema" value={stats.total} color="text-neutral-700" />
                            <StatBox label="Contados" value={stats.counted} color="text-green-600" />
                            <StatBox label="Pendientes" value={stats.total - stats.counted} color="text-amber-600" />
                            <StatBox label="Con descuadre" value={stats.withDiff} color="text-red-600" />
                            <div className="ml-auto flex items-center gap-3">
                                <div className="w-40 h-2 bg-neutral-100 rounded-full overflow-hidden">
                                    <div style={{ width: `${stats.total ? (stats.counted / stats.total * 100) : 0}%` }}
                                        className="h-full bg-green-500 rounded-full transition-all duration-500" />
                                </div>
                                <span className="text-sm font-bold text-neutral-700">
                                    {stats.total ? Math.round(stats.counted / stats.total * 100) : 0}%
                                </span>
                            </div>
                        </div>
                        {/* Filters */}
                        <div className="flex gap-3 flex-wrap items-center">
                            <input data-scanner-ignore="true" value={search}
                                onChange={e => setSearch(e.target.value)}
                                onKeyDown={e => handleInputKeyDown(e, 'search-box', e.target.value, null, setSearch)}
                                placeholder="🔍 Buscar producto o número de lote..."
                                className="flex-1 min-w-52 max-w-sm border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
                            <label className="flex items-center gap-2 text-sm text-amber-700 cursor-pointer font-medium select-none">
                                <input type="checkbox" checked={filterUncounted} onChange={e => setFilterUncounted(e.target.checked)}
                                    className="rounded" />
                                Solo pendientes ({stats.total - stats.counted})
                            </label>
                            {activeSession.status === 'CLOSED' && (
                                <span className="text-xs font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full">
                                    🔒 Sesión cerrada — solo lectura
                                </span>
                            )}
                            <button onClick={downloadExcel} className="ml-auto flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg border border-emerald-200 font-bold text-sm transition-colors whitespace-nowrap shadow-sm">
                                ⬇️ Descargar Excel Siigo
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    {loadingLots ? (
                        <div className="bg-white border border-neutral-200 rounded-xl p-12 text-center text-neutral-400 text-sm">
                            Cargando lotes del sistema...
                        </div>
                    ) : filteredAccountGroups.length === 0 ? (
                        <div className="bg-white border border-neutral-200 rounded-xl p-12 text-center text-neutral-400 text-sm">
                            No hay lotes que coincidan.
                        </div>
                    ) : (
                        <div>
                            {/* ══ DESKTOP TABLE (hidden on tablet/mobile) ══════════════════════ */}
                            <div className="hidden lg:block bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-neutral-50 border-b border-neutral-200">
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide w-8"></th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Producto / Lote</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-blue-600 uppercase tracking-wide">💻 ERP (este lote)</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-rose-600 uppercase tracking-wide">📦 Separados</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">📝 Físico (estante)</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Δ vs ERP</th>
                                                {activeSession.status === 'IN_PROGRESS' && <th className="px-4 py-3"></th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredAccountGroups.map((ag) => (
                                                <>
                                                    <tr key={`ag-${ag.agId}`} className="bg-neutral-700 sticky top-0">
                                                        <td colSpan={activeSession.status === 'IN_PROGRESS' ? 7 : 6} className="px-4 py-2">
                                                            <span className="text-white font-bold text-xs uppercase tracking-widest">{ag.agName}</span>
                                                            <span className="ml-3 text-neutral-400 text-xs">
                                                                {ag.products.length} producto{ag.products.length !== 1 ? 's' : ''} ·{' '}
                                                                {ag.products.reduce((s, p) => s + p.lots.filter(l => l.isActive).length, 0)} lotes
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    {ag.products.map((group) => {
                                                        const allActiveCounted = group.lots.filter(r => r.isActive).every(r => r.isCounted);
                                                        const hasActive = group.lots.some(r => r.isActive);
                                                        const isEditable = activeSession.status === 'IN_PROGRESS';
                                                        const colCount = isEditable ? 7 : 6;
                                                        return (
                                                            <>
                                                                <tr key={`header-${group.productId}`} className="bg-indigo-50 border-t-2 border-indigo-100">
                                                                    <td className="px-4 py-2.5">
                                                                        {!hasActive ? null : allActiveCounted
                                                                            ? <span className="text-green-500 text-base">✓</span>
                                                                            : <span className="inline-block w-4 h-4 rounded-full border-2 border-amber-400 bg-amber-50"></span>}
                                                                    </td>
                                                                    <td className="px-4 py-2.5" colSpan={2}>
                                                                        <div className="flex items-center gap-3 flex-wrap">
                                                                            <span className="font-bold text-neutral-800 text-sm">{group.productName}</span>
                                                                            {group.productCode && <code className="text-xs text-neutral-400">{group.productCode}</code>}
                                                                            <span className="text-xs text-neutral-400">·</span>
                                                                            <span className="text-xs text-neutral-500">{group.lots.length} lote{group.lots.length !== 1 ? 's' : ''}</span>
                                                                            {group.siigoTotal != null && (
                                                                                <span className="ml-2 inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-200">
                                                                                    🔵 Total en Siigo: {fmtGrams(group.siigoTotal, group.unit)}
                                                                                </span>
                                                                            )}
                                                                            {pickedSummary[group.productId] && (
                                                                                <span className="ml-2 inline-flex items-center gap-1.5 bg-rose-100 text-rose-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-rose-200 cursor-help"
                                                                                    title={
                                                                                        typeof pickedSummary[group.productId] === 'object' && pickedSummary[group.productId].orders?.length > 0
                                                                                            ? `Separados para:\n${pickedSummary[group.productId].orders.map(o => `• ${o.distributorName} (P-${o.orderNumber}): ${o.quantity} uds`).join('\n')}`
                                                                                            : "Unidades físicamente separadas en piso pero que aún no han sido descontadas por Siigo"
                                                                                    }>
                                                                                    📦 Separados (Sin facturar): {fmtGrams(typeof pickedSummary[group.productId] === 'object' ? pickedSummary[group.productId].total : pickedSummary[group.productId], group.unit)}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td colSpan={colCount - 2}></td>
                                                                </tr>
                                                                {group.lots.map(({ lot, isActive, isCounted, physicalGrams, systemGrams, diff, zone }) => {
                                                                    const key = lot.id;
                                                                    const localInput = inputMap[key] || { physicalGrams: '', notes: '' };
                                                                    const saving = !!savingMap[key];
                                                                    const lotUnit = lot.unit || lot.product?.unit || group.unit || 'g';
                                                                    const pickedInLot = pickedSummary[group.productId]?.lots?.[lot.lotNumber]?.total || 0;
                                                                    
                                                                    // Update dynamic diff to include separated physical stock if counted
                                                                    let dynamicDiff = null;
                                                                    if (localInput.physicalGrams !== '' && localInput.physicalGrams != null && !isNaN(parseFloat(localInput.physicalGrams))) {
                                                                        dynamicDiff = (parseFloat(localInput.physicalGrams) + pickedInLot) - systemGrams;
                                                                    } else if (isCounted && physicalGrams != null) {
                                                                        dynamicDiff = (physicalGrams + pickedInLot) - systemGrams;
                                                                    }
                                                                    const badge = diffBadge(dynamicDiff, lotUnit);
                                                                    
                                                                    const canEdit = isEditable && isActive;
                                                                    const zoneLabel = ZONE_LABELS[zone] || zone;
                                                                    const zoneColor = ZONE_COLORS[zone] || 'bg-neutral-100 text-neutral-500 border-neutral-200';

                                                                    if (!isActive) return (
                                                                        <tr key={lot.id} className="border-t border-neutral-100 bg-neutral-50/70 opacity-70">
                                                                            <td className="px-4 py-2 pl-8"><span className="text-neutral-300 text-xs">—</span></td>
                                                                            <td className="px-4 py-2">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-neutral-300 text-xs">└</span>
                                                                                    <code className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded font-mono">{lot.lotNumber}</code>
                                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${zoneColor}`}>{zoneLabel}</span>
                                                                                    <span className="text-xs text-neutral-400 italic">referencia</span>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-2 text-neutral-500 text-sm">{fmtGrams(systemGrams, lotUnit)}</td>
                                                                            <td className="px-4 py-2 text-neutral-400 text-xs" colSpan={colCount - 3}>No editable en esta sesión</td>
                                                                        </tr>
                                                                    );

                                                                    return (
                                                                        <tr id={`row-${key}`} key={lot.id} className={`border-t border-neutral-100 transition-colors ${isCounted ? 'bg-green-50/30' : 'bg-white hover:bg-neutral-50'}`}>
                                                                            <td className="px-4 py-2.5 pl-8">
                                                                                {isCounted ? <span className="text-green-500">✓</span> : <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-300"></span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                                        <span className="text-neutral-400 text-xs">└</span>
                                                                                        <code className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{lot.lotNumber}</code>
                                                                                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${zoneColor}`}>{zoneLabel}</span>
                                                                                    </div>
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-blue-700 font-semibold text-sm">{fmtGrams(systemGrams, lotUnit)}</td>
                                                                            <td className="px-4 py-2.5">
                                                                                {pickedInLot > 0 ? (
                                                                                    <div className="group relative w-fit">
                                                                                        <span className="font-bold text-rose-600 text-sm cursor-help underline decoration-dotted decoration-rose-300">
                                                                                            {fmtGrams(pickedInLot, lotUnit)}
                                                                                        </span>
                                                                                        <div className="absolute z-50 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all bg-neutral-900 text-white text-xs rounded-lg p-2.5 shadow-xl w-64 mt-1 border border-neutral-700">
                                                                                            <div className="font-bold text-rose-300 mb-1">Pedidos asignados este lote:</div>
                                                                                            {pickedSummary[group.productId].lots[lot.lotNumber].orders.map((o, idx) => (
                                                                                                <div key={idx} className="mb-0.5">
                                                                                                    <span className="text-neutral-400">P-{o.orderNumber}</span> <strong>{o.distributorName}</strong>
                                                                                                    <div className="text-white text-right font-mono text-[10px] opacity-80">{o.quantity} uds</div>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                ) : <span className="text-neutral-300 text-sm">—</span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                {canEdit ? (
                                                                                    <input type="text" inputMode="numeric" data-scanner-ignore="true"
                                                                                        value={localInput.physicalGrams}
                                                                                        onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: e.target.value } }))}
                                                                                        onKeyDown={e => handleInputKeyDown(e, key, e.target.value, () => saveLotCount(lot), (revertedValue) => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: revertedValue } })))}
                                                                                        placeholder="0"
                                                                                        className="w-28 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-green-400 font-mono" />
                                                                                ) : (
                                                                                    <span className="text-green-700 font-semibold text-sm">{isCounted ? fmtGrams(parseFloat(localInput.physicalGrams) || 0, lotUnit) : '—'}</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                {badge && <span className="text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                {canEdit ? (
                                                                                    <input type="text" data-scanner-ignore="true" value={localInput.notes}
                                                                                        onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], notes: e.target.value } }))}
                                                                                        placeholder="Opcional"
                                                                                        className="w-full min-w-[70px] border border-neutral-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                                                                                ) : <span className="text-neutral-400 text-xs">{localInput.notes || ''}</span>}
                                                                            </td>
                                                                            {isEditable && (
                                                                                <td className="px-4 py-2.5">
                                                                                    <button onClick={() => saveLotCount(lot)}
                                                                                        disabled={saving || localInput.physicalGrams === ''}
                                                                                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${isCounted ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600' : 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200'} disabled:opacity-40`}>
                                                                {saving ? '...' : isCounted ? '↻ Guardar' : '✓ Guardar'}
                                                                                    </button>
                                                                                </td>
                                                                            )}
                                                                        </tr>
                                                                    );
                                                                })}
                                                                {(group.lots.filter(r => r.isActive).length === 0 || pickedSummary[group.productId]?.lots?.['S/L']?.total > 0 || inputMap[`nolot-${group.productId}`]?.lineId) && (() => {
                                                                    const keySL = `nolot-${group.productId}`;
                                                                    const unassignedPicked = pickedSummary[group.productId]?.lots?.['S/L']?.total || 0;
                                                                    const localInputSL = inputMap[keySL] || { physicalGrams: '' };
                                                                    let slDiff = null;
                                                                    if (localInputSL.physicalGrams !== '' && localInputSL.physicalGrams != null) {
                                                                        slDiff = (parseFloat(localInputSL.physicalGrams) + unassignedPicked) - 0;
                                                                    }
                                                                    const slBadge = diffBadge(slDiff, group.unit || 'g');
                                                                    return (
                                                                    <tr id={`row-${keySL}`} className="border-t border-amber-100 bg-amber-50/20">
                                                                        <td className="px-4 py-2 pl-8">
                                                                            <span className="text-amber-500 text-xs font-bold">↳</span>
                                                                        </td>
                                                                        <td className="px-4 py-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <code className="text-xs bg-neutral-100 text-neutral-600 border border-neutral-200 px-2 py-0.5 rounded font-mono border-dashed">S/L</code>
                                                                                <span className="text-xs text-neutral-500 font-medium italic">Sin Lote Asignado</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2 font-mono text-neutral-400 text-sm">0</td>
                                                                        <td className="px-4 py-2">
                                                                            {unassignedPicked > 0 ? (
                                                                                <div className="group relative w-fit">
                                                                                    <span className="font-bold text-rose-600 text-sm cursor-help underline decoration-dotted decoration-rose-300">
                                                                                        {fmtGrams(unassignedPicked, group.unit)}
                                                                                    </span>
                                                                                    <div className="absolute z-50 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all bg-neutral-900 text-white text-xs rounded-lg p-2.5 shadow-xl w-64 mt-1 border border-neutral-700">
                                                                                        <div className="font-bold text-rose-300 mb-1">Pedidos separados (S/L):</div>
                                                                                        {pickedSummary[group.productId].lots['S/L'].orders.map((o, idx) => (
                                                                                            <div key={idx} className="mb-0.5">
                                                                                                <span className="text-neutral-400">P-{o.orderNumber}</span> <strong>{o.distributorName}</strong>
                                                                                                <div className="text-white text-right font-mono text-[10px] opacity-80">{o.quantity} uds</div>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            ) : <span className="text-neutral-300 text-sm">—</span>}
                                                                        </td>
                                                                        <td className="px-4 py-2">
                                                                            <div className="flex items-center gap-1">
                                                                                <input
                                                                                    type="text"
                                                                                    inputMode="numeric"
                                                                                    data-scanner-ignore="true"
                                                                                    placeholder="0"
                                                                                    className="w-24 px-2 py-1.5 text-sm border border-neutral-300 rounded focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-colors bg-white font-mono text-right"
                                                                                    value={localInputSL.physicalGrams}
                                                                                    onChange={e => setInputMap(m => ({ ...m, [keySL]: { ...m[keySL], physicalGrams: e.target.value } }))}
                                                                                    onKeyDown={e => handleInputKeyDown(e, keySL, e.target.value, () => saveLotCount(group, true), (revertedValue) => setInputMap(m => ({ ...m, [keySL]: { ...m[keySL], physicalGrams: revertedValue } })))}
                                                                                    disabled={!isEditable || !!savingMap[keySL]}
                                                                                />
                                                                                {savingMap[keySL] && <div className="ml-1 w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2">
                                                                             {slBadge && <span className="text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: slBadge.bg, color: slBadge.color }}>{slBadge.text}</span>}
                                                                        </td>
                                                                        <td className="px-4 py-2"></td>
                                                                        {isEditable && (
                                                                            <td className="px-4 py-2">
                                                                                <button
                                                                                    onClick={() => saveLotCount(group, true)}
                                                                                    disabled={savingMap[keySL]}
                                                                                    className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                                                                                    Guardar
                                                                                </button>
                                                                            </td>
                                                                        )}
                                                                    </tr>
                                                                )})()}
                                                            </>
                                                        );
                                                    })}
                                                </>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ══ TABLET / MOBILE CARDS (visible < lg) ═════════════════════════ */}
                            <div className="lg:hidden space-y-3">
                                {filteredAccountGroups.map((ag) => (
                                    <div key={`m-ag-${ag.agId}`}>
                                        {/* Account Group Header */}
                                        <div className="bg-neutral-700 rounded-lg px-4 py-2.5 mb-2 sticky top-0 z-10">
                                            <span className="text-white font-bold text-xs uppercase tracking-widest">{ag.agName}</span>
                                            <span className="ml-2 text-neutral-400 text-xs">
                                                {ag.products.reduce((s, p) => s + p.lots.filter(l => l.isActive).length, 0)} lotes
                                            </span>
                                        </div>
                                        {ag.products.map((group) => {
                                            const allActiveCounted = group.lots.filter(r => r.isActive).every(r => r.isCounted);
                                            const hasActive = group.lots.some(r => r.isActive);
                                            const isEditable = activeSession.status === 'IN_PROGRESS';
                                            return (
                                                <div key={`m-prod-${group.productId}`} className="mb-3">
                                                    {/* Product Header Card */}
                                                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 mb-1.5">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            {!hasActive ? null : allActiveCounted
                                                                ? <span className="text-green-500 text-lg">✓</span>
                                                                : <span className="inline-block w-5 h-5 rounded-full border-2 border-amber-400 bg-amber-50"></span>}
                                                            <span className="font-bold text-neutral-800">{group.productName}</span>
                                                            {group.productCode && <code className="text-xs text-neutral-400">{group.productCode}</code>}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                            <span className="text-xs text-neutral-500">{group.lots.length} lote{group.lots.length !== 1 ? 's' : ''}</span>
                                                            {group.siigoTotal != null && (
                                                                <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-indigo-200">
                                                                    🔵 Siigo: {fmtGrams(group.siigoTotal, group.unit)}
                                                                </span>
                                                            )}
                                                            {pickedSummary[group.productId] && (
                                                                <span className="inline-flex items-center gap-1.5 bg-rose-100 text-rose-700 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-200"
                                                                    onClick={() => alert(`Separados para:\n${(pickedSummary[group.productId].orders || []).map(o => `• ${o.distributorName} (P-${o.orderNumber}): ${o.quantity} uds`).join('\n')}`)}>
                                                                    📦 Sep: {fmtGrams(typeof pickedSummary[group.productId] === 'object' ? pickedSummary[group.productId].total : pickedSummary[group.productId], group.unit)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Lot Cards */}
                                                    {group.lots.map(({ lot, isActive, isCounted, systemGrams, diff, zone }) => {
                                                        const key = lot.id;
                                                        const localInput = inputMap[key] || { physicalGrams: '', notes: '' };
                                                        const saving = !!savingMap[key];
                                                        const lotUnit = lot.unit || lot.product?.unit || group.unit || 'g';
                                                        const pickedInLot = pickedSummary[group.productId]?.lots?.[lot.lotNumber]?.total || 0;
                                                        
                                                        let dynamicDiff = null;
                                                        if (localInput.physicalGrams !== '' && localInput.physicalGrams != null && !isNaN(parseFloat(localInput.physicalGrams))) {
                                                            dynamicDiff = (parseFloat(localInput.physicalGrams) + pickedInLot) - systemGrams;
                                                        } else if (isCounted && lot.physicalGrams != null) {
                                                            dynamicDiff = (lot.physicalGrams + pickedInLot) - systemGrams;
                                                        }
                                                        const badge = diffBadge(dynamicDiff, lotUnit);
                                                        const canEdit = isEditable && isActive;
                                                        const zoneLabel = ZONE_LABELS[zone] || zone;
                                                        const zoneColor = ZONE_COLORS[zone] || 'bg-neutral-100 text-neutral-500 border-neutral-200';

                                                        if (!isActive) return (
                                                            <div key={lot.id} className="ml-4 border-l-2 border-neutral-200 pl-3 py-2 opacity-60">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <code className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded font-mono">{lot.lotNumber}</code>
                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${zoneColor}`}>{zoneLabel}</span>
                                                                    <span className="text-xs text-neutral-400">— {fmtGrams(systemGrams, lotUnit)}</span>
                                                                    <span className="text-xs text-neutral-400 italic">referencia</span>
                                                                </div>
                                                            </div>
                                                        );

                                                        return (
                                                            <div id={`row-${key}`} key={lot.id} className={`ml-4 border-l-3 pl-3 py-3 rounded-r-lg mb-1 ${isCounted ? 'border-green-400 bg-green-50/40' : 'border-blue-300 bg-white'}`}>
                                                                {/* Lot info row */}
                                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                    {isCounted ? <span className="text-green-500 text-lg">✓</span> : <span className="inline-block w-5 h-5 rounded-full border-2 border-neutral-300 flex-shrink-0"></span>}
                                                                    <code className="text-sm bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono font-semibold">{lot.lotNumber}</code>
                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${zoneColor}`}>{zoneLabel}</span>
                                                                    {badge && <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
                                                                    {pickedSummary[group.productId]?.lots?.[lot.lotNumber] && (
                                                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 cursor-help"
                                                                            title={`Separados en este lote para:\n${pickedSummary[group.productId].lots[lot.lotNumber].orders.map(o => `• ${o.distributorName} (P-${o.orderNumber}): ${o.quantity} uds`).join('\n')}`}>
                                                                            📦 {pickedSummary[group.productId].lots[lot.lotNumber].total} uds sep.
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {/* ERP value */}
                                                                <div className="flex items-center gap-4 mb-2 text-sm">
                                                                    <span className="text-neutral-500">💻 ERP:</span>
                                                                    <span className="text-blue-700 font-bold">{fmtGrams(systemGrams, lotUnit)}</span>
                                                                </div>
                                                                {/* Input row */}
                                                                {canEdit ? (
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <div className="flex-1 min-w-0">
                                                                            <label className="text-xs text-green-700 font-semibold mb-1 block">📦 Físico (gramos / uds)</label>
                                                                            <input type="text" inputMode="numeric" data-scanner-ignore="true"
                                                                                value={localInput.physicalGrams}
                                                                                onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: e.target.value } }))}
                                                                                onKeyDown={e => handleInputKeyDown(e, key, e.target.value, () => saveLotCount(lot), (revertedValue) => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: revertedValue } })))}
                                                                                placeholder="0"
                                                                                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-lg text-right font-semibold focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-green-400" />
                                                                        </div>
                                                                        <button onClick={() => saveLotCount(lot)}
                                                                            disabled={saving || localInput.physicalGrams === ''}
                                                                            className={`mt-5 px-5 py-3 rounded-xl font-bold text-sm transition-colors whitespace-nowrap ${isCounted ? 'bg-neutral-200 text-neutral-800' : 'bg-green-500 text-white shadow-sm'} disabled:opacity-40`}>
                                                                            {saving ? '...' : '✓ Guardar'}
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-green-700 font-semibold">
                                                                        📦 Físico: {isCounted ? fmtGrams(parseFloat(localInput.physicalGrams) || 0, lotUnit) : '—'}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                    
                                                    {/* Unassigned S/L Lot Card (Mobile) */}
                                                    {(group.lots.filter(r => r.isActive).length === 0 || pickedSummary[group.productId]?.lots?.['S/L']?.total > 0 || inputMap[`nolot-${group.productId}`]?.lineId) && (() => {
                                                        const keySL = `nolot-${group.productId}`;
                                                        const unassignedPicked = pickedSummary[group.productId]?.lots?.['S/L']?.total || 0;
                                                        const localInputSL = inputMap[keySL] || { physicalGrams: '' };
                                                        let slDiff = null;
                                                        if (localInputSL.physicalGrams !== '' && localInputSL.physicalGrams != null) {
                                                            slDiff = (parseFloat(localInputSL.physicalGrams) + unassignedPicked) - 0;
                                                        }
                                                        const slBadge = diffBadge(slDiff, group.unit || 'g');
                                                        return (
                                                            <div id={`row-${keySL}`} className="ml-4 border-l-3 border-amber-300 bg-amber-50/30 pl-3 py-3 rounded-r-lg mt-1 mb-1 shadow-sm">
                                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                    <span className="text-amber-500 font-bold">↳</span>
                                                                    <code className="text-sm bg-neutral-100 text-neutral-600 border border-neutral-200 px-2 py-1 rounded font-mono border-dashed font-semibold">S/L</code>
                                                                    <span className="text-xs text-neutral-500 italic">Sin Lote</span>
                                                                    {slBadge && <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: slBadge.bg, color: slBadge.color }}>{slBadge.text}</span>}
                                                                    {unassignedPicked > 0 && (
                                                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200"
                                                                            onClick={() => alert(`Separados (S/L) para:\n${pickedSummary[group.productId].lots['S/L'].orders.map(o => `• ${o.distributorName} (P-${o.orderNumber}): ${o.quantity} uds`).join('\n')}`)}>
                                                                            📦 {unassignedPicked} uds sep.
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-4 mb-2 text-sm">
                                                                    <span className="text-neutral-500">💻 ERP:</span>
                                                                    <span className="text-neutral-400 font-mono">0</span>
                                                                </div>
                                                                {isEditable ? (
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <div className="flex-1 min-w-0">
                                                                            <label className="text-xs text-amber-700 font-semibold mb-1 block">📦 Físico (S/L)</label>
                                                                            <input type="text" inputMode="numeric" data-scanner-ignore="true"
                                                                                value={localInputSL.physicalGrams}
                                                                                onChange={e => setInputMap(m => ({ ...m, [keySL]: { ...m[keySL], physicalGrams: e.target.value } }))}
                                                                                onKeyDown={e => handleInputKeyDown(e, keySL, e.target.value, () => saveLotCount(group, true), (revertedValue) => setInputMap(m => ({ ...m, [keySL]: { ...m[keySL], physicalGrams: revertedValue } })))}
                                                                                placeholder="0"
                                                                                disabled={!!savingMap[`nolot-${group.productId}`]}
                                                                                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-lg text-right font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 bg-white" />
                                                                        </div>
                                                                        <button onClick={() => saveLotCount(group, true)}
                                                                            disabled={!!savingMap[`nolot-${group.productId}`]}
                                                                            className="mt-5 px-5 py-3 rounded-xl font-bold text-sm transition-colors whitespace-nowrap bg-neutral-200 hover:bg-neutral-300 text-neutral-700 disabled:opacity-50">
                                                                            {savingMap[`nolot-${group.productId}`] ? '...' : 'Guardar S/L'}
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-amber-700 font-semibold">
                                                                        📦 Físico: {localInputSL.physicalGrams || '—'}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function StatBox({ label, value, color }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold mb-0.5">{label}</div>
            <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
        </div>
    );
}
