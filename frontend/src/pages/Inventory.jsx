import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { socket } from '../services/socket';
import { Search, Filter, AlertTriangle, CheckCircle, XCircle, Grid, List, RefreshCw, TrendingDown } from 'lucide-react';
import InventoryMatrix from '../components/inventory/InventoryMatrix';
import SyncProgressModal from '../components/inventory/SyncProgressModal';
import ProductAnalysisModal from '../components/inventory/ProductAnalysisModal';
import UnassignedBulkIngressModal from '../components/inventory/UnassignedBulkIngressModal';
import { parseScanInput, resolveScannedQuantity } from '../services/scannerParser';
import { useGlobalScanner } from '../hooks/useGlobalScanner';

import PlanningModal from '../components/inventory/PlanningModal'; // Added

const Inventory = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('ALL');
    const [groups, setGroups] = useState([]);
    const [viewMode, setViewMode] = useState('MATRIX'); // 'LIST' or 'MATRIX'
    const [showPlanningModal, setShowPlanningModal] = useState(false); // Added
    const [showNegativeOnly, setShowNegativeOnly] = useState(false);
    const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);

    // Product Analysis Modal State
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [pendingLotScan, setPendingLotScan] = useState(null);
    const [scannerNotice, setScannerNotice] = useState(null);
    const [bulkIngressContext, setBulkIngressContext] = useState(null);
    const scannerNoticeTimerRef = useRef(null);

    // Sync UI State
    const [isSyncing, setIsSyncing] = useState(false);
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ percentage: 0, status: 'IDLE', message: '' });

    const pushScannerNotice = useCallback((status, message) => {
        setScannerNotice({ status, message });
        if (scannerNoticeTimerRef.current) clearTimeout(scannerNoticeTimerRef.current);
        scannerNoticeTimerRef.current = setTimeout(() => setScannerNotice(null), 4500);
    }, []);

    useEffect(() => {
        loadInventory();

        const handleUpdate = (event) => {
            console.log('Real-time inventory update received:', event);
            loadInventory();
        };

        const handleSyncProgress = (data) => {
            setSyncProgress(data);
            if (data.status === 'COMPLETED' || data.status === 'ERROR') {
                setIsSyncing(false);
            }
        };

        socket.on('inventory:updated', handleUpdate);
        socket.on('inventory:sync:progress', handleSyncProgress);

        // Rotating page sync: cycles through pages 1-6 every 2 minutes (12 min full cycle)
        // Rotating page sync: cycles through pages automatically
        let currentPage = 1;
        let maxPages = 15; // Safe default

        const syncInterval = setInterval(async () => {
            // Fetch next page
            try {
                const totalPages = await syncInventory(currentPage);
                if (totalPages && totalPages > 0) {
                    maxPages = totalPages;
                }
            } catch (e) { console.error(e); }

            // Increment page loop
            currentPage = (currentPage % maxPages) + 1;
        }, 120000); // 2 minutes

        return () => {
            socket.off('inventory:updated', handleUpdate);
            socket.off('inventory:sync:progress', handleSyncProgress);
            clearInterval(syncInterval);
            if (scannerNoticeTimerRef.current) clearTimeout(scannerNoticeTimerRef.current);
        };
    }, []);

    const handleLotScanConsumed = useCallback(() => setPendingLotScan(null), []);
    const handleCloseProductModal = useCallback(() => {
        setPendingLotScan(null);
        setSelectedProduct(null);
    }, []);

    const findProductByScan = useCallback((scan, packageLabel = null) => {
        if (packageLabel?.productId) {
            return products.find(product => product.id === packageLabel.productId) || null;
        }

        return products.find(product =>
            product.code === scan.sku ||
            product.barcode === scan.barcode ||
            product.code === scan.barcode
        ) || null;
    }, [products]);

    const handleInventoryScan = useCallback(async (rawValue) => {
        const scan = parseScanInput(rawValue);
        if (scan.type === 'unknown' || (!scan.sku && !scan.barcode && !scan.packageId && !scan.packageCode)) {
            return;
        }

        let packageLabel = null;
        if (scan.packageId || scan.packageCode) {
            try {
                const { data } = await api.post('/inventory/package-labels/validate-scan', {
                    packageCode: scan.packageId || scan.packageCode,
                    recordScan: false
                });
                packageLabel = data.packageLabel || null;
            } catch (error) {
                if (error.response?.status !== 404) {
                    pushScannerNotice('error', error.response?.data?.error || 'No se pudo validar el ID unico');
                    return;
                }
            }
        }

        const matchedProduct = findProductByScan(scan, packageLabel);
        if (!matchedProduct) {
            pushScannerNotice('error', `No encontre producto para ${scan.packageId || scan.barcode || scan.sku || 'el codigo escaneado'}`);
            return;
        }

        const resolvedQuantity = resolveScannedQuantity({
            scan,
            product: matchedProduct,
            packageLabel,
            fallback: null
        });

        const normalizedScan = {
            ...scan,
            productId: packageLabel?.productId || matchedProduct.id,
            duplicatePackageLabel: packageLabel,
            packageDuplicate: Boolean(packageLabel),
            packageId: packageLabel?.packageCode || scan.packageId || scan.packageCode || null,
            packageCode: packageLabel?.packageCode || scan.packageCode || scan.packageId || null,
            quantity: resolvedQuantity,
            unitsPerBox: resolvedQuantity,
            lotNumber: packageLabel?.lotNumber || scan.lotNumber || null,
            receivedAt: packageLabel?.receivedAt || scan.receivedAt || null,
            expirationDate: packageLabel?.expiresAt || scan.expirationDate || null,
            sku: packageLabel?.sku || scan.sku || matchedProduct.code,
            barcode: packageLabel?.barcode || scan.barcode || matchedProduct.barcode,
        };

        setSelectedProduct(matchedProduct);
        setPendingLotScan(normalizedScan);
        pushScannerNotice(
            packageLabel ? 'warning' : 'success',
            packageLabel
                ? `ID ${packageLabel.packageCode} ya registrado. Abrí ${matchedProduct.name} para validarlo.`
                : `Escaneo listo en ${matchedProduct.name}.`
        );
    }, [findProductByScan, pushScannerNotice]);

    useGlobalScanner({
        onScan: handleInventoryScan,
        enabled: !showSyncModal && !bulkIngressContext
    });

    const loadInventory = async () => {
        try {
            const res = await api.get('/inventory/list');
            if (res.data.success) {
                const loadedProducts = res.data.data;
                setProducts(loadedProducts);
                const uniqueGroups = [...new Set(loadedProducts.map(p => p.group))].sort();
                setGroups(uniqueGroups);
            }
        } catch (error) {
            console.error('Error loading inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const syncInventory = async (page = 1) => {
        try {
            console.log(`🔄 Auto-syncing inventory page ${page}...`);
            const res = await api.post(`/inventory/sync?page=${page}`);
            if (res.data.success) {
                setProducts(res.data.data);
                const uniqueGroups = [...new Set(res.data.data.map(p => p.group))].sort();
                setGroups(uniqueGroups);
                console.log(`✅ Synced ${res.data.meta.syncedCount} products. Total Pages: ${res.data.meta.totalPages}`);
                return res.data.meta.totalPages;
            }
        } catch (error) {
            console.error('Error syncing inventory:', error);
            return null;
        }
    };

    const performSync = async () => {
        // Step 2: User Confirmed, Start Sync
        setSyncProgress({ percentage: 0, status: 'STARTING', message: 'Iniciando...' });
        setIsSyncing(true);

        try {
            await api.post('/siigo/sync/products');
        } catch (error) {
            console.error('Manual sync failed request:', error);
            setSyncProgress({ status: 'ERROR', message: 'Fallo al iniciar sincronización', percentage: 0 });
            setIsSyncing(false);
        }
    };

    const handleManualSync = async () => {
        // Step 1: Open Confirmation Modal
        setSyncProgress({
            status: 'CONFIRM',
            message: '¿Estás seguro de sincronizar todo el inventario desde Siigo? Esto puede tomar varios minutos.',
            percentage: 0,
            onConfirm: performSync // Pass the actual action
        });
        setShowSyncModal(true);
    };

    const closeSyncModal = () => {
        setShowSyncModal(false);
        if (syncProgress.status === 'COMPLETED') {
            loadInventory();
        }
    };

    const negativeCount = products.filter(p => (p.currentStock || 0) < 0).length;

    const getUnassignedQty = (p) => p.unassignedQty || 0;
    const unassignedCount = products.filter(p => getUnassignedQty(p) > 0).length;

    const filteredProducts = products.filter(p => {
        const term = searchTerm.trim().toLowerCase();
        let matchesSearch = true;
        if (term) {
            if (term.includes('%')) {
                const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
                const re = new RegExp(escaped, 'i');
                matchesSearch = re.test(p.name) || re.test(p.code);
            } else {
                matchesSearch = p.name.toLowerCase().includes(term) ||
                    p.code.toLowerCase().includes(term);
            }
        }

        if (showNegativeOnly && (p.currentStock || 0) >= 0) return false;
        if (showUnassignedOnly && getUnassignedQty(p) <= 0) return false;

        if (selectedGroup === 'ALL') return matchesSearch;
        return matchesSearch && p.group === selectedGroup;
    });

    const getStatusBadge = (level) => {
        if (level === 'CRITICAL') return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-semibold"><XCircle size={14} /> Crítico</span>;
        if (level === 'WARNING') return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 text-yellow-700 text-xs font-semibold"><AlertTriangle size={14} /> Bajo</span>;
        return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-semibold"><CheckCircle size={14} /> OK</span>;
    };


    if (loading) return <div className="p-8 text-center text-neutral-500">Cargando inventario...</div>;

    return (
        <div className="space-y-4 w-full px-1 sm:px-4 overflow-x-hidden">
            <SyncProgressModal
                isOpen={showSyncModal}
                progressData={syncProgress}
                onClose={closeSyncModal}
            />

            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap justify-between items-start sm:items-center gap-2 w-full">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">Inventario General</h1>
                        <p className="text-neutral-500 text-xs sm:text-sm mt-0.5">Gestión de stock en tiempo real (Sincronizado con SIIGO)</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowPlanningModal(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium text-xs sm:text-sm"
                        >
                            <List className="w-4 h-4" />
                            Planificar
                        </button>

                        <button
                            onClick={handleManualSync}
                            disabled={isSyncing}
                            className={`
                                group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 border
                                ${isSyncing
                                    ? 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-wait'
                                    : 'bg-white text-blue-600 border-blue-200 hover:border-blue-300 hover:bg-blue-50 shadow-sm hover:shadow-md'
                                }
                            `}
                            title="Sincronizar con Siigo"
                        >
                            <RefreshCw
                                className={`w-4 h-4 transition-transform duration-700 ${isSyncing ? 'animate-spin' : 'group-hover:rotate-180'}`}
                            />
                            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
                        </button>

                        {/* View Toggles */}
                        <div className="flex bg-white border border-neutral-200 p-0.5 rounded-lg shadow-sm">
                            <button
                                onClick={() => setViewMode('LIST')}
                                className={`px-2 py-1 rounded flex items-center text-xs font-medium transition-all ${viewMode === 'LIST' ? 'bg-neutral-100 text-primary-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
                                title="Vista de Lista"
                            >
                                <List className="w-4 h-4 mr-1" /> Lista
                            </button>
                            <button
                                onClick={() => setViewMode('MATRIX')}
                                className={`px-2 py-1 rounded flex items-center text-xs font-medium transition-all ${viewMode === 'MATRIX' ? 'bg-neutral-100 text-primary-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
                                title="Vista de Matriz"
                            >
                                <Grid className="w-4 h-4 mr-1" /> Matriz
                            </button>
                        </div>
                    </div>
                </div>

                {/* Negative stock alert */}
                {negativeCount > 0 && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${showNegativeOnly ? 'bg-red-100 border-red-300' : 'bg-red-50 border-red-200'} cursor-pointer transition-colors hover:bg-red-100`}
                        onClick={() => { setShowNegativeOnly(v => !v); if (!showNegativeOnly) setShowUnassignedOnly(false); }}>
                        <TrendingDown className="w-4 h-4 text-red-600" />
                        <span className="text-sm font-semibold text-red-700">
                            {negativeCount} producto{negativeCount !== 1 ? 's' : ''} con stock negativo
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${showNegativeOnly ? 'bg-red-600 text-white' : 'bg-red-200 text-red-800'}`}>
                            {showNegativeOnly ? 'Mostrando' : 'Ver'}
                        </span>
                    </div>
                )}

                {/* Unassigned lots alert */}
                {unassignedCount > 0 && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${showUnassignedOnly ? 'bg-amber-100 border-amber-300' : 'bg-amber-50 border-amber-200'} cursor-pointer transition-colors hover:bg-amber-100`}
                        onClick={() => { setShowUnassignedOnly(v => !v); if (!showUnassignedOnly) setShowNegativeOnly(false); }}>
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-semibold text-amber-700">
                            {unassignedCount} producto{unassignedCount !== 1 ? 's' : ''} con cantidades sin lote asignado
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${showUnassignedOnly ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-800'}`}>
                            {showUnassignedOnly ? 'Mostrando' : 'Ver'}
                        </span>
                    </div>
                )}

                {/* Wrapped Groups Filter */}
                <div className="flex gap-1.5 flex-wrap pb-1">
                    <button
                        onClick={() => { setSelectedGroup('ALL'); setShowNegativeOnly(false); setShowUnassignedOnly(false); }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedGroup === 'ALL' && !showNegativeOnly ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50 border border-neutral-200'}`}
                    >
                        Todos
                    </button>
                    {groups.map(group => (
                        <button
                            key={group}
                            onClick={() => setSelectedGroup(group)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedGroup === group ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50 border border-neutral-200'}`}
                        >
                            {group}
                        </button>
                    ))}
                </div>

                {scannerNotice && (
                    <div className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                        scannerNotice.status === 'error'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : scannerNotice.status === 'warning'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                        {scannerNotice.message}
                    </div>
                )}

                <div>
                    <div className="flex gap-2 mb-3 px-1">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, código o grupo..."
                                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {viewMode === 'MATRIX' ? (
                        <InventoryMatrix
                            products={filteredProducts}
                            onProductClick={setSelectedProduct}
                            onBulkValidationOpen={setBulkIngressContext}
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-neutral-50 text-neutral-500 font-medium">
                                    <tr>
                                        <th className="px-2 py-2 rounded-l-lg">Código</th>
                                        <th className="px-2 py-2">Producto</th>
                                        <th className="px-2 py-2">Grupo</th>
                                        <th className="px-2 py-2 text-right">Precio</th>
                                        <th className="px-2 py-2 text-center">Disponible</th>
                                        <th className="px-2 py-2 text-center">Reservado</th>
                                        <th className="px-2 py-2 rounded-r-lg text-right">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {filteredProducts.map((p) => (
                                        <tr
                                            key={p.id}
                                            className="hover:bg-neutral-50 transition-colors cursor-pointer"
                                            onClick={() => setSelectedProduct(p)}
                                        >
                                            <td className="px-2 py-2 font-mono text-neutral-600">{p.code}</td>
                                            <td className="px-2 py-2 font-medium text-neutral-900">{p.name}</td>
                                            <td className="px-2 py-2 text-neutral-500">{p.group}</td>
                                            <td className="px-2 py-2 text-right font-mono">${p.price?.toLocaleString()}</td>
                                            <td className="px-2 py-2 text-center font-bold text-neutral-800">{p.available} {p.unit}</td>
                                            <td className="px-2 py-2 text-center text-neutral-400">{p.reserved}</td>
                                            <td className="px-2 py-2 text-right">{getStatusBadge(p.alertLevel)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredProducts.length === 0 && (
                                <div className="p-8 text-center text-neutral-400">
                                    No se encontraron productos con estos filtros.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {showPlanningModal && (
                <PlanningModal onClose={() => setShowPlanningModal(false)} />
            )}

            {bulkIngressContext && (
                <UnassignedBulkIngressModal
                    context={bulkIngressContext}
                    products={products}
                    onClose={() => setBulkIngressContext(null)}
                    onCompleted={loadInventory}
                />
            )}

            {selectedProduct && (
                <ProductAnalysisModal
                    key={selectedProduct.id}
                    product={selectedProduct}
                    initialLotScan={pendingLotScan}
                    onLotScanConsumed={handleLotScanConsumed}
                    onClose={handleCloseProductModal}
                    onUpdate={loadInventory}
                />
            )}
        </div>
    );
};

export default Inventory;
