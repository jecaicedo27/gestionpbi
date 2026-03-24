import React, { useState, useEffect } from 'react';
import { message, Tag, Empty, Spin, Modal } from 'antd';
import { AlertTriangle, Search, Phone, Mail, Package, Truck, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api';

const RecallReportPage = () => {
    const [search, setSearch] = useState('');
    const [report, setReport] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedLot, setExpandedLot] = useState(null);
    const [lotDetail, setLotDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const loadReport = async (query) => {
        setLoading(true);
        try {
            const params = {};
            if (query) params.lotNumber = query;
            const res = await api.get('/finished-lots/recall-report', { params });
            setReport(res.data?.report || []);
        } catch (e) { message.error('Error cargando reporte'); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadReport(); }, []);

    const handleSearch = () => { loadReport(search); };

    const loadLotDetail = async (lotNumber) => {
        if (expandedLot === lotNumber) { setExpandedLot(null); return; }
        setExpandedLot(lotNumber);
        setDetailLoading(true);
        try {
            const res = await api.get(`/finished-lots/by-lot/${encodeURIComponent(lotNumber)}`);
            setLotDetail(res.data?.data || []);
        } catch (e) { message.error('Error cargando detalle'); }
        finally { setDetailLoading(false); }
    };

    const fmtDate = (d) => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

    return (
        <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #ef4444, #dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={26} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>Reporte de Recall</h1>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Trazabilidad lote → distribuidor para retiro de productos</p>
                </div>
            </div>

            {/* Warning banner */}
            <div style={{ background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: 14, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                <AlertTriangle size={20} color="#d97706" />
                <div style={{ fontSize: '0.85rem', color: '#92400e' }}>
                    <strong>¿Necesitas hacer un recall?</strong> Busca el número de lote para ver qué distribuidores lo recibieron y contactarlos.
                </div>
            </div>

            {/* Search */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: '#94a3b8' }} />
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        placeholder="Buscar por número de lote..."
                        style={{ width: '100%', padding: '10px 14px 10px 36px', border: '2px solid #e2e8f0', borderRadius: 12, fontSize: '0.9rem', outline: 'none', fontWeight: 600 }}
                    />
                </div>
                <button onClick={handleSearch} style={{ padding: '10px 24px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Search size={16} /> Buscar
                </button>
                <button onClick={() => { setSearch(''); loadReport(); }} style={{ padding: '10px 16px', border: '2px solid #e2e8f0', borderRadius: 12, background: '#fff', cursor: 'pointer', color: '#64748b' }}>
                    <RefreshCw size={16} />
                </button>
            </div>

            {/* Results */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
            ) : report.length === 0 ? (
                <Empty description="Sin despachos registrados para este lote" style={{ padding: 60 }} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {report.map(lot => (
                        <div key={lot.lotNumber} style={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', transition: 'all 0.2s' }}>
                            {/* Lot header */}
                            <div onClick={() => loadLotDetail(lot.lotNumber)}
                                style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, background: expandedLot === lot.lotNumber ? '#fef2f2' : '#fff' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.9rem' }}>{lot.lotNumber}</Tag>
                                        <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>{lot.productName}</span>
                                        <Tag style={{ fontSize: '0.72rem' }}>{lot.sku}</Tag>
                                    </div>
                                    <div style={{ display: 'flex', gap: 12, fontSize: '0.82rem', color: '#64748b' }}>
                                        <span>📦 <strong>{lot.totalDispatched}</strong> uds despachadas</span>
                                        <span>🧾 <strong>{lot.orderCount}</strong> pedidos</span>
                                        <span>🚚 <strong>{lot.distributors.length}</strong> distribuidores</span>
                                    </div>
                                </div>
                                {expandedLot === lot.lotNumber ? <ChevronUp size={20} color="#94a3b8" /> : <ChevronDown size={20} color="#94a3b8" />}
                            </div>

                            {/* Distributor details */}
                            {expandedLot === lot.lotNumber && (
                                <div style={{ borderTop: '2px solid #fecaca', padding: '16px 20px', background: '#fef2f2' }}>
                                    {detailLoading ? (
                                        <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
                                    ) : (
                                        <>
                                            <h4 style={{ margin: '0 0 12px', fontWeight: 800, fontSize: '0.88rem', color: '#991b1b' }}>
                                                🚨 Distribuidores afectados ({lot.distributors.length})
                                            </h4>
                                            {lot.distributors.length === 0 ? (
                                                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Sin información de distribuidor registrada</p>
                                            ) : (
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                                                    {lot.distributors.map(d => (
                                                        <div key={d.id} style={{ background: '#fff', border: '2px solid #fca5a5', borderRadius: 12, padding: 14 }}>
                                                            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b', marginBottom: 4 }}>
                                                                <Truck size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />{d.name}
                                                            </div>
                                                            {d.email && (
                                                                <div style={{ fontSize: '0.82rem', color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                                                    <Mail size={13} /> {d.email}
                                                                </div>
                                                            )}
                                                            {d.phone && (
                                                                <div style={{ fontSize: '0.82rem', color: '#059669', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                                                    <Phone size={13} /> {d.phone}
                                                                </div>
                                                            )}
                                                            <div style={{ fontSize: '0.78rem', color: '#64748b', borderTop: '1px solid #fee2e2', paddingTop: 6 }}>
                                                                {d.orders.map(o => (
                                                                    <span key={o.id} style={{ marginRight: 8 }}>
                                                                        <Tag color={o.status === 'ENTREGADO' ? 'green' : 'orange'} style={{ fontWeight: 600, fontSize: '0.72rem' }}>
                                                                            #{o.orderNumber} · {o.status}
                                                                        </Tag>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Detailed dispatch records */}
                                            {lotDetail && lotDetail.length > 0 && (
                                                <div style={{ marginTop: 16 }}>
                                                    <h4 style={{ margin: '0 0 8px', fontWeight: 700, fontSize: '0.82rem', color: '#475569' }}>Detalle de despachos</h4>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                                        <thead>
                                                            <tr style={{ background: '#fee2e2' }}>
                                                                <th style={thS}>Fecha</th>
                                                                <th style={thS}>Producto</th>
                                                                <th style={{ ...thS, textAlign: 'right' }}>Cant.</th>
                                                                <th style={thS}>Pedido</th>
                                                                <th style={thS}>Distribuidor</th>
                                                                <th style={thS}>Responsable</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {lotDetail.map(d => (
                                                                <tr key={d.id} style={{ borderBottom: '1px solid #fef2f2' }}>
                                                                    <td style={tdS}>{fmtDate(d.createdAt)}</td>
                                                                    <td style={tdS}>{d.product?.name || '-'}</td>
                                                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{d.quantity}</td>
                                                                    <td style={tdS}>{d.order ? <Tag color="blue">#{d.order.orderNumber}</Tag> : '-'}</td>
                                                                    <td style={tdS}>{d.order?.distributor?.name || '-'}</td>
                                                                    <td style={tdS}>{d.transferredBy?.name || '-'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const thS = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', color: '#991b1b', textTransform: 'uppercase' };
const tdS = { padding: '8px 12px' };

export default RecallReportPage;
