import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Upload, FileText, Package, AlertCircle, Trash2, Info, Plus, Save, AlertTriangle, Image } from 'lucide-react';
import { Select } from 'antd';
import { useAuth } from '../../context/AuthContext';

const ORIGIN_OPTIONS = [
    { value: 'DETERIORO_PLANTA', label: '🏭 Deterioro en Planta / Bodega' },
    { value: 'DEFECTO_FABRICACION', label: '⚠️ Defecto de Fabricación' }
];

const DEFAULT_PQR_TYPES = [
    { value: 'CALCIFICACION', label: 'Calcificación' },
    { value: 'INFLADO', label: 'Inflado' },
    { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
    { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
    { value: 'MAL_SELLADO', label: 'Mal Sellado' },
    { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
    { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
    { value: 'VENCIDO', label: 'Vencido' },
    { value: 'CONTAMINADO', label: 'Contaminado' },
    { value: 'OTRO', label: 'Otro' }
];

const InternalPQRForm = ({ onClose, onSuccess }) => {
    const { token } = useAuth();

    // Global fields
    const [origin, setOrigin] = useState('');
    const [daysAfterProduction, setDaysAfterProduction] = useState('');

    // Item fields (for current item being built)
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('UNIDADES');
    const [lotNumber, setLotNumber] = useState('');
    const [description, setDescription] = useState('');
    const [pqrType, setPqrType] = useState('');
    const [files, setFiles] = useState([]);

    // Basket
    const [basket, setBasket] = useState([]);

    // Shared
    const [loading, setLoading] = useState(false);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [error, setError] = useState('');

    // PQR Types — fetched from config (configurable from admin)
    const [pqrTypes, setPqrTypes] = useState(DEFAULT_PQR_TYPES);

    useEffect(() => {
        fetchProducts();
        // Fetch configurable PQR types
        axios.get(`${import.meta.env.VITE_API_URL}/api/config/pqr-types`, {
            headers: { Authorization: `Bearer ${token}` }
        }).then(res => {
            if (Array.isArray(res.data) && res.data.length > 0) setPqrTypes(res.data);
        }).catch(() => { });
    }, []);

    const fetchProducts = async () => {
        try {
            const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/inventory/products`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (Array.isArray(response.data)) {
                const allowedCategories = ['GENIALITY', 'LIQUIPOPS'];
                const relevantProducts = response.data.filter(p => {
                    const groupName = p.group?.name?.trim();
                    return groupName && allowedCategories.includes(groupName);
                });
                setProducts(relevantProducts);
                const uniqueCategories = [...new Set(relevantProducts.map(p => p.group?.name?.trim()))];
                setCategories(uniqueCategories.sort());
            }
        } catch (err) {
            setError('Error al cargar la lista de productos');
        }
    };

    const handleFileChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length + files.length > 5) {
            alert('Máximo 5 archivos permitidos por producto');
            return;
        }
        setFiles([...files, ...selectedFiles]);
    };

    const removeFile = (index) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const addToBasket = () => {
        const missingFields = [];
        if (!selectedProduct) missingFields.push('Producto');
        if (!pqrType) missingFields.push('Tipo de Reporte');
        if (!quantity) missingFields.push('Cantidad');
        if (!lotNumber) missingFields.push('Lote');
        if (lotNumber && !/^\d{6}-\d{4}$/.test(lotNumber)) {
            alert('El lote debe tener el formato aammdd-hhmm (ej: 260303-0800)');
            return;
        }
        if (!description) missingFields.push('Descripción');
        if (files.length === 0) missingFields.push('Evidencia (Foto/Video)');

        if (missingFields.length > 0) {
            alert(`Por favor complete: ${missingFields.join(', ')}`);
            return;
        }

        const productDetails = products.find(p => p.id === selectedProduct);

        setBasket([...basket, {
            id: Date.now(),
            productId: selectedProduct,
            productName: productDetails?.name,
            productSku: productDetails?.sku,
            type: pqrType,
            quantity: parseFloat(quantity),
            unit,
            lotNumber,
            description,
            files: [...files]
        }]);

        // Reset item fields
        setSelectedCategory('');
        setSelectedProduct(null);
        setQuantity('');
        setLotNumber('');
        setDescription('');
        setFiles([]);
        setPqrType('');
    };

    const removeFromBasket = (index) => {
        setBasket(basket.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (basket.length === 0) { alert('Debe agregar al menos un producto al reporte.'); return; }
        if (!origin) { alert('Seleccione el origen del problema.'); return; }

        setLoading(true);
        setError('');

        const formData = new FormData();
        formData.append('origin', origin);
        if (daysAfterProduction) formData.append('daysAfterProduction', daysAfterProduction);

        const itemsPayload = basket.map(item => ({
            ...item,
            evidenceCount: item.files.length
        }));
        formData.append('items', JSON.stringify(itemsPayload));

        // Append ALL files in order
        basket.forEach(item => {
            item.files.forEach(file => {
                formData.append('evidence', file);
            });
        });

        try {
            const res = await axios.post(`${import.meta.env.VITE_API_URL}/api/internal-pqr`, formData, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            if (onSuccess) onSuccess(res.data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Error al crear la solicitud');
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = selectedCategory
        ? products.filter(p => p.group?.name === selectedCategory)
        : products;

    const productOptions = filteredProducts.map(p => ({
        value: p.id,
        label: `${p.name} (${p.sku})`
    }));

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 transition-opacity flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-[95%] max-w-[1600px] max-h-[95vh] overflow-hidden flex flex-col">

                {/* HEADER */}
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-orange-600 to-red-700">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                            <AlertTriangle size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Nuevo PQR Interno</h2>
                            <p className="text-orange-100 text-sm">Reporte de producto dañado o mal fabricado en planta</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-orange-100 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-50/50 p-6 space-y-8">
                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 flex items-center gap-3 shadow-sm">
                            <AlertCircle size={20} className="shrink-0" />
                            <p className="font-medium">{error}</p>
                        </div>
                    )}

                    {/* ORIGIN & DAYS */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 text-lg">
                            <span className="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center text-sm">0</span>
                            Origen del Problema
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                            <div className="md:col-span-8">
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Origen *</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {ORIGIN_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setOrigin(opt.value)}
                                            className={`p-4 rounded-xl border-2 text-left transition-all ${origin === opt.value
                                                ? 'border-orange-500 bg-orange-50 text-orange-800'
                                                : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300'
                                                }`}
                                        >
                                            <span className="text-sm font-medium">{opt.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="md:col-span-4">
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Días desde Fabricación</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={daysAfterProduction}
                                    onChange={e => setDaysAfterProduction(e.target.value)}
                                    placeholder="Ej: 15"
                                    className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-shadow outline-none"
                                />
                                <p className="text-xs text-gray-400 mt-1">Opcional</p>
                            </div>
                        </div>
                    </div>

                    {/* MAIN FORM GRID */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* LEFT COLUMN: PRODUCT INPUT */}
                        <div className="lg:col-span-7 space-y-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Package size={120} />
                                </div>

                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-6 text-lg">
                                    <span className="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center text-sm">1</span>
                                    Detalle del Producto
                                </h3>

                                <div className="space-y-5 relative z-10">
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                                        <div className="md:col-span-3">
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Categoría</label>
                                            <select
                                                value={selectedCategory}
                                                onChange={(e) => { setSelectedCategory(e.target.value); setSelectedProduct(null); }}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-shadow outline-none"
                                            >
                                                <option value="">-- Seleccionar --</option>
                                                {categories.map(cat => (
                                                    <option key={cat} value={cat}>{cat}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="md:col-span-9">
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Producto Afectado</label>
                                            <Select
                                                showSearch
                                                value={selectedProduct}
                                                onChange={(value) => setSelectedProduct(value)}
                                                placeholder={selectedCategory ? 'Buscar producto...' : 'Primero seleccione categoría'}
                                                optionFilterProp="label"
                                                options={productOptions}
                                                disabled={!selectedCategory}
                                                className="w-full"
                                                size="large"
                                                style={{ width: '100%', borderRadius: '0.75rem' }}
                                                filterSort={(optionA, optionB) =>
                                                    (optionA?.label ?? '').toLowerCase().localeCompare((optionB?.label ?? '').toLowerCase())
                                                }
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Reporte</label>
                                            <select
                                                value={pqrType}
                                                onChange={(e) => setPqrType(e.target.value)}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-shadow outline-none"
                                            >
                                                <option value="">-- Seleccionar --</option>
                                                {pqrTypes.map(t => (
                                                    <option key={t.value} value={t.value}>{t.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Lote (Obligatorio)</label>
                                            <input
                                                type="text"
                                                value={lotNumber}
                                                onChange={(e) => {
                                                    let v = e.target.value.replace(/[^0-9]/g, '');
                                                    if (v.length > 10) v = v.slice(0, 10);
                                                    if (v.length > 6) v = v.slice(0, 6) + '-' + v.slice(6);
                                                    setLotNumber(v);
                                                }}
                                                maxLength={11}
                                                placeholder="aammdd-hhmm"
                                                className={`w-full rounded-xl bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:ring-4 transition-shadow outline-none font-mono tracking-wider text-center ${lotNumber && !/^\d{6}-\d{4}$/.test(lotNumber)
                                                    ? 'border-2 border-red-300 focus:border-red-500 focus:ring-red-500/10'
                                                    : lotNumber && /^\d{6}-\d{4}$/.test(lotNumber)
                                                        ? 'border-2 border-green-300 focus:border-green-500 focus:ring-green-500/10'
                                                        : 'border border-gray-200 focus:border-orange-500 focus:ring-orange-500/10'
                                                    }`}
                                            />
                                            <p className="text-xs text-gray-500 mt-1.5">Formato: <span className="font-mono font-bold text-orange-600">aammdd-hhmm</span> — fecha y hora de inicio del bache</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cantidad</label>
                                            <input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={quantity}
                                                onChange={(e) => setQuantity(e.target.value)}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-shadow outline-none"
                                                placeholder="0"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Descripción del Daño</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows="3"
                                            className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-shadow outline-none resize-none"
                                            placeholder="Describa el problema detalladamente..."
                                        />
                                    </div>

                                    {/* Evidence Upload */}
                                    <div className="mt-6 mb-6">
                                        <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 text-sm uppercase tracking-wider">
                                            Evidencia (Obligatorio)
                                        </h3>
                                        <div className="bg-orange-50 text-orange-800 text-xs p-3 rounded-lg mb-4 flex gap-2">
                                            <Info size={16} className="shrink-0 mt-0.5" />
                                            <p>Suba al menos una foto o video del producto afectado. <span className="font-bold">El número de Lote debe ser visible.</span></p>
                                        </div>

                                        <div className="border-2 border-dashed border-orange-200 hover:border-orange-400 bg-orange-50/30 hover:bg-orange-50/50 transition-colors rounded-xl p-6 text-center group cursor-pointer relative">
                                            <input
                                                type="file"
                                                multiple
                                                accept="image/*,video/*"
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                onChange={handleFileChange}
                                            />
                                            <div className="pointer-events-none">
                                                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                                    <Upload size={24} />
                                                </div>
                                                <p className="text-sm font-semibold text-orange-900">Click para subir evidencia</p>
                                                <p className="text-xs text-orange-600/70 mt-1">Fotos o Videos del daño (Max 5)</p>
                                            </div>
                                        </div>

                                        {files.length > 0 ? (
                                            <div className="mt-4 space-y-2">
                                                {files.map((file, index) => (
                                                    <div key={index} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded-lg text-sm border border-gray-100">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <FileText size={14} className="text-gray-400 shrink-0" />
                                                            <span className="truncate text-gray-600">{file.name}</span>
                                                        </div>
                                                        <button type="button" onClick={() => removeFile(index)}
                                                            className="text-gray-300 hover:text-red-500 transition-colors p-1">
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="mt-2 text-xs text-red-500 flex items-center gap-1 justify-center">
                                                <Info size={12} />
                                                <span>Requerido para agregar producto</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={addToBasket}
                                            disabled={!selectedCategory || !selectedProduct || !files.length}
                                            className="w-full bg-gray-900 hover:bg-black text-white px-6 py-3 rounded-xl shadow-lg shadow-gray-200 hover:shadow-xl transition-all flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Plus size={20} />
                                            Agregar Producto al Reporte
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: BASKET */}
                        <div className="lg:col-span-5 space-y-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 text-lg">
                                    <span className="w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-sm">2</span>
                                    Productos Agregados
                                </h3>

                                {basket.length === 0 ? (
                                    <div className="text-center py-10 px-4 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/30">
                                        <Package size={48} className="mx-auto text-gray-300 mb-3" />
                                        <p className="text-gray-500 font-medium">Su lista está vacía</p>
                                        <p className="text-xs text-gray-400 mt-1">Complete el formulario y haga click en "Agregar"</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                                        {basket.map((item, index) => (
                                            <div key={index} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative group">
                                                <button onClick={() => removeFromBasket(index)}
                                                    className="absolute top-3 right-3 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                                    <Trash2 size={16} />
                                                </button>
                                                <div className="pr-6">
                                                    <h4 className="font-semibold text-gray-800 text-sm line-clamp-1">{item.productName}</h4>
                                                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                                        <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                                                            {item.quantity} {item.unit.toLowerCase()}
                                                        </span>
                                                        <span>• Lote: {item.lotNumber}</span>
                                                    </div>
                                                    <p className="text-xs mt-1 font-medium text-gray-600">
                                                        {pqrTypes.find(t => t.value === item.type)?.label || item.type}
                                                    </p>
                                                    <p className="text-xs text-gray-400 mt-2 line-clamp-2 italic border-l-2 border-gray-100 pl-2">
                                                        "{item.description}"
                                                    </p>
                                                    <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 w-fit px-2 py-1 rounded-md">
                                                        <Image size={12} />
                                                        <span className="font-medium">{item.files.length} evidencia(s) adjunta(s)</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Info card — No refund for internal */}
                            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                                <div className="flex gap-3">
                                    <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-bold text-orange-900">PQR Interno — Sin Devolución</p>
                                        <p className="text-xs text-orange-700 mt-1">
                                            Este reporte no genera nota crédito ni reposición. Una vez aprobado por Calidad,
                                            pasará a Contabilidad para el ajuste de inventario correspondiente.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="p-6 border-t border-gray-100 bg-white flex justify-between items-center sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <p className="text-xs text-gray-400 hidden sm:block">
                        <Info size={14} className="inline mr-1 align-sub" />
                        Asegúrese de subir evidencia clara para agilizar el proceso.
                    </p>
                    <div className="flex gap-3 ml-auto">
                        <button type="button" onClick={onClose} disabled={loading}
                            className="px-6 py-2.5 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-800 transition-colors">
                            Cancelar
                        </button>
                        <button onClick={handleSubmit} disabled={loading || basket.length === 0}
                            className="px-8 py-2.5 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white rounded-xl font-medium shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2">
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    Enviando...
                                </span>
                            ) : (
                                <>
                                    <Save size={18} />
                                    Crear PQR Interno
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InternalPQRForm;
