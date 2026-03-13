import React from 'react';
import { Card, Form, Input, InputNumber, Select, Typography, Space, Divider, Empty, Tag, Alert, Row, Col, Button, message } from 'antd';
import { SettingOutlined, InfoCircleOutlined, RocketOutlined, ImportOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea } = Input;

function ConfigPanel({
    template,
    selectedStage,
    products,
    formulas = [],
    allTemplates = [],
    onTemplateChange,
    onStageUpdate,
    onImportFormula
}) {
    const [form] = Form.useForm();

    // Handle template header updates
    const handleTemplateHeaderChange = (field, value) => {
        onTemplateChange({
            ...template,
            [field]: value
        });
    };

    // Handle stage configuration updates
    const handleStageChange = (field, value) => {
        if (!selectedStage) return;
        onStageUpdate(selectedStage.id || selectedStage.stageOrder, {
            [field]: value
        });
    };

    // Handle input configuration updates (quantity/unit)
    const handleInputChange = (inputId, field, value) => {
        if (!selectedStage) return;
        const updatedInputs = selectedStage.inputs.map(input =>
            input.id === inputId ? { ...input, [field]: value } : input
        );
        onStageUpdate(selectedStage.id || selectedStage.stageOrder, {
            inputs: updatedInputs
        });
    };

    return (
        <Card
            title={selectedStage ? (
                <Space>
                    <SettingOutlined />
                    <span>Configurar Etapa {selectedStage.stageOrder}</span>
                </Space>
            ) : "Configuración de Plantilla"}
            size="small"
            style={{ height: 'calc(100vh - 220px)', overflowY: 'auto' }}
            extra={selectedStage && <Tag color="blue">{selectedStage.processType?.name}</Tag>}
        >
            {/* ═══ TEMPLATE CONFIG — always visible ═══ */}
            <Form layout="vertical" size="small">
                <Form.Item label="Producto de Referencia" required tooltip="Producto principal que representa esta plantilla en los listados. Para procesos maestros con múltiples salidas, usa el campo 'Productos a Fabricar' en la etapa correspondiente.">
                    <Select
                        showSearch
                        placeholder="Seleccionar producto..."
                        filterOption={(input, option) => {
                            const text = (option?.children?.toString() || '').toLowerCase();
                            return input.toLowerCase().split(/\s+/).every(word => {
                                const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
                                return new RegExp(pattern).test(text);
                            });
                        }}
                        value={template.productId}
                        onChange={(val) => {
                            const prod = products.find(p => p.id === val);
                            onTemplateChange({
                                ...template,
                                productId: val,
                                templateName: `Producción ${prod?.name || ''}`
                            });
                        }}
                    >
                        {(() => {
                            // Merge: products with formulas + all PRODUCTO_EN_PROCESO products
                            const formulaProducts = formulas
                                .filter((f, i, arr) => arr.findIndex(x => x.productId === f.productId) === i)
                                .map(f => ({ id: f.productId, sku: f.product?.sku, name: f.product?.name, fromFormula: true }));
                            const processProducts = products
                                .filter(p => p.classification === 'PRODUCTO_EN_PROCESO')
                                .map(p => ({ id: p.id, sku: p.sku, name: p.name, fromFormula: false }));
                            // Merge, dedup by id
                            const seen = new Set();
                            const merged = [];
                            [...formulaProducts, ...processProducts].forEach(p => {
                                if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
                            });
                            return merged.map(p => {
                                const existingTmpl = allTemplates.find(t => t.productId === p.id);
                                return (
                                    <Option key={p.id} value={p.id}>
                                        {p.sku && <span style={{ color: '#999', marginRight: 6, fontSize: 11 }}>[{p.sku}]</span>}
                                        {p.name}
                                        {existingTmpl && (
                                            <span style={{ marginLeft: 8, color: '#52c41a', fontSize: 11 }}>
                                                🔧 {existingTmpl.templateCode}
                                            </span>
                                        )}
                                    </Option>
                                );
                            });
                        })()}
                    </Select>
                </Form.Item>

                <Form.Item label="Código de Plantilla" required tooltip="Puedes renombrarlo, ej: BATCH-FRESA-MAESTRO">
                    <Input
                        placeholder="Auto-generado — puedes editar"
                        value={template.templateCode}
                        onChange={(e) => handleTemplateHeaderChange('templateCode', e.target.value.toUpperCase().replace(/\s+/g, '-'))}
                    />
                </Form.Item>

                <Form.Item label="Nombre descriptivo" required>
                    <Input
                        placeholder="Ej: Batch Maestro FRESA 120 KG"
                        value={template.templateName}
                        onChange={(e) => handleTemplateHeaderChange('templateName', e.target.value)}
                    />
                </Form.Item>

                <Form.Item label="Descripción/Notas">
                    <TextArea
                        rows={2}
                        placeholder="Detalles adicionales del proceso..."
                        value={template.description}
                        onChange={(e) => handleTemplateHeaderChange('description', e.target.value)}
                    />
                </Form.Item>
            </Form>

            {/* ═══ STAGE CONFIG — only when a stage is selected ═══ */}
            {selectedStage ? (
                <>
                    <Divider style={{ margin: '12px 0' }} />
                    <Form layout="vertical" size="small">
                        <Form.Item label="Nombre de la Etapa">
                            <Input
                                value={selectedStage.stageName}
                                onChange={(e) => handleStageChange('stageName', e.target.value)}
                            />
                        </Form.Item>

                        {/* ═══ MULTI-PRODUCT OUTPUT — only for MAESTRO_PERLAS ═══ */}
                        {selectedStage.processType?.code === 'MAESTRO_PERLAS' && (
                            <Form.Item
                                label="Productos a Fabricar"
                                tooltip="Selecciona uno o más productos finales que se producen en este proceso maestro"
                                required
                            >
                                <Select
                                    mode="multiple"
                                    showSearch
                                    placeholder="Seleccionar productos de salida..."
                                    filterOption={(input, option) => {
                                        const text = (option?.children?.toString() || '').toLowerCase();
                                        return input.toLowerCase().split(/\s+/).every(word => {
                                            const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
                                            return new RegExp(pattern).test(text);
                                        });
                                    }}
                                    value={selectedStage.processParameters?.output_products || []}
                                    onChange={(vals) => handleStageChange('processParameters', {
                                        ...selectedStage.processParameters,
                                        output_products: vals
                                    })}
                                    style={{ width: '100%' }}
                                >
                                    {products.map(p => (
                                        <Option key={p.id} value={p.id}>
                                            {p.sku && <span style={{ color: '#999', marginRight: 6, fontSize: 11 }}>[{p.sku}]</span>}
                                            {p.name}
                                        </Option>
                                    ))}
                                </Select>
                                {(selectedStage.processParameters?.output_products?.length > 0) && (
                                    <div style={{ marginTop: 6, fontSize: 11, color: '#8b5cf6', fontWeight: 600 }}>
                                        🫧 {selectedStage.processParameters.output_products.length} producto(s) de salida configurado(s)
                                    </div>
                                )}
                            </Form.Item>
                        )}

                        <Divider style={{ margin: '12px 0' }} orientation="left">Configuración de Proceso</Divider>


                        {selectedStage.processType?.parametersSchema ? (
                            <div>
                                {Object.entries(selectedStage.processType.parametersSchema).map(([key, schema]) => (
                                    <Form.Item key={key} label={key.toUpperCase()} tooltip={schema.description}>
                                        {schema.type === 'number' ? (
                                            <InputNumber
                                                style={{ width: '100%' }}
                                                value={selectedStage.processParameters?.[key]}
                                                onChange={(val) => handleStageChange('processParameters', {
                                                    ...selectedStage.processParameters,
                                                    [key]: val
                                                })}
                                            />
                                        ) : (
                                            <Input
                                                value={selectedStage.processParameters?.[key]}
                                                onChange={(e) => handleStageChange('processParameters', {
                                                    ...selectedStage.processParameters,
                                                    [key]: e.target.value
                                                })}
                                            />
                                        )}
                                    </Form.Item>
                                ))}
                            </div>
                        ) : (
                            <Alert
                                message="Sin parámetros específicos"
                                description="Este tipo de proceso no requiere configuración técnica adicional."
                                type="info"
                                showIcon
                                style={{ marginBottom: 16 }}
                            />
                        )}

                        <Form.Item label="Instrucciones Especiales">
                            <TextArea
                                rows={2}
                                value={selectedStage.specialInstructions}
                                onChange={(e) => handleStageChange('specialInstructions', e.target.value)}
                            />
                        </Form.Item>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <Text strong>Materias Primas / Insumos</Text>
                            <Button
                                size="small"
                                type="link"
                                onClick={() => {
                                    const updatedInputs = selectedStage.inputs.map(input => {
                                        if (input.unit === 'kg') {
                                            return { ...input, unit: 'g', quantityPerUnit: input.quantityPerUnit * 1000 };
                                        }
                                        return input;
                                    });
                                    onStageUpdate(selectedStage.id || selectedStage.stageOrder, { inputs: updatedInputs });
                                }}
                            >
                                Convertir todo a Gramos
                            </Button>
                        </div>

                        {/* IMPORT FROM FORMULA */}
                        <div style={{ background: '#e6f7ff', padding: 12, borderRadius: 8, marginBottom: 12, border: '1px solid #91d5ff' }}>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                                <ImportOutlined /> Importar ingredientes desde Fórmula
                            </Text>
                            <Select
                                showSearch
                                optionFilterProp="children"
                                placeholder="Seleccionar fórmula..."
                                style={{ width: '100%' }}
                                onChange={(formulaId) => {
                                    if (onImportFormula) {
                                        onImportFormula(selectedStage.id || selectedStage.stageOrder, formulaId);
                                    }
                                }}
                                value={null}
                            >
                                {formulas.map(f => (
                                    <Option key={f.id} value={f.id}>
                                        {f.product?.name} — <span style={{ color: '#999', fontSize: 11 }}>{f.formulaCode}</span>
                                    </Option>
                                ))}
                            </Select>
                            <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                                Importa todos los ingredientes de la fórmula automáticamente
                            </Text>
                        </div>

                        {selectedStage.inputs?.length > 0 ? (
                            selectedStage.inputs.map((input) => (
                                <div key={input.id} style={{ background: '#fafafa', padding: 8, borderRadius: 4, marginBottom: 8, border: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <Text strong style={{ fontSize: 12 }}>{input.product?.name}</Text>
                                        <Tag color="cyan">{input.product?.unit}</Tag>
                                    </div>
                                    <Row gutter={8}>
                                        <Col span={14}>
                                            <Form.Item label="Cant. por unidad" style={{ marginBottom: 0 }}>
                                                <InputNumber
                                                    size="small"
                                                    style={{ width: '100%' }}
                                                    value={input.quantityPerUnit}
                                                    onChange={(val) => handleInputChange(input.id, 'quantityPerUnit', val)}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col span={10}>
                                            <Form.Item label="Unidad" style={{ marginBottom: 0 }}>
                                                <Select
                                                    size="small"
                                                    value={input.unit}
                                                    onChange={(val) => handleInputChange(input.id, 'unit', val)}
                                                >
                                                    <Option value={input.product?.unit}>{input.product?.unit}</Option>
                                                    <Option value="g">g</Option>
                                                    <Option value="kg">kg</Option>
                                                    <Option value="ml">ml</Option>
                                                    <Option value="L">L</Option>
                                                </Select>
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <input
                                            type="checkbox"
                                            checked={input.aggregateOnRepeat || false}
                                            onChange={(e) => handleInputChange(input.id, 'aggregateOnRepeat', e.target.checked)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <Text type="secondary" style={{ fontSize: 11 }}>
                                            🔗 Agregar total en repeticiones
                                        </Text>
                                        {input.aggregateOnRepeat && (
                                            <Tag color="blue" style={{ fontSize: 10, marginLeft: 'auto' }}>TOTAL</Tag>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hay insumos agregados" />
                        )}

                        <Divider style={{ margin: '12px 0' }} orientation="left">Resultado de Etapa</Divider>

                        <Form.Item label="Output Generado (Opcional)" tooltip="Selecciona si esta etapa genera un sub-ensamble o producto final">
                            <Select
                                allowClear
                                showSearch
                                placeholder="Producto generado..."
                                optionFilterProp="children"
                                value={selectedStage.outputProductId}
                                onChange={(val) => {
                                    const prod = products.find(p => p.id === val);
                                    handleStageChange('outputProductId', val);
                                    handleStageChange('outputProduct', prod);
                                }}
                            >
                                {products.map(p => (
                                    <Option key={p.id} value={p.id}>{p.name}</Option>
                                ))}
                            </Select>
                        </Form.Item>
                    </Form>
                </>
            ) : (
                <>
                    <Divider />
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <InfoCircleOutlined style={{ fontSize: 24, color: '#bfbfbf', marginBottom: 12 }} />
                        <Paragraph type="secondary" style={{ fontSize: 13 }}>
                            Selecciona una etapa en el flujo para configurar sus parámetros específicos y materias primas.
                        </Paragraph>
                    </div>
                </>
            )}
        </Card>
    );
}

export default ConfigPanel;
