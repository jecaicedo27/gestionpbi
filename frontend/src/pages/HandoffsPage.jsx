import React, { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Truck, Package, Clock, CheckCircle, AlertCircle, Search, RefreshCw, Send, ListChecks } from 'lucide-react';
import { message, Spin, Modal, Badge, Empty, Table, Button, InputNumber } from 'antd';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const HandoffsPage = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('CREATE'); // CREATE, PENDING, HISTORY
    const [loading, setLoading] = useState(false);

    // Create Handoff State
    const [productionStock, setProductionStock] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedItems, setSelectedItems] = useState({}); // lotNumber -> requestedQty
    const [notes, setNotes] = useState('');
    const [creating, setCreating] = useState(false);

    // Pending Receptions State
    const [pendingHandoffs, setPendingHandoffs] = useState([]);

    // History State
    const [historyHandoffs, setHistoryHandoffs] = useState([]);

    // Roles rules
    const isProduction = ['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING'].includes(user?.role);
    const isLogistics = ['ADMIN', 'LOGISTICA'].includes(user?.role);

    useEffect(() => {
        if (!isProduction && activeTab === 'CREATE') {
            setActiveTab('PENDING');
        }
    }, [user, isProduction, activeTab]);

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'CREATE') {
                const [stockRes, pendingRes] = await Promise.all([
                    api.get('/finished-lots/stock', { params: { zone: 'PRODUCCION' } }),
                    api.get('/handoffs/pending')
                ]);
                const stocks = stockRes.data?.stocks || [];
                // Build set of productId+lotNumber already in a pending handoff
                const inTransit = new Set();
                const inTransitQty = {}; // productId_lotNumber -> qty in transit
                (pendingRes.data?.handoffs || []).forEach(h =>
                    h.items.forEach(i => {
                        const key = `${i.productId}_${i.lotNumber}`;
                        inTransit.add(key);
                        inTransitQty[key] = (inTransitQty[key] || 0) + (i.requestedQuantity || 0);
                    })
                );
                const filtered = stocks.filter(s => s.currentQuantity > 0 && !inTransit.has(`${s.productId}_${s.lotNumber}`));
                // Batch-fetch lot-summary to get approved/defective breakdown from EMPAQUE notes
                const uniqueLots = [...new Set(filtered.map(s => s.lotNumber))];
                const summaryMap = {};
                await Promise.all(uniqueLots.map(async lotNumber => {
                    try {
                        const sumRes = await api.get(`/finished-lots/lot-summary/${lotNumber}`);
                        (sumRes.data || []).forEach(entry => {
                            summaryMap[`${entry.productId}_${lotNumber}`] = { defective: entry.defective || 0, approved: entry.approved ?? null };
                        });
                    } catch(e) { /* non-blocking */ }
                }));
                setProductionStock(filtered.map(s => {
                    const sm = summaryMap[`${s.productId}_${s.lotNumber}`];
                    const key = `${s.productId}_${s.lotNumber}`;
                    // alreadyDelivered = what left this zone = initialQuantity - currentQuantity
                    const alreadyDelivered = Math.max(0, (s.initialQuantity || 0) - (s.currentQuantity || 0));
                    return {
                        ...s,
                        defective: sm?.defective || 0,
                        approved: sm?.approved ?? null,
                        alreadyDelivered,
                        inTransitQty: inTransitQty[key] || 0,
                    };
                }));
                setSelectedItems({});
                setSearchQuery('');
            } else if (activeTab === 'PENDING') {
                const res = await api.get('/handoffs/pending');
                setPendingHandoffs(res.data?.handoffs || []);
            } else if (activeTab === 'HISTORY') {
                const res = await api.get('/handoffs/history');
                setHistoryHandoffs(res.data?.history || []);
            }
        } catch (e) {
            console.error(e);
            message.error('Error cargando datos');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    // ── CREATE HANDOFF LOGIC ──
    const handleQtyChange = (lot, val) => {
        const key = `${lot.productId}_${lot.lotNumber}`;
        setSelectedItems(prev => {
            const next = { ...prev };
            if (val === null || val === undefined || val === 0) {
                delete next[key];
            } else {
                next[key] = {
                    productId: lot.productId,
                    lotNumber: lot.lotNumber,
                    requestedQuantity: val,
                    stockInfo: lot
                };
            }
            return next;
        });
    };

    const submitHandoff = async () => {
        const itemsToSubmit = Object.values(selectedItems);
        if (itemsToSubmit.length === 0) {
            message.warning('Debes empacar al menos un lote para enviar a la bodega.');
            return;
        }

        setCreating(true);
        try {
            const payloadItems = itemsToSubmit.map(i => ({ productId: i.productId, lotNumber: i.lotNumber, requestedQuantity: i.requestedQuantity }));
            await api.post('/handoffs', { items: payloadItems, notes });
            message.success('Acta de entrega enviada a Logística exitosamente.');
            setNotes('');
            loadData();
        } catch (e) {
            message.error(e.response?.data?.error || 'Error al enviar acta de entrega');
        } finally {
            setCreating(false);
        }
    };

    // ── RECEIVE HANDOFF LOGIC (Modal) ──
    const [receiveModal, setReceiveModal] = useState({ open: false, handoff: null, items: [] });
    const [receiving, setReceiving] = useState(false);

    const openReceiveModal = (handoff) => {
        // Pre-fill quantities with requested
        const prefilled = handoff.items.map(i => ({
            ...i,
            receivedQuantity: i.requestedQuantity
        }));
        setReceiveModal({ open: true, handoff, items: prefilled });
    };

    const handleReceiveQtyChange = (itemId, val) => {
        setReceiveModal(prev => ({
            ...prev,
            items: prev.items.map(i => i.id === itemId ? { ...i, receivedQuantity: val || 0 } : i)
        }));
    };

    const submitReception = async () => {
        setReceiving(true);
        try {
            const payload = receiveModal.items.map(i => ({ itemId: i.id, receivedQuantity: i.receivedQuantity }));
            await api.post(`/handoffs/${receiveModal.handoff.id}/receive`, { receivedItems: payload });
            message.success('Recepción confirmada. Inventario actualizado en Producto Terminado.');
            setReceiveModal({ open: false, handoff: null, items: [] });
            loadData();
        } catch (e) {
            message.error(e.response?.data?.error || 'Error al procesar recepción');
        } finally {
            setReceiving(false);
        }
    };

    const rejectHandoff = async (handoff) => {
        Modal.confirm({
            title: '¿Rechazar toda el acta?',
            content: 'El inventario seguirá en Producción y Logística no se hará cargo.',
            okText: 'Rechazar Acta',
            okType: 'danger',
            cancelText: 'Cancelar',
            onOk: async () => {
                try {
                    await api.post(`/handoffs/${handoff.id}/reject`, { reason: 'Rechazado por inconsistencia general' });
                    message.success('Acta rechazada');
                    loadData();
                } catch (e) {
                    message.error('Error al rechazar');
                }
            }
        });
    };

    // ── RENDER ──
    return (
        <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Truck size={24} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#1e293b' }}>Entregas a Bodega Central</h1>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>Traspaso formal de inventario empacado de Producción a Producto Terminado</p>
                </div>
                <button onClick={loadData} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                    <RefreshCw size={16} color="#64748b" className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '2px solid #f1f5f9' }}>
                {isProduction && (
                    <button
                        onClick={() => setActiveTab('CREATE')}
                        style={{
                            padding: '10px 16px', border: 'none', background: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                            color: activeTab === 'CREATE' ? '#059669' : '#64748b',
                            borderBottom: activeTab === 'CREATE' ? '3px solid #059669' : '3px solid transparent'
                        }}
                    >
                        <Send size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
                        Enviar Cajas Libres
                    </button>
                )}
                <button
                    onClick={() => setActiveTab('PENDING')}
                    style={{
                        padding: '10px 16px', border: 'none', background: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                        color: activeTab === 'PENDING' ? '#059669' : '#64748b',
                        borderBottom: activeTab === 'PENDING' ? '3px solid #059669' : '3px solid transparent',
                        position: 'relative'
                    }}
                >
                    <ListChecks size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
                    Recepciones Pendientes
                    {pendingHandoffs.length > 0 && activeTab !== 'PENDING' && (
                        <span style={{ position: 'absolute', top: 5, right: -5, background: '#ef4444', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: 20 }}>{pendingHandoffs.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('HISTORY')}
                    style={{
                        padding: '10px 16px', border: 'none', background: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                        color: activeTab === 'HISTORY' ? '#059669' : '#64748b',
                        borderBottom: activeTab === 'HISTORY' ? '3px solid #059669' : '3px solid transparent'
                    }}
                >
                    <Clock size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
                    Historial de Actas
                </button>
            </div>

            <Spin spinning={loading}>
                {/* ── CREATE TAB ── */}
                {activeTab === 'CREATE' && (
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        {/* Box Selection */}
                        <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>📦 Lotes Disponibles en Zona</h2>
                                <div style={{ position: 'relative', width: '240px' }}>
                                    <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 10, top: 10 }} />
                                    <input 
                                        type="text" 
                                        placeholder="Buscar producto o lote..." 
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '0.85rem', outline: 'none' }}
                                    />
                                </div>
                            </div>

                            {productionStock.length === 0 ? (
                                <Empty description="No hay cajas/lotes físicos disponibles en Producción ahora mismo." />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {productionStock
                                        .filter(s => {
                                            if (!searchQuery.trim()) return true;
                                            const q = searchQuery.toLowerCase();
                                            return s.product?.name?.toLowerCase().includes(q) || 
                                                   s.lotNumber?.toLowerCase().includes(q) || 
                                                   s.sku?.toLowerCase().includes(q);
                                        })
                                        .map((s, idx) => {
                                        const itemKey = `${s.productId}_${s.lotNumber}`;
                                        const selectedQty = selectedItems[itemKey]?.requestedQuantity || null;
                                        const isSelected = selectedQty !== null;
                                        const locked = s.assemblyPending === true;
                                        return (
                                            <div key={idx} style={{
                                                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 16px',
                                                border: `1.5px solid ${locked ? '#f97316' : isSelected ? '#10b981' : '#e2e8f0'}`, borderRadius: 10,
                                                background: locked ? '#fff7ed' : isSelected ? '#ecfdf5' : '#fff',
                                                opacity: locked ? 0.85 : 1, transition: 'all 0.2s'
                                            }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                        <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#1e293b' }}>{s.product?.name || s.sku}</span>
                                                        {locked && (
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: '#fed7aa', color: '#9a3412', border: '1px solid #fb923c', whiteSpace: 'nowrap' }}>
                                                                🔒 Ensamble pendiente
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                                                        Lote: <strong style={{ color: '#0f172a' }}>{s.lotNumber}</strong>
                                                        <span style={{ margin: '0 6px' }}>•</span>
                                                        <strong style={{ color: '#059669' }}>✅ {s.approved ?? s.initialQuantity} aprobadas</strong>
                                                        {s.defective > 0 && (
                                                            <span style={{ marginLeft: 8, color: '#b91c1c', fontWeight: 800, fontSize: '0.72rem', background: '#fef2f2', padding: '2px 7px', borderRadius: 4, border: '1px solid #fca5a5' }}>
                                                                ⚠️ {s.defective} en mal estado
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Inventory distribution breakdown */}
                                                    {(s.alreadyDelivered > 0 || s.inTransitQty > 0) && (
                                                        <div style={{ marginTop: 6, padding: '6px 10px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd', fontSize: '0.72rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: '#475569' }}>
                                                                <span style={{ fontWeight: 700, color: '#0284c7' }}>📊 Distribución:</span>
                                                                <span>{s.approved ?? s.initialQuantity} producidas</span>
                                                                {s.alreadyDelivered > 0 && (
                                                                    <>
                                                                        <span style={{ color: '#cbd5e1' }}>→</span>
                                                                        <span style={{ color: '#059669', fontWeight: 700 }}>✅ {s.alreadyDelivered} ya entregadas</span>
                                                                    </>
                                                                )}
                                                                {s.inTransitQty > 0 && (
                                                                    <>
                                                                        <span style={{ color: '#cbd5e1' }}>→</span>
                                                                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>🚚 {s.inTransitQty} en tránsito</span>
                                                                    </>
                                                                )}
                                                                <span style={{ color: '#cbd5e1' }}>→</span>
                                                                <span style={{ color: '#7c3aed', fontWeight: 800 }}>📦 {s.currentQuantity} disponibles aquí</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {locked && (
                                                        <div style={{ fontSize: '0.72rem', color: '#c2410c', marginTop: 4, fontStyle: 'italic' }}>
                                                            ⚠️ Este lote debe finalizarse en el paso de Ensamble Siigo antes de poder enviarse a logística.
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                                                    {!locked && <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Enviar:</span>}
                                                    {(() => { const maxSendable = s.currentQuantity; return (
                                                    <>
                                                    <InputNumber
                                                        min={0}
                                                        max={maxSendable}
                                                        value={locked ? null : selectedQty}
                                                        onChange={val => !locked && handleQtyChange(s, val)}
                                                        placeholder={locked ? '—' : '0'}
                                                        disabled={locked}
                                                        style={{ width: 80 }}
                                                    />
                                                    {isSelected && !locked && (
                                                        <Button type="primary" size="small" onClick={() => handleQtyChange(s, maxSendable)} style={{ background: '#10b981' }}>Max</Button>
                                                    )}
                                                    </>); })()}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Cart Summary */}
                        <div style={{ width: 340, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 12, padding: 20, position: 'sticky', top: 20 }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ListChecks size={20} /> Entregar a Bodega
                            </h2>
                            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, minHeight: 100 }}>
                                {Object.values(selectedItems).length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: '30px 0' }}>Elige cuántas cajas vas a mandar para armar el acta.</div>
                                ) : (
                                    Object.values(selectedItems).map((i, idx) => (
                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                                            <span style={{ fontWeight: 600, color: '#334155', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.stockInfo?.product?.name}</span>
                                            <strong style={{ color: '#10b981' }}>{i.requestedQuantity} uds</strong>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Notas para logística (opcional)</label>
                                <textarea
                                    value={notes} onChange={e => setNotes(e.target.value)}
                                    placeholder="Ej: La caja de Fresa va semi-abierta"
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '0.8rem', resize: 'none', height: 60 }}
                                />
                            </div>
                            <Button
                                type="primary" size="large" block
                                onClick={submitHandoff} loading={creating}
                                disabled={Object.keys(selectedItems).length === 0}
                                style={{ background: '#059669', fontWeight: 800, height: 44, borderRadius: 8 }}
                            >
                                Enviar Acta de Entrega ({Object.keys(selectedItems).length} lotes)
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── PENDING / RECEPTIONS TAB ── */}
                {activeTab === 'PENDING' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {pendingHandoffs.length === 0 ? (
                            <Empty description={isLogistics ? "Genial, no tienes entregas pendientes de revisar." : "No hay entregas en camino."} />
                        ) : (
                            pendingHandoffs.map((handoff) => (
                                <div key={handoff.id} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 20, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
                                        <div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>{handoff.handoffNumber}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>Creado por <strong>{handoff.createdBy?.name || 'Sistema'}</strong> • {new Date(handoff.createdAt).toLocaleString('es-CO')}</div>
                                        </div>
                                        <Badge status="processing" text="Esperando Recepción" color="#f59e0b" style={{ fontWeight: 800, background: '#fef3c7', padding: '6px 12px', borderRadius: 20, border: '1px solid #fcd34d' }} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
                                        {handoff.items.map(item => (
                                            <div key={item.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
                                                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{item.product?.name || 'Producto Desconocido'}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>Lote: <span style={{ fontFamily: 'monospace', color: '#0f172a', fontWeight: 700 }}>{item.lotNumber}</span></div>
                                                <div style={{ fontSize: '0.9rem', color: '#10b981', fontWeight: 900, marginTop: 4 }}>{item.requestedQuantity} uds</div>
                                            </div>
                                        ))}
                                    </div>
                                    {handoff.notes && (
                                        <div style={{ padding: '8px 12px', background: '#fef2f2', borderLeft: '4px solid #ef4444', fontSize: '0.8rem', color: '#7f1d1d', marginBottom: 16 }}>
                                            <strong>Nota de Producción:</strong> {handoff.notes}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                                        {isLogistics && (
                                            <>
                                                <Button danger onClick={() => rejectHandoff(handoff)}>Rechazar Acta</Button>
                                                <Button type="primary" onClick={() => openReceiveModal(handoff)} style={{ background: '#059669', fontWeight: 700 }}>Verificar y Recibir Físico</Button>
                                            </>
                                        )}
                                        {!isLogistics && (
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Logística revisará esta acta.</span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* ── HISTORY TAB ── */}
                {activeTab === 'HISTORY' && (
                    <Table
                        dataSource={historyHandoffs}
                        rowKey="id"
                        pagination={{ pageSize: 20 }}
                        columns={[
                            {
                                title: 'Nº Acta',
                                dataIndex: 'handoffNumber',
                                key: 'num',
                                render: text => <strong style={{ fontFamily: 'monospace' }}>{text}</strong>
                            },
                            {
                                title: 'Fecha',
                                dataIndex: 'createdAt',
                                render: d => new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                            },
                            {
                                title: 'Operario',
                                dataIndex: ['createdBy', 'name'],
                            },
                            {
                                title: 'Recibido por',
                                dataIndex: ['receivedBy', 'name'],
                                render: (t, r) => t ? t : (r.status === 'REJECTED' ? '-' : 'Pendiente')
                            },
                            {
                                title: 'Lotes',
                                render: (_, row) => (
                                    <div style={{ fontSize: '0.75rem' }}>
                                        {row.items.map(i => (
                                            <div key={i.id}>{i.product?.sku} ({i.lotNumber}): {i.receivedQuantity ?? i.requestedQuantity} uds</div>
                                        ))}
                                    </div>
                                )
                            },
                            {
                                title: 'Estado',
                                dataIndex: 'status',
                                render: s => (
                                    <Badge status={s === 'COMPLETED' ? 'success' : 'error'} text={s === 'COMPLETED' ? 'Recibido' : 'Rechazado'} />
                                )
                            }
                        ]}
                    />
                )}
            </Spin>

            {/* Receive Modal Form */}
            <Modal
                title={<div style={{ fontSize: '1.2rem', fontWeight: 900 }}>📦 Recibir Acta {receiveModal.handoff?.handoffNumber}</div>}
                open={receiveModal.open}
                onCancel={() => !receiving && setReceiveModal({ open: false, handoff: null, items: [] })}
                footer={[
                    <Button key="cancel" onClick={() => setReceiveModal({ open: false, handoff: null, items: [] })} disabled={receiving}>Cancelar</Button>,
                    <Button key="submit" type="primary" style={{ background: '#059669', fontWeight: 700 }} onClick={submitReception} loading={receiving}>
                        Confirmar que recibí Físicamente
                    </Button>
                ]}
                width={700}
            >
                <div style={{ padding: '10px 0' }}>
                    <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Confirmaremos la recepción de estas unidades. Si encuentras menos cajas físicas de las enviadas, edita el valor recibido.</p>
                    {receiveModal.items.some(i => i.defective > 0) && (
                        <div style={{ background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 8, padding: '8px 14px', marginBottom: 8, fontSize: '0.8rem', color: '#9a3412', fontWeight: 600 }}>
                            ⚠️ Este acta incluye unidades en mal estado. Recibirlas físicamente y separarlas antes de ingresar a bodega.
                        </div>
                    )}
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
                        {receiveModal.items.map((i) => (
                            <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: `1px solid ${i.defective > 0 ? '#fb923c' : '#e2e8f0'}`, borderRadius: 8, background: i.defective > 0 ? '#fff7ed' : '#f8fafc' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{i.product?.name}</div>
                                    <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#64748b' }}>{i.lotNumber}</div>
                                    {i.defective > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 700, marginTop: 3 }}>⚠️ {i.defective} uds en mal estado incluidas — separar antes de bodega</div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>Producción Envió</div>
                                        <div style={{ fontSize: '1rem', fontWeight: 900, color: '#334155' }}>{i.requestedQuantity}</div>
                                        {i.defective > 0 && (
                                            <div style={{ fontSize: '0.65rem', color: '#b91c1c', fontWeight: 700 }}>({i.requestedQuantity - (i.defective||0)} sanas + {i.defective} defectuosas)</div>
                                        )}
                                    </div>
                                    <div style={{ width: 1, height: 30, background: '#cbd5e1' }} />
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: '#10b981', textTransform: 'uppercase', fontWeight: 800, marginBottom: 4 }}>Recibo Físicamente</div>
                                        <InputNumber 
                                            min={0} 
                                            max={i.requestedQuantity + (i.defective || 0)} 
                                            value={i.receivedQuantity}
                                            onChange={(val) => handleReceiveQtyChange(i.id, val)}
                                            style={{ width: 100, border: '2px solid #10b981' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>

        </div>
    );
};

export default HandoffsPage;
