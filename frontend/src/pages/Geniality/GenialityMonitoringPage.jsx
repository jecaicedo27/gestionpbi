import React, { useState, useEffect } from 'react';
import { Table, Tag, Modal, Button, Spin, Tag as AntTag, Tooltip, message, Card, Typography, Row, Col, Descriptions } from 'antd';
import { SyncOutlined, CheckCircleOutlined, InfoCircleOutlined, CodeSandboxOutlined, ThunderboltOutlined, DatabaseOutlined, RightOutlined } from '@ant-design/icons';
import api from '../../services/api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const GenialityMonitoringPage = () => {
    const [loading, setLoading] = useState(true);
    const [batches, setBatches] = useState([]);
    const [modalConfig, setModalConfig] = useState({ visible: false, type: null, data: null });

    const fetchBatches = async () => {
        try {
            setLoading(true);
            const res = await api.get('/geniality/production/monitor/batches?limit=30');
            if (res.data?.ok) {
                setBatches(res.data.batches);
            }
        } catch (err) {
            message.error('Error al cargar lotes: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBatches();
        const interval = setInterval(fetchBatches, 30000); // Auto refresh 30s
        return () => clearInterval(interval);
    }, []);

    const openModal = (type, data) => setModalConfig({ visible: true, type, data });
    const closeModal = () => setModalConfig({ visible: false, type: null, data: null });

    const renderNoteTag = (note) => {
        if (!note) return <Text type="secondary">N/A</Text>;
        let color = 'default';
        if (note.status === 'COMPLETED') color = 'success';
        if (note.status === 'IN_PROGRESS') color = 'processing';
        return (
            <Tooltip title={`Responsable: ${note.completedBy?.name || note.executedBy?.name || 'Pendiente'}`}>
                <Tag color={color} className="mr-1 mb-1 cursor-pointer hover:opacity-80" onClick={() => openModal('NOTE_DETAILS', note)}>
                    {note.noteNumber} <br/><small>{Number(note.actualQuantity||0).toFixed(2)} {note.unit}</small>
                </Tag>
            </Tooltip>
        );
    };

    const renderSiigoSync = (record) => {
        // Collect all RPA executions from all notes in this batch
        const rpas = record.allNotes.flatMap(n => n.rpaExecutions || []);
        if (rpas.length === 0) return <Tag color="default">Esperando Empaque</Tag>;
        
        const success = rpas.filter(r => r.status === 'SUCCESS');
        const running = rpas.filter(r => r.status === 'RUNNING');
        const failed = rpas.filter(r => r.status === 'FAILED');

        return (
            <div className="flex flex-col gap-1">
                {success.length > 0 && <Tag color="success" icon={<CheckCircleOutlined />}>{success.length} Ops Siigo OK</Tag>}
                {running.length > 0 && <Tag color="processing" icon={<SyncOutlined spin />}>{running.length} En Proceso</Tag>}
                {failed.length > 0 && <Tag color="error">{failed.length} Errores</Tag>}
            </div>
        );
    };

    const columns = [
        {
            title: 'LOTE BATCH',
            key: 'batchNumber',
            render: (_, record) => (
                <div>
                    <div className="font-bold text-gray-800 flex items-center gap-1">
                        <DatabaseOutlined /> {record.batchNumber}
                    </div>
                    <Text type="secondary" className="text-xs">{record.product}</Text>
                    <div className="text-xs text-blue-500 mt-1">{dayjs(record.createdAt).format('DD/MM/YYYY HH:mm')}</div>
                </div>
            )
        },
        {
            title: 'FASE 1: BASE SIROPE',
            key: 'base',
            render: (_, record) => (
                <div className="space-y-2">
                    <div><b>Pesaje:</b> {renderNoteTag(record.base.pesaje)}</div>
                    <div><b>Ensamble:</b> {renderNoteTag(record.base.ensamble)}</div>
                    {record.base.materialLots?.length > 0 && (
                         <div className="text-[10px] text-green-700 font-bold bg-green-50 p-1 rounded-md border border-green-200 inline-block">
                             📦 Lote Stock Inyectado: {record.base.materialLots.reduce((sum, ml) => sum + ml.currentQuantity, 0)} g
                         </div>
                    )}
                </div>
            )
        },
        {
            title: 'FASE 2: SABORIZACIÓN',
            key: 'saborizacion',
            render: (_, record) => (
                <div className="flex flex-wrap max-w-[200px]">
                    {record.saborizacion?.length > 0 ? record.saborizacion.map(n => renderNoteTag(n)) : <Text type="secondary">--</Text>}
                </div>
            )
        },
        {
            title: 'FASE 3: CARRITOS (EMPAQUE)',
            key: 'carritos',
            render: (_, record) => {
                const fs = record.empaque?.finishedStocks || [];
                return (
                    <div className="flex flex-col gap-1">
                        {fs.length > 0 ? fs.map(f => (
                            <Tag color="cyan" key={f.id} className="cursor-pointer" onClick={() => openModal('STOCK_DETAILS', f)}>
                                {f.initialQuantity}x {f.product?.name?.replace(/SIROPE|GENIALITY|MARCA/gi, '').trim() || 'Carrito'} 
                            </Tag>
                        )) : <Tag color="default">Sin empacar</Tag>}
                    </div>
                )
            }
        },
        {
            title: 'INTEGRACIÓN SIIGO',
            key: 'siigo',
            render: (_, record) => renderSiigoSync(record)
        }
    ];

    const renderModalContent = () => {
        const { type, data } = modalConfig;
        if (!data) return null;

        if (type === 'NOTE_DETAILS') {
            return (
                <div className="space-y-4">
                    <Descriptions bordered size="small" column={2}>
                        <Descriptions.Item label="Nota">{data.noteNumber}</Descriptions.Item>
                        <Descriptions.Item label="Estado">
                            <Tag color={data.status === 'COMPLETED' ? 'success' : 'default'}>{data.status}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Responsable">{data.completedBy?.name || data.executedBy?.name || 'N/A'}</Descriptions.Item>
                        <Descriptions.Item label="Fecha Fin">{data.completedAt ? dayjs(data.completedAt).format('DD/MM/YYYY HH:mm') : 'N/A'}</Descriptions.Item>
                        <Descriptions.Item label="Esperado">{data.targetQuantity} {data.unit}</Descriptions.Item>
                        <Descriptions.Item label="Real Producido"><b>{data.actualQuantity} {data.unit}</b></Descriptions.Item>
                    </Descriptions>

                    <Title level={5} className="mt-4">📋 Consumos Registrados</Title>
                    <Table 
                        dataSource={data.items || []} 
                        rowKey="id" 
                        size="small"
                        pagination={false}
                        columns={[
                            { title: 'Insumo', dataIndex: ['component', 'name'] },
                            { title: 'Esperado', dataIndex: 'plannedQuantity', render: v => `${Number(v||0).toFixed(2)}` },
                            { title: 'Real Consumido', dataIndex: 'actualQuantity', render: v => <b className="text-blue-600">{Number(v||0).toFixed(2)}</b> },
                            { title: 'Lote Origen', dataIndex: 'lotNumber', render: v => v ? <Tag>{v}</Tag> : '-' }
                        ]}
                    />

                    {data.rpaExecutions?.length > 0 && (
                        <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-md shadow-sm">
                            <Title level={5}>🤖 Integración Siigo (RPA)</Title>
                            {data.rpaExecutions.map(r => (
                                <div key={r.id} className="text-xs mb-1">
                                    <Tag color={r.status === 'SUCCESS' ? 'success' : 'error'}>{r.status}</Tag> 
                                    <b>{r.executionType}</b> - {r.productName} 
                                    {r.siigoNoteCode && <a href={r.siigoUrl} target="_blank" className="ml-2">Ver En Siigo ({r.siigoNoteCode})</a>}
                                    {r.errorMessage && <div className="text-red-500 mt-1">{r.errorMessage}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (type === 'STOCK_DETAILS') {
            return (
                <div className="space-y-4">
                    <Descriptions bordered size="small" column={1}>
                        <Descriptions.Item label="Producto">{data.product?.name}</Descriptions.Item>
                        <Descriptions.Item label="SKU">{data.product?.sku}</Descriptions.Item>
                        <Descriptions.Item label="Lote">{data.lotNumber}</Descriptions.Item>
                        <Descriptions.Item label="Unidades Iniciales">{data.initialQuantity}</Descriptions.Item>
                        <Descriptions.Item label="Disponibles Actualmente"><b>{data.currentQuantity}</b></Descriptions.Item>
                        <Descriptions.Item label="Ubicación Física">
                           <Tag color="purple">{data.zone}</Tag>
                        </Descriptions.Item>
                    </Descriptions>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <Title level={3} className="m-0"><CodeSandboxOutlined /> Monitoreo de Producción: Geniality Siropes</Title>
                    <Text type="secondary">Panel en tiempo real para auditoría de Lotes Maestro, integración PBA y cruces contables Siigo.</Text>
                </div>
                <Button type="primary" icon={<SyncOutlined />} onClick={fetchBatches} loading={loading}>
                    Refrescar
                </Button>
            </div>

            <Card className="shadow-sm rounded-xl">
                <Table 
                    columns={columns} 
                    dataSource={batches} 
                    rowKey="id" 
                    loading={loading}
                    pagination={{ pageSize: 15 }}
                    size="middle"
                />
            </Card>

            <Modal
                title={modalConfig.type === 'NOTE_DETAILS' ? 'Detalle de Trazabilidad de Nota' : 'Detalle de Empaque / Carrito'}
                open={modalConfig.visible}
                onCancel={closeModal}
                footer={[<Button key="close" onClick={closeModal}>Cerrar Inspección</Button>]}
                width={800}
                destroyOnClose
            >
                {renderModalContent()}
            </Modal>
        </div>
    );
};

export default GenialityMonitoringPage;
