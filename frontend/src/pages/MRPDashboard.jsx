import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Typography, Space, Button, Row, Col, Statistic, Alert, Spin, message, Progress } from 'antd';
import {
    ShoppingOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    DownloadOutlined,
    ReloadOutlined
} from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;

function MRPDashboard() {
    const [requirements, setRequirements] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/mrp/requirements');
            setRequirements(res.data);
        } catch (error) {
            console.error('Error fetching MRP data:', error);
            message.error('Error al cargar Planeación de Materiales');
        } finally {
            setLoading(false);
        }
    };

    const totalItems = requirements.length;
    const shortages = requirements.filter(r => r.shortage > 0).length;
    const healthPercentage = totalItems > 0 ? Math.round(((totalItems - shortages) / totalItems) * 100) : 0;

    const columns = [
        {
            title: 'Materia Prima / Insumo',
            dataIndex: 'name',
            key: 'name',
            render: (text, record) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{text}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>SKU: {record.sku}</Text>
                </Space>
            )
        },
        {
            title: 'Necesario (Plan)',
            dataIndex: 'requiredQty',
            key: 'requiredQty',
            align: 'right',
            render: (val, record) => <Text strong>{val.toLocaleString()} {record.unit}</Text>
        },
        {
            title: 'Stock SIIGO',
            dataIndex: 'currentStock',
            key: 'currentStock',
            align: 'right',
            render: (val, record) => (
                <Text type={val < record.requiredQty ? 'danger' : 'success'}>
                    {val.toLocaleString()} {record.unit}
                </Text>
            )
        },
        {
            title: 'Faltante',
            dataIndex: 'shortage',
            key: 'shortage',
            align: 'right',
            render: (val, record) => (
                val > 0 ?
                    <Tag color="red" style={{ fontWeight: 'bold' }}>{val.toLocaleString()} {record.unit}</Tag> :
                    <Tag color="green">OK</Tag>
            )
        },
        {
            title: 'Estado Crítico',
            key: 'status',
            render: (_, record) => {
                const ratio = record.currentStock / record.requiredQty;
                if (record.shortage > 0) {
                    return <Progress percent={Math.round(ratio * 100)} size="small" status="exception" strokeColor="#ff4d4f" />;
                }
                return <Progress percent={100} size="small" strokeColor="#52c41a" />;
            }
        }
    ];

    return (
        <div style={{ padding: 24 }}>
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                    <Card size="small">
                        <Statistic
                            title="Salud de Inventario para Plan"
                            value={healthPercentage}
                            suffix="%"
                            prefix={<CheckCircleOutlined />}
                            valueStyle={{ color: healthPercentage > 80 ? '#3f8600' : '#faad14' }}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card size="small">
                        <Statistic
                            title="Materiales con Faltantes"
                            value={shortages}
                            prefix={<WarningOutlined />}
                            valueStyle={{ color: shortages > 0 ? '#cf1322' : '#3f8600' }}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card size="small">
                        <Statistic
                            title="Total Ítems en Plan"
                            value={totalItems}
                            prefix={<ShoppingOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            <Card
                title="MRP - Planeación de Requerimientos de Materiales"
                extra={
                    <Space>
                        <Button icon={<ReloadOutlined />} onClick={fetchData}>Actualizar</Button>
                        <Button type="primary" icon={<DownloadOutlined />}>Exportar Lista de Compras</Button>
                    </Space>
                }
            >
                <Alert
                    message="Basado en Programación Mensual"
                    description="Este cálculo toma todas las órdenes de producción programadas (SCHEDULED) y las descompone en ingredientes exactos."
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                />

                <Table
                    columns={columns}
                    dataSource={requirements}
                    rowKey="productId"
                    loading={loading}
                    pagination={false}
                    summary={data => {
                        return null; // Could add totals here
                    }}
                />
            </Card>
        </div>
    );
}

export default MRPDashboard;
