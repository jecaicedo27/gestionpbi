import React from 'react';
import { History } from 'lucide-react';
import { buildAuditActionLabel, formatDateTimeLabel } from '../microLabConfig';

const MicroAuditTrailPanel = ({ auditTrail = [] }) => (
    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4">
        <div className="flex items-center gap-2">
            <History size={16} className="text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">Trazabilidad del caso</h3>
        </div>
        <div className="mt-3 space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {auditTrail.length === 0 ? (
                <p className="text-sm text-slate-500">Aún no hay movimientos auditados para este caso.</p>
            ) : (
                auditTrail.map(item => (
                    <div key={item.id} className="rounded-2xl bg-white border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-slate-800">{buildAuditActionLabel(item.action)}</p>
                            <span className="text-xs text-slate-500">{formatDateTimeLabel(item.createdAt)}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Usuario: {item.user?.name || 'Sistema'}</p>
                        {item.changes && (
                            <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-2 text-[11px] text-slate-600">
                                {JSON.stringify(item.changes, null, 2)}
                            </pre>
                        )}
                    </div>
                ))
            )}
        </div>
    </div>
);

export default MicroAuditTrailPanel;
