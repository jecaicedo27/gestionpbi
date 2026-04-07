import React, { useState, useEffect } from 'react';
import { 
    Card, Table, Typography, Button, Space, message, 
    Modal, Form, Input, Switch, Select, Tabs, Tag, List, Popconfirm, Collapse 
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { 
    getSanitationConfig, 
    createSanitationArea, 
    updateSanitationArea,
    createSanitationChemical,
    updateSanitationChemical,
    createSanitationComponent,
    updateSanitationComponent
} from '../../api/sanitation';

const { Title, Text } = Typography;
const { Option } = Select;

const SanitationConfig = () => {
    const [config, setConfig] = useState({ areas: [], chemicals: [] });
    const [loading, setLoading] = useState(false);
    
    const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
    const [isChemModalOpen, setIsChemModalOpen] = useState(false);
    const [isCompModalOpen, setIsCompModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [selectedAreaForComp, setSelectedAreaForComp] = useState(null);
    const [newCompName, setNewCompName] = useState('');

    const [areaForm] = Form.useForm();
    const [chemForm] = Form.useForm();

    const fetchConfig = async () => {
        setLoading(true);
        try { setConfig(await getSanitationConfig()); } 
        catch { message.error('Error al cargar la configuración'); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchConfig(); }, []);

    // --- AREA HANDLERS ---
    const handleAddArea = () => {
        setEditingItem(null);
        areaForm.resetFields();
        areaForm.setFieldsValues?.({ isActive: true, productionLine: 'SIROPES' });
        areaForm.setFieldsValue({ isActive: true, productionLine: 'SIROPES' });
        setIsAreaModalOpen(true);
    };
    const handleEditArea = (record) => {
        setEditingItem(record);
        areaForm.setFieldsValue(record);
        setIsAreaModalOpen(true);
    };
    const saveArea = async (values) => {
        try {
            if (editingItem) { await updateSanitationArea(editingItem.id, values); message.success('Área actualizada'); }
            else { await createSanitationArea(values); message.success('Área creada'); }
            setIsAreaModalOpen(false);
            fetchConfig();
        } catch (error) { message.error(error.response?.data?.error || 'Error al guardar'); }
    };

    // --- CHEMICAL HANDLERS ---
    const handleAddChem = () => {
        setEditingItem(null);
        chemForm.resetFields();
        chemForm.setFieldsValue({ isActive: true, type: 'DETERGENTE' });
        setIsChemModalOpen(true);
    };
    const handleEditChem = (record) => {
        setEditingItem(record);
        chemForm.setFieldsValue(record);
        setIsChemModalOpen(true);
    };
    const saveChem = async (values) => {
        try {
            if (editingItem) { await updateSanitationChemical(editingItem.id, values); message.success('Químico actualizado'); }
            else { await createSanitationChemical(values); message.success('Químico creado'); }
            setIsChemModalOpen(false);
            fetchConfig();
        } catch (error) { message.error(error.response?.data?.error || 'Error al guardar'); }
    };

    // --- COMPONENT HANDLERS ---
    const handleManageComponents = (area) => {
        setSelectedAreaForComp(area);
        setNewCompName('');
        setIsCompModalOpen(true);
    };

    const handleAddComponent = async () => {
        if (!newCompName.trim()) return;
        try {
            await createSanitationComponent({ areaId: selectedAreaForComp.id, name: newCompName.trim() });
            message.success('Componente agregado');
            setNewCompName('');
            fetchConfig();
            // Refresh the selected area
            const updated = await getSanitationConfig();
            const area = updated.areas.find(a => a.id === selectedAreaForComp.id);
            if (area) setSelectedAreaForComp(area);
        } catch (error) { message.error('Error al crear componente'); }
    };

    const handleToggleComponent = async (comp) => {
        try {
            await updateSanitationComponent(comp.id, { isActive: !comp.isActive });
            message.success(comp.isActive ? 'Componente desactivado' : 'Componente activado');
            fetchConfig();
            const updated = await getSanitationConfig();
            const area = updated.areas.find(a => a.id === selectedAreaForComp.id);
            if (area) setSelectedAreaForComp(area);
        } catch { message.error('Error al actualizar componente'); }
    };

    // --- COLUMNS ---
    const areaColumns = [
        { title: 'Nombre', dataIndex: 'name', key: 'name' },
        { 
            title: 'Línea', dataIndex: 'productionLine', 
            render: (line) => <Tag color={line === 'SIROPES' ? 'orange' : line === 'PERLAS' ? 'purple' : 'default'}>{line}</Tag> 
        },
        { 
            title: 'Componentes', key: 'components',
            render: (_, record) => (
                <Button type="link" icon={<UnorderedListOutlined />} onClick={() => handleManageComponents(record)}>
                    {record.components?.length || 0} partes
                </Button>
            )
        },
        { 
            title: 'Estado', dataIndex: 'isActive', 
            render: (isActive) => <Tag color={isActive ? 'green' : 'red'}>{isActive ? 'Activo' : 'Inactivo'}</Tag> 
        },
        {
            title: 'Acciones', key: 'actions',
            render: (_, record) => (
                <Button type="link" icon={<EditOutlined />} onClick={() => handleEditArea(record)}>Editar</Button>
            )
        }
    ];

    const chemColumns = [
        { title: 'Nombre Comercial', dataIndex: 'name', key: 'name' },
        { title: 'Tipo', dataIndex: 'type', render: (type) => <Tag color={type === 'DETERGENTE' ? 'blue' : 'purple'}>{type}</Tag> },
        { title: 'Principio Activo', dataIndex: 'activePrinciple', key: 'activePrinciple' },
        { title: 'Dosis Estándar', dataIndex: 'standardDose', key: 'standardDose' },
        { title: 'Estado', dataIndex: 'isActive', render: (isActive) => <Tag color={isActive ? 'green' : 'red'}>{isActive ? 'Activo' : 'Inactivo'}</Tag> },
        { title: 'Acciones', key: 'actions', render: (_, record) => (
            <Button type="link" icon={<EditOutlined />} onClick={() => handleEditChem(record)}>Editar</Button>
        )}
    ];

    return (
        <div style={{ padding: 24 }}>
            <Title level={2}>Configuración POES</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                Gestión de áreas de producción, equipos, componentes y productos químicos utilizados en el proceso de lavado.
            </Text>

            <Tabs defaultActiveKey="areas">
                <Tabs.TabPane tab="Áreas y Equipos" key="areas">
                    <Card title="Catálogo de Equipos" extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleAddArea}>Nuevo Equipo</Button>}>
                        <Table columns={areaColumns} dataSource={config.areas} rowKey="id" loading={loading} pagination={false} />
                    </Card>
                </Tabs.TabPane>
                <Tabs.TabPane tab="Químicos e Insumos" key="chemicals">
                    <Card title="Catálogo de Detergentes y Desinfectantes" extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleAddChem}>Nuevo Químico</Button>}>
                        <Table columns={chemColumns} dataSource={config.chemicals} rowKey="id" loading={loading} pagination={false} />
                    </Card>
                </Tabs.TabPane>
            </Tabs>

            {/* Modal de Áreas */}
            <Modal title={editingItem ? 'Editar Área / Equipo' : 'Nueva Área / Equipo'} open={isAreaModalOpen} onCancel={() => setIsAreaModalOpen(false)} onOk={() => areaForm.submit()} destroyOnClose>
                <Form form={areaForm} layout="vertical" onFinish={saveArea}>
                    <Form.Item name="name" label="Nombre del Equipo" rules={[{ required: true }]}>
                        <Input placeholder="Ej. Marmita 3" />
                    </Form.Item>
                    <Form.Item name="productionLine" label="Línea de Producción" rules={[{ required: true }]}>
                        <Select>
                            <Option value="SIROPES">Línea Siropes (Geniality)</Option>
                            <Option value="PERLAS">Línea Perlas (Popping)</Option>
                            <Option value="GENERAL">Áreas Generales / Comunes</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="description" label="Descripción">
                        <Input.TextArea rows={2} placeholder="Opcional..." />
                    </Form.Item>
                    <Form.Item name="isActive" label="Estado" valuePropName="checked">
                        <Switch checkedChildren="Activo" unCheckedChildren="Inactivo" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* Modal de Químicos */}
            <Modal title={editingItem ? 'Editar Químico' : 'Nuevo Químico'} open={isChemModalOpen} onCancel={() => setIsChemModalOpen(false)} onOk={() => chemForm.submit()} destroyOnClose>
                <Form form={chemForm} layout="vertical" onFinish={saveChem}>
                    <Form.Item name="name" label="Nombre Comercial" rules={[{ required: true }]}>
                        <Input placeholder="Ej. Amonio Cuaternario 5G" />
                    </Form.Item>
                    <Form.Item name="type" label="Tipo" rules={[{ required: true }]}>
                        <Select>
                            <Option value="DETERGENTE">Detergente</Option>
                            <Option value="DESINFECTANTE">Desinfectante</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="activePrinciple" label="Principio Activo">
                        <Input placeholder="Ej. Ácido Peracético" />
                    </Form.Item>
                    <Form.Item name="standardDose" label="Dosis Estándar (%)">
                        <Input placeholder="Ej. 1% o 200ppm" />
                    </Form.Item>
                    <Form.Item name="isActive" label="Estado" valuePropName="checked">
                        <Switch checkedChildren="Activo" unCheckedChildren="Inactivo" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* Modal de Componentes por Equipo */}
            <Modal 
                title={<>Componentes de: <strong>{selectedAreaForComp?.name}</strong></>} 
                open={isCompModalOpen} 
                onCancel={() => setIsCompModalOpen(false)}
                footer={null}
                width={600}
            >
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    Estas son las partes/piezas que el operario deberá verificar y fotografiar al hacer el lavado de este equipo.
                </Text>

                <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
                    <Input 
                        placeholder="Nombre del componente (Ej. Tolva de inyección)" 
                        value={newCompName}
                        onChange={e => setNewCompName(e.target.value)}
                        onPressEnter={handleAddComponent}
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAddComponent}>
                        Agregar
                    </Button>
                </Space.Compact>

                <List
                    bordered
                    dataSource={selectedAreaForComp?.components || []}
                    locale={{ emptyText: 'Sin componentes. Agregue las partes del equipo que deben ser lavadas.' }}
                    renderItem={(comp, idx) => (
                        <List.Item
                            style={{ backgroundColor: comp.isActive ? 'transparent' : '#fff1f0' }}
                            actions={[
                                <Popconfirm
                                    key="toggle"
                                    title={comp.isActive ? '¿Desactivar este componente?' : '¿Reactivar este componente?'}
                                    onConfirm={() => handleToggleComponent(comp)}
                                    okText="Sí"
                                    cancelText="No"
                                >
                                    <Button 
                                        type="link" 
                                        danger={comp.isActive}
                                        icon={comp.isActive ? <DeleteOutlined /> : <PlusOutlined />}
                                    >
                                        {comp.isActive ? 'Desactivar' : 'Reactivar'}
                                    </Button>
                                </Popconfirm>
                            ]}
                        >
                            <Space>
                                <Tag color={comp.isActive ? 'green' : 'red'}>{idx + 1}</Tag>
                                <Text delete={!comp.isActive}>{comp.name}</Text>
                            </Space>
                        </List.Item>
                    )}
                />
            </Modal>
        </div>
    );
};

export default SanitationConfig;
