import { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { io as socketIO } from 'socket.io-client';
import { Search, ShoppingCart, Filter, ChevronDown, ChevronUp, Package, Calendar, CheckCircle, Clock, AlertCircle, TrendingUp, X, ChevronRight, ArrowRight, Menu, LogOut, Download, MapPin, Phone, Mail, User, Shield, Briefcase, Plus, Minus, XCircle, Info, AlertTriangle, Trash2, ShieldAlert, BarChart3 } from 'lucide-react';

// Use relative path for API to avoid mixed content/localhost issues in production
const API_URL = `${import.meta.env.VITE_API_URL}/api` || '/api';
const WS_URL = import.meta.env.VITE_API_URL || window.location.origin;
const AUTH_HEADER = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function DistributorPortal() {
    const [activeTab, setActiveTab] = useState('inventory');
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [expandedOrder, setExpandedOrder] = useState(null);
    const [recallDismissed, setRecallDismissed] = useState(true);
    const [cartLoading, setCartLoading] = useState({});
    const [orderResult, setOrderResult] = useState(null); // { type: 'success' | 'error', message: string }
    const [pendingSummaryModal, setPendingSummaryModal] = useState(false);
    const [pendingCellDetail, setPendingCellDetail] = useState(null); // { brand, presentation, flavor }
    const [expandedPendingCells, setExpandedPendingCells] = useState({});
    const [expandAllPendingCells, setExpandAllPendingCells] = useState(false);
    const queryClient = useQueryClient();
    const socketRef = useRef(null);
    const inventoryGridRef = useRef(null);

    // ═══ WEBSOCKET: Real-time inventory updates ═══
    useEffect(() => {
        const socket = socketIO(WS_URL, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        socket.on('inventory:updated', (data) => {
            // Refresh inventory when ANY distributor reserves/releases
            queryClient.invalidateQueries(['distributor-inventory']);
        });

        return () => { socket.disconnect(); };
    }, [queryClient]);

    // ═══ LOAD CART FROM SERVER on mount ═══
    useEffect(() => {
        (async () => {
            try {
                const res = await axios.get(`${API_URL}/cart`, { headers: AUTH_HEADER() });
                const serverCart = (res.data.data || []).map(r => ({
                    ...r.product,
                    quantity: r.quantity
                }));
                setCart(serverCart);
            } catch (e) { console.error('Cart load error:', e); }
        })();
    }, []);

    // ═══ HEARTBEAT: Extend reservation every 5 min ═══
    useEffect(() => {
        if (cart.length === 0) return;
        const interval = setInterval(async () => {
            try {
                await axios.post(`${API_URL}/cart/heartbeat`, {}, { headers: AUTH_HEADER() });
            } catch (e) { /* silent */ }
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [cart.length]);

    const { data: recallLots } = useQuery({
        queryKey: ['recall-lots'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/pqr/recall-lots`, {
                headers: AUTH_HEADER()
            });
            return response.data;
        },
        staleTime: 5 * 60 * 1000
    });

    const { data: inventory, isLoading } = useQuery({
        queryKey: ['distributor-inventory'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/distributor/available-inventory`, {
                headers: AUTH_HEADER()
            });
            return response.data.data;
        }
    });

    const { data: myOrders } = useQuery({
        queryKey: ['my-orders'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/distributor/orders`, {
                headers: AUTH_HEADER()
            });
            return response.data.data;
        },
        enabled: activeTab === 'orders'
    });

    const shouldLoadPendingSummary = activeTab === 'inventory' || pendingSummaryModal;

    const { data: pendingSummary, isLoading: pendingSummaryLoading } = useQuery({
        queryKey: ['orders-pending-summary'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/orders/pending-summary`, { headers: AUTH_HEADER() });
            return response.data;
        },
        enabled: shouldLoadPendingSummary,
        staleTime: 60 * 1000
    });

    const createOrderMutation = useMutation({
        mutationFn: async (orderData) => {
            const response = await axios.post(`${API_URL}/distributor/orders`, orderData, {
                headers: AUTH_HEADER()
            });
            return response.data;
        },
        onSuccess: async () => {
            // Clear server cart after order creation
            try { await axios.delete(`${API_URL}/cart/clear`, { headers: AUTH_HEADER() }); } catch (e) {}
            queryClient.invalidateQueries(['my-orders']);
            queryClient.invalidateQueries(['distributor-inventory']);
            setCart([]);
            setNotes('');
            setActiveTab('orders');
            setOrderResult({ type: 'success', message: 'Tu pedido ha sido registrado y está en cola de procesamiento.' });
        },
        onError: (error) => {
            setOrderResult({ type: 'error', message: error.response?.data?.error || 'Error al crear pedido. Intenta de nuevo.' });
        }
    });

    // ═══ CART FUNCTIONS: API-backed ═══
    const [backorderPrompt, setBackorderPrompt] = useState(null);

    const executeCartUpdate = useCallback(async (product, newTotal, isUpdate = false) => {
        setCartLoading(prev => ({ ...prev, [product.id]: true }));
        try {
            const res = await axios.post(`${API_URL}/cart/reserve`, {
                productId: product.id,
                quantity: newTotal
            }, { headers: AUTH_HEADER() });

            setCart(prev => {
                const ex = prev.find(item => item.id === product.id);
                if (ex) {
                    return prev.map(item =>
                        item.id === product.id ? { ...item, quantity: newTotal } : item
                    );
                }
                return [...prev, { ...product, quantity: newTotal }];
            });
            queryClient.invalidateQueries(['distributor-inventory']);
        } catch (e) {
            const msg = e.response?.data?.error || 'Error al reservar';
            alert('⚠️ ' + msg);
        } finally {
            setCartLoading(prev => ({ ...prev, [product.id]: false }));
        }
    }, [queryClient]);

    const confirmBackorder = () => {
        if (!backorderPrompt) return;
        executeCartUpdate(backorderPrompt.product, backorderPrompt.newTotal, backorderPrompt.isUpdate);
        setBackorderPrompt(null);
    };

    const addToCart = useCallback((product, qty = 1) => {
        const packSize = product.packSize || 1;
        const quantityToAdd = qty * packSize;
        const existing = cart.find(item => item.id === product.id);
        const newTotal = existing ? existing.quantity + quantityToAdd : quantityToAdd;

        // Si excede el stock físico, mostrar modal de backorder
        if (newTotal > (product.qty || 0)) {
            setBackorderPrompt({ product, newTotal, isUpdate: false });
            return;
        }

        executeCartUpdate(product, newTotal, false);
    }, [cart, executeCartUpdate]);

    const updateCartQty = useCallback((product, newQty, packSize = 1) => {
        const validQty = Math.max(packSize, newQty);
        
        // Si excede el stock físico y estamos subiendo la cantidad
        if (validQty > (product.qty || 0)) {
            const existing = cart.find(item => item.id === product.id);
            if (!existing || validQty > existing.quantity) {
                 setBackorderPrompt({ product, newTotal: validQty, isUpdate: true });
                 return;
            }
        }
        
        executeCartUpdate(product, validQty, true);
    }, [cart, executeCartUpdate]);

    const removeFromCart = useCallback(async (productId) => {
        setCartLoading(prev => ({ ...prev, [productId]: true }));
        try {
            await axios.delete(`${API_URL}/cart/release/${productId}`, { headers: AUTH_HEADER() });
            setCart(prev => prev.filter(item => item.id !== productId));
            queryClient.invalidateQueries(['distributor-inventory']);
        } catch (e) {
            console.error('Release error:', e);
        } finally {
            setCartLoading(prev => ({ ...prev, [productId]: false }));
        }
    }, [queryClient]);

    const handleCreateOrder = () => {
        if (cart.length === 0) {
            alert('El carrito está vacío');
            return;
        }

        const items = cart.map(item => ({
            productId: item.id,
            requestedQty: item.quantity
        }));

        createOrderMutation.mutate({ items, notes });
    };

    const getStatusColor = (status) => {
        const colors = {
            PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-300',
            APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
            IN_PROGRESS: 'bg-purple-100 text-purple-800 border-purple-300',
            READY: 'bg-green-100 text-green-800 border-green-300',
            DISPATCHED: 'bg-indigo-100 text-indigo-800 border-indigo-300',
            DELIVERED: 'bg-gray-100 text-gray-800 border-gray-300',
            CANCELLED: 'bg-red-100 text-red-800 border-red-300',
            REJECTED: 'bg-red-100 text-red-800 border-red-300'
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const getStatusIcon = (status) => {
        if (status === 'DELIVERED') return <CheckCircle className="w-4 h-4" />;
        if (['CANCELLED', 'REJECTED'].includes(status)) return <XCircle className="w-4 h-4" />;
        return <Clock className="w-4 h-4" />;
    };

    const statusLabels = {
        PENDING: 'Pendiente',
        APPROVED: 'Aprobado',
        IN_PICKING: 'En Alistamiento',
        READY: 'Listo',
        INVOICED: 'Facturado',
        DISPATCHED: 'Despachado',
        DELIVERED: 'Entregado',
        CANCELLED: 'Cancelado',
        REJECTED: 'Rechazado'
    };

    const normalizeFlavor = (productName, productFlavor) => {
        if (productFlavor) return productFlavor.toUpperCase();
        const name = (productName || '').toUpperCase();
        const match = name.match(/SABOR\\s+(?:A\\s+)?(.+?)(?:\\s+X\\s+\\d|\\s*$)/);
        return match ? match[1].trim() : (name || 'SIN SABOR');
    };

    const normalizePresentation = (productName, productSize) => {
        const sizeStr = String(productSize || '').toUpperCase();
        const match = (productName || '').match(/\\b(3400|1150|1000|500|360|350)\\b/);
        const num = match ? match[1] : (sizeStr.match(/\\d+/) || [null])[0];
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

    const getEffectiveQty = (orderStatus, item) => {
        const allocated = item.allocatedQty ?? null;
        const requested = item.requestedQty ?? 0;
        if (allocated === null || allocated === undefined) return requested;
        if (allocated > 0) return allocated;
        if (allocated === 0 && requested > 0 && ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'].includes(orderStatus)) {
            return requested;
        }
        return allocated;
    };

    const buildPendingMatrix = (ordersList = []) => {
        const matrix = {};
        const matrixDetails = {};
        const orderTotals = ordersList.map(order => {
            const total = (order.items || []).reduce((sum, item) => {
                const qty = getEffectiveQty(order.status, item);
                return sum + qty;
            }, 0);
            return { id: order.id, number: order.orderNumber, total, status: order.status };
        });

        ordersList.forEach(order => {
            (order.items || []).forEach(item => {
                const product = item.product || {};
                const brand = detectBrand(product);
                if (brand === 'OTROS') return;
                const flavor = normalizeFlavor(product.name, product.flavor);
                const presentation = normalizePresentation(product.name, product.size);
                const qty = getEffectiveQty(order.status, item);

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
                    qty
                });
            });
        });

        return { matrix, matrixDetails, orderTotals };
    };

    const { matrix: pendingMatrix, matrixDetails: pendingMatrixDetails, orderTotals: pendingOrderTotals } = useMemo(() => {
        const ordersList = pendingSummary?.data || [];
        return buildPendingMatrix(ordersList);
    }, [pendingSummary]);

    const getPendingBrandFromCategory = (category) => {
        if (category === 'geniality') return 'GENIALITY';
        if (category === 'liquipops') return 'LIQUIPOPS';
        return 'OTROS';
    };

    const getInventoryPendingCell = (category, size, flavor) => {
        const brand = getPendingBrandFromCategory(category);
        const presentation = normalizePresentation('', size);
        const normalizedFlavor = normalizeFlavor('', flavor);
        const total = pendingMatrix?.[brand]?.[presentation]?.[normalizedFlavor] || 0;
        const details = pendingMatrixDetails?.[brand]?.[presentation]?.[normalizedFlavor] || [];

        return {
            brand,
            presentation,
            flavor: normalizedFlavor,
            total,
            details
        };
    };

    const compactStatusLabels = {
        PENDING: 'Pend.',
        APPROVED: 'Apr.',
        IN_PICKING: 'Alist.',
        READY: 'Listo',
        INVOICED: 'Fact.',
        DISPATCHED: 'Desp.',
        DELIVERED: 'Entr.',
        CANCELLED: 'Canc.',
        REJECTED: 'Rech.'
    };

    const formatCompactOrderNumber = (orderNumber) => {
        const value = String(orderNumber || '').trim();
        if (!value) return 'Sin orden';
        const parts = value.split('-');
        if (parts.length >= 3) {
            return `#${parts.slice(2).join('-')}`;
        }
        return value.replace(/^ORD-/, '#');
    };

    const getPendingCellKey = (category, size, flavor) => {
        const presentation = normalizePresentation('', size);
        const normalizedFlavor = normalizeFlavor('', flavor);
        return `${category}__${presentation}__${normalizedFlavor}`;
    };

    const isPendingCellExpanded = (cellKey) => expandAllPendingCells || !!expandedPendingCells[cellKey];

    const togglePendingCell = (cellKey) => {
        setExpandedPendingCells(prev => ({
            ...prev,
            [cellKey]: !prev[cellKey]
        }));
    };

    const handleToggleAllPendingCells = () => {
        if (expandAllPendingCells) {
            setExpandAllPendingCells(false);
            setExpandedPendingCells({});
            return;
        }

        setExpandAllPendingCells(true);
    };

    useLayoutEffect(() => {
        const root = inventoryGridRef.current;
        if (!root || activeTab !== 'inventory') return;

        let frameId = null;

        const syncRowHeights = () => {
            const rows = root.querySelectorAll('[data-inventory-row-key]');
            rows.forEach((row) => {
                const cards = Array.from(row.querySelectorAll('[data-card-shell]'));
                if (cards.length === 0) return;

                cards.forEach((card) => {
                    card.style.minHeight = '';
                });

                const maxHeight = cards.reduce((max, card) => {
                    return Math.max(max, card.getBoundingClientRect().height);
                }, 0);

                cards.forEach((card) => {
                    card.style.minHeight = `${Math.ceil(maxHeight)}px`;
                });
            });
        };

        const scheduleSync = () => {
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(syncRowHeights);
        };

        scheduleSync();

        const resizeObserver = new ResizeObserver(scheduleSync);
        root.querySelectorAll('[data-card-shell]').forEach((card) => resizeObserver.observe(card));
        window.addEventListener('resize', scheduleSync);

        return () => {
            if (frameId) cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
            window.removeEventListener('resize', scheduleSync);
        };
    }, [activeTab, inventory, expandedPendingCells, expandAllPendingCells, pendingSummary, cart]);

    const renderPendingDeliveryBox = (category, size, flavor) => {
        const { total, details } = getInventoryPendingCell(category, size, flavor);
        const hasPending = total > 0;
        const cellKey = getPendingCellKey(category, size, flavor);
        const expanded = isPendingCellExpanded(cellKey);
        const compactSize = normalizePresentation('', size);

        return (
            <div className={`w-full rounded-xl border px-2 py-1.5 text-left transition-all duration-300 ${
                hasPending
                    ? 'bg-gradient-to-br from-amber-50 to-white border-amber-200/90 shadow-[0_4px_18px_rgba(245,158,11,0.08)]'
                    : 'bg-slate-50/90 border-slate-200'
            }`}>
                <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-[8px] font-bold uppercase tracking-[0.08em] ${
                        hasPending ? 'text-amber-800' : 'text-slate-500'
                    }`}>
                        Pend. entrega
                    </span>
                    <span className={`shrink-0 text-[11px] font-black ${
                        hasPending ? 'text-amber-900' : 'text-slate-500'
                    }`}>
                        {pendingSummaryLoading ? '...' : `${total}u`}
                    </span>
                </div>

                <div className={`mt-0.5 flex items-center justify-between text-[8px] ${
                    hasPending ? 'text-amber-700' : 'text-slate-400'
                }`}>
                    <span>
                        {pendingSummaryLoading
                            ? 'Carg...'
                            : `${details.length} ord${details.length === 1 ? '' : '.'}`}
                    </span>
                    <div className="flex items-center gap-1">
                        <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-semibold text-slate-500 md:hidden">
                            {compactSize}
                        </span>
                        {!pendingSummaryLoading && hasPending && (
                            <button
                                type="button"
                                onClick={() => togglePendingCell(cellKey)}
                                className={`inline-flex items-center border border-amber-100 bg-white/80 text-[8px] font-semibold text-amber-800 transition-colors hover:bg-white ${
                                    expanded
                                        ? 'gap-1 rounded-full px-1.5 py-0.5'
                                        : 'h-5 w-5 justify-center rounded-full p-0'
                                }`}
                                title={expanded ? 'Ocultar ordenes' : 'Ver ordenes'}
                                aria-label={expanded ? 'Ocultar ordenes' : 'Ver ordenes'}
                            >
                                {expanded ? (
                                    <>
                                        <span>Ocultar</span>
                                        <ChevronUp className="h-3 w-3" />
                                    </>
                                ) : (
                                    <ChevronDown className="h-3 w-3" />
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {!pendingSummaryLoading && !hasPending && (
                    <div className="mt-1 text-center text-[8px] text-slate-400">
                        Sin ptes.
                    </div>
                )}

                {!pendingSummaryLoading && hasPending && (
                    <div className={`grid transition-all duration-300 ease-out ${expanded ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                            <div className="space-y-0.5 pt-0.5">
                                {details.map((detail, index) => (
                                    <div
                                        key={`${detail.orderNumber}-${detail.status}-${index}`}
                                        className="flex items-center justify-between gap-2 rounded-md border border-amber-100 bg-white/95 px-1.5 py-1 shadow-[0_2px_10px_rgba(15,23,42,0.04)]"
                                        title={`${detail.orderNumber} · ${statusLabels[detail.status] || detail.status} · ${detail.qty} und`}
                                    >
                                        <span className="min-w-0 truncate text-[8px] font-semibold text-slate-700">
                                            {formatCompactOrderNumber(detail.orderNumber)}
                                        </span>
                                        <span className="shrink-0 text-[8px] font-bold text-amber-800">
                                            {compactStatusLabels[detail.status] || detail.status}
                                        </span>
                                        <span className="shrink-0 text-[9px] font-black text-slate-900">{detail.qty}u</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const getAllSizes = (productType) => {
        const items = inventory?.[productType] || [];
        const sizes = new Set();
        items.forEach(item => sizes.add(item.size));
        return Array.from(sizes).sort((a, b) => {
            const numA = parseInt(a) || 0;
            const numB = parseInt(b) || 0;
            return numB - numA; // Descending: largest first
        });
    };

    const getAllFlavors = (productType) => {
        const items = inventory?.[productType] || [];
        const flavors = new Set();
        items.forEach(item => flavors.add(item.flavor));
        return Array.from(flavors).sort();
    };

    const getStockColor = (qty) => {
        if (qty === 0) return 'text-gray-400';
        if (qty < 50) return 'text-red-600';
        if (qty < 100) return 'text-orange-600';
        if (qty < 200) return 'text-yellow-600';
        return 'text-green-600';
    };

    const getStockBg = (qty) => {
        if (qty === 0) return 'bg-gray-100';
        if (qty < 50) return 'bg-red-50';
        if (qty < 100) return 'bg-orange-50';
        if (qty < 200) return 'bg-yellow-50';
        return 'bg-green-50';
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">Cargando inventario...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
            <div className="w-full px-4 lg:px-8 py-6">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">Portal de Distribuidores</h1>
                    <p className="text-gray-600">Gestiona tus pedidos de Geniality y Liquipops</p>
                </div>

                {/* Recall Alerts Section */}
                {recallLots && recallLots.length > 0 && !recallDismissed && (
                    <div className="mb-6 bg-red-600 rounded-2xl shadow-xl overflow-hidden border-2 border-red-700 animate-pulse" style={{ animationDuration: '3s' }}>
                        <div className="p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white/20 rounded-xl">
                                        <ShieldAlert size={28} className="text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-white">NOTICIAS IMPORTANTES — ALERTA DE RECALL</h2>
                                        <p className="text-red-100 text-sm mt-0.5">Los siguientes lotes han sido reportados y <strong>NO deben venderse</strong>. Informe al departamento de calidad para gestionar los cambios.</p>
                                    </div>
                                </div>
                                <button onClick={() => setRecallDismissed(true)} className="text-red-200 hover:text-white p-1 flex-shrink-0">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {recallLots.map((lot, i) => (
                                    <div key={i} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-mono font-black text-white text-lg">{lot.lot}</span>
                                            <span className="bg-white text-red-700 text-xs font-bold px-2 py-1 rounded-full">{lot.quantity} uds</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {lot.flavors.map((f, j) => (
                                                <span key={j} className="bg-red-800/50 text-red-100 text-xs px-2 py-0.5 rounded-md font-medium">{f}</span>
                                            ))}
                                        </div>
                                        <p className="text-red-200 text-[11px] mt-2 font-medium">NO VENDER — Reportar a calidad LIQUIPOPS</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {recallLots && recallLots.length > 0 && recallDismissed && (
                    <div className="mb-4">
                        <button
                            onClick={() => setRecallDismissed(false)}
                            className="flex items-center gap-2 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-xl border border-red-200 transition-colors"
                        >
                            <ShieldAlert size={16} />
                            Hay {recallLots.length} lote(s) en alerta de recall — Click para ver
                        </button>
                    </div>
                )}

                {/* Backorder Modal */}
                {backorderPrompt && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-red-600 p-6 flex flex-col items-center justify-center text-center relative">
                                <button onClick={() => setBackorderPrompt(null)} className="absolute top-4 right-4 text-white/80 hover:text-white">
                                    <X size={24} />
                                </button>
                                <div className="bg-white/20 p-3 rounded-full mb-4">
                                    <AlertTriangle size={32} className="text-white" />
                                </div>
                                <h3 className="text-xl font-black text-white">Producto Bajo Pedido 🏭</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-700 text-center mb-6">
                                    <span className="font-bold text-gray-900 block mb-2">{backorderPrompt.product.name}</span>
                                    Estás solicitando <strong className="text-red-600">{backorderPrompt.newTotal} unidades</strong>, pero actualmente no hay stock físico suficiente para cubrirlo todo. 
                                    <br/><br/>
                                    Este producto <strong>se fabricará bajo tu solicitud</strong>. Producción ya ha sido notificada para priorizarlo, sin embargo, el tiempo de despacho es variable según la programación de fábrica.
                                </p>
                                
                                <div className="flex gap-3 mt-6">
                                    <button 
                                        onClick={() => setBackorderPrompt(null)}
                                        className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={confirmBackorder}
                                        className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Package size={18} />
                                        Agregar al Pedido
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Order Result Modal (Success / Error) */}
                {orderResult && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" style={{ animation: 'modalIn 0.3s ease-out' }}>
                            {/* Header */}
                            <div className={`p-8 flex flex-col items-center justify-center text-center relative ${
                                orderResult.type === 'success'
                                    ? 'bg-gradient-to-br from-emerald-500 to-green-600'
                                    : 'bg-gradient-to-br from-red-500 to-red-700'
                            }`}>
                                <div className="p-4 rounded-full mb-4 bg-white/20" style={{ animation: 'iconPop 0.5s ease-out 0.2s both' }}>
                                    {orderResult.type === 'success'
                                        ? <CheckCircle size={48} className="text-white" strokeWidth={2.5} />
                                        : <XCircle size={48} className="text-white" strokeWidth={2.5} />
                                    }
                                </div>
                                <h3 className="text-2xl font-black text-white">
                                    {orderResult.type === 'success' ? '¡Pedido Creado!' : 'Error en el Pedido'}
                                </h3>
                                <p className="text-white/80 text-sm mt-1">
                                    {orderResult.type === 'success' ? 'LIQUIPOPS & GENIALITY' : 'No se pudo procesar'}
                                </p>
                            </div>

                            {/* Body */}
                            <div className="p-6">
                                <p className="text-gray-700 text-center text-[15px] leading-relaxed">
                                    {orderResult.message}
                                </p>

                                {orderResult.type === 'success' && (
                                    <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
                                        <div className="flex items-start gap-3">
                                            <Info size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
                                            <div className="text-sm text-blue-800 space-y-1">
                                                <p><strong>FIFO:</strong> Los pedidos se procesan en orden de llegada.</p>
                                                <p><strong>Seguimiento:</strong> Revisa el estado en la pestaña "Mis Pedidos".</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <button
                                    onClick={() => setOrderResult(null)}
                                    className={`w-full mt-6 py-3.5 rounded-xl font-bold text-white text-[15px] transition-all active:scale-[0.98] shadow-lg ${
                                        orderResult.type === 'success'
                                            ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                                            : 'bg-red-600 hover:bg-red-700 shadow-red-200'
                                    }`}
                                >
                                    {orderResult.type === 'success' ? 'Ver Mis Pedidos' : 'Entendido'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="border-b border-gray-300 mb-6 bg-white rounded-t-xl shadow-sm">
                    <nav className="flex space-x-2 px-4">
                        <button
                            onClick={() => setActiveTab('inventory')}
                            className={`py-4 px-6 font-semibold text-sm transition-all relative ${activeTab === 'inventory'
                                ? 'text-blue-600 border-b-3 border-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Package className="inline w-5 h-5 mr-2" />
                            Inventario Disponible
                            {activeTab === 'inventory' && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"></div>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('cart')}
                            className={`py-4 px-6 font-semibold text-sm relative transition-all ${activeTab === 'cart'
                                ? 'text-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <ShoppingCart className="inline w-5 h-5 mr-2" />
                            Carrito
                            {cart.length > 0 && (
                                <span className="ml-2 inline-flex items-center justify-center px-2.5 py-0.5 text-xs font-bold text-white bg-red-600 rounded-full">
                                    {cart.length}
                                </span>
                            )}
                            {activeTab === 'cart' && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"></div>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('orders')}
                            className={`py-4 px-6 font-semibold text-sm transition-all relative ${activeTab === 'orders'
                                ? 'text-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            Mis Pedidos
                            {activeTab === 'orders' && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"></div>
                            )}
                        </button>
                    </nav>
                </div>

                {/* Content */}
                {activeTab === 'inventory' && (
                    <div className="flex flex-col lg:flex-row gap-6 relative">
                        {/* Left Column: Inventory Tables (Expandable) */}
                        <div ref={inventoryGridRef} className="flex-1 min-w-0">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                <div>
                                    <div className="text-sm font-bold text-slate-800">Pendientes por entregar</div>
                                    <div className="text-xs text-slate-500">Las ordenes por sabor estan ocultas por defecto para mantener la grilla limpia.</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleToggleAllPendingCells}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                                >
                                    {expandAllPendingCells ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    {expandAllPendingCells ? 'Ocultar todas' : 'Desplegar todas'}
                                </button>
                            </div>

                            {/* Geniality Table */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
                                <div className="bg-white px-6 py-4 rounded-t-xl border-b border-gray-100 flex items-center justify-between">
                                    <h2 className="text-lg font-bold text-gray-800 flex items-center tracking-tight">
                                        <span className="w-2 h-6 bg-purple-600 rounded-full mr-3"></span>
                                        GENIALITY
                                        <span className="ml-3 text-xs font-normal text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">Línea Premium</span>
                                    </h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-200">
                                                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[120px] border-r border-gray-200">
                                                    Tamaño
                                                </th>
                                                {getAllFlavors('geniality').map(flavor => (
                                                    <th key={flavor} className="px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider min-w-[130px] whitespace-nowrap">
                                                        {flavor}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {getAllSizes('geniality').map(size => {
                                                // Build a map: flavor → item for this size
                                                const flavorMap = {};
                                                (inventory?.geniality || []).forEach(item => {
                                                    if (item.size === size) flavorMap[item.flavor] = item;
                                                });

                                                return (
                                                    <tr key={size} data-inventory-row-key={`geniality-${size}`} className="border-b border-gray-200 last:border-0 hover:bg-gray-50/30 transition-colors duration-200">
                                                        <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap border-r border-gray-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-1.5 h-8 bg-purple-500 rounded-full shadow-sm"></span>
                                                                <span className="text-sm font-black text-gray-900">{size}</span>
                                                            </div>
                                                        </td>
                                                        {getAllFlavors('geniality').map(flavor => {
                                                            const item = flavorMap[flavor];
                                                            if (!item) return <td key={flavor} className="px-2 py-2 text-center text-sm text-gray-300">-</td>;

                                                            const cartItem = cart.find(c => c.id === item.products[0]?.id);
                                                            const qtyInCart = cartItem ? cartItem.quantity : 0;
                                                            const remainingStock = item.availableQty;
                                                            const packSize = item.products[0]?.packSize || 1;
                                                            const remainingBoxes = Math.floor(remainingStock / packSize);

                                                            return (
                                                                <td key={flavor} className="h-full align-top px-1.5 py-1.5">
                                                                    <div data-card-shell className={`group flex h-full min-h-[188px] flex-col justify-between rounded-2xl border p-2.5 transition-[transform,box-shadow,border-color,background] duration-300 ease-out min-w-[110px] ${
                                                                        qtyInCart > 0
                                                                            ? 'bg-gradient-to-br from-lime-50 to-white border-lime-400 shadow-[0_12px_28px_rgba(132,204,22,0.18)] ring-1 ring-lime-200'
                                                                            : 'bg-gradient-to-br from-white via-white to-violet-50/60 border-gray-200 shadow-[0_8px_24px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-[0_16px_32px_rgba(124,58,237,0.12)]'
                                                                        }`}>
                                                                        <div className="flex flex-col items-center gap-1 text-center">
                                                                            <span className="line-clamp-2 min-h-[24px] text-[9px] font-bold uppercase tracking-[0.08em] text-purple-700">
                                                                                {item.flavor}
                                                                            </span>
                                                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500 md:hidden">
                                                                                {normalizePresentation('', item.size)}
                                                                            </span>
                                                                            <span className={`text-xl font-black font-mono leading-none ${remainingStock > 0 ? 'text-gray-900' : 'text-red-500'}`}>
                                                                                {remainingStock}
                                                                            </span>
                                                                            <span className="text-[10px] font-medium text-gray-500">
                                                                                {remainingBoxes} cajas
                                                                            </span>
                                                                            <span className="text-[9px] font-semibold text-gray-400">
                                                                                x{packSize} und/caja
                                                                            </span>

                                                                            {remainingStock <= 0 && item.products[0]?.nextProductionDate && (
                                                                                <div className="flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                                                                                    <Calendar className="h-2.5 w-2.5" />
                                                                                    {new Date(item.products[0].nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                                                                </div>
                                                                            )}
                                                                            {!(remainingStock <= 0 && item.products[0]?.nextProductionDate) && (
                                                                                <div className="h-[18px]" aria-hidden="true" />
                                                                            )}
                                                                        </div>

                                                                        <div className="mt-1 flex w-full flex-col gap-1">
                                                                            {renderPendingDeliveryBox('geniality', item.size, item.flavor)}

                                                                            {item.products.map(prod => (
                                                                                <button
                                                                                    key={prod.id}
                                                                                    onClick={() => addToCart(prod)}
                                                                                    disabled={cartLoading[prod.id]}
                                                                                    className={`w-full flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-bold transition-all active:scale-95 ${qtyInCart > 0
                                                                                        ? 'bg-lime-100 text-lime-800 border-lime-300 hover:bg-lime-200'
                                                                                        : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                                                                                        } ${cartLoading[prod.id] ? 'opacity-50' : ''}`}
                                                                                    title={`Agregar caja de ${packSize} unidades`}
                                                                                >
                                                                                    <Plus className="w-3 h-3" />
                                                                                    {cartLoading[prod.id] ? '...' : 'AGREGAR'}
                                                                                </button>
                                                                            ))}
                                                                            {qtyInCart > 0 && (
                                                                                <div className="text-center text-[9px] font-bold text-lime-700 bg-lime-100 px-1.5 py-0.5 rounded-full">
                                                                                    🛒 {qtyInCart / packSize} caja{qtyInCart / packSize > 1 ? 's' : ''}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Liquipops Table */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                                <div className="bg-white px-6 py-4 rounded-t-xl border-b border-gray-100 flex items-center justify-between">
                                    <h2 className="text-lg font-bold text-gray-800 flex items-center tracking-tight">
                                        <span className="w-2 h-6 bg-cyan-500 rounded-full mr-3"></span>
                                        LIQUIPOPS
                                        <span className="ml-3 text-xs font-normal text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">Línea Clásica</span>
                                    </h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-200">
                                                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[120px] border-r border-gray-200">
                                                    Tamaño
                                                </th>
                                                {getAllFlavors('liquipops').map(flavor => (
                                                    <th key={flavor} className="px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider min-w-[130px] whitespace-nowrap">
                                                        {flavor}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {getAllSizes('liquipops').map(size => {
                                                const flavorMap = {};
                                                (inventory?.liquipops || []).forEach(item => {
                                                    if (item.size === size) flavorMap[item.flavor] = item;
                                                });

                                                return (
                                                    <tr key={size} data-inventory-row-key={`liquipops-${size}`} className="border-b border-gray-200 last:border-0 hover:bg-gray-50/30 transition-colors duration-200">
                                                        <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap border-r border-gray-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-1.5 h-8 bg-cyan-500 rounded-full shadow-sm"></span>
                                                                <span className="text-sm font-black text-gray-900">{size}</span>
                                                            </div>
                                                        </td>
                                                        {getAllFlavors('liquipops').map(flavor => {
                                                            const item = flavorMap[flavor];
                                                            if (!item) return <td key={flavor} className="px-2 py-2 text-center text-sm text-gray-300">-</td>;

                                                            const cartItem = cart.find(c => c.id === item.products[0]?.id);
                                                            const qtyInCart = cartItem ? cartItem.quantity : 0;
                                                            const remainingStock = item.availableQty;
                                                            const packSize = item.products[0]?.packSize || 1;
                                                            const remainingBoxes = Math.floor(remainingStock / packSize);

                                                            return (
                                                                <td key={flavor} className="h-full align-top px-1.5 py-1.5">
                                                                    <div data-card-shell className={`group flex h-full min-h-[188px] flex-col justify-between rounded-2xl border p-2.5 transition-[transform,box-shadow,border-color,background] duration-300 ease-out min-w-[110px] ${
                                                                        qtyInCart > 0
                                                                            ? 'bg-gradient-to-br from-lime-50 to-white border-lime-400 shadow-[0_12px_28px_rgba(132,204,22,0.18)] ring-1 ring-lime-200'
                                                                            : 'bg-gradient-to-br from-white via-white to-cyan-50/60 border-gray-200 shadow-[0_8px_24px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_16px_32px_rgba(6,182,212,0.14)]'
                                                                        }`}>
                                                                        <div className="flex flex-col items-center gap-1 text-center">
                                                                            <span className="line-clamp-2 min-h-[24px] text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-700">
                                                                                {item.flavor}
                                                                            </span>
                                                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500 md:hidden">
                                                                                {normalizePresentation('', item.size)}
                                                                            </span>
                                                                            <span className={`text-xl font-black font-mono leading-none ${remainingStock > 0 ? 'text-gray-900' : 'text-red-500'}`}>
                                                                                {remainingStock}
                                                                            </span>
                                                                            <span className="text-[10px] font-medium text-gray-500">
                                                                                {remainingBoxes} cajas
                                                                            </span>
                                                                            <span className="text-[9px] font-semibold text-gray-400">
                                                                                x{packSize} und/caja
                                                                            </span>

                                                                            {remainingStock <= 0 && item.products[0]?.nextProductionDate && (
                                                                                <div className="flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                                                                                    <Calendar className="h-2.5 w-2.5" />
                                                                                    {new Date(item.products[0].nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                                                                </div>
                                                                            )}
                                                                            {!(remainingStock <= 0 && item.products[0]?.nextProductionDate) && (
                                                                                <div className="h-[18px]" aria-hidden="true" />
                                                                            )}
                                                                        </div>

                                                                        <div className="mt-1 flex w-full flex-col gap-1">
                                                                            {renderPendingDeliveryBox('liquipops', item.size, item.flavor)}

                                                                            {item.products.map(prod => (
                                                                                <button
                                                                                    key={prod.id}
                                                                                    onClick={() => addToCart(prod)}
                                                                                    disabled={cartLoading[prod.id]}
                                                                                    className={`w-full flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-bold transition-all active:scale-95 ${qtyInCart > 0
                                                                                        ? 'bg-lime-100 text-lime-800 border-lime-300 hover:bg-lime-200'
                                                                                        : 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100'
                                                                                        } ${cartLoading[prod.id] ? 'opacity-50' : ''}`}
                                                                                    title={`Agregar caja de ${packSize} unidades`}
                                                                                >
                                                                                    <Plus className="w-3 h-3" />
                                                                                    {cartLoading[prod.id] ? '...' : 'AGREGAR'}
                                                                                </button>
                                                                            ))}
                                                                            {qtyInCart > 0 && (
                                                                                <div className="text-center text-[9px] font-bold text-lime-700 bg-lime-100 px-1.5 py-0.5 rounded-full">
                                                                                    🛒 {qtyInCart / packSize} caja{qtyInCart / packSize > 1 ? 's' : ''}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Legend */}
                            <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
                                <h3 className="font-bold text-gray-900 mb-3">Leyenda de Stock:</h3>
                                <div className="flex flex-wrap gap-6">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-md bg-green-50 border-2 border-green-600"></div>
                                        <span className="text-sm text-gray-700 font-medium">≥ 200 unidades</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-md bg-yellow-50 border-2 border-yellow-600"></div>
                                        <span className="text-sm text-gray-700 font-medium">100-199 unidades</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-md bg-orange-50 border-2 border-orange-600"></div>
                                        <span className="text-sm text-gray-700 font-medium">50-99 unidades</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-md bg-red-50 border-2 border-red-600"></div>
                                        <span className="text-sm text-gray-700 font-medium">1-49 unidades</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-md bg-gray-100 border-2 border-gray-400"></div>
                                        <span className="text-sm text-gray-700 font-medium">Agotado</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Sticky Cart Summary (350px fixed width) */}
                        <div className="hidden lg:block w-80 xl:w-96 flex-shrink-0">
                            {/* Sticky adjustment - works relative to the scrolling viewport */}
                            <div className="sticky top-4 space-y-4">
                                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200 transition-all duration-300">
                                    <div className="p-4 bg-gray-900 text-white flex justify-between items-center">
                                        <span className="font-bold flex items-center gap-2">
                                            <ShoppingCart className="w-5 h-5" />
                                            Resumen
                                        </span>
                                        <span className="bg-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                                            {cart.length} items
                                        </span>
                                    </div>
                                    <div className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                                        {cart.length === 0 ? (
                                            <div className="text-center py-8 text-gray-500">
                                                <p className="text-sm">Tu carrito está vacío</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {cart.map(item => {
                                                    const packSize = item.packSize || 1;
                                                    const boxes = Math.ceil(item.quantity / packSize);
                                                    return (
                                                        <div key={item.id} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                                                            <div className="flex justify-between items-start gap-3">
                                                                <span className="font-bold text-gray-800 text-xs leading-snug">{item.name}</span>
                                                                <button
                                                                    onClick={() => removeFromCart(item.id)}
                                                                    className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5"
                                                                >
                                                                    <XCircle className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                            <div className="flex justify-between items-center mt-2">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[10px] text-gray-500">Caja x {packSize}</span>
                                                                    <span className="text-xs font-bold text-blue-600">Total: {item.quantity} unds</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={() => updateCartQty(item, item.quantity - packSize, packSize)}
                                                                        className="text-gray-400 hover:text-red-500"
                                                                    >
                                                                        <Minus className="w-3 h-3" />
                                                                    </button>
                                                                    <span className="font-bold text-gray-800 bg-gray-50 px-2 py-0.5 rounded text-xs border border-gray-200">
                                                                        {boxes} Cajas
                                                                    </span>
                                                                    <button
                                                                        onClick={() => updateCartQty(item, item.quantity + packSize, packSize)}
                                                                        className="text-gray-400 hover:text-green-500"
                                                                    >
                                                                        <Plus className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    {cart.length > 0 && (
                                        <div className="p-4 border-t border-gray-100 bg-gray-50">
                                            <button
                                                onClick={() => setActiveTab('cart')}
                                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-colors text-sm flex items-center justify-center gap-2"
                                            >
                                                Ver Carrito Completo
                                                <CheckCircle className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'cart' && (
                    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-200">
                        <h2 className="text-3xl font-bold mb-6 text-gray-900">🛒 Carrito de Pedido</h2>

                        {/* Global Policy Message */}
                        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8 rounded-r-lg">
                            <div className="flex items-start">
                                <div className="flex-shrink-0">
                                    <Info className="h-6 w-6 text-blue-600" />
                                </div>
                                <div className="ml-3">
                                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-wide">Política de Procesamiento y Despacho</h3>
                                    <div className="mt-2 text-sm text-blue-700 space-y-1">
                                        <p><strong>1. Método FIFO:</strong> Los pedidos se procesan estrictamente en orden de llegada (Primero en entrar, Primero en salir).</p>
                                        <p><strong>2. Productos Programados:</strong> Si incluye productos sin stock (en programación), el pedido se empezará a separar pero <u>no se despachará hasta que esté 100% completo</u>.</p>
                                        <p><strong>3. Modificaciones:</strong> Una vez creado el pedido, <strong>NO se pueden realizar cambios</strong>. Solo podrá eliminarlo (perdiendo su turno en la cola).</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {cart.length === 0 ? (
                            <div className="text-center py-16">
                                <ShoppingCart className="mx-auto h-24 w-24 text-gray-300 mb-6" />
                                <p className="text-xl text-gray-500 mb-4">El carrito está vacío</p>
                                <button
                                    onClick={() => setActiveTab('inventory')}
                                    className="text-blue-600 hover:text-blue-700 font-semibold text-lg hover:underline"
                                >
                                    Ver inventario disponible →
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-3 mb-8">
                                    {cart.map(item => {
                                        const packSize = item.packSize || 1;
                                        const boxes = Math.ceil(item.quantity / packSize);
                                        // Check if requested quantity exceeds available stock (or if stock is zero)
                                        const isBackorder = item.quantity > item.qty;

                                        return (
                                            <div key={item.id} className={`flex items-center justify-between p-5 rounded-xl border transition-all ${isBackorder ? 'bg-amber-50 border-amber-300 shadow-sm ring-1 ring-amber-200' : 'bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200 hover:shadow-md'}`}>
                                                <div className="flex-1">
                                                    <h4 className="font-bold text-gray-900 text-lg">{item.name}</h4>
                                                    <p className="text-sm text-gray-600 mt-1">
                                                        📦 Presentación: <span className="font-semibold">Caja x {packSize} unidades</span>
                                                    </p>
                                                    <p className={`text-xs mt-1 ${isBackorder ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                                                        Disponible: {item.qty} unidades {isBackorder && `(Faltan ${item.quantity - item.qty})`}
                                                    </p>

                                                    {/* Backorder Warning */}
                                                    {isBackorder && (
                                                        <div className="mt-3 flex flex-col gap-1 px-3 py-2 rounded-lg bg-red-100 border border-red-200 text-red-800 text-xs shadow-sm">
                                                            <div className="flex items-center gap-2 font-bold animate-pulse">
                                                                <AlertTriangle className="w-4 h-4 text-red-600" />
                                                                <span>
                                                                    {item.nextProductionDate
                                                                        ? (item.qty <= 0 ? "Producto en Programación: El pedido esperará producción." : "Pedido Excede Stock: Se completará con próxima producción.")
                                                                        : "Producto Agotado: Se solicitará producción. El pedido quedará en espera indefinida."
                                                                    }
                                                                </span>
                                                            </div>
                                                            {item.nextProductionDate ? (
                                                                <div className="ml-6 flex items-center gap-3 text-[11px] font-medium text-red-700 bg-white/50 px-2 py-1 rounded">
                                                                    <span className="flex items-center gap-1">
                                                                        <Calendar className="w-3 h-3" />
                                                                        Producción: <strong>{new Date(item.nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</strong>
                                                                    </span>
                                                                    <ArrowRight className="w-3 h-3 text-red-400" />
                                                                    <span className="flex items-center gap-1">
                                                                        <Package className="w-3 h-3" />
                                                                        Despacho: <strong>{(() => {
                                                                            const d = new Date(item.nextProductionDate);
                                                                            d.setDate(d.getDate() + 1);
                                                                            return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
                                                                        })()}</strong> (Est.)
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="ml-6 flex items-center gap-2 text-[11px] font-medium text-red-700">
                                                                    <Info className="w-3 h-3" />
                                                                    <span>Fecha de producción por confirmar. Se notificará a operaciones.</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center space-x-6">
                                                    <div className="text-right mr-2">
                                                        <div className="text-2xl font-black text-blue-600">
                                                            {boxes} {boxes === 1 ? 'CAJA' : 'CAJAS'}
                                                        </div>
                                                        <div className="text-xs font-bold text-gray-500">
                                                            Total: {item.quantity} unidades
                                                        </div>
                                                    </div>

                                                        <div className="flex items-center gap-3 bg-white rounded-lg border-2 border-gray-300 px-3 py-2">
                                                        <button
                                                            onClick={() => updateCartQty(item, item.quantity - packSize, packSize)}
                                                            className="text-gray-600 hover:text-red-600 transition-colors"
                                                        >
                                                            <Minus className="w-5 h-5" />
                                                        </button>
                                                        <div className="w-12 text-center font-bold text-xl">
                                                            {boxes}
                                                        </div>
                                                        <button
                                                            onClick={() => updateCartQty(item, item.quantity + packSize, packSize)}
                                                            className="text-gray-600 hover:text-green-600 transition-colors"
                                                        >
                                                            <Plus className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <button
                                                        onClick={() => removeFromCart(item.id)}
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50 p-3 rounded-lg transition-all"
                                                    >
                                                        <Trash2 className="w-6 h-6" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="border-t-2 border-gray-200 pt-6">
                                    <label className="block text-sm font-bold text-gray-700 mb-3">
                                        📝 Notas del pedido (opcional)
                                    </label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={4}
                                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                                        placeholder="Instrucciones especiales, fecha de entrega deseada, etc."
                                    />
                                </div>

                                <div className="mt-8 flex justify-end space-x-4">
                                    <button
                                        onClick={async () => {
                                            try { await axios.delete(`${API_URL}/cart/clear`, { headers: AUTH_HEADER() }); } catch(e) {}
                                            setCart([]);
                                            queryClient.invalidateQueries(['distributor-inventory']);
                                        }}
                                        className="px-8 py-4 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-semibold text-lg transition-all"
                                    >
                                        Vaciar Carrito
                                    </button>
                                    <button
                                        onClick={handleCreateOrder}
                                        disabled={createOrderMutation.isPending}
                                        className="px-10 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
                                    >
                                        {createOrderMutation.isPending ? '⏳ Creando...' : '✅ Crear Pedido'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'orders' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-3xl font-bold text-gray-900">📦 Mis Pedidos</h2>
                            <button
                                onClick={() => setPendingSummaryModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium text-sm"
                                title="Consolidado de pedidos por entregar"
                            >
                                <BarChart3 className="w-4 h-4" />
                                Consolidado Pendientes
                            </button>
                        </div>
                        {myOrders?.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-lg p-16 text-center border border-gray-200">
                                <Package className="mx-auto h-24 w-24 text-gray-300 mb-6" />
                                <p className="text-xl text-gray-500">No tienes pedidos aún</p>
                            </div>
                        ) : (
                            myOrders?.map(order => (
                                <div key={order.id} className="bg-white rounded-2xl shadow-lg p-8 border border-gray-200 hover:shadow-xl transition-all">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}>
                                            <div className={`p-2 rounded-full transition-colors ${expandedOrder === order.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                                {expandedOrder === order.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                                    {order.orderNumber}
                                                    <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                        {order.items.length} productos
                                                    </span>
                                                </h3>
                                                <p className="text-sm text-gray-600">
                                                    {new Date(order.createdAt).toLocaleDateString('es-ES', {
                                                        year: 'numeric',
                                                        month: 'long',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 border-2 ${getStatusColor(order.status)}`}>
                                            {getStatusIcon(order.status)}
                                            {order.status === 'IN_PICKING' ? 'En Alistamiento' : order.status}
                                        </span>
                                    </div>

                                    {/* Picking Progress Bar — visible for IN_PICKING orders */}
                                    {order.status === 'IN_PICKING' && (
                                        <div className="mt-3 p-4 bg-purple-50 rounded-xl border border-purple-200">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-purple-600 font-bold text-sm">📦 Progreso de Alistamiento</span>
                                                    {order.picker?.name && (
                                                        <span className="text-xs text-purple-500 bg-purple-100 px-2 py-0.5 rounded-full">
                                                            por {order.picker.name}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-purple-700 font-black text-lg">{order.pickingProgress || 0}%</span>
                                            </div>
                                            <div className="w-full h-3 bg-purple-200 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-700 ease-out"
                                                    style={{ width: `${order.pickingProgress || 0}%` }}
                                                />
                                            </div>
                                            {/* Per-item picking summary */}
                                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {order.items?.map(item => {
                                                    const scannedQty = (item.pickingItems || []).reduce((sum, pi) => sum + pi.scannedQty, 0);
                                                    const progress = item.requestedQty > 0 ? Math.min(100, Math.round((scannedQty / item.requestedQty) * 100)) : 0;
                                                    const isDone = scannedQty >= item.requestedQty;
                                                    const packSize = item.product?.packSize || 1;
                                                    return (
                                                        <div key={item.id} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${isDone ? 'bg-green-100 border border-green-200' : 'bg-white border border-purple-100'}`}>
                                                            <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isDone ? 'bg-green-500 text-white' : 'bg-purple-200 text-purple-700'}`}>
                                                                {isDone ? '✓' : `${progress}%`}
                                                            </span>
                                                            <span className="flex-1 truncate font-medium text-gray-700">{item.product?.name?.replace(/LIQUIPOPS SABOR A\s*/i, '').replace(/GENIALITY SIROPE\s*/i, '')}</span>
                                                            <span className="text-gray-500 whitespace-nowrap">
                                                                {Math.ceil(scannedQty / packSize)}/{Math.ceil(item.requestedQty / packSize)} cajas
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {expandedOrder === order.id && (
                                        <div className="border-t border-gray-100 pt-4 mt-4 space-y-3 animate-fadeIn">
                                            {order.items.map(item => {
                                                const packSize = item.product.packSize || 1;
                                                const boxes = Math.ceil(item.requestedQty / packSize);
                                                const isBackorder = item.requestedQty > item.qty;

                                                return (
                                                    <div key={item.id} className={`flex flex-col gap-2 text-sm p-3 rounded-lg border ${isBackorder ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-900 font-medium">{item.product.name}</span>
                                                            <div className="text-right">
                                                                <div className="font-bold text-gray-800">
                                                                    {boxes} {boxes === 1 ? 'Caja' : 'Cajas'}
                                                                    <span className="text-xs font-normal text-gray-500 ml-1">
                                                                        (x{packSize} unids/caja)
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-gray-500">
                                                                    Total: {item.requestedQty} unidades
                                                                    {item.allocatedQty > 0 && (
                                                                        <span className="text-green-600 ml-2 font-bold">● {item.allocatedQty} asignadas</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Backorder Warning (same as cart) */}
                                                        {isBackorder && (
                                                            <div className="flex flex-col gap-1 px-2 py-1.5 rounded bg-red-100 border border-red-200 text-red-800 text-[11px]">
                                                                <div className="flex items-center gap-1.5 font-bold">
                                                                    <AlertTriangle className="w-3 h-3 text-red-600" />
                                                                    <span>
                                                                        {item.nextProductionDate
                                                                            ? (item.qty <= 0 ? "Producto en Programación" : "Pedido Excede Stock Disponible")
                                                                            : "Producto Agotado: Pendiente programación"
                                                                        }
                                                                    </span>
                                                                </div>
                                                                {item.nextProductionDate ? (
                                                                    <div className="ml-4 flex items-center gap-2 text-[10px] font-medium text-red-700">
                                                                        <span className="flex items-center gap-1">
                                                                            <Calendar className="w-2.5 h-2.5" />
                                                                            Prod: <strong>{new Date(item.nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</strong>
                                                                        </span>
                                                                        <ArrowRight className="w-2.5 h-2.5 text-red-400" />
                                                                        <span className="flex items-center gap-1">
                                                                            <Package className="w-2.5 h-2.5" />
                                                                            Desp: <strong>{(() => {
                                                                                const d = new Date(item.nextProductionDate);
                                                                                d.setDate(d.getDate() + 1);
                                                                                return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
                                                                            })()}</strong>
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="ml-4 flex items-center gap-1 text-[10px] font-medium text-red-700">
                                                                        <Info className="w-2.5 h-2.5" />
                                                                        <span>Fecha por confirmar</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {order.notes && (
                                        <div className="mt-6 p-4 bg-yellow-50 rounded-xl border-l-4 border-yellow-400">
                                            <p className="text-sm text-yellow-900">
                                                <strong className="font-bold">📝 Notas:</strong> {order.notes}
                                            </p>
                                        </div>
                                    )}

                                    {order.trackingGuide && (
                                        <div className="mt-6 p-4 bg-blue-50 rounded-xl border-l-4 border-blue-400">
                                            <p className="text-sm text-blue-900 font-semibold">
                                                <strong className="font-bold">📍 Guía de rastreo:</strong> {order.trackingGuide}
                                            </p>
                                            {order.dispatchNotes && (
                                                <p className="text-sm text-blue-800 mt-2">{order.dispatchNotes}</p>
                                            )}
                                        </div>
                                    )}

                                    {order.rejectedReason && (
                                        <div className="mt-6 p-4 bg-red-50 rounded-xl border-l-4 border-red-400">
                                            <p className="text-sm text-red-900">
                                                <strong className="font-bold">❌ Razón de rechazo:</strong> {order.rejectedReason}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                {pendingSummaryModal && (() => {
                    const matrix = pendingMatrix;
                    const matrixDetails = pendingMatrixDetails;
                    const orderTotals = pendingOrderTotals;
                    const totalOrders = orderTotals.length;
                    const totalUnits = orderTotals.reduce((sum, o) => sum + o.total, 0);

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

                    return (
                        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}>
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden">
                                <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
                                    <div>
                                        <div className="text-lg font-bold">Consolidado de Pedidos por Entregar</div>
                                        <div className="text-xs text-slate-300">Incluye pedidos no entregados</div>
                                    </div>
                                    <button onClick={() => { setPendingSummaryModal(false); setPendingCellDetail(null); }} className="text-white text-2xl">&times;</button>
                                </div>

                                <div className="p-5 overflow-y-auto max-h-[calc(90vh-120px)]">
                                    {pendingSummaryLoading ? (
                                        <div className="text-sm text-gray-500">Cargando consolidado...</div>
                                    ) : (
                                        <>
                                            <div className="grid grid-cols-3 gap-3 mb-4">
                                                <div className="p-3 rounded-lg bg-gray-50 border">
                                                    <div className="text-xs text-gray-500">Pedidos</div>
                                                    <div className="text-lg font-bold text-gray-900">{totalOrders}</div>
                                                </div>
                                                <div className="p-3 rounded-lg bg-gray-50 border">
                                                    <div className="text-xs text-gray-500">Unidades Totales</div>
                                                    <div className="text-lg font-bold text-gray-900">{totalUnits}</div>
                                                </div>
                                                <div className="p-3 rounded-lg bg-gray-50 border">
                                                    <div className="text-xs text-gray-500">Estados</div>
                                                    <div className="text-sm text-gray-700">
                                                        {(pendingSummary?.meta?.statuses || []).join(', ')}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mb-4 border rounded-xl bg-white">
                                                <div className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-700">Pedidos incluidos</div>
                                                <table className="min-w-full text-xs">
                                                    <thead>
                                                        <tr>
                                                            <th className="p-2 border-b text-left font-bold text-gray-500">Orden</th>
                                                            <th className="p-2 border-b text-left font-bold text-gray-500">Estado</th>
                                                            <th className="p-2 border-b text-right font-bold text-gray-500">Unidades</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {orderTotals.map(o => (
                                                            <tr key={o.id} className="border-b last:border-b-0">
                                                                <td className="p-2 text-gray-700 font-semibold">{o.number}</td>
                                                                <td className="p-2 text-gray-500">{statusLabels[o.status] || o.status}</td>
                                                                <td className="p-2 text-right font-bold text-gray-900">{o.total}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {pendingCellDetail && detailList.length > 0 && (
                                                <div className="mb-4 border rounded-xl bg-white">
                                                    <div className="px-4 py-2 bg-emerald-50 border-b text-sm font-semibold text-emerald-800 flex items-center justify-between">
                                                        <div>
                                                            Detalle por pedido · {pendingCellDetail.brand} · {pendingCellDetail.presentation} · {pendingCellDetail.flavor}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPendingCellDetail(null)}
                                                            className="text-emerald-900 text-lg"
                                                        >
                                                            &times;
                                                        </button>
                                                    </div>
                                                    <table className="min-w-full text-xs">
                                                        <thead>
                                                            <tr>
                                                                <th className="p-2 border-b text-left font-bold text-gray-500">Orden</th>
                                                                <th className="p-2 border-b text-left font-bold text-gray-500">Estado</th>
                                                                <th className="p-2 border-b text-right font-bold text-gray-500">Cantidad</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {detailList.map((row, idx) => (
                                                                <tr key={`${row.orderNumber}-${idx}`} className="border-b last:border-b-0">
                                                                    <td className="p-2 text-gray-700 font-semibold">{row.orderNumber}</td>
                                                                    <td className="p-2 text-gray-500">{statusLabels[row.status] || row.status}</td>
                                                                    <td className="p-2 text-right font-bold text-gray-900">{row.qty}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
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
            </div>
        </div>
    );
}
