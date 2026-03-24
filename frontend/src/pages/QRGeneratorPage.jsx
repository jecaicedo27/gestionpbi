import { useState, useEffect } from 'react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { Download, QrCode as QrIcon, Package, Search } from 'lucide-react';
import QRCode from 'qrcode';
import api from '../services/api';

const QRGeneratorPage = () => {
    const [products, setProducts] = useState([]);
    const [filteredProducts, setFilteredProducts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);

    const [formData, setFormData] = useState({
        productCode: '',
        barcode: '',
        productName: '',
        productGroup: '',
        productFlavor: '',
        productSize: '',
        unitsPerBox: '',
        lotNumber: '',
        expirationDate: ''
    });
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [generatedData, setGeneratedData] = useState(null);

    useEffect(() => {
        loadProducts();
    }, []);

    useEffect(() => {
        if (searchTerm.length >= 2) {
            const searchLower = searchTerm.toLowerCase().trim();
            // Split by spaces or % to get search tokens
            const searchTokens = searchLower.split(/[\s%]+/).filter(t => t.length > 0);

            const filtered = products.filter(p => {
                const nameLower = p.name.toLowerCase();
                const skuLower = p.sku.toLowerCase();
                const combinedText = `${nameLower} ${skuLower}`;

                // Match if search term (without %) is contained in name or SKU
                if (combinedText.includes(searchLower.replace(/%/g, ''))) {
                    return true;
                }

                // Match if all search tokens are found in the combined text
                const allTokensMatch = searchTokens.every(token =>
                    combinedText.includes(token)
                );

                return allTokensMatch;
            });

            setFilteredProducts(filtered);
            setShowDropdown(true);
        } else {
            setFilteredProducts([]);
            setShowDropdown(false);
        }
    }, [searchTerm, products]);

    const loadProducts = async () => {
        try {
            const response = await api.get('/orders/catalog');
            setProducts(response.data.data || []);
        } catch (error) {
            console.error('Error loading products:', error);
        }
    };

    const handleProductSelect = (product) => {
        // Calculate expiration date: 9 months from today
        const today = new Date();
        const expirationDate = new Date(today);
        expirationDate.setMonth(expirationDate.getMonth() + 9);
        const expirationDateStr = expirationDate.toISOString().split('T')[0];

        setSelectedProduct(product);
        setSearchTerm(product.name);
        setFormData({
            productCode: product.sku || '',
            barcode: product.barcode || product.sku || '',
            productName: product.name || '',
            productGroup: product.group?.name || 'PRODUCTO',
            productFlavor: product.flavor || '',
            productSize: product.size || '',
            unitsPerBox: product.packSize || '12',
            lotNumber: '',
            expirationDate: expirationDateStr
        });
        setShowDropdown(false);
    };

    const handleGenerate = async () => {
        // Validate required fields
        if (!formData.productCode || !formData.barcode || !formData.lotNumber || !formData.expirationDate) {
            alert('Todos los campos son requeridos');
            return;
        }

        // Create QR data as pipe-separated plain text
        // Format: productCode|barcode|name|unitsPerBox|lotNumber|expirationDate
        // This avoids JSON special chars ({}": etc.) that get mangled by
        // barcode scanners in keyboard-HID mode with Spanish keyboard layout
        const unitsPerBox = parseInt(formData.unitsPerBox) || 1;
        const qrString = [
            formData.productCode,
            formData.barcode,
            formData.productName,
            unitsPerBox,
            formData.lotNumber,
            formData.expirationDate
        ].join('|');

        // Keep structured object for display purposes
        const qrData = {
            productCode: formData.productCode,
            barcode: formData.barcode,
            name: formData.productName,
            unitsPerBox,
            lotNumber: formData.lotNumber,
            lot: formData.lotNumber,
            expirationDate: formData.expirationDate
        };

        try {
            // Generate QR code as data URL using plain text (not JSON)
            const dataUrl = await QRCode.toDataURL(qrString, {
                width: 400,
                margin: 2,
                errorCorrectionLevel: 'M',
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });

            setQrDataUrl(dataUrl);
            setGeneratedData(qrData);
        } catch (error) {
            console.error('Error generating QR:', error);
            alert('Error generando código QR');
        }
    };

    const handleDownload = () => {
        if (!qrDataUrl) return;

        const link = document.createElement('a');
        link.href = qrDataUrl;
        link.download = `QR-${formData.productCode}-${formData.lotNumber}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePrint = () => {
        if (!qrDataUrl) return;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Etiqueta QR - ${formData.productName}</title>
                <style>
                    @page { 
                        size: 50mm 40mm; 
                        margin: 0; 
                    }
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    body {
                        width: 50mm;
                        height: 40mm;
                        font-family: Arial, sans-serif;
                        background: white;
                        padding: 1.5mm;
                    }
                    .label {
                        width: 100%;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                    }
                    .product-name {
                        font-size: 8pt;
                        font-weight: bold;
                        line-height: 1.1;
                        text-align: center;
                        margin-bottom: 0.5mm;
                        text-transform: uppercase;
                    }
                    .product-footer {
                        font-size: 10pt;
                        font-weight: bold;
                        text-align: center;
                        margin-top: 1mm;
                        line-height: 1;
                        text-transform: uppercase;
                    }
                    .content {
                        flex: 1;
                        display: flex;
                        gap: 1.5mm;
                    }
                    .qr-section {
                        flex-shrink: 0;
                        width: 26mm;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .qr-image {
                        width: 26mm;
                        height: 26mm;
                        image-rendering: pixelated;
                        image-rendering: -moz-crisp-edges;
                        image-rendering: crisp-edges;
                    }
                    .info-section {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        justify-content: flex-start;
                        font-size: 6pt;
                        line-height: 1.15;
                        padding-top: 1mm;
                    }
                    .info-top {
                        margin-bottom: 2mm;
                    }
                    .barcode-text {
                        font-size: 8pt;
                        font-weight: bold;
                        margin-bottom: 0.8mm;
                    }
                    .lot-line {
                        font-size: 7pt;
                        margin-bottom: 0.5mm;
                    }
                    .lot-number {
                        font-weight: bold;
                    }
                    .expiry-line {
                        font-size: 5.5pt;
                    }
                    .quantity-box {
                        border: 1.5px solid #000;
                        padding: 1mm 2mm;
                        text-align: center;
                        font-weight: bold;
                        font-size: 7.5pt;
                        line-height: 1;
                        display: inline-block;
                    }
                    @media print {
                        body {
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="label">
                    <div class="product-name">${formData.productGroup}</div>
                    <div class="content">
                        <div class="qr-section">
                            <img src="${qrDataUrl}" class="qr-image" alt="QR Code" />
                        </div>
                        <div class="info-section">
                            <div class="info-top">
                                <div class="barcode-text">${formData.barcode}</div>
                                <div class="lot-line">Lote: <span class="lot-number">${formData.lotNumber}</span></div>
                                <div class="expiry-line">Vence: ${new Date(formData.expirationDate).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')}</div>
                            </div>
                            <div class="quantity-box">CANT: ${formData.unitsPerBox}</div>
                        </div>
                    </div>
                    <div class="product-footer">${formData.productFlavor} ${formData.productSize}</div>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();

        // Wait for the image to load before printing
        setTimeout(() => {
            printWindow.print();
        }, 500);
    };

    const handleReset = () => {
        setSearchTerm('');
        setSelectedProduct(null);
        setFormData({
            productCode: '',
            barcode: '',
            productName: '',
            unitsPerBox: '',
            lotNumber: '',
            expirationDate: ''
        });
        setQrDataUrl('');
        setGeneratedData(null);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold">Generador de Códigos QR</h1>
                    <p className="text-gray-600 mt-1">Genera códigos QR para etiquetado de productos</p>
                </div>
                <QrIcon className="w-12 h-12 text-primary-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Form Section */}
                <Card>
                    <h2 className="text-lg font-bold mb-4">Datos del Producto</h2>
                    <div className="space-y-4">
                        {/* Product Search */}
                        <div className="relative">
                            <label className="block text-sm font-medium mb-1">Buscar Producto *</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    className="w-full pl-10 p-2 border rounded"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    onFocus={() => searchTerm.length >= 2 && setShowDropdown(true)}
                                    placeholder="Escribe para buscar..."
                                />
                            </div>

                            {/* Dropdown */}
                            {showDropdown && filteredProducts.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {filteredProducts.map(product => (
                                        <button
                                            key={product.id}
                                            onClick={() => handleProductSelect(product)}
                                            className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-0"
                                        >
                                            <div className="font-medium">{product.name}</div>
                                            <div className="text-sm text-gray-600">SKU: {product.sku}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {selectedProduct && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Código de Producto (SKU)</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded bg-gray-50"
                                        value={formData.productCode}
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Código de Barras</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded bg-gray-50"
                                        value={formData.barcode}
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Nombre del Producto</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded bg-gray-50"
                                        value={formData.productName}
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Unidades por Caja</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 border rounded bg-gray-50"
                                        value={formData.unitsPerBox}
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Número de Lote *</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded"
                                        value={formData.lotNumber}
                                        onChange={e => setFormData({ ...formData, lotNumber: e.target.value })}
                                        placeholder="L-2025-001"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">
                                        Fecha de Vencimiento
                                        <span className="text-xs text-gray-500 ml-2">(Auto: +9 meses)</span>
                                    </label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded bg-gray-50"
                                        value={formData.expirationDate}
                                        readOnly
                                    />
                                </div>

                                <div className="flex gap-2 pt-4">
                                    <Button onClick={handleGenerate} icon={QrIcon} className="flex-1">
                                        Generar QR
                                    </Button>
                                    <Button onClick={handleReset} variant="secondary">
                                        Limpiar
                                    </Button>
                                </div>
                            </>
                        )}

                        {!selectedProduct && searchTerm.length === 0 && (
                            <div className="text-center py-8 text-gray-400">
                                <Package className="w-16 h-16 mx-auto mb-2 opacity-20" />
                                <p className="text-sm">Busca un producto para comenzar</p>
                            </div>
                        )}
                    </div>
                </Card>

                {/* Preview Section */}
                <Card>
                    <h2 className="text-lg font-bold mb-4">Vista Previa</h2>
                    {qrDataUrl ? (
                        <div className="space-y-4">
                            {/* Preview with 50mm x 40mm proportions (5:4 ratio) - 400px x 320px */}
                            <div className="border-2 border-dashed border-gray-300 rounded-lg inline-block bg-gray-50" style={{ width: '400px', height: '320px', padding: '8px' }}>
                                {/* Horizontal Layout Preview */}
                                <div className="flex flex-col h-full">
                                    <div className="font-bold text-center uppercase" style={{ fontSize: '16px', lineHeight: '1.1', marginBottom: '4px' }}>{formData.productGroup}</div>
                                    <div className="flex gap-3 flex-1">
                                        <div className="flex-shrink-0">
                                            <img src={qrDataUrl} alt="QR Code" style={{ width: '208px', height: '208px' }} />
                                        </div>
                                        <div className="flex-1 flex flex-col justify-start" style={{ fontSize: '12px', paddingTop: '8px' }}>
                                            <div className="space-y-1 mb-4">
                                                <div className="font-bold" style={{ fontSize: '16px' }}>{formData.barcode}</div>
                                                <div style={{ fontSize: '14px' }}>Lote: <span className="font-bold">{formData.lotNumber}</span></div>
                                                <div style={{ fontSize: '11px' }}>Vence: {new Date(formData.expirationDate).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' })}</div>
                                            </div>
                                            <div className="border-2 border-black px-3 py-1 font-bold inline-block" style={{ fontSize: '15px', alignSelf: 'flex-start' }}>
                                                CANT: {formData.unitsPerBox}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-bold text-center uppercase" style={{ fontSize: '20px', marginTop: '8px' }}>{formData.productFlavor} {formData.productSize}</div>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                                <div className="font-medium text-blue-900 mb-2">Contenido del QR (texto plano):</div>
                                <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
                                    {[generatedData?.productCode, generatedData?.barcode, generatedData?.name, generatedData?.unitsPerBox, generatedData?.lotNumber, generatedData?.expirationDate].join('|')}
                                </pre>
                                <div className="text-xs text-blue-700 mt-1">Formato: SKU|Barcode|Nombre|Cantidad|Lote|Vencimiento</div>
                            </div>

                            <div className="flex gap-2">
                                <Button onClick={handleDownload} icon={Download} className="flex-1">
                                    Descargar PNG
                                </Button>
                                <Button onClick={handlePrint} icon={Package} variant="secondary" className="flex-1">
                                    Imprimir Etiqueta
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-16 text-gray-400">
                            <QrIcon className="w-24 h-24 mx-auto mb-4 opacity-20" />
                            <p>Completa el formulario y genera un código QR</p>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default QRGeneratorPage;
