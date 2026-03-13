import React, { useState } from 'react';
import { Package } from 'lucide-react';

const ReplenishmentMatrix = ({ products, onProductClick }) => {
    // Grouping constants
    const MATRIX_GROUPS = ['LIQUIPOPS', 'GENIALITY'];

    // 1. Get Unique Groups
    const groups = [...new Set(products.map(p => p.group))].sort();

    // 2. Logic to decide view type
    const shouldUseMatrix = (groupName) => MATRIX_GROUPS.includes(groupName);

    // 3. Process Matrix Data
    const processMatrix = (groupName) => {
        const groupProducts = products.filter(p => p.group === groupName);

        if (groupProducts.length === 0) return { sizes: [], flavors: [], productMap: {}, hasData: false };

        const sizes = [...new Set(groupProducts.map(p => p.size || 'Estándar'))].sort((a, b) => {
            const getVal = (s) => parseInt(s) || 9999;
            return getVal(a) - getVal(b);
        });

        const flavors = [...new Set(groupProducts.map(p => p.flavor || 'Tarros'))].sort();

        const productMap = {};
        groupProducts.forEach(p => {
            const key = `${p.flavor || 'Tarros'}-${p.size || 'Estándar'}`;
            productMap[key] = p;
        });

        return { sizes, flavors, productMap, hasData: true };
    };

    const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, product: null });

    // 4. Render Matrix
    const renderMatrix = (groupName) => {
        const { sizes, flavors, productMap, hasData } = processMatrix(groupName);

        if (!hasData) return null;

        return (
            <div key={groupName} className="mb-8 overflow-x-auto border rounded-xl shadow-sm bg-white">
                <h3 className="text-xs font-bold text-gray-700 bg-gray-50 p-2 flex items-center border-b">
                    <Package className="w-3 h-3 mr-1" />
                    {groupName}
                </h3>

                <table className="min-w-full text-[10px] border-collapse">
                    <thead>
                        <tr>
                            <th className="p-1 border-b bg-white text-left font-bold text-gray-400 w-20 sticky left-0 z-10">
                                PRES/SABOR
                            </th>
                            {flavors.map(f => (
                                <th key={f} className="p-1 border-b bg-white font-bold text-gray-600 min-w-[60px] text-center">
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

                                    // Logic for Coloring and Suggestion
                                    const suggestion = Math.ceil(product.projections?.days15?.toBuy || 0);
                                    const currentStock = Math.floor(product.currentStock || 0);
                                    const minStock = product.minimumStock || 0;

                                    let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-100';

                                    if (currentStock <= 0) {
                                        bgClass = 'bg-red-100 text-red-800 border-red-200 font-bold';
                                    } else if (suggestion > 0) {
                                        bgClass = 'bg-amber-50 text-amber-700 border-amber-100 font-bold';
                                    } else if (currentStock < minStock * 1.5) {
                                        // Close to minimum but no suggestion yet (maybe pack size check handles it)
                                        bgClass = 'bg-amber-50 text-amber-600 border-amber-100';
                                    }

                                    return (
                                        <td
                                            key={key}
                                            className="p-1 border-b text-center relative"
                                            onMouseEnter={(e) => {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setTooltip({
                                                    visible: true,
                                                    x: rect.left + (rect.width / 2),
                                                    y: rect.top,
                                                    product
                                                });
                                            }}
                                            onMouseLeave={() => setTooltip({ ...tooltip, visible: false })}
                                            onClick={() => onProductClick(product)}
                                        >
                                            <div className={`py-1 px-1 rounded border ${bgClass} cursor-pointer transition-all hover:scale-105 relative`}>
                                                <div className="text-sm font-bold">{currentStock}</div>
                                                <div className="text-[8px] opacity-60 font-mono mt-0.5">{product.code}</div>
                                                {suggestion > 0 && (
                                                    <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white shadow-sm animate-pulse">
                                                        {suggestion}
                                                    </div>
                                                )}
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

    // 5. Render List View (for non-matrix groups)
    const renderList = (groupName) => {
        const groupProducts = products.filter(p => p.group === groupName);

        if (groupProducts.length === 0) return null;

        return (
            <div key={groupName} className="mb-8 border rounded-xl shadow-sm bg-white">
                <h3 className="text-xs font-bold text-gray-700 bg-gray-50 p-2 flex items-center border-b">
                    <Package className="w-3 h-3 mr-1" />
                    {groupName}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 p-2">
                    {groupProducts.map(product => {
                        // Suggestion Logic
                        const suggestion = Math.ceil(product.projections?.days15?.toBuy || 0);
                        const currentStock = Math.floor(product.currentStock || 0);
                        const minStock = product.minimumStock || 0;

                        let bgClass = 'bg-emerald-50 border-emerald-100 text-emerald-700';
                        if (currentStock <= 0) {
                            bgClass = 'bg-red-100 border-red-200 text-red-800 font-bold';
                        } else if (suggestion > 0) {
                            bgClass = 'bg-amber-50 border-amber-100 text-amber-700 font-bold';
                        } else if (currentStock < minStock * 1.5) {
                            bgClass = 'bg-amber-50 border-amber-100 text-amber-600';
                        }

                        return (
                            <div
                                key={product.id}
                                className={`p-3 rounded border ${bgClass} cursor-pointer transition-all hover:shadow-md relative`}
                                onClick={() => onProductClick(product)}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex-1 pr-2">
                                        <div className="text-[11px] font-bold leading-tight">{product.name}</div>
                                        <div className="text-[9px] opacity-70 font-mono mt-1">{product.code}</div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <div className="text-xl font-bold">{currentStock}</div>
                                        <div className="text-[9px] opacity-80">{product.unit || 'und'}</div>
                                    </div>
                                </div>

                                {suggestion > 0 && (
                                    <div className="mt-2 text-[10px] flex items-center justify-between border-t border-black/10 pt-1">
                                        <span className="opacity-80">Sugerido:</span>
                                        <span className="font-bold text-red-600">{suggestion}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="p-4">
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
                    <div className="font-bold mb-1 text-yellow-400">{tooltip.product.name}</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 opacity-90 text-[10px]">
                        <span>Código:</span> <span className="text-right font-mono">{tooltip.product.code}</span>
                        <span>Stock Actual:</span> <span className="text-right">{Math.floor(tooltip.product.currentStock)}</span>
                        <span>Stock Mínimo:</span> <span className="text-right">{tooltip.product.minimumStock}</span>
                        <span>Unidad Empaque:</span> <span className="text-right">{tooltip.product.packSize}</span>
                        <span>Velocidad Diaria:</span> <span className="text-right">{Number(tooltip.product.dailyVelocity || 0).toFixed(2)} / día</span>

                        <div className="col-span-2 my-1 border-t border-gray-700"></div>

                        <span className="text-yellow-200">Sugerido (15d):</span>
                        <span className="text-right font-bold text-yellow-200">
                            {Math.ceil(tooltip.product.projections?.days15?.toBuy || 0)}
                        </span>

                        <span className="text-gray-400">Proyección 30d:</span>
                        <span className="text-right text-gray-400">
                            {Math.ceil(tooltip.product.projections?.days30?.toBuy || 0)}
                        </span>
                    </div>
                </div>
            )}

            {groups.map(group => {
                if (shouldUseMatrix(group)) {
                    return renderMatrix(group);
                }
                // List view for all others
                return renderList(group);
            })}

            {/* Fallback if no groups */}
            {products.length > 0 && groups.length === 0 && (
                <div className="text-center py-10 text-gray-500">
                    No groups found for {products.length} products.
                </div>
            )}
        </div>
    );
};

export default ReplenishmentMatrix;
