import React, { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Truck, Package, Clock, CheckCircle, AlertCircle, Search, RefreshCw, Send, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
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
    const [historySearch, setHistorySearch] = useState('');
    const [historyStatus, setHistoryStatus] = useState('ALL'); // ALL | COMPLETED | REJECTED

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
                const filtered = stocks.filter(s => {
                    const key = `${s.productId}_${s.lotNumber}`;
                    const transit = inTransitQty[key] || 0;
                    return (s.currentQuantity - transit) > 0;
                });
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
                const mappedStock = filtered.map(s => {
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
                });
                
                setProductionStock(mappedStock);
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
    const [expandedProducts, setExpandedProducts] = useState({});

    const toggleExpand = (productId) => {
        setExpandedProducts(prev => ({ ...prev, [productId]: !prev[productId] }));
    };

    // Group productionStock by productId
    const groupedStock = useMemo(() => {
        const groups = {};
        productionStock.forEach(s => {
            const pid = s.productId;
            if (!groups[pid]) {
                groups[pid] = {
                    productId: pid,
                    productName: s.product?.name || s.sku || 'Desconocido',
                    lots: [],
                    totalAvailable: 0,
                    totalDefective: 0,
                    totalInTransit: 0,
                    hasLocked: false,
                };
            }
            const free = Math.max(0, s.currentQuantity - s.inTransitQty);
            groups[pid].lots.push(s);
            groups[pid].totalAvailable += free;
            groups[pid].totalDefective += s.defective || 0;
            groups[pid].totalInTransit += s.inTransitQty || 0;
            if (s.assemblyPending) groups[pid].hasLocked = true;
        });
        return Object.values(groups).sort((a, b) => a.productName.localeCompare(b.productName));
    }, [productionStock]);

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

    // Send all available for a product group (distribute across lots FIFO)
    const handleSendAllProduct = (group) => {
        setSelectedItems(prev => {
            const next = { ...prev };
            group.lots.forEach(lot => {
                if (lot.assemblyPending) return;
                const free = Math.max(0, lot.currentQuantity - lot.inTransitQty);
                const key = `${lot.productId}_${lot.lotNumber}`;
                if (free > 0) {
                    next[key] = { productId: lot.productId, lotNumber: lot.lotNumber, requestedQuantity: free, stockInfo: lot };
                }
            });
            return next;
        });
    };

    // Clear all selected for a product group
    const handleClearProduct = (group) => {
        setSelectedItems(prev => {
            const next = { ...prev };
            group.lots.forEach(lot => {
                delete next[`${lot.productId}_${lot.lotNumber}`];
            });
            return next;
        });
    };

    // Count selected for a product group
    const getGroupSelectedTotal = (group) => {
        return group.lots.reduce((sum, lot) => {
            const key = `${lot.productId}_${lot.lotNumber}`;
            return sum + (selectedItems[key]?.requestedQuantity || 0);
        }, 0);
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

                            {groupedStock.length === 0 ? (
                                <Empty description="No hay cajas/lotes físicos disponibles en Producción ahora mismo." />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {groupedStock
                                        .filter(group => {
                                            if (!searchQuery.trim()) return true;
                                            const q = searchQuery.toLowerCase();
                                            return group.productName.toLowerCase().includes(q) ||
                                                group.lots.some(s => s.lotNumber?.toLowerCase().includes(q) || s.sku?.toLowerCase().includes(q));
                                        })
                                        .map(group => {
                                        const isExpanded = expandedProducts[group.productId];
                                        const groupSelected = getGroupSelectedTotal(group);
                                        const hasSelection = groupSelected > 0;
                                        return (
                                            <div key={group.productId} style={{
                                                border: `1.5px solid ${hasSelection ? '#10b981' : '#e2e8f0'}`,
                                                borderRadius: 10, background: hasSelection ? '#f0fdf4' : '#fff',
                                                overflow: 'hidden', transition: 'all 0.2s'
                                            }}>
                                                {/* Product header row */}
                                                <div
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '12px 16px', cursor: 'pointer', userSelect: 'none'
                                                    }}
                                                    onClick={() => toggleExpand(group.productId)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                                        {isExpanded ? <ChevronDown size={18} color="#64748b" /> : <ChevronRight size={18} color="#64748b" />}
                                                        <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {group.productName}
                                                        </span>
                                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap' }}>
                                                            {group.lots.length} lote{group.lots.length > 1 ? 's' : ''}
                                                        </span>
                                                        {group.hasLocked && (
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: '#fed7aa', color: '#9a3412', border: '1px solid #fb923c', whiteSpace: 'nowrap' }}>
                                                                🔒 Algunos bloqueados
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#059669' }}>
                                                                {group.totalAvailable} libres
                                                            </div>
                                                            {group.totalDefective > 0 && (
                                                                <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600 }}>
                                                                    {group.totalDefective} defectuosos
                                                                </div>
                                                            )}
                                                            {group.totalInTransit > 0 && (
                                                                <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 600 }}>
                                                                    {group.totalInTransit} en tránsito
                                                                </div>
                                                            )}
                                                        </div>
                                                        {hasSelection && (
                                                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff', background: '#10b981', padding: '3px 10px', borderRadius: 20 }}>
                                                                {groupSelected} sel.
                                                            </span>
                                                        )}
                                                        <Button
                                                            size="small"
                                                            onClick={e => { e.stopPropagation(); hasSelection ? handleClearProduct(group) : handleSendAllProduct(group); }}
                                                            style={{
                                                                background: hasSelection ? '#fef2f2' : '#ecfdf5',
                                                                color: hasSelection ? '#dc2626' : '#059669',
                                                                border: `1px solid ${hasSelection ? '#fca5a5' : '#6ee7b7'}`,
                                                                fontWeight: 700, fontSize: '0.75rem'
                                                            }}
                                                        >
                                                            {hasSelection ? 'Limpiar' : 'Enviar Todo'}
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Expanded lot details */}
                                                {isExpanded && (
                                                    <div style={{ borderTop: '1px solid #e2e8f0', padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {group.lots.map((s, idx) => {
                                                            const itemKey = `${s.productId}_${s.lotNumber}`;
                                                            const selectedQty = selectedItems[itemKey]?.requestedQuantity || null;
                                                            const isSelected = selectedQty !== null;
                                                            const locked = s.assemblyPending === true;
                                                            const maxSendable = Math.max(0, s.currentQuantity - s.inTransitQty);
                                                            return (
                                                                <div key={idx} style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                    padding: '10px 14px', borderRadius: 8,
                                                                    border: `1px solid ${locked ? '#fdba74' : isSelected ? '#86efac' : '#f1f5f9'}`,
                                                                    background: locked ? '#fff7ed' : isSelected ? '#f0fdf4' : '#f8fafc',
                                                                    opacity: locked ? 0.8 : 1
                                                                }}>
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>{s.lotNumber}</span>
                                                                            {locked && (
                                                                                <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '1px 6px', borderRadius: 12, background: '#fed7aa', color: '#9a3412' }}>
                                                                                    🔒 Pendiente
                                                                                </span>
                                                                            )}
                                                                            {s.defective > 0 && (
                                                                                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#fef2f2', color: '#ef4444' }}>
                                                                                    {s.defective} defectuosos
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: 3, display: 'flex', gap: 12 }}>
                                                                            <span>Total: {s.initialQuantity}</span>
                                                                            <span>Entregadas: {s.alreadyDelivered}</span>
                                                                            {s.inTransitQty > 0 && <span style={{ color: '#f59e0b' }}>En tránsito: {s.inTransitQty}</span>}
                                                                            <span style={{ fontWeight: 800, color: '#059669' }}>Libres: {maxSendable}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, flexShrink: 0 }}>
                                                                        <InputNumber
                                                                            min={0}
                                                                            max={maxSendable}
                                                                            value={locked ? null : selectedQty}
                                                                            onChange={val => !locked && handleQtyChange(s, val)}
                                                                            placeholder={locked ? '—' : '0'}
                                                                            disabled={locked}
                                                                            style={{ width: 75 }}
                                                                            size="small"
                                                                        />
                                                                        {!locked && (
                                                                            <Button
                                                                                size="small" type="link"
                                                                                onClick={() => handleQtyChange(s, maxSendable)}
                                                                                style={{ padding: '0 4px', fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}
                                                                            >
                                                                                Max
                                                                            </Button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
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
                            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, minHeight: 100, maxHeight: 320, overflowY: 'auto' }}>
                                {Object.values(selectedItems).length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: '30px 0' }}>Elige cuántas cajas vas a mandar para armar el acta.</div>
                                ) : (
                                    (() => {
                                        // Group selected items by product
                                        const cartGroups = {};
                                        Object.values(selectedItems).forEach(i => {
                                            const name = i.stockInfo?.product?.name || 'Desconocido';
                                            if (!cartGroups[name]) cartGroups[name] = { total: 0, lots: [] };
                                            cartGroups[name].total += i.requestedQuantity;
                                            cartGroups[name].lots.push(i);
                                        });
                                        return Object.entries(cartGroups).sort((a, b) => a[0].localeCompare(b[0])).map(([name, g], idx) => (
                                            <div key={idx} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                    <span style={{ fontWeight: 700, color: '#1e293b', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                                                    <strong style={{ color: '#10b981' }}>{g.total} uds</strong>
                                                </div>
                                                {g.lots.length > 1 && (
                                                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2, paddingLeft: 8 }}>
                                                        {g.lots.map((l, li) => (
                                                            <div key={li}>{l.lotNumber}: {l.requestedQuantity}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ));
                                    })()
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
                    <div>
                        {/* Filter bar */}
                        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
                                <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                <input
                                    type="text"
                                    placeholder="Buscar acta, operario, lote, SKU..."
                                    value={historySearch}
                                    onChange={e => setHistorySearch(e.target.value)}
                                    style={{
                                        width: '100%', padding: '8px 12px 8px 34px',
                                        border: '1px solid #e2e8f0', borderRadius: 8,
                                        fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            <select
                                value={historyStatus}
                                onChange={e => setHistoryStatus(e.target.value)}
                                style={{
                                    padding: '8px 14px', border: '1px solid #e2e8f0',
                                    borderRadius: 8, fontSize: '0.85rem', cursor: 'pointer',
                                    background: '#fff', color: '#334155', fontWeight: 600, outline: 'none'
                                }}
                            >
                                <option value="ALL">Todos los estados</option>
                                <option value="COMPLETED">✅ Recibido</option>
                                <option value="REJECTED">❌ Rechazado</option>
                                <option value="PENDING">⏳ Pendiente</option>
                            </select>
                            {(historySearch || historyStatus !== 'ALL') && (
                                <button
                                    onClick={() => { setHistorySearch(''); setHistoryStatus('ALL'); }}
                                    style={{
                                        padding: '7px 12px', border: '1px solid #e2e8f0',
                                        borderRadius: 8, background: '#fff', color: '#64748b',
                                        fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600
                                    }}
                                >
                                    ✕ Limpiar
                                </button>
                            )}
                            <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginLeft: 'auto' }}>
                                {(() => {
                                    const s = historySearch.toLowerCase();
                                    const count = historyHandoffs.filter(h => {
                                        const matchSearch = !s || h.handoffNumber?.toLowerCase().includes(s)
                                            || h.createdBy?.name?.toLowerCase().includes(s)
                                            || h.receivedBy?.name?.toLowerCase().includes(s)
                                            || h.items?.some(i => i.lotNumber?.toLowerCase().includes(s) || i.product?.sku?.toLowerCase().includes(s));
                                        const matchStatus = historyStatus === 'ALL' || h.status === historyStatus;
                                        return matchSearch && matchStatus;
                                    }).length;
                                    return `${count} de ${historyHandoffs.length} actas`;
                                })()}
                            </span>
                        </div>
                        <Table
                            dataSource={historyHandoffs.filter(h => {
                                const s = historySearch.toLowerCase();
                                const matchSearch = !s || h.handoffNumber?.toLowerCase().includes(s)
                                    || h.createdBy?.name?.toLowerCase().includes(s)
                                    || h.receivedBy?.name?.toLowerCase().includes(s)
                                    || h.items?.some(i => i.lotNumber?.toLowerCase().includes(s) || i.product?.sku?.toLowerCase().includes(s));
                                const matchStatus = historyStatus === 'ALL' || h.status === historyStatus;
                                return matchSearch && matchStatus;
                            })}
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
                                        <Badge status={s === 'COMPLETED' ? 'success' : s === 'REJECTED' ? 'error' : 'processing'} text={s === 'COMPLETED' ? 'Recibido' : s === 'REJECTED' ? 'Rechazado' : 'Pendiente'} />
                                    )
                                }
                            ]}
                        />
                    </div>
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
