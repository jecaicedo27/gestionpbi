import React, { useState, useEffect } from 'react';
import { Modal, InputNumber, Button, message, Alert, Spin } from 'antd';
import { Bluetooth, Wifi, Printer, TestTube } from 'lucide-react';
import printer from '../../services/bluetoothPrinter';
import { useZebra } from '../../context/ZebraContext';
import { buildLotLabel, buildTestLabel } from '../../services/tsplLabelBuilder';
import { buildLotLabelZPL, buildTestLabelZPL } from '../../services/zplLabelBuilder';

/**
 * ThermalPrintModal
 * Allows logistics operators to split a single received lot into multiple physical
 * "Packs" (bultos/cajas) and print a thermal label for each pack.
 *
 * lotData format:
 * {
 *   productName: "AZUCAR",
 *   sku: "RM-001",
 *   lotNumber: "123",
 *   quantity: 25000,
 *   unit: "gramo" | "unidad",
 *   supplierName: "PROVEEDOR",
 *   receivedAt: "2024-01-01",
 *   expiresAt: "2024-12-31",
 *   orderNumber: "OC-405"
 * }
 */
const ThermalPrintModal = ({ visible, onCancel, lotData }) => {
    // ── Mode & Printers ──
    const [mode, setMode] = useState(() => localStorage.getItem('label_printer_mode') || 'bluetooth');
    useEffect(() => { localStorage.setItem('label_printer_mode', mode); }, [mode]);

    const [printerConnected, setPrinterConnected] = useState(printer.isConnected());
    const [printerName, setPrinterName] = useState(printer.getDeviceName() || '');
    const { zebraStatus, printZPL, recheckNow } = useZebra();

    const [printing, setPrinting] = useState(false);
    const [connecting, setConnecting] = useState(false);

    // ── Box / Pack calculation ──
    const totalQty = lotData?.quantity || 0;
    const [unitsPerBox, setUnitsPerBox] = useState('');
    const [fullBoxes, setFullBoxes] = useState('');
    const [partialUnits, setPartialUnits] = useState('');

    // Pre-fill calculation if possible
    useEffect(() => {
        if (!visible) return;
        setUnitsPerBox('');
        setFullBoxes('');
        setPartialUnits(totalQty);
    }, [visible, totalQty]);

    useEffect(() => {
        if (mode !== 'bluetooth') return;
        const unsub = printer.onStateChange(({ connected, name }) => {
            setPrinterConnected(connected);
            if (name) setPrinterName(name);
        });
        printer.tryAutoReconnect().then(r => {
            if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
        });
        return unsub;
    }, [mode, visible]);

    const handleConnectSat = async () => {
        setConnecting(true);
        try {
            if (printerConnected) {
                const r = await printer.reconnect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            } else {
                const r = await printer.connect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            }
        } catch (err) {
            message.error('Error conectando SAT: ' + (err.message || err));
        } finally {
            setConnecting(false);
        }
    };

    const isReady = mode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';

    const sendToZebra = async (zpl) => {
        const result = await printZPL(zpl);
        if (!result.ok) throw new Error(result.error || 'Error al imprimir en Zebra');
    };

    const handleTestPrint = async () => {
        setPrinting(true);
        try {
            if (mode === 'bluetooth') await printer.sendTSPL(buildTestLabel());
            else await sendToZebra(buildTestLabelZPL());
            message.success('Etiqueta de prueba enviada');
        } catch (err) {
            message.error('Error al imprimir: ' + (err.message || err));
        } finally {
            setPrinting(false);
        }
    };

    const handlePrint = async () => {
        if (!isReady || !lotData) return;
        setPrinting(true);
        try {
            const baseData = {
                productName: lotData.productName || '',
                sku: lotData.sku || '',
                lotNumber: lotData.lotNumber || '',
                unit: lotData.unit || 'und',
                supplier: lotData.supplierName || '',
                receivedAt: lotData.receivedAt || new Date().toISOString(),
                expiresAt: lotData.expiresAt || null,
                orderNumber: lotData.orderNumber || ''
            };

            const nFull = Number(fullBoxes) || 0;
            const sizeBox = Number(unitsPerBox) || 0;
            const partial = Number(partialUnits) || 0;
            const hasPartial = partial > 0;
            const totalBoxesPrint = nFull + (hasPartial ? 1 : 0);

            if (totalBoxesPrint === 0) {
                message.warning('Configure al menos un empaque o uds sueltas.');
                setPrinting(false);
                return;
            }

            const delay = mode === 'bluetooth' ? 1200 : 300;

            if (mode === 'bluetooth') {
                let boxCounter = 1;
                for (let i = 0; i < nFull; i++) {
                    const d = { ...baseData, quantity: sizeBox, boxNumber: boxCounter++, totalBoxes: totalBoxesPrint };
                    await printer.sendTSPL(buildLotLabel(d, 1));
                    if (i < nFull - 1 || hasPartial) await new Promise(r => setTimeout(r, delay));
                }
                if (hasPartial) {
                    const d = { ...baseData, quantity: partial, boxNumber: boxCounter++, totalBoxes: totalBoxesPrint };
                    await printer.sendTSPL(buildLotLabel(d, 1));
                }
            } else {
                let boxCounter = 1;
                for (let i = 0; i < nFull; i++) {
                    const d = { ...baseData, quantity: sizeBox, boxNumber: boxCounter++, totalBoxes: totalBoxesPrint };
                    await sendToZebra(buildLotLabelZPL(d, 1));
                    if (i < nFull - 1 || hasPartial) await new Promise(r => setTimeout(r, delay));
                }
                if (hasPartial) {
                    const d = { ...baseData, quantity: partial, boxNumber: boxCounter++, totalBoxes: totalBoxesPrint };
                    await sendToZebra(buildLotLabelZPL(d, 1));
                }
            }
            message.success(`🖨️ ${totalBoxesPrint} etiqueta(s) impresas`);
            // Optional auto-close
        } catch (err) {
            console.error(err);
            message.error('Error imprimiendo: ' + (err.message || 'Error desconocido'));
        } finally {
            setPrinting(false);
        }
    };

    const currentDistTotal = ((Number(fullBoxes) || 0) * (Number(unitsPerBox) || 0)) + (Number(partialUnits) || 0);
    const isValid = currentDistTotal > 0 && currentDistTotal <= totalQty;
    const isExact = currentDistTotal === totalQty;

    return (
        <Modal
            title={`🖨️ Imprimir Empaques del Lote`}
            open={visible}
            onCancel={onCancel}
            footer={null}
            width={600}
            destroyOnClose
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {lotData && (
                    <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b' }}>{lotData.productName}</div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: '#64748b' }}><strong>Lote:</strong> {lotData.lotNumber}</span>
                            <span style={{ fontSize: 12, color: '#64748b' }}><strong>Cant Total:</strong> {totalQty.toLocaleString()} {lotData.unit || 'und'}</span>
                        </div>
                    </div>
                )}

                <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase' }}>
                        Distribución de Bultos / Cajas
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>BULTOS COMPLETOS</div>
                            <InputNumber
                                min={0} value={fullBoxes} onChange={setFullBoxes}
                                style={{ width: '100%' }} size="large"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>CANT. POR BULTO</div>
                            <InputNumber
                                min={0} value={unitsPerBox} onChange={v => {
                                    setUnitsPerBox(v);
                                    if (v > 0) {
                                        const totalB = Math.floor(totalQty / v);
                                        const rem = totalQty % v;
                                        setFullBoxes(totalB);
                                        setPartialUnits(rem);
                                    }
                                }}
                                style={{ width: '100%' }} size="large"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>RESTO / SUELTAS</div>
                            <InputNumber
                                min={0} value={partialUnits} onChange={setPartialUnits}
                                style={{ width: '100%' }} size="large"
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: isExact ? '#f0fdf4' : isValid ? '#f8fafc' : '#fef2f2', border: `1px solid ${isExact ? '#bbf7d0' : isValid ? '#e2e8f0' : '#fecaca'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: isExact ? '#166534' : isValid ? '#475569' : '#991b1b' }}>
                            Cant. Distribuida: {currentDistTotal.toLocaleString()} {lotData?.unit || 'und'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: isExact ? '#166534' : '#475569' }}>
                            {(Number(fullBoxes) || 0) + (Number(partialUnits) > 0 ? 1 : 0)} etiquetas
                        </div>
                    </div>
                </div>

                {/* Printer Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Impresora:</div>
                    <Button type={mode === 'bluetooth' ? 'primary' : 'default'} onClick={() => setMode('bluetooth')} icon={<Bluetooth size={14} />} style={mode === 'bluetooth' ? { background: '#4f46e5' } : {}}>SAT AF330</Button>
                    <Button type={mode === 'network' ? 'primary' : 'default'} onClick={() => setMode('network')} icon={<Wifi size={14} />} style={mode === 'network' ? { background: '#f97316', borderColor: '#f97316' } : {}}>Zebra ZD230</Button>
                </div>

                {/* Status bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isReady ? '#ecfdf5' : '#f8fafc', padding: '10px 14px', borderRadius: 10, border: `1px solid ${isReady ? '#6ee7b7' : '#e2e8f0'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isReady ? <span style={{ color: '#059669', display: 'flex', alignItems: 'center' }}>🟢 Lista</span> : <span style={{ color: '#94a3b8' }}>🔴 Desconectada</span>}
                        {mode === 'bluetooth' && printerConnected && <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600 }}>{printerName}</span>}
                    </div>
                    <div>
                        {mode === 'bluetooth' && !printerConnected && (
                            <Button size="small" type="primary" style={{ background: '#4f46e5' }} onClick={handleConnectSat} loading={connecting}>Conectar</Button>
                        )}
                        {mode === 'network' && !isReady && (
                            <Button size="small" onClick={recheckNow}>Revisar Zebra</Button>
                        )}
                        {isReady && (
                            <Button size="small" type="dashed" onClick={handleTestPrint} disabled={printing} icon={<TestTube size={12} />}>Test</Button>
                        )}
                    </div>
                </div>

                {/* Print Button */}
                <Button
                    type="primary"
                    size="large"
                    icon={<Printer size={18} />}
                    disabled={!isReady || !isValid || currentDistTotal === 0}
                    loading={printing}
                    onClick={handlePrint}
                    style={{ width: '100%', height: 48, fontSize: 16, fontWeight: 700, background: isReady && isValid ? '#10b981' : undefined }}
                >
                    {printing ? 'Imprimiendo...' : 'Imprimir Etiquetas Térmicas'}
                </Button>
            </div>
        </Modal>
    );
};

export default ThermalPrintModal;
