import React, { useState, useEffect } from 'react';
import { Search, Download, Filter, ChevronDown, ChevronLeft, ChevronRight, Package, Factory, Layers, List, AlertTriangle, PackageOpen } from 'lucide-react';
import api from '../services/api';

/* ─── Helpers ─────────────────────────────────────────────────── */
const fmtQty = (q, unit) => {
    if (!q && q !== 0) return '—';
    const absQ = Math.abs(q);
    const u = (unit || 'gramo').toLowerCase();
    const isWeight = ['g', 'gramo', 'gramos', 'kg'].includes(u);
    if (!isWeight) return `${absQ.toLocaleString()} ${unit || 'ud'}`;
    if (absQ >= 1_000_000) return `${(absQ / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} kg`;
    if (absQ >= 10_000) return `${(absQ / 1000).toFixed(1)} kg`;
    return `${absQ.toLocaleString()} g`;
};

const timeAgo = (d) => {
    if (!d) return '—';
    const ms = Date.now() - new Date(d).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `hace ${days}d`;
};

const fmtDate = (d) => new Date(d).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

const stockLevel = (current, initial) => {
    if (!initial || initial === 0) return 'ok';
    const pct = current / initial;
    if (pct <= 0.1) return 'critical';
    if (pct <= 0.3) return 'low';
    return 'ok';
};

/* ─── Styles ──────────────────────────────────────────────────── */
const S = {
    page: { padding: '1rem 1.5rem', minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    card: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' },
    tabs: { display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', background: '#fff', borderRadius: '12px 12px 0 0' },
    tab: (active) => ({
        flex: 1, padding: '14px 16px', textAlign: 'center', cursor: 'pointer', fontWeight: 700,
        fontSize: '0.85rem', border: 'none', background: active ? '#fff' : '#f8fafc',
        borderBottom: active ? '3px solid #4f46e5' : '3px solid transparent',
        color: active ? '#4f46e5' : '#64748b', transition: 'all .15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
    }),
    searchWrap: { padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 8 },
    searchInput: {
        flex: 1, padding: '8px 12px 8px 36px', border: '1px solid #e2e8f0', borderRadius: 8,
        fontSize: '0.85rem', outline: 'none', background: '#f8fafc'
    },
    badge: (color) => ({
        display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700,
        background: color === 'green' ? '#dcfce7' : color === 'yellow' ? '#fef9c3' : color === 'red' ? '#fee2e2' : '#f1f5f9',
        color: color === 'green' ? '#166534' : color === 'yellow' ? '#854d0e' : color === 'red' ? '#991b1b' : '#475569'
    }),
    lotBadge: {
        fontSize: '0.72rem', padding: '2px 6px', borderRadius: 4, background: '#e0e7ff',
        color: '#4338ca', fontWeight: 600, fontFamily: 'monospace'
    },
    summaryCards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 },
    summaryCard: (color) => ({
        padding: '14px 16px', borderRadius: 10, background: color === 'blue' ? '#eff6ff' : color === 'green' ? '#f0fdf4' : '#fefce8',
        border: `1px solid ${color === 'blue' ? '#bfdbfe' : color === 'green' ? '#bbf7d0' : '#fde68a'}`
    }),
};

/* ─── Stock Table (Bodega or Producción) ──────────────────────── */
const StockTable = ({ items, loading, zone, search, onSearchChange, onRefresh }) => {
    const [expanded, setExpanded] = useState(null);
    const [linkingLot, setLinkingLot] = useState(null);
    const [productSearch, setProductSearch] = useState('');
    const [productResults, setProductResults] = useState([]);
    const [linking, setLinking] = useState(false);

    const searchProducts = async (q) => {
        setProductSearch(q);
        if (q.length < 2) { setProductResults([]); return; }
        try {
            const res = await api.get(`/inventory/products?search=${encodeURIComponent(q)}&limit=8`);
            setProductResults(res.data || []);
        } catch { setProductResults([]); }
    };

    const handleLink = async (lotId, productId) => {
        setLinking(true);
        try {
            await api.patch(`/inventory/lots/${lotId}/link`, { productId });
            setLinkingLot(null);
            setProductSearch('');
            setProductResults([]);
            if (onRefresh) onRefresh();
        } catch (err) {
            alert('Error al vincular: ' + (err.response?.data?.error || err.message));
        } finally { setLinking(false); }
    };

    const filtered = items.filter(i => {
        if (!search) return true;
        const s = search.toLowerCase();
        return i.productName.toLowerCase().includes(s) ||
            i.lots.some(l => l.lotNumber?.toLowerCase().includes(s));
    });

    const totalStock = filtered.reduce((a, i) => a + i.totalStock, 0);
    const totalLots = filtered.reduce((a, i) => a + i.lotCount, 0);
    const unlinkedItems = filtered.filter(i => i.unlinked);
    const lowItems = filtered.filter(i => {
        const avgInitial = i.lots.reduce((a, l) => a + l.initialQuantity, 0);
        return avgInitial > 0 && i.totalStock / avgInitial < 0.2;
    });
    // Sort: unlinked first, then alphabetical
    const sorted = [...filtered].sort((a, b) => {
        if (a.unlinked && !b.unlinked) return -1;
        if (!a.unlinked && b.unlinked) return 1;
        return a.productName.localeCompare(b.productName);
    });

    return (
        <>
            {/* Summary */}
            <div style={S.summaryCards}>
                <div style={S.summaryCard(zone === 'WAREHOUSE' ? 'blue' : 'green')}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        Productos
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{filtered.length}</div>
                </div>
                <div style={S.summaryCard(zone === 'WAREHOUSE' ? 'blue' : 'green')}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        Lotes Activos
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{totalLots}</div>
                </div>
                <div style={S.summaryCard('yellow')}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> Stock Bajo
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: lowItems.length > 0 ? '#dc2626' : '#166534' }}>
                        {lowItems.length}
                    </div>
                </div>
                {unlinkedItems.length > 0 && (
                    <div style={{ ...S.summaryCard('yellow'), background: '#fef2f2', border: '1px solid #fca5a5' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                            ⚠️ Sin Vincular
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#dc2626' }}>
                            {unlinkedItems.length}
                        </div>
                    </div>
                )}
            </div>

            {/* Search */}
            <div style={S.card}>
                <div style={S.searchWrap}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                            type="text" value={search} onChange={e => onSearchChange(e.target.value)}
                            placeholder="Buscar producto o lote..."
                            style={S.searchInput}
                        />
                    </div>
                </div>

                {/* Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', width: 30 }}></th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Producto</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Stock</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Lotes</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Estado</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Últ. Ingreso</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>Últ. Consumo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Cargando...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Sin productos en esta zona</td></tr>
                        ) : sorted.map((item) => {
                            const itemKey = item.productId || `unlinked_${item.lots[0]?.id}`;
                            const isExp = expanded === itemKey;
                            const avgInit = item.lots.reduce((a, l) => a + l.initialQuantity, 0);
                            const level = avgInit > 0 && item.totalStock / avgInit < 0.1 ? 'critical'
                                : avgInit > 0 && item.totalStock / avgInit < 0.3 ? 'low' : 'ok';

                            return (
                                <React.Fragment key={itemKey}>
                                    <tr
                                        onClick={() => setExpanded(isExp ? null : itemKey)}
                                        style={{
                                            borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                                            background: item.unlinked ? (isExp ? '#fef9c3' : '#fffbeb') : (isExp ? '#f8fafc' : '#fff'),
                                            transition: 'background .1s'
                                        }}
                                        onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = item.unlinked ? '#fef3c7' : '#fafafa'; }}
                                        onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = item.unlinked ? '#fffbeb' : '#fff'; }}
                                    >
                                        <td style={{ padding: '10px 10px 10px 14px', color: '#94a3b8' }}>
                                            {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </td>
                                        <td style={{ padding: '10px 14px', fontWeight: 700, color: item.unlinked ? '#d97706' : '#1e293b', maxWidth: 280 }}>
                                            {item.unlinked && <span style={{ marginRight: 6, fontSize: '0.8rem' }}>⚠️</span>}
                                            {item.productName}
                                            {item.unlinked && <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: 500, color: '#b45309' }}>Sin producto vinculado — click para vincular</span>}
                                        </td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: '0.95rem', color: level === 'critical' ? '#dc2626' : level === 'low' ? '#d97706' : '#1e293b' }}>
                                            {fmtQty(item.totalStock, item.unit)}
                                        </td>
                                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                            <span style={S.badge('gray')}>{item.lotCount} lote{item.lotCount !== 1 ? 's' : ''}</span>
                                        </td>
                                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                            {item.unlinked ? (
                                                <span style={S.badge('red')}>🔗 Vincular</span>
                                            ) : (
                                                <span style={S.badge(level === 'critical' ? 'red' : level === 'low' ? 'yellow' : 'green')}>
                                                    {level === 'critical' ? '⚠️ Crítico' : level === 'low' ? '⚡ Bajo' : '✅ OK'}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.8rem', color: '#64748b' }}>
                                            {timeAgo(item.lastReceived)}
                                        </td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.8rem', color: '#64748b' }}>
                                            {timeAgo(item.lastConsumed)}
                                        </td>
                                    </tr>
                                    {/* Expanded lot details */}
                                    {isExp && (
                                        <>
                                            {/* Link UI for unlinked items */}
                                            {item.unlinked && (
                                                <tr style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                                                    <td></td>
                                                    <td colSpan="6" style={{ padding: '10px 14px' }}>
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#92400e' }}>Vincular a producto:</span>
                                                            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                                                                <input
                                                                    type="text" value={productSearch}
                                                                    onChange={e => searchProducts(e.target.value)}
                                                                    placeholder="Buscar producto..."
                                                                    style={{ width: '100%', padding: '6px 10px', border: '1px solid #fbbf24', borderRadius: 6, fontSize: '0.8rem', outline: 'none' }}
                                                                />
                                                                {productResults.length > 0 && (
                                                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 200, overflowY: 'auto' }}>
                                                                        {productResults.map(p => (
                                                                            <div key={p.id}
                                                                                onClick={(e) => { e.stopPropagation(); item.lots.forEach(l => handleLink(l.id, p.id)); }}
                                                                                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}
                                                                                onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'}
                                                                                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                                                                            >
                                                                                <span style={{ fontWeight: 600 }}>{p.name}</span>
                                                                                <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{p.sku}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {linking && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Vinculando...</span>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            {item.lots.map((lot) => (
                                                <tr key={lot.id} style={{ background: item.unlinked ? '#fffbeb' : '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                                    <td></td>
                                                    <td style={{ padding: '6px 14px 6px 28px' }}>
                                                        <span style={S.lotBadge}>{lot.lotNumber || '—'}</span>
                                                        {item.unlinked && lot.siigoProductName && (
                                                            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#92400e' }}>{lot.siigoProductName}</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 600, color: '#475569', fontSize: '0.82rem' }}>
                                                        {fmtQty(lot.currentQuantity, item.unit)}
                                                        <span style={{ color: '#cbd5e1', fontWeight: 400, fontSize: '0.72rem' }}> / {fmtQty(lot.initialQuantity, item.unit)}</span>
                                                    </td>
                                                    <td style={{ padding: '6px 14px', textAlign: 'center' }}>
                                                        <span style={S.badge(
                                                            stockLevel(lot.currentQuantity, lot.initialQuantity) === 'critical' ? 'red'
                                                                : stockLevel(lot.currentQuantity, lot.initialQuantity) === 'low' ? 'yellow' : 'green'
                                                        )}>
                                                            {Math.round((lot.currentQuantity / (lot.initialQuantity || 1)) * 100)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '6px 14px', textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                        {lot.status === 'LOW_STOCK' ? '⚡ Bajo' : '✅'}
                                                    </td>
                                                    <td style={{ padding: '6px 14px', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                        {fmtDate(lot.receivedAt)}
                                                    </td>
                                                    <td style={{ padding: '6px 14px', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                        {lot.expiresAt ? `Vence: ${fmtDate(lot.expiresAt)}` : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
};

/* ─── Movements Table (existing traceability) ────────────────── */
const MovementsTable = ({ data, loading }) => {
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(50);

    // Reset page when data changes
    useEffect(() => { setPage(1); }, [data]);

    if (loading) return <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Cargando...</div>;
    if (data.length === 0) return <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Sin registros</div>;


    // Compute running balance per PRODUCT — data is sorted DESC by date
    const lotSeen = {};
    const prodBalance = {};
    data.forEach(c => {
        const prodKey = c.materialLot?.siigoProductName || c.id;
        const lotKey = c.materialLot?.lotNumber || c.id;
        const k = `${prodKey}::${lotKey}`;
        if (!lotSeen[k]) {
            lotSeen[k] = true;
            prodBalance[prodKey] = (prodBalance[prodKey] || 0) + (c.materialLot?.currentQuantity ?? 0);
        }
    });
    const rows = data.map(c => {
        const prodKey = c.materialLot?.siigoProductName || c.id;
        const isPositive = c.type === 'INGRESS' || c.type === 'PRODUCTION';
        const qty = Math.abs(c.quantity || c.quantityUsed || 0);
        const balanceAfter = prodBalance[prodKey] ?? null;
        if (typeof balanceAfter === 'number') {
            prodBalance[prodKey] = isPositive ? balanceAfter - qty : balanceAfter + qty;
        }
        return { ...c, _balance: balanceAfter, _isPositive: isPositive, _qty: qty };
    });

    // Pagination
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    const pagedRows = rows.slice((page - 1) * perPage, page * perPage);

    return (
        <div style={S.card}>
            {/* Pagination header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                    {rows.length.toLocaleString()} registros
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                        value={perPage}
                        onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
                        style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.78rem', background: '#fff' }}
                    >
                        <option value={50}>50/pág</option>
                        <option value={100}>100/pág</option>
                        <option value={200}>200/pág</option>
                    </select>
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.78rem', fontWeight: 600 }}
                    >
                        <ChevronLeft size={14} /> Ant
                    </button>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>
                        {page} / {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.78rem', fontWeight: 600 }}
                    >
                        Sig <ChevronRight size={14} />
                    </button>
                </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        {['Producto', 'Lote', 'Ingreso', 'Egreso', 'Restante', 'Operario', 'Proceso', 'Batch', 'Fecha'].map(h => (
                            <th key={h} style={{
                                padding: '10px 12px', textAlign: ['Ingreso','Egreso','Restante'].includes(h) ? 'right' : 'left',
                                fontWeight: 700, color: h === 'Ingreso' ? '#16a34a' : h === 'Egreso' ? '#dc2626' : '#475569',
                                fontSize: '0.72rem', textTransform: 'uppercase'
                            }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {pagedRows.map((c, idx) => (
                        <tr key={c.id || idx} style={{ borderBottom: '1px solid #f1f5f9', background: c._isPositive ? '#f0fdf4' : idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1e293b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.materialLot?.siigoProductName || '—'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                                {c.materialLot?.lotNumber ? (
                                    <span style={S.lotBadge}>{c.materialLot.lotNumber}</span>
                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: '0.85rem' }}>
                                {c._isPositive ? `+${Math.round(c._qty).toLocaleString()} g` : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#dc2626', fontSize: '0.85rem' }}>
                                {!c._isPositive ? `-${Math.round(c._qty).toLocaleString()} g` : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: c._balance <= 0 ? '#94a3b8' : '#475569', fontSize: '0.82rem' }}>
                                {typeof c._balance === 'number' ? `${Math.round(c._balance).toLocaleString()} g` : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: '0.76rem', color: '#475569' }}>
                                {c.usedBy?.name || (c.type === 'INGRESS' ? '📥 Compra' : c.type === 'PRODUCTION' ? '🏭 Auto' : '—')}
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: '0.76rem', color: '#475569', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.processInfo?.stageName || '—'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                                {c.processInfo?.productionBatch?.batchNumber ? (
                                    <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 4, background: '#f3e8ff', color: '#7c3aed', fontWeight: 700, fontFamily: 'monospace' }}>
                                        {c.processInfo.productionBatch.batchNumber}
                                    </span>
                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: '0.76rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                {fmtDate(c.date || c.usedAt)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {/* Pagination footer */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid #f1f5f9' }}>
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                        <ChevronLeft size={14} /> Anterior
                    </button>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>
                        Página {page} de {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                        Siguiente <ChevronRight size={14} />
                    </button>
                </div>
            )}
        </div>
    );
};

/* ─── Batch-Grouped View ─────────────────────────────────────── */
const BatchGroupedView = ({ data, allMovements, loading }) => {
    const [expanded, setExpanded] = useState({});

    if (loading) return <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Cargando...</div>;
    if (data.length === 0) return <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Sin registros</div>;

    // Group by batch number
    const groups = {};
    data.forEach(c => {
        const batch = c.processInfo?.productionBatch?.batchNumber || null;
        const key = batch || '__sin_batch__';
        if (!groups[key]) groups[key] = { batch: batch, rows: [] };
        groups[key].rows.push(c);
    });

    // Sort: named batches first (newest first), then "sin batch" at end
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === '__sin_batch__') return 1;
        if (b === '__sin_batch__') return -1;
        const dateA = groups[a].rows[0]?.date || groups[a].rows[0]?.usedAt;
        const dateB = groups[b].rows[0]?.date || groups[b].rows[0]?.usedAt;
        return new Date(dateB) - new Date(dateA);
    });

    const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }));

    const typeLabel = (t) => {
        switch(t) {
            case 'CONSUMPTION': return '🔴 Consumo';
            case 'INGRESS': return '📥 Ingreso';
            case 'PRODUCTION': return '🏭 Producción';
            case 'TRANSFER_OUT': return '↗️ Salida';
            case 'TRANSFER_IN': return '↙️ Entrada';
            default: return t;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, padding: '0 4px' }}>
                {sortedKeys.filter(k => k !== '__sin_batch__').length} batches · {data.length.toLocaleString()} movimientos totales
            </div>
            {sortedKeys.map(key => {
                const g = groups[key];
                const isOpen = expanded[key] !== false; // default open for first 3
                const rows = [...g.rows].sort((a, b) => new Date(a.date || a.usedAt) - new Date(b.date || b.usedAt));
                const isSinBatch = key === '__sin_batch__';

                // Stats
                const consumed = rows.filter(r => r.type === 'CONSUMPTION').reduce((s, r) => s + Math.abs(r.quantity || r.quantityUsed || 0), 0);
                const produced = rows.filter(r => r.type === 'PRODUCTION' || r.type === 'INGRESS').reduce((s, r) => s + Math.abs(r.quantity || 0), 0);
                const operators = [...new Set(rows.map(r => r.usedBy?.name).filter(Boolean))];
                const processes = [...new Set(rows.map(r => r.processInfo?.stageName).filter(Boolean))];
                const products = [...new Set(rows.map(r => r.materialLot?.siigoProductName).filter(Boolean))];
                const dateRange = rows.length ? `${fmtDate(rows[0].date || rows[0].usedAt)} → ${fmtDate(rows[rows.length-1].date || rows[rows.length-1].usedAt)}` : '';

                return (
                    <div key={key} style={{ ...S.card, overflow: 'hidden' }}>
                        {/* Batch Header */}
                        <button
                            onClick={() => toggle(key)}
                            style={{
                                width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left',
                                padding: '14px 16px',
                                background: isSinBatch ? '#fefce8' : 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)',
                                color: isSinBatch ? '#92400e' : '#fff',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{
                                        fontSize: '0.9rem', fontWeight: 800, fontFamily: 'monospace',
                                        background: isSinBatch ? '#fde68a' : 'rgba(255,255,255,0.2)',
                                        padding: '2px 10px', borderRadius: 6
                                    }}>
                                        {isSinBatch ? '⚠️ Sin Batch' : g.batch}
                                    </span>
                                    <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>{rows.length} mov.</span>
                                    <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{dateRange}</span>
                                </div>
                                {!isSinBatch && (
                                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '0.72rem', opacity: 0.85, flexWrap: 'wrap' }}>
                                        {consumed > 0 && <span>🔴 {Math.round(consumed).toLocaleString()}g consumido</span>}
                                        {produced > 0 && <span>🟢 {Math.round(produced).toLocaleString()}g producido</span>}
                                        {operators.length > 0 && <span>👤 {operators.slice(0, 3).join(', ')}</span>}
                                        {processes.length > 0 && <span>⚙️ {processes.length} etapas</span>}
                                    </div>
                                )}
                            </div>
                            {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>

                        {/* Expanded rows */}
                        {isOpen && (() => {
                            // Build ingress lookup: materialLotId → ingress row
                            const ingressByLotId = {};
                            (allMovements || data).forEach(r => {
                                if ((r.type === 'INGRESS' || r.type === 'PRODUCTION') && r.materialLotId) {
                                    ingressByLotId[r.materialLotId] = r;
                                }
                            });

                            // Collect consumed lotIds in this batch
                            const consumedLotIds = new Set();
                            rows.forEach(r => {
                                if (r.type === 'CONSUMPTION' && r.materialLotId) consumedLotIds.add(r.materialLotId);
                            });

                            // Enrich rows: add ingress records for consumed lots (if not already present)
                            const rowIds = new Set(rows.map(r => r.id));
                            const enrichedRows = [...rows];
                            consumedLotIds.forEach(lotId => {
                                const ingressRow = ingressByLotId[lotId];
                                if (ingressRow && !rowIds.has(ingressRow.id)) {
                                    enrichedRows.push(ingressRow);
                                }
                            });
                            enrichedRows.sort((a, b) => new Date(a.date || a.usedAt) - new Date(b.date || b.usedAt));

                            // Build per-ingredient balance from enriched rows
                            const balanceMap = {};
                            enrichedRows.forEach(r => {
                                const name = r.materialLot?.siigoProductName;
                                if (!name) return;
                                if (!balanceMap[name]) balanceMap[name] = { ingress: 0, consumption: 0, lots: new Set(), initialQty: 0, currentQty: 0, seenLots: new Set() };
                                const qty = Math.abs(r.quantity || r.quantityUsed || 0);
                                const isIn = r.type === 'INGRESS' || r.type === 'PRODUCTION' || r.type === 'TRANSFER_IN';
                                if (isIn) balanceMap[name].ingress += qty;
                                else balanceMap[name].consumption += qty;
                                if (r.materialLot?.lotNumber) balanceMap[name].lots.add(r.materialLot.lotNumber);
                                // Track initial/current per unique lot
                                const lotKey = r.materialLotId || r.materialLot?.id;
                                if (lotKey && !balanceMap[name].seenLots.has(lotKey)) {
                                    balanceMap[name].seenLots.add(lotKey);
                                    balanceMap[name].initialQty += (r.materialLot?.initialQuantity || 0);
                                    balanceMap[name].currentQty += (r.materialLot?.currentQuantity || 0);
                                }
                            });
                            const balanceRows = Object.entries(balanceMap)
                                .map(([name, v]) => ({ name, ...v, balance: v.ingress - v.consumption, lotCount: v.lots.size }))
                                .sort((a, b) => Math.abs(a.balance) > Math.abs(b.balance) ? -1 : 1);
                            const discrepancies = balanceRows.filter(r => Math.abs(r.balance) > 1);

                            return (
                            <div style={{ padding: 0 }}>
                                {/* Per-ingredient Balance Summary */}
                                <div style={{ borderBottom: '2px solid #e2e8f0' }}>
                                    <div style={{ padding: '10px 14px', background: '#f8fafc' }}>
                                        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>
                                            📊 Balance por Ingrediente
                                        </span>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                                        <thead>
                                            <tr style={{ background: '#f1f5f9' }}>
                                                <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Ingrediente</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Lotes</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.68rem', textTransform: 'uppercase' }}>Salida</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: '#3b82f6', fontSize: '0.68rem', textTransform: 'uppercase' }}>Saldo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {balanceRows.map(row => {
                                                const salida = row.consumption;
                                                const saldo = row.currentQty;
                                                return (
                                                    <tr key={row.name} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        <td style={{ padding: '5px 12px', fontWeight: 600, color: '#1e293b', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {row.name}
                                                        </td>
                                                        <td style={{ padding: '5px 12px', textAlign: 'center' }}>
                                                            <span style={S.lotBadge}>{row.lotCount}</span>
                                                        </td>
                                                        <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                                                            {salida > 0 ? `${Math.round(salida).toLocaleString()} g` : '—'}
                                                        </td>
                                                        <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 800, fontSize: '0.82rem', color: saldo > 0 ? '#3b82f6' : saldo === 0 ? '#94a3b8' : '#dc2626' }}>
                                                            {Math.round(saldo).toLocaleString()} g
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Tipo</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Producto</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Lote</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Cantidad</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Proceso</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Operario</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Fecha</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {enrichedRows.map((c, idx) => {
                                            const isPositive = c.type === 'INGRESS' || c.type === 'PRODUCTION' || c.type === 'TRANSFER_IN';
                                            const qty = Math.abs(c.quantity || c.quantityUsed || 0);
                                            return (
                                                <tr key={c.id || idx} style={{ borderBottom: '1px solid #f1f5f9', background: isPositive ? '#f0fdf4' : idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                                                    <td style={{ padding: '6px 12px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{typeLabel(c.type)}</td>
                                                    <td style={{ padding: '6px 12px', fontWeight: 600, color: '#1e293b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {c.materialLot?.siigoProductName || '—'}
                                                    </td>
                                                    <td style={{ padding: '6px 12px' }}>
                                                        {c.materialLot?.lotNumber ? <span style={S.lotBadge}>{c.materialLot.lotNumber}</span> : '—'}
                                                    </td>
                                                    <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 800, color: isPositive ? '#16a34a' : '#dc2626', fontSize: '0.82rem' }}>
                                                        {isPositive ? '+' : '-'}{Math.round(qty).toLocaleString()} g
                                                    </td>
                                                    <td style={{ padding: '6px 12px', fontSize: '0.72rem', color: '#475569', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {c.processInfo?.stageName || c.observations || '—'}
                                                    </td>
                                                    <td style={{ padding: '6px 12px', fontSize: '0.72rem', color: '#475569' }}>
                                                        {c.usedBy?.name || '—'}
                                                    </td>
                                                    <td style={{ padding: '6px 12px', fontSize: '0.72rem', color: '#64748b', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                        {fmtDate(c.date || c.usedAt)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                        })()}
                    </div>
                );
            })}
        </div>
    );
};

/* ─── Main Page ───────────────────────────────────────────────── */
const LotTraceabilityPage = () => {
    const [activeTab, setActiveTab] = useState('WAREHOUSE');
    const [stockData, setStockData] = useState({ WAREHOUSE: [], PRODUCTION: [] });
    const [movements, setMovements] = useState([]);
    const [unassignedProducts, setUnassignedProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [movFilters, setMovFilters] = useState({ search: '', startDate: '', endDate: '', zone: '' });
    const [showMovFilters, setShowMovFilters] = useState(false);
    const [movViewMode, setMovViewMode] = useState('list'); // 'list' | 'batch'

    const loadStock = async () => {
        setLoading(true);
        try {
            const res = await api.get('/inventory/lots/stock-by-zone');
            setStockData(res.data);
        } catch (err) {
            console.error('Stock load error:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadMovements = async (zoneOverride) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (movFilters.startDate) params.append('startDate', movFilters.startDate);
            if (movFilters.endDate) params.append('endDate', movFilters.endDate);
            const z = zoneOverride || movFilters.zone;
            if (z) params.append('zone', z);
            params.append('limit', '1000');
            const res = await api.get(`/inventory/lots/traceability?${params}`);
            setMovements(res.data);
        } catch (err) {
            console.error('Movements load error:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadUnassigned = async () => {
        setLoading(true);
        try {
            const res = await api.get('/inventory/lots/products-without-lots');
            setUnassignedProducts(res.data || []);
        } catch (err) {
            console.error('Unassigned load error:', err);
        } finally { setLoading(false); }
    };

    useEffect(() => {
        if (activeTab === 'MOV_PRODUCTION') loadMovements('PRODUCTION');
        else if (activeTab === 'MOV_WAREHOUSE') loadMovements('WAREHOUSE');
        else if (activeTab === 'UNASSIGNED') loadUnassigned();
        else loadStock();
    }, [activeTab]);

    const exportCSV = () => {
        const isMovements = activeTab === 'MOV_PRODUCTION' || activeTab === 'MOV_WAREHOUSE';
        const zone = isMovements ? (activeTab === 'MOV_PRODUCTION' ? 'Mov_Produccion' : 'Mov_Bodega') : activeTab === 'WAREHOUSE' ? 'Bodega' : 'Produccion';
        if (isMovements) {
            const headers = ['Fecha', 'Tipo', 'Producto', 'Lote', 'Zona', 'Cantidad', 'Operario', 'Proceso', 'Batch'];
            const rows = movements.map(c => {
                const qty = c.quantity || (c.quantityUsed ? -c.quantityUsed : 0);
                return [
                    new Date(c.date || c.usedAt).toLocaleString('es-CO'),
                    c.type, c.materialLot?.siigoProductName, c.materialLot?.lotNumber,
                    c.zone === 'PRODUCTION' ? 'Producción' : c.zone === 'WAREHOUSE' ? 'Bodega' : '',
                    qty, c.usedBy?.name || '', c.processInfo?.stageName || '',
                    c.processInfo?.productionBatch?.batchNumber || ''
                ];
            });
            const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
            downloadCSV(csv, `movimientos_${zone}`);
        } else {
            const items = stockData[activeTab] || [];
            const headers = ['Producto', 'Stock', 'Unidad', 'Lotes', 'Últ. Ingreso', 'Últ. Consumo'];
            const rows = items.map(i => [
                i.productName, i.totalStock, i.unit, i.lotCount,
                i.lastReceived ? new Date(i.lastReceived).toLocaleString('es-CO') : '',
                i.lastConsumed ? new Date(i.lastConsumed).toLocaleString('es-CO') : ''
            ]);
            const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
            downloadCSV(csv, `stock_${zone}`);
        }
    };

    const downloadCSV = (csv, name) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    };

    const filteredMovements = movements.filter(c => {
        if (!movFilters.search) return true;
        const s = movFilters.search.toLowerCase();
        return (
            c.materialLot?.siigoProductName?.toLowerCase().includes(s) ||
            c.materialLot?.lotNumber?.toLowerCase().includes(s) ||
            c.usedBy?.name?.toLowerCase().includes(s) ||
            c.processInfo?.stageName?.toLowerCase().includes(s) ||
            c.processInfo?.productionBatch?.batchNumber?.toLowerCase().includes(s)
        );
    });

    const tabs = [
        { key: 'WAREHOUSE', label: 'Bodega', icon: <Package size={15} />, count: stockData.WAREHOUSE?.length || 0 },
        { key: 'PRODUCTION', label: 'Producción', icon: <Factory size={15} />, count: stockData.PRODUCTION?.length || 0 },
        { key: 'MOV_PRODUCTION', label: 'Mov. Producción', icon: <List size={15} /> },
        { key: 'MOV_WAREHOUSE', label: 'Mov. Bodega', icon: <List size={15} /> },
        { key: 'UNASSIGNED', label: 'Sin Lotes', icon: <PackageOpen size={15} />, count: unassignedProducts.length, alert: unassignedProducts.length > 0 }
    ];

    return (
        <div style={S.page}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                    📦 Inventario y Trazabilidad
                </h1>
                <button onClick={exportCSV} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px',
                    borderRadius: 8, border: 'none', background: '#16a34a', fontSize: '0.82rem',
                    fontWeight: 700, cursor: 'pointer', color: '#fff'
                }}>
                    <Download size={14} /> CSV
                </button>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 14px', lineHeight: 1.5 }}>
                <strong>Bodega</strong> y <strong>Producción</strong>: stock actual agrupado por producto con lotes activos.
                {' '}<strong>Movimientos</strong>: historial de entradas y consumos.
                {' '}<strong>Sin Lotes</strong>: productos con stock en Siigo pero sin lotes asignados — requieren lotificación.
            </p>

            {/* Tabs */}
            <div style={S.tabs}>
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)} style={S.tab(activeTab === t.key)}>
                        {t.icon}
                        <span>{t.label}</span>
                        {t.count !== undefined && (
                            <span style={{
                                background: t.alert ? '#fef2f2' : activeTab === t.key ? '#4f46e5' : '#e2e8f0',
                                color: t.alert ? '#dc2626' : activeTab === t.key ? '#fff' : '#64748b',
                                border: t.alert ? '1px solid #fca5a5' : 'none',
                                padding: '1px 7px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 800
                            }}>{t.count}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div style={{ marginTop: 16 }}>
                {activeTab === 'WAREHOUSE' && (
                    <StockTable
                        items={stockData.WAREHOUSE || []}
                        loading={loading}
                        zone="WAREHOUSE"
                        search={search}
                        onSearchChange={setSearch}
                        onRefresh={loadStock}
                    />
                )}
                {activeTab === 'PRODUCTION' && (
                    <StockTable
                        items={stockData.PRODUCTION || []}
                        loading={loading}
                        zone="PRODUCTION"
                        search={search}
                        onSearchChange={setSearch}
                        onRefresh={loadStock}
                    />
                )}
                {(activeTab === 'MOV_PRODUCTION' || activeTab === 'MOV_WAREHOUSE') && (
                    <>
                        {/* Filters */}
                        <div style={{ ...S.card, marginBottom: 12, padding: 12 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div style={{ position: 'relative', flex: 2, minWidth: 180 }}>
                                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text" value={movFilters.search}
                                        onChange={e => setMovFilters(p => ({ ...p, search: e.target.value }))}
                                        placeholder="Producto, lote, operario..."
                                        style={S.searchInput}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>Desde</label>
                                    <input type="date" value={movFilters.startDate}
                                        onChange={e => setMovFilters(p => ({ ...p, startDate: e.target.value }))}
                                        style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.8rem' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>Hasta</label>
                                    <input type="date" value={movFilters.endDate}
                                        onChange={e => setMovFilters(p => ({ ...p, endDate: e.target.value }))}
                                        style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.8rem' }}
                                    />
                                </div>
                                <button onClick={() => loadMovements(activeTab === 'MOV_PRODUCTION' ? 'PRODUCTION' : 'WAREHOUSE')} style={{
                                    padding: '8px 18px', borderRadius: 6, border: 'none',
                                    background: '#4f46e5', color: '#fff', fontSize: '0.8rem',
                                    fontWeight: 700, cursor: 'pointer', flexShrink: 0
                                }}>
                                    Buscar
                                </button>
                                {/* View toggle */}
                                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e2e8f0', flexShrink: 0 }}>
                                    <button
                                        onClick={() => setMovViewMode('list')}
                                        style={{
                                            padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            background: movViewMode === 'list' ? '#4f46e5' : '#fff',
                                            color: movViewMode === 'list' ? '#fff' : '#64748b'
                                        }}
                                    >
                                        <List size={14} /> Lista
                                    </button>
                                    <button
                                        onClick={() => setMovViewMode('batch')}
                                        style={{
                                            padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                                            borderLeft: '1px solid #e2e8f0',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            background: movViewMode === 'batch' ? '#4f46e5' : '#fff',
                                            color: movViewMode === 'batch' ? '#fff' : '#64748b'
                                        }}
                                    >
                                        <Layers size={14} /> Por Batch
                                    </button>
                                </div>
                            </div>
                        </div>
                        {movViewMode === 'list'
                            ? <MovementsTable data={filteredMovements} loading={loading} />
                            : <BatchGroupedView data={filteredMovements} allMovements={movements} loading={loading} />
                        }
                    </>
                )}
                {activeTab === 'UNASSIGNED' && (() => {
                    const s = search.toLowerCase();
                    const filtered = unassignedProducts.filter(p => !s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.groupName?.toLowerCase().includes(s));
                    // Group by groupName
                    const groups = {};
                    filtered.forEach(p => {
                        const g = p.groupName || 'Sin Grupo';
                        if (!groups[g]) groups[g] = [];
                        groups[g].push(p);
                    });
                    const sortedGroups = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));

                    return (
                        <div style={S.card}>
                            <div style={S.searchWrap}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text" value={search} onChange={e => setSearch(e.target.value)}
                                        placeholder="Buscar producto o grupo..."
                                        style={S.searchInput}
                                    />
                                </div>
                            </div>
                            <div style={{ padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: '0.78rem', color: '#92400e' }}>
                                ⚠️ <strong>{unassignedProducts.filter(p => p.status === 'sin_lotes').length}</strong> productos sin lotes
                                {' · '}<strong>{unassignedProducts.filter(p => p.status === 'parcial').length}</strong> con stock nuevo sin lotear.
                                {' '}Agrupados en <strong>{sortedGroups.length}</strong> grupos.
                            </div>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Cargando...</div>
                            ) : filtered.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Todo el stock está loteado 🎉</div>
                            ) : sortedGroups.map(([groupName, prods]) => (
                                <div key={groupName} style={{ marginBottom: 16 }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                                        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                                        borderRadius: '8px 8px 0 0', color: '#fff'
                                    }}>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 800 }}>{groupName}</span>
                                        <span style={{
                                            background: 'rgba(255,255,255,0.25)', padding: '1px 8px',
                                            borderRadius: 10, fontSize: '0.7rem', fontWeight: 700
                                        }}>{prods.length}</span>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', border: '1px solid #e2e8f0', borderTop: 'none' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>Producto</th>
                                                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>SKU</th>
                                                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>Stock Siigo</th>
                                                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>Loteado</th>
                                                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.72rem', textTransform: 'uppercase' }}>Pendiente</th>
                                                <th style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase', width: 100 }}>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {prods.map((p, i) => (
                                                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: p.status === 'sin_lotes' ? (i % 2 === 0 ? '#fef2f2' : '#fff') : (i % 2 === 0 ? '#fffbeb' : '#fff') }}>
                                                    <td style={{ padding: '8px 14px', fontWeight: 600, color: p.status === 'sin_lotes' ? '#dc2626' : '#92400e', fontSize: '0.8rem' }}>
                                                        {p.name}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', fontSize: '0.75rem', color: '#64748b' }}>{p.sku}</td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.8rem' }}>
                                                        {Math.round(p.siigoStock).toLocaleString()} {['gramo','gramos','g','kg'].includes((p.unit||'').toLowerCase()) ? 'g' : p.unit}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: p.assignedStock > 0 ? '#16a34a' : '#94a3b8', fontSize: '0.8rem' }}>
                                                        {p.assignedStock > 0 ? `${Math.round(p.assignedStock).toLocaleString()} g` : '—'}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: '#dc2626', fontSize: '0.82rem' }}>
                                                        {Math.round(p.unassignedStock).toLocaleString()} {['gramo','gramos','g','kg'].includes((p.unit||'').toLowerCase()) ? 'g' : p.unit}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                                                        {p.status === 'sin_lotes' 
                                                            ? <span style={S.badge('red')}>🔴 Sin Lotes</span>
                                                            : <span style={{ ...S.badge('yellow'), background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>🟡 Nuevo Stock</span>
                                                        }
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default LotTraceabilityPage;
