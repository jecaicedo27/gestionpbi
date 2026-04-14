import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { message, Modal, Empty, Spin, Tag } from 'antd';
import { 
    Package, ArrowRightLeft, RefreshCw, Clock, ChevronDown, ChevronUp, ChevronRight, 
    Search, Warehouse, Printer, QrCode, Calendar, AlertTriangle, X 
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useZebra } from '../context/ZebraContext';
import { buildLotLabelZPL } from '../services/zplLabelBuilder';

// Define the exact group names retrieved from the backend
const C_GROUP_NAMES = {
    1400: '🧪 MATERIA PRIMA FABRICACION 19%',
    1403: '🧪 MATERIA PRIMA FABRICACION 5%',
    1406: '🍬 MATERIA PRIMA SABORES',
    1407: '🎨 MATERIA PRIMA COLORES',
    1408: '📦 MATERIAL DE EMPAQUE',
    1409: '🏷️ MATERIA PRIMA ETIQUETAS Y SELLOS',
    11615: '⚙️ MATERIA PRIMA TRANSITORIA',
    1404: '🔄 PRODUCTOS EN PROCESO LIQUIPOPS',
    1405: '🔄 PRODUCTOS EN PROCESO GENIALITY'
};

const ZONES = [
    { id: 'WAREHOUSE', name: 'Bodega Ppal.', color: 'blue', icon: Warehouse },
    { id: 'PRODUCCION', name: 'Producción', color: 'yellow', icon: RefreshCw }
];

export default function MaterialZonePage() {
    const { user } = useAuth();
    const { zebraStatus, printZPL, recheckNow } = useZebra();
    const [loading, setLoading] = useState(false);
    const [zonesData, setZonesData] = useState({});
    const [activeZone, setActiveZone] = useState('WAREHOUSE');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedProducts, setExpandedProducts] = useState({});

    // Transfer Modal
    const [transferModalOpen, setTransferModalOpen] = useState(false);
    const [selectedLot, setSelectedLot] = useState(null);
    const [transferForm, setTransferForm] = useState({
        toZone: '',
        quantity: '',
        observations: ''
    });
    const [transferLoading, setTransferLoading] = useState(false);

    // Print Modal
    const [printModalOpen, setPrintModalOpen] = useState(false);
    const [printForm, setPrintForm] = useState({ copies: 1, customQtyText: '' });
    const [printLoading, setPrintLoading] = useState(false);

    // Adjust/Merma Modal
    const [adjustModalOpen, setAdjustModalOpen] = useState(false);
    const [adjustForm, setAdjustForm] = useState({ quantity: '', reason: '', adjustType: 'SUBTRACT' });
    const [adjustLoading, setAdjustLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/material-lots/zones');
            setZonesData(data);
        } catch (error) {
            console.error(error);
            message.error('Error al cargar zonas de materias primas');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Derived view data
    const activeLots = zonesData[activeZone] || [];

    // Grouping by product based on active lots
    const productGroups = useMemo(() => {
        let filtered = activeLots;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = activeLots.filter(l => 
                (l.productName || '').toLowerCase().includes(q) ||
                (l.sku || '').toLowerCase().includes(q) ||
                (l.lotNumber || '').toLowerCase().includes(q)
            );
        }

        const map = {};
        for (const lot of filtered) {
             const key = lot.productId || lot.sku;
             if (!map[key]) {
                 let otherZoneQty = 0;
                 const otherZoneId = activeZone === 'WAREHOUSE' ? 'PRODUCCION' : 'WAREHOUSE';
                 const otherLots = zonesData[otherZoneId] || [];
                 otherZoneQty = otherLots.filter(l => (l.productId || l.sku) === key).reduce((sum, l) => sum + l.currentQuantity, 0);

                 map[key] = {
                     id: key,
                     name: lot.productName || 'Desconocido',
                     sku: lot.sku,
                     totalQty: 0,
                     siigoStock: lot.siigoStock || 0,
                     otherZoneQty,
                     otherZoneName: otherZoneId === 'PRODUCCION' ? 'Producción' : 'Bodega Ppal.',
                     unit: lot.unit || 'g',
                     lots: []
                 };
             }
             map[key].lots.push(lot);
             map[key].totalQty += lot.currentQuantity;
        }

        return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    }, [activeLots, searchQuery, activeZone, zonesData]);

    const toggleProduct = (pid) => {
        setExpandedProducts(prev => ({ ...prev, [pid]: !prev[pid] }));
    };

    const handlePrintQR = (lot) => {
        setSelectedLot(lot);
        
        let initialQtyText = lot.currentQuantity.toString();
        let initialCopies = 1;

        if (lot.packSize && lot.packSize > 0) {
            initialQtyText = lot.packSize.toString();
            if (lot.currentQuantity > 0) {
                // 1 Par (2 físicas) por cada empaque de materia prima
                initialCopies = Math.ceil(lot.currentQuantity / lot.packSize);
            }
        }

        setPrintForm({ copies: initialCopies, customQtyText: initialQtyText });
        setPrintModalOpen(true);
    };

    const submitPrint = async () => {
        if (zebraStatus !== 'connected') {
            message.warning('Impresora Zebra no detectada. Verificando conexión...', 2);
            await recheckNow();
        }

        try {
            setPrintLoading(true);
            const qtyNum = parseFloat(printForm.customQtyText);
            const lotData = {
                productName: selectedLot.productName,
                sku: selectedLot.sku,
                lotNumber: selectedLot.lotNumber,
                quantity: isNaN(qtyNum) ? selectedLot.currentQuantity : qtyNum,
                unit: selectedLot.unit,
                receivedAt: selectedLot.receivedAt,
                statusText: 'MATERIA PRIMA'
            };

            let finalZpl = '';
            const isAutoMath = !isNaN(qtyNum) && qtyNum > 0 && printForm.copies === Math.ceil(selectedLot.currentQuantity / qtyNum);
            const remainder = !isNaN(qtyNum) && qtyNum > 0 ? selectedLot.currentQuantity % qtyNum : 0;

            if (isAutoMath && remainder !== 0) {
                const fullPacks = Math.floor(selectedLot.currentQuantity / qtyNum);
                
                if (fullPacks > 0) {
                    const dataFull = { ...lotData, quantity: qtyNum };
                    finalZpl += buildLotLabelZPL(dataFull, fullPacks);
                }
                if (remainder > 0) {
                    const dataRem = { ...lotData, quantity: remainder };
                    finalZpl += buildLotLabelZPL(dataRem, 1);
                }
            } else {
                finalZpl = buildLotLabelZPL(lotData, printForm.copies);
            }
            
            const res = await printZPL(finalZpl);
            if (res.ok) {
                // Mark as printed in the DB
                await api.post('/material-lots/print-label', { lotId: selectedLot.id });
                message.success(`Se enviaron ${printForm.copies} pares del lote ${selectedLot.lotNumber}`);
                setPrintModalOpen(false);
                fetchData(); // Refrescar flag `labelPrinted`
            } else {
                message.error(res.error || 'Error enviando zpl a la impresora');
            }
        } catch (err) {
            console.error(err);
            message.error('Error procesando rótulo ZPL');
        } finally {
            setPrintLoading(false);
        }
    };

    const openTransferModal = (lot) => {
        setSelectedLot(lot);
        setTransferForm({
            toZone: '',
            quantity: lot.currentQuantity.toString(),
            observations: ''
        });
        setTransferModalOpen(true);
    };

    const submitTransfer = async () => {
        if (!transferForm.toZone) return message.warning('Seleccione zona de destino');
        const qty = parseFloat(transferForm.quantity);
        if (isNaN(qty) || qty <= 0 || qty > selectedLot.currentQuantity) {
            return message.warning('Cantidad inválida');
        }

        setTransferLoading(true);
        try {
            await api.post('/material-lots/transfer', {
                sourceLotId: selectedLot.id,
                fromZone: activeZone,
                toZone: transferForm.toZone,
                quantity: qty,
                observations: transferForm.observations
            });
            message.success('Stock transferido correctamente');
            setTransferModalOpen(false);
            fetchData();
        } catch (error) {
            console.error(error);
            message.error(error.response?.data?.error || 'Error al transferir lote');
        }
        setTransferLoading(false);
    };

    const openAdjustModal = (lot) => {
        setSelectedLot(lot);
        setAdjustForm({ quantity: lot.currentQuantity.toString(), reason: '', adjustType: 'SUBTRACT' });
        setAdjustModalOpen(true);
    };

    const submitAdjust = async () => {
        const qty = parseFloat(adjustForm.quantity);
        if (isNaN(qty) || qty <= 0 || (adjustForm.adjustType === 'SUBTRACT' && qty > selectedLot.currentQuantity)) {
            return message.warning('Cantidad a ajustar inválida o supera el stock (si es faltante)');
        }
        if (!adjustForm.reason.trim()) {
            return message.warning('El motivo del ajuste es obligatorio');
        }

        setAdjustLoading(true);
        try {
            await api.post('/material-lots/adjust', {
                lotId: selectedLot.id,
                quantityToAdjust: qty,
                adjustType: adjustForm.adjustType,
                reason: adjustForm.reason
            });
            message.success('Stock ajustado correctamente');
            setAdjustModalOpen(false);
            fetchData();
        } catch (error) {
            console.error(error);
            message.error(error.response?.data?.error || 'Error al ajustar lote');
        }
        setAdjustLoading(false);
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8bg-white min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Warehouse className="text-blue-600" /> Control de Materia Prima
                    </h1>
                    <p className="text-gray-500">Gestión física, rotulación y exclusión de lotes de insumos</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${zebraStatus === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        <Printer size={14} />
                        {zebraStatus === 'connected' ? 'Zebra En Línea' : 'Zebra Desconectada'}
                    </div>
                </div>
            </div>

            {/* ZONES TABS */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-6">
                {ZONES.map(z => {
                    const isActive = activeZone === z.id;
                    const countLots = (zonesData[z.id] || []).length;
                    return (
                        <div 
                            key={z.id}
                            onClick={() => setActiveZone(z.id)}
                            className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center justify-center transition-all ${isActive ? `border-${z.color}-500 bg-${z.color}-50` : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                        >
                            <z.icon size={28} className={`mb-2 ${isActive ? `text-${z.color}-500` : 'text-gray-400'}`} />
                            <span className={`font-bold text-center ${isActive ? 'text-gray-900' : 'text-gray-500'}`}>{z.name}</span>
                            <span className="text-sm text-gray-500">{countLots} lotes activos</span>
                        </div>
                    );
                })}
            </div>

            {/* SEARCH */}
            <div className="relative mb-6">
                <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                <input 
                    type="text"
                    placeholder="Filtrar por insumo, SKU o número de lote..."
                    className="w-full pl-10 pr-4 py-2 border rounded-full bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-200 transition-all"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
            </div>

            {/* PRODUCTS LIST */}
            {loading ? (
                <div className="flex justify-center p-12"><Spin size="large" /></div>
            ) : productGroups.length === 0 ? (
                <Empty description="No hay insumos activos en esta zona" className="my-12" />
            ) : (
                <div className="space-y-4">
                    {productGroups.map(pg => {
                        const isExpanded = expandedProducts[pg.id];
                        return (
                            <div key={pg.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                {/* Header */}
                                <div 
                                    className="px-5 py-4 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100"
                                    onClick={() => toggleProduct(pg.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                            <Package size={20} />
                                        </div>
                                        <div>
                                            <h2 className="font-bold text-base md:text-lg">{pg.name}</h2>
                                            <div className="text-xs text-gray-500 font-mono uppercase tracking-widest">{pg.sku} · {pg.lots.length} lotes detectados</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center">
                                        <div className="text-right mr-4 border-r pr-4 border-gray-200 hidden sm:block">
                                            <div className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Stock en {pg.otherZoneName}</div>
                                            <div className="font-bold text-gray-600">{pg.otherZoneQty.toLocaleString()} <span className="text-[9px]">{pg.unit}</span></div>
                                        </div>
                                        <div className="text-right mr-4 border-r pr-4 border-gray-200 hidden sm:block">
                                            <div className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Total Siigo</div>
                                            <div className="font-bold text-indigo-500">{pg.siigoStock.toLocaleString()} <span className="text-[9px]">{pg.unit}</span></div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-lg leading-tight">{pg.totalQty.toLocaleString()}</div>
                                            <div className="text-[10px] text-gray-500 font-bold uppercase">{pg.unit}</div>
                                        </div>
                                        <div className="ml-4 text-gray-400">
                                            {isExpanded ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                                        </div>
                                    </div>
                                </div>

                                {/* Lots Body */}
                                {isExpanded && (
                                    <div className="px-5 py-4 divide-y divide-slate-100">
                                        {pg.lots.map(lot => (
                                            <div key={lot.id} className="flex flex-col md:flex-row justify-between items-start md:items-center py-3 gap-4">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-mono text-sm font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700">L: {lot.lotNumber}</span>
                                                        {!lot.labelPrinted && (
                                                            <Tag color="error" className="m-0 text-[10px]">NO ROTULADO</Tag>
                                                        )}
                                                        {lot.status === 'DEPLETED' && (
                                                            <Tag color="default" className="m-0 text-[10px] font-bold">AGOTADO</Tag>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-500 flex items-center gap-1">
                                                        <Clock size={12}/> Recibido: {new Date(lot.receivedAt).toLocaleString()}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3 w-full md:w-auto">
                                                    <div className={`text-right px-3 py-1 rounded w-24 ${
                                                        lot.status === 'DEPLETED'
                                                        ? 'bg-gray-100 border border-gray-200'
                                                        : 'bg-blue-50'
                                                    }`}>
                                                        <div className={`font-bold ${
                                                            lot.status === 'DEPLETED' ? 'text-gray-400' : 'text-blue-900'
                                                        }`}>{lot.currentQuantity.toLocaleString()}</div>
                                                        <div className={`text-[10px] uppercase font-bold ${
                                                            lot.status === 'DEPLETED' ? 'text-gray-400' : 'text-blue-600'
                                                        }`}>{lot.unit}</div>
                                                    </div>
                                                    
                                                    <div className="flex gap-2">
                                                        <button 
                                                            className="h-10 px-3 bg-gray-100 hover:bg-slate-200 text-slate-700 rounded flex items-center gap-2 font-bold transition-colors"
                                                            onClick={() => handlePrintQR(lot)}
                                                        >
                                                            <Printer size={16} /> QR
                                                        </button>
                                                        <button 
                                                            className="h-10 px-3 text-red-600 border border-red-200 hover:bg-red-50 rounded flex items-center gap-2 font-bold transition-colors shadow-sm"
                                                            onClick={() => openAdjustModal(lot)}
                                                            title="Dar de baja o ajustar por sobrante/faltante"
                                                        >
                                                            <AlertTriangle size={15} /> Ajuste
                                                        </button>
                                                        <button 
                                                            className="h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-2 font-bold transition-colors shadow shadow-blue-200"
                                                            onClick={() => openTransferModal(lot)}
                                                        >
                                                            <ArrowRightLeft size={16} /> PASAR
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {/* DEPLETED lots footer summary */}
                                        {pg.lots.some(l => l.status === 'DEPLETED') && (
                                            <div className="mt-2 pt-2 border-t border-dashed border-gray-200 text-xs text-gray-400 italic text-center">
                                                Los lotes <span className="font-bold text-gray-500">AGOTADO</span> se ocultarán automáticamente en la próxima carga si el stock es 0
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* TRANSFER MODAL */}
            <Modal
                title={<div className="flex items-center gap-2"><ArrowRightLeft className="text-blue-600"/> Transferir Lote de Material</div>}
                open={transferModalOpen}
                onCancel={() => setTransferModalOpen(false)}
                footer={null}
                width={500}
                destroyOnClose
            >
                {selectedLot && (
                    <div className="mt-4 space-y-4">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                            <h3 className="font-bold text-slate-900 mb-1">{selectedLot.productName}</h3>
                            <div className="flex justify-between items-center text-sm">
                                <span className="font-mono bg-white px-2 py-1 border rounded text-gray-600">Lote: {selectedLot.lotNumber}</span>
                                <span>Dir: <strong className="text-blue-600">{activeZone}</strong> <ArrowRightLeft size={12} className="inline mx-1"/> <strong className="text-indigo-600">???</strong></span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zona Destino</label>
                            <select
                                className="w-full border border-gray-300 rounded p-2.5 focus:ring-2 focus:ring-blue-100 font-bold text-slate-700"
                                value={transferForm.toZone}
                                onChange={e => setTransferForm({...transferForm, toZone: e.target.value})}
                            >
                                <option value="" disabled>-- Seleccione Zona --</option>
                                {ZONES.filter(z => z.id !== activeZone).map(z => (
                                    <option key={z.id} value={z.id}>{z.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                Cantidad a Trasladar (Max: {selectedLot.currentQuantity} {selectedLot.unit})
                            </label>
                            <input
                                type="number"
                                className="w-full border border-gray-300 rounded p-2.5 font-mono text-lg font-bold focus:ring-2 focus:ring-blue-100"
                                value={transferForm.quantity}
                                onChange={e => setTransferForm({...transferForm, quantity: e.target.value})}
                                max={selectedLot.currentQuantity}
                                min="0.01"
                                step="0.01"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observaciones (Opcional)</label>
                            <textarea
                                className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-100"
                                rows={2}
                                value={transferForm.observations}
                                onChange={e => setTransferForm({...transferForm, observations: e.target.value})}
                                placeholder="Motivo u orden relacionada..."
                            />
                        </div>

                        <div className="pt-4 flex justify-end gap-3">
                            <button 
                                className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded font-bold transition-colors"
                                onClick={() => setTransferModalOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button 
                                className="px-6 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded font-bold shadow transition-colors disabled:opacity-50 flex items-center gap-2"
                                onClick={submitTransfer}
                                disabled={transferLoading || !transferForm.toZone}
                            >
                                {transferLoading && <Spin size="small" />} Confirmar Cruce
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* ADJUST/MERMA MODAL */}
            <Modal
                title={<div className="flex items-center gap-2"><AlertTriangle className="text-orange-500"/> Reportar Ajuste de Inventario</div>}
                open={adjustModalOpen}
                onCancel={() => setAdjustModalOpen(false)}
                footer={null}
                width={500}
                destroyOnClose
            >
                {selectedLot && (
                    <div className="mt-4 space-y-4">
                        <div className={`p-4 rounded-lg border ${adjustForm.adjustType === 'SUBTRACT' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                            <h3 className={`font-bold mb-1 ${adjustForm.adjustType === 'SUBTRACT' ? 'text-red-900' : 'text-green-900'}`}>{selectedLot.productName}</h3>
                            <div className="flex justify-between items-center text-sm">
                                <span className={`font-mono bg-white px-2 py-1 border rounded ${adjustForm.adjustType === 'SUBTRACT' ? 'border-red-200 text-red-800' : 'border-green-200 text-green-800'}`}>Lote: {selectedLot.lotNumber}</span>
                                <span>Disponible actual: <strong className={adjustForm.adjustType === 'SUBTRACT' ? 'text-red-700' : 'text-green-700'}>{selectedLot.currentQuantity} {selectedLot.unit}</strong></span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                Tipo de Ajuste
                            </label>
                            <select
                                className="w-full border border-gray-300 rounded p-2.5 font-bold focus:ring-2 focus:ring-orange-200"
                                value={adjustForm.adjustType}
                                onChange={e => setAdjustForm({...adjustForm, adjustType: e.target.value})}
                            >
                                <option value="SUBTRACT">Baja / Faltante (-)</option>
                                <option value="ADD">Ingreso / Sobrante (+)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                Cantidad a {adjustForm.adjustType === 'SUBTRACT' ? 'Descontar' : 'Agregar'}
                            </label>
                            <input
                                type="number"
                                className={`w-full border border-gray-300 rounded p-2.5 font-mono text-lg font-bold focus:ring-2 ${adjustForm.adjustType === 'SUBTRACT' ? 'focus:ring-red-200 text-red-700' : 'focus:ring-green-200 text-green-700'}`}
                                value={adjustForm.quantity}
                                onChange={e => setAdjustForm({...adjustForm, quantity: e.target.value})}
                                max={adjustForm.adjustType === 'SUBTRACT' ? selectedLot.currentQuantity : undefined}
                                min="0.01"
                                step="0.01"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Motivo / Justificación (Obligatorio)</label>
                            <textarea
                                className={`w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 ${adjustForm.adjustType === 'SUBTRACT' ? 'focus:ring-red-200' : 'focus:ring-green-200'}`}
                                rows={2}
                                value={adjustForm.reason}
                                onChange={e => setAdjustForm({...adjustForm, reason: e.target.value})}
                                placeholder={adjustForm.adjustType === 'SUBTRACT' ? "Ej: Se regó 53gr en el piso durante el alistamiento..." : "Ej: Sobrante no registrado en la báscula al ingresar lote..."}
                            />
                        </div>

                        <div className="pt-4 flex justify-end gap-3">
                            <button 
                                className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded font-bold transition-colors"
                                onClick={() => setAdjustModalOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button 
                                className={`px-6 py-2.5 text-white rounded font-bold shadow transition-colors disabled:opacity-50 flex items-center gap-2 ${adjustForm.adjustType === 'SUBTRACT' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                                onClick={submitAdjust}
                                disabled={adjustLoading || !adjustForm.reason.trim() || !adjustForm.quantity}
                            >
                                {adjustLoading && <Spin size="small" />} Confirmar {adjustForm.adjustType === 'SUBTRACT' ? 'Descuento' : 'Ingreso'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* PRINT MODAL */}
            <Modal
                title={<div className="flex items-center gap-2"><Printer className="text-slate-600"/> Imprimir Etiquetas (Pares)</div>}
                open={printModalOpen}
                onCancel={() => setPrintModalOpen(false)}
                footer={null}
                width={450}
                destroyOnClose
            >
                {selectedLot && (
                    <div className="mt-4 space-y-4">
                        <div className="bg-white rounded border border-gray-300 shadow-sm overflow-hidden mb-6">
                            <div className="bg-black text-white text-center text-xs font-bold py-1 tracking-widest">
                                MATERIA PRIMA
                            </div>
                            <div className="p-3 flex gap-3">
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-900 text-sm leading-tight uppercase line-clamp-2 mb-2">
                                        {selectedLot.productName}
                                    </h3>
                                    <div className="w-full h-px bg-gray-300 mb-2"></div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                                        <div className="text-gray-500 font-bold">LOTE:</div>
                                        <div className="font-mono font-bold text-gray-900">{selectedLot.lotNumber}</div>
                                        
                                        <div className="text-gray-500 font-bold">SKU:</div>
                                        <div className="text-gray-900">{selectedLot.sku}</div>

                                        <div className="text-gray-500 font-bold">CANT:</div>
                                        <div className="font-bold text-blue-700 bg-blue-50 px-1 rounded inline-block">
                                            {printForm.customQtyText || '...'} {selectedLot.unit}
                                        </div>
                                        
                                        <div className="text-gray-500 font-bold">RECIB:</div>
                                        <div className="text-gray-900">{new Date(selectedLot.receivedAt).toLocaleDateString('es-CO')}</div>
                                    </div>
                                </div>
                                <div className="w-20 lg:w-24 border-l border-dashed border-gray-300 pl-3 flex flex-col items-center justify-center">
                                    {/* Mockup QR */}
                                    <div className="w-full aspect-square bg-gray-100 border border-gray-300 rounded flex items-center justify-center relative group">
                                        <QrCode className="text-gray-400 w-2/3 h-2/3" />
                                        <div className="absolute hidden group-hover:block bg-black/90 text-white text-[10px] p-2 rounded -left-32 w-56 z-10 shadow-xl font-mono break-all leading-tight">
                                            <div className="text-gray-400 mb-1 border-b border-gray-700 pb-1">ZPL Payload:</div>
                                            {`{"sku":"${selectedLot.sku}","lot":"${selectedLot.lotNumber}","qty":${printForm.customQtyText || 0}}`}
                                        </div>
                                    </div>
                                    <span className="text-[9px] text-gray-400 text-center mt-1 uppercase font-bold">Apunta para ver data</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                Cantidad especificada en el Rótulo (Ej. Peso de un "pack")
                            </label>
                            <input
                                type="number"
                                className="w-full border border-gray-300 rounded p-2.5 font-mono text-lg font-bold focus:ring-2 focus:ring-slate-100"
                                value={printForm.customQtyText}
                                onChange={e => {
                                    const val = e.target.value;
                                    const qty = parseFloat(val);
                                    let newCopies = printForm.copies;
                                    
                                    if (qty > 0 && selectedLot.currentQuantity > 0) {
                                        // 1 Par (2 físicas) por cada empaque de materia prima
                                        newCopies = Math.ceil(selectedLot.currentQuantity / qty);
                                    }
                                    setPrintForm({ ...printForm, customQtyText: val, copies: newCopies });
                                }}
                            />
                        </div>

                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-bold text-gray-500 uppercase">
                                    Número de impresiones (Pares)
                                </label>
                                {printForm.copies > 0 && (
                                    <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-bold">
                                        = {printForm.copies * 2} etiquetas físicas (frente/espalda)
                                    </span>
                                )}
                            </div>
                            <input
                                type="number"
                                className="w-full border border-gray-300 rounded p-2.5 font-mono text-lg font-bold focus:ring-2 focus:ring-slate-100"
                                value={printForm.copies}
                                onChange={e => setPrintForm({ ...printForm, copies: parseInt(e.target.value) || 0 })}
                            />
                            {printForm.copies === Math.ceil(selectedLot.currentQuantity / parseFloat(printForm.customQtyText)) && (selectedLot.currentQuantity % parseFloat(printForm.customQtyText)) !== 0 && (
                                <div className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 mt-2 p-2 rounded flex items-start gap-2 shadow-sm font-medium">
                                    <div className="mt-0.5">⚠️</div>
                                    <div>
                                        <strong className="block text-orange-800">Auto-ajuste de Saldo Físico:</strong>
                                        El sistema imprimirá automáticamente <strong>{Math.floor(selectedLot.currentQuantity / parseFloat(printForm.customQtyText))} pares</strong> de {printForm.customQtyText} {selectedLot.unit} y <strong>1 par parcial</strong> por el sobrante de {selectedLot.currentQuantity % parseFloat(printForm.customQtyText)} {selectedLot.unit}.
                                    </div>
                                </div>
                            )}
                            <p className="text-[10px] text-gray-400 italic mt-2 leading-tight">
                                Nota: El rollo tiene formato doble. 1 impresión saca 2 etiquetas contiguas idénticas (para frente y espalda).
                            </p>
                        </div>

                        <div className="pt-4 flex justify-end gap-3">
                            <button 
                                className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded font-bold transition-colors"
                                onClick={() => setPrintModalOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button 
                                className="px-6 py-2.5 bg-slate-800 text-white hover:bg-black rounded font-bold shadow transition-colors disabled:opacity-50 flex items-center gap-2"
                                onClick={submitPrint}
                                disabled={printLoading}
                            >
                                {printLoading && <Spin size="small" />} Imprimir {printForm.copies} pares
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
