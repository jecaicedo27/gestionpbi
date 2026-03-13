import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { Download, FileText } from 'lucide-react';
import api from '../../services/api';

const Reports = () => {
    const downloadReport = async (type) => {
        try {
            const response = await api.get(`/admin/reports/${type}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${type}_report.csv`);
            document.body.appendChild(link);
            link.click();
        } catch (error) {
            alert('Error descargando reporte');
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Reportes y Analítica</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Ventas Consolidadas" icon={FileText}>
                    <p className="text-sm text-neutral-500 mb-4">
                        Exporta el histórico de ventas facturadas detallado por producto y cliente.
                    </p>
                    <Button onClick={() => downloadReport('sales')} icon={Download} className="w-full">
                        Descargar CSV
                    </Button>
                </Card>

                <Card title="Movimientos de Inventario" icon={FileText}>
                    <p className="text-sm text-neutral-500 mb-4">
                        Traza todos los movimientos de entrada y salida de bodega.
                    </p>
                    {/* Placeholder for future implementation */}
                    <Button disabled variant="secondary" className="w-full">Próximamente</Button>
                </Card>
            </div>
        </div>
    );
};

export default Reports;
