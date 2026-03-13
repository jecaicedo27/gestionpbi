import { useState, useEffect } from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { ShoppingCart, Plus, Minus, Search } from 'lucide-react';
import api from '../../services/api';

const Shop = () => {
    const [products, setProducts] = useState([]);
    const [cart, setCart] = useState({}); // { productId: qty }
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadCatalog();
    }, []);

    const loadCatalog = async () => {
        try {
            const res = await api.get('/orders/catalog');
            setProducts(res.data.data);
        } catch (e) {
            console.error("Error loading catalog", e);
        } finally {
            setLoading(false);
        }
    };

    const addToCart = (product) => {
        setCart(prev => ({
            ...prev,
            [product.id]: (prev[product.id] || 0) + 1
        }));
        setIsCartOpen(true);
    };

    const updateQty = (id, delta) => {
        setCart(prev => {
            const newQty = (prev[id] || 0) + delta;
            if (newQty <= 0) {
                const { [id]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [id]: newQty };
        });
    };

    const submitOrder = async () => {
        const items = Object.entries(cart).map(([id, qty]) => ({
            productId: id,
            quantity: qty
        }));

        try {
            await api.post('/orders', { items });
            alert('Pedido creado exitosamente');
            setCart({});
            setIsCartOpen(false);
            loadCatalog(); // Refresh stock
        } catch (e) {
            alert('Error creando pedido: ' + (e.response?.data?.error || e.message));
        }
    };

    const cartTotalItems = Object.values(cart).reduce((a, b) => a + b, 0);

    return (
        <div className="flex h-[calc(100vh-8rem)]">
            {/* Catalog Grid */}
            <div className="flex-1 overflow-auto pr-6">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Catálogo de Productos</h1>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-neutral-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar producto..."
                            className="pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none w-64"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map(p => (
                        <Card key={p.id} className="flex flex-col h-full">
                            <div className="flex-1">
                                <h3 className="font-semibold text-lg">{p.name}</h3>
                                <p className="text-sm text-neutral-500">{p.sku}</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs bg-neutral-100 px-2 py-1 rounded">{p.group.name}</span>
                                    <span className={`text-xs px-2 py-1 rounded ${p.available > 0 ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
                                        {p.available > 0 ? `${p.available} Disponibles` : 'Agotado'}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                <Button
                                    size="sm"
                                    disabled={p.available <= 0}
                                    onClick={() => addToCart(p)}
                                    icon={Plus}
                                >Add</Button>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Cart Sidebar */}
            {isCartOpen && (
                <div className="w-96 bg-white border-l shadow-xl flex flex-col h-full animate-in slide-in-from-right">
                    <div className="p-4 border-b flex justify-between items-center bg-neutral-50">
                        <h2 className="font-bold flex items-center gap-2">
                            <ShoppingCart size={20} />
                            Carrito ({cartTotalItems})
                        </h2>
                        <button onClick={() => setIsCartOpen(false)} className="text-neutral-500">✕</button>
                    </div>

                    <div className="flex-1 overflow-auto p-4 space-y-4">
                        {Object.entries(cart).map(([id, qty]) => {
                            const product = products.find(p => p.id === id);
                            return (
                                <div key={id} className="flex justify-between items-center border-b pb-2">
                                    <div>
                                        <p className="font-medium text-sm line-clamp-1">{product?.name}</p>
                                        <p className="text-xs text-neutral-500">{product?.unit}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => updateQty(id, -1)} className="p-1 rounded bg-neutral-100"><Minus size={14} /></button>
                                        <span className="w-8 text-center text-sm font-medium">{qty}</span>
                                        <button onClick={() => updateQty(id, 1)} className="p-1 rounded bg-neutral-100"><Plus size={14} /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-4 border-t bg-neutral-50">
                        <Button className="w-full" onClick={submitOrder} disabled={cartTotalItems === 0}>
                            Confirmar Pedido
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Shop;
