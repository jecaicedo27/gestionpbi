import React, { useState, useEffect, useMemo } from 'react';
import { Card, Table, Tag, Space, Typography, Row, Col, Statistic, Button, InputNumber, Spin, Alert, Tooltip, Tabs, Badge, Collapse } from 'antd';
import { WarningOutlined, ArrowUpOutlined, ArrowDownOutlined, SettingOutlined, ReloadOutlined, ExclamationCircleOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import api from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/es';
dayjs.extend(relativeTime);
dayjs.locale('es');

const { Title, Text } = Typography;

const ForecastPage = () => {
    const [loading, setLoading] = useState(true);
    const [forecast, setForecast] = useState(null);
    const [config, setConfig] = useState({});
    const [editingConfig, setEditingConfig] = useState(false);
    const [configForm, setConfigForm] = useState({});

    useEffect(() => { loadForecast(); }, []);

    const loadForecast = async () => {
        setLoading(true);
        try {
            const res = await api.get('/procurement/forecast');
            setForecast(res.data);
            setConfig(res.data.config || {});
            setConfigForm(res.data.config || {});
        } catch (err) {
            console.error('Error loading forecast:', err);
        }
        setLoading(false);
    };

    const saveConfig = async () => {
        try {
            await api.put('/procurement/forecast/config', configForm);
            setEditingConfig(false);
            loadForecast();
        } catch (err) {
            console.error('Error saving config:', err);
        }
    };

    // Helper: format quantity based on unit
    const isUnitBased = (unit) => ['unidad', 'und', 'unit'].includes((unit || '').toLowerCase());
    const formatQty = (value, unit) => {
        if (isUnitBased(unit)) return `${Math.round(value)} und`;
        return `${(value / 1000).toFixed(1)} kg`;
    };

    // Separate products into deficit vs OK
    const { inDeficit, stockOk, outOfStock, groupedDeficit, sortedGroupNames } = useMemo(() => {
        const products = forecast?.products || [];
        const inDeficit = products.filter(p => p.deficit > 0);
        const stockOk = products.filter(p => p.deficit === 0);
        const outOfStock = inDeficit.filter(p => !p.currentStock || p.currentStock <= 0);

        // Group deficit products by inventory group
        const groups = {};
        inDeficit.forEach(p => {
            const g = p.groupName || 'Sin grupo';
            if (!groups[g]) groups[g] = [];
            groups[g].push(p);
        });
        // Sort each group: out of stock first, then by deficit desc
        Object.values(groups).forEach(arr => {
            arr.sort((a, b) => {
                const aOut = (!a.currentStock || a.currentStock <= 0) ? 1 : 0;
                const bOut = (!b.currentStock || b.currentStock <= 0) ? 1 : 0;
                if (aOut !== bOut) return bOut - aOut; // out of stock first
                return b.deficit - a.deficit;
            });
        });
        // Sort groups: etiquetas/sellos last
        const LAST_GROUPS = ['MATERIA PRIMA ETIQUETAS Y SELLOS'];
        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
            const aLast = LAST_GROUPS.some(lg => a.toUpperCase().includes(lg)) ? 1 : 0;
            const bLast = LAST_GROUPS.some(lg => b.toUpperCase().includes(lg)) ? 1 : 0;
            if (aLast !== bLast) return aLast - bLast;
            return (groups[b]?.length || 0) - (groups[a]?.length || 0); // more items first
        });

        return { inDeficit, stockOk, outOfStock, groupedDeficit: groups, sortedGroupNames };
    }, [forecast]);

    const columns = [
        {
            title: 'Material',
            key: 'name',
            fixed: 'left',
            width: 220,
            render: (_, r) => (
                <div>
                    <Text strong>{r.name}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>{r.sku} · {r.unit}</Text>
                    {r.inventoryWeeks > (config.inventoryWeeks || 3) && (
                        <Tag color="purple" style={{ marginLeft: 4, fontSize: 10 }}>{r.inventoryWeeks} sem</Tag>
                    )}
                </div>
            ),
            sorter: (a, b) => a.name.localeCompare(b.name)
        },
        {
            title: 'Pack',
            key: 'pack',
            align: 'center',
            width: 90,
            render: (_, r) => {
                if (!r.packSize || r.packSize <= 1) return <Text type="secondary" style={{ fontSize: 11 }}>Unidad</Text>;
                const label = isUnitBased(r.unit)
                    ? `${r.packSize.toLocaleString()} und`
                    : r.packSize >= 1000 ? `${(r.packSize / 1000).toFixed(r.packSize % 1000 === 0 ? 0 : 1)} kg` : `${r.packSize} g`;
                return <Tag color="geekblue" style={{ margin: 0, fontWeight: 600 }}>{label}</Tag>;
            },
            sorter: (a, b) => (a.packSize || 0) - (b.packSize || 0)
        },
        {
            title: 'Prom. Semanal',
            key: 'weekly',
            align: 'right',
            width: 120,
            render: (_, r) => (
                <Tooltip title={`Histórico: ${formatQty(r.historicalWeeklyAvg, r.unit)} · Reciente: ${formatQty(r.recentWeeklyAvg, r.unit)}`}>
                    <Text strong>{formatQty(r.forecastWeekly, r.unit)}</Text>
                </Tooltip>
            ),
            sorter: (a, b) => a.forecastWeekly - b.forecastWeekly
        },
        {
            title: 'Tendencia',
            key: 'trend',
            align: 'center',
            width: 90,
            render: (_, r) => {
                if (r.isGrowing) return <Tag color="green" icon={<ArrowUpOutlined />}>Crece</Tag>;
                const ratio = r.recentWeeklyAvg / (r.historicalWeeklyAvg || 1);
                if (ratio < 0.8) return <Tag color="red" icon={<ArrowDownOutlined />}>Baja</Tag>;
                return <Tag color="blue">Estable</Tag>;
            }
        },
        {
            title: 'Necesario',
            key: 'need',
            align: 'right',
            width: 120,
            render: (_, r) => (
                <Tooltip title={`Para ${r.inventoryWeeks} semanas + buffer`}>
                    <Text strong>{formatQty(r.need, r.unit)}</Text>
                </Tooltip>
            ),
            sorter: (a, b) => a.need - b.need
        },
        {
            title: 'Stock Actual',
            key: 'stock',
            align: 'right',
            width: 110,
            render: (_, r) => {
                if (!r.currentStock || r.currentStock <= 0) return <Tag color="red">AGOTADO</Tag>;
                return <Text>{formatQty(r.currentStock, r.unit)}</Text>;
            }
        },
        {
            title: 'Sem. Stock',
            key: 'weeksStock',
            align: 'center',
            width: 95,
            render: (_, r) => {
                if (!r.currentStock || r.currentStock <= 0) return <Tag color="red">0</Tag>;
                const w = r.weeksOfStock;
                const target = r.inventoryWeeks || 3;
                const color = w < 1 ? 'red' : w < target * 0.5 ? 'orange' : w < target ? 'gold' : 'green';
                return <Tag color={color}>{w} sem</Tag>;
            },
            sorter: (a, b) => a.weeksOfStock - b.weeksOfStock
        },
        {
            title: 'Déficit',
            key: 'deficit',
            align: 'right',
            width: 110,
            render: (_, r) => {
                if (r.deficit === 0) return <Tag color="green">OK</Tag>;
                return (
                    <Text strong style={{ color: '#cf1322' }}>
                        {formatQty(r.deficit, r.unit)}
                    </Text>
                );
            },
            sorter: (a, b) => b.deficit - a.deficit
        },
        {
            title: 'Comprar',
            key: 'packs',
            align: 'right',
            width: 140,
            render: (_, r) => {
                if (r.deficit === 0) return null;
                if (!r.packSize || r.packSize <= 1) {
                    return (
                        <Tooltip title="Producto se compra por unidad">
                            <Text strong style={{ color: '#722ed1' }}>{formatQty(r.deficit, r.unit)}</Text>
                        </Tooltip>
                    );
                }
                const packs = r.packsNeeded || Math.ceil(r.deficit / r.packSize);
                const total = packs * r.packSize;
                const packLabel = isUnitBased(r.unit)
                    ? `${r.packSize.toLocaleString()} und/pack`
                    : `${(r.packSize / 1000).toFixed(1)} kg/pack`;
                return (
                    <Tooltip title={`${packLabel} → ${formatQty(total, r.unit)} total`}>
                        <div style={{ lineHeight: 1.2 }}>
                            <Text strong style={{ color: '#722ed1', fontSize: 14 }}>
                                {packs} {packs === 1 ? 'pack' : 'packs'}
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 10 }}>
                                {formatQty(total, r.unit)}
                            </Text>
                        </div>
                    </Tooltip>
                );
            },
            sorter: (a, b) => (b.packsNeeded || 0) - (a.packsNeeded || 0)
        },
        {
            title: 'Alerta desde',
            key: 'alertSince',
            width: 130,
            render: (_, r) => {
                if (!r.alertSince) return null;
                const d = dayjs(r.alertSince);
                const daysAgo = dayjs().diff(d, 'day');
                const color = daysAgo >= 7 ? 'red' : daysAgo >= 3 ? 'orange' : 'gold';
                return (
                    <Tooltip title={d.format('DD/MM/YYYY HH:mm')}>
                        <Tag icon={<ClockCircleOutlined />} color={color} style={{ margin: 0 }}>
                            {d.fromNow()}
                        </Tag>
                    </Tooltip>
                );
            },
            sorter: (a, b) => {
                const aDate = a.alertSince ? new Date(a.alertSince).getTime() : Infinity;
                const bDate = b.alertSince ? new Date(b.alertSince).getTime() : Infinity;
                return aDate - bDate; // oldest alerts first
            }
        },
        {
            title: 'OC Activa',
            key: 'activePOs',
            width: 140,
            render: (_, r) => {
                if (!r.activePOs || r.activePOs.length === 0) return null;
                const statusColor = { DRAFT: 'default', PENDING_APPROVAL: 'orange', APPROVED: 'green', SENT: 'blue', PARTIALLY_RECEIVED: 'purple', RECEIVED: 'cyan' };
                return (
                    <Space direction="vertical" size={2}>
                        {r.activePOs.map((po, i) => (
                            <Tooltip key={i} title={`${po.supplierName} — Pendiente: ${formatQty(po.pending, r.unit)}`}>
                                <a href="/procurement/purchase-orders" target="_blank" rel="noopener noreferrer">
                                    <Tag color={statusColor[po.status] || 'blue'} style={{ cursor: 'pointer', margin: 0 }}>
                                        🛒 {po.orderNumber}
                                    </Tag>
                                </a>
                            </Tooltip>
                        ))}
                    </Space>
                );
            }
        }
    ];

    if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /><br /><Text>Calculando forecast adaptativo...</Text></div>;

    const meta = forecast?.meta || {};
    const groupNames = sortedGroupNames || [];

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <Title level={2} style={{ margin: 0 }}>📊 Forecast de Materia Prima</Title>
                    <Text type="secondary">Proyección adaptativa · Estacionalidad · YoY · Tendencia reciente</Text>
                </div>
                <Space>
                    <Button icon={<SettingOutlined />} onClick={() => setEditingConfig(!editingConfig)}>Configurar</Button>
                    <Button type="primary" icon={<ReloadOutlined />} onClick={loadForecast}>Recalcular</Button>
                </Space>
            </div>

            {/* KPI Cards */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}>
                    <Card size="small"><Statistic title="Productos MP" value={meta.totalProducts} /></Card>
                </Col>
                <Col xs={12} md={6}>
                    <Card size="small">
                        <Statistic title="Requieren Compra" value={meta.productsInDeficit}
                            valueStyle={{ color: meta.productsInDeficit > 0 ? '#cf1322' : '#3f8600' }}
                            prefix={meta.productsInDeficit > 0 ? <WarningOutlined /> : <CheckCircleOutlined />} />
                    </Card>
                </Col>
                <Col xs={12} md={6}>
                    <Card size="small">
                        <Statistic title="Agotados" value={outOfStock.length}
                            valueStyle={{ color: outOfStock.length > 0 ? '#cf1322' : '#3f8600' }}
                            prefix={outOfStock.length > 0 ? <ExclamationCircleOutlined /> : null} />
                    </Card>
                </Col>
                <Col xs={12} md={6}>
                    <Card size="small">
                        <Statistic title="Crecimiento YoY" value={((meta.growthFactor - 1) * 100).toFixed(0)} suffix="%"
                            prefix={<ArrowUpOutlined />} valueStyle={{ color: '#3f8600' }} />
                    </Card>
                </Col>
            </Row>

            {/* Config Panel */}
            {editingConfig && (
                <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                    <Row gutter={24} align="middle">
                        <Col>
                            <Text strong>Semanas inventario:</Text>
                            <InputNumber min={1} max={12} value={configForm.inventoryWeeks} onChange={v => setConfigForm({ ...configForm, inventoryWeeks: v })} style={{ marginLeft: 8 }} />
                        </Col>
                        <Col>
                            <Text strong>Buffer estándar (%):</Text>
                            <InputNumber min={0} max={50} value={configForm.bufferPct} onChange={v => setConfigForm({ ...configForm, bufferPct: v })} style={{ marginLeft: 8 }} />
                        </Col>
                        <Col>
                            <Text strong>Buffer crecimiento (%):</Text>
                            <InputNumber min={0} max={50} value={configForm.growthBufferPct} onChange={v => setConfigForm({ ...configForm, growthBufferPct: v })} style={{ marginLeft: 8 }} />
                        </Col>
                        <Col><Button type="primary" size="small" onClick={saveConfig}>Guardar</Button></Col>
                    </Row>
                </Card>
            )}

            {/* Algorithm info bar */}
            <Card size="small" style={{ marginBottom: 16, background: '#f0f5ff', border: '1px solid #adc6ff' }}>
                <Row gutter={16}>
                    <Col span={6}><Text type="secondary">📅 Datos: {meta.dataWeeks} sem</Text></Col>
                    <Col span={6}><Text type="secondary">📈 Estacional: {meta.seasonalIndex}x</Text></Col>
                    <Col span={6}><Text type="secondary">🔢 40% reciente + 60% ajustado</Text></Col>
                    <Col span={6}><Text type="secondary">🛡️ Buffer: {config.bufferPct || 15}% / {config.growthBufferPct || 20}%</Text></Col>
                </Row>
            </Card>

            {/* Tabs */}
            <Tabs defaultActiveKey="comprar" items={[
                {
                    key: 'comprar',
                    label: <span>🔴 Requieren Compra <Badge count={inDeficit.length} style={{ backgroundColor: '#cf1322', marginLeft: 8 }} /></span>,
                    children: (
                        <div>
                            {/* Out of stock compact alert */}
                            {outOfStock.length > 0 && (
                                <Alert
                                    type="error"
                                    showIcon
                                    message={<Text strong>⚠️ {outOfStock.length} producto(s) AGOTADOS — requieren compra urgente</Text>}
                                    style={{ marginBottom: 16 }}
                                />
                            )}

                            {/* Grouped by inventory group */}
                            <Collapse
                                defaultActiveKey={groupNames}
                                items={groupNames.map(g => ({
                                    key: g,
                                    label: (
                                        <span>
                                            <Text strong>{g}</Text>
                                            <Badge count={groupedDeficit[g].length} style={{ backgroundColor: '#531dab', marginLeft: 8 }} />
                                            {groupedDeficit[g].some(p => !p.currentStock || p.currentStock <= 0) && (
                                                <Tag color="red" style={{ marginLeft: 8 }}>Tiene agotados</Tag>
                                            )}
                                        </span>
                                    ),
                                    children: (
                                        <Table
                                            columns={columns}
                                            dataSource={groupedDeficit[g]}
                                            rowKey="sku"
                                            size="small"
                                            pagination={false}
                                            scroll={{ x: 900 }}
                                            rowClassName={(r) => (!r.currentStock || r.currentStock <= 0) ? 'row-agotado' : 'row-deficit'}
                                        />
                                    )
                                }))}
                            />
                        </div>
                    )
                },
                {
                    key: 'ok',
                    label: <span>🟢 Stock OK <Badge count={stockOk.length} style={{ backgroundColor: '#3f8600', marginLeft: 8 }} /></span>,
                    children: (
                        <Table
                            columns={columns}
                            dataSource={stockOk}
                            rowKey="sku"
                            size="small"
                            pagination={{ pageSize: 50, showTotal: (t) => `${t} productos con stock suficiente` }}
                            scroll={{ x: 900 }}
                        />
                    )
                }
            ]} />

            <style>{`
                .row-agotado { background: #fff1f0 !important; }
                .row-agotado:hover td { background: #ffccc7 !important; }
                .row-deficit { background: #fffbe6 !important; }
                .row-deficit:hover td { background: #fff1b8 !important; }
            `}</style>
        </div>
    );
};

export default ForecastPage;
