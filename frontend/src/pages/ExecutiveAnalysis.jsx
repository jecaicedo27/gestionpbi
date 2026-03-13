import { useState, useEffect } from 'react';
import api from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LabelList } from 'recharts';
import { Loader } from 'lucide-react';

const TopFlavorsCard = ({ title, data, colorBase, unit }) => {
    const sortedData = [...data].sort((a, b) => b.totalSalesKg - a.totalSalesKg);
    const maxSales = Math.max(...sortedData.map(d => d.totalSalesKg), 1);

    const sizeColors = {
        '360 ML': '#60a5fa',
        '1000 ML': '#2563eb',
        '1 GALON': '#172554',
        '350 G': '#f472b6',
        '1150 G': '#db2777',
        '3.2 KG': '#700d33',
        'DEFAULT': '#94a3b8'
    };

    const getSizeColor = (sizeStr) => {
        const key = Object.keys(sizeColors).find(k => sizeStr.toUpperCase().includes(k)) || 'DEFAULT';
        return sizeColors[key];
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col h-full overflow-hidden">
            <div className="mb-10 pl-5 border-l-4" style={{ borderLeftColor: colorBase }}>
                <h2 className="text-xl font-bold text-slate-800 tracking-tight mb-1">
                    {title}
                </h2>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Distribución de Ventas vs. Mix de Producción
                </p>
            </div>

            <div className="flex-1 overflow-y-auto pr-6 -mr-4 custom-scrollbar">
                <div className="space-y-14 pb-4">
                    {sortedData.map((item, index) => (
                        <div key={index} className="relative group transition-all">
                            {/* Header Section */}
                            <div className="flex justify-between items-center mb-5">
                                <span className="text-[13px] font-bold text-slate-700 tracking-tight uppercase">
                                    {item.flavor}
                                </span>
                                <div className="flex items-baseline gap-1 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 shadow-sm">
                                    <span className="text-[15px] font-black text-slate-900 tracking-tighter">
                                        {item.totalSalesKg.toLocaleString()}
                                    </span>
                                    <span className="text-[11px] font-black text-slate-400 uppercase">{unit}</span>
                                </div>
                            </div>

                            {/* Data Bars */}
                            <div className="space-y-6">
                                {/* Sales Track */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center px-0.5">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-80">Desempeño Ventas</span>
                                    </div>
                                    <div className="h-3 w-full bg-slate-100/50 rounded-full overflow-hidden shadow-inner border border-slate-50">
                                        <div
                                            className="h-full rounded-full transition-all duration-1000 ease-out shadow-sm"
                                            style={{
                                                width: `${(item.totalSalesKg / maxSales) * 100}%`,
                                                background: `linear-gradient(90deg, ${colorBase}, ${colorBase}dd)`,
                                                boxShadow: `0 0 10px ${colorBase}33`
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Production Mix Track */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center px-0.5">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-80">Mix de Fabricación</span>
                                    </div>
                                    <div className="h-6 w-full bg-slate-50 rounded-lg flex overflow-hidden border border-slate-200 shadow-sm">
                                        {item.sizeDistribution.map((sizePart, i) => (
                                            <div
                                                key={i}
                                                className="h-full relative group/segment transition-all hover:brightness-105 active:scale-[0.98] flex items-center justify-center overflow-hidden"
                                                style={{
                                                    width: `${sizePart.percentage}%`,
                                                    backgroundColor: getSizeColor(sizePart.size),
                                                    borderRight: i < item.sizeDistribution.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none'
                                                }}
                                                title={`${sizePart.size}: ${sizePart.percentage.toFixed(1)}%`}
                                            >
                                                {sizePart.percentage > 10 && (
                                                    <span className="text-[10px] font-black text-white px-1 tracking-tighter drop-shadow-md">
                                                        {Math.round(sizePart.percentage)}%
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                        {item.sizeDistribution.length === 0 && (
                                            <div className="w-full flex items-center justify-center bg-slate-100 text-[10px] font-bold text-slate-400 italic">
                                                Sin datos de producción registrados
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Divider with spacing fix */}
                            {index !== sortedData.length - 1 && (
                                <div className="absolute -bottom-7 left-0 w-full border-b border-slate-100/50" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend Section (Enhanced spacing) */}
            <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex flex-wrap gap-x-5 gap-y-3">
                    {Object.entries(sizeColors).filter(([k]) => k !== 'DEFAULT').map(([label, color]) => (
                        <div key={label} className="flex items-center gap-2 group cursor-default">
                            <div className="w-2.5 h-2.5 rounded-full shadow-inner transition-transform group-hover:scale-125" style={{ backgroundColor: color, border: '1px solid rgba(0,0,0,0.05)' }} />
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tighter transition-colors group-hover:text-slate-800">{label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const ChartCard = ({ title, data, colorBase }) => {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col h-full">
            <h2 className="text-lg font-bold text-gray-700 mb-2 uppercase tracking-wide border-l-4 pl-3" style={{ borderLeftColor: colorBase }}>
                {title} <span className="text-xs font-normal text-gray-400 normal-case ml-2">(Tendencia Kg/L)</span>
            </h2>
            <div className="flex-1 min-h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`colorProd-${title}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={colorBase} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={colorBase} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id={`colorSold-${title}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <Tooltip
                            formatter={(value) => [`${value.toLocaleString()}`, '']}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                        />
                        <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
                        <Area type="monotone" dataKey="producedKg" name="Fabricados" stroke={colorBase} strokeWidth={3} fillOpacity={1} fill={`url(#colorProd-${title})`} />
                        <Area type="monotone" dataKey="soldKg" name="Vendidos" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill={`url(#colorSold-${title})`} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

const TableCard = ({ title, data, months, headerColor }) => {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8">
            <div className={`px-6 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50`}>
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-8 rounded-r-md`} style={{ backgroundColor: headerColor }}></div>
                    <h3 className="text-base font-bold text-gray-800 uppercase tracking-wider">{title}</h3>
                </div>
                <span className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">
                    {data.length} Productos
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-white text-gray-500 font-semibold border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 sticky left-0 bg-white z-10 w-20">Código</th>
                            <th className="px-4 py-3 sticky left-20 bg-white z-10 w-24 text-center">Tamaño</th>
                            <th className="px-4 py-3 sticky left-44 bg-white z-10 border-r border-gray-100 min-w-[250px]">Producto</th>
                            {months.map(m => (
                                <th key={m} className="px-2 py-3 text-center border-l border-gray-100 min-w-[90px]" colSpan={2}>
                                    {m}
                                </th>
                            ))}
                        </tr>
                        <tr className="bg-gray-50/30">
                            <th className="sticky left-0 bg-gray-50/30 z-10"></th>
                            <th className="sticky left-20 bg-gray-50/30 z-10"></th>
                            <th className="sticky left-44 bg-gray-50/30 z-10 border-r border-gray-100"></th>
                            {months.map(m => (
                                <>
                                    <th key={`${m}-p`} className="px-1 py-1 text-[10px] text-blue-600 text-center border-l border-gray-100">PROD</th>
                                    <th key={`${m}-s`} className="px-1 py-1 text-[10px] text-green-600 text-center">VTA</th>
                                </>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {data.map((row) => (
                            <tr key={row.code} className="hover:bg-blue-50/20 transition-colors group">
                                <td className="px-4 py-2 sticky left-0 bg-white group-hover:bg-blue-50/20 z-10 font-mono text-gray-400">{row.code}</td>
                                <td className="px-4 py-2 sticky left-20 bg-white group-hover:bg-blue-50/20 z-10 text-center text-gray-400">{row.size}</td>
                                <td className="px-4 py-2 sticky left-44 bg-white group-hover:bg-blue-50/20 z-10 border-r border-gray-100 font-medium text-gray-700 whitespace-normal min-w-[250px]" title={row.name}>
                                    {row.name}
                                </td>
                                {months.map(m => (
                                    <>
                                        <td key={`${m}-p`} className={`px-1 py-2 text-center border-l border-gray-50 ${row[`produced_${m}`] > 0 ? 'text-blue-600 font-bold' : 'text-gray-200'}`}>
                                            {row[`produced_${m}`] || '-'}
                                        </td>
                                        <td key={`${m}-s`} className={`px-1 py-2 text-center ${row[`sold_${m}`] > 0 ? 'text-green-600 font-bold' : 'text-gray-200'}`}>
                                            {row[`sold_${m}`] || '-'}
                                        </td>
                                    </>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ExecutiveAnalysis = () => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const res = await api.get('/analytics/executive');
            setData(res.data);
        } catch (err) {
            console.error(err);
            setError('Error al cargar datos.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="flex justify-center p-10"><Loader className="animate-spin h-8 w-8 text-blue-500" /></div>;
    if (error) return <div className="text-red-500 p-10 font-bold text-center">{error}</div>;

    const { months, chartData, tableData, flavorStats } = data;

    // Filter Data
    const genialityTable = tableData.filter(row => row.segment === 'GENIALITY');
    const liquipopsTable = tableData.filter(row => row.segment === 'LIQUIPOPS');

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900">Análisis Ejecutivo</h1>
                    <p className="text-gray-500 mt-1">Comparativo de Producción vs Ventas (Últimos 12 meses)</p>
                </div>
            </div>

            {/* TOP ROW: CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-4">
                <ChartCard
                    title="GENIALITY"
                    data={chartData.geniality}
                    colorBase="#ec4899"
                />
                <ChartCard
                    title="LIQUIPOPS"
                    data={chartData.liquipops}
                    colorBase="#3b82f6"
                />
            </div>

            {/* SECOND ROW: TOP FLAVORS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
                <TopFlavorsCard
                    title="TOP SABORES GENIALITY"
                    data={flavorStats.geniality}
                    colorBase="#ec4899"
                    unit="L"
                />
                <TopFlavorsCard
                    title="TOP SABORES LIQUIPOPS"
                    data={flavorStats.liquipops}
                    colorBase="#3b82f6"
                    unit="Kg"
                />
            </div>

            {/* BOTTOM ROWS: TABLES */}
            <h2 className="text-lg font-bold text-gray-400 uppercase tracking-widest mb-4 border-b pb-2">Detalle de Productos</h2>

            <TableCard
                title="Geniality"
                data={genialityTable}
                months={months}
                headerColor="#ec4899"
            />

            <TableCard
                title="Liquipops"
                data={liquipopsTable}
                months={months}
                headerColor="#3b82f6"
            />
        </div>
    );
};

export default ExecutiveAnalysis;
