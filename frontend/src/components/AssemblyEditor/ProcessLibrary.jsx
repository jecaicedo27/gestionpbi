import React, { useState } from 'react';
import { Card, Collapse, Input, Select, Typography, Tag, Space, Tooltip } from 'antd';
import { SearchOutlined, DragOutlined } from '@ant-design/icons';
import { useDrag } from 'react-dnd';

const { Panel } = Collapse;
const { Text } = Typography;
const { Option } = Select;

// Draggable Process Type
function DraggableProcessType({ processType, onAddStage }) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'PROCESS_TYPE',
        item: { processType },
        end: (item, monitor) => {
            if (monitor.didDrop()) {
                onAddStage(item.processType);
            }
        },
        collect: (monitor) => ({
            isDragging: monitor.isDragging()
        })
    }), [processType, onAddStage]);

    return (
        <div
            ref={drag}
            style={{
                opacity: isDragging ? 0.5 : 1,
                padding: '8px 12px',
                marginBottom: 8,
                background: '#f5f5f5',
                borderLeft: `4px solid ${processType.color || '#1890ff'}`,
                cursor: 'move',
                borderRadius: 4,
                transition: 'all 0.2s'
            }}
        >
            <Space>
                <DragOutlined style={{ color: '#999' }} />
                <span>{processType.icon}</span>
                <Text strong>{processType.name}</Text>
                <Tag color={processType.category === 'SPECIAL' ? 'orange' : 'blue'}>
                    {processType.category}
                </Tag>
            </Space>
        </div>
    );
}

// Draggable Template (for sub-template composition)
function DraggableTemplate({ template, onAddSubTemplate }) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'PROCESS_TYPE',
        item: { processType: { id: '__sub_template__', name: template.templateName || template.templateCode }, subTemplate: template },
        end: (item, monitor) => {
            if (monitor.didDrop()) {
                onAddSubTemplate(item.subTemplate);
            }
        },
        collect: (monitor) => ({
            isDragging: monitor.isDragging()
        })
    }), [template, onAddSubTemplate]);

    const stageCount = template.stages?.length || template.totalStages || 0;

    return (
        <div
            ref={drag}
            style={{
                opacity: isDragging ? 0.5 : 1,
                padding: '8px 12px',
                marginBottom: 8,
                background: 'linear-gradient(135deg, #f0f5ff, #e6f7ff)',
                borderLeft: '4px solid #722ed1',
                cursor: 'move',
                borderRadius: 4,
                transition: 'all 0.2s'
            }}
        >
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Space>
                    <DragOutlined style={{ color: '#722ed1' }} />
                    <Text strong style={{ fontSize: 12 }}>📋 {template.product?.name || template.templateName}</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: 10, marginLeft: 22 }}>
                    {template.templateCode} · {stageCount} etapa{stageCount !== 1 ? 's' : ''}
                </Text>
            </Space>
        </div>
    );
}

// Draggable Product (for inputs)
function DraggableProduct({ product, inputType, selectedStageId, onAddInput }) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'PRODUCT',
        item: { product, inputType },
        canDrag: !!selectedStageId,
        end: (item, monitor) => {
            if (monitor.didDrop() && selectedStageId) {
                onAddInput(selectedStageId, item.product, item.inputType);
            }
        },
        collect: (monitor) => ({
            isDragging: monitor.isDragging()
        })
    }), [product, inputType, selectedStageId, onAddInput]);

    return (
        <div
            ref={drag}
            style={{
                opacity: isDragging ? 0.5 : selectedStageId ? 1 : 0.4,
                padding: '6px 10px',
                marginBottom: 6,
                background: selectedStageId ? '#fff' : '#fafafa',
                border: '1px solid #d9d9d9',
                cursor: selectedStageId ? 'move' : 'not-allowed',
                borderRadius: 4,
                fontSize: 12
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                {selectedStageId && <DragOutlined style={{ color: '#999', fontSize: 10, marginTop: 3 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 12, display: 'block', wordBreak: 'break-word' }} title={product.name}>
                        {product.name} {product.sku && <span style={{ color: '#999', fontSize: 10 }}>({product.sku})</span>}
                    </Text>
                    <Tag color="default" style={{ fontSize: 10, marginTop: 2 }}>
                        {product.unit}
                    </Tag>
                </div>
            </div>
        </div>
    );
}

function ProcessLibrary({ processTypes, products, allTemplates, onAddStage, onAddSubTemplate, onAddInput, selectedStageId }) {
    const [search, setSearch] = useState('');
    const [classification, setClassification] = useState('all');

    const rawMaterials = products.filter(p => p.classification === 'MATERIA_PRIMA');
    const subAssemblies = products.filter(p => p.classification === 'PRODUCTO_EN_PROCESO');

    const fuzzyMatch = (product, query) => {
        if (!query.trim()) return true;
        const text = `${product.name} ${product.sku || ''}`.toLowerCase();
        return query.toLowerCase().split(/\s+/).every(word => {
            // Support % as wildcard (like SQL LIKE)
            const pattern = word.split('%').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
            return new RegExp(pattern).test(text);
        });
    };

    const filteredRawMaterials = rawMaterials.filter(p => fuzzyMatch(p, search));

    const filteredSubAssemblies = subAssemblies.filter(p => fuzzyMatch(p, search));

    return (
        <Card
            title="Biblioteca"
            size="small"
            style={{ height: 'calc(100vh - 220px)', overflowY: 'auto' }}
        >
            {!selectedStageId && (
                <div style={{ padding: '8px 0', background: '#e6f7ff', marginBottom: 12, borderRadius: 4, textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                        Arrastra procesos para crear etapas
                    </Text>
                </div>
            )}

            {selectedStageId && (
                <div style={{ padding: '8px 0', background: '#fff7e6', marginBottom: 12, borderRadius: 4, textAlign: 'center' }}>
                    <Text type="warning" style={{ fontSize: 11 }}>
                        ✓ Etapa seleccionada: Arrastra materiales
                    </Text>
                </div>
            )}

            <Collapse
                defaultActiveKey={['processes', 'raw', 'sub']}
                ghost
                style={{ background: '#fff' }}
            >
                {/* Procesos */}
                <Panel header={<Text strong>⚙️ PROCESOS</Text>} key="processes">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        {processTypes.map(pt => (
                            <DraggableProcessType
                                key={pt.id}
                                processType={pt}
                                onAddStage={onAddStage}
                            />
                        ))}
                    </Space>
                </Panel>

                {/* Materias Primas */}
                <Panel header={<Text strong>📦 MATERIAS PRIMAS ({filteredRawMaterials.length})</Text>} key="raw">
                    <Input
                        placeholder="Buscar..."
                        prefix={<SearchOutlined />}
                        size="small"
                        style={{ marginBottom: 8 }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filteredRawMaterials.map(product => (
                            <DraggableProduct
                                key={product.id}
                                product={product}
                                inputType="RAW_MATERIAL"
                                selectedStageId={selectedStageId}
                                onAddInput={onAddInput}
                            />
                        ))}
                    </div>
                </Panel>

                {/* Sub-Ensambles */}
                <Panel header={<Text strong>🔧 SUB-ENSAMBLES ({filteredSubAssemblies.length})</Text>} key="sub">
                    <Input
                        placeholder="Buscar..."
                        prefix={<SearchOutlined />}
                        size="small"
                        style={{ marginBottom: 8 }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filteredSubAssemblies.map(product => (
                            <DraggableProduct
                                key={product.id}
                                product={product}
                                inputType="SUB_ASSEMBLY"
                                selectedStageId={selectedStageId}
                                onAddInput={onAddInput}
                            />
                        ))}
                    </div>
                </Panel>

                {/* Plantillas reutilizables */}
                {allTemplates && allTemplates.length > 0 && (
                    <Panel header={<Text strong>📋 PLANTILLAS ({allTemplates.length})</Text>} key="templates">
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            {allTemplates.map(tmpl => (
                                <DraggableTemplate
                                    key={tmpl.id}
                                    template={tmpl}
                                    onAddSubTemplate={onAddSubTemplate}
                                />
                            ))}
                        </div>
                    </Panel>
                )}
            </Collapse>
        </Card>
    );
}

export default ProcessLibrary;
