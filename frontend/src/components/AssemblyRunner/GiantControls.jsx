import React from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';

const GiantControls = ({
    onNext,
    onPrev,
    onComplete,
    canGoNext = true,
    canGoPrev = true,
    isLastStep = false,
    isFirstStep = false,
    nextLabel = 'SIGUIENTE',
    submitting = false
}) => {
    return (
        <div className="fixed bottom-14 left-0 w-full bg-white border-t border-slate-200 p-2 shadow-lg z-50">
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">

                {/* Previous Button */}
                <button
                    onClick={onPrev}
                    disabled={!canGoPrev || isFirstStep || submitting}
                    className={`
                        flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-bold text-sm
                        transition-all duration-200 w-1/3
                        ${isFirstStep
                            ? 'opacity-0 pointer-events-none'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 border border-slate-300'
                        }
                    `}
                >
                    <ArrowLeft size={20} />
                    ANTERIOR
                </button>

                {/* Center: Step info */}
                <div className="flex-1 text-center hidden md:block">
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                        Panel de Control
                    </div>
                </div>

                {/* Next / Complete Button */}
                {!isLastStep ? (
                    <button
                        onClick={onNext}
                        disabled={!canGoNext || submitting}
                        className={`
                            flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-base text-white
                            transition-all duration-200 w-1/3 shadow-md
                            ${!canGoNext || submitting
                                ? 'bg-slate-300 cursor-not-allowed'
                                : nextLabel === 'INICIAR PROCESO'
                                    ? 'bg-amber-500 hover:bg-amber-600 active:scale-95 border-b-2 border-amber-700'
                                    : 'bg-blue-600 hover:bg-blue-700 active:scale-95 border-b-2 border-blue-800'
                            }
                        `}
                    >
                        {submitting ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                PROCESANDO...
                            </>
                        ) : (
                            <>
                                {nextLabel}
                                <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                ) : (
                    <button
                        onClick={onComplete}
                        disabled={!canGoNext || submitting}
                        className={`
                            flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-base text-white
                            shadow-md w-1/3
                            ${!canGoNext || submitting
                                ? 'bg-slate-300 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-700 active:scale-95 border-b-2 border-green-800'
                            }
                        `}
                    >
                        {submitting ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                COMPLETANDO...
                            </>
                        ) : (
                            <>
                                {nextLabel !== 'SIGUIENTE' ? nextLabel : 'COMPLETAR ETAPA'}
                                <Check size={20} />
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
};

export default GiantControls;
