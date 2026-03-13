import React, { useState, useEffect } from 'react';
import { Card, Button, DatePicker, Upload, Table, Tag, Space, Progress, Typography, Alert, Row, Col, message, Modal } from 'antd';
import { SyncOutlined, UploadOutlined, FileExcelOutlined, HistoryOutlined, CheckCircleOutlined, LoadingOutlined, DownloadOutlined } from '@ant-design/icons';
import api from '../services/api';
import { socket } from '../services/socket';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;

const MovementsPage = () => {
    const [dateRange, setDateRange] = useState([dayjs().startOf('year'), dayjs()]);
    const [syncProgress, setSyncProgress] = useState(null);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(false);
    const [recentMovements, setRecentMovements] = useState([]);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadPhase, setUploadPhase] = useState('idle'); // idle, uploading, processing, completed, error
    const [uploadFileProgress, setUploadFileProgress] = useState(0);
    const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0, processed: 0, skipped: 0, percentage: 0 });

    useEffect(() => {
        fetchSummary();

        socket.on('sales:sync:progress', (data) => {
            setSyncProgress(data);
            if (data.status === 'COMPLETED' || data.status === 'ERROR') {
                fetchSummary();
            }
        });

        socket.on('production:upload:progress', (data) => {
            if (data.status === 'PROCESSING') {
                setUploadPhase('processing');
                setProcessingProgress({
                    current: data.current,
                    total: data.total,
                    processed: data.processed,
                    skipped: data.skipped,
                    percentage: data.percentage
                });
            } else if (data.status === 'COMPLETED') {
                setUploadPhase('completed');
                setProcessingProgress({
                    current: data.total,
                    total: data.total,
                    processed: data.processed,
                    skipped: data.skipped,
                    percentage: 100
                });
                fetchSummary();
            } else if (data.status === 'ERROR') {
                setUploadPhase('error');
            }
        });

        return () => {
            socket.off('sales:sync:progress');
            socket.off('production:upload:progress');
        };
    }, []);

    const fetchSummary = async () => {
        try {
            const response = await api.get('/movements/summary');
            setSummary(response.data);
            setRecentMovements(response.data.recent || []);
        } catch (error) {
            console.error('Error fetching movement summary:', error);
        }
    };

    const handleSync = async () => {
        if (!dateRange || !dateRange[0] || !dateRange[1]) {
            return message.warning('Por favor seleccione un rango de fechas');
        }

        setLoading(true);
        setSyncProgress({ status: 'STARTING', message: 'Iniciando...', percentage: 0 });

        try {
            await api.post('/movements/sync-sales', {
                dateStart: dateRange[0].format('YYYY-MM-DD'),
                dateEnd: dateRange[1].format('YYYY-MM-DD')
            });
            message.success('Sincronización iniciada correctamente');
        } catch (error) {
            message.error('Error al iniciar la sincronización');
            setSyncProgress({ status: 'ERROR', message: 'Error de conexión', percentage: 0 });
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (info) => {
        const { status } = info.file;
        if (status === 'uploading') return;

        const formData = new FormData();
        formData.append('file', info.file.originFileObj);

        try {
            setUploadModalOpen(true);
            setUploadPhase('uploading');
            setUploadFileProgress(0);
            setProcessingProgress({ current: 0, total: 0, processed: 0, skipped: 0, percentage: 0 });

            const response = await api.post('/movements/upload-production', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    setUploadFileProgress(pct);
                    if (pct >= 100) setUploadPhase('processing');
                }
            });

            // Response arrives after processing is complete
            setUploadPhase('completed');
            setProcessingProgress(prev => ({
                ...prev,
                processed: response.data.processed,
                skipped: response.data.skipped,
                percentage: 100
            }));
            fetchSummary();
        } catch (error) {
            setUploadPhase('error');
            message.error('Error al subir el archivo');
        }
    };

    const columns = [
        {
            title: 'Fecha',
            dataIndex: 'date',
            key: 'date',
            render: (date) => dayjs(date).format('DD/MM/YYYY'),
        },
        {
            title: 'Tipo',
            dataIndex: 'type',
            key: 'type',
            render: (type) => {
                const colors = { VTA: 'blue', PROD: 'green', CONS: 'orange' };
                const labels = { VTA: 'Venta', PROD: 'Producción', CONS: 'Consumo' };
                return <Tag color={colors[type]}>{labels[type]}</Tag>;
            }
        },
        {
            title: 'Documento',
            dataIndex: 'documentNumber',
            key: 'documentNumber',
        },
        {
            title: 'Producto / Cliente',
            key: 'info',
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{record.product?.name}</Text>
                    {record.customerName && <Text type="secondary" size="small">{record.customerName}</Text>}
                </Space>
            )
        },
        {
            title: 'Cantidad',
            dataIndex: 'quantity',
            key: 'quantity',
            render: (q) => <b>{q}</b>
        }
    ];

    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}>Gestión de Movimientos</Title>
            <Text type="secondary">Sincronice sus ventas desde Siigo y cargue sus reportes de producción.</Text>

            <Row gutter={[24, 24]} style={{ marginTop: '24px' }}>
                {/* SIIGO SYNC CARD */}
                <Col xs={24} md={12}>
                    <Card title={<Space><SyncOutlined /> Sincronización Siigo (Ventas)</Space>} bordered={false} hoverable>
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                            <Alert
                                message="Sincronización Automática"
                                description="Al finalizar la carga histórica, el sistema mantendrá las ventas al día automáticamente."
                                type="info"
                                showIcon
                            />
                            <div>
                                <Text strong>Rango de Fechas (Carga Histórica):</Text>
                                <div style={{ marginTop: '8px' }}>
                                    <RangePicker
                                        style={{ width: '100%' }}
                                        value={dateRange}
                                        onChange={setDateRange}
                                    />
                                </div>
                            </div>
                            <Button
                                type="primary"
                                icon={loading ? <LoadingOutlined /> : <SyncOutlined />}
                                size="large"
                                block
                                onClick={handleSync}
                                disabled={loading || (syncProgress && syncProgress.status === 'SYNCING')}
                            >
                                Iniciar Sincronización de Ventas
                            </Button>
                            {syncProgress && (
                                <div style={{ marginTop: '16px' }}>
                                    <Text type="secondary">{syncProgress.message}</Text>
                                    <Progress
                                        percent={syncProgress.percentage}
                                        status={syncProgress.status === 'ERROR' ? 'exception' : 'active'}
                                        strokeColor={syncProgress.status === 'COMPLETED' ? '#52c41a' : undefined}
                                    />
                                </div>
                            )}
                        </Space>
                    </Card>
                </Col>

                {/* EXCEL UPLOAD CARD */}
                <Col xs={24} md={12}>
                    <Card title={<Space><FileExcelOutlined /> Carga de Producción (Excel)</Space>} bordered={false} hoverable>
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                            <Alert
                                message="Notas de Ensamble"
                                description="Suba el archivo Movimiento.xlsx para procesar las entradas (PROD) y consumos (CONS)."
                                type="success"
                                showIcon
                            />
                            <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed #d9d9d9', borderRadius: '8px' }}>
                                <Upload
                                    showUploadList={false}
                                    customRequest={({ file, onSuccess }) => {
                                        setTimeout(() => onSuccess("ok"), 0);
                                    }}
                                    onChange={handleUpload}
                                >
                                    <Button icon={<UploadOutlined />} size="large">Seleccionar Archivo Excel</Button>
                                </Upload>
                            </div>

                            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '12px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <Text strong style={{ fontSize: 13 }}>📋 El archivo debe seguir esta plantilla:</Text>
                                    <Button
                                        type="link"
                                        icon={<DownloadOutlined />}
                                        size="small"
                                        href="/uploads/plantilla_movimientos.xlsx"
                                        target="_blank"
                                        style={{ fontWeight: 600 }}
                                    >
                                        Descargar Plantilla
                                    </Button>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: '#e6f7e6' }}>
                                                {['Code', 'Name', 'Doc (NE-...)', 'Date (DD/MM/YYYY)', 'Entry', 'Exit'].map(h => (
                                                    <th key={h} style={{ padding: '4px 6px', border: '1px solid #d9d9d9', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', fontFamily: 'monospace' }}>MPT001</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}>AGUA</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', fontFamily: 'monospace' }}>NE-1-001</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}>01/03/2026</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', color: '#52c41a', fontWeight: 700 }}>48000</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}></td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', fontFamily: 'monospace' }}>MPET001</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}>AZUCAR</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', fontFamily: 'monospace' }}>NE-1-001</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}>01/03/2026</td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9' }}></td>
                                                <td style={{ padding: '3px 6px', border: '1px solid #d9d9d9', color: '#fa8c16', fontWeight: 700 }}>30000</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                                    Entry = producido (PROD) · Exit = consumido (CONS) · Doc debe iniciar con <b>NE</b>
                                </Text>
                            </div>

                            <div style={{ marginTop: '20px' }}>
                                <Title level={5}>Resumen Acumulado</Title>
                                <Row gutter={16}>
                                    <Col span={12}>
                                        <Card size="small" style={{ textAlign: 'center' }}>
                                            <Text type="secondary">Total Ventas</Text>
                                            <Title level={4}>{summary?.sales?._sum?.quantity || 0}</Title>
                                        </Card>
                                    </Col>
                                    <Col span={12}>
                                        <Card size="small" style={{ textAlign: 'center' }}>
                                            <Text type="secondary">Total Producción</Text>
                                            <Title level={4}>{summary?.production?._sum?.quantity || 0}</Title>
                                        </Card>
                                    </Col>
                                </Row>
                            </div>
                        </Space>
                    </Card>
                </Col>

                {/* HISTORY TABLE */}
                <Col span={24}>
                    <Card title={<Space><HistoryOutlined /> Últimos Movimientos</Space>} bordered={false}>
                        <Table
                            columns={columns}
                            dataSource={recentMovements}
                            rowKey="id"
                            pagination={{ pageSize: 5 }}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Processing Modal */}
            <Modal
                title={
                    uploadPhase === 'completed' ? '✅ Carga Completada' :
                        uploadPhase === 'error' ? '❌ Error en la Carga' :
                            '📊 Procesando Movimientos'
                }
                open={uploadModalOpen}
                footer={uploadPhase === 'completed' || uploadPhase === 'error' ? [
                    <Button key="close" type="primary" onClick={() => setUploadModalOpen(false)}>
                        Cerrar
                    </Button>
                ] : null}
                closable={uploadPhase === 'completed' || uploadPhase === 'error'}
                onCancel={() => setUploadModalOpen(false)}
                centered
            >
                <div style={{ textAlign: 'center', padding: '20px' }}>
                    {/* Phase 1: File Upload */}
                    {uploadPhase === 'uploading' && (
                        <>
                            <Progress type="circle" percent={uploadFileProgress} />
                            <div style={{ marginTop: 16 }}>
                                <Text strong>Subiendo archivo al servidor...</Text>
                            </div>
                        </>
                    )}

                    {/* Phase 2: Processing rows */}
                    {uploadPhase === 'processing' && (
                        <>
                            <Progress
                                type="circle"
                                percent={processingProgress.percentage}
                                format={() => `${processingProgress.percentage}%`}
                                strokeColor="#722ed1"
                            />
                            <div style={{ marginTop: 16, marginBottom: 16 }}>
                                <Text strong style={{ fontSize: 16 }}>Procesando filas del Excel...</Text>
                            </div>
                            <Row gutter={16}>
                                <Col span={8}>
                                    <div style={{ background: '#f6ffed', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: '#52c41a' }}>{processingProgress.processed}</div>
                                        <div style={{ fontSize: 11, color: '#888' }}>NE Procesadas</div>
                                    </div>
                                </Col>
                                <Col span={8}>
                                    <div style={{ background: '#fff7e6', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: '#fa8c16' }}>{processingProgress.skipped}</div>
                                        <div style={{ fontSize: 11, color: '#888' }}>Saltadas</div>
                                    </div>
                                </Col>
                                <Col span={8}>
                                    <div style={{ background: '#f0f5ff', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: '#1890ff' }}>{processingProgress.current}/{processingProgress.total}</div>
                                        <div style={{ fontSize: 11, color: '#888' }}>Fila actual</div>
                                    </div>
                                </Col>
                            </Row>
                            <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
                                Por favor no cierre esta ventana...
                            </Text>
                        </>
                    )}

                    {/* Phase 3: Completed */}
                    {uploadPhase === 'completed' && (
                        <>
                            <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
                            <div style={{ marginTop: 16, marginBottom: 16 }}>
                                <Text strong style={{ fontSize: 18 }}>¡Carga completada!</Text>
                            </div>
                            <Row gutter={16}>
                                <Col span={12}>
                                    <div style={{ background: '#f6ffed', borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 28, fontWeight: 800, color: '#52c41a' }}>{processingProgress.processed}</div>
                                        <div style={{ fontSize: 13, color: '#888' }}>NE Procesadas</div>
                                    </div>
                                </Col>
                                <Col span={12}>
                                    <div style={{ background: '#fff7e6', borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 28, fontWeight: 800, color: '#fa8c16' }}>{processingProgress.skipped}</div>
                                        <div style={{ fontSize: 13, color: '#888' }}>Filas saltadas</div>
                                    </div>
                                </Col>
                            </Row>
                        </>
                    )}

                    {/* Error */}
                    {uploadPhase === 'error' && (
                        <>
                            <div style={{ fontSize: 64 }}>❌</div>
                            <div style={{ marginTop: 16 }}>
                                <Text strong style={{ color: '#ff4d4f', fontSize: 16 }}>Error al procesar el archivo</Text>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default MovementsPage;
