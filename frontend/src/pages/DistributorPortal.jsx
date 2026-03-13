import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { io as socketIO } from 'socket.io-client';
import { Search, ShoppingCart, Filter, ChevronDown, ChevronUp, Package, Calendar, CheckCircle, Clock, AlertCircle, TrendingUp, X, ChevronRight, ArrowRight, Menu, LogOut, Download, MapPin, Phone, Mail, User, Shield, Briefcase, Plus, Minus, XCircle, Info, AlertTriangle, Trash2, ShieldAlert } from 'lucide-react';

// Use relative path for API to avoid mixed content/localhost issues in production
const API_URL = `${import.meta.env.VITE_API_URL}/api` || '/api';
const WS_URL = import.meta.env.VITE_API_URL || window.location.origin;
const AUTH_HEADER = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function DistributorPortal() {
    const [activeTab, setActiveTab] = useState('inventory');
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [expandedOrder, setExpandedOrder] = useState(null);
    const [recallDismissed, setRecallDismissed] = useState(false);
    const [cartLoading, setCartLoading] = useState({});
    const queryClient = useQueryClient();
    const socketRef = useRef(null);

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
            alert('✅ Pedido creado exitosamente');
        },
        onError: (error) => {
            alert('❌ ' + (error.response?.data?.error || 'Error al crear pedido'));
        }
    });

    // ═══ CART FUNCTIONS: API-backed ═══
    const addToCart = useCallback(async (product, qty = 1) => {
        const packSize = product.packSize || 1;
        const quantityToAdd = qty * packSize;
        const existing = cart.find(item => item.id === product.id);
        const newTotal = existing ? existing.quantity + quantityToAdd : quantityToAdd;

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
                return [...prev, { ...product, quantity: quantityToAdd }];
            });
            queryClient.invalidateQueries(['distributor-inventory']);

            // Show backorder warning with production date
            if (res.data.backorder) {
                const prodDate = product.nextProductionDate
                    ? new Date(product.nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
                    : null;
                const dateMsg = prodDate
                    ? `\n📅 Próxima producción: ${prodDate}\n⏱️ Disponible aprox. 2 días después de producción.`
                    : '\n⚠️ No hay fecha de producción programada aún.';
                alert(`📦 Pedido en backorder\n\nStock actual insuficiente. Se solicitarán ${res.data.backorderQty} unidades adicionales de próxima producción.${dateMsg}\n\nNota: Pueden presentarse retrasos.`);
            }
        } catch (e) {
            const msg = e.response?.data?.error || 'Error al reservar';
            alert('⚠️ ' + msg);
        } finally {
            setCartLoading(prev => ({ ...prev, [product.id]: false }));
        }
    }, [cart, queryClient]);

    const updateCartQty = useCallback(async (productId, newQty, packSize = 1) => {
        const validQty = Math.max(packSize, newQty);

        setCartLoading(prev => ({ ...prev, [productId]: true }));
        try {
            await axios.post(`${API_URL}/cart/reserve`, {
                productId,
                quantity: validQty
            }, { headers: AUTH_HEADER() });

            setCart(prev => prev.map(item =>
                item.id === productId ? { ...item, quantity: validQty } : item
            ));
            queryClient.invalidateQueries(['distributor-inventory']);
        } catch (e) {
            alert('⚠️ ' + (e.response?.data?.error || 'Error al actualizar'));
        } finally {
            setCartLoading(prev => ({ ...prev, [productId]: false }));
        }
    }, [queryClient]);

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
                        <div className="flex-1 min-w-0">
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
                                                    <tr key={size} className="border-b border-gray-200 last:border-0 hover:bg-gray-50/30 transition-colors duration-200">
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
                                                                <td key={flavor} className="px-1.5 py-1.5">
                                                                    <div className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 min-w-[110px] ${qtyInCart > 0
                                                                        ? 'bg-lime-50 border-lime-400 shadow-md ring-1 ring-lime-200'
                                                                        : 'bg-white border-gray-200 shadow-sm hover:border-purple-300 hover:shadow-md'
                                                                        }`}>
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
                                                                            <div className="flex items-center gap-1 bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 text-[9px] font-bold">
                                                                                <Calendar className="w-2.5 h-2.5" />
                                                                                {new Date(item.products[0].nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                                                            </div>
                                                                        )}

                                                                        {item.products.map(prod => (
                                                                            <button
                                                                                key={prod.id}
                                                                                onClick={() => addToCart(prod)}
                                                                                disabled={cartLoading[prod.id]}
                                                                                className={`w-full flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 px-2 rounded-md transition-all active:scale-95 border ${qtyInCart > 0
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
                                                                            <div className="text-[9px] font-bold text-lime-700 bg-lime-100 px-1.5 py-0.5 rounded-full">
                                                                                🛒 {qtyInCart / packSize} caja{qtyInCart / packSize > 1 ? 's' : ''}
                                                                            </div>
                                                                        )}
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
                                                    <tr key={size} className="border-b border-gray-200 last:border-0 hover:bg-gray-50/30 transition-colors duration-200">
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
                                                                <td key={flavor} className="px-1.5 py-1.5">
                                                                    <div className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 min-w-[110px] ${qtyInCart > 0
                                                                        ? 'bg-lime-50 border-lime-400 shadow-md ring-1 ring-lime-200'
                                                                        : 'bg-white border-gray-200 shadow-sm hover:border-cyan-300 hover:shadow-md'
                                                                        }`}>
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
                                                                            <div className="flex items-center gap-1 bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 text-[9px] font-bold">
                                                                                <Calendar className="w-2.5 h-2.5" />
                                                                                {new Date(item.products[0].nextProductionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                                                            </div>
                                                                        )}

                                                                        {item.products.map(prod => (
                                                                            <button
                                                                                key={prod.id}
                                                                                onClick={() => addToCart(prod)}
                                                                                disabled={cartLoading[prod.id]}
                                                                                className={`w-full flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 px-2 rounded-md transition-all active:scale-95 border ${qtyInCart > 0
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
                                                                            <div className="text-[9px] font-bold text-lime-700 bg-lime-100 px-1.5 py-0.5 rounded-full">
                                                                                🛒 {qtyInCart / packSize} caja{qtyInCart / packSize > 1 ? 's' : ''}
                                                                            </div>
                                                                        )}
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
                                                                        onClick={() => updateCartQty(item.id, item.quantity - packSize, packSize)}
                                                                        className="text-gray-400 hover:text-red-500"
                                                                    >
                                                                        <Minus className="w-3 h-3" />
                                                                    </button>
                                                                    <span className="font-bold text-gray-800 bg-gray-50 px-2 py-0.5 rounded text-xs border border-gray-200">
                                                                        {boxes} Cajas
                                                                    </span>
                                                                    <button
                                                                        onClick={() => updateCartQty(item.id, item.quantity + packSize, packSize)}
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
                                                            onClick={() => updateCartQty(item.id, item.quantity - packSize, packSize)}
                                                            className="text-gray-600 hover:text-red-600 transition-colors"
                                                        >
                                                            <Minus className="w-5 h-5" />
                                                        </button>
                                                        <div className="w-12 text-center font-bold text-xl">
                                                            {boxes}
                                                        </div>
                                                        <button
                                                            onClick={() => updateCartQty(item.id, item.quantity + packSize, packSize)}
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
                        <h2 className="text-3xl font-bold mb-6 text-gray-900">📦 Mis Pedidos</h2>
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
            </div>
        </div>
    );
}
