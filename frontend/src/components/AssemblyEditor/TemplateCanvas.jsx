import React from 'react';
import { useDrop } from 'react-dnd';
import { Empty, Space, Typography } from 'antd';
import StageCard from './StageCard';

const { Title } = Typography;

function TemplateCanvas({
    template,
    onTemplateChange,
    selectedStageId,
    onSelectStage,
    onRemoveStage,
    onRemoveInput,
    onAddInput,
    onReorderStages
}) {
    const [{ isOver, canDrop }, drop] = useDrop(() => ({
        accept: 'PROCESS_TYPE',
        collect: (monitor) => ({
            isOver: monitor.isOver(),
            canDrop: monitor.canDrop(),
        }),
    }));

    const isActive = isOver && canDrop;

    return (
        <div
            ref={drop}
            style={{
                background: isActive ? '#f6ffed' : canDrop ? '#fffbe6' : '#fafafa',
                border: isActive ? '2px dashed #52c41a' : canDrop ? '2px dashed #faad14' : '2px solid #f0f0f0',
                borderRadius: 8,
                padding: 24,
                minHeight: 'calc(100vh - 220px)',
                transition: 'all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1)',
                overflowY: 'auto'
            }}
        >
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Title level={4} type="secondary">Flujo de Producción</Title>
            </div>

            {template.stages.length === 0 ? (
                <div style={{ marginTop: 100 }}>
                    <Empty
                        description={
                            <span>
                                El flujo está vacío.<br />
                                Arrastra un <b>Proceso</b> desde la biblioteca para comenzar.
                            </span>
                        }
                    />
                </div>
            ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    {template.stages.map((stage, index) => (
                        <StageCard
                            key={stage.id || stage.stageOrder}
                            index={index}
                            stage={stage}
                            isSelected={selectedStageId === (stage.id || stage.stageOrder)}
                            onSelect={() => onSelectStage(stage)}
                            onRemove={() => onRemoveStage(stage.id || stage.stageOrder)}
                            onRemoveInput={(inputId) => onRemoveInput(stage.id || stage.stageOrder, inputId)}
                            onAddInput={(product, inputType) => onAddInput(stage.id || stage.stageOrder, product, inputType)}
                            onMove={onReorderStages}
                        />
                    ))}

                    {canDrop && (
                        <div
                            style={{
                                height: 80,
                                border: '2px dashed #d9d9d9',
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#8c8c8c'
                            }}
                        >
                            Suelta aquí para agregar etapa
                        </div>
                    )}
                </Space>
            )}
        </div>
    );
}

export default TemplateCanvas;
