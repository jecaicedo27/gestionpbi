import React, { useState, useEffect, useRef } from 'react';
import { Form, Select, Button, Input, DatePicker, message, Card, Typography, Row, Col, Space, Checkbox, Image, Progress, Alert } from 'antd';
import { CameraOutlined, CheckCircleFilled } from '@ant-design/icons';
import { getSanitationConfig, createSanitationRecord, uploadSanitationPhoto } from '../../api/sanitation';
import { useAuth } from '../../context/AuthContext';

const { Title, Text } = Typography;
const { Option } = Select;

const SanitationForm = () => {
    const { user } = useAuth();
    const [form] = Form.useForm();
    const [config, setConfig] = useState({ areas: [], chemicals: [] });
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [selectedAreaId, setSelectedAreaId] = useState(null);
    const [components, setComponents] = useState([]);
    const [checklistState, setChecklistState] = useState({});

    const fileInputRef = useRef(null);
    const [activeComponentId, setActiveComponentId] = useState(null);

    useEffect(() => {
        const fetchConfig = async () => {
            setLoading(true);
            try { setConfig(await getSanitationConfig()); } 
            catch { message.error('Error cargando configuración'); }
            finally { setLoading(false); }
        };
        fetchConfig();
    }, []);

    const handleAreaChange = (areaId) => {
        setSelectedAreaId(areaId);
        form.setFieldValue('areaId', areaId);
        const area = config.areas.find(a => a.id === areaId);
        const areaComponents = area?.components || [];
        setComponents(areaComponents);
        const initial = {};
        areaComponents.forEach(c => { initial[c.id] = { checked: false, photoUrl: null, uploading: false }; });
        setChecklistState(initial);
    };

    const handleCheckToggle = (componentId) => {
        setChecklistState(prev => ({
            ...prev,
            [componentId]: { ...prev[componentId], checked: !prev[componentId]?.checked }
        }));
    };

    const handlePhotoCapture = (componentId) => {
        setActiveComponentId(componentId);
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileSelected = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeComponentId) return;

        setChecklistState(prev => ({
            ...prev,
            [activeComponentId]: { ...prev[activeComponentId], uploading: true }
        }));

        try {
            const { url } = await uploadSanitationPhoto(file);
            setChecklistState(prev => ({
                ...prev,
                [activeComponentId]: { ...prev[activeComponentId], photoUrl: url, checked: true, uploading: false }
            }));
            message.success('Foto subida ✓');
        } catch {
            message.error('Error subiendo la foto');
            setChecklistState(prev => ({
                ...prev,
                [activeComponentId]: { ...prev[activeComponentId], uploading: false }
            }));
        }
        e.target.value = '';
    };

    const completedCount = Object.values(checklistState).filter(v => v.checked && v.photoUrl).length;
    const totalComponents = components.length;
    const allComplete = totalComponents > 0 && completedCount === totalComponents;

    const handleSubmit = async (values) => {
        if (totalComponents > 0 && !allComplete) {
            message.warning('Complete todos los componentes con foto antes de enviar');
            return;
        }
        setSubmitting(true);
        try {
            const checkItems = components.map(c => ({
                componentId: c.id,
                checked: checklistState[c.id]?.checked || false,
                photoUrl: checklistState[c.id]?.photoUrl || null
            }));
            await createSanitationRecord({
                ...values,
                performedById: user.id,
                startedAt: values.dateRange[0].toISOString(),
                completedAt: values.dateRange[1].toISOString(),
                checkItems
            });
            message.success('✅ Registro de lavado guardado exitosamente');
            form.resetFields();
            setSelectedAreaId(null);
            setComponents([]);
            setChecklistState({});
        } catch {
            message.error('Error al guardar el registro');
        } finally {
            setSubmitting(false);
        }
    };

    // ========== RENDER ==========
    return (
        <div style={{ padding: '16px 12px', maxWidth: 960, margin: '0 auto' }}>
            <Title level={3} style={{ marginBottom: 4, fontSize: 22 }}>🧹 Registro de Lavado y Desinfección</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 14 }}>
                Complete este formulario cada vez que realice una limpieza.
            </Text>

            <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
                <Row gutter={12}>
                    <Col xs={24} md={12}>
                        <Form.Item name="areaId" label="Equipo a Lavar" rules={[{ required: true, message: 'Seleccione el área' }]}>
                            <Select 
                                placeholder="Seleccione el equipo..." 
                                showSearch 
                                optionFilterProp="children" 
                                onChange={handleAreaChange}
                                style={{ fontSize: 16 }}
                            >
                                <Select.OptGroup label="🟠 Línea de Siropes">
                                    {config.areas.filter(a => a.productionLine === 'SIROPES').map(a => (
                                        <Option key={a.id} value={a.id}>{a.name} {a.components?.length > 0 ? `(${a.components.length} partes)` : ''}</Option>
                                    ))}
                                </Select.OptGroup>
                                <Select.OptGroup label="🟣 Línea de Perlas (Popping)">
                                    {config.areas.filter(a => a.productionLine === 'PERLAS').map(a => (
                                        <Option key={a.id} value={a.id}>{a.name} {a.components?.length > 0 ? `(${a.components.length} partes)` : ''}</Option>
                                    ))}
                                </Select.OptGroup>
                                <Select.OptGroup label="⚪ Áreas Comunes">
                                    {config.areas.filter(a => a.productionLine === 'GENERAL').map(a => (
                                        <Option key={a.id} value={a.id}>{a.name} {a.components?.length > 0 ? `(${a.components.length} partes)` : ''}</Option>
                                    ))}
                                </Select.OptGroup>
                            </Select>
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="type" label="Tipo de Lavado" rules={[{ required: true }]}>
                            <Select placeholder="Seleccione Tipo...">
                                <Option value="PRE_OPERACIONAL">Pre-operacional (Inicio)</Option>
                                <Option value="INTERMEDIO">Intermedio (Entre Batches)</Option>
                                <Option value="POST_OPERACIONAL">Post-operacional (Final)</Option>
                                <Option value="PROFUNDO">Profundo (Semanal)</Option>
                            </Select>
                        </Form.Item>
                    </Col>
                </Row>

                <Form.Item name="dateRange" label="Duración (Inicio - Fin)" rules={[{ required: true }]}>
                    <DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                </Form.Item>

                {/* ==================== CHECKLIST DE COMPONENTES ==================== */}
                {components.length > 0 && (
                    <Card 
                        title={
                            <span style={{ fontSize: 16 }}>
                                <CheckCircleFilled style={{ color: allComplete ? '#52c41a' : '#faad14', marginRight: 8 }} />
                                Checklist ({completedCount}/{totalComponents})
                            </span>
                        }
                        style={{ 
                            marginBottom: 20, 
                            borderColor: allComplete ? '#52c41a' : '#faad14',
                            borderWidth: 2,
                            borderStyle: 'solid'
                        }}
                        bodyStyle={{ padding: 0 }}
                    >
                        <div style={{ padding: '12px 16px' }}>
                            <Progress 
                                percent={Math.round((completedCount / totalComponents) * 100)} 
                                status={allComplete ? 'success' : 'active'}
                                strokeWidth={10}
                            />
                        </div>
                        
                        {!allComplete && (
                            <Alert 
                                message="Tome foto de cada parte lavada para continuar" 
                                type="warning" showIcon 
                                style={{ margin: '0 16px 8px', borderRadius: 6 }}
                            />
                        )}

                        {components.map((comp, idx) => {
                            const state = checklistState[comp.id] || {};
                            const isDone = state.checked && state.photoUrl;
                            return (
                                <div 
                                    key={comp.id} 
                                    style={{
                                        display: 'flex', 
                                        alignItems: 'center',
                                        padding: '14px 16px',
                                        borderBottom: idx < components.length - 1 ? '1px solid #f0f0f0' : 'none',
                                        backgroundColor: isDone ? '#f6ffed' : state.uploading ? '#e6f7ff' : 'transparent',
                                        transition: 'background-color 0.3s',
                                        minHeight: 64, // Touch-friendly height
                                        gap: 10
                                    }}
                                >
                                    {/* Checkbox - Large touch target */}
                                    <div 
                                        onClick={() => handleCheckToggle(comp.id)}
                                        style={{
                                            width: 36, height: 36, 
                                            borderRadius: 8, 
                                            border: isDone ? '2px solid #52c41a' : '2px solid #d9d9d9',
                                            backgroundColor: isDone ? '#52c41a' : '#fff',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer', flexShrink: 0,
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {isDone && <span style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>✓</span>}
                                    </div>

                                    {/* Component name */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text 
                                            strong 
                                            style={{ 
                                                fontSize: 15, 
                                                display: 'block',
                                                textDecoration: isDone ? 'line-through' : 'none',
                                                color: isDone ? '#8c8c8c' : '#262626'
                                            }}
                                        >
                                            {idx + 1}. {comp.name}
                                        </Text>
                                    </div>

                                    {/* Photo preview */}
                                    {state.photoUrl && (
                                        <Image 
                                            src={state.photoUrl} 
                                            width={50} height={50} 
                                            style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} 
                                        />
                                    )}

                                    {/* Camera button - Large touch */}
                                    <Button 
                                        type={state.photoUrl ? 'default' : 'primary'}
                                        icon={<CameraOutlined style={{ fontSize: 18 }} />} 
                                        onClick={() => handlePhotoCapture(comp.id)}
                                        loading={state.uploading}
                                        style={{ 
                                            height: 44, 
                                            minWidth: 44,
                                            borderRadius: 10,
                                            fontSize: 14,
                                            fontWeight: 500,
                                            flexShrink: 0
                                        }}
                                    >
                                        <span className="hide-on-small">{state.photoUrl ? '↻' : 'Foto'}</span>
                                    </Button>
                                </div>
                            );
                        })}
                    </Card>
                )}

                {/* Hidden file input for camera */}
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileSelected}
                />

                {/* Detergente */}
                <Card title="1. Detergente (Opcional)" size="small" style={{ marginBottom: 12 }}>
                    <Row gutter={12}>
                        <Col xs={24} md={8}>
                            <Form.Item name="detergentId" label="Detergente">
                                <Select placeholder="Seleccione..." allowClear>
                                    {config.chemicals.filter(c => c.type === 'DETERGENTE').map(c => (
                                        <Option key={c.id} value={c.id}>{c.name}</Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item name="detergentDose" label="Dosis">
                                <Input placeholder="1%" />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item name="detergentTimeMinutes" label="Tiempo (Min)">
                                <Input type="number" placeholder="10" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>

                {/* Desinfectante */}
                <Card title="2. Desinfectante (Opcional)" size="small" style={{ marginBottom: 12 }}>
                    <Row gutter={12}>
                        <Col xs={24} md={8}>
                            <Form.Item name="disinfectantId" label="Desinfectante">
                                <Select placeholder="Seleccione..." allowClear>
                                    {config.chemicals.filter(c => c.type === 'DESINFECTANTE').map(c => (
                                        <Option key={c.id} value={c.id}>{c.name}</Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item name="disinfectantDose" label="Dosis">
                                <Input placeholder="200ppm" />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item name="disinfectantTimeMinutes" label="Tiempo (Min)">
                                <Input type="number" placeholder="10" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>

                <Form.Item name="observations" label="Observaciones (Opcional)">
                    <Input.TextArea rows={2} placeholder="Novedades durante la limpieza..." />
                </Form.Item>

                <Button 
                    type="primary" 
                    htmlType="submit" 
                    loading={submitting} 
                    block 
                    disabled={totalComponents > 0 && !allComplete}
                    style={{ 
                        height: 56, 
                        fontSize: 18, 
                        fontWeight: 600,
                        borderRadius: 12,
                        marginBottom: 24
                    }}
                >
                    {totalComponents > 0 && !allComplete 
                        ? `⚠️ Faltan ${totalComponents - completedCount} componentes` 
                        : '✅ Registrar Lavado'}
                </Button>
            </Form>

            <style>{`
                @media (max-width: 768px) {
                    .hide-on-small { display: none; }
                }
            `}</style>
        </div>
    );
};

export default SanitationForm;
