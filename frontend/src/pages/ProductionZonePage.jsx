import React, { useState, useEffect, useCallback } from 'react';
import { Input, Button, message, Modal, InputNumber, Select, Tag, Empty, Spin, Typography, Card } from 'antd';
import { Search, ArrowRightCircle, ArrowLeftCircle, Package, Warehouse, RefreshCw, Clock, Camera, X, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import api from '../services/api';
import { parseScanInput } from '../services/scannerParser';
import { useAuth } from '../context/AuthContext';
import './ProductionZonePage.css';

const { Text, Title } = Typography;

const ProductionZonePage = () => {
    const { user } = useAuth();

    // ── State ──
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [availableLots, setAvailableLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [selectedLot, setSelectedLot] = useState(null);
    const [transferQty, setTransferQty] = useState(null);
    const [transferObs, setTransferObs] = useState('');
    const [transferring, setTransferring] = useState(false);
    const [photos, setPhotos] = useState([]);  // [{url, filename}]
    const [uploading, setUploading] = useState(false);
    const [showTransferForm, setShowTransferForm] = useState(false);

    const [zoneStock, setZoneStock] = useState([]);
    const [zoneLoading, setZoneLoading] = useState(false);
    const [zoneSearch, setZoneSearch] = useState('');
    const [zonePage, setZonePage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewPhoto, setPreviewPhoto] = useState(null);

    const [scannerInput, setScannerInput] = useState('');
    const [fefoOverride, setFefoOverride] = useState(false);
    const isAdmin = user?.role === 'ADMIN';

    // ── Load zone stock + history on mount ──
    useEffect(() => {
        loadZoneStock();
        loadHistory();
    }, []);

    // Auto-filter zone stock when search changes (debounced)
    useEffect(() => {
        setZonePage(1); // Reset page on new search
        const timer = setTimeout(() => { loadZoneStock(); }, 300);
        return () => clearTimeout(timer);
    }, [zoneSearch]);

    const loadZoneStock = useCallback(async () => {
        setZoneLoading(true);
        try {
            const params = zoneSearch ? { search: zoneSearch } : {};
            const res = await api.get('/zone-transfers/zone-stock', { params });
            setZoneStock(res.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setZoneLoading(false);
        }
    }, [zoneSearch]);

    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await api.get('/zone-transfers', { params: { days: 7, limit: 50 } });
            setHistory(res.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setHistoryLoading(false);
        }
    };

    // ── Scanner Input Handling ──
    const handleScannerInput = async (value) => {
        setScannerInput(value);

        // Detect end of scan: pipe-delimited strings are "complete" patterns
        // JSON scans end with }, pipe scans we detect by having key fields
        const hasJson = value.includes('{') && value.includes('}');
        const hasPipe = (value.includes('R:') || value.includes('SKU:') || value.includes('LOT:')) && value.includes('|');

        if (!hasJson && !hasPipe) return;

        // Parse with centralized scanner parser
        const scan = parseScanInput(value);
        if (scan.type === 'unknown') return;

        setScannerInput(''); // clear immediately after detection

        const searchKey = scan.sku || scan.barcode;
        if (!searchKey) {
            message.warning('QR no contiene SKU ni código de barras');
            return;
        }

        try {
            setSearching(true);
            message.loading({ content: `Buscando ${searchKey}...`, key: 'qr-search', duration: 5 });

            // Search by SKU
            const res = await api.get('/zone-transfers/search-products', { params: { q: searchKey } });
            const foundProduct = res.data?.find(p =>
                p.sku?.toUpperCase() === searchKey.toUpperCase()
            ) || res.data?.[0]; // fallback to first match

            if (!foundProduct) {
                message.error({ content: `Producto no encontrado: ${searchKey}`, key: 'qr-search' });
                setSearching(false);
                return;
            }

            // Auto-fill product
            setSelectedProduct(foundProduct);
            setSearchQuery('');

            // Auto-fill quantity from QR (if present)
            if (scan.unitsPerBox && scan.unitsPerBox > 0) {
                setTransferQty(scan.unitsPerBox);
            }

            // Load available lots
            setLotsLoading(true);
            const lotsRes = await api.get(`/zone-transfers/available-lots/${foundProduct.id}`);
            setAvailableLots(lotsRes.data || []);

            // Auto-select lot if QR includes lot number
            if (scan.lotNumber) {
                const matchedLot = lotsRes.data?.find(l =>
                    l.lotNumber === scan.lotNumber ||
                    l.lotNumber?.includes(scan.lotNumber)
                );
                if (matchedLot) {
                    setSelectedLot(matchedLot.id);
                    message.success({ content: `✅ ${foundProduct.name} — Lote ${matchedLot.lotNumber} (${scan.unitsPerBox || '?'} uds)`, key: 'qr-search', duration: 3 });
                } else {
                    message.warning({ content: `${foundProduct.name} encontrado, pero lote "${scan.lotNumber}" no disponible en bodega`, key: 'qr-search', duration: 4 });
                }
            } else {
                // No lot in QR — auto-select first available lot
                if (lotsRes.data?.length > 0) {
                    setSelectedLot(lotsRes.data[0].id);
                    message.success({ content: `✅ ${foundProduct.name} — Lote auto-seleccionado: ${lotsRes.data[0].lotNumber}`, key: 'qr-search', duration: 3 });
                } else {
                    message.success({ content: `✅ ${foundProduct.name} — Sin lotes en bodega`, key: 'qr-search', duration: 3 });
                }
            }
        } catch (e) {
            console.error('QR scan error:', e);
            message.error({ content: `Error procesando QR: ${e.message}`, key: 'qr-search' });
        } finally {
            setSearching(false);
            setLotsLoading(false);
        }
    };

    // ── Product search ──
    const handleSearch = async (value) => {
        setSearchQuery(value);
        if (value.length < 2) { setSearchResults([]); return; }
        setSearching(true);
        try {
            const res = await api.get('/zone-transfers/search-products', { params: { q: value } });
            setSearchResults(res.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setSearching(false);
        }
    };

    // ── Select product and load available lots ──
    const selectProduct = async (product) => {
        setSelectedProduct(product);
        setSelectedLot(null);
        setTransferQty(null);
        setLotsLoading(true);
        try {
            const res = await api.get(`/zone-transfers/available-lots/${product.id}`);
            setAvailableLots(res.data || []);
        } catch (e) {
            message.error('Error cargando lotes');
        } finally {
            setLotsLoading(false);
        }
    };

    // ── Transfer in ──
    const handleTransferIn = async () => {
        if (!selectedProduct || !transferQty || transferQty <= 0) {
            message.error('Seleccione producto y cantidad');
            return;
        }
        if (photos.length === 0) {
            message.error('Debe adjuntar al menos una foto del material');
            return;
        }
        // Pack-size minimum validation — ONLY for large bulk bags (>= 50kg = 50,000 g), e.g. AZUCAR
        // Smaller packSizes (sabores, colores, cajas) are informational only — do NOT block
        const packSize = selectedProduct?.packSize || 0;
        const selectedLotData = selectedLot ? availableLots.find(l => l.id === selectedLot) : null;
        const lotBalance = selectedLotData?.currentQuantity ?? Infinity;
        if (packSize >= 50000 && transferQty < packSize && transferQty < lotBalance) {
            message.error(
                `Mínimo de ingreso: 1 bolsa completa (${packSize.toLocaleString('es-CO')} ${selectedProduct.unit || 'und'} = ${(packSize/1000).toFixed(0)} kg). ` +
                `Si el lote tiene menos de una bolsa, selecciónelo y transfiera el saldo completo.`
            );
            return;
        }
        setTransferring(true);
        try {
            await api.post('/zone-transfers/transfer-in', {
                productId: selectedProduct.id,
                materialLotId: selectedLot || null,
                quantity: transferQty,
                observations: transferObs || null,
                photos: photos.map(p => p.url),
                userId: user?.id,
                fefoOverride: fefoOverride && isAdmin
            });
            message.success(`✅ ${transferQty} × ${selectedProduct.name} ingresado a zona de producción`);
            setSelectedProduct(null);
            setSelectedLot(null);
            setTransferQty(null);
            setTransferObs('');
            setPhotos([]);
            setSearchQuery('');
            setSearchResults([]);
            setShowTransferForm(false);
            setFefoOverride(false);
            loadZoneStock();
            loadHistory();
        } catch (e) {
            message.error(e.response?.data?.error || 'Error al transferir');
        } finally {
            setTransferring(false);
        }
    };

    // ── Format quantity display ──
    const fmtQty = (qty, unit) => {
        if (!qty && qty !== 0) return '-';
        const n = Number(qty);
        if (unit === 'gramo' || unit === 'g') {
            return n >= 1000 ? `${n.toLocaleString('es-CO')}g (${(n / 1000).toFixed(1)} kg)` : `${n.toLocaleString('es-CO')} g`;
        }
        return `${n.toLocaleString('es-CO')} ${unit || 'und'}`;
    };

    const fmtDate = (d) => {
        if (!d) return '-';
        return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="pz-page">
            {/* ── Header ── */}
            <div className="pz-header">
                <div className="pz-header-icon"><Warehouse size={28} /></div>
                <div style={{ flex: 1 }}>
                    <h1 className="pz-title">Zona de Producción</h1>
                    <p className="pz-subtitle">Control de ingreso de materiales a la zona de fabricación</p>
                </div>
                <Button
                    type="primary" size="large"
                    icon={<ArrowRightCircle size={18} />}
                    onClick={() => setShowTransferForm(!showTransferForm)}
                    className="pz-toggle-btn"
                >
                    {showTransferForm ? 'Cerrar' : 'Ingresar Material'}
                    {showTransferForm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </Button>
            </div>

            {/* ── Transfer Form — Horizontal Collapsible ── */}
            {showTransferForm && (
                <div className="pz-transfer-bar">
                    {/* Scanner Injector */}
                    {!selectedProduct && (
                        <div className="bg-slate-800 rounded-lg p-3 mb-4 flex items-center justify-between shadow-inner focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                            <div className="flex items-center gap-3">
                                <QrCode className="text-blue-400" size={24}/>
                                <div className="text-white">
                                    <div className="font-bold text-sm">Escáner de Rótulo G-PBI</div>
                                    <div className="text-[10px] text-slate-400">Haz clic aquí y dispara el láser al bulto para auto-rellenar</div>
                                </div>
                            </div>
                            <input 
                                autoFocus
                                type="text"
                                className="bg-slate-900 border border-slate-700 text-green-400 font-mono text-sm rounded px-3 py-2 w-64 outline-none focus:border-blue-500"
                                placeholder="..."
                                value={scannerInput}
                                onChange={e => handleScannerInput(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="pz-transfer-row">
                        {/* Step 1: Product search */}
                        <div className="pz-transfer-col pz-transfer-col-product">
                            <label className="pz-label">Producto</label>
                            {selectedProduct ? (
                                <div className="pz-selected-inline">
                                    <div style={{ flex: 1 }}>
                                        <Text strong style={{ fontSize: '0.95rem' }}>{selectedProduct.name}</Text>
                                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                            <Tag color="blue" style={{ fontSize: '0.7rem' }} className="pz-hide-tablet">Stock Siigo: {fmtQty(selectedProduct.currentStock, selectedProduct.unit)}</Tag>
                                            <Tag color="geekblue" style={{ fontSize: '0.7rem' }} className="pz-hide-tablet">Disponible bodega: {fmtQty(Math.max(0, (selectedProduct.currentStock || 0) - (selectedProduct.productionZoneStock || 0)), selectedProduct.unit)}</Tag>
                                            <Tag color="green" style={{ fontSize: '0.7rem' }}>Zona: {fmtQty(selectedProduct.productionZoneStock, selectedProduct.unit)}</Tag>
                                            {selectedProduct.packSize > 1 && (
                                                <Tag color="orange" style={{ fontSize: '0.7rem' }}>Mín: {fmtQty(selectedProduct.packSize, selectedProduct.unit)}/paq</Tag>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        size="middle"
                                        danger
                                        icon={<X size={16} />}
                                        onClick={() => { setSelectedProduct(null); setAvailableLots([]); setTransferQty(null); }}
                                        style={{ minWidth: 44, minHeight: 44 }}
                                        title="Cambiar producto"
                                    />
                                </div>
                            ) : (
                                <div style={{ position: 'relative' }}>
                                    <Input
                                        prefix={<Search size={14} />}
                                        placeholder="Buscar producto..."
                                        value={searchQuery}
                                        onChange={e => handleSearch(e.target.value)}
                                        allowClear
                                    />
                                    {searching && <Spin size="small" style={{ marginTop: 4 }} />}
                                    {searchResults.length > 0 && !selectedProduct && (
                                        <div className="pz-search-results pz-search-dropdown">
                                            {searchResults.map(p => (
                                                <div key={p.id} className="pz-search-item" onClick={() => selectProduct(p)}>
                                                    <div className="pz-search-item-name">{p.name}</div>
                                                    <div className="pz-search-item-meta">
                                                        <Tag color="blue">{p.sku}</Tag>
                                                        <span>Stock: {fmtQty(p.currentStock, p.unit)} · Disp: {fmtQty(Math.max(0, (p.currentStock || 0) - (p.productionZoneStock || 0)), p.unit)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Step 2: Lot */}
                        <div className="pz-transfer-col">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <label className="pz-label">Lote (FEFO)</label>
                                {isAdmin && availableLots.some(l => !l.fefoEligible) && (
                                    <button
                                        type="button"
                                        onClick={() => setFefoOverride(v => !v)}
                                        style={{
                                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                                            border: fefoOverride ? '1px solid #f59e0b' : '1px solid #cbd5e1',
                                            background: fefoOverride ? '#fef3c7' : '#fff',
                                            color: fefoOverride ? '#92400e' : '#64748b',
                                            cursor: 'pointer'
                                        }}
                                        title="Admin: permitir saltarse el orden FEFO"
                                    >
                                        {fefoOverride ? '🔓 Override FEFO' : '🔒 Override FEFO'}
                                    </button>
                                )}
                            </div>
                            {lotsLoading ? <Spin size="small" /> : (
                                <>
                                    <Select
                                        style={{ width: '100%' }}
                                        placeholder={!selectedProduct ? 'Seleccione producto primero' : availableLots.length === 0 ? 'Sin lotes en bodega' : 'Seleccionar...'}
                                        value={selectedLot}
                                        onChange={setSelectedLot}
                                        allowClear
                                        disabled={!selectedProduct}
                                        optionLabelProp="label"
                                        options={availableLots.map(l => {
                                            const exp = l.expiresAt
                                                ? new Date(l.expiresAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
                                                : null;
                                            const blocked = !l.fefoEligible && !(fefoOverride && isAdmin);
                                            const reason = l.fefoBlockedReason === 'NO_EXPIRY'
                                                ? 'Sin fecha vto.'
                                                : 'Esperar FEFO';
                                            return {
                                                value: l.id,
                                                disabled: blocked,
                                                label: (
                                                    <span>
                                                        {l.fefoEligible && <span style={{ color: '#16a34a', fontWeight: 800 }}>✅ </span>}
                                                        {blocked && <span>🔒 </span>}
                                                        {l.lotNumber} — {fmtQty(l.currentQuantity, l.unit)}
                                                        {exp ? ` · Vence ${exp}` : ''}
                                                    </span>
                                                ),
                                                searchLabel: `${l.lotNumber} ${exp || ''}`,
                                                rawLot: l,
                                                blocked,
                                                reason,
                                                exp
                                            };
                                        })}
                                        optionRender={(opt) => (
                                            <div style={{ opacity: opt.data.blocked ? 0.55 : 1 }}>
                                                <div style={{ fontWeight: 600 }}>
                                                    {opt.data.rawLot.fefoEligible && <span style={{ color: '#16a34a', fontWeight: 800 }}>✅ USAR ESTE — </span>}
                                                    {opt.data.blocked && <span>🔒 </span>}
                                                    {opt.data.rawLot.lotNumber}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                                    {fmtQty(opt.data.rawLot.currentQuantity, opt.data.rawLot.unit)}
                                                    {opt.data.exp && ` · Vence ${opt.data.exp}`}
                                                    {opt.data.blocked && ` · ${opt.data.reason}`}
                                                </div>
                                            </div>
                                        )}
                                    />
                                    {selectedProduct && availableLots.length === 0 && (selectedProduct.productionZoneStock || 0) > 0 && (
                                        <div style={{ marginTop: 6, padding: '6px 10px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, fontSize: '0.78rem', color: '#ad6800' }}>
                                            ⚠️ Todo el stock ya está en zona de producción ({fmtQty(selectedProduct.productionZoneStock, selectedProduct.unit)}).
                                            No hay lotes pendientes en bodega.
                                        </div>
                                    )}
                                    {selectedProduct && availableLots.length > 0 && availableLots.some(l => l.fefoEligible) && (
                                        <div style={{ marginTop: 6, padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: '0.78rem', color: '#166534' }}>
                                            ✅ Lote a transferir: <strong>{availableLots.find(l => l.fefoEligible)?.lotNumber}</strong>
                                            {availableLots.find(l => l.fefoEligible)?.expiresAt && (
                                                <> (vence {new Date(availableLots.find(l => l.fefoEligible).expiresAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })})</>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Step 3: Quantity */}
                        <div className="pz-transfer-col pz-transfer-col-qty">
                            <label className="pz-label">Cantidad</label>
                            <InputNumber
                                style={{ width: '100%' }}
                                min={1}
                                max={selectedLot ? availableLots.find(l => l.id === selectedLot)?.currentQuantity : Math.max(0, (selectedProduct?.currentStock || 0) - (selectedProduct?.productionZoneStock || 0))}
                                value={transferQty}
                                onChange={setTransferQty}
                                placeholder={selectedProduct?.unit === 'gramo' || selectedProduct?.unit === 'g' ? 'Gramos' : 'Cantidad'}
                                disabled={!selectedProduct}
                                status={selectedProduct?.packSize > 1 && transferQty > 0 && transferQty < selectedProduct.packSize ? 'warning' : ''}
                            />
                            {transferQty > 0 && selectedProduct && (
                                <div className="pz-qty-inline">
                                    {(selectedProduct.unit === 'gramo' || selectedProduct.unit === 'g') && (
                                        <Tag color="blue" style={{ fontSize: '0.68rem' }}>≈ {(transferQty / 1000).toFixed(2)} kg</Tag>
                                    )}
                                    {selectedProduct.packSize > 1 && (
                                        <Tag color="purple" style={{ fontSize: '0.68rem' }}>≈ {(transferQty / selectedProduct.packSize).toFixed(1)} packs</Tag>
                                    )}
                                    {selectedProduct.packSize > 1 && transferQty < selectedProduct.packSize && (
                                        <Tag color="warning" style={{ fontSize: '0.68rem' }}>⚠️ Menos de 1 paquete</Tag>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Step 4: Observations */}
                        <div className="pz-transfer-col">
                            <label className="pz-label">Observaciones</label>
                            <Input
                                value={transferObs}
                                onChange={e => setTransferObs(e.target.value)}
                                placeholder="Opcional..."
                                disabled={!selectedProduct}
                            />
                        </div>

                        {/* Step 5: Photo + Submit */}
                        <div className="pz-transfer-col pz-transfer-col-actions">
                            <label className="pz-label">Fotos</label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label className="pz-photo-btn-inline">
                                    <Camera size={16} />
                                    {photos.length > 0 ? `${photos.length} 📷` : 'Foto'}
                                    <input
                                        type="file" accept="image/*" multiple capture="environment"
                                        style={{ display: 'none' }} disabled={uploading}
                                        onChange={async (e) => {
                                            const files = Array.from(e.target.files || []);
                                            if (files.length === 0) return;
                                            setUploading(true);
                                            try {
                                                for (const file of files) {
                                                    const fd = new FormData();
                                                    fd.append('photo', file);
                                                    const res = await api.post('/uploads/evidence', fd, {
                                                        headers: { 'Content-Type': 'multipart/form-data' }
                                                    });
                                                    setPhotos(prev => [...prev, res.data]);
                                                }
                                            } catch (err) {
                                                message.error('Error subiendo foto');
                                            } finally {
                                                setUploading(false);
                                                e.target.value = '';
                                            }
                                        }}
                                    />
                                </label>
                                <Button
                                    type="primary"
                                    loading={transferring}
                                    onClick={handleTransferIn}
                                    disabled={!transferQty || transferQty <= 0 || photos.length === 0 || !selectedProduct}
                                    icon={<ArrowRightCircle size={16} />}
                                    className="pz-transfer-btn-inline"
                                >
                                    Ingresar
                                </Button>
                            </div>
                            {photos.length > 0 && (
                                <div className="pz-photo-previews-inline">
                                    {photos.map((p, i) => (
                                        <div key={i} className="pz-photo-thumb-sm">
                                            <img src={p.url} alt={`Foto ${i + 1}`} />
                                            <button className="pz-photo-remove-sm" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} type="button">
                                                <X size={10} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Stock en Zona — Full Width ── */}
            <div className="pz-panel pz-stock-panel-full">
                <div className="pz-panel-header">
                    <h2 className="pz-panel-title">
                        <Package size={20} />
                        Stock en Zona de Producción
                        {zoneStock.length > 0 && <Tag color="purple" style={{ marginLeft: 8 }}>{zoneStock.length} productos</Tag>}
                    </h2>
                    <div className="pz-stock-actions">
                        <Input
                            prefix={<Search size={14} />}
                            placeholder="Filtrar..."
                            value={zoneSearch}
                            onChange={e => setZoneSearch(e.target.value)}
                            onPressEnter={loadZoneStock}
                            size="small"
                            style={{ width: 200 }}
                            allowClear
                        />
                        <Button icon={<RefreshCw size={14} />} size="small" onClick={loadZoneStock}>
                            Refrescar
                        </Button>
                    </div>
                </div>

                {zoneLoading ? (
                    <div className="pz-loading"><Spin /></div>
                ) : zoneStock.length === 0 ? (
                    <Empty description="Sin materiales en zona de producción" />
                ) : (
                    <>
                        <div className="pz-stock-table-wrap">
                            <table className="pz-stock-table">
                                <thead>
                                    <tr>
                                        <th>Producto</th>
                                        <th>Stock Zona</th>
                                        <th>Lotes en Zona</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {zoneStock.slice((zonePage - 1) * ITEMS_PER_PAGE, zonePage * ITEMS_PER_PAGE).map(p => (
                                        <tr key={p.id}>
                                            <td>
                                                <div className="pz-stock-product-name">{p.name}</div>
                                                <div className="pz-stock-product-sku">{p.sku}</div>
                                            </td>
                                            <td className="pz-stock-qty">
                                                <span className="pz-stock-value">{fmtQty(p.productionZoneStock, p.unit)}</span>
                                                <div className="pz-stock-equiv">
                                                    {(p.unit === 'gramo' || p.unit === 'g') && p.productionZoneStock > 0 && (
                                                        <Tag color="blue" className="pz-lot-tag">≈ {(p.productionZoneStock / 1000).toFixed(1)} kg</Tag>
                                                    )}
                                                    {p.packSize > 1 && p.productionZoneStock > 0 && (
                                                        <Tag color="purple" className="pz-lot-tag">≈ {(p.productionZoneStock / p.packSize).toFixed(1)} packs</Tag>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                {p.materialLots?.length > 0 ? (
                                                    <div className="pz-lot-tags">
                                                        {p.materialLots.map(l => (
                                                            <Tag key={l.id} color="cyan" className="pz-lot-tag">
                                                                {l.lotNumber}: {fmtQty(l.currentQuantity, l.unit)}
                                                            </Tag>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <Text type="secondary" className="pz-no-lots">Sin lotes</Text>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Pagination */}
                        {Math.ceil(zoneStock.length / ITEMS_PER_PAGE) > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px', paddingBottom: '16px' }}>
                                <Button 
                                    disabled={zonePage <= 1} 
                                    onClick={() => setZonePage(zonePage - 1)}
                                    icon={<ArrowLeftCircle size={16} />}
                                />
                                <span style={{ fontSize: '13px', color: '#64748b' }}>
                                    Página <strong style={{color: '#334155'}}>{zonePage}</strong> de {Math.ceil(zoneStock.length / ITEMS_PER_PAGE)}
                                </span>
                                <Button 
                                    disabled={zonePage >= Math.ceil(zoneStock.length / ITEMS_PER_PAGE)} 
                                    onClick={() => setZonePage(zonePage + 1)}
                                    icon={<ArrowRightCircle size={16} />}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── History ── */}
            <div className="pz-panel pz-history-panel">
                <div className="pz-panel-header">
                    <h2 className="pz-panel-title">
                        <Clock size={20} />
                        Transferencias Recientes (7 días)
                    </h2>
                    <Button icon={<RefreshCw size={14} />} size="small" onClick={loadHistory}>
                        Refrescar
                    </Button>
                </div>

                {historyLoading ? (
                    <div className="pz-loading"><Spin /></div>
                ) : history.length === 0 ? (
                    <Empty description="Sin transferencias recientes" />
                ) : (
                    <div className="pz-history-table-wrap">
                        <table className="pz-stock-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Dirección</th>
                                    <th>Producto</th>
                                    <th>Cantidad</th>
                                    <th>Lote</th>
                                    <th>Responsable</th>
                                    <th>Observaciones</th>
                                    <th>Fotos</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(t => (
                                    <tr key={t.id}>
                                        <td className="pz-nowrap">{fmtDate(t.createdAt)}</td>
                                        <td>
                                            <Tag color={t.direction === 'IN' ? 'green' : 'orange'}>
                                                {t.direction === 'IN' ? '→ Zona' : '← Bodega'}
                                            </Tag>
                                        </td>
                                        <td>{t.product?.name || '-'}</td>
                                        <td className="pz-stock-qty">{fmtQty(t.quantity, t.unit)}</td>
                                        <td>{t.lotNumber || t.materialLot?.lotNumber || '-'}</td>
                                        <td>{t.transferredBy?.name || '-'}</td>
                                        <td className="pz-obs">{t.observations || '-'}</td>
                                        <td>
                                            {(() => {
                                                let safePhotos = [];
                                                if (Array.isArray(t.photos)) safePhotos = t.photos;
                                                else if (typeof t.photos === 'string' && t.photos.length > 0) {
                                                    try { safePhotos = JSON.parse(t.photos); } catch(e) {}
                                                }
                                                if (!Array.isArray(safePhotos)) safePhotos = [];
                                                
                                                return safePhotos.length > 0 ? (
                                                    <div className="pz-history-photos">
                                                        {safePhotos.map((url, i) => (
                                                            <img key={i} src={url} alt={`Foto ${i+1}`}
                                                                className="pz-history-thumb"
                                                                onClick={() => setPreviewPhoto(url)}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <Text type="secondary" style={{ fontSize: '0.75rem' }}>—</Text>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Photo preview modal */}
            <Modal
                open={!!previewPhoto}
                footer={null}
                onCancel={() => setPreviewPhoto(null)}
                width={600}
                centered
                destroyOnClose
            >
                {previewPhoto && (
                    <img src={previewPhoto} alt="Evidencia" style={{ width: '100%', borderRadius: 8 }} />
                )}
            </Modal>
        </div>
    );
};

export default ProductionZonePage;
