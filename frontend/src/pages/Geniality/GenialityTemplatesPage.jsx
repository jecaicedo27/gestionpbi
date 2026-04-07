import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Space, Input, Select, message } from 'antd';
import { Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, CopyOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';

import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const { Search } = Input;
const { Option } = Select;

function GenialityTemplatesPage() {
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        search: '',
        isActive: undefined
    });

    useEffect(() => {
        fetchTemplates();
    }, [filters]);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const params = {};
            if (filters.isActive !== undefined) params.isActive = filters.isActive;

            const response = await api.get('/geniality/assembly-templates', { params });
            setTemplates(response.data);
        } catch (error) {
            console.error('Error fetching templates:', error);
            message.error('Error al cargar plantillas');
        } finally {
            setLoading(false);
        }
    };

    const handleClone = async (templateId) => {
        try {
            const userId = localStorage.getItem('userId'); // Assuming stored in localStorage
            await api.post(`/geniality/assembly-templates/${templateId}/clone`, {
                createdById: userId
            });
            message.success('Plantilla clonada exitosamente');
            fetchTemplates();
        } catch (error) {
            console.error('Error cloning template:', error);
            message.error('Error al clonar plantilla');
        }
    };

    const handleDelete = async (templateId) => {
        try {
            await api.delete(`/geniality/assembly-templates/${templateId}`);
            message.success('Plantilla desactivada');
            fetchTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            message.error('Error al desactivar plantilla');
        }
    };

    const handleDestroy = async (templateId, templateCode) => {
        try {
            await api.delete(`/geniality/assembly-templates/${templateId}/destroy`);
            message.success(`Plantilla ${templateCode} eliminada permanentemente`);
            fetchTemplates();
        } catch (error) {
            console.error('Error destroying template:', error);
            message.error(error.response?.data?.error || 'Error al eliminar plantilla');
        }
    };



    const columns = [
        {
            title: 'Código',
            dataIndex: 'templateCode',
            key: 'templateCode',
            width: 150,
            render: (text) => <strong>{text}</strong>
        },
        {
            title: 'Nombre',
            dataIndex: 'templateName',
            key: 'templateName',
            width: 250
        },
        {
            title: 'Producto',
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
            title: 'Etapas',
            dataIndex: 'totalStages',
            key: 'totalStages',
            width: 80,
            align: 'center',
            render: (stages) => <Tag>{stages} etapas</Tag>
        },
        {
            title: 'Estado',
            dataIndex: 'isActive',
            key: 'isActive',
            width: 100,
            render: (isActive) => (
                <Tag color={isActive ? 'green' : 'red'}>
                    {isActive ? 'Activo' : 'Inactivo'}
                </Tag>
            )
        },
        {
            title: 'Creado',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 120,
            render: (date) => new Date(date).toLocaleDateString()
        },
        {
            title: 'Acciones',
            key: 'actions',
            width: 200,
            fixed: 'right',
            render: (_, record) => (
                <Space size="small">
                    <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => navigate(`/geniality/assembly-templates/${record.id}`)}
                    >
                        Editar
                    </Button>
                    <Button
                        type="link"
                        icon={<CopyOutlined />}
                        onClick={() => handleClone(record.id)}
                    >
                        Clonar
                    </Button>
                    {record.isActive && (
                        <Button
                            type="link"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDelete(record.id)}
                        >
                            Desactivar
                        </Button>
                    )}
                    {!record.isActive && (
                        <Popconfirm
                            title="¿Eliminar plantilla permanentemente?"
                            description={`"${record.templateName}" será borrada con todas sus etapas.`}
                            onConfirm={() => handleDestroy(record.id, record.templateCode)}
                            okText="Sí, eliminar"
                            cancelText="Cancelar"
                            okButtonProps={{ danger: true }}
                        >
                            <Button type="link" danger icon={<DeleteOutlined />}>
                                Eliminar
                            </Button>
                        </Popconfirm>
                    )}
                </Space>
            )
        }
    ];

    const filteredTemplates = templates.filter(template => {
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            return (
                template.templateCode.toLowerCase().includes(searchLower) ||
                template.templateName.toLowerCase().includes(searchLower) ||
                template.product.name.toLowerCase().includes(searchLower)
            );
        }
        return true;
    });

    return (
        <div style={{ padding: 24 }}>
            <Card
                title="Plantillas de Producción"
                extra={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate('/geniality/assembly-templates/new')}
                    >
                        Nueva Plantilla
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
                        <Button onClick={fetchTemplates}>Refrescar</Button>
                    </Space>
                </Space>

                <Table
                    columns={columns}
                    dataSource={filteredTemplates}
                    rowKey="id"
                    loading={loading}
                    scroll={{ x: 1400 }}
                    pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => `Total: ${total} plantillas`
                    }}
                />
            </Card>
        </div>
    );
}

export default GenialityTemplatesPage;
