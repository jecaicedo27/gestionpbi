import React, { useState } from 'react';
import { Package, ShieldCheck, Warehouse } from 'lucide-react';

// Detect touch device — disable tooltip on touch
const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const InventoryMatrix = ({ products, onProductClick, onBulkValidationOpen }) => {
    // Groups that benefit from matrix view (flavors x sizes)
    const MATRIX_GROUPS = ['LIQUIPOPS', 'GENIALITY'];

    // 1. Get Unique Groups from the filtered products
    const groups = [...new Set(products.map(p => p.group))].sort();

    // 2. Check if a group should use matrix or list view
    const shouldUseMatrix = (groupName) => {
        return MATRIX_GROUPS.includes(groupName);
    };

    // 3. Process Matrix for a specific group and warehouse
    const roundToPack = (val, pack) => {
        const p = pack || 1;
        return Math.ceil(val / p) * p;
    };

    const canOpenBulkValidation = (groupName, warehouseName) => (
        ['LIQUIPOPS', 'GENIALITY'].includes(String(groupName || '').toUpperCase()) &&
        String(warehouseName || '').toUpperCase().includes('SIN ASIGNAR') &&
        typeof onBulkValidationOpen === 'function'
    );

    const renderSectionHeader = (groupName, warehouseName) => (
        <div className="text-xs font-bold text-gray-700 bg-gray-50 p-2 flex items-center justify-between gap-2 border-b">
            <div className="flex items-center min-w-0">
                <Package className="w-3 h-3 mr-1 flex-shrink-0" />
                <span className="truncate">{groupName}</span>
                <Warehouse className="w-3 h-3 ml-3 mr-1 flex-shrink-0" />
                <span className="text-blue-600 truncate">{warehouseName}</span>
            </div>

            {canOpenBulkValidation(groupName, warehouseName) && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onBulkValidationOpen({ groupName, warehouseName });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors flex-shrink-0"
                    title="Validar e ingresar por escaneo"
                >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Validar
                </button>
            )}
        </div>
    );

    const processMatrix = (groupName, warehouseName) => {
        const groupProducts = products.filter(p => p.group === groupName);

        // Filter products by warehouse
        const warehouseProducts = groupProducts.map(p => {
            const warehouse = Array.isArray(p.warehouses)
                ? p.warehouses.find(w => w.name === warehouseName)
                : null;

            if (!warehouse) return null;

            return {
                ...p,
                warehouseQty: warehouse.quantity || 0
            };
        }).filter(p => p !== null);

        if (warehouseProducts.length === 0) {
            return { sizes: [], flavors: [], productMap: {}, hasData: false };
        }

        // Extract unique Sizes and Flavors for THIS group/warehouse
        const sizes = [...new Set(warehouseProducts.map(p => p.size || 'Estándar'))].sort((a, b) => {
            const getVal = (s) => parseInt(s) || 9999;
            return getVal(a) - getVal(b);
        });

        const flavors = [...new Set(warehouseProducts.map(p => p.flavor || 'Tarros'))].sort();

        // Build Map
        const productMap = {};
        warehouseProducts.forEach(p => {
            const key = `${p.flavor || 'Tarros'}-${p.size || 'Estándar'}`;
            productMap[key] = p;
        });

        return { sizes, flavors, productMap, hasData: true };
    };

    // Bodegas ocultas en la matriz — case-insensitive
    const HIDDEN_WAREHOUSES = ['MAQUILAS', 'MATERIA PRIMA TRANSITORIA'];
    const isHiddenWarehouse = (name) =>
        HIDDEN_WAREHOUSES.includes(String(name || '').trim().toUpperCase());

    // 4. Get unique warehouses for a group
    const getWarehousesForGroup = (groupName) => {
        const groupProducts = products.filter(p => p.group === groupName);
        const warehouseNames = new Set();

        groupProducts.forEach(p => {
            if (Array.isArray(p.warehouses) && p.warehouses.length > 0) {
                p.warehouses.forEach(w => {
                    if (!isHiddenWarehouse(w.name)) warehouseNames.add(w.name);
                });
            } else {
                warehouseNames.add('Sin asignar');
            }
        });

        return Array.from(warehouseNames).sort((a, b) => {
            if (a === 'Sin asignar') return -1;
            if (b === 'Sin asignar') return 1;
            return a.localeCompare(b);
        });
    };

    // 5. Render Matrix Table
    const renderMatrix = (groupName, warehouseName) => {
        const { sizes, flavors, productMap, hasData } = processMatrix(groupName, warehouseName);

        if (!hasData) return null;

        return (
            <div key={`${groupName}-${warehouseName}`} className="mb-4 overflow-x-auto border rounded-lg shadow-sm bg-white">
                {renderSectionHeader(groupName, warehouseName)}

                <table className="min-w-full text-[10px] border-collapse">
                    <thead>
                        <tr>
                            <th className="p-1 border-b bg-white text-left font-bold text-gray-400 w-20 sticky left-0 z-10">
                                PRES/SABOR
                            </th>
                            {flavors.map(f => (
                                <th key={f} className="p-1 border-b bg-white font-bold text-gray-600 min-w-[50px] text-center text-[8px]">
                                    {f.toUpperCase()}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sizes.map(size => (
                            <tr key={size} className="hover:bg-gray-50 transition-colors">
                                <td className="p-1 border-b font-bold text-gray-600 bg-gray-50/50 whitespace-nowrap sticky left-0 z-10 text-[9px]">
                                    {size.toUpperCase()}
                                </td>
                                {flavors.map(flavor => {
                                    const key = `${flavor}-${size}`;
                                    const product = productMap[key];

                                    if (!product) {
                                        return <td key={key} className="p-1 border-b text-center text-gray-200">.</td>;
                                    }

                                    let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                                    if (product.warehouseQty < 0) bgClass = 'bg-red-100 text-red-800 border-red-200 font-bold';
                                    else if (product.warehouseQty === 0) bgClass = 'bg-red-50 text-red-600 border-red-100 font-bold';
                                    else if (product.warehouseQty < 50) bgClass = 'bg-amber-50 text-amber-700 border-amber-100';

                                    // Calculate suggestions
                                    const velocity = product.dailyVelocity || 0;
                                    const needed15 = velocity * 15;
                                    const needed30 = velocity * 30;
                                    const needed45 = velocity * 45;
                                    const pack = product.packSize || 1;

                                    const suggestion = roundToPack(Math.max(0, needed15 - (product.currentStock || 0)), pack);
                                    const suggest30 = roundToPack(Math.max(0, needed30 - (product.currentStock || 0)), pack);
                                    const suggest45 = roundToPack(Math.max(0, needed45 - (product.currentStock || 0)), pack);

                                    const daysOfStock = velocity > 0 ? (product.currentStock / velocity) : (product.currentStock > 0 ? 999 : 0);

                                    return (
                                        <td
                                            key={key}
                                            className="p-1 border-b text-center relative overflow-visible"
                                            onMouseEnter={(e) => {
                                                if (isTouchDevice()) return;
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setTooltip({
                                                    visible: true,
                                                    x: rect.left + (rect.width / 2),
                                                    y: rect.top,
                                                    product
                                                });
                                            }}
                                            onMouseLeave={() => setTooltip({ ...tooltip, visible: false })}
                                            onClick={() => { setTooltip({ visible: false }); onProductClick && onProductClick(product); }}
                                        >
                                            <div className={`py-1 px-1 rounded border ${bgClass} cursor-pointer transition-all hover:scale-105 relative`}>
                                                {/* Days of Stock Badge */}
                                                <div className="absolute -top-0.5 left-0.5 text-[9px] font-bold text-emerald-700 z-40">
                                                    {daysOfStock > 90 ? '90+' : Math.floor(daysOfStock)}
                                                </div>

                                                <div className="text-sm font-bold mt-1">{product.warehouseQty}</div>

                                                <div className="flex justify-center gap-1 mt-0.5 text-[9px] font-mono leading-none opacity-90">
                                                    <span className={suggestion > 0 ? "text-red-700 font-bold" : "text-gray-900 font-bold"}>{suggestion}</span>
                                                    <span className="text-gray-400">|</span>
                                                    <span className={suggest30 > 0 ? "text-black font-bold" : "text-black"}>{suggest30}</span>
                                                </div>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    // 6. Detect product line from name
    const detectProductLine = (productName) => {
        const nameLower = productName.toLowerCase();
        if (nameLower.includes('batch')) return 'OTROS';
        if (nameLower.includes('base liquipops')) return 'BASE LIQUIPOPS';
        if (nameLower.includes('base sirope')) return 'BASE SIROPE';
        if (nameLower.includes('saborizacion') || nameLower.includes('saborización')) return 'SABORIZACION';
        if (nameLower.includes('liquipops')) return 'LIQUIPOPS';
        if (nameLower.includes('geniality') || nameLower.includes('sirope')) return 'SIROPES';
        if (nameLower.includes('liquimon') || nameLower.includes('base citrica') || nameLower.includes('base cítrica')) return 'BASE CÍTRICA';
        return 'OTROS';
    };

    // 7. Render List View (for non-matrix groups)
    const renderList = (groupName, warehouseName) => {
        const groupProducts = products.filter(p => p.group === groupName);

        const warehouseProducts = groupProducts.map(p => {
            const warehouse = Array.isArray(p.warehouses)
                ? p.warehouses.find(w => w.name === warehouseName)
                : null;

            // For 'Sin asignar', also include products with no warehouses at all
            if (!warehouse) {
                if (warehouseName === 'Sin asignar' && (!Array.isArray(p.warehouses) || p.warehouses.length === 0)) {
                    return { ...p, warehouseQty: 0, productLine: detectProductLine(p.name) };
                }
                return null;
            }

            return {
                ...p,
                warehouseQty: warehouse.quantity || 0,
                productLine: detectProductLine(p.name)
            };
        }).filter(p => p !== null).sort((a, b) => a.name.localeCompare(b.name));

        if (warehouseProducts.length === 0) return null;

        // Group by product line
        const lineGroups = {};
        warehouseProducts.forEach(p => {
            if (!lineGroups[p.productLine]) {
                lineGroups[p.productLine] = [];
            }
            lineGroups[p.productLine].push(p);
        });

        const sortedLines = Object.keys(lineGroups).sort((a, b) => {
            const order = { 'LIQUIPOPS': 1, 'SIROPES': 2, 'BASE CÍTRICA': 3, 'OTROS': 4 };
            return (order[a] || 99) - (order[b] || 99);
        });

        return (
            <div key={`${groupName}-${warehouseName}`} className="mb-4 border rounded-lg shadow-sm bg-white">
                {renderSectionHeader(groupName, warehouseName)}

                {sortedLines.map(line => (
                    <div key={line} className="p-2 border-b last:border-b-0 overflow-x-auto">
                        <h4 className="text-[10px] font-bold text-gray-600 mb-2 flex items-center">
                            <div className="w-1 h-4 bg-blue-500 rounded mr-2"></div>
                            {line}
                        </h4>

                        {((line === 'LIQUIPOPS' || line === 'SIROPES') && groupName !== 'MATERIAL DE EMPAQUE' && groupName !== 'MATERIA PRIMA SABORES') ? (
                            // Matrix view for flavor/size products
                            (() => {
                                const lineProducts = lineGroups[line];
                                const sizes = [...new Set(lineProducts.map(p => p.size || 'Estándar'))].sort((a, b) => {
                                    const getVal = (s) => parseInt(s) || 9999;
                                    return getVal(a) - getVal(b);
                                });
                                const flavors = [...new Set(lineProducts.map(p => p.flavor || 'Tarros'))].sort();

                                const productMap = {};
                                lineProducts.forEach(p => {
                                    const key = `${p.flavor || 'Tarros'}-${p.size || 'Estándar'}`;
                                    productMap[key] = p;
                                });

                                return (
                                    <table className="min-w-full text-[9px] border-collapse">
                                        <thead>
                                            <tr>
                                                <th className="p-1 border-b bg-gray-50 text-left font-bold text-gray-400 text-[8px]">PRES/SABOR</th>
                                                {flavors.map(f => (
                                                    <th key={f} className="p-1 border-b bg-gray-50 font-bold text-gray-600 text-[9px] text-center">
                                                        {(f === 'Original' && groupName.includes('ETIQUETAS')) ? 'SELLO DE SEGURIDAD' : f.toUpperCase()}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sizes.map(size => (
                                                <tr key={size} className="hover:bg-gray-50">
                                                    <td className="p-1 border-b font-bold text-gray-600 bg-gray-50/50 text-[8px]">
                                                        {size.toUpperCase()}
                                                    </td>
                                                    {flavors.map(flavor => {
                                                        const key = `${flavor}-${size}`;
                                                        const product = productMap[key];

                                                        if (!product) {
                                                            return <td key={key} className="p-1 border-b text-center text-gray-200">.</td>;
                                                        }

                                                        let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                                                        if (product.warehouseQty < 0) bgClass = 'bg-red-100 text-red-800 border-red-200 font-bold';
                                                        else if (product.warehouseQty === 0) bgClass = 'bg-red-50 text-red-600 border-red-100 font-bold';
                                                        else if (product.warehouseQty < 50) bgClass = 'bg-amber-50 text-amber-700 border-amber-100';

                                                        // Calculate suggestions
                                                        const velocity = product.dailyVelocity || 0;
                                                        const needed15 = velocity * 15;
                                                        const needed45 = velocity * 45;
                                                        const suggestion = Math.ceil(Math.max(0, needed15 - (product.currentStock || 0)));
                                                        const suggest45 = Math.ceil(Math.max(0, needed45 - (product.currentStock || 0)));
                                                        const daysOfStock = velocity > 0 ? (product.currentStock / velocity) : (product.currentStock > 0 ? 999 : 0);

                                                        return (
                                                            <td
                                                                key={key}
                                                                className="p-1 border-b text-center relative overflow-visible"
                                                                onMouseEnter={(e) => {
                                                                    if (isTouchDevice()) return;
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setTooltip({
                                                                        visible: true,
                                                                        x: rect.left + (rect.width / 2),
                                                                        y: rect.top,
                                                                        product
                                                                    });
                                                                }}
                                                                onMouseLeave={() => setTooltip({ ...tooltip, visible: false })}
                                                                onClick={() => { setTooltip({ visible: false }); onProductClick && onProductClick(product); }}
                                                            >
                                                                <div className={`py-1 px-1 rounded border ${bgClass} cursor-pointer transition-all hover:scale-105 relative`}>
                                                                    {/* Days of Stock Badge */}
                                                                    <div className="absolute -top-0.5 left-0.5 text-[9px] font-bold text-emerald-700 z-40">
                                                                        {daysOfStock > 90 ? '90+' : Math.floor(daysOfStock)}
                                                                    </div>

                                                                    <div className="text-xs font-bold mt-1">{product.warehouseQty}</div>
                                                                    {/* Suggestions */}
                                                                    <div className="flex justify-center gap-1 mt-0.5 text-[9px] font-mono leading-none opacity-90">
                                                                        <span className={suggestion > 0 ? "text-red-700 font-bold" : "text-gray-900 font-bold"}>{suggestion}</span>
                                                                        <span className="text-gray-400">|</span>
                                                                        <span className={suggest45 > 0 ? "text-black font-bold" : "text-black"}>{suggest45}</span>
                                                                    </div>


                                                                </div>
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                );
                            })()
                        ) : (
                            // Card view for other products
                            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
                                {lineGroups[line].map(product => {
                                    let bgClass = 'bg-emerald-50 border-emerald-200';
                                    let textClass = 'text-emerald-700';
                                    if (product.warehouseQty < 0) {
                                        bgClass = 'bg-red-100 border-red-200';
                                        textClass = 'text-red-800';
                                    } else if (product.warehouseQty === 0) {
                                        bgClass = 'bg-red-50 border-red-200';
                                        textClass = 'text-red-600';
                                    } else if (product.warehouseQty < 50) {
                                        bgClass = 'bg-amber-50 border-amber-200';
                                        textClass = 'text-amber-700';
                                    }

                                    // Calculate suggestions for badge
                                    const velocity = product.dailyVelocity || 0;
                                    const needed15 = velocity * 15;
                                    const needed30 = velocity * 30;
                                    const needed45 = velocity * 45;
                                    const pack = product.packSize || 1;

                                    const suggestion = roundToPack(Math.max(0, needed15 - (product.currentStock || 0)), pack);
                                    const suggest30 = roundToPack(Math.max(0, needed30 - (product.currentStock || 0)), pack);
                                    const suggest45 = roundToPack(Math.max(0, needed45 - (product.currentStock || 0)), pack);

                                    const daysOfStock = velocity > 0 ? (product.currentStock / velocity) : (product.currentStock > 0 ? 999 : 0);

                                    return (
                                        <div
                                            key={product.id}
                                            className={`p-3 rounded border ${bgClass} ${textClass} transition-all hover:shadow-md relative cursor-pointer`}
                                            onMouseEnter={(e) => {
                                                if (isTouchDevice()) return;
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setTooltip({
                                                    visible: true,
                                                    x: rect.left + (rect.width / 2),
                                                    y: rect.top,
                                                    product
                                                });
                                            }}
                                            onMouseLeave={() => setTooltip({ ...tooltip, visible: false })}
                                            onClick={() => { setTooltip({ visible: false }); onProductClick && onProductClick(product); }}
                                        >
                                            <div className="flex justify-between items-center">
                                                <div className="flex-1 pr-2">
                                                    <div className="text-[11px] font-bold leading-tight">{product.name}</div>

                                                    {/* Days of Stock + Suggestions */}
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <div className="text-[9px] font-bold text-emerald-700 -ml-1 -mt-1">
                                                            {daysOfStock > 90 ? '90+' : Math.floor(daysOfStock)}
                                                        </div>
                                                        <div className="text-[9px] font-mono opacity-90">
                                                            Sug: <span className={suggestion > 0 ? "text-red-700 font-bold" : "text-gray-900 font-bold"}>{suggestion}</span> | <span className="text-black font-bold">{suggest30}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-2xl font-bold">{product.warehouseQty}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };
    const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, product: null });

    // Helper to calculate projections for tooltip
    const getAnalysis = (product) => {
        const stock = product.currentStock || 0;
        const velocity = product.dailyVelocity || 0;
        const pack = product.packSize || 1;

        const needed8 = velocity * 8;
        const needed15 = velocity * 15;
        const needed30 = velocity * 30;
        const needed45 = velocity * 45;

        const isProcess = product.group?.toUpperCase().includes('EN PROCESO');

        const suggest8 = isProcess ? 0 : roundToPack(Math.max(0, needed8 - stock), pack);
        const suggest15 = isProcess ? 0 : roundToPack(Math.max(0, needed15 - stock), pack);
        const suggest30 = isProcess ? 0 : roundToPack(Math.max(0, needed30 - stock), pack);
        const suggest45 = isProcess ? 0 : roundToPack(Math.max(0, needed45 - stock), pack);

        const daysOfStock = velocity > 0 ? (stock / velocity) : (stock > 0 ? 999 : 0);

        return {
            velocity,
            daysOfStock,
            minStock: product.minimumStock || 0,
            packSize: pack,
            suggest8,
            suggest15,
            suggest30,
            suggest45,
            isProcess
        };
    };

    return (
        <div className="p-0 overflow-hidden max-w-[100vw]">
            {/* Header / Search Controls - assumed to be in parent or above */}

            {/* Fixed Global Tooltip */}
            {/* Fixed Global Tooltip */}
            {tooltip.visible && tooltip.product && (
                <div
                    className="fixed z-[9999] bg-gray-900 text-white p-3 rounded shadow-2xl pointer-events-none text-xs w-64"
                    style={{
                        top: tooltip.y - 10,
                        left: tooltip.x,
                        transform: 'translate(-50%, -100%)'
                    }}
                >
                    {(() => {
                        const analysis = getAnalysis(tooltip.product);
                        return (
                            <>
                                <div className="font-bold mb-1 text-yellow-400 uppercase tracking-tight">{tooltip.product.name}</div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 opacity-90 text-[10px]">
                                    <span>Código:</span> <span className="text-right font-mono">{tooltip.product.code}</span>
                                    <span>Stock Actual:</span> <span className="text-right font-bold text-white">{Math.floor(tooltip.product.currentStock)}</span>

                                    <span className="text-emerald-300">Días Stock:</span>
                                    <span className="text-right font-bold text-emerald-300">
                                        {analysis.daysOfStock > 90 ? '90+' : analysis.daysOfStock.toFixed(1)} días
                                    </span>

                                    <span>Stock Mínimo:</span> <span className="text-right">{analysis.minStock}</span>
                                    <span>Unidad Empaque:</span> <span className="text-right">{analysis.packSize}</span>
                                    <span>Velocidad Diaria:</span> <span className="text-right">{Number(analysis.velocity).toFixed(2)} / día</span>

                                    {!analysis.isProcess && (
                                        <>
                                            <div className="col-span-2 my-1 border-t border-gray-700"></div>

                                            <span className="text-orange-300">Producción (8d):</span>
                                            <span className="text-right font-bold text-orange-300">
                                                {analysis.suggest8}
                                            </span>

                                            <span className="text-yellow-200">Sugerido (15d):</span>
                                            <span className="text-right font-bold text-yellow-200">
                                                {analysis.suggest15}
                                            </span>

                                            <span className="text-gray-400">Proyección 30d:</span>
                                            <span className="text-right text-gray-400">
                                                {analysis.suggest30}
                                            </span>

                                            <span className="text-gray-400">Proyección 45d:</span>
                                            <span className="text-right text-gray-400">
                                                {analysis.suggest45}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}

            {products.length === 0 && <div className="text-center text-gray-500 mt-10">No hay productos.</div>}
            {groups.map(group => {
                const warehouses = getWarehousesForGroup(group);
                const useMatrix = shouldUseMatrix(group);

                return warehouses.map(warehouse =>
                    useMatrix
                        ? renderMatrix(group, warehouse)
                        : renderList(group, warehouse)
                );
            })}
        </div>
    );
};

export default InventoryMatrix;
