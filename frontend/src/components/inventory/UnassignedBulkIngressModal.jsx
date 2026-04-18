import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardList,
    Save,
    ScanLine,
    ShieldCheck,
    Trash2,
    Warehouse,
    X
} from 'lucide-react';
import api from '../../services/api';
import { parseScanInput, resolveScannedQuantity } from '../../services/scannerParser';
import {
    normalizeInventoryIntegerInput,
    parseInventoryNumberInput
} from '../../utils/inventoryNumberInput';

const INTERNAL_DESTINATION_OPTIONS = [
    { value: 'PRODUCTO_TERMINADO', label: 'Producto terminado', description: 'Ingreso principal organizado y listo para inventario.' },
    { value: 'PRODUCCION', label: 'Produccion', description: 'Separado para uso inmediato dentro del proceso.' },
    { value: 'CUARENTENA', label: 'Cuarentena', description: 'Pendiente de validacion, control o liberacion.' },
    { value: 'NO_CONFORME', label: 'No conforme', description: 'Separado por novedad o rechazo.' },
    { value: 'MAQUILA', label: 'Maquila', description: 'Material o producto reservado para tercero.' },
    { value: 'PUBLICIDAD', label: 'Publicidad', description: 'Reservado para uso promocional.' }
];

const DEFAULT_TARGET_ZONE = 'PRODUCTO_TERMINADO';

const normalizeText = (value) => String(value || '').trim();

const normalizeWarehouseName = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

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

    return parsed.map((warehouse, index) => ({
        id: String(warehouse?.id ?? index),
        name: String(warehouse?.name || '').trim(),
        quantity: Number(warehouse?.quantity || 0)
    })).filter(warehouse => warehouse.name);
};

const getSourceQuantity = (product, sourceWarehouseName) => {
    const target = normalizeWarehouseName(sourceWarehouseName);
    return parseWarehouseList(product?.warehouses).reduce((sum, warehouse) => {
        const current = normalizeWarehouseName(warehouse.name);
        const matches = target.includes('SIN ASIGNAR')
            ? current.includes('SIN ASIGNAR')
            : current === target;
        return matches ? sum + Number(warehouse.quantity || 0) : sum;
    }, 0);
};

const deriveExpirationFromLot = (lotNumber) => {
    const cleanLotNumber = String(lotNumber || '').trim().toUpperCase();
    const match = cleanLotNumber.match(/^(\d{2})(\d{2})(\d{2})/);
    if (!match) return '';

    const year = 2000 + Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10) - 1;
    const day = Number.parseInt(match[3], 10);
    const manufacturingDate = new Date(Date.UTC(year, month, day));

    if (
        manufacturingDate.getUTCFullYear() !== year ||
        manufacturingDate.getUTCMonth() !== month ||
        manufacturingDate.getUTCDate() !== day
    ) {
        return '';
    }

    const expirationDate = new Date(manufacturingDate);
    expirationDate.setUTCFullYear(expirationDate.getUTCFullYear() + 1);
    return expirationDate.toISOString().slice(0, 10);
};

const formatQuantity = (value, unit = 'und') => `${(Number(value) || 0).toLocaleString('es-CO')} ${unit}`;
const todayInput = () => new Date().toISOString().slice(0, 10);

const getRowQuantityPerUnit = (row) => parseInventoryNumberInput(row.quantityPerUnit, 0);
const getRowUnits = (row) => parseInventoryNumberInput(row.units, 0);
const getRowTotal = (row) => getRowQuantityPerUnit(row) * getRowUnits(row);

const buildEmptyNotice = () => ({ type: '', message: '' });
const inferSingleUnit = (items = [], fallback = 'und') => {
    const units = [...new Set(items.map(item => normalizeText(item?.unit)).filter(Boolean))];
    return units.length === 1 ? units[0] : fallback;
};

const UnassignedBulkIngressModal = ({ context, products, onClose, onCompleted }) => {
    const scanInputRef = useRef(null);
    const resultSectionRef = useRef(null);
    const [scanValue, setScanValue] = useState('');
    const [targetZone, setTargetZone] = useState(DEFAULT_TARGET_ZONE);
    const [rows, setRows] = useState([]);
    const [notice, setNotice] = useState(buildEmptyNotice());
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState(null);
    const [availabilityByProduct, setAvailabilityByProduct] = useState({});
    const [availabilityLoading, setAvailabilityLoading] = useState(false);

    const eligibleProducts = useMemo(() => {
        const normalizedGroup = normalizeText(context?.groupName);
        return (products || []).filter(product => normalizeText(product.group) === normalizedGroup);
    }, [context?.groupName, products]);

    const eligibleProductById = useMemo(() => (
        new Map(eligibleProducts.map(product => [product.id, product]))
    ), [eligibleProducts]);

    const eligibleProductMap = useMemo(() => {
        const map = new Map();
        eligibleProducts.forEach(product => {
            const code = normalizeText(product.code).toUpperCase();
            const barcode = normalizeText(product.barcode);

            if (code) map.set(`SKU:${code}`, product);
            if (barcode) {
                map.set(`BAR:${barcode}`, product);
                map.set(`SKU:${barcode.toUpperCase()}`, product);
            }
        });
        return map;
    }, [eligibleProducts]);

    const normalizedRows = useMemo(() => (
        rows.map(row => ({
            ...row,
            normalizedLotNumber: normalizeText(row.lotNumber).toUpperCase(),
            quantityPerUnitValue: getRowQuantityPerUnit(row),
            unitsValue: getRowUnits(row),
            totalValue: getRowTotal(row)
        }))
    ), [rows]);

    const sortedRows = useMemo(() => (
        [...normalizedRows].sort((left, right) => {
            const byProduct = left.productName.localeCompare(right.productName);
            if (byProduct !== 0) return byProduct;
            return String(left.lotNumber || '').localeCompare(String(right.lotNumber || ''));
        })
    ), [normalizedRows]);

    const displayUnit = useMemo(() => inferSingleUnit(normalizedRows, 'und'), [normalizedRows]);

    const productSummary = useMemo(() => {
        const grouped = new Map();

        normalizedRows.forEach(row => {
            const existing = grouped.get(row.productId) || {
                productId: row.productId,
                productName: row.productName,
                sku: row.sku,
                unit: row.unit,
                lots: new Set(),
                units: 0,
                plannedQuantity: 0
            };

            existing.units += row.unitsValue;
            existing.plannedQuantity += row.totalValue;
            if (row.lotNumber) existing.lots.add(row.lotNumber);
            grouped.set(row.productId, existing);
        });

        return [...grouped.values()].map(entry => {
            const product = eligibleProductById.get(entry.productId) || null;
            const fallbackSourceQuantity = Math.floor(getSourceQuantity(product, context?.warehouseName));
            const availability = availabilityByProduct[entry.productId] || {
                siigoSourceQuantity: fallbackSourceQuantity,
                alreadyAssignedQuantity: 0,
                availableBefore: fallbackSourceQuantity
            };

            return {
                ...entry,
                lots: entry.lots.size,
                sourceQuantity: availability.siigoSourceQuantity,
                alreadyAssignedQuantity: availability.alreadyAssignedQuantity,
                availableBefore: availability.availableBefore,
                difference: availability.availableBefore - entry.plannedQuantity,
                exceedsSource: entry.plannedQuantity > availability.availableBefore
            };
        }).sort((left, right) => left.productName.localeCompare(right.productName));
    }, [availabilityByProduct, context?.warehouseName, eligibleProductById, normalizedRows]);

    const totals = useMemo(() => ({
        scans: normalizedRows.reduce((sum, row) => sum + Number(row.scanCount || 0), 0),
        products: productSummary.length,
        units: normalizedRows.reduce((sum, row) => sum + row.unitsValue, 0),
        quantity: normalizedRows.reduce((sum, row) => sum + row.totalValue, 0)
    }), [normalizedRows, productSummary.length]);

    const blockingIssues = useMemo(() => {
        const issues = [];

        if (normalizedRows.length === 0) {
            issues.push('Aun no hay lecturas registradas.');
        }

        normalizedRows.forEach(row => {
            if (!normalizeText(row.lotNumber)) {
                issues.push(`Falta lote en ${row.productName}.`);
            }
            if (!normalizeText(row.expiresAt)) {
                issues.push(`Falta vencimiento en ${row.productName}.`);
            }
            if (row.quantityPerUnitValue <= 0 || row.unitsValue <= 0) {
                issues.push(`Las cantidades de ${row.productName} deben ser mayores a 0.`);
            }
        });

        productSummary.forEach(item => {
            if (item.exceedsSource) {
                issues.push(`${item.productName} supera lo disponible en Siigo sin asignar.`);
            }
        });

        return issues;
    }, [normalizedRows, productSummary]);

    if (!context) return null;

    const showNotice = (type, message) => setNotice({ type, message });
    const focusScanInput = useCallback(() => {
        window.setTimeout(() => {
            scanInputRef.current?.focus();
            scanInputRef.current?.select?.();
        }, 0);
    }, []);

    const resetListing = useCallback(({
        preserveResult = false,
        preserveNotice = false,
        preserveZone = true
    } = {}) => {
        setScanValue('');
        setRows([]);
        if (!preserveResult) setResult(null);
        if (!preserveNotice) setNotice(buildEmptyNotice());
        if (!preserveZone) setTargetZone(DEFAULT_TARGET_ZONE);
        focusScanInput();
    }, [focusScanInput]);

    useEffect(() => {
        focusScanInput();
    }, [focusScanInput]);

    useEffect(() => {
        if (!result) return;
        window.setTimeout(() => {
            resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 120);
    }, [result]);

    const loadAvailability = useCallback(async () => {
        if (!context?.warehouseName || eligibleProducts.length === 0) {
            setAvailabilityByProduct({});
            return;
        }

        setAvailabilityLoading(true);
        try {
            const params = new URLSearchParams({
                productIds: eligibleProducts.map(product => product.id).join(','),
                sourceWarehouseName: context.warehouseName
            });
            const { data } = await api.get(`/inventory/unassigned-bulk-ingress/availability?${params.toString()}`);
            const nextAvailability = Object.fromEntries(
                (data?.products || []).map(item => [item.productId, item])
            );
            setAvailabilityByProduct(nextAvailability);
        } catch (_error) {
            setAvailabilityByProduct({});
        } finally {
            setAvailabilityLoading(false);
        }
    }, [context?.warehouseName, eligibleProducts]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            if (!context?.warehouseName || eligibleProducts.length === 0) {
                setAvailabilityByProduct({});
                return;
            }

            setAvailabilityLoading(true);
            try {
                const params = new URLSearchParams({
                    productIds: eligibleProducts.map(product => product.id).join(','),
                    sourceWarehouseName: context.warehouseName
                });
                const { data } = await api.get(`/inventory/unassigned-bulk-ingress/availability?${params.toString()}`);
                if (cancelled) return;

                const nextAvailability = Object.fromEntries(
                    (data?.products || []).map(item => [item.productId, item])
                );
                setAvailabilityByProduct(nextAvailability);
            } catch (_error) {
                if (!cancelled) setAvailabilityByProduct({});
            } finally {
                if (!cancelled) setAvailabilityLoading(false);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [context?.warehouseName, eligibleProducts]);

    const findProductForScan = (scan) => {
        const sku = normalizeText(scan?.sku).toUpperCase();
        const barcode = normalizeText(scan?.barcode);
        return eligibleProductMap.get(`SKU:${sku}`)
            || eligibleProductMap.get(`BAR:${barcode}`)
            || null;
    };

    const isPackageAlreadyQueued = (packageCode) => rows.some(row => row.packageCodes.includes(packageCode));

    const upsertRowFromScan = (product, scan, rawValue) => {
        const lotNumber = normalizeText(scan.lotNumber).toUpperCase();
        const quantityPerUnit = Math.max(1, resolveScannedQuantity({
            scan,
            product,
            fallback: 1
        }) || 1);
        const expiresAt = normalizeText(scan.expirationDate) || deriveExpirationFromLot(lotNumber);
        const receivedAt = normalizeText(scan.receivedAt) || todayInput();
        const packageCode = normalizeText(scan.packageCode || scan.packageId).toUpperCase();

        setRows(previousRows => {
            const existingIndex = previousRows.findIndex(row => (
                row.productId === product.id &&
                normalizeText(row.lotNumber).toUpperCase() === lotNumber &&
                normalizeText(row.expiresAt) === expiresAt &&
                getRowQuantityPerUnit(row) === quantityPerUnit
            ));

            if (existingIndex >= 0) {
                const nextRows = [...previousRows];
                const targetRow = nextRows[existingIndex];
                const nextUnits = getRowUnits(targetRow) + 1;

                nextRows[existingIndex] = {
                    ...targetRow,
                    units: normalizeInventoryIntegerInput(nextUnits),
                    scanCount: Number(targetRow.scanCount || 0) + 1,
                    receivedAt: targetRow.receivedAt || receivedAt,
                    packageCodes: packageCode
                        ? [...new Set([...targetRow.packageCodes, packageCode])]
                        : targetRow.packageCodes,
                    rawScans: [...targetRow.rawScans, rawValue]
                };

                return nextRows;
            }

            return [
                ...previousRows,
                {
                    id: `${product.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                    productId: product.id,
                    productName: product.name,
                    sku: product.code || product.sku || '',
                    unit: product.unit || 'unidad',
                    lotNumber,
                    expiresAt,
                    receivedAt,
                    quantityPerUnit: normalizeInventoryIntegerInput(quantityPerUnit),
                    units: '1',
                    scanCount: 1,
                    packageCodes: packageCode ? [packageCode] : [],
                    rawScans: [rawValue]
                }
            ];
        });
    };

    const handleAddScan = async () => {
        const rawValue = scanValue.trim();
        if (!rawValue) return;

        if (result && rows.length === 0) {
            setResult(null);
            setNotice(buildEmptyNotice());
        }

        const parsedScan = parseScanInput(rawValue);
        if (parsedScan.type === 'unknown' || (!parsedScan.sku && !parsedScan.barcode && !parsedScan.packageCode && !parsedScan.packageId)) {
            showNotice('error', 'No pude reconocer el codigo escaneado.');
            return;
        }

        const packageCode = normalizeText(parsedScan.packageCode || parsedScan.packageId).toUpperCase();
        if (packageCode && isPackageAlreadyQueued(packageCode)) {
            showNotice('warning', `El ID ${packageCode} ya estaba agregado en esta validacion.`);
            setScanValue('');
            return;
        }

        if (packageCode) {
            try {
                const { data } = await api.post('/inventory/package-labels/validate-scan', {
                    packageCode,
                    recordScan: false
                });

                if (data?.packageLabel) {
                    showNotice('warning', `El ID ${packageCode} ya existe en base de datos. No se agrego de nuevo.`);
                    setScanValue('');
                    return;
                }
            } catch (error) {
                if (error.response?.status !== 404) {
                    showNotice('error', error.response?.data?.error || 'No pude validar el ID unico escaneado.');
                    return;
                }
            }
        }

        const matchedProduct = findProductForScan(parsedScan);
        if (!matchedProduct) {
            showNotice('error', 'El codigo no pertenece a un producto visible en este cuadro de sin asignar.');
            return;
        }

        upsertRowFromScan(matchedProduct, parsedScan, rawValue);
        setScanValue('');
        showNotice('success', `Lectura agregada para ${matchedProduct.name}.`);
    };

    const updateRow = (rowId, patch) => {
        setRows(previousRows => previousRows.map(row => {
            if (row.id !== rowId) return row;

            const nextRow = { ...row, ...patch };
            if ('lotNumber' in patch && !patch.expiresAt) {
                const previousDerivedExpiration = deriveExpirationFromLot(row.lotNumber);
                const inferredExpiration = deriveExpirationFromLot(nextRow.lotNumber);
                const shouldRefreshDerivedExpiration = (
                    !normalizeText(row.expiresAt) ||
                    normalizeText(row.expiresAt) === previousDerivedExpiration
                );

                if (shouldRefreshDerivedExpiration) {
                    nextRow.expiresAt = inferredExpiration || '';
                }
            }

            return nextRow;
        }));
    };

    const removeRow = (rowId) => {
        setRows(previousRows => previousRows.filter(row => row.id !== rowId));
    };

    const handleFinalize = async () => {
        if (blockingIssues.length > 0) {
            showNotice('error', blockingIssues[0]);
            return;
        }

        setSaving(true);
        try {
            const payloadLines = normalizedRows.map(row => ({
                productId: row.productId,
                lotNumber: normalizeText(row.lotNumber).toUpperCase(),
                unitCount: row.unitsValue,
                quantityPerUnit: row.quantityPerUnitValue,
                quantity: row.totalValue,
                receivedAt: normalizeText(row.receivedAt) || todayInput(),
                expiresAt: normalizeText(row.expiresAt) || null
            }));
            const payload = {
                groupName: context.groupName,
                sourceWarehouseName: context.warehouseName,
                targetZone,
                lines: payloadLines
            };

            const { data } = await api.post('/inventory/unassigned-bulk-ingress', payload);
            setResult({
                ...data,
                displayUnit,
                savedAt: new Date().toISOString()
            });
            showNotice('success', 'Ingreso guardado correctamente. Ya puedes empezar un nuevo listado.');
            resetListing({
                preserveResult: true,
                preserveNotice: true,
                preserveZone: true
            });
            await Promise.allSettled([
                onCompleted?.(),
                loadAvailability()
            ]);
        } catch (error) {
            showNotice('error', error.response?.data?.error || 'No se pudo registrar el ingreso validado.');
        } finally {
            setSaving(false);
        }
    };

    const noticeClass = notice.type === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : notice.type === 'warning'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : notice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'hidden';

    return (
        <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="w-full h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-2rem)] max-w-6xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-4 sm:px-6 sm:py-5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-white/90">
                            <ShieldCheck className="w-4 h-4" />
                            Validacion por escaneo
                        </div>
                        <h2 className="mt-1 text-lg sm:text-2xl font-extrabold leading-tight break-words">
                            {context.groupName} - {context.warehouseName}
                        </h2>
                        <p className="mt-2 text-xs sm:text-sm text-white/90 max-w-3xl">
                            Pistolea el inventario fisico, agrupa por producto y lote, revisa el paralelo contra Siigo y registra el ingreso interno en una sola operacion.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 hover:bg-white/15 transition-colors flex-shrink-0"
                        title="Cerrar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 bg-slate-50">
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
                            <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                <div className="flex-1">
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">
                                        Escanear QR / codigo
                                    </label>
                                    <div className="relative">
                                        <ScanLine className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            ref={scanInputRef}
                                            type="text"
                                            value={scanValue}
                                            onChange={(event) => {
                                                if (result && rows.length === 0) {
                                                    setResult(null);
                                                    setNotice(buildEmptyNotice());
                                                }
                                                setScanValue(event.target.value);
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    handleAddScan();
                                                }
                                            }}
                                            placeholder="Pistolea o pega el QR aqui"
                                            className="w-full pl-10 pr-3 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                                            autoFocus
                                        />
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Si el lote inicia con AAMMDD, el vencimiento se propone a un ano. Ejemplo: 260410, vence 2027-04-10.
                                    </p>
                                </div>

                                <div className="w-full md:w-72">
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">
                                        Zona interna destino
                                    </label>
                                    <div className="relative">
                                        <Warehouse className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <select
                                            value={targetZone}
                                            onChange={(event) => setTargetZone(event.target.value)}
                                            className="w-full pl-10 pr-3 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                                        >
                                            {INTERNAL_DESTINATION_OPTIONS.map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500">
                                        {(INTERNAL_DESTINATION_OPTIONS.find(option => option.value === targetZone) || INTERNAL_DESTINATION_OPTIONS[0]).description}
                                    </p>
                                </div>
                            </div>

                            <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${noticeClass}`}>
                                {notice.message || ' '}
                            </div>

                            <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Lecturas</div>
                                    <div className="mt-1 text-2xl font-bold text-slate-900">{totals.scans.toLocaleString('es-CO')}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Productos</div>
                                    <div className="mt-1 text-2xl font-bold text-slate-900">{totals.products.toLocaleString('es-CO')}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Unidades fisicas</div>
                                    <div className="mt-1 text-2xl font-bold text-slate-900">{totals.units.toLocaleString('es-CO')}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cantidad interna</div>
                                    <div className="mt-1 text-2xl font-bold text-slate-900">{formatQuantity(totals.quantity, displayUnit)}</div>
                                </div>
                            </div>
                        </section>

                        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
                            <div className="flex items-center gap-2 text-slate-800">
                                <ClipboardList className="w-4 h-4" />
                                <h3 className="text-sm font-bold">Referencia Siigo vs ingreso interno</h3>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Siigo solo se usa para comparar el saldo sin asignar. La zona real de registro es interna de la app y sigue el flujo de Produccion, Producto Terminado, Cuarentena, No Conforme, Maquila y Publicidad.
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                                Cada tarjeta resume un producto puntual. El total general del listado se recalcula arriba y el detalle completo queda abajo fila por fila.
                            </p>
                            {availabilityLoading && (
                                <p className="mt-2 text-[11px] text-slate-400">
                                    Actualizando disponibilidad real para lotear...
                                </p>
                            )}

                            <div className="mt-4 space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                                {productSummary.length === 0 && (
                                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-500 text-center">
                                        Aun no hay productos pistoleados para comparar.
                                    </div>
                                )}

                                {productSummary.map(item => (
                                    <div
                                        key={item.productId}
                                        className={`rounded-lg border px-3 py-3 ${
                                            item.exceedsSource
                                                ? 'border-red-200 bg-red-50'
                                                : 'border-emerald-200 bg-emerald-50'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-semibold text-slate-900 break-words">{item.productName}</div>
                                                <div className="text-xs text-slate-500">{item.sku}</div>
                                                <div className="mt-1 text-[11px] text-slate-500">
                                                    Disponible real: {formatQuantity(item.availableBefore, item.unit)}
                                                    {' · '}
                                                    Ya asignado: {formatQuantity(item.alreadyAssignedQuantity, item.unit)}
                                                </div>
                                            </div>
                                            <div className={`text-xs font-semibold flex items-center gap-1 ${
                                                item.exceedsSource ? 'text-red-700' : 'text-emerald-700'
                                            }`}>
                                                {item.exceedsSource ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                                                {item.exceedsSource ? 'Excede' : 'Cuadra'}
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                            <div className="rounded-md bg-white/80 px-2 py-2 border border-white">
                                                <div className="text-slate-500">Siigo sin asignar</div>
                                                <div className="font-bold text-slate-900">{formatQuantity(item.sourceQuantity, item.unit)}</div>
                                            </div>
                                            <div className="rounded-md bg-white/80 px-2 py-2 border border-white">
                                                <div className="text-slate-500">Pistoleado de este producto</div>
                                                <div className="font-bold text-slate-900">{formatQuantity(item.plannedQuantity, item.unit)}</div>
                                            </div>
                                            <div className="rounded-md bg-white/80 px-2 py-2 border border-white">
                                                <div className="text-slate-500">Unidades</div>
                                                <div className="font-bold text-slate-900">{item.units.toLocaleString('es-CO')}</div>
                                            </div>
                                            <div className="rounded-md bg-white/80 px-2 py-2 border border-white">
                                                <div className="text-slate-500">Diferencia real</div>
                                                <div className={`font-bold ${item.difference < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                                                    {formatQuantity(item.difference, item.unit)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    <section className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-200 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">Detalle separado por producto y lote</h3>
                                <p className="text-xs text-slate-500">
                                    Puedes ajustar lote, vencimiento, unidades y cantidad por unidad antes de registrar.
                                </p>
                            </div>
                            <div className="text-xs text-slate-500">
                                Referencia externa: <span className="font-semibold text-slate-700">{context.warehouseName}</span>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-[980px] w-full text-sm">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                        <th className="sticky left-0 z-20 min-w-[220px] bg-slate-50 px-3 py-3 text-left font-semibold shadow-[1px_0_0_0_theme(colors.slate.200)]">Producto</th>
                                        <th className="px-3 py-3 text-left font-semibold">Lote</th>
                                        <th className="px-3 py-3 text-left font-semibold">Ingreso</th>
                                        <th className="px-3 py-3 text-left font-semibold">Vencimiento</th>
                                        <th className="px-3 py-3 text-right font-semibold">Cant. unidad</th>
                                        <th className="px-3 py-3 text-right font-semibold">Unidades</th>
                                        <th className="px-3 py-3 text-right font-semibold">Total</th>
                                        <th className="px-3 py-3 text-right font-semibold">Lecturas</th>
                                        <th className="px-3 py-3 text-right font-semibold">Accion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedRows.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                                                Todavia no hay lecturas cargadas.
                                            </td>
                                        </tr>
                                    )}

                                    {sortedRows.map(row => (
                                        <tr key={row.id} className="align-top">
                                            <td className="sticky left-0 z-10 min-w-[220px] bg-white px-3 py-3 shadow-[1px_0_0_0_theme(colors.slate.100)]">
                                                <div className="font-semibold text-slate-900">{row.productName}</div>
                                                <div className="text-xs text-slate-500">{row.sku}</div>
                                            </td>
                                            <td className="px-3 py-3">
                                                <input
                                                    type="text"
                                                    value={row.lotNumber}
                                                    onChange={(event) => updateRow(row.id, {
                                                        lotNumber: event.target.value.toUpperCase()
                                                    })}
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                    placeholder="Lote"
                                                />
                                            </td>
                                            <td className="px-3 py-3">
                                                <input
                                                    type="date"
                                                    value={row.receivedAt}
                                                    onChange={(event) => updateRow(row.id, { receivedAt: event.target.value })}
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </td>
                                            <td className="px-3 py-3">
                                                <input
                                                    type="date"
                                                    value={row.expiresAt}
                                                    onChange={(event) => updateRow(row.id, { expiresAt: event.target.value })}
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </td>
                                            <td className="px-3 py-3">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={row.quantityPerUnit}
                                                    onChange={(event) => updateRow(row.id, {
                                                        quantityPerUnit: normalizeInventoryIntegerInput(event.target.value)
                                                    })}
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </td>
                                            <td className="px-3 py-3">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={row.units}
                                                    onChange={(event) => updateRow(row.id, {
                                                        units: normalizeInventoryIntegerInput(event.target.value)
                                                    })}
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                                                {formatQuantity(getRowTotal(row), row.unit)}
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">
                                                {Number(row.scanCount || 0).toLocaleString('es-CO')}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(row.id)}
                                                    className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100 transition-colors"
                                                    title="Quitar fila"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {blockingIssues.length > 0 && (!result || rows.length > 0) && (
                        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <div className="font-semibold flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Revisa esto antes de finalizar
                            </div>
                            <ul className="mt-2 space-y-1 list-disc pl-5">
                                {blockingIssues.slice(0, 6).map(issue => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {result && (
                        <section ref={resultSectionRef} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                            <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                                <CheckCircle2 className="w-5 h-5" />
                                Registro completado
                            </div>
                            <div className="mt-1 text-xs text-emerald-700">
                                Ingreso guardado. El formulario ya quedo libre para arrancar un nuevo listado.
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-4">
                                <div className="rounded-lg bg-white px-3 py-3 border border-emerald-100">
                                    <div className="text-xs text-slate-500">Lineas</div>
                                    <div className="text-xl font-bold text-slate-900">{result.totals?.lines?.toLocaleString('es-CO') || 0}</div>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-3 border border-emerald-100">
                                    <div className="text-xs text-slate-500">Productos</div>
                                    <div className="text-xl font-bold text-slate-900">{result.totals?.products?.toLocaleString('es-CO') || 0}</div>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-3 border border-emerald-100">
                                    <div className="text-xs text-slate-500">Lotes tocados</div>
                                    <div className="text-xl font-bold text-slate-900">{result.totals?.lots?.toLocaleString('es-CO') || 0}</div>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-3 border border-emerald-100">
                                    <div className="text-xs text-slate-500">Cantidad total</div>
                                    <div className="text-xl font-bold text-slate-900">{formatQuantity(result.totals?.quantity || 0, result.displayUnit || 'und')}</div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                    <div className="font-semibold text-slate-900">Resumen por producto</div>
                                    <div className="mt-3 space-y-2">
                                        {(result.comparisons || []).map(item => (
                                            <div key={item.productId} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                                                <div className="font-medium text-slate-900">{item.productName}</div>
                                                <div className="mt-1 text-xs text-slate-500">
                                                    Siigo: {formatQuantity(item.siigoSourceQuantity, eligibleProducts.find(product => product.id === item.productId)?.unit || 'und')}
                                                    {' · '}
                                                    Registrado: {formatQuantity(item.plannedQuantity, eligibleProducts.find(product => product.id === item.productId)?.unit || 'und')}
                                                    {' · '}
                                                    Saldo: {formatQuantity(item.availableAfter, eligibleProducts.find(product => product.id === item.productId)?.unit || 'und')}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                    <div className="font-semibold text-slate-900">Lotes registrados</div>
                                    <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1">
                                        {(result.lots || []).map(lot => (
                                            <div key={lot.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                                                <div className="font-medium text-slate-900">
                                                    {lot.productName} - {lot.lotNumber}
                                                </div>
                                                <div className="mt-1 text-xs text-slate-500">
                                                    {formatQuantity(lot.quantity, lot.unit)} en {lot.zone}
                                                    {' · '}
                                                    {lot.unitCount.toLocaleString('es-CO')} unidad(es)
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}
                </div>

                <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-slate-500">
                        Las zonas operativas son internas de la app. <span className="font-semibold text-slate-700">{context.warehouseName}</span> solo actua como referencia comparativa contra Siigo para este ingreso inicial.
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row gap-2 sm:items-center">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={() => resetListing({
                                preserveResult: false,
                                preserveNotice: false,
                                preserveZone: true
                            })}
                            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                        >
                            Limpiar
                        </button>
                        <button
                            type="button"
                            onClick={handleFinalize}
                            disabled={saving || blockingIssues.length > 0}
                            className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-semibold transition-colors ${
                                saving || blockingIssues.length > 0
                                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                        >
                            <Save className="w-4 h-4" />
                            {saving ? 'Registrando...' : 'Finalizar e ingresar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UnassignedBulkIngressModal;
