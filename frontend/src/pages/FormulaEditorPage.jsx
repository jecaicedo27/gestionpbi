import React, { useState, useEffect } from 'react';
import {
    Card, Form, Input, InputNumber, Select, Button, Space, Table,
    Divider, Row, Col, Typography, Tag, message, Spin, Empty, Descriptions
} from 'antd';
import {
    SaveOutlined, ArrowLeftOutlined, PlusOutlined, DeleteOutlined,
    CheckCircleOutlined, CalculatorOutlined, InfoCircleOutlined, LinkOutlined,
    ArrowUpOutlined, ArrowDownOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea } = Input;

function FormulaEditorPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [form] = Form.useForm();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [products, setProducts] = useState([]);
    const [ingredients, setIngredients] = useState([]);

    const [formula, setFormula] = useState({
        formulaCode: '',
        formulaName: '',
        productId: '',
        baseUnit: undefined,
        baseQuantity: 1,
        expectedYieldPercentage: 100,
        description: '',
        notes: '',
        items: []
    });

    const [costData, setCostData] = useState(null);
    const [existingFormulas, setExistingFormulas] = useState([]);
    const [allFormulas, setAllFormulas] = useState([]);

    useEffect(() => {
        loadData();
    }, [id]);

    const loadData = async () => {
        setLoading(true);
        try {
            const productsRes = await api.get('/products');
            setProducts(productsRes.data);
            setIngredients(productsRes.data);

            // Always load formulas for visual indicators
            const formulasRes = await api.get('/formulas');
            setAllFormulas(formulasRes.data || []);

            if (id && id !== 'new') {
                const formulaRes = await api.get(`/formulas/${id}`);
                const data = formulaRes.data;
                setFormula(data);
                setCostData(data.cost);
                form.setFieldsValue(data);
            } else {
                // Auto-generate formula code based on highest existing number
                const existingCodes = formulasRes.data?.map(f => {
                    const match = f.formulaCode?.match(/FORM(\d+)/i);
                    return match ? parseInt(match[1], 10) : 0;
                }) || [];
                const maxNum = existingCodes.length > 0 ? Math.max(...existingCodes) : 0;
                const nextNum = maxNum + 1;
                const autoCode = `FORM${String(nextNum).padStart(3, '0')}`;
                setFormula(prev => ({ ...prev, formulaCode: autoCode }));
                form.setFieldsValue({ formulaCode: autoCode });
            }
        } catch (error) {
            console.error('Error loading data:', error);
            message.error('Error al cargar datos');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (values) => {
        if (formula.items.length === 0) {
            message.error('Debe agregar al menos un ingrediente');
            return;
        }

        setSaving(true);
        try {
            const userId = localStorage.getItem('userId');
            const payload = {
                ...values,
                formulaCode: formula.formulaCode || values.formulaCode,
                items: formula.items.map((item, idx) => ({ ...item, additionOrder: idx + 1 })),
                createdById: userId
            };

            if (id && id !== 'new') {
                await api.patch(`/formulas/${id}`, payload);
                message.success('Formulación actualizada');
            } else {
                const res = await api.post('/formulas', payload);
                message.success('Formulación creada');
                navigate(`/formulas/${res.data.id}`);
            }
        } catch (error) {
            console.error('Error saving formula:', error);
            message.error(error.response?.data?.error || 'Error al guardar formulación');
        } finally {
            setSaving(false);
        }
    };

    const addItem = () => {
        const newItem = {
            id: `new-${Date.now()}`,
            ingredientId: '',
            ingredientType: 'RAW_MATERIAL', // RAW_MATERIAL, SUB_ASSEMBLY, INTERMEDIATE
            quantity: 0,
            unit: '',
            minQuantity: 0,
            maxQuantity: 0,
            notes: ''
        };
        setFormula({ ...formula, items: [...formula.items, newItem] });
    };

    const removeItem = (itemId) => {
        setFormula(prev => ({
            ...prev,
            items: prev.items.filter(i => i.id !== itemId)
        }));
    };

    const moveItem = (index, direction) => {
        setFormula(prev => {
            const items = [...prev.items];
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= items.length) return prev;
            [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
            return { ...prev, items };
        });
    };

    const updateItem = (itemId, field, value) => {
        const updatedItems = formula.items.map(item => {
            if (item.id === itemId) {
                if (field === 'ingredientId') {
                    const product = products.find(p => p.id === value);
                    return { ...item, [field]: value, unit: product?.unit || '', ingredient: product };
                }
                return { ...item, [field]: value };
            }
            return item;
        });
        setFormula({ ...formula, items: updatedItems });
    };

    const calculateCost = async () => {
        if (!id || id === 'new') {
            message.warning('Guarde la formulación antes de calcular el costo');
            return;
        }

        try {
            const res = await api.post(`/formulas/${id}/calculate-cost`, {
                laborCost: 0, // Placeholder for future manual inputs
                overheadCost: 0
            });
            setCostData(res.data);
            message.success('Costos recalculados correctamente');
        } catch (error) {
            message.error('Error al calcular costos');
        }
    };

    const totalQuantity = formula.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

    const columns = [
        {
            title: 'Orden',
            key: 'order',
            width: 100,
            render: (_, __, index) => (
                <Space size={2}>
                    <Button
                        type="text"
                        size="small"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => moveItem(index, -1)}
                        style={{ padding: '0 4px' }}
                    />
                    <span style={{ fontWeight: 600, minWidth: 18, textAlign: 'center', display: 'inline-block' }}>{index + 1}</span>
                    <Button
                        type="text"
                        size="small"
                        icon={<ArrowDownOutlined />}
                        disabled={index === formula.items.length - 1}
                        onClick={() => moveItem(index, 1)}
                        style={{ padding: '0 4px' }}
                    />
                </Space>
            )
        },
        {
            title: 'Ingrediente / Insumo',
            key: 'ingredient',
            width: 350,
            render: (_, record) => (
                <Select
                    showSearch
                    style={{ width: '100%' }}
                    placeholder="Seleccionar..."
                    filterOption={(input, option) => {
                        const text = (option?.children?.toString() || '').toLowerCase();
                        return input.toLowerCase().split(/\s+/).every(word => {
                            const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
                            return new RegExp(pattern).test(text);
                        });
                    }}
                    value={record.ingredientId}
                    onChange={(val) => updateItem(record.id, 'ingredientId', val)}
                    size="small"
                >
                    {ingredients.map(p => (
                        <Option key={p.id} value={p.id}>{p.name} ({p.sku}) — {p.unit}</Option>
                    ))}
                </Select>
            )
        },
        {
            title: 'Cantidad',
            key: 'quantity',
            width: 120,
            render: (_, record) => (
                <InputNumber
                    min={0}
                    style={{ width: '100%' }}
                    value={record.quantity}
                    onChange={(val) => updateItem(record.id, 'quantity', val)}
                    size="small"
                />
            )
        },
        {
            title: 'Unidad',
            key: 'unit',
            width: 100,
            render: (_, record) => (record.unit || '---')
        },
        {
            title: '%',
            key: 'percentage',
            width: 80,
            render: (_, record) => (
                <Tag color="blue">
                    {totalQuantity > 0 ? ((record.quantity / totalQuantity) * 100).toFixed(3) : 0}%
                </Tag>
            )
        },
        {
            title: 'Tolerancia (Min/Max)',
            key: 'tolerance',
            width: 180,
            render: (_, record) => (
                <Space size={4}>
                    <InputNumber
                        size="small"
                        placeholder="Min"
                        value={record.minQuantity}
                        onChange={(val) => updateItem(record.id, 'minQuantity', val)}
                        style={{ width: 70 }}
                    />
                    <InputNumber
                        size="small"
                        placeholder="Max"
                        value={record.maxQuantity}
                        onChange={(val) => updateItem(record.id, 'maxQuantity', val)}
                        style={{ width: 70 }}
                    />
                </Space>
            )
        },
        {
            title: '',
            key: 'action',
            width: 50,
            render: (_, record) => (
                <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeItem(record.id)}
                />
            )
        }
    ];

    if (loading) return <Spin size="large" style={{ display: 'flex', margin: '200px auto' }} />;

    return (
        <div style={{ padding: 24 }}>
            <Form
                form={form}
                layout="vertical"
                onFinish={handleSave}
                initialValues={formula}
            >
                <Card
                    title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space>
                                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/formulas')} />
                                <span>{id === 'new' ? 'Nueva Formulación' : `Editando: ${formula.formulaName}`}</span>
                            </Space>
                            <Space>
                                <Button icon={<CalculatorOutlined />} onClick={calculateCost}>Recalcular Costos</Button>
                                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                                    Guardar Formulación
                                </Button>
                            </Space>
                        </div>
                    }
                >
                    <Row gutter={24}>
                        <Col span={16}>
                            <Card title="Datos Principales" size="small" style={{ marginBottom: 24 }}>
                                <Row gutter={16}>
                                    <Col span={8}>
                                        <Form.Item name="productId" label="Producto a Fabricar" rules={[{ required: true }]}>
                                            <Select
                                                showSearch
                                                popupMatchSelectWidth={false}
                                                dropdownStyle={{ minWidth: 500 }}
                                                filterOption={(input, option) => {
                                                    const text = (option?.children?.toString() || '').toLowerCase();
                                                    return input.toLowerCase().split(/\s+/).every(word => {
                                                        const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
                                                        return new RegExp(pattern).test(text);
                                                    });
                                                }}
                                                placeholder="Seleccionar producto..."
                                                onChange={async (val) => {
                                                    form.setFieldsValue({ productId: val });
                                                    setFormula(prev => ({ ...prev, productId: val }));
                                                    // Check if product already has formulas
                                                    try {
                                                        const res = await api.get(`/formulas?productId=${val}`);
                                                        setExistingFormulas(res.data || []);
                                                    } catch { setExistingFormulas([]); }
                                                }}
                                            >
                                                {products.map(p => {
                                                    const productFormulas = allFormulas.filter(f => f.productId === p.id);
                                                    return (
                                                        <Option key={p.id} value={p.id}>
                                                            {p.sku && <span style={{ color: '#999', marginRight: 6, fontSize: 11 }}>[{p.sku}]</span>}
                                                            {p.name}
                                                            {productFormulas.length > 0 && (
                                                                <span style={{ marginLeft: 8, color: '#1890ff', fontSize: 11 }}>
                                                                    📋 {productFormulas.map(f => f.formulaCode).join(', ')}
                                                                </span>
                                                            )}
                                                        </Option>
                                                    );
                                                })}
                                            </Select>
                                        </Form.Item>
                                        {existingFormulas.length > 0 && (
                                            <div style={{ marginTop: -16, marginBottom: 8 }}>
                                                {existingFormulas.map(f => (
                                                    <Tag
                                                        key={f.id}
                                                        color="blue"
                                                        icon={<LinkOutlined />}
                                                        style={{ cursor: 'pointer', marginBottom: 4 }}
                                                        onClick={() => navigate(`/formulas/${f.id}`)}
                                                    >
                                                        {f.formulaCode} — {f.formulaName || 'Ver fórmula'}
                                                    </Tag>
                                                ))}
                                            </div>
                                        )}
                                    </Col>
                                    <Col span={8}>
                                        <Form.Item name="formulaCode" label="Código Fórmula">
                                            <Input placeholder="Ej: F_001" disabled />
                                        </Form.Item>
                                    </Col>
                                    <Col span={8}>
                                        <Form.Item name="formulaName" label="Nombre Comercial/Técnico" rules={[{ required: true }]}>
                                            <Input placeholder="Ej: Mezcla Base Pop Fresa" />
                                        </Form.Item>
                                    </Col>
                                </Row>
                                <Row gutter={16}>
                                    <Col span={6}>
                                        <Form.Item name="baseQuantity" label="Cantidad Base" rules={[{ required: true }]}>
                                            <InputNumber style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={6}>
                                        <Form.Item name="baseUnit" label="Unidad Base" rules={[{ required: true }]}>
                                            <Select placeholder="Seleccionar...">
                                                <Option value="kg">kg</Option>
                                                <Option value="g">g</Option>
                                                <Option value="L">Litros</Option>
                                                <Option value="ml">ml</Option>
                                                <Option value="units">Unidades</Option>
                                            </Select>
                                        </Form.Item>
                                    </Col>
                                    <Col span={6}>
                                        <Form.Item name="expectedYieldPercentage" label="% Rendimiento Esperado">
                                            <InputNumber suffix="%" style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={6}>
                                        <Descriptions size="small" bordered style={{ marginTop: 24 }}>
                                            <Descriptions.Item label="Última v.">{formula.version}</Descriptions.Item>
                                        </Descriptions>
                                    </Col>
                                </Row>
                            </Card>

                            <Card
                                title={<Space><Text strong>Ingredientes y Composición</Text><Tag color="blue">Total: {totalQuantity} {formula.baseUnit}</Tag></Space>}
                                size="small"
                                extra={<Button type="dashed" onClick={addItem} icon={<PlusOutlined />}>Agregar Ingrediente</Button>}
                            >
                                <Table
                                    dataSource={formula.items}
                                    columns={columns}
                                    rowKey="id"
                                    pagination={false}
                                    size="small"
                                    summary={() => formula.items.length > 0 ? (
                                        <Table.Summary fixed>
                                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                                                <Table.Summary.Cell index={0} />
                                                <Table.Summary.Cell index={1}>
                                                    <Text strong>TOTAL</Text>
                                                </Table.Summary.Cell>
                                                <Table.Summary.Cell index={2}>
                                                    <Text strong style={{ color: '#1890ff' }}>{totalQuantity.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</Text>
                                                </Table.Summary.Cell>
                                                <Table.Summary.Cell index={3}>
                                                    <Text type="secondary">{formula.baseUnit || ''}</Text>
                                                </Table.Summary.Cell>
                                                <Table.Summary.Cell index={4}>
                                                    <Tag color="green">100%</Tag>
                                                </Table.Summary.Cell>
                                                <Table.Summary.Cell index={5} />
                                                <Table.Summary.Cell index={6} />
                                            </Table.Summary.Row>
                                        </Table.Summary>
                                    ) : null
                                    }
                                />
                            </Card>
                        </Col>

                        <Col span={8}>
                            <Card title="Resumen de Costos Estimados" size="small" style={{ marginBottom: 24 }}>
                                {costData ? (
                                    <Descriptions column={1} bordered size="small">
                                        <Descriptions.Item label="Materiales">${costData.materialCost.toLocaleString()}</Descriptions.Item>
                                        <Descriptions.Item label="Mano de Obra">${costData.laborCost.toLocaleString()}</Descriptions.Item>
                                        <Descriptions.Item label="Costos Indirectos">${costData.overheadCost.toLocaleString()}</Descriptions.Item>
                                        <Descriptions.Item label="TOTAL LOTE">
                                            <Text strong style={{ fontSize: 16 }}>${costData.totalCost.toLocaleString()}</Text>
                                        </Descriptions.Item>
                                        <Descriptions.Item label={`COSTO POR ${formula.baseUnit.toUpperCase()}`}>
                                            <Tag color="gold" style={{ fontSize: 14, padding: '4px 8px' }}>
                                                ${costData.costPerUnit.toLocaleString()}
                                            </Tag>
                                        </Descriptions.Item>
                                    </Descriptions>
                                ) : (
                                    <Empty description="No se ha calculado el costo" />
                                )}
                                <Paragraph type="secondary" style={{ fontSize: 11, marginTop: 12 }}>
                                    * El costo de materiales se calcula automáticamente basado en el precio de costo de SIIGO sincronizado en cada producto.
                                </Paragraph>
                            </Card>

                            <Card title="Instrucciones de Mezclado / Preparación" size="small">
                                <Form.Item name="description">
                                    <TextArea rows={4} placeholder="Pasos básicos de preparación..." />
                                </Form.Item>
                                <Form.Item name="notes" label="Notas de Calidad">
                                    <TextArea rows={3} placeholder="Aspectos críticos a cuidar..." />
                                </Form.Item>
                            </Card>
                        </Col>
                    </Row>
                </Card>
            </Form>
        </div>
    );
}

export default FormulaEditorPage;
