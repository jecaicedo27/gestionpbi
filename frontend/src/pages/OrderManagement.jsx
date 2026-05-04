import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle, XCircle, Package, Truck, ScanLine, ClipboardList, BarChart3, Box, ChevronDown, ChevronUp, FileText, Upload, Printer, RotateCcw, Camera, Trash2, ShoppingCart, Barcode } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseScanInput } from '../services/scannerParser';
import { playSuccess, playError, playAlreadyDone, playItemComplete, playZoneWarning } from '../services/scannerSounds';

const API_URL = `${import.meta.env.VITE_API_URL}/api` || '/api';
const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function OrderManagement() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';
    const isLogistica = user?.role === 'LOGISTICA';
    const isComercial = user?.role === 'COMERCIAL';
    const isDistributor = user?.role === 'DISTRIBUIDOR';
    const canManageOrders = isAdmin || isComercial;
    const [statusFilter, setStatusFilter] = useState('PENDING');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [pickingOrder, setPickingOrder] = useState(null);
    const [pickingProgress, setPickingProgress] = useState(null);
    const [expandItemId, setExpandItemId] = useState(null); // ID del item abierto para ver picking details
    const [invoiceModal, setInvoiceModal] = useState(null);
    const [dispatchModal, setDispatchModal] = useState(null);
    const [deliverModal, setDeliverModal] = useState(null);
    const [signedGuideFile, setSignedGuideFile] = useState(null);
    const [imageModal, setImageModal] = useState(null);
    const [dispatchForm, setDispatchForm] = useState({
        driverName: '', licensePlate: '', driverCedula: '', driverPhone: '',
        amountPaid: '', destination: '', destinationCity: '', dispatchTime: '', dispatchNotes: '',
        receiverName: '', receiverPhone: ''
    });
    const [driverSuggestions, setDriverSuggestions] = useState([]);
    const [showDriverSuggestions, setShowDriverSuggestions] = useState(false);
    const [invoiceFiles, setInvoiceFiles] = useState({ invoicePdf: null, accountStatement: null, invoiceNumber: '' });
    const [selectedForConsolidation, setSelectedForConsolidation] = useState(new Set());
    const [consolidating, setConsolidating] = useState(false);
    const [manualLot, setManualLot] = useState('');
    const [scanBuffer, setScanBuffer] = useState('');
    const [lastScan, setLastScan] = useState(null); // {productName, lotNumber, status, timestamp}
    const [unitPickPopup, setUnitPickPopup] = useState(null); // {itemId, product, qty, lot, availableLots}
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [expandedOrderId, setExpandedOrderId] = useState(null);
    const [ptStockMap, setPtStockMap] = useState({});  // productId → totalQty in PRODUCTO_TERMINADO
    const scanTimeout = useRef(null);
    const queryClient = useQueryClient();

    // Excel upload
    const [excelModal, setExcelModal] = useState(false);
    const [excelFile, setExcelFile] = useState(null);
    const [excelDistributor, setExcelDistributor] = useState('');
    const [excelPreview, setExcelPreview] = useState(null);
    const [excelLoading, setExcelLoading] = useState(false);
    const [distributors, setDistributors] = useState([]);
    const [confirmSkipModal, setConfirmSkipModal] = useState(false);
    const [successModal, setSuccessModal] = useState(null); // { type: 'success'|'error', title, message, detail }
    const [packingModeModal, setPackingModeModal] = useState(null); // { order } — pending packing mode selection
    const [pendingSummaryModal, setPendingSummaryModal] = useState(false);
    const [pendingCellDetail, setPendingCellDetail] = useState(null); // { brand, presentation, flavor }
    const [pendingDistributorFilter, setPendingDistributorFilter] = useState('ALL');
    
    // Edit notes
    const [editingNoteId, setEditingNoteId] = useState(null);
    const [editNoteContent, setEditNoteContent] = useState('');

    // Admin Scanner
    const [scannerModal, setScannerModal] = useState(false);
    const [scannerDistributor, setScannerDistributor] = useState('');
    const [scannerItems, setScannerItems] = useState([]);
    const [scannerBarcodeText, setScannerBarcodeText] = useState('');
    const [catalogProducts, setCatalogProducts] = useState([]);
    const [scannerLoading, setScannerLoading] = useState(false);
    const orderScannerInputRef = useRef(null);

    const { data: orders, isLoading } = useQuery({
        queryKey: ['admin-orders', statusFilter],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/orders?status=${statusFilter}`, {
                headers: AUTH()
            });
            return response.data.data;
        }
    });

    const { data: orderCounts } = useQuery({
        queryKey: ['order-counts'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/orders/counts`, { headers: AUTH() });
            return response.data.data;
        },
        refetchInterval: 30000
    });

    const { data: pendingSummary, isLoading: pendingSummaryLoading } = useQuery({
        queryKey: ['orders-pending-summary'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/orders/pending-summary`, { headers: AUTH() });
            return response.data;
        },
        enabled: pendingSummaryModal
    });

    // ─── Mutations ───────────────────────────────────────────────
    const approveMutation = useMutation({
        mutationFn: async ({ orderId, skipInsufficient }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/approve`, { skipInsufficient }, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            setSelectedOrder(null);
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al aprobar')
    });

    const rejectMutation = useMutation({
        mutationFn: async ({ orderId, reason }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/reject`, { reason }, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            setSelectedOrder(null);
            alert('Pedido rechazado');
        }
    });

    const deleteOrderMutation = useMutation({
        mutationFn: async (orderId) => {
            const response = await axios.delete(`${API_URL}/orders/${orderId}`, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            setSuccessModal({ type: 'success', title: 'Pedido Eliminado', message: 'El pedido ha sido eliminado permanentemente.' });
        },
        onError: (error) => setSuccessModal({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Error al eliminar pedido.' })
    });

    const startPickingMutation = useMutation({
        mutationFn: async (orderId) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/start-picking`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            // Open the picking modal directly
            setPickingOrder(data.data);
            loadPickingProgress(data.data.id);
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al iniciar separación')
    });

    const scanMutation = useMutation({
        mutationFn: async ({ orderId, orderItemId, qrData, scannedQty }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/scan`, {
                orderItemId, qrData, scannedQty
            }, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data, variables) => {
            if (data.data?.order) {
                setPickingOrder(data.data.order);
            }
            setPickingProgress(prev => ({
                ...prev,
                ...data.data,
                progress: data.data.progress
            }));
            setManualLot('');
            loadPickingProgress(pickingOrder?.id);
            // Determine if the scanned item just reached 100%
            const scannedItemId = variables.orderItemId;
            const orderItems = data.data?.order?.items;
            if (orderItems && scannedItemId) {
                const item = orderItems.find(i => i.id === scannedItemId);
                if (item) {
                    const targetQty = item.allocatedQty || item.requestedQty;
                    const totalPicked = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
                    if (totalPicked >= targetQty) {
                        playItemComplete(); // 🎉 Item reached the goal!
                    } else {
                        playSuccess();      // ✅ Partial progress
                    }
                } else {
                    playSuccess();
                }
            } else {
                playSuccess();
            }
            setLastScan(prev => prev ? { ...prev, status: 'success' } : null);
            setTimeout(() => setLastScan(prev => prev?.status === 'success' ? null : prev), 3000);
        },
        onError: (error) => {
            const data = error.response?.data;
            if (data?.zoneWarning) {
                playZoneWarning();
                setLastScan(prev => prev ? { ...prev, status: 'zone-warning', message: data.error } : null);
            } else {
                playError();
                setLastScan(prev => prev ? { ...prev, status: 'error', message: data?.error || 'Error al escanear' } : null);
            }
        }
    });

    const [partialConfirmModal, setPartialConfirmModal] = useState(false);
    const [backorderConfirmModal, setBackorderConfirmModal] = useState(false);

    const completePickingMutation = useMutation({
        mutationFn: async ({ orderId, partial = false }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/complete-picking`, { partial }, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data, variables) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            setPickingOrder(null);
            setPickingProgress(null);
            setPartialConfirmModal(false);
            alert(variables.partial
                ? '✅ Separación completada parcialmente — El pedido pasó a Listos con lo escaneado'
                : '✅ Separación completada — Pedido listo para despacho');
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al completar separación')
    });

    const completeWithBackorderMutation = useMutation({
        mutationFn: async ({ orderId }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/complete-with-backorder`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            setPickingOrder(null);
            setPickingProgress(null);
            setBackorderConfirmModal(false);
            setSuccessModal({
                type: 'success',
                title: 'Separación completada + Nuevo pedido creado',
                message: `Pedido ${data.backorder?.orderNumber} generado automáticamente`,
                detail: `Lo escaneado del pedido original pasó a Listos. Se creó el pedido ${data.backorder?.orderNumber} con ${data.backorder?.itemCount} producto(s) faltantes para ${pickingOrder?.distributor?.name || 'el distribuidor'}. El nuevo pedido ya está Aprobado y listo para alistamiento.`
            });
        },
        onError: (error) => {
            setBackorderConfirmModal(false);
            alert(error.response?.data?.error || 'Error al completar con backorder');
        }
    });

    // ADMIN ONLY: unscan/unmark a picking item
    const unscanMutation = useMutation({
        mutationFn: async ({ orderId, pickingItemId }) => {
            const response = await axios.delete(`${API_URL}/orders/${orderId}/picking-item/${pickingItemId}`, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            loadPickingProgress(pickingOrder?.id);
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al desmarcar item')
    });

    const revertToPickingMutation = useMutation({
        mutationFn: async ({ orderId }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/revert-to-picking`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            alert(`✅ ${data.message}`);
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al devolver pedido')
    });

    const updateNoteMutation = useMutation({
        mutationFn: async ({ orderId, notes }) => {
            const response = await axios.patch(`${API_URL}/orders/${orderId}`, { notes }, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            setEditingNoteId(null);
            setEditNoteContent('');
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al actualizar nota')
    });

    const invoiceMutation = useMutation({
        mutationFn: async ({ orderId }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/invoice`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            const siigoName    = data.siigoInvoice?.name;
            const distName     = data.data?.distributor?.name || invoiceModal?.distributor?.name || '';
            const orderNumber  = data.data?.orderNumber        || invoiceModal?.orderNumber        || '';
            const today        = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
            setInvoiceModal(null);
            setSuccessModal({
                type:     'success',
                title:    siigoName || 'Factura creada en Siigo',
                message:  `Nueva factura para ${distName}`,
                detail:   `${today} · Con orden de compra ${orderNumber}`,
                copyText: `*${siigoName || 'Nueva factura'}*\nNueva factura para *${distName}*\n${today}\nCon orden de compra: ${orderNumber}`
            });
        },

        onError: (error) => {
            const errData = error.response?.data;
            const msg = errData?.siigoError || errData?.error || 'Error al facturar';
            const details = errData?.siigoDetails?.map(d => d.Message).join(' • ') || '';
            setSuccessModal({
                type: 'error',
                title: 'Error al facturar',
                message: msg,
                detail: details
            });
        }
    });

    const dispatchMutation = useMutation({
        mutationFn: async ({ orderId, ...data }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/dispatch`, data, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            // Save driver data for future reuse
            if (dispatchForm.driverName) {
                axios.post(`${API_URL}/drivers/upsert`, {
                    name: dispatchForm.driverName,
                    cedula: dispatchForm.driverCedula || undefined,
                    phone: dispatchForm.driverPhone || undefined,
                    licensePlate: dispatchForm.licensePlate || undefined,
                }, { headers: AUTH() }).catch(() => {});
            }
            const guideNumber = data.data?.transportGuideNumber;
            setDispatchModal(null);
            setDispatchForm({ driverName: '', licensePlate: '', driverCedula: '', driverPhone: '', amountPaid: '', destination: '', destinationCity: '', dispatchTime: '', dispatchNotes: '', receiverName: '', receiverPhone: '' });
            if (guideNumber && data.data?.id) {
                const doPrint = confirm(`✅ Pedido despachado — Guía: ${guideNumber}\n\n¿Desea imprimir la guía de transporte?`);
                if (doPrint) window.open(`${API_URL}/orders/${data.data.id}/transport-guide`, '_blank');
            } else {
                alert('✅ Pedido despachado');
            }
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al despachar')
    });

    // ─── Deliver Mutation ─────────────────────────────────────
    const deliverMutation = useMutation({
        mutationFn: async ({ orderId, signedGuide }) => {
            let response;
            if (signedGuide) {
                const formData = new FormData();
                formData.append('signedGuide', signedGuide);
                response = await axios.post(`${API_URL}/orders/${orderId}/deliver`, formData, {
                    headers: AUTH()
                });
            } else {
                response = await axios.post(`${API_URL}/orders/${orderId}/deliver`, {}, {
                    headers: AUTH()
                });
            }
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            alert('✅ Entrega confirmada');
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al confirmar entrega')
    });

    // ─── Picking Progress Loader ─────────────────────────────────
    const loadPickingProgress = useCallback(async (orderId) => {
        if (!orderId) return;
        try {
            const res = await axios.get(`${API_URL}/orders/${orderId}/picking-progress`, { headers: AUTH() });
            setPickingProgress(res.data.data);
        } catch (e) {
            console.error('Error loading picking progress:', e);
        }
    }, []);

    // Open picking modal for an order
    const openPickingModal = useCallback(async (order) => {
        // If packingMode already defined, go straight to picking
        if (order.packingMode) {
            await _startPickingFlow(order);
        } else {
            // Show custom modal to select packing mode
            setPackingModeModal({ order });
        }
    }, []);

    // Internal helper: called after packing mode is confirmed
    const _startPickingFlow = useCallback(async (orderToUse) => {
        setPickingOrder(orderToUse);
        await loadPickingProgress(orderToUse.id);
        // Load PT stock for admin/logística reference
        if (isAdmin || isLogistica) {
            try {
                const res = await axios.get(`${API_URL}/finished-lots/stock`, {
                    params: { zone: 'PRODUCTO_TERMINADO' },
                    headers: AUTH()
                });
                const stocks = res.data?.stocks || [];
                const map = {};
                stocks.forEach(s => {
                    map[s.productId] = (map[s.productId] || 0) + (s.currentQuantity || 0);
                });
                setPtStockMap(map);
            } catch { setPtStockMap({}); }
        }
    }, [loadPickingProgress, isAdmin, isLogistica]);

    // Called when user picks a packing mode from the modal
    const handleSelectPackingMode = useCallback(async (mode) => {
        if (!packingModeModal) return;
        const { order } = packingModeModal;
        setPackingModeModal(null);
        let orderToUse = { ...order, packingMode: mode };
        try {
            await axios.patch(`${API_URL}/orders/${order.id}`, { packingMode: mode }, { headers: AUTH() });
        } catch (e) {
            console.error('Error setting packing mode:', e);
        }
        await _startPickingFlow(orderToUse);
    }, [packingModeModal, _startPickingFlow]);

    // ─── Paste Listener for Deliver Modal (Ctrl+V) ──────────────
    useEffect(() => {
        const handlePaste = (e) => {
            if (!deliverModal) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1 || items[i].type === 'application/pdf') {
                    const file = items[i].getAsFile();
                    if (file) {
                        setSignedGuideFile(file);
                        break;
                    }
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [deliverModal]);



    const handleQrScan = useCallback((qrData) => {
        if (!pickingOrder || !pickingProgress) return;

        // Auto-match: find the order item that matches this productCode OR barcode
        const matchedItem = pickingProgress.itemsProgress?.find(ip =>
            !ip.completed && pickingOrder.items.find(
                oi => oi.id === ip.itemId && (
                    oi.product?.sku === qrData.productCode ||
                    (qrData.barcode && oi.product?.barcode === qrData.barcode)
                )
            )
        );

        // ── STRICT MATCH: only use auto-matched item, never blindly trust selectedItemId ──
        const targetItemId = matchedItem?.itemId;

        if (!targetItemId) {
            playError();
            const scannedName = qrData.name || qrData.productCode;
            setLastScan({ productName: scannedName, lotNumber: qrData.lotNumber, status: 'error', message: `Producto escaneado (${qrData.productCode}) no coincide con ningún item del pedido`, timestamp: Date.now() });
            return;
        }

        // ── Overscan guard: block if item already complete ──
        const ip = pickingProgress.itemsProgress?.find(i => i.itemId === targetItemId);
        const alreadyScanned = ip?.scannedQty || 0;
        const requested = ip?.requestedQty || 0;
        const wouldScan = qrData.unitsPerBox || 1;

        if (alreadyScanned >= requested) {
            playAlreadyDone();
            const matchedProduct = pickingOrder.items?.find(oi => oi.id === targetItemId)?.product;
            setLastScan({ productName: matchedProduct?.name || qrData.productCode, lotNumber: qrData.lotNumber, status: 'warning', message: `Ya completo (${alreadyScanned}/${requested} uds) — no se necesitan más`, timestamp: Date.now() });
            setExpandItemId(targetItemId);
            setTimeout(() => { itemRefs.current[targetItemId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
            return;
        }

        if (alreadyScanned + wouldScan > requested) {
            playError();
            const matchedProduct = pickingOrder.items?.find(oi => oi.id === targetItemId)?.product;
            setLastScan({ productName: matchedProduct?.name || qrData.productCode, lotNumber: qrData.lotNumber, status: 'error', message: `Sobrestock: solo faltan ${requested - alreadyScanned} uds, escaneaste ${wouldScan}`, timestamp: Date.now() });
            return;
        }

        // Show scanning feedback and scroll to matched item
        const matchedProduct = pickingOrder.items?.find(oi => oi.id === targetItemId)?.product;
        setLastScan({ productName: matchedProduct?.name || qrData.productCode, lotNumber: qrData.lotNumber, status: 'scanning', timestamp: Date.now() });
        setExpandItemId(targetItemId);
        setTimeout(() => {
            itemRefs.current[targetItemId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        scanMutation.mutate({
            orderId: pickingOrder.id,
            orderItemId: targetItemId,
            qrData,
            scannedQty: qrData.unitsPerBox || 1
        });
    }, [pickingOrder, pickingProgress, scanMutation]);

    // ─── Scanner input ref (hidden auto-focus input captures all scanner reads) ───
    const scannerInputRef = useRef(null);
    const itemRefs = useRef({});

    // Auto-focus scanner input when picking modal opens
    useEffect(() => {
        if (!pickingOrder) return;
        // Focus the hidden scanner input
        const focusScanner = () => {
            if (scannerInputRef.current && document.activeElement !== scannerInputRef.current
                && document.activeElement?.dataset?.scannerIgnore !== 'true') {
                scannerInputRef.current.focus();
            }
        };
        focusScanner();
        // Re-grab focus periodically (in case user clicks somewhere in the modal)
        const interval = setInterval(focusScanner, 2000);
        return () => clearInterval(interval);
    }, [pickingOrder]);

    // Auto-focus scanner input when Admin scanner modal opens
    useEffect(() => {
        if (!scannerModal) return;
        const focusScanner = () => {
            if (orderScannerInputRef.current && document.activeElement !== orderScannerInputRef.current
                && document.activeElement?.dataset?.scannerIgnore !== 'true') {
                orderScannerInputRef.current.focus();
            }
        };
        focusScanner();
        const interval = setInterval(focusScanner, 2000);
        return () => clearInterval(interval);
    }, [scannerModal]);

    // Handle scanner input (called on Enter in the hidden input)
    const handleScannerInput = useCallback(async (rawValue) => {
        if (!pickingOrder || !rawValue || rawValue.length < 4) return;

        const scan = parseScanInput(rawValue);

        // ── 1. QR JSON (full box scan from empaque) ──
        if (scan.type === 'qr_json' && scan.sku && scan.lotNumber) {
            handleQrScan({
                productCode: scan.sku,
                barcode: scan.barcode || scan.sku,
                name: scan.name || '',
                lotNumber: scan.lotNumber,
                unitsPerBox: scan.unitsPerBox || 1,
                expirationDate: scan.expirationDate || ''
            });
            return;
        }

        // ── 2. LOT:SKU|BAR (from thermal label QR) — match by barcode first, fallback to SKU ──
        if (scan.type === 'qr_lot_sku' && scan.sku) {
            // Prefer barcode match (EAN-13 is globally unique); fallback to SKU
            const matchedOrderItem = pickingOrder.items?.find(oi =>
                scan.barcode && oi.product?.barcode === scan.barcode
            ) || pickingOrder.items?.find(oi => oi.product?.sku === scan.sku);

            const matchedIp = matchedOrderItem && pickingProgress?.itemsProgress?.find(ip => ip.itemId === matchedOrderItem.id && !ip.completed);

            if (matchedOrderItem && matchedIp) {
                // If we have a lot number from the QR, auto-fill it
                if (scan.lotNumber) {
                    handleQrScan({
                        productCode: matchedOrderItem.product?.sku || scan.sku,
                        barcode: scan.barcode || matchedOrderItem.product?.barcode || scan.sku,
                        name: matchedOrderItem.product?.name || '',
                        lotNumber: scan.lotNumber,
                        // QTY from QR takes priority, fallback to packSize in DB
                        unitsPerBox: scan.unitsPerBox || matchedOrderItem.product?.packSize || 1,
                        expirationDate: ''
                    });
                } else {
                    setUnitPickPopup({
                        itemId: matchedOrderItem.id,
                        product: matchedOrderItem.product,
                        qty: 1,
                        lot: ''
                    });
                    setLastScan({ productName: matchedOrderItem.product?.name, status: 'scanning', message: 'QR detectado — ingresa lote y cantidad', timestamp: Date.now() });
                }
            } else if (matchedOrderItem) {
                playAlreadyDone();
                setLastScan({ productName: matchedOrderItem.product?.name || scan.sku, status: 'warning', message: 'Ya completado — no se necesitan más unidades', timestamp: Date.now() });
            } else {
                playError();
                setLastScan({ productName: scan.sku, status: 'error', message: `Producto (SKU: ${scan.sku}) no encontrado en este pedido`, timestamp: Date.now() });
            }
            return;
        }

        // ── 2b. PKG package label QR (new format: PKG:|LOT:|SKU:|BAR:|QTY:|…) ──
        if (scan.type === 'qr_package_label' && (scan.barcode || scan.sku)) {
            const matchedOrderItem = pickingOrder.items?.find(oi =>
                scan.barcode && oi.product?.barcode === scan.barcode
            ) || pickingOrder.items?.find(oi => oi.product?.sku === scan.sku);

            const matchedIp = matchedOrderItem && pickingProgress?.itemsProgress?.find(ip => ip.itemId === matchedOrderItem.id && !ip.completed);

            if (matchedOrderItem && matchedIp) {
                handleQrScan({
                    productCode: matchedOrderItem.product?.sku || scan.sku,
                    barcode: scan.barcode || matchedOrderItem.product?.barcode || scan.sku,
                    name: matchedOrderItem.product?.name || '',
                    lotNumber: scan.lotNumber || '',
                    unitsPerBox: scan.quantity || matchedOrderItem.product?.packSize || 1,
                    expirationDate: scan.expirationDate || ''
                });
            } else if (matchedOrderItem) {
                playAlreadyDone();
                setLastScan({ productName: matchedOrderItem.product?.name || scan.sku, status: 'warning', message: 'Ya completado — no se necesitan más unidades', timestamp: Date.now() });
            } else {
                playError();
                setLastScan({ productName: scan.sku || scan.barcode, status: 'error', message: `Producto (${scan.barcode || scan.sku}) no encontrado en este pedido`, timestamp: Date.now() });
            }
            return;
        }

        // ── 3. Plain barcode — match to product ──
        const buffer = scan.raw;
        const matchedOrderItem = pickingOrder.items?.find(oi => oi.product?.barcode === buffer);
        const matchedIp = matchedOrderItem && pickingProgress?.itemsProgress?.find(ip => ip.itemId === matchedOrderItem.id && !ip.completed);

        if (matchedOrderItem && matchedIp) {
            // Fetch available lots from PT zone (non-blocking — if endpoint fails, fallback to manual)
            const popup = { itemId: matchedOrderItem.id, product: matchedOrderItem.product, qty: 1, lot: '', availableLots: null };
            setUnitPickPopup(popup);
            setLastScan({ productName: matchedOrderItem.product?.name, status: 'scanning', message: 'Código de barras detectado — selecciona lote', timestamp: Date.now() });
            try {
                const res = await axios.get(`${API_URL}/finished-lots/available-lots/${matchedOrderItem.product?.id}`, { headers: AUTH() });
                const lots = res.data?.lots || [];
                setUnitPickPopup(prev => prev ? { ...prev, availableLots: lots, lot: lots.length === 1 ? lots[0].lotNumber : '' } : null);
            } catch { /* No lots registered yet — manual entry */ }
        } else if (matchedOrderItem) {
            playAlreadyDone();
            setLastScan({ productName: matchedOrderItem.product?.name || buffer, status: 'warning', message: 'Ya completado — no se necesitan más unidades', timestamp: Date.now() });
        } else {
            playError();
            setLastScan({ productName: buffer, status: 'error', message: 'Código de barras no encontrado en este pedido', timestamp: Date.now() });
        }
    }, [pickingOrder, pickingProgress, handleQrScan]);

    // ─── Handle Manual Lot Entry ─────────────────────────────────
    const handleManualLot = useCallback((orderItemId, product) => {
        if (!manualLot.trim()) return;

        const lotValue = manualLot.trim();

        // ── Guard: detect QR-formatted strings pasted into manual lot field ──
        // If it looks like a QR (contains LOT:|SKU:|BAR: or starts with {), route to scanner instead
        if (lotValue.includes('SKU:') || lotValue.includes('LOT:') || lotValue.includes('BAR:') || lotValue.startsWith('{')) {
            console.warn('[PICKING] QR string detected in manual lot field — routing to scanner parser');
            setManualLot('');
            handleScannerInput(lotValue);
            return;
        }

        const qrData = {
            productCode: product?.sku || '',
            barcode: product?.barcode || product?.sku || '',
            name: product?.name || '',
            lotNumber: lotValue,
            unitsPerBox: product?.packSize || 1,
            expirationDate: new Date(Date.now() + 270 * 86400000).toISOString().split('T')[0]
        };

        scanMutation.mutate({
            orderId: pickingOrder.id,
            orderItemId,
            qrData,
            scannedQty: product?.packSize || 1
        });
        setManualLot('');
    }, [manualLot, pickingOrder, scanMutation, handleScannerInput]);

    // ─── Status helpers ──────────────────────────────────────────
    const statusLabels = {
        PENDING: 'Pendiente', APPROVED: 'Aprobado', IN_PICKING: 'En Alistamiento',
        READY: 'Listo', INVOICED: 'Facturado', DISPATCHED: 'Despachado', DELIVERED: 'Entregado',
        CANCELLED: 'Cancelado', REJECTED: 'Rechazado'
    };

    const getStatusColor = (status) => {
        const colors = {
            PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-300',
            APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
            IN_PICKING: 'bg-purple-100 text-purple-800 border-purple-300',
            READY: 'bg-green-100 text-green-800 border-green-300',
            INVOICED: 'bg-teal-100 text-teal-800 border-teal-300',
            DISPATCHED: 'bg-indigo-100 text-indigo-800 border-indigo-300',
            DELIVERED: 'bg-gray-100 text-gray-800 border-gray-300',
            CANCELLED: 'bg-red-100 text-red-800 border-red-300',
            REJECTED: 'bg-red-100 text-red-800 border-red-300'
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const normalizeFlavor = (productName, productFlavor) => {
        if (productFlavor) return productFlavor.toUpperCase();
        const name = (productName || '').toUpperCase();
        const match = name.match(/SABOR\s+(?:A\s+)?(.+?)(?:\s+X\s+\d|\s*$)/);
        return match ? match[1].trim() : (name || 'SIN SABOR');
    };

    const normalizePresentation = (productName, productSize) => {
        const sizeStr = String(productSize || '').toUpperCase();
        const match = (productName || '').match(/\b(3400|1150|1000|500|360|350)\b/);
        const num = match ? match[1] : (sizeStr.match(/\d+/) || [null])[0];
        if (!num) return sizeStr || 'STD';
        if (num === '3400') return '3.4KG';
        if (num === '1150') return '1150G';
        if (num === '1000') return '1000ML';
        if (num === '500') return '500ML';
        if (num === '360') return '360ML';
        if (num === '350') return '350G';
        return num;
    };

    const detectBrand = (product) => {
        if (product?.accountGroup === 1401) return 'LIQUIPOPS';
        if (product?.accountGroup === 1402) return 'GENIALITY';
        const name = (product?.name || '').toUpperCase();
        if (name.includes('LIQUIPOPS') || name.includes('LIQUIPOS')) return 'LIQUIPOPS';
        if (name.includes('GENIALITY') || name.includes('SIROPE')) return 'GENIALITY';
        return 'OTROS';
    };

    const getUnitsPerBox = (order, item) => {
        const dbPackSize = item?.product?.packSize || 1;
        return order?.packingMode === 'EVEREST' ? 6 : dbPackSize;
    };

    const getPackingBreakdown = (units, unitsPerBox) => {
        const safeUnits = Math.max(0, Number(units) || 0);
        const safePack = Math.max(1, Number(unitsPerBox) || 1);

        if (safePack <= 1) {
            return {
                units: safeUnits,
                unitsPerBox: safePack,
                boxCount: safeUnits,
                isPartial: false,
                shortLabel: `${safeUnits} uds`,
                detailLabel: `${safeUnits} uds`,
                compactLabel: `${safeUnits} uds`
            };
        }

        const boxCount = Math.ceil(safeUnits / safePack);
        const fullBoxes = Math.floor(safeUnits / safePack);
        const remainder = safeUnits % safePack;
        const isPartial = safeUnits > 0 && remainder !== 0;
        const noun = boxCount === 1 ? 'caja' : 'cajas';

        let shortLabel = `${boxCount} ${noun}`;
        let detailLabel = `${boxCount} ${noun} · ${safeUnits} uds`;

        if (isPartial) {
            shortLabel = `${boxCount} ${noun}${boxCount === 1 ? ' parcial' : ' parciales'}`;
            detailLabel = fullBoxes > 0
                ? `${boxCount} ${noun} eq. · ${fullBoxes} completa${fullBoxes === 1 ? '' : 's'} + 1 parcial (${safeUnits} uds, x${safePack}/caja)`
                : `${shortLabel} · ${safeUnits}/${safePack} uds`;
        }

        return {
            units: safeUnits,
            unitsPerBox: safePack,
            boxCount,
            isPartial,
            shortLabel,
            detailLabel,
            compactLabel: `${safeUnits} uds · ${shortLabel}`
        };
    };

    const getEffectiveQty = (orderStatus, item) => {
        const allocated = item.allocatedQty ?? null;
        const requested = item.requestedQty ?? 0;
        let baseQty = 0;

        if (allocated === null || allocated === undefined) {
            baseQty = requested;
        } else if (allocated > 0) {
            baseQty = allocated;
        } else if (allocated === 0 && requested > 0 && ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'].includes(orderStatus)) {
            baseQty = requested;
        } else {
            baseQty = allocated;
        }

        // Subtract what is already picked for internal operational roles (admin, logistica).
        // Distributors and Comercial still see the full requested/allocated amount.
        if (!isDistributor && !isComercial && item.pickingItems) {
            const picked = item.pickingItems.reduce((acc, p) => acc + (p.scannedQty || 0), 0);
            return Math.max(0, baseQty - picked);
        }

        return baseQty;
    };

    const buildPendingMatrix = (ordersList = []) => {
        const matrix = {};
        const matrixDetails = {};
        const orderTotals = ordersList.map(order => {
            const total = (order.items || []).reduce((sum, item) => {
                const qty = getEffectiveQty(order.status, item);
                return sum + qty;
            }, 0);
            const boxesEq = (order.items || []).reduce((sum, item) => {
                const qty = getEffectiveQty(order.status, item);
                if (qty <= 0) return sum;
                return sum + getPackingBreakdown(qty, getUnitsPerBox(order, item)).boxCount;
            }, 0);
            return {
                id: order.id,
                number: order.orderNumber,
                total,
                boxesEq,
                status: order.status,
                distributor: order.distributor?.name || 'Venta Directa'
            };
        });

        ordersList.forEach(order => {
            (order.items || []).forEach(item => {
                const product = item.product || {};
                const brand = detectBrand(product);
                if (brand === 'OTROS') return;
                const flavor = normalizeFlavor(product.name, product.flavor);
                const presentation = normalizePresentation(product.name, product.size);
                const qty = getEffectiveQty(order.status, item);
                if (qty <= 0) return;
                const unitsPerBox = getUnitsPerBox(order, item);
                const pendingPack = getPackingBreakdown(qty, unitsPerBox);
                const requestedPack = getPackingBreakdown(item.requestedQty || 0, unitsPerBox);
                const pickedQty = (item.pickingItems || []).reduce((acc, p) => acc + (p.scannedQty || 0), 0);
                const pickedPack = getPackingBreakdown(pickedQty, unitsPerBox);

                if (!matrix[brand]) matrix[brand] = {};
                if (!matrix[brand][presentation]) matrix[brand][presentation] = {};
                if (!matrix[brand][presentation][flavor]) matrix[brand][presentation][flavor] = 0;
                matrix[brand][presentation][flavor] += qty;

                if (!matrixDetails[brand]) matrixDetails[brand] = {};
                if (!matrixDetails[brand][presentation]) matrixDetails[brand][presentation] = {};
                if (!matrixDetails[brand][presentation][flavor]) matrixDetails[brand][presentation][flavor] = [];
                matrixDetails[brand][presentation][flavor].push({
                    orderNumber: order.orderNumber,
                    status: order.status,
                    qty,
                    distributor: order.distributor?.name || 'Venta Directa',
                    requestedQty: item.requestedQty || 0,
                    allocatedQty: item.allocatedQty ?? 0,
                    pendingQty: item.pendingQty ?? 0,
                    unitsPerBox,
                    boxCount: pendingPack.boxCount,
                    boxLabel: pendingPack.shortLabel,
                    boxDetail: pendingPack.detailLabel,
                    requestedBoxLabel: requestedPack.shortLabel,
                    pickedQty,
                    pickedBoxLabel: pickedPack.shortLabel,
                    isBackorder: order.orderNumber?.includes('-BKO'),
                    packingMode: order.packingMode || 'STANDARD',
                    globalFifoRank: order.globalFifoRank || null,  // "Turno #N" — viene del backend para PENDING/APPROVED/IN_PICKING/READY
                });
            });
        });

        return { matrix, matrixDetails, orderTotals };
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <>
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Gestión de Pedidos</h1>
                    <div className="flex flex-wrap items-center gap-2">
                        {(canManageOrders || isDistributor) && (
                            <button
                                onClick={async () => {
                                    setExcelModal(true);
                                    setExcelFile(null);
                                    setExcelPreview(null);
                                    setExcelDistributor(isDistributor ? user.id : '');
                                    if (!isDistributor) {
                                        try {
                                            const res = await axios.get(`${API_URL}/admin/users`, { headers: AUTH() });
                                            setDistributors((res.data.data || res.data || []).filter(u => u.role === 'DISTRIBUIDOR'));
                                        } catch(e) { console.error(e); }
                                    }
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm"
                            >
                                <Upload className="w-4 h-4" />
                                📋 Sube tu pedido por Excel
                            </button>
                        )}
                        {isAdmin && (
                            <button
                                onClick={async () => {
                                    setScannerModal(true);
                                    setScannerItems([]);
                                    setScannerDistributor('');
                                    setScannerBarcodeText('');
                                    try {
                                        const [resDist, resCat] = await Promise.all([
                                            axios.get(`${API_URL}/admin/users`, { headers: AUTH() }),
                                            axios.get(`${API_URL}/products?active=true`, { headers: AUTH() })
                                        ]);
                                        setDistributors((resDist.data.data || resDist.data || []).filter(u => u.role === 'DISTRIBUIDOR'));
                                        setCatalogProducts(resCat.data.data || resCat.data || []);
                                    } catch(e) { console.error(e); }
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm shadow-sm"
                            >
                                <ScanLine className="w-4 h-4" />
                                📦 Pedido Rápido
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setPendingSummaryModal(true);
                                setPendingDistributorFilter('ALL');
                                setPendingCellDetail(null);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium text-sm"
                            title="Consolidado de pedidos por entregar"
                        >
                            <BarChart3 className="w-4 h-4" />
                            Consolidado Pendientes
                        </button>
                    </div>
                </div>

                {/* Status Filter (tabs) */}
                <div className="mb-3 flex gap-2 overflow-x-auto pb-2">
                    {['PENDING', 'APPROVED', 'IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED', 'DELIVERED'].map(status => {
                        const count = orderCounts?.[status] || 0;
                        return (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${statusFilter === status
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-700 hover:bg-gray-100'
                                    }`}
                            >
                                {statusLabels[status] || status}
                                {count > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold min-w-[20px] text-center ${statusFilter === status ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-700'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Búsqueda por orden o distribuidor — fila propia, ancho completo en tablet */}
                <div className="mb-4 relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar por orden o distribuidor..."
                        className="w-full pl-9 pr-9 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                    />
                    <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                    </svg>
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 text-lg leading-none">
                            ×
                        </button>
                    )}
                </div>

                {/* Consolidation bar — only for READY tab and admin/logistica */}
                {statusFilter === 'READY' && (isAdmin || isLogistica) && selectedForConsolidation.size >= 2 && (() => {
                    const selectedOrders = (orders || []).filter(o => selectedForConsolidation.has(o.id));
                    const distinctDistributors = new Set(selectedOrders.map(o => o.distributorId));
                    const sameDistributor = distinctDistributors.size === 1;
                    return (
                        <div className={`mb-4 p-4 rounded-xl border-2 flex items-center justify-between gap-4 ${sameDistributor ? 'bg-purple-50 border-purple-300' : 'bg-amber-50 border-amber-300'}`}>
                            <div className="flex items-center gap-3">
                                <div className="text-3xl">📦</div>
                                <div>
                                    <div className="font-bold text-gray-800">{selectedForConsolidation.size} pedidos seleccionados</div>
                                    {sameDistributor ? (
                                        <div className="text-xs text-purple-700">Mismo distribuidor — listo para consolidar en una sola factura</div>
                                    ) : (
                                        <div className="text-xs text-amber-700">⚠️ Solo se pueden consolidar pedidos del mismo distribuidor</div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setSelectedForConsolidation(new Set())}
                                    className="px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                                >Cancelar</button>
                                <button
                                    onClick={async () => {
                                        if (!sameDistributor) return;
                                        if (!confirm(`¿Consolidar ${selectedForConsolidation.size} pedidos en uno solo?\n\nSe creará un nuevo pedido CON-XXXX con la suma de todos los items. Los originales quedarán marcados como consolidados.`)) return;
                                        setConsolidating(true);
                                        try {
                                            const res = await axios.post(`${API_URL}/orders/consolidate`, { orderIds: Array.from(selectedForConsolidation) }, { headers: AUTH() });
                                            alert(`✓ Pedidos consolidados en ${res.data.order.orderNumber}`);
                                            setSelectedForConsolidation(new Set());
                                            queryClient.invalidateQueries(['admin-orders']);
                                            queryClient.invalidateQueries(['order-counts']);
                                        } catch (e) {
                                            alert('Error: ' + (e.response?.data?.error || e.message));
                                        } finally {
                                            setConsolidating(false);
                                        }
                                    }}
                                    disabled={!sameDistributor || consolidating}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-all ${sameDistributor && !consolidating ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-400 cursor-not-allowed'}`}
                                >
                                    {consolidating ? 'Consolidando...' : `Consolidar ${selectedForConsolidation.size} pedidos`}
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {/* Orders List (filtra por búsqueda en orden o distribuidor) */}
                <div className="space-y-4">
                    {(() => {
                        const q = searchQuery.trim().toLowerCase();
                        const visibleOrders = q
                            ? (orders || []).filter(o =>
                                (o.orderNumber || '').toLowerCase().includes(q) ||
                                (o.distributor?.name || '').toLowerCase().includes(q))
                            : (orders || []);
                        if (visibleOrders.length === 0) {
                            return (
                                <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
                                    <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                                    <p>{q ? `No hay pedidos que coincidan con "${searchQuery}"` : `No hay pedidos con estado ${statusLabels[statusFilter] || statusFilter}`}</p>
                                </div>
                            );
                        }
                        return visibleOrders.map((order, index) => {
                            const progress = order.pickingProgress || 0;
                            const totalItems = order.items?.length || 0;
                            const completedItems = order.items?.filter(i => {
                                const scanned = i.pickingItems?.reduce((s, p) => s + p.scannedQty, 0) || 0;
                                return scanned >= i.requestedQty;
                            }).length || 0;

                            // ── Animated progress card for IN_PICKING (distributor view) ──
                            if (order.status === 'IN_PICKING' && !(isAdmin || isLogistica)) {
                                return (
                                    <div key={order.id} className="bg-white rounded-2xl shadow-lg border border-purple-100 overflow-hidden">
                                        {/* Header with inline progress */}
                                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center">
                                                    <div className="flex items-center justify-center min-w-[50px] w-[50px] h-[50px] bg-white/20 text-white rounded-xl text-3xl font-black mr-4 shadow-inner border border-white/30 flex-shrink-0">
                                                        {order.globalFifoRank || index + 1}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <h3 className="text-lg font-bold text-white">{order.orderNumber}</h3>
                                                        <p className="text-purple-200 text-xs mt-1">{new Date(order.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="relative flex h-2.5 w-2.5">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                                    </span>
                                                    <span className="text-white text-sm font-medium">En alistamiento</span>
                                                </div>
                                            </div>
                                            {/* Inline progress bar */}
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 h-2.5 bg-white/20 rounded-full overflow-hidden">
                                                    <div className={`h-full rounded-full transition-all duration-700 ease-out ${progress >= 100 ? 'bg-green-400' : 'bg-white'}`}
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                                <span className="text-white font-bold text-sm min-w-[40px] text-right">{progress}%</span>
                                            </div>
                                            <p className="text-purple-200 text-xs mt-1.5">
                                                {completedItems} de {totalItems} productos separados
                                            </p>
                                        </div>

                                        {/* Order Notes (visible to distributor) */}
                                        {(order.notes || editingNoteId === order.id) ? (
                                            <div className="mx-6 mt-3 flex flex-col gap-2 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl relative group">
                                                <div className="flex items-start gap-2.5">
                                                    <span className="text-amber-500 mt-0.5 flex-shrink-0 text-base">💬</span>
                                                    {editingNoteId === order.id ? (
                                                        <div className="flex-1 w-full flex flex-col gap-2">
                                                            <textarea
                                                                className="w-full text-sm text-gray-800 p-2 rounded border border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                                                                value={editNoteContent}
                                                                onChange={(e) => setEditNoteContent(e.target.value)}
                                                                rows="2"
                                                            />
                                                            <div className="flex gap-2 justify-end">
                                                                <button onClick={() => setEditingNoteId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancelar</button>
                                                                <button onClick={() => updateNoteMutation.mutate({ orderId: order.id, notes: editNoteContent })} className="text-xs bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700 disabled:opacity-50" disabled={updateNoteMutation.isPending}>Guardar</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex-1">
                                                            <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">
                                                                <span className="font-semibold text-amber-900">Nota:</span>{' '}
                                                                {order.notes}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                                {editingNoteId !== order.id && (
                                                    <button onClick={() => { setEditingNoteId(order.id); setEditNoteContent(order.notes || ''); }} className="absolute top-2 right-2 opacity-100 transition-opacity text-xs bg-white text-amber-700 border border-amber-300 px-2 py-0.5 rounded shadow-sm hover:bg-amber-100">
                                                        Editar
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="mx-6 mt-3">
                                                <button onClick={() => { setEditingNoteId(order.id); setEditNoteContent(''); }} className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1 font-medium bg-amber-50 px-2 py-1 rounded border border-transparent hover:border-amber-200 transition">
                                                    <span className="text-sm">+</span> Agregar nota
                                                </button>
                                            </div>
                                        )}

                                        {/* Collapsible per-item progress */}
                                        <div className="px-6 pb-4">
                                            <div className="flex items-center justify-between cursor-pointer hover:bg-purple-50 rounded-lg px-3 py-2 -mx-3 transition"
                                                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                            >
                                                <span className="text-sm text-gray-600 font-medium">
                                                    {completedItems}/{totalItems} productos separados • {order.items?.reduce((sum, i) => {
                                                        return sum + getPackingBreakdown(i.requestedQty, getUnitsPerBox(order, i)).boxCount;
                                                    }, 0)} cajas eq.
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs text-purple-500">{expandedOrderId === order.id ? 'Ocultar' : 'Ver productos'}</span>
                                                    {expandedOrderId === order.id ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />}
                                                </div>
                                            </div>
                                        </div>

                                        {expandedOrderId === order.id && (
                                        <div className="px-6 pb-6">
                                            <div className="space-y-2">
                                                {order.items?.map(item => {
                                                    const packSize = getUnitsPerBox(order, item);
                                                    const scanned = item.pickingItems?.reduce((s, p) => s + p.scannedQty, 0) || 0;
                                                    const itemPct = Math.min(100, Math.round((scanned / item.requestedQty) * 100));
                                                    const done = scanned >= item.requestedQty;
                                                    const requestedPack = getPackingBreakdown(item.requestedQty, packSize);
                                                    const scannedPack = getPackingBreakdown(scanned, packSize);
                                                    return (
                                                        <div key={item.id} className={`p-3 rounded-xl transition-all duration-500 ${done ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-100'}`}>
                                                            <div className="flex items-start gap-2 mb-1.5">
                                                                <div className="mt-0.5 flex-shrink-0">
                                                                    {done ? (
                                                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                                                    ) : (
                                                                        <Box className="w-4 h-4 text-purple-400" />
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-sm font-medium text-gray-800 leading-snug">
                                                                        {item.product?.name || item.product?.sku}
                                                                    </div>
                                                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                        <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-purple-600'}`}>
                                                                            {scanned}/{item.requestedQty} uds
                                                                        </span>
                                                                        <span className="text-[11px] text-gray-500">
                                                                            {requestedPack.detailLabel}
                                                                        </span>
                                                                        {scanned > 0 && (
                                                                            <span className="text-[11px] text-gray-400">
                                                                                Alistado: {scannedPack.detailLabel}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                                                <div className={`h-full rounded-full transition-all duration-700 ease-out ${done ? 'bg-green-500' : 'bg-gradient-to-r from-purple-500 to-indigo-500'}`}
                                                                    style={{ width: `${itemPct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                );
                            }

                            // ── Standard order card (admin + other statuses) ──
                            return (
                            <div key={order.id} className="bg-white rounded-lg shadow-md p-6 relative overflow-hidden">
                                {/* Optional: Subtle FIFO rank watermark or pill */}
                                <div className="absolute top-0 right-0 bg-gray-100 text-gray-400 font-black text-xs px-3 py-1 rounded-bl-lg border-b border-l border-gray-200">
                                    Turno #{order.globalFifoRank || index + 1}
                                </div>
                                <div className="flex justify-between items-start mb-4">
                                    <div className="pt-2 flex items-start">
                                        {/* Checkbox for consolidation — only on READY tab and admin/logistica */}
                                        {statusFilter === 'READY' && (isAdmin || isLogistica) && !order.isConsolidation && !order.consolidatedIntoOrderId && (
                                            <input
                                                type="checkbox"
                                                checked={selectedForConsolidation.has(order.id)}
                                                onChange={(e) => {
                                                    const next = new Set(selectedForConsolidation);
                                                    if (e.target.checked) next.add(order.id);
                                                    else next.delete(order.id);
                                                    setSelectedForConsolidation(next);
                                                }}
                                                onClick={e => e.stopPropagation()}
                                                className="mr-3 mt-3 w-5 h-5 cursor-pointer"
                                                title="Seleccionar para consolidar"
                                            />
                                        )}
                                        <div className="flex items-center justify-center min-w-[56px] w-[56px] h-[56px] bg-purple-100 text-purple-700 rounded-xl text-4xl font-black mr-4 shadow-sm border border-purple-200 flex-shrink-0">
                                            {order.globalFifoRank || index + 1}
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-semibold text-gray-900">
                                                {order.orderNumber}
                                                {order.isConsolidation && (
                                                    <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 rounded-full border border-purple-300">
                                                        CONSOLIDADO ({order.consolidatedFromOrderIds?.length || 0})
                                                    </span>
                                                )}
                                                {order.consolidatedIntoOrderId && (
                                                    <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full border border-amber-300">
                                                        Consolidado en otro pedido
                                                    </span>
                                                )}
                                            </h3>
                                            <p className="text-sm text-gray-600 mt-1">
                                                Distribuidor: <span className="font-medium">{order.distributor?.name}</span>
                                            </p>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {new Date(order.createdAt).toLocaleString('es-ES')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {order.status === 'IN_PICKING' && (() => {
                                            const circ = 2 * Math.PI * 16;
                                            const offset = circ - (progress / 100) * circ;
                                            return (
                                                <div className="flex items-center gap-2">
                                                    <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                                                        <circle cx="20" cy="20" r="16" fill="none" stroke="#E5E7EB" strokeWidth="3" />
                                                        <circle cx="20" cy="20" r="16" fill="none" stroke={progress >= 100 ? '#22C55E' : '#8B5CF6'}
                                                            strokeWidth="3" strokeLinecap="round"
                                                            strokeDasharray={circ} strokeDashoffset={offset}
                                                            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                                                        />
                                                    </svg>
                                                    <span className={`text-sm font-bold ${progress >= 100 ? 'text-green-600' : 'text-purple-600'}`}>{progress}%</span>
                                                </div>
                                            );
                                        })()}
                                        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(order.status)}`}>
                                            {statusLabels[order.status] || order.status}
                                        </span>
                                    </div>
                                </div>

                                {/* Order Notes */}
                                        {(order.notes || editingNoteId === order.id) ? (
                                            <div className="mb-3 flex flex-col gap-2 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl relative group">
                                                <div className="flex items-start gap-2.5">
                                                    <span className="text-amber-500 mt-0.5 flex-shrink-0 text-base">💬</span>
                                                    {editingNoteId === order.id ? (
                                                        <div className="flex-1 w-full flex flex-col gap-2">
                                                            <textarea
                                                                className="w-full text-sm text-gray-800 p-2 rounded border border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                                                                value={editNoteContent}
                                                                onChange={(e) => setEditNoteContent(e.target.value)}
                                                                rows="2"
                                                            />
                                                            <div className="flex gap-2 justify-end">
                                                                <button onClick={() => setEditingNoteId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancelar</button>
                                                                <button onClick={() => updateNoteMutation.mutate({ orderId: order.id, notes: editNoteContent })} className="text-xs bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700 disabled:opacity-50" disabled={updateNoteMutation.isPending}>Guardar</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex-1">
                                                            <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">
                                                                <span className="font-semibold text-amber-900">Nota:</span>{' '}
                                                                {order.notes}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                                {editingNoteId !== order.id && (
                                                    <button onClick={() => { setEditingNoteId(order.id); setEditNoteContent(order.notes || ''); }} className="absolute top-2 right-2 opacity-100 transition-opacity text-xs bg-white text-amber-700 border border-amber-300 px-2 py-0.5 rounded shadow-sm hover:bg-amber-100">
                                                        Editar
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="mb-3">
                                                <button onClick={() => { setEditingNoteId(order.id); setEditNoteContent(''); }} className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1 font-medium bg-amber-50 px-2 py-1 rounded border border-transparent hover:border-amber-200 transition">
                                                    <span className="text-sm">+</span> Agregar nota
                                                </button>
                                            </div>
                                        )}

                                {/* Compact summary row — click to expand */}
                                <div className="flex items-center justify-between border-t pt-3 mb-3 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2 transition"
                                    onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                >
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Package className="w-4 h-4 text-gray-400" />
                                        <span className="font-medium">{order.items?.length} productos</span>
                                        <span className="text-gray-400">•</span>
                                        <span>{order.items?.reduce((sum, i) => {
                                            return sum + getPackingBreakdown((i.allocatedQty || i.requestedQty), getUnitsPerBox(order, i)).boxCount;
                                        }, 0)} cajas eq.</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400">{expandedOrderId === order.id ? 'Ocultar' : 'Ver detalle'}</span>
                                        {expandedOrderId === order.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                    </div>
                                </div>

                                {/* Expanded items list */}
                                {expandedOrderId === order.id && (
                                <div className="mb-4">
                                    <div className="space-y-1.5">
                                        {order.items?.map(item => {
                                            const packSize = getUnitsPerBox(order, item);
                                            const requestedPack = getPackingBreakdown(item.requestedQty, packSize);
                                            const name = item.product?.name || item.product?.sku || '?';
                                            const stock = item.product?.currentStock || 0;
                                            // Group picking items by lot number
                                            const lotMap = {};
                                            (item.pickingItems || []).forEach(pi => {
                                                if (pi.lotNumber) lotMap[pi.lotNumber] = (lotMap[pi.lotNumber] || 0) + (pi.scannedQty || 0);
                                            });
                                            const lots = Object.entries(lotMap);
                                            const totalPicked = lots.reduce((s, [, q]) => s + q, 0);
                                            const pickedPack = getPackingBreakdown(totalPicked, packSize);
                                            // After picking starts: show Pedido vs Alistado; before: show stock
                                            const showPickedView = ['IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED', 'DELIVERED'].includes(order.status);
                                            const sufficient = !showPickedView ? stock >= item.requestedQty : totalPicked >= item.requestedQty;
                                            return (
                                                <div key={item.id} className={`px-3 py-2 rounded-lg ${showPickedView ? (sufficient ? 'bg-gray-50' : 'bg-amber-50') : (stock >= item.requestedQty ? 'bg-gray-50' : 'bg-amber-50')}`}>
                                                    <div className="text-sm">
                                                        <div className="text-gray-800 font-semibold leading-snug mb-1">{name}</div>
                                                        <div className="flex items-center gap-2 flex-wrap text-xs">
                                                            {showPickedView ? (
                                                                <>
                                                                    <span className="text-gray-500">
                                                                        Pedido: <strong>{item.requestedQty} uds</strong> <span className="text-gray-400">({requestedPack.shortLabel})</span>
                                                                    </span>
                                                                    <span className="text-gray-300">|</span>
                                                                    <span className={`font-semibold ${sufficient ? 'text-green-600' : 'text-amber-600'}`}>
                                                                        Alistado: {totalPicked} uds <span className="text-gray-400">({pickedPack.shortLabel})</span>
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    {(isAdmin || isLogistica) && (
                                                                        <span className={`${stock >= item.requestedQty ? 'text-green-600' : 'text-amber-600'}`}>
                                                                            Stock: {stock}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-gray-600 font-medium">
                                                                        {requestedPack.shortLabel}
                                                                        <span className="text-gray-400 ml-1">({item.requestedQty} uds)</span>
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {lots.length > 0 && (
                                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                            {lots.map(([lot, qty]) => (
                                                                <span key={lot} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                                                                    📦 Lote {lot} · <strong>{qty} uds</strong>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                )}

                                {/* Actions */}
                                {(isAdmin || isLogistica || isComercial || (isDistributor && order.status === 'DISPATCHED')) && (
                                <div className="flex gap-3 flex-wrap">
                                    {order.status === 'PENDING' && (
                                        <button
                                            onClick={() => setSelectedOrder(order)}
                                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                        >
                                            <ClipboardList className="w-4 h-4" />
                                            Ver Pedido
                                        </button>
                                    )}

                                    {/* Botón Eliminar para ADMIN si no hay nada pickeado */}
                                    {isAdmin && order.items?.reduce((sum, item) => sum + (item.pickingItems?.reduce((s, p) => s + p.scannedQty, 0) || 0), 0) === 0 && (
                                        <button
                                            onClick={() => {
                                                if (window.confirm(`¿Estás seguro de que quieres ELIMINAR permanentemente el pedido ${order.orderNumber}? Todo el inventario reservado será devuelto.`)) {
                                                    deleteOrderMutation.mutate(order.id);
                                                }
                                            }}
                                            disabled={deleteOrderMutation.isPending}
                                            className="flex items-center gap-2 px-4 py-2 bg-rose-100 text-rose-700 border border-rose-300 rounded-md hover:bg-rose-200"
                                            title="Eliminar pedido permanentemente"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Eliminar Pedido
                                        </button>
                                    )}

                                    {order.status === 'APPROVED' && (
                                        <button
                                            onClick={() => startPickingMutation.mutate(order.id)}
                                            disabled={startPickingMutation.isPending}
                                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400"
                                        >
                                            <ScanLine className="w-4 h-4" />
                                            Iniciar Separación
                                        </button>
                                    )}

                                    {order.status === 'IN_PICKING' && (
                                        <button
                                            onClick={() => openPickingModal(order)}
                                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                                        >
                                            <ScanLine className="w-4 h-4" />
                                            Continuar Separación
                                        </button>
                                    )}

                                    {/* Print picking sheet — available for APPROVED/IN_PICKING/READY/INVOICED */}
                                    {['APPROVED', 'IN_PICKING', 'READY', 'INVOICED'].includes(order.status) && (isAdmin || isLogistica) && (
                                        <button
                                            onClick={() => window.open(`${API_URL}/orders/${order.id}/picking-sheet`, '_blank')}
                                            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200"
                                            title="Imprimir hoja de separación"
                                        >
                                            <Printer className="w-4 h-4" />
                                            Imprimir
                                        </button>
                                    )}

                                    {order.status === 'READY' && (isAdmin || isLogistica || isComercial) && (
                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col items-start gap-1">
                                                <span className={`text-[10px] uppercase font-bold ${(order.readyPhotosUrls || []).length >= 3 ? 'text-green-600' : 'text-amber-600'}`}>
                                                    Evidencia: {(order.readyPhotosUrls || []).length}/3 fotos
                                                </span>
                                                <label className="flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300 rounded cursor-pointer transition">
                                                    <Camera className="w-4 h-4" />
                                                    <span className="text-xs font-semibold">Subir Foto</span>
                                                    <input 
                                                        type="file" 
                                                        accept="image/*" 
                                                        capture="environment"
                                                        className="hidden"
                                                        onChange={async (e) => {
                                                            const file = e.target.files[0];
                                                            if (!file) return;
                                                            try {
                                                                const formData = new FormData();
                                                                formData.append('photo', file);
                                                                await axios.post(`${API_URL}/orders/${order.id}/ready-photos`, formData, { headers: AUTH() });
                                                                queryClient.invalidateQueries(['admin-orders']);
                                                            } catch (err) {
                                                                alert('Error al subir foto de evidencia');
                                                            }
                                                            e.target.value = null;
                                                        }}
                                                    />
                                                </label>
                                            </div>

                                            {(isAdmin || isComercial) && (
                                                <button
                                                    onClick={() => setInvoiceModal(order)}
                                                    disabled={(order.readyPhotosUrls || []).length < 3}
                                                    className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed self-end h-[34px]"
                                                    title={(order.readyPhotosUrls || []).length < 3 ? "Se requieren mínimo 3 fotos antes de facturar" : "Facturar pedido"}
                                                >
                                                    <FileText className="w-4 h-4" />
                                                    Facturar
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {order.status === 'READY' && isAdmin && (
                                        <button
                                            onClick={() => {
                                                if (window.confirm(`¿Devolver ${order.orderNumber} a En Alistamiento?`)) {
                                                    revertToPickingMutation.mutate({ orderId: order.id });
                                                }
                                            }}
                                            disabled={revertToPickingMutation.isPending}
                                            className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-md hover:bg-amber-200 disabled:opacity-50"
                                            title="Devolver a En Alistamiento"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            Devolver
                                        </button>
                                    )}

                                    {order.status === 'INVOICED' && (isAdmin || isLogistica) && (
                                        <button
                                            onClick={() => setDispatchModal(order)}
                                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                                        >
                                            <Truck className="w-4 h-4" />
                                            Despachar
                                        </button>
                                    )}

                                    {order.status === 'DISPATCHED' && (isAdmin || isDistributor) && (
                                        <button
                                            onClick={() => { setDeliverModal(order); setSignedGuideFile(null); }}
                                            disabled={deliverMutation.isPending}
                                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                                        >
                                            <CheckCircle className="w-4 h-4" />
                                            {deliverMutation.isPending ? 'Confirmando...' : 'Confirmar Entrega'}
                                        </button>
                                    )}
                                </div>
                                )}

                                {/* Siigo Invoice info */}
                                {order.invoiceNumber && (
                                    <div className="mt-3 p-3 bg-teal-50 rounded-md border border-teal-200 flex items-center gap-3">
                                        <FileText className="w-5 h-5 text-teal-600 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-teal-800">
                                                Factura Siigo: {order.invoiceNumber}
                                            </p>
                                            {order.invoicedAt && (
                                                <p className="text-xs text-teal-600">
                                                    Facturado: {new Date(order.invoicedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                                                </p>
                                            )}
                                        </div>
                                        {order.invoicePdfUrl && (
                                            <a
                                                href={order.invoicePdfUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 transition flex items-center gap-1"
                                            >
                                                📄 Ver PDF
                                            </a>
                                        )}
                                    </div>
                                )}
                                {order.transportGuideNumber && (
                                    <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-200 flex items-center justify-between">
                                        <div>
                                            <p className="text-sm text-blue-800">
                                                <strong>Guía:</strong> {order.transportGuideNumber}
                                            </p>
                                            {order.driverName && <p className="text-xs text-blue-600 mt-1">Conductor: {order.driverName} — Placa: {order.licensePlate}</p>}
                                        </div>
                                        <button
                                            onClick={() => window.open(`${API_URL}/orders/${order.id}/transport-guide`, '_blank')}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
                                        >
                                            <Printer className="w-3 h-3" /> Imprimir Guía
                                        </button>
                                    </div>
                                )}
                                {order.signedGuideUrl && (
                                    <div className="mt-3 p-3 bg-green-50 rounded-md border border-green-200 flex items-center gap-3">
                                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-green-800">Guía Firmada por Distribuidor</p>
                                            {order.deliveredAt && (
                                                <p className="text-xs text-green-600">
                                                    Entregado: {new Date(order.deliveredAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                                                </p>
                                            )}
                                        </div>
                                        <button onClick={() => setImageModal(`${API_URL.replace('/api', '')}${order.signedGuideUrl}`)}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-md hover:bg-green-700">
                                            📷 Ver Firma
                                        </button>
                                    </div>
                                )}
                                {order.rejectedReason && (
                                    <div className="mt-4 p-3 bg-red-50 rounded-md border border-red-200">
                                        <p className="text-sm text-red-800">
                                            <strong>Razón de rechazo:</strong> {order.rejectedReason}
                                        </p>
                                    </div>
                                )}
                            </div>
                            );
                        });
                    })()}
                </div>
            </div>

            {/* ════════════════ SUCCESS / ERROR MODAL ══════════════════════ */}
            {successModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setSuccessModal(null)}>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                        onClick={e => e.stopPropagation()}
                        style={{ animation: 'modalPop 0.25s cubic-bezier(.175,.885,.32,1.275)' }}>
                        {/* Gradient header */}
                        <div className={`px-6 pt-8 pb-6 text-center ${
                            successModal.type === 'success'
                                ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                                : 'bg-gradient-to-br from-red-500 to-rose-600'
                        }`}>
                            {/* Animated icon */}
                            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                                <span className="text-white text-4xl">
                                    {successModal.type === 'success' ? '✓' : '✕'}
                                </span>
                            </div>
                            <h2 className="text-xl font-bold text-white">{successModal.title}</h2>
                            <p className="text-white/80 text-sm mt-1 font-semibold tracking-wide">
                                {successModal.message}
                            </p>
                        </div>
                        {/* Body */}
                        <div className="px-6 py-5">
                            {successModal.detail && (
                                <p className="text-gray-600 text-sm text-center leading-relaxed">
                                    {successModal.detail}
                                </p>
                            )}
                            {/* Botón copiar para WhatsApp — solo en facturas exitosas */}
                            {successModal.type === 'success' && successModal.copyText && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(successModal.copyText).then(() => {
                                            setSuccessModal(prev => ({ ...prev, copied: true }));
                                            setTimeout(() => setSuccessModal(prev => prev ? ({ ...prev, copied: false }) : null), 2000);
                                        });
                                    }}
                                    className={`mt-4 w-full py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 border-2 ${
                                        successModal.copied
                                            ? 'bg-green-100 border-green-400 text-green-700'
                                            : 'bg-white border-emerald-400 text-emerald-700 hover:bg-emerald-50'
                                    }`}
                                >
                                    {successModal.copied ? '✅ ¡Copiado!' : '📋 Copiar para WhatsApp'}
                                </button>
                            )}
                            <button
                                onClick={() => setSuccessModal(null)}
                                className={`mt-3 w-full py-3 rounded-xl font-semibold text-white transition-all active:scale-95 ${
                                    successModal.type === 'success'
                                        ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700'
                                        : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700'
                                }`}>
                                {successModal.type === 'success' ? 'Perfecto' : 'Entendido'}
                            </button>
                        </div>
                    </div>

                    <style>{`@keyframes modalPop { from { opacity:0; transform:scale(0.85) translateY(20px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
                </div>
            )}

            {/* ════════════════ IMAGE MODAL ═══════════════════════════════ */}

            {imageModal && (
                <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50 cursor-pointer"
                    onClick={() => setImageModal(null)}>
                    <div className="relative max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setImageModal(null)}
                            className="absolute -top-10 right-0 text-white text-3xl hover:text-gray-300">&times;</button>
                        <img src={imageModal} alt="Guía firmada" className="w-full max-h-[70vh] object-contain rounded-lg shadow-2xl" />
                    </div>
                </div>
            )}

            {selectedOrder && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 pb-24 md:pb-4 z-50">
                    <div className="bg-white rounded-lg max-w-3xl w-full p-6 pb-8 md:pb-6 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold">{selectedOrder.orderNumber}</h3>
                            <button onClick={() => setSelectedOrder(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        <p className="text-sm text-gray-600 mb-1">
                            Distribuidor: <span className="font-medium">{selectedOrder.distributor?.name}</span>
                        </p>
                        <p className="text-xs text-gray-500 mb-4">
                            {new Date(selectedOrder.createdAt).toLocaleString('es-ES')}
                        </p>

                        {/* Items Table */}
                        <div className="border rounded-lg overflow-hidden mb-4">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-medium">Producto</th>
                                        <th className="text-center px-4 py-2 font-medium">Solicitado</th>
                                        <th className="text-center px-4 py-2 font-medium">Stock Actual</th>
                                        <th className="text-center px-4 py-2 font-medium">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedOrder.items?.map((item, idx) => {
                                        const stock = item.product?.currentStock || 0;
                                        const requested = item.requestedQty;
                                        const sufficient = stock >= requested;
                                        const coverage = requested > 0 ? Math.min(Math.round((stock / requested) * 100), 999) : 100;
                                        return (
                                            <tr key={idx} className={`border-t ${!sufficient ? 'bg-amber-50' : ''}`}>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-900">{item.product?.name}</div>
                                                    <div className="text-xs text-gray-500">{item.product?.sku}</div>
                                                </td>
                                                <td className="text-center px-4 py-3 font-semibold">
                                                    {requested.toLocaleString()}
                                                </td>
                                                <td className="text-center px-4 py-3">
                                                    <span className={`font-semibold ${sufficient ? 'text-green-700' : 'text-amber-600'}`}>
                                                        {stock.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="text-center px-4 py-3">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sufficient ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-700'
                                                        }`}>
                                                        {sufficient ? '✅' : '⚠️'} {Math.min(coverage, 100)}%{coverage > 100 ? '+' : ''}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Summary */}
                        {(() => {
                            const allSufficient = selectedOrder.items?.every(i => (i.product?.currentStock || 0) >= i.requestedQty);
                            const insufficientCount = selectedOrder.items?.filter(i => (i.product?.currentStock || 0) < i.requestedQty).length || 0;
                            const sufficientCount = (selectedOrder.items?.length || 0) - insufficientCount;
                            return allSufficient ? (
                                <div className="p-3 rounded-lg mb-4 text-sm bg-green-50 border border-green-200">
                                    <p className="text-green-800 font-medium">✅ Todos los productos tienen stock suficiente. Puedes aprobar directamente.</p>
                                </div>
                            ) : (
                                <div className="mb-4 space-y-2 text-sm">
                                    <p className="font-semibold text-gray-700">⚠️ {insufficientCount} producto(s) sin stock completo. Elige cómo proceder:</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="p-2.5 rounded-lg border border-amber-300 bg-amber-50">
                                            <p className="font-bold text-amber-800 text-xs">✂️ SOLO LO DISPONIBLE</p>
                                            <p className="text-amber-700 text-xs mt-0.5">Se despachan <strong>{sufficientCount}</strong> referencias con stock. Los <strong>{insufficientCount}</strong> faltantes <u>NO se incluyen</u> en este pedido.</p>
                                        </div>
                                        <div className="p-2.5 rounded-lg border border-green-300 bg-green-50">
                                            <p className="font-bold text-green-800 text-xs">📦 CON BACKORDER</p>
                                            <p className="text-green-700 text-xs mt-0.5">Se incluyen <strong>todos</strong> los productos. Los <strong>{insufficientCount}</strong> faltantes quedan en cola de producción para despacho posterior.</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {selectedOrder.notes && (
                            <div className="mb-4 p-3 bg-yellow-50 rounded-md border border-yellow-200">
                                <p className="text-sm text-yellow-800">
                                    <strong>Notas:</strong> {selectedOrder.notes}
                                </p>
                            </div>
                        )}

                        {/* PENDING Actions */}
                        {selectedOrder.status === 'PENDING' && (() => {
                            const hasInsufficient = selectedOrder.items?.some(i => (i.product?.currentStock || 0) < i.requestedQty);
                            return (
                                <div className="flex flex-col sm:flex-row sm:justify-end gap-4 border-t pt-5 mt-2">
                                    <button
                                        onClick={() => {
                                            const reason = prompt('Razón del rechazo:');
                                            if (reason) rejectMutation.mutate({ orderId: selectedOrder.id, reason });
                                        }}
                                        className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 text-sm font-bold w-full sm:w-auto"
                                    >
                                        <XCircle className="w-5 h-5 sm:w-4 sm:h-4" /> Rechazar
                                    </button>
                                    {hasInsufficient && (
                                        <div className="flex flex-col items-center gap-1 w-full sm:w-auto">
                                            <button
                                                onClick={() => setConfirmSkipModal(true)}
                                                disabled={approveMutation.isPending}
                                                className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 w-full bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:bg-gray-400 font-bold text-sm"
                                            >
                                                ✂️ Aprobar solo lo disponible
                                            </button>
                                            <span className="text-xs text-amber-700 font-medium tracking-tight">Omite los faltantes</span>
                                        </div>
                                    )}
                                    <div className="flex flex-col items-center gap-1 w-full sm:w-auto">
                                        <button
                                            onClick={() => approveMutation.mutate({ orderId: selectedOrder.id })}
                                            disabled={approveMutation.isPending}
                                            className="flex items-center justify-center gap-2 px-5 py-3 sm:py-2 w-full bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:bg-gray-400 font-bold text-sm"
                                        >
                                            <CheckCircle className="w-5 h-5 sm:w-4 sm:h-4" />
                                            {hasInsufficient ? 'Aprobar con backorder' : 'Aprobar Pedido'}
                                        </button>
                                        {hasInsufficient && <span className="text-xs text-green-700 font-medium tracking-tight">Incluye todos, faltantes en cola</span>}
                                    </div>
                                </div>
                            );
                        })()}


                    </div>
                </div>
            )}

            {/* ════════════════ DELIVER MODAL ═══════════════════════════════ */}
            {deliverModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg max-w-md w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">Confirmar Entrega</h3>
                            <button onClick={() => setDeliverModal(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        <div className="mb-4 p-3 bg-gray-50 rounded-md">
                            <p className="text-sm text-gray-600">Pedido: <strong>{deliverModal.orderNumber}</strong></p>
                            <p className="text-sm text-gray-600">Guía: <strong>{deliverModal.transportGuideNumber}</strong></p>
                        </div>

                        {isAdmin ? (
                            <div>
                                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
                                    <p className="text-sm font-semibold text-amber-800">📋 Debe subir la guía de transporte firmada por el distribuidor</p>
                                    <p className="text-xs text-amber-600 mt-1">Foto o PDF de la guía con la firma de recibido</p>
                                </div>
                                <label className="block mb-4">
                                    <div className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition
                                        ${signedGuideFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'}`}>
                                        <input type="file" accept="image/*,.pdf" className="hidden"
                                            onChange={(e) => setSignedGuideFile(e.target.files[0])} />
                                        {signedGuideFile ? (
                                            <div>
                                                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                                                <p className="text-sm font-medium text-green-700">{signedGuideFile.name}</p>
                                                <p className="text-xs text-green-500 mt-1">Archivo seleccionado — listo para subir</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                                <p className="text-sm font-semibold text-gray-600">Toque o presione Ctrl+V para pegar</p>
                                                <p className="text-xs text-gray-400 mt-1">Foto o PDF (máx. 10MB)</p>
                                            </div>
                                        )}
                                    </div>
                                </label>
                            </div>
                        ) : (
                            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md text-center">
                                <Package className="w-10 h-10 text-green-500 mx-auto mb-2" />
                                <p className="text-sm font-semibold text-green-800">¿Confirma que recibió este pedido?</p>
                                <p className="text-xs text-green-600 mt-1">Esta acción marcará el pedido como entregado</p>
                            </div>
                        )}

                        <div className="flex gap-3 mt-4">
                            <button onClick={() => setDeliverModal(null)}
                                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    deliverMutation.mutate({ orderId: deliverModal.id, signedGuide: signedGuideFile },
                                        { onSuccess: () => { setDeliverModal(null); setSignedGuideFile(null); } });
                                }}
                                disabled={deliverMutation.isPending}
                                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
                            >
                                <CheckCircle className="w-4 h-4" />
                                {deliverMutation.isPending ? 'Confirmando...' : isAdmin ? 'Confirmar y Subir Guía' : 'Recibí el Pedido'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ INVOICE MODAL ═══════════════════════════════ */}
            {invoiceModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg max-w-lg w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">Crear Factura en Siigo</h3>
                            <button onClick={() => setInvoiceModal(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-4">
                            <p className="text-sm text-teal-800">
                                <strong>Pedido:</strong> {invoiceModal.orderNumber}
                            </p>
                            <p className="text-sm text-teal-800">
                                <strong>Distribuidor:</strong> {invoiceModal.distributor?.name}
                            </p>
                            <p className="text-sm text-teal-700 mt-2">
                                📦 {invoiceModal.items?.length || 0} productos — 
                                {invoiceModal.items?.reduce((s, i) => s + (i.allocatedQty || i.requestedQty || 0), 0)} unidades
                            </p>
                        </div>

                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-5 text-xs text-gray-600 space-y-1">
                            {(() => {
                                const dist = invoiceModal.distributor || {};
                                const discountPct = parseFloat(dist.discountPercent) || 34.8;
                                const hasLiquimon = invoiceModal.items?.some(i => (i.product?.sku || '').toUpperCase().includes('LIQUIMON'));
                                const applyRete = dist.reteFuente === true; // opt-in: solo Persona Jurídica
                                const creditDays = 30; // Plazo fijo en Siigo (no configurable por distribuidor)
                                return (<>
                                    {hasLiquimon ? (
                                        <p>🏷️ <strong>Descuento:</strong> {discountPct}% <span className="text-red-500 text-xs font-semibold">(0% para LIQUIMON)</span></p>
                                    ) : (
                                        <p>🏷️ <strong>Descuento:</strong> {discountPct}%</p>
                                    )}
                                    <p>📋 <strong>Impuestos según producto:</strong></p>
                                    <ul className="ml-5 space-y-0.5 list-disc text-gray-500">
                                        <li>LIQUIPOPS → IVA 19% + Comestibles Ultraprocesados 20%</li>
                                        <li>SIROPES/GENIALITY → IVA 19% + Bebidas Azucaradas</li>
                                        <li>LIQUIMON/Otros → IVA 19%</li>
                                    </ul>
                                    {applyRete && <p>📊 <strong>Retención:</strong> ReteFuente 2.5%</p>}
                                    {!applyRete && <p className="text-orange-600">📊 <strong>Retención:</strong> Sin ReteFuente (Persona Natural)</p>}
                                    <p>💳 <strong>Forma de pago:</strong> Crédito ({creditDays} días)</p>
                                    <p>📄 <strong>Documento:</strong> Factura Electrónica (Según Configuración)</p>
                                </>);
                             })()}
                        </div>

                        <div className="flex justify-end gap-3">
                            <button onClick={() => setInvoiceModal(null)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
                            <button
                                onClick={() => invoiceMutation.mutate({ orderId: invoiceModal.id })}
                                disabled={invoiceMutation.isPending}
                                className="px-5 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-gray-400 font-medium"
                            >
                                {invoiceMutation.isPending ? 'Creando factura...' : '📄 Crear Factura en Siigo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ DISPATCH FORM MODAL ═══════════════════════════ */}
            {dispatchModal && (() => {
                // Weight + auto-amount calculation
                const getWeightGrams = (product) => {
                    const name = (product?.name || '').toUpperCase();
                    if (name.includes('SIROPE') || name.includes('GENIALITY')) {
                        if (name.includes('1000')) return 1300;
                        if (name.includes('360')) return 500;
                        return 1300;
                    }
                    if (name.includes('LIQUIMON')) {
                        if (name.includes('1000')) return 1000;
                        return 500;
                    }
                    const grMatch = name.match(/(\d+)\s*GR/);
                    if (grMatch) return parseInt(grMatch[1]);
                    return 350;
                };
                const totalKg = dispatchModal.items?.reduce((sum, item) => {
                    return sum + ((item.allocatedQty || 0) * getWeightGrams(item.product) / 1000);
                }, 0) || 0;
                const suggestedAmount = Math.round(totalKg * 550);

                return (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">🚛 Despachar Pedido</h3>
                            <button onClick={() => setDispatchModal(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        <p className="text-sm text-gray-600 mb-4">
                            Pedido: <span className="font-semibold">{dispatchModal.orderNumber}</span> —
                            Distribuidor: <span className="font-semibold">{dispatchModal.distributor?.name}</span>
                        </p>

                        <div className="space-y-3">
                            {/* Driver name with autocomplete */}
                            <div className="relative">
                                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del Conductor *</label>
                                <input
                                    type="text"
                                    value={dispatchForm.driverName}
                                    onChange={async (e) => {
                                        const val = e.target.value;
                                        setDispatchForm(prev => ({ ...prev, driverName: val }));
                                        if (val.length >= 2) {
                                            try {
                                                const res = await axios.get(`${API_URL}/drivers?q=${encodeURIComponent(val)}`, { headers: AUTH() });
                                                setDriverSuggestions(res.data.data || []);
                                                setShowDriverSuggestions(true);
                                            } catch {}
                                        } else {
                                            setShowDriverSuggestions(false);
                                        }
                                    }}
                                    onBlur={() => setTimeout(() => setShowDriverSuggestions(false), 180)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:border-indigo-400 outline-none"
                                    placeholder="Nombre completo"
                                    autoComplete="off"
                                />
                                {showDriverSuggestions && driverSuggestions.length > 0 && (
                                    <div className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg shadow-xl mt-1 max-h-48 overflow-y-auto">
                                        {driverSuggestions.map(d => (
                                            <button
                                                key={d.id}
                                                type="button"
                                                onMouseDown={() => {
                                                    setDispatchForm(prev => ({
                                                        ...prev,
                                                        driverName: d.name,
                                                        driverCedula: d.cedula || prev.driverCedula,
                                                        driverPhone: d.phone || prev.driverPhone,
                                                        licensePlate: d.licensePlate || prev.licensePlate,
                                                    }));
                                                    setShowDriverSuggestions(false);
                                                }}
                                                className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-gray-100 last:border-0"
                                            >
                                                <div className="font-medium text-sm text-gray-900">{d.name}</div>
                                                <div className="text-xs text-gray-500 flex gap-3">
                                                    {d.cedula && <span>CC: {d.cedula}</span>}
                                                    {d.phone && <span>📱 {d.phone}</span>}
                                                    {d.licensePlate && <span>🚛 {d.licensePlate}</span>}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Cedula + Phone */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Cédula</label>
                                    <input type="text" value={dispatchForm.driverCedula}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, driverCedula: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="1234567890" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">📱 Celular</label>
                                    <input type="tel" value={dispatchForm.driverPhone}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, driverPhone: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="300 000 0000" />
                                </div>
                            </div>

                            {/* Plate + Amount */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Placa del Vehículo *</label>
                                    <input type="text" value={dispatchForm.licensePlate}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, licensePlate: e.target.value.toUpperCase() }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm uppercase" placeholder="ABC-123" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Flete ($) <span className="text-gray-400 font-normal">≈ {totalKg.toFixed(1)} kg × $550</span>
                                    </label>
                                    <input
                                        type="number"
                                        value={dispatchForm.amountPaid !== '' ? dispatchForm.amountPaid : suggestedAmount}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, amountPaid: e.target.value }))}
                                        onFocus={() => { if (dispatchForm.amountPaid === '') setDispatchForm(prev => ({ ...prev, amountPaid: suggestedAmount })); }}
                                        className="w-full px-3 py-2 border border-indigo-300 rounded-md text-sm bg-indigo-50 font-semibold"
                                        placeholder={suggestedAmount.toString()}
                                    />
                                </div>
                            </div>

                            {/* Destination */}
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Destino *</label>
                                <input type="text" value={dispatchForm.destination}
                                    onChange={(e) => setDispatchForm(prev => ({ ...prev, destination: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Dirección de entrega" />
                            </div>

                            {/* City */}
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">🏙️ Ciudad Destino</label>
                                <input type="text" value={dispatchForm.destinationCity}
                                    onChange={(e) => setDispatchForm(prev => ({ ...prev, destinationCity: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Ej: Bogotá, Medellín..." />
                            </div>

                            {/* Receiver info */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">👤 Recibe (Nombre)</label>
                                    <input type="text" value={dispatchForm.receiverName}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, receiverName: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Nombre de quien recibe" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">📱 Tel. Contacto Destino</label>
                                    <input type="text" value={dispatchForm.receiverPhone}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, receiverPhone: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Celular contacto" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Fecha de Despacho</label>
                                    <input type="date" value={dispatchForm.dispatchDate || new Date().toISOString().split('T')[0]}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, dispatchDate: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Hora de Despacho</label>
                                    <input type="time" value={dispatchForm.dispatchTime || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, dispatchTime: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>

                            {/* Weight summary */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md text-sm">
                                <span className="text-gray-500">⚖️ Peso estimado:</span>
                                <span className="font-semibold text-gray-800">{totalKg.toFixed(1)} kg</span>
                                <span className="ml-auto text-xs text-gray-400">calculado automáticamente</span>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Notas de Despacho</label>
                                <textarea value={dispatchForm.dispatchNotes}
                                    onChange={(e) => setDispatchForm(prev => ({ ...prev, dispatchNotes: e.target.value }))}
                                    rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    placeholder="Observaciones adicionales..." />
                            </div>
                        </div>

                        <div className="bg-purple-50 rounded-lg p-3 mt-4 text-xs text-purple-700">
                            📋 Se generará automáticamente una <strong>Guía de Transporte</strong> con los datos ingresados.
                        </div>

                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setDispatchModal(null)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
                            <button
                                onClick={() => dispatchMutation.mutate({
                                    orderId: dispatchModal.id,
                                    ...dispatchForm,
                                    amountPaid: dispatchForm.amountPaid !== '' ? dispatchForm.amountPaid : suggestedAmount,
                                    driverPhone: dispatchForm.driverPhone,
                                })}
                                disabled={!dispatchForm.driverName || !dispatchForm.licensePlate || !dispatchForm.destination || dispatchMutation.isPending}
                                className="px-5 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 font-medium"
                            >
                                {dispatchMutation.isPending ? 'Despachando...' : '🚛 Confirmar Despacho'}
                            </button>
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* ════════════════ PICKING MODAL ════════════════════════════════════ */}
            {pickingOrder && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 pb-20 z-50">
                    <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[calc(100dvh-6rem)] flex flex-col shadow-2xl">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 rounded-t-2xl">
                            <div className="flex justify-between items-center text-white">
                                <div>
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <ScanLine className="w-6 h-6" />
                                        Separación: {pickingOrder.orderNumber}
                                    </h3>
                                    <p className="text-purple-200 text-sm mt-1">
                                        {pickingOrder.distributor?.name}
                                    </p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-center">
                                        <div className="text-3xl font-black">
                                            {pickingProgress?.pickingProgress || 0}%
                                        </div>
                                        <div className="w-32 h-3 bg-white/20 rounded-full overflow-hidden mt-1">
                                            <div className="h-full bg-white rounded-full transition-all duration-500"
                                                style={{ width: `${pickingProgress?.pickingProgress || 0}%` }}
                                            />
                                        </div>
                                    </div>
                                    <button onClick={() => { setPickingOrder(null); setPickingProgress(null); setSelectedItemId(null); setLastScan(null); }}
                                        className="text-white hover:text-purple-200 text-3xl">&times;</button>
                                </div>
                            </div>
                        </div>

                        {/* ── HIDDEN SCANNER INPUT (always captures barcode gun reads) ── */}
                        <input
                            ref={scannerInputRef}
                            type="text"
                            style={{ position: 'absolute', left: '-9999px', opacity: 0 }}
                            tabIndex={-1}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const val = e.target.value;
                                    e.target.value = '';
                                    handleScannerInput(val);
                                    // Re-focus after a tick
                                    setTimeout(() => scannerInputRef.current?.focus(), 50);
                                }
                            }}
                            autoComplete="off"
                        />

                        {/* ── LIVE SCAN FEED ── */}
                        <div className={`px-5 py-3 border-b transition-all duration-300 ${
                            lastScan?.status === 'success' ? 'bg-green-50 border-green-200' :
                            lastScan?.status === 'error'   ? 'bg-red-50 border-red-200' :
                            lastScan?.status === 'zone-warning' ? 'bg-amber-100 border-amber-400 border-2' :
                            lastScan?.status === 'warning' ? 'bg-orange-50 border-orange-300' :
                            lastScan?.status === 'scanning' ? 'bg-blue-50 border-blue-200' :
                            'bg-purple-50 border-purple-100'
                        }`}>
                            {lastScan ? (
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                                        lastScan.status === 'success' ? 'bg-green-500 animate-bounce' :
                                        lastScan.status === 'error'   ? 'bg-red-500' :
                                        lastScan.status === 'zone-warning' ? 'bg-amber-500 animate-pulse' :
                                        lastScan.status === 'warning' ? 'bg-orange-500' :
                                        'bg-blue-500 animate-pulse'
                                    }`}>
                                        {lastScan.status === 'success' ? '✓' : lastScan.status === 'error' ? '✗' : lastScan.status === 'zone-warning' ? '⚠' : lastScan.status === 'warning' ? '⚠' : '⟳'}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-sm font-bold ${
                                            lastScan.status === 'success' ? 'text-green-800' :
                                            lastScan.status === 'error'   ? 'text-red-800' :
                                            lastScan.status === 'zone-warning' ? 'text-amber-800' :
                                            lastScan.status === 'warning' ? 'text-orange-800' :
                                            'text-blue-800'
                                        }`}>
                                            {lastScan.status === 'success' ? '✅ Escaneado' :
                                             lastScan.status === 'error'   ? '❌ Error' :
                                             lastScan.status === 'zone-warning' ? '⚠️ Sin stock en Producto Terminado' :
                                             lastScan.status === 'warning' ? '⛔ Ya completo' :
                                             '🔄 Procesando...'}
                                        </p>
                                        <p className="text-xs text-gray-600">
                                            {lastScan.productName}
                                            {lastScan.lotNumber && <span className="ml-2 text-gray-400">Lote: {lastScan.lotNumber}</span>}
                                            {lastScan.message && <span className={`ml-2 ${
                                                lastScan.status === 'error'   ? 'text-red-500' :
                                                lastScan.status === 'zone-warning' ? 'text-amber-700 font-bold' :
                                                lastScan.status === 'warning' ? 'text-orange-600 font-medium' :
                                                'text-blue-500'
                                            }`}>{lastScan.message}</span>}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <ScanLine className="w-5 h-5 text-purple-600 animate-pulse" />
                                    <span className="text-sm text-purple-700">
                                        <strong>Listo para escanear</strong> — Apunta la pistola al QR de cada caja. No necesitas abrir cada item.
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* ── Manual input (global, not per-item) ── */}
                        <div className="px-5 py-2 bg-gray-50 border-b flex gap-2 items-center">
                            <span className="text-xs text-gray-500 whitespace-nowrap">Lote manual:</span>
                            <input
                                type="text"
                                data-scanner-ignore="true"
                                value={manualLot}
                                onChange={(e) => setManualLot(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && manualLot.trim()) {
                                        e.preventDefault();
                                        const val = manualLot.trim();
                                        // ── If it looks like a QR string, route to scanner parser instead ──
                                        if (val.includes('SKU:') || val.includes('LOT:') || val.includes('BAR:') || val.startsWith('{')) {
                                            setManualLot('');
                                            handleScannerInput(val);
                                            return;
                                        }
                                        const firstIncomplete = pickingProgress?.itemsProgress?.find(ip => !ip.completed);
                                        if (firstIncomplete) {
                                            const product = pickingOrder.items?.find(oi => oi.id === firstIncomplete.itemId)?.product;
                                            handleManualLot(firstIncomplete.itemId, product);
                                        }
                                    }
                                }}
                                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-purple-500 outline-none"
                                placeholder="Ingresa número de lote y presiona Enter..."
                            />
                        </div>

                        {/* ── UNIT PICK POPUP (barcode scan — with lot selection) ── */}
                        {unitPickPopup && (
                            <div className="mx-4 mt-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl shadow-lg animate-in">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">📦</div>
                                    <div className="flex-1">
                                        <p className="font-bold text-blue-900 text-sm">{unitPickPopup.product?.name}</p>
                                        <p className="text-xs text-blue-600">{unitPickPopup.product?.sku} — Selecciona lote y cantidad</p>
                                    </div>
                                    <button onClick={() => setUnitPickPopup(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                                </div>

                                {/* Lot selection: cards if available, fallback to text input */}
                                {unitPickPopup.availableLots && unitPickPopup.availableLots.length > 0 ? (
                                    <div className="mb-3">
                                        <label className="text-xs text-gray-600 font-medium mb-1 block">Lotes disponibles (Producto Terminado)</label>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                            {unitPickPopup.availableLots.map(lot => (
                                                <button
                                                    key={lot.id}
                                                    onClick={() => setUnitPickPopup(p => ({ ...p, lot: lot.lotNumber }))}
                                                    className={`w-full flex justify-between items-center px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                                                        unitPickPopup.lot === lot.lotNumber
                                                            ? 'border-blue-500 bg-blue-100 text-blue-900 font-bold'
                                                            : 'border-gray-200 bg-white hover:border-blue-300 text-gray-700'
                                                    }`}
                                                >
                                                    <span className="font-mono">{lot.lotNumber}</span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                                        lot.currentQuantity > 20 ? 'bg-green-100 text-green-700' :
                                                        lot.currentQuantity > 5 ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>{lot.currentQuantity} uds</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mb-3">
                                        <label className="text-xs text-gray-600 font-medium">Número de lote {unitPickPopup.availableLots === null ? '' : <span className="text-orange-500">(sin stock registrado)</span>}</label>
                                        <input
                                            type="text"
                                            data-scanner-ignore="true"
                                            value={unitPickPopup.lot}
                                            onChange={(e) => setUnitPickPopup(p => ({ ...p, lot: e.target.value }))}
                                            className="w-full mt-1 px-3 py-2 border-2 border-blue-300 rounded-lg text-sm focus:border-blue-500 outline-none"
                                            placeholder="Lote..."
                                            autoFocus
                                        />
                                    </div>
                                )}

                                <div className="flex gap-3 items-end">
                                    <div className="w-28">
                                        <label className="text-xs text-gray-600 font-medium">Unidades</label>
                                        <div className="flex items-center mt-1 border-2 border-blue-300 rounded-lg overflow-hidden">
                                            <button
                                                onClick={() => setUnitPickPopup(p => ({ ...p, qty: Math.max(1, p.qty - 1) }))}
                                                className="px-2 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold"
                                            >−</button>
                                            <input
                                                type="number"
                                                min="1"
                                                value={unitPickPopup.qty}
                                                data-scanner-ignore="true"
                                                onChange={(e) => setUnitPickPopup(p => ({ ...p, qty: Math.max(1, parseInt(e.target.value) || 1) }))}
                                                className="w-full text-center py-2 text-sm font-bold outline-none"
                                            />
                                            <button
                                                onClick={() => setUnitPickPopup(p => ({ ...p, qty: p.qty + 1 }))}
                                                className="px-2 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold"
                                            >+</button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!unitPickPopup.lot.trim()) { alert('Selecciona o ingresa un número de lote'); return; }
                                            const qrData = {
                                                productCode: unitPickPopup.product?.sku || '',
                                                barcode: unitPickPopup.product?.barcode || '',
                                                name: unitPickPopup.product?.name || '',
                                                lotNumber: unitPickPopup.lot.trim(),
                                                unitsPerBox: unitPickPopup.qty,
                                                expirationDate: new Date(Date.now() + 270 * 86400000).toISOString().split('T')[0]
                                            };
                                            setLastScan({ productName: unitPickPopup.product?.name, lotNumber: unitPickPopup.lot, status: 'scanning', timestamp: Date.now() });
                                            scanMutation.mutate({
                                                orderId: pickingOrder.id,
                                                orderItemId: unitPickPopup.itemId,
                                                qrData,
                                                scannedQty: unitPickPopup.qty
                                            });
                                            setUnitPickPopup(null);
                                        }}
                                        disabled={scanMutation.isPending || !unitPickPopup.lot.trim()}
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-bold text-sm whitespace-nowrap"
                                    >
                                        ✓ Registrar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── ITEMS LIST (flat, no expand needed) ── */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {pickingProgress?.itemsProgress
                                ?.slice()
                                .sort((a, b) => {
                                    const nameA = (a.productName || '').toUpperCase();
                                    const nameB = (b.productName || '').toUpperCase();
                                    // Brand: LIQUIPOPS=0, GENIALITY/SIROPE=1, others=2
                                    const brandOf = (n) => n.includes('LIQUIPOPS') || n.includes('LIQUIPOS') ? 0 : (n.includes('GENIALITY') || n.includes('SIROPE')) ? 1 : 2;
                                    const brandA = brandOf(nameA), brandB = brandOf(nameB);
                                    if (brandA !== brandB) return brandA - brandB;
                                    // Extract flavor (after "SABOR A " or "SABOR ")
                                    const flavorOf = (n) => {
                                        const m = n.match(/SABOR\s+(?:A\s+)?(.+?)(?:\s+X\s+\d|\s*$)/);
                                        return m ? m[1].trim() : n;
                                    };
                                    const flavorA = flavorOf(nameA), flavorB = flavorOf(nameB);
                                    if (flavorA !== flavorB) return flavorA.localeCompare(flavorB);
                                    // Size descending within same flavor
                                    const sizeOf = (n) => { const m = n.match(/\b(3400|1150|1000|500|360|350)\b/); return m ? parseInt(m[1]) : 0; };
                                    return sizeOf(nameB) - sizeOf(nameA);
                                })
                                .map((ip) => {
                                const orderItem = pickingOrder.items?.find(oi => oi.id === ip.itemId);
                                const product = orderItem?.product;
                                const dbPackSize = product?.packSize || 1;
                                // Everest (maquila) = cajas de 6, Normal = packSize del producto
                                const packSize = pickingOrder?.packingMode === 'EVEREST' ? 6 : dbPackSize;
                                const requestedUnits = ip.requestedQty;
                                const scannedUnits = ip.scannedQty;
                                const remainingUnits = requestedUnits - scannedUnits;
                                const requestedBoxes = packSize > 1 ? Math.ceil(requestedUnits / packSize) : null;
                                const scannedBoxes = packSize > 1 ? Math.floor(scannedUnits / packSize) : null;
                                const isLastScanned = lastScan?.productName === ip.productName;

                                return (
                                    <div key={ip.itemId} ref={el => { itemRefs.current[ip.itemId] = el; }} className="flex flex-col gap-0 border-2 rounded-xl transition-all duration-300" style={{ borderColor: ip.completed ? '#bcf0da' : '#f3f4f6' }}>
                                        <div
                                            onClick={() => setExpandItemId(expandItemId === ip.itemId ? null : ip.itemId)}
                                            className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-500 ${
                                                ip.completed
                                                    ? 'bg-green-50 opacity-100 hover:bg-green-100'
                                                    : isLastScanned
                                                        ? 'border-green-400 bg-green-50 shadow-lg shadow-green-100 scale-[1.01]'
                                                        : 'bg-white hover:bg-gray-50'
                                            }`}
                                        >
                                            {/* Status icon */}
                                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                                                ip.completed ? 'bg-green-500' :
                                                isLastScanned ? 'bg-green-500 animate-pulse' :
                                                'bg-gray-300'
                                            }`}>
                                                {ip.completed ? '✓' : scannedUnits > 0 ? scannedUnits : '·'}
                                            </div>

                                            {/* Product info — enhanced with size badge + fruit emoji */}
                                            {(() => {
                                                const name = ip.productName || '';
                                                const nameUpper = name.toUpperCase();
                                                // Extract size from product name
                                                const sizeMatch = nameUpper.match(/\b(3400|1150|1000|500|360|350)\b/);
                                                const sizeNum = sizeMatch ? sizeMatch[1] : null;
                                                // Size color coding
                                                const sizeStyles = {
                                                    '3400': { bg: 'bg-red-500', text: 'text-white', label: '3400g' },
                                                    '1150': { bg: 'bg-blue-500', text: 'text-white', label: '1150g' },
                                                    '1000': { bg: 'bg-purple-500', text: 'text-white', label: '1000ml' },
                                                    '500':  { bg: 'bg-teal-500', text: 'text-white', label: '500g' },
                                                    '360':  { bg: 'bg-orange-500', text: 'text-white', label: '360ml' },
                                                    '350':  { bg: 'bg-emerald-500', text: 'text-white', label: '350g' },
                                                };
                                                const sizeStyle = sizeNum ? sizeStyles[sizeNum] : null;
                                                // Flavor emoji mapping
                                                const flavorEmojis = {
                                                    'FRESA': '🍓', 'MANGO': '🥭', 'MARACUYA': '🍈', 'SANDIA': '🍉',
                                                    'BLUEBERRY': '🫐', 'CHAMOY': '🌶️', 'ICE PINK': '🩷',
                                                    'CHICLE': '🫧', 'CAFE': '☕', 'CAFÉ': '☕', 'LYCHE': '🌸',
                                                    'LYCHEE': '🌸', 'UVA': '🍇', 'LIMON': '🍋', 'LIMÓN': '🍋',
                                                    'NARANJA': '🍊', 'PIÑA': '🍍', 'COCO': '🥥', 'DURAZNO': '🍑',
                                                    'GUAYABA': '🍐', 'MORA': '🫐', 'TAMARINDO': '🌰',
                                                    'ESCARCHADOR': '❄️', 'LIQUIMON': '🍋',
                                                };
                                                let flavorEmoji = '';
                                                for (const [flavor, emoji] of Object.entries(flavorEmojis)) {
                                                    if (nameUpper.includes(flavor)) { flavorEmoji = emoji; break; }
                                                }
                                                return (
                                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                                        {/* Size badge — big and prominent */}
                                                        {sizeStyle && (
                                                            <div className={`${sizeStyle.bg} ${sizeStyle.text} px-2.5 py-1.5 rounded-xl font-black text-lg leading-none flex-shrink-0 shadow-sm min-w-[60px] text-center`}>
                                                                {sizeStyle.label}
                                                            </div>
                                                        )}
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-semibold text-gray-900 text-sm leading-snug flex items-start gap-1">
                                                                {flavorEmoji && <span className="text-lg flex-shrink-0">{flavorEmoji}</span>}
                                                                <span>{name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                                <span className="text-xs text-gray-400 font-mono">{product?.sku}</span>
                                                                {product?.barcode && (
                                                                    <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">📊 {product.barcode}</span>
                                                                )}
                                                                {(isAdmin || isLogistica) && orderItem?.productId && ptStockMap[orderItem.productId] !== undefined && (
                                                                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${
                                                                        ptStockMap[orderItem.productId] >= requestedUnits
                                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                            : ptStockMap[orderItem.productId] > 0
                                                                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                                : 'bg-red-50 text-red-700 border-red-200'
                                                                    }`} title="Stock en Producto Terminado">
                                                                        🏭 PT: {ptStockMap[orderItem.productId]} uds
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* Progress + remaining */}
                                            <div className="text-right flex-shrink-0">
                                                <div className="text-sm font-bold text-gray-900">
                                                    <span className={ip.completed ? 'text-green-600' : ''}>{scannedUnits}</span>
                                                    <span className="text-gray-400"> / {requestedUnits}</span>
                                                    <span className="text-xs text-gray-400 ml-1">uds</span>
                                                </div>
                                                {packSize > 1 && (
                                                    <div className="text-[10px] text-gray-400">({scannedBoxes}/{requestedBoxes} cajas)</div>
                                                )}
                                                {!ip.completed && remainingUnits > 0 && (
                                                    <div className="mt-0.5">
                                                        <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Faltan {remainingUnits}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Mini progress bar */}
                                            <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden flex-shrink-0 mx-2">
                                                <div className={`h-full rounded-full transition-all duration-500 ${ip.completed ? 'bg-green-500' : 'bg-purple-500'}`}
                                                    style={{ width: `${ip.progress}%` }}
                                                />
                                            </div>

                                            {/* Chevron Icon */}
                                            <div className="text-gray-400">
                                                {expandItemId === ip.itemId ? '▲' : '▼'}
                                            </div>
                                        </div>

                                        {/* EXPANDABLE DETAILS AREA */}
                                        {expandItemId === ip.itemId && (
                                            <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="text-xs font-bold text-gray-500 uppercase">Detalle de Separación</h4>
                                                </div>
                                                {ip.pickingItems?.length === 0 ? (
                                                    <div className="text-xs text-gray-400 italic">No se ha escaneado ninguna caja aún.</div>
                                                ) : (
                                                    <ul className="space-y-2">
                                                        {ip.pickingItems?.map((pi, pId) => (
                                                            <li key={pId} className="flex items-center justify-between text-xs bg-white p-2 rounded border border-gray-200 shadow-sm">
                                                                <div>
                                                                    <div className="font-bold text-indigo-700 font-mono tracking-tight">{pi.lotNumber}</div>
                                                                    <div className="text-gray-400 text-[10px]">{new Date(pi.scannedAt || Date.now()).toLocaleTimeString()} por {typeof pi.scannedBy === 'string' ? pi.scannedBy : (pi.scannedBy?.name || 'Usuario')}</div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-right">
                                                                        <div className="font-bold text-gray-800">{pi.scannedQty} uds</div>
                                                                        {pi.barcode && <div className="text-[10px] text-gray-400 font-mono">{pi.barcode}</div>}
                                                                    </div>
                                                                    {isAdmin && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (window.confirm(`¿Desmarcar lote ${pi.lotNumber} (${pi.scannedQty} uds)?`)) {
                                                                                    unscanMutation.mutate({ orderId: pickingOrder.id, pickingItemId: pi.id });
                                                                                }
                                                                            }}
                                                                            disabled={unscanMutation.isPending}
                                                                            className="ml-1 px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 text-[10px] font-bold whitespace-nowrap transition-colors"
                                                                            title="Desmarcar este escaneo (Admin)"
                                                                        >
                                                                            ✕ Desmarcar
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* ── INLINE COMPLETE BUTTON — always reachable on mobile ── */}
                            {pickingProgress?.itemsTotal > 0 && (
                                <div className="pt-3 pb-2 space-y-2">
                                    {/* Full completion — ADMIN + LOGISTICA when 100% */}
                                    {pickingProgress.itemsCompleted === pickingProgress.itemsTotal && (isAdmin || isLogistica) && (
                                        <button
                                            onClick={() => completePickingMutation.mutate({ orderId: pickingOrder.id })}
                                            disabled={completePickingMutation.isPending}
                                            className="w-full py-3.5 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:bg-gray-400 font-bold text-sm shadow-lg"
                                        >
                                            {completePickingMutation.isPending ? 'Completando...' : '✅ Completar Separación'}
                                        </button>
                                    )}
                                    {/* Partial completion — ADMIN ONLY */}
                                    {isAdmin && pickingProgress.itemsCompleted !== pickingProgress.itemsTotal && (pickingProgress.totalScanned || 0) > 0 && (
                                        <button
                                            onClick={() => setPartialConfirmModal(true)}
                                            disabled={completePickingMutation.isPending || completeWithBackorderMutation.isPending}
                                            className="w-full py-3.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:bg-gray-400 font-bold text-sm shadow-lg"
                                        >
                                            ⚠️ Completar Parcialmente ({pickingProgress.itemsCompleted}/{pickingProgress.itemsTotal} ítems)
                                        </button>
                                    )}
                                    {/* Backorder — ADMIN ONLY: complete + create new order for missing */}
                                    {isAdmin && pickingProgress.itemsCompleted !== pickingProgress.itemsTotal && (pickingProgress.totalScanned || 0) > 0 && (
                                        <button
                                            onClick={() => setBackorderConfirmModal(true)}
                                            disabled={completePickingMutation.isPending || completeWithBackorderMutation.isPending}
                                            className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 font-bold text-sm shadow-lg"
                                        >
                                            🔄 Completar + Reordenar Faltantes
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-white border-t p-4 flex justify-between items-center rounded-b-2xl">
                            <div className="text-sm text-gray-500">
                                {pickingProgress?.itemsCompleted || 0} de {pickingProgress?.itemsTotal || 0} items completados
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => loadPickingProgress(pickingOrder.id)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                                >
                                    🔄 Actualizar
                                </button>
                                {/* Partial completion — ADMIN ONLY */}
                                {isAdmin && (pickingProgress?.totalScanned || 0) > 0 &&
                                 (pickingProgress?.itemsCompleted < pickingProgress?.itemsTotal) && (
                                    <button
                                        onClick={() => setPartialConfirmModal(true)}
                                        disabled={completePickingMutation.isPending || completeWithBackorderMutation.isPending}
                                        className="px-5 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:bg-gray-400 font-bold text-sm"
                                    >
                                        ⚠️ Parcial
                                    </button>
                                )}
                                {/* Backorder — ADMIN ONLY */}
                                {isAdmin && (pickingProgress?.totalScanned || 0) > 0 &&
                                 (pickingProgress?.itemsCompleted < pickingProgress?.itemsTotal) && (
                                    <button
                                        onClick={() => setBackorderConfirmModal(true)}
                                        disabled={completePickingMutation.isPending || completeWithBackorderMutation.isPending}
                                        className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 font-bold text-sm"
                                    >
                                        🔄 + Reordenar
                                    </button>
                                )}
                                {/* Full completion — ADMIN + LOGISTICA when 100% */}
                                {(isAdmin || isLogistica) && (
                                <button
                                    onClick={() => completePickingMutation.mutate({ orderId: pickingOrder.id })}
                                    disabled={pickingProgress?.itemsCompleted !== pickingProgress?.itemsTotal || completePickingMutation.isPending}
                                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-bold"
                                >
                                    {completePickingMutation.isPending ? 'Completando...' : '✅ Completar Separación'}
                                </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ BACKORDER CONFIRM MODAL ════════════════ */}
            {backorderConfirmModal && pickingOrder && pickingProgress && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[70]">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">🔄</div>
                                <div>
                                    <h3 className="text-lg font-bold">Completar + Crear Nuevo Pedido</h3>
                                    <p className="text-sm text-white/80">Pedido {pickingOrder.orderNumber} — {pickingOrder.distributor?.name}</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-5 max-h-[55vh] overflow-y-auto">
                            <p className="text-sm text-gray-600 mb-4">
                                Lo escaneado pasará a <strong>Listo</strong> y se <strong>creará automáticamente un nuevo pedido</strong> con los faltantes que entrará directo a alistamiento.
                            </p>

                            {/* Items that WILL be invoiced */}
                            <div className="mb-4">
                                <p className="text-sm font-bold text-green-700 mb-2">
                                    ✅ Pasará a Listos ({pickingProgress.itemsProgress?.filter(i => i.scannedQty > 0).length || 0} productos)
                                </p>
                                <div className="space-y-1">
                                    {pickingProgress.itemsProgress?.filter(i => i.scannedQty > 0).map((ip, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-3 py-2 bg-green-50 rounded-lg border border-green-100 text-xs">
                                            <span className="font-medium text-green-900 flex-1">{ip.productName}</span>
                                            <span className="text-green-700 font-bold ml-2">{ip.scannedQty} uds</span>
                                            {ip.scannedQty < ip.requestedQty && (
                                                <span className="ml-2 text-amber-600 text-[10px]">(pedido: {ip.requestedQty})</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Items for the new backorder */}
                            <div>
                                <p className="text-sm font-bold text-blue-700 mb-2">
                                    📦 Nuevo pedido automático ({pickingProgress.itemsProgress?.filter(i => i.requestedQty - i.scannedQty > 0).length} productos)
                                </p>
                                <div className="space-y-1">
                                    {pickingProgress.itemsProgress?.filter(i => i.requestedQty - i.scannedQty > 0).map((ip, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-3 py-2 bg-blue-50 rounded-lg border border-blue-100 text-xs">
                                            <span className="font-medium text-blue-900 flex-1">{ip.productName}</span>
                                            <span className="text-blue-700 font-bold ml-2">{ip.requestedQty - ip.scannedQty} uds</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-400 mt-2 italic">
                                    El nuevo pedido entrará como <strong>Aprobado</strong> y pasará directo a la cola de alistamiento.
                                </p>
                            </div>
                        </div>

                        <div className="border-t px-5 py-4 bg-gray-50 flex justify-end gap-3">
                            <button
                                onClick={() => setBackorderConfirmModal(false)}
                                className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-100"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => completeWithBackorderMutation.mutate({ orderId: pickingOrder.id })}
                                disabled={completeWithBackorderMutation.isPending}
                                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 shadow-md"
                            >
                                {completeWithBackorderMutation.isPending ? 'Procesando...' : `✅ Confirmar Listo + Crear Nuevo Pedido`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ PARTIAL PICKING CONFIRM MODAL ════════════════ */}
            {partialConfirmModal && pickingOrder && pickingProgress && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[70]">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">⚠️</div>
                                <div>
                                    <h3 className="text-lg font-bold">Completar Parcialmente</h3>
                                    <p className="text-sm text-white/80">Pedido {pickingOrder.orderNumber}</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-5 max-h-[55vh] overflow-y-auto">
                            <p className="text-sm text-gray-600 mb-4">
                                Solo pasará a Listos lo que fue escaneado. Los ítems faltantes <strong>no quedarán en este pedido</strong>.
                            </p>

                            {/* Items that WILL be invoiced */}
                            <div className="mb-4">
                                <p className="text-sm font-bold text-green-700 mb-2">
                                    ✅ Pasará a Listos ({pickingProgress.itemsProgress?.filter(i => i.scannedQty > 0).length || 0} productos)
                                </p>
                                <div className="space-y-1">
                                    {pickingProgress.itemsProgress?.filter(i => i.scannedQty > 0).map((ip, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-3 py-2 bg-green-50 rounded-lg border border-green-100 text-xs">
                                            <span className="font-medium text-green-900 flex-1">{ip.productName}</span>
                                            <span className="text-green-700 font-bold ml-2">{ip.scannedQty} uds</span>
                                            {ip.scannedQty < ip.requestedQty && (
                                                <span className="ml-2 text-amber-600 text-[10px]">(pedido: {ip.requestedQty})</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Items that will NOT be invoiced */}
                            {pickingProgress.itemsProgress?.some(i => i.scannedQty <= 0) && (
                                <div>
                                    <p className="text-sm font-bold text-red-700 mb-2">
                                        ❌ No se incluirá ({pickingProgress.itemsProgress?.filter(i => i.scannedQty <= 0).length} productos sin escanear)
                                    </p>
                                    <div className="space-y-1">
                                        {pickingProgress.itemsProgress?.filter(i => i.scannedQty <= 0).map((ip, idx) => (
                                            <div key={idx} className="flex justify-between items-center px-3 py-2 bg-red-50 rounded-lg border border-red-100 text-xs">
                                                <span className="font-medium text-red-900 flex-1">{ip.productName}</span>
                                                <span className="text-red-600">{ip.requestedQty} uds</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="border-t px-5 py-4 bg-gray-50 flex justify-end gap-3">
                            <button
                                onClick={() => setPartialConfirmModal(false)}
                                className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-100"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => completePickingMutation.mutate({ orderId: pickingOrder.id, partial: true })}
                                disabled={completePickingMutation.isPending}
                                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 shadow-md"
                            >
                                {completePickingMutation.isPending ? 'Procesando...' : `✅ Confirmar Listo ${pickingProgress.itemsProgress?.filter(i => i.scannedQty > 0).length || 0} Productos`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ CONFIRM SKIP INSUFFICIENT MODAL ════════════════ */}

            {confirmSkipModal && selectedOrder && (() => {
                const zeroStock = selectedOrder.items?.filter(i => (i.product?.currentStock || 0) === 0) || [];
                const partial = selectedOrder.items?.filter(i => {
                    const s = i.product?.currentStock || 0;
                    return s > 0 && s < i.requestedQty;
                }) || [];
                const full = selectedOrder.items?.filter(i => (i.product?.currentStock || 0) >= i.requestedQty) || [];
                const totalAllocated = [...partial, ...full].reduce((sum, i) => {
                    return sum + Math.min(i.product?.currentStock || 0, i.requestedQty);
                }, 0);
                const includedCount = partial.length + full.length;
                return (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                        <span className="text-xl">✂️</span>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold">Aprobar con lo disponible</h3>
                                        <p className="text-sm text-white/80">Pedido {selectedOrder.orderNumber}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 max-h-[55vh] overflow-y-auto space-y-4">
                                {/* Partial stock items — included with reduced qty */}
                                {partial.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                            <p className="text-sm font-bold text-amber-700">Se despachan parcialmente ({partial.length})</p>
                                        </div>
                                        <div className="space-y-1">
                                            {partial.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center px-3 py-2 bg-amber-50 rounded-lg border border-amber-100">
                                                    <span className="text-xs font-medium text-amber-900 flex-1">{item.product?.name}</span>
                                                    <div className="flex gap-3 text-xs">
                                                        <span className="text-gray-400 line-through">Pedido: {item.requestedQty}</span>
                                                        <span className="text-amber-700 font-bold">→ Se envían: {item.product?.currentStock || 0}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Full stock items — included completely */}
                                {full.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                            <p className="text-sm font-bold text-green-700">Stock completo ({full.length})</p>
                                        </div>
                                        <div className="space-y-1">
                                            {full.slice(0, 5).map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center px-3 py-2 bg-green-50 rounded-lg border border-green-100">
                                                    <span className="text-xs font-medium text-green-900 flex-1">{item.product?.name}</span>
                                                    <span className="text-xs text-green-600">Cant: <b>{item.requestedQty}</b></span>
                                                </div>
                                            ))}
                                            {full.length > 5 && <p className="text-xs text-gray-500 pl-3">... y {full.length - 5} más</p>}
                                        </div>
                                    </div>
                                )}

                                {/* Zero stock items — dropped */}
                                {zeroStock.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                            <p className="text-sm font-bold text-red-700">Sin stock — se omiten ({zeroStock.length})</p>
                                        </div>
                                        <div className="space-y-1">
                                            {zeroStock.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                                                    <span className="text-xs font-medium text-red-900 flex-1">{item.product?.name}</span>
                                                    <span className="text-xs text-red-500">Stock: 0</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="border-t px-5 py-4 bg-gray-50 flex justify-end gap-3">
                                <button
                                    onClick={() => setConfirmSkipModal(false)}
                                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => {
                                        setConfirmSkipModal(false);
                                        approveMutation.mutate({ orderId: selectedOrder.id, skipInsufficient: true });
                                    }}
                                    disabled={approveMutation.isPending}
                                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 transition shadow-md"
                                >
                                    {approveMutation.isPending ? 'Aprobando...' : `✅ Despachar ${totalAllocated} uds de ${includedCount} referencias`}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ════════════════ SCANNER ORDER MODAL ════════════════════════ */}
            {scannerModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg md:max-w-4xl lg:max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden transition-all">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <ScanLine className="w-6 h-6 text-indigo-600" /> Nuevo Pedido por Escáner
                            </h3>
                            <button onClick={() => setScannerModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>
                        
                        <div className="flex flex-col md:flex-row lg:flex-col flex-1 overflow-hidden">
                            {/* Panel Izquierdo: Configuración y Scanner */}
                            <div className="p-6 overflow-y-auto md:w-5/12 lg:w-full border-b md:border-b-0 md:border-r lg:border-r-0 lg:border-b border-gray-100 bg-gray-50/30 flex flex-col gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Distribuidor</label>
                                    <select 
                                        data-scanner-ignore="true"
                                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 font-medium shadow-sm transition-all"
                                        value={scannerDistributor}
                                        onChange={e => {
                                            setScannerDistributor(e.target.value);
                                            e.target.blur();
                                            setTimeout(() => orderScannerInputRef.current?.focus(), 100);
                                        }}
                                    >
                                        <option value="">-- Seleccionar Distribuidor --</option>
                                        {distributors.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                                
                                {scannerDistributor && (
                                    <div className="flex flex-col items-center text-center gap-3 p-6 bg-indigo-50 border border-indigo-100 rounded-2xl shadow-inner mt-auto md:mt-0">
                                        <div className="relative flex h-10 w-10">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-10 w-10 bg-indigo-500 flex items-center justify-center">
                                                <ScanLine className="w-5 h-5 text-white" />
                                            </span>
                                        </div>
                                        <div>
                                            <p className="text-lg font-extrabold text-indigo-900">ESCÁNER ACTIVO</p>
                                            <p className="text-sm font-medium text-indigo-700 mt-2 leading-relaxed">Dispara con tu pistola láser. No necesitas hacer click. Tolera unidades sueltas directamente.</p>
                                        </div>

                                        {/* ── HIDDEN SCANNER INPUT ── */}
                                        <input
                                            ref={orderScannerInputRef}
                                            type="text"
                                            style={{ position: 'absolute', left: '-9999px', opacity: 0 }}
                                            tabIndex={-1}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const rawValue = e.target.value.trim();
                                                    e.target.value = '';
                                                    if (!rawValue) return;
                                                    
                                                    const scan = parseScanInput(rawValue);
                                                    const prod = catalogProducts.find(p => 
                                                        (scan.barcode && p.barcode === scan.barcode) || 
                                                        (scan.sku && p.sku === scan.sku) || 
                                                        p.barcode === rawValue || 
                                                        p.sku === rawValue
                                                    );

                                                    if (!prod) {
                                                        playError();
                                                        alert(`Producto no encontrado con el código: ${rawValue}`);
                                                        return;
                                                    }
                                                    
                                                    const qtyToAdd = scan.unitsPerBox || 1;
                                                    playSuccess();
                                                    setScannerItems(prev => {
                                                        const existing = prev.find(i => i.productId === prod.id);
                                                        if (existing) {
                                                            return prev.map(i => i.productId === prod.id ? { ...i, quantity: i.quantity + qtyToAdd } : i);
                                                        }
                                                        return [...prev, { productId: prod.id, name: prod.name, sku: prod.sku, packSize: prod.packSize, quantity: qtyToAdd }];
                                                    });
                                                }
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Panel Derecho: Carrito de Escaneo */}
                            <div className="p-6 overflow-y-auto flex-1 bg-white flex flex-col">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                        <ShoppingCart className="w-5 h-5 text-gray-500" /> Carrito de Venta
                                    </h4>
                                    <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-3 py-1 rounded-full">
                                        {scannerItems.reduce((acc, i) => acc + i.quantity, 0)} uds
                                    </span>
                                </div>

                                {scannerItems.length > 0 ? (
                                    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm flex-1 overflow-y-auto max-h-[50vh] md:max-h-full">
                                        <table className="w-full text-left bg-white text-sm">
                                            <thead className="bg-gray-50 text-gray-500 sticky top-0">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">Producto</th>
                                                    <th className="px-4 py-3 font-semibold text-center w-24">Cant.</th>
                                                    <th className="px-4 py-3 font-semibold text-right w-16">Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {scannerItems.map((item) => (
                                                    <tr key={item.productId} className="hover:bg-slate-50">
                                                        <td className="px-4 py-3 font-medium text-gray-900">
                                                            {item.name}
                                                            <div className="text-xs text-gray-500 mt-0.5">Caja por {item.packSize || 1} uds</div>
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => setScannerItems(prev => prev.map(i => i.productId === item.productId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i))}
                                                                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center justify-center font-bold"
                                                                >-</button>
                                                                <span className="font-bold text-gray-800 w-6">{item.quantity}</span>
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => setScannerItems(prev => prev.map(i => i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i))}
                                                                    className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 flex items-center justify-center font-bold"
                                                                >+</button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button 
                                                                onClick={() => setScannerItems(prev => prev.filter(i => i.productId !== item.productId))}
                                                                className="text-red-400 hover:text-red-600 focus:outline-none p-1 rounded-md hover:bg-red-50"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 h-full min-h-[30vh]">
                                        <div className="w-20 h-20 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
                                            <Barcode className="w-10 h-10 text-gray-300" />
                                        </div>
                                        <p className="font-bold text-gray-500 text-lg">Esperando escaneo...</p>
                                        <p className="text-gray-400 text-sm mt-1">Selecciona el distribuidor y dispara tu lector de códigos.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
                            <span className="text-sm text-gray-500 font-medium">Total: {scannerItems.reduce((s,i)=>s+i.quantity,0)} uds</span>
                            <button
                                disabled={scannerItems.length === 0 || !scannerDistributor || scannerLoading}
                                onClick={async () => {
                                    setScannerLoading(true);
                                    try {
                                        const payload = {
                                            distributorId: scannerDistributor,
                                            allowLooseUnits: true,
                                            notes: '🤖 Generado vía Pedido Rápido (Scanner) por Administrador',
                                            items: scannerItems.map((i, sortOrder) => ({
                                                productId: i.productId,
                                                quantity: i.quantity,
                                                sortOrder
                                            }))
                                        };
                                        const res = await axios.post(`${API_URL}/orders`, payload, { headers: AUTH() });
                                        setScannerModal(false);
                                        queryClient.invalidateQueries(['admin-orders']);
                                        queryClient.invalidateQueries(['order-counts']);
                                        alert('✅ Pedido creado exitosamente desde escáner.');
                                    } catch (err) {
                                        alert(err.response?.data?.error || 'Error al crear pedido');
                                    } finally {
                                        setScannerLoading(false);
                                    }
                                }}
                                className={`px-6 py-3 rounded-xl font-bold text-white transition-all ${
                                    scannerItems.length === 0 || !scannerDistributor || scannerLoading
                                    ? 'bg-gray-300 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200'
                                }`}
                            >
                                {scannerLoading ? 'Generando...' : '✅ Confirmar Pedido Rápido'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ EXCEL UPLOAD MODAL ════════════════════════ */}
            {excelModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">📤 Cargar Pedido desde Excel</h3>
                            <button onClick={() => setExcelModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        {/* Step 1: Select distributor (only for admin/comercial) */}
                        {!isDistributor && (
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Distribuidor</label>
                            <select
                                value={excelDistributor}
                                onChange={e => setExcelDistributor(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm"
                            >
                                <option value="">Seleccionar distribuidor...</option>
                                {distributors.map(d => (
                                    <option key={d.id} value={d.id}>{d.name} ({d.email})</option>
                                ))}
                            </select>
                        </div>
                        )}

                        {/* Step 2: File upload */}
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Archivo Excel (.xlsx)</label>
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={e => { setExcelFile(e.target.files[0]); setExcelPreview(null); }}
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-semibold"
                            />
                        </div>

                        {/* Template Example + Download */}
                        <div className="mb-4 border-2 border-dashed border-emerald-200 rounded-xl p-4 bg-emerald-50/50">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                                    📋 El archivo debe seguir esta plantilla:
                                </span>
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800 transition"
                                    onClick={async () => {
                                        try {
                                            const res = await axios.get(`${API_URL}/orders/template`, {
                                                headers: AUTH(),
                                                responseType: 'blob'
                                            });
                                            // Verify we got an actual Excel file, not an error JSON
                                            if (res.data.type && res.data.type.includes('json')) {
                                                const text = await res.data.text();
                                                const err = JSON.parse(text);
                                                alert(err.error || 'Error generando plantilla');
                                                return;
                                            }
                                            const url = window.URL.createObjectURL(res.data);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            // Use filename from backend header, fallback to OC_date
                                            const disposition = res.headers['content-disposition'] || '';
                                            const match = disposition.match(/filename="?(.+?)"?$/);
                                            const today = new Date().toISOString().slice(0, 10);
                                            a.download = match ? match[1] : `OC_${today}.xlsx`;
                                            a.click();
                                            window.URL.revokeObjectURL(url);
                                        } catch(err) {
                                            console.error('Template download error:', err);
                                            alert('Error descargando plantilla: ' + (err.response?.data?.error || err.message));
                                        }
                                    }}
                                >
                                    ⬇️ Descargar Plantilla
                                </button>
                            </div>

                            {/* Visual example table */}
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-bold text-orange-600">Col A: Barras</th>
                                            <th className="text-left px-3 py-2 font-bold text-gray-600">Col B: Producto</th>
                                            <th className="text-center px-3 py-2 font-bold text-emerald-700">Col C: Cantidades a Solicitar ✏️</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-t">
                                            <td className="px-3 py-2 font-mono text-orange-700">7709998045011</td>
                                            <td className="px-3 py-2 text-gray-800">LIQUIPOPS SABOR A MARACUYÁ</td>
                                            <td className="px-3 py-2 text-center font-bold text-emerald-700 bg-emerald-50">48</td>
                                        </tr>
                                        <tr className="border-t">
                                            <td className="px-3 py-2 font-mono text-orange-700">7709998045028</td>
                                            <td className="px-3 py-2 text-gray-800">LIQUIPOPS SABOR A MANGO</td>
                                            <td className="px-3 py-2 text-center font-bold text-emerald-700 bg-emerald-50">60</td>
                                        </tr>
                                        <tr className="border-t bg-gray-50">
                                            <td className="px-3 py-2 font-mono text-orange-700">7709998045035</td>
                                            <td className="px-3 py-2 text-gray-800">LIQUIPOPS SABOR A SANDÍA</td>
                                            <td className="px-3 py-2 text-center text-gray-400 italic">vacío = no pide</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                <span>🟠 <strong>Col A</strong> = código de barras (NO modificar)</span>
                                <span>🟢 <strong>Col C</strong> = cantidades a solicitar en <strong>unidades</strong> (lo único que debes llenar)</span>
                                <span>📦 Si quieres 3 cajas de x20, escribe <strong>60</strong></span>
                            </div>
                        </div>

                        {/* Preview button */}
                        {excelFile && excelDistributor && !excelPreview && (
                            <button
                                onClick={async () => {
                                    setExcelLoading(true);
                                    try {
                                        const fd = new FormData();
                                        fd.append('file', excelFile);
                                        fd.append('distributorId', excelDistributor);
                                        const res = await axios.post(`${API_URL}/orders/upload-excel?preview=1`, fd, { headers: AUTH() });
                                        setExcelPreview(res.data);
                                    } catch(e) {
                                        const errData = e.response?.data;
                                        let msg = errData?.error || 'Error al procesar Excel';
                                        if (errData?.warnings?.length) msg += '\n\nAdvertencias:\n' + errData.warnings.join('\n');
                                        if (errData?.debug) msg += '\n\nDebug:\n' + JSON.stringify(errData.debug, null, 2);
                                        alert(msg);
                                    } finally { setExcelLoading(false); }
                                }}
                                disabled={excelLoading}
                                className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:bg-gray-400"
                            >
                                {excelLoading ? 'Procesando...' : '🔍 Vista Previa'}
                            </button>
                        )}

                        {/* Preview table */}
                        {excelPreview && (
                            <>
                                {excelPreview.warnings?.length > 0 && (
                                    <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                        <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Advertencias:</p>
                                        {excelPreview.warnings.map((w, i) => (
                                            <p key={i} className="text-xs text-amber-700">{w}</p>
                                        ))}
                                    </div>
                                )}

                                <div className="border rounded-lg overflow-hidden mb-4">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="text-left px-3 py-2 font-medium">Producto</th>
                                                <th className="text-center px-3 py-2 font-medium">Cantidad</th>
                                                <th className="text-center px-3 py-2 font-medium">Cajas</th>
                                                <th className="text-center px-3 py-2 font-medium">Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {excelPreview.items?.map((item, idx) => {
                                                const boxes = Math.ceil(item.quantity / (item.packSize || 1));
                                                const sufficient = item.currentStock >= item.quantity;
                                                return (
                                                    <tr key={idx} className={`border-t ${!sufficient ? 'bg-amber-50' : ''}`}>
                                                        <td className="px-3 py-2 font-medium text-gray-900 text-xs">{item.name}</td>
                                                        <td className="px-3 py-2 text-center font-bold">{item.quantity}</td>
                                                        <td className="px-3 py-2 text-center text-gray-600">{boxes}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className={`font-semibold ${sufficient ? 'text-green-700' : 'text-amber-600'}`}>
                                                                {item.currentStock}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
                                    <p className="text-sm text-emerald-800 font-semibold">
                                        ✅ {excelPreview.items?.length} productos • {excelPreview.items?.reduce((s, i) => s + Math.ceil(i.quantity / (i.packSize || 1)), 0)} cajas total
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setExcelPreview(null)}
                                        className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                                    >
                                        ← Cambiar archivo
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setExcelLoading(true);
                                            try {
                                                const fd = new FormData();
                                                fd.append('file', excelFile);
                                                fd.append('distributorId', excelDistributor);
                                                const res = await axios.post(`${API_URL}/orders/upload-excel`, fd, { headers: AUTH() });
                                                if (res.data.success) {
                                                    setExcelModal(false);
                                                    setStatusFilter('PENDING');
                                                    queryClient.invalidateQueries(['admin-orders']);
                                                    queryClient.invalidateQueries(['order-counts']);
                                                    alert(`✅ Pedido ${res.data.data.orderNumber} creado con ${res.data.data.items?.length} productos`);
                                                }
                                            } catch(e) {
                                                alert(e.response?.data?.error || 'Error al crear pedido');
                                            } finally { setExcelLoading(false); }
                                        }}
                                        disabled={excelLoading}
                                        className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold disabled:bg-gray-400"
                                    >
                                        {excelLoading ? 'Creando...' : '✅ Crear Pedido'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>

        {/* ── Packing Mode Selection Modal ──────────────────────────── */}
        {packingModeModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
                style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
            >
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                    style={{ animation: 'slideUpFadeIn 0.22s ease-out' }}
                >
                    {/* Header */}
                    <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-5">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">📦</div>
                            <div>
                                <h3 className="text-white font-bold text-lg leading-tight">Tipo de empaque</h3>
                                <p className="text-purple-200 text-xs mt-0.5">{packingModeModal.order?.orderNumber}</p>
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="px-5 pt-5 pb-4">
                        <p className="text-sm text-gray-500 mb-4 text-center">¿Cómo se empacan los productos de este pedido?</p>
                        <div className="flex flex-col gap-3">
                            {/* NORMAL option */}
                            <button
                                onClick={() => handleSelectPackingMode('NORMAL')}
                                className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition-all duration-150 text-left"
                            >
                                <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gray-100 group-hover:bg-violet-100 flex items-center justify-center text-2xl transition-colors">
                                    🛍️
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-gray-900 text-sm">Empaque Normal</p>
                                    <p className="text-xs text-gray-500 mt-0.5">4, 12 ó 40 unidades según el producto</p>
                                </div>
                                <div className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-300 group-hover:border-violet-500 transition-colors" />
                            </button>

                            {/* EVEREST option */}
                            <button
                                onClick={() => handleSelectPackingMode('EVEREST')}
                                className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-all duration-150 text-left"
                            >
                                <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gray-100 group-hover:bg-amber-100 flex items-center justify-center text-2xl transition-colors">
                                    🏔️
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-gray-900 text-sm">Empaque EVEREST</p>
                                    <p className="text-xs text-gray-500 mt-0.5">Maquila — cajas de 6 unidades fijas</p>
                                </div>
                                <div className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-300 group-hover:border-amber-500 transition-colors" />
                            </button>
                        </div>

                        <p className="text-center text-xs text-gray-400 mt-4">
                            Esta selección afecta el conteo de cajas para este pedido
                        </p>
                    </div>
                </div>
                <style>{`@keyframes slideUpFadeIn { from { opacity:0; transform:translateY(16px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
            </div>
        )}
        {/* ── Pending Summary Modal ──────────────────────────── */}
        {pendingSummaryModal && (() => {
            const ordersList = pendingSummary?.data || [];
            const distributorOptions = Array.from(new Set(
                ordersList.map(order => order.distributor?.name || 'Venta Directa')
            )).sort((a, b) => a.localeCompare(b, 'es'));
            const filteredOrdersList = pendingDistributorFilter === 'ALL'
                ? ordersList
                : ordersList.filter(order => (order.distributor?.name || 'Venta Directa') === pendingDistributorFilter);
            const { matrix, matrixDetails, orderTotals } = buildPendingMatrix(filteredOrdersList);
            const totalOrders = orderTotals.length;
            const totalUnits = orderTotals.reduce((sum, o) => sum + o.total, 0);
            const totalBoxesEq = orderTotals.reduce((sum, o) => sum + (o.boxesEq || 0), 0);

            const renderMatrixTable = (brand, data) => {
                const detailData = matrixDetails?.[brand] || {};
                const presentations = Object.keys(data || {}).sort((a, b) => {
                    const num = (v) => parseFloat(v) || 0;
                    return num(b) - num(a);
                });
                const flavorSet = new Set();
                presentations.forEach(p => Object.keys(data[p] || {}).forEach(f => flavorSet.add(f)));
                const flavors = Array.from(flavorSet).sort();

                if (presentations.length === 0 || flavors.length === 0) return null;

                return (
                    <div className="mb-4 border rounded-xl overflow-x-auto bg-white">
                        <div className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-700">{brand}</div>
                        <table className="min-w-full text-xs border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-2 border-b bg-white text-left font-bold text-gray-500 w-20">PRES</th>
                                    {flavors.map(flavor => (
                                        <th key={flavor} className="p-2 border-b bg-white font-bold text-gray-600 min-w-[70px] text-center">
                                            {flavor}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {presentations.map(p => (
                                    <tr key={p} className="hover:bg-gray-50">
                                        <td className="p-2 border-b font-bold text-gray-700 bg-gray-50/50 whitespace-nowrap">{p}</td>
                                        {flavors.map(flavor => {
                                            const val = data[p]?.[flavor] || 0;
                                            const details = detailData?.[p]?.[flavor] || [];
                                            const orderCount = details.length;
                                            return (
                                                <td key={`${p}-${flavor}`} className="p-2 border-b text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (val <= 0) return;
                                                            setPendingCellDetail({ brand, presentation: p, flavor });
                                                        }}
                                                        className={`inline-flex flex-col items-center min-w-[50px] rounded-md border px-2 py-1 ${
                                                            val > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-100'
                                                        }`}
                                                        title={orderCount > 0 ? 'Ver detalle por pedido' : ''}
                                                    >
                                                        <span className="font-semibold">{val}</span>
                                                        {orderCount > 0 && (
                                                            <span className="text-[10px] text-emerald-700">{orderCount} ord</span>
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            };

            const detailList = pendingCellDetail
                ? (matrixDetails?.[pendingCellDetail.brand]?.[pendingCellDetail.presentation]?.[pendingCellDetail.flavor] || [])
                : [];
            const detailUnits = detailList.reduce((sum, row) => sum + (row.qty || 0), 0);
            const detailBoxesEq = detailList.reduce((sum, row) => sum + (row.boxCount || 0), 0);
            const detailUnitsPerBox = detailList[0]?.unitsPerBox || 1;

            return (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-hidden">
                        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
                            <div>
                                <div className="text-lg font-bold">Consolidado de Pedidos por Entregar</div>
                                <div className="text-xs text-slate-300">
                                    {pendingDistributorFilter === 'ALL'
                                        ? 'Incluye pedidos no entregados de todos los distribuidores'
                                        : `Incluye pedidos no entregados de ${pendingDistributorFilter}`}
                                </div>
                            </div>
                            <button onClick={() => { setPendingSummaryModal(false); setPendingCellDetail(null); }} className="text-white text-2xl">&times;</button>
                        </div>

                        <div className="p-5 overflow-y-auto max-h-[calc(90vh-120px)]">
                            {pendingSummaryLoading ? (
                                <div className="text-sm text-gray-500">Cargando consolidado...</div>
                            ) : (
                                <>
                                    <div className="mb-4 rounded-xl border bg-white p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-gray-800">Distribuidor</div>
                                                <div className="text-xs text-gray-500">Los calculos del consolidado se recalculan sobre el distribuidor seleccionado.</div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => { setPendingDistributorFilter('ALL'); setPendingCellDetail(null); }}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                                                        pendingDistributorFilter === 'ALL'
                                                            ? 'bg-slate-800 text-white border-slate-800'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    Todos
                                                </button>
                                                {distributorOptions.map(distributor => (
                                                    <button
                                                        key={distributor}
                                                        type="button"
                                                        onClick={() => { setPendingDistributorFilter(distributor); setPendingCellDetail(null); }}
                                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                                                            pendingDistributorFilter === distributor
                                                                ? 'bg-emerald-600 text-white border-emerald-600'
                                                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        {distributor}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                                        <div className="p-3 rounded-lg bg-gray-50 border">
                                            <div className="text-xs text-gray-500">Pedidos</div>
                                            <div className="text-lg font-bold text-gray-900">{totalOrders}</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-gray-50 border">
                                            <div className="text-xs text-gray-500">Unidades Totales</div>
                                            <div className="text-lg font-bold text-gray-900">{totalUnits}</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-gray-50 border">
                                            <div className="text-xs text-gray-500">Cajas Eq.</div>
                                            <div className="text-lg font-bold text-gray-900">{totalBoxesEq}</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-gray-50 border">
                                            <div className="text-xs text-gray-500">Estados</div>
                                            <div className="text-sm text-gray-700">
                                                {(pendingSummary?.meta?.statuses || []).join(', ')}
                                            </div>
                                        </div>
                                    </div>

                                    {pendingDistributorFilter !== 'ALL' && (
                                        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                                            Mostrando solo el saldo pendiente de <strong>{pendingDistributorFilter}</strong>. Los totales de unidades, cajas equivalentes, matriz y detalle por pedido ya no mezclan otros distribuidores.
                                        </div>
                                    )}

                                    <div className="mb-4 border rounded-xl bg-white">
                                        <div className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-700">Pedidos incluidos</div>
                                        {orderTotals.length === 0 ? (
                                            <div className="px-4 py-6 text-sm text-gray-500">No hay pedidos pendientes para este distribuidor con los estados actuales.</div>
                                        ) : (
                                            <table className="min-w-full text-xs">
                                                <thead>
                                                    <tr>
                                                        <th className="p-2 border-b text-left font-bold text-gray-500">Orden</th>
                                                        <th className="p-2 border-b text-left font-bold text-gray-500">Distribuidor</th>
                                                        <th className="p-2 border-b text-left font-bold text-gray-500">Estado</th>
                                                        <th className="p-2 border-b text-right font-bold text-gray-500">Unidades</th>
                                                        <th className="p-2 border-b text-right font-bold text-gray-500">Cajas Eq.</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {orderTotals.map(o => (
                                                        <tr key={o.id} className="border-b last:border-b-0">
                                                            <td className="p-2 text-gray-700 font-semibold">{o.number}</td>
                                                            <td className="p-2 text-gray-600 font-medium truncate max-w-[150px]" title={o.distributor}>{o.distributor}</td>
                                                            <td className="p-2">
                                                                <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getStatusColor(o.status)}`}>
                                                                    {statusLabels[o.status] || o.status}
                                                                </span>
                                                            </td>
                                                            <td className="p-2 text-right font-bold text-gray-900">{o.total}</td>
                                                            <td className="p-2 text-right text-gray-600 font-semibold">{o.boxesEq || 0}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>

                                    {pendingCellDetail && detailList.length > 0 && (
                                        <div className="mb-4 border rounded-xl bg-white">
                                            <div className="px-4 py-2 bg-emerald-50 border-b text-sm font-semibold text-emerald-800 flex items-center justify-between">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span>Detalle por pedido · {pendingCellDetail.brand} · {pendingCellDetail.presentation} · {pendingCellDetail.flavor}</span>
                                                    <span className="inline-flex px-2 py-0.5 rounded-full bg-white text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                                                        {detailUnits} uds pendientes
                                                    </span>
                                                    {detailUnitsPerBox > 1 && (
                                                        <span className="inline-flex px-2 py-0.5 rounded-full bg-white text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                                                            {detailBoxesEq} cajas eq. · x{detailUnitsPerBox}/caja
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setPendingCellDetail(null)}
                                                    className="text-emerald-900 text-lg"
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                            <div className="p-3 space-y-1.5">
                                                {detailList.map((row, idx) => (
                                                    <div key={`${row.orderNumber}-${idx}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm hover:bg-gray-50 transition-colors">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                                                                {row.globalFifoRank != null && (
                                                                    <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-white shrink-0" title="Posición en la cola FIFO global">
                                                                        #{row.globalFifoRank}
                                                                    </span>
                                                                )}
                                                                <span className="font-semibold text-gray-900 text-xs truncate">{row.orderNumber}</span>
                                                                <span className="text-[11px] text-gray-500 truncate">· {row.distributor}</span>
                                                                {row.isBackorder && (
                                                                    <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">BKO</span>
                                                                )}
                                                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold border ${getStatusColor(row.status)}`}>
                                                                    {statusLabels[row.status] || row.status}
                                                                </span>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <span className="text-base font-black text-gray-900">{row.qty}</span>
                                                                <span className="text-[10px] text-gray-500 ml-1">uds</span>
                                                                <span className="text-[10px] text-gray-400 ml-1">· {row.boxLabel}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {renderMatrixTable('GENIALITY', matrix.GENIALITY)}
                                    {renderMatrixTable('LIQUIPOPS', matrix.LIQUIPOPS)}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            );
        })()}
        </>
    );
}
