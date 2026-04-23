import React, { useState, useEffect, useCallback } from 'react';
import { message, Modal, Empty, Spin, Tag } from 'antd';
import { Package, ArrowRightLeft, RefreshCw, Clock, ChevronDown, ChevronUp, ChevronRight, Search, Warehouse, Plus, Printer, Bluetooth, BluetoothOff, Wifi, WifiOff, Settings, TrendingDown } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import QRCode from 'qrcode';
import printer from '../services/bluetoothPrinter';
import { buildLotLabel } from '../services/tsplLabelBuilder';
import { buildLotLabelZPL } from '../services/zplLabelBuilder';
import { generateQrDataUrl } from '../services/qrService';
import { useZebra } from '../context/ZebraContext';


const ZONES = [
    { key: 'PRODUCCION', label: 'Producción', color: '#f59e0b', icon: '🏭', bg: '#fffbeb' },
    { key: 'PRODUCTO_TERMINADO', label: 'Producto Terminado', color: '#10b981', icon: '✅', bg: '#ecfdf5' },
    { key: 'NO_CONFORME', label: 'No Conforme', color: '#ef4444', icon: '⚠️', bg: '#fef2f2' },
    { key: 'BODEGA', label: 'Bodega', color: '#6366f1', icon: '🏢', bg: '#eef2ff' },
    { key: 'CUARENTENA', label: 'Cuarentena', color: '#dc2626', icon: '🔒', bg: '#fef2f2' },
    { key: 'MAQUILA', label: 'Maquila', color: '#8b5cf6', icon: '🏷️', bg: '#f5f3ff' },
    { key: 'PUBLICIDAD', label: 'Publicidad', color: '#ec4899', icon: '🎁', bg: '#fdf2f8' },
];

// Transfer flow rules: which zones can each zone transfer TO
// BODEGA removed as destination — only raw materials go there, not finished products
const ZONE_DESTINATIONS = {
    PRODUCCION: ['PRODUCTO_TERMINADO', 'NO_CONFORME'],
    PRODUCTO_TERMINADO: ['NO_CONFORME', 'CUARENTENA', 'MAQUILA'],
    NO_CONFORME: ['PRODUCTO_TERMINADO'],
    BODEGA: ['PRODUCTO_TERMINADO'],
    CUARENTENA: ['PRODUCTO_TERMINADO'],
    MAQUILA: ['PRODUCTO_TERMINADO', 'CUARENTENA'],
};

const TRANSFER_REASONS = {
    PRODUCCION_TO_PRODUCTO_TERMINADO: 'Entrega a logística',
    PRODUCCION_TO_NO_CONFORME: 'Producto dañado en producción',
    PRODUCTO_TERMINADO_TO_NO_CONFORME: 'Producto dañado en bodega',
    PRODUCTO_TERMINADO_TO_CUARENTENA: 'Producto dañado — cuarentena',
    PRODUCTO_TERMINADO_TO_MAQUILA: 'Re-etiquetado',
    NO_CONFORME_TO_PRODUCTO_TERMINADO: 'Producto recuperado',
    BODEGA_TO_PRODUCTO_TERMINADO: 'Traslado desde bodega principal',
    CUARENTENA_TO_PRODUCTO_TERMINADO: 'Liberado de cuarentena',
    MAQUILA_TO_PRODUCTO_TERMINADO: 'Maquila completada',
    MAQUILA_TO_CUARENTENA: 'Producto dañado en maquila',
};

const FinishedProductZonePage = () => {
    const { user } = useAuth();
    const [activeZone, setActiveZone] = useState(() =>
        user?.role === 'LOGISTICA' ? 'PRODUCTO_TERMINADO' : 'PRODUCCION'
    );
    const [stocks, setStocks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedProduct, setExpandedProduct] = useState(null);
    const [productMovements, setProductMovements] = useState({});
    const [movLoading2, setMovLoading2] = useState(false);
    const [summary, setSummary] = useState(null);
    const [movements, setMovements] = useState([]);
    const [movLoading, setMovLoading] = useState(false);
    const [search, setSearch] = useState('');

    // Transfer form
    const [showTransfer, setShowTransfer] = useState(false);
    const [transferData, setTransferData] = useState({ productId: '', lotNumber: '', toZone: '', quantity: '', reason: '', observations: '' });
    const [transferring, setTransferring] = useState(false);
    const [selectedStock, setSelectedStock] = useState(null); // Pre-fill from stock row
    const [transferEmpaque, setTransferEmpaque] = useState(null); // { approved, defective } for transfer modal

    // Manual ingestion form
    const [showIngestion, setShowIngestion] = useState(false);
    const [ingestionSearch, setIngestionSearch] = useState('');
    const [ingestionResults, setIngestionResults] = useState([]);
    const [ingestionSearching, setIngestionSearching] = useState(false);
    const [ingestionProduct, setIngestionProduct] = useState(null);
    const [ingestionLot, setIngestionLot] = useState('');
    const [ingestionQty, setIngestionQty] = useState('');
    const [ingestionUnitsPerBox, setIngestionUnitsPerBox] = useState('');
    const [ingestionExpiry, setIngestionExpiry] = useState('');
    const [ingestionZone, setIngestionZone] = useState('PRODUCTO_TERMINADO');
    const [ingesting, setIngesting] = useState(false);
    const [ingestionQrUrl, setIngestionQrUrl] = useState('');
    const [isMaquilaLabel, setIsMaquilaLabel] = useState(false);
    const [ingestionRegistered, setIngestionRegistered] = useState(false);
    const [availableLots, setAvailableLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [manualLotMode, setManualLotMode] = useState(false);
    const [lotSummary, setLotSummary] = useState([]);
    const [lotZones, setLotZones] = useState([]);
    const [pendingBox, setPendingBox] = useState(null); // from DB
    const [successModal, setSuccessModal] = useState(null); // { qty, productName, zoneName }

    // Siigo Adjustment RPA
    const [showSiigoAdjustment, setShowSiigoAdjustment] = useState(false);
    const [adjustmentData, setAdjustmentData] = useState({ lot: null, product: null, accountCode: '71050504', quantity: '' });
    const [siigoAdjusting, setSiigoAdjusting] = useState(false);

    // ── Fetch lot stock summary by zone ──
    const loadLotSummary = async (lotNumber) => {
        if (!lotNumber) { setLotSummary([]); setLotZones([]); setLotNcData(null); return []; }
        try {
            const res = await api.get(`/finished-lots/lot-summary/${encodeURIComponent(lotNumber)}`);
            setLotSummary(res.data || []);
            // Also fetch zone distribution for this lot
            if (ingestionProduct?.id) {
                const [flsRes, mlRes] = await Promise.all([
                    api.get(`/finished-lots/product-lots?productId=${ingestionProduct.id}`).catch(() => ({ data: [] })),
                    api.get(`/inventory/lots?productId=${ingestionProduct.id}&status=AVAILABLE,LOW_STOCK`).catch(() => ({ data: [] })),
                ]);
                const allLots = [...(Array.isArray(flsRes.data) ? flsRes.data : []), ...(Array.isArray(mlRes.data) ? mlRes.data : (mlRes.data?.data || []))];
                const zones = allLots.filter(l => l.lotNumber === lotNumber && l.currentQuantity > 0);
                setLotZones(zones);

                // Load NC defective data (from lot-summary, then fallback to assembly note)
                const entry = (res.data || []).find(e => e.productId === ingestionProduct.id);
                let defective = entry?.defective || 0;
                let defectReasons = [];
                if (defective === 0) {
                    try {
                        const notesRes = await api.get(`/assembly-notes?productId=${ingestionProduct.id}`);
                        const empaqueNote = (notesRes.data || []).find(n =>
                            n.processType?.code === 'EMPAQUE' &&
                            n.productId === ingestionProduct.id &&
                            n.processParameters?.empaque &&
                            (n.productionBatch?.batchNumber === lotNumber ||
                             n.processParameters?.empaque?.lot === lotNumber)
                        );
                        const emp = empaqueNote?.processParameters?.empaque;
                        if (emp?.defective_qty > 0) {
                            defective = emp.defective_qty;
                            defectReasons = emp.defect_reasons || [];
                        }
                    } catch (_) {}
                } else {
                    defectReasons = entry?.defect_reasons || [];
                }
                setLotNcData(defective > 0 ? { defective, approved: entry?.approved ?? null, defect_reasons: defectReasons } : null);
            }
            return res.data || [];
        } catch (e) { console.error('lot-summary error:', e); setLotSummary([]); setLotZones([]); setLotNcData(null); return []; }
    };

    // ── Printer mode: 'bluetooth' (SAT) or 'network' (Zebra) ──
    const [printerMode, setPrinterMode] = useState(() => localStorage.getItem('zone_printer_mode') || 'network');

    // Bluetooth (SAT) state
    const [printerConnected, setPrinterConnected] = useState(printer.isConnected());
    const [printerName, setPrinterName] = useState(printer.getDeviceName() || '');
    const [printing, setPrinting] = useState(false);

    // Network (Zebra) state from global context
    const { zebraStatus, zebraIp, printZPL, recheckNow, isRechecking, configIp, relayIp, updateConfig } = useZebra();
    const [showZebraSettings, setShowZebraSettings] = useState(false);
    const [editIp, setEditIp] = useState(configIp);
    const [editRelay, setEditRelay] = useState(relayIp);


    // Print label modal state
    const [printModal, setPrintModal] = useState({ open: false, product: null, lot: null, totalUnits: 0 });
    const [printBoxSize, setPrintBoxSize] = useState(12);
    const [printMaquila, setPrintMaquila] = useState(false);
    const [printFrom, setPrintFrom] = useState(1);
    const [printTo, setPrintTo] = useState(999);

    // NC Reprint state (manual labeling panel)
    const [ncReprintLoading, setNcReprintLoading] = useState(false);
    const [lotNcData, setLotNcData] = useState(null); // { defective, approved, defect_reasons } fetched when lot is selected
    const [ncManualQty, setNcManualQty] = useState(''); // custom label count for manual NC reprint

    // Persist printer mode
    useEffect(() => { localStorage.setItem('zone_printer_mode', printerMode); }, [printerMode]);

    // ── Listen for Bluetooth state changes + auto-reconnect ──
    useEffect(() => {
        if (printerMode !== 'bluetooth') return;
        const unsub = printer.onStateChange(({ connected, name }) => {
            setPrinterConnected(connected);
            setPrinterName(name || '');
        });
        printer.tryAutoReconnect().then(result => {
            if (result.connected) {
                setPrinterConnected(true);
                setPrinterName(result.name || '');
            }
        });
        return unsub;
    }, [printerMode]);

    // Auto-switch al modo Zebra si la Zebra está conectada y el Bluetooth no lo está
    useEffect(() => {
        if (zebraStatus === 'connected' && !printerConnected) {
            setPrinterMode('network');
        }
    }, [zebraStatus, printerConnected]);

    const checkZebraRelay = recheckNow;

    const sendToZebra = async (zpl) => {
        const result = await printZPL(zpl);
        if (!result.ok) { throw new Error(result.error || 'Error de impresión'); }
    };


    const isPrinterReady = printerMode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';

    // ── Connect Bluetooth printer ──
    const handleConnectPrinter = async () => {
        try {
            if (printerConnected) {
                const result = await printer.reconnect();
                if (result.connected) {
                    setPrinterConnected(true);
                    setPrinterName(result.name);
                }
            } else {
                const result = await printer.connect();
                setPrinterConnected(true);
                setPrinterName(result.name);
            }
        } catch (err) {
            console.error('Connection error:', err);
            message.error(err.message || 'Error conectando impresora');
        }
    };

    // ── Siigo Adjustment RPA Helper ──
    const handleSiigoAdjustment = async () => {
        if (!adjustmentData.quantity || isNaN(adjustmentData.quantity) || parseFloat(adjustmentData.quantity) <= 0) {
            message.warning('Ingrese una cantidad válida mayor a 0');
            return;
        }
        if (!adjustmentData.accountCode || !adjustmentData.accountCode.trim()) {
            message.warning('El código contable es obligatorio');
            return;
        }
        
        try {
            setSiigoAdjusting(true);
            const payload = {
                productName: adjustmentData.product?.name || '',
                productSku: adjustmentData.product?.sku || '',
                quantity: parseFloat(adjustmentData.quantity),
                accountCode: adjustmentData.accountCode.trim(),
                finishedLotStockId: adjustmentData.lot?.id || null,
                lotNumber: adjustmentData.lot?.lotNumber || null,
                productId: adjustmentData.lot?.productId || null,
            };
            
            const res = await api.post('/rpa/siigo-adjustment', payload);
            
            message.success(res.data.message || 'Bot RPA de ajuste encolado correctamente');
            setShowSiigoAdjustment(false);
            setAdjustmentData({ lot: null, product: null, accountCode: '71050504', quantity: '' });
            
        } catch (error) {
            console.error('Error triggering Siigo adjustment:', error);
            message.error(error.response?.data?.error || 'No se pudo encolar el ajuste en Siigo');
        } finally {
            setSiigoAdjusting(false);
        }
    };

    // ── Fetch summary periodically ──
    const loadStock = useCallback(async () => {
        setLoading(true);
        setStocks([]); // Clear stale data immediately on zone change
        try {
            // BODEGA uses MaterialLot via a different endpoint
            const endpoint = activeZone === 'BODEGA' ? '/finished-lots/warehouse-stock' : '/finished-lots/stock';
            const params = activeZone === 'BODEGA' ? {} : { zone: activeZone };
            const res = await api.get(endpoint, { params });
            let data = res.data?.stocks || [];
            if (search) {
                const q = search.toLowerCase();
                data = data.filter(s => s.product?.name?.toLowerCase().includes(q) || s.lotNumber?.toLowerCase().includes(q) || s.product?.sku?.toLowerCase().includes(q));
            }
            setStocks(data);
        } catch (e) { console.error(e); setStocks([]); }
        finally { setLoading(false); }
    }, [activeZone, search]);

    const loadSummary = async () => {
        try {
            const res = await api.get('/finished-lots/summary');
            setSummary(res.data?.summary || {});
        } catch (e) { console.error(e); }
    };

    const loadMovements = async () => {
        setMovLoading(true);
        try {
            const res = await api.get('/finished-lots/movements', { params: { limit: 30 } });
            setMovements(res.data?.transfers || []);
        } catch (e) { console.error(e); }
        finally { setMovLoading(false); }
    };

    useEffect(() => { loadStock(); loadSummary(); }, [loadStock]);
    useEffect(() => { loadMovements(); }, []);

    // ── Product search for manual ingestion ──
    const handleIngestionSearch = async (val) => {
        setIngestionSearch(val);
        if (val.length < 2) { setIngestionResults([]); return; }
        setIngestionSearching(true);
        try {
            const res = await api.get('/finished-lots/search-products', { params: { q: val } });
            setIngestionResults(res.data || []);
        } catch { }
        finally { setIngestionSearching(false); }
    };

    // ── Load available lots when product is selected ──
    const loadProductLots = async (productId) => {
        setLotsLoading(true);
        try {
            const res = await api.get(`/finished-lots/production-lots/${productId}`);
            setAvailableLots(res.data || []);
            setManualLotMode((res.data || []).length === 0);
        } catch { setAvailableLots([]); setManualLotMode(true); }
        finally { setLotsLoading(false); }
    };

    const selectIngestionProduct = (p) => {
        setIngestionProduct(p);
        setIngestionResults([]);
        setIngestionSearch('');
        setIngestionLot('');
        setIngestionQrUrl('');
        // Auto-fill Uds por Caja from product packSize
        if (p.packSize && p.packSize > 1) {
            setIngestionUnitsPerBox(String(p.packSize));
        }
        loadProductLots(p.id);
    };

    const handleIngest = async () => {
        if (!ingestionProduct) { message.error('Seleccione un producto'); return; }
        if (!ingestionLot.trim()) { message.error('Ingrese número de lote'); return; }
        const qty = parseInt(ingestionQty);
        if (!qty || qty <= 0) { message.error('Ingrese cantidad válida'); return; }
        setIngesting(true);
        try {
            await api.post('/finished-lots/ingest', {
                productId: ingestionProduct.id,
                lotNumber: ingestionLot.trim(),
                quantity: qty,
                zone: ingestionZone,
                expiresAt: ingestionExpiry || null,
            });
            const zoneName = ZONES.find(z => z.key === ingestionZone)?.label || ingestionZone;
            setSuccessModal({ qty, productName: ingestionProduct.name, zoneName });
            setIngestionRegistered(true);
            loadStock(); loadSummary(); loadMovements();
        } catch (e) {
            const errMsg = e.response?.data?.error || e.message || 'Error al registrar';
            if (errMsg.startsWith('DUPLICATE_INGESTION:')) {
                const detail = errMsg.replace('DUPLICATE_INGESTION:', '').trim();
                message.warning({
                    content: `⚠️ Ingreso duplicado detectado – ${detail}`,
                    duration: 8,
                });
            } else if (errMsg.startsWith('ASSEMBLY_INCOMPLETE:')) {
                const detail = errMsg.replace('ASSEMBLY_INCOMPLETE:', '').trim();
                message.error({
                    content: `🚫 Ensamble incompleto – ${detail}`,
                    duration: 10,
                });
            } else {
                message.error(errMsg);
            }
        } finally { setIngesting(false); }

    };


    // ── QR Generation for label (centralized via qrService) ──
    const generateIngestionQR = async () => {
        if (!ingestionProduct || !ingestionLot) return;
        try {
            const { dataUrl } = await generateQrDataUrl(ingestionProduct.id, {
                lotNumber: ingestionLot.trim(),
                quantity: parseInt(ingestionUnitsPerBox) || parseInt(ingestionQty) || 0,
                expiresAt: ingestionExpiry || '',
            });
            setIngestionQrUrl(dataUrl);
            // Check for pending box
            const boxSize = parseInt(ingestionUnitsPerBox) || 0;
            if (boxSize > 0 && ingestionProduct?.id) {
                try {
                    const res = await api.get(`/finished-lots/pending-box/${ingestionProduct.id}`, { params: { boxSize } });
                    setPendingBox(res.data || null);
                } catch { setPendingBox(null); }
            }
        } catch (e) { console.error('QR error:', e); }
    };

    const printIngestionLabel = async () => {
        if (!ingestionQrUrl || !ingestionProduct) return;
        
        if (!isPrinterReady) {
            message.warning(printerMode === 'bluetooth' ? 'Conecte la impresora Bluetooth' : 'Verifique la conexión Zebra');
            return;
        }

        const uPerBox = parseInt(ingestionUnitsPerBox) || 0;
        const totalUnits = parseInt(ingestionQty) || 0;
        if (uPerBox <= 0 || totalUnits <= 0) { message.warning('Ingrese cantidad y uds por caja'); return; }

        const currentLot = ingestionLot.trim();
        const currentExpiry = ingestionExpiry || null;

        // Manual labeling: print ONLY what the user requests. No auto NC labels.
        // Calculate boxes using the user-entered totalUnits
        const fullBoxes = Math.floor(totalUnits / uPerBox);
        const remainder = totalUnits % uPerBox;
        const totalLabels = fullBoxes + (remainder > 0 ? 1 : 0);

        // Build TSPL: each normal label (approved units only)
        let tsplPayload = '';
        for (let i = 1; i <= totalLabels; i++) {
            const isRemainder = i === totalLabels && remainder > 0;
            const boxQty = isRemainder ? remainder : uPerBox;
            tsplPayload += buildLotLabel({
                productName: ingestionProduct.name,
                sku: ingestionProduct.sku,
                barcode: ingestionProduct.barcode || '',
                lotNumber: currentLot,
                quantity: boxQty,
                unit: 'und',
                receivedAt: new Date().toISOString(),
                expiresAt: currentExpiry ? new Date(currentExpiry).toISOString() : null,
                boxNumber: i, totalBoxes: totalLabels,
            }, 1, { maquila: isMaquilaLabel });
        }


        // Manage pending box (informational tracking)
        if (remainder > 0) {
            // There's an incomplete box — save/update pending box
            const prevEntries = pendingBox?.entries || [];
            const newEntries = [...prevEntries, { lot: currentLot, qty: remainder, expiry: currentExpiry }];
            try {
                await api.post('/finished-lots/pending-box', {
                    productId: ingestionProduct.id, boxSize: uPerBox,
                    isMaquila: isMaquilaLabel, entries: newEntries,
                });
            } catch {}
        } else if (pendingBox) {
            // This lot has no remainder — clear any old pending box
            try { await api.delete(`/finished-lots/pending-box/${pendingBox.id}`); } catch {}
        }

        // Send to printer (dual mode)
        setPrinting(true);
        try {
            if (printerMode === 'network') {
                // Zebra: build ZPL for each label and send
                for (let i = 1; i <= totalLabels; i++) {
                    const isRem = i === totalLabels && remainder > 0;
                    const boxQty = isRem ? remainder : uPerBox;
                    const zpl = buildLotLabelZPL({
                        productName: ingestionProduct.name,
                        sku: ingestionProduct.sku,
                        barcode: ingestionProduct.barcode || '',
                        lotNumber: currentLot,
                        quantity: boxQty,
                        unit: 'und',
                        receivedAt: new Date().toISOString(),
                        expiresAt: currentExpiry ? new Date(currentExpiry).toISOString() : null,
                        boxNumber: i, totalBoxes: totalLabels,
                    }, 1, { maquila: isMaquilaLabel });
                    await sendToZebra(zpl);
                }

            } else {
                await printer.sendTSPL(tsplPayload);
            }
            let msg = `✅ ${totalLabels} etiqueta(s) — ${totalUnits} uds`;
            if (remainder > 0) msg += ` (última caja: ${remainder} uds)`;
            message.success(msg);
            setPendingBox(null);
        } catch (err) {
            console.error('Print error:', err);
            if (err.message?.includes('NetworkError') || err.message?.includes('disconnected') || err.message?.includes('GATT')) {
                message.error('Conexión perdida con la impresora');
                setPrinterConnected(false);
            } else {
                message.error('Error al imprimir: ' + err.message);
            }
        } finally {
            setPrinting(false);
        }
    };

    const resetIngestionForm = () => {
        setIngestionProduct(null); setIngestionLot(''); setIngestionQty(''); setIngestionUnitsPerBox('');
        setIngestionExpiry(''); setIngestionSearch(''); setIngestionResults([]); setIngestionQrUrl('');
        setIngestionRegistered(false); setAvailableLots([]); setManualLotMode(false); setLotNcData(null); setNcManualQty('');
    };

    // ── Transfer ──
    const openTransfer = async (stock) => {
        const defaultDests = { PRODUCCION: 'PRODUCTO_TERMINADO', PRODUCTO_TERMINADO: 'NO_CONFORME', NO_CONFORME: 'PRODUCTO_TERMINADO', BODEGA: 'PRODUCTO_TERMINADO', CUARENTENA: 'PRODUCTO_TERMINADO', MAQUILA: 'PRODUCTO_TERMINADO' };
        const defaultTo = defaultDests[activeZone] || 'PRODUCTO_TERMINADO';
        setSelectedStock(stock);
        setTransferEmpaque(null);
        setTransferData({
            productId: stock.productId,
            lotNumber: stock.lotNumber,
            toZone: '',
            quantity: '',
            reason: '',
            observations: '',
        });
        setShowTransfer(true);
        // Fetch empaque limits for this lot+product
        if (activeZone === 'PRODUCCION') {
            try {
                const res = await api.get(`/finished-lots/lot-summary/${encodeURIComponent(stock.lotNumber)}`);
                const match = (res.data || []).find(s => s.productId === stock.productId);
                if (match && match.approved != null) {
                    setTransferEmpaque({ approved: match.approved, defective: match.defective || 0 });
                }
            } catch (e) { console.error('empaque fetch error:', e); }
        }
    };

    const handleTransfer = async () => {
        const qty = parseInt(transferData.quantity);
        if (!qty || qty <= 0) { message.error('Ingrese cantidad válida'); return; }
        if (!transferData.toZone) { message.error('Seleccione zona destino'); return; }
        setTransferring(true);
        try {
            if (activeZone === 'BODEGA' && selectedStock?.source === 'materialLot') {
                // MaterialLot warehouse transfer uses a dedicated endpoint
                await api.post('/finished-lots/warehouse-transfer', {
                    materialLotId: selectedStock?.id,
                    productId: transferData.productId,
                    lotNumber: transferData.lotNumber,
                    quantity: qty,
                });
            } else {
                await api.post('/finished-lots/transfer', {
                    productId: transferData.productId,
                    lotNumber: transferData.lotNumber,
                    fromZone: activeZone,
                    toZone: transferData.toZone,
                    quantity: qty,
                    reason: transferData.reason || null,
                    observations: transferData.observations || null,
                });
            }
            const zoneName = ZONES.find(z => z.key === transferData.toZone)?.label;
            setSuccessModal({ qty, productName: selectedStock?.product?.name || '', zoneName: zoneName || 'Producto Terminado' });
            setShowTransfer(false);
            loadStock();
            loadSummary();
            loadMovements();
        } catch (e) {
            message.error(e.response?.data?.error || 'Error en transferencia');
        } finally { setTransferring(false); }
    };

    const allowedKeys = ZONE_DESTINATIONS[activeZone] || [];
    const validDestinations = ZONES.filter(z => allowedKeys.includes(z.key));

    const fmtDate = (d) => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

    // ── Render ──
    return (
        <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Warehouse size={24} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#1e293b' }}>Zonas de Producto Terminado</h1>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>Control de stock por lote y transferencias entre zonas</p>
                </div>
                {/* Inline printer connection — mode toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => setPrinterMode('bluetooth')} style={{
                        padding: '4px 10px', borderRadius: '8px 0 0 8px', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer',
                        background: printerMode === 'bluetooth' ? '#6366f1' : '#f1f5f9', color: printerMode === 'bluetooth' ? '#fff' : '#94a3b8',
                        border: 'none', display: 'flex', alignItems: 'center', gap: 4,
                    }}><Bluetooth size={12} /> SAT</button>
                    <button onClick={() => setPrinterMode('network')} style={{
                        padding: '4px 10px', borderRadius: '0 8px 8px 0', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer',
                        background: printerMode === 'network' ? '#059669' : '#f1f5f9', color: printerMode === 'network' ? '#fff' : '#94a3b8',
                        border: 'none', display: 'flex', alignItems: 'center', gap: 4,
                    }}><Wifi size={12} /> Zebra</button>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                        background: isPrinterReady ? '#ecfdf5' : '#f8fafc',
                        borderRadius: 8, border: `1.5px solid ${isPrinterReady ? '#6ee7b7' : '#e2e8f0'}`,
                    }}>
                        {printerMode === 'bluetooth' ? (
                            <>
                                {printerConnected ? <Bluetooth size={13} color="#059669" /> : <BluetoothOff size={13} color="#94a3b8" />}
                                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: isPrinterReady ? '#065f46' : '#64748b', whiteSpace: 'nowrap' }}>
                                    {printerConnected ? printerName : 'Sin impresora'}
                                </span>
                                <button onClick={handleConnectPrinter} style={{
                                    padding: '2px 8px', borderRadius: 5, fontSize: '0.64rem', fontWeight: 700, cursor: 'pointer',
                                    background: printerConnected ? '#fff' : '#4f46e5', color: printerConnected ? '#059669' : '#fff',
                                    border: printerConnected ? '1px solid #10b981' : 'none',
                                }}>{printerConnected ? '🔄' : 'Conectar'}</button>
                            </>
                        ) : (
                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Wifi size={13} color={zebraStatus === 'connected' ? '#059669' : '#94a3b8'} className={isRechecking ? 'animate-pulse' : ''} />
                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: zebraStatus === 'connected' ? '#065f46' : '#64748b', whiteSpace: 'nowrap' }}>
                                        {zebraStatus === 'connected' ? `🟢 Zebra ${zebraIp}` : isRechecking ? '🟡 Reconectando...' : '🔴 Sin conexión'}
                                    </span>
                                    <button 
                                        onClick={() => {
                                            recheckNow();
                                            window.open(`http://${configIp || '192.168.0.126'}/index.html`, 'zebra_pna_wake', 'width=300,height=300');
                                        }} 
                                        disabled={isRechecking}
                                        style={{
                                            padding: '2px 8px', borderRadius: 5, fontSize: '0.64rem', fontWeight: 700, cursor: 'pointer',
                                            background: isRechecking ? '#94a3b8' : '#fff', color: isRechecking ? '#fff' : '#059669', border: '1px solid #10b981',
                                        }}
                                    >
                                        {isRechecking ? '...' : '🔄'}
                                    </button>
                                    <button onClick={() => setShowZebraSettings(!showZebraSettings)} style={{
                                        padding: '2px 8px', borderRadius: 5, fontSize: '0.64rem', cursor: 'pointer',
                                        background: showZebraSettings ? '#f3f4f6' : '#fff', color: '#4b5563', border: '1px solid #d1d5db',
                                    }}>
                                        <Settings size={12} />
                                    </button>
                                </div>
                                {showZebraSettings && (
                                    <div style={{ 
                                        position: 'absolute', top: '100%', right: 0, marginTop: 10, width: 220, zIndex: 100,
                                        background: '#fff', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
                                    }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 8, color: '#334155' }}>Ajustes Zebra (Tablet)</div>
                                        <label style={{ fontSize: '0.65rem', color: '#64748b', display: 'block', marginBottom: 2 }}>IP Impresora</label>
                                        <input value={editIp} onChange={e => setEditIp(e.target.value)} 
                                            style={{ width: '100%', padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.75rem', marginBottom: 8 }} />
                                        
                                        <label style={{ fontSize: '0.65rem', color: '#64748b', display: 'block', marginBottom: 2 }}>IP Relay (PC Puente)</label>
                                        <input value={editRelay} onChange={e => setEditRelay(e.target.value)} placeholder="Ej: 192.168.0.100"
                                            style={{ width: '100%', padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.75rem', marginBottom: 12 }} />
                                        
                                        <button onClick={() => { updateConfig(editIp, editRelay); setShowZebraSettings(false); recheckNow(); }}
                                            style={{ width: '100%', padding: '6px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                                            Guardar y Aplicar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Manual Ingestion Panel */}
            <div style={{ marginBottom: 16 }}>
                <button onClick={() => setShowIngestion(!showIngestion)} style={{
                    width: '100%', padding: '12px 20px', border: '2px solid #10b981', borderRadius: 14,
                    background: showIngestion ? '#ecfdf5' : '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.9rem',
                    color: '#059669', transition: 'all 0.2s',
                }}>
                    <Plus size={18} /> 🏷️ Etiquetado Manual
                    {showIngestion ? <ChevronUp size={16} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={16} style={{ marginLeft: 'auto' }} />}
                </button>

                {showIngestion && (
                    <div style={{ border: '2px solid #10b981', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: 20, background: '#f0fdf4' }}>
                        <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#059669' }}>
                            Seleccione producto y lote, genere la etiqueta QR e imprima. Solo LIQUIPOPS, GENIALITY y LIQUIMON.
                        </p>

                        {/* Row 1: Product + Lot */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div>
                                <label style={lblStyle}>Producto *</label>
                                {ingestionProduct ? (
                                    <div style={{ padding: '8px 12px', border: '2px solid #10b981', borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{ingestionProduct.name}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{ingestionProduct.sku} · Barcode: {ingestionProduct.barcode || '-'}</div>
                                        </div>
                                        <button onClick={resetIngestionForm}
                                            style={{ border: 'none', background: '#fef2f2', color: '#ef4444', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>✕</button>
                                    </div>
                                ) : (
                                    <div style={{ position: 'relative' }}>
                                        <input value={ingestionSearch} onChange={e => handleIngestionSearch(e.target.value)}
                                            placeholder="Buscar producto..."
                                            style={inputStyle}
                                        />
                                        {ingestionSearching && <Spin size="small" style={{ position: 'absolute', right: 8, top: 10 }} />}
                                        {ingestionResults.length > 0 && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '2px solid #e2e8f0', borderRadius: 10, maxHeight: 200, overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                                                {ingestionResults.map(p => (
                                                    <div key={p.id} onClick={() => selectIngestionProduct(p)}
                                                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.82rem' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                                                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                                                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{p.sku} · Barcode: {p.barcode || '-'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={lblStyle}>Número de Lote * {ingestionProduct && <button onClick={() => setManualLotMode(!manualLotMode)} style={{ border: 'none', background: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, textDecoration: 'underline' }}>{manualLotMode ? '📋 Ver lotes existentes' : '✏️ Ingresar manual'}</button>}</label>
                                {manualLotMode ? (
                                    <input value={ingestionLot} onChange={e => { setIngestionLot(e.target.value); setIngestionQrUrl(''); }}
                                        placeholder="Ej: FRESA-260320-0943" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                                ) : (
                                    <div>
                                        {lotsLoading ? <Spin size="small" /> : availableLots.length === 0 ? (
                                            <div style={{ padding: '8px 12px', border: '2px solid #fbbf24', borderRadius: 10, background: '#fffbeb', fontSize: '0.82rem', color: '#92400e' }}>
                                                No hay lotes producidos. <button onClick={() => setManualLotMode(true)} style={{ border: 'none', background: 'none', color: '#6366f1', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}>Ingresar manual</button>
                                            </div>
                                        ) : (
                                            <select value={ingestionLot} onChange={e => {
                                                    const lot = e.target.value;
                                                    setIngestionLot(lot);
                                                    setIngestionQrUrl('');
                                                    // Auto-fill expiry from persisted expiresAt (INVIMA)
                                                    const selected = availableLots.find(l => l.lotNumber === lot);
                                                    if (selected?.expiresAt) {
                                                        setIngestionExpiry(new Date(selected.expiresAt).toISOString().split('T')[0]);
                                                    } else if (lot) {
                                                        let fabDate = selected?.date ? new Date(selected.date) : null;
                                                        if (!fabDate) {
                                                            const m = lot.match(/(\d{6})-\d{3,6}$/);
                                                            if (m) {
                                                                const [yy, mm, dd] = [m[1].substring(0,2), m[1].substring(2,4), m[1].substring(4,6)];
                                                                fabDate = new Date(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd));
                                                            }
                                                        }
                                                        if (fabDate && !isNaN(fabDate.getTime())) {
                                                            const exp = new Date(fabDate);
                                                            // Sirope: 12 months shelf life, others: 9 months
                                                            const isSirope = /SIROPE/i.test(ingestionProduct?.name || '');
                                                            exp.setMonth(exp.getMonth() + (isSirope ? 12 : 9));
                                                            setIngestionExpiry(exp.toISOString().split('T')[0]);
                                                        }
                                                    }
                                                    // Load lot stock summary (no auto-fill — user enters qty manually)
                                                    loadLotSummary(lot);
                                                }}
                                                style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer' }}>
                                                <option value="">Seleccionar lote...</option>
                                                {availableLots.map(l => (
                                                    <option key={l.lotNumber} value={l.lotNumber}>
                                                        {l.lotNumber} {l.source === 'production' ? `(${l.status})` : '(registrado)'}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Lot Stock Summary with empaque breakdown */}
                        {ingestionLot && lotSummary.length > 0 && (
                            <div style={{ background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0369a1', marginBottom: 8 }}>📦 Stock del lote <span style={{ fontFamily: 'monospace' }}>{ingestionLot}</span>:</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {lotSummary.filter(s => !ingestionProduct || s.productId === ingestionProduct.id).map((s, i) => {
                                        const isSelected = ingestionProduct?.id === s.productId;
                                        return (
                                            <div key={i} style={{
                                                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                                background: isSelected ? '#ecfdf5' : '#fff', borderRadius: 8,
                                                border: `1.5px solid ${isSelected ? '#10b981' : '#e2e8f0'}`,
                                                flexWrap: 'wrap',
                                            }}>
                                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', flex: 1, minWidth: 160 }}>
                                                    {s.productName || s.sku}
                                                </span>
                                                <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>
                                                    Stock en producción: <strong style={{ color: '#0369a1', fontSize: '0.82rem' }}>{s.quantity}</strong>
                                                </span>
                                                {s.approved != null && (
                                                    <>
                                                        <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600, background: '#d1fae5', padding: '3px 8px', borderRadius: 4 }}>
                                                            Aprobados en empaque: <strong>{s.approved}</strong>
                                                        </span>
                                                        {s.defective > 0 && (
                                                            <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600, background: '#fee2e2', padding: '3px 8px', borderRadius: 4 }}>
                                                                Rechazados en empaque: <strong>{s.defective}</strong>
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── NC Reprint Panel ── Show when selected lot has defective units */}
                        {ingestionProduct && ingestionLot && lotNcData?.defective > 0 && (() => {
                            // Exact same logic as MarcadoCajasStep defective label printing
                            const defectiveTarros = lotNcData.defective;
                            const printNc = async (mode, customN) => {
                                // mode: 'individual' | 'grupal' | 'manual'
                                // nDefective = how many labels; defPerBox = qty per label
                                const nDefective = mode === 'individual' ? defectiveTarros
                                    : mode === 'manual' ? (customN || 1)
                                    : 1; // grupal
                                const defPerBox  = nDefective > 0 ? Math.ceil(defectiveTarros / nDefective) : 0;
                                const delay      = printerMode === 'bluetooth' ? 1500 : 300;
                                const baseData   = {
                                    productName: ingestionProduct.name,
                                    sku:         ingestionProduct.sku,
                                    barcode:     ingestionProduct.barcode || '',
                                    lotNumber:   ingestionLot,
                                    unit:        'und',
                                    receivedAt:  new Date().toISOString(),
                                    expiresAt:   ingestionExpiry ? new Date(ingestionExpiry).toISOString() : null,
                                    statusText:  'OUTLET - PUBLICIDAD',
                                };
                                if (printerMode === 'network') {
                                    // Zebra: single ZPL job with ^PQ{nDefective}
                                    const zpl = buildLotLabelZPL({ ...baseData, quantity: defPerBox }, nDefective);
                                    await sendToZebra(zpl);
                                } else {
                                    // Bluetooth: loop individual labels with delay (same as MarcadoCajas)
                                    for (let i = 0; i < nDefective; i++) {
                                        const qty = (i === nDefective - 1 && defectiveTarros > 0)
                                            ? defectiveTarros - (defPerBox * i)
                                            : defPerBox;
                                        const tspl = buildLotLabel({ ...baseData, quantity: qty }, 1);
                                        await printer.sendTSPL(tspl);
                                        if (i < nDefective - 1) await new Promise(r => setTimeout(r, delay));
                                    }
                                }
                            };
                            return (
                                <div style={{
                                    background: 'linear-gradient(135deg, #fef2f2, #fff1f2)',
                                    border: '2px solid #fca5a5',
                                    borderRadius: 12, padding: '14px 16px', marginBottom: 10,
                                }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#b91c1c', marginBottom: 6 }}>
                                        📦 OUTLET - PUBLICIDAD &nbsp;·&nbsp; {defectiveTarros} unidad{defectiveTarros > 1 ? 'es' : ''} &nbsp;·&nbsp;
                                        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ingestionLot}</span>
                                    </div>
                                    {lotNcData.defect_reasons?.length > 0 && (
                                        <div style={{ fontSize: '0.7rem', color: '#dc2626', marginBottom: 8 }}>
                                            Causas: {lotNcData.defect_reasons.map(r => r.cause || r).filter(Boolean).join(', ')}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                        {/* Individual: 1 etiqueta por unidad (misma lógica MarcadoCajas) */}
                                        <button
                                            disabled={ncReprintLoading || !isPrinterReady}
                                            onClick={async () => {
                                                setNcReprintLoading(true);
                                                try {
                                                    await printNc('individual');
                                                    message.success(`✅ ${defectiveTarros} etiqueta${defectiveTarros > 1 ? 's' : ''} OUTLET impresa${defectiveTarros > 1 ? 's' : ''} (1 por unidad)`);
                                                } catch (err) { message.error('Error: ' + err.message); }
                                                finally { setNcReprintLoading(false); }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                padding: '7px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                                background: (!isPrinterReady || ncReprintLoading) ? '#fecaca' : '#dc2626',
                                                color: '#fff', fontWeight: 800, fontSize: '0.78rem',
                                                opacity: (!isPrinterReady || ncReprintLoading) ? 0.5 : 1,
                                            }}
                                        >
                                            <Printer size={14} />
                                            {ncReprintLoading ? 'Imprimiendo...' : `🔁 Individual (${defectiveTarros} etiqueta${defectiveTarros > 1 ? 's' : ''})`}
                                        </button>
                                        {/* Grupal: 1 etiqueta con el total */}
                                        <button
                                            disabled={ncReprintLoading || !isPrinterReady}
                                            onClick={async () => {
                                                setNcReprintLoading(true);
                                                try {
                                                    await printNc('grupal');
                                                    message.success(`✅ 1 etiqueta OUTLET grupal — ${defectiveTarros} uds`);
                                                } catch (err) { message.error('Error: ' + err.message); }
                                                finally { setNcReprintLoading(false); }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                padding: '7px 13px', borderRadius: 8, border: '2px solid #dc2626', cursor: 'pointer',
                                                background: '#fff',
                                                color: '#dc2626', fontWeight: 800, fontSize: '0.78rem',
                                                opacity: (!isPrinterReady || ncReprintLoading) ? 0.5 : 1,
                                            }}
                                        >
                                            <Printer size={14} />
                                            📦 Grupal (1 — {defectiveTarros} uds)
                                        </button>
                                        {!isPrinterReady && (
                                            <span style={{ fontSize: '0.7rem', color: '#9f1239', fontStyle: 'italic' }}>
                                                ⚠️ Conecte impresora
                                            </span>
                                        )}
                                    </div>
                                    {/* Manual: cantidad libre */}
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1.5px dashed #fca5a5', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7f1d1d' }}>✏️ Manual:</span>
                                        <input
                                            type="number" min="1" max={defectiveTarros * 10}
                                            placeholder={`1 - ${defectiveTarros}`}
                                            value={ncManualQty}
                                            onChange={e => setNcManualQty(e.target.value)}
                                            style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1.5px solid #fca5a5', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center' }}
                                        />
                                        <span style={{ fontSize: '0.68rem', color: '#9f1239' }}>etiqueta{Number(ncManualQty) !== 1 ? 's' : ''}</span>
                                        <button
                                            disabled={ncReprintLoading || !isPrinterReady || !Number(ncManualQty)}
                                            onClick={async () => {
                                                const n = Number(ncManualQty);
                                                if (!n || n < 1) return;
                                                setNcReprintLoading(true);
                                                try {
                                                    await printNc('manual', n);
                                                    message.success(`✅ ${n} etiqueta${n > 1 ? 's' : ''} OUTLET impresa${n > 1 ? 's' : ''}`);
                                                } catch (err) { message.error('Error: ' + err.message); }
                                                finally { setNcReprintLoading(false); }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 4,
                                                padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                                                background: (!isPrinterReady || ncReprintLoading || !Number(ncManualQty)) ? '#fecaca' : '#991b1b',
                                                color: '#fff', fontWeight: 800, fontSize: '0.75rem',
                                                opacity: (!isPrinterReady || ncReprintLoading || !Number(ncManualQty)) ? 0.5 : 1,
                                            }}
                                        >
                                            <Printer size={13} /> Imprimir
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Zone distribution for selected lot */}
                        {ingestionLot && lotZones.length > 0 && (
                            <div style={{ background: '#faf5ff', border: '1.5px solid #d8b4fe', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>📍 Distribución por zona</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {(() => {
                                        const ZONE_LABELS = { WAREHOUSE: '🏢 Bodega', PRODUCTION: '🏭 Producción', PRODUCTO_TERMINADO: '📦 Prod. Terminado', NO_CONFORME: '⚠️ No Conforme', CUARENTENA: '🔒 Cuarentena', MAQUILA: '🏷️ Maquila' };
                                        const ZONE_COLORS = { WAREHOUSE: '#3b82f6', PRODUCTION: '#10b981', PRODUCTO_TERMINADO: '#8b5cf6', NO_CONFORME: '#ef4444', CUARENTENA: '#eab308', MAQUILA: '#f97316' };
                                        return lotZones.map((z, i) => (
                                            <span key={i} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: `${ZONE_COLORS[z.zone] || '#64748b'}18`, color: ZONE_COLORS[z.zone] || '#64748b', border: `1px solid ${ZONE_COLORS[z.zone] || '#64748b'}40` }}>
                                                {ZONE_LABELS[z.zone] || z.zone}: <strong>{z.currentQuantity} uds</strong>
                                            </span>
                                        ));
                                    })()}
                                </div>
                            </div>
                        )}

                        {/* Row 2: Qty, Units per box, Expiry */}
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 140px 160px', gap: 12, marginBottom: 14 }}>
                            <div>
                                <label style={lblStyle}>Total Unidades *</label>
                                <input type="number" min="1" value={ingestionQty} onChange={e => { setIngestionQty(e.target.value); setIngestionQrUrl(''); }}
                                    placeholder="Uds" style={{ ...inputStyle, fontWeight: 700 }} />
                            </div>
                            <div>
                                <label style={lblStyle}>Uds por Caja</label>
                                <input type="number" min="1" value={ingestionUnitsPerBox} onChange={e => { setIngestionUnitsPerBox(e.target.value); setIngestionQrUrl(''); }}
                                    placeholder="(etiqueta)" style={inputStyle} />
                            </div>
                            <div>
                                <label style={lblStyle}>Fecha Vencimiento</label>
                                <input type="date" value={ingestionExpiry} onChange={e => { setIngestionExpiry(e.target.value); setIngestionQrUrl(''); }}
                                    style={inputStyle} />
                            </div>
                        </div>

                        {/* Row 3: Actions + QR Preview */}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '2px solid #d1fae5', paddingTop: 14 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, flex: 1 }}>
                                {/* Printer Connection UI — dual mode */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, width: '100%', maxWidth: '480px' }}>
                                    <button onClick={() => setPrinterMode('bluetooth')} style={{
                                        padding: '5px 10px', borderRadius: '8px 0 0 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                                        background: printerMode === 'bluetooth' ? '#6366f1' : '#f1f5f9', color: printerMode === 'bluetooth' ? '#fff' : '#94a3b8',
                                        border: 'none', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                                    }}><Bluetooth size={13} /> SAT</button>
                                    <button onClick={() => setPrinterMode('network')} style={{
                                        padding: '5px 10px', borderRadius: '0 8px 8px 0', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                                        background: printerMode === 'network' ? '#059669' : '#f1f5f9', color: printerMode === 'network' ? '#fff' : '#94a3b8',
                                        border: 'none', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                                    }}><Wifi size={13} /> Zebra</button>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: isPrinterReady ? '#ecfdf5' : '#f8fafc', borderRadius: 8, border: `1.5px solid ${isPrinterReady ? '#6ee7b7' : '#e2e8f0'}` }}>
                                        {printerMode === 'bluetooth' ? (
                                            <>
                                                {printerConnected ? <Bluetooth size={14} color="#059669" /> : <BluetoothOff size={14} color="#94a3b8" />}
                                                <span style={{ flex: 1, fontSize: '0.72rem', fontWeight: 600, color: isPrinterReady ? '#065f46' : '#64748b' }}>
                                                    {printerConnected ? `🟢 ${printerName}` : 'Sin impresora'}
                                                </span>
                                                <button onClick={handleConnectPrinter} style={{ padding: '3px 8px', background: printerConnected ? '#fff' : '#6366f1', color: printerConnected ? '#059669' : '#fff', border: printerConnected ? '1.5px solid #10b981' : 'none', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}>
                                                    {printerConnected ? 'Reconectar' : 'Conectar'}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <Wifi size={14} color={zebraStatus === 'connected' ? '#059669' : '#94a3b8'} />
                                                <span style={{ flex: 1, fontSize: '0.72rem', fontWeight: 600, color: zebraStatus === 'connected' ? '#065f46' : '#64748b' }}>
                                                    {zebraStatus === 'connected' ? `🟢 Zebra ${zebraIp}` : zebraStatus === 'checking' ? '🟡 Verificando...' : '🔴 Sin conexión'}
                                                </span>
                                                <button onClick={checkZebraRelay} style={{ padding: '3px 8px', background: '#fff', color: '#059669', border: '1.5px solid #10b981', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}>🔄</button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Maquila label toggle */}
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: isMaquilaLabel ? '#8b5cf6' : '#64748b', padding: '6px 10px', background: isMaquilaLabel ? '#f5f3ff' : '#f8fafc', borderRadius: 8, border: `1.5px solid ${isMaquilaLabel ? '#8b5cf6' : '#e2e8f0'}`, transition: 'all 0.15s', marginBottom: 4, width: 'fit-content' }}>
                                    <input type="checkbox" checked={isMaquilaLabel} onChange={e => { setIsMaquilaLabel(e.target.checked); setIngestionQrUrl(''); }} style={{ accentColor: '#8b5cf6' }} />
                                    🏷️ Etiqueta Maquila (sin marca)
                                </label>

                                {/* Generate QR button */}
                                <button onClick={generateIngestionQR}
                                    disabled={!ingestionProduct || !ingestionLot}
                                    style={{
                                        padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none',
                                        borderRadius: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                                        opacity: (!ingestionProduct || !ingestionLot) ? 0.4 : 1,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                    📱 Validar Datos para Etiqueta
                                </button>
                                {/* Pending box alert */}
                                {pendingBox && (
                                    <div style={{ background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: 10, padding: '8px 12px', marginBottom: 6 }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            📦 Caja pendiente — {pendingBox.currentQty}/{pendingBox.boxSize} uds
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#78350f', marginTop: 2 }}>
                                            {(pendingBox.entries || []).map((e, i) => (
                                                <span key={i}>{i > 0 && ' + '}{e.lot}: {e.qty} uds</span>
                                            ))}
                                            {' — '}Faltan <strong>{pendingBox.boxSize - pendingBox.currentQty} uds</strong> para completar
                                        </div>
                                    </div>
                                )}

                                {/* Print button */}
                                {ingestionQrUrl && (() => {
                                    const uPerBox = parseInt(ingestionUnitsPerBox) || 0;
                                    const totalU = parseInt(ingestionQty) || 0;
                                    // Manual labeling: only user-entered quantity, no auto NC
                                    const fullBoxes = uPerBox > 0 ? Math.floor(totalU / uPerBox) : 0;
                                    const remainder = uPerBox > 0 ? totalU % uPerBox : 0;
                                    const totalPrint = fullBoxes + (remainder > 0 ? 1 : 0);
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <button onClick={printIngestionLabel}
                                                    disabled={printing}
                                                    style={{
                                                        padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none',
                                                        borderRadius: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        opacity: printing ? 0.5 : 1
                                                    }}>
                                                    <Printer size={16} /> {printing ? 'Imprimiendo...' : `🖨️ Imprimir ${totalPrint} Etiqueta${totalPrint > 1 ? 's' : ''}`}
                                                </button>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, display: 'inline-block', width: 'fit-content' }}>
                                                ✅ {fullBoxes > 0 && `${fullBoxes} etiqueta${fullBoxes > 1 ? 's' : ''} × ${uPerBox} uds`}
                                                {fullBoxes > 0 && remainder > 0 && ' + '}
                                                {remainder > 0 && <span style={{ color: '#f59e0b', fontWeight: 800 }}>1 × {remainder} uds pendiente</span>}
                                                {' '}= {totalU} uds a rotular
                                            </div>
                                        </div>
                                    );
                                })()}

                            </div>

                            {/* Label HTML Preview */}
                            {ingestionQrUrl && ingestionProduct && (
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 6, fontWeight: 700 }}>Vista previa Etiqueta (50x40mm)</div>
                                    <div style={{ 
                                        width: '50mm', height: '40mm', background: '#fff', padding: '1.5mm', 
                                        display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden', 
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', border: '1px solid #cbd5e1', 
                                        fontFamily: 'Arial, sans-serif', color: '#000', textAlign: 'left'
                                    }}>
                                        {!isMaquilaLabel && <div style={{ fontSize: '8pt', fontWeight: 'bold', lineHeight: 1.1, textAlign: 'center', marginBottom: '0.5mm', textTransform: 'uppercase' }}>PRODUCTO TERMINADO</div>}
                                        <div style={{ flex: 1, display: 'flex', gap: '1.5mm' }}>
                                            <div style={{ flexShrink: 0, width: '24mm', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                                                <img src={ingestionQrUrl} alt="QR" style={{ width: '22mm', height: '22mm', imageRendering: 'pixelated', marginBottom: '0.5mm' }} />
                                                <div style={{ fontSize: '7pt', fontFamily: 'monospace', fontWeight: 'bold' }}>{ingestionLot.trim()}</div>
                                            </div>
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', fontSize: '6pt', lineHeight: 1.15, paddingTop: '1mm', borderLeft: '1px solid #000', paddingLeft: '1.5mm' }}>
                                                <div style={{ marginBottom: '2mm' }}>
                                                    {!isMaquilaLabel && <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '0.8mm' }}>{ingestionProduct.sku || ''}</div>}
                                                    <div style={{ fontSize: '6.5pt', marginBottom: '0.5mm' }}>Lote: <span style={{ fontWeight: 'bold' }}>{ingestionLot.trim()}</span></div>
                                                    <div style={{ fontSize: '5.5pt' }}>Vence: {ingestionExpiry ? new Date(ingestionExpiry).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : 'N/A'}</div>
                                                </div>
                                                <div style={{ border: '1.5px solid #000', padding: '1mm 2mm', textAlign: 'center', fontWeight: 'bold', fontSize: '7.5pt', lineHeight: 1, display: 'inline-block', alignSelf: 'flex-start' }}>
                                                    CANT: {parseInt(ingestionUnitsPerBox) || parseInt(ingestionQty) || 0}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: isMaquilaLabel ? '10pt' : '7.5pt', fontWeight: 'bold', textAlign: 'center', marginTop: '1mm', lineHeight: 1.1, textTransform: 'uppercase' }}>
                                            {isMaquilaLabel
                                                ? `PERLAS EXPLOSIVAS ${((ingestionProduct.name || '').match(/SABOR A\s+(.+?)\s+X\s+/i) || [])[1] || ''} ${(ingestionProduct.name || '').match(/\d{3,4}\s*G[R]?/i)?.[0] || ''}`
                                                : (ingestionProduct.name || '')
                                            }
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Summary cards */}
            {summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {ZONES.map(z => {
                        const data = summary[z.key] || { totalUnits: 0, totalLots: 0 };
                        return (
                            <div key={z.key}
                                onClick={() => setActiveZone(z.key)}
                                style={{
                                    background: activeZone === z.key ? z.bg : '#fff',
                                    border: `2px solid ${activeZone === z.key ? z.color : '#e2e8f0'}`,
                                    borderRadius: 16, padding: '16px 20px', cursor: 'pointer',
                                    transition: 'all 0.2s', boxShadow: activeZone === z.key ? `0 4px 12px ${z.color}22` : 'none',
                                }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span style={{ fontSize: 20 }}>{z.icon}</span>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: z.color, textTransform: 'uppercase', letterSpacing: 1 }}>{z.label}</span>
                                </div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#1e293b' }}>{Number(data.totalUnits).toLocaleString('es-CO')}</div>
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{data.totalLots} lotes · {(data.products || []).length} productos</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Zone tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
                {ZONES.map(z => (
                    <button key={z.key} onClick={() => setActiveZone(z.key)}
                        style={{
                            padding: '8px 14px', border: 'none', cursor: 'pointer',
                            borderRadius: '12px 12px 0 0', fontWeight: 700, fontSize: '0.78rem',
                            background: activeZone === z.key ? z.color : 'transparent',
                            color: activeZone === z.key ? '#fff' : '#64748b',
                            transition: 'all 0.2s',
                        }}>
                        {z.icon} {z.label}
                    </button>
                ))}
            </div>

            {/* Search + refresh */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Filtrar por producto, lote o SKU..."
                        style={{ width: '100%', padding: '8px 12px 8px 32px', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '0.85rem', outline: 'none' }}
                    />
                </div>
                <button onClick={() => { loadStock(); loadSummary(); }} style={{ padding: '8px 16px', border: '2px solid #e2e8f0', borderRadius: 10, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>
                    <RefreshCw size={14} /> Refrescar
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
            ) : stocks.length === 0 ? (
                <Empty description={`Sin stock en ${ZONES.find(z => z.key === activeZone)?.label}`} style={{ padding: 40 }} />
            ) : (() => {
                // Group stocks by product
                const groups = {};
                stocks.forEach(s => {
                    const pid = s.productId || s.product?.id || s.id;
                    if (!groups[pid]) groups[pid] = { product: s.product, lots: [], totalCurrent: 0, totalInitial: 0 };
                    groups[pid].lots.push(s);
                    groups[pid].totalCurrent += Number(s.currentQuantity) || 0;
                    groups[pid].totalInitial += Number(s.initialQuantity) || 0;
                });
                const sortedGroups = Object.values(groups).sort((a, b) => {
                    // Products with stock > 0 come first
                    const aHasStock = a.totalCurrent > 0 ? 0 : 1;
                    const bHasStock = b.totalCurrent > 0 ? 0 : 1;
                    if (aHasStock !== bHasStock) return aHasStock - bHasStock;
                    // Within same group, sort alphabetically
                    return (a.product?.name || '').localeCompare(b.product?.name || '');
                });
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                        {sortedGroups.map(g => {
                            const pct = g.totalInitial > 0 ? Math.round((g.totalCurrent / g.totalInitial) * 100) : 100;
                            const isExpanded = expandedProduct === (g.product?.id || g.lots[0]?.id);
                            const pid = g.product?.id || g.lots[0]?.id;
                            return (
                                <div key={pid} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
                                    {/* Product header */}
                                    <div onClick={() => setExpandedProduct(isExpanded ? null : pid)}
                                        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, background: isExpanded ? '#f8fafc' : '#fff', transition: 'background .1s' }}
                                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#fafafa'; }}
                                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = isExpanded ? '#f8fafc' : '#fff'; }}>
                                        <span style={{ color: '#94a3b8' }}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {g.product?.name || '—'}
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 1 }}>
                                                {g.product?.sku || ''} · {g.lots.length} lote{g.lots.length > 1 ? 's' : ''}
                                            </div>
                                        </div>
                                        {/* Stock summary - right side */}
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                                            {g.product?.currentStock !== undefined && (
                                                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', paddingRight: 10, borderRight: '1px solid #e2e8f0' }}>
                                                    <div style={{ fontSize: '0.55rem', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.05em' }}>STOCK SIIGO</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#64748b' }}>
                                                        {Number(g.product.currentStock || 0).toLocaleString('es-CO')}<span style={{fontSize:'0.65rem', color:'#94a3b8', marginLeft:2}}>uds</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Restante {g.product?.currentStock !== undefined ? 'App' : ''}</div>
                                                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: g.totalCurrent > 20 ? '#10b981' : g.totalCurrent > 5 ? '#f59e0b' : '#ef4444' }}>
                                                    {g.totalCurrent.toLocaleString('es-CO')} uds
                                                </div>
                                            </div>
                                            <div style={{
                                                width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.65rem', fontWeight: 800,
                                                background: pct <= 10 ? '#fee2e2' : pct <= 30 ? '#fef9c3' : '#dcfce7',
                                                color: pct <= 10 ? '#dc2626' : pct <= 30 ? '#d97706' : '#16a34a',
                                            }}>
                                                {pct}%
                                            </div>
                                        </div>
                                    </div>
                                    {/* Expanded lot details */}
                                    {isExpanded && (() => {
                                        // Fetch movements if not loaded
                                        if (!productMovements[pid] && !movLoading2) {
                                            setMovLoading2(true);
                                            api.get(`/finished-lots/movements?productId=${pid}&limit=100`)
                                                .then(res => {
                                                    setProductMovements(prev => ({ ...prev, [pid]: res.data.transfers || [] }));
                                                })
                                                .catch(() => setProductMovements(prev => ({ ...prev, [pid]: [] })))
                                                .finally(() => setMovLoading2(false));
                                        }
                                        const movs = productMovements[pid] || [];
                                        return (
                                            <div style={{ borderTop: '1.5px solid #e2e8f0' }}>
                                                {g.lots.map((s, lotIdx) => {
                                                    // Only show movements that involve the active zone
                                                    const lotMovs = movs.filter(m => m.lotNumber === s.lotNumber && (m.fromZone === activeZone || m.toZone === activeZone)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                                                    // Compute running balance per lot
                                                    let balance = Number(s.currentQuantity);
                                                    lotMovs.forEach(m => {
                                                        const isIn = m.toZone === activeZone && m.fromZone !== activeZone;
                                                        // "Despachos" y "Salidas" facturadas (ej: Siigo) no son ingresos, aunque su fromZone y toZone sean idénticos en la bitácora
                                                        const isSelfIngress = m.fromZone === activeZone && m.toZone === activeZone && 
                                                                              !m.reason?.toLowerCase().includes('despacho') && 
                                                                              !m.reason?.toLowerCase().includes('salida');
                                                        const isIngress = isIn || isSelfIngress;
                                                        m._balance = balance;
                                                        m._isIngress = isIngress;
                                                        m._qty = m.quantity;
                                                        balance += isIngress ? -m.quantity : m.quantity;
                                                    });
                                                    const lotColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];
                                                    const lotColor = lotColors[lotIdx % lotColors.length];
                                                    const lotBg = lotIdx % 2 === 0 ? '#f0f9ff' : '#faf5ff';
                                                    return (
                                                        <div key={s.id} style={{ borderBottom: '3px solid #cbd5e1', background: lotBg }}>
                                                            {/* Lot header row */}
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 10px 16px', borderBottom: '1px solid #e2e8f0', borderLeft: `5px solid ${lotColor}` }}>
                                                                <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 700, margin: 0 }}>{s.lotNumber}</Tag>
                                                                <div style={{ flex: 1 }} />
                                                                <span style={{ fontWeight: 800, fontSize: '1rem', color: s.currentQuantity > 20 ? '#10b981' : s.currentQuantity > 5 ? '#f59e0b' : '#ef4444' }}>
                                                                    {Number(s.currentQuantity).toLocaleString('es-CO')} uds
                                                                </span>
                                                                <Tag color={s.status === 'AVAILABLE' ? 'green' : s.status === 'LOW' ? 'orange' : 'red'} style={{ margin: 0 }}>
                                                                    {s.status === 'AVAILABLE' ? 'Disponible' : s.status === 'LOW' ? 'Bajo' : 'Agotado'}
                                                                </Tag>
                                                                {s.currentQuantity > 0 && (
                                                                    <>
                                                                        <button onClick={async (e) => {
                                                                            e.stopPropagation();
                                                                            if (!isPrinterReady) { message.warning(printerMode === 'network' ? 'Verifique conexión Zebra' : 'Conecta la impresora primero'); return; }
                                                                            setPrintBoxSize(g.product?.packSize || 12);
                                                                            setPrintMaquila(activeZone === 'MAQUILA');
                                                                            setPrintFrom(1);
                                                                            setPrintTo(999);
                                                                            // Fetch defective/approved counts from lot-summary
                                                                            let approved = null, defective = 0, defectReasons = [];
                                                                            try {
                                                                                const summaryRes = await api.get(`/finished-lots/lot-summary/${encodeURIComponent(s.lotNumber)}`);
                                                                                const entry = (summaryRes.data || []).find(e => e.productId === (g.product?.id || s.productId));
                                                                                if (entry) { approved = entry.approved; defective = entry.defective || 0; }
                                                                            } catch (_) {}
                                                                            // Fallback: if defective=0, check assembly note empaque params
                                                                            // (handles carriots-flow where lot-summary doesn't carry defective count)
                                                                            if (defective === 0 && s.lotNumber) {
                                                                                try {
                                                                                    const pid = g.product?.id || s.productId;
                                                                                    const notesRes = await api.get(`/assembly-notes?productId=${pid}`);
                                                                                    const empaqueNote = (notesRes.data || []).find(n =>
                                                                                        n.processType?.code === 'EMPAQUE' &&
                                                                                        n.productId === pid &&
                                                                                        n.processParameters?.empaque &&
                                                                                        (n.productionBatch?.batchNumber === s.lotNumber ||
                                                                                         n.processParameters?.empaque?.lot === s.lotNumber)
                                                                                    );
                                                                                    const emp = empaqueNote?.processParameters?.empaque;
                                                                                    if (emp?.defective_qty > 0) {
                                                                                        defective = emp.defective_qty;
                                                                                        if (approved === null) approved = emp.approved_qty ?? null;
                                                                                        defectReasons = emp.defect_reasons || [];
                                                                                    }
                                                                                } catch (_) {}
                                                                            }
                                                                            setPrintModal({ open: true, product: g.product, lot: s, totalUnits: Number(s.currentQuantity), approved, defective, defect_reasons: defectReasons, isNoConforme: activeZone === 'NO_CONFORME' });
                                                                        }} style={{
                                                                            padding: '4px 10px', border: `1.5px solid ${s.labelPrinted ? '#f59e0b' : '#10b981'}`, borderRadius: 6,
                                                                            background: s.labelPrinted ? '#fffbeb' : '#ecfdf5',
                                                                            color: s.labelPrinted ? '#b45309' : '#059669',
                                                                            fontWeight: 700, fontSize: '0.72rem',
                                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                                                                        }}>
                                                                            <Printer size={12} /> {s.labelPrinted ? '✅ Reimprimir' : 'Rótulo'}
                                                                        </button>
                                                                        {['ADMIN', 'LOGISTICA'].includes(user?.role) && (
                                                                        <button onClick={() => openTransfer(s)} style={{
                                                                            padding: '4px 10px', border: '1.5px solid #6366f1', borderRadius: 6,
                                                                            background: '#eef2ff', color: '#4f46e5', fontWeight: 700, fontSize: '0.72rem',
                                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                                                                        }}>
                                                                            <ArrowRightLeft size={12} /> Transferir
                                                                        </button>
                                                                        )}
                                                                        {activeZone === 'NO_CONFORME' && (
                                                                            <button onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setAdjustmentData({ lot: s, product: g.product, accountCode: '71050504', quantity: s.currentQuantity });
                                                                                setShowSiigoAdjustment(true);
                                                                            }} style={{
                                                                                padding: '4px 10px', border: '1.5px solid #f97316', borderRadius: 6,
                                                                                background: '#fff7ed', color: '#ea580c', fontWeight: 700, fontSize: '0.72rem',
                                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, marginLeft: '4px'
                                                                            }}>
                                                                                <TrendingDown size={12} /> Baja Siigo
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                            {/* Movement rows */}
                                                            {lotMovs.length === 0 ? (
                                                                <div style={{ padding: '6px 16px 6px 60px', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                                    {movLoading2 ? 'Cargando movimientos...' : 'Sin movimientos registrados'}
                                                                </div>
                                                            ) : (
                                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                                                    <thead>
                                                                        <tr style={{ background: '#f1f5f9' }}>
                                                                            <th style={{ padding: '4px 12px 4px 60px', textAlign: 'right', fontWeight: 700, color: '#16a34a', fontSize: '0.68rem', textTransform: 'uppercase' }}>Ingreso</th>
                                                                            <th style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.68rem', textTransform: 'uppercase' }}>Egreso</th>
                                                                            <th style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.68rem', textTransform: 'uppercase' }}>Restante</th>
                                                                            <th style={{ padding: '4px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase' }}>Motivo</th>
                                                                            <th style={{ padding: '4px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase' }}>Operario</th>
                                                                            <th style={{ padding: '4px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase' }}>Fecha</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {lotMovs.map((m, idx) => (
                                                                            <tr key={m.id || idx} style={{ borderBottom: '1px solid #f1f5f9', background: m._isIngress ? '#f0fdf4' : '#fff' }}>
                                                                                <td style={{ padding: '5px 12px 5px 60px', textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: '0.85rem' }}>
                                                                                    {m._isIngress ? `+${m._qty.toLocaleString('es-CO')}` : '—'}
                                                                                </td>
                                                                                <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 800, color: '#dc2626', fontSize: '0.85rem' }}>
                                                                                    {!m._isIngress ? `−${m._qty.toLocaleString('es-CO')}` : '—'}
                                                                                </td>
                                                                                <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 700, color: m._balance <= 0 ? '#94a3b8' : '#1e293b', fontSize: '0.85rem' }}>
                                                                                    {m._balance.toLocaleString('es-CO')}
                                                                                </td>
                                                                                <td style={{ padding: '5px 12px', fontSize: '0.74rem', color: '#475569', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                    {m.reason || `${m.fromZone} → ${m.toZone}`}
                                                                                </td>
                                                                                <td style={{ padding: '5px 12px', fontSize: '0.74rem', color: '#475569' }}>
                                                                                    {m.transferredBy?.name || '—'}
                                                                                </td>
                                                                                <td style={{ padding: '5px 12px', fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                                                    {new Date(m.createdAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                );
            })()}

            {/* Transfer Modal */}
            <Modal
                open={showTransfer}
                title={<span style={{ fontWeight: 800, fontSize: '1.1rem' }}>📦 Transferir entre zonas</span>}
                onCancel={() => setShowTransfer(false)}
                onOk={handleTransfer}
                confirmLoading={transferring}
                okText="Transferir"
                okButtonProps={{ disabled: (() => {
                    if (!transferData.quantity || !transferData.toZone) return true;
                    if (!transferEmpaque) return false;
                    const qty = parseInt(transferData.quantity) || 0;
                    if (transferData.toZone === 'PRODUCTO_TERMINADO' && qty > transferEmpaque.approved) return true;
                    if (transferData.toZone === 'NO_CONFORME' && qty > transferEmpaque.defective) return true;
                    return false;
                })() }}
                width={480}
                centered
            >
                {selectedStock && (() => {
                    // Compute max based on destination + empaque
                    const rawMax = selectedStock.currentQuantity;
                    let effectiveMax = rawMax;
                    let limitLabel = '';
                    if (transferEmpaque) {
                        if (transferData.toZone === 'PRODUCTO_TERMINADO') {
                            effectiveMax = transferEmpaque.approved;
                            limitLabel = `${transferEmpaque.approved} aprobadas`;
                        } else if (transferData.toZone === 'NO_CONFORME') {
                            effectiveMax = transferEmpaque.defective;
                            limitLabel = `${transferEmpaque.defective} defectuosas`;
                        }
                    }
                    const qtyNum = parseInt(transferData.quantity) || 0;
                    const exceedsMax = qtyNum > effectiveMax;
                    return (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>{selectedStock.product?.name}</div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                                <Tag color="blue">{selectedStock.lotNumber}</Tag>
                                <Tag color="green">Stock: {rawMax} uds</Tag>
                                {transferEmpaque && (
                                    <>
                                        <Tag color="cyan">✅ {transferEmpaque.approved} aprobadas</Tag>
                                        {transferEmpaque.defective > 0 && <Tag color="red">⚠️ {transferEmpaque.defective} defectuosas</Tag>}
                                    </>
                                )}
                            </div>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: '#475569', marginBottom: 4 }}>Zona destino</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {validDestinations.map(z => (
                                    <button key={z.key} onClick={() => {
                                        const reasonKey = `${activeZone}_TO_${z.key}`;
                                        setTransferData(d => ({ ...d, toZone: z.key, quantity: '', reason: TRANSFER_REASONS[reasonKey] || '' }));
                                    }} style={{
                                        flex: 1, padding: '12px 8px', border: `2px solid ${transferData.toZone === z.key ? z.color : '#e2e8f0'}`,
                                        borderRadius: 10, background: transferData.toZone === z.key ? z.bg : '#fff',
                                        cursor: 'pointer', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem',
                                        color: transferData.toZone === z.key ? z.color : '#64748b', transition: 'all 0.2s',
                                    }}>
                                        {z.icon} {z.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: '#475569', marginBottom: 4 }}>
                                Cantidad (máx: {effectiveMax}{limitLabel ? ` — ${limitLabel}` : ''})
                            </label>
                            <input type="number" min="1" max={effectiveMax}
                                value={transferData.quantity} onChange={e => setTransferData(d => ({ ...d, quantity: e.target.value }))}
                                style={{ width: '100%', padding: '10px 14px', border: `2px solid ${exceedsMax ? '#ef4444' : '#e2e8f0'}`, borderRadius: 10, fontSize: '1rem', fontWeight: 700, outline: 'none' }}
                                placeholder="Unidades a transferir"
                            />
                            {exceedsMax && (
                                <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700, marginTop: 4 }}>
                                    ⚠️ {transferData.toZone === 'PRODUCTO_TERMINADO'
                                        ? `Solo ${transferEmpaque?.approved} aprobadas — las ${transferEmpaque?.defective} defectuosas van a No Conforme`
                                        : `Solo ${transferEmpaque?.defective} defectuosas para No Conforme`}
                                </div>
                            )}
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: '#475569', marginBottom: 4 }}>Razón</label>
                            <input value={transferData.reason} onChange={e => setTransferData(d => ({ ...d, reason: e.target.value }))}
                                style={{ width: '100%', padding: '8px 14px', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '0.85rem', outline: 'none' }}
                                placeholder="Motivo de la transferencia"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: '#475569', marginBottom: 4 }}>Observaciones (opcional)</label>
                            <input value={transferData.observations} onChange={e => setTransferData(d => ({ ...d, observations: e.target.value }))}
                                style={{ width: '100%', padding: '8px 14px', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '0.85rem', outline: 'none' }}
                                placeholder="Notas adicionales..."
                            />
                        </div>
                    </div>
                    );
                })()}
            </Modal>

            {/* Print Label Modal */}
            <Modal
                open={printModal.open}
                title={<span style={{ fontWeight: 800, fontSize: '1.1rem' }}>🖨️ Imprimir Rótulos</span>}
                onCancel={() => setPrintModal(p => ({ ...p, open: false }))}
                onOk={async () => {
                    const { product, lot, totalUnits } = printModal;
                    const uPerBox = parseInt(printBoxSize) || 0;
                    if (uPerBox <= 0) { message.warning('Ingrese un número válido'); return; }
                    try {
                        const approvedUnits = (printModal.approved > 0) ? printModal.approved : totalUnits;
                        const defectiveUnits = printModal.defective || 0;
                        const fullBoxes = Math.floor(approvedUnits / uPerBox);
                        const remainder = approvedUnits % uPerBox;
                        const totalLabels = fullBoxes + (remainder > 0 ? 1 : 0);
                        const from = Math.max(1, Math.min(printFrom, totalLabels));
                        const to = Math.min(printTo, totalLabels);
                        let tspl = '';
                        let printed = 0;
                        // Build cause string for NC label
                        const causas = (printModal.defect_reasons || []).map(r => r.cause || r).filter(Boolean);
                        const causaText = causas.length > 0 ? causas[0] : 'No conforme';
                        if (printerMode === 'network') {
                            for (let i = 1; i <= totalLabels; i++) {
                                if (i < from || i > to) continue;
                                const isRem = i === totalLabels && remainder > 0;
                                const boxQty = isRem ? remainder : uPerBox;
                                const zpl = buildLotLabelZPL({
                                    productName: product?.name || '',
                                    sku: product?.sku || '',
                                    barcode: product?.barcode || product?.sku || '',
                                    lotNumber: lot?.lotNumber || '',
                                    quantity: boxQty,
                                    unit: 'und',
                                    receivedAt: lot?.createdAt || new Date().toISOString(),
                                    expiresAt: lot?.expiresAt || '',
                                    boxNumber: i, totalBoxes: totalLabels,
                                    statusText: printModal.isNoConforme ? 'PRODUCTO NO CONFORME' : null,
                                }, 1, { maquila: printMaquila });
                                await sendToZebra(zpl);
                                printed++;
                            }
                            // NC label: 1 label for all defective units
                            if (defectiveUnits > 0 && !printModal.isNoConforme) {
                                const nczpl = buildLotLabelZPL({
                                    productName: product?.name || '',
                                    sku: product?.sku || '',
                                    barcode: product?.barcode || product?.sku || '',
                                    lotNumber: lot?.lotNumber || '',
                                    quantity: defectiveUnits,
                                    unit: 'und',
                                    receivedAt: lot?.createdAt || new Date().toISOString(),
                                    expiresAt: lot?.expiresAt || '',
                                    boxNumber: 1, totalBoxes: 1,
                                    statusText: `NC: ${causaText}`,
                                }, 1);
                                await sendToZebra(nczpl);
                                printed++;
                            }
                        } else {
                            for (let i = 1; i <= totalLabels; i++) {
                                if (i < from || i > to) continue;
                                const isRemainder = i === totalLabels && remainder > 0;
                                const boxQty = isRemainder ? remainder : uPerBox;
                                tspl += buildLotLabel({
                                    productName: product?.name || '',
                                    sku: product?.sku || '',
                                    barcode: product?.barcode || product?.sku || '',
                                    lotNumber: lot?.lotNumber || '',
                                    quantity: boxQty,
                                    unit: 'und',
                                    receivedAt: lot?.createdAt || new Date().toISOString(),
                                    expiresAt: lot?.expiresAt || '',
                                    boxNumber: i, totalBoxes: totalLabels,
                                    statusText: printModal.isNoConforme ? 'PRODUCTO NO CONFORME' : null,
                                }, 1, { maquila: printMaquila });
                                printed++;
                            }
                            // NC label: 1 label for all defective units
                            if (defectiveUnits > 0 && !printModal.isNoConforme) {
                                tspl += buildLotLabel({
                                    productName: product?.name || '',
                                    sku: product?.sku || '',
                                    barcode: product?.barcode || product?.sku || '',
                                    lotNumber: lot?.lotNumber || '',
                                    quantity: defectiveUnits,
                                    unit: 'und',
                                    receivedAt: lot?.createdAt || new Date().toISOString(),
                                    expiresAt: lot?.expiresAt || '',
                                    boxNumber: 1, totalBoxes: 1,
                                    statusText: `NC: ${causaText}`,
                                }, 1, { maquila: false });
                                printed++;
                            }
                            await printer.sendTSPL(tspl);
                        }
                        message.success(`${printed} rótulo(s) impreso(s)${defectiveUnits > 0 && !printModal.isNoConforme ? ` (incl. 1 etiqueta No Conforme para ${defectiveUnits} uds)` : ''}`);
                        // Persist in DB
                        api.post('/finished-lots/mark-printed', { lotId: lot?.id, type: activeZone === 'BODEGA' ? 'material' : 'finished' }).catch(() => {});
                        // Update local state (stocks is a flat array of lot objects)
                        setStocks(prev => prev.map(s => s.id === lot?.id ? { ...s, labelPrinted: true, labelPrintedAt: new Date().toISOString() } : s));
                        setPrintModal(p => ({ ...p, open: false }));
                    } catch (err) {
                        message.error('Error al imprimir: ' + err.message);
                    }
                }}
                okText="🖨️ Imprimir"
                cancelText="Cancelar"
                width={420}
                centered
            >
                {printModal.product && (() => {
                    const uPerBox = parseInt(printBoxSize) || 0;
                    const totalUnits = printModal.totalUnits;
                    const approvedUnits = (printModal.approved > 0) ? printModal.approved : totalUnits;
                    const fullBoxes = uPerBox > 0 ? Math.floor(approvedUnits / uPerBox) : 0;
                    const remainder = uPerBox > 0 ? approvedUnits % uPerBox : 0;
                    const totalLabels = fullBoxes + (remainder > 0 ? 1 : 0);

                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Product info */}
                            <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '12px 16px', border: '1.5px solid #bae6fd' }}>
                                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0c4a6e' }}>{printModal.product.name}</div>
                                <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: '0.8rem', color: '#475569', flexWrap: 'wrap' }}>
                                    <span>📋 Lote: <strong>{printModal.lot?.lotNumber}</strong></span>
                                    <span>📦 Total: <strong>{totalUnits} uds</strong></span>
                                    {printModal.defective > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ {printModal.defective} defectuosas excluidas</span>}
                                    {printModal.isNoConforme && <span style={{ color: '#7c3aed', fontWeight: 700 }}>🔴 ZONA NO CONFORME</span>}
                                </div>
                                {printModal.defective > 0 && (
                                    <div style={{ marginTop: 6, fontSize: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', color: '#991b1b', fontWeight: 600 }}>
                                        ✅ {(printModal.approved > 0) ? printModal.approved : totalUnits} aprobadas · ❌ {printModal.defective} defectuosas (no se imprimen)
                                    </div>
                                )}
                            </div>

                            {/* Box size selection */}
                            <div>
                                <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 8 }}>
                                    ¿Cuántas unidades por caja?
                                </label>
                                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                                    {(() => {
                                        const ps = printModal.product?.packSize;
                                        const presets = [...new Set([4, 6, 12, 25, 40, ps].filter(n => n && n > 0))].sort((a, b) => a - b);
                                        return presets.map(n => (
                                            <button key={n} onClick={() => setPrintBoxSize(n)} style={{
                                                flex: '1 1 60px', maxWidth: 90, padding: '8px 0', borderRadius: 8, fontWeight: 800, fontSize: '0.85rem',
                                                border: printBoxSize === n ? '2.5px solid #4f46e5' : '2px solid #e2e8f0',
                                                background: printBoxSize === n ? '#eef2ff' : n === ps ? '#f0fdf4' : '#fff',
                                                color: printBoxSize === n ? '#4f46e5' : n === ps ? '#059669' : '#64748b',
                                                cursor: 'pointer', transition: 'all 0.15s',
                                            }}>
                                                {n}{n === ps ? ' ✦' : ''}
                                            </button>
                                        ));
                                    })()}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Otro:</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={![4, 12].includes(printBoxSize) ? printBoxSize : ''}
                                        onChange={e => setPrintBoxSize(parseInt(e.target.value) || 0)}
                                        onFocus={() => { if ([4, 12].includes(printBoxSize)) setPrintBoxSize(''); }}
                                        placeholder="Personalizado..."
                                        style={{ flex: 1, padding: '8px 12px', border: '2px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem', outline: 'none' }}
                                    />
                                </div>
                            </div>

                            {/* Maquila toggle */}
                            <label style={{
                                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem',
                                fontWeight: 700, color: printMaquila ? '#8b5cf6' : '#64748b',
                                padding: '8px 12px', background: printMaquila ? '#f5f3ff' : '#f8fafc',
                                borderRadius: 8, border: `1.5px solid ${printMaquila ? '#8b5cf6' : '#e2e8f0'}`,
                                transition: 'all 0.15s',
                            }}>
                                <input type="checkbox" checked={printMaquila} onChange={e => { setPrintMaquila(e.target.checked); if (e.target.checked) setPrintBoxSize(6); else setPrintBoxSize(printModal.product?.packSize || 12); }} style={{ accentColor: '#8b5cf6' }} />
                                🏭 Etiqueta Maquila (sin marca)
                            </label>

                            {/* Preview */}
                            {uPerBox > 0 && (() => {
                                const from = Math.max(1, Math.min(printFrom, totalLabels));
                                const to = Math.min(printTo || totalLabels, totalLabels);
                                const printCount = Math.max(0, to - from + 1);
                                return (
                                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', border: '1.5px solid #e2e8f0' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155' }}>
                                                📄 {printCount === totalLabels ? `${totalLabels} rótulo${totalLabels > 1 ? 's' : ''}` : `${printCount} de ${totalLabels}`}
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                                                <span style={{ color: '#64748b', fontWeight: 600 }}>Desde:</span>
                                                <input type="number" min={1} max={totalLabels} value={printFrom}
                                                    onChange={e => setPrintFrom(parseInt(e.target.value) || 1)}
                                                    style={{ width: 40, padding: '2px 4px', border: '1.5px solid #e2e8f0', borderRadius: 4, textAlign: 'center', fontSize: '0.75rem' }}
                                                />
                                                <span style={{ color: '#64748b', fontWeight: 600 }}>Hasta:</span>
                                                <input type="number" min={1} max={totalLabels} value={printTo > totalLabels ? totalLabels : printTo}
                                                    onChange={e => setPrintTo(parseInt(e.target.value) || totalLabels)}
                                                    style={{ width: 40, padding: '2px 4px', border: '1.5px solid #e2e8f0', borderRadius: 4, textAlign: 'center', fontSize: '0.75rem' }}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                            {Array.from({ length: Math.min(totalLabels, 20) }, (_, i) => {
                                                const boxNum = i + 1;
                                                const isLast = boxNum === totalLabels && remainder > 0;
                                                const boxQty = isLast ? remainder : uPerBox;
                                                const inRange = boxNum >= from && boxNum <= to;
                                                return (
                                                    <div key={i} onClick={() => { setPrintFrom(boxNum); setPrintTo(boxNum); }}
                                                        style={{
                                                        padding: '3px 7px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700,
                                                        cursor: 'pointer', transition: 'all 0.1s',
                                                        background: !inRange ? '#f1f5f9' : isLast ? '#fef3c7' : '#dcfce7',
                                                        color: !inRange ? '#94a3b8' : isLast ? '#92400e' : '#15803d',
                                                        border: `1px solid ${!inRange ? '#e2e8f0' : isLast ? '#fcd34d' : '#86efac'}`,
                                                        opacity: inRange ? 1 : 0.5,
                                                    }}>
                                                        {boxNum}: {boxQty}
                                                    </div>
                                                );
                                            })}
                                            {totalLabels > 20 && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>+{totalLabels - 20} más...</span>}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    );
                })()}
            </Modal>

            {/* Movement History */}
            <div style={{ background: '#fff', borderRadius: 16, border: '2px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '2px solid #f1f5f9' }}>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: '0.95rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Clock size={18} /> Movimientos Recientes
                    </h3>
                    <button onClick={loadMovements} style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.78rem', color: '#64748b' }}>
                        <RefreshCw size={12} /> Refrescar
                    </button>
                </div>
                {movLoading ? (
                    <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
                ) : movements.length === 0 ? (
                    <Empty description="Sin movimientos registrados" style={{ padding: 30 }} />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>Fecha</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>Producto</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>Lote</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>De → A</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem', textAlign: 'right' }}>Cant.</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>Razón</th>
                                    <th style={{ ...thStyle, fontSize: '0.75rem' }}>Responsable</th>
                                </tr>
                            </thead>
                            <tbody>
                                {movements.map(m => {
                                    const fromLabel = ZONES.find(z => z.key === m.fromZone)?.label || m.fromZone;
                                    const toLabel = ZONES.find(z => z.key === m.toZone)?.label || m.toZone;
                                    const isSameZone = m.fromZone === m.toZone;
                                    return (
                                        <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{fmtDate(m.createdAt)}</td>
                                            <td style={{ ...tdStyle }}>{m.product?.name || '-'}</td>
                                            <td style={{ ...tdStyle }}><Tag color="blue" style={{ fontFamily: 'monospace' }}>{m.lotNumber}</Tag></td>
                                            <td style={{ ...tdStyle }}>
                                                {isSameZone ? (
                                                    <Tag color="cyan">Ingreso</Tag>
                                                ) : (
                                                    <span style={{ fontSize: '0.78rem' }}>
                                                        <Tag color="orange">{fromLabel}</Tag> → <Tag color="green">{toLabel}</Tag>
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{Number(m.quantity).toLocaleString('es-CO')}</td>
                                            <td style={{ ...tdStyle, color: '#64748b', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.reason || '-'}</td>
                                            <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{m.transferredBy?.name || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Success Modal ── */}
            {successModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                    animation: 'fadeIn 0.2s ease-out',
                }} onClick={() => setSuccessModal(null)}>
                    <div style={{
                        background: '#fff', borderRadius: 20, padding: '32px 36px', maxWidth: 420, width: '90%',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center',
                        animation: 'scaleIn 0.3s ease-out',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 15px rgba(16,185,129,0.4)',
                        }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <h3 style={{ margin: '0 0 8px', fontSize: '1.3rem', fontWeight: 800, color: '#1e293b' }}>
                            ¡Stock Registrado!
                        </h3>
                        <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: '#475569', lineHeight: 1.6 }}>
                            Se registraron <strong style={{ color: '#0369a1', fontSize: '1.1rem' }}>{successModal.qty}</strong> unidades de
                            <br /><strong style={{ color: '#1e293b' }}>{successModal.productName}</strong>
                            <br />en <span style={{ background: '#d1fae5', color: '#059669', padding: '2px 10px', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem' }}>
                                {successModal.zoneName}
                            </span>
                        </p>
                        <button onClick={() => setSuccessModal(null)} style={{
                            padding: '10px 32px', background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                            cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
                        }}>
                            Aceptar
                        </button>
                    </div>
                </div>
            )}

            {/* Siigo Adjustment RPA Modal */}
            <Modal
                open={showSiigoAdjustment}
                title={<span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ea580c', display: 'flex', alignItems: 'center', gap: 6 }}><TrendingDown size={18} /> Ajuste de Inventario (Baja Siigo)</span>}
                onCancel={() => setShowSiigoAdjustment(false)}
                footer={null}
                width={450}
                centered
            >
                {adjustmentData.product && (
                    <div style={{ padding: '10px 0' }}>
                        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, color: '#9a3412', fontSize: '0.9rem' }}>{adjustmentData.product.name}</div>
                            <div style={{ fontSize: '0.8rem', color: '#c2410c', marginTop: 4 }}>Lote: {adjustmentData.lot?.lotNumber} • Stock ERP Local: {adjustmentData.lot?.currentQuantity}</div>
                        </div>
                        
                        <div style={{ marginBottom: 16 }}>
                            <label style={lblStyle}>Cantidad a reducir en Siigo</label>
                            <input 
                                type="number" 
                                min="1"
                                value={adjustmentData.quantity} 
                                onChange={e => setAdjustmentData(d => ({ ...d, quantity: e.target.value }))}
                                style={{ ...inputStyle, borderColor: '#fdba74' }} 
                                placeholder="Ej: 5"
                            />
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={lblStyle}>Código Contable</label>
                            <input 
                                type="text" 
                                value={adjustmentData.accountCode} 
                                onChange={e => setAdjustmentData(d => ({ ...d, accountCode: e.target.value }))}
                                style={inputStyle} 
                                placeholder="Ej: 71050504"
                            />
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
                                Se usará para el comprobante contable automático.
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowSiigoAdjustment(false)} style={{ padding: '8px 16px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                                Cancelar
                            </button>
                            <button onClick={handleSiigoAdjustment} disabled={siigoAdjusting} style={{ padding: '8px 16px', background: '#f97316', border: 'none', borderRadius: 8, fontWeight: 700, color: '#fff', cursor: siigoAdjusting ? 'not-allowed' : 'pointer', opacity: siigoAdjusting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {siigoAdjusting ? <Spin size="small" /> : 'Ejecutar Bot Siigo'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            <style>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes scaleIn { from { transform: scale(0.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
            `}</style>
        </div>
    );
};

const thStyle = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' };
const tdStyle = { padding: '10px 14px' };
const lblStyle = { display: 'block', fontWeight: 600, fontSize: '0.78rem', color: '#475569', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 12px', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '0.85rem', outline: 'none' };

export default FinishedProductZonePage;
