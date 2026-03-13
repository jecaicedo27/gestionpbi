import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Space, Input, Select, message, Tooltip, Statistic, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, CheckCircleOutlined, CalculatorOutlined, SearchOutlined, RocketOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const { Search } = Input;
const { Option } = Select;

function FormulasPage() {
    const navigate = useNavigate();
    const [formulas, setFormulas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        search: '',
        isActive: undefined
    });

    useEffect(() => {
        fetchFormulas();
    }, [filters]);

    const fetchFormulas = async () => {
        setLoading(true);
        try {
            const params = {};
            if (filters.isActive !== undefined) params.isActive = filters.isActive;

            const response = await api.get('/formulas', { params });
            setFormulas(response.data);
        } catch (error) {
            console.error('Error fetching formulas:', error);
            message.error('Error al cargar formulaciones');
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (formulaId) => {
        try {
            const userId = localStorage.getItem('userId');
            await api.post(`/formulas/${formulaId}/approve`, {
                approvedById: userId
            });
            message.success('Formulación aprobada exitosamente');
            fetchFormulas();
        } catch (error) {
            console.error('Error approving formula:', error);
            message.error('Error al aprobar formulación');
        }
    };

    const columns = [
        {
            title: 'Código',
            dataIndex: 'formulaCode',
            key: 'formulaCode',
            width: 150,
            render: (text) => <strong>{text}</strong>
        },
        {
            title: 'Nombre',
            dataIndex: 'formulaName',
            key: 'formulaName',
            width: 250
        },
        {
            title: 'Producto Resultante',
            dataIndex: ['product', 'name'],
            key: 'product',
            width: 250
        },
        {
            title: 'Versión',
            dataIndex: 'version',
            key: 'version',
            width: 80,
            align: 'center',
            render: (version) => <Tag color="blue">v{version}</Tag>
        },
        {
            title: 'Base',
            key: 'base',
            width: 120,
            render: (_, record) => `${record.baseQuantity} ${record.baseUnit}`
        },
        {
            title: 'Costo/Unidad',
            dataIndex: ['cost', 'costPerUnit'],
            key: 'cost',
            width: 120,
            render: (cost) => cost ? `$${cost.toLocaleString()}` : <Tag>N/A</Tag>
        },
        {
            title: 'Estado',
            key: 'status',
            width: 150,
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Tag color={record.isActive ? 'green' : 'red'}>
                        {record.isActive ? 'Activo' : 'Inactivo'}
                    </Tag>
                    {record.approvedAt ?
                        <Tag color="cyan" style={{ marginTop: 4 }}>Aprobado</Tag> :
                        <Tag color="warning" style={{ marginTop: 4 }}>Pendiente</Tag>
                    }
                </Space>
            )
        },
        {
            title: 'Acciones',
            key: 'actions',
            width: 220,
            fixed: 'right',
            render: (_, record) => (
                <Space size="small">
                    <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => navigate(`/formulas/${record.id}`)}
                    >
                        Editar
                    </Button>
                    {!record.approvedAt && (
                        <Tooltip title="Aprobar Formulación">
                            <Button
                                type="link"
                                icon={<CheckCircleOutlined />}
                                onClick={() => handleApprove(record.id)}
                            >
                                Aprobar
                            </Button>
                        </Tooltip>
                    )}
                    <Tooltip title="Recalcular Costos">
                        <Button
                            type="link"
                            icon={<CalculatorOutlined />}
                            onClick={() => {
                                // Trigger cost calculation
                                api.post(`/formulas/${record.id}/calculate-cost`).then(() => {
                                    message.success('Costo actualizado');
                                    fetchFormulas();
                                });
                            }}
                        >
                            Costear
                        </Button>
                    </Tooltip>
                </Space>
            )
        }
    ];

    const filteredFormulas = formulas.filter(f => {
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            return (
                f.formulaCode.toLowerCase().includes(searchLower) ||
                f.formulaName.toLowerCase().includes(searchLower) ||
                f.product.name.toLowerCase().includes(searchLower)
            );
        }
        return true;
    });

    return (
        <div style={{ padding: 24 }}>
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="Total Formulaciones" value={formulas.length} icon={<RocketOutlined />} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic
                            title="Aprobadas"
                            value={formulas.filter(f => f.approvedAt).length}
                            valueStyle={{ color: '#3f8600' }}
                        />
                    </Card>
                </Col>
            </Row>

            <Card
                title="Gestor de Formulaciones"
                extra={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate('/formulas/new')}
                    >
                        Nueva Formulación
                    </Button>
                }
            >
                <Space style={{ marginBottom: 16, width: '100%' }} direction="vertical">
                    <Space>
                        <Search
                            placeholder="Buscar por código, nombre o producto"
                            allowClear
                            style={{ width: 400 }}
                            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                        />
                        <Select
                            placeholder="Estado"
                            allowClear
                            style={{ width: 150 }}
                            onChange={(value) => setFilters({ ...filters, isActive: value })}
                        >
                            <Option value={true}>Activo</Option>
                            <Option value={false}>Inactivo</Option>
                        </Select>
                        <Button onClick={fetchFormulas}>Refrescar</Button>
                    </Space>
                </Space>

                <Table
                    columns={columns}
                    dataSource={filteredFormulas}
                    rowKey="id"
                    loading={loading}
                    scroll={{ x: 1300 }}
                    pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => `Total: ${total} formulaciones`
                    }}
                />
            </Card>
        </div>
    );
}

export default FormulasPage;
