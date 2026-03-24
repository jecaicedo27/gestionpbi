/**
 * bluetoothPrinter.js — Web Bluetooth service for SAT AF 330 thermal printer
 *
 * Usage:
 *   import printer from './bluetoothPrinter';
 *   await printer.connect();
 *   await printer.sendTSPL('SIZE 80 mm, 50 mm\nGAP 2 mm, 0\nCLS\nTEXT 10,10,"3",0,1,1,"Hello"\nPRINT 1\n');
 */

// Common BLE Serial UUIDs for thermal printers
const PRINTER_SERVICE_UUID    = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_WRITE_CHAR_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
// Fallback UUIDs (some printers use these)
const ALT_SERVICE_UUID        = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const ALT_WRITE_CHAR_UUID     = '49535343-8841-43f4-a8d4-ecbe34729bb3';

const BLE_CHUNK_SIZE = 100; // bytes per write (safe for most BLE stacks)

class BluetoothPrinter {
    constructor() {
        this.device = null;
        this.server = null;
        this.writeCharacteristic = null;
        this._listeners = new Set();
    }

    /** Check if Web Bluetooth is available */
    isSupported() {
        return !!navigator.bluetooth;
    }

    /** Whether the printer is currently connected */
    isConnected() {
        return !!this.server?.connected;
    }

    /** Get connected device name */
    getDeviceName() {
        return this.device?.name || null;
    }

    /** Subscribe to connection state changes */
    onStateChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _notifyListeners() {
        const state = { connected: this.isConnected(), name: this.getDeviceName() };
        this._listeners.forEach(fn => fn(state));
    }

    /**
     * Connect to a Bluetooth thermal printer.
     * Must be called from a user gesture (click/tap).
     */
    async connect() {
        if (!this.isSupported()) {
            throw new Error('Web Bluetooth no está disponible en este navegador. Use Chrome en Android.');
        }

        try {
            // Request device — original filters that worked
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'SAT' },
                    { namePrefix: 'AF' },
                    { namePrefix: 'Printer' },
                    { namePrefix: 'BT-' },
                ],
                optionalServices: [PRINTER_SERVICE_UUID, ALT_SERVICE_UUID],
            });

            if (!this.device) throw new Error('No se seleccionó ningún dispositivo');

            return await this._connectToDevice(this.device);

        } catch (err) {
            console.error('Error connecting to printer:', err);
            throw err;
        }
    }

    /**
     * Try to reconnect to a previously paired device automatically.
     * Can be called on page load without a user gesture.
     */
    async tryAutoReconnect() {
        if (!this.isSupported()) return null;
        if (this.isConnected()) return { name: this.getDeviceName(), connected: true };

        try {
            if (!navigator.bluetooth.getDevices) {
                console.log('getDevices() not supported — manual connect required');
                return null;
            }
            const devices = await navigator.bluetooth.getDevices();
            if (devices.length === 0) return null;

            const device = devices[0];
            console.log(`🔄 Auto-reconnecting to ${device.name}...`);
            this.device = device;

            // Try up to 3 times with backoff
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    return await this._connectToDevice(device);
                } catch (e) {
                    console.log(`Auto-reconnect attempt ${attempt}/3 failed:`, e.message);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            return null;
        } catch (err) {
            console.log('Auto-reconnect failed:', err.message);
            return null;
        }
    }

    /**
     * Reconnect to the last known device (no device picker dialog).
     * Can be used as a quick "Reconectar" button.
     */
    async reconnect() {
        if (this.isConnected()) return { name: this.getDeviceName(), connected: true };

        // If we still have the device reference, try directly
        if (this.device) {
            return await this._connectToDevice(this.device);
        }

        // Otherwise try getDevices()
        return await this.tryAutoReconnect();
    }

    /**
     * Internal: connect to a specific BLE device
     */
    async _connectToDevice(device) {
        // Remove old listener to prevent stacking
        if (this._disconnectHandler) {
            device.removeEventListener('gattserverdisconnected', this._disconnectHandler);
        }

        // Set up disconnect handler
        this._disconnectHandler = () => {
            console.warn('🔴 Impresora desconectada');
            this.writeCharacteristic = null;
            this.server = null;
            this._notifyListeners();

            // Auto-reconnect with retries
            this._autoReconnectWithRetries(device);
        };
        device.addEventListener('gattserverdisconnected', this._disconnectHandler);

        // Connect to GATT server
        this.server = await device.gatt.connect();
        console.log('✅ Conectado a GATT server:', device.name);

        // Try to find the write characteristic
        this.writeCharacteristic = await this._discoverWriteCharacteristic();

        this._notifyListeners();
        return { name: device.name, connected: true };
    }

    /**
     * Internal: retry reconnection up to 3 times with backoff
     */
    async _autoReconnectWithRetries(device) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            if (this.isConnected()) return; // Already reconnected
            try {
                console.log(`🔄 Reconexión automática intento ${attempt}/3...`);
                await this._connectToDevice(device);
                console.log('✅ Reconexión exitosa');
                return;
            } catch (e) {
                console.log(`Intento ${attempt} fallido:`, e.message);
            }
        }
        console.log('❌ Reconexión automática fallida — use el botón Reconectar');
    }

    /**
     * Try multiple known service/characteristic UUIDs to find the writable one
     */
    async _discoverWriteCharacteristic() {
        const candidates = [
            { service: PRINTER_SERVICE_UUID, char: PRINTER_WRITE_CHAR_UUID },
            { service: ALT_SERVICE_UUID, char: ALT_WRITE_CHAR_UUID },
        ];

        for (const { service, char } of candidates) {
            try {
                const svc = await this.server.getPrimaryService(service);
                const ch = await svc.getCharacteristic(char);
                console.log(`✅ Found write characteristic: ${service} / ${char}`);
                return ch;
            } catch (e) {
                console.log(`⚠️ Service ${service} not found, trying next...`);
            }
        }

        // Fallback: enumerate all services and find any writable characteristic
        console.log('Enumerating all services...');
        try {
            const services = await this.server.getPrimaryServices();
            for (const svc of services) {
                console.log('  Service:', svc.uuid);
                const chars = await svc.getCharacteristics();
                for (const ch of chars) {
                    console.log('    Char:', ch.uuid, 'props:', ch.properties);
                    if (ch.properties.write || ch.properties.writeWithoutResponse) {
                        console.log(`✅ Using writable characteristic: ${ch.uuid}`);
                        return ch;
                    }
                }
            }
        } catch (e) {
            console.error('Error enumerating services:', e);
        }

        throw new Error('No se encontró una característica de escritura en la impresora. Verifique que la impresora está encendida y cerca.');
    }

    /**
     * Disconnect from the printer
     */
    disconnect() {
        if (this.device?.gatt?.connected) {
            this.device.gatt.disconnect();
        }
        this.writeCharacteristic = null;
        this.server = null;
        this._notifyListeners();
    }

    /**
     * Send a TSPL command string to the printer.
     * Automatically chunks data for BLE compatibility.
     * @param {string} tsplCommands - Full TSPL command string
     */
    async sendTSPL(tsplCommands) {
        if (!this.writeCharacteristic) {
            throw new Error('Impresora no conectada');
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(tsplCommands);

        // Send in chunks (BLE has MTU limits)
        for (let offset = 0; offset < data.length; offset += BLE_CHUNK_SIZE) {
            const chunk = data.slice(offset, offset + BLE_CHUNK_SIZE);
            if (this.writeCharacteristic.properties.writeWithoutResponse) {
                await this.writeCharacteristic.writeValueWithoutResponse(chunk);
            } else {
                await this.writeCharacteristic.writeValue(chunk);
            }
            // Small delay between chunks to avoid overflow
            if (offset + BLE_CHUNK_SIZE < data.length) {
                await new Promise(r => setTimeout(r, 20));
            }
        }
    }

    /**
     * Send raw bytes to the printer
     * @param {Uint8Array} bytes
     */
    async sendRaw(bytes) {
        if (!this.writeCharacteristic) {
            throw new Error('Impresora no conectada');
        }
        for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
            const chunk = bytes.slice(offset, offset + BLE_CHUNK_SIZE);
            if (this.writeCharacteristic.properties.writeWithoutResponse) {
                await this.writeCharacteristic.writeValueWithoutResponse(chunk);
            } else {
                await this.writeCharacteristic.writeValue(chunk);
            }
            if (offset + BLE_CHUNK_SIZE < bytes.length) {
                await new Promise(r => setTimeout(r, 20));
            }
        }
    }
}

// Singleton
const printer = new BluetoothPrinter();
export default printer;
