import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, InputNumber, Button, Input, Typography, message, Tag, Space, Tooltip } from 'antd';
import { SaveOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../services/api';

const { Title, Text } = Typography;

const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [editedRows, setEditedRows] = useState({}); // {supplierId: {ivaRate, reteFuenteRate, paymentTermDays}}
    const [saving, setSaving] = useState({});

    const loadSuppliers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/procurement/suppliers', { params: search ? { search } : {} });
            setSuppliers(res.data);
        } catch { message.error('Error cargando proveedores'); }
        setLoading(false);
    }, [search]);

    useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

    const handleEdit = (supplierId, field, value) => {
        setEditedRows(prev => ({
            ...prev,
            [supplierId]: { ...prev[supplierId], [field]: value }
        }));
    };

    const saveRow = async (supplier) => {
        const edits = editedRows[supplier.id];
        if (!edits) return;
        setSaving(prev => ({ ...prev, [supplier.id]: true }));
        try {
            await api.put(`/procurement/suppliers/${supplier.id}/tax-config`, {
                ivaRate: edits.ivaRate !== undefined ? edits.ivaRate : supplier.ivaRate,
                reteFuenteRate: edits.reteFuenteRate !== undefined ? edits.reteFuenteRate : supplier.reteFuenteRate,
                paymentTermDays: edits.paymentTermDays !== undefined ? edits.paymentTermDays : supplier.paymentTermDays
            });
            message.success(`✅ ${supplier.name} actualizado`);
            setEditedRows(prev => { const n = { ...prev }; delete n[supplier.id]; return n; });
            loadSuppliers();
        } catch { message.error('Error guardando'); }
        setSaving(prev => ({ ...prev, [supplier.id]: false }));
    };

    const saveAll = async () => {
        const ids = Object.keys(editedRows);
        if (!ids.length) return message.info('No hay cambios pendientes');
        for (const id of ids) {
            const s = suppliers.find(s => s.id === id);
            if (s) await saveRow(s);
        }
    };

    const getValue = (supplier, field) => {
        if (editedRows[supplier.id]?.[field] !== undefined) return editedRows[supplier.id][field];
        return supplier[field];
    };

    const columns = [
        {
            title: 'Proveedor', dataIndex: 'name', key: 'name', width: '30%',
            render: (name, r) => (
                <div>
                    <Text strong>{name}</Text>
                    {r.identification && <div style={{ fontSize: 11, color: '#888' }}>NIT: {r.identification}</div>}
                </div>
            ),
            sorter: (a, b) => a.name.localeCompare(b.name),
            defaultSortOrder: 'ascend'
        },
        {
            title: 'IVA %', key: 'ivaRate', width: '12%', align: 'center',
            render: (_, r) => (
                <InputNumber size="small" min={0} max={100} step={1}
                    value={getValue(r, 'ivaRate') ?? ''} placeholder="0"
                    onChange={v => handleEdit(r.id, 'ivaRate', v)}
                    style={{ width: 70 }} />
            )
        },
        {
            title: 'Retefuente %', key: 'reteFuenteRate', width: '12%', align: 'center',
            render: (_, r) => (
                <InputNumber size="small" min={0} max={100} step={0.5}
                    value={getValue(r, 'reteFuenteRate') ?? ''} placeholder="0"
                    onChange={v => handleEdit(r.id, 'reteFuenteRate', v)}
                    style={{ width: 70 }} />
            )
        },
        {
            title: 'Plazo (días)', key: 'paymentTermDays', width: '12%', align: 'center',
            render: (_, r) => (
                <InputNumber size="small" min={0} max={365}
                    value={getValue(r, 'paymentTermDays') ?? ''} placeholder="30"
                    onChange={v => handleEdit(r.id, 'paymentTermDays', v)}
                    style={{ width: 70 }} />
            )
        },
        {
            title: 'Estado', key: 'status', width: '15%', align: 'center',
            render: (_, r) => {
                const hasIva = (r.ivaRate ?? 0) > 0;
                const hasRete = (r.reteFuenteRate ?? 0) > 0;
                return (
                    <Space size={4}>
                        {hasIva ? <Tag color="blue">IVA {r.ivaRate}%</Tag> : <Tag>Sin IVA</Tag>}
                        {hasRete ? <Tag color="orange">RF {r.reteFuenteRate}%</Tag> : <Tag color="default">Sin RF</Tag>}
                    </Space>
                );
            }
        },
        {
            title: '', key: 'actions', width: '10%', align: 'center',
            render: (_, r) => editedRows[r.id] ? (
                <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving[r.id]} onClick={() => saveRow(r)}>
                    Guardar
                </Button>
            ) : null
        }
    ];

    const pendingCount = Object.keys(editedRows).length;

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={4} style={{ margin: 0 }}>🏢 Proveedores — Configuración Fiscal</Title>
                <Space>
                    {pendingCount > 0 && (
                        <Button type="primary" icon={<SaveOutlined />} onClick={saveAll}>
                            Guardar todos ({pendingCount})
                        </Button>
                    )}
                    <Button icon={<ReloadOutlined />} onClick={loadSuppliers}>Actualizar</Button>
                </Space>
            </div>

            <Card size="small" style={{ marginBottom: 16 }}>
                <Input prefix={<SearchOutlined />} placeholder="Buscar proveedor por nombre o NIT..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    allowClear style={{ maxWidth: 400 }} />
            </Card>

            <Table dataSource={suppliers} columns={columns} rowKey="id" loading={loading}
                size="small" pagination={{ pageSize: 50, showTotal: t => `${t} proveedores` }}
                rowClassName={r => editedRows[r.id] ? 'ant-table-row-selected' : ''} />
        </div>
    );
};

export default SuppliersPage;
