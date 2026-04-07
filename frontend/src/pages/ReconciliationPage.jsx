import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Search, Package, Factory, ShoppingCart, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import api from '../services/api';

const TABS = [
    { key: 'stock', label: '📊 Stock', icon: Package },
    { key: 'production', label: '🏭 Producción', icon: Factory },
    { key: 'sales', label: '💰 Ventas', icon: ShoppingCart },
];

const CLASS_OPTIONS = [
    { value: '', label: 'Todas' },
    { value: 'PRODUCTO_TERMINADO', label: 'Prod. Terminado' },
    { value: 'MATERIA_PRIMA', label: 'Materia Prima' },
    { value: 'PRODUCTO_EN_PROCESO', label: 'En Proceso' },
];

const StatusBadge = ({ status }) => {
    const cfg = {
        OK: { bg: '#dcfce7', color: '#15803d', icon: CheckCircle2, text: 'Cuadra' },
        WARN: { bg: '#fef9c3', color: '#a16207', icon: AlertTriangle, text: 'Aprox.' },
        ERROR: { bg: '#fee2e2', color: '#dc2626', icon: XCircle, text: 'Diferencia' },
        SYNCED: { bg: '#dcfce7', color: '#15803d', icon: CheckCircle2, text: 'Sincronizado' },
        PENDING: { bg: '#f1f5f9', color: '#64748b', icon: Minus, text: 'Pendiente' },
        RUNNING: { bg: '#dbeafe', color: '#1d4ed8', icon: RefreshCw, text: 'En proceso' },
    };
    const c = cfg[status] || cfg.PENDING;
    const Icon = c.icon;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: c.bg, color: c.color, fontSize: '0.72rem', fontWeight: 700 }}>
            <Icon size={12} /> {c.text}
        </span>
    );
};

const DiffCell = ({ value, unit }) => {
    if (value === 0) return <span style={{ color: '#94a3b8', fontWeight: 600 }}>0</span>;
    const isPos = value > 0;
    const Icon = isPos ? TrendingUp : TrendingDown;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: isPos ? '#059669' : '#dc2626', fontWeight: 700, fontSize: '0.82rem' }}>
            <Icon size={13} /> {isPos ? '+' : ''}{value.toLocaleString('es-CO')} {unit || ''}
        </span>
    );
};

const SummaryCard = ({ label, value, color, icon: Icon }) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', border: `2px solid ${color}20`, flex: 1, minWidth: 120 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 900, color, display: 'flex', alignItems: 'center', gap: 6 }}>
            {Icon && <Icon size={18} />} {value}
        </div>
    </div>
);

export default function ReconciliationPage() {
    const [tab, setTab] = useState('stock');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [search, setSearch] = useState('');
    const [classification, setClassification] = useState('');
    const [onlyDiff, setOnlyDiff] = useState(false);
    const [consuming, setConsuming] = useState(null); // productId currently being consumed

    const consumeDiff = async (r) => {
        const qty = Math.abs(r.diff);
        if (!window.confirm(`¿Registrar ${qty} unidades de ${r.sku} como consumidas (vendidas/ajuste)?\nEsto reducirá el stock de la app para cuadrar con Siigo.`)) return;
        setConsuming(r.id);
        try {
            await api.post('/reconciliation/stock/consume-diff', { productId: r.id, qty });
            await fetchData();
        } catch (err) {
            alert(err.response?.data?.error || 'Error al consumir diferencia');
        } finally {
            setConsuming(null);
        }
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            let url;
            if (tab === 'stock') {
                url = `/reconciliation/stock?onlyDiff=${onlyDiff}`;
                if (classification) url += `&classification=${classification}`;
                if (search) url += `&search=${encodeURIComponent(search)}`;
            } else if (tab === 'production') {
                url = `/reconciliation/production?limit=100`;
            } else {
                url = `/reconciliation/sales?months=3`;
                if (classification) url += `&classification=${classification}`;
            }
            const res = await api.get(url);
            setData(res.data);
        } catch (err) {
            console.error('Reconciliation fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [tab, classification, onlyDiff, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const rows = data?.rows || [];
    const summary = data?.summary || {};

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: '#0f172a' }}>
                        🔍 Conciliación Siigo vs App
                    </h1>
                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                        Auto-validación de inventario, producción y ventas
                    </p>
                </div>
                <button
                    onClick={fetchData}
                    disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
                </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => { setTab(t.key); setData(null); }}
                        style={{
                            padding: '10px 18px', borderRadius: '8px 8px 0 0', border: 'none',
                            fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer',
                            background: tab === t.key ? '#4f46e5' : 'transparent',
                            color: tab === t.key ? '#fff' : '#64748b',
                            borderBottom: tab === t.key ? '3px solid #4f46e5' : '3px solid transparent',
                            transition: 'all 0.15s',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Description */}
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, marginBottom: 12, fontSize: '0.78rem', color: '#64748b', fontWeight: 500, lineHeight: 1.5 }}>
                {tab === 'stock' && '📊 Compara el stock de cada producto en Siigo vs lo registrado en la app (Bodega + Producción Terminada + Cuarentena). Agrupado por grupo de inventario Siigo.'}
                {tab === 'production' && '🏭 Verifica que cada batch de producción tenga su nota de ensamble registrada en Siigo vía RPA. Muestra el estado de sincronización.'}
                {tab === 'sales' && '💰 Cruza las ventas registradas en Siigo (facturas) vs el consumo de lotes en la app. Solo productos vendibles (Liquipops y Geniality).'}
            </div>

            {/* Filters */}
            {tab === 'stock' && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }} />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por nombre o SKU..."
                            style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.82rem', outline: 'none' }}
                        />
                    </div>
                    <select value={classification} onChange={e => setClassification(e.target.value)} style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.82rem', fontWeight: 600 }}>
                        {CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.82rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} />
                        Solo diferencias
                    </label>
                </div>
            )}

            {/* Summary Cards */}
            {!loading && data && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    <SummaryCard label="Total" value={summary.total || 0} color="#475569" />
                    {tab === 'production' ? (
                        <>
                            <SummaryCard label="Sincronizados" value={summary.synced || 0} color="#15803d" icon={CheckCircle2} />
                            <SummaryCard label="Pendientes" value={summary.pending || 0} color="#a16207" icon={AlertTriangle} />
                            <SummaryCard label="Con Error" value={summary.error || 0} color="#dc2626" icon={XCircle} />
                        </>
                    ) : (
                        <>
                            <SummaryCard label="Cuadran" value={summary.ok || 0} color="#15803d" icon={CheckCircle2} />
                            <SummaryCard label="Aproximado" value={summary.warn || 0} color="#a16207" icon={AlertTriangle} />
                            <SummaryCard label="Diferencia" value={summary.error || 0} color="#dc2626" icon={XCircle} />
                        </>
                    )}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
                    <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 10px' }} />
                    <div style={{ fontWeight: 600 }}>Cargando datos de conciliación...</div>
                </div>
            )}

            {/* Stock Table — grouped by Siigo inventory group */}
            {!loading && tab === 'stock' && (() => {
                const groups = {};
                rows.forEach(r => {
                    const g = r.group || 'Sin grupo';
                    if (!groups[g]) groups[g] = [];
                    groups[g].push(r);
                });
                const groupNames = Object.keys(groups).sort();

                return (
                    <div>
                        {groupNames.map(gName => {
                            const gRows = groups[gName];
                            const gOk = gRows.filter(r => r.status === 'OK').length;
                            const gErr = gRows.filter(r => r.status === 'ERROR').length;
                            return (
                                <div key={gName} style={{ marginBottom: 16 }}>
                                    <div style={{ padding: '8px 14px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#3730a3' }}>📂 {gName}</span>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 600, display: 'flex', gap: 8 }}>
                                            <span style={{ color: '#15803d' }}>✅ {gOk}</span>
                                            {gErr > 0 && <span style={{ color: '#dc2626' }}>❌ {gErr}</span>}
                                            <span style={{ color: '#6366f1' }}>{gRows.length} productos</span>
                                        </span>
                                    </div>
                                    <div style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px', border: '1px solid #e2e8f0', borderTop: 'none' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                            <thead>
                                                <tr style={{ background: '#f8fafc' }}>
                                                    <th style={thStyle}>SKU</th>
                                                    <th style={thStyle}>Producto</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Stock Siigo</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Bodega</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Prod. Term.</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Cuarentena</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Total App</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Diferencia</th>
                                                    <th style={thStyle}>Estado</th>
                                                    <th style={thStyle}>Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {gRows.map(r => (
                                                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: r.status === 'ERROR' ? '#fff1f2' : r.status === 'WARN' ? '#fefce8' : '#fff' }}>
                                                        <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4f46e5' }}>{r.sku}</span></td>
                                                        <td style={{ ...tdStyle, minWidth: 280 }} title={r.name}>{r.name}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#0369a1' }}>{r.siigoStock.toLocaleString('es-CO')}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#475569' }}>{r.appZones.warehouse || '—'}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#7c3aed' }}>{(r.appZones.terminado + r.appZones.produccion) || '—'}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#a16207' }}>{r.appZones.cuarentena || '—'}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#1e293b' }}>{r.totalApp.toLocaleString('es-CO')}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right' }}><DiffCell value={r.diff} /></td>
                                                        <td style={tdStyle}><StatusBadge status={r.status} /></td>
                                                        <td style={tdStyle}>
                                                            {r.diff < 0 && (
                                                                <button
                                                                    onClick={() => consumeDiff(r)}
                                                                    disabled={consuming === r.id}
                                                                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: consuming === r.id ? '#e2e8f0' : '#f97316', color: '#fff', fontSize: '0.72rem', fontWeight: 700, cursor: consuming === r.id ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                                                                >
                                                                    {consuming === r.id ? '⏳...' : `🧹 Consumir ${Math.abs(r.diff)}`}
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })}
                        {rows.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Sin datos para mostrar</div>
                        )}
                    </div>
                );
            })()}

            {/* Production Table */}
            {!loading && tab === 'production' && (
                <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={thStyle}>Batch</th>
                                <th style={thStyle}>Sabor</th>
                                <th style={thStyle}>Estado Batch</th>
                                <th style={thStyle}>Fecha</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Etapas</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Producido</th>
                                <th style={thStyle}>Siigo</th>
                                <th style={thStyle}>Código Siigo</th>
                                <th style={thStyle}>Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: r.siigoStatus === 'ERROR' ? '#fff1f2' : r.siigoStatus === 'PENDING' ? '#f8fafc' : '#fff' }}>
                                    <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4f46e5' }}>{r.batchNumber}</span></td>
                                    <td style={tdStyle}>{r.flavor || '—'}</td>
                                    <td style={tdStyle}><BatchStatusBadge status={r.status} /></td>
                                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#64748b' }}>{new Date(r.createdAt).toLocaleDateString('es-CO')}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{r.stages}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{r.producedQty != null ? r.producedQty.toLocaleString('es-CO') : '—'}</td>
                                    <td style={tdStyle}><StatusBadge status={r.siigoStatus} /></td>
                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.72rem', color: '#059669' }}>{r.siigoCode || '—'}</td>
                                    <td style={{ ...tdStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dc2626', fontSize: '0.7rem' }} title={r.rpaError}>{r.rpaError || ''}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: 40 }}>Sin datos</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Sales Table — grouped by Siigo inventory group */}
            {!loading && tab === 'sales' && (() => {
                // Group rows by inventory group
                const groups = {};
                rows.forEach(r => {
                    const g = r.group || 'Sin grupo';
                    if (!groups[g]) groups[g] = [];
                    groups[g].push(r);
                });
                const groupNames = Object.keys(groups).sort();

                return (
                    <div>
                        <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '12px 12px 0 0', border: '1px solid #e2e8f0', borderBottom: 'none', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                            Periodo: últimos {summary.periodMonths || 3} meses · {groupNames.length} grupos
                        </div>
                        {groupNames.map(gName => (
                            <div key={gName} style={{ marginBottom: 16 }}>
                                <div style={{ padding: '8px 14px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#3730a3' }}>📂 {gName}</span>
                                    <span style={{ fontSize: '0.72rem', color: '#6366f1', fontWeight: 600 }}>{groups[gName].length} productos</span>
                                </div>
                                <div style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px', border: '1px solid #e2e8f0', borderTop: 'none' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc' }}>
                                                <th style={thStyle}>SKU</th>
                                                <th style={thStyle}>Producto</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Vendido (Siigo)</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Facturas</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Consumido (Lotes)</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Diferencia</th>
                                                <th style={thStyle}>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groups[gName].map(r => (
                                                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: r.status === 'ERROR' ? '#fff1f2' : '#fff' }}>
                                                    <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4f46e5' }}>{r.sku}</span></td>
                                                    <td style={{ ...tdStyle, minWidth: 280 }} title={r.name}>{r.name}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#0369a1' }}>{r.sold.toLocaleString('es-CO')}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', color: '#64748b' }}>{r.invoiceCount}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>{r.consumed.toLocaleString('es-CO')}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}><DiffCell value={r.diff} /></td>
                                                    <td style={tdStyle}><StatusBadge status={r.status} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                        {rows.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Sin ventas en el periodo</div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}

const ClassBadge = ({ c }) => {
    const map = {
        PRODUCTO_TERMINADO: { bg: '#dbeafe', color: '#1d4ed8', label: 'PT' },
        MATERIA_PRIMA: { bg: '#fef3c7', color: '#92400e', label: 'MP' },
        PRODUCTO_EN_PROCESO: { bg: '#ede9fe', color: '#6d28d9', label: 'PP' },
    };
    const cfg = map[c] || { bg: '#f1f5f9', color: '#64748b', label: c || '—' };
    return <span style={{ padding: '2px 6px', borderRadius: 4, background: cfg.bg, color: cfg.color, fontSize: '0.68rem', fontWeight: 700 }}>{cfg.label}</span>;
};

const BatchStatusBadge = ({ status }) => {
    const map = {
        COMPLETED: { bg: '#dcfce7', color: '#15803d' },
        IN_PROGRESS: { bg: '#dbeafe', color: '#1d4ed8' },
        FAILED: { bg: '#fee2e2', color: '#dc2626' },
        PENDING: { bg: '#f1f5f9', color: '#64748b' },
    };
    const cfg = map[status] || map.PENDING;
    return <span style={{ padding: '2px 6px', borderRadius: 4, background: cfg.bg, color: cfg.color, fontSize: '0.68rem', fontWeight: 700 }}>{status}</span>;
};

const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
const tdStyle = { padding: '8px 12px', fontSize: '0.78rem', color: '#1e293b' };
