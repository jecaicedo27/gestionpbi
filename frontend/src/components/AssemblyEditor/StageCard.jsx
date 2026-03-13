import React, { useRef } from 'react';
import RecipeChip from './RecipeChip';
import { Card, Tag, Space, Button, List, Typography, Tooltip } from 'antd';
import {
    DeleteOutlined,
    DragOutlined,
    CloseCircleOutlined,
    DownOutlined,
    UpOutlined,
    ArrowRightOutlined
} from '@ant-design/icons';
import { useDrag, useDrop } from 'react-dnd';

const { Text } = Typography;

function StageCard({
    stage,
    index,
    isSelected,
    onSelect,
    onRemove,
    onRemoveInput,
    onAddInput,
    onMove
}) {
    const ref = useRef(null);

    // Drag and Drop for Reordering Stages
    const [{ handlerId }, drop] = useDrop({
        accept: 'STAGE',
        collect(monitor) {
            return {
                handlerId: monitor.getHandlerId(),
            };
        },
        hover(item, monitor) {
            if (!ref.current) return;
            const dragIndex = item.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;

            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;

            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

            onMove(dragIndex, hoverIndex);
            item.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag, preview] = useDrag({
        type: 'STAGE',
        item: () => ({ id: stage.id, index }),
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    // Support for dropping Inputs into this specific stage
    const [{ isOverInput }, dropInput] = useDrop({
        accept: 'PRODUCT',
        drop: (item) => {
            onAddInput(item.product, item.inputType);
            return { dropped: true };
        },
        collect: (monitor) => ({
            isOverInput: monitor.isOver(),
        }),
    }, [onAddInput]);

    drop(preview(ref));

    const opacity = isDragging ? 0 : 1;

    return (
        <div
            ref={ref}
            data-handler-id={handlerId}
            style={{
                opacity,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.645, 0.045, 0.355, 1)',
                transform: isSelected ? 'scale(1.01)' : 'scale(1)'
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
        >
            <div ref={dropInput}>
                <Card
                    size="small"
                    hoverable
                    className={`stage-card ${isSelected ? 'selected' : ''}`}
                    style={{
                        border: isSelected ? '2px solid #1890ff' : isOverInput ? '2px dashed #faad14' : '1px solid #f0f0f0',
                        boxShadow: isSelected ? '0 0 12px rgba(24, 144, 255, 0.3)' : 'none',
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: isSelected ? '#f0f7ff' : isOverInput ? '#fffbe6' : '#fff',
                        transition: 'all 0.3s'
                    }}
                    title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space>
                                <div
                                    ref={drag}
                                    style={{
                                        cursor: 'move',
                                        padding: '4px 8px',
                                        marginRight: 4,
                                        background: '#f0f0f0',
                                        borderRadius: 4,
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}
                                >
                                    <DragOutlined style={{ color: '#666' }} />
                                </div>
                                <Tag color="geekblue" style={{ borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                                    {stage.stageOrder}
                                </Tag>
                                {/* Process Type Icon */}
                                {stage.processType?.icon && (
                                    <span style={{ fontSize: 24, lineHeight: 1 }}>{stage.processType.icon}</span>
                                )}
                                <Text strong>{stage.stageName}</Text>
                                <Tag color={stage.processType?.category === 'SPECIAL' ? 'orange' : 'blue'} style={{ fontSize: 10 }}>
                                    {stage.processType?.name}
                                </Tag>
                            </Space>
                            <Tooltip title="Eliminar Etapa">
                                <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemove();
                                    }}
                                    size="small"
                                />
                            </Tooltip>
                        </div>
                    }
                >
                    {/* Inputs section */}
                    <div style={{ padding: '4px 8px' }}>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                            MATERIALES / INPUTS:
                        </Text>

                        {stage.inputs?.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '12px 0', background: '#fafafa', borderRadius: 4, border: '1px dashed #d9d9d9' }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    {isOverInput ? 'Suelta para agregar material' : 'Arrastra materiales aquí'}
                                </Text>
                            </div>
                        ) : (
                            <List
                                size="small"
                                dataSource={stage.inputs}
                                renderItem={(item) => (
                                    <List.Item
                                        style={{ padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}
                                        extra={
                                            <Button
                                                type="text"
                                                icon={<CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemoveInput(item.id);
                                                }}
                                                size="small"
                                            />
                                        }
                                    >
                                        <Space size={4}>
                                            <ArrowRightOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />
                                            <Text style={{ fontSize: 12 }}>{item.product?.name}</Text>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                ({Number(item.quantityPerUnit).toLocaleString('es-CO', { maximumFractionDigits: 3 })} {item.unit})
                                            </Text>
                                        </Space>
                                    </List.Item>
                                )}
                            />
                        )}
                    </div>

                    {/* Output indication if any */}
                    {stage.outputProductId && (
                        <div style={{ marginTop: 12, padding: '4px 8px', borderTop: '1px solid #f0f0f0', background: '#f9f9f9' }}>
                            <Space direction="vertical" style={{ width: '100%' }} size={2}>
                                <Space>
                                    <Tag color="green" style={{ fontSize: 10 }}>Genera Output</Tag>
                                    <Text style={{ fontSize: 11 }}>{stage.outputProduct?.name || 'Producto seleccionado'}</Text>
                                </Space>

                                {/* Render Recipe Chip if formula exists */}
                                {Array.isArray(stage.outputProduct?.formulas) && stage.outputProduct.formulas.length > 0 && (
                                    <RecipeChip
                                        formula={stage.outputProduct.formulas[0]}
                                        outputProductName={stage.outputProduct.name}
                                    />
                                )}
                            </Space>
                        </div>
                    )}
                </Card>
            </div>

            {/* Visual connector to next stage */}
            <div style={{ display: 'flex', justifyContent: 'center', height: 16, visibility: stage.isLast ? 'hidden' : 'visible' }}>
                <div style={{ width: 2, background: '#d9d9d9' }}></div>
            </div>
        </div>
    );
}

export default StageCard;
