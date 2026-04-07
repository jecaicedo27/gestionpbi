import { useEffect, useState } from 'react';
import Card from '../components/common/Card';
import { Package, AlertCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { inventoryService } from '../services/api';
import TrendChart from '../components/analytics/TrendChart';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import DistributorWelcome from './DistributorWelcome';

const Dashboard = () => {
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [stats, setStats] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.role !== 'DISTRIBUIDOR') {
            loadDashboard();
        }
    }, [user?.role]);

    const loadDashboard = async () => {
        setLoading(true);
        try {
            const [dashRes, statsRes, suggRes] = await Promise.all([
                inventoryService.getDashboard(),
                api.get('/analytics/consumption'),
                api.get('/production/liquipops/suggestions')
            ]);
            setData(dashRes.data || {});
            setStats(statsRes.data?.data?.data || []);
            setSuggestions(Array.isArray(suggRes.data) ? suggRes.data : (suggRes.data?.data || []));
        } catch (e) {
            console.error("Dashboard load error", e);
        }
        setLoading(false);
    };

    const StatCard = ({ title, value, color }) => (
        <Card hoverable className="border-l-4" style={{ borderLeftColor: `var(--color-${color}-500)` }}>
            <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-lg bg-${color}-50 text-${color}-600`}>
                    <Package size={20} />
                </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900 mb-1">{value || 0}</p>
            <p className="text-sm text-neutral-500">{title}</p>
        </Card>
    );

    const AlertItem = ({ product, stock, days }) => (
        <div className="flex items-center justify-between p-3 bg-white border border-neutral-100 rounded-lg hover:bg-neutral-50 transition-colors">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-danger-50 text-danger-600 rounded-lg flex items-center justify-center">
                    <AlertCircle size={16} />
                </div>
                <div>
                    <p className="font-medium text-sm text-neutral-900">{product}</p>
                    <p className="text-xs text-neutral-500">Stock: {stock} units</p>
                </div>
            </div>
            <div className="text-right">
                <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-danger-100 text-danger-700">
                    {days} days
                </div>
            </div>
        </div>
    );

    if (user?.role === 'DISTRIBUIDOR') {
        return <DistributorWelcome />;
    }

    if (loading) return <div className="p-8 text-center text-neutral-500">Cargando dashboard...</div>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900">Resumen de Inventario</h1>
                    <p className="text-neutral-500 text-sm mt-1">Estado actual de producción y stock</p>
                </div>
                <button onClick={loadDashboard} className="p-2 hover:bg-neutral-100 rounded-lg transition-colors text-neutral-600">
                    <RefreshCw size={20} />
                </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Productos Críticos" value={
                    (data?.productoTerminado?.geniality?.filter(p => p.daysOfStock < 15).length || 0) +
                    (data?.productoTerminado?.syrups?.filter(p => p.daysOfStock < 15).length || 0)
                } color="danger" />
                <StatCard title="Total Referencias" value={"52"} color="primary" />
                <StatCard title="Producción Activa" value="3" color="success" />
                <StatCard title="Despachos Pendientes" value="8" color="primary" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    <Card title="Tendencia de Consumo (Últimos 30 días)">
                        <TrendChart data={stats} />
                    </Card>

                    <Card title="Sugerencias de Producción">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-neutral-50 text-neutral-500 font-normal">
                                    <tr>
                                        <th className="px-4 py-2">Producto</th>
                                        <th className="px-4 py-2">Stock Actual</th>
                                        <th className="px-4 py-2">Sugerido</th>
                                        <th className="px-4 py-2">Prioridad</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {suggestions.map((s, i) => (
                                        <tr key={i} className="border-b last:border-0 hover:bg-neutral-50">
                                            <td className="px-4 py-3 font-medium">{s.productName}</td>
                                            <td className="px-4 py-3 text-neutral-500">{s.current}</td>
                                            <td className="px-4 py-3 font-bold text-primary-600">{s.suggestedQty}</td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs px-2 py-1 rounded font-medium ${s.priority === 'HIGH' ? 'bg-danger-100 text-danger-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                    {s.priority}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {suggestions.length === 0 && (
                                        <tr className="text-center text-neutral-400">
                                            <td colSpan="4" className="py-4">No hay sugerencias de producción. Nivel óptimo.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <Card title="Estado Geniality (Popping Boba)">
                        <p className="text-sm text-neutral-500 mb-4">Stock actual por sabor</p>
                        <div className="space-y-3">
                            {data?.productoTerminado?.geniality?.slice(0, 5).map((p, idx) => (
                                <div key={idx} className="flex justify-between items-center text-sm border-b border-neutral-50 pb-2 last:border-0">
                                    <span>{p.name}</span>
                                    <span className="font-medium">{p.currentStock} un</span>
                                </div>
                            ))}
                            {(!data?.productoTerminado?.geniality || data.productoTerminado.geniality.length === 0) && (
                                <p className="text-sm text-neutral-400 italic">No hay datos disponibles</p>
                            )}
                        </div>
                    </Card>
                </div>

                {/* Sidebar Alerts */}
                <div className="space-y-6">
                    <Card title="Alertas de Stock" subtitle="Menos de 15 días de inventario">
                        <div className="space-y-2 max-h-[400px] overflow-auto">
                            {data?.productoTerminado?.geniality?.filter(p => p.daysOfStock < 15).map((p, i) => (
                                <AlertItem key={i} product={p.name} stock={p.currentStock} days={p.daysOfStock} />
                            ))}
                            {data?.productoTerminado?.syrups?.filter(p => p.daysOfStock < 15).map((p, i) => (
                                <AlertItem key={'s' + i} product={p.name} stock={p.currentStock} days={p.daysOfStock} />
                            ))}
                            <AlertItem product="Ejemplo Crítico" stock={5} days={2} />
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
