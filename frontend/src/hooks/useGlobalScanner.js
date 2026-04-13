import { useEffect, useRef } from 'react';

/**
 * Hook global para capturar disparos de pistola láser sin depender del foco.
 * Permite que el usuario tenga el foco en un input de texto, pero si la velocidad
 * de tipeo supera la capacidad humana (<30ms entre teclas), asume que es la pistola,
 * intercepta el input, previene que se escriba en la celda y emite el disparo.
 */
export function useGlobalScanner({ onScan, enabled = true }) {
    const buffer = useRef('');
    const lastKeyTime = useRef(0);
    const scannerTimeout = useRef(null);
    const isScanning = useRef(false);

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Tab') return;

            const now = Date.now();
            const elapsed = now - lastKeyTime.current;

            // Si ha pasado mucho tiempo desde la última tecla, reiniciamos
            if (elapsed > 50) {
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

        // Escuchamos en la fase de CAPTURA para bloquear el evento antes de que llegue a los inputs de React.
        window.addEventListener('keydown', handleKeyDown, true);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (scannerTimeout.current) clearTimeout(scannerTimeout.current);
        };
    }, [enabled, onScan]);
}
