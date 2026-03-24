import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const PHASE = { CHECKLIST: 'checklist', COUNTING: 'counting', RESULTS: 'results', HISTORY: 'history' };

const PhysicalCountPage = () => {
    const { user } = useAuth();
    const [phase, setPhase] = useState(PHASE.CHECKLIST);
    const [loading, setLoading] = useState(true);
    const [count, setCount] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyDetail, setHistoryDetail] = useState(null);

    // Checklist
    const [checklist, setChecklist] = useState({ empaqueConfirmed: false, pedidosSeparated: false, noTransfersPending: false });

    // Count items state (local edits before save)
    const [localItems, setLocalItems] = useState({});
    const [validatedItems, setValidatedItems] = useState({}); // { itemId: { ok, diff, systemQty } }
    const [saving, setSaving] = useState(false);
    const [closing, setClosing] = useState(false);
    const [filter, setFilter] = useState('');
    const [validating, setValidating] = useState(null); // itemId being validated
    const saveTimerRef = useRef(null);

    // On mount: check for active count
    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/physical-counts/active');
                if (res.data.count) {
                    setCount(res.data.count);
                    initLocalItems(res.data.count.items);
                    setPhase(PHASE.COUNTING);
                }
            } catch (err) {
                console.error('Error checking active count:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const initLocalItems = (items) => {
        const map = {};
        items.forEach(i => {
            map[i.id] = { boxes: i.countedBoxes || 0, loose: i.countedLoose || 0 };
        });
        setLocalItems(map);
    };

    // Auto-save every 30s
    useEffect(() => {
        if (phase !== PHASE.COUNTING || !count) return;
        saveTimerRef.current = setInterval(() => { saveItems(false); }, 30000);
        return () => clearInterval(saveTimerRef.current);
    }, [phase, count, localItems]);

    const saveItems = async (showFeedback = true) => {
        if (!count) return;
        const items = Object.entries(localItems).map(([itemId, v]) => ({
            itemId, countedBoxes: v.boxes, countedLoose: v.loose,
        }));
        if (items.length === 0) return;
        try {
            if (showFeedback) setSaving(true);
            await api.patch(`/physical-counts/${count.id}/items`, { items });
        } catch (err) {
            console.error('Error saving items:', err);
        } finally {
            if (showFeedback) setTimeout(() => setSaving(false), 800);
        }
    };

    const handleStart = async () => {
        try {
            setLoading(true);
            const res = await api.post('/physical-counts', { checklist });
            setCount(res.data.count);
            initLocalItems(res.data.count.items);
            setPhase(PHASE.COUNTING);
        } catch (err) {
            alert(err.response?.data?.error || 'Error al iniciar conteo');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = async () => {
        if (!confirm('¿Cerrar el conteo? Se revelarán las diferencias. Esta acción no se puede deshacer.')) return;
        try {
            setClosing(true);
            await saveItems(false);
            const res = await api.post(`/physical-counts/${count.id}/close`, {});
            setCount(res.data.count);
            setPhase(PHASE.RESULTS);
        } catch (err) {
            alert(err.response?.data?.error || 'Error al cerrar conteo');
        } finally {
            setClosing(false);
        }
    };

    const loadHistory = async () => {
        try {
            const res = await api.get('/physical-counts/history');
            setHistory(res.data.counts || []);
            setPhase(PHASE.HISTORY);
        } catch (err) {
            console.error(err);
        }
    };

    const loadHistoryDetail = async (id) => {
        try {
            const res = await api.get(`/physical-counts/${id}`);
            setHistoryDetail(res.data.count);
        } catch (err) {
            console.error(err);
        }
    };

    const updateItem = (itemId, field, value) => {
        setLocalItems(prev => ({
            ...prev,
            [itemId]: { ...prev[itemId], [field]: parseInt(value) || 0 },
        }));
    };

    const getTotal = (itemId, packSize) => {
        const v = localItems[itemId] || { boxes: 0, loose: 0 };
        return (v.boxes * (packSize || 1)) + v.loose;
    };

    const isCounted = (itemId) => {
        const v = localItems[itemId];
        return v && (v.boxes > 0 || v.loose > 0);
    };

    const isValidated = (itemId) => !!validatedItems[itemId];

    const validateItem = async (item) => {
        const ps = item.product?.packSize || 1;
        const v = localItems[item.id] || { boxes: 0, loose: 0 };
        const total = (v.boxes * ps) + v.loose;
        setValidating(item.id);
        try {
            // Save this item first
            await api.patch(`/physical-counts/${count.id}/items`, {
                items: [{ itemId: item.id, countedBoxes: v.boxes, countedLoose: v.loose }]
            });
            const diff = total - item.systemQuantity;
            setValidatedItems(prev => ({
                ...prev,
                [item.id]: { ok: diff === 0, diff, systemQty: item.systemQuantity, countedTotal: total }
            }));
        } catch (err) {
            console.error('Error validating:', err);
        } finally {
            setValidating(null);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
                    <div style={{ color: '#64748b', fontWeight: 600 }}>Cargando módulo de conteo...</div>
                </div>
            </div>
        );
    }

    // ── PHASE: CHECKLIST ──
    if (phase === PHASE.CHECKLIST) {
        const allChecked = checklist.empaqueConfirmed && checklist.pedidosSeparated && checklist.noTransfersPending;
        return (
            <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ fontSize: '3rem', marginBottom: 8 }}>📋</div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Conteo Físico — Producto Terminado</h1>
                    <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 6 }}>Validaciones previas antes de iniciar el conteo</p>
                </div>

                <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    {[
                        { key: 'empaqueConfirmed', icon: '📦', title: 'Empaque no enviará más producto', desc: 'Confirma que empaque ya terminó de enviar producto terminado para hoy' },
                        { key: 'pedidosSeparated', icon: '📝', title: 'Pedidos ya separados', desc: 'Todos los pedidos pendientes ya fueron alistados y separados del inventario' },
                        { key: 'noTransfersPending', icon: '🔄', title: 'Sin traslados pendientes', desc: 'No hay traslados entre zonas pendientes que puedan mover producto' },
                    ].map((item, idx) => (
                        <label key={item.key}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px',
                                borderBottom: idx < 2 ? '1px solid #f1f5f9' : 'none',
                                cursor: 'pointer', transition: 'background 0.15s',
                                background: checklist[item.key] ? '#f0fdf4' : 'white',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = checklist[item.key] ? '#dcfce7' : '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = checklist[item.key] ? '#f0fdf4' : 'white'}
                        >
                            <input type="checkbox" checked={checklist[item.key]}
                                onChange={e => setChecklist(p => ({ ...p, [item.key]: e.target.checked }))}
                                style={{ width: 22, height: 22, accentColor: '#10b981', cursor: 'pointer', flexShrink: 0 }} />
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#1e293b', fontSize: '0.92rem' }}>
                                    <span>{item.icon}</span> {item.title}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 2 }}>{item.desc}</div>
                            </div>
                            {checklist[item.key] && <span style={{ marginLeft: 'auto', fontSize: '1.2rem' }}>✅</span>}
                        </label>
                    ))}
                </div>

                <button onClick={handleStart} disabled={!allChecked}
                    style={{
                        width: '100%', marginTop: 20, padding: '14px 0', borderRadius: 12, border: 'none',
                        background: allChecked ? 'linear-gradient(135deg, #10b981, #059669)' : '#e2e8f0',
                        color: allChecked ? 'white' : '#94a3b8', fontSize: '1rem', fontWeight: 700,
                        cursor: allChecked ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                        boxShadow: allChecked ? '0 4px 12px rgba(16,185,129,0.3)' : 'none',
                    }}>
                    🚀 Iniciar Conteo
                </button>

                <button onClick={loadHistory}
                    style={{
                        width: '100%', marginTop: 10, padding: '12px 0', borderRadius: 12, border: '2px solid #e2e8f0',
                        background: 'white', color: '#64748b', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                    }}>
                    📊 Ver Historial de Conteos
                </button>
            </div>
        );
    }

    // ── PHASE: COUNTING ──
    if (phase === PHASE.COUNTING && count) {
        const items = count.items || [];
        const validatedCount = items.filter(i => isValidated(i.id)).length;
        const progress = items.length > 0 ? Math.round((validatedCount / items.length) * 100) : 0;

        // Extract flavor from product name (e.g. "LIQUIPOPS SABOR A MARACUYA X 350 GR" → "MARACUYA")
        const getFlavor = (name) => {
            const m = name?.match(/SABOR\s+A\s+(.+?)\s*X\s*\d/i);
            return m ? m[1].trim().toUpperCase() : (name?.replace(/\s*X\s*\d+.*$/i, '') || 'OTRO');
        };
        const getSize = (name) => {
            const m = name?.match(/(\d+)\s*(GR|G|ML|KG)/i);
            return m ? m[1] + m[2].toUpperCase() : '';
        };
        const FLAVOR_EMOJI = {
            'BLUEBERRY': '🫐', 'CEREZA': '🍒', 'CHAMOY': '🌶️', 'CHICLE': '🫧',
            'COCO': '🥥', 'FRESA': '🍓', 'ICE PINK': '🩷', 'MANGO BICHE': '🥭',
            'MANGO BICHE CON SAL': '🥭', 'MANZANA VERDE': '🍏', 'MARACUYA': '💛',
            'MORA': '🫐', 'NARANJA': '🍊', 'NATURAL': '💧', 'SANDIA': '🍉',
            'TAMARINDO': '🌰', 'UVA': '🍇', 'LIMON': '🍋', 'DURAZNO': '🍑',
            'PIÑA': '🍍', 'GUANABANA': '🥝', 'LULO': '🟡',
        };
        const getFlavorEmoji = (flavor) => FLAVOR_EMOJI[flavor] || '🍬';

        // Group by flavor
        const flavorGroups = {};
        items.forEach(i => {
            const flavor = getFlavor(i.product?.name);
            if (!flavorGroups[flavor]) flavorGroups[flavor] = [];
            flavorGroups[flavor].push(i);
        });
        // Sort each flavor group by size descending
        Object.values(flavorGroups).forEach(g => g.sort((a, b) => {
            const sA = parseInt(getSize(a.product?.name)) || 0;
            const sB = parseInt(getSize(b.product?.name)) || 0;
            return sB - sA;
        }));
        const sortedFlavors = Object.keys(flavorGroups).sort();

        // Filter
        const filterLower = filter.toLowerCase();

        return (
            <div style={{ maxWidth: 700, margin: '20px auto', padding: '0 12px' }}>
                {/* Header */}
                <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f8fafc', paddingBottom: 12, paddingTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <h1 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                            📋 Conteo Ciego
                        </h1>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => saveItems(true)}
                                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: 'white', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                                {saving ? '💾 Guardando...' : '💾 Guardar'}
                            </button>
                            <button onClick={handleClose} disabled={closing || validatedCount < items.length}
                                style={{
                                    padding: '6px 14px', borderRadius: 8, border: 'none',
                                    background: validatedCount === items.length ? 'linear-gradient(135deg, #10b981, #059669)' : '#e2e8f0',
                                    color: validatedCount === items.length ? 'white' : '#94a3b8',
                                    fontSize: '0.78rem', fontWeight: 700,
                                    cursor: validatedCount === items.length ? 'pointer' : 'not-allowed',
                                }}>
                                {closing ? '⏳ Cerrando...' : '🔒 Cerrar Conteo'}
                            </button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div style={{ background: '#e2e8f0', borderRadius: 999, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{
                            width: `${progress}%`, height: '100%', borderRadius: 999, transition: 'width 0.3s',
                            background: progress === 100 ? '#10b981' : 'linear-gradient(90deg, #3b82f6, #6366f1)',
                        }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        <span>{validatedCount} de {items.length} validados</span>
                        <span>{progress}%</span>
                    </div>

                    {/* Filter */}
                    <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
                        placeholder="🔍 Filtrar sabor o producto..."
                        style={{
                            width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 10,
                            border: '2px solid #e2e8f0', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
                        }} />
                </div>

                {/* Product list grouped by FLAVOR */}
                {sortedFlavors.map(flavor => {
                    const groupItems = flavorGroups[flavor].filter(i =>
                        !filterLower || i.product?.name?.toLowerCase().includes(filterLower) || i.product?.sku?.toLowerCase().includes(filterLower) || flavor.toLowerCase().includes(filterLower)
                    );
                    if (groupItems.length === 0) return null;
                    const allGroupValidated = groupItems.every(i => validatedItems[i.id]?.ok);
                    const allGroupChecked = groupItems.every(i => isValidated(i.id));

                    return (
                        <div key={flavor} style={{ marginBottom: 20 }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                fontSize: '0.82rem', fontWeight: 800,
                                color: allGroupValidated ? '#16a34a' : allGroupChecked ? '#dc2626' : '#6366f1',
                                textTransform: 'uppercase',
                                padding: '6px 0', borderBottom: `2px solid ${allGroupValidated ? '#86efac' : allGroupChecked ? '#fca5a5' : '#e0e7ff'}`, marginBottom: 8,
                            }}>
                                {allGroupValidated ? '✅' : getFlavorEmoji(flavor)} {flavor}
                                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94a3b8', textTransform: 'none' }}>({groupItems.length} presentacion{groupItems.length > 1 ? 'es' : ''})</span>
                            </div>

                            {groupItems.map(item => {
                                const ps = item.product?.packSize || 1;
                                const counted = isCounted(item.id);
                                const total = getTotal(item.id, ps);
                                const v = localItems[item.id] || { boxes: 0, loose: 0 };
                                const size = getSize(item.product?.name);
                                const validated = validatedItems[item.id];
                                const isBeingValidated = validating === item.id;

                                // Determine row style based on validation state
                                let rowBg = 'white', rowBorder = '#e2e8f0';
                                if (validated) {
                                    rowBg = validated.ok ? '#f0fdf4' : '#fef2f2';
                                    rowBorder = validated.ok ? '#86efac' : '#fca5a5';
                                } else if (counted) {
                                    rowBg = '#fefce8'; rowBorder = '#fde68a';
                                }

                                return (
                                    <div key={item.id} style={{ marginBottom: 6 }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                                            background: rowBg, borderRadius: validated ? '12px 12px 0 0' : 12,
                                            border: `2px solid ${rowBorder}`,
                                            borderBottom: validated ? 'none' : `2px solid ${rowBorder}`,
                                            transition: 'all 0.15s',
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{
                                                        padding: '1px 7px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 800,
                                                        background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe',
                                                    }}>{size}</span>
                                                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>📦 {ps} uds/caja</span>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                                <div style={{ textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase' }}>Cajas</div>
                                                    <input type="number" min="0" value={v.boxes || ''}
                                                        onChange={e => { updateItem(item.id, 'boxes', e.target.value); if (validated) setValidatedItems(p => { const n = {...p}; delete n[item.id]; return n; }); }}
                                                        disabled={validated?.ok}
                                                        style={{
                                                            width: 50, padding: '6px 2px', borderRadius: 8, border: '2px solid #c7d2fe',
                                                            textAlign: 'center', fontSize: '1rem', fontWeight: 800, color: '#4338ca',
                                                            background: validated?.ok ? '#e2e8f0' : '#eef2ff', outline: 'none',
                                                            opacity: validated?.ok ? 0.6 : 1,
                                                        }} />
                                                </div>
                                                <div style={{ color: '#cbd5e1', fontWeight: 800, fontSize: '1rem' }}>+</div>
                                                <div style={{ textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>Sueltas</div>
                                                    <input type="number" min="0" value={v.loose || ''}
                                                        onChange={e => { updateItem(item.id, 'loose', e.target.value); if (validated) setValidatedItems(p => { const n = {...p}; delete n[item.id]; return n; }); }}
                                                        disabled={validated?.ok}
                                                        style={{
                                                            width: 50, padding: '6px 2px', borderRadius: 8, border: '2px solid #fde68a',
                                                            textAlign: 'center', fontSize: '1rem', fontWeight: 800, color: '#92400e',
                                                            background: validated?.ok ? '#e2e8f0' : '#fffbeb', outline: 'none',
                                                            opacity: validated?.ok ? 0.6 : 1,
                                                        }} />
                                                </div>
                                                <div style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.8rem' }}>=</div>
                                                <div style={{
                                                    minWidth: 36, textAlign: 'center', padding: '4px 6px', borderRadius: 8,
                                                    background: validated ? (validated.ok ? '#dcfce7' : '#fee2e2') : counted ? '#fef9c3' : '#f1f5f9',
                                                    fontWeight: 800, fontSize: '0.9rem',
                                                    color: validated ? (validated.ok ? '#16a34a' : '#dc2626') : counted ? '#a16207' : '#94a3b8',
                                                }}>
                                                    {total}
                                                </div>
                                                {/* Validate button */}
                                                {!validated?.ok && (
                                                    <button onClick={() => validateItem(item)}
                                                        disabled={!counted || isBeingValidated}
                                                        style={{
                                                            padding: '5px 8px', borderRadius: 8, border: 'none', fontSize: '0.7rem', fontWeight: 700,
                                                            background: !counted ? '#e2e8f0' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                                            color: !counted ? '#94a3b8' : 'white',
                                                            cursor: !counted ? 'not-allowed' : 'pointer',
                                                            whiteSpace: 'nowrap', minWidth: 50,
                                                        }}>
                                                        {isBeingValidated ? '⏳' : '✓ Validar'}
                                                    </button>
                                                )}
                                                {validated?.ok && <span style={{ fontSize: '1.2rem' }}>✅</span>}
                                            </div>
                                        </div>

                                        {/* Validation result banner */}
                                        {validated && !validated.ok && (
                                            <div style={{
                                                padding: '6px 12px', borderRadius: '0 0 12px 12px',
                                                border: '2px solid #fca5a5', borderTop: 'none',
                                                background: '#fef2f2',
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626' }}>
                                                    ❌ Diferencia: {validated.diff > 0 ? '+' : ''}{validated.diff} uds
                                                    {validated.diff > 0 ? ' (sobrante)' : ' (faltante)'}
                                                </span>
                                                <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Corrige y vuelve a validar</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    }

    // ── PHASE: RESULTS ──
    if (phase === PHASE.RESULTS && count) {
        const items = count.items || [];
        const ok = items.filter(i => i.difference === 0).length;
        const over = items.filter(i => i.difference > 0).length;
        const under = items.filter(i => i.difference < 0).length;

        return (
            <div style={{ maxWidth: 700, margin: '20px auto', padding: '0 12px' }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <div style={{ fontSize: '3rem', marginBottom: 4 }}>📊</div>
                    <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Resultados del Conteo</h1>
                    <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 4 }}>
                        {new Date(count.closedAt).toLocaleString('es-CO')} — {count.countedBy?.name}
                    </p>
                </div>

                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                    <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '14px 10px', textAlign: 'center', border: '2px solid #86efac' }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#16a34a' }}>{ok}</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>✅ Cuadrados</div>
                    </div>
                    <div style={{ background: '#fef3c7', borderRadius: 12, padding: '14px 10px', textAlign: 'center', border: '2px solid #fcd34d' }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#d97706' }}>{over}</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>📈 Sobrante</div>
                    </div>
                    <div style={{ background: '#fef2f2', borderRadius: 12, padding: '14px 10px', textAlign: 'center', border: '2px solid #fca5a5' }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#dc2626' }}>{under}</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>📉 Faltante</div>
                    </div>
                </div>

                {/* Results table */}
                <div style={{ background: 'white', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px', padding: '10px 14px', background: '#f1f5f9', fontWeight: 700, fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', gap: 6 }}>
                        <div>Producto</div>
                        <div style={{ textAlign: 'center' }}>Sistema</div>
                        <div style={{ textAlign: 'center' }}>Conteo</div>
                        <div style={{ textAlign: 'center' }}>Diferencia</div>
                    </div>

                    {items.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).map((item, idx) => {
                        const name = item.product?.name?.replace(/LIQUIPOPS SABOR A /i, '').replace(/\s*X\s*\d+.*$/i, '') || '';
                        const size = item.product?.name?.match(/(\d+\s*(GR|G|ML))/i)?.[1] || '';
                        const diffColor = item.difference > 0 ? '#16a34a' : item.difference < 0 ? '#dc2626' : '#64748b';
                        const diffBg = item.difference > 0 ? '#f0fdf4' : item.difference < 0 ? '#fef2f2' : 'white';
                        const diffSign = item.difference > 0 ? '+' : '';

                        return (
                            <div key={item.id} style={{
                                display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px', padding: '10px 14px',
                                borderBottom: idx < items.length - 1 ? '1px solid #f1f5f9' : 'none',
                                background: diffBg, gap: 6, alignItems: 'center',
                            }}>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b' }}>{name}</div>
                                    <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{size}</div>
                                </div>
                                <div style={{ textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', color: '#475569' }}>{item.systemQuantity}</div>
                                <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.85rem', color: '#1e293b' }}>{item.countedTotal}</div>
                                <div style={{
                                    textAlign: 'center', fontWeight: 900, fontSize: '0.9rem', color: diffColor,
                                    background: item.difference !== 0 ? (item.difference > 0 ? '#dcfce7' : '#fee2e2') : '#f1f5f9',
                                    borderRadius: 8, padding: '4px 0',
                                }}>
                                    {item.difference === 0 ? '—' : `${diffSign}${item.difference}`}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                    <button onClick={() => { setPhase(PHASE.CHECKLIST); setCount(null); setChecklist({ empaqueConfirmed: false, pedidosSeparated: false, noTransfersPending: false }); }}
                        style={{ flex: 1, padding: '12px', borderRadius: 12, border: '2px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
                        ← Nuevo Conteo
                    </button>
                    <button onClick={loadHistory}
                        style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#6366f1', color: 'white', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
                        📊 Historial
                    </button>
                </div>
            </div>
        );
    }

    // ── PHASE: HISTORY ──
    if (phase === PHASE.HISTORY) {
        return (
            <div style={{ maxWidth: 700, margin: '20px auto', padding: '0 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>📊 Historial de Conteos</h1>
                    <button onClick={() => { setPhase(PHASE.CHECKLIST); setHistoryDetail(null); }}
                        style={{ padding: '8px 16px', borderRadius: 10, border: '2px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                        ← Volver
                    </button>
                </div>

                {historyDetail ? (
                    <div>
                        <button onClick={() => setHistoryDetail(null)}
                            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#6366f1', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', marginBottom: 12 }}>
                            ← Lista
                        </button>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 10 }}>
                            {new Date(historyDetail.closedAt).toLocaleString('es-CO')} — {historyDetail.countedBy?.name}
                        </div>
                        <div style={{ background: 'white', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                            {(historyDetail.items || []).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).map((item, idx) => {
                                const name = item.product?.name?.replace(/LIQUIPOPS SABOR A /i, '').replace(/\s*X\s*\d+.*$/i, '') || '';
                                const diff = item.difference;
                                return (
                                    <div key={item.id} style={{
                                        display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px', padding: '8px 12px',
                                        borderBottom: '1px solid #f1f5f9', alignItems: 'center', gap: 6,
                                        background: diff > 0 ? '#f0fdf4' : diff < 0 ? '#fef2f2' : 'white',
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#1e293b' }}>{name}</div>
                                        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>{item.systemQuantity}</div>
                                        <div style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700 }}>{item.countedTotal}</div>
                                        <div style={{
                                            textAlign: 'center', fontWeight: 800, fontSize: '0.85rem',
                                            color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#94a3b8',
                                        }}>
                                            {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff}`}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {history.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No hay conteos registrados</div>
                        ) : history.map(h => (
                            <div key={h.id} onClick={() => loadHistoryDetail(h.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                                    background: 'white', borderRadius: 12, border: '2px solid #e2e8f0',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = '#6366f1'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                            >
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                                        {new Date(h.startedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{h.countedBy?.name} — {h.summary?.total} productos</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {h.summary?.ok > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, background: '#dcfce7', color: '#16a34a' }}>✅ {h.summary.ok}</span>}
                                    {h.summary?.over > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, background: '#fef3c7', color: '#d97706' }}>+{h.summary.over}</span>}
                                    {h.summary?.under > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>-{h.summary.under}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return null;
};

export default PhysicalCountPage;
