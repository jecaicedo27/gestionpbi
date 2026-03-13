import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Button, message, Spin } from 'antd';
import { SaveOutlined, ArrowLeftOutlined, RocketOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import api from '../services/api';
import ProcessLibrary from '../components/AssemblyEditor/ProcessLibrary';
import TemplateCanvas from '../components/AssemblyEditor/TemplateCanvas';
import ConfigPanel from '../components/AssemblyEditor/ConfigPanel';

function TemplateEditorPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Editor state
    const [template, setTemplate] = useState({
        templateCode: '',
        templateName: '',
        productId: '',
        description: '',
        stages: []
    });

    const [selectedStageId, setSelectedStageId] = useState(null);
    const [processTypes, setProcessTypes] = useState([]);
    const [products, setProducts] = useState([]);
    const [formulas, setFormulas] = useState([]);
    const [allTemplates, setAllTemplates] = useState([]);

    useEffect(() => {
        loadData();
    }, [id]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Load process types
            const processTypesRes = await api.get('/process-types', {
                params: { active: true }
            });
            setProcessTypes(processTypesRes.data);

            // Load products
            const productsRes = await api.get('/products');
            setProducts(productsRes.data);

            // Load formulas
            const formulasRes = await api.get('/formulas');
            setFormulas(formulasRes.data);

            // Always load all templates for indicator
            const allTemplatesRes = await api.get('/assembly-templates');
            setAllTemplates(allTemplatesRes.data || []);

            // Load template if editing
            if (id && id !== 'new') {
                const templateRes = await api.get(`/assembly-templates/${id}`);
                const loadedTemplate = templateRes.data;

                // Auto-sync stage inputs from active formulas
                const formulasList = formulasRes.data || [];
                const syncedStages = loadedTemplate.stages.map(stage => {
                    // Skip sub-template stages — they inherit inputs from their sub-template
                    if (stage.subTemplateId) return stage;
                    const stageProductId = stage.outputProductId || loadedTemplate.productId;
                    const activeFormula = formulasList.find(f => f.productId === stageProductId && f.isActive);
                    if (activeFormula && activeFormula.items && activeFormula.items.length > 0) {
                        // Replace inputs with formula items (sorted by additionOrder)
                        const sortedItems = [...activeFormula.items].sort((a, b) => (a.additionOrder || 0) - (b.additionOrder || 0));
                        return {
                            ...stage,
                            inputs: sortedItems.map((fi, idx) => ({
                                id: fi.id || `formula-${idx}`,
                                inputType: 'RAW_MATERIAL',
                                productId: fi.ingredientId,
                                product: fi.ingredient,
                                quantityPerUnit: fi.quantity,
                                unit: fi.unit || 'gramo',
                                displayOrder: idx + 1
                            }))
                        };
                    }
                    return stage;
                });

                setTemplate({ ...loadedTemplate, stages: syncedStages });
            } else {
                // Auto-generate sequential template code (TMPL014, TMPL015, ...)
                const allCodes = (allTemplatesRes.data || []).map(t => t.templateCode);
                const maxNum = allCodes.reduce((max, c) => {
                    const m = c.match(/^TMPL(\d+)$/);
                    return m ? Math.max(max, parseInt(m[1], 10)) : max;
                }, 0);
                const code = `TMPL${String(maxNum + 1).padStart(3, '0')}`;
                setTemplate(prev => ({ ...prev, templateCode: code }));
            }
        } catch (error) {
            console.error('Error loading data:', error);
            message.error('Error al cargar datos');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        // Validations
        if (!template.templateCode || !template.templateName || !template.productId) {
            message.error('Código, nombre y producto son requeridos');
            return;
        }

        if (template.stages.length === 0) {
            message.error('Debe agregar al menos una etapa');
            return;
        }

        setSaving(true);
        try {
            const userId = localStorage.getItem('userId');
            const payload = {
                ...template,
                createdById: userId
            };

            if (id && id !== 'new') {
                await api.patch(`/assembly-templates/${id}`, payload);
                message.success('Plantilla actualizada exitosamente');
            } else {
                const response = await api.post('/assembly-templates', payload);
                message.success('Plantilla creada exitosamente');
                navigate(`/assembly-templates/${response.data.id}`);
            }
        } catch (error) {
            console.error('Error saving template:', error);
            message.error(error.response?.data?.error || 'Error al guardar plantilla');
        } finally {
            setSaving(false);
        }
    };

    const handleAddStage = (processType) => {
        // Validate: ENSAMBLE requires at least one prior stage
        const isEnsamble = processType.name?.toUpperCase().includes('ENSAMBLE') || processType.code?.toUpperCase() === 'ENSAMBLE';
        if (isEnsamble && template.stages.length === 0) {
            message.error('No puede agregar Ensamble como primera etapa. Primero agregue un proceso con ingredientes (ej: Pesaje).');
            return;
        }

        const newStage = {
            id: `stage-${Date.now()}`,
            stageOrder: template.stages.length + 1,
            stageName: `Etapa ${template.stages.length + 1}`,
            processTypeId: processType.id,
            processType: processType,
            processParameters: {},
            inputs: [],
            outputProductId: null,
            outputClassification: 'PRODUCTO_EN_PROCESO'
        };

        setTemplate({
            ...template,
            stages: [...template.stages, newStage]
        });

        message.success(`Agregada ${processType.name}`);
    };

    // Add a sub-template as a stage (template composition)
    const handleAddSubTemplate = (subTemplate) => {
        // Don't allow adding self as sub-template
        if (id && subTemplate.id === id) {
            message.error('No puede agregar la misma plantilla como sub-proceso');
            return;
        }

        const newStage = {
            id: `stage-${Date.now()}`,
            stageOrder: template.stages.length + 1,
            stageName: `📋 ${subTemplate.product?.name || subTemplate.templateName}`,
            processTypeId: subTemplate.stages?.[0]?.processTypeId || processTypes[0]?.id,
            processType: subTemplate.stages?.[0]?.processType || processTypes[0],
            processParameters: {},
            inputs: [],
            outputProductId: subTemplate.productId,
            outputClassification: 'PRODUCTO_EN_PROCESO',
            subTemplateId: subTemplate.id,
            subTemplate: subTemplate
        };

        setTemplate({
            ...template,
            stages: [...template.stages, newStage]
        });

        const stageCount = subTemplate.stages?.length || subTemplate.totalStages || 0;
        message.success(`Agregada plantilla "${subTemplate.product?.name}" (${stageCount} etapas)`);
    };

    const handleAddInput = (stageId, product, inputType) => {
        setTemplate({
            ...template,
            stages: template.stages.map(stage => {
                if (stage.id === stageId || stage.stageOrder === stageId) {
                    return {
                        ...stage,
                        inputs: [
                            ...stage.inputs,
                            {
                                id: `input-${Date.now()}`,
                                inputType: inputType,
                                productId: product.id,
                                product: product,
                                quantityPerUnit: 1,
                                unit: product.unit,
                                fromStageOrder: inputType === 'FROM_PREVIOUS_STAGE' ? stage.stageOrder - 1 : null
                            }
                        ]
                    };
                }
                return stage;
            })
        });
    };

    const handleRemoveStage = (stageId) => {
        setTemplate({
            ...template,
            stages: template.stages
                .filter(s => s.id !== stageId)
                .map((s, index) => ({ ...s, stageOrder: index + 1 }))
        });
        setSelectedStageId(null);
    };

    const handleRemoveInput = (stageId, inputId) => {
        setTemplate({
            ...template,
            stages: template.stages.map(stage => {
                if (stage.id === stageId) {
                    return {
                        ...stage,
                        inputs: stage.inputs.filter(i => i.id !== inputId)
                    };
                }
                return stage;
            })
        });
    };

    const handleReorderStages = (dragIndex, hoverIndex) => {
        const newStages = [...template.stages];
        const draggedStage = newStages[dragIndex];
        newStages.splice(dragIndex, 1);
        newStages.splice(hoverIndex, 0, draggedStage);

        setTemplate({
            ...template,
            stages: newStages.map((s, index) => ({ ...s, stageOrder: index + 1 }))
        });
    };

    const handleUpdateStage = (stageId, updates) => {
        setTemplate({
            ...template,
            stages: template.stages.map(stage =>
                stage.id === stageId ? { ...stage, ...updates } : stage
            )
        });
    };

    // Import all ingredients from a formula into a stage
    const handleImportFormula = (stageId, formulaId) => {
        const formula = formulas.find(f => f.id === formulaId);
        if (!formula || !formula.items || formula.items.length === 0) {
            message.warning('La fórmula no tiene ingredientes');
            return;
        }

        // quantityPerUnit MUST be a ratio: ingredient_qty / formula_output_qty
        // The backend does: plannedQuantity = quantityPerUnit × targetQuantity
        // So we need fractions, NOT absolute grams
        const formulaTotalOutputQty = formula.items.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0) || 1;

        const newInputs = formula.items.map((item, idx) => ({
            id: `input-${Date.now()}-${idx}`,
            inputType: 'RAW_MATERIAL',
            productId: item.ingredientId,
            product: item.ingredient,
            quantityPerUnit: (parseFloat(item.quantity) || 0) / formulaTotalOutputQty, // ← ratio, not absolute
            unit: item.unit,
            displayOrder: idx + 1
        }));

        // Find the product from the formula
        const formulaProduct = products.find(p => p.id === formula.productId);
        const productName = formulaProduct?.name || formula.product?.name || '';

        // Get the stage's process type name for the auto-generated stage name
        const stage = template.stages.find(s => s.id === stageId || s.stageOrder === stageId);
        const processName = stage?.processType?.name || 'Pesaje';
        const cleanName = productName.replace(/^PREMEZCLA\s*/i, '').replace(/\s+PERLAS$/i, '');
        const stageName = `${processName} de ${cleanName}`.trim();

        // Auto-generate special instructions based on process type
        const ingredientList = formula.items.map(i => i.ingredient?.name || 'Ingrediente').join(', ');
        const isEnsamble = processName.toUpperCase().includes('ENSAMBLE');
        const specialInstructions = isEnsamble
            ? `Ensamblar los componentes según la fórmula. Verificar cantidades y calidad del producto final.\nComponentes: ${ingredientList}`
            : `Pesar cada ingrediente por separado. Registrar peso real y número de lote de cada insumo. Verificar que el peso esté dentro del ±5% del planificado.\nIngredientes: ${ingredientList}`;

        setTemplate(prev => ({
            ...prev,
            stages: prev.stages.map(stage => {
                if (stage.id === stageId || stage.stageOrder === stageId) {
                    return {
                        ...stage,
                        stageName,
                        specialInstructions,
                        outputProductId: formula.productId,
                        outputProduct: formulaProduct || formula.product,
                        outputClassification: 'SEMI_FINISHED',
                        inputs: [...stage.inputs, ...newInputs]
                    };
                }
                return stage;
            })
        }));

        message.success(`${newInputs.length} ingredientes importados de ${formula.formulaCode}`);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
                <Spin size="large" tip="Cargando editor..." />
            </div>
        );
    }

    return (
        <DndProvider backend={HTML5Backend}>
            <div style={{ padding: 24 }}>
                <Card
                    title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                {id === 'new' ? 'Nueva Plantilla de Producción' : 'Editar Plantilla de Producción'}
                            </span>
                            <div>
                                <Button
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => navigate('/assembly-templates')}
                                    style={{ marginRight: 8 }}
                                >
                                    Volver
                                </Button>
                                <Button
                                    icon={<RocketOutlined />}
                                    onClick={() => {
                                        if (template.stages.length > 0) {
                                            setSelectedStageId(template.stages[0].id || template.stages[0].stageOrder);
                                        }
                                    }}
                                    style={{ marginRight: 8 }}
                                    type={!selectedStageId ? 'primary' : 'default'}
                                >
                                    Abrir Edición
                                </Button>
                                <Button
                                    type="primary"
                                    icon={<SaveOutlined />}
                                    onClick={handleSave}
                                    loading={saving}
                                >
                                    Guardar Plantilla
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <Row gutter={16}>
                        {/* Panel Izquierdo: Biblioteca */}
                        <Col span={7}>
                            <ProcessLibrary
                                processTypes={processTypes}
                                products={products}
                                allTemplates={allTemplates.filter(t => t.id !== id)}
                                onAddStage={handleAddStage}
                                onAddSubTemplate={handleAddSubTemplate}
                                onAddInput={handleAddInput}
                                selectedStageId={selectedStageId}
                            />
                        </Col>

                        {/* Canvas Central */}
                        <Col span={10}>
                            <TemplateCanvas
                                template={template}
                                onTemplateChange={setTemplate}
                                selectedStageId={selectedStageId}
                                onSelectStage={(stage) => setSelectedStageId(stage.id || stage.stageOrder)}
                                onRemoveStage={handleRemoveStage}
                                onRemoveInput={handleRemoveInput}
                                onAddInput={handleAddInput}
                                onReorderStages={handleReorderStages}
                            />
                        </Col>

                        {/* Panel Derecho: Configuración */}
                        <Col span={7}>
                            <ConfigPanel
                                template={template}
                                selectedStage={template.stages.find(s => s.id === selectedStageId || s.stageOrder === selectedStageId)}
                                products={products}
                                formulas={formulas}
                                allTemplates={allTemplates}
                                onTemplateChange={setTemplate}
                                onStageUpdate={handleUpdateStage}
                                onImportFormula={handleImportFormula}
                            />
                        </Col>
                    </Row>
                </Card>
            </div>
        </DndProvider>
    );
}

export default TemplateEditorPage;
