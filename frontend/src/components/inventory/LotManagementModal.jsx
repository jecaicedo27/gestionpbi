import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, Plus, Package, Trash2, ChevronDown, ChevronUp, Clock, User, AlertCircle, Printer, Pencil, Save, ArrowRightLeft } from 'lucide-react';
import api from '../../services/api';
import { useZebraRef } from '../../context/ZebraContext';
import { buildLotLabelZPL } from '../../services/zplLabelBuilder';
import { resolveScannedQuantity, parseScanInput } from '../../services/scannerParser';
import {
    normalizeInventoryIntegerInput,
    parseInventoryNumberInput
} from '../../utils/inventoryNumberInput';

const PACK_CONTAINER_LABELS = {
    BULTO: 'Bultos',
    CAJA: 'Cajas',
    CANECA: 'Canecas',
    ENVASE: 'Envases',
    SACO: 'Sacos',
    BOLSA: 'Bolsas',
    TAMBOR: 'Tambores',
    GARRAFA: 'Garrafas'
};

const PACK_CONTAINER_OPTIONS = [
    { value: 'CAJA', label: 'Caja' },
    { value: 'BULTO', label: 'Bulto' },
    { value: 'SACO', label: 'Saco' },
    { value: 'BOLSA', label: 'Bolsa' },
    { value: 'CANECA', label: 'Caneca' },
    { value: 'ENVASE', label: 'Envase' },
    { value: 'TAMBOR', label: 'Tambor' },
    { value: 'GARRAFA', label: 'Garrafa' }
];

const FALLBACK_MATERIAL_DESTINATIONS = [
    { value: 'WAREHOUSE', label: 'Bodega principal', description: 'Ingreso físico disponible para almacenamiento general' },
    { value: 'PRODUCTION', label: 'Produccion', description: 'Materia prima liberada para proceso' },
    { value: 'CUARENTENA', label: 'Cuarentena', description: 'Pendiente de revisión o liberación' },
    { value: 'NO_CONFORME', label: 'No conforme', description: 'Separado por novedad o rechazo' },
    { value: 'MAQUILA', label: 'Maquila', description: 'Material reservado o enviado a tercero' }
];

const FALLBACK_FINISHED_DESTINATIONS = [
    { value: 'PRODUCCION', label: 'Produccion', description: 'Disponible para alistamiento o consumo inmediato' },
    { value: 'PRODUCTO_TERMINADO', label: 'Producto terminado', description: 'Stock liberado de producto terminado' },
    { value: 'CUARENTENA', label: 'Cuarentena', description: 'Pendiente de revisión o liberación' },
    { value: 'NO_CONFORME', label: 'No conforme', description: 'Separado por novedad o rechazo' },
    { value: 'MAQUILA', label: 'Maquila', description: 'Producto reservado o enviado a tercero' },
    { value: 'PUBLICIDAD', label: 'Publicidad', description: 'Material separado para uso promocional' }
];

const FINISHED_PRODUCT_TYPES = new Set(['PERLA_EXPLOSIVA', 'SYRUP', 'BASE_CITRICA']);

const isFinishedProductLike = (product) => {
    const classification = String(product?.classification || '').toUpperCase();
    const type = String(product?.type || '').toUpperCase();
    if (classification === 'MATERIA_PRIMA') return false;
    return classification === 'PRODUCTO_TERMINADO' || FINISHED_PRODUCT_TYPES.has(type);
};

const parseWarehouseList = (warehouses) => {
    if (!warehouses) return [];

    let parsed = warehouses;
    if (typeof warehouses === 'string') {
        try {
            parsed = JSON.parse(warehouses);
        } catch (_error) {
            return [];
        }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
        .map((warehouse, index) => ({
            id: String(warehouse?.id ?? index),
            name: String(warehouse?.name || '').trim(),
            quantity: Number(warehouse?.quantity || 0)
        }))
        .filter(warehouse => warehouse.name)
        .sort((left, right) => {
            const leftUnassigned = left.name.toUpperCase().includes('SIN ASIGNAR');
            const rightUnassigned = right.name.toUpperCase().includes('SIN ASIGNAR');
            if (leftUnassigned && !rightUnassigned) return -1;
            if (!leftUnassigned && rightUnassigned) return 1;
            return right.quantity - left.quantity;
        });
};

const buildEmptyLotForm = (product) => ({
    lotNumber: '',
    packageUnits: '',
    partialQuantity: '',
    quantity: '',
    packOptionId: '',
    packageCode: '',
    receivedAt: new Date().toISOString().slice(0, 10),
    expiresAt: '',
    zone: isFinishedProductLike(product)
        ? (/^(LIQD|LIQU|GENI)/i.test(product?.sku || '') ? 'PRODUCTO_TERMINADO' : 'PRODUCCION')
        : 'WAREHOUSE'
});

const buildEmptyPackOptionForm = (product, packOptions = []) => {
    const defaultOption = packOptions.find(option => option.isDefault) || packOptions[0] || null;
    const defaultQuantity = Number(defaultOption?.quantity || product?.packSize || 0);
    return {
        quantity: defaultQuantity > 0 ? normalizeInventoryIntegerInput(Math.round(defaultQuantity)) : '',
        label: '',
        containerType: defaultOption?.containerType || 'CAJA',
        isDefault: packOptions.length === 0
    };
};

const summarizePackCoverage = (stock, option, unit) => {
    const quantityPerPack = Number(option?.quantity || 0);
    const currentStock = Number(stock || 0);
    if (quantityPerPack <= 0 || currentStock <= 0) {
        return {
            fullUnits: 0,
            represented: 0,
            loose: currentStock
        };
    }

    const fullUnits = Math.floor(currentStock / quantityPerPack);
    return {
        fullUnits,
        represented: fullUnits * quantityPerPack,
        loose: Math.max(currentStock - (fullUnits * quantityPerPack), 0)
    };
};

const buildDefaultPrintForm = (product, packOptions) => {
    const defaultOption = packOptions.find(option => option.isDefault) || packOptions[0] || null;
    const defaultQuantity = defaultOption?.quantity || Math.max(1, Math.round(product?.packSize || 1));
    return {
        quantityPerPackage: normalizeInventoryIntegerInput(defaultQuantity),
        packageCount: '',
        fullPackageCount: '',
        partialQuantity: '',
        packOptionId: defaultOption?.id || '',
        coverLotQuantity: true,
        appendNewLabels: false,
        forceRegenerate: false,
        sourceMode: 'manual',
        retryPreparedJob: false
    };
};

const buildExplicitPackageQuantities = ({ quantityPerPackage, fullPackageCount, partialQuantity }) => {
    const normalizedPerPackage = parseInventoryNumberInput(quantityPerPackage, 0);
    const normalizedFullCount = parseInventoryNumberInput(fullPackageCount, 0);
    const normalizedPartial = parseInventoryNumberInput(partialQuantity, 0);

    const quantities = [];
    if (normalizedPerPackage > 0 && normalizedFullCount > 0) {
        for (let index = 0; index < normalizedFullCount; index += 1) {
            quantities.push(normalizedPerPackage);
        }
    }
    if (normalizedPartial > 0) {
        quantities.push(normalizedPartial);
    }

    return quantities;
};

const describePackageDistribution = ({ quantityPerPackage, fullPackageCount, partialQuantity, unit, containerType = null }) => {
    const quantities = buildExplicitPackageQuantities({ quantityPerPackage, fullPackageCount, partialQuantity });
    if (quantities.length === 0) return null;

    const normalizedPerPackage = parseInventoryNumberInput(quantityPerPackage, 0);
    const normalizedFullCount = parseInventoryNumberInput(fullPackageCount, 0);
    const normalizedPartial = parseInventoryNumberInput(partialQuantity, 0);
    const containerLabel = PACK_CONTAINER_LABELS[containerType] || 'Unidades';
    const parts = [];

    if (normalizedPerPackage > 0 && normalizedFullCount > 0) {
        parts.push(`${normalizedFullCount} ${containerLabel.toLowerCase()} x ${(Number(normalizedPerPackage) || 0).toLocaleString('es-CO')} ${unit}`);
    }
    if (normalizedPartial > 0) {
        parts.push(`1 parcial x ${(Number(normalizedPartial) || 0).toLocaleString('es-CO')} ${unit}`);
    }

    return {
        quantities,
        label: parts.join(' + '),
        total: quantities.reduce((sum, qty) => sum + qty, 0)
    };
};

const DeferredInput = ({ value, onCommit, onScan, className, ...props }) => {
    const ref = useRef(null);
    const callbackRef = useRef({ onCommit, onScan });
    callbackRef.current = { onCommit, onScan };

    useEffect(() => {
        if (ref.current && ref.current !== document.activeElement) {
            ref.current.value = value ?? '';
        }
    }, [value]);

    const handleChange = useCallback((e) => {
        const val = e.target.value;
        if (callbackRef.current.onScan && (val.includes('LOT:') || val.includes('SKU:') || val.includes('PKG:'))) {
            const scan = parseScanInput(val);
            if (scan.lotNumber) {
                e.target.value = '';
                callbackRef.current.onScan(scan);
                return;
            }
        }
    }, []);

    const flush = useCallback(() => {
        const val = ref.current?.value ?? '';
        callbackRef.current.onCommit(val);
    }, []);

    return (
        <input
            ref={ref}
            type="text"
            defaultValue={value}
            onChange={handleChange}
            onBlur={flush}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); flush(); } }}
            className={className || "w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"}
            {...props}
        />
    );
};

const LotManagementModal = ({ product, initialScan, onScanConsumed, onClose, onChanged }) => {
    const [lots, setLots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lotTab, setLotTab] = useState('active');
    const [showAddForm, setShowAddForm] = useState(false);
    const [expandedLot, setExpandedLot] = useState(null);
    const [lotHistory, setLotHistory] = useState({});
    const [newLot, setNewLot] = useState(buildEmptyLotForm(product));
    const [saving, setSaving] = useState(false);
    const [packOptions, setPackOptions] = useState([]);
    const [recommendedPackOptionId, setRecommendedPackOptionId] = useState('');
    const [packEditorOpen, setPackEditorOpen] = useState(false);
    const [editingPackOptionId, setEditingPackOptionId] = useState(null);
    const [savingPackOption, setSavingPackOption] = useState(false);
    const [packForm, setPackForm] = useState(buildEmptyPackOptionForm(product, []));
    const [lotContext, setLotContext] = useState({
        sourceWarehouses: [],
        destinationZones: [],
        defaultZone: isFinishedProductLike(product) ? 'PRODUCCION' : 'WAREHOUSE'
    });
    const [printLot, setPrintLot] = useState(null);
    const [printForm, setPrintForm] = useState(buildDefaultPrintForm(product, []));
    const [printing, setPrinting] = useState(false);
    const [preparedPrintJob, setPreparedPrintJob] = useState(null);
    const [registeredPackageAlert, setRegisteredPackageAlert] = useState(null);
    const [voidingPackage, setVoidingPackage] = useState(false);
    const [packOptionsReady, setPackOptionsReady] = useState(false);
    const [scanToApply, setScanToApply] = useState(null);
    const [transferLotId, setTransferLotId] = useState(null);
    const [transferZone, setTransferZone] = useState('');
    const [transferQty, setTransferQty] = useState('');
    const [transferring, setTransferring] = useState(false);

    const zebraRef = useZebraRef();

    const totalStock = product?.currentStock || 0;
    const unit = product?.unit || 'gramo';
    const isGrams = ['gramo', 'gramos', 'g', 'G'].includes(unit);

    const loadLotContext = useCallback(async () => {
        if (!product?.id) return;
        try {
            const { data } = await api.get(`/inventory/products/${product.id}/lot-context`);
            setLotContext({
                sourceWarehouses: data.sourceWarehouses || [],
                destinationZones: data.destinationZones || [],
                defaultZone: data.defaultZone || (isFinishedProductLike(product) ? 'PRODUCCION' : 'WAREHOUSE')
            });
            setNewLot(prev => {
                const allowedZones = (data.destinationZones || []).map(option => option.value);
                if (allowedZones.length === 0 || allowedZones.includes(prev.zone)) return prev;
                return { ...prev, zone: data.defaultZone || prev.zone };
            });
        } catch (error) {
            console.error('Error loading lot context:', error);
            setLotContext({
                sourceWarehouses: parseWarehouseList(product?.warehouses),
                destinationZones: isFinishedProductLike(product) ? FALLBACK_FINISHED_DESTINATIONS : FALLBACK_MATERIAL_DESTINATIONS,
                defaultZone: isFinishedProductLike(product) ? 'PRODUCCION' : 'WAREHOUSE'
            });
        }
    }, [product]);

    const loadPackOptions = useCallback(async () => {
        if (!product?.id) return;
        setPackOptionsReady(false);
        try {
            const { data } = await api.get(`/inventory/products/${product.id}/pack-options`);
            const options = data.options || [];
            setPackOptions(options);
            setRecommendedPackOptionId(data.recommendedOptionId || '');
            setPrintForm(prev => {
                const defaults = buildDefaultPrintForm(product, options);
                return {
                    ...prev,
                    packOptionId: prev.packOptionId || defaults.packOptionId,
                    quantityPerPackage: prev.quantityPerPackage || defaults.quantityPerPackage
                };
            });
            setPackForm(prev => (editingPackOptionId ? prev : buildEmptyPackOptionForm(product, options)));
        } catch (error) {
            console.error('Error loading pack options:', error);
            setPackOptions([]);
            setRecommendedPackOptionId('');
        } finally {
            setPackOptionsReady(true);
        }
    }, [editingPackOptionId, product]);

    const loadLots = useCallback(async () => {
        if (!product) return;
        setLoading(true);
        try {
            const [mlRes, flsRes] = await Promise.all([
                api.get(`/inventory/lots?productId=${product.id}&status=AVAILABLE,LOW_STOCK,DEPLETED`),
                api.get(`/finished-lots/product-lots?productId=${product.id}`).catch(() => ({ data: [] })),
            ]);

            const mlLots = (Array.isArray(mlRes.data) ? mlRes.data : (mlRes.data?.data || [])).map(lot => ({
                ...lot,
                _type: 'MaterialLot'
            }));
            const flsLots = (Array.isArray(flsRes.data) ? flsRes.data : []).map(lot => ({
                ...lot,
                _type: 'FinishedLotStock'
            }));

            const mergeMap = new Map();
            [...mlLots, ...flsLots].forEach((lot) => {
                const key = `${lot._type}_${lot.id || `${lot.lotNumber}_${lot.zone}`}`;
                if (mergeMap.has(key)) {
                    const existing = mergeMap.get(key);
                    existing.currentQuantity += lot.currentQuantity || 0;
                    existing.initialQuantity += lot.initialQuantity || 0;
                    if (lot._count?.consumptions) {
                        existing._count = {
                            consumptions: (existing._count?.consumptions || 0) + lot._count.consumptions
                        };
                    }
                } else {
                    mergeMap.set(key, { ...lot });
                }
            });

            setLots([...mergeMap.values()]);
        } catch (error) {
            console.error('Error loading lots:', error);
        } finally {
            setLoading(false);
        }
    }, [product]);

    useEffect(() => {
        setNewLot(buildEmptyLotForm(product));
        setLotContext({
            sourceWarehouses: parseWarehouseList(product?.warehouses),
            destinationZones: isFinishedProductLike(product) ? FALLBACK_FINISHED_DESTINATIONS : FALLBACK_MATERIAL_DESTINATIONS,
            defaultZone: isFinishedProductLike(product) ? 'PRODUCCION' : 'WAREHOUSE'
        });
        setPrintForm(buildDefaultPrintForm(product, []));
        setPackOptions([]);
        setRecommendedPackOptionId('');
        setPackEditorOpen(false);
        setEditingPackOptionId(null);
        setSavingPackOption(false);
        setPackForm(buildEmptyPackOptionForm(product, []));
        setPackOptionsReady(false);
        setRegisteredPackageAlert(null);
        setVoidingPackage(false);
        setPreparedPrintJob(null);
        setPrintLot(null);
        setShowAddForm(false);
        setExpandedLot(null);
        setLotHistory({});
        setLotTab('active');
        setScanToApply(null);
    }, [product]);

    useEffect(() => {
        loadLotContext();
        loadLots();
        loadPackOptions();
    }, [loadLotContext, loadLots, loadPackOptions]);

    const totalAssigned = lots.reduce((acc, lot) => acc + (lot.initialQuantity || 0), 0);
    const totalRemaining = lots.reduce((acc, lot) => acc + (lot.currentQuantity || 0), 0);
    const unassigned = Math.max(0, totalStock - totalRemaining);
    const sourceWarehouses = useMemo(() => {
        const fallbackWarehouses = parseWarehouseList(product?.warehouses);
        return (lotContext.sourceWarehouses?.length ? lotContext.sourceWarehouses : fallbackWarehouses)
            .filter(warehouse => warehouse.quantity > 0 || warehouse.name.toUpperCase().includes('SIN ASIGNAR'));
    }, [lotContext.sourceWarehouses, product?.warehouses]);
    const destinationZoneOptions = useMemo(() => {
        if (lotContext.destinationZones?.length) return lotContext.destinationZones;
        return isFinishedProductLike(product) ? FALLBACK_FINISHED_DESTINATIONS : FALLBACK_MATERIAL_DESTINATIONS;
    }, [lotContext.destinationZones, product]);
    const initialLotZoneOptions = useMemo(() => {
        return destinationZoneOptions;
    }, [destinationZoneOptions]);
    const selectedDestinationZone = destinationZoneOptions.find(option => option.value === newLot.zone) || null;
    const selectedNewLotPackOption = packOptions.find(option => option.id === newLot.packOptionId) || null;
    const selectedNewLotPerPackage = Number(selectedNewLotPackOption?.quantity || product?.packSize || 0);
    const selectedNewLotContainerLabel = PACK_CONTAINER_LABELS[selectedNewLotPackOption?.containerType] || 'Unidades';
    const showPhysicalUnitInputs = (
        selectedNewLotPerPackage > 1 ||
        packOptions.some(option => Number(option.quantity || 0) > 1) ||
        parseInventoryNumberInput(newLot.packageUnits, 0) > 0 ||
        parseInventoryNumberInput(newLot.partialQuantity, 0) > 0
    );
    const newLotDistribution = describePackageDistribution({
        quantityPerPackage: selectedNewLotPerPackage,
        fullPackageCount: newLot.packageUnits,
        partialQuantity: newLot.partialQuantity,
        unit,
        containerType: selectedNewLotPackOption?.containerType || null
    });
    const selectedPrintPackOption = packOptions.find(option => option.id === printForm.packOptionId) || null;
    const printDistribution = describePackageDistribution({
        quantityPerPackage: printForm.quantityPerPackage,
        fullPackageCount: printForm.fullPackageCount,
        partialQuantity: printForm.partialQuantity,
        unit,
        containerType: selectedPrintPackOption?.containerType || null
    });
    const hasExplicitPrintDistribution = Boolean(printDistribution?.quantities?.length);
    const packOptionSummaries = useMemo(() => (
        packOptions.map(option => ({
            ...option,
            coverage: summarizePackCoverage(totalStock, option, unit)
        }))
    ), [packOptions, totalStock, unit]);
    const packSummary = useMemo(() => {
        const defaultOption = packOptionSummaries.find(option => option.isDefault) || null;
        const mostUsedOption = packOptionSummaries.find(option => option.isMostUsed) || null;
        const totalUnits = packOptionSummaries.reduce((sum, option) => sum + (option.coverage?.fullUnits || 0), 0);
        const totalActivePackages = packOptionSummaries.reduce((sum, option) => sum + Number(option.activeCount || 0), 0);
        const totalActiveQuantity = packOptionSummaries.reduce((sum, option) => sum + Number(option.activeQuantity || 0), 0);
        return {
            totalFormats: packOptionSummaries.length,
            totalUnits,
            totalActivePackages,
            totalActiveQuantity,
            defaultOption,
            mostUsedOption
        };
    }, [packOptionSummaries]);

    const fmtQty = (quantity) => `${(Number(quantity) || 0).toLocaleString('es-CO')} ${unit}`;
    const getProductName = () => product?.name || product?.code || 'Producto';

    const getStatusBadge = (status, qty, initial) => {
        const pct = initial > 0 ? (qty / initial) * 100 : 0;
        if (status === 'DEPLETED' || qty <= 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">AGOTADO</span>;
        if (status === 'LOW_STOCK' || pct < 15) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">BAJO</span>;
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">DISPONIBLE</span>;
    };

    const resolvePreferredPackOption = useCallback((preferredPackOptionId = '', totalQuantityValue = null) => {
        const normalizedQuantity = parseInventoryNumberInput(totalQuantityValue, 0);
        return packOptions.find(option => option.id === preferredPackOptionId)
            || (normalizedQuantity > 0 ? packOptions.find(option => Number(option.quantity) === normalizedQuantity) : null)
            || packOptions.find(option => option.id === recommendedPackOptionId)
            || packOptions.find(option => option.isDefault)
            || packOptions[0]
            || null;
    }, [packOptions, recommendedPackOptionId]);

    const deriveDistributionFromTotalQuantity = useCallback((totalQuantityValue, preferredPackOptionId = '') => {
        const normalizedQuantity = parseInventoryNumberInput(totalQuantityValue, 0);
        const targetPackOption = resolvePreferredPackOption(preferredPackOptionId, totalQuantityValue);
        const quantityPerPackage = Number(targetPackOption?.quantity || product?.packSize || 0);

        if (normalizedQuantity <= 0) {
            return {
                quantity: '',
                packageUnits: '',
                partialQuantity: '',
                packOptionId: targetPackOption?.id || preferredPackOptionId || ''
            };
        }

        if (quantityPerPackage <= 0) {
            return {
                quantity: normalizeInventoryIntegerInput(normalizedQuantity),
                packageUnits: '',
                partialQuantity: '',
                packOptionId: targetPackOption?.id || preferredPackOptionId || ''
            };
        }

        const packageUnits = Math.floor(normalizedQuantity / quantityPerPackage);
        const partialQuantity = Math.max(normalizedQuantity - (packageUnits * quantityPerPackage), 0);

        return {
            quantity: normalizeInventoryIntegerInput(normalizedQuantity),
            packageUnits: packageUnits > 0 ? normalizeInventoryIntegerInput(packageUnits) : '',
            partialQuantity: partialQuantity > 0 ? normalizeInventoryIntegerInput(partialQuantity) : '',
            packOptionId: targetPackOption?.id || preferredPackOptionId || ''
        };
    }, [product?.packSize, resolvePreferredPackOption]);

    const recalculateNewLotQuantity = useCallback((nextUnits, nextPartial, packOptionId = newLot.packOptionId) => {
        const targetPackOption = packOptions.find(option => option.id === packOptionId) || null;
        const quantityPerPackage = Number(targetPackOption?.quantity || product?.packSize || 0);
        const normalizedUnits = parseInventoryNumberInput(nextUnits, 0);
        const normalizedPartial = parseInventoryNumberInput(nextPartial, 0);
        if (quantityPerPackage <= 0 && normalizedPartial <= 0) {
            return '';
        }
        return String((normalizedUnits * quantityPerPackage) + normalizedPartial);
    }, [newLot.packOptionId, packOptions, product]);

    const effectiveNewLotQuantity = parseInventoryNumberInput(
        recalculateNewLotQuantity(newLot.packageUnits, newLot.partialQuantity, newLot.packOptionId) || newLot.quantity,
        0
    );

    const applyDistributionToNewLot = useCallback((patch) => {
        setNewLot(prev => {
            const next = { ...prev, ...patch };
            return {
                ...next,
                quantity: recalculateNewLotQuantity(next.packageUnits, next.partialQuantity, next.packOptionId) || next.quantity
            };
        });
    }, [recalculateNewLotQuantity]);

    const resetPackEditor = useCallback((options = packOptions) => {
        setEditingPackOptionId(null);
        setPackForm(buildEmptyPackOptionForm(product, options));
    }, [packOptions, product]);

    const handlePackFormChange = useCallback((field, value) => {
        setPackForm(prev => ({
            ...prev,
            [field]: field === 'quantity' ? normalizeInventoryIntegerInput(value) : value
        }));
    }, []);

    const handleSavePackOption = async () => {
        const payload = {
            quantity: parseInventoryNumberInput(packForm.quantity, 0),
            label: packForm.label.trim() || null,
            containerType: packForm.containerType || null,
            isDefault: Boolean(packForm.isDefault)
        };

        if (!payload.quantity) {
            alert('La cantidad del Pack / Caja debe ser mayor a 0');
            return;
        }

        setSavingPackOption(true);
        try {
            let savedOption;
            if (editingPackOptionId) {
                const { data } = await api.patch(`/inventory/pack-options/${editingPackOptionId}`, payload);
                savedOption = data;
            } else {
                const { data } = await api.post(`/inventory/products/${product.id}/pack-options`, payload);
                savedOption = data;
            }

            await loadPackOptions();
            setNewLot(prev => {
                const derived = parseInventoryNumberInput(prev.quantity, 0) > 0
                    ? deriveDistributionFromTotalQuantity(prev.quantity, savedOption.id)
                    : { quantity: recalculateNewLotQuantity(prev.packageUnits, prev.partialQuantity, savedOption.id) || prev.quantity };
                return {
                    ...prev,
                    ...derived,
                    packOptionId: savedOption.id
                };
            });
            resetPackEditor();
            setPackEditorOpen(false);
            onChanged?.();
        } catch (error) {
            alert(error.response?.data?.error || 'No se pudo guardar el Pack / Caja');
        } finally {
            setSavingPackOption(false);
        }
    };

    const handleEditPackOption = useCallback((option) => {
        setPackEditorOpen(true);
        setEditingPackOptionId(option.id);
        setPackForm({
            quantity: normalizeInventoryIntegerInput(option.quantity),
            label: option.label || '',
            containerType: option.containerType || 'CAJA',
            isDefault: Boolean(option.isDefault)
        });
    }, []);

    const handleDeletePackOption = async (packOptionId) => {
        if (!window.confirm('¿Ocultar este formato de empaque?')) return;
        setSavingPackOption(true);
        try {
            await api.delete(`/inventory/pack-options/${packOptionId}`);
            await loadPackOptions();
            setNewLot(prev => {
                if (prev.packOptionId !== packOptionId) return prev;
                const preferredOption = packOptions.find(option => option.id !== packOptionId && option.active !== false) || null;
                if (!preferredOption) {
                    return {
                        ...prev,
                        packOptionId: '',
                        packageUnits: '',
                        partialQuantity: '',
                        quantity: prev.quantity
                    };
                }
                const derived = parseInventoryNumberInput(prev.quantity, 0) > 0
                    ? deriveDistributionFromTotalQuantity(prev.quantity, preferredOption.id)
                    : { quantity: recalculateNewLotQuantity(prev.packageUnits, prev.partialQuantity, preferredOption.id) || prev.quantity };
                return {
                    ...prev,
                    ...derived,
                    packOptionId: preferredOption.id
                };
            });
            if (editingPackOptionId === packOptionId) {
                resetPackEditor();
            }
            onChanged?.();
        } catch (error) {
            alert(error.response?.data?.error || 'No se pudo ocultar el Pack / Caja');
        } finally {
            setSavingPackOption(false);
        }
    };

    useEffect(() => {
        if (packOptions.length === 0) return;

        setNewLot(prev => {
            if (!isFinishedProductLike(product) && prev.zone !== 'WAREHOUSE') {
                return { ...prev, zone: 'WAREHOUSE' };
            }
            const currentOptionStillExists = prev.packOptionId
                ? packOptions.some(option => option.id === prev.packOptionId)
                : false;
            const preferredOptionId = currentOptionStillExists
                ? prev.packOptionId
                : (recommendedPackOptionId || packOptions.find(option => option.isDefault)?.id || packOptions[0]?.id || '');

            if (!preferredOptionId) return prev;

            if (parseInventoryNumberInput(prev.quantity, 0) > 0) {
                const derived = deriveDistributionFromTotalQuantity(prev.quantity, preferredOptionId);
                if (
                    derived.packOptionId === prev.packOptionId &&
                    derived.packageUnits === prev.packageUnits &&
                    derived.partialQuantity === prev.partialQuantity
                ) {
                    return prev;
                }
                return { ...prev, ...derived };
            }

            if (preferredOptionId === prev.packOptionId) return prev;
            return { ...prev, packOptionId: preferredOptionId };
        });
    }, [deriveDistributionFromTotalQuantity, packOptions, recommendedPackOptionId]);

    const updatePrintForm = useCallback((updater) => {
        setPreparedPrintJob(null);
        setPrintForm(prev => {
            const next = typeof updater === 'function'
                ? updater(prev)
                : { ...prev, ...updater };
            return {
                ...next,
                retryPreparedJob: false
            };
        });
    }, []);

    const buildPrintRequestPayload = (targetForm) => {
        const explicitPackageQuantities = buildExplicitPackageQuantities({
            quantityPerPackage: targetForm.quantityPerPackage,
            fullPackageCount: targetForm.fullPackageCount,
            partialQuantity: targetForm.partialQuantity
        });
        const appendNewLabels = Boolean(targetForm.appendNewLabels);

        return {
            explicitPackageQuantities,
            payload: {
                quantityPerPackage: parseInventoryNumberInput(targetForm.quantityPerPackage, 0),
                packageCount: explicitPackageQuantities.length === 0 && targetForm.packageCount
                    ? parseInventoryNumberInput(targetForm.packageCount, 0)
                    : null,
                coverLotQuantity: explicitPackageQuantities.length > 0
                    ? !appendNewLabels
                    : Boolean(targetForm.coverLotQuantity),
                appendNewLabels,
                forceRegenerate: Boolean(targetForm.forceRegenerate),
                packOptionId: targetForm.packOptionId || null,
                packageQuantities: explicitPackageQuantities.length > 0 ? explicitPackageQuantities : null
            }
        };
    };

    const executePrintLabels = async (targetLot = printLot, targetForm = printForm, { closeOnSuccess = true } = {}) => {
        if (!targetLot) return false;

        if (zebraRef.current.zebraStatus !== 'connected') {
            await zebraRef.current.recheckNow();
        }

        setPrinting(true);
        let hasPreparedLabelsAvailable = false;
        try {
            if (
                parseInventoryNumberInput(targetForm.partialQuantity, 0) >= parseInventoryNumberInput(targetForm.quantityPerPackage, 0)
                && parseInventoryNumberInput(targetForm.quantityPerPackage, 0) > 0
            ) {
                throw new Error('El parcial debe ser menor a la cantidad por rotulo');
            }

            const canReusePreparedJob = Boolean(
                targetForm.retryPreparedJob
                && preparedPrintJob?.lotId === targetLot.id
                && Array.isArray(preparedPrintJob.labels)
                && preparedPrintJob.labels.length > 0
            );

            let labels = [];
            if (canReusePreparedJob) {
                labels = preparedPrintJob.labels;
                hasPreparedLabelsAvailable = true;
            } else {
                const { payload } = buildPrintRequestPayload(targetForm);
                const { data } = await api.post(`/inventory/lots/${targetLot.id}/package-labels`, payload);
                labels = data.labels || [];
                if (labels.length > 0) {
                    hasPreparedLabelsAvailable = true;
                    setPreparedPrintJob({
                        lotId: targetLot.id,
                        labels
                    });
                }
            }

            if (labels.length === 0) {
                alert('No se generaron rotulos.');
                return false;
            }

            const statusText = product?.classification === 'PRODUCTO_TERMINADO'
                ? 'PRODUCTO TERMINADO'
                : 'MATERIA PRIMA';

            const zpl = labels.map((label) => buildLotLabelZPL({
                productName: product.name,
                sku: product.code || product.sku || '',
                barcode: product.barcode || product.code || product.sku || '',
                packageId: label.packageCode,
                lotNumber: label.lotNumber,
                quantity: label.quantity,
                unit: label.unit,
                receivedAt: label.receivedAt,
                expiresAt: label.expiresAt,
                packContainerType: label.packContainerType,
                boxNumber: label.sequence,
                totalBoxes: label.totalPackages,
                statusText
            }, 1)).join('\n');

            const printResult = await zebraRef.current.printZPL(zpl);
            if (!printResult?.ok) {
                throw new Error(printResult?.error || 'No se pudo imprimir');
            }

            await api.post(`/inventory/lots/${targetLot.id}/print-label`, {
                labelIds: labels.map(label => label.id)
            });

            setPreparedPrintJob(null);
            if (closeOnSuccess) {
                setPrintLot(null);
            }
            await loadLots();
            onChanged?.();
            return true;
        } catch (error) {
            console.error('Error printing labels:', error);
            if (preparedPrintJob?.lotId === targetLot.id || targetForm.retryPreparedJob || hasPreparedLabelsAvailable) {
                setPrintLot(targetLot);
                setPrintForm(prev => ({
                    ...prev,
                    appendNewLabels: false,
                    forceRegenerate: false,
                    sourceMode: 'manual',
                    retryPreparedJob: true
                }));
            }
            alert(error.response?.data?.error || error.message || 'Error al imprimir rotulos');
            return false;
        } finally {
            setPrinting(false);
        }
    };

    const handleAdd = async () => {
        const lotQuantity = effectiveNewLotQuantity;
        if (!newLot.lotNumber.trim() || lotQuantity <= 0) return;
        if (!newLot.expiresAt) {
            alert('La fecha de vencimiento es obligatoria');
            return;
        }
        if (selectedNewLotPerPackage > 0 && parseInventoryNumberInput(newLot.partialQuantity, 0) >= selectedNewLotPerPackage) {
            alert('El parcial debe ser menor a la cantidad por unidad del Pack / Caja');
            return;
        }

        setSaving(true);
        try {
            const { data: createdLot } = await api.post('/inventory/lots', {
                productId: product.id,
                lotNumber: newLot.lotNumber.trim().toUpperCase(),
                quantity: lotQuantity,
                unit,
                zone: newLot.zone,
                receivedAt: newLot.receivedAt || null,
                expiresAt: newLot.expiresAt || null,
                packageCode: newLot.packageCode || null,
                packOptionId: newLot.packOptionId || null,
                enforceUnassignedStock: true
            });

            setNewLot(buildEmptyLotForm(product));
            setRegisteredPackageAlert(null);
            setShowAddForm(false);
            await loadLots();
            onChanged?.();

            if (newLotDistribution && createdLot?.id) {
                const automaticPrintForm = {
                    ...buildDefaultPrintForm(product, packOptions),
                    packOptionId: newLot.packOptionId || '',
                    quantityPerPackage: normalizeInventoryIntegerInput(selectedNewLotPerPackage),
                    fullPackageCount: normalizeInventoryIntegerInput(newLot.packageUnits),
                    partialQuantity: normalizeInventoryIntegerInput(newLot.partialQuantity),
                    packageCount: '',
                    coverLotQuantity: false,
                    appendNewLabels: true,
                    forceRegenerate: false,
                    sourceMode: 'automatic'
                };

                setPrintLot(createdLot);
                setPreparedPrintJob(null);
                setPrintForm(automaticPrintForm);
            }
        } catch (error) {
            alert(error.response?.data?.error || 'Error al crear lote');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (lot) => {
        if (!window.confirm('¿Eliminar este lote? Solo es posible si no tiene consumos ni transferencias.')) return;
        try {
            const endpoint = lot._type === 'MaterialLot'
                ? `/inventory/lots/${lot.id}`
                : `/inventory/finished-lots/${lot.id}`;
            await api.delete(endpoint);
            await loadLots();
            onChanged?.();
        } catch (error) {
            alert(error.response?.data?.error || 'No se puede eliminar');
        }
    };

    const materialZones = [
        { value: 'WAREHOUSE', label: 'Bodega principal' },
        { value: 'PRODUCTION', label: 'Producción' },
        { value: 'CUARENTENA', label: 'Cuarentena' },
        { value: 'NO_CONFORME', label: 'No conforme' },
        { value: 'MAQUILA', label: 'Maquila' },
    ];
    const finishedZones = [
        { value: 'PRODUCCION', label: 'Producción' },
        { value: 'PRODUCTO_TERMINADO', label: 'Producto terminado' },
        { value: 'BODEGA', label: 'Bodega' },
        { value: 'CUARENTENA', label: 'Cuarentena' },
        { value: 'NO_CONFORME', label: 'No conforme' },
        { value: 'MAQUILA', label: 'Maquila' },
        { value: 'PUBLICIDAD', label: 'Publicidad' },
    ];

    const getTransferZoneOptions = (lot) => {
        const zones = lot._type === 'MaterialLot' ? materialZones : finishedZones;
        return zones.filter(z => z.value !== lot.zone);
    };

    const handleTransfer = async (lot) => {
        const qty = parseFloat(transferQty);
        if (!transferZone || !qty || qty <= 0) {
            alert('Selecciona zona destino y cantidad válida');
            return;
        }
        if (qty > lot.currentQuantity) {
            alert(`Cantidad máxima disponible: ${lot.currentQuantity}`);
            return;
        }
        setTransferring(true);
        try {
            await api.post('/inventory/lots/transfer-zone', {
                lotId: lot.id,
                lotType: lot._type,
                targetZone: transferZone,
                quantity: Math.round(qty),
            });
            setTransferLotId(null);
            setTransferZone('');
            setTransferQty('');
            await loadLots();
            onChanged?.();
        } catch (error) {
            alert(error.response?.data?.error || 'Error en transferencia');
        }
        setTransferring(false);
    };

    const buildRegisteredPackageAlert = useCallback((scan, packageLabel = null, fallbackMessage = '') => ({
        packageCode: packageLabel?.packageCode || scan?.packageId || scan?.packageCode || '',
        lotNumber: packageLabel?.lotNumber || scan?.lotNumber || '',
        productName: packageLabel?.productName || getProductName(),
        quantity: packageLabel?.quantity || scan?.quantity || scan?.unitsPerBox || null,
        unit: packageLabel?.unit || unit,
        message: fallbackMessage || 'Este ID unico ya estaba registrado. Puedes reimprimirlo o anularlo antes de volver a ingresar el empaque.',
        packageLabel: packageLabel || null
    }), [product, unit]);

    const findRegisteredPackage = useCallback(async (scan) => {
        if (!scan?.packageId && !scan?.packageCode) return null;
        if (scan.packageDuplicate) {
            return buildRegisteredPackageAlert(scan, scan.duplicatePackageLabel);
        }

        const packageCode = scan.packageId || scan.packageCode;
        try {
            const { data } = await api.post('/inventory/package-labels/validate-scan', {
                packageCode,
                recordScan: false
            });
            return buildRegisteredPackageAlert(scan, data.packageLabel);
        } catch (error) {
            if (error.response?.status === 404) return null;
            return buildRegisteredPackageAlert(scan, error.response?.data?.packageLabel, error.response?.data?.error || 'No se pudo validar el ID unico.');
        }
    }, [buildRegisteredPackageAlert]);

    const handleVoidRegisteredPackage = async () => {
        if (!registeredPackageAlert?.packageCode) return;
        if (!window.confirm(`¿Anular el ID ${registeredPackageAlert.packageCode}?`)) return;

        setVoidingPackage(true);
        try {
            const label = registeredPackageAlert.packageLabel || null;
            const restoredPackOption = label?.packOptionId || '';
            const restoredPerPackage = Number(label?.packUnitQuantity || 0);
            const restoredQuantity = Number(label?.quantity || 0);
            const restoredUnits = restoredPerPackage > 0 && restoredQuantity >= restoredPerPackage
                ? Math.floor(restoredQuantity / restoredPerPackage)
                : 0;
            const restoredPartial = restoredPerPackage > 0
                ? Math.max(restoredQuantity - (restoredUnits * restoredPerPackage), 0)
                : 0;

            await api.delete(`/inventory/package-labels/${registeredPackageAlert.packageCode}`);
            setRegisteredPackageAlert(null);
            await loadLots();
            setLotTab('active');
            setExpandedLot(null);
            setShowAddForm(true);
            setNewLot(prev => ({
                ...buildEmptyLotForm(product),
                lotNumber: label?.lotNumber || prev.lotNumber,
                quantity: restoredQuantity > 0 ? String(restoredQuantity) : prev.quantity,
                packageUnits: restoredUnits > 0 ? String(restoredUnits) : '',
                partialQuantity: restoredPartial > 0 ? String(restoredPartial) : '',
                packOptionId: restoredPackOption,
                receivedAt: label?.receivedAt ? new Date(label.receivedAt).toISOString().slice(0, 10) : prev.receivedAt,
                expiresAt: label?.expiresAt ? new Date(label.expiresAt).toISOString().slice(0, 10) : prev.expiresAt,
                zone: label?.zone || prev.zone
            }));
            onChanged?.();
        } catch (error) {
            alert(error.response?.data?.error || 'No se pudo anular el ID');
        } finally {
            setVoidingPackage(false);
        }
    };

    const applyIncomingScan = useCallback(async (scan) => {
        if (!scan) return;

        const registeredPackage = await findRegisteredPackage(scan);
        if (registeredPackage) {
            setRegisteredPackageAlert(registeredPackage);
            setShowAddForm(false);
            const matchingLot = lots.find(lot => lot.lotNumber === registeredPackage.lotNumber);
            if (matchingLot) {
                setLotTab('active');
                setExpandedLot(matchingLot.id);
            }
            return;
        }

        const scannedQuantity = resolveScannedQuantity({
            scan,
            product,
            fallback: null
        }) || 0;
        const inferredDistribution = deriveDistributionFromTotalQuantity(scannedQuantity);

        const toDateInput = (value) => {
            if (!value) return '';
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
        };

        setRegisteredPackageAlert(null);
        setLotTab('active');
        setExpandedLot(null);
        setShowAddForm(true);
        setNewLot(prev => ({
            ...prev,
            lotNumber: scan.lotNumber || prev.lotNumber,
            quantity: scannedQuantity > 0 ? inferredDistribution.quantity : prev.quantity,
            packageUnits: scannedQuantity > 0 ? inferredDistribution.packageUnits : prev.packageUnits,
            partialQuantity: scannedQuantity > 0 ? inferredDistribution.partialQuantity : prev.partialQuantity,
            packageCode: scan.packageCode || scan.packageId || prev.packageCode,
            receivedAt: toDateInput(scan.receivedAt) || prev.receivedAt,
            expiresAt: toDateInput(scan.expirationDate) || prev.expiresAt,
            zone: prev.zone,
            packOptionId: scannedQuantity > 0 ? inferredDistribution.packOptionId : prev.packOptionId
        }));
    }, [deriveDistributionFromTotalQuantity, findRegisteredPackage, lots]);

    const toggleHistory = async (lot) => {
        if (expandedLot === lot.id) {
            setExpandedLot(null);
            return;
        }

        setExpandedLot(lot.id);
        if (lot._type !== 'MaterialLot') return;

        if (!lotHistory[lot.id]) {
            try {
                const res = await api.get(`/inventory/lots/${lot.id}/history`);
                setLotHistory(prev => ({ ...prev, [lot.id]: res.data.consumptions || [] }));
            } catch (error) {
                console.error('Error loading history:', error);
            }
        }
    };

    const openPrintModal = (lot) => {
        setPreparedPrintJob(null);
        setPrintLot(lot);
        setPrintForm(buildDefaultPrintForm(product, packOptions));
    };

    const handlePrintLabels = async () => {
        await executePrintLabels(printLot, printForm, { closeOnSuccess: true });
    };

    useEffect(() => {
        if (!initialScan) return;
        setScanToApply(initialScan);
    }, [initialScan]);

    useEffect(() => {
        if (!scanToApply || loading || !packOptionsReady) return undefined;

        let cancelled = false;
        const run = async () => {
            try {
                await applyIncomingScan(scanToApply);
            } finally {
                if (!cancelled) {
                    setScanToApply(null);
                    onScanConsumed?.();
                }
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [applyIncomingScan, loading, onScanConsumed, packOptionsReady, scanToApply]);

    if (!product) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-2rem)] max-w-4xl flex flex-col overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-4 sm:p-5 text-white flex justify-between items-start gap-3 flex-shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base sm:text-lg font-extrabold leading-tight break-words">Lotes - {product.name}</h2>
                        <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-[10px] sm:text-xs">
                            <span className="bg-white/20 px-2 py-0.5 rounded">{product.code}</span>
                            <span className="bg-white/20 px-2 py-0.5 rounded">Stock Siigo: {fmtQty(totalStock)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 border-b flex-shrink-0">
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Asignado a Lotes</div>
                        <div className="text-lg font-black text-indigo-700">{fmtQty(totalAssigned)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Disponible en Lotes</div>
                        <div className="text-lg font-black text-green-700">{fmtQty(totalRemaining)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Sin Asignar</div>
                        <div className={`text-lg font-black ${unassigned > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{fmtQty(unassigned)}</div>
                    </div>
                </div>

                <div className="flex gap-1 px-3 sm:px-4 pt-3 pb-0 flex-shrink-0 overflow-x-auto">
                    <button onClick={() => setLotTab('active')} className={`px-3 py-1.5 rounded-t-lg text-xs font-bold transition-all ${lotTab === 'active' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        Activos ({lots.filter(lot => lot.currentQuantity > 0).length})
                    </button>
                    <button onClick={() => setLotTab('depleted')} className={`px-3 py-1.5 rounded-t-lg text-xs font-bold transition-all ${lotTab === 'depleted' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        Agotados ({lots.filter(lot => lot.currentQuantity <= 0).length})
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 pt-2 space-y-3">
                    {registeredPackageAlert && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            <div className="font-bold">ID único ya registrado</div>
                            <div className="mt-1">{registeredPackageAlert.message}</div>
                            <div className="mt-2 text-xs text-amber-800">
                                {registeredPackageAlert.packageCode} · Lote {registeredPackageAlert.lotNumber || 'N/A'}
                                {registeredPackageAlert.quantity ? ` · ${registeredPackageAlert.quantity} ${registeredPackageAlert.unit || unit}` : ''}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    onClick={() => setRegisteredPackageAlert(null)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-amber-200 text-amber-900"
                                >
                                    Cerrar
                                </button>
                                <button
                                    onClick={handleVoidRegisteredPackage}
                                    disabled={voidingPackage}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-700 text-white disabled:opacity-50"
                                >
                                    {voidingPackage ? 'Anulando...' : 'Anular ID'}
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="text-center py-8 text-gray-400">Cargando lotes...</div>
                    ) : lots.length === 0 ? (
                        <div className="text-center py-8">
                            <Package className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p className="text-gray-500 font-medium">No hay lotes registrados</p>
                            <p className="text-gray-400 text-sm">Agrega el primer lote para iniciar la trazabilidad</p>
                        </div>
                    ) : (
                        lots
                            .filter(lot => lotTab === 'active' ? lot.currentQuantity > 0 : lot.currentQuantity <= 0)
                            .map(lot => {
                                const pct = lot.initialQuantity > 0 ? Math.round((lot.currentQuantity / lot.initialQuantity) * 100) : 0;
                                const isExpanded = expandedLot === lot.id;
                                const history = lotHistory[lot.id] || [];

                                return (
                                    <div key={`${lot._type}_${lot.id}`} className={`border rounded-xl overflow-hidden transition-all ${lot.currentQuantity <= 0 ? 'opacity-60' : ''}`}>
                                        <div className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer" onClick={() => toggleHistory(lot)}>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-gray-900">{lot.lotNumber}</span>
                                                    {getStatusBadge(lot.status, lot.currentQuantity, lot.initialQuantity)}
                                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-50 text-slate-600 border">{lot.zone || 'WAREHOUSE'}</span>
                                                    {lot.labelPrinted && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Impreso</span>}
                                                </div>
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    Recibido: {lot.receivedAt ? new Date(lot.receivedAt).toLocaleDateString('es-CO') : 'N/A'} · Inicial: {fmtQty(lot.initialQuantity)}
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <div className="text-lg font-black text-gray-800">{fmtQty(lot.currentQuantity)}</div>
                                                <div className="w-20 h-1.5 bg-gray-200 rounded-full mt-1">
                                                    <div
                                                        className={`h-full rounded-full ${pct > 30 ? 'bg-green-500' : pct > 10 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1">
                                                {lot.currentQuantity > 0 && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTransferLotId(transferLotId === lot.id ? null : lot.id);
                                                            setTransferZone('');
                                                            setTransferQty('');
                                                        }}
                                                        className={`p-1.5 rounded-lg transition-colors ${transferLotId === lot.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-blue-50 text-gray-400 hover:text-blue-600'}`}
                                                        title="Transferir a otra zona"
                                                    >
                                                        <ArrowRightLeft className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {lot.currentQuantity > 0 && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openPrintModal(lot);
                                                        }}
                                                        className="p-1.5 hover:bg-indigo-50 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors"
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {(lot._type === 'MaterialLot' ? lot._count?.consumptions === 0 : lot._count?.transfers === 0) && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDelete(lot);
                                                        }}
                                                        className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                            </div>
                                        </div>

                                        {transferLotId === lot.id && (
                                            <div className="bg-blue-50 border-t border-blue-200 p-3" onClick={e => e.stopPropagation()}>
                                                <div className="text-xs font-bold text-blue-700 uppercase mb-2">Transferir a otra zona</div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <select
                                                        value={transferZone}
                                                        onChange={e => setTransferZone(e.target.value)}
                                                        className="flex-1 min-w-[140px] text-sm border border-blue-300 rounded-lg px-2 py-1.5 bg-white"
                                                    >
                                                        <option value="">Zona destino...</option>
                                                        {getTransferZoneOptions(lot).map(z => (
                                                            <option key={z.value} value={z.value}>{z.label}</option>
                                                        ))}
                                                    </select>
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            placeholder="Cantidad"
                                                            value={transferQty}
                                                            onChange={e => setTransferQty(e.target.value)}
                                                            min={1}
                                                            max={lot.currentQuantity}
                                                            className="w-28 text-sm border border-blue-300 rounded-lg px-2 py-1.5"
                                                        />
                                                        <button
                                                            onClick={() => setTransferQty(String(lot.currentQuantity))}
                                                            className="text-[10px] px-1.5 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                                                        >
                                                            Todo
                                                        </button>
                                                    </div>
                                                    <button
                                                        onClick={() => handleTransfer(lot)}
                                                        disabled={transferring || !transferZone || !transferQty}
                                                        className="px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {transferring ? 'Transfiriendo...' : 'Transferir'}
                                                    </button>
                                                    <button
                                                        onClick={() => setTransferLotId(null)}
                                                        className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                                <div className="text-[10px] text-blue-500 mt-1">
                                                    Disponible: {fmtQty(lot.currentQuantity)} {unit}
                                                </div>
                                            </div>
                                        )}

                                        {isExpanded && (
                                            <div className="bg-gray-50 border-t p-3">
                                                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Historial</div>
                                                {lot._type !== 'MaterialLot' ? (
                                                    <div className="text-xs text-gray-400 py-2">Este lote no usa historial de consumos manuales.</div>
                                                ) : history.length === 0 ? (
                                                    <div className="text-xs text-gray-400 py-2">Sin consumos registrados</div>
                                                ) : (
                                                    <div className="space-y-1.5 max-h-40 overflow-auto">
                                                        {history.map(item => (
                                                            <div key={item.id} className="flex items-center gap-2 text-xs bg-white p-2 rounded-lg border">
                                                                <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                                <span className="text-gray-500">{new Date(item.usedAt).toLocaleString('es-CO')}</span>
                                                                <span className="font-bold text-red-600">-{fmtQty(item.quantityUsed)}</span>
                                                                <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                                <span className="text-gray-700">{item.usedBy?.name || 'N/A'}</span>
                                                                {item.observations && <span className="text-gray-400 truncate">({item.observations})</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                    )}
                </div>

                <div className="border-t bg-gray-50 flex-shrink-0 max-h-[56dvh] sm:max-h-[48dvh] overflow-y-auto overscroll-contain p-3 sm:p-4 pb-0">
                    {showAddForm ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                <div className={showPhysicalUnitInputs ? 'md:col-span-2' : 'md:col-span-3'}>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">N° Lote</label>
                                    <DeferredInput
                                        value={newLot.lotNumber}
                                        onCommit={(val) => setNewLot(prev => ({ ...prev, lotNumber: val }))}
                                        onScan={applyIncomingScan}
                                        placeholder="Ej: LOTE-2026-001"
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold uppercase focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>

                                {showPhysicalUnitInputs && (
                                    <div className="md:col-span-2">
                                        <label className="text-[10px] font-bold text-indigo-500 uppercase block mb-1">{selectedNewLotContainerLabel}</label>
                                        <DeferredInput
                                            value={newLot.packageUnits}
                                            onCommit={(val) => applyDistributionToNewLot({ packageUnits: normalizeInventoryIntegerInput(val) })}
                                            className="w-full px-3 py-2.5 border-2 border-indigo-300 bg-indigo-50 rounded-lg text-sm font-black text-center text-indigo-700 focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                        />
                                    </div>
                                )}

                                <div className={showPhysicalUnitInputs ? 'md:col-span-2' : 'md:col-span-3'}>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Cantidad</label>
                                    <DeferredInput
                                        value={newLot.quantity}
                                        onCommit={(val) => {
                                            const quantity = normalizeInventoryIntegerInput(val);
                                            setNewLot(prev => ({
                                                ...prev,
                                                ...deriveDistributionFromTotalQuantity(quantity, prev.packOptionId)
                                            }));
                                        }}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Recibido</label>
                                    <input
                                        type="date"
                                        value={newLot.receivedAt}
                                        onChange={(e) => setNewLot(prev => ({ ...prev, receivedAt: e.target.value }))}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase">Vence</label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const d = new Date();
                                                d.setFullYear(d.getFullYear() + 1);
                                                setNewLot(prev => ({ ...prev, expiresAt: d.toISOString().slice(0, 10) }));
                                            }}
                                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                        >+1 año</button>
                                    </div>
                                    <input
                                        type="date"
                                        value={newLot.expiresAt}
                                        onChange={(e) => setNewLot(prev => ({ ...prev, expiresAt: e.target.value }))}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>

                                <div className={showPhysicalUnitInputs ? 'md:col-span-2' : 'md:col-span-2'}>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                        {isFinishedProductLike(product) ? 'Bodega destino' : 'Ubicación inicial'}
                                    </label>
                                    <select
                                        value={newLot.zone}
                                        onChange={(e) => setNewLot(prev => ({ ...prev, zone: e.target.value }))}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    >
                                        {initialLotZoneOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    {!isFinishedProductLike(product) && (
                                        <div className="mt-1 text-[10px] font-semibold text-slate-500">
                                            Registra el lote en bodega y luego usa transferir para enviarlo a producción.
                                        </div>
                                    )}
                                </div>

                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Parcial</label>
                                    <DeferredInput
                                        value={newLot.partialQuantity}
                                        onCommit={(val) => applyDistributionToNewLot({ partialQuantity: normalizeInventoryIntegerInput(val) })}
                                        placeholder="Opcional"
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="text-[10px] font-bold uppercase text-slate-500">Origen Siigo</div>
                                    {sourceWarehouses.length === 0 ? (
                                        <div className="mt-2 text-xs text-slate-500">Sin bodegas reportadas por Siigo para este producto.</div>
                                    ) : (
                                        <div className="mt-2 space-y-1.5">
                                            {sourceWarehouses.map(warehouse => (
                                                <div key={warehouse.id} className="flex items-center justify-between gap-2 text-xs">
                                                    <span className="font-semibold text-slate-700">{warehouse.name}</span>
                                                    <span className="text-slate-500">{fmtQty(warehouse.quantity)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                                    <div className="text-[10px] font-bold uppercase text-indigo-600">Zona interna del lote</div>
                                    <div className="mt-2 text-sm font-black text-indigo-900">
                                        {selectedDestinationZone?.label || newLot.zone}
                                    </div>
                                    <div className="mt-1 text-xs text-indigo-700">
                                        {selectedDestinationZone?.description || 'Destino operativo controlado por el flujo interno de la app.'}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase text-slate-500">Formatos de empaque</div>
                                        <div className="mt-1 text-xs text-slate-600">
                                            {packSummary.totalFormats > 0
                                                ? `${packSummary.totalFormats} formato(s) guardado(s) · ${packSummary.totalActivePackages} ID(s) activos · ${packSummary.totalUnits} unidad(es) completas posibles con el stock actual`
                                                : 'Sin formatos guardados. Puedes crear uno sin salir de este ingreso.'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setPackEditorOpen(prev => !prev);
                                            if (!packEditorOpen) resetPackEditor();
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
                                    >
                                        {packEditorOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        {packEditorOpen ? 'Ocultar' : 'Expandir'}
                                    </button>
                                </div>

                                <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
                                    <div className="md:col-span-7">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Formato Pack / Caja</label>
                                        <select
                                            value={newLot.packOptionId}
                                            onChange={(e) => {
                                                const packOptionId = e.target.value;
                                                setNewLot(prev => {
                                                    const derived = parseInventoryNumberInput(prev.quantity, 0) > 0
                                                        ? deriveDistributionFromTotalQuantity(prev.quantity, packOptionId)
                                                        : { quantity: recalculateNewLotQuantity(prev.packageUnits, prev.partialQuantity, packOptionId) || prev.quantity };
                                                    return {
                                                        ...prev,
                                                        ...derived,
                                                        packOptionId
                                                    };
                                                });
                                            }}
                                            className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                        >
                                            <option value="">Sin formato específico</option>
                                            {packOptions.map(option => (
                                                <option key={option.id} value={option.id}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="md:col-span-5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                                        <div className="text-[9px] font-bold uppercase text-slate-400">Resumen activo</div>
                                        <div className="mt-1 text-xs font-bold text-slate-900 break-words">
                                            {selectedNewLotPackOption?.label || packSummary.defaultOption?.label || 'Sin formato seleccionado'}
                                        </div>
                                        <div className="mt-1 text-[11px] text-slate-600">
                                            {selectedNewLotPackOption
                                                ? `${selectedNewLotPackOption.quantity} ${unit} por unidad · ${selectedNewLotPackOption.containerType || 'Sin tipo'}`
                                                : 'Selecciona un formato para calcular bultos, cajas y parciales correctamente.'}
                                        </div>
                                    </div>
                                </div>

                                {packEditorOpen && (
                                    <div className="mt-3 space-y-3">
                                        <div className="space-y-2">
                                            {packOptionSummaries.length === 0 ? (
                                                <div className="text-xs text-slate-500">Sin formatos guardados todavía.</div>
                                            ) : packOptionSummaries.map(option => (
                                                <div key={option.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                    <div className="flex items-start gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-bold text-slate-900 break-words">{option.label}</span>
                                                                {option.isDefault && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">Default</span>}
                                                                {option.isMostUsed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">Más usado</span>}
                                                            </div>
                                                            <div className="mt-1 text-[11px] text-slate-600">
                                                                {option.quantity} {unit} por unidad · {option.containerType || 'Sin tipo'} · {option.usageCount || 0} registro(s)
                                                            </div>
                                                        </div>
                                                        <button onClick={() => handleEditPackOption(option)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button onClick={() => handleDeletePackOption(option.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>

                                                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                        <div className="rounded-lg border border-white bg-white px-3 py-2">
                                                            <div className="text-[9px] font-bold uppercase text-slate-400">IDs activos</div>
                                                            <div className="mt-1 text-base font-black text-slate-900">{option.activeCount || 0}</div>
                                                        </div>
                                                        <div className="rounded-lg border border-white bg-white px-3 py-2">
                                                            <div className="text-[9px] font-bold uppercase text-slate-400">Cantidad activa</div>
                                                            <div className="mt-1 text-xs font-black text-slate-900">
                                                                {fmtQty(option.activeQuantity || 0)}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-lg border border-white bg-white px-3 py-2">
                                                            <div className="text-[9px] font-bold uppercase text-slate-400">Unidades completas</div>
                                                            <div className="mt-1 text-base font-black text-slate-900">{option.coverage.fullUnits}</div>
                                                        </div>
                                                        <div className="rounded-lg border border-white bg-white px-3 py-2">
                                                            <div className="text-[9px] font-bold uppercase text-slate-400">Suelto</div>
                                                            <div className="mt-1 text-xs font-black text-slate-900">
                                                                {fmtQty(option.coverage.loose)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                                <div className="sm:col-span-4">
                                                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Cantidad</label>
                                                    <input
                                                        type="text"
                                                        value={packForm.quantity}
                                                        onChange={(e) => handlePackFormChange('quantity', e.target.value)}
                                                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs text-center font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                                    />
                                                </div>
                                                <div className="sm:col-span-4">
                                                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Contenedor</label>
                                                    <select
                                                        value={packForm.containerType}
                                                        onChange={(e) => handlePackFormChange('containerType', e.target.value)}
                                                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                                    >
                                                        {PACK_CONTAINER_OPTIONS.map(option => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="sm:col-span-4">
                                                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Alias</label>
                                                    <input
                                                        type="text"
                                                        value={packForm.label}
                                                        onChange={(e) => handlePackFormChange('label', e.target.value)}
                                                        placeholder="Opcional"
                                                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                                    />
                                                </div>
                                            </div>

                                            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 font-medium">
                                                    <input
                                                        type="checkbox"
                                                        checked={packForm.isDefault}
                                                        onChange={(e) => setPackForm(prev => ({ ...prev, isDefault: e.target.checked }))}
                                                    />
                                                    Usar como pack por defecto
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    {editingPackOptionId && (
                                                        <button onClick={() => resetPackEditor()} className="px-2.5 py-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg">
                                                            Cancelar
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={handleSavePackOption}
                                                        disabled={savingPackOption}
                                                        className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                                                    >
                                                        {editingPackOptionId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                                                        {savingPackOption ? 'Guardando...' : (editingPackOptionId ? 'Actualizar' : 'Guardar')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {(showPhysicalUnitInputs && (newLot.packageUnits || newLot.partialQuantity)) && (
                                <div className="flex items-center gap-2 text-xs bg-indigo-50 border border-indigo-200 p-2 rounded-lg text-indigo-700 font-medium">
                                    <Package className="w-4 h-4 flex-shrink-0" />
                                    {(newLotDistribution?.label) || 'Sin distribución'} = <strong>{fmtQty(newLot.quantity)}</strong>
                                </div>
                            )}

                            {newLot.partialQuantity && (
                                <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 p-2 rounded-lg text-amber-800">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    El parcial se registra como una unidad física independiente del mismo lote y saldrá con su propio ID único en la impresión.
                                </div>
                            )}

                            {newLot.packageCode && (
                                <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 p-2 rounded-lg text-slate-700">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    Codigo escaneado: <strong>{newLot.packageCode}</strong>
                                </div>
                            )}

                            {effectiveNewLotQuantity > unassigned && (
                                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    La cantidad excede el stock sin asignar ({fmtQty(unassigned)})
                                </div>
                            )}

                            {!newLot.expiresAt && (
                                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    La fecha de vencimiento es obligatoria para guardar y reutilizar este lote en QR e impresión.
                                </div>
                            )}

                            <div className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 mt-3 px-3 sm:px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-gray-50/95 backdrop-blur border-t border-gray-200 shadow-[0_-8px_18px_rgba(15,23,42,0.08)] flex flex-col-reverse sm:flex-row gap-2 justify-end">
                                <button
                                    onClick={() => {
                                        setShowAddForm(false);
                                        setNewLot(buildEmptyLotForm(product));
                                    }}
                                    className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleAdd}
                                    disabled={saving || !newLot.lotNumber || !newLot.expiresAt || effectiveNewLotQuantity <= 0 || effectiveNewLotQuantity > unassigned}
                                    className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {saving ? 'Guardando...' : 'Guardar Lote'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowAddForm(true)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-indigo-300 rounded-xl text-indigo-600 font-bold text-sm hover:bg-indigo-50 transition-colors"
                        >
                            <Plus className="w-4 h-4" /> Agregar Lote
                        </button>
                    )}
                </div>
            </div>

            {printLot && (
                <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
                    <div className="w-full h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-2rem)] max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-4 sm:px-5 py-3 border-b flex items-center justify-between flex-shrink-0">
                            <div>
                                <div className="text-sm font-black text-gray-900">
                                    {printForm.sourceMode === 'automatic' ? 'Impresion automatica de etiquetas' : 'Generar etiquetas del lote'}
                                </div>
                                <div className="text-xs text-gray-500 break-words">{printLot.lotNumber} · {fmtQty(printLot.currentQuantity)}</div>
                            </div>
                            <button onClick={() => setPrintLot(null)} className="p-2 rounded-lg hover:bg-gray-100">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-3 sm:p-4 space-y-3 overflow-y-auto flex-1 min-h-0 overscroll-contain">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Resumen listo para imprimir</div>
                                        <div className="text-sm font-black text-slate-900">{getProductName()}</div>
                                    </div>
                                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${printForm.sourceMode === 'automatic' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                        {printForm.sourceMode === 'automatic' ? 'Flujo automático' : 'Ajuste manual'}
                                    </span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-lg border bg-white px-3 py-2">
                                        <div className="font-bold uppercase text-[10px] text-gray-500">Lote actual</div>
                                        <div className="mt-1 font-black text-gray-900">{fmtQty(printLot.currentQuantity)}</div>
                                    </div>
                                    <div className="rounded-lg border bg-white px-3 py-2">
                                        <div className="font-bold uppercase text-[10px] text-gray-500">Formato activo</div>
                                        <div className="mt-1 font-black text-gray-900 break-words">
                                            {selectedPrintPackOption?.label || 'Sin formato guardado'}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-3 text-xs text-slate-700">
                                    {hasExplicitPrintDistribution
                                        ? `Se imprimirán ${printDistribution.quantities.length} etiqueta(s): ${printDistribution.label}.`
                                        : 'Puedes usar el formato guardado del producto o ajustar manualmente la cantidad de etiquetas.'}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Formato</label>
                                    <select
                                        value={printForm.packOptionId}
                                        onChange={(e) => {
                                            const selected = packOptions.find(option => option.id === e.target.value);
                                            updatePrintForm(prev => ({
                                                ...prev,
                                                packOptionId: e.target.value,
                                                quantityPerPackage: normalizeInventoryIntegerInput(selected?.quantity || prev.quantityPerPackage)
                                            }));
                                        }}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    >
                                        <option value="">Sin formato guardado</option>
                                        {packOptions.map(option => (
                                            <option key={option.id} value={option.id}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cantidad por rotulo</label>
                                    <input
                                        type="text"
                                        value={printForm.quantityPerPackage}
                                        onChange={(e) => updatePrintForm(prev => ({ ...prev, quantityPerPackage: normalizeInventoryIntegerInput(e.target.value) }))}
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Unidades completas</label>
                                    <input
                                        type="text"
                                        value={printForm.fullPackageCount}
                                        onChange={(e) => updatePrintForm(prev => ({ ...prev, fullPackageCount: normalizeInventoryIntegerInput(e.target.value) }))}
                                        placeholder="Ej: 2"
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Parcial opcional</label>
                                    <input
                                        type="text"
                                        value={printForm.partialQuantity}
                                        onChange={(e) => updatePrintForm(prev => ({ ...prev, partialQuantity: normalizeInventoryIntegerInput(e.target.value) }))}
                                        placeholder="Ej: 20000"
                                        className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 p-3 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Opciones de impresión</div>
                                {!hasExplicitPrintDistribution && (
                                    <>
                                        <label className="flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={printForm.coverLotQuantity}
                                                onChange={(e) => updatePrintForm(prev => ({ ...prev, coverLotQuantity: e.target.checked }))}
                                            />
                                            Cubrir todo el lote con el formato seleccionado
                                        </label>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cantidad manual de etiquetas</label>
                                            <input
                                                type="text"
                                                value={printForm.packageCount}
                                                onChange={(e) => updatePrintForm(prev => ({ ...prev, packageCount: normalizeInventoryIntegerInput(e.target.value) }))}
                                                placeholder="Solo si no cubre todo el lote"
                                                className="w-full px-3 py-2.5 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
                                            />
                                        </div>
                                    </>
                                )}
                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={printForm.appendNewLabels}
                                        onChange={(e) => updatePrintForm(prev => ({
                                            ...prev,
                                            appendNewLabels: e.target.checked,
                                            forceRegenerate: e.target.checked ? false : prev.forceRegenerate
                                        }))}
                                    />
                                    Agregar etiquetas nuevas sin borrar las existentes
                                </label>
                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={printForm.forceRegenerate}
                                        onChange={(e) => updatePrintForm(prev => ({
                                            ...prev,
                                            forceRegenerate: e.target.checked,
                                            appendNewLabels: e.target.checked ? false : prev.appendNewLabels
                                        }))}
                                    />
                                    Regenerar los IDs de este lote desde cero
                                </label>
                            </div>

                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                                {printForm.retryPreparedJob
                                    ? 'Los IDs ya quedaron generados en la base. Solo falta reimprimir esta misma tanda sin crear etiquetas nuevas.'
                                    : printForm.sourceMode === 'automatic'
                                    ? 'El lote ya quedó enlazado. El sistema genera los IDs únicos por unidad física, imprime y luego marca los rótulos como impresos.'
                                    : 'Usa este panel para reimprimir, completar etiquetas faltantes o regenerar IDs únicos sin romper la trazabilidad del lote.'}
                            </div>

                            {printLot?.labelPrinted && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    Este lote ya tenía rótulos impresos. Revisa si quieres agregar nuevas etiquetas o regenerar completamente sus IDs únicos.
                                </div>
                            )}
                        </div>

                        <div className="px-4 sm:px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t bg-gray-50 flex flex-col-reverse sm:flex-row justify-end gap-2 flex-shrink-0">
                            <button onClick={() => setPrintLot(null)} className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg">
                                Cerrar
                            </button>
                            <button
                                onClick={handlePrintLabels}
                                disabled={printing || !printForm.quantityPerPackage}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                            >
                                <Printer className="w-4 h-4" />
                                {printing ? 'Imprimiendo...' : (printForm.retryPreparedJob ? 'Reintentar impresión' : 'Generar e imprimir')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(LotManagementModal);
