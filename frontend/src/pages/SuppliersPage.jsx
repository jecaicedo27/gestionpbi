import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, InputNumber, Button, Input, Typography, message, Tag, Space, Modal, Alert, Progress } from 'antd';
import { SaveOutlined, SearchOutlined, ReloadOutlined, LockOutlined, CheckCircleOutlined, WarningOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const { Title, Text } = Typography;

const SuppliersPage = () => {
    const { user } = useAuth();
    const canEdit = ['ADMIN', 'CONTABILIDAD'].includes(user?.role);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [editedRows, setEditedRows] = useState({});
    const [saving, setSaving] = useState({});

    // Security code modal state
    const [codeModal, setCodeModal] = useState({ open: false, supplier: null, isBulk: false });
    const [securityCode, setSecurityCode] = useState('');
    const [codeError, setCodeError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState(null);
    const [syncProgress, setSyncProgress] = useState(0);

    const syncFromSiigo = async () => {
        setSyncing(true);
        setSyncResult(null);
        setSyncProgress(5);

        try {
            // Kick off background sync
            await api.post('/procurement/suppliers/sync');

            // Poll for status
            const poll = setInterval(async () => {
                try {
                    const res = await api.get('/procurement/suppliers/sync-status');
                    const { running, result } = res.data;

                    if (running) {
                        setSyncProgress(prev => Math.min(prev + 3, 90));
                    } else if (result) {
                        clearInterval(poll);
                        setSyncProgress(100);
                        if (result.success) {
                            setSyncResult({ success: true, synced: result.synced, total: result.total });
                            loadSuppliers();
                        } else {
                            setSyncResult({ success: false, error: result.error || 'Error desconocido' });
                        }
                        setSyncing(false);
                        setTimeout(() => setSyncResult(null), 10000);
                    } else {
                        // No result yet, still initializing
                        setSyncProgress(prev => Math.min(prev + 1, 30));
                    }
                } catch {
                    // polling error, keep trying
                }
            }, 3000);

        } catch (err) {
            setSyncProgress(0);
            setSyncResult({ success: false, error: err.response?.data?.error || 'Error iniciando sincronización' });
            setSyncing(false);
            setTimeout(() => setSyncResult(null), 8000);
        }
    };

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

    // Open security code modal before saving
    const requestSave = (supplier) => {
        setCodeModal({ open: true, supplier, isBulk: false });
        setSecurityCode('');
        setCodeError('');
    };

    const requestSaveAll = () => {
        const ids = Object.keys(editedRows);
        if (!ids.length) return message.info('No hay cambios pendientes');
        setCodeModal({ open: true, supplier: null, isBulk: true });
        setSecurityCode('');
        setCodeError('');
    };

    // Actually save with the security code
    const doSaveRow = async (supplier, code) => {
        const edits = editedRows[supplier.id];
        if (!edits) return true;
        try {
            await api.put(`/procurement/suppliers/${supplier.id}/tax-config`, {
                ivaRate: edits.ivaRate !== undefined ? edits.ivaRate : supplier.ivaRate,
                reteFuenteRate: edits.reteFuenteRate !== undefined ? edits.reteFuenteRate : supplier.reteFuenteRate,
                paymentTermDays: edits.paymentTermDays !== undefined ? edits.paymentTermDays : supplier.paymentTermDays,
                securityCode: code
            });
            setEditedRows(prev => { const n = { ...prev }; delete n[supplier.id]; return n; });
            return true;
        } catch (err) {
            if (err.response?.status === 403) return false; // wrong code
            message.error(`Error guardando ${supplier.name}`);
            return true; // non-code error, don't show code error
        }
    };

    const handleCodeConfirm = async () => {
        if (!securityCode) { setCodeError('Ingrese el código'); return; }
        setSaving(prev => ({ ...prev, _modal: true }));

        if (codeModal.isBulk) {
            // Save all edited suppliers
            const ids = Object.keys(editedRows);
            let firstFail = false;
            for (const id of ids) {
                const s = suppliers.find(s => s.id === id);
                if (!s) continue;
                const ok = await doSaveRow(s, securityCode);
                if (!ok) { firstFail = true; break; }
            }
            if (firstFail) {
                setCodeError('Código de seguridad incorrecto');
            } else {
                message.success(`✅ ${ids.length} proveedores actualizados`);
                setCodeModal({ open: false, supplier: null, isBulk: false });
                loadSuppliers();
            }
        } else {
            // Save single supplier
            const ok = await doSaveRow(codeModal.supplier, securityCode);
            if (!ok) {
                setCodeError('Código de seguridad incorrecto');
            } else {
                message.success(`✅ ${codeModal.supplier.name} actualizado`);
                setCodeModal({ open: false, supplier: null, isBulk: false });
                loadSuppliers();
            }
        }
        setSaving(prev => ({ ...prev, _modal: false }));
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
                    style={{ width: 70 }} disabled={!canEdit} />
            )
        },
        {
            title: 'Retefuente %', key: 'reteFuenteRate', width: '12%', align: 'center',
            render: (_, r) => (
                <InputNumber size="small" min={0} max={100} step={0.5}
                    value={getValue(r, 'reteFuenteRate') ?? ''} placeholder="0"
                    onChange={v => handleEdit(r.id, 'reteFuenteRate', v)}
                    style={{ width: 70 }} disabled={!canEdit} />
            )
        },
        {
            title: 'Plazo (días)', key: 'paymentTermDays', width: '12%', align: 'center',
            render: (_, r) => (
                <InputNumber size="small" min={0} max={365}
                    value={getValue(r, 'paymentTermDays') ?? ''} placeholder="30"
                    onChange={v => handleEdit(r.id, 'paymentTermDays', v)}
                    style={{ width: 70 }} disabled={!canEdit} />
            )
        },
        {
            title: 'Estado', key: 'status', width: '18%', align: 'center',
            render: (_, r) => {
                const confirmed = r.fiscalConfigConfirmed;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        {confirmed
                            ? <Tag icon={<CheckCircleOutlined />} color="success">Configurado</Tag>
                            : <Tag icon={<WarningOutlined />} color="warning">Sin confirmar</Tag>
                        }
                        <Space size={4}>
                            {(r.ivaRate ?? 0) > 0 ? <Tag color="blue" style={{ fontSize: 10 }}>IVA {r.ivaRate}%</Tag> : <Tag style={{ fontSize: 10 }}>Sin IVA</Tag>}
                            {(r.reteFuenteRate ?? 0) > 0 ? <Tag color="orange" style={{ fontSize: 10 }}>RF {r.reteFuenteRate}%</Tag> : <Tag style={{ fontSize: 10 }}>Sin RF</Tag>}
                        </Space>
                    </div>
                );
            }
        },
        {
            title: '', key: 'actions', width: '10%', align: 'center',
            render: (_, r) => editedRows[r.id] ? (
                <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving[r.id]} onClick={() => requestSave(r)}>
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
                    {canEdit && pendingCount > 0 && (
                        <Button type="primary" icon={<SaveOutlined />} onClick={requestSaveAll}>
                            Guardar todos ({pendingCount})
                        </Button>
                    )}
                    {canEdit && (
                        <Button icon={<CloudDownloadOutlined />} loading={syncing} onClick={syncFromSiigo}>
                            Sincronizar desde Siigo
                        </Button>
                    )}
                    <Button icon={<ReloadOutlined />} onClick={loadSuppliers}>Actualizar</Button>
                </Space>
            </div>

            {/* Sync progress bar */}
            {syncing && (
                <Card size="small" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CloudDownloadOutlined style={{ fontSize: 20, color: '#1677ff' }} />
                        <div style={{ flex: 1 }}>
                            <Text strong style={{ fontSize: 13 }}>Sincronizando proveedores desde Siigo...</Text>
                            <Progress percent={Math.round(syncProgress)} status="active" strokeColor={{ from: '#1677ff', to: '#52c41a' }} size="small" />
                        </div>
                    </div>
                </Card>
            )}

            {/* Sync result */}
            {syncResult && !syncing && (
                <Alert
                    message={syncResult.success ? `✅ Sincronización completada` : `❌ Error en sincronización`}
                    description={syncResult.success
                        ? `Se sincronizaron ${syncResult.synced} proveedores de ${syncResult.total} encontrados en Siigo.`
                        : syncResult.error
                    }
                    type={syncResult.success ? 'success' : 'error'}
                    showIcon
                    closable
                    onClose={() => setSyncResult(null)}
                    style={{ marginBottom: 16 }}
                />
            )}

            {!canEdit && (
                <Alert
                    message="Solo lectura"
                    description="Solo el área de Contabilidad puede configurar IVA y Retención de proveedores. Si necesita cambios, solicítelos al equipo de Contabilidad."
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Card size="small" style={{ marginBottom: 16 }}>
                <Input prefix={<SearchOutlined />} placeholder="Buscar proveedor por nombre o NIT..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    allowClear style={{ maxWidth: 400 }} />
            </Card>

            <Table dataSource={suppliers} columns={columns} rowKey="id" loading={loading}
                size="small" pagination={{ pageSize: 50, showTotal: t => `${t} proveedores` }}
                rowClassName={r => editedRows[r.id] ? 'ant-table-row-selected' : ''} />

            {/* Security Code Modal */}
            <Modal
                open={codeModal.open}
                title={<span><LockOutlined style={{ marginRight: 8 }} />Confirmar Configuración Fiscal</span>}
                onCancel={() => setCodeModal({ open: false, supplier: null, isBulk: false })}
                onOk={handleCodeConfirm}
                okText="Confirmar"
                cancelText="Cancelar"
                confirmLoading={saving._modal}
                centered
            >
                <div style={{ marginBottom: 16 }}>
                    <Text>Esta acción actualizará la configuración de <strong>IVA y Retención</strong> del proveedor{codeModal.isBulk ? ` (${pendingCount} proveedores)` : codeModal.supplier ? ` "${codeModal.supplier.name}"` : ''}.</Text>
                </div>
                <div style={{ marginBottom: 8 }}>
                    <Text strong>Ingrese el código de seguridad de contabilidad:</Text>
                </div>
                <Input.Password
                    prefix={<LockOutlined />}
                    placeholder="Código de seguridad"
                    value={securityCode}
                    onChange={e => { setSecurityCode(e.target.value); setCodeError(''); }}
                    onPressEnter={handleCodeConfirm}
                    status={codeError ? 'error' : undefined}
                    size="large"
                    maxLength={10}
                    autoFocus
                />
                {codeError && <div style={{ color: '#ff4d4f', marginTop: 6, fontSize: 13 }}>❌ {codeError}</div>}
            </Modal>
        </div>
    );
};

export default SuppliersPage;
