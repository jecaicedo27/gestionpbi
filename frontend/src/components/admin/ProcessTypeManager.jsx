import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';

const ProcessTypeManager = () => {
    const [processTypes, setProcessTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [editingType, setEditingType] = useState(null);
    const [form] = Form.useForm();

    useEffect(() => {
        fetchProcessTypes();
    }, []);

    const fetchProcessTypes = async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/process-types');
            setProcessTypes(data);
        } catch (error) {
            message.error('Error al cargar tipos de proceso');
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = () => {
        setEditingType(null);
        form.resetFields();
        setIsModalVisible(true);
    };

    const handleEdit = (record) => {
        setEditingType(record);
        form.setFieldsValue(record);
        setIsModalVisible(true);
    };

    const handleDelete = async (id) => {
        try {
            await api.delete(`/process-types/${id}`);
            message.success('Proceso desactivado');
            fetchProcessTypes();
        } catch (error) {
            message.error('Error al desactivar proceso');
        }
    };

    const handleModalOk = async () => {
        try {
            const values = await form.validateFields();
            if (editingType) {
                await api.patch(`/process-types/${editingType.id}`, values);
                message.success('Proceso actualizado');
            } else {
                await api.post('/process-types', values);
                message.success('Proceso creado');
            }
            setIsModalVisible(false);
            fetchProcessTypes();
        } catch (error) {
            if (error.response?.data?.error) {
                message.error(error.response.data.error);
            } else {
                message.error('Error al guardar proceso');
            }
        }
    };

    const columns = [
        {
            title: 'Icono',
            dataIndex: 'icon',
            key: 'icon',
            width: 70,
            render: (icon) => <span style={{ fontSize: '1.5rem' }}>{icon}</span>
        },
        {
            title: 'Código',
            dataIndex: 'code',
            key: 'code',
            render: (code) => <Tag color="blue">{code}</Tag>
        },
        {
            title: 'Nombre',
            dataIndex: 'name',
            key: 'name',
            render: (name) => <strong>{name}</strong>
        },
        {
            title: 'Categoría',
            dataIndex: 'category',
            key: 'category',
            render: (cat) => (
                <Tag color={cat === 'SPECIAL' ? 'orange' : 'green'}>
                    {cat === 'SPECIAL' ? 'ESPECIAL' : 'ESTÁNDAR'}
                </Tag>
            )
        },
        {
            title: 'Estado',
            dataIndex: 'active',
            key: 'active',
            render: (active) => (
                <Tag color={active ? 'success' : 'error'}>
                    {active ? 'ACTIVO' : 'INACTIVO'}
                </Tag>
            )
        },
        {
            title: 'Acciones',
            key: 'actions',
            render: (_, record) => (
                <Space>
                    <Button
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(record)}
                        type="text"
                    />
                    <Popconfirm
                        title="¿Desactivar este proceso?"
                        onConfirm={() => handleDelete(record.id)}
                        okText="Sí"
                        cancelText="No"
                    >
                        <Button
                            icon={<DeleteOutlined />}
                            danger
                            type="text"
                            disabled={!record.active}
                        />
                    </Popconfirm>
                </Space>
            )
        }
    ];

    return (
        <div style={{ padding: '20px 0' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Tipos de Proceso (Cajas para el Editor)</h3>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleAdd}
                >
                    Nueva Actividad
                </Button>
            </div>

            <Table
                columns={columns}
                dataSource={processTypes}
                rowKey="id"
                loading={loading}
                pagination={false}
                size="middle"
            />

            <Modal
                title={editingType ? 'Editar Actividad' : 'Nueva Actividad'}
                open={isModalVisible}
                onOk={handleModalOk}
                onCancel={() => setIsModalVisible(false)}
                okText="Guardar"
                cancelText="Cancelar"
                destroyOnClose
            >
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ active: true, category: 'STANDARD', icon: '⚙️' }}
                >
                    {!editingType && (
                        <Form.Item
                            name="code"
                            label="Código Único (Ej: MEZCLA_GOMAS)"
                            rules={[{ required: true, message: 'El código es obligatorio' }]}
                        >
                            <Input placeholder="MAYÚSCULAS_Y_GUIONES" />
                        </Form.Item>
                    )}

                    <Form.Item
                        name="name"
                        label="Nombre de la Actividad"
                        rules={[{ required: true, message: 'El nombre es obligatorio' }]}
                    >
                        <Input placeholder="Ej: Saborización" />
                    </Form.Item>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Form.Item
                            name="category"
                            label="Categoría"
                            rules={[{ required: true }]}
                        >
                            <Select>
                                <Select.Option value="STANDARD">ESTÁNDAR</Select.Option>
                                <Select.Option value="SPECIAL">ESPECIAL</Select.Option>
                            </Select>
                        </Form.Item>

                        <Form.Item
                            name="icon"
                            label="Icono (Emoji)"
                            rules={[{ required: true }]}
                        >
                            <Input placeholder="Ej: 🧪, 🥣, 📦" />
                        </Form.Item>
                    </div>

                    <Form.Item
                        name="active"
                        label="Estado"
                        valuePropName="checked"
                    >
                        <Select>
                            <Select.Option value={true}>Activo</Select.Option>
                            <Select.Option value={false}>Inactivo</Select.Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default ProcessTypeManager;
