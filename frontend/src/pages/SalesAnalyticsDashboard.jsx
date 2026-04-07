import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
    PieChart, Pie, Cell, LineChart, Line, Area, AreaChart
} from 'recharts';
import {
    Loader, Users, DollarSign, TrendingUp, ShoppingCart, ChevronDown, ChevronUp,
    Award, Calendar, Percent, Package, AlertTriangle, ArrowUpRight, ArrowDownRight,
    Building2, CreditCard, Clock, Star, BarChart3, Filter, Gift, Sparkles,
    Receipt, Landmark, BadgeMinus, FileText
} from 'lucide-react';

// ─── Color Palette ───
const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];
const SEGMENT_COLORS = { LIQUIPOPS: '#3b82f6', GENIALITY: '#ec4899', OTROS: '#94a3b8' };

// ─── Formatters ───
const formatCurrency = (v) => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v?.toLocaleString('es-CO') || 0}`;
};
const formatNumber = (v) => v?.toLocaleString('es-CO') || '0';
const formatPercent = (v) => `${v}%`;

// ─── KPI Card Component ───
const KpiCard = ({ icon: Icon, label, value, subValue, description, color, iconBg }) => (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm border border-slate-100 p-5 group hover:shadow-md transition-all duration-300">
        <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.04] -mr-6 -mt-6 transition-transform group-hover:scale-125" style={{ backgroundColor: color }} />
        <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-xl shadow-sm" style={{ backgroundColor: iconBg || `${color}15` }}>
                <Icon size={20} style={{ color }} strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight leading-none">{value}</p>
                {subValue && <p className="text-xs text-slate-500 mt-1.5 font-medium">{subValue}</p>}
                {description && <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{description}</p>}
            </div>
        </div>
    </div>
);

// ─── Client Row Component ───
const ClientRow = ({ client, rank, isExpanded, onToggle, maxRevenue }) => {
    const barWidth = maxRevenue > 0 ? (client.totalRevenueNeto / maxRevenue) * 100 : 0;
    const isAtRisk = client.daysSinceLastOrder > 30;

    return (
        <div className={`border border-slate-100 rounded-2xl overflow-hidden transition-all duration-300 ${isExpanded ? 'shadow-lg ring-1 ring-indigo-100' : 'shadow-sm hover:shadow-md'}`}>
            {/* Summary Row */}
            <button
                onClick={onToggle}
                className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition-colors"
            >
                {/* Rank Badge */}
                <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${
                    rank === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white' :
                    rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white' :
                    rank === 3 ? 'bg-gradient-to-br from-orange-300 to-orange-400 text-white' :
                    'bg-slate-100 text-slate-500'
                }`}>
                    {rank}
                </div>

                {/* Client Name & Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800 truncate">{client.name}</span>
                        {isAtRisk && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 text-[10px] font-bold">
                                <AlertTriangle size={10} /> {client.daysSinceLastOrder}d
                            </span>
                        )}
                        {!client.active && (
                            <span className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold">
                                Inactivo
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-slate-400 font-medium">{client.personType}</span>
                        <span className="text-[11px] text-slate-300">•</span>
                        <span className="text-[11px] text-slate-400 font-mono">{client.nit}</span>
                    </div>
                </div>

                {/* Metrics */}
                <div className="hidden md:flex items-center gap-6 flex-shrink-0">
                    {/* Participation */}
                    <div className="text-right w-16">
                        <p className="text-xs font-black text-indigo-600">{client.participationPercent}%</p>
                        <p className="text-[10px] text-slate-400 font-medium">Particip.</p>
                    </div>
                    {/* Orders */}
                    <div className="text-right w-14">
                        <p className="text-xs font-bold text-slate-700">{client.totalOrders}</p>
                        <p className="text-[10px] text-slate-400 font-medium">Pedidos</p>
                    </div>
                    {/* Units */}
                    <div className="text-right w-16">
                        <p className="text-xs font-bold text-slate-700">{formatNumber(client.totalUnits)}</p>
                        <p className="text-[10px] text-slate-400 font-medium">Uds</p>
                    </div>
                    {/* Discount */}
                    <div className="text-right w-14">
                        <p className="text-xs font-bold text-emerald-600">{client.discountPercent}%</p>
                        <p className="text-[10px] text-slate-400 font-medium">Dto.</p>
                    </div>
                    {/* Revenue Bar */}
                    <div className="w-40 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-700 ease-out"
                                style={{
                                    width: `${barWidth}%`,
                                    background: `linear-gradient(90deg, ${COLORS[rank - 1] || '#6366f1'}, ${COLORS[rank - 1] || '#6366f1'}cc)`
                                }}
                            />
                        </div>
                        <span className="text-xs font-black text-slate-800 w-16 text-right">
                            {formatCurrency(client.totalRevenueNeto)}
                        </span>
                    </div>
                </div>

                {/* Mobile revenue */}
                <div className="md:hidden text-right flex-shrink-0">
                    <p className="text-sm font-black text-slate-800">{formatCurrency(client.totalRevenueNeto)}</p>
                    <p className="text-[10px] text-indigo-600 font-bold">{client.participationPercent}%</p>
                </div>

                {/* Toggle */}
                <div className="flex-shrink-0 text-slate-400">
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {/* Expanded Detail Panel */}
            {isExpanded && (
                <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-6 animate-fadeIn">
                    {/* Commercial Card */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
                        <InfoChip icon={Building2} label="Tipo" value={client.personType} />
                        <InfoChip icon={CreditCard} label="NIT/CC" value={client.nit} />
                        <InfoChip icon={Percent} label="Descuento" value={`${client.discountPercent}%`} color={client.discountPercent > 34 ? '#10b981' : '#6366f1'} />
                        {client.totalPartnerBenefit > 0 && (
                            <InfoChip icon={Gift} label="Beneficio Socio" value={formatCurrency(client.totalPartnerBenefit)} color="#f59e0b" subtitle={`+${client.partnerBenefitPercent}% extra vs mercado`} />
                        )}
                        <InfoChip icon={Calendar} label="Primer Pedido" value={client.firstOrderDate ? new Date(client.firstOrderDate).toLocaleDateString('es-CO') : 'N/A'} />
                        <InfoChip icon={Clock} label="Últ. Pedido" value={client.lastOrderDate ? new Date(client.lastOrderDate).toLocaleDateString('es-CO') : 'N/A'} color={isAtRisk ? '#f59e0b' : undefined} />
                        <InfoChip icon={TrendingUp} label="Frecuencia" value={client.avgOrderFrequencyDays ? `Cada ${client.avgOrderFrequencyDays}d` : 'N/A'} />
                    </div>

                    {/* Yearly Breakdown Table */}
                    {Object.keys(client.yearlyBreakdown).length > 0 && (
                        <div className="mb-8">
                            <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <BarChart3 size={14} /> Desglose por Año
                            </h4>
                            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider">
                                            <th className="px-4 py-3 text-left">Año</th>
                                            <th className="px-4 py-3 text-right">Pedidos</th>
                                            <th className="px-4 py-3 text-right">Unidades</th>
                                            <th className="px-4 py-3 text-right">Venta Bruta</th>
                                            <th className="px-4 py-3 text-right text-emerald-600">Descuento</th>
                                            <th className="px-4 py-3 text-right text-indigo-600">Venta Neta</th>
                                            {client.partnerBenefitPercent > 0 && <th className="px-4 py-3 text-right text-amber-600">🎁 Beneficio Socio</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {Object.entries(client.yearlyBreakdown)
                                            .sort(([a], [b]) => b - a)
                                            .map(([year, data]) => (
                                            <tr key={year} className="hover:bg-indigo-50/30 transition-colors">
                                                <td className="px-4 py-2.5 font-black text-slate-800">{year}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-600">{data.orders}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-600">{formatNumber(data.units)}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-slate-500">{formatCurrency(data.revenueBruto)}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-emerald-600">- {formatCurrency(data.discount)}</td>
                                                <td className="px-4 py-2.5 text-right font-black text-indigo-600">{formatCurrency(data.revenueNeto)}</td>
                                                {client.partnerBenefitPercent > 0 && (
                                                    <td className="px-4 py-2.5 text-right font-black text-amber-600">
                                                        {data.partnerBenefit > 0 ? formatCurrency(data.partnerBenefit) : '—'}
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Charts Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Monthly Trend */}
                        {client.monthlyTrend.length > 0 && (
                            <div className="bg-white rounded-xl border border-slate-200 p-5">
                                <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <TrendingUp size={14} /> Tendencia Mensual
                                </h4>
                                <div className="h-56">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={client.monthlyTrend}>
                                            <defs>
                                                <linearGradient id={`grad-${client.id}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={formatCurrency} />
                                            <Tooltip
                                                formatter={(val) => [`$${val.toLocaleString('es-CO')}`, 'Venta Neta']}
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgb(0 0 0 / 0.08)', fontSize: '12px', fontWeight: 600 }}
                                            />
                                            <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill={`url(#grad-${client.id})`} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Top Products */}
                        {client.topProducts.length > 0 && (
                            <div className="bg-white rounded-xl border border-slate-200 p-5">
                                <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Package size={14} /> Top Productos
                                </h4>
                                <div className="space-y-2.5">
                                    {client.topProducts.slice(0, 6).map((p, i) => {
                                        const maxRev = client.topProducts[0]?.revenue || 1;
                                        return (
                                            <div key={p.sku} className="group">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[11px] font-bold text-slate-700 truncate flex-1 mr-3">{p.name}</span>
                                                    <span className="text-[11px] font-black text-slate-500 flex-shrink-0">{formatCurrency(p.revenue)}</span>
                                                </div>
                                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700"
                                                        style={{
                                                            width: `${(p.revenue / maxRev) * 100}%`,
                                                            backgroundColor: COLORS[i % COLORS.length]
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Segment Breakdown Pills */}
                    {Object.keys(client.segmentBreakdown).length > 0 && (
                        <div className="mt-6">
                            <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Star size={14} /> Mix de Líneas
                            </h4>
                            <div className="flex flex-wrap gap-3">
                                {Object.entries(client.segmentBreakdown)
                                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                                    .map(([seg, data]) => {
                                        const totalSegRevenue = Object.values(client.segmentBreakdown).reduce((s, v) => s + v.revenue, 0);
                                        const pct = totalSegRevenue > 0 ? Math.round((data.revenue / totalSegRevenue) * 100) : 0;
                                        const color = SEGMENT_COLORS[seg] || SEGMENT_COLORS.OTROS;
                                        return (
                                            <div key={seg} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                                                <div>
                                                    <span className="text-[11px] font-black text-slate-700 uppercase">{seg}</span>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[10px] font-bold text-slate-500">{formatCurrency(data.revenue)}</span>
                                                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${color}15`, color }}>{pct}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── Info Chip ───
const InfoChip = ({ icon: Icon, label, value, color, subtitle }) => (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-1.5 mb-1">
            <Icon size={12} className="text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-sm font-bold truncate" style={{ color: color || '#334155' }}>{value}</p>
        {subtitle && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
);

// ─── Socios Fundadores Simulator ───
const DEFAULT_SOCIOS = [
    { name: 'Martha Benavides', equity: 1.45 },
    { name: 'Julian Carrillo', equity: 1.01 },
    { name: 'Jackeline', equity: 0.50 },
];
// ERG 2025 data
const ERG_2025 = {
    ingresosNetos: 3819107739,
    costoVentas: 1273202321,
    costoProduccion: 1339561231,
    gastosAdmin: 521248704,
    gastosVentas: 380710865,
    utilidadOperacional: 1206344187,
    resultadoOperativo: 304384618,
    utilidadNeta: 232081506,
    year: 2025,
};

const BASES = [
    { id: 'benefit', label: 'Beneficio Distribuidor', icon: '🏪', color: 'indigo', rec: true },
    { id: 'profit', label: 'Utilidad Neta', icon: '📊', color: 'emerald', rec: false },
    { id: 'sales', label: 'Ventas Netas', icon: '💵', color: 'blue', rec: false },
];

const SociosSimulator = ({ kpis, clients }) => {
    const [base, setBase] = useState('benefit');
    const [rate, setRate] = useState(1);
    const [salesRate, setSalesRate] = useState(0.10);
    const [utilidadNeta, setUtilidadNeta] = useState(ERG_2025.utilidadNeta);
    const [showPanel, setShowPanel] = useState(false);

    const OWNERSHIP = [
        { dist: 'PERLAS EXPLOSIVAS COLOMBIA SAS', owners: [
            { name: 'Jose Leandro Caicedo', equity: 19.1 },
            { name: 'Luis Guillermo Caicedo', equity: 19.1 },
            { name: 'Wilmer Javier Caicedo', equity: 19.1 },
            { name: 'Jhon Edisson Caicedo', equity: 19.1 },
        ]},
        { dist: 'TOPPING FROZEN', owners: [{ name: 'Angelo Rojas', equity: 10.84 }] },
        { dist: 'ESFERAS EXPLOSIVAS', owners: [{ name: 'Ines Benavides', equity: 4.0 }] },
        { dist: 'EXPLOSION DE SABORES', owners: [
            { name: 'Tatiana Benavides', equity: 1.0 },
            { name: 'Marleni Benavides', equity: 1.0 },
            { name: 'Jose Alexander Cordoba', equity: 0.5 },
            { name: 'Cristian Daniel', equity: 0.5 },
            { name: 'Vicente Benavides', equity: 1.0 },
        ]},
        { dist: 'MARIBEL ERAZO', owners: [{ name: 'Maribel Erazo', equity: 0.91 }] },
        { dist: 'BURBUJAS EXPLOSIVAS', owners: [
            { name: 'Ximena Benavides', equity: 0.5 },
            { name: 'John Hermes Pantoja', equity: 0.5 },
        ]},
    ];
    const SILENT = [
        { name: 'Martha Benavides', equity: 1.45 },
        { name: 'Julian Carrillo', equity: 1.01 },
        { name: 'Jackeline', equity: 0.50 },
    ];
    const totalSilentEquity = SILENT.reduce((s, so) => s + so.equity, 0);

    const clientMap = {};
    clients.forEach(c => { clientMap[c.name] = c; });

    // Total distributor benefit pool
    const totalDistBenefitAnnual = clients
        .filter(c => c.totalPartnerBenefit > 0)
        .reduce((s, c) => s + c.totalPartnerBenefit, 0);

    const totalSalesAnnual = ERG_2025.ingresosNetos;

    // Break-even rates per distributor
    const breakEvenRates = OWNERSHIP.map(({ dist, owners }) => {
        const client = clientMap[dist];
        const benefit = client?.totalPartnerBenefit || 0;
        const totalEq = owners.reduce((s, o) => s + o.equity, 0);
        const newSilentEq = totalSilentEquity + totalEq;
        const beRate = totalDistBenefitAnnual > 0 && totalEq > 0
            ? (benefit / (totalDistBenefitAnnual * (totalEq / newSilentEq))) * 100
            : 999;
        return { dist, totalEq, benefit, beRate: Math.round(beRate * 10) / 10 };
    }).sort((a, b) => a.beRate - b.beRate);

    const safeMaxRate = Math.floor((breakEvenRates[0]?.beRate || 1) * 10) / 10;

    // Calculate silent partner bonus based on selected base
    const calcSilentBonus = (equity) => {
        if (base === 'benefit') {
            const pool = totalDistBenefitAnnual * (rate / 100);
            return pool * (equity / totalSilentEquity);
        } else if (base === 'profit') {
            return utilidadNeta * (equity / 100);
        } else {
            return totalSalesAnnual * (salesRate / 100) * (equity / totalSilentEquity);
        }
    };

    // Build unified table
    const allInvestors = [];
    OWNERSHIP.forEach(({ dist, owners }) => {
        const client = clientMap[dist];
        const distBenefit = client ? client.totalPartnerBenefit : 0;
        const totalOwnerEq = owners.reduce((s, o) => s + o.equity, 0);
        owners.forEach(owner => {
            const dividend = utilidadNeta * (owner.equity / 100);
            const ownerBenefit = totalOwnerEq > 0 ? distBenefit * (owner.equity / totalOwnerEq) : 0;
            allInvestors.push({
                name: owner.name, equity: owner.equity, dist, isSilent: false,
                dividend, distBenefit: ownerBenefit, silentBonus: 0,
                total: dividend + ownerBenefit,
            });
        });
    });
    SILENT.forEach(s => {
        const dividend = utilidadNeta * (s.equity / 100);
        const bonus = calcSilentBonus(s.equity);
        allInvestors.push({
            name: s.name, equity: s.equity, dist: null, isSilent: true,
            dividend, distBenefit: 0, silentBonus: bonus,
            total: dividend + bonus,
        });
    });
    allInvestors.sort((a, b) => b.total - a.total);

    const silentCalcs = SILENT.map(s => {
        const bonus = calcSilentBonus(s.equity);
        const dividend = utilidadNeta * (s.equity / 100);
        const monthly = (bonus + dividend) / 12;
        return { ...s, bonus, dividend, total: bonus + dividend, monthly };
    });
    const totalSilentBonus = silentCalcs.reduce((s, c) => s + c.bonus, 0);
    const rateExceedsSafe = base === 'benefit' && rate > safeMaxRate;

    const baseDesc = {
        benefit: `${rate}% del beneficio total distribuidores (${formatCurrency(totalDistBenefitAnnual)}/año)`,
        profit: `Equity directo sobre Utilidad Neta (${formatCurrency(utilidadNeta)})`,
        sales: `${salesRate}% de Ventas Netas (${formatCurrency(totalSalesAnnual)}/año)`,
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-8">
            <button onClick={() => setShowPanel(!showPanel)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-50"><Sparkles size={18} className="text-amber-500" /></div>
                    <div className="text-left">
                        <h3 className="text-sm font-black text-slate-800">Simulador: Distribucion de Ganancias por Socio</h3>
                        <p className="text-[11px] text-slate-400 font-medium">
                            Base: {BASES.find(b => b.id === base)?.label} | Bono silenciosos: {formatCurrency(totalSilentBonus)}/año
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {showPanel ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
            </button>

            {showPanel && (
                <div className="border-t border-slate-100 p-6 animate-fadeIn">
                    {/* Base Toggle */}
                    <div className="flex flex-wrap gap-2 mb-5">
                        {BASES.map(b => {
                            const active = base === b.id;
                            return (
                                <button key={b.id} onClick={() => setBase(b.id)}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${active
                                        ? 'bg-slate-800 border-slate-800 text-white shadow-sm'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                    }`}>
                                    <span>{b.icon}</span> {b.label}
                                    {b.rec && <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${active ? 'bg-amber-400 text-slate-900' : 'bg-indigo-100 text-indigo-600'}`}>RECOM.</span>}
                                </button>
                            );
                        })}
                    </div>

                    {/* Controls per base */}
                    <div className="bg-gradient-to-r from-slate-50 to-amber-50/30 rounded-xl p-5 mb-6 border border-slate-100">
                        <div className="flex flex-col lg:flex-row lg:items-end gap-6">
                            <div className="flex-1">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                                    {baseDesc[base]}
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { label: 'Ventas Netas/Año', value: totalSalesAnnual, hl: base === 'sales' },
                                        { label: 'Beneficio Dist/Año', value: totalDistBenefitAnnual, hl: base === 'benefit' },
                                        { label: 'Utilidad Neta', value: ERG_2025.utilidadNeta, hl: base === 'profit' },
                                    ].map((item, i) => (
                                        <div key={i} className={`px-3 py-2 rounded-lg border ${item.hl ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200' : 'bg-white border-slate-200'}`}>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase">{item.label}</p>
                                            <p className={`text-xs font-black ${item.hl ? 'text-amber-700' : 'text-slate-700'}`}>{formatCurrency(item.value)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="lg:w-72 flex-shrink-0">
                                {base === 'benefit' && (
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                                            % del Pool de Beneficio Distribuidor
                                        </label>
                                        <input type="range" min="0.25" max="5" step="0.25" value={rate}
                                            onChange={(e) => setRate(parseFloat(e.target.value))}
                                            className={`w-full h-2 rounded-full appearance-none cursor-pointer ${rate <= safeMaxRate ? 'accent-indigo-500' : 'accent-red-500'}`} />
                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-1">
                                            <span>0.25%</span>
                                            <span className={`font-black ${rate <= safeMaxRate ? 'text-indigo-600' : 'text-red-600'}`}>{rate}%</span>
                                            <span>5%</span>
                                        </div>
                                        <div className="mt-1 text-[9px] font-bold text-emerald-600">
                                            Rate seguro max: {safeMaxRate}% (quiebre: {breakEvenRates[0]?.dist?.substring(0,15)})
                                        </div>
                                    </div>
                                )}
                                {base === 'profit' && (
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                                            Utilidad Neta (editable)
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-black text-slate-400">$</span>
                                            <input type="number" value={utilidadNeta}
                                                onChange={(e) => setUtilidadNeta(Math.max(0, parseInt(e.target.value) || 0))}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-all" />
                                        </div>
                                    </div>
                                )}
                                {base === 'sales' && (
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                                            % de Ventas Netas para silenciosos
                                        </label>
                                        <input type="range" min="0.02" max="0.30" step="0.01" value={salesRate}
                                            onChange={(e) => setSalesRate(parseFloat(e.target.value))}
                                            className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-500" />
                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-1">
                                            <span>0.02%</span><span className="text-blue-600 font-black">{salesRate}%</span><span>0.30%</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Break-even rates table */}
                        {base === 'benefit' && (
                            <div className={`mt-4 rounded-lg border p-3 ${rateExceedsSafe ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Rates de quiebre por distribuidora</p>
                                <div className="flex flex-wrap gap-2">
                                    {breakEvenRates.map((br, i) => {
                                        const danger = rate >= br.beRate;
                                        return (
                                            <div key={i} className={`px-2 py-1.5 rounded-lg border text-[10px] font-bold ${danger ? 'bg-red-100 border-red-300 text-red-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                                                {br.dist?.substring(0, 12)} <span className={`font-black ${danger ? 'text-red-700' : 'text-emerald-600'}`}>{br.beRate}%</span>
                                                {danger && ' \u26D4'}
                                            </div>
                                        );
                                    })}
                                </div>
                                {rateExceedsSafe && (
                                    <p className="text-[10px] text-red-600 font-bold mt-2 flex items-center gap-1">
                                        <AlertTriangle size={12} /> Rate actual ({rate}%) supera el quiebre de {breakEvenRates.filter(b => rate >= b.beRate).map(b => b.dist?.substring(0,12)).join(', ')}. A esos distribuidores les convendria dejar de distribuir.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Silent Partners Cards */}
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Gift size={14} /> Bono Socios sin Distribuidora ({BASES.find(b=>b.id===base)?.label})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        {silentCalcs.map((s, i) => (
                            <div key={i} className={`rounded-xl border p-4 shadow-sm ${s.exceedsFloor ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <p className="text-[12px] font-black text-slate-700">{s.name}</p>
                                        <p className="text-[10px] text-slate-400">Equity: {s.equity}%</p>
                                    </div>
                                    {s.exceedsFloor
                                        ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">Excede</span>
                                        : <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold">Justo</span>
                                    }
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-emerald-600 font-bold">Dividendo:</span>
                                        <span className="font-black text-emerald-700">{formatCurrency(s.dividend)}/año</span>
                                    </div>
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-indigo-600 font-bold">Bono ({BASES.find(b=>b.id===base)?.label.split(' ')[0]}):</span>
                                        <span className="font-black text-indigo-700">{formatCurrency(s.bonus)}/año</span>
                                    </div>
                                    <div className="border-t border-slate-100 pt-1 flex justify-between text-[12px]">
                                        <span className="text-amber-700 font-black">Total mensual:</span>
                                        <span className="font-black text-amber-700">{formatCurrency(s.monthly)}/mes</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Full Table */}
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Users size={14} /> Tabla Completa por Inversionista
                    </h4>
                    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider">
                                    <th className="px-3 py-3 text-left">Inversionista</th>
                                    <th className="px-3 py-3 text-left">Distribuidora</th>
                                    <th className="px-3 py-3 text-right">Equity</th>
                                    <th className="px-3 py-3 text-right text-emerald-600">Dividendo</th>
                                    <th className="px-3 py-3 text-right text-indigo-600">Ben. Dist</th>
                                    <th className="px-3 py-3 text-right text-violet-600">Bono Silent</th>
                                    <th className="px-3 py-3 text-right text-amber-700">Total/Año</th>
                                    <th className="px-3 py-3 text-right">Mensual</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {allInvestors.map((inv, i) => {
                                    const rowTotal = inv.total;
                                    return (
                                        <tr key={i} className={`transition-colors ${inv.isSilent ? 'bg-amber-50/40' : 'hover:bg-slate-50/50'}`}>
                                            <td className="px-3 py-2.5 font-bold text-slate-700">
                                                <div className="flex items-center gap-1.5">
                                                    {inv.isSilent ? <Gift size={12} className="text-amber-500" /> : <Package size={12} className="text-indigo-400" />}
                                                    {inv.name}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-500 text-[10px] font-medium max-w-[120px] truncate">
                                                {inv.dist || <span className="text-amber-600 font-bold">SIN DIST.</span>}
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-mono text-slate-600">{inv.equity}%</td>
                                            <td className="px-3 py-2.5 text-right font-bold text-emerald-600">{formatCurrency(inv.dividend)}</td>
                                            <td className="px-3 py-2.5 text-right font-bold text-indigo-600">
                                                {inv.distBenefit > 0 ? formatCurrency(inv.distBenefit) : <span className="text-slate-300">-</span>}
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-bold text-violet-600">
                                                {inv.silentBonus > 0 ? formatCurrency(inv.silentBonus) : <span className="text-slate-300">-</span>}
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-black text-amber-700">{formatCurrency(rowTotal)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono text-slate-500">{formatCurrency(rowTotal / 12)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Conversion Incentive */}
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
                        <h5 className="text-[11px] font-black text-emerald-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <ArrowUpRight size={12} /> "Si montas distribuidora, ademas del dividendo..."
                        </h5>
                        <div className="space-y-1.5">
                            {silentCalcs.map((s, i) => {
                                const smallestBenefit = breakEvenRates.length > 0 ? breakEvenRates[0].benefit : 0;
                                return (
                                    <div key={i} className="flex items-center justify-between text-[11px]">
                                        <span className="font-bold text-slate-600">{s.name} ({s.equity}%)</span>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-amber-600">Actual: {formatCurrency(s.monthly)}/mes</span>
                                            <span className="text-slate-400">&rarr;</span>
                                            <span className="text-emerald-700 font-black">+ {formatCurrency(smallestBenefit / 12)}/mes min. distribuidora</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-emerald-600 font-medium mt-2 italic">
                            Ref: {breakEvenRates[0]?.dist} (distribuidora mas pequena) gana {formatCurrency((breakEvenRates[0]?.benefit || 0) / 12)}/mes
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Main Dashboard ───
const SalesAnalyticsDashboard = () => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [selectedYear, setSelectedYear] = useState('');

    useEffect(() => {
        fetchData();
    }, [selectedYear]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const params = selectedYear ? `?year=${selectedYear}` : '';
            const res = await api.get(`/analytics/sales/by-client${params}`);
            setData(res.data);
        } catch (err) {
            console.error(err);
            setError('Error al cargar datos de ventas.');
        } finally {
            setLoading(false);
        }
    };

    const maxRevenue = useMemo(() => {
        if (!data?.clients) return 1;
        return Math.max(...data.clients.map(c => c.totalRevenueNeto), 1);
    }, [data]);

    // Participation pie data
    const pieData = useMemo(() => {
        if (!data?.clients) return [];
        return data.clients
            .filter(c => c.totalRevenueNeto > 0)
            .map((c, i) => ({
                name: c.name,
                value: c.totalRevenueNeto,
                color: COLORS[i % COLORS.length]
            }));
    }, [data]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
                <Loader className="animate-spin h-10 w-10 text-indigo-500" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Cargando análisis de ventas...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center p-20">
                <div className="text-center">
                    <AlertTriangle size={48} className="text-red-400 mx-auto mb-3" />
                    <p className="text-red-500 font-bold">{error}</p>
                </div>
            </div>
        );
    }

    const { kpis, clients, availableYears } = data;

    return (
        <div className="p-6 lg:p-8 bg-slate-50 min-h-screen">
            {/* ─── Header ─── */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                        Análisis de Ventas por Cliente
                    </h1>
                    <p className="text-slate-500 mt-1 font-medium">
                        Reporte comercial integral — {kpis.totalClients} clientes · {formatNumber(kpis.totalOrders)} pedidos
                    </p>
                </div>
                {/* Year Filter */}
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-slate-400" />
                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
                    >
                        <option value="">Todos los años</option>
                        {availableYears.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ─── KPI Cards ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
                <KpiCard
                    icon={Users}
                    label="Clientes Activos"
                    value={kpis.activeClients}
                    subValue={`de ${kpis.totalClients} registrados`}
                    description="Clientes que han comprado al menos una vez."
                    color="#6366f1"
                />
                <KpiCard
                    icon={DollarSign}
                    label="Ingreso Real Neto"
                    value={formatCurrency(kpis.totalRevenue)}
                    subValue={`${formatNumber(kpis.totalUnits)} uds · Datos Siigo`}
                    description="Subtotal real de Siigo: lo que queda después de descontar, SIN impuestos. Es el ingreso efectivo."
                    color="#10b981"
                />
                <KpiCard
                    icon={ShoppingCart}
                    label="Total Pedidos"
                    value={formatNumber(kpis.totalOrders)}
                    subValue={kpis.avgFrequencyDays ? `Promedio cada ${kpis.avgFrequencyDays} días` : '—'}
                    description="Número de facturas generadas en Siigo en el período."
                    color="#f59e0b"
                />
                <KpiCard
                    icon={Percent}
                    label="Descuento Promedio"
                    value={`${kpis.avgDiscount}%`}
                    subValue={`Mercado: ${kpis.marketDiscountPercent || 25}%`}
                    description="Promedio ponderado de descuento aplicado a todos los clientes. El mercado paga 25% menos."
                    color="#8b5cf6"
                />
                <KpiCard
                    icon={Gift}
                    label="Beneficio Socios"
                    value={formatCurrency(kpis.totalPartnerBenefit || 0)}
                    subValue={`Ahorro extra vs mercado ${kpis.marketDiscountPercent || 25}%`}
                    description="Dinero extra que los socios ahorran gracias a tener un descuento mayor al 25% del mercado."
                    color="#f59e0b"
                />
                <KpiCard
                    icon={Award}
                    label="Cliente #1"
                    value={kpis.topClientName}
                    subValue={formatCurrency(kpis.topClientRevenue)}
                    description="El cliente con mayor ingreso neto (subtotal Siigo) en el período."
                    color="#ec4899"
                />
            </div>

            {/* ─── Fiscal Breakdown (Siigo Real Data) ─── */}
            {kpis.fiscal && (
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-3">
                        <Receipt size={14} className="text-slate-400" />
                        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Desglose Fiscal — Datos Siigo</h3>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Venta Bruta</p>
                            <p className="text-lg font-black text-slate-700">{formatCurrency(kpis.fiscal.ventaBruta)}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Valor total antes de descuentos e impuestos. Precio base Siigo × unidades vendidas.</p>
                        </div>
                        <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">Descuentos</p>
                            <p className="text-lg font-black text-red-500">-{formatCurrency(kpis.fiscal.descuentosComerciales)}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Descuentos comerciales otorgados a distribuidores (34.8%, 34%, 30%).</p>
                        </div>
                        <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl border border-emerald-200 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Subtotal</p>
                            <p className="text-lg font-black text-emerald-600">{formatCurrency(kpis.fiscal.subtotal)}</p>
                            <p className="text-[10px] text-emerald-400 mt-0.5">Ingreso real neto sin impuestos. Venta Bruta − Descuentos = lo que realmente ingresa.</p>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1">IVA 19%</p>
                            <p className="text-lg font-black text-violet-500">{formatCurrency(kpis.fiscal.iva)}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Impuesto al valor agregado. Se calcula sobre el subtotal y se traslada a la DIAN.</p>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-1">Ultraprocesados</p>
                            <p className="text-lg font-black text-orange-500">{formatCurrency(kpis.fiscal.ultraprocesados)}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Imp. saludable 20% sobre subtotal.{kpis.fiscal.bebidasAzucaradas > 0 ? ` + Bebidas $68/100ml: ${formatCurrency(kpis.fiscal.bebidasAzucaradas)}` : ''}</p>
                        </div>
                        <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl border border-amber-200 p-4 shadow-sm">
                            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Total Facturado</p>
                            <p className="text-lg font-black text-amber-600">{formatCurrency(kpis.fiscal.totalFacturado)}</p>
                            <p className="text-[10px] text-amber-400 mt-0.5">Lo que paga el cliente. Subtotal + IVA + Ultra + Bebidas − ReteFuente.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Participation Pie + Client List ─── */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 mb-8">
                {/* Pie Chart */}
                <div className="xl:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <TrendingUp size={14} /> Participación
                    </h3>
                    <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={45}
                                    outerRadius={80}
                                    paddingAngle={3}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={index} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(val) => [`$${val.toLocaleString('es-CO')}`, 'Venta Neta']}
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgb(0 0 0 / 0.08)', fontSize: '12px', fontWeight: 600 }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="space-y-2 mt-2">
                        {pieData.map((entry) => (
                            <div key={entry.name} className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                                <span className="text-[11px] font-bold text-slate-600 truncate flex-1">{entry.name}</span>
                                <span className="text-[11px] font-black text-slate-400">{formatCurrency(entry.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Client List */}
                <div className="xl:col-span-3 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Users size={14} /> Ranking de Clientes
                        </h3>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                            Ordenado por venta neta
                        </span>
                    </div>
                    {clients.map((client, i) => (
                        <ClientRow
                            key={client.id}
                            client={client}
                            rank={i + 1}
                            isExpanded={expandedId === client.id}
                            onToggle={() => setExpandedId(expandedId === client.id ? null : client.id)}
                            maxRevenue={maxRevenue}
                        />
                    ))}
                </div>
            </div>

            {/* ─── Simulador Socios Fundadores ─── */}
            {kpis.totalPartnerBenefit > 0 && <SociosSimulator kpis={kpis} clients={clients} />}

            {/* ─── Footer ─── */}
            <div className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest pt-4 pb-2 border-t border-slate-100">
                Fuente: Movimientos Siigo · Precios base de lista · Descuentos configurados por distribuidor
            </div>
        </div>
    );
};

export default SalesAnalyticsDashboard;
