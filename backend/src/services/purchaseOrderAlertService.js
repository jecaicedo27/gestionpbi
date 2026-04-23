const PROCUREMENT_ALERT_EVENT = 'purchase_order:workflow-alert';
const PROCUREMENT_ALERT_CHANNEL = 'PURCHASE_ORDER_FINANCE';
const PROCUREMENT_ALERT_ROLES = ['CARTERA', 'CONTABILIDAD'];
const PROCUREMENT_ALERT_SCOPE_LABEL = 'COMPRAS';

const ALERT_CONFIG = {
    PAYMENT_PENDING: {
        targetRoles: ['CARTERA'],
        icon: '💳',
        color: '#f97316',
        title: 'Compras | Cartera',
        audienceLabel: 'Solo Cartera',
        actionLabel: 'Ver pago'
    },
    ACCOUNTING_PENDING: {
        targetRoles: ['CONTABILIDAD'],
        icon: '📊',
        color: '#2563eb',
        title: 'Compras | Contabilidad',
        audienceLabel: 'Solo Contabilidad',
        actionLabel: 'Ver contabilización'
    },
    CREDIT_PAYMENT_PENDING: {
        targetRoles: ['CARTERA'],
        icon: '🗓️',
        color: '#7c3aed',
        title: 'Compras | Crédito',
        audienceLabel: 'Solo Cartera',
        actionLabel: 'Ver crédito'
    }
};

const normalizeRole = (role) => String(role || '').trim().toUpperCase();

const canReceivePurchaseOrderAlert = (role, alert) => {
    const normalizedRole = normalizeRole(role);
    if (!PROCUREMENT_ALERT_ROLES.includes(normalizedRole)) return false;
    return (alert.targetRoles || []).map(normalizeRole).includes(normalizedRole);
};

const buildPurchaseOrderWorkflowAlert = (type, order, extra = {}) => {
    const config = ALERT_CONFIG[type];
    if (!config || !order) return null;

    const orderId = order.id || extra.orderId;
    const supplierName = order.supplierName || 'Proveedor sin nombre';
    const messages = {
        PAYMENT_PENDING: `La OC ${order.orderNumber} de ${supplierName} ya está lista para pagar o programar.`,
        ACCOUNTING_PENDING: `La OC ${order.orderNumber} de ${supplierName} ya fue recibida por Logística y está lista para contabilizar.`,
        CREDIT_PAYMENT_PENDING: `La OC ${order.orderNumber} de ${supplierName} quedó completa y pendiente de pago de crédito.`
    };

    const alertTargetId = extra.receptionId || 'ORDER';

    return {
        id: `${type}:${orderId}:${alertTargetId}`,
        eventName: PROCUREMENT_ALERT_EVENT,
        channel: PROCUREMENT_ALERT_CHANNEL,
        scopeLabel: PROCUREMENT_ALERT_SCOPE_LABEL,
        alertFamily: 'PURCHASE_ORDER_FINANCE',
        module: 'PROCUREMENT',
        source: 'PURCHASE_ORDERS',
        type,
        targetRoles: config.targetRoles,
        audienceLabel: config.audienceLabel,
        orderId,
        orderNumber: order.orderNumber,
        supplierName,
        status: order.status || extra.status || null,
        paymentMethod: order.paymentMethod || null,
        creditDueDate: order.creditDueDate || null,
        receptionId: extra.receptionId || null,
        title: config.title,
        message: extra.message || messages[type],
        actionLabel: config.actionLabel,
        icon: config.icon,
        color: config.color,
        url: '/procurement/purchase-orders',
        createdAt: extra.createdAt || new Date()
    };
};

const emitPurchaseOrderWorkflowAlert = (req, alert) => {
    if (!alert) return;
    const io = req.app.get('io');
    if (!io) return;
    io.emit(PROCUREMENT_ALERT_EVENT, alert);
};

module.exports = {
    PROCUREMENT_ALERT_CHANNEL,
    PROCUREMENT_ALERT_EVENT,
    PROCUREMENT_ALERT_ROLES,
    PROCUREMENT_ALERT_SCOPE_LABEL,
    buildPurchaseOrderWorkflowAlert,
    canReceivePurchaseOrderAlert,
    emitPurchaseOrderWorkflowAlert,
    normalizeRole
};
