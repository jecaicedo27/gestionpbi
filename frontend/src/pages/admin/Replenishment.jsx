import React, { useState, useEffect } from 'react';
import Card from '../../components/common/Card';
import ReplenishmentMatrix from '../../components/ReplenishmentMatrix';
import ReplenishmentModal from '../../components/ReplenishmentModal';
import { inventoryService } from '../../services/api';
import { RefreshCw, LayoutGrid, List } from 'lucide-react';

const Replenishment = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('ALL'); // ALL, MP, PT
    const [selectedProduct, setSelectedProduct] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await inventoryService.getReplenishment();
            console.log("Replenishment Result:", result);
            setData(result);
        } catch (error) {
            console.error('Error loading replenishment:', error);
            setError(error.message || 'Error cargando datos');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = (productId, updates) => {
        // Optimistic update locally
        setData(prevData => prevData.map(p => {
            if (p.id === productId) {
                return { ...p, ...updates };
            }
            return p;
        }));
    };

    const getFilteredData = () => {
        if (filter === 'ALL') return data;
        if (filter === 'MP') return data.filter(d => d.type === 'MATERIA_PRIMA' || d.type === 'BASE_CITRICA');
        if (filter === 'PT') return data.filter(d => d.type === 'PERLA_EXPLOSIVA' || d.type === 'SYRUP');
        return data;
    };

    const filteredData = getFilteredData();

    return (
        <div className="space-y-6 max-w-7xl mx-auto">

            {/* Header */}
            <div className="flex justify-between items-center w-full">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900">Plan de Reaprovisionamiento</h1>
                    <p className="text-neutral-500 text-sm mt-1">Vista Matricial Inteligente</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors shadow-sm"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Actualizar
                    </button>
                </div>
            </div>

            {/* Pill Filters */}
            <div className="flex gap-2 flex-wrap pb-2">
                {['ALL', 'MP', 'PT'].map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === f
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-neutral-600 hover:bg-neutral-50 border border-neutral-200'
                            }`}
                    >
                        {f === 'ALL' ? 'Todos' : f === 'MP' ? 'Materia Prima' : 'Producto Terminado'}
                    </button>
                ))}
            </div>

            {/* Main Content wrapped in Card */}
            <Card>
                {loading ? (
                    <div className="text-center py-20 text-neutral-500">Cargando análisis...</div>
                ) : error ? (
                    <div className="text-center py-20 text-red-500 font-bold bg-red-50 p-4 rounded-lg mx-auto max-w-lg border border-red-200">
                        <p>Ocurrió un error al cargar los datos:</p>
                        <p className="text-sm mt-2 font-mono text-red-700">{error}</p>
                    </div>
                ) : filteredData.length === 0 ? (
                    <div className="text-center py-20 text-neutral-500">
                        No hay datos para mostrar.<br />
                        <span className="text-xs">(Total recibidos: {data.length}, Filtro: {filter})</span>
                    </div>
                ) : (
                    <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
                        {/* Negative margin hacks to flush the matrix with card edges if desired, 
                            but InventoryMatrix doesn't do this. Let's keep it simple standard padding first.
                        */}
                        <ReplenishmentMatrix
                            products={filteredData}
                            onProductClick={setSelectedProduct}
                        />
                    </div>
                )}
            </Card>

            {/* Modal */}
            {selectedProduct && (
                <ReplenishmentModal
                    product={selectedProduct}
                    onClose={() => setSelectedProduct(null)}
                    onUpdate={handleUpdate}
                />
            )}
        </div>
    );
};

export default Replenishment;
