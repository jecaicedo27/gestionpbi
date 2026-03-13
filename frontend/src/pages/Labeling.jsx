import { useState, useEffect } from 'react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { QRCodeSVG } from 'qrcode.react';
import api from '../services/api';
import { Printer } from 'lucide-react';

const Labeling = () => {
    const [batches, setBatches] = useState([]);
    const [selectedBatch, setSelectedBatch] = useState(null);

    useEffect(() => {
        // Reuse production schedule logic to get recent batches
        // MVP: Just fetch all "SCHEDULED" or "COMPLETED" orders
        // Ideally we need a specific endpoint for Batches
        loadBatches();
    }, []);

    const loadBatches = async () => {
        // Using schedule endpoint as proxy for now
        const start = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString();
        const end = new Date(new Date().setDate(new Date().getDate() + 30)).toISOString();
        const res = await api.get(`/production/schedule?start=${start}&end=${end}`);
        setBatches(res.data.data.filter(b => b.batch));
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Generación de Etiquetas QR</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card title="Lotes Recientes">
                    <div className="space-y-2">
                        {batches.map(order => (
                            <div key={order.id}
                                className="flex justify-between items-center p-3 border rounded hover:bg-neutral-50 cursor-pointer"
                                onClick={() => setSelectedBatch(order.batch)}
                            >
                                <div>
                                    <p className="font-bold">{order.batch.batchCode}</p>
                                    <p className="text-sm text-neutral-500">{order.product.name}</p>
                                </div>
                                <Button size="sm" variant="secondary" icon={Printer}>Ver QR</Button>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card title="Vista Previa">
                    {selectedBatch ? (
                        <div className="flex flex-col items-center justify-center p-6 space-y-4">
                            <div className="p-4 bg-white border-2 border-black">
                                <QRCodeSVG value={selectedBatch.batchCode} size={200} />
                            </div>
                            <div className="text-center">
                                <p className="font-mono text-xl font-bold">{selectedBatch.batchCode}</p>
                                <p className="text-sm text-neutral-500">Expira: {new Date(selectedBatch.expirationDate).toLocaleDateString()}</p>
                            </div>
                            <Button onClick={() => window.print()}>Imprimir Etiqueta</Button>
                        </div>
                    ) : (
                        <div className="text-center text-neutral-400 py-10">
                            Selecciona un lote para ver su etiqueta
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Labeling;
