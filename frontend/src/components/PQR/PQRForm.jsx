import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Upload, FileText, CheckCircle, Package, AlertCircle, Trash2, Info, PlusCircle, Image, Plus, Save } from 'lucide-react';
import { AutoComplete, Select } from 'antd';
import { useAuth } from '../../context/AuthContext';

const PQRForm = ({ onClose, onSuccess }) => {
    const { token } = useAuth();

    // Form State for "Current Item"
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('UNIDADES');
    const [lotNumber, setLotNumber] = useState('');
    const [manualLotMode, setManualLotMode] = useState(false);
    const [description, setDescription] = useState('');
    const [pqrType, setPqrType] = useState('');

    // New: Refund Method (Global)
    const [refundMethod, setRefundMethod] = useState('WALLET_BALANCE');
    const [reportedByName, setReportedByName] = useState('');
    const [reportingPartyOptions, setReportingPartyOptions] = useState([]);
    const [reportingPartyLoading, setReportingPartyLoading] = useState(false);

    // Basket State
    const [basket, setBasket] = useState([]);

    // Shared State
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [validLots, setValidLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [error, setError] = useState('');

    const cleanReportingPartyName = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .trim();

    useEffect(() => {
        fetchProducts();
    }, []);

    useEffect(() => {
        let active = true;

        const timer = setTimeout(async () => {
            setReportingPartyLoading(true);
            try {
                const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/pqr/reporting-parties`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { q: reportedByName || undefined }
                });

                const options = Array.isArray(res.data)
                    ? res.data.map((name) => ({ value: name, label: name }))
                    : [];

                if (!active) return;
                setReportingPartyOptions(options);
            } catch (err) {
                if (!active) return;
                console.error('Error fetching reporting parties:', err);
                setReportingPartyOptions([]);
            } finally {
                if (!active) return;
                setReportingPartyLoading(false);
            }
        }, 220);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [token, reportedByName]);

    const fetchProducts = async () => {
        try {
            const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/inventory/products`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (Array.isArray(response.data)) {
                const allowedCategories = ['GENIALITY', 'LIQUIPOPS'];

                // Filter products to ONLY include those in allowed categories
                const relevantProducts = response.data.filter(p => {
                    const groupName = p.group?.name?.trim();
                    return groupName && allowedCategories.includes(groupName);
                });

                setProducts(relevantProducts);

                // Extract unique categories from the ALREADY FILTERED list
                const uniqueCategories = [...new Set(relevantProducts.map(p => p.group?.name?.trim()))];
                setCategories(uniqueCategories.sort());
            } else {
                console.error("Products API response is not an array:", response.data);
                setError("Error al cargar productos: Formato inválido");
            }
        } catch (err) {
            console.error('Error fetching products:', err);
            setError('Error al cargar la lista de productos');
        }
    };

    // Fetch valid lots when product changes
    useEffect(() => {
        setLotNumber('');
        setManualLotMode(false);
        if (!selectedProduct) {
            setValidLots([]);
            return;
        }
        const productDetails = products.find(p => p.id === selectedProduct);
        const flavor = productDetails?.flavor;
        if (!flavor) {
            setValidLots([]);
            return;
        }

        const fetchLots = async () => {
            setLotsLoading(true);
            try {
                const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/pqr/valid-lots`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { flavor, category: selectedCategory }
                });
                setValidLots(res.data || []);
            } catch (err) {
                console.error('Error fetching valid lots:', err);
                setValidLots([]);
            } finally {
                setLotsLoading(false);
            }
        };
        fetchLots();
    }, [selectedProduct]);

    const handleFileChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length + files.length > 5) {
            alert('Máximo 5 archivos permitidos');
            return;
        }
        setFiles([...files, ...selectedFiles]);
    };

    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pastedFiles = [];
        for (const item of items) {
            if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length === 0) return;
        e.preventDefault();
        if (pastedFiles.length + files.length > 5) {
            alert('Máximo 5 archivos permitidos');
            return;
        }
        setFiles(prev => [...prev, ...pastedFiles]);
    };

    // Global paste listener — Ctrl+V works from anywhere in the form
    useEffect(() => {
        const onPaste = (e) => handlePaste(e);
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, [files]);

    const removeFile = (index) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const addToBasket = () => {
        // Validation: Lot is now mandatory
        const missingFields = [];
        if (!selectedProduct) missingFields.push('Producto');
        if (!pqrType) missingFields.push('Tipo de Reporte');
        if (!quantity) missingFields.push('Cantidad');
        if (!lotNumber) missingFields.push('Lote');

        if (missingFields.length > 0) {
            alert(`Por favor complete los siguientes campos obligatorios: ${missingFields.join(', ')}`);
            return;
        }

        if (files.length === 0) missingFields.push('Evidencia (Foto/Video)');

        if (missingFields.length > 0) {
            alert(`Por favor complete los siguientes campos obligatorios: ${missingFields.join(', ')}`);
            return;
        }

        const productDetails = products.find(p => p.id === selectedProduct);

        const newItem = {
            id: Date.now(),
            productId: selectedProduct,
            productName: productDetails?.name,
            productSku: productDetails?.sku,
            type: pqrType,
            quantity: parseFloat(quantity),
            unit,
            lotNumber,
            description: String(description || '').trim(),
            files: [...files] // Attach current files to item
        };

        setBasket([...basket, newItem]);

        // Reset item fields
        setSelectedCategory('');
        setSelectedProduct(null);
        setQuantity('');
        setLotNumber('');
        setDescription('');
        setFiles([]); // Clear files for next item
        setPqrType(''); // Reset typ
    };

    const removeFromBasket = (index) => {
        setBasket(basket.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const cleanedReportedByName = cleanReportingPartyName(reportedByName);

        if (cleanedReportedByName && (cleanedReportedByName.length < 3 || cleanedReportedByName.length > 120)) {
            alert('El nombre del subdistribuidor/cliente final debe tener entre 3 y 120 caracteres.');
            return;
        }

        if (basket.length === 0) {
            alert('Debe agregar al menos un ítem al reporte');
            return;
        }

        setLoading(true);
        setError('');

        const formData = new FormData();

        // Add Refund Method
        formData.append('refundMethod', refundMethod);
        if (cleanedReportedByName) {
            formData.append('reportedByName', cleanedReportedByName);
        }

        // Prepare items with file counts
        const itemsPayload = basket.map(item => ({
            ...item,
            evidenceCount: item.files.length // Tell backend how many files belong to this item
        }));

        formData.append('items', JSON.stringify(itemsPayload));

        // Append ALL files in order
        basket.forEach(item => {
            item.files.forEach(file => {
                formData.append('evidence', file);
            });
        });

        try {
            await axios.post(`${import.meta.env.VITE_API_URL}/api/pqr`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data'
                }
            });
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Error creating PQR:', err);
            setError(err.response?.data?.error || 'Error al crear la solicitud');
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = selectedCategory
        ? products.filter(p => p.group?.name === selectedCategory)
        : products;

    // Prepare options for AntD Select
    const productOptions = filteredProducts.map(p => ({
        value: p.id,
        label: `${p.name} (${p.sku})`
    }));

    // PQR Types — fetched from config (configurable from admin)
    const [pqrTypes, setPqrTypes] = useState([
        { value: 'CALCIFICACION', label: 'Calcificación' },
        { value: 'INFLADO', label: 'Inflado' },
        { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
        { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
        { value: 'MAL_SELLADO', label: 'Mal Sellado' },
        { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
        { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
        { value: 'OTRO', label: 'Otro' }
    ]);

    useEffect(() => {
        axios.get(`${import.meta.env.VITE_API_URL}/api/config/pqr-types`, {
            headers: { Authorization: `Bearer ${token}` }
        }).then(res => {
            if (Array.isArray(res.data) && res.data.length > 0) setPqrTypes(res.data);
        }).catch(() => { });
    }, []);

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 transition-opacity flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-[95%] max-w-[1600px] max-h-[95vh] overflow-hidden flex flex-col">

                {/* HEADER */}
                <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-600 to-indigo-700">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                            <FileText size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold leading-tight">Nueva Solicitud de Garantía</h2>
                            <p className="text-blue-100 text-xs">Reporte de Novedades y Calidad (PQR)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-blue-100 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-50/50 p-4 space-y-4">
                    {/* Error Banner */}
                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 flex items-center gap-3 shadow-sm">
                            <AlertCircle size={20} className="shrink-0" />
                            <p className="font-medium">{error}</p>
                        </div>
                    )}

                    {/* MAIN FORM GRID */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* LEFT COLUMN: INPUTS */}
                        <div className="lg:col-span-7 space-y-6">

                            {/* ADD PRODUCT CARD */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Package size={80} />
                                </div>

                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3 text-base">
                                    <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs">1</span>
                                    Detalle del Producto
                                </h3>

                                <div className="space-y-3 relative z-10">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                                            Subdistribuidor / Cliente Final (Opcional)
                                        </label>
                                        <AutoComplete
                                            value={reportedByName}
                                            options={reportingPartyOptions}
                                            onChange={(value) => setReportedByName(value)}
                                            onSelect={(value) => setReportedByName(value)}
                                            onBlur={() => setReportedByName((prev) => cleanReportingPartyName(prev))}
                                            placeholder="Escriba para buscar o registrar el nombre..."
                                            className="w-full"
                                            size="large"
                                            style={{ width: '100%' }}
                                            filterOption={false}
                                            notFoundContent={reportingPartyLoading ? 'Buscando...' : 'Sin coincidencias. Puede registrar un nombre nuevo'}
                                        />
                                        <p className="text-xs text-gray-400 mt-1">
                                            Este nombre quedará guardado en su lista para próximas solicitudes.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                        <div className="md:col-span-3">
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Categoría</label>
                                            <select
                                                value={selectedCategory}
                                                onChange={(e) => {
                                                    setSelectedCategory(e.target.value);
                                                    setSelectedProduct(null);
                                                }}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-shadow outline-none"
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

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Reporte</label>
                                            <select
                                                value={pqrType}
                                                onChange={(e) => setPqrType(e.target.value)}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-shadow outline-none"
                                            >
                                                <option value="">-- Seleccionar --</option>
                                                {pqrTypes.map(t => (
                                                    <option key={t.value} value={t.value}>{t.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Lote de Producción (Obligatorio)</label>
                                            {!manualLotMode ? (
                                                <>
                                                    <Select
                                                        showSearch
                                                        value={lotNumber || undefined}
                                                        onChange={(value) => setLotNumber(value)}
                                                        placeholder={!selectedProduct ? 'Primero seleccione producto' : lotsLoading ? 'Cargando lotes...' : validLots.length === 0 ? 'Sin lotes para este sabor' : 'Buscar lote...'}
                                                        optionFilterProp="label"
                                                        disabled={!selectedProduct || lotsLoading}
                                                        loading={lotsLoading}
                                                        className="w-full"
                                                        size="large"
                                                        style={{ width: '100%' }}
                                                        notFoundContent={lotsLoading ? 'Cargando...' : 'No hay lotes registrados para este sabor'}
                                                        options={validLots.map(lot => ({
                                                            value: lot.displayLot || lot.premixLot || lot.lotCode,
                                                            label: `${lot.displayLot || lot.premixLot || lot.lotCode} — ${new Date(lot.productionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}`,
                                                        }))}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => { setManualLotMode(true); setLotNumber(''); }}
                                                        disabled={!selectedProduct}
                                                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1.5 transition-colors disabled:text-gray-400 disabled:no-underline"
                                                    >
                                                        ¿No encuentra el lote? Ingresar manualmente
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={lotNumber}
                                                        onChange={(e) => {
                                                            let raw = e.target.value.replace(/[^0-9]/g, '');
                                                            if (raw.length > 10) raw = raw.slice(0, 10);
                                                            if (raw.length > 6) raw = raw.slice(0, 6) + '-' + raw.slice(6);
                                                            setLotNumber(raw);
                                                        }}
                                                        maxLength={11}
                                                        placeholder="AAMMDD-HHMM"
                                                        className={`w-full rounded-xl px-4 py-3 text-gray-800 text-lg font-mono tracking-widest text-center transition-all outline-none ${lotNumber && /^\d{6}-\d{4}$/.test(lotNumber)
                                                            ? 'bg-green-50 border-2 border-green-400 focus:ring-4 focus:ring-green-500/20'
                                                            : lotNumber
                                                                ? 'bg-red-50 border-2 border-red-300 focus:ring-4 focus:ring-red-500/20'
                                                                : 'bg-amber-50/50 border-2 border-amber-300 focus:ring-4 focus:ring-amber-500/20'
                                                            }`}
                                                    />
                                                    <div className="mt-1.5 flex items-center justify-between text-xs">
                                                        <span className="text-amber-600">Formato: <span className="font-mono font-bold">AAMMDD-HHMM</span></span>
                                                        <button
                                                            type="button"
                                                            onClick={() => { setManualLotMode(false); setLotNumber(''); }}
                                                            className="text-blue-600 hover:text-blue-800 font-medium hover:underline transition-colors"
                                                        >
                                                            ← Volver a la lista
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cantidad</label>
                                            <input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={quantity}
                                                onChange={(e) => setQuantity(e.target.value)}
                                                className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-shadow outline-none"
                                                placeholder="0"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Descripción del Daño (Opcional)</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows="2"
                                            className="w-full rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-shadow outline-none resize-none"
                                            placeholder="Describa el problema detalladamente..."
                                        />
                                    </div>

                                    <div className="mt-3 mb-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm uppercase tracking-wider">
                                                Evidencia (Obligatorio)
                                            </h3>
                                            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Lote debe ser visible · Ctrl+V para pegar</span>
                                        </div>

                                        <div
                                            className="border-2 border-dashed border-blue-200 hover:border-blue-400 bg-blue-50/30 hover:bg-blue-50/50 transition-colors rounded-xl p-3 text-center group cursor-pointer relative"
                                        >
                                            <input
                                                type="file"
                                                id="evidence"
                                                multiple
                                                accept="image/*,video/*"
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                onChange={handleFileChange}
                                            />
                                            <div className="pointer-events-none flex items-center justify-center gap-3">
                                                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <Upload size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="text-sm font-semibold text-blue-900">Click para subir evidencia</p>
                                                    <p className="text-xs text-blue-600/70">Fotos o Videos del daño (Max 5)</p>
                                                </div>
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
                                                        <button
                                                            type="button"
                                                            onClick={() => removeFile(index)}
                                                            className="text-gray-300 hover:text-red-500 transition-colors p-1"
                                                        >
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

                        {/* RIGHT COLUMN: BASKET & EVIDENCE */}
                        <div className="lg:col-span-5 space-y-6">

                            {/* BASKET SUMMARY */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 h-fit">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3 text-base">
                                    <span className="w-6 h-6 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-xs">2</span>
                                    Productos Agregados
                                </h3>

                                {basket.length === 0 ? (
                                    <div className="text-center py-6 px-4 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/30">
                                        <Package size={36} className="mx-auto text-gray-300 mb-2" />
                                        <p className="text-gray-500 font-medium text-sm">Su lista está vacía</p>
                                        <p className="text-xs text-gray-400 mt-0.5">Complete el formulario y haga click en "Agregar"</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                                        {basket.map((item, index) => (
                                            <div key={index} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative group">
                                                <button
                                                    onClick={() => removeFromBasket(index)}
                                                    className="absolute top-3 right-3 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 size={16} />
                                                </button>

                                                <div className="pr-6">
                                                    <h4 className="font-semibold text-gray-800 text-sm line-clamp-1">{item.productName}</h4>
                                                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                                            {item.quantity} {item.unit.toLowerCase()}
                                                        </span>
                                                        <span>• Lote: {item.lotNumber}</span>
                                                    </div>
                                                    <p className="text-xs text-mt-1 font-medium text-gray-600">
                                                        {pqrTypes.find(t => t.value === item.type)?.label || item.type}
                                                    </p>
                                                    <p className="text-xs text-gray-400 mt-2 line-clamp-2 italic border-l-2 border-gray-100 pl-2">
                                                        "{item.description}"
                                                    </p>
                                                    {/* Evidence Count Badge */}
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

                            {/* REFUND METHOD SETTINGS */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 h-fit">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3 text-base">
                                    <span className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center text-xs">3</span>
                                    Preferencia de Garantía
                                </h3>
                                <p className="text-xs text-gray-500 mb-3">
                                    En caso de aprobación, ¿cómo prefiere recibir la compensación?
                                </p>

                                <div className="space-y-2">
                                    <label className={`flex items-start gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${refundMethod === 'WALLET_BALANCE' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}>
                                        <div className="pt-0.5">
                                            <input
                                                type="radio"
                                                name="refundMethod"
                                                value="WALLET_BALANCE"
                                                checked={refundMethod === 'WALLET_BALANCE'}
                                                onChange={(e) => setRefundMethod(e.target.value)}
                                                className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <span className="block font-semibold text-gray-800 text-sm">Saldo a Favor (Nota Crédito)</span>
                                            <p className="text-xs text-gray-500 mt-1">El valor se abonará a su cuenta para futuras compras. Es el método más rápido.</p>
                                        </div>
                                    </label>

                                    <div className="relative p-3 rounded-xl border-2 border-gray-100 bg-gray-50/50 opacity-60 cursor-not-allowed">
                                        <div className="flex items-start gap-3">
                                            <div className="pt-0.5">
                                                <input
                                                    type="radio"
                                                    name="refundMethod"
                                                    value="PHYSICAL_REPLACEMENT"
                                                    disabled
                                                    className="w-4 h-4 text-gray-300"
                                                />
                                            </div>
                                            <div>
                                                <span className="block font-semibold text-gray-400 text-sm line-through">Reposición Física</span>
                                                <p className="text-xs text-gray-400 mt-1">Se enviará el producto nuevamente. Sujeto a disponibilidad y tiempos de logística.</p>
                                            </div>
                                        </div>
                                        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                                            <AlertCircle size={14} className="text-amber-500 shrink-0" />
                                            <p className="text-xs text-amber-700 font-medium">Por disponibilidad de inventario esta opción no está habilitada. La nota crédito es el método más ágil.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="px-5 py-3 border-t border-gray-100 bg-white flex justify-between items-center sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <p className="text-xs text-gray-400 hidden sm:block">
                        <Info size={14} className="inline mr-1 align-sub" />
                        Asegúrese de subir evidencia clara para agilizar el proceso.
                    </p>
                    <div className="flex gap-3 ml-auto">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2.5 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-800 transition-colors"
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || basket.length === 0}
                            className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-medium shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    Enviando...
                                </span>
                            ) : (
                                <>
                                    <Save size={18} />
                                    Crear Reporte
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PQRForm;
