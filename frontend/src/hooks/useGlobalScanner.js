import { useEffect, useRef } from 'react';

/**
 * Hook global para capturar disparos de pistola láser sin depender del foco.
 * Permite que el usuario tenga el foco en un input de texto, pero si la velocidad
 * de tipeo supera la capacidad humana (<30ms entre teclas), asume que es la pistola,
 * intercepta el input, previene que se escriba en la celda y emite el disparo.
 *
 * Also intercepts mobile BT scanner injections that arrive as 'input' events
 * (IME / insertText) rather than individual keydown events.
 */
export function useGlobalScanner({ onScan, enabled = true }) {
    const buffer = useRef('');
    const lastKeyTime = useRef(0);
    const scannerTimeout = useRef(null);
    const isScanning = useRef(false);

    useEffect(() => {
        if (!enabled) return;

        // ── 1. Keydown listener (desktop USB scanners) ──
        const handleKeyDown = (e) => {
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Tab') return;

            const now = Date.now();
            const elapsed = now - lastKeyTime.current;

            // Si ha pasado mucho tiempo desde la última tecla, reiniciamos
            if (elapsed > 400) {
                buffer.current = '';
                isScanning.current = false;
            }

            // Actualizamos tiempo
            lastKeyTime.current = now;

            if (e.key === 'Enter') {
                if (buffer.current.length >= 4 && isScanning.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    const scanned = buffer.current;
                    buffer.current = '';
                    isScanning.current = false;
                    
                    // Disparamos el callback
                    onScan(scanned);
                }
                return;
            }

            if (e.key.length === 1) {
                buffer.current += e.key;

                // Si ya acumulamos unas cuantas teclas rapidísimo, activamos flag 'isScanning'
                // y comenzamos a bloquear el teclado para que no se filtre al input.
                if (buffer.current.length >= 2 && elapsed <= 50) {
                    isScanning.current = true;
                }

                if (isScanning.current) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };

        // ── 2. Interceptor Absoluto: beforeinput (Mobile IME & BT Scanners) ──
        const handleBeforeInput = (e) => {
            if (!enabled) return;

            // Ignore explicitly ignored inputs
            if (e.target && e.target.dataset && e.target.dataset.scannerIgnore === 'true') {
                return;
            }

            const insertedData = e.data || '';
            if (!insertedData) return;

            // Scenario A: Bulk Paste / Predictive Text Insertion
            if (insertedData.length >= 4) {
                // Only intercept if it looks definitively like a scanner barcode,
                // otherwise it might be Android's predictive text (e.g. "sirope")!
                const isDefinitiveCode = insertedData.includes('LOT:') 
                    || insertedData.includes('SKU:') 
                    || insertedData.startsWith('{')
                    || /^\d{4,}$/.test(insertedData.trim());

                if (isDefinitiveCode) {
                    e.preventDefault();
                    setTimeout(() => onScan(insertedData.trim()), 0);
                }
                return;
            }

            // Scenario B: Character by Character validation
            const now = Date.now();
            const elapsed = now - lastKeyTime.current;

            if (elapsed > 400) {
                buffer.current = '';
                isScanning.current = false;
            }

            lastKeyTime.current = now;

            if (insertedData.length === 1) {
                buffer.current += insertedData;
                
                // Allow up to 3 rapid keystrokes before assuming it's a scanner.
                // This prevents multi-touch/ghost-touch on Android capacitive screens from blocking words.
                if (buffer.current.length >= 4 && elapsed <= 30) {
                    isScanning.current = true;
                }

                if (isScanning.current) {
                    e.preventDefault();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('beforeinput', handleBeforeInput, true);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('beforeinput', handleBeforeInput, true);
            if (scannerTimeout.current) clearTimeout(scannerTimeout.current);
        };
    }, [enabled, onScan]);
}
