import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle, XCircle, Package, Truck, ScanLine, ClipboardList, BarChart3, Box, ChevronDown, ChevronUp, FileText, Upload, Printer } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseScanInput } from '../services/scannerParser';

const API_URL = `${import.meta.env.VITE_API_URL}/api` || '/api';
const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function OrderManagement() {
    const { user } = useAuth();
    const isAdmin = ['ADMIN', 'LOGISTICA'].includes(user?.role);
    const isComercial = user?.role === 'COMERCIAL';
    const isDistributor = user?.role === 'DISTRIBUIDOR';
    const canManageOrders = isAdmin || isComercial;
    const [statusFilter, setStatusFilter] = useState('PENDING');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [pickingOrder, setPickingOrder] = useState(null);
    const [pickingProgress, setPickingProgress] = useState(null);
    const [invoiceModal, setInvoiceModal] = useState(null);
    const [dispatchModal, setDispatchModal] = useState(null);
    const [deliverModal, setDeliverModal] = useState(null);
    const [signedGuideFile, setSignedGuideFile] = useState(null);
    const [imageModal, setImageModal] = useState(null);
    const [dispatchForm, setDispatchForm] = useState({
        driverName: '', licensePlate: '', driverCedula: '',
        amountPaid: '', destination: '', dispatchTime: '', dispatchNotes: ''
    });
    const [invoiceFiles, setInvoiceFiles] = useState({ invoicePdf: null, accountStatement: null, invoiceNumber: '' });
    const [manualLot, setManualLot] = useState('');
    const [scanBuffer, setScanBuffer] = useState('');
    const [lastScan, setLastScan] = useState(null); // {productName, lotNumber, status, timestamp}
    const [unitPickPopup, setUnitPickPopup] = useState(null); // {itemId, product, qty, lot, availableLots}
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [expandedOrderId, setExpandedOrderId] = useState(null);
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
        onSuccess: (data) => {
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
            // Flash success
            setLastScan(prev => prev ? { ...prev, status: 'success' } : null);
            setTimeout(() => setLastScan(prev => prev?.status === 'success' ? null : prev), 3000);
        },
        onError: (error) => {
            setLastScan(prev => prev ? { ...prev, status: 'error', message: error.response?.data?.error || 'Error al escanear' } : null);
        }
    });

    const completePickingMutation = useMutation({
        mutationFn: async (orderId) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/complete-picking`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['admin-orders']);
            setPickingOrder(null);
            setPickingProgress(null);
            alert('✅ Separación completada — Pedido listo para despacho');
        },
        onError: (error) => alert(error.response?.data?.error || 'Error al completar separación')
    });

    const invoiceMutation = useMutation({
        mutationFn: async ({ orderId }) => {
            const response = await axios.post(`${API_URL}/orders/${orderId}/invoice`, {}, { headers: AUTH() });
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries(['admin-orders']);
            queryClient.invalidateQueries(['order-counts']);
            setInvoiceModal(null);
            const siigoName = data.siigoInvoice?.name;
            if (siigoName) {
                alert(`✅ Factura ${siigoName} creada exitosamente en Siigo`);
            } else {
                alert('✅ Pedido facturado exitosamente');
            }
        },
        onError: (error) => {
            const errData = error.response?.data;
            const msg = errData?.siigoError || errData?.error || 'Error al facturar';
            const details = errData?.siigoDetails?.map(d => d.Message).join('\n') || '';
            alert(`❌ ${msg}${details ? '\n\n' + details : ''}`);
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
            const guideNumber = data.data?.transportGuideNumber;
            setDispatchModal(null);
            setDispatchForm({ driverName: '', licensePlate: '', driverCedula: '', amountPaid: '', destination: '', dispatchTime: '', dispatchNotes: '' });
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
        setPickingOrder(order);
        await loadPickingProgress(order.id);
    }, [loadPickingProgress]);

    // ─── Handle QR Scan ──────────────────────────────────────────
    const handleQrScan = useCallback((qrData) => {
        if (!pickingOrder || !pickingProgress) return;

        // Auto-match: find the order item that matches this productCode
        const matchedItem = pickingProgress.itemsProgress?.find(ip =>
            !ip.completed && pickingOrder.items.find(
                oi => oi.id === ip.itemId && oi.product?.sku === qrData.productCode
            )
        );

        const targetItemId = selectedItemId || matchedItem?.itemId;

        if (!targetItemId) {
            setLastScan({ productName: qrData.productCode, lotNumber: qrData.lotNumber, status: 'error', message: 'Producto no encontrado en este pedido', timestamp: Date.now() });
            return;
        }

        // Show scanning feedback
        const matchedProduct = pickingOrder.items?.find(oi => oi.id === targetItemId)?.product;
        setLastScan({ productName: matchedProduct?.name || qrData.productCode, lotNumber: qrData.lotNumber, status: 'scanning', timestamp: Date.now() });

        scanMutation.mutate({
            orderId: pickingOrder.id,
            orderItemId: targetItemId,
            qrData,
            scannedQty: qrData.unitsPerBox || 1
        });
    }, [pickingOrder, pickingProgress, selectedItemId, scanMutation]);

    // ─── Scanner input ref (hidden auto-focus input captures all scanner reads) ───
    const scannerInputRef = useRef(null);

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

        // ── 2. LOT:SKU (from thermal label QR) ──
        if (scan.type === 'qr_lot_sku' && scan.sku) {
            const matchedOrderItem = pickingOrder.items?.find(oi => oi.product?.sku === scan.sku);
            const matchedIp = matchedOrderItem && pickingProgress?.itemsProgress?.find(ip => ip.itemId === matchedOrderItem.id && !ip.completed);

            if (matchedOrderItem && matchedIp) {
                // If we have a lot number from the QR, auto-fill it
                if (scan.lotNumber) {
                    handleQrScan({
                        productCode: matchedOrderItem.product?.sku || scan.sku,
                        barcode: matchedOrderItem.product?.barcode || scan.sku,
                        name: matchedOrderItem.product?.name || '',
                        lotNumber: scan.lotNumber,
                        unitsPerBox: matchedOrderItem.product?.packSize || 1,
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
                setLastScan({ productName: matchedOrderItem.product?.name || scan.sku, status: 'success', message: 'Ya completado', timestamp: Date.now() });
            } else {
                setLastScan({ productName: scan.sku, status: 'error', message: `SKU ${scan.sku} no encontrado en este pedido`, timestamp: Date.now() });
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
            setLastScan({ productName: matchedOrderItem.product?.name || buffer, status: 'success', message: 'Ya completado', timestamp: Date.now() });
        } else {
            setLastScan({ productName: buffer, status: 'error', message: 'Código de barras no encontrado en este pedido', timestamp: Date.now() });
        }
    }, [pickingOrder, pickingProgress, handleQrScan]);

    // ─── Handle Manual Lot Entry ─────────────────────────────────
    const handleManualLot = useCallback((orderItemId, product) => {
        if (!manualLot.trim()) return;

        const qrData = {
            productCode: product?.sku || '',
            barcode: product?.sku || '',
            name: product?.name || '',
            lotNumber: manualLot.trim(),
            unitsPerBox: product?.packSize || 1,
            expirationDate: new Date(Date.now() + 270 * 86400000).toISOString().split('T')[0]
        };

        scanMutation.mutate({
            orderId: pickingOrder.id,
            orderItemId,
            qrData,
            scannedQty: product?.packSize || 1
        });
    }, [manualLot, pickingOrder, scanMutation]);

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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-900">Gestión de Pedidos</h1>
                    {canManageOrders && (
                        <button
                            onClick={async () => {
                                setExcelModal(true);
                                setExcelFile(null);
                                setExcelPreview(null);
                                setExcelDistributor('');
                                try {
                                    const res = await axios.get(`${API_URL}/admin/users`, { headers: AUTH() });
                                    setDistributors((res.data.data || res.data || []).filter(u => u.role === 'DISTRIBUIDOR'));
                                } catch(e) { console.error(e); }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm"
                        >
                            <Upload className="w-4 h-4" />
                            Cargar Excel
                        </button>
                    )}
                </div>

                {/* Status Filter */}
                <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
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

                {/* Orders List */}
                <div className="space-y-4">
                    {orders?.length === 0 ? (
                        <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
                            <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                            <p>No hay pedidos con estado {statusLabels[statusFilter] || statusFilter}</p>
                        </div>
                    ) : (
                        orders?.map(order => {
                            const progress = order.pickingProgress || 0;
                            const totalItems = order.items?.length || 0;
                            const completedItems = order.items?.filter(i => {
                                const scanned = i.pickingItems?.reduce((s, p) => s + p.scannedQty, 0) || 0;
                                return scanned >= i.requestedQty;
                            }).length || 0;

                            // ── Animated progress card for IN_PICKING (distributor view) ──
                            if (order.status === 'IN_PICKING' && !isAdmin) {
                                return (
                                    <div key={order.id} className="bg-white rounded-2xl shadow-lg border border-purple-100 overflow-hidden">
                                        {/* Header with inline progress */}
                                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                                            <div className="flex justify-between items-center mb-2">
                                                <div>
                                                    <h3 className="text-lg font-bold text-white">{order.orderNumber}</h3>
                                                    <p className="text-purple-200 text-xs">{new Date(order.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
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

                                        {/* Collapsible per-item progress */}
                                        <div className="px-6 pb-4">
                                            <div className="flex items-center justify-between cursor-pointer hover:bg-purple-50 rounded-lg px-3 py-2 -mx-3 transition"
                                                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                            >
                                                <span className="text-sm text-gray-600 font-medium">
                                                    {completedItems}/{totalItems} productos separados • {order.items?.reduce((sum, i) => sum + Math.ceil(i.requestedQty / (i.product?.packSize || 1)), 0)} cajas
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
                                                    const packSize = item.product?.packSize || 1;
                                                    const scanned = item.pickingItems?.reduce((s, p) => s + p.scannedQty, 0) || 0;
                                                    const itemPct = Math.min(100, Math.round((scanned / item.requestedQty) * 100));
                                                    const done = scanned >= item.requestedQty;
                                                    const boxes = Math.ceil(item.requestedQty / packSize);
                                                    const scannedBoxes = Math.floor(scanned / packSize);
                                                    return (
                                                        <div key={item.id} className={`p-3 rounded-xl transition-all duration-500 ${done ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-100'}`}>
                                                            <div className="flex justify-between items-center mb-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {done ? (
                                                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                                                    ) : (
                                                                        <Box className="w-4 h-4 text-purple-400" />
                                                                    )}
                                                                    <span className="text-sm font-medium text-gray-800 truncate max-w-[200px] sm:max-w-none">
                                                                        {item.product?.name || item.product?.sku}
                                                                    </span>
                                                                </div>
                                                                <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-purple-600'}`}>
                                                                    {scannedBoxes}/{boxes} cajas
                                                                </span>
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
                            <div key={order.id} className="bg-white rounded-lg shadow-md p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-semibold text-gray-900">{order.orderNumber}</h3>
                                        <p className="text-sm text-gray-600">
                                            Distribuidor: <span className="font-medium">{order.distributor?.name}</span>
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {new Date(order.createdAt).toLocaleString('es-ES')}
                                        </p>
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

                                {/* Compact summary row — click to expand */}
                                <div className="flex items-center justify-between border-t pt-3 mb-3 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2 transition"
                                    onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                >
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Package className="w-4 h-4 text-gray-400" />
                                        <span className="font-medium">{order.items?.length} productos</span>
                                        <span className="text-gray-400">•</span>
                                        <span>{order.items?.reduce((sum, i) => sum + Math.ceil(i.requestedQty / (i.product?.packSize || 1)), 0)} cajas total</span>
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
                                            const packSize = item.product?.packSize || 1;
                                            const boxes = Math.ceil(item.requestedQty / packSize);
                                            const name = item.product?.name || item.product?.sku || '?';
                                            const stock = item.product?.currentStock || 0;
                                            const sufficient = stock >= item.requestedQty;
                                            return (
                                                <div key={item.id} className={`flex justify-between items-center text-sm px-3 py-2 rounded-lg ${sufficient ? 'bg-gray-50' : 'bg-amber-50'}`}>
                                                    <span className="text-gray-800 font-medium truncate mr-3">{name}</span>
                                                    <div className="flex items-center gap-3 whitespace-nowrap">
                                                        {isAdmin && (
                                                            <span className={`text-xs ${sufficient ? 'text-green-600' : 'text-amber-600'}`}>
                                                                Stock: {stock}
                                                            </span>
                                                        )}
                                                        <span className="text-gray-600 text-xs font-medium">
                                                            {boxes} {boxes === 1 ? 'caja' : 'cajas'}
                                                            <span className="text-gray-400 ml-1">({item.requestedQty} uds)</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                )}

                                {/* Actions */}
                                {(isAdmin || (isDistributor && order.status === 'DISPATCHED')) && (
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

                                    {order.status === 'READY' && (isAdmin || isComercial) && (
                                        <button
                                            onClick={() => setInvoiceModal(order)}
                                            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700"
                                        >
                                            <FileText className="w-4 h-4" />
                                            Facturar
                                        </button>
                                    )}

                                    {order.status === 'INVOICED' && isAdmin && (
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
                        })
                    )}
                </div>
            </div>

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

            {/* ════════════════ PENDING ORDER DETAIL / DISPATCH MODAL ════════════ */}
            {selectedOrder && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
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
                            return (
                                <div className={`p-3 rounded-lg mb-4 text-sm ${allSufficient ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                                    {allSufficient ? (
                                        <p className="text-green-800 font-medium">✅ Todos los productos tienen stock suficiente.</p>
                                    ) : (
                                        <p className="text-yellow-800 font-medium">⚠️ {insufficientCount} producto(s) con stock insuficiente. Se permitirá backorder.</p>
                                    )}
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
                        {selectedOrder.status === 'PENDING' && (
                            <div className="flex justify-end gap-3 border-t pt-4 flex-wrap">
                                <button
                                    onClick={() => {
                                        const reason = prompt('Razón del rechazo:');
                                        if (reason) rejectMutation.mutate({ orderId: selectedOrder.id, reason });
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                                >
                                    <XCircle className="w-4 h-4" /> Rechazar
                                </button>
                                {(() => {
                                    const hasInsufficient = selectedOrder.items?.some(i => (i.product?.currentStock || 0) < i.requestedQty);
                                    return hasInsufficient ? (
                                        <button
                                            onClick={() => setConfirmSkipModal(true)}
                                            disabled={approveMutation.isPending}
                                            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:bg-gray-400 font-medium text-sm"
                                        >
                                            <CheckCircle className="w-4 h-4" /> Aprobar sin faltantes
                                        </button>
                                    ) : null;
                                })()}
                                <button
                                    onClick={() => approveMutation.mutate({ orderId: selectedOrder.id })}
                                    disabled={approveMutation.isPending}
                                    className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium"
                                >
                                    <CheckCircle className="w-4 h-4" /> Aprobar Pedido
                                </button>
                            </div>
                        )}


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
                                                <p className="text-sm text-gray-500">Toque para seleccionar archivo</p>
                                                <p className="text-xs text-gray-400">Foto o PDF (máx. 10MB)</p>
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
                            <p>🏷️ <strong>Descuento:</strong> 34.8%</p>
                            <p>📋 <strong>Impuestos según producto:</strong></p>
                            <ul className="ml-5 space-y-0.5 list-disc text-gray-500">
                                <li>LIQUIPOPS → IVA 19% + Comestibles Ultraprocesados 20%</li>
                                <li>SIROPES/GENIALITY → IVA 19% + Bebidas Azucaradas</li>
                                <li>LIQUIMON/Otros → IVA 19%</li>
                            </ul>
                            <p>📊 <strong>Retención:</strong> ReteFuente 2.5%</p>
                            <p>💳 <strong>Forma de pago:</strong> Crédito (30 días)</p>
                            <p>📄 <strong>Documento:</strong> FV-1 (Factura)</p>
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
            {dispatchModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">Despachar Pedido</h3>
                            <button onClick={() => setDispatchModal(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        <p className="text-sm text-gray-600 mb-4">
                            Pedido: <span className="font-semibold">{dispatchModal.orderNumber}</span> — 
                            Distribuidor: <span className="font-semibold">{dispatchModal.distributor?.name}</span>
                        </p>

                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del Conductor *</label>
                                    <input type="text" value={dispatchForm.driverName}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, driverName: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Nombre completo" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Cédula</label>
                                    <input type="text" value={dispatchForm.driverCedula}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, driverCedula: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="1234567890" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Placa del Vehículo *</label>
                                    <input type="text" value={dispatchForm.licensePlate}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, licensePlate: e.target.value.toUpperCase() }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm uppercase" placeholder="ABC-123" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Monto Pagado ($)</label>
                                    <input type="number" value={dispatchForm.amountPaid}
                                        onChange={(e) => setDispatchForm(prev => ({ ...prev, amountPaid: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="0" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Destino *</label>
                                <input type="text" value={dispatchForm.destination}
                                    onChange={(e) => setDispatchForm(prev => ({ ...prev, destination: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Ciudad / Dirección" />
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

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Peso Estimado</label>
                                <div className="px-3 py-2 bg-gray-100 rounded-md text-sm font-semibold text-gray-700">
                                    {(() => {
                                        const getWeightGrams = (product) => {
                                            const name = (product?.name || '').toUpperCase();
                                            // SIROPE GENIALITY: 1000 ML = 1300g, 360 ML = 500g
                                            if (name.includes('SIROPE') || name.includes('GENIALITY')) {
                                                if (name.includes('1000')) return 1300;
                                                if (name.includes('360')) return 500;
                                                return 1300; // default sirope
                                            }
                                            // LIQUIMON: 500 ML = 500g, 1000 ML = 1000g
                                            if (name.includes('LIQUIMON')) {
                                                if (name.includes('1000')) return 1000;
                                                if (name.includes('500')) return 500;
                                                return 500;
                                            }
                                            // LIQUIPOPS: weight matches the GR in name (350, 1150, 3400)
                                            const grMatch = name.match(/(\d+)\s*GR/);
                                            if (grMatch) return parseInt(grMatch[1]);
                                            return 350; // fallback
                                        };
                                        const totalKg = dispatchModal.items?.reduce((sum, item) => {
                                            const weightG = getWeightGrams(item.product);
                                            return sum + ((item.allocatedQty || 0) * weightG / 1000);
                                        }, 0) || 0;
                                        return `${totalKg.toFixed(1)} kg (calculado automáticamente)`;
                                    })()}
                                </div>
                            </div>

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
                                onClick={() => dispatchMutation.mutate({ orderId: dispatchModal.id, ...dispatchForm })}
                                disabled={!dispatchForm.driverName || !dispatchForm.licensePlate || !dispatchForm.destination || dispatchMutation.isPending}
                                className="px-5 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 font-medium"
                            >
                                {dispatchMutation.isPending ? 'Despachando...' : '🚛 Confirmar Despacho'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ PICKING MODAL ════════════════════════════════════ */}
            {pickingOrder && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[95vh] flex flex-col shadow-2xl">
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
                            lastScan?.status === 'error' ? 'bg-red-50 border-red-200' :
                            lastScan?.status === 'scanning' ? 'bg-blue-50 border-blue-200' :
                            'bg-purple-50 border-purple-100'
                        }`}>
                            {lastScan ? (
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                                        lastScan.status === 'success' ? 'bg-green-500 animate-bounce' :
                                        lastScan.status === 'error' ? 'bg-red-500' :
                                        'bg-blue-500 animate-pulse'
                                    }`}>
                                        {lastScan.status === 'success' ? '✓' : lastScan.status === 'error' ? '✗' : '⟳'}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-sm font-bold ${
                                            lastScan.status === 'success' ? 'text-green-800' :
                                            lastScan.status === 'error' ? 'text-red-800' :
                                            'text-blue-800'
                                        }`}>
                                            {lastScan.status === 'success' ? '✅ Escaneado' :
                                             lastScan.status === 'error' ? '❌ Error' : '🔄 Procesando...'}
                                        </p>
                                        <p className="text-xs text-gray-600">
                                            {lastScan.productName}
                                            {lastScan.lotNumber && <span className="ml-2 text-gray-400">Lote: {lastScan.lotNumber}</span>}
                                            {lastScan.message && <span className={`ml-2 ${lastScan.status === 'error' ? 'text-red-500' : 'text-blue-500'}`}>{lastScan.message}</span>}
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
                                ?.map((ip) => {
                                const orderItem = pickingOrder.items?.find(oi => oi.id === ip.itemId);
                                const product = orderItem?.product;
                                const packSize = product?.packSize || 1;
                                const requestedUnits = ip.requestedQty;
                                const scannedUnits = ip.scannedQty;
                                const remainingUnits = requestedUnits - scannedUnits;
                                const requestedBoxes = packSize > 1 ? (requestedUnits / packSize).toFixed(1) : null;
                                const scannedBoxes = packSize > 1 ? (scannedUnits / packSize).toFixed(1) : null;
                                const isLastScanned = lastScan?.status === 'success' && product?.name === lastScan?.productName;

                                return (
                                    <div key={ip.itemId}
                                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-500 ${
                                            ip.completed
                                                ? 'border-green-200 bg-green-50 opacity-60'
                                                : isLastScanned
                                                    ? 'border-green-400 bg-green-50 shadow-lg shadow-green-100 scale-[1.01]'
                                                    : 'border-gray-100 bg-white hover:border-gray-200'
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

                                        {/* Product info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-gray-900 text-sm truncate">{ip.productName}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-gray-400">{product?.sku}</span>
                                                {product?.barcode && (
                                                    <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{product.barcode}</span>
                                                )}
                                            </div>
                                        </div>

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
                                        <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                                            <div className={`h-full rounded-full transition-all duration-500 ${ip.completed ? 'bg-green-500' : 'bg-purple-500'}`}
                                                style={{ width: `${ip.progress}%` }}
                                            />
                                        </div>

                                        {/* Scanned lots chips (compact) */}
                                        {ip.pickingItems?.length > 0 && (
                                            <div className="hidden sm:flex gap-1 flex-shrink-0 max-w-[120px] overflow-hidden">
                                                {ip.pickingItems.slice(-2).map((pi, idx) => (
                                                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono whitespace-nowrap">
                                                        {pi.lotNumber}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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
                                <button
                                    onClick={() => completePickingMutation.mutate(pickingOrder.id)}
                                    disabled={pickingProgress?.itemsCompleted !== pickingProgress?.itemsTotal || completePickingMutation.isPending}
                                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-bold"
                                >
                                    {completePickingMutation.isPending ? 'Completando...' : '✅ Completar Separación'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ CONFIRM SKIP INSUFFICIENT MODAL ════════════════ */}
            {confirmSkipModal && selectedOrder && (() => {
                const insufficient = selectedOrder.items?.filter(i => (i.product?.currentStock || 0) < i.requestedQty) || [];
                const sufficient = selectedOrder.items?.filter(i => (i.product?.currentStock || 0) >= i.requestedQty) || [];
                return (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                        <span className="text-xl">📋</span>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold">Aprobar sin faltantes</h3>
                                        <p className="text-sm text-white/80">Pedido {selectedOrder.orderNumber}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 max-h-[50vh] overflow-y-auto">
                                {/* Items to REMOVE */}
                                <div className="mb-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                        <p className="text-sm font-bold text-red-700">Se eliminarán ({insufficient.length})</p>
                                    </div>
                                    <div className="space-y-1">
                                        {insufficient.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                                                <span className="text-xs font-medium text-red-900 flex-1">{item.product?.name}</span>
                                                <div className="flex gap-3 text-xs">
                                                    <span className="text-red-600">Pedido: <b>{item.requestedQty}</b></span>
                                                    <span className="text-red-500">Stock: <b>{item.product?.currentStock || 0}</b></span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Items to KEEP */}
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                        <p className="text-sm font-bold text-green-700">Se mantendrán ({sufficient.length})</p>
                                    </div>
                                    <div className="space-y-1">
                                        {sufficient.slice(0, 5).map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center px-3 py-2 bg-green-50 rounded-lg border border-green-100">
                                                <span className="text-xs font-medium text-green-900 flex-1">{item.product?.name}</span>
                                                <span className="text-xs text-green-600">Cant: <b>{item.requestedQty}</b></span>
                                            </div>
                                        ))}
                                        {sufficient.length > 5 && (
                                            <p className="text-xs text-gray-500 pl-3">... y {sufficient.length - 5} productos más</p>
                                        )}
                                    </div>
                                </div>
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
                                    {approveMutation.isPending ? 'Aprobando...' : `✅ Aprobar ${sufficient.length} productos`}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ════════════════ EXCEL UPLOAD MODAL ════════════════════════ */}
            {excelModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">📤 Cargar Pedido desde Excel</h3>
                            <button onClick={() => setExcelModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                        </div>

                        {/* Step 1: Select distributor */}
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

                        {/* Step 2: File upload */}
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Archivo Excel (.xlsx)</label>
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={e => { setExcelFile(e.target.files[0]); setExcelPreview(null); }}
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-semibold"
                            />
                            <p className="text-xs text-gray-500 mt-1">Col B = código de barras, Col G = cantidad a facturar</p>
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
                                                <th className="text-center px-3 py-2 font-medium">SKU</th>
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
                                                        <td className="px-3 py-2 text-center text-xs text-gray-500">{item.sku}</td>
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
    );
}
