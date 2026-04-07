import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Tag, Space, Typography, Button, Modal, Form, Select, InputNumber, Input, DatePicker, message, Tabs, Descriptions, Timeline, Badge, Spin, Empty, Divider, Progress, Alert, Tooltip, Upload, Image } from 'antd';
import { PlusOutlined, CheckOutlined, SendOutlined, StopOutlined, EyeOutlined, ShoppingCartOutlined, TruckOutlined, DollarOutlined, FilePdfOutlined, InboxOutlined, PrinterOutlined, TagsOutlined, UploadOutlined, DeleteOutlined, PaperClipOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const { Title, Text } = Typography;
const { TextArea } = Input;

const statusColors = {
    DRAFT: 'default',
    PENDING_APPROVAL: 'orange',
    APPROVED: 'green',
    SENT: 'blue',
    PAYMENT_PENDING: 'volcano',
    PAID: 'lime',
    PARTIALLY_RECEIVED: 'purple',
    RECEIVED: 'cyan',
    ACCOUNTING_PENDING: 'gold',
    COMPLETED: 'green',
    CANCELLED: 'red'
};
const statusLabels = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente Aprobación',
    APPROVED: 'Aprobada',
    SENT: 'Enviada',
    PAYMENT_PENDING: 'Pend. Cartera',
    PAID: 'Pagada',
    PARTIALLY_RECEIVED: 'Recepción Parcial',
    RECEIVED: 'Recibida',
    ACCOUNTING_PENDING: 'Pend. Contabilidad',
    COMPLETED: 'Completada',
    CANCELLED: 'Cancelada'
};

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
const extractSiigoPurchaseNumber = (value) => {
    const matches = String(value || '').match(/\d+/g);
    if (!matches || matches.length === 0) return '';
    return String(parseInt(matches[matches.length - 1], 10));
};
const supplierNamesMatch = (left, right) => {
    const a = String(left || '').trim().toUpperCase();
    const b = String(right || '').trim().toUpperCase();
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0];
};
const getSiigoValidationState = (order, requestedCode, syncData) => {
    const requestedNumber = extractSiigoPurchaseNumber(requestedCode);
    const returnedNumber = extractSiigoPurchaseNumber(syncData?.number ?? syncData?.name);
    const exactMatch = !!requestedNumber && !!returnedNumber && requestedNumber === returnedNumber;

    const orderNit = normalizeDigits(order?.supplierNit || order?.supplier?.identification);
    const syncedNit = normalizeDigits(syncData?.supplier?.identification);
    const supplierMatch = syncData
        ? (orderNit && syncedNit
            ? orderNit === syncedNit
            : supplierNamesMatch(order?.supplierName, syncData?.supplier?.name))
        : false;

    return {
        requestedNumber,
        returnedNumber,
        exactMatch,
        supplierMatch,
        isValid: !!syncData && exactMatch && supplierMatch
    };
};

const PurchaseOrdersPage = () => {
    const { user } = useAuth();
    const userRole = (user?.role || '').toUpperCase();
    const isCartera = userRole === 'CARTERA';
    const isContabilidad = userRole === 'CONTABILIDAD';
    const isLogistica = userRole === 'LOGISTICA';
    const isRestrictedRole = isCartera || isContabilidad || isLogistica;
    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
    const [orders, setOrders] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');

    // Create Modal
    const [createVisible, setCreateVisible] = useState(false);
    const [suppliers, setSuppliers] = useState([]);
    const [rawMaterials, setRawMaterials] = useState([]);
    const [loadingSuppliers, setLoadingSuppliers] = useState(false);
    const [syncingSuppliers, setSyncingSuppliers] = useState(false);
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [orderItems, setOrderItems] = useState([]);
    const [expectedDate, setExpectedDate] = useState(null);
    const [notes, setNotes] = useState('');
    const [creating, setCreating] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('CONTADO');
    const [creditDays, setCreditDays] = useState(30);

    // Detail Modal
    const [detailVisible, setDetailVisible] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Reception
    const [receptionMode, setReceptionMode] = useState(false);
    const [receptionPhotos, setReceptionPhotos] = useState([]);  // Local File objects for reception/product
    const [receptionInvoicePhotos, setReceptionInvoicePhotos] = useState([]);  // Local File objects for invoice
    const [receptionItems, setReceptionItems] = useState([]);
    const [receptionObs, setReceptionObs] = useState('');
    const [submittingReception, setSubmittingReception] = useState(false);

    // Accounting
    const [accountingMode, setAccountingMode] = useState(false);
    const [accountingReception, setAccountingReception] = useState(null);
    const [accountingCosts, setAccountingCosts] = useState({});
    const [accountingNotes, setAccountingNotes] = useState('');
    const [providerInvoiceNumber, setProviderInvoiceNumber] = useState('');
    const [providerInvoicePrefix, setProviderInvoicePrefix] = useState('');
    const [supplierTaxConfig, setSupplierTaxConfig] = useState(null);
    const [siigoCompraCode, setSiigoCompraCode] = useState('');
    const [siigoSyncData, setSiigoSyncData] = useState(null);
    const [siigoSyncing, setSiigoSyncing] = useState(false);
    const [submittingAccounting, setSubmittingAccounting] = useState(false);

    // Invoice photo upload (during reception)
    const [uploadingInvoicePhoto, setUploadingInvoicePhoto] = useState(false);
    const [receptionInvoiceUrls, setReceptionInvoiceUrls] = useState([]);

    // Cartera (payment step)
    const [carteraMode, setCarteraMode] = useState(false);
    const [carteraCosts, setCarteraCosts] = useState({});
    const [carteraNotes, setCarteraNotes] = useState('');
    const [submittingCartera, setSubmittingCartera] = useState(false);
    const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false);
    const [carteraTaxes, setCarteraTaxes] = useState({ ivaRate: 0, reteFuenteRate: 0 });

    // Lots
    const [lotModalVisible, setLotModalVisible] = useState(false);
    const [selectedPOItem, setSelectedPOItem] = useState(null);
    const [lotEntries, setLotEntries] = useState([]);
    const [submittingLots, setSubmittingLots] = useState(false);

    // Detail tab control
    const [detailActiveTab, setDetailActiveTab] = useState('info');
    const siigoValidation = getSiigoValidationState(selectedOrder, siigoCompraCode, siigoSyncData);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page: 1, limit: 200 };
            if (statusFilter) params.status = statusFilter;
            const res = await api.get('/procurement/purchase-orders', { params });
            setOrders(res.data.orders);
            setTotal(res.data.total);
        } catch (err) { console.error(err); }
        setLoading(false);
    }, [page, statusFilter]);

    useEffect(() => { loadOrders(); }, [loadOrders]);

    // ── Suppliers & Raw Materials ──
    const loadSuppliers = async () => {
        setLoadingSuppliers(true);
        try { const res = await api.get('/procurement/suppliers'); setSuppliers(res.data); }
        catch (err) { console.error(err); message.error('Error cargando proveedores'); }
        setLoadingSuppliers(false);
    };
    const [packagings, setPackagings] = useState([]);
    const loadRawMaterials = async () => {
        try {
            const [matRes, pkgRes] = await Promise.all([
                api.get('/procurement/raw-materials'),
                api.get('/procurement/packaging')
            ]);
            setRawMaterials(matRes.data);
            setPackagings(pkgRes.data);
        } catch (err) { console.error(err); }
    };
    const openCreate = () => {
        setCreateVisible(true);
        setOrderItems([]); setSelectedSupplier(null); setNotes(''); setExpectedDate(null);
        setPaymentMethod('CONTADO'); setCreditDays(30);
        loadSuppliers(); loadRawMaterials();
    };
    const addItem = () => setOrderItems([...orderItems, { siigoProductCode: '', siigoProductName: '', quantityOrdered: 0, packagingDesc: '', packQty: null, unitsPerPack: null }]);
    const getProductUnit = (sku) => {
        const prod = rawMaterials.find(p => p.sku === sku);
        return prod?.unit || 'unidad';
    };
    const getPackaging = (sku) => packagings.find(p => p.siigoProductCode === sku);
    const updateItem = (index, field, value) => {
        const newItems = [...orderItems];
        newItems[index][field] = value;
        if (field === 'siigoProductCode') {
            const prod = rawMaterials.find(p => p.sku === value);
            if (prod) {
                newItems[index].siigoProductName = prod.name;
                // Auto-fill from product packSize
                if (prod.packSize && prod.packSize > 0) {
                    newItems[index].unitsPerPack = prod.packSize;
                }
            }
        }
        const upp = newItems[index].unitsPerPack;
        if (field === 'quantityOrdered' && upp > 0) {
            newItems[index].packQty = Math.round(((value || 0) / upp) * 100) / 100;
        }
        if (field === 'packQty' && upp > 0) {
            newItems[index].quantityOrdered = Math.round((value || 0) * upp);
        }
        if (field === 'unitsPerPack' && value > 0 && newItems[index].quantityOrdered > 0) {
            newItems[index].packQty = Math.round((newItems[index].quantityOrdered / value) * 100) / 100;
        }
        setOrderItems(newItems);
    };
    const fuzzyFilter = (input, option) => {
        const text = (option?.label || '').toLowerCase();
        return input.toLowerCase().split(/\s+/).every(word => {
            const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
            return new RegExp(pattern).test(text);
        });
    };
    const removeItem = (index) => setOrderItems(orderItems.filter((_, i) => i !== index));

    const createOrder = async () => {
        if (!selectedSupplier || orderItems.length === 0) { message.warning('Selecciona proveedor y al menos 1 producto'); return; }
        if (orderItems.some(i => !i.siigoProductCode || !i.quantityOrdered)) { message.warning('Completa todos los productos'); return; }
        setCreating(true);
        try {
            const supplier = suppliers.find(s => s.id === selectedSupplier);
            const creditDueDate = paymentMethod === 'CREDITO'
                ? new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000).toISOString()
                : null;
            const res = await api.post('/procurement/purchase-orders', {
                supplierId: String(selectedSupplier), supplierName: supplier?.name || '', supplierNit: supplier?.identification || '',
                notes, expectedDate: expectedDate?.toISOString(), items: orderItems,
                paymentMethod, creditDueDate
            });
            message.success('✅ Orden de compra creada');
            setCreateVisible(false); loadOrders();
        } catch (err) { message.error('Error creando orden'); }
        setCreating(false);
    };

    // ── Detail ──
    const viewDetail = async (id) => {
        setDetailVisible(true); setLoadingDetail(true); setDetailActiveTab('info');
        setReceptionMode(false); setAccountingMode(false);
        try {
            const res = await api.get(`/procurement/purchase-orders/${id}`);
            setSelectedOrder(res.data);
            // Init cartera tax fields from supplier config
            setCarteraTaxes({
                ivaRate: res.data.supplier?.ivaRate ?? 0,
                reteFuenteRate: res.data.supplier?.reteFuenteRate ?? 0
            });
            setCarteraCosts({});
            setCarteraNotes(res.data.paymentNotes || '');
        }
        catch (err) { message.error('Error cargando detalle'); }
        setLoadingDetail(false);
    };

    // Refresh without changing active tab
    const refreshDetail = async (id) => {
        try {
            const res = await api.get(`/procurement/purchase-orders/${id}`);
            setSelectedOrder(res.data);
        } catch { }
    };

    // ── Actions ──
    const approveOrder = async (id) => {
        try { await api.put(`/procurement/purchase-orders/${id}/approve`); message.success('✅ Orden aprobada'); loadOrders(); if (selectedOrder?.id === id) viewDetail(id); }
        catch (err) { message.error(err.response?.data?.error || 'Error'); }
    };
    const sendOrder = async (id) => {
        try { await api.put(`/procurement/purchase-orders/${id}/send`); message.success('📨 Orden enviada al proveedor'); loadOrders(); if (selectedOrder?.id === id) viewDetail(id); }
        catch (err) { message.error(err.response?.data?.error || 'Error'); }
    };
    const sendToCartera = async (id) => {
        try { await api.put(`/procurement/purchase-orders/${id}/send-to-cartera`); message.success('💳 Orden enviada a Cartera'); loadOrders(); if (selectedOrder?.id === id) viewDetail(id); }
        catch (err) { message.error(err.response?.data?.error || 'Error subiendo a Cartera. ¿Ya subiste la cotización?'); }
    };
    const cancelOrder = async (id) => {
        Modal.confirm({
            title: '¿Cancelar esta orden?', onOk: async () => {
                try { await api.put(`/procurement/purchase-orders/${id}/cancel`); message.success('Orden cancelada'); loadOrders(); }
                catch (err) { message.error('Error'); }
            }
        });
    };

    // ── Reception ──
    const startReception = () => {
        if (!selectedOrder) return;
        setReceptionItems(selectedOrder.items.map(item => ({
            orderItemId: item.id,
            siigoProductName: item.siigoProductName,
            quantityOrdered: item.quantityOrdered,
            alreadyReceived: item.quantityReceived,
            quantityExpected: item.quantityOrdered - item.quantityReceived,
            quantityReceived: 0,
            discrepancyNote: ''
        })));
        setReceptionObs('');
        setReceptionPhotos([]);
        setReceptionInvoicePhotos([]);
        setReceptionMode(true);
        setDetailActiveTab('receptions');
    };

    const submitReception = async () => {
        if (receptionPhotos.length === 0) { message.warning('Debe tomar al menos una foto de la recepción/producto'); return; }
        if (receptionInvoicePhotos.length === 0) { message.warning('Debe tomar al menos una foto de la factura del proveedor'); return; }
        setSubmittingReception(true);
        try {
            const res = await api.post('/procurement/receptions', {
                purchaseOrderId: selectedOrder.id,
                observations: receptionObs,
                items: receptionItems.map(i => ({
                    orderItemId: i.orderItemId,
                    quantityExpected: i.quantityExpected,
                    quantityReceived: i.quantityReceived,
                    discrepancyNote: i.discrepancyNote || null
                }))
            });
            const receptionId = res.data.id;
            // Upload reception/product photos
            if (receptionPhotos.length > 0) {
                const fd = new FormData(); receptionPhotos.forEach(f => fd.append('files', f));
                await api.post(`/procurement/receptions/${receptionId}/reception-photos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            }
            // Upload invoice photos
            if (receptionInvoicePhotos.length > 0) {
                const fd = new FormData(); receptionInvoicePhotos.forEach(f => fd.append('files', f));
                await api.post(`/procurement/receptions/${receptionId}/invoice-photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            }
            message.success('📦 Recepción registrada con fotos');
            setReceptionMode(false);
            viewDetail(selectedOrder.id);
            loadOrders();
        } catch (err) { message.error(err.response?.data?.error || 'Error registrando recepción'); }
        setSubmittingReception(false);
    };

    // ── Invoice Photo Upload (during/after reception) ──
    const uploadInvoicePhoto = async (receptionId, files) => {
        if (!files?.length) return;
        setUploadingInvoicePhoto(true);
        try {
            const formData = new FormData();
            Array.from(files).forEach(f => formData.append('files', f));
            const res = await api.post(`/procurement/receptions/${receptionId}/invoice-photo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setReceptionInvoiceUrls(res.data.invoiceImageUrls || []);
            message.success('📸 Foto de factura subida');
            viewDetail(selectedOrder.id); // refresh
        } catch (err) { message.error('Error subiendo foto'); }
        setUploadingInvoicePhoto(false);
    };

    const deleteInvoicePhoto = async (receptionId, url) => {
        try {
            const res = await api.delete(`/procurement/receptions/${receptionId}/invoice-photo`, { data: { url } });
            setReceptionInvoiceUrls(res.data.invoiceImageUrls || []);
            viewDetail(selectedOrder.id);
        } catch (err) { message.error('Error eliminando foto'); }
    };

    // ── Accounting ──
    const startAccounting = async (reception) => {
        setAccountingMode(true);
        setAccountingReception(reception);
        setAccountingNotes('');
        setProviderInvoiceNumber(''); setProviderInvoicePrefix(''); setSiigoCompraCode(''); setSiigoSyncData(null);

        // Initialize costs from what Cartera already paid (unitCost stored in order items)
        const costs = {};
        (reception.items || []).forEach(ri => {
            const orderItem = selectedOrder?.items?.find(oi => oi.id === ri.orderItemId);
            const unitCostPerKg = orderItem?.unitCost || 0;
            const kgs = (ri.quantityReceived || 0) / 1000;
            // Back-calculate totalPay from unitCost * kgs, then apply tax factor
            const subtotal = unitCostPerKg * kgs;
            costs[ri.orderItemId] = { totalPay: subtotal };
        });
        setAccountingCosts(costs);

        // Fetch supplier tax config
        if (selectedOrder?.supplierDbId) {
            try {
                const res = await api.get(`/procurement/suppliers/${selectedOrder.supplierDbId}/tax-config`);
                setSupplierTaxConfig(res.data);
            } catch { setSupplierTaxConfig({ ivaRate: 19, reteFuenteRate: 2.5, paymentTermDays: 30 }); }
        } else {
            setSupplierTaxConfig({ ivaRate: 19, reteFuenteRate: 2.5, paymentTermDays: 30 });
        }
    };

    const submitAccounting = async () => {
        if (!siigoValidation.isValid) {
            message.error('La compra sincronizada de Siigo no coincide exactamente con la OC o con el proveedor.');
            return;
        }

        setSubmittingAccounting(true);
        try {
            const res = await api.put(`/procurement/receptions/${accountingReception.id}/validate`, {
                accountingNotes,
                itemCosts: accountingCosts,
                providerInvoiceNumber,
                providerInvoicePrefix,
                siigoCompraCode,
                siigoSyncData: siigoSyncData || null // Save synced Siigo data for audit
            });
            message.success('✅ Recepción validada contablemente');
            setAccountingMode(false);
            viewDetail(selectedOrder.id);
            loadOrders();
        } catch (err) { message.error(err.response?.data?.error || 'Error validando'); }
        setSubmittingAccounting(false);
    };

    // ── Lots ──
    const openLotModal = (poItem) => {
        setSelectedPOItem(poItem);
        const received = poItem.quantityReceived || 0;
        setLotEntries([{
            lotNumber: '',
            quantity: 0,
            expiresAt: null
        }]);
        setLotModalVisible(true);
    };

    const addLotEntry = () => {
        const n = lotEntries.length + 1;
        setLotEntries([...lotEntries, {
            lotNumber: '',
            quantity: 0, expiresAt: null
        }]);
    };

    const updateLotEntry = (idx, field, value) => {
        const updated = [...lotEntries];
        updated[idx][field] = value;
        setLotEntries(updated);
    };

    const submitLots = async () => {
        if (lotEntries.some(l => !l.lotNumber || !l.quantity)) { message.warning('Completa número de lote y cantidad'); return; }
        setSubmittingLots(true);
        try {
            await api.post('/procurement/lots', {
                purchaseOrderItemId: selectedPOItem.id,
                lots: lotEntries.map(l => ({
                    lotNumber: l.lotNumber,
                    quantity: l.quantity,
                    expiresAt: l.expiresAtRaw || null
                }))
            });
            message.success(`🏷️ ${lotEntries.length} lote(s) creados`);
            setLotModalVisible(false);
            viewDetail(selectedOrder.id);
        } catch (err) { message.error(err.response?.data?.error || 'Error creando lotes'); }
        setSubmittingLots(false);
    };

    const printLotLabel = (lot) => {
        const token = localStorage.getItem('token');
        window.open(`/api/procurement/lots/${lot.id}/label?token=${token}`, '_blank');
    };

    // ── Quotation Upload ──
    const [uploadingQuotation, setUploadingQuotation] = useState(false);
    const quotationDropRef = useRef(null);

    const uploadQuotationFiles = async (files) => {
        if (!selectedOrder || files.length === 0) return;
        setUploadingQuotation(true);
        try {
            const fd = new FormData();
            Array.from(files).forEach(f => fd.append('files', f));
            const res = await api.post(`/procurement/purchase-orders/${selectedOrder.id}/quotation`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setSelectedOrder(prev => ({ ...prev, quotationUrls: res.data.quotationUrls }));
            message.success(`📎 ${files.length} archivo(s) subido(s)`);
        } catch (err) { message.error('Error subiendo cotización'); }
        setUploadingQuotation(false);
    };

    const deleteQuotationFile = async (url) => {
        if (!selectedOrder) return;
        try {
            const res = await api.delete(`/procurement/purchase-orders/${selectedOrder.id}/quotation`, { data: { url } });
            setSelectedOrder(prev => ({ ...prev, quotationUrls: res.data.quotationUrls }));
            message.success('Archivo eliminado');
        } catch (err) { message.error('Error eliminando archivo'); }
    };

    // Paste listener for quotation tab ONLY
    useEffect(() => {
        const handler = (e) => {
            if (!detailVisible || !selectedOrder) return;
            if (detailActiveTab !== 'quotation') return; // Only handle paste in quotation tab
            const items = e.clipboardData?.items;
            if (!items) return;
            const files = [];
            for (const item of items) {
                if (item.kind === 'file') files.push(item.getAsFile());
            }
            if (files.length > 0) {
                e.preventDefault();
                uploadQuotationFiles(files);
            }
        };
        window.addEventListener('paste', handler);
        return () => window.removeEventListener('paste', handler);
    }, [detailVisible, selectedOrder, detailActiveTab]);

    // ── Table Columns ──
    const columns = [
        {
            title: 'N° Orden', dataIndex: 'orderNumber', key: 'orderNumber', width: 140,
            render: (v, r) => <Button type="link" onClick={() => viewDetail(r.id)}>{v}</Button>
        },
        { title: 'Proveedor', dataIndex: 'supplierName', key: 'supplier', ellipsis: true },
        {
            title: 'Estado', dataIndex: 'status', key: 'status', width: 170,
            render: (v, r) => {
                if (v === 'COMPLETED' && r.items?.some(i => !i.lots || i.lots.length === 0)) {
                    return <Tag color="orange">🏷️ Pendiente Loteo</Tag>;
                }
                const isCredit = r.paymentMethod === 'CREDITO';
                const creditBadge = isCredit && !r.creditPaid
                    ? <Tag color="blue" style={{ marginLeft: 2, fontSize: 10 }}>🏦</Tag>
                    : isCredit && r.creditPaid
                        ? <Tag color="green" style={{ marginLeft: 2, fontSize: 10 }}>🏦✓</Tag>
                        : null;
                return <>{<Tag color={statusColors[v]}>{statusLabels[v]}</Tag>}{creditBadge}</>;
            }
        },
        {
            title: '📦', key: 'items', width: 60, align: 'center',
            render: (_, r) => <Badge count={r.items?.length || 0} style={{ backgroundColor: '#722ed1' }} />
        },
        {
            title: 'Creado', dataIndex: 'createdAt', key: 'date', width: 100,
            render: (v) => dayjs(v).format('DD/MM/YY')
        },
        { title: 'Creado por', key: 'creator', width: 130, render: (_, r) => r.createdBy?.name },
        {
            title: 'Acciones', key: 'actions', width: 180,
            render: (_, r) => {
                const isCreditPO = r.paymentMethod === 'CREDITO';
                const actionMap = {
                    DRAFT: { label: 'Ver', icon: <EyeOutlined />, tab: 'info' },
                    PENDING_APPROVAL: isRestrictedRole
                        ? { label: 'Ver', icon: <EyeOutlined />, tab: 'info' }
                        : { label: 'Aprobar', icon: <CheckOutlined />, tab: 'info', type: 'primary' },
                    APPROVED: isRestrictedRole
                        ? { label: 'Ver', icon: <EyeOutlined />, tab: 'info' }
                        : { label: 'Enviar', icon: <SendOutlined />, tab: 'info' },
                    SENT: (isLogistica && isCreditPO)
                        ? { label: '📦 Recepcionar', icon: <InboxOutlined />, tab: 'info', style: { background: '#722ed1', borderColor: '#722ed1', color: '#fff' } }
                        : isRestrictedRole
                            ? { label: 'Ver', icon: <EyeOutlined />, tab: 'info' }
                            : isCreditPO
                                ? { label: '📦 Recibir', icon: <InboxOutlined />, tab: 'info', style: { background: '#722ed1', borderColor: '#722ed1', color: '#fff' } }
                                : { label: '📎 Cotización', icon: null, tab: 'quotation', style: { background: '#13c2c2', borderColor: '#13c2c2', color: '#fff' } },
                    PAYMENT_PENDING: isCartera
                        ? { label: '💳 Pagar', icon: null, tab: 'cartera', style: { background: '#fa541c', borderColor: '#fa541c', color: '#fff' } }
                        : isRestrictedRole
                            ? { label: 'Ver', icon: <EyeOutlined />, tab: 'info' }
                            : { label: '💳 Pagar', icon: null, tab: 'cartera', style: { background: '#fa541c', borderColor: '#fa541c', color: '#fff' } },
                    PAID: (isLogistica || isAdmin || (!isRestrictedRole))
                        ? { label: '📦 Recibir', icon: <InboxOutlined />, tab: 'info', style: { background: '#722ed1', borderColor: '#722ed1', color: '#fff' } }
                        : { label: 'Ver', icon: <EyeOutlined />, tab: 'info' },
                    PARTIALLY_RECEIVED: (isLogistica || isAdmin || (!isRestrictedRole))
                        ? { label: '📦 Recibir', icon: <InboxOutlined />, tab: 'info', style: { background: '#722ed1', borderColor: '#722ed1', color: '#fff' } }
                        : { label: 'Ver', icon: <EyeOutlined />, tab: 'info' },
                    ACCOUNTING_PENDING: isContabilidad
                        ? { label: '📊 Contabilizar', icon: null, tab: 'accounting', style: { background: '#d4b106', borderColor: '#d4b106', color: '#fff' } }
                        : isLogistica
                            ? { label: '⏳ En Contabilidad', icon: <EyeOutlined />, tab: 'receptions' }
                            : (isAdmin || !isRestrictedRole)
                                ? { label: '📊 Contabilizar', icon: null, tab: 'accounting', style: { background: '#d4b106', borderColor: '#d4b106', color: '#fff' } }
                                : { label: 'Ver', icon: <EyeOutlined />, tab: 'info' },
                    COMPLETED: (() => {
                        // Credit PO not yet paid — Cartera action
                        if (isCreditPO && !r.creditPaid && isCartera) {
                            return { label: '🏦 Pagar Crédito', icon: null, tab: 'cartera', style: { background: '#1677ff', borderColor: '#1677ff', color: '#fff' } };
                        }
                        const hasSiigo = r.receptions?.length > 0 && r.receptions.every(rec => rec.siigoRef);
                        const missingLots = r.items?.some(i => !i.lots || i.lots.length === 0);
                        if (hasSiigo && missingLots) {
                            return { label: '🏷️ Lotear', icon: <TagsOutlined />, tab: 'lots', type: 'primary', style: { background: '#fa8c16', borderColor: '#fa8c16', color: '#fff' } };
                        }
                        if (!hasSiigo && missingLots) {
                            return { label: '⏳ Pendiente Siigo', icon: <EyeOutlined />, tab: 'info' };
                        }
                        return { label: '✅ Ver', icon: <EyeOutlined />, tab: 'info' };
                    })(),
                    CANCELLED: { label: 'Ver', icon: <EyeOutlined />, tab: 'info' },
                };
                const action = actionMap[r.status] || { label: 'Ver', icon: <EyeOutlined />, tab: 'info' };
                const hasSiigoInvoice = r.receptions?.length > 0 && r.receptions.every(rec => rec.siigoRef);
                const needsLots = r.status === 'COMPLETED' && hasSiigoInvoice && r.items?.some(i => (i.quantityReceived || 0) > 0 && (!i.lots || i.lots.length === 0));
                return (
                    <Space size="small">
                        {(!isRestrictedRole || isLogistica) && needsLots && (
                            <Button size="small" style={{ background: '#13c2c2', borderColor: '#13c2c2', color: '#fff' }}
                                onClick={() => { viewDetail(r.id); setTimeout(() => setDetailActiveTab('lots'), 100); }}>
                                🏷️ Lotes
                            </Button>
                        )}
                        <Button size="small" type={action.type || 'default'} icon={action.icon} style={action.style || {}}
                            onClick={() => { viewDetail(r.id); setTimeout(() => setDetailActiveTab(action.tab), 100); }}>
                            {action.label}
                        </Button>
                        {!isRestrictedRole && !['COMPLETED', 'CANCELLED'].includes(r.status) && <Button size="small" danger icon={<StopOutlined />} onClick={() => cancelOrder(r.id)} />}
                    </Space>
                );
            }
        }
    ];
    // ── Role-based Pending vs History split ──
    const pendingStatuses = isCartera
        ? ['PAYMENT_PENDING', 'SENT', 'PARTIALLY_RECEIVED', 'ACCOUNTING_PENDING', 'COMPLETED']
        : isContabilidad
            ? ['ACCOUNTING_PENDING']
            : isLogistica
                ? ['SENT', 'PAID', 'PARTIALLY_RECEIVED', 'ACCOUNTING_PENDING', 'COMPLETED']
                : ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PAYMENT_PENDING', 'PAID', 'PARTIALLY_RECEIVED', 'RECEIVED', 'ACCOUNTING_PENDING', 'COMPLETED'];
    const historyStatuses = ['COMPLETED', 'CANCELLED'];

    const [viewTab, setViewTab] = useState('pending');

    // COMPLETED orders stay in Pendientes until ALL items have lots registered (only for roles that manage lots)
    const needsLots = (order) => order.items?.some(item => !item.lots || item.lots.length === 0);
    const lotsRelevant = !isContabilidad && !isCartera; // Only ADMIN/PRODUCCION/LOGISTICA care about lots
    const pendingOrders = orders.filter(o => {
        // Cartera: also show credit POs that haven't been paid yet
        if (isCartera) {
            if (o.status === 'PAYMENT_PENDING') return true;
            if (o.paymentMethod === 'CREDITO' && !o.creditPaid) return true;
            return false;
        }
        // Logística: SENT credit POs are actionable (can receive directly)
        if (isLogistica && o.status === 'SENT' && o.paymentMethod !== 'CREDITO') return false;
        if (!pendingStatuses.includes(o.status)) return false;
        // COMPLETED orders only pending if lots are missing (only for lot-relevant roles)
        if (o.status === 'COMPLETED' && lotsRelevant && !needsLots(o)) return false;
        return true;
    });
    const historyOrders = orders.filter(o => {
        if (o.status === 'CANCELLED') return true;
        // For CONTABILIDAD/CARTERA: all COMPLETED go to history
        // For others: only COMPLETED with lots assigned
        if (o.status === 'COMPLETED') return lotsRelevant ? !needsLots(o) : true;
        return false;
    });
    const displayOrders = viewTab === 'pending' ? pendingOrders : historyOrders;

    // Visible status options for dropdown filter
    const visibleStatusOptions = viewTab === 'pending' ? pendingStatuses : historyStatuses;

    // ── Table Columns (responsive) ──
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const responsiveColumns = columns.filter(c => {
        if (isMobile && ['items', 'creator', 'date'].includes(c.key)) return false;
        // For restricted roles (logística, cartera, contabilidad), show only essential columns
        if (isRestrictedRole && ['items', 'creator', 'date'].includes(c.key)) return false;
        return true;
    });

    // ── Render ──
    return (
        <>
        <style>{`
            .po-page { padding: 24px; }
            .po-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; }
            .po-header-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
            .po-tabs { display: flex; gap: 0; margin-bottom: 16px; }
            .po-tab { flex: 1; padding: 14px 20px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 700;
                      transition: all .2s; border-radius: 8px 8px 0 0; min-height: 48px; display: flex;
                      align-items: center; justify-content: center; gap: 8px; }
            .po-badge { padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 800; }
            @media (max-width: 900px) {
                .po-page { padding: 12px; }
                .po-header { flex-direction: column; }
                .po-header-actions { width: 100%; }
                .po-header-actions .ant-select { flex: 1; }
                .po-header h2 { font-size: 1.2rem !important; }
                .ant-table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
                .ant-table { min-width: 600px; }
                .po-tab { padding: 12px 8px; font-size: 0.82rem; }
            }
            @media (max-width: 600px) {
                .po-page { padding: 8px; }
                .po-header h2 { font-size: 1rem !important; }
                .po-tab { font-size: 0.78rem; padding: 10px 6px; }
            }
        `}</style>
        <div className="po-page">
            <div className="po-header">
                <div>
                    <Title level={2} style={{ margin: 0 }}>🛒 Órdenes de Compra</Title>
                    <Text type="secondary">
                        {isCartera ? 'Gestión de pagos a proveedores' : isContabilidad ? 'Validación contable de recepciones' : isLogistica ? 'Recepción de mercancía' : 'Gestión completa: compra → recepción → lotes → contabilidad'}
                    </Text>
                </div>
                <div className="po-header-actions">
                    <Select placeholder="Filtrar estado" allowClear style={{ width: 200 }}
                        value={statusFilter || undefined} onChange={v => { setStatusFilter(v || ''); setPage(1); }}>
                        {Object.entries(statusLabels)
                            .filter(([k]) => visibleStatusOptions.includes(k))
                            .map(([k, v]) => <Select.Option key={k} value={k}>{v}</Select.Option>)}
                    </Select>
                    {!isRestrictedRole && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Nueva OC</Button>}
                </div>
            </div>

            {/* Tab switcher */}
            <div className="po-tabs">
                <button className="po-tab"
                    onClick={() => { setViewTab('pending'); setPage(1); setStatusFilter(''); }}
                    style={{
                        borderBottom: viewTab === 'pending' ? '3px solid #4f46e5' : '3px solid #e2e8f0',
                        background: viewTab === 'pending' ? '#eef2ff' : '#fff',
                        color: viewTab === 'pending' ? '#4f46e5' : '#64748b',
                    }}
                >
                    📋 Pendientes
                    {pendingOrders.length > 0 && (
                        <span className="po-badge" style={{
                            background: viewTab === 'pending' ? '#4f46e5' : '#e2e8f0',
                            color: viewTab === 'pending' ? '#fff' : '#64748b',
                        }}>{pendingOrders.length}</span>
                    )}
                </button>
                <button className="po-tab"
                    onClick={() => { setViewTab('history'); setPage(1); setStatusFilter(''); }}
                    style={{
                        borderBottom: viewTab === 'history' ? '3px solid #16a34a' : '3px solid #e2e8f0',
                        background: viewTab === 'history' ? '#f0fdf4' : '#fff',
                        color: viewTab === 'history' ? '#16a34a' : '#64748b',
                    }}
                >
                    ✅ Historial
                    {historyOrders.length > 0 && (
                        <span className="po-badge" style={{
                            background: viewTab === 'history' ? '#16a34a' : '#e2e8f0',
                            color: viewTab === 'history' ? '#fff' : '#64748b',
                        }}>{historyOrders.length}</span>
                    )}
                </button>
            </div>

            <Card bordered={false} bodyStyle={{ padding: isMobile ? 8 : 24 }}>
                <Table columns={responsiveColumns} dataSource={displayOrders} rowKey="id" loading={loading} size="small"
                    scroll={isRestrictedRole ? undefined : { x: 600 }}
                    pagination={{ current: page, total: displayOrders.length, pageSize: 20, onChange: (p) => setPage(p), showTotal: (t) => `${t} órdenes` }} />
            </Card>

            {/* ══════ CREATE MODAL ══════ */}
            <Modal title="Nueva Orden de Compra" open={createVisible} onCancel={() => setCreateVisible(false)}
                onOk={createOrder} confirmLoading={creating} width={900} okText="Crear Orden">
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text strong>Proveedor:</Text>
                            <Button size="small" icon={<SyncOutlined />} type="link"
                                loading={syncingSuppliers}
                                onClick={async () => {
                                    setSyncingSuppliers(true);
                                    try {
                                        const res = await api.post('/procurement/suppliers/sync');
                                        message.success(`✅ ${res.data.synced} proveedores sincronizados desde Siigo`);
                                        await loadSuppliers();
                                    } catch (err) {
                                        const msg = err.response?.data?.error || 'Error sincronizando proveedores';
                                        message.warning(`⚠️ ${msg}`);
                                    }
                                    setSyncingSuppliers(false);
                                }}>Sincronizar con Siigo</Button>
                        </div>
                        <Select showSearch placeholder="Buscar proveedor..." loading={loadingSuppliers}
                            style={{ width: '100%', marginTop: 4 }} value={selectedSupplier} onChange={setSelectedSupplier}
                            filterOption={fuzzyFilter}
                            options={suppliers.map(s => ({ value: s.id, label: `${s.name} ${s.identification ? `(${s.identification})` : ''}` }))} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <Text strong>Tipo de Pago:</Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <Button type={paymentMethod === 'CONTADO' ? 'primary' : 'default'}
                                onClick={() => setPaymentMethod('CONTADO')}
                                style={paymentMethod === 'CONTADO' ? { background: '#52c41a', borderColor: '#52c41a' } : {}}
                            >💵 Contado</Button>
                            <Button type={paymentMethod === 'CREDITO' ? 'primary' : 'default'}
                                onClick={() => setPaymentMethod('CREDITO')}
                                style={paymentMethod === 'CREDITO' ? { background: '#1677ff', borderColor: '#1677ff' } : {}}
                            >🏦 Crédito</Button>
                            {paymentMethod === 'CREDITO' && (
                                <InputNumber min={1} max={180} value={creditDays} onChange={v => setCreditDays(v || 30)}
                                    addonAfter="días" style={{ width: 140 }} />
                            )}
                        </div>
                        {paymentMethod === 'CREDITO' && (
                            <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                                🏦 La mercancía se recibe sin pago previo. Cartera paga después.
                            </Text>
                        )}
                    </div>
                    <Divider style={{ margin: '8px 0' }}>Productos</Divider>
                    {/* Column headers */}
                    <div style={{ display: 'flex', gap: 8, padding: '0 8px', marginBottom: 4 }}>
                        <Text strong style={{ flex: 3, fontSize: 12 }}>Producto</Text>
                        <Text strong style={{ flex: 1, fontSize: 12 }}>Cantidad</Text>
                        <Text strong style={{ flex: 0.7, fontSize: 12 }}>Packs</Text>
                        <div style={{ width: 32 }}></div>
                    </div>
                    {orderItems.map((item, idx) => {
                        const unit = item.siigoProductCode ? getProductUnit(item.siigoProductCode) : 'unidad';
                        const unitLabel = unit === 'gramo' ? 'g' : 'und';
                        return (
                            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fafafa', padding: 8, borderRadius: 6, marginBottom: 4 }}>
                                <Select showSearch placeholder="Buscar MP..." style={{ flex: 3 }}
                                    value={item.siigoProductCode || undefined} onChange={v => updateItem(idx, 'siigoProductCode', v)}
                                    filterOption={fuzzyFilter}
                                    options={rawMaterials.map(p => ({ value: p.sku, label: `${p.name} (${p.sku})` }))} />
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <InputNumber placeholder="Cantidad" style={{ width: '100%' }} min={1}
                                        value={item.quantityOrdered || undefined} onChange={v => updateItem(idx, 'quantityOrdered', v)}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        addonAfter={unitLabel} />
                                    {unit === 'gramo' && item.quantityOrdered > 0 && (
                                        <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
                                            = <strong>{(item.quantityOrdered / 1000).toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg</strong>
                                        </Text>
                                    )}
                                </div>
                                <div style={{ flex: 0.7, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <InputNumber placeholder="Packs" style={{ width: '100%' }} min={0} step={0.5}
                                        value={item.packQty ?? undefined}
                                        onChange={v => updateItem(idx, 'packQty', v)}
                                        disabled={!item.unitsPerPack} />
                                    {item.unitsPerPack > 0 && (
                                        <Text type="secondary" style={{ fontSize: 10, textAlign: 'center', color: '#8c8c8c' }}>
                                            ×{item.unitsPerPack} {unitLabel}/pack
                                        </Text>
                                    )}
                                </div>
                                <Button danger size="small" onClick={() => removeItem(idx)} style={{ marginTop: 4 }}>×</Button>
                            </div>
                        );
                    })}
                    <Button type="dashed" icon={<PlusOutlined />} onClick={addItem} block>Agregar Producto</Button>
                </Space>
            </Modal>

            {/* ══════ DETAIL MODAL ══════ */}
            <Modal title={`Orden ${selectedOrder?.orderNumber || ''}`} open={detailVisible}
                onCancel={() => setDetailVisible(false)} footer={null} width={900}>
                {loadingDetail ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : selectedOrder ? (<>
                    <Tabs activeKey={detailActiveTab} onChange={setDetailActiveTab}>
                        {/* ── TAB: Info General ── */}
                        <Tabs.TabPane tab="📋 Info" key="info">
                            <Descriptions bordered size="small" column={2}>
                                <Descriptions.Item label="N° Orden">{selectedOrder.orderNumber}</Descriptions.Item>
                                <Descriptions.Item label="Estado"><Tag color={statusColors[selectedOrder.status]}>{statusLabels[selectedOrder.status]}</Tag></Descriptions.Item>
                                <Descriptions.Item label="Proveedor">{selectedOrder.supplierName}</Descriptions.Item>
                                <Descriptions.Item label="NIT">{selectedOrder.supplierNit || '-'}</Descriptions.Item>
                                <Descriptions.Item label="Creado por">{selectedOrder.createdBy?.name}</Descriptions.Item>
                                <Descriptions.Item label="Fecha">{dayjs(selectedOrder.createdAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
                                <Descriptions.Item label="Pago">
                                    {selectedOrder.paymentMethod === 'CREDITO'
                                        ? <Tag color="blue">🏦 Crédito{selectedOrder.creditDueDate ? ` — vence ${dayjs(selectedOrder.creditDueDate).format('DD/MM/YY')}` : ''}{selectedOrder.creditPaid ? ' ✅ Pagado' : ''}</Tag>
                                        : <Tag color="green">💵 Contado</Tag>
                                    }
                                </Descriptions.Item>
                                {selectedOrder.approvedBy && <Descriptions.Item label="Aprobado por">{selectedOrder.approvedBy?.name} — {dayjs(selectedOrder.approvedAt).format('DD/MM/YY')}</Descriptions.Item>}
                                {selectedOrder.notes && <Descriptions.Item label="Notas" span={2}>{selectedOrder.notes}</Descriptions.Item>}
                            </Descriptions>

                            <Title level={5} style={{ marginTop: 16 }}>Productos:</Title>
                            <Table dataSource={selectedOrder.items} rowKey="id" size="small" pagination={false}
                                columns={[
                                    { title: 'SKU', dataIndex: 'siigoProductCode', width: 100 },
                                    { title: 'Producto', dataIndex: 'siigoProductName' },
                                    { title: 'Pedido', dataIndex: 'quantityOrdered', align: 'right', render: v => v?.toLocaleString() },
                                    { title: 'Recibido', dataIndex: 'quantityReceived', align: 'right', render: v => v?.toLocaleString() },
                                    {
                                        title: '% Recib.', key: 'pct', align: 'center', width: 110,
                                        render: (_, r) => {
                                            const pct = r.quantityOrdered > 0 ? Math.round((r.quantityReceived / r.quantityOrdered) * 100) : 0;
                                            return <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />;
                                        }
                                    },
                                    {
                                        title: 'Lotes', key: 'lots', width: 80, align: 'center',
                                        render: (_, r) => (
                                            <Tooltip title="Crear lotes">
                                                <Button size="small" icon={<TagsOutlined />} onClick={() => openLotModal(r)}
                                                    disabled={r.quantityReceived === 0}>
                                                    {r.lots?.length || 0}
                                                </Button>
                                            </Tooltip>
                                        )
                                    }
                                ]} />

                            <Space style={{ marginTop: 16 }} wrap>
                                <Button type="primary" icon={<FilePdfOutlined />}
                                    onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/procurement/purchase-orders/${selectedOrder.id}/pdf?token=${token}`, '_blank'); }}>
                                    Descargar PDF
                                </Button>
                                {!isRestrictedRole && selectedOrder.status === 'PENDING_APPROVAL' && (
                                    <Button type="primary" icon={<CheckOutlined />} onClick={() => approveOrder(selectedOrder.id)}>Aprobar</Button>
                                )}
                                {!isRestrictedRole && selectedOrder.status === 'APPROVED' && (
                                    <Button icon={<SendOutlined />} onClick={() => sendOrder(selectedOrder.id)}>Enviar al Proveedor</Button>
                                )}
                                {!isRestrictedRole && selectedOrder.status === 'SENT' && selectedOrder.paymentMethod !== 'CREDITO' && (
                                    selectedOrder.quotationUrls?.length > 0
                                        ? <Button type="primary" style={{ background: '#13c2c2' }} onClick={() => sendToCartera(selectedOrder.id)}>💳 Enviar a Cartera</Button>
                                        : <Button disabled>💳 Enviar a Cartera (sube cotización primero)</Button>
                                )}
                                {(isLogistica || isAdmin || (!isRestrictedRole)) && (
                                    ['PAID', 'PARTIALLY_RECEIVED'].includes(selectedOrder.status) ||
                                    (selectedOrder.status === 'SENT' && selectedOrder.paymentMethod === 'CREDITO')
                                ) && (
                                    <Button type="primary" style={{ background: '#722ed1' }} icon={<InboxOutlined />} onClick={startReception}>
                                        Registrar Recepción
                                    </Button>
                                )}
                            </Space>
                        </Tabs.TabPane>

                        {/* ── TAB: Reception ── */}
                        <Tabs.TabPane tab={`📦 Recepciones (${selectedOrder.receptions?.length || 0})`} key="receptions">
                            {receptionMode ? (
                                <div>
                                    <Alert message="Registrando recepción de mercancía" type="info" showIcon style={{ marginBottom: 16 }} />
                                    <Table dataSource={receptionItems} rowKey="orderItemId" size="small" pagination={false}
                                        columns={[
                                            { title: 'Producto', dataIndex: 'siigoProductName' },
                                            {
                                                title: 'Pedido', dataIndex: 'quantityOrdered', width: 120, align: 'right', render: v => (
                                                    <div>
                                                        <div>{v?.toLocaleString()} g</div>
                                                        <div style={{ fontSize: 11, color: '#1890ff' }}>{(v / 1000).toFixed(2)} kg</div>
                                                    </div>
                                                )
                                            },
                                            {
                                                title: 'Ya recibido', dataIndex: 'alreadyReceived', width: 110, align: 'right', render: v => (
                                                    <div>
                                                        <div>{v?.toLocaleString()} g</div>
                                                        <div style={{ fontSize: 11, color: '#999' }}>{(v / 1000).toFixed(2)} kg</div>
                                                    </div>
                                                )
                                            },
                                            {
                                                title: 'Recibido ahora', key: 'qty', width: 150, render: (_, r, idx) => (
                                                    <div>
                                                        <InputNumber min={0} value={r.quantityReceived} addonAfter="g"
                                                            onChange={v => { const u = [...receptionItems]; u[idx].quantityReceived = v || 0; setReceptionItems(u); }}
                                                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} style={{ width: '100%' }} />
                                                        {r.quantityReceived > 0 && (
                                                            <div style={{ fontSize: 11, color: '#1890ff', marginTop: 2 }}>= {(r.quantityReceived / 1000).toFixed(2)} kg</div>
                                                        )}
                                                    </div>
                                                )
                                            },
                                            {
                                                title: 'Nota', key: 'note', width: 180, render: (_, r, idx) => {
                                                    const diff = r.quantityReceived - r.quantityExpected;
                                                    return (
                                                        <div>
                                                            {r.quantityReceived > 0 && diff !== 0 && (
                                                                <div style={{ fontSize: 11, color: diff < 0 ? '#cf1322' : '#389e0d', marginBottom: 4, fontWeight: 600 }}>
                                                                    {diff < 0 ? `⚠ Faltan ${Math.abs(diff).toLocaleString()} g` : `+ ${diff.toLocaleString()} g extra`}
                                                                </div>
                                                            )}
                                                            <Input size="small" placeholder="Discrepancia..." value={r.discrepancyNote}
                                                                onChange={e => { const u = [...receptionItems]; u[idx].discrepancyNote = e.target.value; setReceptionItems(u); }} />
                                                        </div>
                                                    );
                                                }
                                            }
                                        ]} />
                                    <TextArea rows={2} placeholder="Observaciones generales de la recepción..." value={receptionObs}
                                        onChange={e => setReceptionObs(e.target.value)} style={{ marginTop: 12 }} />

                                    {/* Photo upload sections */}
                                    <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
                                        {/* Reception/Product Photos */}
                                        <div style={{ flex: 1, background: receptionPhotos.length > 0 ? '#f6ffed' : '#fff1f0', border: `1px solid ${receptionPhotos.length > 0 ? '#b7eb8f' : '#ffa39e'}`, borderRadius: 8, padding: '10px 14px' }}>
                                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>📷 Fotos recepción / producto {receptionPhotos.length === 0 && <Text type="danger">(obligatorio)</Text>}:</Text>
                                            <Space wrap>
                                                {receptionPhotos.map((f, idx) => (
                                                    <div key={idx} style={{ position: 'relative' }}>
                                                        <img src={URL.createObjectURL(f)} alt="foto" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9' }} />
                                                        <Button size="small" danger type="text" style={{ position: 'absolute', top: -8, right: -8, fontSize: 10, padding: '0 4px' }}
                                                            onClick={() => setReceptionPhotos(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                                                    </div>
                                                ))}
                                                <Button icon={<UploadOutlined />} size="small" onClick={() => {
                                                    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.capture = 'environment';
                                                    inp.onchange = e => setReceptionPhotos(prev => [...prev, ...Array.from(e.target.files)]);
                                                    inp.click();
                                                }}>Tomar / Subir</Button>
                                            </Space>
                                        </div>

                                        {/* Invoice Photo */}
                                        <div style={{ flex: 1, background: receptionInvoicePhotos.length > 0 ? '#f6ffed' : '#fff1f0', border: `1px solid ${receptionInvoicePhotos.length > 0 ? '#b7eb8f' : '#ffa39e'}`, borderRadius: 8, padding: '10px 14px' }}>
                                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>📄 Foto factura proveedor {receptionInvoicePhotos.length === 0 && <Text type="danger">(obligatorio)</Text>}:</Text>
                                            <Space wrap>
                                                {receptionInvoicePhotos.map((f, idx) => (
                                                    <div key={idx} style={{ position: 'relative' }}>
                                                        <img src={URL.createObjectURL(f)} alt="factura" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9' }} />
                                                        <Button size="small" danger type="text" style={{ position: 'absolute', top: -8, right: -8, fontSize: 10, padding: '0 4px' }}
                                                            onClick={() => setReceptionInvoicePhotos(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                                                    </div>
                                                ))}
                                                <Button icon={<UploadOutlined />} size="small" onClick={() => {
                                                    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.capture = 'environment';
                                                    inp.onchange = e => setReceptionInvoicePhotos(prev => [...prev, ...Array.from(e.target.files)]);
                                                    inp.click();
                                                }}>Tomar / Subir</Button>
                                            </Space>
                                        </div>
                                    </div>

                                    <Space style={{ marginTop: 12 }}>
                                        <Button type="primary" icon={<CheckOutlined />} loading={submittingReception} onClick={submitReception}
                                            disabled={receptionPhotos.length === 0 || receptionInvoicePhotos.length === 0 || !receptionItems.some(i => i.quantityReceived > 0)}>
                                            Confirmar Recepción
                                        </Button>
                                        <Button onClick={() => setReceptionMode(false)}>Cancelar</Button>
                                    </Space>
                                </div>
                            ) : selectedOrder.receptions?.length ? (
                                <div>
                                    {selectedOrder.receptions.map(r => (
                                        <Card key={r.id} size="small" style={{ marginBottom: 12 }}
                                            title={<Space>
                                                <Text strong>{dayjs(r.receivedAt).format('DD/MM/YY HH:mm')}</Text>
                                                <Tag color={r.status === 'COMPLETED' ? 'green' : 'orange'}>{r.status === 'COMPLETED' ? 'Validada' : 'Pendiente Contab.'}</Tag>
                                                <Text type="secondary">— {r.receivedBy?.name}</Text>
                                            </Space>}>


                                            {r.observations && <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>📝 {r.observations}</Text>}
                                            {r.items?.map(item => (
                                                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                                                    <Text>{item.orderItem?.siigoProductName}</Text>
                                                    <Space>
                                                        <Text>Esperado: {item.quantityExpected?.toLocaleString()} g</Text>
                                                        <Text strong style={{ color: item.quantityReceived < item.quantityExpected ? '#cf1322' : '#389e0d' }}>
                                                            Recibido: {item.quantityReceived?.toLocaleString()} g
                                                        </Text>
                                                        {item.discrepancyNote && <Text type="warning">⚠️ {item.discrepancyNote}</Text>}
                                                    </Space>
                                                </div>
                                            ))}
                                            {/* Reception photos */}
                                            {(r.receptionPhotoUrls?.length > 0) && (
                                                <div style={{ marginTop: 8 }}>
                                                    <Text strong style={{ fontSize: 11, color: '#722ed1', display: 'block', marginBottom: 4 }}>📷 Fotos de recepción:</Text>
                                                    <Image.PreviewGroup>
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                            {r.receptionPhotoUrls.map((url, idx) => (
                                                                <Image key={idx} src={url} alt={`recepción ${idx + 1}`} width={70} height={70} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                            ))}
                                                        </div>
                                                    </Image.PreviewGroup>
                                                </div>
                                            )}
                                            {/* Invoice photos */}
                                            {(r.invoiceImageUrls?.length > 0) && (
                                                <div style={{ marginTop: 8 }}>
                                                    <Text strong style={{ fontSize: 11, color: '#d4b106', display: 'block', marginBottom: 4 }}>📄 Factura proveedor:</Text>
                                                    <Image.PreviewGroup>
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                            {r.invoiceImageUrls.map((url, idx) => (
                                                                <div key={idx} style={{ position: 'relative' }}>
                                                                    {url.endsWith('.pdf') ? (
                                                                        <a href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF {idx + 1}</Button></a>
                                                                    ) : (
                                                                        <Image src={url} alt={`factura ${idx + 1}`} width={70} height={70} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                                    )}
                                                                    {r.status !== 'COMPLETED' && <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => deleteInvoicePhoto(r.id, url)} style={{ position: 'absolute', top: -8, right: -8 }} />}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </Image.PreviewGroup>
                                                </div>
                                            )}
                                            {r.accountingUser && (
                                                <div style={{ marginTop: 12, padding: 12, background: '#fffbe6', borderRadius: 8, border: '1px solid #ffe58f' }}>
                                                    <Text strong style={{ color: '#d48806' }}>💰 Validación Contable</Text>
                                                    <div style={{ marginTop: 6 }}>
                                                        <Text type="secondary">Validado por <strong>{r.accountingUser.name}</strong></Text>
                                                        {r.accountingAt && <Text type="secondary"> — {dayjs(r.accountingAt).format('DD/MM/YY HH:mm')}</Text>}
                                                    </div>
                                                    {r.siigoRef && <div style={{ marginTop: 4 }}><Tag color="gold">Siigo: {r.siigoRef}</Tag></div>}
                                                    {r.accountingNotes && <div style={{ marginTop: 4 }}><Text style={{ fontSize: 12, fontStyle: 'italic' }}>"{r.accountingNotes}"</Text></div>}
                                                    {r.siigoScreenshotUrl && (
                                                        <div style={{ marginTop: 6 }}>
                                                            <Text type="secondary" style={{ fontSize: 11 }}>📸 Captura Siigo:</Text>
                                                            <div style={{ marginTop: 4 }}>
                                                                <Image src={r.siigoScreenshotUrl} alt="Siigo screenshot" width={120} style={{ borderRadius: 4 }} />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {r.itemCosts && Object.keys(r.itemCosts).length > 0 && (
                                                        <div style={{ marginTop: 6 }}>
                                                            <Text type="secondary" style={{ fontSize: 11 }}>📊 Costos registrados:</Text>
                                                            {Object.entries(r.itemCosts).map(([itemId, cost]) => {
                                                                const item = r.items?.find(ri => ri.orderItemId === itemId);
                                                                return (
                                                                    <div key={itemId} style={{ fontSize: 12, marginLeft: 8 }}>
                                                                        {item?.orderItem?.siigoProductName || 'Item'}: <strong>$ {Number(cost.totalPay || 0).toLocaleString()}</strong>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Card>
                                    ))}
                                </div>
                            ) : <Empty description="Sin recepciones aún" />}
                        </Tabs.TabPane>




                        {/* ── TAB: Cartera ── */}
                        <Tabs.TabPane tab={`💳 Cartera`} key="cartera">
                            {(['PAYMENT_PENDING', 'SENT'].includes(selectedOrder.status) || (selectedOrder.status === 'COMPLETED' && selectedOrder.paymentMethod === 'CREDITO' && !selectedOrder.creditPaid)) ? (
                                <div tabIndex={0} onPaste={async (e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    const items = e.clipboardData?.items;
                                    if (!items) return;
                                    const files = [];
                                    for (let i = 0; i < items.length; i++) {
                                        if (items[i].type.startsWith('image/')) {
                                            const blob = items[i].getAsFile();
                                            if (blob) files.push(blob);
                                        }
                                    }
                                    if (files.length === 0) return;
                                    setUploadingPaymentProof(true);
                                    try {
                                        const formData = new FormData();
                                        files.forEach(f => formData.append('files', f));
                                        await api.post(`/procurement/purchase-orders/${selectedOrder.id}/payment-proof`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                                        message.success('📋 Comprobante pegado exitosamente');
                                        refreshDetail(selectedOrder.id);
                                    } catch { message.error('Error subiendo imagen pegada'); }
                                    setUploadingPaymentProof(false);
                                }} style={{ outline: 'none' }}>
                                    <Alert type="info" showIcon message="Revisa la cotización, ingresa los costos por producto y registra el pago." style={{ marginBottom: 12 }} />

                                    {/* Quotation files for Cartera to review */}
                                    {(selectedOrder.quotationUrls || []).length > 0 && (
                                        <div style={{ background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>📎 Cotización del proveedor:</Text>
                                            <Space wrap>
                                                {(selectedOrder.quotationUrls || []).map((url, i) => (
                                                    <Button key={i} size="small" type="link" href={url} target="_blank" icon={<EyeOutlined />}>
                                                        Cotización {i + 1}
                                                    </Button>
                                                ))}
                                            </Space>
                                        </div>
                                    )}

                                    {/* Supplier tax config — always visible, editable */}
                                    <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '8px 14px', marginBottom: 12 }}>
                                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Impuestos del proveedor:</Text>
                                        <Space wrap>
                                            <div>
                                                <Text style={{ fontSize: 11 }}>IVA %</Text>
                                                <InputNumber size="small" min={0} max={100} value={carteraTaxes.ivaRate}
                                                    onChange={v => setCarteraTaxes(prev => ({ ...prev, ivaRate: v || 0 }))}
                                                    style={{ width: 70, display: 'block' }} />
                                            </div>
                                            <div>
                                                <Text style={{ fontSize: 11 }}>Retefuente %</Text>
                                                <InputNumber size="small" min={0} max={100} step={0.5} value={carteraTaxes.reteFuenteRate}
                                                    onChange={v => setCarteraTaxes(prev => ({ ...prev, reteFuenteRate: v || 0 }))}
                                                    style={{ width: 70, display: 'block' }} />
                                            </div>
                                        </Space>
                                    </div>

                                    {/* Per-item cost entry — user enters BASE PRICE (without taxes) */}
                                    <Table dataSource={selectedOrder.items || []} rowKey="id" size="small" pagination={false}
                                        columns={[
                                            { title: 'Producto', dataIndex: 'siigoProductName', width: '28%' },
                                            { title: 'Cantidad', key: 'qty', width: '12%', align: 'right', render: (_, r) => <div><div>{r.quantityOrdered?.toLocaleString()} g</div><div style={{ fontSize: 11, color: '#1890ff' }}>{(r.quantityOrdered / 1000).toFixed(1)} kg</div></div> },
                                            {
                                                title: 'Base sin IVA ($)', key: 'totalPay', width: '22%', render: (_, r) => (
                                                    <InputNumber min={0} size="small" style={{ width: '100%' }}
                                                        value={carteraCosts[r.id]?.totalPay ?? (r.unitCost ? r.unitCost * (r.quantityOrdered / 1000) : 0)}
                                                        onChange={v => setCarteraCosts(prev => ({ ...prev, [r.id]: { totalPay: v || 0 } }))}
                                                        formatter={v => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={v => v.replace(/\$\s?|(,*)/g, '')} />
                                                )
                                            },
                                            {
                                                title: 'Costo/g', key: 'costG', width: '15%', align: 'right', render: (_, r) => {
                                                    const grams = r.quantityOrdered;
                                                    const basePay = carteraCosts[r.id]?.totalPay ?? (r.unitCost ? r.unitCost * (r.quantityOrdered / 1000) : 0);
                                                    const costPerG = grams > 0 ? basePay / grams : 0;
                                                    return <Text type="secondary">$ {costPerG.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g</Text>;
                                                }
                                            }
                                        ]} />

                                    {/* Totals — forward-calculate from base (sin IVA) */}
                                    {(() => {
                                        const ivaRate = carteraTaxes.ivaRate || 0;
                                        const reteRate = carteraTaxes.reteFuenteRate || 0;
                                        const subtotal = (selectedOrder.items || []).reduce((sum, r) => {
                                            return sum + (carteraCosts[r.id]?.totalPay ?? (r.unitCost ? r.unitCost * (r.quantityOrdered / 1000) : 0));
                                        }, 0);
                                        const iva = subtotal * (ivaRate / 100);
                                        const rete = subtotal * (reteRate / 100);
                                        const totalPay = subtotal + iva - rete;
                                        return (
                                            <div style={{ marginTop: 12, textAlign: 'right', background: '#fafafa', padding: 12, borderRadius: 8 }}>
                                                <div>Subtotal (base sin IVA): <Text strong>$ {subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>
                                                {ivaRate > 0 && <div>IVA {ivaRate}%: <Text style={{ color: '#389e0d' }}>+ $ {iva.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>}
                                                {reteRate > 0 && <div>Retefuente {reteRate}%: <Text style={{ color: '#cf1322' }}>- $ {rete.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>}
                                                <Divider style={{ margin: '8px 0' }} />
                                                <div style={{ fontSize: 16 }}>Valor a pagar: <Text strong style={{ fontSize: 18 }}>$ {totalPay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>
                                            </div>
                                        );
                                    })()}

                                    {/* Payment proof upload */}
                                    <div style={{ marginTop: 12 }}>
                                        <Text strong>Comprobante de pago:</Text>
                                        <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                            {(selectedOrder.paymentProofUrls || []).map((url, idx) => (
                                                <div key={idx} style={{ position: 'relative' }}>
                                                    {url.endsWith('.pdf') ? (
                                                        <a href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF {idx + 1}</Button></a>
                                                    ) : (
                                                        <Image src={url} alt={`pago ${idx + 1}`} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                    )}
                                                </div>
                                            ))}
                                            <Button icon={<UploadOutlined />} loading={uploadingPaymentProof}
                                                onClick={() => {
                                                    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true; inp.onchange = async e => {
                                                        setUploadingPaymentProof(true);
                                                        try {
                                                            const formData = new FormData(); Array.from(e.target.files).forEach(f => formData.append('files', f));
                                                            await api.post(`/procurement/purchase-orders/${selectedOrder.id}/payment-proof`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                                                            message.success('Comprobante subido'); refreshDetail(selectedOrder.id);
                                                        } catch { message.error('Error subiendo'); }
                                                        setUploadingPaymentProof(false);
                                                    }; inp.click();
                                                }}>
                                                Subir Comprobante
                                            </Button>
                                        </div>
                                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>💡 También puedes usar <strong>Ctrl+V</strong> en cualquier parte de esta pestaña para pegar un comprobante</Text>
                                    </div>

                                    {/* Notes + submit */}
                                    <TextArea rows={2} placeholder="Notas de pago..." value={carteraNotes} onChange={e => setCarteraNotes(e.target.value)} style={{ marginTop: 12 }} />
                                    <Button type="primary" style={{ marginTop: 12 }} loading={submittingCartera} icon={<CheckOutlined />}
                                        disabled={!(selectedOrder.paymentProofUrls && selectedOrder.paymentProofUrls.length > 0)}
                                        onClick={async () => {
                                            setSubmittingCartera(true);
                                            try {
                                                const endpoint = selectedOrder.paymentMethod === 'CREDITO'
                                                    ? `/procurement/purchase-orders/${selectedOrder.id}/credit-payment`
                                                    : `/procurement/purchase-orders/${selectedOrder.id}/payment`;
                                                await api.put(endpoint, {
                                                    itemCosts: carteraCosts, paymentNotes: carteraNotes
                                                });
                                                message.success('💳 Pago registrado');
                                                viewDetail(selectedOrder.id); loadOrders();
                                            } catch (err) { message.error(err.response?.data?.error || 'Error registrando pago'); }
                                            setSubmittingCartera(false);
                                        }}>
                                        Registrar Pago
                                    </Button>
                                </div>
                            ) : selectedOrder.status === 'PAID' || selectedOrder.paidBy ? (
                                <div>
                                    <Alert type="success" showIcon message={`Pagada por ${selectedOrder.paidBy?.name || 'Cartera'} el ${selectedOrder.paidAt ? dayjs(selectedOrder.paidAt).format('DD/MM/YY HH:mm') : ''}`} style={{ marginBottom: 12 }} />
                                    {selectedOrder.paymentNotes && <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>📝 {selectedOrder.paymentNotes}</Text>}
                                    {/* Show saved costs */}
                                    <Table dataSource={selectedOrder.items || []} rowKey="id" size="small" pagination={false}
                                        columns={[
                                            { title: 'Producto', dataIndex: 'siigoProductName' },
                                            { title: 'Cantidad', key: 'qty', align: 'right', render: (_, r) => `${r.quantityOrdered?.toLocaleString()} g` },
                                            { title: 'Costo/g', key: 'cost', align: 'right', render: (_, r) => { const cg = r.unitCost ? (r.unitCost / 1000) : 0; return `$ ${cg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; } },
                                            { title: 'Total', key: 'sub', align: 'right', render: (_, r) => <Text strong>$ {((r.unitCost || 0) * r.quantityOrdered / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text> }
                                        ]} />
                                    {/* Payment proofs */}
                                    {(selectedOrder.paymentProofUrls || []).length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <Text strong style={{ display: 'block', marginBottom: 4 }}>Comprobantes:</Text>
                                            <Image.PreviewGroup>
                                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                    {selectedOrder.paymentProofUrls.map((url, idx) => (
                                                        url.endsWith('.pdf')
                                                            ? <a key={idx} href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF {idx + 1}</Button></a>
                                                            : <Image key={idx} src={url} alt={`pago ${idx + 1}`} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                    ))}
                                                </div>
                                            </Image.PreviewGroup>
                                        </div>
                                    )}
                                </div>
                            ) : <Empty description="Cartera aún no aplica para esta OC" />}
                        </Tabs.TabPane>

                        {/* ── TAB: Contabilidad ── */}
                        <Tabs.TabPane tab={<span>📊 Contabilidad</span>} key="accounting">
                            {/* Pending receptions - need accounting validation */}
                            {selectedOrder.receptions?.filter(r => !r.accountingUser).length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    <Text strong style={{ display: 'block', marginBottom: 8, color: '#d48806' }}>⏳ Recepciones pendientes de validación:</Text>
                                    {selectedOrder.receptions.filter(r => !r.accountingUser).map(r => (
                                        <Card key={r.id} size="small" style={{ marginBottom: 8, borderColor: '#ffe58f', background: '#fffbe6' }}
                                            extra={
                                                <Button type="primary" icon={<DollarOutlined />} onClick={() => startAccounting(r)}>
                                                    💰 Validar Contabilidad
                                                </Button>
                                            }>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <Text strong>{dayjs(r.receivedAt).format('DD/MM/YY HH:mm')}</Text>
                                                    <Text type="secondary"> — {r.receivedBy?.name}</Text>
                                                </div>
                                                <div>
                                                    {r.items?.map(item => (
                                                        <Tag key={item.id}>{item.orderItem?.siigoProductName}: {item.quantityReceived?.toLocaleString()} g</Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            )}

                            {/* Already validated receptions */}
                            {selectedOrder.receptions?.some(r => r.accountingUser) ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <Text strong style={{ display: 'block', color: '#389e0d' }}>✅ Recepciones validadas:</Text>
                                    {selectedOrder.receptions.filter(r => r.accountingUser).map(r => (
                                        <Card key={r.id} size="small" style={{ borderColor: '#ffe58f' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                                                <Text strong style={{ color: '#d48806' }}>💰 Validación Contable</Text>
                                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                    {r.providerInvoiceNumber && <Tag color="blue">Factura: {r.providerInvoiceNumber}</Tag>}
                                                    {r.siigoRef && <Tag color="gold">Siigo: {r.siigoRef}</Tag>}
                                                    <Tag color="green">✅ Validada</Tag>
                                                </div>
                                            </div>

                                            {/* Validator + date */}
                                            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text type="secondary">
                                                    Validado por <strong>{r.accountingUser.name}</strong>
                                                    {r.accountingAt && ` — ${dayjs(r.accountingAt).format('DD/MM/YY HH:mm')}`}
                                                </Text>
                                            </div>

                                            {/* Supplier info */}
                                            <div style={{ background: '#f6ffed', borderRadius: 6, padding: '8px 10px', marginBottom: 10, border: '1px solid #b7eb8f' }}>
                                                <Text strong style={{ fontSize: 12 }}>🏢 Proveedor: </Text>
                                                <Text style={{ fontSize: 12 }}>{selectedOrder?.supplierName || '—'}</Text>
                                                {selectedOrder?.supplierNit && <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>NIT: {selectedOrder.supplierNit}</Text>}
                                            </div>

                                            {/* Factura del proveedor */}
                                            {(Array.isArray(r.invoiceImageUrls) ? r.invoiceImageUrls : []).length > 0 && (
                                                <div style={{ marginBottom: 12 }}>
                                                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>📄 Factura del proveedor:</Text>
                                                    <Image.PreviewGroup>
                                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                            {r.invoiceImageUrls.map((url, idx) => (
                                                                <div key={idx}>
                                                                    {url.endsWith('.pdf') ? (
                                                                        <a href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF {idx + 1}</Button></a>
                                                                    ) : (
                                                                        <Image src={url} alt={`factura ${idx + 1}`} width={100} height={100} style={{ objectFit: 'cover', borderRadius: 6 }} />
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </Image.PreviewGroup>
                                                </div>
                                            )}

                                            {/* Detailed costs per item with quantities */}
                                            {r.itemCosts && Object.keys(r.itemCosts).length > 0 && (
                                                <div style={{ marginBottom: 12, background: '#fafafa', borderRadius: 6, padding: 10 }}>
                                                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>💲 Detalle de costos:</Text>
                                                    {Object.entries(r.itemCosts).map(([itemId, cost]) => {
                                                        const item = r.items?.find(ri => ri.orderItemId === itemId);
                                                        const qty = item?.quantityReceived || 0;
                                                        const totalPay = Number(cost.totalPay || 0);
                                                        const costPerKg = qty > 0 ? (totalPay / (qty / 1000)) : 0;
                                                        return (
                                                            <div key={itemId} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                                                    <span><strong>{item?.orderItem?.siigoProductName || 'Item'}</strong></span>
                                                                    <strong>$ {totalPay.toLocaleString()}</strong>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8c8c8c' }}>
                                                                    <span>Recibido: {(qty / 1000).toLocaleString()} kg ({qty.toLocaleString()} g)</span>
                                                                    <span>Costo/kg: $ {costPerKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Tax breakdown and total */}
                                                    {(() => {
                                                        const subtotal = Object.values(r.itemCosts).reduce((sum, c) => sum + Number(c.totalPay || 0), 0);
                                                        const supplier = selectedOrder?.supplier;
                                                        const ivaRate = supplier?.ivaRate || 0;
                                                        const reteRate = supplier?.reteFuenteRate || 0;
                                                        const iva = subtotal * (ivaRate / 100);
                                                        const rete = subtotal * (reteRate / 100);
                                                        const total = subtotal + iva - rete;
                                                        return (
                                                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid #d9d9d9' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                                                    <span>Subtotal:</span>
                                                                    <span>$ {subtotal.toLocaleString()}</span>
                                                                </div>
                                                                {ivaRate > 0 && (
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#389e0d' }}>
                                                                        <span>IVA {ivaRate}%:</span>
                                                                        <span>+ $ {iva.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                                                    </div>
                                                                )}
                                                                {reteRate > 0 && (
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cf1322' }}>
                                                                        <span>Retefuente {reteRate}%:</span>
                                                                        <span>- $ {rete.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                                                    </div>
                                                                )}
                                                                <Divider style={{ margin: '4px 0' }} />
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                                                    <Text strong>Total a pagar:</Text>
                                                                    <Text strong style={{ fontSize: 16, color: '#1890ff' }}>$ {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}

                                            {/* Reception items summary */}
                                            {r.items?.length > 0 && (
                                                <div style={{ marginBottom: 10, background: '#e6f7ff', borderRadius: 6, padding: '6px 10px' }}>
                                                    <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>📦 Productos recibidos:</Text>
                                                    {r.items.map(ri => (
                                                        <div key={ri.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                                                            <span>{ri.orderItem?.siigoProductName}</span>
                                                            <span>
                                                                <strong>{(ri.quantityReceived / 1000).toLocaleString()} kg</strong>
                                                                {ri.quantityReceived !== ri.quantityExpected && (
                                                                    <Text type={ri.quantityReceived < ri.quantityExpected ? 'danger' : 'success'} style={{ marginLeft: 4, fontSize: 10 }}>
                                                                        ({ri.quantityReceived > ri.quantityExpected ? '+' : ''}{((ri.quantityReceived - ri.quantityExpected) / 1000).toLocaleString()} kg)
                                                                    </Text>
                                                                )}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Notas de contabilidad */}
                                            {r.accountingNotes && (
                                                <div style={{ background: '#fffbe6', borderRadius: 4, padding: '4px 8px' }}>
                                                    <Text strong style={{ fontSize: 12 }}>📝 Notas: </Text>
                                                    <Text style={{ fontSize: 12, fontStyle: 'italic' }}>"{r.accountingNotes}"</Text>
                                                </div>
                                            )}
                                        </Card>
                                    ))}
                                </div>
                            ) : !selectedOrder.receptions?.some(r => !r.accountingUser) && (
                                <Empty description="No hay recepciones para validar" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            )}
                        </Tabs.TabPane>

                        {/* ── TAB: Lots (hidden for CONTABILIDAD/CARTERA) ── */}
                        {!isContabilidad && !isCartera && <Tabs.TabPane tab={`🏷️ Lotes`} key="lots">
                            {/* Items that need lots */}
                            {selectedOrder.items?.filter(i => (i.quantityReceived || 0) > 0 && (!i.lots || i.lots.length === 0)).length > 0 && (
                                <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                                    <Text strong style={{ display: 'block', marginBottom: 8 }}>📦 Productos recibidos sin lotes:</Text>
                                    {selectedOrder.items.filter(i => (i.quantityReceived || 0) > 0 && (!i.lots || i.lots.length === 0)).map(item => (
                                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #ffe7ba' }}>
                                            <div>
                                                <Text strong>{item.siigoProductName}</Text>
                                                <Text style={{ marginLeft: 8 }} type="secondary">({item.quantityReceived?.toLocaleString()} g recibidos)</Text>
                                            </div>
                                            <Button type="primary" size="small" icon={<TagsOutlined />} onClick={() => openLotModal(item)}>
                                                Registrar Lotes
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Existing lots */}
                            {selectedOrder.items?.some(i => i.lots?.length > 0) ? (
                                selectedOrder.items.filter(i => i.lots?.length > 0).map(item => (
                                    <div key={item.id} style={{ marginBottom: 16 }}>
                                        <Text strong style={{ fontSize: 14 }}>{item.siigoProductName} ({item.siigoProductCode})</Text>
                                        <Table dataSource={item.lots} rowKey="id" size="small" pagination={false} style={{ marginTop: 4 }}
                                            columns={[
                                                { title: 'Lote', dataIndex: 'lotNumber', render: v => <Tag color="blue">{v}</Tag> },
                                                { title: 'Cantidad', dataIndex: 'currentQuantity', align: 'right', render: v => v?.toLocaleString() },
                                                { title: 'Vencimiento', dataIndex: 'expiresAt', render: (v, lot) => {
                                                    if (v) return dayjs(v).format('DD/MM/YY');
                                                    return (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <input type="date" style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #ffa39e', borderRadius: 4, width: 120 }}
                                                                onChange={async (e) => {
                                                                    if (!e.target.value) return;
                                                                    try {
                                                                        await api.patch(`/procurement/lots/${lot.id}`, { expiresAt: e.target.value });
                                                                        message.success('Vencimiento actualizado');
                                                                        viewDetail(selectedOrder.id);
                                                                    } catch { message.error('Error actualizando'); }
                                                                }} />
                                                            <Text type="danger" style={{ fontSize: 10 }}>⚠</Text>
                                                        </span>
                                                    );
                                                }},
                                                { title: 'Estado', dataIndex: 'status', render: v => <Tag color={v === 'AVAILABLE' ? 'green' : v === 'LOW_STOCK' ? 'orange' : 'red'}>{v}</Tag> },
                                                {
                                                    title: '', key: 'print', width: 80, render: (_, lot) => (
                                                        <Button size="small" icon={<PrinterOutlined />} onClick={() => printLotLabel(lot)}>Etiqueta</Button>
                                                    )
                                                }
                                            ]} />
                                    </div>
                                ))
                            ) : !selectedOrder.items?.some(i => (i.quantityReceived || 0) > 0) && (
                                <Empty description="Aún no hay lotes — primero se debe recibir la mercancía" />
                            )}
                        </Tabs.TabPane>}

                        {/* ── TAB: Quotation ── */}
                        <Tabs.TabPane tab={<span><PaperClipOutlined /> Cotización {selectedOrder.quotationUrls?.length > 0 ? `(${selectedOrder.quotationUrls.length})` : ''}</span>} key="quotation">
                            <div
                                ref={quotationDropRef}
                                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#1890ff'; e.currentTarget.style.background = '#e6f4ff'; }}
                                onDragLeave={(e) => { e.currentTarget.style.borderColor = '#d9d9d9'; e.currentTarget.style.background = '#fafafa'; }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.style.borderColor = '#d9d9d9';
                                    e.currentTarget.style.background = '#fafafa';
                                    const files = e.dataTransfer.files;
                                    if (files.length > 0) uploadQuotationFiles(files);
                                }}
                                style={{ border: '2px dashed #d9d9d9', borderRadius: 12, padding: 32, textAlign: 'center', background: '#fafafa', cursor: 'pointer', marginBottom: 16, transition: 'all 0.2s' }}
                                onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,.pdf'; inp.onchange = (e) => uploadQuotationFiles(e.target.files); inp.click(); }}
                            >
                                {uploadingQuotation ? <Spin /> : (
                                    <>
                                        <UploadOutlined style={{ fontSize: 32, color: '#999' }} />
                                        <div style={{ marginTop: 8, color: '#666', fontWeight: 500 }}>
                                            Arrastra aquí la cotización del proveedor
                                        </div>
                                        <div style={{ color: '#999', fontSize: 12 }}>
                                            o haz click para seleccionar • También puedes usar <strong>Ctrl+V</strong> para pegar
                                        </div>
                                        <div style={{ color: '#bbb', fontSize: 11, marginTop: 4 }}>
                                            Formatos: imágenes, PDF
                                        </div>
                                    </>
                                )}
                            </div>

                            {selectedOrder.quotationUrls?.length > 0 ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                    {selectedOrder.quotationUrls.map((url, idx) => (
                                        <div key={idx} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                                            {url.endsWith('.pdf') ? (
                                                <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', cursor: 'pointer' }}
                                                    onClick={() => window.open(url, '_blank')}>
                                                    <FilePdfOutlined style={{ fontSize: 40, color: '#cf1322' }} />
                                                    <Text type="secondary" style={{ marginTop: 8, fontSize: 11 }}>Click para ver PDF</Text>
                                                </div>
                                            ) : (
                                                <Image src={url} alt={`Cotización ${idx + 1}`}
                                                    style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                                            )}
                                            <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text type="secondary" style={{ fontSize: 11 }}>Archivo {idx + 1}</Text>
                                                <Button danger size="small" icon={<DeleteOutlined />}
                                                    onClick={() => deleteQuotationFile(url)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <Empty description="Sin cotización adjunta aún" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            )}

                            {/* Send to Cartera button — directly on quotation tab */}
                            {!isRestrictedRole && selectedOrder.status === 'SENT' && selectedOrder.quotationUrls?.length > 0 && (
                                <div style={{ marginTop: 16, textAlign: 'center' }}>
                                    <Button type="primary" size="large" style={{ background: '#fa541c', borderColor: '#fa541c' }}
                                        onClick={() => sendToCartera(selectedOrder.id)}>
                                        💳 Enviar a Cartera
                                    </Button>
                                </div>
                            )}
                        </Tabs.TabPane>

                        {/* ── TAB: History ── */}
                        <Tabs.TabPane tab="📋 Historial" key="history">
                            <Timeline mode="left" style={{ marginTop: 8 }}>
                                {/* 1. Creación */}
                                <Timeline.Item color="blue" label={dayjs(selectedOrder.createdAt).format('DD/MM/YY HH:mm')}>
                                    <Text strong>📝 OC Creada</Text>
                                    <div><Text type="secondary">por {selectedOrder.createdBy?.name || '—'}</Text></div>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                        {selectedOrder.items?.map(i => `${i.siigoProductName} (${i.quantityOrdered?.toLocaleString()}g)`).join(', ')}
                                    </Text>
                                </Timeline.Item>

                                {/* 2. Aprobación */}
                                {selectedOrder.approvedAt && (
                                    <Timeline.Item color="green" label={dayjs(selectedOrder.approvedAt).format('DD/MM/YY HH:mm')}>
                                        <Text strong>✅ Aprobada</Text>
                                        <div><Text type="secondary">por {selectedOrder.approvedBy?.name || '—'}</Text></div>
                                    </Timeline.Item>
                                )}

                                {/* 3. Cotizaciones adjuntadas */}
                                {selectedOrder.quotationUrls?.length > 0 && (
                                    <Timeline.Item color="cyan" label="">
                                        <Text strong>📎 Cotización adjuntada</Text>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                            {selectedOrder.quotationUrls.map((url, i) => (
                                                <img key={i} src={url} alt={`cotización ${i + 1}`}
                                                    style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer' }}
                                                    onClick={() => window.open(url, '_blank')} />
                                            ))}
                                        </div>
                                    </Timeline.Item>
                                )}

                                {/* 4. Pago Cartera */}
                                {selectedOrder.paidAt && (
                                    <Timeline.Item color="orange" label={dayjs(selectedOrder.paidAt).format('DD/MM/YY HH:mm')}>
                                        <Text strong>💳 Pago registrado</Text>
                                        <div><Text type="secondary">por {selectedOrder.paidBy?.name || '—'}</Text></div>
                                        {selectedOrder.paymentNotes && <div><Text style={{ fontSize: 12 }}>Nota: {selectedOrder.paymentNotes}</Text></div>}
                                        {selectedOrder.paymentProofUrls?.length > 0 && (
                                            <Image.PreviewGroup>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                                {(Array.isArray(selectedOrder.paymentProofUrls) ? selectedOrder.paymentProofUrls : []).map((url, i) => (
                                                    <Image key={i} src={url} alt={`comprobante ${i + 1}`}
                                                        width={50} height={50} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                ))}
                                            </div>
                                            </Image.PreviewGroup>
                                        )}
                                    </Timeline.Item>
                                )}

                                {/* 5. Recepciones */}
                                {selectedOrder.receptions?.map(r => (
                                    <React.Fragment key={r.id}>
                                        <Timeline.Item color="purple" label={dayjs(r.receivedAt).format('DD/MM/YY HH:mm')}>
                                            <Text strong>📦 Recepción registrada</Text>
                                            <div><Text type="secondary">por {r.receivedBy?.name || '—'}</Text></div>
                                            <div style={{ fontSize: 12 }}>
                                                {r.items?.map(ri => (
                                                    <div key={ri.id}>{ri.orderItem?.siigoProductName}: {ri.quantityReceived?.toLocaleString()}g recibidos</div>
                                                ))}
                                            </div>
                                            {r.observations && <div><Text style={{ fontSize: 12, fontStyle: 'italic' }}>"{r.observations}"</Text></div>}
                                            {/* Reception photos */}
                                            {(Array.isArray(r.receptionPhotoUrls) ? r.receptionPhotoUrls : []).length > 0 && (
                                                <div style={{ marginTop: 4 }}>
                                                    <Text type="secondary" style={{ fontSize: 11 }}>📷 Fotos recepción:</Text>
                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                                                        {r.receptionPhotoUrls.map((url, i) => (
                                                            <img key={i} src={url} alt={`recepción ${i + 1}`}
                                                                style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer' }}
                                                                onClick={() => window.open(url, '_blank')} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Invoice photos from reception */}
                                            {(Array.isArray(r.invoiceImageUrls) ? r.invoiceImageUrls : []).length > 0 && (
                                                <div style={{ marginTop: 4 }}>
                                                    <Text type="secondary" style={{ fontSize: 11 }}>📄 Factura proveedor:</Text>
                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                                                        {r.invoiceImageUrls.map((url, i) => (
                                                            <img key={i} src={url} alt={`factura ${i + 1}`}
                                                                style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer' }}
                                                                onClick={() => window.open(url, '_blank')} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </Timeline.Item>

                                        {/* 6. Accounting validation */}
                                        {r.accountingAt && (
                                            <Timeline.Item color="gold" label={dayjs(r.accountingAt).format('DD/MM/YY HH:mm')}>
                                                <Text strong>💰 Validación contable</Text>
                                                <div><Text type="secondary">por {r.accountingUser?.name || '—'}</Text></div>
                                                {r.siigoRef && <div><Tag color="gold" style={{ marginTop: 4 }}>Siigo: {r.siigoRef}</Tag></div>}
                                                {r.accountingNotes && <div><Text style={{ fontSize: 12, fontStyle: 'italic' }}>"{r.accountingNotes}"</Text></div>}
                                                {r.siigoScreenshotUrl && (
                                                    <div style={{ marginTop: 4 }}>
                                                        <Text type="secondary" style={{ fontSize: 11 }}>📸 Captura Siigo:</Text>
                                                        <div style={{ marginTop: 2 }}>
                                                            <Image src={r.siigoScreenshotUrl} alt="Siigo" width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                        </div>
                                                    </div>
                                                )}
                                                {r.itemCosts && Object.keys(r.itemCosts).length > 0 && (
                                                    <div style={{ marginTop: 4, fontSize: 12 }}>
                                                        {Object.entries(r.itemCosts).map(([itemId, cost]) => {
                                                            const item = r.items?.find(ri => ri.orderItemId === itemId);
                                                            return <div key={itemId}>{item?.orderItem?.siigoProductName || 'Item'}: <strong>$ {Number(cost.totalPay || 0).toLocaleString()}</strong></div>;
                                                        })}
                                                    </div>
                                                )}
                                            </Timeline.Item>
                                        )}
                                    </React.Fragment>
                                ))}

                                {/* 7. Lots registered */}
                                {selectedOrder.items?.some(i => i.lots?.length > 0) && (
                                    <Timeline.Item color="green">
                                        <Text strong>🏷️ Lotes registrados</Text>
                                        <div style={{ fontSize: 12 }}>
                                            {selectedOrder.items.filter(i => i.lots?.length > 0).map(item => (
                                                <div key={item.id}>
                                                    {item.siigoProductName}: {item.lots.map(l => `${l.lotNumber} (${l.currentQuantity?.toLocaleString()}g)`).join(', ')}
                                                </div>
                                            ))}
                                        </div>
                                    </Timeline.Item>
                                )}

                                {/* Current status */}
                                {selectedOrder.status === 'COMPLETED' ? (
                                    <Timeline.Item color="green">
                                        <Text strong style={{ color: '#389e0d' }}>🏁 Orden completada</Text>
                                    </Timeline.Item>
                                ) : selectedOrder.status === 'CANCELLED' ? (
                                    <Timeline.Item color="red">
                                        <Text strong style={{ color: '#cf1322' }}>❌ Orden cancelada</Text>
                                    </Timeline.Item>
                                ) : (
                                    <Timeline.Item color="gray" dot={<Spin size="small" />}>
                                        <Text type="secondary">En progreso — {statusLabels[selectedOrder.status]}</Text>
                                    </Timeline.Item>
                                )}
                            </Timeline>
                        </Tabs.TabPane>
                    </Tabs>

                    {/* Accounting modal — OUTSIDE Tabs so it works from any tab */}
                    {accountingMode && accountingReception && (
                        <Modal title="💰 Validación Contable" open={true} onCancel={() => setAccountingMode(false)}
                            width={1000} footer={[
                                <Button key="cancel" onClick={() => setAccountingMode(false)}>Cancelar</Button>,
                                <Button key="validate" type="primary" loading={submittingAccounting} onClick={submitAccounting} icon={<CheckOutlined />}
                                    disabled={!(accountingReception.invoiceImageUrls && accountingReception.invoiceImageUrls.length > 0) || !providerInvoiceNumber?.trim() || !siigoSyncData || !siigoValidation.isValid}>
                                    ✅ Validar Contabilidad
                                </Button>
                            ]}>
                            <div style={{ display: 'flex', gap: 16 }}>
                                {/* ── LEFT COLUMN ── */}
                                <div style={{ flex: '0 0 45%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {/* Supplier tax config */}
                                    {supplierTaxConfig && (
                                        <div style={{ background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8, padding: '10px 14px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                                <Text strong style={{ fontSize: 13 }}>⚙️ Config fiscal — {selectedOrder?.supplierName}</Text>
                                                {selectedOrder?.supplierDbId && (
                                                    <Button size="small" type="primary" onClick={async () => {
                                                        try {
                                                            await api.put(`/procurement/suppliers/${selectedOrder.supplierDbId}/tax-config`, {
                                                                ivaRate: supplierTaxConfig.ivaRate,
                                                                reteFuenteRate: supplierTaxConfig.reteFuenteRate,
                                                                paymentTermDays: supplierTaxConfig.paymentTermDays
                                                            });
                                                            message.success('✅ Config fiscal guardada');
                                                        } catch { message.error('Error guardando'); }
                                                    }}>Guardar</Button>
                                                )}
                                            </div>
                                            <Space wrap>
                                                <div>
                                                    <Text style={{ fontSize: 11 }}>IVA %</Text>
                                                    <InputNumber size="small" min={0} max={100} value={supplierTaxConfig.ivaRate ?? 0}
                                                        onChange={v => setSupplierTaxConfig(prev => ({ ...prev, ivaRate: v }))}
                                                        style={{ width: 70, display: 'block' }} />
                                                </div>
                                                <div>
                                                    <Text style={{ fontSize: 11 }}>Retefuente %</Text>
                                                    <InputNumber size="small" min={0} max={100} value={supplierTaxConfig.reteFuenteRate ?? 0}
                                                        onChange={v => setSupplierTaxConfig(prev => ({ ...prev, reteFuenteRate: v }))}
                                                        style={{ width: 70, display: 'block' }} />
                                                </div>
                                                <div>
                                                    <Text style={{ fontSize: 11 }}>Plazo (días)</Text>
                                                    <InputNumber size="small" min={0} max={365} value={supplierTaxConfig.paymentTermDays ?? 30}
                                                        onChange={v => setSupplierTaxConfig(prev => ({ ...prev, paymentTermDays: v }))}
                                                        style={{ width: 70, display: 'block' }} />
                                                </div>
                                            </Space>
                                        </div>
                                    )}

                                    {/* Payment proofs from Cartera */}
                                    {(selectedOrder.paymentProofUrls || []).length > 0 && (
                                        <div style={{ background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 8, padding: '8px 12px' }}>
                                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>💳 Comprobantes de pago:</Text>
                                            <Image.PreviewGroup>
                                            <Space wrap>
                                                {(selectedOrder.paymentProofUrls || []).map((url, idx) => (
                                                    url.endsWith('.pdf') ? (
                                                        <a key={idx} href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF {idx + 1}</Button></a>
                                                    ) : (
                                                        <Image key={idx} src={url} alt={`comprobante ${idx + 1}`} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                    )
                                                ))}
                                            </Space>
                                            </Image.PreviewGroup>
                                        </div>
                                    )}

                                    {/* Invoice upload — prominent */}
                                    <div style={{ background: !(accountingReception.invoiceImageUrls?.length > 0) ? '#fff1f0' : '#f6ffed', border: `2px solid ${!(accountingReception.invoiceImageUrls?.length > 0) ? '#ff4d4f' : '#52c41a'}`, borderRadius: 8, padding: '12px 14px' }}>
                                        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8, color: !(accountingReception.invoiceImageUrls?.length > 0) ? '#cf1322' : '#389e0d' }}>📄 Factura de compra {!(accountingReception.invoiceImageUrls?.length > 0) && '(obligatorio)'}</Text>
                                        <Image.PreviewGroup>
                                        <Space wrap>
                                            {(accountingReception.invoiceImageUrls || []).map((url, idx) => (
                                                url.endsWith('.pdf') ? (
                                                    <a key={idx} href={url} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>Factura {idx + 1}</Button></a>
                                                ) : (
                                                    <Image key={idx} src={url} alt={`factura ${idx + 1}`} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                )
                                            ))}
                                        </Space>
                                        </Image.PreviewGroup>
                                        <Button type="primary" icon={<UploadOutlined />} style={{ marginTop: 8, width: '100%', background: '#fa8c16', borderColor: '#fa8c16' }} onClick={() => {
                                            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
                                            inp.onchange = async (e) => {
                                                try {
                                                    const fd = new FormData(); Array.from(e.target.files).forEach(f => fd.append('files', f));
                                                    const res = await api.post(`/procurement/receptions/${accountingReception.id}/invoice-photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                                                    setAccountingReception(prev => ({ ...prev, invoiceImageUrls: res.data.invoiceImageUrls }));
                                                    message.success('📄 Factura subida');
                                                } catch { message.error('Error subiendo factura'); }
                                            }; inp.click();
                                        }}>📤 Subir Factura de Compra</Button>
                                    </div>

                                    {/* Reception photos */}
                                    {(accountingReception.receptionPhotoUrls?.length > 0) && (
                                        <div style={{ background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 8, padding: '8px 12px' }}>
                                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>📷 Fotos de lo recibido:</Text>
                                            <Image.PreviewGroup>
                                                <Space wrap>
                                                    {accountingReception.receptionPhotoUrls.map((url, idx) => (
                                                        <Image key={idx} src={url} alt={`recepción ${idx + 1}`} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
                                                    ))}
                                                </Space>
                                            </Image.PreviewGroup>
                                        </div>
                                    )}

                                    {/* Notes */}
                                    <TextArea rows={2} value={accountingNotes} onChange={e => setAccountingNotes(e.target.value)} placeholder="Notas contables..." />
                                </div>

                                {/* ── RIGHT COLUMN ── */}
                                <div style={{ flex: '1 1 55%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {/* Per-item costs table */}
                                    <Table dataSource={accountingReception.items || []} rowKey="id" size="small" pagination={false}
                                        columns={[
                                            { title: 'Producto', render: (_, r) => r.orderItem?.siigoProductName || '—', width: '35%' },
                                            { title: 'Recibido', render: (_, r) => <div><div>{r.quantityReceived?.toLocaleString()} g</div><div style={{ fontSize: 11, color: '#1890ff' }}>{(r.quantityReceived / 1000).toFixed(2)} kg</div></div>, width: '15%', align: 'right' },
                                            {
                                                title: 'Base sin IVA ($)', key: 'cost', width: '25%', render: (_, r) => (
                                                    <InputNumber min={0} value={accountingCosts[r.orderItemId]?.totalPay || 0}
                                                        onChange={v => setAccountingCosts(prev => ({ ...prev, [r.orderItemId]: { totalPay: v || 0 } }))}
                                                        formatter={v => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={v => v.replace(/\$\s?|(,*)/g, '')}
                                                        style={{ width: '100%' }} size="small" />
                                                )
                                            },
                                            {
                                                title: 'Subtotal', key: 'subtotal', width: '25%', align: 'right', render: (_, r) => {
                                                    const totalPay = accountingCosts[r.orderItemId]?.totalPay || 0;
                                                    return <Text strong>$ {totalPay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>;
                                                }
                                            }
                                        ]} />

                                    {/* Totals */}
                                    {(() => {
                                        const ivaRate = supplierTaxConfig?.ivaRate || 0;
                                        const reteRate = supplierTaxConfig?.reteFuenteRate || 0;
                                        const subtotal = (accountingReception.items || []).reduce((sum, ri) => {
                                            return sum + (accountingCosts[ri.orderItemId]?.totalPay || 0);
                                        }, 0);
                                        const iva = subtotal * (ivaRate / 100);
                                        const rete = subtotal * (reteRate / 100);
                                        const total = subtotal + iva - rete;
                                        return (
                                            <div style={{ textAlign: 'right', background: '#fafafa', padding: 12, borderRadius: 8 }}>
                                                <div>Subtotal: <Text strong>$ {subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>
                                                {ivaRate > 0 && <div>IVA {ivaRate}%: <Text style={{ color: '#389e0d' }}>+ $ {iva.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>}
                                                {reteRate > 0 && <div>Retefuente {reteRate}%: <Text style={{ color: '#cf1322' }}>- $ {rete.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>}
                                                <Divider style={{ margin: '8px 0' }} />
                                                <div style={{ fontSize: 16 }}>Total: <Text strong style={{ fontSize: 18 }}>$ {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text></div>
                                            </div>
                                        );
                                    })()}

                                    {/* Siigo purchase code + Sync */}
                                    <div style={{ background: siigoSyncData ? '#f6ffed' : '#fffbe6', border: `2px solid ${siigoSyncData ? '#52c41a' : '#faad14'}`, borderRadius: 8, padding: '12px 14px' }}>
                                        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8, color: siigoSyncData ? '#389e0d' : '#d48806' }}>
                                            🔗 Verificación Compra Siigo {!siigoSyncData && '(obligatorio)'}
                                        </Text>
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                            <Input size="small" value={siigoCompraCode} onChange={e => { setSiigoCompraCode(e.target.value); setSiigoSyncData(null); }} placeholder="Nro compra (ej: 2601)" style={{ flex: 1 }} />
                                            <Button type="primary" size="small" loading={siigoSyncing} icon={<SyncOutlined />}
                                                disabled={!siigoCompraCode?.trim()}
                                                onClick={async () => {
                                                    setSiigoSyncing(true); setSiigoSyncData(null);
                                                    try {
                                                        const res = await api.get(`/procurement/siigo-purchase/${siigoCompraCode.trim()}`);
                                                        setSiigoSyncData(res.data);
                                                        // Auto-fill invoice prefix and number from Siigo
                                                        if (res.data.providerInvoice) {
                                                            if (res.data.providerInvoice.prefix) setProviderInvoicePrefix(res.data.providerInvoice.prefix);
                                                            if (res.data.providerInvoice.number) setProviderInvoiceNumber(String(res.data.providerInvoice.number));
                                                        }
                                                        message.success(`✅ Compra #${siigoCompraCode} sincronizada`);
                                                    } catch (err) {
                                                        const msg = err.response?.data?.error || 'Error consultando Siigo';
                                                        message.error(msg);
                                                    } finally { setSiigoSyncing(false); }
                                                }}
                                                style={{ background: '#1890ff', borderColor: '#1890ff' }}>🔄 Sincronizar</Button>
                                        </div>

                                        {/* Siigo data display + cross-validation */}
                                        {siigoSyncData && (
                                            <div style={{ background: '#fafafa', borderRadius: 6, padding: 10, fontSize: 12 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                                    <Text strong style={{ color: '#1890ff' }}>📋 {siigoSyncData.name || `Compra #${siigoSyncData.number}`}</Text>
                                                    <div>
                                                        <Text type="secondary">{siigoSyncData.date}</Text>
                                                        {siigoSyncData.dueDate && <Text type="secondary" style={{ marginLeft: 8 }}>Vence: {siigoSyncData.dueDate}</Text>}
                                                    </div>
                                                </div>
                                                {!siigoValidation.exactMatch && (
                                                    <div style={{ padding: '4px 8px', borderRadius: 4, background: '#fff1f0', border: '1px solid #ffa39e', marginBottom: 6 }}>
                                                        <Text type="danger">
                                                            ⚠️ Se solicitó la compra #{siigoValidation.requestedNumber || siigoCompraCode}, pero Siigo devolvió #{siigoValidation.returnedNumber || siigoSyncData.name}.
                                                        </Text>
                                                    </div>
                                                )}
                                                <div style={{ padding: '4px 8px', borderRadius: 4, background: siigoValidation.supplierMatch ? '#f6ffed' : '#fff2e8', border: `1px solid ${siigoValidation.supplierMatch ? '#b7eb8f' : '#ffbb96'}`, marginBottom: 6 }}>
                                                    <Text>{siigoValidation.supplierMatch ? '✅' : '⚠️'} Proveedor: <strong>{siigoSyncData.supplier?.name}</strong></Text>
                                                    {siigoSyncData.supplier?.identification && <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>NIT: {siigoSyncData.supplier.identification}</Text>}
                                                    {!siigoValidation.supplierMatch && <Text type="danger" style={{ display: 'block', fontSize: 11 }}>OC dice: {selectedOrder?.supplierName}</Text>}
                                                </div>
                                                <div style={{ marginBottom: 6 }}>
                                                    <Text strong style={{ fontSize: 11 }}>Productos registrados en Siigo:</Text>
                                                    {siigoSyncData.items?.map((item, idx) => (
                                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f0f0f0' }}>
                                                            <span style={{ fontSize: 11 }}>{item.code} — {item.description}</span>
                                                            <span style={{ fontSize: 11 }}><strong>{item.quantity?.toLocaleString()}</strong> × ${item.price?.toLocaleString()} = <strong>${item.total?.toLocaleString()}</strong></span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Tax breakdown from Siigo */}
                                                <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 4, marginBottom: 4 }}>
                                                    <div style={{ textAlign: 'right' }}><Text style={{ fontSize: 11 }}>Subtotal: $ {siigoSyncData.subtotal?.toLocaleString()}</Text></div>
                                                    {(siigoSyncData.taxBreakdown || []).map((tax, idx) => (
                                                        <div key={idx} style={{ textAlign: 'right' }}>
                                                            <Text style={{ fontSize: 11, color: tax.type === 'IVA' ? '#389e0d' : '#cf1322' }}>
                                                                {tax.type === 'IVA' ? '+' : '-'} {tax.name}: $ {tax.value?.toLocaleString()}
                                                            </Text>
                                                        </div>
                                                    ))}
                                                    <Divider style={{ margin: '4px 0' }} />
                                                    <div style={{ textAlign: 'right' }}>
                                                        <Text strong style={{ fontSize: 14 }}>Total Siigo: $ {siigoSyncData.total?.toLocaleString()}</Text>
                                                    </div>
                                                </div>

                                                {/* Total comparison: local vs Siigo */}
                                                {(() => {
                                                    const ivaRate = supplierTaxConfig?.ivaRate || 0;
                                                    const reteRate = supplierTaxConfig?.reteFuenteRate || 0;
                                                    const localSubtotal = (accountingReception.items || []).reduce((sum, ri) => sum + (accountingCosts[ri.orderItemId]?.totalPay || 0), 0);
                                                    const localTotal = localSubtotal + localSubtotal * (ivaRate / 100) - localSubtotal * (reteRate / 100);
                                                    const siigoTotal = siigoSyncData.total || 0;
                                                    const diff = Math.abs(localTotal - siigoTotal);
                                                    const match = diff < 100; // tolerance of $100
                                                    return localSubtotal > 0 ? (
                                                        <div style={{ padding: '4px 8px', borderRadius: 4, background: match ? '#f6ffed' : '#fff1f0', border: `1px solid ${match ? '#b7eb8f' : '#ffa39e'}`, marginTop: 4 }}>
                                                            <Text style={{ fontSize: 11 }}>{match ? '✅' : '⚠️'} Total local: ${localTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} vs Siigo: ${siigoTotal.toLocaleString()}
                                                                {!match && <strong> (dif: ${diff.toLocaleString()})</strong>}
                                                            </Text>
                                                        </div>
                                                    ) : null;
                                                })()}

                                                {siigoSyncData.providerInvoice && (
                                                    <div style={{ marginTop: 4, padding: '3px 8px', background: '#e6f7ff', borderRadius: 4 }}>
                                                        <Text style={{ fontSize: 11 }}>📄 Factura proveedor: <strong>{siigoSyncData.providerInvoice.prefix}-{siigoSyncData.providerInvoice.number}</strong></Text>
                                                    </div>
                                                )}
                                                {siigoSyncData.observations && (
                                                    <div style={{ marginTop: 4 }}><Text type="secondary" style={{ fontSize: 11 }}>📝 {siigoSyncData.observations}</Text></div>
                                                )}
                                                {siigoSyncData.paymentMethod && (
                                                    <div style={{ marginTop: 2 }}><Text type="secondary" style={{ fontSize: 11 }}>💳 Forma de pago: {siigoSyncData.paymentMethod}</Text></div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Provider invoice number — auto-filled after Siigo sync */}
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                                        <div>
                                            <Text strong style={{ fontSize: 12 }}>Prefijo:</Text>
                                            <Input size="small" value={providerInvoicePrefix} onChange={e => setProviderInvoicePrefix(e.target.value)} placeholder="FV" style={{ width: 80 }} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <Text strong style={{ fontSize: 12 }}>Nro factura {!providerInvoiceNumber?.trim() && <Text type="danger">(obligatorio)</Text>}:</Text>
                                            <Input size="small" value={providerInvoiceNumber} onChange={e => setProviderInvoiceNumber(e.target.value)} placeholder="12345"
                                                status={!providerInvoiceNumber?.trim() ? 'error' : ''} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Modal>
                    )}
                </>)  : null}
            </Modal>

            {/* ══════ LOT CREATION MODAL ══════ */}
            {(() => {
                const lotsTotal = lotEntries.reduce((s, l) => s + (l.quantity || 0), 0);
                const maxQty = selectedPOItem?.quantityReceived || 0;
                const exceeds = lotsTotal > maxQty;
                const allValid = lotEntries.every(l => l.lotNumber?.trim() && l.quantity > 0 && l.expiresAtRaw?.trim());
                const canSubmit = allValid && !exceeds && lotsTotal > 0;
                // Detect unit: packaging materials use units, raw materials use grams
                const itemUnit = selectedPOItem?.siigoProductCode ? getProductUnit(selectedPOItem.siigoProductCode) : 'gramo';
                const isGram = itemUnit === 'gramo';
                const unitLabel = isGram ? 'g' : 'und';
                const fmtQty = (v) => isGram ? `${v?.toLocaleString()}g (${(v / 1000).toFixed(2)} kg)` : `${v?.toLocaleString()} und`;
                return (
            <Modal title={`📦 Registrar Lotes — ${selectedPOItem?.siigoProductName || ''}`} open={lotModalVisible}
                onCancel={() => setLotModalVisible(false)} onOk={submitLots} confirmLoading={submittingLots}
                okText="Registrar Lotes" width={700}
                okButtonProps={{ disabled: !canSubmit }}>
                {selectedPOItem && (
                    <div>
                        <Alert message={`Recibido: ${fmtQty(selectedPOItem.quantityReceived)} — Clasifica según los lotes que llegaron del proveedor`} type="info" showIcon style={{ marginBottom: 16 }} />
                        {/* Column headers */}
                        <div style={{ display: 'flex', gap: 8, padding: '0 8px', marginBottom: 4 }}>
                            <Text strong style={{ flex: 2, fontSize: 12 }}>N° Lote proveedor</Text>
                            <Text strong style={{ flex: 1, fontSize: 12 }}>Cantidad ({unitLabel})</Text>
                            <Text strong style={{ flex: 1, fontSize: 12 }}>Vencimiento</Text>
                            <div style={{ width: 24 }} />
                        </div>
                        {lotEntries.map((lot, idx) => (
                            <div key={idx} style={{ background: '#fafafa', padding: 10, marginBottom: 8, borderRadius: 8, border: '1px solid #eee' }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                    <Input placeholder="Ej: LOT-2024-001" value={lot.lotNumber} onChange={e => updateLotEntry(idx, 'lotNumber', e.target.value)} style={{ flex: 2 }} />
                                    <div style={{ flex: 1 }}>
                                        <InputNumber placeholder="0" value={lot.quantity} onChange={v => updateLotEntry(idx, 'quantity', v)}
                                            min={0} style={{ width: '100%' }} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} addonAfter={unitLabel}
                                            status={exceeds ? 'error' : ''} />
                                        {isGram && lot.quantity > 0 && (
                                            <div style={{ fontSize: 11, color: '#1890ff', marginTop: 2, textAlign: 'center' }}>= {(lot.quantity / 1000).toFixed(2)} kg</div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <input type="date" value={lot.expiresAtRaw || ''}
                                            onChange={e => {
                                                const newEntries = [...lotEntries];
                                                newEntries[idx] = { ...newEntries[idx], expiresAtRaw: e.target.value };
                                                setLotEntries(newEntries);
                                            }}
                                            className="px-3 py-2 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none"
                                            style={{ width: '100%' }}
                                        />
                                        {!lot.expiresAtRaw && <div style={{ fontSize: 10, color: '#ff4d4f', marginTop: 2 }}>⚠ Obligatorio</div>}
                                    </div>
                                    {lotEntries.length > 1 && <Button danger size="small" onClick={() => setLotEntries(lotEntries.filter((_, i) => i !== idx))}>×</Button>}
                                </div>
                                {/* Photo upload per lot */}
                                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: lot.photoPreview ? '#f6ffed' : '#fff7e6', border: `1px solid ${lot.photoPreview ? '#b7eb8f' : '#ffd591'}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                        {lot.photoPreview ? '✅ Foto tomada' : '📷 Tomar foto del lote'}
                                        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                                            onChange={e => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const newEntries = [...lotEntries];
                                                newEntries[idx] = { ...newEntries[idx], photoFile: file, photoPreview: URL.createObjectURL(file) };
                                                setLotEntries(newEntries);
                                            }} />
                                    </label>
                                    {lot.photoPreview && <img src={lot.photoPreview} alt="Lote" style={{ height: 40, borderRadius: 4, border: '1px solid #d9d9d9' }} />}
                                </div>
                            </div>
                        ))}
                        {/* Total summary */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: exceeds ? '#fff1f0' : lotsTotal === maxQty ? '#f6ffed' : '#e6f7ff', border: `1px solid ${exceeds ? '#ffa39e' : lotsTotal === maxQty ? '#b7eb8f' : '#91d5ff'}`, borderRadius: 6, marginBottom: 8 }}>
                            <Text strong style={{ fontSize: 12 }}>Total lotes: {fmtQty(lotsTotal)}</Text>
                            <Text type={lotsTotal === maxQty ? 'success' : 'danger'} strong style={{ fontSize: 12 }}>
                                {lotsTotal === maxQty ? '✅ Cuadra exacto' : exceeds
                                    ? `🚫 Excede por ${isGram ? ((lotsTotal - maxQty) / 1000).toLocaleString() + ' kg' : (lotsTotal - maxQty).toLocaleString() + ' und'}`
                                    : `⚠ Faltan: ${isGram ? ((maxQty - lotsTotal) / 1000).toLocaleString() + ' kg' : (maxQty - lotsTotal).toLocaleString() + ' und'}`}
                            </Text>
                        </div>
                        {exceeds && (
                            <Alert message={`No se puede registrar más de lo recibido (${fmtQty(maxQty)})`} type="error" showIcon style={{ marginBottom: 8 }} />
                        )}
                        <Button type="dashed" icon={<PlusOutlined />} onClick={addLotEntry} block>Agregar otro lote</Button>
                    </div>
                )}
            </Modal>
                );
            })()}
        </div>
        </>
    );
};

export default PurchaseOrdersPage;
