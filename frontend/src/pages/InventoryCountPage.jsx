import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';

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
const fmtKg = (grams) => {
    if (grams == null || grams === '') return '—';
    const n = Number(grams);
    if (isNaN(n)) return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(2)} kg` : `${n.toFixed(0)} g`;
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

const diffBadge = (diff) => {
    if (diff == null) return null;
    const abs = Math.abs(diff);
    if (abs < 100) return { bg: '#f0fdf4', color: '#15803d', text: '≈ OK' };
    if (diff < 0) return { bg: '#fef2f2', color: '#dc2626', text: `−${fmtKg(abs)}` };
    return { bg: '#fffbeb', color: '#d97706', text: `+${fmtKg(abs)}` };
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

    const [search, setSearch] = useState('');
    const [filterUncounted, setFilterUncounted] = useState(false);
    const [savingMap, setSavingMap] = useState({});
    const [inputMap, setInputMap] = useState({});

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
            const [{ data: sess }, matRes, finRes] = await Promise.all([
                api.get(`/inventory-count/sessions/${session.id}`),
                api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK'),
                api.get('/finished-lots/all-active')
            ]);
            setActiveSession(sess);
            const matLots = Array.isArray(matRes.data) ? matRes.data : [];
            const finLots = Array.isArray(finRes.data) ? finRes.data : [];
            // Merge: mat lots already have zone WAREHOUSE/PRODUCTION; finished have zone from FinishedLotStock
            setSystemLots([...matLots, ...finLots]);
            const lines = sess.lines || [];
            setCountLines(lines);
            const im = {};
            lines.forEach(ln => {
                const key = ln.lotId || ln.lotNumber;
                im[key] = { physicalKg: (ln.physicalQty / 1000).toFixed(3), notes: ln.notes || '', lineId: ln.id };
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
            const { data: sess } = await api.post('/inventory-count/sessions', {
                month: newForm.month,
                warehouseName: newForm.warehouseName,
                type: 'MATERIA_PRIMA'
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

    // ── Save a single lot count ───────────────────────────────────────────────
    const saveLotCount = useCallback(async (lot) => {
        const key = lot.id;
        const inp = inputMap[key] || {};
        const physicalKg = parseFloat(inp.physicalKg);
        if (isNaN(physicalKg) || inp.physicalKg === '') return;
        setSavingMap(m => ({ ...m, [key]: true }));
        try {
            const payload = {
                lineId: inp.lineId || null,
                productId: lot.productId || null,
                productName: lot.siigoProductName || lot.product?.name || 'Sin nombre',
                siigoProductCode: lot.siigoProductCode || null,
                lotId: lot.id,
                lotNumber: lot.lotNumber,
                physicalQty: Math.round(physicalKg * 1000),
                unit: 'gramo',
                notes: inp.notes || null
            };
            const { data: savedLine } = await api.post(`/inventory-count/sessions/${activeSession.id}/lines`, payload);
            setInputMap(m => ({ ...m, [key]: { ...m[key], lineId: savedLine.id } }));
            setCountLines(prev => {
                const idx = prev.findIndex(l => l.lotId === lot.id);
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
        1400: '🧪 Materia Prima Base',
        1401: '🧪 Materia Prima General',
        1402: '🍫 Endulzantes y Azúcares',
        1403: '🍫 Azúcares',
        1404: '🍑 Compuestos y Esferas',
        1405: '🧯 Conservantes y Aditivos',
        1406: '🍬 Sabores Líquidos',
        1407: '🎨 Colorantes',
        1408: '📦 Empaque y Envases',
        1409: '📦 Insumos de Empaque',
        477:  '💻 Producto Terminado',
        478:  '💻 Producto Terminado (Especial)',
        11615: '⚙️ Insumos de Producción',
    };

    // ── Flat lot rows: activos ───────────────────────────────────────────────
    // Zonas de producto terminado: solo muestran FinishedLotStock, no MP
    const FINISHED_ZONES = ['FINISHED', 'MAQUILA', 'NO_CONFORME'];
    const isFinishedSession = FINISHED_ZONES.includes(activeZone);

    const allLotRows = useMemo(() => {
        if (!systemLots.length) return [];
        let activeLots = systemLots.filter(l => ['AVAILABLE', 'LOW_STOCK', 'LOW'].includes(l.status) && (l.currentQuantity || 0) > 0);
        // En sesiones de PT/Maquila/NC: solo lotes de FinishedLotStock (no MP)
        if (isFinishedSession) {
            activeLots = activeLots.filter(l => l._source === 'FINISHED_LOT');
        }
        const lineByLotId = {};
        countLines.forEach(ln => { if (ln.lotId) lineByLotId[ln.lotId] = ln; });
        const ZONE_MAP = {
            WAREHOUSE: ['WAREHOUSE'],
            PRODUCTION: ['PRODUCTION', 'PRODUCCION'],
            FINISHED: ['PRODUCTO_TERMINADO'],
            MAQUILA: ['MAQUILA'],
            NO_CONFORME: ['NO_CONFORME'],
        };
        const activeZones = ZONE_MAP[activeZone] || [activeZone];
        return activeLots.map(lot => {
            const rawZone = lot.zone || 'WAREHOUSE';
            const isActive = activeZones.includes(rawZone);
            const savedLine = isActive ? lineByLotId[lot.id] : null;
            const isCounted = !!savedLine;
            const physicalGrams = savedLine ? savedLine.physicalQty : null;
            const systemGrams = lot.currentQuantity || 0;
            const diff = physicalGrams != null ? physicalGrams - systemGrams : null;
            return { lot, isActive, isCounted, physicalGrams, systemGrams, diff, zone: rawZone };
        });
    }, [systemLots, countLines, activeZone, isFinishedSession]);

    // ── Grouped by AccountGroup → Producto → Lotes ──────────────────────────────
    const accountGroups = useMemo(() => {
        const agMap = {};
        for (const row of allLotRows) {
            const ag = row.lot.product?.accountGroup ?? 'N/A';
            const agName = ACCOUNT_GROUP_NAMES[ag] || `📄 Grupo ${ag}`;
            if (!agMap[ag]) agMap[ag] = { agId: ag, agName, products: {} };
            const pid = row.lot.productId || row.lot.siigoProductCode || row.lot.siigoProductName || 'unknown';
            if (!agMap[ag].products[pid]) {
                agMap[ag].products[pid] = {
                    productId: pid,
                    productName: row.lot.siigoProductName || row.lot.product?.name || '—',
                    productCode: row.lot.siigoProductCode || '',
                    siigoTotal: extractSiigoTotal(row.lot),
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
    }, [allLotRows]);

    // ── Filtered accountGroups ────────────────────────────────────────────────
    const filteredAccountGroups = useMemo(() => {
        return accountGroups
            .map(ag => ({
                ...ag,
                products: ag.products
                    .map(g => {
                        let lots = g.lots;
                        if (search.trim()) {
                            const q = search.toLowerCase();
                            lots = lots.filter(r =>
                                r.lot.lotNumber?.toLowerCase().includes(q) ||
                                g.productName.toLowerCase().includes(q) ||
                                g.productCode?.toLowerCase().includes(q) ||
                                ag.agName.toLowerCase().includes(q)
                            );
                        }
                        if (filterUncounted && !lots.some(r => r.isActive && !r.isCounted)) return null;
                        return lots.length > 0 ? { ...g, lots } : null;
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
                        <button onClick={() => setShowNewForm(true)}
                            className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                            + Nueva sesión
                        </button>
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
                            <input value={search} onChange={e => setSearch(e.target.value)}
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
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">📦 Físico (kg)</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Δ vs ERP</th>
                                                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Obs.</th>
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
                                                                                    🔵 Total en Siigo: {fmtKg(group.siigoTotal)}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td colSpan={colCount - 2}></td>
                                                                </tr>
                                                                {group.lots.map(({ lot, isActive, isCounted, systemGrams, diff, zone }) => {
                                                                    const key = lot.id;
                                                                    const localInput = inputMap[key] || { physicalKg: '', notes: '' };
                                                                    const saving = !!savingMap[key];
                                                                    const badge = diffBadge(diff);
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
                                                                                    <span className="text-xs text-neutral-400 italic">solo referencia</span>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-2 text-neutral-500 text-sm">{fmtKg(systemGrams)}</td>
                                                                            <td className="px-4 py-2 text-neutral-400 text-xs italic" colSpan={colCount - 2}>No editable en esta sesión</td>
                                                                        </tr>
                                                                    );

                                                                    return (
                                                                        <tr key={lot.id} className={`border-t border-neutral-100 transition-colors ${isCounted ? 'bg-green-50/30' : 'bg-white hover:bg-neutral-50'}`}>
                                                                            <td className="px-4 py-2.5 pl-8">
                                                                                {isCounted ? <span className="text-green-500">✓</span> : <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-300"></span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-neutral-400 text-xs">└</span>
                                                                                    <code className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{lot.lotNumber}</code>
                                                                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${zoneColor}`}>{zoneLabel}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-blue-700 font-semibold text-sm">{fmtKg(systemGrams)}</td>
                                                                            <td className="px-4 py-2.5">
                                                                                {canEdit ? (
                                                                                    <input type="number" step="0.001" min="0"
                                                                                        value={localInput.physicalKg}
                                                                                        onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalKg: e.target.value } }))}
                                                                                        onKeyDown={e => e.key === 'Enter' && saveLotCount(lot)}
                                                                                        placeholder="0.000"
                                                                                        className="w-24 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-green-400" />
                                                                                ) : (
                                                                                    <span className="text-green-700 font-semibold text-sm">{isCounted ? fmtKg((parseFloat(localInput.physicalKg) || 0) * 1000) : '—'}</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                {badge && <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                {canEdit ? (
                                                                                    <input type="text" value={localInput.notes}
                                                                                        onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], notes: e.target.value } }))}
                                                                                        placeholder="Opcional"
                                                                                        className="w-28 border border-neutral-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                                                                                ) : <span className="text-neutral-400 text-xs">{localInput.notes || ''}</span>}
                                                                            </td>
                                                                            {isEditable && (
                                                                                <td className="px-4 py-2.5">
                                                                                    <button onClick={() => saveLotCount(lot)}
                                                                                        disabled={saving || localInput.physicalKg === ''}
                                                                                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${isCounted ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600' : 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200'} disabled:opacity-40`}>
                                                                                        {saving ? '...' : isCounted ? '↻ Actualizar' : '✓ Guardar'}
                                                                                    </button>
                                                                                </td>
                                                                            )}
                                                                        </tr>
                                                                    );
                                                                })}
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
                                                                    🔵 Siigo: {fmtKg(group.siigoTotal)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Lot Cards */}
                                                    {group.lots.map(({ lot, isActive, isCounted, systemGrams, diff, zone }) => {
                                                        const key = lot.id;
                                                        const localInput = inputMap[key] || { physicalKg: '', notes: '' };
                                                        const saving = !!savingMap[key];
                                                        const badge = diffBadge(diff);
                                                        const canEdit = isEditable && isActive;
                                                        const zoneLabel = ZONE_LABELS[zone] || zone;
                                                        const zoneColor = ZONE_COLORS[zone] || 'bg-neutral-100 text-neutral-500 border-neutral-200';

                                                        if (!isActive) return (
                                                            <div key={lot.id} className="ml-4 border-l-2 border-neutral-200 pl-3 py-2 opacity-60">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <code className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded font-mono">{lot.lotNumber}</code>
                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${zoneColor}`}>{zoneLabel}</span>
                                                                    <span className="text-xs text-neutral-400">— {fmtKg(systemGrams)}</span>
                                                                    <span className="text-xs text-neutral-400 italic">referencia</span>
                                                                </div>
                                                            </div>
                                                        );

                                                        return (
                                                            <div key={lot.id} className={`ml-4 border-l-3 pl-3 py-3 rounded-r-lg mb-1 ${isCounted ? 'border-green-400 bg-green-50/40' : 'border-blue-300 bg-white'}`}>
                                                                {/* Lot info row */}
                                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                    {isCounted ? <span className="text-green-500 text-lg">✓</span> : <span className="inline-block w-5 h-5 rounded-full border-2 border-neutral-300 flex-shrink-0"></span>}
                                                                    <code className="text-sm bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono font-semibold">{lot.lotNumber}</code>
                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${zoneColor}`}>{zoneLabel}</span>
                                                                    {badge && <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
                                                                </div>
                                                                {/* ERP value */}
                                                                <div className="flex items-center gap-4 mb-2 text-sm">
                                                                    <span className="text-neutral-500">💻 ERP:</span>
                                                                    <span className="text-blue-700 font-bold">{fmtKg(systemGrams)}</span>
                                                                </div>
                                                                {/* Input row */}
                                                                {canEdit ? (
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <div className="flex-1 min-w-0">
                                                                            <label className="text-xs text-green-700 font-semibold mb-1 block">📦 Físico (kg)</label>
                                                                            <input type="number" step="0.001" min="0" inputMode="decimal"
                                                                                value={localInput.physicalKg}
                                                                                onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], physicalKg: e.target.value } }))}
                                                                                placeholder="0.000"
                                                                                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-lg text-right font-semibold focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-green-400" />
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <label className="text-xs text-neutral-500 mb-1 block">Obs.</label>
                                                                            <input type="text" value={localInput.notes}
                                                                                onChange={e => setInputMap(m => ({ ...m, [key]: { ...m[key], notes: e.target.value } }))}
                                                                                placeholder="Opcional"
                                                                                className="w-full border border-neutral-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                                                                        </div>
                                                                        <button onClick={() => saveLotCount(lot)}
                                                                            disabled={saving || localInput.physicalKg === ''}
                                                                            className={`mt-5 px-5 py-3 rounded-xl font-bold text-sm transition-colors whitespace-nowrap ${isCounted ? 'bg-neutral-200 text-neutral-700' : 'bg-green-500 text-white shadow-sm'} disabled:opacity-40`}>
                                                                            {saving ? '...' : isCounted ? '↻' : '✓'}
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-green-700 font-semibold">
                                                                        📦 Físico: {isCounted ? fmtKg((parseFloat(localInput.physicalKg) || 0) * 1000) : '—'}
                                                                        {localInput.notes && <span className="ml-3 text-neutral-400 text-xs font-normal">({localInput.notes})</span>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
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
