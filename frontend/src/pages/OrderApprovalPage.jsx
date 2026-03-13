import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { CheckCircle, XCircle, Package, AlertCircle, Calendar, User, Trash2 } from 'lucide-react';

const OrderApprovalPage = () => {
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [showApproveModal, setShowApproveModal] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [removedItems, setRemovedItems] = useState([]);
    const [modifiedQuantities, setModifiedQuantities] = useState({});

    useEffect(() => {
        loadPendingOrders();
    }, []);

    const loadPendingOrders = async () => {
        try {
            setLoading(true);
            const response = await api.get('/orders?status=PENDING');
            setOrders(response.data.data || []);
        } catch (error) {
            console.error('Error loading orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async () => {
        try {
            await api.post(`/orders/${selectedOrder.id}/approve`, {
                removedItems,
                modifiedQuantities
            });
            alert('Pedido aprobado exitosamente');
            setShowApproveModal(false);
            setSelectedOrder(null);
            setRemovedItems([]);
            setModifiedQuantities({});
            loadPendingOrders();
        } catch (error) {
            console.error('Error approving order:', error);
            alert('Error al aprobar el pedido');
        }
    };

    const handleReject = async () => {
        if (!rejectReason.trim()) {
            alert('Debe proporcionar un motivo de rechazo');
            return;
        }

        try {
            await api.post(`/orders/${selectedOrder.id}/reject`, {
                reason: rejectReason
            });
            alert('Pedido rechazado');
            setShowRejectModal(false);
            setSelectedOrder(null);
            setRejectReason('');
            loadPendingOrders();
        } catch (error) {
            console.error('Error rejecting order:', error);
            alert('Error al rechazar el pedido');
        }
    };

    const toggleItemRemoval = (itemId) => {
        setRemovedItems(prev =>
            prev.includes(itemId)
                ? prev.filter(id => id !== itemId)
                : [...prev, itemId]
        );
    };

    const updateQuantity = (itemId, newQty) => {
        if (newQty <= 0) {
            const updated = { ...modifiedQuantities };
            delete updated[itemId];
            setModifiedQuantities(updated);
        } else {
            setModifiedQuantities(prev => ({
                ...prev,
                [itemId]: parseFloat(newQty)
            }));
        }
    };

    if (loading) {
        return <div className="text-center py-8">Cargando pedidos...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold">Aprobación de Pedidos</h1>
                    <p className="text-gray-600 mt-1">Revisa y aprueba pedidos pendientes</p>
                </div>
                <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-blue-600" />
                    <span className="text-blue-900 font-medium">{orders.length} pendientes</span>
                </div>
            </div>

            {orders.length === 0 ? (
                <Card>
                    <div className="text-center py-12 text-gray-400">
                        <Package className="w-16 h-16 mx-auto mb-4 opacity-20" />
                        <p>No hay pedidos pendientes de aprobación</p>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {orders.map(order => (
                        <Card key={order.id}>
                            <div className="space-y-4">
                                {/* Order Header */}
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-lg font-bold">{order.orderNumber}</h3>
                                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                                                PENDIENTE
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                                            <div className="flex items-center gap-1">
                                                <User className="w-4 h-4" />
                                                {order.distributor?.name || 'N/A'}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                {new Date(order.createdAt).toLocaleDateString('es-CO')}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={() => {
                                                setSelectedOrder(order);
                                                setShowApproveModal(true);
                                            }}
                                            icon={CheckCircle}
                                            variant="primary"
                                            size="sm"
                                        >
                                            Aprobar
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setSelectedOrder(order);
                                                setShowRejectModal(true);
                                            }}
                                            icon={XCircle}
                                            variant="secondary"
                                            size="sm"
                                        >
                                            Rechazar
                                        </Button>
                                    </div>
                                </div>

                                {/* Order Items */}
                                <div className="border-t pt-4">
                                    <div className="space-y-2">
                                        {order.items?.map(item => (
                                            <div key={item.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                                                <div className="flex-1">
                                                    <div className="font-medium">{item.product?.name}</div>
                                                    <div className="text-sm text-gray-600">SKU: {item.product?.sku}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold">{item.requestedQty} unidades</div>
                                                    <div className="text-xs text-gray-500">
                                                        {Math.ceil(item.requestedQty / (item.product?.packSize || 1))} cajas
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {order.notes && (
                                    <div className="border-t pt-4">
                                        <div className="text-sm">
                                            <span className="font-medium">Notas:</span>
                                            <p className="text-gray-600 mt-1">{order.notes}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Approve Modal */}
            {showApproveModal && selectedOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">Aprobar Pedido: {selectedOrder.orderNumber}</h2>

                        <div className="space-y-4 mb-6">
                            <p className="text-sm text-gray-600">
                                Puedes modificar cantidades o eliminar productos antes de aprobar.
                            </p>

                            {selectedOrder.items?.map(item => {
                                const isRemoved = removedItems.includes(item.id);
                                const modifiedQty = modifiedQuantities[item.id];
                                const currentQty = modifiedQty !== undefined ? modifiedQty : item.requestedQty;

                                return (
                                    <div
                                        key={item.id}
                                        className={`p-3 border rounded ${isRemoved ? 'bg-red-50 border-red-200 opacity-50' : 'bg-white'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <div className="font-medium">{item.product?.name}</div>
                                                <div className="text-sm text-gray-600">SKU: {item.product?.sku}</div>
                                            </div>

                                            {!isRemoved && (
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <label className="text-sm font-medium">Cantidad:</label>
                                                        <input
                                                            type="number"
                                                            className="w-24 p-2 border rounded text-center"
                                                            value={currentQty}
                                                            onChange={(e) => updateQuantity(item.id, e.target.value)}
                                                            min="1"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <button
                                                onClick={() => toggleItemRemoval(item.id)}
                                                className={`ml-3 p-2 rounded ${isRemoved
                                                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                                        : 'bg-red-100 text-red-600 hover:bg-red-200'
                                                    }`}
                                            >
                                                {isRemoved ? <CheckCircle className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button onClick={() => {
                                setShowApproveModal(false);
                                setRemovedItems([]);
                                setModifiedQuantities({});
                            }} variant="secondary">
                                Cancelar
                            </Button>
                            <Button onClick={handleApprove} icon={CheckCircle}>
                                Confirmar Aprobación
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && selectedOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-xl font-bold mb-4">Rechazar Pedido</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            Pedido: <strong>{selectedOrder.orderNumber}</strong>
                        </p>

                        <div className="mb-6">
                            <label className="block text-sm font-medium mb-2">Motivo de rechazo *</label>
                            <textarea
                                className="w-full p-3 border rounded resize-none"
                                rows="4"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="Explica por qué se rechaza el pedido..."
                            />
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button onClick={() => {
                                setShowRejectModal(false);
                                setRejectReason('');
                            }} variant="secondary">
                                Cancelar
                            </Button>
                            <Button onClick={handleReject} icon={XCircle} variant="primary">
                                Confirmar Rechazo
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderApprovalPage;
