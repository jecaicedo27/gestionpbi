import { useEffect, useState } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as cleaningApi from '../../api/cleaning';

const STATUS_STYLE = {
    OK: { label: '✅ Suficiente', class: 'bg-green-100 text-green-800 border-green-300' },
    LOW: { label: '⚠️ Por terminar', class: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    OUT: { label: '🚨 Agotado', class: 'bg-red-100 text-red-800 border-red-300' },
};

const CleaningSuppliesView = () => {
    const navigate = useNavigate();
    const [supplies, setSupplies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reporting, setReporting] = useState(null);
    const [message, setMessage] = useState('');

    const load = async () => {
        try {
            const data = await cleaningApi.listSupplies();
            setSupplies(data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleReport = async (supplyId) => {
        try {
            await cleaningApi.reportSupplyLow(supplyId, { message: message.trim() || null });
            setReporting(null);
            setMessage('');
            await load();
            alert('✅ Reportado al administrador para compra');
        } catch (err) {
            alert(err.response?.data?.error || 'Error al reportar');
        }
    };

    if (loading) return <div className="p-6 text-center">Cargando insumos...</div>;

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <div className="bg-orange-500 text-white px-4 py-5 sticky top-0 z-10 shadow-md">
                <button onClick={() => navigate('/aseo')} className="flex items-center gap-1 text-orange-100 mb-2">
                    <ArrowLeft size={18} /> Volver a tareas
                </button>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Package size={28} /> Insumos del Cuarto de Aseo
                </h1>
                <p className="text-orange-100 text-sm mt-1">Marca los que están por terminar para enviar a comprar</p>
            </div>

            <div className="px-4 mt-4 space-y-3">
                {supplies.map(s => {
                    const st = STATUS_STYLE[s.status] || STATUS_STYLE.OK;
                    const isReporting = reporting === s.id;
                    return (
                        <div key={s.id} className={`bg-white rounded-xl shadow-sm border-l-4 ${s.status === 'LOW' ? 'border-yellow-500' : s.status === 'OUT' ? 'border-red-500' : 'border-green-500'} p-4`}>
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="font-semibold text-lg">{s.name}</div>
                                    <div className="text-sm text-gray-600 mt-1">Mínimo: {s.minQty} {s.unit}</div>
                                </div>
                                <span className={`text-xs font-semibold px-2 py-1 rounded border ${st.class}`}>{st.label}</span>
                            </div>

                            {!isReporting && s.status === 'OK' && (
                                <button
                                    onClick={() => setReporting(s.id)}
                                    className="mt-3 w-full bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
                                >
                                    <AlertTriangle size={20} /> Reportar como POR TERMINAR
                                </button>
                            )}

                            {(s.status === 'LOW' || s.status === 'OUT') && !isReporting && (
                                <div className="mt-2 text-xs text-yellow-700 flex items-center gap-1">
                                    <CheckCircle2 size={14} /> Ya reportado al admin
                                </div>
                            )}

                            {isReporting && (
                                <div className="mt-3 space-y-2">
                                    <textarea
                                        placeholder="Mensaje opcional (ej: 'queda muy poco, comprar urgente')"
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        className="w-full p-2 border rounded text-sm"
                                        rows={2}
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { setReporting(null); setMessage(''); }}
                                            className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={() => handleReport(s.id)}
                                            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 rounded"
                                        >
                                            Enviar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CleaningSuppliesView;
