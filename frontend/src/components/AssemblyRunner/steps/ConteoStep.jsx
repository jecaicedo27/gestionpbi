import React, { useState, useCallback } from 'react';
import { Camera, CheckCircle, AlertTriangle, Printer } from 'lucide-react';

/**
 * ConteoStep — LIQUIPOPS ONLY
 *
 * Ultra-compact layout: fits on screen without vertical scroll.
 * Order: 3400 → 1150 → 350 (descending by size).
 * Photo validation: every product with actual > 0 requires a photo.
 */
const ConteoStep = ({
    stepData,
    conteoActuals = {},
    onConteoActualChange,
    conteoPhotos = {},
    onConteoPhotoChange,
    isPackagingRole = false,
}) => {
    const noteData = stepData;
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const batchNumber = noteData.productionBatch?.batchNumber || '';
    const esferaFactors = noteData.processParameters?.esfera_factors || {};
    const [uploading, setUploading] = useState({});

    // ── GATE: Packaging roles must NOT see the production counting form ──
    if (isPackagingRole) {
        return (
            <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto pt-16 pb-36 px-4 text-center">
                <div className="text-6xl mb-4">🔒</div>
                <h2 className="text-xl font-extrabold text-slate-700 mb-2">Conteo en curso</h2>
                <p className="text-sm text-slate-500 mb-6">
                    El equipo de <strong>producción</strong> está realizando el conteo de unidades.
                    Una vez finalicen, tu paso de <strong>empaque</strong> será habilitado automáticamente.
                </p>
                <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-6 py-4">
                    <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">Lote en proceso</div>
                    <div className="text-lg font-black text-amber-800">{batchNumber}</div>
                </div>
            </div>
        );
    }

    // ── Sort targets by size DESCENDING: 3400 → 1150 → 350 ──
    const extractSize = (name) => {
        if (!name) return 0;
        const match = name.match(/X\s*(\d+)\s*(?:GR|ML|KG)/i);
        return match ? parseInt(match[1], 10) : 0;
    };

    const sortedTargets = [...outputTargets].sort((a, b) => {
        return extractSize(b.product?.name) - extractSize(a.product?.name);
    });

    const getEsferaFactor = (target) => esferaFactors[target.productId] || null;

    const totalEsferas = outputTargets.reduce((sum, t) => {
        const factor = getEsferaFactor(t);
        if (!factor) return sum;
        const actual = parseInt(conteoActuals[t.productId] ?? t.plannedUnits ?? 0, 10);
        return sum + (actual * factor);
    }, 0);

    const getSizeLabel = (name) => {
        if (!name) return '';
        const match = name.match(/X\s*(\d+\s*(?:GR|ML|KG))/i);
        return match ? match[1] : '';
    };

    const getFlavorLabel = (name) => {
        if (!name) return name;
        const match = name.match(/SABOR\s+A\s+(.+?)\s+X\s+/i);
        return match ? match[1] : name;
    };

    // ── Photo upload handler ──
    const handlePhotoUpload = async (productId, file) => {
        if (!file) return;
        setUploading(prev => ({ ...prev, [productId]: true }));
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('context', `conteo_${productId}`);
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url && onConteoPhotoChange) {
                onConteoPhotoChange(productId, data.url);
            }
        } catch (e) {
            console.error('Error uploading conteo photo:', e);
        } finally {
            setUploading(prev => ({ ...prev, [productId]: false }));
        }
    };

    // ── Missing photos check ──
    const missingPhotos = sortedTargets.filter(t => {
        const actual = parseInt(conteoActuals[t.productId] ?? '', 10);
        return !isNaN(actual) && actual > 0 && !conteoPhotos[t.productId];
    });

    // ── Print Cart Label ──
    const printCartLabel = useCallback(() => {
        const flavor = sortedTargets.length > 0 ? getFlavorLabel(sortedTargets[0].product?.name) : 'N/A';
        const today = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const rows = sortedTargets.map(t => {
            const size = getSizeLabel(t.product?.name);
            const qty = conteoActuals[t.productId] ?? t.plannedUnits ?? 0;
            return `
                <tr>
                    <td style="padding:4px 10px;font-size:18px;font-weight:800;border-bottom:1px dashed #ccc;">${size}</td>
                    <td style="padding:4px 10px;font-size:22px;font-weight:900;text-align:center;border-bottom:1px dashed #ccc;">${qty}</td>
                </tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
            <title>Etiqueta Carrito</title>
            <style>
                @media print { @page { margin: 5mm; } body { margin: 0; } }
                body { font-family: 'Arial', sans-serif; width: 280px; padding: 8px; }
                .header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 6px; margin-bottom: 6px; }
                .lote { font-size: 14px; font-weight: 900; letter-spacing: 1px; background: #000; color: #fff; padding: 4px 12px; border-radius: 6px; display: inline-block; margin-bottom: 4px; }
                .sabor { font-size: 26px; font-weight: 900; text-transform: uppercase; margin: 4px 0; }
                .fecha { font-size: 11px; color: #666; }
                table { width: 100%; border-collapse: collapse; margin-top: 6px; }
                th { font-size: 10px; text-transform: uppercase; color: #888; padding: 2px 10px; text-align: left; letter-spacing: 1px; }
                th:last-child { text-align: center; }
                .footer { text-align: center; font-size: 9px; color: #aaa; margin-top: 8px; border-top: 2px solid #000; padding-top: 4px; }
            </style></head><body>
            <div class="header">
                <div class="lote">${batchNumber}</div>
                <div class="sabor">🫧 ${flavor}</div>
                <div class="fecha">Producido: ${today}</div>
            </div>
            <table>
                <thead><tr><th>Tamaño</th><th>Cantidad</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="footer">POPPING BOBA INTERNATIONAL — EMPAQUE</div>
        </body></html>`;

        const w = window.open('', '_blank', 'width=320,height=500');
        if (w) {
            w.document.write(html);
            w.document.close();
            setTimeout(() => { w.print(); }, 400);
        }
    }, [sortedTargets, conteoActuals, batchNumber]);
    return (
        <div className="flex flex-col h-full max-w-3xl mx-auto pt-1 pb-20 px-2">
            {/* Compact header row */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-lg">📋</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CONTEO DE PRESENTACIONES</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={printCartLabel}
                        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-2.5 py-1.5 shadow-sm transition-all active:scale-95"
                        title="Imprimir etiqueta para carrito"
                    >
                        <Printer size={14} />
                        <span className="text-[10px] font-bold uppercase">Etiqueta</span>
                    </button>
                    <div className="bg-emerald-500 rounded-lg px-3 py-1 shadow-sm">
                        <div className="text-[8px] font-bold text-emerald-100 uppercase">LOTE</div>
                        <div className="text-xs font-black text-white tracking-wider leading-tight">{batchNumber}</div>
                    </div>
                </div>
            </div>

            {/* Main card */}
            <div className="bg-white rounded-xl shadow-lg border-2 border-cyan-400 overflow-hidden flex-1 flex flex-col">
                <div className="bg-gradient-to-r from-cyan-600 to-sky-500 py-1.5 px-3 text-center shrink-0">
                    <span className="text-white font-extrabold text-xs uppercase tracking-widest">📋 ¿Cuántas unidades salieron?</span>
                </div>

                {/* Column headers */}
                <div className="flex items-center gap-2 px-5 pt-2 pb-1 shrink-0">
                    <div className="shrink-0 w-[70px]">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tamaño</span>
                    </div>
                    <div className="flex-1 min-w-[80px]">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Sabor</span>
                    </div>
                    <div className="text-center shrink-0 w-[60px]">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Programado</span>
                    </div>
                    <span className="shrink-0 w-[14px]"></span>
                    <div className="shrink-0 w-[100px] text-center">
                        <span className="text-[9px] font-bold text-purple-500 uppercase tracking-wider">Real Producido</span>
                    </div>
                    <div className="shrink-0 w-[40px] text-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">%</span>
                    </div>
                    <div className="shrink-0 w-10 text-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Evidencia</span>
                    </div>
                </div>

                {/* Rows — compact grid */}
                <div className="p-2 pt-0 space-y-1.5 flex-1 overflow-auto">
                    {sortedTargets.map((target) => {
                        const actual = conteoActuals[target.productId];
                        const planned = target.plannedUnits;
                        const actualNum = parseInt(actual ?? planned ?? 0, 10);
                        const deviation = actual !== undefined && planned > 0
                            ? ((actualNum - planned) / planned * 100).toFixed(1) : null;
                        const isOk = deviation === null || Math.abs(parseFloat(deviation)) <= 5;
                        const sizeLabel = getSizeLabel(target.product?.name);
                        const flavorLabel = getFlavorLabel(target.product?.name);
                        const photoUrl = conteoPhotos[target.productId];
                        const isUploading = uploading[target.productId];
                        const actualEntered = actual !== undefined && actual !== '' && !isNaN(parseInt(actual, 10));
                        const needsPhoto = actualEntered && parseInt(actual, 10) > 0 && !photoUrl;

                        return (
                            <div key={target.id} className={`rounded-lg border-2 px-3 py-2 transition-all ${actual !== undefined
                                ? (isOk ? 'border-green-300 bg-green-50/50' : 'border-amber-300 bg-amber-50/50')
                                : 'border-slate-200 bg-slate-50/50'
                                }`}>
                                {/* Single-line: Flavor | Size | Programado → Real Producido | % | Evidencia */}
                                <div className="flex items-center gap-2">
                                    {/* Size badge */}
                                    <div className="shrink-0 w-[70px]">
                                        <span className="text-[10px] font-bold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">{sizeLabel}</span>
                                    </div>

                                    {/* Flavor */}
                                    <div className="flex-1 min-w-[80px]">
                                        <span className="text-sm font-bold text-slate-800 leading-tight">{flavorLabel}</span>
                                    </div>

                                    {/* Programado */}
                                    <div className="text-center shrink-0 w-[60px]">
                                        <div className="text-base font-black text-slate-500">{planned?.toLocaleString('es-CO')}</div>
                                    </div>

                                    <span className="text-slate-300 font-bold text-sm shrink-0">→</span>

                                    {/* Real fabricado input */}
                                    <div className="shrink-0 w-[100px]">
                                        <input
                                            type="number"
                                            min="0"
                                            value={actual ?? ''}
                                            onChange={(e) => onConteoActualChange && onConteoActualChange(target.productId, e.target.value)}
                                            className="w-full text-base font-black text-center text-purple-700 py-1.5 px-2 rounded-lg border-2 border-purple-300 focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none bg-white transition-all"
                                            placeholder={planned?.toString()}
                                        />
                                    </div>

                                    {/* Deviation badge */}
                                    <div className="shrink-0 w-[40px] text-center">
                                        {deviation !== null ? (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isOk ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                                                {deviation > 0 ? '+' : ''}{deviation}%
                                            </span>
                                        ) : <span className="text-[10px] text-slate-300">—</span>}
                                    </div>

                                    {/* Photo action — compact inline */}
                                    <div className="shrink-0">
                                        {actualEntered && parseInt(actual, 10) > 0 ? (
                                            photoUrl ? (
                                                <label className="cursor-pointer relative group">
                                                    <img
                                                        src={photoUrl}
                                                        alt={`Foto ${sizeLabel}`}
                                                        className="w-10 h-10 rounded-lg object-cover border-2 border-green-400 shadow-sm"
                                                    />
                                                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                                        <CheckCircle size={10} className="text-white" />
                                                    </div>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        className="hidden"
                                                        onChange={(e) => e.target.files?.[0] && handlePhotoUpload(target.productId, e.target.files[0])}
                                                    />
                                                </label>
                                            ) : (
                                                <label className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 border-dashed cursor-pointer transition-all
                                                    ${isUploading
                                                        ? 'border-purple-300 bg-purple-50'
                                                        : 'border-red-400 bg-red-50 hover:bg-red-100 animate-pulse'
                                                    }`}>
                                                    {isUploading ? (
                                                        <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                                                    ) : (
                                                        <Camera size={18} className="text-red-500" />
                                                    )}
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        className="hidden"
                                                        disabled={isUploading}
                                                        onChange={(e) => e.target.files?.[0] && handlePhotoUpload(target.productId, e.target.files[0])}
                                                    />
                                                </label>
                                            )
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                                                <Camera size={14} className="text-slate-300" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Missing photos warning — compact */}
                {missingPhotos.length > 0 && (
                    <div className="mx-2 mb-1.5 rounded-lg bg-red-50 border border-red-300 px-3 py-1.5 flex items-center gap-2 shrink-0">
                        <AlertTriangle size={14} className="text-red-500 shrink-0" />
                        <span className="text-[10px] font-bold text-red-700">
                            📷 Falta{missingPhotos.length > 1 ? 'n' : ''} {missingPhotos.length} foto{missingPhotos.length > 1 ? 's' : ''}: {missingPhotos.map(t => getSizeLabel(t.product?.name)).join(', ')}
                        </span>
                    </div>
                )}

                {/* Total esferas — compact */}
                {totalEsferas > 0 && (
                    <div className="mx-2 mb-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 flex justify-between items-center shrink-0">
                        <div>
                            <div className="text-[8px] font-bold uppercase tracking-wider opacity-80">TOTAL ESFERAS SIIGO</div>
                            <div className="text-base font-black">{totalEsferas.toLocaleString('es-CO')}</div>
                        </div>
                        <div className="text-xl opacity-80">🫧</div>
                    </div>
                )}

                {/* Footer info */}
                <div className="px-2 pb-2 shrink-0">
                    <div className="text-[9px] text-slate-400 text-center bg-slate-50 rounded-lg p-1.5">
                        💡 Después del conteo se crearán en Siigo: <strong>1 nota de ESFERAS</strong> ({totalEsferas.toLocaleString('es-CO')} und) + <strong>{outputTargets.length} notas</strong> por presentación.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConteoStep;
