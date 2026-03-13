import React, { useState } from 'react';
import { Beaker, ChevronDown, ChevronUp, Droplet } from 'lucide-react';

const RecipeChip = ({ formula, outputProductName }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!formula) return null;

    const totalWeight = formula.baseQuantity || 100;

    return (
        <div className="mt-3">
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                className={`
                    cursor-pointer group relative overflow-hidden transition-all duration-300
                    border rounded-xl p-3 select-none
                    ${isExpanded
                        ? 'bg-amber-50 border-amber-200 shadow-md scale-[1.02]'
                        : 'bg-white hover:bg-amber-50 border-slate-200 hover:border-amber-200 hover:shadow-sm'
                    }
                `}
            >
                {/* Header of the Chip */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`
                            p-2 rounded-lg transition-colors
                            ${isExpanded ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 group-hover:bg-amber-100 group-hover:text-amber-600'}
                        `}>
                            <Beaker size={18} />
                        </div>
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
                                Receta Vinculada
                            </div>
                            <div className={`font-medium ${isExpanded ? 'text-amber-900' : 'text-slate-700'}`}>
                                {formula.formulaName || outputProductName}
                            </div>
                        </div>
                    </div>

                    <div className="text-slate-400">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                </div>

                {/* Expanded Content: Ingredients List */}
                {isExpanded && (
                    <div className="mt-4 pt-3 border-t border-amber-100 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center justify-between text-xs text-amber-800 mb-2 px-1">
                            <span className="font-semibold">Ingrediente</span>
                            <span className="font-semibold">Cantidad ({formula.baseUnit})</span>
                        </div>
                        <div className="space-y-1">
                            {formula.items?.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-md hover:bg-amber-100/50">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                                        <span className="text-slate-700">{item.ingredient?.name || 'Ingrediente desconocido'}</span>
                                    </div>
                                    <div className="font-mono text-slate-600 font-medium">
                                        {item.quantity} {item.unit}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 pt-2 text-xs text-center text-amber-600/70 border-t border-amber-100/50">
                            Base de cálculo: {totalWeight} {formula.baseUnit}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecipeChip;
