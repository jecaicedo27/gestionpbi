import React, { useState, useEffect } from 'react';
import { 
    Card, Table, Typography, Tag, Space, Button, message, 
    Row, Col, Select, DatePicker, Image, Progress, Empty
} from 'antd';
import { CheckCircleOutlined, CheckCircleFilled, CloseCircleFilled, CameraOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { listSanitationRecords, verifySanitationRecord, getSanitationConfig } from '../../api/sanitation';
import { useAuth } from '../../context/AuthContext';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const SanitationDashboard = () => {
    const { user } = useAuth();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [config, setConfig] = useState({ areas: [], chemicals: [] });
    
    const [dateRange, setDateRange] = useState([dayjs().subtract(7, 'days'), dayjs()]);
    const [selectedArea, setSelectedArea] = useState(null);
    const [selectedType, setSelectedType] = useState(null);

    const fetchConfig = async () => {
        try { setConfig(await getSanitationConfig()); } 
        catch { message.error('Error cargando configuración'); }
    };

    const fetchRecords = async () => {
        setLoading(true);
        try {
            const params = {
                startDate: dateRange?.[0]?.toISOString(),
                endDate: dateRange?.[1]?.toISOString(),
                areaId: selectedArea,
                type: selectedType
            };
            setRecords(await listSanitationRecords(params));
        } catch { message.error('Error cargando bitácora'); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchConfig(); }, []);
    useEffect(() => { fetchRecords(); }, [dateRange, selectedArea, selectedType]);

    const handleVerify = async (id) => {
        try {
            await verifySanitationRecord(id, user.id);
            message.success('Registro verificado ✓');
            fetchRecords();
        } catch { message.error('Error al verificar'); }
    };

    // ==================== EXPANDABLE ROW: Checklist Detail ====================
    const expandedRowRender = (record) => {
        const items = record.checkItems || [];
        
        if (items.length === 0) {
            return (
                <div style={{ padding: '16px 24px', textAlign: 'center' }}>
                    <Text type="secondary">Este equipo no tenía checklist de componentes al momento del registro.</Text>
                    {record.photoUrl && (
                        <div style={{ marginTop: 12 }}>
                            <Text strong>Foto general de evidencia:</Text>
                            <br />
                            <Image src={record.photoUrl} width={200} style={{ borderRadius: 8, marginTop: 8 }} />
                        </div>
                    )}
                    {record.observations && (
                        <div style={{ marginTop: 12 }}>
                            <Text strong>Observaciones: </Text>
                            <Text>{record.observations}</Text>
                        </div>
                    )}
                </div>
            );
        }

        const completed = items.filter(i => i.checked).length;
        const total = items.length;

        return (
            <div style={{ padding: '12px 24px', backgroundColor: '#fafafa', borderRadius: 8 }}>
                {/* Summary Header */}
                <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                        <Card size="small" style={{ borderColor: '#52c41a' }}>
                            <Text strong style={{ fontSize: 14 }}>Componentes verificados</Text>
                            <Progress 
                                percent={Math.round((completed / total) * 100)} 
                                status={completed === total ? 'success' : 'exception'}
                                strokeWidth={8}
                            />
                            <Text type="secondary">{completed} de {total} partes lavadas y fotografiadas</Text>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small">
                            <Text strong>Duración: </Text>
                            <Text>{dayjs(record.startedAt).format('HH:mm')} → {dayjs(record.completedAt).format('HH:mm')}</Text>
                            <br />
                            {record.observations && (
                                <><Text strong>Obs: </Text><Text>{record.observations}</Text></>
                            )}
                        </Card>
                    </Col>
                </Row>

                {/* Component Grid with Photos */}
                <Row gutter={[12, 12]}>
                    {items.map((item, idx) => (
                        <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
                            <Card 
                                size="small" 
                                hoverable
                                style={{ 
                                    borderColor: item.checked ? '#52c41a' : '#ff4d4f',
                                    borderWidth: 2,
                                    height: '100%'
                                }}
                                cover={
                                    item.photoUrl ? (
                                        <Image 
                                            src={item.photoUrl} 
                                            height={160}
                                            style={{ objectFit: 'cover' }}
                                            preview={{ mask: <Space><EyeOutlined /> Ver foto</Space> }}
                                        />
                                    ) : (
                                        <div style={{ 
                                            height: 160, display: 'flex', alignItems: 'center', 
                                            justifyContent: 'center', backgroundColor: '#fff1f0' 
                                        }}>
                                            <CameraOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />
                                        </div>
                                    )
                                }
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {item.checked 
                                        ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 18 }} />
                                        : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 18 }} />
                                    }
                                    <Text strong style={{ fontSize: 13 }}>
                                        {idx + 1}. {item.component?.name || 'Componente'}
                                    </Text>
                                </div>
                                {item.checkedAt && (
                                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                                        ✓ {dayjs(item.checkedAt).format('HH:mm')}
                                    </Text>
                                )}
                            </Card>
                        </Col>
                    ))}
                </Row>
            </div>
        );
    };

    const columns = [
        {
            title: 'Fecha/Hora', dataIndex: 'startedAt',
            render: (val) => dayjs(val).format('YYYY-MM-DD HH:mm'),
            sorter: (a, b) => new Date(a.startedAt) - new Date(b.startedAt)
        },
        { title: 'Área / Equipo', dataIndex: ['area', 'name'], key: 'area' },
        {
            title: 'Tipo Lavado', dataIndex: 'type',
            render: (type) => {
                const colors = { 'PRE_OPERACIONAL': 'blue', 'INTERMEDIO': 'orange', 'POST_OPERACIONAL': 'purple', 'PROFUNDO': 'red' };
                return <Tag color={colors[type] || 'default'}>{type}</Tag>;
            }
        },
        {
            title: 'Checklist', key: 'checklist',
            render: (_, record) => {
                const items = record.checkItems || [];
                if (items.length === 0) return <Text type="secondary">—</Text>;
                const done = items.filter(i => i.checked).length;
                const color = done === items.length ? '#52c41a' : '#faad14';
                return (
                    <Tag color={done === items.length ? 'success' : 'warning'}>
                        {done}/{items.length} partes
                    </Tag>
                );
            }
        },
        {
            title: 'Detergente', key: 'detergent',
            render: (_, record) => record.detergent 
                ? <Text>{record.detergent.name} ({record.detergentDose || 'N/A'})</Text>
                : <Text type="secondary">N/A</Text>
        },
        {
            title: 'Desinfectante', key: 'disinfectant',
            render: (_, record) => record.disinfectant 
                ? <Text>{record.disinfectant.name} ({record.disinfectantDose || 'N/A'})</Text>
                : <Text type="secondary">N/A</Text>
        },
        { title: 'Operario', dataIndex: ['performedBy', 'name'], key: 'performedBy' },
        {
            title: 'Estado', key: 'status',
            render: (_, record) => {
                if (record.status === 'VERIFIED') {
                    return <Tag icon={<CheckCircleOutlined />} color="success">Verificado por {record.verifiedBy?.name}</Tag>;
                }
                const canVerify = ['ADMIN', 'CALIDAD', 'QUIMICO'].includes(user?.role);
                return (
                    <Space>
                        <Tag color="warning">Pendiente</Tag>
                        {canVerify && <Button size="small" type="primary" onClick={() => handleVerify(record.id)}>Verificar</Button>}
                    </Space>
                );
            }
        }
    ];

    return (
        <div style={{ padding: 24 }}>
            <Title level={2}>Bitácora de Lavado y Desinfección (POES) 🧼</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                Trazabilidad normativa de limpieza de maquinaria y áreas (INVIMA). Haga clic en una fila para ver el detalle fotográfico.
            </Text>

            <Card style={{ marginBottom: 16 }}>
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                        <RangePicker style={{ width: '100%' }} value={dateRange} onChange={setDateRange} />
                    </Col>
                    <Col xs={24} md={8}>
                        <Select style={{ width: '100%' }} placeholder="Filtrar por Área/Equipo" allowClear value={selectedArea} onChange={setSelectedArea}>
                            <Select.OptGroup label="Línea de Siropes">
                                {config.areas.filter(a => a.productionLine === 'SIROPES').map(a => (
                                    <Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>
                                ))}
                            </Select.OptGroup>
                            <Select.OptGroup label="Línea de Perlas (Popping)">
                                {config.areas.filter(a => a.productionLine === 'PERLAS').map(a => (
                                    <Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>
                                ))}
                            </Select.OptGroup>
                            <Select.OptGroup label="Áreas Comunes">
                                {config.areas.filter(a => a.productionLine === 'GENERAL').map(a => (
                                    <Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>
                                ))}
                            </Select.OptGroup>
                        </Select>
                    </Col>
                    <Col xs={24} md={8}>
                        <Select
                            style={{ width: '100%' }} placeholder="Tipo de Lavado" allowClear
                            value={selectedType} onChange={setSelectedType}
                            options={[
                                { label: 'Pre-Operacional', value: 'PRE_OPERACIONAL' },
                                { label: 'Intermedio', value: 'INTERMEDIO' },
                                { label: 'Post-Operacional', value: 'POST_OPERACIONAL' },
                                { label: 'Profundo / Fin de Semana', value: 'PROFUNDO' }
                            ]}
                        />
                    </Col>
                </Row>
            </Card>

            <Card>
                <Table 
                    columns={columns} 
                    dataSource={records} 
                    rowKey="id" 
                    loading={loading}
                    pagination={{ pageSize: 20 }}
                    size="middle"
                    expandable={{
                        expandedRowRender,
                        expandRowByClick: true,
                        rowExpandable: () => true,
                    }}
                />
            </Card>
        </div>
    );
};

export default SanitationDashboard;
